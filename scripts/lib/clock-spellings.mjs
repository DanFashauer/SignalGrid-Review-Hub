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
//   · `break label` / `continue label` followed by a newline and a regex: `label` is
//     an identifier, so that slash is read as division. (`break`, `continue` and
//     `debugger` alone before a newline-started regex ARE handled.)
//   · TypeScript receivers are unwrapped textually, to any nesting depth: `!+`, a cast or
//     satisfies in parens (`(Date as any).now()`, `(Date as any)()`, `new (Date as any)()`),
//     an angle cast (`(<any>Date)`, `(<Array<number>>Date)`), plain parens (`(Date).now()`,
//     `new(Date)()`) and `(0, Date.now)()`. A cast whose TYPE contains parentheses, such
//     as `(Date as (typeof D)).now()`, is not unwrapped.
//   · A line-initial `/` right after an operand is AMBIGUOUS (ASI makes it a regex, a
//     continued division makes it division) and is reported as a problem, fatal and named.
//     Write the operator at the end of the previous line or put a `;` before the regex.
//   · FALSE ALARMS from the textual rewrite and per-line matching: `new` newline `Date(0)`,
//     `new globalThis . Date(0)` (spaces around the dot), and `foo (Date).now()`.
//   · A destructure default that contains a comma (`{ a = f(1, now), b }`) is split at it.
//   · FALSE-ALARM direction too: a function or method NAMED Date (`function Date()`,
//     an interface member `Date()`) is read as a `Date()` call.
//   · An uncalled reference (`const c = Date.now`), Reflect.apply / .call,
//     Temporal / Intl, and unicode escapes in an identifier are not seen.
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
  "instanceof", "new", "extends", "default", "debugger", "break", "continue",
]);
// Declaration keywords introduce a binding, not an operand: `for (const of of /x=/...)`.
const DECL_KEYWORD = new Set(["const", "let", "var"]);
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
  // Is the word starting at `st` a member or private name (`a.default`, `a. default`,
  // `this.#new`) rather than a keyword? A spread `...x` is not a member access.
  const isProp = (st) => {
    if (st > 0 && out[st - 1] === "#") return true;
    const b = prevSig(st);
    if (b < 0 || out[b] !== ".") return false;
    return !(b >= 2 && out[b - 1] === "." && out[b - 2] === ".");
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
      if (isProp(start)) return false;
      // `of` is the for-of OPERATOR only inside a `for (` head, after a finished operand.
      const ofIsOperator = (st) =>
        top.parens.length > 0 && top.parens[top.parens.length - 1] === "for" && operandEndsBefore(st);
      // Does a finished operand end just before the word at `st`? (`in` and an operator
      // `of` introduce an expression, a declaration keyword introduces a binding, an
      // identifier `of` is an operand.)
      const operandEndsBefore = (st) => {
        const b = prevSig(st);
        if (b < 0) return false;
        const q = out[b];
        if (IS_WORD.test(q)) {
          const { word: w, start: s2 } = wordBefore(b);
          if (isProp(s2)) return true;
          if (w === "in") return false;
          if (w === "of") return !ofIsOperator(s2);
          if (DECL_KEYWORD.has(w)) return false;
          return !REGEX_AFTER_KEYWORD.has(w);
        }
        return q === ")" || q === "]" || q === "}" || q === "'" || q === '"' || q === "`";
      };
      if (word === "of") return ofIsOperator(start);
      // `k in /re/`: `in` is reserved, so after an operand it is always the operator.
      if (word === "in") return operandEndsBefore(start);
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
        let startsRegex = regexStartsHere(top);
        if (!startsRegex) {
          // A `/` that begins a line right after an operand is ambiguous: ASI ends the
          // statement (`let x` newline `/re/.test(s)`, `type T = string` newline `/re/`) or
          // the division continues onto the next line. Guessing division hides the code
          // between two slashes, guessing regex hides it the other way, so report it
          // (fatal, fail closed) and read it as a regex when that reading closes.
          const k0 = prevSig(i);
          let crossed = false;
          for (let q = k0 + 1; k0 >= 0 && q < i; q++) if (EOL.test(out[q])) { crossed = true; break; }
          if (crossed) {
            problems.push({ line: lineOf(i), what: "a line-initial slash follows an operand, so it is a regex (ASI) or a continued division and cannot be told apart" });
            startsRegex = true;
          }
        }
        if (startsRegex) {
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
          if (isProp(start)) kw = null;
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

// Rewrites that swallow whitespace must not move later lines up, nor split the rewritten
// expression across lines. The swallowed newlines are owed and paid back right after the
// next newline in the text that follows, so `Date[` newline `"now"` newline `]()` becomes
// `Date.now()` on its own line and the line count is unchanged.
function rewrite(text, re, fn, boundary = true) {
  let out = "";
  let last = 0;
  let owed = 0;
  const pay = (seg) => {
    if (owed > 0) {
      const at = seg.indexOf("\n");
      if (at >= 0) { seg = seg.slice(0, at + 1) + "\n".repeat(owed) + seg.slice(at + 1); owed = 0; }
    }
    return seg;
  };
  for (const m of text.matchAll(re)) {
    out += pay(text.slice(last, m.index));
    let r = fn(m);
    // Keep a word boundary: `return(Date)` must not become `returnDate`.
    const before = m.index > 0 ? text[m.index - 1] : "";
    if (boundary && before && /[\w$]/.test(before) && /^[\w$]/.test(r)) r = " " + r;
    out += r;
    owed += (m[0].match(/\n/g) || []).length;
    last = m.index + m[0].length;
  }
  out += pay(text.slice(last));
  return owed > 0 ? out + "\n".repeat(owed) : out;
}

// `X["name"]`, `X['name']` and `X?.["name"]` are the same access as `X.name`.
const normalizeBracketAccess = (src) =>
  rewrite(
    rewrite(src, /\?\.\s*\[\s*(["'])([A-Za-z_$][\w$]*)\1\s*\]/g, (m) => `?.${m[2]}`),
    /\[\s*(["'])([A-Za-z_$][\w$]*)\1\s*\]/g,
    (m) => `.${m[2]}`,
  );

// TypeScript wrappers around a receiver do not change what runs. Followed, to any nesting
// depth (each pass peels one layer; a lookahead may be another `)`): a postfix non-null
// run `!+` (`Date!.now()`, `Date!!.now()`, `Date.now!()`, `new Date!()`), a cast or
// satisfies in parens (`(Date as any).now()`, `(Date as any)()`, `new (Date as any)()`,
// `(Date.now as any)()`), an angle cast (`(<any>Date).now()`, `(<Array<number>>Date)`),
// plain parens (`(Date).now()`, `(Date.now)()`, `new(Date)()`), and the indirect-call idiom
// `(0, Date.now)()` / `(void 0, Date.now)()`. Applied to the MASKED text, after comments
// and strings are blanked. NOT followed: a cast whose type contains parentheses.
const UNWRAP_LOOK = String.raw`(?=\s*(?:\?\.|\.|\(|\)))`;
const unwrapTs = (text) => {
  let t = text;
  for (let pass = 0; pass < 8; pass++) {
    const before = t;
    // This rule's match starts with the operand's own last character, so no boundary is added.
    t = rewrite(t, new RegExp(String.raw`([\w$)\]])\s*!+${UNWRAP_LOOK}`, "g"), (m) => m[1], false);
    t = rewrite(t, new RegExp(String.raw`\(\s*<[^()]*>\s*([\w$.]+)\s*\)${UNWRAP_LOOK}`, "g"), (m) => m[1]);
    t = rewrite(t, new RegExp(String.raw`\(\s*([\w$.]+)\s+(?:as|satisfies)\s+[^()]*\)${UNWRAP_LOOK}`, "g"), (m) => m[1]);
    t = rewrite(t, new RegExp(String.raw`\(\s*([A-Za-z_$][\w$.]*)\s*\)${UNWRAP_LOOK}`, "g"), (m) => m[1]);
    t = rewrite(t, /\(\s*(?:void\s+0|\d+)\s*,\s*([A-Za-z_$][\w$.]*)\s*\)(?=\s*(?:\(|\?\.\())/g, (m) => m[1]);
    if (t === before) break;
  }
  return t;
};

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
  // A bare `Date(...)` call (no `new`) returns the current time whatever it is given.
  { label: "Date() read", re: new RegExp(String.raw`(?<![\w$.])${G}Date${CALL}\s*\)|(?<![\w$.])(?<!\bnew\s+)${G}Date${CALL}`) },
  { label: "crypto random call", re: new RegExp(String.raw`\bcrypto${DOT}(?:webcrypto${DOT})?(?:${RANDOM_ALT})${CALL}`) },
  // Imported without a rename, the bare name is the call.
  { label: "imported random call", re: new RegExp(String.raw`(?<![\w$.])(?:${RANDOM_ALT})${CALL}`) },
  { label: "performance.now()", re: new RegExp(String.raw`\bperformance${DOT}now${CALL}`) },
  { label: "performance.timeOrigin", re: new RegExp(String.raw`\bperformance${DOT}timeOrigin\b`) },
  { label: "process.uptime()", re: new RegExp(String.raw`\bprocess${DOT}uptime${CALL}`) },
  { label: "process.hrtime", re: new RegExp(String.raw`\bprocess${DOT}hrtime\b`) },
  { label: "hrtime.bigint()", re: new RegExp(String.raw`\bhrtime${DOT}bigint${CALL}`) },
];

// `const { now } = Date` and kin, possibly across lines, so these run over the
// whole text and map the match back to its line.
// `const { now } = Date` and kin, possibly across lines. A name counts only on the PROPERTY
// side of an element (`{ now: n }` and `{ UTC, now }` are reads, `{ parse: now }` and
// `{ parse = now }` are not), and the source may be wrapped (`= (Date)`, `= <any>Date`).
export const DESTRUCTURES = [
  { label: "{ now } = Date", names: ["now"], from: "Date" },
  { label: "{ random } = Math", names: ["random"], from: "Math" },
  { label: "{ now } = performance", names: ["now"], from: "performance" },
  { label: "{ timeOrigin } = performance", names: ["timeOrigin"], from: "performance" },
  { label: "{ hrtime } = process", names: ["hrtime"], from: "process" },
  { label: "{ uptime } = process", names: ["uptime"], from: "process" },
  { label: "{ random } = crypto", names: RANDOM_FNS, from: "crypto" },
];
// 1-based lines holding a destructure of one of `names` from `from` in masked `text`.
function destructureLines(text, entries) {
  const lines = new Set();
  for (const { names, from } of entries) {
    const re = new RegExp(
      String.raw`\{([^{}]*)\}\s*=\s*(?:[\s(]|<[^()<>]*(?:<[^<>]*>[^()<>]*)?>)*${G}(?:${from})\b`,
      "g",
    );
    for (const hit of text.matchAll(re)) {
      const props = hit[1].split(",").map((el) => el.replace(/\s*=[\s\S]*$/, "").split(":")[0].trim());
      if (props.some((pr) => names.includes(pr))) lines.add(text.slice(0, hit.index).split("\n").length);
    }
  }
  return [...lines];
}

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
    const y = x.replace(/\s*=[\s\S]*$/, "");
    const m = /^([\w$]+)\s*:\s*([\w$]+)$/.exec(y);
    return m ? { name: m[1], local: m[2] } : { name: y, local: y };
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
  if (fnLocals.size) line.push(new RegExp(String.raw`(?<![\w$.])(?:${[...fnLocals].map(escId).join("|")})${CALL}`));
  if (nsLocals.size) {
    const ns = [...nsLocals].map(escId).join("|");
    line.push(new RegExp(String.raw`(?<![\w$.])(?:${ns})${DOT}(?:(?:default|webcrypto)${DOT})*(?:${RANDOM_ALT})${CALL}`));
    // `const { getRandomValues: grv } = wc`: the destructure itself is the read.
    text.push({ names: RANDOM_FNS, from: ns });
  }
  const gen = new Set();
  for (const m of visible.matchAll(named(String.raw`[^"'\s]+`))) {
    const names = GENERATOR_PACKAGES[m[3]];
    if (!names) continue;
    for (const { name, local } of parseNamed(m[1])) if (names.includes(name)) gen.add(local);
  }
  if (gen.size) line.push(new RegExp(String.raw`(?<![\w$.])(?:${[...gen].map(escId).join("|")})${CALL}`));
  return { line, text };
}

// Scan one source file. Returns { lines, problems }: 1-based lines (ascending,
// unique) holding a read, and the places the masker lost the thread. `problems`
// non-empty means the file was NOT reliably scanned and the caller must say so.
export function scanSource(src) {
  const m = maskSource(normalizeBracketAccess(src), true);
  const lines = new Set();
  const dyn = importPatterns(m.visible);
  const text = unwrapTs(m.text);
  text.split("\n").forEach((ln, idx) => {
    if (LINE_SPELLINGS.some(({ re }) => re.test(ln)) || dyn.line.some((re) => re.test(ln))) lines.add(idx + 1);
  });
  for (const ln of destructureLines(text, [...DESTRUCTURES, ...dyn.text])) lines.add(ln);
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
  ["Date() read", "const t = new Date();"],
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
  ["nested parens ((Date)).now()", "const t = ((Date)).now();"],
  ["triple parens (((Date))).now()", "const t = (((Date))).now();"],
  ["a doubled non-null Date!!.now()", "const t = Date!!.now();"],
  ["an angle cast around parens (<any>(Date)).now()", "const t = (<any>(Date)).now();"],
  ["a doubled cast ((Date as any)).now()", "const t = ((Date as any)).now();"],
  ["a generic angle cast (<Array<number>>Date).now()", "const t = (<Array<number>>Date).now();"],
  ["a keyword glued to parens: return(Date).now()", "function f() { return(Date).now(); }"],
  ["a keyword glued to parens: await(Date as any).now()", "async function f() { return await(Date as any).now(); }"],
  ["a keyword glued to parens: new(Date)()", "const t = new(Date)();"],
  ["cast then call: (Date as any)()", "const t = (Date as any)();"],
  ["cast then call: new (Date as any)()", "const t = new (Date as any)();"],
  ["cast then call: new (<any>Date)()", "const t = new (<any>Date)();"],
  ["cast then call: (Date.now as any)()", "const t = (Date.now as any)();"],
  ["cast then call: (rb as any)(4)", 'import { randomBytes as rb } from "node:crypto";\nconst b = (rb as any)(4);'],
  ["a non-null inside parens: (Date.now!)()", "const t = (Date.now!)();"],
  ["the indirect-call idiom (void 0, Date.now)()", "const t = (void 0, Date.now)();"],
  ["the indirect-call idiom (0, Date.now)()", "const t = (0, Date.now)();"],
  ["a destructure from a parenthesised source", "const { now } = (Date);"],
  ["a destructure from a cast source", "const { now } = (Date as any);"],
  ["a destructure from an angle-cast source", "const { now } = <any>Date;"],
  ["a cast with ?. : (Date as any)?.now()", "const t = (Date as any)?.now();"],
  ["an angle cast with ?. : (<any>Date)?.now()", "const t = (<any>Date)?.now();"],
  ["plain parens with ?. : (Date)?.now()", "const t = (Date)?.now();"],
  ["a non-null in parens: (Date)!.now()", "const t = (Date)!.now();"],
  ["a non-null before ?. : Date!?.now()", "const t = Date!?.now();"],
  ["a lowercase parenthesised receiver (crypto).randomUUID()", "const id = (crypto).randomUUID();"],
  ["a lowercase parenthesised receiver (performance).now()", "const t = (performance).now();"],
  ["bracket access across lines: Date[ newline \"now\" newline ]()", 'const t = Date[\n"now"\n]();'],
  ["bracket access across lines: Math[ newline 'random' newline ]()", "const r = Math[\n'random'\n]();"],
  ["bracket access across lines: crypto[ newline ... ]()", 'const id = crypto[\n"randomUUID"\n]();'],
  ["optional bracket access across lines: Date?.[ ... ]()", 'const t = Date?.[\n"now"\n]();'],
  ["a cast spanning lines: (Date as newline any).now()", "const t = (Date as\n any).now();"],
  ["a renamed require destructure with a default", 'const { randomBytes: bytes = fallback } = require("crypto");\nconst b = bytes(4);'],
  ["a renamed webcrypto require destructure with a default", 'const { webcrypto: wc = fallback } = require("crypto");\nconst b = wc.getRandomValues(new Uint8Array(4));'],
  ["a destructure with a renamed local: { now: n } = Date", "const { now: n } = Date;"],
  ["a destructure among others: { UTC, now } = Date", "const { UTC, now } = Date;"],
  ["a destructure with a default on the property: { now = fallback } = Date", "const { now = fallback } = Date;"],
  ["Date?.()", "const t = Date?.();"],
  ["Date(0) without new", "const t = Date(0);"],
  ["Date(undefined) without new", "const t = Date(undefined);"],
  ["globalThis.Date(1) without new", "const t = globalThis.Date(1);"],
  ["a bare randomBytes called with ?.() and no import in the file", "const b = randomBytes?.(4);"],
  ["imported randomBytes called with ?.()", 'import { randomBytes } from "node:crypto";\nconst b = randomBytes?.(4);'],
  ["a renamed crypto import called with ?.()", 'import { randomBytes as rb } from "node:crypto";\nconst b = rb?.(4);'],
  ["a uuid generator called with ?.()", 'import { v4 as uuidv4 } from "uuid";\nconst id = uuidv4?.();'],
  ["nanoid called with ?.()", 'import { nanoid } from "nanoid";\nconst id = nanoid?.();'],
  ["a parenthesised receiver (Date).now()", "const t = (Date).now();"],
  ["a parenthesised receiver (Math).random()", "const r = (Math).random();"],
  ["a cast receiver (Date as any).now()", "const t = (Date as any).now();"],
  ["an angle-cast receiver (<any>Date).now()", "const t = (<any>Date).now();"],
  ["a cast receiver (Math as Math).random()", "const r = (Math as Math).random();"],
  ["a satisfies receiver", "const t = (Date satisfies DateConstructor).now();"],
  ["a parenthesised member (Date.now)()", "const t = (Date.now)();"],
  ["a non-null receiver Date!.now()", "const t = Date!.now();"],
  ["a non-null receiver Math!.random()", "const r = Math!.random();"],
  ["a non-null call Date.now!()", "const t = Date.now!();"],
  ["new Date!()", "const t = new Date!();"],
  ["a cast crypto receiver", "const id = (crypto as any).randomUUID();"],
  ["{ now } = globalThis.Date", "const { now } = globalThis.Date;"],
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
  ["a read after a regex following `in` after a member named return", "x.return in /a+/ ? Date.now() / 2 : 0;"],
  ["a read after a regex following `in` after a member named in", "x.in in /a+/ ? Date.now() / 2 : 0;"],
  ["a read after a regex following `in` after a member", "x.y in /a+/ ? Date.now() / 2 : 0;"],
  ["a read after an escaped quote in a string, before a regex with an escaped quote", String.raw`const a = "x\"y"; const t = Date.now(); const re = /\"/;`],
  ["a read after a regex with an escaped slash", String.raw`const re = /\/=/; const t = Date.now() / 2;`],
  ["a read after an escaped backtick in a template", "const s = `a\\`b`; const t = Date.now();"],
  ["a read after plain identifier division", "const v = total / 2 + Date.now() / 3;"],
  ["a read after a regex whose class closes before an operator", "const ok = /[a]=/.test(s) ? Date.now() / 2 : 0;"],
  ["a read after a regex following `new` after a spread", "const a = [...new /x=/.constructor()]; const t = Date.now() / 2;"],
  ["a read after a regex on the line after `debugger`", "debugger\n/x=/.test(s); const t = Date.now() / 2;"],
  ["a read after a regex on the line after `break`", "for (;;) { break\n/x=/.test(s); const t = Date.now() / 2; }"],
  ["a read after a regex on the line after `continue`", "for (;;) { continue\n/x=/.test(s); const t = Date.now() / 2; }"],
  ["a read after `in` followed by the identifier `of`", "for (const k in of / 2 + Date.now() / 3) {}"],
  ["a read after an operator `of` followed by the identifier `of`", "for (const x of of / 2 + Date.now() / 3) {}"],
  ["a read after a regex when the binding is named `of`", "for (const of of /x=/.exec(s) ?? []) { const t = Date.now() / 2; }"],
  ["a read after the identifier `of` in a for condition", "for (let i = 0; i < of / 2 + Date.now() / 3; i++) {}"],
  ["a read after a private name `#in`", "this.#in / 2 + Date.now() / 3;"],
  ["a read after a private name `#default`", "this.#default / 2 + Date.now() / 3;"],
  ["a read after a private name `#new`", "this.#new / 2 + Date.now() / 3;"],
  ["a read after a member written `a. default`", "a. default / 2 + Date.now() / 3;"],
  ["a read after a `while` head regex", 'while (a) /"/.test(s);\nconst t = Date.now();'],
  ["a read after a method named like a control keyword", "const v = x.if(a) / 2 + Date.now() / 3;"],
  ["a read after a regex that starts the file", '/"/.test(s);\nconst t = Date.now();'],
  ["a read after a division that follows `}` with CR line ends", "const a = {}\r  / 2;\rconst t = Date.now();\rconst b = 6 / 3;"],
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
  ["a destructure that renames another property to now", "const { parse: now } = Date;"],
  ["a destructure that renames another property to random", "const { floor: random } = Math;"],
  ["a destructure that renames subtle to randomUUID", "const { subtle: randomUUID } = crypto;"],
  ["a destructure whose default mentions now", "const { parse = now } = Date;"],
  ["a destructure of createHash renamed to randomBytes", 'import * as nc from "node:crypto";\nconst { createHash: randomBytes } = nc;'],
  ["new Date(0), a fixed instant", "const d = new Date(0);"],
  ["new globalThis.Date(1), a fixed instant", "const d = new globalThis.Date(1);"],
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
  ["a type alias then a line-initial regex (ASI)", "type Marker = string\n/x=/.test(s); const t = Date.now() / 2;"],
  ["a union type alias then a line-initial regex", 'type M = "a" | "b"\n/x=/.test(s); const t = Date.now() / 2;'],
  ["an array type alias then a line-initial regex", "type M = string[]\n/x=/.test(s); const t = Date.now() / 2;"],
  ["a declare const then a line-initial regex", "declare const x: number\n/x=/.test(s); const t = Date.now() / 2;"],
  ["a declare function then a line-initial regex", "declare function f(): string\n/x=/.test(s); const t = Date.now() / 2;"],
  ["a typed let then a line-initial regex", "let x: Foo\n/x=/.test(s); const t = Date.now() / 2;"],
  ["a plain let then a line-initial regex", "let x\n/x=/.test(s); const t = Date.now() / 2;"],
  ["an import-from then a line-initial regex", 'import { a } from "b"\n/x=/.test(s); const t = Date.now() / 2;'],
  ["an export-from then a line-initial regex", 'export { a } from "b"\n/x=/.test(s); const t = Date.now() / 2;'],
  ["a call then a line-initial regex", "foo()\n/x=/.test(s); const t = Date.now() / 2;"],
  ["a division continued on the next line", "const r = a\n  / b;\nconst t = Date.now();"],
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
      ? e.names
        ? destructureLines(masked, [e]).length > 0
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
  // Rewrites that swallow whitespace must not move a later read to an earlier line.
  const at = (src) => JSON.stringify(scan(src).lines);
  checks.push(["a bracket access spanning lines keeps the line of a later read", at('const v = x[\n"k"\n];\nconst t = Date.now();') === "[4]"]);
  checks.push(["a parenthesised receiver spanning lines keeps the line of a later read", at("const v = (\n  foo\n).bar;\nconst t = Date.now();") === "[4]"]);
  checks.push(["a non-null spanning lines keeps the line of a later read", at("const v = foo\n!\n.bar;\nconst t = Date.now();") === "[4]"]);
  checks.push(["a clean file reports no masker problem", scan("const a = 1 / 2;\nconst s = `x${a}`;\n").problems.length === 0]);
  return checks;
}
