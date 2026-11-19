import test from 'node:test';
import assert from 'node:assert/strict';
import {fenceRanges, fencedLineFlags, maskNonProse} from '../../../lib/markdown-scope.mjs';

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
  // Both routes stay prose; the inline tag itself is markup and is blanked (Root on 16c45cff).
  assert.equal(out, 'para [a](docs/A.md)\n      \n[b](docs/B.md)\n');
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

// ---- Root's review of 1963c18d (#2368 comment 7003762100): one shared-whitespace preservation bundle.

// 1. The exported fence functions keep their original closer contract, separate from the strict HTML blank test:
// a closer followed by an NBSP still closes, exactly as on the original helper (6cbf8db3).
test('fenceRanges / fencedLineFlags keep the original closer contract for a closer followed by an NBSP', () => {
  const lines = ['```', 'body', '```\u00a0', '[visible](docs/V.md)'];
  assert.deepEqual(fenceRanges(lines), [{start: 0, end: 2, closed: true}]);
  assert.deepEqual(fencedLineFlags(lines), [true, true, true, false]);
  assert.deepEqual(fencedLineFlags(lines, {treatUnclosedAsFence: false}), [true, true, true, false]);
  const input = lines.join('\n');
  for (const treatUnclosedAsFence of [true, false]) {
    const out = maskNonProse(input, {treatUnclosedAsFence});
    assertShape(input, out);
    assert.equal(out.split('\n')[3], '[visible](docs/V.md)', `route lost: ${JSON.stringify(out)}`);
  }
});

// 2. A CRLF line's trailing CR is its line ending, so a CR-only line is blank and ends a type 6 or type 7 block.
for (const [name, prefix] of Object.entries({
  'type 6 <div> with a quoted attribute': '<div title="\n<!--\n">',
  'type 7 <x-box>': '<x-box>\n<!--',
})) {
  test(`a CRLF blank line after an LF ${name} ends the block, so the route stays visible`, () => {
    const input = `${prefix}\n\r\n[visible](docs/V.md)\n`;
    const out = maskNonProse(input);
    assertShape(input, out);
    const lines = out.split('\n');
    assert.equal(lines[lines.length - 2], '[visible](docs/V.md)', `route lost: ${JSON.stringify(out)}`);
  });
}

test('control: an ASCII space/tab blank line ends the type 6 block the same way', () => {
  const input = '<div title="\n<!--\n">\n \t\n[visible](docs/V.md)\n';
  const out = maskNonProse(input);
  assertShape(input, out);
  assert.equal(out.split('\n')[4], '[visible](docs/V.md)', `route lost: ${JSON.stringify(out)}`);
});

test('control: a CR is a line ending, but an NBSP line is still not blank', () => {
  const input = '<div title="\n\u00a0\r\n<!--\n">\n\n[visible](docs/V.md)\n';
  const out = maskNonProse(input);
  assertShape(input, out);
  const lines = out.split('\n');
  assert.equal(lines[lines.length - 2], '[visible](docs/V.md)', `route lost: ${JSON.stringify(out)}`);
});

// 3. Inline comments: an empty `<!-->` or `<!--->` never swallows the prose after it.
for (const [name, input, expectVisible] of [
  ['an empty <!--> comment', 'Lead <!--> [visible](docs/V.md) <!-- hidden -->\n', '[visible](docs/V.md)'],
  ['an empty <!---> comment', 'Lead <!---> [visible](docs/V.md) <!-- hidden -->\n', '[visible](docs/V.md)'],
]) {
  test(`inline: text after ${name} stays visible`, () => {
    const out = maskNonProse(input);
    assertShape(input, out);
    assert.ok(out.includes(expectVisible), `route lost: ${JSON.stringify(out)}`);
    assert.ok(!out.includes('hidden'), `comment body leaked: ${JSON.stringify(out)}`);
  });
}

test('control: an ordinary inline <!-- … --> and a <!----> comment are still masked whole', () => {
  const input = 'Lead <!-- hidden --> and <!----> [visible](docs/V.md)\n';
  const out = maskNonProse(input);
  assertShape(input, out);
  assert.ok(out.includes('[visible](docs/V.md)') && !out.includes('hidden'), JSON.stringify(out));
});

// 4. Codex on 34d22b5a: a type 4 declaration needs an uppercase letter, and indented code cannot open a paragraph.
for (const [name, input] of [
  ['a lowercase <!foo is prose, not a declaration block', '<!foo\n[visible](docs/V.md)\n'],
  ['indented code cannot supply the paragraph a setext underline needs', '    code\n===\n<span>\n[visible](docs/V.md)\n'],
  ['a tab-indented code line likewise', '\tcode\n===\n<span>\n[visible](docs/V.md)\n'],
]) {
  test(name, () => {
    const out = maskNonProse(input);
    assertShape(input, out);
    assert.ok(out.includes('[visible](docs/V.md)'), `route lost: ${JSON.stringify(out)}`);
  });
}

for (const [name, input] of [
  ['control: an uppercase <!DOCTYPE still starts a declaration block', '<!DOCTYPE\n[hidden](docs/H.md)\n'],
  ['control: an indented line inside an open paragraph is a lazy continuation, so === is still a setext underline', 'para\n    lazy\n===\n<span>\n[hidden](docs/H.md)\n'],
  ['control: a three-space line still opens a paragraph', '   para\n===\n<span>\n[hidden](docs/H.md)\n'],
]) {
  test(name, () => {
    const out = maskNonProse(input);
    assertShape(input, out);
    assert.ok(!out.includes('hidden'), `raw HTML leaked: ${JSON.stringify(out)}`);
  });
}

test('inline: a --!> with no later --> is not a comment at all, so nothing is masked', () => {
  const input = 'a <!-- b\n[visible](docs/V.md)\n--!>\n';
  const out = maskNonProse(input);
  assertShape(input, out);
  assert.ok(out.includes('[visible](docs/V.md)') && out.includes('<!-- b'), JSON.stringify(out));
});

// 5. Inline comments stay inside one paragraph: CommonMark never lets a paragraph cross these boundaries.
for (const [name, input] of [
  ['a thematic break', 'a <!-- b\n***\n[visible](docs/V.md)\n-->\n'],
  ['a setext underline', 'a <!-- b\n===\n[visible](docs/V.md)\n-->\n'],
  ['an ATX heading', 'a <!-- b\n# h\n[visible](docs/V.md)\n-->\n'],
  ['an indented code line after a heading', '# a <!-- b\n    code\n[visible](docs/V.md)\nc --> d\n'],
]) {
  test(`inline: an open <!-- does not reach across ${name}`, () => {
    const out = maskNonProse(input);
    assertShape(input, out);
    assert.ok(out.includes('[visible](docs/V.md)'), `route lost: ${JSON.stringify(out)}`);
  });
}

test('control: a lazy continuation line keeps one paragraph, so its comment is still masked', () => {
  const input = 'a <!-- b\n    lazy [hidden](docs/H.md)\n-->\n';
  const out = maskNonProse(input);
  assertShape(input, out);
  assert.ok(!out.includes('hidden'), JSON.stringify(out));
});

