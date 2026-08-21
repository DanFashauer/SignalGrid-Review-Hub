#!/usr/bin/env node
// Regenerate docs/CLAIM_INVENTORY.md from its machine twin. The JSON is the
// source of truth (complete text, structured fields); the Markdown is the
// human rendering and is ALWAYS derived — never hand-edit a row here, edit
// the JSON and re-run:
//
//   node scripts/gen-claim-inventory-md.mjs
//
// Cells render COMPLETE: pipes escaped, newlines collapsed, no length caps.
// The first version sliced cells at 200-300 chars and paid for it twice —
// a truncated `pnpm run proof:signalgr` became a phantom command citation,
// and cut evidence made the md useless as the JSON's human twin.
import { readFileSync, writeFileSync } from "node:fs";

const JSON_PATH = "docs/agent/CLAIM_INVENTORY.json";
const MD_PATH = "docs/CLAIM_INVENTORY.md";

const d = JSON.parse(readFileSync(JSON_PATH, "utf8"));
const rows = d.rows;
const n = rows.length;

const count = (k) => rows.filter((r) => r.classification === k).length;
const actionCount = (a) => rows.filter((r) => (r.action ?? "keep") === a).length;
const counts = { launch: count("launch"), deferred: count("deferred"), "demo-only": count("demo-only"), unsubstantiated: count("unsubstantiated") };
const actions = { remove: actionCount("remove"), rewrite: actionCount("rewrite"), keep: actionCount("keep") };

const esc = (t) => String(t ?? "").replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();
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
describe the checked-in surfaces. The source↔inventory synchronization gate
(a stale row must fail, a new claim must fail) is backlog row 6's
launch-claims gate, which consumes this file; until it exists, regeneration
is manual and marked.

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

writeFileSync(MD_PATH, out.join("\n") + "\n");
console.log(`Regenerated ${MD_PATH}: ${n} rows across ${bySurface.size} files (${JSON.stringify(actions)})`);
