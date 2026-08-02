// CORE normalization-version generator — a provenance stamp that cannot be written by hand.
//
//   node scripts/generate-core-normalization-version.mjs           # regenerate both artifacts
//   node scripts/generate-core-normalization-version.mjs --check    # regenerate + fail on drift
//
// WHY. An adversarially-verified audit (intake ledger row 27) found that nothing in
// the fabric records WHICH VERSION of the code produced a normalized record.
// `EvidenceSnapshot`, `Decision` and the /v1 `EvaluateResult` stamp only
// `policyVersion` — the rules that were applied, never the code that derived the
// facts they were applied to. A replayed decision could therefore be reproduced
// against a policy version while the derivation beneath it had silently changed.
//
// WHY IT IS GENERATED AND NOT A CONSTANT SOMEBODY BUMPS. Three designs were put
// through four refute-by-default critics each, and the hand-set-constant-plus-pin
// design was killed by a specific attack: its pin is a committed JSON file, and a
// text editor is a second writer. A human who edits the source and then pastes the
// printed digest under an unchanged version satisfies every conjunct the checker
// tests. There is no consistent pair a human can write that THIS generator will
// reproduce, because it recomputes the digest FROM SOURCE and derives the integer
// from the comparison. That is the whole design.
//
// WHAT THE VERSION CLAIMS — one direction only, and the asymmetry is deliberate:
//
//     same value      => the covered core source was byte-identical
//     different value => SOMETHING in the core decision path changed,
//                        not necessarily normalization itself
//
// The covered set is a mechanical import closure, so it includes files (policy.ts,
// audit.ts, remediation.ts, webhooks.ts) that cannot change an EvidenceSnapshot's
// bytes. Over-inclusion makes the version churn slightly more than it must; it never
// makes the true direction false. Mechanical over-inclusion was chosen over a
// hand-carved boundary because every hand-carved boundary proposed during the design
// pass was demonstrably blind — each one missed `store.ts` and `decision.ts`, the two
// files that actually fix the digested array order.
//
// WHAT IT DELIBERATELY DOES NOT CLAIM — recorded as a refusal, not an omission.
// It does NOT version the ~47 `normalize*` functions under `lib/integrations`.
// `lib/signalgrid-core/package.json` declares ZERO dependencies, so the core
// structurally cannot import them; nothing they produce is persisted or digested;
// and a version on them would therefore appear in no durable artifact where anything
// could ever detect that it was wrong. Unfalsifiable ceremony is precisely the defect
// this stamp exists to close, pointed backwards. Floors F7 and F8 below are the
// self-invalidating half of that refusal: they fail the day it stops being true.
//
// HONEST LIMIT. The integer is "the Nth distinct state of the covered source observed
// on this branch", not a global sequence. Parallel lanes conflict on the artifact and
// resolve by re-running this generator — the same limitation `manifestVersion` has.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { stableStringify } from "./generate-sync-manifest.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CORE_SRC = "lib/signalgrid-core/src";
const ARTIFACT = "artifacts/sync/core-normalization-version.json";
const GENERATED_TS = `${CORE_SRC}/core-normalization-version.ts`;

/** The mint sites. `decision.ts` is the sole caller of buildSnapshot/buildEvidence;
 *  the other three are the only `store.putSignal` producers in the package. A file the
 *  mint path reads cannot be missed by this derivation, because reaching it requires
 *  importing it. */
const ROOTS = ["decision.ts", "connector.ts", "dock.ts", "shift.ts"];

/** The generated file is excluded from its own digest — otherwise the hash would
 *  depend on the value derived from the hash. Floor F6 proves nothing else hides there. */
const SELF = "core-normalization-version.ts";

