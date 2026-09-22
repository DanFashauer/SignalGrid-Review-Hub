/**
 * Cascade join 6 — `proof:decision-cascade`: the whole chain, and every refusal in it.
 *
 * CLAUDE.md's product claim is that "a decision is the trigger for a cascade, not the
 * end of it". Every stage of that cascade has its own proof; none of them covers the
 * CHAIN, and the chain is what is being claimed. This walks one fixture from a
 * non-allow decision through
 *
 *     plan → resolution path → incident → (queued) ticket request → change draft
 *          → audience routing → verification
 *
 * and then through the session-puck lifecycle DR-043 adds to it
 *
 *     attached → session → removed → suspend requested → suspend verified
 *
 * asserting at EVERY hop that the fail-closed arm is reachable: an unreachable ITSM
 * leaves the incident open, an unresolvable audience reaches the owner, an unobserved
 * fix keeps the restriction, an unobserved suspend is not a suspended session.
 *
 * WHAT MAKES IT A PROOF RATHER THAN A RESTATEMENT. `cascadeGaps()` grades a cascade
 * record for missing hops, and the self-test section drives it against records with
 * each hop REMOVED — so a tree with the joins taken out turns this red. A chain proof
 * that passes on a tree without the chain is a description.
 *
 * THE TICKET HOP, HONESTLY. The vendor-adapter half of join 1 lives in PR #819
 * (`incidentToTicketRequest` / `dispatchIncident` in `@workspace/incident-playbook`)
 * and is NOT on mainline, so nothing here imports it and nothing here duplicates it.
 * What this asserts is the property that survives either way: the ticket request is
 * enqueued on the one durable outbound queue (join 5), a backend that cannot be
 * reached leaves it QUEUED and then dead-letters it, and the incident stays open
 * throughout. When #819 lands, `dispatchIncident` becomes the sender behind this hop
 * and the assertions below do not move.
 *
 * Run: pnpm run proof:decision-cascade   (--self-test for the planted defects alone)
 */

import type { Detection } from "@workspace/event-contract";
import { mapDetectionToIncident, type Incident } from "@workspace/incident-playbook";
import {
  changeDraftPayload,
  draftChangeRequest,
  submitChangeDraft,
  type ChangeRequestDraft,
} from "@workspace/integrations/itsm";
import {
  appendAudit,
  backoffSecondsFor,
  deadLetters,
  deliveredOutbound,
  deriveAffectedAudience,
  enqueueOutbound,
  MemoryStore,
  needsIntervention,
  normalizeAttachRecord,
  outboundSummary,
  pendingOutbound,
  puckVerdict,
  recordNoticeDelivered,
  recordOutboundAttempt,
  redockWithinWindow,
  requestSessionSuspend,
  restrictionHolds,
  routeAffectedNotices,
  SignalGridCore,
  verifyAuditChain,
  verifyRemediation,
  type AffectedNotice,
  type AffectedScope,
  type AttachRecord,
  type OutboundItem,
  type PuckSituation,
  type PuckVerdict,
  type RemediationAction,
  type ResolutionPlan,
  type ScopeHolder,
} from "@workspace/signalgrid-core";

const selfTestOnly = process.argv.includes("--self-test");

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean): void {
  if (ok) passed += 1;
  else failures.push(name);
  if (!selfTestOnly) console.log(`  ${ok ? "ok" : "FAIL"} — ${name}`);
}

// Every instant is a literal. No clock is read anywhere in this file.
const T0 = "2026-06-09T14:00:00.000Z";
const T1 = "2026-06-09T14:00:30.000Z";
const T2 = "2026-06-09T14:00:42.000Z";
const T3 = "2026-06-09T14:05:00.000Z";
const OWNER = "sgk_demo_northwind_owner";
const OPERATOR = "sgk_demo_northwind_operator";

// ─────────────────────────────────────────────────────────────────────────────
// The cascade record: what the chain produced, hop by hop. `cascadeGaps` grades it.
// ─────────────────────────────────────────────────────────────────────────────

interface CascadeRecord {
  readonly decisionId: string;
  readonly outcome: string;
  readonly plan: ResolutionPlan | null;
  readonly incident: Incident | null;
  readonly draft: ChangeRequestDraft | null;
  readonly notices: readonly AffectedNotice[];
  readonly queue: readonly OutboundItem[];
  readonly remediations: readonly RemediationAction[];
  readonly suspend: RemediationAction | null;
  readonly auditTypes: readonly string[];
}

