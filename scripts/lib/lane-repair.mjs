// One bounded DATA-to-notice bridge. A request never grants execution or retries
// an original delivery. Only the actual current Bash/FD8 owner may issue the one
// DIFFERENT Cloud uncertainty notice; its own intent consumes an unconfirmed send.
// A refused send (lane-deliver exit 1/2: nothing published) is moved aside and retried.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync,
  opendirSync, readdirSync, readFileSync, readSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkTickOwner, deliveryRecordDirectory, setAsideRefusedAttempt } from './lane-attempt-store.mjs';

const MAX_RECORD = 1024 * 1024;
const MAX_TOTAL = 16 * MAX_RECORD;
const HASH = /^[a-f0-9]{64}$/;
const OID = /^[a-f0-9]{40}$/;
const PRODUCERS = new Set(['heartbeat', 'build', 'objective']);
const MAX_INVENTORY = 65536;
const MAX_EVALUATIONS = 32;
const CURSOR_FRAME = 512;
const REQUEST_NAME = /^((?:pending-heartbeat|repair-(?:heartbeat|build|objective))-[a-f0-9]{64})\.repair-request\.json$/;
const NOTICE_NAME = /^((?:pending-heartbeat|repair-(?:heartbeat|build|objective))-[a-f0-9]{64})\.(.+)$/;
const SUFFIXES = Object.freeze([
  '.intent.json', '.attempt.json', '.log', '.output', '.exit', '.terminal.json',
  '.submission.json', '.submission.json.push.json', '.submission.json.push.raw.json',
  '.submission.json.push-ref.json', '.submission.json.push-ref.raw.json',
  '.readback.output', '.readback.terminal.json',
]);

const GIT_ENV_KEYS = [
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_NAMESPACE',
  'GIT_PREFIX', 'GIT_CONFIG', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS',
  'GIT_GRAFT_FILE', 'GIT_IMPLICIT_WORK_TREE', 'GIT_NO_REPLACE_OBJECTS',
  'GIT_REPLACE_REF_BASE', 'GIT_SHALLOW_FILE',
];
const sha = raw => createHash('sha256').update(raw).digest('hex');
const encoded = value => Buffer.from(JSON.stringify(value) + '\n');
const own = st => st.isFile() && st.nlink === 1 &&
  (typeof process.getuid !== 'function' || st.uid === process.getuid());
const unchanged = (a, b) => ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].every(k => a[k] === b[k]);

