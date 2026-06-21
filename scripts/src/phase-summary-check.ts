import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const summaryPath = resolve(
  repoRoot,
  process.env.PHASE_SUMMARY_FILE ?? "docs/AUTOMATION_PHASE_TEMPLATE.md",
);
const text = readFileSync(summaryPath, "utf8");
const requiredSections = [
  "Summary",
  "What changed",
  "Validation",
  "Public-safety note",
  "Remaining risks",
  "Merge lane",
];
const missing = requiredSections.filter(
  (section) => !new RegExp(`(^|\\n)\\s*-?\\s*${section}\\b`, "i").test(text),
);

console.log("Phase summary check");
console.log(`file=${summaryPath}`);
console.log(`required=${requiredSections.join(", ")}`);
console.log(`summary=${missing.length === 0 ? "pass" : "fail"}`);
if (missing.length > 0) {
  console.error(`missing=${missing.join(", ")}`);
  process.exitCode = 1;
}
