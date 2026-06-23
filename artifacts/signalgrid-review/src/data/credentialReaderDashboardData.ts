import credentialReaderFixture from "../../../../fixtures/connectors/emulator/credential-reader.json";

export type CredentialReaderDecision =
  | "allowCandidate"
  | "restrict"
  | "stepUp"
  | "approvalRequired";

export interface CredentialReaderScenario {
  id: string;
  title: string;
  expected: {
    decision: CredentialReaderDecision;
    reason: string;
    route: {
      ownerCategory: string;
      severity: "info" | "medium" | "high" | "critical";
      destinationPlaceholder: string;
      verificationExpectation: string;
    };
  };
  credentialReadState: string;
  identityCorrelationState: string;
  custodyCorrelationState: string;
  credentialWorkflowContext: string;
  deviceContext: string;
  lockerOrDockState: string;
  routeOwner: string;
  approvalRequired: boolean;
  apiHealth: "healthy" | "degraded" | "unknown";
}

interface CredentialReaderFixture {
  fixtureName: string;
  scenarios: CredentialReaderScenario[];
}

export const credentialReaderScenarios = (
  credentialReaderFixture as CredentialReaderFixture
).scenarios;

export const credentialReaderDashboardSummary = {
  fixtureName: (credentialReaderFixture as CredentialReaderFixture).fixtureName,
  scenarioCount: credentialReaderScenarios.length,
  proofCommand: "pnpm run proof:connector-emulator",
  artifactPath: "artifacts/connector-emulator/results.json",
  lane: "YELLOW",
  classification: "Credential/custody signal dashboard",
} as const;

export const credentialReaderFlow = [
  "badge read",
  "identity correlation",
  "custody correlation",
  "device/workflow context",
  "decision",
  "route owner",
  "verification expectation",
] as const;
