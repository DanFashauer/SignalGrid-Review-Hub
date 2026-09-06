#!/usr/bin/env node
/**
 * A backlog row that cites another row must cite one that EXISTS.
 *
 * WHY THIS EXISTS. On 2026-08-25 row 178 was edited to say a gap was "closed by
 * row 185", and row 185 was never written. The dangling citation merged in #319,
 * because every gate in this repository reads rows individually — ownership,
 * evidence, status — and none reads the references BETWEEN them. A row pointing at
 * evidence that is not there is the same defect class this plan spends its length
 * recording, committed by the plan itself.
 *
 * WHAT IT CHECKS, precisely: every "row N" / "rows N and M" / "row-N" mention in a
 * plan document must name a row the same document defines. It does NOT check that
 * the cited row says what the citing row claims it says — no gate can read English,
 * and pretending otherwise would be the overclaim this file exists to prevent.
 *
 * NON-VACUITY is enforced, not assumed: the scan must find citations at all. A
 * regex that silently stopped matching would otherwise report a clean document
 * forever, which is exactly how "nothing found" becomes "nothing wrong".
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = ["docs/COMPANY_BUILD_PLAN.md"];

/** Rows the document DEFINES: a numbered list item opening with bold text. */
export function definedRows(text) {
  return new Set([...text.matchAll(/^(\d+)\. \*\*/gm)].map((m) => Number(m[1])));
}

/** Rows the document CITES, with the line each citation sits on. */
export function citedRows(text) {
  const out = [];
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    // "row 45", "rows 179 and 181", "row-45" — the three forms this plan uses.
    for (const m of line.matchAll(/\brows?[ -](\d+)\b(?:\s*(?:and|,|–|-|to)\s*(\d+)\b)?/g)) {
      for (const g of [m[1], m[2]]) if (g !== undefined) out.push({ row: Number(g), lineNo: i + 1, line: line.trim() });
    }
  });
  return out;
}

export function danglingCitations(text) {
  const defined = definedRows(text);
  return citedRows(text).filter((c) => !defined.has(c.row));
}

// `includes`, not `argv[2]`. It was positional, and this is the only gate of the ~104
// carrying a `--self-test` that read it that way: any argument ahead of the flag —
// `pnpm run … -- --self-test` appending after another, a runner adding `--quiet` —
// silently ran the ORDINARY gate instead, which exits 0 on a clean tree. A self-test
// that can be skipped by argument order reports green without running.
if (process.argv.includes("--self-test")) {
  let passed = 0;
  const failures = [];
  const check = (name, ok) => { if (ok) { passed += 1; console.log(`  ok — ${name}`); } else { failures.push(name); console.error(`  FAIL — ${name}`); } };

  const doc = (body) => body;
  check("a citation to a defined row is clean",
    danglingCitations(doc("1. **A**\n2. **B**\n   see row 1.\n")).length === 0);
  check("a citation to an UNDEFINED row is caught",
    danglingCitations(doc("1. **A**\n   closed by row 185.\n")).map((c) => c.row).join() === "185");
  check("the hyphenated form is caught too",
    danglingCitations(doc("1. **A**\n   the row-99 test.\n")).map((c) => c.row).join() === "99");
  check("both endpoints of a range are checked",
    danglingCitations(doc("1. **A**\n   recorded in rows 200 and 201.\n")).map((c) => c.row).sort().join() === "200,201");
  check("a row number appearing as ordinary prose text is not a citation",
    danglingCitations(doc("1. **A**\n   there were 185 files.\n")).length === 0);
  check("the reported line number points at the citation, not the row heading",
    danglingCitations(doc("1. **A**\n\n\n   see row 42.\n"))[0]?.lineNo === 4);

  // LIVE control: the real document must parse into real rows, or every assertion
  // above is true of an empty set.
  const live = readFileSync(join(REPO, DOCS[0]), "utf8");
  check(`LIVE: the real plan defines rows (${definedRows(live).size} found)`, definedRows(live).size > 100);
  check(`LIVE: the real plan cites rows (${citedRows(live).length} found)`, citedRows(live).length > 10);

  const total = passed + failures.length;
  console.log(`\nself-test ${failures.length === 0 ? "passed" : "FAILED"} (${passed}/${total})`);
  if (failures.length) process.exitCode = 1;
} else {
  let bad = 0;
  let citations = 0;
  for (const rel of DOCS) {
    const text = readFileSync(join(REPO, rel), "utf8");
    citations += citedRows(text).length;
    for (const c of danglingCitations(text)) {
      bad += 1;
      console.error(`✗ ${rel}:${c.lineNo} cites row ${c.row}, which this document does not define`);
      console.error(`    ${c.line.slice(0, 100)}`);
    }
  }
  if (citations === 0) {
    console.error("Row-citation check FAILED: no citations found at all — the scan reads nothing, so a clean result means nothing.");
    process.exit(1);
  }
  if (bad > 0) {
    console.error(`\nRow-citation check FAILED: ${bad} dangling citation(s).`);
    console.error("A row that says another row closed something must name a row that exists.");
    process.exit(1);
  }
  console.log(`Row-citation check passed — ${citations} citation(s) across ${DOCS.length} document(s), every one names a defined row.`);
}
