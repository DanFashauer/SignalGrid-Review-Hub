// Read-only normalization + transport for the BENCHMARK-SELECTION connector.
//
// The source is an assessment tool's own report of ONE grading run: which benchmark
// document it used, at what version, from what content, on what platform, and how
// many rules it actually evaluated. Every operation is a read; there is no write
// path — SignalGrid never launches a scan and never re-grades a rule.
//
// Defensive normalization is ported from the policy-binding connector: assessment
// tools are external systems and may emit anything in any slot, so the normalizer —
// not the compiler — is what makes a value safe. Own-property reads only; malformed
// reports fail closed.
//
// FOUR THINGS THIS NORMALIZER DERIVES RATHER THAN TRUSTS:
//   • recognition — (title, version) looked up in the committed catalog
//   • platformMatch — the two substrate strings compared, not a boolean believed
//   • coverage — computed from integer counts that must reconcile to their own total
//   • recency — the run's own timestamp aged against the operator's stated bound,
//     at a reference instant the CALLER supplies (no clock in the decision path)

import { loadBenchmarkCatalog, versionGreater, type BenchmarkCatalog } from "./catalog";
import { createReadOnlyGuard } from "../../utils/guardReadOnly";
import {
  BENCHMARK_SELECTION_REPORT_KEYS,
  BenchmarkSelectionConnectorError,
  type AssessmentCoverage,
  type AssessmentRecency,
  type BenchmarkAlignment,
  type BenchmarkProvenance,
  type BenchmarkRequirement,
  type BenchmarkSelectionReportRaw,
  type CatalogRecognition,
  type NormalizedBenchmarkSelection,
  type PlatformMatch,
  type ReportIntegrity,
  type RequirementFit,
  type RuleCounts,
} from "./types";

