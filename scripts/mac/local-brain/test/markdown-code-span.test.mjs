// #2226: a closed double-backtick code span keeps masking an example link that sits after an interior single
// backtick, including when that interior backtick has a matching single partner. Before 2cb9d3df (#2368) the
// partnered case leaked the example link into prose checks; this file pins the fixed behaviour.
import test from 'node:test';
import assert from 'node:assert/strict';
import { maskNonProse } from '../../../lib/markdown-scope.mjs';

const EX = 'docs/EXAMPLE.md';
const keepsShape = (src, out) => {
  assert.equal(out.length, src.length, 'text length is preserved');
  assert.deepEqual([...out].map((c, i) => (c === '\n' ? i : -1)).filter((i) => i >= 0),
    [...src].map((c, i) => (c === '\n' ? i : -1)).filter((i) => i >= 0), 'every newline stays in place');
};

test('double-backtick span masks a link after one interior backtick', () => {
  const src = `See \`\`a \` [ex](${EX}) \`\` here.\n`;
  const out = maskNonProse(src);
  keepsShape(src, out);
  assert.ok(!out.includes(EX), out);
});

test('double-backtick span masks a link after an interior backtick that has a single partner', () => {
  for (const src of [
    `See \`\`a \` b \` [ex](${EX}) \`\` here.\n`,
    `See \`\`\` x \` y \` [ex](${EX}) \`\`\` here.\n`,
    `Lead \`\`\` \` [ex](${EX}) \` \`\`\` tail.\n`,
  ]) {
    const out = maskNonProse(src);
    keepsShape(src, out);
    assert.ok(!out.includes(EX), JSON.stringify(out));
  }
});

test('a span across a soft line break inside one paragraph still masks', () => {
  const src = `See \`\`a \` b\n\` [ex](${EX}) \`\` here.\n`;
  const out = maskNonProse(src);
  keepsShape(src, out);
  assert.ok(!out.includes(EX), JSON.stringify(out));
});

test('controls: ordinary spans mask, real prose links stay visible', () => {
  const src = `A \`[s](${EX})\` and \`\`[d](${EX})\`\` but [real](docs/REAL.md) stays.\n`;
  const out = maskNonProse(src);
  keepsShape(src, out);
  assert.ok(!out.includes(EX), out);
  assert.ok(out.includes('[real](docs/REAL.md)'), out);
});

test('controls: a real link after a closed mixed span stays visible', () => {
  const src = `\`\`a \` b \` c\`\` then [real](docs/REAL.md).\n`;
  const out = maskNonProse(src);
  keepsShape(src, out);
  assert.ok(out.includes('[real](docs/REAL.md)'), out);
});

test('controls: an unclosed double run is literal, so the link after it stays visible', () => {
  const src = `Odd \`\` run then [real](docs/REAL.md) here.\n`;
  const out = maskNonProse(src);
  keepsShape(src, out);
  assert.ok(out.includes('[real](docs/REAL.md)'), out);
});
