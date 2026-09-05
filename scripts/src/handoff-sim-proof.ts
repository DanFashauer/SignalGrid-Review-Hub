// Cross-device handoff simulation + exception-release verification loop proof —
// fully OFFLINE and deterministic.
//
// Two Issue #136 acceptance criteria made checkable:
//
//   1. "A deterministic cross-device handoff simulation preserves role/workflow
//      context while re-evaluating device and location trust" — a handoff script
//      is DATA, replayed through the REAL mechanisms (`assembleWorkContext`,
//      `reevaluateForDevice`, the task-exception normalize→evaluate→adapt chain,
//      the `resolveException` door), and the trace is the audit story.
//
//   2. The warehouse criterion's second half: "verify that the inventory/bin
//      state was corrected before releasing the workflow" — the release loop's
//      law, grounded in the verified Oracle short-pick chain (the discrepancy
//      spawns a cycle count, and the COUNT confirms the fix): a resolution
//      posting is not verification; release requires independent evidence AND a
//      trusted device.
//
// Every refusal below is asserted WITH its typed reason — this repo has paid for
// reason-blind checks before — and the no-echo discipline is asserted on the
// thrown messages themselves: no refusal may repeat a caller-supplied ref (the
// sixth adversarial review read a pasted JWT back out of exactly such a message).
import {
  HandoffSimError,
  releaseHeldTask,
  runHandoffScript,
  type HandoffScript,
  type HandoffTrace,
  type HandoffTraceEntry,
  type ReleaseLedger,
  HANDOFF_SIM_ERROR_CODES,
} from "@workspace/handoff-sim";
import {
  WorkContextError,
  assembleWorkContext,
  reevaluateForDevice,
  type AssembleWorkContextInputs,
} from "@workspace/work-context";
import { type ComposableSignal } from "@workspace/posture-composition";
import { evaluateTaskException, normalizeReport, type TaskExceptionReportRaw } from "@workspace/integrations/task-exception";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Cross-device handoff simulation + release-loop proof");

// ── deterministic fixtures ────────────────────────────────────────────────────

const healthyHandheld: ComposableSignal[] = [
  { kind: "device_posture", posture: "compliant", action: "none", reason: "POSTURE_COMPLIANT" },
];
const degradedWorkstation: ComposableSignal[] = [
  { kind: "device_posture", posture: "agent_stale", action: "step_up", reason: "POSTURE_UNVERIFIED" },
  { kind: "sso_session", posture: "leftover_session_expired", action: "restrict", reason: "LEFTOVER_SESSION" },
];
const cleanIpad: ComposableSignal[] = [
  { kind: "device_posture", posture: "compliant", action: "none", reason: "POSTURE_COMPLIANT" },
];
const staleIpad: ComposableSignal[] = [
  { kind: "device_posture", posture: "agent_stale", action: "step_up", reason: "POSTURE_STALE" },
];

/** The wrong-aisle inventory exception, as the execution-system bridge would
 *  report it: an OPEN inventory discrepancy on an in-process task, system
 *  reachable, vendor code carried verbatim. */
const wrongAisleRaw: TaskExceptionReportRaw = {
  exceptionKind: "inventory_exception",
  exceptionState: "active",
  taskState: "in_process",
  taskSystemReachable: true,
  sourceExceptionCode: "DIFF",
};

function pickerInputs(): AssembleWorkContextInputs {
  return {
    subject: { personRef: "person-0001", tenantId: "tenant-alpha", role: "picker", shiftRef: "shift-0400", assignmentRef: "wave-0092" },
    work: {
      workflowKey: "warehouse-inbound-putaway",
      activeTaskRefs: ["task-0107", "task-0108"],
      heldTaskRefs: [],
      unresolvedExceptionRefs: [],
      appCatalogKeys: ["wms-client", "scan-verify"],
    },
    situation: { lastKnownZoneRef: "zone-inbound-03", custodyRefs: ["custody-case-0044"] },
    sourceVerdicts: [{ verdictRef: "vrd-1001", strongestAction: "none", reasonCodes: ["TASK_STREAM_HEALTHY"] }],
    policyVersionRef: "policy-v14",
    assembledAtRef: "asm-000201",
  };
}