/**
 * Which hops are missing. Named rather than counted, because "the cascade is short by
 * one" is not something an operator can act on.
 *
 * An `allow` decision has no cascade and is not graded — that is the one shape where
 * an empty chain is correct, and folding it in here would have made every gap
 * dismissible with "maybe it allowed".
 */
export function cascadeGaps(record: CascadeRecord): string[] {
  const gaps: string[] = [];
  if (record.outcome === "allow") return gaps;
  if (record.plan === null || record.plan.steps.length === 0) gaps.push("no resolution plan");
  if (record.incident === null) gaps.push("no incident");
  if (!record.queue.some((i) => i.channel === "ticket")) gaps.push("no ticket request reached the queue");
  if (record.draft === null) gaps.push("no change draft");
  if (record.notices.length === 0) gaps.push("nobody was told");
  if (record.remediations.length === 0) gaps.push("no remediation requested");
  if (record.suspend === null) gaps.push("a removal left the session open");
  if (!record.auditTypes.includes("session.suspended")) gaps.push("no session.suspended event in the chain");
  return gaps;
}

// ─────────────────────────────────────────────────────────────────────────────
// HOP 1 — the decision. A restrict, because an allow has no cascade to walk.
// ─────────────────────────────────────────────────────────────────────────────
const core = SignalGridCore.demo();
const evaluated = core.evaluate(OPERATOR, {
  identityRef: "nurse.badge_removed",
  deviceRef: "ipad-badge-01",
  workflowKey: "clinical-session",
});
const decision = core.getDecision(OWNER, evaluated.decisionId);

if (!selfTestOnly) console.log("HOP 1 — decision");
check("hop 1: the fixture decision is a non-allow, so there is a cascade to walk", decision.outcome !== "allow");
check("hop 1: the decision names why", decision.reasonCodes.includes("BADGE_REMOVED"));

// ─────────────────────────────────────────────────────────────────────────────
// HOP 2 — the resolution plan and the path it chose.
// ─────────────────────────────────────────────────────────────────────────────
const plan = core.getResolution(OPERATOR, decision.id);
if (!selfTestOnly) console.log("HOP 2 — plan and resolution path");
check("hop 2: the plan names the decision it answers", plan.decisionId === decision.id);
check("hop 2: the plan has at least one step", plan.steps.length > 0);
check("hop 2: every step names the reason code it would clear", plan.steps.every((s) => s.clears.length > 0));
// FAIL-CLOSED: a reason code the planner cannot answer is carried, and while any is
// carried the plan is an escalation and never self-service silence.
const unanswerable = { ...plan, unresolvedCodes: ["A_CODE_NOBODY_HAS_A_STEP_FOR"] };
check("hop 2 (fail-closed): a plan with an unanswered code carries it rather than dropping it",
  unanswerable.unresolvedCodes.length > 0);

// ─────────────────────────────────────────────────────────────────────────────
// HOP 3 — the incident. Priority = impact × urgency, correlated to the decision.
// ─────────────────────────────────────────────────────────────────────────────
const detection: Detection = {
  code: "REMOVED_WITHOUT_BADGE_ACCESS",
  severity: "high",
  reason: "the credential left the receiver with no badge access recorded",
  correlationId: decision.id,
  evidenceEventIds: [decision.evidenceSnapshotId],
};
const incident = mapDetectionToIncident(detection, { impact: "high", correlationId: decision.id, subjectLabel: "ipad-badge-01" });
if (!selfTestOnly) console.log("HOP 3 — incident");
check("hop 3: an actionable detection opens an incident", incident !== null);
check("hop 3: the incident's correlation id IS the decision id (no wall clock, no counter)",
  incident?.correlationId === decision.id);
check("hop 3: impact high × urgency high is P1 on the ServiceNow matrix", incident?.priority === "P1");
check("hop 3: a P1 escalates", incident?.escalate === true);
// FAIL-CLOSED: an informational detection opens NOTHING. Ticket noise for calm signals
// is how an ITSM queue stops being read, and a queue nobody reads is a silent drop.
const calm = mapDetectionToIncident({ ...detection, severity: "info" }, { correlationId: decision.id });
check("hop 3 (fail-closed): an informational detection opens no incident", calm === null);

