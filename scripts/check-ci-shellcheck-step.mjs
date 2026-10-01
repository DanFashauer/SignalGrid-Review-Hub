// A CI step that installs or runs shellcheck must not be a coin-flip on the apt lock.
//
//   node scripts/check-ci-shellcheck-step.mjs              # check the real workflows
//   node scripts/check-ci-shellcheck-step.mjs --self-test  # plant broken shapes; each must fail
//
// WHY: on 2026-10-01 the gating job failed three times (jobs 110400115466,
// 110414564534, 110474078694) with `E: Could not get lock /var/lib/dpkg/lock-frontend
// ... (apt-get)` and exit 100, because the step ran a bare apt-get update && install
// while another apt-get held the lock. The runner image already ships shellcheck.
//
// WHAT THIS ENFORCES — by exact shape, not by substring (a substring rule is satisfied
// by a comment, an echo string, `|| true`, or a timeout on only one of two chained calls):
//   · each pinned step (below) must have ONLY the allowed keys (no `if`, `shell`,
//     `continue-on-error`, `working-directory`, `env`), exist exactly once in its file,
//     and its `run:` body — comments and continuations normalised — must equal the
//     canonical lines: guarded install (`command -v` test, then `apt-get -o
//     DPkg::Lock::Timeout=N` on BOTH update and install, N >= 60), a fail-closed
//     re-check ending in `exit 1`, `shellcheck --version`, and (CI lint step) the lint;
//   · NO other line in any .github/workflows/*.yml may apt/apt-get-install shellcheck.
// A missing or unparseable step FAILS.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIN_TIMEOUT = 60;

