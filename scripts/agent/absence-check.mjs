#!/usr/bin/env node
// Absence check — "it does not exist" is the claim that needs the most evidence and
// usually gets the least.
//
//   node scripts/agent/absence-check.mjs android
//   node scripts/agent/absence-check.mjs --patterns 'AndroidManifest' 'build.gradle'
//   node scripts/agent/absence-check.mjs --self-test
//
// THE FAILURE THIS PREVENTS (real, twice, 2026-08-08 and 2026-08-12). A document
// asserted "Android does not exist in any form." A native Android app was sitting in
// `native/android/`. The search that produced the claim used ONE pattern shape. A
// second document asserted the dock firmware was absent on the strength of a search for
// `.ino`/`.c`/`.cpp`/`.h` — the firmware is Rust, so that search could not have found
// it whether or not it existed. Both claims then propagated into planning documents and
// cost real time.
//
// THE RULE: presence needs one hit; absence needs exhaustion. One empty grep is
// evidence about that grep.
//
// STRENGTH IS NOT UNIFORM, AND CONFLATING IT IS THE SAME BUG WEARING A MASK. A probe
// that finds a FILE is strong: the thing is here. A probe that finds the WORD is weak —
// this repository is full of sentences naming things precisely to disclaim them, and a
// catalogue of compliance frameworks mentions FedRAMP without a FedRAMP artifact
// existing anywhere. The first version of this tool treated those alike and reported
// "ABSENCE CLAIM IS FALSE" for `fedramp`, which would have blocked a true statement.
// So content-only hits are INCONCLUSIVE, printed with their matching lines, and the
// caller reads them. A tool that cries wolf on true claims gets ignored on false ones.
//
// EXIT CODES:  0 = absence corroborated   1 = refuted (a file exists)   2 = inconclusive
import { execSync } from "node:child_process";

const G = "\x1b[32m", R = "\x1b[31m", Y = "\x1b[33m", B = "\x1b[1m", D = "\x1b[2m", X = "\x1b[0m";

const sh = (c) => {
  try {
    return execSync(c, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  } catch {
    return "";
  }
};
// Single-quoted for the shell so a pattern beginning with '-' is never read as a flag.
const q = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;
const lines = (s) => (s ? s.trim().split("\n").filter(Boolean) : []);

/**
 * Genuinely different SHAPES, not narrowings of one pattern. The tool this replaces
 * derived [t, \.t$, t/, "t", t_, -t] — every one of which is a subset of the first, so
 * six probes could only ever agree with each other. These four look in different places.
 *
 * Pure and exported so the self-test drives the same construction the tool does.
 */
export function probeSpecs(topic) {
  const t = String(topic);
  return [
    { id: "filename", strength: "strong", how: `a tracked FILE OR DIRECTORY named for it`, cmd: `git ls-files | grep -iE -e ${q(t)}` },
    { id: "extension", strength: "strong", how: `a tracked file whose EXTENSION is it (.${t})`, cmd: `git ls-files | grep -iE -e ${q(`\\.${t}$`)}` },
    { id: "ci", strength: "strong", how: `a CI WORKFLOW that builds or tests it`, cmd: `grep -rli -e ${q(t)} .github/workflows 2>/dev/null` },
    { id: "content", strength: "weak", how: `the WORD appears in tracked source`, cmd: `git grep -lIi -e ${q(t)} -- ':!*lock*' ':!*dist*' ':!*.map' ':!docs/*'` },
  ];
}

export function classify(results) {
  const strongHits = results.filter((r) => r.strength === "strong" && r.hits.length > 0);
  const weakHits = results.filter((r) => r.strength === "weak" && r.hits.length > 0);
  if (strongHits.length > 0) return "refuted";
  if (weakHits.length > 0) return "inconclusive";
  return "corroborated";
}

function selfTest() {
  const checks = [];
  const spec = probeSpecs("android");

  checks.push(["probes are differently shaped — no two share a command", new Set(spec.map((s) => s.cmd)).size === spec.length]);
  checks.push(["at least one probe looks at filenames and one at content", spec.some((s) => s.id === "filename") && spec.some((s) => s.id === "content")]);
  checks.push(["content evidence is classified WEAK, never strong", spec.find((s) => s.id === "content").strength === "weak"]);

  const strong = (hits) => ({ strength: "strong", hits });
  const weak = (hits) => ({ strength: "weak", hits });
  checks.push(["a FILE hit REFUTES the absence claim", classify([strong(["native/android/x.kt"]), weak([])]) === "refuted"]);
  checks.push([
    "A WORD-ONLY HIT IS INCONCLUSIVE, NOT REFUTED — a disclaimer naming a thing is not the thing",
    classify([strong([]), weak(["docs/COMPLIANCE.md"])]) === "inconclusive",
  ]);
  checks.push(["all probes empty CORROBORATES absence", classify([strong([]), weak([])]) === "corroborated"]);
  checks.push([
    "a pattern beginning with '-' is quoted, not read as a flag",
    probeSpecs("-rf").every((s) => !/\s-rf\b/.test(s.cmd.replace(/'-rf'/g, ""))),
  ]);

  // Live end-to-end, against this tree: the two claims that were actually made and
  // were actually wrong must both come back refuted.
  for (const topic of ["android", "tauri"]) {
    const res = probeSpecs(topic).map((s) => ({ ...s, hits: lines(sh(s.cmd)) }));
    checks.push([`LIVE: "${topic} does not exist" is refuted by this tree`, classify(res) === "refuted"]);
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
  specs = pats.map((p, i) => ({
    id: `pattern-${i + 1}`,
    strength: "strong",
    how: `a tracked file matching /${p}/i`,
    cmd: `git ls-files | grep -iE -e ${q(p)}`,
  }));
} else {
  topic = argv[0];
  if (!topic) {
    console.error('usage: absence-check.mjs <topic> | --patterns <p>... | --self-test');
    process.exit(2);
  }
  specs = probeSpecs(topic);
}

console.log(`\n${B}Absence check${X} — "${topic}" — presence needs one hit, absence needs exhaustion\n`);

const results = specs.map((s) => ({ ...s, hits: lines(sh(s.cmd)) }));
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
