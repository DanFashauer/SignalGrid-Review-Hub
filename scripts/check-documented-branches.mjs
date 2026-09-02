#!/usr/bin/env node
// Documented-branch check — a doc may not state a pruned branch as existing.
//
//   node scripts/check-documented-branches.mjs
//   node scripts/check-documented-branches.mjs --list       the pruned set and the scope
//   node scripts/check-documented-branches.mjs --self-test  prove the gate can fail
//
// WHY THIS EXISTS
// ---------------
// Two documents stated the four tier branches as live, in the present tense, for
// as long as both were current:
//
//   docs/REPO_LAYOUT.md      "CI … run across the `dev` / `alpha` / `beta` /
//                             `prod` tier branches", plus a four-row table.
//   docs/BRANCHING_AND_ENVIRONMENTS.md
//                            "the four tier branches are all pinned to the
//                             `Merge PR #65` commit and have not moved since."
//
// Both were false. `docs/BRANCH_HYGIENE.md` had already recorded the opposite —
// all four are in the prune list, with the reason: "as stale pointers they implied
// a promotion flow this repo does not run." Verified 2026-09-02 with
// `git ls-remote --heads origin`: sixteen refs, and not one of them is a tier.
//
// A reader following REPO_LAYOUT would `git checkout dev` and get nothing. That is
// the cheapest possible class of documentation defect to catch mechanically, and
// nothing caught it, because no gate compared a branch name in prose to a branch
// name in the repository.
//
// WHY THE PRUNE LIST AND NOT `git ls-remote`
// ------------------------------------------
// A network call inside a per-push gate is the wrong trade, three ways: CI would
// need credentials for a gate that reads documentation; a proxy hiccup would fail
// a build for a reason unrelated to the change; and the answer would depend on
// when you ran it. `artifacts/sync/merged-branches-to-prune.txt` is a TRACKED,
// dated capture of `<tip-sha> <branch>` that `docs/BRANCH_HYGIENE.md` describes
// as "the historical recovery record" — it is in the tree, it is offline, and it
// is the same source the prose is supposed to agree with.
//
// SAY WHAT THAT COSTS, because it is a real limit: this gate proves a document
// does not contradict THE PRUNE RECORD. It does not prove the document agrees
// with origin right now. A branch pruned and later re-pushed would read here as
// still gone. The command that settles it live is printed on every run, and
// `docs/BRANCH_HYGIENE.md` already carries the recompute recipe.
//
// GATED vs REPORTED
// -----------------
// GATED: a line that states a pruned branch AS EXISTING — present-tense verbs
// against a branch name, or a markdown table cell naming one. Unambiguous.
// REPORTED: every other mention of a pruned branch. Documents are allowed, and
// required, to talk about history; `docs/BRANCH_HYGIENE.md` is nothing but that.
//
// THE HONEST IDIOMS, which this gate must never punish:
//   * naming the branch as pruned/deleted/retired/removed/superseded/history;
//   * naming it as DESIGNED or INTENDED rather than present;
//   * the recovery command that restores it (`git push origin <sha>:refs/heads/…`);
//   * the prune record and the hygiene page themselves.
// Each is a document being MORE accurate, not less. A gate that reddened the
// build over them would be answered by deleting a true sentence, which is the
// failure this repository has already had three times.

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PRUNE_LIST = "artifacts/sync/merged-branches-to-prune.txt";
const HYGIENE = "docs/BRANCH_HYGIENE.md";

// Only branches whose NAME is a plain word can be recognised in prose without
// drowning the gate in false positives — `claude/topic-xyz` never appears in a
// sentence as a bare word, and a topic branch being gone is not a claim anyone
// reads as product truth. The tier branches are the population that matters and
// the population that actually broke.
const TIER_NAMES = new Set(["dev", "alpha", "beta", "prod"]);

