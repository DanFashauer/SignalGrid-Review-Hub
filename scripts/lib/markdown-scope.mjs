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
// `->`, and does not end in `-`). Link reference definitions are read only to decide which brackets are links. Not
// modelled: container blocks (block quotes, list items). The markdown-unclosed-html-comment test holds seeded
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

// CommonMark 0.31.2 §4.6 HTML block start conditions, tested on a line after its 0–3 space indent.
const HTML_TYPE6_TAGS = new Set(
  ("address article aside base basefont blockquote body caption center col colgroup dd details dialog dir div dl dt " +
    "fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hr html iframe legend li " +
    "link main menu menuitem nav noframes ol optgroup option p param search section summary table tbody td tfoot th " +
    "thead title tr track ul").split(" "),
);
// Whitespace in these start conditions is ASCII space or tab only (§2.1); `\s` would also accept NBSP and other
// Unicode spaces and change which block owns a line.
const ATTR = String.raw`(?:[ \t]+[A-Za-z_:][A-Za-z0-9_.:-]*(?:[ \t]*=[ \t]*(?:[^ \t\n"'=<>\x60]+|'[^']*'|"[^"]*"))?)`;
const TYPE7_OPEN = new RegExp(String.raw`^<([A-Za-z][A-Za-z0-9-]*)${ATTR}*[ \t]*\/?>[ \t]*$`);
const TYPE7_CLOSE = /^<\/([A-Za-z][A-Za-z0-9-]*)[ \t]*>[ \t]*$/;
// A thematic break (§4.1) and a setext underline (§4.3) end a paragraph, so a type 7 block may start after one.
const THEMATIC_BREAK = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
// Inline constructs that bind as tightly as a comment (§6). Each is tried at its own position, leftmost first, so a
// `<!--` inside an earlier code span, autolink, tag, processing instruction, declaration, CDATA section or link tail is
// part of that construct and never opens a comment.
const ESCAPABLE = /[!-\/:-@[-`{-~]/;
const INLINE_RAW = [
  /^<[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*>/, // URI autolink
  /^<[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*>/, // email autolink
  /^<[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][A-Za-z0-9_.:-]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*\/?>/, // open tag
  /^<\/[A-Za-z][A-Za-z0-9-]*\s*>/, // closing tag
  /^<\?[\s\S]*?\?>/, // processing instruction
  /^<![A-Za-z][^>]*>/, // declaration
  /^<!\[CDATA\[[\s\S]*?\]\]>/, // CDATA
];
// An inline link's tail after the `]` that closes a link text: destination and optional title.
const LINK_TAIL = /^\(\s*(?:<[^<>\n]*>|[^\s()<]*(?:\([^\s()]*\)[^\s()<]*)*)(?:\s+(?:"[^"]*"|'[^']*'|\([^()]*\)))?\s*\)/;

// The inline comment GitHub hides. CommonMark 0.31.2 (§6.6, markdown-it here) also accepts `<!-->`, `<!--->` and text
// holding `--`; cmark-gfm (GitHub, the 0.29 rule) shows those literally, links and all, so the mask leaves them as
// prose: text not starting with `>` or `->`, holding no `--` and not ending in `-`. That also rules out `--!>` (a
// browser's comment end) inside a masked span.
const INLINE_COMMENT = /^<!--(?!-?>)(?:[^-]|-(?!-))*-->/;

/**
 * Blank every inline comment (§6.6) in one paragraph's text, as INLINE_COMMENT defines it; anything else that starts
 * `<!--` is literal text and stays visible. Backslash escapes, code spans, autolinks, raw HTML and link tails are
 * skipped whole, leftmost first, so a `<!--` inside one of them never opens a comment.
 */
function maskInlineComments(text, blank, labels = new Set()) {
  let out = "";
  let i = 0;
  // Open link-text brackets, innermost last (§6.3, "look for link or image"). A recognized link makes every earlier
  // `[` inactive, since a link cannot contain a link; an image does not.
  const openers = [];
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
    if (ch === "[") openers.push({ at: i, image: text[i - 1] === "!" });
    if (ch === "]" && openers.length > 0) {
      // Only a `]` that closes an ACTIVE `[` can start an inline link tail; an unmatched or deactivated `](` is
      // literal text, and skipping it would leave a comment inside it unmasked (Root on 32c2efad and 16340f4c).
      const opener = openers.pop();
      const tail = text[i + 1] === "(" ? LINK_TAIL.exec(text.slice(i + 1)) : null;
      const ref = text[i + 1] === "[" ? /^\[([^\[\]]*)\]/.exec(text.slice(i + 1)) : null;
      const label = ref && ref[1].trim() !== "" ? ref[1] : text.slice(opener.at + 1, i);
      // A reference link counts only when its label is defined in this document; a full reference's `[label]` is
      // consumed with it. Either kind of link deactivates every earlier opener.
      const isLink = Boolean(tail) || labels.has(normalizeLabel(label));
      if (isLink && !opener.image) openers.length = 0;
      if (tail) {
        out += text.slice(i, i + 1 + tail[0].length);
        i += 1 + tail[0].length;
        continue;
      }
      if (ref && isLink) {
        out += text.slice(i, i + 1 + ref[0].length);
        i += 1 + ref[0].length;
        continue;
      }
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
        const m = INLINE_RAW.map((re) => re.exec(rest)).find(Boolean);
        if (m) {
          out += m[0];
          i += m[0].length;
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
/** A link label as §4.7 matches it: trimmed, inner whitespace collapsed, case-folded. */
function normalizeLabel(label) {
  return label.trim().replace(/[ \t\r\n]+/g, " ").toLowerCase();
}

const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/;

/**
 * Which HTML block (§4.6) starts on `line`, if any: its type and, for types 1–5, the end marker. `inParagraph`
 * matters only for type 7, the one kind that cannot interrupt a paragraph.
 */
function htmlBlockStart(line, inParagraph) {
  const m = /^ {0,3}(<.*)$/.exec(line);
  if (!m) return null;
  const rest = m[1];
  const col = line.length - rest.length;
  if (/^<(?:pre|script|style|textarea)(?:[ \t>]|$)/i.test(rest)) return { type: 1, col, end: /<\/(?:pre|script|style|textarea)>/i };
  if (rest.startsWith("<!--")) return { type: 2, col, end: "-->" };
  if (rest.startsWith("<?")) return { type: 3, col, end: "?>" };
  if (/^<![A-Z]/.test(rest)) return { type: 4, col, end: ">" };
  if (rest.startsWith("<![CDATA[")) return { type: 5, col, end: "]]>" };
  const t6 = /^<\/?([A-Za-z][A-Za-z0-9]*)(?:[ \t]|\/?>|$)/.exec(rest);
  if (t6 && HTML_TYPE6_TAGS.has(t6[1].toLowerCase())) return { type: 6, col };
  if (!inParagraph) {
    const t7 = TYPE7_OPEN.exec(rest) || TYPE7_CLOSE.exec(rest);
    if (t7 && !/^(?:pre|script|style|textarea)$/i.test(t7[1])) return { type: 7, col };
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
function blockRanges(lines, treatUnclosedAsFence) {
  const out = [];
  let inParagraph = false;
  for (let i = 0; i < lines.length; i += 1) {
    const h = htmlBlockStart(content(lines[i]), inParagraph);
    if (h && h.type <= 5) {
      let j = i;
      let at = endAfter(lines[i], h.end, h.col + (h.type === 2 ? 2 : 1));
      while (at < 0 && j + 1 < lines.length) {
        j += 1;
        at = endAfter(lines[j], h.end, 0);
      }
      const kind = h.type === 2 ? "comment" : "html";
      if (at < 0) {
        out.push({ kind, start: i, end: lines.length - 1, closed: false, col: h.col });
        break;
      }
      out.push({ kind, start: i, end: j, closed: true, col: h.col, endCol: at });
      i = j;
      inParagraph = false;
      continue;
    }
    if (h) {
      let j = i;
      while (j + 1 < lines.length && !isBlank(lines[j + 1])) j += 1;
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
    if (isBlank(text) || ATX_HEADING.test(text) || THEMATIC_BREAK.test(text)) inParagraph = false;
    else if (inParagraph && SETEXT_UNDERLINE.test(text)) inParagraph = false;
    else if (!inParagraph && indentColumns(text) >= 4) inParagraph = false;
    else inParagraph = true;
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
  // Link reference definitions (§4.7) decide whether `[x]`, `[x][]` and `[x][y]` are links. Counting one that sits
  // inside code only makes more brackets count as links, which masks more, never less.
  const labels = new Set();
  for (const line of lines) {
    const def = /^ {0,3}\[([^\[\]]+)\]:/.exec(line);
    if (def) labels.add(normalizeLabel(def[1]));
  }
  // Fences and raw HTML blocks are masked whole: markdown link syntax inside either is not a link a reader can
  // click (§4.6: an HTML block's lines are raw HTML, not parsed as Markdown). Each remaining non-blank line joins a
  // paragraph segment, and inline HTML comments are matched within one paragraph, never across a block boundary or
  // a blank line, as CommonMark's inline parse is per block.
  const segment = new Array(lines.length).fill(-1);
  const tail = new Set();
  let nextSegment = 0;
  for (const b of blockRanges(lines, treatUnclosedAsFence)) {
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
  for (let i = 0; i < lines.length; i += 1) {
    if (segment[i] !== -1) {
      inPara = false;
      continue;
    }
    const text = content(lines[i]);
    if (isBlank(text)) {
      segment[i] = -2;
      inPara = false;
    } else if (tail.has(i)) {
      // The rest of a comment block's closing line still belongs to that HTML block (§4.6): it is its own segment,
      // joins no paragraph above it, and the next line starts a new one.
      segment[i] = nextSegment++;
      inPara = false;
    } else if (
      ATX_HEADING.test(text) ||
      THEMATIC_BREAK.test(text) ||
      (inPara && SETEXT_UNDERLINE.test(text)) ||
      (!inPara && indentColumns(text) >= 4)
    ) {
      segment[i] = nextSegment++;
      inPara = false;
    } else {
      segment[i] = inPara ? segment[i - 1] : nextSegment++;
      inPara = true;
    }
  }
  const masked = [];
  for (let i = 0; i < lines.length; ) {
    let j = i;
    while (j + 1 < lines.length && segment[j + 1] === segment[i] && segment[i] >= 0) j += 1;
    let chunk = lines.slice(i, j + 1).join("\n");
    if (segment[i] >= 0) chunk = maskInlineComments(chunk, blank, labels);
    masked.push(chunk);
    i = j + 1;
  }
  return masked
    .join("\n")
    .split("\n")
    .map((l) => l.replace(/(`+)[^`\n]*?\1/g, blank))
    .join("\n");
}
