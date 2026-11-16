// Self-test for the verify-all untracked-path predicate (plan row 61).
//
//   node scripts/check-untracked-ignore.mjs --self-test
//
// An untracked lockfile (uv.lock, poetry.lock, ...) changes the resolved MCP dependencies,
// so it must count as untracked SOURCE and mark live evidence dirty. Scratch (.venv/,
// node_modules/, __pycache__/, dist/ ...) must stay ignored. The self-test also plants two
// mutants of the pattern and proves each turns the checks red.
import { IGNORED_UNTRACKED, isIgnoredUntracked } from "./lib/untracked-ignore.mjs";

const SOURCE_PATHS = ["uv.lock", "poetry.lock", "mcp/Pipfile.lock", "mcp/new_module.py", "mcp/tests/test_new.py"];
const SCRATCH_PATHS = [".venv/lib/x.py", "mcp/.venv/bin/python", "node_modules/a/index.js", "mcp/__pycache__/m.pyc", "dist/bundle.js", "pkg/dist/x.js", "build/out.o", ".DS_Store", "mcp/foo.egg-info/PKG-INFO"];

function failures(pred) {
  return [
    ...SOURCE_PATHS.filter((p) => pred(p)).map((p) => `untracked source ignored: ${p}`),
    ...SCRATCH_PATHS.filter((p) => !pred(p)).map((p) => `scratch counted as source: ${p}`),
  ];
}

if (!process.argv.includes("--self-test")) {
  console.error("usage: check-untracked-ignore.mjs --self-test");
  process.exit(2);
}

const real = failures(isIgnoredUntracked);
const lockArm = new RegExp(IGNORED_UNTRACKED.source + "|\\.lock$");            // mutant 1: the old \.lock$ arm back
const noNodeModules = new RegExp(IGNORED_UNTRACKED.source.replace("node_modules|", "")); // mutant 2: a scratch arm dropped
const m1 = failures((p) => lockArm.test(p));
const m2 = failures((p) => noNodeModules.test(p));

// Malformed input (a separate check; the string fixtures above are unchanged): a non-string
// is never ignored, and no coercion hook runs. An object mimicking a scratch path would be
// ignored if the predicate coerced it.
let hookCalls = 0;
const hostile = {
  toString() { hookCalls++; throw new Error("toString invoked"); },
  valueOf() { hookCalls++; throw new Error("valueOf invoked"); },
  [Symbol.toPrimitive]() { hookCalls++; throw new Error("toPrimitive invoked"); },
};
const MALFORMED = [undefined, null, 0, true, 12n, Symbol("node_modules"), ["node_modules/a.js"], { toString: () => "node_modules/hidden.js" }, new String("node_modules/hidden.js"), hostile];
const malformed = [];
for (const v of MALFORMED) {
  let out;
  try { out = isIgnoredUntracked(v); } catch (e) { out = `threw ${e?.name ?? "value"}`; }
  if (out !== false) malformed.push(`${typeof v} → ${String(out)}`);
}
if (hookCalls !== 0) malformed.push(`coercion hook invoked ${hookCalls}x`);

const checks = [
  ["real predicate: lockfiles and new source count, scratch is ignored", real.length === 0, real],
  ["mutant 1 (\\.lock$ arm present) turns red", m1.length > 0, m1],
  ["mutant 2 (node_modules arm dropped) turns red", m2.length > 0, m2],
  ["malformed input: every non-string is not ignored and no coercion hook runs", malformed.length === 0, malformed],
];
let bad = 0;
for (const [name, ok, detail] of checks) {
  if (!ok) bad++;
  console.log(`  ${ok ? "ok" : "FAIL"} — ${name}${!ok && detail.length ? ` (${detail.join("; ")})` : ""}`);
}
console.log(`\nself-test ${bad === 0 ? "passed" : "FAILED"} (${checks.length - bad}/${checks.length})`);
process.exit(bad === 0 ? 0 : 1);
