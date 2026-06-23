export type ScenarioGroup =
  | "microsoftGraphPosture"
  | "workflowRouting"
  | "physicalCustody"
  | "credentialReader"
  | "networkTrust";

export type ConnectorDomain =
  | "microsoftGraphIntune"
  | "iamIga"
  | "mdmMam"
  | "workflowRouting"
  | "physicalCustody"
  | "credentialReader"
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
  credentialReaderVendor?: string;
  credentialReaderModel?: string;
  credentialReaderClass?: string;
  credentialTechnology?: string;
  credentialType?: string;
  readerConnectionType?: string;
  readerLocation?: string;
  readerPurpose?: string;
  credentialReadState?:
    | "valid"
    | "stale"
    | "overrideRequested"
    | "failed"
    | "unknown";
  credentialConfidence?: "high" | "medium" | "low" | "degraded" | "unknown";
  badgeEventObservedAt?: string;
  actorResolved?: boolean;
  identityCorrelationState?: "resolved" | "unresolved" | "unknown";
  custodyCorrelationState?:
    | "matched"
    | "mismatch"
    | "workflowMismatch"
    | "overrideRequested"
    | "unknown";
  credentialWorkflowContext?: string;
  deviceContext?: string;
  lockerOrDockState?: string;
  routeOwner?: string;
  severity?: ConnectorRoute["severity"];
  approvalRequired?: boolean;
  verificationExpectation?: string;
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
