// Change-window decision proof — fully OFFLINE and deterministic.
//
// An approval is a claim about a SPECIFIC time, actor and record, and this proof
// pins each of those separately: approved but outside the window (step_up), not yet
// approved (step_up), rejected or cancelled (restrict — the organization holds an
// explicit denial), a closed record still being worked under (step_up), an
// implementer the record does not name (step_up), a record read older than the
// caller's own maximum age (step_up), and every unknown raising.
//
// The load-bearing negative is the LAST section: this dimension can only raise.
// There is deliberately no "we are inside the maintenance window, so relax" rung —
// that is how change integrations usually work elsewhere, and it would turn an ITSM
// row into a grant. The proof asserts it by COMPOSITION rather than by inspection:
// every one of the 576 reachable verdicts is fused alongside a device that is
// already stepping up, and none of them lowers the composed outcome. It also
// asserts that `change_class: "emergency"` — the field most likely to be written by
// someone who wants a pass — changes nothing.
import {
  makeDefaultChangeWindowTransport,
  ChangeWindowConnector,
  ChangeWindowConnectorError,
  compareChangeActors,
  createMockChangeWindowTransport,
  deriveChangeRecordFreshness,
  deriveChangeWindowStanding,
  evaluateChangeWindow,
  guardReadOnly,
  normalizeChangeReport,
  resolveChangeWindowConnector,
  type ChangeWindowReportRaw,
  type NormalizedChangeWindow,
} from "@workspace/integrations/change-window";
import { ACTION_RANK, SIGNAL_KINDS, composeDeviceRisk, fromChangeWindow } from "@workspace/posture-composition";
import { enumerateGrantSafety, productOf } from "./lib/grant-safety.js";
import { checkDefaultTransport, checkLiveGateIsolated } from "./lib/live-gate.js";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Change-window decision proof");

/** Reference instant supplied by the CALLER — the proof's fixed "now", mid-way
 *  through a night maintenance window. */
const REF = "2026-07-31T22:30:00Z";
const ACTOR = "svc-desk-eng-14";
const MAX_AGE = 900; // the caller will act on a change-record read up to 15 minutes old

/** A fully-clean record: approved, a window containing REF, naming the operating
 *  engineer, read five minutes ago. Each targeted check below changes exactly ONE
 *  field of it. */
const clean = (over: ChangeWindowReportRaw = {}): ChangeWindowReportRaw => ({
  change_ref: "CHG0041882",
  change_state: "approved",
  window_start: "2026-07-31T22:00:00Z",
  window_end: "2026-08-01T02:00:00Z",
  authorized_actor_ref: ACTOR,
  change_class: "normal",
  record_observed_at: "2026-07-31T22:25:00Z",
  source_system: "servicenow",
  ...over,
});

const ev = (
  r: ChangeWindowReportRaw,
  operatingActorRef: string | undefined = ACTOR,
  referenceTime: string | undefined = REF,
  maxChangeRecordAgeSeconds: number | undefined = MAX_AGE,
) => evaluateChangeWindow(normalizeChangeReport("c-1", r, { operatingActorRef, referenceTime, maxChangeRecordAgeSeconds }));

// ── the grant ───────────────────────────────────────────────────────────────────
const grant = ev(clean());
check("approved + inside the window + the named implementer + a current read → the grant",
  grant.recommendedAction === "none" && grant.reasonCode === "CHANGE_AUTHORIZED" && grant.changeAuthorized === true);
check("...with no critical findings and no unknowns",
  grant.criticalFindings.length === 0 && grant.unknownSignals.length === 0);

// ── the ITSM's own state ────────────────────────────────────────────────────────
const rejected = ev(clean({ change_state: "rejected" }));
check("a REJECTED change being worked anyway → restrict (CHANGE_REFUSED): the organization holds an explicit denial, not an absence — the access-governance-decertified class",
  rejected.recommendedAction === "restrict" && rejected.reasonCode === "CHANGE_REFUSED" &&
  rejected.criticalFindings.includes("change_rejected") && rejected.changeAuthorized === false);
