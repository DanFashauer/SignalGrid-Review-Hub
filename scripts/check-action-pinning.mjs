// check-action-pinning.mjs — a mutable tag is somebody else's write access to your CI.
//
//   node scripts/check-action-pinning.mjs              # report + gate
//   node scripts/check-action-pinning.mjs --self-test  # prove the gate can fail
//
// A third-party action referenced by TAG (`foo/bar@v3`) runs whatever that tag
// points at today. The tag is mutable and lives in someone else's account, so a
// compromised maintainer — or a compromised tag — executes arbitrary code inside
// every workflow that names it, with whatever token that job holds. Pinning to a
// commit SHA makes the reference immutable: the code that ran yesterday is the
// code that runs today, and an update becomes a reviewable diff (Dependabot
// updates SHA pins and keeps the `# v3` comment).
//
// The split, deliberately:
//   FATAL      — a THIRD-PARTY action on a mutable tag, or a `docker://` image
//                without a digest. Someone else's namespace, arbitrary code.
//   REPORTED   — a FIRST-PARTY action (actions/*, github/*) on a tag. Compromise
//                there means GitHub itself is compromised, which is the platform
//                the whole estate already trusts; pinning them is defensible but
//                it is a different threat model, so this names them rather than
//                failing the build over them.
//   EXEMPT     — `./`-relative actions defined inside this repository.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW_DIR = join(repo, ".github/workflows");

/** Owners whose tags are trusted at the platform level (see the header). */
export const FIRST_PARTY = new Set(["actions", "github"]);

const SHA = /^[0-9a-f]{40}$/;
const USES = /^\s*(?:-\s*)?uses:\s*(\S+)/;

/**
 * Pure audit over `[{ file, text }]` so the verdict is testable without a
 * filesystem. Returns { problems, reported, pinned }.
 */
export function auditActionPinning(files) {
  const problems = [];
  const reported = [];
  const pinned = [];
  for (const { file, text } of files) {
    text.split("\n").forEach((line, i) => {
      const m = USES.exec(line);
      if (!m) return;
      const ref = m[1];
      const where = `${file}:${i + 1}`;
      if (ref.startsWith("./")) return; // defined in this repository
      if (ref.startsWith("docker://")) {
        if (!ref.includes("@sha256:")) {
          problems.push(`${where}: \`${ref}\` is a container image without a digest — the tag can be repointed at any image`);
        } else pinned.push(where);
        return;
      }
      const at = ref.lastIndexOf("@");
      if (at === -1) {
        problems.push(`${where}: \`${ref}\` names no version at all — it resolves to the action's default branch`);
        return;
      }
      const owner = ref.slice(0, ref.indexOf("/") === -1 ? ref.length : ref.indexOf("/"));
      const version = ref.slice(at + 1);
      if (SHA.test(version)) {
        pinned.push(where);
        return;
      }
      if (FIRST_PARTY.has(owner)) {
        reported.push({ ref, where });
        return;
      }
      problems.push(`${where}: \`${ref}\` is a THIRD-PARTY action on a mutable tag — pin it to a commit SHA with a \`# ${version}\` comment`);
    });
  }
  return { problems, reported, pinned };
}

function selfTest() {
  const checks = [];
  const f = (text) => [{ file: "w.yml", text }];

  let a = auditActionPinning(f("      - uses: foo/bar@" + "a".repeat(40) + " # v3"));
  checks.push(["a third-party action pinned to a SHA passes", a.problems.length === 0 && a.pinned.length === 1]);

  a = auditActionPinning(f("      - uses: foo/bar@v3"));
  checks.push(["a THIRD-PARTY action on a mutable tag is FATAL", a.problems.some((p) => p.includes("THIRD-PARTY"))]);

  a = auditActionPinning(f("      - uses: actions/checkout@v7"));
  checks.push(["a first-party action on a tag is REPORTED, not fatal", a.problems.length === 0 && a.reported.length === 1]);

  a = auditActionPinning(f("      - uses: ./.github/actions/local"));
  checks.push(["a repo-local action is exempt", a.problems.length === 0 && a.reported.length === 0]);

  a = auditActionPinning(f("      - uses: foo/bar"));
  checks.push(["an action with no version at all is FATAL", a.problems.some((p) => p.includes("no version"))]);

  a = auditActionPinning(f("      - uses: docker://alpine:3.19"));
  checks.push(["a container image without a digest is FATAL", a.problems.some((p) => p.includes("without a digest"))]);

  a = auditActionPinning(f("      - uses: docker://alpine@sha256:" + "b".repeat(64)));
  checks.push(["a digest-pinned image passes", a.problems.length === 0]);

  a = auditActionPinning(f("        uses: gitleaks/gitleaks-action@v3\n        uses: pnpm/action-setup@v6"));
  checks.push(["every offending line is named, not just the first", a.problems.length === 2]);

  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

const runAsCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (runAsCli && process.argv.includes("--self-test")) process.exit(selfTest());
if (runAsCli) runGate();

function runGate() {
  const files = readdirSync(WORKFLOW_DIR)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .map((f) => ({ file: `.github/workflows/${f}`, text: readFileSync(join(WORKFLOW_DIR, f), "utf8") }));
  const { problems, reported, pinned } = auditActionPinning(files);

  console.log(`Action pinning — ${files.length} workflow file(s), ${pinned.length} immutable reference(s), ${reported.length} first-party tag reference(s)`);

  // Grouped, not line-by-line: sixty enumerated lines is noise nobody reads, and
  // a report nobody reads is the same as no report.
  const byAction = new Map();
  for (const { ref } of reported) {
    const [name, version] = [ref.slice(0, ref.lastIndexOf("@")), ref.slice(ref.lastIndexOf("@") + 1)];
    if (!byAction.has(name)) byAction.set(name, new Map());
    const versions = byAction.get(name);
    versions.set(version, (versions.get(version) ?? 0) + 1);
  }
  if (byAction.size > 0) {
    console.log("\n  FIRST-PARTY on tags (allowed — GitHub's own namespace; named so the choice stays visible):");
    for (const [name, versions] of [...byAction].sort()) {
      const parts = [...versions].sort().map(([v, n]) => `${v}\u00d7${n}`).join(", ");
      console.log(`    \u00b7 ${name} — ${parts}`);
    }
  }

  // Two majors of the same action in one estate means an update landed in some
  // workflows and not others — the drift that makes "we run the same CI" false.
  const split = [...byAction].filter(([, versions]) => versions.size > 1);
  if (split.length > 0) {
    console.log("\n  VERSION DRIFT — the same action pinned at different majors (reported, never fatal):");
    for (const [name, versions] of split) {
      const where = reported.filter((r) => r.ref.startsWith(`${name}@`)).map((r) => `${r.where.split(":")[0].replace(".github/workflows/", "")}@${r.ref.split("@")[1]}`);
      console.log(`    \u00b7 ${name}: ${[...versions.keys()].sort().join(" vs ")} — ${[...new Set(where)].join(", ")}`);
    }
  }
  if (problems.length > 0) {
    console.error(`\nAction pinning check FAILED: ${problems.length} problem(s).`);
    for (const p of problems) console.error(`  ✗ ${p}`);
    console.error("\n  Resolve a tag to its commit:  git ls-remote https://github.com/OWNER/REPO refs/tags/TAG^{}");
    process.exit(1);
  }
  console.log("\nAction pinning check passed — every third-party action is pinned to an immutable commit.");
}
