// Benchmark-selection decision proof — fully OFFLINE and deterministic.
//
// A baseline answer is meaningless without the question that produced it. This proof
// pins the doctrine across every failure mode: a benchmark the catalog does not
// carry (alert); a superseded or unlisted version (step_up); content that is a
// third-party implementation rather than CIS's own (monitor) or is merely LABELLED
// "CIS" (step_up); a document that does not target the platform the tool read
// (restrict); an assessment that evaluated nothing (restrict); a real benchmark that
// is not the one this work requires (alert); no stated requirement at all (step_up);
// and a run OLDER than the operator's stated age bound (step_up) — the temporal
// unearned affirmative, where "confirmed" once meant confirmed forever. The grant
// needs EIGHT affirmative clauses, and `alignment` is deliberately not one of them —
// this dimension says the test was right, never that the device passed.
import {
  BenchmarkSelectionConnector,
  BenchmarkSelectionConnectorError,
  buildBenchmarkCatalog,
  createMockBenchmarkSelectionTransport,
  deriveCoverage,
  deriveRecency,
  deriveRecognition,
  deriveRequirementFit,
  evaluateBenchmarkSelection,
  guardReadOnly,
  loadBenchmarkCatalog,
  normalizeReport,
  versionGreater,
  type BenchmarkSelectionReportRaw,
  type NormalizedBenchmarkSelection,
  type RuleCounts,
} from "@workspace/integrations/benchmark-selection";
import { SIGNAL_KINDS, composeDeviceRisk, fromBenchmarkSelection } from "@workspace/posture-composition";
import { enumerateGrantSafety, productOf } from "./lib/grant-safety.js";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Benchmark-selection decision proof");

const catalog = loadBenchmarkCatalog();

/** A real, current row of the committed snapshot. */
const OK_TITLE = "Apple macOS 15.0 Sequoia";
const OK_VERSION = "2.1.0";
const REQUIREMENT = { requiredTitles: [OK_TITLE] };

/** A fully-clean report: right document, CIS content, matching platform, every rule
 *  accounted for. Each targeted check below changes exactly ONE field of it. */
const clean = (over: BenchmarkSelectionReportRaw = {}): BenchmarkSelectionReportRaw => ({
  benchmark_title: OK_TITLE,
  benchmark_version: OK_VERSION,
  source_provenance: "cis_published",
  assessment_tool: "CIS-CAT Pro Assessor",
  tool_version: "4.42.0",
  benchmark_target_platform: "macOS 15",
  observed_platform: "macOS 15",
  alignment: "aligned",
  rules_total: 100,
  rules_passed: 90,
  rules_failed: 10,
  rules_not_applicable: 0,
  rules_error: 0,
  rules_not_checked: 0,
  ...over,
});

const ev = (r: BenchmarkSelectionReportRaw, requirement = REQUIREMENT, id = "dev-1") =>
  evaluateBenchmarkSelection(normalizeReport(id, r, { requirement }));

// ── the grant ───────────────────────────────────────────────────────────────────
const grant = ev(clean());
check("right document + CIS content + matching platform + full coverage + on requirement → the grant",
  grant.recommendedAction === "none" && grant.reasonCode === "GRADED_AGAINST_REQUIRED_BENCHMARK" && grant.selectionConfirmed === true);
check("...with no critical findings and no unknowns",
  grant.criticalFindings.length === 0 && grant.unknownSignals.length === 0);

// THE POINT OF THE DIMENSION: the grant says the TEST was right, not that the device
// passed. A drifted device on a correctly-selected benchmark still grants HERE — the
// alignment answer is carried and graded by the baseline dimension, not by this one.
const grantWhileDrifted = ev(clean({ alignment: "drifted" }));
check("a DRIFTED device on a correctly-selected benchmark still confirms SELECTION — this dimension never claims the device passed",
  grantWhileDrifted.recommendedAction === "none" && grantWhileDrifted.selectionConfirmed === true);
check("...and the drifted alignment is carried on the normalized record for the baseline dimension to grade",
  normalizeReport("d", clean({ alignment: "drifted" }), { requirement: REQUIREMENT }).alignment === "drifted");
check("the owner's vocabulary is preserved: partially_aligned normalizes as itself, never collapsed to 'partial'",
  normalizeReport("d", clean({ alignment: "partially_aligned" }), { requirement: REQUIREMENT }).alignment === "partially_aligned");

// ── identity + currency ─────────────────────────────────────────────────────────
// The catalog carries 7 superseded rows. Three of them exist ONLY because identity
// is keyed on TITLE: "Microsoft Windows Server 2019 STIG" v3.0.0 is filed under
// family "Microsoft Windows Server" and its successor v4.0.0 under "DISA STIG", so a
// family-keyed index would report the older row as current and GRANT it.
const supersededReq = { requiredTitles: ["Microsoft Windows Server 2019 STIG"] };
const superseded = ev(clean({ benchmark_title: "Microsoft Windows Server 2019 STIG", benchmark_version: "3.0.0" }), supersededReq);
check("a SUPERSEDED version (v3.0.0 where the catalog lists v4.0.0) → step_up, never the grant",
  superseded.recommendedAction === "step_up" && superseded.reasonCode === "BENCHMARK_VERSION_SUPERSEDED" &&
  superseded.criticalFindings.includes("benchmark_version_superseded"));
