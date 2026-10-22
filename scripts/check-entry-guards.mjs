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
// WHAT IS GATED: three things, outside the declared lists.
//   1. in any tracked `scripts/**/*.mjs`, the SUFFIX form (the first defect above);
//   2. in the same files, a SHAPE: any statement that compares `process.argv[1]` with the
//      module's own URL or path unless it goes through `isMainModule` or a realpath on both
//      sides. Read through a lexer (comments, strings and regex literals are blanked, template
//      expressions kept), so wrapped lines, either operand order, `pathToFileURL(resolve(..))`,
//      `new URL(`file://${..}`)`, `.at(1)`, `["argv"][1]`, `import.meta.filename`, an alias of
//      argv or of the self path, a literal `.endsWith(..)` test, a raw compare ORed with a
//      helper call and a swapped-argument `isMainModule` call are all findings. KNOWN MISSES,
//      pinned as misses in the self-test: a self path built by a function the detector cannot
//      see, a comparison split across two statements by a boolean. The lexer is a heuristic, not
//      a JavaScript parser: it first lost a whole file to a regex literal holding a backtick;
//   3. scripts that ship ALONE inside a container (scripts/lib/shipped-imports.mjs): one
//      container per compose service (all tracked compose files merged by service name) and per
//      Dockerfile stage; a relative import of a file that container does not hold, or holds a
//      DIFFERENT file at, fails. Not modelled, named here, in the PR body and in the backlog row:
//      compose `extends` and `profiles`; overlays merged across ALL tracked compose files, not per
//      `-f` combination; `$VAR`/`$ARG` in a source, destination or WORKDIR (reported as "not
//      modelled", never guessed); a `..` source leaving the repo; COPY --from an external image;
//      bare-specifier, require/createRequire and `new URL` references; only scripts/**/*.{mjs,cjs,js}
//      are read for imports; a non-literal dynamic import is reported.
// This still does NOT require a module to have an entry guard.
//
// SCOPE IS DERIVED: `git ls-files scripts/**/*.mjs`, so a new script joins the scan the
// moment it is tracked; an untracked scratch file cannot widen or narrow it.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { codeOnly } from "./lib/code-only.mjs";
import { isMainModule } from "./lib/is-main.mjs";
import { makeTree, shippedImportProblems } from "./lib/shipped-imports.mjs";

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
const DECLARED_RAW_GUARD_DEBT = new Map([
  [
    "scripts/lib/land-branch-gate.mjs",
    "the basename-suffix defect in a spelling the suffix detector does not see (`process.argv[1].endsWith(\"land-branch-gate.mjs\")`); check-scratch-git-hygiene maps this file to open PR #1133, which rewrites it, so the conversion lands there",
  ],
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
// process.argv[1] in every spelling the language offers: .argv[1], ?.[1], .at(1) and ["argv"][1] (a string
// is blanked by codeOnly, so the bracket form is `process[      ][1]` by the time it is matched).
const ARGV1_SRC = String.raw`process\s*(?:\.\s*argv\s*(?:\?\.)?\s*\[\s*1\s*\]|\.\s*argv\s*\.\s*at\s*\(\s*1\s*\)|\[\s+\]\s*\[\s*1\s*\])`;
const ARGV1 = new RegExp(ARGV1_SRC);
const SELF_PATH = /import\s*\.\s*meta\s*\.\s*(?:url|filename)|\b(?:SELF_FILE|SELF_PATH|SELF|THIS_FILE|__filename)\b/;
// A module-level name bound to this module's own path, or to process.argv[1], is the same thing under another name.
const SELF_ALIAS = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:fileURLToPath\s*\(\s*import\s*\.\s*meta\s*\.\s*url\s*\)|import\s*\.\s*meta\s*\.\s*(?:url|filename))\s*[;,\n]/g;
const ARGV_ALIAS = new RegExp(String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*${ARGV1_SRC}`, "g");
const ARGV_DESTRUCTURE = /\b(?:const|let|var)\s*\[\s*,\s*([A-Za-z_$][\w$]*)[^\]]*\]\s*=\s*process\s*\.\s*argv\b/g;

/**
 * Pure: the symlink-blind entry guards in one file's text, with line numbers. A SHAPE, not a list of spellings:
 * any statement that compares `process.argv[1]` (however spelled or aliased, either operand order, however
 * wrapped) with this module's own URL or path (`import.meta.url`, `import.meta.filename`, or a name bound to
 * either), and does not go through `isMainModule` or a realpath on BOTH sides; and any suffix test of
 * `process.argv[1]` against a literal (`.endsWith("x.mjs")`, the first defect in another spelling); and an
 * `isMainModule` call with its arguments swapped, which never runs the body. A raw comparison ORed with a
 * helper call is still a finding: the helper call is removed before the rest is read.
 * Comments and string content are not code (a fixture quoting the bad form is not a finding).
 * KNOWN MISSES (pinned as such in the self-test): a path built through a function the detector cannot see
 * (`const here = getSelf()`), an argv read through a destructured parameter, and a comparison split across
 * two statements by an intermediate boolean.
 */
export function rawGuards(text) {
  const code = codeOnly(text);
  const aliases = (re) => [...code.matchAll(re)].map((m) => m[1]);
  const argvNames = [...aliases(ARGV_ALIAS), ...aliases(ARGV_DESTRUCTURE)];
  const selfNames = aliases(SELF_ALIAS);
  const word = (names) => (names.length ? new RegExp(`\\b(?:${names.map((n) => n.replace(/\$/g, "\\$")).join("|")})\\b`) : null);
  const argvWord = word(argvNames);
  const selfWord = word(selfNames);
  const out = [];
  let start = 0;
  const flush = (end) => {
    const raw = code.slice(start, end);
    const seg = raw.replace(/\bisMainModule\s*\(\s*process\s*\.\s*argv\s*\[\s*1\s*\]\s*,\s*import\s*\.\s*meta\s*\.\s*url\s*\)/g, " ");
    const argvHit = ARGV1.exec(seg) ?? (argvWord ? argvWord.exec(seg) : null);
    const bareCompare = /[!=]==?/.test(seg);
    const selfHit = SELF_PATH.test(seg) || (selfWord !== null && selfWord.test(seg));
    const realBoth = (seg.match(/\breal\w*\s*\(/g) ?? []).length >= 2;
    let reason = null;
    if (argvHit && bareCompare && selfHit && !realBoth) reason = "compares process.argv[1] with this module's own path";
    else if (argvHit && new RegExp(`(?:${ARGV1_SRC})\\s*\\.\\s*(?:endsWith|startsWith|includes)\\s*\\(`).test(seg)) reason = "tests process.argv[1] against a literal (the basename-suffix defect)";
    else if (/\bisMainModule\s*\(\s*import\s*\.\s*meta\s*\.\s*url/.test(raw)) reason = "calls isMainModule with its arguments swapped (the body never runs)";
    if (reason) {
      const anchor = argvHit ? argvHit.index : Math.max(0, raw.search(/isMainModule/));
      const line = code.slice(0, start + anchor).split("\n").length;
      out.push({ line, text: raw.replace(/\s+/g, " ").trim().slice(0, 160), reason });
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
      // import.meta.url keeps the SYMLINK path here, so a realpath on only one side stops matching
      preservedSymlinkStart: ran(["--preserve-symlinks", "--preserve-symlinks-main", join(dir, "link", "mod.mjs")], dir),
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

const COMPOSE_NAME = /(?:^|\/)(?:[^/]*compose[^/]*)\.ya?ml$/i;
const DOCKERFILE_NAME = /(?:^|\/)(?:[^/]*(?:dockerfile|containerfile)[^/]*)$/i;

/** Every tracked compose file and Dockerfile/Containerfile, any directory, any name containing the word. */
function deployFiles() {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const all = out.split("\0").filter(Boolean);
  return { all, compose: all.filter((f) => COMPOSE_NAME.test(f)), docker: all.filter((f) => DOCKERFILE_NAME.test(f)) };
}

/** The live shipped-import check: unreadable deploy files and shipped scripts are problems, never silence. */
function liveShipped() {
  const { all, compose, docker } = deployFiles();
  const read = (f) => readFileSync(join(repoRoot, f), "utf8");
  const problems = [];
  const load = (names) =>
    names.flatMap((name) => {
      try {
        return [{ name, text: read(name) }];
      } catch (err) {
        problems.push(`${name}: tracked deploy file unreadable (${err && err.code}) - NOT scanned`);
        return [];
      }
    });
  const composes = load(compose);
  const dockerfiles = load(docker);
  const r = shippedImportProblems({ composes, dockerfiles, tree: makeTree({ files: all, read }) });
  return { ...r, problems: [...problems, ...r.problems], composeFiles: composes.length, dockerFiles: dockerfiles.length };
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
  checks.push(["…also under --preserve-symlinks-main, where import.meta.url keeps the link path", real.preservedSymlinkStart]);
  checks.push(["…and does NOT run its body when imported by another file", !real.importedByFile]);
  checks.push(["…nor when imported from `node -e` with a dummy argv[1]", !real.importedFromEvalWithArg]);
  checks.push(["…nor when imported from `node -e` with no argv[1] at all", !real.importedFromEvalNoArg]);
  const mut = Object.fromEntries(Object.entries(mutants).map(([k, v]) => [k, probeHelper(v)]));
  checks.push(["MUTANT realpath on one side only: the --preserve-symlinks-main start skips its body (case goes red)", !probeHelper(helperSource.replace("realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl))", "realpathSync(argv1) === fileURLToPath(moduleUrl)")).preservedSymlinkStart]);
  checks.push(["MUTANT realpathSync removed: the symlinked start skips its body (case goes red)", !mut["realpathSync removed"].symlinkedStart]);
  checks.push(["MUTANT undefined argv1 returns true: the body runs on import from `node -e` (case goes red)", mut["undefined argv1 returns true"].importedFromEvalNoArg]);
  checks.push(["MUTANT catch returns true: the body runs on import (case goes red)", mut["catch returns true"].importedFromEvalWithArg]);

  // SHIPPED ALONE, per container. A tiny tree: scripts/a.mjs imports ./lib/h.mjs, which imports nothing.
  const T = { "scripts/a.mjs": 'import { h } from "./lib/h.mjs";\n', "scripts/lib/h.mjs": "export const h = 1;\n", "scripts/lib/other.mjs": "export const o = 2;\n", "scripts/dyn.mjs": "const m = await import(`./x/${n}.mjs`);\n", "scripts/data.mjs": 'import d from "./d.json" with { type: "json" };\n', "scripts/d.json": "{}\n", "scripts/up.mjs": 'import { h } from "../scripts/lib/h.mjs";\n' };
  const treeOf = (extra = {}, drop = []) => {
    const files = { ...T, ...extra };
    for (const d of drop) delete files[d];
    return makeTree({ files: Object.keys(files), read: (f) => { if (!(f in files)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); return files[f]; } });
  };
  const ship = (composes, dockerfiles = [], tree = treeOf()) =>
    shippedImportProblems({ composes: composes.map((text, i) => ({ name: `c${i}.yml`, text })), dockerfiles: dockerfiles.map((text, i) => ({ name: `D${i}`, text })), tree });
  const svc = (name, vols) => `  ${name}:\n    volumes:\n${vols.map((v) => `      - ${v}`).join("\n")}\n`;
  const compose = (...services) => `services:\n${services.join("")}`;
  const A = "./scripts/a.mjs:/app/a.mjs:ro";
  const H = "./scripts/lib/h.mjs:/app/lib/h.mjs:ro";
  const n = (r) => r.problems.length;
  checks.push(["SHIPPED ALONE: an import the container does not hold is a problem", n(ship([compose(svc("idp", [A]))])) === 1]);
  checks.push(["…and is fine once the import is mounted beside the script", n(ship([compose(svc("idp", [A, H]))])) === 0]);
  // M1: another container's mount must not satisfy this one
  checks.push(["M1 the import mounted on a DIFFERENT service does not count", n(ship([compose(svc("idp", [A]), svc("api", [H]))])) === 1]);
  checks.push(["M1 an unrelated sidecar in ANOTHER compose file mounting the helper does not count", n(ship([compose(svc("idp", [A])), compose(svc("sidecar", [H]))])) === 1]);
  checks.push(["M1 an overlay for the SAME service name is merged (the -f case), in either file order", n(ship([compose(svc("idp", [A])), compose(svc("idp", [H]))])) === 0 && n(ship([compose(svc("idp", [H])), compose(svc("idp", [A]))])) === 0]);
  checks.push(["M1 a Dockerfile stage copying the script to ./ is judged alone, whatever a compose service mounts", n(ship([compose(svc("idp", [A, H]))], ["FROM node\nWORKDIR /app\nCOPY scripts/a.mjs ./\n"])) === 1]);
  checks.push(["M1 the file at the resolved path must BE the repo file (a different file mounted at that path)", n(ship([compose(svc("idp", [A, "./scripts/lib/other.mjs:/app/lib/h.mjs:ro"]))])) === 1]);
  // L1: layouts that are correct
  checks.push(["L1 a directory mount ./scripts/lib:/app/lib is enough", n(ship([compose(svc("idp", [A, "./scripts/lib:/app/lib:ro"]))])) === 0]);
  checks.push(["L1 COPY scripts/lib/ ./lib/ is enough", n(ship([], ["FROM node\nWORKDIR /app\nCOPY scripts/a.mjs ./\nCOPY scripts/lib/ ./lib/\n"])) === 0]);
  checks.push(["L1 the helper arriving by COPY --from=<stage> is enough", n(ship([], ["FROM node AS b\nWORKDIR /app\nCOPY scripts/a.mjs ./scripts/\nCOPY scripts/lib/ ./scripts/lib/\nFROM node\nWORKDIR /srv\nCOPY --from=b /app/scripts/a.mjs /app/scripts/lib/h.mjs /srv/\n"])) === 1 && n(ship([], ["FROM node AS b\nWORKDIR /app\nCOPY scripts/a.mjs ./scripts/\nCOPY scripts/lib/ ./scripts/lib/\nFROM node\nWORKDIR /srv\nCOPY --from=b /app/scripts/a.mjs /srv/a.mjs\nCOPY --from=b /app/scripts/lib/ /srv/lib/\n"])) === 0]);
  checks.push(["L1 a .json import served by a .json mount is enough", n(ship([compose(svc("idp", ["./scripts/data.mjs:/app/data.mjs", "./scripts/d.json:/app/d.json"]))])) === 0 && n(ship([compose(svc("idp", ["./scripts/data.mjs:/app/data.mjs"]))])) === 1]);
  checks.push(["L1 a single-file rename COPY scripts/a.mjs /app/server.mjs places it at that path, not under it", n(ship([], ["FROM node\nCOPY scripts/a.mjs /app/server.mjs\nCOPY scripts/lib/h.mjs /app/lib/h.mjs\n"])) === 0]);
  checks.push(["L1 WORKDIR /srv with an absolute /srv/lib/ destination", n(ship([], ["FROM node\nWORKDIR /srv\nCOPY scripts/a.mjs /srv/\nCOPY scripts/lib/h.mjs /srv/lib/\n"])) === 0]);
  // M2: syntaxes that must be READ
  checks.push(["M2 compose long syntax (type: bind, source, target)", n(ship(["services:\n  idp:\n    volumes:\n      - type: bind\n        source: ./scripts/a.mjs\n        target: /app/a.mjs\n"])) === 1 && n(ship(["services:\n  idp:\n    volumes:\n      - type: bind\n        source: ./scripts/a.mjs\n        target: /app/a.mjs\n      - type: bind\n        source: ./scripts/lib/h.mjs\n        target: /app/lib/h.mjs\n"])) === 0]);
  checks.push(["M2 compose flow-style volumes: [..]", n(ship(["services:\n  idp:\n    volumes: [./scripts/a.mjs:/app/a.mjs, ./scripts/lib/h.mjs:/app/lib/h.mjs]\n"])) === 0 && n(ship(["services:\n  idp:\n    volumes: [./scripts/a.mjs:/app/a.mjs]\n"])) === 1]);
  checks.push(["M2 ${PWD}/ sources are repo-relative", n(ship([compose(svc("idp", ["${PWD}/scripts/a.mjs:/app/a.mjs"]))])) === 1]);
  checks.push(["M2 a ../ source that leaves the repo is dropped and reported, not guessed", ship([compose(svc("idp", ["../scripts/a.mjs:/app/a.mjs"]))]).dropped.length === 1]);
  checks.push(["M2 Dockerfile ADD, lowercase copy, JSON-array COPY and backslash continuations are read", n(ship([], ["FROM node\nworkdir /app\nadd scripts/a.mjs ./\ncopy [\"scripts/lib/h.mjs\", \"./lib/h.mjs\"]\n"])) === 0 && n(ship([], ["FROM node\nWORKDIR /app\nCOPY scripts/a.mjs \\\n  ./\n"])) === 1]);
  checks.push(["M2 a glob COPY scripts/*.mjs ./ ships what it matches", n(ship([], ["FROM node\nWORKDIR /app\nCOPY scripts/a.mjs scripts/*.mjs ./\nCOPY scripts/lib/ ./lib/\n"], treeOf({}, ["scripts/dyn.mjs", "scripts/data.mjs", "scripts/up.mjs"]))) === 0]);
  checks.push(["M2 a relative destination follows WORKDIR (not a hard-coded /app)", n(ship([], ["FROM node\nWORKDIR /srv\nCOPY scripts/a.mjs ./\nCOPY scripts/lib/h.mjs ./lib/\n"])) === 0 && n(ship([], ["FROM node\nWORKDIR /srv\nCOPY scripts/a.mjs ./\nWORKDIR /app\nCOPY scripts/lib/h.mjs ./lib/\n"])) === 1]);
  checks.push(["M2 a $ARG in a COPY is dropped and reported", ship([], ["FROM node\nARG X\nCOPY scripts/${X}.mjs ./\n"]).dropped.length === 1]);
  checks.push(["M2 a non-literal dynamic import(`./${x}`) in a shipped script is a problem", n(ship([compose(svc("idp", ["./scripts/dyn.mjs:/app/dyn.mjs"]))])) === 1]);
  checks.push(["M2 a ../ import that IS shipped is satisfied (scripts/up.mjs at /app/x reaching /app/scripts/lib/h.mjs)", n(ship([compose(svc("idp", ["./scripts/up.mjs:/app/x/up.mjs", "./scripts/lib/h.mjs:/app/scripts/lib/h.mjs"]))])) === 0]);
  checks.push(["M2 a ../ import is resolved (scripts/up.mjs reaching scripts/lib/h.mjs)", n(ship([compose(svc("idp", ["./scripts/up.mjs:/app/x/up.mjs"]))])) === 1]);
  // L3: fail closed
  checks.push(["L3 unparseable compose YAML is a problem, not silence", n(ship(["services: [unclosed\n"])) === 1]);
  checks.push(["L3 binary-junk compose and Dockerfile content is a problem", n(ship(["services:\n\u0000\u0001\n"])) === 1 && n(ship([], ["FROM node\n\u0000"])) === 1]);
  checks.push(["L3 a shipped script the tree cannot read is a problem", n(ship([compose(svc("idp", [A, H]))], [], treeOf({}, ["scripts/a.mjs"]))) >= 0 && n(shippedImportProblems({ composes: [{ name: "c.yml", text: compose(svc("idp", [A])) }], dockerfiles: [], tree: makeTree({ files: ["scripts/a.mjs"], read: () => { throw Object.assign(new Error("x"), { code: "EACCES" }); } }) })) === 1]);

  // dynamic literal import, comments, case, and the scan's own reporting
  checks.push(["a literal dynamic import(\"./lib/h.mjs\") in a shipped script is read", n(ship([compose(svc("idp", ["./scripts/dynlit.mjs:/app/dynlit.mjs"]))], [], treeOf({ "scripts/dynlit.mjs": 'const m = await import("./lib/h.mjs");\n' }))) === 1]);
  checks.push(["an import quoted in a comment or a string is not an import", n(ship([compose(svc("idp", ["./scripts/quoted.mjs:/app/quoted.mjs"]))], [], treeOf({ "scripts/quoted.mjs": '// import { h } from "./lib/nothere.mjs";\nconst s = "import x from \\"./lib/nothere2.mjs\\"";\n' }))) === 0]);
  checks.push(["paths are case-sensitive: only a lib/ mount exists, the import says ./Lib/", n(ship([compose(svc("idp", ["./scripts/cs.mjs:/app/cs.mjs", "./scripts/Lib/h.mjs:/app/lib/h.mjs"]))], [], treeOf({ "scripts/cs.mjs": 'import { h } from "./Lib/h.mjs";\n', "scripts/Lib/h.mjs": "export const h = 1;\n" }))) === 1]);
  checks.push(["paths are case-sensitive (a different file mounted at the folded path)", n(ship([compose(svc("idp", ["./scripts/cs.mjs:/app/cs.mjs", H]))], [], treeOf({ "scripts/cs.mjs": 'import { h } from "./Lib/h.mjs";\n' }))) === 1]);

  // THE SCAN, as the CLI reports it
  const okShip = { problems: [], composeFiles: 3, dockerFiles: 2, containers: 4, shippedScripts: 3, dropped: [] };
  const scanOf = (over = {}) => scan({ files: ["scripts/x.mjs"], readText: () => "export const x = 1;\n", ship: okShip, suffixDebt: new Map(), rawDebt: new Map(), ...over });
  checks.push(["SCAN: a clean tree reports no problem", scanOf().problems.length === 0]);
  checks.push(["SCAN: a shipped-import problem is REPORTED by the scan (not only by the self-test)", scanOf({ ship: { ...okShip, problems: ["c: boom"] } }).problems.includes("c: boom")]);
  checks.push(["SCAN: a shipped-import scan below ANY of its floors is a problem", ["shippedScripts", "containers", "composeFiles", "dockerFiles"].every((k) => scanOf({ ship: { ...okShip, [k]: 1 } }).problems.length === 1)]);
  checks.push(["SCAN: an unreadable tracked script is a problem, not silence", scanOf({ readText: () => { throw Object.assign(new Error("x"), { code: "ENOENT" }); } }).problems.length === 1]);
  checks.push(["SCAN: a raw guard in an undeclared file is a problem; declared, it is a note", scanOf({ readText: () => `if (${RAW_URL}) {}\n` }).problems.length === 1 && scanOf({ readText: () => `if (${RAW_URL}) {}\n`, rawDebt: new Map([["scripts/x.mjs", "r"]]) }).problems.length === 0]);
  checks.push(["SCAN: a declared entry whose file no longer carries the form is a problem", scanOf({ rawDebt: new Map([["scripts/x.mjs", "r"]]) }).problems.length === 1]);

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
  // Known misses, pinned as misses so the header's claim is the measured one:
  checks.push(["L2 KNOWN MISS: a self path built by a function the detector cannot see", raw(`const here = getSelf();\nif (resolve(${ARGV}) === here) {}\n`) === 0]);
  checks.push(["L2 KNOWN MISS: a comparison split across two statements by a boolean", raw(`const same = resolve(${ARGV}) === resolve(getSelf());\nif (same) {}\n`) === 0]);

  // THE LIVE TREE
  const liveShip = liveShipped();
  checks.push([`LIVE: every script a compose service or Dockerfile stage ships alone has its relative imports shipped (${liveShip.shippedScripts} shipped over ${liveShip.containers} containers)`, liveShip.problems.length === 0]);
  checks.push(["LIVE: the floors hold (compose files, Dockerfiles, containers and shipped scripts are all found)", liveShip.composeFiles >= 3 && liveShip.dockerFiles >= 2 && liveShip.containers >= 4 && liveShip.shippedScripts >= 3]);
  const idpCompose = readFileSync(join(repoRoot, "scripts/fixture-idp.compose.yml"), "utf8");
  const liveTree = makeTree({ files: deployFiles().all, read: (f) => readFileSync(join(repoRoot, f), "utf8") });
  const noMount = shippedImportProblems({ composes: [{ name: "idp.yml", text: idpCompose.replace(/^.*is-main\.mjs.*$/gm, "") }], dockerfiles: [], tree: liveTree });
  checks.push(["MUTANT: the real fixture IdP overlay without its is-main mount is a problem (the round-2 CI red)", noMount.problems.length >= 1]);
  const moved = idpCompose.replace(/^(.*is-main\.mjs.*)$/gm, "").replace(/^  idp:/m, "  idp:").concat("\n  other:\n    volumes:\n      - ./scripts/lib/is-main.mjs:/app/lib/is-main.mjs:ro\n");
  checks.push(["MUTANT: that mount moved to another service is still a problem", shippedImportProblems({ composes: [{ name: "idp.yml", text: moved }], dockerfiles: [], tree: liveTree }).problems.length >= 1]);

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

/**
 * The whole scan, pure: `readText(rel)` and `ship` are passed in so the self-test can plant a tree. Everything
 * the CLI reports comes from here, so a regression in what is REPORTED (not only in what is detected) is
 * visible to the self-test.
 */
export function scan({ files, readText, ship, suffixDebt = DECLARED_SUFFIX_GUARDS, rawDebt = DECLARED_RAW_GUARD_DEBT }) {
  const problems = [];
  const notes = [];
  const suffixHits = new Set();
  const rawHits = new Set();
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
    for (const hit of rawGuards(text)) {
      if (rawDebt.has(rel)) {
        rawHits.add(rel);
        continue;
      }
      problems.push(
        `${rel}:${hit.line} ${hit.reason} — a symlink-blind entry guard: started through a symlinked path it ` +
          "skips its whole body and exits 0. Use `isMainModule(process.argv[1], import.meta.url)` from scripts/lib/is-main.mjs.",
      );
    }
  }
  for (const p of ship.problems) problems.push(p);
  if (ship.composeFiles < 3 || ship.dockerFiles < 2 || ship.containers < 4 || ship.shippedScripts < 3) {
    problems.push(
      `shipped-import scan found only ${ship.composeFiles} compose file(s), ${ship.dockerFiles} Dockerfile(s), ${ship.containers} container(s), ` +
        `${ship.shippedScripts} shipped script(s) - the derivation has drifted`,
    );
  }
  for (const d of ship.dropped ?? []) notes.push(`not modelled: ${d}`);
  // A DECLARATION THAT NO LONGER APPLIES IS A FAILURE, not a silent carry-over — that is
  // how a debt list turns into a permanent carve-out.
  for (const [rel, reason] of rawDebt) {
    if (rawHits.has(rel)) notes.push(`${rel}: DECLARED raw guard — ${reason}`);
    else problems.push(`${rel} carries a DECLARED_RAW_GUARD_DEBT entry but no longer uses a raw spelling — delete the entry.`);
  }
  for (const [rel, reason] of suffixDebt) {
    if (suffixHits.has(rel)) notes.push(`${rel}: DECLARED suffix guard — ${reason}`);
    else problems.push(`${rel} carries a DECLARED_SUFFIX_GUARDS entry but no longer uses the suffix form — delete the entry (this is what a fixed file looks like).`);
  }
  return { problems, notes, exactGuards };
}

if (isMainModule(process.argv[1], import.meta.url)) {
  if (process.argv.includes("--self-test")) process.exit(selfTest());

  const files = trackedScripts();
  if (files.length < FILE_FLOOR) {
    console.error(`✗ only ${files.length} tracked scripts/**/*.mjs found (floor ${FILE_FLOOR}) — the derivation has drifted.`);
    console.error("  Refusing to report green over a scan this small.");
    process.exit(1);
  }
  const { problems, notes, exactGuards } = scan({ files, readText: (rel) => readFileSync(join(repoRoot, rel), "utf8"), ship: liveShipped() });
  for (const n of notes) console.log(`  · ${n}`);
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
