#!/usr/bin/env node
// Env-doc readers — a variable a document instructs must be read by something.
//
// `docs/env/MICROSOFT_GRAPH_ENV_EXAMPLE.md` said "Keep `SIGNALGRID_SANITIZE_OUTPUT=true`
// for any local output generation" and the smoke-test runbook listed the same line as
// required. No file in the repository read that variable — not a script, not a
// connector, not a workflow (measured 2026-09-06: zero readers outside the two
// documents). An operator following the runbook believed a sanitization control was
// switched on. It did not exist. That is the fail-open shape in prose: a control
// whose only implementation is the sentence saying to enable it.
//
// THE RULE, scoped to what is unambiguous: every `SIGNALGRID_<NAME>=` assignment a
// tracked document instructs must have at least one READER — a tracked file outside
// the docs that names the variable. The product's own namespace is the scope because
// a `SIGNALGRID_*` variable is, by its prefix, a claim that SignalGrid reads it;
// third-party variables in the same code blocks (Fleet's, Postgres's, a vendor CLI's)
// are read by the third party and are not this gate's question.
//
// Two things are NOT violations, and both are printed rather than silent:
//   · a name ending `_PLACEHOLDER` — the env-example convention for "substitute here";
//   · a name the SAME document declares as proposed, with
//     `<!-- proposed-env: NAME NAME … -->` — a lab plan may name the flag it intends
//     to build, and the declaration is what keeps "intended" from reading as "exists".
//
//   node scripts/check-env-doc-readers.mjs [--self-test]

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { vendoredSkillPrefixes } from "./lib/skill-plane.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const ASSIGNMENT = /\b(SIGNALGRID_[A-Z0-9_]+)=/g;
export const PROPOSED = /<!--\s*proposed-env:\s*([A-Z0-9_ ]+?)\s*-->/g;
/** Pasted external material and the VENDORED skill directories — first-party skills are checked (scripts/lib/skill-plane.mjs). */
const SKIP_PREFIXES = ["attached_assets/", "vendor/", "third_party/", ...vendoredSkillPrefixes(repoRoot)];

function git(args) {
  return execSync(`git ${args}`, { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

/** Pure: every instructed assignment in one document, with its line, and the names it declares proposed. */
export function assignmentsIn(text) {
  const names = [];
  text.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(ASSIGNMENT)) names.push({ name: m[1], line: i + 1 });
  });
  const proposed = new Set();
  for (const m of text.matchAll(PROPOSED)) for (const n of m[1].split(/\s+/).filter(Boolean)) proposed.add(n);
  return { names, proposed };
}

/**
 * Pure audit. `docs` is { [relPath]: text }; `readersOf(name)` answers how many tracked
 * non-doc files name the variable (the self-test feeds a table; the gate asks git).
 */
export function auditEnvDocReaders(docs, readersOf) {
  const fatal = [];
  const proposals = [];
  const placeholders = [];
  const checked = new Map(); // name → readers
  for (const [doc, text] of Object.entries(docs)) {
    const { names, proposed } = assignmentsIn(text);
    for (const { name, line } of names) {
      if (name.endsWith("_PLACEHOLDER")) {
        placeholders.push(`${doc}:${line} ${name}`);
        continue;
      }
      if (proposed.has(name)) {
        proposals.push(`${doc}:${line} ${name}`);
        continue;
      }
      if (!checked.has(name)) checked.set(name, readersOf(name));
      if (checked.get(name) === 0) {
        fatal.push(
          `${doc}:${line} instructs \`${name}=…\` and NOTHING reads ${name} — the control the sentence describes does not exist. ` +
            `Implement a reader, remove the instruction, or (for a flag a plan intends to build) declare it with <!-- proposed-env: ${name} -->.`,
        );
      }
    }
  }
  return { fatal, proposals, placeholders, checked };
}

/**
 * The shapes in which code READS an environment variable, across the languages this
 * tree holds: Node (`process.env.X`, `process.env["X"]`, a destructured `env.X`),
 * shell and YAML (`$X`, `${X}`), Python/Java/Swift (`getenv("X")`,
 * `environment["X"]`). A bare mention of the name — in a comment, a log line, a gate's
 * own explanation of why it exists — is NOT a reader; the first version of this
 * lookup matched the literal name and counted this file's header comment and the
 * preflight registration comment as three "readers" of SIGNALGRID_SANITIZE_OUTPUT,
 * the very variable the gate was written to catch.
 */
