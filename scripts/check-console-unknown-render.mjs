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
// PROPS PROVENANCE (2026-10-01, backlog 2379 remainder (a)): `<Panel items={items} />` where
// `Panel` is a function component declared in the same file taints the matching destructured
// parameter when the call site passes query data no guard there proves present; the child's
// render is then judged with the parent's origins (a child-side `if (!items) return …`, or a
// parent-side `q.data ? <Panel …/> : null`, handles it).
// OBJECT-MAP CLASSES (same date, remainder (b)): `className={TONE[status]}` resolves a same-file
// const object literal; a lookup is unknown-safe only with an explicit non-good fallback
// (`?? TONE.default`, `?? "text-muted"`) — otherwise it is judged like an inline good class.
//
// Same-file shapes followed: arrow/function/`memo`/`forwardRef` components resolved by lexical
// scope (two same-named components in different scopes never share a taint); a destructured,
// renamed, rest, `props`-identifier or `{...spread}` parameter; `children`; a whole query object
// passed under any prop name (`query={q}`, `{...q}`); a good-state class handed down as a prop
// (`tone="…emerald"`, `tone={TONE[s]}`); a map reached through a const alias, a same-file
// helper, a nested `TONE.a[status]` or a `...BASE` spread. A map lookup is unknown-safe only
// with an explicit `??`/`||` fallback AND a key this analysis can show is a plain read of query
// data: a property/optional chain (never a `.length`/`.size` read), `String()` / `.toLowerCase()` /
// `.trim()` / `Array.from()`, a destructured binding without a default, a prop that EVERY call site
// it can see passes as a plain read, the first parameter of an array callback whose receiver is
// itself such a read (`rows ?? []`, optionally filtered / sliced / sorted). A binding stays plain only
// if EVERY reference to it is a known READ-ONLY use (a WHITELIST, so write forms need no list): an
// assignment / destructuring-assignment / `for…of|in` target, `++`, an argument to an unknown function,
// `.bind`, `Array.prototype.push.call`, `Object.defineProperty`, an object/array literal member or a JSX
// prop hands the value away and is an ESCAPE. A rest element, a component with any reference other than
// a JSX tag (an alias, a direct call, `createElement`, `cloneElement`, `memo(C)`, an `export`), and a map
// with an `undefined`/`null` entry (an absent key HITS it) earn no exemption. FAIL-CLOSED: anything this
// analysis cannot show plain — a literal, a `??`/ternary default, a helper / `useMemo` result, a
// destructuring or parameter default, a member read of another const, a template with literal text, a
// defaulted or augmented array — earns no exemption. This is a conservative HEURISTIC, not a proof:
// each rule exists because a fixture showed the shape it closes. The self-test carries a write-form matrix
// (every write form × a scalar / parameter / container / object binding, each flagged; each read-only
// twin clean). Mutation testing is NOT exhaustive: a generated mutant set leaves survivors that no
// known shape distinguishes (see docs/BUILD_BACKLOG.md for the exact figures).
//
// KNOWN, DELIBERATE LIMITATIONS (a static, name-and-scope analysis; it can err in BOTH directions):
//   - Cross-file: a child component, helper or class map IMPORTED from another file is not
//     followed (no module resolver). An EXPORTED component's call sites in other files are
//     unseen, so it is never treated as plain. A component reached only through a wrapper
//     (`const W = withX(C); <W …/>`) does not taint C's props. False NEGATIVES for imports and wrappers.
//   - A callback parameter over query rows is recognised only as a plain KEY, not tracked as DATA:
//     `rows.map((r) => <li className="…emerald">{r.name}</li>)` is missed, as is a class assembled
//     from a prop (`text-${tone}-400`). False negatives. Data fields destructured OUT of `q.data`
//     (`const { name } = q.data ?? {}`) are likewise not tracked (pre-existing).
//   - Query data mutated IN PLACE through another path (`seed(q.data.rows)`) is not seen by the
//     read-only whitelist, which judges a binding by its own references. The `arguments` object aliases
//     a callback's array as a 3rd parameter does and is not followed (a rest parameter is). A key that is a fixed
//     string by construction (`d.toString()` over `q.data ?? {}`) is not recognised. Global state is
//     not modelled: `Object.prototype.s = "ok"`, `globalThis.String = …`, a `Proxy`-wrapped or
//     `new Map(…)` class map (only a same-file const object LITERAL is resolved). A key whose
//     map entry is a getter/method is resolved by its body; a computed key it cannot read is
//     treated as matching every lookup. A class static-field map and a `let` map are not resolved; a map built by a call
//     (`const T = makeMap()`, `Object.fromEntries(…)`, `useMemo(…)`) is judged as a class string, not as a map
//     (it flags, an over-flag); `new Map(…)` and an opaque `Object.entries(x).forEach(([k, v]) => { T[k] = v })` are silent. A map's WRITES are a whitelist:
//     any reference to its name (or an alias in the same file) that is not a plain read — `T.x`,
//     `T[k]`, `...T`, `k in T`, `Object.keys/values/entries(T)`, `const { a } = T` — is an
//     unreadable possibly-good entry, so the lookup is flagged (fail-closed over-flag: passing
//     the map to ANY function, even a read-only one, flags it). A component's props reached through
//     the `arguments` object (`arguments[0].s = "ok"`) are not seen; `props.s = …` is.
//   - react-query `initialData` / `placeholderData` make `q.data` a literal while the real state is
//     unknown; a presence guard and a plain-read key are both fooled (pre-existing, gate-wide).
//     `Component.defaultProps` is not followed (ignored by React 19, which this repo pins).
//   - A tainted `props` identifier or `{...spread}` taints the whole parameter, not one prop, and
//     taint is keyed by parameter name within the file — a possible false POSITIVE, never
//     silent: it surfaces as a finding the author can read and exempt with `// unknown-ok:`.
//   - Fail-closed OVER-FLAGS, never silent: a shadowing parameter or `catch (s)` of the same name, or a
//     `var` / `function` redeclaration, is treated as a rebinding of the binding (the analysis keys
//     bindings by name within a scope, not by full lexical resolution); a key that defaults to a NON-good entry
//     (`T[s ?? "bad"] ?? T.d`); a row transform that keeps every element (`.flatMap((x) => [x])`);
//     `rows[0]` / `rows.join()` / `.length` / `.size` / `.at()` / `.with()` keys; an array as a KEY
//     (`TONE[rows.slice()]`, `Array.from(rows)` — `String([])` is ""); `[...rows].reverse()[0]`,
//     `structuredClone(rows)`; a query-derived value handed to an unknown method
//     (`q.data.rows.reduce(…)`), which makes `q` itself non-plain.
//   - A map with a computed/dynamic entry list, or a helper that returns a parameter, is not
//     resolved.
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
// Likewise a JSX attribute name (`<Metric value={…} />`) and an object-literal key are names, not
// reads — once a prop is tracked as data, `value=` must not read as a render of it.
const isMemberName = (id) =>
  (ts.isPropertyAccessExpression(id.parent) && id.parent.name === id) ||
  (ts.isJsxAttribute(id.parent) && id.parent.name === id) ||
  (ts.isPropertyAssignment(id.parent) && id.parent.name === id);

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
  const hookDecls = new Set();       // the query-hook CALL nodes (their results are query state, not a default)
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
      usesQueryHook = true; hookDecls.add(decl.initializer);
      const origin = [decl.pos];
      for (const el of decl.name.elements) {
        const prop = propOf(el);
        const local = ts.isIdentifier(el.name) ? el.name.text : undefined;
        if (!prop || !local) continue;
        if (prop === "data") addOrigins(dataVars, local, origin);
        else if (QUERY_DESTRUCTURE.has(prop)) noteStatusLocal(prop, local, origin);
      }
    } else if (ts.isIdentifier(decl.name) && family) {
      usesQueryHook = true; hookDecls.add(decl.initializer);
      addOrigins(queryObjVars, decl.name.text, [decl.pos]);
    } else if (ts.isArrayBindingPattern(decl.name) && family) {
      // `const [q] = useQueries(...)` — each element is a query-result object, and each is
      // its own origin. (Codex P2.)
      usesQueryHook = true; hookDecls.add(decl.initializer);
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
  const deriveFixpoint = () => { for (let changed = true, guard = 0; changed && guard < 8; guard++) {
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
  } };
  deriveFixpoint();

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
  // PROPS PROVENANCE: a destructured parameter that receives unguarded query data from a
  // same-file `<Comp prop={data} />` call site is registered here and is NOT opaque — it IS
  // the query's data, so the child's render is judged against the parent's origins.
  const taintedParams = new Set();
  const boundAsParamInEnclosingFn = (node) => {
    const name = ts.isIdentifier(node) ? node.text : null;
    if (!name) return false;
    let cur = node.parent;
    while (cur && !ts.isSourceFile(cur)) {
      if (ts.isFunctionDeclaration(cur) || ts.isFunctionExpression(cur) || ts.isArrowFunction(cur) || ts.isMethodDeclaration(cur)) {
        for (const p of cur.parameters) {
          if (ts.isIdentifier(p.name) && p.name.text === name && !taintedParams.has(p)) return true;
          if (ts.isObjectBindingPattern(p.name)) {
            for (const el of p.name.elements) { if (ts.isIdentifier(el.name) && el.name.text === name && !taintedParams.has(el)) return true; }
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

  // DATA PROVENANCE ACROSS COMPONENT PROPS (backlog 2379 remainder (a)). `<Panel items={items} />`
  // where `Panel` is a function component declared in THIS file: if the call site passes query
  // data that no guard there proves present, the matching destructured parameter of `Panel`
  // becomes a data var carrying the same origins, so `Panel`'s render is judged exactly as if
  // it were inline — its own guard (`if (!items) return …`) handles it, its absence is the bug.
  // A call site that IS guarded (`q.data ? <Panel items={items} /> : null`) taints nothing.
  // Components defined in another file are not followed (no module resolver here).
  // A component is registered with its DECLARING scope, and a call site resolves the nearest
  // enclosing scope that declares that name — two same-named components in different scopes
  // never share a taint. `memo(…)` / `forwardRef(…)` wrappers are unwrapped.
  const localComponents = []; // { name, params, scope }
  const scopeOf = (n) => { let c = n.parent; while (c && !ts.isBlock(c) && !ts.isSourceFile(c)) c = c.parent; return c; };
  const componentFn = (init) => {
    let e = init;
    while (e && ts.isCallExpression(e) && (callName(e) === "memo" || callName(e) === "forwardRef") && e.arguments[0]) e = e.arguments[0];
    return e && (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) ? e : null;
  };
  {
    const reg = (n) => {
      if (ts.isFunctionDeclaration(n) && n.name && /^[A-Z]/.test(n.name.text)) localComponents.push({ name: n.name.text, params: n.parameters, scope: scopeOf(n), fn: n });
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && /^[A-Z]/.test(n.name.text) && n.initializer) {
        const fn = componentFn(n.initializer);
        if (fn) localComponents.push({ name: n.name.text, params: fn.parameters, scope: scopeOf(n), fn });
      }
      ts.forEachChild(n, reg);
    };
    reg(sf);
  }
  const findComponent = (tag) => {
    for (let c = tag.parent; c; c = c.parent) {
      if (!ts.isBlock(c) && !ts.isSourceFile(c)) continue;
      const hit = localComponents.find((k) => k.name === tag.text && k.scope === c);
      if (hit) return hit;
    }
    return undefined;
  };
  // Taint the receiving parameter. `propName === null` (a `{...p}` spread) taints every
  // binding of the first parameter; a rest element is tainted too; a plain `props` identifier
  // is tainted whole (so `props.items` reads as data).
  // A good-state CLASS handed to a same-file child through a prop (`<Pill tone="…emerald" n={…}/>`
  // with `className={tone}` in the child): the child binding is recorded with the class strings
  // the call site passes, and resolved where the child uses it as a class.
  var goodParams = new Map(); // binding element | parameter -> [{ node }]
  const bindingOfParam = (id) => {
    for (let c = id.parent; c; c = c.parent) {
      if (!(ts.isFunctionLike(c) && c.parameters)) continue;
      for (const p of c.parameters) {
        if (ts.isIdentifier(p.name) && p.name.text === id.text) return p;
        if (ts.isObjectBindingPattern(p.name)) for (const el of p.name.elements) if (ts.isIdentifier(el.name) && el.name.text === id.text) return el;
      }
    }
    return null;
  };
  const passQueryObject = (param, propName, origins) => {
    // The whole query object arrives (`query={q}` / `{...q}`): the receiving binding IS a query result.
    let changed = false;
    const mark = (node, local, prop) => {
      if (prop === "data") changed = addOrigins(dataVars, local, origins) || changed;
      else if (prop && QUERY_DESTRUCTURE.has(prop)) changed = noteStatusLocal(prop, local, origins) || changed;
      else changed = addOrigins(queryObjVars, local, origins) || changed;
      if (!taintedParams.has(node)) { taintedParams.add(node); changed = true; }
    };
    if (ts.isIdentifier(param.name)) mark(param, param.name.text, null);
    else if (ts.isObjectBindingPattern(param.name)) {
      for (const el of param.name.elements) {
        if (!ts.isIdentifier(el.name)) continue;
        if (propName === null) { if (QUERY_DESTRUCTURE.has(propOf(el))) mark(el, el.name.text, propOf(el)); }
        else if (propOf(el) === propName) mark(el, el.name.text, null);
      }
    }
    return changed;
  };
  const taintParam = (param, propName, origins) => {
    let changed = false;
    const mark = (node, localName) => {
      if (addOrigins(dataVars, localName, origins)) changed = true;
      if (!taintedParams.has(node)) { taintedParams.add(node); changed = true; }
    };
    if (ts.isIdentifier(param.name)) mark(param, param.name.text);
    else if (ts.isObjectBindingPattern(param.name)) {
      for (const el of param.name.elements) {
        if (!ts.isIdentifier(el.name)) continue;
        if (propName === null || el.dotDotDotToken || propOf(el) === propName) mark(el, el.name.text);
      }
    }
    return changed;
  };
  const propagateProps = () => {
    let changed = false;
    const pass = (tag, propName, expr) => {
      const comp = tag && ts.isIdentifier(tag) ? findComponent(tag) : undefined;
      // A prop expression that gates its own data (`s ? String(s.n) : "-"`) passes no unguarded data.
      if (comp && comp.params[0] && expr && elementHasUnguardedDataRender(expr) && taintParam(comp.params[0], propName, originsIn(expr))) changed = true;
    };
    const passQuery = (tag, propName, expr) => {
      const comp = tag && ts.isIdentifier(tag) ? findComponent(tag) : undefined;
      const e = expr && unwrapExpr(expr);
      if (comp && comp.params[0] && e && ts.isIdentifier(e) && queryObjVars.has(e.text) && !isHandled(e, originsIn(e)) &&
          passQueryObject(comp.params[0], propName, originsIn(e))) changed = true;
    };
    const passClass = (tag, propName, attr) => {
      const comp = tag && ts.isIdentifier(tag) ? findComponent(tag) : undefined;
      const param = comp && comp.params[0];
      if (!param || !ts.isObjectBindingPattern(param.name)) return;
      const found = goodClassStringNodes(attr);
      if (found.length === 0) return;
      for (const el of param.name.elements) {
        if (!ts.isIdentifier(el.name) || propOf(el) !== propName) continue;
        const have = goodParams.get(el) ?? [];
        for (const f of found) if (!have.some((h) => h.node === f.node)) { have.push({ node: f.node }); changed = true; }
        goodParams.set(el, have);
      }
    };
    const visit = (n) => {
      if (ts.isJsxAttribute(n) && ts.isIdentifier(n.name) && n.initializer) passClass(n.parent.parent.tagName, n.name.text, n);
      if (ts.isJsxAttribute(n) && ts.isIdentifier(n.name) && n.initializer && ts.isJsxExpression(n.initializer)) passQuery(n.parent.parent.tagName, n.name.text, n.initializer.expression);
      if (ts.isJsxSpreadAttribute(n)) passQuery(n.parent.parent.tagName, null, n.expression);
      if (ts.isJsxAttribute(n) && ts.isIdentifier(n.name) && n.initializer && ts.isJsxExpression(n.initializer)) pass(n.parent.parent.tagName, n.name.text, n.initializer.expression);
      if (ts.isJsxSpreadAttribute(n)) pass(n.parent.parent.tagName, null, n.expression);
      if (ts.isJsxElement(n)) for (const ch of n.children) if (ts.isJsxExpression(ch) && ch.expression) pass(n.openingElement.tagName, "children", ch.expression);
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return changed;
  };
  // CONST-CLASS RESOLUTION (backlog "two conservative false-negatives", P2-5). A class
  // string hoisted into a `const` — a literal, a template literal, a `clsx`/`cn` call, or a
  // ternary of those — is resolved to its initializer through lexical scope (the nearest
  // enclosing block or the module that declares it), so `className={GOOD}` is judged as if
  // the literal were inline. Object maps (`TONE[status]`) are not resolved.
  // A wrapper — `"…" as const`, `"…" satisfies string`, `<string>"…"`, `x!`, parens — is
  // resolvable only when what it WRAPS is: `{ ok: "…emerald…" } as const` is an object map,
  // and resolving it would flag `className={T.muted}` (a false positive). An identifier is
  // an alias (`const GOOD = BASE`) and resolves through its own binding.
  const RESOLVABLE_INIT = (n) => {
    if (!n) return false;
    if (ts.isAsExpression(n) || ts.isSatisfiesExpression(n) || ts.isTypeAssertionExpression(n) ||
        ts.isNonNullExpression(n) || ts.isParenthesizedExpression(n)) return RESOLVABLE_INIT(n.expression);
    return ts.isStringLiteralLike(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n) ||
      ts.isCallExpression(n) || ts.isConditionalExpression(n) || ts.isBinaryExpression(n) || ts.isIdentifier(n) ||
      ts.isElementAccessExpression(n) || ts.isPropertyAccessExpression(n);
  };
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
  const resolveConstInit = (id, accept = RESOLVABLE_INIT) => {
    for (let cur = id.parent; cur; cur = cur.parent) {
      if (bindsNameOpaquely(cur, id.text)) return null;
      const stmts = ts.isBlock(cur) || ts.isSourceFile(cur) ? cur.statements : null;
      if (!stmts) continue;
      for (const st of stmts) {
        if (!ts.isVariableStatement(st)) continue;
        const isConst = Boolean(st.declarationList.flags & ts.NodeFlags.Const);
        for (const d of st.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.name.text === id.text) return isConst && accept(d.initializer) ? d.initializer : null;
          if (!ts.isIdentifier(d.name) && (ts.isObjectBindingPattern(d.name) || ts.isArrayBindingPattern(d.name)) &&
              d.name.elements.some((el) => !ts.isOmittedExpression(el) && ts.isIdentifier(el.name) && el.name.text === id.text)) return null;
        }
      }
    }
    return null;
  };
  // OBJECT-MAP CLASS RESOLUTION (backlog 2379 remainder (b)). `className={TONE[status]}` where
  // `TONE` is a same-file `const` object literal (optionally `as const`/`satisfies`) holding a
  // good-state class: a literal key (`TONE.ok`, `TONE["ok"]`) resolves to that one entry; a
  // dynamic key may select ANY entry. The lookup is unknown-safe only when it carries an explicit
  // fallback — `TONE[status] ?? TONE.default`, `?? "text-muted"`. The fallback operand is itself
  // walked, so a good-state fallback (`?? TONE.ok`, `|| "…emerald"`) is flagged on its own. Anything else is judged like
  // an inline good class (flagged on unguarded query data). A map that is not a same-file const
  // object literal (imported, a parameter, `let`) is not resolved.
  const unwrapExpr = (n) => (ts.isAsExpression(n) || ts.isSatisfiesExpression(n) || ts.isTypeAssertionExpression(n) ||
    ts.isNonNullExpression(n) || ts.isParenthesizedExpression(n)) ? unwrapExpr(n.expression) : n;
  const mapObject = (id, depth = 0) => {
    if (depth > 6) return null;
    const init = resolveConstInit(id, (n) => n && (ts.isObjectLiteralExpression(unwrapExpr(n)) || ts.isIdentifier(unwrapExpr(n))));
    if (!init) return null;
    const u = unwrapExpr(init);
    return ts.isIdentifier(u) ? mapObject(u, depth + 1) : u; // `const T = T0;` follows the alias
  };
  // The object literal an expression denotes: a same-file const map, or a nested entry of one
  // (`TONE.a`, `TONE["a"]`).
  const mapObjectOf = (e, depth = 0) => {
    if (!e || depth > 6) return null;
    e = unwrapExpr(e);
    if (ts.isIdentifier(e)) return mapObject(e);
    if (ts.isObjectLiteralExpression(e)) return e; // `...{ undefined: "…" }`
    const lit = ts.isPropertyAccessExpression(e) ? e.name.text
      : ts.isElementAccessExpression(e) && e.argumentExpression && ts.isStringLiteralLike(e.argumentExpression) ? e.argumentExpression.text : null;
    if (lit === null) return null;
    const base = mapObjectOf(e.expression, depth + 1);
    if (!base) return null;
    for (const v of mapEntries(base, lit, depth + 1)) {
      const u = unwrapExpr(v);
      if (ts.isObjectLiteralExpression(u)) return u;
      if (ts.isIdentifier(u)) { const o = mapObject(u); if (o) return o; }
    }
    return null;
  };
  // Entries of a map: all of them (`lit === null`, a dynamic key) or the one literal key; a
  // `...BASE` spread of another same-file map contributes its entries.
  // The text of a member's key: `ok`, `"ok"`, `[K]` of a const string; null = a key this cannot read.
  const memberKey = (name) => {
    if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text;
    if (ts.isComputedPropertyName(name)) {
      const e = unwrapExpr(name.expression);
      if (ts.isStringLiteralLike(e) || ts.isNumericLiteral(e)) return e.text;
      if (ts.isIdentifier(e)) { const i = resolveConstInit(e); const u = i && unwrapExpr(i); if (u && ts.isStringLiteralLike(u)) return u.text; }
    }
    return null;
  };
  // Entries of a map: all of them (`lit === null`, a dynamic key) or the one literal key. A shorthand
  // entry reads its const; a method / getter contributes its body; a computed key this cannot read
  // MAY match any key, so it is included; a `...BASE` spread of another same-file map contributes its entries.
  const mapEntries = (obj, lit, depth = 0) => {
    const out = [];
    for (const p of obj.properties) {
      if (ts.isSpreadAssignment(p)) {
        const o = depth < 6 ? mapObjectOf(p.expression, depth + 1) : null;
        if (o) out.push(...mapEntries(o, lit, depth + 1));
        continue;
      }
      if (!p.name && !ts.isShorthandPropertyAssignment(p)) continue;
      const key = ts.isShorthandPropertyAssignment(p) ? p.name.text : memberKey(p.name);
      if (!(lit === null || key === null || key === lit)) continue;
      if (ts.isPropertyAssignment(p)) out.push(p.initializer);
      else if (ts.isShorthandPropertyAssignment(p)) out.push(p.name);
      else out.push(p); // a method / getter / setter: its body is walked for class strings
    }
    return out;
  };
  const rootIdent = (e) => { // `T.a.b[k]` -> the identifier `T`
    for (;;) {
      e = unwrapExpr(e);
      if (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e)) e = e.expression;
      else break;
    }
    return ts.isIdentifier(e) ? e : null;
  };
  // A map WRITTEN after its declaration — `T.default = "…"`, `T[k] = "…"`, `Object.assign(T, {…})`,
  // `Object.defineProperty(T, k, { value })`, `Reflect.set(T, k, v)` — carries entries the literal does not show.
  // Name-based over the whole file (the map and any alias of it); a key it cannot read matches every lookup.
  const mutationCache = new Map();
  const escapedMapRefs = new Set(); // a reference that may write the map: stands for an unreadable, possibly good-state entry
  const mapMutations = (names) => {
    const key = [...names].sort().join("|");
    if (mutationCache.has(key)) return mutationCache.get(key);
    const out = []; // { node, key } — key null = unreadable
    const handled = new Set(); // roots of the writes read precisely above
    const rootIs = (e) => { const r = rootIdent(e); return Boolean(r) && names.has(r.text); };
    const keyOf0 = (left) => (ts.isPropertyAccessExpression(left) ? left.name.text
      : ts.isElementAccessExpression(left) && ts.isStringLiteralLike(left.argumentExpression) ? left.argumentExpression.text : null);
    const keyOf = (left) => { const k = keyOf0(left); return k === "__proto__" ? null : k; }; // `__proto__` swaps the whole entry set
    const w = (n) => {
      if (ts.isBinaryExpression(n) && n.operatorToken.kind >= K.FirstAssignment && n.operatorToken.kind <= K.LastAssignment &&
          (ts.isPropertyAccessExpression(n.left) || ts.isElementAccessExpression(n.left)) && rootIs(n.left)) { handled.add(rootIdent(n.left)); out.push({ node: n.right, key: keyOf(n.left) }); }
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
        const obj = n.expression.expression, m = n.expression.name.text;
        if (ts.isIdentifier(obj) && obj.text === "Object" && (m === "assign" || m === "defineProperty") && n.arguments[0] && rootIs(n.arguments[0])) {
          handled.add(rootIdent(n.arguments[0]));
          for (const a of n.arguments.slice(1)) out.push({ node: a, key: null });
        }
        if (ts.isIdentifier(obj) && obj.text === "Reflect" && m === "set" && n.arguments[0] && rootIs(n.arguments[0])) {
          handled.add(rootIdent(n.arguments[0]));
          out.push({ node: n.arguments[2] ?? n, key: n.arguments[1] && ts.isStringLiteralLike(n.arguments[1]) ? n.arguments[1].text : null });
        }
      }
      ts.forEachChild(n, w);
    };
    w(sf);
    // WHITELIST: every other reference to the map's name must be a plain read — `T.x` / `T[k]` read, `...T`,
    // `k in T`, `Object.keys/values/entries(T)`, `const { a } = T`. Anything else (passed to a function, stored,
    // returned, an assignment/delete/update target, `(0, T)`, `Object["assign"](T)`, `Object.defineProperties(T)`,
    // `Reflect.defineProperty(T)`, `__proto__`) may write entries this file cannot see: an unreadable entry that
    // matches every lookup.
    // Is this node (a member access) the TARGET of an assignment — directly, or inside an object / array
    // destructuring pattern (`({ a: T.x } = v)`, `[{ a: T.x }] = v`, `({ ...T.x } = v)`, `for ({ a: T.x } of v)`)?
    const isAssignTarget = (n) => {
      for (let c = n, q = c.parent; q; c = q, q = c.parent) {
        if (ts.isParenthesizedExpression(q) || ts.isNonNullExpression(q) || ts.isAsExpression(q) || ts.isSatisfiesExpression(q)) continue;
        if (ts.isPropertyAssignment(q)) { if (q.initializer !== c) return false; continue; }
        if (ts.isShorthandPropertyAssignment(q) || ts.isObjectLiteralExpression(q) || ts.isArrayLiteralExpression(q) || ts.isSpreadAssignment(q) || ts.isSpreadElement(q)) continue;
        if (ts.isBinaryExpression(q)) return q.left === c && q.operatorToken.kind >= K.FirstAssignment && q.operatorToken.kind <= K.LastAssignment;
        if (ts.isForInStatement(q) || ts.isForOfStatement(q)) return q.initializer === c;
        return false;
      }
      return false;
    };
    const isRead = (id) => {
      let c = id, par = c.parent;
      while (par && (ts.isParenthesizedExpression(par) && par.expression === c ? false : (ts.isNonNullExpression(par) || ts.isAsExpression(par) || ts.isSatisfiesExpression(par)) && par.expression === c)) { c = par; par = c.parent; }
      if (!par) return false;
      if (ts.isSpreadAssignment(par) && par.expression === c) return true;
      if (ts.isBinaryExpression(par) && par.operatorToken.kind === K.InKeyword && par.right === c) return true;
      if (ts.isVariableDeclaration(par) && par.initializer === c) return ts.isObjectBindingPattern(par.name);
      if (ts.isCallExpression(par) && par.arguments[0] === c && ts.isPropertyAccessExpression(par.expression) &&
          ts.isIdentifier(par.expression.expression) && par.expression.expression.text === "Object" &&
          ["keys", "values", "entries"].includes(par.expression.name.text)) return true;
      if ((ts.isPropertyAccessExpression(par) || ts.isElementAccessExpression(par)) && par.expression === c) {
        if (ts.isPropertyAccessExpression(par) && par.name.text === "__proto__") return false;
        let t = par;
        for (;;) {
          const q = t.parent;
          if (!q) return true;
          if (isAssignTarget(t)) return false;
          if ((ts.isPropertyAccessExpression(q) || ts.isElementAccessExpression(q)) && q.expression === t) { t = q; continue; }
          if (ts.isNonNullExpression(q) || ts.isAsExpression(q) || ts.isSatisfiesExpression(q) || ts.isParenthesizedExpression(q)) { t = q; continue; }
          if (ts.isBinaryExpression(q) && q.left === t && q.operatorToken.kind >= K.FirstAssignment && q.operatorToken.kind <= K.LastAssignment) return false;
          if ((ts.isPrefixUnaryExpression(q) || ts.isPostfixUnaryExpression(q)) && (q.operator === K.PlusPlusToken || q.operator === K.MinusMinusToken)) return false;
          if (ts.isDeleteExpression(q)) return false;
          if (ts.isCallExpression(q) && q.expression === t) return false; // a method call on an entry / the map
          if (ts.isArrayLiteralExpression(q) || ts.isPropertyAssignment(q) && q.name === t) return false;
          if ((ts.isForInStatement(q) || ts.isForOfStatement(q)) && q.initializer === t) return false;
          if (ts.isObjectLiteralExpression(q) || ts.isShorthandPropertyAssignment(q)) return false;
          return true;
        }
      }
      return false;
    };
    const isAliasInit = (id) => ts.isVariableDeclaration(id.parent) && id.parent.initializer === id && ts.isIdentifier(id.parent.name) &&
      Boolean(id.parent.parent.flags & ts.NodeFlags.Const) && names.has(id.parent.name.text);
    const declNameOf = (id) => ts.isVariableDeclaration(id.parent) && id.parent.name === id;
    const isNameSlot = (id) => (ts.isPropertyAccessExpression(id.parent) && id.parent.name === id) ||
      (ts.isPropertyAssignment(id.parent) && id.parent.name === id) || ts.isJsxAttribute(id.parent) ||
      ts.isTypeQueryNode(id.parent) || ts.isTypeReferenceNode(id.parent) || ts.isBindingElement(id.parent) && id.parent.propertyName === id;
    const refs = (n) => {
      if (ts.isIdentifier(n) && names.has(n.text) && !declNameOf(n) && !isNameSlot(n) && !handled.has(n) && !isAliasInit(n) && !isRead(n)) { escapedMapRefs.add(n); out.push({ node: n, key: null }); }
      ts.forEachChild(n, refs);
    };
    refs(sf);
    mutationCache.set(key, out);
    return out;
  };
  const mapNamesOf = (x) => { // the map's names: the one used here and the declaration it resolves to
    const names = new Set();
    const root = rootIdent(x.expression);
    if (root) names.add(root.text);
    const obj = mapObjectOf(x.expression);
    for (let c = obj && obj.parent; c; c = c.parent) { if (ts.isVariableDeclaration(c) && ts.isIdentifier(c.name)) { names.add(c.name.text); break; } if (ts.isBlock(c) || ts.isSourceFile(c)) break; }
    return names;
  };
  const lookupEntries = (x) => { // x: ElementAccess | PropertyAccess over a resolvable map, else null
    const obj = mapObjectOf(x.expression);
    if (!obj) return null;
    const lit = ts.isPropertyAccessExpression(x) ? x.name.text
      : x.argumentExpression && ts.isStringLiteralLike(x.argumentExpression) ? x.argumentExpression.text : null;
    const extra = mapMutations(mapNamesOf(x)).filter((m) => lit === null || m.key === null || m.key === lit).map((m) => m.node);
    return [...mapEntries(obj, lit), ...extra];
  };
  const localFns = new Map(); // name -> function node (declaration or const arrow/function expression)
  {
    const reg = (n) => {
      if (ts.isFunctionDeclaration(n) && n.name && n.body) localFns.set(n.name.text, n);
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer &&
          (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) localFns.set(n.name.text, n.initializer);
      ts.forEachChild(n, reg);
    };
    reg(sf);
  }
  const returnExprs = (fn) => {
    if (!ts.isBlock(fn.body)) return [fn.body];
    const out = [];
    const v = (n) => {
      if (ts.isReturnStatement(n)) { if (n.expression) out.push(n.expression); return; }
      if (ts.isFunctionLike(n)) return;
      ts.forEachChild(n, v);
    };
    v(fn.body);
    return out;
  };
  // FAIL-CLOSED key rule. A fallback protects a lookup only if the KEY is provably a plain read
  // of query data — then unknown data yields an absent key and the fallback is what renders. Any
  // key this analysis cannot prove plain (a literal, a `??`/ternary default, a helper or `useMemo`
  // result, a destructuring or parameter default, a reassigned `let`, a member read of another
  // const, a callback parameter) might select a fixed entry, so the fallback does not protect it
  // and the lookup is judged like an inline good class. Over-flags a key that defaults to a
  // NON-good entry (`T[s ?? "bad"]`) — a finding the author reads and exempts with `// unknown-ok:`.
  const findBinding = (id) => {
    for (let c = id.parent; c; c = c.parent) {
      if (ts.isFunctionLike(c) && c.parameters) {
        for (const p of c.parameters) {
          if (ts.isIdentifier(p.name) && p.name.text === id.text) return { kind: "param", node: p };
          if (ts.isObjectBindingPattern(p.name)) for (const el of p.name.elements) if (ts.isIdentifier(el.name) && el.name.text === id.text) return { kind: "el", node: el, fromParam: true };
        }
      }
      if (!(ts.isBlock(c) || ts.isSourceFile(c))) continue;
      for (const st of c.statements) {
        if (ts.isFunctionDeclaration(st) && st.name && st.name.text === id.text) return { kind: "opaque" };
        if (!ts.isVariableStatement(st)) continue;
        const isConst = Boolean(st.declarationList.flags & ts.NodeFlags.Const);
        for (const d of st.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.name.text === id.text) return { kind: "var", decl: d, isConst, scope: c };
          if (ts.isObjectBindingPattern(d.name)) for (const el of d.name.elements) if (ts.isIdentifier(el.name) && el.name.text === id.text) return { kind: "el", node: el, decl: d, isConst, scope: c };
          if (ts.isArrayBindingPattern(d.name) && d.name.elements.some((el) => !ts.isOmittedExpression(el) && ts.isIdentifier(el.name) && el.name.text === id.text)) return { kind: "opaque" };
        }
      }
    }
    return null;
  };
  const ROW_METHODS = new Set(["map", "filter", "forEach", "flatMap", "find", "some", "every", "findLast", "sort"]);
  const isRowOfQueryData = (param) => {
    const fn = param.parent;
    if (!fn || !(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) || fn.parameters[0] !== param || param.initializer) return false;
    const call = fn.parent;
    return Boolean(call) && ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression) &&
      ROW_METHODS.has(call.expression.name.text) && keyIsPlainData(call.expression.expression);
  };
  // EVERY call site of a same-file component, per prop: a prop is a plain read of data only if
  // every site passes one (`s={q.data?.s}`); a literal, a defaulted expression, a spread or a
  // helper at ANY site means the receiving key can be a fixed entry.
  const siteCache = new Map();
  let cloneSeen;
  const cloneElementUsed = () => {
    if (cloneSeen === undefined) { cloneSeen = false; const w = (n) => { if (cloneSeen) return; if (ts.isIdentifier(n) && n.text === "cloneElement") cloneSeen = true; else ts.forEachChild(n, w); }; w(sf); }
    return cloneSeen;
  };
  const callSitesOf = (fn) => {
    if (siteCache.has(fn)) return siteCache.get(fn);
    const info = { byProp: new Map(), spread: false, count: 0 };
    const visit = (n) => {
      const opening = ts.isJsxSelfClosingElement(n) ? n : ts.isJsxElement(n) ? n.openingElement : null;
      if (opening && ts.isIdentifier(opening.tagName)) {
        const comp = findComponent(opening.tagName);
        if (comp && comp.fn === fn) {
          info.count++;
          for (const a of opening.attributes.properties) {
            if (ts.isJsxSpreadAttribute(a)) { info.spread = true; continue; }
            if (!ts.isJsxAttribute(a)) continue;
            const ex = a.initializer ? (ts.isJsxExpression(a.initializer) ? a.initializer.expression : a.initializer) : null;
            const nm = a.name.text;
            if (!info.byProp.has(nm)) info.byProp.set(nm, []);
            info.byProp.get(nm).push(ex);
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    // Any other reference to the component — an alias (`const D = C`), a direct call, `createElement`,
    // `memo(C)`, an array/object member, an `export` — is a call site this analysis cannot see.
    const comp = localComponents.find((k) => k.fn === fn);
    if (cloneElementUsed()) info.unseen = true; // `cloneElement(<C s=…/>, { s: "ok" })` overrides props the tag shows
    const exported = (decl) => Boolean(decl.modifiers && decl.modifiers.some((m) => m.kind === K.ExportKeyword));
    const declNode = comp && (ts.isFunctionDeclaration(fn) ? fn : fn.parent && ts.isVariableDeclaration(fn.parent) ? fn.parent : (fn.parent && fn.parent.parent && ts.isVariableDeclaration(fn.parent.parent) ? fn.parent.parent : null));
    const stmt = declNode && (ts.isVariableDeclaration(declNode) ? declNode.parent?.parent : declNode);
    if (!comp || !stmt || exported(stmt)) info.unseen = true;
    else {
      const scan = (n) => {
        if (ts.isIdentifier(n) && n.text === comp.name) {
          const par = n.parent;
          const isDecl = (ts.isFunctionDeclaration(par) || ts.isVariableDeclaration(par)) && par.name === n;
          const isTag = (ts.isJsxOpeningElement(par) || ts.isJsxSelfClosingElement(par) || ts.isJsxClosingElement(par)) && par.tagName === n;
          if (!isDecl && !isTag) info.unseen = true;
        }
        ts.forEachChild(n, scan);
      };
      scan(sf);
    }
    siteCache.set(fn, info);
    return info;
  };
  const paramSitesPlain = (fn, propName) => {
    const info = callSitesOf(fn);
    if (info.spread || info.unseen) return false;
    const exprs = propName === null ? [...info.byProp.values()].flat() : (info.byProp.get(propName) ?? []);
    return exprs.every((x) => keyIsPlainData(x));
  };
  // ESCAPE ANALYSIS (a whitelist, not a blacklist of write forms). A binding stays a plain read of
  // query data only if EVERY reference to it in its scope is a known READ-ONLY use: a property read,
  // a call of a non-mutating method, a key position (`TONE[x]`), a comparison / `&&` / `??` operand,
  // the source of an alias or destructure whose own uses are read-only, `String(x)`. Anything else —
  // an assignment or destructuring-assignment target, a `for…of`/`for…in` target, `++`, an argument to
  // an unknown function, `.bind`, `Array.prototype.push.call`, `Object.defineProperty`, an object/array
  // literal member, a JSX prop — is an ESCAPE: the value may be rebound or mutated where this analysis
  // cannot see, so it is not plain. Writes need no list; unknown uses fail closed.
  // Is this literal (or one nested in it) the TARGET of a destructuring assignment / for-of|in?
  const isAssignmentPattern = (lit) => {
    let n = lit;
    for (let p = n.parent; p; n = p, p = p.parent) {
      if (ts.isArrayLiteralExpression(p) || ts.isObjectLiteralExpression(p) || ts.isPropertyAssignment(p) || ts.isSpreadAssignment(p) || ts.isSpreadElement(p) || ts.isShorthandPropertyAssignment(p)) continue;
      if (ts.isBinaryExpression(p)) return p.left === n && p.operatorToken.kind >= K.FirstAssignment && p.operatorToken.kind <= K.LastAssignment;
      if (ts.isForOfStatement(p) || ts.isForInStatement(p)) return p.initializer === n;
      return false;
    }
    return false;
  };
  const boundNames = (name) => ts.isIdentifier(name) ? [name.text]
    : name.elements.flatMap((el) => (ts.isOmittedExpression(el) ? [] : boundNames(el.name)));
  const isReadOnlyUse = (id, derivedStart = false) => {
    let n = id, derived = derivedStart; // `derived`: n is now a value READ OUT of the binding, not the binding itself
    for (;;) {
      const p = n.parent;
      if (!p) return false;
      if (ts.isParenthesizedExpression(p) || ts.isNonNullExpression(p) || ts.isAsExpression(p) || ts.isSatisfiesExpression(p) || ts.isTypeAssertionExpression(p)) { n = p; continue; }
      if (ts.isPropertyAccessExpression(p) && p.expression === n) {
        const call = p.parent;
        if (ts.isTaggedTemplateExpression(call) && call.tag === p) return false; // rows.push`ok`
        if (ts.isCallExpression(call) && call.expression === p) {
          if (!READ_METHODS.has(p.name.text)) return false;
          // a callback with a 3rd parameter (`(x, i, arr) =>`) is handed the container itself
          if (call.arguments.some((a) => ts.isFunctionLike(a) && (a.parameters.length >= 3 || a.parameters.some((q) => q.dotDotDotToken)))) return false;
          if (RETURNS_RECEIVER.has(p.name.text)) { n = call; continue; } // sort()/reverse() return the receiver: judge the result
          return true;
        }
        n = p; derived = true; continue; // a property read: judge where the read value goes
      }
      if (ts.isElementAccessExpression(p)) {
        if (p.argumentExpression === n) return true;
        const call = p.parent;
        if ((ts.isCallExpression(call) && call.expression === p) || (ts.isTaggedTemplateExpression(call) && call.tag === p)) return false; // rows["push"](…), rows[m](…)
        n = p; derived = true; continue;
      }
      if (ts.isBinaryExpression(p)) {
        const op = p.operatorToken.kind;
        if (op >= K.FirstAssignment && op <= K.LastAssignment) return p.right === n && derived; // a target is a write; a derived value on the right is just read
        if (op === K.QuestionQuestionToken || op === K.BarBarToken || op === K.AmpersandAmpersandToken) { n = p; continue; }
        if (op === K.CommaToken) { if (p.right === n) { n = p; continue; } return true; } // `(0, rows).push(…)`: the right operand is the value
        return true; // comparison / arithmetic: a read that goes nowhere
      }
      if (ts.isConditionalExpression(p)) { if (p.condition === n) return true; n = p; continue; }
      if (ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p)) return p.operator !== K.PlusPlusToken && p.operator !== K.MinusMinusToken;
      if (ts.isTypeOfExpression(p) || ts.isTemplateSpan(p) || ts.isExpressionStatement(p)) return true;
      if (ts.isIfStatement(p) && p.expression === n) return true;
      if (ts.isForOfStatement(p) || ts.isForInStatement(p)) return p.expression === n;
      if (ts.isVariableDeclaration(p) && p.initializer === n) {
        if (derived) return true; // a value read OUT of the binding: the new name is judged on its own uses elsewhere
        // an alias is judged on ITS uses; names destructured OUT of the binding are values read from it (derived)
        return ts.isIdentifier(p.name) ? refsReadOnly(p.name.text, scopeOf(p), p) : boundNames(p.name).every((nm) => refsReadOnly(nm, scopeOf(p), p, true));
      }
      if (ts.isArrayLiteralExpression(p) || ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p) || ts.isSpreadAssignment(p) || ts.isSpreadElement(p)) {
        let lit = p; while (lit.parent && (ts.isPropertyAssignment(lit) || ts.isSpreadAssignment(lit) || ts.isSpreadElement(lit) || ts.isShorthandPropertyAssignment(lit))) lit = lit.parent;
        if (isAssignmentPattern(lit)) return false; // `[s] = …`, `({ s } = …)`, `for (s of …)`: a write
        return derived || ts.isSpreadElement(p); // `{ a: q.data?.a }` carries a read; `{ d }` / `[d]` hands the binding itself away
      }
      if (ts.isJsxExpression(p)) return derived || ts.isJsxElement(p.parent) || ts.isJsxFragment(p.parent);
      if (ts.isCallExpression(p) && p.expression === n) return false; // calling the binding, or a method pulled out of it: `pop()`
      if (ts.isCallExpression(p) && p.arguments.includes(n)) {
        const c = p.expression;
        return derived || (ts.isIdentifier(c) && c.text === "String" && !findBinding(c)) ||
          (ts.isPropertyAccessExpression(c) && ts.isIdentifier(c.expression) && c.expression.text === "Array" && c.name.text === "from" && !findBinding(c.expression));
      }
      return derived;
    }
  };
  const readOnlyGuard = new Set();
  // The declaration that introduced the binding being judged (a VariableDeclaration, Parameter or BindingElement).
  const isOwnDecl = (idNode, owner) => {
    for (let c = idNode.parent; c; c = c.parent) {
      if (c === owner) return true;
      if (ts.isBindingElement(c) || ts.isObjectBindingPattern(c) || ts.isArrayBindingPattern(c)) continue;
      return false;
    }
    return false;
  };
  const refsReadOnly = (name, scope, owner, derivedStart = false) => {
    const key = `${name}@${scope.pos}`;
    if (readOnlyGuard.has(key)) return true; // a cycle of aliases adds no new use
    readOnlyGuard.add(key);
    let ok = true;
    const w = (n) => {
      if (!ok || !n) return;
      // direct eval can write any binding in reach
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "eval") { ok = false; return; }
      if (ts.isIdentifier(n) && n.text === name && !isMemberName(n)) {
        const par = n.parent;
        const decl = ((ts.isVariableDeclaration(par) || ts.isParameter(par) || ts.isFunctionDeclaration(par)) && par.name === n) ||
          (ts.isBindingElement(par) && (par.name === n || par.propertyName === n));
        if (decl) {
          // the binding's own declaration is not a use; ANY OTHER declaration of the name (a `var`
          // redeclaration, `function s(){}`, a shadowing parameter or `catch (s)`) is a write or a rebinding
          if (!(owner && isOwnDecl(n, owner))) { ok = false; return; }
        } else if (!isReadOnlyUse(n, derivedStart)) { ok = false; return; }
      }
      ts.forEachChild(n, w);
    };
    w(scope);
    readOnlyGuard.delete(key);
    return ok;
  };
  // A numeric/size read is a FIXED value (0) over an empty default, not a data-derived key.
  const FIXED_VALUE_PROPS = new Set(["length", "size", "byteLength"]);
  const PLAIN_METHODS = new Set(["toLowerCase", "toUpperCase", "trim", "toString"]);
  const ROW_KEEPING = new Set(["filter", "slice", "sort", "reverse", "toSorted", "toReversed"]);
  const RETURNS_RECEIVER = new Set(["sort", "reverse"]);
  const READ_METHODS = new Set([...ROW_METHODS, ...ROW_KEEPING, ...PLAIN_METHODS, "concat", "join", "includes", "indexOf", "lastIndexOf",
    "at", "findIndex", "findLast", "findLastIndex", "keys", "values", "entries", "get", "has", "flat", "from"]);
  const keyIsPlainData = (k, depth = 0, asKey = false) => {
    if (!k || depth > 8) return false; // also stops a cycle (`const a = b; const b = a`)
    const e = unwrapExpr(k);
    const recur = (x) => keyIsPlainData(x, depth + 1, asKey);
    if (ts.isIdentifier(e)) {
      const b = findBinding(e);
      if (!b || b.kind === "opaque") return false;
      if (b.kind === "param") {
        if (!refsReadOnly(e.text, b.node.parent, b.node)) return false;
        if (b.node.parent && paramSitesPlain(b.node.parent, null)) return true;
        return isRowOfQueryData(b.node); // `(s) =>` of `data.rows.map(...)`: a row exists only when the data does
      }
      if (b.kind === "el") {
        if (b.node.initializer) return false; // a destructuring / parameter default
        if (b.fromParam) {
          const fn = b.node.parent.parent.parent;
          return !b.node.dotDotDotToken && refsReadOnly(e.text, fn, b.node) && paramSitesPlain(fn, propOf(b.node));
        }
        if (FIXED_VALUE_PROPS.has(propOf(b.node)) || !refsReadOnly(e.text, b.scope, b.node)) return false;
        return Boolean(b.decl.initializer) && recur(b.decl.initializer);
      }
      return refsReadOnly(e.text, b.scope, b.decl) && Boolean(b.decl.initializer) && recur(b.decl.initializer);
    }
    if (ts.isPropertyAccessExpression(e)) return !FIXED_VALUE_PROPS.has(e.name.text) && recur(e.expression);
    if (ts.isCallExpression(e)) {
      if (hookDecls.has(e)) return true;
      const c = e.expression;
      if (ts.isPropertyAccessExpression(c) && PLAIN_METHODS.has(c.name.text)) return recur(c.expression);
      if (ts.isIdentifier(c) && c.text === "String" && !findBinding(c)) return recur(e.arguments[0]);
      // `Array.from(rows)`, and filter/slice/sort/reverse, keep a subset of the same elements.
      // an ARRAY as a KEY coerces to its joined elements (`String([])` is ""), so these stay plain only as row receivers
      if (ts.isPropertyAccessExpression(c) && ts.isIdentifier(c.expression) && c.expression.text === "Array" && c.name.text === "from" && !findBinding(c.expression)) return !asKey && recur(e.arguments[0]);
      if (ts.isPropertyAccessExpression(c) && ROW_KEEPING.has(c.name.text)) return !asKey && recur(c.expression);
      return false;
    }
    if (ts.isBinaryExpression(e) && (e.operatorToken.kind === K.QuestionQuestionToken || e.operatorToken.kind === K.BarBarToken)) {
      const r = unwrapExpr(e.right); // `q.data ?? {}` / `?? []` supplies an empty container, not a key
      const empty = (ts.isObjectLiteralExpression(r) && r.properties.length === 0) || (ts.isArrayLiteralExpression(r) && r.elements.length === 0);
      return empty && recur(e.left);
    }
    return false;
  };
  // `T[undefined]` is `T["undefined"]`: a map with such an entry is HIT by an absent key, so a fallback never runs.
  // An absent key coerces to "undefined"/"null"; `String([])` is "" and `String({})` is "[object Object]".
  const ABSENT_KEYS = new Set(["undefined", "null", "", "[object object]"]);
  const mapKeyNames = (obj, depth = 0) => obj.properties.flatMap((p) => {
    if (ts.isSpreadAssignment(p)) { const o = depth < 6 ? mapObjectOf(p.expression, depth + 1) : null; return o ? mapKeyNames(o, depth + 1) : [null]; }
    return [ts.isShorthandPropertyAssignment(p) ? p.name.text : p.name ? memberKey(p.name) : null];
  });
  // `String(undefined)` is "undefined"; `.toUpperCase()` / `.toLowerCase()` of it, `String([])` ("") and `String({})`
  // ("[object Object]") are keys an ABSENT read can produce: a map with such an entry is hit, so no fallback runs.
  const hasAbsentKeyEntry = (obj, x) => Boolean(obj) &&
    (mapKeyNames(obj).some((k) => k === null || ABSENT_KEYS.has(k.toLowerCase())) ||
     (x ? mapMutations(mapNamesOf(x)).some((m) => m.key === null || ABSENT_KEYS.has(m.key.toLowerCase())) : false));
  const lookupHasSafeFallback = (lookup) => {
    const p = lookup.parent;
    return p && ts.isBinaryExpression(p) && p.left === lookup &&
      (p.operatorToken.kind === K.QuestionQuestionToken || p.operatorToken.kind === K.BarBarToken) &&
      keyIsPlainData(lookup.argumentExpression, 0, true);
  };
  // Returns [{ node, use }]: `node` is the good-class string, `use` is the node at the JSX
  // site (the string itself when inline; the identifier when resolved through a const).
  const goodClassStringNodes = (attr) => {
    const found = [];
    // An alias chain of any length resolves; `resolving` stops a cycle (`const A = B; const B = A`).
    const resolving = new Set();
    const walk = (x, use) => {
      if (!x) return;
      if ((ts.isStringLiteralLike(x) || ts.isNoSubstitutionTemplateLiteral(x)) && GOOD_CLASS.test(x.text)) found.push({ node: x, use: use ?? x });
      if (ts.isTemplateExpression(x) && (GOOD_CLASS.test(x.head.text) || x.templateSpans.some((s) => GOOD_CLASS.test(s.literal.text)))) found.push({ node: x, use: use ?? x });
      if (escapedMapRefs.has(x)) { found.push({ node: x, use: use ?? x }); return; }
      if (ts.isIdentifier(x) && !isMemberName(x)) {
        const init = resolveConstInit(x);
        if (init && !resolving.has(init)) { resolving.add(init); walk(init, use ?? x); resolving.delete(init); }
        const gp = !init && goodParams && goodParams.get(bindingOfParam(x));
        if (gp) for (const g of gp) found.push({ node: g.node, use: use ?? x });
      }
      if (ts.isElementAccessExpression(x) || ts.isPropertyAccessExpression(x)) {
        const es = lookupEntries(x);
        if (es) {
          // A fallback protects only a lookup whose key is a provably plain read of data; a literal
          // or property key (`T.ok`, `T["ok"]`) is not one, so its entry is always walked.
          const obj = mapObjectOf(x.expression);
          if (!(lookupHasSafeFallback(x) && !hasAbsentKeyEntry(obj, x))) for (const e of es) walk(e, use ?? x);
          return; // the map and the key are fully accounted for; do not re-walk them as plain nodes
        }
      }
      // A same-file helper — `className={toneFor(status)}` — is read through its return values.
      if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && localFns.has(x.expression.text)) {
        const fn = localFns.get(x.expression.text);
        if (!resolving.has(fn)) {
          resolving.add(fn);
          for (const r of returnExprs(fn)) walk(r, use ?? x);
          resolving.delete(fn);
        }
      }
      ts.forEachChild(x, (c) => walk(c, use));
    };
    walk(attr, undefined);
    return found;
  };
  for (let i = 0; i < 8 && propagateProps(); i++) deriveFixpoint();
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
// Brain review round 2: a 5-deep alias chain must flag; an object map wrapped in `as
// const` must NOT resolve (false positive); a reassigned `let` is not resolved — the
// literal it starts with is not the value it renders.
const BUG_ALIASCHAIN5 = constFixture(
  `const A0 = "text-emerald-400";\nconst A1 = A0;\nconst A2 = A1;\nconst A3 = A2;\nconst A4 = A3;\nconst GOOD = A4;`, "GOOD");
const OK_ASCONSTMAP = constFixture(
  `const T = { ok: "text-emerald-400", muted: "text-slate-400" } as const;`, "T.muted");
const OK_LETREASSIGNED = `
import { useQuery } from "@tanstack/react-query";
export function LetReassigned() {
  const q = useQuery({ queryKey: ["a"], queryFn: fa });
  const rows = q.data?.rows ?? [];
  let cls = "text-emerald-400";
  if (!q.data) cls = "text-slate-400";
  return <span className={cls}>{rows.length} rows</span>;
}`;
const OK_ALIASCYCLE = constFixture(`const A = B;\nconst B = A;`, "A");
const OK_PARAMSHADOW = `
import { useQuery } from "@tanstack/react-query";
const cls = "text-emerald-400";
export function ParamShadow() {
  const q = useQuery({ queryKey: ["a"], queryFn: fa });
  const rows = q.data?.rows ?? [];
  return <div>{["text-slate-400"].map((cls) => <span className={cls}>{rows.length} rows</span>)}</div>;
}`;

// Backlog 2379 remainder: props provenance and object-map classes — each bug has a guarded twin.
const BUG_PROPS = `
import { useQuery } from "@tanstack/react-query";
export function Page() {
  const q = useQuery({ queryKey: ["a"], queryFn: fa });
  const items = q.data?.items ?? [];
  return <Panel items={items} />;
}
function Panel({ items }) {
  return <span className="text-emerald-400">{items.length} rows</span>;
}`;
const OK_PROPS_CHILDGUARD = `
import { useQuery } from "@tanstack/react-query";
export function Page() {
  const q = useQuery({ queryKey: ["a"], queryFn: fa });
  const items = q.data?.items;
  return <Panel items={items} />;
}
function Panel({ items }) {
  if (!items) return <span>-</span>;
  return <span className="text-emerald-400">{items.length} rows</span>;
}`;
const OK_PROPS_PARENTGUARD = `
import { useQuery } from "@tanstack/react-query";
export function Page() {
  const q = useQuery({ queryKey: ["a"], queryFn: fa });
  const items = q.data?.items ?? [];
  return q.data ? <Panel items={items} /> : null;
}
function Panel({ items }) {
  return <span className="text-emerald-400">{items.length} rows</span>;
}`;
const mapFixture = (use) => `
import { useQuery } from "@tanstack/react-query";
const TONE = { ok: "text-emerald-400", bad: "text-red-400", default: "text-slate-400" };
export function Page() {
  const q = useQuery({ queryKey: ["a"], queryFn: fa });
  const rows = q.data?.rows ?? [];
  const status = q.data?.status;
  return <span className={${use}}>{rows.length} rows</span>;
}`;
const BUG_MAP = mapFixture("TONE[status]");
const OK_MAP_FALLBACK = mapFixture("TONE[status] ?? TONE.default");
const OK_MAP_LITFALLBACK = mapFixture(`TONE[status] ?? "text-slate-400"`);
const OK_MAP_STATICKEY = mapFixture("TONE.bad");

// Round-1 review of #1370: same-file shapes that passed silently, the fallback rule, and the
// same-name component collision. Each bug flags; each twin passes.
const propsFixture = (child, call, extra = "") => `
import { useQuery } from "@tanstack/react-query";
${extra}
export function Page() {
  const q = useQuery({ queryKey: ["a"], queryFn: fa });
  const items = q.data?.items ?? [];
  const p = { items };
  return ${call};
}
${child}`;
const EMERALD_ITEMS = `<span className="text-emerald-400">{items.length} rows</span>`;
const BUG_PROPS_IDENT = propsFixture(`function Panel(props) { return <span className="text-emerald-400">{props.items.length} rows</span>; }`, "<Panel items={items} />");
const BUG_PROPS_SPREAD = propsFixture(`function Panel({ items }) { return ${EMERALD_ITEMS}; }`, "<Panel {...p} />");
const BUG_PROPS_MEMO = propsFixture(`const Panel = React.memo(function Panel({ items }) { return ${EMERALD_ITEMS}; });`, "<Panel items={items} />");
const BUG_PROPS_FWDREF = propsFixture(`const Panel = forwardRef(({ items }, ref) => ${EMERALD_ITEMS});`, "<Panel items={items} />");
const BUG_PROPS_RENAMED = propsFixture(`function Panel({ items: list }) { return <span className="text-emerald-400">{list.length} rows</span>; }`, "<Panel items={items} />");
const BUG_PROPS_CHILDREN = propsFixture(`function Panel({ children }) { return <span className="text-emerald-400">{children}</span>; }`, "<Panel>{items.length}</Panel>");
const OK_PROPS_IDENT_GUARD = propsFixture(`function Panel(props) { if (!props.items) return null; return <span className="text-emerald-400">{props.items.length} rows</span>; }`, "<Panel items={items} />");
const OK_PROPS_CHILDREN_GUARD = propsFixture(`function Panel({ children }) { return <span className="text-emerald-400">{children}</span>; }`, "q.data ? <Panel>{items.length}</Panel> : null");
// Two same-named components in different scopes must not share a taint.
const collisionFixture = (topEmerald) => `
import { useQuery } from "@tanstack/react-query";
function Row({ items }) { return <span className="${topEmerald ? "text-emerald-400" : "text-slate-400"}">{items.length}</span>; }
export function Static() { return <Row items={[1]} />; }
export function Other() {
  const q = useQuery({ queryKey: ["a"], queryFn: fa });
  const items = q.data?.items ?? [];
  const Row = ({ items }) => <span className="${topEmerald ? "text-slate-400" : "text-emerald-400"}">{items.length}</span>;
  return <Row items={items} />;
}`;
const BUG_COLLIDE_REAL = collisionFixture(false); // the LOCAL Row is emerald and is the one fed query data → flag
const OK_COLLIDE_STATIC = collisionFixture(true); // only the top-level Row is emerald, and it is fed a static [1] → clean
const mapShape = (pre, use) => `
import { useQuery } from "@tanstack/react-query";
${pre}
export function Page() {
  const q = useQuery({ queryKey: ["a"], queryFn: fa });
  const rows = q.data?.rows ?? [];
  const status = q.data?.status;
  return <span className={${use}}>{rows.length} rows</span>;
}`;
const TONE = `const TONE = { ok: "text-emerald-400", default: "text-slate-400" };`;
const BUG_MAP_ALIAS = mapShape(TONE, "cls").replace("const status", "const cls = TONE[status];\n  const status").replace("const cls = TONE[status];\n  const status = q.data?.status;", "const status = q.data?.status;\n  const cls = TONE[status];");
const BUG_MAP_HELPER = mapShape(`${TONE}\nfunction toneFor(s) { return TONE[s]; }`, "toneFor(status)");
const BUG_MAP_NESTED = mapShape(`const TONE = { a: { ok: "text-emerald-400" } };`, "TONE.a[status]");
const BUG_MAP_SPREAD = mapShape(`const BASE = { ok: "text-emerald-400" };\nconst TONE = { ...BASE, bad: "text-red-400" };`, "TONE[status]");
const BUG_MAP_FB_PROP = mapShape(TONE, "TONE[status] ?? TONE.ok");
const BUG_MAP_FB_ELEM = mapShape(TONE, `TONE[status] ?? TONE["ok"]`);
const BUG_MAP_FB_LIT = mapShape(TONE, `TONE[status] || "text-emerald-400"`);
const OK_MAP_ALIAS_GUARD = mapShape(TONE, "q.data ? cls : undefined").replace("  return <span", "  const cls = TONE[status];\n  return <span");
const OK_MAP_HELPER_GUARD = mapShape(`${TONE}\nfunction toneFor(s) { return TONE[s]; }`, "q.data ? toneFor(status) : undefined");
const OK_MAP_NESTED_FALLBACK = mapShape(`const TONE = { a: { ok: "text-emerald-400" }, d: "text-slate-400" };`, "TONE.a[status] ?? TONE.d");

// Round-2 review of #1370: a key that defaults to a good entry, an operator that is not a
// fallback, a literal key, a good class or a whole query object handed down through a prop.
const DEFAULT_KEY = `const DEFAULT_KEY = "ok";`;
const BUG_KEY_NULLISH = mapShape(TONE, `TONE[status ?? "ok"] ?? TONE.default`);
const BUG_KEY_OR = mapShape(TONE, `TONE[status || "ok"] ?? "text-slate-400"`);
const BUG_KEY_CONST = mapShape(`${TONE}\n${DEFAULT_KEY}`, `TONE[status ?? DEFAULT_KEY] ?? TONE.default`);
const BUG_KEY_CONSTONLY = mapShape(`${TONE}\nconst KEY = "ok";`, "TONE[KEY] ?? TONE.default");
const BUG_KEY_TERNARY = mapShape(TONE, `TONE[status ? status : "ok"] ?? TONE.default`);
const BUG_MAP_PLUS = mapShape(TONE, `TONE[status] + " font-bold"`);
const BUG_MAP_LITKEY_ELEM = mapShape(TONE, `TONE["ok"] ?? "text-slate-400"`);
const BUG_MAP_LITKEY_PROP = mapShape(TONE, `TONE.ok || "text-slate-400"`);
const OK_KEY_PLAIN = mapShape(TONE, "TONE[status?.toLowerCase()] ?? TONE.default");
const PILL = `function Pill({ tone, n }) { return <span className={tone}>{n}</span>; }`;
const BUG_PROP_CLASS = propsFixture(PILL, `<Pill tone="text-emerald-400" n={items.length} />`);
const BUG_PROP_CLASS_MAP = propsFixture(PILL, `<Pill tone={TONE[q.data?.status]} n={items.length} />`, TONE);
const OK_PROP_CLASS_GUARD = propsFixture(PILL, `q.data ? <Pill tone="text-emerald-400" n={items.length} /> : null`);
const OK_PROP_CLASS_STATIC = propsFixture(PILL, `<Pill tone="text-emerald-400" n="static" />`);
const BUG_QOBJ = propsFixture(`function Row({ query }) { return <b className="text-emerald-400">{query.data?.n}</b>; }`, "<Row query={q} />");
const BUG_QOBJ_DESTRUCT = propsFixture(`function Row({ query }) { const { data } = query; return <b className="text-emerald-400">{data?.n}</b>; }`, "<Row query={q} />");
const BUG_QOBJ_SPREAD = propsFixture(`function Row({ data }) { return <b className="text-emerald-400">{data?.n}</b>; }`, "<Row {...q} />");
const OK_QOBJ_CALLGUARD = propsFixture(`function Row({ query }) { return <b className="text-emerald-400">{query.data?.n}</b>; }`, "q.data ? <Row query={q} /> : null");
const OK_QOBJ_CHILDGUARD = propsFixture(`function Row({ query }) { return query.data ? <b className="text-emerald-400">{query.data.n}</b> : null; }`, "<Row query={q} />");

// Round-3 review of #1370: the key rule is fail-closed — only a provably plain read of query data
// earns the fallback exemption. Every shape below can select a fixed entry whatever the data is.
const keyFx = (pre, body, use, tail = "", ret = `<span className={${use}}>{q.data?.n}</span>`) => `
import { useQuery } from "@tanstack/react-query";
${TONE}
${pre}
export function Page() {
  const q = useQuery({ queryKey: ["a"], queryFn: fa });
  ${body}
  return ${ret};
}
${tail}`;
const FALLBACK = "TONE[k] ?? TONE.default";
const BUG_R3 = [
  ["destructuring default", keyFx("", `const { k = "ok" } = q.data ?? {};`, FALLBACK)],
  ["function helper", keyFx(`function keyOf(s) { return s ?? "ok"; }`, `const s = q.data?.s;`, "TONE[keyOf(s)] ?? TONE.default")],
  ["arrow helper", keyFx(`const keyOf = (s) => s || "ok";`, `const s = q.data?.s;`, "TONE[keyOf(s)] ?? TONE.default")],
  ["switch helper", keyFx(`function keyOf(s) { switch (s) { case "bad": return "bad"; default: return "ok"; } }`, `const s = q.data?.s;`, "TONE[keyOf(s)] ?? TONE.default")],
  ["let reassigned", keyFx("", `let k = q.data?.s; if (!k) k = "ok";`, FALLBACK)],
  ["useMemo result", keyFx("", `const k = useMemo(() => q.data?.s ?? "ok", [q.data]);`, FALLBACK)],
  ["child prop default", keyFx("", "", "", `function C({ s = "ok", n }) { return <b className={TONE[s] ?? TONE.default}>{n}</b>; }`, `<C s={q.data?.s} n={q.data?.n} />`)],
  ["Object.keys(T)[0]", keyFx("", "", "TONE[Object.keys(TONE)[0]] ?? TONE.default")],
  ["const array element", keyFx(`const ORDER = ["ok", "bad"];`, "", "TONE[ORDER[0]] ?? TONE.default")],
  ["const object member", keyFx(`const KEYS = { a: "ok" };`, "", "TONE[KEYS.a] ?? TONE.default")],
  ["template with literal text", keyFx("", `const s = q.data?.s;`, "TONE[`o${s}`] ?? TONE.default")],
  ["callback parameter with a default", keyFx("", "", "", "", `<>{(q.data?.rows ?? []).map((r = { s: "ok" }) => <i className={TONE[r.s] ?? TONE.default}>{q.data?.n}</i>)}</>`)],
  ["callback over a NON-query array", keyFx("", "", "", "", `<>{[1, 2].map((r) => <i className={TONE[r.s] ?? TONE.default}>{q.data?.n}</i>)}</>`)],
];
const OK_R3 = [
  ["plain read of data", keyFx("", `const k = q.data?.s;`, FALLBACK)],
  ["plain read, inline q.data?.s", keyFx("", "", "TONE[q.data?.s] ?? TONE.default")],
  ["plain read, .toLowerCase()", keyFx("", `const s = q.data?.s;`, "TONE[s?.toLowerCase()] ?? TONE.default")],
  ["plain read, String()", keyFx("", `const s = q.data?.s;`, "TONE[String(s)] ?? TONE.default")],
  ["plain read, as-cast", keyFx("", `const s = q.data?.s;`, "TONE[s as string] ?? TONE.default")],
  ["destructured without a default", keyFx("", `const { k } = q.data ?? {};`, FALLBACK)],
  ["destructured from the hook itself", `
import { useQuery } from "@tanstack/react-query";
${TONE}
export function Page() {
  const { data } = useQuery({ queryKey: ["a"], queryFn: fa });
  return <span className={TONE[data?.s] ?? TONE.default}>{data?.n}</span>;
}`],
  ["callback over query rows", keyFx("", "", "", "", `<>{(q.data?.rows ?? []).map((r) => <i className={TONE[r.s] ?? TONE.default}>{q.data?.n}</i>)}</>`)],
  ["child props identifier, no default", keyFx("", "", "", `function C(props) { return <b className={TONE[props.s] ?? TONE.default}>{props.n}</b>; }`, `<C s={q.data?.s} n={q.data?.n} />`)],
  ["child prop without a default", keyFx("", "", "", `function C({ s, n }) { return <b className={TONE[s] ?? TONE.default}>{n}</b>; }`, `<C s={q.data?.s} n={q.data?.n} />`)],
];

// Round-4 review of #1370: a prop is plain only if EVERY call site passes a plain read, and a row
// callback's receiver must itself be a plain read (a defaulted / augmented array is not).
const CHILD_S = `function C({ s, n }) { return <b className={TONE[s] ?? TONE.default}>{n}</b>; }`;
const CHILD_PROPS = `function C(props) { return <b className={TONE[props.s] ?? TONE.default}>{props.n}</b>; }`;
const N = "n={q.data?.n}";
const rowsFx = (recv, use = "TONE[r] ?? TONE.default", pre = "") =>
  keyFx(pre, "", "", "", `<>{${recv}.map((r) => <li className={${use}}>{q.data?.n}</li>)}</>`);
const BUG_R4 = [
  ["call site defaults the prop: s={q.data?.s ?? \"ok\"}", keyFx("", "", "", CHILD_S, `<C s={q.data?.s ?? "ok"} ${N} />`)],
  ["a second call site passes a literal key", keyFx("", "", "", CHILD_S, `<><C s={q.data?.s} ${N} /><C s="ok" ${N} /></>`)],
  ["props identifier, call site defaults", keyFx("", "", "", CHILD_PROPS, `<C s={q.data?.s ?? "ok"} ${N} />`)],
  ["call site spreads an object", keyFx("", "", "", CHILD_S, `<C {...{ s: "ok", ...q.data }} ${N} />`)],
  ["derived default passed as the prop", keyFx("", `const s = q.data?.s ?? "ok";`, "", CHILD_S, `<C s={s} ${N} />`)],
  ["one site plain, another spreads a literal", keyFx("", "", "", CHILD_S, `<><C s={q.data?.s} ${N} /><C {...{ s: "ok" }} ${N} /></>`)],
  ["param of a non-component function (no visible call sites)", keyFx("", `const render = (s) => <b className={TONE[s] ?? TONE.default}>{q.data?.n}</b>;`, "", "", `render(q.data?.s ?? "ok")`)],
  ["second callback parameter (index) is not a row", keyFx("", "", "", "", `<>{(q.data?.rows ?? []).map((r, i) => <li className={TONE[i] ?? TONE.default}>{q.data?.n}</li>)}</>`)],
  ["call site passes a helper result", keyFx(`function keyOf(x) { return x ?? "ok"; }`, "", "", CHILD_S, `<C s={keyOf(q.data?.s)} ${N} />`)],
  ['rows defaulted: (q.data?.rows ?? ["ok"])', rowsFx(`(q.data?.rows ?? ["ok"])`)],
  ['rows defaulted with ||: (q.data?.rows || ["ok"])', rowsFx(`(q.data?.rows || ["ok"])`)],
  ['rows .concat(["ok"])', rowsFx(`(q.data?.rows ?? []).concat(["ok"])`)],
  ['rows spread-appended: [...rows, "ok"]', rowsFx(`[...(q.data?.rows ?? []), "ok"]`)],
  ['derived rows const defaulted', rowsFx("rows", "TONE[r] ?? TONE.default", `const rows = q.data?.rows ?? ["ok"];`).replace("  return <>", "  const rows = q.data?.rows ?? [\"ok\"];\n  return <>").replace(/^const rows[^\n]*\n/m, "")],
  ['rows from useMemo', rowsFx("rows").replace("  return <>", "  const rows = useMemo(() => q.data?.rows ?? [\"ok\"], [q.data]);\n  return <>")],
  ['rows of literal objects: [{ status: "ok" }]', rowsFx(`(q.data?.rows ?? [{ s: "ok" }])`, "TONE[r.s] ?? TONE.default")],
  ["reduce accumulator is not a row", keyFx("", "", "", "", `<>{(q.data?.rows ?? []).reduce((acc) => <li className={TONE[acc] ?? TONE.default}>{q.data?.n}</li>, "ok")}</>`)],
  ["String shadowed by a same-file function", keyFx(`function String(x) { return x ?? "ok"; }`, `const s = q.data?.s;`, "TONE[String(s)] ?? TONE.default")],
];
const OK_R4 = [
  ["every call site passes a plain read", keyFx("", "", "", CHILD_S, `<><C s={q.data?.s} ${N} /><C s={q.data?.t} ${N} /></>`)],
  ["rows filtered, then mapped", rowsFx(`(q.data?.rows ?? []).filter((x) => x.a)`, "TONE[r.s] ?? TONE.default")],
  ["derived rows const, empty default", rowsFx("rows").replace("  return <>", "  const rows = q.data?.rows ?? [];\n  return <>")],
];

// Round-5 review of #1370: fixed-value reads, call sites the JSX scan cannot see, assigned or
// mutated bindings, rest elements — and one fixture per clause a reviewer's mutant survived.
const NUMTONE = `const NT = { 0: "text-emerald-400", default: "text-slate-400" };`;
const numFx = (body, use) => keyFx(NUMTONE, body, use);
const CHILD_N = `function C({ s, n }) { return <b className={TONE[s] ?? TONE.default}>{n}</b>; }`;
const PLAIN_SITE = `<C s={q.data?.s} ${N} />`;
const BUG_R5 = [
  ["numeric key: rows.length over an empty default", numFx(`const rows = q.data?.rows ?? [];`, "NT[rows.length] ?? NT.default")],
  ["numeric key: String(rows.length)", numFx(`const rows = q.data?.rows ?? [];`, "NT[String(rows.length)] ?? NT.default")],
  ["numeric key: destructured { length }", numFx(`const rows = q.data?.rows ?? []; const { length } = rows;`, "NT[length] ?? NT.default")],
  ["numeric key: (q.data?.rows ?? []).length inline", numFx("", "NT[(q.data?.rows ?? []).length] ?? NT.default")],
  ["second site through an alias: const D = C", keyFx("", "", "", `${CHILD_N}\nconst D = C;`, `<>${PLAIN_SITE}<D s="ok" ${N} /></>`)],
  ["second site is a direct call: C({ s: \"ok\" })", keyFx("", "", "", CHILD_N, `<>${PLAIN_SITE}{C({ s: "ok", n: q.data?.n })}</>`)],
  ["second site is createElement(C, …)", keyFx("", "", "", CHILD_N, `<>${PLAIN_SITE}{React.createElement(C, { s: "ok", n: q.data?.n })}</>`)],
  ["component is exported (sites in other files are unseen)", keyFx("", "", "", `export ${CHILD_N}`, PLAIN_SITE)],
  ["component handed to memo(C)", keyFx("", "", "", `${CHILD_N}\nconst M = React.memo(C);`, `<>${PLAIN_SITE}<M s="ok" ${N} /></>`)],
  ["empty default mutated: rows.push(\"ok\")", rowsFx("rows", "TONE[r] ?? TONE.default").replace("  return <>", "  const rows = q.data?.rows ?? [];\n  if (!rows.length) rows.push(\"ok\");\n  return <>")],
  ["empty default mutated: d.s ??= \"ok\"", keyFx("", `const d = q.data ?? {}; d.s ??= "ok";`, "TONE[d.s] ?? TONE.default")],
  ["empty default mutated: Object.assign(d, …)", keyFx("", `const d = q.data ?? {}; Object.assign(d, { s: "ok" });`, "TONE[d.s] ?? TONE.default")],
  ["parameter reassigned: s ??= \"ok\"", keyFx("", "", "", `function C({ s, n }) { s ??= "ok"; return <b className={TONE[s] ?? TONE.default}>{n}</b>; }`, PLAIN_SITE)],
  ["callback parameter reassigned: r = r || \"ok\"", keyFx("", "", "", "", `<>{(q.data?.rows ?? []).map((r) => { r = r || "ok"; return <li className={TONE[r] ?? TONE.default}>{q.data?.n}</li>; })}</>`)],
  ["let reassigned after a destructure", keyFx("", `let { k } = q.data ?? {}; k ||= "ok";`, "TONE[k] ?? TONE.default")],
  ["rest element in a component parameter", keyFx("", "", "", `function C({ n, ...rest }) { return <b className={TONE[rest.s] ?? TONE.default}>{n}</b>; }`, `<C s="ok" ${N} />`)],
  ["object default is not empty: q.data ?? { s: \"ok\" }", keyFx("", `const d = q.data ?? { s: "ok" };`, "TONE[d.s] ?? TONE.default")],
  ["array-destructured key is unprovable", keyFx("", `const [k] = q.data?.keys ?? [];`, "TONE[k] ?? TONE.default")],
  ["cyclic const keys terminate and flag", keyFx(`const A = B;\nconst B = A;`, "", "TONE[A] ?? TONE.default")],
  ["lookup is the RIGHT operand of ??: x ?? TONE[s]", keyFx("", `const s = q.data?.s;`, "q.data?.k ?? TONE[s]")],
  ["second site WITH children passes a literal", keyFx("", "", "", CHILD_N, `<>${PLAIN_SITE}<C s="ok" ${N}>x</C></>`)],
];
const OK_R5 = [
  ["|| fallback over a plain key", keyFx("", `const s = q.data?.s;`, "TONE[s] || TONE.default")],
  ["Array.from over a plain rows array", rowsFx(`Array.from(q.data?.rows ?? [])`, "TONE[r.s] ?? TONE.default")],
  ["rows that are only read, never mutated", rowsFx("rows", "TONE[r] ?? TONE.default").replace("  return <>", "  const rows = q.data?.rows ?? [];\n  const n = rows.length;\n  return <>")],
  ["another component's literal site does not taint this one", keyFx("", "", "", `${CHILD_N}\nfunction E({ s }) { return <i>{s}</i>; }`, `<>${PLAIN_SITE}<E s="ok" /></>`)],
  ["plain site with children", keyFx("", "", "", CHILD_N, `<C s={q.data?.s} ${N}>x</C>`)],
];

// Round-6 review of #1370: the read-only-use whitelist (escape analysis) replaces a blacklist of write forms.
const UNDEF_MAP = (key) => `const U = { ${key}: "text-emerald-400", default: "text-slate-400" };`;
const ROWS = `const rows = q.data?.rows ?? [];`;
const mapRows = (body, use = "TONE[r] ?? TONE.default") => keyFx("", body, "", "", `<>{rows.map((r) => <li className={${use}}>{q.data?.n}</li>)}</>`);
const letS = (stmt) => keyFx("", `let s = q.data?.s; ${stmt}`, "TONE[s] ?? TONE.default");
const dObj = (stmt) => keyFx("", `const d = q.data ?? {}; ${stmt}`, "TONE[d.s] ?? TONE.default");
const BUG_R6 = [
  ["destructuring assignment: ({ s } = …)", letS(`({ s } = { s: "ok" });`)],
  ["array destructuring assignment: [s] = […]", letS(`[s] = ["ok"];`)],
  ["renamed destructuring assignment: ({ a: s } = …)", letS(`({ a: s } = { a: "ok" });`)],
  ["for…of target", letS(`for (s of ["ok"]) {}`)],
  ["for…in target", letS(`for (s in { ok: 1 }) {}`)],
  ["increment: s++", letS(`s++;`)],
  ["parameter: destructuring assignment", keyFx("", "", "", `function C({ s, n }) { ({ s } = { s: "ok" }); return <b className={TONE[s] ?? TONE.default}>{n}</b>; }`, PLAIN_SITE)],
  ["parameter: for…of target", keyFx("", "", "", `function C({ s, n }) { for (s of ["ok"]) {} return <b className={TONE[s] ?? TONE.default}>{n}</b>; }`, PLAIN_SITE)],
  ["cloneElement overrides a plain site", keyFx("", "", "", CHILD_N, `{React.cloneElement(<C s={q.data?.s} ${N} />, { s: "ok" })}`)],
  ["rows mutated through an alias", mapRows(`${ROWS} const a = rows; a.push("ok");`)],
  ["rows handed to a function: seed(rows)", mapRows(`${ROWS} seed(rows);`)],
  ["rows: Array.prototype.push.call(rows, …)", mapRows(`${ROWS} Array.prototype.push.call(rows, "ok");`)],
  ["rows: a bound mutator", mapRows(`${ROWS} const add = rows.push.bind(rows); add("ok");`)],
  ["rows.unshift", mapRows(`${ROWS} rows.unshift("ok");`)],
  ["rows.splice", mapRows(`${ROWS} rows.splice(0, 0, "ok");`)],
  ["rows[0] = …", mapRows(`${ROWS} rows[0] = "ok";`)],
  ["d: Object.defineProperty", dObj(`Object.defineProperty(d, "s", { value: "ok" });`)],
  ["d: Reflect.set", dObj(`Reflect.set(d, "s", "ok");`)],
  ["d: Object.setPrototypeOf", dObj(`Object.setPrototypeOf(d, { s: "ok" });`)],
  ["d written through a nested alias", dObj(`const o = { d }; o.d.s = "ok";`)],
  ["d written by a destructuring assignment target", dObj(`({ x: d.s } = { x: "ok" });`)],
  ["map with an `undefined` entry (bare key)", keyFx(UNDEF_MAP("undefined"), "", "U[q.data?.s] ?? U.default")],
  ["map with an `undefined` entry (quoted key)", keyFx(UNDEF_MAP('"undefined"'), "", "U[q.data?.s] ?? U.default")],
  ["map with a `null` entry", keyFx(UNDEF_MAP("null"), "", "U[q.data?.s] ?? U.default")],
  ["map with an `undefined` entry via String()", keyFx(UNDEF_MAP("undefined"), "", "U[String(q.data?.s)] ?? U.default")],
  ["numeric key: rows.size", numFx(ROWS, "NT[rows.size] ?? NT.default")],
  ["rows default does not make an arbitrary receiver plain", mapRows(`const rows = seed() ?? [];`)],
];
const OK_R6 = [
  ["a read value handed to a function does not escape q", keyFx("", `track(q.data?.s);`, "TONE[q.data?.s] ?? TONE.default")],
  ["a read value carried in an object literal", keyFx("", `const meta = { s: q.data?.s };`, "TONE[q.data?.s] ?? TONE.default")],
  ["a read value handed to a prop", keyFx("", "", "", CHILD_N, `<><C s={q.data?.s} ${N} /><i title={q.data?.s}>x</i></>`)],
  ["rows only read: includes / join / length", mapRows(`${ROWS} const has = rows.includes("x"); const label = rows.join(",");`)],
  ["rows aliased and the alias only read", mapRows(`${ROWS} const a = rows; const n = a.length;`)],
  ["let that is never reassigned", keyFx("", `let s = q.data?.s;`, "TONE[s] ?? TONE.default")],
];

// Round-6 follow-up: one fixture per clause of the read-only-use whitelist.
const rowsWith = (extraBody, jsxBefore = "") =>
  keyFx("", `${ROWS} ${extraBody}`, "", "", `<>${jsxBefore}{rows.map((r) => <li className={TONE[r] ?? TONE.default}>{q.data?.n}</li>)}</>`);
BUG_R6.push(
  ["rows aliased by assignment: a = rows", rowsWith(`let a; a = rows; a.push("ok");`)],
  ["rows flows through ||: a = rows || other", rowsWith(`const a = rows || other; a.push("ok");`)],
  ["rows flows through a ternary", rowsWith(`const a = cond ? rows : []; a.push("ok");`)],
  ["rows: destructured method then called", rowsWith(`const { pop } = rows; pop();`)],
  ["rows handed to a JSX prop", rowsWith("", `<X data={rows} />`)],
  ["rows returned from a closure", rowsWith(`const get = () => rows; get().push("ok");`)],
  ["rows passed to a shadowed String", rowsWith(`function String(a) { a.push("ok"); return ""; } String(rows);`)],
  ["reduce accumulator over Array.from(rows)", keyFx("", "", "", "", `<>{Array.from(q.data?.rows ?? []).reduce((acc) => <li className={TONE[acc] ?? TONE.default}>{q.data?.n}</li>, "ok")}</>`)],
);
OK_R6.push(
  ["rows[0] read handed to a prop", rowsWith("", `<i title={rows[0]}>x</i>`)],
  ["rows used in typeof / template / a bare statement", rowsWith("const t = typeof rows; const str = `${rows}`; rows;")],
  ["rows tested in an if", rowsWith("if (rows) { track(1); }")],
  ["a read value assigned to a declaration that escapes", keyFx("", `const x = q.data?.s; track(x);`, "TONE[q.data?.s] ?? TONE.default")],
  ["rows copied by spread", rowsWith("const copy = [...rows];")],
  ["rows rendered as a child", rowsWith("", "{rows}")],
);

BUG_R6.push(["String shadowed, argument is a derived read", keyFx(`function String(x) { return x ?? "ok"; }`, "", "TONE[String(q.data?.s)] ?? TONE.default")]);
OK_R6.push(["rows used only as a ternary condition", rowsWith("const c = rows ? 1 : 2;")]);

// Round-7 review of #1370.
const mapKeyFx = (pre, use, body = "") => keyFx(pre, body, use);
const GET_MAP = (member) => `const G = { bad: "text-red-400", ${member}, default: "text-slate-400" };`;
BUG_R6.push(
  ["rows.sort().push(…): sort returns the receiver", rowsWith(`rows.sort().push("ok");`)],
  ["rows.reverse().fill(…)", rowsWith(`rows.reverse().fill("ok");`)],
  ["const t = rows.sort(); t.push(…)", rowsWith(`const t = rows.sort(); t.push("ok");`)],
  ["rows.reverse()[0] = …", rowsWith(`rows.reverse()[0] = "ok";`)],
  ["seed(rows.sort())", rowsWith(`seed(rows.sort());`)],
  ["rows.sort().splice(…)", rowsWith(`rows.sort().splice(0, 0, "ok");`)],
  ["rows[\"push\"](…): element-access call", rowsWith(`rows["push"]("ok");`)],
  ["rows[m](…): computed method name", rowsWith(`const m = "push"; rows[m]("ok");`)],
  ["(0, rows).push(…): comma operand", rowsWith(`(0, rows).push("ok");`)],
  ["tagged template call: rows.push`ok`", rowsWith("rows.push`ok`;")],
  ["callback third parameter aliases the container", rowsWith(`rows.forEach((x, i, arr) => { arr.push("ok"); });`)],
  ["var redeclared with an initializer", keyFx("", `var s = q.data?.s; var s = "ok";`, "TONE[s] ?? TONE.default")],
  ["var redeclared in a nested block", keyFx("", `var s = q.data?.s; { var s = "ok"; }`, "TONE[s] ?? TONE.default")],
  ["function declaration redeclares the name", keyFx("", `var s = q.data?.s; function s() {}`, "TONE[s] ?? TONE.default")],
  ["for (var s = …) redeclares", keyFx("", `var s = q.data?.s; for (var s = "ok"; ;) { break; }`, "TONE[s] ?? TONE.default")],
  ["shadowing catch (s) is treated as a rebinding (fail-closed over-flag)", keyFx("", `let s = q.data?.s; try {} catch (s) { s = "ok"; }`, "TONE[s] ?? TONE.default")],
  ["direct eval can write any binding", rowsWith(`eval("rows.push('ok')");`)],
  ["direct eval on a scalar", keyFx("", `let s = q.data?.s; eval("s = 'ok'");`, "TONE[s] ?? TONE.default")],
  ["shorthand map entry: T.ok", mapKeyFx(`const ok = "text-emerald-400"; const T = { ok, bad: "text-red-400" };`, "T.ok")],
  ["shorthand map entry, dynamic key", mapKeyFx(`const ok = "text-emerald-400"; const T = { ok, bad: "text-red-400" };`, "T[q.data?.s]")],
  ["method map entry: T.ok()", mapKeyFx(`const T = { ok() { return "text-emerald-400"; } };`, "T.ok()")],
  ["getter map entry: T.ok", mapKeyFx(`const T = { get ok() { return "text-emerald-400"; } };`, "T.ok")],
  ["computed-key map entry with an unreadable key", mapKeyFx(`const T = { [keyFn()]: "text-emerald-400" };`, "T.ok")],
  ["getter fallback entry is good-state", mapKeyFx(GET_MAP(`get default() { return "text-emerald-400"; }`).replace(', default: "text-slate-400"', ""), "G[q.data?.s] ?? G.default")],
  ["getter named undefined", mapKeyFx(`const U = { get undefined() { return "text-emerald-400"; }, default: "text-slate-400" };`, "U[q.data?.s] ?? U.default")],
  ["computed `[\"undefined\"]` entry", mapKeyFx(`const U = { ["undefined"]: "text-emerald-400", default: "text-slate-400" };`, "U[q.data?.s] ?? U.default")],
  ["map entry \"\" is hit by String([])", mapKeyFx(`const E2 = { "": "text-emerald-400", default: "text-slate-400" };`, "E2[rows] ?? E2.default", ROWS)],
  ["map entry \"[object Object]\" is hit by String({})", mapKeyFx(`const E3 = { "[object Object]": "text-emerald-400", default: "text-slate-400" };`, "E3[d] ?? E3.default", `const d = q.data ?? {};`)],
  ["Array shadowed: key rule", mapKeyFx(`const Array = { from: () => "ok" };`, "TONE[Array.from(q.data?.s)] ?? TONE.default")],
  ["Array shadowed: read-only whitelist", rowsWith(`const Array = { from: (x) => x }; Array.from(rows).push("ok");`)],
  ["s-- decrements the binding", keyFx("", `let s = q.data?.s; s--;`, "TONE[s] ?? TONE.default")],
  ["parenthesised target: (d.s) = …", dObj(`(d.s) = "ok";`)],
  ["non-null target: d.s! = …", dObj(`d.s! = "ok";`)],
  ["literal array filtered: ['ok'].filter(…)", keyFx("", "", "", "", `<>{["ok"].filter(() => true).map((r) => <li className={TONE[r] ?? TONE.default}>{q.data?.n}</li>)}</>`)],
  ["literal array sliced as a key", keyFx("", "", "TONE[[\"ok\"].slice(0)] ?? TONE.default")],
  ["literal string .toLowerCase() as a key", keyFx("", "", "TONE[\"ok\".toLowerCase()] ?? TONE.default")],
  ["literal string .trim() as a key", keyFx("", "", "TONE[\"ok\".trim()] ?? TONE.default")],
  ["Array.from over a literal array", keyFx("", "", "", "", `<>{Array.from(["ok"]).map((r) => <li className={TONE[r] ?? TONE.default}>{q.data?.n}</li>)}</>`)],
  ["nested array destructuring assignment [[s]] = …", keyFx("", `let s = q.data?.s; [[s]] = [["ok"]];`, "TONE[s] ?? TONE.default")],
  ["for ([d.s] of …) assignment target", dObj(`for ([d.s] of [["ok"]]) {}`)],
  ["[d.s] = … assignment target", dObj(`[d.s] = ["ok"];`)],
);
OK_R6.push(
  ["rows.sort() / reverse() whose results are not used to write", rowsWith(`rows.sort(); rows.reverse(); const top = rows.sort((a, b) => 0);`)],
  ["callback with two parameters", rowsWith(`rows.forEach((x, i) => { track(x, i); });`)],
  ["comma operand evaluated and discarded", rowsWith(`const c = (rows, 1);`)],
  ["element-access read: rows[\"x\"]", rowsWith(`const first = rows["x"];`)],
  ["a map with a readable shorthand entry that is not good-state", mapKeyFx(`const calm = "text-slate-400"; const T = { calm, default: "text-slate-400" };`, "T[q.data?.s] ?? T.default")],
);

// Round-7 follow-up: survivors of the AST-generated mutants that change the safety direction.
BUG_R6.push(
  ["(rows as any).push(…): a type assertion is unwrapped", rowsWith(`(rows as any).push("ok");`)],
  ["(rows satisfies any[]).push(…)", rowsWith(`(rows satisfies any[]).push("ok");`)],
  ["rows[\"push\"]`ok`: tagged element access", rowsWith("rows[\"push\"]`ok`;")],
  ["value flows through &&: a = ok && rows", rowsWith(`const a = ok && rows; a.push("ok");`)],
  ["value flows through ??: a = rows ?? other", rowsWith(`const a = rows ?? other; a.push("ok");`)],
  ["prefix decrement: --s", keyFx("", `let s = q.data?.s; --s;`, "TONE[s] ?? TONE.default")],
  ["prefix increment: ++s", keyFx("", `let s = q.data?.s; ++s;`, "TONE[s] ?? TONE.default")],
  ["nested assignment pattern: ({ a: { b: d.s } } = …)", dObj(`({ a: { b: d.s } } = { a: { b: "ok" } });`)],
  ["array of object assignment pattern: [{ x: d.s }] = …", dObj(`[{ x: d.s }] = [{ x: "ok" }];`)],
  ["object rest target: ({ ...d.s } = …)", dObj(`({ ...d.s } = { z: 1 });`)],
  ["array rest target: [...d.s] = …", dObj(`[...d.s] = ["ok"];`)],
  ["for (d.s of …) with a property target", dObj(`for (d.s of ["ok"]) {}`)],
  ["for (d.s in …) with a property target", dObj(`for (d.s in { ok: 1 }) {}`)],
);
OK_R6.push(
  ["map() returns a NEW array: pushing to it is not a write to rows", rowsWith(`rows.map((x) => x).push("ok");`)],
  ["a derived rows[0] passed to a function", rowsWith(`track(rows[0]);`)],
  ["rows on the right of `in` / instanceof", rowsWith(`const has = "a" in rows; const isArr = rows instanceof Array;`)],
  ["a derived value assigned to a variable", keyFx("", `let v; v = q.data?.s;`, "TONE[q.data?.s] ?? TONE.default")],
  ["a condition result handed to a function", rowsWith(`track(rows ? 1 : 2);`)],
  ["!rows", rowsWith(`const empty = !rows;`)],
  ["for…of / for…in over rows", rowsWith(`for (const x of rows) { track(x); } for (const k in rows) { track(k); }`)],
);

// Round-7 follow-up 2: more safety-direction survivors of the generated mutants.
BUG_R6.push(
  ["key is an unbound identifier", keyFx("", "", "TONE[globalKey] ?? TONE.default")],
  ["destructured from a non-plain source: const { k } = seed()", keyFx("", `const { k } = seed();`, "TONE[k] ?? TONE.default")],
  ["helper called with a derived argument: keyOf(q.data?.s)", keyFx(`function keyOf(x) { return x ?? "ok"; }`, "", "TONE[keyOf(q.data?.s)] ?? TONE.default")],
  ["another receiver's .from(…): Foo.from(q.data?.s)", keyFx("", "", "TONE[Foo.from(q.data?.s)] ?? TONE.default")],
  ["Array.of(…) is not Array.from(…)", keyFx("", "", "TONE[Array.of(q.data?.s)] ?? TONE.default")],
  ["array-pattern key with a hole: const [, k] = …", keyFx("", `const [, k] = q.data?.keys ?? [];`, "TONE[k] ?? TONE.default")],
  ["nested map reached by a string-literal key: T[\"a\"][status]", mapKeyFx(`const T = { a: { ok: "text-emerald-400" }, d: "text-slate-400" };`, `T["a"][q.data?.s]`)],
  ["exported const component: sites in other files are unseen", keyFx("", "", "", `export const C = ({ s, n }) => <b className={TONE[s] ?? TONE.default}>{n}</b>;`, PLAIN_SITE)],
  ["map entry through a resolvable computed key", mapKeyFx(`const K = "ok"; const T = { [K]: "text-emerald-400" };`, "T.ok")],
);
OK_R6.push(
  ["Array.from(rows) is a read", rowsWith(`const copy = Array.from(rows);`)],
  ["row receiver defaulted with ||: (q.data?.rows || [])", keyFx("", "", "", "", `<>{(q.data?.rows || []).map((r) => <li className={TONE[r] ?? TONE.default}>{q.data?.n}</li>)}</>`)],
  ["destructured alias of rows only read: const { length } = rows", rowsWith(`const { length } = rows; track(length);`)],
  ["computed key that does not name the entry", mapKeyFx(`const K = "bad"; const T = { [K]: "text-emerald-400" };`, "T.ok")],
  ["arrow-const component with a plain site", keyFx("", "", "", `const C = ({ s, n }) => <b className={TONE[s] ?? TONE.default}>{n}</b>;`, PLAIN_SITE)],
);

// Round-8: a WRITE-FORM MATRIX. Each form below, written against each kind of binding (a scalar, a
// component parameter, a container, an object), must flag; each READ-ONLY twin must not. This exercises
// the read-only-use whitelist from many angles instead of one hand-picked shape. It does not pin every clause (see the header).
const MX_PAGE = (body, ret, tail = "") => `
import { useQuery } from "@tanstack/react-query";
${TONE}
export function Page() {
  const q = useQuery({ queryKey: ["a"], queryFn: fa });
  ${body}
  return ${ret};
}
${tail}`;
const MX_SC = (f) => MX_PAGE(`let s = q.data?.s; ${f("s")}`, `<span className={TONE[s] ?? TONE.default}>{q.data?.n}</span>`);
const MX_PA = (f) => MX_PAGE("", `<C s={q.data?.s} n={q.data?.n} />`, `function C({ s, n }) { ${f("s")} return <b className={TONE[s] ?? TONE.default}>{n}</b>; }`);
const MX_RW = (f) => MX_PAGE(`const rows = q.data?.rows ?? []; ${f("rows")}`, `<>{rows.map((r) => <li className={TONE[r] ?? TONE.default}>{q.data?.n}</li>)}</>`);
const MX_OB = (f) => MX_PAGE(`const d = q.data ?? {}; ${f("d")}`, `<span className={TONE[d.s] ?? TONE.default}>{q.data?.n}</span>`);
const MX_SCALAR_W = ['X = "ok";','X ||= "ok";','X ??= "ok";','X &&= "ok";','X += "";','X -= 1;','X++;','X--;','++X;','--X;','({ X } = { X: "ok" });','({ a: X } = { a: "ok" });','[X] = ["ok"];','[, X] = [0, "ok"];','[...X] = ["ok"];','({ ...X } = {});','[[X]] = [["ok"]];','({ a: { b: X } } = { a: { b: "ok" } });','for (X of ["ok"]) {}','for (X in { ok: 1 }) {}','(X) = "ok";','(X as any) = "ok";','X! = "ok";','X = (0, "ok");','{ var X = "ok"; }','for (var X = "ok"; ;) { break; }','try {} catch (X) { X = "ok"; }','function X() {}','eval("X = \'ok\'");'];
const MX_ROWS_W = ['R.push("ok");','R.unshift("ok");','R.splice(0, 0, "ok");','R.fill("ok");','R.copyWithin(0, 1);','R.pop();','R.shift();','R.sort().push("ok");','R.reverse().fill("ok");','R.sort().sort().push("ok");','R.sort((a, b) => 0).reverse().push("ok");','(R.sort()).push("ok");','R.sort()!.push("ok");','R?.sort().push("ok");','(R.sort() as any).push("ok");','const t = R.sort(); t.push("ok");','const t = R.sort(); seed(t);','const t = R.sort(); const u = t; u.push("ok");','R[0] = "ok";','R["push"]("ok");','const m = "push"; R[m]("ok");','R?.["push"]("ok");','R.length = 0;','(0, R).push("ok");','R.push`ok`;','seed(R);','const a = R; a.push("ok");','let a; a = R; a.push("ok");','const a = ok && R; a.push("ok");','const a = R ?? other; a.push("ok");','const a = R || other; a.push("ok");','const a = cond ? R : []; a.push("ok");','Object.assign(R, ["ok"]);','Array.prototype.push.call(R, "ok");','Array.prototype.push.apply(R, ["ok"]);','[].push.apply(R, ["ok"]);','const add = R.push.bind(R); add("ok");','const { push } = R; push.call(R, "ok");','const { pop } = R; pop();','Object.defineProperty(R, "0", { value: "ok" });','Reflect.set(R, 0, "ok");','Object.setPrototypeOf(R, ["ok"]);','const o = { R }; o.R.push("ok");','R.forEach((x, i, arr) => { arr.push("ok"); });','R.forEach((...a) => { a[2].push("ok"); });','R.map((x, i, arr) => { arr[i] = "ok"; return x; });','R.filter((x, i, arr) => arr.push("ok"));','eval("R.push(\'ok\')");','new Function("r", "r.push(\'ok\')")(R);','Function("r", "r.push(\'ok\')")(R);','R.sort().splice(0, 0, "ok");','R.reverse()[0] = "ok";','seed(R.sort());','const c = R; seed(c);','Promise.resolve(R).then((a) => a.push("ok"));','R.reduce((acc, x, i, arr) => arr.push("ok"), 0);'];
const MX_OBJ_W = ['D.s = "ok";','D.s ??= "ok";','D.s ||= "ok";','D.s++;','D.s--;','++D.s;','D["s"]++;','(D.s)++;','D.s!++;','(D.s) = "ok";','D.s! = "ok";','D["s"] = "ok";','Object.assign(D, { s: "ok" });','Object.defineProperty(D, "s", { value: "ok" });','Reflect.set(D, "s", "ok");','Object.setPrototypeOf(D, { s: "ok" });','const o = { D }; o.D.s = "ok";','({ x: D.s } = { x: "ok" });','[D.s] = ["ok"];','[[D.s]] = [["ok"]];','({ ...D.s } = {});','[...D.s] = ["ok"];','for (D.s of ["ok"]) {}','for (D.s in { ok: 1 }) {}','for ([D.s] of [["ok"]]) {}','const a = D; a.s = "ok";','seed(D);'];
const MX_ROWS_R = ['R.includes("x");','R.join(",");','R.indexOf("x");','R.lastIndexOf("x");','R.at(0);','R.findIndex((x) => x);','R.keys();','R.values();','R.entries();','R.concat(["x"]);','R.map((x) => x);','R.filter((x) => x);','R.slice();','R.flat();','R.some((x) => x);','R.every((x) => x);','R.find((x) => x);','R.forEach((x, i) => track(x, i));','R.sort();','R.reverse();','R.sort((a, b) => 0);','R.length;','R[0];','typeof R;','`${R}`;','R ? 1 : 2;','!R;','R && 1;','"a" in R;','R instanceof Array;','for (const x of R) { track(x); }','for (const k in R) { track(k); }','const copy = [...R];','const copy = Array.from(R);','const { length } = R;','const first = R[0]; track(first);','track(R[0]);','track(R.length);','const l = R.length; track(l);','if (R) { track(1); }','const a = R; const n = a.length;','R.map((x) => x).push("ok");','R.slice().push("ok");','R.concat([]).push("ok");','R.filter(Boolean).push("ok");','const c = [...R]; c.push("ok");'];
const MX_CH = `function C({ s, n }) { return <b className={TONE[s] ?? TONE.default}>{n}</b>; }`;
const MX_PS = `<C s={q.data?.s} n={q.data?.n} />`;
const MX_COMP = [
  ["alias", `${MX_CH}\nconst D2 = C;`, `<>${MX_PS}<D2 s="ok" n={q.data?.n} /></>`],
  ["direct call", MX_CH, `<>${MX_PS}{C({ s: "ok", n: q.data?.n })}</>`],
  ["createElement", MX_CH, `<>${MX_PS}{React.createElement(C, { s: "ok", n: q.data?.n })}</>`],
  ["cloneElement", MX_CH, `{React.cloneElement(${MX_PS}, { s: "ok" })}`],
  ["memo(C)", `${MX_CH}\nconst M = React.memo(C);`, `<>${MX_PS}<M s="ok" n={q.data?.n} /></>`],
  ["export { C }", `${MX_CH}\nexport { C };`, MX_PS],
  ["export default C", `${MX_CH}\nexport default C;`, MX_PS],
  ["export function", `export ${MX_CH}`, MX_PS],
  ["array of components", `${MX_CH}\nconst Cs = [C];`, `<>${MX_PS}{Cs.map((X) => <X s="ok" n={q.data?.n} />)}</>`],
  ["component handed to a prop", MX_CH, `<><Host As={C} />${MX_PS}</>`],
  ["member tag", `${MX_CH}\nconst NS = { C };`, `<>${MX_PS}<NS.C s="ok" n={q.data?.n} /></>`],
  ["literal at a second site", MX_CH, `<>${MX_PS}<C s="ok" n={q.data?.n} /></>`],
  ["spread at a second site", MX_CH, `<>${MX_PS}<C {...{ s: "ok" }} n={q.data?.n} /></>`],
];
const MX_CASES = [];
for (const f of MX_SCALAR_W) MX_CASES.push(["scalar: " + f, true, MX_SC((x) => f.replaceAll("X", x))]);
MX_CASES.push(["scalar(var): var s redeclared", true, MX_PAGE(`var s = q.data?.s; var s = "ok";`, `<span className={TONE[s] ?? TONE.default}>{q.data?.n}</span>`)]);
for (const f of MX_SCALAR_W.filter((f) => !/var X|function X|catch/.test(f))) MX_CASES.push(["param: " + f, true, MX_PA((x) => f.replaceAll("X", x))]);
for (const f of MX_ROWS_W) MX_CASES.push(["rows: " + f, true, MX_RW((x) => f.replaceAll("R", x))]);
for (const f of MX_OBJ_W) MX_CASES.push(["obj: " + f, true, MX_OB((x) => f.replaceAll("D", x))]);
for (const [l, tail, ret] of MX_COMP) MX_CASES.push(["component: " + l, true, MX_PAGE("", ret, tail)]);
for (const f of MX_ROWS_R) MX_CASES.push(["rows-read: " + f, false, MX_RW((x) => f.replaceAll("R", x))]);
for (const f of ['const x = D.s;', 'track(D.s);', 'D.s === "x";', '`${D.s}`;', 'const { s } = D;', 'D.s?.length;']) MX_CASES.push(["obj-read: " + f, false, MX_OB((x) => f.replaceAll("D", x))]);
for (const f of ['const a = X;', 'X.length;', 'typeof X;', 'X === "x";', '`${X}`;', 'X ? 1 : 2;']) MX_CASES.push(["scalar-read: " + f, false, MX_SC((x) => f.replaceAll("X", x))]);

// Round-8: map aliasing / mutation / case-transformed absent keys.
const mkMap = (pre, use, body = "") => keyFx(pre, body, use);
const EMER = "text-emerald-400";
BUG_R6.push(
  ["map reached through a const alias of the MAP: T.ok", mkMap(`const T0 = { ok: "${EMER}" }; const T = T0;`, "T.ok")],
  ["map alias, dynamic key", mkMap(`const T0 = { ok: "${EMER}", bad: "text-red-400" }; const T = T0;`, "T[q.data?.s]")],
  ["map mutated after its declaration: T.default = …", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; T.default = "${EMER}";`, "T[q.data?.s] ?? T.default")],
  ["map mutated: T.undefined = …", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; T.undefined = "${EMER}";`, "T[q.data?.s] ?? T.default")],
  ["map mutated: Object.assign(T, …)", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; Object.assign(T, { undefined: "${EMER}" });`, "T[q.data?.s] ?? T.default")],
  ["map mutated through an unreadable key: T[k] = …", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; T[keyFn()] = "${EMER}";`, "T[q.data?.s] ?? T.default")],
  ["spread of an inline literal carrying an undefined entry", mkMap(`const T = { ...{ undefined: "${EMER}" }, default: "text-slate-400" };`, "T[q.data?.s] ?? T.default")],
  ["case-transformed absent key: String(s).toUpperCase()", mkMap(`const U = { UNDEFINED: "${EMER}", ok: "text-red-400", default: "text-slate-400" };`, "U[String(q.data?.s).toUpperCase()] ?? U.default")],
  ["case-transformed absent key: [object object]", mkMap(`const E = { "[object object]": "${EMER}", default: "text-slate-400" };`, "E[String(d).toLowerCase()] ?? E.default", `const d = q.data ?? {};`)],
  ["case-transformed absent key: d.toString().toUpperCase()", mkMap(`const E = { "[OBJECT OBJECT]": "${EMER}", default: "text-slate-400" };`, "E[d.toString().toUpperCase()] ?? E.default", `const d = q.data ?? {};`)],
  ["array-valued key: Array.from(String(s))", mkMap(`const U = { "u,n,d,e,f,i,n,e,d": "${EMER}", default: "text-slate-400" };`, "U[Array.from(String(q.data?.s))] ?? U.default")],
  ["map write: Reflect.set(T, \"undefined\", \u2026)", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; Reflect.set(T, "undefined", "${EMER}");`, "T[q.data?.s] ?? T.default")],
  ["map write: Object.defineProperty(T, \"undefined\", { value })", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; Object.defineProperty(T, "undefined", { value: "${EMER}" });`, "T[q.data?.s] ?? T.default")],
  ["map write through a non-null assertion: T!.undefined = \u2026", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; T!.undefined = "${EMER}";`, "T[q.data?.s] ?? T.default")],
  ["map write through an alias: A.undefined = \u2026", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; const A = T; A.undefined = "${EMER}";`, "T[q.data?.s] ?? T.default")],
  ["map write: Object.assign((0, T), \u2026)", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; Object.assign((0, T), { undefined: "${EMER}" });`, "T[q.data?.s] ?? T.default")],
  ["map write: Object[\"assign\"](T, \u2026)", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; Object["assign"](T, { undefined: "${EMER}" });`, "T[q.data?.s] ?? T.default")],
  ["map write: const { assign } = Object; assign(T, \u2026)", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; const { assign } = Object; assign(T, { undefined: "${EMER}" });`, "T[q.data?.s] ?? T.default")],
  ["map write: Object.defineProperties(T, \u2026)", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; Object.defineProperties(T, { undefined: { value: "${EMER}" } });`, "T[q.data?.s] ?? T.default")],
  ["map write: Reflect.defineProperty(T, \u2026)", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; Reflect.defineProperty(T, "undefined", { value: "${EMER}" });`, "T[q.data?.s] ?? T.default")],
  ["map write: Object.setPrototypeOf(T, \u2026)", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; Object.setPrototypeOf(T, { undefined: "${EMER}" });`, "T[q.data?.s] ?? T.default")],
  ["map write: object-pattern target ({ a: T.undefined } = \u2026)", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; ({ a: T.undefined } = { a: "${EMER}" });`, "T[q.data?.s] ?? T.default")],
  ["map write: computed object-pattern target", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; ({ [k]: T.undefined } = { a: "${EMER}" });`, "T[q.data?.s] ?? T.default")],
  ["map write: parenthesized pattern target", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; ({ a: (T.undefined) } = { a: "${EMER}" });`, "T[q.data?.s] ?? T.default")],
  ["map write: pattern nested in an array", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; [{ a: T.undefined }] = [{ a: "${EMER}" }];`, "T[q.data?.s] ?? T.default")],
  ["map write: object rest target ({ ...T.undefined } = \u2026)", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; ({ ...T.undefined } = { a: "${EMER}" });`, "T[q.data?.s] ?? T.default")],
  ["map write: pattern target inside a for-loop", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; for (let i = 0; i < 1; i++) ({ a: T.undefined } = { a: "${EMER}" });`, "T[q.data?.s] ?? T.default")],
  ["map write through the alias target: const T0 = {...}; const T = T0; T0.undefined = \u2026", mkMap(`const T0 = { ok: "text-red-400", default: "text-slate-400" }; const T = T0; T0.undefined = "${EMER}";`, "T[q.data?.s] ?? T.default")],
  ["map escapes: export default T", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; export default T;`, "T[q.data?.s] ?? T.default")],
  ["map escapes: export { T }", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; export { T };`, "T[q.data?.s] ?? T.default")],
  ["map escapes: shorthand { T } stored", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; const reg = { T };`, "T[q.data?.s] ?? T.default")],
  ["key rule: String(s).slice(0, 3) over an entry \"und\"", mkMap(`const T = { und: "${EMER}", default: "text-slate-400" };`, "T[String(q.data?.s).slice(0, 3)] ?? T.default")],
  ["key rule: an unknown helper call as the key", mkMap(`const T = { ok: "${EMER}", default: "text-slate-400" };`, "T[helper(q.data?.s)] ?? T.default")],
  ["map read through a non-null assertion: T![s], no fallback", mkMap(`const T = { ok: "${EMER}", bad: "text-red-400" };`, "T![q.data?.s]")],
  ["map read through a non-null assertion: T!.ok", mkMap(`const T = { ok: "${EMER}", bad: "text-red-400" };`, "T!.ok")],
  ["class hoisted through a call: const G = clsx(\"\u2026emerald\")", mkMap(`const G = clsx("${EMER}");`, "G")],
  ["map built by Object.fromEntries", mkMap(`const T = Object.fromEntries([["ok", "${EMER}"]]);`, "T[q.data?.s]")],
  ["map picked by a useMemo selector", mkMap(`const T = useMemo(() => ({ ok: "${EMER}" }), []);`, "T[q.data?.s]")],
  ["map write: T.__proto__ = \u2026", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; T.__proto__ = { undefined: "${EMER}" };`, "T[q.data?.s] ?? T.default")],
  ["map escapes to a function that writes it: seed(T)", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; function seed(m) { m.undefined = "${EMER}"; } seed(T);`, "T[q.data?.s] ?? T.default")],
  ["map stored in an array, then written", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; const reg = [T]; reg[0].undefined = "${EMER}";`, "T[q.data?.s] ?? T.default")],
  ["map written through a destructuring-assignment target", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; [T.undefined] = ["${EMER}"];`, "T[q.data?.s] ?? T.default")],
  ["map written through a for\u2026of target", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; for (T.undefined of ["${EMER}"]) {}`, "T[q.data?.s] ?? T.default")],
  ["map written in a finally block", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; try { init(); } finally { T.undefined = "${EMER}"; }`, "T[q.data?.s] ?? T.default")],
  ["map written in a class static block", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; class Seed { static { T.undefined = "${EMER}"; } }`, "T[q.data?.s] ?? T.default")],
  ["array key through .slice is not a plain key", mkMap(`const E2 = { "": "${EMER}", default: "text-slate-400" };`, "E2[rows.slice(0)] ?? E2.default", ROWS)],
  ["array key through .filter is not a plain key", mkMap(`const E2 = { "": "${EMER}", default: "text-slate-400" };`, "E2[rows.filter(Boolean)] ?? E2.default", ROWS)],
  ["String shadowed: key rule", mkMap(`const String = (v) => [v]; const T = { "": "${EMER}", default: "text-slate-400" };`, "T[String(q.data?.s)] ?? T.default")],
);
OK_R6.push(
  ["map alias whose entries are not good-state", mkMap(`const T0 = { calm: "text-slate-400", default: "text-slate-400" }; const T = T0;`, "T[q.data?.s] ?? T.default")],
  ["map mutated with a non-good entry", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; T.default = "text-slate-500";`, "T[q.data?.s] ?? T.default")],
  ["map only read: Object.keys(T), `k in T`, spread, destructure", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; const names = Object.keys(T); const has = "ok" in T; const C = { ...T }; const { ok } = T;`, "T[q.data?.s] ?? T.default")],
  ["map read through a non-null assertion", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" };`, "T![q.data?.s] ?? T!.default")],
  ["control: a map with no absent-key entry", mkMap(`const U = { ok: "text-red-400", default: "text-slate-400" };`, "U[q.data?.s?.x] ?? U.default")],
);

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
    ["ALIAS-CHAIN-5 (A0 → … → A4 → GOOD)", BUG_ALIASCHAIN5],
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
    ["AS-CONST object map, className={T.muted}", OK_ASCONSTMAP],
    ["reassigned `let` is not resolved", OK_LETREASSIGNED],
    ["alias cycle terminates, no finding", OK_ALIASCYCLE],
  ];
  for (const [label, src] of fnOk) {
    const v = analyze(src, "FNOK.tsx");
    console.log(`  self-test FN-OK ${label} → ${v.length} violation(s)`);
    if (v.length !== 0) { ok = false; console.error(`  FAIL — false positive: ${label}`); for (const x of v) console.error(`    L${x.line} ${x.kind} ${x.snippet}`); }
  }

  // Backlog 2379 remainder: props provenance + object-map class resolution.
  for (const [label, src] of [["PROPS (<Panel items={items} />, child unguarded)", BUG_PROPS], ["MAP (className={TONE[status]}, no fallback)", BUG_MAP]]) {
    const v = analyze(src, "REMAINDER.tsx");
    console.log(`  self-test REMAINDER ${label} → ${v.length}: ${v.map((x) => x.kind).join(" ")}`);
    if (!v.some((x) => x.kind === "good-class-on-unguarded-data")) { ok = false; console.error(`  FAIL — false-negative not closed: ${label}`); }
  }
  for (const [label, src] of [
    ["PROPS guarded in the child", OK_PROPS_CHILDGUARD],
    ["PROPS guarded at the call site", OK_PROPS_PARENTGUARD],
    ["MAP with `?? TONE.default` fallback", OK_MAP_FALLBACK],
    ["MAP with literal non-good fallback", OK_MAP_LITFALLBACK],
    ["MAP literal non-good key (TONE.bad)", OK_MAP_STATICKEY],
  ]) {
    const v = analyze(src, "REMAINDEROK.tsx");
    console.log(`  self-test REMAINDER-OK ${label} → ${v.length} violation(s)`);
    if (v.length !== 0) { ok = false; console.error(`  FAIL — false positive: ${label}`); for (const x of v) console.error(`    L${x.line} ${x.kind} ${x.snippet}`); }
  }

  // Round-1 review of #1370.
  for (const [label, src] of [
    ["PROPS identifier (props.items)", BUG_PROPS_IDENT],
    ["PROPS {...spread}", BUG_PROPS_SPREAD],
    ["PROPS React.memo wrapper", BUG_PROPS_MEMO],
    ["PROPS forwardRef wrapper", BUG_PROPS_FWDREF],
    ["PROPS renamed destructure ({ items: list })", BUG_PROPS_RENAMED],
    ["PROPS children", BUG_PROPS_CHILDREN],
    ["COLLISION (the local Row fed query data is the emerald one)", BUG_COLLIDE_REAL],
    ["MAP through a const alias", BUG_MAP_ALIAS],
    ["MAP through a same-file helper", BUG_MAP_HELPER],
    ["MAP nested (TONE.a[status])", BUG_MAP_NESTED],
    ["MAP spread (...BASE)", BUG_MAP_SPREAD],
    ["MAP fallback is good-state: ?? TONE.ok", BUG_MAP_FB_PROP],
    ['MAP fallback is good-state: ?? TONE["ok"]', BUG_MAP_FB_ELEM],
    ['MAP fallback is good-state: || "…emerald"', BUG_MAP_FB_LIT],
  ]) {
    const v = analyze(src, "R1.tsx");
    console.log(`  self-test R1 ${label} → ${v.length}: ${v.map((x) => x.kind).join(" ")}`);
    if (!v.some((x) => x.kind === "good-class-on-unguarded-data")) { ok = false; console.error(`  FAIL — not caught: ${label}`); }
  }
  for (const [label, src] of [
    ["PROPS identifier, guarded in the child", OK_PROPS_IDENT_GUARD],
    ["PROPS children, guarded at the call site", OK_PROPS_CHILDREN_GUARD],
    ["COLLISION (only the top-level, static-fed Row is emerald)", OK_COLLIDE_STATIC],
    ["MAP alias under a data guard", OK_MAP_ALIAS_GUARD],
    ["MAP helper under a data guard", OK_MAP_HELPER_GUARD],
    ["MAP nested with a non-good fallback", OK_MAP_NESTED_FALLBACK],
  ]) {
    const v = analyze(src, "R1OK.tsx");
    console.log(`  self-test R1-OK ${label} → ${v.length} violation(s)`);
    if (v.length !== 0) { ok = false; console.error(`  FAIL — false positive: ${label}`); for (const x of v) console.error(`    L${x.line} ${x.kind} ${x.snippet}`); }
  }

  // Round-2 review of #1370.
  for (const [label, src] of [
    ['KEY defaults to the good entry: T[s ?? "ok"] ?? T.default', BUG_KEY_NULLISH],
    ['KEY defaults to the good entry: T[s || "ok"] ?? "slate"', BUG_KEY_OR],
    ["KEY defaults through a const: T[s ?? DEFAULT_KEY] ?? T.default", BUG_KEY_CONST],
    ["KEY is a const fixed key: T[KEY] ?? T.default", BUG_KEY_CONSTONLY],
    ['KEY defaults through a ternary: T[s ? s : "ok"] ?? T.default', BUG_KEY_TERNARY],
    ['operator is not a fallback: T[s] + " font-bold"', BUG_MAP_PLUS],
    ['literal key is not skipped: T["ok"] ?? "slate"', BUG_MAP_LITKEY_ELEM],
    ['literal key is not skipped: T.ok || "slate"', BUG_MAP_LITKEY_PROP],
    ["good class through a prop (tone=)", BUG_PROP_CLASS],
    ["good class from a map through a prop (tone={T[s]})", BUG_PROP_CLASS_MAP],
    ["whole query object through a prop (query={q})", BUG_QOBJ],
    ["whole query object, destructured in the child", BUG_QOBJ_DESTRUCT],
    ["whole query object spread ({...q}) into ({ data })", BUG_QOBJ_SPREAD],
  ]) {
    const v = analyze(src, "R2.tsx");
    console.log(`  self-test R2 ${label} → ${v.length}: ${v.map((x) => x.kind).join(" ")}`);
    if (!v.some((x) => x.kind === "good-class-on-unguarded-data")) { ok = false; console.error(`  FAIL — not caught: ${label}`); }
  }
  for (const [label, src] of [
    ["plain key with a fallback: T[s?.toLowerCase()] ?? T.default", OK_KEY_PLAIN],
    ["good class through a prop, call site guarded", OK_PROP_CLASS_GUARD],
    ["good class through a prop, child renders no data", OK_PROP_CLASS_STATIC],
    ["query object passed under a call-site guard", OK_QOBJ_CALLGUARD],
    ["query object guarded in the child", OK_QOBJ_CHILDGUARD],
  ]) {
    const v = analyze(src, "R2OK.tsx");
    console.log(`  self-test R2-OK ${label} → ${v.length} violation(s)`);
    if (v.length !== 0) { ok = false; console.error(`  FAIL — false positive: ${label}`); for (const x of v) console.error(`    L${x.line} ${x.kind} ${x.snippet}`); }
  }

  // Round-3 review of #1370.
  for (const [label, src] of BUG_R3) {
    const v = analyze(src, "R3K.tsx");
    console.log(`  self-test R3 key ${label} → ${v.length}: ${v.map((x) => x.kind).join(" ")}`);
    if (!v.some((x) => x.kind === "good-class-on-unguarded-data")) { ok = false; console.error(`  FAIL — not caught: key ${label}`); }
  }
  for (const [label, src] of OK_R3) {
    const v = analyze(src, "R3KOK.tsx");
    console.log(`  self-test R3-OK key ${label} → ${v.length} violation(s)`);
    if (v.length !== 0) { ok = false; console.error(`  FAIL — false positive: key ${label}`); for (const x of v) console.error(`    L${x.line} ${x.kind} ${x.snippet}`); }
  }

  // Round-4 review of #1370.
  for (const [label, src] of BUG_R4) {
    const v = analyze(src, "R4.tsx");
    console.log(`  self-test R4 ${label} → ${v.length}: ${v.map((x) => x.kind).join(" ")}`);
    if (!v.some((x) => x.kind === "good-class-on-unguarded-data")) { ok = false; console.error(`  FAIL — not caught: ${label}`); }
  }
  for (const [label, src] of OK_R4) {
    const v = analyze(src, "R4OK.tsx");
    console.log(`  self-test R4-OK ${label} → ${v.length} violation(s)`);
    if (v.length !== 0) { ok = false; console.error(`  FAIL — false positive: ${label}`); for (const x of v) console.error(`    L${x.line} ${x.kind} ${x.snippet}`); }
  }

  // Round-5 review of #1370.
  for (const [label, src] of BUG_R5) {
    const v = analyze(src, "R5.tsx");
    console.log(`  self-test R5 ${label} → ${v.length}: ${v.map((x) => x.kind).join(" ")}`);
    if (!v.some((x) => x.kind === "good-class-on-unguarded-data")) { ok = false; console.error(`  FAIL — not caught: ${label}`); }
  }
  for (const [label, src] of OK_R5) {
    const v = analyze(src, "R5OK.tsx");
    console.log(`  self-test R5-OK ${label} → ${v.length} violation(s)`);
    if (v.length !== 0) { ok = false; console.error(`  FAIL — false positive: ${label}`); for (const x of v) console.error(`    L${x.line} ${x.kind} ${x.snippet}`); }
  }

  // Round-6 review of #1370.
  for (const [label, src] of BUG_R6) {
    const v = analyze(src, "R6.tsx");
    console.log(`  self-test R6 ${label} → ${v.length}: ${v.map((x) => x.kind).join(" ")}`);
    if (!v.some((x) => x.kind === "good-class-on-unguarded-data")) { ok = false; console.error(`  FAIL — not caught: ${label}`); }
  }
  for (const [label, src] of OK_R6) {
    const v = analyze(src, "R6OK.tsx");
    console.log(`  self-test R6-OK ${label} → ${v.length} violation(s)`);
    if (v.length !== 0) { ok = false; console.error(`  FAIL — false positive: ${label}`); for (const x of v) console.error(`    L${x.line} ${x.kind} ${x.snippet}`); }
  }

  // Round-8 write-form matrix.
  for (const [label, expectFlag, src] of MX_CASES) {
    const flagged = analyze(src, "MX.tsx").some((x) => x.kind === "good-class-on-unguarded-data");
    if (flagged !== expectFlag) { ok = false; console.error(`  FAIL — matrix ${expectFlag ? "missed" : "false positive"}: ${label}`); }
  }
  console.log(`  self-test MATRIX ${MX_CASES.length} cases (${MX_CASES.filter((c) => c[1]).length} must flag, ${MX_CASES.filter((c) => !c[1]).length} must not)`);

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