check("...and the cross-family case is exactly why identity is keyed on TITLE: the successor is filed under a DIFFERENT family",
  catalog.rowFor("Microsoft Windows Server 2019 STIG", "3.0.0")?.family === "Microsoft Windows Server" &&
  catalog.rowFor("Microsoft Windows Server 2019 STIG", "4.0.0")?.family === "DISA STIG");
const unlisted = ev(clean({ benchmark_version: "9.9.9" }));
check("a version the catalog does not list for a real title → step_up (BENCHMARK_VERSION_NOT_LISTED)",
  unlisted.recommendedAction === "step_up" && unlisted.reasonCode === "BENCHMARK_VERSION_NOT_LISTED");
const notInCatalog = ev(clean({ benchmark_title: "Acme Hardening Standard" }), { requiredTitles: ["Acme Hardening Standard"] });
check("a title the published catalog does not carry → alert (measurement broken at operator scale)",
  notInCatalog.recommendedAction === "alert" && notInCatalog.reasonCode === "BENCHMARK_NOT_IN_CATALOG" &&
  notInCatalog.criticalFindings.includes("benchmark_not_in_catalog"));
const noTitle = ev(clean({ benchmark_title: undefined }));
check("no benchmark cited at all → step_up AS BENCHMARK_UNKNOWN (the reason is pinned: with no title the requirement is also unreadable, and the citation branch must still lead)",
  noTitle.recommendedAction === "step_up" && noTitle.reasonCode === "BENCHMARK_UNKNOWN" &&
  noTitle.unknownSignals.includes("benchmark_citation"));

// ── provenance — the owner's rule ───────────────────────────────────────────────
const independent = ev(clean({ source_provenance: "independent_implementation", assessment_tool: "kube-bench" }));
check("a third-party implementation of CIS-aligned checks → monitor, never the grant (real work, but not CIS's published content)",
  independent.recommendedAction === "monitor" && independent.reasonCode === "PROVENANCE_INDEPENDENT_IMPLEMENTATION" &&
  independent.selectionConfirmed === false && independent.criticalFindings.includes("provenance_not_cis_published"));
const toolDeclared = ev(clean({ source_provenance: "tool_declared" }));
check("a tool that merely LABELS its checks 'CIS' → step_up (a label is a name, not a provenance)",
  toolDeclared.recommendedAction === "step_up" && toolDeclared.reasonCode === "PROVENANCE_TOOL_DECLARED_ONLY" &&
  toolDeclared.criticalFindings.includes("provenance_tool_declared_only"));
const provAbsent = ev(clean({ source_provenance: undefined }));
check("an absent provenance → step_up, NOT an assumed cis_published (silence is not an affirmative)",
  provAbsent.recommendedAction === "step_up" && provAbsent.reasonCode === "PROVENANCE_UNKNOWN" &&
  provAbsent.unknownSignals.includes("provenance"));
check("the tool identity is carried as evidence so a provenance claim is attributable",
  normalizeReport("d", clean({ source_provenance: "independent_implementation", assessment_tool: "kube-bench", tool_version: "0.7.3" }),
    { requirement: REQUIREMENT }).assessmentTool === "kube-bench");

// ── platform: derived from two substrate strings, not a believed boolean ────────
const platformMismatch = ev(clean({ benchmark_target_platform: "macOS 12", observed_platform: "macOS 26" }));
check("the document targets macOS 12 and the tool read macOS 26 → restrict (the wrong-bar case, caught affirmatively)",
  platformMismatch.recommendedAction === "restrict" && platformMismatch.reasonCode === "ASSESSOR_PLATFORM_MISMATCH" &&
  platformMismatch.criticalFindings.includes("assessor_platform_mismatch"));
check("platform comparison is formatting-tolerant but never inferential: ' MACOS  15 ' matches 'macOS 15'",
  normalizeReport("d", clean({ observed_platform: " MACOS  15 " }), { requirement: REQUIREMENT }).platformMatch === "matched");
const platformAbsent = ev(clean({ observed_platform: undefined }));
check("one platform string absent → step_up (PLATFORM_MATCH_UNKNOWN), never assumed matching",
  platformAbsent.recommendedAction === "step_up" && platformAbsent.reasonCode === "PLATFORM_MATCH_UNKNOWN");

// ── coverage: the denominator is load-bearing ───────────────────────────────────
// This is the defect an adversarial review found in this dimension's own first
// draft: `rules_total` was collected and never read, so 3 rules out of 400 graded
// "complete" and GRANTED. The accounting identity closes it without choosing a
// threshold — the buckets must reconcile to the report's own total.
const underCovered = ev(clean({ rules_total: 400, rules_passed: 1, rules_failed: 2 }));
check("3 of 400 rules evaluated, counts NOT reconciling to the stated total → ungraded → step_up, never 'complete'",
  underCovered.recommendedAction === "step_up" && underCovered.reasonCode === "COVERAGE_UNGRADED");
