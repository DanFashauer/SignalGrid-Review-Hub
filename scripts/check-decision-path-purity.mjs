#!/usr/bin/env node
// The decision path may not reach the network, spawn a process, or ask a model.
//
//   node scripts/check-decision-path-purity.mjs [--self-test]
//
// WHY THIS EXISTS, AND WHY IT EXISTS *NOW*. On 2026-09-17 the owner pointed at
// AirLLM (github.com/lyogavin/airllm) — layer-by-layer streaming inference that runs a
// 70B model on ~4 GB of VRAM — and said it should be part of the system. It is a good
// fit for something SignalGrid genuinely needs: on-premises inference with no data
// egress, which is the constraint that actually binds in healthcare and fintech.
//
// It is not a fit for the decision path, and never can be. Golden rule 2 is that a
// decision is deterministic and fail-closed: the same evidence yields the same verdict
// on every machine, forever, and an unknown signal RAISES assurance. A language model
// is the opposite of all three — it is sampled, it is machine- and version-dependent,
// and asked something it does not know it produces a confident answer rather than a
// refusal. A model in a decision path would not weaken determinism at the margin; it
// would end it.
//
// So the useful thing to build on the day the idea arrives is not the integration. It
// is the FENCE — because a fence is cheap while the field is empty and expensive
// afterwards, and because the honest answer to "can we put a model in this system" is
// "yes, everywhere except here, and here is the gate that proves it stayed out".
//
// `pnpm run check:absence "llm inference in decision path"` returned CORROBORATED
// across all four probes before this was written: nothing guarded this. The nearest
// thing, `check-ungated-fetch.mjs`, scans CONNECTOR sources for ungated `fetch` — a
// different tree and a different rule. The decision core was unguarded on this axis,
// and clean only by habit. Habit is not a boundary.
//
// WHAT IT CANNOT DO, stated because the tempting version overclaims. This is a static
// scan of source text. It cannot see through an indirection that hides a call behind a
// string, an injected dependency, or a transitive import three packages down. It
// catches the honest mistake and the casual one — a `fetch` added in a hurry, an SDK
// imported because it was convenient — which is the shape this failure actually takes.
// It is a fence, not a proof of purity.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/** The trees whose output is a VERDICT. Adding one here is the whole configuration. */
const DECISION_PATH_ROOTS = [
  "lib/signalgrid-core/src",
  "lib/signalgrid-simulator/src",
];

/** A floor, not decoration: a scan that matches nothing must FAIL rather than pass
 *  silently. A gate whose glob quietly stops matching is worse than no gate, because
 *  it reports green while covering nothing. */
const MIN_FILES_EXPECTED = 20;

