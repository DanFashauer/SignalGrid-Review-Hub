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
//   - any `run:` command SEGMENT that is not setup/install, preflight or the breadth
//     lane — a gate invoked by name here is a hand-picked list growing back. Lines are
//     joined across `\` continuations and split on `&&`, `||` and `;` outside quotes,
//     so a gate chained behind an allowed prefix (`apt-get … && pnpm run proof:x`,
//     `echo hi; …`) is caught; command substitution is rejected outright;
//   - anything that lets the job stay green while preflight is red or never ran:
//     `continue-on-error` anywhere in the job, or an `if:` on the job or on the
//     preflight step;
//   - the preflight step not handing `${{ github.token }}` (or secrets.GITHUB_TOKEN) over,
//     setting a custom `shell:`, or the
//     workflow not granting `actions: read`: `check-ci-liveness.mjs` is FATAL in CI
//     without both, so the nightly job would fail every morning and teach everyone to
//     ignore its issue;
//   - a breadth step whose `if:` is not exactly `success() || failure()` or `always()` —
//     otherwise the first red gate hides the whole breadth lane, or a green night skips it;
//   - a header that does not name `scripts/preflight.mjs` as what it runs.
// It parses the job by indentation rather than with a YAML library (none is a
// dependency here); the self-test plants each defect in a copy of the real file.
// (First two review rounds' bypasses — continue-on-error, `if: false`, an empty token,
// a chained gate, a hidden breadth lane — are each a self-test case below.)
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = ".github/workflows/scheduled-verification.yml";
const JOB = "verify";

