/**
 * Route-owner mirror of `scripts/it-layer-model.mjs` (launch wireframe screen 3:
 * "the operator should see who picks this up").
 *
 * WHY A MIRROR EXISTS AT ALL: the IT-layer model deliberately puts owner routing
 * on no wire — exposing it in a /v1 response is a named gap there, not an
 * oversight — so a console that wants to show the owner of a refusal has to
 * carry the classification itself. A hand copy of a table goes stale the first
 * time the model reclassifies a code, which is why `check-it-layer-model.mjs`
 * parses THIS file and fails the build unless every entry matches the model in
 * both directions: every classified code is mirrored, every mirrored code is
 * classified, and the owner agrees. Edit the model first; this file follows.
 */

/**
 * The model's closed set of owner roles, with console display labels. A role's
 * "covers" names the org domain that OWNS a refusal — including deferred
 * reason-code families such as physical custody and tamper — not a capability
 * SignalGrid evaluates today.
 */
export const OWNER_ROLE_LABELS: Record<string, { label: string; covers: string }> = {
  it_governance_owner: { label: "IT governance", covers: "Policy, standards, risk acceptance, exceptions." },
  network_infrastructure_owner: { label: "Network infrastructure", covers: "Network, connectivity, egress, local-network reachability." },
  identity_platform_owner: { label: "Identity platform", covers: "IdP, directory, federation, credential lifecycle." },
  security_operations_owner: { label: "Security operations", covers: "Threat detection, response, security incidents, benchmarks." },
  endpoint_operations_owner: { label: "Endpoint operations", covers: "MDM/UEM, device compliance, posture reporting, baselines." },
  application_owner: { label: "Application owner", covers: "The host or enterprise application and its own authorization." },
  service_owner: { label: "Service owner", covers: "Service design, transition and lifecycle for a named service." },
  service_desk_owner: { label: "Service desk", covers: "Incident, problem, request routing and response accountability." },
  facilities_operations_owner: { label: "Facilities operations", covers: "Physical custody: docks, cases, badges, asset location." },
};

/** reason code → owner role id, mirrored from REASON_CODE_LAYERS. */
export const ROUTE_OWNER_BY_REASON_CODE: Record<string, string> = {
  IDENTITY_DISABLED: "identity_platform_owner",
  IDENTITY_STATE_UNKNOWN: "identity_platform_owner",
  IDENTITY_STATE_UNKNOWN_STRICT: "identity_platform_owner",
  DEVICE_NONCOMPLIANT: "endpoint_operations_owner",
  ENCRYPTION_REQUIRED_FOR_WORKFLOW: "endpoint_operations_owner",
  BASELINE_DRIFTED: "endpoint_operations_owner",
  BASELINE_DRIFTED_STRICT: "endpoint_operations_owner",
  DEVICE_UNMANAGED: "endpoint_operations_owner",
  POSTURE_STALE: "endpoint_operations_owner",
  POSTURE_STALE_STRICT: "endpoint_operations_owner",
  POSTURE_MISSING: "endpoint_operations_owner",
  MANAGEMENT_HEALTH_BROKEN: "endpoint_operations_owner",
  LOCAL_AUTHORITY_WITHHELD: "it_governance_owner",
  CRITICAL_WORKFLOW_UNTRUSTED_DEVICE: "it_governance_owner",
  BENCHMARK_SELECTION_MISFIT: "security_operations_owner",
  BENCHMARK_SELECTION_UNESTABLISHED_STRICT: "security_operations_owner",
  TAMPER_CONFIRMED: "facilities_operations_owner",
  TAMPER_SUSPECTED: "facilities_operations_owner",
  TAMPER_SENSOR_UNAVAILABLE: "facilities_operations_owner",
  CUSTODY_OVERDUE: "facilities_operations_owner",
  CUSTODY_EXCEPTION: "facilities_operations_owner",
  CUSTODY_MAINTENANCE: "facilities_operations_owner",
  BATTERY_CRITICAL: "facilities_operations_owner",
  BATTERY_FAILING: "facilities_operations_owner",
  DOCK_FAULTED: "facilities_operations_owner",
  DOCK_OFFLINE: "facilities_operations_owner",
  BADGE_REMOVED: "facilities_operations_owner",
  BADGE_FORCED_REMOVAL: "security_operations_owner",
  SHIFT_CONTEXT_MISFIT: "application_owner",
  SHIFT_CONTEXT_UNESTABLISHED_STRICT: "application_owner",
  TRUST_ESTABLISHED: "it_governance_owner",
  NO_RULE_MATCHED_DEFAULT_STEP_UP: "it_governance_owner",
  ALLOW_SUPPRESSED_DEGRADED_EVIDENCE: "it_governance_owner",
};

/**
 * Unique owners for a decision's reason codes. An unmapped code is returned as
 * such — shown honestly rather than dropped, because a refusal with nobody to
 * route it to is exactly the state the IT-layer model exists to prevent.
 */
export function routeOwnersFor(reasonCodes: string[]): {
  owners: Array<{ id: string; label: string; covers: string }>;
  unclassified: string[];
} {
  const seen = new Set<string>();
  const owners: Array<{ id: string; label: string; covers: string }> = [];
  const unclassified: string[] = [];
  for (const code of reasonCodes) {
    const ownerId = ROUTE_OWNER_BY_REASON_CODE[code];
    if (!ownerId) {
      unclassified.push(code);
      continue;
    }
    if (seen.has(ownerId)) continue;
    seen.add(ownerId);
    const role = OWNER_ROLE_LABELS[ownerId];
    owners.push({ id: ownerId, label: role?.label ?? ownerId, covers: role?.covers ?? "" });
  }
  return { owners, unclassified };
}
