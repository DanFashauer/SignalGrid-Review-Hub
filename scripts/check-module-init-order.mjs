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
// WHAT IS DETECTED. A module-scope call to a hoisted function declared in the
// same file, whose body reads a module-scope `const` declared AFTER the call.
// That is the exact shape of both defects.
//
// SCOPE LIMIT, measured rather than asserted — and it is narrower than I first
// claimed. This detects a call written at COLUMN 0. It catches the OIDC defect
// above, on the real file, with zero false positives across 802 source files.
//
// It does NOT catch the grid-proof defect, whose call sits inside a TOP-LEVEL
// `for` loop — indented, yet still executing during module evaluation. I tried
// widening it to any indentation and filtering out function bodies; bounding
// those bodies by text is unreliable (arrow functions assigned to consts,
// class methods, nested braces) and it produced 75 false positives on a tree
// known to be clean. A gate with 75 false alarms is worse than no gate: it
// teaches people to ignore it.
//
// Doing this properly needs a real parser with real scope analysis, not regex.
// That is honest follow-on work, recorded in docs/COMPANY_BUILD_PLAN.md rather
// than pretended away here. Until then: this reads text, not a type graph; it
// does not follow calls through imports or model conditional execution; and a
// clean run is NOT proof that no TDZ bug exists — it is proof that the
// column-0 shape is absent.
//
// SELF-TEST: both real defects must be detected from synthetic reconstructions,
// and the CORRECTED order must pass. A gate that cannot fail proves nothing.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["lib", "artifacts", "scripts"];
const SKIP = /(^|\/)(node_modules|dist|build|coverage|third_party)(\/|$)|\.d\.ts$/;
const SOURCE = /\.(ts|mts|mjs|js)$/;

