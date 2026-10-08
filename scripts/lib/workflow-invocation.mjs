// workflow-invocation.mjs — "does this workflow RUN this gate?", shared by the two gates that ask it.
//
// Moved verbatim out of scripts/check-preflight-ci-parity.mjs (2026-10-08, plan row 43) so
// scripts/check-gate-self-tests-run.mjs applies the SAME rules instead of a looser copy of them
// (the first copy credited `echo node …`, a quoted `|`, `continue-on-error` and a folded
// `run: >` that this matcher refuses; review round 1 on PR #1460). The parity gate cannot be
// imported for this because it runs its whole check at import time; this module has no
// side effects. Change a rule HERE and both gates move together — and the parity gate's
// self-test (which drives these exports) holds it.
//
// ONE DEVIATION from the moved text (review round 4): `--self-test` must not be followed by `[\w-]`, so a step
// running `--self-test-not` no longer credits the gate (the original `\b` matched before the `-`). Stricter only.

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// YAML comments must not count as invocations. A workflow that merely NAMES a gate
// in a `# comment` was credited by the old `blob.includes(gate)`, so a gate could
// be de-registered in CI while this check stayed green — the same defect
// check-gate-census.mjs fixed with run-position matching. `#` opens a comment at
// line start or after whitespace (standard YAML), and the gate invocations here
// never depend on a literal `#`, so truncating there is safe for matching.
export function stripYamlComments(text) {
  return text
    .split("\n")
    .map((line) => line.replace(/(^|\s)#.*$/, "$1"))
    .join("\n");
}

// WHAT COUNTS AS AN INVOCATION (tightened 2026-10-08, Codex on PR #1450).
//
// The first matcher credited a gate whenever its path appeared ANYWHERE in the
// comment-stripped workflow text after whitespace. So `name: scripts/mac/x.sh
// --self-test` beside `run: echo nope`, or `run: echo node scripts/check-x.mjs`,
// credited the gate: the real CI step could be deleted while a label or an echo kept
// this check green, which is the exact failure it exists to catch. Two parts now:
//
//   1. WHERE: only the command text of a `run:` step is searched — the inline value
//      plus the continuation lines of a block scalar (`run: |`) or a wrapped plain
//      scalar. `name:`, `description:`, `env:`, `with:` and github-script bodies can
//      never credit a gate.
//   2. WHICH POSITION: within that text the head must stand where a shell would run
//      it — the start of a line, or after `;`, `&&`, `||`, `|`, `&` or `(` — after
//      optional `VAR=value` prefixes, and for a script path also after `bash`, `sh`,
//      `source` or `.`. Never after `echo`, inside quotes, or inside a comment.
//   3. QUOTES ARE MASKED FIRST (second Codex pass, same PR): `run: echo "disabled |
//      node scripts/check-x.mjs"` still credited the gate, because the `|` inside the
//      quotes looked like a command boundary. Every single- and double-quoted span
//      (backslash escapes inside double quotes honoured, `$(…)` and backticks inside
//      them kept inside the span) is replaced by filler before the position test, so a
//      separator in quotes is not a boundary and a gate path in quotes is not a run.
//      The YAML `|` after `run:` is not shell and is handled before this.
//
//   4. WHAT THE SHELL RECEIVES (round 2, same PR): YAML folds a `run: >` scalar (also `>-`,
//      `>+`), and a plain `run:` value wrapped onto indented lines, into ONE line, so
//      `echo skipped` on the first line swallows a script named on the next; a `run: |`
//      block keeps its lines (and a trailing backslash joins them, as the shell sees it).
//      `bash -n` / `sh -n` is a syntax check, not a run, so a runner flag outside e, u, x,
//      v, f credits nothing. A step with `continue-on-error` set to anything but `false`
//      cannot fail CI, so it credits nothing.
//
// A gate invoked some other way (`bash -c "…"`, a wrapper such as `timeout 60`, a
// `then`/`do` clause) is NOT credited and the parity run says UNWIRED; the fix is to
// write the step in a plain shape, not to widen this matcher.
//
// KNOWN LIMITS (credited today although the step would not really gate; each is pinned by a
// "KNOWN GAP" assertion in the self-test, so closing one is a visible change, not a silent
// one): a command that cannot fail or never runs (`false && bash x.sh --self-test`,
// `bash x.sh --self-test || true`); a heredoc body that names the script; a step or job
// `if:` condition; a job-level `continue-on-error`. Parsing a shell is not this file's job;
// these need a step to be written that way on purpose.

const indentOf = (l) => l.length - l.trimStart().length;

/** Pure: a folded YAML scalar as the lines the shell receives. `first` is text already on
 *  the key's line (plain scalars), `cont` the raw continuation lines. Consecutive lines fold
 *  into one with single spaces; a blank line ends the current line; with `base` given (a `>`
 *  block), a line indented deeper than `base` is kept on a line of its own. */
function foldScalar(first, cont, base) {
  const out = [];
  let cur = first === "" ? null : first;
  for (const raw of cont) {
    const t = raw.trim();
    if (t === "") { if (cur !== null) out.push(cur); cur = null; continue; }
    if (base !== undefined && indentOf(raw) > base) { if (cur !== null) out.push(cur); cur = null; out.push(t); continue; }
    cur = cur === null ? t : `${cur} ${t}`;
  }
  if (cur !== null) out.push(cur);
  return out;
}

/** Pure: one record per `run:` step in YAML (comments already stripped): the command text the
 *  shell receives, and whether the step is `continue-on-error` (anything but a literal
 *  `false`: its failure cannot fail CI). Scalar styles follow YAML: `|` literal (lines kept,
 *  a trailing backslash joins the next), `>` folded, plain/quoted wrapped (lines fold into
 *  one). Exported for the self-test. */
export function runSteps(text) {
  const lines = text.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^([ \t]*)(-[ \t]+)?run:[ \t]*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const keyCol = m[1].length + (m[2] ? m[2].length : 0);
    let inline = m[3].trim();
    const ind = /^([|>])[+-]?\d*$/.exec(inline);
    const style = ind ? ind[1] : "plain";
    if (ind) inline = "";
    inline = inline.replace(/^(["'])(.*)\1$/, "$2");
    // continuation: blank lines, or lines indented deeper than the `run` key itself
    const cont = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() !== "" && indentOf(lines[j]) <= keyCol) break;
      cont.push(lines[j]);
    }
    const body = style === "|"
      ? cont.map((l) => l.trim()).join("\n").replace(/\\\n[ \t]*/g, " ")
      : foldScalar(inline, cont, style === ">" ? indentOf(cont.find((l) => l.trim() !== "") ?? "") : undefined).join("\n");

    // the step mapping: from its `- ` line (or this one) to the first line indented less than keyCol
    let start = i;
    if (!m[2]) {
      for (let j = i - 1; j >= 0; j--) {
        if (lines[j].trim() === "" || indentOf(lines[j]) >= keyCol) continue;
        const d = /^[ \t]*-[ \t]+/.exec(lines[j]);
        if (d && d[0].length === keyCol) start = j;
        break;
      }
    }
    let end = i + 1 + cont.length;
    while (end < lines.length && (lines[end].trim() === "" || indentOf(lines[end]) >= keyCol)) end++;
    let continueOnError = false;
    for (let j = start; j < end; j++) {
      const dash = j === start && start !== i ? /^[ \t]*-[ \t]+/.exec(lines[j]) : null;
      const col = dash ? dash[0].length : indentOf(lines[j]);
      const k = /^continue-on-error:[ \t]*(.*)$/.exec(lines[j].slice(dash ? dash[0].length : col));
      if (col === keyCol && k && k[1].trim().replace(/^(["'])(.*)\1$/, "$2").toLowerCase() !== "false") continueOnError = true;
    }
    out.push({ command: body, continueOnError });
  }
  return out;
}

/** Pure: the command text of every `run:` step that can fail CI, one string per step. */
export function runCommands(text) {
  return runSteps(text).filter((st) => !st.continueOnError).map((st) => st.command);
}

/** Pure: `cmd` with every shell-quoted span (quotes included) replaced by a filler
 *  character of the same length, so nothing inside quotes can look like a command
 *  boundary or a command. Single quotes end at the next `'`. Double quotes end at the
 *  next `"` that is not backslash-escaped; a `$(…)` (with its own quotes and
 *  parentheses) or a backtick span inside them stays inside the span. An unterminated
 *  quote masks to the end, so a half-written line credits nothing. Outside quotes a
 *  backslash masks itself and the character it escapes (`\;` is not a separator). */
export function maskQuoted(cmd) {
  const FILL = "\u0001";
  const n = cmd.length;
  const single = (i) => { let j = i + 1; while (j < n && cmd[j] !== "'") j++; return Math.min(j + 1, n); };
  const backtick = (i) => { let j = i + 1; while (j < n && cmd[j] !== "`") j += cmd[j] === "\\" ? 2 : 1; return Math.min(j + 1, n); };
  const subshell = (i) => { // i is just after "$(" ; returns the index after the matching ")"
    let depth = 1, j = i;
    while (j < n && depth > 0) {
      const c = cmd[j];
      if (c === "'") j = single(j);
      else if (c === '"') j = double(j);
      else if (c === "\\") j += 2;
      else if (c === "(") { depth++; j++; }
      else if (c === ")") { depth--; j++; }
      else j++;
    }
    return Math.min(j, n);
  };
  function double(i) {
    let j = i + 1;
    while (j < n && cmd[j] !== '"') {
      if (cmd[j] === "\\") j += 2;
      else if (cmd[j] === "$" && cmd[j + 1] === "(") j = subshell(j + 2);
      else if (cmd[j] === "`") j = backtick(j);
      else j++;
    }
    return Math.min(j + 1, n);
  }
  let out = "";
  for (let i = 0; i < n; ) {
    const c = cmd[i];
    const j = c === "'" ? single(i) : c === '"' ? double(i) : c === "\\" ? Math.min(i + 2, n) : -1;
    if (j < 0) { out += c; i++; } else { out += FILL.repeat(j - i); i = j; }
  }
  return out;
}

const SEP = String.raw`(?:^[ \t]*|(?:&&|\|\||[;|&(])[ \t]*)`; // line start, or right after a command separator
const ENV = String.raw`(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"\n]*"|'[^'\n]*'|\S*)[ \t]+)*`; // FOO=1 BAR="x y" prefixes
// Runner flags are limited to e u x v f: `-n` (parse only), `-c` (the next word is a command
// string) and the rest do not run the script as a script.
const SHELL_RUNNER = String.raw`(?:(?:bash|sh|source|\.)[ \t]+(?:-[euxvf]+[ \t]+)*)?(?:\./)?`;

// Does the `run:` command text INVOKE this head? `head` is a script path
// (`scripts/x.mjs`, `scripts/mac/x.sh`) or an npm-script name (`review:invariants`).
export function invokes(head, wantsSelfTest, commands) {
  const g = escapeRe(head);
  const text = commands.join("\n");
  const test = (re) => new RegExp(re, "m").test(text);
  if (head.includes("/")) {
    const base = head.endsWith(".mjs")
      ? String.raw`${SEP}${ENV}node[ \t]+${g}` // node scripts/x.mjs
      : String.raw`${SEP}${ENV}${SHELL_RUNNER}${g}`; // bash scripts/x.sh, or the path run directly
    if (wantsSelfTest) return test(`${base}(?:[ \\t]+--?[\\w=-]+)*[ \\t]+--self-test(?![\\w-])`);
    return test(`${base}(?![ \\t]+--self-test)(?![\\w./-])`);
  }
  // npm-script name: `pnpm|npm|$PNPM run <name>`, flags allowed, command position only.
  const run = String.raw`${SEP}${ENV}(?:\$PNPM|pnpm|npm)(?:[ \t]+--?[\w-]+(?:=\S+)?)*[ \t]+run[ \t]+(?:--?[\w-]+[ \t]+)*${g}(?![\w:-])`;
  if (wantsSelfTest) return test(`${run}(?:[ \\t]+--)?[ \\t]+--self-test(?![\\w-])`);
  return test(`${run}(?!(?:[ \\t]+--)?[ \\t]+--self-test)`);
}

/** Pure: is `gate` invoked (not merely mentioned) in the workflow text, by path
 *  or by any npm-script alias? Exported so the self-test drives it directly. */
export function gateWiredIn(gate, rawWorkflowText, aliasMap = new Map()) {
  const commands = runCommands(stripYamlComments(rawWorkflowText)).map(maskQuoted);
  const wantsSelfTest = / --self-test$/.test(gate);
  const head = gate.replace(/ --self-test$/, "");
  if (invokes(head, wantsSelfTest, commands)) return true;
  if (head.includes("/")) {
    const file = head.split("/").pop();
    for (const alias of aliasMap.get(file) ?? []) {
      if (invokes(alias, wantsSelfTest, commands)) return true;
    }
  }
  return false;
}
