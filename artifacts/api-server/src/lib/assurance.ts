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

import { resolveTier, type Tier } from "./tier";
import { core } from "./core";
import { demoSurfacesEnabled, resolveProfile, routeServedByGateway, type ProductProfile } from "./profile";

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
  /** Can any route this deployment serves answer a `step_up`? Derived from the
   *  ROUTES THE RUNNING APP ACTUALLY MOUNTED, then passed through the same fence
   *  a request would meet, so it tracks what is served rather than a second
   *  opinion about it. False under the gateway profile: Limited GA ships in
   *  SHADOW mode, the gate can return `step_up`, and nothing served can resolve
   *  one. Stated so "returns step_up" is never read as "performs step-up". */
  stepUpAnswerable: boolean;
}

/** One method-bearing layer of a running Express router stack. */
interface MountedRoute {
  method: string;
  path: string;
}

interface RouteLayer {
  route?: { path?: unknown; methods?: Record<string, unknown> };
  handle?: { stack?: unknown };
}

/**
 * Every (method, path) the RUNNING app has mounted, relative to the nearest mount.
 *
 * The router stack is walked rather than the source read, because the question is
 * "what does this process serve", and every other answer to it is a second opinion.
 * `test/route-stack-dump.mjs` walks the same structure from outside for the API
 * suite's coverage check; this is the in-process half.
 *
 * MOUNT PREFIXES ARE NOT RESOLVED, deliberately. Every router in this app is
 * mounted pathless below `/api` (routes/index.ts), so a layer's declared path is
 * already the path the GA fence matches on. If a router were ever mounted under a
 * sub-path the collected path would be SHORTER than the real one, match no
 * capability prefix, and the posture would report LESS than the deployment has —
 * the fail-closed direction. A stack this cannot read at all yields nothing, for
 * the same reason.
 */
export function mountedRoutes(servedApp: unknown): MountedRoute[] {
  const app = servedApp as { router?: { stack?: unknown }; _router?: { stack?: unknown } } | null | undefined;
  const top = app?.router?.stack ?? app?._router?.stack;
  const out: MountedRoute[] = [];
  const walk = (stack: unknown, depth: number): void => {
    if (!Array.isArray(stack) || depth > 8) return;
    for (const layer of stack as RouteLayer[]) {
      const route = layer?.route;
      if (route) {
        const paths = Array.isArray(route.path) ? route.path : [route.path];
        for (const p of paths) {
          if (typeof p !== "string") continue;
          for (const method of Object.keys(route.methods ?? {})) {
            out.push({ method: method.toUpperCase(), path: p });
          }
        }
        continue;
      }
      walk(layer?.handle?.stack, depth + 1);
    }
  };
  walk(top, 0);
  return out;
}

/**
 * Is a step-up resolvable on THIS deployment?
 *
 * Both arms derive from the same two facts — the route is mounted, and the fence a
 * request would meet lets it through (`routes/index.ts` runs exactly this test).
 * The review-demo arm used to be the literal `true`, which is the defect this file's
 * own header forbids: renaming every `/v1/step-up` route left the field reporting a
 * capability the process did not have, and the assertion pinning it passed either
 * way. Unknown answers `false`: claiming less capability than you have is the only
 * safe direction for a posture field.
 */
function stepUpAnswerable(servedApp: unknown): boolean {
  return mountedRoutes(servedApp).some(
    (r) => r.path.startsWith("/v1/step-up") && (demoSurfacesEnabled() || routeServedByGateway(r.method, r.path)),
  );
}

export function resolveAssurancePosture(servedApp: unknown): AssurancePosture {
  const tier = resolveTier();
  return {
    profile: resolveProfile(),
    tier,
    // From the connectors the core holds, never from SIGNALGRID_LIVE_INTEGRATIONS (which permits live calls; none exist).
    signalSource: core.signalSource(),
    verdictEffect: "advisory",
    stepUpAnswerable: stepUpAnswerable(servedApp),
  };
}
