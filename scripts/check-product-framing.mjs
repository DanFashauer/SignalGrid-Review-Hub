// Product framing gate — one company description on current-truth surfaces.
//
//   node scripts/check-product-framing.mjs
//   node scripts/check-product-framing.mjs --list        scope and dispositions
//   node scripts/check-product-framing.mjs --self-test   prove the gate can fail
//
// WHY THIS EXISTS
// ---------------
// docs/PURPOSE.md is canonical (DR-019). It only stays canonical if other
// documents REFERENCE it rather than paraphrase it — paraphrase is precisely how
// "decision layer" mutates back into "trust fabric," "assist gate," or
// "orchestration platform." A census on 2026-08-26 found six competing framings
// across the tree against the canonical one in two files.
//
// WHY IT IS NARROW
// ----------------
// This is deliberately NOT the decision-vocabulary gate, which is a hard
// mechanical invariant over model names. Product language is contextual: the
// same string can be legitimate implementation vocabulary in one place and a
// competing company description in another. So this gate:
//
//   * scans ONLY current-truth surfaces (what a reader takes as product truth),
//   * leaves historical decision records and archived research untouched, so
//     provenance is preserved rather than rewritten,
//   * bans framings that name SignalGrid as something other than PURPOSE.md
//     says, and permits architecture language that merely describes how it works.
//
// A gate that rewrote history to satisfy present consistency would destroy the
// evidence trail this repository's decision records depend on.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SELF = "scripts/check-product-framing.mjs";

// Current-truth surfaces only. If a reader would take it as what SignalGrid IS
// today, it belongs here. Historical DRs, research and archives do not.
const SURFACES = [
  "README.md",
  "AGENTS.md",
  "CLAUDE.md",
  "docs/PURPOSE.md",
  "docs/LAUNCH_PROFILE.md",
  "docs/STATUS.md",
  "docs/WHAT_SIGNALGRID_DOES_TODAY.md",
];

// Retired framings: these name SignalGrid as a different thing than PURPOSE.md.
const RETIRED = [
  { re: /\btrust fabric\b/i, why: "retired framing; PURPOSE.md owns the product sentence" },
  { re: /\bShared-Device Trust Gateway\b/i, why: "DR-004 category label superseded by DR-019; no replacement label is ratified" },
  { re: /\bAssist gate\b/i, why: "retire where it describes SignalGrid itself; keep only where it names a real implementation mechanism" },
  { re: /\borchestration platform\b/i, why: "retired framing" },
  { re: /\bZero Trust orchestration platform\b/i, why: "retired framing" },
  { re: /\bevidence platform\b/i, why: "retired framing; evidence is part of a Decision Envelope, not the product" },
];

// Permitted as architecture description — NOT as an alternate product name.
// Listed so the distinction is explicit rather than folklore.
const ARCHITECTURE_LANGUAGE = [
  "decision layer",
  "runtime decision layer",
  "trust orchestration",
];

// A surface must anchor to the canonical framing rather than restate it.
const ANCHOR = /moment of use|docs\/PURPOSE\.md|PURPOSE\.md/i;
const MUST_ANCHOR = ["README.md", "AGENTS.md", "CLAUDE.md"];

if (process.argv.includes("--list")) {
  console.log("\nScope — current-truth surfaces only:\n");
  SURFACES.forEach((s) => console.log(`  ${s}`));
  console.log("\nRetired framings (fail on these surfaces):\n");
  RETIRED.forEach((r) => console.log(`  ${String(r.re).padEnd(46)} ${r.why}`));
  console.log("\nPermitted as architecture description, not as a product name:\n");
  ARCHITECTURE_LANGUAGE.forEach((a) => console.log(`  ${a}`));
  console.log(
    "\nHistorical decision records and archived research are deliberately NOT scanned:",
  );
  console.log("  provenance is preserved, not rewritten.\n");
  process.exit(0);
}

if (process.argv.includes("--self-test")) {
  const sample = "SignalGrid is a trust fabric for frontline devices.";
  const caught = RETIRED.some((r) => r.re.test(sample));
  console.log(
    caught
      ? "PASS  self-test — a retired framing on a current-truth surface is detected"
      : "FAIL  self-test — the gate would not catch a retired framing",
  );
  process.exit(caught ? 0 : 1);
}

const failures = [];

for (const file of SURFACES) {
  if (file === SELF || !existsSync(resolve(repo, file))) continue;
  const text = readFileSync(resolve(repo, file), "utf8");

  for (const { re, why } of RETIRED) {
    // Allow a deliberate, labelled historical reference on a current surface.
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      if (!re.test(line)) return;
      // Deliberate, labelled exceptions. A contributor must SAY why the term
      // stands, which is the difference between a considered use and drift.
      if (/superseded|historical|retired|DR-019|formerly|no longer/i.test(line)) return;
      // <!-- framing:mechanism --> marks a term naming a real implementation
      // mechanism (e.g. the gate inside EnterpriseShell) rather than describing
      // SignalGrid itself. Permitted, and visible in the diff.
      if (/framing:mechanism/i.test(line)) return;
      failures.push({
        file,
        line: i + 1,
        text: line.trim().slice(0, 96),
        why,
      });
    });
  }
}

// Entry-point surfaces must point at the canonical document, not paraphrase it.
for (const file of MUST_ANCHOR) {
  if (!existsSync(resolve(repo, file))) continue;
  const text = readFileSync(resolve(repo, file), "utf8");
  if (!ANCHOR.test(text)) {
    failures.push({
      file,
      line: 1,
      text: "(no reference to docs/PURPOSE.md or the canonical framing)",
      why: "entry-point surfaces must reference PURPOSE.md rather than restate the thesis",
    });
  }
}

if (failures.length) {
  console.error(`FAIL  ${failures.length} product-framing issue(s) on current-truth surfaces:\n`);
  for (const f of failures.slice(0, 25)) {
    console.error(`    ${f.file}:${f.line}`);
    console.error(`      ${f.text}`);
    console.error(`      → ${f.why}\n`);
  }
  if (failures.length > 25) console.error(`    … and ${failures.length - 25} more`);
  console.error(
    `docs/PURPOSE.md is canonical (DR-019). Reference it; do not paraphrase it.
Historical text may keep its terminology — label it historical, or leave it in
a decision record, which this gate does not scan.\n`,
  );
  process.exit(1);
}

console.log(
  `PASS  product framing — ${SURFACES.filter((s) => existsSync(resolve(repo, s))).length} current-truth surface(s) clean, history preserved.`,
);
