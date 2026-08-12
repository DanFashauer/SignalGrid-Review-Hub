// Types for the read-only BENCHMARK-SELECTION dimension — WHICH benchmark was this
// device graded against, from what content, covering how much of it?
//
// Origin: the fabric already consumes a baseline-alignment result
// (`BaselineState = aligned | partial | drifted | not_assessed | unknown`,
// lib/signalgrid-core/src/types.ts:183). That axis records the ANSWER and nothing
// about the QUESTION. A device running macOS 26 Tahoe graded against "Apple macOS
// 12.0 Monterey" v4.0.0 reports `aligned`, and every surface downstream reads that
// as a hardened device. The bar was wrong, so the answer means nothing, and nothing
// in the fabric could see it.
//
// That is this fabric's recurring defect — the UNEARNED AFFIRMATIVE — in the
// hardening plane. This dimension withdraws it on six independent questions:
//
//   1. IDENTITY + CURRENCY. Is the cited (title, version) an actual row of the
//      published catalog, and is it the highest version listed for that title?
//   2. PROVENANCE. Did the grading consume CIS's OWN published content, a named
//      third-party implementation of CIS-aligned checks, or does the tool merely
//      LABEL its checks "CIS"? Three different claims; only the first is official
//      content, and a label is not a provenance.
//   3. PLATFORM. Does the platform the benchmark DOCUMENT targets match the
//      platform the tool actually READ off the device? Two substrate strings, both
//      reported by the assessor, compared here — not a boolean we have to trust.
//   4. COVERAGE. A pass is only as good as its denominator. The rule counts must
//      reconcile to the stated total, and 3 rules out of 400 is not a clean bill.
//   5. REQUIREMENT. Is this the benchmark the WORKFLOW demands? A shared clinical
//      iPad in a kiosk workflow, a BYOD phone, a warehouse scanner and an OT
//      controller do not share a bar, so the operator supplies the allowlist and
//      the fabric grades membership. The fabric never invents which bar is right.
//   6. RECENCY. Is the answer still current? An assessment is a statement about
//      the device at the moment it ran — it does not age into permanence. The
//      operator's requirement may bound its age; a run older than that bound
//      cannot confirm anything today. The bound, the run time and the reference
//      instant are all supplied — no clock ticks inside the decision path.
//
// NAMING IS DELIBERATE. Nothing here is called "fit", "compliant", or "conformant".
// `selectionConfirmed` means "this was the right document, honestly sourced, and
// adequately covered". It says NOTHING about whether the device passed — that is
// `alignment`, which is carried and deliberately kept OUT of the grant. The honest
// and useful pair is `requirement_matched` alongside `drifted`.
//
// WHAT THIS DIMENSION DOES NOT DO. No scan is performed, no rule is re-graded, no
// benchmark content is read. SignalGrid consumes an assessment somebody else
// performed and grades its SHAPE and PROVENANCE.
//
// LICENSING BOUNDARY (hard). The committed catalog carries benchmark TITLES and
// VERSION strings and the family/section they are filed under — factual catalog
// metadata. CIS benchmark rule content is licensed and is not reproduced anywhere
// in this repository. No CIS certification, conformance, or partnership is claimed.

/** Which page of the published catalog a row is filed under. PRESENTATION ONLY —
 *  carried as evidence, never part of identity. The catalog files "Microsoft
 *  Windows Server 2019 STIG" v3.0.0 under the base section and its successor
 *  v4.0.0 under the DISA STIG section, so keying identity on the bucket would
 *  report the superseded row as current. (Measured: doing so hides 3 of the 7
 *  superseded rows.) */
export type CatalogSection = "current" | "disa_stig";

/**
 * Is the cited benchmark a real, current catalog row?
 *
 * TITLE is the identity; version standing is computed per title. In the committed
 * snapshot: 454 rows, 447 distinct titles, 7 titles carrying more than one version,
 * so 447 rows are the highest for their title and 7 are superseded.
 */