function nurseInputs(): AssembleWorkContextInputs {
  return {
    subject: { personRef: "person-0210", tenantId: "tenant-med", role: "nurse", shiftRef: "shift-night", assignmentRef: "unit-4east" },
    work: {
      workflowKey: "healthcare-med-admin",
      activeTaskRefs: ["medpass-0651"],
      heldTaskRefs: [],
      unresolvedExceptionRefs: [],
      appCatalogKeys: ["emr-client", "barcode-med-admin"],
    },
    situation: { lastKnownZoneRef: "zone-unit-4east", custodyRefs: [] },
    sourceVerdicts: [{ verdictRef: "vrd-2001", strongestAction: "none", reasonCodes: ["TASK_STREAM_HEALTHY"] }],
    policyVersionRef: "policy-v14",
    assembledAtRef: "asm-000202",
  };
}

// The carried entry the simulator must derive from the REAL evaluator's reason
// code — asserted below before the scenario relies on it.
const ENTRY = "INVENTORY_EXCEPTION_ACTIVE:exc-0107-wrongaisle";
const RESOLUTION = "wms-inventory-adjustment-0107";
const EVIDENCE = "cyclecount-recount-0107";

// ── fixture sanity: the REAL task-exception chain says what the scenario claims ─

const sanity = evaluateTaskException(normalizeReport("handheld-A", wrongAisleRaw));
check("fixture sanity: the wrong-aisle raw report parses CLEAN through the real normalizer",
  normalizeReport("handheld-A", wrongAisleRaw).reportIntegrity === "clean");
check("fixture sanity: the real evaluator grades it INVENTORY_EXCEPTION_ACTIVE / inventory_exception / alert",
  sanity.reasonCode === "INVENTORY_EXCEPTION_ACTIVE" && sanity.posture === "inventory_exception" && sanity.recommendedAction === "alert");
check("fixture sanity: it is a confirmed finding about the work, not a gap — criticalFindings names it, unknownSignals is empty",
  sanity.criticalFindings.includes("inventory_exception_active") && sanity.unknownSignals.length === 0);

// ── WAREHOUSE SCENARIO: the full release loop, end to end, as a script ────────

const warehouseScript: HandoffScript = {
  scriptRef: "script-warehouse-0001",
  steps: [
    { kind: "assemble", inputs: pickerInputs() },                                                     // 0
    { kind: "handoff", deviceRef: "handheld-A", deviceSignals: healthyHandheld },                     // 1
    { kind: "exception", taskRef: "task-0107", exceptionRef: "exc-0107-wrongaisle", raw: wrongAisleRaw }, // 2
    { kind: "handoff", deviceRef: "workstation-B", deviceSignals: degradedWorkstation },              // 3
    { kind: "release", taskRef: "task-0107", exceptionRef: ENTRY },                                   // 4: unresolved
    { kind: "resolve", exceptionRef: ENTRY, resolutionRef: RESOLUTION },                              // 5
    { kind: "release", taskRef: "task-0107", exceptionRef: ENTRY },                                   // 6: no evidence
    { kind: "verify", exceptionRef: ENTRY, verificationEvidenceRef: RESOLUTION },                     // 7: fix cites itself
    { kind: "release", taskRef: "task-0107", exceptionRef: ENTRY },                                   // 8: not independent
    { kind: "verify", exceptionRef: ENTRY, verificationEvidenceRef: EVIDENCE },                       // 9
    { kind: "release", taskRef: "task-0107", exceptionRef: ENTRY },                                   // 10: bad device
    { kind: "handoff", deviceRef: "handheld-A", deviceSignals: healthyHandheld },                     // 11
    { kind: "release", taskRef: "task-0107", exceptionRef: ENTRY },                                   // 12: succeeds
  ],
};

const scriptBefore = JSON.stringify(warehouseScript);
const warehouse = runHandoffScript(warehouseScript);
const w = warehouse.trace.entries;

check("warehouse: the script produced one trace entry per step, in order",
  w.length === warehouseScript.steps.length && w.every((e, i) => e.stepIndex === i && e.kind === warehouseScript.steps[i].kind));

check("warehouse[0] assemble: version 1, both tasks active, nothing held, no exceptions",
  w[0].status === "applied" && w[0].contextVersion === 1 &&
  JSON.stringify(w[0].work?.activeTaskRefs) === JSON.stringify(["task-0107", "task-0108"]) &&
  w[0].work?.heldTaskRefs.length === 0 && w[0].work?.unresolvedExceptionRefs.length === 0);

check("warehouse[1] handoff to healthy handheld: none-tier decision — device none, final none, ceiling none",
  w[1].status === "applied" && w[1].decision?.deviceAction === "none" &&
  w[1].decision?.finalRequiredAction === "none" && w[1].requiredStepUpLevel === "none" && w[1].deviceRef === "handheld-A");

