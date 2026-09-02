// Read-only normalization + transport for the SHIFT-CONTEXT connector.
//
// The source is a workforce-management system's record of ONE worker at one
// instant: their punch status, the shift window that applies, and where that shift
// places them. Every operation is a read; there is no write path — SignalGrid
// never punches anyone in or out, never edits a schedule, never touches pay.
//
// Defensive normalization ported from the policy-binding/benchmark-selection
// connectors: WFM systems are external and may emit anything in any slot, so the
// normalizer — not the compiler — makes values safe. Own-property reads only;
// malformed reports fail closed.
//
// TWO THINGS THIS NORMALIZER DERIVES RATHER THAN TRUSTS:
//   • scheduleStanding — the reported shift window aged against a reference
//     instant the CALLER supplies (no clock in the decision path), never a
//     believed `on_shift: true` boolean
//   • siteMatch — two site strings compared by case/whitespace fold, only when
//     the caller poses the question by supplying the device's site
// The one TRUSTED axis is the punch enum — the WFM is the source of truth for
// punches — and an unlisted spelling is malformed, never coerced.

import {
  SHIFT_CONTEXT_REPORT_KEYS,
  ShiftContextConnectorError,
  type NormalizedShiftContext,
  type PunchStatus,
  type ScheduleStanding,
  type ShiftContextReportRaw,
  type ShiftReportIntegrity,
  type SiteMatch,
} from "./types";
import { createReadOnlyGuard } from "../../utils/guardReadOnly";

