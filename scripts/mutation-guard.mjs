// Mutation guard — turns "is this guard falsifiable?" into a gate.
//
// WHY THIS EXISTS, precisely.
//
// Every grant-emitting connector is brute-forced by `scripts/src/lib/grant-safety.ts`
// over its full input space, and every one reports 0 mismatches. That proves a real
// thing: no unknown, missing or malformed input reaches a grant. It does NOT prove that
// each individual guard is doing work, and the two properties are easy to confuse.
//
// The reason is structural. Grant-safety observes only GRANT-NESS. Every malformed value
// already normalizes to a denying sentinel, so deleting an integrity condition changes
// `reportIntegrity` and changes no action — the enumeration stays green and the condition
// is load-bearing but unproven. Two adversarial reviews each found exactly that:
//
//   - `device-management-health`: two of three terms in the channel-consistency guard
//     could be deleted with the proof at 141/141 green, silently changing a reason code.
//   - `link-usability`: three conditions around the association branch survived, and the
//     branch they guarded turned out to be DEAD — its candidate won zero times out of
//     360 opportunities, so an asserted "this device is not on the network" was being
//     reported as a generic unknown.
//
// Both were found because a reviewer thought to try mutation testing. That is not a
// control; it is luck with good habits. This makes it a gate.
//
// WHAT IT DOES. For each registered {file, proof} pair it applies one mutation at a time,
// runs that proof, restores the file, and classifies:
//
//   killed      — the proof failed. The guard is falsifiable. Good.
//   SURVIVOR    — the proof passed. The guard is unfalsifiable: either dead code, or
//                 real behaviour with no test. Fails this gate unless allowlisted.
//   hung        — the proof did not terminate inside the timeout. Reported separately
//                 and treated as killed-with-a-warning, because a hang IS a detected
//                 regression — just one whose CI failure mode is a job burning its whole
//                 budget instead of going red. Deleting `MAX_PROTOTYPE_DEPTH` does this:
//                 the prototype walk meets a Proxy that returns a fresh prototype from
//                 every `getPrototypeOf` and allocates forever.
//   skipped     — the mutation did not change the file (pattern absent). Not counted.
//
// The gate is "no NEW survivors", not "zero survivors". Some guards are genuinely inert
// at current severities — a contradiction candidate already outranks what they guard —
// and are kept because they encode the rule and would become load-bearing the moment a
// severity changes. Those carry an allowlist entry with a reason, mirroring how the
// source files already label them. An allowlist entry that stops matching is itself a
// failure: it means the code moved and the justification was not revisited.

import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** True only when this file is the entrypoint, so another script can import its
 *  registry without running the gate. */
const IS_MAIN = process.argv[1] !== undefined && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href;

/** Per-proof wall-clock ceiling. Generous enough for the largest enumeration
 *  (device-management-health runs 1.35M raw reports twice in ~11s) and tight enough that
 *  a hang is detected in seconds rather than at a CI job's timeout. */
const PROOF_TIMEOUT_MS = 90_000;

