// Markdown scoping helpers — what part of a document is PROSE a reader can act on.
//
// WHY THIS EXISTS. Two gates parse markdown links to decide something real:
// `check-doc-orphans.mjs` (can a reader reach this document?) and
// `check-index-banner-parity.mjs` (does the index repeat what the document says about
// itself?). Both used raw regexes over the whole file, so three kinds of NON-prose
// counted as prose:
//   · fenced code blocks (``` and ~~~) — a link shown as an EXAMPLE is not a route;
//   · HTML comments (<!-- … -->) — invisible to every reader;
//   · inline code spans (`docs/X.md`) — a filename being discussed, not linked.
// Live impact was zero on 2026-09-02 (docs/INDEX.md has no fence and no comment; README
// has two closed fences and one comment, neither holding a docs link), which is exactly
// why it had to be fixed from a self-test rather than from a failure: the hole was real
// and the tree had not yet fallen into it.
//
// MASKING, NOT DELETING. Every helper here replaces non-prose with spaces and keeps
// newlines, so byte offsets and 1-based line numbers survive. A gate that reported the
// wrong line number would be worse than one that reported nothing.
//
// BOTH DIRECTIONS FAIL. Masking too much hides a real route from the gates (a false orphan); masking too little lets
// them credit a route no reader can see (a false pass, the worse one). So the mask follows what a reader of the
// document is actually shown, and where renderers disagree it follows cmark-gfm, the renderer GitHub uses (0.29
// rules: a type 4 declaration needs an uppercase letter; an inline comment holds no `--`, does not start with `>` or
// `->`, and does not end in `-`). Not modelled: link syntax (a `<!--` inside a link title opens a comment, which can
// only mask more) and container blocks (block quotes, list items). The markdown-unclosed-html-comment test holds seeded
// differential checks against markdown-it 14.3.0 in both directions, and names where that oracle departs from the
// spec.

/** Replace every character with a space, keeping newlines so offsets and lines survive. */
const blank = (s) => s.replace(/[^\n]/g, " ");

/**
 * A line's content without its line ending. The text is split on LF, so a CRLF line keeps a trailing CR that is
 * part of its line ending (§2.1), not content. Used by the HTML block and paragraph tests only; the fence
 * predicates keep their original contract unchanged.
 */
const content = (line) => (line.endsWith("\r") ? line.slice(0, -1) : line);

/** A blank line in CommonMark's sense: only spaces (U+0020) and tabs (U+0009) before the line ending. An NBSP is not blank. */
const isBlank = (line) => /^[ \t]*$/.test(content(line));

/** A fence opener: 0–3 spaces, then 3+ backticks or tildes; a backtick fence's info string has no backtick. */
function fenceOpener(line) {
  const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (!m) return null;
  const [, marker, rest] = m;
  if (marker[0] === "`" && rest.includes("`")) return null;
  return { char: marker[0], len: marker.length };
}

/** Whether `line` closes the fence `open`: same character, at least as long, nothing after it. */
function closesFence(line, open) {
  const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  return Boolean(m && m[1][0] === open.char && m[1].length >= open.len && m[2].trim() === "");
}

/**
 * Fenced-block ranges in `lines`, CommonMark-ish: an opening fence is 0–3 spaces then a
 * run of 3+ backticks or tildes; it closes on a later line whose run is the same
 * character and at least as long, with nothing after it.
 *
 * @returns {{start:number,end:number,closed:boolean}[]} 0-based, inclusive of both markers.
 */
export function fenceRanges(lines) {
  const out = [];
  let open = null;
  for (let i = 0; i < lines.length; i += 1) {
    if (!open) {
      const o = fenceOpener(lines[i]);
      if (o) open = { start: i, ...o };
      continue;
    }
    if (closesFence(lines[i], open)) {
      out.push({ start: open.start, end: i, closed: true });
      open = null;
    }
  }
  if (open) out.push({ start: open.start, end: lines.length - 1, closed: false });
  return out;
}

/**
 * Per-line "is this inside a fenced block" flags.
 *
 * `treatUnclosedAsFence` is the one judgement call. A fence that never closes is
 * malformed markdown, and reading the whole rest of the file as code on the strength of a
 * stray ``` is how a parser loses a document. Callers that are deciding whether a line is
 * a STATUS BANNER pass `false`; callers masking prose for a link parse pass `true`, which
 * is what a renderer does.
 */
export function fencedLineFlags(lines, { treatUnclosedAsFence = true } = {}) {
  const flags = new Array(lines.length).fill(false);
  for (const r of fenceRanges(lines)) {
    if (!r.closed && !treatUnclosedAsFence) continue;
    for (let i = r.start; i <= r.end; i += 1) flags[i] = true;
  }
  return flags;
}