/**
 * Word boundaries that survive BOTH regex engines this repo runs on.
 *
 * `\b` IS NOT PORTABLE (fixed 2026-09-09, reproduced on this Mac). It is a GNU
 * extension: glibc's grep on the Linux CI box honours it, and Apple git 2.50.1's
 * `-E` — POSIX ERE, which has no such escape — matches nothing at all. Measured:
 *   git grep -l -E -e 'process\.env\.SIGNALGRID_MCP_PATH\b'  -> 0 files
 *   git grep -l -E -e 'process\.env\.SIGNALGRID_MCP_PATH'     -> 1 file
 * So on macOS every `\b` shape below matched NOTHING, `readersOf` returned 0 for
 * variables the tree plainly reads, and the gate invented 19 violations — CLAUDE.md
 * among them — while CI stayed green. A gate that fails on one platform and passes
 * on the other teaches the operator to disbelieve it, which is worse than no gate.
 * An explicit character class says the same thing in both dialects.
 */
const BOUNDARY_BEFORE = "(^|[^A-Za-z0-9_])";
const BOUNDARY_AFTER = "([^A-Za-z0-9_]|$)";

export function readShapes(name) {
  return [
    `process\\.env\\.${name}${BOUNDARY_AFTER}`,
    `process\\.env\\[["']${name}["']\\]`,
    `${BOUNDARY_BEFORE}env\\.${name}${BOUNDARY_AFTER}`,
    `\\$\\{?${name}${BOUNDARY_AFTER}`,
    `getenv\\(["']${name}["']\\)`,
    `environment\\[["']${name}["']\\]`,
  ].join("|");
}

/**
 * LIVE probe of the platform's regex engine: every SIGNALGRID_* name the tree reads
 * in the dotted `process.env.X` form, derived rather than hardcoded. The self-test
 * asserts `readersOf` finds each one — which is precisely what macOS could not do
 * while the shapes carried `\b`, and precisely what the old live check missed by
 * naming a single variable whose reader happened to match a boundary-free shape.
 */
export function dottedReaderNames() {
  try {
    const out = git(
      `grep -h -o -E -e ${JSON.stringify("process\\.env\\.SIGNALGRID_[A-Z0-9_]+")} -- ':!*.md' ':!docs/**' ':!scripts/check-env-doc-readers.mjs'`,
    );
    return [...new Set(out.split("\n").filter(Boolean).map((m) => m.trim().replace("process.env.", "")))];
  } catch {
    return [];
  }
}

function readersOf(name) {
  // Tracked files outside the documentation (and outside this gate) that READ the variable.
  try {
    const out = git(`grep -l -E -e ${JSON.stringify(readShapes(name))} -- ':!*.md' ':!docs/**' ':!scripts/check-env-doc-readers.mjs'`);
    return out.split("\n").filter(Boolean).length;
  } catch {
    return 0; // git grep exits 1 on no match
  }
}

/**
 * Pure: what an unreadable tracked document costs the verdict.
 *
 * WHY THIS FUNCTION EXISTS (fixed 2026-09-06). The catch below already said the right
 * thing — "the assignments it holds are unknown, which is not 'none' — surface it as a
 * fatal rather than skipping" — and then substituted `""` and printed a `✗` that set no
 * exit code. `fatal` is built only from assignments FOUND in the text, so an unreadable
 * document produced an empty text, no assignments, no fatal, and the run exited 0 saying
 * "every SIGNALGRID_* variable a document instructs is read by something". Demonstrated
 * through the exported audit: `auditEnvDocReaders({"docs/x.md": ""}, () => 0).fatal` is
 * empty, while the same document readable and instructing a reader-less variable yields
 * one. The comment stated the rule; the code implemented its opposite.
 */
