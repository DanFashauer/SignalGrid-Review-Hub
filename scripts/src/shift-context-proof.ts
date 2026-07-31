// Shift-context decision proof — fully OFFLINE and deterministic.
//
// Right person, wrong time is still the wrong decision context. This proof pins the
// labor plane's doctrine across every failure mode: scheduled NOW but clocked out
// (off-the-clock work → step_up); operating while neither scheduled nor punched in
// (off-duty → step_up); clocked in outside any reported window (schedule deviation
// → monitor, visible not blocked); on break (monitor); the shift placing the worker
// at a DIFFERENT site than the device (step_up); and every unknown raising. The
// grant needs FIVE affirmative clauses, no clock ever ticks in a decision path (the
// reference instant is caller-supplied), and the same worker grades differently at
// two reference instants — the temporal point, pinned directly.
import {
  ShiftContextConnector,
  ShiftContextConnectorError,
  compareSites,
  createMockShiftContextTransport,
  deriveScheduleStanding,
  evaluateShiftContext,
  guardReadOnly,
  normalizeShiftReport,
  resolveShiftContextConnector,
  type NormalizedShiftContext,
  type ShiftContextReportRaw,
} from "@workspace/integrations/shift-context";
import { SIGNAL_KINDS, composeDeviceRisk, fromShiftContext } from "@workspace/posture-composition";
import { enumerateGrantSafety, productOf } from "./lib/grant-safety.js";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Shift-context decision proof");

/** Reference instant supplied by the CALLER — the proof's fixed "now". */
const REF = "2026-07-31T14:00:00Z";
const SITE = "Mercy General ICU";

/** A fully-clean report: on a shift that contains REF, clocked in, at the device's
 *  site. Each targeted check below changes exactly ONE field of it. */
const clean = (over: ShiftContextReportRaw = {}): ShiftContextReportRaw => ({
  worker_ref: "wfm-4471",
  punch_status: "clocked_in",
  shift_start: "2026-07-31T07:00:00Z",
  shift_end: "2026-07-31T19:00:00Z",
  scheduled_site: SITE,
  scheduled_role: "RN",
  last_punch_time: "2026-07-31T06:58:00Z",
  source_system: "ukg-pro",
  ...over,
});

const ev = (r: ShiftContextReportRaw, deviceSite: string | undefined = SITE, referenceTime: string | undefined = REF) =>
  evaluateShiftContext(normalizeShiftReport("w-1", r, { deviceSite, referenceTime }));

// ── the grant ───────────────────────────────────────────────────────────────────
const grant = ev(clean());
check("on shift + clocked in + at the scheduled site → the grant",
  grant.recommendedAction === "none" && grant.reasonCode === "ON_SHIFT_AND_ON_CLOCK" && grant.laborContextConfirmed === true);
check("...with no critical findings and no unknowns",
  grant.criticalFindings.length === 0 && grant.unknownSignals.length === 0);

// ── schedule x punch coherence: the headline axis ───────────────────────────────
const offClock = ev(clean({ punch_status: "clocked_out" }));
check("scheduled NOW and clocked out → step_up (OFF_CLOCK_ON_SHIFT): off-the-clock work or someone else's badge, and a challenge resolves both",
  offClock.recommendedAction === "step_up" && offClock.reasonCode === "OFF_CLOCK_ON_SHIFT" &&
  offClock.criticalFindings.includes("working_off_the_clock") && offClock.laborContextConfirmed === false);
const offDuty = ev(clean({ punch_status: "clocked_out", shift_start: "2026-07-30T07:00:00Z", shift_end: "2026-07-30T19:00:00Z" }));
check("neither scheduled nor punched in, yet operating → step_up (OFF_DUTY_OPERATION) — a step_up and NOT a restrict, because an emergency call-in is legitimate and a challenge resolves it",
  offDuty.recommendedAction === "step_up" && offDuty.reasonCode === "OFF_DUTY_OPERATION" &&
  offDuty.criticalFindings.includes("operating_while_off_duty"));
