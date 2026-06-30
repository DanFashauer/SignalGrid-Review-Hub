import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type ChangedSource = "pr-diff" | "local-worktree";

const unsafeClaimPattern =
  "SignalGrid is production-ready|SignalGrid replaces|SignalGrid is an Imprivata partner|SignalGrid is MFi certified|autonomous production remediation|replaces ServiceNow|replaces PagerDuty|replaces CrowdStrike|replaces Defender|replaces ControlUp|Imprivata partner|MFi certified|replaces Jamf|replaces Intune|replaces Apple Configurator|replaces GroundControl";

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

function lines(value: string): string[] {
  return value.split("\n").map((line) => line.trim()).filter(Boolean);
}

function uniqueSorted(files: string[]): string[] {
  return Array.from(new Set(files)).sort();
}

const repoRoot = git(["rev-parse", "--show-toplevel"]);
process.chdir(repoRoot);

function prDiffFiles(): string[] {
  const baseRef = process.env.PHASE_BASE_REF ?? process.env.GITHUB_BASE_REF;
  if (!baseRef) return [];
  gitOrEmpty(["fetch", "origin", baseRef, "--depth=1"]);
  const base = baseRef.startsWith("origin/") ? baseRef : `origin/${baseRef}`;
  return lines(gitOrEmpty(["diff", "--name-only", `${base}...HEAD`]));
}

function localFiles(): string[] {
  return [
    ...lines(gitOrEmpty(["diff", "--name-only"])),
    ...lines(gitOrEmpty(["diff", "--cached", "--name-only"])),
    ...lines(gitOrEmpty(["ls-files", "--others", "--exclude-standard"])),
  ];
}

const diffFiles = prDiffFiles();
const changedSource: ChangedSource = diffFiles.length > 0 ? "pr-diff" : "local-worktree";
const changedFiles = uniqueSorted(changedSource === "pr-diff" ? diffFiles : localFiles());

const touchesDocs = changedFiles.some((file) => file === "README.md" || file.startsWith("docs/"));
const touchesRuntime = changedFiles.some((file) => /^(artifacts\/signalgrid-review\/src|lib\/|apps\/|src\/)/.test(file));
const touchesScripts = changedFiles.some((file) => file.startsWith("scripts/"));
const touchesWorkflows = changedFiles.some((file) => file.startsWith(".github/workflows/"));
const touchesFixtures = changedFiles.some((file) => file.startsWith("fixtures/") || /proof|scenario/i.test(file));
const unsafeClaimScan = gitOrEmpty([
  "grep",
  "-nE",
  unsafeClaimPattern,
  "--",
  "README.md",
  "docs",
  "artifacts/signalgrid-review/src",
])
  ? "review_required"
  : "clean";

const riskLane = changedFiles.some((file) => /(^|\/)\.env($|\.)|secret|tenant|customer|phi|pii/i.test(file))
  ? "RED"
  : touchesRuntime || touchesScripts || touchesWorkflows || touchesFixtures || unsafeClaimScan !== "clean"
    ? "YELLOW"
    : "GREEN";

const ownerAction = riskLane === "GREEN" ? "owner_merge_after_checks" : riskLane === "YELLOW" ? "explicit_owner_approval_before_merge" : "blocked_owner_decision_required";
const mergeRecommendation = riskLane === "GREEN" ? "prepare_owner_merge_if_checks_pass" : riskLane === "YELLOW" ? "do_not_auto_merge_owner_review_required" : "block_merge";
const phaseId = process.env.PHASE_ID ?? "autopilot-control-plane";
const prNumber = process.env.GITHUB_EVENT_NAME === "pull_request" ? (process.env.GITHUB_REF_NAME?.split("/")[0] ?? "unknown") : (process.env.PR_NUMBER ?? "manual");
const headSha = process.env.GITHUB_SHA ?? gitOrEmpty(["rev-parse", "HEAD"]);

const report = [
  "PHASE_REPORT",
  `phase_id: ${phaseId}`,
  `risk_lane: ${riskLane}`,
  `pr_number: ${prNumber}`,
  `head_sha: ${headSha}`,
  `changed_source: ${changedSource}`,
  `changed_files: ${changedFiles.length > 0 ? changedFiles.join(", ") : "none"}`,
  `touches_docs: ${touchesDocs}`,
  `touches_runtime: ${touchesRuntime}`,
  `touches_scripts: ${touchesScripts}`,
  `touches_workflows: ${touchesWorkflows}`,
  `touches_fixtures: ${touchesFixtures}`,
  `unsafe_claim_scan: ${unsafeClaimScan}`,
  "validation_expected: pnpm run phase:gate; pnpm run phase:summary-check; relevant proof/build checks; unsafe-claim scan; git diff --check",
  "workflow_artifacts_expected: phase-pr-report",
  `owner_action_required: ${ownerAction}`,
  `merge_recommendation: ${mergeRecommendation}`,
  "next_phase: choose highest-priority eligible backlog item; keep one phase per PR",
  "END_PHASE_REPORT",
  "",
].join("\n");

const outputPath = resolve(repoRoot, process.env.PHASE_REPORT_PATH ?? "artifacts/phase-pr-report/PHASE_REPORT.txt");
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, report);
console.log(report);
console.log(`wrote=${outputPath}`);
