// ci-host-verification.sh: every timeout or unknown ends the step in bounded time WITHOUT giving
// up the host reservation while owned processes are live or cannot be inspected; and the PR Mac
// slice step's log stamper never turns a failure into a pass.
//
// Before this regression the wrapper looped for as long as `ps` showed (or could not show) the
// owned group, so a job that hit its work bound sat until the runner's job limit and lost its
// logs. The repaired wrapper verifies for a bounded window and then hands the SAME lock (the same
// open file description on FD 9) to a detached, watch-only custodian, and returns.
//
// Fixtures only: every process signalled here is one this test started. Survivors, failed and
// stalled inspection, and a failed readiness handshake are simulated in a COPY of the wrapper in
// which named tokens are substituted (each token must occur exactly once, asserted). Normal
// completion, a clean timeout and cancellation run the real, unmodified wrapper.
//
// Cohort lifetime: every wrapper is started with a "lifeline" pipe on FD 3, which every process
// it starts inherits (work, inspectors, custodians). The pipe reaches end-of-file only when the
// last of them has exited, so the test can JOIN the whole cohort without knowing or signalling
// any pid. Cleanup signals only through live child handles (a child this process has not yet
// reaped, so its pid is still ours). A fixture is removed only after every lifeline has closed
// and its lock is free; otherwise it is left in place and the test fails.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scratchGitOk } from "../../../lib/scratch-git.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAC = join(HERE, "..", "..");
const WRAPPER = join(MAC, "ci-host-verification.sh");
const HELPER = join(MAC, "host-verification-lock.sh");
const WORKFLOW = join(MAC, "..", "..", ".github", "workflows", "mac-runner-auto.yml");
const STAMP = /ci-host-verification: \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ \+\d+s /;

const sleepMs = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(check, ms) { const end = Date.now() + ms; while (Date.now() < end) { if (check()) return true; await sleepMs(100); } return check(); }
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "ci-host-custody-"));
  const repo = join(dir, "repo"), home = join(dir, "home");
  const lock = join(home, "Library/Caches/signalgrid/host-verification.lock");
  mkdirSync(join(repo, "scripts/mac"), { recursive: true });
  mkdirSync(dirname(lock), { recursive: true });
  writeFileSync(lock, "");
  copyFileSync(HELPER, join(repo, "scripts/mac/host-verification-lock.sh"));
  writeFileSync(join(repo, "scripts/mac/free-test-port.sh"), 'printf "teardown\\n" >> "$SG_CI_EVENTS"\n');
  scratchGitOk(repo, ["init", "-q", "-b", "SignalGrid_Alpha"]);
  scratchGitOk(repo, ["add", "-A"]);
  scratchGitOk(repo, ["commit", "-q", "-m", "trusted helper fixture"]);
  const sha = scratchGitOk(repo, ["rev-parse", "HEAD"]);
  const idle = join(dir, "brain-idle.json");
  writeFileSync(idle, JSON.stringify({ coordinator: { counts: { queued: 0 }, blocked_reason: null } }));
  const events = join(dir, "events");
  writeFileSync(events, "");
  const env = { PATH: process.env.PATH, HOME: home, RUNNER_TEMP: dir, SG_CI_EVENTS: events, SG_CI_BRAIN_URL: `file://${idle}` };
  // The owned cohort: live handles and lifelines for everything this fixture started.
  return { dir, repo, lock, sha, events, env, inode: statSync(lock).ino, ctl: join(dir, "ps-mode"), pgfile: join(dir, "work-pgid"), handles: [], lifelines: [] };
}

/** 0 when the host lock can be taken right now, 75 when another holder has it. */
function probeLock(f) {
  return spawnSync("/bin/bash", ["-c", '. "$1"; sg_host_verify_acquire "$2"', "probe", HELPER, f.lock], { env: f.env, encoding: "utf8" }).status;
}

