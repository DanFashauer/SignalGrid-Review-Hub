// Read-only normalization + transport for the APP-PROTECTION / MAM connector.
//
// The source is one managed-app registration at one instant: whether an
// app-protection policy is applied, which policies, what the plane flagged, and when
// the registration was read. Every operation is a read; there is no write path —
// SignalGrid never assigns a policy, never wraps an app, and NEVER wipes one
// (selective wipe is a deliberate non-feature; see types).
//
// Defensive normalization ported from the change-window / shift-context connectors:
// MAM planes are external and may emit anything in any slot, so the normalizer — not
// the compiler — makes values safe. Own-property reads only; malformed reports fail
// closed.
//
// TRUSTED vs POSED. The management plane is the system of record for whether a
// policy is applied (`policyState`) and for the flagged reasons (`complianceState`),
// so those are read from the wire as allowlisted enums / a bounded string set. App
// SENSITIVITY and MAM APPLICABILITY are the CALLER's classifications of the app, not
// the plane's, so they are posed via options: unposed is carried (`unassessed`,
// which never escalates and never excuses), a posed-but-unreadable applicability is
// `unknown` and raises, and a posed-but-unreadable sensitivity falls back to
// `unassessed` because sensitivity may only ESCALATE on an explicit "sensitive" —
// never on garbage.

import { ageMs } from "../../utils/freshness";
import {
  APP_PROTECTION_REPORT_KEYS,
  AppProtectionConnectorError,
  type AppProtectionReportRaw,
  type MamApplicability,
  type MamAppSensitivity,
  type MamComplianceState,
  type MamPolicyState,
  type MamRecordFreshness,
  type MamReportIntegrity,
  type NormalizedAppProtection,
} from "./types";
import { createReadOnlyGuard } from "../../utils/guardReadOnly";

/** GET-only guard, mirroring the other connectors. */
export const guardReadOnly = createReadOnlyGuard(
  (method) => new AppProtectionConnectorError("read_only_violation", `app-protection is read-only; refused ${method}`),
);

/** Map a string to one of `allowed`, case-insensitively; anything else → fallback.
 *  An ALLOWLIST on purpose — an unrecognized value fails to the safe unknown. */
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof v !== "string") return fallback;
  const s = v.trim().toLowerCase();
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
}

/** Did the report ASSERT a policy_state we could not read? `null` counts as absent. */
function enumMalformed(v: unknown, allowed: readonly string[]): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v !== "string") return true;
  return !allowed.includes(v.trim().toLowerCase());
}

/** Read a field ONLY if the report asserts it as an OWN property. An inherited value
 *  is the prototype's claim, not this report's. */
function ownValue(report: object, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(report, key) ? (report as Record<string, unknown>)[key] : undefined;
}

function isPlainReport(report: unknown): report is object {
  return typeof report === "object" && report !== null && !Array.isArray(report) && report !== Object.prototype;
}

const MAX_PROTOTYPE_DEPTH = 64;

/** Does the report carry any key this connector does not understand? Walks the
 *  PROTOTYPE CHAIN even though value reads are own-only: an inherited assertion in a
 *  spelling we ignore is still an assertion. A symbol key counts; a class instance
 *  fails closed. */
function hasUnrecognizedKey(report: object, known: readonly string[]): boolean {
  try {
    let o: object | null = report;
    for (let depth = 0; o !== null && o !== Object.prototype; depth += 1) {
      if (depth >= MAX_PROTOTYPE_DEPTH) return true;
      for (const k of Reflect.ownKeys(o)) {
        if (depth > 0) return true;
        if (typeof k === "symbol") return true;
        if (!known.includes(k)) return true;
      }
      o = Object.getPrototypeOf(o) as object | null;
    }
    return false;
  } catch {
    return true;
  }
}

/** A trimmed non-empty string, or null. Never a fabricated placeholder. */
function textOf(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
}

/** A strict ISO-8601 UTC (Zulu) instant → epoch ms, or null. Rejects an impossible
 *  calendar date (2026-02-30) that `Date.parse` silently rolls over to a real one:
 *  the parsed instant must reproduce the supplied UTC components, or an unreadable
 *  date would masquerade as valid freshness evidence and could grant. */
function instantOf(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?Z$/.exec(s);
  if (m === null) return null;
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return null;
  // The parsed instant must RE-SERIALIZE to the same second-precision UTC calendar it
  // was given. An impossible date (2026-02-30) rolls over to a real one (Mar 2), whose
  // ISO string differs from the input — one comparison, so one fixture can falsify it.
  const canonical = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  if (new Date(ms).toISOString().slice(0, 19) !== canonical) return null;
  return ms;
}

