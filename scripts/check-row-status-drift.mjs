// check-row-status-drift.mjs — a row that still says FIX PROPOSED for work
// that has already landed. REPORTED, never fatal.
//
//   node scripts/check-row-status-drift.mjs              # report over the real tree (exit 0)
//   node scripts/check-row-status-drift.mjs --rest       # also check each landing PR's head.ref via `gh api`
//   node scripts/check-row-status-drift.mjs --self-test  # prove the detector can fire (exit 1 if not)
//   node scripts/check-row-status-drift.mjs --ping       # print one line and exit; the self-test uses it to prove the CLI entry runs
//
// Runs from any directory: the ledgers are read from HEAD at the repository
// top level (`git show HEAD:<ledger>`), never from the working tree, so the
// line numbers always match the history `git log -L` walks. A ledger missing
// at HEAD is a NOT MEASURED line, never silently skipped.
//
// WHY THIS EXISTS (plan row 170, the harder half). `check-backlog-evidence.mjs`
// says in its own header that it cannot tell a WRONG status. On 2026-10-01
// four rows (plan 29, 40b, 80, 180) read FIX PROPOSED while their PRs had
// merged, on the fifth restamp round. A first attempt at a control for this
// row ("a row may not read open while naming a merged PR") was discarded
// because it fired zero times: the stale rows named no PR.
//
// THE KEY. A build worker writes "FIX PROPOSED <date> (branch <X>, …)" into
// the row ON branch X, in the same commit or series as the fix. So the
// annotation text is a tracer. Per ROW, not per string: `git log -L` follows
// the annotation's own lines back to the oldest commit whose added text
// carries it (a second row carrying the same string has its own history, so
// a copy pasted or moved there later by another PR is attributed to THAT PR).
// The first first-parent commit of the tip descending from it is the commit
// that landed it: `Merge pull request #N`, or a squash commit `… (#N)` that
// GitHub itself committed (a worker's subject ending `(#N)` is not one); a
// branch's own sync merge is followed into its second parent. Measured on
// 2026-10-01 at 0cb19272 (before this branch merged mainline in): 28 of 28
// annotations in both ledgers resolved to a PR, including the three branches
// (gate-scope-analysis, assist-wire-whitespace-vectors,
// docs-truth-reason-copy-stale-rows) that `git log --grep='into
// claude/<branch>$'` misses, and the REST head.ref of all 18 distinct PRs
// equalled the branch the row names.
//
// WHAT A STALE LINE MEANS: the annotation's claim is in the tip's history, so
// the annotation needs restamping. It does NOT say the row should close — a
// ratchet row (several waves, each with its own annotation) can be correctly
// open with every annotation stale. Counts are given per annotation AND per
// distinct row for that reason.
//
// WHAT IS NOT A SOUND KEY, recorded so nobody rebuilds it:
//   - the branch name in history: merge subjects here are rewritten
//     ("Merge pull request #N: <title>"), remote heads are deleted after
//     merge, and the `into claude/<branch>` sync merges exist only when a
//     worker happened to merge mainline in (the branch-name grep missed 10 of 28).
//   - a PR number in the row: the stale rows name none until restamped.
//   - a file or symbol the row names: a cited file existing on the tip says
//     nothing; most fixes edit files that already existed.
//
// HOW THE KEY CAN LIE, and what each check does about it:
//   - a docs-only PR pre-announces a fix: STALE needs the landing commit to
//     also change a repo path the annotation itself cites (read only up to
//     the next row, checkbox, heading or blank line; never the ledgers);
//     otherwise LANDED-UNCORROBORATED, read by hand.
//   - a code PR from branch Y writes an annotation naming branch Z: offline,
//     a GitHub default subject ("Merge pull request #N from o/Y") or a sync
//     merge inside the PR ("… into Y") that names a different branch makes it
//     LANDED-UNCORROBORATED. The rewritten subjects here carry no branch, so
//     the rest is unverified offline and the line says so; `--rest` checks
//     head.ref against the annotation and demotes a mismatch.
//   - the row was closed but kept its annotation: a plan row whose status
//     (the sibling gate's own classifier) reads closed, or a ticked backlog
//     box, is CLOSED-RESIDUE, not STALE.
//   - CEILING, not caught: a fix that landed and was later reverted reads
//     STALE. A regression is a different question; the re-read owns it.
//
// FAIL-CLOSED, IN THE DIRECTION A REPORTER CAN BE: a shallow clone (CI's
// default checkout) cannot walk history, so the real-tree run prints NOT
// MEASURED and never "0 stale". An annotation whose history cannot be found
// prints a `?` line. The self-test builds its own full repository and is
// meaningful everywhere, CI included; it also proves the CLI entry runs from
// a path with a space and through a symlink (a guard that failed there exited
// 0 without running, which is the fail-open this file must not have).
//
// WHAT THIS DOES NOT DO: rows that read `open` without a FIX PROPOSED tracer
// (rows 83, 89, 134, 135 were that kind) are still undecidable from text and
// history. Those still need the standing re-read row 170 names.

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CLOSED_MARKERS, PARTIAL_MARKERS, marks, parseRows, statusText } from "./check-backlog-ownership.mjs";