check("warehouse[2] exception: the REAL chain concluded it — reasonCode INVENTORY_EXCEPTION_ACTIVE, posture inventory_exception, alert",
  w[2].status === "applied" && w[2].exception?.reasonCode === "INVENTORY_EXCEPTION_ACTIVE" &&
  w[2].exception?.posture === "inventory_exception" && w[2].exception?.recommendedAction === "alert");
check("warehouse[2] exception: the derived carried entry is `<reasonCode>:<exceptionRef>` and it travels",
  w[2].exception?.carriedEntry === ENTRY && w[2].work?.unresolvedExceptionRefs.includes(ENTRY) === true);
check("warehouse[2] exception: task-0107 is HELD — moved out of active, into held",
  w[2].exception?.taskHeld === true &&
  JSON.stringify(w[2].work?.heldTaskRefs) === JSON.stringify(["task-0107"]) &&
  w[2].work?.activeTaskRefs.includes("task-0107") === false);
check("warehouse[2] THE WORKER KEEPS WORKING: task-0108 stays active — one bad pick holds one task, not the shift",
  w[2].work?.activeTaskRefs.includes("task-0108") === true && w[2].work?.activeTaskRefs.length === 1);
check("warehouse[2] the decision reflects the alert (device composed alert), and the ceiling ratchets to step_up",
  w[2].decision?.finalRequiredAction === "alert" && w[2].decision?.deviceAction === "alert" && w[2].requiredStepUpLevel === "step_up");

check("warehouse[3] handoff to degraded workstation: its OWN composition is restrict-grade, and the decision tightens to restrict",
  w[3].status === "applied" && w[3].decision?.deviceAction === "restrict" && w[3].decision?.finalRequiredAction === "restrict");
check("warehouse[3] the held task and the exception entry are CARRIED onto the workstation, and the restrict driver travels as a restriction",
  w[3].work?.heldTaskRefs.includes("task-0107") === true && w[3].work?.unresolvedExceptionRefs.includes(ENTRY) === true &&
  w[3].activeRestrictions.includes("LEFTOVER_SESSION") && w[3].requiredStepUpLevel === "restrict");

check("warehouse[4] release BEFORE resolve → typed refusal `exception_unresolved`; the hold stands, the version does not move",
  w[4].status === "refused" && w[4].refusalCode === "exception_unresolved" &&
  w[4].work?.heldTaskRefs.includes("task-0107") === true && w[4].contextVersion === w[3].contextVersion);

check("warehouse[5] resolve posted (the WMS inventory adjustment): recorded, context untouched — a resolution posting releases nothing",
  w[5].status === "applied" && w[5].contextVersion === w[3].contextVersion && w[5].work?.unresolvedExceptionRefs.includes(ENTRY) === true);

check("warehouse[6] release with resolution but NO evidence → typed refusal `verification_missing` — the fix is not the proof of the fix",
  w[6].status === "refused" && w[6].refusalCode === "verification_missing" && w[6].work?.heldTaskRefs.includes("task-0107") === true);

check("warehouse[8] release where the evidence ref IS the resolution ref → typed refusal `verification_not_independent`",
  w[7].status === "applied" && w[8].status === "refused" && w[8].refusalCode === "verification_not_independent");

check("warehouse[10] release with distinct evidence but on the restrict-grade workstation → typed refusal `device_not_trusted_for_release`",
  w[9].status === "applied" && w[10].status === "refused" && w[10].refusalCode === "device_not_trusted_for_release" &&
  w[10].deviceRef === "workstation-B");

check("warehouse[11] handoff back to the healthy handheld: device composes none — but the carried restrict ceiling is still owed",
  w[11].status === "applied" && w[11].decision?.deviceAction === "none" && w[11].decision?.finalRequiredAction === "restrict");

check("warehouse[12] release SUCCEEDS on the trusted device: task-0107 active again, nothing held, the exception entry is gone",
  w[12].status === "applied" && w[12].work?.activeTaskRefs.includes("task-0107") === true &&
  w[12].work?.activeTaskRefs.includes("task-0108") === true && w[12].work?.heldTaskRefs.length === 0 &&
  w[12].work?.unresolvedExceptionRefs.includes(ENTRY) === false);
check("warehouse[12] ...and the final context agrees with the trace byte-for-byte",
  JSON.stringify(warehouse.finalContext?.work) === JSON.stringify(w[12].work));
