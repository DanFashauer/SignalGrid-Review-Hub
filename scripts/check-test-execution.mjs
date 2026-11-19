// Test-execution gate — a test file that no runner reaches is not coverage.
//
// WHY THIS EXISTS. The org sweep found ten test-shaped files in this repository
// that nothing executes. Eight of them (`tests/security-reference/*.test.ts`)
// encoded real security invariants — replay, rate limiting, secret redaction,
// webhook signing, admin-auth hardening, fail-closed fallbacks, step-up,
// WebAuthn request identity — and never ran once here. They were Vitest specs,
// no Vitest is installed, `tests/` sits outside the pnpm workspace, and they
// addressed a DEV Next.js server (`/api/session/start`, `/api/health`, started
// with `bun`) whose endpoints do not exist in this monorepo.
//
// THAT DIRECTORY IS GONE (2026-09-02) — retired the way this gate always said it
// should be, by porting rather than deleting. Seven of the eight invariants are
// now held and EXECUTED on the live surface: the auth boundary, wire-level secret
// redaction, replay/idempotency, rate limiting and step-up/WebAuthn fail-closed in
// `artifacts/api-server/test/api.test.mjs`; webhook signing and the missing-secret
// refusal in `scripts/src/webhooks-proof.ts`. The eighth (`checkApiKey` /
// `ADMIN_API_KEY`) was unportable — neither symbol exists anywhere in this tree —
// so it was deleted rather than carried as a debt.
//
// The disclaimer being honest is exactly why a gate is needed. An unexecuted
// test is the most expensive kind of false assurance: it looks like coverage in
// a directory listing, it gets counted in a plan row, and it reports nothing.
// The README that tells the truth today is prose, and prose does not fail a
// build. Nothing prevented those eight from being written and never run, and
// nothing prevents the eleventh.
//
// WHAT IS GATED. Every test-shaped file is either REACHED by a runner this
// repository actually invokes, or carries a DECLARED entry below with a reason.
// The declaration is the point: an unexecuted test is allowed to exist, but only
// as a deliberate, written-down decision that a reader can audit — never as an
// accident nobody noticed.
//
// REACHABILITY IS DERIVED, NOT LISTED. The runner set is computed transitively
// from the three entry points that actually run — `scripts/preflight.mjs`, the
// CI workflows, and `validate-sim-macos.sh` — by expanding the package scripts
// they invoke, then the scripts those invoke. A hand-maintained list of "things
// that run" would be a fossil the day someone renames a script, and the failure
// mode of that fossil is the gate going quietly green about nothing.
//
// FAIL-CLOSED. A test file whose reachability cannot be resolved is reported as
// a PROBLEM, not waved through. Unknown never means fine here, the same way an
// unknown signal never lowers assurance in the decision core.
//
// WHAT THIS DELIBERATELY DOES NOT COVER, said out loud rather than left to be
// discovered: the k6 scripts in `tests/load/` are also invoked by nothing, and
// they do not match TEST_FILE because they are not named `*.test.js`. They are
// load drivers pointed at a running URL, not assertions about this codebase, and
// widening the pattern to catch them would pull in every `.js` under a directory
// called tests. They are recorded as open in docs/COMPANY_BUILD_PLAN.md row 43
// instead. A gate that quietly skips something is worse than one that says so.
//
// SELF-TEST: the corpus must be non-trivial, a known-reached file must resolve
// as reached, and a synthetic unreached file must be flagged. A gate that cannot
// fail proves nothing.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { allowlistRefusal } from "./check-local-build-regressions.mjs";
import { SCRATCH_GIT_SCRUB } from "./lib/scratch-git.mjs";
import { SEP, ENV, maskQuoted, runCommands, stripYamlComments } from "./lib/workflow-invocation.mjs";