const unreaped = (child) => child.exitCode === null && child.signalCode === null;
const settles = (promise, ms) => Promise.race([promise.then(() => true), sleepMs(ms).then(() => false)]);

/** Join the whole owned cohort on every outcome; remove the fixture only once that is proven. */
async function finish(f) {
  writeFileSync(f.ctl, "real"); // inspection is real again, so any custodian can confirm and exit
  // Only a child this process has not reaped is signalled: its pid cannot have been reused.
  for (const child of f.handles) { if (unreaped(child)) child.kill("SIGKILL"); }
  const joined = await settles(Promise.all(f.lifelines), 45000);
  assert.ok(joined, `fixture processes are still running; ${f.dir} is left in place`);
  assert.equal(probeLock(f), 0, `the fixture lock is still held; ${f.dir} is left in place`);
  rmSync(f.dir, { recursive: true, force: true });
}

/** Run a wrapper with `body` on stdin; resolves { code, signal, stdout, stderr, ms, timedOut }. */
function runWrapper(f, wrapper, body, { wait = 2, work = 4, limitMs = 20000, onSpawn } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn("/bin/bash", [wrapper, f.sha, String(wait), String(work)], { cwd: f.repo, env: f.env, detached: true, stdio: ["pipe", "pipe", "pipe", "pipe"] });
    f.handles.push(child);
    f.lifelines.push(new Promise((closed) => { child.stdio[3].on("close", closed); child.stdio[3].resume(); }));
    let stdout = "", stderr = "", timedOut = false;
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.stdin.end(body);
    // The leader is still unreaped here, so its process group id is still this fixture's.
    const timer = setTimeout(() => { timedOut = true; if (unreaped(child)) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ } } }, limitMs);
    if (onSpawn) onSpawn(child);
    child.on("exit", (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, ms: Date.now() - started, timedOut }); });
  });
}

/** A copy of the wrapper with each [token, replacement] applied; every token must occur exactly once. */
function derive(f, substitutions) {
  let source = readFileSync(WRAPPER, "utf8");
  for (const [token, replacement] of substitutions) {
    assert.equal(source.split(token).length - 1, 1, `the wrapper holds exactly one ${JSON.stringify(token)}`);
    source = source.replace(token, () => replacement);
  }
  const copy = join(f.dir, "wrapper-derived.sh");
  writeFileSync(copy, source);
  return copy;
}

/** The stand-in process inspection, steered by the fixture's ps-mode file. */
function standInPs(f) {
  const fake = join(f.dir, "stand-in-ps");
  writeFileSync(fake, `#!/bin/bash
mode=$(cat ${JSON.stringify(f.ctl)} 2>/dev/null || echo real)
case "$mode" in
  live) /bin/ps "$@" || exit $?; printf '    1 %s S\\n' "$(cat ${JSON.stringify(f.pgfile)})";;
  fail) exit 2;;
  eofhang) exec 1>&-; exec /bin/sleep 30;;
  stall) exec /bin/sleep 30;;
  stall-twice) echo x >> ${JSON.stringify(join(f.dir, "ps-calls"))}; if [ "$(wc -l < ${JSON.stringify(join(f.dir, "ps-calls"))})" -le 2 ]; then exec /bin/sleep 30; fi; exec /bin/ps "$@";;
  *) exec /bin/ps "$@";;
esac
`);
  chmodSync(fake, 0o755);
  return [['"/bin/ps"', JSON.stringify(fake)], ["my $verify_seconds = 30;", "my $verify_seconds = 2;"], ["my $inspect_seconds = 10;", "my $inspect_seconds = 1;"]];
}