const deviation = ev(clean({ shift_start: "2026-07-30T07:00:00Z", shift_end: "2026-07-30T19:00:00Z" }));
check("clocked in OUTSIDE any reported window → monitor (UNSCHEDULED_CLOCK_IN): real overtime happens — visible, never blocked",
  deviation.recommendedAction === "monitor" && deviation.reasonCode === "UNSCHEDULED_CLOCK_IN" &&
  deviation.criticalFindings.includes("unscheduled_clock_in"));
const onBreak = ev(clean({ punch_status: "on_break" }));
check("on shift and on break → monitor (ON_BREAK): carried so controlled work on break is attributable",
  onBreak.recommendedAction === "monitor" && onBreak.reasonCode === "ON_BREAK");
check("off shift and on break grades as the SAME schedule deviation as an unscheduled clock-in",
  ev(clean({ punch_status: "on_break", shift_start: "2026-07-30T07:00:00Z", shift_end: "2026-07-30T19:00:00Z" })).reasonCode === "UNSCHEDULED_CLOCK_IN");

// THE TEMPORAL POINT: same report, same worker, two reference instants.
check("the SAME record grades grant at 14:00 and OFF_DUTY at 03:00 the next day — nothing about the worker changed, only the instant",
  ev(clean({ punch_status: "clocked_out" }), SITE, "2026-08-01T03:00:00Z").reasonCode === "OFF_DUTY_OPERATION" &&
  ev(clean(), SITE, REF).recommendedAction === "none");

// ── the derivation, asserted directly ───────────────────────────────────────────
check("deriveScheduleStanding maps its cases directly: inside → on_shift, outside → off_shift, boundaries INCLUSIVE on both ends",
  deriveScheduleStanding(0, 100, 50) === "on_shift" &&
  deriveScheduleStanding(0, 100, 0) === "on_shift" &&
  deriveScheduleStanding(0, 100, 100) === "on_shift" &&
  deriveScheduleStanding(0, 100, 101) === "off_shift" &&
  deriveScheduleStanding(null, 100, 50) === "unknown" &&
  deriveScheduleStanding(0, null, 50) === "unknown" &&
  deriveScheduleStanding(0, 100, null) === "unknown");
check("a window that ends before it starts derives unknown, never a standing",
  deriveScheduleStanding(100, 0, 50) === "unknown");
const noRefNorm = normalizeShiftReport("w", clean(), { deviceSite: SITE });
check("no caller-supplied reference instant → standing unknown → step_up (the fabric refuses to sample a clock instead)",
  noRefNorm.scheduleStanding === "unknown" && evaluateShiftContext(noRefNorm).recommendedAction === "step_up" &&
  evaluateShiftContext(noRefNorm).unknownSignals.includes("schedule_standing"));
const noWindow = ev(clean({ shift_start: undefined, shift_end: undefined }));
check("no shift window reported → step_up (SCHEDULE_UNKNOWN), never assumed on-shift",
  noWindow.recommendedAction === "step_up" && noWindow.reasonCode === "SCHEDULE_UNKNOWN");
const noPunch = ev(clean({ punch_status: undefined }));
check("an absent punch → step_up (PUNCH_UNKNOWN), NOT an assumed clocked_in — silence is not an affirmative",
  noPunch.recommendedAction === "step_up" && noPunch.reasonCode === "PUNCH_UNKNOWN" &&
  noPunch.unknownSignals.includes("punch_status"));

// ── site: the caller poses the question ─────────────────────────────────────────
const mismatch = ev(clean({ scheduled_site: "Mercy General Med-Surg 3" }));
check("the shift places the worker at a DIFFERENT site than the device → step_up (SITE_MISMATCH): floating staff are real, so are borrowed badges",
  mismatch.recommendedAction === "step_up" && mismatch.reasonCode === "SITE_MISMATCH" &&
  mismatch.criticalFindings.includes("site_mismatch"));
