// A CI step that installs or runs shellcheck must not be a coin-flip on the apt lock.
//
//   node scripts/check-ci-shellcheck-step.mjs              # check the real workflows
//   node scripts/check-ci-shellcheck-step.mjs --self-test  # plant broken shapes; each must fail
//
// WHY: on 2026-10-01 the gating job failed repeatedly (jobs 110400115466, 110414564534,
// 110474078694, 110481028418, 110509666304) with `E: Could not get lock
// /var/lib/dpkg/lock-frontend ... (apt-get)` and exit 100, because the step ran a bare
// `apt-get update && install` while another apt-get held the lock. The runner image already
// ships shellcheck.
//
// HOW: every workflow and composite action is PARSED with the `yaml` package (YAML 1.2; a duplicate
// key is a parse error), and the decoded document is what gets checked. An earlier revision read the
// YAML line by line; each review round found another construct (multi-line scalars in flow
// collections, escapes, CRLF, block openers with comments ...) that hid an install from it,
// because a line scanner and a YAML parser disagree about what the text MEANS. Parsing once
// removes that whole class: quoting, escapes, folding, flow collections, explicit and quoted
// keys, duplicate keys and line endings are the parser's job, not this file's.
//
// WHAT THIS ENFORCES:
//   · each pinned step (PINNED below) exists exactly once in its file, carries ONLY the allowed
//     keys (no `if`, `shell`, `continue-on-error`, `working-directory`, `env`), sits in a job
//     with no `if`, `continue-on-error`, `defaults` or `container`, and its decoded `run` equals
//     the canonical lines: a guarded install (`command -v` test, then `apt-get -o
//     DPkg::Lock::Timeout=N` on BOTH update and install, N >= 60), a fail-closed re-check ending
//     in `exit 1`, `shellcheck --version`, and (CI lint step) the lint;
//   · NO other decoded string in any workflow or composite action may run apt/apt-get/aptitude/
//     nala/snap/dpkg to install a package while naming shellcheck or hiding the package list
//     behind a `$` variable. Backslash-newline, and a trailing `|` or `&&`, continue a statement;
//     comments are NOT stripped before matching, so a `#` cannot hide an install;
//   · a pinned file may not set a workflow-level `defaults:` or any `BASH_ENV` key;
//   · YAML that does not parse, has a duplicate key, more than one document, an anchor, an alias
//     or a tag FAILS (fail closed; an alias needs an anchor, so it is covered by that).
//
// THREAT MODEL: this is a tripwire against accidental and lazy regressions of the lock race, not
// a sandbox against deliberate obfuscation. Out of scope, and NOT detected:
//   · a quote-obfuscated name (`shell""check`, `sh"ell"check`) or one assembled in code
//     (`'shell' + 'check'` in an actions/github-script body);
//   · a command or package list split across two strings (`${{ env.X }} ${{ env.P }}`) when no
//     single decoded string both runs apt and names shellcheck or a `$` variable;
//   · a package list read from a file (`xargs -a pkgs.txt apt-get install`) or built on ANOTHER
//     step; an apt verb behind an expression (`apt-get ${{ matrix.verb }} -y ${{ matrix.pkg }}`);
//   · a Dockerfile `RUN` in a docker action (it installs inside an image, not on the runner, so
//     it cannot race the runner's dpkg lock);
//   · a workflow that calls a script which itself installs shellcheck (the script is not workflow
//     text); the pinned steps are the supported path;
//   · apt calls that do NOT install shellcheck (`apt-get install -y jq`, desktop.yml's
//     libwebkit2gtk list): whether the lock-wait shape applies to EVERY apt call is the owner's
//     scope decision, not this gate's;
//   · how a YAML 1.1 parser would read a construct the 1.2 parser reads differently.
// Line breaks are normalised before parsing: CRLF, lone CR, NEL/LS/PS (U+0085/2028/2029) all
// become `\n`, and a leading BOM is dropped.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

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

const APT_INSTALL = /\b(apt(-get)?|aptitude|nala)\b.*\b(re)?(install|satisfy)\b|\bsnap\s+install\b|\bdpkg\s+(-i|--install)\b/;
const JOB_KNOBS = ["continue-on-error", "if", "defaults", "container"];

