// check-row-status-drift.mjs — a row that still says FIX PROPOSED for work
// that has already landed. REPORTED, never fatal.
//
//   node scripts/check-row-status-drift.mjs              # report over the real tree (exit 0)
//   node scripts/check-row-status-drift.mjs --self-test  # prove the detector can fire (exit 1 if not)
//
// WHY THIS EXISTS (plan row 170, the harder half). `check-backlog-evidence.mjs`
// says in its own header that it cannot tell a WRONG status. On 2026-10-01
// four rows (plan 29, 40b, 80, 180) read FIX PROPOSED while their PRs had
// merged, on the fifth restamp round. A first attempt at a control for this
// row ("a row may not read open while naming a merged PR") was discarded
// because it fired zero times: the stale rows named no PR.
//
// THE KEY, AND WHY IT IS SOUND. A build worker writes "FIX PROPOSED <date>
// (branch <X>, …)" into the row ON branch X, in the same commit or series as
// the fix. So the annotation text is itself a tracer: the commit that first
// added that exact string (`git log -S`, which never matches a merge) is on
// branch X, and the first first-parent commit of the tip that has it as an
// ancestor is the merge that landed X. When that merge's subject reads
// `Merge pull request #N`, the row's claim is in the tip's history and the
// row is stale by construction — the status word is correct only while it is
// NOT on mainline. Measured on 2026-10-01: this resolved 20 of 20 annotations
// on the tip (both docs) to a PR merge, including the three branches
// (gate-scope-analysis, assist-wire-whitespace-vectors,
// docs-truth-reason-copy-stale-rows) that `git log --grep='into
// claude/<branch>$'` misses, and the REST head.ref of all 18 distinct PRs
// equalled the branch the row names.
//
// WHAT IS NOT A SOUND KEY, recorded so nobody rebuilds it:
//   - the branch name in history: merge subjects here are rewritten
//     ("Merge pull request #N: <title>"), remote heads are deleted after
//     merge, and the `into claude/<branch>` sync merges exist only when a
//     worker happened to merge mainline in (3 of 6 found).
//   - a PR number in the row: the stale rows name none until restamped.
//   - a file or symbol the row names: a cited file existing on the tip says
//     nothing; most fixes edit files that already existed.
//
// THE ONE WAY THE KEY CAN LIE, and the cross-check that catches it: the
// annotation could be written by a DIFFERENT, docs-only PR (a restamp that
// pre-announces work). Then the annotation landed but the fix may not have.
// So a landed annotation is reported STALE only when the landing merge also
// changed at least one repo path the annotation cites (other than the ledger
// itself); otherwise it is reported LANDED-UNCORROBORATED — read it by hand.
//
// FAIL-CLOSED, IN THE DIRECTION A REPORTER CAN BE: a shallow clone (CI's
// default checkout) cannot walk history, so the real-tree run prints NOT
// MEASURED and never "0 stale". The self-test builds its own full repository
// and is meaningful everywhere, CI included.
//
// WHAT THIS DOES NOT DO: rows that read `open` without a FIX PROPOSED tracer
// (the 2026-08-25 kind — rows 83, 89, 134, 135) are still undecidable from
// text and history, and a closed row whose fix later regressed is not read.
// Those still need the standing re-read row 170 names.

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const LEDGERS = ["docs/COMPANY_BUILD_PLAN.md", "docs/BUILD_BACKLOG.md"];

const ANNOTATION = /FIX PROPOSED (\d{4}-\d{2}-\d{2}) \(branch ([A-Za-z0-9._/-]+)/g;
const PR_MERGE = /^Merge pull request #(\d+)/;
const CITED_PATH = /[A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@-]+)+\.[A-Za-z0-9]+/g;

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).trim();
}

/**
 * The row a line belongs to: plan rows are "N. **", backlog rows "- [ ] **".
 * A ticked backlog box is a row already closed: its leftover annotation is
 * residue, not a wrong status, and is counted apart from STALE.
 */
function rowOf(lines, idx) {
  for (let i = idx; i >= 0; i--) {
    const plan = /^(\d+[a-z]?)\. \*\*/.exec(lines[i]);
    if (plan) return { row: `row ${plan[1]}`, closed: false };
    const box = /^- \[([ xX])\] \*\*(.{0,60})/.exec(lines[i]);
    if (box) return { row: `"${box[2].replace(/\*\*.*$/, "").trim()}"`, closed: box[1] !== " " };
  }
  return { row: "(no row)", closed: false };
}