/** GET-only guard, mirroring the other connectors. */
export const guardReadOnly = createReadOnlyGuard(
  (method) => new ShiftContextConnectorError("read_only_violation", `shift-context is read-only; refused ${method}`),
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

const PUNCHES = ["clocked_in", "on_break", "clocked_out", "unknown"] as const;

/**
 * Derive schedule standing — the temporal axis. Deterministic on three supplied
 * inputs: the WFM reports the shift window, and the caller supplies the reference
 * instant. `Date.now()` never runs here.
 *
 * The window boundaries are INCLUSIVE on both ends, and there is deliberately no
 * grace allowance around them — an allowance is a tuned number, and this fabric
 * does not tune. A worker one minute early reads `off_shift` + their punch, which
 * lands on the non-blocking `schedule_deviation` rung, not a refusal.
 */
export function deriveScheduleStanding(
  shiftStartMs: number | null,
  shiftEndMs: number | null,
  referenceMs: number | null,
): ScheduleStanding {
  if (shiftStartMs === null || shiftEndMs === null || referenceMs === null) return "unknown";
  if (shiftStartMs > shiftEndMs) return "unknown"; // self-contradictory window — also flagged malformed
  // freshness: local-by-design — not the sighting-freshness rule — CONTAINMENT of a reference instant inside a declared window, which has no age and no skew allowance by design — a rostered shift, not a sighting
  return referenceMs >= shiftStartMs && referenceMs <= shiftEndMs ? "on_shift" : "off_shift";
}

/**
 * Compare the shift's scheduled site against the device's site.
 *
 * The CALLER poses the question by supplying `deviceSite`; unposed → `unassessed`
 * (carried, visible, does not foreclose the grant — nobody claimed a match). A
 * POSED question the WFM cannot answer is `unknown` and raises. Deliberately
 * conservative matching: equality after case-folding and whitespace collapse — no
 * geo inference, no site-name aliasing. A pair that differs beyond formatting is a
 * mismatch a human can see and the schedule row can fix.
 */
export function compareSites(scheduledSite: string | null, deviceSite: string | null): SiteMatch {
  if (deviceSite === null) return "unassessed";
  if (scheduledSite === null) return "unknown";
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  return norm(scheduledSite) === norm(deviceSite) ? "matched" : "mismatched";
}

export interface ShiftNormalizeOptions {
  /** The site the device is operating at. Absent = the site question is not posed
   *  (`unassessed`), never a silent match. */
  deviceSite?: string;
  /** The caller's "now", as a strict ISO-8601 UTC instant — the reference the
   *  schedule axis is derived against. Absent → standing `unknown`. */
  referenceTime?: string;
  source?: string;
}

/** Normalize one shift-context report. Defensive throughout: a missing or errored
 *  field yields the fail-safe unknown, never a fabricated positive. */
export function normalizeShiftReport(
  workerRef: string,
  report: ShiftContextReportRaw,
  opts: ShiftNormalizeOptions = {},
): NormalizedShiftContext {
  const source = opts.source ?? "shift-context-wfm";
  const plain = isPlainReport(report);
  const raw: Record<string, unknown> = {};
  let readThrew = false;
  try {
    if (plain) for (const k of SHIFT_CONTEXT_REPORT_KEYS) raw[k] = ownValue(report, k);
  } catch {
    readThrew = true;
    for (const k of SHIFT_CONTEXT_REPORT_KEYS) raw[k] = undefined;
  }

  const punchStatus = oneOf<PunchStatus>(raw["punch_status"], PUNCHES, "unknown");
  const scheduledSite = textOf(raw["scheduled_site"]);
  const deviceSite = textOf(opts.deviceSite);

  // An ASSERTED instant we could not read is an assertion, not silence.
  const startRaw = raw["shift_start"];
  const endRaw = raw["shift_end"];
  const punchTimeRaw = raw["last_punch_time"];
  const startMs = instantOf(startRaw);
  const endMs = instantOf(endRaw);
  const punchTimeMs = instantOf(punchTimeRaw);
  const asserted = (v: unknown, ms: number | null) => v !== undefined && v !== null && ms === null;
  const instantShapeBad = asserted(startRaw, startMs) || asserted(endRaw, endMs) || asserted(punchTimeRaw, punchTimeMs);

  // A window that ends before it starts is a wire-level contradiction, not merely
  // an unknown — the same self-contradiction rule as benchmark-selection's
  // non-triple version string.
  const windowContradiction = startMs !== null && endMs !== null && startMs > endMs;

  const malformed =
    readThrew ||
    !plain ||
    instantShapeBad ||
    windowContradiction ||
    hasUnrecognizedKey(report, SHIFT_CONTEXT_REPORT_KEYS) ||
    enumMalformed(raw["punch_status"], PUNCHES);
  const reportIntegrity: ShiftReportIntegrity = malformed ? "malformed" : "clean";

  return {
    sourceSystem: "shift-context",
    workerRef,
    scheduleStanding: deriveScheduleStanding(startMs, endMs, instantOf(opts.referenceTime)),
    punchStatus,
    siteMatch: compareSites(scheduledSite, deviceSite),
    wfmWorkerRef: textOf(raw["worker_ref"]),
    // Carried ONLY when they parsed as instants — an unreadable claim is null.
    shiftStart: startMs !== null ? (startRaw as string).trim() : null,
    shiftEnd: endMs !== null ? (endRaw as string).trim() : null,
    scheduledSite,
    deviceSite,
    scheduledRole: textOf(raw["scheduled_role"]),
    lastPunchTime: punchTimeMs !== null ? (punchTimeRaw as string).trim() : null,
    wfmSource: textOf(raw["source_system"]),
    reportIntegrity,
    source,
  };
}

export interface ShiftContextRequest {
  workerRef: string;
  token: string;
}

export type ShiftContextTransport = (req: ShiftContextRequest) => Promise<ShiftContextReportRaw>;

export interface ShiftContextConnectorConfig {
  accessToken: string;
  baseUrl: string;
  source?: string;
}

/** Read-only connector: fetches one worker's current labor record and normalizes it. */
export class ShiftContextConnector {
  constructor(
    private readonly config: ShiftContextConnectorConfig,
    private readonly transport: ShiftContextTransport,
  ) {}

  async fetchNormalized(workerRef: string, opts: ShiftNormalizeOptions = {}): Promise<NormalizedShiftContext> {
    guardReadOnly("GET");
    const raw = await this.transport({ workerRef, token: this.config.accessToken });
    return normalizeShiftReport(workerRef, raw, { ...opts, source: opts.source ?? this.config.source ?? "shift-context-wfm" });
  }
}
