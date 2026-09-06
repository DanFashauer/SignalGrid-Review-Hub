#!/usr/bin/env node
// Cross-document banner parity — the index is not the only page that sends a reader
// to a dead document.
//
//   node scripts/check-cross-doc-banner-parity.mjs              # gate
//   node scripts/check-cross-doc-banner-parity.mjs --self-test  # prove the gate can fail
//
// WHY. `check-index-banner-parity.mjs` holds exactly one property — a document that
// says it is dead may not be described alive — over exactly one page, `docs/INDEX.md`
// (its `indexRel` default). Everything it argues about honesty is true of every other
// document in the tree, and on 2026-09-06 the audit found the same defect one directory
// over: `docs/research/PITCH_EXECUTION_PACK.md` lists "[First-Call Talk Track]
// (FIRST_CALL_TALK_TRACK.md): opener, framing, proof flow …" and instructs the reader to
// "Run the first-call talk track", while that file's line 3 reads "**SUPERSEDED
// 2026-08-23 — do not send from this file.**"; `docs/research/DILIGENCE_CHECKLIST.md`
// lists two superseded files under "## Docs to send". The index announces all three
// honestly (that gate is green), so the honest half exists — the reader who lands in
// the pack instead never sees it.
//
// This gate reuses the index gate's exported machinery rather than restating it:
// `parseLinks` (which masks fences, HTML comments and code spans), `readBanner` (the
// banner shapes, the fence carve-outs, the anchored prior-version skip), `trackedDocs`
// and `ECHO`. If the banner vocabulary changes there, it changes here. A second copy of
// those regexes would be a fossil the first day one of them moved.
//
// SCOPE IS DERIVED, NEVER HAND-LISTED. Citing documents: every tracked `docs/**/*.md`
// (git ls-files). Targets: whichever of them carry a banner. Do not retype the count
// here — the gate prints it, and it moved twice in the hour this file was written.
// Nothing here names a document except the exclusions below, each of which names its
// reason.
//
// TWO CITATION SHAPES, because prose uses two. A markdown link `[text](PATH.md)` is one;
// a backticked `docs/research/X.md` is the other, and it is the shape BOTH live defects
// took in DILIGENCE_CHECKLIST.md. The index gate never had to read the second: an index
// links. Code spans are MASKED by `parseLinks` (a filename being discussed is not a
// route), so backticked paths are collected separately, from lines that are not inside a
// fenced block — a path shown inside a ``` block is an example, not a citation.
//
// WHERE THE ECHO MUST SIT: THE BLOCK, NOT THE LINE, and this is the one place this gate
// deliberately differs from its sibling. An index entry is one line by construction, so
// the index gate can demand the word inside the entry's own first sentence. General prose
// WRAPS. Measured on 2026-09-06 with a line-scoped rule, three truthful passages were
// flagged for nothing but a line break:
//   · docs/COMPANY_BUILD_PLAN.md:229 cites OUTREACH_EMAIL_TEMPLATES.md and says
//     "…now carry dated SUPERSEDED banners naming the live replacement" two lines below;
//   · docs/COMPANY_BUILD_PLAN.md:1515 cites OPERATIONAL_TRUST_ORCHESTRATION.md and says
//     "retiring a category the repo spent a document defining" three lines below;
//   · docs/PHASE_AUTOMATION_ORCHESTRATOR.md:24 carries its "(ARCHIVED 2026-08-15 …)"
//     inline and passes either way — the counterexample that proves the others are about
//     wrapping, not about honesty.
// A gate that flags those teaches the next author to reflow a paragraph to please it.
//
// THE BLOCK IS NOT "THE PARAGRAPH", and the difference is the whole hole. A markdown
// bullet list has no blank lines between items, so a blank-line-delimited paragraph would
// let ONE bullet saying "superseded" exempt every sibling bullet beside it — which is
// precisely the shape of the live defect (three consecutive bullets under "## Docs to
// send", one of which could have carried the word). So a block ENDS at a sibling list
// marker, a heading, a table row or a fence, and extends only over the CONTINUATION lines
// of the citing line's own item or paragraph.
//
// THE PATH AND THE LINK TEXT ARE NOT AN ECHO. `docs/retired/RUNBOOK.md` contains the word
// "retired" and a link labelled "[Runbook — superseded label era]" contains "superseded";
// neither tells a reader the target is dead, and the index gate says so in its own header
// after measuring three shapes that exploited it. Every resolved citation's path and link
// text is therefore blanked out of the scope before the echo is tested.
//
// A BANNERED DOCUMENT MAY CITE ITS PEERS FREELY. If the citing page opens by declaring
// itself superseded, its reader has already been told; demanding the word again in every
// sentence would punish the archive for being an archive. Reported, not silent.
//
// EXCLUSIONS — three, each because the document's JOB is to name dead things:
//   · docs/agent/**            the registries (FALSE_CLAIMS, review-coverage, ceilings,
//                              evaluation logs) cite retired surfaces as history by design;
//   · docs/INTAKE_LEDGER.md    an append-only ledger of what came in and what became of it;
//   · docs/DECISION_RECORDS.md the decision records name the documents they retired.
// Each is PRINTED on every run. An exclusion nobody can see is an exclusion nobody can
// audit — the same rule the index gate applies to its prior-version skips.
//
// GATED vs REPORTED:
//   · GATED    — an unbannered, non-excluded document citing a FULLY bannered document
//                with no family word (superseded | archived | retired | deprecated |
//                historical | "record of") anywhere in the citing block.
//   · REPORTED — a citation to a SCOPED supersession (see SCOPED_BANNER below), printed
//                with the banner text; every prior-version skip; every bannered-citer
//                exemption; and every count — citing documents scanned, citations
//                resolved, bannered targets, matched pairs. Nothing is dropped silently.
//
// FLOORS, because a gate scanning nothing is green about nothing: at least 50 resolved
// cross-document citations and at least 5 bannered documents. Both floors sit far below
// what this tree carries (the run prints both live numbers), so they fire only when the
// link/backtick parse or the banner reader drifts, not when the docs get cleaner.

