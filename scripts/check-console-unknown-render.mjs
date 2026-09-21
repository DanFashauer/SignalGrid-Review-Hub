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
//   - Per-query provenance is not tracked, and provenance does not cross component/file
//     boundaries: on a multi-query page a presence guard on query A is accepted for a
//     conclusion backed by query B, and a value extracted into a child presentation
//     component is analysed without its parent's query origin. A false NEGATIVE, not a
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
  /\ball systems (are )?(operational|healthy|ok|nominal|online|normal|go|green|up)\b/i,
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

// User-facing text attributes whose VALUE is read by a person or assistive tech — an
// affirmation here paints the unknown state good just as rendered text does. Everything
// else (className, data-*, key, …) is skipped for phrase scanning. (Codex P2.)
const USER_FACING_ATTRS = new Set([
  "aria-label", "aria-description", "aria-roledescription", "title", "alt", "label", "placeholder", "tooltip",
]);

// An identifier that is the MEMBER of a property access (`obj.status`) is not a variable
// reference — it must never match a same-named tracked var. (Codex P2 false positive.)
const isMemberName = (id) => ts.isPropertyAccessExpression(id.parent) && id.parent.name === id;

// A negator immediately before an affirmation flips its meaning: "Not all healthy" and
// "Not all systems are operational" REPORT a bad state, they do not paint an unknown one.
// (Codex P2 — a false positive that would fail correct warning copy.)
const NEGATION_BEFORE = /\b(not|never|no longer|isn't|aren't|wasn't|weren't|cannot|can't|without)\s*$/i;
function unnegatedMatch(regexes, text) {
  for (const re of regexes) {
    const m = re.exec(text);
    if (m && !NEGATION_BEFORE.test(text.slice(Math.max(0, m.index - 18), m.index))) return true;
  }
  return false;
}

const STATUS_MEMBERS = new Set([
  "isError", "error", "isLoading", "isPending", "isFetching", "isSuccess", "data", "status", "failureReason",
]);
const QUERY_DESTRUCTURE = new Set([...STATUS_MEMBERS]);
const LOADING_MEMBERS = new Set(["isLoading", "isPending", "isFetching"]);
const ERROR_MEMBERS = new Set(["isError", "error", "failureReason"]);
const ERROR_LOADING = new Set([...LOADING_MEMBERS, ...ERROR_MEMBERS]);
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
  const errorVars = new Set();         // error flags specifically
  const loadingVars = new Set();       // loading/pending/fetching flags specifically
  let usesQueryHook = false;
  const noteStatusLocal = (prop, local) => {
    statusVars.add(local);
    if (ERROR_LOADING.has(prop)) errorLoadingVars.add(local);
    if (ERROR_MEMBERS.has(prop)) errorVars.add(local);
    if (LOADING_MEMBERS.has(prop)) loadingVars.add(local);
  };

  // Query-family hooks by their LOCAL name, resolving `import { useQuery as useRQ }`. A
  // call spelled with the alias is still a query hook. (Codex P2.)
  const queryHookLocals = new Set(QUERY_HOOK_FAMILY);
  const collectImports = (n) => {
    if (ts.isImportDeclaration(n) && n.importClause && n.importClause.namedBindings && ts.isNamedImports(n.importClause.namedBindings)) {
      for (const spec of n.importClause.namedBindings.elements) {
        const imported = (spec.propertyName ?? spec.name).text;
        if (QUERY_HOOK_FAMILY.has(imported)) queryHookLocals.add(spec.name.text);
      }
    }
    ts.forEachChild(n, collectImports);
  };
  collectImports(sf);

  // A declaration is a query binding when: the initializer is a query-hook CALL and either
  // it is the useQuery family, or the binding destructures a recognized query field. This
  // refuses `const [x] = useState(0)` and unrelated `use…` hooks. (Codex P2.)
  const registerHookDecl = (decl) => {
    if (!decl.initializer || !ts.isCallExpression(decl.initializer)) return;
    const name = callName(decl.initializer);
    if (!name || !/^use[A-Z]/.test(name)) return;
    const family = queryHookLocals.has(name);
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
    } else if (ts.isArrayBindingPattern(decl.name) && family) {
      // `const [q] = useQueries(...)` — each element is a query-result object. (Codex P2.)
      usesQueryHook = true;
      for (const el of decl.name.elements) {
        if (ts.isBindingElement(el) && ts.isIdentifier(el.name)) queryObjVars.add(el.name.text);
      }
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
      if (ts.isIdentifier(x) && !isMemberName(x) && (queryObjVars.has(x.text) || dataVars.has(x.text) || statusVars.has(x.text))) { hit = true; return; }
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

  // referencesErrorLoading: subtree mentions an error/loading flag (`isError`, `isLoading`,
  // …) of the query — a term whose truth means the query failed or is not yet ready.
  const referencesErrorLoading = (n) => {
    let hit = false;
    const walk = (x) => {
      if (hit || !x) return;
      if (ts.isIdentifier(x) && !isMemberName(x) && errorLoadingVars.has(x.text)) { hit = true; return; }
      if (ts.isPropertyAccessExpression(x) && ts.isIdentifier(x.expression) &&
          queryObjVars.has(x.expression.text) && ERROR_LOADING.has(x.name.text)) { hit = true; return; }
      ts.forEachChild(x, walk);
    };
    walk(n);
    return hit;
  };
  // referencesFlag: subtree references a specific flag kind (error or loading) of the query.
  const referencesFlag = (n, memberSet, varSet) => {
    let hit = false;
    const walk = (x) => {
      if (hit || !x) return;
      if (ts.isIdentifier(x) && !isMemberName(x) && varSet.has(x.text)) { hit = true; return; }
      if (ts.isPropertyAccessExpression(x) && ts.isIdentifier(x.expression) &&
          queryObjVars.has(x.expression.text) && memberSet.has(x.name.text)) { hit = true; return; }
      ts.forEachChild(x, walk);
    };
    walk(n);
    return hit;
  };
  // referencesQueryData: subtree references the query's DATA specifically (a `data`/derived
  // var, or `queryObj.data`) — NOT an error/loading flag, NOT a bare query object.
  const referencesQueryData = (n) => {
    let hit = false;
    const walk = (x) => {
      if (hit || !x) return;
      if (ts.isIdentifier(x) && !isMemberName(x) && dataVars.has(x.text)) { hit = true; return; }
      if (ts.isPropertyAccessExpression(x) && ts.isIdentifier(x.expression) &&
          queryObjVars.has(x.expression.text) && x.name.text === "data") { hit = true; return; }
      ts.forEachChild(x, walk);
    };
    walk(n);
    return hit;
  };
  const isNullish = (x) => (ts.isIdentifier(x) && x.text === "undefined") || x.kind === ts.SyntaxKind.NullKeyword;
  const isDataPresenceAtom = (n) => referencesQueryData(n) && !referencesErrorLoading(n);
  const isErrorAtom = (n) => referencesErrorLoading(n) && !referencesQueryData(n);
  const eqNullishDataSide = (n) =>
    (referencesQueryData(n.left) && isNullish(n.right)) || (referencesQueryData(n.right) && isNullish(n.left));

  // PER-BRANCH boolean model. One polarity per test cannot read `&&`/`||` correctly, and
  // `!isError` is ALSO true while a query is still pending — so it is never proof of data.
  // dataPresentWhen(test, branchValue): does `test` evaluating to branchValue GUARANTEE the
  // data is present? dataAbsentWhen: does it guarantee absent/errored? (Codex P1/P2.)
  const K = ts.SyntaxKind;
  const dataPresentWhen = (test, bv) => {
    if (!test) return false;
    if (ts.isParenthesizedExpression(test)) return dataPresentWhen(test.expression, bv);
    if (ts.isPrefixUnaryExpression(test) && test.operator === K.ExclamationToken) return dataPresentWhen(test.operand, !bv);
    if (ts.isBinaryExpression(test)) {
      const op = test.operatorToken.kind;
      if (op === K.AmpersandAmpersandToken) return bv ? (dataPresentWhen(test.left, true) || dataPresentWhen(test.right, true)) : false;
      if (op === K.BarBarToken) return !bv ? (dataPresentWhen(test.left, false) || dataPresentWhen(test.right, false)) : false;
      if (op === K.EqualsEqualsEqualsToken || op === K.EqualsEqualsToken) return eqNullishDataSide(test) ? bv === false : false;
      if (op === K.ExclamationEqualsEqualsToken || op === K.ExclamationEqualsToken) return eqNullishDataSide(test) ? bv === true : false;
      return false;
    }
    if (isDataPresenceAtom(test)) return bv === true;
    return false;
  };
  const dataAbsentWhen = (test, bv) => {
    if (!test) return false;
    if (ts.isParenthesizedExpression(test)) return dataAbsentWhen(test.expression, bv);
    if (ts.isPrefixUnaryExpression(test) && test.operator === K.ExclamationToken) return dataAbsentWhen(test.operand, !bv);
    if (ts.isBinaryExpression(test)) {
      const op = test.operatorToken.kind;
      if (op === K.AmpersandAmpersandToken) return bv ? (dataAbsentWhen(test.left, true) || dataAbsentWhen(test.right, true)) : false;
      if (op === K.BarBarToken) return !bv ? (dataAbsentWhen(test.left, false) || dataAbsentWhen(test.right, false)) : false;
      if (op === K.EqualsEqualsEqualsToken || op === K.EqualsEqualsToken) return eqNullishDataSide(test) ? bv === true : false;
      if (op === K.ExclamationEqualsEqualsToken || op === K.ExclamationEqualsToken) return eqNullishDataSide(test) ? bv === false : false;
      return false;
    }
    if (isDataPresenceAtom(test)) return bv === false;
    if (isErrorAtom(test)) return bv === true;
    return false;
  };

  // Is `node` in the present-data branch of some enclosing conditional? (branch-aware)
  const contains = (parent, target) => {
    let found = false;
    const walk = (x) => { if (found || !x) return; if (x === target) { found = true; return; } ts.forEachChild(x, walk); };
    walk(parent);
    return found;
  };
  // Which guard test governs `node` at this ancestor, and the branch value that reaches it.
  const branchContaining = (cur, node) => {
    if (ts.isConditionalExpression(cur)) {
      if (contains(cur.whenTrue, node)) return { test: cur.condition, bv: true };
      if (contains(cur.whenFalse, node)) return { test: cur.condition, bv: false };
    } else if (ts.isIfStatement(cur)) {
      if (contains(cur.thenStatement, node)) return { test: cur.expression, bv: true };
      if (cur.elseStatement && contains(cur.elseStatement, node)) return { test: cur.expression, bv: false };
    } else if (ts.isBinaryExpression(cur) && cur.operatorToken.kind === K.AmpersandAmpersandToken && contains(cur.right, node)) {
      return { test: cur.left, bv: true };   // right renders when left is truthy
    } else if (ts.isBinaryExpression(cur) && cur.operatorToken.kind === K.BarBarToken && contains(cur.right, node)) {
      return { test: cur.left, bv: false };  // right renders when left is falsy
    }
    return null;
  };
  // flagFalseWhen(test, bv, …): does `test` evaluating to branchValue GUARANTEE a flag of
  // this kind (error, or loading) is FALSE? Used to recognise the react-query success
  // pattern `isLoading ? … : isError ? … : <content>` — content is reached only with BOTH
  // flags false, i.e. data present. (Codex P2 — a false positive on the standard pattern.)
  const flagFalseWhen = (test, bv, memberSet, varSet) => {
    if (!test) return false;
    if (ts.isParenthesizedExpression(test)) return flagFalseWhen(test.expression, bv, memberSet, varSet);
    if (ts.isPrefixUnaryExpression(test) && test.operator === K.ExclamationToken) return flagFalseWhen(test.operand, !bv, memberSet, varSet);
    if (ts.isBinaryExpression(test)) {
      const op = test.operatorToken.kind;
      if (op === K.AmpersandAmpersandToken) return bv ? (flagFalseWhen(test.left, true, memberSet, varSet) || flagFalseWhen(test.right, true, memberSet, varSet)) : false;
      if (op === K.BarBarToken) return !bv ? (flagFalseWhen(test.left, false, memberSet, varSet) || flagFalseWhen(test.right, false, memberSet, varSet)) : false;
      return false;
    }
    if (referencesFlag(test, memberSet, varSet) && !referencesQueryData(test)) return bv === false;
    return false;
  };

  const alwaysReturns = (stmt) => {
    if (!stmt) return false;
    if (ts.isReturnStatement(stmt) || ts.isThrowStatement(stmt)) return true;
    if (ts.isBlock(stmt)) return stmt.statements.some(alwaysReturns);
    return false;
  };
  // Every guard governing `node`: enclosing conditional/if/&&/|| branches, PLUS early-return
  // guards — `if (cond) return …;` at a preceding sibling means the fall-through is reached
  // only when cond is FALSE, so it governs `node` with bv=false.
  const governingBranches = (node) => {
    const out = [];
    let cur = node.parent, prev = node;
    while (cur && !ts.isSourceFile(cur)) {
      const b = branchContaining(cur, node);
      if (b) out.push(b);
      if (ts.isBlock(cur)) {
        const stmts = cur.statements;
        let idx = -1;
        for (let i = 0; i < stmts.length; i++) { if (contains(stmts[i], node)) { idx = i; break; } }
        for (let i = 0; i < idx; i++) {
          const s = stmts[i];
          if (ts.isIfStatement(s) && !s.elseStatement && alwaysReturns(s.thenStatement)) out.push({ test: s.expression, bv: false });
        }
      }
      prev = cur; cur = cur.parent;
    }
    return out;
  };
  // A good render is HANDLED when the guards governing it prove data present — either
  // directly, or by ruling out BOTH the error and loading flags (react-query: not-error and
  // not-loading ⇒ data present).
  const isHandled = (node) => {
    let present = false, notError = false, notLoading = false;
    for (const b of governingBranches(node)) {
      if (dataPresentWhen(b.test, b.bv)) present = true;
      if (flagFalseWhen(b.test, b.bv, ERROR_MEMBERS, errorVars)) notError = true;
      if (flagFalseWhen(b.test, b.bv, LOADING_MEMBERS, loadingVars)) notLoading = true;
    }
    return present || (notError && notLoading);
  };

  // Is `node` in the DATA-ABSENT branch of a query guard — the arm that renders when data
  // is missing/errored? A good-state class chosen there (`className={!q.data ? "emerald" :
  // "red"}`) paints the unknown state green even with no separate data render. (Codex P1.)
  const inAbsentDataBranch = (node) => {
    let cur = node.parent;
    while (cur && !ts.isSourceFile(cur)) {
      const b = branchContaining(cur, node);
      if (b && dataAbsentWhen(b.test, b.bv)) return true;
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
  // A name that is bound as a PARAMETER of an enclosing function is a prop, not the query's
  // data — `function Child({ data }) { … }` shares the name but is a distinct binding, so
  // its render must not be attributed to a query in the same file. (Codex P2 false positive.)
  const boundAsParamInEnclosingFn = (node) => {
    const name = ts.isIdentifier(node) ? node.text : null;
    if (!name) return false;
    let cur = node.parent;
    while (cur && !ts.isSourceFile(cur)) {
      if (ts.isFunctionDeclaration(cur) || ts.isFunctionExpression(cur) || ts.isArrowFunction(cur) || ts.isMethodDeclaration(cur)) {
        for (const p of cur.parameters) {
          if (ts.isIdentifier(p.name) && p.name.text === name) return true;
          if (ts.isObjectBindingPattern(p.name)) {
            for (const el of p.name.elements) { if (ts.isIdentifier(el.name) && el.name.text === name) return true; }
          }
        }
      }
      cur = cur.parent;
    }
    return false;
  };
  // Does this element render query data that is not presence-gated? Counts a `.data`
  // member or a derived data var; NOT a bare query-object reference (`q.refetch()`), NOT a
  // ref in a guard test, NOT a same-named function parameter, and NOT anything inside an
  // event-handler attribute. (Codex P2.)
  const elementHasUnguardedDataRender = (jsxElement) => {
    let hit = false;
    const walk = (x) => {
      if (hit || !x) return;
      if (ts.isJsxAttribute(x) && ts.isIdentifier(x.name) && HANDLER_ATTR.test(x.name.text)) return; // skip onClick/onChange/…
      if (ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken &&
          referencesQueryData(x.left) && !isHandled(x) && !inGuardTest(x)) { hit = true; return; }
      if (ts.isIdentifier(x) && !isMemberName(x) && dataVars.has(x.text) && !boundAsParamInEnclosingFn(x) && !isHandled(x) && !inGuardTest(x)) { hit = true; return; }
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
    while (cur && !ts.isSourceFile(cur)) { if (ts.isJsxElement(cur) || ts.isJsxSelfClosingElement(cur) || ts.isJsxFragment(cur)) return cur; cur = cur.parent; }
    return undefined;
  };

  // Exemptions come from REAL `// unknown-ok: <reason>` comment trivia (never a marker
  // inside a string literal), and the reason is mandatory — a bare `// unknown-ok:` must
  // not silently drop a finding from this gate. (Codex P2.)
  const exemptCommentLines = new Set();
  {
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.JSX, text);
    let tok;
    while ((tok = scanner.scan()) !== ts.SyntaxKind.EndOfFileToken) {
      if (tok === ts.SyntaxKind.SingleLineCommentTrivia || tok === ts.SyntaxKind.MultiLineCommentTrivia) {
        const body = text.slice(scanner.getTokenPos(), scanner.getTextPos());
        if (/unknown-ok:\s*\S/.test(body)) {
          const ln = sf.getLineAndCharacterOfPosition(scanner.getTokenPos()).line;
          exemptCommentLines.add(ln);       // trailing comment on the violation line
          exemptCommentLines.add(ln + 1);   // comment on the line ABOVE the violation
        }
      }
    }
  }
  const exemptLine = (i0) => exemptCommentLines.has(i0);
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

  const enclosingAttrName = (node) => {
    let cur = node.parent;
    while (cur && !ts.isSourceFile(cur)) {
      if (ts.isJsxAttribute(cur)) return ts.isIdentifier(cur.name) ? cur.name.text : "";
      if (ts.isJsxElement(cur) || ts.isJsxSelfClosingElement(cur)) return null;
      cur = cur.parent;
    }
    return null;
  };
  // A string is RENDERED only when it reaches a JSX child expression or attribute value
  // through render-transparent nodes (ternary arms, `&&`/`||` operands, parens, templates).
  // A string used as a call argument or comparison operand — `s.status !== 'nominal'`,
  // `console.log("All clear")` — is NOT rendered. (Codex P2 false positive.)
  const renderTransparent = (parent, child) => {
    if (ts.isParenthesizedExpression(parent)) return true;
    if (ts.isConditionalExpression(parent)) return parent.whenTrue === child || parent.whenFalse === child;
    if (ts.isBinaryExpression(parent)) {
      const op = parent.operatorToken.kind;
      if (op === K.AmpersandAmpersandToken) return parent.right === child;
      if (op === K.BarBarToken || op === K.QuestionQuestionToken) return parent.left === child || parent.right === child;
      return false;
    }
    if (ts.isTemplateExpression(parent) || ts.isTemplateSpan(parent)) return true;
    return false;
  };
  const isRenderedText = (n) => {
    if (ts.isJsxText(n)) return true;
    let child = n, cur = n.parent;
    while (cur && !ts.isSourceFile(cur)) {
      if (ts.isJsxExpression(cur) || ts.isJsxAttribute(cur) || ts.isJsxElement(cur) || ts.isJsxSelfClosingElement(cur) || ts.isJsxFragment(cur)) return true;
      if (!renderTransparent(cur, child)) return false;
      child = cur; cur = cur.parent;
    }
    return false;
  };
  const p3 = (n) => {
    // Phrases in RENDERED text — JSX text and string/template content — plus USER-FACING
    // attribute values (aria-label, title, …). Skip styling attributes (a className CSS
    // token like `bg-signal-nominal` is not prose), and require the text to be actually
    // rendered so `console.log("All clear")` and `s.status !== 'nominal'` are ignored.
    if ((ts.isJsxText(n) || ts.isStringLiteralLike(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n)) &&
        isRenderedText(n)) {
      const attr = enclosingAttrName(n);
      const scannable = attr === null || USER_FACING_ATTRS.has(attr);
      if (!scannable) { ts.forEachChild(n, p3); return; }
      const t = textOfNode(n);
      if (t) {
        if (unnegatedMatch(STRONG_AFFIRMATIONS, t) && !isHandled(n)) {
          report(n, "affirmation-phrase", t);
        } else if (unnegatedMatch(WEAK_CONCLUSIONS, t) && !isHandled(n)) {
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
        // Report when the good class is chosen by the data-ABSENT branch (painted on
        // unknown), OR when the element renders unguarded query data.
        if (inAbsentDataBranch(strNode) || (el && elementHasUnguardedDataRender(el))) {
          report(strNode, "good-class-on-unguarded-data", strNode.text || "emerald");
        }
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
// A good class chosen BY the data-absent branch, with no separate data render. Must flag. (P1)
const BUG_ABSENTCLASS = `
import { useQuery } from "@tanstack/react-query";
export function AbsentClass() {
  const q = useQuery({ queryKey: ["x"], queryFn: fetchThing });
  return <div className={!q.data ? "text-emerald-400" : "text-red-400"}>Status</div>;
}`;
// A conclusion painted on the ERROR path via a negated error predicate. Must flag. (P1)
const BUG_NEGERROR = `
import { useQuery } from "@tanstack/react-query";
export function NegError() {
  const q = useQuery({ queryKey: ["x"], queryFn: fetchThing });
  return <div>{!q.isError ? null : <span>Everything is fine</span>}</div>;
}`;
// useQueries consumed via array destructuring. Must flag. (P2)
const BUG_USEQUERIES = `
import { useQueries } from "@tanstack/react-query";
export function MultiQ() {
  const [q] = useQueries({ queries: [{ queryKey: ["x"], queryFn: fetchThing }] });
  const items = q.data?.items ?? [];
  return <span className="text-emerald-400">{items.length} up to date</span>;
}`;
// Correct fail-closed patterns that MUST NOT flag: early-return guards, a non-rendered
// console.log affirmation, a negated warning phrase, and a negated-error present guard.
const OK_GUARDS = `
import { useQuery } from "@tanstack/react-query";
export function Guarded() {
  const q = useQuery({ queryKey: ["x"], queryFn: fetchThing });
  console.log("All clear");
  if (!q.data) return <div>Loading…</div>;
  if (q.isError) return <div>unavailable</div>;
  const items = q.data.items ?? [];
  return (
    <div>
      <span className="text-emerald-400">{items.length} up to date</span>
      <div>Not all systems are operational yet</div>
      {!q.isError ? <span className="text-emerald-400">{items.length} ok</span> : null}
    </div>
  );
}`;
// Round-3 bug shapes (must flag).
const BUG_PENDING = `
import { useQuery } from "@tanstack/react-query";
export function Pending() {
  const q = useQuery({ queryKey: ["x"], queryFn: fetchThing });
  return <div>{!q.isError && <span>All clear</span>}</div>;   // isError false while pending
}`;
const BUG_COMPOUND = `
import { useQuery } from "@tanstack/react-query";
export function Compound({ flag }) {
  const q = useQuery({ queryKey: ["x"], queryFn: fetchThing });
  return <div>{(q.data || flag) ? <span>All clear</span> : null}</div>;   // flag can satisfy it
}`;
const BUG_FRAGMENT = `
import { useQuery } from "@tanstack/react-query";
export function Frag() {
  const q = useQuery({ queryKey: ["x"], queryFn: fetchThing });
  return <>All clear</>;
}`;
const BUG_ALIAS = `
import { useQuery as useRQ } from "@tanstack/react-query";
export function Aliased() {
  const q = useRQ({ queryKey: ["x"], queryFn: fetchThing });
  const items = q.data?.items ?? [];
  return <span className="text-emerald-400">{items.length} up to date</span>;
}`;
const BUG_ARIA = `
import { useQuery } from "@tanstack/react-query";
export function Aria() {
  const q = useQuery({ queryKey: ["x"], queryFn: fetchThing });
  return <span role="status" aria-label="All clear" />;
}`;
const BUG_NOREASON = `
import { useQuery } from "@tanstack/react-query";
export function NoReason() {
  const q = useQuery({ queryKey: ["x"], queryFn: fetchThing });
  return <div>All clear</div>; // unknown-ok:
}`;
// Round-3 correct shapes (must NOT flag).
const OK_NEGATIVE = `
import { useQuery } from "@tanstack/react-query";
export function Negative() {
  const q = useQuery({ queryKey: ["x"], queryFn: fetchThing });
  return <div><span>All systems are down</span><span>System not healthy</span></div>;
}`;
const OK_COMPOUND = `
import { useQuery } from "@tanstack/react-query";
export function OkCompound() {
  const q = useQuery({ queryKey: ["x"], queryFn: fetchThing });
  const items = q.data?.items ?? [];
  return <div>{(!q.data || q.isError) ? <div>loading</div> : <span className="text-emerald-400">{items.length} ok</span>}</div>;
}`;
const OK_CHILDPROP = `
import { useQuery } from "@tanstack/react-query";
export function Parent() {
  const { data } = useQuery({ queryKey: ["x"], queryFn: fetchThing });
  if (!data) return null;
  return <Child data={data} />;
}
function Child({ data }) {
  return <span className="text-emerald-400">{data.length} rows</span>;
}`;
const OK_REASON = `
import { useQuery } from "@tanstack/react-query";
export function Reasoned() {
  const q = useQuery({ queryKey: ["x"], queryFn: fetchThing });
  return <div>All clear</div>; // unknown-ok: static legend, not a live status
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

  // Isolated bug shapes (each fixture's only finding), added for Codex round 2.
  const absentClass = analyze(BUG_ABSENTCLASS, "ABSENTCLASS.tsx");
  console.log(`  self-test ABSENT-CLASS.tsx → ${absentClass.length}: ${absentClass.map((v) => v.kind).join(" ")}`);
  if (!absentClass.some((v) => v.kind === "good-class-on-unguarded-data")) { ok = false; console.error("  FAIL — emerald chosen by the data-absent branch was NOT caught (P1)"); }

  const negError = analyze(BUG_NEGERROR, "NEGERROR.tsx");
  console.log(`  self-test NEG-ERROR.tsx → ${negError.length}: ${negError.map((v) => v.kind).join(" ")}`);
  if (!negError.some((v) => v.kind === "affirmation-phrase")) { ok = false; console.error("  FAIL — conclusion on the negated-error path was NOT caught (P1)"); }

  const useQueriesBug = analyze(BUG_USEQUERIES, "USEQUERIES.tsx");
  console.log(`  self-test USEQUERIES.tsx → ${useQueriesBug.length}: ${useQueriesBug.map((v) => v.kind).join(" ")}`);
  if (!useQueriesBug.some((v) => v.kind === "good-class-on-unguarded-data")) { ok = false; console.error("  FAIL — useQueries array-destructured query was NOT registered (P2)"); }

  const fine = analyze(OK, "OK.tsx");
  console.log(`  self-test OK.tsx → ${fine.length} violation(s)`);
  if (fine.length !== 0) { ok = false; console.error("  FAIL — data-presence-gated component flagged (false positive):"); for (const v of fine) console.error(`    L${v.line} ${v.kind} ${v.snippet}`); }

  const guards = analyze(OK_GUARDS, "OK_GUARDS.tsx");
  console.log(`  self-test OK-GUARDS.tsx → ${guards.length} violation(s)`);
  if (guards.length !== 0) { ok = false; console.error("  FAIL — a correctly guarded component flagged (false positive: early-return / non-JSX / negated phrase):"); for (const v of guards) console.error(`    L${v.line} ${v.kind} ${v.snippet}`); }

  const plain = analyze(NONQUERY, "PLAIN.tsx");
  console.log(`  self-test NON-QUERY.tsx → ${plain.length} violation(s)`);
  if (plain.length !== 0) { ok = false; console.error("  FAIL — a component with no query hook was flagged (useState false positive)"); }

  // Round-3 bug shapes: each must produce at least one finding.
  const round3Bugs = [
    ["PENDING (!isError && All clear)", BUG_PENDING],
    ["COMPOUND ((data||flag) ? All clear)", BUG_COMPOUND],
    ["FRAGMENT (<>All clear</>)", BUG_FRAGMENT],
    ["ALIAS (useQuery as useRQ)", BUG_ALIAS],
    ["ARIA (aria-label='All clear')", BUG_ARIA],
    ["NO-REASON (// unknown-ok: with no reason)", BUG_NOREASON],
  ];
  for (const [label, src] of round3Bugs) {
    const v = analyze(src, "R3.tsx");
    console.log(`  self-test R3 ${label} → ${v.length}: ${v.map((x) => x.kind).join(" ")}`);
    if (v.length === 0) { ok = false; console.error(`  FAIL — round-3 bug not caught: ${label}`); }
  }
  // Round-3 correct shapes: each must produce zero findings.
  const round3Ok = [
    ["NEGATIVE (All systems are down / not healthy)", OK_NEGATIVE],
    ["COMPOUND ((!data||isError) ? loading : good)", OK_COMPOUND],
    ["CHILD-PROP (Child({data}))", OK_CHILDPROP],
    ["REASON (// unknown-ok: <reason>)", OK_REASON],
  ];
  for (const [label, src] of round3Ok) {
    const v = analyze(src, "R3OK.tsx");
    console.log(`  self-test R3-OK ${label} → ${v.length} violation(s)`);
    if (v.length !== 0) { ok = false; console.error(`  FAIL — round-3 false positive: ${label}`); for (const x of v) console.error(`    L${x.line} ${x.kind} ${x.snippet}`); }
  }

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
