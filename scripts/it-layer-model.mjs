// The ENTERPRISE IT LAYER MODEL — which layer of IT owns each thing SignalGrid
// consumes, and WHO gets the work when a decision goes non-allow.
//
// WHY THIS EXISTS, in the owner's words: "not everyone knows their own workflows or
// what needs to be done." That is the real operational problem. An admin staring at a
// restricted workflow should not have to know whether the fault lives in identity, the
// management plane, the network, the app, or a physical dock — and today nothing in
// this repository answers that question in a form anyone can read or check.
//
// So this file answers two questions for every reason code the decision core can emit
// and every connector family on disk:
//
//     Which layer of the IT operating model does this belong to?
//     WHO fixes it?
//
// THE ONE THING THIS FILE DOES NOT DECLARE: the decision impact. The proposal that
// prompted this model included `decisionImpact` as a field to be written down per
// entry. It is deliberately NOT here, and that is the single most important design
// choice in the file: the outcome a reason code produces is already stated, once, in
// `lib/signalgrid-core/src/policy.ts`. Writing it a second time would create two
// sources of truth for the same fact, and the copy would be wrong the first time
// somebody changed a rule's outcome without changing this file. `check-it-layer-
// model.mjs` READS the outcome out of the rule set instead. A pinned number nothing
// computes goes stale silently; this repository has been bitten by that often enough
// to stop doing it on purpose.
//
// LAYER AND OWNER ARE DIFFERENT AXES, and conflating them is the mistake this model
// exists to prevent. `DEVICE_NONCOMPLIANT` is a SECURITY question — it belongs to IT
// Security & Risk Management — but the people who fix it are the ENDPOINT team. A
// model that forced one answer would either route security questions to the wrong desk
// or file endpoint work under the wrong layer. Both are how tickets die.
//
// WHAT THIS CHANGES AT RUNTIME: nothing. Like `launch-profile.mjs`, this is a declared,
// gated artifact — legible and drift-proof, but not yet wired into a decision response.
// Exposing owner routing on the wire is a real capability and a real gap; it is named
// in GAPS below rather than quietly implied.
//
// Source taxonomy: the seven-layer IT operating model (Strategic IT Management, IT
// Infrastructure, IT Security & Risk Management, Software Development & Applications,
// IT Service Development & Applications, IT Service Management, IT Operations) and its
// twenty-eight domains, recorded verbatim so a later edit is visibly an edit.

/** Bumped when a classification changes. A serial number, not a semver. */
export const IT_LAYER_MODEL_VERSION = 1;

/**
 * The seven layers, and the four domains each one owns.
 *
 * `domains` is closed on purpose: every entry below must name a domain from its own
 * layer, so "IT Operations / whatever sounded right" cannot happen.
 */
export const LAYERS = [
  {
    id: "strategic_it_management",
    name: "Strategic IT Management",
    domains: ["Governance & Oversight", "IT Strategy & Planning", "IT Policies & Standards", "IT Governance"],
    signalGridRole:
      "Supplies the policy version, the approved standard, and the risk appetite a decision is measured against. SignalGrid consumes these as the POLICY, not as evidence.",
  },
  {
    id: "it_infrastructure",
    name: "IT Infrastructure",
    domains: ["Network Management", "Server & Storage Management", "Cloud Computing", "Data Center Operations"],
    signalGridRole:
      "Answers whether the path the workflow needs actually exists right now — reachability, link usability, local network authority, egress.",
  },
  {
    id: "it_security_risk_management",
    name: "IT Security & Risk Management",
    domains: ["Cybersecurity", "Threat Detection & Response", "Identity & Access Management", "IT Risk Assessment"],
    signalGridRole:
      "Answers who the actor is, how strongly they were verified, and whether anything about the endpoint or credential is currently untrustworthy.",
  },
  {
    id: "software_development_applications",
    name: "Software Development & Applications",
    domains: ["Application Development", "Software Testing & QA", "Enterprise Applications", "DevOps & Automation"],
    signalGridRole:
      "Answers whether the application the worker is about to use is current, healthy and ready — and whether the business system behind it agrees the work is expected.",
  },
  {
    id: "it_service_development_applications",
    name: "IT Service Development & Applications",
    domains: ["Service Design", "Service Transition", "Service Catalog Management", "Service Lifecycle Management"],
    signalGridRole:
      "Answers whether the service is in a lifecycle state that supports this workflow, and which service owner a routed action belongs to.",
  },
  {
    id: "it_service_management",
    name: "IT Service Management",
    domains: ["IT Helpdesk & Support", "Incident & Problem Management", "IT Service Desk", "Service Quality & Metrics"],
    signalGridRole:
      "Answers whether a known incident or problem already explains what SignalGrid is seeing, and whether a routed action was actually acted on.",
  },
  {
    id: "it_operations",
    name: "IT Operations",
    domains: ["IT Monitoring & Maintenance", "Backup & Disaster Recovery", "IT Asset Management", "IT Automation & Scripting"],
    signalGridRole:
      "Answers whether the management answer is current, whether the asset is where it should be and intact, and whether recovery has been proven rather than assumed.",
  },
];