const cancelled = ev(clean({ change_state: "cancelled" }));
check("a CANCELLED change grades as the same refusal, with its own finding",
  cancelled.recommendedAction === "restrict" && cancelled.reasonCode === "CHANGE_REFUSED" &&
  cancelled.criticalFindings.includes("change_cancelled"));
const pending = ev(clean({ change_state: "pending_approval" }));
check("a change raised but NOT YET APPROVED → step_up (CHANGE_NOT_APPROVED): emergency work is routinely started before the CAB catches up — visible and answerable, not blocked",
  pending.recommendedAction === "step_up" && pending.reasonCode === "CHANGE_NOT_APPROVED" &&
  pending.criticalFindings.includes("change_awaiting_approval"));
const closed = ev(clean({ change_state: "closed" }));
check("work continuing under a CLOSED record → step_up (CHANGE_RECORD_CLOSED): unattributable rather than unauthorized",
  closed.recommendedAction === "step_up" && closed.reasonCode === "CHANGE_RECORD_CLOSED" &&
  closed.criticalFindings.includes("change_record_closed"));
const noState = ev(clean({ change_state: undefined }));
check("an ABSENT change state → step_up (APPROVAL_UNKNOWN), never an assumed approval — silence is not an affirmative",
  noState.recommendedAction === "step_up" && noState.reasonCode === "APPROVAL_UNKNOWN" &&
  noState.unknownSignals.includes("approval_state"));

// ── the temporal axis: is the approval about NOW? ────────────────────────────────
const outside = ev(clean({ window_start: "2026-08-01T01:00:00Z" }));
check("approved, but the reference instant is BEFORE the window opens → step_up (OUTSIDE_CHANGE_WINDOW)",
  outside.recommendedAction === "step_up" && outside.reasonCode === "OUTSIDE_CHANGE_WINDOW" &&
  outside.criticalFindings.includes("operating_outside_change_window"));
// THE TEMPORAL POINT: same record, same actor, two reference instants.
check("the SAME approved record grades grant at 22:30 and OUTSIDE_CHANGE_WINDOW at 04:00 — nothing about the change or the operator changed, only the instant",
  ev(clean(), ACTOR, "2026-08-01T04:00:00Z").reasonCode === "OUTSIDE_CHANGE_WINDOW" &&
  ev(clean()).recommendedAction === "none");
check("deriveChangeWindowStanding maps its cases directly: inside → inside, outside → outside, boundaries INCLUSIVE on both ends",
  deriveChangeWindowStanding(0, 100, 50) === "inside" &&
  deriveChangeWindowStanding(0, 100, 0) === "inside" &&
  deriveChangeWindowStanding(0, 100, 100) === "inside" &&
  deriveChangeWindowStanding(0, 100, 101) === "outside" &&
  deriveChangeWindowStanding(null, 100, 50) === "unknown" &&
  deriveChangeWindowStanding(0, null, 50) === "unknown" &&
  deriveChangeWindowStanding(0, 100, null) === "unknown");
check("a window that closes before it opens derives unknown, never a standing",
  deriveChangeWindowStanding(100, 0, 50) === "unknown");
const noRefNorm = normalizeChangeReport("c", clean(), { operatingActorRef: ACTOR });
check("no caller-supplied reference instant → standing unknown → step_up (the fabric refuses to sample a clock instead)",
  noRefNorm.windowStanding === "unknown" && evaluateChangeWindow(noRefNorm).recommendedAction === "step_up" &&
  evaluateChangeWindow(noRefNorm).unknownSignals.includes("window_standing"));
const noWindow = ev(clean({ window_start: undefined, window_end: undefined }));
check("an approved record with NO window at all → step_up (WINDOW_UNKNOWN), never assumed open-ended",
  noWindow.recommendedAction === "step_up" && noWindow.reasonCode === "WINDOW_UNKNOWN");

