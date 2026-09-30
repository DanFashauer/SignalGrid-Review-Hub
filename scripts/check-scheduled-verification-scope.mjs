// The daily rot check runs preflight whole — never a hand-picked list of gates.
//
//   node scripts/check-scheduled-verification-scope.mjs
//   node scripts/check-scheduled-verification-scope.mjs --self-test
//
// WHY THIS EXISTS (docs/COMPANY_BUILD_PLAN.md row 171). `.github/workflows/scheduled-verification.yml`
// is the only thing watching the default branch BETWEEN pull requests. Its verify job
// ran about ten named proofs — a tenth of what `scripts/preflight.mjs` registers — while
// its header first called that "the full deterministic gate suite" and, once corrected,
// admitted the selection was hand-picked. Every gate registered in preflight afterwards
// was invisible to the nightly run, including the time- and externally-dependent gates
// that are exactly the ones able to go red without a commit.
//
// The fix makes the selection preflight's STEPS by running preflight itself. This gate
// holds that shape. In the verify job it fails on:
//   - no step running `node scripts/preflight.mjs` in full mode (`--quick` skips the
//     heavy builds, which is another hand-picked subset);
//   - any `run:` step that is not setup/install, preflight or the breadth lane — a gate
//     invoked by name here is a hand-picked list growing back;
//   - the preflight step not handing GITHUB_TOKEN over, or the workflow not granting
//     `actions: read`: `check-ci-liveness.mjs` is FATAL in CI without both, so the
//     nightly job would fail every morning and teach everyone to ignore its issue;
//   - a header that does not name `scripts/preflight.mjs` as what it runs.
// It parses the job by indentation rather than with a YAML library (none is a
// dependency here); the self-test plants each defect in a copy of the real file.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = ".github/workflows/scheduled-verification.yml";
const JOB = "verify";

// Commands that set the job up rather than check anything. Anything else in a `run:`
// is a gate, and the only gates this job may name are preflight and the breadth lane
// (its own CI job with its own registry, scripts/verify-breadth.mjs — not in preflight).
const SETUP = [
  /^pnpm install --frozen-lockfile$/,
  /^sudo apt-get (update|install)\b/,
  /playwright install(-deps)? chromium/,
  /^(ok=|for |if |fi$|done$|echo |sleep |exit |\|\||ok=1; break|else$|then$)/,
];
const ALLOWED_GATES = [/^node scripts\/preflight\.mjs$/, /^pnpm run verify:breadth$/];

/** Split the verify job into steps: [{ name, run, env }]. */
export function jobSteps(text, job = JOB) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l === `  ${job}:`);
  if (start === -1) return null;
  let end = lines.findIndex((l, i) => i > start && /^  [A-Za-z0-9_-]+:\s*$/.test(l));
  if (end === -1) end = lines.length;
  const body = lines.slice(start + 1, end);
  const steps = [];
  let cur = null;
  let inRun = false;
  let runIndent = 0;
  for (const l of body) {
    const m = l.match(/^      - (.*)$/);
    if (m) {
      cur = { name: "", run: [], env: [] };
      steps.push(cur);
      inRun = false;
      const kv = m[1].match(/^(\w[\w-]*):\s*(.*)$/);
      if (kv?.[1] === "name") cur.name = kv[2];
      if (kv?.[1] === "run") cur.run.push(kv[2]);
      continue;
    }
    if (!cur) continue;
    if (inRun) {
      const ind = l.match(/^ */)[0].length;
      if (l.trim() === "" || ind >= runIndent) { if (l.trim()) cur.run.push(l.trim()); continue; }
      inRun = false;
    }
    const kv = l.match(/^        (\w[\w-]*):\s*(.*)$/);
    if (!kv) { if (/^          \w/.test(l)) cur.env.push(l.trim()); continue; }
    if (kv[1] === "name") cur.name = kv[2];
    if (kv[1] === "run") {
      if (/^[|>]/.test(kv[2])) { inRun = true; runIndent = 10; } else cur.run.push(kv[2]);
    }
  }
  for (const s of steps) s.run = s.run.filter((c) => c && !c.startsWith("#"));
  return steps;
}

