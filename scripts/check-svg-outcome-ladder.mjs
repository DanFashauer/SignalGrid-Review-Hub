#!/usr/bin/env node
// SVG outcome ladder — a rendered decision ladder must be THE ladder.
//
// `docs/assets/signalgrid-ecosystem-positioning.svg` — embedded in
// docs/ECOSYSTEM_POSITIONING.md, a page corrected twice for retired framing —
// rendered five outcome chips: Allow · Step-Up · Deny · Remediate · Record. The
// ratified vocabulary is four (CLAUDE.md golden rule 3, `check-decision-vocabulary.mjs`:
// allow · step_up · restrict · deny). `restrict`, the rung that exists for the
// tightening case, was missing; `Remediate` — on the never-claim list — and `Record`
// were drawn in its place. No gate opened an `.svg`: the vocabulary gate scans
// lib/artifacts/native/scripts, the launch-claims scan filters `.md|.html`, the HTML
// figure gate reads `.html` (twelfth audit round, 2026-09-06).
//
// THE RULE, narrow on purpose: every `<text class="outcome">` chip in a tracked SVG
// under docs/ must spell one of the four ladder rungs, and a file that draws a ladder
// at all must draw all four. Prose inside <desc>/<title> is not read here — that is
// the retired-label scan's job — and no figure is derived from an image.
//
//   node scripts/check-svg-outcome-ladder.mjs [--self-test]

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The ladder, in the spellings a rendered chip may use (case-insensitive; `-`/`_`/space equivalent). */
export const LADDER = ["allow", "step_up", "restrict", "deny"];

/** Pure: normalise a chip label to the ladder's spelling. */
export function normaliseChip(label) {
  return label.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/** Pure: the outcome chips a document draws, in order. */
export function outcomeChipsIn(svg) {
  return [...svg.matchAll(/<text\b[^>]*\bclass="[^"]*\boutcome\b[^"]*"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
}

/** Pure audit over { [path]: svgText }. */
export function auditLadders(files) {
  const fatal = [];
  let ladders = 0;
  for (const [path, svg] of Object.entries(files)) {
    const chips = outcomeChipsIn(svg);
    if (chips.length === 0) continue;
    ladders += 1;
    const norm = chips.map(normaliseChip);
    for (let i = 0; i < chips.length; i += 1) {
      if (!LADDER.includes(norm[i])) fatal.push(`${path}: draws an outcome chip "${chips[i]}" that is not on the ladder (allow · step_up · restrict · deny)`);
    }
    for (const rung of LADDER) {
      if (!norm.includes(rung)) fatal.push(`${path}: draws a decision ladder without "${rung}" — a rendered ladder must be the whole ladder`);
    }
  }
  return { fatal, ladders, scanned: Object.keys(files).length };
}

function loadSvgs() {
  const out = {};
  const files = execSync("git ls-files -- 'docs/*.svg' 'docs/**/*.svg'", { cwd: repoRoot, encoding: "utf8" }).split("\n").filter(Boolean);
  for (const rel of files) {
    try {
      out[rel] = readFileSync(join(repoRoot, rel), "utf8");
    } catch {
      out[rel] = "";
    }
  }
  return out;
}

function selfTest() {
  const checks = [];
  const chip = (t) => `<text x="1" y="1" class="outcome">${t}</text>`;
  const good = `<svg>${chip("Allow")}${chip("Step-Up")}${chip("Restrict")}${chip("Deny")}</svg>`;
  let r = auditLadders({ "docs/a.svg": good });
  checks.push(["the four-rung ladder passes (positive control)", r.fatal.length === 0 && r.ladders === 1]);
  r = auditLadders({ "docs/a.svg": good.replace(chip("Restrict"), chip("Remediate")) + chip("Record") });
  checks.push(["THE PLANTED MISS: Remediate/Record drawn and Restrict omitted — the shipped defect — is FATAL on both counts",
    r.fatal.some((f) => f.includes('"Remediate"')) && r.fatal.some((f) => f.includes('"Record"')) && r.fatal.some((f) => f.includes('without "restrict"'))]);
  r = auditLadders({ "docs/a.svg": `<svg>${chip("allow")}${chip("step_up")}${chip("RESTRICT")}${chip("Deny")}</svg>` });
  checks.push(["case and separator spellings are equivalent (Step-Up, step_up, STEP UP)", r.fatal.length === 0]);
  r = auditLadders({ "docs/a.svg": '<svg><text class="title">Where SignalGrid Fits</text><text class="small">Allow</text></svg>' });
  checks.push(["text that is not an outcome chip is not a ladder — a title or caption saying Allow is not read", r.ladders === 0 && r.fatal.length === 0]);
  const live = auditLadders(loadSvgs());
  checks.push(["LIVE: at least one tracked SVG under docs/ draws a ladder, and every ladder is the ladder", live.ladders >= 1 && live.fatal.length === 0]);
  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) process.exit(selfTest());
  const r = auditLadders(loadSvgs());
  console.log(`SVG outcome ladder — ${r.scanned} tracked SVG(s) under docs/, ${r.ladders} draw(s) a decision ladder.`);
  if (r.fatal.length > 0) {
    console.error(`\nSVG-outcome-ladder check FAILED: ${r.fatal.length} problem(s).`);
    for (const f of r.fatal) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("SVG-outcome-ladder check passed — every rendered ladder is allow · step_up · restrict · deny, nothing more and nothing less.");
}
