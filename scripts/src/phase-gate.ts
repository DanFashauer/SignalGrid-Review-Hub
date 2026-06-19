import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const unsafeClaimPattern =
  /SignalGrid is production-ready|SignalGrid replaces|SignalGrid is an Imprivata partner|SignalGrid is MFi certified|autonomous production remediation|replaces ServiceNow|replaces PagerDuty|replaces CrowdStrike|replaces Defender|replaces ControlUp|Imprivata partner|MFi certified|replaces Jamf|replaces Intune|replaces Apple Configurator|replaces GroundControl/i;
const redFilePattern =
  /(^|\/)\.env($|\.)|(^|\/)(secrets?|credentials?|tenant|customer|phi|pii)(\.|-|_|\/)/i;
const workflowPattern = /^\.github\/workflows\//;
const scriptPattern = /^scripts\//;
const proofPattern = /(^|\/)proof|fixtures?\/|scenario/i;
const runtimePattern =
  /^(artifacts\/signalgrid-review\/src|lib\/|apps\/|src\/)/;
const docsPattern = /^(docs\/|README\.md$|AGENTS\.md$)/;
const requiredValidation = [
  "pnpm install --frozen-lockfile",
  "pnpm run typecheck",
  "PORT=3000 BASE_PATH=/ pnpm run build",
  "pnpm run proof:intune-entra-posture",
  "pnpm run proof:signalgrid-simulator",
  "pnpm run proof:signalgrid-grid",
  "git diff --check",
];

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

const repoRoot = git(["rev-parse", "--show-toplevel"]);
process.chdir(repoRoot);
const changed = Array.from(
  new Set(
    [
      ...git(["diff", "--name-only"]).split("\n").filter(Boolean),
      ...git(["diff", "--cached", "--name-only"]).split("\n").filter(Boolean),
      ...git(["ls-files", "--others", "--exclude-standard"])
        .split("\n")
        .filter(Boolean),
    ].filter(Boolean),
  ),
).sort();

const stagedUnsafe = git(["diff", "--cached", "--name-only"])
  .split("\n")
  .filter(Boolean)
  .filter((file) => redFilePattern.test(file));
const changedUnsafe = changed.filter((file) => redFilePattern.test(file));
const touchesWorkflow = changed.some((file) => workflowPattern.test(file));
const touchesScripts = changed.some((file) => scriptPattern.test(file));
const touchesProof = changed.some((file) => proofPattern.test(file));
const touchesRuntime = changed.some((file) => runtimePattern.test(file));
const docsOnly =
  changed.length > 0 && changed.every((file) => docsPattern.test(file));

let unsafeClaims = "";
try {
  unsafeClaims = execFileSync(
    "git",
    [
      "grep",
      "-nE",
      unsafeClaimPattern.source,
      "--",
      "README.md",
      "docs",
      "artifacts/signalgrid-review/src",
    ],
    { encoding: "utf8" },
  ).trim();
} catch {
  unsafeClaims = "";
}

const validationDoc = resolve(repoRoot, "docs/VALIDATION_COMMANDS.md");
const validationText = existsSync(validationDoc)
  ? execFileSync("cat", [validationDoc], { encoding: "utf8" })
  : "";
const missingValidation = requiredValidation.filter(
  (command) => !validationText.includes(command),
);

let lane: "GREEN" | "YELLOW" | "RED" = "GREEN";
const reasons: string[] = [];

if (changed.length === 0) reasons.push("no changed files detected");
if (!docsOnly) lane = "YELLOW";
if (touchesWorkflow) reasons.push("touches GitHub Actions workflows");
if (touchesScripts) reasons.push("touches scripts");
if (touchesProof) reasons.push("touches proof, fixture, or scenario files");
if (touchesRuntime) reasons.push("touches runtime or UI code");
if (!docsOnly) reasons.push("not docs-only");
if (changedUnsafe.length > 0 || stagedUnsafe.length > 0) {
  lane = "RED";
  reasons.push(`unsafe file path detected: ${changedUnsafe.join(", ")}`);
}
if (unsafeClaims) {
  reasons.push("unsafe claim scan matched protected wording for manual review");
}
if (missingValidation.length > 0)
  reasons.push(
    `validation command documentation missing: ${missingValidation.join("; ")}`,
  );

console.log("Phase gate");
console.log(
  `changedFiles=${changed.length === 0 ? "none" : changed.join(",")}`,
);
console.log(`docsOnly=${docsOnly}`);
console.log(`touchesWorkflows=${touchesWorkflow}`);
console.log(`touchesScripts=${touchesScripts}`);
console.log(`touchesProofs=${touchesProof}`);
console.log(`touchesRuntime=${touchesRuntime}`);
console.log(`unsafeClaims=${unsafeClaims ? "found" : "clean"}`);
console.log(`phaseLane=${lane}`);
if (reasons.length > 0) console.log(`reasons=${reasons.join(" | ")}`);

if (lane === "RED") process.exitCode = 1;
