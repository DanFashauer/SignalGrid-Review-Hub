#!/usr/bin/env node
// Mutation run for scripts/lib/clock-spellings.mjs: each entry changes ONE piece of the shared matcher
// in a scratch copy (never the real file), and the gate self-test (clockSelfTestChecks) must go red.
// This is the list the PR's mutant tally is quoted from: `node scripts/clock-spellings-mutants.mjs`.
//
// An entry marked `equivalent` is NOT expected red. It must carry the reason it changes no behaviour AND
// the plants that were tried (`plants`): the run executes every one of them against the lib and against the
// mutant and FAILS unless the two scans are identical, and FAILS if a self-test catches the mutant (the
// reason would be wrong). Any other entry that stays green, or whose target text is no longer in the lib
// (STALE), fails the run. The scratch copy is written next to the lib so `typescript` resolves (it is
// gitignored) and is removed afterwards, also on SIGINT/SIGTERM.
//
// It refuses to run when the matcher or this script has uncommitted changes (`--allow-dirty` overrides),
// because its tally would describe code that is not committed. It also checks that every item of the
// lib's CLOCK_CEILING appears verbatim in docs/BUILD_BACKLOG.md.
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const LIB = resolve(here, "lib/clock-spellings.mjs");
const SCRATCH = resolve(here, "lib/clock-spellings.mutant.mjs");
const REPO = resolve(here, "..");
const good = readFileSync(LIB, "utf8");

if (!process.argv.includes("--allow-dirty")) {
  const dirty = execFileSync("git", ["status", "--porcelain", "--", "scripts/lib/clock-spellings.mjs", "scripts/clock-spellings-mutants.mjs"], { cwd: REPO, encoding: "utf8" }).trim();
  if (dirty) {
    console.error(`refusing to run: the matcher or this script has uncommitted changes (pass --allow-dirty to override)\n${dirty}`);
    process.exit(2);
  }
}
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { rmSync(SCRATCH, { force: true }); process.exit(130); });

const R = String.raw;
const M = [
  ["inner-end wrapper blanking dropped", "blank(t, inner.end, w.end);", "/*m*/"],
  ["wrapper start blanking dropped", "blank(t, startOf(w), startOf(inner));", "/*m*/", { reason: "a leftover `(` before the receiver does not change any pattern's match", plants: ["const t = (Date).now();", "const t = ((Date as any)).now();", "const t = new (Date)();", "const { now } = (Date);"] }],
  ["trivial-comma step dropped from the text peel", "(anyComma || isTrivialLeft(e.left))) n = e.right;", "(anyComma)) n = e.right;"],
  ["any comma followed by the text peel", "(anyComma || isTrivialLeft(e.left))) n = e.right;", "(true)) n = e.right;"],
  ["`void 0` not a trivial left operand", "(n.kind === K.VoidExpression && n.expression.kind === K.NumericLiteral)", "false"],
  ["any left operand trivial", "n.kind === K.NumericLiteral ||", "true ||"],
  ["peel stops after one wrapper layer", "else if (isWrapper(n)) n = n.expression;", "else if (false) n = n.expression;"],
  ["Date() call rule off", "if (isDateRef(node.expression)) dateLines.push(lineAt(starts, startOf(node)));\n        if (node.typeArguments?.length) typeArgLists.push(node.typeArguments);\n        break;\n      case K.TaggedTemplateExpression:", "if (false) dateLines.push(lineAt(starts, startOf(node)));\n        if (node.typeArguments?.length) typeArgLists.push(node.typeArguments);\n        break;\n      case K.TaggedTemplateExpression:"],
  ["tagged-template rule off", "if (isDateRef(node.tag))", "if (false)"],
  ["new Date with any arguments flagged", "node.arguments.every((x) => x.kind === K.SpreadElement)", "true"],
  ["new Date no-parens form ignored", "(!node.arguments || node.arguments.length === 0 || node.arguments.every((x) => x.kind === K.SpreadElement))", "(node.arguments?.length === 0 || node.arguments?.every((x) => x.kind === K.SpreadElement))"],
  ["spread rule: some instead of every", "node.arguments.every((x) => x.kind === K.SpreadElement)", "node.arguments.some((x) => x.kind === K.SpreadElement)"],
  ["spread rule off", "node.arguments.every((x) => x.kind === K.SpreadElement)", "false"],
  ["globalThis hop in receiverOf does not follow any comma", 'const r = peel(p.expression, true);\n    if (r.kind === K.Identifier && r.text === "globalThis") return p.name.text;', 'const r = peel(p.expression);\n    if (r.kind === K.Identifier && r.text === "globalThis") return p.name.text;'],
  ["globalThis hop in isDateRef does not follow any comma", 'const r = peel(p.expression, true);\n    return r.kind === K.Identifier && r.text === "globalThis";', 'const r = peel(p.expression);\n    return r.kind === K.Identifier && r.text === "globalThis";'],
  ["requireModule follows only a trivial comma", "let e = peel(init, true);", "let e = peel(init);"],
  ["await import() not bound", "if (e.kind === K.AwaitExpression) e = peel(e.expression, true);", "/*m*/"],
  ["generator namespace bindings dropped", "for (const n of whole) {\n      if (!b.genNs.has(base)) b.genNs.set(base, new Set());", "for (const n of []) {\n      if (!b.genNs.has(base)) b.genNs.set(base, new Set());"],
  ["generator namespace pattern dropped", "dyn.push(new RegExp(String.raw`${L}(?:${alt(names)})${DOT}(?:default${DOT})?(?:${members.map(escId).join(\"|\")})${CALL}`, \"g\"));", "/*m*/"],
  ["generator namespace destructure dropped", "dynDestructures.push({ names: members, from: [...names] });", "/*m*/"],
  ["instantiation-expression type arguments not blanked", "if (node.kind === K.ExpressionWithTypeArguments && node.typeArguments?.length) typeArgLists.push(node.typeArguments);", "/*m*/"],
  ["instantiation-expression head blanked with its type", "if (ts.isTypeNode(node) && node.kind !== K.ExpressionWithTypeArguments)", "if (ts.isTypeNode(node))"],
  ["new Date line taken from node.pos", "dateLines.push(lineAt(starts, startOf(node)));\n        }\n        if (node.typeArguments?.length) typeArgLists.push(node.typeArguments);\n        break;\n      case K.VariableDeclaration", "dateLines.push(lineAt(starts, node.pos));\n        }\n        if (node.typeArguments?.length) typeArgLists.push(node.typeArguments);\n        break;\n      case K.VariableDeclaration"],
  ["destructure line taken from the initializer", "sites.push({ line: lineAt(starts, startOf(pattern)),", "sites.push({ line: lineAt(starts, startOf(init)),"],
  ["template tail not protected from the comment scan", "      case K.TemplateTail: {\n        const a = startOf(node);\n        prot.push([a, node.end]);", "      case K.TemplateTail: {\n        const a = startOf(node);"],
  ["template head/middle not protected from the comment scan", "      case K.TemplateMiddle: {\n        const a = startOf(node);\n        prot.push([a, node.end]);", "      case K.TemplateMiddle: {\n        const a = startOf(node);"],
  ["globalThis.Date ignored", 'return r.kind === K.Identifier && r.text === "globalThis";', "return false;"],
  ["isDateRef does not follow any comma", "const p = peel(e, true);\n  if (p.kind === K.Identifier) return p.text === \"Date\";", "const p = peel(e);\n  if (p.kind === K.Identifier) return p.text === \"Date\";"],
  ["receiverOf does not follow any comma", "function receiverOf(e) {\n  const p = peel(e, true);", "function receiverOf(e) {\n  const p = peel(e);"],
  ["requireModule does not peel", "let e = peel(init, true);", "let e = init;"],
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
  ["missing diagnostics array tolerated", "if (!Array.isArray(diags)) {", "if (false) {", { reason: "the parser always exposes the array; the branch cannot be reached with this TypeScript version", plants: ["const a = 1;", "let x = ;", "const t = Date.now();"] }],
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
  ["memoisation keyed wrongly", "let hit = cache.get(src);", "let hit = cache.get(src.length);", { reason: "a key that always misses only costs time; the result is a pure function of the source", plants: ["const t = Date.now();", "const a = 1;", "let x = ;"] }],
];

