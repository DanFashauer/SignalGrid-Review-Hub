#!/usr/bin/env node
// Regenerate docs/CLAIM_INVENTORY.md from its machine twin, and GATE that the
// committed copy still matches. The JSON is the source of truth (complete text,
// structured fields); the Markdown is the human rendering and is ALWAYS derived
// — never hand-edit a row here, edit the JSON and re-run:
//
//   node scripts/gen-claim-inventory-md.mjs             regenerate (writes)
//   node scripts/gen-claim-inventory-md.mjs --check     gate: fail on drift (writes nothing)
//   node scripts/gen-claim-inventory-md.mjs --self-test prove the gate can fail
//
// WHY --check EXISTS. The document this script writes says, in its own preamble,
// that it "is regenerated from [the JSON] by `node scripts/gen-claim-inventory-md.mjs`
// and must not be row-edited by hand." Nothing enforced either half. The generator
// was invoked by no lane and no workflow — every reference to it in the repository
// was inside this file or inside the sentence above — so the JSON could gain, lose
// or reword a row and the published Markdown would keep saying the old thing, with
// its own preamble vouching for it. A derived artifact nobody re-derives is a
// hand-maintained artifact that claims not to be, which is the exact fossil shape
// CLAUDE.md names.
//
// GATED vs REPORTED: this is GATED, and only over an unambiguous question —
// byte equality between the committed Markdown and the render of the JSON. It
// judges nothing about whether a claim is TRUE or correctly classified; that is
// the launch-claims work, and this gate makes no statement about it.
//
// Cells render COMPLETE: pipes escaped, newlines collapsed, no length caps.
// The first version sliced cells at 200-300 chars and paid for it twice —
// a truncated `pnpm run proof:signalgr` became a phantom command citation,
// and cut evidence made the md useless as the JSON's human twin.
import { readFileSync, writeFileSync } from "node:fs";

const JSON_PATH = "docs/agent/CLAIM_INVENTORY.json";
const MD_PATH = "docs/CLAIM_INVENTORY.md";

const CHECK = process.argv.includes("--check");
const SELF_TEST = process.argv.includes("--self-test");

// FLOORS, deliberately far below the live numbers (1,023 rows / 87 files at the
// time of writing) and never equal to them. They exist to catch a render that
// resolved NOTHING — an empty `rows`, a renamed field, a JSON that parsed but is
// no longer this shape — because a gate comparing two empty documents passes and
// is green about nothing. They must NOT track the real count: a floor that equals
// the current number is a fossil that fails on the next honest edit. Same idiom
// as AGENT_FLOOR in check-agent-roster.mjs.
const ROW_FLOOR = 100;
const FILE_FLOOR = 10;

/**
 * Pure render: inventory object -> the complete Markdown document.
 * Pure so the gate and the self-test can exercise it without touching the disk.
 */
export function renderInventory(d) {
  // A stored figure the render never consults is a fossil waiting to happen: the
  // JSON carries rowCount (and, when present, counts/actions) beside `rows`, and
  // nothing recomputes them. Refuse to render when they disagree with `rows`.
  if (d.rowCount !== undefined && d.rowCount !== d.rows.length) {
    throw new Error(`CLAIM_INVENTORY.json stores rowCount=${d.rowCount} but carries ${d.rows.length} rows — the stored figure drifted from the data it summarises`);
  }
const rows = d.rows;
const n = rows.length;

const count = (k) => rows.filter((r) => r.classification === k).length;
const actionCount = (a) => rows.filter((r) => (r.action ?? "keep") === a).length;
const counts = { launch: count("launch"), deferred: count("deferred"), "demo-only": count("demo-only"), unsubstantiated: count("unsubstantiated") };
const actions = { remove: actionCount("remove"), rewrite: actionCount("rewrite"), keep: actionCount("keep") };

// Backslashes FIRST, then pipes — escaping the pipe alone lets a value that
// ends in a backslash swallow the escape (CodeQL js/incomplete-sanitization).
const esc = (t) =>
  String(t ?? "").replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\]\(/g, "]\\(").replace(/\s*\n\s*/g, " ").trim();
const res = (r) => (r.resolution ? ` ✔ ${esc(r.resolution)}` : "");

