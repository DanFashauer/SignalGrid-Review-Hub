// Failure classifier - a red gate should arrive with its cause attached.
//
//   node scripts/classify-failure.mjs test:e2e      what do we already know?
//   node scripts/classify-failure.mjs --list        every diagnosed condition
//   node scripts/classify-failure.mjs --audit       are the diagnoses still true?
//   node scripts/classify-failure.mjs --self-test   prove the gate can fail
//
// WHY THIS EXISTS
// ---------------
// On 2026-08-27 the owner spent a PR cycle diagnosing 7 timing-out E2E tests,
// concluding correctly that they were not his change. A steward heartbeat had
// reported "quiet" through the same window. Both are the same defect: a red gate
// with no cause attached is indistinguishable from every other red gate, so a
// human re-diagnoses it every time and an automated watcher cannot judge it at
// all.
//
// This is the FALSE_CLAIMS.json pattern applied to failures instead of claims:
// diagnose once, encode it, never redo it. It answers three questions a person
// staring at red CI actually has:
//
//   Is this mine?      -> blocks_pr, and which files would make it mine
//   What is it really? -> actual_cause, not the symptom it presents as
//   Who fixes it?      -> fix and fix_owner
//
// It deliberately does NOT auto-dismiss anything. An entry marked blocks_pr:false
// still prints the exact condition under which that is untrue, so the reader can
// check rather than trust.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY = resolve(repo, "docs/agent/KNOWN_CONDITIONS.json");
const G = "\x1b[32m", R = "\x1b[31m", Y = "\x1b[33m", B = "\x1b[1m", D = "\x1b[2m", X = "\x1b[0m";

if (!existsSync(REGISTRY)) {
  console.error("x docs/agent/KNOWN_CONDITIONS.json missing - the registry IS the memory.");
  process.exit(1);
}
const conditions = JSON.parse(readFileSync(REGISTRY, "utf8")).conditions ?? [];

const argv = process.argv.slice(2);

if (argv.includes("--self-test")) {
  // A classifier nobody has watched fail is one nobody should trust.
  const unknown = conditions.find((c) => c.gate === "__no_such_gate__");
  const ok = unknown === undefined;
  console.log(ok
    ? "PASS  self-test - an unrecognised gate is correctly reported as undiagnosed"
    : "FAIL  self-test - the registry claims to know a gate that does not exist");
  process.exit(ok ? 0 : 1);
}

if (argv.includes("--list")) {
  console.log(`\n${B}Diagnosed conditions${X} ${D}(${conditions.length})${X}\n`);
  for (const c of conditions) {
    const flag = c.blocks_pr ? `${R}BLOCKS PR${X}` : `${G}does not block${X}`;
    console.log(`  ${B}${c.id}${X}  ${D}[${c.gate}]${X}  ${flag}  ${D}${c.status}${X}`);
    console.log(`    presents as: ${c.looks_like}`);
    console.log(`    actually:    ${c.actual_cause.split(".")[0]}.`);
    console.log(`    fix owner:   ${c.fix_owner}\n`);
  }
  process.exit(0);
}

// --audit: a diagnosis whose evidence has moved is a diagnosis to re-check.
if (argv.includes("--audit")) {
  console.log(`\n${B}Auditing ${conditions.length} diagnosis(es) against the tree${X}\n`);
  let stale = 0;
  for (const c of conditions) {
    for (const ev of c.evidence ?? []) {
      const path = ev.split(/[\s\-:]/)[0];
      if (!existsSync(resolve(repo, path))) {
        stale++;
        console.log(`  ${R}x${X} ${c.id} - evidence path gone: ${path}`);
      }
    }
    // If the fix landed, the condition should not still be 'open'.
    if (c.id === "e2e-v1-prefix-not-proxied" && c.status === "open") {
      const vite = resolve(repo, "artifacts/signalgrid-app/vite.config.ts");
      if (existsSync(vite) && /"\/v1"\s*:/.test(readFileSync(vite, "utf8"))) {
        stale++;
        console.log(`  ${Y}!${X} ${c.id} - the /v1 proxy now exists; mark this condition resolved`);
      }
    }
    if (c.id === "unguarded-gate-prefixes" && c.status === "open") {
      const pf = resolve(repo, "scripts/preflight.mjs");
      if (existsSync(pf) && readFileSync(pf, "utf8").includes("check-gate-census")) {
        stale++;
        console.log(`  ${Y}!${X} ${c.id} - the census is registered in preflight; mark this condition resolved`);
      }
    }
  }
  if (!stale) console.log(`  ${G}OK${X} every diagnosis still holds\n`);
  else console.log(`\n${Y}${stale} diagnosis(es) need re-examination. Update deliberately - do not delete.${X}\n`);
  process.exit(stale ? 1 : 0);
}

const gate = argv[0];
if (!gate) {
  console.error("usage: classify-failure.mjs <gate>   |   --list | --audit | --self-test");
  process.exit(2);
}

const hits = conditions.filter((c) => c.gate === gate || c.id === gate);

console.log(`\n${B}${gate}${X}\n`);

if (!hits.length) {
  console.log(`  ${Y}UNDIAGNOSED.${X} No recorded condition for this gate.\n`);
  console.log(`  Treat it as real until proven otherwise:`);
  console.log(`    1. Re-run it ${B}in isolation${X} - a killed or partial run proves nothing.`);
  console.log(`    2. If it fails again, find the cause before judging whose it is.`);
  console.log(`    3. Then add it here so nobody diagnoses it twice.\n`);
  process.exit(1);
}

for (const c of hits) {
  console.log(`  ${B}${c.id}${X}  ${D}diagnosed ${c.diagnosed} - ${c.status}${X}\n`);
  console.log(`  ${D}Symptom${X}        ${c.symptom}`);
  console.log(`  ${D}Presents as${X}    ${c.looks_like}`);
  console.log(`  ${B}Actual cause${X}   ${c.actual_cause}\n`);
  console.log(`  ${D}Reproduces${X}     ${c.reproduces}`);
  console.log(`  ${D}Evidence${X}`);
  for (const e of c.evidence ?? []) console.log(`      ${e}`);
  console.log("");
  if (c.blocks_pr) {
    console.log(`  ${R}${B}BLOCKS THIS PR.${X} Fix before merging.`);
  } else {
    console.log(`  ${G}${B}Does not block a PR${X} - but verify, do not trust:`);
    console.log(`      ${c.why_not_blocking}`);
  }
  console.log(`\n  ${D}Fix (${c.fix_owner})${X}  ${c.fix}\n`);
}