export type CatalogRecognition =
  | "recognized" // (title, version) is a catalog row AND the highest version listed for that title
  | "version_superseded" // a real row, but the catalog lists a higher version for this title
  | "version_unlisted" // the title is in the catalog; this version is not a listed row
  | "not_in_catalog" // an affirmative citation the snapshot does not carry at all
  | "unknown"; // nothing citable was asserted, or it was unreadable

/**
 * Where the graded CONTENT came from.
 *
 * SignalGrid must not represent a third-party implementation as official CIS
 * content, and must not infer compliance because a tool labels its checks "CIS".
 * `independent_implementation` is not an accusation — kube-bench, Prowler,
 * ComplianceAsCode, macos_security, ansible-lockdown and steampipe are how most
 * fleets actually assess, and they do real work. It is a different claim from
 * "CIS's published content said so", and the verdict records which one happened.
 */
export type BenchmarkProvenance =
  | "cis_published" // the assessment consumed CIS's own published benchmark content
  | "independent_implementation" // a named third-party implementation of CIS-aligned checks
  | "tool_declared" // the tool calls its checks "CIS" and names no content source
  | "unknown";

/**
 * Does the benchmark DOCUMENT target the platform the tool actually read?
 *
 * DERIVED by comparing two strings the assessor itself reports: the platform the
 * benchmark declares (XCCDF `<platform>`, a CPE, the product line the document
 * covers) against the platform the tool observed on the device. Deriving it beats
 * the boolean the first draft of this dimension had: an `applicable: true` field is
 * a bare claim, and the sources that emit no such field would have had callers
 * hardcoding the value that grants.
 */
export type PlatformMatch =
  | "matched" // the two substrate strings agree
  | "mismatched" // the tool graded a device the document does not target
  | "unknown"; // one or both strings absent or unreadable

/**
 * How much of the benchmark was actually evaluated.
 *
 * Derived from integer counts, never asserted. `notApplicable` is NOT coverage — a
 * run that found 98% of a benchmark inapplicable evaluated almost nothing. The
 * counts must also RECONCILE to the stated total; that identity is a parse gate
 * rather than a threshold, so no number had to be chosen.
 *
 * `ungraded` — not "complete" — is what an absent or unreadable count set yields.
 * The `acknowledged_ungraded` precedent: name the missing measurement instead of
 * asserting the flattering one.
 */
export type AssessmentCoverage =
  | "complete" // counts reconcile, at least one rule evaluated, no errors and no skips
  | "partial" // counts reconcile, some evaluated, errors or skips remain
  | "empty" // counts reconcile and ZERO rules were evaluated
  | "ungraded"; // counts absent, non-integer, negative, or not reconciling

/**
 * Does the cited benchmark satisfy what THIS workflow requires?
 *
 * CALLER-SUPPLIED, like every policy in this fabric. `unrequired` means nobody
 * stated a bar: a HOLE, not a pass, and it forecloses the grant.
 */
export type RequirementFit =
  | "on_requirement" // the cited title is in this workflow's allowlist
  | "off_requirement" // a real benchmark, but not the one this work demands
  | "unrequired" // no requirement supplied — the question is unanswered
  | "unknown"; // a requirement was supplied and could not be read

/**
 * Is the assessment recent enough to still speak for the device?
 *
 * The TEMPORAL form of the unearned affirmative: without this axis a "confirmed"
 * selection stayed confirmed FOREVER. The same test a vendor security review
 * applies to a certification on file ("current SOC2, age under 12 months") —
 * an answer is only as good as its date.
 *
 * All three inputs are SUPPLIED, never sampled: the assessor reports
 * `assessment_time`, the operator's requirement states `maxAssessmentAgeDays`,
 * and the caller supplies the reference instant. `Date.now()` never runs in a
 * decision path.
 *
 * `unbounded` = no age bound is in force: either the supplied requirement states
 * none (an explicit operator choice, carried so it stays visible) or no
 * requirement was supplied at all (already foreclosed as `unrequired` on the
 * requirement axis). `unknown` = a bound IS stated and the age could not be
 * established — missing or unreadable run time, unreadable bound, no reference
 * instant, or a future-dated run — and unknown raises, never grants.
 */