const bySurface = new Map();
for (const r of rows) {
  if (!bySurface.has(r.file)) bySurface.set(r.file, []);
  bySurface.get(r.file).push(r);
}
const order = { remove: 0, rewrite: 1, keep: 2 };
const clsOrder = { unsubstantiated: 0, deferred: 1, "demo-only": 2, launch: 3 };

const out = [];
out.push(`# Claim inventory — every buyer-facing assertion, classified

Generated ${d.generated} from a full-surface extraction pass (per-surface agents
plus an adversarial completeness critic), corrected against the critic's
findings and reviewer findings since. **This inventory records and classifies
claims; it does not rewrite copy** — backlog row 6 executes the rewrite
against it. The machine-readable twin — and the SOURCE OF TRUTH — is
[\`docs/agent/CLAIM_INVENTORY.json\`](agent/CLAIM_INVENTORY.json); this file is
regenerated from it by \`node scripts/gen-claim-inventory-md.mjs\` and must not
be row-edited by hand.

## How the surface list was derived (re-derivable)

The scan set is the union of the public claim surfaces the existing gates
already enumerate — the docs-sanity SCAN_PATHS app trees plus README and the
two self-contained consoles — so a new page cannot be silently omitted (the
failure \`scripts/launch-profile.mjs:84-90\` records for app-surfaces):

- \`README.md\`, every file under \`artifacts/signalgrid-web/src/pages/\` and
  \`artifacts/signalgrid-web/src/components/sections/\`;
- \`artifacts/signalgrid-review/src\`, \`artifacts/signalgrid-app/src\`,
  \`artifacts/signalgrid-desktop/src\`, \`artifacts/signalgrid-mobile-pwa/src\`
  (rendered app copy — the same trees \`scripts/docs-sanity.mjs\` scans);
- \`docs/fabric-console.html\` and \`docs/room-entry-console.html\`.

## Snapshot semantics

The inventory records the tree **as of its extraction commit**; a claim a PR
removes or rewrites keeps its row — marked **✔ RESOLVED** — because the row is
the evidence the correction answered. Rows without a resolution marker
describe the checked-in surfaces. Since 2026-09-06 \`scripts/check-claim-inventory-anchors.mjs\`
holds every quoted row to its surface: a quotation more than ten lines from
its citation fails until \`--write\` re-anchors it, and the count of quotations
absent without a resolution is ratcheted (it may only fall — the live figures
are in \`docs/agent/claim-inventory-anchors-ratchet.json\`). The same gate holds
each row's \`evidence\`: every root-anchored \`path:line\` must exist, a quoted
fragment must sit within ten lines of it, and a citation into
\`scripts/launch-profile.mjs\` that names an id and an arm is tested by importing
the profile's SURFACES — the arm, never the line number. Whether a NEW
claim on a surface has a row is still nobody's gate; extraction remains a
manual pass, and the README rows were re-extracted on 2026-09-06 against the
2026-09-01 rebuild.

## Ground truth

Classification is against the ratified launch profile (\`scripts/launch-profile.mjs\`,
DR-005): **launch** = grounded in a launch-profile entry, a \`pnpm run proof:*\`
command that exists, or a served OpenAPI path (the grounding is cited and was
verified); **deferred** = the capability exists in the tree but is outside the
ratified launch scope; **demo-only** = true of a demo-classified surface only;
**unsubstantiated** = no artifact in the tree backs it. Every non-launch row
cites its contradicting artifact.

## The headline numbers

**${n} claims** across ${bySurface.size} files: ${counts.launch} launch,
${counts.deferred} deferred, ${counts["demo-only"]} demo-only,
${counts.unsubstantiated} unsubstantiated. Actions owed by row 6:
**${actions.remove} remove**, **${actions.rewrite} rewrite**, ${actions.keep} keep.

## The dimension-count conflict, resolved

Three different counts of what SignalGrid evaluates today are published:
**six** (README.md:3, Pricing.tsx:16), **five** (docs/WHAT_SIGNALGRID_DOES_TODAY.md:80,
:169-170), **three** (the ratified launch profile, scripts/launch-profile.mjs:243-252).
The one defensible public number is **three** — device posture, device-management
health, and local authority — because it is the only count with a ratifying
decision record and an enforcing gate. README.md:3, Pricing.tsx:16 and both
WHAT_SIGNALGRID_DOES_TODAY.md lines must move to it together (rows below).

## Honesty note on review depth

The completeness critic fully re-audited README.md and Pricing.tsx (every
launch grounding executed or opened; three misclassifications found and
corrected), re-verified the Federal.tsx hot rows directly against
\`docs/SECURITY_BASELINE_ALIGNMENT.md\`, and recovered 16 missed claims. The
app-tree surfaces were extracted in a second pass after review found the
first derivation incomplete. Remaining surfaces carry single-pass extraction;
row 6's gate build should re-verify any row it acts on.
`);

