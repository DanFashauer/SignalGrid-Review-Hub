import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

export function resolveKlass(callerKlass, derivedLine) {
  const m = KLASS_LINE_RE.exec(String(derivedLine ?? ""));
  if (!m) return { ok: false, reasons: [`derived line does not match the KLASS sentinel shape: ${JSON.stringify(derivedLine)}`] };
  const derivedKlass = m[1];
  const files = Number(m[2]);
  if (files === 0) return { ok: false, reasons: [`derived line reports files=0 (an empty diff is unknown, not "other"): ${JSON.stringify(derivedLine)}`] };
  return { ok: true, klass: derivedKlass, callerKlass, overridden: callerKlass !== derivedKlass };
}

export function ownerDecisionText(klass) {
  switch (klass) {
    case "SAFETY_MACHINERY":
      return 'write: "SAFETY_MACHINERY (<paths>): merged under DR-037 with check run <id recorded before merge>" - leave "<id recorded before merge>" literally; the coordinator fills it';
    case "DECISION_PATH":
      return 'write: "Yes - DECISION_PATH by scripts/check-owner-gated-surfaces.mjs (its blanket artifacts/api-server rule matches <paths>): the OWNER merges this PR or vetoes it by not merging; the cloud lane will not self-merge it, however green the gauntlet is." and say in one sentence what the change touches (test harness only, no route or verdict logic) so the owner can judge it from the phone';
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

/**
 * Reads <scratch>/<tag>-pf.log and <scratch>/<tag>-br.log itself, resolves
 * `git -C <worktree> rev-parse HEAD` and `git -C <worktree> rev-parse
 * refs/heads/<branch>`, and applies canPush() against <head>. Returns
 * { ok, reasons } — never throws.
 */
export function verify({ scratch, tag, worktree, branch, head }) {
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
  return gate;
}

function runVerifyCli(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--") && a !== "--verify") {
      args[a.slice(2)] = argv[i + 1];
      i++;
    }
  }
  const { scratch, tag, worktree, branch, head } = args;
  if (!scratch || !tag || !worktree || !branch || !head) {
    console.error("land-branch-gate --verify requires --scratch --tag --worktree --branch --head");
    process.exit(1);
  }
  const { ok, reasons } = verify({ scratch, tag, worktree, branch, head });
  if (!ok) {
    console.error(`land-branch-gate --verify REFUSED (head ${head}):`);
    for (const r of reasons) console.error(`  ${r}`);
    process.exit(1);
  }
  console.log(`land-branch-gate --verify PASS: head ${head} verified from ${scratch}/${tag}-{pf,br}.log and refs/heads/${branch}`);
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

  const total = cases.length + mirrorChecks.length + klassCases.length + 7;
  console.log(`${pass}/${total} passed`);
  if (pass !== total) process.exit(1);
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith("land-branch-gate.mjs");
if (invokedDirectly && process.argv.includes("--verify")) {
  runVerifyCli(process.argv.slice(2));
} else if (invokedDirectly && process.argv.includes("--self-test")) {
  selfTest();
}
