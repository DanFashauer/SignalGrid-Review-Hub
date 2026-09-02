#!/usr/bin/env node
// Index↔banner parity — if a document says it is dead, the index may not describe it alive.
//
//   node scripts/check-index-banner-parity.mjs              # gate
//   node scripts/check-index-banner-parity.mjs --self-test  # prove the gate can fail
//
// WHY. Index entries described, in the present tense, documents whose own first lines
// said SUPERSEDED / ARCHIVED / RETIRED. `docs/research/OUTREACH_EMAIL_TEMPLATES.md`
// opens with "**SUPERSEDED 2026-08-23 — do not send from this file.**" while the index
// said it "provides short editable drafts for strategic partners"; the reader who trusts
// the index sends the mail. The banner is the honest half and it was already written —
// what was missing was anything that made the index repeat it. Measured, not remembered:
// this gate run against `git show HEAD:docs/INDEX.md` (the index as it stood before the
// fix batch) reports the count on stdout; see the FIXTURE note at the bottom of this
// header for the number and how to reproduce it.
//
// SCOPE IS DERIVED, NEVER HAND-LISTED. The set of bannered documents is not a list in
// this file: it is every markdown link in docs/INDEX.md that resolves to a TRACKED
// docs/**/*.md (git ls-files, so an untracked scratch file cannot join the scan), whose
// first 30 lines carry a banner. Add a banner to a document tomorrow and this gate finds
// it with no edit here.
//
// WHY 30 LINES. It was 15. The two lowest live banners sit at lines 11 and 12
// (docs/AUTOMATION_PHASE_TEMPLATE.md, docs/research/PUBLIC_API_SOURCES.md), which left
// three lines of margin before a front-matter block or a longer title pushed a real
// banner out of the window. Measured on 2026-09-02: no live banner sits below line 15,
// and widening 15 → 30 changed the bannered set by nothing. The margin is the point.
//
// WHAT COUNTS AS A BANNER, and why the shape is restricted. Only two line shapes are
// read as a document's own status:
//   · the H1, when the keyword sits in the title ("# … — SUPERSEDED HISTORY");
//   · a `>` blockquote line that OPENS with the keyword ("> ## ⛔ ARCHIVED 2026-08-15"),
//     or that carries the imperative forms "do not execute/send/follow" or
//     "no longer exists".
// Anything else in the first 30 lines is prose ABOUT something, not a status banner, and
// this repository is full of true sentences that would otherwise be punished (each
// verified in the tree on 2026-09-02, with the line the words actually sit on):
//   · docs/REPO_LAYOUT.md:5 — "are retired POC / concept and are superseded by this one"
//     (a live document describing OTHER documents);
//   · docs/LAUNCH_PROFILE.md — "The *Shared-Device Trust Gateway* label is superseded";
//   · docs/ECOSYSTEM_POSITIONING.md — a note that a label DR-019 superseded was removed;
//   · docs/connectors/MICROSOFT_GRAPH_SIGNAL_MODEL.md:16 — "Managed, unmanaged, inactive,
//     retired, or unknown state" inside a TABLE CELL, which is content, not status.
// Every one of those is accurate writing. A gate that flags them is the wrong gate.
// (An earlier version of this list cited docs/REPO_LAYOUT.md:12, a line that says no such
// thing; docs/MICROSOFT_GRAPH_SIGNAL_MODEL.md, a path that does not exist — the file is
// under docs/connectors/; and docs/BRANCH_HYGIENE.md:128, whose word is "supersedes" in
// prose, which BANNER never matches, so it was never an example of anything. Citations in
// a gate header are load-bearing: the next reader edits the regex on the strength of them.)
//
// A FENCED BANNER IS NOT A BANNER. A ``` or ~~~ block holds an EXAMPLE, and a gate that
// reads examples as status will one day flag a live document for showing what a banner
// looks like. Two carve-outs, both measured rather than assumed:
//   · An UNCLOSED fence is not a fence. A stray ``` would otherwise turn the whole rest
//     of a file into "code" and silently delete its banner.
//   · A `>` BLOCKQUOTE line inside a fence is still a banner. Blockquote syntax is not
//     code, and this is not hypothetical: docs/AUTOMATION_PHASE_TEMPLATE.md carried its
//     real "**ARCHIVED PROCESS NOTE (2026-08-15).**" at line 11, inside the ```text block
//     opened at line 5 and CLOSED at line 36 — the file's last line. (A review of this
//     gate described that fence as unclosed; it is not, and the difference decides whether
//     that document keeps a banner at all.) The note is left where its author put
//     it — it addresses whoever pastes the prompt — and the carve-out is what keeps that
//     document inside this gate's scope.
//
// WHERE THE ECHO MUST APPEAR, and why not "anywhere on the line". The check used to run
// ECHO against the WHOLE index line — link href, link text and all — which passed three
// shapes that tell the reader nothing:
//   · "[Runbook — superseded label era](retired/RUNBOOK.md): the current runbook to
//     execute" — the family word is in the LINK TEXT and the PATH, never in the claim;
//   · "…: the current runbook to execute. It replaces the retired label." — a trailing
//     clause about some other noun;
//   · "…: the current runbook to execute. Historical context in DR-004." — a pointer to
//     where the history lives, while the entry still says "current".
// The echo must therefore sit in the entry's own DESCRIPTION — the text after the link's
// closing paren — and inside its FIRST SENTENCE, which is the part a scanning reader
// reads. A fixed ~120-character window was considered and rejected on measurement:
// docs/INDEX.md's entry for BRANCHING_AND_ENVIRONMENTS.md carries its echo at offset 171
// ("…so the table reads as historical intent…"), and that entry is TRUE. Punishing it
// would be the exact failure this repository keeps repeating.
//
// AN INLINE MENTION IS JUDGED BY WHAT PRECEDES IT. Not every link is an entry: line 218
// names the archived PHASE_BACKLOG inside another entry's prose ("it writes into the
// archived [PHASE_BACKLOG](PHASE_BACKLOG.md)"). Demanding a description of a link that
// has none would flag honest writing, so for any link that is NOT the first resolved link
// on its line, the scope is the 80 characters immediately before it — where the honest
// idiom puts the word.
//
// PRIOR-VERSION BANNERS ARE SKIPPED, AND SAID SO. A document that supersedes ITS OWN
// earlier version is live, not dead: docs/research/PUBLIC_API_SOURCES.md opens with
// "**Prior disposition, superseded.**", which is detected, dropped, and PRINTED as
// skipped — an exclusion nobody can see is an exclusion nobody can audit. Demanding the
// index call that page "superseded" would make the index lie.
//
// THE SKIP IS ANCHORED, because a skip is a hole. It used to fire on seven phrases found
// ANYWHERE on the banner line, which meant a genuinely dead runbook could walk out of the
// gate by adding a courtesy sentence: "> ## ⛔ SUPERSEDED — do not execute. The previous
// version is here for reference." The skip now requires the banner's OPENING clause to be
// the prior-version claim (/^(prior|previous|earlier) (version|disposition|draft)/), and
// REFUSES to skip any line that also carries an imperative ("do not execute/send/follow",
// "no longer exists"). A document that tells you not to use it is dead however it opens.
// docs/EXECUTIVE_ONE_PAGER.md carries a prior-version sentence ("The previous version …
// is superseded in every section") on a bold `**Status:**` paragraph rather than an H1 or
// a blockquote, so it is never a candidate here in the first place; verified 2026-09-02,
// and named so the next reader does not go looking for it in the skip list.
//
// GATED vs REPORTED:
//   · GATED   — a bannered target whose index entry does not repeat the banner's family
//               (superseded | archived | retired | deprecated | historical | record of)
//               in the place defined above. Which word, and how the entry is phrased, is
//               the author's business.
//   · REPORTED — the count of bannered targets, every matched pair, and every
//               prior-version skip. Printed on every run, never silent.
//
// FLOORS, because a gate scanning nothing is green about nothing: at least 200 resolved
// links and at least 5 bannered targets. If the link parse or the banner reader drifts,
// this fails loudly instead of passing quietly on an empty set.
//
// FIXTURE — the "before" number, measured on 2026-09-02, not remembered. Symlink every
// docs/ entry except INDEX.md into a scratch root, write `git show HEAD:docs/INDEX.md`
// there, and call auditIndex({ root: scratch, docs: trackedDocs(repo) }). It prints
// "resolved: 322 bannered: 11 skips: 1 PROBLEMS: 6" — SIX entries, not seven:
// AUTOPILOT_BACKLOG_CURATOR, AUTOMATION_PHASE_TEMPLATE, BRANCHING_AND_ENVIRONMENTS,
// research/OUTREACH_EMAIL_TEMPLATES, research/FIRST_CALL_TALK_TRACK, DELIVERY_GAP_ANALYSIS.
// This header and the CI job name both said "Seven" before anyone ran the count.

