// Test-execution gate — a test file that no runner reaches is not coverage.
//
// WHY THIS EXISTS. The org sweep found ten test-shaped files in this repository
// that nothing executes. Eight of them (`tests/security-reference/*.test.ts`)
// encode real security invariants — replay, rate limiting, secret redaction,
// webhook signing, admin-auth hardening, fail-closed fallbacks, step-up,
// WebAuthn request identity — and they have never run once here. They are
// Vitest specs, no Vitest is installed, `tests/` sits outside the pnpm
// workspace, and they address a DEV Next.js server (`/api/session/start`,
// `/api/health`, started with `bun`) whose endpoints do not exist in this
// monorepo. Their own README says so plainly.
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
import { join } from "node:path";

const ENTRY_FILES = ["scripts/preflight.mjs", "validate-sim-macos.sh"];
const WORKFLOW_DIR = ".github/workflows";
const TEST_FILE = /\.(test|spec)\.(ts|mts|mjs|js|tsx)$/;
const SKIP_DIR = /(^|\/)(node_modules|dist|build|\.git|coverage)(\/|$)/;

// An unexecuted test file may exist ONLY with a reason and a named disposition.
// Empty is the goal state.
const DECLARED_UNEXECUTED = new Map([
  [
    "tests/security-reference/",
    "Org sweep 2026-08-23 + this directory's own README: eight Vitest specs harvested " +
      "from the retired DEV Next.js build. They target that server's endpoints " +
      "(/api/session/start, /api/health, badgeUid, `bun run scripts/test-server.ts`), " +
      "none of which exist on this monorepo's /v1 surface, and one of them tests step-up " +
      "enforcement — a DEFERRED family, so there is no shipping surface to test yet. " +
      "They are kept as reference to PORT, not as coverage, and they are counted as " +
      "coverage nowhere. Porting each onto /v1 retires its line here; the last line out " +
      "deletes this entry, which this gate then enforces because a stale exemption fails.",
  ],
  [
    "artifacts/mcp-server/test/server.test.ts",
    "Org sweep 2026-08-23: the package declares `test: tsx --test test/server.test.ts`, " +
      "but no root script, preflight gate, workflow or validate-sim-macos.sh line invokes " +
      "it, so the declaration is unreachable from anything that runs. `proof:mcp-server` " +
      "covers this surface from a DIFFERENT file (scripts/src/mcp-server-proof.ts) and IS " +
      "gated. Disposition: fold the unique assertions into the proof, then delete the " +
      "orphan — tracked in docs/COMPANY_BUILD_PLAN.md row 43.",
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
  if (CORPUS.includes(base)) return `basename (${base})`;
  return null;
}

const declarationFor = (file) => {
  for (const [key, reason] of DECLARED_UNEXECUTED) {
    if (key.endsWith("/") ? file.startsWith(key) : file === key) return { key, reason };
  }
  return null;
};

// ── self-test ────────────────────────────────────────────────────────────────
{
  const FILE_FLOOR = 5;
  const SCRIPT_FLOOR = 10;
  const knownReached = testFiles.find((f) => f.includes("api-server/test/api.test.mjs"));
  const positive = knownReached ? reaches(knownReached) !== null : false;
  const negative = reaches("nowhere/definitely-not-invoked.test.ts") === null;
  if (
    testFiles.length < FILE_FLOOR ||
    reachedScriptNames.size < SCRIPT_FLOOR ||
    !knownReached ||
    !positive ||
    !negative
  ) {
    console.error(
      "✗ SELF-TEST FAILED — " +
        `testFiles=${testFiles.length} (floor ${FILE_FLOOR}), reachedScripts=${reachedScriptNames.size} ` +
        `(floor ${SCRIPT_FLOOR}), knownReached=${knownReached ?? "(none found)"}, positive=${positive}, ` +
        `negative=${negative}. The reachability derivation has drifted from how this repo invokes tests; ` +
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
