#!/usr/bin/env node
// Absence check — "it does not exist" is the claim that needs the most evidence and
// usually gets the least.
//
//   node scripts/agent/absence-check.mjs android
//   node scripts/agent/absence-check.mjs --patterns AndroidManifest build.gradle
//     (literal substrings, matched case-insensitively against tracked paths — not regexes)
//   node scripts/agent/absence-check.mjs --self-test
//
// THE FAILURE THIS PREVENTS (real, twice, 2026-08-08 and 2026-08-12). A document
// asserted "Android does not exist in any form." A native Android app was sitting in
// `native/android/`. The search that produced the claim used ONE pattern shape. A
// second document asserted the dock firmware was absent on the strength of a search for
// `.ino`/`.c`/`.cpp`/`.h` — the firmware is Rust, so that search could not have found it
// whether or not it existed. Both claims propagated into planning documents.
//
// THE RULE: presence needs one hit; absence needs exhaustion. One empty grep is
// evidence about that grep.
//
// STRENGTH IS NOT UNIFORM, AND CONFLATING IT IS THE SAME BUG WEARING A MASK. A probe
// that finds a FILE is strong: the thing is here. A probe that finds the WORD is weak —
// this repository is full of sentences naming things precisely to disclaim them, and a
// catalogue of compliance frameworks mentions FedRAMP without a FedRAMP artifact
// existing anywhere. An earlier version treated those alike and reported "ABSENCE CLAIM
// IS FALSE" for `fedramp`, which would have blocked a true statement. Content-only hits
// are INCONCLUSIVE, printed with their matches, and the caller reads them. A tool that
// cries wolf on true claims gets ignored on false ones.
//
// NO SHELL, BY CONSTRUCTION. The first version built shell strings and hand-escaped the
// user's topic into them; CodeQL flagged it as an indirect uncontrolled command line and
// was right to. Hand-rolled quoting in a security-reviewed repository is a thing a
// reviewer has to take on trust. Every subprocess here is `execFileSync` with an argv
// array — no shell parses anything — and the matching happens in JavaScript. The
// self-test asserts this structurally, so the property cannot quietly regress.
//
// EXIT CODES:  0 = absence corroborated   1 = refuted (a file exists)   2 = inconclusive
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const G = "\x1b[32m", R = "\x1b[31m", Y = "\x1b[33m", B = "\x1b[1m", D = "\x1b[2m", X = "\x1b[0m";

/**
 * Every subprocess: argv array, never a command string. No shell is ever spawned.
 *
 * A PROBE THAT COULD NOT RUN IS NOT A PROBE THAT FOUND NOTHING (fixed 2026-09-06).
 * This returned `[]` from a bare `catch`, so a git that could not be spawned, a corrupt
 * index, a rejected pathspec and a genuinely empty result were the same value. Three of
 * the four probes go through here, and `classify()` reads empty as evidence of absence —
 * so every failure mode of this call resolved to CORROBORATED, the strongest
 * safe-to-claim verdict the tool can return, in the tool this repository tells every
 * agent to run BEFORE writing "X does not exist".
 *
 * Reproduced: `node scripts/agent/absence-check.mjs buildCoverageReport` → INCONCLUSIVE,
 * exit 2. The same command with git removed from PATH → "✓ CORROBORATED across 4
 * differently-shaped probes. Safe to claim", exit 0. It is the file's own counterexample:
 * "one empty grep is evidence about that grep".
 *
 * `emptyStatus` is how a legitimate no-match is told from an error: `git grep` exits 1
 * when nothing matched, and that IS a real empty result. Anything else is a failure.
 *
 * @returns {{lines: string[], failed: boolean, why: string|null}}
 */