/** The pruned set, DERIVED from the tracked capture rather than typed here. */
function prunedTierBranches() {
  const path = resolve(repo, PRUNE_LIST);
  if (!existsSync(path)) return null;
  const names = readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"))
    .map((l) => l.trim().split(/\s+/)[1])
    .filter(Boolean);
  return names.filter((n) => TIER_NAMES.has(n));
}

// ── THE NARROWING THAT MAKES THIS GATE HONEST ───────────────────────────────
//
// The first version matched a backticked tier name plus an existence verb, and
// measured 32 hits on the real tree — of which the great majority were TRUE
// SENTENCES ABOUT TIERS, not claims about branches:
//
//   docs/DEPLOYMENT.md:112   "it makes live Graph calls only on `beta`/`prod` and …"
//   docs/PARTNER_ONBOARDING.md:64  "`SIGNALGRID_TIER` in `beta` or `prod`"
//   docs/CREDENTIAL_EXPOSURE_SIGNAL.md:34  "tier is `beta`/`prod` AND …"
//
// Every one of those is correct: **the tiers are real and the branches are not.**
// `config/tiers/{dev,alpha,beta,prod}.env.example` exist, the api-server resolves
// `SIGNALGRID_TIER` and `isLiveIntegrationsEnabled()` keys off it. A tier is a
// deployment profile; a branch is a ref. Flagging the first would have taught the
// next author to weaken an accurate security statement to satisfy a gate — the
// precise failure this repository has now had three times.
//
// So a violation needs the line to be ABOUT A BRANCH, established two ways and no
// others: the word "branch"/"branches" on the line, or a markdown table row inside
// a table whose header row has a **Branch** column. Everything else is out of
// scope and REPORTED as such.
// `makes?` joined the list with the two-line window below: "the `dev`/`alpha`/`beta`/
// `prod` branches make the promotion pipeline explicit" is a present-tense assertion
// about the branches in exactly the way "runs"/"targets"/"lands" already were, and
// without it the wrapped-claim case could not fail. Adding it changed nothing on the
// real tree (0 violations before and after); it is the window, not the verb, that is
// new. `gives`/`provides`/`enforces` were tried in the same pass and dropped — no
// sentence in the tree needed them, and an unused widening is future false positives.
const EXIST_VERBS =
  /\b(is|are|runs?|lands?|targets?|points?|tracks?|holds?|sits?|lives?|exists?|deploys?|promotes?|merges?|protected|pinned|makes?)\b/i;
const ABSENCE_OK =
  /prune|pruned|delete|deleted|remov|retire|gone|superseded|no longer|does not exist|never existed|historical|history|designed|intended|aspiration|not current|would|if we|recover|restore|archive|refs\/heads/i;
const BRANCH_WORD = /\bbranch(es)?\b/i;

// THE HEADER MAY NAME THE BRANCH COLUMN ANYWHERE, not only first (F1, 2026-09-02).
// The first version was `/^\s*\|[^|]*\bbranch\b/i` — `[^|]*` cannot cross a pipe, so
// it recognised a Branch column ONLY in position one. `docs/BRANCHING_AND_ENVIRONMENTS.md`
// heads its table `| Tier | Branch (designed) | Purpose | Live integrations |`, so
// every row beneath it was invisible to the table rule and the page was held up
// entirely by the per-row "— *pruned*" markers: delete those four words and the gate
// reported ONE violation (the dev row, which happens to contain the word "branch" in
// its Purpose cell) instead of four. A gate whose scope depends on which column an
// author put first is a fossil waiting to happen.
//
// A header is now any table row containing `branch` in ANY cell — but only when the
// NEXT line is a markdown separator row. That second half is what keeps an ordinary
// prose line beginning with a pipe, or a body row that merely says "branch", from
// promoting itself to a header and pulling the rest of the table into scope.
const BRANCH_TABLE_HEADER = /^\s*\|[^\n]*\bbranch\b/i;
const TABLE_SEPARATOR_ROW = /^\s*\|[\s:|-]*-{3,}[\s:|-]*\|?\s*$/;

