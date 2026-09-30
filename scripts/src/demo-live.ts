/**
 * `pnpm run demo:live` — one command, one story, served live to any screen on the Wi-Fi.
 *
 * A ward iPad's MDM report turns non-compliant. SignalGrid's REAL decision core
 * (an estate core on a stepping clock, the estate-refresh-proof pattern) decides
 * restrict, and the decision triggers the cascade through the REAL joins: a
 * resolution plan, an incident, a ticket through the `dispatchIncident` seam, a
 * change draft through `submitChangeDraft`, notices routed to the people affected,
 * a (simulated) approval, the MDM's next compliant report, allow again, and the
 * verifier reading the fix as cleared. Every decision, reason code, id and status on
 * the page is one the real code computed; `storyGaps` grades the whole story at the
 * end and the page's banner shows that verdict, never a single hop's.
 *
 * What is NOT real, and says so wherever it shows: the people and their app screens
 * are stand-ins, the ticket desk is an in-memory emulator on this Mac (no vendor is
 * contacted), the MDM feed is a fixture, the incident's trigger (the detection) is
 * scenario input scripted here, and the approval is simulated — SignalGrid executes
 * no change on the MDM; the fix arrives as the MDM's next report. The desk opens only
 * because ONE call is handed a beta/live env literal; `process.env` is never written
 * (proof:demo-live control 1).
 *
 * Deterministic: the only clock is the stepping one below. No wall time is read in
 * this file; pacing is `setTimeout` and changes nothing but when a step runs.
 *
 * Run: pnpm run demo:live [--port 5180] [--step-ms 2500]
 * Proof: pnpm run proof:demo-live
 */

