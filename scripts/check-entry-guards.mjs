// Entry-guard gate — a module's gate body may only run when the module IS the entry.
//
//   node scripts/check-entry-guards.mjs              # the gate
//   node scripts/check-entry-guards.mjs --self-test  # the detector, both directions
//
// THE DEFECT (reproduced 2026-09-06). A gate that also EXPORTS its machinery has to
// decide whether it was run or merely imported. Two spellings are in this tree:
//
//   EXACT   import.meta.url === pathToFileURL(process.argv[1]).href
//   SUFFIX  import.meta.url.endsWith(process.argv[1].split("/").pop())
//
// The suffix form compares the entry script's BASENAME against the end of this module's
// URL, so it fires for any entry whose filename ends with this one's — including a
// script that only imports the module. Reproduced against `check-decision-palette.mjs`:
// a scratch file named `check-decision-palette.mjs` whose whole body was
// `import { contrast } from "<the module>"` ran the entire gate; the same file renamed
// to `other-name.mjs` did not. The gate's scope depended on the caller's filename.
//
// `check-lab-registry.mjs:359-360` had already diagnosed exactly this ("an adversarial
// review proved the suffix form fires for an entry named like this file") and fixed its
// own copy. That is the shape this gate exists for: a hazard understood in one file and
// still live in others. Two more were found and fixed on 2026-09-06
// (check-decision-palette, check-assist-wire-served); the other four were converted in the same batch.
//
// THE SECOND DEFECT (filed 2026-10-17, reproduced 2026-10-22). Both EXACT spellings are
// symlink-blind: `import.meta.url` is the module's real path and `process.argv[1]` is
// not resolved, so `node <symlinked dir>/scripts/<gate>.mjs` imports the module,
// matches nothing and exits 0 having checked nothing. `--self-test` printed 14 lines
// started directly and 0 lines (exit 0) started through a symlinked copy of the repo.
// The guard is now `isMainModule(process.argv[1], import.meta.url)` from
// `scripts/lib/is-main.mjs` (realpath on both sides); either raw spelling in a tracked
// script is a finding unless the file is on DECLARED_RAW_GUARD_DEBT below.
//
// WHAT IS GATED: three things, outside the declared lists.
//   1. in any tracked `scripts/**/*.mjs`, the SUFFIX form (the first defect above);
//   2. in the same files, a SHAPE (rawGuards): a statement that compares `process.argv[1]` with the module's
//      own path unless it goes through `isMainModule` or a realpath call wraps EACH compared operand; a literal
//      `.endsWith(..)`/`.startsWith(..)`/`.includes(..)` test or a basename compare of `process.argv[1]`; every
//      `isMainModule` reference that is not the named import or an exact direct call (swapped, aliased, nested, member, `?.(`,
//      `.call`, a wrapper function). Judged one comparison at a time. Read from code through a lexer (comments, strings and regex
//      literals blanked, template expressions kept); `process.argv[1]` is recognised as .argv[1], ?.[1], .at(1),
//      ["argv"][1] and through `const x = process.argv[1]` / `const [, x] = process.argv`; the self path as
//      import.meta.url / .filename and through a `const` bound to fileURLToPath(..), resolve(..) of it or
//      `new URL(import.meta.url).pathname`. NOT detected, each pinned as a miss in the self-test:
//      a self path built by a function the detector cannot see; a comparison split across two statements by a
//      boolean; `let x; x = process.argv[1]`; `const args = process.argv; args[1]`; `const { argv: [, x] } =
//      process`; `import { argv } from "node:process"`; any argv read through a parameter; `switch
//      (process.argv[1]) { case <self path>: }`; `new Set([process.argv[1]]).has(<self path>)`; inversion of an
//      exact helper call (`!(isMainModule(..))`, `=== false`, `|| run()`); a `/` after `)` read as a division,
//      which can hide an import later on the same line; a gate started as `node -e "await import('<gate>')" <gate
//      path>` (argv[1] is then the gate path; the helper has the same property). The lexer is a heuristic, not a
//      parser;
//   3. the fixture-IdP compose overlay (fixtureOverlayProblems): scripts/fixture-idp.compose.yml bind-mounts the converted
//      fixture-idp.mjs into a bare container, so it must mount scripts/lib/is-main.mjs beside it; two literal, non-comment
//      volume lines are asserted. That is a LITERAL assertion: a mount moved to another service still passes it, and the
//      CI compose smoke (it requires a fixture-signed 200) is the check on the container. The general model - which
//      scripts ship alone in which container and what each imports - is NOT in this gate; it is its own gate,
//      scripts/check-shipped-imports.mjs, on branch claude/build-shipped-import-model.
//
// THIS GATE DOES NOT DEPEND ON THE HELPER TO RUN. Its own entry guard is written out below and, before anything
// else, it exercises `isMainModule` (helperCanary): a helper that silently breaks makes every adopter exit 0 with
// no output, and this is the one place that notices. What is NOT watched: that a step's exit 0 came with its
// `self-test passed (N/N)` line (the preflight step and the CI step check the exit code only; filed as its own row).
// `node scripts/check-entry-guards.mjs --mutants` applies this file's mutation set (MUTANTS) to a clean tree and
// prints the kill tally; it is not part of preflight.
//
// SCOPE IS DERIVED: `git ls-files scripts/**/*.mjs`, so a new script joins the scan the
// moment it is tracked; an untracked scratch file cannot widen or narrow it.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { codeOnly } from "./lib/code-only.mjs";
import { scratchGitOk } from "./lib/scratch-git.mjs";
import { isMainModule } from "./lib/is-main.mjs";

export { codeOnly };

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// A FILE FLOOR on the derivation: this repository has well over a hundred tracked
// scripts, so a scan that finds a handful has drifted rather than shrunk.
const FILE_FLOOR = 100;
// …and a floor on the POSITIVE control: the exact form must be found in the tree, or
// the detector is only ever agreeing with itself about the form it cannot see.
const EXACT_GUARD_FLOOR = 20;
// …and one on the helper's adoption, so the sweep cannot quietly shrink back.
const HELPER_ADOPTER_FLOOR = 50;

/**
 * KNOWN DEBT, not exemptions-by-taste. Every entry must STILL carry the suffix form —
 * an entry whose file has been fixed fails this gate with "remove the entry", so the
 * list cannot fossilise into a permanent carve-out. Each fix is one line:
 *
 *   -if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
 *   +if (isMainModule(process.argv[1], import.meta.url)) {
 *
 * plus `import { isMainModule } from "./lib/is-main.mjs";` (the relative depth of the file). They are listed rather than fixed
 * here because they belong to other engineers' file sets in the batch that found this;
 * the gate is what stops a fifth from appearing while they land.
 */
// Empty by design as of 2026-09-06: the four scripts that carried the suffix form
// (check-licence-policy, check-reason-codes, check-scheduled-routines, gen-reason-codes)
// were converted to the exact-match guard (now `isMainModule(process.argv[1], import.meta.url)`)
// form in this same batch, so nothing is declared here. A new entry belongs here ONLY
// while a suffix-form fix is genuinely deferred to a later change; it is debt, not a
// resting state — the gate flags a declared entry whose file no longer uses the form.
const DECLARED_SUFFIX_GUARDS = new Map([]);

/**
 * KNOWN DEBT for the RAW exact spellings (see THE SECOND DEFECT). Same rule as above: an
 * entry whose file no longer carries a raw spelling fails this gate with "remove the
 * entry". A file belongs here only while the owner has not merged its conversion.
 */
const CALLS_HELPER_FREELY = new Set(["scripts/check-entry-guards.mjs"]); // this file calls isMainModule with other arguments to test it

const DECLARED_RAW_GUARD_DEBT = new Map([
  [
    "scripts/mutation-guard.mjs",
    {
      reason:
        "shared surface (CLAUDE.md, Multiple Claude lanes): declared here, converted by the lane that owns it",
      hits: ["constIS_MAIN=process.argv[1]!==undefined&&import.meta.url===newURL(`(resolve(process.argv[1]))`).href"],
    },
  ],
  [
    "scripts/check-row-status-drift.mjs",
    {
      reason:
        "its entry guard is converted; the remaining finding is a fail-loud canary (`basename(argv[1]) === basename(self)` with extra args refuses when the guard said 'imported'), which is not an entry guard",
      hits: ["elseif(process.argv[1]&&basename(process.argv[1])===basename(fileURLToPath(import.meta.url))&&process.argv.length>2)"],
    },
  ],
  [
    "scripts/check-owner-gated-surfaces.mjs",
    {
      reason:
        "build-tick.sh classify_change extracts this ONE file with `git show` into a cache dir and imports it there, where a relative `./lib/is-main.mjs` cannot resolve; its guard stays self-contained until the extraction ships the helper too",
      hits: ["if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)"],
    },
  ],
  [
    "scripts/check-launch-proof-bindings.mjs",
    {
      reason:
        "launch-profile family: the owner merges launch-surface scripts, so the conversion is left to that merge",
      hits: ["if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)"],
    },
  ],
]);

// Two spellings of the same exact comparison, kept for hasExactGuard (declared debt still counts as a guard).
const RAW_GUARD_PATTERNS = [
  /import\.meta\.url\s*===\s*pathToFileURL\(\s*process\.argv\[1\]\s*\)\.href/,
  /resolve\(\s*process\.argv\[1\]\s*\)\s*===\s*fileURLToPath\(\s*import\.meta\.url\s*\)/,
];

// process.argv[1] in the spellings below: .argv[1], ?.[1], .at(1) and ["argv"][1] (codeOnly blanks the string, so the
// bracket form reaches the matcher as `process["    "][1]`).
const ARGV1_SRC = String.raw`process\s*(?:\.\s*argv\s*(?:\?\.)?\s*\[\s*1\s*\]|\.\s*argv\s*\.\s*at\s*\(\s*1\s*\)|\[\s*(?:"\s*"|'\s*'|\x60\s*\x60)\s*\]\s*\[\s*1\s*\])`;
const ARGV1 = new RegExp(ARGV1_SRC);
const SELF_PATH = /import\s*\.\s*meta\s*\.\s*(?:url|filename)|\b(?:SELF_FILE|SELF_PATH|SELF|THIS_FILE|__filename)\b/;
// A name bound to this module's own path, or to process.argv[1], is the same thing under another name. The name
// pattern allows `$`, and the lookarounds below (not \b, which never matches before `$`) bound it.
const NAME = String.raw`([A-Za-z_$][\w$]*)`;
const SELF_VALUE = String.raw`(?:(?:\w+\.)?(?:resolve|normalize)\s*\(\s*)?(?:(?:\w+\.)?fileURLToPath\s*\(\s*import\s*\.\s*meta\s*\.\s*url\s*\)|import\s*\.\s*meta\s*\.\s*(?:url|filename)|new\s+URL\s*\(\s*import\s*\.\s*meta\s*\.\s*url\s*\)\s*\.\s*pathname)\s*\)?`;
const SELF_ALIAS = new RegExp(String.raw`\b(?:const|let|var)\s+${NAME}\s*=\s*${SELF_VALUE}\s*[;,\n]`, "g");
const ARGV_ALIAS = new RegExp(String.raw`\b(?:const|let|var)\s+${NAME}\s*=\s*${ARGV1_SRC}`, "g");
const ARGV_DESTRUCTURE = new RegExp(String.raw`\b(?:const|let|var)\s*\[[^\],]*,\s*${NAME}[^\]]*\]\s*=\s*process\s*\.\s*argv\b`, "g");
const escapeRe = (n) => n.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
const wordOf = (names) => (names.length ? new RegExp(`(?<![\\w$])(?:${names.map(escapeRe).join("|")})(?![\\w$])`) : null);
const REAL_CALL = /\breal\w*\s*\(/;

const nowhite = (t) => t.replace(/\s+/g, "");

/** Scratch directories this process made; removed on exit and on SIGINT/SIGTERM so an interrupted run leaks none. */
const SCRATCH = new Set();
const scratchDir = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  SCRATCH.add(dir);
  return dir;
};
const dropScratch = (dir) => {
  rmSync(dir, { recursive: true, force: true });
  SCRATCH.delete(dir);
};
const dropAllScratch = () => {
  for (const d of [...SCRATCH]) dropScratch(d);
};