const ENTRY_FILES = ["scripts/preflight.mjs", "validate-sim-macos.sh"];
const WORKFLOW_DIR = ".github/workflows";
const TEST_FILE = /\.(test|spec)\.(ts|mts|mjs|js|tsx)$/;
// .claude/worktrees holds agent checkouts that git excludes (.git/info/exclude);
// a spec found there belongs to another commit and reached this walk only
// because the walk reads the filesystem, not the index.
const SKIP_DIR = /(^|\/)(node_modules|dist|build|\.git|coverage|\.claude\/worktrees)(\/|$)/;

// An unexecuted test file may exist ONLY with a reason and a named disposition.
// Empty is the goal state — and it is empty now: the one prior entry,
// artifacts/mcp-server/test/server.test.ts, was WIRED UP (preflight +
// review-hub-ci.yml, `pnpm --filter @workspace/mcp-server run test`) rather than
// folded-and-deleted, so it is reached by a runner and no longer needs a
// declaration. The disposition it named ("fold the unique assertions into the
// proof, then delete the orphan") is superseded: the test carries wire-visible
// annotation coverage the proofs do not, so it earns its keep as an executed test.
const DECLARED_UNEXECUTED = new Map([
  [
    ".claude/skills/node/rules/assets/graceful-server.test.ts",
    "VENDORED EXAMPLE, not a test of this repository. mcollina/skills@856efd26, MIT © 2026 " +
      "Matteo Collina, byte-identical (.claude/skills/VENDORED.md). It is an ASSET the `node` " +
      "skill quotes to show what a graceful-shutdown test looks like — the skill's rules " +
      "reference it as sample text, nothing imports it, and it exercises node:http rather than " +
      "anything in this tree. It is not wired to a runner because running it would assert " +
      "nothing about SignalGrid; it is not deleted because a vendored directory is held " +
      "byte-identical and editing one to satisfy a gate is the move this repository does not " +
      "make. DISPOSITION: it retires with the skill — a re-vendor that drops `node/` or an " +
      "upstream that moves the asset removes this key, and the stale-declaration check below " +
      "then fails until it is deleted.",
  ],
]);

// ── build the corpus of everything the repository actually runs ──────────────
function readIfExists(p) {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

const packageJsons = [];
const walkPkgs = (d) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (SKIP_DIR.test(p)) continue;
    if (statSync(p).isDirectory()) walkPkgs(p);
    else if (e === "package.json") packageJsons.push(p);
  }
};
walkPkgs(".");

const scriptsByName = new Map(); // "name" -> [body, …] across all packages
for (const pj of packageJsons) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(pj, "utf8"));
  } catch {
    continue;
  }
  for (const [name, body] of Object.entries(parsed.scripts ?? {})) {
    if (!scriptsByName.has(name)) scriptsByName.set(name, []);
    scriptsByName.get(name).push(String(body));
  }
}

const seedTexts = [];
for (const f of ENTRY_FILES) seedTexts.push(readIfExists(f));
if (existsSync(WORKFLOW_DIR)) {
  for (const e of readdirSync(WORKFLOW_DIR)) {
    if (/\.ya?ml$/.test(e)) seedTexts.push(readIfExists(join(WORKFLOW_DIR, e)));
  }
}

// Transitively expand: a reached text invokes script names; those bodies are
// themselves reached and may invoke more. Bounded by the script set, so it
// terminates.
const reachedScriptNames = new Set();
const corpusParts = [...seedTexts];
const invocationsIn = (text) => {
  const names = new Set();
  const pats = [
    /pnpm\s+(?:run\s+)?([a-z0-9:_-]+)/gi,
    /pnpm\s+--filter\s+\S+\s+run\s+([a-z0-9:_-]+)/gi,
    /npm\s+run\s+([a-z0-9:_-]+)/gi,
    /pnpm\s+-r\s+run\s+([a-z0-9:_-]+)/gi,
  ];
  for (const re of pats) for (const m of text.matchAll(re)) names.add(m[1]);
  return names;
};
let frontier = new Set();
for (const t of seedTexts) for (const n of invocationsIn(t)) frontier.add(n);
while (frontier.size > 0) {
  const next = new Set();
  for (const name of frontier) {
    if (reachedScriptNames.has(name)) continue;
    reachedScriptNames.add(name);
    for (const body of scriptsByName.get(name) ?? []) {
      corpusParts.push(body);
      for (const n of invocationsIn(body)) if (!reachedScriptNames.has(n)) next.add(n);
    }
  }
  frontier = next;
}
const CORPUS = corpusParts.join("\n");

