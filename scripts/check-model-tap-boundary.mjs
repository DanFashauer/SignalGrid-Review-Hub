#!/usr/bin/env node
// =============================================================================
// check-model-tap-boundary — the load-bearing fence for DR-035. It proves NO
// model can reach the product's deterministic decision path: no file under the
// decision-path roots may import the tap/policy, name its env vars, or carry an
// OpenAI-model-call shape — and the tap/policy themselves may import nothing from
// the decision path (the reciprocal fence). Golden rule 2, enforced by
// construction rather than by goodwill.
//
// Scope is DERIVED from FORBIDDEN_ROOTS in scripts/lib/model-routing-policy.mjs
// (the same module the tap imports), so a NEW lib package, /v1 sub-path,
// connector family, or proof is covered the moment it exists — and the FLOOR
// check refuses to pass over an empty or mis-derived scope, the "switched-off
// gate reads as enforced" failure this repo has recorded.
//
//   node scripts/check-model-tap-boundary.mjs             # the real scan
//   node scripts/check-model-tap-boundary.mjs --self-test # prove it can fail
//
// LIMITS, stated honestly. This is a denylist of known provider call-shapes plus
// the import/env fence and the reciprocal fence, scanned per-file (not by
// resolving the import graph). It does not follow a transitive chain (a
// decision-path file importing an unscanned helper that imports the tap) — a hole
// closed today by construction, not by this gate: the tap has a single consumer
// (scripts/brief.mjs) and no decision-path file imports anything under scripts/.
// A genuinely novel provider whose shape is in none of FORBIDDEN_TOKENS would
// also pass; the denylist covers every provider the doctrine names.
// =============================================================================
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FORBIDDEN_ROOTS,
  FORBIDDEN_IMPORT_SUBSTRINGS,
  FORBIDDEN_TOKENS,
  TAP_MODULES,
  RECIPROCAL_FORBIDDEN_IMPORT_SUBSTRINGS,
} from "./lib/model-routing-policy.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const SELF_TEST = process.argv.includes("--self-test");
const NEEDLES = [...FORBIDDEN_IMPORT_SUBSTRINGS, ...FORBIDDEN_TOKENS];

function tracked() {
  const r = spawnSync("git", ["ls-files"], { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) { console.error("check-model-tap-boundary: git ls-files failed"); process.exit(1); }
  return r.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
}

function globToRegExp(glob) {
  const body = glob.split("/").map((seg) =>
    seg.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*")
  ).join("\\/");
  return new RegExp("^" + body + "$");
}

// Strip block comments and // line comments, but NOT the // in a URL scheme (://).
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

// Return findings [{line, needle}] for a decision-path file body. Scans the RAW
// body — deliberately NOT comment-stripped: stripping can span a `/*`…`*/` that
// lives inside string literals and erase a real call between them (a false
// negative). For a security fence over-reporting is the safe default; a
// decision-path file has no reason to mention a model call even in a comment.
function scanBody(body) {
  const lower = body.toLowerCase();
  const findings = [];
  for (const needle of NEEDLES) {
    let idx = lower.indexOf(needle.toLowerCase());
    while (idx !== -1) {
      const line = body.slice(0, idx).split("\n").length;
      findings.push({ line, needle });
      idx = lower.indexOf(needle.toLowerCase(), idx + needle.length);
    }
  }
  return findings;
}

// The in-repo tap must make NO live model call (AGENTS.md — no live API calls in
// the public Review Hub; the free/local client is out-of-tree, DR-029, and the
// in-repo tap is fixture-backed). These are the network-call and provider-client
// shapes: every FORBIDDEN_TOKEN except the env PREFIX (which the policy legitimately
// declares as data), plus a bare `fetch(`.
const LIVE_CALL_NEEDLES = [...FORBIDDEN_TOKENS.filter((t) => t !== "SIGNALGRID_AGENT_MODEL_"), "fetch("];
// Scanned on the TAP module ONLY — never the policy, which DEFINES the denylist and
// therefore contains every one of these strings as data.
const LIVE_CALL_SCAN_MODULE = "scripts/lib/agent-model-tap.mjs";

// A CALL-shaped needle ends in "(" (`fetch(`, `new OpenAI(`). JS lets whitespace —
// spaces, tabs, a newline — sit before the paren and between `new` and the
// constructor, so a literal `indexOf("fetch(")` misses `fetch (…)`, `fetch\n(…)`,
// and `new OpenAI (…)`. Compile those to a whitespace-tolerant regex; the rest
// (URL paths, module names, the ollama ports) stay literal substrings.
function callNeedleRegExp(needle) {
  const esc = needle
    .slice(0, -1) // drop the trailing "("
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&") // escape regex specials
    .replace(/\s+/g, "\\s+"); // any run of space tolerates any whitespace
  return new RegExp(esc + "\\s*\\(", "gi");
}

function scanForLiveCall(body) {
  const lower = body.toLowerCase();
  const findings = [];
  for (const needle of LIVE_CALL_NEEDLES) {
    if (needle.endsWith("(")) {
      const re = callNeedleRegExp(needle);
      let m;
      while ((m = re.exec(body)) !== null) {
        findings.push({ line: body.slice(0, m.index).split("\n").length, needle });
        if (m.index === re.lastIndex) re.lastIndex += 1; // never loop on a zero-width match
      }
      continue;
    }
    let idx = lower.indexOf(needle.toLowerCase());
    while (idx !== -1) {
      findings.push({ line: body.slice(0, idx).split("\n").length, needle });
      idx = lower.indexOf(needle.toLowerCase(), idx + needle.length);
    }
  }
  return findings;
}

// Import/require/dynamic-import specifiers in a body.
function importSpecifiers(body) {
  const stripped = stripComments(body);
  const specs = [];
  const res = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of res) { let m; while ((m = re.exec(stripped))) specs.push(m[1]); }
  return specs;
}