import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { parseLinks, readBanner, trackedDocs, ECHO, HEAD_LINES } from "./check-index-banner-parity.mjs";
import { fencedLineFlags } from "./lib/markdown-scope.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Documents whose job is to name dead documents. Printed on every run. */
export const EXCLUDED = [
  ["docs/agent/", "agent registries (FALSE_CLAIMS, review-coverage, ceilings, evaluation logs) cite retired surfaces as history by design"],
  ["docs/INTAKE_LEDGER.md", "an append-only ledger of intake and disposition — naming what was retired IS its content"],
  ["docs/DECISION_RECORDS.md", "decision records name the documents and labels they retired"],
];

/** True when `rel` is one of the three carve-outs above. */
export function isExcluded(rel) {
  return EXCLUDED.some(([p]) => (p.endsWith("/") ? rel.startsWith(p) : rel === p));
}

/**
 * A SCOPED supersession — the banner retires PART of the document, not the document.
 *
 * Four appeared in this tree on 2026-09-06, all in the same sweep and all honest:
 *   · docs/IDENTITY_TRUST_LAYER_STRATEGY.md  "SUPERSEDED 2026-09-06 in its proof order"
 *   · docs/FRONTLINE_CONTEXT_SIGNALS.md      "SUPERSEDED 2026-09-06 as a sequence"
 *   · docs/AGENTIC_CONNECTOR_STRATEGY.md     "SUPERSEDED 2026-09-06 in its connector sequence"
 *   · docs/GREEN_YELLOW_RED_MERGE_POLICY.md  "SUPERSEDED 2026-09-06 in its two unsafe-claim
 *                                             bullets — the lanes themselves stand."
 * The first one's banner says, in its own words, "The identity-signal model here (IAM as a
 * source, never a replacement) still stands and is what `docs/ECOSYSTEM_POSITIONING.md`
 * routes to" — so the citing line this gate flagged is the line the BANNER endorses.
 * Demanding it say "superseded" would make ECOSYSTEM_POSITIONING lie about a live model, and
 * that is the failure this repository keeps repeating: teach the gate the honest idiom,
 * never delete the true sentence.
 *
 * Whether a given citation touches the retired PART is a judgement, and this file gates only
 * what is unambiguous — so these are REPORTED with the banner text beside them, never gated
 * and never silent. A scoped banner is therefore a visible, auditable hole rather than a
 * hidden one: anyone writing "SUPERSEDED in its title" to dodge the gate lands in that list.
 *
 * The shape is narrow on purpose: the qualifier must sit INSIDE the status clause, before
 * any dash or full stop. "SUPERSEDED 2026-08-23 — do not send from this file" has its dash
 * first and stays fully gated, which is the case this gate exists for.
 */