import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve, posix } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fencedLineFlags, maskNonProse } from "./lib/markdown-scope.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const BANNER =
  /SUPERSEDED|ARCHIVED|RETIRED|DEPRECATED|do not (execute|send|follow)|no longer exists/i;

/** The family the index line must echo. Six spellings, so honest phrasing is not forced. */
export const ECHO = /superseded|archived|retired|deprecated|historical|record of/i;

/**
 * A banner whose OPENING CLAUSE is about a PRIOR VERSION OF THE SAME DOCUMENT — the
 * document itself is live. Anchored to the start of the stripped body on purpose: the
 * old form matched these phrases anywhere on the line, so a dead runbook that added
 * "The previous version is here for reference" after its ⛔ walked out of the gate.
 */
export const PRIOR_VERSION = /^(\*+\s*)?(prior|previous|earlier)\s+(version|disposition|draft)\b/i;

/** Imperatives. A document that tells you not to use it is dead however its line opens. */
export const IMPERATIVE = /do not (execute|send|follow)|no longer exists/i;

/** How far into a document a banner may sit. See "WHY 30 LINES" in the header. */
export const HEAD_LINES = 30;

/** Characters of preceding line text an INLINE (non-entry) link is judged by. */
const INLINE_CONTEXT = 80;

/**
 * Pure: the first sentence of an index entry's description.
 *
 * A sentence ends at . ! or ? followed by whitespace and something that starts a new
 * sentence — a capital, a bold/italic mark, a backtick or a link. "2026-08-15." mid-line
 * is followed by a lowercase word and does not end anything, which is why the lookahead
 * is there rather than a bare /[.!?]\s/.
 */
