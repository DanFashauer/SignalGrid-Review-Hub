// Task-exception proof — fully OFFLINE and deterministic.
//
// Drives the read-only task-exception connector against captured execution-system
// reports and runs the pure evaluator per device. The fabric already asks WHO holds
// the device (`rtls-custody`, `sso-session`, `pacs-access`), whether the device is
// governed (`device-management-health`) and whether its link works (`link-usability`).
// It has never asked the question that decides whether the WORK flowing through that
// session can be believed: did the execution system raise an exception about the task
// — a wrong-item scan, a skipped verification, a short pick — and, above all, did the
// task's ASSIGNED worker/device match the one that EXECUTED it? That last one is the
// identity-binding violation this fabric exists to catch, reported by the one witness
// that watches every confirm.
//
// The severity inversion below is the point and is asserted rather than assumed: a
// BYPASSED required verification (restrict) outranks a FAILED verification (alert). A
// verification that failed is a control doing its job; one that never ran is a control
// silently absent, and every confirmation downstream of it is a number standing in for
// a fact it does not cover.
//
// It also proves the fabric fuses this dimension (fromTaskException → a task_exception
// ComposableSignal on the unified ladder, worst-concern-wins) and that the incident
// playbook routes each exception CLASS to its owner: integrity-class → Security
// Operations, inventory-/flow-class → the operations owner, everything unreadable →
// the same security-compliance owner as the sibling dimensions.
//
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as taskException from "@workspace/integrations/task-exception";
import { checkDefaultTransport, checkLiveGateIsolated } from "./lib/live-gate.js";
import { SIGNAL_KINDS, composeDeviceRisk, fromTaskException } from "@workspace/posture-composition";
import { mapPostureToIncident } from "@workspace/incident-playbook";
import { enumerateGrantSafety, productOf } from "./lib/grant-safety.js";

const {
  TASK_EXCEPTION_REPORT_KEYS,
  TaskExceptionConnector,
  TaskExceptionConnectorError,
  createMockTaskExceptionTransport,
  evaluateTaskException,
  guardReadOnly,
  normalizeReport,
  resolveTaskExceptionConnector,
} = taskException;
type TaskExceptionReportRaw = taskException.TaskExceptionReportRaw;
type NormalizedTaskException = taskException.NormalizedTaskException;
type TaskExceptionVerdict = taskException.TaskExceptionVerdict;

interface Expected {
  posture: string;
  reasonCode: string;
  recommendedAction: string;
  criticalFindingsCount: number;
  unknownSignalsCount: number;
  taskStreamHealthy: boolean;
}
interface Fixture {
  accessToken: string;
  devices: Record<string, { deviceId: string; report: TaskExceptionReportRaw; expected: Expected }>;
}

const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/task-exception/devices.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
const BASE_URL = "https://wms-bridge.local/task-exception";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Task-exception proof");
const names = Object.keys(fixture.devices);
console.log(`devices=${names.length}`);

const reports: Record<string, TaskExceptionReportRaw> = {};
for (const n of names) reports[fixture.devices[n].deviceId] = fixture.devices[n].report;
const transport = createMockTaskExceptionTransport({ reports, expectedToken: fixture.accessToken });
const connector = new TaskExceptionConnector({ accessToken: fixture.accessToken, baseUrl: BASE_URL }, transport);

for (const name of names) {
  const spec = fixture.devices[name];
  const normalized = await connector.fetchTaskException(spec.deviceId);
  check(`${name}: normalized carries sourceSystem`, normalized.sourceSystem === "task-exception");
  const v = evaluateTaskException(normalized);
  const ok =
    v.posture === spec.expected.posture &&
    v.reasonCode === spec.expected.reasonCode &&
    v.recommendedAction === spec.expected.recommendedAction &&
    v.criticalFindings.length === spec.expected.criticalFindingsCount &&
    v.unknownSignals.length === spec.expected.unknownSignalsCount &&
    v.taskStreamHealthy === spec.expected.taskStreamHealthy &&
    v.deviceId === spec.deviceId;
  check(`evaluate ${name} → ${spec.expected.posture}/${spec.expected.recommendedAction}`, ok);
}

// ── task-exception invariants ─────────────────────────────────────────────────

const healthy = evaluateTaskException(await connector.fetchTaskException(fixture.devices["task-stream-healthy"].deviceId));
check("a stream confirmed on all five counts → task_stream_healthy/none", healthy.posture === "task_stream_healthy" && healthy.recommendedAction === "none" && healthy.taskStreamHealthy === true);
check("a healthy task stream composes to the 'ok' tier", composeDeviceRisk([fromTaskException(healthy)]).riskTier === "ok");

// ── the FIVE granting shapes, asserted individually ───────────────────────────
//
// The grant is `exceptionKind none` + `exceptionState not_applicable` + reachable
// confirmed + a clean report, times each AFFIRMATIVE task state — and nothing else.
// Every shape below is individually coherent, and the enumeration further down pins
// the count at exactly five so a sixth route in becomes a failure, not a widening.
const grantShape = (taskState: string): TaskExceptionVerdict =>
  evaluateTaskException(normalizeReport("gs", {
    exceptionKind: "none", exceptionState: "not_applicable", taskState,
    taskSystemReachable: true, sourceExceptionCode: null,
  }));
// Shape 1 — `ready`: a task queued with nothing raised; the between-tasks handheld.
check("grant shape 1/5: a READY task with no exception grants", grantShape("ready").recommendedAction === "none");
// Shape 2 — `held`: deliberately held. An Oracle-style HELD is an operator action on
// the task, not an exception about the work; the exception channel is separate.
check("grant shape 2/5: a HELD task with no exception grants — a hold is not an exception", grantShape("held").recommendedAction === "none");
// Shape 3 — `in_process`: mid-execution with no confirm having failed so far.
check("grant shape 3/5: an IN-PROCESS task with no exception grants", grantShape("in_process").recommendedAction === "none");
// Shape 4 — `completed`: finished clean.
check("grant shape 4/5: a COMPLETED task with no exception grants", grantShape("completed").recommendedAction === "none");
// Shape 5 — `cancelled`: an orderly, authorized lifecycle outcome. Penalising every
// legitimate supervisor cancel would make the healthy baseline unreachable on a real
// floor; a cancel that WAS suspicious arrives as an exception, not as this state.
check("grant shape 5/5: a CANCELLED task with no exception grants — a cancel is an outcome, not an exception", grantShape("cancelled").recommendedAction === "none");

