// Entitlement-binding family — public surface, the live-call gate, and one
// grounded normalizer.
//
// Under connector discipline from birth, not retrofitted: tier gate +
// SIGNALGRID_LIVE_INTEGRATIONS + credential + injected transport, fixture corpus,
// proof, and no network primitive anywhere in the family. That is the standard the
// uem/ and nac/ families had to be dragged up to; a new family should not need
// dragging.

import { evaluateEntitlementBinding } from "./evaluate";
import type {
  BindingMechanism,
  CarrierOwnerState,
  CarrierType,
  EntitlementBindingVerdict,
  NormalizedEntitlementBinding,
} from "./types";

export * from "./types";
export { evaluateEntitlementBinding } from "./evaluate";

/** A read transport. Deliberately NOT implemented in this repository. */
export interface EntitlementBindingReadTransport {
  readBinding(principalId: string): Promise<unknown>;
}

export type EntitlementBindingResolution =
  | { readonly mode: "fixture"; readonly reason: string }
  | { readonly mode: "live"; readonly transport: EntitlementBindingReadTransport };

/**
 * Decide whether this deployment may make a live directory read.
 *
 * Fail-closed and unanimous: every condition must hold, and any one failing returns
 * fixture mode naming the specific cause. The transport must be INJECTED and this
 * repository ships none, so the gate's failure mode is "there is no code" rather
 * than "a flag was set correctly" — a stronger guarantee, and the same shape as
 * `resolveUemConnector` / `resolveNacConnector`.
 */