// ── the implementer: the caller poses the question ──────────────────────────────
const wrongActor = ev(clean({ authorized_actor_ref: "svc-desk-eng-02" }));
check("the record names a DIFFERENT implementer → step_up (ACTOR_NOT_AUTHORIZED): hand-offs are real, so are borrowed credentials",
  wrongActor.recommendedAction === "step_up" && wrongActor.reasonCode === "ACTOR_NOT_AUTHORIZED" &&
  wrongActor.criticalFindings.includes("actor_not_named_on_change"));
check("actor comparison is formatting-tolerant but never inferential: ' SVC-DESK-ENG-14 ' matches; no directory expansion",
  compareChangeActors(ACTOR, " SVC-DESK-ENG-14 ") === "authorized" &&
  compareChangeActors("J. Smith", "jsmith") === "unauthorized");
check("the caller supplies NO operating actor → 'unassessed', carried and still granting — nobody posed the question, and that fact is visible rather than defaulted to a match",
  normalizeChangeReport("c", clean(), { referenceTime: REF, maxChangeRecordAgeSeconds: MAX_AGE }).actorAuthorization === "unassessed" &&
  ev(clean(), undefined).recommendedAction === "none");
const posedUnanswerable = ev(clean({ authorized_actor_ref: undefined }));
check("the question POSED (operating actor supplied) and the record names no implementer → step_up (ACTOR_UNKNOWN) — posed-but-unanswerable raises",
  posedUnanswerable.recommendedAction === "step_up" && posedUnanswerable.reasonCode === "ACTOR_UNKNOWN" &&
  posedUnanswerable.unknownSignals.includes("actor_authorization"));
check("compareChangeActors maps its cases directly, including the unposed/unanswerable split",
  compareChangeActors(ACTOR, null) === "unassessed" && compareChangeActors(null, ACTOR) === "unknown" &&
  compareChangeActors(null, null) === "unassessed");

// ── currency: is the record evidence about NOW? ─────────────────────────────────
const stale = ev(clean({ record_observed_at: "2026-07-31T21:00:00Z" }));
check("a record read 90 minutes ago against a 15-minute maximum → step_up (CHANGE_RECORD_STALE): an old read is not evidence about now",
  stale.recommendedAction === "step_up" && stale.reasonCode === "CHANGE_RECORD_STALE" &&
  stale.criticalFindings.includes("change_record_stale"));
check("no maximum age posed → 'unassessed' and still granting; a caller with no recency opinion forecloses nothing",
  normalizeChangeReport("c", clean(), { operatingActorRef: ACTOR, referenceTime: REF }).recordFreshness === "unassessed" &&
  ev(clean(), ACTOR, REF, undefined).recommendedAction === "none");
const noObserved = ev(clean({ record_observed_at: undefined }));
check("a maximum age POSED and no read instant reported → step_up (CHANGE_RECORD_TIME_UNKNOWN)",
  noObserved.recommendedAction === "step_up" && noObserved.reasonCode === "CHANGE_RECORD_TIME_UNKNOWN" &&
  noObserved.unknownSignals.includes("record_freshness"));
check("deriveChangeRecordFreshness maps its cases directly, boundary INCLUSIVE",
  deriveChangeRecordFreshness("2026-07-31T22:25:00Z", 900, REF) === "fresh" &&
  deriveChangeRecordFreshness("2026-07-31T22:15:00Z", 900, REF) === "fresh" &&
  deriveChangeRecordFreshness("2026-07-31T22:14:59Z", 900, REF) === "stale" &&
  deriveChangeRecordFreshness("2026-07-31T22:25:00Z", undefined, REF) === "unassessed" &&
  deriveChangeRecordFreshness(null, 900, REF) === "unknown" &&
  deriveChangeRecordFreshness("2026-07-31T22:25:00Z", 900, undefined) === "unknown");