check("the accounting identity is what catches it: passed+failed+na+error+not_checked must equal total",
  deriveCoverage({ total: 400, passed: 1, failed: 2, notApplicable: 0, error: 0, notChecked: 0 }) === "ungraded" &&
  deriveCoverage({ total: 400, passed: 1, failed: 2, notApplicable: 397, error: 0, notChecked: 0 }) === "complete");
const mostlyNotApplicable = ev(clean({ rules_total: 400, rules_passed: 2, rules_failed: 0, rules_not_applicable: 398 }));
check("a run that is 99.5% not-applicable still reconciles and still grades — not_applicable is honestly excluded from the numerator, and the operator sees the counts",
  mostlyNotApplicable.recommendedAction === "none" && mostlyNotApplicable.selectionConfirmed === true);
const emptyRun = ev(clean({ rules_total: 400, rules_passed: 0, rules_failed: 0, rules_not_applicable: 400 }));
check("ZERO rules evaluated (counts reconcile) → restrict (a perfect score over an empty denominator)",
  emptyRun.recommendedAction === "restrict" && emptyRun.reasonCode === "ASSESSMENT_EMPTY" &&
  emptyRun.criticalFindings.includes("assessment_evaluated_nothing"));
const partialRun = ev(clean({ rules_total: 100, rules_passed: 80, rules_failed: 10, rules_error: 5, rules_not_checked: 5 }));
check("errors and skipped rules remain → monitor (ASSESSMENT_PARTIAL)",
  partialRun.recommendedAction === "monitor" && partialRun.reasonCode === "ASSESSMENT_PARTIAL");
const countsAbsent = ev(clean({ rules_error: undefined }));
check("ONE absent count → ungraded → step_up. Absent is unknown, NEVER zero — a defaulted zero is how a missing denominator becomes a clean bill of health",
  countsAbsent.recommendedAction === "step_up" && countsAbsent.reasonCode === "COVERAGE_UNGRADED");
check("a negative, a float, and a numeric STRING each read as absent rather than as a count",
  deriveCoverage({ total: 10, passed: -1, failed: 0, notApplicable: 9, error: 0, notChecked: 0 } as RuleCounts) === "ungraded" &&
  normalizeReport("d", clean({ rules_passed: 1.5 }), { requirement: REQUIREMENT }).counts.passed === null &&
  normalizeReport("d", clean({ rules_passed: "90" }), { requirement: REQUIREMENT }).counts.passed === null);

// ── requirement: the persona / workflow binding ─────────────────────────────────
const offRequirement = ev(clean({ benchmark_title: "Apple macOS 14.0 Sonoma", benchmark_version: "3.1.0" }));
check("a real benchmark that is not the one this workflow demands → alert, not restrict (a citation failure must not block a hardened device mid-shift)",
  offRequirement.recommendedAction === "alert" && offRequirement.reasonCode === "BENCHMARK_OFF_REQUIREMENT" &&
  offRequirement.criticalFindings.includes("benchmark_off_requirement"));
const noRequirement = evaluateBenchmarkSelection(normalizeReport("d", clean(), {}));
check("no requirement supplied → step_up (REQUIREMENT_ABSENT): nobody stated a bar, which is a hole, not a pass",
  noRequirement.recommendedAction === "step_up" && noRequirement.reasonCode === "REQUIREMENT_ABSENT");
const emptyRequirement = ev(clean(), { requiredTitles: [] });
check("an EMPTY requirement list reads as unreadable, never as 'anything goes' — a vacuous policy is not the cheap route to a grant",
  emptyRequirement.recommendedAction === "step_up" && emptyRequirement.reasonCode === "REQUIREMENT_UNKNOWN");
check("the same device grades differently under two workflows' requirements — the persona/use-case binding is real",
  ev(clean(), { requiredTitles: [OK_TITLE] }).recommendedAction === "none" &&
  ev(clean(), { requiredTitles: ["Apple macOS 15.0 Sequoia Intune"] }).recommendedAction === "alert");
check("the Intune-tailored, Cloud-tailored and base macOS 15 benchmarks are three DISTINCT catalog rows — variant is pinned by title, not guessed",
  catalog.versionsFor("Apple macOS 15.0 Sequoia").size === 1 &&
  catalog.versionsFor("Apple macOS 15.0 Sequoia Intune").size === 1 &&
  catalog.versionsFor("Apple macOS 15.0 Sequoia Cloud-tailored").size === 1);

// ── recency: the temporal axis ──────────────────────────────────────────────────
// An assessment is a statement about the moment it ran. Without this axis a
// "confirmed" selection stayed confirmed FOREVER — the same defect the other axes
// withdraw, in its temporal form. All three inputs are supplied, never sampled:
// the assessor reports assessment_time, the operator's requirement states
// maxAssessmentAgeDays, and the caller supplies the reference instant.
const AGE_REQ = { requiredTitles: [OK_TITLE], maxAssessmentAgeDays: 365 };
const REF = "2026-07-31T00:00:00Z";
const evAt = (r: BenchmarkSelectionReportRaw, requirement = AGE_REQ, referenceTime: string | undefined = REF) =>
  evaluateBenchmarkSelection(normalizeReport("dev-t", r, { requirement, referenceTime }));