function gitLines(args, { emptyStatus = null } = {}) {
  try {
    // stderr is CAPTURED, not inherited: a probe's failure is reported through `why`
    // below, in the verdict, rather than as loose noise above it.
    const out = execFileSync("git", args, {
      cwd: REPO,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { lines: out ? out.trim().split("\n").filter(Boolean) : [], failed: false, why: null };
  } catch (err) {
    if (emptyStatus !== null && err && err.status === emptyStatus) {
      return { lines: [], failed: false, why: null };
    }
    const detail = err && (err.code || (err.status !== undefined ? `exit ${err.status}` : err.message));
    return { lines: [], failed: true, why: `git ${args[0]} could not run (${detail})` };
  }
}

const trackedFiles = () => gitLines(["ls-files"]);

/** Shape every probe returns, so a caller can never mistake "could not look" for "looked". */
const probeResult = (hits, failed = false, why = null) => ({ hits, failed, why });

/** `needles` is every spelling of the topic (see spellingVariants) — a workflow that
 *  runs `check-decision-record-format.mjs` must answer a caller who typed it with
 *  spaces. */
function workflowFilesMentioning(needles) {
  const dir = join(REPO, ".github/workflows");
  // An absent workflow directory is not an absent workflow: this repository has 14 of
  // them, so "no directory" means we could not look, not that nothing builds the topic.
  if (!existsSync(dir)) return probeResult([], true, "no .github/workflows directory — this probe could not look");
  const hits = [];
  let failed = false;
  let why = null;
  for (const f of readdirSync(dir)) {
    if (!/\.ya?ml$/.test(f)) continue;
    try {
      const body = readFileSync(join(dir, f), "utf8").toLowerCase();
      if (needles.some((n) => body.includes(n))) hits.push(`.github/workflows/${f}`);
    } catch (err) {
      // An unreadable workflow is not evidence either way — which is exactly why it may
      // not be silently dropped into the "found nothing" pile.
      failed = true;
      why = `unreadable workflow ${f} (${err && err.code}) — this probe is incomplete`;
    }
  }
  return probeResult(hits, failed, why);
}

/**
 * Genuinely different SHAPES, not narrowings of one pattern. An earlier version derived
 * [t, \.t$, t/, "t", t_, -t] — every one a subset of the first, so six probes could only
 * ever agree with each other. These four look in different places.
 */
// Build output and generated artefacts. NOT docs/ — see the content probe below.
// EXACT lockfile names and dist/ directories only (plan row 61, 2026-10-08). The earlier
// substring globs `*lock*` / `*dist*` matched ANY path containing those letters and hid
// first-party files (a locker doc, LockedIdleView.swift, a hook, a distribution script),
// so an absence claim about a word living only there came back CORROBORATED.
// `**/` needs a directory before it, so a ROOT-level Cargo.lock / dist/ needs its own entry
// (measured: `git grep -- ':!**/dist/**'` still returns dist/b.js at the repo root).
const CONTENT_EXCLUSIONS = [
  ":!pnpm-lock.yaml",
  ":!Cargo.lock",
  ":!**/Cargo.lock",
  ":!package-lock.json",
  ":!**/package-lock.json",
  ":!yarn.lock",
  ":!**/yarn.lock",
  ":!dist/**",
  ":!**/dist/**",
  ":!*.map",
];

/** A pathspec's bare directory, so ':!docs', ':!docs/*' and ':!docs/**' all normalise to 'docs'. */
export function excludedDir(pathspec) {
  return String(pathspec).replace(/^:!/, "").replace(/\/\*{1,2}$/, "").replace(/\/$/, "").toLowerCase();
}

/**
 * Every SPELLING of one topic, because a probe that tries one spelling is the same bug
 * this file exists to prevent, wearing its third mask.
 *
 * THE FAILURE, reproduced 2026-09-14. `check:absence "decision record format"` returned
 * CORROBORATED across all four probes — "Safe to claim" — while
 * `scripts/check-decision-record-format.mjs` sat in the tree and the CI workflow ran it.
 * The same query hyphenated, `check:absence "decision-record-format"`, returns REFUTED.
 * Nothing about the repository differed; only how the caller typed the topic. A human
 * asks for "decision record format" and a filename spells it decision-record-format, so
 * the natural phrasing was the one that could not match.
 *
 * That is this file's own thesis turned against it. The header says "presence needs one
 * hit; absence needs exhaustion" and "One empty grep is evidence about that grep" — and
 * then every probe passed the topic through as a single literal substring. Exhaustion
 * over four probe SHAPES is not exhaustion if all four are blind to the same spelling.
 *
 * So the topic is expanded to its separator variants (space / hyphen / underscore / dot
 * / concatenated), and camelCase is split into words first, so `decisionRecordFormat`,
 * `decision_record_format` and `decision record format` are one query. A probe hits if
 * ANY variant hits.
 */
export function spellingVariants(topic) {
  const raw = String(topic).trim().toLowerCase();
  // camelCase and PascalCase are word boundaries: decisionRecordFormat -> three words.
  const words = String(topic)
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[\s\-_.\/]+/)
    .filter(Boolean);
  const out = new Set([raw]);
  if (words.length > 1) {
    for (const sep of [" ", "-", "_", "."]) out.add(words.join(sep));
    // The CONCATENATED form only when it is long enough to be a real name. "a b" -> "ab"
    // would match a substring of half the tree, and a probe that matches everything is
    // as useless as one that matches nothing — it would turn every absence query into a
    // refusal. Five characters is the shortest identifier worth calling a name here.
    const glued = words.join("");
    if (glued.length >= 5) out.add(glued);
  }
  return [...out].filter(Boolean);
}

/** The topic's words, camelCase split, as spellingVariants sees them. */
function topicWords(topic) {
  return String(topic)
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[\s\-_.\/]+/)
    .filter(Boolean);
}