/**
 * The ITSM control stack, nested INSIDE the seven-layer model above.
 *
 * Four layers, six domains each, recorded verbatim. This is where a SignalGrid decision
 * stops being a verdict and becomes owned work: a ticket, an owner, a verification, a
 * restoration. See docs/SIGNALGRID_ENTERPRISE_ITSM_LAYER_MODEL.md.
 *
 * NOTE WHAT IS DELIBERATELY EMPTY. No reason code maps to `user_interface`, and that is
 * not an oversight — it is the embedded-UX law in the data. SignalGrid is invisible to
 * the worker; the host application owns the portal, the catalog, the knowledge article
 * and the accessibility of whatever the worker actually sees. A reason code appearing
 * in Layer 1 would mean SignalGrid had grown a user surface, and the gate treats that
 * as a failure rather than a feature.
 */
export const ITSM_LAYERS = [
  {
    id: "user_interface",
    name: "Layer 1 — User / Interface",
    domains: ["Service Portal", "Service Catalog", "Self-Service Knowledge", "Service Desk", "Experience Feedback", "Digital Accessibility"],
    signalGridRole:
      "NONE, deliberately. The host application owns everything the worker sees. SignalGrid returns a decision; it never renders one.",
    expectsReasonCodes: false,
  },
  {
    id: "service_delivery",
    name: "Layer 2 — Service Delivery",
    domains: ["Incident Management", "Service Requests", "Problem Management", "Change Enablement", "Service Levels", "Continual Improvement"],
    signalGridRole:
      "Where a refusal becomes a routed object: which incident, request, problem or change should carry it, and who owns that object.",
    expectsReasonCodes: true,
  },
  {
    id: "infrastructure_technology",
    name: "Layer 3 — Infrastructure / Technology",
    domains: ["Monitoring & Events", "Service Configuration", "IT Asset Management", "Cloud Operations", "Release & Deployment", "Observability & Automation"],
    signalGridRole:
      "Supplies the operational evidence a decision rests on, and the evidence that a remediation actually took.",
    expectsReasonCodes: true,
  },
  {
    id: "governance_security",
    name: "Layer 4 — Governance / Security",
    domains: ["I&T Governance", "Risk & Compliance", "Information Security", "Service Performance", "Supplier Management", "AI Governance"],
    signalGridRole:
      "Governs who may change policy, approve an exception, and judge whether a control is effective. Also where 'AI may recommend; policy decides' is enforced.",
    expectsReasonCodes: true,
  },
];

/**
 * The bridge between the two taxonomies — SEVEN rows, declared once, rather than an
 * ITSM layer written onto each of the thirty-one reason codes.
 *
 * Declaring it per code would be thirty-one chances to disagree with the IT layer
 * already recorded above. One bridge cannot disagree with itself.
 */