/** Drop a trailing `# comment` from a shell line, where the `#` is outside quotes and starts a word. */
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

/** Parse once. `problems` is non-empty when the text cannot be trusted (and `doc.errors` says why). */
function load(text) {
  const doc = YAML.parseDocument(normEol(text), { version: "1.2" }) // a duplicate key is a parse error in this (pinned) yaml version;
  const problems = doc.errors.map((e) => `YAML does not parse: ${e.message.split("\n")[0]}`);
  YAML.visit(doc, {
    Node(_key, n) {
      if (n.anchor) problems.push(`YAML anchors are not supported (&${n.anchor})`);
      if (n.tag) problems.push(`YAML tags are not supported (${n.tag})`);
    },
  });
  return { doc, problems: [...new Set(problems)] };
}

/** Parse problems only (does not parse / duplicate key / several documents / anchor / alias / tag). */
export function unsupportedYaml(text) {
  return load(text).problems;
}

function* strings(v, path = []) {
  if (typeof v === "string") yield [v, path];
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) yield* strings(x, [...path, k]); // arrays too: their keys are indexes
}

function* keysOf(v) {
  if (Array.isArray(v)) for (const x of v) yield* keysOf(x);
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { yield k; yield* keysOf(x); }
}

/** Statements of a decoded shell string: backslash-newline and a trailing `|` / `&&` continue one. */
function shellStatements(s) {
  const out = [];
  let cur = null;
  const ends = (x) => x.endsWith("\\") || /(&&|\|)$/.test(x);
  for (const line of s.split("\n")) {
    const t = line.trim();
    if (cur && t.startsWith("#")) continue; // a comment line inside a continued statement
    const body = t.replace(/\\$/, "");
    const continues = ends(t) || ends(stripComment(t));
    if (cur) {
      cur.text += " " + body.trim();
      cur.glued += body.trimStart(); // bash glues across a backslash-newline: `shell\` + `check`
      if (!continues) { out.push(cur); cur = null; }
    } else if (continues) cur = { text: body.trim(), glued: body };
    else if (t) out.push({ text: t, glued: t });
  }
  if (cur) out.push(cur);
  return out;
}

/** Installs of shellcheck (or of a `$`-hidden list) in any decoded string except the `exclude`d paths. */
export function strayInstallsIn(text, file, exclude = new Set(), lenient = false) {
  const { doc, problems } = load(text);
  if (lenient && problems.length) return []; // a non-workflow YAML we cannot trust: not ours to judge
  const out = problems.map((p) => `${file}: ${p}`);
  for (const [s, path] of strings(doc.toJS())) {
    if (exclude?.has(path.join("/"))) continue;
    for (const st of shellStatements(s)) {
      for (const x of new Set([st.text, st.glued])) {
        if (APT_INSTALL.test(x) && (/\bshellcheck\b/.test(x) || /\$/.test(x))) {
          out.push(`${file}: an unpinned apt install that names shellcheck or hides its package list behind a variable: \`${x}\``);
          break;
        }
      }
    }
  }
  return out;
}