check("warehouse: contextVersion strictly increased at every applied context-changing step (1→2→3→4→5→6)",
  JSON.stringify([w[0], w[1], w[2], w[3], w[11], w[12]].map((e) => e.contextVersion)) === JSON.stringify([1, 2, 3, 4, 5, 6]));
check("warehouse: the role/workflow context was PRESERVED end to end — workflow key, app catalog and custody refs identical first to last",
  w[0].work?.workflowKey === w[12].work?.workflowKey &&
  JSON.stringify(w[0].work?.appCatalogKeys) === JSON.stringify(w[12].work?.appCatalogKeys) &&
  JSON.stringify(w[0].custodyRefs) === JSON.stringify(w[12].custodyRefs));

// ── HEALTHCARE SCENARIO: three shared iPads, work identical, trust re-earned ──

const healthcareScript: HandoffScript = {
  scriptRef: "script-healthcare-0001",
  steps: [
    { kind: "assemble", inputs: nurseInputs() },
    { kind: "handoff", deviceRef: "ipad-A", deviceSignals: cleanIpad },
    { kind: "handoff", deviceRef: "ipad-B", deviceSignals: staleIpad },
    { kind: "handoff", deviceRef: "ipad-C", deviceSignals: cleanIpad },
  ],
};
const healthcare = runHandoffScript(healthcareScript);
const h = healthcare.trace.entries;

check("healthcare[1] iPad A clean: device none, final none — a clean start owes nothing",
  h[1].status === "applied" && h[1].decision?.deviceAction === "none" && h[1].decision?.finalRequiredAction === "none");
check("healthcare[2] iPad B stale posture: the decision TIGHTENS to step_up, and the ceiling ratchets with it",
  h[2].decision?.deviceAction === "step_up" && h[2].decision?.finalRequiredAction === "step_up" && h[2].requiredStepUpLevel === "step_up");
check("healthcare[2] ...while the WORK is byte-identical to iPad A's — continuity carried the work, not the trust",
  JSON.stringify(h[1].work) === JSON.stringify(h[2].work));
check("healthcare[3] iPad C clean again: its own composition is none, but the carried step_up ceiling is STILL OWED until resolution",
  h[3].decision?.deviceAction === "none" && h[3].decision?.finalRequiredAction === "step_up" && h[3].requiredStepUpLevel === "step_up");
check("healthcare[3] ...and the work is still byte-identical across all three iPads",
  JSON.stringify(h[1].work) === JSON.stringify(h[3].work));

// ── trace invariants, audited over BOTH scenarios ─────────────────────────────

interface AuditCounters {
  audited: number;
  versionRegressions: number;
  versionStalls: number;
  taskLosses: number;
  setDrifts: number;
  exceptionDrops: number;
}

const sortedSet = (refs: readonly string[]): string => [...refs].sort().join("|");

function auditTrace(trace: HandoffTrace): AuditCounters {
  const c: AuditCounters = { audited: 0, versionRegressions: 0, versionStalls: 0, taskLosses: 0, setDrifts: 0, exceptionDrops: 0 };
  let prev: HandoffTraceEntry | null = null;
  for (const e of trace.entries) {
    if (prev !== null && prev.work !== null && e.work !== null && prev.contextVersion !== null && e.contextVersion !== null) {
      c.audited += 1;
      // contextVersion is monotone across EVERY step, and strictly increases at
      // applied context-changing steps.
      if (e.contextVersion < prev.contextVersion) c.versionRegressions += 1;
      const contextChanging = e.status === "applied" && (e.kind === "handoff" || e.kind === "exception" || e.kind === "release");
      if (contextChanging && e.contextVersion <= prev.contextVersion) c.versionStalls += 1;
      if (!contextChanging && e.contextVersion !== prev.contextVersion) c.versionStalls += 1;
      // CONSERVATION: the union of active+held is identical across every step —
      // a hold or a release MOVES a task; nothing ever loses one.
      if (sortedSet([...e.work.activeTaskRefs, ...e.work.heldTaskRefs]) !== sortedSet([...prev.work.activeTaskRefs, ...prev.work.heldTaskRefs])) {
        c.taskLosses += 1;
      }
      // The individual active/held sets change ONLY at explicit applied
      // hold (exception) or release steps.
      const movement = e.status === "applied" && (e.kind === "exception" || e.kind === "release");
      const setsChanged =
        sortedSet(e.work.activeTaskRefs) !== sortedSet(prev.work.activeTaskRefs) ||
        sortedSet(e.work.heldTaskRefs) !== sortedSet(prev.work.heldTaskRefs);
      if (setsChanged && !movement) c.setDrifts += 1;
      // EXCEPTIONS TRAVEL: every step's exception entries are a superset of the
      // previous step's, except an applied release — which removes exactly one.
      const isRelease = e.status === "applied" && e.kind === "release";
      if (isRelease) {
        if (e.work.unresolvedExceptionRefs.length !== prev.work.unresolvedExceptionRefs.length - 1) c.exceptionDrops += 1;
      } else if (!prev.work.unresolvedExceptionRefs.every((r) => e.work!.unresolvedExceptionRefs.includes(r))) {
        c.exceptionDrops += 1;
      }
    }
    prev = e;
  }
  return c;
}