// ── the case this dimension exists for ────────────────────────────────────────
const mismatch = evaluateTaskException(await connector.fetchTaskException(fixture.devices["assignment-mismatch"].deviceId));
check("an ASSIGNMENT MISMATCH (executor ≠ assigned) → restrict + a critical finding (a fact, not a gap)", mismatch.recommendedAction === "restrict" && mismatch.posture === "task_integrity_violation" && mismatch.criticalFindings.includes("task_assignment_mismatch"));
check("...and it composes to the 'blocked' tier, never 'ok'", composeDeviceRisk([fromTaskException(mismatch)]).riskTier === "blocked");
// A HELD task is assigned, so a wrong-executor detection at claim time is a real
// mismatch — deliberately OUTSIDE the phase contradiction that governs confirm-time
// exceptions.
const heldMismatch = evaluateTaskException(await connector.fetchTaskException(fixture.devices["assignment-mismatch-on-held-task"].deviceId));
check("an assignment mismatch on a HELD task still restricts — claim-time detection is not a phase error", heldMismatch.reasonCode === "TASK_ASSIGNMENT_MISMATCH" && heldMismatch.recommendedAction === "restrict");
const bypass = evaluateTaskException(await connector.fetchTaskException(fixture.devices["procedure-bypassed"].deviceId));
const verifyFailed = evaluateTaskException(await connector.fetchTaskException(fixture.devices["verification-failed"].deviceId));
check("a BYPASSED required verification (no-scan workaround) → restrict + a critical finding", bypass.recommendedAction === "restrict" && bypass.criticalFindings.includes("procedure_bypassed"));
check("a FAILED verification (wrong-item scan; BCMA wrong-med analog) → alert + a critical finding", verifyFailed.recommendedAction === "alert" && verifyFailed.criticalFindings.includes("verification_failed"));
// The inversion, asserted. A failed verification is a control DOING ITS JOB; a skipped
// one is a control silently absent, and nothing downstream of it can be believed.
check("SEVERITY INVERSION: the verification that never RAN outranks the one that FAILED", bypass.recommendedAction === "restrict" && verifyFailed.recommendedAction === "alert");
const shortPick = evaluateTaskException(await connector.fetchTaskException(fixture.devices["inventory-exception-short-pick"].deviceId));
check("an open INVENTORY exception (short pick / SAP DIFF class) → alert + 'inventory_exception_active'", shortPick.recommendedAction === "alert" && shortPick.posture === "inventory_exception" && shortPick.criticalFindings.includes("inventory_exception_active"));
check("...and it never composes to 'ok'", composeDeviceRisk([fromTaskException(shortPick)]).riskTier !== "ok");
const preExecInventory = evaluateTaskException(await connector.fetchTaskException(fixture.devices["inventory-exception-before-execution"].deviceId));
check("an inventory exception on a READY task alerts — a damaged-bin flag can precede execution", preExecInventory.reasonCode === "INVENTORY_EXCEPTION_ACTIVE" && preExecInventory.recommendedAction === "alert");
const txnError = evaluateTaskException(await connector.fetchTaskException(fixture.devices["transaction-error"].deviceId));
check("a failed RF/device TRANSACTION → step_up — a broken delivery channel, not a known defect", txnError.reasonCode === "TASK_TRANSACTION_ERROR" && txnError.recommendedAction === "step_up" && txnError.criticalFindings.length === 0);
// Stall is the one kind on the list that is a bridge INFERENCE rather than a report —
// verified: no execution system exposes "stalled" as a first-class task state — which
// is why it is the one kind graded monitor.
const stalled = evaluateTaskException(await connector.fetchTaskException(fixture.devices["task-flow-stalled"].deviceId));
check("a bridge-DERIVED stall → monitor, watched not acted on, and never a grant", stalled.reasonCode === "TASK_FLOW_STALLED" && stalled.recommendedAction === "monitor" && stalled.taskStreamHealthy === false);

// ── a ticket is not a fix ─────────────────────────────────────────────────────
const acknowledged = evaluateTaskException(await connector.fetchTaskException(fixture.devices["acknowledged-is-not-a-fix"].deviceId));
check("ACKNOWLEDGED does not reduce severity — a ticket is not a fix", acknowledged.recommendedAction === "alert" && acknowledged.reasonCode === "VERIFICATION_FAILED");
// The Oracle short-pick chain: the discrepancy spawns a cycle-count task. A CREATED
// count task is not a PERFORMED count — the discrepancy is exactly as real as it was
// the moment the pick came up short.
const resolutionCreated = evaluateTaskException(await connector.fetchTaskException(fixture.devices["resolution-task-created-is-not-a-fix"].deviceId));
check("RESOLUTION_TASK_CREATED does not reduce severity — a created count task is not a performed count", resolutionCreated.recommendedAction === "alert" && resolutionCreated.reasonCode === "INVENTORY_EXCEPTION_ACTIVE");

// ── resolved closes the exception, and closure is not a grant ─────────────────
//
// Without this branch, a resolved short pick would raise NO candidate and sail to
// `none` — the grant count would silently include kinds other than `none`. The
// enumeration below would catch that as a mismatch; this asserts the intended verdict.
const resolved = evaluateTaskException(await connector.fetchTaskException(fixture.devices["exception-resolved"].deviceId));
check("a RESOLVED exception → exception_resolved/monitor, with the finding NOT carried", resolved.posture === "exception_resolved" && resolved.recommendedAction === "monitor" && resolved.criticalFindings.length === 0);
check("...and a recently-resolved exception never grants", resolved.taskStreamHealthy === false);
check("...and it opens NO incident — watched, not ticketed", mapPostureToIncident(composeDeviceRisk([fromTaskException(resolved)]), { correlationId: "res" }) === null);
// Same healthy-tier-without-certification treatment agent-identity gives a confirmed
// human: monitor composes to the healthy tier without granting this dimension's claim.
check("...and it composes to the healthy tier WITHOUT granting", composeDeviceRisk([fromTaskException(resolved)]).riskTier === "ok" && resolved.taskStreamHealthy === false);
const resolvedMismatch = evaluateTaskException(await connector.fetchTaskException(fixture.devices["mismatch-resolved-still-watched"].deviceId));
check("even a resolved ASSIGNMENT MISMATCH is watched, not restricted — the lifecycle is closed", resolvedMismatch.reasonCode === "TASK_EXCEPTION_RESOLVED" && resolvedMismatch.recommendedAction === "monitor");

