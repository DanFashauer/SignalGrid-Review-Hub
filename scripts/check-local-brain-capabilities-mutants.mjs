#!/usr/bin/env node
// Local-brain capabilities, mutated - the gate that guards the brain's contract is itself guarded.
//
//   node scripts/check-local-brain-capabilities-mutants.mjs              # break the gate, one check at a time; every break must turn red
//   node scripts/check-local-brain-capabilities-mutants.mjs --list      # the mutants, one per line
//   node scripts/check-local-brain-capabilities-mutants.mjs --self-test  # prove this harness can fail
//
// WHY THIS EXISTS. scripts/check-local-brain-capabilities.mjs plants violations in the CONTRACT and requires each to
// fail. That proves the checks work on the data it plants; it does not prove every check is still there. Deleting a
// check from the gate's source (a bound, a flag rule, the line that exits 1) leaves a self-test that plants nothing
// for it green, and a gate that prints its problems and exits 0 keeps preflight and CI green. The first review of
// that gate broke its code 22 ways and the self-test caught 5. So this harness does that on every run: it copies the
// gate's source with ONE edit (a mutant), runs the copy's --self-test and, if that stays green, the copy against the
// real tree, and requires one of them to go red. A mutant that survives is a check nobody tests.
//
//   code mutants   an edit of the gate's source text that removes or weakens one check
//   data mutants   the contract's JSON with a round-2 pattern put back to its older, narrower form, run through the real
//                  gate with --contract-json and --contract-md (the Markdown is re-rendered, so only the pattern differs)
//
// CONTROLS, asserted on every run: the gate's source copied with NO edit passes its own --self-test and the gate and
// prints the same verdict line as the real one (so the plumbing below changes nothing); a copy with a comment appended
// SURVIVES (so a survivor is seen when there is one); every mutant's edit applies to exactly one place in the source;
// the contract's own JSON, rendered, passes through --contract-json.
//
// PLUMBING. A copy lives in a temp directory outside the checkout, so it must be told where the repository is and where
// its one import lives: the `const REPO =` line and the workflow-invocation import are rewritten, each of which must
// match exactly once. Nothing in the checkout is written.
//
// WHAT IT DOES NOT DO: it does not enumerate every possible edit; a mutant exists only where one was written, and an
// equivalent mutant (an edit that cannot change any verdict) is listed with its reason and asserted to survive.
// FAIL-CLOSED: a mutant that cannot be applied, a copy that cannot run, or a spawn that times out fails the run.

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GATE = join(REPO, "scripts/check-local-brain-capabilities.mjs");
const JSON_PATH = join(REPO, "scripts/mac/local-brain/capabilities.json");
const MD_PATH = join(REPO, "scripts/mac/local-brain/CAPABILITIES.md");
const REPO_LINE = 'const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");';
const IMPORT_FROM = 'from "./lib/workflow-invocation.mjs"';
const TIMEOUT_MS = 120_000;

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

