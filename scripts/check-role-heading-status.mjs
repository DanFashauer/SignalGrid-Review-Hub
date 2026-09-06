#!/usr/bin/env node
// Role headings carry no status — status lives in the entry's table.
//
// `docs/company/ROLE_CATALOG.md` holds 164 role entries, each a `###` heading and
// a field table. Two headings read "… (engaged)" while their own `Current coverage`
// rows said "Not covered … no tester is engaged" and "No auditor … is engaged" —
// the word had been lifted from a "Fractional (external, engaged per assessment)"
// cell with its qualifier dropped (thirteenth audit round, 2026-09-06). Every
// other heading parenthetical is a scope qualifier — (founder), (CISO), (SDR/BDR).
// A heading is what a skimmer reads; a status word there is a claim the table
// beneath it may be denying.
//
// THE RULE: in the role catalog and the activation matrix, a `###` heading may not
// carry a word from the status vocabulary. Not "unless the table agrees" — the table is where status
// belongs, and a heading that restates it is a second home for the figure.
//
//   node scripts/check-role-heading-status.mjs [--self-test]

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const STATUS_WORDS = /\b(engaged|active|covered|hired|staffed|certified|retained|contracted)\b/i;

/** Pure: headings in `text` that carry a status word. */
export function statusHeadingsIn(text) {
  const out = [];
  text.split("\n").forEach((line, i) => {
    if (!/^###\s/.test(line)) return;
    const m = STATUS_WORDS.exec(line);
    if (m) out.push({ line: i + 1, heading: line.trim(), word: m[1] });
  });
  return out;
}

/** Pure audit over { [rel]: text }. */
export function auditRoleHeadings(docs) {
  const fatal = [];
  let headings = 0;
  for (const [rel, text] of Object.entries(docs)) {
    headings += text.split("\n").filter((l) => /^###\s/.test(l)).length;
    for (const h of statusHeadingsIn(text)) fatal.push(`${rel}:${h.line} heading carries the status word "${h.word}" — status belongs in the entry's table, not the title: ${h.heading}`);
  }
  return { fatal, headings, docs: Object.keys(docs).length };
}

function loadDocs() {
  const out = {};
  // The catalog and the activation matrix hold ROLE ENTRIES. ROLE_LENS_REVIEW_* files
  // hold review FINDINGS whose titles legitimately say "never … retained"; they are
  // not role headings and are not read.
  const files = execSync("git ls-files -- 'docs/company/ROLE_CATALOG.md' 'docs/company/ROLE_ACTIVATION_MATRIX.md'", { cwd: repoRoot, encoding: "utf8" }).split("\n").filter(Boolean);
  for (const rel of files) out[rel] = readFileSync(join(repoRoot, rel), "utf8");
  return out;
}

function selfTest() {
  const checks = [];
  let r = auditRoleHeadings({ "docs/company/ROLE_X.md": "### Chief Executive Officer (founder)\n### Offensive security specialist — penetration testing and red team\n" });
  checks.push(["scope qualifiers and plain titles pass (positive control)", r.fatal.length === 0 && r.headings === 2]);
  r = auditRoleHeadings({ "docs/company/ROLE_X.md": "### Offensive security specialist — penetration testing and red team (engaged)\n" });
  checks.push(["THE SHIPPED DEFECT: '(engaged)' in a heading is FATAL", r.fatal.length === 1 && r.fatal[0].includes('"engaged"')]);
  r = auditRoleHeadings({ "docs/company/ROLE_X.md": "| Status | ACTIVE |\n- Currently covered by the founder\n" });
  checks.push(["status words in table rows and prose are not the heading's business", r.fatal.length === 0]);
  const live = auditRoleHeadings(loadDocs());
  checks.push(["LIVE: the role docs hold >100 headings and none carries a status word", live.headings > 100 && live.fatal.length === 0]);
  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) process.exit(selfTest());
  const r = auditRoleHeadings(loadDocs());
  console.log(`Role headings — ${r.headings} heading(s) across ${r.docs} docs/company/ROLE_*.md file(s).`);
  if (r.fatal.length > 0) {
    console.error(`\nRole-heading-status check FAILED: ${r.fatal.length} problem(s).`);
    for (const f of r.fatal) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("Role-heading-status check passed — no role title asserts a status its table would have to defend.");
}
