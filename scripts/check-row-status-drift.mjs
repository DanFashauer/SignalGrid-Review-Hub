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
// line numbers always match the history `git log -L` walks. A ledger that is
// not a readable UTF-8 text file with rows at HEAD (missing, a directory, a
// symlink, a submodule, binary, UTF-16 or another encoding, a Git LFS pointer,
// a lone-CR line break, merge-conflict markers, no rows in its own grammar, or
// more than a quarter below its high-water marks — bytes and rows — over its
// last 50 changes, or with history that cannot be read) is a NOT MEASURED
// line, never silently zero. CEILINGS (see readLedger): a cut under a quarter
// cannot be told from a deliberate deletion, any cut over a quarter reads clean
// again after 49 further changes to that ledger, a rename plus a cut in one
// commit has no earlier copy to compare, a cut REPLACED by as many new rows of
// the same size — or the same lines re-ended with CRLF, whose extra bytes offset
// the cut — reads as an edit (both marks hold), and the marks follow the
// first-parent line only, so content that only ever existed on a merged side
// branch never raises them. A landing is traced through at most 8 nested sync
// merges; deeper is NOT MEASURED. An octopus merge's extra parents are not
// followed, so its annotations read not-via-PR or NOT MEASURED, never stale. A ledger with uncommitted edits, or flagged
// assume-unchanged/skip-worktree, gets a NOTE saying HEAD's copy was measured. The exit code is
// 0 in every case, NOT MEASURED included: report-only is the contract this
// row was dispatched with (making NOT MEASURED fatal is the owner's call).
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
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CLOSED_MARKERS, PARTIAL_MARKERS, marks, parseRows, statusText } from "./check-backlog-ownership.mjs";

export const LEDGERS = ["docs/COMPANY_BUILD_PLAN.md", "docs/BUILD_BACKLOG.md"];
const HIGH_WATER_WINDOW = 50;

