// Wire-truth ledger gate (docs/COMPANY_BUILD_PLAN.md row 17): every live check,
// the dimensions it touched, and the code it verified, in one committed file.
//
//   node scripts/check-wire-truth-ledger.mjs              # the gate
//   node scripts/check-wire-truth-ledger.mjs --self-test  # planted failures must fail
//
// WHY. The coverage counts (checks, hits, live-checked and unchecked dimensions)
// lived only in plan prose and drifted: "10 checks, 10 hits" counted dimensions as
// checks, and "51 dimensions" went stale when app-protection landed. Here the
// records live in docs/agent/wire-truth-ledger.json and the counts are DERIVED,
// never stored; check-derived-doc-figures.mjs imports wireTruthFigures() and holds
// the plan's sentences to them.
//
// FATAL: a ledger dimension that is not a directory under
// lib/integrations/src/integrations/ (every directory but adapters/, which is shared
// wire plumbing no department owns); an evidence path git does not track; a boundTo
// symbol not DECLARED in its file (at the start of a line, outside block comments); no
// dimensions array; a non-null entry with no dimensions; a checked dimension with no
// boundTo of its own (each binding names the dimension it verified); divergenceFound true without a
// divergenceRecord whose path is one of the entry's evidence paths and whose quote (12
// characters or more) appears verbatim in it; divergenceFound null without a note; a
// date that is not a real day; an id that is not a nonblank string, or a duplicate one; a
// live record cited by more than one entry (one wire record is one check); and a tracked
// scripts/src/live-*-proof.ts or docs/*_LIVE_SHAPE_CHECK.md that no entry cites — a new
// live check that nobody recorded is the drift itself.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LEDGER = "docs/agent/wire-truth-ledger.json";
const INTEGRATIONS = "lib/integrations/src/integrations";
const NOT_A_DIMENSION = new Set(["adapters"]);
// Floor: the tree has fifty-odd dimensions; a walk that finds a handful is broken.
const DIMENSION_FLOOR = 40;
const LIVE_RECORD = /^(scripts\/src\/live-[^/]+-proof\.ts|docs\/[^/]+_LIVE_SHAPE_CHECK\.md)$/;

export const dimensionsOf = (root = ROOT) =>
  new Set(readdirSync(join(root, INTEGRATIONS), { withFileTypes: true }).filter((d) => d.isDirectory() && !NOT_A_DIMENSION.has(d.name)).map((d) => d.name));

export function treeOf(root = ROOT) {
  const tracked = new Set(execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean));
  return { dims: dimensionsOf(root), tracked, read: (rel) => readFileSync(join(root, rel), "utf8") };
}