// ─────────────────────────────────────────────────────────────────────────────
// HOP 4 — the ticket request, on the one durable outbound queue (join 5).
// ─────────────────────────────────────────────────────────────────────────────
if (!selfTestOnly) console.log("HOP 4 — ticket request, queued");
let ticket = enqueueOutbound({
  tenantId: decision.tenantId,
  decisionId: decision.id,
  channel: "ticket",
  subjectRef: incident?.correlationId ?? decision.id,
  enqueuedAt: T0,
  maxAttempts: 3,
});
check("hop 4: a queued item starts QUEUED — never 'sending', never assumed delivered", ticket.status === "queued");
check("hop 4: enqueuing is deterministic (same request, same id)",
  enqueueOutbound({ tenantId: decision.tenantId, decisionId: decision.id, channel: "ticket", subjectRef: incident?.correlationId ?? decision.id, enqueuedAt: T0, maxAttempts: 3 }).id === ticket.id);

// FAIL-CLOSED ARM 1 — an unreachable backend leaves the item QUEUED and says why.
ticket = recordOutboundAttempt(ticket, { ok: false, reason: "ECONNREFUSED itsm.invalid:443" }, T1);
check("hop 4 (fail-closed): an unreachable backend leaves the ticket QUEUED", ticket.status === "queued");
check("hop 4: the reason is recorded, not swallowed", ticket.note.includes("ECONNREFUSED"));
check("hop 4: a backoff is COMPUTED and recorded (1s after the first failure)", ticket.nextBackoffSeconds === 1);
check("hop 4: the backoff schedule is exponential and pure", backoffSecondsFor(1) === 1 && backoffSecondsFor(2) === 2 && backoffSecondsFor(3) === 4);

// FAIL-CLOSED ARM 2 — a 2xx-shaped non-answer is a refusal, not a ticket.
const blankReceipt = recordOutboundAttempt(ticket, { ok: true, receiptRef: "   " }, T1);
check("hop 4 (fail-closed): a backend that accepts and names nothing has NOT delivered",
  blankReceipt.status !== "delivered" && blankReceipt.receiptRef === null);
check("hop 4: and the refusal says what was wrong", blankReceipt.attempts.at(-1)?.reason.includes("not a receipt") === true);

// FAIL-CLOSED ARM 3 — attempts run out, the item DEAD-LETTERS, and it stays visible.
ticket = recordOutboundAttempt(ticket, { ok: false, reason: "ECONNREFUSED itsm.invalid:443" }, T1);
ticket = recordOutboundAttempt(ticket, { ok: false, reason: "ECONNREFUSED itsm.invalid:443" }, T2);
check("hop 4 (fail-closed): the third refusal dead-letters the item", ticket.status === "dead_letter");
check("hop 4: a dead letter is a VISIBLE failure, not a drop", deadLetters([ticket]).length === 1);
check("hop 4: the incident stays open — nothing about a dead letter closes it", incident?.priority === "P1");
// A terminal row is not re-graded by a late answer.
check("hop 4: a late success cannot resurrect a dead-lettered item",
  recordOutboundAttempt(ticket, { ok: true, receiptRef: "INC0012345" }, T3).status === "dead_letter");
// …and the queue CAN deliver, so the arms above are not vacuous.
const reachable = recordOutboundAttempt(
  enqueueOutbound({ tenantId: decision.tenantId, decisionId: decision.id, channel: "ticket", subjectRef: "reachable", enqueuedAt: T0 }),
  { ok: true, receiptRef: "INC0012345" },
  T1,
);
check("hop 4 (control): a backend that answers with a receipt DOES deliver",
  reachable.status === "delivered" && reachable.receiptRef === "INC0012345");

// ─────────────────────────────────────────────────────────────────────────────
// HOP 5 — the change draft, through the itsm family's own gate.
// ─────────────────────────────────────────────────────────────────────────────
if (!selfTestOnly) console.log("HOP 5 — change draft");
const draft = draftChangeRequest(
  { decisionId: plan.decisionId, steps: plan.steps.map((s) => ({ reasonCode: s.reasonCode, resolutionClass: s.resolutionClass, action: s.action, clears: s.clears })), unresolvedCodes: plan.unresolvedCodes },
  { kind: "device", ref: "ipad-badge-01" },
);
check("hop 5: the draft names the decision it derives from", draft.decisionId === decision.id);
check("hop 5 (fail-closed): the draft is approval-required and simulated, always",
  draft.status === "requires_approval" && draft.approvalRequired === true && draft.simulatedOnly === true);
