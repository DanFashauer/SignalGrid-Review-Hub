// Posed-bound gate — a caller-posed NUMERIC bound may not be read with `??`.
//
//   node scripts/check-posed-bounds.mjs             the guard (self-test runs first)
//   node scripts/check-posed-bounds.mjs --self-test prove the guard can fail
//
// WHY THIS EXISTS
// ---------------
//     const staleHours = options.staleSignatureHours ?? STALE_SIGNATURE_HOURS_DEFAULT;
//
// `??` falls back only on null and undefined, so a NaN or Infinity bound sails
// through it into the comparison and switches the check OFF — `x >= NaN` is false,
// and every finite x is less than Infinity. Not a raise, not a fallback: the
// evaluator reaches its clean verdict having skipped the test that would have
// objected. The fix, and the record of the three families this actually graded
// wrong, is lib/integrations/src/utils/posed-bound.ts.
//
// WHAT IS GATED (unambiguous only)
// --------------------------------
// In a file under `lib/**` that EXPORTS an `evaluate*` or `derive*` function — the
// scope is DERIVED from that export, never hand-listed — a line matching
//
//     (options|opts)[?].<name> ?? <IDENT>
//
// where <IDENT> ends in _DEFAULT, _SECONDS, _HOURS, _MS, _MINUTES or _DAYS, AND
// <name>'s declared type resolves to `number`. The optional-chaining spelling
// `options?.staleMs ?? BOUND` counts — it is the same defect, and the first cut of
// this gate missed it. The type is resolved from the same file or from its
// `./types` import. If the type cannot be resolved AT ALL the line is flagged
// anyway, marked "type unresolved" — failing closed is the entire subject of this
// gate and it would be absurd for the gate itself to fail open.
//
// WHAT IS DELIBERATELY NOT GATED, said out loud
// ---------------------------------------------
//  - `?? true` / `?? false` and any option whose declared type is not `number`.
//    A boolean flag has no comparison to switch off; `reporting ?? true` is correct
//    and idiomatic and flagging it would punish correct code.
//  - Any read outside an evaluator/deriver file. A `?? DEFAULT_PAGE_SIZE` in a
//    transport is not a decision bound. Those are REPORTED below, never gated.
//  - Every lexical shape other than `<options|opts>[?].<name> ?? <BOUND>`: a ternary
//    `cond ? options.x : BOUND`, a destructured default `{ x = DEFAULT }`, and a bound
//    read into a const on one line and `??`'d on a later one are all missed today.
//  - Anything requiring dataflow. This is single-line lexical matching: a bound that
//    reaches its comparison through a helper, or is validated on a later line, is not
//    seen. That limit is real and is written here rather than left to be discovered.
//  - Comments and string-literal CONTENTS are blanked before matching. This gate,
//    posed-bound.ts's own header, and the fix commits all quote the defective shape
//    verbatim while explaining it. A gate that fires on the prose explaining the bug
//    punishes writing the explanation down — which is the failure mode this
//    repository has hit three times in one day.
//
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sanitize } from "./lib/sanitize.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = "lib";
const SKIP = /(^|\/)(node_modules|dist|build|coverage|\.git|third_party)(\/|$)/;
const SRC = /\.(ts|mts)$/;
const DECL = /\.d\.ts$/;

// The helper this gate's remediation text names. A gate that points at a fix which
// does not exist is a dead end dressed as advice, so its presence is asserted.
const HELPER = "lib/integrations/src/utils/posed-bound.ts";

// ── the shapes ───────────────────────────────────────────────────────────────
// An evaluator/deriver is identified by its EXPORT, which is what makes the scope
// derived rather than a list that rots. Both spellings the repo uses are accepted.
const EVALUATOR_EXPORT =
  /export\s+(?:async\s+)?function\s+(?:evaluate|derive)\w*|export\s+const\s+(?:evaluate|derive)\w*\s*[:=]/;

// `\??\.` so `options?.staleMs ?? BOUND` matches as well as `options.staleMs ?? BOUND`.
// Optional chaining does not change the defect in the slightest — `?.` yields undefined
// only when the OBJECT is missing, and a NaN read off a present object still walks
// through the `??` — and the first cut of this gate did not match it.
const POSED = /\b(?:options|opts)\??\.(\w+)\s*\?\?\s*([A-Za-z_$][\w$]*)/g;
const BOUND_SUFFIX = /_(?:DEFAULT|SECONDS|HOURS|MS|MINUTES|DAYS)$/;
const ALL_CAPS = /^[A-Z][A-Z0-9_]*$/;

/**
 * Resolve an option's declared type from one or more sanitized sources.
 * Returns "number", some other type string, or null when nothing declares it.
 */
