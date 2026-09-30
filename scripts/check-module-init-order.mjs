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
// Followed from load-time code (2026-09-30, after the brain's review of #1274):
// calls to same-file functions at any nesting depth, `const` aliases of them
// (`const g = f; g()`), `f.call`/`f.apply`, tagged-template tags, default
// parameters, and `new C()` — its instance field initialisers, its constructor,
// and an `extends` base's constructor.
//
// SCOPE LIMIT, stated rather than pretended away. This follows calls within ONE
// file; it does not follow calls through imports, method calls on objects
// (`obj.run()`), getters, `f.bind(…)()`, a function reached through an object
// or array (`handlers[0]()`), or a callback passed to a function other than the
// synchronous array iterators and `Array.from`; and it treats every branch as
// taken. `var` is not a TDZ binding and is not checked. A clean run therefore
// means none of the FOLLOWED shapes reads a binding early — it is not proof that
// no TDZ read exists at module load. A file the Program does not load, or that
// does not parse, is reported as a problem, never counted clean.
//
// SELF-TEST: both real defects must be detected from synthetic reconstructions —
// the grid-proof one in its REAL top-level-loop shape — the CORRECTED order must
// pass, and the shapes that fooled the regex widening (route handlers, shadowed
// locals, functions only called from functions) must pass. A gate that cannot
// fail proves nothing.
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
const SOURCE = /\.(ts|tsx|mts|mjs|js)$/;

// Array methods that invoke their callback synchronously, before returning. A
// callback handed to anything else (a router, an emitter, a timer, a promise) is
// assumed NOT to run during module evaluation.
const SYNC_ITERATORS = new Set([
  "forEach", "map", "filter", "some", "every", "find", "findIndex", "findLast", "findLastIndex",
  "reduce", "reduceRight", "flatMap", "sort", "toSorted",
]);

const isFunctionLike = (n) =>
  ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) ||
  ts.isMethodDeclaration(n) || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n) ||
  ts.isConstructorDeclaration(n);
