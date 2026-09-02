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
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i]);
    if (!m) continue;
    const [, marker, rest] = m;
    if (!open) {
      // An opening backtick fence may not carry a backtick in its info string.
      if (marker[0] === "`" && rest.includes("`")) continue;
      open = { start: i, char: marker[0], len: marker.length };
      continue;
    }
    if (marker[0] === open.char && marker.length >= open.len && rest.trim() === "") {
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
 * Mask fenced blocks, HTML comments and inline code spans, preserving every offset.
 * Inline code spans are matched WITHIN a line only: a span that wraps a newline is rare
 * enough, and a greedy multi-line match that met a stray backtick would blank real prose.
 */
export function maskNonProse(text, { treatUnclosedAsFence = true } = {}) {
  const lines = text.split("\n");
  const fenced = fencedLineFlags(lines, { treatUnclosedAsFence });
  let out = lines.map((l, i) => (fenced[i] ? blank(l) : l)).join("\n");
  out = out.replace(/<!--[\s\S]*?-->/g, blank);
  out = out
    .split("\n")
    .map((l) => l.replace(/(`+)[^`\n]*?\1/g, blank))
    .join("\n");
  return out;
}
