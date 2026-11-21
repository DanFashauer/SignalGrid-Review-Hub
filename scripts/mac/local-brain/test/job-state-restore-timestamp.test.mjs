import test from 'node:test';
import assert from 'node:assert/strict';
import { JobState } from '../job-state.mjs';

function savedStateWithTimestamp(timestamp) {
  return {
    jobId: 'j',
    repository: 'r',
    assignedWorkerId: 'w',
    startingCommit: 'c',
    status: 'ASSIGNED',
    stateVersion: 3,
    checkpoints: [
      { id: 1, type: 'note', workerId: 'w', timestamp, details: {} },
    ],
  };
}

test('restore rejects an empty checkpoint timestamp with the index 0 error', () => {
  assert.throws(() => JobState.restore(savedStateWithTimestamp('')), {
    name: 'Error',
    message: 'Invalid saved checkpoint at index 0',
  });
});

for (const timestamp of [' ', 'not a time', '2026-01-01']) {
  test(`restore rejects checkpoint timestamp ${JSON.stringify(timestamp)} with the index 0 error`, () => {
    assert.throws(() => JobState.restore(savedStateWithTimestamp(timestamp)), {
      name: 'Error',
      message: 'Invalid saved checkpoint at index 0',
    });
  });
}

test('restore identifies index 1 when only the second checkpoint timestamp is invalid', () => {
  const saved = savedStateWithTimestamp('2026-01-01T00:00:00.000Z');
  saved.stateVersion = 4;
  saved.checkpoints.push({
    id: 2,
    type: 'note',
    workerId: 'w',
    timestamp: 'not a time',
    details: {},
  });

  assert.throws(() => JobState.restore(saved), {
    name: 'Error',
    message: 'Invalid saved checkpoint at index 1',
  });
});

test('restore accepts a checkpoint timestamp in the canonical ISO form', () => {
  const saved = savedStateWithTimestamp('2026-01-01T00:00:00.000Z');

  assert.deepEqual(JobState.restore(saved).snapshot(), saved);
});

test('a restored live snapshot can be completed by its assigned worker', () => {
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
});