function deriveScope(all) {
  const regexes = FORBIDDEN_ROOTS.map(globToRegExp);
  const perRoot = FORBIDDEN_ROOTS.map(() => 0);
  const set = new Set();
  for (const f of all) {
    regexes.forEach((re, i) => { if (re.test(f)) { set.add(f); perRoot[i]++; } });
  }
  return { files: [...set], perRoot };
}

function runReal() {
  const all = tracked();
  const { files, perRoot } = deriveScope(all);

  // FLOOR: scope must be non-empty and every declared root must resolve to >=1
  // real file — otherwise the scan passes vacuously over the part it stopped
  // watching.
  const emptyRoots = FORBIDDEN_ROOTS.filter((_, i) => perRoot[i] === 0);
  if (files.length === 0 || emptyRoots.length > 0) {
    console.error("Model-tap boundary FLOOR FAILED — scope did not resolve to real files:");
    if (files.length === 0) console.error("  the derived decision-path scope is EMPTY");
    for (const r of emptyRoots) console.error(`  root matched ZERO tracked files: ${r}`);
    process.exit(1);
  }

  const violations = [];
  for (const f of files) {
    let body;
    try { body = readFileSync(join(repo, f), "utf8"); } catch { continue; }
    for (const v of scanBody(body)) violations.push({ file: f, ...v });
  }

  // Reciprocal fence: the tap and the policy import nothing from the decision path.
  const reciprocal = [];
  for (const m of TAP_MODULES) {
    let body;
    try { body = readFileSync(join(repo, m), "utf8"); } catch { reciprocal.push({ file: m, spec: "(module missing)" }); continue; }
    for (const spec of importSpecifiers(body)) {
      if (RECIPROCAL_FORBIDDEN_IMPORT_SUBSTRINGS.some((s) => spec.includes(s))) reciprocal.push({ file: m, spec });
    }
  }

  // The in-repo tap makes no live model call (fixture-backed; the live client is
  // out-of-tree, DR-029/AGENTS.md). Scan the tap module only.
  const liveCall = [];
  {
    let body = null;
    try { body = readFileSync(join(repo, LIVE_CALL_SCAN_MODULE), "utf8"); }
    catch { liveCall.push({ line: 0, needle: "(tap module missing)" }); }
    if (body) for (const f of scanForLiveCall(body)) liveCall.push(f);
  }

  if (violations.length === 0 && reciprocal.length === 0 && liveCall.length === 0) {
    console.log(`Model-tap boundary check passed — ${files.length} decision-path file(s) across ${FORBIDDEN_ROOTS.length} roots reference no model tap, env, or call shape; the tap imports nothing from the decision path and makes no live model call. No model can reach the /v1 core (golden rule 2).`);
    process.exit(0);
  }
  console.error("Model-tap boundary FAILED — a model reference reached the decision path, or the in-repo tap made a live call (golden rule 2 / AGENTS.md):");
  for (const v of violations) console.error(`  ${v.file}:${v.line}  contains forbidden token \`${v.needle}\``);
  for (const r of reciprocal) console.error(`  ${r.file}  imports from the decision path: \`${r.spec}\` (reciprocal fence)`);
  for (const c of liveCall) console.error(`  ${LIVE_CALL_SCAN_MODULE}:${c.line}  in-repo tap contains a live-call shape \`${c.needle}\` — the free/local client is out-of-tree (DR-029); keep the tap fixture-backed`);
  process.exit(1);
}

