// The one definition of "reads the clock or a randomness source", shared by the
// two gates that enforce golden rule 2 (scripts/safety-check.mjs check 1 over the
// decision core, scripts/review-invariants.mjs check 2 over every lib package).
//
// Both used to test only /\b(Date\.now|Math\.random)\s*\(/, which is two of the
// ways to say it. This module owns the rest.
//
// WHAT DECIDES WHAT IS CODE. The TypeScript parser (ts.createSourceFile, a fixed
// language version, no JSDoc, no clock or environment option) decides what is a
// comment, a string, a template or a regex literal, so regex-versus-division is
// settled by the grammar and not guessed. Comments are blanked, and so is the TEXT of
// every string, template and regex literal (delimiters, newlines and offsets kept).
// A file the parser reports a syntax error for, or that cannot be read, is a PROBLEM
// that both gates treat as fatal and name; it is never a clean file.
//
// WHAT IT COVERS is exactly what LINE_SPELLINGS, the AST rules, DESTRUCTURES and the
// import/require bindings below list. It is NOT "every spelling": see CEILING.
//
// HOW IT MATCHES. The patterns run over the whole masked text (so `Date` newline
// `.now()` is one match), and a hit is attributed to the line its match STARTS on, by
// source offset. Four things are done on the syntax tree first, all in place (a rewrite
// replaces characters with spaces and the text keeps its length):
//   · every TYPE node is blanked, and so are the `<...>` of explicit type arguments, so
//     `typeof performance.timeOrigin` is not a read and `crypto.getRandomValues<T>(x)`,
//     `(crypto.getRandomValues<T>)(x)` and `crypto.getRandomValues<T>?.(x)` are the call
//     `crypto.getRandomValues(x)`;
//   · `X["name"]`, `X['name']`, X[`name`], `X?.["name"]`, a key with an escape or a line
//     continuation, and a parenthesised or `as const` key become `X.name`;
//   · TypeScript wrappers around an expression are blanked: parens, `as T`,
//     `satisfies T`, `<T>x`, a postfix non-null run, and `(0, x)` / `(void 0, x)`;
//   · `Date(...)` and Date`x` called without `new`, and `new Date`, `new Date()` and
//     `new Date(...a, ...b)` (no arguments, or only spreads), are found as call/new
//     nodes, not by pattern. These tree rules also follow the right operand of ANY comma
//     (`(a, Date)()`, `new (a, Date)()`, `const { now } = (a, Date)`).
// Destructures, `import` and `require` bindings (renamed, namespace, default, mixed,
// `import x = require`, destructured `require`, `await import(...)`) are read from the tree
// too, for node:crypto, node:perf_hooks, node:process and the uuid-style generator packages.
//
// CEILING (declared, not built): see CLOCK_CEILING below. It is the one source of the list;
// docs/BUILD_BACKLOG.md carries each item verbatim and scripts/clock-spellings-mutants.mjs
// fails if one of them drifts. The syntax-tree rewrite of the textual matcher, which counts
// reads rather than lines, is its own backlog row, not this one.
import ts from "typescript";

const K = ts.SyntaxKind;
const EOL = /[\n\r\u2028\u2029]/;

// The declared ceiling, item by item. Docs and the PR body copy these strings unchanged.
export const CLOCK_CEILING = [
  "Pins count LINES, not reads: two reads on one line are one hit, so a second read on an already-counted line does not move a pin (two live lines carry two reads each: `lib/webauthn/src/stepUpStore.ts:119`, `lib/webauthn/src/webauthn/store.ts:228`).",
  "Lines are numbered by LF, as git, grep and the pins count them: a CR-only file is one line to a pin, though its `//` comments end at the CR.",
  "FALSE-ALARM direction (a hit that is not a read, not a hidden read): `\\bcrypto`, `\\bperformance` and `\\bprocess` also match after a dot, so `fixture.performance.now()` is a false hit; a bare imported name such as `randomInt(` is flagged anywhere, including an unrelated local function of that name; a spread-only argument list is flagged although the spread may be non-empty (`new Date(...[1])`); a shadowed local named `Date` or `$Date`; and, inherited from mainline, safety-check's legacy raw-line union also flags a string or template that names `Date.now()` in the decision core (the legacy scan reads literal text, the parser-based scan does not).",
  "HIDDEN-READ direction, not followed (the list is not exhaustive; the followed forms are the ones the plants name): a computed key whose parenthesised expression has a non-trivial left operand (`Date[(f(), \"now\")]()`); a unicode-letter alias; a string-named import specifier (`import { \"randomBytes\" as rb }`); an inline `require(\"crypto\").randomBytes(4)`, `(await import(\"crypto\")).randomBytes(4)` or `import(\"crypto\").then(...)`; `const { webcrypto } = nc` (a receiver taken from a namespace); a reassigned `require`; a variable key (`Date[k]()`); receiver aliases (`const D = Date; D.now()`, `const p = performance; p.now()`); `Reflect.get(Date, \"now\")()`, `Function(\"return Date.now()\")()` and `eval(...)` (review-invariants misses them; safety-check catches a string-held one in the core only, through the legacy raw-line scan); `new globalThis[\"Date\"]()` and `new window.Date()`; `Date.prototype.constructor()`; a nested destructure from `globalThis`; a destructure through a generator `.default` (`const { v4 } = ids.default`, `const { default: { v4 } } = ids`); a computed key built from a template (``Date[`${\"now\"}`]()``); `require(\"uuid\").default`; `let nc; nc = require(\"crypto\")`; `await import(\"node:crypto\", {})`; `require(\"uuid\", 2)`; `const { ...r } = require(\"uuid\")`; a binding re-exported through a local module (`export * as ids from \"uuid\"`, used in another file; a per-file scan cannot see it); subpath and factory exports (`nanoid/non-secure`, `customAlphabet`); `crypto.getRandomValues<T,>(x)` (tsc rejects the trailing comma, TS1009); a tagged template of a function other than Date (`Date.now` followed by a template literal); `performance.mark().startTime`, `os.uptime()`, `crypto.subtle.generateKey` and `generateKeyPair*`.",
  "Not seen at all: an uncalled reference (`const c = Date.now`), `Reflect.apply` / `.call`, `Temporal` / `Intl`, and unicode escapes in an identifier.",
  "Cost: a 2 MB scoped file takes about 7 s in review-invariants and 4 s in safety-check (mainline about 2 s each); slow, not a hang.",
  "An unreadable file is a named problem in both gates: ENOENT and EISDIR are exercised; EACCES takes the same catch but cannot be exercised as root.",
];

