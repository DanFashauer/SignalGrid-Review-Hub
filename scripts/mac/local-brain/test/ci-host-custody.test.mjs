// ci-host-verification.sh: a work timeout, a survivor, a failed listing and a stalled inspector end
// the step in bounded time WITHOUT giving up the host reservation while owned processes are live
// or cannot be inspected. Three ownership holds are deliberately NOT bounded (the reap after a
// failed handshake, the reap of the supervisor's own killed inspectors, and the hold when no
// custodian acknowledged): only that process can prove the closure, so it keeps the reservation
// until the outer job limit. And the PR Mac slice step's log stamper never turns a failure into a pass.
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
// any pid. Each direct child (wrapper or sentinel) is also joined on its own observed exit. Cleanup signals only through live child handles (a child this process has not yet
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
  return { dir, repo, lock, sha, events, env, inode: statSync(lock).ino, ctl: join(dir, "ps-mode"), pgfile: join(dir, "work-pgid"), handles: [], lifelines: [], exits: [] };
}

/** 0 when the host lock can be taken right now, 75 when another holder has it. */
function probeLock(f) {
  return spawnSync("/bin/bash", ["-c", '. "$1"; sg_host_verify_acquire "$2"', "probe", HELPER, f.lock], { env: f.env, encoding: "utf8" }).status;
}

const unreaped = (child) => child.exitCode === null && child.signalCode === null;
const settles = (promise, ms) => Promise.race([promise.then(() => true), sleepMs(ms).then(() => false)]);

/** Register a direct child: its live handle, and the exit this process must observe before cleanup ends. */
function own(f, child) {
  f.handles.push(child);
  f.exits.push(new Promise((exited) => child.on("exit", exited)));
  return child;
}

/** Join the whole owned cohort on every outcome; remove the fixture only once that is proven. */
async function finish(f) {
  writeFileSync(f.ctl, "real"); // inspection is real again, so any custodian can confirm and exit
  // Only a child this process has not reaped is signalled: its pid cannot have been reused.
  for (const child of f.handles) { if (unreaped(child)) child.kill("SIGKILL"); }
  // Every direct child observed to exit (reaped here), and every inherited lifeline closed.
  const joined = await settles(Promise.all([...f.exits, ...f.lifelines]), 45000);
  assert.ok(joined, `fixture processes are still running; ${f.dir} is left in place`);
  assert.equal(probeLock(f), 0, `the fixture lock is still held; ${f.dir} is left in place`);
  rmSync(f.dir, { recursive: true, force: true });
}

