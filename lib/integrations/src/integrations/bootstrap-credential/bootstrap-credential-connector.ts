// Read-only normalization + transport for the BOOTSTRAP-CREDENTIAL connector.
//
// The source is an identity provider's record of ONE session's credential: what
// class of credential opened it, and — when that class is `bootstrap` — the
// pass's scope, one-time discipline, lifetime, and how identity was verified at
// issuance. Every operation is a read; there is no write path — SignalGrid
// never issues, revokes, or extends a credential.
//
// Defensive normalization ported from the shift-context/benchmark-selection
// connectors: IdPs are external and may emit anything in any slot, so the
// normalizer — not the compiler — makes values safe. Own-property reads only;
// malformed reports fail closed.
//
// ONE AXIS IS DERIVED RATHER THAN TRUSTED: lifetime — the reported issued_at /
// expires_at aged against a reference instant the CALLER supplies (no clock in
// the decision path), never a believed `expired: false` boolean. The class,
// scope, one-time, and issuance-verification axes are trusted allowlists — the
// IdP is the source of truth for how it minted the pass — and an unlisted
// spelling is malformed, never coerced.

import {
  BOOTSTRAP_CREDENTIAL_REPORT_KEYS,
  BootstrapCredentialConnectorError,
  type BootstrapCredentialReportRaw,
  type BootstrapReportIntegrity,
  type BootstrapScope,
  type CredentialClass,
  type IssuanceVerification,
  type LifetimeStanding,
  type NormalizedBootstrapCredential,
  type OneTimeStanding,
} from "./types";
import { createReadOnlyGuard } from "../../utils/guardReadOnly";

/** GET-only guard, mirroring the other connectors. */
export const guardReadOnly = createReadOnlyGuard(
  (method) => new BootstrapCredentialConnectorError("read_only_violation", `bootstrap-credential is read-only; refused ${method}`),
);

/** Map a string to one of `allowed`, case-insensitively; anything else → fallback.
 *  An ALLOWLIST on purpose — an unrecognized value fails to the safe unknown. */
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof v !== "string") return fallback;
  const s = v.trim().toLowerCase();
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
}

/** Did the report ASSERT something here that we could not parse? `null` counts as absent. */
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
 *  PROTOTYPE CHAIN even though value reads are own-only. */
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

/** A strict ISO-8601 UTC (Zulu) instant → epoch ms, or null. */
function instantOf(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(s)) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

const CLASSES = ["standing", "bootstrap", "unknown"] as const;
const SCOPES = ["enrollment_only", "broad", "unknown"] as const;
const ONE_TIMES = ["one_time", "reusable", "unknown"] as const;
const VERIFICATIONS = ["help_desk", "manager", "in_person", "piv_cac", "location_only", "unknown"] as const;

/**
 * Derive lifetime standing — the temporal axis. Deterministic on three
 * supplied inputs; `Date.now()` never runs here.
 *
 * - No expiry reported at all → `unbounded` — a VISIBLE policy failure
 *   ("shortest practical" was not practiced), never a default pass.
 * - Expiry reported but no reference instant, or an expiry before its own
 *   issue instant → `unknown` (posed but unanswerable / self-contradictory).
 * - Boundaries: alive through the expiry instant INCLUSIVE; expired the
 *   millisecond after. No grace allowance — an allowance is a tuned number.
 */
export function deriveLifetimeStanding(
  issuedMs: number | null,
  expiresMs: number | null,
  referenceMs: number | null,
): LifetimeStanding {
  if (expiresMs === null) return "unbounded";
  if (referenceMs === null) return "unknown";
  if (issuedMs !== null && issuedMs > expiresMs) return "unknown"; // self-contradictory — also flagged malformed
  // freshness: local-by-design — not the sighting-freshness rule — CONTAINMENT of a reference instant inside a declared window, which has no age and no skew allowance by design — a credential lifetime, not a sighting
  return referenceMs <= expiresMs ? "within_lifetime" : "expired";
}

export interface BootstrapNormalizeOptions {
  /** The caller's "now", as a strict ISO-8601 UTC instant — the reference the
   *  lifetime axis is derived against. Absent → lifetime `unknown` when an
   *  expiry was posed. */
  referenceTime?: string;
  source?: string;
}

