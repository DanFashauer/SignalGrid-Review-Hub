// Adaptive-proposal governance lifecycle proof — fully OFFLINE and deterministic.
//
// Issue #136 acceptance criterion 6, made checkable: at least one adaptive
// recommendation is generated from SYNTHETIC event history, simulated, and left pending
// owner approval. This is the GOVERNED LIFECYCLE around a recommendation, not a
// recommendations engine (that already exists as `@workspace/recommendations`).
//
// `docs/VISION_PERSON_FIRST_GRID.md` fixes the canonical eight-step loop: observe →
// correlate → explain → recommend → simulate → require owner approval → version &
// activate → measure. What this proof pins is not a parse layer but a STATE MACHINE with
// one structurally enforced core invariant, enumerated over the whole transition table
// rather than spot-checked:
//
//   THE SAFETY INVARIANT — a proposal cannot activate itself. There is NO transition
//   from any pre-approval state directly to `activated`; activation is reachable only
//   through `approved`, which requires a NON-EMPTY approver ref — the human gate.
//
// Every refusal below is asserted WITH its reason code — this repo has paid for
// reason-blind checks before, so the discipline is applied from birth. Refusals thrown
// with hostile refs are asserted NOT to echo them (the no-echo discipline inherited from
// `@workspace/work-context`). The synthetic history is built through the REAL audit
// ledger (`@workspace/signalgrid-core` appendAudit), not a hand-rolled array.

import { MemoryStore, appendAudit, type AuditEvent } from "@workspace/signalgrid-core";
import {
  AdaptiveProposalError,
  LEGAL_TRANSITIONS,
  PATTERN_FLOOR,
  PROPOSAL_STATUSES,
  activate,
  approve,
  deriveProposals,
  isLegalTransition,
  measureActivated,
  reject,
  requestApproval,
  simulateProposal,
  supersede,
  type AdaptiveProposal,
  type ProposalStatus,
} from "@workspace/adaptive-proposals";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};
const codeOf = (fn: () => unknown): string | null => {
  try { fn(); } catch (err) { return err instanceof AdaptiveProposalError ? err.code : null; }
  return null;
};

console.log("Adaptive-proposal governance lifecycle proof");

// ── synthetic audit history, built through the REAL ledger ──────────────────────
//
// A picker keeps hitting a wrong-aisle bin; each time a human requests+approves the same
// reroute remediation. Four such manual resolutions of "wrong-aisle-bin-reroute" (one of
// them carrying no signal refs), plus TWO of a rare "freezer-door-alarm" — below the
// floor, so it must not become a proposal.

const TENANT = "tenant-warehouse";
const store = new MemoryStore();
let seq = 0;
const appendManualResolution = (subject: string, references: string[]): AuditEvent =>
  appendAudit(store, {
    tenantId: TENANT,
    type: "remediation.approved",
    actor: "user:supervisor-42",
    subject,
    summary: `manual reroute of ${subject}`,
    references,
    recordedAt: `asm-${String(++seq).padStart(4, "0")}`,
  });

appendManualResolution("wrong-aisle-bin-reroute", ["signal-badge-zone-drift", "signal-bin-mismatch"]);
appendManualResolution("wrong-aisle-bin-reroute", ["signal-badge-zone-drift"]);
appendManualResolution("wrong-aisle-bin-reroute", ["signal-bin-mismatch", "signal-scan-retry"]);
appendManualResolution("wrong-aisle-bin-reroute", []); // no signal refs → simulation won't count this one
appendManualResolution("freezer-door-alarm", ["signal-temp-excursion"]);
appendManualResolution("freezer-door-alarm", ["signal-temp-excursion"]);

const history = store.listAudit(TENANT);

// ── steps 1–4: observe → correlate → explain → recommend ────────────────────────

const proposals = deriveProposals(history);
check("mining synthetic audit history yields exactly one proposal — the repeated pattern, not the one-off",
  proposals.length === 1);