// A declaration counts only at the start of a line and outside a block comment, so a
// `// interface Phantom {}` or a commented-out block does not keep a stale binding green.
// ponytail: line-anchored regex, not a parser; a template literal whose line starts with
// a declaration would still match. Use the TypeScript parser if that ever happens.
const declares = (text, symbol) =>
  new RegExp(
    `^[ \\t]*(?:export[ \\t]+)?(?:default[ \\t]+)?(?:declare[ \\t]+)?(?:abstract[ \\t]+)?(?:async[ \\t]+)?(?:function\\*?|class|interface|type|const|let|enum)[ \\t]+${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
    "m",
  ).test(text.replace(/\/\*[\s\S]*?\*\//g, ""));

export function audit(ledger, tree) {
  const problems = [];
  const checks = Array.isArray(ledger?.checks) ? ledger.checks : null;
  if (!checks || checks.length === 0) return { problems: ["ledger has no checks[] — a ledger that records nothing is green about nothing"] };
  if (tree.dims.size < DIMENSION_FLOOR) problems.push(`derived only ${tree.dims.size} dimensions (< ${DIMENSION_FLOOR}) — the walk is broken, not the tree`);
  const read = (rel) => { try { return tree.read(rel); } catch { return null; } };
  const ids = new Set();
  const cited = new Map();
  for (const c of checks) {
    const at = typeof c?.id === "string" && c.id.trim() ? c.id : "(no id)";
    if (typeof c?.id !== "string" || !c.id.trim()) problems.push(`an entry's id is not a nonblank string: ${JSON.stringify(c?.id)}`);
    else if (ids.has(c.id)) problems.push(`${at}: duplicate id`);
    ids.add(c?.id);
    for (const f of ["product", "date"]) if (typeof c?.[f] !== "string" || !c[f]) problems.push(`${at}: missing ${f}`);
    if (typeof c?.date === "string" && !(/^\d{4}-\d{2}-\d{2}$/.test(c.date) && !Number.isNaN(Date.parse(c.date)) && new Date(c.date).toISOString().startsWith(c.date))) problems.push(`${at}: date "${c.date}" is not YYYY-MM-DD`);
    if (!Array.isArray(c?.dimensions)) problems.push(`${at}: dimensions must be an array`);
    else if (c.dimensions.length === 0 && c.divergenceFound !== null) problems.push(`${at}: no dimensions — only a divergenceFound null entry may check none`);
    else if (c.dimensions.length > 0 && !(Array.isArray(c?.boundTo) && c.boundTo.length > 0)) problems.push(`${at}: checks a dimension but is bound to no code`);
    else for (const d of c.dimensions) if (!c.boundTo.some((b) => b?.dimension === d)) problems.push(`${at}: dimension "${d}" has no boundTo naming it — every checked dimension needs its own binding`);
    for (const b of Array.isArray(c?.boundTo) ? c.boundTo : []) if (!(c.dimensions ?? []).includes(b?.dimension)) problems.push(`${at}: boundTo ${b?.path} names dimension ${JSON.stringify(b?.dimension)}, which this entry does not check`);
    for (const d of Array.isArray(c?.dimensions) ? c.dimensions : []) if (!tree.dims.has(d)) problems.push(`${at}: dimension "${d}" is not a directory under ${INTEGRATIONS}/`);
    if (!Array.isArray(c?.evidence) || c.evidence.length === 0) problems.push(`${at}: no evidence paths`);
    for (const p of c?.evidence ?? []) {
      if (LIVE_RECORD.test(p) && cited.has(p)) problems.push(`${at}: live record ${p} is already cited by ${cited.get(p)} — one wire record is one check`);
      else cited.set(p, at);
      if (!tree.tracked.has(p)) problems.push(`${at}: evidence ${p} is not tracked`);
    }
    for (const b of c?.boundTo ?? []) {
      const text = read(b?.path ?? "");
      if (text === null) problems.push(`${at}: boundTo ${b?.path} does not exist`);
      else if (typeof b?.symbol !== "string" || !/^[A-Za-z_$][\w$]*$/.test(b.symbol) || !declares(text, b.symbol)) problems.push(`${at}: boundTo ${b.symbol} is not declared in ${b.path}`);
    }
    if (c?.divergenceFound === true) {
      const r = c.divergenceRecord;
      const text = r?.path ? read(r.path) : null;
      if (!(c.evidence ?? []).includes(r?.path)) problems.push(`${at}: divergenceRecord path ${r?.path ?? "(no path)"} is not one of this entry's evidence paths`);
      else if (typeof r?.quote !== "string" || r.quote.trim().length < 12 || text === null || !text.includes(r.quote)) problems.push(`${at}: divergenceFound true but its divergenceRecord quote is not found verbatim in ${r?.path ?? "(no path)"}`);
    } else if (c?.divergenceFound === null) {
      if (typeof c.note !== "string" || !c.note.trim()) problems.push(`${at}: divergenceFound null needs a note saying why there was nothing to diverge from`);
    } else if (c?.divergenceFound !== false) problems.push(`${at}: divergenceFound must be true, false or null`);
  }
  for (const p of tree.tracked) if (LIVE_RECORD.test(p) && !cited.has(p)) problems.push(`${p} is a live record no ledger entry cites — add an entry`);
  return { problems, figures: figuresOf(checks, tree.dims) };
}

function figuresOf(checks, dims) {
  const checked = new Set(checks.flatMap((c) => c.dimensions ?? []).filter((d) => dims.has(d)));
  return {
    checks: checks.length,
    hits: checks.filter((c) => c.divergenceFound === true).length,
    dimensions: dims.size,
    checked: checked.size,
    unchecked: [...dims].filter((d) => !checked.has(d)).sort(),
  };
}

const loadLedger = (root) => JSON.parse(readFileSync(join(root, LEDGER), "utf8"));

/** For check-derived-doc-figures.mjs: the counts the plan's prose must equal. */
export function wireTruthFigures(root = ROOT) {
  const f = figuresOf(loadLedger(root).checks, dimensionsOf(root));
  return { ...f, uncheckedCount: f.unchecked.length };
}