// 6. Leftmost inline construct wins (§6): a `<!--` inside an earlier code span, escape, tag, autolink or (uppercase,
//    cmark-gfm 0.29) declaration never opens a comment, so prose after it stays visible.
for (const [name, input] of [
  ['a code span', '`a <!--` [visible](docs/V.md) -->\n'],
  ['a double-backtick code span', '``a <!--`` [visible](docs/V.md) --> `\n'],
  ['a backslash escape', '\\<!-- [visible](docs/V.md) -->\n'],
  ['a tag attribute', '<a title="<!--">[visible](docs/V.md) -->\n'],
  ['an uppercase inline declaration', 'x <!FOO <!-- b> [visible](docs/V.md) -->\n'],
]) {
  test(`inline: a <!-- inside ${name} opens no comment`, () => {
    const out = maskNonProse(input);
    assertShape(input, out);
    assert.ok(out.includes('[visible](docs/V.md)'), `route lost: ${JSON.stringify(out)}`);
  });
}

test('control: an unmatched backtick is literal, so a following comment is still masked', () => {
  const input = 'a ` b <!-- [hidden](docs/H.md) -->\n';
  const out = maskNonProse(input);
  assertShape(input, out);
  assert.ok(!out.includes('hidden'), JSON.stringify(out));
});

// 7. Renderers disagree on `--` inside an inline comment (0.31.2 hides it, cmark-gfm 0.29 shows it), so it stays visible.
for (const [name, input] of [
  ['holds --', 'a <!-- b -- [visible](docs/V.md) --> d\n'],
  ['holds --!>', 'Lead <!-- b --!> [visible](docs/V.md) -->\n'],
  ['ends in -', 'a <!-- [visible](docs/V.md) ---> d\n'],
]) {
  test(`inline: a comment whose text ${name} is shown by one renderer, so it is not masked`, () => {
    const out = maskNonProse(input);
    assertShape(input, out);
    assert.ok(out.includes('[visible](docs/V.md)'), `route lost: ${JSON.stringify(out)}`);
  });
}

// 8. The rest of a comment block's closing line belongs to that block: it joins no paragraph, so a comment opened in
//    the paragraph above (or in the tail) cannot reach a later block's tail and swallow the prose between.
test('a closed comment block tail is its own segment, so prose between two blocks stays visible', () => {
  const input = 'a <!-- b\n<!---> a <!-- b\n[visible](docs/V.md)\n<!---> -->\n';
  const out = maskNonProse(input);
  assertShape(input, out);
  assert.ok(out.includes('[visible](docs/V.md)'), `route lost: ${JSON.stringify(out)}`);
});

test('control: a comment wholly inside one closed-block tail is still masked', () => {
  const input = '<!-- a --> x <!-- [hidden](docs/H.md) -->\n';
  const out = maskNonProse(input);
  assertShape(input, out);
  assert.ok(!out.includes('hidden') && out.includes(' x '), JSON.stringify(out));
});

// 9. Differential property against the pinned CommonMark renderer (markdown-it 14.3.0, scripts/package.json): for
//    seeded random documents built from the constructs above, every link the renderer turns into a clickable anchor
//    must survive the mask. A failure prints the smallest input it found. Left out on purpose: `</pre>` (markdown-it
//    opens a type 7 block on it, which §4.6 forbids), a lowercase `<!foo` (a declaration for markdown-it's 0.31.2,
//    not for cmark-gfm's 0.29), and link titles holding `<!--` (the documented conservative mask, section 14).
test('differential: no link markdown-it renders as clickable is masked', async () => {
  const { default: MarkdownIt } = await import('markdown-it');
  const md = new MarkdownIt('commonmark');
  const parts = ['para', '    code', '\tcode', '===', '---', '***', '', '<span>', '<div>', '</div>', '<!-- c', '-->',
    '<!-->', '<!--->', '--!>', '<!FOO x', '<!DOCTYPE x>', '<?p', '?>', '```', '~~~', '# h', '  <x-box>', '<pre>',
    '<script>', '</div >', '<x-y a="1">', 'a <!-- b', 'c --> d', '   para', '<![CDATA[', ']]>', '`a <!--`', '` x',
    '``', '\\<!-- e', '<a title="<!--">', 'x <!FOO', 'b> y', '<http://a.b/<!--> z', 'q <?p',
    'r ?> s', '<x <!-- y>'];
  let a = 20261119;
  const rnd = (n) => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) % n;
  };
  const pick = () => parts[rnd(parts.length)];
  const link = '[visible](docs/V.md)';
  const failures = [];
  for (let k = 0; k < 20000 && failures.length < 3; k += 1) {
    const lines = [];
    for (let n = 1 + rnd(5); n > 0; n -= 1) lines.push(rnd(3) === 0 ? `${pick()} ${pick()}` : pick());
    lines.splice(rnd(lines.length + 1), 0, link);
    const input = `${lines.join('\n')}\n`;
    if (!md.render(input).includes('<a href="docs/V.md">visible</a>')) continue;
    if (!maskNonProse(input).includes(link)) failures.push(input);
  }
  assert.deepEqual(failures, [], `visible links masked: ${JSON.stringify(failures)}`);
});

// 10. Root on 32c2efad: only a `]` that closes a real `[` starts a link tail. An unmatched `](` is literal, so a
//     comment after it is still a comment and its link is masked.
test('an unmatched ]( does not shield a comment: the hidden link is masked, the visible one kept', () => {
  const input = 'prefix ](<!-- [hidden](docs/H.md) -->) [visible](docs/V.md)\n';
  const out = maskNonProse(input);
  assertShape(input, out);
  assert.ok(!out.includes('docs/H.md'), `hidden route kept: ${JSON.stringify(out)}`);
  assert.ok(out.includes('[visible](docs/V.md)'), `route lost: ${JSON.stringify(out)}`);
});

test('control: a comment inside a real angle destination is masked and the link after it kept', () => {
  const input = '[a](<!-- x -->) [visible](docs/V.md) -->\n';
  const out = maskNonProse(input);
  assertShape(input, out);
  assert.ok(out.includes('[visible](docs/V.md)'), `route lost: ${JSON.stringify(out)}`);
});

// 11. The other direction: a link markdown-it puts inside an inline comment GitHub also hides (the 0.29 rule), or
//     inside a code span, must be masked, or the gates would credit a route no reader can click. A comment token that
//     swallows a backtick is not judged: markdown-it 14.3.0 lets a later `<!--` take the closing backtick of a code
//     span that opened first, which the spec's leftmost rule (example 344) and cmark-gfm do not.
test('differential: no link hidden inside an inline comment or a code span survives the mask', async () => {
  const { default: MarkdownIt } = await import('markdown-it');
  const md = new MarkdownIt('commonmark');
  const parts = ['para', '    code', '===', '', '<div>', '<!-- c', '-->', '<!-->', 'a <!-- b', 'c --> d', '\\<!-- e',
    '<a title="<!--">', '[a](b "<!--")', '](', ')', '[', ']', 'x <!foo', 'b> y', '# h', '***', 'prefix ](<', 'x >)',
    'prefix ](', '[a](<', 'q <?p', 'r ?> s', '`a <!--`', '` x', '``', '[outer [in](x)](<', '[in]', '[in]: x'];
  const GITHUB_COMMENT = /^<!--(?!-?>)(?:[^-]|-(?!-))*-->$/;
  let a = 7;
  const rnd = (n) => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) % n;
  };
  const pick = () => parts[rnd(parts.length)];
  const hidden = '[hidden](docs/H.md)';
  const failures = [];
  let judged = 0;
  for (let k = 0; k < 40000 && failures.length < 3; k += 1) {
    const lines = [];
    for (let n = 1 + rnd(4); n > 0; n -= 1) lines.push(rnd(2) ? `${pick()} ${pick()}` : pick());
    const at = rnd(lines.length + 1);
    lines.splice(at, 0, `${rnd(2) ? `${pick()} ` : ''}${hidden}${rnd(2) ? ` ${pick()}` : ''}`);
    const input = `${lines.join('\n')}\n`;
    const inComment = md.parse(input, {}).some((t) => t.type === 'inline'
      && t.children.some((c) => c.content.includes('docs/H.md')
        && ((c.type === 'html_inline' && GITHUB_COMMENT.test(c.content) && !c.content.includes('`'))
          || c.type === 'code_inline')));
    if (!inComment) continue;
    judged += 1;
    if (maskNonProse(input).includes('docs/H.md')) failures.push(input);
  }
  assert.ok(judged > 100, `too few judged cases (${judged}): the generator no longer exercises comments`);
  assert.deepEqual(failures, [], `hidden routes kept: ${JSON.stringify(failures)}`);
});