// HTML block start conditions (§4.6), tested on a line after its 0–3 space indent, bound to one declared grammar:
// cmark-gfm tag 0.29.0.gfm.13, src/scanners.re at 587a12bb54d95ac37241377e6ddc93ea0e45439b (Root on #2368). There,
// type 1 is pre/script/style/textarea, and the type 6 set has `source` and not `search` (CommonMark 0.31.2 swapped
// them). No claim is made about the renderer GitHub deploys today; this is the version the gates are written against.
const HTML_TYPE6_TAGS = new Set(
  ("address article aside base basefont blockquote body caption center col colgroup dd details dialog dir div dl dt " +
    "fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hr html iframe legend li " +
    "link main menu menuitem nav noframes ol optgroup option p param section source summary table tbody td tfoot th " +
    "thead title tr track ul").split(" "),
);
// Separators inside a block-start tag follow that scanner's `spacechar` (space, tab, VT, FF; the same at
// 0.29.0.gfm.0): a `<span\vtitle="x">` line opens a type 7 block there, so a route under it is hidden
// and must be masked (Root on #2368). After a completed type 7 tag only space, tab and FF may follow (VT may not).
// `\s` would also accept NBSP and other Unicode spaces and change which block owns a line, so it is never used.
const SP = String.raw`[ \t\v\f]`;
const ATTR = String.raw`(?:${SP}+[A-Za-z_:][A-Za-z0-9_.:-]*(?:${SP}*=${SP}*(?:[^ \t\n\v\f\r"'=<>\x60]+|'[^']*'|"[^"]*"))?)`;
const TYPE7_OPEN = new RegExp(String.raw`^<([A-Za-z][A-Za-z0-9-]*)${ATTR}*${SP}*\/?>[ \t\f]*$`);
const TYPE7_CLOSE = new RegExp(String.raw`^<\/([A-Za-z][A-Za-z0-9-]*)${SP}*>[ \t\f]*$`);
// A thematic break (§4.1) and a setext underline (§4.3) end a paragraph, so a type 7 block may start after one.
const THEMATIC_BREAK = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
// Inline constructs that bind as tightly as a comment (§6), in cmark-gfm's 0.29 forms. Each is tried at its own
// position, leftmost first, so a `<!--` inside an earlier code span, autolink, tag, processing instruction,
// declaration or CDATA section is part of that construct and never opens a comment. Each form here is no wider than
// GitHub's: a form wider than the renderer's would swallow a real comment and leave its link to be credited.
const ESCAPABLE = /[!-\/:-@[-`{-~]/;
// cmark-gfm's whitespace (spec "whitespace character"): space, tab, LF, VT, FF, CR. JavaScript `\s` also takes NBSP
// and other Unicode spaces, which would accept a token GitHub does not, and let it swallow a real comment.
const WS = "[ \\t\\n\\v\\f\\r]";
const NOT_WS = " \\t\\n\\v\\f\\r";
// Autolinks stay as text (a reader sees and can follow them); every other raw-HTML token is markup, never prose, and
// is blanked whole, so nothing inside an attribute, instruction, declaration or CDATA section can be credited.
const AUTOLINKS = [
  new RegExp(`^<[A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>${NOT_WS}\\x00-\\x1f]*>`), // URI autolink
  /^<[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*>/, // email autolink
];
const RAW_HTML = [
  new RegExp(
    `^<[A-Za-z][A-Za-z0-9-]*(?:${WS}+[A-Za-z_:][A-Za-z0-9_.:-]*(?:${WS}*=${WS}*(?:[^"'=<>\`${NOT_WS}]+|'[^']*'|"[^"]*"))?)*${WS}*/?>`,
  ), // open tag
  new RegExp(`^</[A-Za-z][A-Za-z0-9-]*${WS}*>`), // closing tag
  /^<\?[\s\S]*?\?>/, // processing instruction
  new RegExp(`^<![A-Z]+${WS}[^>]*>`), // declaration: cmark-gfm's 0.29 form, uppercase name then whitespace
  /^<!\[CDATA\[[\s\S]*?\]\]>/, // CDATA
];

// The inline comment GitHub hides. CommonMark 0.31.2 (§6.6, markdown-it here) also accepts `<!-->`, `<!--->` and text
// holding `--`; cmark-gfm (GitHub, the 0.29 rule) shows those literally, links and all, so the mask leaves them as
// prose: text not starting with `>` or `->`, holding no `--` and not ending in `-`. That also rules out `--!>` (a
// browser's comment end) inside a masked span.
const INLINE_COMMENT = /^<!--(?!-?>)(?:[^-]|-(?!-))*-->/;

/**
 * Blank every inline comment (§6.6) in one paragraph's text, as INLINE_COMMENT defines it; anything else that starts
 * `<!--` is literal text and stays visible. Backslash escapes and autolinks are kept; code spans and every other
 * raw-HTML token (tag, processing instruction, declaration, CDATA) are blanked whole, leftmost first. A `<!--` inside
 * any of them never opens a comment, and nothing inside a blanked token can be credited as a route (Root on 16c45cff).
 *
 * LINKS ARE NOT PARSED, ON PURPOSE. Link destinations and titles, reference definitions and bracket nesting are left
 * to the comment rule: a `<!--` inside a link title still opens a comment when a `-->` follows in the paragraph. That
 * can only mask MORE than a renderer hides, so the worst outcome is a route the gates report as unreachable (loud and
 * fixable), never a hidden route they credit. Every attempt to skip link syntax opened a false-credit path (Root on
 * 32c2efad, 16340f4c and ca93a80b on #2368: unmatched `](`, inner links, images, fenced definitions, case folding).
 */
function maskInlineComments(text, blank) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\" && i + 1 < text.length && ESCAPABLE.test(text[i + 1])) {
      out += text.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (ch === "`") {
      let n = 1;
      while (text[i + n] === "`") n += 1;
      const run = "`".repeat(n);
      let k = i + n;
      let close = -1;
      while ((k = text.indexOf(run, k)) >= 0) {
        if (text[k + n] !== "`" && text[k - 1] !== "`") {
          close = k;
          break;
        }
        while (text[k] === "`") k += 1;
      }
      // A code span is code, not prose: it is blanked whole, across a line break too, since its exact-length closer
      // is what CommonMark pairs it with (§6.1); nothing inside it is a link or a comment. An unmatched run is
      // literal backticks.
      if (close >= 0) {
        out += blank(text.slice(i, close + n));
        i = close + n;
      } else {
        out += text.slice(i, i + n);
        i += n;
      }
      continue;
    }
    if (ch === "<") {
      const rest = text.slice(i);
      if (rest.startsWith("<!--")) {
        const m = INLINE_COMMENT.exec(rest);
        if (m) {
          out += blank(m[0]);
          i += m[0].length;
          continue;
        }
      } else {
        const link = AUTOLINKS.map((re) => re.exec(rest)).find(Boolean);
        if (link) {
          out += link[0];
          i += link[0].length;
          continue;
        }
        const raw = RAW_HTML.map((re) => re.exec(rest)).find(Boolean);
        if (raw) {
          out += blank(raw[0]);
          i += raw[0].length;
          continue;
        }
      }
    }
    out += ch;
    i += 1;
  }
  return out;
}
/** Columns of leading ASCII space/tab, with tab stops of 4 (§2.2). */
function indentColumns(line) {
  let col = 0;
  for (const ch of line) {
    if (ch === " ") col += 1;
    else if (ch === "\t") col += 4 - (col % 4);
    else break;
  }
  return col;
}

const ATX_HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/;
// One or more list-item or block-quote markers, then up to three spaces, then a comment opener.
const CONTAINER_START = /^ {0,3}(?:>|[-+*](?:[ \t]|$)|\d{1,9}[.)](?:[ \t]|$))/;
// A container start that interrupts an open paragraph (CommonMark §5.1, §5.2): a block-quote marker, or a list
// marker with content, ordered only when its start number is 1 (`1.`, `01.`, up to nine digits, as the pinned engine
// parses it). A start that cannot interrupt (`2.`, an empty item) stays in the paragraph. Content is anything but a
// space or tab, so an NBSP counts as content, as it does for blank-line detection.
const PARAGRAPH_INTERRUPT = /^ {0,3}(?:>|[-+*][ \t]+[^ \t]|0{0,8}1[.)][ \t]+[^ \t])/;

