#!/usr/bin/env node
// Mutation run for scripts/lib/clock-spellings.mjs: each entry changes ONE piece of the shared matcher
// in a scratch copy (never the real file), and the gate self-test (clockSelfTestChecks) must go red.
// This is the list the PR's mutant tally is quoted from: `node scripts/clock-spellings-mutants.mjs`.
//
// An entry marked `equivalent` is NOT expected red; it carries the reason it changes no behaviour, and
// the run FAILS if one of them turns red (the reason would be wrong) or if any other entry stays green
// or its target text is no longer in the lib (STALE). The scratch copy is written next to the lib so
// `typescript` resolves, and is removed afterwards.
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const LIB = resolve(here, "lib/clock-spellings.mjs");
const SCRATCH = resolve(here, "lib/clock-spellings.mutant.mjs");
const good = readFileSync(LIB, "utf8");

const R = String.raw;
const M = [
  ["inner-end wrapper blanking dropped", "blank(t, inner.end, w.end);", "/*m*/"],
  ["wrapper start blanking dropped", "blank(t, startOf(w), startOf(inner));", "/*m*/", "a leftover `(` before the receiver does not change any pattern's match"],
  ["trivial-comma step dropped from the text peel", "(anyComma || isTrivialLeft(e.left))) n = e.right;", "(anyComma)) n = e.right;", "the tree rules follow the right operand of any comma, and the text rewrite blanks the same characters whether `(0, ` is peeled or left in front of the receiver"],
  ["any comma followed by the text peel", "(anyComma || isTrivialLeft(e.left))) n = e.right;", "(true)) n = e.right;"],
  ["`void 0` not a trivial left operand", "(n.kind === K.VoidExpression && n.expression.kind === K.NumericLiteral)", "false", "same reason as the trivial-comma step: `(void 0, x)` is followed by the tree rules and matches the same text either way"],
  ["any left operand trivial", "n.kind === K.NumericLiteral ||", "true ||"],
  ["peel stops after one wrapper layer", "else if (isWrapper(n)) n = n.expression;", "else if (false) n = n.expression;"],
  ["Date() call rule off", "if (isDateRef(node.expression)) dateLines.push(lineAt(starts, startOf(node)));\n        if (node.typeArguments?.length) typeArgLists.push(node.typeArguments);\n        break;\n      case K.TaggedTemplateExpression:", "if (false) dateLines.push(lineAt(starts, startOf(node)));\n        if (node.typeArguments?.length) typeArgLists.push(node.typeArguments);\n        break;\n      case K.TaggedTemplateExpression:"],
  ["tagged-template rule off", "if (isDateRef(node.tag))", "if (false)"],
  ["new Date with any arguments flagged", "node.arguments.every((x) => x.kind === K.SpreadElement)", "true"],
  ["new Date no-parens form ignored", "(!node.arguments || node.arguments.length === 0 ||", "(node.arguments && node.arguments.length === 0 ||"],
  ["spread rule: some instead of every", "node.arguments.every((x) => x.kind === K.SpreadElement)", "node.arguments.some((x) => x.kind === K.SpreadElement)"],
  ["spread rule off", "node.arguments.every((x) => x.kind === K.SpreadElement)", "false"],
  ["globalThis.Date ignored", 'return r.kind === K.Identifier && r.text === "globalThis";', "return false;"],
  ["isDateRef does not follow any comma", "const p = peel(e, true);\n  if (p.kind === K.Identifier) return p.text === \"Date\";", "const p = peel(e);\n  if (p.kind === K.Identifier) return p.text === \"Date\";"],
  ["receiverOf does not follow any comma", "function receiverOf(e) {\n  const p = peel(e, true);", "function receiverOf(e) {\n  const p = peel(e);"],
  ["requireModule does not peel", "const e = peel(init, true);", "const e = init;"],
  ["bracket access not normalised", "if (!(arg.kind === K.StringLiteral ||", "if (true || !(arg.kind === K.StringLiteral ||"],
  ["template key not normalised", "arg.kind === K.StringLiteral || arg.kind === K.NoSubstitutionTemplateLiteral) ||", "arg.kind === K.StringLiteral) ||"],
  ["bracket key not peeled (parens / as const)", "const arg = peel(node.argumentExpression);", "const arg = node.argumentExpression;"],
  ["optional bracket keeps [", "if (!hasQd) t[o] = \".\";", "t[o] = \".\";"],
  ["raw key text kept (escapes unresolved)", "for (let k = 0; k < arg.text.length; k++) t[a + k] = arg.text[k];", "for (let k = a; k < arg.end - 1; k++) t[k] = src[k];"],
  ["brackets not blanked around the key", "for (let k = o; k <= c; k++) t[k] = \" \";", "/*m*/"],
  ["type nodes not blanked", "for (const [a, e] of typeRanges) blank(t, a, e);", "/*m*/"],
  ["type-argument brackets not blanked", "t[lt] = \" \";\n      t[gt] = \" \";", "/*m*/"],
  ["type nodes not recorded", "if (ts.isTypeNode(node) && node.kind !== K.ExpressionWithTypeArguments) typeRanges.push", "if (false) typeRanges.push"],
  ["comments not blanked in the masked text", "blank(out, a, e);\n    blank(vis, a, e);", "blank(vis, a, e);"],
  ["literal interiors not blanked", "for (const [a, e] of interiors) blank(out, a, e);", "/*m*/"],
  ["template head text not blanked", "interiors.push([a + 1, Math.max(a + 1, node.end - 2)]);", "/*m*/"],
  ["comment scan does not step over literals", "if (pi < prot.length && prot[pi][0] <= pos && pos < prot[pi][1]) {", "if (false) {"],
  ["parse diagnostics dropped", "for (const d of diags) {", "for (const d of []) {"],
  ["parse diagnostics narrowed to four codes", "for (const d of diags) {", "for (const d of diags.filter((x) => [1002, 1160, 1010, 1005].includes(x.code))) {"],
  ["problem line always 1", "line: lineAt(starts, d.start ?? 0),", "line: 1,"],
  ["missing diagnostics array tolerated", "if (!Array.isArray(diags)) {", "if (false) {", "the parser always exposes the array; the branch cannot be reached with this TypeScript version"],
  ["require ignored", "const mod = requireModule(node.initializer);\n        if (mod) bindRequire(node.name, mod);", "/*m*/"],
  ["import-equals ignored", "if (!node.isTypeOnly && node.moduleReference.kind === K.ExternalModuleReference", "if (false && node.moduleReference.kind === K.ExternalModuleReference"],
  ["perf_hooks not bound", 'else if (base === "perf_hooks") {', 'else if (base === "perf_hooks_x") {'],
  ["process module not bound", 'else if (base === "process") {', 'else if (base === "process_x") {'],
  ["{ default as proc } not bound", 'if (imported === "default") b.procNs.add(local);', "/*m*/"],
  ["proc.default.* receiver not followed", "(?:default${DOT})?(?:uptime${CALL}|hrtime\\b)", "(?:uptime${CALL}|hrtime\\b)"],
  ["nc.default.webcrypto.* receiver not followed", "(?:(?:default|webcrypto)${DOT})*", "(?:(?:webcrypto)${DOT})*"],
  ["quoted destructure key ignored", "if (n.kind === K.Identifier || n.kind === K.StringLiteral || n.kind === K.NoSubstitutionTemplateLiteral || n.kind === K.NumericLiteral) return n.text;", "if (n.kind === K.Identifier) return n.text;"],
  ["computed destructure key ignored", "if (n.kind === K.ComputedPropertyName) return keyOf(n.expression);", "/*m*/"],
  ["destructure matches the value side", "keys: keys.filter(Boolean), receiver", 'keys: keys.filter(Boolean).concat(["now", "random"]), receiver'],
  ["destructuring assignment ignored", "node.left.kind === K.ObjectLiteralExpression) addSite", "false) addSite"],
  ["parameter destructure ignored", "case K.Parameter:\n        if (node.name.kind === K.ObjectBindingPattern) addSite", "case K.Parameter:\n        if (false) addSite"],
  ["match attributed to its end line", "lines.add(lineAt(a.starts, m.index));", "lines.add(lineAt(a.starts, m.index + m[0].length));"],
  ["line table counts CR", "if (src.charCodeAt(i) === 10) out.push(i + 1);", "if (src.charCodeAt(i) === 10 || src.charCodeAt(i) === 13) out.push(i + 1);"],
  ["line lookup: <= became <", "if (starts[mid] <= off) lo = mid;", "if (starts[mid] < off) lo = mid;"],
  ["legacy backstop ignores U+2028", "/[\\r\\u2028\\u2029]/", "/[\\r]/"],
  ["memoisation keyed wrongly", "let hit = cache.get(src);", "let hit = cache.get(src.length);", "a key that always misses only costs time; the result is a pure function of the source"],
];