// ── A PAGE THAT DECLARES ITSELF SUPERSEDED KEEPS ITS PLAN INTACT ─────────────
//
// `docs/PHASE6_CUTOVER_RUNBOOK.md` opens with "⛔ SUPERSEDED 2026-08-19 — do not
// execute" and closes that banner with "Nothing below is current guidance". It
// then describes, in the present tense and across six lines, the branch topology
// a cutover WOULD have created — in a DIFFERENT repository. Flagging those would
// have demanded that a superseded plan be rewritten to describe a world it was
// never about, which destroys the record for no gain. This repository keeps
// "original entry" text beside its corrections on purpose.
//
// The bar is the same one the launch-claims gate sets for a page-scope
// disclaimer: it must disclaim CURRENT status in so many words, and it must be at
// the TOP. A confession in a footer buys nothing — that is the pitch deck's
// distant-hedge defect, and it is refused here for the same reason.
//
// KNOWN LIMIT, recorded rather than papered over: this gate cannot tell THIS
// repository's branches from another repository's. The PHASE6 runbook is about
// `DanFashauer/SignalGrid`, and it is exempt here because of its banner, not
// because the gate understood that. A page describing a foreign repo's branches
// without a banner would be a false positive; banner it, or say "in <repo>," on
// the line, which is what an accurate sentence does anyway.
const SUPERSEDED_PAGE =
  /superseded[^\n]{0,60}(do not execute|do not follow)|SUPERSEDED HISTORY|nothing below is current guidance|archived run log|⛔ SUPERSEDED/i;
const topOf = (body) => body.split("\n").slice(0, 40).join("\n");

const nameRe = (name) => new RegExp("(`" + name + "`|\\*\\*" + name + "\\*\\*)", "i");

/**
 * Does `text` state one of `pruned` as existing? Returns the branch name or null.
 * `inTable` says the text is a row of a table whose header names a Branch column,
 * which is what lets a bare cell count without an existence verb.
 */
function claimedBranchIn(text, pruned, inTable) {
  if (ABSENCE_OK.test(text)) return null;
  if (!BRANCH_WORD.test(text) && !inTable) return null;
  for (const name of pruned) {
    if (!nameRe(name).test(text)) continue;
    const isTableCell =
      inTable && new RegExp("\\|\\s*`?\\**" + name + "\\**`?\\s*(—[^|]*)?\\|", "i").test(text);
    if (!isTableCell && !EXIST_VERBS.test(text)) continue;
    return name;
  }
  return null;
}

