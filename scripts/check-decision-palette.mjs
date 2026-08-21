#!/usr/bin/env node
// Decision-palette parity + contrast gate, v2 — rebuilt after the assurance
// review executed eleven mutations against v1 and the gate stayed green for
// ten of them: the ramp scan matched exactly one syntactic shape (and both
// live verdict components used others), the on-tint tokens this repo minted
// were never extracted, no composited ground was ever measured (DR-006's
// addendum requires it, and the iOS badge sat at 3.92:1 under a green gate),
// grounds were bound per FILE so a second theme block inherited the first
// block's ratios, and a css class palette in raw hex was invisible entirely.
//
// v2 measures what RENDERS:
//   (a) PARITY — every decision token (base AND on-tint) in every notation
//       (HSL triple, hex, rgb(), SwiftUI Color(red:green:blue:)) normalizes
//       to the canonical hex, ±1/255;
//   (b) CONTRAST — per THEME BLOCK, each token against that block's own
//       grounds; plus the COMPOSITED chip grounds: fg over (tint over
//       ground) for every .bg-status-* rule and for the iOS OutcomeBadge's
//       0.12 tint — all ≥ 4.5:1, table printed;
//   (c) TOKEN USE — verdict-keyed ramps in .tsx/.ts/.jsx/.js (object maps,
//       nested maps, ternaries, if/else comparisons) and verdict-named css
//       classes with literal colors both fail, file:line named.
// Self-tests are anchored to the REAL evading shapes the review found, not
// to the regexes.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const CANON = {
  dark: { allow: "639779", review: "B08B57", deny: "C67070" },
  light: { allow: "3F6B52", review: "7A5B2E", deny: "8A3F3F" },
  onTint: { "allow-on-tint": "74A488", "deny-on-tint": "CC7F7F" },
};

const CSS_TREES = [
  "artifacts/signalgrid-web/src/index.css",
  "artifacts/signalgrid-app/src/index.css",
  "artifacts/signalgrid-review/src/index.css",
  "artifacts/signalgrid-desktop/src/index.css",
  "artifacts/signalgrid-mobile-pwa/src/index.css",
];
const IOS_CANONICAL = "native/ios/EnterpriseShell/Services/DesignSystem.swift";
const IOS_OPERATOR = "native/ios/SignalGridMobile/SignalGridOperator/Theme.swift";
const ALLOWLIST = []; // named, dated exceptions — printed on every run, never silent

// ── color math ─────────────────────────────────────────────────────────────
export function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
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
export function composite(tintHex, alpha, groundHex) {
  const px = (h, i) => parseInt(h.slice(i, i + 2), 16);
  return [0, 2, 4]
    .map((i) => Math.round(alpha * px(tintHex, i) + (1 - alpha) * px(groundHex, i)))
    .map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
}
function hexClose(a, b) {
  for (let i = 0; i < 6; i += 2) {
    if (Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) > 1) return false;
  }
  return true;
}

