// Doc line-count figures — `lib/x/src/y.ts (245)` must still be 245 lines.
//
//   node scripts/check-doc-line-counts.mjs               # gate: every figure matches wc -l
//   node scripts/check-doc-line-counts.mjs --self-test   # a planted drift must fail; a clean tree must pass
//
// WHY THIS EXISTS. docs/COMPANY_BUILD_PLAN.md's tier lists cite files with their
// line counts — `lib/persistence/src/session-store.ts (228)` — as a size signal for
// the reader deciding where to look first. They were measured once, on the day
// the list was written, and quoted forever: on 2026-09-05, 20 of the 29 such
// figures in the tree were wrong, three of them by more than a hundred lines
// (evidence.ts said 340 and was 750; v1.ts said 923 and was 1,023). A figure
// that is derivable in a second and re-measured never is the ordinary way a
// document lies; check-derived-doc-figures.mjs holds the named figures (proof
// counts, gate counts) to the tree, and this holds the `path (N)` shape the same
// way. Same rule as that gate: update the sentence, never the deriver.
//
// WHAT COUNTS. A repo-relative path with a source/doc extension, optionally in
// backticks, followed by ` (N)` with N a bare integer. A dated record is exempt:
// docs/agent/EVIDENCE.md is a ledger of what was measured AT THAT READ, and
// re-measuring it would rewrite history. Every exemption carries its reason and
// must still match something, or it is a hole.
//
// N is `wc -l`: the number of newline characters. That is what every figure in
// the tree was measured with, and it is the number the next person will measure
// with too.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// SOURCE and DOC extensions only. A JSON fixture's `(N)` is a RECORD count
// (`microsoft-graph-posture.json (3)` is three scenarios, CLAIM_INVENTORY.md:1597),
// never a line count, so .json is deliberately absent from this set.
const FIGURE =
  /`?((?:lib|artifacts|scripts|native|tools|docs|fixtures|config|docker|fleet|site)\/[A-Za-z0-9_./-]+\.(?:ts|tsx|mts|mjs|js|swift|kt|md|yml|yaml|sh))`? \((\d+)\)/g;

/** Docs whose figures are RECORDS of a past measurement, not claims about the tree. */
const EXEMPT = new Map([
  ["docs/agent/EVIDENCE.md", "a dated ledger: a figure there records the line count at the read it describes, and re-measuring it would rewrite the record"],
]);

const HIT_FLOOR = 20; // the real tree carries ~29; fewer means the matcher stopped matching, not that the docs got honest

function lineCount(text) {
  let n = 0;
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) n += 1;
  return n;
}

/** Every `path (N)` figure in the doc text, with the file's real count under `root`. */
function figuresIn(docRel, text, root) {
  const out = [];
  const lines = text.split("\n");
  lines.forEach((line, idx) => {
    for (const m of line.matchAll(FIGURE)) {
      const rel = m[1];
      const stated = Number(m[2]);
      const abs = join(root, rel);
      const actual = existsSync(abs) ? lineCount(readFileSync(abs, "utf8")) : null;
      out.push({ doc: docRel, line: idx + 1, path: rel, stated, actual });
    }
  });
  return out;
}

function trackedDocs(root) {
  const out = execFileSync("git", ["-C", root, "ls-files", "--", "*.md"], { encoding: "utf8" });
  return out.split("\n").filter((f) => f.startsWith("docs/") || f === "README.md" || f === "CLAUDE.md");
}

function audit(root, docs, exempt) {
  const figures = [];
  for (const d of docs) figures.push(...figuresIn(d, readFileSync(join(root, d), "utf8"), root));
  const problems = [];
  const exemptHits = new Map([...exempt.keys()].map((k) => [k, 0]));
  for (const f of figures) {
    if (exempt.has(f.doc)) {
      exemptHits.set(f.doc, exemptHits.get(f.doc) + 1);
      continue;
    }
    if (f.actual === null) problems.push(`${f.doc}:${f.line} cites ${f.path} (${f.stated}) but the file does not exist`);
    else if (f.actual !== f.stated) problems.push(`${f.doc}:${f.line} states ${f.path} (${f.stated}), but the file is ${f.actual} lines — update the sentence`);
  }
  for (const [doc, n] of exemptHits) {
    if (n === 0) problems.push(`exemption for ${doc} matches no figure any more — remove it (a stale exemption is a hole)`);
  }
  return { figures, problems };
}