export const SCOPED_BANNER =
  /^(?:SUPERSEDED|ARCHIVED|RETIRED|DEPRECATED)\b.*\b(?:in its|in the|as a|as an|for its|in one|in two|in three)\b/i;

/**
 * The banner's STATUS CLAUSE — everything up to the first em/en dash, spaced hyphen or
 * sentence end. The qualifier has to sit in here, not anywhere in the banner, or a full
 * supersession whose explanation happens to contain "in the" would exempt itself. Written
 * as a split rather than a character class because the dates are hyphenated
 * ("SUPERSEDED 2026-09-06 in its proof order"), and an earlier version excluded `-` from
 * the class and therefore matched nothing at all — a rule that silently classified zero.
 */
export function statusClause(body) {
  return String(body).split(/[—–]|\s-\s|\.\s|\.$/)[0];
}

/** Pure: the banner body, stripped of quote markers, heading marks and bold. */
export function bannerBody(banner) {
  return String(banner)
    .replace(/^\s*>+\s*/, "")
    .replace(/^#{1,6}\s*/, "")
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/^\*+\s*/, "");
}

/** A line that OPENS a block rather than continuing one. See the header. */
const BLOCK_START = /^(\s*([-*+]|\d+[.)])\s|\s{0,3}#{1,6}\s|\s*\||\s{0,3}(```|~~~))/;

/**
 * Pure: the 0-based [start, end] line range of the block containing `i` — the citing
 * line plus the wrapped continuation lines of its own item or paragraph, never a
 * sibling bullet.
 */
export function blockRange(lines, i) {
  let start = i;
  while (start > 0 && !BLOCK_START.test(lines[start]) && lines[start - 1].trim() !== "") start -= 1;
  let end = i;
  while (end + 1 < lines.length && lines[end + 1].trim() !== "" && !BLOCK_START.test(lines[end + 1])) end += 1;
  return [start, end];
}

/**
 * Pure: every citation in `rawText` that resolves to a tracked doc — markdown links and
 * backticked `docs/…md` paths alike, with the 1-based line and the span the token
 * occupies so it can be blanked out of the echo scope.
 */
export function citationsIn(citingRel, rawText, tracked) {
  const lines = rawText.split("\n");
  const fenced = fencedLineFlags(lines, { treatUnclosedAsFence: true });
  const out = [];
  const push = (rel, line, spans) => out.push({ rel, line, spans });

  for (const l of parseLinks(rawText)) {
    const rel = resolveCitation(citingRel, l.href, tracked);
    if (!rel) continue;
    push(rel, l.line, [l.href, l.text].filter(Boolean));
  }
  for (let i = 0; i < lines.length; i += 1) {
    if (fenced[i]) continue;
    for (const m of lines[i].matchAll(/(`+)([^`\n]+?)\1/g)) {
      const inner = m[2].trim();
      if (!inner.endsWith(".md")) continue;
      const rel = resolveCitation(citingRel, inner, tracked);
      if (!rel) continue;
      push(rel, i + 1, [inner]);
    }
  }
  return out;
}

/**
 * Pure: the tracked doc a citation names, or null.
 *
 * Tried relative to the citing document FIRST and repo-root second, because prose uses
 * both idioms for the same file: `docs/research/PITCH_EXECUTION_PACK.md` links a sibling
 * as `FIRST_CALL_TALK_TRACK.md` while `docs/research/DILIGENCE_CHECKLIST.md` writes the
 * same class of citation as `docs/research/FIRST_CALL_TALK_TRACK.md`. A path that
 * resolves neither way is not this gate's business — `check-cited-paths.mjs` owns dead
 * citations, and a gate that reported them twice would be two gates disagreeing.
 */