export const IT_TO_ITSM_LAYER = [
  { itLayer: "strategic_it_management", itsmLayer: "governance_security" },
  { itLayer: "it_security_risk_management", itsmLayer: "governance_security" },
  { itLayer: "it_infrastructure", itsmLayer: "infrastructure_technology" },
  { itLayer: "it_operations", itsmLayer: "infrastructure_technology" },
  { itLayer: "software_development_applications", itsmLayer: "service_delivery" },
  { itLayer: "it_service_development_applications", itsmLayer: "service_delivery" },
  { itLayer: "it_service_management", itsmLayer: "service_delivery" },
];

/**
 * ITSM object types a refusal can be carried by. `none` is for affirmative outcomes —
 * an allow has nothing to route, and inventing a ticket for it would be noise.
 *
 * WHICH ONE APPLIES IS DERIVED, NOT DECLARED. `check-it-layer-model.mjs` reads the
 * resolution descriptors in `lib/signalgrid-core/src/resolution.ts` and maps:
 *
 *   auto_proposed    + a transform  → service_request  (the worker can do it)
 *   requires_approval + a transform → change           (approval-gated)
 *   manual_only / no descriptor     → incident         (a human owns it)
 *   a policy-plane code             → problem          (the policy itself is the gap)
 *   an allow                        → none
 *
 * Same reasoning as `decisionImpact`: the resolution class is already stated once, and
 * a second copy here would go stale the first time a descriptor changed.
 */
export const ITSM_OBJECT_TYPES = ["incident", "problem", "change", "service_request", "none"];

/**
 * How a remediation gets proven. Also derived — from whether the descriptor carries an
 * evidence transform, which is exactly the question "can this fix be re-evaluated?"
 *
 * This is the mechanical form of the owner's requirement that a restriction must not be
 * released until the fix is verified: a `simulated_reevaluation` code can be re-run
 * against transformed evidence and shown to reach allow; a `human_evidence_required`
 * code cannot, and needs a person to attest.
 */
export const VERIFICATION_CLASSES = ["simulated_reevaluation", "human_evidence_required", "not_applicable"];

/**
 * Closed set of owner roles. Nine, because nine is what it took to cover the layers
 * without a catch-all — and a catch-all owner is the same thing as no owner.
 *
 * `facilities_operations_owner` exists because physical custody, docks and badge
 * readers are genuinely NOT the endpoint team's estate in most organisations. Routing
 * a tampered dock to endpoint operations is how it sits for a week.
 */
export const OWNER_ROLES = [
  { id: "it_governance_owner", covers: "Policy, standards, risk acceptance, exceptions." },
  { id: "network_infrastructure_owner", covers: "Network, connectivity, egress, local-network reachability." },
  { id: "identity_platform_owner", covers: "IdP, directory, federation, credential lifecycle." },
  { id: "security_operations_owner", covers: "Threat detection, response, security incidents, benchmarks." },
  { id: "endpoint_operations_owner", covers: "MDM/UEM, device compliance, posture reporting, baselines." },
  { id: "application_owner", covers: "The host or enterprise application and its own authorization." },
  { id: "service_owner", covers: "Service design, transition and lifecycle for a named service." },
  { id: "service_desk_owner", covers: "Incident, problem, request routing and response accountability." },
  { id: "facilities_operations_owner", covers: "Physical custody: docks, cases, badges, asset location." },
];

/**
 * Engine reason codes that no rule declares — `evaluatePolicy` emits them directly.
 * Named here so the gate can tell "an engine special" apart from "a code somebody
 * classified that nothing emits", which is the failure this whole file guards against.
 */
export const ENGINE_REASON_CODES = [
  { code: "NO_RULE_MATCHED_DEFAULT_STEP_UP", impact: "step_up" },
  { code: "ALLOW_SUPPRESSED_DEGRADED_EVIDENCE", impact: "restrict" },
];

/**
 * Every reason code the shipped policy can emit, classified.
 *
 * NOTE THE SPLIT that runs through this table and is the model's main practical claim:
 * a code caused by a SOURCE SYSTEM routes to that system's owner, and a code that is a
 * POLICY OUTCOME routes to whoever owns the policy. `POSTURE_STALE` is the endpoint
 * team's; `NO_RULE_MATCHED_DEFAULT_STEP_UP` is governance's. Those are different
 * conversations and they should never land in the same queue.
 */