/**
 * Pure: the TERMS of an expression in code form: it is split at every depth-0 separator (`&&` `||` `??` `&` `|` `?` `:` `,`),
 * and each parenthesised/bracketed/braced group is split again from its inside, so every comparison is judged against its
 * OWN two operands and a realpath pair in one term cannot excuse a raw comparison in another. `?.` is not a separator.
 * Each term is { text, offset } (offset into `expr`); a term keeps its nested groups' text.
 */
export function termsOf(expr, base = 0, out = []) {
  let depth = 0;
  let start = 0;
  let open = 0;
  const cut = (end, next) => {
    out.push({ text: expr.slice(start, end), offset: base + start });
    start = next;
  };
  for (let i = 0; i < expr.length; i += 1) {
    const c = expr[i];
    const d = expr[i + 1];
    if (c === "(" || c === "[" || c === "{") {
      if (depth === 0) open = i;
      depth += 1;
    } else if (c === ")" || c === "]" || c === "}") {
      depth -= 1;
      if (depth === 0) termsOf(expr.slice(open + 1, i), base + open + 1, out);
    } else if (depth === 0) {
      if ((c === "&" && d === "&") || (c === "|" && d === "|") || (c === "?" && d === "?")) {
        cut(i, i + 2);
        i += 1;
      } else if (c === "&" || c === "|" || c === "," || c === ":" || (c === "?" && d !== ".")) cut(i, i + 1);
    }
  }
  out.push({ text: expr.slice(start), offset: base + start });
  return out;
}

/** Index just past the `)` that closes the `(` at `open`, in code form; -1 when unbalanced. */
function closeParen(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === "(") depth += 1;
    else if (code[i] === ")") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

const EXACT_ARGS = "process.argv[1],import.meta.url";

/**
 * Pure: every reference to `isMainModule` that is NOT one of the four sanctioned forms - the named import clause, a definition,
 * a plain `export { isMainModule }`, a direct call written exactly `isMainModule(process.argv[1], import.meta.url)` - with
 * balanced parentheses. Aliases (`const im = isMainModule`), `?.(`, `.call`, member calls (`ns.isMainModule(`), a `x as
 * isMainModule` re-export, a dynamic destructure, a default import and a call with any other arguments (swapped, another index,
 * nested, a wrapper's parameters) each leave the body never running or running on import. NOT judged (named as ceilings):
 * inversion of an exact call (`!(isMainModule(..))`, `=== false`, `|| run()`).
 */
function helperReferences(code) {
  const found = [];
  const clauses = [...code.matchAll(/\bimport\s*\{([^}]*)\}\s*from\b/g)].map((m) => [m.index, m.index + m[0].length, m[1]]);
  // `export { a, isMainModule }` (any distance after the brace, with or without `from`): a plain name is a re-export, `x as isMainModule` is not
  const exportClauses = [...code.matchAll(/\bexport\s*\{([^}]*)\}/g)].map((m) => [m.index, m.index + m[0].length, m[1]]);
  for (const m of code.matchAll(/(?<![\w$])isMainModule(?![\w$])/g)) {
    const i = m.index;
    const clause = clauses.find(([lo, hi]) => i >= lo && i < hi);
    if (clause) {
      if (new RegExp(String.raw`(?<![\w$])isMainModule\s+as\s`).test(clause[2])) found.push([i, "re-binds the imported isMainModule under another name"]);
      continue; // the specifier is checked by helperImportProblems
    }
    const exp = exportClauses.find(([lo, hi]) => i >= lo && i < hi);
    if (exp) {
      if (/\bas\s+$/.test(code.slice(exp[0], i))) found.push([i, "re-exports another binding under the name isMainModule"]);
      continue;
    }
    const before = code.slice(Math.max(0, i - 40), i);
    const after = code.slice(i + m[0].length);
    if (/\b(?:function|const|let|var|class)\s+$/.test(before) || /\basync\s+function\s+$/.test(before)) continue; // a definition (judged by helperImportProblems)
    if (/\bimport\s+$/.test(before)) {
      found.push([i, "default-imports a binding named isMainModule"]);
      continue;
    }
    if (/(?:\.|\?\.)\s*$/.test(before)) {
      found.push([i, "calls or reads isMainModule through a member or namespace"]);
      continue;
    }
    const open = after.search(/\S/);
    if (open < 0 || after[open] !== "(") {
      found.push([i, "references isMainModule other than as a direct call (an alias, ?.(, .call or a re-export)"]);
      continue;
    }
    const end = closeParen(code, i + m[0].length + open);
    const args = end < 0 ? "" : nowhite(code.slice(i + m[0].length + open + 1, end - 1)).replace(/,$/, ""); // a trailing comma is formatting
    if (args !== EXACT_ARGS) found.push([i, "calls isMainModule with something other than exactly (process.argv[1], import.meta.url) - swapped, aliased, another index, nested, or a wrapper's parameters"]);
  }
  return found;
}

/**
 * Pure: the symlink-blind entry guards in one file's text, with line numbers. Not a list of spellings but a SHAPE, read from
 * code (comments, strings and regex literals blanked), judged one COMPARISON at a time (termsOf):
 *   - `process.argv[1]` (spelled .argv[1], ?.[1], .at(1), ["argv"][1], or a name bound to it by `const x = process.argv[1]` or
 *     `const [, x] = process.argv`) compared with this module's own path (import.meta.url, import.meta.filename, or a name
 *     bound to `fileURLToPath(import.meta.url)` / `resolve(...)` of it / `new URL(import.meta.url).pathname`), either operand
 *     order, however wrapped, unless a realpath call wraps EACH compared operand;
 *   - `.endsWith(`/`.startsWith(`/`.includes(` with the self path on one side and process.argv[1] on the other, in either
 *     order and across lines (kind "suffix": the first defect), or with process.argv[1] on one side and a literal on the
 *     other, or a basename compare of process.argv[1];
 *   - every `isMainModule` reference that is not a sanctioned form (helperReferences).
 * A raw comparison ORed with a helper call is still a finding: the helper call is removed before the rest is read.
 * NOT detected, each pinned as a miss in the self-test: see KNOWN_MISSES.
 */
