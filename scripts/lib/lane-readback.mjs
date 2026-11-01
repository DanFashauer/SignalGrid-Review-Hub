// Durable read-only observations. No publication, reservation acquisition, PID
// recovery, sequence allocator or stale-lock protocol belongs in this module.
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";

const FRAME_MAX = 4096;
const RAW_MAX = 16 * 1024 * 1024; // Same existing child-output bound as lane-deliver.
const CADENCE_MS = 120 * 60 * 1000;
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-f0-9]{32}$/;
const HAND = /^[a-z0-9][a-z0-9-]{0,127}$/;
const COMMON = ["version", "kind", "observation_id", "receipt_sha256", "scope", "resolved_hand", "at"];
const TERMINAL = [...COMMON, "intent_sha256", "status", "signal", "error", "stdout_sha256", "stdout_bytes", "stderr_sha256", "stderr_bytes"];
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const body = value => Buffer.from(JSON.stringify(value));
const identity = st => `${st.dev}:${st.ino}`;
const uidMatches = st => typeof process.getuid !== "function" || st.uid === process.getuid();

function ownFile(st) {
  if (!st.isFile() || st.nlink !== 1 || !uidMatches(st) || (st.mode & 0o077)) throw Error("readback evidence must be an owned private one-link regular file");
}
function ownDirectory(path, privateOnly = true) {
  const st = lstatSync(path);
  if (!st.isDirectory() || !uidMatches(st) || (st.mode & (privateOnly ? 0o077 : 0o022))) throw Error("readback evidence directory is indirect or not owned");
  return identity(st);
}
function present(path) {
  try { lstatSync(path); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; }
}
function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join("\n") !== [...expected].sort().join("\n")) throw Error("readback event schema differs");
}
function instant(value) {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) throw Error("readback timestamp is invalid");
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value) throw Error("readback timestamp is invalid");
  return ms;
}
function exactUtf8(raw) {
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw);
  if (!Buffer.from(text).equals(raw)) throw Error("readback evidence is not exact UTF-8");
  return text;
}

// The publisher briefly has a second name for an already complete fsynced object.
// Wait only for that local link publication, never reap an alias or infer a PID's
// lifetime. A persistent extra link remains held evidence after this bounded read.
function readRaw(path, expectedHash, expectedBytes) {
  for (let read = 0; read < 8; read += 1) {
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = fstatSync(fd);
      if (before.isFile() && before.nlink === 2 && uidMatches(before) && !(before.mode & 0o077) && read < 7) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
        continue;
      }
      ownFile(before);
      if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0 || expectedBytes > RAW_MAX || before.size !== expectedBytes) throw Error("readback raw byte count differs");
      const bytes = readFileSync(fd), after = fstatSync(fd), named = lstatSync(path);
      ownFile(after); ownFile(named);
      if (identity(before) !== identity(after) || identity(before) !== identity(named) || bytes.length !== before.size ||
          ["size", "mtimeMs", "ctimeMs"].some(k => before[k] !== after[k]) || sha(bytes) !== expectedHash) throw Error("readback raw object changed or differs");
      return bytes;
    } finally { closeSync(fd); }
  }
  throw Error("readback raw object publication remains held");
}

export class ReadbackEvidence {
  constructor(receiptPath, receiptHash, { pendingCadence = false, resolvedHand = null, checkOwner = null } = {}) {
    if (!HASH.test(receiptHash) || (resolvedHand !== null && !HAND.test(resolvedHand)) ||
        (pendingCadence && (resolvedHand !== null || typeof checkOwner !== "function"))) throw Error("exact readback scope required");
    this.receipt = receiptPath;
    this.receiptHash = receiptHash;
    this.scope = pendingCadence ? "pending-cadence" : "fresh";
    this.resolvedHand = resolvedHand;
    this.checkOwner = checkOwner;
    this.journal = receiptPath + ".readback.journal";
    this.rawDirectory = receiptPath + ".readback-blobs";
    this.compatibility = receiptPath + ".readback-index.json";
    ownDirectory(dirname(receiptPath), false);
    if (checkOwner) checkOwner();
    this.history = this.readHistory();
  }