// Command SEGMENTS that set the job up rather than check anything, each matched whole.
// Anything else is a gate, and the only gates this job may name are preflight and the
// breadth lane (its own CI job with its own registry, scripts/verify-breadth.mjs).
const SETUP = [
  /^pnpm install --frozen-lockfile$/,
  /^sudo apt-get update -qq$/,
  /^sudo apt-get install -y -qq shellcheck$/,
  /^(if )?timeout \d+ pnpm --filter @workspace\/scripts exec playwright install(-deps)? chromium$/,
  /^(ok=|ok=1|break|for attempt in 1 2 3|do|done|then|fi|exit 1|if \[ -z "\$ok" \])$/,
  /^sleep \$\(\(attempt \* \d+\)\)$/,
  /^echo "[^"`]*"$/,
];
const PREFLIGHT = /^node scripts\/preflight\.mjs$/;
const BREADTH = /^pnpm run verify:breadth$/;

/** Split one shell line on `&&`, `||` and `;` outside quotes. */
export function segments(line) {
  const out = [];
  let cur = "";
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    const two = line.slice(i, i + 2);
    if (two === "&&" || two === "||") { out.push(cur); cur = ""; i++; continue; }
    if (c === ";") { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Split the verify job into steps: [{ name, run, env, keys }], plus the job's own keys. */
export function jobSteps(text, job = JOB) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l === `  ${job}:`);
  if (start === -1) return null;
  let end = lines.findIndex((l, i) => i > start && /^  [A-Za-z0-9_-]+:\s*$/.test(l));
  if (end === -1) end = lines.length;
  const body = lines.slice(start + 1, end);
  const jobKeys = {};
  for (const l of body) {
    const kv = l.match(/^    ([\w-]+):\s*(.*)$/);
    if (kv) jobKeys[kv[1]] = kv[2];
  }
  const steps = [];
  let cur = null;
  let inRun = false;
  for (const l of body) {
    const m = l.match(/^      - (.*)$/);
    if (m) {
      cur = { name: "", run: [], env: [], keys: {} };
      steps.push(cur);
      inRun = false;
      const kv = m[1].match(/^([\w-]+):\s*(.*)$/);
      if (kv) cur.keys[kv[1]] = kv[2];
      if (kv?.[1] === "name") cur.name = kv[2];
      if (kv?.[1] === "run") cur.run.push(kv[2]);
      continue;
    }
    if (!cur) continue;
    if (inRun) {
      const ind = l.match(/^ */)[0].length;
      if (l.trim() === "" || ind >= 10) { if (l.trim()) cur.run.push(l.trim()); continue; }
      inRun = false;
    }
    const kv = l.match(/^        ([\w-]+):\s*(.*)$/);
    if (!kv) { if (/^          \w/.test(l)) cur.env.push(l.trim()); continue; }
    cur.keys[kv[1]] = kv[2];
    if (kv[1] === "name") cur.name = kv[2];
    if (kv[1] === "run") {
      if (/^[|>]/.test(kv[2])) inRun = true; else cur.run.push(kv[2]);
    }
  }
  for (const s of steps) {
    // Join `\` continuations, drop comments, then split into command segments.
    const joined = [];
    for (const c of s.run.filter((c) => c && !c.startsWith("#"))) {
      if (joined.length && joined[joined.length - 1].endsWith("\\")) joined[joined.length - 1] = `${joined[joined.length - 1].slice(0, -1).trimEnd()} ${c}`;
      else joined.push(c);
    }
    s.run = joined.flatMap(segments);
  }
  return { steps, jobKeys, jobText: body.join("\n") };
}

export function check(text) {
  const findings = [];
  const parsed = jobSteps(text);
  if (!parsed) return [`${WORKFLOW} has no \`${JOB}\` job`];
  const { steps, jobKeys, jobText } = parsed;
  if (/^\s*-?\s*continue-on-error:/m.test(jobText)) findings.push(`the ${JOB} job sets continue-on-error — a red preflight would leave the nightly green`);
  if ("if" in jobKeys) findings.push(`the ${JOB} job has \`if: ${jobKeys.if}\` — the nightly must not be skippable`);
  const pre = steps.filter((s) => s.run.some((c) => /^node scripts\/preflight\.mjs\b/.test(c)));
  if (pre.length === 0) findings.push(`the ${JOB} job never runs \`node scripts/preflight.mjs\` — the nightly selection is no longer preflight's STEPS`);
  for (const s of pre) {
    for (const c of s.run) if (/preflight\.mjs\b.*--quick/.test(c)) findings.push(`step "${s.name}" runs preflight with --quick — the heavy gates are skipped, a hand-picked subset again`);
    // Exactly the job token, by either of its two names — an allowlist, because an
    // expression that merely LOOKS non-empty (`${{ '' }}`) resolves to nothing.
    if (!s.env.some((e) => /^GITHUB_TOKEN:\s*\$\{\{\s*(github\.token|secrets\.GITHUB_TOKEN)\s*\}\}\s*$/.test(e))) findings.push(`step "${s.name}" does not hand GITHUB_TOKEN: \${{ github.token }} (or secrets.GITHUB_TOKEN) to preflight — check-ci-liveness.mjs is FATAL in CI without it`);
    if ("if" in s.keys) findings.push(`step "${s.name}" has \`if: ${s.keys.if}\` — preflight must run every night`);
    // A custom shell can swallow the exit code (`shell: true {0}` runs `true`), so the
    // preflight step takes the runner default and nothing else.
    if ("shell" in s.keys) findings.push(`step "${s.name}" sets \`shell: ${s.keys.shell}\` — a custom shell can discard preflight's exit code`);
  }
  const breadth = steps.filter((s) => s.run.some((c) => BREADTH.test(c)));
  if (breadth.length === 0) findings.push(`the ${JOB} job no longer runs the breadth lane`);
  for (const s of breadth) {
    // Exactly one of the two conditions that run on a green AND a red night; a pattern
    // match accepted `failure()` alone (never runs when green) and `failure() && false`.
    const cond = (s.keys.if ?? "").replace(/^\$\{\{\s*|\s*\}\}$/g, "").trim();
    if (!["success() || failure()", "always()"].includes(cond)) findings.push(`step "${s.name}" has no \`if: success() || failure()\` — the first red preflight gate hides the whole breadth lane`);
  }
  for (const s of steps) {
    for (const c of s.run) {
      if (/\$\([^(]|`/.test(c)) { findings.push(`step "${s.name}" runs \`${c}\` — command substitution can hide a gate`); continue; }
      if (PREFLIGHT.test(c) || BREADTH.test(c) || SETUP.some((re) => re.test(c))) continue;
      findings.push(`step "${s.name}" runs \`${c}\` — a gate named by hand in the nightly job; register it in scripts/preflight.mjs instead`);
    }
  }
  const perms = text.match(/^permissions:\n((?:  .*\n)+)/m)?.[1] ?? "";
  const jobPerms = jobText.match(/(?:^|\n)    permissions:\n((?:      .*\n)+)/)?.[1];
  if (!/actions:\s*read/.test(jobPerms ?? perms)) findings.push(`${WORKFLOW} does not grant \`actions: read\` to the ${JOB} job — preflight's liveness gate cannot read workflow runs`);
  const header = text.slice(0, text.search(/^on:/m));
  if (!header.includes("node scripts/preflight.mjs")) findings.push(`${WORKFLOW}'s header does not say it runs \`node scripts/preflight.mjs\` — the prose must describe what the job runs`);
  if (/SELECTED set|hand-picked rather than derived/.test(header)) findings.push(`${WORKFLOW}'s header still describes a hand-picked selection`);
  return findings;
}