/** Normalize one bootstrap-credential report. Defensive throughout: a missing or
 *  errored field yields the fail-safe unknown, never a fabricated positive. */
export function normalizeBootstrapReport(
  subjectRef: string,
  report: BootstrapCredentialReportRaw,
  opts: BootstrapNormalizeOptions = {},
): NormalizedBootstrapCredential {
  const source = opts.source ?? "bootstrap-credential-idp";
  const plain = isPlainReport(report);
  const raw: Record<string, unknown> = {};
  let readThrew = false;
  try {
    if (plain) for (const k of BOOTSTRAP_CREDENTIAL_REPORT_KEYS) raw[k] = ownValue(report, k);
  } catch {
    readThrew = true;
    for (const k of BOOTSTRAP_CREDENTIAL_REPORT_KEYS) raw[k] = undefined;
  }

  const credentialClass = oneOf<CredentialClass>(raw["credential_class"], CLASSES, "unknown");
  const scope = oneOf<BootstrapScope>(raw["scope"], SCOPES, "unknown");
  const oneTime = oneOf<OneTimeStanding>(raw["one_time"], ONE_TIMES, "unknown");
  const issuanceVerification = oneOf<IssuanceVerification>(raw["issuance_verification"], VERIFICATIONS, "unknown");

  const issuedRaw = raw["issued_at"];
  const expiresRaw = raw["expires_at"];
  const issuedMs = instantOf(issuedRaw);
  const expiresMs = instantOf(expiresRaw);
  const asserted = (v: unknown, ms: number | null) => v !== undefined && v !== null && ms === null;
  const instantShapeBad = asserted(issuedRaw, issuedMs) || asserted(expiresRaw, expiresMs);

  // A pass that expires before it was issued is a wire-level contradiction.
  const lifetimeContradiction = issuedMs !== null && expiresMs !== null && issuedMs > expiresMs;

  const malformed =
    readThrew ||
    !plain ||
    instantShapeBad ||
    lifetimeContradiction ||
    hasUnrecognizedKey(report, BOOTSTRAP_CREDENTIAL_REPORT_KEYS) ||
    enumMalformed(raw["credential_class"], CLASSES) ||
    enumMalformed(raw["scope"], SCOPES) ||
    enumMalformed(raw["one_time"], ONE_TIMES) ||
    enumMalformed(raw["issuance_verification"], VERIFICATIONS);
  const reportIntegrity: BootstrapReportIntegrity = malformed ? "malformed" : "clean";

  const referenceTime = textOf(opts.referenceTime);
  return {
    sourceSystem: "bootstrap-credential",
    subjectRef,
    credentialClass,
    scope,
    oneTime,
    lifetime: deriveLifetimeStanding(issuedMs, expiresMs, instantOf(opts.referenceTime)),
    issuanceVerification,
    idpSubjectRef: textOf(raw["subject_ref"]),
    issuedAt: issuedMs !== null ? (issuedRaw as string).trim() : null,
    expiresAt: expiresMs !== null ? (expiresRaw as string).trim() : null,
    referenceTime: instantOf(opts.referenceTime) !== null ? referenceTime : null,
    idpSource: textOf(raw["source_system"]),
    reportIntegrity,
    source,
  };
}

export interface BootstrapCredentialRequest {
  subjectRef: string;
  token: string;
}

export type BootstrapCredentialTransport = (req: BootstrapCredentialRequest) => Promise<BootstrapCredentialReportRaw>;

export interface BootstrapCredentialConnectorConfig {
  accessToken: string;
  baseUrl: string;
  source?: string;
}

/** Read-only connector: fetches one session's credential record and normalizes it. */
export class BootstrapCredentialConnector {
  constructor(
    private readonly config: BootstrapCredentialConnectorConfig,
    private readonly transport: BootstrapCredentialTransport,
  ) {}

  async fetchNormalized(subjectRef: string, opts: BootstrapNormalizeOptions = {}): Promise<NormalizedBootstrapCredential> {
    guardReadOnly("GET");
    const raw = await this.transport({ subjectRef, token: this.config.accessToken });
    return normalizeBootstrapReport(subjectRef, raw, {
      ...opts,
      source: opts.source ?? this.config.source ?? "bootstrap-credential-idp",
    });
  }
}