// 12. Root on 16340f4c: (1) a recognized inner link deactivates the outer `[`, so the outer "tail" is text and its
//     comment is masked; a defined reference link does the same, an undefined one does not. (2) A code span that
//     wraps a line is code: a comment-and-link inside it is blanked, never credited.
for (const [name, input] of [
  ['an inner inline link', '[outer [inner](x)](<!-- [hidden](docs/H.md) -->) [visible](docs/V.md)\n'],
  ['an inner defined shortcut reference', '[outer [inner]](<!-- [hidden](docs/H.md) -->) [visible](docs/V.md)\n\n[inner]: x\n'],
  ['an inner defined full reference', '[outer [a][Inner  Ref]](<!-- [hidden](docs/H.md) -->) [visible](docs/V.md)\n\n[inner ref]: x\n'],
  ['a multi-line code span', '`code\nx <!-- [hidden](docs/H.md) -->`\n[visible](docs/V.md)\n'],
]) {
  test(`hidden route masked behind ${name}, visible route kept`, () => {
    const out = maskNonProse(input);
    assertShape(input, out);
    assert.ok(!out.includes('docs/H.md'), `hidden route kept: ${JSON.stringify(out)}`);
    assert.ok(out.includes('[visible](docs/V.md)'), `route lost: ${JSON.stringify(out)}`);
  });
}

// 13. Root on ca93a80b. Link syntax is NOT parsed (see maskInlineComments): a fenced "definition" and Unicode case
//     folding therefore cannot unshield a comment, and both fence options mask H.
for (const [name, input] of [
  ['a fenced line that looks like a reference definition', '[a][<!--] [hidden](docs/H.md) -->\n\n```\n[<!--]: x\n```\n'],
  ['a case-folded reference label (ß / SS)', '[outer [ß]](<!-- [hidden](docs/H.md) -->) [visible](docs/V.md)\n\n[SS]: x\n'],
  ['a lowercase "declaration" (not one under cmark-gfm 0.29)', 'x <!foo <!-- [hidden](docs/H.md) --> y\n'],
]) {
  for (const treatUnclosedAsFence of [true, false]) {
    test(`hidden route masked behind ${name} (treatUnclosedAsFence=${treatUnclosedAsFence})`, () => {
      const out = maskNonProse(input, { treatUnclosedAsFence });
      assertShape(input, out);
      assert.equal(out.length, input.length);
      assert.ok(!out.includes('docs/H.md'), `hidden route kept: ${JSON.stringify(out)}`);
    });
  }
}

// 14. The documented conservative direction: a `<!--` inside a link or image TITLE still opens a comment when a `-->`
//     follows, so a later route can be masked. That is a false orphan the gates report loudly, never a false pass.
for (const [name, input] of [
  ['a link title', '[a](b "<!--") [visible](docs/V.md) -->\n'],
  ['an image title around an inner link', '![outer [inner](x)](y "<!--") [visible](docs/V.md) -->\n'],
]) {
  test(`conservative: a <!-- in ${name} masks through its -->`, () => {
    const out = maskNonProse(input);
    assertShape(input, out);
    assert.ok(!out.includes('docs/V.md'), `expected the conservative mask: ${JSON.stringify(out)}`);
  });
}

// 15. Root on 16c45cff. (1) A recognized raw-HTML token is markup, never prose: it is blanked whole, so a comment or
//     route inside a tag attribute, processing instruction, declaration or CDATA section is never credited, while the
//     genuine route beside it stays. (2) cmark-gfm's whitespace is ASCII only: an NBSP does not make `<!FOO` a
//     declaration, so the comment after it is masked.
for (const [name, input] of [
  ['a tag attribute', 'x <span title="<!-- [hidden](docs/H.md) -->"> [visible](docs/V.md)\n'],
  ['a closing-tag neighbour', 'x </span> <!-- [hidden](docs/H.md) --> [visible](docs/V.md)\n'],
  ['a processing instruction', 'x <?p <!-- [hidden](docs/H.md) --> ?> [visible](docs/V.md)\n'],
  ['a declaration', 'x <!FOO a <!-- [hidden](docs/H.md) --> > [visible](docs/V.md)\n'],
  ['a CDATA section', 'x <![CDATA[ <!-- [hidden](docs/H.md) --> ]]> [visible](docs/V.md)\n'],
  ['an NBSP that does not make a declaration', 'x <!FOO <!-- [hidden](docs/H.md) --> [visible](docs/V.md)\n'],
  ['an NBSP that does not make a tag attribute', 'x <span a="<!-- [hidden](docs/H.md) -->"> [visible](docs/V.md)\n'],
  ['a route inside a tag attribute with no comment', 'x <span title="[hidden](docs/H.md)"> [visible](docs/V.md)\n'],
]) {
  for (const treatUnclosedAsFence of [true, false]) {
    test(`raw HTML: hidden route masked inside ${name}, visible route kept (treatUnclosedAsFence=${treatUnclosedAsFence})`, () => {
      const out = maskNonProse(input, { treatUnclosedAsFence });
      assertShape(input, out);
      assert.equal(out.length, input.length);
      assert.ok(!out.includes('docs/H.md'), `hidden route kept: ${JSON.stringify(out)}`);
      assert.ok(out.includes('[visible](docs/V.md)'), `route lost: ${JSON.stringify(out)}`);
    });
  }
}

for (const [name, input] of [
  ['an ASCII-tab declaration', 'x <!FOO\tbar> [visible](docs/V.md)\n'],
  ['a tag with an attribute split over a line', 'x <span\n  title="t"> [visible](docs/V.md)\n'],
  ['a URI autolink', 'x <https://example.com/a> [visible](docs/V.md)\n'],
]) {
  test(`raw HTML positive: ${name} keeps the route beside it`, () => {
    const out = maskNonProse(input);
    assertShape(input, out);
    assert.ok(out.includes('[visible](docs/V.md)'), `route lost: ${JSON.stringify(out)}`);
  });
}

test('raw HTML positive: a URI autolink is kept as text, not blanked', () => {
  const input = 'see <https://example.com/a> here\n';
  assert.equal(maskNonProse(input), input);
});