check("site comparison is formatting-tolerant but never inferential: ' MERCY  GENERAL icu ' matches; no geo or alias guessing",
  compareSites("Mercy General ICU", " MERCY  GENERAL icu ") === "matched" &&
  compareSites("Building 7A", "Site 7") === "mismatched");
const unposed = ev(clean(), undefined);
check("the caller supplies NO device site → 'unassessed', carried and still granting — nobody posed the question, and that fact is visible rather than defaulted to a match",
  normalizeShiftReport("w", clean(), { referenceTime: REF }).siteMatch === "unassessed" &&
  unposed.recommendedAction === "none");
const posedUnanswerable = ev(clean({ scheduled_site: undefined }));
check("the question POSED (device site supplied) and the WFM reports no scheduled site → step_up (SITE_UNKNOWN) — posed-but-unanswerable raises",
  posedUnanswerable.recommendedAction === "step_up" && posedUnanswerable.reasonCode === "SITE_UNKNOWN" &&
  posedUnanswerable.unknownSignals.includes("site_match"));
check("compareSites maps its cases directly, including the unposed/unanswerable split",
  compareSites(SITE, null) === "unassessed" && compareSites(null, SITE) === "unknown" && compareSites(null, null) === "unassessed");

// ── uncovered ───────────────────────────────────────────────────────────────────
const uncovered = evaluateShiftContext(normalizeShiftReport("w", clean(), { deviceSite: SITE, referenceTime: REF }), { covered: false });
check("no WFM record for this worker (covered=false) → step_up (NOT_COVERED): agency and contractor staff are an honest hole, not a pass",
  uncovered.recommendedAction === "step_up" && uncovered.reasonCode === "NOT_COVERED" &&
  uncovered.unknownSignals.includes("wfm_record"));

// ── malformed / hostile report shapes ───────────────────────────────────────────
const extraKey = normalizeShiftReport("x", { ...clean(), overtime_note: "approved" } as ShiftContextReportRaw,
  { deviceSite: SITE, referenceTime: REF });
check("an unrecognized key refuses AS malformed (REPORT_MALFORMED from its own branch, not merely via the backstop)",
  extraKey.reportIntegrity === "malformed" &&
  evaluateShiftContext(extraKey).reasonCode === "REPORT_MALFORMED" &&
  evaluateShiftContext(extraKey).recommendedAction !== "none" &&
  evaluateShiftContext(extraKey).unknownSignals.includes("report_integrity"));
check("when the schedule is unknown AND the site mismatches, the schedule branch LEADS — pinning that the unknown-standing rung is its own branch and not the backstop wearing its reason",
  ev(clean({ shift_start: undefined, shift_end: undefined, scheduled_site: "Mercy General Med-Surg 3" })).reasonCode === "SCHEDULE_UNKNOWN");
check("a junk punch spelling ('working') alone → malformed, never coerced to a listed value",
  normalizeShiftReport("j", clean({ punch_status: "working" }), { deviceSite: SITE, referenceTime: REF }).reportIntegrity === "malformed");
check("an ASSERTED instant we cannot read ('this morning') is malformed — an assertion, not silence",
  normalizeShiftReport("j2", clean({ shift_start: "this morning" }), { deviceSite: SITE, referenceTime: REF }).reportIntegrity === "malformed" &&
  normalizeShiftReport("j2", clean({ shift_start: "this morning" }), { deviceSite: SITE, referenceTime: REF }).scheduleStanding === "unknown");
check("a shift window that ENDS BEFORE IT STARTS is a wire contradiction → malformed",
  normalizeShiftReport("j3", clean({ shift_start: "2026-07-31T19:00:00Z", shift_end: "2026-07-31T07:00:00Z" }),
    { deviceSite: SITE, referenceTime: REF }).reportIntegrity === "malformed");
