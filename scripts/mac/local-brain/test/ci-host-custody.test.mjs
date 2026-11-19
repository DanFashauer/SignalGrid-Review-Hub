// ci-host-verification.sh: a work timeout must end the step in bounded time WITHOUT giving up the
// host reservation while owned processes are live or cannot be inspected.
//
// Before this regression the wrapper looped for as long as `ps` showed (or could not show) the owned
// group, so a job that hit its work bound could sit until the runner's own job limit and lose its
// logs. The repaired wrapper verifies for a bounded window and then hands the SAME lock (the same
// open file description on FD 9) to a detached custodian, and returns.
//
// Fixtures only: every process signalled here is one this test started. The "survivor" and the
// "inspection failure" are simulated by a stand-in `ps`, substituted into a COPY of the wrapper
// (exactly one "/bin/ps" token, asserted); the copy also shortens the verification window (exactly
// one token, asserted). Normal completion and a clean timeout run the real, unmodified wrapper.
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
const STAMP = /ci-host-verification: \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ \+\d+s /;

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
  return { dir, repo, lock, sha, events, env, inode: statSync(lock).ino };
}

/** Run a wrapper with `body` on stdin; resolves { code, signal, stdout, stderr, ms, timedOut }. */
function runWrapper(f, wrapper, body, { wait = 2, work = 4, limitMs = 20000, onSpawn } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn("/bin/bash", [wrapper, f.sha, String(wait), String(work)], { cwd: f.repo, env: f.env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "", timedOut = false;
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.stdin.end(body);
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ } }, limitMs);
    if (onSpawn) onSpawn(child);
    child.on("exit", (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, ms: Date.now() - started, timedOut }); });
  });
}

/** 0 when the host lock can be taken right now, 75 when another holder has it. */
function probeLock(f) {
  return spawnSync("/bin/bash", ["-c", '. "$1"; sg_host_verify_acquire "$2"', "probe", HELPER, f.lock], { env: f.env, encoding: "utf8" }).status;
}
const sleepMs = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(check, ms) { const end = Date.now() + ms; while (Date.now() < end) { if (check()) return true; await sleepMs(100); } return check(); }
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** A copy of the wrapper whose process inspection is the stand-in `ps` and whose window is 2 s. */
function wrapperWithStandInPs(f) {
  const ctl = join(f.dir, "ps-mode"), pgfile = join(f.dir, "work-pgid"), fake = join(f.dir, "stand-in-ps");
  writeFileSync(fake, `#!/bin/bash\nmode=$(cat ${JSON.stringify(ctl)} 2>/dev/null || echo real)\ncase "$mode" in\n  live) /bin/ps "$@" || exit $?; printf '    1 %s S\\n' "$(cat ${JSON.stringify(pgfile)})";;\n  fail) exit 2;;\n  *) exec /bin/ps "$@";;\nesac\n`);
  chmodSync(fake, 0o755);
  const source = readFileSync(WRAPPER, "utf8");
  const psTokens = source.split('"/bin/ps"').length - 1;
  const windowTokens = source.split("my $verify_seconds = 30;").length - 1;
  const copy = join(f.dir, "wrapper-stand-in.sh");
  writeFileSync(copy, source.replace('"/bin/ps"', JSON.stringify(fake)).replace("my $verify_seconds = 30;", "my $verify_seconds = 2;"));
  return { copy, ctl, pgfile, psTokens, windowTokens };
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
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
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
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

for (const [mode, what] of [["live", "inspection still reports a live owned process after KILL"], ["fail", "inspection itself fails (uncertainty is not an empty group)"]]) {
  test(`work timeout, ${what}: the step returns in bounded time and the SAME lock stays held by a custodian until the group is confirmed empty`, async () => {
    const f = fixture();
    let custodian = 0;
    try {
      const w = wrapperWithStandInPs(f);
      writeFileSync(w.ctl, mode);
      // A sentinel this test owns, outside the work group: nothing may signal it.
      const sentinel = spawn("/bin/sleep", ["60"], { stdio: "ignore" });
      const r = await runWrapper(f, w.copy, `echo $$ > ${JSON.stringify(w.pgfile)}\nsleep 30\n`, { work: 1, limitMs: 20000 });
      assert.equal(r.timedOut, false, `the wrapper did not return: ${r.stderr}`);
      assert.equal(r.code, 124, r.stderr);
      assert.ok(r.ms < 15000, `took ${r.ms} ms`);
      assert.match(r.stderr, /cleanup unconfirmed; retaining host reservation/);
      const m = /reservation retained by custodian pid (\d+)/.exec(r.stderr);
      assert.ok(m, r.stderr);
      custodian = Number(m[1]);
      assert.ok(alive(custodian), "the custodian is running");
      assert.equal(probeLock(f), 75, "another chain must not be admitted while cleanup is unconfirmed");
      assert.equal(statSync(f.lock).ino, f.inode, "the same persistent lock file");
      assert.ok(readFileSync(f.events, "utf8").endsWith("teardown\n"), "teardown still ran");
      assert.ok(alive(sentinel.pid), "a process outside the owned group was not signalled");
      // Inspection becomes real again: the owned group IS empty, so custody ends by itself.
      writeFileSync(w.ctl, "real");
      assert.ok(await until(() => !alive(custodian), 8000), "the custodian exits once the group is confirmed empty");
      assert.ok(await until(() => probeLock(f) === 0, 3000), "the lock is free after custody ends");
      assert.equal(statSync(f.lock).ino, f.inode);
      assert.ok(alive(sentinel.pid));
      sentinel.kill("SIGKILL");
      assert.equal(w.psTokens, 1, "the wrapper inspects processes through exactly one /bin/ps token");
      assert.equal(w.windowTokens, 1, "the wrapper declares exactly one verification window");
    } finally {
      if (custodian && alive(custodian)) { try { process.kill(custodian, "SIGKILL"); } catch { /* gone */ } }
      rmSync(f.dir, { recursive: true, force: true });
    }
  });
}

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
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
