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
// Codex review of #1370 (round 20): identifier-style props (`props.tone`, `props.query.data`), nested binding
// patterns (`{ items: { length } }`), `memo(Named)` / `forwardRef(Named)`, and helpers resolved in their own lexical
// scope are followed; a good class and unguarded data are paired PER CALL SITE (a site passing no data contributes
// no class) and the pairing is PROP-level (the data must ride a prop the child reads); a parenthesised / asserted
// `(TONE[s]) ?? …` fallback is the same lookup as the bare form. Round 21: nested query-object and class bindings
// (`{ query: { data } }`, `{ style: { tone } }`), JSX-valued children (`<Panel><>{data}</></Panel>`), a nearer opaque
// binding of a component name (a parameter, a class, an import) shadows an outer component, `React["cloneElement"]`,
// downstream map aliases (`const T1 = T0`), and an imported `String`/`Array` is not the global.
// KNOWN OPEN (Codex pass 4 on 1f81c0a0 and the landing refute; NOT fixed — each is a long-tail shape):
//   Round 32 DECLARED (not built): a nested object map `TONE[group][status]` is judged on its FIRST sub-map only; a later sub-map
//   with a good class under the same key is not examined, so a good-class entry there stays silent. Resolving every sub-map needs a
//   per-key product over both lookups; the live tree has no nested map, so the cost is declared, not paid (backlog row filed).
//   Round 33 DECLARED (Codex pass 13 on 8c74d9cf; not built, 0 instances in the live console tree):
//     SILENT: a render-prop invoked through `.call`/`.apply` (`render.call(null, v)`) is not followed; `void 0` as an argument is read as an
//     explicit value, so the parameter default is not walked; a member of a same-file component object reassigned after its literal
//     (`Components.Pill = Good`) is judged by the literal's member only; a data variable derived by ASSIGNMENT (`let n; n = value`) rather
//     than an initializer is not tracked.
//     OVER-FLAG (fail-closed): a later JSX spread that replaces a data prop (`n={q.data?.n} {...{ n: "known" }}`) still taints the child; a
//     same-file member tag (`<Components.Pill s={…} />`) is not counted as a call site for plain-prop analysis; any identifier or string named
//     `cloneElement`, even a local helper, marks every component as having unseen call sites.
//   Round 32 FIXED: a member tag whose member is absent, computed, or hidden behind a spread is rejected when it receives unguarded
//   query data; `.call`/`.apply` shift the argument list before a parameter default applies; a `var` component hoists to its function.
//   false NEGATIVES: a shorthand property in a JSX spread (`{...{ tone, n }}`); a query object inside a spread literal
//   (`{...{ query: q }}`); a query prop forwarded as `props.query` across components; props destructured in the BODY
//   (`const { tone, n } = props`), `let p = props`, `(props as any).tone`, `const { query } = props`; a nested-pattern default
//   (`{ style: { tone = "…emerald" } }`); a const style object (`style={st}`); a conditional or nested spread;
//   `React["clone" + "Element"]`; an identifier-props child rendering its own query.
//   false POSITIVES (fail-closed over-flags): status-flag props (`isError={q.isError}`) are not propagated into child
//   guards; a primitive `__proto__` entry is treated as an absent-key hazard; `hasAbsentKeyEntry` walks the whole map
//   instead of only the coerced absent-key entry; class paths nested more than one level deep merge sibling fields;
//   map mutations are matched by identifier text across functions; an absent-key getter's whole body is walked
//   (a `console.log("…emerald")` in it is reported).
// Codex pass 5 on fd8b56c5 (NOT fixed, declared): false NEGATIVES: an object-valued query prop (`config={{ query: q }}`);
//   a good class that reaches a child as JSX children rather than a prop. false POSITIVE (fail-closed): a map
//   literal whose own entry overrides a spread one (`{ ...BASE, ok: "text-red-400" }`) is still read as the spread class.
// Codex pass 6 on 68827403 (NOT fixed, declared; each pre-existing since af273d65): false NEGATIVES: a good class forwarded
//   through `<Leaf {...props} />` (the spread branch resolves only object literals and const objects); a parameter default
//   that supplies the class (`{ tone = "text-emerald-400", n }` used as `<Pill n={q.data?.n} />`; only the nested-pattern default
//   was declared before); a local or imported `Object` is trusted because `Object.keys/values/entries` are matched by name;
//   a getter's side effect during `const { a } = T` (destructuring is treated as a plain read). false POSITIVE (fail-closed):
//   an explicit good class followed by a later overriding spread. Also fail-closed: a child that calls any query but renders
//   only its props over-flags (the own-query pairing exception).
// Codex pass 7 on fa5ad9a0 (declared, NOT fixed): false NEGATIVES: affirmation TEXT carried through an arbitrary component prop
//   (`<Panel message="All clear" n={q.data?.n} />` with the child rendering `{message}` is silent: only classes and data ride props);
//   the alias returned by `Object.assign(T)` (`const U = Object.assign(T); U.undefined = "…emerald"`) is not tracked, so the write is
//   missed (silent).
// Codex pass 8 on 20450a32 and the round-26 landing refute (round 27, all FIXED): a helper call is judged by EVERY value its binding can
//   hold: the initializer, an alias (`const` / `let` / `var`, an alias chain), and each write to it (`=`, `&&=` / `||=` / `??=`, a chained
//   `a = b = x`, a conditional / logical / comma right-hand side, a type-asserted one). A write this analysis cannot collect (a
//   destructuring or `for…of` target, `++`, a member / call / unresolvable right-hand side, an arithmetic compound assignment) makes the
//   call POSSIBLY GOOD, so it flags on unguarded query data (fail-closed; an over-flag when the write is in fact harmless). A nearer
//   parameter / catch / loop binding or nested `let` shadows a helper alias and a class-valued component parameter; string-literal and
//   computed prop names (`{ "data-value": n }`) ride the props like identifier ones.
//   STILL SILENT after round 28 (named exactly): writes to a PARAMETER or to a destructured `let` (`let { tone } = …; tone = good`);
//   an initializer this analysis cannot resolve (`let tone = helpers.good`, `useCallback(good, [])`, `good.bind(null)`; the `const`
//   member form flags through the map walk); a helper called through an array / Map element (`fns[0]()`), `.bind(null)()`, or imported
//   (no module resolver). Callee spellings `(tone)()`, `tone!()`, `tone.call(null)` and `tone.apply(null, [])` ARE followed (round 28).
// Round 28 (landing refute 27, FIXED): a `var` redeclaring a component parameter in the parameter's OWN function (`function P({ tone }) { var
//   tone; }`, also in a nested block of it) is the SAME binding, not a shadow, and its initializer is one more value of the parameter;
//   same-scope `var` redeclarations of a helper are merged (`var tone = red; var tone = emerald;`).
// Round 31 (Codex pass 11 on 74b05455, FIXED): a component binding is judged by EVERY component it can hold (`enabled ? Good : Bad`,
//   `enabled && Good`, `Good ?? Bad`; `&&` contributes its right operand only) and a branch this analysis cannot resolve (an imported
//   or computed component, a call) REJECTS an element of it that receives unguarded query data; a member-expression tag backed by a
//   same-file const object literal (`<Components.Pill />`, shorthand or inline members) is followed, and an unresolvable member is
//   rejected; a TypeScript overload signature is not the component (only declarations with a body register); a helper parameter
//   DEFAULT is walked as a value when the argument is omitted, `undefined`, or shifted by `.call` / `.apply`; string-literal bracket
//   access (`q["data"]`, `props.query["data"]`, status members) is read like dotted access; a render-prop callback handed to a same-file
//   component (`render={(n) => …}`, a same-file function name, function-as-children) takes the origin of the arguments the component
//   calls it with (`render(value)`, `props.render(value)`, `children(value)`). STILL SILENT (declared): a non-literal bracket key
//   (`props.query[k]`); a callback the gate cannot resolve (an imported function, a computed value); an imported namespace member tag
//   (`<UI.Pill />`, the declared imported-component limitation, consistent with an imported identifier tag); a callback stored in a
//   variable or an object before it is passed.
// Round 30 (landing refute of rounds 28/29, FIXED): the unresolved-wrapper rejection also counts a WHOLE query object as carried data
//   (`<Row query={q} />`, `<Row {...q} />`, the references `passQuery` follows) and follows an alias chain (`const Pill = P;`); the rest
//   subtraction removes only siblings with a KNOWN source key (an identifier, a string / numeric literal, a computed literal): a computed
//   non-literal sibling (`{ [k]: tone, ...rest }`) leaves `rest` holding every prop. `.call` / `.apply` callees are followed and their
//   argument positions are not substituted; a member of an imported object is not React's.
// Codex pass 10 on 57cef22e (round 29): FIXED: `memo` / `forwardRef` are transparent ONLY when they are React's (a named import from "react",
//   aliases included, or a member of a namespace / default import of "react"); a local definition, an import from any other module, a
//   member of anything else or a bare undeclared name is UNRESOLVED, and a component bound to one that receives unguarded query data is
//   REJECTED (kind unresolved-wrapper-on-unguarded-data; a call site guarded on the data, or passing no data, is clean). A numeric or
//   template-literal map key (`T[1]`, T[`ok`]) selects its own entry. A rest binding receives only the properties the pattern did not
//   destructure. DECLARED, NOT BUILT: a map property unconditionally overwritten before the lookup (`const T = { ok: emerald };
//   T.ok = red; className={T.ok}`) still counts the initializer as a possible value, an over-flag (fail-closed): last-write semantics is
//   flow-sensitive analysis this gate does not do anywhere else.
// Codex pass 9 on ad26faa5 (declared, NOT fixed; each pre-existing): false NEGATIVES: a `let` COMPONENT reassigned to another component
//   (`let Pill = …red; Pill = …emerald;` registers the initializer only); `React.createElement(Pill, { tone: "…emerald", n: q.data?.n })`
//   is not a propagation site (only JSX attributes carry data and classes into a child). false POSITIVES (fail-closed): a query-object
//   alias (`const q2 = q; <Row query={q2} />`) is not passed as a query object, so the child's `T[query.data?.status] ?? T.default` is
//   reported; `Object.assign(T, { ok: "…emerald" })` / `Object.defineProperty` record their literal source with an unknown key, so an
//   unrelated `T.bad` lookup is reported; a type-only reference (`React.ComponentProps<typeof Card>`) counts as an unseen call site
//   and blocks the plain-prop exemption.
// Round 24: a same-file helper's parameter substitutes only while EVERY reference to it in the helper is a plain read
// (destructuring / for-of targets and inner shadowing count as writes); a key rooted at a query result is plain only
// through `.data` (`q.isError`, `q.isLoading`, `q.status` are present while the data is absent).
// Round 22: a same-file helper's parameter key is judged by the call's argument (`toneFor(q.data?.status)` falls back,
// `toneFor("ok")` does not); a nested class binding takes only the matching property of a literal prop; classes ride a JSX
// spread of a literal or a same-file const object; `const p = props` aliases resolve to the parameter.
// Same-file shapes followed: arrow/function/`memo`/`forwardRef` components resolved by lexical
// scope (two same-named components in different scopes never share a taint); a destructured,
// renamed, rest, `props`-identifier or `{...spread}` parameter; `children`; a whole query object
// passed under any prop name (`query={q}`, `{...q}`); a good-state class handed down as a prop
// (`tone="…emerald"`, `tone={TONE[s]}`); a map reached through a const alias, a same-file
// helper, a nested `TONE.a[status]` or a `...BASE` spread. A map lookup is unknown-safe only
// with an explicit `??`/`||` fallback AND a key this analysis can show is a plain read of query
// data: a property/optional chain that goes THROUGH `.data` (never a `.length`/`.size` read, never `q.isError` / `q.isLoading` / `q.status`), `String()` / `.toLowerCase()` /
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
//     (`const T = makeMap()`, `Object.fromEntries(…)`, `useMemo(…)`) is judged as a class string, not as a map:
//     it flags only when the call TEXT carries a good class, and `Object.create(null)` filled by later
//     assignment is silent; `new Map(…)` is silent (an `Object.entries(x).forEach(([k, v]) => { T[k] = v })` write flags). A nested sub-map is followed at every depth: used as a value (alias, call
//     argument, `Object.values/entries`, destructure, spread of a map that holds one) it escapes; only indexing it further is a read.
//     A const is judged by what it is BOUND to, recursively (`const X = pick()` is unreadable, a const bound to
//     a literal is readable); a getter on an absent-key entry must return a readable value on EVERY return path.
//     A name rebound by a hoisted `var`, a `switch` case-clause const, or a binding named `undefined` is unreadable.
//     A template with only a substitution (`${pick()}`) is read as non-good, like `text-${c}-400`.
//     Depth caps FAIL OPEN: a const alias chain of 7+ hops and a chain of 9+ nested components in the usual React layout (leaf-first, the page declared LAST; page-first layouts get one more hop, a root-first chain propagates in one pass and is not capped) are not
//     followed. A write to a `...BASE` spread source is followed (the spread sources' names join the map's). A write whose VALUE this cannot
//     read (`T.x = pick()`, a parameter, an import, `Object.assign(T, { x: pick() })`) is treated as possibly good-state; a spread this
//     cannot resolve (`...(c ? BASE : {})`, `...getBase()`, `...cfg.base`, a `let` source) is treated as carrying a possibly good-state entry. A map's WRITES are a whitelist:
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
// The member a PropertyAccess or a STRING-LITERAL ElementAccess reads (`q.data`, `q["data"]`), else null (a computed key is not followed).
function memberName(x) {
  if (ts.isPropertyAccessExpression(x)) return x.name.text;
  if (ts.isElementAccessExpression(x) && x.argumentExpression) {
    let a = x.argumentExpression;
    while (ts.isParenthesizedExpression(a) || ts.isAsExpression(a) || ts.isNonNullExpression(a)) a = a.expression;
    if (ts.isStringLiteralLike(a)) return a.text;
  }
  return null;
}
function propOf(el) {
  const pn = el.propertyName;
  if (pn && ts.isIdentifier(pn)) return pn.text;
  if (pn && ts.isStringLiteralLike(pn)) return pn.text; // `{ "data-value": n }`
  if (pn && ts.isComputedPropertyName(pn) && ts.isStringLiteralLike(pn.expression)) return pn.expression.text; // `{ ["data-value"]: n }`
  return ts.isIdentifier(el.name) ? el.name.text : undefined;
}

