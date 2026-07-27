// Portable work-context proof — fully OFFLINE and deterministic.
//
// Issue #136's acceptance criterion made checkable: the same verified person receives
// a consistent, role-appropriate experience across authorized devices WITHOUT copying
// access everywhere. Continuity carries the WORK; trust is re-evaluated per device
// through the fabric's REAL `composeDeviceRisk` — this proof imports the actual
// composition, not a copy of the ladder.
//
// Like `pim-activation`, this layer consumes other dimensions' VERDICTS rather than
// normalizing a bridge report, so what has to be proved is not a parse layer but three
// MONOTONE INVARIANTS, enumerated over a deterministic matrix of contexts × device
// compositions rather than spot-checked:
//
//   (a) CONTINUITY NEVER WIDENS — for a fixed context, a device that composes worse
//       never receives a more permissive final decision (full pairwise sweep).
//   (b) THE CEILING NEVER LOWERS BY MOVEMENT — every reevaluation carries a ceiling
//       >= the one it received; only an explicit resolution call with a non-empty
//       resolution ref lowers it.
//   (c) EXCEPTIONS TRAVEL — unresolved exceptions and active restrictions in every
//       next context are supersets of the input's; `resolveException` removes exactly
//       the named one, against a resolution ref.
//
// Plus the machine check behind "descriptive, never permissive": credential-smelling
// refs REFUSE assembly with a typed error, and every refusal below is asserted WITH
// ITS REASON — this repo has paid for reason-blind checks before, so the discipline
// is applied from birth rather than after a review finds the gap.
import {
  CONTEXT_TRUST_CEILINGS,
  WorkContextError,
  assembleWorkContext,
  ceilingFromAction,
  clearRestriction,
  credentialSmellOf,
  deepFreeze,
  lowerTrustCeiling,
  reevaluateForDevice,
  resolveException,
  type AssembleWorkContextInputs,
  type ContextTrustCeiling,
  type PortableWorkContext,
  type SourceVerdictSummary,
} from "@workspace/work-context";
import {
  ACTION_RANK,
  UNIFIED_ACTIONS,
  composeDeviceRisk,
  type ComposableSignal,
  type UnifiedAction,
} from "@workspace/posture-composition";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Portable work-context proof");

// ── deterministic builders ────────────────────────────────────────────────────

const VERDICTS_BY_CEILING: Record<ContextTrustCeiling, SourceVerdictSummary[]> = {
  none: [
    { verdictRef: "vrd-0001", strongestAction: "none", reasonCodes: ["TASK_STREAM_HEALTHY"] },
  ],
  step_up: [
    { verdictRef: "vrd-0001", strongestAction: "none", reasonCodes: ["TASK_STREAM_HEALTHY"] },
    { verdictRef: "vrd-0002", strongestAction: "step_up", reasonCodes: ["SESSION_UNVERIFIED"] },
  ],
  restrict: [
    { verdictRef: "vrd-0001", strongestAction: "none", reasonCodes: ["TASK_STREAM_HEALTHY"] },
    { verdictRef: "vrd-0003", strongestAction: "restrict", reasonCodes: ["TASK_ASSIGNMENT_MISMATCH"] },
  ],
};

const HELD_TASK = "task-held-0031";
const OPEN_EXCEPTION = "INVENTORY_EXCEPTION_ACTIVE:exc-0007";

function makeInputs(ceiling: ContextTrustCeiling, baggage: boolean): AssembleWorkContextInputs {
  return {
    subject: { personRef: "person-0001", tenantId: "tenant-alpha", role: "picker", shiftRef: "shift-0400", assignmentRef: "wave-0092" },
    work: {
      workflowKey: "warehouse-inbound-putaway",
      activeTaskRefs: ["task-0107", "task-0108"],
      heldTaskRefs: baggage ? [HELD_TASK] : [],
      unresolvedExceptionRefs: baggage ? [OPEN_EXCEPTION] : [],
      appCatalogKeys: ["wms-client", "scan-verify"],
    },
    situation: { lastKnownZoneRef: "zone-inbound-03", custodyRefs: ["custody-case-0044"] },
    sourceVerdicts: VERDICTS_BY_CEILING[ceiling],
    policyVersionRef: "policy-v14",
    assembledAtRef: "asm-000123",
  };
}

// ── assembly derives the carried trust honestly ───────────────────────────────

