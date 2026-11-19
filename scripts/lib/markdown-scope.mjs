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

/**
 * Block-level structure in source order, the way CommonMark reads it: at each line outside a block, an HTML
 * comment block (type 2: 0–3 spaces then `<!--`) or a fence may start, and whichever starts FIRST owns the lines
 * up to its end. A fence marker inside a comment block is comment text, and a `<!--` inside a fence is code.
 * Deciding this on the original lines is the point: masking fences first can erase a comment's `-->` and make a
 * closed comment look unclosed (Codex on #2368), and masking comments first can do the same to a fence.
 *
 * A comment block ends on the first line, its own included, that contains `-->`, or at end of input. An unclosed
 * fence runs to end of input only when `treatUnclosedAsFence`; otherwise its opener line is left as prose and the
 * scan continues below it.
 *
 * @returns {{kind:"fence"|"comment",start:number,end:number,closed:boolean,col?:number,endCol?:number}[]}
 */
function blockRanges(lines, treatUnclosedAsFence) {
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const c = /^ {0,3}<!--/.exec(lines[i]);
    if (c) {
      const col = c[0].length - 4;
      let j = i;
      let at = lines[i].indexOf("-->", col + 2);
      while (at < 0 && j + 1 < lines.length) {
        j += 1;
        at = lines[j].indexOf("-->");
      }
      if (at < 0) {
        out.push({ kind: "comment", start: i, end: lines.length - 1, closed: false, col });
        break;
      }
      out.push({ kind: "comment", start: i, end: j, closed: true, col, endCol: at + 3 });
      i = j;
      continue;
    }
    const open = fenceOpener(lines[i]);
    if (!open) continue;
    let k = i + 1;
    while (k < lines.length && !closesFence(lines[k], open)) k += 1;
    if (k < lines.length) {
      out.push({ kind: "fence", start: i, end: k, closed: true });
      i = k;
    } else if (treatUnclosedAsFence) {
      out.push({ kind: "fence", start: i, end: lines.length - 1, closed: false });
      break;
    }
  }
  return out;
}

/**
 * Mask fenced blocks, HTML comments and inline code spans, preserving every offset.
 * Inline code spans are matched WITHIN a line only: a span that wraps a newline is rare
 * enough, and a greedy multi-line match that met a stray backtick would blank real prose.
 *
 * Comment BLOCKS (an opener at the start of a line) are masked from `<!--` to their `-->`, or to end of input when
 * they never close (CommonMark 0.31.2 §4.6, type 2). A comment that opens mid-line is not a block: it is masked only
 * when it closes, and an unmatched mid-line opener is left alone.
 */
export function maskNonProse(text, { treatUnclosedAsFence = true } = {}) {
  const lines = text.split("\n");
  for (const b of blockRanges(lines, treatUnclosedAsFence)) {
    for (let i = b.start; i <= b.end; i += 1) {
      if (b.kind === "fence") {
        lines[i] = blank(lines[i]);
        continue;
      }
      const from = i === b.start ? b.col : 0;
      const to = b.closed && i === b.end ? b.endCol : lines[i].length;
      lines[i] = lines[i].slice(0, from) + blank(lines[i].slice(from, to)) + lines[i].slice(to);
    }
  }
  let out = lines.join("\n");
  out = out.replace(/<!--[\s\S]*?-->/g, blank);
  out = out
    .split("\n")
    .map((l) => l.replace(/(`+)[^`\n]*?\1/g, blank))
    .join("\n");
  return out;
}
