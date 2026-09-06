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
import { readFileSync, readdirSync, existsSync } from "node:fs";
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

function workflowFilesMentioning(needle) {
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
      if (readFileSync(join(dir, f), "utf8").toLowerCase().includes(needle)) hits.push(`.github/workflows/${f}`);
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
const CONTENT_EXCLUSIONS = [":!*lock*", ":!*dist*", ":!*.map"];

/** A pathspec's bare directory, so ':!docs', ':!docs/*' and ':!docs/**' all normalise to 'docs'. */
export function excludedDir(pathspec) {
  return String(pathspec).replace(/^:!/, "").replace(/\/\*{1,2}$/, "").replace(/\/$/, "").toLowerCase();
}

export function probeSpecs(topic) {
  const t = String(topic).toLowerCase();
  return [
    {
      id: "filename",
      strength: "strong",
      how: "a tracked FILE OR DIRECTORY named for it",
      run: () => {
        const r = trackedFiles();
        return probeResult(r.lines.filter((f) => f.toLowerCase().includes(t)), r.failed, r.why);
      },
    },
    {
      id: "extension",
      strength: "strong",
      how: `a tracked file whose EXTENSION is it (.${t})`,
      run: () => {
        const r = trackedFiles();
        return probeResult(r.lines.filter((f) => f.toLowerCase().endsWith(`.${t}`)), r.failed, r.why);
      },
    },
    {
      id: "ci",
      strength: "strong",
      how: "a CI WORKFLOW that builds or tests it",
      run: () => workflowFilesMentioning(t),
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
        const r = gitLines(["grep", "-lIi", "-e", String(topic), "--", ...CONTENT_EXCLUSIONS], { emptyStatus: 1 });
        return probeResult(r.lines, r.failed, r.why);
      },
    },
  ];
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

  const prose = probeSpecs("retired label").map((sp) => ({ ...sp, ...sp.run() }));
  const contentHits = prose.find((r) => r.id === "content").hits;
  checks.push([
    "LIVE: a prose topic is INCONCLUSIVE, and the evidence comes from docs/ — not from this file quoting itself",
    classify(prose) === "inconclusive" && contentHits.some((f) => String(f).startsWith("docs/")),
  ]);

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
  const nomatch = probeSpecs(["zzq", "no", "such", "topic", "zzq"].join("-")).find((sp) => sp.id === "content").run();
  checks.push(["git grep finding NOTHING is an empty probe, not a failed one", nomatch.failed === false && nomatch.hits.length === 0]);

  // END TO END, both directions, on this tree: the reproduction that started this.
  // The topic is assembled from parts so the literal is not itself tracked content.
  const absentTopic = ["zzq", "no", "such", "topic", "zzq"].join("-");
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