// ── small helpers ─────────────────────────────────────────────────────────────
// Offsets of the first character of every LF-numbered line, and a binary search.
function lineStarts(src) {
  const out = [0];
  for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) out.push(i + 1);
  return out;
}
function lineAt(starts, off) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= off) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}
// Replace [a, b) with spaces, keeping every line terminator in place.
function blank(chars, a, b) {
  for (let k = Math.max(0, a); k < Math.min(chars.length, b); k++) if (!EOL.test(chars[k])) chars[k] = " ";
}

// Member access and call, each with optional chaining: `Date?.now()`, `Date.now?.()`.
const DOT = String.raw`\s*\??\.\s*`;
const CALL = String.raw`\s*(?:\?\.\s*)?\(`;
const G = String.raw`(?:globalThis${DOT})?`;
const RANDOM_FNS = ["randomUUID", "getRandomValues", "randomBytes", "randomInt", "randomFillSync", "randomFill", "pseudoRandomBytes"];
const RANDOM_ALT = RANDOM_FNS.join("|");
const escId = (s) => s.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");

// Per-pattern spellings: WAYS TO READ THE WALL CLOCK OR A NON-DETERMINISTIC SOURCE.
// Every entry has a plant of the same label in CLOCK_PLANTS, and the self-test
// requires the entry itself (not just some other rule) to match it.
const spell = (label, source) => ({ label, re: new RegExp(source), reG: new RegExp(source, "g") });
export const LINE_SPELLINGS = [
  spell("Date.now()", String.raw`\bDate${DOT}now${CALL}`),
  spell("Math.random()", String.raw`\bMath${DOT}random${CALL}`),
  spell("crypto random call", String.raw`\bcrypto${DOT}(?:webcrypto${DOT})?(?:${RANDOM_ALT})${CALL}`),
  // Imported without a rename, the bare name is the call.
  spell("imported random call", String.raw`(?<![\w$.])(?:${RANDOM_ALT})${CALL}`),
  spell("performance.now()", String.raw`\bperformance${DOT}now${CALL}`),
  spell("performance.timeOrigin", String.raw`\bperformance${DOT}timeOrigin\b`),
  spell("process.uptime()", String.raw`\bprocess${DOT}uptime${CALL}`),
  spell("process.hrtime", String.raw`\bprocess${DOT}hrtime\b`),
  spell("hrtime.bigint()", String.raw`\bhrtime${DOT}bigint${CALL}`),
];
// Found on the syntax tree, not by pattern: a bare `Date(...)` call (no `new`) returns the
// current time whatever it is given; `new Date`, `new Date()` and `new Date(...spread)` read
// it; `new Date(x)` with a plain argument is a fixed instant and does not.
export const AST_RULES = [{ label: "Date() read" }];

// `const { now } = Date` and kin. A name counts only on the PROPERTY side of an element
// (`{ now: n }`, `{ "now": n }`, `{ ["now"]: n }` and `{ UTC, now }` are reads; `{ parse: now }`
// and `{ parse = now }` are not), and the source may be wrapped (`= (Date)`, `= <any>Date`).
export const DESTRUCTURES = [
  { label: "{ now } = Date", names: ["now"], from: "Date" },
  { label: "{ random } = Math", names: ["random"], from: "Math" },
  { label: "{ now } = performance", names: ["now"], from: "performance" },
  { label: "{ timeOrigin } = performance", names: ["timeOrigin"], from: "performance" },
  { label: "{ hrtime } = process", names: ["hrtime"], from: "process" },
  { label: "{ uptime } = process", names: ["uptime"], from: "process" },
  { label: "{ random } = crypto", names: RANDOM_FNS, from: "crypto" },
];

// Generators imported by NAME from a package, matched by the (possibly renamed)
// binding. A package's deterministic exports (uuid v3/v5) are not listed.
const GENERATOR_PACKAGES = {
  uuid: ["v1", "v4", "v6", "v7"],
  nanoid: ["nanoid"],
  ulid: ["ulid", "monotonicFactory"],
  "@paralleldrive/cuid2": ["createId"],
};

// ── syntax-tree helpers ───────────────────────────────────────────────────────
const isWrapper = (n) =>
  n.kind === K.ParenthesizedExpression || n.kind === K.AsExpression || n.kind === K.SatisfiesExpression ||
  n.kind === K.TypeAssertionExpression || n.kind === K.NonNullExpression;
// `(0, x)` and `(void 0, x)`: the indirect-call idiom. Only a trivial left operand is dropped, so a
// read on the left of a comma is never blanked.
const isTrivialLeft = (n) =>
  n.kind === K.NumericLiteral || (n.kind === K.VoidExpression && n.expression.kind === K.NumericLiteral);
// Peel wrappers (and a trivial comma) down to the expression that actually runs.
// `anyComma` also follows the RIGHT operand of any comma (the tree rules never blank text, so a read on the
// left is still found where it stands); the text rewrite below only drops a trivial left operand.
function peel(n, anyComma = false) {
  for (;;) {
    if (n.kind === K.ParenthesizedExpression) {
      const e = n.expression;
      if (e.kind === K.BinaryExpression && e.operatorToken.kind === K.CommaToken && (anyComma || isTrivialLeft(e.left))) n = e.right;
      else n = e;
    } else if (isWrapper(n)) n = n.expression;
    else return n;
  }
}
const isDateRef = (e) => {
  const p = peel(e, true);
  if (p.kind === K.Identifier) return p.text === "Date";
  if (p.kind === K.PropertyAccessExpression && p.name.text === "Date") {
    const r = peel(p.expression, true);
    return r.kind === K.Identifier && r.text === "globalThis";
  }
  return false;
};
// The name an object-pattern/literal key spells, if it is static.
function keyOf(n) {
  if (!n) return null;
  if (n.kind === K.Identifier || n.kind === K.StringLiteral || n.kind === K.NoSubstitutionTemplateLiteral || n.kind === K.NumericLiteral) return n.text;
  if (n.kind === K.ComputedPropertyName) return keyOf(n.expression);
  return null;
}
// The name of the receiver a destructure reads from: `Date`, `globalThis.Date`, or a local.
function receiverOf(e) {
  const p = peel(e, true);
  if (p.kind === K.Identifier) return p.text;
  if (p.kind === K.PropertyAccessExpression) {
    const r = peel(p.expression, true);
    if (r.kind === K.Identifier && r.text === "globalThis") return p.name.text;
  }
  return null;
}
function requireModule(init) {
  if (!init) return null;
  let e = peel(init, true);
  // `await import("x")` binds the module namespace the way `require("x")` binds its object.
  if (e.kind === K.AwaitExpression) e = peel(e.expression, true);
  if (e.kind === K.CallExpression && (e.expression.kind === K.ImportKeyword || (e.expression.kind === K.Identifier && e.expression.text === "require")) &&
      e.arguments.length === 1 && ts.isStringLiteralLike(e.arguments[0])) return e.arguments[0].text;
  return null;
}