check("a malformed maximum age a loosely-typed caller can pose — a string, NaN, Infinity, zero, negative — is 'unknown', never treated as no-opinion",
  deriveChangeRecordFreshness("2026-07-31T22:25:00Z", "900" as unknown as number, REF) === "unknown" &&
  deriveChangeRecordFreshness("2026-07-31T22:25:00Z", Number.NaN, REF) === "unknown" &&
  deriveChangeRecordFreshness("2026-07-31T22:25:00Z", Number.POSITIVE_INFINITY, REF) === "unknown" &&
  deriveChangeRecordFreshness("2026-07-31T22:25:00Z", 0, REF) === "unknown" &&
  deriveChangeRecordFreshness("2026-07-31T22:25:00Z", -1, REF) === "unknown");
check("a read timestamped AFTER the caller's own reference instant is a contradiction → unknown, not an extremely fresh read",
  deriveChangeRecordFreshness("2026-08-01T00:00:00Z", 900, REF) === "unknown");

// ── the field designed to be abused ─────────────────────────────────────────────
const emergency = ev(clean({ change_class: "emergency", window_start: "2026-08-01T01:00:00Z" }));
check("THE TRAP, refused: change_class 'emergency' does NOT excuse operating outside the window — it is carried as evidence for the human answering the step-up, and the gate never reads it",
  emergency.recommendedAction === "step_up" && emergency.reasonCode === "OUTSIDE_CHANGE_WINDOW");
check("...and the class IS carried into the normalized evidence, so the reviewer sees what the record claimed",
  normalizeChangeReport("c", clean({ change_class: "emergency" }), { referenceTime: REF }).changeClass === "emergency");
check("an emergency class cannot rescue a rejected change either",
  ev(clean({ change_class: "emergency", change_state: "rejected" })).recommendedAction === "restrict");

// ── uncovered ───────────────────────────────────────────────────────────────────
const uncovered = evaluateChangeWindow(
  normalizeChangeReport("c", clean(), { operatingActorRef: ACTOR, referenceTime: REF, maxChangeRecordAgeSeconds: MAX_AGE }),
  { covered: false });
check("no change record at all for this reference (covered=false) → step_up (NOT_COVERED): an operation with no change record is an honest hole, not a pass",
  uncovered.recommendedAction === "step_up" && uncovered.reasonCode === "NOT_COVERED" &&
  uncovered.unknownSignals.includes("change_record"));

// ── malformed / hostile report shapes ───────────────────────────────────────────
const norm = (r: ChangeWindowReportRaw) =>
  normalizeChangeReport("x", r, { operatingActorRef: ACTOR, referenceTime: REF, maxChangeRecordAgeSeconds: MAX_AGE });
const extraKey = norm({ ...clean(), expedite_note: "approved verbally" } as ChangeWindowReportRaw);
check("an unrecognized key refuses AS malformed (REPORT_MALFORMED from its own branch, not merely via the backstop)",
  extraKey.reportIntegrity === "malformed" &&
  evaluateChangeWindow(extraKey).reasonCode === "REPORT_MALFORMED" &&
  evaluateChangeWindow(extraKey).recommendedAction !== "none" &&
  evaluateChangeWindow(extraKey).unknownSignals.includes("report_integrity"));
check("when the approval state is unknown AND the actor mismatches, the approval branch LEADS — pinning that the unknown-approval rung is its own branch and not the backstop wearing its reason",
  ev(clean({ change_state: undefined, authorized_actor_ref: "svc-desk-eng-02" })).reasonCode === "APPROVAL_UNKNOWN");
check("a junk change-state spelling ('green-lit') alone → malformed, never coerced to a listed value",
  norm(clean({ change_state: "green-lit" })).reportIntegrity === "malformed");
check("an ASSERTED instant we cannot read ('tonight') is malformed — an assertion, not silence",
  norm(clean({ window_start: "tonight" })).reportIntegrity === "malformed" &&
  norm(clean({ window_start: "tonight" })).windowStanding === "unknown");
check("a window that CLOSES BEFORE IT OPENS is a wire contradiction → malformed",
  norm(clean({ window_start: "2026-08-01T02:00:00Z", window_end: "2026-07-31T22:00:00Z" })).reportIntegrity === "malformed");