export const REASON_CODE_LAYERS = [
  // ── Identity ──────────────────────────────────────────────────────────────
  { code: "IDENTITY_DISABLED", layer: "it_security_risk_management", domain: "Identity & Access Management", systemOfRecord: "IdP / directory", evidenceType: "identity lifecycle state", owner: "identity_platform_owner" },
  { code: "IDENTITY_STATE_UNKNOWN", layer: "it_security_risk_management", domain: "Identity & Access Management", systemOfRecord: "IdP / directory", evidenceType: "identity lifecycle state", owner: "identity_platform_owner" },
  { code: "IDENTITY_STATE_UNKNOWN_STRICT", layer: "it_security_risk_management", domain: "Identity & Access Management", systemOfRecord: "IdP / directory", evidenceType: "identity lifecycle state", owner: "identity_platform_owner" },

  // ── Device management plane ───────────────────────────────────────────────
  // Security LAYER, endpoint OWNER. See the header: these are two axes.
  { code: "DEVICE_NONCOMPLIANT", layer: "it_security_risk_management", domain: "Cybersecurity", systemOfRecord: "MDM / UEM", evidenceType: "compliance verdict", owner: "endpoint_operations_owner" },
  { code: "ENCRYPTION_REQUIRED_FOR_WORKFLOW", layer: "it_security_risk_management", domain: "Cybersecurity", systemOfRecord: "MDM / UEM", evidenceType: "encryption state", owner: "endpoint_operations_owner" },
  { code: "BASELINE_DRIFTED", layer: "it_security_risk_management", domain: "Cybersecurity", systemOfRecord: "hardening baseline tool", evidenceType: "baseline alignment", owner: "endpoint_operations_owner" },
  { code: "BASELINE_DRIFTED_STRICT", layer: "it_security_risk_management", domain: "Cybersecurity", systemOfRecord: "hardening baseline tool", evidenceType: "baseline alignment", owner: "endpoint_operations_owner" },
  { code: "DEVICE_UNMANAGED", layer: "it_operations", domain: "IT Asset Management", systemOfRecord: "MDM / UEM", evidenceType: "enrollment state", owner: "endpoint_operations_owner" },
  { code: "POSTURE_STALE", layer: "it_operations", domain: "IT Monitoring & Maintenance", systemOfRecord: "MDM / UEM", evidenceType: "posture freshness", owner: "endpoint_operations_owner" },
  { code: "POSTURE_STALE_STRICT", layer: "it_operations", domain: "IT Monitoring & Maintenance", systemOfRecord: "MDM / UEM", evidenceType: "posture freshness", owner: "endpoint_operations_owner" },
  { code: "POSTURE_MISSING", layer: "it_operations", domain: "IT Monitoring & Maintenance", systemOfRecord: "MDM / UEM", evidenceType: "posture freshness", owner: "endpoint_operations_owner" },

  // ── Risk / benchmark ──────────────────────────────────────────────────────
  { code: "CRITICAL_WORKFLOW_UNTRUSTED_DEVICE", layer: "it_security_risk_management", domain: "IT Risk Assessment", systemOfRecord: "device ownership register", evidenceType: "ownership vs workflow risk", owner: "it_governance_owner" },
  { code: "BENCHMARK_SELECTION_MISFIT", layer: "it_security_risk_management", domain: "IT Risk Assessment", systemOfRecord: "benchmark catalog", evidenceType: "benchmark applicability", owner: "security_operations_owner" },
  { code: "BENCHMARK_SELECTION_UNESTABLISHED_STRICT", layer: "it_security_risk_management", domain: "IT Risk Assessment", systemOfRecord: "benchmark catalog", evidenceType: "benchmark applicability", owner: "security_operations_owner" },

  // ── Physical custody ──────────────────────────────────────────────────────
  { code: "TAMPER_CONFIRMED", layer: "it_operations", domain: "IT Asset Management", systemOfRecord: "dock / case tamper sensor", evidenceType: "physical integrity", owner: "facilities_operations_owner" },
  { code: "TAMPER_SUSPECTED", layer: "it_operations", domain: "IT Asset Management", systemOfRecord: "dock / case tamper sensor", evidenceType: "physical integrity", owner: "facilities_operations_owner" },
  { code: "TAMPER_SENSOR_UNAVAILABLE", layer: "it_operations", domain: "IT Monitoring & Maintenance", systemOfRecord: "dock / case tamper sensor", evidenceType: "sensor reachability", owner: "facilities_operations_owner" },
  { code: "CUSTODY_OVERDUE", layer: "it_operations", domain: "IT Asset Management", systemOfRecord: "custody / DockBridge", evidenceType: "custody state", owner: "facilities_operations_owner" },
  { code: "CUSTODY_EXCEPTION", layer: "it_operations", domain: "IT Asset Management", systemOfRecord: "custody / DockBridge", evidenceType: "custody state", owner: "facilities_operations_owner" },
  { code: "CUSTODY_MAINTENANCE", layer: "it_operations", domain: "IT Asset Management", systemOfRecord: "custody / DockBridge", evidenceType: "custody state", owner: "facilities_operations_owner" },
  { code: "BATTERY_CRITICAL", layer: "it_operations", domain: "IT Asset Management", systemOfRecord: "dock telemetry", evidenceType: "charge state", owner: "facilities_operations_owner" },
  { code: "BATTERY_FAILING", layer: "it_operations", domain: "IT Asset Management", systemOfRecord: "dock telemetry", evidenceType: "battery health", owner: "facilities_operations_owner" },
  { code: "DOCK_FAULTED", layer: "it_operations", domain: "IT Monitoring & Maintenance", systemOfRecord: "SmartDock", evidenceType: "dock health", owner: "facilities_operations_owner" },
  { code: "DOCK_OFFLINE", layer: "it_operations", domain: "IT Monitoring & Maintenance", systemOfRecord: "SmartDock", evidenceType: "dock reachability", owner: "facilities_operations_owner" },
  { code: "BADGE_REMOVED", layer: "it_security_risk_management", domain: "Identity & Access Management", systemOfRecord: "badge reader case", evidenceType: "physical credential binding", owner: "facilities_operations_owner" },
  // Forced removal is a security INCIDENT, not a custody hiccup — different owner on
  // purpose. This is the one pair in the table where two neighbouring codes route to
  // different desks, and it is the clearest illustration of why the model is useful.
  { code: "BADGE_FORCED_REMOVAL", layer: "it_security_risk_management", domain: "Threat Detection & Response", systemOfRecord: "badge reader case", evidenceType: "duress / forced-removal event", owner: "security_operations_owner" },

  // ── Business / labour plane ───────────────────────────────────────────────
  { code: "SHIFT_CONTEXT_MISFIT", layer: "software_development_applications", domain: "Enterprise Applications", systemOfRecord: "workforce management", evidenceType: "shift / punch state", owner: "application_owner" },
  { code: "SHIFT_CONTEXT_UNESTABLISHED_STRICT", layer: "software_development_applications", domain: "Enterprise Applications", systemOfRecord: "workforce management", evidenceType: "shift / punch state", owner: "application_owner" },

  // ── Policy outcomes, not source faults ────────────────────────────────────
  { code: "TRUST_ESTABLISHED", layer: "strategic_it_management", domain: "IT Governance", systemOfRecord: "SignalGrid policy version", evidenceType: "policy outcome", owner: "it_governance_owner" },
  { code: "NO_RULE_MATCHED_DEFAULT_STEP_UP", layer: "strategic_it_management", domain: "IT Policies & Standards", systemOfRecord: "SignalGrid policy version", evidenceType: "policy coverage gap", owner: "it_governance_owner" },
  { code: "ALLOW_SUPPRESSED_DEGRADED_EVIDENCE", layer: "strategic_it_management", domain: "IT Governance", systemOfRecord: "SignalGrid policy version", evidenceType: "policy outcome", owner: "it_governance_owner" },
];

