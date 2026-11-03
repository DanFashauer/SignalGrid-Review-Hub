import test from 'node:test';
import assert from 'node:assert/strict';
import JobState, { JobState as NamedJobState } from '../job-state.mjs';

const make = () => new JobState('job-1', 'org/repo', 'worker-a', 'abc123');
const claim = (job) => job.claim('worker-a', job.getVersion());
const verify = (job, workerId = job.assignedWorkerId) => job.checkpoint({
  type: 'verification',
  details: { command: 'node --test scripts/mac/local-brain/test/job-state.test.mjs', exitCode: 0, passed: 18 },
}, job.getVersion(), workerId);

test('imports the real implementation, not a duplicate test class', () => {
  assert.strictEqual(NamedJobState, JobState);
  assert.equal(typeof JobState.prototype.claim, 'function');
});

test('constructor records the job identity and begins pending at version 1', () => {
  const job = make();
  assert.equal(job.jobId, 'job-1');
  assert.equal(job.repository, 'org/repo');
  assert.equal(job.assignedWorkerId, 'worker-a');
  assert.equal(job.startingCommit, 'abc123');
  assert.equal(job.status, 'PENDING');
  assert.equal(job.getVersion(), 1);
  assert.deepEqual(job.checkpoints, []);
});

test('constructor rejects missing or invalid identity fields', () => {
  for (const args of [
    ['', 'repo', 'worker', 'abc'], ['job', '', 'worker', 'abc'],
    ['job', 'repo', ' ', 'abc'], ['job', 'repo', 'worker', ''],
    [3, 'repo', 'worker', 'abc'],
  ]) assert.throws(() => new JobState(...args), /non-empty string/);
});

test('assigned worker can claim once, version advances', () => {
  const job = make();
  const claimed = claim(job);
  assert.equal(claimed.status, 'ASSIGNED');
  assert.equal(job.getVersion(), 2);
  assert.throws(() => job.claim('worker-a', 2), /Invalid transition/);
});

test('competing worker cannot claim reserved job', () => {
  const job = make();
  assert.throws(() => job.claim('worker-b', 1), /Competing worker claim/);
  assert.equal(job.status, 'PENDING');
  assert.equal(job.getVersion(), 1);
});

test('stale and missing state versions reject mutations without changes', () => {
  const job = make();
  assert.throws(() => job.claim('worker-a'), /Expected state version/);
  claim(job);
  assert.throws(() => job.checkpoint({ type: 'build', details: { step: 1 } }, 1, 'worker-a'), /Stale state version/);
  assert.throws(() => job.handoff('worker-b', 1, 'worker-a'), /Stale state version/);
  assert.equal(job.getVersion(), 2);
  assert.equal(job.checkpoints.length, 0);
});

test('checkpoint records real copy of details and advances version', () => {
  const job = make();
  claim(job);
  const original = { changedFiles: ['a.mjs'] };
  const result = job.checkpoint({ type: 'build', details: original }, 2, 'worker-a');
  assert.equal(result.stateVersion, 3);
  assert.equal(result.newCheckpoint.type, 'build');
  assert.equal(result.newCheckpoint.id, 1);
  assert.equal(result.newCheckpoint.workerId, 'worker-a');
  assert.match(result.newCheckpoint.timestamp, /^\d{4}-\d\d-\d\dT/);
  original.changedFiles.push('unwanted.mjs');
  assert.deepEqual(job.checkpoints[0].details.changedFiles, ['a.mjs']);
});

test('checkpoint rejects invalid data, version and unauthorized worker', () => {
  const job = make();
  assert.throws(() => job.checkpoint({ type: 'build', details: {} }, 1, 'worker-a'), /Invalid transition/);
  claim(job);
  assert.throws(() => job.checkpoint(null, 2, 'worker-a'), /Checkpoint must be/);
  assert.throws(() => job.checkpoint({ type: 'build' }, 2, 'worker-a'), /details are required/);
  assert.throws(() => job.checkpoint({ type: 'build', details: {} }, 2, 'worker-b'), /Competing worker claim/);
  assert.equal(job.getVersion(), 2);
});

test('handoff changes worker, records provenance, and invalidates old ownership', () => {
  const job = make();
  claim(job);
  const state = job.handoff('worker-b', 2, 'worker-a');
  assert.equal(state.assignedWorkerId, 'worker-b');
  assert.equal(state.stateVersion, 3);
  assert.deepEqual(job.checkpoints[0].details, { from: 'worker-a', to: 'worker-b' });
  assert.throws(() => job.checkpoint({ type: 'build', details: 1 }, 3, 'worker-a'), /Competing worker claim/);
  const newOwner = job.checkpoint({ type: 'build', details: 1 }, 3, 'worker-b');
  assert.equal(newOwner.stateVersion, 4);
});

