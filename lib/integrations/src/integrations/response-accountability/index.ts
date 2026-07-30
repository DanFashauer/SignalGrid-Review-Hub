// Response-accountability family — public surface, routing table, live-call gate.
//
// Under connector discipline from birth: tier gate + SIGNALGRID_LIVE_INTEGRATIONS +
// credential + injected transport, fixture corpus, proof, and no network primitive.
//
// ROUTING IS A DECISION; DELIVERY IS AN ACTION. `routeConcern` says which team owns a
// class of concern. It does not page them, open a ticket, or emit a webhook — that is
// the outbound-emitter surface (`itsm`, `siem`, `syslog`, `telemetry`, `webhooks`),
// which is still ungated and an explicit owner decision. Keeping the two apart is
// what lets this family ship read-only while that question stays open.

import { evaluateResponse } from "./evaluate";
import type { NormalizedResponseRecord, ResponseVerdict } from "./types";

export * from "./types";
export { evaluateResponse, deriveAcknowledgement } from "./evaluate";

/** A read transport for a response system (ITSM, on-call, incident tracker).
 *  Deliberately NOT implemented in this repository. */
export interface ResponseReadTransport {
  readResponseRecord(concernRef: string): Promise<unknown>;
}

export type ResponseResolution =
  | { readonly mode: "fixture"; readonly reason: string }
  | { readonly mode: "live"; readonly transport: ResponseReadTransport };

/**
 * Decide whether this deployment may make a live response-system read.
 *
 * Fail-closed and unanimous, and the transport must be INJECTED — this repository
 * ships none, so the gate's failure mode is "there is no code".
 */