// What a module binding gives us, by module. `named` is [{ imported, local }].
function bind(b, mod, { dflt, ns, named }) {
  const base = mod.replace(/^node:/, "");
  const whole = [dflt, ns].filter(Boolean);
  if (base === "crypto") {
    for (const n of whole) b.cryptoNs.add(n);
    for (const { imported, local } of named) {
      if (RANDOM_FNS.includes(imported)) b.randomFns.add(local);
      if (imported === "webcrypto" || imported === "default") b.cryptoNs.add(local);
    }
  } else if (base === "perf_hooks") {
    for (const n of whole) b.perfNs.add(n);
    for (const { imported, local } of named) {
      if (imported === "performance") b.perf.add(local);
      if (imported === "default") b.perfNs.add(local);
    }
  } else if (base === "process") {
    for (const n of whole) b.procNs.add(n);
    for (const { imported, local } of named) {
      if (imported === "uptime") b.upFns.add(local);
      if (imported === "hrtime") b.hrFns.add(local);
      if (imported === "default") b.procNs.add(local);
    }
  } else if (GENERATOR_PACKAGES[base]) {
    // A default, namespace, require-object, import-equals or awaited-import binding holds every member.
    for (const n of whole) {
      if (!b.genNs.has(base)) b.genNs.set(base, new Set());
      b.genNs.get(base).add(n);
    }
    for (const { imported, local } of named) {
      if (GENERATOR_PACKAGES[base].includes(imported)) b.gen.add(local);
      if (imported === "default") {
        if (!b.genNs.has(base)) b.genNs.set(base, new Set());
        b.genNs.get(base).add(local);
      }
    }
  }
}
const newBindings = () => ({
  randomFns: new Set(), cryptoNs: new Set(), perf: new Set(), perfNs: new Set(),
  procNs: new Set(), upFns: new Set(), hrFns: new Set(), gen: new Set(), genNs: new Map(),
});