function present(path) {
  try { lstatSync(path); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
function readOwned(path, bound = MAX_RECORD) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    if (!own(before) || before.size > bound) throw Error('owned bounded unique regular evidence required');
    const raw = readFileSync(fd);
    if (raw.length !== before.size || !unchanged(before, fstatSync(fd)) || !unchanged(before, lstatSync(path))) {
      throw Error('evidence identity changed during read');
    }
    return raw;
  } finally { closeSync(fd); }
}
function parseOwned(raw) {
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw));
  if (!encoded(value).equals(raw)) throw Error('owned JSON representation differs');
  return value;
}
function writeNew(path, raw) {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    if (!own(fstatSync(fd))) throw Error('owned new record required');
    writeFileSync(fd, raw); fsyncSync(fd);
  } finally { closeSync(fd); }
  if (!readOwned(path).equals(raw)) throw Error('durable new record readback differs');
}
function storeFor(root) {
  const directory = deliveryRecordDirectory(root), st = lstatSync(directory);
  if (!st.isDirectory() || st.isSymbolicLink() || realpathSync(directory) !== directory ||
      (typeof process.getuid === 'function' && st.uid !== process.getuid()) || (st.mode & 0o022)) {
    throw Error('exact owned common store required');
  }
  return { directory, dev: st.dev, ino: st.ino };
}
function identityFor(producer, prefix) {
  if (!PRODUCERS.has(producer)) throw Error('finite original producer required');
  const name = basename(prefix);
  const match = producer === 'heartbeat' ? /^\.sg-heartbeat-([0-9]{8}T[0-9]{6}Z-[0-9]+)$/.exec(name) :
    producer === 'build' ? /^hand-([a-f0-9]{64})$/.exec(name) : /^objective-([a-f0-9]{64})$/.exec(name);
  // Valid heartbeat identities retain the old inline notifier's exact fence.
  const id = producer === 'heartbeat' && match ? 'pending-heartbeat-' + sha(match[1]) :
    'repair-' + producer + '-' + sha(name);
  return { id, name, supported: Boolean(match), attempt: match ? match[1] : null };
}
function gitBytes(root, args) {
  const env = { ...process.env };
  for (const key of GIT_ENV_KEYS) delete env[key];
  env.GIT_NO_REPLACE_OBJECTS = '1'; env.GIT_GRAFT_FILE = '/dev/null'; env.GIT_OPTIONAL_LOCKS = '0';
  const r = spawnSync('git', ['--no-replace-objects', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', ...args],
    { cwd: root, env, maxBuffer: 2 * MAX_RECORD, stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.error || r.signal || r.status !== 0 || !Buffer.isBuffer(r.stdout)) throw Error('exact local committed source unavailable');
  return r.stdout;
}
function originalParentNormal(producer, files) {
  if (producer !== 'objective') {
    const text = files.get('.exit')?.toString('utf8');
    return /^(?:0|[1-9][0-9]{0,2})\n$/.test(text ?? '') && Number(text) < 128;
  }
  try {
    const t = parseOwned(files.get('.terminal.json'));
    // Old objective terminals omitted signal; that omission is unverified data.
    return Number.isInteger(t.status) && t.status >= 0 && t.status < 128 && t.signal === null && t.error === null;
  } catch { return false; }
}
function pushSourceProof(root, producer, prefix, files) {
  if (!originalParentNormal(producer, files)) return false;
  try {
    const receiptRaw = files.get('.submission.json'), r = parseOwned(receiptRaw);
    const terminalRaw = files.get('.submission.json.push.json'), p = parseOwned(terminalRaw);
    const rawRaw = files.get('.submission.json.push.raw.json'), b = parseOwned(rawRaw);
    if (r.version !== 1 || !OID.test(r.base ?? '') || !OID.test(r.head ?? '') || !OID.test(r.producer_head ?? '') ||
        !HASH.test(r.producer_source_sha256 ?? '') || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(r.repository ?? '') ||
        !/^lane\/(mac|cloud)-mail-[0-9]{8}-[0-9]{6}Z-[a-f0-9]{12}$/.test(r.target ?? '') ||
        !Array.isArray(r.blobs) || !r.blobs.length || r.blobs.length > 512 || r.blobs.some(x =>
          !x || typeof x.path !== 'string' || x.path.includes('..') || x.path.startsWith('/') || !OID.test(x.oid ?? ''))) return false;
    if (p.version !== 1 || p.kind !== 'original-lane-push-terminal' || b.kind !== p.kind + '-raw' ||
        p.receipt_sha256 !== sha(receiptRaw) || p.raw_capture_sha256 !== sha(rawRaw) || p.utf8_valid !== true ||
        !Number.isInteger(p.status) || p.status < 0 || p.status > 255 || p.signal !== null || p.error !== null ||
        JSON.stringify(p.command) !== JSON.stringify(['git', 'push', 'origin', 'HEAD:refs/heads/' + r.target])) return false;
    for (const key of ['version', 'receipt_sha256', 'repository', 'base', 'head', 'target', 'producer_head',
      'producer_source_sha256', 'command', 'status', 'signal', 'error', 'stdout_sha256', 'stderr_sha256']) {
      if (JSON.stringify(p[key]) !== JSON.stringify(b[key])) return false;
    }
    for (const key of ['repository', 'base', 'head', 'target', 'producer_head', 'producer_source_sha256']) {
      if (p[key] !== r[key]) return false;
    }
    for (const name of ['stdout', 'stderr']) {
      if (typeof b[name + '_base64'] !== 'string') return false;
      const bytes = Buffer.from(b[name + '_base64'], 'base64');
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      if (bytes.toString('base64') !== b[name + '_base64'] || sha(bytes) !== p[name + '_sha256'] ||
          !Buffer.from(text).equals(bytes) || text !== p[name]) return false;
    }
    const source = gitBytes(root, ['show', r.producer_head + ':scripts/lane-deliver.mjs']);
    return sha(source) === r.producer_source_sha256;
  } catch { return false; }
}
function snapshot(root, producer, inputPrefix, store) {
  const prefix = resolve(inputPrefix), identity = identityFor(producer, prefix), files = new Map(), evidence = [], issues = [];
  const readable = dirname(prefix) === store.directory && identity.supported;
  if (!readable) issues.push('original-prefix-outside-supported-namespace');
  let total = 0;
  if (readable) {
    for (const suffix of SUFFIXES) {
      const path = prefix + suffix;
      if (!present(path)) continue;
      try {
        const raw = readOwned(path); total += raw.length;
        if (total > MAX_TOTAL) throw Error('original evidence exceeds total bound');
        files.set(suffix, raw); evidence.push({ suffix, sha256: sha(raw), bytes: raw.length });
      } catch { issues.push('unreadable-original-evidence:' + suffix); }
    }
  }
  let intentRaw, intent;
  try {
    if (producer === 'heartbeat') {
      if (files.has('.intent.json')) { intentRaw = files.get('.intent.json'); intent = parseOwned(intentRaw); }
      else {
        const log = files.get('.log'); if (!log) throw Error('missing log');
        const end = log.indexOf(10); intentRaw = end < 0 ? log : log.subarray(0, end + 1); intent = parseOwned(intentRaw);
      }
      if (!intent || intent.attempt !== identity.attempt || typeof intent.result !== 'string') throw Error('heartbeat intent differs');
    } else {
      intentRaw = files.get('.attempt.json'); intent = parseOwned(intentRaw);
      if (!intent || intent.receipt !== prefix + '.submission.json' ||
          producer === 'objective' && typeof intent.escalation !== 'string') throw Error('original intent differs');
    }
  } catch {
    issues.push('original-intent-unverified');
    intentRaw ??= files.get(producer === 'heartbeat' ? '.log' : '.attempt.json') ?? Buffer.from('unread-original:' + producer + ':' + identity.name);
  }
  const provenance = !issues.length && pushSourceProof(root, producer, prefix, files) ? 'SOURCE_BOUND' : 'UNVERIFIED';
  return {
    version: 1, kind: 'lane-delivery-repair-request', id: identity.id, producer,
    original_attempt: { prefix, intent_sha256: sha(intentRaw) }, provenance, readback_only: true,
    evidence, issues, store: { directory: store.directory, dev: store.dev, ino: store.ino },
  };
}
const binding = value => ({ version: value.version, kind: value.kind, id: value.id, producer: value.producer,
  original_attempt: value.original_attempt, provenance: value.provenance, readback_only: value.readback_only,
  evidence: value.evidence, issues: value.issues, store: value.store });
function sameRequest(a, b) { return encoded(binding(a)).equals(encoded(binding(b))); }
function requestPath(store, id) { return join(store.directory, id + '.repair-request.json'); }

export function requestRepair(root, producer, prefix) {
  root = resolve(root); const store = storeFor(root), current = snapshot(root, producer, prefix, store), path = requestPath(store, current.id);
  if (present(path)) {
    const prior = parseOwned(readOwned(path));
    if (!sameRequest(prior, current)) throw Error('original request binding changed; existing identity remains held');
    return path;
  }
  const value = { ...current, at: new Date().toISOString() };
  try { writeNew(path, encoded(value)); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (!sameRequest(parseOwned(readOwned(path)), current)) throw Error('concurrent original binding differs; readback only');
  }
  return path;
}
// Pure original-evidence classification only. A known normal original submission
// needs no uncertainty notice; this never proves landing or authorizes a resend.
export function repairStatus(root, producer, prefix) {
  root = resolve(root); const store = storeFor(root), current = snapshot(root, producer, prefix, store);
  if (current.provenance !== 'SOURCE_BOUND') return 0;
  const readBound = suffix => {
    const expected = current.evidence.find(row => row.suffix === suffix);
    if (!expected) throw Error('original status evidence is incomplete');
    const raw = readOwned(current.original_attempt.prefix + suffix);
    if (raw.length !== expected.bytes || sha(raw) !== expected.sha256) throw Error('original status evidence changed');
    return raw;
  };
  try {
    const parentZero = producer === 'objective' ? parseOwned(readBound('.terminal.json')).status === 0 :
      readBound('.exit').equals(Buffer.from('0\n'));
    const push = parseOwned(readBound('.submission.json.push.json'));
    return parentZero && push.status === 0 && push.signal === null && push.error === null ? 2 : 0;
  } catch { return 0; }
}
function requestRecord(root, path, store) {
  path = resolve(path);
  if (dirname(path) !== store.directory) throw Error('repair request is outside exact common store');
  const raw = readOwned(path), value = parseOwned(raw);
  if (value.version !== 1 || value.kind !== 'lane-delivery-repair-request' || !PRODUCERS.has(value.producer) ||
      value.readback_only !== true || !value.original_attempt || typeof value.original_attempt.prefix !== 'string' ||
      !HASH.test(value.original_attempt.intent_sha256 ?? '') || typeof value.id !== 'string' ||
      !/^(?:pending-heartbeat|repair-(?:heartbeat|build|objective))-[a-f0-9]{64}$/.test(value.id) ||
      path !== requestPath(store, value.id) || !Number.isFinite(Date.parse(value.at))) throw Error('repair DATA schema differs');
  const current = snapshot(root, value.producer, value.original_attempt.prefix, store);
  if (!sameRequest(value, current)) throw Error('original bound evidence changed; preserved request stays held');
  return { raw, value };
}
function activeOwner(root, token, shellPid, store, prior = null) {
  const owner = checkTickOwner(root, token, shellPid), st = lstatSync(store.directory);
  if (owner.directory !== store.directory || owner.store.dev !== store.dev || owner.store.ino !== store.ino ||
      !st.isDirectory() || st.dev !== store.dev || st.ino !== store.ino || (st.mode & 0o022) ||
      (typeof process.getuid === 'function' && st.uid !== process.getuid())) throw Error('notification store or actual owner differs');
  if (prior && (owner.openedSha256 !== prior.openedSha256 || owner.guard.dev !== prior.guard.dev ||
      owner.guard.ino !== prior.guard.ino || owner.token !== prior.token || owner.shellPid !== prior.shellPid)) {
    throw Error('original current tick changed before notification');
  }
  return owner;
}
function committedConsumer(root) {
  const head = gitBytes(root, ['rev-parse', '--verify', 'HEAD']).toString('utf8').trim();
  if (!OID.test(head)) throw Error('current consumer source head unavailable');
  const named = readOwned(join(root, 'scripts/lib/lane-repair.mjs'));
  if (!named.equals(readOwned(fileURLToPath(import.meta.url))) ||
      !gitBytes(root, ['show', head + ':scripts/lib/lane-repair.mjs']).equals(named)) {
    throw Error('current consumer is not its exact committed source');
  }
  return { head, source_sha256: sha(named) };
}
function noticeRoot(store, id) { return join(store.directory, id); }
// The set-aside terminals of earlier refused sends of this notice: the retry chain.
function refusedNotices(store, id) {
  try { return readdirSync(join(store.directory, 'refused')).filter(n => n.startsWith(id + '.refused-') && n.endsWith('.terminal.json')).sort().map(n => 'refused/' + n); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
function inventory(store) {
  const requests = [], consumed = new Set(), directory = opendirSync(store.directory);
  let count = 0;
  try {
    for (;;) {
      const entry = directory.readSync();
      if (!entry) break;
      if (++count > MAX_INVENTORY) throw Error('repair namespace inventory exceeds its finite bound');
      const request = REQUEST_NAME.exec(entry.name);
      if (request) requests.push(entry.name);
      const notice = NOTICE_NAME.exec(entry.name);
      // ANY older notice artifact consumes the identity, even partial/unreadable
      // evidence. DATA alone is not a notice. Build this map once, not per row.
      if (notice && notice[2] !== 'repair-request.json') consumed.add(notice[1]);
    }
  } finally { directory.closeSync(); }
  return { requests, consumed };
}
function prepare(root, path, token, shellPid, store, names = null) {
  const owner = activeOwner(root, token, shellPid, store);
  path = resolve(path); const match = REQUEST_NAME.exec(basename(path));
  if (dirname(path) !== store.directory || !match) throw Error('repair DATA path is outside its exact namespace');
  names ??= inventory(store);
  // A consumed notice needs no request/original reads, Git proof or adoption.
  if (names.consumed.has(match[1])) return { consumed: true, owner };
  const record = requestRecord(root, path, store);
  const consumer = committedConsumer(root);
  activeOwner(root, token, shellPid, store, owner);
  return { consumed: false, record, owner, consumer };
}
function publishPrepared(root, prepared, token, shellPid, store) {
  if (prepared.consumed) return { consumed: true, attempted: false };
  const { record, owner, consumer } = prepared, request = record.value;
  const prefix = noticeRoot(store, request.id), files = {
    intent: prefix + '.attempt.json', ops: prefix + '.ops.json', output: prefix + '.output',
    terminal: prefix + '.terminal.json', receipt: prefix + '.submission.json',
  };
  const op = {
    op: 'raise', id: request.id, who: 'cloud lane', domain: 'lane',
    doing: 'protected lane delivery source inspection',
    blocked: 'Original ' + request.producer + ' delivery remains unverified. Private evidence reference ' + request.original_attempt.intent_sha256 + '.',
    need: 'Cloud lane: inspect the current source, protected PR checks and findings. Preserve the original attempt as readback-only; this separate uncertainty notice grants no execution, landing or retry authority.',
  };
  activeOwner(root, token, shellPid, store, owner);
  // The intent is the fence. An unconfirmed (not refused) failure stays consumed.
  try {
    writeNew(files.intent, encoded({ version: 1, kind: 'lane-delivery-repair-notification',
      at: new Date().toISOString(), request_sha256: sha(record.raw), request_id: request.id,
      original_intent_sha256: request.original_attempt.intent_sha256, consumer,
      owner: { token: owner.token, shellPid: owner.shellPid, store: owner.store,
        guard: owner.guard, openedSha256: owner.openedSha256 }, readback_only: true,
      ...(() => { const retry_of = refusedNotices(store, request.id); return retry_of.length ? { retry_of } : {}; })() }));
  } catch (error) {
    if (error.code === 'EEXIST') return { consumed: true, attempted: false };
    throw error;
  }
  writeNew(files.ops, encoded([op]));
  const fd = openSync(files.output, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  let result;
  try {
    if (!own(fstatSync(fd))) throw Error('owned notification output required');
    activeOwner(root, token, shellPid, store, owner);
    // Retain FD8 in this exact child too. An interruption never proves it quiet.
    result = spawnSync(process.execPath, [join(root, 'scripts/lane-deliver.mjs'), 'batch', files.ops, '--receipt', files.receipt],
      { cwd: root, stdio: ['ignore', fd, fd, 'ignore', 'ignore', 'ignore', 'ignore', 'ignore', 8] });
    fsyncSync(fd);
  } finally { closeSync(fd); }
  writeNew(files.terminal, encoded({ version: 1, kind: 'lane-delivery-repair-parent-terminal',
    at: new Date().toISOString(), request_id: request.id, status: result.status,
    signal: result.signal ?? null, error: result.error?.code ?? null, pid: result.pid ?? null,
    readback_only: true, canonical_merge_verified: false }));
  // A readback proving nothing was published moves this notice aside (shared rule)
  // so the next drain retries it; the request itself stays.
  if (!result.signal && !result.error && (result.status === 1 || result.status === 2) &&
      setAsideRefusedAttempt(root, store.directory, request.id, result.status)) {
    throw Error('different repair notice was refused (exit ' + result.status + '); nothing published, retried next drain');
  }
  if (result.status !== 0 || result.signal || result.error) throw Error('different repair notice is unconfirmed and consumed');
  readOwned(files.receipt); // A missing/unsafe receipt never permits a second send.
  return { consumed: true, attempted: true };
}
export function notifyRepair(root, path, token, shellPid) {
  root = resolve(root); const store = storeFor(root), p = prepare(root, path, token, shellPid, store);
  return publishPrepared(root, p, token, shellPid, store);
}
function cursorFrame(value) {
  const raw = Buffer.from(JSON.stringify(value));
  if (raw.length >= CURSOR_FRAME) throw Error('repair progress frame exceeds its fixed bound');
  const frame = Buffer.alloc(CURSOR_FRAME, 32);
  raw.copy(frame); frame[CURSOR_FRAME - 1] = 10;
  return frame;
}
function cursorPayload(value) {
  return { v: value.v, s: value.s, k: value.k, d: value.d, i: value.i, t: value.t, h: value.h, c: value.c };
}
function readCursor(store) {
  const path = join(store.directory, 'repair-drain.cursor');
  if (!present(path)) return { path, info: null, seq: 0, last: null };
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    if (!own(before) || (before.mode & 0o077) || before.size < CURSOR_FRAME || before.size % CURSOR_FRAME !== 0 ||
        !Number.isSafeInteger(before.size)) throw Error('repair progress cursor is partial or unsafe; preserve it readback-only');
    const frame = Buffer.alloc(CURSOR_FRAME); let read = 0;
    while (read < CURSOR_FRAME) {
      const n = readSync(fd, frame, read, CURSOR_FRAME - read, before.size - CURSOR_FRAME + read);
      if (!n) throw Error('repair progress tail is incomplete');
      read += n;
    }
    if (!unchanged(before, fstatSync(fd)) || !unchanged(before, lstatSync(path))) throw Error('repair progress cursor changed during read');
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(frame).trimEnd();
    const value = JSON.parse(text), payload = cursorPayload(value);
    if (Object.keys(value).sort().join(',') !== ['c', 'd', 'h', 'i', 'k', 's', 't', 'v', 'x'].join(',') ||
        value.v !== 1 || !Number.isSafeInteger(value.s) || value.s !== before.size / CURSOR_FRAME ||
        typeof value.k !== 'string' || !REQUEST_NAME.test(value.k) || value.d !== store.dev || value.i !== store.ino ||
        !OID.test(value.h ?? '') || !HASH.test(value.c ?? '') || !Number.isFinite(Date.parse(value.t)) ||
        !HASH.test(value.x ?? '') || sha(encoded(payload)) !== value.x || !cursorFrame({ ...payload, x: value.x }).equals(frame)) {
      throw Error('repair progress tail integrity differs; preserve it readback-only');
    }
    return { path, info: before, seq: value.s, last: value.k };
  } finally { closeSync(fd); }
}
function advanceCursor(root, token, shellPid, store, owner, prior, last, expectedConsumer = null) {
  activeOwner(root, token, shellPid, store, owner);
  const consumer = committedConsumer(root);
  if (expectedConsumer && (consumer.head !== expectedConsumer.head || consumer.source_sha256 !== expectedConsumer.source_sha256)) {
    throw Error('current committed consumer changed before progress append');
  }
  if (!Number.isSafeInteger(prior.seq + 1)) throw Error('repair progress counter exceeds its bound');
  const payload = { v: 1, s: prior.seq + 1, k: last, d: store.dev, i: store.ino,
    t: new Date().toISOString(), h: consumer.head, c: consumer.source_sha256 };
  const frame = cursorFrame({ ...payload, x: sha(encoded(payload)) });
  const flags = constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW | constants.O_NONBLOCK |
    (prior.info ? 0 : constants.O_CREAT | constants.O_EXCL);
  const fd = openSync(prior.path, flags, 0o600);
  try {
    const before = fstatSync(fd);
    if (!own(before) || (before.mode & 0o077) ||
        (prior.info ? !unchanged(prior.info, before) : before.size !== 0) ||
        !unchanged(before, lstatSync(prior.path))) throw Error('repair progress identity or tail changed before append');
    activeOwner(root, token, shellPid, store, owner);
    writeFileSync(fd, frame); fsyncSync(fd);
    const after = fstatSync(fd);
    if (!own(after) || after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size + CURSOR_FRAME ||
        !unchanged(after, lstatSync(prior.path))) throw Error('repair progress append is unconfirmed; preserve it readback-only');
  } finally { closeSync(fd); }
  const current = readCursor(store);
  if (current.seq !== payload.s || current.last !== last) throw Error('repair progress append readback differs');
  return current;
}
export function drainRepairs(root, token, shellPid) {
  root = resolve(root); const store = storeFor(root);
  const owner = activeOwner(root, token, shellPid, store), names = inventory(store), cursor = readCursor(store);
  // Consumption is a namespace fence, not a reason to reopen old source evidence.
  const candidates = names.requests.filter(name => !names.consumed.has(REQUEST_NAME.exec(name)[1])).sort();
  if (!candidates.length) return { consumed: false, attempted: false };
  let start = cursor.last === null ? 0 : candidates.findIndex(name => name > cursor.last);
  if (start < 0) start = 0;
  const count = Math.min(MAX_EVALUATIONS, candidates.length); let last;
  for (let index = 0; index < count; index++) {
    const name = candidates[(start + index) % candidates.length]; last = name;
    let p;
    try { p = prepare(root, join(store.directory, name), token, shellPid, store, names); }
    catch {
      // A held record consumes one bounded evaluation, never execution authority.
      // The append-only hint advances across pages so it cannot starve later work.
      activeOwner(root, token, shellPid, store, owner); continue;
    }
    if (p.consumed) continue;
    // Advance BEFORE the one possible publication. This hint grants no work and
    // never clears any original or failed notice; actual FD8/source is rechecked.
    advanceCursor(root, token, shellPid, store, owner, cursor, name, p.consumer);
    return publishPrepared(root, p, token, shellPid, store); // at most ONE attempt
  }
  advanceCursor(root, token, shellPid, store, owner, cursor, last);
  return { consumed: false, attempted: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, root, ...args] = process.argv.slice(2);
  try {
    if (!root) throw Error('repository required');
    if (mode === 'request' && args.length === 2) console.log(requestRepair(root, ...args));
    else if (mode === 'repair-status' && args.length === 2) {
      process.exitCode = repairStatus(root, ...args);
      console.log(process.exitCode === 2 ? 'Original source-bound parent and push completed normally; no uncertainty notice needed. Landing remains unverified.' :
        'Original delivery needs diagnostic readback; this status grants no execution or resend authority.');
    }
    else if (mode === 'notify' && args.length === 3) {
      const r = notifyRepair(root, ...args);
      console.log(r.attempted ? 'One different Cloud uncertainty notice submitted; canonical merge unverified.' :
        'Original repair notice already consumed; readback only, no new hand.');
    } else if (mode === 'drain' && args.length === 2) {
      const r = drainRepairs(root, ...args);
      console.log(r.attempted ? 'One queued uncertainty notice submitted; canonical merge unverified.' :
        'Bounded repair page inspected; no notice attempted; retained requests remain readback-only.');
    } else throw Error('usage: lane-repair.mjs request|repair-status <repo> <producer> <original-prefix> | notify <repo> <request> <tick-token> <actual-shell-pid> | drain <repo> <tick-token> <actual-shell-pid>');
  } catch (error) {
    console.error('Lane repair held: ' + error.message + '; original evidence retained, no retry.');
    process.exitCode = 1;
  }
}