export function resolveResponseConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: ResponseReadTransport,
): ResponseResolution {
  const tier = (env["SIGNALGRID_TIER"] ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env["SIGNALGRID_LIVE_INTEGRATIONS"] !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  const system = (env["RESPONSE_SYSTEM"] ?? "").trim().toLowerCase();
  if (system !== "servicenow" && system !== "jira" && system !== "pagerduty") {
    return { mode: "fixture", reason: "RESPONSE_SYSTEM is not one of servicenow|jira|pagerduty" };
  }
  if (!env["RESPONSE_ACCESS_TOKEN"]?.trim()) {
    return { mode: "fixture", reason: "RESPONSE_ACCESS_TOKEN is not set" };
  }
  if (!transportOverride) {
    return { mode: "fixture", reason: "no response read transport is available — this repository ships none" };
  }
  return { mode: "live", transport: transportOverride };
}

/**
 * A routing table: which team owns which class of concern.
 *
 * CALLER-SUPPLIED, like every other policy in this fabric. An organisation's team
 * boundaries are theirs; a built-in mapping would be a guess applied to every tenant.
 */
export interface RoutingPolicy {
  /** Reason-code prefix or exact code → owning team. Longest match wins, so a
   *  specific code can override a family prefix without reordering the table. */
  readonly routes: Readonly<Record<string, string>>;
  /** Where anything unmatched goes. `null` (or absent) means the policy has a HOLE —
   *  and the verdict says OWNER_UNROUTED rather than silently dropping the concern
   *  into a default queue nobody watches. */
  readonly fallbackTeam?: string | null;
}

/**
 * Route a concern to its owning team. Pure — a lookup, not a delivery.
 *
 * LONGEST MATCH WINS. With routes `{"DEVICE_": "endpoint-team", "DEVICE_NOT_ENROLLED":
 * "onboarding"}`, the specific code goes to onboarding and every other DEVICE_ code
 * goes to the endpoint team. Shortest-match or first-match would make the table
 * order-dependent, which is how a routing table quietly stops meaning what it reads.
 */
export function routeConcern(reasonCode: string, policy: RoutingPolicy): string | null {
  let best: string | null = null;
  let bestLen = -1;
  for (const [pattern, team] of Object.entries(policy.routes)) {
    if (reasonCode.startsWith(pattern) && pattern.length > bestLen) {
      best = team;
      bestLen = pattern.length;
    }
  }
  return best ?? policy.fallbackTeam ?? null;
}

/** Fixture response records — the deterministic corpus this repository runs on.
 *  Each names the real situation it stands for. */
export const RESPONSE_FIXTURES: Readonly<Record<string, NormalizedResponseRecord>> = Object.freeze({
  /** The healthy case: owned, prompt, and confirmed gone. */
  "verified-resolved": {
    concernRef: "concern-1",
    owningTeam: "endpoint-team",
    owner: "assigned",
    acknowledgement: "acknowledged_within_target",
    resolution: "resolved",
    underlyingConcernStillPresent: false,
    acknowledgedAfterSeconds: 120,
    acknowledgementTargetSeconds: 300,
    reportIntegrity: "intact",
  },
  /** THE WATERMELON. Every process metric green — owned, acknowledged in two minutes
   *  against a five-minute target, closed as resolved — and the concern is still
   *  there. This is the fixture the dimension exists for. */
  watermelon: {
    concernRef: "concern-2",
    owningTeam: "service-desk",
    owner: "assigned",
    acknowledgement: "acknowledged_within_target",
    resolution: "resolved",
    underlyingConcernStillPresent: true,
    acknowledgedAfterSeconds: 120,
    acknowledgementTargetSeconds: 300,
    reportIntegrity: "intact",
  },
  /** Closed as resolved, nobody re-checked. How a watermelon survives unseen. */
  "resolved-unverified": {
    concernRef: "concern-3",
    owningTeam: "service-desk",
    owner: "assigned",
    acknowledgement: "acknowledged_within_target",
    resolution: "resolved",
    underlyingConcernStillPresent: null,
    acknowledgedAfterSeconds: 60,
    acknowledgementTargetSeconds: 300,
    reportIntegrity: "intact",
  },
  /** Raised, and nobody owns it. */
  unowned: {
    concernRef: "concern-4",
    owningTeam: null,
    owner: "unassigned",
    acknowledgement: "unacknowledged",
    resolution: "open",
    underlyingConcernStillPresent: true,
    acknowledgedAfterSeconds: null,
    acknowledgementTargetSeconds: 300,
    reportIntegrity: "intact",
  },
  /** Picked up, but outside the window. A slow team, not an absent one. */
  "acknowledged-late": {
    concernRef: "concern-5",
    owningTeam: "endpoint-team",
    owner: "assigned",
    acknowledgement: "acknowledged_late",
    resolution: "open",
    underlyingConcernStillPresent: true,
    acknowledgedAfterSeconds: 1800,
    acknowledgementTargetSeconds: 300,
    reportIntegrity: "intact",
  },
  /** Open, owned, inside the process. Not a finding. */
  "in-progress": {
    concernRef: "concern-6",
    owningTeam: "endpoint-team",
    owner: "assigned",
    acknowledgement: "acknowledged_within_target",
    resolution: "open",
    underlyingConcernStillPresent: true,
    acknowledgedAfterSeconds: 30,
    acknowledgementTargetSeconds: 300,
    reportIntegrity: "intact",
  },
  unreadable: {
    concernRef: "",
    owningTeam: null,
    owner: "unknown",
    acknowledgement: "unknown",
    resolution: "unknown",
    underlyingConcernStillPresent: null,
    acknowledgedAfterSeconds: null,
    acknowledgementTargetSeconds: null,
    reportIntegrity: "malformed",
  },
});

/** Grade a fixture by name. Own-property lookup only — an inherited prototype key
 *  reaching the evaluator is how `entitlement-binding` was found GRANTING for a
 *  fixture that did not exist. */
export function evaluateResponseFixture(name: string): ResponseVerdict | null {
  if (!Object.hasOwn(RESPONSE_FIXTURES, name)) return null;
  const fixture = RESPONSE_FIXTURES[name];
  return fixture ? evaluateResponse(fixture) : null;
}