function declaredType(name, sources) {
  const re = new RegExp(String.raw`(?:^|[\s{;,(])${name}\s*\??\s*:\s*([^;\n,)=]+)`, "m");
  for (const src of sources) {
    if (!src) continue;
    const m = re.exec(src);
    if (m) return m[1].trim();
  }
  return null;
}

/**
 * The detector. `typesSource` is the sanitized `./types` sibling when the file
 * imports one — passed in rather than read here so the self-test can drive the
 * exact same code path with planted text.
 */
function findPosedBoundReads(source, typesSource) {
  const clean = sanitize(source);
  const cleanTypes = typesSource === undefined ? undefined : sanitize(typesSource);
  const lines = clean.split("\n");
  const hits = [];
  lines.forEach((line, idx) => {
    POSED.lastIndex = 0;
    let m;
    while ((m = POSED.exec(line)) !== null) {
      const [, name, ident] = m;
      // `?? true`, `?? false`, `?? []`, `?? someLocal` never reach here: the
      // fallback must be an ALL-CAPS constant whose name declares a unit or a
      // default. That is the shape a numeric BOUND is written in.
      if (!ALL_CAPS.test(ident) || !BOUND_SUFFIX.test(ident)) continue;
      const type = declaredType(name, [clean, cleanTypes]);
      if (type === null) {
        hits.push({ line: idx + 1, name, ident, type: "unresolved", text: line.trim() });
        continue;
      }
      // `number`, `number | null`, `number | undefined` all count. Anything else
      // — boolean, string, an enum union — has no comparison to switch off.
      if (!/\bnumber\b/.test(type)) continue;
      hits.push({ line: idx + 1, name, ident, type, text: line.trim() });
    }
  });
  return hits;
}