// 16. Codex on 50bde160: a paragraph made only of link reference definitions has no content (§4.7), so a `===` or
//     `--` line after it is not a setext underline (§4.3) — it starts a paragraph, and a type 7 tag after that cannot
//     open an HTML block. The visible route must survive; with real text before the underline it is a heading, the
//     tag opens a block, and the route stays masked.
for (const [name, input] of [
  ['the reported case', '[r]: /url\n===\n<span>\n[visible](docs/V.md)\n'],
  ['a `--` underline', '[r]: /url\n--\n<span>\n[visible](docs/V.md)\n'],
  ['a destination on the next line', '[r]:\n/url\n===\n<span>\n[visible](docs/V.md)\n'],
  ['a title on the next line', "[r]: /url\n'title'\n===\n<span>\n[visible](docs/V.md)\n"],
  ['a title across two lines', "[r]: /url 'ti\ntle'\n===\n<span>\n[visible](docs/V.md)\n"],
  ['two definitions', '[a]: <x y> "t"\n [b]: a(b) (t)\n===\n<span>\n[visible](docs/V.md)\n'],
]) {
  test(`reference definitions supply no setext heading: ${name} keeps the route`, () => {
    const out = maskNonProse(input);
    assertShape(input, out);
    assert.ok(out.includes('[visible](docs/V.md)'), `route lost: ${JSON.stringify(out)}`);
  });
}

for (const [name, input] of [
  ['text after the definition', '[r]: /url\ntext\n===\n<span>\n[hidden](docs/H.md)\n'],
  ['a thematic break', '[r]: /url\n---\n<span>\n[hidden](docs/H.md)\n'],
  ['junk after a same-line title', "[r]: /url 't' x\n===\n<span>\n[hidden](docs/H.md)\n"],
  ['a backslash before a space in the destination', "[r]: [r\\ 't'\n===\n<span>\n[hidden](docs/H.md)\n"],
  ['an empty label', '[]: /url\n===\n<span>\n[hidden](docs/H.md)\n'],
]) {
  test(`control: ${name} leaves a real setext heading, so the tag opens a block and the route is masked`, () => {
    const out = maskNonProse(input);
    assertShape(input, out);
    assert.ok(!out.includes('docs/H.md'), `hidden route kept: ${JSON.stringify(out)}`);
  });
}

test('differential: definition-only paragraphs before an underline agree with markdown-it, never crediting a hidden route', async () => {
  const { default: MarkdownIt } = await import('markdown-it');
  const md = new MarkdownIt('commonmark');
  const heads = ['[r]:', '[r]: ', ' [r]:', '   [r]:', '    [r]:', '\t[r]:', '[]:', '[ ]:', '[a\\]b]:', '[a]b]:', '[r] :',
    '[r]:<', '[\\[]:', '[r\\', '[a\nb]:', '[<!--]:', '[`]:'];
  const dests = ['/url', ' /url', '<a b>', '<>', '<a\nb>', '\n/url', '\n\n/url', 'a(b)', 'a(b', 'a)b', 'a\\)b', '', ' ',
    '<a>b', 'x\ty', '/u\\ x', '<a\\>b>', '((((a))))', 'a b', '<a<b>'];
  const titles = ['', " 't'", ' "t"', ' (t)', "\n't'", '\n"t"', " 't", "\n't", " 't' x", "\n't' x", "'t'", " 't\nu'",
    " 't\n\nu'", ' (t(u))', " 't' ", ' x', '\nx', ' "a\\"b"', "\t't'", ' (a\\)b)', "\n   't'", "\n    't'"];
  const unders = ['===', '--', '=', '  ==', '== x', '-- ', '=\t'];
  let a = 20261119;
  const rnd = (n) => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) % n;
  };
  const pick = (xs) => xs[rnd(xs.length)];
  const link = '[visible](docs/V.md)';
  const falseCredits = [];
  let shownKept = 0;
  for (let k = 0; k < 20000 && falseCredits.length < 3; k += 1) {
    const defs = [];
    for (let n = 1 + rnd(3); n > 0; n -= 1) defs.push(rnd(8) === 0 ? pick(['text', 'x <!-- y', '[r]', '']) : pick(heads) + pick(dests) + pick(titles));
    const input = `${defs.join('\n')}\n${pick(unders)}\n<span>\n${link}\n`;
    const shown = md.render(input).includes('<a href="docs/V.md">visible</a>');
    const kept = maskNonProse(input).includes(link);
    if (shown && kept) shownKept += 1;
    if (!shown && kept) falseCredits.push(input);
  }
  assert.ok(shownKept > 1000, `too few visible routes kept (${shownKept}): the definition check no longer fires`);
  assert.deepEqual(falseCredits, [], `hidden routes credited: ${JSON.stringify(falseCredits)}`);
});

// 16b. Root on 50bde160 (4628112709): the reported input under both fence options, and the controls that must keep
//      a real heading — definition-shaped text inside an open paragraph, a definition with no destination of its
//      own, and a complete multi-line definition followed by prose.
for (const treatUnclosedAsFence of [true, false]) {
  test(`reference definitions: the reported input keeps the route (treatUnclosedAsFence=${treatUnclosedAsFence})`, () => {
    const input = '[r]: /url\n===\n<span>\n[visible](docs/V.md)\n';
    const out = maskNonProse(input, { treatUnclosedAsFence });
    assertShape(input, out);
    assert.ok(out.includes('[visible](docs/V.md)'), `route lost: ${JSON.stringify(out)}`);
  });
  for (const [name, input] of [
    ['definition-shaped text inside an open paragraph', 'text\n[r]: /url\n===\n<span>\n[hidden](docs/H.md)\n'],
    ['a definition with no destination before the underline', '[r]:\n===\n<span>\n[hidden](docs/H.md)\n'],
    ['a complete multi-line definition followed by prose', "[r]:\n/url\n'title'\nprose\n===\n<span>\n[hidden](docs/H.md)\n"],
  ]) {
    test(`reference definitions control: ${name} stays a heading, route masked (treatUnclosedAsFence=${treatUnclosedAsFence})`, () => {
      const out = maskNonProse(input, { treatUnclosedAsFence });
      assertShape(input, out);
      assert.ok(!out.includes('docs/H.md'), `hidden route kept: ${JSON.stringify(out)}`);
    });
  }
}