const wAudit = auditTrace(warehouse.trace);
const hAudit = auditTrace(healthcare.trace);
const audited = wAudit.audited + hAudit.audited;
const versionRegressions = wAudit.versionRegressions + hAudit.versionRegressions;
const versionStalls = wAudit.versionStalls + hAudit.versionStalls;
const taskLosses = wAudit.taskLosses + hAudit.taskLosses;
const setDrifts = wAudit.setDrifts + hAudit.setDrifts;
const exceptionDrops = wAudit.exceptionDrops + hAudit.exceptionDrops;

check(`invariant: contextVersion monotone over both traces, strict exactly at applied context-changing steps (${audited} transitions, regressions=${versionRegressions}, stalls=${versionStalls})`,
  audited === 15 && versionRegressions === 0 && versionStalls === 0);
check(`invariant: NO TASK EVER LOST — active+held union conserved across every transition (losses=${taskLosses})`,
  taskLosses === 0);
check(`invariant: active/held membership changes ONLY at explicit hold/release steps (drifts=${setDrifts})`,
  setDrifts === 0);
check(`invariant: exception refs are supersets at every step except an applied release, which removes exactly one (drops=${exceptionDrops})`,
  exceptionDrops === 0);

// ── determinism and purity ────────────────────────────────────────────────────

check("determinism: two runs of the warehouse script produce byte-identical traces AND final contexts",
  JSON.stringify(runHandoffScript(warehouseScript).trace) === JSON.stringify(warehouse.trace) &&
  JSON.stringify(runHandoffScript(warehouseScript).finalContext) === JSON.stringify(warehouse.finalContext));
check("determinism: two runs of the healthcare script produce byte-identical traces",
  JSON.stringify(runHandoffScript(healthcareScript).trace) === JSON.stringify(healthcare.trace));
check("purity: the input script was never mutated by any of those runs",
  JSON.stringify(warehouseScript) === scriptBefore);
check("the trace is deep-frozen — entries, work snapshots and ref arrays all the way down",
  Object.isFrozen(warehouse.trace) && Object.isFrozen(warehouse.trace.entries) &&
  Object.isFrozen(w[2]) && Object.isFrozen(w[2].work) && Object.isFrozen(w[2].work?.heldTaskRefs));
check("the final context is the real frozen article from the work-context doors",
  warehouse.finalContext !== null && Object.isFrozen(warehouse.finalContext) && Object.isFrozen(warehouse.finalContext.work));

// ── negative controls: every refusal reason, direct and reason-asserted ───────

const CTRL_ENTRY = "INVENTORY_EXCEPTION_ACTIVE:exc-ctrl-4410";
const CTRL_RESOLUTION = "wms-adj-ctrl-0001";
const CTRL_EVIDENCE = "cyclecount-ctrl-0002";

const heldCtx = assembleWorkContext({
  ...pickerInputs(),
  work: {
    ...pickerInputs().work,
    activeTaskRefs: ["task-0300"],
    heldTaskRefs: ["task-0200"],
    unresolvedExceptionRefs: [CTRL_ENTRY],
  },
});
const trustedDecision = reevaluateForDevice(heldCtx, healthyHandheld).decision;
const restrictedDecision = reevaluateForDevice(heldCtx, degradedWorkstation).decision;
check("control fixture: the trusted device composes none, the degraded one composes restrict — judged by the real composition",
  trustedDecision.deviceAction === "none" && restrictedDecision.deviceAction === "restrict");

