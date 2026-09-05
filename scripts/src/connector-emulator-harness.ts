import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ConnectorRoute,
  ConnectorScenario,
  ConnectorScenarioPack,
  Decision,
} from "./connector-emulator-scenarios.js";

export interface EvaluationResult {
  id: string;
  group: string;
  expectedDecision: Decision;
  actualDecision: Decision;
  actualReason: string;
  route: ConnectorRoute;
  approvalRequired: boolean;
  simulatedFirst: boolean;
}

export const fixtureDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/connectors/emulator",
);
export const fixtureFiles = [
  "microsoft-graph-posture.json",
  "workflow-routing.json",
  "physical-custody.json",
  "credential-reader.json",
  "network-trust.json",
] as const;

export async function loadScenarioPacks(): Promise<ConnectorScenarioPack[]> {
  return Promise.all(
    fixtureFiles.map(
      async (fileName) =>
        JSON.parse(
          await readFile(resolve(fixtureDir, fileName), "utf8"),
        ) as ConnectorScenarioPack,
    ),
  );
}

export function evaluateScenario(
  scenario: ConnectorScenario,
): EvaluationResult {
  const actual = decide(scenario);
  return {
    id: scenario.id,
    group: scenario.group,
    expectedDecision: scenario.expected.decision,
    actualDecision: actual.decision,
    actualReason: actual.reason,
    route: scenario.expected.route,
    approvalRequired: scenario.remediation.approvalRequired,
    simulatedFirst: scenario.remediation.simulatedFirst,
  };
}

export function deterministicHash(results: EvaluationResult[]): string {
  return createHash("sha256")
    .update(
      JSON.stringify([...results].sort((a, b) => a.id.localeCompare(b.id))),
    )
    .digest("hex");
}

function decide(s: ConnectorScenario): { decision: Decision; reason: string } {
  if (s.remediation.proposed && s.remediation.highRisk)
    return {
      decision: "approvalRequired",
      reason: "HIGH_RISK_REMEDIATION_APPROVAL_REQUIRED",
    };
  if (s.apiHealth !== "healthy")
    return {
      decision: "stepUp",
      reason: "CONNECTOR_HEALTH_DEGRADED_OR_UNKNOWN",
    };
  if (s.identity === "disabled" && s.session === "active")
    return { decision: "deny", reason: "DISABLED_IDENTITY_ACTIVE_SESSION" };
  if (s.deviceCompliance === "noncompliant" && s.workflowContext === "clinical")
    return {
      decision: "restrict",
      reason: "NONCOMPLIANT_DEVICE_CLINICAL_WORKFLOW",
    };
  if (s.mamPolicy === "missing" && s.appRisk === "sensitive")
    return { decision: "restrict", reason: "MISSING_MAM_POLICY_SENSITIVE_APP" };
  if (s.custodyZone === "wrong" && s.workflowContext === "sharedDevice")
    return { decision: "restrict", reason: "WRONG_CUSTODY_ZONE_SHARED_DEVICE" };
  if (s.networkZone === "mismatch" && s.appRisk === "high")
    return {
      decision: "stepUp",
      reason: "NETWORK_ZONE_MISMATCH_HIGH_RISK_APP",
    };
  if (s.group === "credentialReader") {
    // Evidence the reader family DECLARES but the old decide() never read: a
    // degraded/unknown/absent read confidence and an unreadable badge-event time
    // were both waved through to allowCandidate. A field that exists and is never
    // read is worse than one that is absent — the fixture looked like it carried
    // recency and confidence evidence. Unknown tightens, never loosens.
    if (
      s.credentialConfidence === undefined ||
      s.credentialConfidence === "degraded" ||
      s.credentialConfidence === "unknown"
    )
      return { decision: "stepUp", reason: "CREDENTIAL_CONFIDENCE_DEGRADED_OR_UNKNOWN" };
    if (
      typeof s.badgeEventObservedAt !== "string" ||
      !Number.isFinite(Date.parse(s.badgeEventObservedAt))
    )
      return { decision: "stepUp", reason: "BADGE_EVENT_TIME_UNREADABLE" };
    if (
      s.identityCorrelationState === "unresolved" ||
      s.actorResolved === false
    )
      return { decision: "stepUp", reason: "CREDENTIAL_IDENTITY_UNRESOLVED" };
    if (s.custodyCorrelationState === "mismatch" || s.custodyZone === "wrong")
      return { decision: "restrict", reason: "CREDENTIAL_CUSTODY_MISMATCH" };
    if (s.credentialReadState === "stale" && s.session === "active")
      return {
        decision: "stepUp",
        reason: "STALE_READER_EVENT_ACTIVE_SESSION",
      };
    if (s.custodyCorrelationState === "workflowMismatch")
      return {
        decision: "restrict",
        reason: "CREDENTIAL_WORKFLOW_ASSIGNMENT_MISMATCH",
      };
    // POSITIVE members only. The zone guards above test the BAD member ("wrong",
    // "mismatch"), so "unknown" slipped past them and neither allow arm re-checked
    // it: a reader offline or a segmentation lookup timing out (200-with-null from
    // the real vendor) was emulated as an allow candidate. Same shape as
    // `s.identity === "healthy"` below, which was already written correctly.
    if (
      s.credentialReadState === "valid" &&
      s.identityCorrelationState === "resolved" &&
      s.custodyCorrelationState === "matched" &&
      s.deviceCompliance === "compliant" &&
      s.custodyZone === "expected" &&
      s.networkZone === "expected"
    )
      return {
        decision: "allowCandidate",
        reason: "HEALTHY_CREDENTIAL_READER_CONTEXT_ALLOW_CANDIDATE",
      };
    return {
      decision: "stepUp",
      reason: "AMBIGUOUS_CREDENTIAL_READER_EVIDENCE",
    };
  }
  if (
    s.identity === "healthy" &&
    s.deviceCompliance === "compliant" &&
    s.edrRisk === "low" &&
    s.custodyZone === "expected" &&
    s.networkZone === "expected"
  )
    return {
      decision: "allowCandidate",
      reason: "HEALTHY_IDENTITY_DEVICE_API_ALLOW_CANDIDATE",
    };
  return { decision: "stepUp", reason: "AMBIGUOUS_CONNECTOR_POSTURE" };
}
