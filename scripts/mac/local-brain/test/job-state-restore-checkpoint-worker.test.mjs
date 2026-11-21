import test from 'node:test';
import assert from 'node:assert/strict';
import { JobState } from '../job-state.mjs';

function savedState(workerId) {
  return {
    jobId: 'j',
    repository: 'r',
    assignedWorkerId: 'w',
    startingCommit: 'c',
    status: 'ASSIGNED',
    stateVersion: 3,
    checkpoints: [{
      id: 1,
      type: 'note',
      workerId,
      timestamp: '2026-01-01T00:00:00.000Z',
      details: {},
    }],
  };
}

test('restore rejects an empty checkpoint worker name at index 0', () => {
  assert.throws(() => JobState.restore(savedState('')), {
    name: 'Error',
    message: 'Invalid saved checkpoint at index 0',
  });
});

test('restore rejects a whitespace-only checkpoint worker name', () => {
  assert.throws(() => JobState.restore(savedState(' ')), {
    name: 'Error',
    message: 'Invalid saved checkpoint at index 0',
  });
});

test('restore identifies index 1 when only the second checkpoint worker is empty', () => {
  const saved = savedState('w');
  saved.checkpoints.push({ ...saved.checkpoints[0], id: 2, workerId: '' });

  assert.throws(() => JobState.restore(saved), {
    name: 'Error',
    message: 'Invalid saved checkpoint at index 1',
  });
});

test('restore preserves checkpoints written by a different worker', () => {
  const single = savedState('other');
  const withHistory = savedState('w');
  withHistory.checkpoints.push({ ...withHistory.checkpoints[0], id: 2, workerId: 'other' });

  for (const saved of [single, withHistory]) {
    assert.deepEqual(JobState.restore(saved).snapshot(), saved);
  }
});

test('a restored verified snapshot can be completed by the assigned worker', () => {
  const job = new JobState('j', 'r', 'w', 'c');
  job.claim('w', job.getVersion());
  job.checkpoint({
    type: 'verification',
    details: { command: 'fixture verification', exitCode: 0, passed: 1 },
  }, job.getVersion(), 'w');

  const saved = job.snapshot();
  const restored = JobState.restore(saved);
  assert.deepEqual(restored.snapshot(), saved);

  const completed = restored.complete(true, restored.getVersion(), 'w');
  assert.equal(completed.status, 'COMPLETED');
  assert.equal(completed.assignedWorkerId, 'w');
  assert.equal(completed.stateVersion, saved.stateVersion + 1);
  assert.deepEqual(completed.checkpoints, saved.checkpoints);
});
