// check-surface-claims.mjs — a document may not say a platform is absent when the
// tree contains it.
//
//   node scripts/check-surface-claims.mjs              # report + gate
//   node scripts/check-surface-claims.mjs --self-test  # prove the gate can fail
//
// WHY THIS EXISTS. `docs/DELIVERY_GAP_ANALYSIS.md` was measured against the tree on
// 2026-08-08 and was false the same afternoon: native Android, a Tauri desktop shell
// and the Rust dock firmware all landed within hours of it being written. Nothing
// noticed. The document went on reading as a measurement for five days, and TWO
// separate external analyses then opened with its stalest sentence as their headline
// finding — one repeating "7 files versus 2", the other restating it as "220 commits
// ahead". Neither ran a command, because the document already looked like someone had.
//
// This repository's whole discipline is that a measured number must still be one, and
// it had a guard for exactly that (`check-proof-figures.mjs`) which could not see this
// class: absence is not a figure. "Android does not exist in any form" carries no
// number for a figure guard to bind, and it is far more misleading than a stale count.
//
// THE LAW: for every surface below, if the tree contains it, no document may assert it
// is absent. The claim is fatal, not advisory — a false absence sends people to build
// something that already exists, which is what happened here twice.
//
// WHAT IS DELIBERATELY NOT CHECKED: the reverse direction. A document may say a surface
// EXISTS when it does not, and this gate stays silent — because the honest fix for an
// over-claim is `scripts/docs-sanity.mjs`'s unsafe-claim scan, which already owns that
// direction and is negation-aware. Two gates chasing the same sentence from both sides
// is how you get a gate nobody can keep green. Absence is the half nothing owned.
import { execSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sh = (cmd) => {
  try {
    return execSync(cmd, { cwd: repo, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
};
const tracked = (pathspec) => {
  const out = sh(`git ls-files -- ${pathspec}`);
  return out ? out.split("\n").filter(Boolean) : [];
};

/**
 * Each surface names how to MEASURE it and the phrasings that would deny it.
 * The patterns are the actual sentences that were wrong, not invented ones — a guard
 * built from imagined mistakes catches imagined mistakes.
 */
export const SURFACES = [
  {
    id: "android",
    label: "native Android",
    measure: () => tracked("'*.kt' 'native/android/**'"),
    denials: [
      /android[^.\n]{0,40}\babsent\b/i,
      /\bzero\b[^.\n]{0,30}\.kt\b/i,
      /android does not exist/i,
      /no android (app|files|surface)/i,
    ],
  },
  {
    id: "desktop-native",
    label: "native desktop shell (Tauri)",
    measure: () => tracked("'native/desktop/**'"),
    denials: [
      /no electron, tauri/i,
      /zero electron/i,
      /native (windows ?\/ ?macos )?desktop[^.\n]{0,30}\babsent\b/i,
    ],
  },
  {
    id: "firmware",
    label: "dock firmware",
    measure: () => tracked("'firmware/**/*.rs'"),
    denials: [
      /embedded firmware[^.\n]{0,40}\babsent\b/i,
      /zero `?\.ino`?[^.\n]{0,60}files in the entire repository/i,
    ],
  },
  {
    id: "ios",
    label: "native iOS",
    measure: () => tracked("'*.swift'"),
    denials: [/\bios\b[^.\n]{0,30}\babsent\b/i, /no ios app/i],
  },
];

/**
 * Lines a correction is allowed to quote. Struck-through text is a document
 * retracting itself, and a blockquote is the correction banner explaining why —
 * both must be able to repeat the false sentence verbatim without tripping the gate
 * that made them necessary. Everything else is the document speaking in its own voice.
 *
 * Pure and exported so the self-test drives the same code path the gate does.
 */
export function isRetracted(line) {
  const t = line.trim();
  if (t.startsWith(">")) return true; // correction banner
  if (/~~/.test(line)) return true; // struck through
  return false;
}

export function findDenials(text, surface) {
  const hits = [];
  text.split("\n").forEach((line, i) => {
    if (isRetracted(line)) return;
    for (const re of surface.denials) {
      if (re.test(line)) {
        hits.push({ line: i + 1, text: line.trim().slice(0, 160) });
        break;
      }
    }
  });
  return hits;
}

function docFiles() {
  const out = [];
  const walk = (rel) => {
    for (const entry of readdirSync(join(repo, rel), { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const next = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (entry.name.endsWith(".md")) out.push(next);
    }
  };
  walk("docs");
  out.push("README.md");
  return out;
}

function selfTest() {
  const checks = [];
  const android = SURFACES.find((s) => s.id === "android");

  checks.push([
    "a plain false-absence sentence is CAUGHT",
    findDenials("Android — ABSENT — zero `.kt` files anywhere.", android).length === 1,
  ]);
  checks.push([
    "the same sentence STRUCK THROUGH is allowed — a doc must be able to retract itself",
    findDenials("~~Android — ABSENT — zero `.kt` files anywhere.~~", android).length === 0,
  ]);
  checks.push([
    "the same sentence inside a correction BLOCKQUOTE is allowed",
    findDenials("> Android — ABSENT — zero `.kt` files anywhere.", android).length === 0,
  ]);
  checks.push([
    "ordinary prose about Android is NOT caught (the gate is not a keyword ban)",
    findDenials("The Android app ships a core module and a conformance test.", android).length === 0,
  ]);
  checks.push([
    "every surface declares a measurement and at least one denial pattern",
    SURFACES.every((s) => typeof s.measure === "function" && s.denials.length > 0),
  ]);
  checks.push([
    "every surface currently MEASURES non-empty — a gate over an absent surface is vacuous",
    SURFACES.every((s) => s.measure().length > 0),
  ]);
  checks.push([
    "isRetracted is not a blanket pass — an ordinary line is not retracted",
    isRetracted("Android is absent.") === false,
  ]);

  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv.includes("--self-test")) process.exit(selfTest());

console.log("Surface-claim check — a document may not deny a platform the tree contains\n");

const present = [];
for (const s of SURFACES) {
  const files = s.measure();
  console.log(`  ${s.label.padEnd(30)} ${String(files.length).padStart(4)} tracked file(s)`);
  if (files.length > 0) present.push(s);
}

const problems = [];
for (const rel of docFiles()) {
  let text;
  try {
    text = readFileSync(join(repo, rel), "utf8");
  } catch {
    continue;
  }
  for (const s of present) {
    for (const hit of findDenials(text, s)) {
      problems.push(`${rel}:${hit.line} denies ${s.label}, which the tree contains — "${hit.text}"`);
    }
  }
}

console.log(`\n  ${present.length} surface(s) present · ${docFiles().length} document(s) scanned`);

if (problems.length > 0) {
  console.error(`\nSurface-claim check FAILED: ${problems.length} false absence claim(s).`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(
    "\nA doc that says a surface is absent when it is not sends people to rebuild it.\n" +
      "Correct the sentence, or strike it through and explain — a retraction (~~…~~ or a\n" +
      "> blockquote) may quote the old claim verbatim.",
  );
  process.exit(1);
}
console.log("\nSurface-claim check passed — no document denies a platform this tree contains.");
