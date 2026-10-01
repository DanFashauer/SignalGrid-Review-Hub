// Permission-enforcement gate — DR-002's mandated second half, built.
//
// DR-002 ruled: "a declared permission that no surface requires is a defect,
// and should be caught mechanically — the same shape as every other guard in
// this repo. Either the scope gets enforced on the surfaces above when they
// exist, or it comes out of the union." That check was never built, and the
// org sweep found the exact defect it was meant to catch still live:
// `tenant:admin` declared in the Permission union, granted to the owner role,
// and required by NOTHING — an authority a role table hands out and no code
// ever demands. Ten of eleven permissions are genuinely enforced; the
// eleventh has been ambient authority since it was declared.
//
// WHAT IT MEASURES, stated before what it is for, because the two are not the
// same and a reader who conflates them will trust this further than it goes:
// every member of the `Permission` union is NAMED in the text of at least one
// `authorize(<principal>, "<permission>")` call somewhere in shipping source.
//
// HOW (2026-10-01, plan row 180's reachability half). The TypeScript compiler
// API, not a regex — the same parser `check-module-init-order.mjs` adopted in
// #1274. Every shipping file is parsed and only a real CallExpression whose
// callee is `authorize` (or `<x>.authorize`) with a string-literal second
// argument counts. That alone removes three shapes the regex credited: a call
// written in a comment, in a string literal, and in a template literal's text.
// On top of the syntax tree it runs a CONSTANT-CONDITION reachability pass:
//   - `if (false)`, `while (false)`, `for (;false;)`, `false ? x : y`,
//     `false && x`, `true || x`, `"x" ?? y` — the branch a constant condition
//     can never take is dead (constants: true/false, numbers, strings, null,
//     undefined, `void x`, `!x`, parentheses and `as` casts);
//   - a statement after an unconditional `return`/`throw`/`break`/`continue`
//     in the same block (or after an `if`/`try` every arm of which ends that
//     way) is dead — except a function declaration, which hoists;
//   - a module-private function (a non-exported `function f` or
//     `const f = () => …`) whose name appears nowhere else in its file is dead.
// The security review's planted shape — `export function neverCalled(p) { if
// (false) { authorize(p, "widget:delete"); } }` — is now a self-test control.
//
// SCOPE LIMIT, stated rather than pretended away. This is reachability WITHIN
// one file. It has no import graph, so an EXPORTED function nothing imports
// still counts; it treats every non-constant condition as both-ways possible;
// it does not follow loops/switches for termination; and a module-private
// function named only by itself (recursion) or by a shadowing local counts as
// referenced. A clean run means every credited call is a real, syntactically
// live call — not that a request path reaches it.
//
// FAIL CLOSED: a file the Program does not load, or that does not parse,
// credits NOTHING and is listed — never counted as enforcing.
//
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const TYPES = "lib/signalgrid-core/src/types.ts";
const ROOTS = ["lib", "artifacts"];

// A permission may be declared-but-unenforced ONLY with a reason and a named
// future surface. Empty is the goal state.
const DECLARED_UNENFORCED = new Map([
  [
    "tenant:admin",
    "DR-002 + org sweep 2026-08-23: the tenant-administration surfaces (tenant " +
      "create/suspend, key issuance, role assignment) do not exist in the public " +
      "core — they are private-core/control-plane work. The scope stays in the " +
      "union because the role table and audit trail already reason about it, and " +
      "removing it would silently widen `owner` to mean nothing. When those " +
      "surfaces land they must call authorize(principal, \"tenant:admin\") and " +
      "this entry comes out — which this gate then enforces, because a stale " +
      "exemption fails here.",
  ],
]);

const files = [];
const walk = (d) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (p.includes("node_modules") || p.includes("/dist/") || p.endsWith(".d.ts")) continue;
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.ts$/.test(p) && !/\.test\.ts$/.test(p)) files.push(p);
  }
};
ROOTS.forEach(walk);

const unionSrc = readFileSync(TYPES, "utf8");
const unionBlock = unionSrc.match(/export type Permission =([\s\S]*?);/);
if (!unionBlock) {
  console.error(`✗ could not find the Permission union in ${TYPES} — the extraction broke, and guessing would defeat the gate.`);
  process.exit(1);
}
const permissions = [...unionBlock[1].matchAll(/"([a-z]+:[a-z]+)"/g)].map((m) => m[1]);