// 17. Root on 50bde160 (4628196374): block-start tags take cmark-gfm 0.29's `spacechar` separators (VT and FF as
//     well as space and tab), so these lines open raw HTML blocks there: H under them is hidden through the blank
//     line and must be masked, while V after the blank line stays. NBSP is not a separator, a type 7 tag cannot
//     interrupt an open paragraph, and a VT after a completed type 7 tag does not make a block.
for (const treatUnclosedAsFence of [true, false]) {
  for (const [name, opener] of [
    ['a VT between a type 7 tag name and its attribute', '<span\vtitle="x">'],
    ['an FF between a type 7 tag name and its attribute', '<span\ftitle="x">'],
    ['a VT inside a type 7 closing tag', '</span\v>'],
    ['an FF after a completed type 7 tag', '<span>\f'],
    ['a VT after a type 1 tag name', '<script\vtype="x">'],
    ['an FF after a type 6 tag name', '<div\fclass="x">'],
  ]) {
    test(`GFM block start: ${name} hides H, keeps V (treatUnclosedAsFence=${treatUnclosedAsFence})`, () => {
      const input = `${opener}\n[H](docs/H.md)\n\n[V](docs/V.md)\n`;
      const out = maskNonProse(input, { treatUnclosedAsFence });
      assertShape(input, out);
      assert.ok(!out.includes('docs/H.md'), `hidden route kept: ${JSON.stringify(out)}`);
      if (!opener.startsWith('<script')) assert.ok(out.includes('[V](docs/V.md)'), `route lost: ${JSON.stringify(out)}`);
    });
  }
  for (const [name, input] of [
    ['an NBSP separator (not a block)', '<span title="x">\n[V](docs/V.md)\n'],
    ['a VT after a completed type 7 tag (not a block)', '<span>\v\n[V](docs/V.md)\n'],
    ['a VT-separated type 7 tag inside an open paragraph', 'para\n<span\vtitle="x">\n[V](docs/V.md)\n'],
  ]) {
    test(`GFM block start control: ${name} keeps V (treatUnclosedAsFence=${treatUnclosedAsFence})`, () => {
      const out = maskNonProse(input, { treatUnclosedAsFence });
      assertShape(input, out);
      assert.ok(out.includes('[V](docs/V.md)'), `route lost: ${JSON.stringify(out)}`);
    });
  }
}

// 18. Root on 50bde160 (4628234136, 7008300193): the block tag sets follow the declared grammar, cmark-gfm
//     0.29.0.gfm.13 (scanners.re 587a12bb). `source` is type 6 there and may interrupt an open paragraph, so H under
//     it is hidden through the blank line; `search` is not (it is 0.31.2's), so inside a paragraph it is only an
//     inline tag and V stays. `textarea` is type 1 there: it interrupts a paragraph and ends at `</textarea>`.
for (const treatUnclosedAsFence of [true, false]) {
  for (const [name, input] of [
    ['`<source>` interrupting a paragraph', 'intro\n<source>\n[H](docs/H.md)\n\n[V](docs/V.md)\n'],
    ['`</SOURCE>` (closing, upper case) interrupting a paragraph', 'intro\n</SOURCE>\n[H](docs/H.md)\n\n[V](docs/V.md)\n'],
    ['`<Source src="x">` interrupting a paragraph', 'intro\n<Source src="x">\n[H](docs/H.md)\n\n[V](docs/V.md)\n'],
    ['a `<textarea>` type 1 block interrupting a paragraph, ended by `</textarea>`', 'intro\n<textarea>\n[H](docs/H.md)\n</textarea>\n[V](docs/V.md)\n'],
  ]) {
    test(`GFM tag sets: ${name} hides H, keeps V (treatUnclosedAsFence=${treatUnclosedAsFence})`, () => {
      const out = maskNonProse(input, { treatUnclosedAsFence });
      assertShape(input, out);
      assert.ok(!out.includes('docs/H.md'), `hidden route kept: ${JSON.stringify(out)}`);
      assert.ok(out.includes('[V](docs/V.md)'), `route lost: ${JSON.stringify(out)}`);
    });
  }
  for (const [name, input] of [
    ['`<search>` inside a paragraph', 'intro\n<search>\n[V](docs/V.md)\n'],
    ['`</Search>` inside a paragraph', 'intro\n</Search>\n[V](docs/V.md)\n'],
  ]) {
    test(`GFM tag sets control: ${name} is not a block, V kept (treatUnclosedAsFence=${treatUnclosedAsFence})`, () => {
      const out = maskNonProse(input, { treatUnclosedAsFence });
      assertShape(input, out);
      assert.ok(out.includes('[V](docs/V.md)'), `route lost: ${JSON.stringify(out)}`);
    });
  }
}

// 19. Root on c28a38ca (7008497439): a CR left inside a line is a line ending to cmark-gfm, so it can never make an
//     invalid definition valid. Both inputs keep a real setext heading: H is masked, V kept. Valid CRLF definitions
//     still supply no heading, so their route survives.
for (const treatUnclosedAsFence of [true, false]) {
  for (const [name, input] of [
    ['a CR-only label', '[\r]: /url\n===\n<span>\n[H](docs/H.md)\n\n[V](docs/V.md)\n'],
    ['a CR inside an angle destination', '[r]: <a\rb>\n===\n<span>\n[H](docs/H.md)\n\n[V](docs/V.md)\n'],
    ['a lone CR in an indented-code line before a definition-only paragraph', '    x\rb> y\n[r]: /url\n===\n<span>\n[H](docs/H.md)\n\n[V](docs/V.md)\n'],
  ]) {
    test(`reference definitions: ${name} is not a definition, H masked, V kept (treatUnclosedAsFence=${treatUnclosedAsFence})`, () => {
      const out = maskNonProse(input, { treatUnclosedAsFence });
      assertShape(input, out);
      assert.ok(!out.includes('docs/H.md'), `hidden route kept: ${JSON.stringify(out)}`);
      assert.ok(out.includes('[V](docs/V.md)'), `route lost: ${JSON.stringify(out)}`);
    });
  }
  for (const [name, input] of [
    ['a CRLF definition', '[r]: /url\r\n===\r\n<span>\r\n[visible](docs/V.md)\r\n'],
    ['a CRLF definition with its title on the next line', "[r]: /url\r\n'title'\r\n===\r\n<span>\r\n[visible](docs/V.md)\r\n"],
  ]) {
    test(`reference definitions positive: ${name} keeps the route (treatUnclosedAsFence=${treatUnclosedAsFence})`, () => {
      const out = maskNonProse(input, { treatUnclosedAsFence });
      assertShape(input, out);
      assert.ok(out.includes('[visible](docs/V.md)'), `route lost: ${JSON.stringify(out)}`);
    });
  }
}

// 20. Codex on 43e53ab5. (1) Under the declared scanner a type 7 start has no tag-name exclusion: a closing
//     `</script>` (or an opening `<script/>`, which type 1 does not take) opens a type 7 block, so a `<!--` inside
//     it is raw text, not a comment block. (2) A closed comment opened after list or block-quote markers stays
//     masked across blank lines. (3) Leading reference-definition lines are not inline-parsed: a backtick in a
//     title cannot pair with prose below. Each under both fence options, with length and LF offsets checked.
for (const treatUnclosedAsFence of [true, false]) {
  for (const [name, input] of [
    ['a `</script>` type 7 block holding `<!--`', '</script>\n<i title="\n<!--\n">\n\n[visible](docs/V.md)\n'],
    ['a backtick in a definition title', '[r]: /url "`"\n[visible](docs/V.md) `\n'],
    ['a `<!--` in a definition title', '[r]: /url "<!--"\n[visible](docs/V.md) -->\n'],
    ['an unclosed comment after a list marker (left to paragraph rules)', '- <!-- x\n\n[visible](docs/V.md)\n'],
  ]) {
    test(`Codex 43e53ab5: ${name} keeps the route (treatUnclosedAsFence=${treatUnclosedAsFence})`, () => {
      const out = maskNonProse(input, { treatUnclosedAsFence });
      assertShape(input, out);
      assert.ok(out.includes('[visible](docs/V.md)'), `route lost: ${JSON.stringify(out)}`);
    });
  }
  for (const [name, input] of [
    ['a `<script/>` type 7 block', '<script/>\n[hidden](docs/H.md)\n\n[visible](docs/V.md)\n'],
    ['a closed comment in a list item across a blank line', '- <!--\n\n  [hidden](docs/H.md)\n  -->\n\n[visible](docs/V.md)\n'],
    ['a closed comment in a block quote across a blank line', '> <!--\n>\n> [hidden](docs/H.md)\n> -->\n\n[visible](docs/V.md)\n'],
    ['a closed comment in an ordered item', '1. <!--\n\n   [hidden](docs/H.md) -->\n\n[visible](docs/V.md)\n'],
  ]) {
    test(`Codex 43e53ab5: ${name} hides H, keeps V (treatUnclosedAsFence=${treatUnclosedAsFence})`, () => {
      const out = maskNonProse(input, { treatUnclosedAsFence });
      assertShape(input, out);
      assert.ok(!out.includes('docs/H.md'), `hidden route kept: ${JSON.stringify(out)}`);
      assert.ok(out.includes('[visible](docs/V.md)'), `route lost: ${JSON.stringify(out)}`);
    });
  }
}

