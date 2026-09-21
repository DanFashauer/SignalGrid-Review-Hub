// check-console-unknown-render — the unknown-as-good-state gate for the admin console.
//
//   node scripts/check-console-unknown-render.mjs             the guard
//   node scripts/check-console-unknown-render.mjs --self-test prove the guard can fail (and can pass)
//
// WHY THIS EXISTS
// ---------------
// CLAUDE.md golden rule 2 is fail-closed: an unknown / unreachable signal must
// RAISE the assurance requirement, never lower it — and it must never be PAINTED as
// a good state. The admin console (`artifacts/signalgrid-app`) reads the control
// plane through react-query. When a query has not answered yet, has errored, or
// returned nothing, its `data` is undefined; a component that renders a POSITIVE
// CONCLUSION about the system on that absent data — an emerald "good" colour or a
// reassuring phrase ("no stale signals", "all clear", "healthy") — tells the admin
// everything is fine when the truth is *we do not know*. That is the G2 defect from
// the 2026-09-02 console batch (SignalSourcing / AppResilience were fixed to gate
// their metrics on data presence; Dashboard gates on a destructured error).
//
// WHY A NAIVE REGEX WAS REFUSED (BUILD_BACKLOG, "SPEC ONLY, deferred")
// -------------------------------------------------------------------
// The doctrine-correct fix gates the good state on DATA PRESENCE (`data ? good :
// muted`), not on `.isError`. A text scan for "emerald && never references .isError"
// flagged 9 files, most of them correct code — `emerald` is also a static category
// colour (a legend, a label) that says nothing about live state, and correct files
// gate on a destructured `error:` the `.error` probe cannot see. A gate at that
// false-positive rate teaches authors to sprinkle `// unknown-ok:` on correct code.
//
// WHAT THIS GATE DOES INSTEAD (a small AST data-flow, not a text scan)
// -------------------------------------------------------------------
// For each `.tsx` under the console `src/` that uses a query hook (`useQuery` or a
// generated `useGet…`/`useList…` hook that yields `{ data, isError, … }`):
//   1. It collects the query result identifiers: the query-object var (`const q =
//      useQuery(…)`), the destructured `data`/`isError`/`isLoading`/`error` vars,
//      and any var DERIVED from query data (`const s = q.data?.x ?? []`), transitively.
//   2. It finds good-state markers: a className string/template containing `emerald`
//      or `status-allow`, or JSX text / a string literal matching an affirmation
//      phrase (see AFFIRMATIONS).
//   3. A marker is HANDLED — and never flagged — when it is lexically enclosed by a
//      conditional (ternary / `&&` / `if`) whose TEST references one of those query
//      data / derived / status identifiers (or a `.data`/`.isError`/… member of the
//      query object). This is the data-presence / error gating the doctrine wants,
//      and it is exactly what the fixed files do.
//   4. An UNHANDLED marker is a VIOLATION only if it actually renders a positive
//      conclusion about live state: an affirmation PHRASE (always a conclusion), or
//      an emerald/status-allow class on a JSX element whose own subtree renders
//      query-derived data (a data var, `.data`, or a `?? []`/`?? {}`/`?? 0`/`?? ""`
//      nullish fallback). A static emerald category colour — no data in its element,
//      no phrase — is NOT a conclusion and is left to the doctrine review.
// Exempt a specific occurrence with a `// unknown-ok: <reason>` comment on its line
// or the line above.
//
// The gate reads the real component tree; it is not calibrated to a fixed count.
// `--self-test` plants a bug shape (must flag) and a data-presence-gated shape
// (must not), and fails if either verdict is wrong — the check can itself fail.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import ts from "typescript";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const CONSOLE_SRC = join(REPO, "artifacts", "signalgrid-app", "src");

// Affirmation phrases: textual POSITIVE CONCLUSIONS about live state. Kept tight to
// avoid false positives — each asserts "things are fine", which is a lie on unknown data.
const AFFIRMATIONS = [
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
  // "no <thing(s)> found/pending/detected/outstanding/reported"
  /\bno\s+[\w-]+(\s+[\w-]+){0,3}\s+(found|pending|detected|outstanding|reported|to review)\b/i,
];

// className tokens that signal a GOOD/allow visual state.
const GOOD_CLASS = /\b(emerald|status-allow)\b/;