const unparsed = [];
const enforced = new Set();
{
  const sources = new Map();
  for (const f of files) {
    if (f.endsWith("check-permission-enforcement.mjs")) continue;
    sources.set(f, readFileSync(f, "utf8"));
  }
  for (const [f, r] of scanSources(sources)) {
    if (r.error) { unparsed.push(`${f}: ${r.error}`); continue; }
    for (const c of r.calls) enforced.add(c.scope);
  }
}

// ── self-test ────────────────────────────────────────────────────────────────
{
  const UNION_FLOOR = 8;
  const CALLSITE_FLOOR = 6;
  // Each DEAD shape must credit nothing; each LIVE shape must credit exactly
  // its scope. Run through the same scanSources the real tree goes through.
  const controls = [
    ["comment", 'export function f(p: any) { // authorize(p, "x:dead")\n /* authorize(p, "x:dead") */ return p; }', []],
    ["string literal", 'export const s = \'authorize(p, "x:dead")\';', []],
    ["template literal", 'export const t = `authorize(p, "x:dead")`;', []],
    ["if (false)", 'export function neverCalled(p: any) { if (false) { authorize(p, "x:dead"); } }', []],
    ["if (!true) / else of if (true)", 'export function f(p: any) { if (!true) authorize(p, "x:dead"); if (true) {} else { authorize(p, "x:dead"); } }', []],
    ["while (0) / for (;false;)", 'export function f(p: any) { while (0) { authorize(p, "x:dead"); } for (;false;) authorize(p, "x:dead"); }', []],
    ["false ? : / false && / true ||", 'export function f(p: any) { false ? authorize(p, "x:dead") : 0; (false as any) && authorize(p, "x:dead"); true || authorize(p, "x:dead"); }', []],
    ["after return", 'export function f(p: any) { return p; authorize(p, "x:dead"); }', []],
    ["after throw", 'export function f(p: any) { throw new Error(p); authorize(p, "x:dead"); }', []],
    ["after an if whose arms both return", 'export function f(p: any, c: boolean) { if (c) { return 1; } else { throw 2; } authorize(p, "x:dead"); }', []],
    ["module-private function nothing names", 'function orphan(p: any) { authorize(p, "x:dead"); }\nconst orphan2 = (p: any) => { authorize(p, "x:dead"); };\nexport const y = 1;', []],
    ["real call", 'export function f(p: any) { authorize(p, "x:live"); }', ["x:live"]],
    ["real method call on a dotted principal", 'export class E { g(t: any) { const ctx = t; this.authorize(ctx.principal, "x:live"); } }', ["x:live"]],
    ["live arm of a non-constant if", 'export function f(p: any, c: boolean) { if (c) { return 1; } authorize(p, "x:live"); }', ["x:live"]],
    ["hoisted function after return, called above", 'export function f(p: any) { return g(p); function g(q: any) { authorize(q, "x:live"); } }', ["x:live"]],
    ["private function the file calls", 'function h(p: any) { authorize(p, "x:live"); }\nexport const k = (p: any) => h(p);', ["x:live"]],
    ["template substitution is code", 'export const u = (p: any) => `${authorize(p, "x:live")}`;', ["x:live"]],
  ];
  const failedControls = [];
  const controlResults = scanSources(new Map(controls.map(([n, src], i) => [`control-${i}.ts`, src])));
  controls.forEach(([n, , want], i) => {
    const r = controlResults.get(`control-${i}.ts`);
    const got = r.error ? ["<error>"] : r.calls.map((c) => c.scope);
    if (JSON.stringify(got) !== JSON.stringify(want)) failedControls.push(`${n}: expected [${want}] got [${got}]`);
  });
  // FAIL CLOSED: a file that does not parse must credit NOTHING, even when the
  // call itself is plainly written in it.
  const broken = scanSources(new Map([["broken.ts", 'export function f(p: any) { authorize(p, "x:live"); \n const = ;']])).get("broken.ts");
  if (!broken.error || broken.calls.length !== 0) failedControls.push("unparseable file: expected an error and no credit");
  const extracts = failedControls.length === 0;
  // THE CONTROL THAT ACTUALLY FIRES. The previous one was
  // `!enforced.has("nonexistent:scope")` — true for any string nobody typed, and
  // it never touched the verdict. This drives the real function with a synthetic
  // corpus and asserts each arm, so "self-test green" means the reporting path
  // has been shown to work rather than merely not been run.
  const noExempt = new Map();
  const missingReported = auditPermissions(["a:read", "b:write"], new Set(["a:read"]), noExempt).problems.some((x) => x.startsWith("b:write"));
  const cleanIsClean = auditPermissions(["a:read"], new Set(["a:read"]), noExempt).problems.length === 0;
  const staleExemptionReported = auditPermissions(["a:read"], new Set(["a:read"]), new Map([["a:read", "reason"]])).problems.some((x) => x.includes("outlived"));
  const exemptionSuppresses = auditPermissions(["a:read"], new Set(), new Map([["a:read", "reason"]])).problems.length === 0;
  const verdictWorks = missingReported && cleanIsClean && staleExemptionReported && exemptionSuppresses;
  if (permissions.length < UNION_FLOOR || enforced.size < CALLSITE_FLOOR || !extracts || !verdictWorks) {
    console.error(
      "✗ SELF-TEST FAILED — " +
        `union=${permissions.length} (floor ${UNION_FLOOR}), enforced=${enforced.size} (floor ${CALLSITE_FLOOR}), ` +
        `extractor=${extracts}${failedControls.length ? " [" + failedControls.join("; ") + "]" : ""}, verdict=${verdictWorks}. ` +
        "The extraction has drifted from the codebase's idiom, or a dead shape is being credited; " +
        "a gate scanning nothing is green about nothing.",
    );
    process.exit(1);
  }
}

