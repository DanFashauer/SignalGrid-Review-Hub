#!/usr/bin/env node
// Published-page scope banner — every page the deploy publishes must say what is
// deferred, in the page, where the reader is.
//
//   node scripts/check-published-page-scope-banner.mjs              # gate
//   node scripts/check-published-page-scope-banner.mjs --self-test  # prove it can fail
//
// WHY. On 2026-09-06 an audit measured the eight `docs/*.html` pages for a scope
// statement. `.github/workflows/pages.yml` deploys seven of them to signalgrid.app, and
// two of the seven carried none: `embedded-host-app-demo.html` and
// `embedded-desktop-demo.html`. That matters because of what the first one demonstrates
// — its only step-up is headlined `BASELINE_DRIFTED · SHARED_DEVICE`, and
// `security_baseline` is a DEFERRED family. A prospect walking the demo watched a
// deferred signal drive the product's central moment with nothing on the page saying so,
// while the five pages beside it all said it plainly. `architecture.html` was worse in
// kind and lesser in reach: ~15 deferred families drawn as current sources, and outside
// the publish set, so outside every scan derived from it.
//
// WHAT IT ASSERTS, and it is the presence of an honest sentence, never the absence of a
// forbidden one. This gate CANNOT punish truthful copy: it demands a page SAY the
// deferred families are deferred, so the only way to fail it is to omit the hedge. That
// is deliberate — this repository has three times shipped a gate that flagged a true
// sentence (copy that correctly said "not evaluated today", a page carrying a proper
// scope disclaimer, a list of phrases a seller must AVOID), and each fix was to teach
// the gate the honest idiom. A presence rule has no such failure mode.
//
// SCOPE IS DERIVED, NEVER HAND-LISTED. The published set comes from the `cp docs/*.html
// _site/*` lines in the deploy workflow itself. Add a page to pages.yml and it is gated
// on the next run; a hand-kept copy of the deploy manifest is the fossil this avoids —
// which is also how `check-launch-claims.mjs` derives its own published surface.
//
// GATED vs REPORTED, stated because the difference is the whole discipline:
//   GATED    — every page pages.yml publishes carries the hedge.
//   REPORTED — every other tracked `docs/*.html`. They are not on the public domain, so
//              failing a build over one would be a claim this gate cannot support; but an
//              unpublished page is unexamined BY CONSTRUCTION under a pages.yml-derived
//              scope, which is exactly how architecture.html stayed invisible, so its
//              state is printed on every run rather than left unsaid.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PAGES_WORKFLOW = ".github/workflows/pages.yml";

/**
 * The phrases that make a scope statement honest, and how close they must sit.
 *
 * `deferred` alone is a word that appears in prose about anything; `not shipping at
 * Limited GA` alone could be a sentence about something else entirely. It is the PAIR,
 * next to each other, that is the hedge every already-honest page carries. Measured
 * across all eight pages on 2026-09-06 the widest real gap was 44 characters — the
 * window below has headroom without being wide enough for two unrelated mentions on
 * opposite sides of a page to satisfy it.
 */
const LAUNCH_PHRASE = /not shipping at Limited GA/i;
const DEFERRED_WORD = /deferred/i;
const PROXIMITY_CHARS = 200;

/** Generated pages: editing the output is a no-op, so a failure must name the source. */
const GENERATED_FROM = new Map([
  ["docs/room-entry-console.html", "tools/room-console/shell.html (then `pnpm run build:room-console`)"],
  ["docs/evidence-coverage.html", "tools/evidence-coverage/shell.html (then `pnpm run build:evidence-coverage`)"],
]);

/** Strip markup and entities down to the text a reader actually sees. */
function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&mdash;/g, "—")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

/**
 * Does this page carry the hedge? Returns the matched sentence, or null.
 *
 * Deliberately reads the VISIBLE text: a hedge inside an HTML comment or a `<script>`
 * block is not a statement to a reader, and the room console's own JS comments mention
 * "Limited GA launch families" for entirely unrelated reasons.
 */
export function findScopeStatement(html) {
  const text = visibleText(html);
  for (const hit of text.matchAll(new RegExp(LAUNCH_PHRASE.source, "gi"))) {
    const from = Math.max(0, hit.index - PROXIMITY_CHARS);
    const window = text.slice(from, hit.index + hit[0].length);
    if (DEFERRED_WORD.test(window)) return window.trim();
  }
  return null;
}

/**
 * The published page set, DERIVED from the deploy workflow's own copy commands.
 *
 * Returns `[{ source, destination }]`. Only `docs/*.html` sources are collected: the SPA
 * bundle and the CNAME are copied by the same step and are not pages this gate can read.
 */
export function publishedPages(workflowSource) {
  const pages = [];
  for (const m of workflowSource.matchAll(/\bcp\s+(docs\/[\w.-]+\.html)\s+(_site\/[\w./-]+)/g)) {
    pages.push({ source: m[1], destination: m[2] });
  }
  return pages;
}

function trackedDocsHtml() {
  const out = execFileSync("git", ["ls-files", "docs/*.html"], { cwd: REPO, encoding: "utf8" });
  return out.split("\n").filter((line) => line.trim().length > 0);
}