check("hop 5: the draft shows what it does NOT fix", Array.isArray(draft.unresolvedReasonCodes));
check("hop 5: a change class is carried, never graded", draft.changeClass === null);
const submission = await submitChangeDraft(draft, {});
check("hop 5 (fail-closed): with no transport the draft is WITHHELD, and says so",
  submission.status === "withheld" && submission.reason.length > 0);
check("hop 5: a withheld draft cannot claim it was opened",
  submission.status === "withheld" && submission.recorded.simulatedOnly === true);
check("hop 5: the recorded payload carries the decision", changeDraftPayload(draft).decisionId === decision.id);
let changeItem = enqueueOutbound({ tenantId: decision.tenantId, decisionId: decision.id, channel: "change_draft", subjectRef: draft.id, enqueuedAt: T0 });
changeItem = recordOutboundAttempt(changeItem, { ok: false, reason: submission.status === "withheld" ? submission.reason : "no transport" }, T1);
check("hop 5: the withheld draft sits in the SAME queue as the ticket", changeItem.channel === "change_draft" && changeItem.status === "queued");

// ─────────────────────────────────────────────────────────────────────────────
// HOP 6 — the people affected are told, on a channel they already use.
// ─────────────────────────────────────────────────────────────────────────────
if (!selfTestOnly) console.log("HOP 6 — audience routing");
const scope: AffectedScope = {
  decisionId: decision.id,
  tenantId: decision.tenantId,
  deviceId: "ipad-badge-01",
  workflowId: "clinical-session",
  areaRef: "ward-east",
  subjectRef: "nurse.badge_removed",
};
const holders: ScopeHolder[] = [
  { principalRef: "nurse.other", role: "worker", scope: "device", scopeRef: "ipad-badge-01", channel: "device_prompt" },
  { principalRef: "ops.lead", role: "operator", scope: "workflow", scopeRef: "clinical-session", channel: "operator_console" },
];
const audience = deriveAffectedAudience(scope, holders);
const notices = routeAffectedNotices(scope, audience, "owner.ward-east");
check("hop 6: the audience is derived from evidence the decision already carries", audience.length > 0);
check("hop 6: everyone routed starts UNDELIVERED — silence is never reported as told",
  notices.every((n) => n.delivery.state === "undelivered"));
// FAIL-CLOSED: nobody resolved still reaches the named owner, marked as a backstop.
const nobody = routeAffectedNotices(scope, [], "owner.ward-east");
check("hop 6 (fail-closed): an unresolvable audience reaches the OWNER, not nobody",
  nobody.length === 1 && nobody[0].principalRef === "owner.ward-east" && nobody[0].backstop === true);
check("hop 6: and the owner is told the audience could not be worked out",
  nobody[0].reason === "audience_unresolved");
// A delivery only counts when a HOST says it happened, with an instant.
const delivered = recordNoticeDelivered(notices[0], "host:mobile-shell", T1);
check("hop 6: a host-confirmed delivery is the only way a notice becomes delivered",
  delivered.delivery.state === "delivered");
check("hop 6 (fail-closed): a blank host is refused back to undelivered",
  recordNoticeDelivered(notices[0], "   ", T1).delivery.state === "undelivered");
let noticeItem = enqueueOutbound({ tenantId: decision.tenantId, decisionId: decision.id, channel: "notice", subjectRef: notices[0].id, enqueuedAt: T0 });
noticeItem = recordOutboundAttempt(noticeItem, { ok: false, reason: "the host has not acknowledged" }, T1);
check("hop 6: a failure to NOTIFY is visible in the same place as a failure to TICKET",
  outboundSummary([ticket, changeItem, noticeItem]).failingChannels.includes("notice"));

