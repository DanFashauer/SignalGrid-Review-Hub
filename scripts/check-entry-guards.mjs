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
//   2. in the same files, a SHAPE (rawGuards): a statement that compares `process.argv[1]` with the module's
//      own path unless it goes through `isMainModule` or a realpath call wraps EACH compared operand; a literal
//      `.endsWith(..)`/`.startsWith(..)`/`.includes(..)` test or a basename compare of `process.argv[1]`; an
//      `isMainModule` call with swapped arguments. Read from code through a lexer (comments, strings and regex
//      literals blanked, template expressions kept); `process.argv[1]` is recognised as .argv[1], ?.[1], .at(1),
//      ["argv"][1] and through `const x = process.argv[1]` / `const [, x] = process.argv`; the self path as
//      import.meta.url / .filename and through a `const` bound to fileURLToPath(..), resolve(..) of it or
//      `new URL(import.meta.url).pathname`. NOT detected, each pinned as a miss in the self-test: a self path
//      built by a function the detector cannot see; a comparison split across two statements; `let x; x =
//      process.argv[1]`; `const args = process.argv; args[1]`; `const { argv: [, x] } = process`; `import { argv }
//      from "node:process"`; any argv read through a parameter. The lexer is a heuristic, not a parser;
//   3. scripts that ship ALONE inside a container (scripts/lib/shipped-imports.mjs): one container per compose
//      service (all tracked compose files merged by service name, YAML merge keys resolved) and per Dockerfile
//      stage (a compose-built Dockerfile's other stages included); a relative import of a file that container does
//      not hold, or holds a DIFFERENT file at, fails; an unreadable, binary or unparseable deploy file, a build
//      Dockerfile that is not tracked and a `target:` that is not a stage are problems, never skips. Its ceilings
//      are listed at the top of that file and repeated in the PR body and the backlog row: compose `extends`,
//      `profiles`, `configs:`, `dockerfile_inline`; services merged across ALL compose files rather than per `-f`
//      combination; bind sources read relative to the repo root, not the compose file's directory; `$VAR`/`$ARG`
//      paths and `..` sources leaving the repo (reported as "not modelled"); COPY --from an external image;
//      `.dockerignore`; heredoc COPY; files only a base image holds; bare-specifier, require, createRequire and
//      `new URL` references; imports are read only from scripts/**/*.{mjs,cjs,js}; a RUN is not modelled, so a copied
//      script that is never run is still checked.
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
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
// process.argv[1] in the spellings below: .argv[1], ?.[1], .at(1) and ["argv"][1] (a string is blanked by
// codeOnly, so the bracket form is `process[      ][1]` by the time it is matched).
const ARGV1_SRC = String.raw`process\s*(?:\.\s*argv\s*(?:\?\.)?\s*\[\s*1\s*\]|\.\s*argv\s*\.\s*at\s*\(\s*1\s*\)|\[\s+\]\s*\[\s*1\s*\])`;
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

/**
 * Pure: the symlink-blind entry guards in one file's text, with line numbers. Not a list of spellings but a
 * SHAPE, read from code (comments, strings and regex literals blanked): a statement that
 *   - compares `process.argv[1]` (spelled .argv[1], ?.[1], .at(1), ["argv"][1], or a name bound to it by
 *     `const x = process.argv[1]` or `const [, x] = process.argv`) with this module's own path (import.meta.url,
 *     import.meta.filename, or a name bound to `fileURLToPath(import.meta.url)` / `resolve(...)` of it /
 *     `new URL(import.meta.url).pathname`), either operand order, however wrapped, unless a realpath call wraps
 *     EACH compared operand;
 *   - tests process.argv[1] with .endsWith/.startsWith/.includes against a literal (the first defect, in a
 *     spelling the suffix detector does not see), or compares its basename;
 *   - calls `isMainModule` with its arguments swapped (the body then never runs).
 * A raw comparison ORed with a helper call is still a finding: the helper call is removed before the rest is read.
 * KNOWN MISSES, each pinned as a miss in the self-test (so this list is the measured one): a self path built by a
 * function the detector cannot see; a comparison split across two statements by an intermediate boolean;
 * `let entry; entry = process.argv[1]`; `const args = process.argv; args[1]`; `const { argv: [, entry] } = process`;
 * `import { argv } from "node:process"`; any argv read through a parameter.
 */