// ── unknowns deny, and reachability is asserted vs unreported ─────────────────
const kindGap = evaluateTaskException(await connector.fetchTaskException(fixture.devices["kind-unreported"].deviceId));
check("an UNREPORTED exception kind is a gap that denies, named in unknownSignals", kindGap.reasonCode === "TASK_STATE_UNKNOWN" && kindGap.unknownSignals.includes("exception_kind"));
const stateGap = evaluateTaskException(await connector.fetchTaskException(fixture.devices["state-unreported"].deviceId));
check("an UNREPORTED exception state is a gap that denies, named in unknownSignals", stateGap.reasonCode === "TASK_STATE_UNKNOWN" && stateGap.unknownSignals.includes("exception_state"));
const taskGap = evaluateTaskException(await connector.fetchTaskException(fixture.devices["task-state-unreported"].deviceId));
check("an UNREPORTED task state is a gap that denies, named in unknownSignals", taskGap.reasonCode === "TASK_STATE_UNKNOWN" && taskGap.unknownSignals.includes("task_state"));
// A named diagnosis must not be buried under a gap from another field — the ordering
// mistake device-management-health measured (9 headlines out of 172,872 asserted
// negatives) and this dimension inherits pre-fixed.
const mismatchWithGap = evaluateTaskException(await connector.fetchTaskException(fixture.devices["mismatch-with-state-unreported"].deviceId));
check("a mismatch with the exception STATE unreported still headlines the mismatch, and reports the gap", mismatchWithGap.reasonCode === "TASK_ASSIGNMENT_MISMATCH" && mismatchWithGap.unknownSignals.includes("exception_state"));
const txnWithGap = evaluateTaskException(normalizeReport("tg", { exceptionKind: "transaction_error", taskState: "in_process", taskSystemReachable: true, sourceExceptionCode: null }));
check("a named step_up (TASK_TRANSACTION_ERROR) wins the tie over a generic unknown from another field", txnWithGap.reasonCode === "TASK_TRANSACTION_ERROR" && txnWithGap.unknownSignals.includes("exception_state"));
const sysDown = evaluateTaskException(await connector.fetchTaskException(fixture.devices["task-system-unreachable"].deviceId));
check("an explicit taskSystemReachable:false → step_up, never granted, and NOT a critical finding", sysDown.reasonCode === "TASK_SYSTEM_UNREACHABLE" && sysDown.taskStreamHealthy === false && sysDown.criticalFindings.length === 0);
const sysNull = evaluateTaskException(await connector.fetchTaskException(fixture.devices["task-system-unreported"].deviceId));
check("an UNREPORTED reachability is a gap and also denies", sysNull.reasonCode === "TASK_SYSTEM_UNREACHABLE" && sysNull.unknownSignals.includes("task_system_reachable"));
const assertedNegative = evaluateTaskException(await connector.fetchTaskException(fixture.devices["unreachable-outranks-an-unknown-field"].deviceId));
check("an ASSERTED 'the system did not answer' outranks a generic unknown from another field", assertedNegative.reasonCode === "TASK_SYSTEM_UNREACHABLE" && assertedNegative.unknownSignals.includes("task_state"));

// ── self-contradictory reports: four relations, each with fixtures that die with it ──
//
// Every relation below has at least one fixture that FAILS if the relation is deleted
// — C1's fixtures would otherwise GRANT, C2's would restrict/alert off a disbelieved
// claim, C3's and C4's would emit the named diagnosis instead of the contradiction.
// No unfalsifiable guards.
for (const [name, label] of [
  ["inconsistent-lifecycle-for-no-exception", "an ACTIVE lifecycle for no exception"],
  ["inconsistent-resolved-for-no-exception", "a RESOLVED lifecycle for an exception that never existed"],
] as const) {
  const v = evaluateTaskException(await connector.fetchTaskException(fixture.devices[name].deviceId));
  check(`C1: ${label} is self-contradictory → step_up, never a grant`, v.reasonCode === "TASK_REPORT_INCONSISTENT" && v.taskStreamHealthy === false && v.unknownSignals.includes("exception_lifecycle_consistency"));
}
// C2 is the not_applicable free-pass hazard: `not_applicable` is exactly the value a
// bridge hardcodes for "we don't model exception lifecycles", and beside a real
// exception it must never be a pass. This precise shape shipped broken in
// link-usability's first draft; here it is modelled from the start.
for (const [name, label] of [
  ["inconsistent-not-applicable-yet-mismatch", "an assignment mismatch"],
  ["inconsistent-not-applicable-yet-short-pick", "a short pick"],
] as const) {
  const v = evaluateTaskException(await connector.fetchTaskException(fixture.devices[name].deviceId));
  check(`C2: 'no exception lifecycle exists' beside ${label} is self-contradictory → step_up, never restrict/alert`, v.reasonCode === "TASK_REPORT_INCONSISTENT" && v.recommendedAction === "step_up" && v.unknownSignals.includes("exception_applicability_consistency"));
  check(`...and the disbelieved ${label} is NOT cited as a confirmed fact`, v.criticalFindings.length === 0);
}
// C3: execution-time exceptions are raised at CONFIRM time (verified SAP semantics) —
// a task still ready/held has had no confirm to fail.
for (const [name, label] of [
  ["inconsistent-verify-failed-before-execution", "a failed verification on a READY task"],
  ["inconsistent-bypass-on-held-task", "a bypassed verification on a HELD task"],
  ["inconsistent-transaction-error-before-execution", "a confirm-transaction error on a READY task"],
] as const) {
  const v = evaluateTaskException(await connector.fetchTaskException(fixture.devices[name].deviceId));
  check(`C3: ${label} is self-contradictory → step_up, never a grant`, v.reasonCode === "TASK_REPORT_INCONSISTENT" && v.taskStreamHealthy === false && v.unknownSignals.includes("task_phase_consistency"));
}
// C4: a finished task cannot be CURRENTLY stalled — the stall is a bridge inference,
// and one derived from a task the system reports completed/cancelled is a stale read.
for (const [name, label] of [
  ["inconsistent-finished-yet-stalled", "COMPLETED yet actively stalled"],
  ["inconsistent-cancelled-yet-stalled", "CANCELLED yet acknowledged-stalled"],
  // The state adversarial review found missing: a spawned follow-up ticket does not
  // close the stall, so a finished task carrying one is the SAME stale read.
  ["inconsistent-finished-stall-ticketed", "COMPLETED yet stalled-with-resolution-task"],
] as const) {
  const v = evaluateTaskException(await connector.fetchTaskException(fixture.devices[name].deviceId));
  check(`C4: ${label} is self-contradictory → step_up, never a grant`, v.reasonCode === "TASK_REPORT_INCONSISTENT" && v.taskStreamHealthy === false && v.unknownSignals.includes("stall_lifecycle_consistency"));
}

