#!/usr/bin/env node
// Performance figures — the four capacity numbers, gated wherever they are quoted.
//
// `docs/RELIABILITY_SLO.md` is the authority for four measured capacity figures: the
// shipped limiter default, the HTTP throughput, and the in-process single-core and
// four-worker decision rates. All four are RESTATED elsewhere — `DEPLOYMENT_MODELS.md`,
// `COST_MODEL.md`, `COMPANY_BUILD_PLAN.md` — each with its measurement date beside it,
// which is the dated-measurement rule's SHAPE but was not a binding: nothing read them.
// `check-derived-doc-figures` sweeps values the TREE derives; `check-proof-figures`
// binds figures to `proof:*` scopes. Neither reads a bare `240` or `585`, so a
// re-measurement in the authority left every copy behind, silently.
//
// It had. `docs/COMPANY_BUILD_PLAN.md` carried "5,128 decisions/sec on 4 workers
// (RELIABILITY_SLO.md)" — the superseded 2026-08-19 column, attributed to the very
// document that had replaced it, with no date. `COST_MODEL.md` had the same sentence
// and was repaired by hand on 2026-09-06; its twin was not, because a repair fixes the
// number and leaves the drift mechanism intact.
//
// WHY THIS IS A SIBLING OF `check-derived-doc-figures.mjs` AND NOT A ROW IN IT. Every
// FIGURES row there DERIVES its value from the tree and the sweep then hunts that
// integer near a noun. These four are not tree-derived: they are OBSERVATIONS whose
// authority is a document, and they must be matched by their UNIT PHRASE so that a
// drifted number is found rather than missed (searching for the right value can only
// ever find sentences that are already correct — the blind direction that file
// documents at length). The dated-measurement rule itself is IMPORTED from there, so
// the 80-character window has one definition, not two.
//
// GATED    — a number standing next to one of the three unit phrases, in a tracked
//            document other than the authority, that is not an authoritative value, or
//            that carries no date within 80 characters.
// EXEMPT   — a declared (document, reason) pair, printed on every run, and itself
//            gated: an exemption that absorbs nothing is a stale exemption and fails.
// NOT COVERED, deliberately — percentile tables (p50/p95/p99, ms). Those move with the
//            runner on every run; binding them here would be a flaky gate, and a flaky
//            gate gets switched off.
//
//   node scripts/check-performance-figures.mjs
//   node scripts/check-performance-figures.mjs --self-test
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDatedMeasurement } from "./check-derived-doc-figures.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const AUTHORITY = "docs/RELIABILITY_SLO.md";

/**
 * The named set. `authority` lifts the value OUT of RELIABILITY_SLO.md (never typed
 * here — a second copy of a figure is the defect this gate exists for); `quote` is how
 * the figure is written when a document restates it, and it captures the NUMBER so a
 * drifted one is a hit rather than a miss.
 *
 * `decisions/sec` carries TWO authoritative values because the single-core and
 * four-worker rates share a unit; a quotation of either is correct, and anything else
 * is drift.
 */
export const UNITS = [
  {
    id: "limiter",
    label: "shipped rate-limit default (per key)",
    // NOT a measurement: a SHIPPED CONSTANT, so its authority is the code and it needs
    // no date beside it. Re-deriving from `rateLimit.ts` is strictly stronger than
    // trusting the authority document's prose about it, and demanding a date on a
    // constant would be ceremony that buys no truth.
    source: "artifacts/api-server/src/middlewares/rateLimit.ts",
    requiresDate: false,
    authority: [/limitFromEnv\("SIGNALGRID_V1_RATE_LIMIT",\s*(\d+)\)/],
    quote: /(?<![\d,.])([\d,]+)\s*(?:\*\*)?\s*(?:requests?|req)\.?\s*(?:\*\*)?\s*(?:per\s+|\/)min(?:ute)?/gi,
  },
  {
    id: "http-throughput",
    label: "/v1 throughput over HTTP",
    source: AUTHORITY,
    requiresDate: true,
    authority: [/\*\*([\d,]+) req\/sec\*\*/],
    quote: /(?<![\d,.])([\d,]+)\s*(?:\*\*)?\s*(?:requests?|req)\.?\s*(?:\*\*)?\s*(?:per\s+|\/)sec(?:ond)?/gi,
  },
  {
    id: "decision-throughput",
    label: "in-process decision rate (one core / four workers)",
    source: AUTHORITY,
    requiresDate: true,
    authority: [/([\d,]+) decisions\/sec on one core/, /\*\*([\d,]+)\/sec aggregate on 4 workers/],
    quote: /(?<![\d,.])([\d,]+)\s*(?:\*\*)?\s*decisions?\s*(?:\*\*)?\s*(?:per\s+|\/|an?\s+)sec(?:ond)?/gi,
  },
];

/**
 * Documents whose occurrences are NOT gated, each with the reason. Checked by name, and
 * each entry must absorb at least one hit — an exemption that covers nothing is a
 * statement about a document that has moved on.
 */