const draft = proposals[0];
check("(e) FLOOR: the sub-floor 'freezer-door-alarm' (2 < 3) is NOT emitted — a one-off is an incident, not a pattern",
  !proposals.some((p) => p.recommendation.target === "freezer-door-alarm") && PATTERN_FLOOR === 3);
check("the emitted proposal targets the repeated pattern with observedIncidentCount >= 3 (=4)",
  draft.recommendation.target === "wrong-aisle-bin-reroute" && draft.provenance.observedIncidentCount === 4);
check("provenance carries opaque source event refs mined from the ledger",
  draft.provenance.sourceEventRefs.length === 4 && draft.provenance.sourceEventRefs.every((r) => r.startsWith("aud")));
check("the 'explain' step is human-readable and states the pattern and its count",
  draft.provenance.correlationSummary.includes("preceded a manual resolution") && draft.provenance.correlationSummary.includes("4 times"));
check("the recommendation is DATA — a described change reusing the advisory engine's vocabulary, never executable",
  draft.recommendation.kind === "automate_action" && typeof draft.recommendation.description === "string");
check("a freshly minted draft is version 1, status 'draft', with no simulation/approval/measurement",
  draft.version === 1 && draft.status === "draft" && draft.simulation === null && draft.approval === null && draft.measurement === null);

// ── step 5: simulate against the SAME history it was mined from ──────────────────

const simulated = simulateProposal(draft, history);
check("simulate: status → 'simulated', version 1 → 2",
  simulated.status === "simulated" && simulated.version === 2);
check("simulate projects would-it-have-helped: 3 of 4 observed incidents auto-routed (the ref-less one is honestly not counted)",
  simulated.simulation !== null && simulated.simulation.observedIncidentCount === 4 && simulated.simulation.wouldHaveHelpedCount === 3);
check("simulate changed nothing about the input draft — it is still a version-1 draft with no simulation",
  draft.status === "draft" && draft.version === 1 && draft.simulation === null);

// ── step 6: require owner approval (the human gate) ─────────────────────────────

const pending = requestApproval(simulated);
check("simulated → pending_approval: status advances, version 2 → 3",
  pending.status === "pending_approval" && pending.version === 3);

const APPROVER = "user:owner-dan";
const approved = approve(pending, APPROVER, "asm-approve-0001");
check("pending_approval → approved requires a NON-EMPTY approver ref; it is recorded, version 3 → 4",
  approved.status === "approved" && approved.approval?.approvedByRef === APPROVER && approved.version === 4);

// ── step 7: version & activate explicitly ───────────────────────────────────────

const activated = activate(approved);
check("approved → activated (explicit), version 4 → 5, carrying the recorded approver",
  activated.status === "activated" && activated.version === 5 && activated.approval?.approvedByRef === APPROVER);

// ── step 8: measure & verify — 'did it help?' ───────────────────────────────────

const goodPostActivation: AuditEvent[] = [
  { ...history[0], type: "decision.evaluated", subject: "wrong-aisle-bin-reroute", references: ["signal-bin-mismatch"] },
  { ...history[0], type: "decision.evaluated", subject: "wrong-aisle-bin-reroute", references: ["signal-badge-zone-drift"] },
  { ...history[0], type: "decision.evaluated", subject: "wrong-aisle-bin-reroute", references: ["signal-scan-retry"] },
  { ...history[0], type: "decision.evaluated", subject: "wrong-aisle-bin-reroute", references: ["signal-bin-mismatch"] },
  { ...history[0], type: "remediation.approved", subject: "wrong-aisle-bin-reroute", references: ["signal-bin-mismatch"] }, // still fell back to a human
];
const measuredHelped = measureActivated(activated, goodPostActivation);
check("measure runs only on an activated proposal, attaching a MeasurementResult, version 5 → 6",
  measuredHelped.status === "activated" && measuredHelped.measurement !== null && measuredHelped.version === 6);
check("measure: the activated change HELPED (4 of 5 auto-resolved, realizing the prediction) — helped=true",
  measuredHelped.measurement?.helped === true && measuredHelped.measurement.helpedCount === 4 && measuredHelped.measurement.activatedIncidentCount === 5);

// ── 'approved but didn't help is a FINDING, not an error' ────────────────────────