// ── the audit passthrough: carried verbatim, never judged ─────────────────────
const withCode = await connector.fetchTaskException(fixture.devices["vendor-code-carried-for-audit"].deviceId);
check("a vendor exception code (SAP 'BIDF') is carried for audit", withCode.sourceExceptionCode === "BIDF");
const verbatim = normalizeReport("vb", { exceptionKind: "inventory_exception", exceptionState: "active", taskState: "in_process", taskSystemReachable: true, sourceExceptionCode: " diff " });
check("the code is carried VERBATIM — no trim, no case fold — because canonicalizing an audit value falsifies the trail", verbatim.sourceExceptionCode === " diff " && verbatim.reportIntegrity === "clean");
// "Never judged" as a measured claim, not a promise: over the ENTIRE normalized space,
// swapping the code between null and a vendor string changes no verdict.
const NORM_DOMAINS = {
  exceptionKind: ["none", "verification_failed", "procedure_bypassed", "assignment_mismatch", "inventory_exception", "task_flow_stalled", "transaction_error", "unknown"],
  exceptionState: ["not_applicable", "active", "acknowledged", "resolution_task_created", "resolved", "unknown"],
  taskState: ["ready", "held", "in_process", "completed", "cancelled", "unknown"],
  taskSystemReachable: [true, false, null],
  reportIntegrity: ["clean", "malformed"],
};
const normKeys = Object.keys(NORM_DOMAINS);
let codeDisagreements = 0;
let codeStates = 0;
const walkCode = (i: number, acc: Record<string, unknown>): void => {
  if (i === normKeys.length) {
    codeStates += 1;
    const asNull = evaluateTaskException({ sourceSystem: "task-exception", deviceId: "c", source: "c", sourceExceptionCode: null, ...acc } as NormalizedTaskException);
    const asCode = evaluateTaskException({ sourceSystem: "task-exception", deviceId: "c", source: "c", sourceExceptionCode: "BIDF", ...acc } as NormalizedTaskException);
    if (JSON.stringify(asNull) !== JSON.stringify(asCode)) codeDisagreements += 1;
    return;
  }
  for (const val of NORM_DOMAINS[normKeys[i] as keyof typeof NORM_DOMAINS]) walkCode(i + 1, { ...acc, [normKeys[i]]: val });
};
walkCode(0, {});
check(`the passthrough is NEVER judged: across all ${codeStates} normalized states, a vendor code changes no verdict (disagreements=${codeDisagreements})`, codeDisagreements === 0 && codeStates === 1728);

// No task-exception result at all → a gap → step_up (never a healthy-stream grant).
const noCov = evaluateTaskException(normalizeReport("ghost", {}), { covered: false });
check("an uncovered device is 'unknown'/step_up, never a healthy stream", noCov.posture === "unknown" && noCov.reasonCode === "NOT_COVERED" && noCov.taskStreamHealthy === false);
check("an uncovered device composes to at_risk, NEVER the 'ok' tier", composeDeviceRisk([fromTaskException(noCov)]).riskTier !== "ok");