export function rawGuards(text, { callsHelperFreely = false } = {}) {
  const code = codeOnly(text);
  const names = (re) => [...code.matchAll(re)].map((m) => m[1]);
  const argvWord = wordOf([...names(ARGV_ALIAS), ...names(ARGV_DESTRUCTURE)]);
  const selfWord = wordOf(names(SELF_ALIAS));
  const out = [];
  const add = (reason, at, from, to, kind = "raw") => {
    const t = code.slice(from, to).replace(/\s+/g, " ").trim();
    out.push({ line: code.slice(0, at).split("\n").length, text: t.slice(0, 160), key: nowhite(code.slice(from, to)), reason, kind });
  };
  if (!callsHelperFreely) for (const [at, why] of helperReferences(code)) add(why, at, at, at + "isMainModule".length, "helper");
  let start = 0;
  const flush = (end) => {
    const raw = code.slice(start, end);
    const whole = raw.replace(/\bisMainModule\s*\(\s*process\s*\.\s*argv\s*\[\s*1\s*\]\s*,\s*import\s*\.\s*meta\s*\.\s*url\s*\)/g, " ");
    for (const term of termsOf(whole)) {
      const argvHit = ARGV1.exec(term.text) ?? (argvWord ? argvWord.exec(term.text) : null);
      if (!argvHit) continue;
      const selfHit = SELF_PATH.test(term.text) || (selfWord !== null && selfWord.test(term.text));
      const method = /\.\s*(?:endsWith|startsWith|includes)\s*\(/.test(term.text);
      // depth-0 comparison operator of THIS term
      let depth = 0;
      let op = null;
      for (let i = 0; i < term.text.length && !op; i += 1) {
        const c = term.text[i];
        if ("([{".includes(c)) depth += 1;
        else if (")]}".includes(c)) depth -= 1;
        else if (depth === 0) {
          const m = /^(?:===|!==|==|!=)/.exec(term.text.slice(i));
          if (m) op = { index: i, length: m[0].length };
        }
      }
      let realBoth = op !== null && REAL_CALL.test(term.text.slice(0, op.index)) && REAL_CALL.test(term.text.slice(op.index + op.length));
      // Object.is(a, b) is a comparison too: a realpath call must wrap each of its two arguments.
      const objectIs = /\bObject\s*\.\s*is\s*\(/.test(term.text);
      if (objectIs && !op) {
        op = { index: 0, length: 0 };
        realBoth = (term.text.match(/\breal\w*\s*\(/g) ?? []).length >= 2;
      }
      let reason = null;
      let kind = "raw";
      if (method && selfHit) {
        reason = "tests process.argv[1] against this module's own path with endsWith/startsWith/includes (the basename-suffix defect)";
        kind = "suffix";
      } else if (op && selfHit && !realBoth) reason = "compares process.argv[1] with this module's own path";
      else if (new RegExp(`(?:${ARGV1_SRC})\\s*\\)?\\s*\\.\\s*(?:endsWith|startsWith|includes)\\s*\\(`).test(term.text)) {
        reason = "tests process.argv[1] against a literal (the basename-suffix defect)";
        kind = "suffix";
      } else if (op && new RegExp(`\\bbasename\\s*\\(\\s*(?:${ARGV1_SRC})\\s*\\)`).test(term.text)) reason = "compares the basename of process.argv[1]";
      if (reason) {
        add(reason, start + term.offset + argvHit.index, start, end, kind);
        break;
      }
    }
    start = end + 1;
  };
  for (let i = 0; i < code.length; i += 1) if (code[i] === ";" || code[i] === "{" || code[i] === "}") flush(i);
  flush(code.length);
  return out;
}

/** The detector's pinned misses, in the words every ceiling list uses. */
export const KNOWN_MISSES = [
  "a self path built by a function the detector cannot see",
  "a comparison split across two statements by a boolean",
  "`let x; x = process.argv[1]`",
  "`const args = process.argv; args[1]`",
  "`const { argv: [, x] } = process`",
  '`import { argv } from "node:process"`',
  "any argv read through a parameter",
  "`switch (process.argv[1]) { case <self path>: }`",
  "`new Set([process.argv[1]]).has(<self path>)`",
  "inversion of an exact helper call (`!(isMainModule(..))`, `=== false`, `|| run()`)",
  "a `/` after `)` read as a division, which can hide an import later on the same line",
  "a gate started as `node -e \"await import('<gate>')\" <gate path>` (argv[1] is then the gate path; the helper has the same property)",
];

const HELPER_CALL = /(?<![\w$.])isMainModule\s*\(\s*process\.argv\[1\]\s*,\s*import\.meta\.url\s*\)/;

/**
 * Child process, not a regex: start a helper-guarded scratch module through a SYMLINKED
 * directory and report whether its body ran. `helperSource` is the helper under test, so
 * the self-test can feed it a mutant.
 */
export function probeHelper(helperSource) {
  const dir = scratchDir("entry-guard-");
  const ran = (args, cwd) => {
    try {
      return execFileSync(process.execPath, args, { encoding: "utf8", cwd }).includes("BODY-RAN");
    } catch {
      return false;
    }
  };
  try {
    mkdirSync(join(dir, "real", "lib"), { recursive: true });
    writeFileSync(join(dir, "real", "lib", "is-main.mjs"), helperSource);
    const modPath = join(dir, "real", "mod.mjs");
    writeFileSync(
      modPath,
      'import { isMainModule } from "./lib/is-main.mjs";\nif (isMainModule(process.argv[1], import.meta.url)) console.log("BODY-RAN");\n',
    );
    writeFileSync(join(dir, "real", "importer.mjs"), 'await import("./mod.mjs");\n');
    mkdirSync(join(dir, "elsewhere"), { recursive: true });
    writeFileSync(join(dir, "elsewhere", "mod.mjs"), `await import(${JSON.stringify(pathToFileURL(join(dir, "real", "mod.mjs")).href)});\n`);
    symlinkSync(join(dir, "real"), join(dir, "link"));
    const spec = JSON.stringify(pathToFileURL(modPath).href);
    return {
      // MUST run: started as the entry, through a symlinked directory
      symlinkedStart: ran([join(dir, "link", "mod.mjs")], dir),
      // import.meta.url keeps the SYMLINK path here, so a realpath on only one side stops matching
      preservedSymlinkStart: ran(["--preserve-symlinks", "--preserve-symlinks-main", join(dir, "link", "mod.mjs")], dir),
      // MUST NOT run: imported by another file, and imported from `node -e` (with a dummy argv[1], and with none)
      importedByFile: ran([join(dir, "real", "importer.mjs")], dir),
      // MUST NOT run: a DIFFERENT file with the same basename starts and imports it (the first defect, through the helper)
      importedBySameName: ran([join(dir, "elsewhere", "mod.mjs")], dir),
      importedFromEvalWithArg: ran(["--input-type=module", "-e", `await import(${spec});`, "dummy-arg"], dir),
      importedFromEvalNoArg: ran(["--input-type=module", "-e", `await import(${spec});`], dir),
    };
  } finally {
    dropScratch(dir);
  }
}

/** Pure: the suffix-form entry guards in one file's text, with line numbers. */
export function suffixGuards(text) {
  // A statement, not a line: the guard may be wrapped over several lines and the operands may come in either order.
  return rawGuards(text, { callsHelperFreely: true }).filter((h) => h.kind === "suffix").map((h) => ({ line: h.line, text: h.text }));
}

/** Pure: does this text carry an EXACT entry guard: the helper call, or either raw spelling? */
export function hasExactGuard(text) {
  const code = codeOnly(text);
  return (HELPER_CALL.test(code) && importsHelperByName(text)) || RAW_GUARD_PATTERNS.some((re) => re.test(code));
}

/** Pure: does this file import `isMainModule` by NAME from a module named is-main.mjs (the path is judged by helperImportProblems)? */
function importsHelperByName(text) {
  for (const m of codeOnly(text).matchAll(/\bimport\s*\{[^}]*(?<![\w$])isMainModule(?![\w$])[^}]*\}\s*from\s*(["'])(\s*)\1/dg)) {
    if (/(?:^|\/)is-main\.mjs$/.test(text.slice(m.indices[2][0], m.indices[2][1]))) return true;
  }
  return false;
}

/** Pure: does this file import the shared helper AND call it, outside comments and strings? */
export function adoptsHelper(text) {
  return importsHelperByName(text) && HELPER_CALL.test(codeOnly(text));
}

function trackedDefinitionFiles() {
  const out = execFileSync("git", ["ls-files", "-z", "--", "scripts/*.js", "scripts/**/*.js", "scripts/*.cjs", "scripts/**/*.cjs"], { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out.split("\0").filter(Boolean);
}

function trackedScripts() {
  const out = execFileSync("git", ["ls-files", "--", "scripts/*.mjs", "scripts/**/*.mjs"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.trim().split("\n").filter(Boolean);
}

async function selfTest() {
  const checks = [];
  // ASSEMBLED FROM PARTS, deliberately. Spelled out, these fixture lines are themselves
  // matches, and this file would fail its own gate the moment it became tracked — which
  // is exactly the shape the self-referential guards elsewhere in this repo are written
  // around (`absence-check.mjs` does the same for its shell needles). The last case
  // below asserts the property rather than trusting this comment.
  const BAD = ["import.meta.url", ".ends", "With(", 'process.argv[1].split("/").pop())'].join("");
  const bad = `if (process.argv[1] && ${BAD}) {\n  run();\n}\n`;
  const good = "if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {\n  run();\n}\n";
  const goodAlt = "const IS_ENTRY = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);\n";
  const quoted = `// if (process.argv[1] && ${BAD}) {\n`;
  const unrelated = 'if (name.endsWith(".mjs")) run();\n';

  checks.push(["THE SUFFIX FORM IS FLAGGED — the synthetic violation this gate exists for", suffixGuards(bad).length === 1]);
  checks.push(["…with its line number", suffixGuards(bad)[0]?.line === 1]);
  checks.push(["the exact form is NOT flagged", suffixGuards(good).length === 0]);
  checks.push(["the other exact spelling is NOT flagged either", suffixGuards(goodAlt).length === 0]);
  checks.push(["a COMMENT quoting the bad form is not a call site (this file quotes it)", suffixGuards(quoted).length === 0]);
  checks.push(["an unrelated endsWith is not an entry guard", suffixGuards(unrelated).length === 0]);
  checks.push(["the exact-guard detector recognises both accepted spellings", hasExactGuard(good) && hasExactGuard(goodAlt)]);
  checks.push(["…and does not recognise the suffix form as exact", !hasExactGuard(bad)]);

  // THE RAW SPELLINGS. Assembled from parts for the same reason as BAD: the literal line
  // would be a finding in this very file once it is quoted wrongly.
  const RAW_URL = ["import.meta.url === pathToFileURL(", "process.argv[1]", ").href"].join("");
  const RAW_RES = ["resolve(", "process.argv[1]", ") === fileURLToPath(import.meta.url)"].join("");
  const helper = 'import { isMainModule } from "./lib/is-main.mjs";\nif (isMainModule(process.argv[1], import.meta.url)) {\n  run();\n}\n';
  checks.push(["THE RAW URL SPELLING IS A FINDING", rawGuards(`if (process.argv[1] && ${RAW_URL}) {\n}\n`).length === 1]);
  checks.push(["THE RAW RESOLVE SPELLING IS A FINDING", rawGuards(`const isEntry = process.argv[1] && ${RAW_RES};\n`).length === 1]);
  checks.push(["…with its line number", rawGuards(`x();\nif (${RAW_URL}) {\n}\n`)[0]?.line === 2]);
  checks.push(["the helper call is NOT a finding", rawGuards(helper).length === 0 && hasExactGuard(helper)]);
  checks.push(["a COMMENTED raw spelling is not a finding", rawGuards(`// if (${RAW_URL}) {\n/*\n * ${RAW_RES}\n */\n`).length === 0]);
  checks.push(["a QUOTED raw spelling is not a finding", rawGuards(`const a = "${RAW_URL}";\nconst b = \`${RAW_RES}\`;\n`).length === 0]);
  checks.push(["a raw spelling after a quoted one on the same line IS still a finding", rawGuards(`log("x"); if (${RAW_URL}) {}\n`).length === 1]);

  // THE SHAPE, not two spellings: each of these passed the first version of this gate (rc 0).
  const SELF_P = "SELF_FILE";
  const FILE_U = ["fileURLToPath(import.meta.url)", " === ", "resolve(", "process.argv[1]", ")"].join("");
  checks.push(["REVERSED operands are a finding", rawGuards(`if (${FILE_U}) {\n}\n`).length === 1]);
  checks.push([
    "a comparison WRAPPED across lines is a finding, on the line of process.argv[1]",
    rawGuards(`x();\nif (\n  import.meta.url ===\n    pathToFileURL(\n      resolve(process.argv[1]),\n    ).href\n) {\n}\n`)[0]?.line === 5,
  ]);
  checks.push(["pathToFileURL(resolve(..)).href is a finding", rawGuards(`const IS_MAIN = ${["process.argv[1]"].join("")} !== undefined && import.meta.url === pathToFileURL(resolve(${"process.argv[1]"})).href;\n`).length === 1]);
  checks.push(["new URL(`file://${resolve(..)}`).href is a finding (the template expression is code)", rawGuards("const m = import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href;\n").length === 1]);
  checks.push([`resolve(..) === ${SELF_P} is a finding`, rawGuards(`const ${SELF_P} = fileURLToPath(import.meta.url);\nif (resolve(process.argv[1]) === ${SELF_P}) {\n}\n`).length === 1]);
  checks.push(["a realpath on BOTH sides is not a finding", rawGuards("if (realpathSync(process.argv[1]) === realpathSync(SELF_FILE)) {}\n").length === 0]);
  checks.push(["a realpath on ONE side only is still a finding", rawGuards("if (realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {}\n").length === 1]);
  checks.push(["a script that reads process.argv[1] with no self-path comparison is not a finding", rawGuards('const target = process.argv[1];\nif (target === "--help") usage();\n').length === 0]);

  // A regex literal holding quotes and a backtick must not derail the lexer (it blanked the rest of
  // check-claim-inventory-anchors.mjs, guard included, in the first draft of this detector).
  const REGEX_THEN_GUARD = "const parts = t.split(/[\\s,;:`\"'*\\[\\]]+/);\nconst IS_MAIN = import.meta.url === pathToFileURL(resolve(process.argv[1])).href;\n";
  checks.push(["a regex literal with quotes and a backtick before the guard does not hide it", rawGuards(REGEX_THEN_GUARD).length === 1]);
  checks.push(["a division is not read as a regex (a guard after `a / b` is still seen)", rawGuards("const h = a / b;\nconst m = import.meta.url === pathToFileURL(resolve(process.argv[1])).href;\n").length === 1]);

  // F5: counts that cannot be inflated by a comment or a quoted line.
  const commentOnly = "// isMainModule(process.argv[1], import.meta.url)\n/* " + RAW_URL + " */\nconst s = \"isMainModule(process.argv[1], import.meta.url)\";\n";
  checks.push(["a comment-only or quoted file does not count as carrying an exact guard", !hasExactGuard(commentOnly)]);
  const withImport = 'import { isMainModule } from "./lib/is-main.mjs";\nif (isMainModule(process.argv[1], import.meta.url)) run();\n';
  checks.push(["adoption needs the import AND a call on a code line", adoptsHelper(withImport) && !adoptsHelper(commentOnly) && !adoptsHelper("if (isMainModule(process.argv[1], import.meta.url)) run();\n")]);

  // PURE helper cases: nothing that cannot prove it is the entry may say it is.
  const someUrl = pathToFileURL(fileURLToPath(import.meta.url)).href;
  checks.push(["isMainModule(undefined, url) is false", isMainModule(undefined, someUrl) === false]);
  checks.push(["isMainModule(\"\", url) is false", isMainModule("", someUrl) === false]);
  checks.push(["isMainModule(a path that does not exist, url) is false", isMainModule("/nonexistent/entry-guard-probe.mjs", someUrl) === false]);
  checks.push(["isMainModule(this file, this url) is true", isMainModule(fileURLToPath(import.meta.url), someUrl) === true]);

  const helperSource = readFileSync(join(repoRoot, "scripts/lib/is-main.mjs"), "utf8");
  // H1: the gate that watches the helper must not depend on it. The canary on the real helper is quiet and on every broken copy loud.
  checks.push(["H1 the helper canary is quiet on the real helper", helperCanary(isMainModule).length === 0]);
  const canaryOf = (src) => {
    const dir = scratchDir("entry-guard-canary-");
    try {
      writeFileSync(join(dir, "is-main.mjs"), src);
      writeFileSync(join(dir, "run.mjs"), `import { helperCanary } from ${JSON.stringify(import.meta.url)};\nimport { isMainModule } from "./is-main.mjs";\nconsole.log(JSON.stringify(helperCanary(isMainModule)));\n`);
      return JSON.parse(execFileSync(process.execPath, [join(dir, "run.mjs")], { encoding: "utf8" }));
    } catch {
      return ["the canary run itself failed"];
    } finally {
      dropScratch(dir);
    }
  };

  // H1, end to end: a COPY of this gate beside a broken helper must exit 1 and say the helper is broken. The copy is
  // started WITHOUT --self-test (that would recurse when the canary is the thing under test); its canary runs first, so it needs no git tree.
  const gateWithHelper = (helperSrc) => {
    const dir = scratchDir("entry-guard-gate-");
    try {
      mkdirSync(join(dir, "scripts", "lib"), { recursive: true });
      for (const f of ["check-entry-guards.mjs", "lib/code-only.mjs", "lib/scratch-git.mjs"]) writeFileSync(join(dir, "scripts", f), readFileSync(join(repoRoot, "scripts", f)));
      writeFileSync(join(dir, "scripts", "lib", "is-main.mjs"), helperSrc);
      const r = spawnSync(process.execPath, [join(dir, "scripts", "check-entry-guards.mjs")], { encoding: "utf8", timeout: 60000 });
      return { status: r.status, stderr: r.stderr ?? "" };
    } catch (err) {
      return { status: -1, stderr: String(err && err.message) };
    } finally {
      dropScratch(dir);
    }
  };
  const brokenGate = gateWithHelper(helperSource.replace('import { fileURLToPath } from "node:url";\n', ""));
  checks.push(["H1 END TO END: the gate run beside a helper with its fileURLToPath import deleted exits 1 and says the helper is broken (not silent exit 0)", brokenGate.status === 1 && brokenGate.stderr.includes("is-main.mjs is broken")]);

  // CHILD PROCESS: the property itself, and mutant helpers that must each turn a case red.
  const mutants = {
    "realpathSync removed": helperSource.replace(/realpathSync\(/g, "("),
    "undefined argv1 returns true": helperSource.replace("if (!argv1) return false;", "if (!argv1) return true;"),
    "catch returns true": helperSource.replace(/catch \{\n    return false;/, "catch {\n    return true;"),
    "fileURLToPath import deleted": helperSource.replace('import { fileURLToPath } from "node:url";\n', ""),
    "one-sided realpath": helperSource.replace("realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl))", "realpathSync(argv1) === moduleUrl"),
  };
  checks.push(["every mutant helper really differs from the helper", Object.values(mutants).every((m) => m !== helperSource)]);
  const real = probeHelper(helperSource);
  checks.push(["a helper-guarded module started THROUGH A SYMLINKED DIRECTORY runs its body", real.symlinkedStart]);
  checks.push(["…also under --preserve-symlinks-main, where import.meta.url keeps the link path", real.preservedSymlinkStart]);
  checks.push(["…and does NOT run its body when imported by another file", !real.importedByFile]);
  checks.push(["…nor when a DIFFERENT file with the same basename starts and imports it (the first defect, through the helper)", !real.importedBySameName]);
  checks.push(["MUTANT helper with a basename shortcut: the same-name importer runs the body (case goes red)", probeHelper('import { basename } from "node:path";\n' + helperSource.replace("return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));", "return basename(realpathSync(argv1)) === basename(fileURLToPath(moduleUrl));")).importedBySameName]);
  checks.push(["…nor when imported from `node -e` with a dummy argv[1]", !real.importedFromEvalWithArg]);
  checks.push(["…nor when imported from `node -e` with no argv[1] at all", !real.importedFromEvalNoArg]);
  const mut = Object.fromEntries(Object.entries(mutants).map(([k, v]) => [k, probeHelper(v)]));
  checks.push(["MUTANT realpath on one side only: the --preserve-symlinks-main start skips its body (case goes red)", !probeHelper(helperSource.replace("realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl))", "realpathSync(argv1) === fileURLToPath(moduleUrl)")).preservedSymlinkStart]);
  checks.push(["MUTANT realpathSync removed: the symlinked start skips its body (case goes red)", !mut["realpathSync removed"].symlinkedStart]);
  checks.push(["MUTANT undefined argv1 returns true: the body runs on import from `node -e` (case goes red)", mut["undefined argv1 returns true"].importedFromEvalNoArg]);
  checks.push(["MUTANT catch returns true: the body runs on import (case goes red)", mut["catch returns true"].importedFromEvalWithArg]);
  checks.push(["H1 MUTANT fileURLToPath import deleted: every start silently skips its body", !mut["fileURLToPath import deleted"].symlinkedStart]);
  checks.push(["H1 …and the canary says so for it, and for every other broken copy of the helper (the one-sided realpath only differs under --preserve-symlinks-main, which the probe above pins)", Object.entries(mutants).every(([k, src]) => k === "one-sided realpath" || canaryOf(src).length > 0)]);

  // ROUND 6. Each case pins a defect the round-5 refute (or Codex) found.
  const rg = (t) => rawGuards(t).length;
  checks.push(["R5-B a realpath pair in ONE comparison does not excuse a raw comparison in another", rg("const SECOND = (realpathSync(a) === realpathSync(b)) || process.argv[1] === import.meta.url;\n") === 1 && rg("if (realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) || realpathSync(process.argv[1]) === realpathSync(other)) {}\n") === 0]);
  checks.push(["D2/R6-A every isMainModule reference must be the named import or an EXACT direct call: swapped, aliased, nested, member, ?.(, .call, another index and a missing argument are findings", [
    "const self = import.meta.url;\nif (isMainModule(self, process.argv[1])) run();\n",
    "if (isMainModule(import.meta.url, process.argv[1])) run();\n",
    "if (isMainModule(process.argv[2], import.meta.url)) run();\n",
    "if (isMainModule(process.argv[1])) run();\n",
    "if (isMainModule(fileURLToPath(import.meta.url), process.argv[1])) run();\n",
    "if (isMainModule(String(process.argv[2]), import.meta.url)) run();\n",
    "if (isMainModule?.(import.meta.url, process.argv[1])) run();\n",
    "const im = isMainModule;\nif (im(import.meta.url, process.argv[1])) run();\n",
    "if (isMainModule.call(null, process.argv[1], import.meta.url)) run();\n",
    "import * as guard from \"./other.mjs\";\nif (guard.isMainModule(process.argv[1], import.meta.url)) run();\n",
    "const { isMainModule } = await import(\"./other.js\");\nif (isMainModule(process.argv[1], import.meta.url)) run();\n",
  ].every((t) => rg(t) >= 1) && rg("if (isMainModule(process.argv[1], import.meta.url)) run();\n") === 0 && rg("if (!isMainModule(process.argv[1], import.meta.url)) return;\n") === 0 && rg("export function isMainModule(argv1, moduleUrl) {\n  return false;\n}\n") === 0 && rg("import { isMainModule } from \"./lib/is-main.mjs\";\nexport { isMainModule };\n") === 0]);
  checks.push(["R6-A re-export aliases and default imports are findings; a plain `export { isMainModule }` is not", rg("function check() { return false; }\nexport { check as isMainModule };\n") >= 1 && rg("import isMainModule from \"./other.mjs\";\n") >= 1]);
  checks.push(["R5-E an adopter must import THE helper (scripts/lib/is-main.mjs); a second definition is a finding", helperImportProblems("scripts/mac/x.mjs", 'import { isMainModule } from "./is-main.mjs";\n').length === 1 && helperImportProblems("scripts/mac/x.mjs", 'import { isMainModule } from "../lib/is-main.mjs";\n').length === 0 && helperImportProblems("scripts/x.mjs", "function isMainModule() { return false; }\n").length === 1 && helperImportProblems("scripts/lib/is-main.mjs", "export function isMainModule() { return false; }\n").length === 0]);
  checks.push(["L2 argv read through a parameter is a KNOWN MISS", rg("function f(argv) { return argv[1] === import.meta.filename; }\n") === 0]);
  // X03: the gate imported from `node -e` (with and without an argv[1]) must not run itself
  const importedGate = (extra) => spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(import.meta.url)});`, ...extra], { encoding: "utf8", timeout: 60000 });
  checks.push(["R5-C the gate's own entry guard does not run the gate when it is imported from `node -e` (dummy argv[1] or none)", [[], ["dummy-arg"]].every((x) => { const r = importedGate(x); return r.status === 0 && r.stdout === "" && r.stderr === ""; })]);
  // THE SCAN, as the CLI reports it
  const GOOD_OVERLAY = "services:\n  idp:\n    volumes:\n      - ./scripts/fixture-idp.mjs:/app/fixture-idp.mjs:ro\n      - ./scripts/lib/is-main.mjs:/app/lib/is-main.mjs:ro\n";
  const scanOf = (over = {}) => scan({ files: ["scripts/x.mjs"], readText: () => "export const x = 1;\n", overlayText: GOOD_OVERLAY, suffixDebt: new Map(), rawDebt: new Map(), ...over });
  checks.push(["SCAN: a clean tree reports no problem", scanOf().problems.length === 0]);
  checks.push(["SCAN: an unreadable tracked script is a problem, not silence", scanOf({ readText: () => { throw Object.assign(new Error("x"), { code: "ENOENT" }); } }).problems.length === 1]);
  const overlayMinus = (re) => GOOD_OVERLAY.split("\n").filter((l) => !re.test(l)).join("\n");
  checks.push(["OVERLAY the fixture-IdP compose overlay must mount BOTH the script and its helper (the round-2 CI red), as non-comment volume lines", fixtureOverlayProblems(GOOD_OVERLAY).length === 0 && fixtureOverlayProblems(overlayMinus(/is-main/)).length === 1 && fixtureOverlayProblems(overlayMinus(/fixture-idp\.mjs:/)).length === 1 && fixtureOverlayProblems(GOOD_OVERLAY.replace(/^(\s*- \.\/scripts\/lib\/is-main.*)$/m, "# $1")).length === 1 && fixtureOverlayProblems(undefined).length === 1 && fixtureOverlayProblems("").length === 2]);
  checks.push(["OVERLAY the scan reports an overlay problem (and an unreadable overlay is a problem, never clean)", scanOf({ overlayText: overlayMinus(/is-main/) }).problems.length === 1 && scanOf({ overlayText: undefined }).problems.length === 1]);
  checks.push(["OVERLAY LIVE: the real overlay is sound", fixtureOverlayProblems(readFileSync(join(repoRoot, FIXTURE_OVERLAY), "utf8")).length === 0]);
  const PLANT = `if (${RAW_URL}) {}\n`;
  checks.push(["R7-D the declared-occurrence key is defined (a detector that sees nothing must fail HERE, not by a crash in a later case)", typeof rawGuards(PLANT)[0]?.key === "string"]);
  const plantKey = rawGuards(PLANT)[0]?.key ?? "<none>";
  const declare = (...hits) => new Map([["scripts/x.mjs", { reason: "r", hits }]]);
  checks.push(["SCAN: a raw guard in an undeclared file is a problem; declared (by its occurrence), it is a note", scanOf({ readText: () => PLANT }).problems.length === 1 && scanOf({ readText: () => PLANT, rawDebt: declare(plantKey) }).problems.length === 0]);
  checks.push(["D3 a declaration excuses only ITS occurrence: a SECOND raw guard in the same file is still a finding", scanOf({ readText: () => PLANT + `export const SECOND = ${RAW_URL};\n`, rawDebt: declare(plantKey) }).problems.length === 1]);
  checks.push(["SCAN: a declared entry whose occurrence is gone or changed is a problem", scanOf({ rawDebt: declare(plantKey) }).problems.length === 1 && scanOf({ readText: () => PLANT, rawDebt: declare("something else") }).problems.length === 2]);

  // ROUND 7. Each case pins a finding from the round-6 refute (or Codex).
  const sg = (t) => suffixGuards(t).length;
  checks.push(["CX1 a legacy suffix guard written over several lines, and with the operands in either order, is a finding", sg('if (\n  import.meta.url\n    .endsWith(\n      process.argv[1].split("/").pop())\n) {\n}\n') === 1 && sg('if (fileURLToPath(import.meta.url).endsWith(process.argv[1].split("/").pop())) {}\n') === 1 && sg('if (process.argv[1].endsWith(import.meta.url.split("/").pop())) {}\n') === 1 && sg('if (name.endsWith(".mjs")) run();\n') === 0]);
  const hasG = (t) => hasExactGuard(t);
  checks.push(["CX4 only a NAMED import of is-main.mjs counts as an exact guard: a namespace, default or dynamic import, a re-export alias and a member call do not", hasG('import { isMainModule } from "./lib/is-main.mjs";\nif (isMainModule(process.argv[1], import.meta.url)) run();\n') && !hasG('import * as guard from "./x/other.mjs";\nif (guard.isMainModule(process.argv[1], import.meta.url)) run();\n') && !hasG('const { isMainModule } = await import("./x/other.js");\nif (isMainModule(process.argv[1], import.meta.url)) run();\n') && !hasG('import isMainModule from "./x/other.mjs";\nif (isMainModule(process.argv[1], import.meta.url)) run();\n')]);
  checks.push(["Y16 a `const isMainModule = ...` definition (also exported) is a definition", helperImportProblems("scripts/x.mjs", "export const isMainModule = () => false;\n").length === 1 && helperImportProblems("scripts/x.mjs", "async function isMainModule() {}\n").length === 1]);
  // R6-B: the pin counts occurrences and ignores formatting
  const WRAPPED = "if (\n  import.meta.url ===\n    pathToFileURL(/* argv */ process.argv[1]).href\n) {}\n";
  checks.push(["R6-B a second IDENTICAL occurrence in a declared file is a finding (the pin counts)", scanOf({ readText: () => PLANT + PLANT, rawDebt: declare(plantKey) }).problems.length >= 1 && scanOf({ readText: () => PLANT + PLANT, rawDebt: declare(plantKey, plantKey) }).problems.length === 0]);
  checks.push(["R6-B the second occurrence is reported AS a second occurrence, not only through the stale-declaration check", scanOf({ readText: () => PLANT + PLANT, rawDebt: declare(plantKey) }).problems.some((x) => x.includes("only for its declared"))]);
  checks.push(["Y04 a longer statement sharing a prefix with the declared one is its own finding (and the declared one still counts)", (() => { const r = scanOf({ readText: () => PLANT + `if (${RAW_URL} && more.length > 0) {}\n`, rawDebt: declare(plantKey) }); return r.problems.length === 1 && r.problems[0].includes("only for its declared"); })()]);
  checks.push(["CX4 a member call is not the exact guard even beside the named import", !hasG('import { isMainModule } from "./lib/is-main.mjs";\nif (obj.isMainModule(process.argv[1], import.meta.url)) run();\n')]);
  checks.push(["R6-B a Prettier-style wrap, a comment between tokens and extra spaces of the declared statement are the same statement", scanOf({ readText: () => WRAPPED, rawDebt: declare(plantKey) }).problems.length === 0]);
  checks.push(["Y04/Y18 the pin compares the WHOLE normalised statement (a longer statement sharing a prefix is not it)", scanOf({ readText: () => `if (${RAW_URL} && more.length > 0) {}\n`, rawDebt: declare(plantKey) }).problems.length >= 1]);
  // R6-E: each comparison against its own operands
  checks.push(["R6-E a realpath pair in one comparison does not excuse a raw one beside it (ternary, array, object literal, ??, &, parentheses)", [
    "x = realpathSync(a) === realpathSync(b) ? y : process.argv[1] === import.meta.url;\n",
    "x = [realpathSync(a) === realpathSync(b), process.argv[1] === import.meta.url];\n",
    "x = { a: realpathSync(a) === realpathSync(b), b: process.argv[1] === import.meta.url };\n",
    "x = (realpathSync(a) === realpathSync(SELF)) ?? process.argv[1] === import.meta.url;\n",
    "x = (realpathSync(a) === realpathSync(b)) & (process.argv[1] === import.meta.url);\n",
  ].every((t) => rg(t) === 1)]);
  // R6-F / Y20 / Y21: --mutants' own behaviour, through injected dependencies
  const mutRun = async (deps) => {
    const log = console.log;
    const err = console.error;
    console.log = () => {};
    console.error = () => {};
    try {
      return await runMutants({ root: repoRoot, mutants: [], ...deps });
    } finally {
      console.log = log;
      console.error = err;
    }
  };
  checks.push(["Y20 --mutants refuses a dirty working tree", (await mutRun({ gitStatus: () => " M scripts/x.mjs\n", run: async () => ({ status: 0 }) })) === 2]);
  checks.push(["Y21 --mutants refuses a failing unmutated baseline", (await mutRun({ gitStatus: () => "", run: async () => ({ status: 1 }) })) === 2 && (await mutRun({ gitStatus: () => "", run: async () => ({ status: 0 }) })) === 0]);
  const one = [["noop", "scripts/lib/is-main.mjs", "export function isMainModule", "export function isMainModule"]];
  checks.push(["R6-F a child that dies of a signal, or times out, is never counted as killed", await (async () => {
    let calls = 0;
    const r1 = await mutRun({ gitStatus: () => "", mutants: one, run: async () => (++calls === 1 ? { status: 0 } : { status: null, signal: "SIGINT" }) });
    calls = 0;
    const r2 = await mutRun({ gitStatus: () => "", mutants: one, run: async () => (++calls === 1 ? { status: 0 } : { status: null, timedOut: true }) });
    calls = 0;
    const r3 = await mutRun({ gitStatus: () => "", mutants: one, run: async () => (++calls === 1 ? { status: 0 } : { status: 1 }) });
    return r1 === 1 && r2 === 1 && r3 === 0;
  })()]);

  // L2: spellings beyond the two literal ones. Detected:
  const raw = (t) => rawGuards(t).length;
  const ARGV = "process.argv[1]";
  checks.push(["L2 a self-path constant under ANY name is followed (HERE_FILE)", raw(`const HERE_FILE = fileURLToPath(import.meta.url);\nif (resolve(${ARGV}) === HERE_FILE) {}\n`) === 1]);
  checks.push(["L2 import.meta.filename is a self path", raw(`if (${ARGV} === import.meta.filename) {}\n`) === 1]);
  checks.push(["L2 an alias of process.argv[1] is followed (const entry = ...)", raw(`const entry = ${ARGV};\nif (entry === import.meta.filename) {}\n`) === 1]);
  checks.push(["L2 a destructured alias is followed (const [, entry] = process.argv)", raw("const [, entry] = process.argv;\nif (entry === fileURLToPath(import.meta.url)) {}\n") === 1]);
  checks.push(["L2 process.argv.at(1) is process.argv[1]", raw("if (process.argv.at(1) === fileURLToPath(import.meta.url)) {}\n") === 1]);
  checks.push(["L2 process[\"argv\"][1] is process.argv[1]", raw('if (process["argv"][1] === fileURLToPath(import.meta.url)) {}\n') === 1]);
  checks.push(["L2 a literal suffix test of process.argv[1] is the basename defect", raw(`const direct = ${ARGV}.endsWith("tool.mjs");\n`) === 1]);
  checks.push(["L2 a raw compare ORed with a helper call is still a finding", raw(`if (isMainModule(${ARGV}, import.meta.url) || resolve(${ARGV}) === fileURLToPath(import.meta.url)) {}\n`) === 1]);
  checks.push(["L2 isMainModule with its arguments SWAPPED is a finding (it never runs the body)", raw("if (isMainModule(import.meta.url, process.argv[1])) {}\n") === 1]);
  checks.push(["L2 a $-leading alias name is followed ($entry)", raw("const $entry = process.argv[1];\nif ($entry === fileURLToPath(import.meta.url)) {}\n") === 1]);
  checks.push(["L2 a $-leading self-path alias is followed", raw("const $self = fileURLToPath(import.meta.url);\nif (resolve(process.argv[1]) === $self) {}\n") === 1]);
  checks.push(["L2 a self path wrapped in resolve() and bound to HERE is followed", raw("const HERE = resolve(fileURLToPath(import.meta.url));\nif (process.argv[1] === HERE) {}\n") === 1]);
  checks.push(["L2 url.fileURLToPath(...) and new URL(import.meta.url).pathname are self paths", raw("const here = url.fileURLToPath(import.meta.url);\nif (process.argv[1] === here) {}\n") === 1 && raw("const here = new URL(import.meta.url).pathname;\nif (process.argv[1] === here) {}\n") === 1]);
  checks.push(["L2 const [node, entry] = process.argv is an alias", raw("const [node, entry] = process.argv;\nif (entry === import.meta.filename) {}\n") === 1]);
  checks.push(["L2 basename(process.argv[1]) compared to a literal, and resolve(process.argv[1]).endsWith(..), are findings", raw('if (basename(process.argv[1]) === "tool.mjs") {}\n') === 1 && raw('if (resolve(process.argv[1]).endsWith("tool.mjs")) {}\n') === 1]);
  checks.push(["L3 a realpath call ELSEWHERE in the statement does not excuse a raw comparison", raw("if (really() && realize() && process.argv[1] === import.meta.url) run();\n") === 1 && raw("if (realLog() && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) run();\n") === 1 && raw("if (realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) run();\n") === 0]);
  // ROUND 8. Each case pins a finding from the round-7 refute.
  checks.push(["R7-C Object.is(process.argv[1], <self path>) is a comparison; a realpath on each argument excuses it", raw("if (Object.is(process.argv[1], fileURLToPath(import.meta.url))) run();\n") === 1 && raw("if (Object.is(realpathSync(process.argv[1]), realpathSync(fileURLToPath(import.meta.url)))) run();\n") === 0]);
  checks.push(["R7-C KNOWN MISSES: switch (process.argv[1]) { case <self path>: } and new Set([process.argv[1]]).has(<self path>) are not seen", raw("switch (process.argv[1]) {\n  case fileURLToPath(import.meta.url):\n    run();\n}\n") === 0 && raw("const here = fileURLToPath(import.meta.url);\nif (new Set([process.argv[1]]).has(here)) run();\n") === 0]);
  checks.push(["R7-E/O02 .startsWith(..) between the self path and argv[1] is a suffix-class finding", sg("if (fileURLToPath(import.meta.url).startsWith(process.argv[1])) run();\n") === 1]);
  checks.push(["R7-E/O07 `import { isMainModule as im }` rebinding is a finding", rg('import { isMainModule as im } from "./lib/is-main.mjs";\nif (im(import.meta.url, process.argv[1])) run();\n') >= 1]);
  checks.push(["R7-E/O08 a call whose SECOND argument is wrong is a finding (not only the first)", rg("if (isMainModule(process.argv[1], import.meta.filename)) run();\n") === 1]);
  checks.push(["R7-E/O13 process.argv?.[1] is process.argv[1] (the `?.` is not a ternary separator)", rg("if (process.argv?.[1] === fileURLToPath(import.meta.url)) run();\n") === 1]);
  checks.push(["R7-E/O14 a mutant whose target text is absent is NOT APPLIED and fails the run (never counted as killed)", (await mutRun({ gitStatus: () => "", run: async () => ({ status: 0 }), mutants: [["absent", "scripts/lib/is-main.mjs", "THIS TEXT IS NOT IN THE FILE", "x"]] })) === 1]);
  checks.push(["R7-E/O22 an unreadable .js/.cjs definition file is a problem, not silence", scanOf({ definitionFiles: ["scripts/x/other.js"], readText: (f) => { if (f === "scripts/x/other.js") throw Object.assign(new Error("x"), { code: "EACCES" }); return "export const x = 1;\n"; } }).problems.length === 1]);
  checks.push(["R7-H a faithful re-export more than 40 characters after `export {` is not a finding; `x as isMainModule` is", rg('import { isMainModule } from "./is-main.mjs";\nexport {\n  aVeryLongBindingNameNumberOne,\n  anotherVeryLongBindingNameNumberTwo,\n  isMainModule,\n};\n') === 0 && rg("export {\n  aVeryLongBindingNameNumberOne,\n  anotherVeryLongBindingNameNumberTwo,\n  check as isMainModule,\n};\n") >= 1]);
  checks.push(["R7-H a Prettier trailing comma in the exact call is formatting, not a finding", rg("if (\n  isMainModule(\n    process.argv[1],\n    import.meta.url,\n  )\n) {\n  run();\n}\n") === 0]);
  checks.push(["Y11 codeOnly preserves offsets and length through template expressions (positions found in it are positions in the text)", ["const t = `${a}${b}`; x();\n", "const u = `a${`b${c}`}d`;\n", 'const v = "s" + `${w}`;\n'].every((t) => codeOnly(t).length === t.length)]);
  checks.push(["KNOWN MISS: a `/` after `)` is read as a division and hides what follows on that line", rawGuards('if (x) /"/.test(s); if (process.argv[1] === import.meta.filename) {}\n').length === 0]);

  // R7-F: the runner owns the signals. REAL signals to a REAL runner process in a scratch repository, one-mutant set,
  // a sleeping child. After each: the exit code is the signal's, the mutated file is restored, no scratch directory is
  // left, and nothing was counted as killed.
  const realSignal = async (target, signal, childHandler) => {
    const dir = scratchDir("entry-guard-sig-");
    const repo = join(dir, "repo"); // the scratch repository; the sleeper, config and sentinels live OUTSIDE it so its status stays comparable
    try {
      mkdirSync(join(repo, "scripts", "lib"), { recursive: true });
      mkdirSync(join(dir, "rtmp"));
      for (const f of ["check-entry-guards.mjs", "lib/code-only.mjs", "lib/is-main.mjs", "lib/scratch-git.mjs"]) writeFileSync(join(repo, "scripts", f), readFileSync(join(repoRoot, "scripts", f)));
      writeFileSync(join(repo, "scripts", "victim.mjs"), "export const a = 1;\n");
      const ready = join(dir, "ready");
      const pidFile = join(dir, "pid");
      writeFileSync(
        join(dir, "sleeper.mjs"),
        `import { mkdirSync, readFileSync, writeFileSync } from "node:fs";\nimport { tmpdir } from "node:os";\nif (!readFileSync(${JSON.stringify(join(repo, "scripts", "victim.mjs"))}, "utf8").includes("a = 2")) process.exit(0);\nmkdirSync(tmpdir() + "/entry-guard-leak-marker");\n` +
          `${childHandler}writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nwriteFileSync(${JSON.stringify(ready)}, "1");\nsetTimeout(() => {}, 60000);\n`,
      );
      const cfg = join(dir, "cfg.json");
      writeFileSync(cfg, JSON.stringify({ mutants: [["m1", "scripts/victim.mjs", "a = 1", "a = 2"]], child: [process.execPath, join(dir, "sleeper.mjs")] }));
      scratchGitOk(repo, ["init", "-q"]);
      scratchGitOk(repo, ["add", "-A"]);
      scratchGitOk(repo, ["commit", "-q", "-m", "scratch"]);
      const out = [];
      const runner = spawn(process.execPath, [join(repo, "scripts", "check-entry-guards.mjs"), "--mutants", "--mutants-config", cfg], { cwd: repo, env: { ...process.env, TMPDIR: join(dir, "rtmp") }, stdio: ["ignore", "pipe", "pipe"] });
      runner.stdout.on("data", (d) => out.push(String(d)));
      runner.stderr.on("data", (d) => out.push(String(d)));
      const exited = new Promise((res) => runner.on("close", (code, sig) => res({ code, sig })));
      for (let i = 0; i < 400 && !existsSync(ready); i += 1) await new Promise((r) => setTimeout(r, 50));
      if (!existsSync(ready)) {
        runner.kill("SIGKILL");
        return { ok: false, why: `the runner never reached the sleeping child: ${out.join("").slice(0, 300)}` };
      }
      const victimWhileMutated = readFileSync(join(repo, "scripts", "victim.mjs"), "utf8");
      const childPid = Number(readFileSync(pidFile, "utf8"));
      process.kill(target === "parent" ? runner.pid : childPid, signal);
      const done = await Promise.race([exited, new Promise((res) => setTimeout(() => res(null), 20000))]);
      const alive = () => {
        try {
          process.kill(childPid, 0);
          return true;
        } catch {
          return false;
        }
      };
      for (let i = 0; i < 100 && alive(); i += 1) await new Promise((r) => setTimeout(r, 20)); // reaping is asynchronous
      if (done === null) {
        runner.kill("SIGKILL");
        return { ok: false, why: "the runner did not exit after the signal" };
      }
      return { ok: true, code: done.code, text: out.join(""), mutatedWhileRunning: victimWhileMutated.includes("a = 2"), restored: readFileSync(join(repo, "scripts", "victim.mjs"), "utf8") === "export const a = 1;\n", clean: scratchGitOk(repo, ["status", "--porcelain"]) === "", leaked: readdirSync(join(dir, "rtmp")).length, childAlive: alive() };
    } finally {
      dropScratch(dir);
    }
  };
  const handlerExit = 'process.on("SIGTERM", () => process.exit(143));\nprocess.on("SIGINT", () => process.exit(130));\n';
  const toParent = [await realSignal("parent", "SIGTERM", ""), await realSignal("parent", "SIGINT", "")];
  checks.push(["R7-F a REAL SIGTERM to the runner: exit 143, the mutated file restored, the tree clean, no scratch left, nothing counted killed", toParent[0].ok && toParent[0].mutatedWhileRunning && toParent[0].code === 143 && toParent[0].restored && toParent[0].clean && toParent[0].leaked === 0 && !toParent[0].childAlive && !/\bkilled\b/.test(toParent[0].text.replace(/Nothing here is a tally/, "")) && toParent[0].text.includes("INTERRUPTED")]);
  checks.push(["R7-F a REAL SIGINT to the runner: exit 130 with the same guarantees", toParent[1].ok && toParent[1].code === 130 && toParent[1].restored && toParent[1].clean && toParent[1].leaked === 0 && !toParent[1].childAlive && toParent[1].text.includes("INTERRUPTED")]);
  const toChild = [await realSignal("child", "SIGTERM", handlerExit), await realSignal("child", "SIGTERM", "")];
  checks.push(["R7-F a signal sent to the CHILD alone (its own handler exits 143, or it dies of the signal) is INTERRUPTED, never counted killed; the tree is restored", toChild.every((r) => r.ok && r.restored && r.clean && r.leaked === 0 && /INTERRUPTED\s+m1/.test(r.text) && !/\bok\s+killed\b/.test(r.text) && r.code === 1)]);

  // Known misses, pinned as misses so the header's claim is the measured one:
  for (const [label, text] of [
    ["let entry; entry = process.argv[1]", "let entry;\nentry = process.argv[1];\nif (entry === import.meta.filename) {}\n"],
    ["const args = process.argv; args[1]", "const args = process.argv;\nif (args[1] === import.meta.filename) {}\n"],
    ["const { argv: [, entry] } = process", "const { argv: [, entry] } = process;\nif (entry === import.meta.filename) {}\n"],
    ["import { argv } from \"node:process\"", 'import { argv } from "node:process";\nif (argv[1] === import.meta.filename) {}\n'],
  ]) checks.push([`L2 KNOWN MISS: ${label}`, raw(text) === 0]);
  checks.push(["KNOWN MISS: inversion of an exact helper call is not judged (`!(isMainModule(..))`, `=== false`, `|| run()`)", ["if (!(isMainModule(process.argv[1], import.meta.url))) run();\n", "const off = isMainModule(process.argv[1], import.meta.url) === false;\n", "isMainModule(process.argv[1], import.meta.url) || run();\n"].every((t) => raw(t) === 0)]);
  checks.push(["KNOWN MISS: the gate imported by `node -e` with its OWN path as argv[1] runs its body (the helper has the same property)", spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(import.meta.url)});`, fileURLToPath(import.meta.url)], { encoding: "utf8", timeout: 120000 }).stdout.includes("entry-guards:")]);
  checks.push(["L2 KNOWN MISS: a self path built by a function the detector cannot see", raw(`const here = getSelf();\nif (resolve(${ARGV}) === here) {}\n`) === 0]);
  checks.push(["L2 KNOWN MISS: a comparison split across two statements by a boolean", raw(`const same = resolve(${ARGV}) === resolve(getSelf());\nif (same) {}\n`) === 0]);
  checks.push(["OVERLAY MUTANT: the real overlay with its is-main mount removed is a problem", fixtureOverlayProblems(readFileSync(join(repoRoot, FIXTURE_OVERLAY), "utf8").replace(/^(.*is-main\.mjs.*)$/gm, "")).length >= 1]);

  // LIVE: the derivation, and the two gates fixed on 2026-09-06 — a detector that finds
  // nothing in a tree that contains the form is the failure this gate is about.
  const files = trackedScripts();
  checks.push([`LIVE: the scan derives at least ${FILE_FLOOR} tracked scripts`, files.length >= FILE_FLOOR]);
  const exact = files.filter((f) => hasExactGuard(readFileSync(join(repoRoot, f), "utf8")));
  checks.push([`LIVE: at least ${EXACT_GUARD_FLOOR} scripts carry an EXACT entry guard`, exact.length >= EXACT_GUARD_FLOOR]);
  const withHelper = files.filter((f) => adoptsHelper(readFileSync(join(repoRoot, f), "utf8")));
  checks.push([`LIVE: at least ${HELPER_ADOPTER_FLOOR} scripts import AND call the helper`, withHelper.length >= HELPER_ADOPTER_FLOOR]);
  checks.push(["LIVE: the helper itself carries no raw spelling", rawGuards(helperSource).length === 0]);
  checks.push([
    "LIVE: the two gates fixed with this finding carry an exact guard and no suffix guard",
    ["scripts/check-decision-palette.mjs", "scripts/check-assist-wire-served.mjs"].every((f) => {
      const t = readFileSync(join(repoRoot, f), "utf8");
      return hasExactGuard(t) && suffixGuards(t).length === 0;
    }),
  ]);

  // THE GATE'S OWN SOURCE. A detector whose fixtures are written literally flags the
  // file it lives in, and this one is only invisible today because it is not yet tracked.
  const ownSource = readFileSync(fileURLToPath(import.meta.url), "utf8");
  checks.push([
    "this gate's own source does not trip its own detector",
    suffixGuards(ownSource).length === 0 && rawGuards(ownSource, { callsHelperFreely: CALLS_HELPER_FREELY.has("scripts/check-entry-guards.mjs") }).length === 0,
  ]);

  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}


const GATE = "scripts/check-entry-guards.mjs";
const HELPER = "scripts/lib/is-main.mjs";
/**
 * Mutation set for this gate: each entry is a one-spot edit that makes a real defect. `node scripts/check-entry-guards.mjs
 * --mutants` applies them one at a time to a CLEAN tree, runs the self-test, and reports which were killed (self-test
 * exits non-zero) and which SURVIVED or did not apply. The tally in the PR comes from this command, not from memory.
 */
export const MUTANTS = [
  ["argv aliases not followed", GATE, "const argvWord = wordOf([...names(ARGV_ALIAS), ...names(ARGV_DESTRUCTURE)]);", "const argvWord = null;"],
  ["realpath anywhere in the term excuses the comparison", GATE, "let realBoth = op !== null && REAL_CALL.test(term.text.slice(0, op.index)) && REAL_CALL.test(term.text.slice(op.index + op.length));", "let realBoth = REAL_CALL.test(term.text);"],
  ["$-leading alias names not bounded", GATE, "(?<![\\\\w$])(?:", "\\\\b(?:"],
  ["helper canary not run by the gate", GATE, "const canary = helperCanary(isMainModule);", "const canary = [];"],
  ["helper canary skips the symlink probe", GATE, "if (call(link) !== true) bad.push(", "if (false) bad.push("],
  ["helper: realpath removed", HELPER, "return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));", "return argv1 === fileURLToPath(moduleUrl);"],
  ["helper: realpath on one side only", HELPER, "return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));", "return realpathSync(argv1) === fileURLToPath(moduleUrl);"],
  ["helper: undefined argv1 is main", HELPER, "if (!argv1) return false;", "if (!argv1) return true;"],
  ["helper: a throw is main", HELPER, "} catch {\n    return false;", "} catch {\n    return true;"],
  ["helper: fileURLToPath import deleted", HELPER, 'import { fileURLToPath } from "node:url";\n', ""],
  ["the runner's signal handler does not restore the file (R7-F)", GATE, "    interrupted = code;\n    restore();\n    if (child) {", "    interrupted = code;\n    if (child) {"],
  ["the runner's signal handler leaves the child running (R7-F)", GATE, '        process.kill(-child.pid, "SIGKILL");\n      } catch {\n        /* already gone */\n      }\n    }\n    dropChildTmp();\n    console.log(`\\nINTERRUPTED', '        void 0;\n      } catch {\n        /* already gone */\n      }\n    }\n    dropChildTmp();\n    console.log(`\\nINTERRUPTED'],
  ["a signalled child is counted killed (R7-F)", GATE, "const signalled = r.signal || r.status === 130 || r.status === 143;", "const signalled = false;"],
  ["a child that exits 143 through its own handler is counted killed (R7-F)", GATE, "const signalled = r.signal || r.status === 130 || r.status === 143;", "const signalled = r.signal || r.status === 130;"],
  ["the child's TMPDIR is not parent-owned (R7-F)", GATE, "env: { ...process.env, TMPDIR: childTmp } });", "env: { ...process.env } });"],
  ["Object.is is not a comparison (R7-C)", GATE, "const objectIs = /\\bObject\\s*\\.\\s*is\\s*\\(/.test(term.text);", "const objectIs = false;"],
  ["startsWith is not a suffix-class method (O02)", GATE, "const method = /\\.\\s*(?:endsWith|startsWith|includes)\\s*\\(/.test(term.text);", "const method = /\\.\\s*(?:endsWith|includes)\\s*\\(/.test(term.text);"],
  ["an `isMainModule as x` rebinding is not flagged (O07)", GATE, "if (new RegExp(String.raw`(?<![\\w$])isMainModule\\s+as\\s`).test(clause[2]))", "if (false)"],
  ["only the first isMainModule argument is compared (O08)", GATE, "if (args !== EXACT_ARGS)", 'if (args.split(",")[0] !== "process.argv[1]")'],
  ["the `?` of `?.` is a ternary separator (O13)", GATE, 'else if (c === "&" || c === "|" || c === "," || c === ":" || (c === "?" && d !== ".")) cut(i, i + 1);', 'else if (c === "&" || c === "|" || c === "," || c === ":" || c === "?") cut(i, i + 1);'],
  ["a NOT APPLIED mutant does not fail the run (O14)", GATE, 'return killed === results.length && results.every(([, v]) => v === "killed") ? 0 : 1;', 'return killed === results.filter(([, v]) => v !== "NOT APPLIED").length ? 0 : 1;'],
  ["an unreadable definition file is silent (O22)", GATE, "    } catch (err) {\n      problems.push(`${rel}: tracked but unreadable (${err && err.code}) — it was NOT scanned`);\n    }\n  }\n  problems.push(...fixtureOverlayProblems(overlayText));", "    } catch (err) {\n      void err;\n    }\n  }\n  problems.push(...fixtureOverlayProblems(overlayText));"],
  ["export clauses are not read (R7-H)", GATE, "const exportClauses = [...code.matchAll(/\\bexport\\s*\\{([^}]*)\\}/g)].map(", "const exportClauses = [].map("],
  ["a trailing comma in the exact call is a finding (R7-H)", GATE, '.replace(/,$/, ""); // a trailing comma is formatting', "; // a trailing comma is formatting"],
  ["the overlay needs only the script mount", GATE, 'if (!has("./scripts/lib/is-main.mjs", "/app/lib/is-main.mjs")) out.push(', "if (false) out.push("],
  ["the scan drops the overlay problems", GATE, "  problems.push(...fixtureOverlayProblems(overlayText));\n  // A DECLARATION", "  // A DECLARATION"],
  ["an unreadable overlay is clean", GATE, 'if (typeof text !== "string") return [', 'if (typeof text !== "string") return [] || ['],
  ["the pin compares a 20-character prefix (Y04)", GATE, "declared.hits.filter((h) => h === hit.key).length : 0;", "declared.hits.filter((h) => h.slice(0, 20) === hit.key.slice(0, 20)).length : 0;"],
  ["the pin truncates the statement (Y18)", GATE, "key: nowhite(code.slice(from, to)),", "key: nowhite(code.slice(from, to)).slice(0, 40),"],
  ["the pin does not count occurrences (R6-B)", GATE, "if (allowed > 0 && (seen.get(hit.key) ?? 0) < allowed) {", "if (allowed > 0) {"],
  ["a comma is not a term separator (R6-E)", GATE, 'else if (c === "&" || c === "|" || c === "," || c === ":" || (c === "?" && d !== ".")) cut(i, i + 1);', 'else if (c === "&" || c === "|" || c === ":" || (c === "?" && d !== ".")) cut(i, i + 1);'],
  ["a const definition of isMainModule is not a definition (Y16)", GATE, "(?:\\b(?:function|const|let|var|class)\\s+isMainModule(?![\\w$])", "(?:\\b(?:function|let|var|class)\\s+isMainModule(?![\\w$])"],
  ["a template expression marker loses a character (Y11)", "scripts/lib/code-only.mjs", 'out += keepStrings ? "${" : " (";', 'out += keepStrings ? "${" : "(";'],
  ["--mutants accepts a dirty tree (Y20)", GATE, "  if (dirty) {\n    console.error(\"✗ --mutants needs a clean working tree", "  if (false) {\n    console.error(\"✗ --mutants needs a clean working tree"],
  ["--mutants accepts a failing baseline (Y21)", GATE, "  if (baseline.status !== 0) {", "  if (false) {"],
  ["isMainModule call arguments are not compared (R6-A)", GATE, "if (args !== EXACT_ARGS)", "if (false)"],
  ["a member call of isMainModule is allowed (CX4/R6-A)", GATE, "if (/(?:\\.|\\?\\.)\\s*$/.test(before)) {", "if (false) {"],
  ["the helper call is not anchored against a member call (CX4)", GATE, "const HELPER_CALL = /(?<![\\w$.])isMainModule", "const HELPER_CALL = /isMainModule"],
  ["a suffix test between the self path and argv[1] is not flagged (CX1)", GATE, "if (method && selfHit) {", "if (false) {"],
  [".js/.cjs definitions are not scanned (CX4)", GATE, "for (const rel of definitionFiles) {", "for (const rel of []) {"],
  ["a declaration excuses every raw guard in the file (D3)", GATE, "const allowed = declared ? declared.hits.filter((h) => h === hit.key).length : 0;", "const allowed = declared ? 99 : 0;"],
  ["an adopter may import any isMainModule (R5-E)", GATE, 'if (resolved !== "scripts/lib/is-main.mjs")', "if (false)"],
  ["a second isMainModule definition is allowed (R5-E)", GATE, 'if (rel !== "scripts/lib/is-main.mjs" && /', "if (false && /"],
  ["the gate's own guard runs the gate when imported from node -e", GATE, "  } catch {\n    return false;\n  }\n})();", "  } catch {\n    return true;\n  }\n})();"],
  ["helper with a basename shortcut", HELPER, "return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));", "return realpathSync(argv1).split('/').pop() === fileURLToPath(moduleUrl).split('/').pop() || realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));"],
];

/**
 * Apply each mutant to the working tree, run the self-test, restore. Refuses a tree with uncommitted changes and a failing
 * unmutated baseline (a "killed" mutant would prove nothing). While it runs THIS FUNCTION OWNS SIGINT/SIGTERM: it restores
 * the mutated file, kills the child's whole process group, removes the parent-owned scratch directory (which is the child's
 * TMPDIR, so nothing the child made survives even a SIGKILL) and exits 130/143. A child that dies of a signal, exits 130/143
 * through its own handler, or times out is INTERRUPTED/TIMEOUT, never "killed". `deps` is injectable for the self-test:
 * `run()` replaces the child, `childArgv` replaces the command, `mutants` the mutation set.
 */
export async function runMutants(deps = {}) {
  const mutants = deps.mutants ?? MUTANTS;
  const gitStatus = deps.gitStatus ?? (() => execFileSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" }));
  const root = deps.root ?? repoRoot;
  const childArgv = deps.childArgv ?? [process.execPath, join(root, GATE), "--self-test"];
  let child = null;
  let childTmp = null;
  const dropChildTmp = () => {
    if (childTmp) dropScratch(childTmp);
    childTmp = null;
  };
  const runSelfTest =
    deps.run ??
    (() =>
      new Promise((resolveRun) => {
        let timedOut = false;
        childTmp = scratchDir("entry-guard-run-");
        // detached: the child leads its own process group, so one kill reaches everything it started
        child = spawn(childArgv[0], childArgv.slice(1), { cwd: root, stdio: "ignore", detached: true, env: { ...process.env, TMPDIR: childTmp } });
        const killGroup = (sig) => {
          try {
            process.kill(-child.pid, sig);
          } catch {
            /* already gone */
          }
        };
        const timer = setTimeout(() => {
          timedOut = true;
          killGroup("SIGKILL");
        }, deps.timeoutMs ?? 300000);
        child.on("close", (status, signal) => {
          clearTimeout(timer);
          killGroup("SIGKILL"); // anything it left behind
          child = null;
          dropChildTmp();
          resolveRun({ status, signal, timedOut });
        });
      }));
  const dirty = gitStatus().trim();
  if (dirty) {
    console.error("✗ --mutants needs a clean working tree (it edits tracked files and restores them); commit or discard first:");
    console.error(dirty.split("\n").slice(0, 10).map((l) => `    ${l}`).join("\n"));
    return 2;
  }
  const baseline = await runSelfTest();
  if (baseline.status !== 0) {
    console.error("✗ the unmutated self-test does not pass, so a 'killed' mutant would prove nothing; fix that first.");
    return 2;
  }
  const results = [];
  let live = null; // { path, original } while a mutant is applied
  const restore = () => {
    if (live) writeFileSync(live.path, live.original);
    live = null;
  };
  let interrupted = 0;
  const onSignal = (code) => () => {
    interrupted = code;
    restore();
    if (child) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
    dropChildTmp();
    console.log(`\nINTERRUPTED (${code === 130 ? "SIGINT" : "SIGTERM"}): the tree was restored; ${results.length} of ${mutants.length} mutants had a verdict. Nothing here is a tally.`);
    if (!deps.keepAlive) process.exit(code);
  };
  const sigint = onSignal(130);
  const sigterm = onSignal(143);
  process.on("SIGINT", sigint);
  process.on("SIGTERM", sigterm);
  try {
    for (const [name, file, from, to] of mutants) {
      if (interrupted) break;
      const path = join(root, file);
      const original = readFileSync(path, "utf8");
      // The MUTANTS literal quotes its own targets; only occurrences OUTSIDE it count.
      const lo = original.indexOf("export const MUTANTS = [");
      const hi = lo < 0 ? -1 : original.indexOf("\n];\n", lo) + 4;
      const hits = [];
      for (let at = original.indexOf(from); at >= 0; at = original.indexOf(from, at + 1)) if (lo < 0 || at < lo || at >= hi) hits.push(at);
      if (hits.length !== 1) {
        results.push([name, "NOT APPLIED"]);
        continue;
      }
      try {
        live = { path, original };
        writeFileSync(path, original.slice(0, hits[0]) + to + original.slice(hits[0] + from.length));
        const r = await runSelfTest();
        if (interrupted) break;
        const signalled = r.signal || r.status === 130 || r.status === 143;
        results.push([name, r.timedOut ? "TIMEOUT" : signalled ? "INTERRUPTED" : r.status !== 0 ? "killed" : "SURVIVED"]);
      } finally {
        restore();
      }
    }
  } finally {
    process.off("SIGINT", sigint);
    process.off("SIGTERM", sigterm);
    restore();
    dropChildTmp();
  }
  for (const [name, verdict] of results) console.log(`  ${verdict === "killed" ? "ok" : "!!"} ${verdict.padEnd(11)} ${name}`);
  const killed = results.filter(([, v]) => v === "killed").length;
  if (interrupted) return interrupted;
  console.log(`\nmutants: ${killed} of ${results.length} killed`);
  return killed === results.length && results.every(([, v]) => v === "killed") ? 0 : 1;
}

/**
 * The helper every adopter calls, EXERCISED. If scripts/lib/is-main.mjs breaks (an import deleted, a comparison
 * loosened), every adopter exits 0 having checked nothing and nothing else notices; this gate does notice, because
 * it does not depend on the helper to run (its own entry guard below is written out) and checks it on every run.
 * Returns the list of ways `isMain` is wrong; [] = sound.
 */
export function helperCanary(isMain) {
  const bad = [];
  const self = fileURLToPath(import.meta.url);
  const call = (arg) => {
    try {
      return isMain(arg, import.meta.url);
    } catch (err) {
      return `threw ${err && err.message}`;
    }
  };
  if (call(self) !== true) bad.push(`isMainModule(this file, this file's url) is ${String(call(self))}, not true - every adopter would skip its body and exit 0`);
  // The symlink case the helper exists for: a link to this very file must still read as this file.
  const dir = scratchDir("entry-guard-link-");
  try {
    const link = join(dir, "self.mjs");
    symlinkSync(self, link);
    if (call(link) !== true) bad.push(`isMainModule(a symlink to this file, url) is ${String(call(link))}, not true - a symlinked start would skip its body`);
  } catch (err) {
    bad.push(`could not build the symlink probe (${err && err.code})`);
  } finally {
    dropScratch(dir);
  }
  for (const arg of [undefined, "", "/nonexistent/entry-guard-canary.mjs"]) {
    if (call(arg) !== false) bad.push(`isMainModule(${JSON.stringify(arg)}, url) is ${String(call(arg))}, not false`);
  }
  return bad;
}

// This gate's OWN entry guard is written out, not imported: it is the check on the helper, so it must not depend
// on it. A helper that fails silently makes every adopter exit 0 with no output; this one cannot.
const IS_ENTRY = (() => {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

const FIXTURE_OVERLAY = "scripts/fixture-idp.compose.yml";

/**
 * Pure: the fixture-IdP compose overlay bind-mounts ONE script into a bare container, so the helper that script imports
 * has to be mounted beside it or the container dies with ERR_MODULE_NOT_FOUND (round 2's red CI job). The container-level
 * check lives with the shipped-import model; this is the literal assertion the core keeps. Returns problems; [] = both
 * mounts are present as non-comment volume lines.
 */
export function fixtureOverlayProblems(text) {
  if (typeof text !== "string") return [`${FIXTURE_OVERLAY}: unreadable - NOT checked`];
  const lines = text.split("\n").map((l) => l.replace(/\s+#.*$/, "").trim()).filter((l) => l !== "" && !l.startsWith("#"));
  const has = (host, container) => lines.some((l) => new RegExp(`^-\\s*["']?${host.replace(/[.]/g, "\\.")}:${container.replace(/[.]/g, "\\.")}(?::ro)?["']?$`).test(l));
  const out = [];
  if (!has("./scripts/fixture-idp.mjs", "/app/fixture-idp.mjs")) out.push(`${FIXTURE_OVERLAY}: no volume line mounts ./scripts/fixture-idp.mjs at /app/fixture-idp.mjs`);
  if (!has("./scripts/lib/is-main.mjs", "/app/lib/is-main.mjs")) out.push(`${FIXTURE_OVERLAY}: no volume line mounts ./scripts/lib/is-main.mjs at /app/lib/is-main.mjs - fixture-idp.mjs imports it and the container holds only what is mounted`);
  return out;
}

/**
 * The whole scan, pure: `readText(rel)` and `overlayText` are passed in so the self-test can plant a tree. Everything
 * the CLI reports comes from here, so a regression in what is REPORTED (not only in what is detected) is
 * visible to the self-test.
 */
export function scan({ files, definitionFiles = [], readText, overlayText, suffixDebt = DECLARED_SUFFIX_GUARDS, rawDebt = DECLARED_RAW_GUARD_DEBT }) {
  const problems = [];
  const notes = [];
  const suffixHits = new Set();
  const rawHits = new Map(); // file -> Map(normalised statement -> times seen)
  let exactGuards = 0;
  for (const rel of files) {
    let text;
    try {
      text = readText(rel);
    } catch (err) {
      // Tracked but unreadable: not "clean", not skippable.
      problems.push(`${rel}: tracked but unreadable (${err && err.code}) — it was NOT scanned`);
      continue;
    }
    if (hasExactGuard(text)) exactGuards += 1;
    for (const hit of suffixGuards(text)) {
      if (suffixDebt.has(rel)) {
        suffixHits.add(rel);
        continue;
      }
      problems.push(
        `${rel}:${hit.line} uses the BASENAME-SUFFIX entry guard — a script that merely imports this module ` +
          "will run its gate body if its filename ends the same way. Use " +
          "`isMainModule(process.argv[1], import.meta.url)` from scripts/lib/is-main.mjs.",
      );
    }
    for (const hit of rawGuards(text, { callsHelperFreely: CALLS_HELPER_FREELY.has(rel) })) {
      if (hit.kind === "suffix") continue; // reported through suffixGuards above, against the suffix declarations
      // A declaration pins the occurrence AND how many times it occurs, compared with all whitespace removed (a reformatted
      // statement is the same statement; a second identical one is not excused).
      const declared = rawDebt.get(rel);
      const seen = rawHits.get(rel) ?? new Map();
      const allowed = declared ? declared.hits.filter((h) => h === hit.key).length : 0;
      if (allowed > 0 && (seen.get(hit.key) ?? 0) < allowed) {
        seen.set(hit.key, (seen.get(hit.key) ?? 0) + 1);
        rawHits.set(rel, seen);
        continue;
      }
      const what =
        hit.kind === "helper"
          ? `${hit.reason} - the body may never run, or may run on import`
          : `${hit.reason} - a symlink-blind entry guard: started through a symlinked path it skips its whole body and exits 0`;
      problems.push(
        `${rel}:${hit.line} ${what}. Use \`isMainModule(process.argv[1], import.meta.url)\` from scripts/lib/is-main.mjs.` +
          (declared ? " (the file is on DECLARED_RAW_GUARD_DEBT, but only for its declared occurrence(s); this one is not it)" : ""),
      );
    }
    problems.push(...helperImportProblems(rel, text));
  }
  // .js/.cjs scripts are not scanned for guards, but a second isMainModule defined in one is as unwatched as one in a .mjs.
  for (const rel of definitionFiles) {
    try {
      problems.push(...helperImportProblems(rel, readText(rel)));
    } catch (err) {
      problems.push(`${rel}: tracked but unreadable (${err && err.code}) — it was NOT scanned`);
    }
  }
  problems.push(...fixtureOverlayProblems(overlayText));
  // A DECLARATION THAT NO LONGER APPLIES IS A FAILURE, not a silent carry-over — that is
  // how a debt list turns into a permanent carve-out.
  for (const [rel, decl] of rawDebt) {
    const seen = rawHits.get(rel) ?? new Map();
    const wanted = new Map();
    for (const h of decl.hits) wanted.set(h, (wanted.get(h) ?? 0) + 1);
    const off = [...wanted].filter(([h, n]) => (seen.get(h) ?? 0) !== n);
    if (off.length === 0) notes.push(`${rel}: DECLARED raw guard (${decl.hits.length} occurrence${decl.hits.length === 1 ? "" : "s"}) — ${decl.reason}`);
    else for (const [h, n] of off) problems.push(`${rel} carries a DECLARED_RAW_GUARD_DEBT entry whose occurrence is gone, changed or repeated (declared ${n}, found ${seen.get(h) ?? 0}: ${h.slice(0, 80)}...) — update or delete the entry.`);
  }
  for (const [rel, reason] of suffixDebt) {
    if (suffixHits.has(rel)) notes.push(`${rel}: DECLARED suffix guard — ${reason}`);
    else problems.push(`${rel} carries a DECLARED_SUFFIX_GUARDS entry but no longer uses the suffix form — delete the entry (this is what a fixed file looks like).`);
  }
  return { problems, notes, exactGuards };
}

/**
 * Pure: every file that adopts the helper must import THE helper (scripts/lib/is-main.mjs, resolved from the importing
 * file), and nothing else may define an `isMainModule` of its own: a second copy is not watched by the canary, and an
 * adopter that imports it would exit 0 silently if that copy were wrong.
 */
export function helperImportProblems(rel, text) {
  const out = [];
  // Located on the string-blanked text (an import quoted inside a string is not an import), read back from the original.
  for (const m of codeOnly(text).matchAll(/\bimport\s*\{[^}]*\bisMainModule\b[^}]*\}\s*from\s*(["'])(\s*)\1/dg)) {
    const spec = text.slice(m.indices[2][0], m.indices[2][1]);
    const resolved = posix.normalize(posix.join(posix.dirname(rel), spec));
    if (resolved !== "scripts/lib/is-main.mjs") out.push(`${rel}: imports isMainModule from ${spec} (${resolved}), not scripts/lib/is-main.mjs - that copy is not watched by the helper canary`);
  }
  // Any way of DEFINING or EXPORTING a function under this name (function, const/let/var/class, an `x as isMainModule` re-export alias).
  if (rel !== "scripts/lib/is-main.mjs" && /(?:\b(?:function|const|let|var|class)\s+isMainModule(?![\w$])|\bas\s+isMainModule(?![\w$]))/.test(codeOnly(text))) {
    out.push(`${rel}: defines or exports its own isMainModule - use scripts/lib/is-main.mjs (a second copy is not watched by the helper canary)`);
  }
  return out;
}

if (IS_ENTRY) {
  const canary = helperCanary(isMainModule);
  if (canary.length > 0) {
    console.error("✗ scripts/lib/is-main.mjs is broken - every gate that adopts it would exit 0 having checked nothing:");
    for (const c of canary) console.error(`  ✗ ${c}`);
    process.exitCode = 1;
  } else if (process.argv.includes("--mutants")) {
    // The runner owns SIGINT/SIGTERM while it runs (it restores the tree first); no handler here may pre-empt it.
    const cfgAt = process.argv.indexOf("--mutants-config");
    const cfg = cfgAt >= 0 ? JSON.parse(readFileSync(process.argv[cfgAt + 1], "utf8")) : {};
    process.exitCode = await runMutants({ ...(cfg.mutants ? { mutants: cfg.mutants } : {}), ...(cfg.child ? { childArgv: cfg.child } : {}) });
  } else {
    process.once("SIGINT", () => {
      dropAllScratch();
      process.exit(130);
    });
    process.once("SIGTERM", () => {
      dropAllScratch();
      process.exit(143);
    });
    if (process.argv.includes("--self-test")) process.exitCode = await selfTest();
    else process.exitCode = runGate();
  }
}

/** The plain gate run: scan the tracked scripts, report, and return the exit code (set as process.exitCode so stdout/stderr flush). */
function runGate() {
  const files = trackedScripts();
  if (files.length < FILE_FLOOR) {
    console.error(`✗ only ${files.length} tracked scripts/**/*.mjs found (floor ${FILE_FLOOR}) — the derivation has drifted.`);
    console.error("  Refusing to report green over a scan this small.");
    return 1;
  }
  let overlayText;
  try {
    overlayText = readFileSync(join(repoRoot, FIXTURE_OVERLAY), "utf8");
  } catch {
    overlayText = undefined; // reported by fixtureOverlayProblems as unreadable, never as clean
  }
  const { problems, notes, exactGuards } = scan({ files, definitionFiles: trackedDefinitionFiles(), readText: (rel) => readFileSync(join(repoRoot, rel), "utf8"), overlayText });
  for (const n of notes) console.log(`  · ${n}`);
  console.log(
    `\nentry-guards: ${files.length} tracked script(s) scanned, ${exactGuards} carrying an exact entry guard, ` +
      `${DECLARED_SUFFIX_GUARDS.size} declared suffix guard(s), ${DECLARED_RAW_GUARD_DEBT.size} declared raw-guard debt, ${problems.length} problem(s); self-test runs under --self-test`,
  );
  if (exactGuards < EXACT_GUARD_FLOOR) {
    console.error(`✗ only ${exactGuards} exact entry guard(s) found (floor ${EXACT_GUARD_FLOOR}) — the detector has drifted.`);
    return 1;
  }
  if (problems.length > 0) {
    console.error(`\nEntry-guard gate FAILED: ${problems.length} problem(s).`);
    for (const p of problems) console.error(`  ✗ ${p}`);
    return 1;
  }
  console.log("Entry-guard gate passed — no undeclared module runs its gate body on a filename match.");
  return 0;
}