export type AssessmentRecency =
  | "current" // a bound is stated and the assessment is within it
  | "stale" // a bound is stated and the assessment is older than it
  | "unbounded" // no age bound is in force — a visible policy fact, not a default
  | "unknown"; // a bound is stated and the age could not be established

/**
 * The alignment answer itself, in the owner's vocabulary. CARRIED, NEVER GRANTED.
 * Maps onto the core's `BaselineState`: `partially_aligned` ≡ `partial`. The proof
 * pins that mapping so the two vocabularies cannot drift apart silently.
 */
export type BenchmarkAlignment = "aligned" | "partially_aligned" | "drifted" | "not_assessed" | "unknown";

/** Present but unparseable = an assertion we could not read, distinct from silence. */
export type ReportIntegrity = "clean" | "malformed";

/** Raw wire report (loosely typed — assessment tools are EXTERNAL systems and may
 *  emit anything in any slot; the normalizer, not the compiler, makes values safe). */
export interface BenchmarkSelectionReportRaw {
  benchmark_title?: unknown;
  benchmark_version?: unknown;
  source_provenance?: unknown; // cis_published | independent_implementation | tool_declared
  assessment_tool?: unknown; // evidence: which tool performed the grading
  tool_version?: unknown; // evidence
  benchmark_target_platform?: unknown; // the platform the DOCUMENT declares
  observed_platform?: unknown; // the platform the TOOL read off the device
  profile_or_level?: unknown; // evidence: L1 / L2 — carried, never graded (the catalog carries no level)
  assessment_time?: unknown; // ISO-8601 UTC instant the run happened — the versioned-evidence assessmentTime field
  control_id?: unknown; // evidence
  evidence_reference?: unknown; // evidence: where the full result lives
  alignment?: unknown; // aligned | partially_aligned | drifted | not_assessed | unknown
  rules_total?: unknown;
  rules_passed?: unknown;
  rules_failed?: unknown;
  rules_not_applicable?: unknown;
  rules_error?: unknown;
  rules_not_checked?: unknown;
  [k: string]: unknown;
}

export const BENCHMARK_SELECTION_REPORT_KEYS = [
  "benchmark_title",
  "benchmark_version",
  "source_provenance",
  "assessment_tool",
  "tool_version",
  "benchmark_target_platform",
  "observed_platform",
  "profile_or_level",
  "assessment_time",
  "control_id",
  "evidence_reference",
  "alignment",
  "rules_total",
  "rules_passed",
  "rules_failed",
  "rules_not_applicable",
  "rules_error",
  "rules_not_checked",
] as const;

/** The counts, after normalization. `null` = absent or unreadable — NEVER 0.
 *  Absent-defaults-to-zero is exactly how a missing denominator becomes a clean
 *  bill of health. */
export interface RuleCounts {
  total: number | null;
  passed: number | null;
  failed: number | null;
  notApplicable: number | null;
  error: number | null;
  notChecked: number | null;
}

/** The operator's requirement for one workflow: which benchmark titles this work
 *  accepts. CALLER-SUPPLIED — the fabric never authors it. An EMPTY list is
 *  vacuous and reads as unreadable, never as "anything goes". */
export interface BenchmarkRequirement {
  readonly requiredTitles: readonly string[];
  /** Maximum acceptable assessment age, in days. Omitted = the operator states no
   *  age bound (`unbounded`, an explicit and carried choice). A supplied bound
   *  that is not a positive finite number reads as unreadable → `unknown`, never
   *  as "no bound" — a vacuous bound must not be the cheap route past the axis. */
  readonly maxAssessmentAgeDays?: number;
}