  readHistory() {
    const entries = new Map();
    if (!present(this.journal)) return entries;
    const fd = openSync(this.journal, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = fstatSync(fd); ownFile(before);
      if (!Number.isSafeInteger(before.size) || before.size < 0) throw Error("readback journal size differs");
      const limit = before.size;
      let offset = 0;
      const take = size => {
        if (size < 0 || offset + size > limit) throw Error("partial readback journal frame; preserve and hold");
        const bytes = Buffer.alloc(size);
        let count = 0;
        while (count < size) {
          const n = readSync(fd, bytes, count, size - count, offset + count);
          if (!n) throw Error("partial readback journal read");
          count += n;
        }
        offset += size;
        return bytes;
      };
      const now = Date.now();
      while (offset < limit) {
        const start = offset; let header = "";
        while (true) {
          if (header.length > 100) throw Error("readback frame header exceeds its bound");
          const c = take(1)[0];
          if (c === 10) break;
          if (c > 127) throw Error("readback frame header is invalid");
          header += String.fromCharCode(c);
        }
        const match = /^SGRB1 (0|[1-9][0-9]*) ([a-f0-9]{64})$/.exec(header);
        if (!match) throw Error("readback frame header/checksum is invalid");
        const size = Number(match[1]);
        if (!Number.isSafeInteger(size) || size < 1 || offset - start + size + 1 > FRAME_MAX) throw Error("readback frame exceeds 4 KiB");
        const raw = take(size);
        if (take(1)[0] !== 10 || sha(raw) !== match[2]) throw Error("readback frame checksum differs");
        const value = JSON.parse(exactUtf8(raw));
        if (!body(value).equals(raw)) throw Error("readback event is not its exact owned representation");
        exactKeys(value, value.kind === "intent" ? COMMON : TERMINAL);
        if (value.version !== 1 || !["intent", "terminal"].includes(value.kind) || !ID.test(value.observation_id) ||
            value.receipt_sha256 !== this.receiptHash || !["fresh", "pending-cadence"].includes(value.scope) ||
            (value.resolved_hand !== null && !HAND.test(value.resolved_hand)) ||
            (value.scope === "pending-cadence" && value.resolved_hand !== null)) throw Error("readback event binding differs");
        const at = instant(value.at);
        if (!Number.isFinite(now) || at > now) throw Error("readback observation is from the future; preserve and hold");
        const key = value.observation_id;
        if (value.kind === "intent") {
          if (entries.has(key)) throw Error("readback intent identity was reused");
          entries.set(key, { intent: value, intentHash: match[2], at });
        } else {
          const original = entries.get(key);
          if (!original || original.terminal || value.intent_sha256 !== original.intentHash || at < original.at ||
              ["receipt_sha256", "scope", "resolved_hand"].some(k => value[k] !== original.intent[k])) throw Error("readback terminal differs from its original intent");
          if (!(value.status === null || Number.isInteger(value.status) && value.status >= 0 && value.status <= 255) ||
              !(value.signal === null || typeof value.signal === "string" && /^SIG[A-Z0-9]+$/.test(value.signal)) ||
              !(value.error === null || typeof value.error === "string" && value.error.length > 0 && value.error.length <= 128) ||
              (value.status === null && value.signal === null && value.error === null)) throw Error("actual readback command terminal is incomplete");
          ownDirectory(this.rawDirectory);
          for (const stream of ["stdout", "stderr"]) {
            if (!HASH.test(value[stream + "_sha256"])) throw Error("readback raw hash is invalid");
            readRaw(join(this.rawDirectory, value[stream + "_sha256"] + ".raw"), value[stream + "_sha256"], value[stream + "_bytes"]);
          }
          original.terminal = value; original.finished = at;
        }
      }
      const after = fstatSync(fd), named = lstatSync(this.journal); ownFile(after); ownFile(named);
      // Concurrent fresh observers append complete indivisible frames. Validate
      // the exact prefix captured above without interpreting later bytes as ours.
      if (identity(before) !== identity(after) || identity(before) !== identity(named) || after.size < limit ||
          (after.size === limit && ["mtimeMs", "ctimeMs"].some(k => before[k] !== after[k]))) throw Error("readback journal changed outside append-only publication");
      return entries;
    } finally { closeSync(fd); }
  }

  deferred() {
    if (this.scope !== "pending-cadence") return null;
    this.checkOwner();
    let last = null;
    for (const entry of this.history.values()) {
      if (entry.intent.scope !== "pending-cadence") continue;
      if (!entry.terminal) throw Error("original pending-cadence observation is unfinished; preserve and hold");
      if (!last || entry.finished > last.finished) last = entry;
    }
    if (!last) return null;
    const age = Date.now() - last.finished;
    if (!Number.isFinite(age) || age < 0) throw Error("readback cadence clock is invalid or before its observation");
    if (age >= CADENCE_MS) return null;
    const failed = last.terminal.status !== 0 || last.terminal.signal !== null || last.terminal.error !== null;
    return `readback deferred: next scheduled observation is not due; ${failed ? "last GET unavailable" : "original canonical delivery remains unverified"}; no cached success or new submission`;
  }

