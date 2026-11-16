#!/usr/bin/env node
// Console error-state gate — a SETTLED ERROR must never render as PENDING.
//
//   node scripts/check-console-error-states.mjs
//   node scripts/check-console-error-states.mjs --self-test
//   node scripts/check-console-error-states.mjs --scan <dir>   (diagnostic, see below)
//
// THE DEFECT, in one line: `{!q.data && <div>Loading…</div>}`. React Query settles a
// failed fetch with `data === undefined` and `isError === true`, so a bare negation of
// `.data` is TRUE forever after the request dies — and the operator reads "Loading…"
// over a control plane that answered, definitively, "no". Eight of these shipped in
// this console at once (AppResilience, SignalSourcing, GridConfig, Provisioning ×2,
// GridOverview, AppWorkflows, Dashboard). Golden rule 2 says an unknown signal must
// raise assurance, never lower it; a spinner over a dead backend does the opposite —
// it reads as "wait, it's coming" when the honest word is "it did not answer".
//
// THE PROPERTY, stated precisely so the boundary is not a matter of taste:
//
//   A JSX conditional whose TEST is a bare reference to a query result's data
//   (`q.data`, or a local bound to it), negated or not, and whose PENDING ARM renders
//   text matching /Loading|Checking|Validating|Evaluating/i, must sit in a component
//   that demonstrably reads the SETTLED-ERROR state of that same query.
//
// "That same query" is the whole point and the reason a looser rule was rejected. The
// obvious cheap version — "accept an isError/error/status reference anywhere in the
// enclosing component" — passes Dashboard.tsx, because Dashboard filters integration
// records on `i.status === "connected"`. A field named `status` on an unrelated
// object would have cleared the exact site the gate was written to catch. So the
// binding is resolved per query object, and the reference must be to THAT object.
//
// TWO ways a component can prove it reads the settled error, both accepted:
//   (i)  DIRECT — `Q.isError`, `Q.error` or `Q.status` appears in the component (or,
//        for a destructured `const { data, isError } = useX()`, the destructured
//        state alias is bound AND used somewhere beyond its own binding).
//   (ii) DERIVED — the query identifier appears inside a `const`/`let` declaration
//        statement that itself tests `.isError` / `.error` / `.status`. GridOverview
//        composes `const failed = ([[cov,"coverage"], …] as const).filter(([q]) =>
//        q.isError)…` — five queries whose error state is read through a destructured
//        lambda parameter, never as `cov.isError`. That is a correct, honest fix, and
//        a gate that flagged it would be the gate this repository keeps writing by
//        accident: one that punishes true code. Arm (ii) exists for exactly that.
//
// SCOPE, and what this gate does NOT claim. The test must be a BARE data reference.
// `seriesData?.series ? chart : "Loading chart..."` (Dashboard) is the same defect in
// spirit — a failed query renders the pending arm — but the test is a property path,
// not the query's settled-ness, and a general expression-reachability analysis is not
// something a text-scanning gate can honestly claim to do. Deeper paths are therefore
// OUT OF GATED SCOPE and named here so nobody reads a green run as "no page renders a
// pending word over an error". It says: no BARE data-negation does.
//
// SCOPE IS DERIVED. The files are every .ts/.tsx under the console's pages/ and
// components/ trees; the queries are every `const X = someCall(…)` whose `.data` the
// component reads, plus every `const { data … } = someCall(…)` destructure. Nothing
// about React Query, the generated client or the page list is hand-listed here — a
// hook renamed tomorrow is still found, because the derivation keys off `.data`.
//
// FAIL-CLOSED: floors on what the derivation found (files, query bindings, pending
// render sites). A parse that drifted into finding nothing must not pass green.
// SELF-TEST FIRST: the detector must flag planted violations of each shape and clear
// each correct shape, or the gate refuses to conclude anything.
//
// --scan <dir> replaces the console src root. It is a DIAGNOSTIC used to prove this
// gate fails on a tree that carries the defect (e.g. a checkout of the eight original
// sites); preflight and CI invoke the gate with no arguments, against the real tree.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_SRC = "artifacts/signalgrid-app/src";
const SCAN_SUBDIRS = ["pages", "components"];
const PENDING_RE = /Loading|Checking|Validating|Evaluating/i;
const STATE_RE = /\.(?:isError|error|status)\b/;

