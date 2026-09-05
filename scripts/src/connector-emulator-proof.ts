import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  deterministicHash,
  evaluateScenario,
  loadScenarioPacks,
} from "./connector-emulator-harness.js";
import type {
  ConnectorScenario,
  Decision,
} from "./connector-emulator-scenarios.js";

const packs = await loadScenarioPacks();
const scenarios = packs.flatMap((pack) => pack.scenarios);
const scenarioGroup = process.env.SCENARIO_GROUP;
const selected = scenarioGroup
  ? scenarios.filter((scenario) => scenario.group === scenarioGroup)
  : scenarios;
const results = selected.map(evaluateScenario);
const hash = deterministicHash(results);
const failures: string[] = [];

const credentialReaderBase = scenarios.find(
  (scenario) => scenario.id === "credential-reader-allow-candidate",
);
const syntheticCredentialReaderGuardrails: Array<{
  id: string;
  patch: Partial<ConnectorScenario>;
  decision: Decision;
  reason: string;
}> = credentialReaderBase
  ? [
      {
        id: "credential-reader-synthetic-disabled-identity-global-deny",
        patch: {
          identity: "disabled",
          credentialReadState: "unknown",
          identityCorrelationState: "unknown",
          actorResolved: undefined,
        },
        decision: "deny",
        reason: "DISABLED_IDENTITY_ACTIVE_SESSION",
      },
      {
        id: "credential-reader-synthetic-noncompliant-clinical-global-restrict",
        patch: {
          deviceCompliance: "noncompliant",
          workflowContext: "clinical",
          credentialReadState: "unknown",
        },
        decision: "restrict",
        reason: "NONCOMPLIANT_DEVICE_CLINICAL_WORKFLOW",
      },
      {
        id: "credential-reader-synthetic-missing-mam-sensitive-global-restrict",
        patch: {
          mamPolicy: "missing",
          appRisk: "sensitive",
          credentialReadState: "unknown",
        },
        decision: "restrict",
        reason: "MISSING_MAM_POLICY_SENSITIVE_APP",
      },
      {
        id: "credential-reader-synthetic-wrong-zone-shared-device-global-restrict",
        patch: {
          custodyZone: "wrong",
          workflowContext: "sharedDevice",
          custodyCorrelationState: "unknown",
          credentialReadState: "unknown",
        },
        decision: "restrict",
        reason: "WRONG_CUSTODY_ZONE_SHARED_DEVICE",
      },
      {
        id: "credential-reader-synthetic-network-mismatch-high-risk-global-step-up",
        patch: {
          networkZone: "mismatch",
          appRisk: "high",
          credentialReadState: "unknown",
        },
        decision: "stepUp",
        reason: "NETWORK_ZONE_MISMATCH_HIGH_RISK_APP",
      },
      {
        id: "credential-reader-synthetic-high-risk-remediation-global-approval",
        patch: {
          credentialReadState: "unknown",
          remediation: {
            ...credentialReaderBase.remediation,
            proposed: true,
            highRisk: true,
            approvalRequired: true,
            simulatedFirst: true,
          },
        },
        decision: "approvalRequired",
        reason: "HIGH_RISK_REMEDIATION_APPROVAL_REQUIRED",
      },
      {
        id: "credential-reader-synthetic-ambiguous-after-global-guardrails",
        patch: {
          credentialReadState: "unknown",
          identityCorrelationState: "unknown",
          custodyCorrelationState: "unknown",
          actorResolved: undefined,
        },
        decision: "stepUp",
        reason: "AMBIGUOUS_CREDENTIAL_READER_EVIDENCE",
      },
      // The zone guards test the BAD member; "unknown" used to slip past both and
      // reach allowCandidate. A reader offline or a segmentation lookup that timed
      // out (200-with-null from the real vendor) must NOT emulate as an allow.
      {
        id: "credential-reader-synthetic-unknown-custody-zone",
        patch: { custodyZone: "unknown" },
        decision: "stepUp",
        reason: "AMBIGUOUS_CREDENTIAL_READER_EVIDENCE",
      },
      {
        id: "credential-reader-synthetic-unknown-network-zone",
        patch: { networkZone: "unknown" },
        decision: "stepUp",
        reason: "AMBIGUOUS_CREDENTIAL_READER_EVIDENCE",
      },
      // Declared-but-never-read evidence: confidence and the badge-event instant.
      {
        id: "credential-reader-synthetic-unknown-confidence",
        patch: { credentialConfidence: "unknown" },
        decision: "stepUp",
        reason: "CREDENTIAL_CONFIDENCE_DEGRADED_OR_UNKNOWN",
      },
      {
        id: "credential-reader-synthetic-degraded-confidence-healthy-api",
        patch: { credentialConfidence: "degraded", apiHealth: "healthy" },
        decision: "stepUp",
        reason: "CREDENTIAL_CONFIDENCE_DEGRADED_OR_UNKNOWN",
      },
      {
        id: "credential-reader-synthetic-absent-confidence",
        patch: { credentialConfidence: undefined },
        decision: "stepUp",
        reason: "CREDENTIAL_CONFIDENCE_DEGRADED_OR_UNKNOWN",
      },
      {
        id: "credential-reader-synthetic-absent-badge-time",
        patch: { badgeEventObservedAt: undefined },
        decision: "stepUp",
        reason: "BADGE_EVENT_TIME_UNREADABLE",
      },
      {
        id: "credential-reader-synthetic-unparseable-badge-time",
        patch: { badgeEventObservedAt: "not-a-date" },
        decision: "stepUp",
        reason: "BADGE_EVENT_TIME_UNREADABLE",
      },
    ]
  : [];

