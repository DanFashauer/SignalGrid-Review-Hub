// check-ios-dynamic-type — no raw system font outside DesignSystem.swift.
//
//   node scripts/check-ios-dynamic-type.mjs             the guard
//   node scripts/check-ios-dynamic-type.mjs --self-test prove the guard can fail
//
// WHY THIS EXISTS
// ---------------
// CLAUDE.md's iOS section forbids calling UIFont.systemFont / monospacedSystemFont
// directly: those return a FIXED-point font that does not grow at accessibility
// text sizes, so a label built from one truncates, overlaps, then breaks mid-word
// under Dynamic Type. The SG.sans / SG.mono / SG.monoDigits tokens in
// DesignSystem.swift wrap the raw APIs in UIFontMetrics so the font scales, and
// callers set adjustsFontForContentSizeCategory = true.
//
// The rule was already enforced by hand once (dd55bca converted eight view
// controllers on 2026-08-18) and REGRESSED: it skipped HostAppViewController and
// ManagedAppViewController — the two that host the Assist gate, the screen that
// tells a worker why they were blocked — leaving 18 fixed-point sites. A rule a
// human applies by memory is a rule that drifts. This gate is the memory.
//
// It matches the form Swift ACTUALLY uses — the implicit-member `.systemFont(ofSize`
// — not `UIFont.systemFont`, which CLAUDE.md named and which matches zero sites.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IOS = resolve(repo, "native/ios");
// The raw, non-scaling APIs, in the implicit-member spelling Swift uses at the call site.
const RAW = /\.(systemFont|monospacedSystemFont)\(ofSize/;
// The ONE file allowed to touch them: it wraps them in UIFontMetrics to make SG.* scale.
const ALLOWED = "DesignSystem.swift";

function swiftFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "build" && e.name !== ".build" && e.name !== "DerivedData") out.push(...swiftFiles(p));
    } else if (e.name.endsWith(".swift")) {
      out.push(p);
    }
  }
  return out;
}

function scan(files) {
  const hits = [];
  for (const f of files) {
    if (f.endsWith(ALLOWED)) continue;
    readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      // Skip comment lines — a rule quoted in a comment is not a call site.
      if (RAW.test(line) && !line.trimStart().startsWith("//")) {
        hits.push({ file: relative(repo, f), line: i + 1, text: line.trim() });
      }
    });
  }
  return hits;
}

if (process.argv.includes("--self-test")) {
  // A guard nobody has watched fail is a guard nobody should trust. Drive the
  // real matcher: the raw form must be caught, an SG token must not.
  const caughtRaw = RAW.test("label.font = .systemFont(ofSize: 12, weight: .semibold)");
  const caughtMono = RAW.test("v.font = .monospacedSystemFont(ofSize: 11, weight: .regular)");
  const passesSG = !RAW.test("label.font = SG.sans(14, .semibold)");
  const ok = caughtRaw && caughtMono && passesSG;
  console.log(ok
    ? "PASS  self-test - raw .systemFont(ofSize / .monospacedSystemFont(ofSize are caught, SG.* are not"
    : `FAIL  self-test - caughtRaw=${caughtRaw} caughtMono=${caughtMono} passesSG=${passesSG}`);
  process.exit(ok ? 0 : 1);
}

const files = swiftFiles(IOS);
const hits = scan(files);
if (hits.length) {
  console.error(`x ${hits.length} raw system-font call(s) outside DesignSystem.swift:\n`);
  for (const h of hits) console.error(`    ${h.file}:${h.line}  ${h.text}`);
  console.error(`
These use a FIXED point size and do not grow at accessibility text sizes — the
Assist-gate screens truncate, overlap, then break mid-word under Dynamic Type.
Use SG.sans / SG.mono / SG.monoDigits (they scale via UIFontMetrics) and set
adjustsFontForContentSizeCategory = true. DesignSystem.swift is the ONLY file
allowed to call the raw UIFont APIs, because it is where the scaling wrapper lives.
`);
  process.exit(1);
}
console.log(`OK iOS dynamic type - no raw system-font call outside DesignSystem.swift (checked ${files.length} .swift files).`);
