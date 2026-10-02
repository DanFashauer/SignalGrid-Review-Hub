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
//   · NO other apt/apt-get install, in any .github/workflows/*.yml or composite action
//     (.github/actions/**), may name shellcheck or hide its package list behind a `$`
//     variable. Backslash-continued commands are joined before the scan, so a package
//     list split across lines is still seen.
//   · Fail closed on YAML this gate cannot read: in .github/**/*.yml every line must be a bare
//     `key:` / `- key:` / `- value` line or sit inside a `|` / `>` block. Explicit keys (`? k`),
//     quoted keys, anchors/aliases/tags, multi-line plain or quoted scalars and `\x`/`\u` escapes
//     are reported as unsupported rather than guessed at. No YAML dependency: scripts/ has none
//     on purpose (see check-swift-serious.mjs), so the grammar is narrowed instead.
//   · A pinned file may not set `defaults:` (workflow or job level) or `BASH_ENV`, which could
//     turn the lint into a no-op without touching the step.
// THREAT MODEL: this is a tripwire against accidental and lazy regressions of the lock race, not
// a sandbox against deliberate obfuscation. Out of scope, and NOT detected:
//   · a quote-obfuscated name (`shell""check`, `sh"ell"check`) or one assembled in code
//     (`'shell' + 'check'` in an actions/github-script body);
//   · a command or a package list held in a variable or an env value (`${{ env.X }}`,
//     `$PKGS`) when no single line both runs apt and names shellcheck;
//   · a package list read from a file (`xargs -a pkgs.txt apt-get install`);
//   · a workflow that calls a script which itself installs shellcheck (the script is not
//     workflow text); the pinned steps are the supported path;
//   · apt calls that do NOT install shellcheck (`apt-get install -y jq`, desktop.yml's
//     libwebkit2gtk list): whether the lock-wait shape applies to EVERY apt call is the
//     owner's scope decision, not this gate's.
// Line endings are normalised (CRLF/CR -> LF) before any scan.
// A missing or unparseable step FAILS.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIN_TIMEOUT = 60;