// Whitespace-tolerant: a hard-wrapped annotation is still an annotation.
// Every dated FIX PROPOSED is found; its SHAPE is read next. A shape the
// detector cannot read is a NOT MEASURED line, never silently skipped.
const DATED = /FIX\s+PROPOSED\s+(\d{4}-\d{2}-\d{2})/g;
const BRANCH_SHAPE = /^\s+\(branch\s+([A-Za-z0-9._/-]+)/;
const PR_SHAPE = /^\s+\(PR\s+#(\d+)(?:,\s*([0-9a-f]{7,40}))?/;
const PR_MERGE = /^Merge pull request #(\d+)(?: from [^/\s]+\/(\S+))?/;
const SQUASH = /\(#(\d+)\)$/;
// A merge GitHub itself committed under a custom title (the landing chain's
// "… (#1376, check run …)" and "… (#N) — merged under DR-037 …") is a PR landing too.
const GITHUB_TITLED_MERGE = /\(#(\d+)[,)\s]/;
// GitHub commits every squash merge itself; a worker's own commit whose subject
// happens to end "(#N)" is not a landing.
const GITHUB_COMMITTER = "GitHub <noreply@github.com>";
const SYNC_INTO = /into (?:origin\/)?(claude\/[A-Za-z0-9._/-]+)$/;
const CITED_PATH = /[A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@-]+)+\.[A-Za-z0-9]+/g;
const norm = (t) => t.replace(/\s+/g, " ");

// Replace refs are local and rewrite history as git reports it (a `git replace
// --graft` can hide the high-water copy); the detector reads the history as committed.
const SYNC_DEPTH = 8;
// The legacy graft file (.git/info/grafts, or GIT_GRAFT_FILE) does the same and
// is not covered by that switch, so it is pointed at an empty file.
// An inherited repository pointer would make git read a different repository, index or object
// store than the one being measured (an alternate object store can even substitute a blob), so
// all of them are dropped: git finds the repository from the working directory.
export const REPO_POINTERS = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES"];
export function gitEnvFrom(ambient) {
  return Object.fromEntries(
    Object.entries({ ...ambient, GIT_NO_REPLACE_OBJECTS: "1", GIT_GRAFT_FILE: "/dev/null" }).filter(([k]) => !REPO_POINTERS.includes(k)),
  );
}
const GIT_ENV = gitEnvFrom(process.env);
// Config, from any scope (system, global, repository, or passed through the environment), that
// changes the output this script parses is overridden on every call: colour codes hide the "+"
// of an added line, a non-UTF-8 log encoding rewrites "#" in a merge subject, and a signature
// check adds lines. Config scopes themselves are left alone (CI relies on safe.directory).
// CEILING: a config key outside this list that reshapes `git log` output is not neutralised.
// (color.diff=never also beats a color.ui=always from any scope, so color.ui needs no override.)
export const GIT_C = ["-c", "color.diff=never", "-c", "i18n.logOutputEncoding=UTF-8", "-c", "log.showSignature=false"];

function git(cwd, args) {
  return execFileSync("git", [...GIT_C, ...args], { cwd, env: GIT_ENV, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }).trim();
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
  const all = [...text.matchAll(DATED)].map((d) => {
    const rest = text.slice(d.index + d[0].length, d.index + d[0].length + 200);
    const b = BRANCH_SHAPE.exec(rest), p = b ? null : PR_SHAPE.exec(rest);
    const m = [d[0] + (b ? b[0] : p ? p[0] : ""), d[1]];
    m.index = d.index;
    return { m, kind: b ? "branch" : p ? "pr" : "unknown", branch: b?.[1], claimPr: p ? Number(p[1]) : undefined, claimSha: p?.[2] };
  });
  all.forEach(({ m, kind, branch, claimPr, claimSha }, k) => {
    // The cited paths are the annotation's OWN: the span stops at the next
    // annotation, the next row or checkbox head, a heading, or a blank line.
    const after = text.slice(m.index + m[0].length);
    const stop = after.search(/\n(?:\s*\n|\d+[a-z]*(?:-\d+)?\.\s|\s*[-*] \[[ xX]\]|#)/);
    const end = Math.min(k + 1 < all.length ? all[k + 1].m.index : text.length, m.index + m[0].length + (stop < 0 ? after.length : stop), m.index + 2000);
    const span = text.slice(m.index, end);
    const line = lineAt(m.index);
    const lastLine = lineAt(m.index + m[0].length);
    const cited = [...new Set(span.match(CITED_PATH) ?? [])].filter((p) => !LEDGERS.includes(p));
    out.push({ file, line, lastLine, ...rowOf(lines, line - 1, planRows), date: m[1], kind, branch, claimPr, claimSha, key: norm(m[0]), cited });
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
  const [subject, committer, parentLine] = git(cwd, ["log", "-1", "--format=%s%n%cn <%ce>%n%P", land]).split("\n");
  const pr = PR_MERGE.exec(subject);
  if (pr) return { land, pr: Number(pr[1]), subjectBranch: pr[2] };
  const parents = parentLine.split(" ");
  const titled = parents.length > 1 && committer === GITHUB_COMMITTER ? GITHUB_TITLED_MERGE.exec(subject) : null;
  if (titled) return { land, pr: Number(titled[1]) };
  if (parents.length > 1) {
    // Past SYNC_DEPTH nested sync merges the trace stops; that is NOT MEASURED, never "not via a PR".
    if (depth >= SYNC_DEPTH) return { land, capped: true };
    return landingOf(cwd, intro, parents[1], depth + 1);
  }
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
/** The first-parent commit of HEAD that landed PR #n: a PR merge subject, a GitHub-titled merge, or a GitHub squash. */
const fpLogCache = new Map();
function prLandingOf(cwd, n) {
  if (!fpLogCache.has(cwd)) {
    fpLogCache.set(cwd, git(cwd, ["log", "--first-parent", "--format=%H%x09%P%x09%cn <%ce>%x09%s", "HEAD"]).split("\n").map((l) => {
      const [sha, parents, committer, ...rest] = l.split("\t");
      return { sha, merge: parents.split(" ").length > 1, github: committer === GITHUB_COMMITTER, subject: rest.join("\t") };
    }));
  }
  return fpLogCache.get(cwd).find((c) => {
    const m = PR_MERGE.exec(c.subject);
    if (m) return Number(m[1]) === n;
    if (!c.github) return false;
    const t = (c.merge ? GITHUB_TITLED_MERGE : SQUASH).exec(c.subject);
    return t ? Number(t[1]) === n : false;
  });
}

/** An annotation that names its PR ("FIX PROPOSED <date> (PR #N, <sha>)"): read the claim directly. */
function classifyPrShape(cwd, a) {
  const l = prLandingOf(cwd, a.claimPr);
  if (!l) return { ...a, status: "NOT-VIA-PR" };
  const changed = new Set(git(cwd, ["diff", "--name-only", `${l.sha}^1`, l.sha]).split("\n"));
  const hit = a.cited.filter((p) => changed.has(p));
  let shaIn = true;
  if (a.claimSha) {
    try { git(cwd, ["merge-base", "--is-ancestor", a.claimSha, l.sha]); } catch { shaIn = false; }
  }
  const ok = hit.length > 0 && shaIn;
  const status = a.closed ? "CLOSED-RESIDUE" : ok ? "STALE" : "LANDED-UNCORROBORATED";
  return { ...a, status, land: l.sha, pr: a.claimPr, hit, shaIn, branchEvidence: "pr-named" };
}

export function classify(cwd, a, opts = {}) {
  if (a.kind === "unknown") return { ...a, status: "NO-HISTORY", why: "a dated FIX PROPOSED in a shape this detector cannot read (expected \"(branch X\" or \"(PR #N\")" };
  if (a.kind === "pr") return classifyPrShape(cwd, a);
  const intro = introOf(cwd, a);
  if (!intro) return { ...a, status: "NO-HISTORY", why: "no commit in this row's line history adds the annotation (added by a merge commit's own edit?)" };
  const l = landingOf(cwd, intro, "HEAD");
  if (!l) return { ...a, status: "NO-HISTORY", intro, why: `its adding commit ${intro.slice(0, 8)} reaches the tip by no first-parent or second-parent path (an octopus merge?)` };
  if (l.capped) return { ...a, status: "NO-HISTORY", intro, why: `its landing is nested under more than ${SYNC_DEPTH} non-PR merges; the trace stops there` };
  if (!l.pr) return { ...a, status: "NOT-VIA-PR", intro, land: l.land };
  const changed = new Set(git(cwd, ["diff", "--name-only", `${l.land}^1`, l.land]).split("\n"));
  const hit = a.cited.filter((p) => changed.has(p));
  let branch = branchEvidence(cwd, a, l);
  if (branch === "unknown" && opts.rest) branch = opts.rest(l.pr, a.branch);
  const ok = hit.length > 0 && branch !== "mismatch";
  const status = a.closed ? "CLOSED-RESIDUE" : ok ? "STALE" : "LANDED-UNCORROBORATED";
  return { ...a, status, intro, land: l.land, pr: l.pr, hit, branchEvidence: branch };
}

/**
 * A ledger's text at HEAD, or the reason it cannot be measured. Only a regular
 * file blob holding UTF-8 text with at least one row counts: a directory, a
 * symlink, a submodule, a binary or UTF-16 file, a Git LFS pointer, or a file
 * with no rows would otherwise read as "no annotations" — a clean-looking count
 * for a ledger nobody read. Line endings are normalised WITHOUT changing the
 * line count, so the numbers still match the history `git log -L` walks: CRLF
 * becomes LF, and a lone CR or a Unicode line/paragraph separator a space.
 */
export function readLedger(cwd, file) {
  let entry = "";
  try { entry = git(cwd, ["ls-tree", "HEAD", "--", file]); } catch { /* treated as absent */ }
  if (!entry) return { why: "not present at HEAD" };
  const mode = entry.split(/\s/)[0];
  if (mode !== "100644" && mode !== "100755") return { why: `not a regular file at HEAD (git mode ${mode})` };
  const raw = execFileSync("git", [...GIT_C, "show", `HEAD:${file}`], { cwd, env: GIT_ENV, maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  // UTF-16 puts a NUL beside every ASCII character, so this catches it with or without a BOM.
  if (raw.includes(0)) return { why: "holds a NUL byte (binary or UTF-16), not UTF-8 text" };
  let decoded;
  try { decoded = new TextDecoder("utf-8", { fatal: true }).decode(raw); } catch { return { why: "is not valid UTF-8 (a single-byte encoding such as cp1252?)" }; }
  if (decoded.startsWith("version https://git-lfs")) return { why: "is a Git LFS pointer, not the ledger" };
  // A lone CR is a line break to a Markdown renderer but not to git, so it could
  // join two rows into one line; refuse rather than guess which.
  if (/\r(?!\n)/.test(decoded)) return { why: "holds a lone CR line break, which git and Markdown count differently" };
  if (/^(?:<{7}|>{7}) /m.test(decoded)) return { why: "holds unresolved merge-conflict markers" };
  // TextDecoder already drops a leading BOM (ignoreBOM is false by default).
  const text = decoded.replace(/\r\n/g, "\n").replace(/[\u2028\u2029]/g, " ");
  // Rows in the ledger's OWN grammar: a backlog's checkboxes do not make a plan readable, nor the reverse.
  const rows = file === LEDGERS[1] ? (text.match(/^\s*[-*] \[[ xX]\]/gm) ?? []).length : parseRows(text).length;
  if (rows === 0) return { why: "has no rows in its own grammar (empty, cut before its first row, or its section heading renamed)" };
  // A ledger cut mid-file still has rows. Compare with HIGH-WATER MARKS over
  // its last HIGH_WATER_WINDOW changes on the first-parent line: the largest
  // size AND the most rows it reached. Comparing with the previous copy only
  // was not enough: one later edit, or a routine sync-merge, made the cut copy
  // the baseline, and cuts each under the floor added up unseen. Bytes alone
  // were not enough either: a cut padded back out with prose kept its size;
  // rows catch that. Measured across both ledgers' first-parent histories: no
  // copy fell below about 95% of its byte mark, and the row count NEVER fell
  // below its mark. Under 75% of either mark is refused. A history version
  // that cannot be read (a blob-less partial clone offline, a missing object)
  // is NOT MEASURED, never "nothing to compare".
  // CEILINGS: a cut under a quarter of the marks cannot be told from a
  // deliberate deletion; ANY cut over a quarter, accidental or deliberate,
  // reads clean again once it has aged out of the window (49 further changes
  // to that ledger — about a week on the plan ledger at its 2026-10 rate); a
  // rename and a cut in one commit has no earlier copy under the new path; a cut
  // replaced by as many new rows of the same size passes both marks; and the
  // walk is first-parent, so a size reached only on a merged side branch never
  // counts.
  const rowsOf = (t) => (file === LEDGERS[1] ? (t.match(/^\s*[-*] \[[ xX]\]/gm) ?? []).length : parseRows(t).length);
  let shas = [];
  try {
    shas = git(cwd, ["log", "--first-parent", `-${HIGH_WATER_WINDOW}`, "--format=%H", "HEAD", "--", file]).split("\n").filter(Boolean);
  } catch { return { why: "its history could not be walked (git log failed)" }; }
  let highBytes = 0, highRows = 0, atBytes = "", atRows = "";
  for (const h of shas) {
    let body;
    try { body = execFileSync("git", [...GIT_C, "show", `${h}:${file}`], { cwd, env: GIT_ENV, maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }); }
    catch {
      // Deleted at that commit is a real state, not an unreadable one.
      let gone = false;
      try { gone = git(cwd, ["ls-tree", h, "--", file]) === ""; } catch { gone = false; }
      if (gone) continue;
      return { why: `its copy at ${h.slice(0, 8)} could not be read (missing object or offline partial clone)` };
    }
    if (body.length > highBytes) { highBytes = body.length; atBytes = h; }
    const r = rowsOf(body.toString("utf8"));
    if (r > highRows) { highRows = r; atRows = h; }
  }
  if (highBytes > 0 && raw.length < highBytes * 0.75) return { why: `is ${raw.length} bytes against a high-water mark of ${highBytes} at ${atBytes.slice(0, 8)} within its last ${HIGH_WATER_WINDOW} changes (more than a quarter gone: truncated?)` };
  if (highRows > 0 && rows < highRows * 0.75) return { why: `has ${rows} rows against a high-water mark of ${highRows} at ${atRows.slice(0, 8)} within its last ${HIGH_WATER_WINDOW} changes (more than a quarter gone: truncated?)` };
  return { text };
}

export function measure(where, ledgers = LEDGERS, opts = {}) {
  fpCache.clear();
  fpLogCache.clear();
  const cwd = git(where, ["rev-parse", "--show-toplevel"]);
  const results = [];
  for (const file of ledgers) {
    const { text, why } = readLedger(cwd, file);
    if (why) { results.push({ file, line: 0, row: "(whole ledger)", status: "NO-LEDGER", why }); continue; }
    for (const a of findAnnotations(file, text)) results.push(classify(cwd, a, opts));
  }
  return results;
}

/**
 * Ledgers whose working-tree copy differs from HEAD, or that git is told not to
 * look at (assume-unchanged, skip-worktree): HEAD is what was measured, and the
 * report says so.
 */
export function uncommittedLedgers(where, ledgers = LEDGERS) {
  const cwd = git(where, ["rev-parse", "--show-toplevel"]);
  return ledgers.filter((f) => {
    try {
      const tag = git(cwd, ["ls-files", "-v", "--", f]).charAt(0);
      if (tag === "S" || (tag >= "a" && tag <= "z")) return true;
      return git(cwd, ["status", "--porcelain", "--", f]) !== "";
    } catch { return true; }
  });
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

function report(results, dirty = []) {
  for (const f of dirty) console.log(`  NOTE   ${f} has uncommitted changes (or is flagged assume-unchanged/skip-worktree); HEAD's copy was measured, the working-tree edit was NOT — commit it to have it read`);
  const by = (s) => results.filter((r) => r.status === s);
  const note = (r) => (r.kind === "pr" ? "PR named in the row" : r.branchEvidence === "match" ? "branch verified" : "branch unverified offline");
  const claim = (r) => (r.kind === "pr" ? `PR #${r.claimPr}${r.claimSha ? `, ${r.claimSha}` : ""}` : `branch ${r.branch}`);
  for (const r of by("STALE")) {
    console.log(`  STALE  ${r.file}:${r.line} ${r.row} — FIX PROPOSED (${claim(r)}) landed: PR #${r.pr} at ${r.land.slice(0, 8)} (${r.intro ? `commit ${r.intro.slice(0, 8)}; ` : ""}changed ${r.hit[0]}; ${note(r)}) — restamp the annotation`);
  }
  for (const r of by("LANDED-UNCORROBORATED")) {
    const why = r.branchEvidence === "mismatch" ? `PR #${r.pr} came from a different branch than ${r.branch}` : r.shaIn === false ? `the commit it cites (${r.claimSha}) is not in that landing` : `that commit changed none of the ${r.cited.length} path(s) it cites`;
    console.log(`  READ   ${r.file}:${r.line} ${r.row} — annotation landed via PR #${r.pr} at ${r.land.slice(0, 8)}, but ${why}; read by hand`);
  }
  for (const r of by("NO-LEDGER")) console.log(`  ?      ${r.file} — ${r.why}; NOT MEASURED (a ledger nobody could read is never a clean result)`);
  for (const r of by("NO-HISTORY")) console.log(`  ?      ${r.file}:${r.line} ${r.row} — ${r.why}; NOT MEASURED`);
  console.log(summaryLine(results));
}

/** The REPORTED line. Every unreadable ledger and every untraceable annotation counts as not measured. */
export function summaryLine(results) {
  const by = (s) => results.filter((r) => r.status === s);
  const s = by("STALE"), u = by("LANDED-UNCORROBORATED").length, n = by("NOT-VIA-PR").length, h = by("NO-HISTORY").length + by("NO-LEDGER").length, c = by("CLOSED-RESIDUE").length;
  const rows = new Set(s.map((r) => `${r.file}|${r.row}`)).size;
  return `REPORTED: ${results.filter((r) => r.status !== "NO-LEDGER").length} FIX PROPOSED annotation(s) — ${s.length} stale (claim already landed via a PR) across ${rows} open row(s), ${u} landed-uncorroborated, ${c} closed-row residue, ${n} not landed via a PR, ${h} not measured. A stale annotation needs restamping; its row may still have work left. Never fatal (plan row 170).`;
}

function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), "row-drift-"));
  // Fixtures drop the inherited repository pointers too, so an inherited GIT_DIR can never make them commit into another repository.
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !REPO_POINTERS.includes(k))), GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", GIT_AUTHOR_DATE: "2026-10-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-10-01T00:00:00Z" };
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
  const ids = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22"];
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
    // 14: an annotation citing only the ledger itself, landed by a docs-only PR — READ (a ledger never corroborates itself).
    pr("claude/self-cite", 20, () => edit(plan, row(14), row(14) + " FIX PROPOSED 2026-10-01 (branch claude/self-cite, lands under DR-037): see `docs/COMPANY_BUILD_PLAN.md`."));
    // 15: the only cited path sits past the 2000-character span cap — READ.
    pr("claude/far-cite", 21, () => { edit(plan, row(15), row(15) + ann("claude/far-cite", "no/path") + " " + "word ".repeat(450) + "`scripts/a.mjs`."); write("scripts/a.mjs", "15\n"); });
    // 16: the PR-named shape "FIX PROPOSED <date> (PR #N, <sha>)", landed as PR #23 — STALE.
    g("checkout", "-qb", "claude/pr-shape"); write("scripts/c.mjs", "16\n"); commit("fix 16");
    const fix16 = g("rev-parse", "--short=8", "HEAD");
    edit(plan, row(16), row(16) + ` FIX PROPOSED 2026-10-08 (PR #23, ${fix16}): \`scripts/c.mjs\` changed.`);
    // 20: same PR, but the commit it cites is not in that landing — READ by hand.
    edit(plan, row(20), row(20) + " FIX PROPOSED 2026-10-08 (PR #23, 1234567): `scripts/c.mjs` changed."); commit("annotate 16 and 20");
    g("checkout", "-q", "main"); g("merge", "-q", "--no-ff", "-m", "Merge pull request #23: pr shape", "claude/pr-shape");
    // 18: a dated FIX PROPOSED in a shape nobody reads — NOT MEASURED, never skipped.
    edit(plan, row(18), row(18) + " FIX PROPOSED 2026-10-08 (OFFLINE HALF ONLY), branch claude/x: `scripts/c.mjs`."); commit("odd shape");
    // 19: a GitHub-committed merge under a custom title "… (#24, check run …)" is PR #24's landing — STALE.
    g("checkout", "-qb", "claude/custom-title"); edit(plan, row(19), row(19) + ann("claude/custom-title", "scripts/d.mjs")); write("scripts/d.mjs", "19\n"); commit("fix 19");
    g("checkout", "-q", "main"); gAs(["GitHub", "noreply@github.com"], "merge", "-q", "--no-ff", "-m", "gates: custom title (#24, check run 5)", "claude/custom-title");
    // 21: a worker's own merge whose subject happens to carry "(#25" is not a landing — GitHub did not commit it.
    g("checkout", "-qb", "claude/fake-title"); edit(plan, row(21), row(21) + ann("claude/fake-title", "scripts/d.mjs")); write("scripts/d.mjs", "21\n"); commit("fix 21");
    g("checkout", "-q", "main"); g("merge", "-q", "--no-ff", "-m", "sync work (#25, local)", "claude/fake-title");
    // 22: a PR-named row whose only "(#26)" commit is the worker's own — not a landing either.
    write("scripts/c.mjs", "22\n"); commit("wip (#26)");
    edit(plan, row(22), row(22) + ` FIX PROPOSED 2026-10-08 (PR #26, ${g("rev-parse", "--short=8", "HEAD")}): \`scripts/c.mjs\`.`); commit("annotate 22");
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
    edit(plan, row(4), row(4) + ann("claude/worker", "scripts/w.mjs")); write("scripts/w.mjs", "4\n");
    // 17: a PR-named annotation whose PR has not landed — in flight, not STALE.
    edit(plan, row(17), row(17) + " FIX PROPOSED 2026-10-08 (PR #98, abc1234): `scripts/w.mjs`."); commit("fix 4 (#99)");

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
    checks.push(["a PR-named annotation \"(PR #23, <sha>)\" landed as PR #23 is flagged STALE", is("row 16", "STALE", (r) => r.pr === 23)]);
    checks.push(["a PR-named annotation whose PR has not landed is not STALE", is("row 17", "NOT-VIA-PR")]);
    checks.push(["a worker's merge titled \"(#25, …)\" is not a landing (GitHub did not commit it)", is("row 21", "NOT-VIA-PR")]);
    checks.push(["a PR-named row whose \"(#26)\" commit is the worker's own is not a landing", is("row 22", "NOT-VIA-PR")]);
    checks.push(["a PR-named annotation citing a commit not in that landing is READ, not STALE", is("row 20", "LANDED-UNCORROBORATED", (r) => r.shaIn === false)]);
    checks.push(["a dated FIX PROPOSED in an unreadable shape is NOT MEASURED, never skipped", is("row 18", "NO-HISTORY", (r) => /shape this detector cannot read/.test(r.why))]);
    checks.push(["a GitHub-committed merge titled \"… (#24, check run …)\" is PR #24's landing", is("row 19", "STALE", (r) => r.pr === 24)]);
    checks.push(["exactly the planted stale rows are flagged", JSON.stringify(stale) === JSON.stringify(['"Child"', '"Plain open box"', "row 1", "row 10", "row 11", "row 16", "row 19", "row 5", "row 7"])]);
    // The REPORTED line counts every bucket: one result of each kind gives a 1 in each place, 2 not measured.
    const kinds = ["STALE", "LANDED-UNCORROBORATED", "CLOSED-RESIDUE", "NOT-VIA-PR", "NO-HISTORY", "NO-LEDGER"];
    const line = summaryLine(kinds.map((status, i) => ({ status, file: "f", row: `r${i}` })));
    checks.push(["the REPORTED line counts every bucket, NO-HISTORY and NO-LEDGER both as not measured",
      line.startsWith("REPORTED: 5 FIX PROPOSED annotation(s) — 1 stale (claim already landed via a PR) across 1 open row(s), 1 landed-uncorroborated, 1 closed-row residue, 1 not landed via a PR, 2 not measured.")]);
    const sig = (rs) => JSON.stringify(rs.map((r) => [r.file, r.row, r.status, r.pr ?? null]));
    const missing = measure(dir, [plan, "docs/RENAMED_LEDGER.md"]);
    checks.push(["a ledger missing at HEAD is NOT MEASURED, never skipped", missing.some((r) => r.file === "docs/RENAMED_LEDGER.md" && r.status === "NO-LEDGER" && /not present at HEAD/.test(r.why))]);
    checks.push(["an annotation citing only the ledger itself is READ, not STALE", is("row 14", "LANDED-UNCORROBORATED", (r) => r.pr === 20)]);
    checks.push(["a cited path past the 2000-character span cap does not corroborate — READ", is("row 15", "LANDED-UNCORROBORATED", (r) => r.pr === 21)]);
    // A shallow clone (CI's checkout) is NOT MEASURED, never a clean count.
    {
      const shallowDir = mkdtempSync(join(tmpdir(), "row-drift-shallow-"));
      let out = "";
      try {
        execFileSync("git", ["clone", "-q", "--depth", "1", `file://${dir}`, shallowDir], { env, stdio: ["ignore", "pipe", "pipe"] });
        out = execFileSync(process.execPath, [fileURLToPath(import.meta.url)], { cwd: shallowDir, encoding: "utf8" });
      } catch (e) { out = `threw: ${String(e.message).split("\n")[0]}`; }
      finally { rmSync(shallowDir, { recursive: true, force: true }); }
      checks.push(["the CLI in a depth-1 clone prints NOT MEASURED, not a count", /^REPORTED: NOT MEASURED — shallow/m.test(out)]);
    }
    checks.push(["measured from a subdirectory, the result is identical", sig(measure(join(dir, "scripts"))) === sig(Object.values(res))]);
    write(plan, "inserted line\n" + read(plan));
    checks.push(["an uncommitted ledger edit does not shift the measurement (HEAD is read)", sig(measure(dir)) === sig(Object.values(res))]);
    checks.push(["…and the uncommitted ledger is named in a NOTE, not silently ignored", JSON.stringify(uncommittedLedgers(dir)) === JSON.stringify([plan])]);
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
  // A plan ledger committed in a shape nobody can read must be NOT MEASURED, never zero annotations.
  const shapeOf = (shape) => {
    const d = mkdtempSync(join(tmpdir(), "row-drift-shape-"));
    const gs = (...args) => execFileSync("git", args, { cwd: d, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    try {
      gs("init", "-q", "-b", "main");
      mkdirSync(join(d, "docs"), { recursive: true });
      writeFileSync(join(d, backlog), "- [ ] **Open** — open.\n");
      const then = shape(join(d, plan), d);
      gs("add", "-A"); gs("commit", "-qm", "shape");
      for (const step of typeof then === "function" ? [then] : then ?? []) { step(join(d, plan), gs); gs("add", "-A"); gs("commit", "-q", "--allow-empty", "-m", "then"); }
      const r = measure(d).find((x) => x.file === plan);
      return r ? `${r.status}: ${r.why ?? ""}` : "(no entry)";
    } finally { rmSync(d, { recursive: true, force: true }); }
  };
  const planText = "## Global backlog\n\n1. **Row 1.** — OPEN, qa. FIX PROPOSED 2026-10-01 (branch claude/x, lands under DR-037): `scripts/a.mjs`.\n";
  const bigPlan = "## Global backlog\n\n" + Array.from({ length: 40 }, (_, i) => `${i + 1}. **Row ${i + 1}.** — OPEN, qa. Some body text for row ${i + 1}.\n`).join("");
  // Rows with body lines, so bytes and rows can be cut independently of each other.
  const tallRows = Array.from({ length: 40 }, (_, i) => [`${i + 1}. **Row ${i + 1}.** — OPEN, qa.`, `    First body line for row ${i + 1}, with a few more words in it.`, `    Second body line for row ${i + 1}, also carrying some words.`]);
  const tallPlan = (rows) => "## Global backlog\n\n" + rows.map((r) => r.join("\n") + "\n").join("");
  const tallFull = tallPlan(tallRows);
  // Keep every row, drop body lines from the end until the file is at most `frac` of its size.
  const bytesTo = (frac) => { const rows = tallRows.map((r) => [...r]); let t = tallPlan(rows); for (let i = rows.length - 1; i >= 0 && t.length > tallFull.length * frac; i--) { while (rows[i].length > 1 && t.length > tallFull.length * frac) { rows[i].pop(); t = tallPlan(rows); } } return t; };
  // Keep the first `keep` rows and pad with prose back to the full size.
  const rowsTo = (keep) => { const t = tallPlan(tallRows.slice(0, keep)) + "\nNotes. "; return t + "p".repeat(Math.max(0, tallFull.length - t.length)); };
  const shapes = [
    // Each shape must be refused for ITS reason, so every guard is load-bearing on its own.
    ["a directory", /not a regular file/, (f) => { mkdirSync(f); writeFileSync(join(f, "x.md"), planText); }],
    ["a symlink to /dev/null", /not a regular file/, (f) => symlinkSync("/dev/null", f)],
    ["a symlink to the sibling ledger", /not a regular file/, (f) => symlinkSync("BUILD_BACKLOG.md", f)],
    ["UTF-16 with a BOM", /NUL byte/, (f) => writeFileSync(f, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(planText, "utf16le")]))],
    ["UTF-16LE with no BOM", /NUL byte/, (f) => writeFileSync(f, Buffer.from(planText, "utf16le"))],
    ["a Git LFS pointer", /LFS pointer/, (f) => writeFileSync(f, "version https://git-lfs.github.com/spec/v1\noid sha256:00\nsize 1\n")],
    ["an empty file", /no rows/, (f) => writeFileSync(f, "")],
    ["a file truncated before its first row", /no rows/, (f) => writeFileSync(f, "## Global backlog\n\n")],
    ["cp1252 (a curly quote as byte 0x93)", /not valid UTF-8/, (f) => writeFileSync(f, Buffer.concat([Buffer.from(planText), Buffer.from([0x93, 0x44, 0x4f, 0x4e, 0x45, 0x94, 0x0a])]))],
    ["two rows joined by a lone CR", /lone CR/, (f) => writeFileSync(f, planText + "\r2. **Row 2.** — DONE.\n")],
    ["a file holding merge-conflict markers", /merge-conflict/, (f) => writeFileSync(f, "<<<<<<< HEAD\n" + planText + "=======\n" + planText + ">>>>>>> other\n")],
    ["a renamed section heading plus a stray checkbox", /no rows in its own grammar/, (f) => writeFileSync(f, planText.replace("Global backlog", "Global Backlog") + "- [ ] item\n")],
    ["a file cut mid-file with rows left", /high-water mark/, (f) => { writeFileSync(f, bigPlan); return (g) => writeFileSync(g, bigPlan.slice(0, 400)); }],
    ["a cut followed by a small edit to the same ledger", /high-water mark/, (f) => { writeFileSync(f, bigPlan); return [(g) => writeFileSync(g, bigPlan.slice(0, 400)), (g) => writeFileSync(g, bigPlan.slice(0, 400) + "\n")]; }],
    ["a cut followed by a sync-merge that also edits the ledger", /high-water mark/, (f) => {
      writeFileSync(f, bigPlan);
      return [
        (g, gs) => { gs("checkout", "-qb", "side"); writeFileSync(g, bigPlan.replace("Some body text for row 1.", "Edited body text for row 1.")); gs("commit", "-qam", "side edit"); gs("checkout", "-q", "main"); writeFileSync(g, bigPlan.slice(0, 600)); },
        (g, gs) => gs("merge", "-q", "--no-edit", "side"),
      ];
    }],
    ["a cut padded back out with prose (bytes kept, rows lost)", /rows against a high-water mark/, (f) => {
      writeFileSync(f, bigPlan);
      return (g) => writeFileSync(g, bigPlan.slice(0, 400) + "\nNotes. " + "padding prose ".repeat(Math.ceil(bigPlan.length / 14)));
    }],
    ["a cut followed by 48 further edits (still inside the 50-change window)", /high-water mark/, (f) => {
      writeFileSync(f, bigPlan);
      return [(g) => writeFileSync(g, bigPlan.slice(0, 400)), ...Array.from({ length: 48 }, () => (g) => writeFileSync(g, readFileSync(g, "utf8") + "\n"))];
    }],
    ["a history copy whose object is missing (offline partial clone)", /could not be read/, (f) => {
      writeFileSync(f, bigPlan);
      return (g, gs) => {
        const old = gs("rev-parse", `HEAD:${plan}`).trim();
        rmSync(join(dirname(dirname(g)), ".git", "objects", old.slice(0, 2), old.slice(2)));
        writeFileSync(g, bigPlan + "\n");
      };
    }],
    ["a cut that keeps every row heading but drops the bodies", /bytes against a high-water mark/, (f) => {
      writeFileSync(f, tallFull);
      return (g) => writeFileSync(g, tallPlan(tallRows.map((r) => [r[0]])));
    }],
    ["a 30% byte cut with every row kept (pins the byte threshold)", /bytes against a high-water mark/, (f) => { writeFileSync(f, tallFull); return (g) => writeFileSync(g, bytesTo(0.7)); }],
    ["a 30% row cut padded back to full size (pins the row threshold)", /rows against a high-water mark/, (f) => { writeFileSync(f, tallFull); return (g) => writeFileSync(g, rowsTo(28)); }],
    ["a history that cannot be walked (a commit object missing mid-history)", /history could not be walked/, (f) => {
      writeFileSync(f, bigPlan);
      return [
        (g) => writeFileSync(g, bigPlan + "\n"),
        (g, gs) => {
          const mid = gs("rev-parse", "HEAD~1").trim();
          rmSync(join(dirname(dirname(g)), ".git", "objects", mid.slice(0, 2), mid.slice(2)));
          writeFileSync(g, bigPlan + "\n\n");
        },
      ];
    }],
    ["three cuts in a row, each under a quarter", /high-water mark/, (f) => {
      writeFileSync(f, bigPlan);
      const keep = (g) => { const t = readFileSync(g, "utf8"); writeFileSync(g, t.slice(0, Math.floor(t.length * 0.8))); };
      return [keep, keep, keep];
    }],
  ];
  for (const [name, why, shape] of shapes) {
    let st = "";
    try { st = shapeOf(shape); } catch (e) { st = `threw: ${String(e.message).split("\n")[0]}`; }
    checks.push([`a plan ledger committed as ${name} is NOT MEASURED (${why.source})`, st.startsWith("NO-LEDGER: ") && why.test(st)]);
  }
  // A deliberate small deletion (one row of forty) is still measured, not refused.
  {
    let st = "";
    try { st = shapeOf((f) => { writeFileSync(f, bigPlan); return (g) => writeFileSync(g, bigPlan.replace("40. **Row 40.** — OPEN, qa. Some body text for row 40.\n", "")); }); } catch (e) { st = `threw: ${String(e.message).split("\n")[0]}`; }
    checks.push(["a deliberate one-row deletion is still measured (the shrink check is not a hair trigger)", !st.startsWith("NO-LEDGER")]);
  }
  // A ledger deleted in one commit and restored in full in the next is measured: deletion is a real state, not an unreadable copy.
  {
    let st = "";
    try { st = shapeOf((f) => { writeFileSync(f, bigPlan); return [(g) => rmSync(g), (g) => writeFileSync(g, bigPlan)]; }); } catch (e) { st = `threw: ${String(e.message).split("\n")[0]}`; }
    checks.push(["a ledger deleted then restored in full is measured, not refused as unreadable", !st.startsWith("NO-LEDGER") && !st.startsWith("threw")]);
  }
  // A `git replace --graft` that hides the high-water copy is ignored: history is read as committed.
  {
    let st = "";
    try { st = shapeOf((f) => { writeFileSync(f, bigPlan); return [(g) => writeFileSync(g, bigPlan.slice(0, 400)), (g, gs) => gs("replace", "--graft", "HEAD")]; }); } catch (e) { st = `threw: ${String(e.message).split("\n")[0]}`; }
    checks.push(["a graft replace ref cannot hide the high-water copy", /^NO-LEDGER: .*high-water mark/.test(st)]);
  }
  // A legacy .git/info/grafts file cannot hide the high-water copy either.
  {
    let st = "";
    try { st = shapeOf((f) => { writeFileSync(f, bigPlan); return [(g) => writeFileSync(g, bigPlan.slice(0, 400)), (g, gs) => writeFileSync(join(dirname(dirname(g)), ".git", "info", "grafts"), gs("rev-parse", "HEAD").trim() + "\n")]; }); } catch (e) { st = `threw: ${String(e.message).split("\n")[0]}`; }
    checks.push(["a legacy .git/info/grafts file cannot hide the high-water copy", /^NO-LEDGER: .*high-water mark/.test(st)]);
  }
  // A blob-level replace on either read site (a history copy, or HEAD's copy) cannot change what is measured.
  {
    let st = "";
    try {
      st = shapeOf((f) => {
        writeFileSync(f, bigPlan);
        return [(g, gs) => {
          const full = gs("rev-parse", `HEAD:${plan}`).trim();
          writeFileSync(g, bigPlan.slice(0, 400));
          gs("add", "-A"); gs("commit", "-qm", "cut");
          gs("replace", full, gs("rev-parse", `HEAD:${plan}`).trim());
        }];
      });
    } catch (e) { st = `threw: ${String(e.message).split("\n")[0]}`; }
    checks.push(["a replace ref swapping a history copy for the cut one cannot hide the high-water copy", /^NO-LEDGER: .*high-water mark/.test(st)]);
    try {
      st = shapeOf((f) => {
        writeFileSync(f, bigPlan);
        return [(g, gs) => {
          const full = gs("rev-parse", `HEAD:${plan}`).trim();
          writeFileSync(g, bigPlan.slice(0, 400));
          gs("add", "-A"); gs("commit", "-qm", "cut");
          gs("replace", gs("rev-parse", `HEAD:${plan}`).trim(), full);
        }];
      });
    } catch (e) { st = `threw: ${String(e.message).split("\n")[0]}`; }
    checks.push(["a replace ref swapping HEAD's cut copy for the full one cannot hide the cut", /^NO-LEDGER: .*high-water mark/.test(st)]);
  }
  // A real PR landing nested under sync merges: 8 deep is traced to the PR; 9 deep is NOT MEASURED, never "not via a PR".
  for (const [depth, expect] of [[8, "STALE"], [9, "NO-HISTORY"]]) {
    const d = mkdtempSync(join(tmpdir(), "row-drift-depth-"));
    const gs = (...args) => execFileSync("git", args, { cwd: d, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    try {
      gs("init", "-q", "-b", "main"); mkdirSync(join(d, "docs")); mkdirSync(join(d, "scripts"));
      writeFileSync(join(d, plan), "## Global backlog\n\n1. **Row 1.** — OPEN, qa.\n");
      writeFileSync(join(d, backlog), "- [ ] **Open** — open.\n"); writeFileSync(join(d, "scripts/a.mjs"), "0\n");
      gs("add", "-A"); gs("commit", "-qm", "base");
      gs("checkout", "-qb", "claude/deep");
      writeFileSync(join(d, plan), "## Global backlog\n\n1. **Row 1.** — OPEN, qa. FIX PROPOSED 2026-10-01 (branch claude/deep, x): `scripts/a.mjs`.\n");
      writeFileSync(join(d, "scripts/a.mjs"), "1\n"); gs("commit", "-qam", "fix");
      gs("checkout", "-q", "main"); gs("checkout", "-qb", "r0");
      gs("merge", "-q", "--no-ff", "-m", "Merge pull request #5 from o/claude/deep", "claude/deep");
      let prev = "r0";
      for (let i = 1; i < depth; i++) {
        gs("checkout", "-q", "main"); gs("checkout", "-qb", `r${i}`);
        writeFileSync(join(d, `scripts/r${i}.mjs`), `${i}\n`); gs("add", "-A"); gs("commit", "-qm", `r${i}`);
        gs("merge", "-q", "--no-ff", "-m", `Merge branch '${prev}' into r${i}`, prev); prev = `r${i}`;
      }
      gs("checkout", "-q", "main"); gs("merge", "-q", "--no-ff", "-m", `Merge branch '${prev}'`, prev);
      const r = measure(d).find((x) => x.row === "row 1");
      checks.push([`a PR landing nested under ${depth} merges reads ${expect}`, r?.status === expect && (expect === "STALE" ? r.pr === 5 : /nested under more than 8 non-PR merges/.test(r.why ?? ""))]);
    } catch (e) {
      checks.push([`depth-${depth} fixture ran (${String(e.message).split("\n")[0]})`, false]);
    } finally { rmSync(d, { recursive: true, force: true }); }
  }
  // An inherited GIT_DIR naming a clean repository cannot make a cut repository read clean.
  {
    const cut = mkdtempSync(join(tmpdir(), "row-drift-cut-")), clean = mkdtempSync(join(tmpdir(), "row-drift-clean-"));
    const gIn = (d, ...args) => execFileSync("git", args, { cwd: d, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    try {
      for (const d of [cut, clean]) { gIn(d, "init", "-q", "-b", "main"); mkdirSync(join(d, "docs")); writeFileSync(join(d, backlog), "- [ ] **Open** — open.\n"); }
      writeFileSync(join(cut, plan), bigPlan); gIn(cut, "add", "-A"); gIn(cut, "commit", "-qm", "full");
      writeFileSync(join(cut, plan), bigPlan.slice(0, 400)); gIn(cut, "add", "-A"); gIn(cut, "commit", "-qm", "cut");
      writeFileSync(join(clean, plan), bigPlan); gIn(clean, "add", "-A"); gIn(clean, "commit", "-qm", "full");
      const ambient = {
        ...process.env, GIT_DIR: join(clean, ".git"), GIT_WORK_TREE: clean, GIT_INDEX_FILE: join(clean, ".git", "index"),
        GIT_COMMON_DIR: join(clean, ".git"), GIT_OBJECT_DIRECTORY: join(clean, ".git", "objects"), GIT_ALTERNATE_OBJECT_DIRECTORIES: join(clean, ".git", "objects"),
      };
      out = execFileSync(process.execPath, [fileURLToPath(import.meta.url)], { cwd: cut, env: ambient, encoding: "utf8" });
    } catch (e) { out = `threw: ${String(e.message).split("\n")[0]}`; }
    finally { rmSync(cut, { recursive: true, force: true }); rmSync(clean, { recursive: true, force: true }); }
    checks.push(["inherited repository pointers naming another repository do not redirect the measurement", /COMPANY_BUILD_PLAN\.md — is \d+ bytes against a high-water mark/.test(out) && !/NOTE /.test(out)]);
  }
  // Every pointer is dropped and the history switches are set, whatever the ambient environment holds.
  {
    const ambient = Object.fromEntries(REPO_POINTERS.map((k) => [k, "/nowhere"]));
    const e = gitEnvFrom({ ...ambient, GIT_GRAFT_FILE: "/some/grafts", GIT_NO_REPLACE_OBJECTS: "" });
    const expected = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES"];
    checks.push(["all six repository pointers are dropped and replace refs and grafts are switched off",
      expected.every((k) => REPO_POINTERS.includes(k) && !(k in e)) && e.GIT_NO_REPLACE_OBJECTS === "1" && e.GIT_GRAFT_FILE === "/dev/null"]);
  }
  // Repository config that reshapes git's output cannot hide a landing: each overridden key, one repository each.
  for (const [key, value] of [["color.ui", "always"], ["color.diff", "always"], ["i18n.logOutputEncoding", "UTF-7"], ["log.showSignature", "true"]]) {
    const d = mkdtempSync(join(tmpdir(), "row-drift-config-"));
    const gs = (...args) => execFileSync("git", args, { cwd: d, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    try {
      gs("init", "-q", "-b", "main"); mkdirSync(join(d, "docs")); mkdirSync(join(d, "scripts"));
      writeFileSync(join(d, plan), "## Global backlog\n\n1. **Row 1.** — OPEN, qa.\n");
      writeFileSync(join(d, backlog), "- [ ] **Open** — open.\n"); writeFileSync(join(d, "scripts/a.mjs"), "0\n");
      gs("add", "-A"); gs("commit", "-qm", "base");
      gs("checkout", "-qb", "claude/cfg");
      writeFileSync(join(d, plan), "## Global backlog\n\n1. **Row 1.** — OPEN, qa. FIX PROPOSED 2026-10-01 (branch claude/cfg, x): `scripts/a.mjs`.\n");
      writeFileSync(join(d, "scripts/a.mjs"), "1\n"); gs("commit", "-qam", "fix");
      gs("checkout", "-q", "main"); gs("merge", "-q", "--no-ff", "-m", "Merge pull request #5: cfg", "claude/cfg");
      gs("config", key, value);
      const r = measure(d).find((x) => x.row === "row 1");
      checks.push([`repository config ${key}=${value} does not hide a PR landing`, r?.status === "STALE" && r.pr === 5]);
    } catch (e) {
      checks.push([`config ${key} fixture ran (${String(e.message).split("\n")[0]})`, false]);
    } finally { rmSync(d, { recursive: true, force: true }); }
  }
  // Two ways a landing cannot be traced, each NOT MEASURED with its own reason.
  {
    const d = mkdtempSync(join(tmpdir(), "row-drift-landing-"));
    const gs = (...args) => execFileSync("git", args, { cwd: d, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    try {
      gs("init", "-q", "-b", "main"); mkdirSync(join(d, "docs")); mkdirSync(join(d, "scripts"));
      writeFileSync(join(d, plan), "## Global backlog\n\n1. **Row 1.** — OPEN, qa.\n2. **Row 2.** — OPEN, qa.\n");
      writeFileSync(join(d, backlog), "- [ ] **Open** — open.\n"); writeFileSync(join(d, "scripts/a.mjs"), "0\n");
      gs("add", "-A"); gs("commit", "-qm", "base");
      // Row 1: the annotation is written by the merge commit itself (an evil merge), so no commit in the line history adds it.
      gs("checkout", "-qb", "side"); writeFileSync(join(d, "scripts/a.mjs"), "1\n"); gs("commit", "-qam", "side");
      gs("checkout", "-q", "main"); gs("merge", "-q", "--no-ff", "--no-commit", "side");
      writeFileSync(join(d, plan), readFileSync(join(d, plan), "utf8").replace("1. **Row 1.** — OPEN, qa.", "1. **Row 1.** — OPEN, qa. FIX PROPOSED 2026-10-01 (branch claude/evil, x): `scripts/a.mjs`."));
      gs("add", "-A"); gs("commit", "-qm", "Merge pull request #5: side");
      // Row 2: landed by an octopus merge, through its third parent.
      gs("checkout", "-qb", "b1"); writeFileSync(join(d, "scripts/b1.mjs"), "b\n"); gs("add", "-A"); gs("commit", "-qm", "b1");
      gs("checkout", "-q", "main"); gs("checkout", "-qb", "claude/oct");
      writeFileSync(join(d, plan), readFileSync(join(d, plan), "utf8").replace("2. **Row 2.** — OPEN, qa.", "2. **Row 2.** — OPEN, qa. FIX PROPOSED 2026-10-01 (branch claude/oct, x): `scripts/a.mjs`."));
      writeFileSync(join(d, "scripts/a.mjs"), "2\n"); gs("commit", "-qam", "oct");
      gs("checkout", "-q", "main"); gs("merge", "-q", "--no-ff", "-m", "Merge branches b1 and claude/oct", "b1", "claude/oct");
      const r = Object.fromEntries(measure(d).map((x) => [x.row, x]));
      checks.push(["an annotation written only by a merge commit's own edit is NOT MEASURED (no adding commit)", r["row 1"]?.status === "NO-HISTORY" && /no commit in this row's line history/.test(r["row 1"]?.why ?? "")]);
      checks.push(["an annotation landed through an octopus merge's third parent is NOT MEASURED (no traceable landing)", r["row 2"]?.status === "NO-HISTORY" && /octopus/.test(r["row 2"]?.why ?? "")]);
    } catch (e) {
      checks.push([`landing fixtures ran (${String(e.message).split("\n")[0]})`, false]);
    } finally { rmSync(d, { recursive: true, force: true }); }
  }
  // The backlog's row mark (checkboxes, its own grammar): 40 boxes cut to 28 and padded back with prose.
  {
    const d = mkdtempSync(join(tmpdir(), "row-drift-backlog-"));
    const gs = (...args) => execFileSync("git", args, { cwd: d, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    try {
      gs("init", "-q", "-b", "main"); mkdirSync(join(d, "docs"));
      const boxes = (n) => Array.from({ length: n }, (_, i) => `- [ ] **Box ${i + 1}** — open, with some body words.\n`).join("");
      const full = boxes(40);
      writeFileSync(join(d, plan), planText); writeFileSync(join(d, backlog), full);
      gs("add", "-A"); gs("commit", "-qm", "base");
      const cut = boxes(28) + "\nNotes. ";
      writeFileSync(join(d, backlog), cut + "p".repeat(Math.max(0, full.length - cut.length)));
      gs("add", "-A"); gs("commit", "-qm", "cut");
      const r = measure(d).find((x) => x.file === backlog);
      checks.push(["a backlog cut to 28 of 40 boxes and padded back is NOT MEASURED (the backlog's own row mark)", r?.status === "NO-LEDGER" && /rows against a high-water mark/.test(r?.why ?? "")]);
    } catch (e) {
      checks.push([`backlog row-mark fixture ran (${String(e.message).split("\n")[0]})`, false]);
    } finally { rmSync(d, { recursive: true, force: true }); }
  }
  // The exact boundary: refused below 75% of a mark, measured at 75% or more (a strict "<").
  // Sizes in BYTES, as the detector measures them (the em-dashes are multi-byte).
  const exactBytes = (n) => { const t = tallPlan(tallRows.map((r) => [r[0]])) + "\nNotes. "; return t + "p".repeat(n - Buffer.byteLength(t)); };
  // A base whose size is a multiple of 4 bytes, so 75% of it is a whole byte and "<" differs from "<=".
  const exactBase = tallFull + "x".repeat((4 - (Buffer.byteLength(tallFull) % 4)) % 4);
  const floorBytes = Buffer.byteLength(exactBase) * 0.75;
  for (const [name, expectRefused, body] of [
    ["exactly 75% of the byte mark (every row kept) is measured", false, () => exactBytes(floorBytes)],
    ["one byte under 75% of the byte mark is refused", true, () => exactBytes(floorBytes - 1)],
    ["exactly 30 of 40 rows (75% of the row mark) is measured", false, () => rowsTo(30)],
    ["29 of 40 rows is refused", true, () => rowsTo(29)],
  ]) {
    let st = "";
    try { st = shapeOf((f) => { writeFileSync(f, exactBase); return (g) => writeFileSync(g, body()); }); } catch (e) { st = `threw: ${String(e.message).split("\n")[0]}`; }
    checks.push([name, expectRefused ? /^NO-LEDGER: .*high-water mark/.test(st) : !st.startsWith("NO-LEDGER") && !st.startsWith("threw")]);
  }
  // Under a quarter is NOT refused (companions to the 30% cuts above).
  for (const [name, shape] of [
    ["a 22% byte cut with every row kept is still measured (byte floor not tighter than 75%)", (f) => { writeFileSync(f, tallFull); return (g) => writeFileSync(g, bytesTo(0.78)); }],
    ["a 20% row cut padded back to full size is still measured (row floor not tighter than 75%)", (f) => { writeFileSync(f, tallFull); return (g) => writeFileSync(g, rowsTo(32)); }],
  ]) {
    let st = "";
    try { st = shapeOf(shape); } catch (e) { st = `threw: ${String(e.message).split("\n")[0]}`; }
    checks.push([name, !st.startsWith("NO-LEDGER") && !st.startsWith("threw")]);
  }
  // The window is exactly 50 changes: a cut followed by 49 further edits has aged out and is measured.
  {
    let st = "";
    try { st = shapeOf((f) => { writeFileSync(f, bigPlan); return [(g) => writeFileSync(g, bigPlan.slice(0, 400)), ...Array.from({ length: 49 }, () => (g) => writeFileSync(g, readFileSync(g, "utf8") + "\n"))]; }); } catch (e) { st = `threw: ${String(e.message).split("\n")[0]}`; }
    checks.push(["a cut followed by 49 further edits has aged out of the 50-change window and is measured (pins the window)", !st.startsWith("NO-LEDGER") && !st.startsWith("threw")]);
  }
  // A ledger git is told to ignore (assume-unchanged) and then edited still gets the NOTE.
  {
    const d = mkdtempSync(join(tmpdir(), "row-drift-au-"));
    const gs = (...args) => execFileSync("git", args, { cwd: d, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    try {
      gs("init", "-q", "-b", "main"); mkdirSync(join(d, "docs"));
      writeFileSync(join(d, plan), planText); writeFileSync(join(d, backlog), "- [ ] **Open** — open.\n");
      gs("add", "-A"); gs("commit", "-qm", "base");
      gs("update-index", "--assume-unchanged", plan); writeFileSync(join(d, plan), planText + "junk\n");
      gs("update-index", "--skip-worktree", backlog);
      checks.push(["an assume-unchanged or skip-worktree ledger is named in a NOTE", JSON.stringify(uncommittedLedgers(d)) === JSON.stringify([plan, backlog])]);
    } catch (e) {
      checks.push([`assume-unchanged fixture ran (${String(e.message).split("\n")[0]})`, false]);
    } finally { rmSync(d, { recursive: true, force: true }); }
  }
  // CRLF endings and a stray U+2028 inside a box line: rows and closure still read right.
  {
    const d = mkdtempSync(join(tmpdir(), "row-drift-crlf-"));
    const gs = (...args) => execFileSync("git", args, { cwd: d, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    try {
      gs("init", "-q", "-b", "main");
      mkdirSync(join(d, "docs"), { recursive: true }); mkdirSync(join(d, "scripts"));
      writeFileSync(join(d, plan), "## Global backlog\r\n\r\n1. **Row 1.** — DONE (PR #4).\r\n2. **Row 2.** — OPEN, qa.\r\n");
      writeFileSync(join(d, backlog), "- [x] **Done** — closed.\r\n- [ ] **Open** — open,\u2028 still.\r\n");
      writeFileSync(join(d, "scripts/a.mjs"), "0\n");
      gs("add", "-A"); gs("commit", "-qm", "base");
      gs("checkout", "-qb", "claude/fix-o");
      const a = " FIX PROPOSED 2026-10-01 (branch claude/fix-o, lands under DR-037): `scripts/a.mjs`.";
      writeFileSync(join(d, plan), readFileSync(join(d, plan), "utf8").replace("DONE (PR #4).", "DONE (PR #4)." + a).replace("OPEN, qa.", "OPEN, qa." + a));
      writeFileSync(join(d, backlog), readFileSync(join(d, backlog), "utf8").replace("still.", "still." + a).replace("— closed.", "— closed." + a));
      writeFileSync(join(d, "scripts/a.mjs"), "1\n");
      gs("add", "-A"); gs("commit", "-qm", "fix o");
      gs("checkout", "-q", "main"); gs("merge", "-q", "--no-ff", "-m", "Merge pull request #5: fix o", "claude/fix-o");
      const r = Object.fromEntries(measure(d).map((x) => [`${x.file}|${x.row}`, x.status]));
      checks.push(["CRLF ledgers: a closed plan row and a ticked box stay residue", r[`${plan}|row 1`] === "CLOSED-RESIDUE" && r[`${backlog}|"Done"`] === "CLOSED-RESIDUE"]);
      checks.push(["CRLF ledgers: an open plan row and a box line holding U+2028 flag STALE", r[`${plan}|row 2`] === "STALE" && Object.entries(r).some(([k, v]) => k.startsWith(`${backlog}|"Open`) && v === "STALE")]);
    } catch (e) {
      checks.push([`CRLF fixture ran (${String(e.message).split("\n")[0]})`, false]);
    } finally { rmSync(d, { recursive: true, force: true }); }
  }
  let failed = 0;
  for (const [name, ok] of checks) { console.log(`  ${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failed++; }
  console.log(`row-status-drift self-test: ${checks.length - failed}/${checks.length} passed`);
  return failed === 0 && checks.length === 83;
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
    report(measure(cwd, LEDGERS, process.argv.includes("--rest") ? { rest: restBranch(cwd) } : {}), uncommittedLedgers(cwd));
  } catch (e) {
    console.log(`REPORTED: NOT MEASURED — ${String(e.message).split("\n")[0]} (plan row 170).`);
  }
  process.exit(0);
} else if (process.argv[1] && basename(process.argv[1]) === basename(fileURLToPath(import.meta.url)) && process.argv.length > 2) {
  // Run as this file by name, with arguments, yet the entry guard said "imported": that is the
  // guard failing, and a silent exit 0 (the round-1 defect) would read as a pass. Refuse loudly.
  console.error("row-status-drift: entry guard did not recognise this run as the CLI; refusing to exit 0 silently");
  process.exit(2);
}
