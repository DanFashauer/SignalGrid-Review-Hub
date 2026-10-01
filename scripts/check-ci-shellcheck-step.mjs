// The CI "Shell lint (shellcheck)" step must not be a coin-flip on the apt lock.
//
//   node scripts/check-ci-shellcheck-step.mjs              # check the real workflow
//   node scripts/check-ci-shellcheck-step.mjs --self-test  # plant the old and new shapes
//
// WHY: on 2026-10-01 the gating job failed twice (jobs 110400115466, 110414564534)
// with `E: Could not get lock /var/lib/dpkg/lock-frontend ... (apt-get)` and exit 100,
// because the step ran a bare apt-get update && install while another apt-get held
// the lock. The runner image already ships shellcheck.
//
// WHAT THIS ENFORCES on the step's `run:` block:
//   1. it checks `command -v shellcheck` before installing (prefer the preinstalled one);
//   2. every apt-get call passes `DPkg::Lock::Timeout` (wait for the lock, not fail at once);
//   3. it re-checks availability and exits non-zero if still absent (fail closed, no skip);
//   4. it prints `shellcheck --version`.
// A missing or unparseable step FAILS.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STEP = "Shell lint (shellcheck)";

export function extractStepRun(yaml) {
  const lines = yaml.split("\n");
  const i = lines.findIndex((l) => l.includes(`- name: ${STEP}`));
  if (i < 0) return null;
  const indent = lines[i].match(/^\s*/)[0].length;
  const out = [];
  for (let j = i + 1; j < lines.length; j++) {
    const l = lines[j];
    if (l.trim() && l.match(/^\s*/)[0].length <= indent) break;
    out.push(l);
  }
  const body = out.join("\n");
  return /\brun:/.test(body) ? body : null;
}

export function verdict(yaml) {
  const run = extractStepRun(yaml);
  if (run === null) return [`step "${STEP}" not found or has no run block`];
  const code = run.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  const problems = [];
  if (!/command -v shellcheck/.test(code)) problems.push("does not prefer the preinstalled shellcheck (`command -v shellcheck`)");
  for (const l of code.split("\n").filter((x) => /apt-get\b/.test(x))) {
    if (!/DPkg::Lock::Timeout=\d+/.test(l)) problems.push(`apt-get without DPkg::Lock::Timeout: ${l.trim()}`);
  }
  if (!/command -v shellcheck[^\n]*\|\|[^\n]*exit 1/.test(code)) problems.push("does not fail closed when shellcheck is still unavailable");
  if (!/shellcheck --version/.test(code)) problems.push("does not print the shellcheck version");
  return problems;
}

const wrap = (run) =>
  `jobs:\n  a:\n    steps:\n      - name: ${STEP}\n        run: |\n${run.split("\n").map((l) => "          " + l).join("\n")}\n      - name: next\n        run: "true"\n`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--self-test")) {
    const old = wrap("sudo apt-get update -qq && sudo apt-get install -y -qq shellcheck\nnode scripts/check-shell.mjs");
    const good = wrap(
      [
        "if ! command -v shellcheck >/dev/null 2>&1; then",
        "  sudo apt-get -o DPkg::Lock::Timeout=180 update -qq",
        "  sudo apt-get -o DPkg::Lock::Timeout=180 install -y -qq shellcheck",
        "fi",
        'command -v shellcheck >/dev/null 2>&1 || { echo "::error::x"; exit 1; }',
        "shellcheck --version",
        "node scripts/check-shell.mjs",
      ].join("\n"),
    );
    const noFailClosed = good.replace(/ \|\| \{ echo[^\n]*\}/, "");
    let bad = 0;
    if (verdict(old).length === 0) { console.error("✗ self-test: the old bare apt-get step PASSED"); bad++; }
    if (verdict(good).length !== 0) { console.error("✗ self-test: the new shape FAILED:", verdict(good)); bad++; }
    if (verdict(noFailClosed).length === 0) { console.error("✗ self-test: a step that can silently skip PASSED"); bad++; }
    if (verdict("jobs: {}").length === 0) { console.error("✗ self-test: a missing step PASSED"); bad++; }
    if (bad) process.exit(1);
    console.log("✓ check-ci-shellcheck-step self-test: old shape fails, new shape passes, silent skip fails, missing step fails");
  } else {
    const problems = verdict(readFileSync(join(ROOT, ".github/workflows/review-hub-ci.yml"), "utf8"));
    if (problems.length) {
      for (const p of problems) console.error(`✗ ${p}`);
      process.exit(1);
    }
    console.log("✓ CI shellcheck step: prefers preinstalled, waits for the apt lock, fails closed, prints version");
  }
}