const calm = assembleWorkContext(makeInputs("none", false));
check("assembled from a healthy verdict → ceiling 'none', no restrictions, contextVersion 1",
  calm.trust.requiredStepUpLevel === "none" && calm.trust.activeRestrictions.length === 0 && calm.provenance.contextVersion === 1);
check("provenance carries every source verdict ref in order, and lastVerdictRef is the newest",
  calm.provenance.sourceVerdictRefs.join(",") === "vrd-0001" && calm.trust.lastVerdictRef === "vrd-0001");

const restricted = assembleWorkContext(makeInputs("restrict", true));
check("assembled from a restrict-grade verdict → ceiling 'restrict' AND its reason code lands in activeRestrictions",
  restricted.trust.requiredStepUpLevel === "restrict" && restricted.trust.activeRestrictions.includes("TASK_ASSIGNMENT_MISMATCH"));
check("...with lastVerdictRef the newest of its sources", restricted.trust.lastVerdictRef === "vrd-0003");

const alerted = assembleWorkContext({ ...makeInputs("none", false), sourceVerdicts: [{ verdictRef: "vrd-0009", strongestAction: "alert", reasonCodes: ["VERIFICATION_FAILED"] }] });
check("an 'alert' verdict projects FAIL-SAFE to the 'step_up' ceiling — never rounded down past a rung",
  alerted.trust.requiredStepUpLevel === "step_up");
check("...and its reason does NOT enter activeRestrictions — restrictions are restrict-grade confirmed findings only",
  alerted.trust.activeRestrictions.length === 0);
const escalated = assembleWorkContext({ ...makeInputs("none", false), sourceVerdicts: [{ verdictRef: "vrd-0010", strongestAction: "escalate", reasonCodes: ["LEFTOVER_SESSION_LIVE"] }] });
check("an 'escalate' verdict projects to the 'restrict' ceiling, and its reason travels as a restriction",
  escalated.trust.requiredStepUpLevel === "restrict" && escalated.trust.activeRestrictions.includes("LEFTOVER_SESSION_LIVE"));

// The projection, enumerated over the WHOLE ladder rather than the three cases above.
check("ceiling projection is monotone and exhaustive over all 8 ladder actions",
  UNIFIED_ACTIONS.every((a, i) => {
    const c = ceilingFromAction(a);
    const expected = ACTION_RANK[a] >= ACTION_RANK.restrict ? "restrict" : ACTION_RANK[a] >= ACTION_RANK.step_up ? "step_up" : "none";
    const prev = i === 0 ? "none" : ceilingFromAction(UNIFIED_ACTIONS[i - 1]);
    return c === expected && ACTION_RANK[c] >= ACTION_RANK[prev];
  }));

let emptyRefusal: WorkContextError | null = null;
try { assembleWorkContext({ ...makeInputs("none", false), sourceVerdicts: [] }); } catch (err) { emptyRefusal = err instanceof WorkContextError ? err : null; }
check("zero source verdicts → typed refusal `no_source_verdicts` — a context with no provenance is not a context",
  emptyRefusal?.code === "no_source_verdicts");

check("assembly is deterministic: two assemblies from identical inputs are byte-identical",
  JSON.stringify(assembleWorkContext(makeInputs("step_up", true))) === JSON.stringify(assembleWorkContext(makeInputs("step_up", true))));
check("every assembled context is deeply frozen — mutation is an error, not a convention",
  Object.isFrozen(restricted) && Object.isFrozen(restricted.work) && Object.isFrozen(restricted.work.unresolvedExceptionRefs) && Object.isFrozen(restricted.trust.activeRestrictions));

// ── the credential denylist: DESCRIPTIVE, NEVER PERMISSIVE, machine-checked ───
//
// Each refusal is asserted WITH its reason (the typed code, the smell family and the
// field path) — a refusal that fires for the wrong reason is a check that will keep
// passing after the real guard is deleted.

const refuse = (mutate: (i: AssembleWorkContextInputs) => void): WorkContextError | null => {
  const inputs = makeInputs("none", true);
  mutate(inputs);
  try { assembleWorkContext(inputs); } catch (err) { return err instanceof WorkContextError ? err : null; }
  return null;
};