// Playwright contributes a whole directory rather than named files.
let playwrightDirs = [];
for (const cfg of ["playwright.config.ts", "scripts/playwright.config.ts"]) {
  const body = readIfExists(cfg);
  if (!body) continue;
  const reachesPlaywright = /playwright/i.test(CORPUS);
  for (const m of body.matchAll(/testDir:\s*["'`]([^"'`]+)["'`]/g)) {
    if (reachesPlaywright) {
      playwrightDirs.push(join(cfg.includes("/") ? cfg.split("/")[0] : ".", m[1].replace(/^\.\//, "")));
    }
  }
}

// The shared build-regression runner's --suite mode runs EVERY tracked allowlisted test under one
// directory on every invocation (scripts/check-local-build-regressions.mjs). A directory contributes
// its allowlisted files ONLY through an actual executable registration, never through prose:
//   * a live `scripts/preflight.mjs` step whose cmd array is exactly
//     ["node", "scripts/check-local-build-regressions.mjs", "--suite", "<dir>"] (a `//` line is dead);
//   * a workflow `run:` command, judged by the SAME matcher the parity gates use
//     (lib/workflow-invocation.mjs: comments stripped, quotes masked, command position only, so a
//     `# comment`, an `echo node …`, a `name:` label or a continue-on-error step credits nothing),
//     whose argument list is exactly `--suite <dir>`.
// The operand must be one well-formed directory under scripts/ or lib/; a missing, extra, quoted or
// malformed operand credits nothing. Only files the runner would execute count: its own allowlist
// decides, imported rather than restated.
const SUITE_RUNNER = "scripts/check-local-build-regressions.mjs";
const SUITE_DIR_RE = /^(?:scripts|lib)(?:\/[A-Za-z0-9_][A-Za-z0-9._-]*)*$/;
const suiteDirsFromPreflight = (text) => {
  const dirs = new Set();
  const re = /^[ \t]*\{[^\n]*?\bcmd:[ \t]*\[[ \t]*"node"[ \t]*,[ \t]*"scripts\/check-local-build-regressions\.mjs"[ \t]*,[ \t]*"--suite"[ \t]*,[ \t]*"([^"\n]*)"[ \t]*\]/gm;
  for (const m of text.matchAll(re)) if (SUITE_DIR_RE.test(m[1])) dirs.add(m[1]);
  return [...dirs];
};
const suiteDirsFromWorkflow = (rawText) => {
  const dirs = new Set();
  const commands = runCommands(stripYamlComments(rawText)).map(maskQuoted).join("\n");
  const re = new RegExp(`${SEP}${ENV}node[ \\t]+${SUITE_RUNNER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}((?:[ \\t]+[^\\s;&|()]+)*)`, "gm");
  for (const m of commands.matchAll(re)) {
    const args = m[1].split(/\s+/).filter(Boolean);
    if (args.length === 2 && args[0] === "--suite" && SUITE_DIR_RE.test(args[1])) dirs.add(args[1]);
  }
  return [...dirs];
};
const suiteDirsFrom = ({ preflight = "", workflows = [] }) =>
  [...new Set([...suiteDirsFromPreflight(preflight), ...workflows.flatMap(suiteDirsFromWorkflow)])];
// The suite runs TRACKED files only, enumerated by the runner's own git(root, args): cwd = the repo
// root, every SCRATCH_GIT_SCRUB key removed. This checker enumerates under the SAME custody, so an
// inherited GIT_DIR / GIT_INDEX_FILE / GIT_WORK_TREE cannot credit a file from another repository or
// index that the real suite would never run. If git cannot answer, nothing is credited through
// --suite (fail-closed: unknown never means reached).
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const trackedFilesIn = (root, baseEnv = process.env) => {
  const env = { ...baseEnv };
  for (const k of SCRATCH_GIT_SCRUB) delete env[k];
  const r = spawnSync("git", ["ls-files", "-z"], { cwd: root, env, shell: false, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 && !r.error ? new Set(r.stdout.split("\0").filter(Boolean)) : new Set();
};
const trackedFiles = trackedFilesIn(REPO_ROOT);
const suiteReaches = (file, dirs, tracked = trackedFiles) =>
  dirs.some((d) => file.startsWith(`${d}/`)) && allowlistRefusal(file) === null && tracked.has(file);
const workflowTexts = existsSync(WORKFLOW_DIR)
  ? readdirSync(WORKFLOW_DIR).filter((e) => /\.ya?ml$/.test(e)).map((e) => readIfExists(join(WORKFLOW_DIR, e)))
  : [];
const suiteDirs = suiteDirsFrom({ preflight: readIfExists("scripts/preflight.mjs"), workflows: workflowTexts });

// ── enumerate test-shaped files ──────────────────────────────────────────────
const testFiles = [];
const walkTests = (d) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (SKIP_DIR.test(p)) continue;
    if (statSync(p).isDirectory()) walkTests(p);
    else if (TEST_FILE.test(e)) testFiles.push(p.replace(/^\.\//, ""));
  }
};
walkTests(".");

function reaches(file) {
  const base = file.split("/").pop();
  if (CORPUS.includes(file)) return "path named by a runner";
  // path relative to its owning package (scripts run with that cwd)
  const parts = file.split("/");
  for (let i = 1; i < parts.length; i += 1) {
    const rel = parts.slice(i).join("/");
    if (rel !== base && CORPUS.includes(rel)) return `package-relative path (${rel})`;
  }
  for (const dir of playwrightDirs) if (file.startsWith(dir.replace(/^\.\//, ""))) return "playwright testDir";
  if (suiteReaches(file, suiteDirs)) return "shared runner --suite directory";
  if (CORPUS.includes(base)) return `basename (${base})`;
  return null;
}

const declarationFor = (file) => {
  for (const [key, reason] of DECLARED_UNEXECUTED) {
    if (key.endsWith("/") ? file.startsWith(key) : file === key) return { key, reason };
  }
  return null;
};

// Which declared keys match NOTHING in a given corpus — the reverse of
// `declarationFor`, and the direction this gate never checked.
//
// The header above has always said a stale declaration is fatal, and the
// security-reference entry said porting the last spec "deletes this entry, which
// this gate then enforces because a stale exemption fails". NEITHER WAS TRUE until
// now: resolution only ever ran file → declaration, so a key pointing at a
// directory that had been emptied or renamed was never looked at again. Measured on
// 2026-09-02 by removing tests/security-reference/ and re-running: the gate printed
// `0 problem(s)` and exited 0 over a dead exemption.
//
// That is this file's own defect class, one level up. An unexecuted test is false
// assurance about code; a stale exemption is false assurance about the gate — it
// reads as "someone decided this deliberately" long after the thing decided about is
// gone, and it is the line a reader trusts INSTEAD of looking.
//
// Takes its corpus and its declarations as arguments so the self-test below can run
// it against a synthetic pair. First key wins, exactly as `declarationFor` resolves,
// so a key is never called stale for a file another key absorbed.
const staleKeys = (files, decls) => {
  const matched = new Set();
  for (const file of files) {
    for (const [key] of decls) {
      if (key.endsWith("/") ? file.startsWith(key) : file === key) {
        matched.add(key);
        break;
      }
    }
  }
  return [...decls.keys()].filter((k) => !matched.has(k));
};

// ── self-test ────────────────────────────────────────────────────────────────
{
  const FILE_FLOOR = 5;
  const SCRIPT_FLOOR = 10;
  const knownReached = testFiles.find((f) => f.includes("api-server/test/api.test.mjs"));
  const positive = knownReached ? reaches(knownReached) !== null : false;
  const negative = reaches("nowhere/definitely-not-invoked.test.ts") === null;
  // The stale-exemption detector, driven both ways against a synthetic corpus. A
  // detector that cannot fire would let every dead key through in silence, which is
  // precisely the state this check was added to end.
  const stalePositive = staleKeys(["a/b.test.ts"], new Map([["gone/", "r"]])).join() === "gone/";
  const staleNegative = staleKeys(["a/b.test.ts"], new Map([["a/", "r"]])).length === 0;
  // The --suite contribution, both ways. Positive: a live preflight cmd and a workflow `run:` each
  // register their directory, and a tracked allowlisted file under it is reached. Negative: nothing
  // that does not EXECUTE the suite registers anything (comment, echo, name label, dead `//` preflight
  // line, other script), a missing/extra/quoted/malformed operand registers nothing, and inside a
  // registered directory a sibling, a .ts file, a non-boundary prefix and an untracked file stay unreached.
  const PF = '  { name: "s", cmd: ["node", "scripts/check-local-build-regressions.mjs", "--suite", "scripts/x/test"] },';
  const WF = "jobs:\n  a:\n    steps:\n      - name: s\n        run: node scripts/check-local-build-regressions.mjs --suite scripts/y/test\n";
  const wf = (line) => `jobs:\n  a:\n    steps:\n      - name: s\n        ${line}\n`;
  const sd = suiteDirsFrom({ preflight: PF, workflows: [WF] });
  const tr = new Set(["scripts/x/test/a.test.mjs", "scripts/y/test/b.test.mjs", "scripts/x/other/a.test.mjs", "scripts/x/test/a.test.ts", "scripts/x/testing/a.test.mjs"]);
  const suitePositive =
    sd.slice().sort().join() === "scripts/x/test,scripts/y/test" &&
    suiteReaches("scripts/x/test/a.test.mjs", sd, tr) &&
    suiteReaches("scripts/y/test/b.test.mjs", sd, tr);
  const none = (o) => suiteDirsFrom(o).length === 0;
  const suiteNegative =
    none({ workflows: [wf("# run: node scripts/check-local-build-regressions.mjs --suite scripts/x/test")] }) &&
    none({ workflows: [wf("run: echo node scripts/check-local-build-regressions.mjs --suite scripts/x/test")] }) &&
    none({ workflows: [wf("run: true # node scripts/check-local-build-regressions.mjs --suite scripts/x/test")] }) &&
    none({ workflows: ["jobs:\n  a:\n    steps:\n      - name: node scripts/check-local-build-regressions.mjs --suite scripts/x/test\n        run: true\n"] }) &&
    none({ workflows: [wf("run: node scripts/check-local-build-regressions.mjs --suite")] }) &&
    none({ workflows: [wf("run: node scripts/check-local-build-regressions.mjs --suite scripts/x/test extra")] }) &&
    none({ workflows: [wf("run: node scripts/check-local-build-regressions.mjs --suite ../x/test")] }) &&
    none({ workflows: [wf('run: node scripts/check-local-build-regressions.mjs --suite "scripts/x/test"')] }) &&
    none({ workflows: [wf("run: node scripts/other.mjs --suite scripts/x/test")] }) &&
    none({ preflight: '  // { name: "s", cmd: ["node", "scripts/check-local-build-regressions.mjs", "--suite", "scripts/x/test"] },' }) &&
    none({ preflight: '  { name: "s", cmd: ["node", "scripts/check-local-build-regressions.mjs", "--suite", "scripts/x/test", "x"] },' }) &&
    none({ preflight: '  { name: "s", cmd: ["node", "scripts/check-local-build-regressions.mjs", "--suite", "../etc"] },' }) &&
    none({ preflight: '  { name: "s", cmd: ["node", "scripts/check-local-build-regressions.mjs", "--suite"] },' }) &&
    none({ preflight: '  // node scripts/check-local-build-regressions.mjs --suite scripts/x/test' }) &&
    none({}) &&
    !suiteReaches("scripts/x/test/untracked.test.mjs", sd, tr) &&
    !suiteReaches("scripts/x/other/a.test.mjs", sd, tr) &&
    !suiteReaches("scripts/x/test/a.test.ts", sd, tr) &&
    !suiteReaches("scripts/x/testing/a.test.mjs", sd, tr);
  // Same custody as the runner: inherited repository/index overrides change nothing.
  const overridden = trackedFilesIn(REPO_ROOT, {
    ...process.env,
    GIT_DIR: join(REPO_ROOT, "nonexistent-git-dir"),
    GIT_INDEX_FILE: join(REPO_ROOT, "nonexistent-index"),
    GIT_WORK_TREE: join(REPO_ROOT, "nonexistent-tree"),
  });
  const suiteCustody =
    trackedFiles.size > 0 &&
    overridden.size === trackedFiles.size &&
    [...trackedFiles].every((f) => overridden.has(f));
  if (
    testFiles.length < FILE_FLOOR ||
    reachedScriptNames.size < SCRIPT_FLOOR ||
    !knownReached ||
    !positive ||
    !negative ||
    !stalePositive ||
    !staleNegative ||
    !suitePositive ||
    !suiteNegative ||
    !suiteCustody
  ) {
    console.error(
      "✗ SELF-TEST FAILED — " +
        `testFiles=${testFiles.length} (floor ${FILE_FLOOR}), reachedScripts=${reachedScriptNames.size} ` +
        `(floor ${SCRIPT_FLOOR}), knownReached=${knownReached ?? "(none found)"}, positive=${positive}, ` +
        `negative=${negative}, stalePositive=${stalePositive}, staleNegative=${staleNegative}, ` +
        `suitePositive=${suitePositive}, suiteNegative=${suiteNegative}, suiteCustody=${suiteCustody}. ` +
        "The reachability derivation has drifted from how this repo invokes tests; " +
        "a gate that resolves nothing is green about nothing.",
    );
    process.exit(1);
  }
}

console.log("Test execution — a test no runner reaches is not coverage\n");
let problems = 0;
let reachedCount = 0;
let declaredCount = 0;

for (const file of testFiles.sort()) {
  const how = reaches(file);
  const declared = declarationFor(file);
  if (how) {
    reachedCount += 1;
    if (declared) {
      console.error(
        `  ✗ ${file}: now REACHED by a runner (${how}), but still carries a declared-unexecuted entry ` +
          `"${declared.key}" — remove the exemption, it has outlived its reason`,
      );
      problems += 1;
    }
    continue;
  }
  if (declared) {
    declaredCount += 1;
    console.log(`  · ${file}: DECLARED unexecuted — ${declared.reason.slice(0, 80)}…`);
    continue;
  }
  console.error(
    `  ✗ ${file}: NO runner reaches this file. It is not coverage, and a directory listing cannot tell.\n` +
      "      Wire it to a script preflight or CI runs, delete it, or declare it in\n" +
      "      DECLARED_UNEXECUTED with the reason and the disposition that retires it.",
  );
  problems += 1;
}

for (const key of staleKeys(testFiles, DECLARED_UNEXECUTED)) {
  console.error(
    `  ✗ DECLARED_UNEXECUTED key "${key}" matches no test file in the corpus. The exemption has\n` +
      "      outlived the thing it exempted — delete the entry. A declaration nobody can reach is a\n" +
      "      reason a reader trusts instead of looking.",
  );
  problems += 1;
}

console.log(
  `\ntest-execution: ${testFiles.length} test files, ${reachedCount} reached, ${declaredCount} declared unexecuted, ` +
    `${problems} problem(s); ${reachedScriptNames.size} scripts reached transitively from ${ENTRY_FILES.length} entry ` +
    "points + the CI workflows; self-test green",
);
if (problems > 0) {
  console.error("\nTest-execution gate FAILED — an unexecuted test is false assurance wearing a test's name.");
  process.exit(1);
}
console.log("Test-execution gate passed — every test file is run, or declared with a reason.");
