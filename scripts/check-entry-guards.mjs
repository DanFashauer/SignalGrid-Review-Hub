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
// `check-lab-registry.mjs:282` had already diagnosed exactly this ("an adversarial
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
// WHAT IS GATED: two things, in any tracked `scripts/**/*.mjs`, outside the declared lists.
//   1. the SUFFIX form (the first defect above);
//   2. any statement that compares `process.argv[1]` with the module's own URL or path
//      (`import.meta.url`, `fileURLToPath(import.meta.url)`, a SELF/SELF_FILE constant) in ANY
//      spelling — either operand order, wrapped across lines, `pathToFileURL(resolve(..)).href`,
//      `new URL(`file://${..}`).href` — unless it goes through `isMainModule` or a realpath on both
//      sides. The helper call is the one accepted spelling; a raw comparison is a finding.
// This still does NOT require a module to have an entry guard. Comments and string content are not
// code: a fixture quoting a bad form is not a finding.
//
// SCOPE IS DERIVED: `git ls-files scripts/**/*.mjs`, so a new script joins the scan the
// moment it is tracked; an untracked scratch file cannot widen or narrow it.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMainModule } from "./lib/is-main.mjs";

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
 *   +if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 *
 * plus `import { pathToFileURL } from "node:url";`. They are listed rather than fixed
 * here because they belong to other engineers' file sets in the batch that found this;
 * the gate is what stops a fifth from appearing while they land.
 */
// Empty by design as of 2026-09-06: the four scripts that carried the suffix form
// (check-licence-policy, check-reason-codes, check-scheduled-routines, gen-reason-codes)
// were converted to the exact `import.meta.url === pathToFileURL(process.argv[1]).href`
// form in this same batch, so nothing is declared here. A new entry belongs here ONLY
// while a suffix-form fix is genuinely deferred to a later change; it is debt, not a
// resting state — the gate flags a declared entry whose file no longer uses the form.
const DECLARED_SUFFIX_GUARDS = new Map([]);

/**
 * KNOWN DEBT for the RAW exact spellings (see THE SECOND DEFECT). Same rule as above: an
 * entry whose file no longer carries a raw spelling fails this gate with "remove the
 * entry". A file belongs here only while the owner has not merged its conversion.
 */
const DECLARED_RAW_GUARD_DEBT = new Map([
  [
    "scripts/mutation-guard.mjs",
    "shared surface (CLAUDE.md, Multiple Claude lanes): declared here, converted by the lane that owns it",
  ],
  [
    "scripts/check-row-status-drift.mjs",
    "its entry guard is converted; the remaining finding is a fail-loud canary (`basename(argv[1]) === basename(self)` with extra args refuses when the guard said 'imported'), which is not an entry guard",
  ],
  [
    "scripts/check-owner-gated-surfaces.mjs",
    "build-tick.sh classify_change extracts this ONE file with `git show` into a cache dir and imports it there, where a relative `./lib/is-main.mjs` cannot resolve; its guard stays self-contained until the extraction ships the helper too",
  ],
  [
    "scripts/check-launch-proof-bindings.mjs",
    "launch-profile family: the owner merges launch-surface scripts, so the conversion is left to that merge",
  ],
]);

// Two spellings of the same exact comparison, kept for hasExactGuard (declared debt still counts as a guard).
const RAW_GUARD_PATTERNS = [
  /import\.meta\.url\s*===\s*pathToFileURL\(\s*process\.argv\[1\]\s*\)\.href/,
  /resolve\(\s*process\.argv\[1\]\s*\)\s*===\s*fileURLToPath\(\s*import\.meta\.url\s*\)/,
];

/**
 * Pure: the text with comments and string/template CONTENT blanked to spaces (newlines kept, so line numbers
 * survive). A template's `${expr}` is kept as `(expr)`, because `new URL(\`file://${resolve(process.argv[1])}\`)`
 * is code. `keepStrings` leaves string literals alone (to read an import specifier). A regex literal is not
 * understood; none of the shapes this gate reads depends on one.
 */
// Is a `/` here the start of a regex literal (not a division)? Decided by the last significant char before it.
function regexAllowed(out) {
  const m = /(\S)\s*$/.exec(out.slice(-40));
  if (!m) return true;
  if ("(,=:[!&|?{};+-*%<>~^".includes(m[1])) return true;
  return /\b(?:return|typeof|case|in|of|delete|void|throw|else)\s*$/.test(out.slice(-12));
}