// 21. Root on 0c2cc161. A reference definition is consumed before the rest of its paragraph is inline-parsed
//     (cmark-gfm blocks.c), so each definition is its own segment and its title, which is metadata and never a
//     link, is blanked: a route inside a title is not credited, closed comment or not, and an opener or a backtick
//     in a title cannot pair with prose below. Labels and destinations stay readable, and a line that is not a
//     valid definition stays prose, its real links kept. Each under both fence options, shape checked.
for (const treatUnclosedAsFence of [true, false]) {
  for (const [name, input] of [
    ['a closed comment in a same-line title', '[r]: /url "<!-- [H](docs/H.md) -->"\n[V](docs/V.md)\n'],
    ['a closed comment in a next-line title', "[r]: /url\n'<!-- [H](docs/H.md) -->'\n[V](docs/V.md)\n"],
    ['a closed comment across a two-line title', '[r]: /url "<!--\n[H](docs/H.md) -->"\n[V](docs/V.md)\n'],
    ['a closed comment in the second of two definitions', '[a]: /x\n[b]: /y "<!-- [H](docs/H.md) -->"\n[V](docs/V.md)\n'],
    ['a route in a plain title', '[r]: /url "[H](docs/H.md)"\n[V](docs/V.md)\n'],
  ]) {
    test(`Root 0c2cc161: ${name} hides H, keeps V (treatUnclosedAsFence=${treatUnclosedAsFence})`, () => {
      const out = maskNonProse(input, { treatUnclosedAsFence });
      assertShape(input, out);
      assert.ok(!out.includes('docs/H.md'), `hidden route kept: ${JSON.stringify(out)}`);
      assert.ok(out.includes('[V](docs/V.md)'), `route lost: ${JSON.stringify(out)}`);
    });
  }
  for (const [name, input, kept] of [
    ['a genuine definition destination', '[r]: docs/R.md\n[V](docs/V.md)\n', '[r]: docs/R.md'],
    ['an opener in one title cannot reach the next definition', '[a]: /x "<!--"\n[r]: docs/R.md "-->"\n[V](docs/V.md)\n', '[r]: docs/R.md'],
    ['a real link on a line that is not a definition', '[a]: /x "<!--"\n[b]: a(b) ([K](docs/K.md))\n-->[V](docs/V.md)\n', '[K](docs/K.md)'],
  ]) {
    test(`Root 0c2cc161: ${name} keeps it and V (treatUnclosedAsFence=${treatUnclosedAsFence})`, () => {
      const out = maskNonProse(input, { treatUnclosedAsFence });
      assertShape(input, out);
      assert.ok(out.includes(kept), `definition lost: ${JSON.stringify(out)}`);
      assert.ok(out.includes('[V](docs/V.md)'), `route lost: ${JSON.stringify(out)}`);
    });
  }
}

// 22. Codex on 1f3ff8aa. A block quote, or a list item with content (ordered only from 1), interrupts a plain
//     paragraph, so an inline code span or comment cannot pair across that boundary. A line that cannot interrupt
//     (`2.`, an empty item) stays in the paragraph, and a paragraph that began in a container is not split further.
for (const treatUnclosedAsFence of [true, false]) {
  for (const [name, input] of [
    ['a block quote interrupting a paragraph', '`\n> quote\n[V](docs/V.md)\n`\n'],
    ['a bullet item interrupting a paragraph', '`\n- item\n[V](docs/V.md)\n`\n'],
    ['an ordered item from 1 interrupting a paragraph', '`\n1. item\n[V](docs/V.md)\n`\n'],
    ['a comment opener before an interrupting block quote', 'text <!--\n> [V](docs/V.md) -->\n'],
  ]) {
    test(`Codex 1f3ff8aa: ${name} keeps V (treatUnclosedAsFence=${treatUnclosedAsFence})`, () => {
      const out = maskNonProse(input, { treatUnclosedAsFence });
      assertShape(input, out);
      assert.ok(out.includes('[V](docs/V.md)'), `route lost: ${JSON.stringify(out)}`);
    });
  }
  for (const [name, input] of [
    ['an ordered item from 2 (not an interruption)', '`\n2. item\n[H](docs/H.md)\n`\n'],
    ['a comment across two block-quote lines', '> <!-- a\n> [H](docs/H.md) -->\n'],
    ['a code span across two list-item lines', '- `a\n  [H](docs/H.md)`\n'],
  ]) {
    test(`Codex 1f3ff8aa control: ${name} hides H (treatUnclosedAsFence=${treatUnclosedAsFence})`, () => {
      const out = maskNonProse(input, { treatUnclosedAsFence });
      assertShape(input, out);
      assert.ok(!out.includes('docs/H.md'), `hidden route kept: ${JSON.stringify(out)}`);
    });
  }
}

// 23. Root on 2201bb6a: the whole class of paragraph-interrupting container starts, with positive controls for
//     genuine same-paragraph spans, lazy continuation and markers that cannot interrupt. Each expectation was
//     checked against markdown-it 14 (commonmark); under both fence options, shape checked.
for (const treatUnclosedAsFence of [true, false]) {
  for (const [name, input] of [
    ['a `*` bullet interrupting', '`\n* item\n[V](docs/V.md)\n`\n'],
    ['a `+` bullet interrupting', '`\n+ item\n[V](docs/V.md)\n`\n'],
    ['a `1)` ordered item interrupting', '`\n1) item\n[V](docs/V.md)\n`\n'],
    ['a block quote indented three spaces', '`\n   > quote\n[V](docs/V.md)\n`\n'],
    ['a block quote with no space after `>`', '`\n>quote\n[V](docs/V.md)\n`\n'],
    ['a code span closed inside the interrupting item', '`a\n- `b` [V](docs/V.md)\n'],
  ]) {
    test(`interrupting container: ${name} keeps V (treatUnclosedAsFence=${treatUnclosedAsFence})`, () => {
      const out = maskNonProse(input, { treatUnclosedAsFence });
      assertShape(input, out);
      assert.ok(out.includes('[V](docs/V.md)'), `route lost: ${JSON.stringify(out)}`);
    });
  }
  for (const [name, input] of [
    ['a code span across two lines of one plain paragraph', '`a\n[H](docs/H.md)`\n'],
    ['a code span across two block-quote lines', '> `a\n[H](docs/H.md)`\n'],
    ['a code span across a lazy continuation line', '> `a\nlazy [H](docs/H.md)`\n'],
    ['an ordered `10.` item (cannot interrupt)', '`\n10. item\n[H](docs/H.md)\n`\n'],
    ['a dash with no space (not a list marker)', '`\n-x\n[H](docs/H.md)\n`\n'],
    ['a block quote indented four spaces (continuation)', '`\n    > quote\n[H](docs/H.md)\n`\n'],
    ['an empty ordered item `1.` (cannot interrupt)', '`\n1.\n[H](docs/H.md)\n`\n'],
    ['a comment across two list-item lines', '- <!-- a\n  [H](docs/H.md) -->\n'],
  ]) {
    test(`non-interrupting control: ${name} hides H (treatUnclosedAsFence=${treatUnclosedAsFence})`, () => {
      const out = maskNonProse(input, { treatUnclosedAsFence });
      assertShape(input, out);
      assert.ok(!out.includes('docs/H.md'), `hidden route kept: ${JSON.stringify(out)}`);
    });
  }
}

