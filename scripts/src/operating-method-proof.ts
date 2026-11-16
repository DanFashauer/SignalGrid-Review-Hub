// Proof: the operating method is a GATE, not a memory.
//
// docs/SIGNALGRID_OPERATING_METHOD.md (intake row 76, adapted from the Fleet
// handbook's operating patterns) states how SignalGrid is run: handbook-first
// truth, opinion-vs-decision buckets, DRIs, wireframe-first, the one-repo rule,
// the GREEN/YELLOW/RED accountability ladder for AI-generated work, simple
// intake, launch-scope discipline, break-loudly, helper-first outreach, and the
// small fixed role set. A method that lives only in prose is rediscovered in
// every PR; this proof pins the checkable half so drift is loud.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DOC = join(repo, "docs/SIGNALGRID_OPERATING_METHOD.md");

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    passed += 1;
    console.log(`  ok — ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗  — ${name}${detail ? ` (${detail})` : ""}`);
  }
}

const src = readFileSync(DOC, "utf8");

// ── 1. The twelve sections exist, numbered, in order ──────────────────────────
const SECTIONS = [
  "Handbook-first product truth",
  "Opinion vs decision",
  "Directly responsible owner",
  "Wireframe-first design",
  "One repo, and the private-core exception",
  "AI-generated work accountability",
  "AI tooling policy",
  "Issue intake and work visibility",
  "Launch-scope discipline",
  "Incident and break-loudly doctrine",
  "Customer outreach principles",
  "Roles: simple UI roles, granular API permissions",
];
let lastIndex = -1;
let ordered = true;
for (const [i, title] of SECTIONS.entries()) {
  const idx = src.indexOf(`## ${i + 1}. ${title}`);
  check(`section ${i + 1} "${title}" exists`, idx !== -1);
  if (idx !== -1 && idx < lastIndex) ordered = false;
  lastIndex = Math.max(lastIndex, idx);
}
check("the twelve sections appear in order", ordered);

// ── 2. The load-bearing definitions are present, not paraphrased away ─────────
check("the five disposition buckets are all named", ["launch-critical", "deferred roadmap", "research reference", "refused", "owner decision required"].every((b) => src.includes(b)));
check("the GREEN/YELLOW/RED ladder is defined with all three rungs", ["**GREEN**", "**YELLOW**", "**RED**"].every((r) => src.includes(r)));
check("wireframe-first names its no-code-before-wireframe scope", src.includes("No code before wireframe"));
check("the doc anchors product truth to WHAT_SIGNALGRID_DOES_TODAY", src.includes("WHAT_SIGNALGRID_DOES_TODAY.md"));
check("human review is stated as non-substitutable", src.includes("AI review is not a substitute for human review"));
check("helper-first positioning is additive, never a replacement claim", src.includes("You already have IAM, UEM, EDR, SIEM, ITSM"));

// ── 3. Every relative markdown link resolves ─────────────────────────────────
// NEGATED PREFIX, NOT A NEGATED CHARACTER CLASS. This was
// `/\]\(([^)#http][^)]*\.md)\)/g` — `[^)#http]` means "one character that is not
// `)`, `#`, `h`, `t` or `p`", so every relative link whose filename STARTS with h,
// t or p (handbook.md, protocol.md, team.md) was silently excluded from the
// resolve check below. The doc happens to carry none today and the non-vacuity
// floor is `>= 4` against exactly four links, so adding a fifth companion named
// `handbook.md` would leave the count at 4, the floor passing, and a phantom link
// shipping green. The lookahead form is what the sibling scanners already use
// (municipal-resilience-proof.ts, itom-itsm-bridge-proof.ts).
const LINK_PATTERN = /\]\(((?!https?:)[^)#]+\.md)\)/g;
const links = [...src.matchAll(LINK_PATTERN)].map((m) => m[1]);
// SELF-TEST of the scanner, because the floor below cannot see a link the scanner
// never produced: under the old character class this probe yields NOTHING and the
// doc-side count is unchanged, which is exactly how the hole stayed invisible.
const LINK_PROBE = "see [h](handbook.md), [t](team.md), [p](protocol.md), [abs](https://example.com/a.md), [anchor](CI_AND_VALIDATION.md#section)";
const probeHits = [...LINK_PROBE.matchAll(LINK_PATTERN)].map((m) => m[1]);
check("SELF-TEST: the link scanner sees companions whose names start with h/t/p, and still skips absolute URLs and anchored links",
  probeHits.join(",") === "handbook.md,team.md,protocol.md", `probe=[${probeHits.join(",")}]`);
check("the doc carries relative links to its companions (non-vacuity)", links.length >= 4, `links=${links.length}`);
for (const l of links) {
  check(`link resolves: ${l}`, existsSync(join(repo, "docs", l)));
}

// ── 4. Every intake row carries a disposition (the §2 rule, mechanically) ─────
const ledger = readFileSync(join(repo, "docs/INTAKE_LEDGER.md"), "utf8");
const rows = [...ledger.matchAll(/^\| (\d+) \|(.*)$/gm)];
check("the intake ledger has rows to check (non-vacuity)", rows.length >= 70, `rows=${rows.length}`);
const dispositionless: string[] = [];
for (const [, num, rest] of rows) {
  // A row's final cell is its disposition; the ledger bolds the verdict
  // (**BUILT**/**COVERED**/**DEFERRED**/…) or marks it PENDING while open.
  const cells = rest.split("|").map((c) => c.trim()).filter((c) => c.length > 0);
  const last = cells[cells.length - 1] ?? "";
  if (!(last.includes("**") || last.includes("PENDING"))) dispositionless.push(num);
}
check("every intake row carries a disposition (or an honest PENDING)", dispositionless.length === 0, `rows without: ${dispositionless.join(",")}`);

// Negative control: a synthetic dispositionless row IS detected.
const syntheticCells = " **fake input** | some assessment | plain text with no verdict".split("|").map((c) => c.trim()).filter(Boolean);
const syntheticLast = syntheticCells[syntheticCells.length - 1] ?? "";
check("NEGATIVE CONTROL — a row whose last cell has no bold verdict would be flagged", !(syntheticLast.includes("**") || syntheticLast.includes("PENDING")));

// ── 5. The role set the doc ratifies is the role set the code enforces ────────
const auth = readFileSync(join(repo, "lib/signalgrid-core/src/auth.ts"), "utf8");
for (const role of ["owner", "operator", "auditor", "connector"]) {
  check(`ratified role "${role}" exists in auth.ts`, new RegExp(`\\b${role}:`).test(auth));
}

const total = passed + failures.length;
console.log(`\nsummary=${failures.length === 0 ? "pass" : "FAIL"} (${passed}/${total})`);
console.log(`figures=sections=${SECTIONS.length},ledgerRows=${rows.length}`);
if (failures.length > 0) {
  console.error("failed:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("operating method pinned: sections, buckets, ladder, intake dispositions, links, roles.");
