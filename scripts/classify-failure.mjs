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

/**
 * The classification, as a pure function so the self-test can drive it. `exit` is the
 * contract the header states: 0 = diagnosed and nothing blocks, 1 = undiagnosed OR
 * something blocks.
 */
export function classify(registry, gate) {
  const hits = registry.filter((c) => c.gate === gate || c.id === gate);
  const anyBlocks = hits.some((c) => c.blocks_pr === true);
  return { hits, anyBlocks, diagnosed: hits.length > 0, exit: hits.length === 0 || anyBlocks ? 1 : 0 };
}

/**
 * The path-shaped tokens inside an evidence string. Extracted so `--audit`'s parser is
 * testable: its predecessor split on `[\s\-:]` and truncated
 * "artifacts/signalgrid-app/…" to "artifacts/signalgrid", reporting four stale entries
 * in a healthy registry.
 */
export function evidencePaths(ev) {
  const trimmed = String(ev ?? "").trim();
  if (trimmed === "") return [];
  return /^[\w./-]+$/.test(trimmed) ? [trimmed] : [...trimmed.matchAll(/(?:[\w-]+\/)+[\w.-]+/g)].map((m) => m[0]);
}

if (argv.includes("--self-test")) {
  // WHAT THIS REPLACED, because it is the failure mode this repository keeps paying for:
  //   const unknown = conditions.find((c) => c.gate === "__no_such_gate__");
  //   const ok = unknown === undefined;
  // That is a tautology. No registry can contain a gate literally named
  // `__no_such_gate__`, so `ok` was true no matter what the classifier did — it never
  // called the classifier at all, and would have reported PASS with every diagnosis
  // deleted, every exit code inverted, or the audit parser back to its truncating
  // splitter. A gate that cannot fail is green about nothing.
  const checks = [];
  const fixture = [
    { id: "blocking-one", gate: "gate:blocks", blocks_pr: true, status: "open" },
    { id: "safe-one", gate: "gate:safe", blocks_pr: false, status: "open" },
  ];

  // 1-3. The exit contract, all three arms. Arm 3 is the regression the header records
  //      (a blocking condition once printed "BLOCKS THIS PR." and exited 0).
  checks.push(["an UNRECOGNISED gate is undiagnosed and exits 1", classify(fixture, "gate:unheard-of").exit === 1 && classify(fixture, "gate:unheard-of").diagnosed === false]);
  checks.push(["a diagnosed NON-blocking condition exits 0", classify(fixture, "gate:safe").exit === 0 && classify(fixture, "gate:safe").diagnosed === true]);
  checks.push(["a diagnosed BLOCKING condition exits 1 (fail-open inversion cannot return)", classify(fixture, "gate:blocks").exit === 1]);
  // 4. Lookup works by id as well as by gate, which `--audit`'s messages assume.
  checks.push(["a condition is findable by its id, not only by its gate", classify(fixture, "safe-one").diagnosed === true]);
  // 5. `blocks_pr` must be read strictly: a missing or string flag must not be truthy-blocked
  //    into silence, nor a "true" string silently dropped from blocking.
  checks.push(["a condition with no blocks_pr does not silently claim to block", classify([{ id: "x", gate: "g", status: "open" }], "g").anyBlocks === false]);

  // 6. The evidence-path extractor, on the shapes the audit meets.
  checks.push(["a bare path is audited whole (the hyphen-truncating splitter cannot return)", JSON.stringify(evidencePaths("artifacts/signalgrid-app/vite.config.ts")) === JSON.stringify(["artifacts/signalgrid-app/vite.config.ts"])]);
  checks.push(["a path inside prose is extracted, hyphens intact", JSON.stringify(evidencePaths("the proxy in artifacts/signalgrid-app/vite.config.ts was absent")) === JSON.stringify(["artifacts/signalgrid-app/vite.config.ts"])]);
  checks.push(["pure prose yields NO path to audit (testimony is not a reference)", evidencePaths("observed by the owner on 2026-08-27").length === 0]);

  // 7. FLOORS on the live registry: a classifier over an empty or reshaped registry is
  //    green about nothing, and every arm above would still pass on it.
  const REQUIRED = ["id", "gate", "status", "symptom", "looks_like", "actual_cause", "fix", "fix_owner"];
  const missingFields = conditions.filter((c) => REQUIRED.some((f) => typeof c[f] !== "string" || c[f].trim() === ""));
  // The floor is 1, not a bigger round number: the registry holds 2 diagnoses today and
  // a floor must sit BELOW what is really there or it fossilises into a red gate on the
  // next honest edit. It is here to catch a registry that parsed to NOTHING — a renamed
  // `conditions` key, an empty array, a truncated file — because every arm above would
  // still pass over an empty registry.
  checks.push([`the live registry parsed to at least one condition (found ${conditions.length})`, conditions.length >= 1]);
  checks.push([`every live condition carries every field the printer reads (${missingFields.length} incomplete)`, missingFields.length === 0]);
  checks.push(["every live condition states blocks_pr as a boolean", conditions.every((c) => typeof c.blocks_pr === "boolean")]);
  checks.push(["a real gate name from the registry classifies as diagnosed", conditions.length > 0 && classify(conditions, conditions[0].gate).diagnosed === true]);

  let bad = 0;
  for (const [name, ok] of checks) {
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
    if (!ok) bad += 1;
  }
  if (bad) {
    console.error(`\nclassify-failure self-test FAILED - ${bad} of ${checks.length} check(s).`);
    process.exit(1);
  }
  console.log(`\nclassify-failure self-test passed - ${checks.length} checks over the exit contract, the evidence parser and the live registry.`);
  process.exit(0);
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
      // Evidence strings are prose WITH paths in them, not paths. The old
      // splitter (`ev.split(/[\s\-:]/)[0]`) truncated at the first hyphen or
      // colon — "artifacts/signalgrid-app/…" audited as "artifacts/signalgrid",
      // a branch name audited as a path — so a healthy registry reported four
      // stale entries (ECC first-pass, verified 2026-08-31). Extract the
      // path-shaped tokens instead: the whole string when it IS a bare path,
      // otherwise every slash-containing token. Pure-prose evidence has no
      // auditable path and is testimony, not a reference — skipped.
      for (const path of evidencePaths(ev)) {
        if (!existsSync(resolve(repo, path))) {
          stale++;
          console.log(`  ${R}x${X} ${c.id} - evidence path gone: ${path}`);
        }
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

const { hits, anyBlocks } = classify(conditions, gate);

console.log(`\n${B}${gate}${X}\n`);

if (!hits.length) {
  console.log(`  ${Y}UNDIAGNOSED.${X} No recorded condition for this gate.\n`);
  console.log(`  Treat it as real until proven otherwise:`);
  console.log(`    1. Re-run it ${B}in isolation${X} - a killed or partial run proves nothing.`);
  console.log(`    2. If it fails again, find the cause before judging whose it is.`);
  console.log(`    3. Then add it here so nobody diagnoses it twice.\n`);
  process.exit(1);
}

// EXIT CONTRACT (fixed 2026-08-31, ECC first-pass finding #1): 0 = diagnosed
// and nothing blocks; 1 = undiagnosed OR any diagnosed condition blocks the
// PR; 2 = usage. The previous version fell off the end of this loop and
// exited 0 even after printing "BLOCKS THIS PR." — the known-blocking case
// passed while the safe-unknown case failed. Fail-open, inverted. `anyBlocks` now
// comes from `classify()` above, which `--self-test` drives in all three arms.
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
process.exit(anyBlocks ? 1 : 0);
