import test from 'node:test';
import assert from 'node:assert/strict';
import {codeOnly} from '../../../lib/code-only.mjs';

// codeOnly promises every source offset is preserved: a position found in the result is the same position in the
// input. An UNTERMINATED template must therefore never gain a closing backtick or interpolation delimiter that the
// input does not contain. Synthetic snippets only.
const UNTERMINATED = {
  'simple template': 'const a = `abc',
  'empty template at EOF': 'x = `',
  'unclosed interpolation': 'const b = `x ${y',
  'unclosed interpolation, nested braces': 'f(`a ${ {k: 1}',
  'closed interpolation, unclosed template': 'const c = `x ${y} z',
  'trailing escape': 'const d = `abc\\',
};

for (const [name, src] of Object.entries(UNTERMINATED)) {
  for (const keepStrings of [false, true]) {
    test(`${name}: output length equals input length (keepStrings=${keepStrings})`, () => {
      assert.equal(codeOnly(src, keepStrings).length, src.length);
    });
  }
  test(`${name}: keepStrings=true returns the original text`, () => {
    assert.equal(codeOnly(src, true), src);
  });
}

test('positive controls: closed templates and ordinary code keep their exact output', () => {
  assert.equal(codeOnly('const a = `abc`;'), 'const a = `   `;');
  assert.equal(codeOnly('const a = `abc`;', true), 'const a = `abc`;');
  assert.equal(codeOnly('t = `a ${b} c`;'), 't = `   (b)  `;');
  assert.equal(codeOnly('t = `a ${b} c`;', true), 't = `a ${b} c`;');
  assert.equal(codeOnly('let x = 1 + y; // note'), 'let x = 1 + y;        ');
  assert.equal(codeOnly('s = "ab"; r = /q/g;'), 's = "  "; r =    g;');
});
