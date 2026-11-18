// check-local-build-regressions.mjs — ONE reviewed, shared regression runner for build candidates.
//
//   node scripts/check-local-build-regressions.mjs --target <path> --sha256 <64hex> --cases <N>
//   node scripts/check-local-build-regressions.mjs --changed [--base <rev>] [--head <rev>] [--base-optional]
//   node scripts/check-local-build-regressions.mjs --self-test
//
// WHY: a publication candidate used to carry its own newly generated runner, CI rows and journal
// entries. This file is the runner, reviewed once; a candidate now carries only its source and test.
//
// WHAT IT MEASURES (GATED):
//   * FROZEN mode: the named test file is regular, inside the allowlist, free of symlinks on every
//     path component, byte-identical (SHA-256) before and after the run, exits 0 under plain
//     `node --test --test-reporter=tap`, and its TAP summary says tests === pass === N, with
//     fail/cancelled/skipped/todo all 0, every counter present exactly once, no `not ok` line.
//   * CHANGED mode: every ADDED/MODIFIED/RENAMED-to/TYPE-CHANGED allowlisted test file between base
//     and head passes the same way with no expected count (tests > 0 instead). Deleted files are
//     reported, never executed.
// WHAT IT DOES NOT MEASURE (said plainly, per DR-015):
//   * An empty diff is NOT proof that any specific build's regression ran: it only says no
//     allowlisted test file changed in that range. Frozen mode is the only proof for one build.
//   * Discovery records carry the ACTUAL path, hash and count found now. They are not an attestation
//     of any original build, and none is fabricated.
//   * Test quality is not judged; a test that asserts nothing but passes, passes.
//
// ALLOWLIST (explicit, derived from where Node tests live in this repo; .ts is excluded because
// plain `node --test` cannot run it, and artifacts/** tests are excluded because they need a built
// server or a fixture runner of their own):
//   scripts/**/<name>.test.{mjs,cjs,js}      lib/**/<name>.test.{mjs,cjs,js}
// Every path segment must match [A-Za-z0-9_][A-Za-z0-9._-]* (no dot-leading segment, so no `..`, no
// glob metacharacter, no leading `-`), the path is relative, and no `node_modules` segment is allowed.
//
// EXIT: 0 pass; 1 a regression/contract failure (one-line reason on stderr); 2 usage/refusal.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync, constants as fsConstants, existsSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync,
  readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "./lib/is-main.mjs";
import { SCRATCH_GIT_SCRUB, scratchGit } from "./lib/scratch-git.mjs";

export const DEFAULT_TIMEOUT_MS = 120_000;
export const MAX_TIMEOUT_MS = 600_000;
export const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
export const MAX_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
export const DEFAULT_MIN_ALLOWLISTED = 5;
const SELF_TEST_MIN_CASES = 40;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SEG = "[A-Za-z0-9_][A-Za-z0-9._-]*";
const ALLOW_RE = new RegExp(`^(?:scripts|lib)/(?:${SEG}/)*${SEG}\\.test\\.(?:mjs|cjs|js)$`);

/** @returns {string|null} null when allowed, else the reason it is not. */
export function allowlistRefusal(rel) {
  if (typeof rel !== "string" || rel.length === 0) return "path is empty or not a string";
  if (rel.includes("\0")) return "path contains a NUL byte";
  if (rel.startsWith("/") || /^[A-Za-z]:/.test(rel) || rel.includes("\\")) return "path must be relative with forward slashes";
  if (rel.split("/").some((s) => s === ".." || s === "." || s === "")) return "path contains an empty, '.' or '..' segment";
  if (rel.split("/").includes("node_modules")) return "path passes through node_modules";
  if (!ALLOW_RE.test(rel)) return "path is outside the allowlist (scripts/** or lib/** files named *.test.mjs|cjs|js)";
  return null;
}

const sha256Hex = (buf) => createHash("sha256").update(buf).digest("hex");

/** Refuse a symlink at ANY component, and require a regular file at the end. */
function componentRefusal(root, rel) {
  let cur = root;
  const parts = rel.split("/");
  for (let i = 0; i < parts.length; i++) {
    cur = join(cur, parts[i]);
    let st;
    try { st = lstatSync(cur); } catch (e) { return `cannot stat ${parts.slice(0, i + 1).join("/")}: ${e.code ?? e.message}`; }
    if (st.isSymbolicLink()) return `symlink at path component ${parts.slice(0, i + 1).join("/")}`;
    if (i < parts.length - 1 && !st.isDirectory()) return `path component ${parts.slice(0, i + 1).join("/")} is not a directory`;
    if (i === parts.length - 1 && !st.isFile()) return "target is not a regular file";
  }
  return null;
}

