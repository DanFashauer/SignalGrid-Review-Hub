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
// Why the registration scan is re-derived and not imported from check-preflight-ci-parity.mjs:
// that module runs its whole check at import time. The shapes here are narrower on purpose —
// where they disagree with the parity gate they are STRICTER, so the worst case is one extra
// spawn of a self-test that was already registered, never a skipped one.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SELF_FILE = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(SELF_FILE), "..");
/** Real tree has 150+ gates; fewer than this means the enumeration is broken. */
const DEFAULT_FLOOR = 100;
const SPAWN_TIMEOUT_MS = 120_000;

// ── source reading ──────────────────────────────────────────────────────────────────────────

/** Pure: the source with block comments, whole-line `//` / `#` comments and trailing ` // …`
 *  comments blanked, line structure preserved. Conservative in the TIGHTENING direction: a `//`
 *  inside a string literal drops the rest of that line, which can only hide a control, never
 *  invent one. */
export function stripComments(src) {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  return noBlock
    .split("\n")
    .map((l) => (/^\s*(\/\/|#(?!!))/.test(l) ? "" : l.replace(/\s\/\/.*$/, "")))
    .join("\n");
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

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Pure: gate file names invoked WITH `--self-test` by STEPS-style `cmd: [...]` entries
 *  (preflight.mjs / verify-breadth.mjs). Whole-line `//` comments are dropped first, so a
 *  commented-out step registers nothing. `pnpm run <alias>` resolves through `aliases`. */
export function selfTestFilesInSteps(source, aliases = new Map()) {
  const out = new Set();
  const live = source.split("\n").map((l) => (/^\s*\/\//.test(l) ? "" : l)).join("\n");
  for (const m of live.matchAll(/cmd:\s*\[([^\]]+)\]/g)) {
    const parts = m[1].replace(/["'`]/g, "").split(",").map((s) => s.trim());
    if (!parts.includes("--self-test")) {
      // `bash -c "node scripts/x.mjs --self-test"` keeps the flag inside one string element.
      for (const x of m[1].matchAll(/scripts\/(check-[\w.-]+\.mjs)\s+(?:--\s+)?--self-test\b/g)) out.add(x[1]);
      continue;
    }
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

/** Pure: the shell command text of every `run:` step in a workflow (YAML comments stripped). */
export function workflowRunCommands(text) {
  const lines = text.split("\n").map((l) => l.replace(/(^|\s)#.*$/, "$1"));
  const indentOf = (l) => /^[ \t]*/.exec(l)[0].length;
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^([ \t]*)(-[ \t]+)?run:[ \t]*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const keyCol = m[1].length + (m[2] ? m[2].length : 0);
    const body = [m[3].trim().replace(/^[|>][+-]?\d*$/, "")];
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() !== "" && indentOf(lines[j]) <= keyCol) break;
      body.push(lines[j].trim());
    }
    out.push(body.join("\n").replace(/\\\n\s*/g, " "));
  }
  return out;
}

/** Pure: gate file names a workflow invokes with `--self-test` from a `run:` command. */
export function selfTestFilesInWorkflow(text, aliases = new Map()) {
  const out = new Set();
  for (const cmd of workflowRunCommands(text)) {
    for (const m of cmd.matchAll(/(?:^|[\s;&|(])node\s+(?:\S+\s+)*?scripts\/(check-[\w.-]+\.mjs)\s+(?:--\s+)?--self-test(?![\w-])/g)) out.add(m[1]);
    for (const [alias, file] of aliases) {
      if (new RegExp(`(?:^|[\\s;&|(])(?:pnpm|npm)\\s+run\\s+${escapeRe(alias)}\\s+(?:--\\s+)?--self-test(?![\\w-])`).test(cmd)) out.add(file);
    }
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
    const found = selfTestFilesInSteps(readFileSync(p, "utf8"), aliases);
    if (lane.endsWith("preflight.mjs") && /cmd:\s*\[/.test(readFileSync(p, "utf8"))) stepSources++;
    for (const f of found) registered.add(f);
  }
  const wfDir = join(root, ".github", "workflows");
  const wfFiles = existsSync(wfDir) ? readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f)) : [];
  let runLines = 0;
  for (const f of wfFiles) {
    const text = readFileSync(join(wfDir, f), "utf8");
    runLines += workflowRunCommands(text).length;
    for (const g of selfTestFilesInWorkflow(text, aliases)) registered.add(g);
  }
  if (stepSources === 0) problems.push("scripts/preflight.mjs yields no `cmd: [...]` steps — the STEPS shape changed, so registration is unreadable");
  if (runLines === 0) problems.push(".github/workflows yields no `run:` steps — registration is unreadable");

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
  return { problems, counts };
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
  const mkTree = (name, gates, { preflight = "", workflow = "", marker } = {}) => {
    const root = join(tmp, name);
    mkdirSync(join(root, "scripts"), { recursive: true });
    mkdirSync(join(root, ".github", "workflows"), { recursive: true });
    for (const [f, src] of Object.entries(gates)) writeFileSync(join(root, "scripts", f), src);
    writeFileSync(join(root, "scripts", "preflight.mjs"), `const STEPS = [\n${preflight}\n  { name: "x", cmd: ["node", "scripts/other.mjs"] },\n];\n`);
    writeFileSync(join(root, ".github", "workflows", "ci.yml"), `jobs:\n  a:\n    steps:\n      - run: echo hi\n${workflow}`);
    writeFileSync(join(root, "package.json"), "{}");
    void marker;
    return root;
  };
  const self = (root) => spawnSync(process.execPath, [SELF_FILE, "--root", root, "--floor", "1"], { encoding: "utf8", timeout: 60_000, killSignal: "SIGKILL" });
  const note = (name, ok, detail = "") => checks.push([name, ok, detail]);

  try {
    // RED 1 — unregistered gate whose --self-test exits 1.
    let r = self(mkTree("red1", { "check-bad.mjs": BAD_ST }));
    note("RED: an unregistered gate whose --self-test exits 1 fails the gate and is named", r.status === 1 && /check-bad\.mjs/.test(r.stderr + r.stdout), `exit ${r.status}`);
    // RED 2 — unregistered gate whose flag is a no-op that just runs the real check.
    r = self(mkTree("red2", { "check-noop.mjs": NOOP_ST }));
    note("RED: an unregistered gate whose --self-test is a no-op (exit 0, prints nothing self-test-shaped) fails", r.status === 1 && /check-noop\.mjs/.test(r.stderr + r.stdout) && /no-op/.test(r.stderr + r.stdout), `exit ${r.status}`);
    // RED 3 — flag-less gate whose only "control" is in a comment.
    r = self(mkTree("red3", { "check-nocontrol.mjs": `// self-test planted control: see elsewhere\n/* controls live in another file */\nconsole.log("real check ok");\n` }));
    note("RED: a flag-less gate whose only control sits in a comment fails", r.status === 1 && /check-nocontrol\.mjs/.test(r.stderr + r.stdout), `exit ${r.status}`);
    // GREEN 1 — a registered gate must NOT be spawned (its handler would fail and leave a marker).
    const markerDir = join(tmp, "green1-marker");
    const trap = `import { writeFileSync } from "node:fs";\nif (process.argv.includes("--self-test")) { writeFileSync(${JSON.stringify(markerDir)}, "spawned"); console.log("self-test FAILED"); process.exit(1); }\n`;
    r = self(mkTree("green1", { "check-reg.mjs": trap }, { preflight: `  { name: "r", cmd: ["node", "scripts/check-reg.mjs", "--self-test"] },` }));
    note("GREEN: a gate a preflight step runs with --self-test passes and is NOT spawned", r.status === 0 && !existsSync(markerDir), `exit ${r.status}, marker ${existsSync(markerDir) ? "PRESENT" : "absent"}`);
    // GREEN 1b — same via a workflow run: line.
    const markerWf = join(tmp, "green1b-marker");
    const trapWf = trap.replace(JSON.stringify(markerDir), JSON.stringify(markerWf));
    r = self(mkTree("green1b", { "check-regwf.mjs": trapWf }, { workflow: `      - name: s\n        run: node scripts/check-regwf.mjs --self-test\n` }));
    note("GREEN: a gate a workflow run: line runs with --self-test passes and is NOT spawned", r.status === 0 && !existsSync(markerWf), `exit ${r.status}`);
    // GREEN 2 — a flag-less gate with a real control on a code line.
    r = self(mkTree("green2", { "check-ctl.mjs": `const planted = "bad";\nif (!planted) process.exit(1);\nconsole.log("real check ok");\n` }));
    note("GREEN: a flag-less gate with a control on a code line passes", r.status === 0, `exit ${r.status}`);
    // GREEN 3 — an unregistered gate with a good self-test is spawned and credited.
    r = self(mkTree("green3", { "check-good.mjs": GOOD_ST }));
    note("GREEN: an unregistered gate whose --self-test exits 0 and names itself passes (and is spawned)", r.status === 0 && /1 run by this gate \(1 passed\)/.test(r.stdout), `exit ${r.status}`);
    // MUTANT-SENSITIVE: a commented-out and a name-only registration must not register.
    r = self(mkTree("red4", { "check-bad2.mjs": BAD_ST }, {
      preflight: `  // { name: "r", cmd: ["node", "scripts/check-bad2.mjs", "--self-test"] },`,
      workflow: `      - name: node scripts/check-bad2.mjs --self-test\n        run: echo nothing\n      # run: node scripts/check-bad2.mjs --self-test\n`,
    }));
    note("RED: a commented-out preflight step, a workflow name: line and a YAML comment register nothing", r.status === 1 && /check-bad2\.mjs/.test(r.stderr + r.stdout), `exit ${r.status}`);
    // FLOOR: fewer gates than the floor fails.
    const floorRoot = mkTree("red5", { "check-good.mjs": GOOD_ST });
    r = spawnSync(process.execPath, [SELF_FILE, "--root", floorRoot, "--floor", "5"], { encoding: "utf8", timeout: 60_000 });
    note("RED: fewer gates than the floor fails (a walker that finds nothing is broken)", r.status === 1 && /floor/.test(r.stderr + r.stdout), `exit ${r.status}`);
    // PURE: the comment-stripping control and the spawn-credit rule, direct.
    note("pure: a control only in a comment is not a control", !namesControl("// planted\n/* self-test */\nconst a = 1;"));
    note("pure: a control on a code line is", namesControl('const planted = "x";'));
    note("pure: a commented-out handler is not a handler", !hasHandler('// if (argv.includes("--self-test"))\nconst a = 1;'));
    note("pure: exit 1 earns no credit", !spawnCredit({ status: 1, stdout: "self-test" }).ok);
    note("pure: exit 0 with silent stdout earns no credit", !spawnCredit({ status: 0, stdout: "all ok" }).ok);
    note("pure: a timeout (status null) earns no credit", !spawnCredit({ status: null, signal: "SIGKILL", stdout: "self-test" }).ok);
    note("pure: exit 0 naming a self-test earns credit", spawnCredit({ status: 0, stdout: "self-test passed" }).ok);
    // LIVE: the detector still finds the real tree's gates.
    const live = runGate(REPO, { spawn: () => ({ status: 0, stdout: "self-test" }) });
    note("live: the real tree yields at least the floor of gates", live.counts.gates >= DEFAULT_FLOOR, `${live.counts.gates} gates`);
    note("live: the real tree has registered self-tests (the registration scan reads preflight and the workflows)", live.counts.registered >= 50, `${live.counts.registered} registered`);
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