export function codeOnly(text, keepStrings = false) {
  const n = text.length;
  let out = "";
  const blank = (str) => str.replace(/[^\n]/g, " ");
  let lexTemplate;
  const lex = (start, inExpr) => {
    let i = start;
    let depth = 0;
    while (i < n) {
      const c = text[i];
      const d = text[i + 1];
      if (c === "/" && d === "/") {
        let j = text.indexOf("\n", i);
        if (j < 0) j = n;
        out += blank(text.slice(i, j));
        i = j;
      } else if (c === "/" && d === "*") {
        let j = text.indexOf("*/", i + 2);
        j = j < 0 ? n : j + 2;
        out += blank(text.slice(i, j));
        i = j;
      } else if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < n && text[j] !== c && text[j] !== "\n") j += text[j] === "\\" ? 2 : 1;
        j = Math.min(j + 1, n);
        out += keepStrings ? text.slice(i, j) : blank(text.slice(i, j));
        i = j;
      } else if (c === "/" && regexAllowed(out)) {
        // A regex literal: its content (quotes, backticks, braces) is not code and must not start a string.
        let j = i + 1;
        let inClass = false;
        while (j < n && text[j] !== "\n" && (inClass || text[j] !== "/")) {
          if (text[j] === "\\") j += 1;
          else if (text[j] === "[") inClass = true;
          else if (text[j] === "]") inClass = false;
          j += 1;
        }
        j = Math.min(j + 1, n);
        out += blank(text.slice(i, j));
        i = j;
      } else if (c === "`") {
        i = lexTemplate(i);
      } else if (inExpr && c === "{") {
        depth += 1;
        out += c;
        i += 1;
      } else if (inExpr && c === "}") {
        if (depth === 0) return i;
        depth -= 1;
        out += c;
        i += 1;
      } else {
        out += c;
        i += 1;
      }
    }
    return i;
  };
  lexTemplate = (start) => {
    out += keepStrings ? "`" : " ";
    let i = start + 1;
    while (i < n && text[i] !== "`") {
      if (text[i] === "\\") {
        out += keepStrings ? text.slice(i, i + 2) : blank(text.slice(i, i + 2));
        i += 2;
      } else if (text[i] === "$" && text[i + 1] === "{") {
        out += "(";
        i = lex(i + 2, true);
        out += ")";
        i += 1;
      } else {
        out += keepStrings ? text[i] : blank(text[i]);
        i += 1;
      }
    }
    out += keepStrings ? "`" : " ";
    return i + 1;
  };
  lex(0, false);
  return out;
}

const ARGV1 = /process\s*\.\s*argv\s*(?:\?\.)?\s*\[\s*1\s*\]/;
const SELF_PATH = /import\s*\.\s*meta\s*\.\s*url|\b(?:SELF_FILE|SELF_PATH|SELF|THIS_FILE|__filename)\b/;

/**
 * Pure: the symlink-blind entry guards in one file's text, with line numbers. A SHAPE, not two spellings: any
 * statement that compares `process.argv[1]` (however wrapped, either operand order, across any number of lines)
 * with this module's own URL or path, and does not go through `isMainModule` or a realpath on BOTH sides.
 * Comments and string content are not code (a fixture quoting the bad form is not a finding).
 */