export function firstSentence(desc) {
  const m = /[.!?]["'\u2019)*`\]]*\s+(?=[A-Z*`\[_\u2014])/.exec(desc);
  return m ? desc.slice(0, m.index + 1) : desc;
}

/**
 * Pure: every inline markdown link in `text`, with the 1-based line it sits on, the text
 * BEFORE it on that line and the DESCRIPTION after its closing paren.
 *
 * Fenced blocks, HTML comments and inline code spans are masked first (see
 * scripts/lib/markdown-scope.mjs) so a link shown as an example is not read as an entry.
 * Masking preserves every offset, so `line`, `before` and `after` still describe the REAL
 * file — a gate that reported a shifted line number would be worse than one silent.
 */
export function parseLinks(rawText) {
  const text = maskNonProse(rawText);
  const out = [];
  const rx = /\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
  const lines = rawText.split("\n");
  const starts = [];
  let at = 0;
  for (const l of lines) {
    starts.push(at);
    at += l.length + 1;
  }
  for (const m of text.matchAll(rx)) {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= m.index) lo = mid;
      else hi = mid - 1;
    }
    const col = m.index - starts[lo];
    out.push({
      text: m[1],
      href: m[2],
      line: lo + 1,
      lineText: lines[lo],
      before: lines[lo].slice(0, col),
      after: lines[lo].slice(col + m[0].length),
    });
  }
  return out;
}