// ── report integrity + hostile shapes ─────────────────────────────────────────
//
// Every shape below is built from CLEAN_WIRE — a report that DOES grant when passed
// through untouched — so each check isolates exactly the hostile property it names. If
// the base stopped granting they would pass vacuously, so it is asserted first.
const CLEAN_WIRE = {
  exceptionKind: "none", exceptionState: "not_applicable", taskState: "in_process",
  taskSystemReachable: true, sourceExceptionCode: null,
} as const;
check("the base wire report used by the hostile-shape checks below DOES grant (they are not vacuous)", evaluateTaskException(normalizeReport("cw", { ...CLEAN_WIRE })).recommendedAction === "none");
const malformedEnum = await connector.fetchTaskException(fixture.devices["report-malformed-enum"].deviceId);
check("an unparseable enum value marks the report malformed", malformedEnum.reportIntegrity === "malformed" && malformedEnum.exceptionKind === "unknown");
const malformedBool = await connector.fetchTaskException(fixture.devices["report-malformed-boolean"].deviceId);
check("a string-quoted boolean is an assertion, not silence", malformedBool.reportIntegrity === "malformed" && malformedBool.taskSystemReachable === null);
const malformedCode = await connector.fetchTaskException(fixture.devices["report-malformed-code"].deviceId);
check("a NON-STRING vendor code is present-but-unreadable → malformed, and the code is not invented", malformedCode.reportIntegrity === "malformed" && malformedCode.sourceExceptionCode === null);
const aliased = await connector.fetchTaskException(fixture.devices["report-aliased-keys"].deviceId);
check("an unrecognized key means the envelope was not understood", aliased.reportIntegrity === "malformed");
check("...and a malformed report never grants, even when every parsed field looks clean", evaluateTaskException(aliased).recommendedAction === "step_up" && evaluateTaskException(aliased).taskStreamHealthy === false);
const inherited = normalizeReport("inh", Object.create({ ...CLEAN_WIRE }) as TaskExceptionReportRaw);
check("a report with ZERO own keys asserts nothing — every field falls to unknown", inherited.exceptionKind === "unknown" && inherited.exceptionState === "unknown" && inherited.taskSystemReachable === null && inherited.sourceExceptionCode === null);
check("...and therefore cannot grant", evaluateTaskException(inherited).recommendedAction !== "none");
const aliasOnProto = Object.assign(Object.create({ exception_kind: "assignment_mismatch" }), CLEAN_WIRE) as TaskExceptionReportRaw;
check("an unrecognized key INHERITED from the prototype is still an unrecognized envelope", normalizeReport("ap", aliasOnProto).reportIntegrity === "malformed");
const { taskState: _hoisted, ...restOfClean } = CLEAN_WIRE;
const knownOnProto = Object.assign(Object.create({ taskState: "in_process" }), restOfClean) as TaskExceptionReportRaw;
check("a RECOGNIZED key inherited from the prototype is an unrecognized envelope too", normalizeReport("kp", knownOnProto).reportIntegrity === "malformed");
check("...and cannot grant", evaluateTaskException(normalizeReport("kp", knownOnProto)).recommendedAction !== "none");
const symbolKeyed = Object.assign({}, CLEAN_WIRE) as TaskExceptionReportRaw;
(symbolKeyed as Record<symbol, unknown>)[Symbol.for("exceptionKind")] = "assignment_mismatch";
check("a SYMBOL-keyed assertion is an unrecognized envelope", normalizeReport("sym", symbolKeyed).reportIntegrity === "malformed");
const throwingKeys = new Proxy({ ...CLEAN_WIRE }, { ownKeys: () => { throw new Error("hostile"); } }) as TaskExceptionReportRaw;
check("a Proxy that THROWS from ownKeys fails closed, it does not grant", evaluateTaskException(normalizeReport("tk", throwingKeys)).recommendedAction !== "none");
const endlessProto = (): object => new Proxy({}, { getPrototypeOf: () => endlessProto(), ownKeys: () => [] });
check("a Proxy with an endless prototype chain terminates and fails closed", normalizeReport("ep", endlessProto() as TaskExceptionReportRaw).reportIntegrity === "malformed");
check("a null report body is malformed, not an untyped TypeError", normalizeReport("nb", null as unknown as TaskExceptionReportRaw).reportIntegrity === "malformed");
check("an ARRAY report is malformed, never a grant", normalizeReport("arr", [] as unknown as TaskExceptionReportRaw).reportIntegrity === "malformed");
const notAnObject = normalizeReport("s", "ERR: wms timeout" as unknown as TaskExceptionReportRaw);
check("a non-object report is malformed, not a thrown TypeError", notAnObject.reportIntegrity === "malformed" && evaluateTaskException(notAnObject).recommendedAction !== "none");
const hidden = new Proxy({ ...CLEAN_WIRE, exception_kind: "assignment_mismatch" }, { ownKeys: () => [], getOwnPropertyDescriptor: () => undefined }) as TaskExceptionReportRaw;
check("a Proxy that hides BOTH its keys and its descriptors reads as ABSENT and cannot grant", evaluateTaskException(normalizeReport("px", hidden)).recommendedAction !== "none");
// The honest limit, asserted rather than only described: a Proxy that hides a key from
// ownKeys while still answering getOwnPropertyDescriptor keeps its values readable, so
// the scan sees nothing and it grants. A Proxy can always lie about its own shape.
const hidesKeysOnly = new Proxy({ ...CLEAN_WIRE, exception_kind: "assignment_mismatch" }, { ownKeys: () => [...TASK_EXCEPTION_REPORT_KEYS] }) as TaskExceptionReportRaw;
check("KNOWN LIMIT: a Proxy that hides only its KEYS keeps its values and does grant", evaluateTaskException(normalizeReport("pk", hidesKeysOnly)).recommendedAction === "none");
// A report that IS Object.prototype was never scanned in a sibling's first draft,
// because the walk's stop condition conflated the chain terminus with the report.
const pollutionKeys = Object.keys(CLEAN_WIRE) as (keyof typeof CLEAN_WIRE)[];
for (const k of pollutionKeys) (Object.prototype as Record<string, unknown>)[k] = CLEAN_WIRE[k];
const asPrototype = normalizeReport("op", Object.prototype as TaskExceptionReportRaw);
for (const k of pollutionKeys) delete (Object.prototype as Record<string, unknown>)[k];
check("a report that IS Object.prototype is malformed — the chain terminus is not the report", asPrototype.reportIntegrity === "malformed");
check("...and a polluted prototype passed as the report cannot grant", evaluateTaskException(asPrototype).recommendedAction !== "none");
// An own ACCESSOR that throws must land where every unreadable report lands.
const throwingAccessor = Object.defineProperty({ ...CLEAN_WIRE }, "taskState", {
  get() { throw new Error("hostile accessor"); }, enumerable: true, configurable: true,
}) as TaskExceptionReportRaw;
let accessorThrew = false;
let accessorNormalized: NormalizedTaskException | null = null;
try { accessorNormalized = normalizeReport("ta", throwingAccessor); } catch { accessorThrew = true; }
check("an own accessor that THROWS does not escape the normalizer as an untyped Error", accessorThrew === false);
check("...it is malformed and cannot grant", accessorNormalized?.reportIntegrity === "malformed" && evaluateTaskException(accessorNormalized!).recommendedAction !== "none");
check("a plain parsed-JSON report is NOT flagged by the prototype walk", normalizeReport("j", JSON.parse('{"taskState":"in_process"}') as TaskExceptionReportRaw).reportIntegrity === "clean");
// JSON null is the wire spelling of "no value", not an unreadable assertion.
const nulls = normalizeReport("nl", { exceptionKind: null, exceptionState: null, taskState: null, taskSystemReachable: null, sourceExceptionCode: null } as TaskExceptionReportRaw);
check("JSON null on every field behaves as ABSENT, not as malformed", nulls.reportIntegrity === "clean" && nulls.exceptionKind === "unknown" && nulls.sourceExceptionCode === null);
check("...and still never grants, because nothing was positively confirmed", evaluateTaskException(nulls).recommendedAction === "step_up");
// Defence in depth: the evaluator refuses independently of the normalizer.
const forged = evaluateTaskException({
  sourceSystem: "task-exception", deviceId: "forged", source: "test",
  exceptionKind: "none", exceptionState: "not_applicable", taskState: "in_process",
  taskSystemReachable: true, sourceExceptionCode: null, reportIntegrity: "malformed",
});
check("the EVALUATOR independently refuses a malformed report, even a fully clean-looking one", forged.recommendedAction === "step_up" && forged.taskStreamHealthy === false);
// Case and whitespace are canonicalized on the ENUMS (and only on the enums — the
// audit passthrough above is verbatim), so a shouty bridge is understood, not rejected.
const shouty = normalizeReport("sh", { exceptionKind: " NONE ", exceptionState: "Not_Applicable", taskState: "IN_PROCESS" });
check("case/whitespace enum variants are canonicalized, not treated as malformed", shouty.reportIntegrity === "clean" && shouty.exceptionKind === "none" && shouty.exceptionState === "not_applicable");

// ── exhaustive, in THREE passes over two DIFFERENT spaces ─────────────────────
//
// The grant contract, stated once as an independent positive whitelist rather than as
// the negation of any guard in the implementation, so a guard that silently lost a
// condition still fails here.
const AFFIRMATIVE_TASK: readonly unknown[] = ["ready", "held", "in_process", "completed", "cancelled"];
const taskClean = (c: Record<string, unknown>): boolean =>
  c.exceptionKind === "none" &&
  c.exceptionState === "not_applicable" &&
  AFFIRMATIVE_TASK.includes(c.taskState) &&
  c.taskSystemReachable === true;

// The four contradiction relations, stated independently of the evaluator's guards.
const REAL_KINDS: readonly unknown[] = ["verification_failed", "procedure_bypassed", "assignment_mismatch", "inventory_exception", "task_flow_stalled", "transaction_error"];
const lifecycleRel = (kind: unknown, state: unknown): boolean =>
  kind === "none" && (state === "active" || state === "acknowledged" || state === "resolution_task_created" || state === "resolved");
const applicabilityRel = (kind: unknown, state: unknown): boolean =>
  REAL_KINDS.includes(kind) && state === "not_applicable";
const phaseRel = (kind: unknown, taskState: unknown): boolean =>
  (taskState === "ready" || taskState === "held") &&
  (kind === "verification_failed" || kind === "procedure_bypassed" || kind === "transaction_error");
const stallRel = (kind: unknown, state: unknown, taskState: unknown): boolean =>
  (taskState === "completed" || taskState === "cancelled") && kind === "task_flow_stalled" &&
  (state === "active" || state === "acknowledged" || state === "resolution_task_created");
const anyRel = (kind: unknown, state: unknown, taskState: unknown): boolean =>
  lifecycleRel(kind, state) || applicabilityRel(kind, state) || phaseRel(kind, taskState) || stallRel(kind, state, taskState);
/** Every reason code derived from the exception-kind half of the report — the set that
 *  must never headline while that half is disbelieved. */