// Generic suffix nouns a caller adds to a name ("model tier GATE") that an identifier may
// spell differently ("check-agent-model-tier"), so they carry no matching weight.
const GENERIC_WORDS = new Set(["gate", "check", "checker", "guard", "script", "test", "tests", "proof", "rule", "lint"]);

/** The words worth matching on their own: generic nouns and tokens under 3 characters dropped. */
export function significantWords(topic) {
  return topicWords(topic).filter((w) => w.length >= 3 && !GENERIC_WORDS.has(w));
}

/**
 * Variants of the topic with its generic nouns removed ("agent model tier gate" ->
 * agent-model-tier). Only when a generic noun was actually dropped AND two or more words
 * remain: a one-word stem ("agent") would match half the tree and turn every query into
 * a refusal.
 */
export function stemVariants(topic) {
  const words = topicWords(topic);
  const kept = words.filter((w) => !GENERIC_WORDS.has(w));
  if (kept.length === words.length || kept.length < 2) return [];
  const out = new Set();
  for (const sep of [" ", "-", "_", "."]) out.add(kept.join(sep));
  const glued = kept.join("");
  if (glued.length >= 5) out.add(glued);
  return [...out];
}

/**
 * The words probe applies when two or more significant words remain, OR when a generic noun
 * was dropped from a multi-word topic and one word is left ("lessons gate" -> lessons, which
 * exited 0 CORROBORATED while scripts/check-lessons.mjs exists; review round 1 of PR #1464).
 * A weak probe, so the cost of the one-word case is INCONCLUSIVE noise, never a refusal.
 */
export function wordsProbeApplies(topic) {
  const sig = significantWords(topic).length;
  return sig >= 2 || (sig === 1 && topicWords(topic).length >= 2);
}

/** Merge the git-grep half and the tracked-path half of the words probe; a failure in either is a failure. */
export function combineWordsProbe(grep, tracked, words) {
  const pathHits = tracked.lines.filter((f) => words.every((w) => f.toLowerCase().includes(w)));
  return probeResult([...new Set([...grep.lines, ...pathHits])], Boolean(grep.failed || tracked.failed), grep.why || tracked.why);
}

/** git argv for the `words` probe: files containing ALL the words, in any order. Pure so the self-test can inspect it. */
export function wordsProbeArgv(words) {
  return ["grep", "-lIi", "--all-match", ...words.flatMap((w) => ["-e", w]), "--", ...CONTENT_EXCLUSIONS];
}

export function probeSpecs(topic) {
  const variants = spellingVariants(topic);
  const strongVariants = [...new Set([...variants, ...stemVariants(topic)])];
  const words = significantWords(topic);
  const t = String(topic).toLowerCase();
  const anyVariant = (hay) => strongVariants.some((v) => hay.includes(v));
  const specs = [
    {
      id: "filename",
      strength: "strong",
      how: "a tracked FILE OR DIRECTORY named for it",
      run: () => {
        const r = trackedFiles();
        return probeResult(r.lines.filter((f) => anyVariant(f.toLowerCase())), r.failed, r.why);
      },
    },
    {
      id: "extension",
      strength: "strong",
      how: `a tracked file whose EXTENSION is it (.${t})`,
      run: () => {
        const r = trackedFiles();
        return probeResult(
          r.lines.filter((f) => variants.some((v) => f.toLowerCase().endsWith(`.${v}`))),
          r.failed,
          r.why,
        );
      },
    },
    {
      id: "ci",
      strength: "strong",
      how: "a CI WORKFLOW that builds or tests it",
      run: () => workflowFilesMentioning(strongVariants),
    },
    {
      id: "content",
      strength: "weak",
      how: "the WORD appears in tracked source",
      // `-e` makes the next argv element a pattern, so a leading '-' is data, not a flag.
      //
      // docs/ IS SEARCHED. It was excluded until 2026-08-24, and that exclusion
      // inverted this file's own design. The strength model above says a content
      // hit is WEAK and must yield INCONCLUSIVE — printed with its matches, for
      // the caller to read — precisely because this repository is full of
      // sentences naming things to disclaim them. Blinding the weak probe to the
      // docs tree did not make those disclaimers stop mattering; it turned "weak
      // hit -> inconclusive" into "no hit -> CORROBORATED", the strongest
      // safe-to-claim verdict this tool can return.
      //
      // That is a fail-open in the tool whose entire job is preventing a
      // fail-open, and the failure it was built for was DOCUMENTS asserting
      // absence — "a document asserted Android does not exist in any form".
      // It could not read documents.
      //
      // Caught live on 2026-08-24: `check:absence "retired label"` returned
      // CORROBORATED across all four probes, and a roster entry was rewritten to
      // say those labels are "named NOWHERE in this repository". The same grep
      // without the exclusion returns four files, three of them under docs/,
      // which discuss retired labels by name. Excluding a source of weak
      // evidence does not weaken the verdict — it strengthens it, wrongly.
      // Exclusions live in a named constant so the self-test can inspect the
      // ACTUAL pathspecs rather than a stringified function body. Asserting on
      // source text only ever catches the exact spelling someone last used:
      // `":!docs".includes("docs/")` is false, and a bare `:!docs` excludes the
      // tree just as thoroughly. That was a real hole in the first version of
      // the guard below.
      exclusions: CONTENT_EXCLUSIONS,
      // `git grep` exits 1 when nothing matched — a real empty result, not a failure.
      // Any other non-zero exit (or a git that will not spawn) is a probe that could
      // not run, and must push the verdict toward inconclusive.
      run: () => {
        const patternArgs = variants.flatMap((v) => ["-e", v]);
        const r = gitLines(["grep", "-lIi", ...patternArgs, "--", ...CONTENT_EXCLUSIONS], { emptyStatus: 1 });
        return probeResult(r.lines, r.failed, r.why);
      },
    },
  ];
  // A WEAK probe, so classify() is unchanged: a hit is INCONCLUSIVE, never REFUTED, and
  // CORROBORATED still needs every probe empty. Tracked files containing ALL the
  // significant words (any order, any suffix) plus tracked paths containing all of them.
  if (wordsProbeApplies(topic)) {
    specs.push({
      id: "words",
      strength: "weak",
      how: `a tracked file or path containing ALL of: ${words.join(", ")}`,
      run: () => combineWordsProbe(gitLines(wordsProbeArgv(words), { emptyStatus: 1 }), trackedFiles(), words),
    });
  }
  return specs;
}