/**
 * Pure: the banner verdict for one document, given ALL of its lines.
 *
 * Takes the whole file, not a slice, for two reasons: only the whole file can say whether
 * a fence ever closes, and the head window is this gate's business rather than the
 * caller's. See the header for the fence carve-outs.
 *
 * @returns {{banner: string, line: number, priorVersion: boolean} | null}
 */
export function readBanner(lines, headLines = HEAD_LINES) {
  // An unclosed fence is not a fence (a stray ``` must not delete a document's banner).
  const fenced = fencedLineFlags(lines, { treatUnclosedAsFence: false });
  for (let i = 0; i < Math.min(lines.length, headLines); i += 1) {
    const raw = lines[i];
    const isH1 = /^#\s+\S/.test(raw);
    const isQuote = /^\s*>/.test(raw);
    if (!isH1 && !isQuote) continue;
    // A fenced line is an EXAMPLE, not a status — except a blockquote, which is not code.
    if (fenced[i] && !isQuote) continue;
    if (!BANNER.test(raw)) continue;
    // Strip the quote marker, any heading marks, leading symbols and bold marks. Done for
    // BOTH shapes because the prior-version test below is anchored to the body's start.
    const body = raw
      .replace(/^\s*>+\s*/, "")
      .replace(/^#{1,6}\s*/, "")
      .replace(/^[^\p{L}\p{N}]+/u, "")
      .replace(/^\*+\s*/, "");
    const imperative = IMPERATIVE.test(raw);
    // PRIOR-VERSION FIRST, before the shape filter — otherwise the skip is dead code.
    // "> **Prior disposition, superseded.**" does not OPEN with a status keyword, so the
    // filter below would drop it silently and the exclusion could never be reported.
    // But an imperative overrides: "do not execute" is this document speaking about
    // itself, whatever its first three words say.
    if (PRIOR_VERSION.test(body) && !imperative) {
      return { banner: raw.trim(), line: i + 1, priorVersion: true };
    }
    if (isQuote) {
      // Require the STATUS KEYWORD to open the line — or an imperative form anywhere.
      const opens = /^(SUPERSEDED|ARCHIVED|RETIRED|DEPRECATED)\b/i.test(body);
      if (!opens && !imperative) continue;
    }
    return { banner: raw.trim(), line: i + 1, priorVersion: false };
  }
  return null;
}

/** Tracked markdown under docs/ — derived from git, never a hand-kept list. */
export function trackedDocs(root = ROOT) {
  const out = execSync("git ls-files -- 'docs/*.md' 'docs/**/*.md'", {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return new Set(out.trim().split("\n").filter(Boolean));
}

/**
 * The audit. Pure with respect to its inputs so the self-test can run it against a
 * synthetic tree: `docs` is the tracked set, `root` the tree to read from.
 */
export function auditIndex({ root = ROOT, indexRel = "docs/INDEX.md", docs = null, headLines = HEAD_LINES } = {}) {
  const tracked = docs ?? trackedDocs(root);
  const text = readFileSync(join(root, indexRel), "utf8");
  const indexDir = posix.dirname(indexRel.split("\\").join("/"));

  const resolved = [];
  for (const link of parseLinks(text)) {
    const href = link.href.split("#")[0].trim();
    if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
    const rel = posix.normalize(posix.join(indexDir, href));
    if (!rel.startsWith("docs/") || !rel.endsWith(".md")) continue;
    if (!tracked.has(rel)) continue;
    resolved.push({ ...link, rel });
  }
  // The ENTRY link is the first RESOLVED link on its line; anything after it is an inline
  // mention inside that entry's prose and is judged by what precedes it, not by a
  // description it does not have.
  const firstOnLine = new Map();
  for (const l of resolved) if (!firstOnLine.has(l.line)) firstOnLine.set(l.line, l);
  for (const l of resolved) l.isEntry = firstOnLine.get(l.line) === l;

  const verdicts = new Map();
  for (const l of resolved) {
    if (verdicts.has(l.rel)) continue;
    const file = join(root, l.rel);
    if (!existsSync(file)) continue;
    verdicts.set(l.rel, readBanner(readFileSync(file, "utf8").split("\n"), headLines));
  }

  const pairs = [];
  const skips = [];
  const problems = [];
  const bannered = new Set();
  for (const l of resolved) {
    const v = verdicts.get(l.rel);
    if (!v) continue;
    if (v.priorVersion) {
      skips.push({ ...l, banner: v.banner });
      continue;
    }
    bannered.add(l.rel);
    // WHERE the echo must sit — never "anywhere on the line". See the header.
    const scope = l.isEntry ? firstSentence(l.after) : l.before.slice(-INLINE_CONTEXT);
    if (ECHO.test(scope)) pairs.push({ ...l, banner: v.banner, scope });
    else
      problems.push(
        `${indexRel}:${l.line} describes ${l.rel} without repeating its banner.\n` +
          `      the document opens with: ${v.banner.slice(0, 120)}\n` +
          `      the ${l.isEntry ? "entry's first sentence" : "text before the mention"}: ${scope.trim().slice(0, 120)}\n` +
          `      Fix the INDEX line, never the banner: say superseded / archived / retired /\n` +
          `      deprecated / historical / "record of" IN THAT SPAN, and stop describing it\n` +
          `      in the present tense. A keyword in the link text, in the path, or in a\n` +
          `      trailing clause is not something a scanning reader reads.`,
      );
  }
  return { resolved, pairs, skips, problems, bannered: [...bannered].sort(), targets: verdicts.size };
}

// ── Self-test — the gate must be able to fail, and must not fire on true sentences ────
// Every case below was a real defect or a real true sentence. A gate this file cannot
// prove fails is a gate nobody should trust.
function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), "index-banner-"));
  const w = (rel, body) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  };
  const docs = new Set([
    "docs/DEAD.md",
    "docs/TABLE.md",
    "docs/REBORN.md",
    "docs/retired/RUNBOOK.md",
    "docs/PREVCOURTESY.md",
    "docs/EARLIERKEPT.md",
    "docs/PRIORIMP.md",
  ]);
  w("docs/DEAD.md", "# Dead runbook\n\n> ## ⛔ SUPERSEDED 2026-08-19 — do not execute\n>\n> Kept for provenance.\n");
  w("docs/TABLE.md", "# Live table\n\nRows:\n\n| branch | state |\n|---|---|\n| dev | retired |\n");
  w("docs/REBORN.md", "# Sources\n\n> **Prior disposition, superseded.** The earlier version rated this\n> differently; this page is the live one.\n");
  w("docs/retired/RUNBOOK.md", "# Runbook\n\n> ## ⛔ SUPERSEDED 2026-08-19 — do not execute\n");
  // F2 fixtures: a dead document that adds a courtesy sentence about its own predecessor.
  w("docs/PREVCOURTESY.md", "# Cutover\n\n> ## ⛔ SUPERSEDED 2026-08-19 — do not execute. The previous version is here for reference.\n");
  w("docs/EARLIERKEPT.md", "# Curator\n\n> **ARCHIVED 2026-08-15.** The earlier version of this page is kept below.\n");
  w("docs/PRIORIMP.md", "# Templates\n\n> **Prior version, superseded.** Do not send from this file.\n");
  const run = (indexBody) => {
    w("docs/INDEX.md", indexBody);
    return auditIndex({ root: dir, docs });
  };
  const fails = [];
  const expect = (id, cond, msg) => {
    if (!cond) fails.push(`${id}: ${msg}`);
  };

  // 1. A planted un-echoed banner must FAIL.
  const planted = run(
    "- [Dead runbook](DEAD.md): the cutover runbook to execute on the night of the migration.\n" +
      "- [Live table](TABLE.md): the branch table.\n" +
      "- [Sources](REBORN.md): the public API source list.\n",
  );
  expect(
    "planted",
    planted.problems.length === 1 && planted.problems[0].includes("docs/DEAD.md"),
    `expected exactly 1 problem naming docs/DEAD.md, got ${planted.problems.length}`,
  );
  // 2. Echoing it must PASS — the fix is to tell the truth in the index, not to delete the banner.
  const echoed = run(
    "- [Dead runbook](DEAD.md): **SUPERSEDED 2026-08-19** — kept as a record of the cutover, do not execute.\n" +
      "- [Live table](TABLE.md): the branch table.\n" +
      "- [Sources](REBORN.md): the public API source list.\n",
  );
  expect("echoed", echoed.problems.length === 0, `expected 0 problems, got ${echoed.problems.length}`);
  expect("echoed", echoed.pairs.length === 1, `expected 1 matched pair, got ${echoed.pairs.length}`);
  // 3. A table-cell "retired" is CONTENT, not a banner — it must not fire.
  expect("table", !echoed.bannered.includes("docs/TABLE.md"), "table-content 'retired' fired as a banner");
  // 4. A prior-version banner is skipped, and reported.
  expect(
    "prior-skip",
    echoed.skips.length === 1 && echoed.skips[0].rel === "docs/REBORN.md",
    `expected docs/REBORN.md skipped, got ${JSON.stringify(echoed.skips.map((s) => s.rel))}`,
  );
  expect("prior-skip", !echoed.bannered.includes("docs/REBORN.md"), "prior-version banner was gated instead of skipped");

  // ── F1: the echo is the ENTRY'S CLAIM, not any word on the line ──────────────────
  // All three of these passed the old whole-line test. None of them tells a reader the
  // document is dead.
  const inLinkText = run("- [Runbook — superseded label era](retired/RUNBOOK.md): the current runbook to execute on the night of the migration.\n");
  expect("echo-linktext", inLinkText.problems.length === 1, `keyword in link text + path must FAIL, got ${inLinkText.problems.length} problems`);
  const trailingClause = run(
    "- [Runbook](retired/RUNBOOK.md): the current runbook to execute on the night of the migration. It replaces the retired label DR-004 introduced.\n",
  );
  expect("echo-trailing", trailingClause.problems.length === 1, `"the retired label" clause must FAIL, got ${trailingClause.problems.length} problems`);
  const pointer = run("- [Runbook](retired/RUNBOOK.md): the current runbook to execute on the night of the migration. Historical context in DR-004.\n");
  expect("echo-pointer", pointer.problems.length === 1, `"Historical context in DR-004" must FAIL, got ${pointer.problems.length} problems`);
  const opensWith = run("- [Runbook](retired/RUNBOOK.md): **SUPERSEDED 2026-08-23 — do not execute.** Kept for provenance only.\n");
  expect("echo-opens", opensWith.problems.length === 0, `a description opening with the banner must PASS, got ${opensWith.problems.length} problems`);
  // A late-but-first-sentence echo is honest writing and must pass (docs/INDEX.md:236
  // carries its "historical" at offset 171, which is why there is no 120-char window).
  const lateInSentence = run(
    "- [Runbook](retired/RUNBOOK.md): the four-tier promotion model it describes — **the tier branches no longer exist (pruned 2026-09-02)**, so the table reads as historical intent, not as current state.\n",
  );
  expect("echo-late", lateInSentence.problems.length === 0, `an echo late in the FIRST sentence must PASS, got ${lateInSentence.problems.length} problems`);
  // An inline mention inside another entry's prose is judged by what precedes it.
  const inlineEchoed = run("- [Live table](TABLE.md): the branch table; step 2 writes into the superseded [Runbook](retired/RUNBOOK.md).\n");
  expect("echo-inline", inlineEchoed.problems.length === 0, `an inline mention with the word before it must PASS, got ${inlineEchoed.problems.length} problems`);
  const inlineBare = run("- [Live table](TABLE.md): the branch table; step 2 writes into [Runbook](retired/RUNBOOK.md).\n");
  expect("echo-inline-bare", inlineBare.problems.length === 1, `a bare inline mention must FAIL, got ${inlineBare.problems.length} problems`);

  // ── F2: the prior-version skip is a HOLE unless it is anchored ───────────────────
  const courtesy = run(
    "- [Cutover](PREVCOURTESY.md): the cutover runbook to execute on the night of the migration.\n" +
      "- [Curator](EARLIERKEPT.md): the curator that checks backlog integrity.\n" +
      "- [Templates](PRIORIMP.md): short editable drafts for strategic partners.\n",
  );
  expect("skip-anchor", courtesy.problems.length === 3, `three dead docs with prior-version sentences must all FAIL, got ${courtesy.problems.length}`);
  expect("skip-anchor", courtesy.skips.length === 0, `none of them may be skipped, got ${courtesy.skips.length} skips`);

  // ── F6: fences and the 30-line window ────────────────────────────────────────────
  const fenceExample = readBanner(
    "# Style guide\n\nA dead page opens like this:\n\n```markdown\n# Runbook — SUPERSEDED HISTORY\n```\n\nThat is the shape.\n".split("\n"),
  );
  expect("fence-example", fenceExample === null, "an H1 banner shown as an EXAMPLE inside a closed fence must not be a banner");
  const fenceQuote = readBanner("# Template\n\n```text\nPaste this:\n\n> **ARCHIVED 2026-08-15.** This template is a record.\n```\n".split("\n"));
  expect("fence-quote", fenceQuote !== null, "a BLOCKQUOTE banner inside a fence is still a banner (the AUTOMATION_PHASE_TEMPLATE idiom)");
  // The H1 shape, deliberately: a blockquote is exempt from the fence rule either way,
  // so only a title can show that an UNCLOSED fence is not allowed to swallow a banner.
  const fenceUnclosed = readBanner(
    "[back to the index](INDEX.md)\n\n```text\na prompt whose fence was never closed\n\n# Runbook — SUPERSEDED HISTORY\n\nKept for provenance.\n".split("\n"),
  );
  expect("fence-unclosed", fenceUnclosed !== null, "an UNCLOSED fence is not a fence — a stray ``` must not delete a banner");
  const lateLines = ["# Long preamble", ""].concat(new Array(19).fill("Some front matter line."), ["> ## ⛔ RETIRED 2026-08-30 — do not execute"]);
  expect("window-30", readBanner(lateLines) !== null, `a banner on line ${lateLines.length} must be found in a 30-line window`);
  expect("window-30", readBanner(lateLines, 15) === null, "the 15-line window this replaced could not see it — that is why 30");

  // ── F5: fences, comments and code spans are not entries ──────────────────────────
  const parsed = parseLinks(
    "- [Real](A.md): live.\n\n```\n- [Fenced](FENCED_LINK.md): example.\n```\n\n<!-- - [Commented](HIDDEN.md): draft. -->\n- an inline `[Coded](CODED.md)` mention.\n",
  );
  const hrefs = parsed.map((l) => l.href);
  expect("mask", hrefs.length === 1 && hrefs[0] === "A.md", `only the prose link is an entry, got ${JSON.stringify(hrefs)}`);
  expect("mask", parsed[0] && parsed[0].line === 1, `masking must preserve line numbers, got ${parsed[0] && parsed[0].line}`);

  rmSync(dir, { recursive: true, force: true });
  const bad = (id) => (fails.some((f) => f.startsWith(`${id}:`)) ? "✗" : "✓");
  console.log("Index↔banner parity self-test\n");
  console.log("   1. planted un-echoed banner                    → gate FAILS   " + bad("planted"));
  console.log("   2. banner echoed in the index                  → gate PASSES  " + bad("echoed"));
  console.log("   3. 'retired' in a table cell                   → does not fire " + bad("table"));
  console.log("   4. prior-version banner                        → skipped + reported " + bad("prior-skip"));
  console.log("   5. keyword only in link text / path            → gate FAILS   " + bad("echo-linktext"));
  console.log("   6. '… It replaces the retired label.'          → gate FAILS   " + bad("echo-trailing"));
  console.log("   7. '… Historical context in DR-004.'           → gate FAILS   " + bad("echo-pointer"));
  console.log("   8. description OPENS '**SUPERSEDED …**'        → gate PASSES  " + bad("echo-opens"));
  console.log("   9. echo late in the first sentence (offset 171) → gate PASSES  " + bad("echo-late"));
  console.log("  10. inline mention, word before it              → gate PASSES  " + bad("echo-inline"));
  console.log("  11. inline mention, bare                        → gate FAILS   " + bad("echo-inline-bare"));
  console.log("  12. dead doc + 'the previous version is here'   → gate FAILS, not skipped " + bad("skip-anchor"));
  console.log("  13. example banner inside a CLOSED fence        → not a banner " + bad("fence-example"));
  console.log("  14. blockquote banner inside a fence            → still a banner " + bad("fence-quote"));
  console.log("  15. banner under an UNCLOSED fence              → still a banner " + bad("fence-unclosed"));
  console.log("  16. banner on line 22 (15 could not see it)     → found at 30  " + bad("window-30"));
  console.log("  17. links in a fence / comment / code span      → not entries  " + bad("mask"));
  if (fails.length) {
    console.error("\n✗ Self-test FAILED:");
    for (const f of fails) console.error(`    · ${f}`);
    process.exit(1);
  }
  console.log("\nSelf-test passed — the gate fails on a planted banner and spares true sentences.");
}

