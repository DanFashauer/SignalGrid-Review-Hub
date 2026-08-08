#!/usr/bin/env node
// What the dock firmware emits must be what the fabric accepts.
//
// WHY. `firmware/dock/core` is Rust on a Cortex-M part; `lib/signalgrid-core/src/dock.ts`
// is the TypeScript that normalises what it sends. The two are written in different
// languages, built by different toolchains, and nothing connects them but a set of
// strings. A dock that starts reporting "OK" instead of "none" does not crash and does
// not warn — the signal simply stops contributing, and the fabric goes on deciding
// without it. That is the quietest possible failure for a physical-custody sensor.
//
// SCOPE IS DERIVED, TWICE OVER. Neither the field list nor the vocabularies are written
// down here: the required fields come from the `DockCustodyRecord` interface, and the
// legal values from the exported type unions, both parsed out of the TypeScript. Adding
// a state to the fabric and not to the firmware fails this; so does the reverse.
//
// THE INPUT IS THE FIRMWARE'S REAL OUTPUT, not a transcription of it —
// `cargo run --example emit_fixtures` runs the same evaluate/encode path a dock runs.
//
//   node scripts/check-dock-firmware-contract.mjs <emitted.jsonl>
//   node scripts/check-dock-firmware-contract.mjs --self-test

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const TYPES_TS = "lib/signalgrid-core/src/types.ts";
const DOCK_TS = "lib/signalgrid-core/src/dock.ts";

/**
 * Parse `export type Name = "a" | "b" | ...;` out of the TypeScript source.
 *
 * WHY THIS IS NOT ONE REGEX. The obvious pattern for a string union is
 * `(?:\s*\|?\s*"[^"]*")+`, and CodeQL was right to reject it: `\s*`, `\|?` and `\s*`
 * can all match the same whitespace, so the group is ambiguous and the engine
 * backtracks exponentially on input like `export type X=` followed by many ` ""`.
 *
 * It is tempting to wave that away — the input is a file in this repository, not
 * something a stranger sends. But "the input is trusted" is the reasoning that ages
 * badly, and this is a GATE: a gate that can be made to hang is a gate that stops
 * gating, and it would hang silently, looking like a slow build.
 *
 * So: capture the right-hand side with `[^;]*` (one quantifier, one character class,
 * linear), then pull the quoted values out and check that what remains is only pipes
 * and whitespace. Every pattern below has a single unambiguous quantifier.
 */
function parseUnions(source) {
  const unions = new Map();
  for (const m of source.matchAll(/export type (\w+)\s*=\s*([^;]*);/g)) {
    const rhs = m[2];
    const values = [...rhs.matchAll(/"([^"]*)"/g)].map((v) => v[1]);
    if (values.length === 0) continue;
    // Anything other than the quoted values, pipes and whitespace means this is not a
    // plain string union — a mapped type, a reference, a template literal. Skip it
    // rather than half-understanding it.
    const residue = rhs.replace(/"[^"]*"/g, "");
    if (!/^[|\s]*$/.test(residue)) continue;
    unions.set(m[1], values);
  }
  return unions;
}

/**
 * Parse the fields of `export interface DockCustodyRecord { ... }`.
 *
 * Returns `[{ name, optional, type }]`. Comments are stripped first so a field name
 * mentioned in prose does not become a required field.
 */
function parseRecordFields(source) {
  const start = source.indexOf("export interface DockCustodyRecord");
  if (start === -1) throw new Error(`${DOCK_TS}: no DockCustodyRecord interface`);
  const open = source.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) throw new Error(`${DOCK_TS}: DockCustodyRecord interface is unterminated`);

  const body = source
    .slice(open + 1, end)
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments, including the /** */ docs
    .replace(/\/\/.*$/gm, "");

  const fields = [];
  for (const line of body.split("\n")) {
    const m = line.match(/^\s*(\w+)(\?)?\s*:\s*([^;]+);/);
    if (m) fields.push({ name: m[1], optional: Boolean(m[2]), type: m[3].trim() });
  }
  if (fields.length === 0) throw new Error(`${DOCK_TS}: parsed no fields from DockCustodyRecord`);
  return fields;
}

function loadContract() {
  const unions = parseUnions(readFileSync(join(REPO, TYPES_TS), "utf8"));
  const fields = parseRecordFields(readFileSync(join(REPO, DOCK_TS), "utf8"));
  return { unions, fields };
}