export function violationsIn(file, body, pruned) {
  if (SUPERSEDED_PAGE.test(topOf(body))) return [];
  const lines = body.split("\n");
  const hits = new Map(); // line index → [name, quoted text], one report per line

  // Pass 1 — a single line. Which table (if any) each row belongs to, so a Branch
  // column can be recognised from its header rather than guessed from cell position.
  let inBranchTable = false;
  lines.forEach((line, i) => {
    const isRow = /^\s*\|/.test(line);
    if (!isRow) inBranchTable = false;
    else if (BRANCH_TABLE_HEADER.test(line) && TABLE_SEPARATOR_ROW.test(lines[i + 1] ?? "")) {
      inBranchTable = true;
    }
    const name = claimedBranchIn(line, pruned, inBranchTable && isRow);
    if (name) hits.set(i, [name, line.trim()]);
  });

  // Pass 2 — A CLAIM WRAPPED OVER TWO LINES (F5, 2026-09-02). Markdown prose wraps at
  // the author's margin, not at the sentence, so
  //
  //     The `dev`/`alpha`/`beta`/`prod`
  //     branches make the promotion pipeline explicit.
  //
  // put the branch names on one line and the word "branch" on the next, and neither
  // line alone satisfied the rule. A line-at-a-time gate is defeated by pressing
  // Enter. The window is TWO lines and no more — it is a wrap, not a paragraph, and
  // joining further would start manufacturing sentences no author wrote.
  //
  // Table rows are excluded: they are handled by the header rule above, and joining
  // two rows would read a name out of one row against a verb out of another.
  // ABSENCE_OK is applied to the JOINED text, so an honest marker on either half
  // still exempts the claim.
  //
  // THE WINDOW IS THE WRAP, NOT THE PARAGRAPH, and that narrowing was measured, not
  // assumed. Joining any two adjacent prose lines and applying the ordinary rule
  // produced two hits on the real tree, and BOTH were honest writing:
  //
  //   docs/BRANCHING_AND_ENVIRONMENTS.md:42  "…it is deliberately not made in code:
  //                                           **feed `dev`** from" + "`SignalGrid_Alpha`
  //                                           (…needs the tier branches fast-forwarded)"
  //   docs/OWNER_ACTIONS.md:75               "…worth then deleting them…" + "Switch the
  //                                           default to **`dev`** and fast-forward the
  //                                           tier branches, which"
  //
  // Both are the owner being offered OPTIONS, and in both the existence verb belongs
  // to a different subject than the branch name — the join manufactured a claim
  // nobody wrote. Flagging them is precisely the "gate that punishes honest writing"
  // failure this repository has had three times, and the fix is not to delete those
  // true sentences.
  //
  // So the window fires only on the shape a WRAP actually makes: the noun phrase
  // "<names> branches" split across the break — one line ENDING in a branch name and
  // the next BEGINNING with "branch(es)", or the mirror image. Then the ordinary rule
  // is applied to the joined text. Everything else stays a single-line judgement.
  const namesTail = new RegExp(
    "(`(" + pruned.join("|") + ")`|\\*\\*(" + pruned.join("|") + ")\\*\\*)[\\s,;:/)*]*$",
    "i",
  );
  const namesHead = new RegExp(
    "^[\\s(*]*(`(" + pruned.join("|") + ")`|\\*\\*(" + pruned.join("|") + ")\\*\\*)",
    "i",
  );
  const branchHead = /^[\s(*]*branch(es)?\b/i;
  const branchTail = /\bbranch(es)?[\s,;:*]*$/i;

  const consumed = new Set(); // the second half of a window already reported
  lines.forEach((line, i) => {
    const next = lines[i + 1];
    if (next === undefined) return;
    if (hits.has(i) || hits.has(i + 1) || consumed.has(i)) return;
    const a = line.trim();
    const b = next.trim();
    // A wrapped line inside a blockquote or a bullet keeps its marker; strip it
    // before asking what the line BEGINS with, or `> branches make …` reads as
    // beginning with ">".
    const bHead = b.replace(/^[>\s]*(?:[-*+]\s+|\d+[.)]\s+)?/, "");
    if (!a || !b) return;
    if (/^\|/.test(a) || /^\|/.test(b)) return;
    const wrapped =
      (namesTail.test(a) && branchHead.test(bHead)) || (branchTail.test(a) && namesHead.test(bHead));
    if (!wrapped) return;
    const joined = `${a} ${b}`;
    const name = claimedBranchIn(joined, pruned, false);
    if (name) {
      hits.set(i, [name, joined]);
      consumed.add(i + 1);
    }
  });

  return [...hits.keys()]
    .sort((a, b) => a - b)
    .map((i) => {
      const [name, text] = hits.get(i);
      return (
        `${file}:${i + 1}: states branch \`${name}\` as existing — it is in ${PRUNE_LIST} ` +
        `(see ${HYGIENE}). Say it as history, as DESIGNED, or name it as pruned. ` +
        `Line: "${text.slice(0, 96)}"`
      );
    });
}

const pruned = prunedTierBranches();

if (process.argv.includes("--list")) {
  console.log(`\nPruned tier branches, derived from ${PRUNE_LIST}:\n`);
  for (const n of pruned ?? []) console.log(`  ${n}`);
  console.log(`\nScope: every git-tracked docs/**/*.md except ${HYGIENE} and the prune record.`);
  console.log("\nThis gate is offline by design. The live answer is:\n  git ls-remote --heads origin\n");
  process.exit(0);
}