// ── extraction ─────────────────────────────────────────────────────────────
const VALUE = /([\d.]+)\s+([\d.]+)%\s+([\d.]+)%|#([0-9a-fA-F]{6})\b|rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/;
function parseColorValue(raw) {
  const m = VALUE.exec(raw);
  if (!m) return null;
  if (m[1] !== undefined) return hslToHex(+m[1], +m[2], +m[3]);
  if (m[4] !== undefined) return m[4].toUpperCase();
  return [m[5], m[6], m[7]].map((v) => (+v).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** Split a css file into theme blocks and extract each block's own tokens —
 *  a second block's decision colors must be measured against that block's
 *  grounds, in whatever notation the block used. */
export function cssBlocks(src) {
  const blocks = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  let lineOf = (idx) => src.slice(0, idx).split("\n").length;
  while ((m = re.exec(src))) {
    const body = m[2];
    const decls = [];
    for (const d of body.matchAll(/--(decision-(?:allow|review|deny)(?:-on-tint)?|background|card):\s*([^;]+);/g)) {
      const hex = parseColorValue(d[2]);
      decls.push({ token: d[1], hex, raw: d[2].trim(), line: lineOf(m.index + m[1].length + d.index) });
    }
    if (decls.length) blocks.push({ selector: m[1].trim().slice(0, 60), decls });
  }
  return blocks;
}

export function chipRules(src) {
  // .bg-status-X { background-color: hsl(var(--decision-B) / A); color: hsl(var(--decision-F)); ... }
  const out = [];
  for (const m of src.matchAll(/\.bg-status-([a-z-]+)\s*\{([^}]*)\}/g)) {
    const body = m[2];
    const tint = /background-color:\s*hsl\(var\(--(decision-[a-z-]+)\)\s*\/\s*([\d.]+)\)/.exec(body);
    const fg = /(?<!background-)color:\s*hsl\(var\(--(decision-[a-z-]+(?:-on-tint)?)\)\)/.exec(body);
    if (tint && fg) out.push({ chip: m[1], tintToken: tint[1], alpha: +tint[2], fgToken: fg[1] });
  }
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
    const m = /static let sg(Allow|StepUp|Restrict|Deny|Background|Panel|Card)(OnTint)?\s*=\s*Color\(red:\s*([\d.]+),\s*green:\s*([\d.]+),\s*blue:\s*([\d.]+)\)/.exec(line);
    if (m) out.push({ token: m[1] + (m[2] ?? ""), hex: swiftRgbToHex(+m[3], +m[4], +m[5]), line: i + 1 });
  });
  return out;
}

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// ── the audit ──────────────────────────────────────────────────────────────
const RAMP = /\b(?:red|amber|orange|green|emerald|yellow|teal|sky|lime|rose)-\d{2,3}\b|#(?:ef4444|f59e0b|f97316|22c55e|34d399|fbbf24|fb923c|f87171)\b/i;
const VERDICT_KEY = /\b(allow|step_up|restrict|deny)\s*:|["'](allow|step-up|step_up|restrict|deny)["']\s*:|case\s+["'](allow|step-up|step_up|restrict|deny)["']|(?:outcome|Outcome)\s*(?:===|==)\s*[^?\n]{0,60}/;

export function audit(files) {
  const problems = [];
  const table = [];
  const canonAll = { "decision-allow": CANON.dark.allow, "decision-review": CANON.dark.review, "decision-deny": CANON.dark.deny, "decision-allow-on-tint": CANON.onTint["allow-on-tint"], "decision-deny-on-tint": CANON.onTint["deny-on-tint"] };

  for (const tree of CSS_TREES) {
    const src = files[tree];
    if (src === undefined) { problems.push(`${tree}: missing from scan`); continue; }
    const blocks = cssBlocks(src);
    if (!blocks.some((b) => b.decls.some((d) => d.token.startsWith("decision-")))) {
      problems.push(`${tree}: no decision tokens found in any block — the extractor or the tree broke`);
      continue;
    }
    let fallback = blocks.find((b) => b.decls.some((d) => d.token === "background"));
    for (const b of blocks) {
      const decisions = b.decls.filter((d) => d.token.startsWith("decision-"));
      if (!decisions.length) continue;
      const bg = b.decls.find((d) => d.token === "background")?.hex ?? fallback?.decls.find((d) => d.token === "background")?.hex;
      const card = b.decls.find((d) => d.token === "card")?.hex ?? fallback?.decls.find((d) => d.token === "card")?.hex;
      for (const d of decisions) {
        if (d.hex === null) { problems.push(`${tree}:${d.line} ${d.token} uses a notation the gate cannot parse (${d.raw.slice(0, 30)}) — unparseable is not exempt`); continue; }
        const canon = canonAll[d.token];
        if (canon && !hexClose(d.hex, canon)) {
          problems.push(`${tree}:${d.line} ${d.token} is #${d.hex}, canonical is #${canon} (block "${b.selector}")`);
        }
        if (d.token.endsWith("-on-tint")) continue; // measured via chip composites below
        for (const [g, gHex] of [["background", bg], ["card", card]]) {
          if (!gHex) continue;
          const r = contrast(d.hex, gHex);
          table.push({ tree: `${tree} [${b.selector}]`, state: d.token.replace("decision-", ""), ground: g, ratio: r });
          if (r < 4.5) problems.push(`${tree}:${d.line} ${d.token} #${d.hex} vs ${g} #${gHex} measures ${r.toFixed(2)}:1 in block "${b.selector}" — below AA`);
        }
      }
    }
    // Chip composites — DR-006 addendum: composited grounds are render surfaces.
    const tokenHex = (name) => {
      for (const b of blocks) { const d = b.decls.find((x) => x.token === name); if (d?.hex) return d.hex; }
      return null;
    };
    const bg = tokenHex("background"), card = tokenHex("card");
    for (const chip of chipRules(src)) {
      const tint = tokenHex(chip.tintToken), fg = tokenHex(chip.fgToken);
      if (!tint || !fg) { problems.push(`${tree}: chip .bg-status-${chip.chip} references ${!tint ? chip.tintToken : chip.fgToken}, which no block declares`); continue; }
      for (const [g, gHex] of [["background", bg], ["card", card]]) {
        if (!gHex) continue;
        const r = contrast(fg, composite(tint, chip.alpha, gHex));
        table.push({ tree, state: `chip ${chip.chip}`, ground: `${Math.round(chip.alpha * 100)}% tint over ${g}`, ratio: r });
        if (r < 4.5) problems.push(`${tree}: .bg-status-${chip.chip} text (${chip.fgToken}) over its ${chip.alpha} tint on ${g} measures ${r.toFixed(2)}:1 — below AA on a rendered chip`);
      }
    }
    // Verdict-named css classes carrying literal colors (the pwa stray-palette class)
    src.split("\n").forEach((line, i) => {
      if (/^\s*\.(?:text|bg)-(?:allow|step-up|restrict|deny)\b/.test(line) && !line.includes("status")) {
        problems.push(`${tree}:${i + 1} declares a verdict-named class outside the .{text,bg}-status-* token set — a second palette one import away from rendering`);
      }
    });
  }

  // iOS canonical (dual appearance)
  const ds = dsDeclarations(files[IOS_CANONICAL] ?? "");
  const dsBg = ds.find((d) => d.token === "background"), dsCard = ds.find((d) => d.token === "card");
  for (const d of ds) {
    if (!(d.token in CANON.dark)) continue;
    for (const mode of ["dark", "light"]) {
      if (!hexClose(d[mode], CANON[mode][d.token])) problems.push(`${IOS_CANONICAL}:${d.line} ${d.token} ${mode} is #${d[mode]}, canonical is #${CANON[mode][d.token]}`);
      for (const g of [dsBg, dsCard].filter(Boolean)) {
        const r = contrast(d[mode], g[mode]);
        table.push({ tree: `${IOS_CANONICAL} (${mode})`, state: d.token, ground: g.token, ratio: r });
        if (r < 4.5) problems.push(`${IOS_CANONICAL}:${d.line} ${d.token} ${mode} vs ${g.token} measures ${r.toFixed(2)}:1 — below AA`);
      }
    }
  }
  if (!ds.some((d) => d.token in CANON.dark)) problems.push(`${IOS_CANONICAL}: no decision tokens found`);

  // iOS operator: flat colors vs ALL THREE rendered grounds + badge composite
  const th = themeDeclarations(files[IOS_OPERATOR] ?? "");
  const thTok = (n) => th.find((x) => x.token === n)?.hex;
  const thMap = { Allow: "allow", StepUp: "review", Deny: "deny", Restrict: "deny" };
  const onTintMap = { AllowOnTint: "allow", StepUpOnTint: "review", DenyOnTint: "deny" };
  let sawTheme = false;
  for (const d of th) {
    const state = thMap[d.token];
    if (!state) continue;
    sawTheme = true;
    if (!hexClose(d.hex, CANON.dark[state])) {
      problems.push(`${IOS_OPERATOR}:${d.line} sg${d.token} is #${d.hex}, canonical dark ${state} is #${CANON.dark[state]}`);
    }
    for (const g of ["Background", "Panel", "Card"]) {
      const gh = thTok(g);
      if (!gh) continue;
      const r = contrast(d.hex, gh);
      table.push({ tree: IOS_OPERATOR, state: `${state} (sg${d.token})`, ground: g.toLowerCase(), ratio: r });
      if (r < 4.5) problems.push(`${IOS_OPERATOR}:${d.line} sg${d.token} #${d.hex} vs sg${g} #${gh} measures ${r.toFixed(2)}:1 — below AA on a rendered ground`);
    }
  }
  // OutcomeBadge: fg = OnTint over 0.12 tint of the flat color, on every ground
  const badgeAlpha = (() => {
    const m = /\.background\(Color\.outcome\(outcome\)\.opacity\(([\d.]+)\)\)/.exec(files["native/ios/SignalGridMobile/SignalGridOperator/Components.swift"] ?? "");
    return m ? +m[1] : null;
  })();
  if (badgeAlpha !== null) {
    for (const [tok, state] of Object.entries(onTintMap)) {
      const fg = thTok(tok);
      const base = thTok(tok.replace("OnTint", ""));
      if (!fg || !base) { problems.push(`${IOS_OPERATOR}: missing sg${tok} — the tinted badge has no measured foreground for ${state}`); continue; }
      for (const g of ["Background", "Panel", "Card"]) {
        const gh = thTok(g);
        if (!gh) continue;
        const r = contrast(fg, composite(base, badgeAlpha, gh));
        table.push({ tree: IOS_OPERATOR, state: `badge ${state}`, ground: `${Math.round(badgeAlpha * 100)}% tint over ${g.toLowerCase()}`, ratio: r });
        if (r < 4.5) problems.push(`${IOS_OPERATOR}: badge ${state} on-tint over ${badgeAlpha} tint on sg${g} measures ${r.toFixed(2)}:1 — below AA`);
      }
    }
  } else if (sawTheme) {
    problems.push("Components.swift: could not locate the OutcomeBadge tint — the composite check cannot run, and unmeasured is not exempt");
  }
  if (!sawTheme) problems.push(`${IOS_OPERATOR}: no decision colors found`);

  // (c) verdict-keyed ramps in code — two-stage: a verdict key/comparison with
  // ramp material within the following 300 chars (covers nested maps,
  // ternaries, if/else chains, multiline values).
  for (const [path, src] of Object.entries(files)) {
    if (!/\.(tsx|ts|jsx|js)$/.test(path) || path.includes("index.css")) continue;
    let flagged = false;
    // Key-anchored: test the KEY'S OWN VALUE REGION (string, braced object, or
    // up-to-comma expression) — a neighbouring non-verdict key's ramp two
    // lines later is that key's business, not this one's.
    for (const m of src.matchAll(/\b(allow|step_up|restrict|deny)\s*:|["'](allow|step-up|step_up|restrict|deny)["']\s*:/g)) {
      let i = m.index + m[0].length;
      while (i < src.length && /\s/.test(src[i])) i += 1;
      let value;
      if (src[i] === "{") {
        let depth = 1, j = i + 1;
        while (j < src.length && depth > 0) { if (src[j] === "{") depth += 1; else if (src[j] === "}") depth -= 1; j += 1; }
        value = src.slice(i, j);
      } else {
        const end = src.indexOf(",", i);
        value = src.slice(i, end === -1 ? i + 200 : Math.min(end, i + 400));
      }
      if (RAMP.test(value)) {
        const line = src.slice(0, m.index).split("\n").length;
        problems.push(`${path}:${line} paints a verdict from a raw Tailwind ramp (or ramp hex) instead of the decision tokens`);
        flagged = true;
        break;
      }
    }
    // Comparison-anchored (ternaries, if/else): the assignment usually sits
    // on the following line, so keep a forward window here.
    if (!flagged) {
      for (const m of src.matchAll(/(?:outcome|Outcome)\s*(?:===|==)|case\s+["'](?:allow|step-up|step_up|restrict|deny)["']/g)) {
        const windowFwd = src.slice(m.index, m.index + 300);
        if (RAMP.test(windowFwd)) {
          const line = src.slice(0, m.index).split("\n").length;
          problems.push(`${path}:${line} paints a verdict from a raw Tailwind ramp (or ramp hex) instead of the decision tokens`);
          break;
        }
      }
    }
  }

  return { problems, table };
}

function loadTree() {
  const files = {};
  for (const f of [...CSS_TREES, IOS_CANONICAL, IOS_OPERATOR, "native/ios/SignalGridMobile/SignalGridOperator/Components.swift"]) files[f] = readFileSync(f, "utf8");
  for (const root of ["artifacts/signalgrid-web/src", "artifacts/signalgrid-app/src", "artifacts/signalgrid-review/src", "artifacts/signalgrid-desktop/src", "artifacts/signalgrid-mobile-pwa/src"]) {
    for (const f of walk(root)) if (/\.(tsx|ts|jsx|js)$/.test(f)) files[f] = readFileSync(f, "utf8");
  }
  return files;
}

function selfTest() {
  const checks = [];
  checks.push(["HSL 0 43% 60.8% normalizes to C67070", hslToHex(0, 43, 60.8) === "C67070"]);
  checks.push(["rgb(160,90,90) normalizes to A05A5A", parseColorValue("rgb(160, 90, 90)") === "A05A5A"]);
  checks.push(["the 61% rounding trap stays within tolerance", hexClose(hslToHex(0, 43, 61), "C67070")]);
  checks.push(["the real fork (#A05A5A) is rejected", !hexClose(hslToHex(0, 28, 49), "C67070")]);
  const files = loadTree();
  const clean = audit(files);
  checks.push(["the committed tree passes", clean.problems.length === 0]);
  // Negative controls anchored to the REAL evading shapes the review executed:
  const cases = [
    ["the LiveDecisionPanel nested-map shape fails", "artifacts/signalgrid-app/src/FAKE1.tsx",
      'const TONE = { allow: { dot: "bg-emerald-400", text: "text-emerald-400" }, deny: { dot: "bg-red-400" } };'],
    ["the OutcomeBadge if/else shape fails", "artifacts/signalgrid-mobile-pwa/src/FAKE2.tsx",
      'if (outcome === Outcomes.deny) {\n  colors = "text-red-400 bg-red-400/10";\n}'],
    ["the desktop ternary shape fails", "artifacts/signalgrid-desktop/src/FAKE3.tsx",
      'const c = d.outcome === "deny" ? "text-red-400" : "text-yellow-400";'],
    ["a verdict ramp map in a .ts file fails", "artifacts/signalgrid-review/src/FAKE4.ts",
      'export const map = { deny: "text-red-300" };'],
    ["a ramp HEX behind a verdict key fails", "artifacts/signalgrid-app/src/FAKE5.tsx",
      'const m = { deny: "#ef4444" };'],
  ];
  for (const [label, path, code] of cases) {
    const r = audit({ ...files, [path]: code });
    checks.push([label, r.problems.some((x) => x.includes(path.split("/").pop()))]);
  }
  // wrecked on-tint token → chip composite fails
  const wrecked = { ...files };
  wrecked[CSS_TREES[2]] = files[CSS_TREES[2]].replace("--decision-deny-on-tint: 0 43% 64.8%;", "--decision-deny-on-tint: 0 43% 20%;");
  let r = audit(wrecked);
  checks.push(["a wrecked on-tint token fails the chip composite", r.problems.some((x) => x.includes("bg-status") && x.includes("below AA"))]);
  // light block on white grounds with dark tokens → measured against ITS OWN grounds
  const light = { ...files };
  light[CSS_TREES[3]] = files[CSS_TREES[3]] + "\n.light { --background: 0 0% 100%; --card: 0 0% 100%; --decision-allow: 145 21% 49%; --decision-deny: 0 43% 60.8%; }\n";
  r = audit(light);
  checks.push(["a light block is measured against its OWN grounds (fails on white)", r.problems.some((x) => x.includes('block ".light"') && x.includes("below AA"))]);
  // hex-notation fork in a media block → parity fails (not silently skipped)
  const hexFork = { ...files };
  hexFork[CSS_TREES[4]] = files[CSS_TREES[4]] + "\n.forked { --decision-deny: #A05A5A; }\n";
  r = audit(hexFork);
  checks.push(["a hex-notation fork is caught, not skipped", r.problems.some((x) => x.includes("A05A5A"))]);
  // verdict-named css class with literal color
  const strayCss = { ...files };
  strayCss[CSS_TREES[4]] = files[CSS_TREES[4]] + "\n.text-deny { color: #ef4444; }\n";
  r = audit(strayCss);
  checks.push(["a verdict-named css class outside the token set fails", r.problems.some((x) => x.includes("second palette"))]);
  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  if (process.argv.includes("--self-test")) process.exit(selfTest());
  const { problems, table } = audit(loadTree());
  console.log("Decision-palette gate v2 — parity, block-scoped contrast, and COMPOSITED chip grounds\n");
  console.log("  Measured ratios:");
  for (const r of table) console.log(`    ${r.ratio.toFixed(2)}:1  ${r.state} vs ${r.ground}  (${r.tree})`);
  if (ALLOWLIST.length) {
    console.log("\n  Named exceptions (dated — never silent):");
    for (const e of ALLOWLIST) console.log(`    ${e}`);
  } else {
    console.log("\n  Exceptions: none.");
  }
  if (problems.length > 0) {
    console.error(`\nDecision-palette gate FAILED: ${problems.length} problem(s).`);
    for (const p of problems) console.error(`  ✗ ${p}`);
    process.exit(1);
  }
  console.log("\nDecision-palette gate passed — one palette, every tree, every rendered ground, AA everywhere.");
}