export function resolveEntitlementBindingConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: EntitlementBindingReadTransport,
): EntitlementBindingResolution {
  const tier = (env["SIGNALGRID_TIER"] ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env["SIGNALGRID_LIVE_INTEGRATIONS"] !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  const directory = (env["ENTITLEMENT_DIRECTORY"] ?? "").trim().toLowerCase();
  if (directory !== "entra" && directory !== "active-directory") {
    return {
      mode: "fixture",
      reason: "ENTITLEMENT_DIRECTORY is not one of entra|active-directory",
    };
  }
  if (!env["ENTITLEMENT_ACCESS_TOKEN"]?.trim()) {
    return { mode: "fixture", reason: "ENTITLEMENT_ACCESS_TOKEN is not set" };
  }
  if (!transportOverride) {
    return {
      mode: "fixture",
      reason: "no entitlement read transport is available — this repository ships none",
    };
  }
  return { mode: "live", transport: transportOverride };
}

/** The subset of a Microsoft Graph directory read this normalizer understands.
 *
 *  GROUNDED IN REAL FIELDS, not invented ones. Graph's `group` resource carries
 *  `securityEnabled` and `mailEnabled` as separate booleans, and that pair is
 *  exactly the discriminator this dimension needs. `owners` is a real navigation
 *  property. `principalType` on a role assignment distinguishes a grant made to a
 *  user from one made to a group.
 *
 *  Everything is optional: a directory is an EXTERNAL system and may omit or
 *  mangle any slot. */
export interface GraphBindingPayload {
  readonly principalId?: unknown;
  /** Graph role-assignment `principalType`: "User" | "Group" | "ServicePrincipal". */
  readonly principalType?: unknown;
  readonly group?: {
    readonly securityEnabled?: unknown;
    readonly mailEnabled?: unknown;
    /** Count of owners. A COUNT, supplied by the caller — this normalizer does not
     *  expand a navigation property, because that would be a second network read. */
    readonly ownerCount?: unknown;
  };
  /** Hops from principal to the group carrying the permission, counted by the caller. */
  readonly nestingDepth?: unknown;
}

const asString = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

/** Strict boolean read. A string "true", a 1, or an inherited property are NOT a
 *  confirmed boolean — treating them as one is how a junk payload becomes a
 *  confident answer. Same discipline as `asBool` in jamf.ts. */
const asBool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

/** Non-negative integer, or null. A negative or fractional hop count is not a
 *  smaller number — it is a broken report, and it must not compare as shallow. */
const asCount = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;

/**
 * Normalize a Graph-shaped binding report. Pure — no clock, no I/O, no throwing.
 *
 * `nestingDepthBudget` is a PARAMETER rather than a payload field: it is operator
 * policy, and a directory has no business telling us how much nesting we tolerate.
 */
export function normalizeGraphBinding(
  raw: GraphBindingPayload,
  nestingDepthBudget: number | null = null,
): NormalizedEntitlementBinding {
  const principalId = asString(raw?.principalId);
  if (principalId === null) {
    // No identifiable subject. Reported malformed rather than normalized into a pile
    // of unknowns, because a verdict about nobody is not a verdict.
    return {
      principalId: "",
      mechanism: "unknown",
      carrier: "unknown",
      carrierOwner: "unknown",
      nestingDepth: null,
      nestingDepthBudget,
      reportIntegrity: "malformed",
    };
  }

  const principalType = asString(raw.principalType)?.toLowerCase();
  const mechanism: BindingMechanism =
    principalType === "group"
      ? "group"
      : principalType === "user" || principalType === "serviceprincipal"
        ? // A role assignment whose principal IS the user or service account: the
          // permission is pinned to the identity, with no group in between.
          "direct_to_principal"
        : "unknown";

  // A direct binding has no carrier and no carrier owner. `not_applicable` is the
  // honest reading — distinct from `unknown`, which would claim we failed to read
  // something that does not exist.
  if (mechanism === "direct_to_principal") {
    return {
      principalId,
      mechanism,
      carrier: "not_applicable",
      carrierOwner: "not_applicable",
      nestingDepth: null,
      nestingDepthBudget,
      reportIntegrity: "intact",
    };
  }

  const securityEnabled = asBool(raw.group?.securityEnabled);
  const mailEnabled = asBool(raw.group?.mailEnabled);
  const carrier: CarrierType =
    securityEnabled === true && mailEnabled === true
      ? "mail_enabled_security_group"
      : securityEnabled === true && mailEnabled === false
        ? "security_group"
        : securityEnabled === false && mailEnabled === true
          ? "distribution_group"
          : // Either flag unread, or both false (a Microsoft 365 group shape this
            // normalizer does not claim to grade). Unknown, never a pass.
            "unknown";

  const ownerCount = asCount(raw.group?.ownerCount);
  const carrierOwner: CarrierOwnerState =
    ownerCount === null ? "unknown" : ownerCount > 0 ? "owner_assigned" : "ownerless";

  return {
    principalId,
    mechanism,
    carrier,
    carrierOwner,
    nestingDepth: asCount(raw.nestingDepth),
    nestingDepthBudget,
    reportIntegrity: "intact",
  };
}

/** Canonical read contract, exported so the gate and any future live transport share
 *  ONE definition. Nothing here performs a request.
 *
 *  ON-PREM ACTIVE DIRECTORY IS NOT COVERED by `normalizeGraphBinding`. AD exposes
 *  this through LDAP/ADSI attributes (`groupType` bit flags, `managedBy`,
 *  `tokenGroups`), not through these fields. `ENTITLEMENT_DIRECTORY` accepts
 *  `active-directory` so the gate can be configured for it, but a reader would have
 *  to be written — and stating that is better than shipping a Graph normalizer
 *  quietly mislabelled as vendor-neutral. */
export const ENTITLEMENT_BINDING_READ_CONTRACT = {
  graphRoleAssignmentPath: "/v1.0/roleManagement/directory/roleAssignments",
  graphGroupPath: "/v1.0/groups",
  /** Graph's own discriminator pair. */
  carrierDiscriminator: ["securityEnabled", "mailEnabled"],
  activeDirectorySupported: false,
} as const;

/** Fixture bindings — the deterministic corpus this repository runs on. Each names
 *  the real-world shape it stands for. */
export const ENTITLEMENT_BINDING_FIXTURES: Readonly<
  Record<string, NormalizedEntitlementBinding>
> = Object.freeze({
  /** The correct case: a security group, owned, one hop away. */
  "governable-security-group": {
    principalId: "fixture-principal-1",
    mechanism: "group",
    carrier: "security_group",
    carrierOwner: "owner_assigned",
    nestingDepth: 1,
    nestingDepthBudget: 3,
    reportIntegrity: "intact",
  },
  /** The direct ACE added during an incident and never removed. Correct-looking to
   *  access-governance, invisible to every group-based review. */
  "direct-to-user": {
    principalId: "fixture-principal-2",
    mechanism: "direct_to_principal",
    carrier: "not_applicable",
    carrierOwner: "not_applicable",
    nestingDepth: null,
    nestingDepthBudget: 3,
    reportIntegrity: "intact",
  },
  /** A mail object carrying authorization. */
  "distribution-group-carrying-permissions": {
    principalId: "fixture-principal-3",
    mechanism: "group",
    carrier: "distribution_group",
    carrierOwner: "owner_assigned",
    nestingDepth: 1,
    nestingDepthBudget: 3,
    reportIntegrity: "intact",
  },
  /** Reviewable in principle; nobody accountable. */
  "ownerless-group": {
    principalId: "fixture-principal-4",
    mechanism: "group",
    carrier: "security_group",
    carrierOwner: "ownerless",
    nestingDepth: 1,
    nestingDepthBudget: 3,
    reportIntegrity: "intact",
  },
  /** Everything right except the trace: five hops against a budget of three. */
  "deeply-nested": {
    principalId: "fixture-principal-5",
    mechanism: "group",
    carrier: "security_group",
    carrierOwner: "owner_assigned",
    nestingDepth: 5,
    nestingDepthBudget: 3,
    reportIntegrity: "intact",
  },
  /** A mail-enabled security group — governable, and asserted so, because grading it
   *  as a concern would be enforcing naming hygiene through a runtime gate. */
  "mail-enabled-security-group": {
    principalId: "fixture-principal-6",
    mechanism: "group",
    carrier: "mail_enabled_security_group",
    carrierOwner: "owner_assigned",
    nestingDepth: 2,
    nestingDepthBudget: 3,
    reportIntegrity: "intact",
  },
  /** A report that contradicts itself: a group carries the permission, yet the
   *  question of who owns that group is claimed inapplicable. Kept as a fixture
   *  because this is the combination that leaked through the first version of the
   *  evaluator as GOVERNABLE, and a fixture keeps the coherence path exercised by
   *  something a reader can look at. */
  "incoherent-group-without-owner-concept": {
    principalId: "fixture-principal-7",
    mechanism: "group",
    carrier: "security_group",
    carrierOwner: "not_applicable",
    nestingDepth: 1,
    nestingDepthBudget: 3,
    reportIntegrity: "intact",
  },
  unreadable: {
    principalId: "",
    mechanism: "unknown",
    carrier: "unknown",
    carrierOwner: "unknown",
    nestingDepth: null,
    nestingDepthBudget: null,
    reportIntegrity: "malformed",
  },
});

/** Grade a fixture by name. Returns null for an unknown fixture rather than
 *  inventing one. */
export function evaluateEntitlementBindingFixture(
  name: string,
): EntitlementBindingVerdict | null {
  const fixture = ENTITLEMENT_BINDING_FIXTURES[name];
  return fixture ? evaluateEntitlementBinding(fixture) : null;
}
