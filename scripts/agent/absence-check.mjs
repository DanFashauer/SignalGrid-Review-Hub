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
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const G = "\x1b[32m", R = "\x1b[31m", Y = "\x1b[33m", B = "\x1b[1m", D = "\x1b[2m", X = "\x1b[0m";

/** Every subprocess: argv array, never a command string. No shell is ever spawned. */
function gitLines(args) {
  try {
    const out = execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return out ? out.trim().split("\n").filter(Boolean) : [];
  } catch {
    return [];
  }
}

const trackedFiles = () => gitLines(["ls-files"]);

function workflowFilesMentioning(needle) {
  const dir = join(REPO, ".github/workflows");
  if (!existsSync(dir)) return [];
  const hits = [];
  for (const f of readdirSync(dir)) {
    if (!/\.ya?ml$/.test(f)) continue;
    try {
      if (readFileSync(join(dir, f), "utf8").toLowerCase().includes(needle)) hits.push(`.github/workflows/${f}`);
    } catch {
      /* unreadable file is not evidence either way */
    }
  }
  return hits;
}

/**
 * Genuinely different SHAPES, not narrowings of one pattern. An earlier version derived
 * [t, \.t$, t/, "t", t_, -t] — every one a subset of the first, so six probes could only
 * ever agree with each other. These four look in different places.
 */
export function probeSpecs(topic) {
  const t = String(topic).toLowerCase();
  return [
    {
      id: "filename",
      strength: "strong",
      how: "a tracked FILE OR DIRECTORY named for it",
      run: () => trackedFiles().filter((f) => f.toLowerCase().includes(t)),
    },
    {
      id: "extension",
      strength: "strong",
      how: `a tracked file whose EXTENSION is it (.${t})`,
      run: () => trackedFiles().filter((f) => f.toLowerCase().endsWith(`.${t}`)),
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
      run: () => gitLines(["grep", "-lIi", "-e", String(topic), "--", ":!*lock*", ":!*dist*", ":!*.map", ":!docs/*"]),
    },
  ];
}

export function classify(results) {
  if (results.some((r) => r.strength === "strong" && r.hits.length > 0)) return "refuted";
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
    const res = probeSpecs(topic).map((s) => ({ ...s, hits: s.run() }));
    checks.push([`LIVE: "${topic} does not exist" is refuted by this tree`, classify(res) === "refuted"]);
  }
  // …and a topic with no artifact must NOT come back refuted, or the tool is a rubber
  // stamp that says "false" to everything.
  const fed = probeSpecs("fedramp").map((s) => ({ ...s, hits: s.run() }));
  checks.push(['LIVE: "fedramp" is NOT refuted — mentions exist, artifacts do not', classify(fed) !== "refuted"]);

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
      run: () => trackedFiles().filter((f) => f.toLowerCase().includes(needle)),
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

const results = specs.map((s) => ({ ...s, hits: s.run() }));
for (const r of results) {
  const tag = r.hits.length === 0 ? `${G}empty${X}` : r.strength === "strong" ? `${R}FOUND${X}` : `${Y}mentions${X}`;
  console.log(`  ${tag}  ${r.how}${r.hits.length ? `  ${B}${r.hits.length}${X}` : ""}`);
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
  console.log(
    `${Y}${B}? INCONCLUSIVE${X} — no file, but the word appears in source. That may be a\n` +
      `  catalogue entry or a disclaimer rather than the thing itself. READ the matches\n` +
      `  above before claiming absence, and say in your claim which you found.\n`,
  );
  process.exit(2);
}
console.log(`${G}${B}✓ CORROBORATED${X} across ${results.length} differently-shaped probes. Safe to claim — cite them.\n`);
