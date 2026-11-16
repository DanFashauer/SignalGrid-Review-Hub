// Connector-emulator deck data — DERIVED, not transcribed.
//
// This file used to hold a hand-copied digest, a scenario count and a pack list:
// "893c8bb5…", 8 scenarios, four packs. The committed proof artifact said 15
// scenarios, five packs and a different hash — the whole credentialReader group
// (7 of 15, the only one with an approval-gate case) was missing from the deck,
// under the heading "Evidence panel". docs/CLAIM_INVENTORY.md had recorded it as
// unsubstantiated weeks earlier and it still shipped. The file next door
// (credentialReaderDashboardData.ts) already derived from the fixture; this one
// now does the same, and reads the digest from the proof's own artifact.
//
// Expected decisions come from the FIXTURES (what the scenario intends); actual
// decisions come from artifacts/connector-emulator/results.json (what the engine
// produced when `pnpm run proof:connector-emulator` last ran). Both are shown, so
// the deck is a picture of what happened, not only of what was hoped for.

import results from "../../../../artifacts/connector-emulator/results.json";
import graphPack from "../../../../fixtures/connectors/emulator/microsoft-graph-posture.json";
import routingPack from "../../../../fixtures/connectors/emulator/workflow-routing.json";
import custodyPack from "../../../../fixtures/connectors/emulator/physical-custody.json";
import credentialPack from "../../../../fixtures/connectors/emulator/credential-reader.json";
import networkPack from "../../../../fixtures/connectors/emulator/network-trust.json";

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
  /** What the engine produced in the last committed proof run; "unverified" when
   *  the artifact carries no row for this scenario (a fixture added after the run). */
  actualDecision: ConnectorDecision | "unverified";
  actualReason: string;
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

interface FixtureRoute {
  ownerCategory: string;
  severity: ConnectorEmulatorScenario["severity"];
  destinationPlaceholder: string;
  verificationExpectation: string;
}
interface FixtureScenario {
  id: string;
  title: string;
  group: string;
  domains: string[];
  apiHealth: ConnectorEmulatorScenario["apiHealth"];
  remediation: { proposed: boolean; highRisk: boolean; approvalRequired: boolean; simulatedFirst: boolean };
  expected: { decision: ConnectorDecision; reason: string; route: FixtureRoute };
}
interface FixturePack {
  fixtureName: string;
  scenarios: FixtureScenario[];
}
interface ResultRow {
  id: string;
  actualDecision: ConnectorDecision;
  actualReason: string;
}

const packs: FixturePack[] = [graphPack, routingPack, custodyPack, credentialPack, networkPack] as FixturePack[];
const resultById = new Map<string, ResultRow>((results.results as ResultRow[]).map((r) => [r.id, r]));

export const connectorEmulatorScenarios: ConnectorEmulatorScenario[] = packs.flatMap((pack) =>
  pack.scenarios.map((s) => {
    const actual = resultById.get(s.id);
    return {
      id: s.id,
      title: s.title,
      group: s.group,
      domains: s.domains,
      expectedDecision: s.expected.decision,
      actualDecision: actual?.actualDecision ?? "unverified",
      actualReason: actual?.actualReason ?? "no row in the committed proof artifact",
      reason: s.expected.reason,
      ownerCategory: s.expected.route.ownerCategory,
      severity: s.expected.route.severity,
      destinationPlaceholder: s.expected.route.destinationPlaceholder,
      verificationExpectation: s.expected.route.verificationExpectation,
      approvalRequired: s.remediation.approvalRequired,
      simulatedFirst: s.remediation.simulatedFirst,
      highRiskRemediation: s.remediation.proposed && s.remediation.highRisk,
      apiHealth: s.apiHealth,
    };
  }),
);

export const connectorEmulatorProof = {
  command: "pnpm run proof:connector-emulator",
  manualWorkflow: "Connector Emulator Smoke",
  artifact: "connector-emulator-results",
  localArtifactPath: "artifacts/connector-emulator/results.json",
  /** From the committed artifact — never typed by hand. */
  deterministicHash: results.hash as string,
  scenarioCount: results.cases as number,
  fixturePacks: packs.map((p) => p.fixtureName),
} as const;

/** The guardrails the proof asserts, COMPUTED over the committed results rather
 *  than rendered as a hardcoded row of ticks. A pill that cannot turn red is not
 *  an indicator. Each `holds` flips false if a result row breaks the property. */
export const connectorEmulatorGuardrails: ReadonlyArray<{ label: string; holds: boolean }> = [
  {
    label: "no unsafe allow for degraded/unknown health",
    holds: connectorEmulatorScenarios.every((s) => !(s.actualDecision === "allowCandidate" && s.apiHealth !== "healthy")),
  },
  {
    label: "high-risk remediation requires approval",
    holds: connectorEmulatorScenarios.every((s) => !s.highRiskRemediation || s.actualDecision === "approvalRequired"),
  },
  {
    label: "simulated first",
    holds: connectorEmulatorScenarios.every((s) => s.simulatedFirst),
  },
  {
    label: "route owner required",
    holds: connectorEmulatorScenarios.every((s) => s.ownerCategory.length > 0),
  },
  {
    label: "verification expectation required",
    holds: connectorEmulatorScenarios.every((s) => s.verificationExpectation.length > 0),
  },
  {
    label: "every fixture row has a committed proof result",
    holds: connectorEmulatorScenarios.every((s) => s.actualDecision !== "unverified"),
  },
];