const unparen = (n) => { while (n && ts.isParenthesizedExpression(n)) n = n.expression; return n; };
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
          const decl = ts.isIdentifier(d.name) ? d : id.parent;
          tdz.set(decl, { name: id.text, initEnd: d.end });
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
  const callableOfDecl = (decl, depth = 0) => {
    if (!decl || decl.getSourceFile() !== sf || depth > 6) return undefined;
    const fnRunner = (fn) => (ctx) => {
      for (const p of fn.parameters) walk(p.initializer, ctx); // default parameters run on call
      walk(fn.body, ctx);
    };
    if (ts.isFunctionDeclaration(decl) && decl.body) {
      return { key: decl, name: decl.name?.text ?? "(function)", run: fnRunner(decl), declPos: -1 };
    }
    if (ts.isClassDeclaration(decl) || ts.isClassExpression(decl)) {
      return {
        key: decl, name: decl.name?.text ?? "(class)", declPos: -1,
        run: (ctx) => {
          // `new C()`: instance field initialisers and the constructor run; an
          // `extends` base's constructor runs through `super()`.
          for (const h of decl.heritageClauses ?? []) {
            if (h.token !== ts.SyntaxKind.ExtendsKeyword) continue;
            for (const t of h.types) { const e = unparen(t.expression); if (ts.isIdentifier(e)) follow(e, ctx); }
          }
          for (const m of decl.members) {
            if (ts.isPropertyDeclaration(m) && !hasModifier(m, ts.SyntaxKind.StaticKeyword)) walk(m.initializer, ctx);
            if (ts.isConstructorDeclaration(m) && m.body) fnRunner(m)(ctx);
          }
        },
      };
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
    (SYNC_ITERATORS.has(callee.name.text) ||
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
    if (ts.isVariableDeclaration(node)) { walk(node.initializer, ctx); return; }
    if (ts.isTaggedTemplateExpression(node)) {
      const tag = unparen(node.tag);
      walk(node.tag, ctx);
      walk(node.template, ctx);
      if (ts.isIdentifier(tag)) follow(tag, ctx); // the tag function runs now
      return;
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = unparen(node.expression);
      // IIFE: the function body runs now.
      if (callee && (ts.isArrowFunction(callee) || ts.isFunctionExpression(callee))) {
        for (const p of callee.parameters) walk(p.initializer, ctx);
        walk(callee.body, ctx);
      } else walk(node.expression, ctx);
      const sync = isSyncIterator(callee);
      for (const arg of node.arguments ?? []) {
        const a = unparen(arg);
        if (sync && (ts.isArrowFunction(a) || ts.isFunctionExpression(a))) {
          for (const p of a.parameters) walk(p.initializer, ctx);
          walk(a.body, ctx);
        } else if (sync && ts.isIdentifier(a)) { follow(a, ctx); walk(a, ctx); }
        else walk(arg, ctx);
      }
      if (callee && ts.isIdentifier(callee)) follow(callee, ctx);
      // `f.call(…)` / `f.apply(…)` run f.
      if (callee && ts.isPropertyAccessExpression(callee) && (callee.name.text === "call" || callee.name.text === "apply")) {
        const target = unparen(callee.expression);
        if (ts.isIdentifier(target)) follow(target, ctx);
      }
      return;
    }
    if (ts.isIdentifier(node)) {
      const b = tdzOf(node);
      if (b && b.initEnd > ctx.at) report(ctx.entryNode, ctx.entry, ctx.via ?? node.text, b);
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
      if (ts.isVariableDeclaration(node)) { visitTop(node.initializer); return; }
      ts.forEachChild(node, visitTop);
    };
    visitTop(st);
  }
  return findings.map((f) => ({ ...f, call: f.call ?? f.via }));
}

/** Single-file convenience for the self-test. */
function analyse(text, name = "fixture.ts") {
  return analyseFiles(new Map([[name, text]])).get(name);
}

// ── self-test: both real defects, their corrected forms, and the shapes that
// fooled the regex widening ────────────────────────────────────────────────
const L = (...lines) => lines.join("\n");
const SELF_TEST = [
  // [label, source, expected findings > 0]
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
  for (const [label, src, expectFinding] of SELF_TEST) {
    const got = analyse(src).length > 0;
    if (got !== expectFinding) failures.push(`${expectFinding ? "MISSED" : "FALSE POSITIVE"}: ${label}`);
  }
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
    if (analyse(grid, "grid.ts").length !== 0) failures.push("FALSE POSITIVE: real signalgrid-grid-proof.ts, unmutated");
    const planted = `${grid.slice(0, at)}${grid.slice(end)}\n${grid.slice(at, end)}\n`;
    if (!analyse(planted, "grid.ts").some((d) => d.constName === "allowedSignalTypes")) {
      failures.push("MISSED: real signalgrid-grid-proof.ts with allowedSignalTypes moved below its top-level loop");
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
    console.log(`module-init-order self-test: ${SELF_TEST.length}/${SELF_TEST.length} cases as expected, plus the real grid-proof plant.`);
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
      console.error(`  ✗ ${f}: ${d.error}. An unanalysed file is not a clean file.`);
      problems += 1;
      continue;
    }
    console.error(
      `  ✗ ${f}:${d.callLine}: \`${d.call}\` runs at module load and reads \`${d.constName}\` (via \`${d.via}\`), ` +
        `declared at line ${d.constLine}.\n` +
        "      `function` hoists, `const`/`let`/`class` do not — the read lands in the temporal dead zone and can\n" +
        "      surface as undefined rather than throwing. Move the declaration above the call.",
    );
    problems += 1;
  }
}

console.log(
  `\nmodule-init-order: ${files.length} source files scanned, ${problems} problem(s); self-test ${SELF_TEST.length}/${SELF_TEST.length} green. ` +
    "TypeScript-compiler scope analysis: module-load code (top-level loops included) followed through " +
    "same-file calls, aliases, constructors, default params and tags. Not followed: imports, method calls, " +
    "callbacks other than sync array iterators. " +
    "See the SCOPE LIMIT note.",
);
if (problems > 0) {
  console.error("\nModule-init-order gate FAILED — this defect has shipped twice, both times silently.");
  process.exit(1);
}
console.log("Module-init-order gate passed — no module-scope call reads a const declared after it.");