/** GET-only guard, mirroring the other connectors. */
export const guardReadOnly = createReadOnlyGuard(
  (method) => new BenchmarkSelectionConnectorError("read_only_violation", `benchmark-selection is read-only; refused ${method}`),
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

/** A non-negative safe integer, or null. A float, a numeric STRING, a negative, NaN
 *  and an absent key all yield null — absent is unknown, never zero. */
function countOf(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) return null;
  return v;
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

/** A trimmed non-empty string, or null. Never a fabricated placeholder. */
function textOf(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
}

const PROVENANCES = ["cis_published", "independent_implementation", "tool_declared", "unknown"] as const;
const ALIGNMENTS = ["aligned", "partially_aligned", "drifted", "not_assessed", "unknown"] as const;

/**
 * Compare two platform substrate strings.
 *
 * Deliberately conservative: equality after case-folding and whitespace collapse.
 * No fuzzy matching, no "macOS 15 is probably Sequoia" inference — that inference is
 * precisely the invented judgement this dimension refuses to make. A vendor pair
 * that differs only in formatting matches; anything else is a mismatch a human can
 * see and the requirement row can fix.
 */
function comparePlatforms(target: string | null, observed: string | null): PlatformMatch {
  if (target === null || observed === null) return "unknown";
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  return norm(target) === norm(observed) ? "matched" : "mismatched";
}

/**
 * Derive coverage from the counts.
 *
 * THE ACCOUNTING IDENTITY IS A PARSE GATE, NOT A THRESHOLD:
 *   passed + failed + notApplicable + error + notChecked === total
 * A report whose buckets do not reconcile to its own denominator contradicts itself.
 * Because it is an identity, no number had to be chosen — the first draft of this
 * dimension collected `rules_total` and never read it, so a run that evaluated 3 of
 * 400 rules graded `complete` and granted. That is the defect this dimension exists
 * to withdraw, reproduced inside the dimension itself.
 *
 * `notApplicable` is excluded from the numerator: a run that found 98% of a
 * benchmark inapplicable evaluated almost nothing.
 */
export function deriveCoverage(counts: RuleCounts): AssessmentCoverage {
  const { total, passed, failed, notApplicable, error, notChecked } = counts;
  if (total === null || passed === null || failed === null || notApplicable === null || error === null || notChecked === null) {
    return "ungraded";
  }
  if (passed + failed + notApplicable + error + notChecked !== total) return "ungraded";
  const evaluated = passed + failed;
  if (evaluated === 0) return "empty";
  if (error > 0 || notChecked > 0) return "partial";
  // Every rule accounted for, at least one evaluated, nothing errored or skipped.
  return "complete";
}

/**
 * Look the citation up in the committed catalog.
 *
 * TITLE is the identity. A version that is a listed row but not the highest for its
 * title is `version_superseded` — the catalog genuinely carries 7 such rows.
 */
export function deriveRecognition(catalog: BenchmarkCatalog, title: string | null, version: string | null): CatalogRecognition {
  if (title === null || version === null) return "unknown";
  const versions = catalog.versionsFor(title);
  if (versions.size === 0) return "not_in_catalog";
  if (!versions.has(version)) return "version_unlisted";
  const highest = catalog.highestVersionFor(title);
  if (highest !== null && versionGreater(highest, version)) return "version_superseded";
  return "recognized";
}

/**
 * Grade the citation against the workflow's requirement.
 *
 * The requirement is caller-supplied. `undefined` means nobody stated a bar
 * (`unrequired` — a hole). An EMPTY or unreadable list is `unknown`, never "anything
 * goes": a vacuous requirement must not be the cheapest route to a grant.
 */
export function deriveRequirementFit(requirement: BenchmarkRequirement | undefined, title: string | null): RequirementFit {
  if (requirement === undefined) return "unrequired";
  const titles = requirement.requiredTitles;
  if (!Array.isArray(titles) || titles.length === 0) return "unknown";
  if (titles.some((t) => typeof t !== "string" || t.trim().length === 0)) return "unknown";
  if (title === null) return "unknown";
  return titles.some((t) => t.trim() === title) ? "on_requirement" : "off_requirement";
}

const MS_PER_DAY = 86_400_000;

/**
 * Derive recency — the TEMPORAL axis. Deterministic on three supplied inputs: the
 * assessor reports when the run happened, the operator's requirement states how
 * old is too old, and the caller supplies the reference instant. `Date.now()`
 * never runs here.
 *
 * A FUTURE-dated run (age < 0) is `unknown`, never `current`: a run claiming to
 * postdate the reference instant has an age this fabric cannot establish, and an
 * unestablishable age must not read as fresh. No skew allowance exists on
 * purpose — an allowance is a tuned number, and this fabric does not tune.
 */
export function deriveRecency(
  requirement: BenchmarkRequirement | undefined,
  assessmentMs: number | null,
  referenceMs: number | null,
): AssessmentRecency {
  if (requirement === undefined) return "unbounded";
  const bound = requirement.maxAssessmentAgeDays;
  if (bound === undefined) return "unbounded";
  if (typeof bound !== "number" || !Number.isFinite(bound) || bound <= 0) return "unknown";
  if (assessmentMs === null || referenceMs === null) return "unknown";
  const ageMs = referenceMs - assessmentMs;
  if (ageMs < 0) return "unknown";
  return ageMs <= bound * MS_PER_DAY ? "current" : "stale";
}

export interface NormalizeOptions {
  /** The workflow's requirement. Absent = nobody stated a bar. */
  requirement?: BenchmarkRequirement;
  /** Catalog override, for proofs and negative controls. */
  catalog?: BenchmarkCatalog;
  /** The caller's "now", as a strict ISO-8601 UTC instant — the reference the
   *  recency axis ages against. Absent while a bound is stated → recency
   *  `unknown` (never silently current). */
  referenceTime?: string;
  source?: string;
}

/** Normalize one benchmark-selection report. Defensive throughout: a missing or
 *  errored field yields the fail-safe unknown, never a fabricated positive. */
export function normalizeReport(
  deviceRef: string,
  report: BenchmarkSelectionReportRaw,
  opts: NormalizeOptions = {},
): NormalizedBenchmarkSelection {
  const catalog = opts.catalog ?? loadBenchmarkCatalog();
  const source = opts.source ?? "benchmark-selection-assessor";
  const plain = isPlainReport(report);
  const raw: Record<string, unknown> = {};
  let readThrew = false;
  try {
    if (plain) for (const k of BENCHMARK_SELECTION_REPORT_KEYS) raw[k] = ownValue(report, k);
  } catch {
    readThrew = true;
    for (const k of BENCHMARK_SELECTION_REPORT_KEYS) raw[k] = undefined;
  }

  const citedTitle = textOf(raw["benchmark_title"]);
  const citedVersion = textOf(raw["benchmark_version"]);
  const provenance = oneOf<BenchmarkProvenance>(raw["source_provenance"], PROVENANCES, "unknown");
  const alignment = oneOf<BenchmarkAlignment>(raw["alignment"], ALIGNMENTS, "unknown");
  const benchmarkTargetPlatform = textOf(raw["benchmark_target_platform"]);
  const observedPlatform = textOf(raw["observed_platform"]);

  const counts: RuleCounts = {
    total: countOf(raw["rules_total"]),
    passed: countOf(raw["rules_passed"]),
    failed: countOf(raw["rules_failed"]),
    notApplicable: countOf(raw["rules_not_applicable"]),
    error: countOf(raw["rules_error"]),
    notChecked: countOf(raw["rules_not_checked"]),
  };

  // A version asserted in a shape the catalog could never carry is a wire-level
  // contradiction, not merely an unknown — the same self-contradiction rule as
  // app-update's min_version > latest_version manifest.
  const versionShapeBad = citedVersion !== null && !/^\d+\.\d+\.\d+$/.test(citedVersion);

  // An ASSERTED run time we could not read is an assertion, not silence — same
  // rule as an unlisted provenance spelling.
  const assessmentTimeRaw = raw["assessment_time"];
  const assessmentMs = instantOf(assessmentTimeRaw);
  const timeShapeBad = assessmentTimeRaw !== undefined && assessmentTimeRaw !== null && assessmentMs === null;

  const malformed =
    readThrew ||
    !plain ||
    versionShapeBad ||
    timeShapeBad ||
    hasUnrecognizedKey(report, BENCHMARK_SELECTION_REPORT_KEYS) ||
    enumMalformed(raw["source_provenance"], PROVENANCES) ||
    enumMalformed(raw["alignment"], ALIGNMENTS);
  const reportIntegrity: ReportIntegrity = malformed ? "malformed" : "clean";

  // A MALFORMED VERSION MUST NOT ERASE THE TITLE FINDING, and it used to.
  //
  // This line read `versionShapeBad ? "unknown" : deriveRecognition(...)`, which
  // skipped the catalog lookup entirely whenever the cited version was not a
  // numeric triple. But `not_in_catalog` falls out of `versions.size === 0` — a
  // TITLE-only test that never consults the version. So a report citing a title
  // the catalog does not carry AND an unparseable version lost the title finding
  // and graded `unknown`, dropping the recommended action from `alert` to
  // `step_up` and deleting `benchmark_not_in_catalog` from the evidence.
  //
  // Adding a second defect to a report made the answer softer. That is the
  // fail-closed doctrine inverted, and it was measured rather than reasoned:
  // version "9.9.9" gave alert/BENCHMARK_NOT_IN_CATALOG, version "3.0" on the
  // same report gave step_up/REPORT_MALFORMED.
  //
  // Now the title lookup always runs. When the version is unreadable we keep a
  // title verdict that does not depend on it — `not_in_catalog` — and otherwise
  // fall back to `unknown`, because a version we could not parse cannot support
  // `version_unlisted` or `version_superseded`, both of which assert something
  // about the version itself. `reportIntegrity` goes `malformed` independently,
  // so the malformedness is still reported; it is no longer reported INSTEAD of
  // the title finding.
  const titleRecognition = deriveRecognition(catalog, citedTitle, citedVersion);
  const recognition = versionShapeBad
    ? (titleRecognition === "not_in_catalog" ? "not_in_catalog" : "unknown")
    : titleRecognition;
  const row = citedTitle !== null && citedVersion !== null ? catalog.rowFor(citedTitle, citedVersion) : null;

  return {
    sourceSystem: "benchmark-selection",
    deviceRef,
    recognition,
    provenance,
    platformMatch: comparePlatforms(benchmarkTargetPlatform, observedPlatform),
    coverage: deriveCoverage(counts),
    requirementFit: deriveRequirementFit(opts.requirement, citedTitle),
    recency: deriveRecency(opts.requirement, assessmentMs, instantOf(opts.referenceTime)),
    alignment,
    citedTitle,
    citedVersion,
    // DERIVED from the matched catalog row — a report cannot assert its own filing.
    catalogFamily: row?.family ?? null,
    catalogSection: row?.section ?? null,
    assessmentTool: textOf(raw["assessment_tool"]),
    toolVersion: textOf(raw["tool_version"]),
    benchmarkTargetPlatform,
    observedPlatform,
    profileOrLevel: textOf(raw["profile_or_level"]),
    // Carried ONLY when it parsed as an instant — an unreadable claim is null.
    assessmentTime: assessmentMs !== null ? (assessmentTimeRaw as string).trim() : null,
    controlId: textOf(raw["control_id"]),
    evidenceReference: textOf(raw["evidence_reference"]),
    counts,
    reportIntegrity,
    source,
  };
}

export interface BenchmarkSelectionRequest {
  deviceRef: string;
  token: string;
}

export type BenchmarkSelectionTransport = (req: BenchmarkSelectionRequest) => Promise<BenchmarkSelectionReportRaw>;

export interface BenchmarkSelectionConnectorConfig {
  accessToken: string;
  baseUrl: string;
  source?: string;
}

/** Read-only connector: fetches one device's latest assessment record and
 *  normalizes it. */
export class BenchmarkSelectionConnector {
  constructor(
    private readonly config: BenchmarkSelectionConnectorConfig,
    private readonly transport: BenchmarkSelectionTransport,
  ) {}

  async fetchNormalized(
    deviceRef: string,
    requirement?: BenchmarkRequirement,
    referenceTime?: string,
  ): Promise<NormalizedBenchmarkSelection> {
    guardReadOnly("GET");
    const raw = await this.transport({ deviceRef, token: this.config.accessToken });
    return normalizeReport(deviceRef, raw, { requirement, referenceTime, source: this.config.source ?? "benchmark-selection-assessor" });
  }
}