const recent = evAt(clean({ assessment_time: "2026-07-01T12:00:00Z" }));
check("a run inside the operator's age bound → still the grant (the recency axis raises, it never blocks a fresh answer)",
  recent.recommendedAction === "none" && recent.selectionConfirmed === true);
const stale = evAt(clean({ assessment_time: "2024-01-01T00:00:00Z" }));
check("a run OLDER than the stated bound → step_up (ASSESSMENT_STALE): the answer was right once, and once is not now",
  stale.recommendedAction === "step_up" && stale.reasonCode === "ASSESSMENT_STALE" &&
  stale.criticalFindings.includes("assessment_stale") && stale.selectionConfirmed === false);
check("THE TEMPORAL POINT: the SAME report under the SAME requirement grades current at one reference instant and stale at a later one — nothing about the device changed, only the date",
  evAt(clean({ assessment_time: "2026-07-01T12:00:00Z" }), AGE_REQ, "2026-07-31T00:00:00Z").recommendedAction === "none" &&
  evAt(clean({ assessment_time: "2026-07-01T12:00:00Z" }), AGE_REQ, "2027-08-01T00:00:00Z").reasonCode === "ASSESSMENT_STALE");
const noTime = evAt(clean());
check("a bound is stated and the report carries NO run time → step_up (ASSESSMENT_RECENCY_UNKNOWN), never silently current",
  noTime.recommendedAction === "step_up" && noTime.reasonCode === "ASSESSMENT_RECENCY_UNKNOWN" &&
  noTime.unknownSignals.includes("assessment_recency"));
// Built WITHOUT the referenceTime option at all — an explicit `undefined` argument
// would trigger a helper's default parameter and silently test the wrong thing.
const noRef = evaluateBenchmarkSelection(
  normalizeReport("dev-t", clean({ assessment_time: "2026-07-01T12:00:00Z" }), { requirement: AGE_REQ }));
check("a bound is stated and the CALLER supplies no reference instant → step_up (the fabric refuses to sample a clock instead)",
  noRef.recommendedAction === "step_up" && noRef.reasonCode === "ASSESSMENT_RECENCY_UNKNOWN");
const unbounded = normalizeReport("d", clean({ assessment_time: "2020-01-01T00:00:00Z" }), { requirement: REQUIREMENT, referenceTime: REF });
check("a supplied requirement that states NO age bound → recency 'unbounded', carried and still granting — an explicit operator choice, visible on the record",
  unbounded.recency === "unbounded" && evaluateBenchmarkSelection(unbounded).recommendedAction === "none");
const futureDated = evAt(clean({ assessment_time: "2027-01-01T00:00:00Z" }));
check("a FUTURE-dated run → unknown → step_up: an unestablishable age never reads as fresh",
  futureDated.recommendedAction === "step_up" && futureDated.reasonCode === "ASSESSMENT_RECENCY_UNKNOWN");
check("an ASSERTED run time in a shape we cannot read ('yesterday') is malformed — an assertion, not silence",
  normalizeReport("d", clean({ assessment_time: "yesterday" }), { requirement: AGE_REQ, referenceTime: REF }).reportIntegrity === "malformed" &&
  normalizeReport("d", clean({ assessment_time: "yesterday" }), { requirement: AGE_REQ, referenceTime: REF }).recency === "unknown");
check("the boundary is inclusive and exact: a run aged precisely 365 days is current; one millisecond older is stale",
  evAt(clean({ assessment_time: "2025-07-31T00:00:00.000Z" })).recommendedAction === "none" &&
  evAt(clean({ assessment_time: "2025-07-30T23:59:59.999Z" })).reasonCode === "ASSESSMENT_STALE");
check("deriveRecency maps its cases directly: an unreadable bound (zero, negative, NaN) is unknown, NEVER 'no bound' — a vacuous bound is not the cheap route past the axis",
  deriveRecency({ requiredTitles: [OK_TITLE], maxAssessmentAgeDays: 0 }, 0, 1) === "unknown" &&
  deriveRecency({ requiredTitles: [OK_TITLE], maxAssessmentAgeDays: -5 }, 0, 1) === "unknown" &&
  deriveRecency({ requiredTitles: [OK_TITLE], maxAssessmentAgeDays: Number.NaN }, 0, 1) === "unknown" &&
  deriveRecency({ requiredTitles: [OK_TITLE] }, 0, 1) === "unbounded" &&
  deriveRecency(undefined, 0, 1) === "unbounded");