export function unreadableProblems(unreadable) {
  return unreadable.map(
    ({ rel, code }) =>
      `${rel}: tracked but UNREADABLE (${code}) — the SIGNALGRID_* instructions it holds are unknown, ` +
      "which is not the same as none. Fix the file, or remove it from the tree.",
  );
}

function loadDocs() {
  const docs = {};
  const unreadable = [];
  for (const rel of git("ls-files -- '*.md'").split("\n").filter(Boolean)) {
    if (SKIP_PREFIXES.some((p) => rel.startsWith(p))) continue;
    try {
      docs[rel] = readFileSync(join(repoRoot, rel), "utf8");
    } catch (err) {
      // unreadable tracked doc: the assignments it holds are unknown, which is not "none" —
      // surface it as a fatal rather than skipping (see unreadableProblems above)
      unreadable.push({ rel, code: (err && err.code) || "unknown" });
    }
  }
  return { docs, unreadable };
}

function selfTest() {
  const checks = [];
  const table = { SIGNALGRID_TIER: 120, SIGNALGRID_SANITIZE_OUTPUT: 0, SIGNALGRID_MCP_CMD: 0 };
  const readers = (n) => table[n] ?? 0;
  const runbook = "Set these:\n```dotenv\nSIGNALGRID_TIER=prod\nGRAPH_TENANT_ID_PLACEHOLDER=x\n```\n";
  let r = auditEnvDocReaders({ "docs/a.md": runbook }, readers);
  checks.push(["an instructed variable WITH a reader passes (positive control)", r.fatal.length === 0 && r.checked.get("SIGNALGRID_TIER") === 120]);
  checks.push(["a non-SIGNALGRID assignment is out of scope — a third party's variable is the third party's question", !r.checked.has("GRAPH_TENANT_ID_PLACEHOLDER")]);
  r = auditEnvDocReaders({ "docs/a.md": runbook + "- Keep `SIGNALGRID_SANITIZE_OUTPUT=true` for any local output generation.\n" }, readers);
  checks.push(["AN INSTRUCTED VARIABLE NOTHING READS IS FATAL — the planted miss, in the sentence that shipped", r.fatal.length === 1 && r.fatal[0].includes("docs/a.md:6") && r.fatal[0].includes("SIGNALGRID_SANITIZE_OUTPUT")]);
  const shapes = new RegExp(readShapes("SIGNALGRID_X"));
  checks.push(["a reader is a READ SHAPE — process.env.X, env.X, $X, ${X}, getenv(\"X\"), environment[\"X\"] — in any of the tree's languages",
    ["process.env.SIGNALGRID_X", 'process.env["SIGNALGRID_X"]', "const { SIGNALGRID_X } = env; env.SIGNALGRID_X", "echo $SIGNALGRID_X", "${SIGNALGRID_X}", 'os.getenv("SIGNALGRID_X")', 'ProcessInfo.processInfo.environment["SIGNALGRID_X"]']
      .every((s) => shapes.test(s))]);
  checks.push(["…and a bare mention is NOT a reader — a comment naming the variable was counted as three readers of the one it was written to catch",
    !shapes.test("// SIGNALGRID_X was required in two docs") && !shapes.test("SIGNALGRID_X=true") && !shapes.test("process.env.SIGNALGRID_XY")]);
  r = auditEnvDocReaders({ "docs/a.md": "```dotenv\nSIGNALGRID_MCP_CMD_PLACEHOLDER=x\n```\n" }, readers);
  checks.push(["a `_PLACEHOLDER` name is the substitute-here convention, reported not failed", r.fatal.length === 0 && r.placeholders.length === 1]);
  r = auditEnvDocReaders({ "docs/lab.md": "<!-- proposed-env: SIGNALGRID_MCP_CMD -->\n```\nSIGNALGRID_MCP_CMD=\"python -m x\"\n```\n" }, readers);
  checks.push(["a name the SAME document declares proposed is reported, not failed", r.fatal.length === 0 && r.proposals.length === 1]);
  r = auditEnvDocReaders({ "docs/lab.md": "```\nSIGNALGRID_MCP_CMD=\"python -m x\"\n```\n", "docs/other.md": "<!-- proposed-env: SIGNALGRID_MCP_CMD -->" }, readers);
  checks.push(["…and a declaration in a DIFFERENT document does not cover it", r.fatal.length === 1]);
  checks.push(["the assignment shape needs the `=` — a bare mention of a name is not an instruction", assignmentsIn("we call it SIGNALGRID_TIER in prose").names.length === 0]);
  checks.push(["LIVE: the real reader lookup finds SIGNALGRID_TIER and finds nothing for a name that does not exist",
    readersOf("SIGNALGRID_TIER") > 0 && readersOf("SIGNALGRID_NO_SUCH_VARIABLE_ZZ") === 0]);
  // LIVE, AND PLATFORM-SPECIFIC (added 2026-09-09 with the `\b` fix). The check above
  // passed on macOS while the gate was broken there: SIGNALGRID_TIER's reader matches a
  // boundary-free shape, so one green variable hid a lookup that found nothing for every
  // dotted read in the tree. Derive the dotted names and require ALL of them — on Apple
  // git with `\b` in the shapes this fails with the real count, which is the mutation
  // proof; a tree with no dotted read at all is itself a broken derivation, not a pass.
  const dotted = dottedReaderNames();
  const dottedMissed = dotted.filter((n) => readersOf(n) === 0);
  checks.push([
    `LIVE: this platform's regex engine resolves the dotted \`process.env.X\` shape — ${dotted.length} name(s) derived, ${dottedMissed.length} unresolved${dottedMissed.length ? ` (${dottedMissed.join(", ")})` : ""}`,
    dotted.length > 0 && dottedMissed.length === 0,
  ]);
  checks.push(["…and no shape hands `\\b` to git grep -E, which Apple git's POSIX ERE does not implement",
    !readShapes("SIGNALGRID_X").includes("\\b")]);
  // AN UNREADABLE TRACKED DOCUMENT IS FATAL (F7). The pure audit cannot see it — an
  // unreadable file reaches it as `""` — so the rule lives beside it and is asserted
  // here, including the wiring, which is the half that was missing.
  checks.push(["an unreadable tracked document is a PROBLEM, not an empty one",
    unreadableProblems([{ rel: "docs/x.md", code: "EACCES" }]).length === 1]);
  checks.push(["…and no unreadable documents means no problems", unreadableProblems([]).length === 0]);
  checks.push(["the pure audit alone CANNOT see it — which is why the rule is separate",
    auditEnvDocReaders({ "docs/x.md": "" }, readers).fatal.length === 0]);
  checks.push(["LIVE: the verdict is wired to unreadableProblems, not only to the audit's fatal list",
    /const fatal = \[\.\.\.unreadableProblems\(unreadable\), \.\.\.audit\.fatal\]/.test(
      readFileSync(fileURLToPath(import.meta.url), "utf8"),
    )]);

  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) process.exit(selfTest());
  const { docs, unreadable } = loadDocs();
  const audit = auditEnvDocReaders(docs, readersOf);
  const { proposals, placeholders, checked } = audit;
  // An unreadable document is a hole in the scan, so it joins the fatal list rather than
  // being printed beside a passing verdict.
  const fatal = [...unreadableProblems(unreadable), ...audit.fatal];
  console.log(`Env-doc readers — ${Object.keys(docs).length} tracked document(s) scanned for \`SIGNALGRID_*=\` instructions; ${checked.size} distinct variable(s) checked for a reader.`);
  for (const [name, n] of [...checked.entries()].sort()) console.log(`  ${n > 0 ? "✓" : "✗"} ${name.padEnd(40)} ${n} reader file(s)`);
  if (placeholders.length > 0) console.log(`  REPORTED — ${placeholders.length} \`_PLACEHOLDER\` name(s), the substitute-here convention: ${placeholders.join("; ")}`);
  if (proposals.length > 0) console.log(`  REPORTED — ${proposals.length} name(s) declared PROPOSED by their document (no reader exists, and the document says so): ${proposals.join("; ")}`);
  if (fatal.length > 0) {
    console.error(`\nEnv-doc-reader check FAILED: ${fatal.length} problem(s).`);
    for (const f of fatal) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("Env-doc-reader check passed — every SIGNALGRID_* variable a document instructs is read by something, or is declared a placeholder or a proposal.");
}
