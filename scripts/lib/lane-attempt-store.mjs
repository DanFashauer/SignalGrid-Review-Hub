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
    // store. A lock older than 60 s belongs to an initializer that died (init takes
    // milliseconds) and is taken over; a younger one is waited on, up to 15 s.
    const lock = directory + ".init.lock";
    for (let waited = 0; ; waited += 100) {
      try { closeSync(openSync(lock, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)); break; }
      catch (error) {
        if (error.code !== "EEXIST") throw error;
        try { if (Date.now() - lstatSync(lock).mtimeMs > 60000) { unlinkSync(lock); continue; } }
        catch (stale) { if (stale.code === "ENOENT") continue; throw stale; }
        if (waited >= 15000) throw Error(`store initialization lock ${lock} is held; holding`);
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
    } finally { try { unlinkSync(lock); } catch { /* already taken over */ } }
  }
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
function assertOriginalGone(shellPid, { pgid = null, token = null } = {}) {
  try { process.kill(shellPid, 0); }
  catch (error) {
    if (error.code !== "ESRCH") throw Error(`original tick shell ${shellPid} liveness is unknown (${error.code}); holding`);
    if (pgid === null && token === null) return;
    const own = processGroupOf(process.pid);
    const ps = spawnSync("ps", ["-axo", "pid=,pgid=,command="], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (ps.error || ps.signal || ps.status !== 0 || own === null) throw Error("process table is unreadable; holding");
    for (const line of ps.stdout.split("\n")) {
      const m = /^\s*(\d+)\s+(\d+)\s(.*)$/.exec(line);
      if (!m || Number(m[1]) === process.pid) continue;
      const group = Number(m[2]), command = m[3];
      if ((pgid !== null && group === pgid && pgid !== own) || (token && command.includes(token)) || command.includes("sg-lane-deliver-")) {
        throw Error(`process ${m[1]} of the original tick may survive (${command.slice(0, 120)}); holding`);
      }
    }
    return;
  }
  throw Error(`original tick shell ${shellPid} is still alive; holding`);
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
const ownerKeys = (value) => (value && Object.hasOwn(value, "pgid") ? [...OWNER_KEYS, "pgid"] : OWNER_KEYS);
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
    if (readdirSync(binding.directory).some((name) => /^tick-/.test(name))) throw Error("READY tick slot has earlier owner evidence");
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
  assertOriginalGone(shellPid, { pgid: owner?.value.pgid ?? null, token });
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

export function acquireTick(root, shellPid, pgid = null) {
  if (pgid !== null && !/^[1-9][0-9]*$/.test(String(pgid))) throw Error("tick process group must be a positive integer");
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
    ...(pgid === null ? {} : { pgid: Number(pgid) }) };
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
export function refusedDisposition(root, receiptPath) {
  let raw;
  try { raw = readFileSync(receiptPath, "utf8"); } catch (error) { return error.code === "ENOENT" ? "unpublished" : "unknown"; }
  let target;
  try { target = JSON.parse(raw).target; } catch { return "unknown"; }
  if (typeof target !== "string" || !/^lane\/[a-z]+-mail-[0-9]{8}-[0-9]{6}Z-[a-f0-9]{12}$/.test(target)) return "unknown";
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR"]) delete env[key];
  // ponytail: the timeout kills git only, not an ssh helper; same bound as the tick fetch would need a group wrapper.
  const r = spawnSync("git", ["ls-remote", "origin", "refs/heads/" + target], { cwd: root, env, encoding: "utf8", timeout: 60000 });
  if (r.error || r.signal || r.status !== 0) return "unknown";
  return r.stdout.trim() ? "published" : "unpublished";
}

// The one rule for every refused-attempt retry branch (build-tick, objective-loop,
// lane-repair, pending-heartbeat notice). Only when refusedDisposition proves nothing
// was published are the attempt's files (all `<name>.*` except a repair request)
// moved, byte-identical, to refused/<name>.refused-<n>.<suffix> with n the first
// unused integer: deterministic, no clock or randomness, and link+unlink so an
// existing name is never overwritten. Returns the retry identity, or null (held).
export function setAsideRefusedAttempt(root, directory, name, exit) {
  if (refusedDisposition(root, join(directory, name + ".submission.json")) !== "unpublished") return null;
  const refused = join(directory, "refused");
  mkdirSync(refused, { recursive: true, mode: 0o700 });
  const taken = new Set(readdirSync(refused));
  let n = 1;
  while ([...taken].some((file) => file.startsWith(`${name}.refused-${n}.`))) n++;
  for (const file of readdirSync(directory)) {
    if (!file.startsWith(name + ".") || file.endsWith(".repair-request.json")) continue;
    linkSync(join(directory, file), join(refused, `${name}.refused-${n}${file.slice(name.length)}`));
    unlinkSync(join(directory, file));
  }
  return { attempt: name, exit: Number(exit), setAsideAs: `refused/${name}.refused-${n}` };
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
    else if (mode === "tick-acquire" && (args.length === 1 || args.length === 2)) console.log([acquireTick(root, args[0], args[1] ?? null), ...acquireTick.recovered.map((n) => "recovered: " + n)].join("\n"));
    else if (mode === "refused-disposition" && args.length === 1) console.log(refusedDisposition(root, args[0]));
    else if (mode === "retry-refused" && args.length === 3) console.log(JSON.stringify(setAsideRefusedAttempt(root, ...args)));
    else if (mode === "tick-release" && args.length === 3) releaseTick(root, ...args);
    else throw Error("usage: lane-attempt-store.mjs path|init|ensure|tick-guard <checkout> | tick-acquire <checkout> <shell-pid> [<pgid>] | refused-disposition <checkout> <receipt> | retry-refused <checkout> <records> <attempt-name> <exit> | tick-release <checkout> <token> <shell-pid> <exit-trap-status>");
  } catch (error) {
    console.error(`RAISED HAND: delivery record store unavailable: ${error.message}; READBACK ONLY`);
    process.exitCode = error instanceof TickBusy ? 75 : 1;
  }
}