// Floors. Measured on the real tree, 2026-09-06: 47 files, 37 query bindings, 65
// pending-word render sites. Set well below those so ordinary editing never trips
// them, and high enough that a derivation which quietly stopped parsing cannot pass.
// Do NOT floor the count of pending CONDITIONALS judged: the correct fix for this
// defect is often to stop testing `.data` at all (switch to `isLoading`), which drives
// that number DOWN — a floor on it would punish the fix. The floors are on inputs.
const FLOOR_FILES = 30;
const FLOOR_QUERIES = 25;
const FLOOR_PENDING_SITES = 30;

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function walk(dir, exts) {
  const out = [];
  const rec = (d) => {
    for (const e of readdirSync(d).sort()) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) rec(p);
      else if (exts.some((x) => p.endsWith(x))) out.push(p);
    }
  };
  if (existsSync(dir)) rec(dir);
  return out;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const lineOf = (text, idx) => text.slice(0, idx).split("\n").length;
const countIn = (text, re) => (text.match(re) || []).length;

// ── scope carving ────────────────────────────────────────────────────────────
// Module-level `function Name(` / `const Name = … => {` where Name is capitalised
// (a React component). Bodies are brace-matched, so a helper declared after a
// component is its own scope rather than part of it.
function matchBrace(text, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i += 1) {
    const c = text[i];
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return text.length - 1;
}

