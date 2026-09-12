// Readiness probe (DR-036): run every scenario the engine declares, report declared vs ran.
// Spawned by scripts/check-readiness-figure.mjs from THIS package (tsx and the simulator
// resolve here, not at the repo root). Not a proof: it asserts nothing, it counts.
import { listSimulatorScenarios, runScenario } from "@workspace/signalgrid-simulator";
const scenarios = listSimulatorScenarios();
let ran = 0;
for (const s of scenarios) { try { runScenario(s); ran += 1; } catch { /* counted as not run */ } }
console.log(JSON.stringify({ declared: scenarios.length, ran }));
