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

// ---- The whole §4.6 family (Root on #2368): every non-comment HTML block kind keeps an opener inside it from
// starting a comment block, each by its own end condition. Each case is RED on d0ce429d and 8da48f7a, which
// masked the visible link; the original helper kept it.
const VISIBLE = '[visible](docs/V.md)';
const RAW_BLOCKS = {
  'type 1 <pre>': '<pre>\n<!--\n</pre>',
  'type 1 <style>': '<style>\n<!--\n</style>',
  'type 1 <textarea>': '<textarea>\n<!--\n</textarea>',
  'type 1 upper-case <SCRIPT>': '<SCRIPT>\n<!--\n</SCRIPT>',
  'type 3 processing instruction': '<?php\n<!--\n?>',
  'type 4 declaration': '<!DOCTYPE html\n<!--\n>',
  'type 5 CDATA': '<![CDATA[\n<!--\n]]>',
  'type 6 block tag': '<table>\n<!--\n</table>',
  'type 6 closing block tag': '</div>\n<!--',
  'type 7 custom tag at block start': '<my-tag>\n<!--\n</my-tag>',
};
for (const [name, block] of Object.entries(RAW_BLOCKS)) {
  test(`${name}: an opener inside it is raw text, and the link after the blank line stays visible`, () => {
    const input = `${block}\n\n${VISIBLE}\n`;
    const out = maskNonProse(input);
    assertShape(input, out);
    const lines = out.split('\n');
    assert.equal(lines[lines.length - 2], VISIBLE, `link lost: ${JSON.stringify(out)}`);
  });
}

test('a fence marker inside a type 7 block does not open a fence that swallows later prose', () => {
  const input = `<Bad>\n\`\`\`\n\n${VISIBLE}\n`;
  const out = maskNonProse(input);
  assertShape(input, out);
  assert.equal(out.split('\n')[3], VISIBLE, `link lost: ${JSON.stringify(out)}`);
});

// Positive controls: once a raw HTML block has ended, a real unclosed comment block still hides the rest.
test('control: a raw block closed on its own line, then a real unclosed comment, still masks to end of input', () => {
  const input = '<script> x </script>\n<!--\n[h](docs/H.md)\n';
  const out = maskNonProse(input);
  assertShape(input, out);
  assert.ok(!out.includes('docs/H.md'), `hidden link leaked: ${JSON.stringify(out)}`);
});

test('control: a type 6 block ended by a blank line, then a real unclosed comment, still masks to end of input', () => {
  const input = '<div>\nx\n</div>\n\n<!--\n[h](docs/H.md)\n';
  const out = maskNonProse(input);
  assertShape(input, out);
  assert.ok(!out.includes('docs/H.md'), `hidden link leaked: ${JSON.stringify(out)}`);
});

// ---- Root's source-derived counterexamples on 8da48f7a (#2368 comment 7003077802), verbatim prefixes. Each
// enclosing non-comment block ends before the appended route, so its inner line-start `<!--` must not own the
// rest of the document, under either treatUnclosedAsFence value. The quoted-attribute cases keep the
// comment-looking text inside an attribute value.
const ROOT_PREFIXES = {
  'type 1 <script>': '<script>\n<!--\n</script>',
  'type 1 <style>': '<style>\n<!--\n</style>',
  'type 1 <textarea>': '<textarea>\n<!--\n</textarea>',
  'type 1 <pre> with a quoted attribute': '<pre title="\n<!--\n">\n</pre>',
  'type 1 end tag that need not match the opener': '<pre>\n<!--\n</SCRIPT>',
  'type 3 <?x': '<?x\n<!--\n?>',
  'type 4 <!A': '<!A\n<!--\n>',
  'type 5 CDATA': '<![CDATA[\n<!--\n]]>',
  'type 6 <div> with a quoted attribute': '<div title="\n<!--\n">',
  'type 7 <x-box> then a quoted attribute': '<x-box>\n<i title="\n<!--\n">',
};
for (const [name, prefix] of Object.entries(ROOT_PREFIXES)) {
  for (const treatUnclosedAsFence of [true, false]) {
    test(`Root counterexample, ${name}, treatUnclosedAsFence:${treatUnclosedAsFence}: the route after the block stays visible`, () => {
      const input = `${prefix}\n\n[visible](docs/V.md)\n`;
      const out = maskNonProse(input, {treatUnclosedAsFence});
      assertShape(input, out);
      const lines = out.split('\n');
      assert.equal(lines[lines.length - 2], '[visible](docs/V.md)', `route lost: ${JSON.stringify(out)}`);
    });
  }
}

