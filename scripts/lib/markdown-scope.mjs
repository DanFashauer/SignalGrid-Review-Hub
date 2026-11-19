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
  let inParagraph = false;
  let paraStart = -1;
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
    else if (inParagraph && SETEXT_UNDERLINE.test(text) && !(judgeDefinitions && allReferenceDefinitions(lines.slice(paraStart, i)))) inParagraph = false;
    else if (!inParagraph && indentColumns(text) >= 4) inParagraph = false;
    else {
      if (!inParagraph) paraStart = i;
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
  for (const b of blockRanges(lines, treatUnclosedAsFence, judgeDefinitions)) {
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
      (inPara && SETEXT_UNDERLINE.test(text) && !(judgeDefinitions && allReferenceDefinitions(source.slice(paraStart, i)))) ||
      (!inPara && indentColumns(text) >= 4)
    ) {
      segment[i] = nextSegment++;
      inPara = false;
    } else {
      if (!inPara) paraStart = i;
      segment[i] = inPara ? segment[i - 1] : nextSegment++;
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
