// One local attempt store shared by every linked checkout; never a dependency cache.
// Initialize separately after preserving old receipts and verifying no old attempt is in flight.
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, ftruncateSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export function deliveryRecordDirectory(root, initialize = false) {
  const env = { ...process.env };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR"]) delete env[key];
  const git = spawnSync("git", ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"], { cwd: root, env, encoding: "utf8" });
  const lines = git.stdout?.trim().split("\n");
  if (git.status !== 0 || lines?.length !== 2 || realpathSync(lines[0]) !== realpathSync(root)) throw Error("cannot bind delivery store to this checkout");
  const common = realpathSync(lines[1]);
  const directory = join(common, "signalgrid-lane-records");
  const marker = directory + ".json";
  if (initialize) {
    // No recursive mkdir, overwrite or recovery fallback: partial initialization stays held.
    mkdirSync(directory, { mode: 0o700 });
    const st = lstatSync(directory);
    writeFileSync(marker, JSON.stringify({ version: 1, directory, dev: st.dev, ino: st.ino }) + "\n", { flag: "wx", mode: 0o600, flush: true });
    initializeTickGuard(directory, st);
  }
  const fd = openSync(marker, constants.O_RDONLY | constants.O_NOFOLLOW);
  let record;
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1) throw Error("delivery store marker must be an owned regular file");
    record = JSON.parse(readFileSync(fd, "utf8"));
  } finally { closeSync(fd); }
  const st = lstatSync(directory);
  if (record.version !== 1 || record.directory !== directory || !st.isDirectory() || record.dev !== st.dev || record.ino !== st.ino) throw Error("delivery store missing, replaced or incompatible; preserve evidence, readback only");
  return directory;
}

// The tick must recover on its own (owner, 2026-11-01), but only a store that does
// not exist at all is initialized automatically. A directory without its marker, or
// a marker without its directory, is never reset: it stays held, naming the path.
export function ensureDeliveryRecordDirectory(root) {
  try { return deliveryRecordDirectory(root); } catch (first) {
    const env = { ...process.env };
    for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR"]) delete env[key];
    const common = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: root, env, encoding: "utf8" });
    if (common.status !== 0) throw first;
    const directory = join(realpathSync(common.stdout.trim()), "signalgrid-lane-records");
    // Serialize check + init across concurrent ticks with an O_EXCL lock beside the
    // store that names its creator (pid + process start time). A lock is taken over
    // only when that creator is positively gone (ESRCH, or its PID now belongs to a
    // process with another start time), never by age; a live creator is waited on,
    // then held. We unlink only the lock inode we created, never a replacement's.
    const lock = directory + ".init.lock", waitMs = Number(process.env.SIGNALGRID_INIT_LOCK_WAIT_MS ?? 15000);
    let ownIno = null;
    for (let waited = 0; ; waited += 100) {
      try {
        const fd = openSync(lock, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        try { writeFileSync(fd, JSON.stringify({ pid: process.pid, startMs: startEpochOf(process.pid) }) + "\n"); ownIno = fstatSync(fd).ino; } finally { closeSync(fd); }
        break;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        let held;
        try {
          const fd = openSync(lock, constants.O_RDONLY | constants.O_NOFOLLOW);
          try { held = { ino: fstatSync(fd).ino, holder: JSON.parse(readFileSync(fd, "utf8")) }; } catch { held = null; } finally { closeSync(fd); }
        } catch (gone) { if (gone.code === "ENOENT") continue; throw gone; }
        if (held && initLockHolderGone(held.holder)) {
          try { if (lstatSync(lock).ino === held.ino) unlinkSync(lock); } catch (gone) { if (gone.code !== "ENOENT") throw gone; }
          continue;
        }
        if (waited >= waitMs) throw Error(`store initialization lock ${lock} is held by ${held ? "live pid " + held.holder.pid : "an unreadable owner"}; holding`);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
      }
    }
    try {
      try { return deliveryRecordDirectory(root); } catch { /* still uninitialized: decide under the lock */ }
      let markerPresent = true;
      try { lstatSync(directory + ".json"); } catch (error) { if (error.code !== "ENOENT") throw error; markerPresent = false; }
      if (markerPresent) throw first; // a damaged marker stays held
      let directoryPresent = true;
      try { lstatSync(directory); } catch (error) { if (error.code !== "ENOENT") throw error; directoryPresent = false; }
      if (directoryPresent) throw Error(`store directory ${directory} exists without its marker; held, never reset automatically`);
      return deliveryRecordDirectory(root, true);
    } finally {
      try { if (lstatSync(lock).ino === ownIno) unlinkSync(lock); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }
}

function initLockHolderGone(holder) {
  if (!holder || !Number.isSafeInteger(holder.pid) || holder.pid <= 0) return false;
  try { process.kill(holder.pid, 0); } catch (error) { if (error.code === "ESRCH") return true; if (error.code !== "EPERM") return false; }
  const now = startEpochOf(holder.pid);
  return Number.isFinite(holder.startMs) && now !== null && now > holder.startMs; // started later: a reused PID
}

// This guard is persistent. Closing the owned FD releases the kernel lock;
// neither a PID observation nor a pathname deletion releases a tick lifetime.
const TICK_FD = 8;
const GUARD_BYTES = Buffer.from("SignalGrid tick serialization guard v1\n");
const TOKEN = /^[0-9a-f]{32}$/;
const HASH = /^[0-9a-f]{64}$/;
const identity = (st) => ({ dev: st.dev, ino: st.ino });
const sameIdentity = (a, b) => a?.dev === b?.dev && a?.ino === b?.ino;
const digest = (raw) => createHash("sha256").update(raw).digest("hex");
const encoded = (value) => Buffer.from(JSON.stringify(value) + "\n");

class TickBusy extends Error {}

function ownRegular(st) {
  if (!st.isFile() || st.nlink !== 1 || (typeof process.getuid === "function" && st.uid !== process.getuid())) {
    throw Error("tick record must be an owned unique regular file");
  }
}

function sameRead(a, b) {
  return ["dev", "ino", "size", "mtimeMs", "ctimeMs"].every((key) => a[key] === b[key]);
}

function readTickBytes(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    ownRegular(before);
    if (before.size > 32768) throw Error("tick record exceeds its bound");
    const raw = readFileSync(fd);
    if (!sameRead(before, fstatSync(fd)) || raw.length !== before.size) throw Error("tick record changed during read");
    return { raw, info: before };
  } finally { closeSync(fd); }
}