test("normal completion: exit 0, teardown runs, the lock is free, and each phase line carries a UTC time and elapsed seconds", async () => {
  const f = fixture();
  try {
    const r = await runWrapper(f, WRAPPER, 'printf "body\\n" >> "$SG_CI_EVENTS"\n');
    assert.equal(r.timedOut, false, r.stderr);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(readFileSync(f.events, "utf8"), "body\nteardown\n");
    assert.equal(probeLock(f), 0);
    assert.equal(statSync(f.lock).ino, f.inode);
    assert.match(r.stdout + r.stderr, STAMP);
    assert.match(r.stderr, /cleanup confirmed: owned group empty/);
  } finally { await finish(f); }
});

test("work timeout with a clean group: exit 124 in bounded time, cleanup confirmed, the lock is free", async () => {
  const f = fixture();
  try {
    const r = await runWrapper(f, WRAPPER, "sleep 30\n", { work: 1 });
    assert.equal(r.timedOut, false, r.stderr);
    assert.equal(r.code, 124, r.stderr);
    assert.ok(r.ms < 12000, `took ${r.ms} ms`);
    assert.match(r.stderr, /work\/cleanup deadline exceeded/);
    assert.match(r.stderr, /cleanup confirmed: owned group empty/);
    assert.equal(readFileSync(f.events, "utf8"), "teardown\n");
    assert.equal(probeLock(f), 0);
  } finally { await finish(f); }
});

for (const [mode, what] of [
  ["live", "inspection still reports a live owned process after KILL"],
  ["fail", "inspection itself fails (uncertainty is not an empty group)"],
  ["eofhang", "the inspector closes its output and then never exits"],
  ["stall", "the inspector never answers"],
]) {
  test(`work timeout, ${what}: the step returns in bounded time and the SAME lock stays held by a custodian until the group is confirmed empty`, async () => {
    const f = fixture();
    try {
      const copy = derive(f, standInPs(f));
      writeFileSync(f.ctl, mode);
      // A sentinel this test owns, outside the work group: nothing may signal it.
      const sentinel = spawn("/bin/sleep", ["90"], { stdio: "ignore" });
      f.handles.push(sentinel);
      const r = await runWrapper(f, copy, `echo $$ > ${JSON.stringify(f.pgfile)}\nsleep 30\n`, { work: 1, limitMs: 45000 });
      assert.equal(r.timedOut, false, `the wrapper did not return: ${r.stderr}`);
      assert.equal(r.code, 124, r.stderr);
      assert.ok(r.ms < 30000, `took ${r.ms} ms`);
      assert.match(r.stderr, /cleanup unconfirmed; retaining host reservation/);
      const keepers = [...r.stderr.matchAll(/reservation retained by custodian pid (\d+)/g)].map((m) => Number(m[1]));
      assert.ok(keepers.length >= 1, r.stderr);
      assert.ok(alive(keepers[0]), "the custodian is running");
      assert.equal(probeLock(f), 75, "another chain must not be admitted while cleanup is unconfirmed");
      assert.equal(statSync(f.lock).ino, f.inode, "the same persistent lock file");
      assert.ok(readFileSync(f.events, "utf8").endsWith("teardown\n"), "teardown still ran");
      assert.ok(alive(sentinel.pid), "a process outside the owned group was not signalled");
      // Inspection becomes real again: the owned group IS empty, so custody ends by itself.
      writeFileSync(f.ctl, "real");
      assert.ok(await until(() => keepers.every((pid) => !alive(pid)), 12000), "every custodian exits once the group is confirmed empty");
      assert.ok(await until(() => probeLock(f) === 0, 5000), "the lock is free after custody ends");
      assert.equal(statSync(f.lock).ino, f.inode);
      assert.ok(alive(sentinel.pid));
    } finally { await finish(f); }
  });
}