/** CRLF, lone CR, the YAML 1.1 line breaks NEL/LS/PS and a leading BOM all become plain `\n` text. */
const EOL = new RegExp(`\\r\\n?|[${String.fromCharCode(0x85, 0x2028, 0x2029)}]`, "g");
const normEol = (t) => t.replace(EOL, "\n").replace(new RegExp(`^${String.fromCharCode(0xfeff)}`), "");

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
/** Drop a trailing `# comment`, but only where the `#` is outside quotes and starts a word. */
function stripComment(l) {
  let q = null;
  for (let i = 0; i < l.length; i++) {
    const c = l[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === "#" && (i === 0 || /\s/.test(l[i - 1]))) return l.slice(0, i).trim();
  }
  return l.trim();
}
/** Column where a mapping key starts: the dash column + 2 for `- key:`, else the indent. */
const keyColumn = (l) => (/^\s*-\s+/.test(l) ? l.match(/^\s*-\s+/)[0].length : indentOf(l));

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
    const km = l.trim().match(/^(["']?)([^"':]+?)\1\s*:(\s|$)/);
    if (indentOf(l) === keyInd && km) {
      const key = km[2].trim();
      keys.push(key);
      if (key === "run") runIdx = k;
    }
  });
  if (new Set(keys).size !== keys.length) problems.push("step has a duplicate key");
  for (const k of keys) if (!spec.keys.includes(k)) problems.push(`step has a forbidden key \`${k}\` (it can skip or soften the step)`);
  if (runIdx < 0) return [...problems, "step has no run block"];
  const first = step.lines[runIdx].trim();
  if (!/^run:\s*\|[-+]?$/.test(first)) return [...problems, "run must be a literal block (`run: |`)"];
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

/**
 * Fail-closed grammar for workflow YAML (see header). Returns problem strings.
 */
export function unsupportedYaml(text) {
  const out = [];
  const lines = normEol(text).split("\n");
  let blk = -1;
  lines.forEach((l, i) => {
    if (!l.trim() || l.trim().startsWith("#")) return;
    if (blk >= 0) { if (indentOf(l) > blk) return; blk = -1; }
    const t = stripComment(l);
    if (/^(\s*)(?:-\s+)?[A-Za-z0-9_.-]+:\s*[|>][-+0-9]*\s*(#.*)?$/.test(l)) { blk = keyColumn(l); return; }
    const key = t.match(/^(?:-\s+)?([A-Za-z0-9_.-]+):(?:\s+(.*))?$/);
    const item = !key && /^-\s+\S/.test(t) && !/^-\s+["'][^"']*["']\s*:/.test(t);
    if (!key && !item && t !== "-") { out.push(`line ${i + 1}: unsupported YAML shape \`${t.slice(0, 60)}\` (explicit/quoted key, or a multi-line scalar)`); return; }
    const val = (key ? key[2] : t.replace(/^-\s+/, "")) ?? "";
    if (/^[&*!]/.test(val)) out.push(`line ${i + 1}: anchors, aliases and tags are not supported: \`${val.slice(0, 40)}\``);
    const q = val[0];
    if ((q === '"' || q === "'") && !(val.length > 1 && val.endsWith(q) && !val.endsWith("\\" + q))) out.push(`line ${i + 1}: a multi-line quoted scalar is not supported`);
    if (/\\(x[0-9A-Fa-f]{2}|u00[0-9A-Fa-f]{2}|U0000[0-9A-Fa-f]{2}|[0-7]{1,3})/.test(t)) out.push(`line ${i + 1}: an ASCII escape (\\x, \\u00, octal) can hide a package name and is not supported`);
    // \n, \t, \r ... in a double-quoted value (or a flow mapping) decode to whitespace the scanner never sees.
    if ((val[0] === '"' || /(^|[\s,-])\{(?!\{)/.test(t)) && /\\[abtnvfre ]/.test(t)) out.push(`line ${i + 1}: a whitespace/control escape (\\n, \\t, \\r ...) in a double-quoted value is not supported`);
  });
  return out;
}

/** Workflow-level and job-level knobs that can neutralise a step without touching it. */
function fileKnobProblems(lines) {
  const out = [];
  lines.forEach((l, i) => {
    if (/^defaults:/.test(l)) out.push(`line ${i + 1}: workflow-level \`defaults:\` can change the shell of every step`);
    if (/\bBASH_ENV\b/.test(l.replace(/\s+#.*$/, ""))) out.push(`line ${i + 1}: BASH_ENV can neutralise a step`);
  });
  return out;
}

/** The job holding the step must not be skippable or non-gating either. */
function jobProblems(lines, stepStart) {
  let h = stepStart;
  while (h >= 0 && !/^ {2}[\w-]+:\s*$/.test(lines[h])) h--;
  if (h < 0) return ["could not find the job holding the pinned step"];
  let e = h + 1;
  while (e < lines.length && !/^ {2}[\w-]+:\s*$/.test(lines[e])) e++;
  const out = [];
  for (let k = h + 1; k < e; k++) {
    const km = lines[k].match(/^ {4}(["']?)([^\s"':][^"':]*?)\1\s*:(\s|$)/);
    if (km && ["continue-on-error", "if", "defaults", "container"].includes(km[2].trim())) out.push(`the job holding the step sets \`${km[2].trim()}\` (it can skip or soften the lint)`);
  }
  return out;
}

/** Problems for one workflow file's text against one pinned spec. */
export function verdictFor(yaml, spec) {
  yaml = normEol(yaml);
  const lines = yaml.split("\n");
  const steps = findSteps(lines, spec.name);
  if (steps.length === 0) return [`step "${spec.name}" not found in ${spec.file}`];
  if (steps.length > 1) return [`step "${spec.name}" appears ${steps.length} times in ${spec.file}; it must be unique`];
  const problems = [...unsupportedYaml(yaml), ...fileKnobProblems(lines), ...stepProblems(steps[0], spec), ...jobProblems(lines, steps[0].start)].map((p) => `${spec.file}: ${p}`);
  // No other command may install shellcheck.
  problems.push(...strayInstallsIn(yaml, spec.file, steps[0]));
  return problems;
}

/**
 * Fold YAML multi-line scalars into one logical line each, because the shell receives them
 * joined: a `key: >` folded block, and a plain `key: value` / `- value` scalar whose
 * following lines are indented deeper. A `|` literal block keeps its lines separate.
 * Returns [{ n, text }] where n is the 1-based first line.
 */
function yamlLogicalLines(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const kc = keyColumn(l);
    const m = l.match(/^(\s*(?:-\s+)?(?:["']?[^"':#]+?["']?\s*:)?)\s*(.*)$/);
    const val = m ? m[2] : l.trim();
    // A block indicator may carry an indentation digit, a chomping sign and a trailing comment.
    const isBlock = /^[|>][-+0-9]*\s*(#.*)?$/.test(val);
    const literal = isBlock && val[0] === "|";
    const folded = isBlock && val[0] === ">";
    const plain = val && !isBlock && !val.startsWith("#");
    if (literal) {
      // Literal content is shell, one command per line: never fold it, and keep comments in the
      // text (the shell's own quoting decides what a `#` is, not this scanner).
      out.push({ n: i + 1, text: l, raw: false });
      let j = i + 1;
      while (j < lines.length && (lines[j].trim() === "" || indentOf(lines[j]) > kc)) {
        if (lines[j].trim()) out.push({ n: j + 1, text: lines[j], raw: true });
        j++;
      }
      i = j - 1;
      continue;
    }
    if (folded || plain) {
      let j = i + 1;
      const parts = [folded ? m[1] : l];
      while (j < lines.length && (lines[j].trim() === "" ? folded : folded ? indentOf(lines[j]) > kc : indentOf(lines[j]) > kc && !/^\s*-\s/.test(lines[j]) && !/^\s*[\w"'-][^:]*:\s/.test(lines[j]))) {
        parts.push(lines[j].trim()); j++;
      }
      // A folded block reaches the shell as one line; scan it whole, comments included.
      out.push({ n: i + 1, text: parts.join(" "), raw: folded });
      i = j - 1;
      continue;
    }
    out.push({ n: i + 1, text: l, raw: false });
  }
  return out;
}

/**
 * Join `\` continuations: [{ n (1-based first line), text, glued }]. `text` joins with a space; `glued`
 * joins the way bash does (backslash-newline removed, nothing inserted), so `shell\` + `check` is seen.
 * Raw (shell) lines keep their `#`s.
 */
function joinedStatements(rawLines) {
  const out = [];
  let cur = null;
  const push = (st) => out.push({ n: st.n, text: st.text, glued: st.glued });
  yamlLogicalLines(rawLines).forEach(({ n, text, raw }) => {
    const i = n - 1;
    const t = raw ? text.trim() : stripComment(text);
    const body = t.replace(/\\$/, ""); // the text before a trailing backslash, spacing kept
    if (cur) {
      cur.text += " " + body.trim();
      cur.glued += body.trimStart();
      cur.open = t.endsWith("\\");
      if (!cur.open) { push(cur); cur = null; }
      return;
    }
    if (t.endsWith("\\")) { cur = { n: i + 1, text: body.trim(), glued: body, open: true }; return; }
    if (t) push({ n: i + 1, text: t, glued: t });
  });
  if (cur) push(cur);
  return out;
}

const APT_INSTALL = /\b(apt(-get)?|aptitude|nala)\b.*\b(re)?(install|satisfy)\b|\bsnap\s+install\b|\bdpkg\s+(-i|--install)\b/;

/** apt installs outside `skip` (a pinned step's line range) that name shellcheck or hide the package list. */
function strayInstallsIn(text, file, skip) {
  const lines = normEol(text).split("\n");
  const out = [];
  for (const st of joinedStatements(lines)) {
    if (skip && st.n - 1 >= skip.start && st.n - 1 < skip.end) continue;
    for (const text of new Set([st.text, st.glued])) {
      if (APT_INSTALL.test(text) && (/\bshellcheck\b/.test(text) || /\$/.test(text))) {
        out.push(`${file}:${st.n}: an unpinned apt install that names shellcheck or hides its package list behind a variable: \`${text}\``);
        break;
      }
    }
  }
  return out;
}

function listFiles(dir, readDir, rel = "") {
  const out = [];
  for (const e of readDir(join(dir, rel), { withFileTypes: true })) {
    const r = join(rel, e.name);
    if (e.isDirectory()) out.push(...listFiles(dir, readDir, r));
    else if (/\.ya?ml$/.test(e.name)) out.push(r);
  }
  return out;
}

/** Every workflow file and every composite action anywhere in the repo, NOT pinned. */
function strayInstalls(dir, readFile, pinnedFiles) {
  const out = [];
  const skip = new Set(["node_modules", ".git"]);
  const walk = (rel) => {
    const found = [];
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const r = rel ? join(rel, e.name) : e.name;
      if (e.isDirectory()) { if (!skip.has(e.name)) found.push(...walk(r)); }
      else if (/\.ya?ml$/.test(e.name)) found.push(r);
    }
    return found;
  };
  for (const rel of walk("")) {
    if (pinnedFiles.includes(rel)) continue;
    const text = readFile(rel);
    if (rel.startsWith(".github/") || /^\s*(runs|jobs):/m.test(text)) out.push(...unsupportedYaml(text).map((p) => `${rel}: ${p}`));
    out.push(...strayInstallsIn(text, rel, null));
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
    ["continued install naming shellcheck in a new step", wrap(spec.name, good) + "      - name: other\n        run: |\n          sudo apt-get install -y -qq jq \\\n            shellcheck\n"],
    ["env-var indirection in a new step", wrap(spec.name, good) + "      - name: other\n        run: sudo apt-get install -y -qq $PKGS\n"],
    ["quoted \"if\" key", wrap(spec.name, good, '        "if": false\n')],
    ["quoted \"continue-on-error\" key", wrap(spec.name, good, '        "continue-on-error": true\n')],
    ["spaced `if : false` key", wrap(spec.name, good, "        if : false\n")],
    ["folded `run: >` pinned step", wrap(spec.name, good).replace("run: |", "run: >")],
    ["job-level continue-on-error", wrap(spec.name, good).replace("  a:\n", "  a:\n    continue-on-error: true\n")],
    ["job-level if", wrap(spec.name, good).replace("  a:\n", "  a:\n    if: false\n")],
    ["explicit key `? if` / `: false`", wrap(spec.name, good, "        ? if\n        : false\n")],
    ["explicit key `? continue-on-error`", wrap(spec.name, good, "        ? continue-on-error\n        : true\n")],
    ["duplicate `run` key", wrap(spec.name, good, '        run: echo hi\n')],
    ["key-only run with plain continuation lines", wrap(spec.name, good) + "      - name: planted\n        run:\n          sudo apt-get install -y -qq jq\n          shellcheck\n"],
    ["trailing-space run with plain continuation lines", wrap(spec.name, good) + "      - name: planted\n        run: \n          sudo apt-get update -qq && sudo apt-get install -y -qq jq\n          shellcheck\n"],
    ["multi-line double-quoted run", wrap(spec.name, good) + '      - name: planted\n        run: "sudo apt-get install -y -qq jq\n          shellcheck"\n'],
    ["escaped package name in a double-quoted run", wrap(spec.name, good) + '      - name: planted\n        run: "sudo apt-get install -y -qq shell\\x63heck"\n'],
    ["job-level defaults.run.shell", wrap(spec.name, good).replace("  a:\n", "  a:\n    defaults:\n      run:\n        shell: true {0}\n")],
    ["workflow-level defaults.run.shell", "defaults:\n  run:\n    shell: true {0}\n" + wrap(spec.name, good)],
    ["BASH_ENV neutralising the step", wrap(spec.name, good).replace("  a:\n", "  a:\n    env:\n      BASH_ENV: ./exit0.sh\n")],
    ["job-level container", wrap(spec.name, good).replace("  a:\n", "  a:\n    container: alpine\n")],
    ["block-scalar name then multi-line plain run", wrap(spec.name, good) + "      - name: |\n          x\n        run:\n          sudo apt-get install -y -qq jq\n          shellcheck\n"],
    ["`- run: |` first key then multi-line env value", wrap(spec.name, good) + "      - run: |\n          echo hi\n        name: planted\n        env:\n          X: apt-get install -y -qq jq\n          shellcheck\n"],
    ["`#` inside quotes before the install", wrap(spec.name, good) + "      - name: p\n        run: |\n          printf '%s\\n' \"step #1\"; apt-get install -y -qq shellcheck\n"],
    ["flow-mapping step with an escaped package name", wrap(spec.name, good) + "      - {name: x, run: \"sudo apt-get install -y shell\\x63heck\"}\n"],
    ["escaped package name in an env value", wrap(spec.name, good) + "      - name: p\n        env:\n          X: \"apt-get install -y -qq shell\\x63heck\"\n        run: ${{ env.X }}\n"],
    ["apt-get satisfy shellcheck", wrap(spec.name, good) + "      - name: p\n        run: apt-get satisfy -y shellcheck\n"],
    ["trailing # on a `then` line above an indented install", wrap(spec.name, good) + "      - name: x\n        run: |\n          if true; then # refresh tools\n            apt-get install -y -qq shellcheck\n          fi\n"],
    ["trailing # on a `do` line above an indented install", wrap(spec.name, good) + "      - name: x\n        run: |\n          for p in jq shellcheck; do # tools\n            apt-get install -y -qq shellcheck\n          done\n"],
    ["trailing # on an echo line above an indented install", wrap(spec.name, good) + "      - name: x\n        run: |\n          echo start # note\n            apt-get install -y -qq shellcheck\n"],
    ["`run: | # comment` opener", wrap(spec.name, good) + "      - name: x\n        run: | # install lint tools\n          apt-get update -qq\n          apt-get install -y -qq shellcheck\n"],
    ["`run: |2 # comment` opener", wrap(spec.name, good) + "      - name: x\n        run: |2 # tools\n          apt-get install -y -qq shellcheck\n"],
    ["`run: >- # comment` opener", wrap(spec.name, good) + "      - name: x\n        run: >- # tools\n          apt-get install -y -qq\n          shellcheck\n"],
    ["`run: |+ # comment` opener", wrap(spec.name, good) + "      - name: x\n        run: |+ # keep\n          apt-get install -y -qq shellcheck\n"],
    ["escaped quote then # then install", wrap(spec.name, good) + "      - name: x\n        run: |\n          echo \"a\\\" #b\"; apt-get install -y -qq shellcheck\n"],
    ["folded block: escaped quote then # then install", wrap(spec.name, good) + "      - name: x\n        run: >\n          echo \"a\\\" #b\"; apt-get install -y -qq shellcheck\n"],
    ["multi-line double-quoted string closing with # and an install", wrap(spec.name, good) + "      - name: x\n        run: |\n          echo \"line one\n          see #42\"; apt-get install -y -qq shellcheck\n"],
    ["multi-line single-quoted string closing with # and an install", wrap(spec.name, good) + "      - name: x\n        run: |\n          jq '.a\n          # c'; apt-get install -y -qq shellcheck\n"],
    ["CRLF file: trailing # on a `then` line above an indented install", (wrap(spec.name, good) + "      - name: x\n        run: |\n          if true; then # refresh tools\n            apt-get install -y -qq shellcheck\n          fi\n").replace(/\n/g, "\r\n")],
    ["CRLF file: `# refresh` on an update line above the install", (wrap(spec.name, good) + "      - name: x\n        run: |\n          apt-get update -qq # refresh\n          apt-get install -y -qq shellcheck\n").replace(/\n/g, "\r\n")],
    ["`\\n` escape before the install in a double-quoted run", wrap(spec.name, good) + "      - name: x\n        run: \"echo hi\\napt-get install -y -qq shellcheck\"\n"],
    ["`\\n` escape before the install in a flow mapping", wrap(spec.name, good) + "      - {name: x, run: \"echo hi\\napt-get install -y -qq shellcheck\"}\n"],
    ["`\\t` escape splitting the install words", wrap(spec.name, good) + "      - name: x\n        run: \"apt-get install -y -qq\\tshellcheck\"\n"],
    ["folded block with a `- ` content line before an indented install", wrap(spec.name, good) + "      - name: x\n        run: >\n          echo start\n          - x # c\n              apt-get install -y -qq shellcheck\n"],
    ["package name split mid-word by a backslash-newline", wrap(spec.name, good) + "      - name: x\n        run: |\n          apt-get install -y -qq shell\\\n          check\n"],
    ["blank line inside a literal block before a commented `then`", wrap(spec.name, good) + "      - name: x\n        run: |\n          echo hi\n\n          if true; then # c\n            apt-get install -y -qq shellcheck\n          fi\n"],
    ["flow mapping with quoted keys and a \\n escape", wrap(spec.name, good) + "      - {\"name\": \"x\", \"run\": \"echo hi\\napt-get install -y -qq shellcheck\"}\n"],
    ["flow mapping with single-quoted keys and a \\n escape", wrap(spec.name, good) + "      - {'name': 'x', 'run': \"echo hi\\napt-get install -y -qq shellcheck\"}\n"],
    ["flow mapping with a space before the colon and a \\n escape", wrap(spec.name, good) + "      - {name : y, run : \"echo hi\\napt-get install -y -qq shellcheck\"}\n"],
    ["a `with: {...}` flow value with a \\t escape", wrap(spec.name, good) + "      - name: x\n        with: {\"script\": \"apt-get install -y\\tshellcheck\"}\n"],
    ["lone CR hiding `if: false` in the pinned step", wrap(spec.name, good).replace("        run: |", "        # x\r        if: false\n        run: |")],
    ["U+2028 hiding `continue-on-error` in the pinned step", wrap(spec.name, good).replace("        run: |", "        # x" + String.fromCharCode(0x2028) + "        continue-on-error: true\n        run: |")],
    ["U+0085 hiding `if: false` in the pinned step", wrap(spec.name, good).replace("        run: |", "        # x" + String.fromCharCode(0x85) + "        if: false\n        run: |")],
    ["BOM before a workflow-level `defaults:`", String.fromCharCode(0xfeff) + "defaults:\n  run:\n    shell: true {0}\n" + wrap(spec.name, good)],
    ...[["lone CR", "\r"], ["U+0085", String.fromCharCode(0x85)], ["U+2028", String.fromCharCode(0x2028)], ["U+2029", String.fromCharCode(0x2029)]].map(([label, br]) => [`${label} hiding a workflow-level \`defaults:\``, "# x" + br + "defaults:\n  run:\n    shell: true {0}\n" + wrap(spec.name, good)]),
    ["three-line glued package split", wrap(spec.name, good) + "      - name: x\n        run: |\n          apt-get install -y \\\n          shell\\\n          check\n"],
    ["second bare install elsewhere", wrap(spec.name, good) + "      - name: other\n        run: sudo apt-get update -qq && sudo apt-get install -y -qq shellcheck\n"],
  ];
  let bad = 0;
  if (verdictFor(wrap(spec.name, good).replace(/\n/g, "\r\n"), spec).length !== 0) {
    console.error("✗ self-test: the canonical shape with CRLF line endings FAILED:", verdictFor(wrap(spec.name, good).replace(/\n/g, "\r\n"), spec));
    bad++;
  }
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
  // Unpinned files (workflows and composite actions) go through strayInstallsIn directly.
  const stray = (t) => strayInstallsIn(t, "x.yml", null).length > 0;
  const strayCases = [
    ["composite action with a bare shellcheck install", "runs:\n  using: composite\n  steps:\n    - run: sudo apt-get install -y shellcheck\n      shell: bash\n", true],
    ["unpinned continued install", "      - run: |\n          sudo apt-get install -y -qq jq \\\n            shellcheck\n", true],
    ["unpinned $PKGS indirection", "      - run: sudo apt-get install -y $PKGS\n", true],
    ["folded run: > install naming shellcheck", "      - run: >\n          sudo apt-get install -y -qq jq\n          shellcheck\n", true],
    ["multi-line plain scalar install naming shellcheck", "      - run: sudo apt-get update -qq && sudo apt-get install -y -qq jq\n          shellcheck\n", true],
    ["aptitude install shellcheck", "      - run: sudo aptitude install -y shellcheck\n", true],
    ["snap install shellcheck", "      - run: sudo snap install shellcheck\n", true],
    ["dpkg -i shellcheck.deb", "      - run: sudo dpkg -i shellcheck.deb\n", true],
    ["`#` inside a word is not a comment", "      - run: echo a#b && apt-get install -y -qq shellcheck\n", true],
    ["same-indent backslash continuation naming shellcheck", "      - run: |\n          sudo apt-get install -y -qq jq \\\n          shellcheck\n", true],
    ["nala install shellcheck", "      - run: sudo nala install -y shellcheck\n", true],
    ["apt-get reinstall shellcheck", "      - run: sudo apt-get reinstall shellcheck\n", true],
    ["a folded `- run: >` step does not swallow its sibling keys", "      - run: >\n          echo hi\n        name: apt-get\n        env: install $X\n", false],
    ["unrelated continued install is NOT flagged (desktop.yml's real shape)", "        run: |\n          sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev \\\n            patchelf\n", false],
  ];
  for (const [label, t, want] of strayCases) {
    if (stray(t) !== want) { console.error(`✗ self-test: stray-install case wrong: ${label}`); bad++; }
  }
  // unsupportedYaml driven directly: every construct it claims to reject, and a clean document.
  const BS = String.fromCharCode(92);
  const grammarCases = [
    ["multi-line double-quoted scalar", "      - run: \"sudo apt-get install -y jq\n          shellcheck\"\n", true],
    ["anchor", "      - run: &x echo hi\n", true],
    ["alias", "      - run: *x\n", true],
    ["tag", "      - run: !!str echo hi\n", true],
    ["explicit key", "      ? if\n      : false\n", true],
    ["multi-line double-quoted scalar whose continuation looks like a key", "      - run: \"echo hi\n          more: stuff\"\n", true],
    ["multi-line single-quoted scalar whose continuation looks like a key", "      - run: 'echo hi\n          more: stuff'\n", true],
    ["unicode ASCII escape in a double-quoted value", `      - run: "echo ${BS}u0063"\n`, true],
    ["octal escape in a double-quoted value", `      - run: "echo ${BS}143"\n`, true],
    ["a clean CRLF document with a commented block opener", "jobs:\n  a:\n    steps:\n      - name: x\n        run: | # c\n          echo hi: stuff\n".replace(/\n/g, "\r\n"), false],
    ...["0", "a", "b", "t", "n", "v", "f", "r", "e", " "].map((c) => [`whitespace/control escape ${BS}${c === " " ? "<space>" : c}`, `      - run: "echo ${BS}${c}x"\n`, true]),
    ["a clean document", "jobs:\n  a:\n    steps:\n      - name: x\n        run: |\n          echo hi # a comment\n", false],
  ];
  for (const [label, t, want] of grammarCases) {
    if ((unsupportedYaml(t).length > 0) !== want) { console.error(`✗ self-test: grammar case wrong: ${label}`); bad++; }
  }
  // strayInstalls driven through a real directory: the repo-wide walk and the non-pinned grammar.
  const tmp = mkdtempSync(join(tmpdir(), "shellcheck-gate-"));
  try {
    const put = (rel, text) => { mkdirSync(dirname(join(tmp, rel)), { recursive: true }); writeFileSync(join(tmp, rel), text); };
    const scan = () => strayInstalls(tmp, (rel) => readFileSync(join(tmp, rel), "utf8"), []);
    put(".github/workflows/ok.yml", "jobs:\n  a:\n    steps:\n      - run: echo hi\n");
    if (scan().length !== 0) { console.error("✗ self-test: a clean tree was flagged:", scan()); bad++; }
    put(".github/workflows/zz.yml", "jobs:\n  a:\n    steps:\n      - run: echo hi\n          && more\n");
    if (scan().length === 0) { console.error("✗ self-test: an unsupported scalar in an unpinned workflow PASSED"); bad++; }
    rmSync(join(tmp, ".github/workflows/zz.yml"));
    put(".github/workflows/zz.yml", "jobs:\n  a:\n    steps:\n      - run: echo \"see #1234\" && apt-get install -y -qq shellcheck\n");
    if (scan().length === 0) { console.error("✗ self-test: an install after a quoted # in an unpinned workflow PASSED"); bad++; }
    rmSync(join(tmp, ".github/workflows/zz.yml"));
    put("ci/sc/action.yml", "runs:\n  using: composite\n  steps:\n    - run: apt-get install -y shellcheck\n      shell: bash\n");
    if (scan().length === 0) { console.error("✗ self-test: a composite action outside .github PASSED"); bad++; }
    rmSync(join(tmp, "ci"), { recursive: true });
    put("ci/sc/action.yml", `runs:\n  using: composite\n  steps:\n    - run: "apt-get install -y -qq shell${BS}x63heck"\n      shell: bash\n`);
    if (scan().length === 0) { console.error("✗ self-test: an escaped package name in a composite action outside .github PASSED"); bad++; }
    rmSync(join(tmp, "ci"), { recursive: true });
    put(".github/workflows/crlf.yml", "jobs:\n  a:\n    steps:\n      - run: |\n          if true; then # c\n            apt-get install -y -qq shellcheck\n          fi\n".replace(/\n/g, "\r\n"));
    if (scan().length === 0) { console.error("✗ self-test: a CRLF workflow with a commented `then` PASSED"); bad++; }
    rmSync(join(tmp, ".github/workflows/crlf.yml"));
    put(".github/workflows/cr.yml", "jobs:\n  a:\n    steps:\n      - run: |\n          if true; then # c\n            apt-get install -y -qq shellcheck\n          fi\n".replace(/\n/g, "\r"));
    if (scan().length === 0) { console.error("✗ self-test: a lone-CR workflow with a commented `then` PASSED"); bad++; }
    rmSync(join(tmp, ".github/workflows/cr.yml"));
    put("ci/frag/jobs.yml", `jobs:\n  a:\n    steps:\n      - run: "echo hi${BS}napt-get install -y -qq jq"\n`);
    if (scan().length === 0) { console.error("✗ self-test: a `jobs:` file outside .github with a \\n escape PASSED"); bad++; }
    rmSync(join(tmp, "ci"), { recursive: true });

    put("third_party/sc/action.yml", "runs:\n  using: composite\n  steps:\n    - run: apt-get install -y shellcheck\n      shell: bash\n");
    if (scan().length === 0) { console.error("✗ self-test: a composite action under third_party PASSED"); bad++; }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  if (bad) process.exit(1);
  console.log(`✓ check-ci-shellcheck-step self-test: canonical passes; ${variants.length + extras.length + 1} broken shapes all fail; ${strayCases.length} unpinned-install, ${grammarCases.length} grammar and 9 repo-walk cases behave`);
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
