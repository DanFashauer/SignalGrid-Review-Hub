// Blank comments and mask string-literal CONTENTS, in ONE left-to-right walk.
//
// Shared by scripts/check-nan-fail-open.mjs and scripts/check-posed-bounds.mjs.
// Both gates quote the defective shape they hunt for — in their own headers, in
// their self-test fixtures, and in the fix commits — so a gate that matched raw
// text would fire on the prose explaining the bug and punish writing the
// explanation down.
//
// ONE PASS, NOT TWO, and that is the whole design. A comment stripper that cuts at
// the first `//` slices its own `l.indexOf("//")` in half, leaving an unterminated
// quote that throws every subsequent literal out of phase; the masker then blanks
// the code and preserves the strings — exactly inverted. check-nan-fail-open did
// that on its first run and reported two false positives on itself.
//
// Newlines are preserved so reported line numbers stay true.
//
// One copy, not two: a broken helper here fails BOTH gates' self-tests loudly,
// which is a better failure than two copies drifting apart quietly.

/**
 * @param {string} text source text
 * @returns {string} same length in lines, comments blanked, literal contents masked
 */
export function sanitize(text) {
  let out = "";
  let i = 0;
  const keepNewlines = (chunk) => chunk.replace(/[^\n]/g, " ");
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === "/" && next === "/") {
      const nl = text.indexOf("\n", i);
      const stop = nl === -1 ? text.length : nl;
      out += keepNewlines(text.slice(i, stop));
      i = stop;
      continue;
    }
    if (c === "/" && next === "*") {
      const close = text.indexOf("*/", i + 2);
      const stop = close === -1 ? text.length : close + 2;
      out += keepNewlines(text.slice(i, stop));
      i = stop;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += c;
      i += 1;
      while (i < text.length) {
        if (text[i] === "\\") {
          out += "  ";
          i += 2;
          continue;
        }
        if (text[i] === quote) {
          out += quote;
          i += 1;
          break;
        }
        out += text[i] === "\n" ? "\n" : " ";
        i += 1;
      }
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}