const fullLedger = (decision: ReleaseLedger["currentDeviceDecision"]): ReleaseLedger => ({
  holds: { "task-0200": CTRL_ENTRY },
  resolutions: { [CTRL_ENTRY]: CTRL_RESOLUTION },
  verifications: { [CTRL_ENTRY]: CTRL_EVIDENCE },
  currentDeviceDecision: decision,
});

const refusalMessages: string[] = [];
const refusalCodes: string[] = []; // every code any refusal below produced — the vocabulary check derives from these
const refusalsFromHardening: string[] = [];
const refusalOf = (fn: () => unknown): { code: string; message: string } | null => {
  try { fn(); } catch (err) {
    if (err instanceof HandoffSimError || err instanceof WorkContextError) {
      refusalMessages.push(err.message);
      refusalCodes.push(err.code);
      return { code: err.code, message: err.message };
    }
    return null;
  }
  return null;
};

const notHeld = refusalOf(() => releaseHeldTask(heldCtx, "task-zz-9876", CTRL_ENTRY, fullLedger(trustedDecision)));
check("releasing a task this context does not hold → typed refusal `task_not_held`",
  notHeld?.code === "task_not_held");

const unresolved = refusalOf(() => releaseHeldTask(heldCtx, "task-0200", CTRL_ENTRY, { holds: { "task-0200": CTRL_ENTRY }, resolutions: {}, verifications: {}, currentDeviceDecision: trustedDecision }));
check("release with no resolution recorded → typed refusal `exception_unresolved`",
  unresolved?.code === "exception_unresolved");
check("...and a whitespace-only resolution ref is no resolution at all",
  refusalOf(() => releaseHeldTask(heldCtx, "task-0200", CTRL_ENTRY, { holds: { "task-0200": CTRL_ENTRY }, resolutions: { [CTRL_ENTRY]: "   " }, verifications: {}, currentDeviceDecision: trustedDecision }))?.code === "exception_unresolved");

const noEvidence = refusalOf(() => releaseHeldTask(heldCtx, "task-0200", CTRL_ENTRY, { holds: { "task-0200": CTRL_ENTRY }, resolutions: { [CTRL_ENTRY]: CTRL_RESOLUTION }, verifications: {}, currentDeviceDecision: trustedDecision }));
check("release with a resolution but no verification evidence → typed refusal `verification_missing`",
  noEvidence?.code === "verification_missing");

const selfCited = refusalOf(() => releaseHeldTask(heldCtx, "task-0200", CTRL_ENTRY, { holds: { "task-0200": CTRL_ENTRY }, resolutions: { [CTRL_ENTRY]: CTRL_RESOLUTION }, verifications: { [CTRL_ENTRY]: CTRL_RESOLUTION }, currentDeviceDecision: trustedDecision }));
check("release where the evidence IS the resolution → typed refusal `verification_not_independent` — the fix cannot cite itself as its own proof",
  selfCited?.code === "verification_not_independent");

check("release on a device whose own composition is restrict-grade → typed refusal `device_not_trusted_for_release`",
  refusalOf(() => releaseHeldTask(heldCtx, "task-0200", CTRL_ENTRY, fullLedger(restrictedDecision)))?.code === "device_not_trusted_for_release");
check("...and with NO device decision at all — an unevaluated device is never trusted for release",
  refusalOf(() => releaseHeldTask(heldCtx, "task-0200", CTRL_ENTRY, fullLedger(null)))?.code === "device_not_trusted_for_release");

const GHOST_ENTRY = "INVENTORY_EXCEPTION_ACTIVE:exc-ghost-0404";
const ghost = refusalOf(() => releaseHeldTask(heldCtx, "task-0200", GHOST_ENTRY, {
  holds: { "task-0200": GHOST_ENTRY },
  resolutions: { [GHOST_ENTRY]: CTRL_RESOLUTION },
  verifications: { [GHOST_ENTRY]: CTRL_EVIDENCE },
  currentDeviceDecision: trustedDecision,
}));
check("release naming an entry this context never carried goes through the REAL resolveException door and refuses `unknown_exception_ref`",
  ghost?.code === "unknown_exception_ref");

// ── the seventh review's findings, each now a refusal with a fixture ─────────
// 3a CROSS-EXCEPTION RELEASE: the named exception must be the one holding the
// named task. Before the linkage existed, this exact ledger released task-0200
// against an exception that held a DIFFERENT task.
check("release naming an exception that does not hold the named task → typed refusal `exception_does_not_hold_task`",
  refusalOf(() => releaseHeldTask(heldCtx, "task-0200", CTRL_ENTRY, {
    holds: { "task-0200": "INVENTORY_EXCEPTION_ACTIVE:exc-other-1111" },
    resolutions: { [CTRL_ENTRY]: CTRL_RESOLUTION },
    verifications: { [CTRL_ENTRY]: CTRL_EVIDENCE },
    currentDeviceDecision: trustedDecision,
  }))?.code === "exception_does_not_hold_task");