function selfTest() {
  const checks = [];
  const temp = mkdtempSync(join(tmpdir(), "sg-doc-line-counts-"));
  try {
    execFileSync("git", ["-C", temp, "init", "-q"]);
    mkdirSync(join(temp, "lib/planted/src"), { recursive: true });
    mkdirSync(join(temp, "docs/agent"), { recursive: true });
    writeFileSync(join(temp, "lib/planted/src/index.ts"), "a\nb\nc\n"); // 3 lines
    writeFileSync(join(temp, "docs/PLAN.md"), "1. lib/planted/src/index.ts (3) — right.\n");
    writeFileSync(join(temp, "docs/agent/EVIDENCE.md"), "read `lib/planted/src/index.ts (99)` on a past day\n");
    execFileSync("git", ["-C", temp, "add", "-A"]);
    const docs = ["docs/PLAN.md", "docs/agent/EVIDENCE.md"];

    const clean = audit(temp, docs, EXEMPT);
    checks.push(["a correct figure passes", clean.problems.length === 0 && clean.figures.length === 2]);

    writeFileSync(join(temp, "docs/PLAN.md"), "1. lib/planted/src/index.ts (4) — drifted.\n");
    const drift = audit(temp, docs, EXEMPT);
    checks.push(["a drifted figure FAILS and names the real count", drift.problems.length === 1 && /is 3 lines/.test(drift.problems[0])]);

    writeFileSync(join(temp, "docs/PLAN.md"), "1. `lib/planted/src/index.ts` (3) in backticks.\n");
    checks.push(["a backticked path is matched", audit(temp, docs, EXEMPT).figures.some((f) => f.doc === "docs/PLAN.md" && f.stated === 3)]);

    writeFileSync(join(temp, "docs/PLAN.md"), "see lib/planted/src/index.ts (12 routes) and lib/planted/src/index.ts(3)\n");
    checks.push(["'(12 routes)' and a missing space are NOT figures", audit(temp, docs, EXEMPT).figures.filter((f) => f.doc === "docs/PLAN.md").length === 0]);

    writeFileSync(join(temp, "docs/PLAN.md"), "packs: fixtures/planted/pack.json (3) scenarios\n");
    checks.push(["a JSON fixture's (N) is a record count, not a line count — not matched", audit(temp, docs, EXEMPT).figures.filter((f) => f.doc === "docs/PLAN.md").length === 0]);

    writeFileSync(join(temp, "docs/PLAN.md"), "1. lib/planted/src/gone.ts (3)\n");
    checks.push(["a figure for a file that does not exist FAILS", /does not exist/.test(audit(temp, docs, EXEMPT).problems[0] ?? "")]);

    checks.push(["the EVIDENCE.md exemption is honoured (a stale figure there is not a failure)", clean.problems.length === 0]);

    writeFileSync(join(temp, "docs/agent/EVIDENCE.md"), "no figures here\n");
    writeFileSync(join(temp, "docs/PLAN.md"), "1. lib/planted/src/index.ts (3)\n");
    checks.push(["an exemption that matches nothing is itself a failure", /matches no figure/.test(audit(temp, docs, EXEMPT).problems[0] ?? "")]);

    const real = audit(repo, trackedDocs(repo), EXEMPT);
    checks.push([`…and the real tree carries at least ${HIT_FLOOR} figures (hit-count floor: the matcher must actually match)`, real.figures.length >= HIT_FLOOR]);
    checks.push(["…and the real tree is clean right now (the positive control)", real.problems.length === 0]);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  const failed = checks.filter(([, k]) => !k);
  for (const [n, k] of checks) console.log(`  ${k ? "ok" : "FAIL"} — self-test: ${n}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv.includes("--self-test")) process.exit(selfTest());

const { figures, problems } = audit(repo, trackedDocs(repo), EXEMPT);
if (figures.length < HIT_FLOOR) {
  console.error(`✗ only ${figures.length} path (N) figure(s) found (floor ${HIT_FLOOR}) — the matcher is not matching, not the docs getting honest.`);
  process.exit(1);
}
for (const p of problems) console.error(`  ✗ ${p}`);
const exemptCount = figures.filter((f) => EXEMPT.has(f.doc)).length;
console.log(
  `doc line counts: ${figures.length} figure(s) across ${new Set(figures.map((f) => f.doc)).size} document(s), ` +
    `${exemptCount} in dated records (exempt, ${EXEMPT.size} exemption(s) each with a reason), ${problems.length} drifted`,
);
if (problems.length > 0) {
  console.error("\nDoc line-count gate FAILED — a line count measured once and quoted forever is a figure that lies.");
  process.exit(1);
}
console.log("Doc line-count gate passed — every `path (N)` figure matches the file it names.");
