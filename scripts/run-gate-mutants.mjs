// run-gate-mutants.mjs — reproduce a gate's mutant tally.
//
//   node scripts/run-gate-mutants.mjs <gate>        e.g. check-verdict-tone-source | check-ungated-fetch
//
// WHY. "N of M mutants turn the self-test red" is a claim about a run, and a claim a reviewer cannot repeat is a
// number typed into a body. The mutants live in scripts/lib/gate-mutants/<gate>.json as {name, find, replace}: each
// is applied ALONE to a copy of the gate (find must occur exactly once, so a refactor that moves the anchor fails
// loudly instead of silently testing nothing), the copy's --self-test is run, and the mutant is RED when that run
// does not print "self-test passed" (a crash counts: the run failed). Exit 0 only if every anchor held and every
// mutant is red. The gate itself is never modified; copies are written beside it and removed.

import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const gate = process.argv[2];
if (!gate || !/^[a-z0-9-]+$/.test(gate)) {
  console.error("usage: node scripts/run-gate-mutants.mjs <gate-name>");
  process.exit(2);
}
let mutants;
let original;
try {
  mutants = JSON.parse(readFileSync(join(here, "lib", "gate-mutants", `${gate}.json`), "utf8"));
  original = readFileSync(join(here, `${gate}.mjs`), "utf8");
} catch (e) {
  console.error(`✗ cannot read the gate or its mutant list: ${e.message}`);
  process.exit(2);
}
if (!Array.isArray(mutants) || mutants.length === 0) {
  console.error("✗ the mutant list is empty — a tally over nothing proves nothing.");
  process.exit(2);
}

// A tally over a gate whose own self-test is already red would count every mutant "red" for free.
{
  const base = spawnSync(process.execPath, [join(here, `${gate}.mjs`), "--self-test"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const last = (base.stdout ?? "").trim().split("\n").filter((l) => l.trim()).at(-1) ?? "";
  if (base.status !== 0 || !/self-test passed/.test(last)) {
    console.error(`✗ the unmutated gate's self-test is not green (${last || `exit ${base.status}`}) — refusing to tally mutants against a red baseline.`);
    process.exit(1);
  }
  console.log(`baseline: ${last}`);
}

const copy = resolve(here, `.mutant-${gate}.mjs`);
let red = 0;
const survivors = [];
const anchors = [];
try {
  for (const m of mutants) {
    const count = original.split(m.find).length - 1;
    if (count !== 1) { anchors.push(`${m.name}: anchor occurs ${count} times`); console.log(`ANCHOR ${m.name} (${count})`); continue; }
    writeFileSync(copy, original.replace(m.find, () => m.replace));
    const r = spawnSync(process.execPath, [copy, "--self-test"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const last = (r.stdout ?? "").trim().split("\n").filter((l) => l.trim()).at(-1) ?? "";
    const isRed = r.status !== 0 || !/self-test passed/.test(last);
    if (isRed) red++; else survivors.push(m.name);
    console.log(`${isRed ? "red " : "LIVE"} ${m.name} — ${last || `exit ${r.status}, no tally`}`);
  }
} finally {
  rmSync(copy, { force: true });
}
console.log(`\n${gate}: ${red} of ${mutants.length} mutants red${survivors.length ? `; SURVIVORS: ${survivors.join(", ")}` : ""}${anchors.length ? `; ANCHOR FAILURES: ${anchors.join(", ")}` : ""}`);
process.exit(survivors.length === 0 && anchors.length === 0 ? 0 : 1);
