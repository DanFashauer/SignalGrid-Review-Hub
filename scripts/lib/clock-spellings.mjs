// The one definition of "reads the clock or a randomness source", shared by the
// two gates that enforce golden rule 2 (scripts/safety-check.mjs check 1 over the
// decision core, scripts/review-invariants.mjs check 2 over every lib package).
//
// Both used to test only /\b(Date\.now|Math\.random)\s*\(/, which is two of the
// ways to say it. This module owns the rest, plus the masker that blanks comments
// and string/template text so prose never counts and code is never hidden.
//
// WHAT IT COVERS is exactly what LINE_SPELLINGS, DESTRUCTURES and the import
// aliases below list. It is NOT "every spelling": see CEILING for what it cannot
// see. A gate that claims more than its table is the over-claim this repo gates.
//
// CEILING (declared, not built; one follow-up row in docs/BUILD_BACKLOG.md):
//   · LINES ARE NUMBERED BY LF, as git, grep and the pins count them. A CR-only
//     (classic Mac) file is one line to a pin and to a problem report, though a `//`
//     comment and a regex literal in it do end at the CR.
//   · PINS COUNT LINES, not reads. Two reads on one line are one hit.
//   · Matching is per line, so `Date` newline `.now()` and `new Date(` newline `)`
//     are not seen.
//   · A `}` followed by `/` is read as a regex start (a block end), so division
//     after an object literal (`{} / x / y`) can blank the text between the two
//     slashes. No live site; the masker reports the desync it causes only when a
//     quote or backtick is swallowed.
//   · FALSE-ALARM direction (a false hit, not a hidden read): import discovery reads string
//     text, so a fixture string holding `import { randomBytes as seeded } from
//     "crypto"` makes a later `seeded(` a false hit; and `\bcrypto`, `\bperformance`
//     and `\bprocess` also match after a dot, so `fixture.performance.now()` is a
//     false hit. No live site for either.
//   · Import forms not followed: a unicode-letter alias; a string-named import
//     (`import { "randomBytes" as rb }`); an inline `require("crypto").randomBytes(4)`;
//     `await import("crypto")`; `const { webcrypto } = nc` (a receiver taken from a
//     namespace); and a webcrypto or crypto function bound by any other route. This
//     list is not exhaustive: the followed forms are the ones the plants name.
//   · An uncalled reference (`const c = Date.now`), Reflect.apply / .call,
//     Temporal / Intl, require("crypto") destructured with a rename, and unicode
//     escapes in an identifier are not seen.
//
// THE MASKER FAILS CLOSED. Guessing regex-versus-division wrongly used to blank
// the REST OF THE FILE, so a later Date.now() vanished. The masker now (a) decides
// from the previous token it has actually seen, not a character lookback, and
// (b) reports a file it can no longer follow (a string that crosses a newline, a
// template or block comment still open at end of file, unbalanced ${ }) as a
// PROBLEM, which both gates treat as fatal and name. A file the scanner cannot read
// is never a clean file.

// Keywords after which a `/` begins a regex. `in` and `of` are NOT in this set
// because they are decided by context in regexStartsHere. `of` is the for-of
// OPERATOR only inside a `for (` head, after a finished operand (`for (const x of
// /x=/.exec(s))`); everywhere else it is a plain identifier and the slash divides
// (`const of = 4; of / 2`, `if (a) of / 2`, `} of / 2`, `export default of / 2`).
// `in` is reserved, so after a finished operand it is always the operator. A
// keyword preceded by `.` (`counts.in / a`) is a property name, never a keyword.
// A spread `.../re/` begins a regex; `1./2` divides.
const REGEX_AFTER_KEYWORD = new Set([
  "return", "typeof", "case", "void", "delete", "throw", "yield", "await", "else", "do",
  "instanceof", "new", "extends", "default",
]);
const CONTROL_PAREN_KEYWORD = new Set(["if", "while", "for", "with"]);
const IS_WORD = /[\w$]/;
// ECMAScript line terminators: a `//` comment and a regex literal end at any of them,
// so a comment ending at U+2028 cannot hide the code after it.
const EOL = /[\n\r\u2028\u2029]/;