/** Every FIX PROPOSED annotation in a ledger's text, with the paths it cites. */
export function findAnnotations(file, text) {
  const out = [];
  const lines = text.split("\n");
  const offsets = [];
  let pos = 0;
  for (const l of lines) { offsets.push(pos); pos += l.length + 1; }
  const all = [...text.matchAll(ANNOTATION)];
  all.forEach((m, k) => {
    const end = Math.min(k + 1 < all.length ? all[k + 1].index : text.length, m.index + 2000);
    const span = text.slice(m.index, end);
    let line = 0;
    while (line + 1 < offsets.length && offsets[line + 1] <= m.index) line++;
    const cited = [...new Set(span.match(CITED_PATH) ?? [])].filter((p) => !LEDGERS.includes(p));
    out.push({ file, line: line + 1, ...rowOf(lines, line), date: m[1], branch: m[2], key: m[0], cited });
  });
  return out;
}

/**
 * Classify one annotation against the history of `cwd` at HEAD.
 *   STALE                  landed in a PR merge that also changed a cited path
 *   LANDED-UNCORROBORATED  landed in a PR merge that changed no cited path
 *   NOT-VIA-PR             on HEAD's first-parent line itself (a branch tip, or a direct push)
 *   NO-HISTORY             the string has no adding commit reachable from HEAD
 *   CLOSED-RESIDUE         landed, but the row is a ticked box: status already right
 */
export function classify(cwd, a, firstParent) {
  const intro = git(cwd, ["log", "--format=%H", "--reverse", "-S", a.key, "HEAD", "--", a.file]).split("\n")[0];
  if (!intro) return { ...a, status: "NO-HISTORY" };
  if (firstParent.has(intro)) return { ...a, status: "NOT-VIA-PR", intro };
  const desc = git(cwd, ["rev-list", "--ancestry-path", `${intro}..HEAD`]).split("\n").filter((h) => firstParent.has(h));
  const land = desc[desc.length - 1];
  if (!land) return { ...a, status: "NO-HISTORY", intro };
  const subject = git(cwd, ["log", "-1", "--format=%s", land]);
  const pr = PR_MERGE.exec(subject);
  if (!pr) return { ...a, status: "NOT-VIA-PR", intro, land };
  const changed = new Set(git(cwd, ["diff", "--name-only", `${land}^1`, land]).split("\n"));
  const hit = a.cited.filter((p) => changed.has(p));
  const landed = hit.length ? "STALE" : "LANDED-UNCORROBORATED";
  return { ...a, status: a.closed ? "CLOSED-RESIDUE" : landed, intro, land, pr: Number(pr[1]), hit };
}

export function measure(cwd, ledgers = LEDGERS) {
  const fp = new Set(git(cwd, ["rev-list", "--first-parent", "HEAD"]).split("\n"));
  const results = [];
  for (const file of ledgers) {
    let text;
    try { text = readFileSync(join(cwd, file), "utf8"); } catch { continue; }
    for (const a of findAnnotations(file, text)) results.push(classify(cwd, a, fp));
  }
  return results;
}

function report(results) {
  const by = (s) => results.filter((r) => r.status === s);
  for (const r of by("STALE")) {
    console.log(`  STALE  ${r.file}:${r.line} ${r.row} — FIX PROPOSED (branch ${r.branch}) landed: PR #${r.pr} merge ${r.land.slice(0, 8)} (commit ${r.intro.slice(0, 8)}; changed ${r.hit[0]})`);
  }
  for (const r of by("LANDED-UNCORROBORATED")) {
    console.log(`  READ   ${r.file}:${r.line} ${r.row} — annotation landed in PR #${r.pr} merge ${r.land.slice(0, 8)}, but that merge changed none of the ${r.cited.length} path(s) it cites; read by hand`);
  }
  for (const r of by("NO-HISTORY")) console.log(`  ?      ${r.file}:${r.line} ${r.row} — no adding commit reachable from HEAD; NOT MEASURED`);
  const s = by("STALE").length, u = by("LANDED-UNCORROBORATED").length, n = by("NOT-VIA-PR").length, h = by("NO-HISTORY").length, c = by("CLOSED-RESIDUE").length;
  console.log(`REPORTED: ${results.length} FIX PROPOSED annotation(s) — ${s} stale (open row, landed via PR), ${u} landed-uncorroborated, ${c} closed-row residue, ${n} not landed via a PR merge, ${h} not measured. Never fatal (plan row 170).`);
}