test('duplicate handoff and stale handoff are rejected', () => {
  const job = make();
  claim(job);
  assert.throws(() => job.handoff('worker-a', 2, 'worker-a'), /Duplicate handoff/);
  job.handoff('worker-b', 2, 'worker-a');
  assert.throws(() => job.handoff('worker-c', 2, 'worker-a'), /Stale state version/);
  assert.throws(() => job.handoff('worker-c', 3, 'worker-a'), /Competing worker claim/);
  assert.equal(job.checkpoints.length, 1);
});

test('interruption requires owner and can be resumed by another worker', () => {
  const job = make();
  claim(job);
  assert.throws(() => job.interrupt('cancelled', 2, 'worker-b'), /Competing worker claim/);
  const interrupted = job.interrupt('process ended', 2, 'worker-a');
  assert.equal(interrupted.status, 'INTERRUPTED');
  assert.equal(interrupted.stateVersion, 3);
  assert.throws(() => job.checkpoint({ type: 'build', details: {} }, 3, 'worker-a'), /Invalid transition/);
  assert.throws(() => job.resume('worker-b', 2), /Stale state version/);
  const resumed = job.resume('worker-b', 3);
  assert.equal(resumed.status, 'ASSIGNED');
  assert.equal(resumed.assignedWorkerId, 'worker-b');
  assert.equal(resumed.stateVersion, 4);
  assert.deepEqual(job.checkpoints.map((x) => x.type), ['interruption', 'resume']);
});

test('cannot resume non-interrupted job or repeat interruption', () => {
  const job = make();
  assert.throws(() => job.resume('worker-b', 1), /Invalid transition/);
  claim(job);
  job.interrupt('reboot', 2, 'worker-a');
  assert.throws(() => job.interrupt('reboot', 3, 'worker-a'), /Invalid transition/);
});

test('complete rejects boolean alone with no successful verification evidence', () => {
  const job = make();
  claim(job);
  assert.throws(() => job.complete(true, 2, 'worker-a'), /fresh successful verification/);
  assert.throws(() => job.complete(false, 2, 'worker-a'), /Cannot complete unverified/);
  assert.throws(() => job.failIncomplete(), /Cannot complete unverified/);
  assert.equal(job.status, 'ASSIGNED');
});

test('verification checkpoint requires command, real passing count and exit 0', () => {
  const job = make();
  claim(job);
  for (const details of [
    { command: 'node --test', exitCode: 1, passed: 1 },
    { command: '', exitCode: 0, passed: 1 },
    { command: 'node --test', exitCode: 0, passed: 0 },
    { command: 'node --test', exitCode: 0, passed: -1 },
    { exitCode: 0, passed: 1 },
  ]) assert.throws(() => job.checkpoint({ type: 'verification', details }, 2, 'worker-a'), /Verification requires/);
  assert.equal(job.getVersion(), 2);
});

test('verified completion advances version and cannot be repeated', () => {
  const job = make();
  claim(job);
  verify(job);
  const done = job.complete(true, job.getVersion(), 'worker-a');
  assert.equal(done.status, 'COMPLETED');
  assert.equal(done.stateVersion, 4);
  assert.throws(() => job.complete(true, job.getVersion(), 'worker-a'), /Invalid transition/);
});

test('completion requires verification after handoff, not a prior worker proof', () => {
  const job = make();
  claim(job);
  verify(job);
  job.handoff('worker-b', job.getVersion(), 'worker-a');
  assert.throws(() => job.complete(true, job.getVersion(), 'worker-b'), /fresh successful verification/);
  verify(job, 'worker-b');
  assert.equal(job.complete(true, job.getVersion(), 'worker-b').status, 'COMPLETED');
});

test('completion requires latest checkpoint to be verification', () => {
  const job = make();
  claim(job);
  verify(job);
  job.checkpoint({ type: 'build', details: { changed: 1 } }, job.getVersion(), 'worker-a');
  assert.throws(() => job.complete(true, job.getVersion(), 'worker-a'), /fresh successful verification/);
  verify(job);
  assert.equal(job.complete(true, job.getVersion(), 'worker-a').status, 'COMPLETED');
});

test('snapshot deep-copy and restore preserve interrupted state', () => {
  const job = make();
  claim(job);
  job.checkpoint({ type: 'build', details: { files: ['a.mjs'] } }, 2, 'worker-a');
  job.interrupt('restart', job.getVersion(), 'worker-a');
  const snap = job.snapshot();
  snap.checkpoints[0].details.files.push('corruption');
  assert.deepEqual(job.checkpoints[0].details.files, ['a.mjs']);
  const restored = JobState.restore(job.snapshot());
  assert.deepEqual(restored.snapshot(), job.snapshot());
  assert.equal(restored.resume('worker-b', restored.getVersion()).status, 'ASSIGNED');
  assert.equal(job.status, 'INTERRUPTED');
});

