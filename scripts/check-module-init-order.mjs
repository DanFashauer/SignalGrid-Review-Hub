// Module-init-order gate — a `const` read before it is initialised.
//
// WHY THIS EXISTS. This defect appeared TWICE in one day, in unrelated files,
// and both times it was silent:
//
//   artifacts/api-server/src/middlewares/context.ts
//     `initEnterpriseAuth()` was CALLED at module load (line 53) and read
//     `const defaultJwksFetch`, declared at line 74. Enterprise OIDC
//     authentication therefore never worked in production — every token failed
//     with "fetchImpl is not a function" while the log said "enabled".
//
//   scripts/src/signalgrid-grid-proof.ts
//     a top-level loop reached `validateScenarioInput`, which read
//     `allowedSignalTypes` declared ~650 lines below. The enum guard never ran;
//     it threw, and a fail-open catch recorded the crash as a pass.
//
// The mechanism is always the same and always quiet: `function` declarations
// hoist, `const` declarations do not. A hoisted function called during module
// evaluation can therefore reach a `const` that is still in its temporal dead
// zone. Under a bundler the read can surface as `undefined` rather than a
// ReferenceError, which is what makes it silent rather than loud.
//
// Both instances lived in code no test executed, so nothing caught them. Two
// occurrences is this repository's threshold for a gate rather than a habit.
//
// WHAT IS DETECTED. A read of a module-scope `const`/`let`/`class` binding that
// happens while the module is still evaluating and BEFORE that binding's
// declaration has run — either directly in module-load code, or TRANSITIVELY
// through calls to functions declared in the same file. That is the exact shape
// of both defects.
//
// HOW (2026-09-30, plan row 40b). The TypeScript compiler API, not text. Every
// file is parsed, and every identifier is resolved to its declaration by the
// type checker, so a local that SHADOWS a module-scope name is a different
// symbol and never matches. "Module-load code" is computed from the syntax tree:
// every top-level statement runs (including the body of a top-level `for`/`if`/
// `try` — the grid-proof shape the column-0 regex could not reach), a class's
// `extends` clause, static initialisers and static blocks run, an IIFE runs, and
// a callback handed to a synchronous array iterator (`forEach`, `map`, …) runs.
// Every OTHER function body does not run until something calls it — an Express
// route handler or an event listener defined at module scope is not executed at
// load, and treating it as such is how the regex widening produced 75 false
// positives. A call from load-time code to a function declared in this file (or
// to a `const f = () => …` declared ABOVE the call) is followed into that body,
// transitively, with the same rules.
//
// Followed from load-time code (2026-09-30, after two brain reviews of #1274):
// calls to same-file functions at any nesting depth, `const` aliases of them
// (`const g = f; g()`), `f.call`/`f.apply` on a named function or a function
// written in place, tagged-template tags, default parameters and binding-pattern
// defaults (top-level, for-of, and destructured parameters), `new C()` and
// `new (class { … })()` — instance field initialisers, the constructor, and an
// `extends` base's constructor — and callbacks that run before their call
// returns: sync array iterators, `Array.from`, `Object.groupBy`/`Map.groupBy`,
// `str.replace(re, fn)`, and a `new Promise` executor.
//
// Round 3 (review of f52e806f): a callee behind a type-only wrapper (`make!()`,
// `(make as any)()`, `(make satisfies X)()`, `(<any>make)()`, `new (E as any)()`),
// a comma sequence (`(0, make)()`) or a conditional (`(c ? f : g)()`, both
// branches, nested either way) is followed — as a callee, a tag, a `.call`/
// `.apply` target, an `extends` base, and a synchronous iterator's callback.
// Calling a generator runs its parameter defaults, not its body. Every file is
// forced to module scope — an import-less file used to share one global scope
// with its twins, and all but the first went silently unanalysed.
//
// SCOPE LIMIT, stated rather than pretended away. This follows calls within ONE
// file; it does not follow calls through imports, method calls on objects
// (`obj.run()`), getters, `f.bind(…)()`, a function reached through an object
// or array (`handlers[0]()`), a callee behind `||`/`??`/`&&`, an assignment
// callee (`(x = f)()`), `Reflect.apply(f, …)`, an alias whose initializer is a
// conditional or comma (`const h = c ? f : g; h()` — only a plain or cast
// identifier alias is followed), a decorator (standard or legacy — neither is
// walked), an alias chain deeper than 6 hops, or a callback passed to a
// function other than the synchronous ones listed above; and it treats every
// branch as taken. `var` is not a TDZ binding and is not checked. A clean run
// therefore means none of the FOLLOWED shapes reads a binding early — it is not
// proof that no TDZ read exists at module load. A file the Program does not load, or that
// does not parse, is reported as a problem, never counted clean.
//
// SELF-TEST: both real defects must be detected from synthetic reconstructions —
// the grid-proof one in its REAL top-level-loop shape — the CORRECTED order must
// pass, and the shapes that fooled the regex widening (route handlers, shadowed
// locals, functions only called from functions) must pass. The round-3 shapes
// and the six branches the #1274 review found unpinned each have a row that
// fails when that branch is removed — the mutants run are listed in PR #1329,
// and only those are claimed. A failing row prints the findings it saw. A gate
// that cannot fail proves nothing.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// ROOTS are resolved against THIS SCRIPT's repo, not process.cwd(). Walking
// relative to the cwd meant a run from anywhere but the repo root reached zero
// files and passed — the vacuity this gate exists to prevent, in the gate itself.
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOTS = ["lib", "artifacts", "scripts"];
// A scanned-file floor, the same control as check-nan-fail-open.mjs (FILE_FLOOR
// 200): a walk that reaches almost nothing is broken, not a clean tree.
const FILE_FLOOR = 200;
const SKIP = /(^|\/)(node_modules|dist|build|coverage|third_party)(\/|$)|\.d\.ts$/;
const SOURCE = /\.(ts|tsx|mts|cts|mjs|cjs|js|jsx)$/;

