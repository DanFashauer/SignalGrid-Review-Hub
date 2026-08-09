// Assurance posture — what this deployment's verdicts actually mean.
//
// Blocker 10 in the owner's launch plan is "mixed autonomy claims": nothing states,
// per deployment, whether behaviour is ENFORCED, merely OBSERVED, or SIMULATED.
// Today that lives in prose — `docs/APP_SUITE_MATRIX.md` says it, no gate holds it,
// and the deployed demo consoles render verdicts with no label at all. A claim with
// no mechanism behind it is the defect class this codebase exists to remove.
//
// WHY FACTS AND NOT A MODE LABEL. The obvious design is one enum —
// simulated | observed | enforced. It was rejected: a single word invites the reader
// to supply their own definition, and an enum carrying a value nothing can currently
// produce ("enforced") is an overclaim by implication. Three narrow facts, each
// derived from something already true in the process, cannot be read as more than
// they say.
//
// EVERY FIELD IS DERIVED. Not one is configured, so no deployment can assert a
// posture it does not have — which is the same reason `check-launch-profile.mjs`
// re-derives its surfaces instead of trusting the profile's own arithmetic.

import { isLiveIntegrationsEnabled, resolveTier, type Tier } from "./tier";
import { GA_ALLOWED_ROUTES, demoSurfacesEnabled, resolveProfile, type ProductProfile } from "./profile";

export interface AssurancePosture {
  profile: ProductProfile;
  tier: Tier;
  /** Where signals come from. `fixtures` means committed fixture data: the verdict
   *  is reproducible and is NOT a statement about any real device. */
  signalSource: "fixtures" | "live";
  /** What a verdict does. Always `advisory`, and that is a product law rather than a
   *  current limitation: under the embedded-UX rule SignalGrid is invisible to the
   *  worker, who uses their own host app. The Assist gate ANSWERS; the host app acts.
   *  This service actuates nothing on any device and has no path to. */
  verdictEffect: "advisory";
  /** Can any route this deployment serves answer a `step_up`? Derived from the GA
   *  allowlist, so it tracks the fence rather than a second opinion about it.
   *  False under the gateway profile: Limited GA ships in SHADOW mode, the gate can
   *  return `step_up`, and nothing served can resolve one. Stated so "returns
   *  step_up" is never read as "performs step-up". */
  stepUpAnswerable: boolean;
}

export function resolveAssurancePosture(): AssurancePosture {
  const tier = resolveTier();
  return {
    profile: resolveProfile(),
    tier,
    signalSource: isLiveIntegrationsEnabled(tier) ? "live" : "fixtures",
    verdictEffect: "advisory",
    // Under review-demo every router is mounted, so the step-up routes exist. Under
    // the gateway profile the allowlist decides, and it lists none.
    stepUpAnswerable: demoSurfacesEnabled()
      ? true
      : GA_ALLOWED_ROUTES.some((r) => r.path.startsWith("/v1/step-up")),
  };
}