// 24. Root on 0b035116 and 90e772ce: an interrupting container whose content is opaque (indented code, a fence, raw
//     HTML of types 1-6 anywhere in it, or a type-7 tag right after its marker, where it starts a block) must not be unmasked by the split, while genuine
//     interruption links and lazy continuations stay readable. Each expectation was checked against
//     markdown-it 14 (commonmark); under both fence options, shape checked.
for (const treatUnclosedAsFence of [true, false]) {
  for (const [name, input] of [
    ['indented code inside an interrupting bullet', '`\n-     [H](docs/H.md)\n`\n'],
    ['indented code inside an interrupting block quote', '`\n>     [H](docs/H.md)\n`\n'],
    ['tab-indented code inside an interrupting bullet', '`\n-\t\t[H](docs/H.md)\n`\n'],
    ['a fence opened inside an interrupting bullet', '`\n- ```\n  [H](docs/H.md)\n`\n'],
    ['raw HTML (script) inside an interrupting bullet', '`\n- <script>\n  [H](docs/H.md)\n`\n'],
    ['raw HTML (script) continuing on a second block-quote line', '`\n> <script>\n> [H](docs/H.md)\n`\n'],
    ['raw HTML (div) on a continuation line of an interrupting bullet', '`\n- item\n  <div>\n  [H](docs/H.md)\n`\n'],
    ['raw HTML (script) on a continuation line of an ordered item', '`\n1.  item\n    <script>\n    [H](docs/H.md)\n`\n'],
    ['a type-7 tag opening an HTML block right after a bullet', '`\n- <span>\n  [H](docs/H.md)\n`\n'],
    ['a type-7 tag opening an HTML block right after a block-quote marker', '`\n> <span>\n> [H](docs/H.md)\n`\n'],
  ]) {
    test(`opaque interrupting container: ${name} hides H (treatUnclosedAsFence=${treatUnclosedAsFence})`, () => {
      const out = maskNonProse(input, { treatUnclosedAsFence });
      assertShape(input, out);
      assert.ok(!out.includes('docs/H.md'), `hidden route kept: ${JSON.stringify(out)}`);
    });
  }
  for (const [name, input] of [
    ['a block quote, then a lazy line', '`\n> quote\n[V](docs/V.md)\n`\n'],
    ['a bullet, then a lazy line', '`\n- item\n[V](docs/V.md)\n`\n'],
    ['an ordered item, then a lazy line', '`\n1. item\n[V](docs/V.md)\n`\n'],
    ['a type-7 block in a bullet, then a column-0 line that leaves the list', '`\n- <span>\n[V](docs/V.md)\n`\n'],
    ['four columns of padding after a bullet (padding, not code)', '`\n-    [V](docs/V.md)\n`\n'],
    ['one tab after a bullet (three columns of padding)', '`\n-\t[V](docs/V.md)\n`\n'],
    ['a zero-padded ordered start `01.` interrupting', '`\n01. [V](docs/V.md)\n`\n'],
    ['NBSP content after a bullet (not blank, so it interrupts)', '`\n- \u00a0[V](docs/V.md)\n`\n'],
    ['an item holding only an NBSP, then a lazy line', '`\n- \u00a0\n[V](docs/V.md)\n`\n'],
    ['prose in a list item after its indented code', '`\n-     code\n  [V](docs/V.md)\n`\n'],
  ]) {
    test(`genuine interruption control: ${name} keeps V (treatUnclosedAsFence=${treatUnclosedAsFence})`, () => {
      const out = maskNonProse(input, { treatUnclosedAsFence });
      assertShape(input, out);
      assert.ok(out.includes('[V](docs/V.md)'), `route lost: ${JSON.stringify(out)}`);
    });
  }
}

// 25. Root on 0b035116: a bounded cross-product of container boundaries (bullets, ordered items from 1, block quotes,
//     and nested quote/list pairs) with contained content (indented code, tab code, both fences, HTML block types
//     1-7, prose and an NBSP) and continuation shapes, between an opening backtick line and a closing one. For every
//     input, no route may survive the mask more often than the pinned CommonMark renderer (markdown-it 14) renders
//     it as a link, and no route markdown-it renders may be masked. Inputs without a closing backtick are included.
//     Both fence options; shape checked.
test('cross-product: container boundaries agree with markdown-it for hidden and visible routes', async () => {
  const { default: MarkdownIt } = await import('markdown-it');
  const md = new MarkdownIt('commonmark');
  const markers = ['- ', '* ', '+ ', '1. ', '1) ', '> ', '   > ', '>', '- > ', '> - ', '1. > '];
  const contents = ['    [H](docs/H.md)', '\t[H](docs/H.md)', '```', '~~~', '<script>', '<pre>', '<style>', '<!-- c', '<?x', '<!X',
    '<![CDATA[', '<div>', '<table>', '<span>', 'item', '\u00a0'];
  const pres = ['`\n', 'text `\n', '`a\n'];
  const posts = ['`\n', 'b`\n', ''];
  let checked = 0;
  for (const m of markers) for (const c of contents) {
    const conts = ['', '  [H](docs/H.md)', '   [H](docs/H.md)', '    [H](docs/H.md)', '> [H](docs/H.md)', '[H](docs/H.md)',
      m.replace(/\S/g, ' ') + '[H](docs/H.md)'];
    for (const k of conts) for (const p of pres) for (const q of posts) {
      const line = m + c + (c.startsWith('    ') || c.startsWith('\t') || k !== '' ? '' : ' [H](docs/H.md)');
      const hidden = p + line + '\n' + (k ? k + '\n' : '') + q;
      const visible = hidden.replaceAll('docs/H.md', 'docs/V.md').replaceAll('[H]', '[V]');
      for (const [input, route] of [[hidden, 'docs/H.md'], [visible, 'docs/V.md']]) {
        const links = md.render(input).split(`href="${route}"`).length - 1;
        for (const treatUnclosedAsFence of [true, false]) {
          const out = maskNonProse(input, { treatUnclosedAsFence });
          assertShape(input, out);
          const kept = out.split(route).length - 1;
          if (route === 'docs/H.md') assert.ok(kept <= links, `route kept that markdown-it does not render (${kept} > ${links}): ${JSON.stringify(input)}`);
          else assert.ok(kept >= links, `rendered route masked (${kept} < ${links}): ${JSON.stringify(input)}`);
          checked += 1;
        }
      }
    }
  }
  assert.equal(checked, 11 * 16 * 7 * 3 * 3 * 2 * 2);
});
// The same container model keeps prose after a fence that closes inside a list item. Only without the unclosed-fence
// option: with it, the top-level fence scan (unchanged here, as on canonical 7672128b) reads the item's two fence
// lines as an unclosed opener and closer pair and masks the rest, which masks more, never less.
test('opaque interrupting container: prose after a closed fence in a list item keeps V (treatUnclosedAsFence=false)', () => {
  const input = '`\n- ```\n  x\n  ```\n  [V](docs/V.md)\n`\n';
  const out = maskNonProse(input, { treatUnclosedAsFence: false });
  assertShape(input, out);
  assert.ok(out.includes('[V](docs/V.md)'), `route lost: ${JSON.stringify(out)}`);
});