function selfTest() {
  const tree = {
    dims: new Set(Array.from({ length: DIMENSION_FLOOR }, (_, i) => `d${i}`)),
    tracked: new Set(["docs/A_LIVE_SHAPE_CHECK.md", "lib/x.ts"]),
    read: (rel) => ({ "docs/A_LIVE_SHAPE_CHECK.md": "the wire said no", "lib/x.ts": "export interface Thing {}\n// see Other\n// interface Phantom {}\n/*\nclass Ghost2 {}\n*/" })[rel] ?? (() => { throw new Error("ENOENT"); })(),
  };
  const good = () => ({ checks: [{ id: "a", product: "p", date: "2026-09-27", dimensions: ["d0"], evidence: ["docs/A_LIVE_SHAPE_CHECK.md"], divergenceFound: true, divergenceRecord: { path: "docs/A_LIVE_SHAPE_CHECK.md", quote: "the wire said no" }, boundTo: [{ path: "lib/x.ts", symbol: "Thing", dimension: "d0" }] }] });
  const plant = (fn) => { const l = good(); fn(l); return audit(l, tree).problems.length > 0; };
  const cases = [
    ["a clean ledger passes", audit(good(), tree).problems.length === 0],
    ["an unknown dimension fails", plant((l) => { l.checks[0].dimensions = ["no-such-dim"]; })],
    ["an untracked evidence path fails", plant((l) => { l.checks[0].evidence.push("docs/untracked.md"); })],
    ["a boundTo symbol not declared in its file fails", plant((l) => { l.checks[0].boundTo[0].symbol = "Ghost"; })],
    ["a symbol merely MENTIONED, not declared, fails", plant((l) => { l.checks[0].boundTo[0].symbol = "Other"; })],
    ["a boundTo with no symbol fails", plant((l) => { delete l.checks[0].boundTo[0].symbol; })],
    ["a checked dimension bound to no code fails", plant((l) => { l.checks[0].boundTo = []; })],
    ["a divergence quote outside the entry's evidence fails", plant((l) => { l.checks[0].divergenceRecord = { path: "lib/x.ts", quote: "export interface Thing" }; })],
    ["a duplicate id fails", plant((l) => { l.checks.push({ ...l.checks[0] }); })],
    ["a divergence quote not in its record fails", plant((l) => { l.checks[0].divergenceRecord.quote = "made up"; })],
    ["divergenceFound true with no record fails", plant((l) => { delete l.checks[0].divergenceRecord; })],
    ["divergenceFound null with no note fails", plant((l) => { l.checks[0].divergenceFound = null; })],
    ["a tracked live record no entry cites fails", plant((l) => { l.checks[0].evidence = ["lib/x.ts"]; })],
    ["an empty ledger fails", audit({ checks: [] }, tree).problems.length > 0],
    ["a dimension walk under the floor fails", audit(good(), { ...tree, dims: new Set(["d0"]) }).problems.length > 0],
    ["hits count only divergenceFound true", audit(good(), tree).figures.hits === 1 && audit(good(), tree).figures.unchecked.length === DIMENSION_FLOOR - 1],
    ["a divergence quote under 12 characters fails", plant((l) => { l.checks[0].divergenceRecord.quote = "the"; })],
    ["a non-null entry with no dimensions fails", plant((l) => { l.checks[0].dimensions = []; })],
    ["a whitespace-only note fails", plant((l) => { l.checks[0].divergenceFound = null; l.checks[0].note = "  "; })],
    ["a date that is not a real day fails", plant((l) => { l.checks[0].date = "2026-99-99"; })],
    ["an object id fails", plant((l) => { l.checks[0].id = {}; })],
    ["two entries citing the same live record fail", plant((l) => { l.checks.push({ ...l.checks[0], id: "b" }); })],
    ["a declaration only in a line comment fails", plant((l) => { l.checks[0].boundTo[0].symbol = "Phantom"; })],
    ["a declaration only in a block comment fails", plant((l) => { l.checks[0].boundTo[0].symbol = "Ghost2"; })],
    ["a dimension added without its own binding fails", plant((l) => { l.checks[0].dimensions.push("d1"); })],
    ["a binding naming a dimension the entry does not check fails", plant((l) => { l.checks[0].boundTo[0].dimension = "d1"; })],
  ];
  for (const [name, ok] of cases) console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
  const failed = cases.filter(([, ok]) => !ok).length;
  console.log(`wire-truth-ledger self-test: ${cases.length - failed}/${cases.length}`);
  return failed === 0 ? 0 : 1;
}

function main() {
  if (process.argv.includes("--self-test")) process.exit(selfTest());
  let ledger;
  try { ledger = loadLedger(ROOT); } catch (e) { console.error(`✗ ${LEDGER}: ${e.message}`); process.exit(1); }
  const { problems, figures } = audit(ledger, treeOf(ROOT));
  for (const p of problems) console.error(`  ✗ ${p}`);
  if (figures) {
    console.log(`wire-truth-ledger: ${figures.checks} checks, ${figures.hits} with a recorded divergence; ${figures.checked}/${figures.dimensions} dimensions live-checked, ${figures.unchecked.length} not; ${problems.length} problems`);
    console.log(`  no live check: ${figures.unchecked.join(", ")}`);
  }
  process.exit(problems.length === 0 ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