test('restore rejects malformed snapshots instead of silently inventing state', () => {
  const snapshot = make().snapshot();
  assert.throws(() => JobState.restore({ ...snapshot, status: 'DONE' }), /Invalid saved status/);
  assert.throws(() => JobState.restore({ ...snapshot, stateVersion: 0 }), /positive safe integer/);
  assert.throws(() => JobState.restore({ ...snapshot, checkpoints: [{ id: 9 }] }), /Invalid saved checkpoint/);
});

test('completed and interrupted states refuse further mutations', () => {
  const job = make();
  claim(job);
  verify(job);
  job.complete(true, job.getVersion(), 'worker-a');
  assert.throws(() => job.handoff('worker-b', job.getVersion(), 'worker-a'), /Invalid transition/);
  assert.throws(() => job.checkpoint({ type: 'build', details: 1 }, job.getVersion(), 'worker-a'), /Invalid transition/);
  assert.throws(() => job.claim('worker-a', job.getVersion()), /Invalid transition/);
});

const malformedVerificationDetails = [
  { exitCode: 0, passed: 'not-a-number' },
  { command: 'node --test', exitCode: 0, passed: '1' },
  { command: 'node --test', exitCode: 0, passed: 1.5 },
  { command: 'node --test', exitCode: 0, passed: Number.MAX_SAFE_INTEGER + 1 },
  { command: 'node --test', exitCode: 0, passed: null },
  { command: 'node --test', exitCode: 0, passed: 0 },
  { command: 'node --test', exitCode: '0', passed: 1 },
  { command: 'node --test', exitCode: 1, passed: 1 },
  { command: '   ', exitCode: 0, passed: 1 },
  { command: ['node --test'], exitCode: 0, passed: 1 },
  null,
  [],
];

test('restore rejects malformed verification evidence before it can complete a job', () => {
  const job = make();
  claim(job);
  verify(job);
  for (const details of malformedVerificationDetails) {
    const saved = job.snapshot();
    saved.checkpoints[0].details = details;
    assert.throws(() => JobState.restore(saved), /Invalid saved verification checkpoint/,
      `persisted verification must refuse ${JSON.stringify(details)}`);
  }
});

test('complete revalidates command, strict exit code and positive safe integer count', () => {
  for (const details of malformedVerificationDetails) {
    const job = make();
    claim(job);
    verify(job);
    // The class exposes its in-memory fields; completion must validate again even
    // when a caller mutates evidence after checkpoint() originally accepted it.
    job.checkpoints[0].details = details;
    const before = job.snapshot();
    assert.throws(() => job.complete(true, 3, 'worker-a'), /fresh successful verification/,
      `completion must refuse ${JSON.stringify(details)}`);
    assert.deepEqual(job.snapshot(), before);
  }
});

test('restore refuses completed snapshots without fresh verification by the assigned worker', () => {
  const job = make();
  claim(job);
  verify(job);
  job.complete(true, job.getVersion(), 'worker-a');
  const valid = job.snapshot();
  const absent = { ...valid, checkpoints: [] };
  const wrongOwner = structuredClone(valid);
  wrongOwner.checkpoints[0].workerId = 'worker-b';
  const notLatest = structuredClone(valid);
  notLatest.checkpoints[0].type = 'build';
  for (const saved of [absent, wrongOwner, notLatest]) {
    assert.throws(() => JobState.restore(saved), /Completed saved state requires fresh successful verification/);
  }
  for (const details of malformedVerificationDetails) {
    const saved = structuredClone(valid);
    saved.checkpoints[0].details = details;
    assert.throws(() => JobState.restore(saved), /Invalid saved verification checkpoint/);
  }
});

test('valid restored verification completes without weakening stale-version checks', () => {
  const job = make();
  claim(job);
  verify(job);
  const restored = JobState.restore(job.snapshot());
  assert.throws(() => restored.complete(true, 2, 'worker-a'), /Stale state version/);
  assert.equal(restored.getVersion(), 3);
  assert.equal(restored.complete(true, 3, 'worker-a').status, 'COMPLETED');
  assert.equal(restored.getVersion(), 4);
  assert.equal(job.status, 'ASSIGNED');
});

test('valid completed snapshots restore as terminal with the same evidence and version', () => {
  const job = make();
  claim(job);
  verify(job);
  job.complete(true, job.getVersion(), 'worker-a');
  const saved = job.snapshot();
  const restored = JobState.restore(saved);
  assert.deepEqual(restored.snapshot(), saved);
  assert.throws(() => restored.complete(true, 3, 'worker-a'), /Stale state version/);
  assert.throws(() => restored.complete(true, 4, 'worker-a'), /Invalid transition/);
});
