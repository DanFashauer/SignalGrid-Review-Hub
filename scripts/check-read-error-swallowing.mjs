#!/usr/bin/env node
// Read-path error swallowing — a lookup that FAILED must not report "nothing found".
//
// The third face of one law. `proof:absent-collection` covers a source that never
// reported; `check-pagination-truncation` covers a read cut short by the page cap;
// this covers a read that ERRORED and was caught into a benign value. All three end
// in the same place: a caller is handed emptiness and reads it as good news.
//
// It was found by asking what could DEFEAT the other two. Making connectors throw
// `incomplete_read` only helps if somebody up the stack does not immediately catch
// it and substitute `[]` — which would restore the exact fail-open through the error
// path. `telemetry/mde.ts` did precisely that: `getDevices()` threw on a non-OK
// response and then caught its own throw two lines later, so an auth failure, a 5xx
// or malformed JSON all became "this tenant has zero devices". That is now rethrown.
//
// SCOPE, and why it is narrow on purpose. A sweep of the package found 16 sites that
// catch into a benign value, and FOURTEEN of them are `healthCheck()` returning
// false. That is correct and honest — a health check that fails IS unhealthy, and
// flagging it would be noise that teaches its reader to ignore the gate. So this
// checks READ-shaped methods only (get/list/fetch/lookup/read/resolve/query), where
// the benign value means "nothing there" rather than "the check failed".
//
//   node scripts/check-read-error-swallowing.mjs
//   node scripts/check-read-error-swallowing.mjs --self-test   # prove the guard can fail
//
// NON-VACUITY. The detector is a set of regexes over a fixed tree, and the failure
// mode of every such gate is that it stops matching and reports a clean sweep over
// nothing. Two floors close that: FILE_FLOOR on the connector files read, and
// CATCH_FLOOR on the `catch` blocks actually parsed out of them. Neither tracks the
// live number (268 files / 148 catches, measured 2026-09-06); they sit far below it
// so an honest edit never trips them and a broken parser always does. Before they
// existed the only thing standing between this gate and a vacuous green was the
// staleness check on KNOWN_SWALLOWERS — which would itself go quiet the day that map
// is legitimately emptied.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = join(repo, "lib/integrations/src/integrations");

// Read paths that still swallow, each with the reason it was not simply rethrown.
// Both are multi-source resolvers where "this source did not answer" legitimately
// means "try the next one" — so rethrowing would break a fallback chain rather than
// fix a fail-open, and the right change needs caller analysis this gate cannot do.
// Stated here so the debt is explicit rather than implied by silence.
const KNOWN_SWALLOWERS = new Map([
  ["deviceResolver.ts:resolveFromUEM", "multi-source resolver: null means 'this source did not answer, try the next' — and the fault is reported via onFault, not silent"],
  ["deviceResolver.ts:resolveFromNAC", "same chain, same shape as resolveFromUEM (its catch deliberately mirrors it): onFault reports the fault, null lets resolution fall through to the next source"],
]);

const READ_SHAPED = /^(get|list|fetch|lookup|read|resolve|query)/i;

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
}

/**
 * Strip comments before matching. The first version of this file did not, and it
 * cost a false NEGATIVE that only a falsification run exposed: the fixed mde.ts
 * carries a comment explaining that "the throw above was decorative", and the word
 * `throw` in that prose made the detector classify a re-introduced `return []` as a
 * rethrow. A guard that reads documentation as behaviour is measuring the wrong
 * thing — the same reason check-pagination-truncation.mjs strips comments too.
 *
 * Block comments are blanked rather than deleted so byte offsets (used to find the
 * enclosing method) stay aligned with the original source.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
}

/** Body of a `catch (...) { ... }`, brace-matched so a long block cannot escape. */
function catchBodies(src) {
  const out = [];
  const re = /catch\s*(\([^)]*\))?\s*\{/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < src.length && depth > 0; i += 1) {
      if (src[i] === "{") depth += 1;
      else if (src[i] === "}") depth -= 1;
    }
    out.push({ index: m.index, body: src.slice(m.index + m[0].length, i - 1) });
  }
  return out;
}

/**
 * Every READ-shaped method in one source that catches an error into a benign value.
 * Pure over already-stripped source, so `--self-test` can drive it on fixtures rather
 * than only on whatever the connector tree happens to contain today.
 */
export function swallowingReads(strippedSrc) {
  const out = [];
  for (const m of catchBodies(strippedSrc)) {
    const body = m.body;
    // Rethrows are the fix, not the defect.
    if (/\bthrow\b/.test(body)) continue;
    // Only a BENIGN substitute is dangerous: an empty collection, a null, or false
    // read downstream as "nothing here".
    if (!/return\s*(\[\s*\]|null|\{\s*\}|false)/.test(body)) continue;
    // `{ success: false, ... }` is a report, not a silence.
    if (/success:\s*false/.test(body)) continue;

    // Name the enclosing method by the nearest preceding Promise-returning signature.
    const before = strippedSrc.slice(0, m.index);
    const sig = [...before.matchAll(/(?:async\s+)?([a-zA-Z][a-zA-Z0-9_]*)\s*\([^)]*\)\s*:\s*Promise/g)].pop();
    const method = sig ? sig[1] : "";
    if (!READ_SHAPED.test(method)) continue;
    out.push(method);
  }
  return out;
}

// FLOORS — deliberately far below the live figures, never equal to them.
const FILE_FLOOR = 10;
const CATCH_FLOOR = 30;