function stepProblems(step, spec) {
  const problems = [];
  for (const k of Object.keys(step)) if (!spec.keys.includes(k)) problems.push(`step has a forbidden key \`${k}\` (it can skip or soften the step)`);
  if (typeof step.run !== "string") return [...problems, "step has no string `run`"];
  const body = step.run.split("\n").map(stripComment).filter(Boolean);
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
  const { doc, problems: parse } = load(yaml);
  const js = doc.toJS();
  const problems = [...parse];
  if (js && typeof js === "object" && !Array.isArray(js) && "defaults" in js) problems.push("workflow-level `defaults:` can change the shell of every step");
  for (const k of keysOf(js)) if (k === "BASH_ENV") problems.push("BASH_ENV can neutralise a step");
  const found = [];
  for (const [job, jobObj] of Object.entries(js?.jobs ?? {})) {
    for (const [i, st] of (Array.isArray(jobObj?.steps) ? jobObj.steps : []).entries()) {
      if (st?.name === spec.name) found.push({ job, jobObj, i, st });
    }
  }
  if (found.length === 0) return [...problems, `step "${spec.name}" not found`].map((p) => `${spec.file}: ${p}`);
  if (found.length > 1) return [...problems, `step "${spec.name}" appears ${found.length} times; it must be unique`].map((p) => `${spec.file}: ${p}`);
  const { job, jobObj, i, st } = found[0];
  for (const k of JOB_KNOBS) if (k in jobObj) problems.push(`the job holding the step sets \`${k}\` (it can skip or soften the lint)`);
  problems.push(...stepProblems(st, spec));
  const exclude = new Set([`jobs/${job}/steps/${i}/run`]);
  problems.push(...strayInstallsIn(yaml, spec.file, exclude).map((p) => p.replace(`${spec.file}: `, "")));
  return [...new Set(problems)].map((p) => `${spec.file}: ${p}`);
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
export function strayInstalls(dir, readFile, pinnedFiles) {
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
    const ours = rel.startsWith(".github/") || /^\s*(runs|jobs):/m.test(normEol(text));
    out.push(...strayInstallsIn(text, rel, new Set(), !ours));
  }
  return out;
}

const wrap = (name, run, extra = "") =>
  `jobs:\n  a:\n    steps:\n      - name: ${name}\n${extra}        run: |\n${run.split("\n").map((l) => "          " + l).join("\n")}\n      - name: next\n        run: "true"\n`;

