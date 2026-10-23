// codeOnly — comments and string/regex content blanked, for gates that read code shapes. Split out of
// check-entry-guards.mjs so scripts/lib/shipped-imports.mjs can use it without an import cycle.

// Is a `/` here the start of a regex literal (not a division)? Decided by the last significant char before it.
function regexAllowed(out) {
  const m = /(\S)\s*$/.exec(out.slice(-40));
  if (!m) return true;
  if ("(,=:[!&|?{};+-*%<>~^".includes(m[1])) return true;
  return /\b(?:return|typeof|case|in|of|delete|void|throw|else)\s*$/.test(out.slice(-12));
}

/**
 * Pure: `text` with comments and string, template and regex-literal CONTENT blanked to spaces. Newlines and every offset
 * are preserved (so a position found in the result is the same position in `text`); string quotes are kept, so a
 * string is still visible as one; a template's `${expr}` is kept as ` (expr)`. `keepStrings` leaves string and
 * template literals untouched (to read an import specifier). A regex literal is recognised by the character before
 * its `/` (regexAllowed), a heuristic: a division after `)` or an identifier reads as a division, which is right for
 * the code in this tree and wrong for rare shapes.
 */
export function codeOnly(text, keepStrings = false) {
  const n = text.length;
  let out = "";
  const blank = (str) => str.replace(/[^\n]/g, " ");
  let lexTemplate;
  const lex = (start, inExpr) => {
    let i = start;
    let depth = 0;
    while (i < n) {
      const c = text[i];
      const d = text[i + 1];
      if (c === "/" && d === "/") {
        let j = text.indexOf("\n", i);
        if (j < 0) j = n;
        out += blank(text.slice(i, j));
        i = j;
      } else if (c === "/" && d === "*") {
        let j = text.indexOf("*/", i + 2);
        j = j < 0 ? n : j + 2;
        out += blank(text.slice(i, j));
        i = j;
      } else if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < n && text[j] !== c && text[j] !== "\n") j += text[j] === "\\" ? 2 : 1;
        j = Math.min(j + 1, n);
        const lit = text.slice(i, j);
        // Offsets are preserved in every mode (a module specifier can be read back from the original text at the
        // position the blanked string occupies); the quotes themselves are kept so a string is still VISIBLE as one.
        out += keepStrings ? lit : lit.length > 1 && lit.endsWith(c) ? c + blank(lit.slice(1, -1)) + c : blank(lit);
        i = j;
      } else if (c === "/" && regexAllowed(out)) {
        // A regex literal: its content (quotes, backticks, braces) is not code and must not start a string.
        let j = i + 1;
        let inClass = false;
        while (j < n && text[j] !== "\n" && (inClass || text[j] !== "/")) {
          if (text[j] === "\\") j += 1;
          else if (text[j] === "[") inClass = true;
          else if (text[j] === "]") inClass = false;
          j += 1;
        }
        j = Math.min(j + 1, n);
        out += blank(text.slice(i, j));
        i = j;
      } else if (c === "`") {
        i = lexTemplate(i);
      } else if (inExpr && c === "{") {
        depth += 1;
        out += c;
        i += 1;
      } else if (inExpr && c === "}") {
        if (depth === 0) return i;
        depth -= 1;
        out += c;
        i += 1;
      } else {
        out += c;
        i += 1;
      }
    }
    return i;
  };
  lexTemplate = (start) => {
    out += "`";
    let i = start + 1;
    while (i < n && text[i] !== "`") {
      if (text[i] === "\\") {
        out += keepStrings ? text.slice(i, i + 2) : blank(text.slice(i, i + 2));
        i += 2;
      } else if (text[i] === "$" && text[i + 1] === "{") {
        out += keepStrings ? "${" : " (";
        i = lex(i + 2, true);
        out += keepStrings ? "}" : ")";
        i += 1;
      } else {
        out += keepStrings ? text[i] : blank(text[i]);
        i += 1;
      }
    }
    out += "`";
    return i + 1;
  };
  lex(0, false);
  return out;
}