/** SELF-TEST — the detector against the shapes that must and must not be flagged. */
function selfTest() {
  const wrap = (method, catchBody) =>
    stripComments(`class C {\n  async ${method}(): Promise<unknown> {\n    try { await go(); } catch (e) {\n      ${catchBody}\n    }\n  }\n}\n`);
  const checks = [];
  const flags = (src) => swallowingReads(src).length > 0;

  checks.push(["a READ that catches into `return []` IS flagged", flags(wrap("getDevices", "return [];"))]);
  checks.push(["a READ that catches into `return null` IS flagged", flags(wrap("lookupUser", "return null;"))]);
  checks.push(["a READ that RETHROWS is not flagged (the fix must clear it)", !flags(wrap("getDevices", "throw e;"))]);
  checks.push(["a healthCheck returning false is NOT flagged — a failed health check IS unhealthy", !flags(wrap("healthCheck", "return false;"))]);
  checks.push(["a `{ success: false }` report is not silence", !flags(wrap("getDevices", "return { success: false, error: String(e) };"))]);
  // The false NEGATIVE the header records: a COMMENT containing the word "throw" once
  // made a re-introduced `return []` read as a rethrow. Comments are stripped, so the
  // prose cannot vouch for behaviour.
  checks.push([
    "a comment mentioning `throw` does NOT launder a `return []` (the recorded false negative)",
    flags(wrap("getDevices", "// the throw above was decorative\n      return [];")),
  ]);

  // LIVE floors: the sweep must actually sweep.
  let filesLive = 0;
  let catchesLive = 0;
  for (const file of walk(ROOT)) {
    filesLive += 1;
    catchesLive += catchBodies(stripComments(readFileSync(file, "utf8"))).length;
  }
  checks.push([`LIVE: ${filesLive} connector file(s) read (floor ${FILE_FLOOR})`, filesLive >= FILE_FLOOR]);
  checks.push([`LIVE: ${catchesLive} catch block(s) parsed (floor ${CATCH_FLOOR})`, catchesLive >= CATCH_FLOOR]);
  checks.push([
    "LIVE: every KNOWN_SWALLOWERS entry still matches a real site (a stale exemption re-permits the defect)",
    [...KNOWN_SWALLOWERS.keys()].every((key) => {
      const [rel, method] = key.split(":");
      try {
        return swallowingReads(stripComments(readFileSync(join(ROOT, rel), "utf8"))).includes(method);
      } catch {
        return false;
      }
    }),
  ]);

  let bad = 0;
  for (const [name, ok] of checks) {
    console.log(`  ${ok ? "ok  " : "FAIL"} — ${name}`);
    if (!ok) bad += 1;
  }
  if (bad) {
    console.error(`\nRead-error-swallowing self-test FAILED — ${bad} of ${checks.length} control(s).`);
    return 1;
  }
  console.log(`\nself-test passed — ${checks.length} controls; the detector flags a swallowed read and clears a rethrow.`);
  return 0;
}

if (process.argv.includes("--self-test")) process.exit(selfTest());

let problems = 0;
const found = new Set();
let filesRead = 0;
let catchesParsed = 0;

for (const file of walk(ROOT)) {
  const src = stripComments(readFileSync(file, "utf8"));
  const rel = file.replace(ROOT + "/", "");
  filesRead += 1;
  catchesParsed += catchBodies(src).length;
  for (const method of swallowingReads(src)) {
    const key = `${rel}:${method}`;
    found.add(key);
    if (KNOWN_SWALLOWERS.has(key)) continue;

    console.error(
      `  ✗ ${key}: a READ that failed returns a benign value instead of rethrowing.\n` +
        `      The caller cannot tell "nothing found" from "the lookup failed", and for posture\n` +
        `      those are opposite conclusions. Rethrow, or add it to KNOWN_SWALLOWERS WITH A REASON.`,
    );
    problems += 1;
  }
}

// The scan must have actually scanned. A detector that stopped matching reports a
// clean tree in exactly the same words as a clean tree.
if (filesRead < FILE_FLOOR || catchesParsed < CATCH_FLOOR) {
  console.error(
    `  ✗ the sweep read ${filesRead} connector file(s) and parsed ${catchesParsed} catch block(s) — below the ` +
      `floors (${FILE_FLOOR}/${CATCH_FLOOR}). The walk or the parser has stopped working, not the tree emptied;\n` +
      "      refusing to report a pass from a scan that found nothing to judge.",
  );
  process.exit(1);
}

// A stale exemption re-permits the defect it was granted for and reads as
// intentional forever after — the same rule the pagination guard applies.
for (const [key, reason] of KNOWN_SWALLOWERS) {
  if (!found.has(key)) {
    console.error(`  ✗ ${key}: listed as a known swallower ("${reason}") but no longer matches — remove the exemption`);
    problems += 1;
  }
}

console.log(
  `read-error swallowing: ${filesRead} file(s), ${catchesParsed} catch block(s), ${found.size} read-path site(s), ` +
    `${KNOWN_SWALLOWERS.size} known, ${problems} problem(s)`,
);

if (problems > 0) {
  console.error(
    "\nRead-error-swallowing guard FAILED.\n" +
      "A read that errored and a read that found nothing must not produce the same value.",
  );
  process.exit(1);
}
console.log("Read-error-swallowing guard passed — no NEW read path silently reports emptiness on failure.");
