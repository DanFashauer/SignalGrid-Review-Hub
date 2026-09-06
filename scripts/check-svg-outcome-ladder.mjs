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
// at all must draw all four. Prose inside <desc>/<title> is not read here — since
// 2026-09-06 the retired-label scan in check-launch-claims.mjs opens docs/**/*.svg
// (before that date this comment delegated to a scan whose scope was `.html|.md`,
// a handoff to nobody) — and no figure is derived from an image.
//
// SECOND RULE (2026-09-06): adjacent rungs must be tellable apart. Each chip's fill is
// the `<rect fill="#rrggbb">` immediately before its <text>. Neighbouring fills must
// differ by at least ΔE*ab 20 (CIE76, sRGB→Lab, D65) — Step-Up and Restrict shipped as
// two ambers at ΔE 11.0, while green beside yellow is ΔE 51.6; a luminance-contrast
// rule was tried first and could not tell green from yellow (1.41:1) while every chip
// must also hold dark text, so it was the wrong measure. Chip text (#171412) must clear
// WCAG AA 4.5:1 on every fill. A ladder whose rungs cannot be told apart is a ladder
// with fewer rungs than it draws. NOT gated: geometry (arrow targets, centring) — a
// coordinate assertion on a hand-drawn diagram fires on every redesign and gets
// overridden.
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

/** Pure: the fill of the <rect> immediately preceding each outcome chip, in chip order (null when none). */
export function chipFillsIn(svg) {
  return [...svg.matchAll(/<rect\b[^>]*\bfill="(#[0-9a-fA-F]{6})"[^>]*\/>\s*<text\b[^>]*\bclass="[^"]*\boutcome\b[^"]*"[^>]*>/g)].map((m) => m[1].toLowerCase());
}

/** Pure: WCAG relative luminance of #rrggbb. */
export function luminance(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** Pure: WCAG contrast ratio between two #rrggbb colours. */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Pure: CIE L*a*b* (D65) of #rrggbb. */
export function lab(hex) {
  const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [X, Y, Z].map(f);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Pure: CIE76 colour difference ΔE*ab between two #rrggbb colours. */
export function deltaE(a, b) {
  const [p, q] = [lab(a), lab(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

export const CHIP_TEXT = "#171412";
export const NEIGHBOUR_MIN_DELTA_E = 20;
export const TEXT_MIN = 4.5;

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
    const fills = chipFillsIn(svg);
    if (fills.length !== chips.length) {
      fatal.push(`${path}: ${chips.length} outcome chip(s) but ${fills.length} with a <rect fill="#rrggbb"> immediately before the chip — every rung needs a fill this check can read`);
      continue;
    }
    fills.forEach((f, i) => {
      const t = contrast(f, CHIP_TEXT);
      if (t < TEXT_MIN) fatal.push(`${path}: chip "${chips[i]}" fill ${f} gives text ${CHIP_TEXT} only ${t.toFixed(2)}:1 (WCAG AA needs ${TEXT_MIN}:1)`);
      if (i > 0) {
        const n = deltaE(fills[i - 1], f);
        if (n < NEIGHBOUR_MIN_DELTA_E) fatal.push(`${path}: neighbouring rungs "${chips[i - 1]}" (${fills[i - 1]}) and "${chips[i]}" (${f}) differ by ΔE ${n.toFixed(1)} — below ${NEIGHBOUR_MIN_DELTA_E}, two rungs a reader cannot tell apart`);
      }
    });
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
  const FILLS = { Allow: "#72b989", "Step-Up": "#e9c65f", Restrict: "#d9843f", Deny: "#c7645c" };
  const chip = (t, fill = FILLS[t] ?? FILLS[t.replace(/_/g, "-").replace(/^\w/, (c) => c.toUpperCase())] ?? "#72b989") =>
    `<rect x="0" y="0" width="1" height="1" fill="${fill}"/><text x="1" y="1" class="outcome">${t}</text>`;
  const good = `<svg>${chip("Allow")}${chip("Step-Up")}${chip("Restrict")}${chip("Deny")}</svg>`;
  let r = auditLadders({ "docs/a.svg": good });
  checks.push(["the four-rung ladder passes (positive control)", r.fatal.length === 0 && r.ladders === 1]);
  r = auditLadders({ "docs/a.svg": good.replace(chip("Restrict"), chip("Remediate", "#d9843f")) + chip("Record", "#72b989") });
  checks.push(["THE PLANTED MISS: Remediate/Record drawn and Restrict omitted — the shipped defect — is FATAL on both counts",
    r.fatal.some((f) => f.includes('"Remediate"')) && r.fatal.some((f) => f.includes('"Record"')) && r.fatal.some((f) => f.includes('without "restrict"'))]);
  r = auditLadders({ "docs/a.svg": `<svg>${chip("allow", "#72b989")}${chip("step_up", "#e9c65f")}${chip("RESTRICT", "#d9843f")}${chip("Deny")}</svg>` });
  checks.push(["case and separator spellings are equivalent (Step-Up, step_up, STEP UP)", r.fatal.length === 0]);
  r = auditLadders({ "docs/a.svg": `<svg>${chip("Allow")}${chip("Step-Up", "#d6a85b")}${chip("Restrict", "#c98f3e")}${chip("Deny")}</svg>` });
  checks.push(["THE PLANTED PAIR: the two ambers that shipped (#d6a85b / #c98f3e, ΔE 11.0) are FATAL as neighbours a reader cannot tell apart",
    r.fatal.length === 1 && /neighbouring rungs "Step-Up" \(#d6a85b\) and "Restrict" \(#c98f3e\) differ by ΔE 11\.0/.test(r.fatal[0])]);
  checks.push(["green beside yellow is far apart (ΔE > 40) even though their luminance contrast is only 1.41:1 — the measure that was wrong is recorded",
    deltaE("#72b989", "#e9c65f") > 40 && contrast("#72b989", "#e9c65f") < 1.5]);
  r = auditLadders({ "docs/a.svg": `<svg>${chip("Allow")}${chip("Step-Up")}${chip("Restrict")}${chip("Deny", "#7a2e2a")}</svg>` });
  checks.push(["a fill too dark for the chip text (#7a2e2a under #171412) is FATAL at WCAG AA", r.fatal.length === 1 && /only \d\.\d\d:1 \(WCAG AA needs 4\.5:1\)/.test(r.fatal[0])]);
  r = auditLadders({ "docs/a.svg": `<svg>${chip("Allow")}${chip("Step-Up")}${chip("Restrict")}<text class="outcome">Deny</text></svg>` });
  checks.push(["a chip with no readable <rect fill> before it is FATAL — a rung this check cannot read is not a pass", r.fatal.length === 1 && /4 outcome chip\(s\) but 3 with a <rect fill/.test(r.fatal[0])]);
  checks.push(["contrast arithmetic: white on black is 21:1, a colour against itself is 1:1", Math.abs(contrast("#ffffff", "#000000") - 21) < 0.01 && contrast("#e9c65f", "#e9c65f") === 1]);
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