check("a non-Zulu window bound ('2026-07-31T22:00:00+00:00') is malformed — an instant this fabric compares must be unambiguous",
  norm(clean({ window_start: "2026-07-31T22:00:00+00:00" })).reportIntegrity === "malformed");
const inherited = evaluateChangeWindow(norm(Object.create(clean()) as ChangeWindowReportRaw));
check("a record with ZERO own keys asserts nothing and cannot grant", inherited.recommendedAction !== "none");
const hidden = new Proxy(clean(), { ownKeys: () => [], getOwnPropertyDescriptor: () => undefined }) as ChangeWindowReportRaw;
check("a Proxy hiding its own descriptors reads as absent and cannot grant",
  evaluateChangeWindow(norm(hidden)).recommendedAction !== "none");
const throwingKeys = new Proxy(clean(), { ownKeys: () => { throw new Error("hostile"); } }) as ChangeWindowReportRaw;
check("a Proxy that THROWS from ownKeys fails closed",
  evaluateChangeWindow(norm(throwingKeys)).recommendedAction !== "none");
const throwingAccessor = { ...clean() } as ChangeWindowReportRaw;
Object.defineProperty(throwingAccessor, "change_state", { enumerable: true, get() { throw new Error("boom"); } });
let accessorThrew = false;
try {
  check("a throwing ACCESSOR fails closed to malformed without an exception",
    norm(throwingAccessor).reportIntegrity === "malformed");
} catch { accessorThrew = true; }
check("...and no exception escaped the normalizer", accessorThrew === false);
check("a non-object record body is malformed, not a thrown TypeError",
  norm("boom" as unknown as ChangeWindowReportRaw).reportIntegrity === "malformed");
check("a null record body is malformed, not a thrown TypeError",
  norm(null as unknown as ChangeWindowReportRaw).reportIntegrity === "malformed");
check("Object.prototype itself as the record is malformed (polluted-prototype fields must never read as own assertions)",
  norm(Object.prototype as ChangeWindowReportRaw).reportIntegrity === "malformed");
let deepProto: object = {};
for (let i = 0; i < 100; i += 1) deepProto = Object.create(deepProto);
check("a record behind a 100-deep prototype chain is malformed (bounded walk)",
  norm(Object.assign(Object.create(deepProto), clean()) as ChangeWindowReportRaw).reportIntegrity === "malformed");

// ── connector surface + the live-call gate ──────────────────────────────────────
let readOnly = false;
try { guardReadOnly("POST"); } catch (err) { readOnly = err instanceof ChangeWindowConnectorError && err.code === "read_only_violation"; }
check("a non-GET request is refused by the read-only guard — SignalGrid never raises, approves, schedules or closes a change", readOnly);
const conn = new ChangeWindowConnector(
  { accessToken: "t", baseUrl: "https://itsm.example" },
  createMockChangeWindowTransport({ records: { "CHG-9": clean() } }),
);
check("the connector round-trip normalizes a clean record end to end (grantable)",
  evaluateChangeWindow(await conn.fetchNormalized("CHG-9", { operatingActorRef: ACTOR, referenceTime: REF, maxChangeRecordAgeSeconds: MAX_AGE })).recommendedAction === "none");
check("an unknown change reference yields an all-unknown record that cannot grant",
  evaluateChangeWindow(await conn.fetchNormalized("CHG-nope", { operatingActorRef: ACTOR, referenceTime: REF, maxChangeRecordAgeSeconds: MAX_AGE })).recommendedAction !== "none");
