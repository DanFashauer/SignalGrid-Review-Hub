// One local attempt store shared by every linked checkout; never a dependency cache.
// Initialize separately after preserving old receipts and verifying no old attempt is in flight.
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, ftruncateSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
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

function noLegacyTickLock(directory) {
  try { lstatSync(join(directory, "tick.lock")); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  throw Error("legacy tick.lock is held evidence; no PID probe or automatic reaping");
}

function tickBinding(root) {
  const directory = deliveryRecordDirectory(root);
  noLegacyTickLock(directory);
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
const TERMINAL_KEYS = [...BASE_KEYS, "token", "shellPid", "openedSha256", "exitTrapStatus", "closedAt"];

function assertOwner(record, binding, token, shellPid) {
  keysExactly(record.value, OWNER_KEYS);
  assertBinding(record.value, binding);
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
  if (slot.value.state === "OPEN") throw Error("original tick lifetime remains OPEN; readback only");
  if (slot.value.state !== "CLOSED") throw Error("unknown tick slot state");
  keysExactly(slot.value, [...OPEN_KEYS, "terminalSha256"]);
  const { token, shellPid, openedSha256, terminalSha256 } = slot.value;
  if (!TOKEN.test(token) || !Number.isSafeInteger(shellPid) || shellPid <= 0 || !HASH.test(openedSha256) || !HASH.test(terminalSha256)) throw Error("closed tick slot identity is invalid");
  const owner = readTickJson(join(binding.directory, `tick-${token}.opened.json`));
  assertOwner(owner, binding, token, shellPid);
  const terminal = readTickJson(join(binding.directory, `tick-${token}.terminal.json`));
  keysExactly(terminal.value, TERMINAL_KEYS);
  assertBinding(terminal.value, binding);
  if (digest(owner.raw) !== openedSha256 || digest(terminal.raw) !== terminalSha256 || terminal.value.state !== "CLOSED" ||
      terminal.value.token !== token || terminal.value.shellPid !== shellPid || terminal.value.openedSha256 !== openedSha256 ||
      !Number.isInteger(terminal.value.exitTrapStatus) || terminal.value.exitTrapStatus < 0 || terminal.value.exitTrapStatus >= 128 ||
      typeof terminal.value.closedAt !== "string" || !Number.isFinite(Date.parse(terminal.value.closedAt))) throw Error("closed tick terminal is not its exact owner result");
  return slot;
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

export function acquireTick(root, shellPid) {
  const owned = ownedGuard(root, shellPid);
  const { binding } = owned;
  const slot = readSlot(binding);
  const token = randomBytes(16).toString("hex");
  const base = { version: 1, directory: binding.directory, store: binding.store, guard: binding.guard };
  const owner = { ...base, state: "OPEN", token, shellPid: owned.shellPid, openedAt: new Date().toISOString() };
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

let entrypoint;
// node -e consumers can use a label instead of a filename in argv[1].
try { if (process.argv[1]) entrypoint = realpathSync(process.argv[1]); } catch { /* imported library */ }
if (entrypoint === fileURLToPath(import.meta.url)) {
  try {
    const [mode, root, ...args] = process.argv.slice(2);
    if (!root) throw Error("checkout required");
    if (mode === "path" || mode === "init") console.log(deliveryRecordDirectory(root, mode === "init"));
    else if (mode === "tick-guard" && args.length === 0) console.log(tickGuardPath(root));
    else if (mode === "tick-acquire" && args.length === 1) console.log(acquireTick(root, args[0]));
    else if (mode === "tick-release" && args.length === 3) releaseTick(root, ...args);
    else throw Error("usage: lane-attempt-store.mjs path|init|tick-guard <checkout> | tick-acquire <checkout> <shell-pid> | tick-release <checkout> <token> <shell-pid> <exit-trap-status>");
  } catch (error) {
    console.error(`RAISED HAND: delivery record store unavailable: ${error.message}; READBACK ONLY`);
    process.exitCode = error instanceof TickBusy ? 75 : 1;
  }
}
