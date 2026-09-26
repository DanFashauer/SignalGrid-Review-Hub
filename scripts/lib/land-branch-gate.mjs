import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Pure push-gate for the land-branch saved workflow (docs/agent/LESSONS.md L2,
// docs/BUILD_BACKLOG.md row "The plan-row measurement tranche is a scripted
// workflow"). This is the single source of truth for "may the chain push?" —
// .claude/workflows/land-branch.js inlines a byte-for-byte MIRROR of canPush (the
// Workflow tool runs that file in a sandbox with no import.meta and no filesystem, so
// it cannot import this module). The self-test below reads that file and FAILS when
// the mirror drifts from this function — change here first, then paste there.
//
//   node scripts/lib/land-branch-gate.mjs --self-test
//
// canPush() takes the Chain-run result (never worker prose) and the expected
// head, and refuses unless: the run's headSha still matches, both exits are
// literally 0, AND both last-line strings literally contain "PREFLIGHT_EXIT 0"
// / "BREADTH_EXIT 0" — belt AND suspenders against a worker that reports
// exit:0 while pasting a different log line.
export function canPush(run, expectedHead) {
  const reasons = [];
  if (!run || typeof run !== "object") return { ok: false, reasons: ["no chain-run result"] };
  if (run.headSha !== expectedHead) reasons.push(`headSha ${run.headSha} !== expected ${expectedHead}`);
  if (run.preflightExit !== 0) reasons.push(`preflightExit ${run.preflightExit} !== 0`);
  if (run.breadthExit !== 0) reasons.push(`breadthExit ${run.breadthExit} !== 0`);
  if (!/(?:^|\s)PREFLIGHT_EXIT 0(?:\s|$)/.test(run.preflightLastLine || ""))
    reasons.push(`preflightLastLine does not literally contain "PREFLIGHT_EXIT 0": ${JSON.stringify(run.preflightLastLine)}`);
  if (!/(?:^|\s)BREADTH_EXIT 0(?:\s|$)/.test(run.breadthLastLine || ""))
    reasons.push(`breadthLastLine does not literally contain "BREADTH_EXIT 0": ${JSON.stringify(run.breadthLastLine)}`);
  // The sentinel line itself must carry the expected head — a tag-scoped log can
  // otherwise still hold a PREVIOUS run's "…_EXIT 0 <old-sha>" line (the sentinel
  // is bound to the tag, not the sha); requiring the sha inside the line closes that.
  if (!(run.preflightLastLine || "").includes(expectedHead))
    reasons.push(`preflightLastLine does not carry the expected head ${expectedHead}: ${JSON.stringify(run.preflightLastLine)}`);
  if (!(run.breadthLastLine || "").includes(expectedHead))
    reasons.push(`breadthLastLine does not carry the expected head ${expectedHead}: ${JSON.stringify(run.breadthLastLine)}`);
  return { ok: reasons.length === 0, reasons };
}

// --verify: the DETERMINISTIC push gate the push command itself runs (Codex #1126 P1
// / #1127 summary finding 1 — "have the push command invoke a local validator that
// reads the sentinel files and current HEAD itself"). It never trusts a worker's
// report of what the log files say; it reads them itself, resolves the worktree's
// own HEAD and the branch ref with `git`, and applies the SAME canPush() the script
// already used. Refuses (reasons.length > 0) on: a missing/empty log file, a last
// line that does not parse as a "<LABEL>_EXIT <n> <sha>" sentinel, or either ref not
// resolving to the expected head.
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

function parseExit(line, label) {
  if (line == null) return null;
  const m = new RegExp(`${label}_EXIT (-?\\d+)`).exec(line);
  return m ? Number(m[1]) : null;
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

  const preflightExit = parseExit(preflightLastLine, "PREFLIGHT");
  const breadthExit = parseExit(breadthLastLine, "BREADTH");
  if (preflightLastLine !== null && preflightExit === null)
    reasons.push(`${pfPath}: last line does not parse as a PREFLIGHT_EXIT sentinel: ${JSON.stringify(preflightLastLine)}`);
  if (breadthLastLine !== null && breadthExit === null)
    reasons.push(`${brPath}: last line does not parse as a BREADTH_EXIT sentinel: ${JSON.stringify(breadthLastLine)}`);

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
    { headSha: typeof worktreeHead === "string" ? worktreeHead : null, preflightExit, preflightLastLine, breadthExit, breadthLastLine },
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
  let mirrored = false;
  try { mirrored = norm(readFileSync(new URL("../../.claude/workflows/land-branch.js", import.meta.url), "utf8")).includes(norm(canPush.toString())); } catch { mirrored = false; }
  if (mirrored) { pass++; console.log("PASS: .claude/workflows/land-branch.js carries a byte-for-byte mirror of canPush"); }
  else console.error("FAIL: .claude/workflows/land-branch.js does not carry this exact canPush — re-mirror it");

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

      writeFileSync(pf, `preflight output\nPREFLIGHT_EXIT 0 someOtherSha\n`);
      writeFileSync(br, `breadth output\nBREADTH_EXIT 0 someOtherSha\n`);
      r = verify({ scratch, tag, worktree: dir, branch: "feature-branch", head });
      if (!r.ok) { pass++; console.log("PASS: --verify sentinel at another sha → refused"); }
      else console.error("FAIL: --verify sentinel at another sha did not refuse");

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

  const total = cases.length + 1 + 6;
  console.log(`${pass}/${total} passed`);
  if (pass !== total) process.exit(1);
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith("land-branch-gate.mjs");
if (invokedDirectly && process.argv.includes("--verify")) {
  runVerifyCli(process.argv.slice(2));
} else if (invokedDirectly && process.argv.includes("--self-test")) {
  selfTest();
}