// ── what to mutate ────────────────────────────────────────────────────────────
//
// Deliberately line-oriented and conservative rather than a general AST mutator. A
// mutation that fails to parse makes the proof crash, which reads as "killed" and would
// quietly inflate the kill rate — so the patterns below only produce syntactically valid
// TypeScript. Each is a shape this codebase actually uses for a guard.
const MUTATORS = [
  {
    id: "cond-false",
    // `if (<anything>) {` → `if (false) {`  — delete the branch.
    match: /^(\s*)if \((.+)\) \{$/,
    apply: (m) => `${m[1]}if (false) {`,
    describe: (m) => `if (${truncate(m[2])}) → if (false)`,
  },
  {
    id: "else-if-false",
    match: /^(\s*)\} else if \((.+)\) \{$/,
    apply: (m) => `${m[1]}} else if (false) {`,
    describe: (m) => `else if (${truncate(m[2])}) → else if (false)`,
  },
  {
    id: "else-if-true",
    // Removes a guard on an else-branch without deleting the branch itself — this is
    // what catches a suppression guard like `} else if (!contradictory) {`.
    match: /^(\s*)\} else if \((!.+)\) \{$/,
    apply: (m) => `${m[1]}} else if (true) {`,
    describe: (m) => `else if (${truncate(m[2])}) → else if (true)`,
  },
  {
    id: "disjunct-false",
    // A trailing `||` operand on its own line — how the multi-term guards are written.
    match: /^(\s*)(.+) \|\|$/,
    apply: (m) => `${m[1]}false ||`,
    describe: (m) => `${truncate(m[2])} || → false ||`,
  },
  {
    id: "conjunct-true",
    // A trailing `&&` operand on its own line.
    match: /^(\s*)(.+) &&$/,
    apply: (m) => `${m[1]}true &&`,
    describe: (m) => `${truncate(m[2])} && → true &&`,
  },
  {
    id: "return-flip",
    // `return true;` / `return false;` inside a predicate — flips a fail-closed default.
    match: /^(\s*)return (true|false);$/,
    apply: (m) => `${m[1]}return ${m[2] === "true" ? "false" : "true"};`,
    describe: (m) => `return ${m[2]} → return ${m[2] === "true" ? "false" : "true"}`,
  },
];

const truncate = (s) => (s.length > 58 ? `${s.slice(0, 55)}...` : s);

// ── registry ──────────────────────────────────────────────────────────────────
//
// Scoped on purpose to the files whose correctness is the allow-path: the normalizers
// and evaluators of the grant-emitting connectors. Widening this is cheap; widening it
// without meaning to would make the gate slow and its output unreadable.
export const TARGETS = [
  {
    proof: "proof:device-management-health",
    files: [
      "lib/integrations/src/integrations/device-management-health/evaluate.ts",
      "lib/integrations/src/integrations/device-management-health/device-management-health-connector.ts",
    ],
  },
  {
    proof: "proof:link-usability",
    files: [
      "lib/integrations/src/integrations/link-usability/evaluate.ts",
      "lib/integrations/src/integrations/link-usability/link-usability-connector.ts",
    ],
  },
  {
    proof: "proof:task-exception",
    files: [
      "lib/integrations/src/integrations/task-exception/evaluate.ts",
      "lib/integrations/src/integrations/task-exception/task-exception-connector.ts",
    ],
  },
  {
    proof: "proof:verdict-attestation",
    files: ["lib/verdict-attestation/src/attest.ts", "lib/verdict-attestation/src/canonical.ts"],
  },
];

// ── known-inert survivors ─────────────────────────────────────────────────────
//
// Each entry needs a REASON, and the reason has to be the kind a reader can check. "It's
// fine" is not one. An entry whose `line` no longer matches fails the gate: the code
// moved and nobody re-derived whether the justification still holds.
const ALLOWED = [
  {
    file: "lib/integrations/src/integrations/link-usability/evaluate.ts",
    line: 'link.linkProgress !== "not_associated"',
    reason:
      "Inert at current severities: the duplicate candidate it suppresses is identical to the one already raised, so no verdict changes. Kept because it states 'raise a finding once' and becomes load-bearing if either candidate's severity moves. Labelled inert in the source.",
  },
  {
    file: "lib/integrations/src/integrations/link-usability/evaluate.ts",
    line: "!linkReportInconsistent &&",
    reason:
      "Inert on the ASSOCIATION branch: the inconsistency candidate is itself step_up and pushed first, so it wins the tie regardless. (The same guard on the LADDER is load-bearing, because those candidates alert — that instance is killed.) Labelled inert in the source.",
  },
  {
    file: "lib/integrations/src/integrations/link-usability/evaluate.ts",
    line: "} else if (!roamReportInconsistent) {",
    reason:
      "Inert at current severities: sticky/excessive are step_up, equal to the contradiction's own severity and pushed after it, and neither pushes a finding. Raising either to alert makes it load-bearing immediately. Labelled inert in the source.",
  },
  {
    file: "lib/integrations/src/integrations/link-usability/link-usability-connector.ts",
    line: "!Array.isArray(report) &&",
    reason:
      "Documented redundant in the source: an array already fails the key scan on its own `length`.",
  },
  {
    file: "lib/integrations/src/integrations/link-usability/link-usability-connector.ts",
    line: "report !== null &&",
    reason:
      "Documented redundant in the source: hasOwnProperty.call(null, …) throws into the wrapped read, which sets readFailed, which forces malformed.",
  },
  {
    file: "lib/integrations/src/integrations/link-usability/link-usability-connector.ts",
    line: "if (!plain) return undefined;",
    reason: "Documented redundant in the source: `!plain` already forces malformed.",
  },
  {
    file: "lib/integrations/src/integrations/link-usability/link-usability-connector.ts",
    line: 'if (typeof k === "symbol") return true;',
    reason:
      "Documented redundant in the source: `known` holds only strings, so the includes() below rejects every symbol anyway.",
  },
  {
    file: "lib/integrations/src/integrations/device-management-health/device-management-health-connector.ts",
    line: "!Array.isArray(report) &&",
    reason: "Documented redundant in the source: an array fails the key scan on its own `length`.",
  },
  {
    file: "lib/integrations/src/integrations/device-management-health/device-management-health-connector.ts",
    line: 'if (typeof k === "symbol") return true;',
    reason: "Documented redundant in the source: `known` holds only strings.",
  },
  {
    file: "lib/integrations/src/integrations/device-management-health/device-management-health-connector.ts",
    line: 'typeof report === "object" &&',
    reason:
      "Documented redundant in the source: a primitive or function reaching the key scan makes Reflect.ownKeys throw or return unrecognized keys, ending at malformed either way.",
  },
  {
    file: "lib/integrations/src/integrations/device-management-health/device-management-health-connector.ts",
    line: "report !== null &&",
    reason:
      "Documented redundant in the source: hasOwnProperty.call(null, …) throws into the wrapped read, which sets readFailed, which forces malformed.",
  },
  {
    file: "lib/integrations/src/integrations/link-usability/link-usability-connector.ts",
    line: 'typeof report === "object" &&',
    reason: "Documented redundant in the source, same reasoning as its device-management-health twin.",
  },
  {
    file: "lib/integrations/src/integrations/task-exception/task-exception-connector.ts",
    line: 'typeof report === "object" &&',
    reason:
      "Documented redundant in the source, same reasoning as its device-management-health twin: a primitive or function reaching the key scan makes Reflect.ownKeys throw or return unrecognized keys, ending at malformed either way.",
  },
  {
    file: "lib/integrations/src/integrations/task-exception/task-exception-connector.ts",
    line: "report !== null &&",
    reason:
      "Documented redundant in the source: hasOwnProperty.call(null, …) throws into the wrapped read, which sets readFailed, which forces malformed.",
  },
  {
    file: "lib/integrations/src/integrations/task-exception/task-exception-connector.ts",
    line: "!Array.isArray(report) &&",
    reason: "Documented redundant in the source: an array fails the key scan on its own `length`.",
  },
  {
    file: "lib/verdict-attestation/src/attest.ts",
    line: "return false;",
    reason:
      "The catch in `digestsEqual` is UNREACHABLE: timingSafeEqual throws only on a length mismatch, already refused one line earlier. Kept as the rule 'an exception is not a match'. Labelled unreachable in the source.",
  },
  {
    file: "lib/verdict-attestation/src/attest.ts",
    line: 'typeof own("issuedAt") !== "number" ||',
    reason:
      "Redundant with the `!Number.isFinite` term on the next line — any non-number fails that too. Kept because the pair reads as one contract. Labelled redundant in the source.",
  },
];

// ── runner ────────────────────────────────────────────────────────────────────

function runProof(proof) {
  const run = spawnSync("pnpm", ["run", proof], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: PROOF_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  // `spawnSync` reports a timeout via `error.code === "ETIMEDOUT"` on some platforms and
  // via a null status with a signal on others. Treat both as a hang.
  const timedOut = run.error?.code === "ETIMEDOUT" || (run.status === null && run.signal !== null);
  if (timedOut) return "hung";
  const out = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  const summary = out.match(/summary=(pass|fail) \((\d+)\/(\d+)\)/);
  // No summary line at all means the proof crashed — the mutation broke it, which counts
  // as killed.
  if (!summary) return "killed";
  return summary[1] === "pass" ? "survivor" : "killed";
}

function mutationsFor(file) {
  const abs = join(repoRoot, file);
  const original = readFileSync(abs, "utf8");
  const lines = original.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    for (const mutator of MUTATORS) {
      const m = lines[i].match(mutator.match);
      if (!m) continue;
      const replaced = mutator.apply(m);
      if (replaced === lines[i]) continue; // no-op mutation, skip
      const mutated = [...lines];
      mutated[i] = replaced;
      out.push({
        file,
        abs,
        original,
        lineNo: i + 1,
        sourceLine: lines[i].trim(),
        mutator: mutator.id,
        describe: mutator.describe(m),
        content: mutated.join("\n"),
      });
    }
  }
  return out;
}

function isAllowed(mutation) {
  return ALLOWED.find((a) => a.file === mutation.file && mutation.sourceLine.includes(a.line));
}

function main() {
  const only = process.argv.find((a) => a.startsWith("--proof="))?.split("=")[1];
  const targets = only ? TARGETS.filter((t) => t.proof === only) : TARGETS;
  if (targets.length === 0) {
    console.error(`No target matches --proof=${only}. Known: ${TARGETS.map((t) => t.proof).join(", ")}`);
    process.exit(1);
  }

  console.log("Mutation guard — every registered guard must be falsifiable by its own proof\n");

  // An allowlist entry that no longer matches any line is itself a finding: the code moved
  // and the justification was never revisited. Checked BEFORE any mutation runs, so a stale
  // entry surfaces in seconds rather than after the full sweep.
  let staleAllowlist = 0;
  for (const entry of ALLOWED) {
    const abs = join(repoRoot, entry.file);
    let text;
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      console.error(`✗ allowlist entry references a missing file: ${entry.file}`);
      staleAllowlist += 1;
      continue;
    }
    if (!text.includes(entry.line)) {
      console.error(`✗ STALE allowlist entry — no line matches in ${entry.file}:\n    "${entry.line}"`);
      console.error("    The code moved. Re-derive whether the justification still holds, then update or remove.");
      staleAllowlist += 1;
    }
  }
  if (staleAllowlist > 0) {
    console.error(`\nMutation guard FAILED: ${staleAllowlist} stale allowlist entr${staleAllowlist === 1 ? "y" : "ies"}.`);
    process.exit(1);
  }

  let total = 0;
  let killed = 0;
  let hung = 0;
  let allowed = 0;
  const survivors = [];

  for (const target of targets) {
    console.log(`── ${target.proof}`);
    for (const file of target.files) {
      const mutations = mutationsFor(file);
      console.log(`   ${file} — ${mutations.length} mutations`);
      for (const mutation of mutations) {
        total += 1;
        writeFileSync(mutation.abs, mutation.content);
        let verdict;
        try {
          verdict = runProof(target.proof);
        } finally {
          // ALWAYS restore, including on an unexpected throw. A mutation left on disk would
          // be catastrophic — it is a deliberately broken security guard.
          writeFileSync(mutation.abs, mutation.original);
        }
        if (verdict === "killed") {
          killed += 1;
        } else if (verdict === "hung") {
          hung += 1;
          console.log(`   ⚠ HANG  ${file}:${mutation.lineNo}  ${mutation.describe}`);
          console.log("           (detected, but its CI failure mode is a job timeout rather than a red assertion)");
        } else {
          const entry = isAllowed(mutation);
          if (entry) {
            allowed += 1;
          } else {
            survivors.push(mutation);
            console.log(`   ✗ SURVIVED  ${file}:${mutation.lineNo}  ${mutation.describe}`);
          }
        }
      }
    }
  }

  console.log(
    `\nmutations=${total} killed=${killed} hung=${hung} known-inert=${allowed} survivors=${survivors.length}`,
  );

  if (survivors.length > 0) {
    console.error("\nMutation guard FAILED — these guards are unfalsifiable by their own proof:\n");
    for (const s of survivors) {
      console.error(`  ${s.file}:${s.lineNo}`);
      console.error(`    ${s.sourceLine}`);
      console.error(`    ${s.describe}`);
    }
    console.error(
      "\nEach is one of three things, and they need different fixes:\n" +
        "  1. DEAD CODE — the branch cannot win. Delete it, or fix the ordering that makes it lose.\n" +
        "  2. REAL BEHAVIOUR WITH NO TEST — add a fixture that pins it. This is the common case,\n" +
        "     and the one the grant-safety enumeration structurally cannot catch.\n" +
        "  3. GENUINELY INERT at current severities — keep it, label it inert in the source, and\n" +
        "     add an ALLOWED entry here with a reason a reader can check.\n",
    );
    process.exit(1);
  }

  console.log("\nMutation guard passed — every registered guard is falsifiable, or documented as inert.");

}

if (IS_MAIN) main();
