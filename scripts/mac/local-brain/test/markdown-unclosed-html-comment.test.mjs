import test from 'node:test';
import assert from 'node:assert/strict';
import {maskNonProse} from '../../../lib/markdown-scope.mjs';

// maskNonProse feeds the doc-orphan and index-banner link parses. CommonMark 0.31.2 §4.6, HTML block type 2: a
// comment block opened at the start of a line (after zero to three spaces) ends at its closer OR at the end of the
// document. An unclosed block's hidden text must therefore never be read as prose. Inline strings only.
const lfOffsets = (s) => [...s].flatMap((ch, i) => (ch === '\n' ? [i] : []));

function assertShape(input, out) {
  assert.equal(out.length, input.length, 'length changed');
  assert.deepEqual(lfOffsets(out), lfOffsets(input), 'an LF moved');
}

for (const indent of ['', ' ', '  ', '   ']) {
  test(`unclosed block opened after ${indent.length} space(s) masks a later multiline link through end of input`, () => {
    const input = `before\n${indent}<!-- hidden\n[example](docs/HIDDEN.md)\nmore hidden\n`;
    const out = maskNonProse(input);
    assertShape(input, out);
    assert.ok(out.startsWith('before\n'), `visible prefix lost: ${JSON.stringify(out)}`);
    assert.equal(out.slice('before\n'.length).trim(), '', `hidden text leaked: ${JSON.stringify(out)}`);
  });
}

test('the issue literal: the trailing example link is no longer prose', () => {
  const input = 'before\n<!-- hidden\n[example](docs/HIDDEN.md)\n';
  const out = maskNonProse(input);
  assertShape(input, out);
  assert.equal(out, 'before\n' + ' '.repeat('<!-- hidden'.length) + '\n' + ' '.repeat('[example](docs/HIDDEN.md)'.length) + '\n');
});

test('an opener at the very end of input is masked and nothing else changes', () => {
  const input = 'visible [v](docs/V.md)\n<!--';
  const out = maskNonProse(input);
  assertShape(input, out);
  assert.equal(out, 'visible [v](docs/V.md)\n    ');
});

test('a closed comment, visible prose, then a later unclosed block: only the hidden parts are masked', () => {
  const input = '<!-- closed -->\nvisible [v](docs/V.md)\n<!-- open\n[h](docs/H.md)\n';
  const out = maskNonProse(input);
  assertShape(input, out);
  const lines = out.split('\n');
  assert.equal(lines[0].trim(), '');
  assert.equal(lines[1], 'visible [v](docs/V.md)');
  assert.equal(lines[2].trim(), '');
  assert.equal(lines[3].trim(), '');
});

test('treatUnclosedAsFence:false still masks a real unclosed comment block', () => {
  const input = 'before\n<!-- hidden\n[example](docs/HIDDEN.md)\n';
  const out = maskNonProse(input, {treatUnclosedAsFence: false});
  assertShape(input, out);
  assert.ok(out.startsWith('before\n'));
  assert.equal(out.slice('before\n'.length).trim(), '');
});

// ---- Preservation: each expected value below is the unchanged helper's actual output on canonical
// 88250b503899292403bf42d5252c665c397e00d6, captured before the repair.

test('preserved: a complete inline-code span holding the opener does not swallow the following prose link', () => {
  assert.equal(maskNonProse('`<!--` then [l](docs/A.md)\n'), '       then [l](docs/A.md)\n');
  assert.equal(maskNonProse('  `<!--` [l](docs/A.md)\n'), '         [l](docs/A.md)\n');
});

test('preserved: an unmatched opener in the middle of a prose line keeps its current behavior', () => {
  const input = 'text <!-- x\n[l](docs/A.md)\n';
  assert.equal(maskNonProse(input), input);
});

test('preserved: four leading spaces is not a comment block (indented code territory)', () => {
  const input = '    <!-- x\n[l](docs/A.md)\n';
  assert.equal(maskNonProse(input), input);
});

test('preserved: an unclosed fence with the default option masks to end of input', () => {
  assert.equal(maskNonProse('a\n```\n<!-- x\n[l](docs/A.md)\n'), 'a\n   \n      \n              \n');
});

test('preserved: treatUnclosedAsFence:false with no comment leaves the unclosed-fence tail as prose', () => {
  assert.equal(maskNonProse('a\n```\n[l](docs/A.md)\n', {treatUnclosedAsFence: false}), 'a\n  `\n[l](docs/A.md)\n');
});

test('preserved: closed backtick and tilde fences, closed comments, single-backtick spans and plain text', () => {
  assert.equal(maskNonProse('x\n```\n[a](docs/A.md)\n```\ny [b](docs/B.md)\n'), 'x\n   \n              \n   \ny [b](docs/B.md)\n');
  assert.equal(maskNonProse('x\n~~~\n[a](docs/A.md)\n~~~\ny\n'), 'x\n   \n              \n   \ny\n');
  assert.equal(maskNonProse('a <!-- c --> b [l](docs/L.md)\n'), 'a            b [l](docs/L.md)\n');
  assert.equal(maskNonProse('see `docs/X.md` and [l](docs/L.md)\n'), 'see             and [l](docs/L.md)\n');
  const plain = 'no opener here [l](docs/L.md)\nsecond line\n';
  assert.equal(maskNonProse(plain), plain);
});

