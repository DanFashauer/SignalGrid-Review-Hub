// check-console-unknown-render — the unknown-as-good-state gate for the admin console.
//
//   node scripts/check-console-unknown-render.mjs             the guard
//   node scripts/check-console-unknown-render.mjs --self-test prove the guard can fail (and can pass)
//
// WHY THIS EXISTS
// ---------------
// CLAUDE.md golden rule 2 is fail-closed: an unknown / unreachable signal must RAISE the
// assurance requirement, never lower it — and it must never be PAINTED as a good state.
// The admin console (`artifacts/signalgrid-app`) reads the control plane through
// react-query. When a query has not answered, has errored, or returned nothing, its `data`
// is undefined; a component that renders a POSITIVE CONCLUSION on that absent data — an
// emerald "good" colour, or a reassuring phrase ("no stale signals", "all clear") — tells
// the admin everything is fine when the truth is *we do not know*. That is the G2 defect
// from the 2026-09-02 console batch (SignalSourcing / AppResilience were fixed to gate on
// data presence; Dashboard gates on a destructured error).
//
// WHY A NAIVE REGEX WAS REFUSED (BUILD_BACKLOG, "SPEC ONLY, deferred")
// -------------------------------------------------------------------
// The doctrine-correct fix gates the good state on DATA PRESENCE (`data ? good : muted`),
// not on `.isError`. A text scan flagged correct code — `emerald` is also a static
// category colour, and correct files gate on a destructured `error:` a `.error` probe
// cannot see. A gate at that false-positive rate teaches authors to sprinkle
// `// unknown-ok:` on correct code.
//
// WHAT THIS GATE DOES (a small AST data-flow, not a text scan)
// -----------------------------------------------------------
// For each `.tsx` under the console `src/` that uses a query hook (`useQuery` family, or a
// generated `use…` hook whose binding destructures a query field like `data`/`isError`):
//   1. Collects the query result identifiers: the query-object var (`const q =
//      useQuery(…)`), the destructured `data`/`isError`/`error`/`isLoading` bindings
//      (including a later `const { data } = q`), and vars DERIVED from query data
//      (`const rows = q.data?.x ?? []`), transitively.
//   2. Finds good-state markers: a className string/template containing `emerald` or
//      `status-allow`; a STRONG affirmation phrase (a conclusion on its own — "no stale",
//      "all clear"); or a WEAK conclusion word ("healthy", "operational", "nominal") that
//      is only a conclusion when it decorates rendered data.
//   3. A marker is HANDLED — never flagged — when an enclosing conditional's test proves
//      the marker's branch is reached with data PRESENT: a positive test (`s ? good : …`,
//      `data && good`) with the marker in the present branch, or a negative test
//      (`!data ? loading : good`, `isError ? … : good`) with the marker in the FALSE
//      branch. BRANCH POLARITY MATTERS: `!q.data ? <All clear> : null` and `q.isError &&
//      <All healthy>` render the conclusion exactly when data is missing/errored — those
//      are NOT handled, they are the bug. (Codex P1.)
//   4. An UNHANDLED marker is a VIOLATION when it renders a positive conclusion about live
//      state: a STRONG phrase always; an emerald/status-allow class or a WEAK word only
//      when its element renders query data that is not itself presence-gated (a `.data`
//      member or a derived var — NOT a bare query-object reference such as `q.refetch()`,
//      and NOT inside an event-handler attribute). (Codex P2.)
// Exempt a specific occurrence with a `// unknown-ok: <reason>` on its line or the line above.
//
// KNOWN, DELIBERATE LIMITATIONS (conservative — they UNDER-flag, never over-flag; the
// widened doctrine review still covers them, and each has a BUILD_BACKLOG follow-up):
//   - Per-query provenance is not tracked: on a multi-query page a presence guard on
//     query A is accepted for a conclusion backed by query B. A false NEGATIVE, not a
//     false positive. (Codex P1 — deferred deliberately: naive origin-tracking risks the
//     over-flag that would disqualify a mandatory gate.)
//   - A good-state class stored in a constant (`const GOOD = "text-emerald-400"`) is not
//     resolved to its literal. A false negative. (Codex P2.)
//
// `--self-test` plants bug shapes (each must flag), gated shapes (must not), and a PLANT
// into a real component — so the check can itself fail and can pass.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import ts from "typescript";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const CONSOLE_SRC = join(REPO, "artifacts", "signalgrid-app", "src");

