// @workspace/iac — trust-gated GitOps control plane for endpoints.
//
// SignalGrid's take on Infrastructure-as-Code for device management: declare the
// desired fleet state in version-controlled files, diff it against the observed
// state (plan), roll it out only through a governed lifecycle whose apply is
// gated on BOTH a recorded human approval and an `allow` trust decision, and
// treat drift between declared and observed as a first-class signal. Pure,
// deterministic, deep-frozen, fail-closed. Fleet / Intune / Jamf are the
// declarative backends this gates and drift-checks — never competes with.

export * from "./types";
export { parseDesiredState, planChanges } from "./plan";
export {
  createRollout,
  markPlanned,
  requestApproval,
  approve,
  reject,
  supersede,
  apply,
} from "./lifecycle";
export { detectDrift, toProbeResults } from "./drift";
export { summarizePlan, summarizeDrift } from "./summarize";
export { DEMO_DESIRED_STATE, DEMO_OBSERVED_STATE } from "./defaults";