function componentScopes(text) {
  const scopes = [];
  const decl =
    /(?:^|\n)(?:export\s+)?(?:function\s+([A-Z][A-Za-z0-9_]*)\s*\(|const\s+([A-Z][A-Za-z0-9_]*)\s*(?::[^=\n]*)?=\s*(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*=>\s*\{)/g;
  let m;
  while ((m = decl.exec(text)) !== null) {
    const name = m[1] || m[2];
    const open = text.indexOf("{", m.index + m[0].length - 1);
    if (open === -1) continue;
    const close = matchBrace(text, open);
    scopes.push({ name, start: open, end: close, body: text.slice(open, close + 1) });
  }
  return scopes;
}

// ── balanced slicing ─────────────────────────────────────────────────────────
// Walk forward from `start`, tracking (), {} and [] depth. Stop on the closing
// bracket that would close an ENCLOSING group — for `{!q.data && <div>…</div>}`
// that is the `}` of the JSX expression container, which is exactly the rendered
// fallback's boundary.
function balancedSlice(text, start, limit = 20000) {
  let depth = 0;
  let i = start;
  const stop = Math.min(text.length, start + limit);
  for (; i < stop; i += 1) {
    const c = text[i];
    if (c === "(" || c === "{" || c === "[") depth += 1;
    else if (c === ")" || c === "}" || c === "]") {
      if (depth === 0) break;
      depth -= 1;
    }
  }
  return text.slice(start, i);
}

// Split `? A : B` starting at the `?`. Nested ternaries are tracked so
// `data ? (a ? b : c) : "Validating…"` and the unparenthesised
// `x ? a : y ? b : c` both split at the right colon.
function ternaryArms(text, qIdx, limit = 20000) {
  let depth = 0;
  let tern = 0;
  let colon = -1;
  let i = qIdx;
  const stop = Math.min(text.length, qIdx + limit);
  for (; i < stop; i += 1) {
    const c = text[i];
    if (c === "(" || c === "{" || c === "[") depth += 1;
    else if (c === ")" || c === "}" || c === "]") {
      if (depth === 0) break;
      depth -= 1;
    } else if (depth === 0 && c === "?") {
      if (text[i + 1] === "." || text[i + 1] === "?") i += 1;
      else tern += 1;
    } else if (depth === 0 && c === ":") {
      tern -= 1;
      if (tern === 0) {
        colon = i;
        break;
      }
    }
  }
  if (colon === -1) return null;
  return {
    trueArm: text.slice(qIdx + 1, colon),
    falseArm: balancedSlice(text, colon + 1, limit),
  };
}

// Every `const`/`let` declaration statement in a body, sliced to its terminating
// `;` at depth 0. Arm (ii) of the error-awareness test reads these.
function declStatements(body) {
  const out = [];
  const re = /\b(?:const|let)\s/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    let depth = 0;
    let i = m.index;
    for (; i < body.length && i < m.index + 2000; i += 1) {
      const c = body[i];
      if (c === "(" || c === "{" || c === "[") depth += 1;
      else if (c === ")" || c === "}" || c === "]") {
        if (depth === 0) break;
        depth -= 1;
      } else if (c === ";" && depth === 0) break;
    }
    out.push(body.slice(m.index, i));
  }
  return out;
}

// ── the analyser (shared by the self-test) ───────────────────────────────────
/**
 * @returns {{ findings: object[], queries: number, judged: number, pendingSites: number }}
 */
function analyse(file, text) {
  const findings = [];
  let queries = 0;
  let judged = 0;
  const scopes = componentScopes(text);

  for (const scope of scopes) {
    const body = scope.body;
    const decls = declStatements(body);
    const errorAwareDecl = decls.filter((d) => STATE_RE.test(d));

    // A query object: `const X = anyCall(…)` whose `.data` the component reads.
    const queryObjects = new Map(); // name → errorAware:boolean
    for (const m of body.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*[A-Za-z_$][\w$.]*\s*\(/g)) {
      const name = m[1];
      if (!new RegExp(`\\b${esc(name)}\\.data\\b`).test(body)) continue;
      const direct = new RegExp(`\\b${esc(name)}\\s*\\.\\s*(?:isError|error|status)\\b`).test(body);
      const derived = errorAwareDecl.some((d) => new RegExp(`\\b${esc(name)}\\b`).test(d));
      queryObjects.set(name, direct || derived);
    }

    // Data expressions: `X.data` for each query object, plus destructured data
    // locals, plus locals bound to a data expression (or a boolean chain of them).
    const dataExprs = new Map(); // expression text → errorAware:boolean
    for (const [name, aware] of queryObjects) dataExprs.set(`${name}.data`, aware);

    for (const m of body.matchAll(/\bconst\s*\{([^}]*)\}\s*=\s*[A-Za-z_$][\w$.]*\s*\(/g)) {
      const names = m[1].split(",").map((s) => s.trim()).filter(Boolean);
      let dataLocal = null;
      const stateLocals = [];
      for (const n of names) {
        const [key, alias] = n.split(":").map((s) => s.trim());
        const local = alias || key;
        if (key === "data") dataLocal = local;
        else if (/^(?:isError|error|status)$/.test(key)) stateLocals.push(local);
      }
      if (!dataLocal) continue;
      // Destructuring `isError` and never reading it is a claim with nothing behind
      // it, so the alias must appear beyond its own binding (the dead-nav idiom).
      const used = stateLocals.some((l) => countIn(body, new RegExp(`\\b${esc(l)}\\b`, "g")) > 1);
      const derived = errorAwareDecl.some((d) => new RegExp(`\\b${esc(dataLocal)}\\b`).test(d));
      dataExprs.set(dataLocal, used || derived);
    }

    // Alias locals — resolved twice so an alias of an alias lands.
    for (let pass = 0; pass < 2; pass += 1) {
      for (const m of body.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+);/g)) {
        const [, local, rhsRaw] = m;
        if (dataExprs.has(local)) continue;
        const rhs = rhsRaw.trim();
        const operands = rhs.split(/\s*(?:\|\||&&)\s*/).map((s) => s.trim());
        if (operands.length === 0 || !operands.every((o) => dataExprs.has(o))) continue;
        // Fail-closed on a composite: EVERY query behind it must be error-aware,
        // because any one of them failing is enough to make the pending word a lie.
        dataExprs.set(local, operands.every((o) => dataExprs.get(o)));
      }
    }
    queries += queryObjects.size;

    // Conditionals whose test is one of those expressions.
    for (const [expr, aware] of dataExprs) {
      const re = new RegExp(`(?<![\\w$.])(!\\s*)?${esc(expr)}\\s*(\\?(?![.?])|&&)`, "g");
      let m;
      while ((m = re.exec(body)) !== null) {
        const negated = Boolean(m[1]);
        const op = m[2];
        const opIdx = m.index + m[0].length - op.length;
        let region = null;
        if (op === "&&") {
          if (!negated) continue; // `data && <chart/>` is the happy arm, not a fallback
          region = balancedSlice(body, opIdx + 2);
        } else {
          const arms = ternaryArms(body, opIdx);
          if (!arms) continue;
          region = negated ? arms.trueArm : arms.falseArm;
        }
        if (!PENDING_RE.test(region)) continue;
        judged += 1;
        if (aware) continue;
        findings.push({
          file,
          line: lineOf(text, scope.start + m.index),
          component: scope.name,
          expr: `${negated ? "!" : ""}${expr}`,
          pending: (region.match(PENDING_RE) || [""])[0],
        });
      }
    }
  }
  return { findings, queries, judged, pendingSites: countIn(text, new RegExp(PENDING_RE.source, "gi")) };
}