const KIND_REASONS = new Set(["TASK_ASSIGNMENT_MISMATCH", "PROCEDURE_BYPASSED", "VERIFICATION_FAILED", "INVENTORY_EXCEPTION_ACTIVE", "TASK_TRANSACTION_ERROR", "TASK_FLOW_STALLED", "TASK_EXCEPTION_RESOLVED"]);

// Pass 1 — the NORMALIZED space (including reportIntegrity) against the evaluator
// alone. The judged value space is 8 kinds × 6 states × 6 task states × 3 reachability
// readings = 864; reportIntegrity doubles it to 1,728 enumerated states.
const enumRes = enumerateGrantSafety({
  domains: NORM_DOMAINS,
  build: (c) => ({ sourceSystem: "task-exception", deviceId: "enum", source: "enum", sourceExceptionCode: null, ...c }) as NormalizedTaskException,
  evaluate: evaluateTaskException,
  actionOf: (v) => v.recommendedAction,
  confirmedWhenNone: (v) =>
    v.taskStreamHealthy === true &&
    v.posture === "task_stream_healthy" &&
    v.criticalFindings.length === 0 &&
    v.unknownSignals.length === 0,
  positivelyClean: (c) => c.reportIntegrity === "clean" && taskClean(c),
});
check(
  `exhaustive (normalized): over all ${enumRes.combos} normalized states (8×6×6×3 = 864 value states × 2 integrity readings), action 'none' requires ALL FIVE positively confirmed and a clean report (mismatches=${enumRes.mismatches}${enumRes.firstMismatch ? ", first=" + enumRes.firstMismatch : ""})`,
  enumRes.mismatches === 0 && enumRes.combos === productOf(NORM_DOMAINS) && enumRes.combos === 1728,
);
check("exhaustive (normalized): some clean states DO grant (the enumeration is not vacuous)", enumRes.noneCount > 0);
// Pinning the count is what makes a sixth route into the grant a test failure rather
// than a silent widening — five, one per affirmative task state.
check("exhaustive (normalized): exactly FIVE shapes grant — kind 'none' × state 'not_applicable' × each affirmative task state × reachable × clean", enumRes.noneCount === 5);

// Grant-ness is not the only thing worth pinning. Four audits over the same space:
// the healthy flag tracks the action; the ladder's reachable subset is exact; the
// contradiction headline appears for EXACTLY the states some independent relation
// flags (on a clean report); and each relation's named gap appears for EXACTLY its own
// states. The last two make every clause of every relation falsifiable — a widened OR
// narrowed relation disagrees with its independent restatement somewhere in the space.
let healthyDisagreements = 0;
let headlineDisagreements = 0;
let relDisagreements = 0;
const reachableActions = new Set<string>();
const walkNorm = (i: number, acc: Record<string, unknown>): void => {
  if (i === normKeys.length) {
    const v = evaluateTaskException({ sourceSystem: "task-exception", deviceId: "n", source: "n", sourceExceptionCode: null, ...acc } as NormalizedTaskException);
    reachableActions.add(v.recommendedAction);
    if (v.taskStreamHealthy !== (v.recommendedAction === "none")) healthyDisagreements += 1;
    const expectInconsistent = anyRel(acc.exceptionKind, acc.exceptionState, acc.taskState) && acc.reportIntegrity === "clean";
    if ((v.reasonCode === "TASK_REPORT_INCONSISTENT") !== expectInconsistent) headlineDisagreements += 1;
    if (v.unknownSignals.includes("exception_lifecycle_consistency") !== lifecycleRel(acc.exceptionKind, acc.exceptionState)) relDisagreements += 1;
    if (v.unknownSignals.includes("exception_applicability_consistency") !== applicabilityRel(acc.exceptionKind, acc.exceptionState)) relDisagreements += 1;
    if (v.unknownSignals.includes("task_phase_consistency") !== phaseRel(acc.exceptionKind, acc.taskState)) relDisagreements += 1;
    if (v.unknownSignals.includes("stall_lifecycle_consistency") !== stallRel(acc.exceptionKind, acc.exceptionState, acc.taskState)) relDisagreements += 1;
    return;
  }
  for (const val of NORM_DOMAINS[normKeys[i] as keyof typeof NORM_DOMAINS]) walkNorm(i + 1, { ...acc, [normKeys[i]]: val });
};
walkNorm(0, {});
check(`exhaustive (normalized): taskStreamHealthy agrees with action === 'none' on every one of the ${enumRes.combos} states (disagreements=${healthyDisagreements})`, healthyDisagreements === 0);
check(`exhaustive (normalized): the contradiction HEADLINE appears for exactly the states an independent restatement of the four relations flags on a clean report (disagreements=${headlineDisagreements})`, headlineDisagreements === 0);
check(`exhaustive (normalized): each relation's named gap appears for exactly its own states — no relation can silently widen or narrow (disagreements=${relDisagreements})`, relDisagreements === 0);
check(`exhaustive (normalized): exactly none/monitor/step_up/alert/restrict are reachable — the wider ladder type is shared, escalate deliberately unused (reachable=${[...reachableActions].sort().join("/")})`, reachableActions.size === 5 && reachableActions.has("none") && reachableActions.has("monitor") && reachableActions.has("step_up") && reachableActions.has("alert") && reachableActions.has("restrict"));

