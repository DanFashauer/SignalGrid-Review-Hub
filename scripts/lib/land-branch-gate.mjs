import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Pure push-gate for the land-branch saved workflow (docs/agent/LESSONS.md L2,
// docs/BUILD_BACKLOG.md row "The plan-row measurement tranche is a scripted
// workflow"). This is the single source of truth for "may the chain push?", and
// (below) for "what owner-decision class does this PR carry?" —
// .claude/workflows/land-branch.js inlines a byte-for-byte MIRROR of canPush,
// resolveKlass and ownerDecisionText (the Workflow tool runs that file in a sandbox
// with no import.meta and no filesystem, so it cannot import this module). The
// self-test below reads that file and FAILS when any mirror drifts from its
// function here — change here first, then paste there.
//
//   node scripts/lib/land-branch-gate.mjs --self-test
//
// canPush() takes the Chain-run result (never worker prose) and the expected
// head, and refuses unless: the run's headSha still matches, both exits are
// literally 0, AND both last-line strings EQUAL exactly "PREFLIGHT_EXIT 0
// <expected-head>" / "BREADTH_EXIT 0 <expected-head>" — belt AND suspenders
// against a worker that reports exit:0 while pasting a different log line.
export function canPush(run, expectedHead) {
  const reasons = [];
  if (!run || typeof run !== "object") return { ok: false, reasons: ["no chain-run result"] };
  if (run.headSha !== expectedHead) reasons.push(`headSha ${run.headSha} !== expected ${expectedHead}`);
  if (run.preflightExit !== 0) reasons.push(`preflightExit ${run.preflightExit} !== 0`);
  if (run.breadthExit !== 0) reasons.push(`breadthExit ${run.breadthExit} !== 0`);
  // Exact equality of the WHOLE line, not "contains" — a tag-scoped log can otherwise
  // still hold a PREVIOUS run's "…_EXIT 0 <old-sha>" line (the sentinel is bound to the
  // tag, not the sha), and a substring/"contains" check ALSO passed a line that merely
  // had the expected head somewhere in trailing text (e.g. "PREFLIGHT_EXIT 0 <stale>
  // unrelated=<expected>"). The chain writes the sentinel as exactly `echo
  // "PREFLIGHT_EXIT $? $(git rev-parse HEAD)"`, so no trailing text on that line, and
  // no other head sha earlier on it, is ever legitimate.
  if (run.preflightLastLine !== `PREFLIGHT_EXIT 0 ${expectedHead}`)
    reasons.push(`preflightLastLine is not exactly "PREFLIGHT_EXIT 0 ${expectedHead}": ${JSON.stringify(run.preflightLastLine)}`);
  if (run.breadthLastLine !== `BREADTH_EXIT 0 ${expectedHead}`)
    reasons.push(`breadthLastLine is not exactly "BREADTH_EXIT 0 ${expectedHead}": ${JSON.stringify(run.breadthLastLine)}`);
  return { ok: reasons.length === 0, reasons };
}

// resolveKlass / ownerDecisionText — Codex summary finding 7 on #1126/#1127
// (docs/BUILD_BACKLOG.md: "land-branch.js's 'Owner decision needed' text should be
// derived from the changed paths, not a three-way klass ternary"). The PR-body stage
// used to trust a caller-supplied klass string with no check against the diff, so a
// mis-classified or stacked-and-shifted branch printed an owner-decision paragraph
// that didn't match what the PR actually touched. resolveKlass parses the single
// `KLASS <klass> files=<n> matched=<m>` line
// `scripts/check-owner-gated-surfaces.mjs --classify-branch` prints and lets that
// DERIVED class win over whatever the caller claimed — always, even when the caller
// guessed wrong in the safe direction. ownerDecisionText renders the PR-body
// paragraph for a resolved class (the three branches lifted verbatim from the old
// ternary, plus a new OWNER_RESERVED branch this finding required). Both are
// MIRRORED byte-for-byte into .claude/workflows/land-branch.js next to canPush's
// mirror, for the same reason canPush is: the Workflow sandbox cannot import this
// module. The self-test below proves both mirrors match.
const KLASS_LINE_RE = /^KLASS (OWNER_RESERVED|DECISION_PATH|SAFETY_MACHINERY|other) files=(\d+) matched=(\d+)$/;
const VALID_KLASSES = new Set(["OWNER_RESERVED", "DECISION_PATH", "SAFETY_MACHINERY", "other"]);

export function resolveKlass(callerKlass, derivedLine) {
  const m = KLASS_LINE_RE.exec(String(derivedLine ?? ""));
  if (!m) return { ok: false, reasons: [`derived line does not match the KLASS sentinel shape: ${JSON.stringify(derivedLine)}`] };
  const derivedKlass = m[1];
  const files = Number(m[2]);
  if (files === 0) return { ok: false, reasons: [`derived line reports files=0 (an empty diff is unknown, not "other"): ${JSON.stringify(derivedLine)}`] };
  const matched = Number(m[3]);
  if ((derivedKlass === "other") !== (matched === 0)) return { ok: false, reasons: [`derived line is internally inconsistent (klass ${derivedKlass} with matched=${matched}): ${JSON.stringify(derivedLine)}`] };
  return { ok: true, klass: derivedKlass, callerKlass, overridden: callerKlass !== derivedKlass };
}

// Finding 5 (should-fix, 2026-09-26): the DECISION_PATH paragraph used to be lifted
// verbatim from a caller-chosen, api-server-test-harness context ("its blanket
// artifacts/api-server rule matches <paths>" / "test harness only, no route or verdict
// logic"). Derivation now selects this branch for ANY lib/**, artifacts/api-server/** or
// native-port change, and for a lib/signalgrid-core decision change both statements were
// false reassurance on the most safety-critical class — so the text below names no
// specific rule and asserts nothing about the diff's content; it tells the writer to look.
export function ownerDecisionText(klass) {
  switch (klass) {
    case "SAFETY_MACHINERY":
      return 'write: "SAFETY_MACHINERY (<paths>): merged under DR-037 with check run <id recorded before merge>" - leave "<id recorded before merge>" literally; the coordinator fills it';
    case "DECISION_PATH":
      return 'write: "Yes - DECISION_PATH by scripts/check-owner-gated-surfaces.mjs (name the rule(s) that match <paths>: lib/*, artifacts/api-server/, or a native decision port): the OWNER merges this PR or vetoes it by not merging; the cloud lane will not self-merge it, however green the gauntlet is." and say in one sentence, from the diff, what the change touches (whether it alters any route, verdict or decision logic) so the owner can judge it from the phone';
    case "OWNER_RESERVED":
      return 'write: "OWNER_RESERVED (<paths>): the launch profile, launch-claims gate, publication boundary, pricing, LICENSE/NOTICE or another owner-reserved surface changed — the OWNER merges this PR; the cloud lane will not merge it under DR-037 whatever the checks say." and name the paths';
    case "other":
      return 'write what the owner must decide, or "None - docs/record only, landed under DR-037 with check run <id recorded before merge>"';
    default:
      // Fail closed: an unrecognised klass must never fall through to a default
      // paragraph that understates what changed.
      throw new Error(`ownerDecisionText: unknown klass ${JSON.stringify(klass)}`);
  }
}

// --verify: the DETERMINISTIC push gate the push command itself runs (Codex #1126 P1
// / #1127 summary finding 1 — "have the push command invoke a local validator that
// reads the sentinel files and current HEAD itself"). It never trusts a worker's
// report of what the log files say; it reads them itself, resolves the worktree's
// own HEAD and the branch ref with `git`, and applies the SAME canPush() the script
// already used. Refuses (reasons.length > 0) on: a missing/empty log file, a last
// line that does not match the ANCHORED full-line sentinel shape
// "^<LABEL>_EXIT (-?\d+) ([0-9a-f]{40})$" (Codex #1130 P2 — the previous unanchored
// `${label}_EXIT (-?\d+)` parser matched a "<LABEL>_EXIT 0" prefix anywhere on the
// line and ignored everything after it), a sentinel that parses cleanly but names a
// DIFFERENT head than the one expected, or either ref not resolving to the expected
// head.
function lastNonEmptyLine(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const lines = text.split("\n").filter((l) => l.length > 0);
  return lines.length ? lines[lines.length - 1] : null;
}

function parseSentinelLine(line, label) {
  if (line == null) return null;
  const m = new RegExp(`^${label}_EXIT (-?\\d+) ([0-9a-f]{40})$`).exec(line);
  return m ? { exit: Number(m[1]), sha: m[2] } : null;
}

function revParse(worktree, ref) {
  try {
    return execFileSync("git", ["-C", worktree, "rev-parse", ref], { encoding: "utf8" }).trim();
  } catch (err) {
    return { error: err.message };
  }
}

// Review nit on #1133: the CLASSIFIER's own answer, run against THIS worktree's own
// diff — never a worker's report of what it printed, and never the worktree's OWN
// working copy of the classifier module either. A branch that rewrites
// scripts/check-owner-gated-surfaces.mjs (e.g. emptying every manifest rule) must
// never be able to grade its own diff with the rules it just rewrote, so the module
// source is read from the BASE ref via `git show <baseRef>:scripts/check-owner-gated-
// surfaces.mjs` (never from disk in <worktree>), written to a throwaway file under
// os.tmpdir() (removed afterwards), and run from there with cwd=<worktree> so its own
// `git diff`/`git merge-base` calls still see the worktree's real repo and history.
// This only works because the classifier imports nothing but node builtins (node:fs,
// node:child_process, node:path, node:url, node:os — verified by grepping its imports)
// and never a sibling module, so a copy at an arbitrary temp path runs correctly with
// no relative import to resolve; if a future edit gives it a sibling import, this must
// stop and be reworked, not silently break. stdio is piped, never inherited, matching
// classifyBranch()'s own contract of exactly one printed line.
function classifyBranchOutput(worktree, baseRef) {
  const relPath = "scripts/check-owner-gated-surfaces.mjs";
  let source;
  try {
    source = execFileSync(
      "git",
      ["-C", worktree, "show", `${baseRef}:${relPath}`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (err) {
    // Refuse (reason text) when the base ref's copy cannot be read at all — a missing
    // ref, a missing file at that ref, or any other `git show` failure. This is
    // deliberately NOT a `KLASS ...` shaped string, so it can never accidentally match
    // KLASS_LINE_RE below; it always falls through to the "did not print a KLASS line"
    // refusal in verify().
    const firstLine = String(err.stderr || err.message || "").split("\n")[0].trim();
    return `base ref's classifier unreadable: git -C ${worktree} show ${baseRef}:${relPath} failed: ${firstLine}`;
  }
  const tmpDir = mkdtempSync(join(tmpdir(), "land-branch-gate-classifier-"));
  const tmpFile = join(tmpDir, "check-owner-gated-surfaces.mjs");
  try {
    writeFileSync(tmpFile, source);
    return execFileSync(
      process.execPath,
      [tmpFile, "--classify-branch", baseRef],
      { cwd: worktree, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  } catch (err) {
    // A non-zero classifier exit is ALWAYS a refusal — never return its stdout as a
    // candidate KLASS line (a `KLASS ERROR ...` line on stdout, or a crash with
    // nothing on stdout, used to be handed straight to KLASS_LINE_RE as if it might
    // still parse). Name the exit code and the first line of whatever it printed
    // instead, so the refusal reason says what actually happened.
    const code = typeof err.status === "number" ? err.status : "?";
    const firstLine = String(err.stdout || err.stderr || err.message || "").split("\n")[0].trim();
    return `classifier exited ${code}: ${firstLine}`;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Reads <scratch>/<tag>-pf.log and <scratch>/<tag>-br.log itself, resolves
 * `git -C <worktree> rev-parse HEAD` and `git -C <worktree> rev-parse
 * refs/heads/<branch>`, and applies canPush() against <head>. Returns
 * { ok, reasons } — never throws.
 *
 * `klass`, when given, is the class the caller has ALREADY resolved (via
 * resolveKlass() over the Merge stage's own klassLine — worker-reported prose that a
 * fabricated valid-shaped line could steer, Codex #1133 P1). verify() then re-derives
 * the class itself, deterministically, by running the BASE ref's OWN copy of
 * `scripts/check-owner-gated-surfaces.mjs --classify-branch <baseRef>` (read via `git
 * show`, never the worktree's working copy — a branch can never classify itself with
 * rules it rewrote) in <worktree> and refuses unless the two agree, unless `git show`
 * itself fails, or unless the classifier exits non-zero for any reason — the push is
 * bound to the classifier's OWN answer on the exact verified head, never to anything a
 * worker said. `baseRef` defaults to `origin/SignalGrid_Alpha` (the real landing base);
 * it is a parameter, not a hardcoded literal, so --self-test can point it at a local
 * ref in a throwaway
 * repo with no remote at all.
 */
export function verify({ scratch, tag, worktree, branch, head, klass, baseRef = "origin/SignalGrid_Alpha" }) {
  const reasons = [];
  const pfPath = join(scratch, `${tag}-pf.log`);
  const brPath = join(scratch, `${tag}-br.log`);
  const preflightLastLine = lastNonEmptyLine(pfPath);
  const breadthLastLine = lastNonEmptyLine(brPath);
  if (preflightLastLine === null) reasons.push(`missing or empty ${pfPath}`);
  if (breadthLastLine === null) reasons.push(`missing or empty ${brPath}`);

  const preflightParsed = preflightLastLine === null ? null : parseSentinelLine(preflightLastLine, "PREFLIGHT");
  const breadthParsed = breadthLastLine === null ? null : parseSentinelLine(breadthLastLine, "BREADTH");
  if (preflightLastLine !== null && preflightParsed === null)
    reasons.push(`${pfPath}: last line does not parse as a PREFLIGHT_EXIT sentinel: ${JSON.stringify(preflightLastLine)}`);
  if (breadthLastLine !== null && breadthParsed === null)
    reasons.push(`${brPath}: last line does not parse as a BREADTH_EXIT sentinel: ${JSON.stringify(breadthLastLine)}`);
  // The line can parse cleanly and still name the WRONG head — the anchored regex only
  // proves the SHAPE is right, not the sha; a tag-scoped log can hold a previous run's
  // well-formed sentinel for another commit.
  if (preflightParsed && preflightParsed.sha !== head)
    reasons.push(`${pfPath}: sentinel names head ${preflightParsed.sha} !== expected ${head}`);
  if (breadthParsed && breadthParsed.sha !== head)
    reasons.push(`${brPath}: sentinel names head ${breadthParsed.sha} !== expected ${head}`);

  const worktreeHead = revParse(worktree, "HEAD");
  if (typeof worktreeHead !== "string") reasons.push(`git -C ${worktree} rev-parse HEAD failed: ${worktreeHead.error}`);
  else if (worktreeHead !== head) reasons.push(`worktree HEAD ${worktreeHead} !== expected ${head}`);

  const branchHead = revParse(worktree, `refs/heads/${branch}`);
  if (typeof branchHead !== "string") reasons.push(`git -C ${worktree} rev-parse refs/heads/${branch} failed: ${branchHead.error}`);
  else if (branchHead !== head) reasons.push(`refs/heads/${branch} is at ${branchHead}, !== expected ${head}`);

  // Only ask canPush() once every input it needs parsed cleanly; a parse failure or a
  // ref mismatch above is already a refusal and canPush() would just re-report it
  // confusingly (headSha undefined, etc).
  if (reasons.length) return { ok: false, reasons };

  const gate = canPush(
    { headSha: typeof worktreeHead === "string" ? worktreeHead : null, preflightExit: preflightParsed.exit, preflightLastLine, breadthExit: breadthParsed.exit, breadthLastLine },
    head,
  );
  if (!gate.ok || klass === undefined) return gate;

  // Finding 1 (Codex #1133 P1): bind the push to the classifier's own answer. Only
  // reached once the sentinel/head/ref checks above already cleared — a missing log or
  // a wrong head is reported as that, never masked by a klass mismatch reason instead.
  if (!VALID_KLASSES.has(klass)) return { ok: false, reasons: [`unknown klass ${JSON.stringify(klass)}`] };
  const derivedLine = classifyBranchOutput(worktree, baseRef);
  const m = KLASS_LINE_RE.exec(derivedLine);
  if (!m) return { ok: false, reasons: [`classifier did not print a KLASS line: ${JSON.stringify(derivedLine)}`] };
  if (m[1] !== klass) return { ok: false, reasons: [`derived class ${m[1]} !== resolved class ${klass}`] };
  return { ok: true, reasons: [] };
}

function runVerifyCli(argv) {
  const args = {};
  // `klassGiven` tracks whether the LITERAL `--klass` token was present on the command
  // line, separately from `args.klass`'s value — a bare `--klass` (no following value)
  // sets `args.klass = undefined` too, which used to be indistinguishable from "--klass
  // was never passed at all" and silently fell through to the old no-klass PASS line
  // (review nit on #1133).
  let klassGiven = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--") && a !== "--verify") {
      const key = a.slice(2);
      if (key === "klass") klassGiven = true;
      args[key] = argv[i + 1];
      i++;
    }
  }
  const { scratch, tag, worktree, branch, head, klass } = args;
  if (!scratch || !tag || !worktree || !branch || !head) {
    console.error("land-branch-gate --verify requires --scratch --tag --worktree --branch --head");
    process.exit(1);
  }
  // A bare `--klass` (no value, so `klass` is undefined here despite `klassGiven`) or a
  // value outside VALID_KLASSES is ALWAYS a refusal — never fall back to the old PASS
  // line, which is what happened when `klass === undefined` from a bare flag looked
  // identical to "--klass was never given".
  if (klassGiven && (klass === undefined || !VALID_KLASSES.has(klass))) {
    console.error(`land-branch-gate --verify REFUSED: --klass requires a value, one of ${[...VALID_KLASSES].join("|")} (got ${JSON.stringify(klass)})`);
    process.exit(1);
  }
  const { ok, reasons } = verify({ scratch, tag, worktree, branch, head, klass });
  if (!ok) {
    console.error(`land-branch-gate --verify REFUSED (head ${head}):`);
    for (const r of reasons) console.error(`  ${r}`);
    process.exit(1);
  }
  // Finding 1 (Codex #1133 P1): when --klass is given, the PASS line carries the class
  // the classifier itself confirmed, so the push worker's grep can bind on it — kept as
  // "<label> <more text>" (never ending right after the klass value) so the SAME
  // trailing-space grep style the old line already required
  // ("^land-branch-gate --verify PASS: head <sha> ") still has something to match after
  // "klass <klass> ". The shape without --klass is UNCHANGED, so an old caller that
  // never learned about --klass keeps working exactly as before.
  console.log(
    klass !== undefined
      ? `land-branch-gate --verify PASS: head ${head} klass ${klass} derived from origin/SignalGrid_Alpha in ${worktree}`
      : `land-branch-gate --verify PASS: head ${head} verified from ${scratch}/${tag}-{pf,br}.log and refs/heads/${branch}`,
  );
  process.exit(0);
}

function withTempGitRepo(fn) {
  const dir = mkdtempSync(join(tmpdir(), "land-branch-gate-verify-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    execFileSync("git", ["-C", dir, "config", "user.email", "test@example.com"]);
    execFileSync("git", ["-C", dir, "config", "user.name", "test"]);
    writeFileSync(join(dir, "f.txt"), "x\n");
    execFileSync("git", ["-C", dir, "add", "f.txt"]);
    execFileSync("git", ["-C", dir, "commit", "-q", "-m", "initial"]);
    const head = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    execFileSync("git", ["-C", dir, "branch", "feature-branch", head]);
    fn(dir, head);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function selfTest() {
  const HEAD = "abc1234deadbeef";
  const good = { headSha: HEAD, preflightExit: 0, preflightLastLine: `PREFLIGHT_EXIT 0 ${HEAD}`, breadthExit: 0, breadthLastLine: `BREADTH_EXIT 0 ${HEAD}` };
  const cases = [
    { name: "all green pushes", run: good, expect: true },
    { name: "missing breadth sentinel refused", run: { ...good, breadthLastLine: "" }, expect: false },
    { name: "missing preflight sentinel refused", run: { ...good, preflightLastLine: "" }, expect: false },
    { name: "non-zero breadth exit refused", run: { ...good, breadthExit: 1, breadthLastLine: `BREADTH_EXIT 1 ${HEAD}` }, expect: false },
    { name: "non-zero preflight exit refused", run: { ...good, preflightExit: 1, preflightLastLine: `PREFLIGHT_EXIT 1 ${HEAD}` }, expect: false },
    { name: "mismatched head refused", run: { ...good, headSha: "other" }, expect: false },
    { name: "exit 0 with stale/lying last-line text refused", run: { ...good, breadthLastLine: "some other line" }, expect: false },
    { name: "stale sentinel from a previous run at a different sha refused", run: { ...good, preflightLastLine: "PREFLIGHT_EXIT 0 someOldSha", breadthLastLine: "BREADTH_EXIT 0 someOldSha" }, expect: false },
    { name: "null run refused", run: null, expect: false },
    // Codex #1130 P2: the old "literally contain" + .includes(expectedHead) checks
    // both passed a line with a stale sha CONCATENATED with the expected one in
    // trailing text — exact-equality of the whole line closes that.
    { name: "concatenated stale-then-expected head refused", run: { ...good, preflightLastLine: `PREFLIGHT_EXIT 0 deadbeef00deadbeef00deadbeef00deadbeef00 unrelated=${HEAD}` }, expect: false },
    { name: "trailing space after expected head refused", run: { ...good, breadthLastLine: `BREADTH_EXIT 0 ${HEAD} ` }, expect: false },
  ];
  let pass = 0;
  for (const c of cases) {
    const { ok } = canPush(c.run, HEAD);
    if (ok === c.expect) { pass++; console.log(`PASS: ${c.name}`); }
    else console.error(`FAIL: ${c.name} — got ok=${ok}, want ${c.expect}`);
  }
  // The workflow's inlined copy must equal this function (whitespace-normalised); a
  // drifted mirror would let the workflow push on a rule this file no longer holds.
  const norm = (s) => s.replace(/\s+/g, " ").trim();
  let workflowSrc = "";
  try { workflowSrc = readFileSync(new URL("../../.claude/workflows/land-branch.js", import.meta.url), "utf8"); } catch { workflowSrc = ""; }
  const normWorkflow = norm(workflowSrc);
  const mirrorChecks = [
    ["canPush", canPush],
    ["resolveKlass", resolveKlass],
    ["ownerDecisionText", ownerDecisionText],
  ];
  for (const [name, fn] of mirrorChecks) {
    const mirrored = workflowSrc && normWorkflow.includes(norm(fn.toString()));
    if (mirrored) { pass++; console.log(`PASS: .claude/workflows/land-branch.js carries a byte-for-byte mirror of ${name}`); }
    else console.error(`FAIL: .claude/workflows/land-branch.js does not carry this exact ${name} — re-mirror it`);
  }

  // KLASS_LINE_RE is not a function the loop above can .toString()-and-compare, but it
  // holds all of resolveKlass's anchoring — dropping `$` (or both anchors) from either
  // copy previously still passed every mirror/klass check, since nothing read the
  // regex's own source text (finding 3, 2026-09-26).
  const klassLineReMirrored = workflowSrc && normWorkflow.includes(norm(`const KLASS_LINE_RE = ${KLASS_LINE_RE};`));
  if (klassLineReMirrored) { pass++; console.log("PASS: .claude/workflows/land-branch.js carries a byte-for-byte mirror of KLASS_LINE_RE"); }
  else console.error("FAIL: .claude/workflows/land-branch.js does not carry this exact KLASS_LINE_RE — re-mirror it");

  // resolveKlass / ownerDecisionText (Codex finding 7 follow-up, docs/BUILD_BACKLOG.md
  // "land-branch.js's 'Owner decision needed' text should be derived from the changed
  // paths"): the derived class always wins, an unparsable or empty-diff line refuses,
  // and an unknown klass fails ownerDecisionText closed rather than guessing a text.
  const klassCases = [];
  const kt = (name, ok) => klassCases.push([name, ok]);
  kt("the backlog row's own check: caller DECISION_PATH + derived other → resolved other, ownerDecisionText starts with the None instruction", (() => {
    const r = resolveKlass("DECISION_PATH", "KLASS other files=2 matched=0");
    return r.ok && r.klass === "other" && r.callerKlass === "DECISION_PATH" && r.overridden === true
      && ownerDecisionText(r.klass).startsWith('write what the owner must decide, or "None');
  })());
  kt("OWNER_RESERVED derived beats caller other", (() => {
    const r = resolveKlass("other", "KLASS OWNER_RESERVED files=3 matched=1");
    return r.ok && r.klass === "OWNER_RESERVED" && r.overridden === true;
  })());
  kt("a caller klass that matches the derived one is not reported overridden", (() => {
    const r = resolveKlass("SAFETY_MACHINERY", "KLASS SAFETY_MACHINERY files=4 matched=2");
    return r.ok && r.overridden === false;
  })());
  kt("unparsable derived line refused", !resolveKlass("other", "not a klass line").ok);
  kt("files=0 refused (empty diff is unknown, not other)", !resolveKlass("other", "KLASS other files=0 matched=0").ok);
  kt("a KLASS ERROR line (git failure) refused", !resolveKlass("other", "KLASS ERROR empty diff").ok);
  kt("ownerDecisionText throws on an unknown klass (fail closed)", (() => {
    try { ownerDecisionText("BOGUS"); return false; } catch { return true; }
  })());
  // Finding 3 (should-fix): KLASS_LINE_RE's own anchoring was untested — these three
  // would still pass if `^`/`$` were dropped from either copy.
  kt("a KLASS line with trailing garbage after the sentinel shape is refused (anchored $)", !resolveKlass("other", "KLASS other files=2 matched=0 x").ok);
  kt("a KLASS line with leading garbage before the sentinel shape is refused (anchored ^)", !resolveKlass("other", "x KLASS other files=2 matched=0").ok);
  kt("two KLASS lines joined by a newline are refused, not matched as the first line", !resolveKlass("other", "KLASS other files=2 matched=0\nKLASS OWNER_RESERVED files=2 matched=1").ok);
  // Finding 6 (should-fix): resolveKlass captured `matched` but never used it, so a
  // fabricated/corrupted line whose klass and matched count disagree (klass "other"
  // with matched>0, or a non-"other" klass with matched=0 — classifyDiff can never
  // itself produce either) used to resolve fine and could override a caller's safer
  // guess.
  kt("klass=other with matched>0 is internally inconsistent, refused", !resolveKlass("OWNER_RESERVED", "KLASS other files=3 matched=2").ok);
  kt("a non-other klass with matched=0 is internally inconsistent, refused", !resolveKlass("other", "KLASS OWNER_RESERVED files=3 matched=0").ok);
  for (const [name, ok] of klassCases) {
    if (ok) { pass++; console.log(`PASS: ${name}`); }
    else console.error(`FAIL: ${name}`);
  }

  // --verify: a temp git repo under os.tmpdir() (never inside this tree), never
  // reused between cases (fresh scratch dir each time avoids one case's log files
  // leaking into the next).
  withTempGitRepo((dir, head) => {
    const scratch = mkdtempSync(join(tmpdir(), "land-branch-gate-verify-scratch-"));
    try {
      const tag = "vt";
      const pf = join(scratch, `${tag}-pf.log`);
      const br = join(scratch, `${tag}-br.log`);
      const writeGood = () => {
        writeFileSync(pf, `preflight output\nPREFLIGHT_EXIT 0 ${head}\n`);
        writeFileSync(br, `breadth output\nBREADTH_EXIT 0 ${head}\n`);
      };

      writeGood();
      let r = verify({ scratch, tag, worktree: dir, branch: "feature-branch", head });
      if (r.ok) { pass++; console.log("PASS: --verify good logs + matching head → exit 0"); }
      else console.error(`FAIL: --verify good logs + matching head — refused: ${JSON.stringify(r.reasons)}`);

      writeGood();
      rmSync(br);
      r = verify({ scratch, tag, worktree: dir, branch: "feature-branch", head });
      if (!r.ok) { pass++; console.log("PASS: --verify missing br.log → refused"); }
      else console.error("FAIL: --verify missing br.log did not refuse");

      writeFileSync(pf, `preflight output\nPREFLIGHT_EXIT 1 ${head}\n`);
      writeFileSync(br, `breadth output\nBREADTH_EXIT 0 ${head}\n`);
      r = verify({ scratch, tag, worktree: dir, branch: "feature-branch", head });
      if (!r.ok) { pass++; console.log("PASS: --verify PREFLIGHT_EXIT 1 → refused"); }
      else console.error("FAIL: --verify PREFLIGHT_EXIT 1 did not refuse");

      // A well-formed, valid-hex sentinel naming a DIFFERENT commit than expected — this
      // exercises the new "sentinel names head X !== expected" reason specifically
      // (the old fixture used a non-hex "someOtherSha" that would only ever hit the
      // separate "does not parse" refusal, never the sha-mismatch one added here).
      const STALE_SHA = "0".repeat(40);
      writeFileSync(pf, `preflight output\nPREFLIGHT_EXIT 0 ${STALE_SHA}\n`);
      writeFileSync(br, `breadth output\nBREADTH_EXIT 0 ${STALE_SHA}\n`);
      r = verify({ scratch, tag, worktree: dir, branch: "feature-branch", head });
      if (!r.ok && r.reasons.some((x) => x.includes("sentinel names head"))) { pass++; console.log("PASS: --verify sentinel at another (valid-hex) sha → refused (sentinel-head reason)"); }
      else console.error(`FAIL: --verify sentinel at another sha — got ok=${r.ok}, reasons=${JSON.stringify(r.reasons)}`);

      // Codex #1130 P2's concatenated form at the --verify layer: a stale sha followed
      // by trailing text that happens to include the EXPECTED head does not parse under
      // the anchored full-line regex, so it is refused by the parse check rather than
      // ever reaching a sha comparison.
      writeFileSync(pf, `preflight output\nPREFLIGHT_EXIT 0 ${STALE_SHA} unrelated=${head}\n`);
      writeFileSync(br, `breadth output\nBREADTH_EXIT 0 ${head}\n`);
      r = verify({ scratch, tag, worktree: dir, branch: "feature-branch", head });
      if (!r.ok) { pass++; console.log("PASS: --verify concatenated stale+expected sentinel line → refused"); }
      else console.error("FAIL: --verify concatenated stale+expected sentinel line did not refuse");

      // This case must exercise the BRANCH-REF check specifically, not the HEAD check:
      // worktree HEAD stays AT the expected head (detached), while refs/heads/<branch>
      // is force-moved elsewhere. If the branch-ref check were deleted, this would
      // still pass (worktree HEAD matches) — the assertion below on the reason text
      // is what catches that, not just `!r.ok`.
      writeGood();
      execFileSync("git", ["-C", dir, "checkout", "-q", "--detach", head]);
      execFileSync("git", ["-C", dir, "commit", "--allow-empty", "-q", "-m", "a sha the branch ref will point to instead"]);
      const otherSha = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      execFileSync("git", ["-C", dir, "checkout", "-q", "--detach", head]);
      execFileSync("git", ["-C", dir, "branch", "-f", "feature-branch", otherSha]);
      r = verify({ scratch, tag, worktree: dir, branch: "feature-branch", head });
      if (!r.ok && r.reasons.some((x) => x.includes("refs/heads/"))) { pass++; console.log("PASS: --verify refs/heads/<branch> not at HEAD → refused (branch-ref reason)"); }
      else console.error(`FAIL: --verify refs/heads/<branch> not at HEAD — got ok=${r.ok}, reasons=${JSON.stringify(r.reasons)}`);
      execFileSync("git", ["-C", dir, "branch", "-f", "feature-branch", head]);

      writeFileSync(pf, `preflight output\nsomething that is not a sentinel line at all\n`);
      writeFileSync(br, `breadth output\nBREADTH_EXIT 0 ${head}\n`);
      r = verify({ scratch, tag, worktree: dir, branch: "feature-branch", head });
      if (!r.ok) { pass++; console.log("PASS: --verify unparsable last line → refused"); }
      else console.error("FAIL: --verify unparsable last line did not refuse");
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  // Finding 1 (Codex #1133 P1): --verify's `klass` param must bind to the REAL
  // classifier, not to a mock. Two throwaway repos (never inside this tree), each with
  // a base branch and a feature branch one commit ahead, run
  // `node scripts/check-owner-gated-surfaces.mjs --classify-branch <local-ref>` for
  // real via classifyBranchOutput() — `baseRef` is passed explicitly as the temp
  // repo's own local branch name, since the default `origin/SignalGrid_Alpha` means
  // nothing in a repo with no remote.
  //
  // Review nit on #1133: classifyBranchOutput() now reads the classifier via
  // `git show <baseRef>:scripts/check-owner-gated-surfaces.mjs` instead of the
  // worktree's working copy, so `<baseRef>:scripts/check-owner-gated-surfaces.mjs`
  // must actually exist in these temp repos — the initial commit on `base` carries a
  // real copy of THIS repo's own classifier module (read straight off disk), not a
  // stub, so the classifier that runs is the genuine article, exercising its real
  // manifest against the temp repo's diff.
  const realClassifierSource = readFileSync(new URL("../check-owner-gated-surfaces.mjs", import.meta.url), "utf8");
  function withKlassTempRepo(fn) {
    const dir = mkdtempSync(join(tmpdir(), "land-branch-gate-klass-"));
    try {
      execFileSync("git", ["init", "-q", "-b", "base", dir]);
      execFileSync("git", ["-C", dir, "config", "user.email", "test@example.com"]);
      execFileSync("git", ["-C", dir, "config", "user.name", "test"]);
      writeFileSync(join(dir, "f.txt"), "x\n");
      mkdirSync(join(dir, "scripts"), { recursive: true });
      writeFileSync(join(dir, "scripts", "check-owner-gated-surfaces.mjs"), realClassifierSource);
      execFileSync("git", ["-C", dir, "add", "-A"]);
      execFileSync("git", ["-C", dir, "commit", "-q", "-m", "initial"]);
      execFileSync("git", ["-C", dir, "checkout", "-q", "-b", "feature"]);
      fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const stampSentinels = (scratch, tag, head) => {
    writeFileSync(join(scratch, `${tag}-pf.log`), `preflight output\nPREFLIGHT_EXIT 0 ${head}\n`);
    writeFileSync(join(scratch, `${tag}-br.log`), `breadth output\nBREADTH_EXIT 0 ${head}\n`);
  };

  withKlassTempRepo((dir) => {
    mkdirSync(join(dir, "docs"), { recursive: true });
    writeFileSync(join(dir, "docs", "NOTES.md"), "notes\n");
    execFileSync("git", ["-C", dir, "add", "-A"]);
    execFileSync("git", ["-C", dir, "commit", "-q", "-m", "docs-only change"]);
    const head = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const scratch = mkdtempSync(join(tmpdir(), "land-branch-gate-klass-scratch-"));
    try {
      const tag = "kt-docs";
      stampSentinels(scratch, tag, head);

      let r = verify({ scratch, tag, worktree: dir, branch: "feature", head, klass: "other", baseRef: "base" });
      if (r.ok) { pass++; console.log("PASS: --verify --klass other matches a docs-only diff against the real classifier"); }
      else console.error(`FAIL: --verify --klass other on a docs-only diff — refused: ${JSON.stringify(r.reasons)}`);

      r = verify({ scratch, tag, worktree: dir, branch: "feature", head, klass: "SAFETY_MACHINERY", baseRef: "base" });
      if (!r.ok && r.reasons.some((x) => x.includes("derived class other !== resolved class SAFETY_MACHINERY"))) { pass++; console.log("PASS: --verify --klass SAFETY_MACHINERY refused on a docs-only diff (derived class mismatch)"); }
      else console.error(`FAIL: --verify --klass SAFETY_MACHINERY on a docs-only diff — got ok=${r.ok}, reasons=${JSON.stringify(r.reasons)}`);

      r = verify({ scratch, tag, worktree: dir, branch: "feature", head, klass: "BOGUS", baseRef: "base" });
      if (!r.ok && r.reasons.some((x) => x.includes("unknown klass"))) { pass++; console.log("PASS: --verify --klass BOGUS refused (unrecognised klass value)"); }
      else console.error(`FAIL: --verify --klass BOGUS — got ok=${r.ok}, reasons=${JSON.stringify(r.reasons)}`);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  withKlassTempRepo((dir) => {
    mkdirSync(join(dir, "scripts"), { recursive: true });
    writeFileSync(join(dir, "scripts", "foo.mjs"), "export {};\n");
    execFileSync("git", ["-C", dir, "add", "-A"]);
    execFileSync("git", ["-C", dir, "commit", "-q", "-m", "scripts change"]);
    const head = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const scratch = mkdtempSync(join(tmpdir(), "land-branch-gate-klass-scratch-"));
    try {
      const tag = "kt-scripts";
      stampSentinels(scratch, tag, head);

      let r = verify({ scratch, tag, worktree: dir, branch: "feature", head, klass: "SAFETY_MACHINERY", baseRef: "base" });
      if (r.ok) { pass++; console.log("PASS: --verify --klass SAFETY_MACHINERY matches a scripts/ diff against the real classifier"); }
      else console.error(`FAIL: --verify --klass SAFETY_MACHINERY on a scripts/ diff — refused: ${JSON.stringify(r.reasons)}`);

      r = verify({ scratch, tag, worktree: dir, branch: "feature", head, klass: "other", baseRef: "base" });
      if (!r.ok && r.reasons.some((x) => x.includes("derived class SAFETY_MACHINERY !== resolved class other"))) { pass++; console.log("PASS: --verify --klass other refused on a scripts/ diff (derived class mismatch)"); }
      else console.error(`FAIL: --verify --klass other on a scripts/ diff — got ok=${r.ok}, reasons=${JSON.stringify(r.reasons)}`);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  // Review nit on #1133, part 1: a branch that REWRITES its own copy of
  // scripts/check-owner-gated-surfaces.mjs to an emptied manifest (every rule array
  // emptied) must not be able to grade its own diff with the rules it just rewrote.
  // classifyBranchOutput() reads the classifier from `base` via `git show`, so the
  // manifest it actually runs is the BASE branch's real, full one — which still sees
  // the change to scripts/check-owner-gated-surfaces.mjs itself. Review sweep on
  // #1133, finding 6 made that exact path OWNER_RESERVED (closing the two-step bypass
  // where PR 1 could delete a rule under the file's old SAFETY_MACHINERY classification
  // and PR 2 then exploit it), so base's copy now resolves this diff to OWNER_RESERVED,
  // never "other" and never merely SAFETY_MACHINERY.
  withKlassTempRepo((dir) => {
    const emptied = "export const SAFETY_MACHINERY = [];\nexport const OWNER_RESERVED = [];\nexport const DECISION_PATH = [];\n";
    writeFileSync(join(dir, "scripts", "check-owner-gated-surfaces.mjs"), emptied);
    execFileSync("git", ["-C", dir, "add", "-A"]);
    execFileSync("git", ["-C", dir, "commit", "-q", "-m", "branch empties its own classifier manifest"]);
    const head = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const scratch = mkdtempSync(join(tmpdir(), "land-branch-gate-klass-scratch-"));
    try {
      const tag = "kt-selfrewrite";
      stampSentinels(scratch, tag, head);

      let r = verify({ scratch, tag, worktree: dir, branch: "feature", head, klass: "OWNER_RESERVED", baseRef: "base" });
      if (r.ok) { pass++; console.log("PASS: --verify --klass OWNER_RESERVED passes when the branch rewrote its own classifier to an emptied manifest (base's copy still classifies the change OWNER_RESERVED)"); }
      else console.error(`FAIL: --verify --klass OWNER_RESERVED on a self-rewritten classifier — refused: ${JSON.stringify(r.reasons)}`);

      r = verify({ scratch, tag, worktree: dir, branch: "feature", head, klass: "other", baseRef: "base" });
      if (!r.ok && r.reasons.some((x) => x.includes("derived class OWNER_RESERVED !== resolved class other"))) { pass++; console.log("PASS: --verify --klass other refused when the branch rewrote its own classifier (base's copy still says OWNER_RESERVED)"); }
      else console.error(`FAIL: --verify --klass other on a self-rewritten classifier — got ok=${r.ok}, reasons=${JSON.stringify(r.reasons)}`);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  // Review nit on #1133, part 2: `git show <baseRef>:...` failing (a base ref that does
  // not exist) is a refusal with a reason naming the git-show failure — never a crash,
  // never a candidate KLASS line.
  withKlassTempRepo((dir) => {
    const head = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const scratch = mkdtempSync(join(tmpdir(), "land-branch-gate-klass-scratch-"));
    try {
      const tag = "kt-nobase";
      stampSentinels(scratch, tag, head);
      const r = verify({ scratch, tag, worktree: dir, branch: "feature", head, klass: "other", baseRef: "does-not-exist-ref" });
      if (!r.ok && r.reasons.some((x) => x.includes("git") && x.includes("show") && x.includes("does-not-exist-ref"))) { pass++; console.log("PASS: --verify refuses with a reason naming the git-show failure when baseRef does not exist"); }
      else console.error(`FAIL: --verify with a non-existent baseRef — got ok=${r.ok}, reasons=${JSON.stringify(r.reasons)}`);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  // Review nit on #1133, part 2 (continued): once `git show` succeeds, a non-zero exit
  // from running the classifier itself is STILL always a refusal, and the refusal
  // reason names the exit code and what the classifier printed — never its stdout
  // treated as a candidate KLASS line. An up-to-date feature branch (no commits past
  // `base`) makes the classifier's own "empty diff" case fire for real.
  withKlassTempRepo((dir) => {
    const head = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const scratch = mkdtempSync(join(tmpdir(), "land-branch-gate-klass-scratch-"));
    try {
      const tag = "kt-emptydiff";
      stampSentinels(scratch, tag, head);
      const r = verify({ scratch, tag, worktree: dir, branch: "feature", head, klass: "other", baseRef: "base" });
      if (!r.ok && r.reasons.some((x) => x.includes("classifier exited 2") && x.includes("empty diff"))) { pass++; console.log("PASS: --verify refuses on a non-zero classifier exit (empty diff) with the exit-code reason, not stdout treated as a candidate line"); }
      else console.error(`FAIL: --verify non-zero classifier exit — got ok=${r.ok}, reasons=${JSON.stringify(r.reasons)}`);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  // Review nit on #1133, part 3: a bare `--klass` (no value) at the CLI layer refuses,
  // exit 1, with a REFUSED reason — never the old no-klass PASS line. Exercised as a
  // real subprocess so the fix under test is runVerifyCli's own argv parsing, not
  // verify() called directly.
  {
    const selfPath = fileURLToPath(import.meta.url);
    const bareKlassArgv = ["--verify", "--scratch", "/tmp/does-not-matter", "--tag", "t", "--worktree", "/tmp/does-not-matter", "--branch", "b", "--head", "deadbeef", "--klass"];
    try {
      execFileSync(process.execPath, [selfPath, ...bareKlassArgv], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      console.error("FAIL: CLI --verify with a bare --klass (no value) did not exit non-zero");
    } catch (err) {
      const code = typeof err.status === "number" ? err.status : null;
      const stderr = String(err.stderr || "");
      if (code === 1 && /REFUSED/.test(stderr)) { pass++; console.log("PASS: CLI --verify with a bare --klass refuses (exit 1, REFUSED reason)"); }
      else console.error(`FAIL: CLI --verify with a bare --klass — exit ${code}, stderr ${JSON.stringify(stderr)}`);
    }

    const badKlassArgv = ["--verify", "--scratch", "/tmp/does-not-matter", "--tag", "t", "--worktree", "/tmp/does-not-matter", "--branch", "b", "--head", "deadbeef", "--klass", "BOGUS"];
    try {
      execFileSync(process.execPath, [selfPath, ...badKlassArgv], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      console.error("FAIL: CLI --verify with an invalid --klass value did not exit non-zero");
    } catch (err) {
      const code = typeof err.status === "number" ? err.status : null;
      const stderr = String(err.stderr || "");
      if (code === 1 && /REFUSED/.test(stderr)) { pass++; console.log("PASS: CLI --verify with an invalid --klass value refuses (exit 1, REFUSED reason)"); }
      else console.error(`FAIL: CLI --verify with an invalid --klass value — exit ${code}, stderr ${JSON.stringify(stderr)}`);
    }
  }

  // +7: the inline --verify checks above this point (not collected into an array); +1:
  // the standalone KLASS_LINE_RE mirror check above (finding 3), which isn't part of
  // mirrorChecks since it compares a regex's source text, not a function's; +5: the
  // inline --verify --klass checks just above (finding 1, Codex #1133 P1) binding the
  // push to the real classifier over two throwaway repos; +2: the self-rewritten-
  // classifier case (review nit part 1, base's copy still wins); +1: a non-existent
  // baseRef refuses on the git-show failure (review nit part 2); +1: a non-zero
  // classifier exit (empty diff) refuses on the exit-code reason, never stdout-as-a-
  // candidate-line (review nit part 2); +2: the CLI-level bare/invalid --klass refusals
  // (review nit part 3) — none of these five are collected into an array either.
  const total = cases.length + mirrorChecks.length + klassCases.length + 7 + 1 + 5 + 2 + 1 + 1 + 2;
  console.log(`${pass}/${total} passed`);
  if (pass !== total) process.exit(1);
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith("land-branch-gate.mjs");
if (invokedDirectly && process.argv.includes("--verify")) {
  runVerifyCli(process.argv.slice(2));
} else if (invokedDirectly && process.argv.includes("--self-test")) {
  selfTest();
}