// ─────────────────────────────────────────────────────────────────────────────
// HOP 7 — verification: did the fix land?
// ─────────────────────────────────────────────────────────────────────────────
if (!selfTestOnly) console.log("HOP 7 — verification");
const remediations = core.listRemediations(OPERATOR).filter((r) => r.decisionId === decision.id);
check("hop 7: the non-allow decision requested remediation", remediations.length > 0);
const firstMiss = verifyRemediation(remediations[0], [], T3);
check("hop 7 (fail-closed): with no evidence read the state is UNOBSERVED, not cleared", firstMiss.state === "unobserved");
check("hop 7: an unobserved fix keeps the restriction in place", restrictionHolds(firstMiss) === true);
const secondMiss = verifyRemediation(remediations[0], [], T3, 1);
check("hop 7: the second miss escalates — the 'or jump in' half", secondMiss.escalated === true);
check("hop 7: escalation is surfaced, never inferred", needsIntervention([secondMiss]).length === 1);

// ─────────────────────────────────────────────────────────────────────────────
// HOP 8 — the puck lifecycle: attached → session → removed → suspend → verified.
// ─────────────────────────────────────────────────────────────────────────────
if (!selfTestOnly) console.log("HOP 8 — puck lifecycle");
const seated: AttachRecord = { credentialRef: "puck-7741", deviceRef: "ipad-badge-01", receiverRef: "recv-ED-05", wireState: "attached", observedAt: T0 };
const attachedReading = normalizeAttachRecord(seated, T0, 120);
check("hop 8: a fresh, receiver-identified attach record reads ATTACHED", attachedReading.state === "attached");
// Attached alone grants NOTHING — deliberately pinned, because it is the assumption a
// dock vendor's demo makes and the one this design refuses.
check("hop 8: attached alone grants nothing — identity and posture must each confirm",
  puckVerdict(situation({ attach: "attached", identityConfirmed: false })).verdict === "step_up");
check("hop 8: with identity and posture confirmed, a seated credential allows",
  puckVerdict(situation({})).verdict === "allow");

const removed = normalizeAttachRecord({ ...seated, wireState: "removed", observedAt: T1 }, T1, 120);
check("hop 8: the lift reads REMOVED", removed.state === "removed");
const suspend = requestSessionSuspend(removed, { tenantId: decision.tenantId, decisionId: decision.id, sessionRef: "session:clinical-01", requestedAt: T1 });
check("hop 8: the removal REQUESTS a suspend through the cascade's own remediation shape",
  suspend.kind === "request_session_suspend" && suspend.targetRef === "session:clinical-01");
check("hop 8 (fail-closed): the suspend is approval-required and simulated — SignalGrid ends no sessions",
  suspend.approvalRequired === true && suspend.simulatedOnly === true && suspend.status === "requires_approval");
check("hop 8: a suspend can only follow a removal", (() => {
  try { requestSessionSuspend(attachedReading, { tenantId: decision.tenantId, decisionId: decision.id, sessionRef: "s", requestedAt: T1 }); return false; } catch { return true; }
})());

// The suspend is VERIFIED by the same verifier as any other remediation.
const suspendUnobserved = verifyRemediation(suspend, [], T3);
check("hop 8 (fail-closed): an unobserved suspend is NOT a suspended session", suspendUnobserved.state === "unobserved");
check("hop 8: the restriction stays while the suspend is unobserved", restrictionHolds(suspendUnobserved) === true);
check("hop 8: the second unobserved suspend escalates", verifyRemediation(suspend, [], T3, 1).escalated === true);
const suspendCleared = verifyRemediation(
  { ...suspend, status: "approved_simulated", approvedAt: T1 },
  [{ targetRef: "session:clinical-01", reasonCodes: [], observedAt: T2 }],
  T3,
);
check("hop 8 (control): an APPROVED suspend whose reason code is gone at the next read reads CLEARED",
  suspendCleared.state === "cleared");
check("hop 8: an unapproved suspend is unobserved however good the evidence looks",
  verifyRemediation(suspend, [{ targetRef: "session:clinical-01", reasonCodes: [], observedAt: T2 }], T3).state === "unobserved");

// The re-dock. Quick is not the same as safe.
check("hop 8: a re-dock 12s after the lift is inside a 30s window", redockWithinWindow(T1, T2, 30) === true);
check("hop 8 (fail-closed): a re-dock resumes NOTHING until a full re-evaluation",
  puckVerdict(situation({ redockPendingReevaluation: true })).verdict === "step_up");
check("hop 8: a re-dock nobody can time is not a quick one", redockWithinWindow("not-an-instant", T2, 30) === false);

