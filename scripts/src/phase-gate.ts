import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { classifyScanOutput, tallyClaims, UNSAFE_CLAIM_SOURCE } from "./unsafe-claim-classifier";

// Kept as a RegExp for the grep call below. The source string now lives in the
// classifier so the pattern and the negation-awareness that interprets it cannot drift.
const unsafeClaimPattern = new RegExp(UNSAFE_CLAIM_SOURCE, "i");
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

// PHASE_GATE_INJECT_SCAN_HIT exists so `--self-test` can prove the exit wiring
// END TO END, on the real tree, without editing a doc. It can only ADD a scan
// line, never remove or clear one, so it cannot loosen this gate — the strictest
// thing it can do is make the run fail. Set by the self-test below and nowhere else.
const injectedScanHit = process.env.PHASE_GATE_INJECT_SCAN_HIT ?? "";
const unsafeClaims = [
  gitOrEmpty([
    "grep",
    "-nE",
    unsafeClaimPattern.source,
    "--",
    "README.md",
    "docs",
    "artifacts/signalgrid-review/src",
  ]),
  injectedScanHit,
]
  .filter((part) => part !== "")
  .join("\n");

const validationDoc = resolve(repoRoot, "docs/VALIDATION_COMMANDS.md");
// readFileSync, not a spawned `cat` (CodeQL #9): same bytes, no child process.
const validationText = existsSync(validationDoc)
  ? readFileSync(validationDoc, "utf8")
  : "";
const missingValidation = requiredValidation.filter(
  (command) => !validationText.includes(command),
);

// ── WHAT THIS GATE GATES, AND WHAT IT ONLY REPORTS ──────────────────────────
//
// GATED (exit 1): an unsafe file path; an AFFIRMATIVE unsafe claim; a required
// validation command missing from docs/VALIDATION_COMMANDS.md. Each is an
// unambiguous defect, and each now sets `blocking`.
//
// REPORTED (exit 0): the review lane itself. YELLOW means "a human reads this
// diff", which is the ordinary state of every non-docs-only pull request — a gate
// that failed on it would be a gate that fails always, and a gate that fails
// always gets switched off.
//
// THIS DISTINCTION USED TO BE ABSENT AND THE COMMENTS CLAIMED OTHERWISE. Until
// 2026-09-06 the only exit-setting line was `if (lane === "RED")`, and RED was
// reachable ONLY from `redFilePattern`. The comment below said escalating to
// YELLOW was what stopped a dropped validation command from "exiting GREEN"; it
// exited 0 either way, so the escalation changed a printed string and nothing
// else. Measured on this tree that same day: the gate printed
// `unsafeClaims=ASSERTED`, named the offending file and line, and exited 0.
type Lane = "GREEN" | "YELLOW" | "RED";
interface LaneInput {
  readonly changedCount: number;
  readonly docsOnly: boolean;
  readonly touchesWorkflow: boolean;
  readonly touchesScripts: boolean;
  readonly touchesProof: boolean;
  readonly touchesRuntime: boolean;
  readonly unsafePaths: readonly string[];
  readonly affirmativeClaims: readonly string[];
  readonly missingValidation: readonly string[];
}
interface LaneVerdict {
  readonly lane: Lane;
  readonly reasons: readonly string[];
  /** Non-empty ⇒ exit 1. The gated half. */
  readonly blocking: readonly string[];
}

/** Pure, so the self-test below drives the SAME function the live run uses rather
 *  than a re-implementation of it that can drift. */