const badPostActivation: AuditEvent[] = [
  { ...history[0], type: "remediation.approved", subject: "wrong-aisle-bin-reroute", references: ["signal-bin-mismatch"] },
  { ...history[0], type: "remediation.approved", subject: "wrong-aisle-bin-reroute", references: ["signal-badge-zone-drift"] },
  { ...history[0], type: "remediation.requested", subject: "wrong-aisle-bin-reroute", references: ["signal-scan-retry"] },
];
let didNotHelpThrew = false;
let measuredFinding: AdaptiveProposal | null = null;
try { measuredFinding = measureActivated(activated, badPostActivation); } catch { didNotHelpThrew = true; }
check("an approved+activated change that did NOT help is a surfaced FINDING (helped=false), NOT a thrown error",
  !didNotHelpThrew && measuredFinding?.measurement?.helped === false && measuredFinding?.measurement?.helpedCount === 0);
check("...and the finding is legible: it names the shortfall against the prediction in its summary",
  (measuredFinding?.measurement?.summary ?? "").startsWith("FINDING:"));

// ── the measurement verdict cannot be satisfied by ABSENT evidence (2026-09-05) ──
// A simulation that predicted ZERO benefit made the threshold `helpedRate >= 0`, which
// every realization satisfies: twenty incidents that all fell back to a human reported
// `helped: true`, "realizing the simulation's 0% prediction". Planted-and-verified: the
// fix left the previous 37 checks byte-identical, so none of them could see it.
const target = activated.recommendation.target;
const zeroDraft = deriveProposals(history).find((p) => p.recommendation.target === target)!;
const zeroPrediction = simulateProposal(zeroDraft, history.map((e) => ({ ...e, references: [] })));
check("control: a history whose incidents carry no signal refs simulates to a 0% prediction",
  zeroPrediction.simulation?.helpedRate === 0 && (zeroPrediction.simulation?.observedIncidentCount ?? 0) > 0);
const zeroActivated = activate(approve(requestApproval(zeroPrediction), "user:owner-dan", "asm-zero"));
const nothingResolved: AuditEvent[] = Array.from({ length: 20 }, (_, i) => ({ ...history[0], id: `post-${i}`, type: "remediation.approved" as const, subject: target, references: ["signal-bin-mismatch"] }));
const zeroMeasured = measureActivated(zeroActivated, nothingResolved);
check("SAFETY: a 0% prediction realized at 0% is a FINDING (helped=false), never 'realized the prediction'",
  zeroMeasured.measurement?.helped === false && (zeroMeasured.measurement?.summary ?? "").startsWith("FINDING:") && (zeroMeasured.measurement?.summary ?? "").includes("predicted no benefit"));
check("SAFETY: a proposal with NO simulation attached (hand-crafted) measures as a finding, not helped",
  measureActivated({ ...activated, simulation: null }, goodPostActivation).measurement?.helped === false);
// Auto-resolution is an ALLOWLIST: a connector sync on the target subject is not the
// automation resolving an incident, and a type added to core later does not join the
// success column silently.
const syncedOnly = measureActivated(activated, [{ ...history[0], type: "connector.synced", subject: target, references: ["signal-x"] }]);
check("SAFETY: a non-resolution event type on the target subject does NOT count as auto-resolved (allowlist, not denylist)",
  syncedOnly.measurement?.helpedCount === 0 && syncedOnly.measurement?.helped === false);
check("control: decision.evaluated with a signal ref DOES count (the allowlist is not vacuous)",
  measureActivated(activated, [{ ...history[0], type: "decision.evaluated", subject: target, references: ["signal-x"] }]).measurement?.helpedCount === 1);
// A standing finding is not overwritten by a kinder later fixture.
check("a finding STANDS: re-measuring a proposal already found not to help keeps helped=false",
  measureActivated(measuredFinding!, goodPostActivation).measurement?.helped === false);
// Vacuous simulation: a projection over an EMPTY history is not a simulation.
check("SAFETY: a simulation over zero incidents cannot reach pending_approval (typed refusal simulation_required)",
  codeOf(() => requestApproval(simulateProposal(zeroDraft, []))) === "simulation_required");
