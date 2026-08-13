// Cited-path check — a document may not point at a file that does not exist.
//
//   node scripts/check-cited-paths.mjs                    # gate this repository
//   node scripts/check-cited-paths.mjs --root /path/repo  # gate any other checkout
//   node scripts/check-cited-paths.mjs --json             # machine-readable
//   node scripts/check-cited-paths.mjs --self-test        # prove the gate can fail
//
// WHY. `check-doc-orphans.mjs` asks whether a reader can REACH a document. This asks
// whether the document, once reached, points anywhere real. Different question, and the
// gap between them is where evidence-shaped nothing lives: a reviewer skims
// `lib/foo/src/index.ts` and reads it as proof; nobody opens it. Two separate outside
// analyses of this repository cited files that do not exist, and every reader
// downstream treated the citations as measurements.
//
// PORTABLE BY CONSTRUCTION. The first version hardcoded `docs/` as the only place
// documents live and a fixed list of source roots — both true here and false almost
// everywhere else, including this owner's other repositories. Now the markdown set
// comes from `git ls-files` (so it follows whatever layout a repo has, and never wanders
// into node_modules), and the source roots are DERIVED from the repo's own top-level
// tracked directories. A repo with `packages/` gets `packages/` for free; this one keeps
// working unchanged.
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SELF_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const ROOT = resolve(flag("--root") ?? SELF_ROOT);
const AS_JSON = argv.includes("--json");

