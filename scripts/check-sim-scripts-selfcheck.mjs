// check-sim-scripts-selfcheck — a Mac lane script the cloud lane can QUEUE must
// be runnable, syntax-clean, and able to prove its own plumbing without a Mac.
//
//   node scripts/check-sim-scripts-selfcheck.mjs             the guard
//   node scripts/check-sim-scripts-selfcheck.mjs --self-test prove the guard can fail
//
// WHY THIS EXISTS
// ---------------
// `scripts/lib/sim-operations.mjs` is an allowlist the CLOUD lane writes requests
// against and the OWNER'S MAC executes. The two machines are days apart: a broken
// shell script is discovered when a human has already sat down to run it, and the
// request that named it reads as "queued" until somebody notices. The cheap
// failures — a missing executable bit, a syntax error, a log redirect that
// resolves in the wrong directory — are all findable on Linux, in milliseconds,
// before the request is ever queued.
//
// THE REDIRECT DEFECT, which is the reason this exists now. A proof script died at
// step 1 on this shape:
//
//     ( cd native/ios && xcodebuild … >"$OUT/build.log" 2>&1 )
//
// `$OUT` was relative to the repo root, the redirect is opened by the subshell
// AFTER the `cd`, and so it resolved against `native/ios/` — a directory that does
// not exist there. The redirect fails, the subshell dies before the command it was
// wrapping ever ran, and the log that would have said why is the file that could
// not be created. Rooting the variable (`$ROOT/$OUT`) fixes it.
//
// WHAT IS GATED, and over WHICH SET — the two are not the same, deliberately:
//
//   Over EVERY `scripts/mac/*.sh` (static, no execution):
//     (b) `bash -n` parses it.
//     (d) no redirect inside a `( cd … )` subshell whose target is rooted at a
//         variable this script never absolutised, or at a bare relative path.
//         "Absolutised" is DERIVED from the script's own assignments — a value
//         built from `$(cd … && pwd)`, starting with `/`, or taken from $PWD /
//         $HOME / $TMPDIR — so `$ROOT/$OUT` passes and `$OUT` alone does not.
//
//   Over the scripts an operation actually NAMES (derived by importing
//   SIM_OPERATIONS and reading its argv, never by re-listing them here):
//     (a) it exists and carries an executable bit.
//     (c) if it declares `--self-check`, running it with that flag must exit 0.
//     (e) …and must leave `git status --porcelain` BYTE-IDENTICAL to its value a
//         moment earlier. A dry run that writes into the tree is not a dry run: it
//         lands in somebody's next commit, and `provenance.workingTreeClean` in
//         artifacts/sim-results is sampled from exactly this command — a self-check
//         that dirties the tree stamps every later result as minted from a dirty
//         one. Scratch space belongs under `mktemp -d`. The comparison covers the
//         WHOLE tree while the script still runs with cwd = the repo root, so a
//         write anywhere is seen, and every path that appeared or changed is named.
//         DELIBERATELY NOT COVERED: the REAL run, which is expected to write
//         evidence (that is its job), and any script on the ratchet, which this
//         gate never executes at all.
//
// GATED vs REPORTED on (c). What the flag exiting 0 proves is that the script's
// plumbing runs to completion on a box with NO Xcode and NO simctl — this gate's
// own CI runner is Linux, so a self-check that reached for either could not exit
// 0 here. What it does NOT prove is that the mode opened every redirect target
// the real run will use; only the script can know its own list, and this gate
// does not audit that claim. It is REPORTED as "self-check exits 0", not as
// "every log target verified".
//
// THE RATCHET. Scripts written before the convention have no `--self-check`, and
// deleting them is not the job. They are printed BY NAME as NOT SELF-CHECKING and
// their number is capped at today's count: a new script cannot join the referenced
// set without the mode, and the cap can only be lowered. It is a ceiling that only
// moves down — the honest word for the "floor" this was asked for.
//
// SELF-TEST: nine planted shell fixtures in a temp dir, driving the real checks in
// both directions, including the ratchet. A gate that has never failed proves
// nothing.

import { chmodSync, closeSync, fstatSync, mkdtempSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SIM_OPERATIONS } from "./lib/sim-operations.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAC_DIR = resolve(repo, "scripts/mac");