function selfTest() {
  let checks = 0, failed = 0;
  const expect = (cond, msg) => { checks++; if (!cond) { failed++; console.log(`  ✗ ${msg}`); } else console.log(`  ✓ ${msg}`); };

  // Expected-RED bodies (a decision-path file must not contain these):
  expect(scanBody(`import { draftWithModel } from "../lib/agent-model-tap.mjs";`).length > 0,
    "a decision-path file importing the tap is flagged");
  expect(scanBody(`const u = process.env.SIGNALGRID_AGENT_MODEL_BASE_URL;`).length > 0,
    "a decision-path file naming the tap env var is flagged");
  expect(scanBody(`await fetch(base + "/chat/completions", {});`).length > 0,
    "a decision-path file with an OpenAI call shape is flagged");
  expect(scanBody(`import { tierFor } from "../lib/model-routing-policy.mjs";`).length > 0,
    "a decision-path file importing the policy module is flagged");
  // PERMANENT planted-red: keep this one so the gate is provably watched to fail.
  expect(scanBody(`const c = new OpenAI({ baseURL: "http://x:1234/v1" });`).length > 0,
    "PLANTED RED: an OpenAI client + local endpoint is flagged (permanent falsifiability fixture)");

  // The scan is RAW (not comment-stripped), so a token can never be hidden by
  // wrapping it in a comment or by `/*`…`*/` delimiters that live inside string
  // literals — the false-negative class the verify pass found. Over-report is the
  // safe default for a fence.
  expect(scanBody(`// even a comment mentioning chat/completions is flagged`).length > 0,
    "a forbidden token is flagged even inside a comment (raw scan — no hiding it)");
  expect(scanBody(`const openTok = "/*"; const url = base + "chat/completions"; const closeTok = "*/";`).length > 0,
    "a real call is NOT erased by /* */ delimiters sitting inside string literals");
  // Provider coverage: every provider the doctrine names is caught, not only OpenAI.
  expect(scanBody(`import Anthropic from "@anthropic-ai/sdk";`).length > 0, "an Anthropic/Claude SDK import is flagged");
  expect(scanBody(`await fetch("https://api.anthropic.com/v1/messages");`).length > 0, "a raw Anthropic REST call is flagged");
  expect(scanBody(`await fetch("http://localhost:11434/api/generate");`).length > 0, "an Ollama local call is flagged");
  expect(scanBody(`model.generateContent(prompt);`).length > 0, "a Gemini generateContent call is flagged");

  // Expected-GREEN body (clean decision-path code):
  expect(scanBody(`export function evaluate(x){ return x > 0 ? "allow":"deny"; }`).length === 0,
    "clean decision-path code is not flagged");

  // Reciprocal fence detection:
  const tapImportsDecisionPath = importSpecifiers(`import x from "../../lib/signalgrid-core/src/index.ts";`)
    .some((s) => RECIPROCAL_FORBIDDEN_IMPORT_SUBSTRINGS.some((sub) => s.includes(sub)));
  expect(tapImportsDecisionPath, "a tap importing from the decision path trips the reciprocal fence");
  const tapImportsViaAlias = importSpecifiers(`import x from "@workspace/signalgrid-core";`)
    .some((s) => RECIPROCAL_FORBIDDEN_IMPORT_SUBSTRINGS.some((sub) => s.includes(sub)));
  expect(tapImportsViaAlias, "a tap importing decision-path code via the @workspace/ alias trips the reciprocal fence");

  // Live-call fence on the in-repo tap (AGENTS.md — no live API calls here):
  expect(scanForLiveCall(`const r = await fetch(base + "/chat/completions", {});`).length > 0,
    "a live model fetch in the tap is flagged (no live API in the Review Hub)");
  expect(scanForLiveCall(`import Anthropic from "@anthropic-ai/sdk";`).length > 0,
    "a provider SDK import in the tap is flagged");
  // Whitespace-tolerant call matching: a space or newline before the paren, and
  // between `new` and the constructor, must not slip a live call past the fence.
  expect(scanForLiveCall(`const r = await fetch (base);`).length > 0,
    "a spaced `fetch (…)` is flagged (whitespace before the paren does not evade the fence)");
  expect(scanForLiveCall(`const r = await fetch\n  (base);`).length > 0,
    "a newline before the `fetch` paren is flagged");
  expect(scanForLiveCall(`const c = new OpenAI ({ baseURL });`).length > 0,
    "a spaced `new OpenAI (…)` is flagged");
  expect(scanForLiveCall(`const c = new   OpenAI(key);`).length > 0,
    "extra spaces between `new` and the constructor are flagged");
  expect(scanForLiveCall(`export function draftWithModel(){ return null; }`).length === 0,
    "a fixture-only tap body makes no live call and is not flagged");
  let liveTapClean = true;
  try { if (scanForLiveCall(readFileSync(join(repo, LIVE_CALL_SCAN_MODULE), "utf8")).length > 0) liveTapClean = false; }
  catch { liveTapClean = false; }
  expect(liveTapClean, "the live in-repo tap makes no live model call (fixture-backed today)");

  // FLOOR: the real derived scope is non-empty and every root resolves to files.
  const { files, perRoot } = deriveScope(tracked());
  expect(files.length > 0, `the derived decision-path scope is non-empty (${files.length} files)`);
  expect(perRoot.every((n) => n > 0), `every declared root resolves to >=1 tracked file (${perRoot.join(",")})`);

  // Deleting a decision-path ROOT must redden the gate, not silently shrink
  // coverage (the floor alone would still pass on the remaining roots — the
  // "switched-off gate reads as enforced" failure). Pin the four required roots.
  const rootBlob = FORBIDDEN_ROOTS.join("\n");
  expect(rootBlob.includes("lib/**/src"), "the lib/* decision-core root is declared");
  expect(rootBlob.includes("artifacts/api-server/src"), "the /v1 api-server root is declared");
  expect(rootBlob.includes("lib/integrations/src"), "the connectors root is declared");
  expect(/-proof\.ts/.test(rootBlob), "the proofs root is declared");
  expect(rootBlob.includes("DecisionEngine.swift") && rootBlob.includes("AppWorkflows.swift"),
    "the native decision-path roots (DecisionEngine.swift, AppWorkflows.swift) are declared");

  // The live tap/policy actually pass the reciprocal fence today.
  let liveReciprocalClean = true;
  for (const m of TAP_MODULES) {
    try {
      const body = readFileSync(join(repo, m), "utf8");
      if (importSpecifiers(body).some((s) => RECIPROCAL_FORBIDDEN_IMPORT_SUBSTRINGS.some((sub) => s.includes(sub)))) liveReciprocalClean = false;
    } catch { liveReciprocalClean = false; }
  }
  expect(liveReciprocalClean, "the live tap and policy import nothing from the decision path");

  console.log(failed === 0 ? `\nself-test passed (${checks}/${checks})` : `\nself-test FAILED (${checks - failed}/${checks})`);
  process.exit(failed === 0 ? 0 : 1);
}

if (SELF_TEST) selfTest(); else runReal();