const load = async (text, tag) => {
  writeFileSync(SCRATCH, text);
  return import(`${pathToFileURL(SCRATCH).href}?m=${tag}`);
};

let stale = 0;
let red = 0;
let equivalentOk = 0;
const problems = [];
try {
  const base = await load(good, "base");
  const baseFailed = base.clockSelfTestChecks(base.scanSource).filter(([, ok]) => !ok);
  if (baseFailed.length) {
    console.error(`the unmutated lib already fails its self-test: ${baseFailed.map(([n]) => n).join("; ")}`);
    process.exitCode = 1;
  } else {
    let i = 0;
    for (const [name, from, to, equivalent] of M) {
      i++;
      if (!good.includes(from)) {
        stale++;
        console.log(`STALE  ${name}`);
        continue;
      }
      let isRed;
      try {
        const m = await load(good.replace(from, () => to), `m${i}`);
        isRed = m.clockSelfTestChecks(m.scanSource).some(([, ok]) => !ok);
      } catch {
        isRed = true; // a mutant that does not even load or run is caught
      }
      if (equivalent) {
        if (isRed) problems.push(`${name}: marked equivalent but the self-test caught it`);
        else equivalentOk++;
        console.log(`${isRed ? "RED?? " : "equiv "} ${name}`);
      } else {
        if (isRed) red++;
        else problems.push(`${name}: survives the self-test`);
        console.log(`${isRed ? "RED    " : "GREEN  "}${name}`);
      }
    }
    console.log(`\nmutants: ${M.length} run; ${red} red; ${equivalentOk} equivalent (green, reason given); ${stale} stale; ${problems.length} problem(s)`);
    for (const p of problems) console.log(`  ✗ ${p}`);
    if (stale || problems.length) process.exitCode = 1;
  }
} finally {
  rmSync(SCRATCH, { force: true });
}