check("the run's own timestamp is carried as versioned evidence (the assessmentTime field), null when unreadable",
  normalizeReport("d", clean({ assessment_time: "2026-07-01T12:00:00Z" }), { requirement: AGE_REQ, referenceTime: REF }).assessmentTime === "2026-07-01T12:00:00Z" &&
  normalizeReport("d", clean(), { requirement: AGE_REQ, referenceTime: REF }).assessmentTime === null);

// ── uncovered ───────────────────────────────────────────────────────────────────
const uncovered = evaluateBenchmarkSelection(normalizeReport("d", clean(), { requirement: REQUIREMENT }), { covered: false });
check("no assessment record returned (covered=false) → step_up (NOT_COVERED)",
  uncovered.recommendedAction === "step_up" && uncovered.reasonCode === "NOT_COVERED");

// ── malformed / hostile report shapes ───────────────────────────────────────────
const extraKey = normalizeReport("x", { ...clean(), scanner_note: "looks fine" } as BenchmarkSelectionReportRaw, { requirement: REQUIREMENT });
check("an unrecognized key refuses AS malformed (not merely via the backstop)",
  extraKey.reportIntegrity === "malformed" &&
  evaluateBenchmarkSelection(extraKey).reasonCode === "REPORT_MALFORMED" &&
  evaluateBenchmarkSelection(extraKey).recommendedAction !== "none");
check("junk provenance alone → malformed",
  normalizeReport("j1", clean({ source_provenance: "sort-of-cis" }), { requirement: REQUIREMENT }).reportIntegrity === "malformed");
check("junk alignment alone → malformed",
  normalizeReport("j2", clean({ alignment: "mostly-ok" }), { requirement: REQUIREMENT }).reportIntegrity === "malformed");
check("a version in a shape the catalog could never carry ('2.1') is a wire contradiction → malformed",
  normalizeReport("j3", clean({ benchmark_version: "2.1" }), { requirement: REQUIREMENT }).reportIntegrity === "malformed");
const inherited = evaluateBenchmarkSelection(
  normalizeReport("i", Object.create(clean()) as BenchmarkSelectionReportRaw, { requirement: REQUIREMENT }));
check("a report with ZERO own keys asserts nothing and cannot grant", inherited.recommendedAction !== "none");
const hidden = new Proxy(clean(), { ownKeys: () => [], getOwnPropertyDescriptor: () => undefined }) as BenchmarkSelectionReportRaw;
check("a Proxy hiding its own descriptors reads as absent and cannot grant",
  evaluateBenchmarkSelection(normalizeReport("px", hidden, { requirement: REQUIREMENT })).recommendedAction !== "none");
const throwingKeys = new Proxy(clean(), { ownKeys: () => { throw new Error("hostile"); } }) as BenchmarkSelectionReportRaw;
check("a Proxy that THROWS from ownKeys fails closed",
  evaluateBenchmarkSelection(normalizeReport("tk", throwingKeys, { requirement: REQUIREMENT })).recommendedAction !== "none");
const throwingAccessor = { ...clean() } as BenchmarkSelectionReportRaw;
Object.defineProperty(throwingAccessor, "benchmark_title", { enumerable: true, get() { throw new Error("boom"); } });
let accessorThrew = false;
try {
  check("a throwing ACCESSOR fails closed to malformed without an exception",
    normalizeReport("ta", throwingAccessor, { requirement: REQUIREMENT }).reportIntegrity === "malformed");
} catch { accessorThrew = true; }
check("...and no exception escaped the normalizer", accessorThrew === false);
check("a non-object report body is malformed, not a thrown TypeError",
  normalizeReport("s", "boom" as unknown as BenchmarkSelectionReportRaw, { requirement: REQUIREMENT }).reportIntegrity === "malformed");
check("a null report body is malformed, not a thrown TypeError",
  normalizeReport("n", null as unknown as BenchmarkSelectionReportRaw, { requirement: REQUIREMENT }).reportIntegrity === "malformed");
check("Object.prototype itself as the report is malformed (polluted-prototype fields must never read as own assertions)",
  normalizeReport("op", Object.prototype as BenchmarkSelectionReportRaw, { requirement: REQUIREMENT }).reportIntegrity === "malformed");
let deepProto: object = {};
for (let i = 0; i < 100; i += 1) deepProto = Object.create(deepProto);
check("a report behind a 100-deep prototype chain is malformed (bounded walk)",
  normalizeReport("deep", Object.assign(Object.create(deepProto), clean()) as BenchmarkSelectionReportRaw,
    { requirement: REQUIREMENT }).reportIntegrity === "malformed");

// ── the catalog itself ──────────────────────────────────────────────────────────
// Every figure re-derived from the entries, so a hand-edited snapshot cannot load.
check(`the committed snapshot carries ${catalog.derived.entries} entries across ${catalog.derived.titles} distinct titles`,
  catalog.derived.entries === 454 && catalog.derived.titles === 447);
check(`${catalog.derived.titlesWithMultipleVersions} titles carry more than one listed version — ${catalog.derived.highestVersionRows} rows are current and ${catalog.derived.supersededRows} are superseded`,
  catalog.derived.titlesWithMultipleVersions === 7 && catalog.derived.highestVersionRows === 447 && catalog.derived.supersededRows === 7);