export function resolveCitation(citingRel, href, tracked) {
  const h = String(href).split("#")[0].trim();
  if (!h || /^[a-z][a-z0-9+.-]*:/i.test(h) || !h.endsWith(".md")) return null;
  const dir = citingRel.includes("/") ? citingRel.slice(0, citingRel.lastIndexOf("/")) : "";
  const norm = (p) => {
    const parts = [];
    for (const seg of p.split("/")) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") parts.pop();
      else parts.push(seg);
    }
    return parts.join("/");
  };
  const relative = norm(dir ? `${dir}/${h}` : h);
  if (tracked.has(relative)) return relative;
  const rooted = norm(h);
  return tracked.has(rooted) ? rooted : null;
}

/**
 * The audit. Pure with respect to its inputs so the self-test can run it against a
 * synthetic tree: `docs` is the tracked set, `root` the tree to read from.
 */
export function auditCrossDoc({ root = ROOT, docs = null, headLines = HEAD_LINES } = {}) {
  const tracked = docs ?? trackedDocs(root);

  const verdicts = new Map();
  for (const rel of tracked) {
    const file = join(root, rel);
    if (!existsSync(file)) continue;
    verdicts.set(rel, readBanner(readFileSync(file, "utf8").split("\n"), headLines));
  }

  const problems = [];
  const pairs = [];
  const skips = [];
  const scoped = [];
  const banneredCiterExemptions = [];
  const banneredTargets = new Set();
  let citingScanned = 0;
  let resolvedCitations = 0;

  for (const citing of [...tracked].sort()) {
    if (isExcluded(citing)) continue;
    const file = join(root, citing);
    if (!existsSync(file)) continue;
    citingScanned += 1;
    const raw = readFileSync(file, "utf8");
    const lines = raw.split("\n");
    const citerBanner = verdicts.get(citing);

    for (const c of citationsIn(citing, raw, tracked)) {
      resolvedCitations += 1;
      if (c.rel === citing) continue; // a document citing itself says nothing about a banner
      const v = verdicts.get(c.rel);
      if (!v) continue;
      if (v.priorVersion) {
        skips.push({ citing, line: c.line, rel: c.rel, banner: v.banner });
        continue;
      }
      // A SCOPED supersession retires part of a document, not the document. REPORTED
      // with the banner text so the hole is auditable; see SCOPED_BANNER.
      if (SCOPED_BANNER.test(statusClause(bannerBody(v.banner)))) {
        scoped.push({ citing, line: c.line, rel: c.rel, banner: v.banner });
        continue;
      }
      banneredTargets.add(c.rel);
      if (citerBanner && !citerBanner.priorVersion) {
        banneredCiterExemptions.push({ citing, line: c.line, rel: c.rel });
        continue;
      }
      const [s, e] = blockRange(lines, c.line - 1);
      let scope = lines.slice(s, e + 1).join("\n");
      // The path and the link text are not an echo — blank them before testing.
      for (const span of c.spans) scope = scope.split(span).join(" ");
      if (ECHO.test(scope)) {
        pairs.push({ citing, line: c.line, rel: c.rel, banner: v.banner });
      } else {
        problems.push(
          `${citing}:${c.line} cites ${c.rel} without repeating its banner.\n` +
            `      the target opens with: ${v.banner.slice(0, 120)}\n` +
            `      the citing block says:  ${scope.trim().replace(/\s+/g, " ").slice(0, 160)}\n` +
            "      Fix the CITING line, never the banner: say superseded / archived / retired /\n" +
            "      deprecated / historical / \"record of\" in that block, or point at the live\n" +
            "      replacement instead. A keyword in the link text or in the path is not\n" +
            "      something a reader reads.",
        );
      }
    }
  }

  return {
    problems,
    pairs,
    skips,
    scoped,
    banneredCiterExemptions,
    banneredTargets: [...banneredTargets].sort(),
    allBannered: [...verdicts.entries()].filter(([, v]) => v && !v.priorVersion).map(([k]) => k).sort(),
    citingScanned,
    resolvedCitations,
  };
}