// ── source normalization ─────────────────────────────────────────────────────
//
// Comments are stripped so that fixing a typo in a doc comment does not force a
// version bump onto every wire record. `check-decision-port-parity.mjs` already
// adjudicated this trade-off for this repository: "a gate that cries wolf gets
// bypassed." The version claims CODE identity, not prose identity.
//
// The stripper is string-aware, and that is load-bearing rather than fussy: this
// codebase is full of string literals containing `//` (URLs, `fixture:` source
// references, regex sources). A naive `//.*$` strip would silently delete half of
// `"https://wfm.local/labor-records"`, and the digest would then be blind to a real
// edit inside the surviving text. Negative control NC-3B pins that it is not naive.
function stripComments(text) {
  let out = "";
  let i = 0;
  const n = text.length;
  let quote = null; // "'", '"', or "`"
  while (i < n) {
    const c = text[i];
    const next = text[i + 1];
    if (quote) {
      out += c;
      if (c === "\\") { out += next ?? ""; i += 2; continue; }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; out += c; i += 1; continue; }
    if (c === "/" && next === "/") {
      while (i < n && text[i] !== "\n") i += 1;
      continue; // leave the newline for the whitespace collapse
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
      i += 2;
      out += " "; // a block comment separates tokens
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** CRLF-normalized, comment-free, whitespace-collapsed source text. */
function normalizeSource(text) {
  return stripComments(text.replace(/\r\n/g, "\n")).replace(/\s+/g, " ").trim();
}

const sha = (s) => createHash("sha256").update(s).digest("hex");

// ── the import closure ───────────────────────────────────────────────────────

/** Relative specifiers this file imports, INCLUDING `import type` — `store.ts` is
 *  reached only that way, and it fixes the digested signal ordering. */
function relativeImports(text) {
  const out = new Set();
  for (const m of text.matchAll(/from\s+["'](\.[^"']*)["']/g)) out.add(m[1]);
  return [...out];
}

function readCore(file) {
  return readFileSync(join(repoRoot, CORE_SRC, file), "utf8");
}

function computeClosure() {
  const seen = new Set();
  const queue = [...ROOTS];
  const bad = [];
  while (queue.length > 0) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    let text;
    try {
      text = readCore(file);
    } catch {
      bad.push(file);
      continue;
    }
    seen.add(file);
    for (const spec of relativeImports(text)) {
      const base = spec.replace(/^\.\//, "");
      if (base.includes("/") || base.startsWith("..")) { bad.push(spec); continue; }
      queue.push(base.endsWith(".ts") ? base : `${base}.ts`);
    }
  }
  return { files: [...seen].sort(), bad };
}

/**
 * `git grep`, with NO MATCHES treated as an empty result rather than an error.
 *
 * git grep exits 1 when nothing matches, and for both tripwires below "nothing
 * matches" is the PASSING state. Letting the throw escape would have made F7 and F8
 * crash on exactly the healthy repository they are meant to bless — the failure mode
 * where a guard is loudest when everything is fine and silent when it is not.
 * A real git failure (a bad pathspec, not a repo) exits 128 and still throws.
 */
function gitGrepLines(args) {
  try {
    return execFileSync("git", ["grep", ...args], {
      cwd: repoRoot, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    }).split("\n").filter(Boolean);
  } catch (err) {
    if (err && err.status === 1) return [];
    throw err;
  }
}

function tracked(pathRel) {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", pathRel], { cwd: repoRoot, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function computeSources() {
  const { files, bad } = computeClosure();
  const covered = files.filter((f) => f !== SELF);
  const sources = covered.map((f) => ({
    path: `${CORE_SRC}/${f}`,
    sha256: sha(normalizeSource(readCore(f))),
  }));
  return { covered, sources, bad, sourcesDigest: sha(stableStringify(sources)) };
}

// ── floors: "the check is broken, not the repo" ──────────────────────────────

function floors({ covered, sources, bad }) {
  const fail = [];
  // F1 — every resolved specifier lands on a tracked file inside the core src.
  if (bad.length > 0) fail.push(`F1: unresolvable or out-of-package import specifiers: ${bad.join(", ")}`);
  for (const s of sources) {
    if (!tracked(s.path)) fail.push(`F1: covered file is not git-tracked: ${s.path}`);
  }
  // F2 — the core declares no dependencies, which is what makes F1 total: it
  // structurally cannot import behaviour from outside the closure.
  const pkg = JSON.parse(readFileSync(join(repoRoot, "lib/signalgrid-core/package.json"), "utf8"));
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.peerDependencies ?? {}) };
  if (Object.keys(deps).length > 0) {
    fail.push(`F2: @workspace/signalgrid-core now declares dependencies (${Object.keys(deps).join(", ")}) — the closure is no longer total, re-derive the scope`);
  }
  // F3 — named members, not a count. A cardinality floor would hard-fail a
  // legitimate consolidation; these seven are the ones whose absence means the
  // derivation stopped seeing the mint path.
  for (const need of ["decision.ts", "evidence.ts", "store.ts", "util.ts", "connector.ts", "dock.ts", "shift.ts"]) {
    if (!covered.includes(need)) fail.push(`F3: closure lost ${need} — the derivation is blind to the mint path`);
  }
  // F4 — one mint site. Two means the premise that one integer can describe the
  // snapshot has broken.
  const minters = covered.filter((f) => /export function buildSnapshot\b/.test(readCore(f)));
  if (minters.length !== 1) fail.push(`F4: expected exactly one file exporting buildSnapshot, found ${minters.length} (${minters.join(", ")})`);
  // F5 — no empty bodies, well-formed digests.
  for (const s of sources) {
    if (!/^[0-9a-f]{64}$/.test(s.sha256)) fail.push(`F5: malformed digest for ${s.path}`);
  }
  for (const f of covered) {
    if (normalizeSource(readCore(f)).length === 0) fail.push(`F5: covered file normalizes to empty text: ${f}`);
  }
  // F6 — no logic hides in the self-excluded generated file.
  if (existsSync(join(repoRoot, GENERATED_TS))) {
    const body = normalizeSource(readFileSync(join(repoRoot, GENERATED_TS), "utf8"));
    if (!/^export const CORE_NORMALIZATION_VERSION = \d+ ;?$/.test(body.replace(/;$/, " ;").trim())) {
      fail.push(`F6: the generated file contains something other than the single version export: "${body.slice(0, 80)}"`);
    }
  }
  // F7 — the scope tripwire, and the self-invalidating half of the row-27b refusal.
  // The day anything OUTSIDE the core (and its proof) pushes a signal into the store,
  // signals stop being normalized solely by covered code and the scope must be
  // re-derived. `MemoryStore` and `putSignal` are public exports, so this is live risk.
  const hits = gitGrepLines(["-n", "-E", "\\.putSignal\\(", "--", "*.ts", "*.tsx"]);
  const foreign = hits.filter((h) => !h.startsWith(`${CORE_SRC}/`) && !h.startsWith("scripts/src/"));
  if (foreign.length > 0) {
    fail.push(`F7: putSignal is now called from outside the core: ${foreign.slice(0, 3).join(" | ")} — signals are no longer normalized solely by covered code`);
  }
  // F8 — no persisted signals table. This is what makes the stamp honest across the
  // sync -> evaluate boundary: NormalizedSignal is never persisted, so signals are
  // always normalized by the same build, in the same process, that evaluates them.
  const persistence = gitGrepLines(["-l", "-i", "signals", "--", "lib/persistence/src"]);
  if (persistence.length > 0) {
    fail.push(`F8: lib/persistence now mentions a signals table (${persistence.join(", ")}) — a persisted signal could have been normalized by a different build`);
  }
  return fail;
}

// ── negative controls, run unconditionally on every invocation ───────────────
//
// In-process only: no file writes, no dirty tree. `scripts/mutation-guard.mjs`
// mutates files on disk and a killed run leaves them mutated; this must never do
// that. Run unconditionally rather than behind a --self-test nobody remembers
// (the build-postman.mjs idiom).
function negativeControls({ covered, sources, sourcesDigest }) {
  const fail = [];
  const first = covered[0];
  const firstText = readCore(first);

  // NC-1 — the digest is a function of file TEXT.
  if (sha(normalizeSource(`${firstText}\nconst __nc = 1;\n`)) === sources[0].sha256) {
    fail.push("NC-1: appending a statement did not change the file digest");
  }
  // NC-2 — the digest is a function of MEMBERSHIP.
  if (sha(stableStringify(sources.slice(0, -1))) === sourcesDigest) {
    fail.push("NC-2: dropping a covered member did not change the sources digest");
  }
  // NC-3 — the comment strip does not OVER-fire: adding a comment must not churn.
  if (sha(normalizeSource(`// an added explanatory comment\n${firstText}`)) !== sources[0].sha256) {
    fail.push("NC-3: adding a comment changed the digest — the strip is not working, and every typo fix would bump every wire record");
  }
  // NC-3B — and it does not UNDER-fire either: `//` inside a string is CODE.
  // A naive //.*$ stripper deletes half of "https://x/y" and then cannot see an
  // edit to the surviving text. This is the control that catches that stripper.
  const a = normalizeSource(`const u = "https://wfm.local/labor-records";`);
  const b = normalizeSource(`const u = "https://wfm.local/OTHER-records";`);
  if (a === b) fail.push("NC-3B: a `//` inside a string literal is being treated as a comment — edits inside URLs would be invisible to the digest");
  if (!a.includes("//wfm.local")) fail.push("NC-3B: the string body was mangled by the comment strip");

  // NC-4 — the closure follows imports rather than globbing the directory.
  const globbed = ["auth.ts", "engine.ts", "index.ts", "metrics.ts", "resolution.ts", "seed.ts", "simulate.ts"];
  if (globbed.every((f) => covered.includes(f))) {
    fail.push("NC-4: the closure contains every core file — it is globbing, not following imports");
  }
  // NC-5 — the F7 tripwire matches a call and is not fooled by prose.
  const re = /\.putSignal\(/;
  if (!re.test("store.putSignal({")) fail.push("NC-5: the putSignal tripwire does not match a real call");
  if (re.test("the putSignal method")) fail.push("NC-5: the putSignal tripwire matches prose");

  return fail;
}

// ── generate ─────────────────────────────────────────────────────────────────

const computed = computeSources();
const floorFailures = floors(computed);
const ncFailures = negativeControls(computed);

console.log("Core normalization-version generator\n");
console.log(`  covered core files (import closure from ${ROOTS.join(", ")}):  ${computed.covered.length}`);
console.log(`    ${computed.covered.join(" ")}`);
console.log(`  sourcesDigest: ${computed.sourcesDigest.slice(0, 16)}…`);

if (ncFailures.length > 0) {
  console.error("\n✗ NEGATIVE CONTROLS FAILED — this generator is not measuring what it claims:");
  for (const f of ncFailures) console.error(`    ${f}`);
  process.exit(1);
}
console.log("  negative controls: 6 passed (text, membership, comment over-fire, comment under-fire, closure, tripwire)");

if (floorFailures.length > 0) {
  console.error("\n✗ FLOORS FAILED — the check is broken, or the scope it assumes has changed:");
  for (const f of floorFailures) console.error(`    ${f}`);
  process.exit(1);
}
console.log("  floors: F1–F8 passed");

const artifactPath = join(repoRoot, ARTIFACT);
let previous = null;
try {
  previous = JSON.parse(readFileSync(artifactPath, "utf8"));
} catch {
  /* genesis */
}

const version =
  previous === null
    ? 1
    : previous.sourcesDigest === computed.sourcesDigest
      ? previous.version
      : previous.version + 1;

const artifact = {
  schema: "signalgrid.core-normalization-version/1",
  version,
  sourcesDigest: computed.sourcesDigest,
  sources: computed.sources,
};

const tsBody = `// GENERATED by scripts/generate-core-normalization-version.mjs — do not edit.
// Regenerate with: node scripts/generate-core-normalization-version.mjs
export const CORE_NORMALIZATION_VERSION = ${version};
`;

const artifactBody = `${JSON.stringify(artifact, null, 2)}\n`;
const tsPath = join(repoRoot, GENERATED_TS);

// --check compares CONTENT and writes nothing.
//
// The first design here regenerated the files and then ran `git diff --exit-code` on
// them, mirroring the SBOM/Postman gates. Its negative control caught that this is
// WRONG for a newly-introduced artifact: `git diff` is blind to untracked files, so on
// the very commit that introduces the stamp the gate passes while the version silently
// moves. It also leaves a dirty tree on failure, which is the property that made a
// killed mutation-guard run corrupt this repository earlier today. Comparing content
// depends on no git state and mutates nothing.
if (process.argv.includes("--check")) {
  const problems = [];
  const compare = (label, path, expected) => {
    let actual = null;
    try {
      actual = readFileSync(path, "utf8");
    } catch {
      problems.push(`${label} is missing`);
      return;
    }
    if (actual !== expected) problems.push(`${label} does not match the covered source`);
  };
  compare(ARTIFACT, artifactPath, artifactBody);
  compare(GENERATED_TS, tsPath, tsBody);

  if (problems.length > 0) {
    console.error(
      `\n✗ DRIFT: ${problems.join("; ")}.\n` +
        "  The covered core source changed without the version artifacts being regenerated.\n" +
        "  Run `node scripts/generate-core-normalization-version.mjs` and commit both files.\n" +
        "  Reproduce by hand — note it must be a CODE change, not whitespace or a comment,\n" +
        "  because the digest deliberately ignores both:\n" +
        "    printf '\\nconst __probe = 1;\\n' >> lib/signalgrid-core/src/store.ts \\\n" +
        "      && node scripts/generate-core-normalization-version.mjs --check; \\\n" +
        "       git checkout lib/signalgrid-core/src/store.ts",
    );
    process.exit(1);
  }
  console.log("\nCore normalization-version check passed — artifacts match the covered source.");
  process.exit(0);
}

writeFileSync(artifactPath, artifactBody);
writeFileSync(tsPath, tsBody);

console.log(`\n  CORE_NORMALIZATION_VERSION = ${version}${previous === null ? " (genesis)" : previous.version === version ? " (unchanged)" : ` (was ${previous.version})`}`);
console.log(`  wrote ${ARTIFACT}`);
console.log(`  wrote ${GENERATED_TS}`);