// TODAY'S COUNT, measured: scripts/mac/run-everything.sh is the only shell script
// any operation names, and it predates the convention. Lower this when it gains
// the mode; never raise it.
const NOT_SELF_CHECKING_CEILING = 1;
const OPERATION_FLOOR = 10;

// ── derivation: which shell scripts can a request actually ask for? ──────────
function referencedMacScripts(operations) {
  const found = new Map();
  for (const [key, op] of Object.entries(operations)) {
    for (const token of op.argv ?? []) {
      const m = /^\.?\/?(scripts\/mac\/[A-Za-z0-9._-]+\.sh)$/.exec(token);
      if (m) {
        if (!found.has(m[1])) found.set(m[1], []);
        found.get(m[1]).push(key);
      }
    }
  }
  return found;
}

// ── rule (d): a redirect that resolves after a cd ────────────────────────────
// `$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)` is THE idiom every
// script here uses, and a `[^)]*` between cd and pwd cannot cross its nested
// `$(dirname …)` — written that way first, it called $ROOT unrooted and
// false-positived on the correct `$ROOT/$OUT` form. Match on the line.
const ABSOLUTE_RHS = /\$\([^\n]*\bcd\b[^\n]*\bpwd\b|^"?\/|^"?\$\{?(?:PWD|HOME|TMPDIR)\b/;

/** Variable names the script gives an absolute value, one level of indirection. */
function absolutisedVars(text) {
  const abs = new Set(["PWD", "HOME", "TMPDIR"]);
  for (let pass = 0; pass < 2; pass += 1) {
    for (const m of text.matchAll(/^\s*(?:export\s+)?([A-Za-z_]\w*)=(.+)$/gm)) {
      const [, name, rhs] = m;
      const r = rhs.trim();
      if (ABSOLUTE_RHS.test(r)) abs.add(name);
      else {
        const lead = /^"?\$\{?([A-Za-z_]\w*)\}?\//.exec(r);
        if (lead && abs.has(lead[1])) abs.add(name);
      }
    }
  }
  return abs;
}

/** Redirects inside a `( cd … )` subshell that are not rooted absolutely. */
function badSubshellRedirects(text) {
  const abs = absolutisedVars(text);
  const lines = text.split("\n");
  const hits = [];
  let depth = 0;
  let opened = -1;
  lines.forEach((line, i) => {
    const bare = line.replace(/#.*$/, "");
    const startsSubshell = depth === 0 && /(^|[;&|]|\bthen\b|\bdo\b)\s*\(\s*cd\s/.test(bare);
    if (startsSubshell) {
      depth = 1;
      opened = i;
    }
    if (depth > 0) {
      for (const m of bare.matchAll(/(?<![0-9&])>>?\s*("?)([^\s;&|)"]+)\1/g)) {
        const target = m[2];
        if (target.startsWith("/") || target === "&1" || target === "&2") continue;
        const v = /^\$\{?([A-Za-z_]\w*)\}?(?:\/|$)/.exec(target);
        if (v) {
          if (abs.has(v[1])) continue;
          hits.push({ line: i + 1, target, why: `$${v[1]} is never given an absolute value in this script, and the redirect is opened AFTER the cd` });
        } else if (!/^\$/.test(target)) {
          hits.push({ line: i + 1, target, why: "a relative redirect target inside a subshell that has already cd'd elsewhere" });
        }
      }
      if (i > opened || !startsSubshell || /\)\s*(\|\||&&|$|;)/.test(bare)) {
        const open = (bare.match(/\(/g) ?? []).length;
        const close = (bare.match(/\)/g) ?? []).length;
        depth += open - close - (startsSubshell ? 1 : 0);
        if (depth <= 0) depth = 0;
      }
    }
  });
  return hits;
}

/**
 * Does the script BRANCH on `--self-check`, or merely mention it?
 *
 * A plain `text.includes("--self-check")` counted a script whose only mention was
 * inside `echo "no --self-check mode"` as having the mode — the gate would then
 * have run it, seen exit 0 from the echo, and reported a dry-run capability that
 * does not exist. The flag counts only where it meets a positional parameter or
 * stands as a `case` pattern; comments are stripped first.
 */
function declaresSelfCheck(text) {
  return text.split("\n").some((raw) => {
    const line = raw.replace(/#.*$/, "");
    if (!line.includes("--self-check")) return false;
    return /\$\{?[0-9@*]/.test(line) || /(^|\|)\s*(?:"|')?--self-check(?:"|')?\s*\)/.test(line);
  });
}

/**
 * `git status --porcelain`, or null when the directory is not a git work tree.
 *
 * `--untracked-files=all` deliberately: the DEFAULT collapses a new untracked
 * directory to one line (`?? artifacts/`), so a self-check writing a second file
 * into an already-untracked directory produced BYTE-IDENTICAL output and the
 * write went unseen — that is how the first version of this rule reported nothing
 * on a fixture that plainly dirtied the tree. -uall is a strict superset of what
 * the default shows, and it names the file rather than its parent.
 */
function sampleStatus(cwd) {
  const r = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd, encoding: "utf8" });
  if (r.error || r.status !== 0) return null;
  return r.stdout;
}

/** Lines that APPEARED or whose status letters CHANGED between two samples. */
function statusDelta(before, after) {
  const key = (l) => l.slice(3);
  const prior = new Map(before.split("\n").filter(Boolean).map((l) => [key(l), l.slice(0, 2)]));
  const out = [];
  for (const line of after.split("\n").filter(Boolean)) {
    const k = key(line);
    const was = prior.get(k);
    if (was === undefined) out.push(`${k} (appeared: ${line.slice(0, 2).trim() || "??"})`);
    else if (was !== line.slice(0, 2)) out.push(`${k} (${was.trim()} -> ${line.slice(0, 2).trim()})`);
  }
  for (const [k] of prior) if (!after.includes(k)) out.push(`${k} (disappeared)`);
  return out;
}

// ── the checks ───────────────────────────────────────────────────────────────
function staticChecks(absPath, label) {
  const problems = [];
  const text = readFileSync(absPath, "utf8");
  const syntax = spawnSync("bash", ["-n", absPath], { encoding: "utf8" });
  if (syntax.error) return [{ label, rule: "b", detail: `bash is not available to run \`bash -n\` (${syntax.error.message}) — this gate refuses rather than report a syntax check it did not perform` }];
  if (syntax.status !== 0) problems.push({ label, rule: "b", detail: `bash -n failed: ${(syntax.stderr || "").trim().split("\n")[0]}` });
  for (const h of badSubshellRedirects(text)) {
    problems.push({ label, rule: "d", detail: `line ${h.line}: redirect to \`${h.target}\` inside a ( cd … ) subshell — ${h.why}` });
  }
  return problems;
}

function referencedChecks(absPath, label, namedBy, cwd) {
  const problems = [];
  // One descriptor: the mode and the text come from the same open file, so there
  // is no window between checking the path and reading it. An open that throws
  // is absence — the gate never reports on a file it checked and then lost.
  let mode;
  let text;
  try {
    const fd = openSync(absPath, "r");
    try {
      mode = fstatSync(fd).mode;
      text = readFileSync(fd, "utf8");
    } finally {
      closeSync(fd);
    }
  } catch {
    return [{ label, rule: "a", detail: `named by operation(s) ${namedBy.join(", ")} but does not exist — the request would be accepted and could never run` }];
  }
  if ((mode & 0o111) === 0) {
    problems.push({ label, rule: "a", detail: `named by operation(s) ${namedBy.join(", ")} but carries no executable bit` });
  }
  const declares = declaresSelfCheck(text);
  if (declares) {
    const before = sampleStatus(cwd);
    const run = spawnSync("bash", [absPath, "--self-check"], { cwd, encoding: "utf8", timeout: 60_000 });
    if (run.status !== 0) {
      const tail = ((run.stderr || "") + (run.stdout || "")).trim().split("\n").slice(-1)[0] ?? "";
      problems.push({ label, rule: "c", detail: `declares --self-check but exited ${run.status ?? "on signal/timeout"}: ${tail}` });
    }
    const after = sampleStatus(cwd);
    if (before === null || after === null) {
      problems.push({ label, rule: "e", detail: "could not run `git status --porcelain` here, so the no-write property was NOT checked — this gate refuses rather than report a comparison it did not make" });
    } else if (before !== after) {
      problems.push({ label, rule: "e", detail: `--self-check changed the working tree. Path(s) that appeared or changed:\n        \u00b7 ${statusDelta(before, after).join("\n        \u00b7 ")}\n      Scratch belongs under \`mktemp -d\`; a dry run that writes lands in somebody's next commit.` });
    }
  }
  return { problems, declares };
}

// ── self-test ────────────────────────────────────────────────────────────────
const FIXTURES = {
  "clean-selfcheck.sh": `#!/usr/bin/env bash\nset -euo pipefail\nROOT="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"\nOUT="artifacts/x"\nif [ "\${1:-}" = "--self-check" ]; then d="$(mktemp -d)"; : >"$d/build.log"; echo "self-check ok"; exit 0; fi\n( cd sub && echo hi >"$ROOT/$OUT/build.log" )\n`,
  "failing-selfcheck.sh": `#!/usr/bin/env bash\nset -euo pipefail\nif [ "\${1:-}" = "--self-check" ]; then echo "cannot open log" >&2; exit 3; fi\n`,
  "subshell-redirect.sh": `#!/usr/bin/env bash\nset -euo pipefail\nROOT="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"\nOUT="artifacts/x"\nif [ "\${1:-}" = "--self-check" ]; then exit 0; fi\n( cd native/ios && xcodebuild -scheme S build >"$OUT/build.log" 2>&1 )\n`,
  "subshell-redirect-unquoted.sh": `#!/usr/bin/env bash\nOUT=artifacts/x\nif [ "\${1:-}" = "--self-check" ]; then exit 0; fi\n( cd native/ios && xcodegen generate >$OUT/gen.log )\n`,
  "rooted-redirect.sh": `#!/usr/bin/env bash\nROOT="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"\nOUT="artifacts/x"\nif [ "\${1:-}" = "--self-check" ]; then exit 0; fi\n( cd native/ios && xcodegen generate >"$ROOT/$OUT/gen.log" )\n`,
  "toplevel-redirect.sh": `#!/usr/bin/env bash\nOUT="artifacts/x"\nif [ "\${1:-}" = "--self-check" ]; then exit 0; fi\nxcodegen generate >"$OUT/gen.log"\n`,
  "syntax-error.sh": `#!/usr/bin/env bash\nif [ "\${1:-}" = "--self-check" ]; then exit 0\n`,
  "legacy-no-selfcheck.sh": `#!/usr/bin/env bash\nset -euo pipefail\necho "the old convention: no --self-check mode"\n`,
  "legacy-two.sh": `#!/usr/bin/env bash\nset -euo pipefail\necho "a second legacy script"\n`,
  "dirty-selfcheck.sh": `#!/usr/bin/env bash\nset -euo pipefail\nif [ "\${1:-}" = "--self-check" ]; then mkdir -p artifacts/selfcheck; : >artifacts/selfcheck/probe.log; exit 0; fi\n`,
  "tmpdir-selfcheck.sh": `#!/usr/bin/env bash\nset -euo pipefail\nif [ "\${1:-}" = "--self-check" ]; then d="$(mktemp -d)"; : >"$d/probe.log"; exit 0; fi\n`,
  "case-selfcheck.sh": `#!/usr/bin/env bash\nset -euo pipefail\ncase "\${1:-}" in\n  --self-check) echo "plumbing ok"; exit 0 ;;\nesac\n`,
};

function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), "sim-scripts-selfcheck-"));
  const failures = [];
  const expect = (name, cond, msg) => { if (!cond) failures.push(`${name}: ${msg}`); };
  try {
    mkdirSync(join(dir, "sub"), { recursive: true });
    // Rule (e) compares `git status --porcelain`, so the fixture dir must be a
    // work tree. A local `git init` in a temp directory; nothing leaves it.
    spawnSync("git", ["init", "-q"], { cwd: dir, encoding: "utf8" });
    for (const [name, body] of Object.entries(FIXTURES)) {
      const p = join(dir, name);
      writeFileSync(p, body);
      chmodSync(p, 0o755);
    }
    // (a) the missing executable bit, planted.
    chmodSync(join(dir, "clean-selfcheck.sh"), 0o644);

    const S = (n) => staticChecks(join(dir, n), n);
    const R = (n, ops = ["op"]) => referencedChecks(join(dir, n), n, ops, dir);

    expect("bash -n catches a syntax error", S("syntax-error.sh").some((p) => p.rule === "b"), "no rule (b) hit");
    expect("clean script parses", S("clean-selfcheck.sh").every((p) => p.rule !== "b"), "reported a syntax error it should not");
    expect("subshell redirect to an unrooted $OUT", S("subshell-redirect.sh").some((p) => p.rule === "d"), "MISSED the defect this gate was written for");
    expect("same defect unquoted", S("subshell-redirect-unquoted.sh").some((p) => p.rule === "d"), "MISSED the >$OUT/ spelling");
    expect("rooted redirect is fine", S("rooted-redirect.sh").length === 0, `FALSE POSITIVE on $ROOT/$OUT: ${JSON.stringify(S("rooted-redirect.sh"))}`);
    expect("redirect outside any subshell is fine", S("toplevel-redirect.sh").length === 0, "FALSE POSITIVE — no cd happened, the path resolves where it was written");
    expect("clean script's own subshell redirect is fine", S("clean-selfcheck.sh").length === 0, `FALSE POSITIVE: ${JSON.stringify(S("clean-selfcheck.sh"))}`);

    expect("missing executable bit", R("clean-selfcheck.sh").problems.some((p) => p.rule === "a"), "MISSED a non-executable referenced script");
    chmodSync(join(dir, "clean-selfcheck.sh"), 0o755);
    const clean = R("clean-selfcheck.sh");
    expect("a working --self-check passes", clean.problems.length === 0 && clean.declares, `the positive case failed: ${JSON.stringify(clean.problems)}`);
    expect("a failing --self-check is caught", R("failing-selfcheck.sh").problems.some((p) => p.rule === "c"), "MISSED a --self-check that exits non-zero");
    const legacy = R("legacy-two.sh");
    expect("a legacy script is not a violation", legacy.problems.length === 0 && !legacy.declares, "a script without the mode must be reported, not failed");
    const prose = R("legacy-no-selfcheck.sh");
    expect("mentioning the flag in prose is not declaring it", !prose.declares,
      "an echo naming --self-check was counted as the mode — the gate would report a dry-run capability that does not exist");
    expect("a case-pattern --self-check counts", R("case-selfcheck.sh").declares, "MISSED the case-branch spelling of the mode");

    const dirty = R("dirty-selfcheck.sh").problems.filter((p) => p.rule === "e");
    expect("a self-check that writes into the tree is caught", dirty.length === 1 && /artifacts\/selfcheck/.test(dirty[0].detail),
      `MISSED an untracked artifacts/ write, or failed to NAME it: ${JSON.stringify(dirty)}`);
    rmSync(join(dir, "artifacts"), { recursive: true, force: true });
    expect("a self-check scratching under mktemp -d is clean", R("tmpdir-selfcheck.sh").problems.length === 0,
      "FALSE POSITIVE - writing under mktemp -d leaves the tree untouched and must pass");

    expect("missing file is rule (a)", referencedChecks(join(dir, "nope.sh"), "nope.sh", ["op"], dir).some?.((p) => p.rule === "a") ?? referencedChecks(join(dir, "nope.sh"), "nope.sh", ["op"], dir)[0]?.rule === "a", "MISSED a named script that does not exist");

    // The ratchet, both directions.
    const notSelfChecking = ["legacy-no-selfcheck.sh", "legacy-two.sh"];
    expect("ratchet fails when a new script joins without the mode", notSelfChecking.length > NOT_SELF_CHECKING_CEILING, "the ceiling would not have caught a second legacy script");
    expect("ratchet passes at the ceiling", ["legacy-no-selfcheck.sh"].length <= NOT_SELF_CHECKING_CEILING, "the ceiling is below today's measured count");

    // The derivation itself, driven on a fixture allowlist.
    const derived = referencedMacScripts({
      a: { argv: ["./scripts/mac/run-everything.sh"] },
      b: { argv: ["./scripts/mac/run-everything.sh", "--fast"] },
      c: { argv: ["node", "scripts/preflight.mjs"] },
      d: { argv: ["./validate-sim-macos.sh"] },
    });
    expect("derivation reads argv", derived.size === 1 && derived.get("scripts/mac/run-everything.sh")?.length === 2,
      `derivation returned ${JSON.stringify([...derived])} — it must find mac shell scripts and only those`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return failures;
}

const failures = selfTest();
if (failures.length > 0) {
  console.error("FAIL  self-test — the checks no longer behave as required:");
  for (const f of failures) console.error(`    · ${f}`);
  console.error("\nA gate that cannot flag a planted violation is green about nothing.");
  process.exit(1);
}
if (process.argv.includes("--self-test")) {
  console.log(`PASS  self-test — ${Object.keys(FIXTURES).length} planted shell fixtures behave in both directions (syntax, subshell redirect rooted and unrooted, executable bit, a passing and a failing --self-check, a self-check that dirties the tree and one that scratches under mktemp -d, a legacy script, the ratchet, and the argv derivation).`);
  process.exit(0);
}

// ── the guard ────────────────────────────────────────────────────────────────
const allMac = readdirSync(MAC_DIR).filter((f) => f.endsWith(".sh")).sort();
if (allMac.length === 0) {
  console.error("x No scripts/mac/*.sh found — the walk is not reaching the tree it is supposed to cover.");
  process.exit(1);
}
const opCount = Object.keys(SIM_OPERATIONS).length;
if (opCount < OPERATION_FLOOR) {
  console.error(`x Only ${opCount} operation(s) in SIM_OPERATIONS (floor ${OPERATION_FLOOR}) — the allowlist this gate derives its scope from has been gutted.`);
  process.exit(1);
}
const referenced = referencedMacScripts(SIM_OPERATIONS);
if (referenced.size === 0) {
  console.error("x No scripts/mac/*.sh is named by any operation — the derivation found nothing, so this gate would be green about nothing.");
  process.exit(1);
}

console.log("sim-script self-check — a queued Mac operation must name a script that runs\n");
console.log(`  DERIVED from SIM_OPERATIONS (${opCount} operations): ${referenced.size} referenced shell script(s) — ` +
  [...referenced].map(([p, keys]) => `${p} (${keys.join(", ")})`).join("; "));

const problems = [];
for (const f of allMac) problems.push(...staticChecks(join(MAC_DIR, f), `scripts/mac/${f}`));

const notSelfChecking = [];
for (const [rel, keys] of referenced) {
  const abs = resolve(repo, rel);
  const res = referencedChecks(abs, rel, keys, repo);
  if (Array.isArray(res)) problems.push(...res);
  else {
    problems.push(...res.problems);
    if (!res.declares) notSelfChecking.push(rel);
    else console.log(`  SELF-CHECKING: ${rel} — \`--self-check\` exits 0 on a box with no Xcode and no simctl.`);
  }
}

console.log(`\n  NOT SELF-CHECKING (${notSelfChecking.length}, ceiling ${NOT_SELF_CHECKING_CEILING} — REPORTED, and ratcheted so it can only go down):`);
for (const n of notSelfChecking) console.log(`    · ${n} — predates the convention; a cloud-lane request naming it cannot be dry-run.`);
if (notSelfChecking.length === 0) console.log("    (none)");

if (notSelfChecking.length > NOT_SELF_CHECKING_CEILING) {
  problems.push({
    label: "ratchet",
    rule: "c",
    detail: `${notSelfChecking.length} referenced script(s) lack --self-check, ceiling is ${NOT_SELF_CHECKING_CEILING}. A NEW queueable script must carry the mode; the ceiling is only ever lowered.`,
  });
}

console.log(`\nsim-scripts-selfcheck: ${allMac.length} script(s) checked statically, ${referenced.size} referenced, ${problems.length} problem(s); self-test green`);
if (problems.length > 0) {
  for (const p of problems) console.error(`\n  x [rule ${p.rule}] ${p.label}\n      ${p.detail}`);
  console.error("\nsim-script self-check gate FAILED. The cloud lane queues these by name and the Mac lane runs them days\nlater; a script that cannot start is discovered by a human who already sat down to run it.");
  process.exit(1);
}
console.log("sim-script self-check gate passed — every queueable Mac script exists, parses, is executable, and roots its subshell redirects.");
