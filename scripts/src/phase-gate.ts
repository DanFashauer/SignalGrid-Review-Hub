import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const unsafeClaimPattern =
  /SignalGrid is production-ready|SignalGrid replaces|SignalGrid is an Imprivata partner|SignalGrid is MFi certified|autonomous production remediation|replaces ServiceNow|replaces PagerDuty|replaces CrowdStrike|replaces Defender|replaces ControlUp|Imprivata partner|MFi certified|replaces Jamf|replaces Intune|replaces Apple Configurator|replaces GroundControl/i;
const unsafeClaimScanCommand =
  'git grep -nE "SignalGrid is production-ready|SignalGrid replaces|SignalGrid is an Imprivata partner|SignalGrid is MFi certified|autonomous production remediation|replaces ServiceNow|replaces PagerDuty|replaces CrowdStrike|replaces Defender|replaces ControlUp|Imprivata partner|MFi certified|replaces Jamf|replaces Intune|replaces Apple Configurator|replaces GroundControl" -- README.md docs artifacts/signalgrid-review/src || true';
const redFilePattern =
  /(^|\/)\.env($|\.)|(^|\/)secrets?\/|(^|\/)credentials?\/|(^|\/)credential-store\/|(^|\/)credentials?(?:\.env|\.secret|\.json$|[-_](?:secret|store|token|key|prod|production))|(^|\/)(?:tenant|customer|phi|pii)(?:\.|-|_|\/)/i;
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
  "pnpm run proof:microsoft-graph-sandbox",
  "pnpm run proof:connector-emulator",
  "pnpm run phase:gate",
  "pnpm run phase:summary-check",
  unsafeClaimScanCommand,
  "git diff --check",
];

type ChangedFileSource = "pr-diff" | "local-worktree";

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function gitOrEmpty(args: string[]): string {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function uniqueSorted(files: string[]): string[] {
  return Array.from(new Set(files.filter(Boolean))).sort();
}

function splitLines(output: string): string[] {
  return output.split("\n").filter(Boolean);
}

const repoRoot = git(["rev-parse", "--show-toplevel"]);
process.chdir(repoRoot);

function getPrDiffFiles(): string[] {
  const baseRef = process.env.PHASE_BASE_REF ?? process.env.GITHUB_BASE_REF;
  const headRef = process.env.PHASE_HEAD_REF ?? process.env.GITHUB_HEAD_REF;
  const eventName = process.env.GITHUB_EVENT_NAME;

  if (!baseRef) return [];

  if (eventName === "pull_request" || process.env.GITHUB_BASE_REF) {
    gitOrEmpty(["fetch", "origin", baseRef, "--depth=1"]);
  }

  const base = baseRef.startsWith("origin/") ? baseRef : `origin/${baseRef}`;
  const head = process.env.PHASE_HEAD_REF ? (headRef ?? "HEAD") : "HEAD";
  const diff = gitOrEmpty(["diff", "--name-only", `${base}...${head}`]);

  if (diff) return splitLines(diff);

  const localBaseDiff = gitOrEmpty([
    "diff",
    "--name-only",
    `${baseRef}...HEAD`,
  ]);
  return splitLines(localBaseDiff);
}

function getLocalWorktreeFiles(): string[] {
  return [
    ...splitLines(gitOrEmpty(["diff", "--name-only"])),
    ...splitLines(gitOrEmpty(["diff", "--cached", "--name-only"])),
    ...splitLines(gitOrEmpty(["ls-files", "--others", "--exclude-standard"])),
  ];
}

const prDiffFiles = getPrDiffFiles();
const changedSource: ChangedFileSource =
  prDiffFiles.length > 0 ? "pr-diff" : "local-worktree";
const changed = uniqueSorted(
  changedSource === "pr-diff" ? prDiffFiles : getLocalWorktreeFiles(),
);

const stagedUnsafe = splitLines(gitOrEmpty(["diff", "--cached", "--name-only"]))
  .filter(Boolean)
  .filter((file) => redFilePattern.test(file));
const changedUnsafe = changed.filter((file) => redFilePattern.test(file));
const touchesWorkflow = changed.some((file) => workflowPattern.test(file));
const touchesScripts = changed.some((file) => scriptPattern.test(file));
const touchesProof = changed.some((file) => proofPattern.test(file));
const touchesRuntime = changed.some((file) => runtimePattern.test(file));
const docsOnly =
  changed.length > 0 && changed.every((file) => docsPattern.test(file));

const unsafeClaims = gitOrEmpty([
  "grep",
  "-nE",
  unsafeClaimPattern.source,
  "--",
  "README.md",
  "docs",
  "artifacts/signalgrid-review/src",
]);

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
  if (lane === "GREEN") lane = "YELLOW";
  reasons.push("unsafe claim scan matched protected wording for manual review");
}
if (missingValidation.length > 0) {
  // Documented-validation drift must actually move the lane, not just log a
  // reason — otherwise a change that drops a required validation command from
  // docs/VALIDATION_COMMANDS.md exits GREEN. Escalate to at least YELLOW (manual
  // review); never downgrade an already-RED lane.
  if (lane === "GREEN") lane = "YELLOW";
  reasons.push(
    `validation command documentation missing: ${missingValidation.join("; ")}`,
  );
}

console.log("Phase gate");
console.log(`changedSource=${changedSource}`);
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