function run(args) {
  return new Promise((done) => {
    const child = spawn(process.execPath, args, { cwd: REPO, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", timedOut = false;
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, TIMEOUT_MS);
    child.on("error", (err) => { clearTimeout(timer); done({ status: null, stdout, stderr: `${stderr}${err.message}`, timedOut }); });
    child.on("close", (status) => { clearTimeout(timer); done({ status: timedOut ? null : status, stdout, stderr, timedOut }); });
  });
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
  const st = await run([file, "--self-test"]);
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

/** Code mutants: each removes or weakens one check in the gate's source. */
export const CODE = [
  // R1 schema
  off("R1-newline", "R1 no newline in a text field", q`c[k].includes("\n")) add("R1-schema",`, q`false) add("R1-schema",`),
  off("R1-kebab", "R1 names are kebab-case", q`!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.name)`, "false"),
  off("R1-duplicate", "R1 names are unique", "if (names.has(c.name)) add(", "if (false) add("),
  off("R1-policy", "R1 policy is a known one", "if (!POLICIES.includes(c.policy)) add(", "if (false) add("),
  off("R1-backtick", "R1 no backtick in a command", 'c[k].includes("`")) add(', "false) add("),
  off("R1-measured", "R1 measuredAt is a commit and a date", "if (!/^[0-9a-f]{40}$/.test(json.measuredAt?.commit ?? \"\")", "if (false && !/^[0-9a-f]{40}$/.test(json.measuredAt?.commit ?? \"\")"),
  off("R1-kind", "R1 kind pattern goes with policy forbidden", 'if ((c.kind === "pattern") !== (c.policy === "forbidden")) add(', "if (false) add("),
  off("R1-bool", "R1 flags are booleans", 'for (const b of BOOLS) if (typeof c[b] !== "boolean") add(', "for (const b of BOOLS) if (false) add("),
  off("R1-anchors", "R1 anchors is an object", "if (!anchorsOk) add(", "if (false) add("),
  off("R1-anchor-text", "R1 an anchor is 12 or more characters", "v.trim().length < 12 ||", "false ||"),
  // R2 exists
  off("R2-script", "R2 exists.packageScript is a package.json script", "e.packageScript !== undefined && !has(m.pkg, e.packageScript)) add(", "false) add("),
  off("R2-prefix", "R2 exists.packageScriptPrefix matches a script", "if (e.packageScriptPrefix !== undefined && !Object.keys(m.pkg).some(", "if (false && !Object.keys(m.pkg).some("),
  off("R2-file", "R2 exists.file is tracked", "if (e.file !== undefined && !m.tracked.has(e.file)) add(", "if (false) add("),
  off("R2-runs-file", "R2 the package script runs exists.file", "&& !String(m.pkg[e.packageScript]).includes(e.file)) add(", "&& false) add("),
  off("R2-export", "R2 the file exports exists.export", "if (t === null || !re.test(t)) add(", "if (false) add("),
  off("R2-note", "R2 a command row with exists null needs a note", 'else if (c.kind === "command" && !/^git\\s/.test(', 'else if (false && !/^git\\s/.test('),
  off("R2-own-property", "R2 a prototype key is not a package script", "&& Object.hasOwn(o, k);", "&& (k in o);"),
  off("R2-text-pnpm", "R2 the command text of a pnpm row is checked", "if (t?.script !== undefined) {", "if (false) {"),
  off("R2-text-script", "R2 the pnpm script equals exists.packageScript", "ex.packageScript !== undefined ? ex.packageScript !== t.script :", "ex.packageScript !== undefined ? false :"),
  off("R2-text-prefix", "R2 a glob command starts with exists.packageScriptPrefix", "|| !t.script.startsWith(ex.packageScriptPrefix)", "|| false"),
  off("R2-text-file", "R2 the file a node, bash or sh command runs equals exists.file", "} else if (t?.file !== undefined && ex.file !== t.file) {", "} else if (false) {"),
  off("R2-text-import", "R2 an import or workflow row's command contains exists.file", "&& ex.file !== undefined && !c.command.includes(ex.file)) {", "&& false) {"),
  off("R2-target-pnpm", "R2 commandTarget reads pnpm run", "let m = PNPM_RUN_RE.exec(c);", "let m = null;"),
  off("R2-target-dot", "R2 commandTarget reads ./script", "m = DOT_SLASH_RE.exec(c);", "m = null;"),
  off("R2-target-runner", "R2 commandTarget reads node, bash and sh", "m = RUNNER_RE.exec(c);", "m = null;"),
  // R3 self-test registered
  off("R3-workflow", "R3 a workflow run: line registers a self-test", "&& !m.wfCommands.includes(c.selfTest.trim())", "&& true"),
  off("R3-steps", "R3 a preflight or breadth step registers a self-test", "else if (!m.steps.includes(c.selfTest.trim()) &&", "else if (false &&"),
  off("R3-quoted", "R3 a self-test is unquoted", '|| /["\']/.test(c.selfTest)) add(', "|| false) add("),
  // R4 sources and anchors
  off("R4-bound", "R4 a cited range ends inside the file", "pc.hi > lines.length)", "pc.hi > lines.length + 1)"),
  off("R4-zero", "R4 a cited line is 1 or more", "pc.lo < 1 ||", "false ||"),
  off("R4-backwards", "R4 a cited range does not run backwards", "pc.hi < pc.lo ||", "false ||"),
  off("R4-last-line", "R4 a final newline does not start another line", 'if (l.length && l[l.length - 1] === "") l.pop();', ";"),
  off("R4-untracked-source", "R4 a source path is tracked", "if (!m.tracked.has(pc.path)) { add(\"R4-source\", `${id}: source path", "if (false) { add(\"R4-source\", `${id}: source path"),
  off("R4-untracked-cite", "R4 a cited path is tracked", "if (!m.tracked.has(pc.path)) { add(\"R4-source\", `${where}: ${s} cites", "if (false) { add(\"R4-source\", `${where}: ${s} cites"),
  off("R4-anchor-required", "R4 a line citation has an anchor", "if (!anchorsOk || !has(anchors, s)) {", "if (false) {"),
  off("R4-anchor-inside", "R4 the anchor is inside the cited lines", '!lines.slice(pc.lo - 1, pc.hi).join("\\n").includes(a)', "false"),
  off("R4-orphan", "R4 an anchor nobody cites is a problem", "if (anchorsOk) for (const k of Object.keys(anchors).sort()) if (!cites.has(k)) add(", "if (false) for (const k of Object.keys(anchors).sort()) if (!cites.has(k)) add("),
  off("R4-prose", "R4 the prose's citations are checked", "for (const t of outsideText.matchAll(CITE_RE)) noteCite(", "for (const t of []) noteCite("),
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
  off("R6-must-match", "R6 every mustMatch control matches", "for (const s of ctl.mustMatch) if (!res.some((r) => r.test(s))) add(", "for (const s of ctl.mustMatch) if (false) add("),
  off("R6-must-not-match", "R6 no mustNotMatch control matches", "for (const s of ctl.mustNotMatch) if (res.some((r) => r.test(s))) add(", "for (const s of ctl.mustNotMatch) if (false) add("),
  off("R6-exercised", "R6 every pattern is exercised by a control", "for (const r of res) if (!ctl.mustMatch.some((s) => r.test(s))) add(", "for (const r of res) if (false) add("),
  off("R6-collect", "R6 forbidden command patterns reach the cross-check", 'if (target === "command") for (const r of res) forbiddenCmd.push([c.name, r]);', 'if (target === "command") for (const r of []) forbiddenCmd.push([c.name, r]);'),
  // R7 cross-check
  off("R7-self-test", "R7 a self-test is cross-checked too", "for (const s of [c.command, c.selfTest]) {", "for (const s of [c.command]) {"),
  off("R7-owner-grant", "R7 an owner-grant row is cross-checked", 'if (!c || c.policy === "forbidden") continue;', 'if (!c || c.policy === "forbidden" || c.policy === "owner-grant") continue;'),
  // R8 markdown
  off("R8-trailing", "R8 the block is compared byte for byte", "m.md.slice(span[0], span[1]) !== rendered", 'm.md.slice(span[0], span[1]).replace(/[ \\t]+$/gm, "") !== rendered.replace(/[ \\t]+$/gm, "")'),
  off("R8-bom", "R8 no byte-order mark", "if (m.md.charCodeAt(0) === 0xfeff) add(", "if (false) add("),
  off("R8-missing", "R8 the markers are present", "if (a < 0 || b < 0) return", "if (false) return"),
  off("R8-twice", "R8 the markers appear once", "if (md.indexOf(BEGIN, a + 1) >= 0 || md.indexOf(END, b + 1) >= 0) return", "if (false) return"),
  off("R8-order", "R8 the markers are in order", "if (b < a) return", "if (false) return"),
  // R9 figures
  off("R9-row-text", "R9 a row's does and note are scanned", 'const t = typeof c[k] === "string" ? c[k] : "";', 'const t = "";'),
  off("R9-prose", "R9 the prose outside the block is scanned", "const hit = line.match(FIGURE_RE) ?? line.match(RATIO_RE);", "const hit = null;"),
  off("R9-ratio", "R9 a pass ratio is a figure", "export const RATIO_RE = /\\b\\d+\\s*\\/\\s*\\d+\\b/;", "export const RATIO_RE = /\\bNEVER-MATCHES\\b/;"),
  off("R9-noun-rules", "R9 rules are counted nouns", "|cases?|rules?|regex", "|cases?|regex"),
  off("R9-noun-minutes", "R9 minutes are counted nouns", "|hours?|minutes?)", "|hours?)"),
  off("R9-citation-digits", "R9 a digit run inside a line citation is not a figure", q`(?<![:\-\d.])\b(`, q`\b(`),
  // R10 ceilings
  off("R10-header", "R10 the gate's header carries the ceilings", 'if (typeof m.selfSource !== "string" ||', "if (false &&"),
  off("R10-contract", "R10 the contract carries the ceilings", 'if (typeof m.md !== "string" || !m.md.includes(ceiling)) add(', "if (false) add("),
  off("R10-backlog", "R10 the backlog row carries the ceilings", "else if (!m.backlog.includes(ceiling)) add(", "else if (false) add("),
  // loading and the verdict
  off("L-unreadable", "L an unreadable file is a problem, not a throw", 'return { text: null, error: String(err?.message ?? err).split("\\n")[0] };', "throw err;"),
  off("L-json-error", "L an unreadable JSON is named", "if (j.error) problems.push(", "if (false) problems.push("),
  off("L-md-error", "L an unreadable Markdown is named", "if (md.error) problems.push(", "if (false) problems.push("),
  off("X-json-flag", "X --contract-json is honoured", 'const jsonFile = flag("--contract-json");', "const jsonFile = null;"),
  off("X-problem-exit", "X a contract with a problem exits 1", "when no cloud model can check them.`);\n    process.exit(1);", "when no cloud model can check them.`);\n    process.exit(0);"),
  off("X-ok-exit", "X a clean contract exits 0", "matches ${JSON_PATH}.`);\n  process.exit(0);", "matches ${JSON_PATH}.`);\n  process.exit(1);"),
];

/** Mutants that cannot change a verdict on a good tree; each is asserted to survive so the claim stays tested. */
export const EQUIVALENT = [
  { ...off("E-package-parse", "L a package.json that does not parse is swallowed", 'catch { problems.push("[R2-exists] package.json does not parse"); }', "catch { }"), why: "the package scripts then read as empty and every row that names one is red through R2 instead" },
  { ...off("E-ls-files", "L a failed git ls-files is swallowed", 'catch { problems.push("[R2-exists] git ls-files failed; refusing to report files as present or absent"); }', "catch { }"), why: "the tracked set then reads as empty and the gate is red through its listed-nothing problem instead" },
  { ...off("E-list-exit", "L a --list-steps runner that exits non-zero is believed", "if (r.status !== 0) { problems.push(", "if (false) { problems.push("), why: "a failed runner prints no step list, so the gate is red through its unusable-step-list problem instead" },
];

const row = (j, n) => { const c = j.commands.find((x) => x.name === n); if (!c) throw new Error(`no row ${n}`); return c; };
/** A data mutant: the named pattern of a forbidden row put back to its older form (or removed). */
const revert = (id, label, rowName, target, now, then) => ({
  id, label, rule: "R6-forbidden",
  mutate: (j) => {
    const list = row(j, rowName)[target];
    const i = list.indexOf(now);
    if (i < 0) throw new Error(`${rowName} has no pattern ${now}`);
    list.splice(i, 1, ...then);
  },
});

/** Data mutants: the round-2 widening of each forbidden pattern, undone. The controls added with it must then go red. */
export const DATA = [
  revert("D-merge-push", "merge: a push to SignalGrid_Alpha in any argument order", "merge", "commandPatterns",
    q`\bgit\s+push\b[^\n]*\bSignalGrid_Alpha\b`,
    [q`\bgit\s+push\b[^\n]*\s(HEAD|[\w./-]+):(refs/heads/)?SignalGrid_Alpha\b`, q`\bgit\s+push\s+origin\s+SignalGrid_Alpha\b`]),
  revert("D-merge-api", "merge: the repository merges endpoint", "merge", "commandPatterns", q`\brepos/[^\s/]+/[^\s/]+/merges\b`, []),
  revert("D-merge-graphql", "merge: the GraphQL merge and auto-merge mutations", "merge", "commandPatterns", q`\b(enablePullRequestAutoMerge|mergePullRequest)\b`, []),
  revert("D-approve-json", "approve: a quoted event key", "approve", "commandPatterns", q`\bevent["']?\s*[=:]\s*["']?APPROVE\b`, [q`\bevent\s*[=:]\s*["']?APPROVE\b`]),
  revert("D-close-flag", "close: state=CLOSED in any case", "close", "commandPatterns", q`(-f|-F|--field|--raw-field)\s+state=(closed|CLOSED)\b`, [q`(-f|-F|--field|--raw-field)\s+state=closed\b`]),
  revert("D-close-json", "close: a JSON state of CLOSED", "close", "commandPatterns", q`"state"\s*:\s*"(closed|CLOSED)"`, [q`"state"\s*:\s*"closed"`]),
  revert("D-close-graphql", "close: the GraphQL close mutations", "close", "commandPatterns", q`\b(closePullRequest|closeIssue)\b`, []),
  revert("D-delete-rm", "delete: a removal of artifacts/raised-hands or lane-messages with no trailing slash", "delete", "commandPatterns",
    q`\b(rm|git\s+rm|unlink)\b[^\n]*artifacts/(raised-hands|lane-messages)\b`, [q`\b(rm|git\s+rm|unlink)\b[^\n]*artifacts/(raised-hands|lane-messages)/`]),
  revert("D-delete-find", "delete: find with -delete under those directories", "delete", "commandPatterns", q`\bfind\b[^\n]*artifacts/(raised-hands|lane-messages)\b[^\n]*-delete\b`, []),
  revert("D-delete-api", "delete: gh api DELETE in every spelling", "delete", "commandPatterns",
    q`\bgh\s+api\b[^\n]*(-X\s*|--method[\s=]+)(DELETE|delete)\b`, [q`\bgh\s+api\b[^\n]*-X\s+DELETE\b`]),
  revert("D-delete-curl", "delete: curl -X DELETE", "delete", "commandPatterns", q`\bcurl\b[^\n]*(-X\s*|--request[\s=]+)(DELETE|delete)\b`, []),
  revert("D-force-pull", "force-push: git pull --rebase", "force-push", "commandPatterns", q`\bgit\s+pull\b[^\n]*\s(--rebase|-r)\b`, []),
  revert("D-force-config", "force-push: git -c ... rebase", "force-push", "commandPatterns", q`\bgit\s+(-c\s+\S+\s+)+rebase\b`, []),
  revert("D-bypass-n", "bypass: git commit -n", "bypass", "commandPatterns", q`\bgit\s+commit\b[^\n]*\s-[A-Za-z]*n[A-Za-z]*(?=\s|$)`, []),
  revert("D-send-json", "send-outside: curl --json", "send-outside", "commandPatterns",
    q`\bcurl\b[^\n]*\s(-d|--data(-ascii|-binary|-raw|-urlencode)?|--json|-F|--form|-T|--upload-file)\b`,
    [q`\bcurl\b[^\n]*\s(-d|--data(-binary|-raw|-urlencode)?|-F|--form|-T|--upload-file)\b`]),
  revert("D-send-wget", "send-outside: wget --post-file", "send-outside", "commandPatterns", q`\bwget\b[^\n]*\s--(post-file|post-data|body-file|body-data)\b`, []),
  revert("D-units-build-tick", "run-another-units-job: build-tick with --dry-run later on the line", "run-another-units-job", "commandPatterns",
    q`\bscripts/mac/build-tick\.sh\b(?!(\s+--)?\s+--dry-run\b)`, [q`\bscripts/mac/build-tick\.sh\b(?![^\n]*--dry-run)`]),
  revert("D-units-sim", "run-another-units-job: sim:run-requests with --plan later on the line", "run-another-units-job", "commandPatterns",
    q`\bsim:run-requests\b(?!(\s+--)?\s+--plan\b)`, [q`\bsim:run-requests\b(?![^\n]*--plan)`]),
  revert("D-units-run-requests", "run-another-units-job: run-requests.mjs with --plan later on the line", "run-another-units-job", "commandPatterns",
    q`\bscripts/mac/run-requests\.mjs\b(?!(\s+--)?\s+(--plan|--self-test)\b)`, [q`\bscripts/mac/run-requests\.mjs\b(?![^\n]*(--plan|--self-test))`]),
  revert("D-units-install", "run-another-units-job: an installer with --status later on the line", "run-another-units-job", "commandPatterns",
    q`\binstall-(launchd|build-tick)\.sh\b(?!(\s+--)?\s+--status\b)`, [q`\binstall-(launchd|build-tick)\.sh\b(?![^\n]*--status)`]),
  revert("D-units-launchctl", "run-another-units-job: launchctl subcommands that start or stop a job", "run-another-units-job", "commandPatterns",
    q`\blaunchctl\s+(kickstart|start|stop|load|unload|bootstrap|bootout|remove|enable|disable|submit)\b`, []),
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
  const [st, gt] = [await run([same, "--self-test"]), await run([same])];
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

async function mainRun() {
  const src = readFileSync(GATE, "utf8");
  const realJson = JSON.parse(readFileSync(JSON_PATH, "utf8"));
  const gate = await import(pathToFileURL(GATE).href);
  const dir = mkdtempSync(join(tmpdir(), "lbc-mutants-"));
  try {
    const problems = await controls(src, dir, gate, realJson);
    if (problems.length) { console.error(`x local-brain capabilities mutants: ${problems.length} control problem(s)\n`); for (const p of problems) console.error(`    ${p}`); process.exit(1); }
    const width = Math.max(1, Math.min(4, cpus().length));
    const tasks = [
      ...CODE.map((m) => ({ kind: "code", m })),
      ...EQUIVALENT.map((m) => ({ kind: "code", m: { ...m, equivalent: true } })),
      ...DATA.map((m) => ({ kind: "data", m })),
    ];
    const results = await pool(tasks, width, ({ kind, m }) => (kind === "code" ? runCode(m, dir, src) : runData(m, dir, gate, realJson)));
    const j = judge(results);
    console.log(j.lines.join("\n"));
    if (!j.ok) { console.error(`\nx local-brain capabilities mutants: ${j.bad} mutant(s) survived or could not run; each is a check no test notices is missing`); process.exit(1); }
    console.log(`\nOK ${j.summary}; the unmutated copy, a no-op mutant and the re-rendered contract behaved as controls`);
    process.exit(0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

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
  const dir = mkdtempSync(join(tmpdir(), "lbc-mutants-selftest-"));
  try {
    const killer = CODE.find((m) => m.id === "X-problem-exit");
    const survivor = { id: "S-noop", label: "a comment appended", edit: (t) => `${t}\n// a comment changes no behaviour\n` };
    const missing = { id: "S-missing", label: "an anchor that is not there", edit: edit("this text is in no gate", "x") };
    const dataKiller = DATA.find((m) => m.id === "D-judge-paths");
    const [rk, rs, rm, rd] = await Promise.all([runCode(killer, dir, src), runCode(survivor, dir, src), runCode(missing, dir, src), runData(dataKiller, dir, gate, realJson)]);
    if (rk.verdict !== "killed") failures.push(`the exit-code mutant must be killed, was ${rk.verdict}: ${rk.detail}`);
    if (rs.verdict !== "survived") failures.push(`a mutant that changes nothing must survive, was ${rs.verdict}: ${rs.detail}`);
    if (rm.verdict !== "error") failures.push(`a mutant whose anchor is absent must be an error, was ${rm.verdict}`);
    if (rd.verdict !== "killed") failures.push(`the judge-paths data mutant must be killed, was ${rd.verdict}: ${rd.detail}`);
    if (judge([rk, rs]).ok) failures.push("a run that includes a survivor must fail");
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const ids = [...CODE, ...EQUIVALENT, ...DATA].map((m) => m.id);
  if (new Set(ids).size !== ids.length) failures.push("mutant ids must be unique");
  if (failures.length) {
    console.log("FAIL  local-brain capabilities mutants self-test:");
    for (const f of failures) console.log(`      - ${f}`);
    process.exit(1);
  }
  console.log(`PASS  local-brain capabilities mutants self-test - a code mutant was killed, a no-op mutant survived, an absent anchor was an error, a data mutant was killed, and the verdict failed on a survivor, an error and an equivalent that cannot run`);
  process.exit(0);
}

function main() {
  if (process.argv.includes("--self-test")) return selfTest();
  if (process.argv.includes("--list")) {
    for (const m of CODE) console.log(`code  ${m.id}  ${m.label}`);
    for (const m of EQUIVALENT) console.log(`equiv ${m.id}  ${m.label}`);
    for (const m of DATA) console.log(`data  ${m.id}  ${m.label}`);
    return undefined;
  }
  return mainRun();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
