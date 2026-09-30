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
// PER-QUERY PROVENANCE (2026-09-30, closes Codex P1-7 within one component): every tracked
// name carries the set of query ORIGINS (hook calls) it descends from, and a guard proves
// data present only for the query it tests. On a multi-query page, a presence guard on
// query A no longer covers a good-state render of query B's data.
// CONST-CLASS RESOLUTION (2026-09-30, closes Codex P2-5): a good-state class hoisted into a
// `const` (a literal, template literal, `clsx`/`cn` call or ternary of those) is resolved
// through lexical scope before the class match, so `className={GOOD}` is judged as inline.
//
// KNOWN, DELIBERATE LIMITATION (conservative — it UNDER-flags, never over-flags; the
// widened doctrine review still covers it, and it has a BUILD_BACKLOG follow-up):
//   - Provenance does not cross component/file boundaries: a value extracted into a child
//     presentation component (`<Panel items={items} />`) is analysed in the child without
//     its parent's query origin. A false NEGATIVE, not a false positive. Object-map classes
//     (`TONE[status]`) are not resolved either.
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

  // PER-QUERY PROVENANCE (backlog "two conservative false-negatives", P1-7). Every
  // tracked name maps to the SET of query ORIGINS it descends from — one origin per hook
  // call (its declaration's position). A guard proves data present only for the origins it
  // tests, so a presence guard on query A no longer covers a render of query B's data.
  const queryObjVars = new Map();   // const q = useQuery(...)                      name -> origins
  const dataVars = new Map();        // destructured `data`, and vars derived from query data
  const statusVars = new Map();      // destructured isError/error/isLoading/isSuccess/status/... vars
  const errorLoadingVars = new Map(); // the subset that means the query FAILED or is not ready
  const errorVars = new Map();         // error flags specifically
  const loadingVars = new Map();       // loading/pending/fetching flags specifically
  let usesQueryHook = false;
  const addOrigins = (map, name, origins) => {
    let set = map.get(name);
    if (!set) { set = new Set(); map.set(name, set); }
    const before = set.size;
    for (const o of origins) set.add(o);
    return set.size !== before;
  };
  const noteStatusLocal = (prop, local, origins) => {
    let changed = addOrigins(statusVars, local, origins);
    if (ERROR_LOADING.has(prop)) changed = addOrigins(errorLoadingVars, local, origins) || changed;
    if (ERROR_MEMBERS.has(prop)) changed = addOrigins(errorVars, local, origins) || changed;
    if (LOADING_MEMBERS.has(prop)) changed = addOrigins(loadingVars, local, origins) || changed;
    return changed;
  };
  // `origin === undefined` means "any query" — the pre-provenance behaviour, used where a
  // marker renders no query data of its own to attribute.
  const inOrigin = (set, origin) => origin === undefined || (set !== undefined && set.has(origin));

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
      const origin = [decl.pos];
      for (const el of decl.name.elements) {
        const prop = propOf(el);
        const local = ts.isIdentifier(el.name) ? el.name.text : undefined;
        if (!prop || !local) continue;
        if (prop === "data") addOrigins(dataVars, local, origin);
        else if (QUERY_DESTRUCTURE.has(prop)) noteStatusLocal(prop, local, origin);
      }
    } else if (ts.isIdentifier(decl.name) && family) {
      usesQueryHook = true;
      addOrigins(queryObjVars, decl.name.text, [decl.pos]);
    } else if (ts.isArrayBindingPattern(decl.name) && family) {
      // `const [q] = useQueries(...)` — each element is a query-result object, and each is
      // its own origin. (Codex P2.)
      usesQueryHook = true;
      for (const el of decl.name.elements) {
        if (ts.isBindingElement(el) && ts.isIdentifier(el.name)) addOrigins(queryObjVars, el.name.text, [el.pos]);
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

  // The query origins a subtree's query-state references descend from.
  const originsIn = (n) => {
    const out = new Set();
    const walk = (x) => {
      if (!x) return;
      if (ts.isIdentifier(x) && !isMemberName(x)) {
        for (const m of [queryObjVars, dataVars, statusVars]) for (const o of m.get(x.text) ?? []) out.add(o);
      }
      ts.forEachChild(x, walk);
    };
    walk(n);
    return out;
  };

  // Derived-from-data vars, to a fixpoint. Handles `const s = q.data?.x ?? []` and a later
  // `const { data: d, isError: e } = q` destructure of a query-object var. (Codex P2.) Each
  // derived var inherits the origins of everything it was derived from.
  for (let changed = true, guard = 0; changed && guard < 8; guard++) {
    changed = false;
    const p2 = (n) => {
      if (ts.isVariableDeclaration(n) && n.initializer) {
        if (ts.isIdentifier(n.name) && !queryObjVars.has(n.name.text) && !statusVars.has(n.name.text) && referencesQueryState(n.initializer)) {
          if (addOrigins(dataVars, n.name.text, originsIn(n.initializer))) changed = true;
        } else if (ts.isObjectBindingPattern(n.name) && referencesQueryState(n.initializer)) {
          const origins = originsIn(n.initializer);
          for (const el of n.name.elements) {
            const prop = propOf(el);
            const local = ts.isIdentifier(el.name) ? el.name.text : undefined;
            if (!prop || !local) continue;
            if (prop === "data") { if (addOrigins(dataVars, local, origins)) changed = true; }
            else if (QUERY_DESTRUCTURE.has(prop) && !dataVars.has(local)) { if (noteStatusLocal(prop, local, origins)) changed = true; }
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
  const referencesFlag = (n, memberSet, varSet, origin) => {
    let hit = false;
    const walk = (x) => {
      if (hit || !x) return;
      if (ts.isIdentifier(x) && !isMemberName(x) && varSet.has(x.text) && inOrigin(varSet.get(x.text), origin)) { hit = true; return; }
      if (ts.isPropertyAccessExpression(x) && ts.isIdentifier(x.expression) &&
          queryObjVars.has(x.expression.text) && memberSet.has(x.name.text) && inOrigin(queryObjVars.get(x.expression.text), origin)) { hit = true; return; }
      ts.forEachChild(x, walk);
    };
    walk(n);
    return hit;
  };
  // referencesQueryData: subtree references the query's DATA specifically (a `data`/derived
  // var, or `queryObj.data`) — NOT an error/loading flag, NOT a bare query object. With an
  // `origin`, only data descending from THAT query counts.
  const referencesQueryData = (n, origin) => {
    let hit = false;
    const walk = (x) => {
      if (hit || !x) return;
      if (ts.isIdentifier(x) && !isMemberName(x) && dataVars.has(x.text) && inOrigin(dataVars.get(x.text), origin)) { hit = true; return; }
      if (ts.isPropertyAccessExpression(x) && ts.isIdentifier(x.expression) &&
          queryObjVars.has(x.expression.text) && x.name.text === "data" && inOrigin(queryObjVars.get(x.expression.text), origin)) { hit = true; return; }
      ts.forEachChild(x, walk);
    };
    walk(n);
    return hit;
  };
  const isNullish = (x) => (ts.isIdentifier(x) && x.text === "undefined") || x.kind === ts.SyntaxKind.NullKeyword;
  const isDataPresenceAtom = (n, origin) => referencesQueryData(n, origin) && !referencesErrorLoading(n);
  const isErrorAtom = (n) => referencesErrorLoading(n) && !referencesQueryData(n);
  const eqNullishDataSide = (n, origin) =>
    (referencesQueryData(n.left, origin) && isNullish(n.right)) || (referencesQueryData(n.right, origin) && isNullish(n.left));

  // PER-BRANCH boolean model. One polarity per test cannot read `&&`/`||` correctly, and
  // `!isError` is ALSO true while a query is still pending — so it is never proof of data.
  // dataPresentWhen(test, branchValue): does `test` evaluating to branchValue GUARANTEE the
  // data is present? dataAbsentWhen: does it guarantee absent/errored? (Codex P1/P2.)
  const K = ts.SyntaxKind;
  const dataPresentWhen = (test, bv, origin) => {
    if (!test) return false;
    if (ts.isParenthesizedExpression(test)) return dataPresentWhen(test.expression, bv, origin);
    if (ts.isPrefixUnaryExpression(test) && test.operator === K.ExclamationToken) return dataPresentWhen(test.operand, !bv, origin);
    if (ts.isBinaryExpression(test)) {
      const op = test.operatorToken.kind;
      if (op === K.AmpersandAmpersandToken) return bv ? (dataPresentWhen(test.left, true, origin) || dataPresentWhen(test.right, true, origin)) : false;
      if (op === K.BarBarToken) return !bv ? (dataPresentWhen(test.left, false, origin) || dataPresentWhen(test.right, false, origin)) : false;
      if (op === K.EqualsEqualsEqualsToken || op === K.EqualsEqualsToken) return eqNullishDataSide(test, origin) ? bv === false : false;
      if (op === K.ExclamationEqualsEqualsToken || op === K.ExclamationEqualsToken) return eqNullishDataSide(test, origin) ? bv === true : false;
      return false;
    }
    if (isDataPresenceAtom(test, origin)) return bv === true;
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
  const flagFalseWhen = (test, bv, memberSet, varSet, origin) => {
    if (!test) return false;
    if (ts.isParenthesizedExpression(test)) return flagFalseWhen(test.expression, bv, memberSet, varSet, origin);
    if (ts.isPrefixUnaryExpression(test) && test.operator === K.ExclamationToken) return flagFalseWhen(test.operand, !bv, memberSet, varSet, origin);
    if (ts.isBinaryExpression(test)) {
      const op = test.operatorToken.kind;
      if (op === K.AmpersandAmpersandToken) return bv ? (flagFalseWhen(test.left, true, memberSet, varSet, origin) || flagFalseWhen(test.right, true, memberSet, varSet, origin)) : false;
      if (op === K.BarBarToken) return !bv ? (flagFalseWhen(test.left, false, memberSet, varSet, origin) || flagFalseWhen(test.right, false, memberSet, varSet, origin)) : false;
      return false;
    }
    if (referencesFlag(test, memberSet, varSet, origin) && !referencesQueryData(test)) return bv === false;
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
  // not-loading ⇒ data present). With `origins` (the queries whose data the render shows),
  // EVERY one of them must be proven present by a guard on that same query; without, any
  // query's guard counts (a marker that renders no query data of its own).
  const isHandled = (node, origins) => {
    const branches = governingBranches(node);
    const provenFor = (origin) => {
      let present = false, notError = false, notLoading = false;
      for (const b of branches) {
        if (dataPresentWhen(b.test, b.bv, origin)) present = true;
        if (flagFalseWhen(b.test, b.bv, ERROR_MEMBERS, errorVars, origin)) notError = true;
        if (flagFalseWhen(b.test, b.bv, LOADING_MEMBERS, loadingVars, origin)) notLoading = true;
      }
      return present || (notError && notLoading);
    };
    if (!origins || origins.size === 0) return provenFor(undefined);
    for (const o of origins) if (!provenFor(o)) return false;
    return true;
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
  // Each data reference is judged against ITS OWN query origins: a `rows` derived from query
  // B inside `a.data ? … : …` is NOT handled, because the guard tests query A. (P1-7.)
  const elementHasUnguardedDataRender = (jsxElement) => {
    let hit = false;
    const walk = (x) => {
      if (hit || !x) return;
      if (ts.isJsxAttribute(x) && ts.isIdentifier(x.name) && HANDLER_ATTR.test(x.name.text)) return; // skip onClick/onChange/…
      if (ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken &&
          referencesQueryData(x.left) && !isHandled(x, originsIn(x.left)) && !inGuardTest(x)) { hit = true; return; }
      if (ts.isIdentifier(x) && !isMemberName(x) && dataVars.has(x.text) && !boundAsParamInEnclosingFn(x) && !isHandled(x, dataVars.get(x.text)) && !inGuardTest(x)) { hit = true; return; }
      if (ts.isPropertyAccessExpression(x) && ts.isIdentifier(x.expression) &&
          queryObjVars.has(x.expression.text) && x.name.text === "data" && !isHandled(x, queryObjVars.get(x.expression.text)) && !inGuardTest(x)) { hit = true; return; }
      ts.forEachChild(x, walk);
    };
    walk(jsxElement);
    return hit;
  };
  // The query origins whose DATA an element renders (not guard tests, not handlers, not a
  // same-named prop). A good-state marker on that element must be proven present for all of
  // them; an element that renders no query data yields none, and any query's guard counts.
  const elementDataOrigins = (jsxElement) => {
    const out = new Set();
    if (!jsxElement) return out;
    const walk = (x) => {
      if (!x) return;
      if (ts.isJsxAttribute(x) && ts.isIdentifier(x.name) && HANDLER_ATTR.test(x.name.text)) return;
      if (ts.isIdentifier(x) && !isMemberName(x) && dataVars.has(x.text) && !boundAsParamInEnclosingFn(x) && !inGuardTest(x)) {
        for (const o of dataVars.get(x.text)) out.add(o);
      }
      if (ts.isPropertyAccessExpression(x) && ts.isIdentifier(x.expression) &&
          queryObjVars.has(x.expression.text) && x.name.text === "data" && !inGuardTest(x)) {
        for (const o of queryObjVars.get(x.expression.text)) out.add(o);
      }
      ts.forEachChild(x, walk);
    };
    walk(jsxElement);
    return out;
  };

  // CONST-CLASS RESOLUTION (backlog "two conservative false-negatives", P2-5). A class
  // string hoisted into a `const` — a literal, a template literal, a `clsx`/`cn` call, or a
  // ternary of those — is resolved to its initializer through lexical scope (the nearest
  // enclosing block or the module that declares it), so `className={GOOD}` is judged as if
  // the literal were inline. Object maps (`TONE[status]`) are not resolved.
  const RESOLVABLE_INIT = (n) => n && (ts.isStringLiteralLike(n) || ts.isNoSubstitutionTemplateLiteral(n) ||
    ts.isTemplateExpression(n) || ts.isCallExpression(n) || ts.isConditionalExpression(n) ||
    ts.isParenthesizedExpression(n) || ts.isBinaryExpression(n) ||
    // `"…" as const`, `"…" satisfies string`, `<string>"…"`, `x!`, and an alias `const GOOD = BASE`.
    ts.isAsExpression(n) || ts.isSatisfiesExpression(n) || ts.isTypeAssertionExpression(n) ||
    ts.isNonNullExpression(n) || ts.isIdentifier(n));
  // Does this scope bind `name` as something OTHER than a const we can resolve — a
  // parameter, a `let`/`var`, a destructured binding, a catch variable? Then the name
  // at the use site is that binding, and resolution must stop (no false positive
  // from `rows.map((cls) => <span className={cls}>…`).
  const bindsNameOpaquely = (scope, name) => {
    const bindsIn = (b) => ts.isIdentifier(b) ? b.text === name
      : (ts.isObjectBindingPattern(b) || ts.isArrayBindingPattern(b)) && b.elements.some((el) => !ts.isOmittedExpression(el) && bindsIn(el.name));
    if (ts.isFunctionLike(scope) && scope.parameters?.some((p) => bindsIn(p.name))) return true;
    if (ts.isCatchClause(scope) && scope.variableDeclaration && bindsIn(scope.variableDeclaration.name)) return true;
    if ((ts.isForStatement(scope) || ts.isForOfStatement(scope) || ts.isForInStatement(scope)) &&
        scope.initializer && ts.isVariableDeclarationList(scope.initializer) &&
        scope.initializer.declarations.some((d) => bindsIn(d.name))) return true;
    return false;
  };
  const resolveConstInit = (id) => {
    for (let cur = id.parent; cur; cur = cur.parent) {
      if (bindsNameOpaquely(cur, id.text)) return null;
      const stmts = ts.isBlock(cur) || ts.isSourceFile(cur) ? cur.statements : null;
      if (!stmts) continue;
      for (const st of stmts) {
        if (!ts.isVariableStatement(st)) continue;
        const isConst = Boolean(st.declarationList.flags & ts.NodeFlags.Const);
        for (const d of st.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.name.text === id.text) return isConst && RESOLVABLE_INIT(d.initializer) ? d.initializer : null;
          if (!ts.isIdentifier(d.name) && (ts.isObjectBindingPattern(d.name) || ts.isArrayBindingPattern(d.name)) &&
              d.name.elements.some((el) => !ts.isOmittedExpression(el) && ts.isIdentifier(el.name) && el.name.text === id.text)) return null;
        }
      }
    }
    return null;
  };
  // Returns [{ node, use }]: `node` is the good-class string, `use` is the node at the JSX
  // site (the string itself when inline; the identifier when resolved through a const).
  const goodClassStringNodes = (attr) => {
    const found = [];
    const walk = (x, use, depth) => {
      if (!x) return;
      if ((ts.isStringLiteralLike(x) || ts.isNoSubstitutionTemplateLiteral(x)) && GOOD_CLASS.test(x.text)) found.push({ node: x, use: use ?? x });
      if (ts.isTemplateExpression(x) && (GOOD_CLASS.test(x.head.text) || x.templateSpans.some((s) => GOOD_CLASS.test(s.literal.text)))) found.push({ node: x, use: use ?? x });
      if (ts.isIdentifier(x) && !isMemberName(x) && depth < 4) {
        const init = resolveConstInit(x);
        if (init) walk(init, use ?? x, depth + 1);
      }
      ts.forEachChild(x, (c) => walk(c, use, depth));
    };
    walk(attr, undefined, 0);
    return found;
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
        const origins = elementDataOrigins(enclosingJsxElement(n));
        if (unnegatedMatch(STRONG_AFFIRMATIONS, t) && !isHandled(n, origins)) {
          report(n, "affirmation-phrase", t);
        } else if (unnegatedMatch(WEAK_CONCLUSIONS, t) && !isHandled(n, origins)) {
          const el = enclosingJsxElement(n);
          if (el && elementHasUnguardedDataRender(el)) report(n, "weak-conclusion-on-unguarded-data", t);
        }
      }
    }
    // Good-state className on a JSX attribute.
    if (ts.isJsxAttribute(n) && ts.isIdentifier(n.name) &&
        (n.name.text === "className" || n.name.text === "accent" || n.name.text === "dot" || n.name.text === "text")) {
      const el = enclosingJsxElement(n);
      const origins = elementDataOrigins(el);
      for (const { node: strNode, use } of goodClassStringNodes(n)) {
        // Handled by a guard around the class string itself (inside a resolved const's
        // ternary) or around its use at the JSX site — for the queries this element renders.
        if (isHandled(strNode, origins) || (use !== strNode && isHandled(use, origins))) continue;
        // Report when the good class is chosen by the data-ABSENT branch (painted on
        // unknown), OR when the element renders unguarded query data.
        if (inAbsentDataBranch(strNode) || inAbsentDataBranch(use) || (el && elementHasUnguardedDataRender(el))) {
          report(use, "good-class-on-unguarded-data", strNode.text || (use !== strNode ? use.getText(sf) : "emerald"));
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

// Backlog "two conservative false-negatives" (2026-09-30). Must flag:
const BUG_TWOQUERY = `
import { useQuery } from "@tanstack/react-query";
export function TwoQuery() {
  const a = useQuery({ queryKey: ["a"], queryFn: fa });
  const b = useQuery({ queryKey: ["b"], queryFn: fb });
  const rows = b.data?.rows ?? [];
  return <div>{a.data ? <span className="text-emerald-400">{rows.length} rows</span> : null}</div>;
}`;
const BUG_CONSTCLASS = `
import { useQuery } from "@tanstack/react-query";
const GOOD = "text-emerald-400";
export function ConstClass() {
  const q = useQuery({ queryKey: ["a"], queryFn: fa });
  const rows = q.data?.rows ?? [];
  return <span className={GOOD}>{rows.length} rows</span>;
}`;
const BUG_TEMPLATECONST = `
import { useQuery } from "@tanstack/react-query";
export function TemplateConst({ size }) {
  const q = useQuery({ queryKey: ["a"], queryFn: fa });
  const rows = q.data?.rows ?? [];
  const cls = \`px-2 \${size} text-emerald-400\`;
  return <span className={cls}>{rows.length} rows</span>;
}`;
// …and the correctly guarded versions must NOT flag:
const OK_TWOQUERY_BOTH = `
import { useQuery } from "@tanstack/react-query";
export function TwoBoth() {
  const a = useQuery({ queryKey: ["a"], queryFn: fa });
  const b = useQuery({ queryKey: ["b"], queryFn: fb });
  const rows = b.data?.rows ?? [];
  return <div>{a.data && b.data ? <span className="text-emerald-400">{rows.length} rows</span> : null}</div>;
}`;
const OK_TWOQUERY_OWN = `
import { useQuery } from "@tanstack/react-query";
export function TwoOwn() {
  const a = useQuery({ queryKey: ["a"], queryFn: fa });
  const b = useQuery({ queryKey: ["b"], queryFn: fb });
  const rows = b.data?.rows ?? [];
  if (!a.data) return null;
  return <div>{b.data ? <span className="text-emerald-400">{rows.length} rows</span> : null}</div>;
}`;
const OK_CONSTCLASS_GUARDED = `
import { useQuery } from "@tanstack/react-query";
const GOOD = "text-emerald-400";
export function ConstGuarded() {
  const q = useQuery({ queryKey: ["a"], queryFn: fa });
  const rows = q.data?.rows ?? [];
  return q.data ? <span className={GOOD}>{rows.length} rows</span> : <span>-</span>;
}`;
const OK_CONSTTERNARY = `
import { useQuery } from "@tanstack/react-query";
export function ConstTernary() {
  const q = useQuery({ queryKey: ["a"], queryFn: fa });
  const s = q.data;
  const cls = s ? "text-emerald-400" : "text-muted";
  return <span className={cls}>{s ? String(s.n) : "-"}</span>;
}`;
const OK_CONSTSTATIC = `
import { useQuery } from "@tanstack/react-query";
const GOOD = "text-emerald-400";
export function ConstStatic() {
  const q = useQuery({ queryKey: ["a"], queryFn: fa });
  return <span className={GOOD}>Vendor-integrated</span>;
}`;
const OK_CONSTSHADOWED = `
import { useQuery } from "@tanstack/react-query";
const GOOD = "text-emerald-400";
export function ConstShadowed() {
  const q = useQuery({ queryKey: ["a"], queryFn: fa });
  const rows = q.data?.rows ?? [];
  const GOOD = "text-slate-400";
  return <span className={GOOD}>{rows.length} rows</span>;
}`;

// Brain review of #1274: const forms the first resolution pass missed, and a parameter
// that shadows a good-state const.
const constFixture = (pre, cls) => `
import { useQuery } from "@tanstack/react-query";
${pre}
export function ConstForm() {
  const q = useQuery({ queryKey: ["a"], queryFn: fa });
  const rows = q.data?.rows ?? [];
  return <span className={${cls}}>{rows.length} rows</span>;
}`;
const BUG_ASCONST = constFixture(`const GOOD = "text-emerald-400" as const;`, "GOOD");
const BUG_SATISFIES = constFixture(`const GOOD = "text-emerald-400" satisfies string;`, "GOOD");
const BUG_CONSTALIAS = constFixture(`const BASE = "text-emerald-400";\nconst GOOD = BASE;`, "GOOD");
const OK_PARAMSHADOW = `
import { useQuery } from "@tanstack/react-query";
const cls = "text-emerald-400";
export function ParamShadow() {
  const q = useQuery({ queryKey: ["a"], queryFn: fa });
  const rows = q.data?.rows ?? [];
  return <div>{["text-slate-400"].map((cls) => <span className={cls}>{rows.length} rows</span>)}</div>;
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

  // Backlog "two conservative false-negatives" (2026-09-30): provenance + const-class.
  const fnBugs = [
    ["TWO-QUERY (guard on A, render of B)", BUG_TWOQUERY],
    ["CONST-CLASS (className={GOOD})", BUG_CONSTCLASS],
    ["TEMPLATE-CONST (const cls = `… emerald`)", BUG_TEMPLATECONST],
    ["AS-CONST (const GOOD = \"…emerald\" as const)", BUG_ASCONST],
    ["SATISFIES (const GOOD = \"…emerald\" satisfies string)", BUG_SATISFIES],
    ["CONST-ALIAS (const GOOD = BASE)", BUG_CONSTALIAS],
  ];
  for (const [label, src] of fnBugs) {
    const v = analyze(src, "FN.tsx");
    console.log(`  self-test FN ${label} → ${v.length}: ${v.map((x) => x.kind).join(" ")}`);
    if (!v.some((x) => x.kind === "good-class-on-unguarded-data")) { ok = false; console.error(`  FAIL — false-negative not closed: ${label}`); }
  }
  const fnOk = [
    ["TWO-QUERY guarded on both", OK_TWOQUERY_BOTH],
    ["TWO-QUERY each guarded on its own query", OK_TWOQUERY_OWN],
    ["CONST-CLASS under a data guard", OK_CONSTCLASS_GUARDED],
    ["CONST-TERNARY (const cls = s ? emerald : muted)", OK_CONSTTERNARY],
    ["CONST-CLASS static label, no data", OK_CONSTSTATIC],
    ["CONST-CLASS shadowed by a local non-good const", OK_CONSTSHADOWED],
    ["CONST-CLASS shadowed by an arrow parameter", OK_PARAMSHADOW],
  ];
  for (const [label, src] of fnOk) {
    const v = analyze(src, "FNOK.tsx");
    console.log(`  self-test FN-OK ${label} → ${v.length} violation(s)`);
    if (v.length !== 0) { ok = false; console.error(`  FAIL — false positive: ${label}`); for (const x of v) console.error(`    L${x.line} ${x.kind} ${x.snippet}`); }
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
