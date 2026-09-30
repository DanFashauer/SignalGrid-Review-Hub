// Assessor-package integrity — every door in the package must open.
//
//   node scripts/check-assessor-package.mjs
//
// `docs/SECURITY_REVIEW_PACKAGE.md` is the entry point an external security assessor
// is handed. Its whole value is that following it works: every linked document
// resolves, every named command runs, every named source path exists.
//
// A package that points at a moved file or a renamed script is worse than no package.
// It burns the assessor's first hour, and — the part that actually matters — it reads
// as neglect, which colours everything they find afterwards. This is also the single
// most rot-prone document in the repository: it references more of the tree than
// anything else, and it is read rarely and by outsiders, so nobody notices it decay.
//
// So the links are checked rather than trusted. Three directions:
//
//   1. Every relative markdown link resolves to a real file.
//   2. Every `pnpm run <script>` names a script that actually exists in package.json.
//   3. Every backticked repo path (`lib/…`, `artifacts/…`, `native/…`, `scripts/…`)
//      exists on disk.
//
// Deliberately NOT checked: whether the prose is true. No script can verify that the
// threat model is adequate or that §6 points at the right places. This gate keeps the
// package NAVIGABLE; keeping it honest is a human's job, and saying so here is part of
// not overclaiming what a green means.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PKG = "docs/SECURITY_REVIEW_PACKAGE.md";
const pkgPath = resolve(repoRoot, PKG);

if (!existsSync(pkgPath)) {
  console.error(`assessor-package: ${PKG} is missing.`);
  process.exit(1);
}

const text = readFileSync(pkgPath, "utf8");
const scripts = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).scripts ?? {};

/** The verdict, as a pure function of the package text: every door that does not
 *  open, plus what was checked. `baseDir` is where relative links resolve from. */
function auditPackage(body, baseDir) {
  const failures = [];

  // ── 1. markdown links ──────────────────────────────────────────────────────
  // Relative links only. An external URL is not this gate's business and pinging one
  // would make the check network-dependent and flaky — a gate that fails on a captive
  // portal teaches people to ignore it.
  const links = [...body.matchAll(/\[[^\]]+\]\(([^)#\s]+)(?:#[^)\s]*)?\)/g)].map((m) => m[1]);
  const relative = links.filter((l) => !/^[a-z][a-z0-9+.-]*:/i.test(l));
  for (const l of relative) {
    if (!existsSync(resolve(baseDir, l))) failures.push(`link does not resolve: ${l}`);
  }

  // ── 2. named commands ──────────────────────────────────────────────────────
  const commands = [...new Set([...body.matchAll(/`pnpm run ([a-z0-9:_-]+)`/g)].map((m) => m[1]))];
  for (const c of commands) {
    if (!(c in scripts)) failures.push(`\`pnpm run ${c}\` is named but is not a script in package.json`);
  }

  // ── 3. named source paths ──────────────────────────────────────────────────
  // Backticked paths under the source roots the package sends an assessor to. A
  // trailing `/*` means "this directory, whose children vary" — check the parent.
  // Any backticked path with a slash — NOT a hand-maintained root list. The first
  // version listed lib/artifacts/native/scripts, so a reference to `attached_assets/`
  // (which the package does make) went unchecked: renaming that directory would have
  // left this gate green while the package pointed at nothing. A partial root list is
  // the same defect class as a partial coverage list.
  const paths = [...new Set([...body.matchAll(/`([A-Za-z0-9._-]+\/[A-Za-z0-9._\-/*]*)`/g)].map((m) => m[1]))];
  for (const p of paths) {
    const probe = p.endsWith("/*") ? p.slice(0, -2) : p;
    if (!existsSync(resolve(repoRoot, probe))) failures.push(`source path does not exist: ${p}`);
  }

  return { failures, relative, commands, paths };
}

// ── in-run control ───────────────────────────────────────────────────────────
// One package with a door of each kind broken, one with every door open, on every
// invocation. A verdict that stopped seeing a dead link — a regex drift, a resolve
// against the wrong directory — would otherwise pass the real package forever.
{
  const baseDir = dirname(pkgPath);
  const planted = auditPackage(
    "[gone](./__assessor_control_missing__.md) `pnpm run __assessor_control_no_such_script__` `scripts/__assessor_control_missing__.mjs`",
    baseDir,
  );
  const clean = auditPackage("[root](../package.json) `pnpm run typecheck` `scripts/preflight.mjs`", baseDir);
  if (planted.failures.length !== 3 || clean.failures.length !== 0 || clean.relative.length !== 1) {
    console.error(
      `✗ SELF-TEST FAILED — planted defects caught: ${planted.failures.length}/3, clean package failures: ` +
        `${clean.failures.length} (want 0). The verdict can no longer tell a dead door from an open one; ` +
        "a green from it would be green about nothing.",
    );
    process.exit(1);
  }
}

const { failures, relative, commands, paths } = auditPackage(text, dirname(pkgPath));

console.log("Assessor-package integrity — every door in the package must open\n");
console.log(`  ${PKG}`);
console.log(`    relative links checked:  ${relative.length}`);
console.log(`    pnpm commands checked:   ${commands.length}`);
console.log(`    source paths checked:    ${paths.length}`);

// A package whose references have been quietly emptied out would otherwise pass this
// gate with zero of everything — the same shape as a guard whose coverage list went
// stale. Floors, not exact counts: an exact count here would be the fossil figure the
// figure guard exists to prevent.
if (relative.length < 8) failures.push(`only ${relative.length} relative links found — the package has been gutted, or the link syntax drifted.`);
if (commands.length < 5) failures.push(`only ${commands.length} commands found — an assessor cannot reproduce evidence they are not given.`);

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} problem(s):\n`);
  for (const f of failures) console.error(`    ${f}`);
  console.error(
    "\n  An assessor follows this document literally. A dead link is an hour of their\n" +
      "  time and a first impression that colours every finding after it.",
  );
  process.exit(1);
}

console.log(
  "\n  NOT established by this pass: whether the package is TRUE. No script can check\n" +
    "  that the threat model is adequate or that the 'where to attack first' section\n" +
    "  points anywhere useful. This keeps the package navigable, not honest.",
);
console.log("\nAssessor-package check passed — every link, command and path in the package resolves; in-run control green.");