// Controls: a real standalone unclosed comment still hides the rest, and starts that are malformed or do not
// match an HTML block kind do not shield it.
const STANDALONE_CONTROLS = {
  'a standalone unclosed comment after a paragraph': 'x\n\n<!--\n[h](docs/H.md)\n',
  'a closed processing instruction, then a real opener': '<?x ?>\n<!--\n[h](docs/H.md)\n',
  'an incomplete <divx start (no HTML block), then a real opener': '<divx\n<!--\n[h](docs/H.md)\n',
  'a four-space indented <pre> (indented code, no HTML block), then a real opener': '    <pre>\n<!--\n[h](docs/H.md)\n',
  '<scriptx> is not type 1: its type 7 block ends at the blank line, then a real opener': '<scriptx>\n\n<!--\n[h](docs/H.md)\n',
};
for (const [name, input] of Object.entries(STANDALONE_CONTROLS)) {
  for (const treatUnclosedAsFence of [true, false]) {
    test(`control, ${name}, treatUnclosedAsFence:${treatUnclosedAsFence}: the hidden route stays masked`, () => {
      const out = maskNonProse(input, {treatUnclosedAsFence});
      assertShape(input, out);
      assert.ok(!out.includes('docs/H.md'), `hidden route leaked: ${JSON.stringify(out)}`);
    });
  }
}

// ---- Root's review of c262ee8e (#2368 comment 7003384467): three preservation/precedence cases.
const NBSP = ' ';

// 1. A thematic break or a setext underline is a real block boundary, so a type 7 block may start right after it.
for (const [name, boundary] of Object.entries({
  'a *** thematic break': '***',
  'a - - - thematic break': '- - -',
  'a setext === underline': 'Title\n===',
  'a setext --- underline': 'Title\n---',
})) {
  test(`type 7 right after ${name} still owns its lines, so its inner opener does not hide the route`, () => {
    const input = `${boundary}\n<x-box>\n<!--\n\n[visible](docs/V.md)\n`;
    const out = maskNonProse(input);
    assertShape(input, out);
    const lines = out.split('\n');
    assert.equal(lines[lines.length - 2], '[visible](docs/V.md)', `route lost: ${JSON.stringify(out)}`);
  });
}

test('control: inside a real paragraph a type 7 tag cannot start a block, so the next line-start opener masks', () => {
  const input = 'para\n<x-box>\n<!--\n[h](docs/H.md)\n';
  const out = maskNonProse(input);
  assertShape(input, out);
  assert.ok(!out.includes('docs/H.md'), `hidden route leaked: ${JSON.stringify(out)}`);
});

// 2. Only ASCII space and tab count as whitespace in start conditions and blank lines; NBSP does not.
test('an NBSP after <script is not a type 1 start, so a standalone unclosed comment still masks to end of input', () => {
  const input = `<script${NBSP}>\n<!--\n</script>\n\n[visible](docs/V.md)\n`;
  const out = maskNonProse(input);
  assertShape(input, out);
  assert.ok(!out.includes('docs/V.md'), `the real comment was shielded: ${JSON.stringify(out)}`);
});

test('a line holding only an NBSP is not blank, so it does not close the enclosing type 6 block', () => {
  const input = `<div title="\n${NBSP}\n<!--\n">\n\n[visible](docs/V.md)\n`;
  const out = maskNonProse(input);
  assertShape(input, out);
  const lines = out.split('\n');
  assert.equal(lines[lines.length - 2], '[visible](docs/V.md)', `route lost: ${JSON.stringify(out)}`);
});

test('a tab after <script is a type 1 start, so its inner opener does not hide the route', () => {
  const input = '<script\t>\n<!--\n</script>\n\n[visible](docs/V.md)\n';
  const out = maskNonProse(input);
  assertShape(input, out);
  assert.equal(out.split('\n')[4], '[visible](docs/V.md)', `route lost: ${JSON.stringify(out)}`);
});

test('a line of only spaces and tabs is blank: it closes a type 6 block, and a real opener after it masks', () => {
  const input = '<div>\n \t \n<!--\n[h](docs/H.md)\n';
  const out = maskNonProse(input);
  assertShape(input, out);
  assert.ok(!out.includes('docs/H.md'), `hidden route leaked: ${JSON.stringify(out)}`);
});

// 3. The text after a closed comment block's `-->` stays visible, and any further comment in it is masked.
test('a second comment in the tail after a block comment is masked; the rest of the tail stays visible', () => {
  const input = '<!-- first --> tail <!-- [hidden](docs/H.md) --> [visible](docs/V.md)\n';
  const out = maskNonProse(input);
  assertShape(input, out);
  assert.ok(!out.includes('docs/H.md'), `second comment leaked: ${JSON.stringify(out)}`);
  assert.ok(out.includes(' tail '), `visible tail lost: ${JSON.stringify(out)}`);
  assert.ok(out.endsWith(' [visible](docs/V.md)\n'), `visible route lost: ${JSON.stringify(out)}`);
});

test('the same holds when the first comment spans lines', () => {
  const input = '<!-- first\nstill --> tail <!-- [hidden](docs/H.md) --> [visible](docs/V.md)\n';
  const out = maskNonProse(input);
  assertShape(input, out);
  assert.ok(!out.includes('docs/H.md'), `second comment leaked: ${JSON.stringify(out)}`);
  assert.ok(out.endsWith(' tail ' + ' '.repeat('<!-- [hidden](docs/H.md) -->'.length) + ' [visible](docs/V.md)\n'), `tail mangled: ${JSON.stringify(out)}`);
});
