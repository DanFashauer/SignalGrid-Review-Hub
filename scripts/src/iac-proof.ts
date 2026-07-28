// Proof: @workspace/iac — the trust-gated GitOps control plane.
//
// Proves the three guarantees that make this SignalGrid's IaC and not a plain
// diff tool: (1) plan/diff is total and deterministic, (2) a rollout cannot
// apply itself — apply requires a recorded human approval AND an `allow` trust
// decision (every other outcome, including the fail-closed `unknown`, blocks),
// and (3) drift between declared and observed is detected and projected into the
// self-audit vocabulary. Negative controls carry the weight: we assert the
// UNSAFE paths are refused, not just that the happy path works.

import {
  apply,
  approve,
  createRollout,
  DEMO_DESIRED_STATE,
  DEMO_OBSERVED_STATE,
  detectDrift,
  IacError,
  LEGAL_TRANSITIONS,
  markPlanned,
  planChanges,
  requestApproval,
  RESOURCE_KIND_ORDER,
  RESOURCE_KINDS,
  ROLLOUT_STATUSES,
  reject,
  summarizeDrift,
  summarizePlan,
  supersede,
  toProbeResults,
  TRUST_OUTCOMES,
  type DesiredState,
  type ObservedState,
  type Rollout,
  type TrustOutcome,
} from "@workspace/iac";

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean): void {
  if (ok) passed += 1;
  else failures.push(name);
}
/** Assert a call throws an IacError with the given code. */
function throwsCode(name: string, code: string, fn: () => unknown): void {
  try {
    fn();
    check(name, false);
  } catch (e) {
    check(name, e instanceof IacError && e.code === code);
  }
}

// ── Plan / diff ────────────────────────────────────────────────────────────
const plan = planChanges(DEMO_DESIRED_STATE, DEMO_OBSERVED_STATE);
check("plan: create count is 2", plan.counts.create === 2);
check("plan: update count is 1", plan.counts.update === 1);
check("plan: delete count is 1", plan.counts.delete === 1);
check("plan: noop count is 2", plan.counts.noop === 2);
check("plan: hasChanges is true", plan.hasChanges === true);
check("plan: requiresApproval is true", plan.requiresApproval === true);

const createItem = plan.items.find((i) => i.action === "create");
check("plan: a create item exists", !!createItem);
check(
  "plan: create item's changes are all additions (before === null)",
  !!createItem && createItem.changes.length > 0 && createItem.changes.every((c) => c.before === null),
);
const updateItem = plan.items.find((i) => i.action === "update" && i.id === "baseline-frontline");
check("plan: baseline-frontline is an update", !!updateItem);
check(
  "plan: update carries the osFloor field change 16.0 → 17.0",
  !!updateItem &&
    updateItem.changes.some((c) => c.field === "osFloor" && c.before === "16.0" && c.after === "17.0"),
);
const deleteItem = plan.items.find((i) => i.action === "delete");
check("plan: an undeclared observed resource becomes a delete", !!deleteItem);
check("plan: a delete is always approval-gated (sensitive)", !!deleteItem && deleteItem.sensitive === true);
check(
  "plan: a delete's changes are all removals (after === null)",
  !!deleteItem && deleteItem.changes.length > 0 && deleteItem.changes.every((c) => c.after === null),
);
const noopItem = plan.items.find((i) => i.action === "noop");
check("plan: an in-sync resource is a noop", !!noopItem);
check("plan: a noop has no changes and is not sensitive", !!noopItem && noopItem.changes.length === 0 && noopItem.sensitive === false);

// Determinism: same inputs → byte-identical plan.
const planAgain = planChanges(DEMO_DESIRED_STATE, DEMO_OBSERVED_STATE);
check("plan: deterministic (re-run is identical)", JSON.stringify(plan) === JSON.stringify(planAgain));
check("plan: output is frozen", Object.isFrozen(plan) && Object.isFrozen(plan.items));