/** A line with tabs expanded to the next multiple of four columns, so offsets below are columns. */
function expandTabs(line) {
  let out = "";
  for (const ch of line) out += ch === "\t" ? " ".repeat(4 - (out.length % 4)) : ch;
  return out;
}

const LIST_MARKER = /^(?:([-+*])|(\d{1,9})[.)])(?= |$)/;
const FENCE_OPEN = /^(?:`{3,}(?!.*`)|~{3,})/;

/**
 * The block structure of a run of non-blank lines that begins where a list item or block quote interrupts a
 * top-level paragraph, under the pinned engine's container rules (CommonMark 0.29 §5.1–5.2; cmark-gfm blocks.c):
 * block quotes and list items are matched line by line with their real content columns (one to four columns of
 * padding after a list marker, one column of code padding plus code when there are five or more, one optional
 * column after `>`), and each line's leaf is classified as paragraph text, indented code, a fence, a raw HTML block
 * (types 1–7, type 7 only where it does not interrupt a paragraph), a heading or a thematic break. Lazy continuation
 * keeps a paragraph line in its paragraph. The result gives, for each line, null when it is opaque (code, a fence or
 * raw HTML: masked whole) or a paragraph id, so inline masking pairs nothing across a container or opaque boundary
 * (Root on 2201bb6a and 90e772ce: classification and segmentation share one source of boundaries).
 */
