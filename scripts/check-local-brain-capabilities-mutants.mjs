#!/usr/bin/env node
// Local-brain capabilities, mutated - the gate that guards the brain's contract is itself guarded.
//
//   node scripts/check-local-brain-capabilities-mutants.mjs              # break the gate, one check at a time; every break must turn red
//   node scripts/check-local-brain-capabilities-mutants.mjs --list      # the mutants, one per line
//   node scripts/check-local-brain-capabilities-mutants.mjs --self-test  # prove this harness can fail, and that it leaves nothing behind
//   node scripts/check-local-brain-capabilities-mutants.mjs --only ID[,ID] [--skip-controls]
//                                                                         # a partial run (prints PARTIAL, never OK); the controls may be skipped only with --only
//
// WHY THIS EXISTS. scripts/check-local-brain-capabilities.mjs plants violations in the CONTRACT and requires each to
// fail. That proves the checks work on the data it plants; it does not prove every check is still there. Deleting a
// check from the gate's source (a bound, a flag rule, the line that exits 1) leaves a self-test that plants nothing
// for it green, and a gate that prints its problems and exits 0 keeps preflight and CI green. The first review of
// that gate broke its code 22 ways and the self-test caught 5; the second broke it 21 more ways, all of which
// survived. So this harness does that on every run: it copies the gate's source with ONE edit (a mutant), runs the
// copy's --self-test and, if that stays green, the copy against the real tree, and requires one of them to go red. A
// mutant that survives is a check nobody tests.
//
//   code mutants   an edit of the gate's source text that removes or weakens one check
//   data mutants   the contract's JSON with a pattern put back to an older, narrower form, or removed, run through the real
//                  gate with --contract-json and --contract-md (the Markdown is re-rendered, so only the pattern differs)
//
// CONTROLS, asserted on every run: the gate's source copied with NO edit passes its own --self-test and the gate and
// prints the same verdict line as the real one (so the plumbing below changes nothing); a copy with a comment appended
// SURVIVES (so a survivor is seen when there is one); every mutant's edit applies to exactly one place in the source;
// the contract's own JSON, rendered, passes through --contract-json.
//
// PLUMBING. A copy lives in a temp directory outside the checkout, so it must be told where the repository is and where
// its one import lives: the `const REPO =` line and the workflow-invocation import are rewritten, each of which must
// match exactly once. Nothing in the checkout is written. The temp directory is removed when the run ends by any road:
// a verdict, a failed control, an error, SIGINT, SIGTERM or SIGHUP (the copies still running are killed first). A
// A finally block does not run past process.exit, so no road here calls it before the directory is gone, and --self-test
// runs the harness three times (a verdict, an unknown mutant id, a SIGTERM) and requires an empty TMPDIR each time.
//
// WHAT IT DOES NOT DO: it does not enumerate every possible edit; a mutant exists only where one was written, so a
// check nobody mutated can still be missing, and the round-3 count is a floor. An equivalent mutant (an edit that
// cannot change any verdict) is listed with its reason and asserted not to fail the run. FAIL-CLOSED: a mutant that
// cannot be applied, a copy that cannot run, an unknown --only id or a spawn that times out fails the run.

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { constants as osConstants, cpus, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(SELF), "..");
const GATE = join(REPO, "scripts/check-local-brain-capabilities.mjs");
const JSON_PATH = join(REPO, "scripts/mac/local-brain/capabilities.json");
const MD_PATH = join(REPO, "scripts/mac/local-brain/CAPABILITIES.md");
const REPO_LINE = 'const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");';
const IMPORT_FROM = 'from "./lib/workflow-invocation.mjs"';
const TIMEOUT_MS = 120_000;
const TEMP_PREFIX = "lbc-mutants-";

/** Pure: src with `from` replaced by `to`, which must occur exactly once. */
export function replaceOnce(src, from, to) {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`the edit anchor occurs ${n} times, not once: ${from.slice(0, 80)}`);
  const out = src.replace(from, () => to);
  if (out === src) throw new Error(`the edit changes nothing: ${from.slice(0, 80)}`);
  return out;
}
/** A code mutant's edit: the anchor text, and what takes its place. */
const edit = (from, to) => (src) => replaceOnce(src, from, to);

/** Pure: the gate's source made runnable from a temp directory (see PLUMBING). */
export function plumb(src) {
  const a = replaceOnce(src, REPO_LINE, `const REPO = ${JSON.stringify(REPO)};`);
  return replaceOnce(a, IMPORT_FROM, `from ${JSON.stringify(pathToFileURL(join(REPO, "scripts/lib/workflow-invocation.mjs")).href)}`);
}

/** The copies still running: a signal kills them before the directory they live in goes. */
const live = new Set();

function run(args) {
  return new Promise((done) => {
    const child = spawn(process.execPath, args, { cwd: REPO, stdio: ["ignore", "pipe", "pipe"] });
    live.add(child);
    let stdout = "", stderr = "", timedOut = false;
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, TIMEOUT_MS);
    child.on("error", (err) => { clearTimeout(timer); live.delete(child); done({ status: null, stdout, stderr: `${stderr}${err.message}`, timedOut }); });
    child.on("close", (status) => { clearTimeout(timer); live.delete(child); done({ status: timedOut ? null : status, stdout, stderr, timedOut }); });
  });
}

/**
 * Runs fn(dir) with a fresh temp directory and removes it when fn returns or throws, and on SIGINT, SIGTERM and SIGHUP
 * (the copies still running are killed first, then the process exits 128 + the signal number). Returns what fn returns.
 */
export async function withTempDir(prefix, fn) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const remove = () => rmSync(dir, { recursive: true, force: true });
  const handlers = ["SIGINT", "SIGTERM", "SIGHUP"].map((sig) => [sig, () => {
    for (const child of live) child.kill("SIGKILL");
    remove();
    process.exit(128 + osConstants.signals[sig]);
  }]);
  for (const [sig, h] of handlers) process.on(sig, h);
  try { return await fn(dir); } finally {
    for (const [sig, h] of handlers) process.off(sig, h);
    remove();
  }
}

