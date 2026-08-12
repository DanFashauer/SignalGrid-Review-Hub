// Service-lifecycle family — public surface, the live-call gate, one grounded
// normalizer, and the fixture corpus.
//
// Under connector discipline from birth: tier gate + SIGNALGRID_LIVE_INTEGRATIONS
// + credential + injected transport, fixtures, proof, and no network primitive
// anywhere in the family.

import { evaluateServiceLifecycle } from "./evaluate";
import type {
  AssignmentOrder,
  LifecycleClosureState,
  NormalizedServiceLifecycle,
  ProvisioningState,
  ServiceAssignmentState,
  ServiceLifecycleVerdict,
} from "./types";

export * from "./types";
export { evaluateServiceLifecycle } from "./evaluate";

/** A read transport. Deliberately NOT implemented in this repository. */
export interface ServiceLifecycleReadTransport {
  readServiceLifecycle(principalId: string): Promise<unknown>;
}

export type ServiceLifecycleResolution =
  | { readonly mode: "fixture"; readonly reason: string }
  | { readonly mode: "live"; readonly transport: ServiceLifecycleReadTransport };

/**
 * Decide whether this deployment may make a live licensing-plane read.
 *
 * Fail-closed and unanimous: every condition must hold, and any one failing
 * returns fixture mode naming the specific cause. The transport must be
 * INJECTED and this repository ships none, so the gate's failure mode is "there
 * is no code" rather than "a flag was set correctly".
 */
export function resolveServiceLifecycleConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: ServiceLifecycleReadTransport,
): ServiceLifecycleResolution {
  const tier = (env["SIGNALGRID_TIER"] ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env["SIGNALGRID_LIVE_INTEGRATIONS"] !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  // ENTRA ONLY, and not for want of ambition. On-premises Active Directory has
  // no service-plan plane at all: there is no `assignedPlans`, no
  // `provisionedPlans`, and no `employeeLeaveDateTime`. Accepting
  // `active-directory` here and then normalizing nothing would ship a gate that
  // configures cleanly for a directory this dimension cannot read.
  const directory = (env["SERVICE_LIFECYCLE_DIRECTORY"] ?? "").trim().toLowerCase();
  if (directory !== "entra") {
    return { mode: "fixture", reason: "SERVICE_LIFECYCLE_DIRECTORY is not 'entra'" };
  }
  if (!env["SERVICE_LIFECYCLE_ACCESS_TOKEN"]?.trim()) {
    return { mode: "fixture", reason: "SERVICE_LIFECYCLE_ACCESS_TOKEN is not set" };
  }
  if (!transportOverride) {
    return {
      mode: "fixture",
      reason: "no service-lifecycle read transport is available — this repository ships none",
    };
  }
  return { mode: "live", transport: transportOverride };
}

/** The subset of a Microsoft Graph `user` read this normalizer understands.
 *
 *  EVERY FIELD IS A REAL GRAPH FIELD, none invented. `assignedPlans` carries
 *  `assignedDateTime` and `capabilityStatus` per plan; `provisionedPlans`
 *  carries `provisioningStatus`; `employeeLeaveDateTime` and `employeeHireDate`
 *  are first-class user properties. Those four are exactly the inputs this
 *  dimension needs, and they supply both instants — so the ordering question is
 *  answered without a clock anywhere in the path.
 *
 *  Everything is optional: a directory is an EXTERNAL system and may omit or
 *  mangle any slot. */
export interface GraphServiceLifecyclePayload {
  readonly id?: unknown;
  /** Graph `assignedPlans`: [{ assignedDateTime, capabilityStatus, service, servicePlanId }] */
  readonly assignedPlans?: unknown;
  /** Graph `provisionedPlans`: [{ capabilityStatus, provisioningStatus, service }] */
  readonly provisionedPlans?: unknown;
  /** Graph `employeeLeaveDateTime` — the recorded lifecycle closure. */
  readonly employeeLeaveDateTime?: unknown;
  /** Graph `employeeHireDate` — a hire AFTER a leave date is a rehire, which is
   *  the discriminator that stops this dimension calling every returning
   *  employee a re-armed account. */
  readonly employeeHireDate?: unknown;
}

const asString = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

/** Strict ISO-8601 UTC. A local-time string, an epoch number, or a
 *  `Date`-parseable-but-ambiguous spelling are NOT a confirmed instant —
 *  accepting them is how a junk payload becomes a confident ordering. */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;

/** `null` = not asserted. `"malformed"` = asserted and unreadable. Those two are
 *  different claims and the evaluator grades them differently. */
function asInstant(v: unknown): number | null | "malformed" {
  if (v === undefined || v === null) return null;
  const s = asString(v);
  if (s === null || !ISO_UTC.test(s)) return "malformed";
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : "malformed";
}

/** Graph `capabilityStatus` values that mean the plan is LIVE for the user.
 *  `Deleted` and `Suspended` are not. An unrecognised spelling is neither —
 *  see `readAssignment`. */
const LIVE_CAPABILITY = new Set(["enabled", "warning"]);
const DEAD_CAPABILITY = new Set(["deleted", "suspended", "lockedout"]);

interface AssignmentRead {
  readonly state: ServiceAssignmentState;
  /** Latest live-plan assignment instant. */
  readonly latest: number | null | "malformed";
}

/**
 * Read `assignedPlans` into a state plus the latest live assignment instant.
 *
 * THE ABSENT-COLLECTION LAW IS ENFORCED HERE and it is the load-bearing line of
 * this file. A MISSING `assignedPlans` key is `unknown`. A PRESENT array is a
 * positive enumeration, so an empty one is a real `none_assigned`.
 *
 * And one entry this normalizer cannot classify makes the whole answer
 * `unknown`, not `none_assigned`. That is the fail-closed direction for THIS
 * axis: `none_assigned` is an affirmative finding (the stripped contradiction),
 * and a garbled feed must never be able to manufacture one.
 */
function readAssignment(raw: unknown): AssignmentRead {
  if (!Array.isArray(raw)) return { state: "unknown", latest: null };

  let live = 0;
  let unreadable = false;
  let latest: number | null | "malformed" = null;

  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      unreadable = true;
      continue;
    }
    // Coalesced to "" rather than guarded with an explicit null/undefined branch.
    // The mutation sweep survived that branch: an absent status already lands on
    // the allowlist check below and sets `unreadable` there, so the extra branch
    // was a second door onto the same room. Deleted rather than exempted — the
    // empty string is in neither set, which is the same answer arrived at once.
    const status = (asString((entry as Record<string, unknown>)["capabilityStatus"]) ?? "").toLowerCase();
    if (DEAD_CAPABILITY.has(status)) continue;
    if (!LIVE_CAPABILITY.has(status)) {
      unreadable = true;
      continue;
    }
    live += 1;
    const at = asInstant((entry as Record<string, unknown>)["assignedDateTime"]);
    if (at === "malformed") {
      latest = "malformed";
    } else if (at !== null && latest !== "malformed") {
      latest = latest === null ? at : Math.max(latest, at);
    }
  }

  if (unreadable) return { state: "unknown", latest };
  return { state: live > 0 ? "assigned" : "none_assigned", latest: live > 0 ? latest : null };
}