// 3b EVIDENCE REPLAY: one record proves one fix. The same evidence ref recorded
// as ANOTHER exception's verification refuses this release.
check("release whose evidence ref is already another exception's verification → typed refusal `verification_evidence_reused`",
  refusalOf(() => releaseHeldTask(heldCtx, "task-0200", CTRL_ENTRY, {
    holds: { "task-0200": CTRL_ENTRY },
    resolutions: { [CTRL_ENTRY]: CTRL_RESOLUTION },
    verifications: { [CTRL_ENTRY]: CTRL_EVIDENCE, "INVENTORY_EXCEPTION_ACTIVE:exc-neighbor-2222": CTRL_EVIDENCE },
    currentDeviceDecision: trustedDecision,
  }))?.code === "verification_evidence_reused");
// 3c WHITESPACE INDEPENDENCE: evidence = resolution + trailing space is the fix
// citing itself as its own proof modulo whitespace. Trimmed equality refuses it.
check("release whose evidence is the resolution plus trailing whitespace → typed refusal `verification_not_independent`",
  refusalOf(() => releaseHeldTask(heldCtx, "task-0200", CTRL_ENTRY, {
    holds: { "task-0200": CTRL_ENTRY },
    resolutions: { [CTRL_ENTRY]: CTRL_RESOLUTION },
    verifications: { [CTRL_ENTRY]: CTRL_RESOLUTION + " " },
    currentDeviceDecision: trustedDecision,
  }))?.code === "verification_not_independent");
// ORDER PIN: a task that is NOT held, whose ledger is simultaneously unresolved
// AND on an untrusted device, must still refuse `task_not_held` — review moved
// the guard to last and the suite stayed green, the unasserted-order drift bait.
check("a not-held task with an otherwise-failing ledger still refuses `task_not_held` FIRST — the refusal order is pinned",
  refusalOf(() => releaseHeldTask(heldCtx, "task-zz-9876", CTRL_ENTRY, {
    holds: {},
    resolutions: {},
    verifications: {},
    currentDeviceDecision: restrictedDecision,
  }))?.code === "task_not_held");

const released = releaseHeldTask(heldCtx, "task-0200", CTRL_ENTRY, fullLedger(trustedDecision));
check("the successful release: task moves held→active, the entry is removed via the real door, contextVersion advances by exactly one",
  released.work.activeTaskRefs.includes("task-0200") && released.work.heldTaskRefs.length === 0 &&
  !released.work.unresolvedExceptionRefs.includes(CTRL_ENTRY) &&
  released.provenance.contextVersion === heldCtx.provenance.contextVersion + 1 && Object.isFrozen(released));
check("the successful release carries everything else: subject, workflow, restrictions and ceiling are untouched",
  JSON.stringify(released.subject) === JSON.stringify(heldCtx.subject) &&
  released.work.workflowKey === heldCtx.work.workflowKey &&
  JSON.stringify(released.trust.activeRestrictions) === JSON.stringify(heldCtx.trust.activeRestrictions) &&
  released.trust.requiredStepUpLevel === heldCtx.trust.requiredStepUpLevel);

const orphan = runHandoffScript({ scriptRef: "script-ctrl-orphan", steps: [{ kind: "handoff", deviceRef: "handheld-X", deviceSignals: healthyHandheld }] });
check("a script step before any assemble → refused trace entry `step_before_assemble`, not a crash; finalContext stays null",
  orphan.finalContext === null && orphan.trace.entries[0].status === "refused" && orphan.trace.entries[0].refusalCode === "step_before_assemble");

// The no-echo discipline, asserted on the messages themselves: no refusal above
// repeated any caller-supplied ref.
const callerRefs = ["task-zz-9876", "task-0200", CTRL_ENTRY, "exc-ctrl-4410", GHOST_ENTRY, "exc-ghost-0404", CTRL_RESOLUTION, CTRL_EVIDENCE];
check(`no refusal message echoes a caller-supplied ref (${refusalMessages.length} messages swept against ${callerRefs.length} refs)`,
  refusalMessages.length >= 8 && refusalMessages.every((m) => callerRefs.every((r) => !m.includes(r))));