function readTickJson(path) {
  const record = readTickBytes(path);
  record.value = JSON.parse(record.raw.toString("utf8"));
  // Owned writers use one canonical representation. Ambiguous duplicate keys,
  // partial writes and out-of-band rewrites are held, never normalized in place.
  if (!encoded(record.value).equals(record.raw)) throw Error("tick record is not its exact owned representation");
  return record;
}

function writeTickJson(path, value, previous = null) {
  const raw = encoded(value);
  const flags = constants.O_WRONLY | constants.O_NOFOLLOW | (previous ? 0 : constants.O_CREAT | constants.O_EXCL);
  const fd = openSync(path, flags, 0o600);
  try {
    const st = fstatSync(fd);
    ownRegular(st);
    if (previous && !sameRead(previous.info, st)) throw Error("tick slot was replaced before write");
    ftruncateSync(fd, 0);
    writeFileSync(fd, raw);
    fsyncSync(fd);
  } finally { closeSync(fd); }
  const actual = readTickJson(path);
  if (!actual.raw.equals(raw)) throw Error("tick record durable readback differs");
  return actual;
}

function keysExactly(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join("\n") !== [...keys].sort().join("\n")) throw Error("tick record schema differs");
}

function validIdentity(value) {
  keysExactly(value, ["dev", "ino"]);
  if (![value.dev, value.ino].every((n) => Number.isSafeInteger(n) && n >= 0)) throw Error("invalid tick object identity");
}

function assertBinding(value, binding) {
  validIdentity(value.store);
  validIdentity(value.guard);
  if (value.version !== 1 || value.directory !== binding.directory ||
      !sameIdentity(value.store, binding.store) || !sameIdentity(value.guard, binding.guard)) {
    throw Error("tick record belongs to a different store or guard");
  }
}

function initializeTickGuard(directory, store) {
  const guardPath = join(directory, "tick.guard");
  writeFileSync(guardPath, GUARD_BYTES, { flag: "wx", mode: 0o600, flush: true });
  const binding = { version: 1, directory, store: identity(store), guard: identity(lstatSync(guardPath)) };
  writeTickJson(join(directory, "tick.guard.json"), binding);
  writeTickJson(join(directory, "tick.slot.json"), { ...binding, state: "READY" });
}

// Guard capacity alone is not cleanup: a descendant may have closed FD8 and kept
// running. Recovery needs positive evidence that the original tick is gone: its
// shell PID is dead (ESRCH; alive or EPERM holds) and, when its owner record names
// a process group other than ours, that group is empty. launchd runs the tick from
// ~/Library/LaunchAgents/com.signalgrid.lane-tick.plist, which sets no
// AbandonProcessGroup key, so launchd's default (false) applies: when a tick job
// exits, launchd kills its whole process group.
function processGroupOf(pid) {
  const r = spawnSync("ps", ["-o", "pgid=", "-p", String(pid)], { encoding: "utf8" });
  const pgid = Number(r.stdout?.trim());
  return r.status === 0 && Number.isSafeInteger(pgid) && pgid > 0 ? pgid : null;
}
// Descendants (objective-loop publishers, sim-request commands, lane-deliver) do not
// hold FD8, so they are looked for directly: any process left in the recorded group
// (when it is not our own), naming the old token, or running in a lane-deliver
// worktree (sg-lane-deliver-*) holds recovery.
//
// A PID or group survives a reboot only as a number: when the owner record carries
// the shell's start time, a live PID that started strictly LATER is a reused PID (the
// original is dead), and only processes started at or after it can belong to the
// original tick. Start times are always read as `ps lstart` under LC_ALL=C TZ=UTC0
// and compared as epochs, so a TZ change between ticks can never fake a reuse.
const PS_ENV = { ...process.env, LC_ALL: "C", TZ: "UTC0" };
const LSTART = /^\w{3} \w{3}\s+\d+ \d\d:\d\d:\d\d \d{4}$/;
export const lstartEpoch = (lstart) => {
  const text = String(lstart).trim().replace(/\s+/g, " ");
  return LSTART.test(text) ? Date.parse(text + " UTC") : NaN;
};
const startEpochOf = (pid) => {
  const r = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", env: PS_ENV });
  const ms = r.status === 0 ? lstartEpoch(r.stdout) : NaN;
  return Number.isFinite(ms) ? ms : null;
};
const recordedEpoch = (iso) => (typeof iso === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(iso) ? Date.parse(iso) : NaN);
function assertOriginalGone(shellPid, { pgid = null, token = null, shellStart = null, openedMs = null } = {}) {
  // An unparseable recorded start degrades to PID-only liveness (never a silent exit).
  const recorded = Number.isFinite(recordedEpoch(shellStart)) ? recordedEpoch(shellStart) : null;
  let alive = true, code = null;
  try { process.kill(shellPid, 0); } catch (error) { alive = false; code = error.code; }
  if (alive || code === "EPERM") {
    const now = recorded === null ? null : startEpochOf(shellPid);
    if (!(now !== null && now > recorded)) throw Error(alive ? `original tick shell ${shellPid} (started ${recorded === null ? "unrecorded" : new Date(recorded).toISOString()}) is still alive; holding` :
      `original tick shell ${shellPid} liveness is unknown (${code}); holding`);
  } else if (code !== "ESRCH") throw Error(`original tick shell ${shellPid} liveness is unknown (${code}); holding`);
  if (pgid === null && token === null) return;
  // Without a recorded start, the OPEN slot's write time (less 1 s for lstart's
  // resolution) bounds when the original tick's descendants can have started.
  const own = processGroupOf(process.pid), since = recorded ?? (Number.isFinite(openedMs) ? Math.floor(openedMs / 1000) * 1000 - 1000 : -Infinity);
  const ps = spawnSync("ps", ["-eo", "pid=,ppid=,pgid=,lstart=,command="], { encoding: "utf8", env: PS_ENV, maxBuffer: 64 * 1024 * 1024 });
  if (ps.error || ps.signal || ps.status !== 0 || own === null) throw Error("process table is unreadable; holding");
  const table = new Map();
  for (const line of ps.stdout.split("\n")) {
    if (!line.trim()) continue;
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\w{3} \w{3}\s+\d+ \d\d:\d\d:\d\d \d{4})\s(.*)$/.exec(line), started = m ? lstartEpoch(m[4]) : NaN;
    // Never echo a process line: argv can carry credentials, and this text is published.
    if (!m || !Number.isFinite(started)) throw Error("a process table line is unparseable; holding");
    table.set(Number(m[1]), { ppid: Number(m[2]), group: Number(m[3]), started, command: m[5] });
  }
  // A lane-deliver worktree process counts only when its whole ancestry started at or
  // after the original tick until it reaches pid 1 (orphaned with that tick): a live
  // delivery of another session or lane has an older living ancestor.
  const orphanedSince = (pid) => {
    for (let hops = 0; pid > 1 && hops < 64; hops++) {
      const row = table.get(pid);
      if (!row) return true; // unknown ancestry: fail closed
      if (!(row.started >= since)) return false;
      pid = row.ppid;
    }
    return true;
  };
  for (const [pid, { group, started, command }] of table) {
    if (pid === process.pid) continue;
    if (!(started >= since)) continue; // started before the original tick: not its descendant
    const worktree = command.includes("sg-lane-deliver-") && orphanedSince(pid);
    if ((pgid !== null && group === pgid && pgid !== own) || (token && command.includes(token)) || worktree) {
      // Publishable fields only: pid, group, start and the program's basename; never its
      // arguments (live-lane scripts pass Authorization headers to curl in argv).
      const program = (command.trim().split(/\s+/)[0] ?? "").split("/").pop().replace(/[^A-Za-z0-9._+-]/g, "?").slice(0, 40);
      throw Error(`process ${pid} (program ${program || "unknown"}, group ${group}, started ${new Date(started).toISOString()}${worktree ? ", in a lane-deliver worktree" : ""}) of the original tick (group ${pgid ?? "unrecorded"}, started ${recorded === null ? "unrecorded" : new Date(recorded).toISOString()}) may survive; holding`);
    }
  }
}