export function check(text) {
  const findings = [];
  const steps = jobSteps(text);
  if (!steps) return [`${WORKFLOW} has no \`${JOB}\` job`];
  const verifyEnd = text.indexOf("\n  mutation-sweep:");
  const jobText = text.slice(text.indexOf(`\n  ${JOB}:`), verifyEnd === -1 ? undefined : verifyEnd);
  const pre = steps.filter((s) => s.run.some((c) => /^node scripts\/preflight\.mjs\b/.test(c)));
  if (pre.length === 0) findings.push(`the ${JOB} job never runs \`node scripts/preflight.mjs\` — the nightly selection is no longer preflight's STEPS`);
  for (const s of pre) {
    for (const c of s.run) if (/preflight\.mjs\b.*--quick/.test(c)) findings.push(`step "${s.name}" runs preflight with --quick — the heavy gates are skipped, a hand-picked subset again`);
    if (!s.env.some((e) => /^GITHUB_TOKEN:\s*\S/.test(e))) findings.push(`step "${s.name}" does not hand GITHUB_TOKEN to preflight — check-ci-liveness.mjs is FATAL in CI without it`);
  }
  // `if: failure()` steps use github-script, not run; everything with a run is checked.
  for (const s of steps) {
    for (const c of s.run) {
      if (ALLOWED_GATES.some((re) => re.test(c)) || SETUP.some((re) => re.test(c))) continue;
      findings.push(`step "${s.name}" runs \`${c}\` — a gate named by hand in the nightly job; register it in scripts/preflight.mjs instead`);
    }
  }
  const perms = text.match(/^permissions:\n((?:  .*\n)+)/m)?.[1] ?? "";
  const jobPerms = jobText.match(/\n    permissions:\n((?:      .*\n)+)/)?.[1];
  if (!/actions:\s*read/.test(jobPerms ?? perms)) findings.push(`${WORKFLOW} does not grant \`actions: read\` to the ${JOB} job — preflight's liveness gate cannot read workflow runs`);
  const header = text.slice(0, text.search(/^on:/m));
  if (!header.includes("node scripts/preflight.mjs")) findings.push(`${WORKFLOW}'s header does not say it runs \`node scripts/preflight.mjs\` — the prose must describe what the job runs`);
  if (/SELECTED set|hand-picked rather than derived/.test(header)) findings.push(`${WORKFLOW}'s header still describes a hand-picked selection`);
  return findings;
}

function selfTest() {
  const real = readFileSync(resolve(repo, WORKFLOW), "utf8");
  const pfLine = "        run: node scripts/preflight.mjs\n";
  const planted = (from, to) => real.replace(from, to);
  const checks = [
    ["the real workflow passes", check(real).length === 0],
    ["a hand-picked proof step fails", check(planted(pfLine, `${pfLine}\n      - name: Core proof\n        run: pnpm run proof:signalgrid-core\n`)).length > 0],
    ["a hand-picked gate inside a block run fails", check(planted(pfLine, "        run: |\n          node scripts/preflight.mjs\n          node scripts/check-ci-liveness.mjs\n")).length > 0],
    ["preflight --quick fails", check(planted(pfLine, "        run: node scripts/preflight.mjs --quick\n")).length > 0],
    ["no preflight step fails", check(planted(pfLine, "        run: pnpm run typecheck\n")).length > 0],
    ["a preflight step without GITHUB_TOKEN fails", check(real.replace(/        env:\n          GITHUB_TOKEN: .*\n(        run: node scripts\/preflight)/, "$1")).length > 0],
    ["no actions: read fails", check(real.replace(/^  actions: read\n/m, "")).length > 0],
    ["a header that does not name preflight fails", check(real.replace(/^(#[^\n]*)node scripts\/preflight\.mjs/gm, "$1the selected gates")).length > 0],
  ];
  const failed = checks.filter(([, ok]) => !ok);
  for (const [n, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${n}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv.includes("--self-test")) process.exit(selfTest());

const findings = check(readFileSync(resolve(repo, WORKFLOW), "utf8"));
for (const f of findings) console.log(`✗ ${f}`);
console.log(findings.length === 0
  ? `✓ ${WORKFLOW}: the daily job runs full preflight + the breadth lane and names no gate by hand`
  : `\nscheduled-verification scope: ${findings.length} FAILED`);
process.exit(findings.length === 0 ? 0 : 1);
