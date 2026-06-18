export type ConnectorDecision =
  | "allowCandidate"
  | "deny"
  | "restrict"
  | "stepUp"
  | "approvalRequired";

export interface ConnectorEmulatorScenario {
  id: string;
  title: string;
  group: string;
  domains: string[];
  expectedDecision: ConnectorDecision;
  reason: string;
  ownerCategory: string;
  severity: "info" | "medium" | "high" | "critical";
  destinationPlaceholder: string;
  verificationExpectation: string;
  approvalRequired: boolean;
  simulatedFirst: boolean;
  highRiskRemediation: boolean;
  apiHealth: "healthy" | "degraded" | "unknown";
}

export const connectorEmulatorProof = {
  command: "pnpm run proof:connector-emulator",
  manualWorkflow: "Connector Emulator Smoke",
  artifact: "connector-emulator-results",
  localArtifactPath: "artifacts/connector-emulator/results.json",
  deterministicHash:
    "893c8bb5b56017f24c9f901132bb29457d2e27ad4175b8819680717b1661ed5d",
  scenarioCount: 8,
  fixturePacks: [
    "microsoft-graph-posture",
    "workflow-routing",
    "physical-custody",
    "network-trust",
  ],
} as const;

export const connectorEmulatorScenarios: ConnectorEmulatorScenario[] = [
  {
    id: "graph-healthy-allow-candidate",
    title:
      "Healthy identity plus compliant device plus healthy API produces an allow candidate only",
    group: "microsoftGraphPosture",
    domains: ["microsoftGraphIntune", "iamIga", "mdmMam", "securityEdr"],
    expectedDecision: "allowCandidate",
    reason: "HEALTHY_IDENTITY_DEVICE_API_ALLOW_CANDIDATE",
    ownerCategory: "audit",
    severity: "info",
    destinationPlaceholder: "audit-evidence-placeholder",
    verificationExpectation:
      "Audit record keeps normalized source IDs synthetic.",
    approvalRequired: false,
    simulatedFirst: true,
    highRiskRemediation: false,
    apiHealth: "healthy",
  },
  {
    id: "identity-disabled-active-session",
    title:
      "Disabled identity with an active session is denied and routed to identity owner",
    group: "microsoftGraphPosture",
    domains: ["iamIga", "microsoftGraphIntune"],
    expectedDecision: "deny",
    reason: "DISABLED_IDENTITY_ACTIVE_SESSION",
    ownerCategory: "identity",
    severity: "high",
    destinationPlaceholder: "identity-owner-queue-placeholder",
    verificationExpectation:
      "Confirm account state and session revocation in the source identity system.",
    approvalRequired: false,
    simulatedFirst: true,
    highRiskRemediation: false,
    apiHealth: "healthy",
  },
  {
    id: "graph-degraded-confidence-route",
    title:
      "Compliant device with degraded Graph health routes integration owner instead of plain allow",
    group: "microsoftGraphPosture",
    domains: ["microsoftGraphIntune", "mdmMam"],
    expectedDecision: "stepUp",
    reason: "CONNECTOR_HEALTH_DEGRADED_OR_UNKNOWN",
    ownerCategory: "integration",
    severity: "medium",
    destinationPlaceholder: "integration-health-queue-placeholder",
    verificationExpectation:
      "Verify connector health before treating posture as current.",
    approvalRequired: false,
    simulatedFirst: true,
    highRiskRemediation: false,
    apiHealth: "degraded",
  },
  {
    id: "network-zone-mismatch-high-risk-app",
    title:
      "Network zone mismatch for a high-risk app requires step-up and routes network owner",
    group: "networkTrust",
    domains: ["networkTrust", "workflowRouting", "securityEdr"],
    expectedDecision: "stepUp",
    reason: "NETWORK_ZONE_MISMATCH_HIGH_RISK_APP",
    ownerCategory: "network",
    severity: "medium",
    destinationPlaceholder: "network-owner-ticket-placeholder",
    verificationExpectation:
      "Verify expected zone and segmentation source records before reducing step-up.",
    approvalRequired: false,
    simulatedFirst: true,
    highRiskRemediation: false,
    apiHealth: "healthy",
  },
  {
    id: "high-risk-remediation-proposed",
    title:
      "High-risk remediation proposal remains approval-required and simulated first",
    group: "networkTrust",
    domains: ["networkTrust", "securityEdr", "workflowRouting"],
    expectedDecision: "approvalRequired",
    reason: "HIGH_RISK_REMEDIATION_APPROVAL_REQUIRED",
    ownerCategory: "change-control",
    severity: "critical",
    destinationPlaceholder: "approval-queue-placeholder",
    verificationExpectation:
      "Review simulated remediation evidence and approve explicitly before any future real action path.",
    approvalRequired: true,
    simulatedFirst: true,
    highRiskRemediation: true,
    apiHealth: "healthy",
  },
  {
    id: "wrong-custody-zone-shared-device",
    title:
      "Wrong custody zone for a shared device is restricted and raises a custody alert",
    group: "physicalCustody",
    domains: ["physicalCustody", "workflowRouting", "mdmMam"],
    expectedDecision: "restrict",
    reason: "WRONG_CUSTODY_ZONE_SHARED_DEVICE",
    ownerCategory: "custody",
    severity: "high",
    destinationPlaceholder: "custody-alert-placeholder",
    verificationExpectation:
      "Confirm dock, room, or custody fixture state before clearing shared-device workflow.",
    approvalRequired: false,
    simulatedFirst: true,
    highRiskRemediation: false,
    apiHealth: "healthy",
  },
  {
    id: "noncompliant-clinical-workflow",
    title:
      "Noncompliant device in a clinical workflow is restricted and routed to UEM owner",
    group: "workflowRouting",
    domains: ["mdmMam", "workflowRouting", "securityEdr"],
    expectedDecision: "restrict",
    reason: "NONCOMPLIANT_DEVICE_CLINICAL_WORKFLOW",
    ownerCategory: "uem",
    severity: "high",
    destinationPlaceholder: "uem-owner-ticket-placeholder",
    verificationExpectation:
      "Confirm device compliance in the UEM source system before restoring access.",
    approvalRequired: false,
    simulatedFirst: true,
    highRiskRemediation: false,
    apiHealth: "healthy",
  },
  {
    id: "missing-mam-sensitive-app",
    title:
      "Missing MAM policy for a sensitive app is restricted and routed to app owner",
    group: "workflowRouting",
    domains: ["mdmMam", "workflowRouting"],
    expectedDecision: "restrict",
    reason: "MISSING_MAM_POLICY_SENSITIVE_APP",
    ownerCategory: "application",
    severity: "medium",
    destinationPlaceholder: "application-owner-ticket-placeholder",
    verificationExpectation:
      "Verify app protection assignment before granting sensitive app workflow access.",
    approvalRequired: false,
    simulatedFirst: true,
    highRiskRemediation: false,
    apiHealth: "healthy",
  },
];