// 26. The exact inputs Root reported on #2368 (7013882526, 7014478567, 7014623355, 7014961714), kept verbatim as
//     literal regressions so a generalised matrix can never stand in for them. Each expectation is markdown-it 14's
//     commonmark rendering; both fence options; shape checked.
for (const treatUnclosedAsFence of [true, false]) {
  for (const [comment, input] of [
    ['7013882526', '`\n-     [H](docs/H.md)\n`\n'],
    ['7013882526', '`\n- <script>\n  [H](docs/H.md)\n`\n'],
    ['7014478567', '`\n- <span>\n  [H](docs/H.md)\n`\n'],
  ]) {
    test(`Root ${comment} literal hides H: ${JSON.stringify(input)} (treatUnclosedAsFence=${treatUnclosedAsFence})`, () => {
      const out = maskNonProse(input, { treatUnclosedAsFence });
      assertShape(input, out);
      assert.ok(!out.includes('docs/H.md'), `hidden route kept: ${JSON.stringify(out)}`);
    });
  }
  for (const [comment, input] of [
    ['7014478567', '`\n-    [V](docs/V.md)\n`\n'],
    ['7014623355', '`\n-\t[V](docs/V.md)\n`\n'],
    ['7014623355', '`\n01. item\n[V](docs/V.md)\n`\n'],
    ['7014623355', '`\n-  \n[V](docs/V.md)\n`\n'],
    ['7014961714', '`\n- <script>\n  </script> [V](docs/V.md)\n`\n'],
  ]) {
    test(`Root ${comment} literal keeps V: ${JSON.stringify(input)} (treatUnclosedAsFence=${treatUnclosedAsFence})`, () => {
      const out = maskNonProse(input, { treatUnclosedAsFence });
      assertShape(input, out);
      assert.ok(out.includes('[V](docs/V.md)'), `route lost: ${JSON.stringify(out)}`);
    });
  }
}

// 27. Codex on da64fc4a (#2368 review 5980371902): three boundaries the helper crossed. Raw HTML that starts inside a
//     list item ends where the item does (only a paragraph continues lazily); a line holding only block-quote markers
//     is blank content and ends a type 6 or 7 block; consecutive indented code lines keep one segment, so a comment
//     spanning them is still paired. The exact literals first, then a bounded family around each boundary, judged
//     against markdown-it 14's commonmark rendering in both directions; both fence options; shape checked.
for (const treatUnclosedAsFence of [true, false]) {
  for (const [name, input] of [
    ['raw HTML in a list continuation, then a column-0 line (4632806024)', '- item\n  <div>\n[V](docs/V.md)\n'],
    ['a type 6 block in a quote, then a lone `>` (4632806033)', '> <div>\n>\n> [V](docs/V.md)\n'],
    ['a quote opened in a list item, then a column-0 quote', '- a\n\n  > <?x\n> [V](docs/V.md)\n'],
    ['a lazy line keeps the item open, so its raw HTML ends at the column-0 line', '- a\nlazy\n  <div>\n[V](docs/V.md)\n'],
  ]) {
    test(`Codex da64fc4a literal keeps V: ${name} (treatUnclosedAsFence=${treatUnclosedAsFence})`, () => {
      const out = maskNonProse(input, { treatUnclosedAsFence });
      assertShape(input, out);
      assert.ok(out.includes('[V](docs/V.md)'), `route lost: ${JSON.stringify(out)}`);
    });
  }
  for (const [name, input] of [
    ['a closed comment across indented code lines (4632806047)', '    <!--\n    [H](docs/H.md)\n    -->\n'],
    ['the same with tab indents', '\t<!--\n\t[H](docs/H.md)\n\t-->\n'],
    ['raw HTML at an item content column of four', '- - item\n\n    <div>\n    [H](docs/H.md)\n'],
    ['raw HTML at column 0 closes the item (not lazy), so later indented HTML is top-level', '- a\n<div>\n\n  <div>\n[H](docs/H.md)\n'],
  ]) {
    test(`Codex da64fc4a literal hides H: ${name} (treatUnclosedAsFence=${treatUnclosedAsFence})`, () => {
      const out = maskNonProse(input, { treatUnclosedAsFence });
      assertShape(input, out);
      assert.ok(!out.includes('docs/H.md'), `hidden route kept: ${JSON.stringify(out)}`);
    });
  }
}
test('list, quote and code boundaries agree with markdown-it for hidden and visible routes', async () => {
  const { default: MarkdownIt } = await import('markdown-it');
  const md = new MarkdownIt('commonmark');
  const docs = [];
  const items = [['- item', '  '], ['1. item', '   '], ['- - item', '    '], ['-   item', '    ']];
  const starts = ['<div>', '<table>', '<span>', '<script>', '<pre>', '<style>', '<!-- c', '<?x', '<!X', '<![CDATA['];
  for (const [m, ind] of items) for (const st of starts) for (const g of ['', '\n']) {
    for (const t of ['[R](docs/R.md)', '> [R](docs/R.md)', '- [R](docs/R.md)', ind + '[R](docs/R.md)']) docs.push(`${m}\n${g}${ind}${st}\n${t}\n`);
  }
  for (const q of ['>', '> ', '>  ']) for (const st of ['<div>', '<table>', '<span>', '<p>']) docs.push(`> ${st}\n${q}\n> [R](docs/R.md)\n`);
  for (const pre of ['', 'text\n\n', '- a\n\n  ']) for (const ind of ['    ', '\t']) docs.push(`${pre}${ind}<!--\n${ind}[R](docs/R.md)\n${ind}-->\n`);
  let checked = 0;
  for (const input of docs) {
    const links = md.render(input).split('href="docs/R.md"').length - 1;
    for (const treatUnclosedAsFence of [true, false]) {
      const out = maskNonProse(input, { treatUnclosedAsFence });
      assertShape(input, out);
      const kept = out.split('docs/R.md').length - 1;
      assert.ok(kept <= links, `route kept that markdown-it does not render (${kept} > ${links}): ${JSON.stringify(input)}`);
      assert.ok(kept >= links, `rendered route masked (${kept} < ${links}): ${JSON.stringify(input)}`);
      checked += 1;
    }
  }
  assert.equal(checked, (4 * 10 * 2 * 4 + 3 * 4 + 3 * 2) * 2);
});