// ── self-test ────────────────────────────────────────────────────────────────
let selfTestShapes = 0;
{
  const cases = [
    {
      name: "planted `{!q.data && <div>Loading…</div>}` with no error reference is FLAGGED",
      src: `export function Bad() {
  const q = useQuery({ queryKey: ["a"], queryFn: load });
  return <div>{!q.data && <div>Loading…</div>}</div>;
}`,
      want: 1,
    },
    {
      name: "the same site with `q.isError ? … : …` inside the fallback is CLEAR",
      src: `export function Good() {
  const q = useQuery({ queryKey: ["a"], queryFn: load });
  return <div>{!q.data && <div>{q.isError ? "did not answer" : "Loading…"}</div>}</div>;
}`,
      want: 0,
    },
    {
      name: "isLoading paired with isError (no bare data test at all) is CLEAR",
      src: `export function Paired() {
  const { data, isLoading, isError } = useThing();
  return <div>{isLoading ? <p>Loading…</p> : isError ? <p>failed</p> : <p>{data.x}</p>}</div>;
}`,
      want: 0,
    },
    {
      name: "a ternary whose FALSE arm is a pending word is FLAGGED (the GridConfig shape)",
      src: `export function Tern() {
  const q = useQuery({ queryKey: ["c"], queryFn: load });
  const data = q.data;
  return <h1>{data ? (data.valid ? "valid" : "invalid") : "Validating…"}</h1>;
}`,
      want: 1,
    },
    {
      name: "…and clears once the nested ternary reads q.isError",
      src: `export function TernFixed() {
  const q = useQuery({ queryKey: ["c"], queryFn: load });
  const data = q.data;
  return <h1>{data ? (data.valid ? "valid" : "invalid") : q.isError ? "no verdict" : "Validating…"}</h1>;
}`,
      want: 0,
    },
    {
      name: "an error reference to a DIFFERENT query does not clear this one (the AppWorkflows shape)",
      src: `export function Other() {
  const list = useQuery({ queryKey: ["l"], queryFn: load });
  const plan = useQuery({ queryKey: ["p"], queryFn: load2 });
  return <div>{plan.isLoading && <p>x</p>}{plan.error && <p>y</p>}{!list.data && <div>Loading catalog…</div>}{list.data}</div>;
}`,
      want: 1,
    },
    {
      name: "an unrelated field literally named `status` does not clear it (the Dashboard trap)",
      src: `export function Trap() {
  const { data: rows } = useListThings();
  return <div>{rows ? rows.filter(i => i.status === "connected").length : <p>Loading...</p>}</div>;
}`,
      want: 1,
    },
    {
      name: "a composite local over five queries, error-read through a lambda, is CLEAR (the GridOverview shape)",
      src: `export function Composite() {
  const cov = useQuery({ queryKey: ["a"], queryFn: l1 });
  const src = useQuery({ queryKey: ["b"], queryFn: l2 });
  const anyLoaded = cov.data || src.data;
  const failed = ([[cov, "coverage"], [src, "sourcing"]]).filter(([q]) => q.isError).map(([, n]) => n);
  return <p>{failed.length > 0 ? <span>down</span> : !anyLoaded ? <span>Loading the grid…</span> : <span>ok</span>}</p>;
}`,
      want: 0,
    },
    {
      name: "the same composite WITHOUT the error read is FLAGGED",
      src: `export function CompositeBad() {
  const cov = useQuery({ queryKey: ["a"], queryFn: l1 });
  const src = useQuery({ queryKey: ["b"], queryFn: l2 });
  const anyLoaded = cov.data || src.data;
  return <p>{!anyLoaded ? <span>Loading the grid…</span> : <span>ok</span>}</p>;
}`,
      want: 1,
    },
    {
      name: "a non-pending fallback (`\"-\"`, `\"Reading…\"`) is not a finding — this gate judges pending words only",
      src: `export function NotPending() {
  const q = useQuery({ queryKey: ["a"], queryFn: load });
  return <div>{!q.data ? <span>Reading the grid…</span> : <span>{q.data.x}</span>}{!q.data && <span>-</span>}</div>;
}`,
      want: 0,
    },
    {
      name: "a destructured isError that is bound and never used does NOT clear the site",
      src: `export function Unused() {
  const { data: rows, isError } = useListThings();
  return <div>{rows ? <p>{rows.length}</p> : <p>Loading...</p>}</div>;
}`,
      want: 1,
    },
  ];
  const failures = [];
  for (const c of cases) {
    const got = analyse("selftest.tsx", c.src).findings.length;
    if (got !== c.want) failures.push(`${c.name} — expected ${c.want} finding(s), got ${got}`);
  }
  // Derivation controls: the pieces the analysis is built out of must still work.
  if (componentScopes("export function A() {\n  return 1;\n}\nfunction B() {\n  return 2;\n}\n").length !== 2) {
    failures.push("componentScopes no longer carves two module-level components");
  }
  if (!declStatements("const failed = xs.filter(([q]) => q.isError).map(f);\n").some((d) => STATE_RE.test(d))) {
    failures.push("declStatements no longer captures a declaration whose error read is inside a lambda");
  }
  const arms = ternaryArms(" ? (a ? b : c) : \"Validating…\"", 1);
  if (!arms || !PENDING_RE.test(arms.falseArm) || PENDING_RE.test(arms.trueArm)) {
    failures.push("ternaryArms no longer splits a nested ternary at the outer colon");
  }
  selfTestShapes = cases.length;
  if (failures.length > 0) {
    for (const f of failures) console.error(`  ✗ ${f}`);
    fail("SELF-TEST FAILED: the error-state detector no longer flags its synthetic violations. A gate that cannot fail proves nothing.");
  }
}