// The same zone rule on the OTHER allow arm (the Graph/Intune posture path), which
// had no unknown-zone check at all: only the credentialReader group was checked,
// and only for fixture rows, none of which carry "unknown".
const graphBase = scenarios.find(
  (scenario) => scenario.id === "graph-healthy-allow-candidate",
);
const syntheticPostureGuardrails: Array<{
  id: string;
  patch: Partial<ConnectorScenario>;
  decision: Decision;
  reason: string;
}> = graphBase
  ? [
      {
        id: "graph-synthetic-unknown-custody-zone-shared-device",
        patch: { custodyZone: "unknown", workflowContext: "sharedDevice" },
        decision: "stepUp",
        reason: "AMBIGUOUS_CONNECTOR_POSTURE",
      },
      {
        id: "graph-synthetic-unknown-network-zone-high-risk-app",
        patch: { networkZone: "unknown", appRisk: "high" },
        decision: "stepUp",
        reason: "AMBIGUOUS_CONNECTOR_POSTURE",
      },
      {
        id: "graph-synthetic-both-zones-unknown",
        patch: { custodyZone: "unknown", networkZone: "unknown" },
        decision: "stepUp",
        reason: "AMBIGUOUS_CONNECTOR_POSTURE",
      },
      // The control: an unknown IDENTITY was already refused, because that arm
      // demanded the positive member. The zone fix makes the arms consistent.
      {
        id: "graph-synthetic-unknown-identity-control",
        patch: { identity: "unknown" as ConnectorScenario["identity"] },
        decision: "stepUp",
        reason: "AMBIGUOUS_CONNECTOR_POSTURE",
      },
    ]
  : [];

if (selected.length === 0)
  failures.push(`no scenarios selected for group=${scenarioGroup ?? "all"}`);