/** Graph `provisioningStatus` → the carried-but-never-graded provisioning axis. */
function readProvisioning(raw: unknown): ProvisioningState {
  if (!Array.isArray(raw) || raw.length === 0) return "unknown";
  let sawSuccess = false;
  let sawPending = false;
  let sawFailure = false;
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return "unknown";
    const s = asString((entry as Record<string, unknown>)["provisioningStatus"])?.toLowerCase();
    if (s === undefined || s === null) return "unknown";
    if (s === "success") sawSuccess = true;
    else if (s.startsWith("pending")) sawPending = true;
    else if (s === "disabled" || s === "error") sawFailure = true;
    else return "unknown";
  }
  if (sawFailure) return "failed";
  if (sawPending) return "pending";
  return sawSuccess ? "provisioned" : "unknown";
}

/**
 * Normalize a Graph-shaped user read. Pure — no clock, no I/O, no throwing.
 *
 * `accountPlane` and `planeReporting` are PARAMETERS rather than payload fields,
 * and deliberately so. Both are facts about the CALLER'S deployment — what the
 * account plane reported, and whether a licensing bridge answered at all — and a
 * directory has no standing to tell us either. Letting the payload carry them
 * would hand the subject of the verdict a vote on its own suppression.
 */
export function normalizeGraphServiceLifecycle(
  raw: GraphServiceLifecyclePayload,
  options: {
    readonly accountPlane?: NormalizedServiceLifecycle["accountPlane"];
    readonly planeReporting?: NormalizedServiceLifecycle["planeReporting"];
  } = {},
): NormalizedServiceLifecycle {
  const accountPlane = options.accountPlane ?? "unposed";
  const planeReporting = options.planeReporting ?? "reported";

  const principalId = asString(raw?.id);
  if (principalId === null) {
    // No identifiable subject. Reported malformed rather than normalized into a
    // pile of unknowns, because a verdict about nobody is not a verdict.
    return {
      principalId: "",
      planeReporting,
      assignment: "unknown",
      closure: "unknown",
      closureSuperseded: null,
      assignmentOrder: "not_comparable",
      provisioning: "unknown",
      accountPlane,
      reportIntegrity: "malformed",
    };
  }

  const assignment = readAssignment(raw.assignedPlans);
  const leave = asInstant(raw.employeeLeaveDateTime);
  const hire = asInstant(raw.employeeHireDate);

  // A closure that was ASSERTED and could not be read is `unknown`, not
  // `recorded`: claiming a departure exists on the strength of an unparseable
  // value would assert the fact the value failed to carry.
  const closure: LifecycleClosureState =
    leave === "malformed" ? "unknown" : leave === null ? "none_recorded" : "recorded";

  // Supersession is only meaningful against a readable closure, and only a
  // readable hire date can answer it. Anything else is `null` — which forecloses
  // the benign rehire reading without asserting the hostile one.
  const closureSuperseded: boolean | null =
    typeof leave === "number" && typeof hire === "number" ? hire > leave : null;

  const assignmentOrder: AssignmentOrder =
    // Ordering is defined relative to a recorded closure. Without one there is
    // nothing to be before or after — and the evaluator's coherence rule treats
    // any other answer here as a self-contradicting report.
    closure !== "recorded"
      ? leave === "malformed" || assignment.latest === "malformed"
        ? "malformed"
        : "not_comparable"
      : assignment.latest === "malformed"
        ? "malformed"
        : assignment.latest === null
          ? "not_comparable"
          : assignment.latest > (leave as number)
            ? "after_closure"
            : "before_closure";

  return {
    principalId,
    planeReporting,
    assignment: assignment.state,
    closure,
    closureSuperseded,
    assignmentOrder,
    provisioning: readProvisioning(raw.provisionedPlans),
    accountPlane,
    reportIntegrity: "intact",
  };
}