// Array methods that invoke their callback synchronously, before returning. A
// callback handed to anything else (a router, an emitter, a timer, a promise) is
// assumed NOT to run during module evaluation.
const SYNC_ITERATORS = new Set([
  "forEach", "map", "filter", "some", "every", "find", "findIndex", "findLast", "findLastIndex",
  "reduce", "reduceRight", "flatMap", "sort", "toSorted", "replace", "replaceAll",
]);

const isFunctionLike = (n) =>
  ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) ||
  ts.isMethodDeclaration(n) || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n) ||
  ts.isConstructorDeclaration(n);
// Wrappers that change nothing about WHAT runs: parentheses and the
// type-only `x!`, `x as T`, `x satisfies T`, `<T>x`.
const unparen = (n) => {
  while (n && (ts.isParenthesizedExpression(n) || ts.isNonNullExpression(n) || ts.isAsExpression(n) ||
    ts.isSatisfiesExpression(n) || ts.isTypeAssertionExpression(n))) n = n.expression;
  return n;
};
// What a callee expression can evaluate to: `(0, f)` is f, and `c ? f : g` is
// either — both are followed, as every branch is.
const calleeTargets = (n) => {
  n = unparen(n);
  if (!n) return [];
  if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.CommaToken) return calleeTargets(n.right);
  if (ts.isConditionalExpression(n)) return [...calleeTargets(n.whenTrue), ...calleeTargets(n.whenFalse)];
  return [n];
};
const hasModifier = (n, kind) => (ts.canHaveModifiers(n) ? ts.getModifiers(n) ?? [] : []).some((m) => m.kind === kind);

/**
 * Analyse many files at once: one Program, so each file's identifiers are
 * resolved by the real checker. `sources` maps a file name to its text.
 * Returns Map<fileName, finding[]>.
 */
function analyseFiles(sources) {
  const options = {
    allowJs: true, noResolve: true, noLib: true, types: [], noEmit: true,
    target: ts.ScriptTarget.Latest, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve,
    // Every file is its own module scope. Without this an import-less (script-
    // mode) file shares ONE global scope with every other such file, a second
    // file's same-named `const` resolves to the first file's declaration, and
    // that file is silently unanalysed.
    moduleDetection: ts.ModuleDetectionKind.Force,
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, lang, ...rest) =>
    sources.has(name) ? ts.createSourceFile(name, sources.get(name), lang, true) : getSourceFile(name, lang, ...rest);
  host.fileExists = (name) => sources.has(name);
  host.readFile = (name) => sources.get(name);
  const program = ts.createProgram([...sources.keys()], options, host);
  const checker = program.getTypeChecker();
  const out = new Map();
  for (const name of sources.keys()) {
    const sf = program.getSourceFile(name);
    // FAIL CLOSED: a file the Program did not load, or one that does not parse,
    // was not analysed — that is an error to report, never a clean file.
    if (!sf) { out.set(name, [{ error: "the TypeScript Program did not load this file — not analysed" }]); continue; }
    const syntax = program.getSyntacticDiagnostics(sf);
    if (syntax.length > 0) {
      const d = syntax[0];
      const line = d.start !== undefined ? sf.getLineAndCharacterOfPosition(d.start).line + 1 : 0;
      out.set(name, [{ error: `does not parse (line ${line}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}) — not analysed` }]);
      continue;
    }
    out.set(name, analyseSourceFile(sf, checker));
  }
  return out;
}