import { execFileSync } from "node:child_process";
import { createServer, type ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import { pathToFileURL } from "node:url";
import type { Detection } from "@workspace/event-contract";
import { dispatchIncident, mapDetectionToIncident, type Incident } from "@workspace/incident-playbook";
import type { ITSMAdapter, ITSMTicketRequest } from "@workspace/integrations/adapters/types";
import { draftChangeRequest, submitChangeDraft, type ItsmEmitPayload } from "@workspace/integrations/itsm";
import type { ITSMFullConfig } from "@workspace/integrations/itsm/store";
import {
  deriveAffectedAudience,
  enqueueOutbound,
  outboundSummary,
  recordNoticeDelivered,
  recordOutboundAttempt,
  restrictionHolds,
  routeAffectedNotices,
  SignalGridCore,
  verifyRemediation,
  type AffectedNotice,
  type Clock,
  type EstateSpec,
  type EstateSubject,
  type FixturePostureRecord,
  type OutboundItem,
  type RemediationAction,
  type ScopeHolder,
} from "@workspace/signalgrid-core";

// ─────────────────────────────────────────────────────────────────────────────
// The fixed cast. Every literal a person sees on the page comes from here or from
// what the core computed from it.
// ─────────────────────────────────────────────────────────────────────────────

export const STORY_START = "2026-06-16T12:00:00.000Z";
const OWNER = "demo-live-owner-token-0123456789";
const OPERATOR = "demo-live-operator-token-0123456789";
const IDENTITY = "user-jordan";
const DEVICE = "dev-ipad-ward-02";
const WORKFLOW = "shared-device-session";
const DEVICE_NAME = "Ward iPad 02";
const DESK_NAME = "Local demo ticket desk (emulated on this Mac, no vendor contacted)";
const SYS_CORE = "SignalGrid decision core (in-process, the real engine)";
const SYS_MDM = "MDM posture feed (Intune-shaped fixture on this Mac)";

/** Who the notice router may reach, and on which channel they ALREADY use. */
const PEOPLE: Record<string, { name: string; label: string }> = {
  "user-jordan": { name: "Jordan", label: "Jordan, ward nurse" },
  "user-sam": { name: "Sam", label: "Sam, next nurse on Ward iPad 02" },
  "charge-nurse.ward": { name: "Charge nurse", label: "Charge nurse, the ward's shared-device workflow" },
};

/**
 * The ONE env the ticket desk and the change draft are handed. A literal passed to a
 * single call; never assigned to `process.env`. Under any other env the seam refuses
 * by tier, which is what proof:demo-live's control 1 pins.
 */
const DESK_ENV: NodeJS.ProcessEnv = { SIGNALGRID_TIER: "beta", SIGNALGRID_LIVE_INTEGRATIONS: "true" };

/** A placeholder, not a credential: the gate asks only that the field is present. */
export const DESK_CONFIG: ITSMFullConfig = {
  vendor: "generic_webhook",
  name: "Local demo ticket desk",
  enabled: true,
  lastTestResult: "not_tested",
  credentials: { signingSecret: "a-signing-secret-that-is-present" },
};

export const STORY_STEPS = [
  "baseline",
  "signal.noncompliant",
  "decision.restrict",
  "plan",
  "incident",
  "ticket",
  "change",
  "notice.routed",
  "remediation.approved",
  "signal.compliant",
  "decision.allow",
  "verified",
  "cascade.complete",
] as const;

/** The whole-story verdict, emitted last. Not in STORY_STEPS: storyGaps produces it. */
export const STORY_END = ["story.passed", "story.failed"] as const;
const isEnd = (step: string): boolean => (STORY_END as readonly string[]).includes(step);

export interface DemoEvent {
  readonly seq: number;
  readonly step: string;
  /** A stepping-clock instant. */
  readonly at: string;
  readonly title: string;
  /** Who acted. */
  readonly system: string;
  readonly detail: Record<string, unknown>;
  /** One plain-English sentence a partner reads first; the raw detail sits under it. */
  readonly plain: string;
}

type SteppingClock = Clock & { advanceMinutes: (n: number) => void };

/** Copied from estate-refresh-proof: the core reads no clock but this one. */
function steppingClock(): SteppingClock {
  let ms = Date.parse(STORY_START);
  return {
    now: () => new Date(ms),
    advanceMinutes: (n: number) => {
      ms += n * 60_000;
    },
  };
}

export interface Desk {
  readonly adapter: ITSMAdapter;
  readonly transport: (payload: ItsmEmitPayload) => Promise<void>;
  readonly tickets: ITSMTicketRequest[];
  readonly changes: ItsmEmitPayload[];
}

function createDesk(clock: Clock): Desk {
  const tickets: ITSMTicketRequest[] = [];
  const changes: ItsmEmitPayload[] = [];
  return {
    tickets,
    changes,
    adapter: {
      name: DESK_NAME,
      vendor: "generic_webhook",
      createTicket: async (request) => {
        tickets.push(request);
        return { ticketId: `DEMO-${(request.correlationId ?? "").slice(-6)}`, status: "new", createdAt: clock.now().toISOString() };
      },
    },
    transport: async (payload) => {
      changes.push(payload);
    },
  };
}

export interface Demo {
  readonly core: SignalGridCore;
  readonly clock: SteppingClock;
  readonly desk: Desk;
  readonly events: DemoEvent[];
  /** The remediation exactly as the restrict decision requested it (never approved). */
  requested: RemediationAction | null;
  incident: Incident | null;
  notices: AffectedNotice[];
  queue: OutboundItem[];
  started: boolean;
  stopped: boolean;
  subscribe(fn: (event: DemoEvent) => void): () => void;
  emit(step: string, title: string, system: string, detail: Record<string, unknown>, plain: string): DemoEvent;
  wait(ms: number): Promise<void>;
  /** Host confirmation. 200 delivered, 404 unknown, 409 already delivered or not a device notice. */
  ack(noticeId: string): { status: number; body: Record<string, unknown> };
  stop(): void;
}

function subject(clock: Clock): EstateSubject {
  return {
    identity: { externalRef: IDENTITY, displayName: PEOPLE[IDENTITY]!.label, state: "enabled", assignedRole: "unassigned" },
    device: { externalRef: DEVICE, name: DEVICE_NAME, osPlatform: "ios", osVersion: "18.0", ownerType: "corporate", managementAgent: "intune" },
    posture: {
      identityEnabled: true,
      managed: true,
      compliance: "compliant",
      encrypted: true,
      osSupported: true,
      lastSyncAt: clock.now().toISOString(),
      sourceReference: `mdm-fixture:managedDevices#${DEVICE}`,
    },
  };
}

/** A fresh core, clock, desk and event log every call. */
export function createDemo(): Demo {
  const clock = steppingClock();
  const spec: EstateSpec = {
    tenant: { id: "tenant_demo-live", slug: "demo-live", name: "Demo ward (local)" },
    principals: [
      { role: "owner", token: OWNER, subjectId: "user_demo_owner" },
      { role: "operator", token: OPERATOR, subjectId: "user_demo_operator" },
    ],
    connector: {
      mode: "fixture",
      sourceDescription: "an MDM-shaped (Intune managedDevices) fixture on this Mac: no tenant, no network",
      permissionScope: "read-only fixture",
      credentialRef: "fixture:no-credential",
    },
    subjects: [subject(clock)],
  };
  const core = SignalGridCore.fromEstate(clock, spec);
  const listeners = new Set<(event: DemoEvent) => void>();
  const timers = new Set<{ timer: ReturnType<typeof setTimeout>; done: () => void }>();

  const demo: Demo = {
    core,
    clock,
    desk: createDesk(clock),
    events: [],
    requested: null,
    incident: null,
    notices: [],
    queue: [],
    started: false,
    stopped: false,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    emit(step, title, system, detail, plain) {
      const event: DemoEvent = { seq: demo.events.length + 1, step, at: clock.now().toISOString(), title, system, detail, plain };
      demo.events.push(event);
      for (const fn of listeners) fn(event);
      return event;
    },
    wait(ms) {
      if (ms <= 0 || demo.stopped) return Promise.resolve();
      return new Promise((resolve) => {
        const entry = { timer: setTimeout(() => { timers.delete(entry); resolve(); }, ms), done: resolve };
        timers.add(entry);
      });
    },
    ack(noticeId) {
      const notice = demo.notices.find((n) => n.id === noticeId);
      if (!notice) return { status: 404, body: { error: "no such notice" } };
      if (notice.channel !== "device_prompt") {
        return { status: 409, body: { error: `only the device's host app confirms a device_prompt notice; this one is on ${notice.channel}` } };
      }
      if (notice.delivery.state === "delivered") return { status: 409, body: { error: "already delivered", at: notice.delivery.at } };
      const at = clock.now().toISOString();
      const delivered = recordNoticeDelivered(notice, "host:demo-page", at);
      demo.notices = demo.notices.map((n) => (n.id === noticeId ? delivered : n));
      let item = demo.queue.find((q) => q.channel === "notice" && q.subjectRef === noticeId);
      if (item) {
        item = recordOutboundAttempt(item, { ok: true, receiptRef: "host:demo-page" }, at);
        demo.queue = demo.queue.map((q) => (q.id === item!.id ? item! : q));
      }
      const who = PEOPLE[notice.principalRef];
      const name = who?.name ?? notice.principalRef;
      const event = demo.emit("notice.delivered", `${name}'s host app confirmed the notice`, "Host app stand-in (this page)", {
        noticeId,
        principalRef: notice.principalRef,
        label: who?.label ?? notice.principalRef,
        byHost: delivered.delivery.state === "delivered" ? delivered.delivery.byHost : null,
        at: delivered.delivery.state === "delivered" ? delivered.delivery.at : null,
        queueStatus: item?.status ?? null,
      }, `${name}'s app showed the notice and told SignalGrid it was delivered.`);
      return { status: 200, body: { event } };
    },
    stop() {
      demo.stopped = true;
      for (const entry of timers) {
        clearTimeout(entry.timer);
        entry.done();
      }
      timers.clear();
    },
  };
  return demo;
}

const put = (demo: Demo, item: OutboundItem): OutboundItem => {
  demo.queue = [...demo.queue.filter((q) => q.id !== item.id), item];
  return item;
};

/**
 * The story, (a)…(m), then the whole-story verdict. Each step appends one event.
 * Runs once per demo; a replay is a fresh demo.
 */
export async function playStory(demo: Demo, { stepDelayMs }: { stepDelayMs: number }): Promise<void> {
  if (demo.started) return;
  demo.started = true;
  const { core, clock } = demo;
  const now = (): string => clock.now().toISOString();
  const next = async (): Promise<boolean> => {
    await demo.wait(stepDelayMs);
    return demo.stopped;
  };
  const request = { identityRef: IDENTITY, deviceRef: DEVICE, workflowKey: WORKFLOW };
  const report = (compliance: FixturePostureRecord["compliance"]): FixturePostureRecord => ({
    deviceRef: DEVICE,
    identityRef: IDENTITY,
    ...subject(clock).posture,
    compliance,
    lastSyncAt: now(),
  });

  try {
    // (a) baseline
    const first = core.evaluate(OPERATOR, request);
    demo.emit("baseline", `Jordan on ${DEVICE_NAME}: ${first.outcome}`, SYS_CORE, {
      outcome: first.outcome,
      reasonCodes: first.reasonCodes,
      decisionId: first.decisionId,
    }, `Jordan opens his ward app on ${DEVICE_NAME}, and SignalGrid answers ${first.outcome}.`);
    if (await next()) return;

    // (b) the MDM reports non-compliant
    clock.advanceMinutes(5);
    const bad = core.refreshEstatePosture([report("non_compliant")]);
    demo.emit("signal.noncompliant", `MDM reports ${DEVICE_NAME} non_compliant (sync ${bad.status})`, SYS_MDM, {
      compliance: "non_compliant",
      status: bad.status,
      recordsProcessed: bad.recordsProcessed,
      signalsNormalized: bad.signalsNormalized,
      syncRunId: bad.id,
    }, `The MDM's next report says ${DEVICE_NAME} is no longer compliant.`);
    if (await next()) return;

    // (c) the decision. The cascade below runs only on a real restrict.
    const decision = core.getDecision(OWNER, core.evaluate(OPERATOR, request).decisionId);
    demo.emit("decision.restrict", `Decision: ${decision.outcome} (${decision.reasonCodes.join(", ")})`, SYS_CORE, {
      outcome: decision.outcome,
      reasonCodes: decision.reasonCodes,
      decisionId: decision.id,
      evidenceSnapshotId: decision.evidenceSnapshotId,
    }, `SignalGrid decides the same request again and answers ${decision.outcome}, because of ${decision.reasonCodes.join(", ") || "no reason code"}.`);
    if (decision.outcome !== "restrict") {
      throw new Error(`the decision was ${decision.outcome}, not restrict, so no cascade ran`);
    }
    demo.requested =
      core.listRemediations(OPERATOR).find((r) => r.decisionId === decision.id && r.kind === "request_device_remediation") ?? null;
    if (await next()) return;

    // (d) the resolution plan, and the words Jordan's own app shows for it
    const plan = core.getResolution(OPERATOR, decision.id);
    demo.emit("plan", `Resolution plan: ${plan.path}, ${plan.steps.length} step(s)`, "SignalGrid resolution planner", {
      path: plan.path,
      summaryForWorker: plan.summaryForWorker,
      steps: plan.steps.map((s) => ({ reasonCode: s.reasonCode, resolutionClass: s.resolutionClass, channel: s.channel, action: s.action })),
      unresolvedCodes: plan.unresolvedCodes,
    }, `SignalGrid works out the fix (${plan.path}, ${plan.steps.length} step(s)) and hands Jordan's app the words to show him.`);
    if (await next()) return;

    // (e) the incident. The detection is SCENARIO INPUT scripted here; the playbook's
    // priority, group and SLA are computed from it by the real code.
    const detection: Detection = {
      code: "CHECKOUT_WITHOUT_COMPLIANCE",
      severity: "high",
      reason: `${DEVICE_NAME} is in use while its MDM reports it non-compliant`,
      correlationId: decision.id,
      evidenceEventIds: [decision.evidenceSnapshotId],
    };
    const incident = mapDetectionToIncident(detection, { impact: "high", correlationId: decision.id, subjectLabel: DEVICE_NAME });
    if (!incident) throw new Error("the playbook opened no incident for a high-severity detection");
    demo.incident = incident;
    demo.emit("incident", `Incident ${incident.priority}: ${incident.shortDescription}`, "Incident playbook (priority = impact × urgency)", {
      trigger: "scenario input, scripted by this demo",
      detection: detection.code,
      priority: incident.priority,
      category: incident.category,
      escalate: incident.escalate,
      assignmentGroup: incident.assignmentGroup,
      correlationId: incident.correlationId,
    }, `An incident opens at ${incident.priority} for ${incident.assignmentGroup}. Its trigger is scenario input, scripted by this demo; the priority and routing are computed from it by the real incident playbook.`);
    if (await next()) return;

    // (f) the ticket, through the real dispatch seam
    let ticketItem = put(demo, enqueueOutbound({ tenantId: decision.tenantId, decisionId: decision.id, channel: "ticket", subjectRef: incident.correlationId, enqueuedAt: now() }));
    const dispatch = await dispatchIncident(incident, "generic_webhook", DESK_CONFIG, DESK_ENV, () => demo.desk.adapter);
    ticketItem = put(demo, recordOutboundAttempt(ticketItem, dispatch.opened ? { ok: true, receiptRef: dispatch.response.ticketId } : { ok: false, reason: dispatch.reason }, now()));
    demo.emit("ticket", dispatch.opened ? `Ticket ${dispatch.response.ticketId} opened` : `Ticket refused: ${dispatch.reason}`, DESK_NAME, {
      opened: dispatch.opened,
      ticketId: dispatch.opened ? dispatch.response.ticketId : null,
      reason: dispatch.opened ? null : dispatch.reason,
      title: dispatch.request.title,
      queueStatus: ticketItem.status,
      receiptRef: ticketItem.receiptRef,
      emissionGate: "opened for this one call by a demo-only beta/live setting; under default settings the same ticket is refused",
    }, dispatch.opened
      ? `The ticket desk accepts ticket ${dispatch.response.ticketId} (its title carries the scripted trigger). The desk is a local emulator, and SignalGrid sends to it only because this demo hands this one call a demo-only setting; under default settings the same ticket is refused.`
      : `The ticket desk refused the ticket: ${dispatch.reason}`);
    if (await next()) return;

    // (g) the change draft, exactly as decision-cascade-proof hop 5 builds it
    const draft = draftChangeRequest(
      { decisionId: plan.decisionId, steps: plan.steps.map((s) => ({ reasonCode: s.reasonCode, resolutionClass: s.resolutionClass, action: s.action, clears: s.clears })), unresolvedCodes: plan.unresolvedCodes },
      { kind: "device", ref: DEVICE },
    );
    const submission = await submitChangeDraft(draft, { ...DESK_ENV, ITSM_EMITTER_TOKEN: "an-emitter-token-that-is-present" }, demo.desk.transport);
    let changeItem = put(demo, enqueueOutbound({ tenantId: decision.tenantId, decisionId: decision.id, channel: "change_draft", subjectRef: draft.id, enqueuedAt: now() }));
    changeItem = put(demo, recordOutboundAttempt(changeItem, submission.status === "submitted" ? { ok: true, receiptRef: draft.id } : { ok: false, reason: submission.reason }, now()));
    demo.emit("change", `Change draft ${submission.status} (awaits human approval)`, DESK_NAME, {
      status: submission.status,
      reason: submission.status === "submitted" ? null : submission.reason,
      draftId: draft.id,
      items: draft.items.length,
      approvalRequired: draft.approvalRequired,
      simulatedOnly: draft.simulatedOnly,
      queueStatus: changeItem.status,
    }, submission.status === "submitted"
      ? "A change request for the iPad is drafted and sent to the same desk; it waits for a person to approve it."
      : `The change request was not sent: ${submission.reason}`);
    if (await next()) return;

    // (h) the people affected. Jordan is the decision's own subject: his host app got
    // the restrict verdict itself, so the router leaves him out by design.
    const scope = { decisionId: decision.id, tenantId: decision.tenantId, deviceId: DEVICE, workflowId: WORKFLOW, subjectRef: IDENTITY };
    const holders: ScopeHolder[] = [
      { principalRef: "user-jordan", role: "worker", scope: "device", scopeRef: DEVICE, channel: "device_prompt" },
      { principalRef: "user-sam", role: "worker", scope: "device", scopeRef: DEVICE, channel: "device_prompt" },
      { principalRef: "charge-nurse.ward", role: "operator", scope: "workflow", scopeRef: WORKFLOW, channel: "operator_console" },
    ];
    demo.notices = routeAffectedNotices(scope, deriveAffectedAudience(scope, holders), "owner.ward");
    for (const n of demo.notices) {
      put(demo, enqueueOutbound({ tenantId: decision.tenantId, decisionId: decision.id, channel: "notice", subjectRef: n.id, enqueuedAt: now() }));
    }
    demo.emit("notice.routed", `${demo.notices.length} notice(s) routed to channels people already use`, "Affected-audience router", {
      subjectRef: IDENTITY,
      notices: demo.notices.map((n) => ({
        id: n.id,
        principalRef: n.principalRef,
        name: PEOPLE[n.principalRef]?.name ?? n.principalRef,
        label: PEOPLE[n.principalRef]?.label ?? n.principalRef,
        channel: n.channel,
        reason: n.reason,
        backstop: n.backstop,
        delivery: n.delivery,
      })),
    }, `${demo.notices.length} other people who use this iPad or its workflow are told, each on a channel they already use. Jordan is not on this list: his own app already shows him the restriction.`);
    if (await next()) return;

    // (i) the approval — simulated; SignalGrid changes nothing on the MDM
    clock.advanceMinutes(1);
    if (!demo.requested) throw new Error("the restrict decision requested no device remediation");
    const approved = core.approveRemediation(OWNER, demo.requested.id);
    demo.emit("remediation.approved", `Remediation ${approved.status}`, "This demo's workflow (approval simulated)", {
      remediationId: approved.id,
      kind: approved.kind,
      status: approved.status,
      approvedAt: approved.approvedAt,
      label: "approved automatically by this demo's workflow (simulated; SignalGrid executed no change on the MDM; the fix arrives as the MDM's next report)",
    }, "The fix is approved. This approval is simulated by the demo, and SignalGrid changes nothing on the MDM itself.");
    if (await next()) return;

    // (j) the MDM's next report
    clock.advanceMinutes(5);
    const good = core.refreshEstatePosture([report("compliant")]);
    demo.emit("signal.compliant", `MDM reports ${DEVICE_NAME} compliant (sync ${good.status})`, SYS_MDM, {
      compliance: "compliant",
      status: good.status,
      recordsProcessed: good.recordsProcessed,
      signalsNormalized: good.signalsNormalized,
      syncRunId: good.id,
    }, `The MDM's next report says ${DEVICE_NAME} is compliant again.`);
    if (await next()) return;

    // (k) decide again
    const after = core.getDecision(OWNER, core.evaluate(OPERATOR, request).decisionId);
    demo.emit("decision.allow", `Decision: ${after.outcome} (${after.reasonCodes.join(", ")})`, SYS_CORE, {
      outcome: after.outcome,
      reasonCodes: after.reasonCodes,
      decisionId: after.id,
    }, `SignalGrid decides Jordan's request again and answers ${after.outcome}.`);
    if (await next()) return;

    // (l) did the fix land?
    const v = verifyRemediation(approved, [{ targetRef: after.deviceId, reasonCodes: after.reasonCodes, observedAt: after.createdAt }], now());
    demo.emit("verified", `Verification: ${v.state}`, "Remediation verifier", {
      state: v.state,
      restrictionHolds: restrictionHolds(v),
      observedAt: v.observedAt,
      note: v.note,
    }, v.state === "cleared"
      ? "SignalGrid checks the fix against the fresh decision: it landed, and the restriction is lifted."
      : `SignalGrid checks the fix against the fresh decision: ${v.state}, so the restriction still holds.`);
    if (await next()) return;

    // (m) the whole cascade, at a glance, with a plain reason for anything not delivered
    const summary = outboundSummary(demo.queue);
    const audit = core.verifyAudit(OWNER);
    const notDelivered = demo.queue.filter((q) => q.status !== "delivered").map((q) => {
      const n = q.channel === "notice" ? demo.notices.find((x) => x.id === q.subjectRef) : undefined;
      const who = n ? (PEOPLE[n.principalRef]?.label ?? n.principalRef) : q.channel;
      if (n?.channel === "operator_console") return `${who}: the console notice has no transport in this demo`;
      if (n) return `${who}: waits for their app to confirm it (this page confirms it when it shows the card)`;
      return `${who}: ${q.status}`;
    });
    demo.emit("cascade.complete", `Cascade complete: ${summary.delivered}/${summary.total} outbound delivered; audit chain ${audit.valid ? "valid" : "INVALID"}`, "Outbound queue + audit ledger", {
      summary,
      notDelivered,
      auditValid: audit.valid,
      auditLength: audit.length,
    }, `${summary.delivered} of ${summary.total} outbound messages are confirmed delivered${notDelivered.length ? ` (not yet: ${notDelivered.join("; ")})` : ""}. The audit chain is ${audit.valid ? "intact" : "BROKEN"}.`);

    // The verdict on the WHOLE story: the page's banner shows this, never one hop.
    const gaps = storyGaps(demo.events);
    if (gaps.length > 0) {
      demo.emit("story.failed", `Story did not complete: ${gaps.join("; ")}`, "Story grader (storyGaps)", { gaps },
        "At least one hop did not land; the cards above show which.");
    } else {
      demo.emit("story.passed", "Access restored: verified, not assumed. Every hop landed.", "Story grader (storyGaps)", { gaps },
        "Every hop landed: decision, plan, incident, ticket, change, notices, approval, fresh signal, allow, verification and audit.");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    demo.emit("story.failed", `Story did not complete: ${message}`, "demo runner", { gaps: [message] }, "The story stopped part-way; the last card above is where.");
    throw err;
  }
}

/** Every missing or failed hop, by name. Empty only for a story that landed. */
export function storyGaps(events: readonly DemoEvent[]): string[] {
  const d = (step: string): Record<string, unknown> => events.find((e) => e.step === step)?.detail ?? {};
  const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
  const gaps: string[] = [];
  if (d("baseline").outcome !== "allow") gaps.push("no baseline allow");
  if (d("signal.noncompliant").status !== "success") gaps.push("no non-compliant signal");
  if (d("decision.restrict").outcome !== "restrict") gaps.push("no restrict");
  if (!list(d("decision.restrict").reasonCodes).includes("DEVICE_NONCOMPLIANT")) gaps.push("no DEVICE_NONCOMPLIANT");
  if (list(d("plan").steps).length === 0) gaps.push("no plan");
  const worker = d("plan").summaryForWorker;
  if (typeof worker !== "string" || worker.length === 0) gaps.push("no worker screen");
  if (typeof d("incident").priority !== "string") gaps.push("no incident");
  if (d("ticket").opened !== true) gaps.push("ticket not opened");
  if (d("change").status !== "submitted") gaps.push("change not submitted");
  if (list(d("notice.routed").notices).length === 0) gaps.push("nobody routed");
  if (d("remediation.approved").status !== "approved_simulated") gaps.push("not approved");
  if (d("signal.compliant").status !== "success") gaps.push("fix signal not accepted");
  const allow = d("decision.allow");
  if (allow.outcome !== "allow" || list(allow.reasonCodes).includes("DEVICE_NONCOMPLIANT")) gaps.push("access not restored");
  const v = d("verified");
  if (v.state !== "cleared" || v.restrictionHolds !== false) gaps.push("verification not cleared");
  if (d("cascade.complete").auditValid !== true) gaps.push("audit chain invalid");
  return gaps;
}

// ─────────────────────────────────────────────────────────────────────────────
// The page. Plain JS by string concatenation: no backticks and no template holes,
// because this whole page is itself a template literal.
// ─────────────────────────────────────────────────────────────────────────────
export const DEMO_PAGE_HTML = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SignalGrid live demo</title>
<style>
  :root{
    --bg:#14171A;--panel:#191E22;--card:#1E2429;--ink:#F2F0EA;--soft:#AEB4AF;--faint:#7f8781;
    --line:#2A3137;--accent:#74ABA5;--allow:#6FA88C;--stepup:#C29A66;--restrict:#C99B6B;--deny:#C07474;
    --mono:ui-monospace,"IBM Plex Mono",Menlo,Consolas,monospace;
    --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
  }
  @media (prefers-color-scheme:light){:root{
    --bg:#F1EEE7;--panel:#FAF8F3;--card:#FFF;--ink:#1B1F21;--soft:#4C534E;--faint:#767c77;
    --line:#E4DFD3;--accent:#38726D;--allow:#4E7B5E;--stepup:#96703B;--restrict:#8a6a3b;--deny:#8C4B4B;
  }}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.5}
  .wrap{max-width:760px;margin:0 auto;padding:16px}
  header{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:.9rem;margin-bottom:1rem}
  .brand{font-family:var(--mono);font-weight:600}.brand span{color:var(--accent)}
  .chip{margin-left:auto;font-family:var(--mono);font-size:.7rem;letter-spacing:.08em;text-transform:uppercase;border:1px solid var(--line);border-radius:99px;padding:.25rem .6rem;color:var(--faint)}
  .chip.live{color:var(--allow);border-color:var(--allow)}
  .chip.reconnecting{color:var(--stepup);border-color:var(--stepup)}
  h1{font-size:1.1rem;margin:.2rem 0}
  .lead{color:var(--soft);font-size:.9rem;margin:0 0 1rem}
  #banner{display:none;border:1px solid var(--allow);color:var(--allow);border-radius:8px;padding:.7rem .8rem;margin-bottom:1rem;font-weight:600}
  #banner.on{display:block}
  #banner.fail{border-color:var(--deny);color:var(--deny)}
  ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.6rem}
  .card{background:var(--card);border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:8px;padding:.7rem .8rem;overflow-wrap:anywhere}
  .card.o-allow{border-left-color:var(--allow)}.card.o-step_up{border-left-color:var(--stepup)}
  .card.o-restrict{border-left-color:var(--restrict)}.card.o-deny{border-left-color:var(--deny)}
  .meta{font-family:var(--mono);font-size:.7rem;color:var(--faint)}
  .title{font-weight:600;margin:.15rem 0}
  .sys{font-size:.8rem;color:var(--soft)}
  dl{margin:.4rem 0 0;display:grid;grid-template-columns:minmax(0,9rem) minmax(0,1fr);gap:.15rem .6rem;font-size:.78rem}
  dt{color:var(--faint);font-family:var(--mono)}
  dd{margin:0;font-family:var(--mono)}
  @media (max-width:480px){dl{grid-template-columns:1fr}dd{margin-bottom:.3rem}}
  .host{background:var(--panel);border:1px dashed var(--accent);border-radius:14px;padding:.8rem;margin-top:.6rem}
  .frame{font-family:var(--mono);font-size:.68rem;letter-spacing:.06em;text-transform:uppercase;color:var(--faint)}
  .hosttext{margin:.3rem 0;font-size:.95rem}
  .plain{margin:.2rem 0 .1rem}
  details{margin-top:.4rem}
  summary{cursor:pointer;font-family:var(--mono);font-size:.72rem;color:var(--faint)}
  .meta.ok{color:var(--allow)}.meta.bad{color:var(--deny)}
  #replay{font:inherit;font-weight:600;background:transparent;color:var(--accent);border:1px solid var(--accent);border-radius:8px;padding:.5rem .9rem;margin:0 0 .6rem;cursor:pointer}
  #replay[hidden]{display:none}
  #note{font-size:.8rem;color:var(--soft);margin:0 0 .6rem}
