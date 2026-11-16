import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitize} from '../../../lib/sanitize.mjs';

// sanitize promises newlines are preserved so reported line numbers stay true. A backslash-LF line continuation
// inside a quoted literal must keep its LF at the same offset while the literal's other contents stay masked.
const lfOffsets = (s) => [...s].flatMap((ch, i) => (ch === '\n' ? [i] : []));
const lines = (s) => s.split('\n').length;

const CONTINUATIONS = {
  'single quote': "const a = 'one\\\ntwo';\nconst after = 1;\n",
  'double quote': 'const b = "one\\\ntwo";\nconst after = 2;\n',
  backtick: 'const c = `one\\\ntwo`;\nconst after = 3;\n',
  'CRLF continuation': 'const d = "one\\\r\ntwo";\r\nconst after = 4;\r\n',
};

for (const [name, src] of Object.entries(CONTINUATIONS)) {
  test(`${name}: every LF keeps its offset and the line count is unchanged`, () => {
    const out = sanitize(src);
    assert.deepEqual(lfOffsets(out), lfOffsets(src));
    assert.equal(lines(out), lines(src));
    assert.equal(out.length, src.length);
  });
  test(`${name}: literal contents stay masked and the following code is intact`, () => {
    const out = sanitize(src);
    assert.ok(!/one|two/.test(out), `literal text leaked: ${JSON.stringify(out)}`);
    assert.match(out, /const after = \d;/);
  });
}

test('controls: escaped quotes, comments and following code keep their existing output', () => {
  assert.equal(sanitize('x = "a\\"b"; y = 1;'), 'x = "    "; y = 1;');
  assert.equal(sanitize("x = 'it\\'s'; // note\nz = 2;"), "x = '     ';        \nz = 2;");
  assert.equal(sanitize('/* c\nd */ w = `t`;'), '    \n     w = ` `;');
  assert.equal(sanitize('q = "plain"; r = 3;'), 'q = "     "; r = 3;');
});