function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), "row-drift-"));
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", GIT_AUTHOR_DATE: "2026-10-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-10-01T00:00:00Z" };
  const g = (...args) => execFileSync("git", args, { cwd: dir, env, encoding: "utf8" }).trim();
  const ledger = LEDGERS[0];
  const write = (p, s) => { mkdirSync(join(dir, p, ".."), { recursive: true }); writeFileSync(join(dir, p), s); };
  const row = (n, tail) => `${n}. **Row ${n}.** — OPEN, qa.${tail}\n`;
  const ann = (br, path) => ` FIX PROPOSED 2026-10-01 (branch ${br}, lands under DR-037): \`${path}\` changed.`;
  let base = "";
  const checks = [];
  try {
    g("init", "-q", "-b", "main");
    base = row(1, "") + row(2, "") + row(3, "") + row(4, "");
    write(ledger, base); write("scripts/a.mjs", "1\n"); write("scripts/b.mjs", "1\n");
    g("add", "-A"); g("commit", "-qm", "base");
    // Row 1: annotation + fix on the branch, merged as a PR — must be STALE.
    g("checkout", "-qb", "claude/fix-a");
    write(ledger, base.replace(row(1, ""), row(1, ann("claude/fix-a", "scripts/a.mjs")))); write("scripts/a.mjs", "2\n");
    write(LEDGERS[1], `- [x] **Done** — closed.${ann("claude/fix-a", "scripts/a.mjs")}\n`);
    g("add", "-A"); g("commit", "-qm", "fix a");
    g("checkout", "-q", "main"); g("merge", "-q", "--no-ff", "-m", "Merge pull request #7: fix a", "claude/fix-a");
    // Row 2: a docs-only PR pre-announces a fix whose code never merged — must be READ, not STALE.
    g("checkout", "-qb", "claude/restamp");
    let cur = readFileSync(join(dir, ledger), "utf8");
    write(ledger, cur.replace(row(2, ""), row(2, ann("claude/fix-b", "scripts/b.mjs"))));
    g("add", "-A"); g("commit", "-qm", "restamp");
    g("checkout", "-q", "main"); g("merge", "-q", "--no-ff", "-m", "Merge pull request #8: restamp", "claude/restamp");
    // Row 3: a sync merge (not a PR merge) is the landing commit — must not be STALE.
    g("checkout", "-qb", "claude/fix-c");
    cur = readFileSync(join(dir, ledger), "utf8");
    write(ledger, cur.replace(row(3, ""), row(3, ann("claude/fix-c", "scripts/a.mjs")))); write("scripts/a.mjs", "3\n");
    g("add", "-A"); g("commit", "-qm", "fix c");
    g("checkout", "-q", "main"); g("merge", "-q", "--no-ff", "-m", "Merge branch 'claude/fix-c'", "claude/fix-c");
    // Row 4: in flight — HEAD is the worker's own branch; its annotation must not be STALE.
    g("checkout", "-qb", "claude/fix-d");
    cur = readFileSync(join(dir, ledger), "utf8");
    write(ledger, cur.replace(row(4, ""), row(4, ann("claude/fix-d", "scripts/b.mjs")))); write("scripts/b.mjs", "4\n");
    g("add", "-A"); g("commit", "-qm", "fix d");

    const res = Object.fromEntries(measure(dir).map((r) => [r.row, r]));
    checks.push(["planted stale row (annotation + fix merged as PR #7) is flagged STALE", res["row 1"]?.status === "STALE" && res["row 1"]?.pr === 7]);
    checks.push(["docs-only pre-announcement (PR #8, cited code never merged) is READ, not STALE", res["row 2"]?.status === "LANDED-UNCORROBORATED"]);
    checks.push(["annotation landed by a non-PR merge is not STALE", res["row 3"]?.status === "NOT-VIA-PR"]);
    checks.push(["in-flight annotation on the worker's own branch is not STALE", res["row 4"]?.status === "NOT-VIA-PR"]);
    checks.push(["a ticked backlog box carrying a landed annotation is residue, not STALE", res['"Done"']?.status === "CLOSED-RESIDUE"]);
    checks.push(["exactly one row flagged STALE", Object.values(res).filter((r) => r.status === "STALE").length === 1]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  let failed = 0;
  for (const [name, ok] of checks) { console.log(`  ${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failed++; }
  console.log(`row-status-drift self-test: ${checks.length - failed}/${checks.length} passed`);
  return failed === 0 && checks.length === 6;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  if (process.argv.includes("--self-test")) {
    process.exit(selfTest() ? 0 : 1);
  }
  const cwd = process.cwd();
  let shallow = "true";
  try { shallow = git(cwd, ["rev-parse", "--is-shallow-repository"]); } catch { /* not a repo: treated as shallow */ }
  if (shallow !== "false") {
    console.log("REPORTED: NOT MEASURED — shallow or unreadable clone, history cannot be walked; this is never a clean result. Run on a full clone (plan row 170).");
    process.exit(0);
  }
  try {
    report(measure(cwd));
  } catch (e) {
    console.log(`REPORTED: NOT MEASURED — ${String(e.message).split("\n")[0]} (plan row 170).`);
  }
  process.exit(0);
}