// ── the analysis of one file ──────────────────────────────────────────────────
function build(src) {
  const sf = ts.createSourceFile(
    "scan.ts",
    src,
    { languageVersion: ts.ScriptTarget.ES2022, jsDocParsingMode: ts.JSDocParsingMode.ParseNone },
    false,
    ts.ScriptKind.TS,
  );
  const starts = lineStarts(src);
  const problems = [];
  const diags = sf.parseDiagnostics;
  if (!Array.isArray(diags)) {
    problems.push({ line: 1, what: "the TypeScript parser did not expose its syntax diagnostics, so the file cannot be verified" });
  } else {
    for (const d of diags) {
      problems.push({
        line: lineAt(starts, d.start ?? 0),
        what: `TypeScript cannot parse this file (TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")})`,
      });
    }
  }
  const startOf = (n) => n.getStart(sf);
  const prot = []; // [start, end) literal tokens the comment scan must not enter
  const interiors = []; // [a, b) literal text to blank in the masked text
  const wrappers = [];
  const accesses = [];
  const typeRanges = []; // [start, end) of every type node: not code that runs
  const typeArgLists = []; // call/new/tag type-argument lists, `<` and `>` included
  const dateLines = [];
  const sites = [];
  const b = newBindings();

  const addSite = (pattern, init) => {
    if (!init) return;
    let keys = [];
    if (pattern.kind === K.ObjectBindingPattern) {
      keys = pattern.elements.map((el) => (el.dotDotDotToken ? null : keyOf(el.propertyName ?? el.name)));
    } else if (pattern.kind === K.ObjectLiteralExpression) {
      keys = pattern.properties.map((p) =>
        p.kind === K.ShorthandPropertyAssignment ? p.name.text : p.kind === K.PropertyAssignment ? keyOf(p.name) : null);
    }
    sites.push({ line: lineAt(starts, startOf(pattern)), keys: keys.filter(Boolean), receiver: receiverOf(init) });
  };
  const bindRequire = (name, mod) => {
    if (name.kind === K.Identifier) bind(b, mod, { dflt: name.text, named: [] });
    else if (name.kind === K.ObjectBindingPattern) {
      const named = [];
      for (const el of name.elements) {
        if (el.dotDotDotToken || el.name.kind !== K.Identifier) continue;
        const imported = keyOf(el.propertyName ?? el.name);
        if (imported) named.push({ imported, local: el.name.text });
      }
      bind(b, mod, { named });
    }
  };

  const visit = (node, inWrapper) => {
    // A type is not code that runs: `typeof performance.timeOrigin` names a type, not a read. Instantiation-expression
    // heads (ExpressionWithTypeArguments) are left alone; their argument types are recorded as they are visited.
    if (ts.isTypeNode(node) && node.kind !== K.ExpressionWithTypeArguments) typeRanges.push([startOf(node), node.end]);
    // `f<T>` as an instantiation expression, `f<T>?.(x)` and `(f<T>)(x)`: the head is code, the brackets are not.
    if (node.kind === K.ExpressionWithTypeArguments && node.typeArguments?.length) typeArgLists.push(node.typeArguments);
    switch (node.kind) {
      case K.StringLiteral:
      case K.NoSubstitutionTemplateLiteral: {
        const a = startOf(node);
        prot.push([a, node.end]);
        interiors.push([a + 1, node.end - 1 > a && src[node.end - 1] === src[a] ? node.end - 1 : node.end]);
        break;
      }
      case K.TemplateHead:
      case K.TemplateMiddle: {
        const a = startOf(node);
        prot.push([a, node.end]);
        interiors.push([a + 1, Math.max(a + 1, node.end - 2)]);
        break;
      }
      case K.TemplateTail: {
        const a = startOf(node);
        prot.push([a, node.end]);
        interiors.push([a + 1, Math.max(a + 1, node.end - 1)]);
        break;
      }
      case K.RegularExpressionLiteral: {
        const a = startOf(node);
        const last = src.lastIndexOf("/", node.end - 1);
        prot.push([a, node.end]);
        interiors.push([a + 1, last > a ? last : node.end]);
        break;
      }
      case K.ElementAccessExpression:
        accesses.push(node);
        break;
      case K.CallExpression:
        if (isDateRef(node.expression)) dateLines.push(lineAt(starts, startOf(node)));
        if (node.typeArguments?.length) typeArgLists.push(node.typeArguments);
        break;
      case K.TaggedTemplateExpression:
        // A tagged template calls its tag: Date`x` is Date("x").
        if (isDateRef(node.tag)) dateLines.push(lineAt(starts, startOf(node)));
        if (node.typeArguments?.length) typeArgLists.push(node.typeArguments);
        break;
      case K.NewExpression:
        // No arguments, or only spreads (which may be empty): the zero-argument form reads the clock. One
        // plain argument first, `new Date(0, ...parts)`, is a fixed instant whatever the spread holds.
        if (isDateRef(node.expression) && (!node.arguments || node.arguments.length === 0 || node.arguments.every((x) => x.kind === K.SpreadElement))) {
          dateLines.push(lineAt(starts, startOf(node)));
        }
        if (node.typeArguments?.length) typeArgLists.push(node.typeArguments);
        break;
      case K.VariableDeclaration: {
        if (node.name.kind === K.ObjectBindingPattern) addSite(node.name, node.initializer);
        const mod = requireModule(node.initializer);
        if (mod) bindRequire(node.name, mod);
        break;
      }
      case K.Parameter:
        if (node.name.kind === K.ObjectBindingPattern) addSite(node.name, node.initializer);
        break;
      case K.BinaryExpression:
        if (node.operatorToken.kind === K.EqualsToken && node.left.kind === K.ObjectLiteralExpression) addSite(node.left, node.right);
        break;
      case K.ImportEqualsDeclaration:
        if (!node.isTypeOnly && node.moduleReference.kind === K.ExternalModuleReference && ts.isStringLiteralLike(node.moduleReference.expression)) {
          bind(b, node.moduleReference.expression.text, { dflt: node.name.text, named: [] });
        }
        break;
      case K.ImportDeclaration: {
        const clause = node.importClause;
        if (clause && !clause.isTypeOnly && ts.isStringLiteralLike(node.moduleSpecifier)) {
          const nb = clause.namedBindings;
          const named = [];
          if (nb && nb.kind === K.NamedImports) {
            for (const el of nb.elements) if (!el.isTypeOnly) named.push({ imported: (el.propertyName ?? el.name).text, local: el.name.text });
          }
          bind(b, node.moduleSpecifier.text, {
            dflt: clause.name?.text,
            ns: nb && nb.kind === K.NamespaceImport ? nb.name.text : undefined,
            named,
          });
        }
        break;
      }
      default:
        break;
    }
    const w = isWrapper(node);
    if (w && !inWrapper) wrappers.push(node);
    ts.forEachChild(node, (c) => visit(c, w));
  };
  visit(sf, false);

  // Comments: the plain scanner, told to step over every literal token the tree found, so a
  // `//` inside a string, template or regex is never taken for a comment.
  prot.sort((x, y) => x[0] - y[0]);
  const comments = [];
  const scanner = ts.createScanner(ts.ScriptTarget.ES2022, false, ts.LanguageVariant.Standard, src);
  let pos = 0;
  let pi = 0;
  while (pos < src.length) {
    while (pi < prot.length && prot[pi][1] <= pos) pi++;
    if (pi < prot.length && prot[pi][0] <= pos && pos < prot[pi][1]) {
      pos = prot[pi][1];
      continue;
    }
    scanner.resetTokenState(pos);
    const kind = scanner.scan();
    if (kind === K.EndOfFileToken) break;
    const a = scanner.getTokenStart();
    const e = scanner.getTokenEnd();
    if (kind === K.SingleLineCommentTrivia || kind === K.MultiLineCommentTrivia || kind === K.ShebangTrivia) comments.push([a, e]);
    pos = e > pos ? e : pos + 1;
  }

  const out = src.split("");
  const vis = src.split("");
  for (const [a, e] of comments) {
    blank(out, a, e);
    blank(vis, a, e);
  }
  for (const [a, e] of interiors) blank(out, a, e);
  const masked = out.join("");

  // The text the patterns run over: wrappers blanked in place, bracket access made a dot access.
  const t = out.slice();
  for (const w of wrappers) {
    const inner = peel(w);
    blank(t, startOf(w), startOf(inner));
    blank(t, inner.end, w.end);
  }
  // Types are blanked from the pattern text, and so are the angle brackets of explicit type arguments
  // (`crypto.getRandomValues<Uint8Array>(x)` is the call `crypto.getRandomValues(x)`).
  for (const [a, e] of typeRanges) blank(t, a, e);
  for (const list of typeArgLists) {
    const lt = t.lastIndexOf("<", startOf(list[0]));
    let gt = list[list.length - 1].end;
    while (gt < t.length && t[gt] !== ">") gt++;
    if (lt >= 0 && gt < t.length) {
      t[lt] = " ";
      t[gt] = " ";
    }
  }
  for (const node of accesses) {
    const arg = peel(node.argumentExpression);
    if (!(arg.kind === K.StringLiteral || arg.kind === K.NoSubstitutionTemplateLiteral) || !/^[A-Za-z_$][\w$]*$/.test(arg.text)) continue;
    const kids = node.getChildren(sf);
    const open = kids.find((c) => c.kind === K.OpenBracketToken);
    const close = kids.find((c) => c.kind === K.CloseBracketToken);
    if (!open || !close) continue;
    const hasQd = kids.some((c) => c.kind === K.QuestionDotToken);
    // `X["key"]` becomes `X.key`. The key's COOKED text (`"r\u0061ndom"` is `random`, a line continuation is
    // nothing) is written contiguously where the raw text began and the rest of the brackets, newlines included,
    // is blanked. Hits are attributed through source offsets, so no line moves.
    const o = startOf(open);
    const c = startOf(close);
    for (let k = o; k <= c; k++) t[k] = " ";
    if (!hasQd) t[o] = ".";
    const a = startOf(arg) + 1;
    for (let k = 0; k < arg.text.length; k++) t[a + k] = arg.text[k];
  }

  // Patterns built from this file's own bindings. Names are regex-escaped.
  const alt = (set) => [...set].map(escId).join("|");
  const dyn = [];
  const dynDestructures = [];
  const L = String.raw`(?<![\w$.])`;
  if (b.randomFns.size) dyn.push(new RegExp(String.raw`${L}(?:${alt(b.randomFns)})${CALL}`, "g"));
  if (b.upFns.size) dyn.push(new RegExp(String.raw`${L}(?:${alt(b.upFns)})${CALL}`, "g"));
  if (b.hrFns.size) dyn.push(new RegExp(String.raw`${L}(?:${alt(b.hrFns)})(?:${CALL}|${DOT}bigint${CALL})`, "g"));
  if (b.gen.size) dyn.push(new RegExp(String.raw`${L}(?:${alt(b.gen)})${CALL}`, "g"));
  for (const [pkg, names] of b.genNs) {
    const members = GENERATOR_PACKAGES[pkg];
    dyn.push(new RegExp(String.raw`${L}(?:${alt(names)})${DOT}(?:default${DOT})?(?:${members.map(escId).join("|")})${CALL}`, "g"));
    dynDestructures.push({ names: members, from: [...names] });
  }
  if (b.cryptoNs.size) {
    dyn.push(new RegExp(String.raw`${L}(?:${alt(b.cryptoNs)})${DOT}(?:(?:default|webcrypto)${DOT})*(?:${RANDOM_ALT})${CALL}`, "g"));
    dynDestructures.push({ names: RANDOM_FNS, from: [...b.cryptoNs] });
  }
  if (b.perf.size) {
    dyn.push(new RegExp(String.raw`${L}(?:${alt(b.perf)})${DOT}(?:now${CALL}|timeOrigin\b)`, "g"));
    dynDestructures.push({ names: ["now", "timeOrigin"], from: [...b.perf] });
  }
  if (b.perfNs.size) dyn.push(new RegExp(String.raw`${L}(?:${alt(b.perfNs)})${DOT}(?:default${DOT})?performance${DOT}(?:now${CALL}|timeOrigin\b)`, "g"));
  if (b.procNs.size) {
    dyn.push(new RegExp(String.raw`${L}(?:${alt(b.procNs)})${DOT}(?:default${DOT})?(?:uptime${CALL}|hrtime\b)`, "g"));
    dynDestructures.push({ names: ["uptime", "hrtime"], from: [...b.procNs] });
  }

  return { starts, problems, masked, visible: vis.join(""), scanText: t.join(""), dateLines, sites, dyn, dynDestructures };
}