// ── SELF-TEST ────────────────────────────────────────────────────────────────
//
// A gate that has never failed proves nothing. Each case below is a defect this rule is
// supposed to catch, plus the controls that stop it passing for the wrong reason.
if (process.argv.includes("--self-test")) {
  const cases = [];
  const t = (name, ok) => cases.push([name, ok]);

  const HEDGE =
    '<p><strong>Scope:</strong> this page shows families that are <strong>deferred &mdash; ' +
    "proven in the repository, not shipping at Limited GA</strong>.</p>";

  t("a page carrying the hedge passes", findScopeStatement(`<body>${HEDGE}</body>`) !== null);
  t("a page with no scope statement at all is flagged", findScopeStatement("<body><p>Buy this.</p></body>") === null);
  t(
    "a page saying 'not shipping at Limited GA' with no 'deferred' nearby is flagged",
    findScopeStatement("<body><p>The console is not shipping at Limited GA.</p></body>") === null,
  );
  t(
    "a page whose two phrases sit far apart is flagged — proximity is real, not decorative",
    findScopeStatement(`<body><p>deferred</p><p>${"x ".repeat(PROXIMITY_CHARS)}not shipping at Limited GA</p></body>`) === null,
  );
  t(
    "a hedge hidden in an HTML comment does not count — a reader cannot read it",
    findScopeStatement(`<body><!-- ${HEDGE} --><p>Buy this.</p></body>`) === null,
  );
  t(
    "a hedge hidden in a <script> comment does not count",
    findScopeStatement(`<body><script>// deferred — not shipping at Limited GA</script></body>`) === null,
  );
  // THE HONEST-IDIOM CONTROL. This gate demands presence, so truthful copy can only ever
  // help it. The case that has bitten this repo three times — a page listing the phrases
  // a seller must AVOID, and being flagged for containing them — cannot arise here, and
  // the control asserts that rather than asserting it in a comment.
  t(
    "a page that quotes forbidden phrases AND carries the hedge still passes",
    findScopeStatement(`<body><p>Never say "ships today" or "enforced on device".</p>${HEDGE}</body>`) !== null,
  );

  t(
    "the published set is derived from a cp line",
    publishedPages("          cp docs/pitch-deck.html _site/pitch.html\n").length === 1,
  );
  t(
    "a workflow with no docs cp lines derives NOTHING, so the floor below must catch it",
    publishedPages("          cp -r artifacts/signalgrid-web/dist/public/. _site/\n").length === 0,
  );
  t(
    "the real workflow derives a real page set (floor)",
    publishedPages(readFileSync(join(REPO, PAGES_WORKFLOW), "utf8")).length >= 5,
  );

  let failed = 0;
  for (const [name, ok] of cases) {
    console.log(`  ${ok ? "ok" : "FAIL"} — ${name}`);
    if (!ok) failed += 1;
  }
  console.log(`\nself-test: ${cases.length - failed}/${cases.length}`);
  if (failed > 0) {
    console.error("The gate cannot detect the defect it exists for.");
    process.exit(1);
  }
  process.exit(0);
}

// ── THE GATE ─────────────────────────────────────────────────────────────────
const workflowPath = join(REPO, PAGES_WORKFLOW);
if (!existsSync(workflowPath)) {
  console.error(`FAIL — ${PAGES_WORKFLOW} does not exist; the published page set cannot be derived.`);
  process.exit(1);
}
const published = publishedPages(readFileSync(workflowPath, "utf8"));

// FLOOR. A parse that finds nothing must never read as a clean sweep.
if (published.length < 5) {
  console.error(
    `FAIL — derived only ${published.length} published page(s) from ${PAGES_WORKFLOW}; expected at least 5. ` +
      "The `cp docs/*.html _site/*` shape has changed and this gate is scanning almost nothing.",
  );
  process.exit(1);
}

const failures = [];
console.log(`Published pages (derived from ${PAGES_WORKFLOW}): ${published.length}`);
for (const { source, destination } of published) {
  const abs = join(REPO, source);
  if (!existsSync(abs)) {
    failures.push(`${source} → ${destination}: pages.yml publishes it and it does not exist`);
    continue;
  }
  const statement = findScopeStatement(readFileSync(abs, "utf8"));
  if (statement === null) {
    const origin = GENERATED_FROM.get(source);
    failures.push(
      `${source} → https://signalgrid.app/${destination.replace(/^_site\//, "")} carries no scope statement. ` +
        `Add the hedge the other published pages carry — the word "deferred" within ${PROXIMITY_CHARS} characters of ` +
        `"not shipping at Limited GA", in visible text.` +
        (origin ? ` This page is GENERATED: edit ${origin}.` : ""),
    );
  } else {
    console.log(`  ok — ${source} → ${destination}`);
  }
}

// REPORTED, never fatal: the tracked pages pages.yml does NOT publish.
const publishedSources = new Set(published.map((p) => p.source));
const unpublished = trackedDocsHtml().filter((f) => !publishedSources.has(f));
if (unpublished.length > 0) {
  console.log(`\nREPORTED — tracked docs/*.html that pages.yml does not publish (${unpublished.length}), not gated:`);
  for (const file of unpublished) {
    const has = findScopeStatement(readFileSync(join(REPO, file), "utf8")) !== null;
    console.log(`  ${has ? "carries the hedge" : "NO SCOPE STATEMENT"} — ${file}`);
  }
}

if (failures.length > 0) {
  console.error(`\nFAILED — ${failures.length} published page(s) with no scope statement:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\nPublished-page scope banner passed — ${published.length}/${published.length} carry the hedge.`);
