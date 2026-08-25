// check-evidence-sources.mjs — the source vocabulary must match what exists.
//
//   node scripts/check-evidence-sources.mjs              # gate
//   node scripts/check-evidence-sources.mjs --self-test  # prove it can fail
//
// WHY THIS EXISTS. The owner's direction, 2026-08-25: "it's a signal and it can
// be added to the grid." Measuring that claim showed the architecture already
// supports it — proof:evidence-adapter reports the engine cannot tell fleet from
// headwind from intune — and that a new source costs a ~26-line converter. What
// it did NOT have was any record of which sources exist, so the vocabulary and
// the implementation could drift with nothing watching.
//
// They already had. `EvidenceSourceSystem` names SIX members. Two have product
// converters. Two are constructed inline inside a proof. Two are typeable and
// produced nowhere — and none of the four was named in the launch profile's
// declared gaps. Nothing was broken by that; a union is a vocabulary, not a
// promise. But a type member nobody implements READS as a capability, which is
// the shape this repository fails builds over elsewhere.
//
// THE BIJECTION, both directions, because one direction is how a registry stops
// being one:
//   · every member of the union has a registry entry — no silent vocabulary;
//   · every registry entry names a real union member — no phantom source;
//   · a `converter` entry's named function is EXPORTED from its named module —
//     the status that claims ingestibility must be backed on disk;
//   · a `proof_only` or `vocabulary_only` entry names NO converter, so the
//     weaker statuses cannot quietly assert the stronger one.
//
// WHAT THIS DOES NOT DO. It does not make adding a source a no-code act. The
// converter is still a function somebody writes. This makes adding one a
// DECLARED act that a gate can see — the precondition for a configuration-driven
// registry, not the thing itself.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY = "docs/agent/evidence-sources.json";
const CONTRACT = "lib/integration-bridge/src/evidence.ts";
const VALID_STATUS = ["converter", "proof_only", "vocabulary_only"];

/** The union members, parsed from the contract rather than restated here. */
export function unionMembers(contractSrc) {
  const m = /export type EvidenceSourceSystem\s*=\s*([^;]+);/.exec(contractSrc);
  if (!m) return null; // caller decides: a missing union is fatal, not empty
  return [...m[1].matchAll(/"([a-z0-9_-]+)"/gi)].map((x) => x[1]);
}

/** Is `name` exported from `src`? Textual, matching how this repo's other gates read source. */
export function exportsFunction(src, name) {
  return new RegExp(`export function ${name}\\b`).test(src);
}

export function audit(registry, members, readModule) {
  const problems = [];
  const entries = registry.sources ?? [];
  const ids = entries.map((e) => e.id);

  for (const id of members) {
    if (!ids.includes(id)) {
      problems.push(`${id}: is a member of EvidenceSourceSystem with no entry in ${REGISTRY} — a source the contract can name and the registry cannot see`);
    }
  }
  for (const e of entries) {
    if (!members.includes(e.id)) {
      problems.push(`${e.id}: declared in ${REGISTRY} but is not a member of EvidenceSourceSystem — a phantom source`);
      continue;
    }
    if (!VALID_STATUS.includes(e.status)) {
      problems.push(`${e.id}: unknown status "${e.status}" (expected ${VALID_STATUS.join(" | ")})`);
      continue;
    }
    if (e.status === "converter") {
      if (!e.converter || !e.module) {
        problems.push(`${e.id}: status "converter" must name both a converter and a module — the status that claims ingestibility has to be checkable`);
      } else {
        const src = readModule(e.module);
        if (src === null) {
          problems.push(`${e.id}: module ${e.module} cannot be read — the converter claim cites nothing`);
        } else if (!exportsFunction(src, e.converter)) {
          problems.push(`${e.id}: ${e.module} does not export ${e.converter} — the registry claims a converter the code does not have`);
        }
      }
    } else if (e.converter) {
      problems.push(`${e.id}: status "${e.status}" must not name a converter — a weaker status may not assert the stronger one`);
    }
  }
  return { problems, entries };
}

