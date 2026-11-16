import test from 'node:test';
import assert from 'node:assert/strict';
import {isIgnoredUntracked} from '../../../lib/untracked-ignore.mjs';

// Only an actual string can be an ignored scratch path. RegExp.test would coerce any other
// value, so an object that stringifies to a scratch path would be ignored (loosening the
// dirty-tree verdict), and a coercion hook would run or throw. Fail closed: false, no hook.
// A throw is recorded as a wrong verdict so every failure is an assertion, not a crash.
const verdict = (v) => {
  try { return isIgnoredUntracked(v); } catch (e) { return `threw ${e?.name ?? 'value'}`; }
};

test('non-string values are never ignored scratch', () => {
  for (const v of [undefined, null, 0, 1, true, false, 12n, Symbol('node_modules'), [], ['node_modules/a.js'], {}, () => 'node_modules/x']) {
    assert.equal(verdict(v), false, `ignored: ${typeof v}`);
  }
});

test('an object that mimics a scratch path is not ignored', () => {
  const mimic = {toString: () => 'node_modules/hidden.js'};
  assert.equal(verdict(mimic), false);
  const boxed = new String('node_modules/hidden.js');
  assert.equal(verdict(boxed), false);
});

test('a coercion hook is never invoked', () => {
  let calls = 0;
  const hostile = {
    toString() { calls++; throw new Error('toString invoked'); },
    valueOf() { calls++; throw new Error('valueOf invoked'); },
    [Symbol.toPrimitive]() { calls++; throw new Error('toPrimitive invoked'); },
  };
  assert.equal(verdict(hostile), false);
  assert.equal(calls, 0);
});

test('string paths keep their existing verdicts', () => {
  assert.equal(isIgnoredUntracked('node_modules/hidden.js'), true);
  assert.equal(isIgnoredUntracked('mcp/.venv/bin/python'), true);
  assert.equal(isIgnoredUntracked('uv.lock'), false);
  assert.equal(isIgnoredUntracked('mcp/new_module.py'), false);
});