out.push("## Claims that must be REMOVED or REWRITTEN before anything is published\n");
out.push("| File:line | Claim | Class | Why (contradicting artifact) |");
out.push("|---|---|---|---|");
for (const r of rows) {
  if ((r.action ?? "keep") === "keep") continue;
  out.push(`| \`${r.file}:${r.line}\` (${r.action}) | ${esc(r.claim)} | ${r.classification} | ${esc(r.evidence)}${res(r)} |`);
}

out.push("\n## Full inventory, per surface\n");
for (const [f, rs] of bySurface) {
  out.push(`### \`${f}\` — ${rs.length} claims\n`);
  out.push("| Line | Claim | Kind | Class | Action | Evidence |");
  out.push("|---|---|---|---|---|---|");
  const sorted = [...rs].sort(
    (a, b) => (order[a.action ?? "keep"] ?? 3) - (order[b.action ?? "keep"] ?? 3) || (clsOrder[a.classification] ?? 9) - (clsOrder[b.classification] ?? 9),
  );
  for (const r of sorted) {
    out.push(`| ${esc(r.line)} | ${esc(r.claim)} | ${r.kind ?? ""} | ${r.classification} | ${r.action ?? "keep"} | ${esc(r.evidence)}${res(r)} |`);
  }
  out.push("");
}

return { text: out.join("\n") + "\n", rows: n, files: bySurface.size, actions };
}