// ── file walk (scope is derived here, and nowhere else) ──────────────────────
// One recursive readdir, the repo idiom (see check-proof-counts.mjs). It cannot
// prune, so SKIP is applied to each path rather than to the descent; a failed read
// yields an empty list, which the FILE_FLOOR self-test then reports loudly rather
// than passing off as a clean tree.
function sourceFiles(root) {
  let entries;
  try {
    entries = readdirSync(root, { recursive: true, withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && SRC.test(e.name) && !DECL.test(e.name))
    .map((e) => join(e.parentPath, e.name))
    .filter((p) => !SKIP.test(p));
}

/** The `./types` sibling a file imports, sanitized-input-ready (raw text). */
function typesSourceFor(file, clean) {
  if (!/from\s+["']\.\/types["']/.test(clean)) return undefined;
  for (const candidate of [join(dirname(file), "types.ts"), join(dirname(file), "types", "index.ts")]) {
    const abs = join(repo, candidate);
    if (existsSync(abs)) return readFileSync(abs, "utf8");
  }
  return undefined;
}

const allFiles = sourceFiles(join(repo, ROOT)).map((p) => p.slice(repo.length + 1));
const scoped = [];
const outOfScope = [];
for (const f of allFiles) {
  let raw;
  try {
    raw = readFileSync(join(repo, f), "utf8");
  } catch {
    continue;
  }
  const clean = sanitize(raw);
  const entry = { file: f, raw, clean };
  (EVALUATOR_EXPORT.test(clean) ? scoped : outOfScope).push(entry);
}

// ── self-test ────────────────────────────────────────────────────────────────
// Mutation-shaped: the real file passes, the SAME file with the defect planted
// fails. A gate that has only ever been run against a clean tree has proven that
// it is silent, not that it is correct.
const RTLS = "lib/integrations/src/integrations/rtls-custody/evaluate.ts";

// Floors are deliberately well below the measured counts (466 files, 67 evaluators
// on 2026-09-01) so ordinary growth and refactoring do not trip them; they exist to
// catch a derivation that has BROKEN, not one that has moved.
const FILE_FLOOR = 300;
const EVALUATOR_FLOOR = 40;

function runSelfTest() {
  const failures = [];
  const note = (cond, msg) => {
    if (!cond) failures.push(msg);
  };

  // 1. The helper the remediation text names must exist and export posedBound.
  const helperAbs = join(repo, HELPER);
  note(existsSync(helperAbs), `${HELPER} is missing — this gate advises a fix that does not exist`);
  if (existsSync(helperAbs)) {
    note(
      /export\s+function\s+posedBound/.test(readFileSync(helperAbs, "utf8")),
      `${HELPER} no longer exports posedBound — the advised fix has been renamed or removed`,
    );
  }

  // 2. THE MUTATION, on the real tree. The rtls-custody evaluator uses posedBound
  //    and must be clean; plant a `??` bound into an in-memory copy of it — in BOTH
  //    spellings, plain and optional-chained — and both must be caught.
  const rtlsAbs = join(repo, RTLS);
  if (!existsSync(rtlsAbs)) {
    failures.push(`${RTLS} is missing — the mutation fixture this gate self-tests with is gone`);
  } else {
    const rtls = readFileSync(rtlsAbs, "utf8");
    note(
      findPosedBoundReads(rtls, undefined).length === 0,
      `${RTLS} is UNMODIFIED and must pass, but the detector flagged it`,
    );
    const planted = rtls.replace(
      /(export function evaluateCustodyPosture[^\n]*\n)/,
      "$1  const staleFix = options.staleFixSeconds ?? STALE_FIX_SECONDS_DEFAULT;\n" +
        "  const staleFixOpt = options?.staleFixSeconds ?? STALE_FIX_SECONDS_DEFAULT;\n",
    );
    note(planted !== rtls, `could not plant the mutation into ${RTLS} — its shape changed`);
    const caught = findPosedBoundReads(planted, undefined);
    note(
      caught.some((h) => h.name === "staleFixSeconds" && h.ident === "STALE_FIX_SECONDS_DEFAULT" && !h.text.includes("?.")),
      "the planted `options.staleFixSeconds ?? STALE_FIX_SECONDS_DEFAULT` was NOT flagged",
    );
    note(
      caught.some((h) => h.name === "staleFixSeconds" && h.ident === "STALE_FIX_SECONDS_DEFAULT" && h.text.includes("options?.")),
      "the planted `options?.staleFixSeconds ?? STALE_FIX_SECONDS_DEFAULT` was NOT flagged — the optional-chaining spelling is the one the first cut of this gate missed",
    );
    note(
      caught.every((h) => h.type !== "unresolved"),
      "the planted bound resolved as 'type unresolved' — same-file `staleFixSeconds?: number` was not found",
    );
  }

  // 3. Controls. Each is a shape that MUST stay clean, and each is here because
  //    flagging it would punish correct or honest code.
  const controls = [
    ["boolean literal fallback", "interface O { tracked?: boolean }\nconst t = options.tracked ?? true;"],
    ["boolean const fallback", "interface O { verbose?: boolean }\nconst v = options.verbose ?? VERBOSE_DEFAULT;"],
    ["false literal fallback", "interface O { strict?: boolean }\nconst s = opts.strict ?? false;"],
    ["string const fallback", 'interface O { baseUrl?: string }\nconst r = opts.baseUrl ?? GRAPH_V1_ROOT;'],
    // The widening to optional chaining must not cost the boolean exemption.
    ["optional chaining, boolean literal", "interface O { tracked?: boolean }\nconst t = options?.tracked ?? true;"],
    ["optional chaining, boolean const", "interface O { verbose?: boolean }\nconst v = opts?.verbose ?? VERBOSE_DEFAULT;"],
    ["the posedBound idiom itself", "interface O { staleMs?: number }\nconst b = posedBound(options.staleMs, STALE_MS_DEFAULT);"],
    ["lowercase local fallback", "interface O { staleMs?: number }\nconst b = options.staleMs ?? fallbackMs;"],
    ["a comment describing the bug", "// was: options.staleSignatureHours ?? STALE_SIGNATURE_HOURS_DEFAULT"],
    ["a string quoting the bug", 'const doc = "options.staleMs ?? STALE_MS_DEFAULT is the defect";'],
    ["an unsuffixed constant", "interface O { retries?: number }\nconst r = options.retries ?? RETRIES;"],
  ];
  for (const [label, src] of controls) {
    const hits = findPosedBoundReads(src, undefined);
    note(hits.length === 0, `control "${label}" was flagged (${hits.length} hit(s)) — it must not be`);
  }

  // 4. Positives, so the detector is proven able to speak as well as stay silent.
  const positives = [
    ["same-file number", "interface O { staleMs?: number }\nconst b = options.staleMs ?? STALE_MS_DEFAULT;", "number"],
    ["opts. spelling", "interface O { budgetSeconds: number }\nconst b = opts.budgetSeconds ?? BUDGET_SECONDS_DEFAULT;", "number"],
    ["unresolved type fails CLOSED", "const b = options.mysteryHours ?? MYSTERY_HOURS_DEFAULT;", "unresolved"],
    // The shape the first cut of this gate did not match. `?.` guards a missing
    // OBJECT; a NaN read off a present one still walks through the `??` untouched.
    ["optional chaining", "interface O { staleMs?: number }\nconst b = options?.staleMs ?? STALE_MS_DEFAULT;", "number"],
    ["optional chaining, opts. spelling", "interface O { dwellHours?: number }\nconst b = opts?.dwellHours ?? DWELL_HOURS_DEFAULT;", "number"],
    // THE LIVE DEFECT, pinned verbatim. This is the line the gate was written for:
    // edr-threat/evaluate.ts:65 at d8170a2, where a NaN staleSignatureHours graded
    // decade-old signatures `protected`. It is kept as a fixture rather than left to
    // the tree scan so that fixing the file — which is the point — does not quietly
    // remove the only evidence this detector ever caught anything real.
    [
      "edr-threat:65 as it stood at d8170a2",
      "interface EvaluateThreatOptions { staleSignatureHours?: number }\n" +
        "const staleHours = options.staleSignatureHours ?? STALE_SIGNATURE_HOURS_DEFAULT;",
      "number",
    ],
  ];
  for (const [label, src, expectType] of positives) {
    const hits = findPosedBoundReads(src, undefined);
    note(hits.length === 1, `positive "${label}" produced ${hits.length} hit(s), expected 1`);
    if (hits.length === 1) {
      note(
        hits[0].type === expectType || (expectType === "number" && /\bnumber\b/.test(hits[0].type)),
        `positive "${label}" resolved type "${hits[0]?.type}", expected "${expectType}"`,
      );
    }
  }

  // 5. Type resolution through the `./types` import, driven with planted text.
  const viaTypes = findPosedBoundReads(
    'import type { O } from "./types";\nconst b = options.dwellSeconds ?? DWELL_SECONDS_DEFAULT;',
    "export interface O { dwellSeconds?: number }",
  );
  note(viaTypes.length === 1 && /\bnumber\b/.test(viaTypes[0]?.type ?? ""), "a type declared in ./types was not resolved");

  // 6. Floors. A derivation that has quietly stopped resolving files reports a
  //    clean tree it never read.
  note(
    allFiles.length >= FILE_FLOOR,
    `only ${allFiles.length} files found under ${ROOT}/ (floor ${FILE_FLOOR}) — the walk is not reaching the tree`,
  );
  note(
    scoped.length >= EVALUATOR_FLOOR,
    `only ${scoped.length} evaluator/deriver files derived (floor ${EVALUATOR_FLOOR}) — the export pattern no longer matches`,
  );
  return failures;
}

const selfTestFailures = runSelfTest();
if (selfTestFailures.length > 0) {
  console.error("✗ SELF-TEST FAILED — this gate is not checking what it claims to check:\n");
  for (const f of selfTestFailures) console.error(`    · ${f}`);
  console.error(
    "\n  The parse or the derivation has drifted. Nothing below this line can be\n" +
      "  trusted, so no verdict is issued at all.",
  );
  process.exit(1);
}

if (process.argv.includes("--self-test")) {
  console.log(
    `PASS  self-test — ${RTLS} passes unmodified and FAILS with one \`??\` bound planted in it; ` +
      "both `options.x` and `options?.x` are caught; boolean, string, comment and " +
      "string-literal controls stay clean; an unresolvable type fails closed.",
  );
  process.exit(0);
}

// ── the scan ─────────────────────────────────────────────────────────────────
const gated = [];
for (const { file, raw, clean } of scoped) {
  for (const h of findPosedBoundReads(raw, typesSourceFor(file, clean))) gated.push({ file, ...h });
}

// REPORTED, never gated: the same shape outside an evaluator. A transport's page
// size is not a decision bound, and gating it would be claiming this gate holds
// something it does not. Named anyway, because a reader deserves to know the
// shape exists elsewhere rather than infer from silence that it does not.
const reported = [];
for (const { file, raw, clean } of outOfScope) {
  for (const h of findPosedBoundReads(raw, typesSourceFor(file, clean))) reported.push({ file, ...h });
}

console.log("Posed bounds — a caller-posed numeric bound may not be read with `??`\n");

for (const h of gated) {
  console.error(
    `  ✗ ${h.file}:${h.line}  (${h.name}: ${h.type})\n` +
      `      ${h.text}\n` +
      `      NaN and Infinity pass \`??\` untouched, so a garbled bound switches the\n` +
      `      comparison OFF rather than falling back. Use posedBound(${h.name}, ${h.ident})\n` +
      `      from ${HELPER} and resolve the axis to its unknown/raising member on null.`,
  );
}

if (reported.length > 0) {
  console.log(
    `\n  REPORTED (not gated) — the same shape outside an evaluate*/derive* file.\n` +
      `  Judge these by hand; a bound that never reaches a decision comparison is not\n` +
      `  this gate's business:`,
  );
  for (const h of reported) console.log(`    · ${h.file}:${h.line}  ${h.text}`);
}

console.log(
  `\nposed-bounds: ${allFiles.length} files under ${ROOT}/, ${scoped.length} evaluate*/derive* files gated, ` +
    `${gated.length} violation(s), ${reported.length} reported; self-test green`,
);

if (gated.length > 0) {
  console.error(
    "\nPosed-bound gate FAILED — a bound the caller could not pose readably is a question\n" +
      "this evaluator cannot answer, and it must not be answered optimistically.",
  );
  process.exit(1);
}
console.log("Posed-bound gate passed — every caller-posed numeric bound in an evaluator is read through posedBound.");
