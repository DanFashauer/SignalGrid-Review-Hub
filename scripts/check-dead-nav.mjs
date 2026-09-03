// Dead-nav gate — a module-level `const <NAME>_NAV` / `const <NAME>_GROUPS` array
// in artifacts/signalgrid-app/src/components/layout/ that is referenced nowhere
// outside its own declaration is dead code that lies: SETTINGS_NAV sat there fully
// authored and rendered NOWHERE, while a PreviewBanner claimed six launch surfaces
// the sidebar never showed. A nav array declares navigation; one nothing renders is
// a claim with no UI behind it. References are counted across the whole console src
// so an EXPORTED nav (LAUNCH_NAV, used by App.tsx's banner) counts as live.
//
// SELF-TEST FIRST: the detector must flag a planted dead nav and clear a used one,
// or the gate refuses to conclude anything.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const LAYOUT_DIR = "artifacts/signalgrid-app/src/components/layout";
const SRC = "artifacts/signalgrid-app/src";
const DECL_RE = /^(?:export\s+)?const\s+([A-Za-z0-9]+_(?:NAV|GROUPS))\b/gm;

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function walk(dir, exts) {
  const out = [];
  const rec = (d) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) rec(p);
      else if (exts.some((x) => p.endsWith(x))) out.push(p);
    }
  };
  if (existsSync(dir)) rec(dir);
  return out;
}

function declsIn(text) {
  return [...text.matchAll(DECL_RE)].map((m) => m[1]);
}
function refCount(name, allText) {
  return (allText.match(new RegExp(`\\b${name}\\b`, "g")) || []).length;
}
// A nav const is dead when the identifier appears at most once across the whole
// console source — i.e. only in its own declaration, referenced by nothing.
function deadNavs(layoutTexts, allText) {
  const dead = [];
  for (const { file, text } of layoutTexts) {
    for (const name of declsIn(text)) {
      if (refCount(name, allText) <= 1) dead.push({ name, file });
    }
  }
  return dead;
}

// ── self-test ────────────────────────────────────────────────────────────────
{
  const used = "const USED_NAV = [];\nexport function X() { return USED_NAV; }\n";
  const deadDecl = "const DEAD_NAV = [];\n";
  const both = used + deadDecl;
  const flagged = deadNavs([{ file: "st.tsx", text: both }], both);
  const st =
    flagged.length === 1 &&
    flagged[0].name === "DEAD_NAV" &&
    // an exported nav used from ANOTHER file is live
    deadNavs(
      [{ file: "a.tsx", text: "export const LIVE_GROUPS = [];\n" }],
      "export const LIVE_GROUPS = [];\n<NavSection entries={LIVE_GROUPS} />\n",
    ).length === 0;
  if (!st) fail("SELF-TEST FAILED: the dead-nav detector no longer flags a planted dead nav. A gate that cannot fail proves nothing.");
}

if (process.argv.includes("--self-test")) {
  console.log("check-dead-nav self-test passed.");
  process.exit(0);
}

// ── run ──────────────────────────────────────────────────────────────────────
if (!existsSync(LAYOUT_DIR)) fail(`${LAYOUT_DIR} missing — the layout directory moved; fix this derivation, do not silently scan nothing.`);
const layoutFiles = walk(LAYOUT_DIR, [".ts", ".tsx"]);
if (layoutFiles.length === 0) fail(`no files under ${LAYOUT_DIR} — the derivation is broken, not the tree empty.`);
const layoutTexts = layoutFiles.map((f) => ({ file: f, text: readFileSync(f, "utf8") }));
const allText = walk(SRC, [".ts", ".tsx"]).map((f) => readFileSync(f, "utf8")).join("\n");

const declCount = layoutTexts.reduce((n, { text }) => n + declsIn(text).length, 0);
const dead = deadNavs(layoutTexts, allText);

console.log(`check-dead-nav: ${declCount} *_NAV/*_GROUPS declaration(s) in ${LAYOUT_DIR}; self-test green`);
if (dead.length > 0) {
  for (const d of dead) console.error(`  ✗ ${d.name} (${d.file}) — declared but referenced nowhere. Render it or delete it.`);
  console.error(`\nDead-nav gate FAILED — ${dead.length} navigation array(s) declared and rendered nowhere.`);
  process.exit(1);
}
console.log("Dead-nav gate passed — every navigation array is rendered.");
