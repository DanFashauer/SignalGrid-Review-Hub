// Docs↔proof FIGURE guard — the numbers, not just the check counts.
//
// `check-proof-counts.mjs` already guards one number per proof: the `(N checks)` a doc
// advertises. That caught real drift and it is not enough, because the numbers that
// actually carry the argument are the other ones — how large a space was enumerated, and
// how many states grant. Those went stale three separate times in one working session:
//
//   1. `INTEGRATION_CATALOG` quoted "eight" reason-code changes and "1,788" unknownSignals
//      as measurements "over the full raw space", two lines below a sentence declaring
//      that space to be 1,037,232. They were the PRE-SPLIT figures, correct against a
//      space 64x smaller. Nothing noticed; an adversarial reviewer re-derived them.
//   2. A PR body advertised "141 checks" and "1,037,232 raw reports" after both had moved.
//   3. `SELF_REVIEW` said `link-usability` pins "exactly six" granting shapes — true when
//      written, false two commits later when review found three of the six were
//      self-contradictory. It went stale INSIDE the pull request that made it false.
//
// The common shape: a number stated as a measurement, and then the thing it measured
// changed. A reader has no way to tell a live figure from a fossil, and the fossil is
// more persuasive than it deserves to be because it looks precise.
//
// HOW THIS WORKS. Each participating proof emits one machine-readable line:
//
//     figures=normalized=21600,raw=1354752,grants=3
//
// The guard runs the proof, reads that line, and then scans the docs. In any PARAGRAPH
// that names the proof, every comma-formatted number >= 1,000 must be one of that proof's
// live figures — unless it is marked historical.
//
// HISTORICAL NUMBERS ARE LEGITIMATE and the repo uses them deliberately ("proof 96 -> 162
// checks", "down from six once the roam contradiction was modelled"). They are recognised
// by the words around them rather than by an allowlist, because an allowlist of numbers
// would itself go stale — which is the whole failure being guarded against. A number
// introduced by was/were/from/previously/originally/earlier/before/until/rather than is
// read as a deliberate comparison to a past state and left alone.

import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** True only when this file is the entrypoint, so another script can import its
 *  registry without running the gate. */
const IS_MAIN = process.argv[1] !== undefined && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href;
const docsDir = join(repoRoot, "docs");

/** Proofs that emit a `figures=` line. A proof that does not is simply not checked here —
 *  this guard never invents a figure it was not given. */
export const PROOFS = ["proof:device-management-health", "proof:link-usability", "proof:task-exception", "proof:verdict-attestation", "proof:work-context", "proof:handoff-sim"];

/** Words marking a number as a deliberate reference to a PAST value or a counterfactual.
 *
 *  Checked on BOTH sides. The first version looked only behind the number, and missed
 *  "…read eight and 1,788 UNTIL a review re-derived them" — where the marker follows what
 *  it qualifies, which is ordinary English. A one-directional check would have forced that
 *  sentence to be rewritten to suit the tool rather than the reader. */
const MARKER =
  "was|were|from|previously|originally|earlier|before|until|had|used to|rather than|instead of|down to|up to|would|counterfactual|no longer|→|->";
const HISTORICAL_BEFORE = new RegExp(`\\b(?:${MARKER})\\b[^.]{0,60}$`, "i");
const HISTORICAL_AFTER = new RegExp(`^[^.]{0,60}\\b(?:${MARKER})\\b`, "i");

/** Comma-formatted integers of four digits or more — the shape a measured figure takes in
 *  this repo's prose. Plain four-digit numbers without separators are skipped: they are
 *  far more often years or identifiers than figures. */
const FIGURE_RE = /\b\d{1,3}(?:,\d{3})+\b/g;

function liveFigures(proof) {
  const run = spawnSync("pnpm", ["run", proof], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 180_000,
  });
  const out = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  const line = out.match(/^figures=(.+)$/m);
  if (!line) return null;
  const values = new Set();
  for (const pair of line[1].split(",")) {
    const [, v] = pair.split("=");
    const n = Number(v);
    if (Number.isFinite(n)) {
      values.add(n);
      values.add(n.toLocaleString("en-US"));
    }
  }
  return values;
}

/** Scope by SECTION, not paragraph.
 *
 *  Paragraph scope was the first attempt and it was too narrow to catch the drift that
 *  actually happened: the stale "eight" and "1,788" sat in a paragraph about a REMOVED
 *  guard, several paragraphs from the one naming the proof. A doc section is the unit a
 *  reader treats as being about one thing, so it is the unit the figures belong to. */
function sectionsMentioning(text, needle) {
  const lines = text.split("\n");
  const bounds = [];
  lines.forEach((l, i) => {
    if (/^#{2,3} /.test(l)) bounds.push(i);
  });
  bounds.push(lines.length);
  const sections = [];
  for (let i = 0; i < bounds.length - 1; i += 1) {
    sections.push(lines.slice(bounds[i], bounds[i + 1]).join("\n"));
  }
  // A doc with no headings is one section.
  if (sections.length === 0) sections.push(text);
  return sections.filter((sec) => sec.includes(needle)).map((sec) => ({ p: sec }));
}

function main() {
  console.log("Docs↔proof FIGURE guard — a number stated as a measurement must still be one\n");

  let failures = 0;
  let checked = 0;
  const docFiles = readdirSync(docsDir).filter((f) => f.endsWith(".md"));

  for (const proof of PROOFS) {
    const figures = liveFigures(proof);
    if (figures === null) {
      console.error(`✗ ${proof} — emitted no \`figures=\` line. Add one, or remove it from PROOFS.`);
      failures += 1;
      continue;
    }
    const live = [...figures].filter((v) => typeof v === "string").sort();
    console.log(`  ${proof} — live figures: ${live.join(", ")}`);

    for (const file of docFiles) {
      const text = readFileSync(join(docsDir, file), "utf8");
      for (const { p } of sectionsMentioning(text, proof)) {
        for (const m of p.matchAll(FIGURE_RE)) {
          checked += 1;
          if (figures.has(m[0])) continue;
          // A deliberate comparison to a past value or a counterfactual, in either
          // direction. Judged by the words around the number rather than by an allowlist of
          // numbers — an allowlist of numbers would itself go stale, which is the exact
          // failure being guarded against.
          const before = p.slice(0, m.index);
          const after = p.slice(m.index + m[0].length);
          if (HISTORICAL_BEFORE.test(before) || HISTORICAL_AFTER.test(after)) continue;
          console.error(`\n✗ docs/${file} — "${m[0]}" is stated in a paragraph about ${proof},`);
          console.error(`  but that proof's live figures are: ${live.join(", ")}`);
          const line = p.split("\n").find((l) => l.includes(m[0])) ?? "";
          console.error(`  ${line.trim().slice(0, 160)}`);
          failures += 1;
        }
      }
    }
  }

  console.log(`\nfigures checked in docs: ${checked}`);

  if (failures > 0) {
    console.error(
      `\nFigure guard FAILED: ${failures} problem${failures === 1 ? "" : "s"}.\n\n` +
        "A number presented as a measurement has to still be one. Either re-measure and update\n" +
        "the doc, or — if the number is a deliberate reference to a past value — write it that\n" +
        'way ("was 1,037,232", "down from 21,168"), which is both clearer and recognised here.\n',
    );
    process.exit(1);
  }

  console.log("Figure guard passed — every measured figure in the docs matches a live proof run.");

}

if (IS_MAIN) main();