// Validation fail-closed (negative controls).
throwsCode("validate: unknown kind is refused", "unknown_kind", () =>
  planChanges({ resources: [{ kind: "wat" as never, id: "x", spec: {} }] }, { resources: [] }),
);
throwsCode("validate: duplicate (kind,id) is refused", "duplicate_resource", () =>
  planChanges(
    { resources: [
      { kind: "config_profile", id: "dup", spec: {} },
      { kind: "config_profile", id: "dup", spec: {} },
    ] },
    { resources: [] },
  ),
);
throwsCode("validate: empty id is refused", "malformed_input", () =>
  planChanges({ resources: [{ kind: "config_profile", id: "  ", spec: {} }] }, { resources: [] }),
);
throwsCode("validate: non-string spec value is refused", "malformed_input", () =>
  planChanges(
    { resources: [{ kind: "config_profile", id: "x", spec: { a: 1 as never } }] },
    { resources: [] },
  ),
);
throwsCode("validate: non-object spec is refused", "malformed_input", () =>
  planChanges({ resources: [{ kind: "config_profile", id: "x", spec: [] as never }] }, { resources: [] }),
);

// ── Governed rollout lifecycle ───────────────────────────────────────────────
const r0 = createRollout("rollout-1", plan);
check("lifecycle: fresh rollout is draft", r0.status === "draft");
check("lifecycle: fresh rollout has version 0 and no approval", r0.version === 0 && r0.approval === null);
const r1 = markPlanned(r0);
check("lifecycle: draft → planned", r1.status === "planned");
const r2 = requestApproval(r1);
check("lifecycle: planned → pending_approval", r2.status === "pending_approval");
const r3 = approve(r2, "approver:owner-1", "seq:42");
check("lifecycle: pending_approval → approved carries the approver ref", r3.status === "approved" && r3.approval?.approvedByRef === "approver:owner-1");
check("lifecycle: version increments across transitions", r3.version === 3);
const r4 = apply(r3, "allow");
check("lifecycle: approved + allow → applied", r4.status === "applied" && r4.trustOutcome === "allow");

check("lifecycle: transitions do not mutate input", r2.status === "pending_approval" && r0.status === "draft");
check("lifecycle: rollout output is frozen", Object.isFrozen(r4));

// Lifecycle negative controls.
throwsCode("lifecycle: approve with empty approver ref refused", "approver_required", () => approve(r2, "   ", "seq:1"));
throwsCode("lifecycle: approve with empty sequence ref refused", "approver_required", () => approve(r2, "approver:x", ""));
throwsCode("lifecycle: apply from pending_approval refused (illegal)", "illegal_transition", () => apply(r2, "allow"));
throwsCode("lifecycle: illegal draft → applied refused", "illegal_transition", () => apply(r0, "allow"));

// A forged {status:"approved", approval:null} must still refuse to apply.
const forged: Rollout = { ...r3, approval: null };
throwsCode("lifecycle: forged approved-with-null-approval cannot apply", "approval_missing", () => apply(forged, "allow"));

const rejected = reject(r2);
check("lifecycle: pending_approval → rejected", rejected.status === "rejected");
const superseded = supersede(r3);
check("lifecycle: approved → superseded", superseded.status === "superseded");

// ── Trust gate ───────────────────────────────────────────────────────────────
throwsCode("trust-gate: step_up blocks apply", "trust_gate_blocked", () => apply(r3, "step_up"));
throwsCode("trust-gate: restrict blocks apply", "trust_gate_blocked", () => apply(r3, "restrict"));
throwsCode("trust-gate: deny blocks apply", "trust_gate_blocked", () => apply(r3, "deny"));
throwsCode("trust-gate: unknown blocks apply (fail-closed)", "trust_gate_blocked", () => apply(r3, "unknown"));

// Sweep every trust outcome: exactly one (allow) may apply an approved rollout.
let applied = 0;
for (const outcome of TRUST_OUTCOMES as readonly TrustOutcome[]) {
  try {
    const res = apply(r3, outcome);
    if (res.status === "applied") applied += 1;
  } catch {
    /* blocked — expected for every non-allow outcome */
  }
}
check("trust-gate: exactly one trust outcome (allow) releases a rollout", applied === 1);