export const EXEMPT = new Map([
  ["docs/CLAIM_INVENTORY.md", "a historical register of what was claimed when; its whole job is to quote figures as they stood"],
  ["docs/INTAKE_LEDGER.md", "same — dated intake rows quote the figure of their day, and rewriting them would erase the record"],
  ["docs/PARTNER_ONBOARDING.md", "quotes the limiter as a PRODUCT LIMIT a partner is told about, not as a measurement being restated"],
  ["docs/BUILD_BACKLOG.md", "the row that specified this gate names all four figures verbatim; gating the specification against itself is circular"],
  ["docs/API_SIGNAL_DISCOVERY.md", "Verkada's own published API quota (300/min per organization) — a third party's number that happens to share the unit"],
]);

/** Pure. Lift the authoritative values for one unit out of ITS OWN source text — the
 *  measured document for the two throughput figures, `rateLimit.ts` for the constant. */
export function authorityValues(unit, sourceText) {
  return unit.authority.map((re) => (sourceText.match(re) ?? [])[1] ?? null);
}

/** Pure. Every quotation of `unit` in `text`: { index, value, snippet }. */
export function quotationsIn(unit, text) {
  const re = new RegExp(unit.quote.source, unit.quote.flags);
  return [...text.matchAll(re)].map((m) => ({
    index: m.index,
    value: m[1],
    end: m.index + m[0].length,
    snippet: text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 20).replace(/\s+/g, " "),
  }));
}

/**
 * Pure core. `docs` is [{ path, text }]. Returns { fatal, gated, exempt, usedExemptions }.
 * The authority document is never its own subject.
 */
export function auditAll(docs, sources, units = UNITS, exempt = EXEMPT) {
  const fatal = [];
  const gated = [];
  const exemptHits = [];
  const used = new Set();
  for (const unit of units) {
    const values = authorityValues(unit, sources.get(unit.source) ?? "");
    if (values.some((v) => v === null)) {
      fatal.push(`${unit.id}: the authority pattern found no value in ${unit.source} — the derivation is broken, not the docs`);
      continue;
    }
    for (const { path, text } of docs) {
      if (path === AUTHORITY) continue;
      for (const hit of quotationsIn(unit, text)) {
        if (exempt.has(path)) {
          used.add(path);
          exemptHits.push(`${path} [${unit.id}] ${hit.value} — ${exempt.get(path)}`);
          continue;
        }
        if (!values.includes(hit.value)) {
          fatal.push(
            `${path} [${unit.id}] quotes ${hit.value}, and ${unit.source} says ${values.join(" or ")} — …${hit.snippet}…`,
          );
          continue;
        }
        // Either END of the quoted phrase may carry the date: "585 requests per second
        // through `/v1` at concurrency 32 (measured 2026-08-24)" puts it past an
        // 80-character window measured from the digit alone.
        if (unit.requiresDate && !isDatedMeasurement(text, hit.index) && !isDatedMeasurement(text, hit.end)) {
          fatal.push(
            `${path} [${unit.id}] quotes ${hit.value} with no YYYY-MM-DD within 80 characters — a measurement without its date is a claim — …${hit.snippet}…`,
          );
          continue;
        }
        gated.push(`${path} [${unit.id}] ${hit.value} ✓ dated`);
      }
    }
  }
  for (const [path, reason] of exempt) {
    if (!reason || !String(reason).trim()) fatal.push(`${path} is exempted with no reason — a silent exemption is what this gate forbids`);
    else if (!used.has(path)) fatal.push(`${path} is exempted but quotes none of these figures any more — a stale exemption`);
  }
  return { fatal, gated, exempt: exemptHits };
}

