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
//   · PINS COUNT LINES, not reads. Two reads on one line are one hit.
//   · Matching is per line, so `Date` newline `.now()` and `new Date(` newline `)`
//     are not seen.
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

// Keywords after which a `/` begins a regex. `in` and `of` are deliberately absent:
// as identifiers (`const of = 4; of / 2`) they are operands, and a regex after the
// `in`/`of` of a for-loop head is not a shape worth a false hide. A keyword
// preceded by `.` (`counts.in / a`) is a property name, never a keyword.
const REGEX_AFTER_KEYWORD = new Set([
  "return", "typeof", "case", "void", "delete", "throw", "yield", "await", "else", "do",
]);
const CONTROL_PAREN_KEYWORD = new Set(["if", "while", "for", "with"]);
const IS_WORD = /[\w$]/;

// Operators and punctuation after which a `/` begins a regex. `)` and `}` are
// handled separately; `]` and a closing quote/backtick are operands.
const REGEX_AFTER_PUNCT = /[(,=:[!&|?{;+\-*%<>~^]/;

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
  const blank = (k) => { if (out[k] !== "\n") out[k] = " "; };
  const blankBoth = (k) => { if (out[k] !== "\n") { out[k] = " "; vis[k] = " "; } };
  const stack = [{ mode: "code", depth: 0, parens: [], lastClose: null }];
  let i = 0;

  // The previous significant (non-space) index in `out`, which has comments and
  // literal text already blanked, so only real code and delimiters are seen.
  const prevSig = (from) => {
    let k = from - 1;
    while (k >= 0 && (out[k] === " " || out[k] === "\t" || out[k] === "\n" || out[k] === "\r")) k--;
    return k;
  };
  const wordBefore = (k) => {
    let s = k;
    while (s >= 0 && IS_WORD.test(out[s])) s--;
    return { word: out.slice(s + 1, k + 1).join(""), start: s + 1 };
  };

  const regexStartsHere = (top) => {
    const k = prevSig(i);
    if (k < 0) return true;
    const p = out[k];
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
      return REGEX_AFTER_KEYWORD.has(word);
    }
    return REGEX_AFTER_PUNCT.test(p);
  };

  while (i < n) {
    const top = stack[stack.length - 1];
    const c = src[i];
    if (top.mode === "code") {
      if (c === "\\") { i += 2; continue; }
      if (blankComments && c === "/" && src[i + 1] === "/") {
        let e = src.indexOf("\n", i);
        if (e === -1) e = n;
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
          while (j < n && src[j] !== "\n") {
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
        const k = prevSig(i);
        let control = false;
        if (k >= 0 && IS_WORD.test(out[k])) {
          const { word, start } = wordBefore(k);
          control = CONTROL_PAREN_KEYWORD.has(word) && !(start > 0 && out[start - 1] === ".");
        }
        top.parens.push(control);
        i++; continue;
      }
      if (c === ")") {
        const control = top.parens.length ? top.parens.pop() : false;
        top.lastClose = { pos: i, control };
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
      if (c === "\n") {
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
  src.replace(/\[\s*(["'])([A-Za-z_$][\w$]*)\1\s*\]/g, ".$2");

const G = String.raw`(?:globalThis\s*\.\s*)?`;
const RANDOM_FNS = ["randomUUID", "getRandomValues", "randomBytes", "randomInt", "randomFillSync", "randomFill", "pseudoRandomBytes"];
const RANDOM_ALT = RANDOM_FNS.join("|");

// Per-line spellings: WAYS TO READ THE WALL CLOCK OR A NON-DETERMINISTIC SOURCE.
// Every entry has a plant of the same label in CLOCK_PLANTS, and the self-test
// requires the entry itself (not just some other pattern) to match it.
export const LINE_SPELLINGS = [
  { label: "Date.now()", re: new RegExp(String.raw`\bDate\s*\.\s*now\s*\(`) },
  { label: "Math.random()", re: new RegExp(String.raw`\bMath\s*\.\s*random\s*\(`) },
  // `new Date()` and a bare `Date()` both read the clock; `new Date(x)` does not.
  { label: "argless Date()", re: new RegExp(String.raw`(?<![\w$.])${G}Date\s*\(\s*\)`) },
  { label: "crypto random call", re: new RegExp(String.raw`\bcrypto\s*\.\s*(?:${RANDOM_ALT})\s*\(`) },
  // Imported without a rename, the bare name is the call.
  { label: "imported random call", re: new RegExp(String.raw`(?<![\w$.])(?:${RANDOM_ALT})\s*\(`) },
  { label: "performance.now()", re: new RegExp(String.raw`\bperformance\s*\.\s*now\s*\(`) },
  { label: "performance.timeOrigin", re: new RegExp(String.raw`\bperformance\s*\.\s*timeOrigin\b`) },
  { label: "process.uptime()", re: new RegExp(String.raw`\bprocess\s*\.\s*uptime\s*\(`) },
  { label: "process.hrtime", re: new RegExp(String.raw`\bprocess\s*\.\s*hrtime\b`) },
  { label: "hrtime.bigint()", re: new RegExp(String.raw`\bhrtime\s*\.\s*bigint\s*\(`) },
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

const parseNamed = (list) =>
  list.split(",").map((s) => s.trim().replace(/^type\s+/, "")).filter(Boolean).map((s) => {
    const m = /^([\w$]+)\s+as\s+([\w$]+)$/.exec(s);
    return m ? { name: m[1], local: m[2] } : { name: s, local: s };
  });

// Per-file patterns built from the file's own imports (read from `visible`, where
// the module name is still text): renamed crypto functions, a crypto namespace,
// and uuid/nanoid-style generators.
function importPatterns(visible) {
  const res = [];
  const fnLocals = new Set();
  const nsLocals = new Set();
  for (const m of visible.matchAll(/\bimport\s*(?:type\s+)?\{([^}]*)\}\s*from\s*(["'])(?:node:)?crypto\2/g)) {
    for (const { name, local } of parseNamed(m[1])) if (RANDOM_FNS.includes(name)) fnLocals.add(local);
  }
  for (const m of visible.matchAll(/\bimport\s+(?:\*\s+as\s+)?([A-Za-z_$][\w$]*)\s+from\s*(["'])(?:node:)?crypto\2/g)) nsLocals.add(m[1]);
  for (const m of visible.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*(["'])(?:node:)?crypto\2\s*\)/g)) nsLocals.add(m[1]);
  if (fnLocals.size) res.push(new RegExp(String.raw`(?<![\w$.])(?:${[...fnLocals].join("|")})\s*\(`));
  if (nsLocals.size) res.push(new RegExp(String.raw`(?<![\w$.])(?:${[...nsLocals].join("|")})\s*\.\s*(?:${RANDOM_ALT})\s*\(`));
  const gen = new Set();
  for (const m of visible.matchAll(/\bimport\s*\{([^}]*)\}\s*from\s*(["'])([^"']+)\2/g)) {
    const names = GENERATOR_PACKAGES[m[3]];
    if (!names) continue;
    for (const { name, local } of parseNamed(m[1])) if (names.includes(name)) gen.add(local);
  }
  if (gen.size) res.push(new RegExp(String.raw`(?<![\w$.])(?:${[...gen].join("|")})\s*\(`));
  return res;
}

// Scan one source file. Returns { lines, problems }: 1-based lines (ascending,
// unique) holding a read, and the places the masker lost the thread. `problems`
// non-empty means the file was NOT reliably scanned and the caller must say so.
export function scanSource(src) {
  const m = maskSource(normalizeBracketAccess(src), true);
  const lines = new Set();
  const dynamic = importPatterns(m.visible);
  m.text.split("\n").forEach((line, idx) => {
    if (LINE_SPELLINGS.some(({ re }) => re.test(line)) || dynamic.some((re) => re.test(line))) lines.add(idx + 1);
  });
  for (const { re } of DESTRUCTURES) {
    for (const hit of m.text.matchAll(new RegExp(re.source, "g"))) {
      lines.add(m.text.slice(0, hit.index).split("\n").length);
    }
  }
  return { lines: [...lines].sort((a, b) => a - b), problems: m.problems };
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
// A default-less switch and a localeCompare, each placed behind a confuser that
// used to blind the masker, for the two non-clock gates that share it.
export const CONFUSER_PREFIXES = [
  ["i++ / 2 then a slash in a string", "i++ / 2; const s = 'a/b';\n"],
  ["a regex holding a quote after an if", 'if (a) /"/.test(s);\n'],
  ["a regex holding a backtick after else", "if (a) b(); else /`/.test(s);\n"],
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
  for (const [name, src] of CLOCK_DESYNC_PLANTS) checks.push([`an unreadable file is reported, not blanked: ${name}`, scan(src).problems.length >= 1]);
  checks.push(["a clean file reports no masker problem", scan("const a = 1 / 2;\nconst s = `x${a}`;\n").problems.length === 0]);
  return checks;
}
