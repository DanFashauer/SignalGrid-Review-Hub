// check-gate-self-tests-run.mjs — a check-gate's --self-test that no step runs is run HERE,
// and a gate with neither a --self-test flag nor any control fails.
//
//   node scripts/check-gate-self-tests-run.mjs                     # the gate
//   node scripts/check-gate-self-tests-run.mjs --self-test         # prove it can fail
//   node scripts/check-gate-self-tests-run.mjs --root <dir> [--floor N]   # (self-test plumbing)
//
// WHY THIS EXISTS (docs/COMPANY_BUILD_PLAN.md row 43, remainder). Falsifiability was enforced
// for the connector tier only. A `scripts/check-*.mjs` gate can carry a `--self-test` handler
// that NO preflight step and NO workflow `run:` line ever invokes: a broken self-test in it
// leaves preflight and CI green, and the gate that was supposed to prove it can fail is the one
// thing nobody proves. `check-android-core-tests.mjs` states the class ("a flag nobody registers
// is a self-test nobody runs") and fixes it for that one gate; nothing prevented the next.
//
// WHAT IT DOES, on every invocation:
//   1. enumerates scripts/check-*.mjs;
//   2. for each gate whose NON-COMMENT source carries a quoted `--self-test` literal and which no
//      preflight STEPS entry (scripts/preflight.mjs, scripts/verify-breadth.mjs) and no workflow
//      `run:` command invokes as `<gate> --self-test`, SPAWNS `node <gate> --self-test` and
//      requires exit 0 AND stdout that names a self-test. A flag accepted as a no-op that just
//      runs the real check prints nothing self-test-shaped and is NOT credited (the defect
//      check-decision-port-parity.mjs's header describes);
//   3. for each gate with no handler, requires a non-comment line naming a control. THAT IS A
//      FLOOR AGAINST A GATE WITH NO CONTROL AT ALL — it is NOT proof that the control can fail.
//      A word on a code line is the weakest evidence this gate accepts, and it is reported as
//      "control-only", never as "self-tested";
//   4. prints the derived counts, so the dated measurement in row 43 is a figure a gate re-derives.
//
// FAIL-CLOSED. Anything it cannot read or parse tightens the answer: an unreadable gate, a
// preflight/workflow source that yields no steps, fewer gates than the floor (a walker that finds
// nothing is broken, not clean), a spawn that times out or errors — each is a FAILURE. A name in a
// comment, a workflow `name:` line, or a `# comment` does not register anything.
//
// REGISTRATION RULES. Whether a workflow `run:` line really runs `<gate> --self-test` is decided by
// scripts/lib/workflow-invocation.mjs — the SAME matcher scripts/check-preflight-ci-parity.mjs
// uses (command position only; quotes masked; `echo`, a quoted `|`, a `continue-on-error` step and a
// folded `run: >` credit nothing). Only workflows that trigger on `pull_request` or `push` count: a
// `workflow_dispatch`-only file never runs on a change. BRANCH AND PATH FILTERS ARE NOT READ — a step in a
// workflow whose push trigger is limited to one branch, or filters out the gate's paths, is credited (a known
// limit). A STEPS entry with extra keys after `cmd` (heavy, needsNativeBuild, …) is credited although preflight
// can skip it under --quick or on another platform; no self-test step on the real tree carries one.
// STEPS sources (scripts/preflight.mjs, scripts/verify-breadth.mjs) must be `{ name: "…", cmd: [...] }`
// objects inside the `STEPS = [ … ]` array, outside every comment AND outside every string or template literal
// (matched on a view with string bodies masked); `bash -c "…"` entries are NOT credited (they are spawned here instead —
// the safe direction: the worst case is one extra spawn of a self-test that was already registered).
//
// COMMENT STRIPPING is a small JS scanner (strings, template literals, regex literals and comments),
// not a regex: a `/*` inside a string (`"lib/**"`) is not a comment, and reading it as one blanked the
// real handler in check-role-coverage.mjs (review round 1). A line it cannot close (an unterminated
// quote) ends at the newline, so a stray quote can hide at most the rest of that line.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { invokes, maskQuoted, runCommands, stripYamlComments } from "./lib/workflow-invocation.mjs";

const SELF_FILE = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(SELF_FILE), "..");
/** Real tree has 150+ gates; fewer than this means the enumeration is broken. */
const DEFAULT_FLOOR = 100;
const SPAWN_TIMEOUT_MS = 120_000;

// ── source reading ──────────────────────────────────────────────────────────────────────────

/** Pure: the source with every comment blanked (line structure kept). Strings, template
 *  literals (with `${}` nesting) and regex literals are walked, so comment markers inside them
 *  are not comments. */
