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

/** Replace every character with a space, keeping newlines so offsets and lines survive. */
const blank = (s) => s.replace(/[^\n]/g, " ");

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
const ATTR = String.raw`(?:\s+[A-Za-z_:][\w.:-]*(?:\s*=\s*(?:[^\s"'=<>\x60]+|'[^']*'|"[^"]*"))?)`;
const TYPE7_OPEN = new RegExp(String.raw`^<([A-Za-z][A-Za-z0-9-]*)${ATTR}*\s*\/?>\s*$`);
const TYPE7_CLOSE = /^<\/([A-Za-z][A-Za-z0-9-]*)\s*>\s*$/;

/**
 * Which HTML block (§4.6) starts on `line`, if any: its type and, for types 1–5, the end marker. `inParagraph`
 * matters only for type 7, the one kind that cannot interrupt a paragraph.
 */
function htmlBlockStart(line, inParagraph) {
  const m = /^ {0,3}(<.*)$/.exec(line);
  if (!m) return null;
  const rest = m[1];
  const col = line.length - rest.length;
  if (/^<(?:pre|script|style|textarea)(?:[\s>]|$)/i.test(rest)) return { type: 1, col, end: /<\/(?:pre|script|style|textarea)>/i };
  if (rest.startsWith("<!--")) return { type: 2, col, end: "-->" };
  if (rest.startsWith("<?")) return { type: 3, col, end: "?>" };
  if (/^<![A-Za-z]/.test(rest)) return { type: 4, col, end: ">" };
  if (rest.startsWith("<![CDATA[")) return { type: 5, col, end: "]]>" };
  const t6 = /^<\/?([A-Za-z][A-Za-z0-9]*)(?:\s|\/?>|$)/.exec(rest);
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
    const h = htmlBlockStart(lines[i], inParagraph);
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
      while (j + 1 < lines.length && lines[j + 1].trim() !== "") j += 1;
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
    inParagraph = lines[i].trim() !== "" && !/^ {0,3}#{1,6}(?:\s|$)/.test(lines[i]);
  }
  return out;
}

/**
 * Mask fenced blocks, raw HTML blocks, HTML comments and inline code spans, preserving every offset.
 * Inline code spans are matched WITHIN a line only: a span that wraps a newline is rare
 * enough, and a greedy multi-line match that met a stray backtick would blank real prose.
 *
 * Comment BLOCKS (an opener at the start of a line) are masked from `<!--` to their `-->`, or to end of input when
 * they never close (CommonMark 0.31.2 §4.6, type 2). A comment that opens mid-line is not a block: it is masked only
 * when it closes, and an unmatched mid-line opener is left alone.
 */
export function maskNonProse(text, { treatUnclosedAsFence = true } = {}) {
  const lines = text.split("\n");
  // Fences and raw HTML blocks are masked whole: markdown link syntax inside either is not a link a reader can
  // click (§4.6: an HTML block's lines are raw HTML, not parsed as Markdown). Each remaining non-blank line joins a
  // paragraph segment, and inline HTML comments are matched within one paragraph, never across a block boundary or
  // a blank line, as CommonMark's inline parse is per block.
  const segment = new Array(lines.length).fill(-1);
  let nextSegment = 0;
  for (const b of blockRanges(lines, treatUnclosedAsFence)) {
    for (let i = b.start; i <= b.end; i += 1) {
      segment[i] = -2;
      if (b.kind !== "comment") {
        lines[i] = blank(lines[i]);
        continue;
      }
      const from = i === b.start ? b.col : 0;
      const to = b.closed && i === b.end ? b.endCol : lines[i].length;
      lines[i] = lines[i].slice(0, from) + blank(lines[i].slice(from, to)) + lines[i].slice(to);
    }
  }
  for (let i = 0; i < lines.length; i += 1) {
    if (segment[i] !== -1) continue;
    if (lines[i].trim() === "") {
      segment[i] = -2;
      continue;
    }
    segment[i] = i > 0 && segment[i - 1] >= 0 ? segment[i - 1] : nextSegment++;
  }
  const masked = [];
  for (let i = 0; i < lines.length; ) {
    let j = i;
    while (j + 1 < lines.length && segment[j + 1] === segment[i] && segment[i] >= 0) j += 1;
    let chunk = lines.slice(i, j + 1).join("\n");
    if (segment[i] >= 0) chunk = chunk.replace(/<!--[\s\S]*?-->/g, blank);
    masked.push(chunk);
    i = j + 1;
  }
  return masked
    .join("\n")
    .split("\n")
    .map((l) => l.replace(/(`+)[^`\n]*?\1/g, blank))
    .join("\n");
}