export function rawGuards(text) {
  const code = codeOnly(text);
  const out = [];
  let start = 0;
  const flush = (end) => {
    const seg = code.slice(start, end);
    const a = ARGV1.exec(seg);
    if (a && /[!=]==?/.test(seg) && SELF_PATH.test(seg) && !/\bisMainModule\s*\(/.test(seg) && (seg.match(/\breal\w*\s*\(/g) ?? []).length < 2) {
      const line = code.slice(0, start + a.index).split("\n").length;
      out.push({ line, text: seg.replace(/\s+/g, " ").trim().slice(0, 160) });
    }
    start = end + 1;
  };
  for (let i = 0; i < code.length; i += 1) if (code[i] === ";" || code[i] === "{" || code[i] === "}") flush(i);
  flush(code.length);
  return out;
}

const HELPER_CALL = /isMainModule\(\s*process\.argv\[1\]\s*,\s*import\.meta\.url\s*\)/;

/**
 * Child process, not a regex: start a helper-guarded scratch module through a SYMLINKED
 * directory and report whether its body ran. `helperSource` is the helper under test, so
 * the self-test can feed it a mutant.
 */
export function probeHelper(helperSource) {
  const dir = mkdtempSync(join(tmpdir(), "entry-guard-"));
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
    symlinkSync(join(dir, "real"), join(dir, "link"));
    const spec = JSON.stringify(pathToFileURL(modPath).href);
    return {
      // MUST run: started as the entry, through a symlinked directory
      symlinkedStart: ran([join(dir, "link", "mod.mjs")], dir),
      // MUST NOT run: imported by another file, and imported from `node -e` (with a dummy argv[1], and with none)
      importedByFile: ran([join(dir, "real", "importer.mjs")], dir),
      importedFromEvalWithArg: ran(["--input-type=module", "-e", `await import(${spec});`, "dummy-arg"], dir),
      importedFromEvalNoArg: ran(["--input-type=module", "-e", `await import(${spec});`], dir),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Pure: the suffix-form entry guards in one file's text, with line numbers. */
export function suffixGuards(text) {
  const out = [];
  text.split("\n").forEach((line, i) => {
    // Comments are not call sites — this file quotes the bad form four times above.
    const code = line.trimStart();
    if (code.startsWith("//") || code.startsWith("*")) return;
    if (/import\.meta\.url\s*\.\s*endsWith\s*\(/.test(line) && /process\.argv\[1\]/.test(line)) {
      out.push({ line: i + 1, text: line.trim() });
    }
  });
  return out;
}

/** Pure: does this text carry an EXACT entry guard: the helper call, or either raw spelling? */
export function hasExactGuard(text) {
  const code = codeOnly(text);
  return HELPER_CALL.test(code) || RAW_GUARD_PATTERNS.some((re) => re.test(code));
}

/** Pure: does this file import the shared helper AND call it, outside comments and strings? */
export function adoptsHelper(text) {
  return /\bimport\b[^;]*["'](?:\.\.?\/)+(?:lib\/)?is-main\.mjs["']/.test(codeOnly(text, true)) && HELPER_CALL.test(codeOnly(text));
}

function trackedScripts() {
  const out = execFileSync("git", ["ls-files", "--", "scripts/*.mjs", "scripts/**/*.mjs"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.trim().split("\n").filter(Boolean);
}

function selfTest() {
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
  const helper = "if (isMainModule(process.argv[1], import.meta.url)) {\n  run();\n}\n";
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

  // CHILD PROCESS: the property itself, and mutant helpers that must each turn a case red.
  const helperSource = readFileSync(join(repoRoot, "scripts/lib/is-main.mjs"), "utf8");
  const mutants = {
    "realpathSync removed": helperSource.replace(/realpathSync\(/g, "("),
    "undefined argv1 returns true": helperSource.replace("if (!argv1) return false;", "if (!argv1) return true;"),
    "catch returns true": helperSource.replace(/catch \{\n    return false;/, "catch {\n    return true;"),
  };
  checks.push(["every mutant helper really differs from the helper", Object.values(mutants).every((m) => m !== helperSource)]);
  const real = probeHelper(helperSource);
  checks.push(["a helper-guarded module started THROUGH A SYMLINKED DIRECTORY runs its body", real.symlinkedStart]);
  checks.push(["…and does NOT run its body when imported by another file", !real.importedByFile]);
  checks.push(["…nor when imported from `node -e` with a dummy argv[1]", !real.importedFromEvalWithArg]);
  checks.push(["…nor when imported from `node -e` with no argv[1] at all", !real.importedFromEvalNoArg]);
  const mut = Object.fromEntries(Object.entries(mutants).map(([k, v]) => [k, probeHelper(v)]));
  checks.push(["MUTANT realpathSync removed: the symlinked start skips its body (case goes red)", !mut["realpathSync removed"].symlinkedStart]);
  checks.push(["MUTANT undefined argv1 returns true: the body runs on import from `node -e` (case goes red)", mut["undefined argv1 returns true"].importedFromEvalNoArg]);
  checks.push(["MUTANT catch returns true: the body runs on import (case goes red)", mut["catch returns true"].importedFromEvalWithArg]);

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
    suffixGuards(ownSource).length === 0 && rawGuards(ownSource).length === 0,
  ]);

  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (isMainModule(process.argv[1], import.meta.url)) {
  if (process.argv.includes("--self-test")) process.exit(selfTest());

  const files = trackedScripts();
  if (files.length < FILE_FLOOR) {
    console.error(`✗ only ${files.length} tracked scripts/**/*.mjs found (floor ${FILE_FLOOR}) — the derivation has drifted.`);
    console.error("  Refusing to report green over a scan this small.");
    process.exit(1);
  }

  const problems = [];
  const declaredHits = new Set();
  let exactGuards = 0;
  for (const rel of files) {
    let text;
    try {
      text = readFileSync(join(repoRoot, rel), "utf8");
    } catch (err) {
      // Tracked but unreadable: not "clean", not skippable.
      problems.push(`${rel}: tracked but unreadable (${err && err.code}) — it was NOT scanned`);
      continue;
    }
    if (hasExactGuard(text)) exactGuards += 1;
    for (const hit of suffixGuards(text)) {
      if (DECLARED_SUFFIX_GUARDS.has(rel)) {
        declaredHits.add(rel);
        continue;
      }
      problems.push(
        `${rel}:${hit.line} uses the BASENAME-SUFFIX entry guard — a script that merely imports this module ` +
          "will run its gate body if its filename ends the same way. Use " +
          "`import.meta.url === pathToFileURL(process.argv[1]).href`.",
      );
    }
  }

  // The raw spellings: a finding unless declared.
  const rawDeclaredHits = new Set();
  for (const rel of files) {
    let text;
    try {
      text = readFileSync(join(repoRoot, rel), "utf8");
    } catch {
      continue; // already reported as unreadable above
    }
    for (const hit of rawGuards(text)) {
      if (DECLARED_RAW_GUARD_DEBT.has(rel)) {
        rawDeclaredHits.add(rel);
        continue;
      }
      problems.push(
        `${rel}:${hit.line} uses a RAW entry guard — it is symlink-blind: started through a symlinked path it ` +
          "skips its whole body and exits 0. Use `isMainModule(process.argv[1], import.meta.url)` from scripts/lib/is-main.mjs.",
      );
    }
  }
  for (const [rel, reason] of DECLARED_RAW_GUARD_DEBT) {
    if (rawDeclaredHits.has(rel)) {
      console.log(`  · ${rel}: DECLARED raw guard — ${reason}`);
    } else {
      problems.push(`${rel} carries a DECLARED_RAW_GUARD_DEBT entry but no longer uses a raw spelling — delete the entry.`);
    }
  }

  // A DECLARATION THAT NO LONGER APPLIES IS A FAILURE, not a silent carry-over — that is
  // how a debt list turns into a permanent carve-out.
  for (const [rel, reason] of DECLARED_SUFFIX_GUARDS) {
    if (declaredHits.has(rel)) {
      console.log(`  · ${rel}: DECLARED suffix guard — ${reason}`);
    } else {
      problems.push(
        `${rel} carries a DECLARED_SUFFIX_GUARDS entry but no longer uses the suffix form — ` +
          "delete the entry (this is what a fixed file looks like).",
      );
    }
  }

  console.log(
    `\nentry-guards: ${files.length} tracked script(s) scanned, ${exactGuards} carrying an exact entry guard, ` +
      `${DECLARED_SUFFIX_GUARDS.size} declared suffix guard(s), ${DECLARED_RAW_GUARD_DEBT.size} declared raw-guard debt, ${problems.length} problem(s); self-test runs under --self-test`,
  );

  if (exactGuards < EXACT_GUARD_FLOOR) {
    console.error(`✗ only ${exactGuards} exact entry guard(s) found (floor ${EXACT_GUARD_FLOOR}) — the detector has drifted.`);
    process.exit(1);
  }
  if (problems.length > 0) {
    console.error(`\nEntry-guard gate FAILED: ${problems.length} problem(s).`);
    for (const p of problems) console.error(`  ✗ ${p}`);
    process.exit(1);
  }
  console.log("Entry-guard gate passed — no undeclared module runs its gate body on a filename match.");
}