export function stripComments(src, { maskStrings = false } = {}) {
  const n = src.length;
  let out = "";
  let i = 0;
  let prev = ""; // last significant code character, for the regex-vs-division call
  let prevWord = "";
  let wordOpen = false;
  // After `)` and `]` the call is ambiguous (division, or `if (x) /re/.test(y)`); a regex read as division
  // can open a bogus comment and blank real code, a division read as a regex only copies text, so regex wins.
  const REGEX_AFTER = new Set(["", "(", ")", ",", "=", ":", "[", "]", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^"]);
  const REGEX_WORDS = new Set(["return", "typeof", "else", "case", "in", "of", "void", "delete", "throw", "yield", "await", "do", "instanceof", "new"]);
  const FILL = "\u0001";
  const lit = (t) => (maskStrings ? t.replace(/[^\n]/g, FILL) : t); // string text, or filler of the same length
  const copyString = (q) => { // at src[i] === q; copies through the closing quote or the line end
    out += src[i++];
    while (i < n && src[i] !== "\n") {
      if (src[i] === "\\") { out += lit(src.slice(i, i + 2)); i += 2; continue; }
      if (src[i] === q) { out += src[i++]; return; }
      out += lit(src[i++]);
    }
  };
  const copyTemplate = () => {
    out += src[i++];
    while (i < n) {
      if (src[i] === "\\") { out += lit(src.slice(i, i + 2)); i += 2; continue; }
      if (src[i] === "`") { out += src[i++]; return; }
      if (src[i] === "$" && src[i + 1] === "{") { out += lit("${"); i += 2; code(true); continue; }
      out += lit(src[i++]);
    }
  };
  function code(untilBrace) {
    let depth = 0;
    while (i < n) {
      const c = src[i];
      if (c === "/" && src[i + 1] === "/") { while (i < n && src[i] !== "\n") i++; continue; }
      if (c === "/" && src[i + 1] === "*") {
        const end = src.indexOf("*/", i + 2);
        const stop = end < 0 ? n : end + 2;
        out += src.slice(i, stop).replace(/[^\n]/g, " ");
        i = stop;
        continue;
      }
      if (c === '"' || c === "'") { copyString(c); prev = "a"; prevWord = ""; continue; }
      if (c === "`") { copyTemplate(); prev = "a"; prevWord = ""; continue; }
      if (c === "/" && (REGEX_WORDS.has(prevWord) || (REGEX_AFTER.has(prev) && !/[A-Za-z0-9_$]/.test(prev)))) {
        let j = i + 1, inClass = false, ok = false;
        while (j < n && src[j] !== "\n") {
          if (src[j] === "\\") { j += 2; continue; }
          if (src[j] === "[") inClass = true;
          else if (src[j] === "]") inClass = false;
          else if (src[j] === "/" && !inClass) { ok = true; j++; break; }
          j++;
        }
        if (ok) { out += src.slice(i, j); i = j; prev = "a"; prevWord = ""; continue; }
      }
      if (untilBrace) {
        if (c === "{") depth++;
        else if (c === "}") { if (depth === 0) { out += c; i++; return; } depth--; }
      }
      out += c;
      i++;
      if (/\s/.test(c)) { wordOpen = false; continue; }
      if (/[A-Za-z0-9_$]/.test(c)) { prevWord = wordOpen ? prevWord + c : c; wordOpen = true; prev = c; }
      else { prev = c; prevWord = ""; wordOpen = false; }
    }
  }
  code(false);
  return out;
}

/** Pure: does the non-comment source carry a quoted `--self-test` literal (a handler)? */
export function hasHandler(src) {
  return /["'`]--self-test["'`]/.test(stripComments(src));
}

/** Pure: does a NON-COMMENT line name a control? Floor only — see header. */
export function namesControl(src) {
  return /self-test|planted|\bcontrols?\b/i.test(stripComments(src));
}

// ── registration: who invokes `<gate> --self-test` ──────────────────────────────────────────

/** Pure: how many `STEPS = …` assignments the source holds outside comments and string literals (any shape:
 *  a declaration, a reassignment, `x.STEPS = …`). The registration scan trusts a source only when this is
 *  exactly 1, so a parked or later-reassigned list cannot stand in for the array the runner iterates. */
export function stepsAssignments(source) {
  return (stripComments(source, { maskStrings: true }).match(/\bSTEPS\s*=(?!=)/g) ?? []).length;
}

/** Pure: gate file names invoked WITH `--self-test` by STEPS-style `{ name: "…", cmd: [...] }`
 *  entries (preflight.mjs / verify-breadth.mjs), comments stripped by the scanner above.
 *  `pnpm run <alias>` resolves through `aliases`. `bash -c` strings credit nothing. */
export function selfTestFilesInSteps(source, aliases = new Map()) {
  const out = new Set();
  // Match on the view in which every string/template body is filler, so a string CONSTANT holding a whole
  // `{ name: "…", cmd: [...] }` entry is invisible; then read the real text of the matched span.
  const masked = stripComments(source, { maskStrings: true });
  const live = stripComments(source);
  if (masked.length !== live.length) return out; // the two views must align; if not, credit nothing
  // Only the `STEPS = [ … ]` array counts: an object literal elsewhere in the file (dead code, a parked list)
  // is not a step. Brackets are counted on the masked view, so a bracket in a string cannot unbalance it.
  if (stepsAssignments(source) !== 1) return out; // ambiguous or absent: credit nothing (runGate reports it)
  const open = /^(?:export\s+)?(?:const|let|var)\s+STEPS\s*=\s*\[/m.exec(masked);
  if (!open) return out;
  let depth = 0, end = -1;
  for (let k = open.index + open[0].length - 1; k < masked.length; k++) {
    if (masked[k] === "[") depth++;
    else if (masked[k] === "]" && --depth === 0) { end = k; break; }
  }
  if (end < 0) return out;
  const region = masked.slice(open.index, end + 1);
  for (const m of region.matchAll(/\bname:\s*(["'`])\u0001*\1\s*,\s*cmd:\s*\[([^\]]*)\]/g)) {
    const start = open.index + m.index + m[0].length - m[2].length - 1;
    const parts = live.slice(start, start + m[2].length).replace(/["'`]/g, "").split(",").map((x) => x.trim());
    if (!parts.includes("--self-test")) continue;
    if (parts[0] === "node" && /^scripts\/check-[\w.-]+\.mjs$/.test(parts[1] ?? "")) out.add(parts[1].split("/").pop());
    else if (parts[0] === "pnpm" && parts[1] === "run" && aliases.has(parts[2])) out.add(aliases.get(parts[2]));
  }
  return out;
}

/** Pure: package.json `scripts` → Map(alias → check-gate file) for aliases that are exactly
 *  `node scripts/check-*.mjs`. */
export function gateAliases(pkgScripts) {
  const out = new Map();
  for (const [k, v] of Object.entries(pkgScripts ?? {})) {
    const m = /^node\s+scripts\/(check-[\w.-]+\.mjs)\s*$/.exec(String(v));
    if (m) out.set(k, m[1]);
  }
  return out;
}

/** Pure: the event names in an inline `on:` value — a scalar (`push`), a flow sequence (`[push, pull_request]`)
 *  or the TOP-LEVEL keys of a flow mapping (`{ push: {…}, workflow_dispatch: { inputs: { push: … } } }`; nested keys
 *  do not count). A value holding a quote, or anything else, yields no event, which is the tight answer. */
export function inlineEvents(value) {
  const v = value.trim();
  if (/["']/.test(v)) return []; // a quoted string can hide a structural character; the tight answer is no event at all
  const unq = (x) => x.trim();
  if (v.startsWith("[") || v.startsWith("{")) {
    const mapping = v.startsWith("{");
    const out = [];
    let depth = 0, cur = "";
    const flush = (isKey) => { if (cur.trim() !== "" && (!mapping || isKey)) out.push(unq(cur)); cur = ""; };
    for (let i = 0; i < v.length; i++) {
      const c = v[i];
      if (c === "{" || c === "[") { depth++; if (depth > 1) cur += c; continue; }
      if (c === "}" || c === "]") { if (depth === 1) flush(false); depth--; if (depth >= 1) cur += c; continue; }
      if (depth === 1 && c === ",") { flush(false); continue; }
      if (depth === 1 && mapping && c === ":") { flush(true); continue; } // a scalar value is flushed (and dropped) at the next comma
      if (depth === 1) cur += c;
    }
    return out;
  }
  return [unq(v.split(/\s+#/)[0])];
}

/** Pure: does this workflow text trigger on a pull request or a push (the only runs that gate a change)?
 *  Only the DIRECT children of `on:` count — an input named `push` under workflow_dispatch does not.
 *  Branch and path filters are not read. */
export function runsOnChange(text) {
  const t = stripYamlComments(text);
  const m = /^on:[ \t]*(.*)$/m.exec(t);
  if (!m) return false;
  if (m[1].trim() !== "") return inlineEvents(m[1]).some((e) => e === "pull_request" || e === "push"); // on: push / [push, …] / { push: … }
  let indent = -1;
  for (const l of t.slice(m.index + m[0].length).split("\n")) {
    if (l.trim() === "") continue;
    const ind = /^[ \t]*/.exec(l)[0].length;
    if (ind === 0) break; // next top-level key
    if (indent < 0) indent = ind;
    if (ind === indent && /^(pull_request|push)[ \t]*:/.test(l.trim())) return true;
  }
  return false;
}

/** Pure: the masked shell command text of every step that can fail CI, across the workflows that
 *  run on a change. */
export function workflowCommands(workflowTexts) {
  const out = [];
  for (const text of workflowTexts) {
    if (!runsOnChange(text)) continue;
    for (const c of runCommands(stripYamlComments(text))) out.push(maskQuoted(c));
  }
  return out;
}

/** Pure: the gate files among `files` whose `--self-test` the masked workflow commands invoke. */
export function selfTestFilesInWorkflows(commands, files, aliases = new Map()) {
  const out = new Set();
  const aliasOf = new Map();
  for (const [alias, file] of aliases) aliasOf.set(file, [...(aliasOf.get(file) ?? []), alias]);
  for (const f of files) {
    if (invokes(`scripts/${f}`, true, commands) || (aliasOf.get(f) ?? []).some((a) => invokes(a, true, commands))) out.add(f);
  }
  return out;
}

// ── the verdict ─────────────────────────────────────────────────────────────────────────────

/** Pure. gates: [{file, src}]; registered: Set of files some step runs with --self-test.
 *  Returns the partition; the spawn lives outside so a self-test can drive this directly. */
export function classify(gates, registered) {
  const withHandler = [];
  const noHandler = [];
  for (const g of gates) (hasHandler(g.src) ? withHandler : noHandler).push(g);
  const registeredGates = withHandler.filter((g) => registered.has(g.file));
  const toSpawn = withHandler.filter((g) => !registered.has(g.file));
  const controlOnly = noHandler.filter((g) => namesControl(g.src));
  const controlless = noHandler.filter((g) => !namesControl(g.src));
  return { withHandler, registeredGates, toSpawn, controlOnly, controlless };
}

/** Pure: did a spawned `--self-test` earn credit? exit 0 AND stdout names a self-test. */
export function spawnCredit(r) {
  if (!r || r.error || r.status !== 0) return { ok: false, why: r?.error ? `spawn error: ${r.error.code ?? r.error.message}` : `exit ${r?.status ?? "null"}${r?.signal ? ` (${r.signal})` : ""}` };
  if (!/self-test/i.test(r.stdout ?? "")) return { ok: false, why: "exit 0 but stdout names no self-test (a flag accepted as a no-op is not a self-test)" };
  if (/self-test\s+FAILED/i.test(r.stdout)) return { ok: false, why: "exit 0 but stdout says the self-test FAILED" };
  return { ok: true, why: "" };
}

function realSpawn(root, file) {
  return spawnSync(process.execPath, [join(root, "scripts", file), "--self-test"], {
    cwd: root, encoding: "utf8", timeout: SPAWN_TIMEOUT_MS, killSignal: "SIGKILL",
  });
}

/** Run the gate over `root`. Returns {problems, counts, lines}. `spawn` injectable for the self-test. */
export function runGate(root, { floor = DEFAULT_FLOOR, spawn = realSpawn } = {}) {
  const problems = [];
  const scriptsDir = join(root, "scripts");
  const files = existsSync(scriptsDir) ? readdirSync(scriptsDir).filter((f) => /^check-.*\.mjs$/.test(f)).sort() : [];
  const gates = [];
  for (const file of files) {
    try { gates.push({ file, src: readFileSync(join(scriptsDir, file), "utf8") }); }
    catch (e) { problems.push(`${file}: unreadable (${e.code ?? e.message}) — cannot be classified, so it fails`); }
  }
  if (files.length < floor) problems.push(`found ${files.length} scripts/check-*.mjs gates, below the floor of ${floor} — the enumeration is broken, not clean`);

  let pkgScripts = {};
  try { pkgScripts = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts ?? {}; } catch { /* aliases are an addition; absence only means fewer credited, i.e. more spawned */ }
  const aliases = gateAliases(pkgScripts);

  const registered = new Set();
  let stepSources = 0;
  for (const lane of ["scripts/preflight.mjs", "scripts/verify-breadth.mjs"]) {
    const p = join(root, lane);
    if (!existsSync(p)) { if (lane.endsWith("preflight.mjs")) problems.push(`${lane} is missing — no registration can be read`); continue; }
    const text = readFileSync(p, "utf8");
    if (lane.endsWith("preflight.mjs") && /\bcmd:\s*\[/.test(stripComments(text))) stepSources++;
    const n = stepsAssignments(text);
    if (n !== 1) problems.push(`${lane} holds ${n} \`STEPS =\` assignments, expected exactly 1 — the registration scan cannot tell which list the runner iterates`);
    for (const f of selfTestFilesInSteps(text, aliases)) registered.add(f);
  }
  const wfDir = join(root, ".github", "workflows");
  const wfFiles = existsSync(wfDir) ? readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f)) : [];
  const wfTexts = wfFiles.map((f) => readFileSync(join(wfDir, f), "utf8"));
  const wfCommands = workflowCommands(wfTexts);
  for (const f of selfTestFilesInWorkflows(wfCommands, files, aliases)) registered.add(f);
  if (stepSources === 0) problems.push("scripts/preflight.mjs yields no `cmd: [...]` steps — the STEPS shape changed, so registration is unreadable");
  if (wfCommands.length === 0) problems.push(".github/workflows yields no `run:` step in a workflow that runs on a pull request or push — registration is unreadable");

  const c = classify(gates, registered);
  const spawnedOk = [];
  for (const g of c.toSpawn) {
    const credit = spawnCredit(spawn(root, g.file));
    if (credit.ok) spawnedOk.push(g.file);
    else problems.push(`scripts/${g.file}: its --self-test is run by NO preflight step and NO workflow, and run here it FAILS — ${credit.why}`);
  }
  for (const g of c.controlless) problems.push(`scripts/${g.file}: no --self-test flag and no non-comment line names a control (self-test / planted / controls) — a gate nobody can see fail`);

  const counts = {
    gates: gates.length, withHandler: c.withHandler.length, registered: c.registeredGates.length,
    runHere: c.toSpawn.length, runHereOk: spawnedOk.length, controlOnly: c.controlOnly.length, controlless: c.controlless.length,
  };
  return { problems, counts, spawned: c.toSpawn.map((g) => g.file) };
}

function formatCounts(k) {
  return `${k.gates} gates; ${k.withHandler} with a --self-test handler; ${k.registered} of those registered by a preflight step or workflow; ` +
    `${k.runHere} run by this gate (${k.runHereOk} passed); ${k.controlOnly} control-only (named control, no flag — floor, not proof it can fail); ${k.controlless} with neither`;
}

// ── self-test ───────────────────────────────────────────────────────────────────────────────

const GOOD_ST = `if (process.argv.includes("--self-test")) { console.log("self-test passed (1/1)"); process.exit(0); }\nconsole.log("real check ok");\n`;
const BAD_ST = `if (process.argv.includes("--self-test")) { console.log("self-test FAILED (0/1)"); process.exit(1); }\nconsole.log("real check ok");\n`;
const NOOP_ST = `if (process.argv.includes("--self-test")) { /* accepted, then falls through to the real check */ }\nconsole.log("real check ok");\n`;

function selfTest() {
  const checks = [];
  const tmp = mkdtempSync(join(tmpdir(), "gate-self-tests-run-"));
  const ON = "on:\n  pull_request:\n  push:\n";
  const mkTree = (name, gates, o = {}) => {
    const root = join(tmp, name);
    mkdirSync(join(root, "scripts"), { recursive: true });
    mkdirSync(join(root, ".github", "workflows"), { recursive: true });
    for (const [f, src] of Object.entries(gates)) writeFileSync(join(root, "scripts", f), src);
    if (!o.noPreflight) writeFileSync(join(root, "scripts", "preflight.mjs"), o.preflightRaw ?? `const STEPS = [\n${o.preflight ?? ""}\n  { name: "x", cmd: ["node", "scripts/other.mjs"] },\n];\n`);
    if (o.breadth !== undefined) writeFileSync(join(root, "scripts", "verify-breadth.mjs"), o.breadth);
    if (!o.noWorkflows) writeFileSync(join(root, ".github", "workflows", "ci.yml"), `${o.on ?? ON}jobs:\n  a:\n    steps:\n      - run: echo hi\n${o.workflow ?? ""}`);
    writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: o.pkg ?? {} }));
    writeFileSync(join(root, "fixture-marker.txt"), "x");
    return root;
  };
  const self = (root, floor = "1") => spawnSync(process.execPath, [SELF_FILE, "--root", root, "--floor", floor], { encoding: "utf8", timeout: 60_000, killSignal: "SIGKILL" });
  const note = (name, ok, detail = "") => checks.push([name, ok, detail]);
  const out = (r) => `${r.stdout}\n${r.stderr}`;
  const red = (label, root, file, extra) => {
    const r = self(root);
    note(`RED: ${label}`, r.status === 1 && (file ? out(r).includes(file) : true) && (extra ? extra.test(out(r)) : true), `exit ${r.status}`);
  };
  const stepOf = (f) => `  - name: s\n    run: ${f}\n`;
  const CMD = "node scripts/check-bad.mjs --self-test";

  try {
    // ── the three reds the spec names ──
    red("an unregistered gate whose --self-test exits 1 fails the gate and is named", mkTree("red1", { "check-bad.mjs": BAD_ST }), "check-bad.mjs");
    red("an unregistered gate whose --self-test is a no-op (exit 0, prints nothing self-test-shaped) fails", mkTree("red2", { "check-noop.mjs": NOOP_ST }), "check-noop.mjs", /no-op/);
    red("a flag-less gate whose only control sits in a comment fails", mkTree("red3", { "check-nocontrol.mjs": `// self-test planted control: see elsewhere\n/* controls live in another file */\nconsole.log("real check ok");\n` }), "check-nocontrol.mjs");
    red("a self-test that exits 0 but prints 'self-test FAILED' earns no credit", mkTree("red3b", { "check-lies.mjs": `if (process.argv.includes("--self-test")) { console.log("self-test FAILED (0/1)"); process.exit(0); }\n` }), "check-lies.mjs");

    // ── a registration shape that cannot run the self-test must not register it ──
    const R = (label, o) => red(`${label} does not register the gate (its broken --self-test is still spawned)`, mkTree(`reg-${label.replace(/\W+/g, "-")}`, { "check-bad.mjs": BAD_ST }, o), "check-bad.mjs");
    R("a commented-out preflight step", { preflight: `  // { name: "r", cmd: ["node", "scripts/check-bad.mjs", "--self-test"] },` });
    R("a block-commented preflight/breadth step", { breadth: `const STEPS = [\n  /* parked: { name: "r", cmd: ["node", "scripts/check-bad.mjs", "--self-test"] }, */\n];\n` });
    R("a trailing-comment step", { preflight: `  { name: "q", cmd: ["node", "scripts/other.mjs"] }, // { name: "r", cmd: ["node", "scripts/check-bad.mjs", "--self-test"] }` });
    R("a string constant holding a whole step entry", { preflight: `  const doc = '{ name: "r", cmd: ["node", "scripts/check-bad.mjs", "--self-test"] }';` });
    R("a template literal holding a whole step entry (breadth)", { breadth: "const doc = `{ name: \"r\", cmd: [\"node\", \"scripts/check-bad.mjs\", \"--self-test\"] }`;\n" });
    R("a plain flag-less step for the gate", { preflight: `  { name: "r", cmd: ["node", "scripts/check-bad.mjs"] },` });
    R("a non-node runner naming the gate", { preflight: `  { name: "r", cmd: ["echo", "scripts/check-bad.mjs", "--self-test"] },` });
    R("a bash -c step that only echoes it", { preflight: `  { name: "r", cmd: ["bash", "-c", "echo node scripts/check-bad.mjs --self-test"] },` });
    R("a workflow name: line", { workflow: `      - name: ${CMD}\n        run: echo nothing\n` });
    R("a YAML comment", { workflow: `      # run: ${CMD}\n` });
    R("a trailing YAML comment after a real command", { workflow: stepOf(`true # && ${CMD}`) });
    R("`echo node …`", { workflow: stepOf(`echo ${CMD}`) });
    R("a quoted separator (echo \"x | node …\")", { workflow: stepOf(`echo "disabled | ${CMD}"`) });
    R("a continue-on-error step", { workflow: `      - continue-on-error: true\n        run: ${CMD}\n` });
    R("a folded run: > whose first line is echo", { workflow: `      - run: >\n          echo skipped\n          ${CMD}\n` });
    R("a plain flag-less workflow run", { workflow: stepOf("node scripts/check-bad.mjs") });
    R("a plain flag-less `pnpm run <alias>` workflow run", { pkg: { gz: "node scripts/check-bad.mjs" }, workflow: stepOf("pnpm run gz") });
    R("a run of --self-test-not", { workflow: stepOf("node scripts/check-bad.mjs --self-test-not") });
    R("a `parked.STEPS = [` assignment ahead of the real STEPS", { breadth: `parked.STEPS = [{ name: "r", cmd: ["node", "scripts/check-bad.mjs", "--self-test"] }];\nconst STEPS = [];\n` });
    R("a reassigned STEPS (let STEPS = [entry]; STEPS = [])", { breadth: `let STEPS = [{ name: "r", cmd: ["node", "scripts/check-bad.mjs", "--self-test"] }];\nSTEPS = [];\n` });
    R("a lone `cfg.STEPS = [` list (no declaration)", { breadth: `cfg.STEPS = [{ name: "r", cmd: ["node", "scripts/check-bad.mjs", "--self-test"] }];\n` });
    red("a second STEPS assignment is reported even when every gate is fine", mkTree("red-steps2", { "check-good.mjs": GOOD_ST }, { breadth: "const STEPS = [];\nSTEPS = [];\n" }), "verify-breadth.mjs", /STEPS =/);
    R("a function-local STEPS ahead of the real one", { breadth: `function f() {\n  const STEPS = [{ name: "r", cmd: ["node", "scripts/check-bad.mjs", "--self-test"] }];\n}\nconst STEPS = [];\n` });
    R("an inline flow mapping whose description holds `}, push: {`", { workflow: stepOf(CMD), on: "on: { workflow_dispatch: { description: '}, push: {' } }\n" });
    R("an inline flow mapping holding a quoted `x, push: y`", { workflow: stepOf(CMD), on: 'on: { workflow_dispatch: "x, push: y" }\n' });
    R("a quoted `\"on\":` key in a dispatch-only workflow", { workflow: stepOf(CMD), on: '"on":\n  workflow_dispatch:\n' });
    R("an inline flow-mapping `on:` whose dispatch input is named push", { workflow: stepOf(CMD), on: "on: { workflow_dispatch: { inputs: { push: { type: boolean } } } }\n" });
    R("a PARKED_STEPS array ahead of STEPS", { breadth: `const PARKED_STEPS = [{ name: "r", cmd: ["node", "scripts/check-bad.mjs", "--self-test"] }];\nconst STEPS = [];\n` });
    R("an object literal outside the STEPS array (breadth)", { breadth: `const STEPS = [];\nconst RETIRED = [{ name: "parked", cmd: ["node", "scripts/check-bad.mjs", "--self-test"] }];\n` });
    R("an inline `on: workflow_dispatch`", { workflow: stepOf(CMD), on: "on: workflow_dispatch\n" });
    R("a job named push in a dispatch-only file", { workflow: stepOf(CMD), on: "on:\n  workflow_dispatch:\nx:\n  push:\n    y: 1\n" });
    R("a step in a workflow_dispatch-only file", { workflow: stepOf(CMD), on: "on:\n  workflow_dispatch:\n" });
    R("a dispatch-only workflow with an input named push", { workflow: stepOf(CMD), on: "on:\n  workflow_dispatch:\n    inputs:\n      push:\n        type: boolean\n" });

    // ── the handler/comment scanner: a glob string must not blank a real handler ──
    red("a handler after a \"lib/**\" glob string is still seen (and spawned, and fails)", mkTree("red-glob", { "check-glob.mjs": `const g = ["lib/**", "docs/*"];\n${BAD_ST}/* tail */\n` }), "check-glob.mjs");
    red("a handler on the same line after a regex literal holding /* is still seen", mkTree("red-regex", { "check-rx.mjs": `const planted = 1;\nconst r = /[/*]x/; if (process.argv.includes("--self-test")) { console.log("self-test FAILED"); process.exit(1); }\nconst z = "*/";\n` }), "check-rx.mjs", /FAILS/);
    red("a handler on the same line after a nested template holding // is still seen", mkTree("red-tpl", { "check-tpl.mjs": "const planted = 1;\nconst t = `${`//`}`; if (process.argv.includes(\"--self-test\")) { console.log(\"self-test FAILED\"); process.exit(1); }\n" }), "check-tpl.mjs", /FAILS/);

    // ── fail-closed branches ──
    red("no scripts/preflight.mjs", mkTree("red-nopf", { "check-good.mjs": GOOD_ST }, { noPreflight: true }), "preflight.mjs", /is missing/);
    red("a preflight.mjs with no cmd steps", mkTree("red-nosteps", { "check-good.mjs": GOOD_ST }, { preflightRaw: "export {};\n" }), "no `cmd");
    red("no workflow run: step on a change", mkTree("red-nowf", { "check-good.mjs": GOOD_ST }, { noWorkflows: true }), "workflows");
    {
      const root = mkTree("red-unreadable", { "check-good.mjs": GOOD_ST });
      mkdirSync(join(root, "scripts", "check-dir.mjs"));
      red("a check-*.mjs that cannot be read", root, "check-dir.mjs", /unreadable/);
    }
    {
      const floorRoot = mkTree("red-floor", { "check-good.mjs": GOOD_ST });
      const r = self(floorRoot, "5");
      note("RED: fewer gates than the floor fails (a walker that finds nothing is broken)", r.status === 1 && /floor/.test(out(r)), `exit ${r.status}`);
    }

    // ── greens ──
    const trapFor = (markerPath) => `import { writeFileSync } from "node:fs";\nif (process.argv.includes("--self-test")) { writeFileSync(${JSON.stringify(markerPath)}, "spawned"); console.log("self-test FAILED"); process.exit(1); }\n`;
    const green = (label, name, gates, o, marker) => {
      const r = self(mkTree(name, gates, o));
      note(`GREEN: ${label}`, r.status === 0 && (marker ? !existsSync(marker) : true), `exit ${r.status}${marker ? `, marker ${existsSync(marker) ? "PRESENT" : "absent"}` : ""}`);
      return r;
    };
    let m = join(tmp, "m1");
    green("a gate a preflight step runs with --self-test passes and is NOT spawned", "green1", { "check-reg.mjs": trapFor(m) }, { preflight: `  { name: "r", cmd: ["node", "scripts/check-reg.mjs", "--self-test"] },` }, m);
    m = join(tmp, "m2");
    green("a gate a workflow run: line runs with --self-test passes and is NOT spawned", "green1b", { "check-regwf.mjs": trapFor(m) }, { workflow: stepOf("node scripts/check-regwf.mjs --self-test") }, m);
    m = join(tmp, "m3");
    green("a gate a verify-breadth step runs with --self-test is NOT spawned", "green1c", { "check-regbr.mjs": trapFor(m) }, { breadth: `const STEPS = [\n  { name: "r", cmd: ["node", "scripts/check-regbr.mjs", "--self-test"] },\n];\n` }, m);
    m = join(tmp, "m4");
    green("a gate registered through a package.json alias (preflight and workflow) is NOT spawned", "green1d", { "check-alias.mjs": trapFor(m), "check-alias2.mjs": trapFor(join(tmp, "m4b")) }, { pkg: { gx: "node scripts/check-alias.mjs", gy: "node scripts/check-alias2.mjs" }, preflight: `  { name: "r", cmd: ["pnpm", "run", "gx", "--self-test"] },`, workflow: stepOf("pnpm run gy --self-test") }, m);
    green("a spawned self-test runs with the tree root as its cwd", "green-cwd", { "check-cwd.mjs": `import { existsSync } from "node:fs";\nif (process.argv.includes("--self-test")) { if (!existsSync("fixture-marker.txt")) process.exit(1); console.log("self-test ok (cwd)"); }\n` });
    green("a flag-less gate with a control on a code line passes", "green2", { "check-ctl.mjs": `const planted = "bad";\nif (!planted) process.exit(1);\nconsole.log("real check ok");\n` });
    let r = green("an unregistered gate whose --self-test exits 0 and names itself passes (and is spawned)", "green3", { "check-good.mjs": GOOD_ST });
    note("GREEN: …and the printed counts say it was run here", /1 run by this gate \(1 passed\)/.test(r.stdout), r.stdout.split("\n")[0]);
    r = green("a flag-less gate that only prints a usage string naming --self-test is control-only, not a handler", "green4", { "check-usage.mjs": `if (process.argv.length > 2) process.exit(1);\nconsole.log("usage: check-usage [--self-test]");\n` });
    note("GREEN: …and is counted control-only", /0 with a --self-test handler/.test(r.stdout) && /1 control-only/.test(r.stdout), r.stdout.split("\n")[0]);

    // ── pure functions, direct ──
    note("pure: a control only in a comment is not a control", !namesControl("// planted\n/* self-test */\nconst a = 1;"));
    note("pure: a control on a code line is", namesControl('const planted = "x";'));
    note("pure: a commented-out handler is not a handler", !hasHandler('// if (argv.includes("--self-test"))\nconst a = 1;'));
    note("pure: a handler after `\"a/**\"` is a handler", hasHandler('const g = "a/**";\nif (x.includes("--self-test")) f();\n// */\n'));
    note("pure: a handler inside a template ${} after a nested template is a handler", hasHandler('const t = `a ${`b`} c`;\nif (x.includes("--self-test")) f();\n'));
    note("pure: an escaped quote does not end a string (\"a\\\"/*\" then a handler)", hasHandler('const s = "a\\"/*"; if (x.includes("--self-test")) f();\n/* end */\n'));
    note("pure: an unterminated quote ends at the newline (a commented handler on the next line stays a comment)", !hasHandler('const s = "oops;\n// if (x.includes("--self-test")) f();\nconst t = "x";\n'));
    note("pure: a regex literal after `)` holding /* does not hide a handler", hasHandler('if (x) /[/*]/.test(y);\nif (a.includes("--self-test")) f();\n/* end */\n'));
    note("pure: a regex literal after `else return` holding /* does not hide a handler", hasHandler('else return /[/*]/.test(s);\nif (a.includes("--self-test")) f();\n/* end */\n'));
    note("pure: inline on: values read scalars, sequences and only TOP-LEVEL mapping keys", JSON.stringify(inlineEvents("push")) === '["push"]' && JSON.stringify(inlineEvents("[push, pull_request]")) === '["push","pull_request"]' && JSON.stringify(inlineEvents("{ workflow_dispatch: { inputs: { push: {} } } }")) === '["workflow_dispatch"]' && JSON.stringify(inlineEvents("{ push: { branches: [a, b] }, workflow_dispatch: {} }")) === '["push","workflow_dispatch"]' && runsOnChange("on: { push: {} }\n") && !runsOnChange("on: { workflow_dispatch: { inputs: { pull_request: {} } } }\n"));
    note("pure: a STEPS count of exactly one is required (declaration + reassignment = 2)", stepsAssignments("const STEPS = [];\n") === 1 && stepsAssignments("let STEPS = [];\nSTEPS = [];\n") === 2 && stepsAssignments("// STEPS = []\nconst s = 'STEPS = 1';\nconst STEPS = [];\n") === 1);
    note("pure: a quote in an inline on: value yields no event", inlineEvents("{ workflow_dispatch: { description: '}, push: {' } }").length === 0 && inlineEvents('[\"push\"]').length === 0);
    note("pure: runsOnChange reads only direct children of on:", !runsOnChange("on:\n  workflow_dispatch:\n    inputs:\n      push:\n        type: boolean\n") && runsOnChange("on:\n  push:\n    branches: [a]\n"));
    note("pure: a regex after a bare else holding /* does not hide a handler", hasHandler('if (a) b(); else /[/*]/.test(s);\nif (a.includes("--self-test")) f();\n/* end */\n'));
    note("pure: a character class holding // does not end the regex early", hasHandler('const r = /[//*]/; if (a.includes("--self-test")) f();\n/* end */\n'));
    note("pure: a gate alias must be exactly `node scripts/check-*.mjs`", gateAliases({ a: "node scripts/check-x.mjs && echo", b: "node scripts/check-y.mjs", c: "node scripts/check-z.mjs.bak" }).size === 1);
    note("pure: a step naming scripts/check-x.mjs.bak registers nothing", selfTestFilesInSteps('const STEPS = [\n  { name: "r", cmd: ["node", "scripts/check-x.mjs.bak", "--self-test"] },\n];\n').size === 0);
    note("pure: a step inside STEPS registers, one in a later array does not", (() => { const f = selfTestFilesInSteps('const STEPS = [\n  { name: "r", cmd: ["node", "scripts/check-in.mjs", "--self-test"] },\n];\nconst X = [{ name: "r", cmd: ["node", "scripts/check-out.mjs", "--self-test"] }];\n'); return f.has("check-in.mjs") && !f.has("check-out.mjs") && f.size === 1; })());
    note("pure: exit 1 earns no credit", !spawnCredit({ status: 1, stdout: "self-test" }).ok);
    note("pure: exit 0 with silent stdout earns no credit", !spawnCredit({ status: 0, stdout: "all ok" }).ok);
    note("pure: a timeout (status null) earns no credit", !spawnCredit({ status: null, signal: "SIGKILL", stdout: "self-test" }).ok);
    note("pure: exit 0 naming a self-test earns credit", spawnCredit({ status: 0, stdout: "self-test passed" }).ok);
    note("pure: on: [push] and on: push count, on: workflow_dispatch does not", runsOnChange("on: [push]\n") && runsOnChange("on: push\n") && !runsOnChange("on:\n  workflow_dispatch:\n") && runsOnChange("on:\n  pull_request:\n"));

    // ── live: the detector still finds the real tree's gates, and agrees with a plain grep ──
    const live = runGate(REPO, { spawn: () => ({ status: 0, stdout: "self-test" }) });
    note("live: the real tree yields at least the floor of gates", live.counts.gates >= DEFAULT_FLOOR, `${live.counts.gates} gates`);
    note("live: the real tree has registered self-tests (the registration scan reads preflight and the workflows)", live.counts.registered >= 50, `${live.counts.registered} registered`);
    note("live: the three formerly unrun self-tests are in the spawn set", ["check-api-collection.mjs", "check-deployment-runbook.mjs", "check-desktop-core-tests.mjs"].every((f) => live.spawned.includes(f)), live.spawned.join(","));
    const grepCount = readdirSync(join(REPO, "scripts")).filter((f) => /^check-.*\.mjs$/.test(f)).filter((f) => /["'`]--self-test["'`]/.test(readFileSync(join(REPO, "scripts", f), "utf8"))).length;
    note("live: the handler count equals a plain grep for a quoted --self-test literal (a comment-stripper that eats code diverges)", live.counts.withHandler === grepCount, `${live.counts.withHandler} vs grep ${grepCount}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok, detail] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}${detail ? ` [${detail}]` : ""}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

// ── main ────────────────────────────────────────────────────────────────────────────────────

if (process.argv[1] && resolve(process.argv[1]) === SELF_FILE) {
  if (process.argv.includes("--self-test")) process.exit(selfTest());
  const argv = process.argv.slice(2);
  const val = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  const root = val("--root") ? resolve(val("--root")) : REPO;
  const floor = val("--floor") !== undefined ? Number(val("--floor")) : DEFAULT_FLOOR;
  if (!Number.isInteger(floor) || floor < 0) { console.error("✗ --floor must be a non-negative integer"); process.exit(1); }
  const { problems, counts } = runGate(root, { floor });
  console.log(formatCounts(counts));
  if (problems.length) {
    console.error(`\n✗ ${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log("✓ every gate's self-test is run by a step or by this gate, and every flag-less gate names a control");
}