export function rawGuards(text) {
  const code = codeOnly(text);
  const names = (re) => [...code.matchAll(re)].map((m) => m[1]);
  const argvWord = wordOf([...names(ARGV_ALIAS), ...names(ARGV_DESTRUCTURE)]);
  const selfWord = wordOf(names(SELF_ALIAS));
  const out = [];
  let start = 0;
  const flush = (end) => {
    const raw = code.slice(start, end);
    const seg = raw.replace(/\bisMainModule\s*\(\s*process\s*\.\s*argv\s*\[\s*1\s*\]\s*,\s*import\s*\.\s*meta\s*\.\s*url\s*\)/g, " ");
    const argvHit = ARGV1.exec(seg) ?? (argvWord ? argvWord.exec(seg) : null);
    const op = /[!=]==?/.exec(seg);
    const selfHit = SELF_PATH.test(seg) || (selfWord !== null && selfWord.test(seg));
    // "realpath on both sides" means a realpath call inside EACH operand of the comparison, not anywhere in the statement.
    const realBoth = op !== null && REAL_CALL.test(seg.slice(0, op.index)) && REAL_CALL.test(seg.slice(op.index + op[0].length));
    let reason = null;
    if (argvHit && op && selfHit && !realBoth) reason = "compares process.argv[1] with this module's own path";
    else if (argvHit && new RegExp(`(?:${ARGV1_SRC})\\s*\\)?\\s*\\.\\s*(?:endsWith|startsWith|includes)\\s*\\(`).test(seg)) reason = "tests process.argv[1] against a literal (the basename-suffix defect)";
    else if (op && new RegExp(`\\bbasename\\s*\\(\\s*(?:${ARGV1_SRC})\\s*\\)`).test(seg)) reason = "compares the basename of process.argv[1]";
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

/** Pure: which tracked paths are compose files and which are Dockerfiles/Containerfiles (any directory, any name holding the word). */
export function classifyDeploy(all) {
  return { compose: all.filter((f) => COMPOSE_NAME.test(f)), docker: all.filter((f) => DOCKERFILE_NAME.test(f)) };
}

/** Pure: read each deploy file; one that cannot be read is a problem, never a skip. */
export function loadDeploy(names, read) {
  const items = [];
  const problems = [];
  for (const name of names) {
    try {
      items.push({ name, text: read(name) });
    } catch (err) {
      problems.push(`${name}: tracked deploy file unreadable (${err && err.code}) - NOT scanned`);
    }
  }
  return { items, problems };
}

function deployFiles() {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const all = out.split("\0").filter(Boolean);
  return { all, ...classifyDeploy(all) };
}

/** The live shipped-import check. */
function liveShipped() {
  const { all, compose, docker } = deployFiles();
  const read = (f) => readFileSync(join(repoRoot, f), "utf8");
  const c = loadDeploy(compose, read);
  const d = loadDeploy(docker, read);
  const r = shippedImportProblems({ composes: c.items, dockerfiles: d.items, tree: makeTree({ files: all, read }) });
  // The container the CI compose smoke depends on, by name: a refactor that makes it vanish must not pass on the floors alone.
  const fixtureIdp = (r.shipped.get("compose service idp") ?? []).includes("scripts/fixture-idp.mjs");
  return { ...r, fixtureIdp, problems: [...c.problems, ...d.problems, ...r.problems], composeFiles: c.items.length, dockerFiles: d.items.length };
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

  const helperSource = readFileSync(join(repoRoot, "scripts/lib/is-main.mjs"), "utf8");
  // H1: the gate that watches the helper must not depend on it. The canary on the real helper is quiet and on every broken copy loud.
  checks.push(["H1 the helper canary is quiet on the real helper", helperCanary(isMainModule).length === 0]);
  const canaryOf = (src) => {
    const dir = mkdtempSync(join(tmpdir(), "entry-guard-canary-"));
    try {
      writeFileSync(join(dir, "is-main.mjs"), src);
      writeFileSync(join(dir, "run.mjs"), `import { helperCanary } from ${JSON.stringify(import.meta.url)};\nimport { isMainModule } from "./is-main.mjs";\nconsole.log(JSON.stringify(helperCanary(isMainModule)));\n`);
      return JSON.parse(execFileSync(process.execPath, [join(dir, "run.mjs")], { encoding: "utf8" }));
    } catch {
      return ["the canary run itself failed"];
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  // H1, end to end: a COPY of this gate beside a broken helper must exit 1 and say the helper is broken. The copy
  // runs its own canary before anything else, so it needs no git tree; node_modules is linked for `yaml`.
  const gateWithHelper = (helperSrc) => {
    const dir = mkdtempSync(join(tmpdir(), "entry-guard-gate-"));
    try {
      mkdirSync(join(dir, "scripts", "lib"), { recursive: true });
      for (const f of ["check-entry-guards.mjs", "lib/code-only.mjs", "lib/shipped-imports.mjs"]) writeFileSync(join(dir, "scripts", f), readFileSync(join(repoRoot, "scripts", f)));
      writeFileSync(join(dir, "scripts", "lib", "is-main.mjs"), helperSrc);
      symlinkSync(join(repoRoot, "scripts", "node_modules"), join(dir, "scripts", "node_modules"));
      const r = spawnSync(process.execPath, [join(dir, "scripts", "check-entry-guards.mjs"), "--self-test"], { encoding: "utf8", timeout: 60000 });
      return { status: r.status, stderr: r.stderr ?? "" };
    } catch (err) {
      return { status: -1, stderr: String(err && err.message) };
    } finally {
      rmSync(dir, { recursive: true, force: true });
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
  checks.push(["…nor when imported from `node -e` with a dummy argv[1]", !real.importedFromEvalWithArg]);
  checks.push(["…nor when imported from `node -e` with no argv[1] at all", !real.importedFromEvalNoArg]);
  const mut = Object.fromEntries(Object.entries(mutants).map(([k, v]) => [k, probeHelper(v)]));
  checks.push(["MUTANT realpath on one side only: the --preserve-symlinks-main start skips its body (case goes red)", !probeHelper(helperSource.replace("realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl))", "realpathSync(argv1) === fileURLToPath(moduleUrl)")).preservedSymlinkStart]);
  checks.push(["MUTANT realpathSync removed: the symlinked start skips its body (case goes red)", !mut["realpathSync removed"].symlinkedStart]);
  checks.push(["MUTANT undefined argv1 returns true: the body runs on import from `node -e` (case goes red)", mut["undefined argv1 returns true"].importedFromEvalNoArg]);
  checks.push(["MUTANT catch returns true: the body runs on import (case goes red)", mut["catch returns true"].importedFromEvalWithArg]);
  checks.push(["H1 MUTANT fileURLToPath import deleted: every start silently skips its body", !mut["fileURLToPath import deleted"].symlinkedStart]);
  checks.push(["H1 …and the canary says so for it, and for every other broken copy of the helper (the one-sided realpath only differs under --preserve-symlinks-main, which the probe above pins)", Object.entries(mutants).every(([k, src]) => k === "one-sided realpath" || canaryOf(src).length > 0)]);

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

  // ROUND 5. Each case below pins a defect the round-4 refute found.
  const dock = (text, extra) => ship([], [text], extra);
  const ENTRY = 'FROM node AS b\nWORKDIR /app\nCOPY scripts/ /scripts/\n';
  checks.push(["M1 COPY --from with a RELATIVE source resolves from the stage root, not its WORKDIR", n(dock(ENTRY + "FROM node\nCOPY --from=b scripts/a.mjs /srv/a.mjs\n")) >= 1 && n(dock(ENTRY + "FROM node\nCOPY --from=b /scripts/a.mjs /srv/a.mjs\nCOPY --from=b /scripts/lib/ /srv/lib/\n", treeOf({}, ["scripts/dyn.mjs", "scripts/data.mjs", "scripts/up.mjs"]))) === 0]);
  checks.push(["M2 FROM <earlier stage> inherits that stage's files and WORKDIR", n(ship([compose("  idp:\n    build:\n      context: .\n      dockerfile: D0\n")], ["FROM node AS base\nWORKDIR /app\nCOPY scripts/a.mjs ./\nCOPY scripts/lib/ ./lib/\nFROM base AS final\nCOPY scripts/lib/other.mjs /tmp/o.mjs\n"], treeOf({}, ["scripts/dyn.mjs", "scripts/data.mjs", "scripts/up.mjs"]))) === 0]);
  checks.push(["M2 a helper shipped in the BASE stage reaches a runtime stage that adds only the entry", n(ship([compose("  idp:\n    build:\n      dockerfile: D0\n")], ["FROM node AS base\nWORKDIR /app\nCOPY scripts/lib/ ./lib/\nFROM base AS final\nCOPY scripts/a.mjs ./\n"], treeOf({}, ["scripts/dyn.mjs", "scripts/data.mjs", "scripts/up.mjs"]))) === 0]);
  checks.push(["M2 …and the entry copied only in the base stage is still seen (a runtime stage that inherits it, without the helper, fails)", n(ship([compose("  idp:\n    build:\n      context: .\n      dockerfile: D0\n")], ["FROM node AS base\nWORKDIR /app\nCOPY scripts/a.mjs ./\nFROM base AS final\nRUN true\n"])) >= 1]);
  checks.push(["M3 a compose build: Dockerfile under ANY name is read from the tree; a missing one is a problem", ship([compose("  idp:\n    build:\n      context: .\n      dockerfile: containers/api.build\n")], [], treeOf({ "containers/api.build": "FROM node\nWORKDIR /app\nCOPY scripts/a.mjs ./\n" })).problems.every((x) => x.includes("shipped alone")) && n(ship([compose("  idp:\n    build:\n      context: .\n      dockerfile: containers/api.build\n")], [], treeOf({ "containers/api.build": "FROM node\nWORKDIR /app\nCOPY scripts/a.mjs ./\n" }))) === 1 && ship([compose("  idp:\n    build:\n      dockerfile: nope.build\n")]).problems.some((x) => x.includes("NOT scanned"))]);
  checks.push(["M3 a typo'd target: is a problem, not a skip", ship([compose("  idp:\n    build:\n      dockerfile: D0\n      target: runtmie\n")], ["FROM node AS runtime\nCOPY scripts/a.mjs /app/a.mjs\n"]).problems.some((x) => x.includes("NOT scanned"))]);
  checks.push(["M4 YAML merge keys (<<: *base) are resolved", n(ship(["x-base: &base\n  volumes:\n    - ./scripts/a.mjs:/app/a.mjs\nservices:\n  idp:\n    <<: *base\n"])) === 1 && n(ship(["x-base: &base\n  volumes:\n    - ./scripts/a.mjs:/app/a.mjs\n    - ./scripts/lib/h.mjs:/app/lib/h.mjs\nservices:\n  idp:\n    <<: *base\n"])) === 0]);
  checks.push(["M5 `COPY x .` takes the source's basename (and a second COPY does not overwrite it)", n(dock("FROM node\nWORKDIR /app\nCOPY scripts/a.mjs .\nCOPY scripts/lib/h.mjs ./lib/\n")) === 0 && n(dock("FROM node\nWORKDIR /app\nCOPY scripts/a.mjs .\nCOPY scripts/d.json .\n")) === 1 && n(dock("FROM node\nWORKDIR /app\nCOPY scripts/a.mjs /app\nCOPY scripts/lib/h.mjs ./lib/\n")) === 0]);
  checks.push(["M6 a builder stage of a compose-built Dockerfile is a container too", n(ship([compose("  web:\n    build:\n      dockerfile: D0\n")], ["FROM node AS builder\nWORKDIR /app\nCOPY scripts/a.mjs ./\nFROM nginx\nCOPY scripts/d.json /usr/share/d.json\n"])) === 1]);
  checks.push(["M8 a bind mount WINS over an image file at the same path", n(ship([compose(svc("idp", ["./scripts/lib/other.mjs:/app/lib/h.mjs:ro"]) + "    build:\n      dockerfile: D0\n")], ["FROM node\nWORKDIR /app\nCOPY scripts/a.mjs ./\nCOPY scripts/lib/h.mjs ./lib/\n"])) === 1]);
  checks.push(["M8 a mounted DIRECTORY hides the image files under it", n(ship([compose("  idp:\n    build:\n      dockerfile: D0\n    volumes:\n      - ./scripts/other:/app/lib\n")], ["FROM node\nWORKDIR /app\nCOPY scripts/a.mjs ./\nCOPY scripts/lib/h.mjs ./lib/h.mjs\n"], treeOf({ "scripts/other/other.mjs": "export const o = 1;\n" }))) === 1]);
  checks.push(["L4 a `$` in a plain-quoted specifier is read (import \"./lib/$helper.mjs\")", n(ship([compose(svc("idp", ["./scripts/dollar.mjs:/app/dollar.mjs"]))], [], treeOf({ "scripts/dollar.mjs": 'import "./lib/$helper.mjs";\n' }))) === 1]);
  checks.push(["L4 a dynamic import with a non-literal argument is reported (not mangled into a path)", ship([compose(svc("idp", ["./scripts/dyn.mjs:/app/dyn.mjs"]))]).problems.every((x) => x.includes("non-literal")) && n(ship([compose(svc("idp", ["./scripts/dyn.mjs:/app/dyn.mjs"]))])) === 1]);
  checks.push(["L5 continuations, lowercase instructions and ADD each place the files (a model that reads nothing ships none)", ["FROM node\nWORKDIR /app\nCOPY scripts/a.mjs ./\nCOPY scripts/lib/h.mjs \\\n  /app/lib/h.mjs\n", "from node\nworkdir /app\ncopy scripts/a.mjs ./\ncopy scripts/lib/h.mjs ./lib/h.mjs\n", "FROM node\nWORKDIR /app\nADD scripts/a.mjs ./\nADD scripts/lib/h.mjs ./lib/h.mjs\n"].every((d) => ship([], [d]).shippedScripts === 2 && n(ship([], [d])) === 0)]);
  checks.push(["L5 compose build: shows the image files in the service (host identity by FULL path, not basename)", n(ship([compose("  idp:\n    build:\n      dockerfile: D0\n")], ["FROM node\nWORKDIR /app\nCOPY scripts/a.mjs ./\nCOPY scripts/other/h.mjs ./lib/h.mjs\n"], treeOf({ "scripts/other/h.mjs": "export const h = 3;\n" }))) === 1]);
  checks.push(["L5 an unreadable deploy file is a problem (loadDeploy)", loadDeploy(["c.yml"], () => { throw Object.assign(new Error("x"), { code: "EACCES" }); }).problems.length === 1 && loadDeploy(["c.yml"], () => "x").problems.length === 0]);
  checks.push(["L5 deploy discovery finds every spelling (compose.yaml, nested overrides, *.Dockerfile, Containerfile)", (() => {
    const c = classifyDeploy(["compose.yaml", "docker-compose.yaml", "deploy/docker-compose.override.yml", "docker/compose.dev.yml", "scripts/idp.Dockerfile", "Containerfile", "Dockerfile.api", "scripts/x.mjs"]);
    return c.compose.length === 4 && c.docker.length === 3;
  })()]);
  checks.push(["L5 COPY --from an external image is reported as not modelled", ship([], ["FROM node\nCOPY --from=nginx:latest /etc/x /x\n"]).dropped.some((x) => x.includes("not an earlier stage"))]);
  checks.push(["L7 a compose file with no services mapping, or scalar text, or NUL-free binary is a problem", ["version: \"3\"\n", "just text\n", "services: idp\n", "\u0001\u0002\u0003\u0004\u0005\u0006\u0007\u0008 services:\n"].every((t) => n(ship([t])) === 1) && n(ship([], ["FROM node\n\u0001\u0002\u0003\u0004\u0005\u0006\u0007\u0008\u0001\u0002\u0003\u0004\u0005\u0006\u0007\u0008\n"])) === 1]);
  const BUILDER = "FROM node AS Builder\nWORKDIR /app\nCOPY scripts/a.mjs ./\nCOPY scripts/lib/ ./lib/\nFROM node\n";
  checks.push(["L8 FROM node AS Builder / --from=builder match case-insensitively (no false positive, nothing dropped)", n(dock(BUILDER + "COPY --from=builder /app/a.mjs /srv/a.mjs\nCOPY --from=builder /app/lib/ /srv/lib/\n")) === 0 && !dock(BUILDER + "COPY --from=builder /app/a.mjs /srv/a.mjs\n").dropped.length && n(dock(BUILDER + "COPY --from=builder /app/a.mjs /srv/a.mjs\n")) === 1]);

  // dynamic literal import, comments, case, and the scan's own reporting
  checks.push(["a literal dynamic import(\"./lib/h.mjs\") in a shipped script is read", n(ship([compose(svc("idp", ["./scripts/dynlit.mjs:/app/dynlit.mjs"]))], [], treeOf({ "scripts/dynlit.mjs": 'const m = await import("./lib/h.mjs");\n' }))) === 1]);
  checks.push(["an import quoted in a comment or a string is not an import", n(ship([compose(svc("idp", ["./scripts/quoted.mjs:/app/quoted.mjs"]))], [], treeOf({ "scripts/quoted.mjs": '// import { h } from "./lib/nothere.mjs";\nconst s = "import x from \\"./lib/nothere2.mjs\\"";\n' }))) === 0]);
  checks.push(["paths are case-sensitive: only a lib/ mount exists, the import says ./Lib/", n(ship([compose(svc("idp", ["./scripts/cs.mjs:/app/cs.mjs", "./scripts/Lib/h.mjs:/app/lib/h.mjs"]))], [], treeOf({ "scripts/cs.mjs": 'import { h } from "./Lib/h.mjs";\n', "scripts/Lib/h.mjs": "export const h = 1;\n" }))) === 1]);
  checks.push(["paths are case-sensitive (a different file mounted at the folded path)", n(ship([compose(svc("idp", ["./scripts/cs.mjs:/app/cs.mjs", H]))], [], treeOf({ "scripts/cs.mjs": 'import { h } from "./Lib/h.mjs";\n' }))) === 1]);

  // THE SCAN, as the CLI reports it
  const okShip = { problems: [], composeFiles: 3, dockerFiles: 2, containers: 4, shippedScripts: 3, fixtureIdp: true, dropped: [] };
  const scanOf = (over = {}) => scan({ files: ["scripts/x.mjs"], readText: () => "export const x = 1;\n", ship: okShip, suffixDebt: new Map(), rawDebt: new Map(), ...over });
  checks.push(["SCAN: a clean tree reports no problem", scanOf().problems.length === 0]);
  checks.push(["SCAN: a shipped-import problem is REPORTED by the scan (not only by the self-test)", scanOf({ ship: { ...okShip, problems: ["c: boom"] } }).problems.includes("c: boom")]);
  checks.push(["SCAN: a shipped-import scan below ANY of its floors is a problem", ["shippedScripts", "containers", "composeFiles", "dockerFiles"].every((k) => scanOf({ ship: { ...okShip, [k]: 1 } }).problems.length === 1) && scanOf({ ship: { ...okShip, fixtureIdp: false } }).problems.length === 1]);
  checks.push(["SCAN: a \"not modelled\" drop is surfaced as a note, never swallowed", scanOf({ ship: { ...okShip, dropped: ["x: COPY $A ./"] } }).notes.some((x) => x.includes("not modelled"))]);
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
  checks.push(["L2 a $-leading alias name is followed ($entry)", raw("const $entry = process.argv[1];\nif ($entry === fileURLToPath(import.meta.url)) {}\n") === 1]);
  checks.push(["L2 a $-leading self-path alias is followed", raw("const $self = fileURLToPath(import.meta.url);\nif (resolve(process.argv[1]) === $self) {}\n") === 1]);
  checks.push(["L2 a self path wrapped in resolve() and bound to HERE is followed", raw("const HERE = resolve(fileURLToPath(import.meta.url));\nif (process.argv[1] === HERE) {}\n") === 1]);
  checks.push(["L2 url.fileURLToPath(...) and new URL(import.meta.url).pathname are self paths", raw("const here = url.fileURLToPath(import.meta.url);\nif (process.argv[1] === here) {}\n") === 1 && raw("const here = new URL(import.meta.url).pathname;\nif (process.argv[1] === here) {}\n") === 1]);
  checks.push(["L2 const [node, entry] = process.argv is an alias", raw("const [node, entry] = process.argv;\nif (entry === import.meta.filename) {}\n") === 1]);
  checks.push(["L2 basename(process.argv[1]) compared to a literal, and resolve(process.argv[1]).endsWith(..), are findings", raw('if (basename(process.argv[1]) === "tool.mjs") {}\n') === 1 && raw('if (resolve(process.argv[1]).endsWith("tool.mjs")) {}\n') === 1]);
  checks.push(["L3 a realpath call ELSEWHERE in the statement does not excuse a raw comparison", raw("if (really() && realize() && process.argv[1] === import.meta.url) run();\n") === 1 && raw("if (realLog() && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) run();\n") === 1 && raw("if (realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) run();\n") === 0]);
  // Known misses, pinned as misses so the header's claim is the measured one:
  for (const [label, text] of [
    ["let entry; entry = process.argv[1]", "let entry;\nentry = process.argv[1];\nif (entry === import.meta.filename) {}\n"],
    ["const args = process.argv; args[1]", "const args = process.argv;\nif (args[1] === import.meta.filename) {}\n"],
    ["const { argv: [, entry] } = process", "const { argv: [, entry] } = process;\nif (entry === import.meta.filename) {}\n"],
    ["import { argv } from \"node:process\"", 'import { argv } from "node:process";\nif (argv[1] === import.meta.filename) {}\n'],
  ]) checks.push([`L2 KNOWN MISS: ${label}`, raw(text) === 0]);
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
  const moved = idpCompose.replace(/^(.*is-main\.mjs.*)$/gm, "").concat("\n  other:\n    volumes:\n      - ./scripts/lib/is-main.mjs:/app/lib/is-main.mjs:ro\n");
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


const SI = "scripts/lib/shipped-imports.mjs";
const GATE = "scripts/check-entry-guards.mjs";
const HELPER = "scripts/lib/is-main.mjs";
/**
 * Mutation set for this gate: each entry is a one-spot edit that makes a real defect. `node scripts/check-entry-guards.mjs
 * --mutants` applies them one at a time to a CLEAN tree, runs the self-test, and reports which were killed (self-test
 * exits non-zero) and which SURVIVED or did not apply. The tally in the PR comes from this command, not from memory.
 */
export const MUTANTS = [
  ["unreadable shipped file is silent", SI, "problems.push(`${c.id}: ${host} is shipped to ${cpath} but unreadable (${err && err.code}) - its imports were NOT checked`);", "void err;"],
  ["dotdot segments ignored", SI, "const wantContainer = posix.normalize(posix.join(posix.dirname(cpath), spec));", 'const wantContainer = posix.join(posix.dirname(cpath), spec.replace(/\\.\\.\\//g, ""));'],
  ["paths case-folded", SI, "const got = byContainer.get(wantContainer);", "const got = [...byContainer].find(([k]) => k.toLowerCase() === wantContainer.toLowerCase())?.[1];"],
  ["literal dynamic import(..) not read", SI, 'take(/\\bimport\\s*\\(\\s*(["\'])((?:(?!\\1).)*)\\1\\s*[,)]/g, 2); // import("./y")', ""],
  ["non-literal dynamic import not reported", SI, "(?!`[^`$]*`\\s*[,)])/g)) unresolved.push(", "(?!`[^`$]*`\\s*[,)])/g)) void ("],
  ["scan drops the shipped-import problems", GATE, "for (const p of ship.problems) problems.push(p);", ""],
  ["COPY --from ignored", SI, "if (e.fromStage !== null) {", "if (false) {"],
  ["compose-file floor dropped", GATE, "ship.composeFiles < 3 ||", "false ||"],
  ["fixture-IdP floor dropped", GATE, " || ship.fixtureIdp !== true", ""],
  ["codeOnly dropped in importsOf", SI, "const code = codeOnly(text, true);", "const code = text;"],
  ["containers pooled", SI, "for (const p of c.pairs) byContainer.set", "for (const p of containers.flatMap((x) => x.pairs)) byContainer.set"],
  ["host-file identity check dropped", SI, "else if (got !== wantHost)", "else if (false)"],
  ["WORKDIR ignored", SI, 'cur.workdir = posix.normalize(rest.startsWith("/") ? rest : posix.join(cur.workdir, rest));', 'cur.workdir = "/app";'],
  ["overlay merge by service name dropped", SI, "const cur = services.get(svc) ?? { entries: [], builds: [], dropped: [] };", "const cur = { entries: [], builds: [], dropped: [] };"],
  ["compose long syntax ignored", SI, '(v.type === "bind" || v.type === undefined)', "false"],
  ["directory mounts not expanded", SI, "if (tree.isDir(e.host)) for (const f of tree.under(e.host)) mounts.push", "if (false) for (const f of tree.under(e.host)) mounts.push"],
  ["COPY --from relative source resolved from WORKDIR", SI, 'posix.join("/", s)', "posix.join(src.workdir, s)"],
  ["FROM <stage> does not inherit", SI, "if (stage.base) {", "if (false) {"],
  ["build Dockerfile only found under Dockerfile* names", SI, "if (tree.isFile(df)) {", "if (false) {"],
  ["unknown build target is silent", SI, "problems.push(`compose service ${svc}: build target", "void (`compose service ${svc}: build target"],
  ["YAML merge keys off", SI, "{ merge: true }", "{}"],
  ["existing-directory destination maps to the directory", SI, "|| knownDirs.has(absDest)", ""],
  ["other stages of a compose-built Dockerfile are not containers", SI, "if (other === stage || containers.some(", "if (true || other === stage || containers.some("],
  ["image files win over bind mounts", SI, "pairs: [...kept, ...mounts]", "pairs: [...mounts, ...kept]"],
  ["a mounted directory does not hide image files", SI, "!mountedDirs.some((d) => p.container === d || p.container.startsWith(`${d}/`))", "true"],
  ["a $ in a plain-quoted specifier is dropped", SI, 'take(/\\bfrom\\s*(["\'])((?:(?!\\1).)*)\\1/g, 2);', 'take(/\\bfrom\\s*(["\'])((?:(?!\\1)[^$].)*)\\1/g, 2);'],
  ["binary detection is NUL-only", SI, "|| (text.length > 0 && (text.match(/[\\x01-\\x08\\x0e-\\x1f]/g) ?? []).length / text.length > 0.02)", ""],
  ["compose without services is accepted", SI, 'if (!doc || typeof doc !== "object" || Array.isArray(doc) || !doc.services || typeof doc.services !== "object" || Array.isArray(doc.services)) {', 'if (!doc || typeof doc !== "object") {'],
  ["stage names are case-sensitive", SI, "name: f?.[2] ? f[2].toLowerCase() : null", "name: f?.[2] ?? null"],
  ["external --from is not reported", SI, "res.dropped.push(`COPY --from=${e.fromStage} (not an earlier stage of this Dockerfile)`);", ""],
  ["not-modelled notes swallowed", GATE, "for (const d of ship.dropped ?? []) notes.push(`not modelled: ${d}`);", ""],
  ["ADD ignored", SI, 'if (ins === "COPY" || ins === "ADD") {', 'if (ins === "COPY") {'],
  ["instructions case-sensitive", SI, "const ins = m[1].toUpperCase();", "const ins = m[1];"],
  ["backslash continuations not joined", SI, 'const joinContinuations = (text) => text.replace(/\\\\[ \\t]*\\r?\\n/g, " ");', "const joinContinuations = (text) => text;"],
  ["globs not expanded", SI, "if (/[*?]/.test(s)) {", "if (false) {"],
  ["Containerfile not discovered", GATE, "(?:dockerfile|containerfile)", "(?:dockerfile)"],
  [".yaml compose not discovered", GATE, "compose[^/]*)\\.ya?ml$/i;", "compose[^/]*)\\.yml$/i;"],
  ["unreadable deploy file is silent", GATE, "problems.push(`${name}: tracked deploy file unreadable (${err && err.code}) - NOT scanned`);", ""],
  ["swapped isMainModule arguments not flagged", GATE, "else if (/\\bisMainModule\\s*\\(\\s*import\\s*\\.\\s*meta\\s*\\.\\s*url/.test(raw))", "else if (false)"],
  ["argv aliases not followed", GATE, "const argvWord = wordOf([...names(ARGV_ALIAS), ...names(ARGV_DESTRUCTURE)]);", "const argvWord = null;"],
  ["realpath anywhere in the statement excuses the comparison", GATE, "const realBoth = op !== null && REAL_CALL.test(seg.slice(0, op.index)) && REAL_CALL.test(seg.slice(op.index + op[0].length));", "const realBoth = REAL_CALL.test(seg);"],
  ["$-leading alias names not bounded", GATE, "(?<![\\\\w$])(?:", "\\\\b(?:"],
  ["helper canary not run by the gate", GATE, "const canary = helperCanary(isMainModule);", "const canary = [];"],
  ["helper canary skips the symlink probe", GATE, "if (call(link) !== true) bad.push(", "if (false) bad.push("],
  ["helper: realpath removed", HELPER, "return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));", "return argv1 === fileURLToPath(moduleUrl);"],
  ["helper: realpath on one side only", HELPER, "return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));", "return realpathSync(argv1) === fileURLToPath(moduleUrl);"],
  ["helper: undefined argv1 is main", HELPER, "if (!argv1) return false;", "if (!argv1) return true;"],
  ["helper: a throw is main", HELPER, "} catch {\n    return false;", "} catch {\n    return true;"],
  ["helper: fileURLToPath import deleted", HELPER, 'import { fileURLToPath } from "node:url";\n', ""],
];

/** Apply each mutant to the working tree, run the self-test, restore. Needs a CLEAN tree (it restores by rewriting the original text). */
function runMutants() {
  const results = [];
  for (const [name, file, from, to] of MUTANTS) {
    const path = join(repoRoot, file);
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
      writeFileSync(path, original.slice(0, hits[0]) + to + original.slice(hits[0] + from.length));
      const r = spawnSync(process.execPath, [join(repoRoot, GATE), "--self-test"], { encoding: "utf8", timeout: 300000, cwd: repoRoot });
      results.push([name, r.status !== 0 ? "killed" : "SURVIVED"]);
    } finally {
      writeFileSync(path, original);
    }
  }
  for (const [name, verdict] of results) console.log(`  ${verdict === "killed" ? "ok" : "!!"} ${verdict.padEnd(11)} ${name}`);
  const killed = results.filter(([, v]) => v === "killed").length;
  console.log(`\nmutants: ${killed} of ${results.length} killed`);
  return killed === results.length ? 0 : 1;
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
  const dir = mkdtempSync(join(tmpdir(), "entry-guard-link-"));
  try {
    const link = join(dir, "self.mjs");
    symlinkSync(self, link);
    if (call(link) !== true) bad.push(`isMainModule(a symlink to this file, url) is ${String(call(link))}, not true - a symlinked start would skip its body`);
  } catch (err) {
    bad.push(`could not build the symlink probe (${err && err.code})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
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
  if (ship.composeFiles < 3 || ship.dockerFiles < 2 || ship.containers < 4 || ship.shippedScripts < 3 || ship.fixtureIdp !== true) {
    problems.push(
      `shipped-import scan found only ${ship.composeFiles} compose file(s), ${ship.dockerFiles} Dockerfile(s), ${ship.containers} container(s), ` +
        `${ship.shippedScripts} shipped script(s), fixture IdP container ${ship.fixtureIdp === true ? "present" : "ABSENT"} - the derivation has drifted`,
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

if (IS_ENTRY) {
  const canary = helperCanary(isMainModule);
  if (canary.length > 0) {
    console.error("✗ scripts/lib/is-main.mjs is broken - every gate that adopts it would exit 0 having checked nothing:");
    for (const c of canary) console.error(`  ✗ ${c}`);
    process.exit(1);
  }
  if (process.argv.includes("--self-test")) process.exit(selfTest());
  if (process.argv.includes("--mutants")) process.exit(runMutants());

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