/** Run a wrapper with `body` on stdin; resolves { code, signal, stdout, stderr, ms, timedOut }. */
function runWrapper(f, wrapper, body, { wait = 2, work = 4, limitMs = 20000, onSpawn } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn("/bin/bash", [wrapper, f.sha, String(wait), String(work)], { cwd: f.repo, env: f.env, detached: true, stdio: ["pipe", "pipe", "pipe", "pipe"] });
    own(f, child);
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
      const sentinel = own(f, spawn("/bin/sleep", ["90"], { stdio: "ignore" }));
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
      // Custody ending is read from the lock, not from the pid: where the init process does not reap
      // orphans an exited custodian stays a zombie, which still answers a liveness probe. A free lock
      // means every custodian closed FD 9; finish() then joins them through the lifeline.
      assert.ok(await until(() => probeLock(f) === 0, 17000), "the lock is free once the group is confirmed empty");
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

test("fixture cleanup joins a direct child that has no wrapper lifeline", async () => {
  const f = fixture();
  const sentinel = own(f, spawn("/bin/sleep", ["90"], { stdio: "ignore" }));
  await finish(f);
  assert.equal(unreaped(sentinel), false, "finish returned only after the sentinel was observed to exit");
  assert.equal(existsSync(f.dir), false);
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

// ---- the early setup identity receipt: partial, nonqualifying, and never a slice record ----
// Root on #439 (7011292797): two slices lost their runner with no log and no record. The receipt is
// uploaded before the long step so the slice's identity survives; it must never count as a result.
const receiptWriter = (/node --input-type=module - <<'SETUP_RECEIPT'\n([\s\S]*?)\n {10}SETUP_RECEIPT\n/.exec(workflow) || [])[1]?.replace(/^ {10}/gm, "") ?? "";
const RECEIPT_KEYS = ["kind", "receiptVersion", "status", "qualifying", "note", "capturedAt", "prHead", "checkout", "tree", "runId", "runAttempt", "slice",
  "osName", "osProductVersion", "osBuildVersion", "machineArch", "runnerArch", "imageOs", "imageVersion", "runnerVersion",
  "nodeVersion", "pnpmVersion", "gitVersion", "unknown"];

/** Run the workflow's own receipt writer in a scratch repo; returns { status, receipt, files, stdout }. */
function writeReceipt(extraEnv) {
  const repo = mkdtempSync(join(tmpdir(), "ci-receipt-"));
  try {
    writeFileSync(join(repo, "a.txt"), "a\n");
    scratchGitOk(repo, ["init", "-q", "-b", "SignalGrid_Alpha"]);
    scratchGitOk(repo, ["add", "-A"]);
    scratchGitOk(repo, ["commit", "-q", "-m", "a"]);
    const out = join(repo, "out");
    mkdirSync(out);
    const run = spawnSync(process.execPath, ["--input-type=module", "-"], {
      cwd: repo, input: receiptWriter, encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: repo, RECEIPT_DIR: out, ...extraEnv },
    });
    const files = existsSync(out) ? spawnSync("ls", [out], { encoding: "utf8" }).stdout.trim().split("\n").filter(Boolean) : [];
    const receipt = files.length === 1 ? JSON.parse(readFileSync(join(out, files[0]), "utf8")) : null;
    return { status: run.status, receipt, files, stdout: run.stdout, head: scratchGitOk(repo, ["rev-parse", "HEAD"]).trim() };
  } finally { rmSync(repo, { recursive: true, force: true }); }
}

test("setup receipt: the workflow's writer emits only allowlisted, validated identity facts and says it is nonqualifying", () => {
  assert.ok(receiptWriter.length > 0, "the workflow carries the receipt writer");
  const r = writeReceipt({
    RECEIPT_SLICE: "3", RECEIPT_PR_HEAD: "a".repeat(40), RECEIPT_RUN_ID: "44535901298", RECEIPT_RUN_ATTEMPT: "1",
    RECEIPT_RUNNER_OS: "macOS", RECEIPT_RUNNER_ARCH: "X64", ImageOS: "macos26", ImageVersion: "20260824.0517.1",
    SECRET_PLANTED: "do-not-copy-this-value",
  });
  assert.equal(r.status, 0);
  assert.deepEqual(r.files, ["mac-pr-setup-receipt-slice-3.json"]);
  const x = r.receipt;
  assert.deepEqual(Object.keys(x), RECEIPT_KEYS, "exactly the allowlisted keys, in order");
  assert.equal(x.kind, "mac-pr-setup-receipt");
  assert.equal(x.status, "PARTIAL_NONQUALIFYING");
  assert.equal(x.qualifying, false);
  assert.equal(x.prHead, "a".repeat(40));
  assert.equal(x.checkout, r.head, "the checkout is read from git, not from the event");
  assert.match(x.tree, /^[0-9a-f]{40}$/);
  assert.equal(x.runId, "44535901298");
  assert.equal(x.runAttempt, "1");
  assert.equal(x.slice, 3);
  assert.equal(x.imageOs, "macos26");
  assert.equal(x.imageVersion, "20260824.0517.1");
  assert.equal(x.runnerVersion, null, "no runner version is guessed");
  assert.match(x.capturedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.deepEqual(x.unknown, RECEIPT_KEYS.filter((k) => x[k] === null), "every null fact is listed as unknown");
  assert.ok(x.unknown.includes("runnerVersion"));
  assert.ok(!JSON.stringify(x).includes("do-not-copy-this-value"), "no other environment value is copied");
  assert.ok(!("v" in x), "no slice-record version field: a receipt can never look like a versioned slice record");
  const claims = Object.entries(x).filter(([k]) => k !== "note");
  assert.ok(!claims.some(([k, v]) => /admission|cleanup|result|pass|success|exit/i.test(k) || /^(?:ok|passed|success)$/i.test(String(v))), "no admission, cleanup or result claim");
});

test("setup receipt: malformed identity values are recorded as unknown, never passed through", () => {
  const r = writeReceipt({
    RECEIPT_SLICE: "9", RECEIPT_PR_HEAD: "not-a-sha", RECEIPT_RUN_ID: "12x", RECEIPT_RUN_ATTEMPT: "0",
    RECEIPT_RUNNER_OS: "mac\nOS", ImageOS: "x".repeat(101),
  });
  assert.equal(r.status, 0);
  assert.deepEqual(r.files, ["mac-pr-setup-receipt-slice-unknown.json"]);
  for (const k of ["slice", "prHead", "runId", "runAttempt", "osName", "imageOs", "imageVersion", "runnerArch"]) {
    assert.equal(r.receipt[k], null, k);
    assert.ok(r.receipt.unknown.includes(k), `${k} is listed as unknown`);
  }
});

test("setup receipt: written and uploaded before the long step, outside the checkout and outside the slice-record namespace", () => {
  const steps = [...workflow.matchAll(/^ {6}- (?:name: (.+)|uses: (.+))$/gm)].map((m) => m[1] ?? m[2]);
  const write = steps.indexOf("Write the setup identity receipt (partial, nonqualifying)");
  const upload = steps.indexOf("Upload the setup identity receipt (partial, nonqualifying)");
  const verify = steps.indexOf("Install and verify under the shared host reservation");
  assert.ok(write >= 0 && upload === write + 1 && verify === upload + 1, `step order: ${JSON.stringify(steps)}`);
  const block = workflow.slice(workflow.indexOf("- name: Upload the setup identity receipt"), workflow.indexOf("- name: Install and verify"));
  assert.match(block, /if: always\(\)/);
  const name = (/^\s+name: (mac-pr-setup-receipt-.+)$/m.exec(block) || [])[1];
  assert.ok(name, "the receipt artifact has its own name");
  assert.ok(!name.startsWith("mac-pr-slice-record-"), "the receipt artifact is outside the slice-record namespace");
  const pattern = (/pattern: (.+)$/m.exec(workflow) || [])[1];
  assert.equal(pattern, "mac-pr-slice-record-${{ github.run_id }}-${{ github.run_attempt }}-*", "the aggregate's download pattern is unchanged");
  const asRegex = new RegExp("^" + pattern.replace(/\$\{\{[^}]*\}\}/g, "X").replace(/[.+?^$()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
  assert.ok(!asRegex.test(name.replace(/\$\{\{[^}]*\}\}/g, "X")), "the aggregate's pattern never matches the receipt");
  assert.match(block, /path: \$\{\{ runner\.temp \}\}\/mac-pr-setup-receipt\//, "the receipt is uploaded from outside the checkout");
});

test("setup receipt: the aggregate refuses it as a slice record, by file name and by record shape", async () => {
  const { aggregate, planOf } = await import("../../../lib/preflight-slice.mjs");
  const plan = planOf([{ name: "one", cmd: ["true"] }, { name: "two", cmd: ["true"] }], "/repo");
  // The receipt as the workflow writes it, given every identity field a slice record would carry.
  const receipt = { ...writeReceipt({ RECEIPT_SLICE: "1", RECEIPT_RUN_ATTEMPT: "1" }).receipt, count: 2, checkout: "b".repeat(40), prHead: null, attempt: null };
  const verdict = aggregate({ records: [receipt, { ...receipt, slice: 2 }], plan, count: 2, checkout: "b".repeat(40), prHead: null, attempt: null, jobResult: "success" });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.problems.some((p) => /is not a version-\d+ slice record/.test(p)), JSON.stringify(verdict.problems));
  assert.ok(verdict.problems.some((p) => /slice 1\/2 left no record/.test(p)), JSON.stringify(verdict.problems));
  // The aggregate reads only preflight-slice-N.json names; a receipt file in its directory is never read.
  const dir = mkdtempSync(join(tmpdir(), "ci-receipt-agg-"));
  try {
    for (const k of [1, 2, 3, 4]) writeFileSync(join(dir, `mac-pr-setup-receipt-slice-${k}.json`), JSON.stringify({ ...receipt, slice: k, count: 4 }));
    const root = join(MAC, "..", "..");
    const run = spawnSync(process.execPath, [join(root, "scripts", "preflight.mjs"), "--aggregate", dir, "--slices", "4", "--jobs-result", "success"], { cwd: root, encoding: "utf8", env: { PATH: process.env.PATH, HOME: process.env.HOME ?? dir } });
    assert.equal(run.status, 1, run.stdout + run.stderr);
    assert.match(run.stderr + run.stdout, /slice 1\/4 left no record/);
    assert.doesNotMatch(run.stdout, /Preflight PASSED/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