check(`the catalog spans ${catalog.derived.families} families, ${catalog.derived.sectionCurrent} rows on the main page and ${catalog.derived.sectionDisaStig} under DISA STIG`,
  catalog.derived.families === 83 && catalog.derived.sectionCurrent === 324 && catalog.derived.sectionDisaStig === 130);
check("the derived totals reconcile: current + disa_stig = entries, and highest + superseded = entries",
  catalog.derived.sectionCurrent + catalog.derived.sectionDisaStig === catalog.derived.entries &&
  catalog.derived.highestVersionRows + catalog.derived.supersededRows === catalog.derived.entries);
const refuses = (doc: unknown): boolean => {
  try { buildBenchmarkCatalog(doc); return false; }
  catch (err) { return err instanceof BenchmarkSelectionConnectorError && err.code === "bad_catalog"; }
};
/** Re-derive the declared block from a mutated entry list so a negative control is
 *  refused by the rule it NAMES and not by the count re-derivation firing first.
 *  The mutation guard found four controls here passing for the wrong reason: each
 *  had perturbed the entry count, so the snapshot was refused before the rule under
 *  test ever ran. An oracle that passes for a reason other than the one it states is
 *  not evidence. */
const declaredFor = (entries: readonly { title: string; version: string; family: string; section: string }[]) => {
  const byTitle = new Map<string, string[]>();
  for (const e of entries) byTitle.set(e.title, [...(byTitle.get(e.title) ?? []), e.version]);
  const highest = entries.filter((e) => e.version === byTitle.get(e.title)!.reduce((b, v) => (versionGreater(v, b) ? v : b))).length;
  return {
    entries: entries.length,
    titles: byTitle.size,
    titlesWithMultipleVersions: [...byTitle.values()].filter((v) => v.length > 1).length,
    highestVersionRows: highest,
    supersededRows: entries.length - highest,
    families: new Set(entries.map((e) => e.family)).size,
    sectionCurrent: entries.filter((e) => e.section === "current").length,
    sectionDisaStig: entries.filter((e) => e.section === "disa_stig").length,
  };
};
const withEntries = (entries: readonly unknown[], declaredOverride?: Record<string, number>) => ({
  asOf: "2026-07-30",
  derived: declaredOverride ?? declaredFor(entries as never),
  entries,
});
/** A single-version title, so swapping it perturbs no derived figure. */
const singleVersionIdx = catalog.entries.findIndex((e) => catalog.versionsFor(e.title).size === 1);
const swap = (over: Record<string, unknown>) =>
  catalog.entries.map((e, i) => (i === singleVersionIdx ? { ...e, ...over } : e));

check("the UNMUTATED snapshot, rebuilt through the same path, LOADS — so every refusal below is attributable to its own mutation and not to the rebuild",
  !refuses(withEntries(catalog.entries)));
check("a snapshot whose DECLARED counts disagree with its entries is refused (the declared block is a claim, the entries are the fact)",
  refuses(withEntries(catalog.entries, { ...catalog.derived, entries: 999 })));
check("a row carrying an EXTRA KEY is refused — counts held identical, so only the key rule can fire",
  refuses(withEntries(swap({ rule_text: "x" }))));
check("a row with the right ARITY but a MISSPELLED key is refused — the same single set-equality rule, which is why it is one guard and not two",
  refuses(withEntries(catalog.entries.map((e, i) =>
    i === singleVersionIdx ? { title: e.title, version: e.version, familly: e.family, section: e.section } : e))));
check("a row whose SECTION is not one of current|disa_stig is refused — counts held identical",
  refuses(withEntries(swap({ section: "archived" }))));
check("a row carrying BENCHMARK RULE CONTENT as its title is refused — counts held identical, so the licensing boundary is what fires, and it is a mechanism rather than a note",
  refuses(withEntries(swap({ title: "Ensure 'Minimum password length' is set to 14 or more characters (L1)" }))));
check("a version string that is not a numeric triple is refused at load — counts held identical",
  refuses(withEntries(swap({ version: "3.11" }))));
check("an EMPTY catalog is refused — a parser that broke must not answer 'not_in_catalog' for every device on earth",
  refuses(withEntries([])));
check("a DE-DUPLICATED catalog (no title carrying two versions) is refused — it would retire the version_superseded rung while every proof stayed green",
  refuses(withEntries(catalog.entries.filter((e) => catalog.versionsFor(e.title).size === 1))));

// ── the comparator, asserted directly (an evaluator sweep cannot see it) ────────
check("version ordering is numeric, not lexical: 1.10.0 > 1.9.0 and 3.0.0 > 2.9.9",
  versionGreater("1.10.0", "1.9.0") && versionGreater("3.0.0", "2.9.9") && !versionGreater("1.0.0", "1.0.1"));