// Unknown status is a TYPED refusal, not a TypeError a caller catching the package's error class never sees.
check("SAFETY: an unrecognized status (\"Approved\", a prototype key) refuses with illegal_transition, not a crash",
  codeOf(() => activate({ ...approved, status: "Approved" as never })) === "illegal_transition" &&
  codeOf(() => activate({ ...approved, status: "constructor" as never })) === "illegal_transition");
check("SAFETY: an empty approval sequence ref is refused like an empty approver ref",
  codeOf(() => approve(pending, "user:owner-dan", "")) === "approver_required" && codeOf(() => approve(pending, "user:owner-dan", "   ")) === "approver_required");
// Absent evidence is not counted as evidence in the explain step.
const noRefs = deriveProposals(history.map((e) => ({ ...e, references: undefined as never })));
check("an ABSENT references array yields 0 signals in the explain text, not '1 signal(s) []'",
  noRefs.length > 0 && noRefs.every((p) => p.provenance.correlationSummary.startsWith("these 0 signal(s)")));
check("an event with no readable subject mints no proposal (no 'prop-undefined')",
  deriveProposals(history.map((e) => ({ ...e, subject: undefined as never }))).length === 0);

// ── THE SAFETY INVARIANT, negative-controlled every way it could be bypassed ─────

check("(a) activating a pending_approval proposal directly → typed refusal illegal_transition",
  codeOf(() => activate(pending)) === "illegal_transition");
check("(b) activating a simulated (un-approved) proposal → refusal illegal_transition",
  codeOf(() => activate(simulated)) === "illegal_transition");
check("...and a raw draft cannot leap to activated either → illegal_transition",
  codeOf(() => activate(draft)) === "illegal_transition");
check("(c) approving with an EMPTY approver ref → refusal approver_required",
  codeOf(() => approve(pending, "", "asm-x")) === "approver_required" &&
  codeOf(() => approve(pending, "   ", "asm-x")) === "approver_required");
check("(d) requesting approval with NO simulation attached → refusal simulation_required (step 5 gates step 6)",
  codeOf(() => requestApproval({ ...simulated, simulation: null })) === "simulation_required");
check("defence in depth: a hand-crafted { status:'approved', approval:null } STILL cannot activate → activation_without_approval",
  codeOf(() => activate({ ...approved, approval: null })) === "activation_without_approval");
check("...and an 'approved' object whose approver ref was blanked cannot activate either",
  codeOf(() => activate({ ...approved, approval: { approvedByRef: "  ", approvedAtRef: "asm-approve-0001" } })) === "activation_without_approval");

// A rejected proposal is terminal on the approval path — it can only be superseded.
const rejected = reject(pending);
check("pending_approval → rejected is legal; the rejected proposal cannot then be activated",
  rejected.status === "rejected" && codeOf(() => activate(rejected)) === "illegal_transition");
check("any non-terminal proposal can be superseded; a superseded proposal cannot be activated",
  supersede(draft).status === "superseded" && codeOf(() => activate(supersede(approved))) === "illegal_transition");
check("measuring a non-activated proposal → not_activated (only an activated change has outcomes)",
  codeOf(() => measureActivated(approved, goodPostActivation)) === "not_activated");

// ── the STRUCTURAL check over the whole transition table ─────────────────────────
//
// Not "the happy path happened to work" but "the invariant is exhaustively true over
// every (status, targetStatus) pair": the ONLY legal route to `activated` is from
// `approved`, and reaching `approved` demands the human gate.

let pairsToActivated = 0;
let legalRoutesToActivated = 0;
let legalTransitionCount = 0;
const fromStatusesReachingActivated: ProposalStatus[] = [];
for (const from of PROPOSAL_STATUSES) {
  for (const to of PROPOSAL_STATUSES) {
    const legal = isLegalTransition(from, to);
    if (legal) legalTransitionCount += 1;
    if (to === "activated") {
      pairsToActivated += 1;
      if (legal) { legalRoutesToActivated += 1; fromStatusesReachingActivated.push(from); }
    }
  }
}
check("STRUCTURAL: over all 7×7 status pairs, the ONLY legal route to 'activated' is from 'approved'",
  legalRoutesToActivated === 1 && fromStatusesReachingActivated.length === 1 && fromStatusesReachingActivated[0] === "approved");
