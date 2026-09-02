// Read-only normalization + transport for the CHANGE-WINDOW connector.
//
// The source is an ITSM change record at one instant: its approval state, the
// window it authorizes, who it names as implementer, and when the record was read.
// Every operation is a read; there is no write path — SignalGrid never creates,
// approves, schedules, closes or cancels a change.
//
// Defensive normalization ported from the shift-context / access-governance
// connectors: ITSM platforms are external and may emit anything in any slot, so the
// normalizer — not the compiler — makes values safe. Own-property reads only;
// malformed reports fail closed.
//
// THREE THINGS THIS NORMALIZER DERIVES RATHER THAN TRUSTS:
//   • windowStanding — the record's authorized window compared against a reference
//     instant the CALLER supplies (no clock in the decision path), never a believed
//     `in_window: true` boolean
//   • actorAuthorization — two actor strings compared by case/whitespace fold, only
//     when the caller poses the question by supplying the operating actor
//   • recordFreshness — a source-reported read instant against a caller-supplied
//     maximum age and reference instant
// The one TRUSTED axis is the change-state enum — the ITSM is the system of record
// for whether a change was approved — and an unlisted spelling is malformed, never
// coerced.

import { ageMs } from "../../utils/freshness";
import {
  CHANGE_WINDOW_REPORT_KEYS,
  ChangeWindowConnectorError,
  type ChangeActorAuthorization,
  type ChangeApprovalState,
  type ChangeRecordFreshness,
  type ChangeReportIntegrity,
  type ChangeWindowReportRaw,
  type ChangeWindowStanding,
  type NormalizedChangeWindow,
} from "./types";
import { createReadOnlyGuard } from "../../utils/guardReadOnly";

/** GET-only guard, mirroring the other connectors. */
export const guardReadOnly = createReadOnlyGuard(
  (method) => new ChangeWindowConnectorError("read_only_violation", `change-window is read-only; refused ${method}`),
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
  // The Object.prototype exclusion is load-bearing: passing Object.prototype itself
  // would let POLLUTED prototype fields read as own assertions on a "plain" object.
  return typeof report === "object" && report !== null && !Array.isArray(report) && report !== Object.prototype;
}

const MAX_PROTOTYPE_DEPTH = 64;

/** Does the report carry any key this connector does not understand? Walks the
 *  PROTOTYPE CHAIN even though value reads are own-only: an inherited assertion in
 *  a spelling we ignore is still an assertion. A symbol key counts; a class
 *  instance fails closed. */
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

/** A strict ISO-8601 UTC (Zulu) instant → epoch ms, or null. A local-time string,
 *  a bare date, an epoch number, junk — all null: an instant this fabric compares
 *  must be unambiguous, and only the Zulu form is. */
function instantOf(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(s)) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

const CHANGE_STATES = ["approved", "pending_approval", "rejected", "cancelled", "closed", "unknown"] as const;

/**
 * Derive window standing — the temporal axis. Deterministic on three supplied
 * inputs: the ITSM reports the window bounds, the caller supplies the reference
 * instant. `Date.now()` never runs here.
 *
 * Both bounds are INCLUSIVE, and there is deliberately no grace allowance around
 * them — an allowance is a tuned number, and this fabric does not tune. An operator
 * one minute early reads `outside`, which lands on a step-up they can answer, not a
 * refusal.
 */
export function deriveChangeWindowStanding(
  windowStartMs: number | null,
  windowEndMs: number | null,
  referenceMs: number | null,
): ChangeWindowStanding {
  if (windowStartMs === null || windowEndMs === null || referenceMs === null) return "unknown";
  if (windowStartMs > windowEndMs) return "unknown"; // self-contradictory window — also flagged malformed
  // freshness: local-by-design — not the sighting-freshness rule — CONTAINMENT of a reference instant inside a declared window, which has no age and no skew allowance by design — a change window, not a sighting. This file imports the helper for the freshness it does derive; that import does not and must not exempt this line.
  return referenceMs >= windowStartMs && referenceMs <= windowEndMs ? "inside" : "outside";
}

/**
 * Compare the record's named implementer against the actor operating the device.
 *
 * The CALLER poses the question by supplying `operatingActorRef`; unposed →
 * `unassessed` (carried, visible, does not foreclose the grant — nobody claimed a
 * match). A POSED question the ITSM cannot answer is `unknown` and raises.
 * Deliberately conservative matching: equality after case-folding and whitespace
 * collapse — no directory lookup, no "J. Smith is probably jsmith". A pair that
 * differs beyond formatting is a mismatch a human can see and the change record can
 * fix.
 */
export function compareChangeActors(
  authorizedActorRef: string | null,
  operatingActorRef: string | null,
): ChangeActorAuthorization {
  if (operatingActorRef === null) return "unassessed";
  if (authorizedActorRef === null) return "unknown";
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  return norm(authorizedActorRef) === norm(operatingActorRef) ? "authorized" : "unauthorized";
}

/**
 * Derive how current the change-record read is. The caller-posed recency shape,
 * identical in construction to `deriveGovernanceReadFreshness`: a source-reported
 * instant, a caller-supplied maximum age, and a caller-supplied reference instant.
 * No clock, and no maximum age posed means the question is `unassessed` rather than
 * silently satisfied.
 */