// ---- Block precedence (Codex on #2368): whichever of an HTML comment block or a fence starts FIRST owns its
// lines, decided on the original input. Masking fences first erased a closed comment's `-->` and made it look
// unclosed, which blanked every later link.

test('a closed comment holding a fence marker, then a real fence, leaves the later link visible (Codex P2)', () => {
  const input = '<!--\n~~~~\n-->\n~~~\nexample\n~~~~\n[visible](docs/V.md)\n';
  const out = maskNonProse(input);
  assertShape(input, out);
  const lines = out.split('\n');
  assert.equal(lines[6], '[visible](docs/V.md)', `link lost: ${JSON.stringify(out)}`);
  assert.equal(lines.slice(0, 6).join('').trim(), '', `comment or fence leaked: ${JSON.stringify(out)}`);
});

test('a closed comment holding an unpaired fence marker does not open a fence that swallows later prose', () => {
  const input = '<!--\n```\n-->\n[link](docs/L.md)\n';
  const out = maskNonProse(input);
  assertShape(input, out);
  assert.equal(out.split('\n')[3], '[link](docs/L.md)', `link lost: ${JSON.stringify(out)}`);
});

test('a single-line <!--> and <!---> are closed comment blocks', () => {
  for (const opener of ['<!-->', '<!--->']) {
    const input = `${opener}\n[l](docs/L.md)\n`;
    const out = maskNonProse(input);
    assertShape(input, out);
    assert.equal(out.split('\n')[1], '[l](docs/L.md)', `${opener}: link lost: ${JSON.stringify(out)}`);
  }
});

test('text after a block comment closer on its last line stays visible', () => {
  const input = '<!-- a\nb --> tail [t](docs/T.md)\n';
  const out = maskNonProse(input);
  assertShape(input, out);
  assert.equal(out, ' '.repeat(6) + '\n' + ' '.repeat(5) + ' tail [t](docs/T.md)\n');
});

test('treatUnclosedAsFence:false: a stray unclosed fence does not hide a later unclosed comment block', () => {
  const input = 'a\n```\n<!-- x\n[l](docs/A.md)\n';
  const out = maskNonProse(input, {treatUnclosedAsFence: false});
  assertShape(input, out);
  assert.ok(!out.includes('docs/A.md'), `hidden link leaked: ${JSON.stringify(out)}`);
});

// ---- Raw HTML blocks (Codex on #2368, second round): CommonMark §4.6 has seven HTML block kinds. A `<!--` or a
// fence marker inside an open one is that block's raw text, not a new comment block or fence, and markdown link
// syntax inside a raw HTML block is not a link.

test('a line-start opener inside a <script> block does not hide the link after it (Codex P2)', () => {
  const input = '<script>\n<!--\n</script>\n\n[visible](docs/V.md)\n';
  const out = maskNonProse(input);
  assertShape(input, out);
  assert.equal(out.split('\n')[4], '[visible](docs/V.md)', `link lost: ${JSON.stringify(out)}`);
});

test('a line-start opener inside a <div> block ends with that block at the blank line', () => {
  const input = '<div>\n<!--\n</div>\n\n[visible](docs/V.md)\n';
  const out = maskNonProse(input);
  assertShape(input, out);
  assert.equal(out.split('\n')[4], '[visible](docs/V.md)', `link lost: ${JSON.stringify(out)}`);
});

test('a stray opener in a raw HTML block cannot pair with a later comment and swallow the prose between', () => {
  const input = '<script>\n<!--\n</script>\n\n[link](docs/L.md)\n\n<!-- c -->\n';
  const out = maskNonProse(input);
  assertShape(input, out);
  assert.equal(out.split('\n')[4], '[link](docs/L.md)', `link lost: ${JSON.stringify(out)}`);
  assert.equal(out.split('\n')[6].trim(), '', 'the closed comment must still be masked');
});

test('markdown link syntax inside a raw HTML block is not a route; after the blank line it is', () => {
  const input = '<details>\n[inside](docs/IN.md)\n\n[outside](docs/OUT.md)\n';
  const out = maskNonProse(input);
  assertShape(input, out);
  assert.ok(!out.includes('docs/IN.md'), `raw HTML text read as prose: ${JSON.stringify(out)}`);
  assert.equal(out.split('\n')[3], '[outside](docs/OUT.md)');
});

test('an inline tag alone on a line cannot interrupt a paragraph (type 7), so the paragraph stays prose', () => {
  const input = 'para [a](docs/A.md)\n<span>\n[b](docs/B.md)\n';
  const out = maskNonProse(input);
  assertShape(input, out);
  assert.equal(out, input);
});

test('a closed inline comment spanning lines inside one paragraph is still masked', () => {
  const input = 'a <!-- x\ny --> b [l](docs/L.md)\n';
  const out = maskNonProse(input);
  assertShape(input, out);
  assert.equal(out, 'a       \n      b [l](docs/L.md)\n');
});
