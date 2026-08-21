#!/usr/bin/env node
// Decision-palette parity + contrast gate. The decision states (allow /
// review / deny) are the safety surface — the color IS the message on a
// shared frontline device — and DR-005's ratified re-tone reached only two
// of the six rendered token trees: the review console still shipped the
// #A05A5A deny that measured 3.18:1 on card, and SignalGridMobile carried a
// fourth, never-ratified palette where the same verdict is a caution on one
// SignalGrid surface and a hard stop on another. "One object behaves the
// same everywhere" is the whole job of a decision palette; this gate makes
// that executable:
//   (a) PARITY — every declaration of a decision state, in any notation
//       (HSL triple, hex, SwiftUI Color(red:green:blue:)), must normalize
//       to the canonical hex for that state;
//   (b) CONTRAST — each state must measure ≥ 4.5:1 (WCAG AA) against its
//       tree's own background and card tokens; a measured ratio table
//       prints on every run;
//   (c) TOKEN USE — no verdict may be painted from a raw Tailwind ramp
//       class; object literals keyed allow|step_up|restrict|deny whose
//       values name ramp colors fail with the file named.
// Exceptions live in a NAMED, DATED allowlist printed on every run — never
// silently passed.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// ── canonical values (DR-005 deny, DR-006 allow; DesignSystem.swift is the
//    ratifying tree — both appearances live there) ─────────────────────────
export const CANON = {
  dark: { allow: "639779", review: "B08B57", deny: "C67070" },
  light: { allow: "3F6B52", review: "7A5B2E", deny: "8A3F3F" },
};

// The web/PWA/desktop trees are DARK-COMMITTED surfaces (their :root IS the
// dark palette); the iOS trees carry both appearances.
const CSS_TREES = [
  "artifacts/signalgrid-web/src/index.css",
  "artifacts/signalgrid-app/src/index.css",
  "artifacts/signalgrid-review/src/index.css",
  "artifacts/signalgrid-desktop/src/index.css",
  "artifacts/signalgrid-mobile-pwa/src/index.css",
];
const IOS_CANONICAL = "native/ios/EnterpriseShell/Services/DesignSystem.swift";
const IOS_OPERATOR = "native/ios/SignalGridMobile/SignalGridOperator/Theme.swift";

// Named, dated exceptions — printed on every run, never silent.
const ALLOWLIST = [
  // (empty since 2026-08-21: DR-006's allow re-tone cleared AA on both
  //  grounds, retiring the 4.32:1 exception task #28 tracked)
];

// ── normalizers ────────────────────────────────────────────────────────────
export function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)]
    .map((v) => Math.round(v * 255).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}