export const LEDGERS = ["docs/COMPANY_BUILD_PLAN.md", "docs/BUILD_BACKLOG.md"];

// Whitespace-tolerant: a hard-wrapped annotation is still an annotation.
const ANNOTATION = /FIX\s+PROPOSED\s+(\d{4}-\d{2}-\d{2})\s+\(branch\s+([A-Za-z0-9._/-]+)/g;
const PR_MERGE = /^Merge pull request #(\d+)(?: from [^/\s]+\/(\S+))?/;
const SQUASH = /\(#(\d+)\)$/;
// GitHub commits every squash merge itself; a worker's own commit whose subject
// happens to end "(#N)" is not a landing.
const GITHUB_COMMITTER = "GitHub <noreply@github.com>";
const SYNC_INTO = /into (?:origin\/)?(claude\/[A-Za-z0-9._/-]+)$/;
const CITED_PATH = /[A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@-]+)+\.[A-Za-z0-9]+/g;
const norm = (t) => t.replace(/\s+/g, " ");

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** Plan-row closure exactly as check-backlog-evidence.mjs reads it (same imports, same order). */
function planRowClosed(text) {
  const status = statusText(text);
  if (PARTIAL_MARKERS.some((m) => marks(status, m))) return false;
  return CLOSED_MARKERS.some((m) => marks(status, m));
}

/**
 * The row a line belongs to: plan rows are "N. **", backlog rows "- [ ] **"
 * at any indent (the nearest box above wins, so a child row is its own row).
 * A row already closed carries residue, not a wrong status.
 */
function rowOf(lines, idx, planRows) {
  for (let i = idx; i >= 0; i--) {
    // Plan rows use the sibling gate's row grammar (check-backlog-ownership.mjs
    // ROW_HEAD): a numbered line WITHOUT bold is a list item, not a row, there too.
    const plan = /^(\d+[a-z]*(?:-\d+)?)\.\s+\*\*/.exec(lines[i]);
    if (plan) {
      const r = planRows.find((x) => x.id === plan[1]);
      return { row: `row ${plan[1]}`, closed: r ? planRowClosed(r.text) : false };
    }
    // Any checkbox is a row, bold or not, at any indent (the sibling's
    // parseBacklogRows reads `- [ ] ` with or without bold).
    const box = /^\s*[-*] \[([ xX])\]\s+(.*)$/.exec(lines[i]);
    if (box) return { row: `"${box[2].replace(/\*\*/g, "").replace(/\s+—.*$/, "").slice(0, 60).trim()}"`, closed: box[1] !== " " };
  }
  return { row: "(no row)", closed: false };
}

/** Every FIX PROPOSED annotation in a ledger's text, with its line span and the paths it cites. */
export function findAnnotations(file, text) {
  const out = [];
  const lines = text.split("\n");
  const planRows = parseRows(text);
  const lineAt = (off) => text.slice(0, off).split("\n").length;
  const all = [...text.matchAll(ANNOTATION)];
  all.forEach((m, k) => {
    // The cited paths are the annotation's OWN: the span stops at the next
    // annotation, the next row or checkbox head, a heading, or a blank line.
    const after = text.slice(m.index + m[0].length);
    const stop = after.search(/\n(?:\s*\n|\d+[a-z]*(?:-\d+)?\.\s|\s*[-*] \[[ xX]\]|#)/);
    const end = Math.min(k + 1 < all.length ? all[k + 1].index : text.length, m.index + m[0].length + (stop < 0 ? after.length : stop), m.index + 2000);
    const span = text.slice(m.index, end);
    const line = lineAt(m.index);
    const lastLine = lineAt(m.index + m[0].length);
    const cited = [...new Set(span.match(CITED_PATH) ?? [])].filter((p) => !LEDGERS.includes(p));
    out.push({ file, line, lastLine, ...rowOf(lines, line - 1, planRows), date: m[1], branch: m[2], key: norm(m[0]), cited });
  });
  return out;
}

/** Oldest commit in THIS row's line history whose added text carries the annotation. */
function introOf(cwd, a) {
  const log = git(cwd, ["log", "--format=C %H", `-L${a.line},${a.lastLine}:${a.file}`, "HEAD"]);
  let cur = null, added = [], found = null;
  const flush = () => { if (cur && norm(added.join("\n")).includes(a.key)) found = cur; };
  for (const l of log.split("\n")) {
    if (l.startsWith("C ")) { flush(); cur = l.slice(2); added = []; continue; }
    if (l.startsWith("+") && !l.startsWith("+++")) added.push(l.slice(1));
  }
  flush();
  return found; // log is newest-first, so the last match is the oldest
}

const fpCache = new Map();
function firstParent(cwd, tip) {
  if (!fpCache.has(tip)) fpCache.set(tip, new Set(git(cwd, ["rev-list", "--first-parent", tip]).split("\n")));
  return fpCache.get(tip);
}

/** The commit on `tip`'s first-parent line that landed `intro`, following sync merges into their branch. */
function landingOf(cwd, intro, tip, depth = 0) {
  const fp = firstParent(cwd, tip);
  if (fp.has(intro)) {
    const [subject, committer] = git(cwd, ["log", "-1", "--format=%s%n%cn <%ce>", intro]).split("\n");
    const sq = committer === GITHUB_COMMITTER ? SQUASH.exec(subject) : null;
    return sq ? { land: intro, pr: Number(sq[1]), squash: true } : { land: intro };
  }
  const desc = git(cwd, ["rev-list", "--ancestry-path", `${intro}..${tip}`]).split("\n").filter((h) => fp.has(h));
  const land = desc[desc.length - 1];
  if (!land) return null;
  const subject = git(cwd, ["log", "-1", "--format=%s", land]);
  const pr = PR_MERGE.exec(subject);
  if (pr) return { land, pr: Number(pr[1]), subjectBranch: pr[2] };
  const parents = git(cwd, ["log", "-1", "--format=%P", land]).split(" ");
  if (parents.length > 1 && depth < 8) return landingOf(cwd, intro, parents[1], depth + 1);
  return { land };
}

/** Offline evidence of which branch a landing PR came from: "match" | "mismatch" | "unknown". */
function branchEvidence(cwd, a, l) {
  if (l.subjectBranch) return l.subjectBranch === a.branch ? "match" : "mismatch";
  if (l.squash) return "unknown";
  const syncs = git(cwd, ["log", "--merges", "--format=%s", `${l.land}^1..${l.land}^2`]).split("\n")
    .map((s) => SYNC_INTO.exec(s)?.[1]).filter(Boolean);
  if (syncs.includes(a.branch)) return "match";
  return syncs.length ? "mismatch" : "unknown";
}

/**
 * Classify one annotation against the history of `cwd` at HEAD.
 *   STALE                  landed via a PR whose commit also changed a cited path
 *   LANDED-UNCORROBORATED  landed via a PR, but no cited path changed or the PR's branch is not the one named
 *   CLOSED-RESIDUE         landed, but the row already reads closed
 *   NOT-VIA-PR             not landed through a PR merge or squash (a branch tip, a direct push)
 *   NO-HISTORY             no adding commit found in this row's line history
 */
export function classify(cwd, a, opts = {}) {
  const intro = introOf(cwd, a);
  if (!intro) return { ...a, status: "NO-HISTORY" };
  const l = landingOf(cwd, intro, "HEAD");
  if (!l) return { ...a, status: "NO-HISTORY", intro };
  if (!l.pr) return { ...a, status: "NOT-VIA-PR", intro, land: l.land };
  const changed = new Set(git(cwd, ["diff", "--name-only", `${l.land}^1`, l.land]).split("\n"));
  const hit = a.cited.filter((p) => changed.has(p));
  let branch = branchEvidence(cwd, a, l);
  if (branch === "unknown" && opts.rest) branch = opts.rest(l.pr, a.branch);
  const ok = hit.length > 0 && branch !== "mismatch";
  const status = a.closed ? "CLOSED-RESIDUE" : ok ? "STALE" : "LANDED-UNCORROBORATED";
  return { ...a, status, intro, land: l.land, pr: l.pr, hit, branchEvidence: branch };
}

export function measure(where, ledgers = LEDGERS, opts = {}) {
  fpCache.clear();
  const cwd = git(where, ["rev-parse", "--show-toplevel"]);
  const results = [];
  for (const file of ledgers) {
    let text;
    try { text = git(cwd, ["show", `HEAD:${file}`]); } catch { results.push({ file, line: 0, row: "(whole ledger)", status: "NO-LEDGER" }); continue; }
    for (const a of findAnnotations(file, text)) results.push(classify(cwd, a, opts));
  }
  return results;
}

/** --rest: compare the PR's head.ref with the annotation's branch. Unreachable = still unknown. */
function restBranch(cwd) {
  let repo = "";
  try { repo = git(cwd, ["remote", "get-url", "origin"]).match(/github\.com[:/]([^/]+\/[^/.]+)/)?.[1] ?? ""; } catch { /* no origin */ }
  return (pr, branch) => {
    if (!repo) return "unknown";
    try {
      const ref = execFileSync("gh", ["api", `repos/${repo}/pulls/${pr}`, "--jq", ".head.ref"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      return ref === branch ? "match" : "mismatch";
    } catch { return "unknown"; }
  };
}

function report(results) {
  const by = (s) => results.filter((r) => r.status === s);
  const note = (r) => (r.branchEvidence === "match" ? "branch verified" : "branch unverified offline");
  for (const r of by("STALE")) {
    console.log(`  STALE  ${r.file}:${r.line} ${r.row} — FIX PROPOSED (branch ${r.branch}) landed: PR #${r.pr} at ${r.land.slice(0, 8)} (commit ${r.intro.slice(0, 8)}; changed ${r.hit[0]}; ${note(r)}) — restamp the annotation`);
  }
  for (const r of by("LANDED-UNCORROBORATED")) {
    const why = r.branchEvidence === "mismatch" ? `PR #${r.pr} came from a different branch than ${r.branch}` : `that commit changed none of the ${r.cited.length} path(s) it cites`;
    console.log(`  READ   ${r.file}:${r.line} ${r.row} — annotation landed via PR #${r.pr} at ${r.land.slice(0, 8)}, but ${why}; read by hand`);
  }
  for (const r of by("NO-LEDGER")) console.log(`  ?      ${r.file} — not present at HEAD; NOT MEASURED (a renamed or missing ledger is never a clean result)`);
  for (const r of by("NO-HISTORY")) console.log(`  ?      ${r.file}:${r.line} ${r.row} — no adding commit in this row's line history; NOT MEASURED`);
  const s = by("STALE"), u = by("LANDED-UNCORROBORATED").length, n = by("NOT-VIA-PR").length, h = by("NO-HISTORY").length + by("NO-LEDGER").length, c = by("CLOSED-RESIDUE").length;
  const rows = new Set(s.map((r) => `${r.file}|${r.row}`)).size;
  console.log(`REPORTED: ${results.filter((r) => r.status !== "NO-LEDGER").length} FIX PROPOSED annotation(s) — ${s.length} stale (claim already landed via a PR) across ${rows} open row(s), ${u} landed-uncorroborated, ${c} closed-row residue, ${n} not landed via a PR, ${h} not measured. A stale annotation needs restamping; its row may still have work left. Never fatal (plan row 170).`);
}

function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), "row-drift-"));
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", GIT_AUTHOR_DATE: "2026-10-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-10-01T00:00:00Z" };
  const g = (...args) => execFileSync("git", args, { cwd: dir, env, encoding: "utf8" }).trim();
  const gAs = (who, ...args) => execFileSync("git", args, { cwd: dir, env: { ...env, GIT_COMMITTER_NAME: who[0], GIT_COMMITTER_EMAIL: who[1] }, encoding: "utf8" }).trim();
  const [plan, backlog] = LEDGERS;
  const write = (p, s) => { mkdirSync(join(dir, p, ".."), { recursive: true }); writeFileSync(join(dir, p), s); };
  const read = (p) => readFileSync(join(dir, p), "utf8");
  const edit = (p, from, to) => { const cur = read(p); if (!cur.includes(from)) throw new Error(`self-test fixture: ${from} not in ${p}`); write(p, cur.replace(from, to)); };
  const row = (n) => `${n}. **Row ${n}.** — OPEN, qa.`;
  const ann = (br, path) => ` FIX PROPOSED 2026-10-01 (branch ${br}, lands under DR-037): \`${path}\` changed.`;
  const commit = (m) => { g("add", "-A"); g("commit", "-qm", m); };
  const pr = (branch, n, fn, how = "merge") => {
    g("checkout", "-qb", branch); fn(); commit(`work on ${branch}`); g("checkout", "-q", "main");
    if (how === "squash") { g("merge", "-q", "--squash", branch); g("add", "-A"); gAs(["GitHub", "noreply@github.com"], "commit", "-qm", `squash ${branch} (#${n})`); }
    else g("merge", "-q", "--no-ff", "-m", how === "default" ? `Merge pull request #${n} from o/${branch}` : `Merge pull request #${n}: ${branch}`, branch);
  };
  const ids = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13"];
  const checks = [];
  try {
    g("init", "-q", "-b", "main");
    write(plan, "## Global backlog\n\n" + ids.map((n) => row(n)).join("\n") + "\n");
    write(backlog, "- [x] **Done** — closed.\n- [x] **Parent** — closed.\n  - [ ] **Child** — open.\n- [x] **Closed parent** — closed.\n- [ ] Plain open box — open.\n");
    for (const f of ["a", "b", "c", "d"]) write(`scripts/${f}.mjs`, "0\n");
    commit("base");
    // 1: annotation + fix on the branch, merged as a PR — STALE. Also lands the closed box's residue.
    pr("claude/fix-a", 7, () => {
      edit(plan, row(1), row(1) + ann("claude/fix-a", "scripts/a.mjs")); write("scripts/a.mjs", "1\n");
      edit(backlog, "**Done** — closed.", "**Done** — closed." + ann("claude/fix-a", "scripts/a.mjs"));
    });
    // 2: a docs-only PR pre-announces a fix whose code never merged — READ.
    pr("claude/restamp", 8, () => edit(plan, row(2), row(2) + ann("claude/fix-b", "scripts/b.mjs")));
    // 3: landed only through a non-PR merge — NOT-VIA-PR.
    g("checkout", "-qb", "claude/fix-c"); edit(plan, row(3), row(3) + ann("claude/fix-c", "scripts/a.mjs")); write("scripts/a.mjs", "3\n"); commit("fix c");
    g("checkout", "-q", "main"); g("merge", "-q", "--no-ff", "-m", "Merge branch 'claude/fix-c'", "claude/fix-c");
    // 5: hard-wrapped annotation, merged as a PR — STALE.
    pr("claude/fix-e", 9, () => { edit(plan, row(5), row(5) + " FIX PROPOSED\n    2026-10-01 (branch claude/fix-e, lands under DR-037): `scripts/c.mjs`."); write("scripts/c.mjs", "5\n"); });
    // 6: the SAME key pasted into another row by a docs-only PR — READ for row 6 (row 1 stays STALE).
    pr("claude/copy-key", 10, () => edit(plan, row(6), row(6) + ann("claude/fix-a", "scripts/a.mjs")));
    // 7: squash merge — STALE.
    pr("claude/fix-g", 11, () => { edit(plan, row(7), row(7) + ann("claude/fix-g", "scripts/d.mjs")); write("scripts/d.mjs", "7\n"); }, "squash");
    // 8: a code PR from branch y writes an annotation naming branch z (default subject names y) — READ.
    pr("claude/y", 12, () => { edit(plan, row(8), row(8) + ann("claude/z", "scripts/a.mjs")); write("scripts/a.mjs", "8\n"); }, "default");
    // 9: a plan row restamped DONE that kept its annotation — CLOSED-RESIDUE.
    pr("claude/fix-i", 13, () => { edit(plan, row(9), row(9) + ann("claude/fix-i", "scripts/b.mjs")); write("scripts/b.mjs", "9\n"); });
    pr("claude/restamp-9", 14, () => edit(plan, `${row(9)}${ann("claude/fix-i", "scripts/b.mjs")}`, `9. **Row 9.** — DONE (PR #13).${ann("claude/fix-i", "scripts/b.mjs")}`));
    // Child: an open child under a ticked parent, landed — STALE (not the parent's residue).
    pr("claude/fix-child", 15, () => { edit(backlog, "**Child** — open.", "**Child** — open." + ann("claude/fix-child", "scripts/c.mjs")); write("scripts/c.mjs", "c\n"); });
    // 12: a code PR changes a path only the NEXT row cites; row 12's own cited path never changed — READ.
    pr("claude/restamp-and-fix-a", 18, () => {
      edit(plan, row(12), row(12) + ann("claude/fix-l", "scripts/b.mjs"));
      edit(plan, row(13), row(13) + " See `scripts/a.mjs`."); write("scripts/a.mjs", "12\n");
    });
    // Plain box: a non-bold open box under a ticked bold one, landed — STALE, not the ticked box's residue.
    pr("claude/fix-m", 19, () => { edit(backlog, "Plain open box — open.", "Plain open box — open." + ann("claude/fix-m", "scripts/c.mjs")); write("scripts/c.mjs", "m\n"); });
    // 10: the worker's branch merged mainline in (a sync merge) before its PR landed — STALE via the PR.
    g("checkout", "-qb", "claude/fix-j"); edit(plan, row(10), row(10) + ann("claude/fix-j", "scripts/d.mjs")); write("scripts/d.mjs", "10\n"); commit("fix j");
    g("checkout", "-q", "main"); write("scripts/other.mjs", "x\n"); commit("unrelated mainline commit");
    g("checkout", "-q", "claude/fix-j"); g("merge", "-q", "--no-ff", "-m", "Merge remote-tracking branch 'origin/main' into claude/fix-j", "main");
    g("checkout", "-q", "main"); g("merge", "-q", "--no-ff", "-m", "Merge pull request #16: fix j", "claude/fix-j");
    // 11: a row that arrived on a branch tip through a sync merge from a mainline where it landed via PR — STALE.
    pr("claude/fix-k", 17, () => { edit(plan, row(11), row(11) + ann("claude/fix-k", "scripts/a.mjs")); write("scripts/a.mjs", "11\n"); });
    const mainTip = g("rev-parse", "HEAD");
    g("checkout", "-qb", "claude/worker", "HEAD~1"); write("scripts/w.mjs", "w\n"); commit("worker commit");
    g("merge", "-q", "--no-ff", "-m", "Merge remote-tracking branch 'origin/main' into claude/worker", mainTip);
    // 4: in flight — HEAD is the worker's own branch; its annotation must not be STALE.
    // …and the worker's own commit subject happens to end "(#99)": not a squash landing (GitHub did not commit it).
    edit(plan, row(4), row(4) + ann("claude/worker", "scripts/w.mjs")); write("scripts/w.mjs", "4\n"); commit("fix 4 (#99)");

    const res = Object.fromEntries(measure(dir).map((r) => [r.row, r]));
    const is = (k, st, extra = () => true) => res[k]?.status === st && extra(res[k]);
    checks.push(["planted stale row (annotation + fix merged as PR #7) is flagged STALE", is("row 1", "STALE", (r) => r.pr === 7)]);
    checks.push(["docs-only pre-announcement (cited code never merged) is READ, not STALE", is("row 2", "LANDED-UNCORROBORATED")]);
    checks.push(["annotation landed only by a non-PR merge is not STALE", is("row 3", "NOT-VIA-PR")]);
    checks.push(["in-flight annotation on the worker's own branch (subject ending `(#99)`) is not STALE", is("row 4", "NOT-VIA-PR")]);
    checks.push(["a hard-wrapped annotation is found and flagged STALE", is("row 5", "STALE", (r) => r.pr === 9)]);
    checks.push(["the same key pasted into a second row by a docs-only PR is attributed to THAT PR and READ", is("row 6", "LANDED-UNCORROBORATED", (r) => r.pr === 10)]);
    checks.push(["a squash merge `… (#11)` is a landing and flags STALE", is("row 7", "STALE", (r) => r.pr === 11)]);
    checks.push(["a PR from branch y carrying an annotation naming branch z is READ, not STALE", is("row 8", "LANDED-UNCORROBORATED", (r) => r.branchEvidence === "mismatch")]);
    checks.push(["a plan row restamped DONE that kept its annotation is residue, not STALE", is("row 9", "CLOSED-RESIDUE")]);
    checks.push(["a branch that merged mainline in still resolves to its own PR", is("row 10", "STALE", (r) => r.pr === 16 && r.branchEvidence === "match")]);
    checks.push(["a row reaching a branch tip through a sync merge resolves to mainline's PR", is("row 11", "STALE", (r) => r.pr === 17)]);
    checks.push(["a ticked backlog box carrying a landed annotation is residue, not STALE", is('"Done"', "CLOSED-RESIDUE")]);
    checks.push(["an open child row under a ticked parent is its own row and flags STALE", is('"Child"', "STALE", (r) => r.pr === 15)]);
    checks.push(["a path cited only by the NEXT row does not corroborate this row — READ", is("row 12", "LANDED-UNCORROBORATED", (r) => r.pr === 18)]);
    checks.push(["a non-bold open box under a ticked bold box is its own row and flags STALE", is('"Plain open box"', "STALE", (r) => r.pr === 19)]);
    const stale = Object.values(res).filter((r) => r.status === "STALE").map((r) => r.row).sort();
    checks.push(["exactly the planted stale rows are flagged", JSON.stringify(stale) === JSON.stringify(['"Child"', '"Plain open box"', "row 1", "row 10", "row 11", "row 5", "row 7"])]);
    const sig = (rs) => JSON.stringify(rs.map((r) => [r.file, r.row, r.status, r.pr ?? null]));
    const missing = measure(dir, [plan, "docs/RENAMED_LEDGER.md"]);
    checks.push(["a ledger missing at HEAD is NOT MEASURED, never skipped", missing.some((r) => r.file === "docs/RENAMED_LEDGER.md" && r.status === "NO-LEDGER")]);
    checks.push(["measured from a subdirectory, the result is identical", sig(measure(join(dir, "scripts"))) === sig(Object.values(res))]);
    write(plan, "inserted line\n" + read(plan));
    checks.push(["an uncommitted ledger edit does not shift the measurement (HEAD is read)", sig(measure(dir)) === sig(Object.values(res))]);
    let sub = "";
    try { sub = execFileSync(process.execPath, [fileURLToPath(import.meta.url)], { cwd: join(dir, "scripts"), encoding: "utf8" }); } catch { /* counted below */ }
    checks.push(["the CLI run from a subdirectory reports the real annotation count", sub.includes(`REPORTED: ${Object.values(res).length} FIX PROPOSED`)]);
    // The CLI entry must run from a path with a space and through a symlink (a failed guard exits 0 silently).
    const spaced = join(dir, "sp ace é");
    mkdirSync(spaced);
    const link = join(spaced, "link.mjs");
    symlinkSync(fileURLToPath(import.meta.url), link);
    let out = "";
    try { out = execFileSync(process.execPath, [link, "--ping"], { encoding: "utf8" }); } catch { /* counted below */ }
    checks.push(["the CLI runs from a path with a space and an accent, through a symlink", out.trim() === "row-status-drift: entry ran"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  let failed = 0;
  for (const [name, ok] of checks) { console.log(`  ${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failed++; }
  console.log(`row-status-drift self-test: ${checks.length - failed}/${checks.length} passed`);
  return failed === 0 && checks.length === 21;
}

let isMain = false;
try {
  isMain = !!process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === pathToFileURL(realpathSync(fileURLToPath(import.meta.url))).href;
} catch {
  // realpath failed: fall back to the unresolved comparison rather than to silence.
  isMain = !!process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}
if (isMain) {
  if (process.argv.includes("--ping")) {
    console.log("row-status-drift: entry ran");
    process.exit(0);
  }
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
    report(measure(cwd, LEDGERS, process.argv.includes("--rest") ? { rest: restBranch(cwd) } : {}));
  } catch (e) {
    console.log(`REPORTED: NOT MEASURED — ${String(e.message).split("\n")[0]} (plan row 170).`);
  }
  process.exit(0);
}