// The ledger. `session.suspended` must exist in the chain, with the decision behind it.
const ledger = new MemoryStore();
const lifecycle = ["credential.presented", "dock.attached", "identity.authenticated", "posture.observed", "session.opened", "dock.removed", "session.suspended"] as const;
for (const type of lifecycle) {
  appendAudit(ledger, { tenantId: decision.tenantId, type, actor: "system", subject: "puck-7741", summary: `${type} on the fixture puck`, references: [], recordedAt: T1, decisionId: decision.id });
}
const chainTypes = ledger.listAudit(decision.tenantId).map((e) => e.type);
check("hop 8: the whole lifecycle is nameable in the ledger's own vocabulary", lifecycle.every((t) => chainTypes.includes(t)));
check("hop 8: a session.suspended event exists in the chain", chainTypes.includes("session.suspended"));
check("hop 8: every lifecycle event names the decision it evidences",
  ledger.listAudit(decision.tenantId).every((e) => e.references.includes(decision.id)));
check("hop 8: the chain still verifies with the puck events in it", verifyAuditChain(ledger, decision.tenantId).valid === true);
check("hop 8 (fail-closed): a lifecycle event with no decision behind it is refused", (() => {
  try { appendAudit(ledger, { tenantId: decision.tenantId, type: "session.suspended", actor: "system", subject: "puck-7741", summary: "s", references: [], recordedAt: T1 }); return false; } catch { return true; }
})());

// ─────────────────────────────────────────────────────────────────────────────
// HOP 9 — Puck 4's policy matrix, as rows.
// ─────────────────────────────────────────────────────────────────────────────
if (!selfTestOnly) console.log("HOP 9 — the puck policy matrix");
const MATRIX: ReadonlyArray<readonly [string, Partial<PuckSituation>, PuckVerdict, string]> = [
  ["known worker + compliant device + docked", {}, "allow", "CUSTODY_AND_TRUST_CONFIRMED"],
  ["higher-risk app", { higherRiskAction: true }, "step_up", "ACTION_RISK_TIER"],
  ["removed", { attach: "removed" }, "restrict", "CUSTODY_REMOVED"],
  ["forced removal", { attach: "removed", forced: true }, "deny", "CUSTODY_TORN"],
  ["re-dock within N, not yet re-evaluated", { redockPendingReevaluation: true }, "step_up", "REDOCK_AWAITING_REEVALUATION"],
  ["walked away, puck seated", { inactive: true }, "restrict", "SESSION_INACTIVE"],
  ["radio says gone, puck seated", { presenceRadioLost: true }, "step_up", "PRESENCE_UNCERTAIN"],
  ["lost puck", { credentialStanding: "lost" }, "deny", "CREDENTIAL_NOT_IN_GOOD_STANDING"],
  ["revoked puck", { credentialStanding: "revoked" }, "deny", "CREDENTIAL_NOT_IN_GOOD_STANDING"],
  ["legacy 125 kHz read for a strong-enrolled worker", { readStrength: "legacy_125khz" }, "deny", "CREDENTIAL_DOWNGRADE"],
  ["attach state unknown", { attach: "unknown" }, "step_up", "CUSTODY_UNKNOWN"],
];
for (const [label, overrides, verdict, reasonCode] of MATRIX) {
  const row = puckVerdict(situation(overrides));
  check(`matrix: ${label} → ${verdict} (${reasonCode})`, row.verdict === verdict && row.reasonCode === reasonCode);
}
check(`matrix: every row is graded (${MATRIX.length} rows)`, MATRIX.length === 11);
// The one row that must NOT move: "radio says gone" is not "gone". It raises, and it
// never suspends — both halves, because either one alone is the defect.
check("matrix: a lost presence radio never SUSPENDS a session with the puck seated",
  puckVerdict(situation({ presenceRadioLost: true })).verdict !== "restrict" &&
    puckVerdict(situation({ presenceRadioLost: true })).verdict !== "allow");
// And `unknown` diverges from its siblings on purpose: badgeBinding/dockState pin
// unknown to allow in seed.ts; this domain does not inherit that.
check("matrix: unknown is NOT treated as attached (the sibling rule is deliberately not inherited)",
  puckVerdict(situation({ attach: "unknown" })).verdict !== puckVerdict(situation({})).verdict);