const inherited = evaluateShiftContext(
  normalizeShiftReport("i", Object.create(clean()) as ShiftContextReportRaw, { deviceSite: SITE, referenceTime: REF }));
check("a report with ZERO own keys asserts nothing and cannot grant", inherited.recommendedAction !== "none");
const hidden = new Proxy(clean(), { ownKeys: () => [], getOwnPropertyDescriptor: () => undefined }) as ShiftContextReportRaw;
check("a Proxy hiding its own descriptors reads as absent and cannot grant",
  evaluateShiftContext(normalizeShiftReport("px", hidden, { deviceSite: SITE, referenceTime: REF })).recommendedAction !== "none");
const throwingKeys = new Proxy(clean(), { ownKeys: () => { throw new Error("hostile"); } }) as ShiftContextReportRaw;
check("a Proxy that THROWS from ownKeys fails closed",
  evaluateShiftContext(normalizeShiftReport("tk", throwingKeys, { deviceSite: SITE, referenceTime: REF })).recommendedAction !== "none");
const throwingAccessor = { ...clean() } as ShiftContextReportRaw;
Object.defineProperty(throwingAccessor, "punch_status", { enumerable: true, get() { throw new Error("boom"); } });
let accessorThrew = false;
try {
  check("a throwing ACCESSOR fails closed to malformed without an exception",
    normalizeShiftReport("ta", throwingAccessor, { deviceSite: SITE, referenceTime: REF }).reportIntegrity === "malformed");
} catch { accessorThrew = true; }
check("...and no exception escaped the normalizer", accessorThrew === false);
check("a non-object report body is malformed, not a thrown TypeError",
  normalizeShiftReport("s", "boom" as unknown as ShiftContextReportRaw, { deviceSite: SITE, referenceTime: REF }).reportIntegrity === "malformed");
check("a null report body is malformed, not a thrown TypeError",
  normalizeShiftReport("n", null as unknown as ShiftContextReportRaw, { deviceSite: SITE, referenceTime: REF }).reportIntegrity === "malformed");
check("Object.prototype itself as the report is malformed (polluted-prototype fields must never read as own assertions)",
  normalizeShiftReport("op", Object.prototype as ShiftContextReportRaw, { deviceSite: SITE, referenceTime: REF }).reportIntegrity === "malformed");
let deepProto: object = {};
for (let i = 0; i < 100; i += 1) deepProto = Object.create(deepProto);
check("a report behind a 100-deep prototype chain is malformed (bounded walk)",
  normalizeShiftReport("deep", Object.assign(Object.create(deepProto), clean()) as ShiftContextReportRaw,
    { deviceSite: SITE, referenceTime: REF }).reportIntegrity === "malformed");

// ── connector surface + the live-call gate ──────────────────────────────────────
let readOnly = false;
try { guardReadOnly("POST"); } catch (err) { readOnly = err instanceof ShiftContextConnectorError && err.code === "read_only_violation"; }
check("a non-GET request is refused by the read-only guard", readOnly);
const conn = new ShiftContextConnector(
  { accessToken: "t", baseUrl: "https://wfm.example" },
  createMockShiftContextTransport({ reports: { "w-9": clean() } }),
);
check("the connector round-trip normalizes a clean report end to end (grantable)",
  evaluateShiftContext(await conn.fetchNormalized("w-9", { deviceSite: SITE, referenceTime: REF })).recommendedAction === "none");
check("an unknown worker yields an all-unknown report that cannot grant",
  evaluateShiftContext(await conn.fetchNormalized("w-unknown", { deviceSite: SITE, referenceTime: REF })).recommendedAction !== "none");
