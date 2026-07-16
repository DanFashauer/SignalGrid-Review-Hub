// Public-safe observed-usage fixture, keyed to the demo flows — the kind of
// history the Grid would accumulate, so the recommendations are concrete.

import type { UsageHistory } from "./index";

export const DEMO_USAGE: UsageHistory = {
  actions: [
    // Always approved on healthy posture → recommend one step less strict.
    { flowId: "flow_controlled_area", actionKey: "gate.unlock", approvalPolicy: "admin_approval", samples: 40, approved: 40, denied: 0, overrides: 0, postureHealthyRate: 1 },
    { flowId: "flow_med_admin", actionKey: "controlled.administer", approvalPolicy: "dual_approval", samples: 30, approved: 30, denied: 0, overrides: 0, postureHealthyRate: 0.99 },
    { flowId: "flow_network_change", actionKey: "config.push", approvalPolicy: "dual_approval", samples: 50, approved: 50, denied: 0, overrides: 0, postureHealthyRate: 1 },
    // Denials / overrides present → recommend MORE scrutiny.
    { flowId: "flow_med_admin", actionKey: "dose.override", approvalPolicy: "admin_approval", samples: 25, approved: 21, denied: 3, overrides: 1, postureHealthyRate: 0.9 },
  ],
  flows: [
    { flowId: "flow_med_admin", breaks: 5, breakingSignal: "baseline", candidateSignal: "attestation", frictionRate: 0.12, samples: 200 },
    { flowId: "flow_controlled_area", breaks: 1, candidateSignal: "badge_binding", frictionRate: 0.3, samples: 120 },
    { flowId: "flow_network_change", breaks: 0, frictionRate: 0.05, samples: 300 },
  ],
};