</style>
</head>
<body>
<div class="wrap">
  <header><span class="brand">Signal<span>Grid</span></span><span class="chip" id="chip">waiting</span></header>
  <h1>One ward iPad, one signal, the whole cascade</h1>
  <p class="lead">Every decision, reason code, id and status on this page is computed by SignalGrid's real engine, live on this Mac, on a scripted clock. The people and their app screens, the ticket desk and the MDM are local stand-ins; the incident's trigger and the approval are scripted by this demo, and their cards say so. No vendor system is contacted.</p>
  <div id="banner" role="status"></div>
  <button id="replay" type="button" hidden>Replay the story</button>
  <p id="note" aria-live="polite"></p>
  <ol id="timeline" aria-live="polite"></ol>
</div>
<script>
(function () {
  var run = 0;
  var mine = {};
  var chip = document.getElementById("chip");
  var list = document.getElementById("timeline");
  var banner = document.getElementById("banner");
  var replay = document.getElementById("replay");
  var note = document.getElementById("note");
  var HOST_WORDS = {
    scope_device_affected: "This shared iPad is restricted right now. Use another device until IT clears it.",
    scope_workflow_affected: "A device in your workflow is restricted.",
    scope_restricted: "An area you use is restricted.",
    audience_unresolved: "SignalGrid could not work out who else to tell."
  };
  function setChip(state) { chip.textContent = state; chip.className = "chip " + state; }
  function el(tag, cls, value) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (value !== undefined) node.textContent = value;
    return node;
  }
  function show(value) {
    if (value === null || value === undefined) return "-";
    if (Array.isArray(value)) return value.length ? value.map(show).join(" | ") : "(none)";
    if (typeof value === "object") return Object.keys(value).map(function (k) { return k + "=" + show(value[k]); }).join(", ");
    return String(value);
  }
  function post(url) {
    return fetch(url, { method: "POST" })
      .then(function (r) { return r.json().then(function (body) { return { ok: r.ok, status: r.status, body: body || {} }; }); });
  }
  function mark(node, text, ok) { node.textContent = text; node.className = "meta " + (ok ? "ok" : "bad"); }
  function hostCard(n) {
    var box = el("div", "host");
    box.appendChild(el("div", "frame", "What " + n.name + "'s own ward-iPad app shows (host app stand-in)"));
    box.appendChild(el("p", "hosttext", HOST_WORDS[n.reason] || n.reason));
    box.appendChild(el("div", "meta", "SignalGrid's reason: " + n.reason + ". The words are the host app's own."));
    var status = el("div", "meta", "confirming delivery to SignalGrid...");
    box.appendChild(status);
    var key = run + ":" + n.id;
    if (mine[key]) { mark(status, "delivery confirmed by this screen", true); return box; }
    post("/ack/" + encodeURIComponent(n.id))
      .then(function (res) {
        if (res.ok) { mine[key] = true; mark(status, "delivery confirmed by this screen", true); }
        else if (res.status === 409 && res.body.error === "already delivered") mark(status, "confirmed on another screen", true);
        else mark(status, "not confirmed: " + (res.body.error || "refused"), false);
      })
      .catch(function () { mark(status, "not confirmed: the demo server did not answer", false); });
    return box;
  }
  function workerCard(text) {
    var box = el("div", "host");
    box.appendChild(el("div", "frame", "What Jordan's app shows"));
    box.appendChild(el("p", "hosttext", text));
    box.appendChild(el("div", "meta", "SignalGrid's worker summary for this decision, shown inside Jordan's own app; he never sees a SignalGrid screen."));
    return box;
  }
  function card(ev) {
    var detail = ev.detail || {};
    var li = el("li", "card" + (detail.outcome ? " o-" + detail.outcome : ""));
    li.appendChild(el("div", "meta", "#" + ev.seq + " · " + ev.at.slice(11, 19) + "Z · " + ev.step));
    li.appendChild(el("div", "title", ev.title));
    if (ev.plain) li.appendChild(el("p", "plain", ev.plain));
    li.appendChild(el("div", "sys", "by " + ev.system));
    if (typeof detail.summaryForWorker === "string") li.appendChild(workerCard(detail.summaryForWorker));
    (detail.notices || []).forEach(function (n) {
      if (n.channel === "device_prompt") li.appendChild(hostCard(n));
      else li.appendChild(el("div", "sys", n.label + ": routed to " + n.channel + " (" + n.reason + "), " + n.delivery.state));
    });
    var dl = el("dl");
    Object.keys(detail).forEach(function (k) {
      if (k === "notices") return;
      dl.appendChild(el("dt", "", k));
      dl.appendChild(el("dd", "", show(detail[k])));
    });
    var more = el("details");
    more.appendChild(el("summary", "", "Details"));
    more.appendChild(dl);
    li.appendChild(more);
    return li;
  }
  replay.onclick = function () {
    replay.disabled = true;
    note.textContent = "Starting the replay...";
    post("/replay")
      .then(function (res) {
        if (res.ok) return;
        replay.disabled = false;
        note.textContent = res.status === 409 ? "A replay is already running; it shows here as it plays." : "Replay refused: " + (res.body.error || "unknown");
      })
      .catch(function () { replay.disabled = false; note.textContent = "Replay failed: the demo server did not answer"; });
  };
  setChip("waiting");
  var source = new EventSource("/events");
  source.onopen = function () { setChip("live"); };
  source.onerror = function () { setChip("reconnecting"); };
  source.onmessage = function (m) {
    var ev;
    try { ev = JSON.parse(m.data); } catch (e) { return; }
    setChip("live");
    if (ev.reset) {
      run = ev.run;
      list.textContent = "";
      banner.textContent = "";
      banner.className = "";
      replay.hidden = true;
      replay.disabled = false;
      note.textContent = "";
      return;
    }
    list.appendChild(card(ev));
    if (ev.step === "story.passed" || ev.step === "story.failed") {
      banner.textContent = ev.title;
      banner.className = ev.step === "story.passed" ? "on" : "on fail";
      replay.hidden = false;
    }
  };
})();
</script>
</body>
</html>
`;

// ─────────────────────────────────────────────────────────────────────────────
// The server: stdlib http, SSE, no CORS.
// ─────────────────────────────────────────────────────────────────────────────
export interface DemoServer {
  readonly url: string;
  readonly port: number;
  close(): Promise<void>;
}

/**
 * Serves `first`, then a fresh `createDemo()` per POST /replay. Every /events viewer
 * gets `{reset, run}` first, then the events so far, then live ones; a replay sends
 * every attached viewer a new reset and plays the fresh story to all of them.
 */
export function startDemoServer(
  first: Demo,
  { host, port, stepDelayMs = 2500, onEvent }: { host: string; port: number; stepDelayMs?: number; onEvent?: (event: DemoEvent) => void },
): Promise<DemoServer> {
  const clients = new Set<ServerResponse>();
  const heartbeats = new Set<ReturnType<typeof setInterval>>();
  const json = (res: ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body));
  };
  const frame = (body: unknown): string => `data: ${JSON.stringify(body)}\n\n`;
  const broadcast = (event: DemoEvent): void => {
    for (const res of clients) res.write(frame(event));
    onEvent?.(event);
  };
  let demo = first;
  let run = 1;
  let unhook = demo.subscribe(broadcast);
  const play = (): void => void playStory(demo, { stepDelayMs }).catch(() => undefined);

  const server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (req.method === "GET" && path === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(DEMO_PAGE_HTML);
      return;
    }
    if (req.method === "GET" && path === "/events") {
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive" });
      res.write(frame({ reset: true, run }));
      for (const event of demo.events) res.write(frame(event));
      const beat = setInterval(() => res.write(":\n\n"), 15_000);
      beat.unref();
      clients.add(res);
      heartbeats.add(beat);
      req.on("close", () => {
        clearInterval(beat);
        heartbeats.delete(beat);
        clients.delete(res);
      });
      if (!demo.started) play();
      return;
    }
    if (req.method === "POST" && path === "/replay") {
      if (!demo.events.some((e) => isEnd(e.step))) {
        json(res, 409, { error: demo.started ? "the story is still playing" : "the story has not started yet" });
        return;
      }
      unhook();
      demo.stop();
      demo = createDemo();
      run += 1;
      unhook = demo.subscribe(broadcast);
      for (const c of clients) c.write(frame({ reset: true, run }));
      play();
      json(res, 200, { run });
      return;
    }
    const ack = /^\/ack\/([^/]+)$/.exec(path ?? "");
    if (req.method === "POST" && ack) {
      let id: string;
      try {
        id = decodeURIComponent(ack[1]!);
      } catch {
        json(res, 404, { error: "no such notice" });
        return;
      }
      const result = demo.ack(id);
      json(res, result.status, result.body);
      return;
    }
    json(res, 404, { error: "not found" });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const address = server.address();
      const bound = typeof address === "object" && address ? address.port : port;
      resolve({
        url: `http://${host}:${bound}/`,
        port: bound,
        close: () =>
          new Promise<void>((done) => {
            demo.stop();
            for (const beat of heartbeats) clearInterval(beat);
            heartbeats.clear();
            for (const res of clients) res.end();
            clients.clear();
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Main — only when run as the entrypoint (the proof imports this module).
// ─────────────────────────────────────────────────────────────────────────────
function flag(name: string, fallback: number, max: number): number {
  const i = process.argv.indexOf(name);
  if (i < 0) return fallback;
  const value = Number(process.argv[i + 1]);
  if (!Number.isInteger(value) || value < 0 || value > max) {
    console.error(`${name} needs a whole number from 0 to ${max}`);
    process.exit(2);
  }
  return value;
}

/** The Wi-Fi device name macOS reports (en0 on a laptop, often en1 on a desktop); null off macOS. */
function wifiDevice(): string | null {
  try {
    const ports = execFileSync("networksetup", ["-listallhardwareports"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return /Hardware Port: (?:Wi-Fi|AirPort)\s*\nDevice: (\S+)/.exec(ports)?.[1] ?? null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const port = flag("--port", 5180, 65535);
  const stepDelayMs = flag("--step-ms", 2500, 600_000);
  const onEvent = (e: DemoEvent): void => console.log(`  #${e.seq} ${e.at.slice(11, 19)}Z ${e.step}: ${e.title} [${e.system}]`);

  let server: DemoServer;
  try {
    server = await startDemoServer(createDemo(), { host: "0.0.0.0", port, stepDelayMs, onEvent });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
    server = await startDemoServer(createDemo(), { host: "0.0.0.0", port: 0, stepDelayMs, onEvent });
    console.log(`Port ${port} is busy, so the demo took port ${server.port} instead.`);
  }

  console.log("\nSignalGrid live demo: runs on this Mac (no tenant, no internet, no database); viewable from phones on the same Wi-Fi");
  console.log(`  On this Mac:  http://localhost:${server.port}/`);
  const wifi = wifiDevice();
  const links: Array<{ name: string; address: string }> = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === "IPv4" && !a.internal) links.push({ name, address: a.address });
  }
  links.sort((x, y) => Number(y.name === wifi) - Number(x.name === wifi));
  for (const { name, address } of links) {
    console.log(`  On a phone:   http://${address}:${server.port}/   (${name}${name === wifi ? ", Wi-Fi" : ""})`);
  }
  console.log("  macOS may ask once whether node may accept incoming connections; allow it for the phone link to work.");
  console.log("  The story starts when the first page opens; the page's Replay button plays it again. Press Ctrl-C to stop.\n");

  let stopping = false;
  const onSignal = (): void => {
    if (stopping) process.exit(130);
    stopping = true;
    void server.close().then(() => process.exit(0));
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