/**
 * Every connector family on disk, classified by the layer it draws from.
 *
 * `launchStatus` is deliberately ABSENT: `launch-profile.mjs` already owns that fact
 * for all four surfaces, and a second copy would be a second thing to keep in sync.
 * The gate cross-checks that both artifacts see the same family set instead.
 */
export const FAMILY_LAYERS = [
  // Strategic IT Management
  { family: "policy-binding", layer: "strategic_it_management", domain: "IT Policies & Standards", systemOfRecord: "MDM / IdP group assignment", evidenceType: "assignment correctness", owner: "it_governance_owner" },
  { family: "change-window", layer: "strategic_it_management", domain: "IT Governance", systemOfRecord: "change calendar", evidenceType: "change authorization window", owner: "it_governance_owner" },

  // IT Infrastructure
  { family: "carrier", layer: "it_infrastructure", domain: "Network Management", systemOfRecord: "carrier / MNO", evidenceType: "post-exit reachability", owner: "network_infrastructure_owner" },
  { family: "nac", layer: "it_infrastructure", domain: "Network Management", systemOfRecord: "NAC", evidenceType: "endpoint network identity", owner: "network_infrastructure_owner" },
  { family: "network-nac", layer: "it_infrastructure", domain: "Network Management", systemOfRecord: "NAC / 802.1X", evidenceType: "network access posture", owner: "network_infrastructure_owner" },
  { family: "link-usability", layer: "it_infrastructure", domain: "Network Management", systemOfRecord: "endpoint network stack", evidenceType: "associated vs usable link", owner: "network_infrastructure_owner" },
  { family: "sse-egress", layer: "it_infrastructure", domain: "Cloud Computing", systemOfRecord: "SSE / SWG", evidenceType: "egress path integrity", owner: "network_infrastructure_owner" },
  { family: "location-services", layer: "it_infrastructure", domain: "Network Management", systemOfRecord: "location provider", evidenceType: "geofence posture", owner: "network_infrastructure_owner" },
  { family: "local-authority", layer: "it_infrastructure", domain: "Network Management", systemOfRecord: "device local stack", evidenceType: "local/offline authority", owner: "network_infrastructure_owner" },

  // IT Security & Risk Management — identity and credential
  { family: "graph", layer: "it_security_risk_management", domain: "Identity & Access Management", systemOfRecord: "Microsoft Graph", evidenceType: "identity + device posture", owner: "identity_platform_owner" },
  { family: "identity-risk", layer: "it_security_risk_management", domain: "Identity & Access Management", systemOfRecord: "IdP risk engine", evidenceType: "sign-in risk", owner: "identity_platform_owner" },
  { family: "sso-session", layer: "it_security_risk_management", domain: "Identity & Access Management", systemOfRecord: "IdP session store", evidenceType: "session binding / attribution", owner: "identity_platform_owner" },
  { family: "platform-sso", layer: "it_security_risk_management", domain: "Identity & Access Management", systemOfRecord: "platform credential", evidenceType: "platform SSO method/policy", owner: "identity_platform_owner" },
  { family: "passkey-assurance", layer: "it_security_risk_management", domain: "Identity & Access Management", systemOfRecord: "WebAuthn registry", evidenceType: "credential worth", owner: "identity_platform_owner" },
  { family: "token-binding", layer: "it_security_risk_management", domain: "Identity & Access Management", systemOfRecord: "token issuer", evidenceType: "proof-of-possession vs bearer", owner: "identity_platform_owner" },
  { family: "oauth-consent", layer: "it_security_risk_management", domain: "Identity & Access Management", systemOfRecord: "IdP consent grants", evidenceType: "delegated/workload consent", owner: "identity_platform_owner" },
  { family: "bootstrap-credential", layer: "it_security_risk_management", domain: "Identity & Access Management", systemOfRecord: "IdP temporary pass", evidenceType: "bootstrap credential grade", owner: "identity_platform_owner" },
  { family: "credential-rotation", layer: "it_security_risk_management", domain: "Identity & Access Management", systemOfRecord: "secret store", evidenceType: "rotation currency", owner: "identity_platform_owner" },
  { family: "access-governance", layer: "it_security_risk_management", domain: "Identity & Access Management", systemOfRecord: "IGA", evidenceType: "entitlement review state", owner: "identity_platform_owner" },
  { family: "entitlement-binding", layer: "it_security_risk_management", domain: "Identity & Access Management", systemOfRecord: "IGA / directory", evidenceType: "grant reviewability", owner: "identity_platform_owner" },
  { family: "challenge-capability", layer: "it_security_risk_management", domain: "Identity & Access Management", systemOfRecord: "authenticator estate", evidenceType: "answerable step-up capability", owner: "identity_platform_owner" },
  { family: "agent-identity", layer: "it_security_risk_management", domain: "Identity & Access Management", systemOfRecord: "agent registry", evidenceType: "non-human identity", owner: "identity_platform_owner" },

  // IT Security & Risk Management — threat, endpoint security, physical
  { family: "edr-threat", layer: "it_security_risk_management", domain: "Threat Detection & Response", systemOfRecord: "EDR / EPP", evidenceType: "endpoint threat state", owner: "security_operations_owner" },
  { family: "siem", layer: "it_security_risk_management", domain: "Threat Detection & Response", systemOfRecord: "SIEM", evidenceType: "correlated security events", owner: "security_operations_owner" },
  { family: "agent-behavior", layer: "it_security_risk_management", domain: "Threat Detection & Response", systemOfRecord: "agent action log", evidenceType: "action judgment", owner: "security_operations_owner" },
  { family: "credential-exposure", layer: "it_security_risk_management", domain: "Threat Detection & Response", systemOfRecord: "secret-scanning tool", evidenceType: "endpoint secret exposure", owner: "security_operations_owner" },
  { family: "vuln-scan", layer: "it_security_risk_management", domain: "IT Risk Assessment", systemOfRecord: "vulnerability scanner", evidenceType: "device risk posture", owner: "security_operations_owner" },
  { family: "benchmark-selection", layer: "it_security_risk_management", domain: "IT Risk Assessment", systemOfRecord: "benchmark catalog", evidenceType: "benchmark applicability + currency", owner: "security_operations_owner" },
  { family: "data-protection", layer: "it_security_risk_management", domain: "Cybersecurity", systemOfRecord: "DLP", evidenceType: "data-protection posture", owner: "security_operations_owner" },
  { family: "peripheral-control", layer: "it_security_risk_management", domain: "Cybersecurity", systemOfRecord: "peripheral control", evidenceType: "removable-media posture", owner: "security_operations_owner" },
  { family: "device-attestation", layer: "it_security_risk_management", domain: "Cybersecurity", systemOfRecord: "hardware root of trust", evidenceType: "attestation verdict", owner: "security_operations_owner" },
  { family: "break-glass", layer: "it_security_risk_management", domain: "IT Risk Assessment", systemOfRecord: "host application override log", evidenceType: "override accountability", owner: "it_governance_owner" },
  { family: "pacs-access", layer: "it_security_risk_management", domain: "Identity & Access Management", systemOfRecord: "PACS controller", evidenceType: "physical access authorization", owner: "facilities_operations_owner" },

  // Software Development & Applications
  { family: "app-update", layer: "software_development_applications", domain: "Enterprise Applications", systemOfRecord: "app distribution", evidenceType: "version currency + stability", owner: "application_owner" },
  { family: "session-readiness", layer: "software_development_applications", domain: "Enterprise Applications", systemOfRecord: "host application", evidenceType: "is the app actually usable", owner: "application_owner" },
  { family: "shift-context", layer: "software_development_applications", domain: "Enterprise Applications", systemOfRecord: "workforce management", evidenceType: "shift / punch / site match", owner: "application_owner" },
  { family: "task-exception", layer: "software_development_applications", domain: "Enterprise Applications", systemOfRecord: "WMS / task plane", evidenceType: "task exception state", owner: "application_owner" },

  // IT Service Development & Applications
  { family: "service-lifecycle", layer: "it_service_development_applications", domain: "Service Lifecycle Management", systemOfRecord: "service catalog", evidenceType: "account plane vs service plane", owner: "service_owner" },

  // IT Service Management
  { family: "itsm", layer: "it_service_management", domain: "Incident & Problem Management", systemOfRecord: "ITSM", evidenceType: "ticket / incident state", owner: "service_desk_owner" },
  { family: "response-accountability", layer: "it_service_management", domain: "Service Quality & Metrics", systemOfRecord: "alert + ticket estate", evidenceType: "was the alert acted on", owner: "service_desk_owner" },

  // IT Operations
  { family: "uem", layer: "it_operations", domain: "IT Asset Management", systemOfRecord: "MDM / UEM", evidenceType: "managed-device inventory", owner: "endpoint_operations_owner" },
  { family: "device-management-health", layer: "it_operations", domain: "IT Monitoring & Maintenance", systemOfRecord: "MDM / UEM", evidenceType: "management-plane health / drift", owner: "endpoint_operations_owner" },
  { family: "macos-posture", layer: "it_operations", domain: "IT Monitoring & Maintenance", systemOfRecord: "grid-collected Mac report", evidenceType: "endpoint posture", owner: "endpoint_operations_owner" },
  { family: "ot-posture", layer: "it_operations", domain: "IT Monitoring & Maintenance", systemOfRecord: "OT/IIoT edge", evidenceType: "edge-device posture", owner: "endpoint_operations_owner" },
  { family: "rtls-custody", layer: "it_operations", domain: "IT Asset Management", systemOfRecord: "RTLS", evidenceType: "badge dwell / physical custody", owner: "facilities_operations_owner" },
  { family: "custody-beacon", layer: "it_operations", domain: "IT Asset Management", systemOfRecord: "asset beacon", evidenceType: "offline asset recovery", owner: "facilities_operations_owner" },
  { family: "observability-integrity", layer: "it_operations", domain: "IT Monitoring & Maintenance", systemOfRecord: "observability plane", evidenceType: "is that silence an observation or a gap", owner: "endpoint_operations_owner" },
  { family: "telemetry", layer: "it_operations", domain: "IT Automation & Scripting", systemOfRecord: "telemetry sink", evidenceType: "outbound telemetry emission", owner: "endpoint_operations_owner" },
  { family: "syslog", layer: "it_operations", domain: "IT Automation & Scripting", systemOfRecord: "syslog sink", evidenceType: "outbound log emission", owner: "endpoint_operations_owner" },
  { family: "webhooks", layer: "it_operations", domain: "IT Automation & Scripting", systemOfRecord: "subscriber endpoint", evidenceType: "outbound event delivery", owner: "endpoint_operations_owner" },
  { family: "caep-events", layer: "it_operations", domain: "IT Automation & Scripting", systemOfRecord: "CAEP / Shared Signals receiver", evidenceType: "outbound session signal", owner: "identity_platform_owner" },
];

/**
 * Families deliberately absent from `FAMILY_LAYERS`, with the reason.
 *
 * The gate treats this as the ONLY acceptable way for a directory under
 * `lib/integrations/src/integrations/` to be unclassified. Silence is not.
 */
export const NOT_A_FAMILY = [
  { dir: "adapters", reason: "Fusion adapters into posture-composition, not a source family — it draws from no system of record of its own." },
];

/** Named so a reader is not left to infer the boundary from what is missing. */
export const GAPS = [
  {
    id: "owner-routing-not-on-the-wire",
    whatIsMissing:
      "This model classifies reason codes and families, but no /v1 response carries the owner or IT layer yet. An operator still reads the reason code and decides who to call. Closing it means adding fields to the decision response — real value, real API surface, and deliberately not done inside the launch spine's freeze.",
  },
  {
    id: "layer-coverage-is-not-evenness",
    whatIsMissing:
      "Every layer has at least one family, which is NOT the same as every layer being well covered. Service Development has one family; Strategic IT Management has two. The model shows where SignalGrid is thin, and this entry exists so a green gate is not read as balanced coverage.",
  },
];