// One analysis per distinct source: the gates ask for the same file several times (the switch,
// clock and collation scans). The result is a pure function of the source text.
const cache = new Map();
let cacheChars = 0;
function analyze(src) {
  let hit = cache.get(src);
  if (!hit) {
    hit = build(src);
    if (cacheChars > 80_000_000) {
      cache.clear();
      cacheChars = 0;
    }
    cache.set(src, hit);
    cacheChars += src.length;
  }
  return hit;
}

// Mask comments and string/template/regex literal TEXT (delimiters and newlines kept, so
// offsets and line numbers survive). Returns
//   text      comments and literal text blanked: what the switch and collation scans read
//   visible   only comments blanked, string text kept
//   problems  [{ line, what }] — a syntax error, or any place the file cannot be verified
// The second argument is accepted for the old signature and ignored.
export function maskSource(src) {
  const a = analyze(src);
  return { text: a.masked, visible: a.visible, problems: a.problems };
}

function destructureHits(a, entries) {
  const lines = new Set();
  for (const { names, from } of entries) {
    const froms = Array.isArray(from) ? from : [from];
    for (const s of a.sites) {
      if (froms.includes(s.receiver) && s.keys.some((k) => names.includes(k))) lines.add(s.line);
    }
  }
  return [...lines];
}

const addMatches = (a, reG, lines) => {
  for (const m of a.scanText.matchAll(reG)) lines.add(lineAt(a.starts, m.index));
};

// Scan one source file. Returns { lines, problems }: 1-based lines (ascending, unique) holding a
// read, and the places the file cannot be verified. `problems` non-empty means the file was NOT
// reliably scanned and the caller must say so.
export function scanSource(src) {
  const a = analyze(src);
  const lines = new Set(a.dateLines);
  for (const { reG } of LINE_SPELLINGS) addMatches(a, reG, lines);
  for (const re of a.dyn) addMatches(a, re, lines);
  for (const ln of destructureHits(a, [...DESTRUCTURES, ...a.dynDestructures])) lines.add(ln);
  return { lines: [...lines].sort((x, y) => x - y), problems: a.problems };
}

// The legacy raw-line scan safety-check keeps beside the parser, so a file the parser misreads
// still reports the original spellings (with optional chaining). A line is split at every
// ECMAScript line terminator first, so a `//` comment ending at U+2028 cannot hide the code after
// it. Returns 1-based `\n` line numbers.
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