const jwt = refuse((i) => { i.work.activeTaskRefs[1] = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig"; });
check("a JWT-looking ref refuses assembly: code credential_material_refused, smell jwt_like, path names the field",
  jwt?.code === "credential_material_refused" && jwt?.smell === "jwt_like" && jwt?.path === "inputs.work.activeTaskRefs[1]");
check("...and the refusal message does NOT echo the token — an error that repeats a secret is a second leak",
  jwt !== null && !jwt.message.includes("eyJhbGciOi"));

const bearer = refuse((i) => { i.situation.custodyRefs[0] = "Bearer x"; });
check("a pasted `Bearer x` refuses with smell bearer_token at its exact path",
  bearer?.code === "credential_material_refused" && bearer?.smell === "bearer_token" && bearer?.path === "inputs.situation.custodyRefs[0]");

const sk = refuse((i) => { i.policyVersionRef = "sk_live_51H8xample"; });
check("a vendor secret key (`sk_live...`) refuses with smell secret_key_prefix",
  sk?.code === "credential_material_refused" && sk?.smell === "secret_key_prefix" && sk?.path === "inputs.policyVersionRef");

const pem = refuse((i) => { i.subject.assignmentRef = "-----BEGIN RSA PRIVATE KEY-----"; });
check("a PEM block header refuses with smell pem_block",
  pem?.code === "credential_material_refused" && pem?.smell === "pem_block" && pem?.path === "inputs.subject.assignmentRef");

const akia = refuse((i) => { i.sourceVerdicts = [{ verdictRef: "AKIAIOSFODNN7EXAMPLE", strongestAction: "none", reasonCodes: [] }]; });
check("an AWS access key id refuses with smell aws_access_key_id",
  akia?.code === "credential_material_refused" && akia?.smell === "aws_access_key_id");

const urlCred = refuse((i) => { i.situation.lastKnownZoneRef = "https://svc:hunter2@wms.internal/zone/3"; });
check("credentials embedded in a URL (`//user:pass@`) refuse with smell userinfo_in_url",
  urlCred?.code === "credential_material_refused" && urlCred?.smell === "userinfo_in_url");

check("the detector passes ordinary opaque refs — the sweep is a denylist, not a paranoia filter",
  ["person-0001", "task-held-0031", "vrd-0003", "zone-inbound-03", "policy-v14"].every((r) => credentialSmellOf(r) === null));

let signalRefusal: WorkContextError | null = null;
try { reevaluateForDevice(calm, [{ kind: "device_posture", posture: "p", action: "none", reason: "Bearer abc123" }]); } catch (err) { signalRefusal = err instanceof WorkContextError ? err : null; }
check("the sweep guards EVERY ingress: a device signal whose reason smells like a token is refused, not composed",
  signalRefusal?.code === "credential_material_refused" && signalRefusal?.smell === "bearer_token");

// ── the matrix: every ceiling × device compositions spanning the whole ladder ─

interface DeviceSet { label: string; signals: ComposableSignal[]; rank: number }
const deviceSets: DeviceSet[] = [
  { label: "no-signals", signals: [], rank: ACTION_RANK.none },
  ...UNIFIED_ACTIONS.map((action): DeviceSet => ({
    label: `single-${action}`,
    signals: [{ kind: "device_posture", posture: `fixture-${action}`, action, reason: `DEV_${action.toUpperCase()}` }],
    rank: ACTION_RANK[action],
  })),
];
// Rank each set by the REAL composition, not by construction — the proof must not
// assume what composeDeviceRisk will say.
for (const s of deviceSets) {
  const composed = composeDeviceRisk(s.signals);
  if (ACTION_RANK[composed.strongestAction] !== s.rank) failures.push(`device set ${s.label} composed unexpectedly`);
}

const contexts: { label: string; ctx: PortableWorkContext }[] = [];
for (const ceiling of CONTEXT_TRUST_CEILINGS) {
  for (const baggage of [false, true]) {
    contexts.push({ label: `${ceiling}${baggage ? "+baggage" : ""}`, ctx: assembleWorkContext(makeInputs(ceiling, baggage)) });
  }
}

let matrixCells = 0;
let monotonePairs = 0;
let widenings = 0;        // invariant (a) violations
let floorViolations = 0;  // invariant (a) floor: final may never undercut the carried ceiling
let ceilingDrops = 0;     // invariant (b) violations
let carryDrops = 0;       // invariant (c) violations
let workDrifts = 0;       // the work must be IDENTICAL wherever the person goes
let ceilingRaises = 0;    // non-vacuity for (b)
let strictTightenings = 0; // non-vacuity for (a)

const isSuperset = (next: readonly string[], prev: readonly string[]): boolean => prev.every((p) => next.includes(p));

for (const { ctx } of contexts) {
  const finals: number[] = [];
  for (const set of deviceSets) {
    const { decision, nextContext } = reevaluateForDevice(ctx, set.signals);
    matrixCells += 1;
    finals.push(ACTION_RANK[decision.finalRequiredAction]);
    // Per-cell FLOOR assertion, added after adversarial review proved the pairwise
    // sweep alone is structurally blind to a combiner that drops the carried
    // ceiling: any function monotone in the DEVICE action passes the pairwise
    // check, including one that ignores the ceiling entirely (widenings stayed 0
    // under exactly that mutation; only a single fixture caught it, and only at
    // the step_up grade). The floor is the invariant as ADVERTISED, so it is
    // asserted in every cell, at every grade.
    if (ACTION_RANK[decision.finalRequiredAction] < ACTION_RANK[ctx.trust.requiredStepUpLevel]) floorViolations += 1;
    if (ACTION_RANK[nextContext.trust.requiredStepUpLevel] < ACTION_RANK[ctx.trust.requiredStepUpLevel]) ceilingDrops += 1;
    if (ACTION_RANK[nextContext.trust.requiredStepUpLevel] > ACTION_RANK[ctx.trust.requiredStepUpLevel]) ceilingRaises += 1;
    if (!isSuperset(nextContext.work.unresolvedExceptionRefs, ctx.work.unresolvedExceptionRefs)) carryDrops += 1;
    if (!isSuperset(nextContext.trust.activeRestrictions, ctx.trust.activeRestrictions)) carryDrops += 1;
    if (JSON.stringify(nextContext.work) !== JSON.stringify(ctx.work)) workDrifts += 1;
    if (nextContext.provenance.contextVersion !== ctx.provenance.contextVersion + 1) failures.push("contextVersion did not advance");
  }
  // (a) full pairwise monotonicity: a worse device composition never yields a more
  // permissive final decision, for this fixed context.
  for (let a = 0; a < deviceSets.length; a += 1) {
    for (let b = 0; b < deviceSets.length; b += 1) {
      if (a === b || deviceSets[a].rank > deviceSets[b].rank) continue;
      monotonePairs += 1;
      if (finals[a] > finals[b]) widenings += 1;
      if (finals[a] < finals[b]) strictTightenings += 1;
    }
  }
}

check(`(a) CONTINUITY NEVER WIDENS: over ${matrixCells} matrix cells and ${monotonePairs} ordered device pairs, a worse composition never got a more permissive decision (widenings=${widenings})`,
  widenings === 0 && matrixCells === contexts.length * deviceSets.length);
check("(a) ...and not vacuously: worse devices genuinely tighten decisions somewhere in the matrix", strictTightenings > 0);
check(`(a) FLOOR: in every one of ${matrixCells} cells, the final decision is at least the carried ceiling (floorViolations=${floorViolations})`,
  floorViolations === 0 && matrixCells > 0);
check(`(b) THE CEILING NEVER LOWERS BY MOVEMENT: across all ${matrixCells} reevaluations, nextContext.requiredStepUpLevel >= the carried ceiling (drops=${ceilingDrops})`,
  ceilingDrops === 0);
check("(b) ...and not vacuously: bad devices RAISE the carried ceiling somewhere in the matrix", ceilingRaises > 0);
check(`(c) EXCEPTIONS TRAVEL: across all ${matrixCells} reevaluations, unresolved exceptions and active restrictions are supersets of the input's (dropped=${carryDrops})`,
  carryDrops === 0);
check("the WORK is identical wherever the person goes: the work section survives every cell of the matrix byte-for-byte", workDrifts === 0);

// A restrict-grade device finding is a CONFIRMED fact, so its reason joins the
// travelling restrictions — the superset may grow, never shrink.
const grew = reevaluateForDevice(calm, [{ kind: "threat", posture: "active-threat", action: "restrict", reason: "EDR_CONTAINMENT" }]);
check("a restrict-grade device driver ADDS its reason code to the travelling restrictions",
  grew.nextContext.trust.activeRestrictions.includes("EDR_CONTAINMENT") && grew.nextContext.trust.requiredStepUpLevel === "restrict");

// ── the resolution doors: the ONLY way carried state narrows ──────────────────

const twoExceptions = assembleWorkContext({
  ...makeInputs("restrict", true),
  work: { ...makeInputs("restrict", true).work, unresolvedExceptionRefs: [OPEN_EXCEPTION, "VERIFICATION_FAILED:exc-0011"] },
});
const resolvedOne = resolveException(twoExceptions, OPEN_EXCEPTION, "cyclecount-0088");
check("resolveException removes EXACTLY the named exception; the other keeps travelling",
  !resolvedOne.work.unresolvedExceptionRefs.includes(OPEN_EXCEPTION) &&
  resolvedOne.work.unresolvedExceptionRefs.includes("VERIFICATION_FAILED:exc-0011") &&
  resolvedOne.work.unresolvedExceptionRefs.length === twoExceptions.work.unresolvedExceptionRefs.length - 1 &&
  resolvedOne.provenance.contextVersion === twoExceptions.provenance.contextVersion + 1);

const codeOf = (fn: () => unknown): string | null => {
  try { fn(); } catch (err) { return err instanceof WorkContextError ? err.code : null; }
  return null;
};
check("resolveException with an EMPTY resolution ref → typed refusal resolution_ref_required",
  codeOf(() => resolveException(twoExceptions, OPEN_EXCEPTION, "")) === "resolution_ref_required");
check("...a whitespace-only ref is empty too", codeOf(() => resolveException(twoExceptions, OPEN_EXCEPTION, "   ")) === "resolution_ref_required");
check("resolving an exception this context does not carry → unknown_exception_ref, never a silent success",
  codeOf(() => resolveException(twoExceptions, "NO_SUCH:exc-9999", "res-1")) === "unknown_exception_ref");

const cleared = clearRestriction(restricted, "TASK_ASSIGNMENT_MISMATCH", "incident-0402-closed");
check("clearRestriction removes exactly the named reason code, against a resolution ref",
  !cleared.trust.activeRestrictions.includes("TASK_ASSIGNMENT_MISMATCH") && cleared.provenance.contextVersion === restricted.provenance.contextVersion + 1);
check("clearRestriction with an empty ref refuses", codeOf(() => clearRestriction(restricted, "TASK_ASSIGNMENT_MISMATCH", "")) === "resolution_ref_required");
check("clearing a restriction this context does not carry → unknown_restriction",
  codeOf(() => clearRestriction(restricted, "NOT_PRESENT", "res-2")) === "unknown_restriction");

const stepUpCtx = assembleWorkContext(makeInputs("step_up", false));
const lowered = lowerTrustCeiling(stepUpCtx, "none", "identity-reproof-0007");
check("lowerTrustCeiling with a non-empty resolution ref is the one path DOWN for the ceiling",
  lowered.trust.requiredStepUpLevel === "none" && lowered.provenance.contextVersion === stepUpCtx.provenance.contextVersion + 1);
check("lowerTrustCeiling with an empty ref refuses", codeOf(() => lowerTrustCeiling(stepUpCtx, "none", "")) === "resolution_ref_required");
check("the resolution door does not RAISE: 'lowering' to the same or a higher rung → not_a_lowering",
  codeOf(() => lowerTrustCeiling(stepUpCtx, "restrict", "res-3")) === "not_a_lowering" &&
  codeOf(() => lowerTrustCeiling(stepUpCtx, "step_up", "res-4")) === "not_a_lowering");
check("a resolution ref that smells like a credential is refused before anything else",
  codeOf(() => resolveException(twoExceptions, OPEN_EXCEPTION, "Bearer abc")) === "credential_material_refused");

// ── handoff fixture 1: WAREHOUSE — shared handheld → shared workstation ───────
//
// Same person, same wave, one held task and one open inventory exception. Handheld A
// is healthy; workstation B carries a step_up-grade posture concern. The work must be
// IDENTICAL on both; the decision must be stricter on B.

const warehouse = assembleWorkContext(makeInputs("none", true));
const handheldA: ComposableSignal[] = [
  { kind: "device_posture", posture: "compliant", action: "none", reason: "POSTURE_COMPLIANT" },
  { kind: "task_exception", posture: "inventory_exception", action: "alert", reason: "INVENTORY_EXCEPTION_ACTIVE" },
];
const workstationB: ComposableSignal[] = [
  { kind: "device_posture", posture: "agent_stale", action: "step_up", reason: "POSTURE_UNVERIFIED" },
  { kind: "task_exception", posture: "inventory_exception", action: "alert", reason: "INVENTORY_EXCEPTION_ACTIVE" },
  { kind: "sso_session", posture: "leftover_session_expired", action: "restrict", reason: "LEFTOVER_SESSION" },
];
const onHandheld = reevaluateForDevice(warehouse, handheldA);
const onWorkstation = reevaluateForDevice(onHandheld.nextContext, workstationB);
check("warehouse handoff: the WORK is identical on handheld and workstation — continuity carried it",
  JSON.stringify(onHandheld.nextContext.work) === JSON.stringify(onWorkstation.nextContext.work));
check("warehouse handoff: the decision is STRICTER on the worse workstation — continuity did not carry trust",
  ACTION_RANK[onWorkstation.decision.finalRequiredAction] > ACTION_RANK[onHandheld.decision.finalRequiredAction]);
check("warehouse handoff: the held task and the open inventory exception are visibly present in BOTH contexts",
  [onHandheld.nextContext, onWorkstation.nextContext].every((c) =>
    c.work.heldTaskRefs.includes(HELD_TASK) && c.work.unresolvedExceptionRefs.includes(OPEN_EXCEPTION)));
check("warehouse handoff: the workstation's restrict-grade leftover session now travels as a restriction",
  onWorkstation.nextContext.trust.activeRestrictions.includes("LEFTOVER_SESSION"));

// ── handoff fixture 2: HEALTHCARE — shared iPad → a different shared iPad ─────
//
// A nurse carries a step_up ceiling (an unconfirmed session concern followed the
// work) plus an open exception. iPad A is clean — and the carried floor still binds:
// a clean device does not spend the person's history. iPad B is worse.

const healthcare = assembleWorkContext({
  ...makeInputs("step_up", true),
  subject: { personRef: "person-0210", tenantId: "tenant-med", role: "nurse", shiftRef: "shift-night", assignmentRef: "unit-4east" },
  work: {
    workflowKey: "healthcare-med-admin",
    activeTaskRefs: ["medpass-0651"],
    heldTaskRefs: [HELD_TASK],
    unresolvedExceptionRefs: [OPEN_EXCEPTION],
    appCatalogKeys: ["emr-client", "barcode-med-admin"],
  },
});
const ipadA: ComposableSignal[] = [
  { kind: "device_posture", posture: "compliant", action: "none", reason: "POSTURE_COMPLIANT" },
];
const ipadB: ComposableSignal[] = [
  { kind: "device_posture", posture: "os_outdated", action: "patch", reason: "OS_OUTDATED" },
  { kind: "network", posture: "unhealthy_network", action: "restrict", reason: "NAC_QUARANTINE" },
];
const onIpadA = reevaluateForDevice(healthcare, ipadA);
const onIpadB = reevaluateForDevice(onIpadA.nextContext, ipadB);
check("healthcare handoff: a CLEAN iPad still owes the carried step_up floor — the ceiling is re-proven, not spent",
  onIpadA.decision.deviceAction === "none" && onIpadA.decision.finalRequiredAction === "step_up");
check("healthcare handoff: the WORK is identical on both iPads",
  JSON.stringify(onIpadA.nextContext.work) === JSON.stringify(onIpadB.nextContext.work));
check("healthcare handoff: the decision is stricter on the worse iPad",
  ACTION_RANK[onIpadB.decision.finalRequiredAction] > ACTION_RANK[onIpadA.decision.finalRequiredAction]);
check("healthcare handoff: the held task and the open exception are visibly present in BOTH contexts",
  [onIpadA.nextContext, onIpadB.nextContext].every((c) =>
    c.work.heldTaskRefs.includes(HELD_TASK) && c.work.unresolvedExceptionRefs.includes(OPEN_EXCEPTION)));

// ── immutability and determinism ──────────────────────────────────────────────

const frozenInput = deepFreeze(JSON.parse(JSON.stringify(warehouse)) as PortableWorkContext);
const before = JSON.stringify(frozenInput);
const out = reevaluateForDevice(frozenInput, workstationB);
check("a deep-frozen input context passes through reevaluation untouched — compared structurally before/after",
  JSON.stringify(frozenInput) === before && out.nextContext !== frozenInput);
check("every context handed out is itself deeply frozen",
  Object.isFrozen(out.nextContext) && Object.isFrozen(out.nextContext.trust) && Object.isFrozen(out.nextContext.work.unresolvedExceptionRefs));
check("reevaluation is deterministic: same context, same signals, byte-identical result",
  JSON.stringify(reevaluateForDevice(warehouse, workstationB)) === JSON.stringify(reevaluateForDevice(warehouse, workstationB)));

// ── summary ───────────────────────────────────────────────────────────────────

console.log(`figures=matrix=${matrixCells},monotonePairs=${monotonePairs},widenings=${widenings},floorViolations=${floorViolations},ceilingDrops=${ceilingDrops},carryDrops=${carryDrops}`);
const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
