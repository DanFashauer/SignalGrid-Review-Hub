// The one definition of "reads the clock or a randomness source", shared by the
// two gates that enforce golden rule 2 (scripts/safety-check.mjs check 1 over the
// decision core, scripts/review-invariants.mjs check 2 over every lib package).
//
// Both used to test only /\b(Date\.now|Math\.random)\s*\(/, which is two of the
// ways to say it. This module owns the rest, plus the comment/literal masking the
// scan needs, so the two gates cannot drift apart again.
//
// Input to clockReadLines() must be the output of prepare(): bracket access
// normalised, then comments and string/template text blanked in ONE scan.
// Order matters — normalising BEFORE masking is what lets Date["now"]() be seen
// while a string that merely contains those characters is still blanked.

// Blank line/block comments in place (newlines kept so line numbers stay true).
export function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

// Blank the TEXT of string and template literals (delimiters + newlines kept) so
// braces or keywords inside a literal are never mistaken for code. Template
// `${…}` expressions are real code and stay intact via a small mode stack.
export function maskLiterals(src, blankComments = false) {
  const arr = src.split("");
  const n = src.length;
  const blank = (k) => { if (arr[k] !== "\n") arr[k] = " "; };
  const stack = [{ mode: "code", depth: 0 }];
  let i = 0;
  while (i < n) {
    const top = stack[stack.length - 1];
    const c = src[i];
    if (top.mode === "code") {
      if (c === "\\") { i += 2; continue; }
      if (c === "'") { stack.push({ mode: "sq" }); i++; continue; }
      if (c === '"') { stack.push({ mode: "dq" }); i++; continue; }
      if (c === "`") { stack.push({ mode: "tmpl" }); i++; continue; }
      if (blankComments && c === "/" && (src[i + 1] === "/" || src[i + 1] === "*")) {
        // Comments are blanked by THIS scanner, not by a prior regex pass, so a
        // `//` inside a string ("http://x") is never mistaken for a comment that
        // hides the rest of its line.
        let e;
        if (src[i + 1] === "/") { e = src.indexOf("\n", i); if (e === -1) e = n; }
        else { e = src.indexOf("*/", i + 2); e = e === -1 ? n : e + 2; }
        for (let m = i; m < e; m++) blank(m);
        i = e; continue;
      }
      if (c === "/") {
        // A regex literal may hold a quote (`/"/g`). Unmasked, that quote opens a
        // string that never closes and the REST OF THE FILE goes blind — which
        // is how lib/audit/src/index.ts escaped the scan. Division follows an
        // operand (`)`, `]`, `}`, a name); a regex follows an operator or nothing.
        let k = i - 1;
        while (k >= 0 && /\s/.test(src[k])) k--;
        const prev = k >= 0 ? src[k] : "";
        const word = /[A-Za-z_$]/.test(prev) ? (/[\w$]+$/.exec(src.slice(Math.max(0, k - 12), k + 1)) ?? [""])[0] : "";
        const startsRegex = prev === "" || /[(,=:[!&|?{;+\-*%<>~^]/.test(prev) || /^(?:return|typeof|case|in|of|void|delete|throw|yield|await)$/.test(word);
        if (startsRegex) {
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
            for (let m = i + 1; m < j; m++) blank(m);
            i = j + 1;
            continue;
          }
        }
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
      blank(i); i++; continue;
    }
    // template literal
    if (c === "\\") { blank(i); blank(i + 1); i += 2; continue; }
    if (c === "`") { stack.pop(); i++; continue; }
    if (c === "$" && src[i + 1] === "{") { stack.push({ mode: "code", depth: 0 }); i += 2; continue; }
    blank(i); i++;
  }
  return arr.join("");
}

// `X["name"]` / `X['name']` is the same access as `X.name`. Rewritten (same
// length is NOT preserved, line count is) so the dotted patterns below see it.
const normalizeBracketAccess = (src) =>
  src.replace(/\[\s*(["'])([A-Za-z_$][\w$]*)\1\s*\]/g, ".$2");

export const prepare = (src) => maskLiterals(normalizeBracketAccess(src), true);

// Per-line spellings. Each is a WAY TO READ THE WALL CLOCK OR A NON-DETERMINISTIC
// SOURCE; none is a verdict-safe operation in a decision path.
const LINE_SPELLINGS = [
  [/\bDate\s*\.\s*now\s*\(/, "Date.now()"],
  [/\bMath\s*\.\s*random\s*\(/, "Math.random()"],
  // `new Date()` and a bare `Date()` both read the clock; `new Date(x)` does not.
  [/(?<![\w$.])Date\s*\(\s*\)/, "argless Date()"],
  [/\bcrypto\s*\.\s*(?:randomUUID|getRandomValues|randomBytes|randomInt|randomFillSync|randomFill)\s*\(/, "crypto random"],
  // Imported or destructured, the bare name is the call.
  [/(?<![\w$.])(?:randomBytes|randomUUID|randomInt|randomFillSync|randomFill|getRandomValues|pseudoRandomBytes)\s*\(/, "imported random"],
  [/\bperformance\s*\.\s*now\s*\(/, "performance.now()"],
  [/\bprocess\s*\.\s*hrtime\b/, "process.hrtime"],
  [/\bhrtime\s*\.\s*bigint\s*\(/, "hrtime.bigint()"],
];

// `const { now } = Date`, `const { random } = Math`, `const { hrtime } = process`,
// `const { randomUUID } = crypto` — possibly across lines, so this one runs over
// the whole text and maps the match back to its line.
const DESTRUCTURES = [
  [/\{[^{}]*\bnow\b[^{}]*\}\s*=\s*(?:globalThis\s*\.\s*)?Date\b/g, "{ now } = Date"],
  [/\{[^{}]*\brandom\b[^{}]*\}\s*=\s*(?:globalThis\s*\.\s*)?Math\b/g, "{ random } = Math"],
  [/\{[^{}]*\bnow\b[^{}]*\}\s*=\s*(?:globalThis\s*\.\s*)?performance\b/g, "{ now } = performance"],
  [/\{[^{}]*\bhrtime\b[^{}]*\}\s*=\s*(?:globalThis\s*\.\s*)?process\b/g, "{ hrtime } = process"],
  [/\{[^{}]*\b(?:randomUUID|getRandomValues|randomBytes|randomInt)\b[^{}]*\}\s*=\s*(?:globalThis\s*\.\s*)?crypto\b/g, "{ random } = crypto"],
];

// 1-based line numbers (ascending, unique) of every clock/randomness read in
// `code`, which must already have been through prepare().
export function clockReadLines(code) {
  const lines = new Set();
  code.split("\n").forEach((line, idx) => {
    if (LINE_SPELLINGS.some(([re]) => re.test(line))) lines.add(idx + 1);
  });
  for (const [re] of DESTRUCTURES) {
    for (const m of code.matchAll(re)) lines.add(code.slice(0, m.index).split("\n").length);
  }
  return [...lines].sort((a, b) => a - b);
}

// One planted source per spelling, plus prose that must NOT count. Both gates'
// self-tests iterate these, so a spelling cannot be dropped from one gate only.
export const CLOCK_PLANTS = [
  ["Date.now()", "const t = Date.now();"],
  ["Math.random()", "const r = Math.random();"],
  ['Date["now"]()', 'const t = Date["now"]();'],
  ["const { now } = Date; now()", "const { now } = Date; const t = now();"],
  ["new Date()", "const t = new Date();"],
  ['Math["random"]()', 'const r = Math["random"]();'],
  ["crypto.randomUUID()", "const id = crypto.randomUUID();"],
  ["crypto.getRandomValues(...)", "const b = crypto.getRandomValues(new Uint8Array(4));"],
  ["performance.now()", "const t = performance.now();"],
  ["process.hrtime.bigint()", "const t = process.hrtime.bigint();"],
  ["imported randomBytes(...)", 'import { randomBytes } from "node:crypto";\nconst b = randomBytes(4);'],
];
export const CLOCK_NON_PLANTS = [
  ["a comment naming Date.now()", "// never call Date.now() or new Date() here\nconst x = 1;"],
  ["a block comment naming Math.random()", "/* Math.random() and crypto.randomUUID() are banned */\nconst x = 1;"],
  ["a string literal containing Date.now()", 'const why = "Date.now() reads the clock";'],
  ["a string literal containing new Date()", "const why = 'new Date() reads the clock';"],
  ["a template literal containing performance.now()", "const why = `performance.now() is a clock`;"],
  ["new Date(x) from an argument", "const d = new Date(input.timestamp);"],
];
// Masking blind spots that once hid a whole file or the rest of a line: each of
// these CONTAINS a read that must still be seen.
export const CLOCK_BLIND_SPOT_PLANTS = [
  ["a read after a regex literal holding a quote", 'const e = s.replace(/"/g, esc);\nconst t = Date.now();'],
  ["a read after a URL string on the same line", 'const u = "http://x"; const t = Date.now();'],
];

// Run both lists through `scan(src) -> lines[]`. Returns [[name, ok], …] in the
// shape both gates' self-tests already push into.
export function clockSelfTestChecks(scan) {
  return [
    ...CLOCK_BLIND_SPOT_PLANTS.map(([name, src]) => [`masking does not blind the scan: ${name}`, scan(src).length >= 1]),
    ...CLOCK_PLANTS.map(([name, src]) => [`a clock/randomness read is flagged: ${name}`, scan(src).length >= 1]),
    ...CLOCK_NON_PLANTS.map(([name, src]) => [`prose is not flagged: ${name}`, scan(src).length === 0]),
  ];
}