// Called only while this tick holds the kernel guard: an old tick.lock whose
// recorded PID is positively dead is renamed aside (kept), never deleted.
function setAsideLegacyTickLock(directory, stamp) {
  const legacy = join(directory, "tick.lock");
  try { lstatSync(legacy); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
  let pid = NaN;
  try { pid = Number(readFileSync(join(legacy, "pid"), "utf8").trim()); } catch { /* no recorded holder */ }
  if (!Number.isSafeInteger(pid) || pid <= 0) throw Error("legacy tick.lock names no holder PID; no positive evidence it is gone; holding");
  assertOriginalGone(pid);
  const aside = `tick.lock.abandoned-${stamp}-${randomBytes(4).toString("hex")}`;
  renameSync(legacy, join(directory, aside));
  return `legacy tick.lock moved aside to ${aside}`;
}

function tickBinding(root) {
  const directory = deliveryRecordDirectory(root);
  const marker = readTickJson(join(directory, "tick.guard.json")).value;
  keysExactly(marker, ["version", "directory", "store", "guard"]);
  validIdentity(marker.store);
  validIdentity(marker.guard);
  if (marker.version !== 1 || marker.directory !== directory || !sameIdentity(marker.store, identity(lstatSync(directory)))) {
    throw Error("tick guard store identity differs");
  }
  const guardPath = join(directory, "tick.guard");
  const guard = readTickBytes(guardPath);
  if (!sameIdentity(marker.guard, identity(guard.info)) || !guard.raw.equals(GUARD_BYTES)) throw Error("tick guard is missing, replaced or changed");
  return { ...marker, guardPath };
}

function assertInheritedGuard(binding) {
  const inherited = fstatSync(TICK_FD);
  ownRegular(inherited);
  if (!sameIdentity(identity(inherited), binding.guard)) throw Error("FD8 is not the original tick guard");
}

function originalTickBinding(root, binding) {
  const current = tickBinding(root);
  if (current.directory !== binding.directory || !sameIdentity(current.store, binding.store) ||
      !sameIdentity(current.guard, binding.guard)) throw Error("original tick store or guard was replaced");
  assertInheritedGuard(current);
  return current;
}

function ownedGuard(root, shellPid) {
  if (!/^[1-9][0-9]*$/.test(String(shellPid))) throw Error("actual original shell PID required");
  const pid = Number(shellPid);
  if (!Number.isSafeInteger(pid) || process.ppid !== pid) throw Error("tick helper is not a child of its original shell");
  const binding = tickBinding(root);
  assertInheritedGuard(binding);
  const lock = spawnSync("perl", ["-MFcntl=:flock", "-e",
    'open(my $lock, "<&=8") or exit 2; if (!flock($lock, LOCK_EX|LOCK_NB)) { exit(($!{EWOULDBLOCK} || $!{EAGAIN}) ? 75 : 2); }'],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe", "ignore", "ignore", "ignore", "ignore", "ignore", TICK_FD] });
  if (lock.status === 75) throw new TickBusy("another current tick owns the kernel guard");
  if (lock.error || lock.signal || lock.status !== 0) throw Error("tick kernel guard could not be verified");
  originalTickBinding(root, binding);
  return { binding, shellPid: pid };
}

const BASE_KEYS = ["version", "directory", "store", "guard", "state"];
const OPEN_KEYS = [...BASE_KEYS, "token", "shellPid", "openedSha256"];
const OWNER_KEYS = [...BASE_KEYS, "token", "shellPid", "openedAt"];
const ownerKeys = (value) => [...OWNER_KEYS, ...["pgid", "shellStart"].filter((key) => value && Object.hasOwn(value, key))];
const TERMINAL_KEYS = [...BASE_KEYS, "token", "shellPid", "openedSha256", "exitTrapStatus", "closedAt"];

// An ABANDONED tick may have died before publishing its owner record.
function readOwnerRecord(binding, token, abandoned) {
  try { return readTickJson(join(binding.directory, `tick-${token}.opened.json`)); }
  catch (error) { if (abandoned && error.code === "ENOENT") return null; throw error; }
}

function assertOwner(record, binding, token, shellPid) {
  keysExactly(record.value, ownerKeys(record.value));
  assertBinding(record.value, binding);
  if (Object.hasOwn(record.value, "pgid") && (!Number.isSafeInteger(record.value.pgid) || record.value.pgid <= 0)) throw Error("tick owner process group is invalid");
  if (record.value.state !== "OPEN" || record.value.token !== token || record.value.shellPid !== shellPid ||
      typeof record.value.openedAt !== "string" || !Number.isFinite(Date.parse(record.value.openedAt))) throw Error("tick owner record differs");
}

function readSlot(binding) {
  const slot = readTickJson(join(binding.directory, "tick.slot.json"));
  assertBinding(slot.value, binding);
  if (slot.value.state === "READY") {
    keysExactly(slot.value, BASE_KEYS);
    // Token-bound owner records only (tick-<token>.*); tick-hold-* notices are not owners.
    if (readdirSync(binding.directory).some((name) => /^tick-[0-9a-f]{32}\./.test(name))) throw Error("READY tick slot has earlier owner evidence");
    return slot;
  }
  if (slot.value.state === "OPEN") return slot; // acquireTick recovers it under the kernel guard
  if (slot.value.state !== "CLOSED") throw Error("unknown tick slot state");
  keysExactly(slot.value, [...OPEN_KEYS, "terminalSha256"]);
  const { token, shellPid, openedSha256, terminalSha256 } = slot.value;
  if (!TOKEN.test(token) || !Number.isSafeInteger(shellPid) || shellPid <= 0 || !HASH.test(openedSha256) || !HASH.test(terminalSha256)) throw Error("closed tick slot identity is invalid");
  const terminal = readTickJson(join(binding.directory, `tick-${token}.terminal.json`));
  keysExactly(terminal.value, TERMINAL_KEYS);
  assertBinding(terminal.value, binding);
  // ABANDONED: an interrupted tick recovered by a later guard holder. Its owner
  // record may never have been published; when present it must still match.
  const abandoned = terminal.value.state === "ABANDONED";
  const owner = readOwnerRecord(binding, token, abandoned);
  if (owner) assertOwner(owner, binding, token, shellPid);
  if ((owner && digest(owner.raw) !== openedSha256) || digest(terminal.raw) !== terminalSha256 || !(abandoned || terminal.value.state === "CLOSED") ||
      terminal.value.token !== token || terminal.value.shellPid !== shellPid || terminal.value.openedSha256 !== openedSha256 ||
      (abandoned ? terminal.value.exitTrapStatus !== null :
        !Number.isInteger(terminal.value.exitTrapStatus) || terminal.value.exitTrapStatus < 0 || terminal.value.exitTrapStatus >= 128) ||
      typeof terminal.value.closedAt !== "string" || !Number.isFinite(Date.parse(terminal.value.closedAt))) throw Error("closed tick terminal is not its exact owner result");
  return slot;
}

// Holding the kernel guard proves no process still holds the interrupted tick's
// FD8, so its OPEN lifetime is over. Record exactly that, then CLOSE the slot.
function recoverOpenSlot(binding, slot, stamp) {
  keysExactly(slot.value, OPEN_KEYS);
  const { token, shellPid, openedSha256 } = slot.value;
  if (!TOKEN.test(token) || !Number.isSafeInteger(shellPid) || shellPid <= 0 || !HASH.test(openedSha256)) throw Error("open tick slot identity is invalid");
  const owner = readOwnerRecord(binding, token, true); // null: interrupted before its owner record
  if (owner) {
    assertOwner(owner, binding, token, shellPid);
    if (digest(owner.raw) !== openedSha256) throw Error("abandoned tick owner bytes differ");
  }
  assertOriginalGone(shellPid, { pgid: owner?.value.pgid ?? null, token, shellStart: owner?.value.shellStart ?? null, openedMs: slot.info?.mtimeMs ?? null });
  const terminalPath = join(binding.directory, `tick-${token}.terminal.json`);
  let actual;
  try { actual = readTickJson(terminalPath); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (actual) {
    // Interrupted between a terminal (its own CLOSED, or an earlier recovery's
    // ABANDONED) and the slot write: close onto that exact terminal.
    keysExactly(actual.value, TERMINAL_KEYS);
    assertBinding(actual.value, binding);
    const st = actual.value.state;
    if (!(st === "CLOSED" || (st === "ABANDONED" && actual.value.exitTrapStatus === null)) || actual.value.token !== token ||
        actual.value.shellPid !== shellPid || actual.value.openedSha256 !== openedSha256) throw Error("open tick has a foreign terminal");
  } else {
    actual = writeTickJson(terminalPath, { version: 1, directory: binding.directory, store: binding.store, guard: binding.guard,
      state: "ABANDONED", token, shellPid, openedSha256, exitTrapStatus: null, closedAt: new Date().toISOString() });
  }
  writeTickJson(join(binding.directory, "tick.slot.json"), { ...slot.value, state: "CLOSED", terminalSha256: digest(actual.raw) }, slot);
  return { slot: readSlot(binding), note: `abandoned tick ${token} (shell ${shellPid}) recorded ABANDONED and closed at ${stamp}` };
}

export function tickGuardPath(root) { return tickBinding(root).guardPath; }

// Recheck the actual current Bash lease before a DIFFERENT notification. This
// reads original OPEN evidence; it never admits/finalizes a tick or grants work.
export function checkTickOwner(root, token, shellPid) {
  if (typeof token !== "string" || !TOKEN.test(token)) throw Error("exact active tick token required");
  const { binding, shellPid: pid } = ownedGuard(root, shellPid);
  const slot = readTickJson(join(binding.directory, "tick.slot.json"));
  keysExactly(slot.value, OPEN_KEYS);
  assertBinding(slot.value, binding);
  if (slot.value.state !== "OPEN" || slot.value.token !== token || slot.value.shellPid !== pid || !HASH.test(slot.value.openedSha256)) {
    throw Error("notification has no exact active original tick");
  }
  const owner = readTickJson(join(binding.directory, `tick-${token}.opened.json`));
  assertOwner(owner, binding, token, pid);
  if (digest(owner.raw) !== slot.value.openedSha256) throw Error("active tick owner bytes differ");
  originalTickBinding(root, binding);
  return Object.freeze({ directory: binding.directory, token, shellPid: pid,
    store: Object.freeze({ ...binding.store }), guard: Object.freeze({ ...binding.guard }),
    openedSha256: slot.value.openedSha256 });
}

export function acquireTick(root, shellPid, pgid = null, shellStart = null) {
  if (pgid !== null && !/^[1-9][0-9]*$/.test(String(pgid))) throw Error("tick process group must be a positive integer");
  // Stored as an ISO UTC instant; an unreadable lstart is simply not recorded (PID-only liveness).
  const startIso = shellStart === null || !Number.isFinite(lstartEpoch(shellStart)) ? null : new Date(lstartEpoch(shellStart)).toISOString();
  const owned = ownedGuard(root, shellPid);
  const { binding } = owned;
  const stamp = new Date().toISOString().replace(/[:.]/g, "");
  const recovered = [setAsideLegacyTickLock(binding.directory, stamp)];
  let slot = readSlot(binding);
  if (slot.value.state === "OPEN") { const r = recoverOpenSlot(binding, slot, stamp); slot = r.slot; recovered.push(r.note); }
  acquireTick.recovered = recovered.filter(Boolean);
  const token = randomBytes(16).toString("hex");
  const base = { version: 1, directory: binding.directory, store: binding.store, guard: binding.guard };
  const owner = { ...base, state: "OPEN", token, shellPid: owned.shellPid, openedAt: new Date().toISOString(),
    ...(pgid === null ? {} : { pgid: Number(pgid) }), ...(startIso === null ? {} : { shellStart: startIso }) };
  const open = { ...base, state: "OPEN", token, shellPid: owned.shellPid, openedSha256: digest(encoded(owner)) };
  // OPEN is committed first. A failed/missing immutable owner never becomes a
  // fresh first run, even if this process and the kernel lock later disappear.
  writeTickJson(join(binding.directory, "tick.slot.json"), open, slot);
  writeTickJson(join(binding.directory, `tick-${token}.opened.json`), owner);
  originalTickBinding(root, binding);
  if (!readTickJson(join(binding.directory, "tick.slot.json")).raw.equals(encoded(open))) throw Error("tick ownership changed before admission");
  return token;
}

// CLOSED records only the original authorized lease's EXIT finalization.
// exitTrapStatus is the status entering that trap, not an actual parent wait.
// It proves no task acceptance, provider quiet or permission to retry old work.
export function releaseTick(root, token, shellPid, exitTrapStatus) {
  if (!TOKEN.test(token) || !/^(0|[1-9][0-9]*)$/.test(String(exitTrapStatus))) throw Error("exact tick owner and EXIT finalization status required");
  const code = Number(exitTrapStatus);
  if (!Number.isInteger(code) || code < 0 || code >= 128) throw Error("interrupted tick cannot close its OPEN lifetime");
  const { binding, shellPid: pid } = ownedGuard(root, shellPid);
  const slot = readTickJson(join(binding.directory, "tick.slot.json"));
  keysExactly(slot.value, OPEN_KEYS);
  assertBinding(slot.value, binding);
  if (slot.value.state !== "OPEN" || slot.value.token !== token || slot.value.shellPid !== pid || !HASH.test(slot.value.openedSha256)) throw Error("only the exact original tick may release its OPEN lifetime");
  const owner = readTickJson(join(binding.directory, `tick-${token}.opened.json`));
  assertOwner(owner, binding, token, pid);
  if (digest(owner.raw) !== slot.value.openedSha256) throw Error("original tick owner bytes differ");
  const terminal = { version: 1, directory: binding.directory, store: binding.store, guard: binding.guard,
    state: "CLOSED", token, shellPid: pid, openedSha256: slot.value.openedSha256, exitTrapStatus: code, closedAt: new Date().toISOString() };
  const actual = writeTickJson(join(binding.directory, `tick-${token}.terminal.json`), terminal);
  const current = originalTickBinding(root, binding);
  writeTickJson(join(binding.directory, "tick.slot.json"), { ...slot.value, state: "CLOSED", terminalSha256: digest(actual.raw) }, slot);
  readSlot(current);
}

// A refused original (lane-deliver exit 1/2) may be retried only on a readback
// that proves nothing was published. lane-deliver writes its receipt, naming the
// random target branch, immediately before its one push, so no receipt means no
// push. With a receipt, the target ref is read on origin: present -> "published"
// (readback-only, never resent); absent -> "unpublished" (retry); unreadable or
// unnamed -> "unknown" (hold). A failed read is never taken as absence.
// Network and ledger reads never inherit the tick guard (FD8): fds 3-8 are closed in
// the child. Only the hold's lane-deliver child keeps FD8 (raiseTickHold).
const NO_GUARD_PIPED = ["ignore", "pipe", "pipe", "ignore", "ignore", "ignore", "ignore", "ignore", "ignore"];
const NO_GUARD_SILENT = ["ignore", "ignore", "ignore", "ignore", "ignore", "ignore", "ignore", "ignore", "ignore"];
// Same shape as lane-tick.sh's sg_run_bounded: the command runs in its own session,
// and at the limit its WHOLE group (ssh, credential helpers) gets TERM, then KILL.
const GROUP_BOUNDED = `my $limit = shift; my $pid = fork; exit 125 unless defined $pid;
if (!$pid) { POSIX::setsid(); exec @ARGV or POSIX::_exit(127); }
$SIG{ALRM} = sub { kill "TERM", -$pid; sleep 2; kill "KILL", -$pid; waitpid($pid, 0); exit 124 };
alarm $limit; waitpid($pid, 0); my $status = $?; alarm 0;
exit(($status & 127) ? 128 + ($status & 127) : $status >> 8);`;
export function refusedDisposition(root, receiptPath) {
  let raw;
  try { raw = readFileSync(receiptPath, "utf8"); } catch (error) { return error.code === "ENOENT" ? "unpublished" : "unknown"; }
  let target;
  try { target = JSON.parse(raw).target; } catch { return "unknown"; }
  if (typeof target !== "string" || !/^lane\/[a-z]+-mail-[0-9]{8}-[0-9]{6}Z-[a-f0-9]{12}$/.test(target)) return "unknown";
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR"]) delete env[key];
  const limit = /^[1-9][0-9]*$/.test(process.env.SIGNALGRID_LS_REMOTE_TIMEOUT_SEC ?? "") ? Number(process.env.SIGNALGRID_LS_REMOTE_TIMEOUT_SEC) : 60;
  const r = spawnSync("perl", ["-MPOSIX", "-e", GROUP_BOUNDED, String(limit), "git", "ls-remote", "origin", "refs/heads/" + target],
    { cwd: root, env, encoding: "utf8", timeout: (limit + 10) * 1000, stdio: NO_GUARD_PIPED });
  if (r.error || r.signal || r.status !== 0) return "unknown";
  return r.stdout.trim() ? "published" : "unpublished";
}

// The one rule for every refused-attempt retry branch (build-tick, objective-loop,
// heartbeat, lane-repair notice, pending-heartbeat notice). A refusal (lane-deliver
// exit 1/2, or a killed attempt with no exit) is retried only when refusedDisposition
// proves nothing was published. Two shapes:
//
// - An ORIGINAL attempt (hand-*, objective-*, .sg-heartbeat-*) may already have
//   repair DATA bound to its prefix, so it is never touched. It is marked with
//   refused/<name>.retried ({ root, n, successor }) and the retry runs under its own
//   prefix: `successor` names it ("derive" -> <kind>-sha256(<name>:retry), still a
//   supported lane-repair identity). Callers follow the marker chain to its head.
// - A NOTICE (a lane-repair or pending-heartbeat notification, `successor` "move")
//   is consumed by any file under its id, and no repair DATA reads its files, so
//   its files move byte-identical to refused/<name>.refused-<n>.* (link+unlink:
//   never overwritten) and the same id is retried.
//
// raise-hand's "<id> already exists" (exit 2) means the hand is already on the
// Hub: { done: true }, never retried. After MAX_REFUSED_RETRIES retries of one
// cause the next refusal holds instead, visibly (DR-054): refused/<root>.capped
// records the count, lane-tick's heartbeat RESULT carries `refused:<root> x<n>`,
// and the caller's held path queues the repair. Deterministic: no clock or randomness.
export const MAX_REFUSED_RETRIES = 3;
function attemptText(directory, name) {
  let text = "";
  for (const suffix of [".output", ".terminal.json"]) {
    try { text += readFileSync(join(directory, name + suffix), "utf8").slice(0, 1024 * 1024); } catch { /* absent */ }
  }
  return text;
}
function retriedMarkers(refused) {
  const out = [];
  let names = [];
  try { names = readdirSync(refused); } catch (error) { if (error.code !== "ENOENT") throw error; }
  for (const file of names) {
    if (!file.endsWith(".retried")) continue;
    out.push({ name: file.slice(0, -".retried".length), ...JSON.parse(readFileSync(join(refused, file), "utf8")) });
  }
  return out;
}
// The current head of an original attempt's retry chain (itself when never retried).
export function retryHead(directory, name) {
  const markers = new Map(retriedMarkers(join(directory, "refused")).map((m) => [m.name, m]));
  for (let hops = 0; markers.has(name); hops++) {
    if (hops > MAX_REFUSED_RETRIES + 1) throw Error("retry chain does not terminate");
    name = markers.get(name).successor;
  }
  return name;
}
function cap(refused, root, count) {
  try { writeFileSync(join(refused, root + ".capped"), `${count}\n`, { flag: "wx", mode: 0o600 }); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  return null;
}
// The Hub-side state of a raised hand: its ledger file on origin/SignalGrid_Alpha
// (lane-deliver fetched it just before raise-hand ran). "resolved" | "open" | "absent"
// (not on mainline yet: a pending PR) | "unknown" (unreadable: hold).
export function handLedgerStatus(root, id) {
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(id)) return "unknown";
  const env = { ...process.env };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR"]) delete env[key];
  const r = spawnSync("git", ["show", `origin/SignalGrid_Alpha:artifacts/raised-hands/${id}.json`], { cwd: root, env, encoding: "utf8", timeout: 60000, stdio: NO_GUARD_PIPED });
  if (r.status !== 0) return /does not exist|exists on disk, but not in/.test(r.stderr ?? "") ? "absent" : "unknown";
  try { return JSON.parse(r.stdout).status === "resolved" ? "resolved" : "open"; } catch { return "unknown"; }
}
export function setAsideRefusedAttempt(root, directory, name, exit, successor = "move") {
  // raise-hand's "<id> already exists" (exit 2, before any push): done only while that
  // hand is still open (or pending) on the Hub. A resolved hand whose cause recurs is
  // raised again under a new id (`reraise`: the caller appends -again-<n>).
  let reraise = false;
  const exists = String(exit) === "2" ? /raise-hand: (\S+) already exists/.exec(attemptText(directory, name)) : null;
  if (exists) {
    const status = handLedgerStatus(root, exists[1]);
    if (status === "unknown") return null;
    if (status !== "resolved") return { done: true, attempt: name };
    reraise = true;
  } else {
    // A push terminal means lane-deliver reached its push and Git reported a remote
    // refusal (a repository rule): resending the same cannot pass. That keeps the
    // existing readback -> Cloud repair-hand path (LANE_COORDINATION.md L51).
    try { lstatSync(join(directory, name + ".submission.json.push.json")); return null; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (refusedDisposition(root, join(directory, name + ".submission.json")) !== "unpublished") return null;
  }
  const refused = join(directory, "refused");
  mkdirSync(refused, { recursive: true, mode: 0o700 });
  const code = /^[0-9]+$/.test(String(exit)) ? Number(exit) : null;
  if (successor !== "move") {
    const markerPath = join(refused, name + ".retried");
    let existing = null;
    try { existing = JSON.parse(readFileSync(markerPath, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
    // Already marked: if its retry started, the caller follows the chain; if it never
    // started (killed before its intent), re-point the same retry (no extra count).
    if (existing && readdirSync(directory).some((file) => file.startsWith(existing.successor + "."))) return null;
    const prior = existing ?? retriedMarkers(refused).find((m) => m.successor === name);
    const chainRoot = prior?.root ?? name, n = existing ? existing.n : (prior?.n ?? 0) + 1;
    if (n > MAX_REFUSED_RETRIES) return cap(refused, chainRoot, n);
    if (successor === "derive") {
      const kind = /^(hand|objective)-[a-f0-9]{64}$/.exec(name);
      if (!kind) throw Error("no derivable retry prefix for " + name);
      successor = `${kind[1]}-${digest(Buffer.from(name + ":retry"))}`;
    }
    const marker = JSON.stringify({ root: chainRoot, n, successor, exit: code }) + "\n";
    if (existing) { writeFileSync(markerPath + ".next", marker, { mode: 0o600 }); renameSync(markerPath + ".next", markerPath); }
    else writeFileSync(markerPath, marker, { flag: "wx", mode: 0o600 });
    return { attempt: name, exit: code, n, successor, retryRoot: chainRoot, ...(reraise ? { reraise } : {}) };
  }
  const n = archiveNotice(directory, name);
  if (n === null) return null;
  return { attempt: name, exit: code, n, setAsideAs: `refused/${name}.refused-${n}`, ...(reraise ? { reraise } : {}) };
}

// Move a notice's files to refused/<name>.refused-<n>.* (capped). Resumable: the
// operation is recorded first and its marker removed last, so an interrupted move is
// completed by the next tick before anything reads the id. Returns n, or null (capped).
function archiveNotice(directory, name) {
  const refused = join(directory, "refused");
  mkdirSync(refused, { recursive: true, mode: 0o700 });
  resumeArchivals(directory);
  const taken = new Set(readdirSync(refused));
  let n = 1;
  while ([...taken].some((file) => file.startsWith(`${name}.refused-${n}.`))) n++;
  if (n > MAX_REFUSED_RETRIES) return cap(refused, name, n);
  const files = readdirSync(directory).filter((file) => file.startsWith(name + ".") && !file.endsWith(".repair-request.json"));
  writeFileSync(join(refused, name + ".archiving"), JSON.stringify({ name, n, files }) + "\n", { flag: "wx", mode: 0o600, flush: true });
  resumeArchivals(directory);
  return n;
}

// Complete every recorded notice archival (refused/<name>.archiving). Each step is
// idempotent: a file already linked is only unlinked from its source, a file already
// moved is skipped. Callers run this before any consumed-by-id check.
export function resumeArchivals(directory) {
  const refused = join(directory, "refused");
  let names = [];
  try { names = readdirSync(refused); } catch (error) { if (error.code === "ENOENT") return; throw error; }
  for (const marker of names.filter((file) => file.endsWith(".archiving"))) {
    let name, n, files;
    try {
      ({ name, n, files } = JSON.parse(readFileSync(join(refused, marker), "utf8")));
      if (typeof name !== "string" || !Number.isSafeInteger(n) || !Array.isArray(files) || files.some((file) => typeof file !== "string" || !file.startsWith(name + ".") || file.includes("/"))) throw Error("schema");
    } catch { throw Error(`archival marker refused/${marker} is unreadable; archival held, nothing moved`); }
    for (const file of files) {
      const source = join(directory, file), target = join(refused, `${name}.refused-${n}${file.slice(name.length)}`);
      let src = null, dst = null;
      try { src = lstatSync(source); } catch (error) { if (error.code !== "ENOENT") throw error; }
      try { dst = lstatSync(target); } catch (error) { if (error.code !== "ENOENT") throw error; }
      if (src && !dst) { linkSync(source, target); dst = lstatSync(target); }
      // The source goes only once the target is the very same file (link done).
      if (src && (dst.dev !== src.dev || dst.ino !== src.ino)) throw Error(`archival of ${file} conflicts: refused target exists with other content; archival held, nothing deleted`);
      if (src) unlinkSync(source);
    }
    unlinkSync(join(refused, marker));
  }
}

// The capped causes still held, as `refused:<root> x<n>`. A cap whose chain head has
// since succeeded (exit 0) is cleared: renamed to .capped-cleared-<k>, never deleted.
export function activeCaps(directory) {
  const refused = join(directory, "refused");
  let names = [];
  try { names = readdirSync(refused); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
  const out = [];
  for (const file of names.filter((name) => name.endsWith(".capped"))) {
    const root = file.slice(0, -".capped".length), head = retryHead(directory, root);
    let succeeded = false;
    try { succeeded = readFileSync(join(directory, head + ".exit"), "utf8").trim() === "0"; } catch { /* no exit */ }
    if (!succeeded) try { succeeded = JSON.parse(readFileSync(join(directory, head + ".terminal.json"), "utf8")).status === 0; } catch { /* no terminal */ }
    if (succeeded) {
      let k = 1;
      while (names.includes(`${root}.capped-cleared-${k}`)) k++;
      linkSync(join(refused, file), join(refused, `${root}.capped-cleared-${k}`)); unlinkSync(join(refused, file));
      continue;
    }
    out.push(`refused:${root} x${readFileSync(join(refused, file), "utf8").replace(/[^0-9]/g, "")}`);
  }
  return out;
}

function writerGone(writer) {
  if (!writer || !Number.isSafeInteger(writer.pid) || writer.pid <= 0) return false;
  try { process.kill(writer.pid, 0); } catch (error) { if (error.code === "ESRCH") return true; if (error.code !== "EPERM") return false; }
  const now = startEpochOf(writer.pid);
  return Number.isFinite(writer.startMs) && now !== null && now > writer.startMs;
}

// A liveness hold must not be silent (DR-054): write one hand per held cause through
// the ordinary Mac hand path (attempt intent, ops, lane-deliver batch --receipt,
// parent terminal). The cause text names the PID, group and recorded start time.
//
// Custody: only a tick that holds the kernel guard may raise one. The caller passes
// its own shell PID; ownedGuard verifies this process is that shell's child and that
// the shell's inherited FD8 is the store's guard, locked by it. The hold never adopts
// or finalizes the OPEN slot. The lane-deliver child inherits FD8, so the guard stays
// held until the delivery itself has exited.
export function raiseTickHold(root, shellPid, message) {
  try { ownedGuard(root, shellPid); }
  catch (error) { return `raise-hold refused: this caller does not hold the tick guard (${error.message}); nothing published`; }
  const directory = deliveryRecordDirectory(root), id = "tick-hold-" + digest(Buffer.from(message));
  const prefix = join(directory, id);
  resumeArchivals(directory);
  let retryOf = null, handId = id;
  const writer = { pid: process.pid, startMs: startEpochOf(process.pid) };
  const write = () => writeFileSync(prefix + ".attempt.json", JSON.stringify({ state: "attempted; pending exact readback", receipt: prefix + ".submission.json", cause: message, handId, writer, ...(retryOf ? { retryOf } : {}) }) + "\n", { flag: "wx", mode: 0o600, flush: true });
  try { write(); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    // An earlier hold notification that published nothing (exit 1/2, or killed before
    // its exit) is retried under the shared readback-bound rule. A delivered one is
    // deduped on the Hub: while its hand is open (or still pending) it is "already
    // raised"; once resolved, a hold that recurs is raised again under a new id.
    let exit = "none", prior = {};
    try { exit = readFileSync(prefix + ".exit", "utf8").trim(); } catch (missing) { if (missing.code !== "ENOENT") throw missing; }
    try { prior = JSON.parse(readFileSync(prefix + ".attempt.json", "utf8")); } catch { /* legacy intent: default id */ }
    // No exit yet: retried only when its writer is provably gone (same rule as a tick).
    if (exit === "none" && !writerGone(prior.writer)) return `hand ${prior.handId ?? id} already raised (its delivery may still be running)`;
    if (["none", "1", "2"].includes(exit)) {
      retryOf = setAsideRefusedAttempt(root, directory, id, exit, "move");
      if (!retryOf?.setAsideAs) return `hand ${prior.handId ?? id} already raised`;
    } else if (exit === "0") {
      // Read the Hub ledger fresh (best effort, bounded; a stale local ref is still read).
      const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
      for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR"]) delete env[key];
      spawnSync("perl", ["-MPOSIX", "-e", GROUP_BOUNDED, "60", "git", "fetch", "--quiet", "origin", "SignalGrid_Alpha"], { cwd: root, env, stdio: NO_GUARD_SILENT, timeout: 70000 });
      const status = handLedgerStatus(root, prior.handId ?? id);
      if (status === "unknown") return `hand ${prior.handId ?? id} ledger unreadable; holding`;
      if (status !== "resolved") return `hand ${prior.handId ?? id} already raised`;
      const n = archiveNotice(directory, id);
      if (n === null) return `hand ${prior.handId ?? id} already raised (re-raise cap reached)`;
      retryOf = { attempt: id, exit: 0, n, setAsideAs: `refused/${id}.refused-${n}`, reraise: true };
    } else return `hand ${prior.handId ?? id} already raised`;
    // A re-raise takes a new id; a prepublication retry reuses the id it meant to raise.
    handId = retryOf.reraise ? `${id}-again-${retryOf.n}` : (prior.handId ?? id);
    write();
  }
  const op = { op: "raise", id: handId, who: "mac lane", domain: "lane", where: "scripts/mac/lane-tick.sh",
    doing: "the unattended Mac lane tick (scripts/mac/lane-tick.sh)",
    blocked: "Tick recovery is holding: " + message.replace(/\/(?:Users|home)\/[^/\s:]+/g, "<HOME>"),
    need: "Mac lane: check whether the named original tick process (PID, group, start time) still runs; once it is gone the next tick recovers on its own." };
  writeFileSync(prefix + ".ops.json", JSON.stringify([op]) + "\n", { flag: "wx", mode: 0o600 });
  const r = spawnSync(process.execPath, [join(root, "scripts/lane-deliver.mjs"), "batch", prefix + ".ops.json", "--receipt", prefix + ".submission.json"],
    { cwd: root, encoding: "utf8", timeout: 300000, stdio: ["ignore", "pipe", "pipe", "ignore", "ignore", "ignore", "ignore", "ignore", TICK_FD] });
  writeFileSync(prefix + ".output", (r.stdout ?? "") + (r.stderr ?? ""), { flag: "wx", mode: 0o600 });
  writeFileSync(prefix + ".exit", `${r.status ?? 255}\n`, { flag: "wx", mode: 0o600 });
  return `hand ${handId} written (lane-deliver exit ${r.status ?? "signal"})`;
}

let entrypoint;
// node -e consumers can use a label instead of a filename in argv[1].
try { if (process.argv[1]) entrypoint = realpathSync(process.argv[1]); } catch { /* imported library */ }
if (entrypoint === fileURLToPath(import.meta.url)) {
  try {
    const [mode, root, ...args] = process.argv.slice(2);
    if (!root) throw Error("checkout required");
    if (mode === "path" || mode === "init") console.log(deliveryRecordDirectory(root, mode === "init"));
    else if (mode === "ensure" && args.length === 0) console.log(ensureDeliveryRecordDirectory(root));
    else if (mode === "tick-guard" && args.length === 0) console.log(tickGuardPath(root));
    // Line 1 is the token; any further lines say what was recovered.
    else if (mode === "tick-acquire" && args.length >= 1 && args.length <= 3) console.log([acquireTick(root, args[0], args[1] ?? null, args[2] ?? null), ...acquireTick.recovered.map((n) => "recovered: " + n)].join("\n"));
    else if (mode === "refused-disposition" && args.length === 1) console.log(refusedDisposition(root, args[0]));
    else if (mode === "retry-refused" && (args.length === 3 || args.length === 4)) console.log(JSON.stringify(setAsideRefusedAttempt(root, ...args)));
    else if (mode === "retry-head" && args.length === 2) console.log(retryHead(...args));
    else if (mode === "raise-hold" && args.length === 2) console.log(raiseTickHold(root, args[0], args[1]));
    else if (mode === "capped" && args.length === 1) { const caps = activeCaps(args[0]); if (caps.length) console.log(caps.join("; ")); }
    else if (mode === "tick-release" && args.length === 3) releaseTick(root, ...args);
    else throw Error("usage: lane-attempt-store.mjs path|init|ensure|tick-guard <checkout> | tick-acquire <checkout> <shell-pid> [<pgid> [<lstart>]] | raise-hold <checkout> <shell-pid> <message> | refused-disposition <checkout> <receipt> | retry-refused <checkout> <records> <attempt-name> <exit> [<successor>|derive|move] | retry-head <checkout> <records> <attempt-name> | tick-release <checkout> <token> <shell-pid> <exit-trap-status>");
  } catch (error) {
    console.error(`RAISED HAND: delivery record store unavailable: ${error.message}; READBACK ONLY`);
    process.exitCode = error instanceof TickBusy ? 75 : 1;
  }
}