/**
 * Parse each source and return Map<fileName, { calls: [{ scope, line }] } |
 * { error, calls: [] }>. Only LIVE `authorize(<expr>, "<scope>")` calls are
 * returned (see HOW in the header). One Program for all files, as in
 * check-module-init-order.mjs; a file that is not loaded or does not parse
 * returns an error and credits nothing.
 */
export function scanSources(sources) {
  const options = {
    allowJs: true, noResolve: true, noLib: true, types: [], noEmit: true,
    target: ts.ScriptTarget.Latest, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve,
  };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (name, lang) =>
    sources.has(name) ? ts.createSourceFile(name, sources.get(name), lang, true) : undefined;
  host.fileExists = (name) => sources.has(name);
  host.readFile = (name) => sources.get(name);
  const program = ts.createProgram([...sources.keys()], options, host);
  const out = new Map();
  for (const name of sources.keys()) {
    const sf = program.getSourceFile(name);
    if (!sf) { out.set(name, { error: "the TypeScript Program did not load this file — not analysed", calls: [] }); continue; }
    const syntax = program.getSyntacticDiagnostics(sf);
    if (syntax.length > 0) {
      const d = syntax[0];
      const line = d.start !== undefined ? sf.getLineAndCharacterOfPosition(d.start).line + 1 : 0;
      out.set(name, { error: `does not parse (line ${line}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}) — not analysed`, calls: [] });
      continue;
    }
    out.set(name, { calls: liveAuthorizeCalls(sf) });
  }
  return out;
}

function unwrap(n) {
  while (n && (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isTypeAssertionExpression(n) ||
    ts.isNonNullExpression(n) || (ts.isSatisfiesExpression && ts.isSatisfiesExpression(n)))) n = n.expression;
  return n;
}

// The truthiness of a constant expression: true, false, or undefined (not a
// constant — both outcomes possible). Unknown is always the both-ways answer,
// which keeps a branch LIVE; only a provably-constant condition kills one.
function constTruth(n) {
  n = unwrap(n);
  if (!n) return undefined;
  switch (n.kind) {
    case ts.SyntaxKind.TrueKeyword: return true;
    case ts.SyntaxKind.FalseKeyword: case ts.SyntaxKind.NullKeyword: return false;
    case ts.SyntaxKind.NumericLiteral: return Number(n.text) !== 0;
    case ts.SyntaxKind.StringLiteral: case ts.SyntaxKind.NoSubstitutionTemplateLiteral: return n.text.length > 0;
    case ts.SyntaxKind.VoidExpression: return false;
    case ts.SyntaxKind.Identifier: return n.text === "undefined" ? false : undefined;
    case ts.SyntaxKind.PrefixUnaryExpression:
      if (n.operator === ts.SyntaxKind.ExclamationToken) { const t = constTruth(n.operand); return t === undefined ? undefined : !t; }
      return undefined;
    default: return undefined;
  }
}
// Constant nullishness, for `??`: true, false, or undefined (unknown).
function constNullish(n) {
  n = unwrap(n);
  if (!n) return undefined;
  if (n.kind === ts.SyntaxKind.NullKeyword || n.kind === ts.SyntaxKind.VoidExpression) return true;
  if (ts.isIdentifier(n)) return n.text === "undefined" ? true : undefined;
  return constTruth(n) === undefined ? undefined : false;
}