/**
 * Check emitted records against the contract.
 *
 * `requireSpread` is the non-vacuity rule: across all records, every enum-typed field
 * must show more than one distinct value. Without it, a firmware that answered
 * "unknown" to everything would satisfy every per-record check and prove nothing.
 */
function check(records, { unions, fields }, { requireSpread = true } = {}) {
  const problems = [];
  if (records.length === 0) {
    return ["no records were emitted — the firmware produced nothing to check"];
  }

  const seen = new Map(); // field -> Set of values

  records.forEach((rec, i) => {
    const where = `record ${i + 1}`;
    if (typeof rec !== "object" || rec === null || Array.isArray(rec)) {
      problems.push(`${where}: not a JSON object`);
      return;
    }
    for (const field of fields) {
      const present = Object.prototype.hasOwnProperty.call(rec, field.name);
      if (!present) {
        if (!field.optional) {
          problems.push(`${where}: missing required field "${field.name}"`);
        }
        continue;
      }
      const value = rec[field.name];
      const union = unions.get(field.type);
      if (union) {
        if (!union.includes(value)) {
          problems.push(
            `${where}: "${field.name}" = ${JSON.stringify(value)} is not one of ` +
              `${field.type} {${union.join(", ")}}`,
          );
        }
        if (!seen.has(field.name)) seen.set(field.name, new Set());
        seen.get(field.name).add(value);
      } else if (field.type === "string" && typeof value !== "string") {
        problems.push(`${where}: "${field.name}" must be a string, got ${typeof value}`);
      }
    }
    for (const key of Object.keys(rec)) {
      if (!fields.some((f) => f.name === key)) {
        problems.push(`${where}: unexpected field "${key}" — the fabric will ignore it`);
      }
    }
  });

  if (requireSpread) {
    for (const [field, values] of seen) {
      if (values.size < 2) {
        problems.push(
          `"${field}" only ever took the value ${JSON.stringify([...values][0])} across ` +
            `${records.length} records. A firmware that answers the same way to everything ` +
            `would pass every other check here.`,
        );
      }
    }
    // Separately: the fixtures must include a case where the dock knew nothing, since
    // that is the case the whole fail-closed design exists for.
    const sawUnknown = records.some((r) => r.tamperState === "unknown");
    if (!sawUnknown) {
      problems.push(
        `no record reported tamperState "unknown". The silent-dock case is the one this ` +
          `firmware exists to get right, and it must be in the fixtures.`,
      );
    }
  }

  return problems;
}

function selfTest() {
  const contract = {
    unions: new Map([
      ["DockState", ["occupied", "empty", "unknown"]],
      ["TamperState", ["none", "confirmed", "unknown"]],
    ]),
    fields: [
      { name: "deviceRef", optional: false, type: "string" },
      { name: "dockState", optional: false, type: "DockState" },
      { name: "tamperState", optional: false, type: "TamperState" },
      { name: "badgeBinding", optional: true, type: "DockState" },
    ],
  };
  const good = [
    { deviceRef: "a", dockState: "occupied", tamperState: "none" },
    { deviceRef: "a", dockState: "empty", tamperState: "unknown" },
  ];

  const cases = [
    ["a conforming pair passes", good, true],
    [
      "a value outside the vocabulary is caught",
      [{ deviceRef: "a", dockState: "OK", tamperState: "none" }, good[1]],
      false,
    ],
    [
      "a missing required field is caught",
      [{ deviceRef: "a", dockState: "occupied" }, good[1]],
      false,
    ],
    [
      "a missing OPTIONAL field is not a problem",
      good,
      true,
    ],
    [
      "an unexpected field is caught, because the fabric would drop it",
      [{ ...good[0], dockStatus: "occupied" }, good[1]],
      false,
    ],
    [
      "a firmware that answers the same way to everything is caught (vacuity)",
      [
        { deviceRef: "a", dockState: "unknown", tamperState: "unknown" },
        { deviceRef: "a", dockState: "unknown", tamperState: "unknown" },
      ],
      false,
    ],
    [
      "fixtures with no silent-dock case are caught",
      [
        { deviceRef: "a", dockState: "occupied", tamperState: "none" },
        { deviceRef: "a", dockState: "empty", tamperState: "confirmed" },
      ],
      false,
    ],
    ["an empty emission is caught, not treated as a clean pass", [], false],
  ];

  let failed = 0;
  for (const [label, records, expectOk] of cases) {
    const ok = check(records, contract).length === 0;
    const pass = ok === expectOk;
    if (!pass) failed += 1;
    console.log(`  ${pass ? "ok" : "FAIL"} — ${label}`);
  }

  // Controls on the PARSERS, which are the part most likely to silently match nothing.
  try {
    parseRecordFields("export interface Something { a: string; }");
    console.log("  FAIL — a source with no DockCustodyRecord was accepted");
    failed += 1;
  } catch {
    console.log("  ok — a source with no DockCustodyRecord throws");
  }
  const unions = parseUnions('export type Foo = "a" | "b";\nexport type Bar = "c";');
  if (unions.get("Foo")?.length === 2 && unions.get("Bar")?.length === 1) {
    console.log("  ok — union parsing reads single and multi-value unions");
  } else {
    console.log("  FAIL — union parsing is wrong");
    failed += 1;
  }

  // A non-string union must be skipped rather than half-parsed.
  const mixed = parseUnions('export type Ref = Something | "a";\nexport type Ok = "x" | "y";');
  if (!mixed.has("Ref") && mixed.get("Ok")?.length === 2) {
    console.log("  ok — a union that is not purely string literals is skipped");
  } else {
    console.log("  FAIL — a non-string union was parsed as a vocabulary");
    failed += 1;
  }

  // REGRESSION CONTROL for the ReDoS CodeQL found. The old pattern
  // `(?:\s*\|?\s*"[^"]*")+` backtracks exponentially on exactly this shape; the
  // current one is linear. Timed rather than asserted in prose, because "I rewrote it
  // to be linear" is a claim and this is a measurement.
  const adversarial = `export type 0=${' ""'.repeat(60)}`;
  const startedAt = process.hrtime.bigint();
  parseUnions(adversarial);
  const tookMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
  if (tookMs < 250) {
    console.log(`  ok — the pathological input parses in ${tookMs.toFixed(1)}ms (no backtracking blowup)`);
  } else {
    console.log(`  FAIL — pathological input took ${tookMs.toFixed(0)}ms; the parser can be made to hang`);
    failed += 1;
  }
  return failed;
}

