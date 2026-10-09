#!/usr/bin/env node
/**
 * The mutation sweep is sharded across CI runners. This gate proves the sharder
 * PARTITIONS the registry — every target lands in exactly one shard, for every
 * shard count the lane might plausibly use.
 *
 * WHY THIS IS A GATE AND NOT A COMMENT. A sharder that drops a target does not
 * fail; it reports success over work it never did. That is the precise failure
 * the mutation guard exists to catch, and putting it in the SCHEDULER would put
 * it somewhere the mutation guard cannot see. The sweep takes forty minutes, so
 * nobody re-runs it to check the split; this runs in milliseconds because
 * `mutationsFor` parses text and executes no proof.
 *
 * Balance is REPORTED, never gated. The spread depends on how lumpy the registry
 * happens to be, and a threshold on it would fail the build for a defensible
 * distribution — a flaky gate gets switched off, and this one is worth keeping.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TARGETS, ALLOWED, shardTargets, mutationsFor, MUTATORS, lineMutations, unknownArgs, resolveAllowedLine, allowlistProblem, auditAllowlist, allowlistFailureCount, isAllowed } from "./mutation-guard.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
const failures = [];
const check = (name, ok) => { if (ok) { passed += 1; console.log(`  ok — ${name}`); } else { failures.push(name); console.error(`  FAIL — ${name}`); } };

console.log("Mutation sharding — the split must lose nothing\n");

for (const n of [1, 2, 3, 4, 8, TARGETS.length, TARGETS.length + 3]) {
  const seen = [];
  for (let i = 0; i < n; i += 1) seen.push(...shardTargets(TARGETS, i, n).map((t) => t.proof));
  const unique = new Set(seen);
  check(`N=${n}: every target appears, exactly once (${seen.length} placements, ${unique.size} distinct)`,
    seen.length === TARGETS.length && unique.size === TARGETS.length);
}

// DETERMINISM IS LOAD-BEARING and easy to miss. Each shard runs in its own CI job
// on its own runner, and each computes the partition independently from the same
// registry — nothing communicates the split between them. If two runners disagreed
// about which targets belong to shard 2, some targets would be swept twice and
// others never, and the lane would still report every job green. The agreement is
// implicit, so it is asserted here rather than assumed.
//
// WHAT THIS DOES AND DOES NOT PROVE. It compares repeated computations over the
// same registry, so it catches genuine nondeterminism — a `Math.random`, a clock,
// an environment read — which is the class that would actually desynchronise two
// runners, and the class this repository forbids in decided paths anyway. It does
// NOT prove order-independence, because it cannot: every shard reads the same
// TARGETS from the same commit, so input order is a constant across the matrix and
// order-independence is not a property correctness needs here. Stated because a
// check named "determinism" invites being read as proving more than it does.
for (const n of [3, 4]) {
  const once = shardTargets(TARGETS, 1, n).map((t) => t.proof).join("|");
  const again = shardTargets(TARGETS, 1, n).map((t) => t.proof).join("|");
  const third = shardTargets([...TARGETS], 1, n).map((t) => t.proof).join("|");
  check(`N=${n}: shard 1 is identical across independent computations, in order`,
    once === again && once === third);
}

// Falsification: the guard must reject shard arguments that cannot describe a partition.
for (const [i, n] of [[0, 0], [2, 2], [-1, 3], [1.5, 3]]) {
  let threw = false;
  try { shardTargets(TARGETS, i, n); } catch { threw = true; }
  check(`rejects --shard=${i}/${n} rather than silently sweeping a subset`, threw);
}

// ── The mutators must still fire on the shapes they exist to catch ────────────
//
// The sharder above proves no TARGET is dropped. This proves no MUTATOR is
// silently neutered — the other way the sweep can report success over work it
// never did. A one-character narrowing of an operand regex (`(.+)` → `([^)]+)`)
// stops mutating every function-call guard operand, and because the full sweep
// is scheduled/post-merge, no per-PR check would notice: the drop reads as
// "skipped", never SURVIVOR. So each mutator is asserted to fire on a
// representative guard-line shape, through the SAME `lineMutations` the sweep
// uses. The fixture that matters most is a `&&`/`||` operand carrying a `)` — the
// exact multi-term shape (`isFinite(x) &&`, `!contradictory(cand) &&`) two named
// findings were built to catch and the exact shape the narrowing kills.
const MUTATOR_FIXTURES = [
  { line: `  if (isFinite(expiry) && report.ok) {`, expect: ["cond-false"] },
  { line: `  } else if (tier !== "prod") {`, expect: ["else-if-false"] },
  { line: `  } else if (!contradictory) {`, expect: ["else-if-false", "else-if-true"] },
  { line: `    isFinite(expiry) &&`, expect: ["conjunct-true"] },
  { line: `    !contradictory(cand) &&`, expect: ["conjunct-true"] },
  { line: `    report.credentialRef.length > 0 ||`, expect: ["disjunct-false"] },
  { line: `    zone === expectedZone ||`, expect: ["disjunct-false"] },
  { line: `    return false;`, expect: ["return-flip"] },
  { line: `    return true;`, expect: ["return-flip"] },
  { line: `  const remaining = budget - spent;`, expect: [] },
  // The brace-less mutator is OPT-IN per target (`oneLine: true`), so the same
  // guard line is asserted twice: it fires when the target opted in, and it
  // stays silent when it did not — a target that never opted in is never swept
  // by it, and the census line reports that rather than the sweep pretending.
  { line: `  if (typeof raw !== "string") return null;`, opts: { oneLine: true }, expect: ["oneline-cond-false"] },
  { line: `  if (!isPlainReport(report)) return UNKNOWN; // hostile shape`, opts: { oneLine: true }, expect: ["oneline-cond-false"] },
  { line: `  if (typeof raw !== "string") return null;`, expect: [] },
];
// Non-vacuity: the case set is itself pinned. Deleting fixtures to weaken this
// self-test is the same class of attack it defends against, so a shrunk fixture
// list fails the gate. Also assert every mutator id is exercised by at least one
// fixture, so adding a mutator without a fixture cannot leave it untested.
const FIXTURE_FLOOR = 13;
check(`mutator self-test is non-vacuous (${MUTATOR_FIXTURES.length} fixtures, floor ${FIXTURE_FLOOR})`,
  MUTATOR_FIXTURES.length >= FIXTURE_FLOOR);
const exercised = new Set(MUTATOR_FIXTURES.flatMap((f) => f.expect));
check(`every mutator id is exercised by a fixture (${exercised.size}/${MUTATORS.length})`,
  MUTATORS.every((m) => exercised.has(m.id)));
for (const f of MUTATOR_FIXTURES) {
  const got = lineMutations(f.line, f.opts ?? {}).map((x) => x.mutator).sort();
  const want = [...f.expect].sort();
  check(`mutators fire on \`${f.line.trim()}\`${f.opts?.oneLine ? " (oneLine opt-in)" : ""} → [${want.join(", ") || "none"}]`,
    got.length === want.length && got.every((id, i) => id === want[i]));
}

// ── The hand-registered safety-critical targets must stay in the registry ─────
//
// `check-guard-registries.mjs` only requires the GRANT-SAFETY population to be in
// TARGETS; these four are registered by hand and sit outside it, so dropping one
// (e.g. `continuity.ts`, whose reconcileDecisions can emit `allow`) escapes that
// gate and shrinks the sweep by one safety-critical file with every per-PR check
// still green. Pin them by name.
const PINNED_PROOFS = ["proof:verdict-attestation", "proof:decision-continuity", "proof:pim-activation", "proof:dual-control"];
const present = new Set(TARGETS.map((t) => t.proof));
for (const p of PINNED_PROOFS) {
  check(`hand-registered safety-critical target present: ${p}`, present.has(p));
}

// ── Wave 5 (2026-10-01): six families joined the brace-less sweep ─────────────
// Their registered files held no one-line `if (...) return` guard when they joined, so
// joining added 0 mutations and 0 survivors — the opt-in is a ratchet for the NEXT
// brace-less guard added there. Pin it so the flag cannot be dropped quietly.
for (const p of ["ot-posture", "token-binding", "carrier-reachability", "credential-exposure", "data-protection", "identity-risk"]) {
  check(`brace-less sweep: proof:${p} stays opted in (oneLine: true)`, TARGETS.find((t) => t.proof === `proof:${p}`)?.oneLine === true);
}

// The three connector files round-1 review found unswept must STAY registered: the proofs pin their
// guards, but only the registration makes the sweep notice if a pin is ever lost.
for (const [proof, file] of [
  ["proof:carrier-reachability", "lib/integrations/src/integrations/carrier/reachability-connector.ts"],
  ["proof:ot-posture", "lib/integrations/src/integrations/ot-posture/ot-connector.ts"],
  ["proof:token-binding", "lib/integrations/src/integrations/token-binding/token-binding-connector.ts"],
]) {
  check(`${proof} keeps its connector registered: ${file.split("/").pop()}`, TARGETS.find((t) => t.proof === proof)?.files.includes(file) === true);
}

// ── Wave 7 (2026-10-09): the Graph posture connector, break-glass and response-accountability ──
// posture-connector.ts is the connector pointed at a real tenant and sat in NO target until now;
// the other two joined the brace-less sweep with their one-line guards pinned. Pin all three.
for (const p of ["graph-connector", "break-glass", "response-accountability"]) {
  check(`brace-less sweep: proof:${p} stays opted in (oneLine: true)`, TARGETS.find((t) => t.proof === `proof:${p}`)?.oneLine === true);
}
for (const [proof, file] of [
  ["proof:oauth-consent", "lib/integrations/src/integrations/oauth-consent/oauth-consent-connector.ts"],
  ["proof:access-governance", "lib/integrations/src/integrations/access-governance/access-governance-connector.ts"],
]) {
  check(`${proof} keeps its connector registered: ${file.split("/").pop()}`, TARGETS.find((t) => t.proof === proof)?.files.includes(file) === true);
}
check("brace-less sweep: proof:oauth-consent stays opted in (oneLine: true)", TARGETS.find((t) => t.proof === "proof:oauth-consent")?.oneLine === true);
check(
  "proof:graph-connector keeps the posture connector registered: posture-connector.ts",
  TARGETS.find((t) => t.proof === "proof:graph-connector")?.files.includes("lib/integrations/src/integrations/graph/posture-connector.ts") === true,
);

// ── Wave 8 (2026-10-09): the shared adapter guards, emitter-discipline, the attestation connector ──
// url-guard (the outbound SSRF-class check), bounded-text, redirect and vendor-values are imported by
// every emitter family and sat in NO target; emitter-discipline joined the brace-less sweep with all
// of their survivors pinned in its proof. The attestation connector's two survivors are pinned too.
check("brace-less sweep: proof:emitter-discipline stays opted in (oneLine: true)", TARGETS.find((t) => t.proof === "proof:emitter-discipline")?.oneLine === true);
for (const f of ["url-guard", "bounded-text", "redirect", "vendor-values", "emitter-resolver"]) {
  const file = `lib/integrations/src/integrations/adapters/${f}.ts`;
  check(`proof:emitter-discipline keeps the shared adapter guard registered: ${f}.ts`, TARGETS.find((t) => t.proof === "proof:emitter-discipline")?.files.includes(file) === true);
}
check("proof:device-attestation keeps its connector registered: device-attestation-connector.ts",
  TARGETS.find((t) => t.proof === "proof:device-attestation")?.files.includes("lib/integrations/src/integrations/device-attestation/device-attestation-connector.ts") === true);

check("proof:config-scope keeps the tenant-key guard registered and opted in: store-scope.ts",
  TARGETS.find((t) => t.proof === "proof:config-scope")?.files.includes("lib/integrations/src/integrations/store-scope.ts") === true
  && TARGETS.find((t) => t.proof === "proof:config-scope")?.oneLine === true);

// An unknown argument must be refused, not fall through to a full in-place sweep.
check("unknown flags are refused (--help, a bare -h, a space-separated --proof)", unknownArgs(["--help"]).length === 1 && unknownArgs(["-h"]).length === 1 && unknownArgs(["--proof", "x"]).length === 2);
check("a bare positional is refused (`mutation-guard.mjs proof:ot-posture` used to sweep everything)", unknownArgs(["proof:ot-posture"]).length === 1);
check("an EMPTY --proof= / --shard= is refused (a falsy value used to select every target)", unknownArgs(["--proof="]).length === 1 && unknownArgs(["--shard="]).length === 1);
check("a malformed value is refused: --proof==, --proof==x, --proof=a=b, --shard=1/4/9, --shard==1/4, --shard=a/b", ["--proof==", "--proof==proof:x", "--proof=a=b", "--shard=1/4/9", "--shard==1/4", "--shard=a/b"].every((a) => unknownArgs([a]).length === 1));
check("known flags and pnpm's forwarded bare -- are accepted", unknownArgs(["--", "--proof=proof:x", "--shard=0/4"]).length === 0);

// ── The allowlist resolves each entry to EXACTLY ONE line ─────────────────────
//
// `isAllowed` used to be `mutation.sourceLine.includes(entry.line)`, so an entry exempted
// EVERY line containing its text: attest.ts `return false;` also exempted the two real
// guards in digestsEqual (lines 42-43) that only the catch at 51 was meant to cover. An allowlist entry is a per-line justification; it must name one line.
function auditAllowed(entries, readText) {
  return auditAllowlist(entries, readText).map((p) =>
    p.kind === "missing" ? `${p.entry.file} (unreadable)`
      : p.kind === "stale" ? `${p.entry.file}: STALE "${p.entry.line}"`
        : `${p.entry.file}: AMBIGUOUS lines ${p.lines.join(",")} "${p.entry.line}"`);
}
{
  const bad = auditAllowed(ALLOWED, (f) => readFileSync(join(REPO, f), "utf8"));
  check(`every real ALLOWED entry resolves to exactly one line (${ALLOWED.length} entries)${bad.length ? " — " + bad.join(" | ") : ""}`, bad.length === 0);
  for (const b of bad) console.error(`    ${b}`);
}
{
  const fakeText = "a();\nreturn false;\nreturn false;\n";
  const read = (f) => { if (f === "gone.ts") throw new Error("ENOENT"); return fakeText; };
  const run = (e) => auditAllowed([e], read);
  check("fixture: the real-entry audit FAILS on an ambiguous entry, a stale entry and an unreadable file, and passes a unique one",
    run({ file: "x.ts", line: "return false;" }).some((b) => b.includes("AMBIGUOUS lines 2,3")) &&
    run({ file: "x.ts", line: "return 7;" }).some((b) => b.includes("STALE")) &&
    run({ file: "gone.ts", line: "a();" }).some((b) => b.includes("unreadable")) &&
    run({ file: "x.ts", line: "a();" }).length === 0);
}
{
  const text = ["export function f(a, b) {", "  if (a === b) return false;", "  if (!a) return false;", "  return true;", "}"].join("\n");
  check("fixture: a snippet two lines contain is AMBIGUOUS (lists both lines)", JSON.stringify(resolveAllowedLine({ line: "return false;" }, text).ambiguous) === "[2,3]");
  check("fixture: a snippet no line contains is STALE", resolveAllowedLine({ line: "return 42;" }, text).stale === true);
  check("fixture: a unique snippet resolves to its 1-based line", resolveAllowedLine({ line: "if (!a) return false;" }, text).line === 3);
  check("fixture: a mutation WITHOUT lineNo is never exempted by a stale or ambiguous entry (undefined === undefined must not match)",
    (() => {
      const saved2 = ALLOWED.splice(0, ALLOWED.length, { file: "fx.ts", line: "return false;", reason: "ambiguous" }, { file: "fx.ts", line: "return 42;", reason: "stale" });
      try {
        const noLine = (sourceLine) => ({ file: "fx.ts", original: text, sourceLine });
        return !isAllowed(noLine("return false;")) && !isAllowed(noLine("return 42;")) && !isAllowed({ file: "fx.ts", sourceLine: "return false;" });
      } finally { ALLOWED.splice(0, ALLOWED.length, ...saved2); }
    })());
  check("fixture: main()'s failure count is the audit problems plus the out-of-sweep entries (the sweep exits 1 iff it is > 0)",
    allowlistFailureCount([], []) === 0 && allowlistFailureCount([{}, {}], []) === 2 && allowlistFailureCount([], [{}]) === 1 && allowlistFailureCount([{}], [{}, {}]) === 3);
  check("fixture: `whole` pins a bare line that is a suffix of other lines (the attest.ts catch)", resolveAllowedLine({ line: "return false;", whole: true }, text.replace("  return true;", "    return false;")).ambiguous === undefined);
  check("fixture: allowlistProblem reports ambiguous with the lines, stale, and null for exactly one", allowlistProblem({ line: "return false;" }, text)?.kind === "ambiguous" && allowlistProblem({ line: "return false;" }, text).lines.join() === "2,3" && allowlistProblem({ line: "return 42;" }, text)?.kind === "stale" && allowlistProblem({ line: "if (!a) return false;" }, text) === null);
  const fx = (lineNo) => ({ file: "fx.ts", original: text, lineNo, sourceLine: text.split("\n")[lineNo - 1].trim() });
  const saved = ALLOWED.splice(0, ALLOWED.length, { file: "fx.ts", line: "if (!a) return false;", reason: "fixture" }, { file: "fx.ts", line: "return false;", reason: "fixture (ambiguous)" });
  try {
    check("fixture: an entry exempts only its own line, not a different line containing its text (the attest.ts shape)", !!isAllowed(fx(3)) && !isAllowed(fx(2)));
    check("fixture: an ambiguous entry exempts NOTHING (fail closed)", !isAllowed({ ...fx(2), sourceLine: "return false;" }) );
  } finally { ALLOWED.splice(0, ALLOWED.length, ...saved); }
}

// Reported, not gated.
const N = Number.parseInt(process.env.MUTATION_SHARDS ?? "4", 10);
const weight = (t) => t.files.reduce((n, f) => n + mutationsFor(f).length, 0);
const loads = Array.from({ length: N }, (_, i) => shardTargets(TARGETS, i, N).reduce((sum, t) => sum + weight(t), 0));
const totalMutations = TARGETS.reduce((n, t) => n + weight(t), 0);
// Report the quantity the sharder actually balances on. An earlier version of this
// line reported FILES per shard while `shardTargets` balanced MUTATIONS — a real
// number answering a different question than the one the reader would take it for.
console.log(`\n  balance at N=${N}, by MUTATIONS per shard: ${loads.join(" · ")}`);
console.log(`  ${TARGETS.length} targets · ${TARGETS.reduce((n, t) => n + t.files.length, 0)} files · ${totalMutations} mutations`);

const total = passed + failures.length;
console.log(`\nsummary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