// ── Entry point ──────────────────────────────────────────────────────────────────────
const MIN_LINKS = 200;
const MIN_BANNERED = 5;

function main() {
  const r = auditIndex();
  console.log("Index↔banner parity — a document that says it is dead is not described alive\n");
  console.log(`  markdown links in docs/INDEX.md resolving to tracked docs/**/*.md: ${r.resolved.length}`);
  console.log(`  distinct targets read:                                            ${r.targets}`);
  console.log(`  bannered targets (gated):                                         ${r.bannered.length}`);
  console.log(`  prior-version banners (skipped, REPORTED):                        ${r.skips.length}`);

  console.log("\n  Matched pairs — index line repeats the target's banner (REPORTED):");
  for (const p of r.pairs) console.log(`    · docs/INDEX.md:${p.line} → ${p.rel}  «${p.banner.replace(/^\s*>+\s*/, "").slice(0, 72)}»`);

  if (r.skips.length) {
    console.log("\n  Skipped — the banner supersedes a PRIOR VERSION of the same document, which is");
    console.log("  live; demanding the index call it superseded would make the index lie:");
    for (const s of r.skips) console.log(`    · ${s.rel}  «${s.banner.replace(/^\s*>+\s*/, "").slice(0, 72)}»`);
  }

  if (r.resolved.length < MIN_LINKS) {
    console.error(
      `\n✗ Only ${r.resolved.length} links resolved (floor ${MIN_LINKS}). The link parse or the path\n` +
        "  resolution drifted — this says the DETECTOR broke, not that the index emptied.",
    );
    process.exit(1);
  }
  if (r.bannered.length < MIN_BANNERED) {
    console.error(
      `\n✗ Only ${r.bannered.length} bannered targets found (floor ${MIN_BANNERED}). The banner reader\n` +
        "  drifted; a gate scanning nothing is green about nothing.",
    );
    process.exit(1);
  }
  if (r.problems.length) {
    console.error(`\n✗ ${r.problems.length} index entr${r.problems.length === 1 ? "y" : "ies"} describe a bannered document as live:\n`);
    for (const p of r.problems) console.error(`    · ${p}\n`);
    process.exit(1);
  }
  console.log("\nIndex↔banner parity passed — every bannered document is announced as one.");
}

// Guarded so `import { parseLinks } from "./check-index-banner-parity.mjs"` does not run
// the gate — a module that audits the repo on import cannot be reused or unit-tested.
const isEntry = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  if (process.argv.includes("--self-test")) selfTest();
  else main();
}
