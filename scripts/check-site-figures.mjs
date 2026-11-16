// check-site-figures.mjs — a number on the shipping site is bound to the artifact it counts.
//
//   node scripts/check-site-figures.mjs              # gate
//   node scripts/check-site-figures.mjs --self-test  # prove it can fail
//
// WHY THIS EXISTS. `check-proof-figures.mjs` (guard:figures) holds figures in
// docs/**/*.md — comma-formatted values of 1,000 and up. A bare "17" in a .tsx
// is outside both its scope and its shape, yet docs/agent/CLAIM_INVENTORY.json
// said the site's "17 core signal categories" was "guarded by guard:figures".
// It was not guarded by anything. Beside it, "SIGNALS FUSED 7" sat over a
// four-row array and "16 candidate source categories" matched no artifact the
// inventory could name. A true number with a false provenance claim is drift
// wearing a badge; this gate is the badge.
//
// Each figure below names the SOURCE it must equal and the SITES that quote
// it. The source is parsed from the tree, never restated here, so the gate
// cannot fossilise alongside the figure. Every site must carry the figure as
// written — a missing site is a fossil in this table and is fatal.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Count the string entries of an exported array literal in a TS source. */
export function countExportedArray(src, name) {
  const m = src.match(new RegExp(String.raw`export const ${name}\s*(?::[^=]+)?=\s*\[([\s\S]*?)\]`));
  if (!m) throw new Error(`no exported array "${name}" found`);
  return (m[1].match(/"[^"]+"/g) ?? []).length;
}

/** Count the DISTINCT `category: "…"` values in a source. */
export function countDistinctCategories(src) {
  return new Set([...src.matchAll(/category:\s*"([^"]+)"/g)].map((m) => m[1])).size;
}

export const FIGURES = [
  {
    label: "core signal categories",
    source: { file: "lib/signal-radar/src/index.ts", derive: (s) => countExportedArray(s, "EVALUATED_CATEGORIES") },
    sites: [
      { file: "artifacts/signalgrid-web/src/components/sections/HeroSection.tsx", pattern: (n) => new RegExp(String.raw`label:\s*"CORE SIGNAL CATEGORIES",\s*value:\s*"${n}"`) },
      { file: "artifacts/signalgrid-web/src/components/sections/IntegrationsSection.tsx", pattern: (n) => new RegExp(String.raw`value:\s*"${n}",\s*label:\s*"Core signal categories"`) },
    ],
  },
  {
    label: "candidate source categories (the integrations catalog's distinct categories)",
    source: { file: "artifacts/api-server/src/routes/integrations.ts", derive: countDistinctCategories },
    sites: [
      { file: "artifacts/signalgrid-web/src/components/sections/IntegrationsSection.tsx", pattern: (n) => new RegExp(String.raw`${n} Candidate Source Categories`) },
      { file: "artifacts/signalgrid-web/src/components/sections/IntegrationsSection.tsx", pattern: (n) => new RegExp(String.raw`value:\s*"${n}",\s*label:\s*"Candidate source categories`) },
      { file: "artifacts/signalgrid-web/src/pages/Pricing.tsx", pattern: (n) => new RegExp(String.raw`"${n} candidate source categories"`) },
    ],
  },
];

/** Judge one figure against the tree. Returns { n, problems[] }. */
export function judgeFigure(fig, read) {
  const problems = [];
  let n;
  try {
    n = fig.source.derive(read(fig.source.file));
  } catch (e) {
    return { n: undefined, problems: [`${fig.label}: source ${fig.source.file} unreadable or unparseable — ${e.message}`] };
  }
  if (!Number.isInteger(n) || n <= 0) problems.push(`${fig.label}: source ${fig.source.file} derived ${n}, which is not a positive count`);
  for (const site of fig.sites) {
    let text;
    try { text = read(site.file); } catch { problems.push(`${fig.label}: site ${site.file} unreadable`); continue; }
    if (!site.pattern(n).test(text)) problems.push(`${fig.label}: ${site.file} does not carry "${n}" in the expected place — the source says ${n}`);
  }
  return { n, problems };
}

function selfTest() {
  const checks = [];
  const t = (name, ok) => checks.push([name, ok]);
  t("counts the entries of an exported array", countExportedArray(`export const X = [\n "a",\n "b", "c"\n];`, "X") === 3);
  t("a typed export is counted too", countExportedArray(`export const X: readonly string[] = ["a"];`, "X") === 1);
  t("counts DISTINCT categories, not rows", countDistinctCategories(`category: "A",\n category: "B",\n category: "A"`) === 2);
  const files = {
    "src.ts": `export const EVALUATED_CATEGORIES = ["a","b","c"];`,
    "hero.tsx": `{ label: "CORE SIGNAL CATEGORIES", value: "3" },`,
    "int.tsx": `{ value: "3", label: "Core signal categories" },`,
  };
  const fig = { ...FIGURES[0], source: { file: "src.ts", derive: (s) => countExportedArray(s, "EVALUATED_CATEGORIES") }, sites: [
    { file: "hero.tsx", pattern: FIGURES[0].sites[0].pattern },
    { file: "int.tsx", pattern: FIGURES[0].sites[1].pattern },
  ] };
  const read = (f) => { if (!(f in files)) throw new Error("missing"); return files[f]; };
  t("a site carrying the source's count passes", judgeFigure(fig, read).problems.length === 0);
  t("a site carrying a STALE count is caught", judgeFigure(fig, (f) => (f === "hero.tsx" ? `{ label: "CORE SIGNAL CATEGORIES", value: "17" },` : read(f))).problems.length === 1);
  t("an unreadable source is a problem, not a skip", judgeFigure(fig, (f) => (f === "src.ts" ? (() => { throw new Error("gone"); })() : read(f))).problems.length === 1);
  t("an unreadable site is a problem, not a skip", judgeFigure(fig, (f) => (f === "int.tsx" ? (() => { throw new Error("gone"); })() : read(f))).problems.length === 1);
  // Non-vacuity: every real source parses to a positive count.
  for (const f of FIGURES) {
    const r = judgeFigure(f, (p) => readFileSync(resolve(repo, p), "utf8"));
    t(`real source for "${f.label}" derives a positive count (${r.n})`, Number.isInteger(r.n) && r.n > 0);
  }
  const failed = checks.filter(([, ok]) => !ok);
  for (const [n, ok] of checks) console.log(`  ${ok ? "✓" : "✗"} ${n}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv.includes("--self-test")) process.exit(selfTest());

const read = (p) => readFileSync(resolve(repo, p), "utf8");
const problems = [];
const lines = [];
for (const fig of FIGURES) {
  const r = judgeFigure(fig, read);
  problems.push(...r.problems);
  lines.push(`  ${fig.label}: ${r.n} (from ${fig.source.file}; ${fig.sites.length} site(s))`);
}
console.log(`site figures: ${FIGURES.length} figure(s) bound to their sources`);
for (const l of lines) console.log(l);
if (problems.length > 0) {
  console.error(`\n✗ ${problems.length} figure drift(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error("\n  Change the site to match the source, or change the source and let the site follow — never restate the number here.");
  process.exit(1);
}
console.log("Site-figure gate passed — every bound number on the site matches the artifact it counts.");