// A device that contributed ZERO signals (2026-09-05). It composes `none` — nothing is
// KNOWN to be wrong — and used to be trusted for release exactly like a device that
// reported clean across the board. It is the unevaluated device wearing a decision
// object, and release now judges the drivers, not the bare action.
const darkDecision = reevaluateForDevice(heldCtx, []).decision;
const dark = refusalOf(() => releaseHeldTask(heldCtx, "task-0200", CTRL_ENTRY, fullLedger(darkDecision)));
check("release on a device that contributed ZERO signals → `device_not_trusted_for_release` (its decision carries no drivers)",
  darkDecision.drivers.length === 0 && dark?.code === "device_not_trusted_for_release");
refusalsFromHardening.push(dark?.code ?? "MISSING");
// And an action OFF the ladder: the composer ranks it above every rung and tiers it
// `blocked`; a raw `ACTION_RANK[x]` read `undefined >= 6 → false` and RELEASED.
const offDecision = { ...trustedDecision, deviceAction: "quarantine" as never, riskTier: "blocked" as const, drivers: [{ kind: "threat" as never, posture: "p", action: "quarantine" as never, reason: "EDR_Q", rank: 8 }] };
const off = refusalOf(() => releaseHeldTask(heldCtx, "task-0200", CTRL_ENTRY, fullLedger(offDecision)));
check("release on a device whose own action is OFF the ladder → refused through the guarded rank, never `undefined >= 6 → false`",
  off?.code === "device_not_trusted_for_release");
// A step kind the simulator does not know is a REFUSED entry, never "applied".
const weird = runHandoffScript({ scriptRef: "script-ctrl-weird", steps: [{ kind: "assemble", inputs: pickerInputs() }, { kind: "teleport" } as never] });
check("an unknown step kind → refused trace entry `unknown_step_kind`, never an applied step that did nothing",
  weird.trace.entries[1]?.status === "refused" && weird.trace.entries[1]?.refusalCode === "unknown_step_kind");
refusalsFromHardening.push(weird.trace.entries[1]?.refusalCode ?? "MISSING");
// The handoff device ref lands verbatim in the deep-frozen trace, so it is swept.
const jwtish = runHandoffScript({ scriptRef: "script-ctrl-jwt", steps: [{ kind: "assemble", inputs: pickerInputs() }, { kind: "handoff", deviceRef: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.abcdefghijklmnopqrstuvwxyz012345", deviceSignals: healthyHandheld }] });
check("a handoff whose deviceRef smells like a token is refused, and the ref never reaches the trace",
  jwtish.trace.entries[1]?.status === "refused" && !JSON.stringify(jwtish.trace).includes("eyJhbGciOiJIUzI1NiJ9"));

// The refusal vocabulary, counted for the figures line: every reason exercised.
const refusalsExercised = new Set<string>([
  ...w.filter((e) => e.refusalCode !== null).map((e) => e.refusalCode as string),
  ...[notHeld, unresolved, noEvidence, selfCited, ghost].map((r) => r?.code ?? "MISSING"),
  ...(orphan.trace.entries[0].refusalCode ? [orphan.trace.entries[0].refusalCode] : []),
  ...refusalCodes,
  ...refusalsFromHardening,
]);
// Derived from the package's own exported code list, never restated: the previous
// hand-copy claimed "every" while two codes it asserted elsewhere were missing from
// the list, and its `size === 7` pin actively resisted the correction. A literal
// pushed into the set is not evidence either; every entry above came from a refusal.
check(`every refusal reason in the vocabulary was exercised — all ${HANDOFF_SIM_ERROR_CODES.length} HANDOFF_SIM_ERROR_CODES plus the work-context door's unknown_exception_ref (missing: ${HANDOFF_SIM_ERROR_CODES.filter((c) => !refusalsExercised.has(c)).join(",") || "none"})`,
  HANDOFF_SIM_ERROR_CODES.every((c) => refusalsExercised.has(c)) && refusalsExercised.has("unknown_exception_ref") && !refusalsExercised.has("MISSING"));

// ── summary ───────────────────────────────────────────────────────────────────

const steps = warehouse.trace.entries.length + healthcare.trace.entries.length;
console.log(`figures=scenarios=2,steps=${steps},refusals=${refusalsExercised.size},versionRegressions=${versionRegressions},taskLosses=${taskLosses},setDrifts=${setDrifts},exceptionDrops=${exceptionDrops}`);
const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