check("deriveRecognition maps the four cases directly, independent of the evaluator",
  deriveRecognition(catalog, OK_TITLE, OK_VERSION) === "recognized" &&
  deriveRecognition(catalog, "Microsoft Windows Server 2019 STIG", "3.0.0") === "version_superseded" &&
  deriveRecognition(catalog, OK_TITLE, "9.9.9") === "version_unlisted" &&
  deriveRecognition(catalog, "Nope", "1.0.0") === "not_in_catalog");
check("deriveRequirementFit maps its four cases directly",
  deriveRequirementFit({ requiredTitles: [OK_TITLE] }, OK_TITLE) === "on_requirement" &&
  deriveRequirementFit({ requiredTitles: ["Other"] }, OK_TITLE) === "off_requirement" &&
  deriveRequirementFit(undefined, OK_TITLE) === "unrequired" &&
  deriveRequirementFit({ requiredTitles: [] }, OK_TITLE) === "unknown");

// ── connector surface ───────────────────────────────────────────────────────────
let readOnly = false;
try { guardReadOnly("POST"); } catch (err) { readOnly = err instanceof BenchmarkSelectionConnectorError && err.code === "read_only_violation"; }
check("a non-GET request is refused by the read-only guard", readOnly);
const conn = new BenchmarkSelectionConnector(
  { accessToken: "t", baseUrl: "https://assessor.example" },
  createMockBenchmarkSelectionTransport({ reports: { "dev-9": clean() } }),
);
check("the connector round-trip normalizes a clean report end to end (grantable)",
  evaluateBenchmarkSelection(await conn.fetchNormalized("dev-9", REQUIREMENT)).recommendedAction === "none");
check("an unknown device yields an all-unknown report that cannot grant",
  evaluateBenchmarkSelection(await conn.fetchNormalized("dev-unknown", REQUIREMENT)).recommendedAction !== "none");

// ── exhaustive (normalized): the grant is the eight-way conjunction ─────────────
const normDomains = {
  recognition: ["recognized", "version_superseded", "version_unlisted", "not_in_catalog", "unknown"],
  provenance: ["cis_published", "independent_implementation", "tool_declared", "unknown"],
  platformMatch: ["matched", "mismatched", "unknown"],
  coverage: ["complete", "partial", "empty", "ungraded"],
  requirementFit: ["on_requirement", "off_requirement", "unrequired", "unknown"],
  recency: ["current", "stale", "unbounded", "unknown"],
  alignment: ["aligned", "partially_aligned", "drifted", "not_assessed", "unknown"],
  reportIntegrity: ["clean", "malformed"],
};
const buildNorm = (c: Record<string, unknown>): NormalizedBenchmarkSelection => ({
  sourceSystem: "benchmark-selection", deviceRef: "enum", source: "enum",
  recognition: c.recognition as NormalizedBenchmarkSelection["recognition"],
  provenance: c.provenance as NormalizedBenchmarkSelection["provenance"],
  platformMatch: c.platformMatch as NormalizedBenchmarkSelection["platformMatch"],
  coverage: c.coverage as NormalizedBenchmarkSelection["coverage"],
  requirementFit: c.requirementFit as NormalizedBenchmarkSelection["requirementFit"],
  recency: c.recency as NormalizedBenchmarkSelection["recency"],
  alignment: c.alignment as NormalizedBenchmarkSelection["alignment"],
  reportIntegrity: c.reportIntegrity as NormalizedBenchmarkSelection["reportIntegrity"],
  citedTitle: OK_TITLE, citedVersion: OK_VERSION, catalogFamily: null, catalogSection: null,
  assessmentTool: null, toolVersion: null, benchmarkTargetPlatform: null, observedPlatform: null,
  profileOrLevel: null, assessmentTime: null, controlId: null, evidenceReference: null,
  counts: { total: null, passed: null, failed: null, notApplicable: null, error: null, notChecked: null },
});
const normRes = enumerateGrantSafety({
  domains: normDomains,
  build: buildNorm,
  evaluate: (r) => evaluateBenchmarkSelection(r),
  actionOf: (v) => (v.recommendedAction === "none" ? "none" : v.recommendedAction),
  confirmedWhenNone: (v) => v.selectionConfirmed === true && v.criticalFindings.length === 0 && v.unknownSignals.length === 0,
  positivelyClean: (c) =>
    c.reportIntegrity === "clean" &&
    c.recognition === "recognized" &&
    c.provenance === "cis_published" &&
    c.platformMatch === "matched" &&
    c.coverage === "complete" &&
    c.requirementFit === "on_requirement" &&
    (c.recency === "current" || c.recency === "unbounded"),
});
check(
  `exhaustive (normalized): over all ${normRes.combos} states, selection is confirmed ONLY on the eight-way conjunction (mismatches=${normRes.mismatches}${normRes.firstMismatch ? ", first=" + normRes.firstMismatch : ""})`,
  normRes.mismatches === 0 && normRes.combos === productOf(normDomains) && normRes.combos === 38400,
);
check("exhaustive (normalized): exactly 10 states grant — one per ALIGNMENT value times the two recencies that can grant (current, and the operator's explicit unbounded) — the proof that this dimension never grades whether the device passed",
  normRes.noneCount === 10);