// Operators and punctuation after which a `/` begins a regex. `)` and `}` are
// handled separately; `]` and a closing quote/backtick are operands.
const REGEX_AFTER_PUNCT = /[(,=:[&|?{;+\-*%<>~^]/;

// Mask comments and string/template/regex literal TEXT (delimiters and newlines
// kept, so offsets and line numbers survive). Returns
//   text      comments and literal text blanked: what the scanners read
//   visible   only comments blanked, string text kept: what import detection reads
//   problems  [{ line, what }] — places the masker lost the thread
export function maskSource(src, blankComments = true) {
  const n = src.length;
  const out = src.split("");
  const vis = src.split("");
  const problems = [];
  const lineOf = (k) => src.slice(0, k).split("\n").length;
  const blank = (k) => { if (!EOL.test(out[k])) out[k] = " "; };
  const blankBoth = (k) => { if (!EOL.test(out[k])) { out[k] = " "; vis[k] = " "; } };
  const stack = [{ mode: "code", depth: 0, parens: [], lastClose: null }];
  let i = 0;

  // The previous significant (non-space) index in `out`, which has comments and
  // literal text already blanked, so only real code and delimiters are seen.
  const prevSig = (from) => {
    let k = from - 1;
    // `\s` is exactly ECMAScript WhiteSpace plus LineTerminator, so a no-break space,
    // a form feed or a U+2028 is never mistaken for the previous token.
    while (k >= 0 && /\s/.test(out[k])) k--;
    return k;
  };
  const wordBefore = (k) => {
    let s = k;
    while (s >= 0 && IS_WORD.test(out[s])) s--;
    return { word: out.slice(s + 1, k + 1).join(""), start: s + 1 };
  };

  // Would a `/` at index `at` begin a regex? Decided from the previous token.
  const regexStartsHere = (top, at = i) => {
    const k = prevSig(at);
    if (k < 0) return true;
    const p = out[k];
    // A `!` is TypeScript's postfix non-null (`m.get(k)! / 2`, an operand-ender) when
    // a `/` at the `!` itself would divide, and a prefix NOT (`= !/x/.test(s)`, an
    // operator) when it would start a regex. Ask the question one token back.
    if (p === "!") return regexStartsHere(top, k);
    if (p === "+" || p === "-") {
      // `i++ / 2`: the operator ends an operand, so the slash divides.
      if (k > 0 && out[k - 1] === p) return false;
      return true;
    }
    if (p === ")") return top.lastClose !== null && top.lastClose.pos === k && top.lastClose.control;
    if (p === "}") return true;
    if (p === "]" || p === "'" || p === '"' || p === "`") return false;
    if (IS_WORD.test(p)) {
      const { word, start } = wordBefore(k);
      if (start > 0 && out[start - 1] === ".") return false;
      // Does a finished operand end just before the word at `start`?
      const operandBefore = () => {
        const b = prevSig(start);
        if (b < 0) return false;
        const q = out[b];
        if (IS_WORD.test(q)) return !REGEX_AFTER_KEYWORD.has(wordBefore(b).word);
        return q === ")" || q === "]" || q === "}" || q === "'" || q === '"' || q === "`";
      };
      // `for (x of /re/...)`: the operator, only inside a `for (` head.
      if (word === "of") return top.parens.length > 0 && top.parens[top.parens.length - 1] === "for" && operandBefore();
      // `k in /re/`: `in` is reserved, so after an operand it is always the operator.
      if (word === "in") return operandBefore();
      return REGEX_AFTER_KEYWORD.has(word);
    }
    // Spread: `.../re/` begins a regex; `1./2` divides.
    if (p === "." && k >= 2 && out[k - 1] === "." && out[k - 2] === ".") return true;
    return REGEX_AFTER_PUNCT.test(p);
  };

  while (i < n) {
    const top = stack[stack.length - 1];
    const c = src[i];
    if (top.mode === "code") {
      if (c === "\\") { i += 2; continue; }
      if (blankComments && c === "/" && src[i + 1] === "/") {
        let e = i;
        while (e < n && !EOL.test(src[e])) e++;
        for (let m = i; m < e; m++) blankBoth(m);
        i = e; continue;
      }
      if (blankComments && c === "/" && src[i + 1] === "*") {
        let e = src.indexOf("*/", i + 2);
        if (e === -1) {
          problems.push({ line: lineOf(i), what: "a block comment is never closed" });
          e = n;
        } else e += 2;
        for (let m = i; m < e; m++) blankBoth(m);
        i = e; continue;
      }
      if (c === "/") {
        if (regexStartsHere(top)) {
          let j = i + 1;
          let inClass = false;
          while (j < n && !EOL.test(src[j])) {
            if (src[j] === "\\") { j += 2; continue; }
            if (src[j] === "[") inClass = true;
            else if (src[j] === "]") inClass = false;
            else if (src[j] === "/" && !inClass) break;
            j++;
          }
          if (j < n && src[j] === "/") {
            for (let m = i + 1; m < j; m++) blankBoth(m);
            i = j + 1;
            continue;
          }
        }
        i++; continue;
      }
      if (c === "'") { stack.push({ mode: "sq", from: i }); i++; continue; }
      if (c === '"') { stack.push({ mode: "dq", from: i }); i++; continue; }
      if (c === "`") { stack.push({ mode: "tmpl", from: i }); i++; continue; }
      if (c === "(") {
        // Keep the keyword that opened the paren (`for`, `if`, a call's name or none),
        // so `of` can be told from an identifier and `)` from a control head's end.
        const k = prevSig(i);
        let kw = null;
        if (k >= 0 && IS_WORD.test(out[k])) {
          const { word, start } = wordBefore(k);
          if (start > 0 && out[start - 1] === ".") kw = null;
          else if (word === "await") {
            // `for await (` is a for head.
            const b = prevSig(start);
            kw = b >= 0 && IS_WORD.test(out[b]) && wordBefore(b).word === "for" ? "for" : word;
          } else kw = word;
        }
        top.parens.push(kw);
        i++; continue;
      }
      if (c === ")") {
        const kw = top.parens.length ? top.parens.pop() : null;
        top.lastClose = { pos: i, control: kw !== null && CONTROL_PAREN_KEYWORD.has(kw) };
        i++; continue;
      }
      if (c === "{") { top.depth++; i++; continue; }
      if (c === "}") {
        if (top.depth === 0 && stack.length > 1) { stack.pop(); i++; continue; } // close ${…}
        top.depth--; i++; continue;
      }
      i++; continue;
    }
    if (top.mode === "sq" || top.mode === "dq") {
      const q = top.mode === "sq" ? "'" : '"';
      if (c === "\\") { blank(i); blank(i + 1); i += 2; continue; }
      if (c === q) { stack.pop(); i++; continue; }
      if (c === "\n" || c === "\r") {
        // A quoted string cannot cross a newline. The masker has lost the thread:
        // say so, and recover to code so one file does not blank the next lines.
        problems.push({ line: lineOf(top.from), what: "a quoted string crosses a newline (regex-versus-division or quote desync)" });
        stack.pop(); i++; continue;
      }
      blank(i); i++; continue;
    }
    // template literal
    if (c === "\\") { blank(i); blank(i + 1); i += 2; continue; }
    if (c === "`") { stack.pop(); i++; continue; }
    if (c === "$" && src[i + 1] === "{") {
      stack.push({ mode: "code", depth: 0, parens: [], lastClose: null });
      i += 2; continue;
    }
    blank(i); i++;
  }
  const last = stack[stack.length - 1];
  if (stack.length > 1 || last.mode !== "code") {
    problems.push({
      line: lineOf(last.from ?? 0),
      what: `a ${last.mode === "code" ? "template expression" : last.mode === "tmpl" ? "template literal" : "string"} is still open at end of file`,
    });
  }
  return { text: out.join(""), visible: vis.join(""), problems };
}

// `X["name"]` / `X['name']` is the same access as `X.name`. Line count is kept.
const normalizeBracketAccess = (src) =>
  src
    .replace(/\?\.\s*\[\s*(["'])([A-Za-z_$][\w$]*)\1\s*\]/g, "?.$2")
    .replace(/\[\s*(["'])([A-Za-z_$][\w$]*)\1\s*\]/g, ".$2");

// Member access and call, each with optional chaining: `Date?.now()`, `Date.now?.()`.
const DOT = String.raw`\s*\??\.\s*`;
const CALL = String.raw`\s*(?:\?\.\s*)?\(`;
const G = String.raw`(?:globalThis${DOT})?`;
const RANDOM_FNS = ["randomUUID", "getRandomValues", "randomBytes", "randomInt", "randomFillSync", "randomFill", "pseudoRandomBytes"];
const RANDOM_ALT = RANDOM_FNS.join("|");

// Per-line spellings: WAYS TO READ THE WALL CLOCK OR A NON-DETERMINISTIC SOURCE.
// Every entry has a plant of the same label in CLOCK_PLANTS, and the self-test
// requires the entry itself (not just some other pattern) to match it.
export const LINE_SPELLINGS = [
  { label: "Date.now()", re: new RegExp(String.raw`\bDate${DOT}now${CALL}`) },
  { label: "Math.random()", re: new RegExp(String.raw`\bMath${DOT}random${CALL}`) },
  // `new Date()` and a bare `Date()` both read the clock; `new Date(x)` does not.
  { label: "argless Date()", re: new RegExp(String.raw`(?<![\w$.])${G}Date\s*\(\s*\)`) },
  { label: "crypto random call", re: new RegExp(String.raw`\bcrypto${DOT}(?:webcrypto${DOT})?(?:${RANDOM_ALT})${CALL}`) },
  // Imported without a rename, the bare name is the call.
  { label: "imported random call", re: new RegExp(String.raw`(?<![\w$.])(?:${RANDOM_ALT})\s*\(`) },
  { label: "performance.now()", re: new RegExp(String.raw`\bperformance${DOT}now${CALL}`) },
  { label: "performance.timeOrigin", re: new RegExp(String.raw`\bperformance${DOT}timeOrigin\b`) },
  { label: "process.uptime()", re: new RegExp(String.raw`\bprocess${DOT}uptime${CALL}`) },
  { label: "process.hrtime", re: new RegExp(String.raw`\bprocess${DOT}hrtime\b`) },
  { label: "hrtime.bigint()", re: new RegExp(String.raw`\bhrtime${DOT}bigint${CALL}`) },
];

// `const { now } = Date` and kin, possibly across lines, so these run over the
// whole text and map the match back to its line.
const destructure = (name, from) =>
  new RegExp(String.raw`\{[^{}]*\b(?:${name})\b[^{}]*\}\s*=\s*${G}${from}\b`, "g");
export const DESTRUCTURES = [
  { label: "{ now } = Date", re: destructure("now", "Date") },
  { label: "{ random } = Math", re: destructure("random", "Math") },
  { label: "{ now } = performance", re: destructure("now", "performance") },
  { label: "{ timeOrigin } = performance", re: destructure("timeOrigin", "performance") },
  { label: "{ hrtime } = process", re: destructure("hrtime", "process") },
  { label: "{ uptime } = process", re: destructure("uptime", "process") },
  { label: "{ random } = crypto", re: destructure(RANDOM_ALT, "crypto") },
];

// Generators imported by NAME from a package, matched by the (possibly renamed)
// binding. A package's deterministic exports (uuid v3/v5) are not listed.
const GENERATOR_PACKAGES = {
  uuid: ["v1", "v4", "v6", "v7"],
  nanoid: ["nanoid"],
  ulid: ["ulid", "monotonicFactory"],
  "@paralleldrive/cuid2": ["createId"],
};

// A binding is an identifier, and `$` is legal in one but is a regex end anchor. Escape
// every regex metacharacter, not just `$`, so nothing a binding holds can change the pattern.
const escId = (s) => s.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");

// `{ a, b: c }` of a destructuring: the property name and the local it binds.
const parseDestructured = (list) =>
  list.split(",").map((x) => x.trim()).filter(Boolean).map((x) => {
    const m = /^([\w$]+)\s*:\s*([\w$]+)$/.exec(x);
    return m ? { name: m[1], local: m[2] } : { name: x.replace(/\s*=.*$/, ""), local: x.replace(/\s*=.*$/, "") };
  });

const parseNamed = (list) =>
  list.split(",").map((s) => s.trim().replace(/^type\s+/, "")).filter(Boolean).map((s) => {
    const m = /^([\w$]+)\s+as\s+([\w$]+)$/.exec(s);
    return m ? { name: m[1], local: m[2] } : { name: s, local: s };
  });

// Per-file patterns built from the file's own imports (read from `visible`, where
// the module name is still text): renamed crypto functions, a crypto namespace,
// and uuid/nanoid-style generators.
function importPatterns(visible) {
  const line = [];
  const text = [];
  const fnLocals = new Set();
  const nsLocals = new Set();
  const ID = String.raw`[A-Za-z_$][\w$]*`;
  // A binding list never holds a quote or backtick, so a string that merely
  // contains an unclosed `import {` cannot swallow a real import after it.
  const LIST = String.raw`[^}'"\x60]*`;
  const cryptoMod = String.raw`(?:node:)?crypto`;
  const named = (mod) => new RegExp(String.raw`\bimport\s*(?:type\s+)?(?:${ID}\s*,\s*)?\{(${LIST})\}\s*from\s*(["'])(${mod})\2`, "g");
  const note = ({ name, local }) => {
    if (RANDOM_FNS.includes(name)) fnLocals.add(local);
    // `webcrypto` is the Web Crypto namespace, and `default` is the whole module:
    // both are receivers of getRandomValues/randomUUID/randomBytes.
    if (name === "webcrypto" || name === "default") nsLocals.add(local);
  };
  for (const m of visible.matchAll(named(cryptoMod))) for (const b of parseNamed(m[1])) note(b);
  // `import * as nc from "crypto"`
  for (const m of visible.matchAll(new RegExp(String.raw`\bimport\s+\*\s+as\s+(${ID})\s+from\s*(["'])${cryptoMod}\2`, "g"))) nsLocals.add(m[1]);
  // `import nc from "crypto"`, `import nc, * as ns from "crypto"`, `import nc, { a } from "crypto"`
  for (const m of visible.matchAll(new RegExp(String.raw`\bimport\s+(${ID})\s*(?:,\s*(?:\{${LIST}\}|\*\s+as\s+(${ID})))?\s*from\s*(["'])${cryptoMod}\3`, "g"))) {
    nsLocals.add(m[1]);
    if (m[2]) nsLocals.add(m[2]);
  }
  // TypeScript `import nc = require("crypto")`
  for (const m of visible.matchAll(new RegExp(String.raw`\bimport\s+(?:type\s+)?(${ID})\s*=\s*require\(\s*(["'])${cryptoMod}\2\s*\)`, "g"))) nsLocals.add(m[1]);
  // `const nc = require("crypto")`
  for (const m of visible.matchAll(new RegExp(String.raw`\b(?:const|let|var)\s+(${ID})\s*=\s*require\(\s*(["'])${cryptoMod}\2\s*\)`, "g"))) nsLocals.add(m[1]);
  // `const { randomBytes: rb, webcrypto } = require("crypto")`
  for (const m of visible.matchAll(new RegExp(String.raw`\b(?:const|let|var)\s*\{(${LIST})\}\s*=\s*require\(\s*(["'])${cryptoMod}\2\s*\)`, "g"))) {
    for (const b of parseDestructured(m[1])) note(b);
  }
  if (fnLocals.size) line.push(new RegExp(String.raw`(?<![\w$.])(?:${[...fnLocals].map(escId).join("|")})\s*\(`));
  if (nsLocals.size) {
    const ns = [...nsLocals].map(escId).join("|");
    line.push(new RegExp(String.raw`(?<![\w$.])(?:${ns})${DOT}(?:(?:default|webcrypto)${DOT})*(?:${RANDOM_ALT})${CALL}`));
    // `const { getRandomValues: grv } = wc`: the destructure itself is the read.
    text.push(new RegExp(String.raw`\{[^{}]*\b(?:${RANDOM_ALT})\b[^{}]*\}\s*=\s*(?:${ns})\b`, "g"));
  }
  const gen = new Set();
  for (const m of visible.matchAll(named(String.raw`[^"'\s]+`))) {
    const names = GENERATOR_PACKAGES[m[3]];
    if (!names) continue;
    for (const { name, local } of parseNamed(m[1])) if (names.includes(name)) gen.add(local);
  }
  if (gen.size) line.push(new RegExp(String.raw`(?<![\w$.])(?:${[...gen].map(escId).join("|")})\s*\(`));
  return { line, text };
}

// Scan one source file. Returns { lines, problems }: 1-based lines (ascending,
// unique) holding a read, and the places the masker lost the thread. `problems`
// non-empty means the file was NOT reliably scanned and the caller must say so.
export function scanSource(src) {
  const m = maskSource(normalizeBracketAccess(src), true);
  const lines = new Set();
  const dyn = importPatterns(m.visible);
  m.text.split("\n").forEach((ln, idx) => {
    if (LINE_SPELLINGS.some(({ re }) => re.test(ln)) || dyn.line.some((re) => re.test(ln))) lines.add(idx + 1);
  });
  for (const re of [...DESTRUCTURES.map((d) => d.re), ...dyn.text]) {
    for (const hit of m.text.matchAll(new RegExp(re.source, "g"))) {
      lines.add(m.text.slice(0, hit.index).split("\n").length);
    }
  }
  return { lines: [...lines].sort((x, y) => x - y), problems: m.problems };
}

// The legacy raw-line scan safety-check keeps beside the masker, so a file the masker
// misreads still reports the original spellings (with optional chaining). A line is
// split at every ECMAScript line terminator first, so a `//` comment ending at U+2028
// cannot hide the code after it. Returns 1-based `\n` line numbers.
const LEGACY_RAW = /\b(?:Date\s*\??\.\s*now|Math\s*\??\.\s*random)\s*(?:\?\.\s*)?\(/;
export function legacyRawLines(src) {
  const hits = [];
  src.split("\n").forEach((ln, i) => {
    for (const part of ln.split(/[\r\u2028\u2029]/)) {
      const t = part.trim();
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue;
      if (LEGACY_RAW.test(part)) { hits.push(i + 1); break; }
    }
  });
  return hits;
}

// ── self-test material ────────────────────────────────────────────────────────
// One plant per LABEL in the tables above (checked both ways), plus the dynamic
// import forms, prose that must not count, masker blind spots that once hid code,
// and desync sources the masker must report.
export const CLOCK_PLANTS = [
  ["Date.now()", "const t = Date.now();"],
  ["Math.random()", "const r = Math.random();"],
  ["argless Date()", "const t = new Date();"],
  ["crypto random call", "const id = crypto.randomUUID();"],
  ["imported random call", 'import { randomBytes } from "node:crypto";\nconst b = randomBytes(4);'],
  ["performance.now()", "const t = performance.now();"],
  ["performance.timeOrigin", "const t = performance.timeOrigin;"],
  ["process.uptime()", "const t = process.uptime();"],
  ["process.hrtime", "const t = process.hrtime.bigint();"],
  ["hrtime.bigint()", "const t = hrtime.bigint();"],
  ["{ now } = Date", "const { now } = Date; const t = now();"],
  ["{ random } = Math", "const { random } = Math;"],
  ["{ now } = performance", "const { now } = performance;"],
  ["{ timeOrigin } = performance", "const { timeOrigin } = performance;"],
  ["{ hrtime } = process", "const { hrtime } = process;"],
  ["{ uptime } = process", "const { uptime } = process;"],
  ["{ random } = crypto", "const { randomUUID } = crypto;"],
];
// Spellings found only through the file's own imports or a bracket/global form.
export const CLOCK_FORM_PLANTS = [
  ['Date["now"]()', 'const t = Date["now"]();'],
  ['Math["random"]()', 'const r = Math["random"]();'],
  ["globalThis.Date()", "const t = new globalThis.Date();"],
  ["globalThis.Date.now()", "const t = globalThis.Date.now();"],
  ["crypto.getRandomValues(...)", "const b = crypto.getRandomValues(new Uint8Array(4));"],
  ["crypto.webcrypto.getRandomValues(...)", "const b = crypto.webcrypto.getRandomValues(new Uint8Array(4));"],
  ["imported webcrypto receiver", 'import { webcrypto } from "node:crypto";\nconst b = webcrypto.getRandomValues(new Uint8Array(4));'],
  ["renamed webcrypto receiver", 'import { webcrypto as wc } from "node:crypto";\nconst b = wc.randomUUID();'],
  ["$-prefixed renamed crypto import", 'import { randomBytes as $bytes } from "node:crypto";\nconst b = $bytes(4);'],
  ["$ in a crypto namespace alias", 'import * as $c from "node:crypto";\nconst b = $c.randomBytes(4);'],
  ["$-prefixed uuid generator alias", 'import { v4 as $uuid } from "uuid";\nconst id = $uuid();'],
  ["$ inside a renamed crypto alias", 'import { randomBytes as rand$b } from "node:crypto";\nconst b = rand$b(4);'],
  ["webcrypto through a namespace import", 'import * as nc from "node:crypto";\nconst b = nc.webcrypto.getRandomValues(new Uint8Array(4));'],
  ["mixed default and named crypto import", 'import nodeCrypto, { randomBytes as rb } from "node:crypto";\nconst b = rb(4);'],
  ["default plus namespace crypto import", 'import d, * as nc from "node:crypto";\nconst b = nc.randomBytes(4);'],
  ["default plus namespace: the default binding", 'import d, * as nc from "node:crypto";\nconst b = d.randomUUID();'],
  ["{ default as c } crypto import", 'import { default as c } from "node:crypto";\nconst b = c.randomUUID();'],
  ["an import after a double-quoted string holding an unclosed `import {`", 'const doc = "import {";\nimport { randomBytes as rb9 } from "node:crypto";\nconst b = rb9(4);'],
  ["an import after a template holding an unclosed `import {`", 'const doc = `import {`;\nimport { randomBytes as rb9 } from "node:crypto";\nconst b = rb9(4);'],
  ["an import after a string holding an unclosed `import {`", "const doc = 'import {';\nimport { randomBytes as rb9 } from \"node:crypto\";\nconst b = rb9(4);"],
  ["Date?.now()", "const t = Date?.now();"],
  ["Math?.random()", "const r = Math?.random();"],
  ["Date.now?.()", "const t = Date.now?.();"],
  ['Date?.["now"]()', 'const t = Date?.["now"]();'],
  ["crypto?.randomUUID()", "const id = crypto?.randomUUID();"],
  ["performance?.now()", "const t = performance?.now();"],
  ["process?.hrtime", "const t = process?.hrtime();"],
  ["TypeScript import = require", 'import nc = require("crypto");\nconst b = nc.randomBytes(4);'],
  ["destructured require with a rename", 'const { randomBytes: rb } = require("crypto");\nconst b = rb(4);'],
  ["destructured require of webcrypto", 'const { webcrypto } = require("crypto");\nconst b = webcrypto.getRandomValues(new Uint8Array(4));'],
  ["namespace .default receiver", 'import * as nc from "node:crypto";\nconst b = nc.default.randomBytes(4);'],
  ["destructure with a rename from an imported webcrypto", 'import { webcrypto as wc } from "node:crypto";\nconst { getRandomValues: grv } = wc;'],
  ["renamed crypto import", 'import { randomBytes as bytes } from "node:crypto";\nconst b = bytes(4);'],
  ["crypto namespace import", 'import * as nc from "node:crypto";\nconst b = nc.randomBytes(4);'],
  ["crypto default import", 'import nodeCrypto from "crypto";\nconst b = nodeCrypto.randomUUID();'],
  ["crypto require namespace", 'const nc = require("crypto");\nconst b = nc.randomUUID();'],
  ["renamed uuid generator", 'import { v4 as uuidv4 } from "uuid";\nconst id = uuidv4();'],
  ["nanoid generator", 'import { nanoid } from "nanoid";\nconst id = nanoid();'],
];
// Each of these CONTAINS a read that a wrong regex-versus-division guess or a
// wrong template/quote state once hid. The read must still be seen.
export const CLOCK_BLIND_SPOT_PLANTS = [
  ["a read after a regex literal holding a quote, after `=`", 'const re = /"/g;\nconst t = Date.now();'],
  ["a read after a regex literal holding a quote, after `)` of an if", 'if (a) /"/.test(s);\nconst t = Date.now();'],
  ["a read after a regex literal holding a quote, after `}`", 'if (a) { b(); }\n/"/.test(s);\nconst t = Date.now();'],
  ["a read after a regex literal holding a quote, after `else`", 'if (a) b(); else /"/.test(s);\nconst t = Date.now();'],
  ["a read on the same line as i++ / 2", "i++ / 2 + Date.now() / 1000;"],
  ["a read on the next line after i++ / 2; \"x/y\"", 'i++ / 2; const u = "x/y";\nconst t = Date.now();'],
  ["a read between two divisions", "const h = a / 2;\nconst t = Date.now();\nconst k = b / 3;"],
  ["a read after a property named like a keyword (`.return`) divided", 'const q = counts.return / a; const w = "x/y";\nconst t = Date.now();'],
  ["a read after an identifier named `of` divided", 'const of = 4; const z = of / 2; const w = "x/y";\nconst t = Date.now();'],
  ["a read after an identifier named `in` divided", 'const inn = { in: 4 }; const z = inn.in / 2; const w = "x/y";\nconst t = Date.now();'],
  ["a read after a postfix non-null `!` division", "const t = m.get(k)! / Date.now() / 2;"],
  ["a read after a prefix `!` regex holding a quote", 'const ok = !/"/.test(s);\nconst t = Date.now();'],
  ["a read after a division that follows `]`", "const t = counts[k] / sum + Date.now() / 1000;"],
  ["a read after a regex holding a slash in a character class", "const ok = /[/]+/.test(s) ? Date.now() / 2 : 0;"],
  ["a read after a regex following `of` whose body ends in an operator", "for (const x of /a+/.exec(s) ?? []) { const t = Date.now() / 2; }"],
  ["a read after a regex following `of` holding `=`", "for (const x of /x=/.exec(s) ?? []) { const t = performance.now() / 2; }"],
  ["a read after a regex following `in`", 'const ok = "k" in /a+/ ? Date.now() / 2 : 0;'],
  ["a read after a regex following a spread", "const arr = [.../a+/.exec(s)]; const t = Date.now() / 2;"],
  ["a read after `typeof of` divided", 'const of = 4; const z = typeof of / 2; const w = "x/y";\nconst t = Date.now();'],
  ["a read after `1./2` divided", 'const z = 1./2; const w = "x/y";\nconst t = Date.now();'],
  ["a read after the identifier `of` following a control head `)`", "if (a) of / 2 + performance.now() / 3;"],
  ["a read after the identifier `of` following `in`", "const f = k in of / 2 + Date.now() / 3;"],
  ["a read after the identifier `of` following `instanceof`", "x instanceof of / 2 + Date.now() / 3;"],
  ["a read after the identifier `of` following `default`", "export default of / 2 + Date.now() / 3;"],
  ["a read after the identifier `of` following a block `}`", "if (a) { b(); } of / 2 + Date.now() / 3;"],
  ["a read after the identifier `of` on a line after a string (ASI)", 'const s = "a"\nof / 2 + Date.now() / 3;'],
  ["a read after a regex following `instanceof`", "const r = value instanceof /\\d+/.constructor ? Date.now() / 2 : 0;"],
  ["a read after a regex following `new`", "const o = new /x=/.constructor(); const t = Date.now() / 2;"],
  ["a read after a regex following `extends`", "class K extends /x=/.constructor { m() { return Date.now() / 2; } }"],
  ["a read after a regex following `export default`", 'export default /"/.test(s);\nconst t = Date.now();'],
  ["a read after a for-of regex, destructuring an array", "for (const [p] of /a+/.exec(s) ?? []) { const t = Date.now() / 2; }"],
  ["a read after a for-of regex, with a parenthesised binding", "for ((x) of /a+/.exec(s) ?? []) { const t = Date.now() / 2; }"],
  ["a read after a for-of regex, destructuring an object", "for (const { p } of /a+/.exec(s) ?? []) { const t = Date.now() / 2; }"],
  ["a read after a for-await-of regex", "for await (const x of /a+/.exec(s) ?? []) { const t = Date.now() / 2; }"],
  ["a read after a for-of regex separated by a no-break space", "for (const x of\u00a0/a+/.exec(s) ?? []) { const t = Date.now() / 2; }"],
  ["a read after a for-of regex separated by a form feed", "for (const x of\f/a+/.exec(s) ?? []) { const t = Date.now() / 2; }"],
  ["a read after a regex following `in` with a single-quoted key", "const ok = 'k' in /a+/ ? Date.now() / 2 : 0;"],
  ["a read after a regex following `in` with a template key", "const ok = `k` in /a+/ ? Date.now() / 2 : 0;"],
  ["a read after a division that follows a closing quote", 'const z = "a" / 2; const w = "x/y";\nconst t = Date.now();'],
  ["a read after a division that follows a closing backtick", 'const z = `a` / 2; const w = "x/y";\nconst t = Date.now();'],
  ["a read after a `//` comment that ends at U+2028", "// c\u2028const t = Date.now();"],
  ["a read after a `//` comment that ends at U+2029", "// c\u2029const t = Date.now();"],
  ["a read after a `//` comment that ends at a lone CR", "// c\rconst t = Date.now();"],
  ["a read inside a template expression", "const s = `${Date.now()}`;"],
  ["a read after a URL string on the same line", 'const u = "http://x"; const t = Date.now();'],
  ["a read after a division that follows `}` and sits on a later-slash file", "const a = {}\n  / 2;\nconst t = Date.now();\nconst b = 6 / 3;"],
];
export const CLOCK_NON_PLANTS = [
  ["a comment naming Date.now()", "// never call Date.now() or new Date() here\nconst x = 1;"],
  ["a block comment naming Math.random()", "/* Math.random() and crypto.randomUUID() are banned */\nconst x = 1;"],
  ["a string literal containing Date.now()", 'const why = "Date.now() reads the clock";'],
  ["a string literal containing new Date()", "const why = 'new Date() reads the clock';"],
  ["a template literal containing performance.now()", "const why = `performance.now() is a clock`;"],
  ["new Date(x) from an argument", "const d = new Date(input.timestamp);"],
  ["a regex literal naming Date.now()", "const re = /Date.now()/;"],
  ["a division of two names that match a spelling by prefix", "const r = Mathematics / randomness;"],
];
// Sources the masker must REPORT as unreadable, and one it must not.
export const CLOCK_DESYNC_PLANTS = [

  ["a quoted string crossing a newline", 'const s = "abc\nconst t = 1;'],
  ["a template literal open at end of file", "const s = `abc\nconst t = 1;"],
  ["a block comment open at end of file", "const t = 1;\n/* never closed\nconst u = 2;"],
  ["a template expression open at end of file", "const s = `a${b\n"],
];
// A file the masker loses the thread on must be REPORTED and also RECOVERED: the
// read after the desync is still seen, so one bad string does not blank the file.
export const CLOCK_RECOVERY_PLANTS = [
  ["a quoted string crossing a newline", 'const s = "abc\nconst t = Date.now();'],
  ["a quoted string crossing a lone CR", 'const s = "abc\rconst t = Date.now();'],
];
// A default-less switch and a localeCompare, each placed behind (or inside) a
// confuser that used to blind the masker, for the two non-clock gates that share it.
export const CONFUSER_WRAPS = [
  ["i++ / 2 then a slash in a string", (code) => `i++ / 2; const s = 'a/b';\n${code}`],
  ["a regex holding a quote after an if", (code) => `if (a) /"/.test(s);\n${code}`],
  ["a regex holding a backtick after else", (code) => `if (a) b(); else /\`/.test(s);\n${code}`],
  ["the identifier `of` after a control head wrapped around it", (code) => `if (a) of / 2 + ${code} / 3;`],
  ["a regex after `instanceof` wrapped around it", (code) => `const q = v instanceof /x=/.constructor ? ${code} / 3 : 0;`],
  ["a regex after `of` ending in `=` wrapped around it", (code) => `for (const x of /x=/.exec(s) ?? []) { const q = 1 + ${code} / 3; }`],
  ["a `]` division wrapped around it", (code) => `const q = counts[k] / 2 + ${code} / 3;`],
  ["a postfix non-null `!` division wrapped around it", (code) => `const q = m.get(k)! / 2 + ${code} / 3;`],
];

// Run every plant through `scan(src) -> { lines, problems }`. Returns
// [[name, ok], …] in the shape both gates' self-tests push into.
export function clockSelfTestChecks(scan = scanSource) {
  const flagged = (src) => scan(src).lines.length >= 1;
  const checks = [];
  // Table <-> plant: every table entry has a plant, every plant has an entry, and
  // the ENTRY (not some other pattern) matches it. Removing or adding a pattern
  // without its plant turns this red.
  const entries = [...LINE_SPELLINGS, ...DESTRUCTURES];
  const labels = new Set(entries.map((e) => e.label));
  const plantLabels = new Set(CLOCK_PLANTS.map(([l]) => l));
  for (const e of entries) checks.push([`every pattern has a plant: ${e.label}`, plantLabels.has(e.label)]);
  for (const [label, src] of CLOCK_PLANTS) {
    const e = entries.find((x) => x.label === label);
    const masked = maskSource(normalizeBracketAccess(src), true).text;
    const entryHits = e
      ? e.re.global
        ? new RegExp(e.re.source, "g").test(masked)
        : masked.split("\n").some((l) => new RegExp(e.re.source).test(l))
      : false;
    checks.push([`the pattern itself matches its plant: ${label}`, entryHits]);
    checks.push([`a clock/randomness read is flagged: ${label}`, flagged(src)]);
  }
  for (const [name, src] of CLOCK_FORM_PLANTS) checks.push([`a read is flagged in the form: ${name}`, flagged(src)]);
  for (const [name, src] of CLOCK_BLIND_SPOT_PLANTS) checks.push([`masking does not hide a read: ${name}`, flagged(src) && scan(src).problems.length === 0]);
  for (const [name, src] of CLOCK_NON_PLANTS) checks.push([`prose is not flagged: ${name}`, scan(src).lines.length === 0]);
  for (const [name, src] of CLOCK_RECOVERY_PLANTS) {
    const r = scan(src);
    checks.push([`an unreadable file is reported AND recovered (the later read is still seen): ${name}`, r.problems.length >= 1 && r.lines.length >= 1]);
  }
  for (const [name, src] of CLOCK_DESYNC_PLANTS) checks.push([`an unreadable file is reported, not blanked: ${name}`, scan(src).problems.length >= 1]);
  // The legacy raw-line backstop safety-check keeps beside the masker.
  const legacy = (src) => legacyRawLines(src).length >= 1;
  checks.push(["the backstop sees Date.now()", legacy("const t = Date.now();")]);
  checks.push(["the backstop sees Math?.random()", legacy("const r = Math?.random();")]);
  checks.push(["the backstop sees Date.now?.()", legacy("const t = Date.now?.();")]);
  checks.push(["the backstop sees a read after a // comment ending at U+2028", legacy("// c\u2028const t = Date.now();")]);
  checks.push(["the backstop sees a read after a // comment ending at U+2029", legacy("// c\u2029const t = Date.now();")]);
  checks.push(["the backstop sees a read after a // comment ending at a lone CR", legacy("// c\rconst t = Date.now();")]);
  checks.push(["the backstop ignores a comment naming Date.now()", !legacy("// Date.now() is banned\n * Math.random() too")]);
  checks.push(["a clean file reports no masker problem", scan("const a = 1 / 2;\nconst s = `x${a}`;\n").problems.length === 0]);
  return checks;
}