// ── Self-test — the gate must be able to fail, and must not fire on true sentences ────
function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), "cross-doc-banner-"));
  const w = (rel, body) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  };
  const DEAD = "# Talk track\n\n> **SUPERSEDED 2026-08-23 — do not send from this file.**\n";
  const fails = [];
  const expect = (id, cond, msg) => {
    if (!cond) fails.push(`${id}: ${msg}`);
  };
  // Every case runs against a synthetic tree whose tracked set is declared here, so a
  // stray file in /tmp cannot join the scan and no case depends on the live repository.
  const run = (files) => {
    const docs = new Set(Object.keys(files));
    for (const [rel, body] of Object.entries(files)) w(rel, body);
    return auditCrossDoc({ root: dir, docs });
  };
  const base = {
    "docs/research/DEAD.md": DEAD,
    "docs/research/REBORN.md": "# Sources\n\n> **Prior disposition, superseded.** This page is the live one.\n",
    "docs/LIVE.md": "# Live\n\nNothing to see.\n",
  };

  // 1. THE PLANT. A live pack routing a reader to a superseded file, in the shape the
  //    live defect took (a markdown link with a present-tense description).
  const planted = run({
    ...base,
    "docs/research/PACK.md": "# Pack\n\n- [First-Call Talk Track](DEAD.md): opener, framing, proof flow, and next ask.\n",
  });
  expect(
    "planted",
    planted.problems.length === 1 && planted.problems[0].includes("docs/research/PACK.md:3"),
    `expected 1 problem naming PACK.md:3, got ${planted.problems.length}: ${planted.problems[0] || ""}`,
  );
  // 2. …and the fix is to tell the truth in the citing line, not to delete the banner.
  const echoed = run({
    ...base,
    "docs/research/PACK.md": "# Pack\n\n- [First-Call Talk Track](DEAD.md): **SUPERSEDED 2026-08-23** — kept for provenance; do not send.\n",
  });
  expect("echoed", echoed.problems.length === 0, `expected 0 problems, got ${echoed.problems.length}`);
  expect("echoed", echoed.pairs.length === 1, `expected 1 matched pair, got ${echoed.pairs.length}`);

  // 3. THE BACKTICK SHAPE — both live defects in DILIGENCE_CHECKLIST.md were this, and a
  //    link-only parse reads code spans as masked. It must be a citation.
  const backtick = run({
    ...base,
    "docs/research/CHECK.md": "# Checklist\n\n## Docs to send\n\n- `docs/research/DEAD.md` for call preparation.\n",
  });
  expect("backtick", backtick.problems.length === 1, `a backticked path must be a citation, got ${backtick.problems.length} problems`);
  // 4. A SIBLING BULLET'S honesty does not cover the bullet beside it. This is the reason
  //    the block is not the paragraph: three bullets under one heading, no blank lines.
  const siblings = run({
    ...base,
    "docs/research/CHECK.md":
      "# Checklist\n\n- `docs/research/DEAD.md` — SUPERSEDED, kept for provenance.\n- `docs/research/DEAD.md` for call preparation.\n",
  });
  expect("siblings", siblings.problems.length === 1, `one honest bullet must not exempt its neighbour, got ${siblings.problems.length}`);
  // 5. WRAPPED PROSE. The word two lines below, in the same paragraph, is the same
  //    sentence to a reader — COMPANY_BUILD_PLAN.md:229 is exactly this and is truthful.
  const wrapped = run({
    ...base,
    "docs/PLAN.md":
      "# Plan\n\nThe two archival outreach documents that carry the public address —\n" +
      "`docs/research/DEAD.md` (nine overclaiming blocks, and dangerous because it is\n" +
      "a TEMPLATE someone could reach for) — now carry dated SUPERSEDED banners.\n",
  });
  expect("wrapped", wrapped.problems.length === 0, `a wrapped paragraph's echo must count, got ${wrapped.problems.length} problems`);
  // …and a blank line ends the block, so a word in the NEXT paragraph does not reach back.
  const nextPara = run({
    ...base,
    "docs/PLAN.md": "# Plan\n\nRun `docs/research/DEAD.md` before the call.\n\nThose drafts were superseded in August.\n",
  });
  expect("next-para", nextPara.problems.length === 1, `a word in the next paragraph must not exempt, got ${nextPara.problems.length}`);

  // 6. THE PATH AND THE LINK TEXT ARE NOT AN ECHO (the index gate's measured lesson).
  const inPath = run({
    ...base,
    "docs/retired/DEAD.md": DEAD,
    "docs/PLAN.md": "# Plan\n\nSee `docs/retired/DEAD.md` for the current call flow.\n",
  });
  expect("echo-path", inPath.problems.length === 1, `"retired" in the PATH must not exempt, got ${inPath.problems.length}`);
  const inText = run({
    ...base,
    "docs/PLAN.md": "# Plan\n\nSee [Talk track — superseded label era](research/DEAD.md) for the current call flow.\n",
  });
  expect("echo-linktext", inText.problems.length === 1, `"superseded" in the LINK TEXT must not exempt, got ${inText.problems.length}`);

  // 7. A BANNERED CITER is exempt, and the exemption is reported rather than silent.
  const banneredCiter = run({
    ...base,
    "docs/research/OLD_PACK.md": "# Old pack\n\n> **SUPERSEDED 2026-09-06 — do not send from this file.**\n\nRun [the talk track](DEAD.md) first.\n",
  });
  expect("bannered-citer", banneredCiter.problems.length === 0, `a bannered document may cite its peers, got ${banneredCiter.problems.length}`);
  expect("bannered-citer", banneredCiter.banneredCiterExemptions.length === 1, "the exemption must be REPORTED, not silent");

  // 8. THE EXCLUSIONS. A registry whose job is to name dead documents is not scanned…
  const registry = run({ ...base, "docs/agent/FALSE_CLAIMS.md": "# Claims\n\nSee `docs/research/DEAD.md` for the original wording.\n" });
  expect("exclude-agent", registry.problems.length === 0, `docs/agent/ must not be scanned, got ${registry.problems.length}`);
  const ledger = run({ ...base, "docs/INTAKE_LEDGER.md": "# Ledger\n\nSee `docs/research/DEAD.md` for the original wording.\n" });
  expect("exclude-ledger", ledger.problems.length === 0, `docs/INTAKE_LEDGER.md must not be scanned, got ${ledger.problems.length}`);
  const drs = run({ ...base, "docs/DECISION_RECORDS.md": "# DRs\n\nDR-013 retires `docs/research/DEAD.md`.\n" });
  expect("exclude-drs", drs.problems.length === 0, `docs/DECISION_RECORDS.md must not be scanned, got ${drs.problems.length}`);
  // …and the exclusion is a LIST, not a prefix accident: docs/agentless/ is scanned.
  expect("exclude-shape", isExcluded("docs/agent/x.md") && !isExcluded("docs/agentless/x.md"), "the docs/agent/ carve-out must not match docs/agentless/");

  // 9. A FENCED example is not a citation, and a PRIOR-VERSION banner is skipped, not gated.
  const fencedOnly = run({ ...base, "docs/PLAN.md": "# Plan\n\n```\nsee docs/research/DEAD.md\n```\n" });
  expect("fenced", fencedOnly.problems.length === 0, `a path inside a fence is an example, got ${fencedOnly.problems.length} problems`);
  const priorVersion = run({ ...base, "docs/PLAN.md": "# Plan\n\nSee `docs/research/REBORN.md` for the live source list.\n" });
  expect("prior-skip", priorVersion.problems.length === 0 && priorVersion.skips.length === 1, "a prior-version target must be skipped and reported");
  // 10. A document citing ITSELF says nothing about a banner.
  const selfCite = run({ ...base, "docs/research/DEAD.md": `${DEAD}\nThis page is \`docs/research/DEAD.md\`.\n` });
  expect("self-cite", selfCite.problems.length === 0, `a self-citation must not fire, got ${selfCite.problems.length}`);
  // 11b. A SCOPED supersession retires PART of a document. It must NOT be gated, it must be
  //      REPORTED, and the qualifier must be inside the STATUS CLAUSE — a full supersession
  //      whose explanation happens to say "in the" stays gated.
  const scopedTree = {
    ...base,
    "docs/SCOPED.md": '# Identity Trust Layer Strategy\n\n> **SUPERSEDED 2026-09-06 in its proof order — do not follow the "Entra first" sequence.**\n> The identity-signal model here still stands.\n',
    "docs/CITER.md": "# Positioning\n\nSee [Identity Trust Layer strategy](SCOPED.md) for the broader identity roadmap.\n",
  };
  const scopedRun = run(scopedTree);
  expect("scoped", scopedRun.problems.length === 0, `a scoped supersession must not be gated, got ${scopedRun.problems.length}`);
  expect("scoped", scopedRun.scoped.length === 1, `it must be REPORTED, got ${scopedRun.scoped.length}`);
  // The same citing line against a FULL supersession still fails …
  const fullRun = run({
    ...base,
    "docs/SCOPED.md": "# Identity Trust Layer Strategy\n\n> **SUPERSEDED 2026-09-06 — do not follow this page. The live route is in the positioning doc.**\n",
    "docs/CITER.md": "# Positioning\n\nSee [Identity Trust Layer strategy](SCOPED.md) for the broader identity roadmap.\n",
  });
  expect("scoped", fullRun.problems.length === 1, `a FULL supersession whose explanation says "in the" must stay gated, got ${fullRun.problems.length}`);
  expect("scoped", fullRun.scoped.length === 0, "a full supersession must not be classified as scoped");
  // … and the classifier itself, on the exact strings, both ways.
  expect(
    "scoped-shape",
    SCOPED_BANNER.test(statusClause(bannerBody('> **SUPERSEDED 2026-09-06 in its proof order — do not follow the "Entra ID + Intune first" sequence.**'))) &&
      SCOPED_BANNER.test(statusClause(bannerBody("> **SUPERSEDED 2026-09-06 as a sequence — do not follow the order below.**"))) &&
      SCOPED_BANNER.test(statusClause(bannerBody("> **SUPERSEDED 2026-09-06 in its two unsafe-claim bullets — the lanes themselves stand.**"))),
    "the three live scoped shapes must classify as scoped",
  );
  expect(
    "scoped-shape",
    !SCOPED_BANNER.test(statusClause(bannerBody("> **SUPERSEDED 2026-08-23 — do not send from this file.**"))) &&
      !SCOPED_BANNER.test(statusClause(bannerBody("> ## ⛔ RETIRED 2026-08-15"))) &&
      !SCOPED_BANNER.test(statusClause(bannerBody("# Operational Trust Orchestration — SUPERSEDED HISTORY"))) &&
      !SCOPED_BANNER.test(statusClause(bannerBody("> **ARCHIVED 2026-08-15.** The record of the phase table."))),
    "the live FULL supersessions must not classify as scoped",
  );
  // The hyphenated date is why statusClause splits rather than excluding `-`: the first
  // version of this rule used a character class without `-` and classified NOTHING.
  expect("scoped-shape", statusClause("SUPERSEDED 2026-09-06 in its proof order — do not follow").includes("in its"), "the date's hyphens must not truncate the status clause");

  // 11. A live target is not a banner target at all.
  const liveTarget = run({ ...base, "docs/PLAN.md": "# Plan\n\nSee `docs/LIVE.md` for the current call flow.\n" });
  expect("live-target", liveTarget.problems.length === 0 && liveTarget.banneredTargets.length === 0, "an unbannered target must not be gated");

  rmSync(dir, { recursive: true, force: true });
  const bad = (id) => (fails.some((f) => f.startsWith(`${id}:`)) ? "✗" : "✓");
  console.log("Cross-document banner parity self-test\n");
  console.log("   1. live pack routes to a SUPERSEDED file        → gate FAILS   " + bad("planted"));
  console.log("   2. citing line repeats the banner               → gate PASSES  " + bad("echoed"));
  console.log("   3. backticked `docs/…md` path                   → is a citation " + bad("backtick"));
  console.log("   4. honest bullet beside a bare bullet           → neighbour still FAILS " + bad("siblings"));
  console.log("   5. echo two lines down, same paragraph          → gate PASSES  " + bad("wrapped"));
  console.log("   6. echo in the NEXT paragraph                   → gate FAILS   " + bad("next-para"));
  console.log("   7. 'retired' only in the PATH                   → gate FAILS   " + bad("echo-path"));
  console.log("   8. 'superseded' only in the LINK TEXT           → gate FAILS   " + bad("echo-linktext"));
  console.log("   9. the CITING document is itself bannered       → exempt + REPORTED " + bad("bannered-citer"));
  console.log("  10. docs/agent/ registry                         → not scanned  " + bad("exclude-agent"));
  console.log("  11. docs/INTAKE_LEDGER.md                        → not scanned  " + bad("exclude-ledger"));
  console.log("  12. docs/DECISION_RECORDS.md                     → not scanned  " + bad("exclude-drs"));
  console.log("  13. docs/agentless/ is NOT docs/agent/           → still scanned " + bad("exclude-shape"));
  console.log("  14. path inside a fenced block                   → not a citation " + bad("fenced"));
  console.log("  15. prior-version banner on the target           → skipped + REPORTED " + bad("prior-skip"));
  console.log("  16. a document citing itself                     → not a violation " + bad("self-cite"));
  console.log("  17. an unbannered target                         → not gated    " + bad("live-target"));
  console.log("  18. 'SUPERSEDED in its proof order' (scoped)     → REPORTED, not gated " + bad("scoped"));
  console.log("  19. the scoped/full classifier, both ways        → " + bad("scoped-shape"));
  if (fails.length) {
    console.error("\n✗ Self-test FAILED:");
    for (const f of fails) console.error(`    · ${f}`);
    process.exit(1);
  }
  console.log("\nSelf-test passed — the gate fails on a planted route to a dead document and spares true sentences.");
}