// The SOURCE key a binding element reads, or null when it is not known: `{ tone }`, `{ a: tone }`, `{ "a-b": tone }`, `{ ["a"]: tone }`
// are known; a computed non-literal key (`{ [k]: tone }`) may be any key, so it removes nothing from a sibling rest binding.
function knownKeyOf(el) {
  const pn = el.propertyName;
  if (!pn) return ts.isIdentifier(el.name) ? el.name.text : null;
  if (ts.isIdentifier(pn) || ts.isStringLiteralLike(pn) || ts.isNumericLiteral(pn)) return pn.text;
  if (ts.isComputedPropertyName(pn) && (ts.isStringLiteralLike(pn.expression) || ts.isNumericLiteral(pn.expression))) return pn.expression.text;
  return null;
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
  const propQueryObjs = new Map(); // identifier parameter -> Map(prop name -> origins): `query={q}` read as `props.query`
  const bindingOfParam = (id) => {
    const inPattern = (b) => { // a binding element (at any depth) named like `id`
      for (const el of b.elements) {
        if (ts.isOmittedExpression(el)) continue;
        if (ts.isIdentifier(el.name)) { if (el.name.text === id.text) return el; }
        else { const hit = inPattern(el.name); if (hit) return hit; }
      }
      return null;
    };
    for (let c = id.parent; c; c = c.parent) {
      if (!(ts.isFunctionLike(c) && c.parameters)) continue;
      for (const p of c.parameters) {
        if (ts.isIdentifier(p.name) && p.name.text === id.text) return p;
        if (ts.isObjectBindingPattern(p.name)) { const hit = inPattern(p.name); if (hit) return hit; }
      }
    }
    return null;
  };
  // Is the parameter / binding element `prm` the nearest binding of `id`'s name? A nested `let tone`, a nested function's own
  // parameter or `var`, a `catch (tone)` or a loop binding between the use and the parameter's function shadows it. A `var tone`
  // in the parameter's OWN function (any nested block of it) is the SAME binding in JavaScript (`function P({ tone }) { var tone; }`
  // keeps the caller's value), so it does not shadow; its initializer is one more value (see paramVarInits).
  const fnOf = (n) => { for (let c = n.parent; c; c = c.parent) if (ts.isFunctionLike(c)) return c; return undefined; };
  const paramOwner = (prm) => { let o = prm; while (o && !ts.isFunctionLike(o)) o = o.parent; return o; };
  const paramIsNearest = (id, prm) => {
    const owner = paramOwner(prm);
    for (let c = id.parent; c && c !== owner; c = c.parent) {
      if (bindsNameOpaquely(c, id.text)) return false;
      if (ts.isBlock(c) || ts.isSourceFile(c)) {
        const sameFn = fnOf(c) === owner;
        const hit = c.statements.some((st) =>
          (ts.isVariableStatement(st) && !(sameFn && !(st.declarationList.flags & (ts.NodeFlags.Const | ts.NodeFlags.Let))) &&
            st.declarationList.declarations.some((d) => bindsPatternName(d.name, id.text))) ||
          ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name && st.name.text === id.text) ||
          (ts.isSourceFile(c) && importedNames.has(id.text) && ts.isImportDeclaration(st)));
        if (hit) return false;
      }
      if (isVarScope(c) && declaresVar(c, id.text)) return false; // a nested function / module scope owns its hoisted `var`s (the loop stops at the owner)
    }
    return true;
  };
  const paramVarInits = (prm, name) => { // initializers of `var <name> = …` redeclaring the parameter in its own function (not nested ones)
    const owner = paramOwner(prm);
    const out = [];
    const w = (n) => {
      if (n !== owner && ts.isFunctionLike(n)) return;
      if (ts.isVariableStatement(n) && !(n.declarationList.flags & (ts.NodeFlags.Const | ts.NodeFlags.Let)))
        for (const d of n.declarationList.declarations) if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer) out.push(d.initializer);
      ts.forEachChild(n, w);
    };
    if (owner && owner.body) w(owner.body);
    return out;
  };
  const queryObjOfExpr = (e) => { // origins of a query-result expression: `q`, or `props.query` for a named query-object prop
    if (!e) return undefined;
    if (ts.isIdentifier(e) && queryObjVars.has(e.text)) return queryObjVars.get(e.text);
    if (memberName(e) !== null && ts.isIdentifier(e.expression)) {
      const prm = bindingOfParam(e.expression);
      return prm && propQueryObjs.get(prm)?.get(memberName(e));
    }
    return undefined;
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
      if (memberName(x) !== null &&
          queryObjOfExpr(x.expression) && STATUS_MEMBERS.has(memberName(x))) { hit = true; return; }
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
      if (memberName(x) !== null &&
          queryObjOfExpr(x.expression) && ERROR_LOADING.has(memberName(x))) { hit = true; return; }
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
      if (memberName(x) !== null &&
          queryObjOfExpr(x.expression) && memberSet.has(memberName(x)) && inOrigin(queryObjOfExpr(x.expression), origin)) { hit = true; return; }
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
      if (memberName(x) === "data" &&
          queryObjOfExpr(x.expression) && inOrigin(queryObjOfExpr(x.expression), origin)) { hit = true; return; }
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
      if (memberName(x) === "data" && queryObjOfExpr(x.expression) &&
          !isHandled(x, queryObjOfExpr(x.expression)) && !inGuardTest(x)) { hit = true; return; }
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
      if (memberName(x) === "data" && queryObjOfExpr(x.expression) && !inGuardTest(x)) {
        for (const o of queryObjOfExpr(x.expression)) out.add(o);
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
  // Same-file helper functions, registered with their DECLARING scope; a call site resolves the nearest
  // enclosing scope that declares the name (two components may each own a `tone()` helper).
  const unwrapExpr = (n) => (ts.isAsExpression(n) || ts.isSatisfiesExpression(n) || ts.isTypeAssertionExpression(n) ||
    ts.isNonNullExpression(n) || ts.isParenthesizedExpression(n)) ? unwrapExpr(n.expression) : n;
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
  const bindsPatternName = (b, name) => ts.isIdentifier(b) ? b.text === name
    : (ts.isObjectBindingPattern(b) || ts.isArrayBindingPattern(b)) && b.elements.some((el) => !ts.isOmittedExpression(el) && bindsPatternName(el.name, name));
  // A function, a class static block and a namespace each own their `var`s; a nested one does not leak into the enclosing scope.
  const isVarScope = (n) => ts.isFunctionLike(n) || ts.isClassStaticBlockDeclaration(n) || ts.isModuleDeclaration(n) || ts.isSourceFile(n);
  const declaresVar = (scope, name) => { // does `var <name>` (plain or destructured) appear in this scope, not inside a nested var scope?
    let found = false;
    const v = (n) => {
      if (found) return;
      if (n !== scope && isVarScope(n)) return;
      if (ts.isVariableDeclarationList(n) && !(n.flags & (ts.NodeFlags.Const | ts.NodeFlags.Let)) &&
          n.declarations.some((d) => bindsPatternName(d.name, name))) { found = true; return; }
      ts.forEachChild(n, v);
    };
    v(scope);
    return found;
  };
  const localFns = new Map(); // name -> [{ fn, scope }]
  const scopeOf = (n) => { let c = n.parent; while (c && !ts.isBlock(c) && !ts.isSourceFile(c)) c = c.parent; return c; };
  const varScopeOf = (n) => { // a `var` hoists to its function (or the module), not its block
    for (let c = n.parent; c; c = c.parent) {
      if (ts.isSourceFile(c)) return c;
      if (ts.isFunctionLike(c) && c.body) return ts.isBlock(c.body) ? c.body : scopeOf(c);
    }
    return undefined;
  };
  {
    const addFn = (name, fn, decl) => {
      const l = localFns.get(name) ?? [];
      const isVar = ts.isVariableDeclaration(decl) && !(decl.parent.flags & (ts.NodeFlags.Const | ts.NodeFlags.Let));
      l.push({ fn, scope: isVar ? varScopeOf(decl) : scopeOf(decl) });
      localFns.set(name, l);
    };
    const reg = (n) => {
      if (ts.isFunctionDeclaration(n) && n.name && n.body) addFn(n.name.text, n, n);
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer &&
          (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) addFn(n.name.text, n.initializer, n);
      ts.forEachChild(n, reg);
    };
    reg(sf);
  }
  const findHelper = (id, depth = 0) => { // the function an identifier names, resolved through lexical scope
    for (let c = id.parent; c; c = c.parent) {
      if (bindsNameOpaquely(c, id.text)) return undefined; // a nearer parameter / catch / loop binding of the name is not the helper
      if (!ts.isBlock(c) && !ts.isSourceFile(c)) continue;
      const hit = (localFns.get(id.text) ?? []).find((h) => h.scope === c);
      if (hit) return hit.fn;
      // `const pickTone = toneFor;` is the same helper under another name (an immutable alias only)
      for (const st of c.statements) {
        if (!ts.isVariableStatement(st) || !(st.declarationList.flags & ts.NodeFlags.Const)) continue;
        const d = st.declarationList.declarations.find((x) => ts.isIdentifier(x.name) && x.name.text === id.text);
        if (d) return d.initializer && ts.isIdentifier(unwrapExpr(d.initializer)) && depth < 6 ? findHelper(unwrapExpr(d.initializer), depth + 1) : undefined;
      }
    }
    return undefined;
  };
  // HELPER BINDINGS. A call `tone()` in a class position is judged by EVERY function the binding can hold: its
  // initializer, an alias (`const pick = good`, also `let` / `var`), and every function written to it later
  // (`tone = () => …`, a conditional / logical / chained right-hand side). A write this analysis cannot collect —
  // a destructuring or `for…of` target, `++`, a member / call right-hand side, an unresolvable identifier — makes the
  // binding possibly good (FAIL-CLOSED: the call flags on unguarded query data).
  const declList = []; // { name, scope, fn?, init?, mutable, writes: [expr], unknown }
  {
    const reg = (n) => {
      if (ts.isFunctionDeclaration(n) && n.name && n.body) declList.push({ name: n.name.text, scope: scopeOf(n), fn: n, mutable: true, writes: [], unknown: false });
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) {
        const isVar = !(n.parent.flags & (ts.NodeFlags.Const | ts.NodeFlags.Let));
        declList.push({ name: n.name.text, scope: isVar ? varScopeOf(n) : scopeOf(n), init: n.initializer, mutable: !(n.parent.flags & ts.NodeFlags.Const), writes: [], unknown: false });
      }
      ts.forEachChild(n, reg);
    };
    reg(sf);
  }
  const lookupDecl = (id) => { // the declaration an identifier names; null if a nearer binding of another shape owns the name
    for (let c = id.parent; c; c = c.parent) {
      if (bindsNameOpaquely(c, id.text)) return null;
      if (!ts.isBlock(c) && !ts.isSourceFile(c)) continue;
      const hit = declList.find((d) => d.name === id.text && d.scope === c);
      if (hit) return hit;
      if (blockDeclares(c, id.text)) return null; // a pattern / class / import binding
    }
    return null;
  };
  let writesDone = false;
  const ensureWrites = () => {
    if (writesDone) return;
    writesDone = true;
    const markUnknown = (idNode) => { const d = lookupDecl(idNode); if (d) d.unknown = true; };
    const targetIds = (t, f) => { // identifiers assigned by a destructuring-assignment / loop target
      const e = unwrapExpr(t);
      if (ts.isIdentifier(e)) f(e);
      else if (ts.isArrayLiteralExpression(e)) e.elements.forEach((x) => targetIds(x, f));
      else if (ts.isObjectLiteralExpression(e)) e.properties.forEach((pr) => {
        if (ts.isShorthandPropertyAssignment(pr)) f(pr.name);
        else if (ts.isPropertyAssignment(pr)) targetIds(pr.initializer, f);
        else if (ts.isSpreadAssignment(pr)) targetIds(pr.expression, f);
      });
      else if (ts.isSpreadElement(e)) targetIds(e.expression, f);
      else if (ts.isBinaryExpression(e) && e.operatorToken.kind === K.EqualsToken) targetIds(e.left, f); // `[a = 1] = …`
    };
    const w = (n) => {
      if (ts.isBinaryExpression(n) && n.operatorToken.kind >= K.FirstAssignment && n.operatorToken.kind <= K.LastAssignment) {
        const l = unwrapExpr(n.left);
        const k = n.operatorToken.kind;
        if (ts.isIdentifier(l)) {
          const d = lookupDecl(l);
          if (d) {
            if (k === K.EqualsToken || k === K.AmpersandAmpersandEqualsToken || k === K.BarBarEqualsToken || k === K.QuestionQuestionEqualsToken) d.writes.push(n.right);
            else d.unknown = true;
          }
        } else targetIds(l, markUnknown);
      }
      if ((ts.isForOfStatement(n) || ts.isForInStatement(n)) && !ts.isVariableDeclarationList(n.initializer)) targetIds(n.initializer, markUnknown);
      if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && (n.operator === K.PlusPlusToken || n.operator === K.MinusMinusToken)) targetIds(n.operand, markUnknown);
      ts.forEachChild(n, w);
    };
    w(sf);
  };
  // -> { fns: Set<function>, unknown } for the helper binding an identifier names, or null when it is not one.
  const helperValues = (id, seen = new Set()) => {
    ensureWrites();
    const d0 = lookupDecl(id);
    if (!d0) return null;
    const ds = declList.filter((x) => x.name === d0.name && x.scope === d0.scope); // `var tone = …; var tone = …;` is one binding
    if (seen.has(d0)) return { fns: new Set(), unknown: false }; // a cycle adds nothing new
    seen.add(d0);
    const out = { fns: new Set(), unknown: false };
    // strict: a callable part this analysis cannot resolve counts as possibly good (a WRITE); an initializer it cannot resolve is not a helper at all
    const add = (e, strict, depth = 0) => {
      const u = unwrapExpr(e);
      if (depth > 8) { out.unknown = true; return; }
      if (ts.isArrowFunction(u) || ts.isFunctionExpression(u)) out.fns.add(u);
      else if (ts.isIdentifier(u)) {
        if (u.text === "undefined") return;
        const sub = helperValues(u, seen);
        if (sub) { sub.fns.forEach((f) => out.fns.add(f)); if (sub.unknown) out.unknown = true; } else if (strict) out.unknown = true;
      } else if (u.kind === K.NullKeyword || ts.isStringLiteralLike(u) || ts.isNumericLiteral(u) || ts.isVoidExpression(u)) return;
      else if (ts.isConditionalExpression(u)) { add(u.whenTrue, strict, depth + 1); add(u.whenFalse, strict, depth + 1); }
      else if (ts.isBinaryExpression(u) && (u.operatorToken.kind === K.AmpersandAmpersandToken || u.operatorToken.kind === K.BarBarToken || u.operatorToken.kind === K.QuestionQuestionToken)) { add(u.left, strict, depth + 1); add(u.right, strict, depth + 1); }
      else if (ts.isBinaryExpression(u) && (u.operatorToken.kind === K.CommaToken || u.operatorToken.kind === K.EqualsToken)) add(u.right, strict, depth + 1); // `a = b = x`, `(0, x)`
      else if (strict) out.unknown = true;
    };
    let isHelper = false;
    for (const d of ds) {
      if (d.fn) { out.fns.add(d.fn); isHelper = true; }
      else if (d.init) {
        const u = unwrapExpr(d.init);
        const callable = ts.isArrowFunction(u) || ts.isFunctionExpression(u) || ts.isIdentifier(u) || ts.isConditionalExpression(u) ||
          (ts.isBinaryExpression(u) && (u.operatorToken.kind === K.AmpersandAmpersandToken || u.operatorToken.kind === K.BarBarToken || u.operatorToken.kind === K.QuestionQuestionToken));
        if (callable) { add(u, false); isHelper = true; }
        else if (d.mutable) isHelper = true; // a `let` / `var` bound to a call / member still collects its writes
      } else if (d.mutable) isHelper = true;
      if (d.mutable) { for (const wr of d.writes) add(wr, true); if (d.unknown) out.unknown = true; }
    }
    return isHelper ? out : null; // a const bound to a call / member read is not a helper binding
  };
  // `memo` / `forwardRef` unwrap ONLY when the callee is React's: a named import from "react" (aliases included) or a member of a
  // namespace / default import of "react" (`React.memo`). A local definition, an import from any other module, a member of anything
  // else, or a bare undeclared name is NOT React's: the wrapper is UNRESOLVED (see the unresolved-wrapper rule).
  const reactNamed = new Map(); // local name -> imported name
  const reactNs = new Set(); // local namespace / default import of "react"
  const topDeclared = new Set(); // names declared at module level other than by an import
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && st.importClause && ts.isStringLiteralLike(st.moduleSpecifier) && st.moduleSpecifier.text === "react" && !st.importClause.isTypeOnly) {
      const ic = st.importClause;
      if (ic.name) reactNs.add(ic.name.text);
      if (ic.namedBindings) { if (ts.isNamespaceImport(ic.namedBindings)) reactNs.add(ic.namedBindings.name.text); else for (const e of ic.namedBindings.elements) if (!e.isTypeOnly) reactNamed.set(e.name.text, (e.propertyName ?? e.name).text); }
    }
  }
  const declaresIn = (stmts, name) => stmts.some((st) =>
    (ts.isVariableStatement(st) && st.declarationList.declarations.some((d) => bindsPatternName(d.name, name))) ||
    ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name && st.name.text === name));
  const reactWrapperName = (call) => { // "memo" | "forwardRef" when the call is React's, else null
    const callee = unwrapExpr(call.expression);
    const climb = (idNode) => { // true when the nearest binding of the name is the module-level import
      for (let c = idNode.parent; c; c = c.parent) {
        if (bindsNameOpaquely(c, idNode.text)) return false;
        if (ts.isBlock(c) && declaresIn(c.statements, idNode.text)) return false;
        if (ts.isSourceFile(c)) return !declaresIn(c.statements, idNode.text);
      }
      return false;
    };
    if (ts.isIdentifier(callee)) { const imp = reactNamed.get(callee.text); return imp && (imp === "memo" || imp === "forwardRef") && climb(callee) ? imp : null; }
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && (callee.name.text === "memo" || callee.name.text === "forwardRef"))
      return reactNs.has(callee.expression.text) && climb(callee.expression) ? callee.name.text : null;
    return null;
  };
  const isWrapperName = (n) => n === "memo" || n === "forwardRef";
  const wrapperLike = (call) => ts.isCallExpression(call) &&
    (isWrapperName(callName(call)) || (ts.isIdentifier(unwrapExpr(call.expression)) && isWrapperName(reactNamed.get(unwrapExpr(call.expression).text)))); // `import { memo as m } from "react"`
  const localComponents = []; // { name, params, scope }
  // EVERY component a binding can hold: a conditional / logical initializer (`enabled ? Good : Bad`, `enabled && Good`, `Good ?? Bad`)
  // contributes each branch; `&&` contributes only its right operand (the left is a guard). A branch this analysis cannot resolve
  // (an imported or computed component, a call) marks the binding `unresolved`; the unresolved-wrapper rule then rejects an element
  // of it that receives unguarded query data.
  const componentLeaves = (init) => {
    const out = { fns: [], unresolved: false };
    const add = (e, d) => {
      if (d > 6) { out.unresolved = true; return; }
      let u = unwrapExpr(e);
      while (u && wrapperLike(u)) { if (!reactWrapperName(u)) { out.unresolved = true; return; } u = u.arguments[0] ? unwrapExpr(u.arguments[0]) : null; } // only React's own memo / forwardRef is transparent
      if (!u) { out.unresolved = true; return; }
      if (ts.isConditionalExpression(u)) { add(u.whenTrue, d + 1); add(u.whenFalse, d + 1); return; }
      if (ts.isBinaryExpression(u)) {
        const k = u.operatorToken.kind;
        if (k === K.AmpersandAmpersandToken) add(u.right, d + 1);
        else if (k === K.BarBarToken || k === K.QuestionQuestionToken) { add(u.left, d + 1); add(u.right, d + 1); }
        else out.unresolved = true;
        return;
      }
      if (ts.isArrowFunction(u) || ts.isFunctionExpression(u)) { out.fns.push(u); return; }
      if (ts.isIdentifier(u)) { // `memo(PanelImpl)` wraps a named same-file component
        if (u.text === "undefined") return;
        const f = findHelper(u);
        if (f && (ts.isArrowFunction(f) || ts.isFunctionExpression(f) || ts.isFunctionDeclaration(f))) out.fns.push(f); else out.unresolved = true;
        return;
      }
      if (u.kind === K.NullKeyword || u.kind === K.FalseKeyword) return;
      out.unresolved = true;
    };
    add(init, 0);
    return out;
  };
  {
    const reg = (n) => {
      // a TypeScript overload signature has no body and is not the component: only the implementation registers
      if (ts.isFunctionDeclaration(n) && n.body && n.name && /^[A-Z]/.test(n.name.text)) localComponents.push({ name: n.name.text, params: n.parameters, scope: scopeOf(n), fn: n });
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && /^[A-Z]/.test(n.name.text) && n.initializer) {
        const cscope = n.parent.flags & (ts.NodeFlags.Const | ts.NodeFlags.Let) ? scopeOf(n) : varScopeOf(n); // a `var` hoists to its function (or the module)
        for (const fn of componentLeaves(n.initializer).fns) localComponents.push({ name: n.name.text, params: fn.parameters, scope: cscope, fn });
      }
      ts.forEachChild(n, reg);
    };
    reg(sf);
  }
  // Does this block declare `name` in any shape (const / let / var incl. patterns, function, class, import)?
  const blockDeclares = (block, name) => block.statements.some((st) =>
    (ts.isVariableStatement(st) && st.declarationList.declarations.some((d) => bindsPatternName(d.name, name))) ||
    ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name && st.name.text === name) ||
    (ts.isSourceFile(block) && importedNames.has(name) && ts.isImportDeclaration(st)));
  // Every component a JSX tag can name: an identifier (all branches of a conditional binding) or a member expression backed by a
  // same-file const object literal (`const Components = { Pill }; <Components.Pill />`). Anything else is not resolved here.
  const adhocComps = new Map();
  const compOfFn = (fn, name) => {
    const known = localComponents.find((k) => k.fn === fn);
    if (known) return known;
    if (!adhocComps.has(fn)) adhocComps.set(fn, { name, params: fn.parameters, scope: undefined, fn });
    return adhocComps.get(fn);
  };
  const memberTagObject = (tag) => { // the same-file const object literal `Obj` of `<Obj.Name />`, else null (an imported namespace is not followed)
    if (!(ts.isPropertyAccessExpression(tag) && ts.isIdentifier(tag.expression))) return null;
    const d = lookupDecl(tag.expression);
    const o = d && !d.mutable && d.init ? unwrapExpr(d.init) : null;
    return o && ts.isObjectLiteralExpression(o) ? o : null;
  };
  const memberTagValue = (tag) => { // the value expression of `Obj.Name`; null when absent, or when a later spread could override it
    const o = memberTagObject(tag);
    if (!o) return null;
    let found = null;
    for (const pr of o.properties) {
      if (ts.isPropertyAssignment(pr) && pr.name && memberKey(pr.name) === tag.name.text) found = pr.initializer;
      else if (ts.isShorthandPropertyAssignment(pr) && pr.name.text === tag.name.text) found = pr.name;
      else if (ts.isSpreadAssignment(pr)) found = null; // `{ Pill, ...other }`: the spread may override it; `{ ...{ Pill } }` hides it. Either way not followed here.
    }
    return found;
  };
  const findComponents = (tag) => {
    if (tag && ts.isPropertyAccessExpression(tag)) {
      const v = memberTagValue(tag);
      return v ? componentLeaves(v).fns.map((fn) => compOfFn(fn, tag.getText(sf))) : [];
    }
    if (!tag || !ts.isIdentifier(tag)) return [];
    for (let c = tag.parent; c; c = c.parent) {
      if (bindsNameOpaquely(c, tag.text)) return []; // a parameter / catch / loop binding shadows the tag name
      if (!ts.isBlock(c) && !ts.isSourceFile(c)) continue;
      const hits = localComponents.filter((k) => k.name === tag.text && k.scope === c);
      if (hits.length) return hits;
      if (blockDeclares(c, tag.text)) return []; // a nearer binding this analyzer does not register still shadows an outer component
    }
    return [];
  };
  const findComponent = (tag) => findComponents(tag)[0];
  // Taint the receiving parameter. `propName === null` (a `{...p}` spread) taints every
  // binding of the first parameter; a rest element is tainted too; a plain `props` identifier
  // is tainted whole (so `props.items` reads as data).
  // A good-state CLASS handed to a same-file child through a prop (`<Pill tone="…emerald" n={…}/>`
  // with `className={tone}` in the child): the child binding is recorded with the class strings
  // the call site passes, and resolved where the child uses it as a class.
  var goodParams = new Map(); // binding element | parameter -> [{ node }]
  const goodPropParams = new Map(); // identifier parameter -> Map(prop name -> [{ node }])
  // The props a same-file child READS (null = it reads them all: a rest element, a spread, or a bare `props`).
  const childReadProps = (comp) => {
    const p0 = comp.params[0];
    if (!p0) return new Set();
    if (ts.isObjectBindingPattern(p0.name)) return p0.name.elements.some((e) => e.dotDotDotToken) ? null : new Set(p0.name.elements.map(propOf));
    if (!ts.isIdentifier(p0.name)) return null;
    const names = new Set();
    let whole = false;
    const w = (n) => {
      if (whole) return;
      if (ts.isIdentifier(n) && n.text === p0.name.text && n !== p0.name) {
        const par = n.parent;
        if (ts.isPropertyAccessExpression(par) && par.expression === n) names.add(par.name.text);
        else if (ts.isElementAccessExpression(par) && par.expression === n && par.argumentExpression && ts.isStringLiteralLike(par.argumentExpression)) names.add(par.argumentExpression.text);
        else if (!(ts.isPropertyAccessExpression(par) && par.name === n)) whole = true;
      }
      ts.forEachChild(n, w);
    };
    if (comp.fn.body) w(comp.fn.body);
    return whole ? null : names;
  };
  const childOwnsQuery = (comp) => [...hookDecls].some((h) => h.pos >= comp.fn.pos && h.end <= comp.fn.end); // a query declared inside the child
  // Does THIS call site pass unguarded query data through a prop the child actually reads? (prop-level pairing)
  const siteRendersData = (comp, open) => {
    const reads = childReadProps(comp);
    const opening = ts.isJsxOpeningElement(open) ? open : open;
    for (const a of opening.attributes.properties) {
      if (ts.isJsxSpreadAttribute(a)) { if (elementHasUnguardedDataRender(a.expression)) return true; continue; }
      if (!ts.isJsxAttribute(a) || !ts.isIdentifier(a.name) || !a.initializer) continue;
      if (reads !== null && !reads.has(a.name.text)) continue;
      if (elementHasUnguardedDataRender(a.initializer)) return true;
    }
    if (ts.isJsxOpeningElement(open) && (reads === null || reads.has("children"))) {
      for (const ch of open.parent.children) if (!ts.isJsxText(ch) && elementHasUnguardedDataRender(ch)) return true;
    }
    return false;
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
    if (ts.isIdentifier(param.name) && propName !== null) { // `query={q}` on `function Row(props)`: `props.query` is the query result
      const byProp = propQueryObjs.get(param) ?? new Map();
      if (addOrigins(byProp, propName, origins)) changed = true;
      propQueryObjs.set(param, byProp);
      if (!taintedParams.has(param)) { taintedParams.add(param); changed = true; }
    } else if (ts.isIdentifier(param.name)) mark(param, param.name.text, null);
    else if (ts.isObjectBindingPattern(param.name)) {
      for (const el of param.name.elements) {
        if (!ts.isIdentifier(el.name)) {
          // `{ query: { data } }`: the nested pattern destructures the query result itself
          if (propName !== null && propOf(el) === propName && ts.isObjectBindingPattern(el.name)) {
            for (const inner of el.name.elements) {
              if (!ts.isIdentifier(inner.name)) continue;
              const ip = propOf(inner);
              if (ip === "data" || QUERY_DESTRUCTURE.has(ip)) mark(inner, inner.name.text, ip);
            }
          }
          continue;
        }
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
    const markAll = (b) => { // every binding inside a nested pattern receives the prop (`{ items: { length } }`)
      for (const e of b.elements) {
        if (ts.isOmittedExpression(e)) continue;
        if (ts.isIdentifier(e.name)) mark(e, e.name.text); else markAll(e.name);
      }
    };
    if (ts.isIdentifier(param.name)) mark(param, param.name.text);
    else if (ts.isObjectBindingPattern(param.name)) {
      for (const el of param.name.elements) {
        if (ts.isIdentifier(el.name)) { if (propName === null || (el.dotDotDotToken && !param.name.elements.some((sib) => sib !== el && !sib.dotDotDotToken && knownKeyOf(sib) === propName)) || (!el.dotDotDotToken && propOf(el) === propName)) mark(el, el.name.text); }
        else if (propName === null || propOf(el) === propName) markAll(el.name);
      }
    }
    return changed;
  };
  const cbBinding = new Map(); // binding element -> [callback functions handed to that prop]
  const cbParamProp = new Map(); // identifier parameter -> Map(prop name -> [callback functions])
  const propagateProps = () => {
    let changed = false;
    const pass = (tag, propName, expr) => {
      for (const comp of findComponents(tag)) {
        // A prop expression that gates its own data (`s ? String(s.n) : "-"`) passes no unguarded data.
        if (comp.params[0] && expr && elementHasUnguardedDataRender(expr) && taintParam(comp.params[0], propName, originsIn(expr))) changed = true;
      }
    };
    const passQuery = (tag, propName, expr) => {
      for (const comp of findComponents(tag)) {
        const e = expr && unwrapExpr(expr);
        if (comp.params[0] && e && ts.isIdentifier(e) && queryObjVars.has(e.text) && !isHandled(e, originsIn(e)) &&
            passQueryObject(comp.params[0], propName, originsIn(e))) changed = true;
      }
    };
    const passClass = (tag, propName, attr, openEl = attr.parent.parent) => {
      for (const comp of findComponents(tag)) passClassTo(comp, propName, attr, openEl);
    };
    const passClassTo = (comp, propName, attr, openEl) => {
      const param = comp && comp.params[0];
      if (!param) return;
      const found = goodClassStringNodes(attr);
      if (found.length === 0) return;
      // Paired by call site: a good class only paints data green at a site that ALSO passes unguarded data,
      // so `<Pill tone="…emerald" n="static" />` next to `<Pill tone="…red" n={q.data?.n} />` flags neither.
      const open = openEl;
      if (!siteRendersData(comp, open) && !childOwnsQuery(comp)) return; // the child's data may be its own query, not a prop
      if (ts.isIdentifier(param.name)) { // `function Pill(props) { … props.tone … }`
        const byProp = goodPropParams.get(param) ?? new Map();
        const have = byProp.get(propName) ?? [];
        for (const f of found) if (!have.some((h) => h.node === f.node)) { have.push({ node: f.node }); changed = true; }
        byProp.set(propName, have);
        goodPropParams.set(param, byProp);
        return;
      }
      if (!ts.isObjectBindingPattern(param.name)) return;
      const nestedBindings = (b, out = []) => { for (const e of b.elements) { if (ts.isOmittedExpression(e)) continue; if (ts.isIdentifier(e.name)) out.push(e); else nestedBindings(e.name, out); } return out; };
      for (const el0 of param.name.elements) {
        if (el0.dotDotDotToken ? param.name.elements.some((sib) => sib !== el0 && !sib.dotDotDotToken && knownKeyOf(sib) === propName) : propOf(el0) !== propName) continue; // a rest binding gets only the props the pattern did not destructure
        // `{ style: { tone } }` receiving `style={{ tone: "…emerald" }}`: every binding inside the pattern may hold the class
        const litAttr = ts.isJsxAttribute(attr) && attr.initializer && ts.isJsxExpression(attr.initializer) && attr.initializer.expression ? unwrapExpr(attr.initializer.expression) : null;
        for (const el of ts.isIdentifier(el0.name) ? [el0] : nestedBindings(el0.name)) {
        let mine = found; // `style={{ tone: red, success: emerald }}` into `{ style: { tone } }`: only the matching property's classes
        if (!ts.isIdentifier(el0.name) && el.parent === el0.name && litAttr && ts.isObjectLiteralExpression(litAttr) && !litAttr.properties.some((pp) => ts.isSpreadAssignment(pp))) {
          const pr = litAttr.properties.find((pp) => (ts.isPropertyAssignment(pp) || ts.isShorthandPropertyAssignment(pp)) && pp.name && memberKey(pp.name) === propOf(el));
          const opaque = litAttr.properties.some((pp) => !(ts.isPropertyAssignment(pp) || ts.isShorthandPropertyAssignment(pp))); // a getter / method member can supply any key
          mine = pr ? goodClassStringNodes(ts.isPropertyAssignment(pr) ? pr.initializer : pr.name) : opaque ? found : [];
        }
        const have = goodParams.get(el) ?? [];
        for (const f of mine) if (!have.some((h) => h.node === f.node)) { have.push({ node: f.node }); changed = true; }
        goodParams.set(el, have);
        }
      }
    };
    // RENDER-PROP CALLBACKS: `<Panel render={(n) => …} />` where Panel calls `render(value)` (or `props.render(value)`, `children(value)`).
    // The callback is recorded against the receiving binding; a call with an argument that carries unguarded query data taints the
    // callback's parameter at that position.
    const callbackFn = (expr) => {
      const u = expr && unwrapExpr(expr);
      if (!u) return null;
      if (ts.isArrowFunction(u) || ts.isFunctionExpression(u)) return u;
      if (ts.isIdentifier(u)) { const f = findHelper(u); return f && (ts.isArrowFunction(f) || ts.isFunctionExpression(f) || ts.isFunctionDeclaration(f)) ? f : null; }
      return null;
    };
    const regCallback = (tag, propName, expr) => {
      const f = callbackFn(expr);
      if (!f) return;
      for (const comp of findComponents(tag)) {
        const p0 = comp.params[0];
        if (!p0) continue;
        if (ts.isObjectBindingPattern(p0.name)) {
          for (const el of p0.name.elements) if (!el.dotDotDotToken && propOf(el) === propName) { const l = cbBinding.get(el) ?? []; if (!l.includes(f)) l.push(f); cbBinding.set(el, l); }
        } else if (ts.isIdentifier(p0.name)) {
          const m = cbParamProp.get(p0) ?? new Map();
          const l = m.get(propName) ?? [];
          if (!l.includes(f)) l.push(f);
          m.set(propName, l);
          cbParamProp.set(p0, m);
        }
      }
    };
    const callCallbacks = (call) => {
      const callee = unwrapExpr(call.expression);
      let fns = null;
      if (ts.isIdentifier(callee)) { const b = bindingOfParam(callee); fns = b && paramIsNearest(callee, b) ? cbBinding.get(b) : null; }
      else if (memberName(callee) !== null && ts.isIdentifier(callee.expression)) { const prm = paramThroughAliases(callee.expression); fns = prm ? cbParamProp.get(prm)?.get(memberName(callee)) : null; }
      if (!fns) return;
      call.arguments.forEach((arg, i) => {
        if (!elementHasUnguardedDataRender(arg)) return;
        for (const f of fns) if (f.parameters[i] && taintParam(f.parameters[i], null, originsIn(arg))) changed = true;
      });
    };
    const visit = (n) => {
      if (ts.isJsxAttribute(n) && ts.isIdentifier(n.name) && n.initializer && ts.isJsxExpression(n.initializer)) regCallback(n.parent.parent.tagName, n.name.text, n.initializer.expression);
      if (ts.isJsxElement(n)) for (const ch of n.children) if (ts.isJsxExpression(ch) && ch.expression) regCallback(n.openingElement.tagName, "children", ch.expression);
      if (ts.isCallExpression(n)) callCallbacks(n);
      if (ts.isJsxAttribute(n) && ts.isIdentifier(n.name) && n.initializer) passClass(n.parent.parent.tagName, n.name.text, n);
      if (ts.isJsxAttribute(n) && ts.isIdentifier(n.name) && n.initializer && ts.isJsxExpression(n.initializer)) passQuery(n.parent.parent.tagName, n.name.text, n.initializer.expression);
      if (ts.isJsxSpreadAttribute(n)) passQuery(n.parent.parent.tagName, null, n.expression);
      if (ts.isJsxAttribute(n) && ts.isIdentifier(n.name) && n.initializer && ts.isJsxExpression(n.initializer)) pass(n.parent.parent.tagName, n.name.text, n.initializer.expression);
      if (ts.isJsxSpreadAttribute(n)) pass(n.parent.parent.tagName, null, n.expression);
      if (ts.isJsxSpreadAttribute(n)) { // `{...{ tone: "…emerald" }}` / `{...base}`: each literal property is a prop
        const sp = unwrapExpr(n.expression);
        const lit = ts.isObjectLiteralExpression(sp) ? sp : ts.isIdentifier(sp) ? mapObject(sp) : null;
        const attrs = n.parent.properties;
        const later = attrs.slice(attrs.indexOf(n) + 1);
        if (lit) for (const pp of lit.properties) if (ts.isPropertyAssignment(pp)) {
          const k = memberKey(pp.name);
          if (k === null || later.some((a) => ts.isJsxAttribute(a) && ts.isIdentifier(a.name) && a.name.text === k)) continue; // a later explicit attribute wins
          passClass(n.parent.parent.tagName, k, pp, n.parent.parent);
        }
      }
      if (ts.isJsxElement(n)) for (const ch of n.children) {
        if (ts.isJsxExpression(ch) && ch.expression) pass(n.openingElement.tagName, "children", ch.expression);
        else if (ts.isJsxElement(ch) || ts.isJsxSelfClosingElement(ch) || ts.isJsxFragment(ch)) pass(n.openingElement.tagName, "children", ch); // `<Panel><>{data}</></Panel>`
      }
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
  const resolveConstInit = (id, accept = RESOLVABLE_INIT) => {
    for (let cur = id.parent; cur; cur = cur.parent) {
      if (bindsNameOpaquely(cur, id.text)) return null;
      // a `var X` anywhere in this function / module scope (hoisted, even inside an `if`) rebinds the name
      if (isVarScope(cur) && declaresVar(cur, id.text)) return null;
      const stmts = ts.isBlock(cur) || ts.isSourceFile(cur) || ts.isModuleBlock(cur) ? cur.statements
        : ts.isCaseBlock(cur) ? cur.clauses.flatMap((cl) => [...cl.statements]) : null; // a `switch` case clause scopes its declarations
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
  const escapedMapRefs = new Set(); // a reference that may write the map, or a spread it cannot resolve: stands for an unreadable, possibly good-state entry
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
  // A value this can judge: a literal, a const it resolves, or a non-class constant. Anything else (a call, a parameter, a member read) may be a good class.
  const undefinedShadowed = (() => { // a parameter / variable / binding NAMED `undefined` makes the identifier unreadable
    let hit = false;
    const v = (n) => {
      if (hit) return;
      if ((ts.isParameter(n) || ts.isVariableDeclaration(n) || ts.isBindingElement(n) || ts.isImportSpecifier(n) || ts.isImportClause(n) ||
           ts.isNamespaceImport(n) || ts.isImportEqualsDeclaration(n)) && n.name && ts.isIdentifier(n.name) && n.name.text === "undefined") { hit = true; return; }
      ts.forEachChild(n, v);
    };
    v(sf);
    return hit;
  })();
  const readableValue = (e, seen = new Set()) => {
    const rv = unwrapExpr(e);
    if (ts.isIdentifier(rv) && rv.text !== "undefined") { // a const is judged by what it is bound to, not by being a const
      const ci = resolveConstInit(rv, () => true);
      if (!ci || seen.has(ci)) return false;
      seen.add(ci);
      return readableValue(ci, seen);
    }
    return ts.isStringLiteralLike(rv) || ts.isTemplateExpression(rv) || ts.isNumericLiteral(rv) || rv.kind === K.NullKeyword || rv.kind === K.TrueKeyword ||
      rv.kind === K.FalseKeyword || ts.isVoidExpression(rv) || (ts.isIdentifier(rv) && rv.text === "undefined" && !undefinedShadowed);
  };
  const ABSENT_ENTRY_KEYS = new Set(["undefined", "null", "", "[object object]", "__proto__"]);
  // Entries of a map: all of them (`lit === null`, a dynamic key) or the one literal key. A shorthand
  // entry reads its const; a method / getter contributes its body; a computed key this cannot read
  // MAY match any key, so it is included; a `...BASE` spread of another same-file map contributes its entries.
  const mapEntries = (obj, lit, depth = 0) => {
    const out = [];
    for (const p of obj.properties) {
      if (ts.isSpreadAssignment(p)) {
        const o = depth < 6 ? mapObjectOf(p.expression, depth + 1) : null;
        if (o) out.push(...mapEntries(o, lit, depth + 1));
        else { escapedMapRefs.add(p.expression); out.push(p.expression); } // a spread this cannot resolve (`...(c ? BASE : {})`, `...getBase()`) may carry any entry
        continue;
      }
      if (!p.name && !ts.isShorthandPropertyAssignment(p)) continue;
      const key = ts.isShorthandPropertyAssignment(p) ? p.name.text : memberKey(p.name);
      if (!(lit === null || key === null || key === lit)) continue;
      // an absent-key (`undefined`, `null`, `""`, `__proto__`) or unreadable-key entry whose VALUE this cannot read may be a good class
      if (ts.isPropertyAssignment(p) && (key === null || ABSENT_ENTRY_KEYS.has(key.toLowerCase())) && !readableValue(p.initializer)) escapedMapRefs.add(p.initializer);
      if (ts.isShorthandPropertyAssignment(p) && (key === null || ABSENT_ENTRY_KEYS.has(key.toLowerCase())) && !readableValue(p.name)) escapedMapRefs.add(p.name); // `{ __proto__ }` over a const this cannot read
      if (ts.isGetAccessor(p) && p.body && (key === null || ABSENT_ENTRY_KEYS.has(key.toLowerCase()))) { // a getter on an absent key: what it returns must be readable
        const rets = [];
        const rv = (n) => { if (ts.isReturnStatement(n)) { if (n.expression) rets.push(n.expression); return; } if (ts.isFunctionLike(n)) return; ts.forEachChild(n, rv); };
        rv(p.body);
        for (const r of rets) if (!readableValue(r)) escapedMapRefs.add(r);
      }
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
  const mapMutations = (names) => {
    const key = [...names].sort().join("|");
    if (mutationCache.has(key)) return mutationCache.get(key);
    const out = []; // { node, key } — key null = unreadable
    const handled = new Set(); // roots of the writes read precisely above
    const rootIs = (e) => { const r = rootIdent(e); return Boolean(r) && names.has(r.text); };
    const keyOf0 = (left) => (ts.isPropertyAccessExpression(left) ? left.name.text
      : ts.isElementAccessExpression(left) && ts.isStringLiteralLike(left.argumentExpression) ? left.argumentExpression.text : null);
    const keyOf = (left) => { const k = keyOf0(left); return k === "__proto__" ? null : k; }; // `__proto__` swaps the whole entry set
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
    // A target inside a pattern, even a defaulted one (`{ a: T.x = 1 } = v`), writes the pattern's value, not its default: it is not a precise write.
    const w = (n) => {
      if (ts.isBinaryExpression(n) && n.operatorToken.kind >= K.FirstAssignment && n.operatorToken.kind <= K.LastAssignment &&
          (ts.isPropertyAccessExpression(n.left) || ts.isElementAccessExpression(n.left)) && rootIs(n.left) && !isAssignTarget(n)) { handled.add(rootIdent(n.left));
        if (!readableValue(n.right)) escapedMapRefs.add(n.right); // a value this cannot read (a parameter, an import, a call) may be a good class
         out.push({ node: n.right, key: keyOf(n.left) }); }
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
        const obj = n.expression.expression, m = n.expression.name.text;
        if (ts.isIdentifier(obj) && obj.text === "Object" && (m === "assign" || m === "defineProperty") && n.arguments[0] && rootIs(n.arguments[0])) {
          handled.add(rootIdent(n.arguments[0]));
          for (const a of n.arguments.slice(1)) {
            out.push({ node: a, key: null });
            const u = unwrapExpr(a); // a source that is not a plain literal (an identifier, a spread) carries entries this cannot read
            if (!(ts.isObjectLiteralExpression(u) && !u.properties.some((pp) => ts.isSpreadAssignment(pp)))) escapedMapRefs.add(a);
            else for (const pp of u.properties) { // a literal source whose VALUE this cannot read (`{ undefined: pick() }`) may be a good class
              const val = ts.isPropertyAssignment(pp) ? pp.initializer : pp;
              if (!readableValue(val)) escapedMapRefs.add(val);
            }
          }
        }
        if (ts.isIdentifier(obj) && obj.text === "Reflect" && m === "set" && n.arguments[0] && rootIs(n.arguments[0])) {
          handled.add(rootIdent(n.arguments[0]));
          if (n.arguments[2] && !ts.isStringLiteralLike(unwrapExpr(n.arguments[2]))) escapedMapRefs.add(n.arguments[2]);
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
    // Objects an access chain from the map root denotes: `T` -> [T's literal]; `T.a.b` -> the literals of those entries.
    const objectish = (v) => { const u = unwrapExpr(v); return ts.isObjectLiteralExpression(u) ? u : ts.isIdentifier(u) ? mapObject(u) : null; };
    const chainObjects = (id, end) => {
      const chain = [];
      for (let c = id.parent; c; c = c.parent) {
        if (ts.isPropertyAccessExpression(c) || ts.isElementAccessExpression(c)) chain.push(c);
        if (c === end) break;
      }
      let cur = [mapObject(id)].filter(Boolean);
      for (const a of chain) {
        const lit = ts.isPropertyAccessExpression(a) ? a.name.text : a.argumentExpression && ts.isStringLiteralLike(a.argumentExpression) ? a.argumentExpression.text : null;
        cur = cur.flatMap((o) => mapEntries(o, lit)).map(objectish).filter(Boolean);
      }
      return cur;
    };
    // A map whose entries include an object (a nested sub-map): taking its entries wholesale hands out a sub-map.
    const hasNestedMap = (id) => { const o = mapObject(id); return Boolean(o) && mapEntries(o, null).some((v) => Boolean(objectish(v))); };
    const isRead = (id) => {
      let c = id, par = c.parent;
      while (par && (ts.isParenthesizedExpression(par) && par.expression === c ? false : (ts.isNonNullExpression(par) || ts.isAsExpression(par) || ts.isSatisfiesExpression(par)) && par.expression === c)) { c = par; par = c.parent; }
      if (!par) return false;
      if (ts.isSpreadAssignment(par) && par.expression === c) return !hasNestedMap(id);
      if (ts.isBinaryExpression(par) && par.operatorToken.kind === K.InKeyword && par.right === c) return true;
      if (ts.isVariableDeclaration(par) && par.initializer === c) return ts.isObjectBindingPattern(par.name) && !hasNestedMap(id);
      if (ts.isCallExpression(par) && par.arguments[0] === c && ts.isPropertyAccessExpression(par.expression) &&
          ts.isIdentifier(par.expression.expression) && par.expression.expression.text === "Object" &&
          ["keys", "values", "entries"].includes(par.expression.name.text)) return par.expression.name.text === "keys" || !hasNestedMap(id);
      if ((ts.isPropertyAccessExpression(par) || ts.isElementAccessExpression(par)) && par.expression === c) {
        if (ts.isPropertyAccessExpression(par) && par.name.text === "__proto__") return false;
        let t = par;
        for (;;) {
          const q = t.parent;
          if (!q) return chainObjects(id, t).length === 0; // the value of the whole chain is a sub-map: it escapes
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
          return chainObjects(id, t).length === 0; // used as a value: a sub-map may only be indexed further
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
    const addDecl = (o) => { for (let c = o && o.parent; c; c = c.parent) { if (ts.isVariableDeclaration(c) && ts.isIdentifier(c.name)) { names.add(c.name.text); break; } if (ts.isBlock(c) || ts.isSourceFile(c)) break; } };
    const seen = new Set();
    const addMap = (o, depth) => { // the map's declaration, and the maps it spreads (`{ ...BASE }`): a write to BASE changes this map
      if (!o || seen.has(o) || depth > 6) return;
      seen.add(o); addDecl(o);
      for (const p of o.properties) if (ts.isSpreadAssignment(p)) {
        addMap(mapObjectOf(p.expression), depth + 1);
      }
    };
    addMap(mapObjectOf(x.expression), 0);
    // downstream aliases (`const T1 = T0`) are the same map: writes through them count, and the alias initializer is not an escape
    for (let grew = true; grew;) {
      grew = false;
      const scan = (n) => {
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && (n.parent.flags & ts.NodeFlags.Const)) {
          const u = unwrapExpr(n.initializer);
          if (ts.isIdentifier(u) && names.has(u.text) && !names.has(n.name.text)) { names.add(n.name.text); grew = true; }
        }
        ts.forEachChild(n, scan);
      };
      scan(sf);
    }
    return names;
  };
  const lookupEntries = (x) => { // x: ElementAccess | PropertyAccess over a resolvable map, else null
    const obj = mapObjectOf(x.expression);
    if (!obj) return null;
    const ka = !ts.isPropertyAccessExpression(x) && x.argumentExpression ? unwrapExpr(x.argumentExpression) : null; // `T["ok"]`, `T[1]`, T[`ok`]
    const lit = ts.isPropertyAccessExpression(x) ? x.name.text
      : ka && (ts.isStringLiteralLike(ka) || ts.isNumericLiteral(ka)) ? ka.text : null; // StringLiteralLike covers T[`ok`] too
    const extra = mapMutations(mapNamesOf(x)).filter((m) => lit === null || m.key === null || m.key === lit).map((m) => m.node);
    return [...mapEntries(obj, lit), ...extra];
  };
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
  const importedNames = new Set(); // an import named `String` / `Array` is NOT the global
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && st.importClause) {
      const ic = st.importClause;
      if (ic.name) importedNames.add(ic.name.text);
      if (ic.namedBindings) { if (ts.isNamespaceImport(ic.namedBindings)) importedNames.add(ic.namedBindings.name.text); else for (const e of ic.namedBindings.elements) importedNames.add(e.name.text); }
    } else if (ts.isImportEqualsDeclaration(st)) importedNames.add(st.name.text);
  }
  const findBinding = (id) => {
    if (importedNames.has(id.text)) return { kind: "opaque" };
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
    if (cloneSeen === undefined) { cloneSeen = false; const w = (n) => { if (cloneSeen) return; if ((ts.isIdentifier(n) || ts.isStringLiteralLike(n)) && n.text === "cloneElement") cloneSeen = true; else ts.forEachChild(n, w); }; w(sf); }
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
  // The query RESULT object itself (`q`, `useQuery(...)`): only its `.data` is data; `isError` / `isLoading` / `status`
  // are present while the data is absent, so a key read from them is never a plain read of query data.
  const isQueryResultExpr = (x, depth = 0) => {
    const e = unwrapExpr(x);
    if (depth > 6 || !e) return false;
    if (ts.isCallExpression(e)) return hookDecls.has(e);
    if (!ts.isIdentifier(e)) return false;
    const b = findBinding(e);
    return Boolean(b) && b.kind === "var" && Boolean(b.decl.initializer) && isQueryResultExpr(b.decl.initializer, depth + 1);
  };
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
        if (b.decl.initializer && b.node.parent.parent === b.decl && isQueryResultExpr(b.decl.initializer) && propOf(b.node) !== "data") return false; // \`const { isError } = q\``

        return Boolean(b.decl.initializer) && recur(b.decl.initializer);
      }
      return refsReadOnly(e.text, b.scope, b.decl) && Boolean(b.decl.initializer) && recur(b.decl.initializer);
    }
    if (ts.isPropertyAccessExpression(e)) return !FIXED_VALUE_PROPS.has(e.name.text) && !(isQueryResultExpr(e.expression) && e.name.text !== "data") && recur(e.expression);
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
  const ABSENT_KEYS = new Set(["undefined", "null", "", "[object object]", "__proto__"]); // `__proto__` sets the prototype: a missing key falls through to it
  const mapKeyNames = (obj, depth = 0) => obj.properties.flatMap((p) => {
    if (ts.isSpreadAssignment(p)) { const o = depth < 6 ? mapObjectOf(p.expression, depth + 1) : null; return o ? mapKeyNames(o, depth + 1) : [null]; }
    return [ts.isShorthandPropertyAssignment(p) ? p.name.text : p.name ? memberKey(p.name) : null];
  });
  // `String(undefined)` is "undefined"; `.toUpperCase()` / `.toLowerCase()` of it, `String([])` ("") and `String({})`
  // ("[object Object]") are keys an ABSENT read can produce: a map with such an entry is hit, so no fallback runs.
  const hasAbsentKeyEntry = (obj, x) => Boolean(obj) &&
    (mapKeyNames(obj).some((k) => k === null || ABSENT_KEYS.has(k.toLowerCase())) ||
     (x ? mapMutations(mapNamesOf(x)).some((m) => m.key === null || ABSENT_KEYS.has(m.key.toLowerCase())) : false));
  let helperBind = null; // Map(parameter name -> call argument) while a same-file helper's returns are walked
  const lookupHasSafeFallback = (lookup) => {
    let key = lookup.argumentExpression; // inside a same-file helper, a parameter key is judged by the call's argument
    if (helperBind && key && ts.isIdentifier(key) && helperBind.get(key.text)) key = helperBind.get(key.text);
    let c = lookup, p = c.parent; // `(TONE[s]) ?? …`, `(TONE[s] as string) ?? …`, `TONE[s]! ?? …` are the same lookup
    while (p && (ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isSatisfiesExpression(p) || ts.isNonNullExpression(p) || ts.isTypeAssertionExpression(p))) { c = p; p = c.parent; }
    return p && ts.isBinaryExpression(p) && p.left === c &&
      (p.operatorToken.kind === K.QuestionQuestionToken || p.operatorToken.kind === K.BarBarToken) &&
      keyIsPlainData(key, 0, true);
  };
  const paramThroughAliases = (id) => { // `const p = props` -> the parameter `props` (a short alias chain)
    let cur = id;
    for (let d = 0; d < 6; d++) {
      const prm = bindingOfParam(cur);
      if (prm) return paramIsNearest(cur, prm) ? prm : null;
      const init = resolveConstInit(cur, (n) => n && ts.isIdentifier(unwrapExpr(n)));
      if (!init) return null;
      cur = unwrapExpr(init);
    }
    return null;
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
        const gprm = !init && goodParams ? bindingOfParam(x) : null;
        const gpNear = gprm && paramIsNearest(x, gprm);
        const gp = gpNear && goodParams.get(gprm);
        if (gp) for (const g of gp) found.push({ node: g.node, use: use ?? x });
        if (gpNear) for (const vi of paramVarInits(gprm, x.text)) { if (resolving.has(vi)) continue; resolving.add(vi); walk(vi, use ?? x); resolving.delete(vi); } // `var tone = …` redeclaring the parameter: one more value (a self-reference `var tone = tone || …` is cut by `resolving`)
      }
      if ((ts.isPropertyAccessExpression(x) || (ts.isElementAccessExpression(x) && x.argumentExpression && ts.isStringLiteralLike(x.argumentExpression))) && ts.isIdentifier(x.expression)) {
        const prm = paramThroughAliases(x.expression);
        const gpp = prm && goodPropParams.get(prm)?.get(ts.isPropertyAccessExpression(x) ? x.name.text : x.argumentExpression.text);
        if (gpp) for (const g of gpp) found.push({ node: g.node, use: use ?? x });
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
      const calleeId = (() => { // `tone()`, `(tone)()`, `tone!()`, `tone.call(null)`, `tone.apply(null, [])`
        if (!ts.isCallExpression(x)) return null;
        let e = unwrapExpr(x.expression);
        if (ts.isPropertyAccessExpression(e) && (e.name.text === "call" || e.name.text === "apply")) e = unwrapExpr(e.expression);
        return ts.isIdentifier(e) ? e : null;
      })();
      const hv = calleeId ? helperValues(calleeId) : null;
      if (hv) {
        for (const fn of hv.fns) {
          if (resolving.has(fn)) continue;
          resolving.add(fn);
          const saved = helperBind;
          helperBind = new Map();
          // the ACTUAL arguments: `.call(this, a, b)` drops the first, `.apply(this, [a, b])` is its array literal; null = unknown
          const callee0 = unwrapExpr(x.expression);
          let argList = [...x.arguments];
          if (ts.isPropertyAccessExpression(callee0) && callee0.name.text === "call") argList = x.arguments.slice(1);
          else if (ts.isPropertyAccessExpression(callee0) && callee0.name.text === "apply") {
            const a1 = x.arguments[1] && unwrapExpr(x.arguments[1]);
            argList = a1 && ts.isArrayLiteralExpression(a1) && !a1.elements.some((e) => ts.isSpreadElement(e)) ? [...a1.elements] : null;
          }
          (fn.parameters ?? []).forEach((prm, i) => { // an omitted argument takes the parameter's DEFAULT: walk it as a value (an unknown argument list walks it, fail-closed)
            const a = argList ? argList[i] : undefined;
            if (prm.initializer && (!a || (ts.isIdentifier(unwrapExpr(a)) && unwrapExpr(a).text === "undefined"))) walk(prm.initializer, use ?? x);
          });
          (fn.parameters ?? []).forEach((prm, i) => { if (argList && argList[i] && ts.isIdentifier(prm.name) && !prm.initializer && refsReadOnly(prm.name.text, fn, prm)) helperBind.set(prm.name.text, argList[i]); });
          for (const r of returnExprs(fn)) walk(r, use ?? x);
          helperBind = saved;
          resolving.delete(fn);
        }
        if (hv.unknown) found.push({ node: x, use: use ?? x }); // a write this analysis cannot collect: possibly good
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
    // UNRESOLVED WRAPPER (fail-closed): `const Pill = memo(Red)` where `memo` is not React's cannot be followed, so a component bound
    // to it that receives unguarded query data is rejected rather than credited with its argument's provenance.
    if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && (ts.isIdentifier(n.tagName) || ts.isPropertyAccessExpression(n.tagName))) {
      let init = null; // follow `const Pill = P;` (an alias chain) to the call that binds the component
      let unresolved = false;
      if (ts.isPropertyAccessExpression(n.tagName)) { // `<Components.Pill />` backed by a same-file const object: its value is judged like a binding
        const v = memberTagValue(n.tagName);
        init = v ? unwrapExpr(v) : null;
        if (memberTagObject(n.tagName) && !v) unresolved = true; // a member of a same-file object that is absent, computed or hidden behind a spread: rejected
        if (v && componentLeaves(v).unresolved) unresolved = true; // a member this analysis cannot resolve (a call, an imported component) is rejected
        if (v && ts.isIdentifier(init)) init = null; // a plain same-file component name: followed, not rejected
      } else for (let cur = n.tagName, hops = 0; hops < 6; hops++) {
        const d = lookupDecl(cur);
        const u = d && d.init ? unwrapExpr(d.init) : null;
        if (u && ts.isIdentifier(u)) { cur = u; continue; }
        init = u;
        break;
      }
      while (init && wrapperLike(init)) { if (!reactWrapperName(init)) { unresolved = true; break; } init = init.arguments[0] ? unwrapExpr(init.arguments[0]) : null; }
      // a conditional / logical selection (`enabled ? Good : Bad`): a branch this analysis cannot resolve rejects the element
      if (!unresolved && init && (ts.isConditionalExpression(init) || (ts.isBinaryExpression(init) && (init.operatorToken.kind === K.AmpersandAmpersandToken || init.operatorToken.kind === K.BarBarToken || init.operatorToken.kind === K.QuestionQuestionToken))) && componentLeaves(init).unresolved) unresolved = true;
      if (unresolved) {
        // data carried: unguarded query data, OR a whole query object (`query={q}` / `{...q}`, the references `passQuery` follows)
        const carriesData = (x) => elementHasUnguardedDataRender(x) || (() => { const e = unwrapExpr(ts.isJsxExpression(x) && x.expression ? x.expression : x); return ts.isIdentifier(e) && queryObjVars.has(e.text) && !isHandled(e, originsIn(e)); })();
        const carries = n.attributes.properties.some((a) => ts.isJsxSpreadAttribute(a) ? carriesData(a.expression) : ts.isJsxAttribute(a) && a.initializer && carriesData(a.initializer)) ||
          (ts.isJsxOpeningElement(n) && n.parent.children.some((ch) => !ts.isJsxText(ch) && elementHasUnguardedDataRender(ch)));
        if (carries) report(n, "unresolved-wrapper-on-unguarded-data", n.tagName.getText(sf));
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
const BUG_PROPS_MEMO = propsFixture(`const Panel = React.memo(function Panel({ items }) { return ${EMERALD_ITEMS}; });`, "<Panel items={items} />", `import React, { memo, forwardRef } from "react";`);
const BUG_PROPS_FWDREF = propsFixture(`const Panel = forwardRef(({ items }, ref) => ${EMERALD_ITEMS});`, "<Panel items={items} />", `import React, { memo, forwardRef } from "react";`);
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
  ["cloneElement overrides a plain site", keyFx("", "", "", CHILD_N, `<div>{React.cloneElement(<C s={q.data?.s} ${N} />, { s: "ok" })}</div>`)],
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
  ["map write: defaulted pattern target ({ a: T.undefined = 1 } = \u2026)", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; ({ a: T.undefined = 1 } = { a: "${EMER}" });`, "T[q.data?.s] ?? T.default")],
  ["map write: defaulted array-pattern target [T.undefined = 1] = [\u2026]", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; [T.undefined = 1] = ["${EMER}"];`, "T[q.data?.s] ?? T.default")],
  ["map write: defaulted target in for-of", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; for ({ a: T.undefined = 1 } of [{ a: "${EMER}" }]) {}`, "T[q.data?.s] ?? T.default")],
  ["map write: defaulted nested pattern target", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; ({ a: { b: T.undefined = 1 } } = { a: { b: "${EMER}" } });`, "T[q.data?.s] ?? T.default")],
  ["map write: defaulted element-key pattern target", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; ({ a: T["undefined"] = 1 } = { a: "${EMER}" });`, "T[q.data?.s] ?? T.default")],
  ["map write: for-of pattern target", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; for ({ a: T.undefined } of [{ a: "${EMER}" }]) {}`, "T[q.data?.s] ?? T.default")],
  ["map write: for-in target", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; for (T.undefined in { x: 1 }) {}`, "T[q.data?.s] ?? T.default")],
  ["map write: array spread target [...T.undefined] = [\u2026]", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; [...T.undefined] = ["${EMER}"];`, "T[q.data?.s] ?? T.default")],
  ["map write: Object.assign(T, extra) with a const source", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; const extra = { undefined: "${EMER}" }; Object.assign(T, extra);`, "T[q.data?.s] ?? T.default")],
  ["map write: Object.assign(T, { ...extra })", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; const extra = { undefined: "${EMER}" }; Object.assign(T, { ...extra });`, "T[q.data?.s] ?? T.default")],
  ["map write: Object.defineProperty(T, k, d) with a const descriptor", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; const d = { value: "${EMER}" }; Object.defineProperty(T, "undefined", d);`, "T[q.data?.s] ?? T.default")],
  ["map write: Reflect.set(T, k, v) with a non-literal value", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; Reflect.set(T, "undefined", pick());`, "T[q.data?.s] ?? T.default")],
  ["nested sub-map escapes through a const alias", mkMap(`const T = { a: { undefined: "${EMER}" }, default: "text-slate-400" }; const sub = T.a; sub.x = 1;`, "T.a[q.data?.s] ?? T.default")],
  ["nested sub-map escapes as a call argument", mkMap(`const T = { a: { ok: "text-red-400" }, default: "text-slate-400" }; function seed(m) { m.undefined = "${EMER}"; } seed(T.a);`, "T.a[q.data?.s] ?? T.default")],
  ["nested sub-map taken by destructure: const { a } = T; a.undefined = \u2026", mkMap(`const T = { a: { ok: "text-red-400", default: "text-slate-400" } }; const { a } = T; a.undefined = "${EMER}";`, "T.a[q.data?.s] ?? T.a.default")],
  ["nested sub-map taken by Object.values(T)[0]", mkMap(`const T = { a: { ok: "text-red-400", default: "text-slate-400" } }; Object.values(T)[0].undefined = "${EMER}";`, "T.a[q.data?.s] ?? T.a.default")],
  ["nested sub-map written in Object.values(T).forEach", mkMap(`const T = { a: { ok: "text-red-400", default: "text-slate-400" } }; Object.values(T).forEach((m) => { m.undefined = "${EMER}"; });`, "T.a[q.data?.s] ?? T.a.default")],
  ["nested sub-map written in a for\u2026of over Object.entries(T)", mkMap(`const T = { a: { ok: "text-red-400", default: "text-slate-400" } }; for (const [, m] of Object.entries(T)) m.undefined = "${EMER}";`, "T.a[q.data?.s] ?? T.a.default")],
  ["nested sub-map copied by spread: const C = { ...T }; C.a.undefined = \u2026", mkMap(`const T = { a: { ok: "text-red-400", default: "text-slate-400" } }; const C = { ...T }; C.a.undefined = "${EMER}";`, "T.a[q.data?.s] ?? T.a.default")],
  ["two-level sub-map escapes through an alias: const Bm = T.a.b", mkMap(`const T = { a: { b: { ok: "text-red-400", default: "text-slate-400" } } }; const Bm = T.a.b; Bm.undefined = "${EMER}";`, "T.a.b[q.data?.s] ?? T.a.b.default")],
  ["two-level sub-map escapes as a call argument: seed(T.a.b)", mkMap(`const T = { a: { b: { ok: "text-red-400", default: "text-slate-400" } } }; function seed(m) { m.undefined = "${EMER}"; } seed(T.a.b);`, "T.a.b[q.data?.s] ?? T.a.b.default")],
  ["two-level sub-map escapes through element access: T[\"a\"][\"b\"]", mkMap(`const T = { a: { b: { ok: "text-red-400", default: "text-slate-400" } } }; const Bm = T["a"]["b"]; Bm.undefined = "${EMER}";`, "T.a.b[q.data?.s] ?? T.a.b.default")],
  ["two-level sub-map taken by a nested destructure", mkMap(`const T = { a: { b: { ok: "text-red-400", default: "text-slate-400" } } }; const { a: { b } } = T; b.undefined = "${EMER}";`, "T.a.b[q.data?.s] ?? T.a.b.default")],
  ["write to a ...BASE spread source before the spread", mkMap(`const BASE = { ok: "text-red-400" }; BASE.undefined = "${EMER}"; const T = { ...BASE, default: "text-slate-400" };`, "T[q.data?.s] ?? T.default")],
  ["Object.assign to a ...BASE spread source", mkMap(`const BASE = { ok: "text-red-400" }; Object.assign(BASE, { undefined: "${EMER}" }); const T = { ...BASE, default: "text-slate-400" };`, "T[q.data?.s] ?? T.default")],
  ["function writes a ...BASE spread source: seed(BASE)", mkMap(`const BASE = { ok: "text-red-400" }; function seed(m) { m.undefined = "${EMER}"; } seed(BASE); const T = { ...BASE, default: "text-slate-400" };`, "T[q.data?.s] ?? T.default")],
  ["map write with an unreadable value: T.undefined = pick()", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; T.undefined = pick();`, "T[q.data?.s] ?? T.default")],
  ["map write with a parameter value: function set(v) { T.undefined = v }", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; function set(v) { T.undefined = v; } set("${EMER}");`, "T[q.data?.s] ?? T.default")],
  ["write to a spread source reached through a const alias", mkMap(`const B0 = { ok: "text-red-400" }; const BASE = B0; BASE.undefined = "${EMER}"; const T = { ...BASE, default: "text-slate-400" };`, "T[q.data?.s] ?? T.default")],
  ["write to a spread source two levels up (...BASE of ...B0)", mkMap(`const B0 = { ok: "text-red-400" }; B0.undefined = "${EMER}"; const BASE = { ...B0 }; const T = { ...BASE, default: "text-slate-400" };`, "T[q.data?.s] ?? T.default")],
  ["spread of a conditional: ...(cond ? BASE : {})", mkMap(`const BASE = { ok: "text-red-400", undefined: "${EMER}" }; const T = { ...(cond ? BASE : {}), default: "text-slate-400" };`, "T[q.data?.s] ?? T.default")],
  ["spread of an ||: ...(ext || BASE)", mkMap(`const BASE = { ok: "text-red-400", undefined: "${EMER}" }; const T = { ...(ext || BASE), default: "text-slate-400" };`, "T[q.data?.s] ?? T.default")],
  ["spread of a call: ...getBase()", mkMap(`const T = { ...getBase(), default: "text-slate-400" };`, "T[q.data?.s] ?? T.default")],
  ["spread of a member read: ...cfg.base", mkMap(`const T = { ...cfg.base, default: "text-slate-400" };`, "T[q.data?.s] ?? T.default")],
  ["spread of a parameter: ...p", mkMap(`const T = { ...p, default: "text-slate-400" };`, "T[q.data?.s] ?? T.default")],
  ["spread of a `let` source written before the spread", mkMap(`let BASE = { ok: "text-red-400" }; BASE.undefined = "${EMER}"; const T = { ...BASE, default: "text-slate-400" };`, "T[q.data?.s] ?? T.default")],
  ["Object.assign(T, { undefined: pick() })", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; Object.assign(T, { undefined: pick() });`, "T[q.data?.s] ?? T.default")],
  ["Object.assign(T, { undefined: arr[0] })", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; Object.assign(T, { undefined: arr[0] });`, "T[q.data?.s] ?? T.default")],
  ["Object.assign(T, { undefined: cfg.cls })", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; Object.assign(T, { undefined: cfg.cls });`, "T[q.data?.s] ?? T.default")],
  ["Object.assign(T, {}, { undefined: pick() })", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; Object.assign(T, {}, { undefined: pick() });`, "T[q.data?.s] ?? T.default")],
  ["Object.assign(T, { [k]: pick() })", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; Object.assign(T, { [k]: pick() });`, "T[q.data?.s] ?? T.default")],
  ["Object.assign of a parameter value inside a function", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; function s(v) { Object.assign(T, { undefined: v }); } s("${EMER}");`, "T[q.data?.s] ?? T.default")],
  ["Object.assign to a spread source with an unreadable value", mkMap(`const BASE = { ok: "text-red-400" }; Object.assign(BASE, { undefined: pick() }); const T = { ...BASE, default: "text-slate-400" };`, "T[q.data?.s] ?? T.default")],
  ["Object.values(T.a)[0] write at two levels", mkMap(`const T = { a: { b: { ok: "text-red-400", default: "text-slate-400" } } }; Object.values(T.a)[0].undefined = "${EMER}";`, "T.a.b[q.data?.s] ?? T.a.b.default")],
  ["Object(T.a) write at two levels", mkMap(`const T = { a: { b: { ok: "text-red-400", default: "text-slate-400" } } }; Object(T.a).undefined = "${EMER}";`, "T.a.b[q.data?.s] ?? T.a.b.default")],
  ["map literal: undefined: pick()", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400", undefined: pick() };`, "T[q.data?.s] ?? T.default")],
  ["map literal: undefined: cfg.cls", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400", undefined: cfg.cls };`, "T[q.data?.s] ?? T.default")],
  ["map literal: undefined: cond ? GOOD : \"x\"", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400", undefined: cond ? GOOD : "x" };`, "T[q.data?.s] ?? T.default")],
  ["map literal: null: pick()", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400", null: pick() };`, "T[q.data?.s] ?? T.default")],
  ["map literal: \"\": pick()", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400", "": pick() };`, "T[q.data?.s] ?? T.default")],
  ["map literal: \"[object Object]\": pick()", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400", "[object Object]": pick() };`, "T[q.data?.s] ?? T.default")],
  ["map literal: unreadable computed key with unreadable value", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400", [keyFn()]: pick() };`, "T[q.data?.s] ?? T.default")],
  ["map literal: __proto__: ext()", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400", __proto__: ext() };`, "T[q.data?.s] ?? T.default")],
  ["map literal: nested entry undefined: pick()", mkMap(`const T = { a: { ok: "text-red-400", default: "text-slate-400", undefined: pick() } };`, "T.a[q.data?.s] ?? T.a.default")],
  ["map literal: spread source BASE with undefined: pick()", mkMap(`const BASE = { ok: "text-red-400", undefined: pick() }; const T = { ...BASE, default: "text-slate-400" };`, "T[q.data?.s] ?? T.default")],
  ["Object.assign with a bad member after a good one: { n: 1, undefined: pick() }", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; Object.assign(T, { n: 1, undefined: pick() });`, "T[q.data?.s] ?? T.default")],
  ["Object.assign with a shorthand member", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; function s(undefined) { Object.assign(T, { undefined }); } s("${EMER}");`, "T[q.data?.s] ?? T.default")],
  ["Object.assign with a method member", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; Object.assign(T, { undefined() { return pick(); } });`, "T[q.data?.s] ?? T.default")],
  ["Object.assign with a getter member", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; Object.assign(T, { get undefined() { return pick(); } });`, "T[q.data?.s] ?? T.default")],
  ["map literal: undefined bound through a const to a call", mkMap(`const X = pick(); const T = { ok: "text-red-400", default: "text-slate-400", undefined: X };`, "T[q.data?.s] ?? T.default")],
  ["map literal: undefined bound through a const to a member read", mkMap(`const X = cfg.cls; const T = { ok: "text-red-400", default: "text-slate-400", undefined: X };`, "T[q.data?.s] ?? T.default")],
  ["map literal: undefined bound through two consts", mkMap(`const Y = pick(); const X = Y; const T = { ok: "text-red-400", default: "text-slate-400", undefined: X };`, "T[q.data?.s] ?? T.default")],
  ["map write: T.undefined = X with X bound to a call", mkMap(`const X = pick(); const T = { ok: "text-red-400", default: "text-slate-400" }; T.undefined = X;`, "T[q.data?.s] ?? T.default")],
  ["Object.assign literal value bound to a call", mkMap(`const X = pick(); const T = { ok: "text-red-400", default: "text-slate-400" }; Object.assign(T, { undefined: X });`, "T[q.data?.s] ?? T.default")],
  ["map literal: getter on undefined returning pick()", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400", get undefined() { return pick(); } };`, "T[q.data?.s] ?? T.default")],
  ["map literal: getter on null returning cfg.cls", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400", get null() { return cfg.cls; } };`, "T[q.data?.s] ?? T.default")],
  ["const alias chain of 6 hops still resolves the map", mkMap(`const A0 = { ok: "${EMER}" }; const A1 = A0; const A2 = A1; const A3 = A2; const A4 = A3; const A5 = A4; const A6 = A5;`, "A6.ok")],
  ["map write: T.undefined = A with a cyclic const chain", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; const A = B; const B = A; T.undefined = A;`, "T[q.data?.s] ?? T.default")],
  ["getter on an unreadable computed key returning pick()", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400", get [kfn()]() { return pick(); } };`, "T[q.data?.s] ?? T.default")],
  ["getter on undefined with a readable first return and an unreadable second", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400", get undefined() { if (c) { return "text-slate-500"; } return cfg.cls; } };`, "T[q.data?.s] ?? T.default")],
  ["getter on UNDEFINED hit by a toUpperCase key", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400", get UNDEFINED() { return pick(); } };`, "T[String(q.data?.s).toUpperCase()] ?? T.default")],
  ["name bound by a switch case-clause const", mkMap(`const X = "text-slate-500"; const T = { ok: "text-red-400", default: "text-slate-400" }; function f() { switch (k) { case 1: const X = pick(); T.undefined = X; } }`, "T[q.data?.s] ?? T.default")],
  ["T.undefined = undefined with a parameter named undefined", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; function s(undefined) { T.undefined = undefined; } s(pick());`, "T[q.data?.s] ?? T.default")],
  ["map literal value undefined with a binding named undefined", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400", undefined: undefined }; function Page2(undefined) { return undefined; }`, "T[q.data?.s] ?? T.default")],
  ["shorthand { __proto__ } over a const this cannot read", mkMap(`const __proto__ = pick(); const T = { ok: "text-red-400", default: "text-slate-400", __proto__ };`, "T[q.data?.s] ?? T.default")],
  ["scope: var inside a class static block does not rebind the module const (bug stays flagged)", keyFx(`const GOOD = "text-emerald-400"; class Registry { static { var GOOD = 0; } }`, "", "GOOD")],
  ["scope: var inside a namespace does not rebind the module const", keyFx(`const GOOD = "text-emerald-400"; namespace N { export var GOOD = 0; }`, "", "GOOD")],
  ["scope: var inside declare global does not rebind the module const", keyFx(`const GOOD = "text-emerald-400"; declare global { var GOOD: string; }`, "", "GOOD")],
  ["scope: var inside a nested function does not rebind the module const", keyFx(`const GOOD = "text-emerald-400"; function g() { var GOOD = 0; return GOOD; }`, "", "GOOD")],
  ["rebinding: a function-scope hoisted var inside an if", mkMap(`const X = "text-slate-500"; const T = { ok: "text-red-400", default: "text-slate-400" }; function g() { if (c) { var X = pick(); } T.undefined = X; }`, "T[q.data?.s] ?? T.default")],
  ["rebinding: a destructured var { X }", mkMap(`const X = "text-slate-500"; const T = { ok: "text-red-400", default: "text-slate-400" }; function g() { var { X } = { X: pick() }; T.undefined = X; }`, "T[q.data?.s] ?? T.default")],
  ["rebinding: an array-destructured var [X]", mkMap(`const X = "text-slate-500"; const T = { ok: "text-red-400", default: "text-slate-400" }; function g() { var [X] = [pick()]; T.undefined = X; }`, "T[q.data?.s] ?? T.default")],
  ["rebinding: for (var { X } of rows)", mkMap(`const X = "text-slate-500"; const T = { ok: "text-red-400", default: "text-slate-400" }; function g(rows) { for (var { X } of rows) { T.undefined = X; } }`, "T[q.data?.s] ?? T.default")],
  ["rebinding: a destructured var inside a catch block", mkMap(`const X = "text-slate-500"; const T = { ok: "text-red-400", default: "text-slate-400" }; function g() { try { init(); } catch (e) { var { X } = { X: pick() }; T.undefined = X; } }`, "T[q.data?.s] ?? T.default")],
  ["rebinding: a const inside a namespace body", mkMap(`const X = "text-slate-500"; const T = { ok: "text-red-400", default: "text-slate-400" }; namespace N { const X = pick(); T.undefined = X; }`, "T[q.data?.s] ?? T.default")],
  ["rebinding: a const in the SECOND case clause", mkMap(`const X = "text-slate-500"; const T = { ok: "text-red-400", default: "text-slate-400" }; function g() { switch (k) { case 1: break; case 2: { } default: const X = pick(); T.undefined = X; } }`, "T[q.data?.s] ?? T.default")],
  ["undefined: an import named undefined", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; import { undefined } from "./x"; T.undefined = undefined;`, "T[q.data?.s] ?? T.default")],
  ["undefined: an import renamed to undefined", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; import { cls as undefined } from "./x"; T.undefined = undefined;`, "T[q.data?.s] ?? T.default")],
  ["undefined: a default import named undefined", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; import undefined from "./x"; T.undefined = undefined;`, "T[q.data?.s] ?? T.default")],
  ["undefined: a namespace import named undefined", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; import * as undefined from "./x"; T.undefined = undefined;`, "T[q.data?.s] ?? T.default")],
  ["undefined: a let named undefined", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; function g() { let undefined = pick(); T.undefined = undefined; }`, "T[q.data?.s] ?? T.default")],
  ["undefined: a catch binding named undefined", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; try { init(); } catch (undefined) { T.undefined = undefined; }`, "T[q.data?.s] ?? T.default")],
  ["undefined: a destructured parameter named undefined", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; function g({ undefined }) { T.undefined = undefined; }`, "T[q.data?.s] ?? T.default")],
  ["rebinding: a destructured var hoisted out of an if block", mkMap(`const X = "text-slate-500"; const T = { ok: "text-red-400", default: "text-slate-400" }; function g() { if (c) { var { X } = { X: pick() }; } T.undefined = X; }`, "T[q.data?.s] ?? T.default")],
  ["rebinding: an array-destructured var hoisted out of an if block", mkMap(`const X = "text-slate-500"; const T = { ok: "text-red-400", default: "text-slate-400" }; function g() { if (c) { var [X] = [pick()]; } T.undefined = X; }`, "T[q.data?.s] ?? T.default")],
  ["rebinding: a nested destructured var { a: { X } } hoisted out of an if", mkMap(`const X = "text-slate-500"; const T = { ok: "text-red-400", default: "text-slate-400" }; function g() { if (c) { var { a: { X } } = { a: { X: pick() } }; } T.undefined = X; }`, "T[q.data?.s] ?? T.default")],
  ["rebinding: a nested array-in-object destructured var { a: [X] } hoisted out of an if", mkMap(`const X = "text-slate-500"; const T = { ok: "text-red-400", default: "text-slate-400" }; function g() { if (c) { var { a: [X] } = { a: [pick()] }; } T.undefined = X; }`, "T[q.data?.s] ?? T.default")],
  ["undefined: an import-equals alias named undefined", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; import * as M from "./m"; export import undefined = M.x; T.undefined = undefined;`, "T[q.data?.s] ?? T.default")],
  ["rebinding: a var nested in an if inside a static block, used in the static block", mkMap(`const X = "text-slate-500"; const T = { ok: "text-red-400", default: "text-slate-400" }; class K { static { if (c) { var X = pick(); } T.undefined = X; } }`, "T[q.data?.s] ?? T.default")],
  ["rebinding: a var nested in an if inside a namespace, used in the namespace", mkMap(`const X = "text-slate-500"; const T = { ok: "text-red-400", default: "text-slate-400" }; namespace N { if (c) { var X = pick(); } T.undefined = X; }`, "T[q.data?.s] ?? T.default")],
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
  ["control: nested map read only", mkMap(`const T = { a: { ok: "text-red-400", default: "text-slate-400" } };`, "T.a[q.data?.s] ?? T.a.default")],
  ["control: two-level nested map read only", mkMap(`const T = { a: { b: { ok: "text-red-400", default: "text-slate-400" } } };`, "T.a.b[q.data?.s] ?? T.a.b.default")],
  ["control: ...BASE spread source untouched", mkMap(`const BASE = { ok: "text-red-400" }; const T = { ...BASE, default: "text-slate-400" };`, "T[q.data?.s] ?? T.default")],
  ["control: map write of a readable non-good literal", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; T.default = "text-slate-500";`, "T[q.data?.s] ?? T.default")],
  ["control: Object.assign with readable non-good literal values", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; Object.assign(T, { default: "text-slate-500", n: 1 });`, "T[q.data?.s] ?? T.default")],
  ["control: absent-key entries with readable non-good values", mkMap(`const SLATE = "text-slate-500"; const T = { ok: "text-red-400", default: "text-slate-400", undefined: SLATE, null: "text-slate-500", "": null };`, "T[q.data?.s] ?? T.default")],
  ["control: Object.assign with null / void 0 / template / const values", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; const SLATE = "text-slate-500"; Object.assign(T, { a: null, b: void 0, c: \`text-slate-500\`, d: SLATE, e: 2, f: \`text-slate-\${n}\` });`, "T[q.data?.s] ?? T.default")],
  ["control: absent-key entry bound through a const to a readable literal", mkMap(`const X = "text-slate-500"; const Y = X; const T = { ok: "text-red-400", default: "text-slate-400", undefined: Y };`, "T[q.data?.s] ?? T.default")],
  ["control: writes of true / false / undefined / a numeric const", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; const N = 3; T.undefined = true; T.null = false; T[\"\"] = undefined; T.undefined = N;`, "T[q.data?.s] ?? T.default")],
  ["control: getter on undefined returning a readable literal", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400", get undefined() { return "text-slate-500"; } };`, "T[q.data?.s] ?? T.default")],
  ["twin: getter on an unreadable computed key returning a readable literal", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400", get [kfn()]() { return "text-slate-500"; } };`, "T[q.data?.s] ?? T.default")],
  ["twin: getter with two readable returns", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400", get undefined() { if (c) { return "text-slate-500"; } return "text-slate-400"; } };`, "T[q.data?.s] ?? T.default")],
  ["twin: getter on UNDEFINED returning a readable literal", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400", get UNDEFINED() { return "text-slate-500"; } };`, "T[String(q.data?.s).toUpperCase()] ?? T.default")],
  ["twin: a var-free module const bound to a literal stays readable", mkMap(`const X = "text-slate-500"; const T = { ok: "text-red-400", default: "text-slate-400", undefined: X };`, "T[q.data?.s] ?? T.default")],
  ["a const alias chain of 7 hops FAILS OPEN (documented limit)", mkMap(`const A0 = { ok: "${EMER}" }; const A1 = A0; const A2 = A1; const A3 = A2; const A4 = A3; const A5 = A4; const A6 = A5; const A7 = A6;`, "A7.ok")],
  ["a template with only a substitution is read as non-good (documented)", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400", undefined: \`\${pick()}\` };`, "T[q.data?.s] ?? T.default")],
  ["twin: a let / var of another name does not make undefined unreadable", mkMap(`const T = { ok: "text-red-400", default: "text-slate-400" }; function g() { let other = 1; var more = 2; T.undefined = undefined; }`, "T[q.data?.s] ?? T.default")],
  ["twin: a function-scope var of ANOTHER name keeps the module const readable", mkMap(`const X = "text-slate-500"; const T = { ok: "text-red-400", default: "text-slate-400" }; function g() { var Y = pick(); T.undefined = X; }`, "T[q.data?.s] ?? T.default")],
  ["control: a map with no absent-key entry", mkMap(`const U = { ok: "text-red-400", default: "text-slate-400" };`, "U[q.data?.s?.x] ?? U.default")],
);


const compChain = (n) => propsFixture(Array.from({ length: n }, (_, i) => i < n - 1
  ? `function C${i + 1}(props) { return <C${i + 2} items={props.items} />; }`
  : `function C${i + 1}({ items }) { return ${EMERALD_ITEMS}; }`).reverse().join("\n"), "<C1 items={items} />"); // declared leaf-first: each pass of the fixpoint moves the taint one hop
BUG_R6.push(["component chain of 9, declared leaf-first, still follows the props", compChain(9)]);
OK_R6.push(["component chain of 10, declared leaf-first, FAILS OPEN (documented limit)", compChain(10)]);

const compChainPageLast = (n) => `
import { useQuery } from "@tanstack/react-query";
${Array.from({ length: n }, (_, i) => i < n - 1
  ? `function C${i + 1}(props) { return <C${i + 2} items={props.items} />; }`
  : `function C${i + 1}({ items }) { return ${EMERALD_ITEMS}; }`).reverse().join("\n")}
export function Page() {
  const q = useQuery({ queryKey: ["a"], queryFn: fa });
  const items = q.data?.items ?? [];
  return <C1 items={items} />;
}`;
BUG_R6.push(["component chain of 8, leaf-first with the page declared LAST, still follows the props", compChainPageLast(8)]);
OK_R6.push(["component chain of 9, leaf-first with the page declared LAST, FAILS OPEN (documented limit)", compChainPageLast(9)]);

// Codex review of #1370 (head af273d65): paren/asserted fallbacks, identifier-style and nested-pattern props,
// lexically scoped helpers, memo(Identifier), named query-object props on `props`, call-site pairing.
const PILL_ID = `function Pill(props) { return <span className={props.tone}>{props.n}</span>; }`;
const helperScope = (pageTone, otherTone) => `
import { useQuery } from "@tanstack/react-query";
export function Page() {
  const q = useQuery({ queryKey: ["a"], queryFn: fa });
  const tone = (s) => ${pageTone};
  return <span className={tone(q.data?.status)}>{q.data?.n}</span>;
}
export function Other() {
  const tone = (s) => ${otherTone};
  return <span className={tone("x")}>x</span>;
}`;
BUG_R6.push(
  ["fallback is good-state behind parentheses: (TONE[s]) ?? TONE.ok", mapShape(TONE, "(TONE[status]) ?? TONE.ok")],
  ["identifier-style props: className={props.tone} fed an emerald literal", propsFixture(PILL_ID, `<Pill tone="text-emerald-400" n={items.length} />`)],
  ["identifier-style props: className={props[\"tone\"]} fed an emerald literal", propsFixture(`function Pill(props) { return <span className={props["tone"]}>{props.n}</span>; }`, `<Pill tone="text-emerald-400" n={items.length} />`)],
  ["nested object pattern: ({ items: { length } }) renders emerald", propsFixture(`function Panel({ items: { length } }) { return <span className="text-emerald-400">{length}</span>; }`, "<Panel items={items} />")],
  ["nested array pattern: ({ items: [first] }) renders emerald", propsFixture(`function Panel({ items: [first] }) { return <span className="text-emerald-400">{first}</span>; }`, "<Panel items={items} />")],
  ["helper resolved in its own scope: Page's emerald tone() beside Other's red tone()", helperScope(`s === "ok" ? "text-emerald-400" : "text-red-400"`, `"text-red-400"`)],
  ["memo(PanelImpl) over a named component", propsFixture(`const PanelImpl = ({ items }) => ${EMERALD_ITEMS};\nconst Panel = memo(PanelImpl);`, "<Panel items={items} />", `import React, { memo, forwardRef } from "react";`)],
  ["memo(PanelImpl) over a function declaration", propsFixture(`function PanelImpl({ items }) { return ${EMERALD_ITEMS}; }\nconst Panel = memo(PanelImpl);`, "<Panel items={items} />", `import React, { memo, forwardRef } from "react";`)],
  ["forwardRef(PanelImpl) over a named component", propsFixture(`const PanelImpl = ({ items }, ref) => ${EMERALD_ITEMS};\nconst Panel = forwardRef(PanelImpl);`, "<Panel items={items} />", `import React, { memo, forwardRef } from "react";`)],
  ["named query-object prop on an identifier parameter: props.query.data", propsFixture(`function Row(props) { return <b className="text-emerald-400">{props.query.data?.n}</b>; }`, "<Row query={q} />")],
  ["call sites paired: the emerald site also passes data", propsFixture(PILL, `<div><Pill tone="text-emerald-400" n={items.length} /><Pill tone="text-red-400" n="static" /></div>`)],
);
OK_R6.push(
  ["fallback behind parentheses is still a fallback: (TONE[s]) ?? TONE.default", mapShape(TONE, "(TONE[status]) ?? TONE.default")],
  ["fallback behind an assertion: (TONE[s] as string) ?? TONE.default", mapShape(TONE, "(TONE[status] as string) ?? TONE.default")],
  ["identifier-style props, call site guarded", propsFixture(PILL_ID, `q.data ? <Pill tone="text-emerald-400" n={items.length} /> : null`)],
  ["identifier-style props, child renders no data", propsFixture(PILL_ID, `<Pill tone="text-emerald-400" n="static" />`)],
  ["nested object pattern, call site guarded", propsFixture(`function Panel({ items: { length } }) { return <span className="text-emerald-400">{length}</span>; }`, "q.data ? <Panel items={items} /> : null")],
  ["helper in its own scope returns only red", helperScope(`"text-red-400"`, `s === "ok" ? "text-emerald-400" : "text-red-400"`)],
  ["memo(PanelImpl), call site guarded", propsFixture(`const PanelImpl = ({ items }) => ${EMERALD_ITEMS};\nconst Panel = memo(PanelImpl);`, "q.data ? <Panel items={items} /> : null", `import React, { memo, forwardRef } from "react";`)],
  ["named query-object prop, child guards props.query.data", propsFixture(`function Row(props) { return props.query.data ? <b className="text-emerald-400">{props.query.data.n}</b> : null; }`, "<Row query={q} />")],
  ["call sites paired: the emerald site passes no data, the data site is red", propsFixture(PILL, `<div><Pill tone="text-emerald-400" n="static" /><Pill tone="text-red-400" n={items.length} /></div>`)],
);

// Codex review #2 of #1370 (head ea7caf5a): nested query-object bindings, prop-level call-site pairing, opaque
// shadowing of a component name, computed cloneElement, nested class bindings, JSX-valued children, downstream
// map aliases, imported `String`.
const Q2 = `const q = useQuery({ queryKey: ["a"], queryFn: fa });`;
const wrap2 = (body) => `import { useQuery } from "@tanstack/react-query";\n${body}`;
const shadowFx = (shadow) => wrap2(`function Panel({ n }) { return <span className="text-emerald-400">{n}</span>; }
class SafePanel extends React.Component { render() { return <span className="text-red-400">{this.props.n}</span>; } }
export function Page() {
  ${Q2}
  ${shadow ? "const Panel = SafePanel;" : ""}
  return <Panel n={q.data?.n} />;
}`);
const cloneFx = (alias) => wrap2(`const T = { ok: "text-emerald-400", default: "text-slate-400" };
${alias}
function Card({ s, n }) { return <span className={T[s] ?? T.default}>{n}</span>; }
export function Page() {
  ${Q2}
  return <div>{clone(<Card s={q.data?.status} n={q.data?.n} />, { s: "ok" })}</div>;
}`);
const aliasFx = (extra) => wrap2(`const T0 = { ok: "text-emerald-400", default: "text-slate-400" };
const T1 = T0;
${extra}
export function Page() {
  ${Q2}
  return <span className={T0[q.data?.s] ?? T0.default}>{q.data?.n}</span>;
}`);
const stringFx = (imp) => wrap2(`${imp}
const T = { ok: "text-emerald-400", default: "text-slate-400" };
export function Page() {
  ${Q2}
  return <span className={T[String(q.data?.status)] ?? T.default}>{q.data?.n}</span>;
}`);
BUG_R6.push(
  ["nested query-object binding: ({ query: { data } }) fed query={q}", propsFixture(`function Row({ query: { data } }) { return <span className="text-emerald-400">{data?.n}</span>; }`, "<Row query={q} />")],
  ["nested query-object binding: ({ query: { data: d } }) fed query={q}", propsFixture(`function Row({ query: { data: d } }) { return <span className="text-emerald-400">{d?.n}</span>; }`, "<Row query={q} />")],
  ["prop-level pairing: the emerald site passes data through a prop the child reads", propsFixture(PILL, `<div><Pill tone="text-emerald-400" n={items.length} hidden="x" /><Pill tone="text-red-400" n="static" /></div>`)],
  ["outer component is not shadowed when the inner name is unbound", shadowFx(false)],
  ["computed cloneElement alias: React[\"cloneElement\"]", cloneFx(`const clone = React["cloneElement"];`)],
  ["computed cloneElement destructure: { [\"cloneElement\"]: clone }", cloneFx(`const { ["cloneElement"]: clone } = React;`)],
  ["nested class binding: ({ style: { tone } }) fed style={{ tone: emerald }}", propsFixture(`function Pill({ style: { tone }, n }) { return <span className={tone}>{n}</span>; }`, `<Pill style={{ tone: "text-emerald-400" }} n={items.length} />`)],
  ["children: a fragment around query data", propsFixture(`function Panel({ children }) { return <span className="text-emerald-400">{children}</span>; }`, "<Panel><>{items.length}</></Panel>")],
  ["children: an element around query data", propsFixture(`function Panel({ children }) { return <span className="text-emerald-400">{children}</span>; }`, "<Panel><b>{items.length}</b></Panel>")],
  ["downstream map alias is written: const T1 = T0; T1.undefined = emerald", aliasFx(`T1.undefined = "text-emerald-400";`)],
  ["imported String is not the global String", stringFx(`import { String } from "./fmt";`)],
  ["imported String via a namespace import", stringFx(`import * as String from "./fmt";`)],
);
OK_R6.push(
  ["nested query-object binding, call site guarded", propsFixture(`function Row({ query: { data } }) { return <span className="text-emerald-400">{data?.n}</span>; }`, "q.data ? <Row query={q} /> : null")],
  ["prop-level pairing: the data rides a prop the child never reads", propsFixture(PILL, `<div><Pill tone="text-emerald-400" n="static" hidden={items.length} /><Pill tone="text-red-400" n={items.length} /></div>`)],
  ["an opaque inner binding shadows the outer component name", shadowFx(true)],
  ["a parameter named like the component shadows it", wrap2(`function Panel({ n }) { return <span className="text-emerald-400">{n}</span>; }
export function Page({ Panel }) {
  ${Q2}
  return <Panel n={q.data?.n} />;
}`)],
  ["nested class binding, call site guarded", propsFixture(`function Pill({ style: { tone }, n }) { return <span className={tone}>{n}</span>; }`, `q.data ? <Pill style={{ tone: "text-emerald-400" }} n={items.length} /> : null`)],
  ["children: a fragment, call site guarded", propsFixture(`function Panel({ children }) { return <span className="text-emerald-400">{children}</span>; }`, "q.data ? <Panel><>{items.length}</></Panel> : null")],
  ["downstream map alias that is never written", aliasFx("")],
  ["the global String stays the builtin when an unrelated name is imported", stringFx(`import { fmt } from "./fmt";`)],
);

// Codex review #3 of #1370 (head 1e68f97): helper arguments, exact nested class paths, class provenance through
// JSX spreads and through `const p = props` aliases.
const helperArgFx = (arg) => wrap2(`const TONE = { ok: "text-emerald-400", default: "text-slate-400" };
function toneFor(s) { return TONE[s] ?? TONE.default; }
export function Page() {
  ${Q2}
  return <span className={toneFor(${arg})}>{q.data?.n}</span>;
}`);
const nestedPathFx = (style, guard) => wrap2(`function Pill({ style: { tone }, n }) { return <span className={tone}>{n}</span>; }
export function Page() {
  ${Q2}
  return ${guard ? "q.data ? " : ""}<Pill style={${style}} n={q.data?.n} />${guard ? " : null" : ""};
}`);
const spreadFx = (spread, guard) => wrap2(`function Pill({ tone, n }) { return <span className={tone}>{n}</span>; }
const base = { tone: "text-emerald-400" };
export function Page() {
  ${Q2}
  return ${guard ? "q.data ? " : ""}<Pill ${spread} />${guard ? " : null" : ""};
}`);
const aliasPropsFx = (decl, guard) => wrap2(`function Pill(props) { ${decl} return <span className={p.tone}>{p.n}</span>; }
export function Page() {
  ${Q2}
  return ${guard ? "q.data ? " : ""}<Pill tone="text-emerald-400" n={q.data?.n} />${guard ? " : null" : ""};
}`);
BUG_R6.push(
  ["helper called with a fixed argument: toneFor(\"ok\") selects the emerald entry", helperArgFx(`"ok"`)],
  ["nested class path matches by name: tone is the emerald property", nestedPathFx(`{ tone: "text-emerald-400", success: "text-red-400" }`, false)],
  ["class through a JSX spread literal: {...{ tone: emerald, n: data }}", wrap2(`function Pill({ tone, n }) { return <span className={tone}>{n}</span>; }
export function Page() {
  ${Q2}
  return <Pill {...{ tone: "text-emerald-400", n: q.data?.n }} />;
}`)],
  ["class through a JSX spread of a const object: {...base}", spreadFx("{...base} n={q.data?.n}", false)],
  ["class through a props alias: const p = props", aliasPropsFx("const p = props;", false)],
  ["class through a two-step props alias: const a = props; const p = a", aliasPropsFx("const a = props; const p = a;", false)],
);
OK_R6.push(
  ["helper called with a plain data read: toneFor(q.data?.status) falls back to the muted entry", helperArgFx(`q.data?.status`)],
  ["nested class path matches by name: tone is the red property, success is emerald", nestedPathFx(`{ tone: "text-red-400", success: "text-emerald-400" }`, false)],
  ["nested class path, call site guarded", nestedPathFx(`{ tone: "text-emerald-400" }`, true)],
  ["class through a JSX spread literal that is red", wrap2(`function Pill({ tone, n }) { return <span className={tone}>{n}</span>; }
export function Page() {
  ${Q2}
  return <Pill {...{ tone: "text-red-400", n: q.data?.n }} />;
}`)],
  ["class through a JSX spread of a const object, call site guarded", spreadFx("{...base} n={q.data?.n}", true)],
  ["class through a props alias, call site guarded", aliasPropsFx("const p = props;", true)],
);

// Landing refute round 22 of #1370 (head 1f81c0a0): regressions introduced by the Codex-driven fixes.
const ownQueryFx = (cls, guard) => wrap2(`function StatusPill({ tone }) {
  ${Q2}
  return ${guard ? "q.data ? " : ""}<span className={tone}>{q.data?.count}</span>${guard ? " : null" : ""};
}
export function Page() { return <StatusPill tone="${cls}" />; }`);
const helperParamFx = (decl, call) => wrap2(`const TONE = { ok: "text-emerald-400", default: "text-slate-400" };
${decl}
export function Page() {
  ${Q2}
  return <span className={${call}}>{q.data?.n}</span>;
}`);
BUG_R6.push(
  ["own-query child: a class from a dataless call site still paints the child's own data", ownQueryFx("text-emerald-400", false)],
  ["helper parameter with a default: toneFor(s = \"ok\")", helperParamFx(`function toneFor(s = "ok") { return TONE[s] ?? TONE.default; }`, "toneFor(q.data?.status)")],
  ["helper parameter reassigned: s = s ?? \"ok\"", helperParamFx(`function toneFor(s) { s = s ?? "ok"; return TONE[s] ?? TONE.default; }`, "toneFor(q.data?.status)")],
  ["helper parameter reassigned: s ??= \"ok\"", helperParamFx(`function toneFor(s) { s ??= "ok"; return TONE[s] ?? TONE.default; }`, "toneFor(q.data?.status)")],
  ["helper parameter written by array destructuring: [s] = [s ?? \"ok\"]", helperParamFx(`function toneFor(s) { [s] = [s ?? "ok"]; return TONE[s] ?? TONE.default; }`, "toneFor(q.data?.status)")],
  ["helper parameter written by object destructuring: ({ s } = { s: s ?? \"ok\" })", helperParamFx(`function toneFor(s) { ({ s } = { s: s ?? "ok" }); return TONE[s] ?? TONE.default; }`, "toneFor(q.data?.status)")],
  ["helper parameter written by a for-of target", helperParamFx(`function toneFor(s) { for (s of ["ok"]) { break; } return TONE[s] ?? TONE.default; }`, "toneFor(q.data?.status)")],
  ["helper parameter shadowed by an inner let", helperParamFx(`function toneFor(s) { { let s = "ok"; return TONE[s] ?? TONE.default; } }`, "toneFor(q.data?.status)")],
  ["arrow helper parameter with a default: (s = \"ok\") =>", helperParamFx(`const toneFor = (s = "ok") => TONE[s] ?? TONE.default;`, "toneFor(q.data?.status)")],
  ["var-declared helper hoisted out of an if block", wrap2(`if (globalThis.flag) { var tone = (s) => "text-emerald-400"; }
export function Page() {
  ${Q2}
  return <span className={tone(q.data?.status)}>{q.data?.n}</span>;
}`)],
  ["getter member in the passed literal supplies the class", wrap2(`function Pill({ style: { tone }, n }) { return <span className={tone}>{n}</span>; }
export function Page() {
  ${Q2}
  return <Pill style={{ get tone() { return "text-emerald-400"; } }} n={q.data?.n} />;
}`)],
  ["method member in the passed literal supplies the class", wrap2(`function Pill({ style: { tone }, n }) { return <span className={tone}>{n}</span>; }
export function Page() {
  ${Q2}
  return <Pill style={{ tone() { return "text-emerald-400"; } }} n={q.data?.n} />;
}`)],
);
OK_R6.push(
  ["own-query child with a red class from a dataless call site", ownQueryFx("text-red-400", false)],
  ["own-query child guarded on its own data", ownQueryFx("text-emerald-400", true)],
  ["helper parameter untouched and called with a plain read (substitution still applies)", helperParamFx(`function toneFor(s) { return TONE[s] ?? TONE.default; }`, "toneFor(q.data?.status)")],
  ["spread class overridden by a later explicit red attribute", wrap2(`function Pill({ tone, n }) { return <span className={tone}>{n}</span>; }
export function Page() {
  ${Q2}
  return <Pill {...{ tone: "text-emerald-400" }} tone="text-red-400" n={q.data?.n} />;
}`)],
);

// Round 24: a key read from the query RESULT (not its `.data`) is present while the data is absent.
const flagMap = (k) => `const S = { ${k}: "text-emerald-400", default: "text-slate-400" };`;
BUG_R6.push(
  ["status-flag key: S[q.isError] ?? S.default with { false: good }", keyFx(flagMap("false"), "", "S[q.isError] ?? S.default")],
  ["status-flag key: S[q.isLoading] ?? S.default with { true: good }", keyFx(flagMap("true"), "", "S[q.isLoading] ?? S.default")],
  ["status-flag key: S[q.status] ?? S.default with { pending: good }", keyFx(flagMap("pending"), "", "S[q.status] ?? S.default")],
  ["status-flag key through a destructured binding: const { isError } = q", keyFx(flagMap("false"), "const { isError } = q;", "S[isError] ?? S.default")],
  ["status-flag key through an alias: const e = q.isError", keyFx(flagMap("false"), "const e = q.isError;", "S[e] ?? S.default")],
);
OK_R6.push(
  ["data key through .data still earns the fallback exemption", keyFx(flagMap("ok"), "", "S[q.data?.status] ?? S.default")],
  ["destructured data binding still earns the fallback exemption", keyFx(flagMap("ok"), "const { data } = q;", "S[data?.status] ?? S.default")],
);

// Round 26 (Codex pass 7): a reassigned `let`/`var` helper is every one of its values; a const alias names the same helper.
const helperPage = (pre, call) => wrap2(`${pre}
export function Page() {
  ${Q2}
  return ${call};
}`);
BUG_R6.push(
  ["let helper reassigned to an emerald arrow after a red initializer", helperPage(`let tone = () => "text-red-400"; tone = () => "text-emerald-400";`, `<span className={tone()}>{q.data?.n}</span>`)],
  ["var helper reassigned to a named emerald function", helperPage(`function good() { return "text-emerald-400"; }\nvar tone = () => "text-red-400"; tone = good;`, `<span className={tone()}>{q.data?.n}</span>`)],
  ["const alias of an emerald helper", helperPage(`function good() { return "text-emerald-400"; }\nconst pick = good;`, `<span className={pick()}>{q.data?.n}</span>`)],
  ["const alias of a map-lookup helper that falls to an emerald default key", helperPage(`const T = { ok: "text-emerald-400", default: "text-slate-400" };\nfunction toneFor(s) { return T[s ?? "ok"]; }\nconst pickTone = toneFor;`, `<span className={pickTone(q.data?.status)}>{q.data?.n}</span>`)],
  ["const alias chain of an emerald helper", helperPage(`function good() { return "text-emerald-400"; }\nconst a = good; const b = a;`, `<span className={b()}>{q.data?.n}</span>`)],
);
OK_R6.push(
  ["let helper reassigned to another muted arrow stays clean", helperPage(`let tone = () => "text-red-400"; tone = () => "text-slate-400";`, `<span className={tone()}>{q.data?.n}</span>`)],
  ["const alias of a muted helper stays clean", helperPage(`function muted() { return "text-slate-400"; }\nconst pick = muted;`, `<span className={pick()}>{q.data?.n}</span>`)],
  ["reassigned emerald helper, call guarded on the data", helperPage(`let tone = () => "text-red-400"; tone = () => "text-emerald-400";`, `q.data ? <span className={tone()}>{q.data.n}</span> : null`)],
);

// Round 27 (landing refute 26 + Codex pass 8): every write to a `let` / `var` helper is collected; one that cannot be
// collected makes the call possibly good (fail-closed). A parameter shadows a helper alias; a nested `let` shadows a
// class-valued parameter; string-literal / computed prop names ride the same props as identifier ones.
const GOOD_FN = `function good() { return "text-emerald-400"; }\nfunction muted() { return "text-slate-400"; }`;
const useTone = `<span className={tone()}>{q.data?.n}</span>`;
BUG_R6.push(
  ["uninitialised let helper later assigned an emerald arrow", helperPage(`let tone;\ntone = () => "text-emerald-400";`, useTone)],
  ["let helper initialised to null, later assigned an emerald arrow", helperPage(`let tone = null;\ntone = () => "text-emerald-400";`, useTone)],
  ["conditional right-hand side with one emerald branch", helperPage(`let tone = () => "text-red-400";\ntone = enabled ? () => "text-emerald-400" : () => "text-red-400";`, useTone)],
  ["logical right-hand side (||) carrying an emerald arrow", helperPage(`let tone = () => "text-red-400";\ntone = other || (() => "text-emerald-400");`, useTone)],
  ["array destructuring assignment to the helper", helperPage(`let tone = () => "text-red-400";\n[tone] = [() => "text-emerald-400"];`, useTone)],
  ["object destructuring assignment to the helper", helperPage(`let tone = () => "text-red-400";\n({ tone } = { tone: () => "text-emerald-400" });`, useTone)],
  ["logical assignment (&&=) to the helper", helperPage(`let tone = () => "text-red-400";\ntone &&= () => "text-emerald-400";`, useTone)],
  ["member right-hand side (tone = helpers.good) is unresolvable", helperPage(`const helpers = { good: () => "text-emerald-400" };\nlet tone = () => "text-red-400";\ntone = helpers.good;`, useTone)],
  ["for-of target assigned to the helper", helperPage(`let tone = () => "text-red-400";\nfor (tone of [() => "text-emerald-400"]) { break; }`, useTone)],
  ["transitive: a = b where b is itself reassigned", helperPage(`${GOOD_FN}\nlet b = muted; b = good;\nlet tone = muted; tone = b;`, useTone)],
  ["chained assignment tone = other = good", helperPage(`${GOOD_FN}\nlet other; let tone;\ntone = other = good;`, useTone)],
  ["let alias of an emerald helper", helperPage(`${GOOD_FN}\nlet tone = good;`, useTone)],
  ["var alias of an emerald helper", helperPage(`${GOOD_FN}\nvar tone = good;`, useTone)],
  ["let alias of a muted helper later assigned the emerald one", helperPage(`${GOOD_FN}\nlet tone = muted; tone = good;`, useTone)],
  ["reassigned to a function EXPRESSION", helperPage(`let tone = () => "text-red-400";\ntone = function () { return "text-emerald-400"; };`, useTone)],
  ["reassigned to a type-asserted arrow", helperPage(`let tone = () => "text-red-400";\ntone = (() => "text-emerald-400") as () => string;`, useTone)],
  ["const alias with a type assertion", helperPage(`${GOOD_FN}\nconst tone = good as () => string;`, useTone)],
  ["recursive initializer with an emerald reassignment", helperPage(`let tone = () => tone();\ntone = () => "text-emerald-400";`, useTone)],
  ["string-literal prop name rides the props: { \"data-value\": n }", wrap2(`function Pill({ "data-value": n }) { return <span className="text-emerald-400">{n}</span>; }
export function Page() {
  ${Q2}
  return <Pill data-value={q.data?.n} />;
}`)],
  ["computed string prop name rides the props: { [\"data-value\"]: n }", wrap2(`function Pill({ ["data-value"]: n }) { return <span className="text-emerald-400">{n}</span>; }
export function Page() {
  ${Q2}
  return <Pill data-value={q.data?.n} />;
}`)],
);
OK_R6.push(
  ["uninitialised let helper later assigned a muted arrow", helperPage(`let tone;\ntone = () => "text-slate-400";`, useTone)],
  ["conditional right-hand side with muted branches", helperPage(`let tone = () => "text-red-400";\ntone = enabled ? () => "text-slate-400" : () => "text-red-400";`, useTone)],
  ["let alias of a muted helper", helperPage(`${GOOD_FN}\nlet tone = muted;`, useTone)],
  ["uncollectable write, call guarded on the data", helperPage(`let tone = () => "text-red-400";\n[tone] = [() => "text-emerald-400"];`, `q.data ? <span className={tone()}>{q.data.n}</span> : null`)],
  ["a parameter shadows a module-level emerald helper alias", wrap2(`${GOOD_FN}
const pick = good;
export function Page({ pick }) {
  ${Q2}
  return <span className={pick()}>{q.data?.n}</span>;
}`)],
  ["an inner const bound to a call shadows an outer emerald helper", wrap2(`${GOOD_FN}
export function Page() {
  ${Q2}
  const good = useThing();
  return <span className={good()}>{q.data?.n}</span>;
}`)],
  ["a nested let shadows a class-valued component parameter", wrap2(`function Pill({ tone, n }) { { let tone = "text-red-400"; return <span className={tone}>{n}</span>; } }
export function Page() {
  ${Q2}
  return <Pill tone="text-emerald-400" n={q.data?.n} />;
}`)],
  ["a nested function parameter shadows a class-valued component parameter", wrap2(`function Pill({ tone, n }) { const f = (tone) => <span className={tone}>{n}</span>; return f("text-red-400"); }
export function Page() {
  ${Q2}
  return <Pill tone="text-emerald-400" n={q.data?.n} />;
}`)],
  ["string-literal prop name, call site guarded on the data", wrap2(`function Pill({ "data-value": n }) { return <span className="text-emerald-400">{n}</span>; }
export function Page() {
  ${Q2}
  return q.data ? <Pill data-value={q.data.n} /> : null;
}`)],
);
BUG_R6.push(
  ["let helper initialised by a call, later assigned an emerald arrow", helperPage(`let tone = useThing();\ntone = () => "text-emerald-400";`, useTone)],
  ["write of an unresolvable identifier (tone = fromProps)", helperPage(`let tone = () => "text-red-400";\ntone = fromProps;`, useTone)],
);
OK_R6.push(
  ["reassigned to a muted function EXPRESSION", helperPage(`let tone = () => "text-red-400";\ntone = function () { return "text-slate-400"; };`, useTone)],
  ["reassigned to a muted type-asserted arrow", helperPage(`let tone = () => "text-red-400";\ntone = (() => "text-slate-400") as () => string;`, useTone)],
  ["let helper initialised by a call, never reassigned", helperPage(`let tone = useThing();`, useTone)],
  ["a catch binding shadows a class-valued component parameter", wrap2(`function Pill({ tone, n }) { try { return null; } catch (tone) { return <span className={tone}>{n}</span>; } }
export function Page() {
  ${Q2}
  return <Pill tone="text-emerald-400" n={q.data?.n} />;
}`)],
);

// Round 28 (landing refute 27 + Codex pass 9): a `var` redeclaring a parameter in its OWN function is the same binding (not a
// shadow) and its initializer is one more value; same-scope `var` redeclarations of a helper merge; `(tone)()`, `tone!()`,
// `tone.call(null)` are calls of the helper; the arms that fail open if removed are pinned.
const nestedCond = (n) => n === 0 ? `() => "text-slate-400"` : `flag${n} ? () => "text-slate-400" : (${nestedCond(n - 1)})`;
BUG_R6.push(
  ["var redeclaring a destructured parameter keeps the caller's class: var tone;", wrap2(`function Pill({ tone, n }) { var tone; return <span className={tone}>{n}</span>; }
export function Page() {
  ${Q2}
  return <Pill tone="text-emerald-400" n={q.data?.n} />;
}`)],
  ["var tone = tone || muted keeps the caller's class", wrap2(`function Pill({ tone, n }) { var tone = tone || "text-slate-400"; return <span className={tone}>{n}</span>; }
export function Page() {
  ${Q2}
  return <Pill tone="text-emerald-400" n={q.data?.n} />;
}`)],
  ["var inside a nested block still redeclares the parameter", wrap2(`function Pill({ tone, n }) { if (n) { var tone; } return <span className={tone}>{n}</span>; }
export function Page() {
  ${Q2}
  return <Pill tone="text-emerald-400" n={q.data?.n} />;
}`)],
  ["var props; then props.tone keeps the caller's class", wrap2(`function Pill(props) { var props; return <span className={props.tone}>{props.n}</span>; }
export function Page() {
  ${Q2}
  return <Pill tone="text-emerald-400" n={q.data?.n} />;
}`)],
  ["const p = props; var props; keeps the alias to the parameter", wrap2(`function Pill(props) { const p = props; var props; return <span className={p.tone}>{p.n}</span>; }
export function Page() {
  ${Q2}
  return <Pill tone="text-emerald-400" n={q.data?.n} />;
}`)],
  ["var tone = emerald redeclaring the parameter is one more value (call site passes no class)", wrap2(`function Pill({ tone, n }) { var tone = "text-emerald-400"; return <span className={tone}>{n}</span>; }
export function Page() {
  ${Q2}
  return <Pill n={q.data?.n} />;
}`)],
  ["same-scope var redeclaration of a helper: the second initializer is emerald", helperPage(`var tone = () => "text-red-400";\nvar tone = () => "text-emerald-400";`, useTone)],
  ["parenthesised callee (tone)()", helperPage(`let tone = () => "text-red-400";\ntone = () => "text-emerald-400";`, `<span className={(tone)()}>{q.data?.n}</span>`)],
  ["non-null callee tone!()", helperPage(`let tone = () => "text-red-400";\ntone = () => "text-emerald-400";`, `<span className={tone!()}>{q.data?.n}</span>`)],
  ["tone.call(null)", helperPage(`let tone = () => "text-red-400";\ntone = () => "text-emerald-400";`, `<span className={tone.call(null)}>{q.data?.n}</span>`)],
  ["arithmetic compound assignment to the helper (+=) is an uncollectable write", helperPage(`let tone = () => "text-red-400";\ntone += 1;`, useTone)],
  ["increment of the helper (++) is an uncollectable write", helperPage(`let tone = () => "text-red-400";\ntone++;`, useTone)],
  ["transitive unknown: tone = other where other has an uncollectable write", helperPage(`let other = () => "text-red-400";\n[other] = [() => "text-red-400"];\nlet tone = () => "text-red-400";\ntone = other;`, useTone)],
  ["conditional const initializer with an emerald branch", helperPage(`${GOOD_FN}\nconst tone = enabled ? good : muted;`, useTone)],
  ["a conditional nested past the depth cap is unknown (fail-closed)", helperPage(`let tone = () => "text-red-400";\ntone = ${nestedCond(10)};`, useTone)],
);
OK_R6.push(
  ["a nested function's own var tone shadows the parameter", wrap2(`function Pill({ tone, n }) { const f = () => { var tone = "text-red-400"; return <span className={tone}>{n}</span>; }; return f(); }
export function Page() {
  ${Q2}
  return <Pill tone="text-emerald-400" n={q.data?.n} />;
}`)],
  ["a var in a nested block of a nested function hoists to that function and shadows the parameter", wrap2(`function Pill({ tone, n }) { const f = () => { if (n) { var tone = "text-red-400"; } return <span className={tone}>{n}</span>; }; return f(); }
export function Page() {
  ${Q2}
  return <Pill tone="text-emerald-400" n={q.data?.n} />;
}`)],
  ["var tone = muted redeclaration, call site guarded", wrap2(`function Pill({ tone, n }) { var tone; return <span className={tone}>{n}</span>; }
export function Page() {
  ${Q2}
  return q.data ? <Pill tone="text-emerald-400" n={q.data.n} /> : null;
}`)],
  ["same-scope var redeclarations of a helper, both muted", helperPage(`var tone = () => "text-red-400";\nvar tone = () => "text-slate-400";`, useTone)],
  ["a destructured const shadows an outer emerald helper of the same name", wrap2(`${GOOD_FN}
const tone = good;
export function Page() {
  ${Q2}
  const { tone } = useThing();
  return <span className={tone()}>{q.data?.n}</span>;
}`)],
  ["tone.call(null) of a muted helper", helperPage(`let tone = () => "text-red-400";\ntone = () => "text-slate-400";`, `<span className={tone.call(null)}>{q.data?.n}</span>`)],
  ["conditional const initializer, both branches muted", helperPage(`${GOOD_FN}\nconst tone = enabled ? muted : muted;`, useTone)],
);

// Round 29 (Codex pass 10): `memo` / `forwardRef` unwrap only when they are React's; an unresolved wrapper that receives unguarded
// query data is rejected. Static map keys (numeric / template literals) select their own entry. A rest binding receives only the
// properties the pattern did not destructure.
const REACT_IMP = `import React, { memo, forwardRef } from "react";`;
const PANEL_IMPL = `function PanelImpl({ items }) { return ${EMERALD_ITEMS}; }`;
const REDPILL = `const RedPill = ({ items }) => <span className="text-red-400">{items.length} rows</span>;\nconst EmeraldPill = ({ items }) => ${EMERALD_ITEMS};`;
BUG_R6.push(
  ["a LOCAL memo that swaps the component (emerald around a red one) is unresolved and rejected", propsFixture(`const memo = (C) => EmeraldPill;\n${REDPILL}\nconst Pill = memo(RedPill);`, "<Pill items={items} />")],
  ["memo imported from another module is unresolved", propsFixture(`${PANEL_IMPL}\nconst Pill = memo(PanelImpl);`, "<Pill items={items} />", `import { memo } from "./mine";`)],
  ["memo re-exported by a local module (member of an unrelated object) is unresolved", propsFixture(`const lib = { memo: (C) => EmeraldPill };\n${REDPILL}\nconst Pill = lib.memo(RedPill);`, "<Pill items={items} />")],
  ["a bare undeclared memo is unresolved", propsFixture(`${PANEL_IMPL}\nconst Pill = memo(PanelImpl);`, "<Pill items={items} />")],
  ["forwardRef imported from another module is unresolved", propsFixture(`${PANEL_IMPL}\nconst Pill = forwardRef(PanelImpl);`, "<Pill items={items} />", `import { forwardRef } from "./mine";`)],
  ["a block-scoped memo shadows React's import", wrap2(`import { memo } from "react";
${REDPILL}
export function Page() {
  ${Q2}
  const items = q.data?.items ?? [];
  const memo = (C) => EmeraldPill;
  const Pill = memo(RedPill);
  return <Pill items={items} />;
}`)],
  ["numeric map key selects its own entry: T[1] is emerald", mapShape(`const T = { 1: "text-emerald-400", ok: "text-red-400" };`, "T[1]")],
  ["template-literal map key selects its own entry: T[`ok`] is emerald", mapShape("const T = { 1: \"text-red-400\", ok: \"text-emerald-400\" };", "T[`ok`]")],
  ["an aliased named import of react's memo is transparent: the wrapped emerald component is followed", propsFixture(`${PANEL_IMPL}\nconst Pill = m(PanelImpl);`, "<Pill items={items} />", `import { memo as m } from "react";`)],
  ["a namespace import of react is transparent: R.forwardRef(PanelImpl) is followed", propsFixture(`${PANEL_IMPL}\nconst Pill = R.forwardRef(PanelImpl);`, "<Pill items={items} />", `import * as R from "react";`)],
  ["an unresolved wrapper receiving unguarded data as JSX children", propsFixture(`${PANEL_IMPL}\nconst Pill = memo(PanelImpl);`, "<Pill>{items.length}</Pill>", `import { memo } from "./mine";`)],
  ["an unresolved wrapper receiving unguarded data through a spread", propsFixture(`${PANEL_IMPL}\nconst Pill = memo(PanelImpl);`, "<Pill {...{ items }} />", `import { memo } from "./mine";`)],
  ["memo(forwardRef(…)) with a LOCAL inner forwardRef is unresolved (the whole chain is checked)", propsFixture(`${PANEL_IMPL}\nconst forwardRef = (C) => C;\nconst Pill = memo(forwardRef(PanelImpl));`, "<Pill items={items} />", `import { memo } from "react";`)],
  ["a rest binding still receives a class that the pattern did not destructure", wrap2(`function Pill({ n, ...rest }) { return <span className={rest.tone}>{n}</span>; }
export function Page() {
  ${Q2}
  return <Pill tone="text-emerald-400" n={q.data?.n} />;
}`)],
);
OK_R6.push(
  ["React.memo from a default import resolves", propsFixture(`${PANEL_IMPL}\nconst Pill = React.memo(PanelImpl);`, "q.data ? <Pill items={items} /> : null", REACT_IMP)],
  ["memo from a named import of react resolves", propsFixture(`${PANEL_IMPL}\nconst Pill = memo(PanelImpl);`, "q.data ? <Pill items={items} /> : null", REACT_IMP)],
  ["an aliased named import of react's memo resolves", propsFixture(`${PANEL_IMPL}\nconst Pill = m(PanelImpl);`, "q.data ? <Pill items={items} /> : null", `import { memo as m } from "react";`)],
  ["a namespace import of react resolves: R.forwardRef", propsFixture(`${PANEL_IMPL}\nconst Pill = R.forwardRef(PanelImpl);`, "q.data ? <Pill items={items} /> : null", `import * as R from "react";`)],
  ["an unresolved wrapper, call site guarded on the data", propsFixture(`${PANEL_IMPL}\nconst Pill = memo(PanelImpl);`, "q.data ? <Pill items={items} /> : null", `import { memo } from "./mine";`)],
  ["an unresolved wrapper that receives only static props", propsFixture(`${PANEL_IMPL}\nconst Pill = memo(PanelImpl);`, "<Pill items={[]} />", `import { memo } from "./mine";`)],
  ["numeric map key selects its own (red) entry: T[1]", mapShape(`const T = { 1: "text-red-400", ok: "text-emerald-400" };`, "T[1]")],
  ["template-literal map key selects its own (red) entry", mapShape("const T = { ok: \"text-red-400\", other: \"text-emerald-400\" };", "T[`ok`]")],
  ["a rest binding is not tainted by a data prop the pattern destructured", wrap2(`function Pill({ items, ...rest }) { return <span className="text-emerald-400">{rest.label}</span>; }
export function Page() {
  ${Q2}
  const items = q.data?.items ?? [];
  return <Pill items={items} label="static" />;
}`)],
  ["a rest binding does not receive the destructured tone class", wrap2(`function Pill({ tone, ...rest }) { return <span className={rest.other}>{rest.n}</span>; }
export function Page() {
  ${Q2}
  return <Pill tone="text-emerald-400" other="text-red-400" n={q.data?.n} />;
}`)],
);

// Round 30 (landing refute 28/29): an unresolved wrapper that receives a WHOLE query object is rejected; the rest subtraction removes
// only siblings with a KNOWN source key; `.apply`, the call/apply argument shift and a member of an imported object are pinned; an alias
// of an unresolved wrapper is followed.
const ROW_IMPL = `const RowImpl = ({ query }) => <span className="text-emerald-400">{query.data?.n}</span>;`;
BUG_R6.push(
  ["a non-React memo wrapper receiving a whole query object (query={q}) is rejected", wrap2(`import { memo } from "./mine";
${ROW_IMPL}
const Row = memo(RowImpl);
export function Page() {
  ${Q2}
  return <Row query={q} />;
}`)],
  ["a non-React memo wrapper receiving a spread query object ({...q}) is rejected", wrap2(`import { memo } from "./mine";
${ROW_IMPL}
const Row = memo(RowImpl);
export function Page() {
  ${Q2}
  return <Row {...q} />;
}`)],
  ["the same query-object shape through React's memo is followed (flags as before)", wrap2(`import { memo } from "react";
${ROW_IMPL}
const Row = memo(RowImpl);
export function Page() {
  ${Q2}
  return <Row query={q} />;
}`)],
  ["a computed non-literal sibling key leaves the rest binding holding every class: { [k]: tone, ...rest }", wrap2(`declare const k: string;
function Pill({ [k]: tone, n, ...rest }: any) { return <span className={rest.tone}>{n}</span>; }
export function Page() {
  ${Q2}
  return <Pill tone="text-emerald-400" n={q.data?.n} />;
}`)],
  ["a computed non-literal sibling key leaves the rest binding holding every data prop", wrap2(`declare const k: string;
function Pill({ [k]: n, ...rest }: any) { return <span className="text-emerald-400">{rest.n}</span>; }
export function Page() {
  ${Q2}
  return <Pill n={q.data?.n} />;
}`)],
  ["tone.apply(null, []) is a call of the helper", helperPage(`let tone = () => "text-red-400";\ntone = () => "text-emerald-400";`, `<span className={tone.apply(null, [])}>{q.data?.n}</span>`)],
  ["toneFor.call(thisArg, \"ok\"): the first argument is `this`, not the key", helperPage(`const T = { ok: "text-emerald-400", default: "text-slate-400" };\nfunction toneFor(s) { return T[s] ?? T.default; }`, `<span className={toneFor.call(q.data?.status, "ok")}>{q.data?.n}</span>`)],
  ["a member of an IMPORTED object is not React's: Lib.memo(RedPill) may return anything", propsFixture(`${REDPILL}\nconst Pill = Lib.memo(RedPill);`, "<Pill items={items} />", `import Lib from "./lib";`)],
  ["an alias of an unresolved wrapper is still rejected: const Pill = P", propsFixture(`${PANEL_IMPL}\nconst P = memo(PanelImpl);\nconst Pill = P;`, "<Pill items={items} />", `import { memo } from "./mine";`)],
  ["an alias chain of an unresolved wrapper is still rejected", propsFixture(`${PANEL_IMPL}\nconst P = memo(PanelImpl);\nconst P2 = P;\nconst Pill = P2;`, "<Pill items={items} />", `import { memo } from "./mine";`)],
);
OK_R6.push(
  ["an unresolved wrapper receiving a query object, call site guarded on the data", wrap2(`import { memo } from "./mine";
${ROW_IMPL}
const Row = memo(RowImpl);
export function Page() {
  ${Q2}
  return q.data ? <Row query={q} /> : null;
}`)],
  ["an alias of an unresolved wrapper, call site guarded on the data", propsFixture(`${PANEL_IMPL}\nconst P = memo(PanelImpl);\nconst Pill = P;`, "q.data ? <Pill items={items} /> : null", `import { memo } from "./mine";`)],
  ["a known-key sibling still removes its prop from the rest binding: { tone, ...rest } with rest.other", wrap2(`function Pill({ ["tone"]: t, ...rest }) { return <span className={rest.other}>{rest.n}</span>; }
export function Page() {
  ${Q2}
  return <Pill tone="text-emerald-400" other="text-red-400" n={q.data?.n} />;
}`)],
);

// Round 31 (Codex pass 11): conditionally selected components, member-expression tags, bracket-accessed query fields, overload
// signatures, helper parameter defaults and render-prop callbacks.
const GOOD_C = `const Good = ({ items }) => ${EMERALD_ITEMS};\nconst Bad = ({ items }) => <span className="text-red-400">{items.length} rows</span>;`;
const RENDER_PANEL = `function Panel({ value, render }) { return <div>{render(value)}</div>; }`;
BUG_R6.push(
  ["conditionally selected component: enabled ? Good : Bad", propsFixture(`${GOOD_C}\nconst Pill = enabled ? Good : Bad;`, "<Pill items={items} />")],
  ["the emerald component is the LAST branch: enabled ? Bad : Good", propsFixture(`${GOOD_C}\nconst Pill = enabled ? Bad : Good;`, "<Pill items={items} />")],
  ["logically selected component: enabled && Good", propsFixture(`${GOOD_C}\nconst Pill = enabled && Good;`, "<Pill items={items} />")],
  ["nullish-selected component: Good ?? Bad", propsFixture(`${GOOD_C}\nconst Pill = Good ?? Bad;`, "<Pill items={items} />")],
  ["a conditional selection with an unresolved (imported) branch is rejected: enabled ? Bad : Imported", propsFixture(`${GOOD_C}\nconst Pill = enabled ? Bad : Imported;`, "<Pill items={items} />", `import Imported from "./x";`)],
  ["member-expression tag backed by a same-file object: <Components.Pill />", propsFixture(`${GOOD_C}\nconst Components = { Pill: Good };`, "<Components.Pill items={items} />")],
  ["member-expression tag, shorthand member: { Good } -> <Components.Good />", propsFixture(`${GOOD_C}\nconst Components = { Good };`, "<Components.Good items={items} />")],
  ["member-expression tag, inline component value", propsFixture(`const Components = { Pill: ({ items }) => ${EMERALD_ITEMS} };`, "<Components.Pill items={items} />")],
  ["member-expression tag whose object member is unresolvable is rejected", propsFixture(`${GOOD_C}\nconst Components = { Pill: useThing() };`, "<Components.Pill items={items} />")],
  ["bracket-accessed query field on a local query: q[\"data\"]", wrap2(`export function Page() {
  ${Q2}
  return <span className="text-emerald-400">{q["data"]?.n}</span>;
}`)],
  ["bracket-accessed query field on a propagated query object: query[\"data\"]", wrap2(`function Row({ query }) { return <span className="text-emerald-400">{query["data"]?.n}</span>; }
export function Page() {
  ${Q2}
  return <Row query={q} />;
}`)],
  ["bracket-accessed query field through props: props.query[\"data\"]", wrap2(`function Row(props) { return <span className="text-emerald-400">{props.query["data"]?.n}</span>; }
export function Page() {
  ${Q2}
  return <Row query={q} />;
}`)],
  ["an overload signature is not the component: the implementation is followed", propsFixture(`function Pill(props: { items: number[] }): JSX.Element;\nfunction Pill({ items }: { items: number[] }) { return ${EMERALD_ITEMS}; }`, "<Pill items={items} />")],
  ["helper parameter default supplies the good class: tone()", helperPage(`function tone(c = "text-emerald-400") { return c; }`, `<span className={tone()}>{q.data?.n}</span>`)],
  ["helper parameter default is used when the argument is undefined: tone(undefined)", helperPage(`function tone(c = "text-emerald-400") { return c; }`, `<span className={tone(undefined)}>{q.data?.n}</span>`)],
  ["render prop: query data reaches the callback parameter", wrap2(`${RENDER_PANEL}
export function Page() {
  ${Q2}
  return <Panel value={q.data?.n} render={(n) => <span className="text-emerald-400">{n}</span>} />;
}`)],
  ["children-as-function: query data reaches the callback parameter", wrap2(`function Panel({ value, children }) { return <div>{children(value)}</div>; }
export function Page() {
  ${Q2}
  return <Panel value={q.data?.n}>{(n) => <span className="text-emerald-400">{n}</span>}</Panel>;
}`)],
  ["render prop called through props.render(props.value)", wrap2(`function Panel(props) { return <div>{props.render(props.value)}</div>; }
export function Page() {
  ${Q2}
  return <Panel value={q.data?.n} render={(n) => <span className="text-emerald-400">{n}</span>} />;
}`)],
  ["render prop given by a same-file function name", wrap2(`${RENDER_PANEL}
const renderRow = (n) => <span className="text-emerald-400">{n}</span>;
export function Page() {
  ${Q2}
  return <Panel value={q.data?.n} render={renderRow} />;
}`)],
);
OK_R6.push(
  ["conditionally selected components, both muted", propsFixture(`const Bad = ({ items }) => <span className="text-red-400">{items.length} rows</span>;\nconst Bad2 = ({ items }) => <span className="text-slate-400">{items.length} rows</span>;\nconst Pill = enabled ? Bad : Bad2;`, "<Pill items={items} />")],
  ["a logical selection of a muted component: enabled && Bad", propsFixture(`${GOOD_C}\nconst Pill = enabled && Bad;`, "<Pill items={items} />")],
  ["a nullish selection of muted components: Bad ?? Bad2", propsFixture(`${GOOD_C}\nconst Bad2 = ({ items }) => <span className="text-slate-400">{items.length} rows</span>;\nconst Pill = Bad ?? Bad2;`, "<Pill items={items} />")],
  ["conditionally selected components, call site guarded on the data", propsFixture(`${GOOD_C}\nconst Pill = enabled ? Good : Bad;`, "q.data ? <Pill items={items} /> : null")],
  ["an imported namespace member tag is the declared imported-component limitation, not rejected", propsFixture(``, "<UI.Pill items={items} />", `import * as UI from "./ui";`)],
  ["member-expression tag backed by a muted component", propsFixture(`${GOOD_C}\nconst Components = { Pill: Bad };`, "<Components.Pill items={items} />")],
  ["member-expression tag, call site guarded on the data", propsFixture(`${GOOD_C}\nconst Components = { Pill: Good };`, "q.data ? <Components.Pill items={items} /> : null")],
  ["bracket-accessed query field, call site guarded on the data", wrap2(`function Row({ query }) { return <span className="text-emerald-400">{query["data"]?.n}</span>; }
export function Page() {
  ${Q2}
  return q.data ? <Row query={q} /> : null;
}`)],
  ["an overloaded component, call site guarded on the data", propsFixture(`function Pill(props: { items: number[] }): JSX.Element;\nfunction Pill({ items }: { items: number[] }) { return ${EMERALD_ITEMS}; }`, "q.data ? <Pill items={items} /> : null")],
  ["helper parameter default is muted", helperPage(`function tone(c = "text-slate-400") { return c; }`, `<span className={tone()}>{q.data?.n}</span>`)],
  ["helper called with an explicit muted argument although the default is emerald", helperPage(`function tone(c = "text-emerald-400") { return c; }`, `<span className={tone("text-slate-400")}>{q.data?.n}</span>`)],
  ["render prop, call site guarded on the data", wrap2(`${RENDER_PANEL}
export function Page() {
  ${Q2}
  return q.data ? <Panel value={q.data.n} render={(n) => <span className="text-emerald-400">{n}</span>} /> : null;
}`)],
  ["render prop whose callback renders no data", wrap2(`${RENDER_PANEL}
export function Page() {
  ${Q2}
  return <Panel value={q.data?.n} render={() => <span className="text-emerald-400">ready</span>} />;
}`)],
);

// Round 32 (Codex pass 12 + coordinator): a member tag of a same-file object whose member is absent, computed, or hidden behind / under
// a spread is rejected when it receives unguarded query data; `.call` / `.apply` arguments are shifted before a parameter default
// applies (an unknown `.apply` argument list walks the default, fail-closed); a `var` component registers in its hoisted scope.
const NS_PRE = `${GOOD_C}`;
BUG_R6.push(
  ["a spread hides the namespace member: { ...{ Pill: Good } } -> <Components.Pill /> is rejected", propsFixture(`${NS_PRE}\nconst Components = { ...{ Pill: Good } };`, "<Components.Pill items={items} />")],
  ["a namespace object that has no such member is rejected", propsFixture(`${NS_PRE}\nconst Components = { Other: Bad };`, "<Components.Pill items={items} />")],
  ["a computed namespace key is not a known member and is rejected", propsFixture(`${NS_PRE}\nconst Components = { [k]: Good };`, "<Components.Pill items={items} />")],
  ["a later spread may override the namespace member and is rejected", propsFixture(`${NS_PRE}\nconst Components = { Pill: Bad, ...other };`, "<Components.Pill items={items} />")],
  ["tone.call(null) omits the argument after the shift: the emerald default applies", helperPage(`function tone(c = "text-emerald-400") { return c; }`, `<span className={tone.call(null)}>{q.data?.n}</span>`)],
  ["tone.apply(null, []) omits the argument: the emerald default applies", helperPage(`function tone(c = "text-emerald-400") { return c; }`, `<span className={tone.apply(null, [])}>{q.data?.n}</span>`)],
  ["tone.apply(null, args) has an unknown argument list: the default is walked (fail-closed)", helperPage(`function tone(c = "text-emerald-400") { return c; }`, `<span className={tone.apply(null, args)}>{q.data?.n}</span>`)],
  ["a var component in a nested block is registered in its hoisted scope", wrap2(`export function Page() {
  ${Q2}
  if (enabled) { var Pill = ({ n }) => <span className="text-emerald-400">{n}</span>; }
  return Pill ? <Pill n={q.data?.n} /> : null;
}`)],
);
OK_R6.push(
  ["a namespace member that is present and muted is followed and clean", propsFixture(`${NS_PRE}\nconst Components = { Pill: Bad };`, "<Components.Pill items={items} />")],
  ["a namespace object with an absent member, call site guarded on the data", propsFixture(`${NS_PRE}\nconst Components = { Other: Bad };`, "q.data ? <Components.Pill items={items} /> : null")],
  ["tone.call(null, explicit muted argument) replaces the emerald default", helperPage(`function tone(c = "text-emerald-400") { return c; }`, `<span className={tone.call(null, "text-slate-400")}>{q.data?.n}</span>`)],
  ["tone.apply(null, [explicit muted argument]) replaces the emerald default", helperPage(`function tone(c = "text-emerald-400") { return c; }`, `<span className={tone.apply(null, ["text-slate-400"])}>{q.data?.n}</span>`)],
  ["a var component in a nested block, call site guarded on the data", wrap2(`export function Page() {
  ${Q2}
  if (enabled) { var Pill = ({ n }) => <span className="text-emerald-400">{n}</span>; }
  return Pill && q.data ? <Pill n={q.data.n} /> : null;
}`)],
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
    if (!v.some((x) => x.kind === "good-class-on-unguarded-data" || x.kind === "unresolved-wrapper-on-unguarded-data")) { ok = false; console.error(`  FAIL — not caught: ${label}`); }
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