/** Read the file without following a final symlink; returns {sha} or {refusal}. */
function hashTarget(root, rel) {
  const abs = join(root, rel);
  let fd;
  try {
    fd = openSync(abs, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    if (!fstatSync(fd).isFile()) return { refusal: "target is not a regular file" };
    return { sha: sha256Hex(readFileSync(fd)) };
  } catch (e) {
    return { refusal: `cannot read target: ${e.code ?? e.message}` };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

const COUNTERS = ["tests", "suites", "pass", "fail", "cancelled", "skipped", "todo"];
const REQUIRED = ["tests", "pass", "fail", "cancelled", "skipped", "todo"];

/** Parse TAP text. Every required counter must appear exactly once; fail-closed on anything odd. */
export function parseTap(text) {
  const seen = Object.fromEntries(COUNTERS.map((c) => [c, []]));
  let okLines = 0;
  let allOk = 0;
  let notOk = 0;
  const okNames = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^# (tests|suites|pass|fail|cancelled|skipped|todo) (\d+)$/.exec(line);
    if (m) seen[m[1]].push(Number(m[2]));
    const ok = /^ok \d+(?: - (.*))?$/.exec(line);
    if (ok) { okLines++; okNames.push(ok[1] ?? ""); }
    // Nested subtests and suite members are indented; Node counts them in # tests / # suites.
    if (/^\s*ok \d+\b/.test(line)) allOk++;
    if (/^\s*not ok\b/.test(line)) notOk++;
  }
  const counters = {};
  for (const c of COUNTERS) {
    if (seen[c].length > 1) return { reason: `duplicate '# ${c}' counter (${seen[c].length} lines)` };
    if (seen[c].length === 1) counters[c] = seen[c][0];
    else if (REQUIRED.includes(c)) return { reason: `missing '# ${c}' counter` };
  }
  for (const c of Object.keys(counters)) {
    if (!Number.isSafeInteger(counters[c])) return { reason: `counter '${c}' is not a safe integer` };
  }
  return { counters, okLines, allOk, notOk, okNames };
}

/** Validate parsed TAP. expectedCases === undefined means discovery mode (tests > 0). */
function judge(parsed, expectedCases, rel) {
  if (parsed.reason) return parsed.reason;
  const { counters: c, okLines, allOk, notOk } = parsed;
  if (notOk > 0) return `${notOk} 'not ok' line(s) in TAP output`;
  if (c.tests < 1) return "empty run: 0 tests executed";
  // Node reports a file that registers no test() as ONE passing test named after the file itself.
  if (rel !== undefined && parsed.okNames.some((n) => n === rel || n.endsWith(`/${rel}`))) return "file registered no test cases (node reports the file itself as the single 'test')";
  if (c.tests !== c.pass) return `tests (${c.tests}) !== pass (${c.pass})`;
  for (const k of ["fail", "cancelled", "skipped", "todo"]) if (c[k] !== 0) return `${k} counter is ${c[k]}, must be 0`;
  if (expectedCases !== undefined && c.tests !== expectedCases) return `case count ${c.tests} !== expected ${expectedCases}`;
  if (okLines < 1) return "no top-level 'ok' line in TAP output";
  // Every passing test and every passing suite prints one ok line at its own depth.
  const expectedOk = c.tests + (c.suites ?? 0);
  if (allOk !== expectedOk) return `ok lines at all depths (${allOk}) !== tests + suites (${expectedOk})`;
  return null;
}

const SUPERVISOR_GRACE_MS = 10_000;
const SUP_EXIT = { timeout: 124, overflow: 125, signal: 126, spawn: 127 };
// Runs as `node -e`: argv = [timeoutMs, maxBytes, rel]. Stdout is forwarded byte for byte (it is the TAP).
const SUPERVISOR_SRC = `
"use strict";
const { spawn } = require("node:child_process");
const [t, m, rel] = process.argv.slice(1);
const timeoutMs = Number(t), maxBytes = Number(m);
let bytes = 0, verdict = null;
const child = spawn(process.execPath, ["--test", "--test-reporter=tap", rel], {
  detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"], env: process.env,
});
const killGroup = () => {
  try { if (process.platform !== "win32") process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch {}
};
const fwd = (out) => (d) => {
  if (verdict) return;
  bytes += d.length;
  if (bytes > maxBytes) { verdict = 125; killGroup(); return; }
  out.write(d);
};
child.stdout.on("data", fwd(process.stdout));
child.stderr.on("data", fwd(process.stderr));
const timer = setTimeout(() => { if (!verdict) verdict = 124; killGroup(); }, timeoutMs);
child.on("error", () => { verdict = verdict ?? 127; killGroup(); });
child.on("close", (code, sig) => {
  clearTimeout(timer);
  killGroup(); // a passing run may still have left a grandchild behind
  if (verdict) process.exit(verdict);
  if (sig) { process.stderr.write("SG_LBR_SIGNAL " + sig + "\\n"); process.exit(126); }
  process.exit(code ?? 1);
});
`;

/**
 * Run one target. Returns {ok:true, record} or {ok:false, reason}.
 * opts: root, rel, sha256 (required), cases (optional), mode label, timeoutMs, maxBytes.
 */
export function runTarget(opts) {
  const { root, rel, sha256, cases, mode = "target" } = opts;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const bad = (reason) => ({ ok: false, reason: `${rel}: ${reason}` });
  const refusal = allowlistRefusal(rel);
  if (refusal) return bad(refusal);
  const comp = componentRefusal(root, rel);
  if (comp) return bad(comp);
  if (sha256 !== undefined && !/^[0-9a-f]{64}$/.test(sha256)) return bad("--sha256 must be 64 lowercase hex characters");
  if (cases !== undefined && !(Number.isSafeInteger(cases) && cases >= 1)) return bad("--cases must be a positive integer");
  const before = hashTarget(root, rel);
  if (before.refusal) return bad(before.refusal);
  if (sha256 !== undefined && before.sha !== sha256) return bad(`sha256 mismatch before run (actual ${before.sha})`);

  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // an outer `node --test` would otherwise change the child's reporter
  // `node --test` runs each file in a grandchild. Killing only the coordinator on a timeout left that
  // grandchild running and free to write into the tree after the FAIL was printed. The supervisor puts
  // the run in its own process group, enforces the timeout and the output cap itself, and kills the
  // whole group on every exit path. The outer spawnSync timeout is only a backstop for the supervisor.
  const r = spawnSync(process.execPath, ["-e", SUPERVISOR_SRC, "--", String(timeoutMs), String(maxBytes), rel], {
    cwd: root, env, shell: false, encoding: "utf8", timeout: timeoutMs + SUPERVISOR_GRACE_MS, killSignal: "SIGKILL",
    maxBuffer: maxBytes + 4096, stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.error) {
    if (r.error.code === "ETIMEDOUT") return bad(`supervisor timed out after ${timeoutMs + SUPERVISOR_GRACE_MS} ms`);
    if (r.error.code === "ENOBUFS") return bad(`output exceeded the ${maxBytes}-byte cap`);
    return bad(`spawn error: ${r.error.code ?? r.error.message}`);
  }
  if (r.signal) return bad(`terminated by signal ${r.signal}`);
  if (r.status === SUP_EXIT.timeout) return bad(`timed out after ${timeoutMs} ms`);
  if (r.status === SUP_EXIT.overflow) return bad(`output exceeded the ${maxBytes}-byte cap`);
  if (r.status === SUP_EXIT.signal) return bad(`terminated by signal ${(/SG_LBR_SIGNAL (\w+)/.exec(r.stderr ?? "") ?? [])[1] ?? "unknown"}`);
  if (r.status === SUP_EXIT.spawn) return bad("spawn error in supervisor");
  if (r.status !== 0) return bad(`exit status ${r.status}`);

  const after = hashTarget(root, rel);
  if (after.refusal) return bad(`after run: ${after.refusal}`);
  if (after.sha !== before.sha) return bad("source changed during the run (sha256 differs after)");
  const verdict = judge(parseTap(r.stdout), cases, rel);
  if (verdict) return bad(verdict);
  const n = parseTap(r.stdout).counters.tests;
  return { ok: true, record: { mode, path: rel, sha256: before.sha, cases: n, result: "pass" } };
}

// ---------- discovery ----------

function git(root, args) {
  // cwd decides the repository; an inherited GIT_DIR/GIT_WORK_TREE (a hook, a worktree helper) must not.
  const env = { ...process.env };
  for (const k of SCRATCH_GIT_SCRUB) delete env[k];
  const r = spawnSync("git", args, { cwd: root, env, shell: false, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status !== 0) return { ok: false, err: (r.error?.message ?? String(r.stderr ?? "")).trim() };
  return { ok: true, out: r.stdout };
}

function resolveRev(root, rev) {
  if (typeof rev !== "string" || rev === "" || rev.startsWith("-") || rev.includes("\0")) return null;
  const g = git(root, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${rev}^{commit}`]);
  return g.ok ? g.out.toString("utf8").trim() : null;
}

/** Parse `git diff --name-status -z` output into [{status, path, from?}]. Returns {reason} on junk. */
export function parseNameStatusZ(buf) {
  const toks = buf.toString("utf8").split("\0");
  if (toks.length && toks[toks.length - 1] === "") toks.pop();
  const out = [];
  for (let i = 0; i < toks.length;) {
    const st = toks[i++];
    const k = st[0];
    if (!/^[ACDMRTUX]\d*$/.test(st)) return { reason: `unrecognised name-status token ${JSON.stringify(st)}` };
    if (k === "R" || k === "C") {
      if (toks[i] === undefined || toks[i + 1] === undefined) return { reason: "truncated rename/copy record" };
      out.push({ status: k, from: toks[i], path: toks[i + 1] });
      i += 2;
    } else {
      if (toks[i] === undefined) return { reason: "truncated name-status record" };
      out.push({ status: k, path: toks[i++] });
    }
  }
  return { entries: out };
}

/** Pure classification of diff entries into targets / deleted / ignored. */
export function classify(entries) {
  const targets = [], deleted = [], ignored = [];
  for (const e of entries) {
    if (e.status === "D") { deleted.push(e.path); continue; }
    if (e.status === "R" && e.from && allowlistRefusal(e.from) === null) deleted.push(e.from); // renamed away
    if (e.status === "U" || e.status === "X") { ignored.push({ path: e.path, why: `unmerged/unknown status ${e.status}` }); continue; }
    const why = allowlistRefusal(e.path);
    if (why) ignored.push({ path: e.path, why }); else targets.push(e.path);
  }
  return { targets, deleted, ignored };
}

const EMPTY_DIFF_NOTE = "an empty diff is NOT proof that any specific build's regression ran; frozen mode (--target/--sha256/--cases) is";

/** Discovery. base/head are revs; head undefined = working tree (incl. untracked) vs base. */
export function discover(opts) {
  const { root, base, head, baseOptional = false } = opts;
  const out = (s) => process.stdout.write(`${s}\n`);
  let baseRev = base === undefined ? null : resolveRev(root, base);
  if (base === undefined) {
    const mb = git(root, ["merge-base", "HEAD", "origin/SignalGrid_Alpha"]);
    baseRev = mb.ok ? mb.out.toString("utf8").trim() : null;
  }
  if (!baseRev) {
    if (baseOptional) {
      out(`SKIPPED: base revision unavailable${base ? ` (${base})` : " (no merge-base with origin/SignalGrid_Alpha)"}; nothing was discovered or run. ${EMPTY_DIFF_NOTE}.`);
      out(JSON.stringify({ mode: "discover", result: "skipped", reason: "base-unavailable" }));
      return { code: 0 };
    }
    return { code: 2, reason: `cannot resolve a base revision${base ? ` '${base}'` : " (no merge-base with origin/SignalGrid_Alpha)"}; pass --base <rev> or --base-optional (refusing rather than passing silently)` };
  }
  let headRev = null;
  if (head !== undefined) {
    headRev = resolveRev(root, head);
    if (!headRev) return { code: 2, reason: `cannot resolve head revision '${head}'` };
  }
  const d = git(root, ["diff", "--name-status", "-z", "--find-renames", baseRev, ...(headRev ? [headRev] : []), "--"]);
  if (!d.ok) return { code: 2, reason: `git diff failed: ${d.err}` };
  const parsed = parseNameStatusZ(d.out);
  if (parsed.reason) return { code: 2, reason: parsed.reason };
  const entries = parsed.entries;
  if (!headRev) {
    const u = git(root, ["ls-files", "--others", "--exclude-standard", "-z"]);
    if (!u.ok) return { code: 2, reason: `git ls-files failed: ${u.err}` };
    for (const p of u.out.toString("utf8").split("\0")) if (p) entries.push({ status: "A", path: p });
  }
  const { targets, deleted, ignored } = classify(entries);
  const failures = [];
  for (const rel of targets) {
    const h = hashTarget(root, rel);
    const r = h.refusal
      ? { ok: false, reason: `${rel}: ${h.refusal}` }
      : runTarget({ root, rel, mode: "changed-target", timeoutMs: opts.timeoutMs, maxBytes: opts.maxBytes });
    if (r.ok) out(JSON.stringify(r.record)); else failures.push(r.reason);
  }
  for (const p of deleted) out(JSON.stringify({ mode: "changed-deleted", path: p, result: "reported-not-executed" }));
  out(`${targets.length} changed regression targets (${deleted.length} deleted/renamed-away reported, ${ignored.length} changed paths outside the allowlist ignored); ${EMPTY_DIFF_NOTE}.`);
  out(JSON.stringify({ mode: "discover", base: baseRev, head: headRev ?? "working-tree", targets: targets.length, deleted: deleted.length, ignored: ignored.length, failed: failures.length, result: failures.length ? "fail" : "pass" }));
  if (failures.length) return { code: 1, reason: failures.join(" | ") };
  return { code: 0 };
}

/** How many tracked files the allowlist matches in a git tree (derived, never listed). */
export function countAllowlisted(root) {
  const g = git(root, ["ls-files", "-z"]);
  if (!g.ok) return -1;
  return g.out.toString("utf8").split("\0").filter((p) => p && allowlistRefusal(p) === null).length;
}

// ---------- self-test ----------

function selfTest({ minAllowlisted }) {
  const results = [];
  const check = (name, cond, detail = "") => results.push({ name, ok: !!cond, detail });
  const tmp = mkdtempSync(join(tmpdir(), "sg-lbr-"));
  try {
    const mk = (root, rel, body) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), body); return sha256Hex(Buffer.from(body)); };
    const root = join(tmp, "tree");
    mkdirSync(root);
    const HEAD = `import test from "node:test";\nimport assert from "node:assert/strict";\n`;
    const body3 = `${HEAD}test("a",()=>assert.ok(true));test("b",()=>assert.ok(true));test("c",()=>assert.ok(true));\n`;
    const rel = "scripts/ok.test.mjs";
    const sha = mk(root, rel, body3);
    const run = (o) => runTarget({ root, ...o });

    // 1 passing target
    let r = run({ rel, sha256: sha, cases: 3 });
    check("passing target passes", r.ok && r.record.cases === 3 && r.record.sha256 === sha && r.record.result === "pass", r.reason);
    // 2 wrong hash
    r = run({ rel, sha256: "0".repeat(64), cases: 3 });
    check("wrong hash fails", !r.ok && /sha256 mismatch/.test(r.reason), r.reason);
    r = run({ rel, sha256: "ABC", cases: 3 });
    check("malformed hash fails", !r.ok && /64 lowercase hex/.test(r.reason), r.reason);
    // 3 reduced case count (file now has 2 cases, original claimed 3)
    const body2 = `${HEAD}test("a",()=>assert.ok(true));test("b",()=>assert.ok(true));\n`;
    const sha2 = mk(root, "scripts/two.test.mjs", body2);
    r = run({ rel: "scripts/two.test.mjs", sha256: sha2, cases: 3 });
    check("reduced case count fails", !r.ok && /case count 2 !== expected 3/.test(r.reason), r.reason);
    // 4 skipped, 5 todo, 6 failing, empty
    const shaS = mk(root, "scripts/skip.test.mjs", `${HEAD}test("a",()=>{});test("b",{skip:true},()=>{});\n`);
    r = run({ rel: "scripts/skip.test.mjs", sha256: shaS, cases: 2 });
    check("skipped test fails", !r.ok && /tests \(2\) !== pass \(1\)|skipped/.test(r.reason), r.reason);
    const shaT = mk(root, "scripts/todo.test.mjs", `${HEAD}test("a",()=>{});test("b",{todo:true},()=>{});\n`);
    r = run({ rel: "scripts/todo.test.mjs", sha256: shaT });
    check("todo test fails", !r.ok, r.reason);
    const shaF = mk(root, "scripts/fail.test.mjs", `${HEAD}test("a",()=>{});test("b",()=>assert.equal(1,2));\n`);
    r = run({ rel: "scripts/fail.test.mjs", sha256: shaF, cases: 2 });
    check("failing test fails", !r.ok && /exit status 1/.test(r.reason), r.reason);
    const shaE = mk(root, "scripts/empty.test.mjs", `${HEAD}\n`);
    r = run({ rel: "scripts/empty.test.mjs", sha256: shaE });
    check("empty run (no tests) fails", !r.ok, r.reason);
    // 7 parser: forged / duplicate / missing counters
    const good = "ok 1 - a\n1..1\n# tests 1\n# suites 0\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n";
    check("parser accepts coherent TAP", judge(parseTap(good), 1) === null);
    check("parser: duplicate pass counter fails", /duplicate/.test(judge(parseTap(good + "# pass 1\n"), 1) ?? ""));
    check("parser: forged extra tests counter fails", /duplicate/.test(judge(parseTap(good + "# tests 9\n"), 1) ?? ""));
    check("parser: missing fail counter fails", /missing '# fail'/.test(judge(parseTap(good.replace("# fail 0\n", "")), 1) ?? ""));
    check("parser: missing all counters fails", /missing/.test(judge(parseTap("ok 1 - a\n1..1\n"), 1) ?? ""));
    check("parser: tests !== pass fails", /!== pass/.test(judge(parseTap(good.replace("# pass 1", "# pass 0")), 1) ?? ""));
    check("parser: forged pass inflation fails", judge(parseTap(good.replace("# tests 1", "# tests 5").replace("# pass 1", "# pass 5")), 1) !== null);
    check("parser: ok-line count mismatch fails", judge(parseTap(good.replace("ok 1 - a\n", "ok 1 - a\nok 2 - b\n")), 1) !== null);
    check("parser: no ok line but counters claim pass fails", judge(parseTap(good.replace("ok 1 - a\n", "")), 1) !== null);
    check("parser: stray not ok fails", /not ok/.test(judge(parseTap("not ok 2 - x\n" + good), 1) ?? ""));
    check("parser: nonzero skipped fails", judge(parseTap(good.replace("# skipped 0", "# skipped 1")), 1) !== null);
    check("parser: nonzero cancelled fails", judge(parseTap(good.replace("# cancelled 0", "# cancelled 1")), 1) !== null);
    check("parser: nonzero todo fails", judge(parseTap(good.replace("# todo 0", "# todo 1")), 1) !== null);
    const nested = "    ok 1 - child\nok 1 - parent\n1..1\n# tests 2\n# suites 0\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n";
    check("parser: nested subtests (await t.test) accepted", judge(parseTap(nested), 2) === null, String(judge(parseTap(nested), 2)));
    const suite = "    ok 1 - a\n    ok 2 - b\n        ok 1 - c\n    ok 3 - inner\nok 1 - s\n1..1\n# tests 3\n# suites 2\n# pass 3\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n";
    check("parser: describe/it suites accepted", judge(parseTap(suite), 3) === null, String(judge(parseTap(suite), 3)));
    check("parser: nested run with a missing child ok line fails", judge(parseTap(nested.replace("    ok 1 - child\n", "")), 2) !== null);
    check("parser: forged extra nested ok line fails", judge(parseTap("    ok 2 - ghost\n" + nested), 2) !== null);
    check("parser: discovery mode (no expected count) accepts", judge(parseTap(good), undefined) === null);
    check("parser: huge counter rejected as unsafe", judge(parseTap(good.replace("# fail 0", "# fail 99999999999999999999")), 1) !== null);
    // 8 path safety
    r = run({ rel: "scripts/../scripts/ok.test.mjs", sha256: sha, cases: 3 });
    check("path traversal refused", !r.ok && /'\.\.'/.test(r.reason), r.reason);
    r = run({ rel: join(root, rel), sha256: sha, cases: 3 });
    check("absolute path refused", !r.ok && /relative/.test(r.reason), r.reason);
    r = run({ rel: "scripts/ok.mjs", sha256: sha, cases: 3 });
    check("non-.test name refused", !r.ok && /allowlist/.test(r.reason), r.reason);
    r = run({ rel: "docs/x.test.mjs", sha256: sha, cases: 3 });
    check("outside-root path refused", !r.ok && /allowlist/.test(r.reason), r.reason);
    r = run({ rel: "scripts/ok.test.ts", sha256: sha, cases: 3 });
    check(".ts refused", !r.ok && /allowlist/.test(r.reason), r.reason);
    r = run({ rel: "scripts/node_modules/x.test.mjs", sha256: sha, cases: 3 });
    check("node_modules refused", !r.ok && /node_modules/.test(r.reason), r.reason);
    r = run({ rel: "scripts/missing.test.mjs", sha256: sha, cases: 3 });
    check("missing file refused", !r.ok && /cannot stat/.test(r.reason), r.reason);
    // symlinks
    symlinkSync(join(root, rel), join(root, "scripts/link.test.mjs"));
    r = run({ rel: "scripts/link.test.mjs", sha256: sha, cases: 3 });
    check("symlinked file refused", !r.ok && /symlink/.test(r.reason), r.reason);
    mkdirSync(join(root, "elsewhere"));
    mk(root, "elsewhere/in.test.mjs", body3);
    symlinkSync(join(root, "elsewhere"), join(root, "scripts/linkdir"));
    r = run({ rel: "scripts/linkdir/in.test.mjs", sha256: sha, cases: 3 });
    check("symlinked directory component refused", !r.ok && /symlink/.test(r.reason), r.reason);
    mkdirSync(join(root, "scripts/adir.test.mjs"));
    r = run({ rel: "scripts/adir.test.mjs", sha256: sha, cases: 3 });
    check("directory named like a test refused", !r.ok && /regular file/.test(r.reason), r.reason);
    // 9 source modified during the run
    const selfRewrite = `import test from "node:test";import {appendFileSync} from "node:fs";import {fileURLToPath} from "node:url";\ntest("a",()=>{appendFileSync(fileURLToPath(import.meta.url),"// tamper\\n");});\n`;
    const shaR = mk(root, "scripts/rewrite.test.mjs", selfRewrite);
    r = run({ rel: "scripts/rewrite.test.mjs", sha256: shaR, cases: 1 });
    check("source modified during run fails", !r.ok && /changed during the run/.test(r.reason), r.reason);
    // 10 timeout / oversized output
    const shaH = mk(root, "scripts/hang.test.mjs", `import test from "node:test";\ntest("a",async()=>{await new Promise(()=>setInterval(()=>{},1000));});\n`);
    r = run({ rel: "scripts/hang.test.mjs", sha256: shaH, cases: 1, timeoutMs: 1500 });
    check("timeout fails", !r.ok && /timed out/.test(r.reason), r.reason);
    // 10b the timed-out test process itself is gone: it would write the marker 2 s after the kill
    const mark = join(tmp, "orphan-mark");
    const shaO = mk(root, "scripts/orphan.test.mjs", `import test from "node:test";import {writeFileSync} from "node:fs";\ntest("a",async()=>{setTimeout(()=>writeFileSync(${JSON.stringify(mark)},"alive"),3500);await new Promise(()=>setInterval(()=>{},1000));});\n`);
    r = run({ rel: "scripts/orphan.test.mjs", sha256: shaO, cases: 1, timeoutMs: 1500 });
    check("orphan run times out", !r.ok && /timed out after 1500 ms/.test(r.reason), r.reason);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000);
    check("timed-out test process does not survive the kill", !existsSync(mark), "marker written after the timeout");
    const shaB = mk(root, "scripts/big.test.mjs", `import test from "node:test";\ntest("a",()=>{process.stdout.write("x".repeat(400000)+"\\n");});\n`);
    r = run({ rel: "scripts/big.test.mjs", sha256: shaB, cases: 1, maxBytes: 65536 });
    check("oversized output fails", !r.ok && /output exceeded/.test(r.reason), r.reason);
    r = run({ rel: "scripts/big.test.mjs", sha256: shaB, cases: 1 });
    check("same output under the default cap is not refused for size", !/output exceeded/.test(r.reason ?? ""), r.reason);
    const shaX = mk(root, "scripts/kill.test.mjs", `import test from "node:test";\ntest("a",()=>{process.kill(process.pid,"SIGKILL");});\n`);
    r = run({ rel: "scripts/kill.test.mjs", sha256: shaX, cases: 1 });
    check("killed run fails", !r.ok, r.reason);
    check("cases 0 refused", !run({ rel, sha256: sha, cases: 0 }).ok);

    // 11 name-status parser + classification
    const nz = (...t) => Buffer.from(t.join("\0") + "\0");
    const p = parseNameStatusZ(nz("A", "scripts/a.test.mjs", "M", "lib/x/b.test.js", "D", "scripts/gone.test.mjs", "R100", "scripts/old.test.mjs", "scripts/new.test.mjs", "M", "docs/readme.md", "A", "scripts/../evil.test.mjs", "A", "/abs/x.test.mjs", "A", "scripts/we ird$(x).test.mjs"));
    const cl = p.entries ? classify(p.entries) : null;
    check("name-status parse + classify", cl && cl.targets.join() === "scripts/a.test.mjs,lib/x/b.test.js,scripts/new.test.mjs" && cl.deleted.join() === "scripts/gone.test.mjs,scripts/old.test.mjs" && cl.ignored.length === 4, JSON.stringify(cl));
    check("name-status: junk token refused", !!parseNameStatusZ(nz("Q", "a")).reason);
    check("name-status: truncated record refused", !!parseNameStatusZ(Buffer.from("A\0")).reason && !!parseNameStatusZ(nz("R100", "only-one")).reason);
    check("name-status: path with a newline is ignored, not run", classify([{ status: "A", path: "scripts/a\nb.test.mjs" }]).targets.length === 0);

    // 12 discovery on a real throwaway git repo
    const repo = join(tmp, "repo");
    mkdirSync(repo);
    const G = (...a) => scratchGit(repo, a);
    G("init", "-q");
    const T = (n) => `${HEAD}${Array.from({ length: n }, (_, i) => `test("t${i}",()=>assert.ok(true));`).join("")}\n`;
    mk(repo, "scripts/mod.test.mjs", T(1));
    mk(repo, "scripts/del.test.mjs", T(1));
    mk(repo, "scripts/ren.test.mjs", T(2) + "// padding so rename similarity is unambiguous\n".repeat(5));
    mk(repo, "docs/note.md", "a\n");
    G("add", "-A"); G("commit", "-q", "-m", "base");
    const c1 = G("rev-parse", "HEAD").stdout.trim();
    mk(repo, "scripts/mod.test.mjs", T(2));
    mk(repo, "scripts/add.test.mjs", T(3));
    G("rm", "-q", "scripts/del.test.mjs");
    G("mv", "scripts/ren.test.mjs", "scripts/ren2.test.mjs");
    mk(repo, "docs/note.md", "b\n");
    mk(repo, "scripts/helper.mjs", "export const x = 1;\n");
    G("add", "-A"); G("commit", "-q", "-m", "change");
    const c2 = G("rev-parse", "HEAD").stdout.trim();
    const captured = [];
    const realWrite = process.stdout.write.bind(process.stdout);
    const capture = (fn) => { captured.length = 0; process.stdout.write = (s) => { captured.push(String(s)); return true; }; try { return fn(); } finally { process.stdout.write = realWrite; } };
    let d = capture(() => discover({ root: repo, base: c1, head: c2 }));
    let text = captured.join("");
    check("discovery: A/M/R run, D reported, others ignored", d.code === 0 && /"path":"scripts\/add\.test\.mjs","sha256":"[0-9a-f]{64}","cases":3/.test(text) && /"path":"scripts\/mod\.test\.mjs"[^}]*"cases":2/.test(text) && /"path":"scripts\/ren2\.test\.mjs"[^}]*"cases":2/.test(text) && /"mode":"changed-deleted","path":"scripts\/del\.test\.mjs"/.test(text) && !/helper/.test(text.replace(/ignored/g, "")) && /3 changed regression targets \(2 deleted\/renamed-away reported, 2 changed paths/.test(text), `${d.code} ${d.reason ?? ""} ${text}`);
    check("discovery: deleted file is not executed", !/"mode":"changed-target","path":"scripts\/del\.test\.mjs"/.test(text));
    d = capture(() => discover({ root: repo, base: c2, head: c2 }));
    text = captured.join("");
    check("discovery: empty diff exits 0 and says it is not proof", d.code === 0 && /0 changed regression targets/.test(text) && /NOT proof that any specific build's regression ran/.test(text), text);
    // working tree: modified + untracked + failing
    mk(repo, "scripts/untracked.test.mjs", T(1));
    d = capture(() => discover({ root: repo, base: c2 }));
    text = captured.join("");
    check("discovery: untracked test in working tree is picked up", d.code === 0 && /"path":"scripts\/untracked\.test\.mjs"/.test(text), text);
    mk(repo, "scripts/bad.test.mjs", `${HEAD}test("x",()=>assert.equal(1,2));\n`);
    d = capture(() => discover({ root: repo, base: c2 }));
    check("discovery: a failing changed test fails the run", d.code === 1 && /bad\.test\.mjs/.test(d.reason ?? ""), d.reason);
    rmSync(join(repo, "scripts/bad.test.mjs"));
    symlinkSync(join(root, rel), join(repo, "scripts/sym.test.mjs"));
    d = capture(() => discover({ root: repo, base: c2 }));
    check("discovery: a changed symlink test is refused, not followed", d.code === 1 && /symlink|regular|cannot read/.test(d.reason ?? ""), d.reason);
    rmSync(join(repo, "scripts/sym.test.mjs"));
    d = capture(() => discover({ root: repo, base: "no-such-rev" }));
    check("discovery: unresolvable base refuses (exit 2) without --base-optional", d.code === 2, JSON.stringify(d));
    d = capture(() => discover({ root: repo, base: "no-such-rev", baseOptional: true }));
    text = captured.join("");
    check("discovery: --base-optional skips loudly with exit 0", d.code === 0 && /SKIPPED/.test(text) && /"result":"skipped"/.test(text), text);
    d = capture(() => discover({ root: repo, base: "--output=/tmp/x" }));
    check("discovery: option-shaped base refused", d.code === 2);
    d = capture(() => discover({ root: repo }));
    check("discovery: no origin/SignalGrid_Alpha and no --base refuses (exit 2)", d.code === 2 && /pass --base/.test(d.reason ?? ""), JSON.stringify(d));

    // 13 CLI exit codes through a real child process
    const cli = (args) => spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--root", root, ...args], { encoding: "utf8", env: { ...process.env, NODE_TEST_CONTEXT: "" } });
    let c = cli(["--target", rel, "--sha256", sha, "--cases", "3"]);
    check("CLI frozen pass: exit 0 and one JSON record", c.status === 0 && JSON.parse(c.stdout.trim()).result === "pass", c.stderr);
    c = cli(["--target", rel, "--sha256", sha, "--cases", "4"]);
    check("CLI frozen reduced domain: exit 1 with one-line reason", c.status === 1 && c.stderr.trim().split("\n").length === 1, c.stderr);
    c = cli(["--target", rel]);
    check("CLI frozen without --sha256/--cases: exit 2", c.status === 2, c.stderr);
    c = cli(["--target", rel, "--sha256", sha, "--cases", "3", "--changed"]);
    check("CLI mixing modes: exit 2", c.status === 2, c.stderr);
    c = cli(["--nonsense"]);
    check("CLI unknown flag: exit 2", c.status === 2, c.stderr);
    c = cli(["--target", rel, "--sha256", sha, "--cases", "3x"]);
    check("CLI non-numeric --cases: exit 2", c.status === 2, c.stderr);
    c = cli(["--min-allowlisted", "0", "--self-test"]);
    check("CLI --min-allowlisted 0 refused (a floor of 0 is a gate scanning nothing)", c.status === 2 && /floor/.test(c.stderr), c.stderr);

    // 14 derived floors on the REAL tree: the allowlist must still match real tests
    const found = countAllowlisted(REPO_ROOT);
    check(`real tree: allowlist matches >= ${minAllowlisted} tracked test files (found ${found})`, found >= minAllowlisted);
    check(`self-test ran >= ${SELF_TEST_MIN_CASES} cases`, results.length + 1 >= SELF_TEST_MIN_CASES);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  const failed = results.filter((x) => !x.ok);
  for (const f of failed) process.stderr.write(`SELF-TEST MISS: ${f.name}${f.detail ? ` -- ${String(f.detail).slice(0, 300)}` : ""}\n`);
  process.stdout.write(`check-local-build-regressions self-test: ${results.length - failed.length}/${results.length} passed\n`);
  return failed.length === 0 && results.length >= SELF_TEST_MIN_CASES;
}

// ---------- CLI ----------

const VALUE_FLAGS = new Set(["--target", "--sha256", "--cases", "--base", "--head", "--root", "--timeout-ms", "--max-output-bytes", "--min-allowlisted"]);
const BOOL_FLAGS = new Set(["--changed", "--base-optional", "--self-test"]);

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i];
    if (BOOL_FLAGS.has(f)) { a[f] = true; continue; }
    if (!VALUE_FLAGS.has(f)) return { error: `unknown argument ${JSON.stringify(f)}` };
    if (f in a) return { error: `${f} given twice` };
    if (i + 1 >= argv.length) return { error: `${f} needs a value` };
    a[f] = argv[++i];
  }
  return { a };
}

const intArg = (v, name, lo, hi) => {
  if (!/^\d+$/.test(String(v))) throw new Error(`${name} must be a non-negative integer`);
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < lo || n > hi) throw new Error(`${name} must be between ${lo} and ${hi}`);
  return n;
};

function main(argv) {
  const usage = (m) => { process.stderr.write(`check-local-build-regressions: ${m}\n`); return 2; };
  const { a, error } = parseArgs(argv);
  if (error) return usage(error);
  let timeoutMs, maxBytes, minAllow, cases;
  try {
    timeoutMs = a["--timeout-ms"] === undefined ? DEFAULT_TIMEOUT_MS : intArg(a["--timeout-ms"], "--timeout-ms", 100, MAX_TIMEOUT_MS);
    maxBytes = a["--max-output-bytes"] === undefined ? DEFAULT_MAX_OUTPUT_BYTES : intArg(a["--max-output-bytes"], "--max-output-bytes", 1024, MAX_MAX_OUTPUT_BYTES);
    minAllow = a["--min-allowlisted"] === undefined ? DEFAULT_MIN_ALLOWLISTED : intArg(a["--min-allowlisted"], "--min-allowlisted", 0, 1_000_000);
    if (a["--cases"] !== undefined) cases = intArg(a["--cases"], "--cases", 1, 1_000_000);
  } catch (e) { return usage(e.message); }
  if (minAllow < 1) return usage("--min-allowlisted floor must be >= 1 (a floor of 0 would let a scan that finds nothing pass)");
  const modes = ["--self-test", "--changed", "--target"].filter((m) => a[m] !== undefined);
  if (modes.length !== 1) return usage("choose exactly one of --target, --changed, --self-test");
  const root = a["--root"] ? resolve(a["--root"]) : REPO_ROOT;
  try { realpathSync(root); } catch { return usage("repository root unreadable"); }

  if (a["--self-test"]) return selfTest({ minAllowlisted: minAllow }) ? 0 : 1;
  if (a["--changed"]) {
    if (a["--sha256"] || a["--cases"] || a["--target"]) return usage("--changed takes no --target/--sha256/--cases");
    const d = discover({ root, base: a["--base"], head: a["--head"], baseOptional: !!a["--base-optional"], timeoutMs, maxBytes });
    if (d.code !== 0) process.stderr.write(`FAIL: ${d.reason}\n`);
    return d.code;
  }
  if (a["--sha256"] === undefined || cases === undefined) return usage("--target needs --sha256 and --cases");
  if (a["--base"] || a["--head"] || a["--base-optional"]) return usage("--target takes no --base/--head/--base-optional");
  const r = runTarget({ root, rel: a["--target"], sha256: a["--sha256"], cases, timeoutMs, maxBytes });
  if (!r.ok) { process.stderr.write(`FAIL: ${r.reason}\n`); return 1; }
  process.stdout.write(`${JSON.stringify(r.record)}\n`);
  return 0;
}

if (isMainModule(process.argv[1], import.meta.url)) process.exitCode = main(process.argv.slice(2));