/** The list of trimmed non-empty strings in an array, or [] for a non-array. The
 *  caller separately checks `Array.isArray` to decide malformed vs absent. */
function stringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    const t = textOf(item);
    if (t !== null) out.push(t);
  }
  return out;
}

/** An array field is malformed when ASSERTED as a non-array, OR when it is an array
 *  carrying any element that is not a non-empty string. `null`/absent = silence, not
 *  malformed; an empty array is a valid "nothing" set. A junk element (a number, an
 *  object, an empty string) is an unreadable assertion, not a silently-empty set —
 *  dropping it to `clean` would let a malformed flagged/policy list grant. */
function arrayMalformed(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (!Array.isArray(v)) return true;
  return v.some((el) => typeof el !== "string" || el.trim().length === 0);
}

const POLICY_STATES = ["applied", "not_applied", "unknown"] as const;

/**
 * Derive compliance from the flagged-reasons list. An EMPTY asserted array is the
 * plane positively saying "nothing flagged" → `clean`. A non-empty list → `flagged`.
 * Absence (the field never posed) → `unknown`, which raises. A present-but-non-array
 * is caught as malformed by the caller and also lands here as `unknown`.
 */
export function deriveComplianceState(flaggedRaw: unknown): MamComplianceState {
  if (flaggedRaw === undefined || flaggedRaw === null) return "unknown";
  if (!Array.isArray(flaggedRaw)) return "unknown";
  return stringList(flaggedRaw).length > 0 ? "flagged" : "clean";
}

/**
 * The caller's app-sensitivity classification. Unposed → `unassessed`; an unreadable
 * value ALSO → `unassessed`, because sensitivity may only ESCALATE a raise (step-up
 * → restrict) on an explicit "sensitive", never on garbage.
 */
export function deriveAppSensitivity(v: string | undefined): MamAppSensitivity {
  if (v === undefined) return "unassessed";
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (s === "sensitive") return "sensitive";
  if (s === "standard") return "standard";
  return "unassessed";
}

/**
 * The caller's MAM-applicability classification. Unposed → `unassessed` (an
 * unmanaged app is then treated as applicable, fail-closed). A posed-but-unreadable
 * value → `unknown`, which raises — a caller who tried to answer and produced
 * garbage has not affirmatively excused the app.
 */
export function deriveApplicability(v: string | undefined): MamApplicability {
  if (v === undefined) return "unassessed";
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (s === "applicable") return "applicable";
  if (s === "not_applicable") return "not_applicable";
  return "unknown";
}

/**
 * Derive how current the registration read is. The caller-posed recency shape,
 * identical in construction to `deriveChangeRecordFreshness`: a source-reported
 * instant, a caller-supplied maximum age, and a caller-supplied reference instant.
 * No clock, and no maximum age posed means the question is `unassessed`.
 */
export function deriveRegistrationFreshness(
  registrationObservedAt: string | null,
  maxRegistrationAgeSeconds: number | undefined,
  referenceTime: string | undefined,
): MamRecordFreshness {
  if (maxRegistrationAgeSeconds === undefined) return "unassessed";
  if (!Number.isFinite(maxRegistrationAgeSeconds) || maxRegistrationAgeSeconds <= 0) return "unknown";
  const observedMs = instantOf(registrationObservedAt);
  const referenceMs = instantOf(referenceTime);
  if (observedMs === null || referenceMs === null) return "unknown";
  // Tolerance 0: the reference instant is posed by the caller, not a clock, so there
  // is no second clock to skew against, and a future-dated read must stay `unknown`
  // (which raises) rather than round up to `fresh`.
  const age = ageMs(observedMs, referenceMs, 0);
  if (age === null) return "unknown";
  return age <= maxRegistrationAgeSeconds * 1000 ? "fresh" : "stale";
}

export interface AppProtectionNormalizeOptions {
  /** The caller's sensitivity classification of the app: "sensitive" | "standard".
   *  Absent = not posed (`unassessed`), which never escalates. */
  appSensitivity?: string;
  /** The caller's MAM-applicability classification: "applicable" | "not_applicable".
   *  Absent = not posed (`unassessed`, treated as applicable). */
  mamApplicability?: string;
  /** The caller's "now", as a strict ISO-8601 UTC instant — the reference the recency
   *  axis is derived against. Absent → freshness `unknown` when a max age is posed. */
  referenceTime?: string;
  /** How old a registration read the caller is willing to act on. Absent = the
   *  recency question is not posed (`unassessed`). */
  maxRegistrationAgeSeconds?: number;
  source?: string;
}

/** Normalize one managed-app registration. Defensive throughout: a missing or
 *  errored field yields the fail-safe unknown, never a fabricated positive. */