// Does the table entry ITSELF (not some other rule) match this source?
function entryMatches(entry, src) {
  const a = analyze(src);
  if (entry.names) return destructureHits(a, [entry]).length > 0;
  if (entry.re) return [...a.scanText.matchAll(entry.reG)].length > 0;
  return a.dateLines.length > 0; // the AST rule
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
// Forms the round-9 review named: each hides a read from a text matcher and none from the tree.
export const CLOCK_TREE_PLANTS = [
  ["new Date; with no parens", "const t = new Date;"],
  ["+new Date", "const t = +new Date;"],
  ["new Date(...[]) spread of nothing", "const t = new Date(...[]);"],
  ["new Date(...args) spread", "const t = new Date(...args);"],
  ["new (Date)", "const t = new (Date);"],
  ["new Date() across lines", "const t = new Date(\n);"],
  ["Date(...) returns the clock whatever it is given", "const t = Date(...args);"],
  ["a generic call before a read: f<T>(a) then Date.now()", "const x = f<Array<number>>(a);\nconst t = Date.now();"],
  ["a type argument closing with >> before a read", "const m: Map<string, Array<number>> = new Map(); const t = Date.now();"],
  ["an object key named await before a read", "const o = { await: 1 }; const t = o.await / 2 + Date.now();"],
  ["a variable named await in a script-style division", "const await_ = 4; const t = await_ / 2 + Date.now();"],
  ["wrappers nested ten deep", "const t = ((((((((((Date)))))))))).now();"],
  ["wrappers mixed: as, satisfies, non-null, parens", "const t = ((((Date as any)!) satisfies any) as unknown as DateConstructor).now();"],
  ["a template-literal key: Date[`now`]()", "const t = Date[`now`]();"],
  ["a unicode-escaped key: Math[\"r\\u0061ndom\"]()", 'const r = Math["r\\u0061ndom"]();'],
  ["a hex-escaped key: Date[\"no\\x77\"]()", 'const t = Date["no\\x77"]();'],
  ["a template key with an escape: Date[`no\\u0077`]()", "const t = Date[`no\\u0077`]();"],
  ["a read after a bracket access sharing its line: crypto.randomUUID(), v = o[ newline \"k\" newline ]; crypto.randomUUID()", 'const a = crypto.randomUUID(), v = o[\n"k"\n]; const b = crypto.randomUUID();'],
  ["a template-literal key across lines", "const t = Date[\n`now`\n]();"],
  ["require( with a space: require (\"crypto\")", 'const { randomBytes: rb } = require ("crypto");\nconst b = rb(4);'],
  ["require( across lines", 'const nc = require(\n"crypto"\n);\nconst b = nc.randomUUID();'],
  ["node:perf_hooks named import", 'import { performance } from "node:perf_hooks";\nconst t = performance.now();'],
  ["node:perf_hooks renamed import", 'import { performance as p } from "node:perf_hooks";\nconst t = p.now();'],
  ["node:perf_hooks namespace import", 'import * as ph from "node:perf_hooks";\nconst t = ph.performance.now();'],
  ["perf_hooks require", 'const { performance: p } = require("perf_hooks");\nconst t = p.now();'],
  ["node:process default import", 'import proc from "node:process";\nconst t = proc.uptime();'],
  ["node:process namespace import hrtime", 'import * as proc from "node:process";\nconst t = proc.hrtime();'],
  ["node:process named uptime", 'import { uptime } from "node:process";\nconst t = uptime();'],
  ["node:process renamed hrtime", 'import { hrtime as hr } from "node:process";\nconst t = hr.bigint();'],
  ["a quoted-key destructure: { \"now\": n } = Date", 'const { "now": n } = Date;'],
  ["a computed-key destructure: { [\"now\"]: n } = Date", 'const { ["now"]: n } = Date;'],
  ["a template computed-key destructure", "const { [`now`]: n } = Date;"],
  ["a type-annotated destructure", "const { now }: DateConstructor = Date;"],
  ["a destructure in a parameter default", "function f({ now } = Date) { return now(); }"],
  ["a destructuring assignment", "let now; ({ now } = Date);"],
  // Survivors of round 8 (shapes a mutant of the old heuristic could drop), now pinned as plants.
  ["four parens: ((((Date)))).now()", "const t = ((((Date)))).now();"],
  ["five parens: (((((Date))))).now()", "const t = (((((Date))))).now();"],
  ["indirect call with ?.(: (0, Date.now)?.()", "const t = (0, Date.now)?.();"],
  ["angle cast with an undotted receiver: (<any>Date.now)()", "const t = (<any>Date.now)();"],
  ["an as-type spanning lines: (Date as Record<string,\n any>).now()", "const t = (Date as Record<string,\n any>).now();"],
  ["a line-initial regex after `let x` with a lone CR", "let x\r/x=/.test(s);\rconst t = Date.now();"],
  ["a read after a template then a division", "const z = `a` / 2;\nconst t = Date.now();"],
  ["a read after a postfix ! then a division at line end", "const z = m.get(k)! / 2;\nconst t = Date.now();"],
  ["a read after i++ then a division at line end", "i++ / 2;\nconst t = Date.now();"],
  ["a read after a numeric literal then a division", "const z = 4 / 2;\nconst t = Date.now();"],
  // Round 10: explicit type arguments, tagged templates, comma receivers, wrapped and continued keys.
  ["type arguments on a crypto call", "crypto.getRandomValues<Uint8Array<ArrayBuffer>>(new Uint8Array(4));"],
  ["type arguments on an imported random call", 'import { randomFillSync } from "node:crypto";\nrandomFillSync<Buffer>(Buffer.alloc(4));'],
  ["type arguments on a webcrypto receiver", 'import { webcrypto } from "node:crypto";\nwebcrypto.getRandomValues<Uint8Array<ArrayBuffer>>(new Uint8Array(4));'],
  ["type arguments on Date.now", "const t = Date.now<number>();"],
  ["type arguments after ?. on Date.now", "const t = Date.now?.<number>();"],
  ["a tagged-template call of Date", "const t = Date`x`;"],
  ["a tagged-template call of a cast Date", "const t = (Date as any)`x`;"],
  ["a spread-only argument list: new Date(...a, ...b)", "const t = new Date(...a, ...b);"],
  ["a destructure from a comma receiver: (a, Date)", "const { now } = (a, Date); now();"],
  ["a comma receiver in new: new (a, Date)()", "const t = new (a, Date)();"],
  ["a comma receiver in a call: (a, Date)()", "const t = (a, Date)();"],
  ["new (void 0, Date)()", "const t = new (void 0, Date)();"],
  ["a read on the LEFT of a comma: (Date.now(), 0)", "const t = (Date.now(), 0);"],
  ["a trivial-comma destructure source: (0, Date)", "const { now } = (0, Date); export const t = now();"],
  ["a cast on a require: require(...) as typeof import(...)", 'const nc = require("crypto") as typeof import("crypto");\nconst b = nc.randomBytes(4);'],
  ["{ default as proc } from node:process", 'import { default as proc } from "node:process";\nconst t = proc.uptime();'],
  ["proc.default.uptime() through a process namespace", 'import * as proc from "node:process";\nconst t = proc.default.uptime();'],
  ["nc.default.webcrypto.getRandomValues(...)", 'import * as nc from "node:crypto";\nconst b = nc.default.webcrypto.getRandomValues(new Uint8Array(4));'],
  ["a key with a line continuation: Date[\"n\\\now\"]()", 'const t = Date["n\\\now"]();'],
  ["a key with a line continuation: Math[\"ran\\\ndom\"]()", 'const r = Math["ran\\\ndom"]();'],
  ["a template key with a line continuation", "const t = Date[`n\\\now`]();"],
  ["a parenthesised key: Date[(\"now\")]()", 'const t = Date[("now")]();'],
  ["a key with a const assertion: Date[\"now\" as const]()", 'const t = Date["now" as const]();'],
  ["a comment scan that must step over a template: `${a}//`; Date.now()", "const s = `${a}//`;\nconst t = Date.now();"],
  ["a comment scan that must step over a regex: /\\/\\//; Date.now()", "const re = /\\/\\//; const t = Date.now();"],
  // Round 11.
  ["a computed key with a void 0 comma: Date[(void 0, \"now\")]()", 'export const t = Date[(void 0, "now")]();'],
  ["a computed key with a void 0 comma: Math[(void 0, \"random\")]()", 'export const r = Math[(void 0, "random")]();'],
  ["a computed key with a void 0 comma and a template key", "export const t = Date[(void 0, `now`)]();"],
  ["a computed key with a 0 comma: Date[(0, \"now\")]()", 'export const t = Date[(0, "now")]();'],
  ["uuid namespace import: ids.v4()", 'import * as ids from "uuid";\nexport const id = ids.v4();'],
  ["uuid require object: ids.v4()", 'const ids = require("uuid");\nexport const id = ids.v4();'],
  ["uuid require object: ids.v7()", 'const ids = require("uuid");\nexport const id = ids.v7();'],
  ["uuid import = require: ids.v4()", 'import ids = require("uuid");\nexport const id = ids.v4();'],
  ["uuid awaited import: ids.v4()", 'const ids = await import("uuid");\nexport const id = ids.v4();'],
  ["uuid namespace destructured later: { v4 } = ids", 'import * as ids from "uuid";\nconst { v4 } = ids;'],
  ["uuid default import: ids.v1()", 'import ids from "uuid";\nexport const id = ids.v1();'],
  ["nanoid namespace import", 'import * as n from "nanoid";\nexport const id = n.nanoid();'],
  ["awaited import of node:crypto", 'const nc = await import("node:crypto");\nexport const b = nc.randomUUID();'],
  ["instantiation expression with ?. call: getRandomValues<T>?.(x)", "crypto.getRandomValues<Uint8Array<ArrayBuffer>>?.(new Uint8Array(4));"],
  ["parenthesised instantiation expression: (getRandomValues<T>)(x)", "(crypto.getRandomValues<Uint8Array<ArrayBuffer>>)(new Uint8Array(4));"],
  ["parenthesised instantiation of an imported name", 'import { randomFillSync } from "node:crypto";\n(randomFillSync<Buffer>)(Buffer.alloc(4));'],
  ["parenthesised instantiation with a non-null call", 'import { randomFillSync } from "node:crypto";\n(randomFillSync<Buffer>)!(Buffer.alloc(4));'],
  ["parenthesised instantiation of a webcrypto receiver", 'import { webcrypto } from "node:crypto";\n(webcrypto.getRandomValues<Uint8Array<ArrayBuffer>>)(new Uint8Array(4));'],
  ["a comma receiver through globalThis in a destructure", "const { now } = (f(), globalThis).Date;"],
  ["a comma receiver through globalThis in new", "const t = new (f(), globalThis).Date();"],
  ["a comma receiver around a require", 'const nc = (f(), require("crypto"));\nconst b = nc.randomUUID();'],
  ["a read in the argument of a class heritage call", "class A extends mixin(Date.now()) {}"],
  ["a template tail holding // before a read on the same line", "const s = `${a}//`; export const t = Date.now();"],
  ["a template tail holding /* hiding a line until a later */", "const s = `${a}/*`;\nexport const t = Date.now();\nconst u = `*/`;"],
  ["a template middle holding // before a read on the same line", "const s = `${a}//${b}`; export const t = Date.now();"],
  // Round 12.
  ["a named default of a generator package: { default: ids } = require", 'const { default: ids } = require("uuid");\nexport const id = ids.v4();'],
  ["a generator namespace .default hop: ids.default.v4()", 'const ids = require("uuid");\nexport const id = ids.default.v4();'],
  ["a template-literal module argument: require(`node:crypto`)", "const nc = require(`node:crypto`);\nexport const b = nc.randomUUID();"],
  ["a space before the closing > of type arguments", "crypto.getRandomValues<Uint8Array<ArrayBuffer> >(new Uint8Array(4));"],
  ["a comment before the closing > of type arguments", "(crypto.getRandomValues<Uint8Array<ArrayBuffer> /* c */>)(new Uint8Array(4));"],
  ["an awaited parenthesised import: await (import(...))", 'const nc = await (import("node:crypto"));\nexport const b = nc.randomUUID();'],
  ["a read on the left of a void: (void Date.now(), 0)", "export const t = (void Date.now(), 0);"],
  ["a generator namespace with ?. : ids?.v4()", 'import * as ids from "uuid";\nexport const id = ids?.v4();'],
  ["a generator namespace call with ?.(): ids.v4?.()", 'import * as ids from "uuid";\nexport const id = ids.v4?.();'],
  ["a multi-line destructure", "const {\n  UTC,\n  now,\n} = Date;"],
  ["a read after a bracket access that spans two physical lines", 'const v = x\n[\n"k"\n];\nconst t = Date.now();'],
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
  ["a destructure from a local named like a clock source", "const { now } = dateLike;"],
  ["new Date(+x), a plain argument", "const d = new Date(+x);"],
  ["Date.parse is not the clock", 'const d = Date.parse("2020-01-01");'],
  ["Date.UTC is not the clock", "const d = Date.UTC(2020, 0, 1);"],
  ["a quoted key that is not a clock name", 'const { "parse": n } = Date;'],
  ["a computed key that is not static", "const { [k]: n } = Date;"],
  ["node:perf_hooks imported but only the type is used", 'import type { performance } from "node:perf_hooks";\nconst x: typeof performance = y;'],
  ["a type-only reference: typeof performance.timeOrigin", "export type Origin = typeof performance.timeOrigin;"],
  ["a type-only reference: typeof process.hrtime", "export type H = typeof process.hrtime;"],
  ["a type-only reference in an interface", "export interface I { t: typeof performance.timeOrigin }"],
  ["a type-only reference in a declare const", "export declare const hr: typeof process.hrtime;"],
  ["new Date(0, ...parts): a fixed first argument", "const d = new Date(0, ...parts);"],
  ["new Date(undefined as any, ...xs)", "const d = new Date(undefined as any, ...xs);"],
  ["a template head naming Date.now()", "const s = `Date.now() at ${x}`;"],
  ["uuid v5 through a namespace is deterministic", 'import * as ids from "uuid";\nexport const id = ids.v5("a", ns);'],
  ["a regex literal naming Date.now()", "const re = /Date.now()/;"],
  ["a division of two names that match a spelling by prefix", "const r = Mathematics / randomness;"],
];
// Sources the masker must REPORT as unreadable, and one it must not.
export const CLOCK_DESYNC_PLANTS = [
  ["a missing expression: let x = ;", "let x = ;\nconst t = Date.now();"],
  ["a missing name: const = 1", "const = 1;\nconst t = Date.now();"],
  ["an unclosed paren", "const a = (1 + 2;\nconst t = Date.now();"],
  ["an unclosed class body", "class A {\nconst t = Date.now();"],
  ["a stray closing brace", "}\nconst t = Date.now();"],
  // Not ASI: `foo()\n/x=/` is a division to the grammar, so the parser says so instead of guessing.
  ["a call then a line-initial regex", "foo()\n/x=/.test(s); const t = Date.now() / 2;"],
  ["a quoted string crossing a newline", 'const s = "abc\nconst t = 1;'],
  ["a template literal open at end of file", "const s = `abc\nconst t = 1;"],
  ["a block comment open at end of file", "const t = 1;\n/* never closed\nconst u = 2;"],
  ["a template expression open at end of file", "const s = `a${b\n"],
];
// Line-initial `/` after a statement the parser ends by ASI: all of these PARSE, so the read after
// them is seen and nothing is reported. (Round 8's heuristic masker reported them.)
export const CLOCK_ASI_PLANTS = [
  ["a type alias then a line-initial regex (ASI)", "type Marker = string\n/x=/.test(s); const t = Date.now() / 2;"],
  ["a union type alias then a line-initial regex", 'type M = "a" | "b"\n/x=/.test(s); const t = Date.now() / 2;'],
  ["an array type alias then a line-initial regex", "type M = string[]\n/x=/.test(s); const t = Date.now() / 2;"],
  ["a declare const then a line-initial regex", "declare const x: number\n/x=/.test(s); const t = Date.now() / 2;"],
  ["a declare function then a line-initial regex", "declare function f(): string\n/x=/.test(s); const t = Date.now() / 2;"],
  ["a typed let then a line-initial regex", "let x: Foo\n/x=/.test(s); const t = Date.now() / 2;"],
  ["a plain let then a line-initial regex", "let x\n/x=/.test(s); const t = Date.now() / 2;"],
  ["an import-from then a line-initial regex", 'import { a } from "b"\n/x=/.test(s); const t = Date.now() / 2;'],
  ["an export-from then a line-initial regex", 'export { a } from "b"\n/x=/.test(s); const t = Date.now() / 2;'],
  ["a division continued on the next line", "const r = a\n  / b;\nconst t = Date.now();"],
];
// A syntax error is REPORTED and the later read is still seen.
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
  const entries = [...LINE_SPELLINGS, ...AST_RULES, ...DESTRUCTURES];
  const labels = new Set(entries.map((e) => e.label));
  const plantLabels = new Set(CLOCK_PLANTS.map(([l]) => l));
  for (const e of entries) checks.push([`every pattern has a plant: ${e.label}`, plantLabels.has(e.label)]);
  for (const [label, src] of CLOCK_PLANTS) {
    const e = entries.find((x) => x.label === label);
    const entryHits = e ? entryMatches(e, src) : false;
    checks.push([`the pattern itself matches its plant: ${label}`, entryHits]);
    checks.push([`a clock/randomness read is flagged: ${label}`, flagged(src)]);
  }
  for (const [name, src] of CLOCK_FORM_PLANTS) checks.push([`a read is flagged in the form: ${name}`, flagged(src)]);
  for (const [name, src] of CLOCK_TREE_PLANTS) checks.push([`a read is flagged in the form: ${name}`, flagged(src) && scan(src).problems.length === 0]);
  for (const [name, src] of CLOCK_BLIND_SPOT_PLANTS) checks.push([`masking does not hide a read: ${name}`, flagged(src) && scan(src).problems.length === 0]);
  for (const [name, src] of CLOCK_NON_PLANTS) checks.push([`prose is not flagged: ${name}`, scan(src).lines.length === 0]);
  for (const [name, src] of CLOCK_ASI_PLANTS) checks.push([`a statement ended by ASI parses cleanly and the later read is seen: ${name}`, flagged(src) && scan(src).problems.length === 0]);
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
  checks.push(["a read split across lines is attributed to the line it STARTS on", at("const a = 1;\nconst t = Date\n  .now();\nconst u = 2;") === "[2]"]);
  checks.push(["two physically distinct reads around a multi-line bracket access stay on their own lines", at('const a = crypto.randomUUID(), v = o[\n"k"\n]; const b = crypto.randomUUID();') === "[1,3]"]);
  checks.push(["a Date() call on the line after a previous read keeps its own line", at("export const a = Date.now(), b =\nDate();") === "[1,2]"]);
  // One plant per listed generator member, both as a named import and through a namespace: a member
  // dropped from GENERATOR_PACKAGES turns this red.
  // The members are written out here (not read from the table) so that dropping one from the table fails.
  const LISTED_GENERATORS = { uuid: ["v1", "v4", "v6", "v7"], nanoid: ["nanoid"], ulid: ["ulid", "monotonicFactory"], "@paralleldrive/cuid2": ["createId"] };
  checks.push(["the generator table lists exactly the members the plants name", JSON.stringify(GENERATOR_PACKAGES) === JSON.stringify(LISTED_GENERATORS)]);
  for (const [pkg, members] of Object.entries(LISTED_GENERATORS)) {
    for (const m of members) {
      checks.push([`a generator member is flagged as a named import: ${pkg} ${m}`, flagged(`import { ${m} } from "${pkg}";\nexport const id = ${m}();`)]);
      checks.push([`a generator member is flagged through a namespace: ${pkg} ${m}`, flagged(`import * as ids from "${pkg}";\nexport const id = ids.${m}();`)]);
    }
  }
  checks.push(["a new Date on the line after a previous read keeps its own line", at("export const a = Date.now(), b =\nnew Date();") === "[1,2]"]);
  checks.push(["a destructure is attributed to the line its pattern starts on", at("const a = 1;\nconst {\n  now,\n} = Date;") === "[2]"]);
  checks.push(["a read in column 0 is not merged into the line above", at("const a = Date.now();\nDate.now();") === "[1,2]"]);
  checks.push(["a read after a multi-line type is attributed to its own line", at("type T = {\n  a: number;\n};\nconst t = Date.now();") === "[4]"]);
  checks.push(["a syntax error reports the line it is on", (scan("const a = 1;\nconst b = 2;\nlet x = ;\n").problems[0]?.line ?? 0) === 3]);
  checks.push(["lines are numbered by LF: a lone CR does not start a new line", at("const a = 1;\rconst b = 2;\nconst t = Date.now();") === "[2]"]);
  checks.push(["a clean file reports no masker problem", scan("const a = 1 / 2;\nconst s = `x${a}`;\n").problems.length === 0]);
  return checks;
}