function selfTest() {
  const checks = [];
  const members = ["alpha", "beta"];
  const mod = { "m.ts": "export function alphaToEvidence() {}" };
  const read = (p) => (p in mod ? mod[p] : null);
  const ok = {
    sources: [
      { id: "alpha", status: "converter", converter: "alphaToEvidence", module: "m.ts" },
      { id: "beta", status: "vocabulary_only", converter: null, module: null },
    ],
  };

  let a = audit(ok, members, read);
  checks.push(["a registry matching the union and the code is clean", a.problems.length === 0]);

  a = audit({ sources: [ok.sources[0]] }, members, read);
  checks.push(["a union member with NO entry is a problem — no silent vocabulary", a.problems.some((p) => p.includes("no entry in"))]);

  a = audit({ sources: [...ok.sources, { id: "ghost", status: "converter", converter: "x", module: "m.ts" }] }, members, read);
  checks.push(["an entry that is not a union member is a phantom source", a.problems.some((p) => p.includes("phantom source"))]);

  a = audit({ sources: [{ ...ok.sources[0], converter: "missingFn" }, ok.sources[1]] }, members, read);
  checks.push(["a converter the module does not export is a problem", a.problems.some((p) => p.includes("does not export"))]);

  a = audit({ sources: [{ ...ok.sources[0], module: "gone.ts" }, ok.sources[1]] }, members, read);
  checks.push(["a module that cannot be read is a problem", a.problems.some((p) => p.includes("cites nothing"))]);

  a = audit({ sources: [ok.sources[0], { ...ok.sources[1], converter: "sneaky" }] }, members, read);
  checks.push(["a vocabulary_only entry naming a converter is a problem — no status laundering", a.problems.some((p) => p.includes("must not name a converter"))]);

  a = audit({ sources: [ok.sources[0], { ...ok.sources[1], status: "probably_fine" }] }, members, read);
  checks.push(["an unknown status is a problem", a.problems.some((p) => p.includes("unknown status"))]);

  // The union parser, and a negative control so it cannot pass by matching nothing.
  checks.push(["the union parses from the real contract", (unionMembers(readFileSync(join(repo, CONTRACT), "utf8")) ?? []).length >= 2]);
  checks.push(["a contract with no union returns null, not an empty pass", unionMembers("export type Something = string;") === null]);

  const failed = checks.filter(([, k]) => !k);
  for (const [l, k] of checks) console.log(`  ${k ? "✓" : "✗"} ${l}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv.includes("--self-test")) process.exit(selfTest());

const registry = JSON.parse(readFileSync(join(repo, REGISTRY), "utf8"));
const members = unionMembers(readFileSync(join(repo, CONTRACT), "utf8"));
if (members === null || members.length === 0) {
  console.error(`✗ could not parse EvidenceSourceSystem from ${CONTRACT} — refusing to report a clean registry from a union that read as empty.`);
  process.exit(1);
}
const readModule = (p) => {
  try {
    return readFileSync(join(repo, p), "utf8");
  } catch {
    return null;
  }
};

const { problems, entries } = audit(registry, members, readModule);
const byStatus = (s) => entries.filter((e) => e.status === s).length;

console.log(`Evidence sources — ${members.length} in the contract's vocabulary, ${entries.length} declared.`);
console.log(`  ingestible (converter on disk): ${byStatus("converter")}`);
console.log(`  proof-only:                     ${byStatus("proof_only")}`);
console.log(`  vocabulary-only:                ${byStatus("vocabulary_only")}`);

if (problems.length > 0) {
  console.error("");
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(`\nEvidence-source registry FAILED (${problems.length}).`);
  process.exit(1);
}

console.log("\nEvidence-source registry passed — the vocabulary and the code agree, both directions.");
console.log("It does NOT make adding a source a no-code act; it makes adding one a DECLARED act a gate can see.");