check("STRUCTURAL: no pre-approval state (draft/simulated/pending_approval) lists 'activated' as a legal successor",
  (["draft", "simulated", "pending_approval"] as ProposalStatus[]).every((s) => !LEGAL_TRANSITIONS[s].includes("activated")));
check("STRUCTURAL: and reaching 'approved' is gated — approve() refuses an empty approver, so 'approved' always carries a human",
  codeOf(() => approve(pending, "", "asm-x")) === "approver_required");
check("STRUCTURAL: terminal states (activated/rejected/superseded) have no successor except 'superseded'",
  LEGAL_TRANSITIONS.activated.join() === "superseded" && LEGAL_TRANSITIONS.rejected.join() === "superseded" && LEGAL_TRANSITIONS.superseded.length === 0);

// ── no-echo: refusals must never reflect a caller-supplied ref ───────────────────
//
// A JWT-shaped approver ref, ASSEMBLED AT RUNTIME so no token-shaped literal sits in this
// source (the repo's secret scanner scans source). Approving a still-`simulated` proposal
// is illegal; the refusal must name the statuses, never the hostile ref.

const hostileRef = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiJhdHRhY2tlciJ9", "s1gn4tur3"].join(".");
let echoErr: AdaptiveProposalError | null = null;
try { approve(simulated, hostileRef, "asm-x"); } catch (err) { echoErr = err instanceof AdaptiveProposalError ? err : null; }
check("no-echo: approving from an illegal state with a hostile approver ref refuses illegal_transition...",
  echoErr?.code === "illegal_transition");
check("...and the refusal message does NOT echo the JWT-shaped ref — an error that repeats a token is a second leak",
  echoErr !== null && !echoErr.message.includes("eyJhbGci") && !echoErr.message.includes(hostileRef));

// ── determinism & deep-freeze ────────────────────────────────────────────────────

const runLifecycle = (): AdaptiveProposal => {
  const s = new MemoryStore();
  let k = 0;
  for (const refs of [["a", "b"], ["a"], ["b", "c"], []]) {
    appendAudit(s, { tenantId: TENANT, type: "remediation.approved", actor: "user:x", subject: "wrong-aisle-bin-reroute", summary: "m", references: refs, recordedAt: `asm-${String(++k).padStart(4, "0")}` });
  }
  const h = s.listAudit(TENANT);
  const d = deriveProposals(h)[0];
  return activate(approve(requestApproval(simulateProposal(d, h)), "user:owner", "asm-a"));
};
check("determinism: two independent full lifecycle runs are byte-identical",
  JSON.stringify(runLifecycle()) === JSON.stringify(runLifecycle()));
check("determinism: deriveProposals over identical history is byte-identical",
  JSON.stringify(deriveProposals(history)) === JSON.stringify(deriveProposals(history)));
check("every returned proposal is deeply frozen — mutation is an error, not a convention",
  [draft, simulated, pending, approved, activated, measuredHelped].every(
    (p) => Object.isFrozen(p) && Object.isFrozen(p.provenance) && Object.isFrozen(p.provenance.sourceEventRefs) && Object.isFrozen(p.recommendation)));
check("the input proposal is never mutated across a transition: the draft survived the whole loop unchanged",
  draft.status === "draft" && draft.version === 1 && draft.simulation === null && draft.approval === null && draft.measurement === null);

// ── summary ───────────────────────────────────────────────────────────────────

console.log(`figures=states=${PROPOSAL_STATUSES.length},transitionPairs=${PROPOSAL_STATUSES.length * PROPOSAL_STATUSES.length},legalTransitions=${legalTransitionCount},pairsToActivated=${pairsToActivated},legalRoutesToActivated=${legalRoutesToActivated}`);
const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