const git = (args, cwd = ROOT) => {
  try {
    return execSync(`git ${args}`, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return "";
  }
};
const lines = (s) => (s ? s.trim().split("\n").filter(Boolean) : []);

/** Top-level tracked directories — the roots a citation may plausibly start with. */
export function deriveRoots(root = ROOT) {
  const tops = new Set();
  for (const f of lines(git("ls-files", root))) {
    const slash = f.indexOf("/");
    if (slash > 0) tops.add(f.slice(0, slash));
  }
  // `src` is added unconditionally: a repo may document a source layout it does not
  // itself contain (a handoff doc for another checkout), and we want those caught or
  // explicitly exempted rather than invisible.
  tops.add("src");
  return [...tops].filter((d) => !d.startsWith(".")).sort();
}

export function buildPattern(roots) {
  const alt = roots.map((r) => r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return new RegExp("`((?:" + alt + ")\\/[A-Za-z0-9._\\/-]+\\.[A-Za-z0-9]{1,6})`", "g");
}

// Citations that legitimately name a path this checkout does not contain. Keep SHORT
// and justified — every entry is a hole, and a hole nobody can explain is a hole
// somebody will widen.
export const ALLOW = [
  /\/dist\//, // build output, gitignored
  /\/build\//,
  /\/node_modules\//,
  /\/target\//, // rust build output
  /\.example$/,
  /\bYOUR_/, // placeholder the reader substitutes
  /<[^>]+>/, // placeholder segment: docs/<name>.md
  /\/\.\.\.\//, // elided middle: native/ios/.../Models.swift — shorthand, not a citation
];

// Directories holding PASTED EXTERNAL MATERIAL rather than authored documentation —
// scraped pages, vendor docs, intake dumps. Their citations describe somebody else's
// tree and are not this repository's claims to keep true. `attached_assets/` is the
// Replit paste convention and is where the private core keeps scraped vendor pages.
// This is a skip with a reason, not a silent exclusion: the count is reported.
export const INTAKE_PREFIXES = ["attached_assets/", "vendor/", "third_party/"];

// Documents whose subject IS another repository, keyed by repo directory name. The
// value names the repo they describe, and it is printed so the exemption stays visible
// rather than silent.
export const CROSS_REPO = {
  "SignalGrid-Review-Hub": {
    "docs/PRIVATE_CORE_HANDOFF.md": "the private core repository (not this public surface)",
    "docs/PRODUCT_CORE_FOUNDATION.md": "the private core repository (not this public surface)",
  },
};

/** Pure: every cited path in `text`, minus the allowed ones. Drives gate and self-test. */
export function citationsIn(text, pattern) {
  const out = [];
  for (const m of text.matchAll(pattern)) {
    const p = m[1];
    if (ALLOW.some((re) => re.test(p))) continue;
    out.push(p);
  }
  return out;
}

/** Pure: which citations do not resolve, given an existence oracle. */
export function missingIn(text, exists, pattern) {
  return citationsIn(text, pattern).filter((p) => !exists(p));
}

export function scanRepo(root) {
  const name = root.split("/").filter(Boolean).pop();
  const roots = deriveRoots(root);
  const pattern = buildPattern(roots);
  const exempt = CROSS_REPO[name] ?? {};
  const docs = lines(git("ls-files -- '*.md' '*.markdown'", root));
  const exists = (p) => existsSync(join(root, p));

  const missing = [];
  const exempted = [];
  let checked = 0;
  let intakeDocs = 0;

  for (const rel of docs) {
    if (INTAKE_PREFIXES.some((p) => rel.startsWith(p))) {
      intakeDocs += 1;
      continue;
    }
    let text;
    try {
      text = readFileSync(join(root, rel), "utf8");
    } catch {
      continue;
    }
    const cites = citationsIn(text, pattern);
    checked += cites.length;
    const bad = cites.filter((p) => !exists(p));
    if (bad.length === 0) continue;
    if (exempt[rel]) exempted.push({ doc: rel, count: bad.length, reason: exempt[rel] });
    else for (const p of bad) missing.push({ doc: rel, path: p });
  }
  return { repo: name, root, docs: docs.length, intakeDocs, roots: roots.length, checked, missing, exempted };
}

function selfTest() {
  const checks = [];
  const pattern = buildPattern(["lib", "scripts", "artifacts", "docs", "vendor_absent"]);
  const none = () => false;
  const all = () => true;

  checks.push([
    "A MISSING CITATION IS CAUGHT — the gate's whole purpose, exercised over real text",
    missingIn("see `lib/ghost/src/index.ts` for detail", none, pattern).length === 1,
  ]);
  checks.push([
    "…and a citation that resolves is NOT reported (the pass is not vacuous)",
    missingIn("see `lib/real/src/index.ts` for detail", all, pattern).length === 0,
  ]);
  checks.push(["multiple citations on one line are each checked", missingIn("`lib/a/x.ts` and `scripts/b/y.mjs`", none, pattern).length === 2]);
  checks.push(["unbackticked prose is NOT a citation", citationsIn("the file lib/foo/src/index.ts is interesting", pattern).length === 0]);
  checks.push(["a path outside the derived roots is NOT a citation", citationsIn("`nowhere/thing/file.ts`", pattern).length === 0]);
  checks.push(["a bare directory is NOT a citation", citationsIn("`lib/signalgrid-core/src/`", pattern).length === 0]);
  checks.push(["the ALLOW list actually allows — a dist path is skipped", citationsIn("`artifacts/api-server/dist/index.mjs`", pattern).length === 0]);
  checks.push(["…and ALLOW is not a blanket pass — a non-dist sibling is still checked", citationsIn("`artifacts/api-server/src/index.ts`", pattern).length === 1]);

  // Portability: the roots must come from the tree, not from a list someone maintains.
  const derived = deriveRoots(SELF_ROOT);
  checks.push(["roots are DERIVED from the tree, and there are plausibly many", derived.length >= 5]);
  checks.push(["…including ones no hardcoded list would have had", derived.includes("lib") && derived.includes("scripts")]);

  checks.push([
    "every cross-repo exemption names the repository it belongs to",
    Object.values(CROSS_REPO).every((docs) => Object.values(docs).every((r) => typeof r === "string" && r.length > 12)),
  ]);
  checks.push([
    "every cross-repo exemption names a document that exists — a stale exemption is a hole",
    Object.entries(CROSS_REPO).every(([repo, docs]) =>
      repo !== "SignalGrid-Review-Hub" ? true : Object.keys(docs).every((d) => existsSync(join(SELF_ROOT, d))),
    ),
  ]);

  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

// Guarded on being the entry point: `scan-estate-citations.mjs` imports `scanRepo` from
// here, and a module that gates its own repository as a side effect of being imported
// makes every consumer's exit code a lie about the wrong tree.
const isEntry = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (!isEntry) {
  // exported API only
} else if (argv.includes("--self-test")) {
  process.exit(selfTest());
} else {
  runCli();
}

function runCli() {
const r = scanRepo(ROOT);

if (AS_JSON) {
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.missing.length > 0 ? 1 : 0);
}

if (r.exempted.length > 0) {
  console.log("Cross-repo citations, exempted by declaration (not silently):");
  for (const e of r.exempted) console.log(`  · ${e.doc} — ${e.count} path(s) describing ${e.reason}`);
  console.log("");
}

if (r.missing.length > 0) {
  console.error(`Cited-path check FAILED for ${r.repo}: ${r.missing.length} citation(s) point at nothing.\n`);
  for (const { doc, path } of r.missing.slice(0, 60)) console.error(`  ✗ ${doc}  →  ${path}`);
  if (r.missing.length > 60) console.error(`    … and ${r.missing.length - 60} more`);
  console.error("\nA citation that points nowhere reads as evidence and is not.");
  console.error("Fix the path, remove the citation, or — if the document is about another");
  console.error("repository — declare it in CROSS_REPO with the repo it belongs to.");
  process.exit(1);
}
console.log(`Cited-path check passed — ${r.checked} citation(s) across ${r.docs} docs in ${r.repo} all resolve.`);
}