// Does completing this statement provably never fall through to the next one?
function terminates(st) {
  if (!st) return false;
  if (ts.isReturnStatement(st) || ts.isThrowStatement(st) || ts.isBreakStatement(st) || ts.isContinueStatement(st)) return true;
  if (ts.isBlock(st)) return st.statements.some((s) => !ts.isFunctionDeclaration(s) && terminates(s));
  if (ts.isLabeledStatement(st)) return false; // a labelled break can exit it
  if (ts.isIfStatement(st)) {
    const c = constTruth(st.expression);
    if (c === true) return terminates(st.thenStatement);
    if (c === false) return terminates(st.elseStatement);
    return terminates(st.thenStatement) && terminates(st.elseStatement);
  }
  if (ts.isTryStatement(st)) {
    if (st.finallyBlock && terminates(st.finallyBlock)) return true;
    return terminates(st.tryBlock) && (!st.catchClause || terminates(st.catchClause.block));
  }
  return false;
}

function isExported(n) {
  return (ts.canHaveModifiers(n) ? ts.getModifiers(n) ?? [] : []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function liveAuthorizeCalls(sf) {
  // Module-private functions whose name appears nowhere else in the file.
  const deadFns = new Set();
  const counts = new Map();
  const countIds = (n) => { if (ts.isIdentifier(n)) counts.set(n.text, (counts.get(n.text) ?? 0) + 1); ts.forEachChild(n, countIds); };
  countIds(sf);
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name && st.body && !isExported(st) && counts.get(st.name.text) === 1) deadFns.add(st);
    if (ts.isVariableStatement(st) && !isExported(st)) {
      for (const d of st.declarationList.declarations) {
        const init = unwrap(d.initializer);
        if (ts.isIdentifier(d.name) && init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && counts.get(d.name.text) === 1) deadFns.add(init);
      }
    }
  }

  const calls = [];
  const visitStatements = (stmts, live) => {
    let l = live;
    for (const st of stmts) {
      // A function declaration hoists: code after a return can still call it.
      if (ts.isFunctionDeclaration(st)) { visit(st, live); continue; }
      visit(st, l);
      if (l && terminates(st)) l = false;
    }
  };
  const visit = (n, live) => {
    if (!n) return;
    if (deadFns.has(n)) live = false;
    if (ts.isSourceFile(n) || ts.isBlock(n) || ts.isModuleBlock(n)) return visitStatements(n.statements, live);
    if (ts.isCaseClause(n)) { visit(n.expression, live); return visitStatements(n.statements, live); }
    if (ts.isDefaultClause(n)) return visitStatements(n.statements, live);
    if (ts.isIfStatement(n)) {
      const c = constTruth(n.expression);
      visit(n.expression, live);
      visit(n.thenStatement, live && c !== false);
      visit(n.elseStatement, live && c !== true);
      return;
    }
    if (ts.isConditionalExpression(n)) {
      const c = constTruth(n.condition);
      visit(n.condition, live);
      visit(n.whenTrue, live && c !== false);
      visit(n.whenFalse, live && c !== true);
      return;
    }
    if (ts.isBinaryExpression(n)) {
      const op = n.operatorToken.kind;
      let rightLive = live;
      if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.AmpersandAmpersandEqualsToken) rightLive = live && constTruth(n.left) !== false;
      else if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.BarBarEqualsToken) rightLive = live && constTruth(n.left) !== true;
      else if (op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.QuestionQuestionEqualsToken) rightLive = live && constNullish(n.left) !== false;
      visit(n.left, live);
      visit(n.right, rightLive);
      return;
    }
    if (ts.isWhileStatement(n)) {
      visit(n.expression, live);
      visit(n.statement, live && constTruth(n.expression) !== false);
      return;
    }
    if (ts.isForStatement(n)) {
      visit(n.initializer, live);
      const bodyLive = live && (n.condition === undefined || constTruth(n.condition) !== false);
      visit(n.condition, live);
      visit(n.incrementor, bodyLive);
      visit(n.statement, bodyLive);
      return;
    }
    if (live && ts.isCallExpression(n)) {
      const callee = unwrap(n.expression);
      const named = (ts.isIdentifier(callee) && callee.text === "authorize") ||
        (ts.isPropertyAccessExpression(callee) && callee.name.text === "authorize");
      const scope = n.arguments[1] && unwrap(n.arguments[1]);
      if (named && n.arguments.length >= 2 && scope && (ts.isStringLiteral(scope) || ts.isNoSubstitutionTemplateLiteral(scope)) &&
        /^[a-z]+:[a-z]+$/.test(scope.text)) {
        calls.push({ scope: scope.text, line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1 });
      }
    }
    ts.forEachChild(n, (c) => visit(c, live));
  };
  visit(sf, true);
  return calls;
}