function analyseSourceFile(sf, checker) {
  // Module-scope TDZ bindings: declaration node -> { name, initEnd }. A binding is
  // initialised when its own declarator (or class declaration) finishes.
  const tdz = new Map();
  for (const st of sf.statements) {
    if (ts.isVariableStatement(st) && (st.declarationList.flags & ts.NodeFlags.BlockScoped)) {
      for (const d of st.declarationList.declarations) {
        const names = [];
        const collect = (b) => {
          if (ts.isIdentifier(b)) names.push(b);
          else for (const el of b.elements) if (!ts.isOmittedExpression(el)) collect(el.name);
        };
        collect(d.name);
        for (const id of names) {
          if (ts.isIdentifier(d.name)) { tdz.set(d, { name: id.text, initEnd: d.end }); continue; }
          // A destructured binding is initialised left to right, once the
          // initializer has run: a read inside the initializer is early, and so
          // is a default that reads a LATER element — but `const { a, b = a }`
          // is fine, so each element's own end is its initialisation point.
          const init = d.initializer ? [d.initializer.pos, d.initializer.end] : null;
          tdz.set(id.parent, { name: id.text, initEnd: id.parent.end, initRange: init });
        }
      }
    } else if (ts.isClassDeclaration(st) && st.name) {
      tdz.set(st, { name: st.name.text, initEnd: st.end });
    }
  }
  if (tdz.size === 0) return [];

  const resolveDecls = (id) => {
    let sym;
    if (ts.isShorthandPropertyAssignment(id.parent) && id.parent.name === id) sym = checker.getShorthandAssignmentValueSymbol(id.parent);
    else sym = checker.getSymbolAtLocation(id);
    return sym?.declarations ?? [];
  };
  const tdzOf = (id) => { for (const d of resolveDecls(id)) { const b = tdz.get(d); if (b) return b; } return undefined; };
  const isModuleScope = (decl) => {
    const st = ts.isVariableDeclaration(decl) ? decl.parent?.parent : decl;
    return st?.parent === sf;
  };
  // What running a callee EXECUTES, resolved through the checker to any
  // declaration in THIS file — module-scope or nested. Returns
  // { key, name, run(ctx), declPos } or undefined. `declPos` is the position a
  // module-scope `const` callee is initialised at (a call before it is itself a
  // TDZ read, reported by the identifier check, and its body cannot run); -1
  // for hoisted or nested callees.
  // Calling a function runs its parameter defaults — including defaults inside
  // a destructured parameter (`function f({ a = X }) {}`) — and then its body.
  // A generator's body waits for the first `next()`; only its defaults run.
  const fnRunner = (fn) => (ctx) => {
    for (const p of fn.parameters) { walkPattern(p.name, ctx); walk(p.initializer, ctx); }
    if (!fn.asteriskToken) walk(fn.body, ctx);
  };
  // `new C()`: instance field initialisers and the constructor run; an
  // `extends` base's constructor runs through `super()`.
  const classRunner = (cls) => (ctx) => {
    for (const h of cls.heritageClauses ?? []) {
      if (h.token !== ts.SyntaxKind.ExtendsKeyword) continue;
      for (const t of h.types) for (const e of calleeTargets(t.expression)) if (ts.isIdentifier(e)) follow(e, ctx);
    }
    for (const m of cls.members) {
      if (ts.isPropertyDeclaration(m) && !hasModifier(m, ts.SyntaxKind.StaticKeyword)) walk(m.initializer, ctx);
      if (ts.isConstructorDeclaration(m) && m.body) fnRunner(m)(ctx);
    }
  };
  // Defaults and computed keys inside a binding pattern run when it binds.
  const walkPattern = (b, ctx) => {
    if (!b || ts.isIdentifier(b)) return;
    for (const el of b.elements) {
      if (ts.isOmittedExpression(el)) continue;
      if (el.propertyName && ts.isComputedPropertyName(el.propertyName)) walk(el.propertyName.expression, ctx);
      walk(el.initializer, ctx);
      walkPattern(el.name, ctx);
    }
  };
  const callableOfDecl = (decl, depth = 0) => {
    if (!decl || decl.getSourceFile() !== sf || depth > 6) return undefined;
    if (ts.isFunctionDeclaration(decl) && decl.body) {
      return { key: decl, name: decl.name?.text ?? "(function)", run: fnRunner(decl), declPos: -1 };
    }
    if (ts.isClassDeclaration(decl) || ts.isClassExpression(decl)) {
      return { key: decl, name: decl.name?.text ?? "(class)", declPos: -1, run: classRunner(decl) };
    }
    if (ts.isVariableDeclaration(decl) && decl.initializer) {
      const init = unparen(decl.initializer);
      const declPos = isModuleScope(decl) ? decl.pos : -1;
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
        return { key: decl, name: ts.isIdentifier(decl.name) ? decl.name.text : "(function)", run: fnRunner(init), declPos };
      }
      if (ts.isClassExpression(init)) return { ...callableOfDecl(init, depth + 1), key: decl, declPos };
      if (ts.isIdentifier(init)) {
        // alias: `const g = f; g()` runs f.
        for (const d of resolveDecls(init)) {
          const c = callableOfDecl(d, depth + 1);
          if (c) return { ...c, key: decl, declPos: Math.max(declPos, c.declPos) };
        }
      }
    }
    return undefined;
  };
  const callableOf = (id) => { for (const d of resolveDecls(id)) { const c = callableOfDecl(d); if (c) return c; } return undefined; };

  const findings = [];
  const seen = new Set();
  const report = (entryNode, entryName, via, binding) => {
    const line = sf.getLineAndCharacterOfPosition(entryNode.getStart(sf)).line + 1;
    const key = `${line}:${via}:${binding.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    const constLine = sf.getLineAndCharacterOfPosition(binding.initEnd).line + 1;
    findings.push({ call: entryName, callLine: line, via, constName: binding.name, constLine });
  };

  // `Array.from(x, fn)` / `Uint8Array.from(x, fn)` call fn synchronously too.
  const isSyncIterator = (callee) => callee && ts.isPropertyAccessExpression(callee) &&
    (SYNC_ITERATORS.has(callee.name.text) || (callee.name.text === "groupBy" && ts.isIdentifier(callee.expression)) ||
      (callee.name.text === "from" && ts.isIdentifier(callee.expression) && /Array$/.test(callee.expression.text)));

  // Walk code that EXECUTES. `at` is the source position of the module-load
  // point this execution hangs off (the top-level call site); `entry` names it.
  // `visited` stops recursion through mutually-calling functions per entry.
  const walk = (node, ctx) => {
    if (!node) return;
    if (ts.isTypeNode(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) ||
        ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isFunctionDeclaration(node)) return; // hoisted, runs only when called
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) { walkClass(node, ctx); return; }
    if (isFunctionLike(node)) return; // defined here, run only when called
    if (ts.isVariableDeclaration(node)) { walk(node.initializer, ctx); walkPattern(node.name, ctx); return; }
    if (ts.isTaggedTemplateExpression(node)) {
      walk(node.tag, ctx);
      walk(node.template, ctx);
      for (const tag of calleeTargets(node.tag)) if (ts.isIdentifier(tag)) follow(tag, ctx); // the tag function runs now
      return;
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = unparen(node.expression);
      // Evaluating the callee expression: a function written in place is only
      // defined here; a class expression's statics run; `(0, f)` runs its `0`.
      walk(node.expression, ctx);
      for (const target of calleeTargets(node.expression)) {
        // IIFE (called or `new`-ed): the function body runs now.
        if (ts.isArrowFunction(target) || ts.isFunctionExpression(target)) fnRunner(target)(ctx);
        // `new (class { … })()` / `new class { … }()`: statics ran above, as part of
        // evaluating the class; the constructor and instance fields run now.
        else if (ts.isNewExpression(node) && ts.isClassExpression(target)) classRunner(target)(ctx);
        else if (ts.isIdentifier(target)) follow(target, ctx);
      }
      // A callback that runs before the call returns: sync array iterators,
      // `Array.from`, `Object.groupBy`/`Map.groupBy`, `str.replace(re, fn)`, and a
      // `new Promise(executor)` executor.
      const sync = isSyncIterator(callee) ||
        (ts.isNewExpression(node) && callee && ts.isIdentifier(callee) && callee.text === "Promise");
      for (const arg of node.arguments ?? []) {
        walk(arg, ctx);
        if (!sync) continue;
        for (const a of calleeTargets(arg)) {
          if (ts.isArrowFunction(a) || ts.isFunctionExpression(a)) fnRunner(a)(ctx);
          else if (ts.isIdentifier(a)) follow(a, ctx);
        }
      }
      // `f.call(…)` / `f.apply(…)` run f — a named function, or a function
      // expression written in place: `(function () { … }).call(null)`.
      if (callee && ts.isPropertyAccessExpression(callee) && (callee.name.text === "call" || callee.name.text === "apply")) {
        for (const target of calleeTargets(callee.expression)) {
          if (ts.isIdentifier(target)) follow(target, ctx);
          else if (ts.isArrowFunction(target) || ts.isFunctionExpression(target)) fnRunner(target)(ctx);
        }
      }
      return;
    }
    if (ts.isIdentifier(node)) {
      const b = tdzOf(node);
      const early = b && (b.initEnd > ctx.at || (b.initRange && ctx.at >= b.initRange[0] && ctx.at < b.initRange[1]));
      if (early) report(ctx.entryNode, ctx.entry, ctx.via ?? node.text, b);
      return;
    }
    ts.forEachChild(node, (c) => walk(c, ctx));
  };
  const walkClass = (cls, ctx) => {
    for (const h of cls.heritageClauses ?? []) for (const t of h.types) walk(t.expression, ctx);
    for (const m of cls.members) {
      if (m.name && ts.isComputedPropertyName(m.name)) walk(m.name.expression, ctx);
      if (ts.isClassStaticBlockDeclaration(m)) walk(m.body, ctx);
      else if (ts.isPropertyDeclaration(m) && hasModifier(m, ts.SyntaxKind.StaticKeyword)) walk(m.initializer, ctx);
    }
  };
  // Enter a same-file callee, as if it runs at ctx.at.
  const follow = (id, ctx) => {
    const c = callableOf(id);
    if (!c || ctx.visited.has(c.key)) return;
    if (c.declPos >= 0 && c.declPos > ctx.at) return;
    ctx.visited.add(c.key);
    c.run({ ...ctx, entry: ctx.entry ?? id.text, via: c.name });
  };

  for (const st of sf.statements) {
    const walkTop = (node, entryNode) => walk(node, { at: node.pos, entry: undefined, entryNode, via: undefined, visited: new Set() });
    // Each top-level statement is its own module-load point. Walking per call
    // keeps `at` precise for statements that contain several calls.
    // Defaults inside a top-level binding pattern run at load: `const { a = X } = {}`.
    const visitTopPattern = (b) => {
      if (!b || ts.isIdentifier(b)) return;
      for (const el of b.elements) {
        if (ts.isOmittedExpression(el)) continue;
        if (el.propertyName && ts.isComputedPropertyName(el.propertyName)) visitTop(el.propertyName.expression);
        visitTop(el.initializer);
        visitTopPattern(el.name);
      }
    };
    const visitTop = (node) => {
      if (!node) return;
      if (ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isTaggedTemplateExpression(node)) {
        const callee = unparen(ts.isTaggedTemplateExpression(node) ? node.tag : node.expression);
        const ctx = { at: node.pos, entry: callee && ts.isIdentifier(callee) ? callee.text : "(call)", entryNode: node, via: undefined, visited: new Set() };
        walk(node, ctx);
        return;
      }
      if (ts.isIdentifier(node)) { walkTop(node, node); return; }
      if (ts.isTypeNode(node) || ts.isFunctionDeclaration(node) || ts.isImportDeclaration(node) || ts.isExportDeclaration(node) ||
          ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return;
      if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
        walkClass(node, { at: node.pos, entry: undefined, entryNode: node, via: undefined, visited: new Set() });
        return;
      }
      if (isFunctionLike(node)) return;
      if (ts.isVariableDeclaration(node)) { visitTop(node.initializer); visitTopPattern(node.name); return; }
      ts.forEachChild(node, visitTop);
    };
    visitTop(st);
  }
  return findings.map((f) => ({ ...f, call: f.call ?? f.via }));
}

/** One finding as text — the CLI and a failing self-test print the same line. */
const describe = (f, d) => d.error
  ? `${f}: ${d.error}. An unanalysed file is not a clean file.`
  : `${f}:${d.callLine}: \`${d.call}\` runs at module load and reads \`${d.constName}\` (via \`${d.via}\`), declared at line ${d.constLine}.`;

/** Single-file convenience for the self-test. */
function analyse(text, name = "fixture.ts") {
  return analyseFiles(new Map([[name, text]])).get(name);
}

// ── self-test: both real defects, their corrected forms, and the shapes that
// fooled the regex widening ────────────────────────────────────────────────
const L = (...lines) => lines.join("\n");
const SELF_TEST = [
  // [label, source, expected]: `true`/`false` = any finding or none; an array =
  // exactly these const names are reported (pins WHICH read, not just whether).
  ["OIDC defect (column-0 call, const 4 lines below)", L(
    "const enterpriseAuth = initEnterpriseAuth();",
    "function initEnterpriseAuth() {",
    "  return createAuthenticator(config, defaultJwksFetch);",
    "}",
    "const defaultJwksFetch = (uri) => fetch(uri);",
  ), true],
  ["OIDC fixed (declaration above the call)", L(
    "const defaultJwksFetch = (uri) => fetch(uri);",
    "const enterpriseAuth = initEnterpriseAuth();",
    "function initEnterpriseAuth() {",
    "  return createAuthenticator(config, defaultJwksFetch);",
    "}",
  ), false],
  // The REAL grid-proof shape (scripts/src/signalgrid-grid-proof.ts): a call
  // INDENTED inside a top-level `for` loop, two hops from the const. The
  // column-0 regex returned 0 findings here.
  ["grid-proof defect (top-level for loop, two hops)", L(
    "const inputs = [{ type: 'a' }];",
    "for (const input of inputs) {",
    "  const r = safeMalformedRun(input);",
    "  if (!r) console.log('fail');",
    "}",
    "function safeMalformedRun(x) {",
    "  try { return validateScenarioInput(x); } catch { return true; }",
    "}",
    "function validateScenarioInput(x) {",
    "  if (!allowedSignalTypes.has(x.type)) throw new Error('bad');",
    "}",
    "const allowedSignalTypes = new Set(['a']);",
  ), true],
  ["grid-proof fixed (const hoisted above the loop)", L(
    "const allowedSignalTypes = new Set(['a']);",
    "const inputs = [{ type: 'a' }];",
    "for (const input of inputs) {",
    "  safeMalformedRun(input);",
    "}",
    "function safeMalformedRun(x) { return validateScenarioInput(x); }",
    "function validateScenarioInput(x) {",
    "  if (!allowedSignalTypes.has(x.type)) throw new Error('bad');",
    "}",
  ), false],
  ["sync-iterator callback at load (forEach → hoisted fn)", L(
    "[1, 2].forEach((n) => check(n));",
    "function check(n) { return LIMIT > n; }",
    "const LIMIT = 3;",
  ), true],
  ["hoisted function passed by name to map at load", L(
    "export const out = [1].map(check);",
    "function check(n) { return LIMIT > n; }",
    "const LIMIT = 3;",
  ), true],
  ["class static initialiser at load", L(
    "class A { static x = make(); }",
    "function make() { return SEED; }",
    "const SEED = 1;",
  ), true],
  ["IIFE at load", L(
    "(() => { boot(); })();",
    "function boot() { return CONFIG.x; }",
    "const CONFIG = { x: 1 };",
  ), true],
  ["later class instantiated at load", L(
    "const inst = build();",
    "function build() { return new Engine(); }",
    "class Engine {}",
  ), true],
  // Brain review of #1274: shapes the first compiler-API version still missed.
  ["constructor run by `new` at load", L(
    "class E { constructor() { this.v = LIMIT; } }",
    "new E();",
    "const LIMIT = 1;",
  ), true],
  ["instance field initialiser run by `new` at load", L(
    "class E { v = LIMIT; }",
    "export const e = new E();",
    "const LIMIT = 1;",
  ), true],
  ["default parameter of a called function", L(
    "f();",
    "function f(x = LIMIT) { return x; }",
    "const LIMIT = 1;",
  ), true],
  ["tagged-template tag at load", L(
    "export const q = tag`x`;",
    "function tag(s) { return LIMIT; }",
    "const LIMIT = 1;",
  ), true],
  ["nested function called inside a called function", L(
    "outer();",
    "function outer() { function inner() { return LIMIT; } return inner(); }",
    "const LIMIT = 1;",
  ), true],
  ["f.call at load", L(
    "f.call(null);",
    "function f() { return LIMIT; }",
    "const LIMIT = 1;",
  ), true],
  ["Array.from mapper at load", L(
    "export const xs = Array.from({ length: 2 }, f);",
    "function f() { return LIMIT; }",
    "const LIMIT = 1;",
  ), true],
  ["alias of a hoisted function called at load", L(
    "const g = f;",
    "g();",
    "function f() { return LIMIT; }",
    "const LIMIT = 1;",
  ), true],
  ["unparseable file fails closed (reported, never clean)", L(
    "const x = ;",
    "function (",
  ), true],
  // Brain review round 2 (710d8ed9): shapes still missed.
  ["binding-pattern default at load", L("const { a = LIM } = {};", "const LIM = 1;"), true],
  ["binding-pattern default in a top-level for-of", L("for (const { a = LIM } of [{}]) {}", "const LIM = 1;"), true],
  ["destructured-parameter default of a called function", L("function f({ a = LIM }) {}", "f({});", "const LIM = 1;"), true],
  ["destructuring that reads itself in its initializer", L("const { a } = a;"), true],
  ["function expression run through .call", L("(function () { return LIM; }).call(null);", "const LIM = 1;"), true],
  ["arrow run through .apply", L("(() => LIM).apply(null);", "const LIM = 1;"), true],
  ["constructor of `new (class { … })()`", L("new (class { constructor() { LIM; } })();", "const LIM = 1;"), true],
  ["instance field of `new class { … }()`", L("new class { v = LIM; }();", "const LIM = 1;"), true],
  ["`new Promise` executor", L("new Promise(() => LIM);", "const LIM = 1;"), true],
  ["`str.replace` callback", L("'a'.replace(/a/, () => LIM);", "const LIM = 1;"), true],
  ["`Object.groupBy` callback", L("Object.groupBy([1], () => LIM);", "const LIM = 1;"), true],
  ["`extends` base constructor run by `new`", L(
    "class B { constructor() { LIM; } }",
    "class D extends B {}",
    "new D();",
    "const LIM = 1;",
  ), true],
  ["pattern default reading an EARLIER element of the same pattern", L("const { a, b = a } = { a: 1 };", "export { b };"), false],
  ["pattern default reading a binding declared above", L("const LIM = 1;", "const { a = LIM } = {};"), false],
  ["`.then` callback (runs after load)", L("Promise.resolve().then(() => LIM);", "const LIM = 1;"), false],
  ["nested function defined but never called", L(
    "outer();",
    "function outer() { function inner() { return LIMIT; } return inner; }",
    "const LIMIT = 1;",
  ), false],
  ["`new` does not run instance methods", L(
    "class E { get() { return LIMIT; } }",
    "export const e = new E();",
    "const LIMIT = 1;",
  ), false],
  // Brain review round 3 (f52e806f): callees behind a type-only or comma/conditional
  // wrapper, and six load-bearing branches that survived mutation at 41/41.
  ["non-null callee `make!()`", L("make!();", "function make() { return LIM; }", "const LIM = 1;"), true],
  ["`as` callee `(make as any)()`", L("(make as any)();", "function make() { return LIM; }", "const LIM = 1;"), true],
  ["`satisfies` callee", L("(make satisfies Function)();", "function make() { return LIM; }", "const LIM = 1;"), true],
  ["type-assertion callee `(<any>make)()`", L("(<any>make)();", "function make() { return LIM; }", "const LIM = 1;"), true],
  ["`new (E as any)()`", L("class E { constructor() { LIM; } }", "new (E as any)();", "const LIM = 1;"), true],
  ["comma-sequence callee `(0, make)()`", L("(0, make)();", "function make() { return LIM; }", "const LIM = 1;"), true],
  ["conditional callee, either branch", L("(Math.random() ? ok : make)();", "function ok() {}", "function make() { return LIM; }", "const LIM = 1;"), true],
  // Review of 7da6116d: each calleeTargets branch pinned from BOTH sides and on
  // every path that uses it (tag, .call/.apply, extends, sync-iterator argument).
  ["conditional callee, TRUE branch", L("(Math.random() ? make : ok)();", "function ok() {}", "function make() { return LIM; }", "const LIM = 1;"), true],
  ["comma inside a conditional", L("(Math.random() ? (0, make) : ok)();", "function ok() {}", "function make() { return LIM; }", "const LIM = 1;"), true],
  ["conditional inside a comma", L("(0, (Math.random() ? ok : make))();", "function ok() {}", "function make() { return LIM; }", "const LIM = 1;"), true],
  ["cast inside a conditional", L("(Math.random() ? (make as any) : ok)();", "function ok() {}", "function make() { return LIM; }", "const LIM = 1;"), true],
  ["comma tag of a tagged template", L("(0, tag)`x`;", "function tag() { return LIM; }", "const LIM = 1;"), true],
  ["conditional target of .call", L("(Math.random() ? make : ok).call(null);", "function ok() {}", "function make() { return LIM; }", "const LIM = 1;"), true],
  ["conditional `extends` base run by `new`", L("class B { constructor() { LIM; } }", "class A extends (Math.random() ? B : Object) {}", "new A();", "const LIM = 1;"), true],
  ["comma `extends` base run by `new`", L("class B { constructor() { LIM; } }", "class A extends (0, B) {}", "new A();", "const LIM = 1;"), true],
  ["conditional sync-iterator callback", L("[1].forEach(Math.random() ? ok : make);", "function ok() {}", "function make() { return LIM; }", "const LIM = 1;"), true],
  ["generator call runs defaults, not the body", L("export const it = gen();", "function* gen() { yield LIM; }", "const LIM = 1;"), false],
  ["generator call runs its parameter defaults", L("export const it = gen();", "function* gen(x = LIM) { yield x; }", "const LIM = 1;"), true],
  ["`as` tag of a tagged template", L("(tag as any)`x`;", "function tag() { return LIM; }", "const LIM = 1;"), true],
  ["pattern default inside a followed function", L("f();", "function f() { const { a = LIM } = {}; return a; }", "const LIM = 1;"), true],
  ["class static block at load", L("class A { static { LIM; } }", "const LIM = 1;"), true],
  ["computed class member key at load", L("class A { [LIM]() {} }", "const LIM = 'k';"), true],
  ["shorthand property at load", L("export const o = { LIM };", "const LIM = 1;"), true],
  // The call of a later `const` callee is the TDZ read; its body cannot run, so a
  // read inside it is NOT a second finding.
  ["later `const` callee: the call is reported, its body is not entered", L("g();", "const g = () => LIM;", "const LIM = 1;"), ["g"]],
  // The shapes that produced the regex widening's 75 false positives — each is
  // correct code and must pass.
  ["route handler at module scope (runs later, not at load)", L(
    "const router = makeRouter();",
    "router.get('/', (req, res) => res.json(handle(req)));",
    "function handle(r) { return LIMIT; }",
    "function makeRouter() { return { get() {} }; }",
    "const LIMIT = 3;",
  ), false],
  ["function called only from another function", L(
    "export function api() { return inner(); }",
    "function inner() { return LIMIT; }",
    "const LIMIT = 3;",
  ), false],
  ["local that shadows a later module const", L(
    "for (const x of [1]) { useIt(x); }",
    "function useIt(x) { const LIMIT = 9; return LIMIT + x; }",
    "const LIMIT = 3;",
  ), false],
  ["type-only reference to a later class", L(
    "function mk(): Engine | null { return null; }",
    "const e: Engine | null = mk();",
    "class Engine {}",
  ), false],
  ["main() called at the bottom", L(
    "const LIMIT = 3;",
    "function main() { return LIMIT; }",
    "main();",
  ), false],
  ["timer callback (deferred, not at load)", L(
    "setTimeout(() => tick(), 10);",
    "function tick() { return LIMIT; }",
    "const LIMIT = 3;",
  ), false],
];
{
  const failures = [];
  // Every finding the self-test did not expect is printed with its line — a
  // label alone does not say what the detector saw.
  const shown = (name, got) => got.map((d) => `\n      ${describe(name, d)}`).join("");
  for (const [label, src, expected] of SELF_TEST) {
    const got = analyse(src);
    if (Array.isArray(expected)) {
      const names = [...new Set(got.map((d) => d.constName ?? "(error)"))].sort().join(",");
      if (names !== [...expected].sort().join(",")) failures.push(`WRONG FINDINGS (want ${expected.join(",")}): ${label}${shown("fixture.ts", got)}`);
    } else if ((got.length > 0) !== expected) {
      failures.push(`${expected ? "MISSED" : "FALSE POSITIVE"}: ${label}${shown("fixture.ts", got)}`);
    }
  }
  // Each file is its own module: two import-less files declaring the same const
  // must BOTH be analysed, not collapsed into one global scope.
  const script = L("const { a = LIM } = {};", "const LIM = 1;");
  const pair = analyseFiles(new Map([["/self-test/a.ts", script], ["/self-test/b.ts", script]]));
  for (const [name, got] of pair) {
    if (!got.some((d) => d.constName === "LIM")) failures.push(`MISSED: script-mode ${name} shares a scope with its twin and went unanalysed`);
  }
  // Every extension the walk collects must be loaded AND analysed by the Program,
  // and the walk must collect every extension the Program accepts.
  for (const ext of ["ts", "tsx", "mts", "cts", "mjs", "cjs", "js", "jsx"]) {
    const name = `/self-test/x.${ext}`;
    if (!SOURCE.test(name)) failures.push(`NOT WALKED: .${ext} files are never collected`);
    const got = analyseFiles(new Map([[name, "f();\nfunction f() { return LIM; }\nconst LIM = 1;"]])).get(name);
    if (!got?.some((d) => d.constName === "LIM")) failures.push(`MISSED: the defect in a .${ext} file${shown(name, got ?? [])}`);
  }
  if (SKIP.test("lib/x.d.ts") !== true) failures.push("WALKED: .d.ts declarations are collected");
  // FAIL CLOSED: a root the Program cannot load (an unsupported extension) must
  // come back as an error, never as an empty — clean — result.
  const unloaded = analyseFiles(new Map([["/self-test/fixture.txt", "const a = 1;"]])).get("/self-test/fixture.txt");
  if (!unloaded?.some((d) => d.error)) failures.push("FAIL-OPEN: a file the Program did not load came back clean");
  // PLANT into the REAL file the regex could not reach: move grid-proof's
  // `allowedSignalTypes` below everything, and the gate must fire on the
  // top-level loop; the unmutated file must stay clean.
  const GRID = join(repo, "scripts", "src", "signalgrid-grid-proof.ts");
  let grid = null;
  try { grid = readFileSync(GRID, "utf8"); } catch { /* reported below */ }
  const at = grid ? grid.indexOf("const allowedSignalTypes") : -1;
  const end = at >= 0 ? grid.indexOf("]);", at) + 3 : -1;
  if (at < 0 || end < 3) {
    failures.push("PLANT ANCHOR MISSING: `const allowedSignalTypes … ]);` not found in scripts/src/signalgrid-grid-proof.ts");
  } else {
    const real = analyse(grid, "grid.ts");
    if (real.length !== 0) failures.push(`FINDING IN the real, unmutated signalgrid-grid-proof.ts (a reintroduced defect, or a false positive)${shown("scripts/src/signalgrid-grid-proof.ts", real)}`);
    const planted = `${grid.slice(0, at)}${grid.slice(end)}\n${grid.slice(at, end)}\n`;
    const got = analyse(planted, "grid.ts");
    if (!got.some((d) => d.constName === "allowedSignalTypes")) {
      failures.push(`MISSED: real signalgrid-grid-proof.ts with allowedSignalTypes moved below its top-level loop${shown("(planted) signalgrid-grid-proof.ts", got)}`);
    }
  }
  if (failures.length > 0) {
    console.error(
      "✗ SELF-TEST FAILED — the detector no longer recognises the defects it was written for, " +
        "or now flags correct code. A gate that cannot fail proves nothing; one that punishes the fix is worse.\n  " +
        failures.join("\n  "),
    );
    process.exit(1);
  }
  if (process.argv.includes("--self-test")) {
    console.log(`module-init-order self-test: ${SELF_TEST.length}/${SELF_TEST.length} cases as expected, plus the not-loaded fail-closed check, the script-mode twin check, the extension check and the real grid-proof plant.`);
    process.exit(0);
  }
}

const files = [];
const walk = (abs, rel) => {
  for (const e of readdirSync(abs)) {
    const p = join(abs, e);
    const r = rel ? `${rel}/${e}` : e;
    if (SKIP.test(r)) continue;
    if (statSync(p).isDirectory()) walk(p, r);
    else if (SOURCE.test(r)) files.push(r);
  }
};
for (const root of ROOTS) { try { walk(join(repo, root), root); } catch { /* absent root */ } }

if (files.length < FILE_FLOOR) {
  console.error(
    `✗ Only ${files.length} source files scanned (floor ${FILE_FLOOR}) — the walk is not reaching ` +
      "the tree it is supposed to cover (ROOTS are resolved against the script's own repo, so this is a real break).",
  );
  process.exit(1);
}

console.log("Module init order — a const read before it is initialised\n");
let problems = 0;
const sources = new Map();
for (const f of files) {
  sources.set(join(repo, f), readFileSync(join(repo, f), "utf8"));
}
const results = analyseFiles(sources);
for (const f of files) {
  const got = results.get(join(repo, f));
  for (const d of got ?? [{ error: "no analysis result — not analysed" }]) {
    if (d.error) {
      console.error(`  ✗ ${describe(f, d)}`);
      problems += 1;
      continue;
    }
    console.error(
      `  ✗ ${describe(f, d)}\n` +
        "      `function` hoists, `const`/`let`/`class` do not — the read lands in the temporal dead zone and can\n" +
        "      surface as undefined rather than throwing. Move the declaration above the call.",
    );
    problems += 1;
  }
}

console.log(
  `\nmodule-init-order: ${files.length} source files scanned, ${problems} problem(s); self-test ${SELF_TEST.length}/${SELF_TEST.length} green. ` +
    "TypeScript-compiler scope analysis: module-load code (top-level loops included) followed through " +
    "same-file calls (through casts, comma and conditional callees), aliases, constructors, default params and tags. " +
    "Not followed: imports, method calls, " +
    "callbacks other than the listed synchronous ones. " +
    "See the SCOPE LIMIT note.",
);
if (problems > 0) {
  console.error("\nModule-init-order gate FAILED — this defect has shipped twice, both times silently.");
  process.exit(1);
}
console.log("Module-init-order gate passed — no module-scope call reads a const declared after it.");
