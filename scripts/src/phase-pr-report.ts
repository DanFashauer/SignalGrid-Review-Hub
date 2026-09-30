import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { classifyScanOutput, RED_FILE_PATTERN, tallyClaims, UNSAFE_CLAIM_SOURCE } from "./unsafe-claim-classifier";

// THIS FILE REPORTS, AND FAILS ON ONE THING. It writes the artifact on every run, then
// exits 1 when the lane is RED (`merge_recommendation: block_merge`), plan row 144.
// Until 2026-09-30 it exited 0 always and nothing read the artifact, so `block_merge`
// was a printed word on a green job. YELLOW still exits 0: "a human reads this diff"
// is the ordinary state of every non-docs PR, and a gate that fails always gets
// switched off. RED is reachable only from `RED_FILE_PATTERN`, the SAME pattern
// `phase-gate.ts` gates on, so this cannot go red where the gate would not.
type ChangedSource = "pr-diff" | "local-worktree";

// Imported, not re-typed. This file used to carry its own verbatim copy of the
// denylist AND its own naive grep — the exact scan `phase-gate.ts` was rewritten to
// stop trusting, because it returns a hit on every honest disclaimer this repository
// publishes and therefore printed `review_required` on every run it had ever made.
// Two files sharing a denylist and disagreeing about how to read it is how the
// original defect happened; there is now one source and one reader.
const unsafeClaimPattern = UNSAFE_CLAIM_SOURCE;

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

/** `git grep` exits 1 for "no match" and >1 for "could not search". The claim scan
 *  used `gitOrEmpty`, so both read as "" — a failed scan reported clean (row 144,
 *  third defect). Anything but 0 or 1 is now returned as a failure, never as clean. */