  append(value) {
    const raw = body(value), header = Buffer.from(`SGRB1 ${raw.length} ${sha(raw)}\n`), bytes = Buffer.concat([header, raw, Buffer.from("\n")]);
    if (bytes.length > FRAME_MAX) throw Error("readback event exceeds the single-append 4 KiB bound");
    const fd = openSync(this.journal, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
    try {
      const before = fstatSync(fd); ownFile(before);
      // One write, never a loop that could join an earlier partial frame to a new
      // observation. A short write is retained verbatim and makes every scope hold.
      const count = writeSync(fd, bytes);
      fsyncSync(fd);
      const after = fstatSync(fd), named = lstatSync(this.journal); ownFile(after); ownFile(named);
      if (count !== bytes.length || identity(before) !== identity(after) || identity(before) !== identity(named)) throw Error("short or replaced readback append; preserve partial history and hold");
    } finally { closeSync(fd); }
    return sha(raw);
  }

  raw(bytes, observationId, stream) {
    if (!Buffer.isBuffer(bytes) || bytes.length > RAW_MAX) throw Error("exact bounded readback raw bytes required");
    try { mkdirSync(this.rawDirectory, { mode: 0o700 }); } catch (error) { if (error.code !== "EEXIST") throw error; }
    const directoryIdentity = ownDirectory(this.rawDirectory), hash = sha(bytes), target = join(this.rawDirectory, hash + ".raw");
    if (present(target)) {
      if (!readRaw(target, hash, bytes.length).equals(bytes)) throw Error("existing readback raw bytes differ");
      return hash;
    }
    const temporary = join(this.rawDirectory, `.${observationId}-${stream}-${randomBytes(6).toString("hex")}.capture`);
    const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { ownFile(fstatSync(fd)); writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
    let published = false;
    try {
      try { linkSync(temporary, target); published = true; }
      catch (error) { if (error.code !== "EEXIST") throw error; }
      if (published) unlinkSync(temporary); // Only this exact writer's private alias.
      if (ownDirectory(this.rawDirectory) !== directoryIdentity || !readRaw(target, hash, bytes.length).equals(bytes)) throw Error("readback raw publication differs");
      if (!published) unlinkSync(temporary); // Existing exact object was independently verified.
      return hash;
    } catch (error) {
      // Never remove an old object or another observer's incomplete publication.
      // A failed unique staging file remains private evidence for its own intent.
      throw error;
    }
  }

  capture(argv, cwd) {
    if (!Array.isArray(argv) || !argv.length || !argv.every(x => typeof x === "string")) throw Error("fixed readback command required");
    if (this.checkOwner) this.checkOwner();
    const id = randomBytes(16).toString("hex");
    const intent = { version: 1, kind: "intent", observation_id: id, receipt_sha256: this.receiptHash,
      scope: this.scope, resolved_hand: this.resolvedHand, at: new Date().toISOString() };
    const intentHash = this.append(intent);
    // Catch a previously unseen corrupt/partial append before the transport call.
    const admitted = this.readHistory().get(id);
    if (!admitted || admitted.intentHash !== intentHash || admitted.terminal) throw Error("original readback intent was not durably admitted");
    if (this.checkOwner) this.checkOwner();
    const result = spawnSync(argv[0], argv.slice(1), { cwd, maxBuffer: RAW_MAX });
    const stdout = Buffer.from(result.stdout ?? ""), stderr = Buffer.from(result.stderr ?? "");
    const terminal = { ...intent, kind: "terminal", at: new Date().toISOString(), intent_sha256: intentHash,
      status: result.status ?? null, signal: result.signal ?? null,
      error: result.error ? (result.error.code ?? result.error.name ?? "unknown") : null,
      stdout_sha256: this.raw(stdout, id, "stdout"), stdout_bytes: stdout.length,
      stderr_sha256: this.raw(stderr, id, "stderr"), stderr_bytes: stderr.length };
    this.append(terminal);
    const actual = this.readHistory().get(id);
    if (!actual?.terminal || !body(actual.terminal).equals(body(terminal))) throw Error("original readback terminal was not durably verified");
    // Compatibility index is reference-only. It is never parsed as authority or
    // cached PR state; old timestamped receipts are neither read nor overwritten.
    try {
      writeFileSync(this.compatibility, JSON.stringify({ version: 1, receipt_sha256: this.receiptHash,
        reference_only: true, verified: false, journal: this.journal, raw_directory: this.rawDirectory }) + "\n", { flag: "wx", mode: 0o600, flush: true });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      ownFile(lstatSync(this.compatibility));
    }
    return { ...terminal, stdout, stderr, prefix: `${this.receipt}.readback-${id}` };
  }
}