// ── Drift ────────────────────────────────────────────────────────────────────
const drift = detectDrift(DEMO_DESIRED_STATE, DEMO_OBSERVED_STATE);
check("drift: in_sync count is 2", drift.counts.in_sync === 2);
check("drift: drifted count is 1", drift.counts.drifted === 1);
check("drift: missing count is 2", drift.counts.missing === 2);
check("drift: unmanaged count is 1", drift.counts.unmanaged === 1);
check("drift: overall is worst-status (missing)", drift.overall === "missing");
const drifted = drift.findings.find((f) => f.status === "drifted");
check("drift: a drifted finding carries the changed field", !!drifted && drifted.changes.some((c) => c.field === "osFloor"));
check("drift: an undeclared observed resource is unmanaged", drift.findings.some((f) => f.status === "unmanaged" && f.id === "legacy-mdm-restriction"));
check("drift: output is frozen", Object.isFrozen(drift) && Object.isFrozen(drift.findings));

// Worst-status-wins on constructed cases.
const allSync = detectDrift(
  { resources: [{ kind: "config_profile", id: "a", spec: { x: "1" } }] },
  { resources: [{ kind: "config_profile", id: "a", spec: { x: "1" } }] },
);
check("drift: everything matching → overall in_sync", allSync.overall === "in_sync");
const missingOnly = detectDrift(
  { resources: [{ kind: "config_profile", id: "a", spec: { x: "1" } }] },
  { resources: [] },
);
check("drift: a declared-but-absent resource → overall missing", missingOnly.overall === "missing");

// Projection into self-audit vocabulary.
const probes = toProbeResults(drift);
check("drift→probe: missing maps to broken", Object.values(probes).some((p) => p.status === "broken"));
check("drift→probe: drifted maps to drifted", Object.values(probes).some((p) => p.status === "drifted"));
check("drift→probe: in_sync maps to healthy", Object.values(probes).some((p) => p.status === "healthy"));
check("drift→probe: keys are namespaced iac:<kind>:<id>", Object.keys(probes).every((k) => k.startsWith("iac:")));

// ── Summaries (plain language, no internal-enum leak) ────────────────────────
const planSummary = summarizePlan(plan);
const driftSummary = summarizeDrift(drift);
const noChangeSummary = summarizePlan(planChanges({ resources: [] }, { resources: [] }));
const inSyncSummary = summarizeDrift(allSync);
check("summarize: plan summary mentions approval when required", /approval/i.test(planSummary));
check("summarize: no-change plan says everything matches", /matches the declared/i.test(noChangeSummary));
check("summarize: drift summary reports a difference", /differ/i.test(driftSummary));
check("summarize: in-sync drift says the fleet matches", /matches the declared/i.test(inSyncSummary));
const leakTokens = ["in_sync", "unmanaged", "noop", "pending_approval"];
check(
  "summarize: no internal-enum token leaks into a headline",
  !leakTokens.some((t) => planSummary.includes(t) || driftSummary.includes(t)),
);

// ── Structural invariants ────────────────────────────────────────────────────
check("structure: every resource kind has a distinct sort index", new Set(RESOURCE_KINDS.map((k) => RESOURCE_KIND_ORDER[k])).size === RESOURCE_KINDS.length);
check(
  "structure: applied is reachable ONLY from approved",
  ROLLOUT_STATUSES.filter((s) => LEGAL_TRANSITIONS[s].includes("applied")).length === 1 &&
    LEGAL_TRANSITIONS.approved.includes("applied"),
);
check("structure: every rollout status is a transition key", ROLLOUT_STATUSES.every((s) => Object.prototype.hasOwnProperty.call(LEGAL_TRANSITIONS, s)));

// ── Report ───────────────────────────────────────────────────────────────────
const blockingTrust = (TRUST_OUTCOMES as readonly string[]).filter((o) => o !== "allow").length;
const demoPlanChanges = plan.counts.create + plan.counts.update + plan.counts.delete;
console.log(
  `figures=resourceKinds=${RESOURCE_KINDS.length},planActions=4,rolloutStatuses=${ROLLOUT_STATUSES.length},trustOutcomes=${TRUST_OUTCOMES.length},blockingTrustOutcomes=${blockingTrust},driftStatuses=5,demoPlanChanges=${demoPlanChanges}`,
);
const total = passed + failures.length;
if (failures.length) {
  console.log("failures:");
  for (const f of failures) console.log(`  - ${f}`);
}
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length) process.exitCode = 1;