// Status members on a query object that mean the code is reasoning about the query's
// success/error/loading — referencing any of these in a test HANDLES the render.
const STATUS_MEMBERS = new Set([
  "isError", "error", "isLoading", "isPending", "isFetching", "isSuccess", "data", "status", "failureReason",
]);
// Destructured names from a query hook that are data or status bindings.
const QUERY_DESTRUCTURE = new Set([...STATUS_MEMBERS]);

function isQueryHookCall(node) {
  // useQuery(...) / useQueries / useInfiniteQuery, or a generated hook use<Name>(...)
  if (!node || !ts.isCallExpression(node)) return false;
  let name;
  if (ts.isIdentifier(node.expression)) name = node.expression.text;
  else if (ts.isPropertyAccessExpression(node.expression)) name = node.expression.name.text;
  if (!name) return false;
  if (name === "useQuery" || name === "useQueries" || name === "useInfiniteQuery" || name === "useSuspenseQuery") return true;
  // generated query hooks: use<Name>(...) — accept only when its binding destructures a query field.
  return /^use[A-Z]/.test(name);
}

function collectStrings(node, out) {
  // Gather string content from className expressions and JSX text under `node`.
  const visit = (n) => {
    if (!n) return;
    if (ts.isStringLiteralLike(n)) out.push(n.text);
    else if (ts.isTemplateExpression(n)) {
      out.push(n.head.text);
      for (const span of n.templateSpans) out.push(span.literal.text);
    } else if (ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text);
    else if (ts.isJsxText(n)) out.push(n.text);
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

function analyzeSourceFile(relPath, text) {
  const sf = ts.createSourceFile(relPath, text, ts.ScriptTarget.Latest, /*setParentNodes*/ true, ts.ScriptKind.TSX);

  // ---- pass 1: identifiers that are query objects, data, derived-from-data, or status ----
  const queryObjVars = new Set();   // const q = useQuery(...)
  const dataVars = new Set();        // destructured `data` vars + derived vars
  const statusVars = new Set();      // destructured isError/error/isLoading/... vars
  let usesQueryHook = false;

  const noteVarDecl = (decl) => {
    if (!ts.isVariableDeclaration(decl) || !decl.initializer) return;
    const init = decl.initializer;
    if (isQueryHookCall(init)) {
      usesQueryHook = true;
      if (ts.isIdentifier(decl.name)) {
        queryObjVars.add(decl.name.text);
      } else if (ts.isObjectBindingPattern(decl.name)) {
        for (const el of decl.name.elements) {
          const prop = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text
            : ts.isIdentifier(el.name) ? el.name.text : undefined;
          const local = ts.isIdentifier(el.name) ? el.name.text : undefined;
          if (!prop || !local) continue;
          if (prop === "data") dataVars.add(local);
          else if (QUERY_DESTRUCTURE.has(prop)) statusVars.add(local);
        }
      }
    }
  };
  const firstPass = (n) => { if (ts.isVariableDeclaration(n)) noteVarDecl(n); ts.forEachChild(n, firstPass); };
  firstPass(sf);

  if (!usesQueryHook) return { usesQueryHook: false, violations: [] };

  // referencesData: does subtree reference a query object var, a data/status var,
  // or a `.data`/`.isError`/… member of a query object?
  const identifierInSet = (n, sets) => {
    let hit = false;
    const walk = (x) => {
      if (hit || !x) return;
      if (ts.isIdentifier(x) && sets.some((s) => s.has(x.text))) { hit = true; return; }
      if (ts.isPropertyAccessExpression(x) && ts.isIdentifier(x.expression) &&
          queryObjVars.has(x.expression.text) && STATUS_MEMBERS.has(x.name.text)) { hit = true; return; }
      ts.forEachChild(x, walk);
    };
    walk(n);
    return hit;
  };
  const referencesQueryState = (n) => identifierInSet(n, [queryObjVars, dataVars, statusVars]);

  // ---- pass 2: derived-from-data vars, to a fixpoint ----
  // const s = <expr referencing a data var / queryObj.data> → s is a data var.
  for (let changed = true, guard = 0; changed && guard < 8; guard++) {
    changed = false;
    const p2 = (n) => {
      if (ts.isVariableDeclaration(n) && n.initializer && ts.isIdentifier(n.name) && !dataVars.has(n.name.text)) {
        if (referencesQueryState(n.initializer)) { dataVars.add(n.name.text); changed = true; }
      }
      ts.forEachChild(n, p2);
    };
    p2(sf);
  }

  // ---- exemptions: `// unknown-ok:` on a line ----
  const lines = text.split("\n");
  const exemptLine = (lineIdx0) => {
    const here = lines[lineIdx0] ?? "";
    const above = lines[lineIdx0 - 1] ?? "";
    return /\/\/\s*unknown-ok:/.test(here) || /\/\/\s*unknown-ok:/.test(above);
  };

  // ---- is a marker node lexically HANDLED by a data/status conditional? ----
  const isHandled = (node) => {
    let cur = node.parent;
    while (cur && !ts.isSourceFile(cur)) {
      if (ts.isConditionalExpression(cur) && referencesQueryState(cur.condition)) return true;
      if (ts.isIfStatement(cur) && referencesQueryState(cur.expression)) return true;
      if (ts.isBinaryExpression(cur) &&
          (cur.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
           cur.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
           cur.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) {
        if (referencesQueryState(cur.left)) return true;
      }
      cur = cur.parent;
    }
    return false;
  };

  // Does this JSX element's subtree render a query-data value that is NOT itself
  // presence-gated? An emerald class is a live "good" CONCLUSION only when the data
  // it decorates can be shown while absent/unknown. A static category colour over a
  // value that is independently gated (`s ? String(x) : "-"`) is not a conclusion.
  const elementHasUnguardedDataRender = (jsxElement) => {
    let hit = false;
    const walk = (x) => {
      if (hit || !x) return;
      // a nullish data fallback rendered here (masks unknown as [] / 0 / "")
      if (ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken &&
          referencesQueryState(x.left) && !isHandled(x)) { hit = true; return; }
      // a bare data / derived var reference, or queryObj.data member, not under a presence test
      if (ts.isIdentifier(x) && (dataVars.has(x.text) || queryObjVars.has(x.text)) && !isHandled(x)) { hit = true; return; }
      if (ts.isPropertyAccessExpression(x) && ts.isIdentifier(x.expression) &&
          queryObjVars.has(x.expression.text) && x.name.text === "data" && !isHandled(x)) { hit = true; return; }
      ts.forEachChild(x, walk);
    };
    walk(jsxElement);
    return hit;
  };

  // the specific string / template node that carries a GOOD_CLASS token (so that a
  // ternary WRAPPING it — `accent={s ? "emerald" : x}` — is an ANCESTOR we can see).
  const goodClassStringNodes = (attr) => {
    const nodes = [];
    const walk = (x) => {
      if (!x) return;
      if ((ts.isStringLiteralLike(x) || ts.isNoSubstitutionTemplateLiteral(x)) && GOOD_CLASS.test(x.text)) nodes.push(x);
      if (ts.isTemplateExpression(x)) {
        if (GOOD_CLASS.test(x.head.text)) nodes.push(x);
        for (const span of x.templateSpans) if (GOOD_CLASS.test(span.literal.text)) nodes.push(x);
      }
      ts.forEachChild(x, walk);
    };
    walk(attr);
    return nodes;
  };

  // nearest enclosing JSX element/self-closing element (for emerald class attribution)
  const enclosingJsxElement = (node) => {
    let cur = node;
    while (cur && !ts.isSourceFile(cur)) {
      if (ts.isJsxElement(cur) || ts.isJsxSelfClosingElement(cur)) return cur;
      cur = cur.parent;
    }
    return undefined;
  };

  const posLine = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;

  const violations = [];
  const seen = new Set();
  const report = (node, kind, snippet) => {
    const line = posLine(node);
    const key = `${line}:${kind}`;
    if (seen.has(key)) return;
    if (exemptLine(line)) return;
    seen.add(key);
    violations.push({ line: line + 1, kind, snippet: snippet.trim().slice(0, 80) });
  };

  // ---- pass 3: find markers, classify ----
  const p3 = (n) => {
    // Affirmation phrases in JSX text or string literals.
    if (ts.isJsxText(n) || ts.isStringLiteralLike(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      const t = n.text;
      if (t && AFFIRMATIONS.some((re) => re.test(t)) && !isHandled(n)) {
        report(n, "affirmation-phrase", t.replace(/\s+/g, " "));
      }
    }
    // Good-state className on a JSX attribute.
    if (ts.isJsxAttribute(n) && ts.isIdentifier(n.name) &&
        (n.name.text === "className" || n.name.text === "accent" || n.name.text === "dot" || n.name.text === "text")) {
      for (const strNode of goodClassStringNodes(n)) {
        // A good class is a violation only when it is NOT chosen by a data/status
        // conditional AND its element renders query data that is not presence-gated.
        if (isHandled(strNode)) continue;
        const el = enclosingJsxElement(n);
        if (el && elementHasUnguardedDataRender(el)) {
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
    const st = statSync(full);
    if (st.isDirectory()) walkTsx(full, acc);
    else if (entry.endsWith(".tsx")) acc.push(full);
  }
  return acc;
}

function runOverTree() {
  const files = walkTsx(CONSOLE_SRC, []);
  const all = [];
  for (const f of files) {
    const rel = relative(REPO, f);
    const { usesQueryHook, violations } = analyzeSourceFile(rel, readFileSync(f, "utf8"));
    if (usesQueryHook && violations.length) all.push({ file: rel, violations });
  }
  return all;
}

// ---------------- self-test ----------------
const BUG_FIXTURE = `
import { useQuery } from "@tanstack/react-query";
export function Broken() {
  const q = useQuery({ queryKey: ["x"], queryFn: fetchThing });
  const items = q.data?.items ?? [];
  return (
    <div>
      <span className="text-emerald-400">{items.length} healthy</span>
      <div>No stale or non-compliant signals</div>
      <Metric accent="text-emerald-400" value={String(items.length)} />
    </div>
  );
}
`;
const OK_FIXTURE = `
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
    </div>
  );
}
`;

function selfTest() {
  let ok = true;
  const bug = analyzeSourceFile("BUG.tsx", BUG_FIXTURE);
  const bugKinds = new Set(bug.violations.map((v) => v.kind));
  // the ungated emerald-on-data span, the ungated phrase must both flag
  const bugFlaggedPhrase = bug.violations.some((v) => v.kind === "affirmation-phrase");
  const bugFlaggedClass = bug.violations.some((v) => v.kind === "good-class-on-unguarded-data");
  console.log(`  self-test BUG.tsx → ${bug.violations.length} violation(s): ${[...bugKinds].join(", ") || "none"}`);
  if (!bugFlaggedPhrase) { console.error("  FAIL — an ungated affirmation phrase was NOT flagged"); ok = false; }
  if (!bugFlaggedClass) { console.error("  FAIL — an ungated emerald-on-live-data class was NOT flagged"); ok = false; }

  const fine = analyzeSourceFile("OK.tsx", OK_FIXTURE);
  console.log(`  self-test OK.tsx → ${fine.violations.length} violation(s)`);
  if (fine.violations.length !== 0) {
    ok = false;
    console.error("  FAIL — a data-presence-gated component was flagged (false positive):");
    for (const v of fine.violations) console.error(`    line ${v.line} [${v.kind}] ${v.snippet}`);
  }

  // Plant an unknown-as-good defect into a REAL console component and watch it fail:
  // drop the `s ?` presence guard on a metric that carries a static emerald accent,
  // exactly the G2 regression. The unmutated file must stay clean.
  const REAL = join(CONSOLE_SRC, "pages", "SignalSourcing.tsx");
  const GUARDED = `value={s ? String(s.vendorIntegrated) : "-"} accent="text-emerald-400"`;
  const PLANTED = `value={String(s.vendorIntegrated)} accent="text-emerald-400"`;
  let realText;
  try { realText = readFileSync(REAL, "utf8"); } catch { realText = null; }
  if (!realText || !realText.includes(GUARDED)) {
    ok = false;
    console.error(`  FAIL — plant anchor not found in ${relative(REPO, REAL)}; update the self-test anchor.`);
  } else {
    const realClean = analyzeSourceFile(relative(REPO, REAL), realText);
    if (realClean.violations.length !== 0) {
      ok = false;
      console.error("  FAIL — the real SignalSourcing.tsx flagged unmutated (false positive):");
      for (const v of realClean.violations) console.error(`    line ${v.line} [${v.kind}] ${v.snippet}`);
    }
    const planted = analyzeSourceFile(relative(REPO, REAL), realText.replace(GUARDED, PLANTED));
    const caught = planted.violations.some((v) => v.kind === "good-class-on-unguarded-data");
    console.log(`  self-test PLANT (real component, presence guard removed) → ${planted.violations.length} violation(s)`);
    if (!caught) { ok = false; console.error("  FAIL — the planted unguarded emerald render was NOT caught"); }
  }
  return ok;
}

// ---------------- main ----------------
const mode = process.argv.includes("--self-test") ? "self-test" : "gate";
if (mode === "self-test") {
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