if (process.argv.includes("--self-test")) {
  const set = ["dev", "alpha", "beta", "prod"];
  const checks = [
    ["a flat existence claim fails", violationsIn("st.md", "CI runs across the `dev` / `alpha` / `beta` / `prod` tier branches.", set).length > 0],
    // The shape REPO_LAYOUT actually used: a table whose HEADER names a Branch
    // column, so the rows beneath it are branch claims even without the word.
    ["a row under a Branch-column header fails", violationsIn("st.md",
      "| Branch | Tier | Purpose |\n|---|---|---|\n| `dev` | dev | Active development |\n", set).length > 0],
    // F1: the Branch column is not always first. This is the VERBATIM header of
    // docs/BRANCHING_AND_ENVIRONMENTS.md, whose rows the first regex could not see.
    ["a row under a Tier-first header with a Branch column fails", violationsIn("st.md",
      "| Tier | Branch (designed) | Purpose | Live integrations |\n" +
      "| ---- | ----------------- | ------- | ----------------- |\n" +
      "| **alpha** | `alpha` | Internal validation. | Never |\n" +
      "| **prod** | `prod` | Stable production. | Gated |\n", set).length === 2],
    // …and the separator row is required, so a body row that merely says "branch"
    // cannot promote itself into a header and drag the rest of the table in.
    ["a mid-table row saying 'branch' does not become a header", violationsIn("st.md",
      "| Tier | Purpose |\n|---|---|\n| ops | the branch protection setting |\n| `prod` | Stable |\n", set).length === 0],
    ["the same row under a non-branch header is not flagged", violationsIn("st.md",
      "| Tier | Purpose |\n|---|---|\n| `dev` | Active development |\n", set).length === 0],
    // F5: a wrap puts the names on one line and the noun on the next. Neither line
    // alone is a violation; the sentence is.
    ["a claim wrapped over two lines fails", violationsIn("st.md",
      "The `dev`/`alpha`/`beta`/`prod`\nbranches make the promotion pipeline explicit.\n", set).length > 0],
    ["a wrapped claim is attributed to the first line", violationsIn("st.md",
      "intro\nThe `dev`/`alpha`/`beta`/`prod`\nbranches make the promotion pipeline explicit.\n", set)[0]
        ?.startsWith("st.md:2:") === true],
    ["a wrapped claim with the honest marker on the SECOND line is legal", violationsIn("st.md",
      "The `dev`/`alpha`/`beta`/`prod`\nbranches were pruned; see BRANCH_HYGIENE.md.\n", set).length === 0],
    ["two unrelated wrapped lines are not joined into a claim", violationsIn("st.md",
      "Set `SIGNALGRID_TIER` to `beta` in the deploy.\nSee docs/DEPLOYMENT.md for the rollout order.\n", set).length === 0],
    ["a shipped sentence naming a tier branch as pinned fails", violationsIn("st.md", "The `dev` branch is pinned to the Merge PR #65 commit.", set).length > 0],
    // THE NARROWING, tested in the direction that matters: a true sentence about
    // the TIER (which exists) must never be flagged as a claim about the BRANCH
    // (which does not). Three real lines, verbatim from the tree.
    ["a tier-config sentence is not flagged", violationsIn("st.md", "it makes live Graph calls only on `beta`/`prod` and with real credentials", set).length === 0],
    ["a SIGNALGRID_TIER cell is not flagged", violationsIn("st.md", "| Deployment tier | `SIGNALGRID_TIER` in `beta` or `prod` | yes |", set).length === 0],
    ["an env-var default row is not flagged", violationsIn("st.md", "| `SIGNALGRID_TIER` | `dev` \\| `alpha` \\| `beta` \\| `prod`. | `dev` |", set).length === 0],
    ["naming it as pruned is legal", violationsIn("st.md", "The `dev` branch was pruned; see BRANCH_HYGIENE.md.", set).length === 0],
    ["naming it as DESIGNED is legal", violationsIn("st.md", "| **dev** | `dev` — designed, not present | Active development | off |", set).length === 0],
    ["the recovery command is legal", violationsIn("st.md", "git push origin 7ee88ef:refs/heads/dev", set).length === 0],
    ["a bare mention with no existence verb is not flagged", violationsIn("st.md", "Tier names: dev, alpha, beta, prod.", set).length === 0],
    ["a superseded-plan page keeps its topology", violationsIn("st.md",
      "# Old cutover\n\n> ⛔ SUPERSEDED — do not execute\n>\n> Nothing below is current guidance.\n\nThe `dev` branch is the default.\n", set).length === 0],
    ["a bottom-of-page confession buys nothing", violationsIn("st.md",
      `The \`dev\` branch is the default.\n${"filler\n".repeat(60)}\n> ⛔ SUPERSEDED — do not execute\n`, set).length > 0],
    ["the prune list parsed to the four tiers", Array.isArray(pruned) && pruned.length === 4],
  ];
  let ok = true;
  for (const [what, pass] of checks) {
    console.log(`  ${pass ? "✓" : "✗"} ${what}`);
    if (!pass) ok = false;
  }
  console.log(ok ? "PASS  self-test — the documented-branch gate can fail" : "FAIL  self-test");
  process.exit(ok ? 0 : 1);
}