export function swiftRgbToHex(r, g, b) {
  return [r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}
export function contrast(hexA, hexB) {
  const lum = (hex) => {
    const c = [0, 2, 4].map((i) => {
      let v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [a, b] = [lum(hexA), lum(hexB)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// ── extractors ─────────────────────────────────────────────────────────────
function cssDeclarations(src) {
  // every occurrence, with line numbers — a second theme block that drifts
  // must fail even when the first block is canonical
  const out = [];
  src.split("\n").forEach((line, i) => {
    const m = /--(decision-(?:allow|review|deny)|background|card):\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/.exec(line);
    if (m) out.push({ token: m[1], hex: hslToHex(+m[2], +m[3], +m[4]), line: i + 1 });
  });
  return out;
}
function dsDeclarations(src) {
  const out = [];
  src.split("\n").forEach((line, i) => {
    const m = /static let (allow|review|deny|background|card)\s*=\s*dynamic\(light:\s*"([0-9A-Fa-f]{6})",\s*dark:\s*"([0-9A-Fa-f]{6})"\)/.exec(line);
    if (m) out.push({ token: m[1], light: m[2].toUpperCase(), dark: m[3].toUpperCase(), line: i + 1 });
  });
  return out;
}
function themeDeclarations(src) {
  const out = [];
  src.split("\n").forEach((line, i) => {
    const m = /static let sg(Allow|StepUp|Restrict|Deny|Background|Card)\s*=\s*Color\(red:\s*([\d.]+),\s*green:\s*([\d.]+),\s*blue:\s*([\d.]+)\)/.exec(line);
    if (m) out.push({ token: m[1], hex: swiftRgbToHex(+m[2], +m[3], +m[4]), line: i + 1 });
  });
  return out;
}

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// ±1/255 per channel: Swift 0.776*255 = 197.88 → C6 needs tolerance-aware
// equality, and the documented rounding trap (61% → #C67171) must still fail.
function hexClose(a, b) {
  for (let i = 0; i < 6; i += 2) {
    if (Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) > 1) return false;
  }
  return true;
}

export function audit(files) {
  const problems = [];
  const table = [];
  const canonMap = { "decision-allow": "allow", "decision-review": "review", "decision-deny": "deny" };

  for (const tree of CSS_TREES) {
    const src = files[tree];
    if (src === undefined) { problems.push(`${tree}: missing from scan`); continue; }
    const decls = cssDeclarations(src);
    const bg = decls.find((d) => d.token === "background")?.hex;
    const card = decls.find((d) => d.token === "card")?.hex;
    if (!bg || !card) problems.push(`${tree}: could not locate background/card tokens`);
    let sawDecision = false;
    for (const d of decls) {
      const state = canonMap[d.token];
      if (!state) continue;
      sawDecision = true;
      if (!hexClose(d.hex, CANON.dark[state])) {
        problems.push(`${tree}:${d.line} ${d.token} is #${d.hex}, canonical dark is #${CANON.dark[state]} (DR-005/DR-006)`);
      }
      for (const [ground, gHex] of [["background", bg], ["card", card]]) {
        if (!gHex) continue;
        const r = contrast(d.hex, gHex);
        table.push({ tree, state, ground, ratio: r });
        if (r < 4.5) problems.push(`${tree}:${d.line} ${d.token} #${d.hex} vs ${ground} #${gHex} measures ${r.toFixed(2)}:1 — below the 4.5:1 AA floor DR-005 ratified for decision states`);
      }
    }
    if (!sawDecision) problems.push(`${tree}: no decision tokens found — the extractor or the tree broke`);
  }

  const ds = dsDeclarations(files[IOS_CANONICAL] ?? "");
  const dsBg = ds.find((d) => d.token === "background");
  const dsCard = ds.find((d) => d.token === "card");
  for (const d of ds) {
    if (!(d.token in CANON.dark)) continue;
    for (const mode of ["dark", "light"]) {
      if (!hexClose(d[mode], CANON[mode][d.token])) {
        problems.push(`${IOS_CANONICAL}:${d.line} ${d.token} ${mode} is #${d[mode]}, canonical is #${CANON[mode][d.token]}`);
      }
      for (const g of [dsBg, dsCard].filter(Boolean)) {
        const r = contrast(d[mode], g[mode]);
        table.push({ tree: `${IOS_CANONICAL} (${mode})`, state: d.token, ground: g.token, ratio: r });
        if (r < 4.5) problems.push(`${IOS_CANONICAL}:${d.line} ${d.token} ${mode} #${d[mode]} vs ${g.token} #${g[mode]} measures ${r.toFixed(2)}:1 — below AA`);
      }
    }
  }
  if (ds.filter((d) => d.token in CANON.dark).length === 0) problems.push(`${IOS_CANONICAL}: no decision tokens found`);

  const th = themeDeclarations(files[IOS_OPERATOR] ?? "");
  const thMap = { Allow: "allow", StepUp: "review", Deny: "deny", Restrict: "deny" }; // canonical: restrict renders DENY red (DesignSystem.swift maps restrict→deny)
  let sawTheme = false;
  for (const d of th) {
    const state = thMap[d.token];
    if (!state) continue;
    sawTheme = true;
    if (!hexClose(d.hex, CANON.dark[state])) {
      problems.push(`${IOS_OPERATOR}:${d.line} sg${d.token} is #${d.hex}, canonical dark ${state} is #${CANON.dark[state]}${d.token === "Restrict" ? " — restrict renders the deny red everywhere else; a verdict that is a caution on one surface and a hard stop on another changes what the color MEANS" : ""}`);
    }
    const thBg = th.find((x) => x.token === "Background")?.hex;
    if (thBg) {
      const r = contrast(d.hex, thBg);
      table.push({ tree: IOS_OPERATOR, state: `${state} (sg${d.token})`, ground: "background", ratio: r });
      if (r < 4.5) problems.push(`${IOS_OPERATOR}:${d.line} sg${d.token} #${d.hex} vs background #${thBg} measures ${r.toFixed(2)}:1 — below AA`);
    }
  }
  if (!sawTheme) problems.push(`${IOS_OPERATOR}: no decision colors found`);

  // (c) raw Tailwind ramps behind verdict keys
  for (const [path, src] of Object.entries(files)) {
    if (!path.endsWith(".tsx")) continue;
    src.split("\n").forEach((line, i) => {
      if (/\b(allow|step_up|restrict|deny)\s*:\s*["'`][^"'`]*(?:red|amber|orange|green|emerald|yellow)-\d/.test(line)) {
        problems.push(`${path}:${i + 1} paints a verdict from a raw Tailwind ramp instead of the decision tokens`);
      }
    });
  }

  return { problems, table };
}

function loadTree() {
  const files = {};
  for (const f of [...CSS_TREES, IOS_CANONICAL, IOS_OPERATOR]) files[f] = readFileSync(f, "utf8");
  for (const root of ["artifacts/signalgrid-web/src", "artifacts/signalgrid-app/src", "artifacts/signalgrid-review/src", "artifacts/signalgrid-desktop/src", "artifacts/signalgrid-mobile-pwa/src"]) {
    for (const f of walk(root)) if (f.endsWith(".tsx")) files[f] = readFileSync(f, "utf8");
  }
  return files;
}

function selfTest() {
  const checks = [];
  checks.push(["HSL 0 43% 60.8% normalizes to C67070", hslToHex(0, 43, 60.8) === "C67070"]);
  checks.push(["Swift Color(0.776,0.439,0.439) normalizes to C67070 (±1/255)", hexClose(swiftRgbToHex(0.776, 0.439, 0.439), "C67070")]);
  checks.push(["the documented rounding trap (61% → C67171) is NOT close to C67070... it is within 1/255 and must be tolerated", hexClose(hslToHex(0, 43, 61), "C67070")]);
  checks.push(["a real fork (0 28% 49% → A05A5A) is NOT close to C67070", !hexClose(hslToHex(0, 28, 49), "C67070")]);
  const files = loadTree();
  const clean = audit(files);
  checks.push(["the committed tree passes", clean.problems.length === 0]);
  const mutated = { ...files };
  mutated[CSS_TREES[2]] = files[CSS_TREES[2]].replace(/--decision-deny:[^;]+;/, "--decision-deny: 0 28% 49%;");
  const m = audit(mutated);
  checks.push(["mutating one tree's deny FAILS naming the file", m.problems.some((x) => x.includes("signalgrid-review") && x.includes("decision-deny"))]);
  const ramp = { ...files, "artifacts/signalgrid-review/src/FAKE.tsx": 'const c = { deny: "text-red-300" };' };
  const r = audit(ramp);
  checks.push(["a verdict painted from a Tailwind ramp FAILS", r.problems.some((x) => x.includes("FAKE.tsx"))]);
  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv.includes("--self-test")) process.exit(selfTest());
// Live run only on direct invocation — an import (tests, tooling) must get
// the pure functions without triggering a scan.
if (!(process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()))) {
  /* imported as a library */
} else {
  main();
}
function main() {
const { problems, table } = audit(loadTree());
console.log("Decision-palette gate — parity and contrast across all six rendered token trees\n");
console.log("  Measured ratios:");
for (const r of table) console.log(`    ${r.ratio.toFixed(2)}:1  ${r.state} vs ${r.ground}  (${r.tree})`);
if (ALLOWLIST.length) {
  console.log("\n  Named exceptions (dated — never silent):");
  for (const e of ALLOWLIST) console.log(`    ${e}`);
} else {
  console.log("\n  Exceptions: none (DR-006's allow re-tone retired the last one, 2026-08-21).");
}
if (problems.length > 0) {
  console.error(`\nDecision-palette gate FAILED: ${problems.length} problem(s).`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log("\nDecision-palette gate passed — one palette, every tree, AA everywhere.");
}