/**
 * Pure verdict over (declared permissions, permissions NAMED in an authorize
 * call, declared-unenforced exemptions). Extracted so the self-test can drive
 * the REPORTING path over a synthetic corpus instead of asserting a tautology
 * beside it — sibling gates (auditOrgRoster, auditLabRegistry) already have this
 * shape, and the reason is the same: a verdict that cannot be called with made-up
 * inputs cannot be shown to fail.
 */
export function auditPermissions(declared, named, exemptions) {
  const problems = [];
  const ok = [];
  const exempt = [];
  for (const p of declared) {
    if (named.has(p)) {
      if (exemptions.has(p)) {
        problems.push(`${p}: now enforced, but still carries a declared-unenforced entry — remove the exemption, it has outlived its reason`);
      } else {
        ok.push(p);
      }
      continue;
    }
    if (exemptions.has(p)) {
      exempt.push(p);
      continue;
    }
    problems.push(`${p}: declared in the Permission union and granted by the role table, but NO surface names it`);
  }
  return { problems, ok, exempt };
}

console.log("Permission enforcement — every declared scope must be demanded by a LIVE authorize call (DR-002)\n");
let problems = 0;
if (unparsed.length > 0) {
  // Not a failure by itself: a file that does not parse credits nothing, so if
  // it held the only demand for a scope, that scope fails below. Listed so the
  // reader sees which files contributed nothing.
  console.log(`  · ${unparsed.length} file(s) not analysed — they credit NO scope (fail closed):`);
  for (const u of unparsed) console.log(`      ${u}`);
}

for (const p of permissions) {
  if (enforced.has(p)) {
    if (DECLARED_UNENFORCED.has(p)) {
      console.error(`  ✗ ${p}: now enforced, but still carries a declared-unenforced entry — remove the exemption, it has outlived its reason`);
      problems += 1;
    } else {
      console.log(`  ✓ ${p}: demanded by a live authorize call`);
    }
    continue;
  }
  const reason = DECLARED_UNENFORCED.get(p);
  if (reason) {
    console.log(`  · ${p}: DECLARED unenforced — ${reason.slice(0, 90)}…`);
    continue;
  }
  console.error(
    `  ✗ ${p}: declared in the Permission union and granted by the role table, but NO surface requires it.\n` +
      "      Per DR-002 this is a defect: enforce it with authorize(principal, \"" + p + "\"),\n" +
      "      remove it from the union, or declare it here WITH the surface that will require it.",
  );
  problems += 1;
}

console.log(
  `\npermission-enforcement: ${permissions.length} declared, ${permissions.filter((p) => enforced.has(p)).length} enforced, ` +
    `${DECLARED_UNENFORCED.size} declared-unenforced, ${files.length} file(s) scanned, ${unparsed.length} not analysed, ${problems} problem(s); self-test green`,
);
if (problems > 0) {
  console.error("\nPermission-enforcement gate FAILED — ambient authority is authority nobody asked for.");
  process.exit(1);
}
console.log("Permission-enforcement gate passed — no scope is granted that no surface demands.");