function gitGrep(args: string[]): { ok: true; out: string } | { ok: false; why: string } {
  try {
    return { ok: true, out: execFileSync("git", ["grep", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim() };
  } catch (error) {
    const e = error as { status?: number | null; stderr?: string };
    if (e.status === 1) return { ok: true, out: "" };
    return { ok: false, why: `git grep exited ${e.status ?? "without a status"}${e.stderr ? `: ${String(e.stderr).trim()}` : ""}` };
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
  // CI-only, as in phase-gate.ts: a `--depth=1` fetch in the shared local checkout
  // makes the whole repository shallow (lesson L10, docs/agent/LESSONS.md).
  if (process.env.GITHUB_BASE_REF) gitOrEmpty(["fetch", "origin", baseRef, "--depth=1"]);
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


interface LaneInput {
  readonly changedFiles: readonly string[];
  readonly unsafeClaimAsserted: boolean;
  /** The claim scan could not run. Never the same as a scan that found nothing. */
  readonly claimScanFailed?: boolean;
}
interface LaneVerdict {
  readonly riskLane: "GREEN" | "YELLOW" | "RED";
  readonly reasons: readonly string[];
}

/** The exit code for a lane: only RED (`block_merge`) fails. Pure for the self-test. */
function exitCodeFor(lane: LaneVerdict["riskLane"]): 0 | 1 {
  return lane === "RED" ? 1 : 0;
}

/** Pure, so the self-test drives the same arithmetic the live run does.
 *
 *  THE EMPTY CHANGE SET IS ITS OWN ESCALATION, and that is the 2026-09-06 fix.
 *  Every git call here goes through `gitOrEmpty`, which returns "" on any failure —
 *  a base ref that will not fetch, a shallow clone, an offline runner, an unset
 *  GITHUB_BASE_REF. All of those produced `changedFiles = []`, which is byte-identical
 *  to "this PR changes nothing", and with an empty set every `touches_*` term is false,
 *  so the lane fell to GREEN / owner_merge_after_checks. An UNREADABLE DIFF LOOSENED
 *  THE MERGE ADVICE. The sibling gate `phase-gate.ts:111-112` already did the opposite
 *  (`docsOnly = changed.length > 0 && …`), so the two disagreed on identical state.
 *  Fail-closed: unreadable is never clean. */
function decideLane(input: LaneInput): LaneVerdict {
  const reasons: string[] = [];
  const unsafePaths = input.changedFiles.filter((file) => RED_FILE_PATTERN.test(file));
  if (unsafePaths.length > 0) {
    return { riskLane: "RED", reasons: [`unsafe file path: ${unsafePaths.join(", ")}`] };
  }
  if (input.changedFiles.length === 0) {
    reasons.push(
      "could not read a change set — an unreadable base ref, a shallow clone and a genuinely empty PR are indistinguishable here, so this is never treated as clean",
    );
  }
  if (input.changedFiles.some((f) => /^(artifacts\/signalgrid-review\/src|lib\/|apps\/|src\/)/.test(f))) reasons.push("touches runtime");
  if (input.changedFiles.some((f) => f.startsWith("scripts/"))) reasons.push("touches scripts");
  if (input.changedFiles.some((f) => f.startsWith(".github/workflows/"))) reasons.push("touches workflows");
  if (input.changedFiles.some((f) => f.startsWith("fixtures/") || /proof|scenario/i.test(f))) reasons.push("touches fixtures/proofs");
  if (input.unsafeClaimAsserted) reasons.push("an unsafe claim is ASSERTED (not disclaimed) in the scanned paths");
  if (input.claimScanFailed) reasons.push("the unsafe-claim scan could not run, so it is never reported clean");
  return { riskLane: reasons.length > 0 ? "YELLOW" : "GREEN", reasons };
}

if (process.argv.includes("--self-test")) {
  const cases: Array<readonly [string, LaneInput, "GREEN" | "YELLOW" | "RED", string | null]> = [
    ["a docs-only change is GREEN", { changedFiles: ["docs/A.md"], unsafeClaimAsserted: false }, "GREEN", null],
    ["an EMPTY change set is YELLOW, not GREEN", { changedFiles: [], unsafeClaimAsserted: false }, "YELLOW", "could not read a change set"],
    ["...and it says WHY, not just that", { changedFiles: [], unsafeClaimAsserted: false }, "YELLOW", "unreadable base ref"],
    ["a runtime change is YELLOW", { changedFiles: ["lib/x.ts"], unsafeClaimAsserted: false }, "YELLOW", "touches runtime"],
    ["an asserted unsafe claim is YELLOW even on a docs-only diff", { changedFiles: ["docs/A.md"], unsafeClaimAsserted: true }, "YELLOW", "ASSERTED"],
    ["an unsafe path is RED", { changedFiles: ["docs/A.md", ".env.production"], unsafeClaimAsserted: false }, "RED", "unsafe file path"],
    ["RED wins over an empty set", { changedFiles: [".env"], unsafeClaimAsserted: true }, "RED", "unsafe file path"],
    ["a failed claim scan is YELLOW, not GREEN", { changedFiles: ["docs/A.md"], unsafeClaimAsserted: false, claimScanFailed: true }, "YELLOW", "could not run"],
    ["a tenant-NAMED fixture is not an unsafe path (same pattern as phase-gate)", { changedFiles: ["docs/A.md", "artifacts/api-collection/adversarial-trust/cross-tenant-refs.bru"], unsafeClaimAsserted: false }, "GREEN", null],
    ["a tenant data directory is RED", { changedFiles: ["tenant/acme.json"], unsafeClaimAsserted: false }, "RED", "unsafe file path"],
  ];
  const failures: string[] = [];
  for (const [name, input, expect, mustSay] of cases) {
    const v = decideLane(input);
    const ok = v.riskLane === expect && (mustSay === null || v.reasons.join(" | ").includes(mustSay));
    console.log(`  ${ok ? "ok" : "FAIL"} — ${name} (lane=${v.riskLane}; reasons=${v.reasons.join(" | ") || "none"})`);
    if (!ok) failures.push(name);
  }
  // NON-VACUITY: the empty set and the clean docs-only set must not agree. If they
  // ever do, the escalation above has been deleted and every case still "passes".
  if (decideLane({ changedFiles: [], unsafeClaimAsserted: false }).riskLane ===
      decideLane({ changedFiles: ["docs/A.md"], unsafeClaimAsserted: false }).riskLane) {
    failures.push("an unreadable change set and a clean docs-only change reach the SAME lane — the escalation is inert");
  }
  // EXIT WIRING (row 144): block_merge must fail the step, and nothing below RED may.
  const exitCases: Array<readonly [LaneVerdict["riskLane"], 0 | 1]> = [["RED", 1], ["YELLOW", 0], ["GREEN", 0]];
  for (const [lane, want] of exitCases) {
    const got = exitCodeFor(lane);
    console.log(`  ${got === want ? "ok" : "FAIL"} — lane ${lane} exits ${want} (got ${got})`);
    if (got !== want) failures.push(`lane ${lane} exits ${got}, expected ${want}`);
  }
  // END TO END: exitCodeFor() can be right while the last line throws it away (the
  // original defect). Re-run THIS script as a child with one planted unsafe path and
  // read the real process exit code and the report it wrote to a scratch dir.
  const scratch = mkdtempSync(join(tmpdir(), "phase-pr-report-selftest-"));
  const reportPath = join(scratch, "PHASE_REPORT.txt");
  const planted = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url)], {
    encoding: "utf8",
    env: { ...process.env, PHASE_REPORT_INJECT_CHANGED_FILE: ".env.phase-pr-report-self-test", PHASE_REPORT_PATH: reportPath },
  });
  let plantedReport = "";
  try { plantedReport = readFileSync(reportPath, "utf8"); } catch { /* absent report is itself a failure below */ }
  rmSync(scratch, { recursive: true, force: true });
  const e2eOk = planted.status === 1 && plantedReport.includes("merge_recommendation: block_merge");
  console.log(`  ${e2eOk ? "ok" : "FAIL"} — a planted unsafe path exits 1 end to end and still writes block_merge (exit=${planted.status}, report ${plantedReport ? "written" : "ABSENT"})`);
  if (!e2eOk) failures.push(`a planted unsafe path must exit 1 with a block_merge report; got exit=${planted.status}, report ${plantedReport ? "without block_merge" : "absent"} — the RED lane is not wired to the exit code`);
  const total = cases.length + 1 + exitCases.length + 1;
  console.log(`\nphase-pr-report self-test ${failures.length === 0 ? "pass" : "FAIL"} (${total - failures.length}/${total}); the real report was NOT written.`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

const diffFiles = prDiffFiles();
const changedSource: ChangedSource = diffFiles.length > 0 ? "pr-diff" : "local-worktree";
// PHASE_REPORT_INJECT_CHANGED_FILE exists only for `--self-test`'s end-to-end case. It
// can only ADD a path, never remove one, so the strictest thing it can do is fail the run.
const injectedChangedFile = process.env.PHASE_REPORT_INJECT_CHANGED_FILE ?? "";
const changedFiles = uniqueSorted([
  ...(changedSource === "pr-diff" ? diffFiles : localFiles()),
  ...(injectedChangedFile ? [injectedChangedFile] : []),
]);

const touchesDocs = changedFiles.some((file) => file === "README.md" || file.startsWith("docs/"));
const touchesRuntime = changedFiles.some((file) => /^(artifacts\/signalgrid-review\/src|lib\/|apps\/|src\/)/.test(file));
const touchesScripts = changedFiles.some((file) => file.startsWith("scripts/"));
const touchesWorkflows = changedFiles.some((file) => file.startsWith(".github/workflows/"));
const touchesFixtures = changedFiles.some((file) => file.startsWith("fixtures/") || /proof|scenario/i.test(file));
const claimScan = gitGrep(["-nE", unsafeClaimPattern, "--", "README.md", "docs", "artifacts/signalgrid-review/src"]);
const claimTally = tallyClaims(classifyScanOutput(claimScan.ok ? claimScan.out : ""));
const unsafeClaimScan =
  (claimScan.ok ? "" : `FAILED (${claimScan.why}) `) +
  `${!claimScan.ok || claimTally.affirmative.length > 0 ? "review_required" : "clean"} ` +
  `(mentions total:${claimTally.total} affirmative:${claimTally.affirmative.length} ` +
  `disclaimed:${claimTally.disclaimed} selfReferential:${claimTally.selfReferential} ` +
  `registry:${claimTally.registry} notAHit:${claimTally.notAHit})`;

const { riskLane, reasons: riskLaneReasons } = decideLane({
  changedFiles,
  unsafeClaimAsserted: claimTally.affirmative.length > 0,
  claimScanFailed: !claimScan.ok,
});

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
  `risk_lane_reasons: ${riskLaneReasons.length > 0 ? riskLaneReasons.join(" | ") : "none"}`,
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
const exitCode = exitCodeFor(riskLane);
console.log(
  exitCode === 1
    ? "BLOCKED: risk_lane RED, merge_recommendation block_merge — exiting 1. The report above was still written."
    : `risk_lane ${riskLane} does not block (only RED / block_merge exits 1); the gating twin \`pnpm run phase:gate\` also runs in this job.`,
);
process.exitCode = exitCode;