// ── floors ──────────────────────────────────────────────────────────────────
if (pruned === null) {
  console.error(
    `✗ ${PRUNE_LIST} is unreadable — that file IS this gate's source of truth, and guessing\n` +
      "  which branches exist would defeat the check. Restore it or delete this gate deliberately.",
  );
  process.exit(1);
}
if (pruned.length !== TIER_NAMES.size) {
  console.error(
    `✗ derived ${pruned.length} pruned tier branch(es) from ${PRUNE_LIST}, expected ${TIER_NAMES.size}.\n` +
      "  Either a tier was recreated — in which case update this gate deliberately and say so in\n" +
      `  ${HYGIENE} — or the record's format changed. Do not silently check less.`,
  );
  process.exit(1);
}

const docs = execSync("git ls-files docs", { encoding: "utf8" })
  .trim().split("\n")
  .filter((f) => f.endsWith(".md"))
  .filter((f) => f !== HYGIENE);
if (docs.length < 100) {
  console.error(`✗ found only ${docs.length} docs/**/*.md file(s) — the derivation is broken, not the tree empty.`);
  process.exit(1);
}

let problems = [];
let mentioning = 0;
for (const f of docs) {
  let body;
  try { body = readFileSync(resolve(repo, f), "utf8"); } catch { continue; }
  if (!/`(dev|alpha|beta|prod)`/i.test(body)) continue;
  mentioning += 1;
  problems = problems.concat(violationsIn(f, body, pruned));
}

console.log(
  `documented branches: ${docs.length} doc(s) scanned, ${mentioning} naming a tier branch, ` +
    `${pruned.length} pruned branch(es) derived from ${PRUNE_LIST}, ${problems.length} violation(s); ` +
    "floors and self-test green",
);
console.log(
  `  OFFLINE BY DESIGN — this proves no document contradicts the tracked prune record, NOT that it\n` +
    "  agrees with origin right now. The live answer is `git ls-remote --heads origin`; on 2026-09-02\n" +
    "  it returned 16 refs and no dev/alpha/beta/prod.",
);

if (problems.length) {
  console.error(`\n✗ ${problems.length} line(s) state a pruned branch as existing:\n`);
  for (const p of problems.slice(0, 25)) console.error(`    ${p}`);
  if (problems.length > 25) console.error(`    … and ${problems.length - 25} more`);
  console.error(
    `\nFix the SENTENCE, not this gate. ${HYGIENE} records why all four were pruned, and the\n` +
      "prune list records each tip so any of them is recoverable in one command.\n",
  );
  process.exit(1);
}
console.log("Documented-branch check passed — no document states a pruned branch as live.");
