#!/usr/bin/env node
// Pagination-truncation guard — a capped read must not be indistinguishable from
// a complete one.
//
// WHAT THIS IS ABOUT. Eleven connectors paginate with their own copy of
// `getAllPages`, each looping `while (url && pages < this.pageLimit)` and then
// returning a plain array. The cap is correct and must stay — it is a loop/DoS
// guard against an endless `nextLink`. The problem is what the CALLER learns
// afterwards: nothing. A tenant with more pages than the cap yields a short list
// with no signal that it was cut off.
//
// For a posture fabric that is a fail-open. Absence is the load-bearing signal
// here — a device that is not in the result is treated as a device that does not
// exist, so a non-compliant host past the cap reads as no problem at all. This is
// the same defect class the repo keeps finding: silence graded as good news
// (syslog reporting 'sent' for a no-op; `.postureObserved` emitted for posture
// that was never observed; a Fleet OS-floor with no observed OS grading
// compliant).
//
// WHY THIS GUARD RATHER THAN A FIX. Retrofitting a truncation signal changes the
// return type of eleven connectors and every one of their callers. That is an
// architectural decision for the owner, not something to impose from a sweep —
// see docs/BUILD_BACKLOG.md. So the existing eleven are STATED here, and this
// gate stops a TWELFTH from being added silently. A stated gap is debt; an
// unstated one is a surprise.
//
//   node scripts/check-pagination-truncation.mjs

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const familyDir = join(repo, "lib/integrations/src/integrations");

// The connectors that paginate WITHOUT a truncation signal today. Each is real
// debt, recorded so it is visible rather than implied by silence. Removing a name
// from this list is how a fix gets locked in: the guard then requires the signal
// to stay.
// EMPTY, and that is the point. All eleven now refuse a capped read instead of
// returning a partial inventory as a complete one, so every exemption was removed
// rather than left to read as intentional. A name back in this list means a NEW
// connector shipped without a truncation signal — and it must arrive with a reason.
const KNOWN_SILENT = new Set([]);

/** A page-capped read: a loop bounded by a page/limit counter. */
const CAPPED_LOOP = /while\s*\([^)]*\bpages?\s*<[^)]*\)|while\s*\([^)]*<\s*this\.(pageLimit|maxPages)\b/;
/** Any of the shapes that would tell a caller the read was cut short. */
const TRUNCATION_SIGNAL = /\btruncated\b|\bincomplete\b|\bcapReached\b|\bhitPageLimit\b|\bpartial\b/;

let problems = 0;
let stale = 0;
const capped = [];

const families = readdirSync(familyDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

for (const name of families) {
  const dir = join(familyDir, name);
  if (!existsSync(dir)) continue;
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
  let hasCap = false;
  let hasSignal = false;
  for (const f of files) {
    const src = readFileSync(join(dir, f), "utf8");
    // Strip line comments so PROSE about truncation never counts as a signal —
    // this guard exists because documentation is not behaviour.
    const code = src
      .split("\n")
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
      .join("\n");
    if (CAPPED_LOOP.test(code)) hasCap = true;
    if (TRUNCATION_SIGNAL.test(code)) hasSignal = true;
  }
  if (!hasCap) continue;
  capped.push(name);

  if (hasSignal) {
    // Fixed. If it is still on the known-silent list, the list is stale — say so,
    // because a stale exemption quietly re-permits the defect it was granted for.
    if (KNOWN_SILENT.has(name)) {
      console.log(`  ! ${name}: now signals truncation — remove it from KNOWN_SILENT to lock the fix in`);
      stale += 1;
    } else {
      console.log(`  ✓ ${name}: paginates and signals truncation`);
    }
    continue;
  }

  if (KNOWN_SILENT.has(name)) {
    console.log(`  · ${name}: capped read, no truncation signal (known, see docs/BUILD_BACKLOG.md)`);
    continue;
  }

  console.error(
    `  ✗ ${name}: paginates with a page cap but gives the caller NO truncation signal.\n` +
      `      A capped read is indistinguishable from a complete one, and for posture an\n` +
      `      absent record reads as "no such record". Add a signal, or — if that is\n` +
      `      genuinely not possible yet — add it to KNOWN_SILENT in this file with a reason.`,
  );
  problems += 1;
}

console.log(
  `\npagination-truncation: ${capped.length} capped connectors, ` +
    `${KNOWN_SILENT.size} known-silent, ${problems} new problem(s), ${stale} stale exemption(s)`,
);

if (problems > 0 || stale > 0) {
  console.error("\nPagination-truncation guard FAILED.");
  process.exit(1);
}
console.log("Pagination-truncation guard passed — no NEW silently-truncating connector.");