// The gate, clause by clause — each env flips ONE condition off a fully-armed one.
const armed = { SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true", CHANGE_WINDOW_ACCESS_TOKEN: "tok" } as NodeJS.ProcessEnv;
check("fully-armed env resolves LIVE (with an injected transport)",
  resolveChangeWindowConnector(armed, createMockChangeWindowTransport()).mode === "live");
check("dev tier never makes live calls, whatever else is set",
  resolveChangeWindowConnector({ ...armed, SIGNALGRID_TIER: "dev" }).mode === "fixture");
check("the live flag must be the exact lowercase string 'true'",
  resolveChangeWindowConnector({ ...armed, SIGNALGRID_LIVE_INTEGRATIONS: "TRUE" }).mode === "fixture");
check("a missing or blank credential resolves fixture",
  resolveChangeWindowConnector({ ...armed, CHANGE_WINDOW_ACCESS_TOKEN: "  " }).mode === "fixture");
check("an empty env resolves fixture with a stated reason",
  resolveChangeWindowConnector({} as NodeJS.ProcessEnv).mode === "fixture");

// ── exhaustive (normalized): the grant is the five-clause conjunction ───────────
const normDomains = {
  windowStanding: ["inside", "outside", "unknown"],
  approvalState: ["approved", "pending_approval", "rejected", "cancelled", "closed", "unknown"],
  actorAuthorization: ["authorized", "unauthorized", "unassessed", "unknown"],
  recordFreshness: ["fresh", "stale", "unknown", "unassessed"],
  reportIntegrity: ["clean", "malformed"],
};
const buildNorm = (c: Record<string, unknown>): NormalizedChangeWindow => ({
  sourceSystem: "change-window", changeRef: "enum", source: "enum",
  windowStanding: c.windowStanding as NormalizedChangeWindow["windowStanding"],
  approvalState: c.approvalState as NormalizedChangeWindow["approvalState"],
  actorAuthorization: c.actorAuthorization as NormalizedChangeWindow["actorAuthorization"],
  recordFreshness: c.recordFreshness as NormalizedChangeWindow["recordFreshness"],
  reportIntegrity: c.reportIntegrity as NormalizedChangeWindow["reportIntegrity"],
  itsmChangeRef: null, windowStart: null, windowEnd: null, authorizedActorRef: null,
  operatingActorRef: null, changeClass: null, recordObservedAt: null, itsmSource: null,
});
const normRes = enumerateGrantSafety({
  domains: normDomains,
  build: buildNorm,
  evaluate: (r) => evaluateChangeWindow(r),
  actionOf: (v) => (v.recommendedAction === "none" ? "none" : v.recommendedAction),
  confirmedWhenNone: (v) => v.changeAuthorized === true && v.criticalFindings.length === 0 && v.unknownSignals.length === 0,
  positivelyClean: (c) =>
    c.reportIntegrity === "clean" &&
    c.approvalState === "approved" &&
    c.windowStanding === "inside" &&
    (c.actorAuthorization === "authorized" || c.actorAuthorization === "unassessed") &&
    (c.recordFreshness === "fresh" || c.recordFreshness === "unassessed"),
});
check(
  `exhaustive (normalized): over all ${normRes.combos} states, a change is authorized ONLY on the five-clause conjunction (mismatches=${normRes.mismatches}${normRes.firstMismatch ? ", first=" + normRes.firstMismatch : ""})`,
  normRes.mismatches === 0 && normRes.combos === productOf(normDomains) && normRes.combos === 576,
);
check("exhaustive (normalized): exactly 4 states grant — the two visibly-unposed questions crossed with their affirmative answers",
  normRes.noneCount === 4);

// ── exhaustive (raw wire): normalizer + evaluator on hostile input ──────────────
// The alternate window STARTS AFTER the reference instant (outside at REF), and its
// cross-pairing with the clean end is a valid-but-outside window, while the
// alternate end pairs with either start as a close-before-open contradiction. Chosen
// so no cross-product of starts and ends forms a second window containing REF.
const rawDomains = {
  change_state: ["approved", "pending_approval", "rejected", "cancelled", "closed", undefined, "green-lit"],
  window_start: ["2026-07-31T22:00:00Z", "2026-08-01T01:00:00Z", "tonight", undefined],
  window_end: ["2026-08-01T02:00:00Z", "2026-07-31T21:00:00Z", undefined],
  authorized_actor_ref: [ACTOR, "svc-desk-eng-02", undefined],
  __alias: ["absent", "present"],
};
const buildRaw = (c: Record<string, unknown>): NormalizedChangeWindow => {
  const { __alias, ...wire } = c;
  const raw: ChangeWindowReportRaw = {
    change_ref: "CHG0041882",
    change_class: "normal",
    record_observed_at: "2026-07-31T22:25:00Z",
    source_system: "servicenow",
  };
  for (const [k, v] of Object.entries(wire)) if (v !== undefined) raw[k] = v;
  if (__alias === "present") raw.expedite_note = "approved verbally";
  return normalizeChangeReport("enum", raw, {
    operatingActorRef: ACTOR, referenceTime: REF, maxChangeRecordAgeSeconds: MAX_AGE, source: "enum",
  });
};
const rawRes = enumerateGrantSafety({
  domains: rawDomains,
  build: buildRaw,
  evaluate: (r) => evaluateChangeWindow(r),
  actionOf: (v) => (v.recommendedAction === "none" ? "none" : v.recommendedAction),
  confirmedWhenNone: (v) => v.changeAuthorized === true,
  positivelyClean: (c) =>
    c.__alias !== "present" &&
    c.change_state === "approved" &&
    c.window_start === "2026-07-31T22:00:00Z" &&
    c.window_end === "2026-08-01T02:00:00Z" &&
    c.authorized_actor_ref === ACTOR,
});
check(
  `exhaustive (raw wire): over all ${rawRes.combos} raw records — a junk state spelling, an unreadable window bound, a not-yet-open window, a close-before-open pairing, a different implementer and an aliased key — a change is authorized only on the fully-clean record (mismatches=${rawRes.mismatches}${rawRes.firstMismatch ? ", first=" + rawRes.firstMismatch : ""})`,
  rawRes.mismatches === 0 && rawRes.combos === productOf(rawDomains) && rawRes.combos === 504,
);
check("exhaustive (raw wire): exactly ONE raw record grants", rawRes.noneCount === 1);

// ── THE ASYMMETRY, asserted structurally ────────────────────────────────────────
// Every other family in this fabric shares the law, but change management is the one
// place the industry routinely breaks it — "we are in the window, so permit the
// privileged action" is a grant manufactured out of an ITSM row. The enumeration
// above already visits every reachable state; this asserts that NONE of them
// produced anything below `none`, which is a claim about the whole state space
// rather than about the cases somebody thought to write down.
// The test is composition, not inspection: fuse EVERY reachable change-window
// verdict alongside a device that is already stepping up, and assert the composed
// outcome never falls below that step_up. A family that could relax would show up
// here as an `allow` — and this is the whole state space, not the cases somebody
// thought to write down.
const DEGRADED = { kind: "device_posture" as const, posture: "degraded", action: "step_up" as const, reason: "OS_BEHIND" };
let relaxations = 0;
let emitted = new Set<string>();
for (const windowStanding of normDomains.windowStanding) {
  for (const approvalState of normDomains.approvalState) {
    for (const actorAuthorization of normDomains.actorAuthorization) {
      for (const recordFreshness of normDomains.recordFreshness) {
        for (const reportIntegrity of normDomains.reportIntegrity) {
          const v = evaluateChangeWindow(buildNorm({
            windowStanding, approvalState, actorAuthorization, recordFreshness, reportIntegrity,
          }));
          emitted.add(v.recommendedAction);
          const composed = composeDeviceRisk([DEGRADED, fromChangeWindow(v)]);
          // ACTION_RANK is the fabric's OWN ranking, imported rather than restated —
          // a hand-copied ladder here would drift from the one composition uses, and
          // this assertion is only worth anything if it ranks the way the fabric does.
          if (ACTION_RANK[composed.strongestAction] < ACTION_RANK["step_up"]) relaxations += 1;
        }
      }
    }
  }
}
check(
  `THE ASYMMETRY, over the whole state space: fused against an already-stepping-up device, not one of the ${normRes.combos} reachable change-window verdicts lowers the composed outcome (relaxations=${relaxations}) — there is no "we are in the window, so relax" rung`,
  relaxations === 0,
);
check(
  `...and the only actions this family can emit are ${[...emitted].sort().join("/")} — no rung exists that could buy down another dimension's concern`,
  emitted.size === 3 && emitted.has("none") && emitted.has("step_up") && emitted.has("restrict"),
);

// ── fusion into the fabric ──────────────────────────────────────────────────────
check("change_window is a member of the runtime SIGNAL_KINDS array — the union is derived, so the playbook proof covers it automatically",
  (SIGNAL_KINDS as readonly string[]).includes("change_window"));
const fusedOutside = fromChangeWindow(outside);
check("fromChangeWindow maps the outside-window verdict onto the unified ladder as step_up",
  fusedOutside.kind === "change_window" && fusedOutside.action === "step_up" && fusedOutside.reason === "OUTSIDE_CHANGE_WINDOW");
// THE HEADLINE. Every other device signal is clean — posture healthy, management
// plane healthy — and the change plane says this work is happening outside the
// window its own approval authorizes. Until this dimension, `change_window` was a
// declared flow signal carrying a HEALTH status; nothing composed could see it.
const fused = composeDeviceRisk([
  { kind: "device_posture", posture: "healthy", action: "none", reason: "OK" },
  { kind: "device_management_health", posture: "healthy", action: "none", reason: "OK" },
  fusedOutside,
]);
check("THE HEADLINE: an otherwise-clean device performing change-class work outside its approved window no longer composes to an allow",
  fused.strongestAction === "step_up" && fused.drivers[0]?.kind === "change_window");
const fusedRefused = composeDeviceRisk([
  { kind: "device_posture", posture: "healthy", action: "none", reason: "OK" },
  fromChangeWindow(rejected),
]);
check("...and a rejected change record composes to a restrict",
  fusedRefused.strongestAction === "restrict");
const fusedClean = composeDeviceRisk([
  { kind: "device_posture", posture: "degraded", action: "step_up", reason: "OS_BEHIND" },
  fromChangeWindow(grant),
]);
check("THE ASYMMETRY IN COMPOSITION: an authorized change does NOT rescue a degraded device — the window contributes `none`, and the step_up stands",
  fusedClean.strongestAction === "step_up" && fusedClean.drivers[0]?.kind === "device_posture");

// Determinism.
const d1 = normalizeChangeReport("det", clean(), { operatingActorRef: ACTOR, referenceTime: REF, maxChangeRecordAgeSeconds: MAX_AGE });
check("evaluator is deterministic",
  JSON.stringify(evaluateChangeWindow(d1)) === JSON.stringify(evaluateChangeWindow(d1)));


// ── The live-call gate and the default transport, each condition ISOLATED ────
//
// See `lib/live-gate.ts` for why this replaced what was here (or filled the hole where
// nothing was). Short version: the gate was tested as a cumulative ladder, so only its
// last condition was falsifiable, and the mutation guard could delete the tier check —
// the control behind "dev and alpha never make live vendor calls" — with every proof
// green. The default fetch transport was never executed by anything at all.
checkLiveGateIsolated({
  check,
  family: "change-window",
  resolve: (env) => resolveChangeWindowConnector(env),
  full: {
    SIGNALGRID_TIER: "prod",
    SIGNALGRID_LIVE_INTEGRATIONS: "true",
    CHANGE_WINDOW_ACCESS_TOKEN: "t",
  },
});

await checkDefaultTransport({
  check,
  family: "change-window",
  transport: makeDefaultChangeWindowTransport("https://vendor.invalid/change-window") as (a: never) => Promise<unknown>,
  arg: { changeRef: "changeRef-1", token: "t" },
  codeOf: (err) => (err instanceof ChangeWindowConnectorError ? err.code : undefined),
});

const total = passed + failures.length;
console.log(`figures=normalizedCombos=${normRes.combos},rawCombos=${rawRes.combos},grantingCombos=${normRes.noneCount},rawGrantingCombos=${rawRes.noneCount},gateClauses=5,ladderRungs=6`);
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
