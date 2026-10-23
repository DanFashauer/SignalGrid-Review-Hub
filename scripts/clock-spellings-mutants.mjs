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
// gitignored) and is removed when a run completes. There are no SIGINT/SIGTERM handlers on purpose: the
// run never yields to the event loop, so a handler would not run before the run ended, and installing one
// would replace the default action (a SIGTERM would stop terminating the process). A killed run can leave
// the gitignored scratch file; the next run overwrites and removes it.
//
// WHAT THE GUARD DOES NOT TEST. `judgeEquivalent` and `ceilingProblems` have a self-check of their own (run
// first, below). The call sites and the rest of the run have none, so a mutant of any of these still exits 0:
// the ceiling check being called at all; the equivalence comparison being given the lib and the mutant (and
// not the mutant twice); the equivalence problems reaching the report and the tally; the tally adding up;
// the dirty-tree pathspec; the scratch cleanup; and "a stale entry is fatal".
//
// It refuses to run when the matcher or this script has uncommitted changes (`--allow-dirty` overrides),
// because its tally would describe code that is not committed. It also checks that every item of the
// lib's CLOCK_CEILING appears, in order and numbered, in the BUILD_BACKLOG row that carries it, and that
// the row carries no further numbered item.
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

// The two rules below decide the tally, so they are functions with a self-check (see guardSelfCheck).
// Returns { problems, counted }: `counted` is true only when an equivalent entry holds on every plant.
function judgeEquivalent(equivalent, isRed, scanBase, scanMut) {
  if (!equivalent.reason || !Array.isArray(equivalent.plants) || !equivalent.plants.length) {
    return { problems: ["an equivalent entry must give a reason and the plants that were tried"], counted: false };
  }
  if (isRed) return { problems: ["marked equivalent but the self-test caught it"], counted: false };
  const problems = [];
  for (const plant of equivalent.plants) {
    if (JSON.stringify(scanBase(plant)) !== JSON.stringify(scanMut(plant))) {
      problems.push(`marked equivalent but the plant ${JSON.stringify(plant)} scans differently`);
    }
  }
  return { problems, counted: problems.length === 0 };
}
// The BUILD_BACKLOG row for the ceiling must be `(1) item1 (2) item2 ...` in order and carry nothing numbered beyond.
function ceilingProblems(items, backlog) {
  const rows = backlog.split("\n").filter((l) => l.startsWith("- [ ] **The clock-spelling matcher has a declared ceiling"));
  if (rows.length !== 1) return [`docs/BUILD_BACKLOG.md has ${rows.length} ceiling rows, not 1`];
  const row = rows[0];
  const problems = [];
  let at = 0;
  items.forEach((item, k) => {
    // Each item is exactly `(k) item`, followed by the next number (or the closing "Fix shape" sentence).
    const needle = `(${k + 1}) ${item} `;
    const next = k + 1 < items.length ? `(${k + 2}) ` : "Fix shape:";
    const found = row.indexOf(needle + next, at);
    if (found < 0) problems.push(`the ceiling row does not carry item ${k + 1} verbatim, numbered and in order`);
    else at = found + needle.length;
  });
  if (row.includes(`(${items.length + 1})`)) problems.push(`the ceiling row carries an item numbered ${items.length + 1}, which CLOCK_CEILING does not have`);
  if (backlog.split("\n").filter((l) => l.includes(items[0])).length !== 1) problems.push("the first ceiling item appears on more than one line of docs/BUILD_BACKLOG.md");
  return problems;
}
function guardSelfCheck() {
  const out = [];
  const same = () => "x";
  const diff = (src) => (src === "p" ? "y" : "x");
  const eq = (plants) => ({ reason: "r", plants });
  const expect = (name, ok) => { if (!ok) out.push(`guard self-check failed: ${name}`); };
  expect("an equivalent that holds is counted", judgeEquivalent(eq(["p"]), false, same, same).counted);
  expect("a differing plant is a problem and is not counted", (() => { const r = judgeEquivalent(eq(["p"]), false, same, diff); return r.problems.length === 1 && !r.counted; })());
  expect("a caught mutant cannot be equivalent", judgeEquivalent(eq(["p"]), true, same, same).problems.length === 1);
  expect("a differing SECOND plant is a problem", (() => { const r = judgeEquivalent(eq(["q", "p"]), false, same, diff); return r.problems.length === 1 && !r.counted; })());
  expect("an equivalent without plants is a problem", judgeEquivalent({ reason: "r" }, false, same, same).problems.length === 1);
  expect("an equivalent without a reason is a problem", judgeEquivalent({ plants: ["p"] }, false, same, same).problems.length === 1);
  const row = (body) => `- [ ] **The clock-spelling matcher has a declared ceiling** ${body} Fix shape: x.`;
  const long1 = "the first item is a long sentence that is well over forty characters before its ending";
  const long2 = "the second item is also long and only differs from a drifted copy at its very last words";
  const items = [long1, long2];
  const good = row(`(1) ${long1} (2) ${long2}`);
  expect("a faithful row passes", ceilingProblems(items, good).length === 0);
  expect("an edit past the 40th character fails", ceilingProblems(items, row(`(1) ${long1} (2) ${long2.replace("last words", "final words")}`)).length === 1);
  expect("a clause added inside an item fails", ceilingProblems(items, row(`(1) ${long1} and one more clause (2) ${long2}`)).length === 1);
  expect("an extra numbered item fails", ceilingProblems(items, row(`(1) ${long1} (2) ${long2} (3) c`)).length >= 1);
  expect("an extra numbered item with no space fails", ceilingProblems(items, row(`(1) ${long1} (2) ${long2} (3)c`)).length >= 1);
  expect("items out of order fail", ceilingProblems(items, row(`(2) ${long2} (1) ${long1}`)).length >= 1);
  expect("a missing row fails", ceilingProblems(items, "nothing").length === 1);
  expect("a second copy of the row fails", ceilingProblems(items, `${good}\n${row(`(1) ${long1} (2) drifted`)}`).length === 1);
  expect("the first item repeated on another line fails", ceilingProblems(items, `${good}\n${long1}`).length === 1);
  return out;
}

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
  ["generator named-default binding dropped", 'if (imported === "default") {\n        if (!b.genNs.has(base)) b.genNs.set(base, new Set());', 'if (false) {\n        if (!b.genNs.has(base)) b.genNs.set(base, new Set());'],
  ["uuid v6 dropped from the generator list", '\n  uuid: ["v1", "v4", "v6", "v7"],', '\n  uuid: ["v1", "v4", "v7"],'],
  ["ulid monotonicFactory dropped from the generator list", '\n  ulid: ["ulid", "monotonicFactory"],', '\n  ulid: ["ulid"],'],
  ["cuid2 dropped from the generator list", '\n  "@paralleldrive/cuid2": ["createId"],', ""],
  ["require/import module argument must be a plain string", "ts.isStringLiteralLike(e.arguments[0])) return e.arguments[0].text;", "e.arguments[0].kind === K.StringLiteral) return e.arguments[0].text;"],
  ["closing > of type arguments not searched for", 'while (gt < t.length && t[gt] !== ">") gt++;', "/*m*/"],
  [".default hop dropped from the generator namespace pattern", "${DOT}(?:default${DOT})?(?:${members.map", "${DOT}(?:${members.map"],
  ["awaited operand not peeled", "if (e.kind === K.AwaitExpression) e = peel(e.expression, true);", "if (e.kind === K.AwaitExpression) e = e.expression;"],
  ["any void operand counts as trivial", "(n.kind === K.VoidExpression && n.expression.kind === K.NumericLiteral)", "(n.kind === K.VoidExpression)"],
  ["Date() call line taken from node.pos", "if (isDateRef(node.expression)) dateLines.push(lineAt(starts, startOf(node)));\n        if (node.typeArguments?.length) typeArgLists.push(node.typeArguments);\n        break;\n      case K.TaggedTemplateExpression:", "if (isDateRef(node.expression)) dateLines.push(lineAt(starts, node.pos));\n        if (node.typeArguments?.length) typeArgLists.push(node.typeArguments);\n        break;\n      case K.TaggedTemplateExpression:"],
  ["generator namespace pattern loses optional chaining on the member", '.join("|")})${CALL}`, "g"));\n    dynDestructures.push({ names: members', '.join("|")})\\s*\\(`, "g"));\n    dynDestructures.push({ names: members'],
  ["generator namespace pattern loses optional chaining on the dot", "${L}(?:${alt(names)})${DOT}(?:default", "${L}(?:${alt(names)})\\s*\\.\\s*(?:default"],
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

problems.push(...guardSelfCheck());
// The ceiling list in the lib and the BUILD_BACKLOG row must be the same words.
{
  const lib = await import(pathToFileURL(LIB).href);
  problems.push(...ceilingProblems(lib.CLOCK_CEILING, readFileSync(resolve(REPO, "docs/BUILD_BACKLOG.md"), "utf8")));
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
        const r = judgeEquivalent(equivalent, isRed, base.scanSource, m.scanSource);
        for (const pr of r.problems) problems.push(`${name}: ${pr}`);
        if (r.counted) equivalentOk++;
        console.log(`${r.counted ? "equiv  " : "RED??  "}${name}  [tried ${equivalent.plants?.length ?? 0} plant(s)]`);
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
