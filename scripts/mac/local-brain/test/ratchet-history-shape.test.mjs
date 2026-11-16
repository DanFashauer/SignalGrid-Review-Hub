import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ratchetAction, readRatchetFile} from '../../../lib/ratchet-read.mjs';

// Genesis must be PROVEN: only an exact boolean `false` from the history probe means "no git history". Any other
// value (missing, falsy, truthy non-boolean) is an unknown answer, and an unknown answer must refuse, never rebaseline.
const UNKNOWN = [undefined, null, 0, '', NaN, 0n, 'false', 'no', {}, [], 1, 'true'];
const label = (v) => (typeof v === 'bigint' ? `${v}n` : typeof v === 'string' ? JSON.stringify(v) : String(v));

for (const v of UNKNOWN) {
  test(`ENOENT with history result ${label(v)} refuses genesis`, () => {
    assert.equal(ratchetAction({errCode: 'ENOENT', hasGitHistory: v}).action, 'refuse');
  });
}

test('ENOENT with the hasGitHistory key absent refuses genesis', () => {
  assert.equal(ratchetAction({errCode: 'ENOENT'}).action, 'refuse');
});

test('controls: exact false is genesis, exact true refuses with the existing message', () => {
  const g = ratchetAction({errCode: 'ENOENT', hasGitHistory: false});
  assert.equal(g.action, 'genesis');
  assert.equal(g.why, 'no such file and no git history for it — genuinely the first run');
  const r = ratchetAction({errCode: 'ENOENT', hasGitHistory: true});
  assert.equal(r.action, 'refuse');
  assert.equal(r.why, 'absent from the working tree but PRESENT in git history — a deleted ceiling is not a first run');
});

test('controls: errCode null uses the ceiling without needing history; ESHAPE and read errors refuse', () => {
  assert.deepEqual(ratchetAction({errCode: null}), {action: 'use'});
  assert.equal(ratchetAction({errCode: 'ESHAPE', hasGitHistory: false}).action, 'refuse');
  assert.equal(ratchetAction({errCode: 'EACCES', hasGitHistory: false}).action, 'refuse');
  assert.equal(ratchetAction({errCode: 'EPARSE', hasGitHistory: false}).action, 'refuse');
});

test('readRatchetFile: a missing file with a non-boolean history callback refuses, exact false is genesis', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ratchet-history-shape-'));
  try {
    const missing = join(dir, 'absent-ceiling.json');
    for (const v of UNKNOWN) {
      const r = readRatchetFile(missing, 'max', () => v);
      assert.equal(r.action, 'refuse', `history ${label(v)} must refuse`);
      assert.equal(r.errCode, 'ENOENT');
      assert.equal(r.value, null);
    }
    assert.equal(readRatchetFile(missing, 'max', () => false).action, 'genesis');
    assert.equal(readRatchetFile(missing, 'max', () => true).action, 'refuse');
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