/** Runs fn over items, `width` at a time, results in item order. */
async function pool(items, width, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

/**
 * Runs one code mutant. Result: { id, label, verdict: "killed" | "survived" | "error", by, detail }.
 * "killed" means the copy's --self-test, or the copy against the real tree, exited non-zero.
 */
async function runCode(m, dir, src) {
  const file = join(dir, `gate-${m.id}.mjs`);
  try { writeFileSync(file, plumb(m.edit(src))); } catch (err) { return { ...m, verdict: "error", detail: err.message }; }
  const st = await run([file, "--self-test", "--fail-fast"]);
  if (st.timedOut) return { ...m, verdict: "error", detail: "the copy's --self-test timed out" };
  if (st.status !== 0) return { ...m, verdict: "killed", by: "self-test", detail: (st.stdout.split("\n").find((l) => /^\s+- /.test(l)) ?? st.stdout.split("\n")[0] ?? st.stderr.split("\n")[0] ?? "").trim().replace(/^- /, "").slice(0, 150) };
  const gt = await run([file]);
  if (gt.timedOut) return { ...m, verdict: "error", detail: "the copy timed out" };
  if (gt.status !== 0) return { ...m, verdict: "killed", by: "gate", detail: (gt.stderr.split("\n").find((l) => l.includes("[R")) ?? "").trim().slice(0, 140) };
  return { ...m, verdict: "survived", detail: "its --self-test passed and the gate passed on the real tree" };
}

/**
 * Runs one data mutant: the JSON mutated, the Markdown re-rendered, the real gate pointed at both. It must exit 1 and
 * name the rule the mutant is expected to break.
 */
async function runData(m, dir, gate, realJson) {
  const j = JSON.parse(JSON.stringify(realJson));
  try { m.mutate(j); } catch (err) { return { ...m, verdict: "error", detail: err.message }; }
  const jf = join(dir, `${m.id}.json`), mf = join(dir, `${m.id}.md`);
  writeFileSync(jf, `${JSON.stringify(j, null, 2)}\n`);
  writeFileSync(mf, gate.writeBlock(readFileSync(MD_PATH, "utf8"), j));
  const r = await run([GATE, "--contract-json", jf, "--contract-md", mf]);
  if (r.timedOut) return { ...m, verdict: "error", detail: "the gate timed out" };
  const line = r.stderr.split("\n").find((l) => l.includes(`[${m.rule}]`));
  if (r.status === 1 && line) return { ...m, verdict: "killed", by: "gate", detail: line.trim().slice(0, 140) };
  return { ...m, verdict: "survived", detail: `the gate exited ${r.status} without a [${m.rule}] problem` };
}

// ── the mutants ─────────────────────────────────────────────────────────────────────────────────
const q = String.raw;
const off = (id, label, from, to) => ({ id, label, edit: edit(from, to) });

// The counted nouns and number words of the figure rule, as the gate writes them: one mutant drops each.
const FIGURE_NOUNS = ["rows?", "commands?", "patterns?", "entries", "tests?", "primitives?", "gates?", "steps?", "proofs?", "cases?", "rules?", "regex(?:es)?", "days?", "hours?", "minutes?", "violations?", "mutants?", "controls?", "checks?", "forms?", "tiers?"];
const NUMBER_WORDS = ["two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const nounGroup = (list) => `(${list.join("|")})\\b/i;`;
const wordGroup = (list) => `(\\d+|${list.join("|")})(?:\\s+|-)`;
const without = (list, x) => list.filter((y) => y !== x);

/** Code mutants: each removes or weakens one check in the gate's source. */
export const CODE = [
  // R1 schema
  off("R1-json-object", "R1 a contract that is not an object", 'if (!json || typeof json !== "object") return ["[R1-schema] capabilities.json is not an object"];', 'if (false) return ["[R1-schema] capabilities.json is not an object"];'),
  off("R1-scope", "R1 scope is the brain's directory", "if (json.scope !== SCOPE) add(", "if (false) add("),
  off("R1-contract", "R1 contract is CAPABILITIES.md", "if (json.contract !== MD_PATH) add(", "if (false) add("),
  off("R1-gate", "R1 gate is this file", "if (json.gate !== GATE_PATH) add(", "if (false) add("),
  off("R1-commands-array", "R1 commands is an array", "if (!Array.isArray(json.commands)) { add(", "if (false) { add("),
  off("R1-policy-used", "R1 every policy is used by a row", "for (const p of POLICIES) if (!json.commands.some((c) => c?.policy === p)) add(", "for (const p of POLICIES) if (false) add("),
  off("R1-row-object", "R1 a row is an object", 'if (!c || typeof c !== "object") { add("R1-schema", "a row is not an object"); continue; }', 'if (false) { add("R1-schema", "a row is not an object"); continue; }'),
  off("R1-newline", "R1 no newline in a text field", q`c[k].includes("\n")) add("R1-schema",`, q`false) add("R1-schema",`),
  off("R1-kebab", "R1 names are kebab-case", q`!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.name)`, "false"),
  off("R1-duplicate", "R1 names are unique", "if (names.has(c.name)) add(", "if (false) add("),
  off("R1-policy", "R1 policy is a known one", "if (!POLICIES.includes(c.policy)) add(", "if (false) add("),
  off("R1-kind-known", "R1 kind is a known one", "if (!KINDS.includes(c.kind)) add(", "if (false) add("),
  off("R1-backtick", "R1 no backtick in a command", 'c[k].includes("`")) add(', "false) add("),
  off("R1-measured", "R1 measuredAt is a commit and a date", "if (!/^[0-9a-f]{40}$/.test(json.measuredAt?.commit ?? \"\")", "if (false && !/^[0-9a-f]{40}$/.test(json.measuredAt?.commit ?? \"\")"),
  off("R1-kind", "R1 kind pattern goes with policy forbidden", 'if ((c.kind === "pattern") !== (c.policy === "forbidden")) add(', "if (false) add("),
  off("R1-text-all", "R1 command and does are non-empty text", 'for (const k of ["command", "does"]) if (typeof c[k] !== "string" || !c[k].trim()) add(', 'for (const k of ["command", "does"]) if (false) add('),
  off("R1-text-command", "R1 command is non-empty text", 'for (const k of ["command", "does"]) if (typeof c[k]', 'for (const k of ["does"]) if (typeof c[k]'),
  off("R1-text-does", "R1 does is non-empty text", 'for (const k of ["command", "does"]) if (typeof c[k]', 'for (const k of ["command"]) if (typeof c[k]'),
  off("R1-note", "R1 note is a string", 'if (typeof c.note !== "string") add(', "if (false) add("),
  off("R1-bool", "R1 flags are booleans", 'for (const b of BOOLS) if (typeof c[b] !== "boolean") add(', "for (const b of BOOLS) if (false) add("),
  off("R1-source-all", "R1 source is a non-empty array of strings", 'if (!Array.isArray(c.source) || c.source.length === 0 || !c.source.every((s) => typeof s === "string")) add(', "if (false) add("),
  off("R1-source-array", "R1 source is an array", "if (!Array.isArray(c.source) || c.source.length === 0 ||", "if (c.source.length === 0 ||"),
  off("R1-source-empty", "R1 source is not empty", "|| c.source.length === 0 || !c.source.every(", "|| !c.source.every("),
  off("R1-source-strings", "R1 every source is a string", '|| !c.source.every((s) => typeof s === "string")) add(', ") add("),
  off("R1-anchors", "R1 anchors is an object", "if (!anchorsOk) add(", "if (false) add("),
  off("R1-anchor-key", "R1 an anchors key is a citation", 'if (!pc || pc.lo === null) add("R1-schema", `anchors[', 'if (false) add("R1-schema", `anchors['),
  off("R1-anchor-short", "R1 an anchor is 12 or more characters", "t.trim().length >= 12 && t.length <= 200 && !t", "true && t.length <= 200 && !t"),
  off("R1-anchor-long", "R1 an anchor is at most 200 characters", "t.length <= 200 && !t.includes(", "true && !t.includes("),
  off("R1-anchor-newline", "R1 an anchor is one line", '&& !t.includes("\\n");', ";"),
  off("R1-anchor-text", "R1 an anchor is text", 'typeof t === "string" &&', "true &&"),
  off("R1-anchor-single", "R1 a single-line citation has a text anchor", "else if (pc.lo === pc.hi) { if (!oneLine(v))", "else if (pc.lo === pc.hi) { if (false)"),
  off("R1-anchor-null", "R1 a range anchor is not null", "else if (v === null || Object.keys(v)", "else if (Object.keys(v)"),
  off("R1-anchor-keys", "R1 a range anchor is exactly { first, last }", '.join(",") !== "first,last" ||', "&& false ||"),
  off("R1-anchor-first", "R1 a range anchor's first is a text", "|| !oneLine(v.first) ||", "|| false ||"),
  off("R1-anchor-last", "R1 a range anchor's last is a text", "|| !oneLine(v.last)) {", "|| false) {"),
  // R2 exists
  off("R2-exists-object", "R2 exists is an object or null", 'if (typeof e !== "object") add(', "if (false) add("),
  off("R2-script", "R2 exists.packageScript is a package.json script", "e.packageScript !== undefined && !has(m.pkg, e.packageScript)) add(", "false) add("),
  off("R2-prefix", "R2 exists.packageScriptPrefix matches a script", "if (e.packageScriptPrefix !== undefined && !Object.keys(m.pkg).some(", "if (false && !Object.keys(m.pkg).some("),
  off("R2-file", "R2 exists.file is tracked", "if (e.file !== undefined && !m.tracked.has(e.file)) add(", "if (false) add("),
  off("R2-runs-file", "R2 the package script runs exists.file", "&& !String(m.pkg[e.packageScript]).includes(e.file)) add(", "&& false) add("),
  off("R2-export", "R2 the file exports exists.export", "if (t === null || !re.test(t)) add(", "if (false) add("),
  off("R2-export-regex", "R2 exists.export is exported, not just named", "const re = new RegExp(`export\\\\s+(?:async\\\\s+)?(?:function|class|const|let)\\\\s+${e.export}\\\\b|export\\\\s*\\\\{[^}]*\\\\b${e.export}\\\\b`);", "const re = new RegExp(`\\\\b${e.export}\\\\b`);"),
  off("R2-note", "R2 a command row that runs something unchecked needs a note", 'else if (c.kind === "command" && !(progs.length > 0 && progs.every((x) => x.known)) &&', 'else if (false && !(progs.length > 0 && progs.every((x) => x.known)) &&'),
  off("R2-note-nothing", "R2 a command row that runs nothing needs a note", "!(progs.length > 0 && progs.every((x) => x.known))", "!progs.every((x) => x.known)"),
  off("R2-own-property", "R2 a prototype key is not a package script", "&& Object.hasOwn(o, k);", "&& (k in o);"),
  off("R2-text-pnpm", "R2 the command text of a pnpm row is checked", "        if (t?.script !== undefined) {\n          if (ex.packageScript", "        if (false) {\n          if (ex.packageScript"),
  off("R2-text-script", "R2 the pnpm script equals exists.packageScript", "ex.packageScript !== undefined ? ex.packageScript !== t.script :", "ex.packageScript !== undefined ? false :"),
  off("R2-text-prefix", "R2 a glob command starts with exists.packageScriptPrefix", "|| !t.script.startsWith(ex.packageScriptPrefix)", "|| false"),
  off("R2-text-file", "R2 the file a node, bash or sh command runs equals exists.file", "} else if (t?.file !== undefined && ex.file !== t.file) {", "} else if (false) {"),
  off("R2-text-import", "R2 an import or workflow row's command contains exists.file", "else if (!c.command.includes(ex.file)) add(", "else if (false) add("),
  off("R2-import-file", "R2 an import or workflow row names exists.file", 'if (ex.file === undefined) add("R2-exists", `${id}: an ${c.kind} row must name', 'if (false) add("R2-exists", `${id}: an ${c.kind} row must name'),
  off("R2-workflow-file", "R2 a workflow row, not only an import row, names exists.file", '} else if (c.kind === "import" || c.kind === "workflow") {', '} else if (c.kind === "import") {'),
  off("R2-target-pnpm", "R2 commandTarget reads pnpm run", "let m = PNPM_RUN_RE.exec(c);", "let m = null;"),
  off("R2-target-dot", "R2 commandTarget reads ./script", "m = DOT_SLASH_RE.exec(c);", "m = null;"),
  off("R2-target-runner", "R2 commandTarget reads node, bash and sh", "m = RUNNER_RE.exec(c);", "m = null;"),
  off("R2-first-target", "R2 the first program on the line is the one exists names", "const t = targets[0];", "const t = targets[targets.length - 1];"),
  off("R2-extra-file", "R2 a further file on the line is tracked", "} else if (!m.tracked.has(x.file)) add(", "} else if (false) add("),
  off("R2-extra-script", "R2 a further pnpm script on the line exists", "if (!found) add(", "if (false) add("),
  off("R2-extra-glob", "R2 a further pnpm glob on the line matches a script", ": Object.keys(m.pkg).some((k) => k.startsWith(x.script.slice(0, star)));", ": true;"),
  off("R2-further", "R2 every further program is read", "for (const x of targets.slice(1)) {", "for (const x of targets.slice(2)) {"),
  off("R2-unresolved", "R2 a file from an unknown directory is a problem", "if (x.unresolved !== undefined) add(", "if (false) add("),
  off("R2-unknown", "R2 a program the gate cannot check is a problem", "else if (x.other !== undefined && !x.known &&", "else if (false && !x.known &&"),
  off("R2-unknown-exempt", "R2 only a row with exists null and a note may run an unchecked program", "!((e === null || e === undefined) && (c.note ?? \"\").trim())) add(", "!(true)) add("),
  off("R2-known", "R2 only a short list of system programs is known", "known: KNOWN_PROGRAMS.includes(first) }", "known: true }"),
  off("R2-runner-words", "R2 a package runner is named with its second word", "other: RUNNERS.includes(first) ? words.slice(0, 2).join(\" \") : first,", "other: first,"),
  off("R2-split-and", "R2 a && chain is split", 'if ((ch === "&" && next === "&") || (ch === "|" && next === "|")) {', 'if (false || (ch === "|" && next === "|")) {'),
  off("R2-split-or", "R2 a || chain is split", 'if ((ch === "&" && next === "&") || (ch === "|" && next === "|")) {', 'if ((ch === "&" && next === "&") || false) {'),
  off("R2-split-semi", "R2 a ; chain is split", 'if (ch === ";" || ch === "(" || ch === ")") { push(); continue; }', 'if (ch === "(" || ch === ")") { push(); continue; }'),
  off("R2-split-open", "R2 a subshell is opened", 'if (ch === ";" || ch === "(" || ch === ")") { push(); continue; }', 'if (ch === ";" || ch === ")") { push(); continue; }'),
  off("R2-split-close", "R2 a subshell is closed", 'if (ch === ";" || ch === "(" || ch === ")") { push(); continue; }', 'if (ch === ";" || ch === "(") { push(); continue; }'),
  off("R2-split-pipe", "R2 a pipe is split", 'if (ch === "|" && (/\\s/.test(prev) || /\\s/.test(next))) { push(); continue; }', "if (false) { push(); continue; }"),
  off("R2-split-placeholder", "R2 a | with no space beside it is a placeholder, not a pipe", 'if (ch === "|" && (/\\s/.test(prev) || /\\s/.test(next))) { push(); continue; }', 'if (ch === "|") { push(); continue; }'),
  off("R2-split-amp", "R2 a background & is split", 'if (ch === "&" && /\\s/.test(prev) && /\\s/.test(next)) { push(); continue; }', "if (false) { push(); continue; }"),
  off("R2-comment", "R2 a # comment is dropped", 'if (ch === "#" && /\\s/.test(prev)) break;', "if (false) break;"),
  off("R2-quotes", "R2 a quoted string is not split", `if (ch === "'" || ch === '"') { q = ch; cur += ch; continue; }`, "if (false) { q = ch; cur += ch; continue; }"),
  off("R2-escape", "R2 an escaped quote does not end a string", 'if (ch === "\\\\" && q === \'"\' && i + 1 < s.length)', "if (false)"),
  off("R2-escape-single", "R2 a backslash escapes only inside double quotes", 'if (ch === "\\\\" && q === \'"\' && i + 1 < s.length)', 'if (ch === "\\\\" && i + 1 < s.length)'),
  off("R2-cd", "R2 a cd moves the directory later paths are read from", "if (cd) { cwd = resolveIn(cwd, cd[1]); continue; }", "if (false) { cwd = resolveIn(cwd, cd[1]); continue; }"),
  off("R2-resolve-null", "R2 a path from an unknown directory is unresolved", "if (cwd === null || /^[\\/~$\"']/.test(p)) return null;", "if (/^[\\/~$\"']/.test(p)) return null;"),
  off("R2-resolve-absolute", "R2 an absolute path is unresolved", "if (cwd === null || /^[\\/~$\"']/.test(p)) return null;", "if (cwd === null) return null;"),
  off("R2-resolve-escape", "R2 a path that leaves the repository is unresolved", 'return r === ".." || r.startsWith("../") || r.startsWith("/") ? null :', "return false ? null :"),
  // R3 self-test registered
  off("R3-workflow", "R3 a workflow run: line registers a self-test", "&& !m.wfCommands.includes(c.selfTest.trim())", "&& true"),
  off("R3-steps", "R3 a preflight or breadth step registers a self-test", "else if (!m.steps.includes(c.selfTest.trim()) &&", "else if (false &&"),
  off("R3-quoted", "R3 a self-test is unquoted", '|| /["\']/.test(c.selfTest)) add(', "|| false) add("),
  off("R3-type", "R3 a self-test is text", 'if (typeof c.selfTest !== "string" || !c.selfTest.trim() || /["\']/.test(c.selfTest)) add(', 'if (/["\']/.test(String(c.selfTest))) add('),
  // R4 sources and anchors
  off("R4-bound", "R4 a cited range ends inside the file", "pc.hi > lines.length)", "pc.hi > lines.length + 1)"),
  off("R4-zero", "R4 a cited line is 1 or more", "pc.lo < 1 ||", "false ||"),
  off("R4-backwards", "R4 a cited range does not run backwards", "pc.hi < pc.lo ||", "false ||"),
  off("R4-last-line", "R4 a final newline does not start another line", 'if (l.length && l[l.length - 1] === "") l.pop();', ";"),
  off("R4-untracked-source", "R4 a source path is tracked", "if (!m.tracked.has(pc.path)) { add(\"R4-source\", `${id}: source path", "if (false) { add(\"R4-source\", `${id}: source path"),
  off("R4-untracked-cite", "R4 a cited path is tracked", "if (!m.tracked.has(pc.path)) { add(\"R4-source\", `${where}: ${s} cites", "if (false) { add(\"R4-source\", `${where}: ${s} cites"),
  off("R4-unreadable", "R4 a cited file that cannot be read is named", "if (text === null) { add(\"R4-source\", `${where}: ${pc.path} cannot be read`); continue; }", "if (text === null) { continue; }"),
  off("R4-anchor-required", "R4 a line citation has an anchor", "if (!anchorsOk || !has(anchors, s)) {", "if (false) {"),
  off("R4-pin-window", "R4 an anchor is on its cited line, not merely inside the range", "if (!hits.includes(ln)) add(", "if (!hits.some((h) => h >= pc.lo && h <= pc.hi)) add("),
  off("R4-pin-tolerance", "R4 an anchor is on its cited line, not within one line of it", "if (!hits.includes(ln)) add(", "if (!hits.some((h) => Math.abs(h - ln) <= 1)) add("),
  off("R4-pin-nothing", "R4 an anchor is checked against its line", "if (!hits.includes(ln)) add(", "if (false) add("),
  off("R4-pin-last", "R4 a range's last line is pinned", ': [["first-line anchor", a?.first, pc.lo], ["last-line anchor", a?.last, pc.hi]];', ': [["first-line anchor", a?.first, pc.lo]];'),
  off("R4-pin-first", "R4 a range's first line is pinned", ': [["first-line anchor", a?.first, pc.lo], ["last-line anchor", a?.last, pc.hi]];', ': [["last-line anchor", a?.last, pc.hi]];'),
  off("R4-pin-single", "R4 a single line is pinned", 'pc.lo === pc.hi ? [["anchor", a, pc.lo]] :', "pc.lo === pc.hi ? [] :"),
  off("R4-unique", "R4 an anchor names one line", "else if (hits.length > 1) add(", "else if (false) add("),
  off("R4-orphan", "R4 an anchor nobody cites is a problem", "if (anchorsOk) for (const k of Object.keys(anchors).sort()) if (!cites.has(k)) add(", "if (false) for (const k of Object.keys(anchors).sort()) if (!cites.has(k)) add("),
  off("R4-prose", "R4 the prose's citations are checked", "for (const t of citeText.matchAll(CITE_RE)) noteCite(", "for (const t of []) noteCite("),
  // R5 flags
  off("R5-cloud", "R5 cloudModelNeeded exactly when cloud-model", 'if (c.cloudModelNeeded !== (c.policy === "cloud-model")) add(', "if (false) add("),
  off("R5-allowed", "R5 an allowed row is read-only", 'if (c.policy === "allowed" && !(c.readOnly === true', "if (false && !(c.readOnly === true"),
  off("R5-own-worktree", "R5 an own-worktree row writes nothing remote", 'c.policy === "own-worktree-host-lock") && c.networkWrites) add(', 'c.policy === "own-worktree-host-lock") && false) add('),
  off("R5-owner-grant", "R5 an owner-grant row writes to the network", 'if (c.policy === "owner-grant" && c.networkWrites !== true) add(', "if (false) add("),
  off("R5-implies", "R5 networkWrites implies needsNetwork", "if (c.networkWrites && !c.needsNetwork) add(", "if (false) add("),
  off("R5-exclusive", "R5 readOnly and writesTree exclude each other", "if (c.readOnly && c.writesTree) add(", "if (false) add("),
  off("R5-patterns", "R5 only forbidden rows carry patterns", 'if ("commandPatterns" in c || "pathPatterns" in c || "controls" in c) add(', "if (false) add("),
  // R6 forbidden patterns and their controls
  off("R6-arrays", "R6 the pattern lists are arrays", "if (!Array.isArray(lists.command) || !Array.isArray(lists.path)) {", "if (false) {"),
  off("R6-some", "R6 a forbidden row has a pattern", "if (lists.command.length + lists.path.length === 0) add(", "if (false) add("),
  off("R6-orphan-controls", "R6 controls need patterns", "if (srcs.length === 0) { if (ctl !== undefined) add(", "if (srcs.length === 0) { if (false) add("),
  off("R6-controls", "R6 a row with patterns has both control lists", "if (!ctl || !okList(ctl.mustMatch) || !okList(ctl.mustNotMatch)) {", "if (false) {"),
  off("R6-controls-strings", "R6 every control is text", '&& a.every((s) => typeof s === "string");', ";"),
  off("R6-must-match", "R6 every mustMatch control matches", "for (const s of ctl.mustMatch) if (!res.some((r) => r.test(s))) add(", "for (const s of ctl.mustMatch) if (false) add("),
  off("R6-must-not-match", "R6 no mustNotMatch control matches", "for (const s of ctl.mustNotMatch) if (res.some((r) => r.test(s))) add(", "for (const s of ctl.mustNotMatch) if (false) add("),
  off("R6-exercised", "R6 every pattern is exercised by a control", "for (const r of res) if (!ctl.mustMatch.some((s) => r.test(s))) add(", "for (const r of res) if (false) add("),
  off("R6-collect", "R6 forbidden command patterns reach the cross-check", 'if (target === "command") for (const r of res) forbiddenCmd.push([c.name, r]);', 'if (target === "command") for (const r of []) forbiddenCmd.push([c.name, r]);'),
  // R7 cross-check, in every policy that is not forbidden
  off("R7-self-test", "R7 a self-test is cross-checked too", "for (const s of [c.command, c.selfTest]) {", "for (const s of [c.command]) {"),
  ...["allowed", "own-worktree", "own-worktree-host-lock", "owner-grant", "cloud-model"].map((pol) =>
    off(`R7-${pol}`, `R7 a ${pol} row is cross-checked`, 'if (!c || c.policy === "forbidden") continue;', `if (!c || c.policy === "forbidden" || c.policy === "${pol}") continue;`)),
  // R8 markdown
  off("R8-markdown-read", "R8 a Markdown file that cannot be read is named", 'if (typeof m.md !== "string") add("R8-markdown", `${MD_PATH} cannot be read`);', 'if (false) add("R8-markdown", `${MD_PATH} cannot be read`);'),
  off("R8-trailing", "R8 the block is compared byte for byte", "m.md.slice(span[0], span[1]) !== rendered", 'm.md.slice(span[0], span[1]).replace(/[ \\t]+$/gm, "") !== rendered.replace(/[ \\t]+$/gm, "")'),
  off("R8-bom", "R8 no byte-order mark", "if (m.md.charCodeAt(0) === 0xfeff) add(", "if (false) add("),
  off("R8-missing", "R8 the markers are present", "if (a < 0 || b < 0) return", "if (false) return"),
  off("R8-twice", "R8 the markers appear once", "if (md.indexOf(BEGIN, a + 1) >= 0 || md.indexOf(END, b + 1) >= 0) return", "if (false) return"),
  off("R8-order", "R8 the markers are in order", "if (b < a) return", "if (false) return"),
  // R9 figures: every text a table shows, in every policy
  off("R9-row-text", "R9 a row's text is scanned", 'const t = typeof c[k] === "string" ? c[k] : "";', 'const t = "";'),
  ...["command", "does", "note", "selfTest"].map((field) =>
    off(`R9-field-${field}`, `R9 the ${field} of a row is scanned`, 'for (const k of ["command", "does", "note", "selfTest"]) {', `for (const k of ${JSON.stringify(["command", "does", "note", "selfTest"].filter((x) => x !== field))}) {`)),
  off("R9-forbidden-command", "R9 the command text of a forbidden row is scanned", 'for (const k of ["command", "does", "note", "selfTest"]) {', 'for (const k of c.policy === "forbidden" ? ["does", "note"] : ["command", "does", "note", "selfTest"]) {'),
  off("R9-prose", "R9 the prose outside the block is scanned", "const hit = line.match(FIGURE_RE) ?? line.match(RATIO_RE);", "const hit = null;"),
  off("R9-ratio", "R9 a pass ratio is a figure", "export const RATIO_RE = /\\b\\d+\\s*\\/\\s*\\d+\\b/;", "export const RATIO_RE = /\\bNEVER-MATCHES\\b/;"),
  off("R9-citation-digits", "R9 a digit run inside a line citation is not a figure", q`(?<![:\-\d.])\b(`, q`\b(`),
  off("R9-singular", "R9 a singular noun is counted", q`(rows?|commands?|patterns?|entries|tests?|primitives?|gates?|steps?|proofs?|cases?|rules?|regex(?:es)?|days?|hours?|minutes?|violations?|mutants?|controls?|checks?|forms?|tiers?)\b/i;`, q`(rows|commands|patterns|entries|tests|primitives|gates|steps|proofs|cases|rules|regexes|days|hours|minutes|violations|mutants|controls|checks|forms|tiers)\b/i;`),
  ...FIGURE_NOUNS.map((noun) => off(`R9-noun-${noun.replace(/[^a-z]/g, "")}`, `R9 "${noun}" is a counted noun`, nounGroup(FIGURE_NOUNS), nounGroup(without(FIGURE_NOUNS, noun)))),
  ...NUMBER_WORDS.map((word) => off(`R9-word-${word}`, `R9 "${word}" is a number word`, wordGroup(NUMBER_WORDS), wordGroup(without(NUMBER_WORDS, word)))),
  // R10 ceilings
  off("R10-header", "R10 the gate's header carries the ceilings", 'if (typeof m.selfSource !== "string" ||', "if (false &&"),
  off("R10-contract", "R10 the contract carries the ceilings", 'if (typeof m.md !== "string" || !m.md.includes(ceiling)) add(', "if (false) add("),
  off("R10-backlog-read", "R10 a backlog that cannot be read is named", 'if (typeof m.backlog !== "string") add("R10-ceilings", `${BACKLOG_PATH} cannot be read`);', 'if (false) add("R10-ceilings", `${BACKLOG_PATH} cannot be read`);'),
  off("R10-backlog", "R10 the backlog row carries the ceilings", "else if (!m.backlog.includes(ceiling)) add(", "else if (false) add("),
  // loading and the verdict
  off("L-unreadable", "L an unreadable file is a problem, not a throw", 'return { text: null, error: String(err?.message ?? err).split("\\n")[0] };', "throw err;"),
  off("L-json-error", "L an unreadable JSON is named", "if (j.error) problems.push(", "if (false) problems.push("),
  off("L-json-missing", "L an absent JSON is named", "else if (j.text === null) problems.push(", "else if (false) problems.push("),
  off("L-md-error", "L an unreadable Markdown is named", "if (md.error) problems.push(", "if (false) problems.push("),
  off("L-package-error", "L an unreadable package.json is named", "if (pk.error) problems.push(", "if (false) problems.push("),
  off("L-workflow", "L a workflow file that cannot be read is named", "if (wf.error || wf.text === null) problems.push(", "if (false) problems.push("),
  off("L-backlog-error", "L an unreadable backlog is named", "if (backlog.error) problems.push(", "if (false) problems.push("),
  off("X-json-flag", "X --contract-json is honoured", 'const jsonFile = flag("--contract-json");', "const jsonFile = null;"),
  off("X-problem-exit", "X a contract with a problem exits 1", "when no cloud model can check them.`);\n    process.exit(1);", "when no cloud model can check them.`);\n    process.exit(0);"),
  off("X-ok-exit", "X a clean contract exits 0", "matches ${JSON_PATH}.`);\n  process.exit(0);", "matches ${JSON_PATH}.`);\n  process.exit(1);"),
];

/** Mutants that cannot change a verdict on a good tree; each is asserted not to fail the run, whether it survives or is killed. */
export const EQUIVALENT = [
  { ...off("E-package-parse", "L a package.json that does not parse is swallowed", 'catch { problems.push("[R2-exists] package.json does not parse"); }', "catch { }"), why: "the package scripts then read as empty and every row that names one is red through R2 instead" },
  { ...off("E-ls-files", "L a failed git ls-files is swallowed", 'catch { problems.push("[R2-exists] git ls-files failed; refusing to report files as present or absent"); }', "catch { }"), why: "the tracked set then reads as empty and the gate is red through its listed-nothing problem instead" },
  { ...off("E-list-exit", "L a --list-steps runner that exits non-zero is believed", "if (r.status !== 0) { problems.push(", "if (false) { problems.push("), why: "a failed runner prints no step list, so the gate is red through its unusable-step-list problem instead" },
  { ...off("E-self-error", "L a gate source that cannot be read is swallowed", "if (self.error) problems.push(", "if (false) problems.push("), why: "the header text then reads as null and R10 is red through its header check instead" },
];

const row = (j, n) => { const c = j.commands.find((x) => x.name === n); if (!c) throw new Error(`no row ${n}`); return c; };
/** The one pattern of a row whose source contains `part`; the mutation is an error unless exactly one does. */
const patternWith = (list, part) => {
  const hits = list.filter((s) => s.includes(part));
  if (hits.length !== 1) throw new Error(`${hits.length} patterns hold ${part}, not one`);
  return hits[0];
};
/** A data mutant: the pattern of a row that holds `part` is put back to its older form(s) (or removed when `then` is empty). */
const revert = (id, label, rowName, part, then, target = "commandPatterns") => ({
  id, label, rule: "R6-forbidden",
  mutate: (j) => {
    const list = row(j, rowName)[target];
    const now = patternWith(list, part);
    list.splice(list.indexOf(now), 1, ...then);
  },
});

/** Data mutants: the widening of each forbidden pattern, undone. The controls added with it must then go red. */
export const DATA = [
  // merge
  revert("D-merge-push", "merge: a push to SignalGrid_Alpha under any git global option", "merge", q`push\b[^\n]*\bSignalGrid_Alpha\b`, [q`\bgit\s+push\b[^\n]*\bSignalGrid_Alpha\b`]),
  revert("D-merge-tool", "merge: the merge tool by its qualified name", "merge", "merge_pull_request", [q`\bmerge_pull_request\b`]),
  revert("D-merge-auto", "merge: the auto-merge tool by its qualified name", "merge", "enable_pr_auto_merge", [q`\benable_pr_auto_merge\b`]),
  revert("D-merge-pulls", "merge: a merge endpoint whose number is a variable", "merge", "/pulls/", [q`/pulls/\d+/merge\b`]),
  revert("D-merge-api", "merge: the repository merges endpoint", "merge", "/merges", []),
  revert("D-merge-graphql", "merge: the GraphQL merge and auto-merge mutations", "merge", "enablePullRequestAutoMerge", []),
  revert("D-merge-ref", "merge: an API update of the mainline ref", "merge", "git/refs/heads/SignalGrid_Alpha", []),
  revert("D-merge-files", "merge: a file-writing tool aimed at the mainline branch", "merge", "push_files", []),
  // close
  revert("D-close-state", "close: state=closed in any spelling", "close", "state", [q`(-f|-F|--field|--raw-field)\s+state=closed\b`, q`"state"\s*:\s*"closed"`]),
  revert("D-close-graphql", "close: the GraphQL close mutations", "close", "closePullRequest", []),
  // delete
  revert("D-delete-push", "delete: a branch deletion or prune under any git global option", "delete", q`push\b[^\n]*(\s--delete`, [q`\bgit\s+push\b[^\n]*(\s--delete\b|\s-d\b|\s:[\w./-]+)`]),
  revert("D-delete-branch", "delete: git branch -d in a flag cluster, under any git global option", "delete", q`branch\b[^\n]*\s(--delete`, [q`\bgit\s+branch\b[^\n]*\s(-D|-d|--delete)\b`]),
  revert("D-delete-update-ref", "delete: git update-ref -d", "delete", "update-ref", []),
  revert("D-delete-clean", "delete: branches:clean without run", "delete", "branches:clean", [q`\bpnpm\s+run\s+branches:clean\b`]),
  revert("D-delete-cleanup-apply", "delete: cleanup-merged-branches.sh --apply", "delete", "cleanup-merged-branches", []),
  revert("D-delete-rm", "delete: moving or shredding files under artifacts/raised-hands or lane-messages", "delete", q`\b(rm|unlink|mv|shred)`, [q`\b(rm|git\s+rm|unlink)\b[^\n]*artifacts/(raised-hands|lane-messages)\b`]),
  revert("D-delete-find", "delete: find with -delete under those directories", "delete", q`\bfind\b`, []),
  revert("D-delete-api", "delete: gh api DELETE in every spelling", "delete", q`\bgh\s+api\b`, [q`\bgh\s+api\b[^\n]*-X\s+DELETE\b`]),
  revert("D-delete-subcommand", "delete: gh <noun> delete and remove", "delete", q`\bgh\s+[a-z-]+\s+(?:delete|remove)`, []),
  revert("D-delete-graphql", "delete: a GraphQL delete mutation", "delete", q`\bdelete[A-Z]`, []),
  revert("D-delete-file-tool", "delete: a delete_file tool", "delete", q`delete_file\b`, []),
  revert("D-delete-curl", "delete: curl -X DELETE", "delete", q`\bcurl\b`, []),
  // force-push
  revert("D-force-push", "force-push: --force-if-includes, --mirror, a cluster with f, a +refspec with a colon, under any git global option", "force-push", q`push\b[^\n]*(\s--force`, [q`\bgit\s+push\b[^\n]*(\s--force(-with-lease)?\b|\s-f\b|\s\+[\w./-]+)`]),
  revert("D-force-rebase", "force-push: git rebase under any git global option", "force-push", q`rebase\b`, [q`\bgit\s+rebase\b`]),
  revert("D-force-reset", "force-push: git reset --hard under any git global option", "force-push", q`reset\b`, [q`\bgit\s+reset\s+--hard\b`]),
  revert("D-force-filter", "force-push: git filter-branch and filter-repo under any git global option", "force-push", "filter-", [q`\bgit\s+filter-(branch|repo)\b`]),
  revert("D-force-pull", "force-push: git pull --rebase under any git global option", "force-push", q`pull\b`, [q`\bgit\s+pull\b[^\n]*\s(--rebase|-r)\b`]),
  // bypass
  revert("D-bypass-stash", "bypass: git stash under any git global option", "bypass", q`stash\b`, [q`\bgit\s+stash\b`]),
  revert("D-bypass-n", "bypass: git commit -n under any git global option", "bypass", q`commit\b`, [q`\bgit\s+commit\b[^\n]*\s-[A-Za-z]*n[A-Za-z]*(?=\s|$)`]),
  // send-outside
  revert("D-send-json", "send-outside: curl --json", "send-outside", q`\bcurl\b[^\n]*\s(-d`, [q`\bcurl\b[^\n]*\s(-d|--data(-binary|-raw|-urlencode)?|-F|--form|-T|--upload-file)\b`]),
  revert("D-send-curl-post", "send-outside: curl -X POST", "send-outside", "(POST|PUT|PATCH", []),
  revert("D-send-wget", "send-outside: wget --post-file", "send-outside", q`\bwget\b`, []),
  revert("D-send-gh-comment", "send-outside: gh pr comment, gh pr review, gh issue create and comment", "send-outside", q`\bgh\s+(?:pr\s+(?:comment|review)`, []),
  revert("D-send-gist", "send-outside: gh gist create", "send-outside", q`\bgh\s+gist\s+create`, []),
  revert("D-send-gh-api", "send-outside: gh api with fields to a comments or issues endpoint", "send-outside", q`\bgh\s+api\b`, []),
  revert("D-send-post-tools", "send-outside: the GitHub tools that post comments and issues", "send-outside", "add_issue_comment", []),
  revert("D-send-scp", "send-outside: scp, sftp, nc and socat", "send-outside", "scp|sftp", []),
  revert("D-send-rsync", "send-outside: rsync to a host", "send-outside", q`\brsync\b`, []),
  revert("D-send-mail", "send-outside: a mail program", "send-outside", "sendmail", []),
  revert("D-send-mail-tools", "send-outside: the send_message and create_draft tools", "send-outside", "send_message", []),
  revert("D-send-chat", "send-outside: chat.postMessage and a Slack hook", "send-outside", "chat", []),
  // run-another-units-job
  revert("D-units-write-deliver", "run-another-units-job: objective-loop --deliver", "run-another-units-job", "objective-loop", [q`\bobjective-loop\.mjs\b[^\n]*--write\b`]),
  revert("D-units-sync", "run-another-units-job: pnpm sync without run", "run-another-units-job", q`pnpm\s+(?:run\s+)?sync`, [q`\bpnpm\s+run\s+sync(?![\w:-])`]),
  revert("D-units-build-tick", "run-another-units-job: build-tick with --dry-run later on the line", "run-another-units-job", q`scripts/mac/build-tick\.sh`, [q`\bscripts/mac/build-tick\.sh\b(?![^\n]*--dry-run)`]),
  revert("D-units-sim", "run-another-units-job: sim:run-requests with --plan later on the line", "run-another-units-job", q`sim:run-requests`, [q`\bsim:run-requests\b(?![^\n]*--plan)`]),
  revert("D-units-run-requests", "run-another-units-job: run-requests.mjs with --plan later on the line", "run-another-units-job", q`run-requests\.mjs`, [q`\bscripts/mac/run-requests\.mjs\b(?![^\n]*(--plan|--self-test))`]),
  revert("D-units-install", "run-another-units-job: an installer with --status later on the line", "run-another-units-job", "install-", [q`\binstall-(launchd|build-tick)\.sh\b(?![^\n]*--status)`]),
  revert("D-units-launchctl", "run-another-units-job: launchctl subcommands that start or stop a job", "run-another-units-job", "launchctl", []),
  {
    id: "D-judge-paths", label: "own-contract: the judge of the brain's own work is protected with the gate", rule: "R6-forbidden",
    mutate: (j) => {
      const r = row(j, "own-contract");
      r.pathPatterns = [q`^scripts/mac/local-brain/(CAPABILITIES\.md|capabilities\.json)$`, q`^scripts/check-local-brain-capabilities\.mjs$`];
    },
  },
];

// ── judging and running ─────────────────────────────────────────────────────────────────────────
/**
 * Pure: the verdict over a list of results. Every result of a real mutant must be "killed"; an "error" (the edit did not
 * apply, the copy did not run) is never a pass; a documented equivalent mutant (`equivalent: true`) may survive or be killed.
 */
export function judge(results) {
  const lines = [];
  let bad = 0, killed = 0, code = 0, data = 0, equivalent = 0;
  for (const r of results) {
    const tag = r.verdict === "killed" ? "KILLED  " : r.verdict === "survived" ? (r.equivalent ? "EQUIVALENT" : "SURVIVED") : "ERROR   ";
    lines.push(`${tag.padEnd(10)} ${r.id.padEnd(22)} ${r.label}${r.by ? `  [${r.by}]` : ""}  -- ${r.verdict !== "killed" && r.equivalent && r.why ? r.why : r.detail}`);
    if (r.equivalent) { equivalent += r.verdict === "survived" ? 1 : 0; if (r.verdict === "error") bad += 1; if (r.verdict === "killed") killed += 1; continue; }
    if (r.verdict === "killed") { killed += 1; if (r.rule) data += 1; else code += 1; } else bad += 1;
  }
  const real = results.filter((r) => !r.equivalent).length;
  const killedReal = results.filter((r) => !r.equivalent && r.verdict === "killed").length;
  return { ok: bad === 0, lines, summary: `mutants: ${killedReal}/${real} killed (${code} code, ${data} data); ${equivalent} documented equivalent survived`, bad };
}

async function controls(src, dir, gate, realJson) {
  const problems = [];
  const real = await run([GATE]);
  const same = join(dir, "gate-control.mjs");
  writeFileSync(same, plumb(src));
  const [st, gt] = [await run([same, "--self-test", "--fail-fast"]), await run([same])];
  if (st.status !== 0) problems.push(`control: the unmutated copy's --self-test exited ${st.status}: ${st.stdout.split("\n")[0]}`);
  if (gt.status !== 0) problems.push(`control: the unmutated copy exited ${gt.status}: ${gt.stderr.split("\n").find((l) => l.includes("[R")) ?? gt.stderr.split("\n")[0]}`);
  if (real.status !== 0) problems.push(`control: the real gate exited ${real.status}: ${real.stderr.split("\n").find((l) => l.includes("[R")) ?? real.stderr.split("\n")[0]}`);
  if (st.status === 0 && gt.status === 0 && real.status === 0 && gt.stdout !== real.stdout) problems.push("control: the unmutated copy prints a different verdict than the real gate (the plumbing changed something)");
  const noop = await runCode({ id: "C-noop", label: "a comment appended", edit: (s) => `${s}\n// a comment changes no behaviour\n` }, dir, src);
  if (noop.verdict !== "survived") problems.push(`control: a mutant that changes nothing must survive, and was ${noop.verdict}: ${noop.detail}`);
  const dataControl = await runData({ id: "C-data", label: "no change", rule: "R6-forbidden", mutate: () => {} }, dir, gate, realJson);
  if (dataControl.verdict !== "survived") problems.push(`control: the contract's own JSON, re-rendered, must pass through --contract-json; got ${dataControl.verdict}: ${dataControl.detail}`);
  return problems;
}

/** The exit code of a run. It never calls process.exit: the temp directory is removed by withTempDir before anything exits. */
async function mainRun({ only, skipControls }) {
  const src = readFileSync(GATE, "utf8");
  const realJson = JSON.parse(readFileSync(JSON_PATH, "utf8"));
  const gate = await import(pathToFileURL(GATE).href);
  const tasks = [
    ...CODE.map((m) => ({ kind: "code", m })),
    ...EQUIVALENT.map((m) => ({ kind: "code", m: { ...m, equivalent: true } })),
    ...DATA.map((m) => ({ kind: "data", m })),
  ];
  let chosen = tasks;
  if (only !== null) {
    const unknown = only.filter((id) => !tasks.some((t) => t.m.id === id));
    if (unknown.length) { console.error(`x local-brain capabilities mutants: no mutant named ${unknown.join(", ")}`); return 2; }
    chosen = tasks.filter((t) => only.includes(t.m.id));
  }
  return withTempDir(TEMP_PREFIX, async (dir) => {
    if (!skipControls) {
      const problems = await controls(src, dir, gate, realJson);
      if (problems.length) { console.error(`x local-brain capabilities mutants: ${problems.length} control problem(s)\n`); for (const p of problems) console.error(`    ${p}`); return 1; }
    }
    const width = Math.max(1, Math.min(4, cpus().length));
    const results = await pool(chosen, width, ({ kind, m }) => (kind === "code" ? runCode(m, dir, src) : runData(m, dir, gate, realJson)));
    const j = judge(results);
    console.log(j.lines.join("\n"));
    if (!j.ok) { console.error(`\nx local-brain capabilities mutants: ${j.bad} mutant(s) survived or could not run; each is a check no test notices is missing`); return 1; }
    if (only !== null) { console.log(`\nPARTIAL ${j.summary} (--only ${only.join(",")}${skipControls ? ", controls skipped" : ""}); this is not the verdict of a full run`); return 0; }
    console.log(`\nOK ${j.summary}; the unmutated copy, a no-op mutant and the re-rendered contract behaved as controls`);
    return 0;
  });
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const leftovers = (root) => readdirSync(root).filter((n) => n.startsWith(TEMP_PREFIX));

async function selfTest() {
  const failures = [];
  const expectThrow = (fn, label) => { try { fn(); failures.push(`${label} should throw`); } catch { /* the point */ } };
  expectThrow(() => replaceOnce("a b c", "z", "y"), "an edit anchor that occurs nowhere");
  expectThrow(() => replaceOnce("a a", "a", "b"), "an edit anchor that occurs twice");
  expectThrow(() => replaceOnce("a b", "a", "a"), "an edit that changes nothing");
  expectThrow(() => plumb("no repo line here"), "a source with no REPO line");
  const plumbed = plumb(`${REPO_LINE}\nimport x ${IMPORT_FROM};`);
  if (!plumbed.includes(JSON.stringify(REPO)) || plumbed.includes(REPO_LINE)) failures.push("plumb must point REPO at this repository");
  const k = { id: "k", label: "killed", verdict: "killed", rule: null }, s = { id: "s", label: "survived", verdict: "survived", detail: "x" }, e = { id: "e", label: "error", verdict: "error", detail: "x" };
  if (!judge([k]).ok) failures.push("a list of killed mutants must pass");
  if (judge([k, s]).ok) failures.push("a surviving mutant must fail the run");
  if (judge([k, e]).ok) failures.push("a mutant that could not run must fail the run");
  if (!judge([k, { ...s, equivalent: true }]).ok) failures.push("a documented equivalent mutant that survives must not fail the run");
  if (judge([{ ...e, equivalent: true }]).ok) failures.push("a documented equivalent mutant that cannot run must fail the run");
  const src = readFileSync(GATE, "utf8");
  const realJson = JSON.parse(readFileSync(JSON_PATH, "utf8"));
  const gate = await import(pathToFileURL(GATE).href);
  await withTempDir("lbc-mutants-selftest-", async (dir) => {
    const killer = CODE.find((m) => m.id === "X-problem-exit");
    const survivor = { id: "S-noop", label: "a comment appended", edit: (t) => `${t}\n// a comment changes no behaviour\n` };
    const missing = { id: "S-missing", label: "an anchor that is not there", edit: edit("this text is in no gate", "x") };
    const dataKiller = DATA.find((m) => m.id === "D-judge-paths");
    const noPattern = { id: "S-no-pattern", label: "a pattern that is not there", rule: "R6-forbidden", mutate: (j) => revert("x", "x", "merge", "this text is in no pattern", []).mutate(j) };
    const [rk, rs, rm, rd, rn] = await Promise.all([runCode(killer, dir, src), runCode(survivor, dir, src), runCode(missing, dir, src), runData(dataKiller, dir, gate, realJson), runData(noPattern, dir, gate, realJson)]);
    if (rk.verdict !== "killed") failures.push(`the exit-code mutant must be killed, was ${rk.verdict}: ${rk.detail}`);
    if (rs.verdict !== "survived") failures.push(`a mutant that changes nothing must survive, was ${rs.verdict}: ${rs.detail}`);
    if (rm.verdict !== "error") failures.push(`a mutant whose anchor is absent must be an error, was ${rm.verdict}`);
    if (rd.verdict !== "killed") failures.push(`the judge-paths data mutant must be killed, was ${rd.verdict}: ${rd.detail}`);
    if (rn.verdict !== "error") failures.push(`a data mutant whose pattern is absent must be an error, was ${rn.verdict}`);
    if (judge([rk, rs]).ok) failures.push("a run that includes a survivor must fail");
  });
  const ids = [...CODE, ...EQUIVALENT, ...DATA].map((m) => m.id);
  if (new Set(ids).size !== ids.length) failures.push("mutant ids must be unique");

  // Nothing is left behind: three runs of this harness, each with a private TMPDIR that must be empty afterwards.
  const priv = mkdtempSync(join(tmpdir(), "lbc-leakcheck-"));
  try {
    const env = { ...process.env, TMPDIR: priv };
    const done = spawnSync(process.execPath, [SELF, "--only", "X-problem-exit", "--skip-controls"], { env, encoding: "utf8", timeout: TIMEOUT_MS });
    if (done.status !== 0 || !done.stdout.includes("PARTIAL mutants: 1/1 killed")) failures.push(`a partial run of one mutant must exit 0 and say PARTIAL (exit ${done.status}: ${done.stdout.split("\n").find((l) => l.includes("mutants")) ?? done.stderr.split("\n")[0]})`);
    if (leftovers(priv).length) failures.push(`a finished run left ${leftovers(priv).join(", ")} behind`);
    const unknown = spawnSync(process.execPath, [SELF, "--only", "NO-SUCH-MUTANT"], { env, encoding: "utf8", timeout: TIMEOUT_MS });
    if (unknown.status !== 2 || !unknown.stderr.includes("no mutant named NO-SUCH-MUTANT")) failures.push(`an unknown mutant id must exit 2 and name it (exit ${unknown.status}: ${unknown.stderr.split("\n")[0]})`);
    if (leftovers(priv).length) failures.push(`a run that stopped on an unknown id left ${leftovers(priv).join(", ")} behind`);
    const child = spawn(process.execPath, [SELF], { env, stdio: "ignore" });
    const ended = new Promise((resolveEnd) => { child.on("close", (code, signal) => resolveEnd({ code, signal })); });
    for (let wait = 0; wait < 800 && leftovers(priv).length === 0; wait += 1) await sleep(25);
    child.kill("SIGTERM");
    const r = await ended;
    if (r.code !== 128 + osConstants.signals.SIGTERM) failures.push(`a run asked to stop with SIGTERM must exit ${128 + osConstants.signals.SIGTERM} (was ${r.code ?? r.signal})`);
    if (leftovers(priv).length) failures.push(`a run stopped by SIGTERM left ${leftovers(priv).join(", ")} behind`);
  } finally { rmSync(priv, { recursive: true, force: true }); }

  if (failures.length) {
    console.log("FAIL  local-brain capabilities mutants self-test:");
    for (const f of failures) console.log(`      - ${f}`);
    return 1;
  }
  console.log(`PASS  local-brain capabilities mutants self-test - a code mutant was killed, a no-op mutant survived, an absent anchor and an absent pattern were errors, a data mutant was killed, the verdict failed on a survivor, an error and an equivalent that cannot run, and a finished run, an unknown id and a SIGTERM each left no temp directory behind`);
  return 0;
}

function parseArgs(argv) {
  const get = (name) => { const i = argv.indexOf(name); return i < 0 ? null : (argv[i + 1] ?? ""); };
  const onlyRaw = get("--only");
  const only = onlyRaw === null ? null : onlyRaw.split(",").map((x) => x.trim()).filter(Boolean);
  return { only, skipControls: argv.includes("--skip-controls") };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) return selfTest();
  if (argv.includes("--list")) {
    for (const m of CODE) console.log(`code  ${m.id}  ${m.label}`);
    for (const m of EQUIVALENT) console.log(`equiv ${m.id}  ${m.label}`);
    for (const m of DATA) console.log(`data  ${m.id}  ${m.label}`);
    return 0;
  }
  const { only, skipControls } = parseArgs(argv);
  if (skipControls && only === null) { console.error("x --skip-controls is allowed only with --only: a full run always runs its controls"); return 2; }
  if (only !== null && only.length === 0) { console.error("x --only needs one or more mutant ids"); return 2; }
  return mainRun({ only, skipControls });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code; }, (err) => { console.error(err); process.exitCode = 1; });
}