const load = async (text, tag) => {
  writeFileSync(SCRATCH, text);
  return import(`${pathToFileURL(SCRATCH).href}?m=${tag}`);
};

let stale = 0;
let red = 0;
let equivalentOk = 0;
const problems = [];

// The ceiling lists in the lib and in docs/BUILD_BACKLOG.md must be the same words.
{
  const lib = await import(pathToFileURL(LIB).href);
  const backlog = readFileSync(resolve(REPO, "docs/BUILD_BACKLOG.md"), "utf8");
  lib.CLOCK_CEILING.forEach((item, k) => {
    if (!backlog.includes(item)) problems.push(`docs/BUILD_BACKLOG.md does not carry CLOCK_CEILING item ${k + 1} verbatim`);
  });
}

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
      let m;
      let isRed;
      try {
        m = await load(good.replace(from, () => to), `m${i}`);
        isRed = m.clockSelfTestChecks(m.scanSource).some(([, ok]) => !ok);
      } catch {
        isRed = true; // a mutant that does not even load or run is caught
      }
      if (equivalent) {
        if (!equivalent.reason || !Array.isArray(equivalent.plants) || !equivalent.plants.length) {
          problems.push(`${name}: an equivalent entry must give a reason and the plants that were tried`);
        } else if (isRed) {
          problems.push(`${name}: marked equivalent but the self-test caught it`);
        } else {
          for (const plant of equivalent.plants) {
            if (JSON.stringify(base.scanSource(plant)) !== JSON.stringify(m.scanSource(plant))) {
              problems.push(`${name}: marked equivalent but the plant ${JSON.stringify(plant)} scans differently`);
            }
          }
          equivalentOk++;
        }
        console.log(`${isRed ? "RED?? " : "equiv "} ${name}  [tried ${equivalent.plants?.length ?? 0} plant(s)]`);
      } else {
        if (isRed) red++;
        else problems.push(`${name}: survives the self-test`);
        console.log(`${isRed ? "RED    " : "GREEN  "}${name}`);
      }
    }
  }
} finally {
  rmSync(SCRATCH, { force: true });
}
console.log(`\nmutants: ${M.length} run; ${red} red; ${equivalentOk} equivalent (green, reason and plants given); ${stale} stale; ${problems.length} problem(s)`);
for (const p of problems) console.log(`  ✗ ${p}`);
if (stale || problems.length) process.exitCode = 1;