// STRONG affirmations: a positive CONCLUSION on their own. Flag whenever unhandled.
const STRONG_AFFIRMATIONS = [
  /\ball clear\b/i,
  /\bno stale\b/i,
  /\bnothing stale\b/i,
  /\bup to date\b/i,
  /\ball healthy\b/i,
  /\ball operational\b/i,
  /\ball systems\b/i,
  /\ball workable\b/i,
  /\ball have a safe path\b/i,
  /\bfully (protected|covered|compliant)\b/i,
  /\beverything (is )?(ok|fine|healthy|operational)\b/i,
  /\bno\s+[\w-]+(\s+[\w-]+){0,3}\s+(found|pending|detected|outstanding|reported|to review)\b/i,
];
// WEAK conclusions: a positive word that is only a live conclusion when it decorates
// rendered data (a bare "Healthy" column header is not a conclusion). Flag only when the
// element also renders unguarded query data.
const WEAK_CONCLUSIONS = [/\bhealthy\b/i, /\boperational\b/i, /\bnominal\b/i];

const GOOD_CLASS = /\b(emerald|status-allow)\b/;

const STATUS_MEMBERS = new Set([
  "isError", "error", "isLoading", "isPending", "isFetching", "isSuccess", "data", "status", "failureReason",
]);
const QUERY_DESTRUCTURE = new Set([...STATUS_MEMBERS]);
const ERROR_LOADING = new Set(["isError", "error", "isLoading", "isPending", "isFetching", "failureReason"]);
const QUERY_HOOK_FAMILY = new Set(["useQuery", "useQueries", "useInfiniteQuery", "useSuspenseQuery"]);
const HANDLER_ATTR = /^on[A-Z]/;

function callName(call) {
  if (!ts.isCallExpression(call)) return undefined;
  if (ts.isIdentifier(call.expression)) return call.expression.text;
  if (ts.isPropertyAccessExpression(call.expression)) return call.expression.name.text;
  return undefined;
}
function propOf(el) {
  return el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text
    : ts.isIdentifier(el.name) ? el.name.text : undefined;
}

