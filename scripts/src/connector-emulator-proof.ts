import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  deterministicHash,
  evaluateScenario,
  loadScenarioPacks,
} from "./connector-emulator-harness.js";

const packs = await loadScenarioPacks();
const scenarios = packs.flatMap((pack) => pack.scenarios);
const scenarioGroup = process.env.SCENARIO_GROUP;
const selected = scenarioGroup
  ? scenarios.filter((scenario) => scenario.group === scenarioGroup)
  : scenarios;
const results = selected.map(evaluateScenario);
const hash = deterministicHash(results);
const failures: string[] = [];

if (selected.length === 0)
  failures.push(`no scenarios selected for group=${scenarioGroup ?? "all"}`);
for (const result of results) {
  if (result.actualDecision !== result.expectedDecision)
    failures.push(
      `${result.id} expected ${result.expectedDecision} got ${result.actualDecision}`,
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
