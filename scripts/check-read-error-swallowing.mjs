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
  ["deviceResolver.ts:resolveFromUEM", "multi-source resolver: null means 'this source did not answer, try the next'"],
  ["nac/store.ts:lookupEndpoint", "same shape — null already also means 'NAC not configured'"],
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

let problems = 0;
const found = new Set();

for (const file of walk(ROOT)) {
  const src = stripComments(readFileSync(file, "utf8"));
  const rel = file.replace(ROOT + "/", "");
  for (const m of catchBodies(src)) {
    const body = m.body;
    // Rethrows are the fix, not the defect.
    if (/\bthrow\b/.test(body)) continue;
    // Only a BENIGN substitute is dangerous: an empty collection, a null, or false
    // read downstream as "nothing here".
    if (!/return\s*(\[\s*\]|null|\{\s*\}|false)/.test(body)) continue;
    // `{ success: false, ... }` is a report, not a silence.
    if (/success:\s*false/.test(body)) continue;

    // Name the enclosing method by the nearest preceding Promise-returning signature.
    const before = src.slice(0, m.index);
    const sig = [...before.matchAll(/(?:async\s+)?([a-zA-Z][a-zA-Z0-9_]*)\s*\([^)]*\)\s*:\s*Promise/g)].pop();
    const method = sig ? sig[1] : "";
    if (!READ_SHAPED.test(method)) continue;

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

// A stale exemption re-permits the defect it was granted for and reads as
// intentional forever after — the same rule the pagination guard applies.
for (const [key, reason] of KNOWN_SWALLOWERS) {
  if (!found.has(key)) {
    console.error(`  ✗ ${key}: listed as a known swallower ("${reason}") but no longer matches — remove the exemption`);
    problems += 1;
  }
}

console.log(
  `read-error swallowing: ${found.size} read-path site(s), ${KNOWN_SWALLOWERS.size} known, ${problems} problem(s)`,
);

if (problems > 0) {
  console.error(
    "\nRead-error-swallowing guard FAILED.\n" +
      "A read that errored and a read that found nothing must not produce the same value.",
  );
  process.exit(1);
}
console.log("Read-error-swallowing guard passed — no NEW read path silently reports emptiness on failure.");