// Pass 2 — the RAW WIRE space, carrying the MALFORMED values a real bridge emits.
// Built only from well-formed values, `normalizeReport` would be the identity function
// here and the pass would prove nothing about the parse layer. `__alias` is a
// build-time toggle, not a wire field: without it the unrecognized-key branch of the
// integrity check would be load-bearing and structurally unreachable by this
// enumeration. THROWING is likewise a build-time sentinel that installs a hostile own
// ACCESSOR on the field, so the wrapped-read branch is exercised by the enumeration
// itself and not only by the targeted check above.
//
// Every field carries the same wire CLASSES — allowed spellings, an omitted key, a
// JSON null, junk (string/number/array/object), and a throwing accessor — so no
// `PARSEABLE_RAW` entry below is ever unproduced.
const THROWING = { hostileAccessor: true } as const;
const rawDomains = {
  exceptionKind: ["none", "verification_failed", "procedure_bypassed", "assignment_mismatch", "inventory_exception", "task_flow_stalled", "transaction_error", "unknown", undefined, null, "TRUE", 1, THROWING],
  exceptionState: ["not_applicable", "active", "acknowledged", "resolution_task_created", "resolved", "unknown", undefined, null, ["active"], THROWING],
  taskState: ["ready", "held", "in_process", "completed", "cancelled", "unknown", undefined, null, {}, THROWING],
  taskSystemReachable: [true, false, undefined, null, "TRUE", 1, THROWING],
  sourceExceptionCode: ["BIDF", "ERR: wms timeout", undefined, null, 27, ["BIDF"], THROWING],
  __alias: ["absent", "present"],
};
const buildRaw = (c: Record<string, unknown>): NormalizedTaskException => {
  const { __alias, ...wire } = c;
  const raw = {} as TaskExceptionReportRaw;
  for (const [k, v] of Object.entries(wire)) {
    if (v === THROWING) {
      Object.defineProperty(raw, k, { get() { throw new Error("hostile accessor"); }, enumerable: true, configurable: true });
    } else {
      raw[k] = v;
    }
  }
  if (__alias === "present") raw.exception_kind = "assignment_mismatch";
  return normalizeReport("enum", raw, "enum");
};
// The harness calls `evaluate` once per combination, so wrapping it audits the ENTIRE
// raw space at zero extra cost — which is what the "cited a disbelieved claim"
// invariant needs, since grant-ness cannot see it (both readings deny).
let c1Count = 0;
let c2Count = 0;
let c3Count = 0;
let c4Count = 0;
let citedWhileContradictory = 0;
const evaluateAndAudit = (n: NormalizedTaskException): TaskExceptionVerdict => {
  const v = evaluateTaskException(n);
  const contradictory = anyRel(n.exceptionKind, n.exceptionState, n.taskState);
  if (lifecycleRel(n.exceptionKind, n.exceptionState)) c1Count += 1;
  if (applicabilityRel(n.exceptionKind, n.exceptionState)) c2Count += 1;
  if (phaseRel(n.exceptionKind, n.taskState)) c3Count += 1;
  if (stallRel(n.exceptionKind, n.exceptionState, n.taskState)) c4Count += 1;
  if (contradictory && (KIND_REASONS.has(v.reasonCode) || v.criticalFindings.length > 0)) {
    citedWhileContradictory += 1;
  }
  return v;
};
const rawEnumRes = enumerateGrantSafety({
  domains: rawDomains,
  build: buildRaw,
  evaluate: evaluateAndAudit,
  actionOf: (v) => v.recommendedAction,
  confirmedWhenNone: (v) =>
    v.taskStreamHealthy === true &&
    v.posture === "task_stream_healthy" &&
    v.criticalFindings.length === 0 &&
    v.unknownSignals.length === 0,
  positivelyClean: (c) =>
    c.__alias !== "present" &&
    taskClean(c) &&
    (c.sourceExceptionCode === undefined || c.sourceExceptionCode === null || typeof c.sourceExceptionCode === "string"),
});
check(
  `exhaustive (raw wire): over all ${rawEnumRes.combos} raw reports — junk enum spellings, JSON nulls, string-quoted booleans, numbers, arrays, objects, throwing accessors on every field and an aliased extra key — normalizeReport + evaluate grant ONLY the five-way confirmation (mismatches=${rawEnumRes.mismatches}${rawEnumRes.firstMismatch ? ", first=" + rawEnumRes.firstMismatch : ""})`,
  rawEnumRes.mismatches === 0 && rawEnumRes.combos === productOf(rawDomains) && rawEnumRes.combos === 127400,
);
check("exhaustive (raw wire): some raw reports DO grant (the enumeration is not vacuous)", rawEnumRes.noneCount > 0);
// Twenty, and the factor of four over the normalized five is itself the proof of a
// documented property: the audit passthrough is CARRIED, not judged, so each granting
// shape grants under every parseable code spelling this space carries (a vendor code
// string, an ERR-string, an omitted key, a JSON null). A grant reachable WITH a vendor
// code present is exactly what "never judged" means on the wire.
check("exhaustive (raw wire): exactly TWENTY raw reports grant — the five granting shapes × four parseable passthrough spellings", rawEnumRes.noneCount === 20);
check(
  `exhaustive (raw wire): across all ${c1Count + c2Count + c3Count + c4Count} relation hits (C1=${c1Count}, C2=${c2Count}, C3=${c3Count}, C4=${c4Count}), NOT ONE contradictory report cites the disbelieved half — no kind-derived reason code and no critical finding (violations=${citedWhileContradictory})`,
  citedWhileContradictory === 0 && c1Count > 0 && c2Count > 0 && c3Count > 0 && c4Count > 0,
);

// Pass 3 — PARSE FIDELITY, over the same raw space.
//
// Passes 1 and 2 only ever observe grant-ness, and every malformed value already
// normalizes to a denying `unknown`/null. That makes each individual integrity
// condition INVISIBLE to them: deleting one changes `reportIntegrity` but not the
// action, so the enumeration stays at 0 mismatches and the condition is load-bearing
// but unproven. This pass closes it by asserting the integrity flag against an
// independent allowlist. For the audit passthrough, "parseable" means ANY string —
// the two string representatives this space carries stand in for that class.
const PARSEABLE_RAW: Record<string, readonly unknown[]> = {
  exceptionKind: [undefined, null, "none", "verification_failed", "procedure_bypassed", "assignment_mismatch", "inventory_exception", "task_flow_stalled", "transaction_error", "unknown"],
  exceptionState: [undefined, null, "not_applicable", "active", "acknowledged", "resolution_task_created", "resolved", "unknown"],
  taskState: [undefined, null, "ready", "held", "in_process", "completed", "cancelled", "unknown"],
  taskSystemReachable: [undefined, null, true, false],
  sourceExceptionCode: [undefined, null, "BIDF", "ERR: wms timeout"],
};
const integrityRes = enumerateGrantSafety({
  domains: rawDomains,
  build: buildRaw,
  // The normalized report IS the verdict for this pass; "none" stands for "clean".
  evaluate: (n) => n,
  actionOf: (n) => (n.reportIntegrity === "clean" ? "none" : "malformed"),
  positivelyClean: (c) =>
    c.__alias !== "present" && Object.keys(PARSEABLE_RAW).every((k) => PARSEABLE_RAW[k].includes(c[k])),
});
check(
  `parse fidelity: over all ${integrityRes.combos} raw reports, reportIntegrity is 'clean' for EXACTLY the reports whose every field carries a parseable wire value and which carry no unrecognized key (mismatches=${integrityRes.mismatches}${integrityRes.firstMismatch ? ", first=" + integrityRes.firstMismatch : ""})`,
  integrityRes.mismatches === 0 && integrityRes.combos === productOf(rawDomains),
);
check("parse fidelity: both outcomes occur (the pass is not vacuous)", integrityRes.noneCount > 0 && integrityRes.noneCount < integrityRes.combos);

// Worst-concern-wins across several concerns at once.
const worst = evaluateTaskException(await connector.fetchTaskException(fixture.devices["worst-of-several"].deviceId));
check("worst-concern-wins: a confirmed assignment mismatch (restrict) outranks an unreachable execution system", worst.recommendedAction === "restrict" && worst.reasonCode === "TASK_ASSIGNMENT_MISMATCH");