if (process.argv.includes("--self-test")) {
  console.log(`check-console-error-states self-test passed (${selfTestShapes} shapes: planted violations flagged, correct shapes clear).`);
  process.exit(0);
}

// ── run ──────────────────────────────────────────────────────────────────────
const scanIdx = process.argv.indexOf("--scan");
const SRC = scanIdx !== -1 ? process.argv[scanIdx + 1] : DEFAULT_SRC;
const diagnostic = scanIdx !== -1;
if (!existsSync(SRC)) fail(`${SRC} missing — the console source moved; fix this derivation, do not silently scan nothing.`);

const files = SCAN_SUBDIRS.flatMap((d) => walk(join(SRC, d), [".ts", ".tsx"]));
if (files.length === 0) fail(`no .ts/.tsx files under ${SCAN_SUBDIRS.map((d) => join(SRC, d)).join(", ")} — the derivation is broken, not the console empty.`);

let queries = 0;
let judged = 0;
let pendingSites = 0;
const findings = [];
for (const f of files) {
  const text = readFileSync(f, "utf8");
  const r = analyse(f, text);
  queries += r.queries;
  judged += r.judged;
  pendingSites += r.pendingSites;
  findings.push(...r.findings);
}

if (!diagnostic) {
  if (files.length < FLOOR_FILES) fail(`only ${files.length} console file(s) scanned (floor ${FLOOR_FILES}) — the file walk is finding less than the tree holds.`);
  if (queries < FLOOR_QUERIES) fail(`only ${queries} query binding(s) derived (floor ${FLOOR_QUERIES}) — the "const X = call(…)" + "X.data" derivation has drifted; a gate scanning nothing is green about nothing.`);
  if (pendingSites < FLOOR_PENDING_SITES) fail(`only ${pendingSites} pending-word render site(s) found (floor ${FLOOR_PENDING_SITES}) — the pending-copy scan has drifted.`);
}

console.log(
  `check-console-error-states: ${files.length} file(s), ${queries} query binding(s), ` +
    `${judged} pending conditional(s) judged, ${pendingSites} pending-word site(s) seen; self-test green` +
    (diagnostic ? ` [DIAGNOSTIC --scan ${SRC}; floors not applied]` : ""),
);

if (findings.length > 0) {
  for (const f of findings) {
    console.error(
      `  ✗ ${f.file}:${f.line} — <${f.component}> renders "${f.pending}…" on \`${f.expr}\`, ` +
        `but nothing in the component reads that query's isError/error/status. A settled error would read as pending.`,
    );
  }
  console.error(
    `\nConsole error-state gate FAILED — ${findings.length} site(s) render a pending word over a query that may have SETTLED with an error.\n` +
      "Fix the state, never the sentence: give the failure its own arm (isError/error/status). Do not delete the honest 'Loading…' copy for the case that really is loading.",
  );
  process.exit(1);
}
console.log("Console error-state gate passed — every bare data-negation rendering a pending word also reads that query's settled-error state.");