function decideLane(input: LaneInput): LaneVerdict {
  let lane: Lane = "GREEN";
  const reasons: string[] = [];
  const blocking: string[] = [];

  if (input.changedCount === 0) reasons.push("no changed files detected");
  if (!input.docsOnly) lane = "YELLOW";
  if (input.touchesWorkflow) reasons.push("touches GitHub Actions workflows");
  if (input.touchesScripts) reasons.push("touches scripts");
  if (input.touchesProof) reasons.push("touches proof, fixture, or scenario files");
  if (input.touchesRuntime) reasons.push("touches runtime or UI code");
  if (!input.docsOnly) reasons.push("not docs-only");
  if (input.unsafePaths.length > 0) {
    lane = "RED";
    const r = `unsafe file path detected: ${input.unsafePaths.join(", ")}`;
    reasons.push(r);
    blocking.push(r);
  }
  // CLASSIFY, don't just count. The raw grep cannot distinguish "SignalGrid is an
  // Imprivata partner" from "SignalGrid is NOT an Imprivata partner", so escalating on a
  // raw hit escalated on every honest disclaimer this repository deliberately publishes —
  // and, measured, on nothing else. Only an AFFIRMATIVE hit moves the lane now. The other
  // categories are still counted and printed: a scan that silently dropped them could not
  // tell a clean repo from a broken scanner.
  if (input.affirmativeClaims.length > 0) {
    if (lane === "GREEN") lane = "YELLOW";
    const r = `unsafe claim asserted (not disclaimed): ${input.affirmativeClaims.join(", ")}`;
    reasons.push(r);
    blocking.push(r);
  }
  if (input.missingValidation.length > 0) {
    // Documented-validation drift must actually move the lane AND the exit code.
    // Escalate to at least YELLOW (manual review); never downgrade an already-RED lane.
    if (lane === "GREEN") lane = "YELLOW";
    const r = `validation command documentation missing: ${input.missingValidation.join("; ")}`;
    reasons.push(r);
    blocking.push(r);
  }
  return { lane, reasons, blocking };
}