// Determinism.
const d = await connector.fetchTaskException(fixture.devices["inventory-exception-short-pick"].deviceId);
check("evaluator is deterministic", JSON.stringify(evaluateTaskException(d)) === JSON.stringify(evaluateTaskException(d)));

// ── fabric fusion ─────────────────────────────────────────────────────────────

const signal = fromTaskException(mismatch);
check("fromTaskException emits a task_exception signal", signal.kind === "task_exception");
check("task_exception is a member of the runtime SIGNAL_KINDS array — the union is derived, so the playbook proof covers it automatically", (SIGNAL_KINDS as readonly string[]).includes("task_exception"));
check("fabric fuses an assignment mismatch into a restrict verdict", composeDeviceRisk([signal]).strongestAction === "restrict");
check("a healthy task stream contributes 'none' to the fabric", fromTaskException(healthy).action === "none");
// The point of the dimension, end to end: a device every other signal calls healthy is
// still not healthy if the execution system says the wrong person did the work on it.
check("a healthy stream fused with a mismatched one never composes to 'ok'", composeDeviceRisk([fromTaskException(healthy), fromTaskException(mismatch)]).riskTier !== "ok");

// ── incident routing: each exception CLASS reaches its owner ──────────────────
const incidentOf = (v: TaskExceptionVerdict): ReturnType<typeof mapPostureToIncident> =>
  mapPostureToIncident(composeDeviceRisk([fromTaskException(v)]), { correlationId: `r-${v.reasonCode}` });
// Integrity-class — a spoofed executor, a skipped control, a wrong-object scan — is a
// live security event about how work was executed → the security/operations owner.
check("integrity-class: an assignment mismatch routes to Security Operations (SecOps)", incidentOf(mismatch)?.assignmentGroup === "Security Operations (SecOps)" && incidentOf(mismatch)?.category === "security_incident");
check("integrity-class: a bypassed verification routes to Security Operations (SecOps)", incidentOf(bypass)?.assignmentGroup === "Security Operations (SecOps)");
check("integrity-class: a failed verification routes to Security Operations (SecOps)", incidentOf(verifyFailed)?.assignmentGroup === "Security Operations (SecOps)");
// Inventory-class — nobody's identity is in question, the stock is → the operations
// owner (the closed ITSM table's operations-facing group; see the routing note in
// incident-playbook's map.ts for why 'inventory' and 'flow' land on the same group).
check("inventory-class: a short pick routes to the operations owner (Endpoint / Mobility), never SecOps", incidentOf(shortPick)?.assignmentGroup === "Endpoint / Mobility" && incidentOf(shortPick)?.category === "asset_device");
// Flow-class — a failed confirm transaction is an operations problem too.
check("flow-class: a transaction error routes to the operations owner (Endpoint / Mobility)", incidentOf(txnError)?.assignmentGroup === "Endpoint / Mobility");
// Everything unreadable/contradictory/unreachable is a trust-fabric integrity question
// and routes exactly as the sibling dimensions do — never the generic Service Desk.
check("an unreadable report routes to Identity & Access, exactly as the sibling dimensions do", incidentOf(evaluateTaskException(aliased))?.assignmentGroup === "Identity & Access");
check("an unreachable execution system routes to Identity & Access", incidentOf(sysDown)?.assignmentGroup === "Identity & Access");
check("a contradictory report routes to Identity & Access", incidentOf(evaluateTaskException(await connector.fetchTaskException(fixture.devices["inconsistent-not-applicable-yet-mismatch"].deviceId)))?.assignmentGroup === "Identity & Access");
// The no-noise rule holds for this dimension's calm verdicts.
check("a bridge-derived stall opens NO incident — monitor is watch, not ticket noise", incidentOf(stalled) === null);
check("a healthy task stream opens NO incident", incidentOf(healthy) === null);
// Priority flows from the ITSM matrix unchanged: restrict → high urgency; default
// medium impact → P2.
check("an assignment mismatch at default impact lands P2 with the 1-hour response SLA", incidentOf(mismatch)?.priority === "P2" && incidentOf(mismatch)?.sla.responseMinutes === 60);

// ── connector guarantees ──────────────────────────────────────────────────────

let readOnly = false;
try { guardReadOnly("POST"); } catch (err) { readOnly = err instanceof TaskExceptionConnectorError && err.code === "read_only_violation"; }
check("a non-GET request is refused by the read-only guard", readOnly);

const bad = new TaskExceptionConnector({ accessToken: "nope", baseUrl: BASE_URL }, transport);
const badHealth = await bad.healthCheck(fixture.devices["task-stream-healthy"].deviceId);
check("health check reports unhealthy on a bad token", badHealth.healthy === false && badHealth.status === 401);
let authErr: InstanceType<typeof TaskExceptionConnectorError> | null = null;
try { await bad.fetchTaskException(fixture.devices["task-stream-healthy"].deviceId); } catch (err) { authErr = err instanceof TaskExceptionConnectorError ? err : null; }
check("a bad token surfaces a typed auth_failed error", authErr?.code === "auth_failed");

let missingErr: InstanceType<typeof TaskExceptionConnectorError> | null = null;
try { await connector.fetchTaskException("no-such-device"); } catch (err) { missingErr = err instanceof TaskExceptionConnectorError ? err : null; }
check("an unknown device surfaces upstream_error, never an invented exception-free stream", missingErr?.code === "upstream_error");


console.log(`figures=normalized=${enumRes.combos},raw=${rawEnumRes.combos},grants=${enumRes.noneCount},rawGrants=${rawEnumRes.noneCount},lifecycleContradictory=${c1Count},applicabilityContradictory=${c2Count},phaseContradictory=${c3Count},stallContradictory=${c4Count}`);

// ── The live-call gate and the default transport, each condition ISOLATED ────
//
// See `lib/live-gate.ts`. The four checks removed here were a cumulative ladder, so
// only the last of them was falsifiable; the mutation guard could delete the tier
// check — the control behind "dev and alpha never make live vendor calls" — with this
// proof green. The default fetch transport was never executed by anything at all.
checkLiveGateIsolated({
  check,
  family: "task-exception",
  resolve: (env) => taskException.resolveTaskExceptionConnector(env),
  full: {
    SIGNALGRID_TIER: "prod",
    SIGNALGRID_LIVE_INTEGRATIONS: "true",
    TASK_EXCEPTION_ACCESS_TOKEN: "t",
  },
});

await checkDefaultTransport({
  check,
  family: "task-exception",
  transport: taskException.makeDefaultTaskExceptionTransport("https://vendor.invalid/task-exception") as (a: never) => Promise<unknown>,
  arg: { deviceId: "deviceId-1", token: "t" },
  codeOf: (err) => (err instanceof taskException.TaskExceptionConnectorError ? err.code : undefined),
});

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