export function deriveChangeRecordFreshness(
  recordObservedAt: string | null,
  maxChangeRecordAgeSeconds: number | undefined,
  referenceTime: string | undefined,
): ChangeRecordFreshness {
  if (maxChangeRecordAgeSeconds === undefined) return "unassessed";
  // Number.isFinite coerces nothing, so it alone rejects every non-number a
  // loosely-typed caller can pose (strings, NaN, ±Infinity, objects).
  if (!Number.isFinite(maxChangeRecordAgeSeconds) || maxChangeRecordAgeSeconds <= 0) return "unknown";
  const observedMs = instantOf(recordObservedAt);
  const referenceMs = instantOf(referenceTime);
  if (observedMs === null || referenceMs === null) return "unknown";
  // A read timestamped after the caller's own reference instant is a contradiction,
  // not a very fresh read.
  // Tolerance 0, NOT the shared FUTURE_SKEW_TOLERANCE_MS: this family's reference
  // instant is POSED BY THE CALLER, not read from a clock, so there is no second
  // clock to skew against — and widening to 60s would turn a future-dated read from
  // `unknown` (which RAISES here) into `fresh`. A fold must never lower a verdict.
  const age = ageMs(observedMs, referenceMs, 0);
  if (age === null) return "unknown";
  return age <= maxChangeRecordAgeSeconds * 1000 ? "fresh" : "stale";
}

export interface ChangeWindowNormalizeOptions {
  /** The actor operating the device. Absent = the implementer question is not posed
   *  (`unassessed`), never a silent match. */
  operatingActorRef?: string;
  /** The caller's "now", as a strict ISO-8601 UTC instant — the reference both the
   *  window axis and the recency axis are derived against. Absent → standing
   *  `unknown`. */
  referenceTime?: string;
  /** How old a change-record read the caller is willing to act on. Absent = the
   *  recency question is not posed (`unassessed`). */
  maxChangeRecordAgeSeconds?: number;
  source?: string;
}

/** Normalize one change record. Defensive throughout: a missing or errored field
 *  yields the fail-safe unknown, never a fabricated positive. */
export function normalizeChangeReport(
  changeRef: string,
  report: ChangeWindowReportRaw,
  opts: ChangeWindowNormalizeOptions = {},
): NormalizedChangeWindow {
  const source = opts.source ?? "change-window-itsm";
  const plain = isPlainReport(report);
  const raw: Record<string, unknown> = {};
  let readThrew = false;
  try {
    if (plain) for (const k of CHANGE_WINDOW_REPORT_KEYS) raw[k] = ownValue(report, k);
  } catch {
    readThrew = true;
    for (const k of CHANGE_WINDOW_REPORT_KEYS) raw[k] = undefined;
  }

  const approvalState = oneOf<ChangeApprovalState>(raw["change_state"], CHANGE_STATES, "unknown");
  const authorizedActorRef = textOf(raw["authorized_actor_ref"]);
  const operatingActorRef = textOf(opts.operatingActorRef);

  // An ASSERTED instant we could not read is an assertion, not silence.
  const startRaw = raw["window_start"];
  const endRaw = raw["window_end"];
  const observedRaw = raw["record_observed_at"];
  const startMs = instantOf(startRaw);
  const endMs = instantOf(endRaw);
  const observedMs = instantOf(observedRaw);
  const asserted = (v: unknown, ms: number | null) => v !== undefined && v !== null && ms === null;
  const instantShapeBad =
    asserted(startRaw, startMs) || asserted(endRaw, endMs) || asserted(observedRaw, observedMs);

  // A window that closes before it opens is a wire-level contradiction, not merely
  // an unknown — the same self-contradiction rule as shift-context's shift window.
  const windowContradiction = startMs !== null && endMs !== null && startMs > endMs;

  const malformed =
    readThrew ||
    !plain ||
    instantShapeBad ||
    windowContradiction ||
    hasUnrecognizedKey(report, CHANGE_WINDOW_REPORT_KEYS) ||
    enumMalformed(raw["change_state"], CHANGE_STATES);
  const reportIntegrity: ChangeReportIntegrity = malformed ? "malformed" : "clean";

  const recordObservedAt = observedMs !== null ? (observedRaw as string).trim() : null;

  return {
    sourceSystem: "change-window",
    changeRef,
    windowStanding: deriveChangeWindowStanding(startMs, endMs, instantOf(opts.referenceTime)),
    approvalState,
    actorAuthorization: compareChangeActors(authorizedActorRef, operatingActorRef),
    recordFreshness: deriveChangeRecordFreshness(
      recordObservedAt,
      opts.maxChangeRecordAgeSeconds,
      opts.referenceTime,
    ),
    itsmChangeRef: textOf(raw["change_ref"]),
    // Carried ONLY when they parsed as instants — an unreadable claim is null.
    windowStart: startMs !== null ? (startRaw as string).trim() : null,
    windowEnd: endMs !== null ? (endRaw as string).trim() : null,
    authorizedActorRef,
    operatingActorRef,
    changeClass: textOf(raw["change_class"]),
    recordObservedAt,
    itsmSource: textOf(raw["source_system"]),
    reportIntegrity,
    source,
  };
}

export interface ChangeWindowRequest {
  changeRef: string;
  token: string;
}

export type ChangeWindowTransport = (req: ChangeWindowRequest) => Promise<ChangeWindowReportRaw>;

export interface ChangeWindowConnectorConfig {
  accessToken: string;
  baseUrl: string;
  source?: string;
}

/** Read-only connector: fetches one change record and normalizes it. */
export class ChangeWindowConnector {
  constructor(
    private readonly config: ChangeWindowConnectorConfig,
    private readonly transport: ChangeWindowTransport,
  ) {}

  async fetchNormalized(
    changeRef: string,
    opts: ChangeWindowNormalizeOptions = {},
  ): Promise<NormalizedChangeWindow> {
    guardReadOnly("GET");
    const raw = await this.transport({ changeRef, token: this.config.accessToken });
    return normalizeChangeReport(changeRef, raw, {
      ...opts,
      source: opts.source ?? this.config.source ?? "change-window-itsm",
    });
  }
}
