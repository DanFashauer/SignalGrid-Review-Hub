export type ScenarioGroup =
  | "microsoftGraphPosture"
  | "workflowRouting"
  | "physicalCustody"
  | "networkTrust";

export type ConnectorDomain =
  | "microsoftGraphIntune"
  | "iamIga"
  | "mdmMam"
  | "workflowRouting"
  | "physicalCustody"
  | "networkTrust"
  | "securityEdr";

export type ApiHealth = "healthy" | "degraded" | "unknown";
export type Decision =
  | "allowCandidate"
  | "deny"
  | "restrict"
  | "stepUp"
  | "approvalRequired";

export interface ConnectorRoute {
  ownerCategory: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  destinationPlaceholder: string;
  verificationExpectation: string;
}

export interface ConnectorScenario {
  id: string;
  title: string;
  group: ScenarioGroup;
  domains: ConnectorDomain[];
  apiHealth: ApiHealth;
  identity: "healthy" | "disabled" | "unknown";
  session: "none" | "active";
  deviceCompliance: "compliant" | "noncompliant" | "unknown";
  mamPolicy: "present" | "missing" | "notApplicable";
  appRisk: "standard" | "sensitive" | "high";
  workflowContext: "standard" | "clinical" | "sharedDevice";
  custodyZone: "expected" | "wrong" | "unknown";
  networkZone: "expected" | "mismatch" | "unknown";
  edrRisk: "low" | "medium" | "high";
  remediation: {
    proposed: boolean;
    highRisk: boolean;
    approvalRequired: boolean;
    simulatedFirst: boolean;
  };
  expected: {
    decision: Decision;
    reason: string;
    route: ConnectorRoute;
  };
}

export interface ConnectorScenarioPack {
  fixtureName: string;
  fixtureVersion: string;
  generatedFrom: "synthetic-public-safe-fixture";
  scenarios: ConnectorScenario[];
}
