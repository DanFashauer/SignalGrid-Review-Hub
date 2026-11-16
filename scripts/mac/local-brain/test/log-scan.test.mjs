import test from 'node:test';
import assert from 'node:assert/strict';
import { runNext } from '../route-runner.mjs';
import { loadRoutingTable } from '../../../lib/task-route.mjs';

// #2176: a read-only log-scan has no proof-policy path, so it is handed off before any executor runs.
test('log-scan is handed off before JobState or any executor call', () => {
  const calls = [];
  const spy = (lane) => (r) => { calls.push(lane); return { ok: true, head: r.head }; };
  const executors = Object.fromEntries(['local-llm', 'local-claude', 'local-codex', 'cloud-final'].map((l) => [l, spy(l)]));
  const tasks = [{ id: 'scan', status: 'queued', priority: 1, scope: 'scripts', dependencies: [], kind: 'log-scan' }];
  const r = runNext({ tasks, scope: 'scripts', table: loadRoutingTable(), repo: 'org/repo', head: 'a'.repeat(40), executors });
  assert.equal(r.status, 'hand');
  assert.equal(r.task, 'scan');
  assert.match(r.why, /read-only log-scan has no proof-policy path yet/);
  assert.ok(r.route);
  assert.equal(r.job, undefined);
  assert.deepEqual(calls, []);
});