function selfTest() {
  const real = readFileSync(resolve(repo, WORKFLOW), "utf8");
  const pfLine = "        run: node scripts/preflight.mjs\n";
  const pfName = "      - name: Preflight — the whole gate suite (daily rot check)\n";
  const aptLine = /(        run: sudo apt-get update -qq && sudo apt-get install -y -qq shellcheck)\n/;
  const breadthIf = "        if: success() || failure()\n        run: pnpm run verify:breadth\n";
  const jobLine = "    name: Daily verification (full preflight + breadth lane)\n";
  const planted = (from, to) => real.replace(from, to);
  const fails = (t) => check(t).length > 0;
  const checks = [
    ["the real workflow passes", check(real).length === 0],
    ["a hand-picked proof step fails", fails(planted(pfLine, `${pfLine}\n      - name: Core proof\n        run: pnpm run proof:signalgrid-core\n`))],
    ["a hand-picked gate inside a block run fails", fails(planted(pfLine, "        run: |\n          node scripts/preflight.mjs\n          node scripts/check-ci-liveness.mjs\n"))],
    ["preflight --quick fails", fails(planted(pfLine, "        run: node scripts/preflight.mjs --quick\n"))],
    ["no preflight step fails", fails(planted(pfLine, "        run: pnpm run typecheck\n"))],
    ["a preflight step without GITHUB_TOKEN fails", fails(real.replace(/        env:\n          GITHUB_TOKEN: .*\n(        run: node scripts\/preflight)/, "$1"))],
    ["an empty GITHUB_TOKEN fails", fails(real.replace(/GITHUB_TOKEN: \$\{\{ github\.token \}\}/, 'GITHUB_TOKEN: ""'))],
    ["no actions: read fails", fails(real.replace(/^  actions: read\n/m, ""))],
    ["a header that does not name preflight fails", fails(real.replace(/^(#[^\n]*)node scripts\/preflight\.mjs/gm, "$1the selected gates"))],
    ["continue-on-error on the preflight step fails", fails(planted(pfName, `${pfName}        continue-on-error: true\n`))],
    ["continue-on-error on the job fails", fails(planted(jobLine, `${jobLine}    continue-on-error: true\n`))],
    ["if: false on the preflight step fails", fails(planted(pfName, `${pfName}        if: false\n`))],
    ["if: on the job fails", fails(planted(jobLine, `${jobLine}    if: false\n`))],
    ["a gate chained behind apt-get with && fails", fails(real.replace(aptLine, "$1 && pnpm run proof:x\n"))],
    ["a gate chained behind echo with ; fails", fails(planted(pfLine, "        run: |\n          echo hi; pnpm run proof:x\n          node scripts/preflight.mjs\n"))],
    ["a gate hidden in command substitution fails", fails(planted(pfLine, "        run: |\n          echo \"$(pnpm run proof:x)\"\n          node scripts/preflight.mjs\n"))],
    ["a breadth step without if: failure() fails", fails(planted(breadthIf, "        run: pnpm run verify:breadth\n"))],
    ["breadth with if: failure() alone fails (never runs on a green night)", fails(planted(breadthIf, "        if: failure()\n        run: pnpm run verify:breadth\n"))],
    ["breadth with if: failure() && false fails", fails(planted(breadthIf, "        if: failure() && false\n        run: pnpm run verify:breadth\n"))],
    ["breadth with if: ${{ !always() }} fails", fails(planted(breadthIf, "        if: ${{ !always() }}\n        run: pnpm run verify:breadth\n"))],
    ["breadth with if: ${{ always() }} passes", check(planted(breadthIf, "        if: ${{ always() }}\n        run: pnpm run verify:breadth\n")).length === 0],
    ["a shell: key on the preflight step fails", fails(planted(pfLine, `        shell: true {0}\n${pfLine}`))],
    ["GITHUB_TOKEN: ${{ '' }} fails", fails(real.replace(/GITHUB_TOKEN: \$\{\{ github\.token \}\}/, "GITHUB_TOKEN: ${{ '' }}"))],
    ["a ; inside a quoted echo is NOT a split (the real Playwright step passes)", segments('echo "::error::a; b"').length === 1],
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
