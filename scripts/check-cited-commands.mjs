// check-cited-commands.mjs — a command a document promises must still exist.
//
//   node scripts/check-cited-commands.mjs              # report + gate
//   node scripts/check-cited-commands.mjs --self-test  # prove the gate can fail
//
// `check-cited-paths.mjs` already fails the build when a document cites a repo
// PATH that does not exist. Nothing did the same for the commands documents
// cite, and this estate cites 129 distinct ones — including in
// `docs/SECURITY_QUESTIONNAIRE_PACK.md`, which answers security assessors by
// naming the exact gate that makes each claim true.
//
// That is the highest-stakes document class here: a renamed npm script would
// silently turn "this is enforced by `pnpm run X`" into a promise no one can
// run, and the reader most likely to try it is the one deciding whether to
// trust the product. The compliance-analyst shift that found this checked all
// 129 by hand and every one resolved — the defect is not that a citation is
// broken today, it is that nothing keeps them resolving tomorrow.
//
// TOLERATED, because the repository already handles both correctly and a gate
// that fought its own docs would be turned off:
//   * GLOB citations (`pnpm run proof:*`) — prose about a family, not a command.
//   * HISTORICAL citations — a line struck through, or carrying a word like
//     retired / deleted / historical / superseded / no longer. `autopilot:
//     backlog-check` is cited three times this way after its script was deleted,
//     and each one is honest. Same reasoning as the figure guard exempting a
//     number introduced by "was" or "previously".

import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const CITATION = /pnpm(?:\s+--filter\s+\S+)?\s+run\s+([a-z0-9:_-]+)/g;
const HISTORICAL = /~~|\b(retired|deleted|historical|superseded|no longer|used to|formerly)\b/i;

/**
 * Pure audit. files: [{ path, text }]; scripts: Set of defined script names.
 * Returns { problems, checked, exempt }.
 */
export function auditCitedCommands(files, scripts) {
  const problems = [];
  const checked = new Set();
  const exempt = [];
  for (const { path, text } of files) {
    text.split("\n").forEach((line, i) => {
      for (const m of line.matchAll(CITATION)) {
        const name = m[1];
        const where = `${path}:${i + 1}`;
        // A family glob is prose about a set of commands, not a command.
        if (line.includes(`${name}*`)) {
          exempt.push(`${where}: \`${name}*\` (glob)`);
          continue;
        }
        if (scripts.has(name)) {
          checked.add(name);
          continue;
        }
        // An honestly-marked dead command is a record, not a promise.
        if (HISTORICAL.test(line)) {
          exempt.push(`${where}: \`${name}\` (marked historical)`);
          continue;
        }
        problems.push(`${where}: cites \`pnpm run ${name}\`, which no package.json defines — a document promising a command nobody can run`);
      }
    });
  }
  return { problems, checked: [...checked], exempt };
}

function selfTest() {
  const checks = [];
  const scripts = new Set(["typecheck", "proof:core"]);
  const f = (text) => [{ path: "d.md", text }];

  let a = auditCitedCommands(f("Run `pnpm run typecheck` before pushing."), scripts);
  checks.push(["a citation to a defined script passes", a.problems.length === 0 && a.checked.length === 1]);

  a = auditCitedCommands(f("Run `pnpm run does-not-exist` first."), scripts);
  checks.push(["a citation to an UNDEFINED script is FATAL", a.problems.some((p) => p.includes("does-not-exist"))]);

  a = auditCitedCommands(f("Every `pnpm run proof:*` script is enumerated."), scripts);
  checks.push(["a family GLOB is exempt, not a broken citation", a.problems.length === 0 && a.exempt.length === 1]);

  a = auditCitedCommands(f("~~`pnpm run old-thing` did the check.~~ (deleted)"), scripts);
  checks.push(["a struck-through dead command is exempt", a.problems.length === 0]);

  a = auditCitedCommands(f("`pnpm run old-thing`   # (historical: retired 2026-08-15)"), scripts);
  checks.push(["a command marked historical is exempt", a.problems.length === 0]);

  a = auditCitedCommands(f("Run `pnpm --filter @workspace/api-server run typecheck`."), scripts);
  checks.push(["a --filter citation resolves the same way", a.problems.length === 0 && a.checked.length === 1]);

  a = auditCitedCommands(f("Use `pnpm run gone-a` and `pnpm run gone-b`."), scripts);
  checks.push(["every broken citation on a line is named, not just the first", a.problems.length === 2]);

  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

const runAsCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (runAsCli && process.argv.includes("--self-test")) process.exit(selfTest());
if (runAsCli) runGate();

function definedScripts() {
  // argv array, never a shell string — the house invariant.
  const manifests = execFileSync("git", ["ls-files", "package.json", "*/package.json", "*/*/package.json"], {
    cwd: repo,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
  const names = new Set();
  for (const m of manifests) {
    const abs = join(repo, m);
    if (!existsSync(abs)) continue;
    try {
      const pkg = JSON.parse(readFileSync(abs, "utf8"));
      for (const k of Object.keys(pkg.scripts ?? {})) names.add(k);
    } catch {
      // A manifest that will not parse is another gate's problem, not this one's.
    }
  }
  return names;
}

function runGate() {
  const scripts = definedScripts();
  const files = execFileSync("git", ["ls-files", "*.md"], { cwd: repo, encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .map((p) => ({ path: p, text: readFileSync(join(repo, p), "utf8") }));

  const { problems, checked, exempt } = auditCitedCommands(files, scripts);

  console.log(
    `Cited commands — ${checked.length} distinct command(s) cited across ${files.length} docs all resolve; ${exempt.length} exempt (globs and honestly-marked historical commands)`,
  );
  if (problems.length > 0) {
    console.error(`\nCited-command check FAILED: ${problems.length} problem(s).`);
    for (const p of problems) console.error(`  ✗ ${p}`);
    console.error("\n  Either restore the script, or mark the citation historical the way the retired curator's is.");
    process.exit(1);
  }
  console.log("\nCited-command check passed — every command a document promises is a command that exists.");
}