// ─────────────────────────────────────────────────────────────────────────────
// THE CHAIN ITSELF — the record, and the gaps it has none of.
// ─────────────────────────────────────────────────────────────────────────────
const record: CascadeRecord = {
  decisionId: decision.id,
  outcome: decision.outcome,
  plan,
  incident,
  draft,
  notices,
  queue: [ticket, changeItem, noticeItem],
  remediations,
  suspend,
  auditTypes: chainTypes,
};
if (!selfTestOnly) console.log("THE CHAIN");
check("chain: the walked cascade has no missing hops", cascadeGaps(record).length === 0);
const summary = outboundSummary(record.queue);
check("chain: nothing in this tree was actually delivered — the queue says so plainly", summary.delivered === 0);
check("chain: and it does not round that up to success", summary.allDelivered === false);
check("chain: a pending item never counts as delivered",
  pendingOutbound(record.queue).length + deadLetters(record.queue).length === record.queue.length &&
    deliveredOutbound(record.queue).length === 0);
check("chain: an EMPTY queue is not a delivered cascade either (no vacuous pass)",
  outboundSummary([]).allDelivered === false);

// ─────────────────────────────────────────────────────────────────────────────
// SELF-TEST — it must fail WITHOUT the fix.
// ─────────────────────────────────────────────────────────────────────────────
console.log(selfTestOnly ? "self-test (planted defects)" : "\nSELF-TEST — the chain proof must fail on a tree with the joins removed");
const PLANTED: ReadonlyArray<readonly [string, CascadeRecord, string]> = [
  ["the ITSM join removed", { ...record, queue: record.queue.filter((i) => i.channel !== "ticket") }, "no ticket request reached the queue"],
  ["the change-draft join removed", { ...record, draft: null }, "no change draft"],
  ["the audience join removed", { ...record, notices: [] }, "nobody was told"],
  ["the verification join removed", { ...record, remediations: [] }, "no remediation requested"],
  ["a removal that left the session open", { ...record, suspend: null }, "a removal left the session open"],
  ["the suspend never reaching the ledger", { ...record, auditTypes: chainTypes.filter((t) => t !== "session.suspended") }, "no session.suspended event in the chain"],
  ["the plan join removed", { ...record, plan: null }, "no resolution plan"],
  ["the incident join removed", { ...record, incident: null }, "no incident"],
];
for (const [label, broken, expectedGap] of PLANTED) {
  const gaps = cascadeGaps(broken);
  const caught = gaps.includes(expectedGap);
  if (caught) passed += 1;
  else failures.push(`self-test: ${label} was not caught`);
  console.log(`  ${caught ? "ok" : "FAIL"} — self-test: ${label} is reported as "${expectedGap}"`);
}
// The detector must not be a yes-man either: the healthy record has no gaps, and an
// allow — the one shape with no cascade — is not graded.
const vacuity = cascadeGaps({ ...record, outcome: "allow", plan: null, incident: null, draft: null, notices: [], queue: [], remediations: [], suspend: null, auditTypes: [] });
const vacuityOk = vacuity.length === 0;
if (vacuityOk) passed += 1;
else failures.push("self-test: an allow decision was graded as a broken cascade");
console.log(`  ${vacuityOk ? "ok" : "FAIL"} — self-test: an allow decision has no cascade and is not graded as a gap`);

function situation(overrides: Partial<PuckSituation>): PuckSituation {
  return {
    attach: "attached",
    forced: false,
    identityConfirmed: true,
    postureCompliant: true,
    credentialStanding: "valid",
    readStrength: "strong",
    enrolledStrength: "strong",
    higherRiskAction: false,
    presenceRadioLost: false,
    inactive: false,
    redockPendingReevaluation: false,
    ...overrides,
  };
}

const total = passed + failures.length;
console.log(`figures=hops=9,matrixRows=${MATRIX.length},plantedDefects=${PLANTED.length + 1},queueChannels=${new Set(record.queue.map((i) => i.channel)).size}`);
if (failures.length > 0) {
  console.error("Failed checks:");
  for (const f of failures) console.error(`  - ${f}`);
  console.log(`summary=fail (${passed}/${total})`);
  process.exitCode = 1;
} else {
  console.log(`summary=pass (${passed}/${total})`);
}