export function classify(results) {
  // A hit is a hit however the other probes fared: presence needs one.
  if (results.some((r) => r.strength === "strong" && r.hits.length > 0)) return "refuted";
  // ABSENCE NEEDS EXHAUSTION, so a probe that could not RUN blocks corroboration. This
  // is the whole of F3: without it, `git` missing from PATH turned exit 2 into exit 0.
  if (results.some((r) => r.failed)) return "inconclusive";
  if (results.some((r) => r.strength === "weak" && r.hits.length > 0)) return "inconclusive";
  return "corroborated";
}

function selfTest() {
  const checks = [];
  // Assembled so the token is never a contiguous literal in this tracked file: the words
  // probe (all words in one file) would otherwise find this file and the absent-topic
  // cases could never corroborate.
  const NONSENSE = ["zz", "q"].join("");
  const spec = probeSpecs("android");

  checks.push(["four differently-shaped probes, no two the same id", new Set(spec.map((s) => s.id)).size === 4]);
  checks.push(["one probe looks at filenames and one at content", spec.some((s) => s.id === "filename") && spec.some((s) => s.id === "content")]);
  checks.push(["content evidence is classified WEAK, never strong", spec.find((s) => s.id === "content").strength === "weak"]);

  const strong = (hits) => ({ strength: "strong", hits });
  const weak = (hits) => ({ strength: "weak", hits });
  checks.push(["a FILE hit REFUTES the absence claim", classify([strong(["native/android/x.kt"]), weak([])]) === "refuted"]);
  checks.push([
    "A WORD-ONLY HIT IS INCONCLUSIVE, NOT REFUTED — a disclaimer naming a thing is not the thing",
    classify([strong([]), weak(["docs/COMPLIANCE.md"])]) === "inconclusive",
  ]);
  checks.push(["all probes empty CORROBORATES absence", classify([strong([]), weak([])]) === "corroborated"]);

  // Structural, so the shell cannot creep back in. CodeQL flagged the shell version of
  // this file as an indirect uncontrolled command line; the fix was to stop building
  // command strings at all, and that property is worth asserting rather than trusting.
  const src = readFileSync(fileURLToPath(import.meta.url), "utf8");
  const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  checks.push(["NO SHELL: the source calls execFileSync and never execSync", /execFileSync\(/.test(code) && !/[^A-Za-z]execSync\(/.test(code)]);
  // Plain string search, and assembled from parts so the assertion cannot match ITSELF —
  // the spelled-out literal would be the only occurrence in the file and the check would
  // always fail. String ops rather than a pattern, so the next check can be absolute.
  const squashed = code.split(/\s+/).join("");
  checks.push(["NO SHELL: no subprocess is given the shell option", !squashed.includes("shel" + "l:true")]);
  // CodeQL flagged `new RegExp(argv)` here as high-severity regex injection: a pattern
  // from the command line, run against every tracked path, is a backtracking shape. The
  // fix was to stop compiling patterns at all — `--patterns` now matches literal
  // substrings. This asserts the capability cannot come back, which is stronger than
  // asserting the current call site is safe.
  checks.push(["NO REGEX FROM INPUT: the file constructs no regular expressions at all", !squashed.includes("new" + "RegExp(")]);

  // Live, against this tree: the two claims that were actually made and were actually
  // wrong must both come back refuted.
  for (const topic of ["android", "tauri"]) {
    const res = probeSpecs(topic).map((s) => ({ ...s, ...s.run() }));
    checks.push([`LIVE: "${topic} does not exist" is refuted by this tree`, classify(res) === "refuted"]);
  }
  // …and a topic with no artifact must NOT come back refuted, or the tool is a rubber
  // stamp that says "false" to everything.
  // THE BLIND SPOT THAT SHIPPED A FALSE CLAIM. A topic living only in prose must
  // reach INCONCLUSIVE, never CORROBORATED. Before 2026-08-24 the content probe
  // excluded docs/, so this returned "safe to claim" on a topic named in four
  // tracked files. Asserted structurally AND live, because the structural half
  // alone would pass again the moment someone re-adds an exclusion elsewhere.
  // BOTH HALVES OF THIS GUARD WERE BROKEN IN THEIR FIRST VERSION, and a review
  // caught it the same day. Recorded because the failure is more instructive
  // than the fix: a guard written to stop a fail-open regressing could not
  // itself fail.
  //
  //   The structural half asserted `!run.toString().includes("docs/")`. But
  //   `":!docs".includes("docs/")` is FALSE, and a bare `:!docs` excludes the
  //   tree just as thoroughly — so re-adding the exclusion in a slightly
  //   different spelling sailed straight through. It tested the exact typo that
  //   was removed, not the property.
  //
  //   The live half asserted that the topic "retired label" produced content
  //   hits. That string appears THREE TIMES in this file, in the comments above
  //   describing this very fix — so `git grep` returned this file whether or not
  //   docs/ was excluded, and the assertion held either way. The test could not
  //   distinguish its two outcomes.
  //
  // Both now assert the PROPERTY. The structural half normalises real pathspecs;
  // the live half requires a hit whose PATH is under docs/, which is false the
  // moment docs/ stops being searched, self-reference or not.
  const contentSpec = probeSpecs("x").find((sp) => sp.id === "content");
  checks.push([
    "the content probe excludes no documentation tree, however the pathspec is spelled",
    Array.isArray(contentSpec.exclusions) &&
      !contentSpec.exclusions.some((e) => ["docs", "doc", "documentation"].includes(excludedDir(e))),
  ]);

  // THE TOPIC HERE CHANGED FROM "retired label" TO "phantom custody" ON 2026-09-14,
  // and the reason belongs next to the assertion rather than in a commit message.
  // Spelling-variant expansion (see spellingVariants) made "retired label" match
  // `docs/agent/launch-claims-retired-labels-ceiling.json` through the variant
  // `retired-label`, so the verdict escalated inconclusive -> refuted and this case
  // went red. That hit is CORRECT — a file named for retired labels is a file about
  // retired labels, and the old miss was the substring blindness this expansion fixes.
  // But the case exists to guard a property that is still live and still worth
  // guarding: a topic that exists ONLY in prose must reach INCONCLUSIVE, never
  // CORROBORATED, and its evidence must come from docs/. So the property is kept
  // verbatim and the topic is replaced with one that is genuinely prose-only under
  // every variant. Weakening the assertion to fit the new behaviour would have been
  // the test rewriting itself to agree with the change it was there to catch.
  const prose = probeSpecs("phantom custody").map((sp) => ({ ...sp, ...sp.run() }));
  const contentHits = prose.find((r) => r.id === "content").hits;
  checks.push([
    "LIVE: a prose topic is INCONCLUSIVE, and the evidence comes from docs/ — not from this file quoting itself",
    classify(prose) === "inconclusive" && contentHits.some((f) => String(f).startsWith("docs/")),
  ]);

  // SPELLING VARIANTS — the fail-open this expansion closes, asserted live.
  //
  // Reproduced 2026-09-14: `check:absence "decision record format"` returned
  // CORROBORATED ("Safe to claim") while scripts/check-decision-record-format.mjs was
  // tracked and a workflow ran it. Hyphenated, the same query returned REFUTED. The
  // repository did not differ; only the caller's spelling did, and the natural human
  // phrasing was the one that could not match.
  const vars = spellingVariants("decision record format");
  checks.push([
    "spellingVariants joins the words with every separator, and concatenated",
    ["decision record format", "decision-record-format", "decision_record_format", "decisionrecordformat"].every((v) =>
      vars.includes(v),
    ),
  ]);
  checks.push([
    "camelCase is split into words, so decisionRecordFormat is the same query",
    spellingVariants("decisionRecordFormat").includes("decision-record-format"),
  ]);
  checks.push([
    "LIVE: the spaced spelling of a tracked, hyphenated filename is REFUTED, not corroborated",
    classify(probeSpecs("decision record format").map((sp) => ({ ...sp, ...sp.run() }))) === "refuted",
  ]);
  // …and the expansion must not become a rubber stamp. Gluing two short words would
  // make a substring that matches half the tree, so the concatenated form is only
  // offered when it is long enough to be a real name.
  checks.push([
    "a short topic is NOT concatenated into a promiscuous substring",
    !spellingVariants("a b").includes("ab") && spellingVariants("a b").includes("a-b"),
  ]);

  // WORDS PROBE (backlog row: check:absence returned CORROBORATED for a multi-word topic
  // spelled differently from the identifier that enforces it). Measured 2026-10-08:
  // "agent frontmatter model gate" exited 0 "Safe to claim" while
  // scripts/check-skill-plane-conformance.mjs enforces exactly that. Every probe tested
  // each variant as ONE contiguous substring, so the words were never matched separately.
  const multi = probeSpecs("agent frontmatter model gate");
  checks.push(["a multi-word topic gets a fifth, WEAK `words` probe", multi.some((s) => s.id === "words" && s.strength === "weak")]);
  {
    const res = multi.map((s) => ({ ...s, ...s.run() }));
    const wordHits = res.find((r) => r.id === "words")?.hits ?? [];
    checks.push([
      "LIVE: a multi-word topic spelled differently from the enforcing identifier is NOT corroborated, and the words probe names that file",
      classify(res) !== "corroborated" && wordHits.includes("scripts/check-skill-plane-conformance.mjs"),
    ]);
  }
  checks.push(["a single-word topic gets no words probe (it is the content probe already)", !probeSpecs("android").some((s) => s.id === "words")]);
  {
    const words = significantWords("agent model tier gate");
    checks.push(["significantWords drops generic suffix nouns and tokens under 3 characters", JSON.stringify(words) === JSON.stringify(["agent", "model", "tier"]) && JSON.stringify(significantWords("an id gate check")) === "[]"]);
    const argv = wordsProbeArgv(["agent", "model", "tier"]);
    checks.push([
      "the word-probe argv carries --all-match and exactly one -e per word",
      argv.includes("--all-match") && argv.filter((a) => a === "-e").length === 3 && ["agent", "model", "tier"].every((w) => argv[argv.indexOf(w) - 1] === "-e"),
    ]);
    checks.push([
      "stem variants drop the generic noun only when two or more words remain",
      stemVariants("agent model tier gate").includes("agent-model-tier") && stemVariants("agent gate").length === 0 && stemVariants("agent model tier").length === 0,
    ]);
  }
  {
    // Review round 1: one significant word left after a generic noun is dropped.
    const one = probeSpecs("lessons gate");
    checks.push(["a two-word topic left with ONE significant word still gets the weak words probe", one.some((s) => s.id === "words" && s.strength === "weak")]);
    checks.push(["LIVE: 'lessons gate' is NOT corroborated while scripts/check-lessons.mjs exists", classify(one.map((s) => ({ ...s, ...s.run() }))) !== "corroborated"]);
    checks.push(["a plain single-word topic still gets no words probe", !wordsProbeApplies("android") && !wordsProbeApplies("gate check")]);
    // The two halves and the failure flag of the words probe, pinned.
    const g = { lines: ["a.txt"], failed: false, why: null };
    const tr = { lines: ["scripts/check-agent-model-tier.mjs", "x.md"], failed: false, why: null };
    const w3 = ["agent", "model", "tier"];
    checks.push(["words probe merges the grep half and the tracked-PATH half", JSON.stringify(combineWordsProbe(g, tr, w3).hits.sort()) === JSON.stringify(["a.txt", "scripts/check-agent-model-tier.mjs"])]);
    checks.push(["a failure in either half marks the words probe failed (never silently empty)", combineWordsProbe({ ...g, failed: true, why: "boom" }, tr, w3).failed === true && combineWordsProbe(g, { ...tr, failed: true, why: "boom" }, w3).failed === true && combineWordsProbe(g, tr, w3).failed === false]);
    // The grep half is CASE-INSENSITIVE: topicWords lowercases the topic, files do not.
    const tmp = mkdtempSync(join(tmpdir(), "absence-words-"));
    try {
      writeFileSync(join(tmp, "doc.md"), "Agent MODEL Tier\n");
      const git = (...a) => execFileSync("git", ["-C", tmp, ...a], { encoding: "utf8" });
      git("init", "-q");
      git("add", "-A");
      const hits = git(...wordsProbeArgv(w3)).split("\n").filter(Boolean);
      checks.push(["the words-probe grep matches capitalised content (case-insensitive)", JSON.stringify(hits) === JSON.stringify(["doc.md"])]);
    } catch (err) {
      checks.push([`the words-probe grep matches capitalised content (hermetic repo failed: ${err && err.message})`, false]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  {
    // A nonsense multi-word topic, assembled from parts, must still CORROBORATE: --all-match
    // needs every word in ONE file and the nonsense token is in none.
    const nonsense = [NONSENSE, "frobnicate", "quux", NONSENSE].join(" ");
    const res = probeSpecs(nonsense).map((s) => ({ ...s, ...s.run() }));
    checks.push(["LIVE: a multi-word nonsense topic assembled from parts still CORROBORATES", res.some((r) => r.id === "words") && classify(res) === "corroborated"]);
  }

  const fed = probeSpecs("fedramp").map((s) => ({ ...s, ...s.run() }));
  checks.push(['LIVE: "fedramp" is NOT refuted — mentions exist, artifacts do not', classify(fed) !== "refuted"]);

  // ── A PROBE THAT COULD NOT RUN (F3) ─────────────────────────────────────────
  // The arm that swallowed every git failure into `[]` had no self-test at all, which
  // is how the tool built to stop fail-opens shipped one. Pure, then live, then end to
  // end — the pure cases alone would stay green if the wiring were reverted.
  checks.push([
    "a FAILED probe is INCONCLUSIVE even when every probe is empty",
    classify([{ strength: "strong", hits: [], failed: true }, weak([])]) === "inconclusive",
  ]);
  checks.push([
    "a failed probe still yields REFUTED when another probe found a file",
    classify([{ strength: "strong", hits: [], failed: true }, strong(["native/android/x.kt"])]) === "refuted",
  ]);
  const bogus = gitLines(["ls-files", "--no-such-flag-exists"]);
  checks.push(["a git invocation that ERRORS reports failed, not empty", bogus.failed === true && bogus.lines.length === 0]);
  // git grep exits 1 on no-match. If that were read as a failure every clean topic would
  // be inconclusive and the tool would be useless — the opposite error, equally fatal.
  const nomatch = probeSpecs([NONSENSE, "no", "such", "topic", NONSENSE].join("-")).find((sp) => sp.id === "content").run();
  checks.push(["git grep finding NOTHING is an empty probe, not a failed one", nomatch.failed === false && nomatch.hits.length === 0]);

  // END TO END, both directions, on this tree: the reproduction that started this.
  // The topic is assembled from parts so the literal is not itself tracked content.
  const absentTopic = [NONSENSE, "no", "such", "topic", NONSENSE].join("-");
  const self = fileURLToPath(import.meta.url);
  const clean = spawnSync(process.execPath, [self, absentTopic], { cwd: REPO, encoding: "utf8" });
  const noGit = spawnSync(process.execPath, [self, absentTopic], {
    cwd: REPO,
    encoding: "utf8",
    env: { ...process.env, PATH: "/nonexistent-dir" },
  });
  checks.push(["LIVE: a genuinely absent topic still CORROBORATES (exit 0)", clean.status === 0]);
  checks.push([
    "LIVE: the same topic with git unreachable is INCONCLUSIVE (exit 2), never corroborated",
    noGit.status === 2 && !/CORROBORATED/.test(noGit.stdout ?? ""),
  ]);
  // Wiring control: the pure cases above cannot see a re-planted bare catch. Needle
  // assembled from parts so this line is not itself a match.
  checks.push([
    "no bare catch returns an empty array from a git probe",
    !code.split(/\s+/).join("").includes("catch{" + "return[];}"),
  ]);

  // THE EXCLUSIONS HIDE LOCKFILES AND dist/, NOT EVERY PATH THAT CONTAINS THOSE LETTERS
  // (plan row 61). The old globs `*lock*` / `*dist*` matched any path containing the
  // substring, so the content probe could not see docs/SMART_LOCKER_IDENTITY_CUSTODY_MODEL.md,
  // LockedIdleView.swift, .claude/hooks/block-dangerous.sh or distribution_sensitivity.py:
  // `check:absence SHALLOW_PATTERN` returned CORROBORATED for a word that is in the tree.
  // Hermetic: a throwaway repo, the REAL CONTENT_EXCLUSIONS, one canary in every file.
  {
    const canary = [NONSENSE, "canary", "row61"].join("-");
    const tmp = mkdtempSync(join(tmpdir(), "absence-excl-"));
    try {
      const put = (rel) => {
        mkdirSync(dirname(join(tmp, rel)), { recursive: true });
        writeFileSync(join(tmp, rel), `${canary}\n`);
      };
      const firstParty = [
        "docs/SMART_LOCKER_IDENTITY_CUSTODY_MODEL.md",
        "native/Views/LockedIdleView.swift",
        ".claude/hooks/block-dangerous.sh",
        "scripts/distribution_sensitivity.py",
        "lib/redistribute.ts",
      ];
      const excluded = [
        "pnpm-lock.yaml",
        "firmware/dock/core/Cargo.lock",
        "native/desktop/app/Cargo.lock",
        "native/desktop/core/Cargo.lock",
        "web/package-lock.json",
        "web/yarn.lock",
        "dist/bundle.js",
        "packages/a/dist/x.js",
        "a.js.map",
      ];
      for (const f of [...firstParty, ...excluded]) put(f);
      const git = (...a) => execFileSync("git", ["-C", tmp, ...a], { encoding: "utf8" });
      git("init", "-q");
      git("add", "-A");
      const hits = git("grep", "-lIi", "-e", canary, "--", ...CONTENT_EXCLUSIONS).split("\n").filter(Boolean).sort();
      checks.push([
        "EXCLUSIONS NARROW: first-party paths containing lock/dist are SEARCHED; pnpm-lock.yaml, the three Cargo.lock, package-lock, yarn.lock, dist/ and .map stay excluded",
        JSON.stringify(hits) === JSON.stringify([...firstParty].sort()),
      ]);
    } catch (err) {
      checks.push([`EXCLUSIONS NARROW: hermetic repo could not run (${err && err.message})`, false]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    checks.push([
      "EXCLUSIONS NARROW: no bare substring glob (*lock*, *dist*) survives in CONTENT_EXCLUSIONS",
      !CONTENT_EXCLUSIONS.some((e) => /^:!\*[a-z]+\*$/.test(e)),
    ]);
  }

  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

const argv = process.argv.slice(2);
if (argv.includes("--self-test")) process.exit(selfTest());

let specs;
let topic;
if (argv[0] === "--patterns") {
  const pats = argv.slice(1);
  if (pats.length === 0) {
    console.error("--patterns needs at least one pattern");
    process.exit(2);
  }
  topic = pats[0];
  // LITERAL substrings, not regular expressions. The first version compiled each pattern
  // with `new RegExp(p, "i")` and CodeQL flagged it high-severity: a pattern taken from
  // argv and then run against every tracked path is a catastrophic-backtracking shape,
  // and the regex was not earning that risk — every documented use ("AndroidManifest",
  // "build.gradle") is a plain substring. Removing the capability removes the class.
  specs = pats.map((p, i) => {
    const needle = String(p).toLowerCase();
    return {
      id: `pattern-${i + 1}`,
      strength: "strong",
      how: `a tracked file whose path contains "${p}"`,
      run: () => {
        const r = trackedFiles();
        return probeResult(r.lines.filter((f) => f.toLowerCase().includes(needle)), r.failed, r.why);
      },
    };
  });
} else {
  topic = argv[0];
  if (!topic) {
    console.error("usage: absence-check.mjs <topic> | --patterns <p>... | --self-test");
    process.exit(2);
  }
  specs = probeSpecs(topic);
}

console.log(`\n${B}Absence check${X} — "${topic}" — presence needs one hit, absence needs exhaustion\n`);

const results = specs.map((s) => ({ ...s, ...s.run() }));
for (const r of results) {
  // "unknown" is a THIRD tag on purpose: a probe that could not run must not print the
  // same word as a probe that ran and found nothing.
  const tag = r.failed
    ? `${R}unknown${X}`
    : r.hits.length === 0
      ? `${G}empty${X}`
      : r.strength === "strong"
        ? `${R}FOUND${X}`
        : `${Y}mentions${X}`;
  console.log(`  ${tag}  ${r.how}${r.hits.length ? `  ${B}${r.hits.length}${X}` : ""}`);
  if (r.failed) console.log(`          ${D}${r.why}${X}`);
  r.hits.slice(0, 5).forEach((f) => console.log(`          ${D}${f}${X}`));
  if (r.hits.length > 5) console.log(`          ${D}… and ${r.hits.length - 5} more${X}`);
}

const verdict = classify(results);
console.log("");
if (verdict === "refuted") {
  console.log(`${R}${B}✗ REFUTED${X} — a file exists. Do not write "does not exist".\n`);
  process.exit(1);
}
if (verdict === "inconclusive") {
  const broken = results.filter((r) => r.failed);
  if (broken.length > 0) {
    console.log(
      `${Y}${B}? INCONCLUSIVE${X} — ${broken.length} of ${results.length} probe(s) COULD NOT RUN, so this\n` +
        `  search was never exhaustive and absence cannot be corroborated from it:\n` +
        broken.map((r) => `          ${D}${r.why}${X}`).join("\n") +
        `\n  Fix the probe and re-run before writing anything about absence.\n`,
    );
  } else {
    console.log(
      `${Y}${B}? INCONCLUSIVE${X} — no file, but the word appears in source. That may be a\n` +
        `  catalogue entry or a disclaimer rather than the thing itself. READ the matches\n` +
        `  above before claiming absence, and say in your claim which you found.\n`,
    );
  }
  process.exit(2);
}
console.log(`${G}${B}✓ CORROBORATED${X} across ${results.length} differently-shaped probes. Safe to claim — cite them.\n`);