export interface NormalizedBenchmarkSelection {
  sourceSystem: "benchmark-selection";
  deviceRef: string;
  recognition: CatalogRecognition;
  provenance: BenchmarkProvenance;
  platformMatch: PlatformMatch;
  coverage: AssessmentCoverage;
  requirementFit: RequirementFit;
  recency: AssessmentRecency;
  /** Carried, never granted. */
  alignment: BenchmarkAlignment;
  /** The versioned-evidence record. Absent fields are null, never a placeholder. */
  citedTitle: string | null;
  citedVersion: string | null;
  /** Filed-under bucket for the matched catalog row — DERIVED from the catalog, not
   *  from the wire, so a report cannot assert its own filing. Null when unmatched. */
  catalogFamily: string | null;
  catalogSection: CatalogSection | null;
  assessmentTool: string | null;
  toolVersion: string | null;
  benchmarkTargetPlatform: string | null;
  observedPlatform: string | null;
  profileOrLevel: string | null;
  /** The run's own timestamp, carried verbatim when parseable — null otherwise. */
  assessmentTime: string | null;
  controlId: string | null;
  evidenceReference: string | null;
  counts: RuleCounts;
  reportIntegrity: ReportIntegrity;
  source: string;
}

export type BenchmarkSelectionPosture =
  | "requirement_matched" // the grant: right document, CIS content, right platform, fully covered, on requirement
  | "provenance_independent" // real work by a named third-party implementation — not CIS content
  | "coverage_partial" // errors or skipped rules remain
  | "version_superseded" // graded against a lower version than the catalog lists
  | "version_unlisted" // the title is real; this version is not a listed row
  | "assessment_stale" // the run is older than the operator's stated age bound
  | "requirement_absent" // nobody stated a bar for this work
  | "provenance_unattributed" // the tool labelled its checks "CIS" and named no source
  | "benchmark_unlisted" // an affirmative citation the catalog does not carry
  | "benchmark_off_requirement" // a real benchmark, not the one this work demands
  | "platform_mismatch" // the document does not target the platform the tool read
  | "assessment_empty" // the counts reconcile and nothing was evaluated
  | "selection_unverified"; // any axis unknown / malformed / uncovered

export type BenchmarkSelectionAction = "none" | "monitor" | "step_up" | "alert" | "restrict" | "escalate";

export type BenchmarkSelectionReasonCode =
  | "GRADED_AGAINST_REQUIRED_BENCHMARK"
  | "PROVENANCE_INDEPENDENT_IMPLEMENTATION"
  | "PROVENANCE_TOOL_DECLARED_ONLY"
  | "PROVENANCE_UNKNOWN"
  | "ASSESSMENT_PARTIAL"
  | "ASSESSMENT_EMPTY"
  | "ASSESSMENT_STALE"
  | "ASSESSMENT_RECENCY_UNKNOWN"
  | "COVERAGE_UNGRADED"
  | "BENCHMARK_VERSION_SUPERSEDED"
  | "BENCHMARK_VERSION_NOT_LISTED"
  | "BENCHMARK_NOT_IN_CATALOG"
  | "BENCHMARK_UNKNOWN"
  | "BENCHMARK_OFF_REQUIREMENT"
  | "REQUIREMENT_ABSENT"
  | "REQUIREMENT_UNKNOWN"
  | "ASSESSOR_PLATFORM_MISMATCH"
  | "PLATFORM_MATCH_UNKNOWN"
  | "REPORT_MALFORMED"
  | "NOT_COVERED";

export interface BenchmarkSelectionVerdict {
  deviceRef: string;
  posture: BenchmarkSelectionPosture;
  reasonCode: BenchmarkSelectionReasonCode;
  recommendedAction: BenchmarkSelectionAction;
  /** Affirmative selection concerns — the fail-OPEN ones, where an assessment reads
   *  as assurance it did not establish. */
  criticalFindings: string[];
  /** Inputs whose state could not be determined. Any of these forecloses the grant. */
  unknownSignals: string[];
  /** True ONLY when the assessment was the right document, honestly sourced, on the
   *  right platform, adequately covered, and the one this work requires. It is NOT a
   *  statement that the device passed — see `alignment`, deliberately outside this
   *  conjunction. */
  selectionConfirmed: boolean;
}

export class BenchmarkSelectionConnectorError extends Error {
  constructor(
    public readonly code: "read_only_violation" | "auth_failed" | "upstream_error" | "bad_response" | "bad_catalog",
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "BenchmarkSelectionConnectorError";
  }
}