function collectStrings(node, out) {
  const visit = (n) => {
    if (!n) return;
    if (ts.isStringLiteralLike(n)) out.push(n.text);
    else if (ts.isTemplateExpression(n)) { out.push(n.head.text); for (const s of n.templateSpans) out.push(s.literal.text); }
    else if (ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text);
    else if (ts.isJsxText(n)) out.push(n.text);
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

function analyzeSourceFile(relPath, text) {
  const sf = ts.createSourceFile(relPath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  const queryObjVars = new Set();   // const q = useQuery(...)
  const dataVars = new Set();        // destructured `data`, and vars derived from query data
  const statusVars = new Set();      // destructured isError/error/isLoading/isSuccess/status/... vars
  const errorLoadingVars = new Set(); // the subset that means the query FAILED or is not ready
  let usesQueryHook = false;
  const noteStatusLocal = (prop, local) => { statusVars.add(local); if (ERROR_LOADING.has(prop)) errorLoadingVars.add(local); };

  // A declaration is a query binding when: the initializer is a query-hook CALL and either
  // it is the useQuery family, or the binding destructures a recognized query field. This
  // refuses `const [x] = useState(0)` and unrelated `use…` hooks. (Codex P2.)
  const registerHookDecl = (decl) => {
    if (!decl.initializer || !ts.isCallExpression(decl.initializer)) return;
    const name = callName(decl.initializer);
    if (!name || !/^use[A-Z]/.test(name)) return;
    const family = QUERY_HOOK_FAMILY.has(name);
    if (ts.isObjectBindingPattern(decl.name)) {
      const fields = decl.name.elements.map(propOf).filter(Boolean);
      const hasQueryField = fields.some((p) => QUERY_DESTRUCTURE.has(p));
      if (!(family || hasQueryField)) return;
      usesQueryHook = true;
      for (const el of decl.name.elements) {
        const prop = propOf(el);
        const local = ts.isIdentifier(el.name) ? el.name.text : undefined;
        if (!prop || !local) continue;
        if (prop === "data") dataVars.add(local);
        else if (QUERY_DESTRUCTURE.has(prop)) noteStatusLocal(prop, local);
      }
    } else if (ts.isIdentifier(decl.name) && family) {
      usesQueryHook = true;
      queryObjVars.add(decl.name.text);
    }
  };
  const firstPass = (n) => { if (ts.isVariableDeclaration(n)) registerHookDecl(n); ts.forEachChild(n, firstPass); };
  firstPass(sf);
  if (!usesQueryHook) return { usesQueryHook: false, violations: [] };

  // referencesQueryState: subtree mentions a query-object var, a data/status var, or a
  // `.data`/`.isError`/… member of a query object.
  const referencesQueryState = (n) => {
    let hit = false;
    const walk = (x) => {
      if (hit || !x) return;
      if (ts.isIdentifier(x) && (queryObjVars.has(x.text) || dataVars.has(x.text) || statusVars.has(x.text))) { hit = true; return; }
      if (ts.isPropertyAccessExpression(x) && ts.isIdentifier(x.expression) &&
          queryObjVars.has(x.expression.text) && STATUS_MEMBERS.has(x.name.text)) { hit = true; return; }
      ts.forEachChild(x, walk);
    };
    walk(n);
    return hit;
  };

  // Derived-from-data vars, to a fixpoint. Handles `const s = q.data?.x ?? []` and a later
  // `const { data: d, isError: e } = q` destructure of a query-object var. (Codex P2.)
  for (let changed = true, guard = 0; changed && guard < 8; guard++) {
    changed = false;
    const p2 = (n) => {
      if (ts.isVariableDeclaration(n) && n.initializer) {
        if (ts.isIdentifier(n.name) && !dataVars.has(n.name.text) && referencesQueryState(n.initializer)) {
          dataVars.add(n.name.text); changed = true;
        } else if (ts.isObjectBindingPattern(n.name) && referencesQueryState(n.initializer)) {
          for (const el of n.name.elements) {
            const prop = propOf(el);
            const local = ts.isIdentifier(el.name) ? el.name.text : undefined;
            if (!prop || !local) continue;
            if (prop === "data" && !dataVars.has(local)) { dataVars.add(local); changed = true; }
            else if (QUERY_DESTRUCTURE.has(prop) && !statusVars.has(local) && !dataVars.has(local)) { noteStatusLocal(prop, local); changed = true; }
          }
        }
      }
      ts.forEachChild(n, p2);
    };
    p2(sf);
  }

  // Test polarity: does this conditional test assert data PRESENT, or ABSENT/errored?
  //   present  → references data/derived/`.data`, not negated, no error/loading term
  //   absent   → a negation of a data ref, an error/loading term, or a null/undefined test
  const referencesErrorLoading = (n) => {
    let hit = false;
    const walk = (x) => {
      if (hit || !x) return;
      if (ts.isIdentifier(x) && errorLoadingVars.has(x.text)) { hit = true; return; }
      if (ts.isPropertyAccessExpression(x) && ts.isIdentifier(x.expression) &&
          queryObjVars.has(x.expression.text) && ERROR_LOADING.has(x.name.text)) { hit = true; return; }
      ts.forEachChild(x, walk);
    };
    walk(n);
    return hit;
  };
  const testPolarity = (testNode) => {
    if (!testNode) return "unknown";
    // error / loading term anywhere ⇒ absent-ish (the branch guarded by it is the failure path)
    if (referencesErrorLoading(testNode)) return "absent";
    // a top-level or nested `!<data>` ⇒ absent
    let negatedData = false, nullTest = false;
    const walk = (x) => {
      if (!x) return;
      if (ts.isPrefixUnaryExpression(x) && x.operator === ts.SyntaxKind.ExclamationToken && referencesQueryState(x.operand)) negatedData = true;
      if (ts.isBinaryExpression(x) &&
          (x.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken || x.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken) &&
          (referencesQueryState(x.left) || referencesQueryState(x.right))) {
        const other = referencesQueryState(x.left) ? x.right : x.left;
        if ((ts.isIdentifier(other) && other.text === "undefined") || other.kind === ts.SyntaxKind.NullKeyword) nullTest = true;
      }
      ts.forEachChild(x, walk);
    };
    walk(testNode);
    if (negatedData || nullTest) return "absent";
    if (referencesQueryState(testNode)) return "present";
    return "unknown";
  };

  // Is `node` in the present-data branch of some enclosing conditional? (branch-aware)
  const contains = (parent, target) => {
    let found = false;
    const walk = (x) => { if (found || !x) return; if (x === target) { found = true; return; } ts.forEachChild(x, walk); };
    walk(parent);
    return found;
  };
  const isHandled = (node) => {
    let cur = node.parent;
    while (cur && !ts.isSourceFile(cur)) {
      if (ts.isConditionalExpression(cur) && referencesQueryState(cur.condition)) {
        const pol = testPolarity(cur.condition);
        const inTrue = contains(cur.whenTrue, node);
        const inFalse = contains(cur.whenFalse, node);
        if (pol === "present" && inTrue) return true;
        if (pol === "absent" && inFalse) return true;
      } else if (ts.isBinaryExpression(cur) && cur.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
                 referencesQueryState(cur.left) && contains(cur.right, node)) {
        if (testPolarity(cur.left) === "present") return true;
      } else if (ts.isBinaryExpression(cur) && cur.operatorToken.kind === ts.SyntaxKind.BarBarToken &&
                 referencesQueryState(cur.left) && contains(cur.right, node)) {
        if (testPolarity(cur.left) === "absent") return true;
      } else if (ts.isIfStatement(cur) && referencesQueryState(cur.expression)) {
        const pol = testPolarity(cur.expression);
        const inThen = contains(cur.thenStatement, node);
        const inElse = cur.elseStatement ? contains(cur.elseStatement, node) : false;
        if (pol === "present" && inThen) return true;
        if (pol === "absent" && inElse) return true;
      }
      cur = cur.parent;
    }
    return false;
  };

  // A data reference in a guard's TEST is a gate, not a render (`s ? String(x) : "-"` — the
  // `s` in the test decorates nothing). Exclude those so a presence-gated value is not
  // mistaken for an unguarded render.
  const inGuardTest = (node) => {
    let cur = node.parent, child = node;
    while (cur && !ts.isSourceFile(cur)) {
      if (ts.isConditionalExpression(cur) && contains(cur.condition, node)) return true;
      if (ts.isIfStatement(cur) && contains(cur.expression, node)) return true;
      if (ts.isBinaryExpression(cur) &&
          (cur.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || cur.operatorToken.kind === ts.SyntaxKind.BarBarToken) &&
          cur.left === child) return true;
      child = cur; cur = cur.parent;
    }
    return false;
  };
  // Does this element render query data that is not presence-gated? Counts a `.data`
  // member or a derived data var; NOT a bare query-object reference (`q.refetch()`), NOT a
  // ref in a guard test, and NOT anything inside an event-handler attribute. (Codex P2.)
  const elementHasUnguardedDataRender = (jsxElement) => {
    let hit = false;
    const walk = (x) => {
      if (hit || !x) return;
      if (ts.isJsxAttribute(x) && ts.isIdentifier(x.name) && HANDLER_ATTR.test(x.name.text)) return; // skip onClick/onChange/…
      if (ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken &&
          referencesQueryState(x.left) && !isHandled(x) && !inGuardTest(x)) { hit = true; return; }
      if (ts.isIdentifier(x) && dataVars.has(x.text) && !isHandled(x) && !inGuardTest(x)) { hit = true; return; }
      if (ts.isPropertyAccessExpression(x) && ts.isIdentifier(x.expression) &&
          queryObjVars.has(x.expression.text) && x.name.text === "data" && !isHandled(x) && !inGuardTest(x)) { hit = true; return; }
      ts.forEachChild(x, walk);
    };
    walk(jsxElement);
    return hit;
  };

  const goodClassStringNodes = (attr) => {
    const nodes = [];
    const walk = (x) => {
      if (!x) return;
      if ((ts.isStringLiteralLike(x) || ts.isNoSubstitutionTemplateLiteral(x)) && GOOD_CLASS.test(x.text)) nodes.push(x);
      if (ts.isTemplateExpression(x) && (GOOD_CLASS.test(x.head.text) || x.templateSpans.some((s) => GOOD_CLASS.test(s.literal.text)))) nodes.push(x);
      ts.forEachChild(x, walk);
    };
    walk(attr);
    return nodes;
  };
  const enclosingJsxElement = (node) => {
    let cur = node;
    while (cur && !ts.isSourceFile(cur)) { if (ts.isJsxElement(cur) || ts.isJsxSelfClosingElement(cur)) return cur; cur = cur.parent; }
    return undefined;
  };

  const lines = text.split("\n");
  const exemptLine = (i0) => /\/\/\s*unknown-ok:/.test(lines[i0] ?? "") || /\/\/\s*unknown-ok:/.test(lines[i0 - 1] ?? "");
  const posLine = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
  const violations = [];
  const seen = new Set();
  const report = (node, kind, snippet) => {
    const line = posLine(node);
    const key = `${line}:${kind}`;
    if (seen.has(key) || exemptLine(line)) return;
    seen.add(key);
    violations.push({ line: line + 1, kind, snippet: String(snippet).trim().replace(/\s+/g, " ").slice(0, 80) });
  };

  const textOfNode = (n) => {
    if (ts.isJsxText(n) || ts.isStringLiteralLike(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
    if (ts.isTemplateExpression(n)) return [n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join(" ");
    return "";
  };

  const inJsxAttribute = (node) => {
    let cur = node.parent;
    while (cur && !ts.isSourceFile(cur)) { if (ts.isJsxAttribute(cur)) return true; if (ts.isJsxElement(cur) || ts.isJsxSelfClosingElement(cur)) return false; cur = cur.parent; }
    return false;
  };
  const p3 = (n) => {
    // Phrases in RENDERED text — JSX text, string/template content — but NOT inside an
    // attribute value (a className CSS token like `bg-signal-nominal` is not prose).
    if ((ts.isJsxText(n) || ts.isStringLiteralLike(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n)) && !inJsxAttribute(n)) {
      const t = textOfNode(n);
      if (t) {
        if (STRONG_AFFIRMATIONS.some((re) => re.test(t)) && !isHandled(n)) {
          report(n, "affirmation-phrase", t);
        } else if (WEAK_CONCLUSIONS.some((re) => re.test(t)) && !isHandled(n)) {
          const el = enclosingJsxElement(n);
          if (el && elementHasUnguardedDataRender(el)) report(n, "weak-conclusion-on-unguarded-data", t);
        }
      }
    }
    // Good-state className on a JSX attribute.
    if (ts.isJsxAttribute(n) && ts.isIdentifier(n.name) &&
        (n.name.text === "className" || n.name.text === "accent" || n.name.text === "dot" || n.name.text === "text")) {
      for (const strNode of goodClassStringNodes(n)) {
        if (isHandled(strNode)) continue;
        const el = enclosingJsxElement(n);
        if (el && elementHasUnguardedDataRender(el)) report(strNode, "good-class-on-unguarded-data", strNode.text || "emerald");
      }
    }
    ts.forEachChild(n, p3);
  };
  p3(sf);

  return { usesQueryHook: true, violations };
}

function walkTsx(dir, acc) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkTsx(full, acc);
    else if (entry.endsWith(".tsx")) acc.push(full);
  }
  return acc;
}
function runOverTree() {
  const all = [];
  for (const f of walkTsx(CONSOLE_SRC, [])) {
    const rel = relative(REPO, f);
    const { usesQueryHook, violations } = analyzeSourceFile(rel, readFileSync(f, "utf8"));
    if (usesQueryHook && violations.length) all.push({ file: rel, violations });
  }
  return all;
}

// ---------------- self-test ----------------
const BUG = `
import { useQuery } from "@tanstack/react-query";
export function Broken() {
  const q = useQuery({ queryKey: ["x"], queryFn: fetchThing });
  const items = q.data?.items ?? [];
  return (
    <div>
      <span className="text-emerald-400">{items.length} up to date</span>
      <div>No stale or non-compliant signals</div>
      <Metric accent="text-emerald-400" value={String(items.length)} />
      {!q.data ? <div>All clear</div> : null}
      {q.isError && <span>All healthy</span>}
      <div>{items.length} healthy</div>
    </div>
  );
}`;
const OK = `
import { useQuery } from "@tanstack/react-query";
export function Fine() {
  const q = useQuery({ queryKey: ["x"], queryFn: fetchThing });
  const s = q.data;
  const items = s?.items ?? [];
  return (
    <div>
      <Metric accent={s ? "text-emerald-400" : undefined} value={s ? String(items.length) : "-"} />
      {!q.data ? <div>{q.isError ? "unavailable" : "Loading…"}</div> : (
        items.length === 0 ? <div>No stale or non-compliant signals</div> : null
      )}
      <span className="text-emerald-400">Vendor-integrated</span>
      <button className="text-emerald-400" onClick={() => q.refetch()}>Refresh</button>
      <th className="text-emerald-400">Operational</th>
    </div>
  );
}`;
const NONQUERY = `
import { useState } from "react";
export function Plain() {
  const [n, setN] = useState(0);
  return <div className="text-emerald-400">All clear</div>;
}`;

function analyze(src, name) { return analyzeSourceFile(name, src).violations; }
function selfTest() {
  let ok = true;
  const bug = analyze(BUG, "BUG.tsx");
  const bugKinds = bug.map((v) => v.kind);
  console.log(`  self-test BUG.tsx → ${bug.length}: ${bug.map((v) => `L${v.line}:${v.kind}`).join(" ")}`);
  const need = [
    ["ungated strong phrase (No stale)", () => bug.some((v) => v.kind === "affirmation-phrase" && /no stale/i.test(v.snippet))],
    ["emerald on unguarded data", () => bug.some((v) => v.kind === "good-class-on-unguarded-data")],
    ["strong phrase in data-absent branch (!q.data ? All clear)", () => bug.some((v) => v.kind === "affirmation-phrase" && /all clear/i.test(v.snippet))],
    ["strong phrase in error branch (q.isError && All healthy)", () => bug.some((v) => v.kind === "affirmation-phrase" && /all healthy/i.test(v.snippet))],
    ["weak conclusion on unguarded data (N healthy)", () => bug.some((v) => v.kind === "weak-conclusion-on-unguarded-data")],
  ];
  for (const [label, pass] of need) if (!pass()) { ok = false; console.error(`  FAIL — bug not caught: ${label}`); }

  const fine = analyze(OK, "OK.tsx");
  console.log(`  self-test OK.tsx → ${fine.length} violation(s)`);
  if (fine.length !== 0) { ok = false; console.error("  FAIL — data-presence-gated component flagged (false positive):"); for (const v of fine) console.error(`    L${v.line} ${v.kind} ${v.snippet}`); }

  const plain = analyze(NONQUERY, "PLAIN.tsx");
  console.log(`  self-test NON-QUERY.tsx → ${plain.length} violation(s)`);
  if (plain.length !== 0) { ok = false; console.error("  FAIL — a component with no query hook was flagged (useState false positive)"); }

  // Plant into a REAL component: drop the `s ?` presence guard on a metric with a static
  // emerald accent, and confirm the gate fires; the unmutated file must stay clean.
  const REAL = join(CONSOLE_SRC, "pages", "SignalSourcing.tsx");
  const GUARDED = `value={s ? String(s.vendorIntegrated) : "-"} accent="text-emerald-400"`;
  const PLANTED = `value={String(s.vendorIntegrated)} accent="text-emerald-400"`;
  let realText;
  try { realText = readFileSync(REAL, "utf8"); } catch { realText = null; }
  if (!realText || !realText.includes(GUARDED)) {
    ok = false; console.error(`  FAIL — plant anchor not found in ${relative(REPO, REAL)}; update the self-test anchor.`);
  } else {
    const clean = analyze(realText, relative(REPO, REAL));
    if (clean.length !== 0) { ok = false; console.error("  FAIL — real SignalSourcing.tsx flagged unmutated:"); for (const v of clean) console.error(`    L${v.line} ${v.kind} ${v.snippet}`); }
    const planted = analyze(realText.replace(GUARDED, PLANTED), relative(REPO, REAL));
    const caught = planted.some((v) => v.kind === "good-class-on-unguarded-data");
    console.log(`  self-test PLANT (real component, presence guard removed) → ${planted.length} violation(s)`);
    if (!caught) { ok = false; console.error("  FAIL — the planted unguarded emerald render was NOT caught"); }
  }
  return ok;
}

// ---------------- main ----------------
if (process.argv.includes("--self-test")) {
  console.log("check-console-unknown-render — self-test (the guard can fail AND can pass)");
  process.exit(selfTest() ? 0 : 1);
}
const findings = runOverTree();
if (findings.length === 0) {
  console.log("✓ console unknown-render: no positive conclusion renders on unguarded query data.");
  process.exit(0);
}
console.error("✗ console unknown-render — a good-state render is not gated on data presence or error:");
for (const { file, violations } of findings) {
  for (const v of violations) {
    console.error(`  ${file}:${v.line}  [${v.kind}]  ${v.snippet}`);
    console.error(`      gate it on the query result (data ? good : muted / isError), or add // unknown-ok: <reason>`);
  }
}
process.exit(1);
