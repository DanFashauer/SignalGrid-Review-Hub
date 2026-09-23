import type { SimulatorScenario } from "./types";

const observedAt = "2026-06-09T14:00:00.000Z";

export const simulatorScenarios: SimulatorScenario[] = [
  {
    id: "apple-ddm-platform-sso-state",
    title: "Apple DDM and Platform SSO state",
    summary: "Apple declared state, Platform SSO status, and audit events are consumed as evidence for a managed shared-device workflow.",
    persona: "Apple mobility admin validating shared-use readiness",
    expectedOutcomes: ["allow", "record_audit"],
    expectedOwnerTeam: "Apple mobility operations",
    safeDemoNote: "Apple DDM, Platform SSO, and audit events are fixture signals only. SignalGrid consumes state and evidence; it does not replace Apple, Jamf, Intune, Kandji, Mosyle, or Workspace ONE.",
    startingSignals: [
      signal("identity.authenticated", "identity", "Platform SSO fixture", "user:rn-144", "info", "Shared-use user authenticated through Platform SSO fixture", { ssoStatus: "active", touchIdPolicy: "satisfied" }),
      signal("apple.ddm_declared_state", "device_state_compliance", "Apple DDM fixture", "device:ios-shared-018", "info", "Declared device state reports configuration and compliance as current", { declaredState: "current", configurationStatus: "applied", compliance: "compliant" }),
      signal("apple.platform_sso_status", "device_state_compliance", "Apple Platform SSO fixture", "device:ios-shared-018", "info", "Platform SSO session is active for shared-use workflow", { ssoStatus: "active", guestUnlock: "not_used" }),
      signal("apple.audit_event_recorded", "audit", "Apple audit fixture", "audit:apple-ddm-018", "info", "Apple management audit event is available as evidence", { evidenceSource: "apple_management_audit", eventCategory: "configuration_state" }),
      signal("workflow.assignment_changed", "workflow", "Workflow fixture", "workflow:shift-handoff-18", "info", "Shared-use workflow is active and assigned", { active: true, sharedUse: true }),
    ],
  },
  {
    id: "healthy-shared-device-checkout",
    title: "Healthy shared device checkout",
    summary: "Authenticated clinician checks out a compliant shared iPhone from the correct unit.",
    persona: "Charge nurse starting a medication-round workflow",
    expectedOutcomes: ["allow", "record_audit"],
    expectedOwnerTeam: "Clinical mobility operations",
    safeDemoNote: "Simulated identity, posture, dock, and workflow signals only. No real badge, MDM, or vendor API call is made.",
    startingSignals: [
      signal("identity.authenticated", "identity", "Entra fixture", "user:rn-142", "info", "MFA-backed badge session accepted", { risk: "low" }),
      signal("device.posture_observed", "device", "Intune fixture", "device:ios-shared-014", "info", "Device is compliant and posture is fresh", { compliance: "compliant", freshness: "fresh" }),
      signal("rtls.location_observed", "location", "RTLS fixture", "device:ios-shared-014", "info", "Device is in expected medication-room zone", { zone: "med-room-east", expectedZone: "med-room-east" }),
      signal("dock.device_undocked", "dockbridge", "DockBridge fixture", "slot:ED-04", "info", "Device undocked from assigned slot", { dockId: "ED-01", slot: "04", overdue: false }),
      signal("workflow.assignment_changed", "workflow", "Workflow fixture", "workflow:med-round-42", "info", "Workflow assigned to authenticated user", { active: true }),
    ],
  },
  {
    id: "non-compliant-clinical-device",
    title: "Non-compliant clinical shared device",
    summary: "Authenticated user attempts to use a shared device with a non-compliant posture during an active workflow.",
    persona: "Floor nurse trying to continue patient-care documentation",
    expectedOutcomes: ["restrict", "create_ticket", "alert_operator", "record_audit"],
    expectedOwnerTeam: "Endpoint and mobility operations",
    safeDemoNote: "Shows review and routing behavior only; no production access control is enforced.",
    startingSignals: [
      signal("identity.authenticated", "identity", "Entra fixture", "user:rn-219", "info", "User authenticated with MFA", { risk: "low" }),
      signal("device.non_compliant", "device", "Intune fixture", "device:ios-shared-022", "high", "Device failed compliance because required app version is missing", { compliance: "non_compliant", freshness: "fresh" }),
      signal("workflow.assignment_changed", "workflow", "Workflow fixture", "workflow:clinical-charting-99", "medium", "Clinical workflow is active", { active: true, criticality: "clinical" }),
    ],
  },
  {
    id: "stale-checkin-shared-device",
    title: "Stale check-in on shared device",
    summary: "A shared-pool device was previously compliant, but its posture check-in is stale.",
    persona: "Mobility operator reviewing a shift-change exception",
    expectedOutcomes: ["step_up", "request_remediation", "record_audit"],
    expectedOwnerTeam: "Endpoint and mobility operations",
    safeDemoNote: "The posture refresh is a simulated request, not a real MDM action.",
    startingSignals: [
      signal("identity.authenticated", "identity", "Entra fixture", "user:tech-041", "info", "User authenticated", { risk: "low" }),
      signal("device.stale_checkin", "device", "Intune fixture", "device:ios-pool-037", "medium", "Last posture check-in is outside the freshness window", { compliance: "compliant", freshness: "stale" }),
      signal("workflow.assignment_changed", "workflow", "Workflow fixture", "workflow:asset-round-17", "info", "Device belongs to shared pool", { pool: "shared", active: true }),
    ],
  },
  {
    id: "wrong-zone-rtls-event",
    title: "Wrong-zone RTLS event",
    summary: "A shared device appears outside its expected unit during an active assignment.",
    persona: "Unit operator watching local device location drift",
    expectedOutcomes: ["alert_operator", "route_to_owner", "record_audit"],
    expectedOwnerTeam: "Local unit owner",
    safeDemoNote: "Location is deterministic fixture data and contains no hospital, patient, or staff identifiers.",
    startingSignals: [
      signal("identity.authenticated", "identity", "Entra fixture", "user:rn-110", "info", "User session is valid", { risk: "low" }),
      signal("device.posture_observed", "device", "Intune fixture", "device:ios-shared-030", "info", "Device remains compliant", { compliance: "compliant", freshness: "fresh" }),
      signal("rtls.wrong_zone", "location", "RTLS fixture", "device:ios-shared-030", "high", "Device observed in imaging instead of east unit", { zone: "imaging", expectedZone: "east-unit" }),
    ],
  },
  {
    id: "dock-missing-overdue-device",
    title: "Dock missing or overdue device",
    summary: "A device is undocked beyond return SLA with no active user session.",
    persona: "Shared-device pool operator reconciling end-of-shift inventory",
    expectedOutcomes: ["create_ticket", "alert_operator", "route_to_owner", "record_audit"],
    expectedOwnerTeam: "Shared device pool owner",
    safeDemoNote: "DockBridge events are software fixtures; no smart dock hardware is required.",
    startingSignals: [
      signal("dock.device_missing", "dockbridge", "DockBridge fixture", "slot:ED-07", "critical", "Device is overdue and missing from assigned slot", { dockId: "ED-01", slot: "07", overdue: true }),
      signal("workflow.assignment_changed", "workflow", "Workflow fixture", "workflow:none", "medium", "No active session owns the device", { active: false }),
    ],
  },
  {
    id: "custody-removal-without-session",
    title: "Credential removed with no session owning it",
    summary:
      "A shared device is lifted from its dock while nothing asserts an active session owns it — the key pulled from the ignition.",
    persona: "Shared-device pool operator watching an unclaimed removal",
    expectedOutcomes: ["create_ticket", "alert_operator", "route_to_owner", "record_audit"],
    expectedOwnerTeam: "Shared device pool owner",
    safeDemoNote:
      "DockBridge undock events are software fixtures; no dock, puck or lock hardware is touched. SignalGrid OBSERVES the removal and correlates it — it never commands the dock.",
    startingSignals: [
      signal("identity.authenticated", "identity", "Entra fixture", "user:rn-204", "info", "A user session is valid elsewhere on the floor", { risk: "low" }),
      signal("device.posture_observed", "device", "Intune fixture", "device:ios-shared-061", "info", "Device is compliant and fresh", { compliance: "compliant", freshness: "fresh" }),
      signal("dock.device_undocked", "dockbridge", "DockBridge fixture", "device:ios-shared-061", "high", "Device was lifted from its bay", { dockId: "ED-02", slot: "03" }),
      signal("workflow.assignment_changed", "workflow", "Workflow fixture", "workflow:none", "medium", "No active session claims the device", { active: false }),
    ],
  },
  {
    id: "custody-removal-with-session",
    title: "Credential removed by the session that owns it",
    summary:
      "The same lift, with an active session bound to it — the ordinary shift handoff, which must stay allowed.",
    persona: "Nurse taking an assigned shared device at shift start",
    expectedOutcomes: ["allow", "record_audit"],
    expectedOwnerTeam: "Clinical mobility operations",
    safeDemoNote:
      "Paired with custody-removal-without-session so the removal rule is proven in BOTH directions: it must fire on an unclaimed lift and stay silent on a claimed one.",
    startingSignals: [
      signal("identity.authenticated", "identity", "Entra fixture", "user:rn-204", "info", "User session is valid", { risk: "low" }),
      signal("device.posture_observed", "device", "Intune fixture", "device:ios-shared-061", "info", "Device is compliant and fresh", { compliance: "compliant", freshness: "fresh" }),
      signal("dock.device_undocked", "dockbridge", "DockBridge fixture", "device:ios-shared-061", "info", "Device was lifted from its bay by its assigned holder", { dockId: "ED-02", slot: "03" }),
      signal("workflow.assignment_changed", "workflow", "Workflow fixture", "workflow:shift-am", "info", "An active session owns the device", { active: true }),
    ],
  },
  {
    id: "puck-session-lifecycle",
    title: "Session puck: dock, session, undock, re-dock within N",
    summary:
      "The whole custody lifecycle in one fixture — the credential is seated, a session runs, the credential is lifted, and it is re-seated 12 seconds later. The re-dock does not resume anything: nothing has re-evaluated since, and the only posture read on file predates the removal.",
    persona: "Shared-device pool operator watching a quick lift-and-return",
    expectedOutcomes: ["step_up", "create_ticket", "alert_operator", "route_to_owner", "request_remediation", "record_audit"],
    expectedOwnerTeam: "Shared device pool owner",
    safeDemoNote:
      "Every signal is a software fixture. No puck, dock, reader or lock hardware exists or is touched — the receiver is a source of evidence, never the policy engine. DR-043's hardware remains a hypothesis behind the discovery gates; only this software half is built.",
    startingSignals: [
      signal("identity.authenticated", "identity", "Entra fixture", "user:rn-500", "info", "Worker authenticated when the credential was first seated", { risk: "low" }),
      signal("dock.device_docked", "dockbridge", "DockBridge fixture", "device:ios-shared-500", "info", "Credential re-seated 12s after the lift", { dockId: "ED-05", slot: "02", redockSeconds: 12, reevaluated: false }),
      signal("dock.device_undocked", "dockbridge", "DockBridge fixture", "device:ios-shared-500", "high", "Credential was lifted out of the receiver", { dockId: "ED-05", slot: "02", forced: false }),
      // The posture on file was read BEFORE the removal. That is the honest state of a
      // re-dock nobody has re-evaluated, and it is why this resumes at step_up rather
      // than at allow: a quick return is not evidence that anything is still true.
      signal("device.posture_observed", "device", "Intune fixture", "device:ios-shared-500", "medium", "The only posture read on file predates the removal", { compliance: "compliant", freshness: "stale" }),
      signal("workflow.assignment_changed", "workflow", "Workflow fixture", "workflow:none", "medium", "The session was suspended on the lift and has not resumed", { active: false }),
    ],
  },
  {
    id: "smart-charging-checkout-to-checkin",
    title: "Smart charging: badge, dock, provision, in use, check-in",
    summary:
      "The real workflow end to end rather than an abstraction of it — a worker badges at the charging cabinet, the device is seated and provisioned, the shift runs, and the device comes back. The happy path; its four failure branches are derived from this fixture in proof:signalgrid-simulator.",
    persona: "Field technician taking a charged shared device at shift start",
    expectedOutcomes: ["allow", "record_audit"],
    expectedOwnerTeam: "Clinical mobility operations",
    safeDemoNote:
      "Charging, dock and badge events are software fixtures. SignalGrid reads a cabinet's events; it does not control charging, power or any hardware, and no vendor API is called.",
    startingSignals: [
      signal("identity.authenticated", "identity", "Entra fixture", "user:tech-700", "info", "Badge read at the charging cabinet, MFA-backed", { risk: "low" }),
      signal("dock.device_docked", "dockbridge", "DockBridge fixture", "device:ios-shared-700", "info", "Device seated in its bay and charging to the configured cap", { dockId: "CAB-01", slot: "11", chargeCapPct: 80, batteryPct: 79 }),
      signal("device.posture_observed", "device", "Intune fixture", "device:ios-shared-700", "info", "Provisioning completed; posture compliant and fresh", { compliance: "compliant", freshness: "fresh" }),
      signal("workflow.assignment_changed", "workflow", "Workflow fixture", "workflow:field-round-70", "info", "Shift assignment owns the device for the round", { active: true }),
      signal("dock.device_undocked", "dockbridge", "DockBridge fixture", "device:ios-shared-700", "info", "Device taken by the holder the assignment names", { dockId: "CAB-01", slot: "11" }),
    ],
  },
  {
    id: "low-battery-workflow-impact",
    title: "Low battery workflow impact",
    summary: "A shared device is assigned to an active workflow while battery is critical.",
    persona: "Operator preventing an avoidable workflow interruption",
    expectedOutcomes: ["route_to_owner", "alert_operator", "record_audit"],
    expectedOwnerTeam: "Clinical mobility operations",
    safeDemoNote: "Recommendations are simulated and do not control hardware charging behavior.",
    startingSignals: [
      signal("device.low_battery", "device", "Device telemetry fixture", "device:ios-shared-044", "high", "Battery is below critical threshold", { batteryPct: 8 }),
      signal("workflow.assignment_changed", "workflow", "Workflow fixture", "workflow:transport-08", "medium", "Device is assigned to an active workflow", { active: true }),
    ],
  },
  {
    id: "operational-health-degradation",
    title: "Operational health degradation",
    summary: "A compliant device has degraded CPU, memory, app crash, or network signals.",
    persona: "EUC analyst triaging degraded user experience without blocking care",
    expectedOutcomes: ["route_to_owner", "create_ticket", "record_audit"],
    expectedOwnerTeam: "DEX and EUC owner",
    safeDemoNote: "Operational health is simulated; SignalGrid does not claim to replace DEX or endpoint tools.",
    startingSignals: [
      signal("device.posture_observed", "device", "Intune fixture", "device:ios-shared-052", "info", "Device is compliant and fresh", { compliance: "compliant", freshness: "fresh" }),
      signal("device.health_degraded", "operational_health", "DEX fixture", "device:ios-shared-052", "medium", "App crash and network latency degraded workflow quality", { appCrashes: 3, latencyMs: 1200 }),
    ],
  },
  {
    id: "edr-security-risk",
    title: "EDR or security risk",
    summary: "High-risk security signal appears during an active shared-device session.",
    persona: "Security operator receiving a routed escalation",
    expectedOutcomes: ["restrict", "alert_operator", "route_to_owner", "record_audit"],
    expectedOwnerTeam: "Security operations",
    safeDemoNote: "Security escalation is simulated and does not execute EDR, SIEM, or SOAR actions.",
    startingSignals: [
      signal("identity.risk_detected", "identity", "Identity risk fixture", "user:rn-310", "high", "Identity risk score elevated during session", { risk: "high" }),
      signal("device.posture_observed", "device", "EDR fixture", "device:ios-shared-063", "critical", "EDR health is disabled or high risk", { edr: "disabled", securityRisk: "high" }),
      signal("workflow.assignment_changed", "workflow", "Workflow fixture", "workflow:med-round-88", "medium", "Active session is in progress", { active: true }),
    ],
  },
  {
    id: "api-integration-outage",
    title: "API or integration outage",
    summary: "A workflow target such as ServiceNow or webhook delivery is unavailable.",
    persona: "Platform owner monitoring routed action delivery",
    expectedOutcomes: ["alert_operator", "route_to_owner", "record_audit"],
    expectedOwnerTeam: "SignalGrid platform owner",
    safeDemoNote: "The outage is simulated and queues a retry record only; no external ticketing API is called.",
    startingSignals: [
      signal("api.integration_failed", "integration", "Integration health fixture", "integration:servicenow", "high", "Ticket target is unavailable; route is degraded and queued", { target: "servicenow", state: "unavailable" }),
      signal("ticket.created", "workflow", "Ticket fixture", "ticket:sim-009", "medium", "Ticket creation attempted in simulation", { queued: true }),
    ],
  },
  {
    id: "remediation-verified",
    title: "Remediation verified",
    summary: "A prior issue was remediated, posture refreshed, and the ticket is updated with evidence.",
    persona: "Remediation assistant confirming closure evidence",
    expectedOutcomes: ["allow", "verify_remediation", "record_audit"],
    expectedOwnerTeam: "Endpoint and mobility operations",
    safeDemoNote: "Verification evidence is fixture-based and does not close a real ticket.",
    startingSignals: [
      // Base trust is present alongside the remediation evidence — the engine only
      // restores `allow` when identity + posture are affirmatively established, so
      // this scenario carries both (a lone remediation ticket releases nothing).
      signal("identity.authenticated", "identity", "Entra fixture", "user:rn-207", "info", "Remediation assistant authenticated with MFA", { risk: "low" }),
      signal("remediation.verified", "workflow", "Remediation fixture", "ticket:sim-010", "info", "Prior posture issue was remediated", { verified: true }),
      signal("device.posture_observed", "device", "Intune fixture", "device:ios-shared-022", "info", "Posture refreshed and compliant", { compliance: "compliant", freshness: "fresh" }),
      signal("ticket.updated", "workflow", "Ticket fixture", "ticket:sim-010", "info", "Ticket updated with verification evidence", { state: "verified" }),
    ],
  },

  // ── THE SMART-CHARGING CUSTODY JOURNEY ────────────────────────────────────
  //
  // One clinician, one shared iPhone, one shift, end to end — the workflow
  // docs/research/SHARED_DEVICE_CUSTODY_GROUND_TRUTH.md generalizes from the
  // owner's real runbooks: badge at a charging dock -> the bay releases the
  // device -> it provisions -> it is used for a shift -> it is returned to ANY
  // dock, where it checks itself back in, re-provisions and recharges.
  //
  // WHY THESE ARE SCENARIOS AND NOT A NEW STAGE-MACHINE TYPE. A journey is an
  // ORDERED set of decisions, and `SimulatorScenario` already is one decision.
  // The journey identifier is therefore the shared `custody-journey-` id prefix
  // and the order is this array's order — both asserted, contiguously, by
  // `scripts/src/custody-journey-proof.ts`. Nothing in `types.ts` changed: a
  // `journey` field would have been a second way to say what an id already
  // says, and every consumer of this list (the /v1 route, the review console,
  // three other proofs) would have had to learn it.
  //
  // THE FOUR BRANCHES are the failure modes the runbooks actually produce —
  // unpaired, network-down, cap-hit, dock-fault — each departing from a named
  // stage that GRANTS, so that what the branch proves is a grant withdrawn and
  // not merely a refusal in isolation. Not one of them allows.
  {
    id: "custody-journey-01-badge-tap",
    title: "Custody journey 1 — badge tap at the charging dock",
    summary: "A clinician taps their badge at a charging-dock bay holding a seated, paired, supervised shared iPhone.",
    persona: "Clinician starting a shift at the ward charging dock",
    expectedOutcomes: ["allow", "record_audit"],
    expectedOwnerTeam: "Clinical mobility operations",
    safeDemoNote: "Badge, dock-bay, supervision-identity and posture signals are fixtures. No badge reader, MAM platform, UEM or dock hardware is contacted.",
    startingSignals: [
      signal("identity.authenticated", "identity", "PACS badge-reader fixture", "user:rn-501", "info", "Badge accepted at the dock reader and the session is MFA-backed", { risk: "low", badgeAuthOutcome: "success" }),
      signal("device.enrollment_observed", "device_state_compliance", "Supervision-identity fixture", "device:iphone-shared-51", "info", "Device is supervised, bound to this organization, enrolled, and answering management commands", { supervision: "supervised", identityBinding: "bound_to_org", enrollment: "enrolled", commandChannel: "responsive" }),
      signal("device.posture_observed", "device", "UEM fixture", "device:iphone-shared-51", "info", "Device is compliant and its posture check-in is fresh", { compliance: "compliant", freshness: "fresh" }),
      signal("rtls.location_observed", "location", "Custody-beacon fixture", "slot:ED-04", "info", "Bay reports the device seated and paired in its expected zone", { zone: "dock-bay-ed-04", expectedZone: "dock-bay-ed-04", slotState: "seated", pairing: "paired" }),
    ],
  },
  {
    id: "custody-journey-02-dock-release",
    title: "Custody journey 2 — the bay releases the device",
    summary: "The dock unlocks the bay and the ledger records the check-out; the requester is under their checkout cap.",
    persona: "Clinician taking the shared iPhone out of the bay",
    expectedOutcomes: ["allow", "record_audit"],
    expectedOwnerTeam: "Clinical mobility operations",
    safeDemoNote: "Dock release and the checkout ledger are fixture events. SignalGrid decides; it does not drive a bay solenoid or write a MAM checkout record.",
    startingSignals: [
      signal("identity.authenticated", "identity", "PACS badge-reader fixture", "user:rn-501", "info", "Badge session is still valid at release", { risk: "low", badgeAuthOutcome: "success" }),
      signal("apple.ddm_declared_state", "device_state_compliance", "Apple DDM fixture", "device:iphone-shared-51", "info", "Declared device state reports configuration applied and compliance current", { declaredState: "current", configurationStatus: "applied", compliance: "compliant" }),
      signal("dock.device_undocked", "dockbridge", "DockBridge fixture", "slot:ED-04", "info", "Bay unlocked and the device was removed by the badged requester", { dockId: "ED-01", slot: "04", overdue: false, ledgerState: "clear", capState: "under_cap" }),
      signal("workflow.assignment_changed", "workflow", "Workflow fixture", "workflow:shift-ed-501", "info", "Shift workflow is assigned to the requester", { active: true, sharedUse: true }),
    ],
  },
  {
    id: "custody-journey-03-provision",
    title: "Custody journey 3 — the device provisions for the shift",
    summary: "Enrollment, profiles, required apps and the OS are all confirmed current before the device is treated as ready.",
    persona: "Clinician waiting for the handset to finish preparing",
    expectedOutcomes: ["allow", "record_audit"],
    expectedOwnerTeam: "Endpoint and mobility operations",
    safeDemoNote: "Device-prep state is a fixture reading. SignalGrid grades the prep report; it installs nothing and sends no management command.",
    startingSignals: [
      signal("identity.authenticated", "identity", "PACS badge-reader fixture", "user:rn-501", "info", "Requester session carried into provisioning", { risk: "low" }),
      signal("device.configuration_observed", "device_state_compliance", "Device-prep fixture", "device:iphone-shared-51", "info", "Enrolled, profiles applied, required apps installed, OS current, prep complete", { enrollment: "enrolled", profiles: "applied", requiredApps: "installed", osUpdate: "current", prepStage: "complete" }),
      signal("device.posture_observed", "device", "UEM fixture", "device:iphone-shared-51", "info", "Posture re-read after prep is compliant and fresh", { compliance: "compliant", freshness: "fresh" }),
    ],
  },
  {
    id: "custody-journey-04-in-use",
    title: "Custody journey 4 — in use through the shift",
    summary: "The handset is on the site network, on its expected segment, in its expected zone, for the assigned workflow.",
    persona: "Clinician working a shift with the shared handset",
    expectedOutcomes: ["allow", "record_audit"],
    expectedOwnerTeam: "Clinical mobility operations",
    safeDemoNote: "Network, location and workflow signals are fixtures. No 802.1x supplicant, RTLS vendor or clinical application is involved.",
    startingSignals: [
      signal("identity.authenticated", "identity", "PACS badge-reader fixture", "user:rn-501", "info", "Session remains valid through the shift", { risk: "low" }),
      signal("device.posture_observed", "device", "UEM fixture", "device:iphone-shared-51", "info", "Posture stays compliant and fresh in use", { compliance: "compliant", freshness: "fresh" }),
      signal("device.configuration_observed", "device_state_compliance", "Network/NAC fixture", "device:iphone-shared-51", "info", "Authenticated on the expected clinical-mobile segment and NAC-compliant", { networkAuthState: "authenticated", nacCompliant: true, segment: "clinical-mobile" }),
      signal("rtls.location_observed", "location", "RTLS fixture", "device:iphone-shared-51", "info", "Device is in the ward zone the assignment expects", { zone: "med-room-east", expectedZone: "med-room-east" }),
      signal("workflow.assignment_changed", "workflow", "Workflow fixture", "workflow:shift-ed-501", "info", "Assignment is active for the badged requester", { active: true }),
    ],
  },
  {
    id: "custody-journey-05-check-in",
    title: "Custody journey 5 — returned to any dock and checked back in",
    summary: "The handset is seated in a different dock, pairs to that bay, re-provisions and charges; the ledger clears.",
    persona: "Clinician ending a shift at whichever dock is nearest",
    expectedOutcomes: ["allow", "record_audit"],
    expectedOwnerTeam: "Shared device pool owner",
    safeDemoNote: "Check-in, re-pairing and charge state are fixture events; no dock, MAM platform or charger is actuated.",
    startingSignals: [
      signal("identity.authenticated", "identity", "PACS badge-reader fixture", "user:rn-501", "info", "Returning clinician is identified at the dock", { risk: "low", badgeAuthOutcome: "success" }),
      signal("dock.device_docked", "dockbridge", "DockBridge fixture", "slot:ICU-02", "info", "Seated and paired in a different dock than it left; charging", { dockId: "ICU-03", slot: "02", overdue: false, returnBay: "any", pairing: "paired", chargeState: "charging" }),
      signal("device.posture_observed", "device", "UEM fixture", "device:iphone-shared-51", "info", "Posture re-read on check-in is compliant and fresh", { compliance: "compliant", freshness: "fresh" }),
      signal("device.configuration_observed", "device_state_compliance", "Device-prep fixture", "device:iphone-shared-51", "info", "Re-provisioned for the next holder; prep complete", { enrollment: "enrolled", profiles: "applied", requiredApps: "installed", osUpdate: "current", prepStage: "complete" }),
    ],
  },
  {
    id: "custody-journey-branch-unpaired",
    title: "Custody journey branch — unpaired device occupying a bay",
    summary: "The handset is physically seated at check-in but is not paired to the bay it sits in, so the return never clears.",
    persona: "Pool operator meeting the runbooks' commonest check-in failure",
    expectedOutcomes: ["alert_operator", "create_ticket", "route_to_owner", "record_audit"],
    expectedOwnerTeam: "Shared device pool owner",
    safeDemoNote: "Departs from journey stage 5. The unpaired bay reading is a fixture; nothing is unpaired, re-paired or released by SignalGrid.",
    startingSignals: [
      signal("identity.authenticated", "identity", "PACS badge-reader fixture", "user:rn-501", "info", "Returning clinician is identified at the dock", { risk: "low", badgeAuthOutcome: "success" }),
      signal("device.posture_observed", "device", "UEM fixture", "device:iphone-shared-51", "info", "Posture itself is compliant and fresh — the fault is custody, not compliance", { compliance: "compliant", freshness: "fresh" }),
      signal("dock.wrong_slot_return", "dockbridge", "DockBridge fixture", "slot:ICU-02", "high", "Device is seated in a bay it is not paired to, so the check-in cannot be confirmed", { dockId: "ICU-03", slot: "02", pairing: "unpaired", slotState: "seated" }),
    ],
  },
  {
    id: "custody-journey-branch-network-down",
    title: "Custody journey branch — the site network is down",
    summary: "The tethering path is gone, so posture cannot re-check in and the management channel answers nothing.",
    persona: "Clinician mid-shift on a handset that has stopped reporting",
    expectedOutcomes: ["step_up", "request_remediation", "record_audit"],
    expectedOwnerTeam: "Endpoint and mobility operations",
    safeDemoNote: "Departs from journey stage 4. Reachability is a fixture reading; SignalGrid restores no network and issues no refresh command.",
    startingSignals: [
      signal("identity.authenticated", "identity", "PACS badge-reader fixture", "user:rn-501", "info", "The person is unchanged — only the network evidence went away", { risk: "low" }),
      signal("device.stale_checkin", "device", "UEM fixture", "device:iphone-shared-51", "medium", "Last posture check-in is outside the freshness window because the device cannot reach the UEM", { compliance: "compliant", freshness: "stale", commandChannel: "unresponsive" }),
      signal("device.configuration_observed", "device_state_compliance", "Network/NAC fixture", "device:iphone-shared-51", "medium", "Network authentication state is unreported; the segment is unknown", { networkAuthState: "unknown", nacCompliant: null, segment: null }),
      signal("workflow.assignment_changed", "workflow", "Workflow fixture", "workflow:shift-ed-501", "info", "The same assignment is still open", { active: true }),
    ],
  },
  {
    id: "custody-journey-branch-cap-hit",
    title: "Custody journey branch — the checkout cap blocks the release",
    summary: "The requester is at their per-user cap only because an earlier return never cleared the ledger.",
    persona: "Clinician meeting the dock's mystery refusal at shift start",
    expectedOutcomes: ["alert_operator", "create_ticket", "route_to_owner", "record_audit"],
    expectedOwnerTeam: "Shared device pool owner",
    safeDemoNote: "Departs from journey stage 2. Counts are fixtures; SignalGrid clears no stale record and raises no cap.",
    startingSignals: [
      signal("identity.authenticated", "identity", "PACS badge-reader fixture", "user:rn-501", "info", "Badge accepted — the refusal is not an identity problem", { risk: "low", badgeAuthOutcome: "success" }),
      signal("device.posture_observed", "device", "UEM fixture", "device:iphone-shared-52", "info", "The bay's handset is compliant and fresh; nothing is wrong with the device", { compliance: "compliant", freshness: "fresh" }),
      signal("workflow.assignment_changed", "workflow", "Checkout-ledger fixture", "workflow:shift-ed-501", "medium", "Cap reached only because a prior return was never cleared from the ledger", { active: true, missingReturn: true, openCheckouts: 2, checkoutCap: 2, dockedOpenCheckouts: 1 }),
    ],
  },
  {
    id: "custody-journey-branch-dock-fault",
    title: "Custody journey branch — the dock bay itself is faulty",
    summary: "The bay's bridge is unreachable and its own telemetry is degraded, so no check-in can be confirmed there.",
    persona: "Pool operator triaging a bay that has stopped answering",
    expectedOutcomes: ["alert_operator", "create_ticket", "route_to_owner", "record_audit"],
    expectedOwnerTeam: "Shared device pool owner",
    safeDemoNote: "Departs from journey stage 5. The bay fault and the degraded route are fixtures; no dock is reset and no retry leaves the simulator.",
    startingSignals: [
      signal("identity.authenticated", "identity", "PACS badge-reader fixture", "user:rn-501", "info", "Returning clinician is identified at the dock", { risk: "low", badgeAuthOutcome: "success" }),
      signal("device.posture_observed", "device", "UEM fixture", "device:iphone-shared-51", "info", "The handset is compliant and fresh — the fault is the bay, not the device", { compliance: "compliant", freshness: "fresh" }),
      signal("device.health_degraded", "operational_health", "Dock bay telemetry fixture", "slot:ICU-02", "high", "Bay reports a stuck peripheral multiplexer and cannot confirm a seated device", { bayFault: "peripheral_multiplexer", seatConfirmed: false }),
      signal("api.integration_failed", "integration", "Integration health fixture", "integration:dock-bridge", "high", "Dock-bridge route is unavailable; the check-in record is queued rather than written", { target: "dock-bridge", state: "unavailable" }),
    ],
  },
];

function signal(
  type: SimulatorScenario["startingSignals"][number]["type"],
  layer: SimulatorScenario["startingSignals"][number]["layer"],
  source: string,
  subject: string,
  severity: SimulatorScenario["startingSignals"][number]["severity"],
  summary: string,
  attributes: Record<string, string | number | boolean | null>,
) {
  return {
    id: `${type}:${subject}`.replace(/[^a-zA-Z0-9:_-]/g, "-"),
    type,
    layer,
    source,
    subject,
    observedAt,
    severity,
    summary,
    attributes,
  };
}