/** Canonical read contract, exported so the gate and any future live transport
 *  share ONE definition. Nothing here performs a request. */
export const SERVICE_LIFECYCLE_READ_CONTRACT = {
  graphUserPath: "/v1.0/users",
  graphSelect: [
    "id",
    "assignedPlans",
    "provisionedPlans",
    "employeeLeaveDateTime",
    "employeeHireDate",
  ],
  /** `employeeLeaveDateTime` requires the `User-LifeCycleInfo.Read.All` scope in
   *  addition to `User.Read.All` — stated because a deployment that grants only
   *  the latter gets a silently absent closure, which this dimension reads as
   *  `none_recorded` and would grade as the stripped contradiction. A permission
   *  gap must not present as a lifecycle finding. */
  requiredScopes: ["User.Read.All", "User-LifeCycleInfo.Read.All"],
  activeDirectorySupported: false,
} as const;

/** Fixture states — the deterministic corpus this repository runs on. Each names
 *  the real-world shape it stands for. */
export const SERVICE_LIFECYCLE_FIXTURES: Readonly<
  Record<string, NormalizedServiceLifecycle>
> = Object.freeze({
  /** The ordinary case: live entitlements, nobody has left. */
  "consistent-current-employee": {
    principalId: "fixture-principal-1",
    planeReporting: "reported",
    assignment: "assigned",
    closure: "none_recorded",
    closureSuperseded: null,
    assignmentOrder: "not_comparable",
    provisioning: "provisioned",
    accountPlane: "clean",
    reportIntegrity: "intact",
  },
  /** THE CONTRADICTION. Every service plan reclaimed; no departure recorded
   *  anywhere; the account plane positively says it sees nothing wrong. */
  "stripped-while-account-plane-clean": {
    principalId: "fixture-principal-2",
    planeReporting: "reported",
    assignment: "none_assigned",
    closure: "none_recorded",
    closureSuperseded: null,
    assignmentOrder: "not_comparable",
    provisioning: "unknown",
    accountPlane: "clean",
    reportIntegrity: "intact",
  },
  /** The re-licensed leaver: someone assigned a service plan AFTER the recorded
   *  departure, and no rehire explains it. */
  "re-armed-after-departure": {
    principalId: "fixture-principal-3",
    planeReporting: "reported",
    assignment: "assigned",
    closure: "recorded",
    closureSuperseded: false,
    assignmentOrder: "after_closure",
    provisioning: "provisioned",
    accountPlane: "clean",
    reportIntegrity: "intact",
  },
  /** The same ordering, explained: a rehire. Ordinary life, graded as such. */
  "rehire-reassigned": {
    principalId: "fixture-principal-4",
    planeReporting: "reported",
    assignment: "assigned",
    closure: "recorded",
    closureSuperseded: true,
    assignmentOrder: "after_closure",
    provisioning: "provisioned",
    accountPlane: "clean",
    reportIntegrity: "intact",
  },
  /** Entitlements minted before the departure and never reclaimed — the passive
   *  half-finished offboarding, caught in the window before the IGA plane
   *  notices. */
  "entitlements-outlived-departure": {
    principalId: "fixture-principal-5",
    planeReporting: "reported",
    assignment: "assigned",
    closure: "recorded",
    closureSuperseded: false,
    assignmentOrder: "before_closure",
    provisioning: "provisioned",
    accountPlane: "clean",
    reportIntegrity: "intact",
  },
  /** A completed offboarding: entitlements gone, departure recorded. What right
   *  looks like. */
  "completed-offboarding": {
    principalId: "fixture-principal-6",
    planeReporting: "reported",
    assignment: "none_assigned",
    closure: "recorded",
    closureSuperseded: false,
    assignmentOrder: "not_comparable",
    provisioning: "unknown",
    accountPlane: "clean",
    reportIntegrity: "intact",
  },
  /** The dominance case: `access-governance` already carries a lifecycle
   *  concern, so this dimension stands down rather than emitting a second,
   *  weaker verdict on the same fact. */
  "account-plane-already-authoritative": {
    principalId: "fixture-principal-7",
    planeReporting: "reported",
    assignment: "none_assigned",
    closure: "none_recorded",
    closureSuperseded: null,
    assignmentOrder: "not_comparable",
    provisioning: "unknown",
    accountPlane: "lifecycle_concern",
    reportIntegrity: "intact",
  },
  /** No licensing bridge in this deployment. A COVERAGE state — kept as a
   *  fixture because "unassessed" and "consistent" must stay visibly different
   *  things. */
  "no-service-plane": {
    principalId: "fixture-principal-8",
    planeReporting: "not_reported",
    assignment: "unknown",
    closure: "unknown",
    closureSuperseded: null,
    assignmentOrder: "not_comparable",
    provisioning: "unknown",
    accountPlane: "unposed",
    reportIntegrity: "intact",
  },
  /** A departure IS recorded and entitlements ARE live, but the comparison that
   *  would say whether they post-date it cannot be made. */
  "reassignment-check-blinded": {
    principalId: "fixture-principal-9",
    planeReporting: "reported",
    assignment: "assigned",
    closure: "recorded",
    closureSuperseded: false,
    assignmentOrder: "not_comparable",
    provisioning: "pending",
    accountPlane: "clean",
    reportIntegrity: "intact",
  },
  unreadable: {
    principalId: "",
    planeReporting: "reported",
    assignment: "unknown",
    closure: "unknown",
    closureSuperseded: null,
    assignmentOrder: "not_comparable",
    provisioning: "unknown",
    accountPlane: "unposed",
    reportIntegrity: "malformed",
  },
});

/** Grade a fixture by name. Returns null for an unknown fixture rather than
 *  inventing one.
 *
 *  OWN-PROPERTY LOOKUP ONLY — the sibling family shipped a version that resolved
 *  inherited `Object.prototype` keys, so `evaluate…Fixture("constructor")`
 *  handed the `Object` function to the evaluator and every field read
 *  `undefined`, which fell straight through to the clean verdict. A lookup for a
 *  fixture that does not exist GRANTED. */
export function evaluateServiceLifecycleFixture(name: string): ServiceLifecycleVerdict | null {
  if (!Object.hasOwn(SERVICE_LIFECYCLE_FIXTURES, name)) return null;
  const fixture = SERVICE_LIFECYCLE_FIXTURES[name];
  return fixture ? evaluateServiceLifecycle(fixture) : null;
}