// ── Entry point ──────────────────────────────────────────────────────────────────────
const MIN_CITATIONS = 50;
const MIN_BANNERED = 5;

function main() {
  const r = auditCrossDoc();
  console.log("Cross-document banner parity — no live page routes a reader to a dead one\n");
  console.log(`  citing documents scanned (tracked docs/**/*.md, minus the exclusions): ${r.citingScanned}`);
  console.log(`  citations resolving to a tracked docs/**/*.md:                         ${r.resolvedCitations}`);
  console.log(`  documents carrying a banner:                                          ${r.allBannered.length}`);
  console.log(`  bannered documents actually cited from elsewhere (gated):             ${r.banneredTargets.length}`);
  console.log(`  citations from a document that is itself bannered (exempt, REPORTED):  ${r.banneredCiterExemptions.length}`);
  console.log(`  prior-version targets (skipped, REPORTED):                             ${r.skips.length}`);
  console.log(`  SCOPED supersessions ("superseded IN ITS x") — REPORTED, not gated:    ${r.scoped.length}`);

  console.log("\n  Excluded by name — documents whose job is to cite dead documents:");
  for (const [p, why] of EXCLUDED) console.log(`    · ${p}  — ${why}`);

  console.log("\n  Matched — the citing block repeats the target's banner (REPORTED):");
  for (const p of r.pairs) console.log(`    · ${p.citing}:${p.line} → ${p.rel}`);

  if (r.banneredCiterExemptions.length) {
    console.log("\n  Exempt — the CITING document is bannered too, so its reader was already told:");
    for (const p of r.banneredCiterExemptions) console.log(`    · ${p.citing}:${p.line} → ${p.rel}`);
  }
  if (r.scoped.length) {
    console.log("\n  REPORTED, not gated — the target's banner retires PART of it, not the document. Whether a");
    console.log("  given citation touches the retired part is a judgement, so it is printed rather than failed:");
    for (const p of r.scoped) {
      console.log(`    · ${p.citing}:${p.line} → ${p.rel}`);
      console.log(`        «${bannerBody(p.banner).slice(0, 100)}»`);
    }
  }
  if (r.skips.length) {
    console.log("\n  Skipped — the target's banner supersedes a PRIOR VERSION of itself, so the target is live:");
    for (const p of r.skips) console.log(`    · ${p.citing}:${p.line} → ${p.rel}`);
  }

  if (r.resolvedCitations < MIN_CITATIONS) {
    console.error(
      `\n✗ Only ${r.resolvedCitations} citations resolved (floor ${MIN_CITATIONS}). The link/backtick parse or the\n` +
        "  path resolution drifted — this says the DETECTOR broke, not that the docs stopped citing.",
    );
    process.exit(1);
  }
  if (r.allBannered.length < MIN_BANNERED) {
    console.error(
      `\n✗ Only ${r.allBannered.length} bannered documents found (floor ${MIN_BANNERED}). The banner reader drifted;\n` +
        "  a gate scanning nothing is green about nothing.",
    );
    process.exit(1);
  }
  if (r.problems.length) {
    console.error(`\n✗ ${r.problems.length} live citation(s) route a reader to a bannered document as if it were live:\n`);
    for (const p of r.problems) console.error(`    · ${p}\n`);
    process.exit(1);
  }
  console.log("\nCross-document banner parity passed — no live document cites a dead one as live.");
}

// Guarded so importing a helper does not run the gate.
const isEntry = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  if (process.argv.includes("--self-test")) selfTest();
  else main();
}