function selfTest() {
  const BS = String.fromCharCode(92);
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
    ["fail-closed block behind `&&` instead of `||` (exits when shellcheck IS present)", good.replace(" || { echo", " && { echo")],
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
    ["U+2029 hiding `if: false` in the pinned step", wrap(spec.name, good).replace("        run: |", "        # x" + String.fromCharCode(0x2029) + "        if: false\n        run: |")],
    ["BOM before a workflow-level `defaults:`", String.fromCharCode(0xfeff) + "defaults:\n  run:\n    shell: true {0}\n" + wrap(spec.name, good)],
    ...[["lone CR", "\r"], ["U+0085", String.fromCharCode(0x85)], ["U+2028", String.fromCharCode(0x2028)], ["U+2029", String.fromCharCode(0x2029)]].map(([label, br]) => [`${label} hiding a workflow-level \`defaults:\``, "# x" + br + "defaults:\n  run:\n    shell: true {0}\n" + wrap(spec.name, good)]),
    ["three-line glued package split", wrap(spec.name, good) + "      - name: x\n        run: |\n          apt-get install -y \\\n          shell\\\n          check\n"],
    ...[
      ["`\\n` escape in a flow sequence value", `      - name: x\n        cmd: ["echo hi${BS}napt-get install -y -qq shellcheck"]\n`],
      ["`\\n` escape in a flow sequence of flow mappings", `      - name: x\n        include: [{"cmd": "echo hi${BS}napt-get install -y -qq shellcheck"}]\n`],
      ["`\\n` escape in a spaced flow sequence", `      - name: x\n        cmd: [ "echo hi${BS}napt-get install -y -qq shellcheck" ]\n`],
      ["`\\n` escape in a nested block sequence", `      - - "echo hi${BS}napt-get install -y -qq shellcheck"\n`],
      ["`\\n` escape after `- key:` in a nested sequence", `      - - cmd: "echo hi${BS}napt-get install -y -qq shellcheck"\n`],
      ["`\\n` escape after an odd (spaced) key", `      - odd key: "echo hi${BS}napt-get install -y -qq shellcheck"\n`],
      ["multi-line double-quoted scalar in a flow sequence, key-shaped continuation", `      - name: x\n        cmd: ["echo hi\n          x: ${BS}napt-get install -y -qq shellcheck"]\n`],
      ["multi-line double-quoted scalar in a flow sequence, item-shaped continuation", `      - name: x\n        cmd: ["echo hi\n          - x ${BS}napt-get install -y -qq shellcheck"]\n`],
      ["escaped quote then # in a flow sequence", `      - name: x\n        cmd: ["echo ${BS}" #${BS}"${BS}napt-get install -y -qq shellcheck"]\n`],
      ["tab before # after an escaped quote", `      - name: x\n        cmd: ["true ${BS}"\t#${BS}"; apt-get\tinstall -y -qq shellcheck"]\n`],
      ["a quote inside a plain flow scalar before a #", `      - name: x\n        cmd: [a"b, "true #${BS}napt-get install -y -qq shellcheck"]\n`],
      ["escaped quote then # in an env flow mapping", `      - name: x\n        env: {X: "echo ${BS}" #${BS}"${BS}napt-get install -y -qq shellcheck"}\n        run: \${{ env.X }}\n`],
      ["tab separator escape between apt-get and install", `      - name: x\n        run: "apt-get${BS}tinstall -y -qq shellcheck"\n`],
      ["tab separator escape before the package", `      - name: x\n        run: "apt-get install -y -qq${BS}tshellcheck"\n`],
      ["`\\x20` separator escape before the package", `      - name: x\n        run: "apt-get install -y -qq${BS}x20shellcheck"\n`],
      ["`\\u0020` separator escape before the package", `      - name: x\n        run: "apt-get install -y -qq${BS}u0020shellcheck"\n`],
      ["a `\\x63` escape inside the package name", `      - name: x\n        run: "apt-get install -y -qq shell${BS}x63heck"\n`],
      ["a `\\u0063` escape inside the package name", `      - name: x\n        run: "apt-get install -y -qq shell${BS}u0063heck"\n`],
    ].map(([label, plant]) => [label, wrap(spec.name, good) + plant]),
    ["pinned step with no `run`", `jobs:\n  a:\n    steps:\n      - name: ${spec.name}\n`],
    ["pinned step whose `run` is a list", `jobs:\n  a:\n    steps:\n      - name: ${spec.name}\n        run: [a, b]\n`],
    ["a benign step with the pinned name next to the real one", wrap(spec.name, good) + `      - name: ${spec.name}\n        run: echo hi\n`],
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
    ["a package list piped to xargs on the next line", "      - run: |\n          printf '%s\\n' shellcheck |\n            xargs apt-get install -y -qq\n", true],
    ["a package list built before `&&` on the previous line", "      - run: |\n          printf '%s\\n' shellcheck &&\n            xargs apt-get install -y -qq\n", true],
    ["a package list built before `||` on the previous line", "      - run: |\n          printf '%s\\n' shellcheck ||\n            xargs apt-get install -y -qq\n", true],
    ["a piped package list continued across a comment line", "      - run: |\n          printf '%s\\n' shellcheck |\n          # a comment\n            xargs apt-get install -y -qq\n", true],
    ["a piped package list with a trailing comment after the pipe", "      - run: |\n          printf '%s\\n' shellcheck | # note\n            xargs apt-get install -y -qq\n", true],
    ["a plain scalar with a shell double-quoted backslash-n is NOT an escape", "      - run: printf \"done\\n\"\n", false],
    ["a plain scalar with a shell double-quoted backslash-t is NOT an escape", "      - run: echo \"a\\tb\"\n", false],
    ["an escaped backslash in a quoted name is NOT an install", "      - name: \"a \\\\ b\"\n", false],
    ["a pipe the comment-stripper would miss (escaped quote, then ` #`)", "      - run: |\n          printf \"a\\\" #b\" shellcheck |\n            xargs apt-get install -y -qq\n", true],
    ["three lines, spaces before each backslash: `shell check` stays two words", "      - run: |\n          apt-get install -y \\\n          shell \\\n          check\n", false],
    ["a space before the backslash keeps `shell check` as two words", "      - run: |\n          apt-get install -y -qq shell \\\n          check\n", false],
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
  // The parse step driven directly: what is "unsupported" (cannot be trusted) and what is plain YAML.
  const doc = (body) => `jobs:\n  a:\n    steps:\n${body}`;
  const grammarCases = [
    ["an anchor", doc("      - run: &x echo hi\n"), true],
    ["an alias", doc("      - run: &x echo hi\n      - run: *x\n"), true],
    ["a tag", doc("      - run: !!str echo hi\n"), true],
    ["a duplicate key", doc("      - name: x\n        name: y\n"), true],
    ["two documents", doc("      - name: x\n") + "---\n" + doc("      - name: y\n"), true],
    ["an unclosed flow sequence", doc("      - name: x\n        cmd: [\"a\", \"b\"\n"), true],
    ["bad indentation", doc("      - name: x\n     run: y\n"), true],
    ["an unclosed double quote", doc("      - name: x\n        run: \"echo hi\n"), true],
    ["a clean document", doc("      - name: x\n        run: |\n          echo hi # a comment\n"), false],
    ["a clean CRLF document with a commented block opener", doc("      - name: x\n        run: | # c\n          echo hi: stuff\n").replace(/\n/g, "\r\n"), false],
    ["a plain scalar with a literal backslash-n", doc("      - run: echo a\\nb\n"), false],
    ["an explicit key is plain YAML (its key is visible to the key checks)", doc("      ? name\n      : x\n"), false],
    ["a multi-line double-quoted scalar is plain YAML (decoded and scanned instead)", doc("      - run: \"echo hi\n          more: stuff\"\n"), false],
  ];
  for (const [label, t, want] of grammarCases) {
    if ((unsupportedYaml(t).length > 0) !== want) { console.error(`✗ self-test: parse case wrong: ${label}`); bad++; }
  }
  // strayInstalls driven through a real directory: the repo-wide walk and the non-pinned grammar.
  const tmp = mkdtempSync(join(tmpdir(), "shellcheck-gate-"));
  try {
    const put = (rel, text) => { mkdirSync(dirname(join(tmp, rel)), { recursive: true }); writeFileSync(join(tmp, rel), text); };
    const scan = () => strayInstalls(tmp, (rel) => readFileSync(join(tmp, rel), "utf8"), []);
    put(".github/workflows/ok.yml", "jobs:\n  a:\n    steps:\n      - run: echo hi\n");
    if (scan().length !== 0) { console.error("✗ self-test: a clean tree was flagged:", scan()); bad++; }
    put(".github/workflows/zz.yml", "jobs:\n  a:\n    steps:\n      - run: &x echo hi\n");
    if (scan().length === 0) { console.error("✗ self-test: an anchor in an unpinned workflow PASSED"); bad++; }
    rmSync(join(tmp, ".github/workflows/zz.yml"));
    put(".github/workflows/zz.yml", "jobs:\n  a:\n    steps:\n      - run: |\n          echo \"see #1234\" && apt-get install -y -qq shellcheck\n");
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
    put(".github/workflows/bad.yml", "name: [unclosed\n");
    if (scan().length === 0) { console.error("✗ self-test: an unparseable file under .github PASSED"); bad++; }
    rmSync(join(tmp, ".github/workflows/bad.yml"));
    put("ci/bad.yml", "jobs:\n  a: [unclosed\n");
    if (scan().length === 0) { console.error("✗ self-test: an unparseable `jobs:` file outside .github PASSED"); bad++; }
    rmSync(join(tmp, "ci"), { recursive: true });
    put("docs/other.yml", "a: [unclosed\n");
    if (scan().length !== 0) { console.error("✗ self-test: an unparseable non-workflow YAML was judged:", scan()); bad++; }
    rmSync(join(tmp, "docs"), { recursive: true });
    put("ci/frag/jobs.yml", `jobs:\n  a:\n    steps:\n      - run: "echo hi${BS}napt-get install -y -qq shellcheck"\n`);
    if (scan().length === 0) { console.error("✗ self-test: a `jobs:` file outside .github with a \\n escape PASSED"); bad++; }
    rmSync(join(tmp, "ci"), { recursive: true });

    put("third_party/sc/action.yml", "runs:\n  using: composite\n  steps:\n    - run: apt-get install -y shellcheck\n      shell: bash\n");
    if (scan().length === 0) { console.error("✗ self-test: a composite action under third_party PASSED"); bad++; }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  if (bad) process.exit(1);
  console.log(`✓ check-ci-shellcheck-step self-test: canonical passes; ${variants.length + extras.length + 1} broken shapes all fail; ${strayCases.length} unpinned-install, ${grammarCases.length} parse and 12 repo-walk cases behave`);
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