const FORBIDDEN = [
  // ── reaching the network ────────────────────────────────────────────────────
  { pattern: /\bfetch\s*\(/, what: "fetch(", why: "a decision may not depend on a network round trip" },
  { pattern: /\bXMLHttpRequest\b/, what: "XMLHttpRequest", why: "a decision may not depend on a network round trip" },
  { pattern: /\bnode:(https?|net|dgram)\b/, what: "a node network module", why: "a decision may not depend on a network round trip" },
  // ── leaving the process ─────────────────────────────────────────────────────
  { pattern: /\bnode:child_process\b|\bfrom\s+["']child_process["']/, what: "child_process", why: "a decision may not depend on another program's output" },
  { pattern: /\bexecSync\s*\(|\bspawnSync\s*\(/, what: "a synchronous subprocess call", why: "a decision may not depend on another program's output" },
  // ── asking a model ──────────────────────────────────────────────────────────
  {
    pattern: /from\s+["'][^"']*(openai|anthropic|ollama|huggingface|transformers|llama|onnxruntime|airllm|replicate|bedrock-runtime|vertexai|@google\/generative-ai)[^"']*["']/i,
    what: "an inference client import",
    why: "a verdict may never be sampled from a model — see the header",
  },
];

/** Lines that state the rule rather than break it. A gate that cannot tell a
 *  prohibition from a violation makes its own documentation unwritable. */
const IS_COMMENT = /^\s*(\/\/|\*|\/\*)/;

function tsFilesUnder(dir) {
  const abs = join(repoRoot, dir);
  let entries;
  try {
    entries = readdirSync(abs);
  } catch {
    // Unreadable root: FAIL, never skip. A root that vanished is the gate's
    // coverage vanishing, which is exactly what MIN_FILES_EXPECTED is here to catch.
    return [];
  }
  const out = [];
  for (const entry of entries) {
    const full = join(abs, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...tsFilesUnder(join(dir, entry)));
    else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

export function scanSource(text, path = "<memory>") {
  const findings = [];
  text.split("\n").forEach((line, i) => {
    if (IS_COMMENT.test(line)) return;
    for (const rule of FORBIDDEN) {
      if (rule.pattern.test(line)) {
        findings.push({ path, line: i + 1, what: rule.what, why: rule.why, text: line.trim().slice(0, 100) });
      }
    }
  });
  return findings;
}

function selfTest() {
  const cases = [
    ["a network call", 'const r = await fetch("https://x");', true],
    ["a subprocess", 'import { spawn } from "node:child_process";', true],
    ["an inference client", 'import OpenAI from "openai";', true],
    ["an on-prem inference client", 'import { AirLLM } from "airllm-node";', true],
    ["a node network module", 'import https from "node:https";', true],
    ["the rule stated in a comment", '// a decision may never call fetch( or import openai', false],
    ["ordinary decision code", 'const outcome = evaluatePolicy(evidence, policy);', false],
    ["a word that merely contains a forbidden name", 'const llamaCount = herd.filter((a) => a.kind === "llama").length;', false],
  ];
  let passed = 0;
  const failures = [];
  for (const [name, src, shouldFlag] of cases) {
    const flagged = scanSource(src).length > 0;
    if (flagged === shouldFlag) { passed += 1; console.log(`  ok — ${shouldFlag ? "flags" : "allows"} ${name}`); }
    else { failures.push(name); console.log(`  FAIL — ${shouldFlag ? "missed" : "false-positived on"} ${name}`); }
  }
  console.log(`\nself-test ${failures.length === 0 ? "passed" : "FAILED"} (${passed}/${cases.length})`);
  process.exit(failures.length === 0 ? 0 : 1);
}

if (process.argv.includes("--self-test")) selfTest();

console.log("Decision-path purity — a verdict may not be fetched, spawned, or sampled\n");

const files = DECISION_PATH_ROOTS.flatMap(tsFilesUnder);
const findings = [];
let unreadable = 0;
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    // Fail-closed: a file we cannot read is not a file we have cleared.
    unreadable += 1;
    findings.push({ path: relative(repoRoot, file), line: 0, what: "unreadable", why: `could not be read: ${err.message}`, text: "" });
    continue;
  }
  findings.push(...scanSource(text, relative(repoRoot, file)));
}

console.log(`  scanned ${files.length} file(s) across ${DECISION_PATH_ROOTS.length} decision-path root(s)`);
for (const root of DECISION_PATH_ROOTS) console.log(`    · ${root}`);

if (files.length < MIN_FILES_EXPECTED) {
  console.error(
    `\n✗ only ${files.length} file(s) matched, below the floor of ${MIN_FILES_EXPECTED}.\n` +
      "      The roots moved or the glob stopped matching. A gate that covers nothing\n" +
      "      reports green forever, so this is FATAL rather than a warning.",
  );
  process.exit(1);
}

if (findings.length > 0) {
  console.error(`\n✗ ${findings.length} violation(s) — the decision path reached outside itself:\n`);
  for (const f of findings) {
    console.error(`    · ${f.path}:${f.line} — ${f.what}`);
    console.error(`        ${f.why}`);
    if (f.text) console.error(`        ${f.text}`);
  }
  console.error(
    "\n  A model, a network call or a subprocess belongs in a connector, an explanation\n" +
      "  surface or an operator tool — never here. Golden rule 2: the same evidence must\n" +
      "  yield the same verdict on every machine, and an unknown must RAISE assurance.",
  );
  process.exit(1);
}

console.log(`\nDecision-path purity passed — ${files.length} file(s), no network, no subprocess, no inference client.`);
