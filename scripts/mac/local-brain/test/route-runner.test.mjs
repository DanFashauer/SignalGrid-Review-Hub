import test from 'node:test';
import assert from 'node:assert/strict';
import { runNext, commandExecutor, executorsFromConfig } from '../route-runner.mjs';
import { loadRoutingTable } from '../../../lib/task-route.mjs';

const table = loadRoutingTable();
const H0 = 'a'.repeat(40), H1 = 'b'.repeat(40), H2 = 'c'.repeat(40), H3 = 'd'.repeat(40);
const queue = (over = {}) => [
  { id: 'low', status: 'queued', priority: 1, scope: 'scripts', dependencies: [], kind: 'docs-restamp' },
  { id: 'top', status: 'queued', priority: 9, scope: 'scripts/mac', dependencies: [], kind: 'gate-or-proof', ...over },
];
const base = (executors, extra = {}) => ({ tasks: queue(), scope: 'scripts', table, repo: 'org/repo', head: H0, executors, ...extra });

// Honest executors: each reports exactly what its route pass asked for.
const FINDINGS = [{ id: 'F1', severity: 'P2', text: 'missing refusal test' }];
const PROOF = { command: 'node scripts/preflight.mjs', exitCode: 0, tests: 436, pass: 436, fail: 0, skipped: 0, changedFiles: ['scripts/mac/local-brain/route-runner.mjs'] };
// A local session answers as reviewer on pass 2 and as validator on pass 3.
function session(lane, calls) {
  return (r) => {
    calls.push([lane, r]);
    const base = { ok: true, head: r.pass.pass === 2 ? H2 : H3, effort: r.pass.effort, ...(r.pass.model ? { model: r.pass.model } : {}) };
    if (r.pass.pass === 2) return { ...base, findings: FINDINGS.map((f) => ({ ...f })) };
    return { ...base, proof: { ...PROOF }, findingsAnswered: (r.reviewFindings ?? []).map((f) => ({ id: f.id, disposition: 'fixed' })), openFindings: [] };
  };
}
function honest(calls = []) {
  return {
    'local-llm': (r) => { calls.push(['local-llm', r]); return { ok: true, head: H1, effort: r.pass.effort }; },
    'local-claude': session('local-claude', calls),
    'local-codex': session('local-codex', calls),
    'cloud-final': (r) => { calls.push(['cloud-final', r]); return { ok: true, head: r.head, provider: 'claude', model: r.pass.claudeModel, effort: r.pass.effort, deliveredRef: 'lane/local-mail-x@' + r.head }; },
  };
}

test('an empty or out-of-scope queue is idle, and nothing runs', () => {
  const calls = [];
  assert.deepEqual(runNext(base(honest(calls), { tasks: [] })), { status: 'idle' });
  assert.deepEqual(runNext(base(honest(calls), { scope: 'docs' })), { status: 'idle' });
  assert.equal(calls.length, 0);
});

test('the top-priority task runs local LLM -> local Claude review -> local Codex checks -> cloud, in that order, carrying each head forward', () => {
  const calls = [];
  const r = runNext(base(honest(calls)));
  assert.equal(r.status, 'handed-to-cloud');
  assert.equal(r.task, 'top');
  assert.deepEqual(calls.map(([lane, req]) => [lane, req.pass.pass]), [['local-llm', 1], ['local-claude', 2], ['local-codex', 3], ['cloud-final', 4]]);
  assert.deepEqual(calls.map(([, req]) => req.head), [H0, H1, H2, H3]);
  assert.equal(calls[0][1].role, 'devex-tooling-engineer');
  assert.equal(r.job.status, 'ASSIGNED', 'the cloud completes the job after its final review, not the runner');
  assert.equal(r.job.assignedWorkerId, 'cloud-final');
  const types = r.job.checkpoints.map((c) => c.type);
  assert.deepEqual(types.filter((t) => t !== 'handoff'), ['pass', 'pass', 'pass', 'verification', 'cloud-handoff']);
  const handoffs = r.job.checkpoints.filter((c) => c.type === 'handoff').map((c) => c.details.to);
  assert.deepEqual(handoffs, ['local-claude', 'local-codex', 'cloud-final']);
});

test('the review findings reach pass 3 and the cloud hand-off, with pass 3 answers and open findings recorded', () => {
  const calls = [];
  const ex = honest(calls);
  const f3 = ex['local-codex'];
  ex['local-codex'] = (r) => ({ ...f3(r), openFindings: [{ id: 'F2', text: 'follow-up for cloud' }] });
  const r = runNext(base(ex));
  assert.equal(r.status, 'handed-to-cloud');
  const p3 = calls.find(([, req]) => req.pass.pass === 3)[1];
  assert.deepEqual(p3.reviewFindings.map((f) => f.id), ['F1']);
  const p4 = calls.find(([, req]) => req.pass.pass === 4)[1];
  assert.deepEqual(p4.reviewFindings.map((f) => f.id), ['F1']);
  assert.deepEqual(p4.findingsAnswered, [{ id: 'F1', disposition: 'fixed' }]);
  assert.deepEqual(p4.openFindings.map((f) => f.id), ['F2']);
  const hand = r.job.checkpoints.find((c) => c.type === 'cloud-handoff').details;
  assert.deepEqual(hand.reviewFindings.map((f) => f.id), ['F1']);
  assert.deepEqual(hand.openFindings.map((f) => f.id), ['F2']);
  const v = r.job.checkpoints.find((c) => c.type === 'verification').details;
  assert.deepEqual(v, { command: PROOF.command, exitCode: 0, passed: 436 });
});

