import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const backlogPath = resolve(repoRoot, "docs/PHASE_BACKLOG.md");
const text = readFileSync(backlogPath, "utf8");
const rows = text.split("\n").filter((line) => /^\| PHASE-\d+ /.test(line));
const phases = rows.map((row) => row.split("|").map((cell) => cell.trim())).map((cells) => ({
  id: cells[1],
  input: cells[2],
  classification: cells[3],
  deliverable: cells[4],
  lane: cells[5],
  status: cells[6],
  depends: cells[7],
  validation: cells[8],
  notes: cells[9],
}));

const active = phases.filter((phase) => !/complete|superseded/i.test(phase.status));
const duplicateIds = active.map((phase) => phase.id).filter((id, index, ids) => ids.indexOf(id) !== index);
const incomplete = phases.filter((phase) => !phase.lane || !phase.status || !phase.validation || !phase.notes);
const unparkedInput = phases.filter((phase) => !/backlog|in progress|complete|superseded|parked/i.test(phase.status));
const next = active.find((phase) => /backlog|parked/i.test(phase.status));

console.log("Autopilot backlog check");
console.log(`phases=${phases.length}`);
console.log(`active=${active.length}`);
console.log(`duplicateActivePhaseIds=${duplicateIds.length > 0 ? duplicateIds.join(",") : "none"}`);
console.log(`incompleteRows=${incomplete.length > 0 ? incomplete.map((phase) => phase.id).join(",") : "none"}`);
console.log(`unparkedOrUnassigned=${unparkedInput.length > 0 ? unparkedInput.map((phase) => phase.id).join(",") : "none"}`);
console.log(`recommendedNextPhase=${next ? `${next.id}: ${next.deliverable}` : "none"}`);

if (duplicateIds.length > 0 || incomplete.length > 0 || unparkedInput.length > 0) {
  process.exitCode = 1;
}