// The gate, clause by clause — each env flips ONE condition off a fully-armed one.
const armed = { SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true", SHIFT_CONTEXT_ACCESS_TOKEN: "tok" } as NodeJS.ProcessEnv;
check("fully-armed env resolves LIVE (with an injected transport)",
  resolveShiftContextConnector(armed, createMockShiftContextTransport()).mode === "live");
check("dev tier never makes live calls, whatever else is set",
  resolveShiftContextConnector({ ...armed, SIGNALGRID_TIER: "dev" }).mode === "fixture");
check("the live flag must be the exact lowercase string 'true'",
  resolveShiftContextConnector({ ...armed, SIGNALGRID_LIVE_INTEGRATIONS: "TRUE" }).mode === "fixture");
check("a missing or blank credential resolves fixture",
  resolveShiftContextConnector({ ...armed, SHIFT_CONTEXT_ACCESS_TOKEN: "  " }).mode === "fixture");
check("an empty env resolves fixture with a stated reason",
  resolveShiftContextConnector({} as NodeJS.ProcessEnv).mode === "fixture");

// ── exhaustive (normalized): the grant is the five-clause conjunction ───────────
const normDomains = {
  scheduleStanding: ["on_shift", "off_shift", "unknown"],
  punchStatus: ["clocked_in", "on_break", "clocked_out", "unknown"],
  siteMatch: ["matched", "mismatched", "unassessed", "unknown"],
  reportIntegrity: ["clean", "malformed"],
};
const buildNorm = (c: Record<string, unknown>): NormalizedShiftContext => ({
  sourceSystem: "shift-context", workerRef: "enum", source: "enum",
  scheduleStanding: c.scheduleStanding as NormalizedShiftContext["scheduleStanding"],
  punchStatus: c.punchStatus as NormalizedShiftContext["punchStatus"],
  siteMatch: c.siteMatch as NormalizedShiftContext["siteMatch"],
  reportIntegrity: c.reportIntegrity as NormalizedShiftContext["reportIntegrity"],
  wfmWorkerRef: null, shiftStart: null, shiftEnd: null, scheduledSite: null, deviceSite: null,
  scheduledRole: null, lastPunchTime: null, wfmSource: null,
});
const normRes = enumerateGrantSafety({
  domains: normDomains,
  build: buildNorm,
  evaluate: (r) => evaluateShiftContext(r),
  actionOf: (v) => (v.recommendedAction === "none" ? "none" : v.recommendedAction),
  confirmedWhenNone: (v) => v.laborContextConfirmed === true && v.criticalFindings.length === 0 && v.unknownSignals.length === 0,
  positivelyClean: (c) =>
    c.reportIntegrity === "clean" &&
    c.scheduleStanding === "on_shift" &&
    c.punchStatus === "clocked_in" &&
    (c.siteMatch === "matched" || c.siteMatch === "unassessed"),
});
check(
  `exhaustive (normalized): over all ${normRes.combos} states, labor context is confirmed ONLY on the five-clause conjunction (mismatches=${normRes.mismatches}${normRes.firstMismatch ? ", first=" + normRes.firstMismatch : ""})`,
  normRes.mismatches === 0 && normRes.combos === productOf(normDomains) && normRes.combos === 96,
);
check("exhaustive (normalized): exactly 2 states grant — matched site and the visibly-unposed site question",
  normRes.noneCount === 2);

// ── exhaustive (raw wire): normalizer + evaluator on hostile input ──────────────
// The alternate window STARTS AFTER the reference instant (off-shift at REF), and
// its cross-pairing with the clean end is start>end — a wire contradiction. Chosen
// so no cross-product of starts and ends forms a second window containing REF: an
// earlier draft used yesterday's window and the sweep itself caught the resulting
// second legitimately-granting combo, which is the enumeration doing its job.
const rawDomains = {
  punch_status: ["clocked_in", "on_break", "clocked_out", undefined, "working"],
  shift_start: ["2026-07-31T07:00:00Z", "2026-07-31T15:00:00Z", "this morning", undefined],
  shift_end: ["2026-07-31T19:00:00Z", "2026-07-31T06:00:00Z", undefined],
  scheduled_site: [SITE, "Mercy General Med-Surg 3", undefined],
  __alias: ["absent", "present"],
};
const buildRaw = (c: Record<string, unknown>): NormalizedShiftContext => {
  const { __alias, ...wire } = c;
  const raw: ShiftContextReportRaw = { worker_ref: "wfm-4471", source_system: "ukg-pro" };
  for (const [k, v] of Object.entries(wire)) if (v !== undefined) raw[k] = v;
  if (__alias === "present") raw.overtime_note = "aside";
  return normalizeShiftReport("enum", raw, { deviceSite: SITE, referenceTime: REF, source: "enum" });
};
const rawRes = enumerateGrantSafety({
  domains: rawDomains,
  build: buildRaw,
  evaluate: (r) => evaluateShiftContext(r),
  actionOf: (v) => (v.recommendedAction === "none" ? "none" : v.recommendedAction),
  confirmedWhenNone: (v) => v.laborContextConfirmed === true,
  positivelyClean: (c) =>
    c.__alias !== "present" &&
    c.punch_status === "clocked_in" &&
    c.shift_start === "2026-07-31T07:00:00Z" &&
    c.shift_end === "2026-07-31T19:00:00Z" &&
    c.scheduled_site === SITE,
});
check(
  `exhaustive (raw wire): over all ${rawRes.combos} raw reports — a junk punch spelling, an unreadable window, a not-yet-started window, a self-contradictory start/end pairing, a wrong site and an aliased key — labor context is confirmed only on the fully-clean report (mismatches=${rawRes.mismatches}${rawRes.firstMismatch ? ", first=" + rawRes.firstMismatch : ""})`,
  rawRes.mismatches === 0 && rawRes.combos === productOf(rawDomains) && rawRes.combos === 360,
);
check("exhaustive (raw wire): exactly ONE raw report grants", rawRes.noneCount === 1);

// ── fusion into the fabric ──────────────────────────────────────────────────────
check("shift_context is a member of the runtime SIGNAL_KINDS array — the union is derived, so the playbook proof covers it automatically",
  (SIGNAL_KINDS as readonly string[]).includes("shift_context"));
const fusedOffClock = fromShiftContext(offClock);
check("fromShiftContext maps the off-the-clock verdict onto the unified ladder as step_up",
  fusedOffClock.kind === "shift_context" && fusedOffClock.action === "step_up" && fusedOffClock.reason === "OFF_CLOCK_ON_SHIFT");
// THE HEADLINE. Every other device signal is clean — posture healthy, management
// plane healthy — and the labor plane says this worker is not on the clock. Until
// this dimension, nothing composed could see it.
const fused = composeDeviceRisk([
  { kind: "device_posture", posture: "healthy", action: "none", reason: "OK" },
  { kind: "device_management_health", posture: "healthy", action: "none", reason: "OK" },
  fusedOffClock,
]);
check("THE HEADLINE: an otherwise-clean device operated by a worker the labor plane says is off the clock no longer composes to an allow",
  fused.strongestAction === "step_up" && fused.drivers[0]?.kind === "shift_context");
const fusedClean = composeDeviceRisk([
  { kind: "device_posture", posture: "healthy", action: "none", reason: "OK" },
  fromShiftContext(grant),
]);
check("...and a confirmed labor context contributes none — the dimension never lowers, only raises",
  fusedClean.strongestAction === "none");

// Determinism.
const d1 = normalizeShiftReport("det", clean(), { deviceSite: SITE, referenceTime: REF });
check("evaluator is deterministic",
  JSON.stringify(evaluateShiftContext(d1)) === JSON.stringify(evaluateShiftContext(d1)));

const total = passed + failures.length;
console.log(`figures=normalizedCombos=${normRes.combos},rawCombos=${rawRes.combos},grantingCombos=${normRes.noneCount},rawGrantingCombos=${rawRes.noneCount},gateClauses=4,ladderRungs=6`);
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