test("an inspector that is not yet reaped is accounted for before an empty group is believed", async () => {
  const f = fixture();
  try {
    // Two inspections stall and, with a zero reap window, are still unreaped when the next (real)
    // listing shows the work group empty. Cleanup may be confirmed only after they are reaped.
    const copy = derive(f, [...standInPs(f), ["my $inspector_reap_seconds = 2;", "my $inspector_reap_seconds = 0;"]]);
    writeFileSync(f.ctl, "stall-twice");
    const r = await runWrapper(f, copy, "sleep 30\n", { work: 1, limitMs: 45000 });
    assert.equal(r.timedOut, false, r.stderr);
    assert.equal(r.code, 124, r.stderr);
    assert.match(r.stderr, /inspectors settled: [12] killed inspector\(s\) reaped after their window/);
    const settled = r.stderr.indexOf("inspectors settled"), confirmed = r.stderr.indexOf("cleanup confirmed: owned group empty");
    assert.ok(settled >= 0 && confirmed > settled, `the inspectors are settled before cleanup is confirmed: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /custodian pid/);
    assert.equal(probeLock(f), 0);
  } finally { await finish(f); }
});

test("failed readiness: the child is never released, user work never starts, exit 125, and no detached process is left to signal a pid", async () => {
  const f = fixture();
  try {
    // The child reports ready only after the supervisor's window has passed: the losing side of the race.
    const copy = derive(f, [["my $ready_seconds = 10;", "my $ready_seconds = 1;"], ['print {$notify} "ready\\n";', 'sleep 3; print {$notify} "ready\\n";']]);
    const started = join(f.dir, "work-started");
    const r = await runWrapper(f, copy, `printf started > ${JSON.stringify(started)}\nsleep 30\n`, { work: 20, limitMs: 30000 });
    assert.equal(r.timedOut, false, r.stderr);
    assert.equal(r.code, 125, r.stderr);
    assert.match(r.stderr, /readiness not established/);
    assert.doesNotMatch(r.stderr, /custodian pid/);
    await sleepMs(3500); // past the moment the late child would have started work, had it been released
    assert.equal(existsSync(started), false, "unacknowledged work never started");
    assert.equal(probeLock(f), 0);
    assert.equal(statSync(f.lock).ino, f.inode);
  } finally { await finish(f); }
});

test("cancellation: TERM during work ends the owned group, exits 143, and frees the lock", async () => {
  const f = fixture();
  try {
    const mark = join(f.dir, "entered");
    const r = await runWrapper(f, WRAPPER, `printf entered > ${JSON.stringify(mark)}\nsleep 30\n`, {
      work: 20,
      onSpawn: (child) => { const poll = setInterval(() => { if (existsSync(mark)) { clearInterval(poll); child.kill("SIGTERM"); } }, 50); child.on("exit", () => clearInterval(poll)); },
    });
    assert.equal(r.timedOut, false, r.stderr);
    assert.equal(r.code, 143, r.stderr);
    assert.ok(r.ms < 12000, `took ${r.ms} ms`);
    assert.equal(probeLock(f), 0);
  } finally { await finish(f); }
});

// ---- the PR Mac slice step's log stamper, taken from the workflow text itself ----
const workflow = readFileSync(WORKFLOW, "utf8");
const chain = (/<<'CI_CHAIN'\n([\s\S]*?)\n {10}CI_CHAIN\n/.exec(workflow) || [])[1]?.replace(/^ {10}/gm, "") ?? "";
const stamper = (/perl -MPOSIX=strftime -e '\n([\s\S]*?)' preflight\.log\n/.exec(chain) || [])[1] ?? "";

/** Feed `chunks` to the stamper with a pause between them; resolves { code, stdout, log }. */
function runStamper(dir, chunks) {
  return new Promise((resolve) => {
    const log = join(dir, "out.log");
    const child = spawn("perl", ["-MPOSIX=strftime", "-e", stamper, log], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.on("exit", (code) => resolve({ code, stdout, log: existsSync(log) ? readFileSync(log, "utf8") : "" }));
    (async () => { for (const chunk of chunks) { child.stdin.write(chunk); await sleepMs(250); } child.stdin.end(); })();
  });
}

test("log stamper: a step marker split across reads at either byte boundary still gets its live start and result lines", async () => {
  assert.ok(stamper.length > 0, "the workflow carries the stamper");
  const line = Buffer.from("▶ step one … ok (1s)\nplain detail\n");
  for (const cut of [1, 2, 3]) {
    const dir = mkdtempSync(join(tmpdir(), "ci-stamper-"));
    try {
      const r = await runStamper(dir, [line.subarray(0, cut), line.subarray(cut, 16), line.subarray(16)]);
      assert.equal(r.code, 0);
      assert.match(r.stdout, /^\[\d\d:\d\d:\d\dZ \+\d+s\] start ▶ step one/m, `cut after ${cut} byte(s): ${JSON.stringify(r.stdout)}`);
      assert.match(r.stdout, /ok \(1s\)/);
      assert.doesNotMatch(r.stdout, /plain detail/);
      assert.match(r.log, /^\[\d\d:\d\d:\d\dZ \+\d+s\] ▶ step one … ok \(1s\)\n\[\d\d:\d\d:\d\dZ \+\d+s\] plain detail\n$/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test("log stamper: a read, write or log-open failure exits nonzero", () => {
  const dir = mkdtempSync(join(tmpdir(), "ci-stamper-"));
  try {
    const run = (redirect, logPath) => spawnSync("/bin/bash", ["-c", `printf '▶ a … ok\\n' | perl -MPOSIX=strftime -e "$1" "$2" ${redirect}; echo "\${PIPESTATUS[1]}" >&2`, "x", stamper, logPath], { encoding: "utf8" });
    assert.equal(run("", join(dir, "ok.log")).stderr.trim().split("\n").pop(), "0", "the control case passes");
    assert.notEqual(run(">&-", join(dir, "w.log")).stderr.trim().split("\n").pop(), "0", "closed output");
    assert.notEqual(run("", dir).stderr.trim().split("\n").pop(), "0", "log path cannot be opened");
    // Reading a directory is a read error, not an end of input.
    const unreadable = spawnSync("/bin/bash", ["-c", 'perl -MPOSIX=strftime -e "$1" "$2" < "$3"', "x", stamper, join(dir, "r.log"), dir], { encoding: "utf8" });
    assert.notEqual(unreadable.status, 0, "unreadable input");
    assert.match(unreadable.stderr, /log read/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("workflow pipeline: the slice's code is preflight's own, and a failed log writer cannot turn it green", () => {
  const lines = chain.split("\n");
  const from = lines.findIndex((l) => l.startsWith("node scripts/preflight.mjs "));
  const to = lines.findIndex((l) => l.startsWith('ci_mark "preflight slice'));
  assert.ok(from > 0 && to > from, "the workflow chain holds the preflight pipeline");
  const script = ["set -u", lines.find((l) => l.startsWith("ci_mark() ")), ...lines.slice(from, to + 1), 'echo "RESULT=$preflight_code"'].join("\n");
  const run = (exitCode, logIsDirectory) => {
    const dir = mkdtempSync(join(tmpdir(), "ci-pipeline-"));
    try {
      mkdirSync(join(dir, "scripts"));
      writeFileSync(join(dir, "scripts/preflight.mjs"), `console.log("▶ only step … ok"); process.exit(${exitCode});\n`);
      if (logIsDirectory) mkdirSync(join(dir, "preflight.log"));
      const out = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", script], { cwd: dir, env: { PATH: process.env.PATH, PREFLIGHT_SLICE: "3" }, encoding: "utf8" });
      return (/RESULT=(\d+)/.exec(out.stdout) || [])[1];
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };
  assert.equal(run(0, false), "0");
  assert.equal(run(3, false), "3");
  assert.notEqual(run(0, true), "0", "preflight passed but the log could not be written");
  assert.ok(!workflow.includes("node scripts/preflight.mjs >"), "the unbounded redirect form stays out");
});