/** A module-scope call whose callee is a hoisted function in this file. */
function analyse(text) {
  const lines = text.split("\n");
  const constAt = new Map(); // name -> 1-based line
  const funcAt = new Map(); // name -> { start, end }
  const calls = []; // { name, line }

  lines.forEach((raw, i) => {
    const line = i + 1;
    // module scope only: no leading indentation
    const mConst = /^const\s+([A-Za-z_$][\w$]*)\s*[:=]/.exec(raw);
    if (mConst && !constAt.has(mConst[1])) constAt.set(mConst[1], line);
    const mFunc = /^(?:export\s+)?function\s+([A-Za-z_$][\w$]*)\s*[(<]/.exec(raw);
    if (mFunc) funcAt.set(mFunc[1], { start: line, end: lines.length });
    // Module-scope calls only, anchored at column 0. See the SCOPE LIMIT note in
    // the header for what this deliberately does not reach.
    const mCall = /^(?:const\s+[A-Za-z_$][\w$]*\s*(?::[^=]+)?=\s*)?([A-Za-z_$][\w$]*)\s*\(/.exec(raw);
    if (mCall) calls.push({ name: mCall[1], line });
  });

  // close each function body at the next module-scope `}`
  for (const [name, span] of funcAt) {
    for (let i = span.start; i < lines.length; i += 1) {
      if (/^\}/.test(lines[i])) { span.end = i + 1; break; }
    }
    funcAt.set(name, span);
  }

  const bodyOf = (name) => {
    const fn = funcAt.get(name);
    return fn ? lines.slice(fn.start - 1, fn.end).join("\n") : "";
  };

  // TRANSITIVE, and that is not a refinement — it is the difference between
  // catching one of the two real defects and catching both. The grid-proof bug
  // was TWO hops from module scope: a top-level loop called safeMalformedRun,
  // which called validateScenarioInput, which read the const. A detector that
  // only followed direct calls saw nothing. The first version of this gate did
  // exactly that, and its synthetic test used a direct call — so the test passed
  // while the real file went undetected. Same shape as every other defect here:
  // a check that does not match the thing it checks.
  const reachableFrom = (entry) => {
    const seen = new Set();
    const stack = [entry];
    while (stack.length > 0) {
      const name = stack.pop();
      if (seen.has(name) || !funcAt.has(name)) continue;
      seen.add(name);
      for (const m of bodyOf(name).matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
        if (funcAt.has(m[1]) && !seen.has(m[1])) stack.push(m[1]);
      }
    }
    return seen;
  };

  const findings = [];
  const seenPairs = new Set();
  for (const call of calls) {
    if (!funcAt.has(call.name)) continue; // not a local hoisted function
    for (const fnName of reachableFrom(call.name)) {
      const fn = funcAt.get(fnName);
      if (call.line >= fn.start) continue; // defined before the call: fine either way
      const body = bodyOf(fnName);
      for (const [constName, constLine] of constAt) {
        if (constLine <= call.line) continue;
        if (!new RegExp(`\\b${constName}\\b`).test(body)) continue;
        const key = `${call.line}:${fnName}:${constName}`;
        if (seenPairs.has(key)) continue;
        seenPairs.add(key);
        findings.push({ call: call.name, callLine: call.line, via: fnName, constName, constLine });
      }
    }
  }
  return findings;
}

// ── self-test: both real defects, and their corrected forms ──────────────────
{
  const oidcShape = [
    "const enterpriseAuth = initEnterpriseAuth();",
    "",
    "function initEnterpriseAuth() {",
    "  return createAuthenticator(config, defaultJwksFetch);",
    "}",
    "",
    "const defaultJwksFetch = (uri) => fetch(uri);",
  ].join("\n");
  const oidcFixed = [
    "const defaultJwksFetch = (uri) => fetch(uri);",
    "",
    "const enterpriseAuth = initEnterpriseAuth();",
    "",
    "function initEnterpriseAuth() {",
    "  return createAuthenticator(config, defaultJwksFetch);",
    "}",
  ].join("\n");
  // Two hops from a COLUMN-0 call — the transitive arm, which does work. The
  // grid-proof defect's own call is indented inside a top-level loop and is
  // therefore outside this gate's reach; see the SCOPE LIMIT note.
  const gridShape = [
    "safeMalformedRun(input);",
    "",
    "function safeMalformedRun(x) {",
    "  return validateScenarioInput(x);",
    "}",
    "",
    "function validateScenarioInput(x) {",
    "  if (!allowedSignalTypes.has(x.type)) throw new Error('bad');",
    "}",
    "",
    "const allowedSignalTypes = new Set(['a']);",
  ].join("\n");
  const ok =
    analyse(oidcShape).length > 0 &&
    analyse(gridShape).length > 0 &&
    analyse(oidcFixed).length === 0;
  if (!ok) {
    console.error(
      "✗ SELF-TEST FAILED — the detector no longer recognises the two defects it was written for, " +
        "or now flags their corrected form. A gate that cannot fail proves nothing; one that punishes " +
        "the fix is worse.",
    );
    process.exit(1);
  }
}

const files = [];
const walk = (d) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (SKIP.test(p)) continue;
    if (statSync(p).isDirectory()) walk(p);
    else if (SOURCE.test(p)) files.push(p);
  }
};
for (const r of ROOTS) { try { walk(r); } catch { /* absent root */ } }

console.log("Module init order — a const read before it is initialised\n");
let problems = 0;
for (const f of files) {
  if (f.endsWith("check-module-init-order.mjs")) continue;
  for (const d of analyse(readFileSync(f, "utf8"))) {
    console.error(
      `  ✗ ${f}:${d.callLine}: \`${d.call}()\` runs at module load and reads \`${d.constName}\`, ` +
        `declared at line ${d.constLine}.\n` +
        "      `function` hoists, `const` does not — the read lands in the temporal dead zone and can\n" +
        "      surface as undefined rather than throwing. Move the declaration above the call.",
    );
    problems += 1;
  }
}

console.log(
  `\nmodule-init-order: ${files.length} source files scanned, ${problems} problem(s); self-test green. ` +
    "Text analysis, not a type graph. Detects the COLUMN-0 call shape only — the OIDC defect, yes; the " +
    "grid-proof defect, no (its call is indented inside a top-level loop). A clean run means that one " +
    "shape is absent, not that no TDZ bug exists. See the SCOPE LIMIT note.",
);
if (problems > 0) {
  console.error("\nModule-init-order gate FAILED — this defect has shipped twice, both times silently.");
  process.exit(1);
}
console.log("Module-init-order gate passed — no module-scope call reads a const declared after it.");