const INSTALL_BLOCK = [
  /^if ! command -v shellcheck >\/dev\/null 2>&1; then$/,
  /^sudo apt-get -o DPkg::Lock::Timeout=(\d+) update -qq$/,
  /^sudo apt-get -o DPkg::Lock::Timeout=(\d+) install -y -qq shellcheck$/,
  /^fi$/,
  /^command -v shellcheck >\/dev\/null 2>&1 \|\| \{ echo "::error::[^"#]*"; exit 1; \}$/,
  /^shellcheck --version$/,
];
const LINT = /^node scripts\/check-shell\.mjs$/;

/** The steps this gate pins: file -> [{ name, run lines, allowed keys }]. */
export const PINNED = [
  { file: ".github/workflows/review-hub-ci.yml", name: "Shell lint (shellcheck)", body: [...INSTALL_BLOCK, LINT], keys: ["name", "run"] },
  {
    file: ".github/workflows/scheduled-verification.yml",
    name: "Install shellcheck (preflight's shell-lint gate needs it)",
    body: INSTALL_BLOCK,
    keys: ["name", "run", "timeout-minutes"],
  },
];

const indentOf = (l) => l.match(/^\s*/)[0].length;
const stripComment = (l) => l.replace(/\s+#.*$/, "").trim();

/** Every step named `name`: { start, end (exclusive), lines }. */
function findSteps(lines, name) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)-\s+name:\s*(.*?)\s*$/);
    if (!m) continue;
    const got = m[2].replace(/^(["'])(.*)\1$/, "$2");
    if (got !== name) continue;
    const ind = m[1].length;
    let end = i + 1;
    while (end < lines.length && (lines[end].trim() === "" || indentOf(lines[end]) > ind)) end++;
    out.push({ start: i, end, lines: lines.slice(i, end), ind });
  }
  return out;
}

function stepProblems(step, spec) {
  const problems = [];
  const keyInd = step.ind + 2;
  // keys: the first line is `- name:`; later keys sit at ind+2.
  const keys = ["name"];
  let runIdx = -1;
  step.lines.forEach((l, k) => {
    if (k === 0) return;
    if (indentOf(l) === keyInd && /^[A-Za-z_-]+:/.test(l.trim())) {
      const key = l.trim().split(":")[0];
      keys.push(key);
      if (key === "run") runIdx = k;
    }
  });
  for (const k of keys) if (!spec.keys.includes(k)) problems.push(`step has a forbidden key \`${k}\` (it can skip or soften the step)`);
  if (runIdx < 0) return [...problems, "step has no run block"];
  const first = step.lines[runIdx].trim();
  if (!/^run:\s*[|>][-+]?$/.test(first)) return [...problems, "run must be a literal block (`run: |`)"];
  const raw = [];
  for (let k = runIdx + 1; k < step.lines.length; k++) {
    if (indentOf(step.lines[k]) <= keyInd && step.lines[k].trim()) break;
    raw.push(step.lines[k]);
  }
  const body = raw.map(stripComment).filter(Boolean);
  if (body.some((l) => l.endsWith("\\"))) problems.push("backslash continuations are not allowed in this step");
  if (body.length !== spec.body.length) {
    problems.push(`run body has ${body.length} command line(s), expected ${spec.body.length}: ${JSON.stringify(body)}`);
    return problems;
  }
  body.forEach((l, k) => {
    const m = l.match(spec.body[k]);
    if (!m) problems.push(`line ${k + 1} is not the canonical shape: \`${l}\` (want ${spec.body[k]})`);
    else if (m[1] !== undefined && Number(m[1]) < MIN_TIMEOUT) problems.push(`DPkg::Lock::Timeout=${m[1]} is below ${MIN_TIMEOUT}s: \`${l}\``);
  });
  return problems;
}

/** Problems for one workflow file's text against one pinned spec. */
export function verdictFor(yaml, spec) {
  const lines = yaml.split("\n");
  const steps = findSteps(lines, spec.name);
  if (steps.length === 0) return [`step "${spec.name}" not found in ${spec.file}`];
  if (steps.length > 1) return [`step "${spec.name}" appears ${steps.length} times in ${spec.file}; it must be unique`];
  const problems = stepProblems(steps[0], spec).map((p) => `${spec.file}: ${p}`);
  // No other line may install shellcheck.
  lines.forEach((l, i) => {
    if (i >= steps[0].start && i < steps[0].end) return;
    const c = stripComment(l);
    if (/\bapt(-get)?\b.*\bshellcheck\b/.test(c) || /\bshellcheck\b.*\bapt(-get)?\b.*install/.test(c)) {
      problems.push(`${spec.file}:${i + 1}: a shellcheck install outside the pinned step: \`${c}\``);
    }
  });
  return problems;
}

/** Any workflow file NOT pinned must not install shellcheck at all. */
function strayInstalls(dir, readFile, pinnedFiles) {
  const out = [];
  for (const f of readdirSync(join(dir, ".github/workflows")).filter((x) => /\.ya?ml$/.test(x))) {
    const rel = `.github/workflows/${f}`;
    if (pinnedFiles.includes(rel)) continue;
    readFile(rel).split("\n").forEach((l, i) => {
      const c = stripComment(l);
      if (/\bapt(-get)?\b.*\bshellcheck\b/.test(c)) out.push(`${rel}:${i + 1}: an unpinned shellcheck install: \`${c}\``);
    });
  }
  return out;
}

const wrap = (name, run, extra = "") =>
  `jobs:\n  a:\n    steps:\n      - name: ${name}\n${extra}        run: |\n${run.split("\n").map((l) => "          " + l).join("\n")}\n      - name: next\n        run: "true"\n`;

function selfTest() {
  const spec = PINNED[0];
  const good = [
    "# comment",
    "if ! command -v shellcheck >/dev/null 2>&1; then",
    "  sudo apt-get -o DPkg::Lock::Timeout=180 update -qq",
    "  sudo apt-get -o DPkg::Lock::Timeout=180 install -y -qq shellcheck",
    "fi",
    'command -v shellcheck >/dev/null 2>&1 || { echo "::error::x"; exit 1; }',
    "shellcheck --version",
    "node scripts/check-shell.mjs",
  ].join("\n");
  const variants = [
    ["old bare one-line apt-get", "sudo apt-get update -qq && sudo apt-get install -y -qq shellcheck\nnode scripts/check-shell.mjs"],
    ["one-line chain, timeout on update only", good.replace(/ {2}sudo apt-get -o DPkg::Lock::Timeout=180 update -qq\n {2}sudo apt-get -o DPkg::Lock::Timeout=180 install -y -qq shellcheck/, "  sudo apt-get -o DPkg::Lock::Timeout=180 update -qq && sudo apt-get install -y -qq shellcheck")],
    ["timeout only in a trailing comment", good.replace("install -y -qq shellcheck", "install -y -qq shellcheck # DPkg::Lock::Timeout=180").replace(/-o DPkg::Lock::Timeout=180 install/, "install")],
    ["Lock::Timeout=0", good.replace(/Timeout=180/g, "Timeout=0")],
    ["unconditional install", good.replace("if ! command -v shellcheck >/dev/null 2>&1; then", "if true; then")],
    ["bare `apt install`", good.replace(/apt-get -o DPkg::Lock::Timeout=180/g, "apt")],
    ["exit 10", good.replace("exit 1;", "exit 10;")],
    ["exit 0", good.replace("exit 1;", "exit 0;")],
    ["fail-closed neutered by || echo", good.replace(/\|\| \{ echo.*\}/, '|| echo "would exit 1"')],
    ["|| true # || exit 1", good.replace(/\|\| \{ echo.*\}/, "|| true # || exit 1")],
    ["version print neutered", good.replace("shellcheck --version", "shellcheck --version || true")],
    ["version only in a comment", good.replace("shellcheck --version", "true # shellcheck --version")],
    ["set +e before the lint", good.replace("shellcheck --version", "set +e\nshellcheck --version")],
    ["lint line removed", good.replace("\nnode scripts/check-shell.mjs", "")],
    ["dpkg -i bypass", good.replace(/ {2}sudo apt-get.*install.*/, "  dpkg -i /tmp/shellcheck.deb")],
  ];
  const extras = [
    ["continue-on-error", wrap(spec.name, good, "        continue-on-error: true\n")],
    ["if: false", wrap(spec.name, good, "        if: false\n")],
    ["shell: sh {0}", wrap(spec.name, good, "        shell: sh {0}\n")],
    ["missing step", "jobs: {}\n"],
    ["duplicate step", wrap(spec.name, good) + wrap(spec.name, good).split("\n").slice(3).join("\n")],
    ["second bare install elsewhere", wrap(spec.name, good) + "      - name: other\n        run: sudo apt-get update -qq && sudo apt-get install -y -qq shellcheck\n"],
  ];
  let bad = 0;
  if (verdictFor(wrap(spec.name, good), spec).length !== 0) {
    console.error("✗ self-test: the canonical shape FAILED:", verdictFor(wrap(spec.name, good), spec));
    bad++;
  }
  for (const [label, run] of variants) {
    if (verdictFor(wrap(spec.name, run), spec).length === 0) { console.error(`✗ self-test: variant PASSED but must fail: ${label}`); bad++; }
  }
  for (const [label, yaml] of extras) {
    if (verdictFor(yaml, spec).length === 0) { console.error(`✗ self-test: variant PASSED but must fail: ${label}`); bad++; }
  }
  // The scheduled-workflow spec: canonical passes, old bare shape fails.
  const s2 = PINNED[1];
  const sGood = good.replace("\nnode scripts/check-shell.mjs", "");
  if (verdictFor(wrap(s2.name, sGood, "        timeout-minutes: 5\n"), s2).length !== 0) { console.error("✗ self-test: scheduled canonical shape FAILED"); bad++; }
  if (verdictFor(wrap(s2.name, "sudo apt-get update -qq && sudo apt-get install -y -qq shellcheck", "        timeout-minutes: 5\n"), s2).length === 0) { console.error("✗ self-test: scheduled bare shape PASSED"); bad++; }
  if (bad) process.exit(1);
  console.log(`✓ check-ci-shellcheck-step self-test: canonical passes; ${variants.length + extras.length + 1} broken shapes all fail`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--self-test")) selfTest();
  else {
    const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
    const problems = [
      ...PINNED.flatMap((spec) => verdictFor(read(spec.file), spec)),
      ...strayInstalls(ROOT, read, PINNED.map((p) => p.file)),
    ];
    if (problems.length) {
      for (const p of problems) console.error(`✗ ${p}`);
      process.exit(1);
    }
    console.log(`✓ shellcheck steps: ${PINNED.length} pinned step(s) are canonical (preinstalled first, apt lock waited on both calls, fail-closed, version printed); no other workflow installs shellcheck`);
  }
}
