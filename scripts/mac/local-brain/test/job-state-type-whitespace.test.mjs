import test from 'node:test';
import assert from 'node:assert/strict';
import { JobState } from '../job-state.mjs';

// Removing either checkpoint-type whitespace guard must fail these regressions.
for (const type of ['verification ', ' verification', ' note ']) {
  test(`checkpoint rejects ${JSON.stringify(type)} without recording or advancing the version`, () => {
    const job = new JobState('job', 'repository', 'worker', 'commit');
    job.claim('worker', job.getVersion());
    const version = job.getVersion();
    const checkpointCount = job.snapshot().checkpoints.length;

    assert.throws(
      () => job.checkpoint({ type, details: { anything: true } }, version, 'worker'),
      { name: 'TypeError', message: /type must not have surrounding whitespace/ },
    );
    assert.equal(job.getVersion(), version);
    assert.equal(job.snapshot().checkpoints.length, checkpointCount);
  });
}

test('checkpoint accepts a note without surrounding whitespace', () => {
  const job = new JobState('job', 'repository', 'worker', 'commit');
  job.claim('worker', job.getVersion());
  const version = job.getVersion();

  const result = job.checkpoint(
    { type: 'note', details: { anything: true } }, version, 'worker',
  );

  assert.equal(result.newCheckpoint.type, 'note');
  assert.deepEqual(result.newCheckpoint.details, { anything: true });
  assert.equal(job.getVersion(), version + 1);
  assert.equal(job.snapshot().checkpoints.length, 1);
});

test('restore rejects a saved verification type with trailing whitespace at index 0', () => {
  const saved = {
    jobId: 'job',
    repository: 'repository',
    assignedWorkerId: 'worker',
    startingCommit: 'commit',
    status: 'ASSIGNED',
    stateVersion: 3,
    checkpoints: [{
      id: 1,
      type: 'verification ',
      workerId: 'worker',
      details: { anything: true },
      timestamp: '2026-01-01T00:00:00.000Z',
    }],
  };

  assert.throws(
    () => JobState.restore(saved),
    { message: 'Invalid saved checkpoint at index 0' },
  );
});

test('a restored valid verification lets the assigned worker complete the job', () => {
  const job = new JobState('job', 'repository', 'worker', 'commit');
  job.claim('worker', job.getVersion());
  job.checkpoint({
    type: 'verification',
    details: {
      command: 'inline fixture verification',
      exitCode: 0,
      passed: 1,
      tests: 1,
      pass: 1,
      fail: 0,
      failed: 0,
      errors: 0,
      skipped: 0,
      cancelled: 0,
      todo: 0,
    },
  }, job.getVersion(), 'worker');

  const saved = job.snapshot();
  const restored = JobState.restore(saved);
  assert.deepEqual(restored.snapshot(), saved);
  const completed = restored.complete(true, restored.getVersion(), 'worker');
  assert.equal(completed.status, 'COMPLETED');
  assert.equal(completed.assignedWorkerId, 'worker');
});