function trackedDocs() {
  const out = execSync("git ls-files -- 'docs/*.md' 'docs/**/*.md' 'artifacts/**/README.md' 'artifacts/*/README.md'", {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return [...new Set(out.trim().split("\n").filter(Boolean))].sort().map((p) => ({ path: p, text: readFileSync(join(ROOT, p), "utf8") }));
}

const IS_MAIN = process.argv[1] !== undefined && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href;

function selfTest() {
  const slo = "| **585 req/sec** |\n1,529 decisions/sec on one core; **5,370/sec aggregate on 4 workers**\n";
  const code = 'limit: limitFromEnv("SIGNALGRID_V1_RATE_LIMIT", 240),';
  const src = new Map([[AUTHORITY, slo], ["artifacts/api-server/src/middlewares/rateLimit.ts", code]]);
  const doc = (path, text) => ({ path, text });
  const none = new Map();
  const checks = [
    ["all four values are lifted out of their own sources, never typed here",
      UNITS.flatMap((u) => authorityValues(u, src.get(u.source))).join("|") === "240|585|1,529|5,370"],
    ["a dated, correct restatement passes",
      auditAll([doc("docs/D.md", "585 requests per second through /v1 (measured 2026-08-24)")], src, UNITS, none).fatal.length === 0],
    ["a DRIFTED figure fails even though it is dated — the blind direction",
      auditAll([doc("docs/D.md", "600 requests per second through /v1 (measured 2026-08-24)")], src, UNITS, none).fatal.length === 1],
    ["a correct MEASUREMENT with no date fails",
      auditAll([doc("docs/D.md", "585 requests per second through /v1, transport included")], src, UNITS, none).fatal.length === 1],
    ["the limiter is a shipped CONSTANT, so it needs no date — only the code's value",
      auditAll([doc("docs/D.md", "240 requests per minute per key")], src, UNITS, none).fatal.length === 0 &&
        auditAll([doc("docs/D.md", "300 requests per minute per key")], src, UNITS, none).fatal.length === 1],
    ["the superseded 5,128 is drift, not a second authority",
      auditAll([doc("docs/D.md", "5,128 decisions/sec on 4 workers (2026-08-24)")], src, UNITS, none).fatal.length === 1],
    ["both decisions/sec values are authoritative",
      auditAll([doc("docs/D.md", "1,529 decisions per second on one core and 5,370 decisions/sec on four (2026-08-24)")], src, UNITS, none).fatal.length === 0],
    ["the date may sit past the END of the phrase, not only past the digit — and 80 characters is still the limit",
      auditAll([doc("docs/D.md", "585 requests per second through `/v1` at concurrency 32 (measured 2026-08-24)")], src, UNITS, none).fatal.length === 0 &&
        auditAll([doc("docs/D.md", "585 requests per second through `/v1` at concurrency 32, transport and middleware and the whole chain included (measured 2026-08-24)")], src, UNITS, none).fatal.length === 1],
    ["the authority document is never its own subject",
      auditAll([doc(AUTHORITY, "999 req/sec")], src, UNITS, none).fatal.length === 0],
    ["a declared exemption absorbs its document's hits",
      auditAll([doc("docs/X.md", "300 requests/minute per organization")], src, UNITS, new Map([["docs/X.md", "a third party's quota"]])).fatal.length === 0],
    ["an exemption that absorbs nothing FAILS",
      auditAll([doc("docs/Y.md", "nothing here")], src, UNITS, new Map([["docs/X.md", "a third party's quota"]])).fatal.length === 1],
    ["an exemption with no reason FAILS",
      auditAll([doc("docs/X.md", "300 requests/minute")], src, UNITS, new Map([["docs/X.md", "  "]])).fatal.length === 1],
    ["a broken authority pattern is FATAL, never a silent pass",
      auditAll([doc("docs/D.md", "585 req/sec (2026-08-24)")], new Map([[AUTHORITY, "nothing"], ["artifacts/api-server/src/middlewares/rateLimit.ts", "nothing"]]), UNITS, none).fatal.length === UNITS.length],
    ["a decimal is not a figure — `0.67 decisions/sec` must not read as 67",
      auditAll([doc("docs/D.md", "0.67 decisions/sec on average")], src, UNITS, none).fatal.length === 0],
    ["percentile latencies are OUT OF SCOPE — no unit here matches milliseconds",
      auditAll([doc("docs/D.md", "p95 92.1 ms and p99 609.6 ms over HTTP")], src, UNITS, none).fatal.length === 0],
    ["every live exemption carries a reason", [...EXEMPT.values()].every((r) => typeof r === "string" && r.trim().length > 0)],
  ];
  let bad = 0;
  for (const [name, cond] of checks) {
    console.log(`  ${cond ? "ok" : "FAIL"} — ${name}`);
    if (!cond) bad += 1;
  }
  console.log(`\nself-test: ${checks.length - bad}/${checks.length}`);
  process.exit(bad === 0 ? 0 : 1);
}

function main() {
  if (process.argv.includes("--self-test")) selfTest();

  const docs = trackedDocs();
  const sources = new Map([...new Set(UNITS.map((u) => u.source))].map((p) => [p, readFileSync(join(ROOT, p), "utf8")]));
  const { fatal, gated, exempt } = auditAll(docs, sources);

  console.log(`Performance figures — ${UNITS.length} unit(s), ${docs.length} tracked document(s)\n`);
  for (const u of UNITS) {
    console.log(`  ${u.id.padEnd(22)} ${authorityValues(u, sources.get(u.source)).join(" / ").padEnd(14)} ${u.requiresDate ? "dated" : "constant"}  ← ${u.source}`);
  }
  console.log(`\nGATED — ${gated.length} restatement(s):`);
  for (const g of gated) console.log(`  ok ${g}`);
  console.log(`\nEXEMPT — ${exempt.length} occurrence(s), each declared with a reason:`);
  for (const e of exempt) console.log(`  · ${e}`);

  if (fatal.length > 0) {
    console.error(`\nPerformance figures FAILED — ${fatal.length} finding(s):\n`);
    for (const f of fatal) console.error(`  ✗ ${f}`);
    console.error(
      `\nQuote the value the named source currently carries — with its measurement date beside it\n` +
        `for the two measured figures — or declare the document in EXEMPT above with the reason it\n` +
        `is not restating a measurement.`,
    );
    process.exit(1);
  }
  console.log(`\nPerformance figures hold — every restatement matches its source, and every measurement carries its date.`);
}

if (IS_MAIN) main();