for (const result of results) {
  if (result.actualDecision !== result.expectedDecision)
    failures.push(
      `${result.id} expected ${result.expectedDecision} got ${result.actualDecision}`,
    );
  const scenario = selected.find((item) => item.id === result.id);
  if (scenario && result.actualReason !== scenario.expected.reason)
    failures.push(
      `${result.id} expected reason ${scenario.expected.reason} got ${result.actualReason}`,
    );
  if (
    (result.actualReason.includes("DEGRADED") ||
      result.actualReason.includes("UNKNOWN")) &&
    result.actualDecision === "allowCandidate"
  )
    failures.push(
      `${result.id} degraded/unknown health produced allowCandidate`,
    );
  if (
    result.actualDecision === "allowCandidate" &&
    result.route.severity !== "info"
  )
    failures.push(`${result.id} allowCandidate route severity should be info`);

  for (const field of [
    "ownerCategory",
    "severity",
    "destinationPlaceholder",
    "verificationExpectation",
  ] as const) {
    if (!result.route[field])
      failures.push(`${result.id} route missing ${field}`);
  }
}
for (const scenario of selected) {
  if (
    scenario.remediation.proposed &&
    scenario.remediation.highRisk &&
    (!scenario.remediation.approvalRequired ||
      !scenario.remediation.simulatedFirst)
  ) {
    failures.push(
      `${scenario.id} high-risk remediation is not approval-required and simulated-first`,
    );
  }
}
for (const [index, scenario] of selected.entries()) {
  const result = results[index];
  if (
    scenario.group === "credentialReader" &&
    result.actualDecision === "allowCandidate" &&
    (scenario.identityCorrelationState !== "resolved" ||
      scenario.actorResolved !== true)
  )
    failures.push(`${scenario.id} unresolved identity produced allowCandidate`);
  if (
    scenario.group === "credentialReader" &&
    result.actualDecision === "allowCandidate" &&
    (scenario.custodyCorrelationState !== "matched" ||
      scenario.custodyZone !== "expected")
  )
    failures.push(
      `${scenario.id} custody mismatch or ambiguity produced allowCandidate`,
    );
  if (
    scenario.group === "credentialReader" &&
    result.actualDecision === "allowCandidate" &&
    scenario.credentialReadState !== "valid"
  )
    failures.push(
      `${scenario.id} ambiguous credential read produced allowCandidate`,
    );
}

if (!credentialReaderBase) {
  failures.push(
    "missing credential-reader base scenario for synthetic guardrail proof",
  );
}
if (!graphBase) {
  failures.push("missing graph-healthy base scenario for synthetic posture guardrail proof");
}
for (const synthetic of syntheticPostureGuardrails) {
  const scenario: ConnectorScenario = {
    ...graphBase!,
    ...synthetic.patch,
    id: synthetic.id,
    expected: {
      ...graphBase!.expected,
      decision: synthetic.decision,
      reason: synthetic.reason,
    },
  };
  const result = evaluateScenario(scenario);
  if (
    result.actualDecision !== synthetic.decision ||
    result.actualReason !== synthetic.reason
  ) {
    failures.push(
      `${synthetic.id} expected ${synthetic.decision}/${synthetic.reason} got ${result.actualDecision}/${result.actualReason}`,
    );
  }
}
for (const synthetic of syntheticCredentialReaderGuardrails) {
  const scenario: ConnectorScenario = {
    ...credentialReaderBase!,
    ...synthetic.patch,
    id: synthetic.id,
    expected: {
      ...credentialReaderBase!.expected,
      decision: synthetic.decision,
      reason: synthetic.reason,
    },
  };
  const result = evaluateScenario(scenario);
  if (
    result.actualDecision !== synthetic.decision ||
    result.actualReason !== synthetic.reason
  ) {
    failures.push(
      `${synthetic.id} expected ${synthetic.decision}/${synthetic.reason} got ${result.actualDecision}/${result.actualReason}`,
    );
  }
}

const artifactDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../artifacts/connector-emulator",
);
const artifactPath = resolve(artifactDir, "results.json");
const output = {
  proof: "connector-emulator",
  scenarioGroup: scenarioGroup ?? "all",
  cases: results.length,
  hash,
  results,
};
await mkdir(artifactDir, { recursive: true });
await writeFile(artifactPath, `${JSON.stringify(output, null, 2)}\n`);

console.log("Connector emulator proof");
console.log(`packs=${packs.map((pack) => pack.fixtureName).join(",")}`);
console.log(`cases=${results.length}`);
console.log(`hash=${hash}`);
for (const result of results)
  console.log(
    `${result.id}: expected=${result.expectedDecision} actual=${result.actualDecision} reason=${result.actualReason}`,
  );
console.log(`artifact=artifacts/connector-emulator/results.json`);
console.log(`summary=${failures.length === 0 ? "pass" : "fail"}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
}