function containerRun(lines, interrupted, outer = []) {
  const out = [];
  // { quote: true } or { col } (a list item's content column, counted from where its enclosing containers' content
  // starts, so a quote marker indented differently on a later line still finds it; Codex on 35ecaec9: `  > - a`
  // then `>   ~~~` puts the fence in the item). `outer` holds the content columns of the top-level
  // list items already open where the run starts, outermost first, so a later line that leaves them closes the leaf
  // they hold (Codex on da64fc4a: `- a`, a blank line, `  > <?x`, then `> [L]` at column 0 is a new quote).
  const stack = outer.map((col, k) => ({ col: col - (k ? outer[k - 1] : 0) }));
  // When a container interrupts a top-level paragraph, that paragraph is still open (id -1, the caller's segment).
  let leaf = interrupted ? { kind: "para", depth: 0, id: -1 } : { kind: "none" };
  let nextId = 0;
  for (const raw of lines) {
    const text = expandTabs(content(raw));
    let pos = 0;
    let matched = 0;
    for (; matched < stack.length; matched += 1) {
      const c = stack[matched];
      if (c.quote) {
        const m = /^ {0,3}>/.exec(text.slice(pos));
        if (!m) break;
        pos += m[0].length;
        if (text[pos] === " ") pos += 1;
      } else {
        const need = pos + c.col;
        if (text.length < need || /[^ ]/.test(text.slice(pos, need))) break;
        pos = need;
      }
    }
    const allMatched = matched === stack.length;
    // An open leaf continues only when every container matched (a lazy line may continue a paragraph alone).
    if (allMatched && leaf.kind === "fence") {
      const close = new RegExp(`^ {0,3}${leaf.ch === "`" ? "`" : "~"}{${leaf.len},} *$`);
      if (close.test(text.slice(pos))) leaf = { kind: "none" };
      out.push(null);
      continue;
    }
    if (allMatched && leaf.kind === "html") {
      // A type 6 or 7 block ends at a blank line; inside containers that is a line blank after its markers (a lone
      // `>`), which belongs to no block (Codex on da64fc4a).
      if (!leaf.end && /^ *$/.test(text.slice(pos))) {
        leaf = { kind: "none" };
        out.push(nextId++);
        continue;
      }
      if (leaf.end && endAfter(text.slice(pos), leaf.end, 0) >= 0) leaf = { kind: "none" };
      out.push(null);
      continue;
    }
    if (allMatched && leaf.kind === "code" && indentColumns(text.slice(pos)) >= 4) {
      out.push(null);
      continue;
    }
    const paraOpen = leaf.kind === "para";
    // Open new containers and find the leaf on what remains.
    let depth = matched;
    let opened = false;
    let result;
    for (;;) {
      const rest = text.slice(pos);
      const indent = indentColumns(rest);
      // A paragraph is continued (in place, or lazily) unless a block start that may interrupt it appears.
      const continuing = paraOpen && !opened;
      if (indent >= 4) {
        if (continuing) { result = "continue"; break; }
        // New code keeps only the containers this line matched or opened; an ended inner item must not match the
        // next line again (Root on ca1986be: `- 12345. <div>`, then six-space `<!--` is code in the outer item).
        stack.length = depth;
        leaf = { kind: "code" };
        result = null;
        break;
      }
      const body = rest.slice(indent);
      // A thematic break closes the containers this line did not match, as a heading does, so later lines are read
      // against the containers still open (Codex on ca1986be: `- a`, `***`, then `    <!--` is top-level code).
      if (THEMATIC_BREAK.test(body)) { stack.length = depth; leaf = { kind: "none" }; result = "own"; break; }
      if (body.startsWith(">")) {
        stack.length = depth;
        stack.push({ quote: true });
        depth += 1;
        opened = true;
        pos += indent + 1;
        if (text[pos] === " ") pos += 1;
        continue;
      }
      const lm = LIST_MARKER.exec(body);
      if (lm) {
        const after = body.slice(lm[0].length);
        const pad = indentColumns(after);
        // Blank is spaces and tabs only (an NBSP is content), as for blank lines.
        const empty = /^ *$/.test(after);
        // Only a list inside the paragraph's own container must start at 1 to interrupt it; once a container
        // has failed to match, the paragraph is not in the matched container and any start number opens a list
        // (cmark-gfm blocks.c tests the last matched container; Codex on 41cf68c6).
        const canInterrupt = !allMatched || (!empty && (lm[1] !== undefined || Number(lm[2]) === 1));
        if (!(continuing && !canInterrupt)) {
          const markerEnd = pos + indent + lm[0].length;
          const col = empty || pad >= 5 ? markerEnd + 1 : markerEnd + pad;
          stack.length = depth;
          stack.push({ col: col - pos });
          depth += 1;
          opened = true;
          pos = Math.min(col, text.length);
          continue;
        }
      }
      if (FENCE_OPEN.test(body)) {
        const f = FENCE_OPEN.exec(body)[0];
        stack.length = depth;
        leaf = { kind: "fence", ch: f[0], len: f.length };
        result = null;
        break;
      }
      const html = htmlBlockStart(body, continuing);
      if (html) {
        stack.length = depth;
        leaf = { kind: "html", end: html.end };
        if (html.end && endAfter(body, html.end, 0) >= 0) leaf = { kind: "none" };
        result = null;
        break;
      }
      if (body === "") { leaf = { kind: "none" }; result = "own"; break; }
      if (ATX_HEADING.test(body)) { stack.length = depth; leaf = { kind: "none" }; result = "own"; break; }
      if (continuing && /^(?:=+|-+) *$/.test(body) && allMatched) { leaf = { kind: "none" }; result = "own"; break; }
      result = continuing ? "continue" : "new";
      break;
    }
    if (result === null) out.push(null);
    else if (result === "own") out.push(nextId++);
    else if (result === "continue") out.push(leaf.id);
    else {
      stack.length = depth;
      leaf = { kind: "para", depth, id: nextId++ };
      out.push(leaf.id);
    }
  }
  return out;
}
const CONTAINER_COMMENT = /^((?: {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+| {0,3}>[ \t]?)+)( {0,3})<!--/;
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/;

/**
 * True only when `paraLines` (an open paragraph's lines, in order) are wholly consumed as link reference definitions
 * (§4.7). Such a "paragraph" has no content, so a following `===` or `--` line is not a setext underline (§4.3: the
 * heading content may not be reference definitions) and starts a paragraph instead — after which a type 7 tag cannot
 * open an HTML block (Codex on #2368). Strict on purpose: anything this does not recognise as a definition (a tab
 * indent, a label across lines, nested parens past 32, a backslash before a non-punctuation character, a residual
 * CR) returns false, and the line stays an underline. That keeps the
 * error on the conservative side: a link masked that a reader could click, never one credited that they cannot.
 */
function allReferenceDefinitions(paraLines) {
  return paraLines.length > 0 && referenceDefinitionLines(paraLines) === paraLines.length;
}

/**
 * How many leading lines of an open paragraph are wholly consumed as link reference definitions (§4.7), under the
 * same strict recognizer: 0 when the first one is not recognised. Those lines are never inline-parsed (Codex on
 * #2368: a backtick in a definition's title must not pair with one in the prose after it).
 */
function referenceDefinitionLines(paraLines) {
  const spans = referenceDefinitionSpans(paraLines);
  return spans.length === 0 ? 0 : spans[spans.length - 1];
}

/**
 * The same recognizer, reporting where each successive definition ends: entry n is the number of lines consumed
 * by the first n + 1 definitions. Empty when none is recognized or the paragraph is not judged. `titles[n]` is the
 * [start, end) offset of definition n's title, delimiters included, in the CR-stripped lines joined by LF, or null.
 */
function referenceDefinitionSpans(paraLines) {
  const text = paraLines.map(content).join("\n");
  // A backslash before anything but ASCII punctuation is read differently by different renderers inside a
  // destination (markdown-it 14.3.0 consumes `\ ` as a pair); not judged, so the underline stands.
  if (/\\(?![!-\/:-@[-`{-~])/.test(text)) return [];
  // A CR left after each line's CRLF ending is stripped is a line ending to cmark-gfm (blocks.c splits on it before
  // block parsing), never label or destination text; this recognizer does not model CR-only lines, so any residual
  // CR means "not judged" and the underline stands (Root on c28a38ca).
  if (text.includes("\r")) return [];
  let at = 0;
  const ws = () => {
    while (at < text.length && (text[at] === " " || text[at] === "\t")) at += 1;
  };
  let title = null;
  // One definition from `at`; returns the index after it (at a line end or end of text), or -1.
  const definition = () => {
    title = null;
    let p = at;
    let n = 0;
    while (text[p] === " " && n < 3) (p += 1), (n += 1);
    if (text[p] !== "[") return -1;
    p += 1;
    let label = "";
    while (p < text.length && text[p] !== "]") {
      if (text[p] === "[" || text[p] === "\n") return -1;
      if (text[p] === "\\" && p + 1 < text.length && text[p + 1] !== "\n") (label += text[p] + text[p + 1]), (p += 2);
      else (label += text[p]), (p += 1);
    }
    // Renderers disagree on which characters leave a label empty (cmark-gfm's cmark_isspace excludes VT and FF;
    // markdown-it trims every Unicode space): a label counts here only with a character no renderer trims.
    if (text[p] !== "]" || !/[^\s\x00-\x1f\x7f]/.test(label) || label.length > 999) return -1;
    p += 1;
    if (text[p] !== ":") return -1;
    p += 1;
    at = p;
    ws();
    if (text[at] === "\n") (at += 1), ws();
    // Destination (§6.3 link destination).
    if (text[at] === "<") {
      at += 1;
      while (at < text.length && text[at] !== ">") {
        if (text[at] === "\n" || text[at] === "<") return -1;
        at += text[at] === "\\" && at + 1 < text.length && text[at + 1] !== "\n" ? 2 : 1;
      }
      if (text[at] !== ">") return -1;
      at += 1;
    } else {
      const start = at;
      let depth = 0;
      while (at < text.length && !/[\x00-\x20\x7f]/.test(text[at])) {
        if (text[at] === "\\" && at + 1 < text.length && /[!-\/:-@[-`{-~]/.test(text[at + 1])) {
          at += 2;
          continue;
        }
        if (text[at] === "(") depth += 1;
        else if (text[at] === ")") {
          if (depth === 0) break;
          depth -= 1;
        }
        if (depth > 32) return -1;
        at += 1;
      }
      if (at === start || depth !== 0) return -1;
    }
    const afterDest = at;
    ws();
    const destLineEnds = at >= text.length || text[at] === "\n";
    const sameLineGap = at > afterDest;
    // Optional title, separated by whitespace (same line) or a line ending.
    let titleStart = at;
    if (destLineEnds && at < text.length) (titleStart = at + 1), (at = titleStart), ws();
    else if (!destLineEnds && !sameLineGap) return -1;
    const open = text[at];
    const close = open === '"' ? '"' : open === "'" ? "'" : open === "(" ? ")" : null;
    if (close && (at > titleStart || destLineEnds || sameLineGap)) {
      let q = at + 1;
      let ok = false;
      while (q < text.length) {
        if (text[q] === "\\" && q + 1 < text.length) {
          q += 2;
          continue;
        }
        if (text[q] === close) {
          ok = true;
          break;
        }
        if (open === "(" && text[q] === "(") break;
        if (text[q] === "\n" && /^[ \t]*(?:\n|$)/.test(text.slice(q + 1))) break;
        q += 1;
      }
      if (ok) {
        const opened = at;
        at = q + 1;
        ws();
        if (at >= text.length || text[at] === "\n") {
          title = [opened, q + 1];
          return at;
        }
      }
    }
    // No valid title: the definition ends at its destination line, which must hold nothing else.
    if (destLineEnds) return afterDest + (text.slice(afterDest).match(/^[ \t]*/)[0].length);
    return -1;
  };
  const spans = [];
  spans.titles = [];
  while (at < text.length) {
    const end = definition();
    if (end < 0) break;
    spans.push(text.slice(0, end).split("\n").length);
    spans.titles.push(title);
    at = end < text.length ? end + 1 : end;
  }
  return spans;
}

/**
 * Which HTML block (§4.6) starts on `line`, if any: its type and, for types 1–5, the end marker. `inParagraph`
 * matters only for type 7, the one kind that cannot interrupt a paragraph.
 */
function htmlBlockStart(line, inParagraph) {
  const m = /^ {0,3}(<.*)$/.exec(line);
  if (!m) return null;
  const rest = m[1];
  const col = line.length - rest.length;
  if (/^<(?:pre|script|style|textarea)(?:[ \t\v\f>]|$)/i.test(rest)) return { type: 1, col, end: /<\/(?:pre|script|style|textarea)>/i };
  if (rest.startsWith("<!--")) return { type: 2, col, end: "-->" };
  if (rest.startsWith("<?")) return { type: 3, col, end: "?>" };
  if (/^<![A-Z]/.test(rest)) return { type: 4, col, end: ">" };
  if (rest.startsWith("<![CDATA[")) return { type: 5, col, end: "]]>" };
  const t6 = /^<\/?([A-Za-z][A-Za-z0-9]*)(?:[ \t\v\f]|\/?>|$)/.exec(rest);
  if (t6 && HTML_TYPE6_TAGS.has(t6[1].toLowerCase())) return { type: 6, col };
  if (!inParagraph) {
    const t7 = TYPE7_OPEN.exec(rest) || TYPE7_CLOSE.exec(rest);
    // No tag-name exclusion: the declared scanner's type 7 condition has none, and type 1 is tried first, so only a
    // `<script`/`<pre`/`<style`/`<textarea` not followed by a separator, `>` or end of line (`<script/>`, say) and
    // every closing tag such as `</script>` reach this line (Codex on #2368).
    if (t7) return { type: 7, col };
  }
  return null;
}

/** Index just past `end` (a string or RegExp) in `text` at or after `from`, or -1. */
function endAfter(text, end, from) {
  if (typeof end === "string") {
    const at = text.indexOf(end, from);
    return at < 0 ? -1 : at + end.length;
  }
  const re = new RegExp(end.source, end.flags.includes("g") ? end.flags : end.flags + "g");
  re.lastIndex = from;
  const hit = re.exec(text);
  return hit ? hit.index + hit[0].length : -1;
}

/** True when a line, read inside an open paragraph, would continue it lazily rather than start a block (§5.1–5.2). */
function lazyLine(text) {
  const body = text.slice(Math.min(indentColumns(text), 3));
  if (indentColumns(text) >= 4) return true;
  if (/^>/.test(body) || THEMATIC_BREAK.test(text) || ATX_HEADING.test(text) || fenceOpener(text)) return false;
  if (htmlBlockStart(text, true)) return false;
  const lm = LIST_MARKER.exec(body);
  if (lm && !/^ *$/.test(body.slice(lm[0].length)) && (lm[1] !== undefined || Number(lm[2]) === 1)) return false;
  return true;
}

/**
 * Block-level structure in source order, the way CommonMark reads it: at each line outside a block, a fence or an
 * HTML block (§4.6, all seven start conditions) may start, and whichever starts FIRST owns its lines. A fence marker
 * or a `<!--` inside an open HTML block (a `<script>`, a `<div>` run) is that block's text, and a `<!--` inside a
 * fence is code. Deciding this on the original lines is the point: masking fences first can erase a comment's `-->`
 * and make a closed comment look unclosed, and an opener inside raw HTML is not a comment block at all (Codex on
 * #2368, both).
 *
 * Types 1–5 end on the first line, their own included, that holds their end marker, or at end of input; types 6–7
 * end before the next blank line. An unclosed fence runs to end of input only when `treatUnclosedAsFence`;
 * otherwise its opener line is left as prose and the scan continues below it. Container blocks (block quotes,
 * list items) are not modelled.
 *
 * @returns {{kind:"fence"|"comment"|"html",start:number,end:number,closed:boolean,col?:number,endCol?:number}[]}
 */
function blockRanges(lines, treatUnclosedAsFence, judgeDefinitions) {
  const out = [];
  // The content column of each open top-level list item, innermost last, and per line the innermost one that line
  // sits in (0 outside any item). An HTML block that starts inside an item ends where the item does, at the first
  // later non-blank line indented less than the item's content column, since only a paragraph continues lazily
  // (CommonMark §5.2; Codex on da64fc4a). Lines inside block quotes start with `>` and are never block starts here.
  const items = [];
  const itemCol = new Array(lines.length).fill(0);
  const itemStack = new Array(lines.length).fill(null);
  out.itemCol = itemCol;
  out.itemStack = itemStack;
  let inParagraph = false;
  let paraStart = -1;
  // The container the open paragraph began in: a block quote, or the content column of its innermost list item.
  // A line outside that container can only continue the paragraph lazily, so it is never a setext underline
  // (`- a` then `===` is paragraph text; Codex on 41cf68c6) and an ordered list on it may start at any number.
  let paraQuote = false;
  let paraItemCol = 0;
  const leaves = (start, col) => (k) => col > 0 && !isBlank(lines[k]) && indentColumns(expandTabs(content(lines[k]))) < col;
  // An HTML block or fence opened on a list item's own marker line (`1.<tab><script>`, `- \`\`\``). Its later lines
  // inside the item are that block's content, so nothing in them starts a new block here; the container model
  // below masks them. It ends at its end marker, a blank line (types 6 and 7), or the item's end (Codex-class
  // case found by differential fuzzing on 41cf68c6).
  let markerLeaf = null;
  for (let i = 0; i < lines.length; i += 1) {
    const text0 = expandTabs(content(lines[i]));
    let contentAt = 0; // column after any list markers opened on this line
    if (markerLeaf) {
      // Its lines are claimed here as opaque, blank lines inside it included, so a comment or route inside the
      // block is masked even when the container model's run would stop at a blank (Root on 9b440af2).
      const close = (end) => {
        if (end >= markerLeaf.start) out.push({ kind: "html", start: markerLeaf.start, end, closed: true, col: 0 });
        markerLeaf = null;
      };
      if (isBlank(text0) && markerLeaf.kind === "html" && !markerLeaf.end) close(i - 1);
      else if (!isBlank(text0) && indentColumns(text0) < markerLeaf.col) close(i - 1);
      else {
        const inside = text0.slice(markerLeaf.col);
        const ends =
          !isBlank(text0) &&
          (markerLeaf.kind === "html"
            ? Boolean(markerLeaf.end) && endAfter(inside, markerLeaf.end, 0) >= 0
            : closesFence(inside, { char: markerLeaf.ch, len: markerLeaf.len }));
        itemCol[i] = items.length ? items[items.length - 1] : 0;
        itemStack[i] = items.slice();
        inParagraph = false;
        if (ends) close(i);
        else if (i === lines.length - 1) close(i);
        continue;
      }
    }
    if (!isBlank(text0)) {
      const indent = indentColumns(text0);
      let matched = 0;
      while (matched < items.length && indent >= items[matched]) matched += 1;
      if (matched < items.length && !(inParagraph && lazyLine(text0))) items.length = matched;
      itemCol[i] = items.length ? items[items.length - 1] : 0;
      itemStack[i] = items.slice();
      // New items opened on this line, outermost first (`- - x` opens two).
      let pos = 0;
      for (;;) {
        const base = items.length ? items[items.length - 1] : 0;
        const rest = text0.slice(pos);
        const ind = indentColumns(rest);
        if (pos + ind - base >= 4 && pos + ind >= base) break;
        const lm = LIST_MARKER.exec(rest.slice(ind));
        if (!lm) break;
        const after = rest.slice(ind + lm[0].length);
        const empty = /^ *$/.test(after);
        const outside = paraQuote || (paraItemCol > 0 && indent < paraItemCol);
        if (inParagraph && pos === 0 && !outside && (empty || (lm[2] !== undefined && Number(lm[2]) !== 1))) break;
        const pad = indentColumns(after);
        const markerEnd = pos + ind + lm[0].length;
        const col = empty || pad >= 5 ? markerEnd + 1 : markerEnd + pad;
        if (pos === 0) items.length = Math.min(items.length, matched);
        items.push(col);
        pos = col;
        if (empty) break;
      }
      contentAt = pos;
      if (pos > 0) {
        const first = text0.slice(pos);
        const hm = htmlBlockStart(first, false);
        const fo = hm ? null : fenceOpener(first);
        if (hm && !(hm.end && endAfter(first, hm.end, hm.col + (hm.type === 2 ? 2 : 1)) >= 0)) markerLeaf = { kind: "html", end: hm.end, col: pos, start: i + 1 };
        else if (fo) markerLeaf = { kind: "fence", ch: fo.char, len: fo.len, col: pos, start: i + 1 };
        // A marker line whose content is raw HTML or a fence holds no paragraph, so nothing after it continues one
        // lazily or keeps its item open (Codex on 35ecaec9: `- <div>`, `x`, then a column-0 comment is top level).
        if (hm || fo) {
          inParagraph = false;
          continue;
        }
      }
    } else {
      itemCol[i] = items.length ? items[items.length - 1] : 0;
      itemStack[i] = items.slice();
    }
    // Inside an item, a block start is read from the item's content column (up to three more columns of indent), so
    // `    <div>` in an item whose content starts at column 4 is raw HTML, not code. Columns are read with tabs
    // expanded; the block's `col` is the character offset of its `<` in the line, after the leading whitespace.
    const inItem = itemCol[i] > 0 && indentColumns(text0) >= itemCol[i];
    const raw = content(lines[i]);
    let h = htmlBlockStart(raw, inParagraph);
    if (!h && inItem) {
      const r = htmlBlockStart(text0.slice(itemCol[i]), inParagraph);
      if (r) h = { ...r, col: /^[ \t]*/.exec(raw)[0].length };
    }
    const col = h && inItem ? itemCol[i] : 0;
    const exits = leaves(i, col);
    if (h && h.type <= 5) {
      let j = i;
      let at = endAfter(lines[i], h.end, h.col + (h.type === 2 ? 2 : 1));
      while (at < 0 && j + 1 < lines.length && !exits(j + 1)) {
        j += 1;
        at = endAfter(lines[j], h.end, 0);
      }
      const kind = h.type === 2 ? "comment" : "html";
      if (at < 0 && j + 1 >= lines.length) {
        out.push({ kind, start: i, end: lines.length - 1, closed: false, col: h.col });
        break;
      }
      if (at < 0) {
        // Ended by leaving the item: everything from the start to here is the block, unclosed.
        out.push({ kind, start: i, end: j, closed: false, col: h.col });
        i = j;
        inParagraph = false;
        continue;
      }
      out.push({ kind, start: i, end: j, closed: true, col: h.col, endCol: at });
      i = j;
      inParagraph = false;
      continue;
    }
    if (h) {
      let j = i;
      while (j + 1 < lines.length && !isBlank(lines[j + 1]) && !exits(j + 1)) j += 1;
      out.push({ kind: "html", start: i, end: j, closed: true, col: h.col });
      i = j;
      inParagraph = false;
      continue;
    }
    const open = fenceOpener(lines[i]);
    if (open) {
      let k = i + 1;
      while (k < lines.length && !closesFence(lines[k], open)) k += 1;
      if (k < lines.length) {
        out.push({ kind: "fence", start: i, end: k, closed: true });
        i = k;
        inParagraph = false;
        continue;
      }
      if (treatUnclosedAsFence) {
        out.push({ kind: "fence", start: i, end: lines.length - 1, closed: false });
        break;
      }
    }
    // An ATX heading, a thematic break or a setext underline ends the paragraph (the underline only while one is
    // open); a blank line does too. An indented code line (four columns or more, §4.4) cannot start one — inside an
    // open paragraph it is only a lazy continuation. Anything else non-blank continues or starts one.
    const text = content(lines[i]);
    // Read past this line's list markers and block-quote markers too: `* ---` and `> ---` hold a thematic break,
    // not paragraph text, so a following line starts a fresh paragraph outside them (differential fuzzing).
    const inner = text0.slice(contentAt).replace(/^(?: {0,3}> ?)+/, "");
    if (isBlank(text) || ATX_HEADING.test(text) || THEMATIC_BREAK.test(text) || THEMATIC_BREAK.test(inner) || ATX_HEADING.test(inner)) inParagraph = false;
    else if (
      inParagraph &&
      SETEXT_UNDERLINE.test(text) &&
      !(paraQuote || (paraItemCol > 0 && indentColumns(expandTabs(text)) < paraItemCol)) &&
      !(judgeDefinitions && allReferenceDefinitions(lines.slice(paraStart, i)))
    )
      inParagraph = false;
    // Inside a list item the four columns count from its content column (Codex on 35ecaec9: `- # hi` then
    // `    text` is a paragraph two columns into the item, not code).
    else if (!inParagraph && indentColumns(text0) - (inItem ? itemCol[i] : 0) >= 4) inParagraph = false;
    else {
      if (!inParagraph) {
        paraStart = i;
        // A quote opened after this line's list markers (`- > a`) also holds the paragraph.
        paraQuote = /^ {0,3}>/.test(text) || /^ {0,3}>/.test(text0.slice(contentAt));
        paraItemCol = items.length ? items[items.length - 1] : 0;
      }
      inParagraph = true;
    }
  }
  return out;
}

/**
 * Mask fenced blocks, raw HTML blocks, HTML comments and inline code spans, preserving every offset.
 * Inside a paragraph, code spans are paired the way §6.1 pairs them (exact-length backtick runs, leftmost first) and
 * blanked whole, across line breaks too; a final per-line pass also blanks same-line spans outside paragraphs.
 *
 * Comment BLOCKS (an opener at the start of a line) are masked from `<!--` to their `-->`, or to end of input when
 * they never close (CommonMark 0.31.2 §4.6, type 2). A comment that opens mid-line is not a block: it is masked only
 * when it closes, and an unmatched mid-line opener is left alone.
 */
export function maskNonProse(text, { treatUnclosedAsFence = true } = {}) {
  const lines = text.split("\n");
  const source = lines.slice();
  // Fences and raw HTML blocks are masked whole: markdown link syntax inside either is not a link a reader can
  // click (§4.6: an HTML block's lines are raw HTML, not parsed as Markdown). Each remaining non-blank line joins a
  // paragraph segment, and inline HTML comments are matched within one paragraph, never across a block boundary or
  // a blank line, as CommonMark's inline parse is per block.
  const segment = new Array(lines.length).fill(-1);
  const tail = new Set();
  let nextSegment = 0;
  // A CR that does not end a CRLF line is a line ending to cmark-gfm (blocks.c), so it can move where a paragraph
  // starts (an indented-code line split in two, say). Lines are not modelled that way here, so with one anywhere in
  // the document the reference-definition exception is not applied and every underline stands, as before it existed.
  const judgeDefinitions = !/\r(?!\n|$)/.test(text);
  const blocks = blockRanges(lines, treatUnclosedAsFence, judgeDefinitions);
  for (const b of blocks) {
    for (let i = b.start; i <= b.end; i += 1) {
      // The text after a closed comment block's `-->` stays visible, as before; it is left unassigned so the
      // paragraph pass below still masks any further comment in it (Root on #2368).
      segment[i] = b.kind === "comment" && b.closed && i === b.end ? -1 : -2;
      if (segment[i] === -1) tail.add(i);
      if (b.kind !== "comment") {
        lines[i] = blank(lines[i]);
        continue;
      }
      const from = i === b.start ? b.col : 0;
      const to = b.closed && i === b.end ? b.endCol : lines[i].length;
      lines[i] = lines[i].slice(0, from) + blank(lines[i].slice(from, to)) + lines[i].slice(to);
    }
  }
  // Paragraph segments follow the same boundaries as blockRanges: an inline comment never spans a heading, a
  // thematic break, a setext underline or an indented code line, because CommonMark never lets a paragraph do so.
  let inPara = false;
  let paraStart = -1;
  let paraBoxed = false;
  let codeRun = -2; // the last line of the current indented-code run (a code line, or a blank line inside one)
  let codeSeg = -1; // that run's segment
  for (let i = 0; i < lines.length; i += 1) {
    if (segment[i] !== -1) {
      inPara = false;
      continue;
    }
    const text = content(lines[i]);
    if (isBlank(text)) {
      segment[i] = -2;
      inPara = false;
      // A blank line inside indented code belongs to the code block (§4.4): it joins the run's segment, so a comment
      // that spans it still pairs (Root 7017628008). If no code line follows, it is a blank line in a segment of its
      // own run and changes nothing.
      if (codeRun === i - 1) (codeRun = i), (segment[i] = codeSeg);
    } else if (tail.has(i)) {
      // The rest of a comment block's closing line still belongs to that HTML block (§4.6): it is its own segment,
      // joins no paragraph above it, and the next line starts a new one.
      segment[i] = nextSegment++;
      inPara = false;
    } else if (!inPara && indentColumns(expandTabs(text)) - blocks.itemCol[i] >= 4) {
      // Indented code (§4.4), counted from the list item's content column when the line sits in one. Consecutive
      // code lines share one segment, so a comment that spans them is still paired and masked as it was before
      // segments existed; split, each line kept half a comment and a link it hides was credited (Codex on da64fc4a).
      if (codeRun !== i - 1) codeSeg = nextSegment++;
      segment[i] = codeSeg;
      codeRun = i;
      inPara = false;
    } else if (
      ATX_HEADING.test(text) ||
      THEMATIC_BREAK.test(text) ||
      (inPara && SETEXT_UNDERLINE.test(text) && !(judgeDefinitions && allReferenceDefinitions(source.slice(paraStart, i))))
    ) {
      // No document-margin code test here: the branch above already applies the four-column threshold from the
      // item's content column, so a line two columns into an item after a blank is paragraph text and pairs with
      // the rest of its paragraph (Root on 0a98d95f: `- # hi`, blank, `    a <!--`, then `  -->`).
      segment[i] = nextSegment++;
      inPara = false;
    } else {
      // A list item or block quote interrupting a plain paragraph ends it (Codex on 1f3ff8aa). The run from here to
      // the next block boundary is classified with its containers modelled, so an inline comment or code span cannot
      // pair across a container or opaque boundary and code or raw HTML inside the container is masked whole.
      const interrupted = inPara && !paraBoxed && PARAGRAPH_INTERRUPT.test(text);
      // A paragraph that begins in a container is modelled the same way from its first line (Root on 1f3ff8aa: a
      // later container line ends it as surely as one that interrupts a plain paragraph).
      // So is one that begins inside a list item already open above it, with no marker of its own (Root on
      // 8af77af2: `- # hi`, blank, `    a \``, then a dedented `2. b` is outside that paragraph's item, so the
      // backtick cannot pair across it).
      const enclosed = !inPara && (blocks.itemStack[i]?.length ?? 0) > 0;
      if (interrupted || (!inPara && CONTAINER_START.test(text)) || enclosed) {
        let r = i;
        while (r + 1 < lines.length && segment[r + 1] === -1 && !isBlank(content(lines[r + 1]))) r += 1;
        const ids = containerRun(source.slice(i, r + 1), interrupted, blocks.itemStack[i] ?? []);
        const base = nextSegment;
        let top = -1;
        for (let k = i; k <= r; k += 1) {
          const id = ids[k - i];
          if (id === null) {
            segment[k] = -2;
            // A comment opened right after the markers keeps its `<!--` so the container-comment pass below can
            // still mask from it through the first `-->`, across blank lines (Codex on 43e53ab5).
            const boxed = CONTAINER_COMMENT.exec(content(source[k]));
            const col = boxed ? boxed[1].length + boxed[2].length : -1;
            lines[k] = boxed ? blank(lines[k].slice(0, col)) + "<!--" + blank(lines[k].slice(col + 4)) : blank(lines[k]);
          } else if (id < 0) segment[k] = segment[paraStart];
          else (segment[k] = base + id), (top = Math.max(top, id));
        }
        nextSegment = base + top + 1;
        i = r;
        inPara = false;
        continue;
      }
      if (!inPara) {
        paraStart = i;
        paraBoxed = CONTAINER_START.test(text);
        segment[i] = nextSegment++;
      } else segment[i] = segment[i - 1];
      inPara = true;
    }
  }
  // Leading lines of a paragraph that are wholly reference definitions are consumed before the rest is inline-parsed
  // (§4.7; cmark-gfm blocks.c removes the definition prefix first), so each definition becomes its own segment: a
  // backtick or `<!--` in a definition's title cannot pair with prose below it or with another definition, while a
  // comment closed inside one title is still masked as before (Root on 0c2cc161: `[r]: /url "<!-- [H](docs/H.md)
  // -->"` must not credit H). With a lone CR in the document the definitions are not judged, and the paragraph
  // stays one segment, as before.
  if (judgeDefinitions) {
    for (let i = 0; i < lines.length; ) {
      let j = i;
      while (j + 1 < lines.length && segment[j + 1] === segment[i] && segment[i] >= 0) j += 1;
      if (segment[i] >= 0 && !tail.has(i)) {
        const spans = referenceDefinitionSpans(source.slice(i, j + 1));
        const defs = spans.length === 0 ? 0 : spans[spans.length - 1];
        // A list-item or block-quote line further down means the paragraph's real extent is unknown here
        // (containers are not modelled), so the segment is left as it was.
        const boxedBelow = source.slice(i + defs, j + 1).some((l) => CONTAINER_START.test(content(l)));
        // So does a paragraph whose start is not certain: only one at the top, after a blank line or after an ATX
        // heading is judged; after anything else a container may have ended where this scan does not know.
        const certainStart = i === 0 || isBlank(source[i - 1]) || ATX_HEADING.test(content(source[i - 1]));
        if (!boxedBelow && certainStart) {
          let from = i;
          for (const end of spans) {
            const id = nextSegment++;
            for (let k = from; k < i + end; k += 1) segment[k] = id;
            from = i + end;
          }
          // A title is metadata, never a link a reader can click, so it is blanked whole: a route written in it is
          // not credited, whatever comment or backtick pairing the published helper would have reached across
          // segments (Root on 0c2cc161). Labels and destinations are left as they were.
          let offset = 0;
          const starts = [];
          for (let k = i; k < i + defs; k += 1) (starts.push(offset), (offset += content(lines[k]).length + 1));
          for (const range of spans.titles ?? []) {
            if (!range) continue;
            for (let k = i; k < i + defs; k += 1) {
              const lineStart = starts[k - i];
              const body = content(lines[k]);
              const a = Math.max(range[0] - lineStart, 0);
              const b = Math.min(range[1] - lineStart, body.length);
              if (a < b) lines[k] = body.slice(0, a) + blank(body.slice(a, b)) + lines[k].slice(b);
            }
          }
        }
      }
      i = j + 1;
    }
  }
  const masked = [];
  for (let i = 0; i < lines.length; ) {
    let j = i;
    while (j + 1 < lines.length && segment[j + 1] === segment[i] && segment[i] >= 0) j += 1;
    let chunk = lines.slice(i, j + 1).join("\n");
    if (segment[i] >= 0) chunk = maskInlineComments(chunk, blank);
    masked.push(chunk);
    i = j + 1;
  }
  const outLines = masked
    .join("\n")
    .split("\n")
    .map((l) => l.replace(/(`+)[^`\n]*?\1/g, blank));
  // A comment opened right after list-item or block-quote markers is a type 2 block inside that container.
  // Containers are not modelled, so it is masked only when it closes, from `<!--` through the first `-->` below
  // it (blank lines included), as the masking before this helper did. This pass only ever adds masking on top of
  // the block scan above, which it leaves untouched, so it can hide more than a renderer would, never less
  // (Codex on #2368: `- <!--\n\n  [hidden](x)\n  -->` must stay hidden).
  for (let i = 0; i < source.length; i += 1) {
    const boxed = CONTAINER_COMMENT.exec(content(source[i]));
    if (!boxed) continue;
    const col = boxed[1].length + boxed[2].length;
    if (outLines[i].slice(col, col + 4) !== "<!--") continue;
    let j = i;
    let at = endAfter(source[i], "-->", col + 2);
    while (at < 0 && j + 1 < source.length) {
      j += 1;
      at = endAfter(source[j], "-->", 0);
    }
    if (at < 0) continue;
    for (let k = i; k <= j; k += 1) {
      const from = k === i ? col : 0;
      const to = k === j ? at : outLines[k].length;
      outLines[k] = outLines[k].slice(0, from) + blank(outLines[k].slice(from, to)) + outLines[k].slice(to);
    }
  }
  return outLines.join("\n");
}