// ── SELF-TEST: each gated condition must actually block, and the routine lane
// must not. A gate whose escalation cannot be observed is the defect above,
// returned. `--self-test` runs no git and reads no tree.
if (process.argv.includes("--self-test")) {
  const base: LaneInput = {
    changedCount: 1, docsOnly: true, touchesWorkflow: false, touchesScripts: false,
    touchesProof: false, touchesRuntime: false, unsafePaths: [], affirmativeClaims: [],
    missingValidation: [],
  };
  const cases: Array<readonly [string, LaneInput, Lane, boolean]> = [
    ["clean docs-only change", base, "GREEN", false],
    ["routine non-docs change is REPORTED, not gated",
      { ...base, docsOnly: false, touchesScripts: true }, "YELLOW", false],
    ["an unreadable/empty change set is REPORTED as YELLOW, not gated",
      { ...base, changedCount: 0, docsOnly: false }, "YELLOW", false],
    ["an affirmative unsafe claim BLOCKS",
      { ...base, affirmativeClaims: ["docs/X.md:1"] }, "YELLOW", true],
    ["a missing documented validation command BLOCKS",
      { ...base, missingValidation: ["pnpm run typecheck"] }, "YELLOW", true],
    ["an unsafe file path BLOCKS and is RED",
      { ...base, unsafePaths: [".env.production"] }, "RED", true],
    ["RED is never downgraded by a later escalation",
      { ...base, unsafePaths: [".env"], affirmativeClaims: ["docs/X.md:1"], missingValidation: ["x"] },
      "RED", true],
  ];
  const failures: string[] = [];
  for (const [name, input, expectLane, expectBlock] of cases) {
    const v = decideLane(input);
    const ok = v.lane === expectLane && v.blocking.length > 0 === expectBlock;
    console.log(`  ${ok ? "ok" : "FAIL"} — ${name} (lane=${v.lane} blocking=${v.blocking.length})`);
    if (!ok) failures.push(name);
  }
  // Non-vacuity: the two escalations that were unobservable before this change must
  // differ from the routine lane in EXIT, not merely in printed text.
  const routine = decideLane({ ...base, docsOnly: false });
  const claimed = decideLane({ ...base, docsOnly: false, affirmativeClaims: ["docs/X.md:1"] });
  if (routine.lane !== claimed.lane) failures.push("expected both to print YELLOW — the printed lane is not the discriminator");
  if (routine.blocking.length !== 0 || claimed.blocking.length !== 1) {
    failures.push("an affirmative claim must be distinguishable from a routine YELLOW by the EXIT CODE");
  }
  // ── AND THE WIRING, END TO END ────────────────────────────────────────────
  // Everything above tests decideLane(). The defect this file was carrying lived
  // in the LAST LINE of the file, not in the lane arithmetic: `blocking` can be
  // computed perfectly and still be thrown away by `if (lane === "RED")`. So the
  // self-test re-runs this very script as a child, once clean and once with a
  // synthetic affirmative claim injected into the scan output, and compares the
  // real process exit codes.
  const SYNTH = "docs/__phase_gate_self_test__.md:1:SignalGrid is MFi certified.";
  const self = fileURLToPath(import.meta.url);
  const run = (env: NodeJS.ProcessEnv) =>
    spawnSync(process.execPath, [...process.execArgv, self], {
      encoding: "utf8",
      env: { ...process.env, PHASE_GATE_INJECT_SCAN_HIT: "", ...env },
    });
  const baseline = run({});
  const planted = run({ PHASE_GATE_INJECT_SCAN_HIT: SYNTH });
  const blockingOf = (out: string) =>
    (out.split("\n").find((l) => l.startsWith("blockingReasons=")) ?? "blockingReasons=<absent>").slice("blockingReasons=".length);
  const baseBlocking = blockingOf(baseline.stdout ?? "");
  const plantBlocking = blockingOf(planted.stdout ?? "");
  console.log(`  baseline: exit=${baseline.status} blockingReasons=${baseBlocking}`);
  console.log(`  planted : exit=${planted.status} blockingReasons=${plantBlocking}`);
  if (baseBlocking.includes("__phase_gate_self_test__")) {
    failures.push("the synthetic claim appeared in the BASELINE run — the injection leaked");
  }
  if (!plantBlocking.includes("__phase_gate_self_test__")) {
    failures.push("a planted affirmative claim did not reach blockingReasons — the scan or the classifier is inert");
  }
  if (planted.status !== 1) {
    failures.push(`a planted affirmative claim must exit 1; got ${planted.status} — the lane escalation is not wired to the exit code`);
  }
  const wiringCases = 3;
  const total = cases.length + 1 + wiringCases;
  console.log(`\nphase-gate self-test ${failures.length === 0 ? "pass" : "FAIL"} (${total - failures.length}/${total})`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

const claimTally = tallyClaims(classifyScanOutput(unsafeClaims));
const { lane, reasons, blocking } = decideLane({
  changedCount: changed.length,
  docsOnly,
  touchesWorkflow,
  touchesScripts,
  touchesProof,
  touchesRuntime,
  unsafePaths: uniqueSorted([...changedUnsafe, ...stagedUnsafe]),
  affirmativeClaims: claimTally.affirmative.map((c) => `${c.file}:${c.line}`),
  missingValidation,
});

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
// Both numbers are printed. The old line said "found" on literally every run, so it
// could not distinguish a repo with an unsafe claim from one without; the affirmative
// count is the one that can actually change, and the mention breakdown is kept so a
// sudden collapse in disclaimers is visible too.
console.log(`unsafeClaims=${claimTally.affirmative.length > 0 ? "ASSERTED" : "clean"}`);
console.log(
  `unsafeClaimMentions=total:${claimTally.total} affirmative:${claimTally.affirmative.length} ` +
    `disclaimed:${claimTally.disclaimed} selfReferential:${claimTally.selfReferential} ` +
    `registry:${claimTally.registry} notAHit:${claimTally.notAHit}`,
);
console.log(`phaseLane=${lane}`);
if (reasons.length > 0) console.log(`reasons=${reasons.join(" | ")}`);
console.log(`blockingReasons=${blocking.length === 0 ? "none" : blocking.join(" | ")}`);
console.log(
  "GATED (exit 1): unsafe file path, affirmative unsafe claim, missing documented validation command. " +
    "REPORTED (exit 0): the review lane — YELLOW means a human reads this diff, which is the ordinary state of a code change.",
);

if (blocking.length > 0) process.exitCode = 1;