/** SELF-TEST — a gate that has never failed proves nothing. */
function selfTest() {
  const checks = [];

  // 1. The render is non-vacuous over the REAL inventory: above both floors.
  const live = renderInventory(JSON.parse(readFileSync(JSON_PATH, "utf8")));
  checks.push([
    `the real inventory renders above the floors (rows ${live.rows} >= ${ROW_FLOOR}, files ${live.files} >= ${FILE_FLOOR})`,
    live.rows >= ROW_FLOOR && live.files >= FILE_FLOOR && live.text.length > 0,
  ]);

  // 2. A SYNTHETIC VIOLATION must be flagged. One character of drift in a cell —
  //    the smallest edit a hand-editor could make — must not compare equal.
  const synthetic = {
    generated: "2026-01-01",
    rows: [
      { file: "a.tsx", line: 1, claim: "c", kind: "k", classification: "launch", action: "keep", evidence: "e" },
    ],
  };
  const clean = renderInventory(synthetic).text;
  const drifted = clean.replace("| c |", "| c! |");
  checks.push(["a one-character planted drift is DETECTED", drifted !== clean && clean.includes("| c |")]);
  // 4b. A stored rowCount that drifted from `rows` is REFUSED, not rendered around.
  //     The catch is NARROW on purpose: a ReferenceError (or any error that is not
  //     the guard speaking) means the check itself broke, and a broken check must
  //     rethrow rather than count itself green. It scored green for exactly that
  //     reason once — see the note beside the `inventory` declaration below.
  let refused = false;
  try {
    renderInventory({ ...inventory, rowCount: inventory.rows.length + 1 });
  } catch (err) {
    if (err instanceof ReferenceError || err instanceof TypeError) throw err;
    refused = /rowCount/.test(err.message);
  }
  checks.push(["a stored rowCount that disagrees with rows is refused by the render", refused]);
  // …and the guard does not fire on an AGREEING rowCount, so 4b is not vacuous
  // in the other direction either (a renderer that threw unconditionally would
  // satisfy the check above while breaking every honest render).
  let agreed = true;
  try {
    renderInventory({ ...inventory, rowCount: inventory.rows.length });
  } catch {
    agreed = false;
  }
  checks.push(["a stored rowCount that AGREES with rows still renders", agreed]);

  // 3. …and an undrifted render compares EQUAL, so the pass is not vacuous.
  checks.push(["an identical render compares equal (the gate can also pass)", renderInventory(synthetic).text === clean]);

  // 4. The floors themselves can fail: an empty inventory must not clear them.
  const empty = renderInventory({ generated: "2026-01-01", rows: [] });
  checks.push(["an EMPTY inventory falls below the floors", !(empty.rows >= ROW_FLOOR && empty.files >= FILE_FLOOR)]);

  let bad = 0;
  for (const [name, ok] of checks) {
    console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}`);
    if (!ok) bad += 1;
  }
  if (bad) {
    console.error(`\nSELF-TEST FAILED — ${bad} check(s). The renderer or the comparison has drifted;`);
    console.error("a gate that cannot fail is green about nothing.");
    return 1;
  }
  console.log("\nSelf-test green — the check detects planted drift, passes on a match, and refuses an empty render.");
  return 0;
}

// DECLARED BEFORE the self-test dispatch, deliberately. `selfTest()` reads
// `inventory` (check 4b); while this `const` sat BELOW `if (SELF_TEST)` the
// reference hit the temporal dead zone, threw a ReferenceError, and the bare
// `catch` in that check scored the crash as "the render refused" — so check 4b
// passed with the rowCount guard DELETED from the renderer. A self-test that
// cannot fail is the defect this file's own header warns about.
const inventory = JSON.parse(readFileSync(JSON_PATH, "utf8"));

if (SELF_TEST) process.exit(selfTest());

const rendered = renderInventory(inventory);

// Floors apply to the GATE too, not only the self-test: a render that resolved
// nothing must refuse rather than agree with an equally empty file.
if (rendered.rows < ROW_FLOOR || rendered.files < FILE_FLOOR) {
  console.error(
    `✗ ${JSON_PATH} rendered ${rendered.rows} row(s) across ${rendered.files} file(s) — below the floors ` +
      `(${ROW_FLOOR}/${FILE_FLOOR}). The inventory is unreadable or its shape changed; refusing to ` +
      "conclude anything from a render that found nothing.",
  );
  process.exit(1);
}

if (CHECK) {
  let onDisk;
  try {
    onDisk = readFileSync(MD_PATH, "utf8");
  } catch (err) {
    console.error(`✗ ${MD_PATH} is unreadable (${err.message}) — the derived document is missing.`);
    process.exit(1);
  }
  if (onDisk !== rendered.text) {
    // Name the FIRST differing line: "run the generator" is advice, "line 412 differs"
    // is a finding somebody can act on without re-deriving it themselves.
    const a = onDisk.split("\n");
    const b = rendered.text.split("\n");
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
    // Window the excerpt around the first differing COLUMN, not around column 0.
    // A fixed head-slice printed two identical-looking lines when the drift sat
    // 300 characters in — a "finding" a reader cannot see is not a finding.
    const la = a[i] ?? "";
    const lb = b[i] ?? "";
    let c = 0;
    while (c < la.length && c < lb.length && la[c] === lb[c]) c += 1;
    const from = Math.max(0, c - 40);
    const win = (l) => (l === undefined ? "<end of file>" : (from > 0 ? "…" : "") + l.slice(from, c + 80) + (l.length > c + 80 ? "…" : ""));
    console.error(`✗ ${MD_PATH} is STALE — it does not match a fresh render of ${JSON_PATH}.`);
    console.error(`  First difference at line ${i + 1}, column ${c + 1}:`);
    console.error(`    committed: ${JSON.stringify(win(a[i]))}`);
    console.error(`    rendered:  ${JSON.stringify(win(b[i]))}`);
    console.error(`  The Markdown is DERIVED and its own preamble says so. Edit ${JSON_PATH},`);
    console.error("  then run `node scripts/gen-claim-inventory-md.mjs` and commit both.");
    process.exit(1);
  }
  console.log(
    `Claim-inventory drift check passed — ${MD_PATH} matches a fresh render of ${JSON_PATH} ` +
      `(${rendered.rows} rows across ${rendered.files} files).`,
  );
  process.exit(0);
}

writeFileSync(MD_PATH, rendered.text);
console.log(`Regenerated ${MD_PATH}: ${rendered.rows} rows across ${rendered.files} files (${JSON.stringify(rendered.actions)})`);