// ── exhaustive (raw wire): normalizer + catalog + requirement on hostile input ──
const rawDomains = {
  benchmark_title: [OK_TITLE, "Apple macOS 14.0 Sonoma", "Acme Hardening Standard", undefined],
  benchmark_version: [OK_VERSION, "9.9.9", "2.1", undefined],
  source_provenance: ["cis_published", "independent_implementation", "tool_declared", undefined, "certified"],
  observed_platform: ["macOS 15", "macOS 26", undefined],
  rules_passed: [90, 0, undefined, "90"],
  __alias: ["absent", "present"],
};
const buildRaw = (c: Record<string, unknown>): NormalizedBenchmarkSelection => {
  const { __alias, ...wire } = c;
  const raw: BenchmarkSelectionReportRaw = {
    benchmark_target_platform: "macOS 15",
    alignment: "aligned",
    rules_total: 100, rules_failed: 10, rules_not_applicable: 0, rules_error: 0, rules_not_checked: 0,
  };
  for (const [k, v] of Object.entries(wire)) if (v !== undefined) raw[k] = v;
  // rules_passed must complete the identity for the clean case: 90 + 10 = 100.
  if (__alias === "present") raw.scanner_note = "aside";
  return normalizeReport("enum", raw, { requirement: REQUIREMENT, source: "enum" });
};
const rawRes = enumerateGrantSafety({
  domains: rawDomains,
  build: buildRaw,
  evaluate: (r) => evaluateBenchmarkSelection(r),
  actionOf: (v) => (v.recommendedAction === "none" ? "none" : v.recommendedAction),
  confirmedWhenNone: (v) => v.selectionConfirmed === true,
  positivelyClean: (c) =>
    c.__alias !== "present" &&
    c.benchmark_title === OK_TITLE &&
    c.benchmark_version === OK_VERSION &&
    c.source_provenance === "cis_published" &&
    c.observed_platform === "macOS 15" &&
    c.rules_passed === 90,
});
check(
  `exhaustive (raw wire): over all ${rawRes.combos} raw reports — a wrong document, an unlisted and a malformed version, an unlisted provenance spelling ("certified"), a mismatched platform, a numeric-STRING count and an aliased key — selection is confirmed only on the fully-clean report (mismatches=${rawRes.mismatches}${rawRes.firstMismatch ? ", first=" + rawRes.firstMismatch : ""})`,
  rawRes.mismatches === 0 && rawRes.combos === productOf(rawDomains) && rawRes.combos === 1920,
);
check("exhaustive (raw wire): exactly ONE raw report grants", rawRes.noneCount === 1);

// ── fusion into the fabric ──────────────────────────────────────────────────────
check("benchmark_selection is a member of the runtime SIGNAL_KINDS array — the union is derived, so the playbook proof covers it automatically",
  (SIGNAL_KINDS as readonly string[]).includes("benchmark_selection"));
const fusedMismatch = fromBenchmarkSelection(platformMismatch);
check("fromBenchmarkSelection maps the wrong-platform verdict onto the unified ladder as restrict",
  fusedMismatch.kind === "benchmark_selection" && fusedMismatch.action === "restrict" && fusedMismatch.reason === "ASSESSOR_PLATFORM_MISMATCH");
// THE HEADLINE. Every other device signal is clean — posture healthy, management
// plane healthy — and the hardening result the fabric would otherwise read as
// assurance was produced against a benchmark for a different platform. (The
// alignment answer itself lives in the core evidence model as `baselineCompliance`,
// a different layer from these composable kinds, which is exactly why it could
// report `aligned` with nothing here to contradict it.)
const fused = composeDeviceRisk([
  { kind: "device_posture", posture: "healthy", action: "none", reason: "OK" },
  { kind: "device_management_health", posture: "healthy", action: "none", reason: "OK" },
  fusedMismatch,
]);
check("THE HEADLINE: an otherwise-clean device whose hardening result came from a benchmark for another platform no longer composes to an allow",
  fused.strongestAction === "restrict" && fused.drivers[0]?.kind === "benchmark_selection");
const fusedClean = composeDeviceRisk([
  { kind: "device_posture", posture: "healthy", action: "none", reason: "OK" },
  fromBenchmarkSelection(grant),
]);
check("...and a confirmed selection contributes none — the dimension never lowers, only raises",
  fusedClean.strongestAction === "none");

// Determinism.
const d1 = normalizeReport("det", clean(), { requirement: REQUIREMENT });
check("evaluator is deterministic",
  JSON.stringify(evaluateBenchmarkSelection(d1)) === JSON.stringify(evaluateBenchmarkSelection(d1)));

const total = passed + failures.length;
console.log(`figures=catalogEntries=${catalog.derived.entries},catalogTitles=${catalog.derived.titles},supersededRows=${catalog.derived.supersededRows},normalizedCombos=${normRes.combos},rawCombos=${rawRes.combos},grantingCombos=${normRes.noneCount},rawGrantingCombos=${rawRes.noneCount},ladderRungs=6`);
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