test('a task scoped under a dot-directory (.claude) is blocked by the proof policy, not bypassed', () => {
  const ex = honest();
  const f3 = ex['local-codex'];
  ex['local-codex'] = (r) => ({ ...f3(r), proof: { ...PROOF, changedFiles: ['.claude/skills/x/SKILL.md'] } });
  const r = runNext(base(ex, { tasks: [{ id: 'skill', status: 'queued', priority: 5, scope: '.claude', dependencies: [], kind: 'agent-or-skill' }], scope: '.claude' }));
  assert.equal(r.status, 'hand');
  assert.match(r.why, /did not pass the brain's proof policy/);
});

test('a Codex cloud reviewer keeps its own model choice at the review effort, and the hand-off records the provider', () => {
  const ex = honest();
  const f = ex['cloud-final'];
  ex['cloud-final'] = (r) => ({ ...f(r), provider: 'codex', model: 'codex-own-choice', effort: r.pass.effort });
  const r = runNext(base(ex));
  assert.equal(r.status, 'handed-to-cloud');
  const hand = r.job.checkpoints.find((c) => c.type === 'cloud-handoff').details;
  assert.equal(hand.provider, 'codex');
});

test('reviewLane local-codex swaps the two local sessions', () => {
  const calls = [];
  const r = runNext(base(honest(calls), { reviewLane: 'local-codex' }));
  assert.equal(r.status, 'handed-to-cloud');
  assert.deepEqual(calls.map(([lane]) => lane), ['local-llm', 'local-codex', 'local-claude', 'cloud-final']);
});

test('the review pass runs on the review tier (opus, max) even for a mechanical kind', () => {
  const calls = [];
  const r = runNext(base(honest(calls), { tasks: [queue()[0]] }));
  assert.equal(r.status, 'handed-to-cloud');
  const review = calls.find(([, req]) => req.pass.pass === 2)[1].pass;
  assert.equal(review.model, 'opus'); assert.equal(review.effort, 'max');
});

for (const [label, mutate, why] of [
  ['a missing executor for a lane', (e) => { delete e['local-codex']; }, /pass 3 on local-codex has no executor configured/],
  ['a pass that silently ran on a lower effort', (e) => { const f = e['local-claude']; e['local-claude'] = (r) => ({ ...f(r), effort: 'high' }); }, /ran at effort "high", route asked for max/],
  ['a review that silently ran on a smaller model', (e) => { const f = e['local-claude']; e['local-claude'] = (r) => ({ ...f(r), model: 'sonnet' }); }, /ran on "sonnet", route asked for opus/],
  ['pass 3 whose proof exits non-zero', (e) => { const f = e['local-codex']; e['local-codex'] = (r) => ({ ...f(r), proof: { ...PROOF, exitCode: 1 } }); }, /did not pass the brain's proof policy/],
  ['pass 3 whose proof reports a failed test despite exit 0 (Codex #2142 example: tests 2, pass 1, fail 1)', (e) => { const f = e['local-codex']; e['local-codex'] = (r) => ({ ...f(r), proof: { ...PROOF, tests: 2, pass: 1, fail: 1, skipped: 0 } }); }, /did not pass the brain's proof policy/],
  ['pass 3 whose proof skipped a test', (e) => { const f = e['local-codex']; e['local-codex'] = (r) => ({ ...f(r), proof: { ...PROOF, tests: 437, pass: 436, skipped: 1 } }); }, /did not pass the brain's proof policy/],
  ['pass 3 whose proof changed a file outside the task scope', (e) => { const f = e['local-codex']; e['local-codex'] = (r) => ({ ...f(r), proof: { ...PROOF, changedFiles: ['lib/signalgrid-core/x.ts'] } }); }, /did not pass the brain's proof policy/],
  ['pass 3 that does not answer a review finding', (e) => { const f = e['local-codex']; e['local-codex'] = (r) => ({ ...f(r), findingsAnswered: [] }); }, /did not answer review finding\(s\) F1/],
  ['a review that returns no findings list', (e) => { const f = e['local-claude']; e['local-claude'] = (r) => { const x = f(r); if (r.pass.pass === 2) delete x.findings; return x; }; }, /returned no findings list/],
  ['an executor that throws', (e) => { e['local-llm'] = () => { throw new Error('model not loaded'); }; }, /pass 1 on local-llm threw: model not loaded/],
  ['an executor that reports failure', (e) => { e['local-llm'] = () => ({ ok: false, why: 'out of memory' }); }, /reported failure: out of memory/],
  ['an executor that answers no head', (e) => { const f = e['local-llm']; e['local-llm'] = (r) => ({ ...f(r), head: 'abc' }); }, /full 40-character head/],
  ['a Claude cloud reviewer reporting a smaller model (Root #2142/6896173894: provider claude, model haiku, effort max)', (e) => { const f = e['cloud-final']; e['cloud-final'] = (r) => ({ ...f(r), provider: 'claude', model: 'haiku', effort: 'max' }); }, /ran on "haiku", route asked for opus/],
  ['a cloud reviewer naming no provider', (e) => { const f = e['cloud-final']; e['cloud-final'] = (r) => { const x = f(r); delete x.provider; return x; }; }, /named no known cloud provider/],
  ['a cloud reviewer naming an unknown provider', (e) => { const f = e['cloud-final']; e['cloud-final'] = (r) => ({ ...f(r), provider: 'mystery' }); }, /named no known cloud provider/],
  ['a Codex cloud reviewer below the review effort', (e) => { const f = e['cloud-final']; e['cloud-final'] = (r) => ({ ...f(r), provider: 'codex', model: 'any', effort: 'high' }); }, /ran at effort "high", route asked for max/],
  ['a cloud hand-off with no delivered ref', (e) => { const f = e['cloud-final']; e['cloud-final'] = (r) => ({ ...f(r), deliveredRef: '' }); }, /named no delivered ref/],
]) {
  test(`refuses ${label}: a hand, the job INTERRUPTED with the reason, no later pass runs`, () => {
    const calls = [];
    const ex = honest(calls); mutate(ex);
    const r = runNext(base(ex));
    assert.equal(r.status, 'hand');
    assert.match(r.why, why);
    assert.equal(r.job.status, 'INTERRUPTED');
    assert.match(r.job.checkpoints.at(-1).details.reason, why);
    const stoppedAt = Number(r.why.match(/^pass (\d)/)[1]);
    assert.ok(calls.every(([, req]) => req.pass.pass <= stoppedAt), 'nothing after the failed pass ran');
  });
}

test('no local LLM build: a hand before anything runs (pass 1 is never skipped)', () => {
  const calls = [];
  const r = runNext(base(honest(calls), { localLlmAvailable: false }));
  assert.equal(r.status, 'hand'); assert.match(r.why, /pass 1 is missing/); assert.equal(calls.length, 0);
});

test('an unknown kind: the capability-gap hand, routed to the cloud lane; nothing runs', () => {
  const calls = [];
  const r = runNext(base(honest(calls), { tasks: queue({ kind: 'no-such-kind' }) }));
  assert.equal(r.status, 'hand'); assert.match(r.why, /no route for kind/); assert.equal(r.whoCanUnblock, 'cloud lane'); assert.equal(calls.length, 0);
});

test('the review tier unavailable: pending, never run on a lower tier', () => {
  const calls = [];
  const r = runNext(base(honest(calls), { unavailableTiers: ['judgment'] }));
  assert.equal(r.status, 'hand'); assert.match(r.why, /pending/); assert.equal(calls.length, 0);
});

test('an unsupported review lane is refused', () => {
  const r = runNext(base(honest(), { reviewLane: 'cloud-final' }));
  assert.equal(r.status, 'hand'); assert.match(r.why, /refused/);
});

test('a starting head that is not a full sha is refused before anything runs', () => {
  const calls = [];
  const r = runNext(base(honest(calls), { head: 'HEAD' }));
  assert.equal(r.status, 'hand'); assert.equal(calls.length, 0);
});

test('an owner-gated kind still hands to cloud, and the hand-off records ownerGated', () => {
  const r = runNext(base(honest(), { tasks: queue({ kind: 'decision-record' }) }));
  assert.equal(r.status, 'handed-to-cloud');
  assert.equal(r.job.checkpoints.find((c) => c.type === 'cloud-handoff').details.ownerGated, true);
});

test('commandExecutor: JSON in on stdin, JSON out; a non-zero exit or non-JSON output is a failure, never a pass', () => {
  const echo = commandExecutor([process.execPath, '-e', 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);console.log(JSON.stringify({ok:true,head:"' + H1 + '",effort:r.pass.effort}))})']);
  assert.deepEqual(echo({ pass: { effort: 'max' } }), { ok: true, head: H1, effort: 'max' });
  assert.equal(commandExecutor([process.execPath, '-e', 'process.exit(4)'])({}).ok, false);
  assert.equal(commandExecutor([process.execPath, '-e', 'console.log("not json")'])({}).ok, false);
  assert.throws(() => commandExecutor([]), /non-empty array/);
  assert.throws(() => executorsFromConfig(null), /object of lane/);
});