export function normalizeAppProtectionReport(
  appRef: string,
  report: AppProtectionReportRaw,
  opts: AppProtectionNormalizeOptions = {},
): NormalizedAppProtection {
  const source = opts.source ?? "app-protection-mam";
  const plain = isPlainReport(report);
  const raw: Record<string, unknown> = {};
  let readThrew = false;
  try {
    if (plain) for (const k of APP_PROTECTION_REPORT_KEYS) raw[k] = ownValue(report, k);
  } catch {
    readThrew = true;
    for (const k of APP_PROTECTION_REPORT_KEYS) raw[k] = undefined;
  }

  const policyState = oneOf<MamPolicyState>(raw["policy_state"], POLICY_STATES, "unknown");
  const complianceState = deriveComplianceState(raw["flagged_reasons"]);

  const observedRaw = raw["registration_observed_at"];
  const observedMs = instantOf(observedRaw);
  const instantShapeBad = observedRaw !== undefined && observedRaw !== null && observedMs === null;

  // A report that echoes a DIFFERENT app than the one requested is a substitution, not
  // evidence about this app — it must not be relabeled and evaluated as protected. A
  // PRESENT-but-unreadable app_ref (a number, a blank string) is likewise not proof that
  // the row is this app's, so an asserted app_ref must be a readable string naming THIS
  // app; absent is fine (the fetch binding stands).
  const appRefRaw = raw["app_ref"];
  const appRefAsserted = appRefRaw !== undefined && appRefRaw !== null;
  const reportedAppRef = textOf(appRefRaw);
  const appRefMismatch = appRefAsserted && (reportedAppRef === null || reportedAppRef !== appRef.trim());
  // The REQUESTED binding must itself name an app. A blank/whitespace `appRef` means
  // the record is not bound to any identified app, so an otherwise applied+clean report
  // must not grant `APP_PROTECTED` for an unidentified app — the appRefMismatch check
  // above cannot catch it when the source omits its optional echo. Fail closed. (Codex P1.)
  const requestAppRefBlank = appRef.trim().length === 0;
  // "applied" with no corroborating policy references is a contradiction: an applied
  // app-protection policy always names at least one policy. Fail closed on the ambiguity
  // rather than trusting the bare `applied` claim.
  const appliedWithoutPolicies = policyState === "applied" && stringList(raw["applied_policies"]).length === 0;

  const malformed =
    readThrew ||
    !plain ||
    instantShapeBad ||
    requestAppRefBlank ||
    appRefMismatch ||
    appliedWithoutPolicies ||
    arrayMalformed(raw["flagged_reasons"]) ||
    arrayMalformed(raw["applied_policies"]) ||
    hasUnrecognizedKey(report, APP_PROTECTION_REPORT_KEYS) ||
    enumMalformed(raw["policy_state"], POLICY_STATES);
  const reportIntegrity: MamReportIntegrity = malformed ? "malformed" : "clean";

  const registrationObservedAt = observedMs !== null ? (observedRaw as string).trim() : null;

  return {
    sourceSystem: "app-protection",
    appRef,
    policyState,
    complianceState,
    appSensitivity: deriveAppSensitivity(opts.appSensitivity),
    mamApplicability: deriveApplicability(opts.mamApplicability),
    registrationFreshness: deriveRegistrationFreshness(
      registrationObservedAt,
      opts.maxRegistrationAgeSeconds,
      opts.referenceTime,
    ),
    managedAppRef: textOf(raw["app_ref"]),
    appliedPolicyRefs: stringList(raw["applied_policies"]),
    flaggedReasons: stringList(raw["flagged_reasons"]),
    platform: textOf(raw["platform"]),
    registrationObservedAt,
    mamSource: textOf(raw["source_system"]),
    reportIntegrity,
    source,
  };
}

export interface AppProtectionRequest {
  appRef: string;
  token: string;
}

export type AppProtectionTransport = (req: AppProtectionRequest) => Promise<AppProtectionReportRaw>;

export interface AppProtectionConnectorConfig {
  accessToken: string;
  baseUrl: string;
  source?: string;
}

/** Read-only connector: fetches one managed-app registration and normalizes it. */
export class AppProtectionConnector {
  constructor(
    private readonly config: AppProtectionConnectorConfig,
    private readonly transport: AppProtectionTransport,
  ) {}

  async fetchNormalized(
    appRef: string,
    opts: AppProtectionNormalizeOptions = {},
  ): Promise<NormalizedAppProtection> {
    guardReadOnly("GET");
    const raw = await this.transport({ appRef, token: this.config.accessToken });
    return normalizeAppProtectionReport(appRef, raw, {
      ...opts,
      source: opts.source ?? this.config.source ?? "app-protection-mam",
    });
  }
}