function main() {
  if (process.argv.includes("--self-test")) {
    console.log("check-dock-firmware-contract self-test:");
    const failed = selfTest();
    console.log(failed === 0 ? "self-test: pass" : `self-test: ${failed} FAILED`);
    process.exit(failed === 0 ? 0 : 1);
  }

  const path = process.argv[2];
  if (!path) {
    console.error("usage: check-dock-firmware-contract.mjs <emitted.jsonl>");
    process.exit(2);
  }
  if (!existsSync(path)) {
    // Not a skip. "The emitter did not run" must never read as "the firmware conforms".
    console.error(`FAIL: ${path} does not exist — the firmware emitted nothing to check.`);
    process.exit(1);
  }

  const lines = readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const records = [];
  for (const [i, line] of lines.entries()) {
    try {
      records.push(JSON.parse(line));
    } catch (e) {
      console.error(`FAIL: line ${i + 1} of ${path} is not valid JSON: ${e.message}`);
      process.exit(1);
    }
  }

  const contract = loadContract();
  console.log(
    `  contract: ${contract.fields.length} field(s) from ${DOCK_TS}, ` +
      `${contract.unions.size} vocabulary/ies from ${TYPES_TS}`,
  );
  console.log(`  firmware emitted ${records.length} record(s)`);

  const problems = check(records, contract);
  if (problems.length) {
    console.error(`\nFAIL: the dock firmware does not satisfy the fabric's contract:\n`);
    for (const p of problems) console.error(`  · ${p}`);
    console.error(
      `\nFix the firmware, or — if the fabric's vocabulary genuinely changed — change it\n` +
        `in ${TYPES_TS} and re-run. Do not relax this check: a value the fabric does not\n` +
        `recognise is a custody signal that silently stops counting.`,
    );
    process.exit(1);
  }

  console.log(`  ✓ every record conforms, and every enum field showed more than one value`);
  const failed = selfTest();
  if (failed !== 0) {
    console.error(`\nFAIL: ${failed} negative control(s) did not fire — this gate proves nothing.`);
    process.exit(1);
  }
  console.log(`
Dock-firmware contract gate passed.

  NOT established by a green here:
    · that any hardware ran this. Nothing has been flashed to a dock. This checks what
      the firmware EMITS against what the fabric ACCEPTS, on a build machine.
    · that the fabric's own normalisation is correct — that is proof:dockbridge's job.
    · timing, power, radio, enclosure, or anything else physical.`);
}

main();
