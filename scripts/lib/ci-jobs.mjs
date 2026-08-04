// The CI job list, DERIVED — so preflight's "not covered by this harness" disclaimer
// cannot quietly under-report.
//
// WHY THIS EXISTS.
//
// `preflight.mjs` prints, beside its PASSED verdict, the jobs a green preflight says
// nothing about. That sentence is the most load-bearing line the harness emits: it is
// read at the exact moment someone decides to push. It was a hardcoded array of three:
//
//     deploy-stack, durable-persistence, secret-scan
//
// The repo runs NINETEEN CI jobs. CodeQL, the level-10 audit, the connector emulator
// smoke, phase-pr-evidence and the entire iOS suite were all absent from a list whose
// whole purpose is to enumerate what is absent. A reader who takes the disclaimer at
// face value — the only reasonable reading — concludes everything else IS covered.
//
// So the disclaimer had the exact defect the harness around it exists to prevent: a
// coverage claim maintained by hand, drifting silently as the thing it described grew.
// Same shape as the mutation-guard registry that swept the wrong file set and the
// connector-discipline gate that walked directories only. Fixed the same way: derive
// the population, and make the exemptions self-invalidating.
//
// HOW. Jobs are read out of `.github/workflows/`. Each must be classified exactly once:
//
//   MIRRORED    — preflight genuinely runs the same gates locally, so a green preflight
//                 does say something about it.
//   NOT_A_GATE  — cannot fail a pull request on its own merits: deploys, bots,
//                 release automation. Listing these as "uncovered" would be noise that
//                 trains people to skim the section that matters.
//   everything else → printed as UNCOVERED, automatically, forever.
//
// A classified job that no longer exists FAILS `check-preflight-ci-parity.mjs`. An
// exemption that outlives its subject re-permits the gap it was granted for and reads
// as intentional ever after — the rule `check-guard-registries.mjs` established and
// `KNOWN_GAPS` proved on a real fix.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workflowDir = join(repoRoot, ".github", "workflows");

/** Preflight runs these gates locally. Reason = what makes the local run equivalent. */
export const MIRRORED = new Map([
  [
    "review-hub-ci.yml:validation",
    "preflight runs the same typecheck, proofs and safety gates this job runs",
  ],
  [
    "review-hub-ci.yml:docs-sanity",
    "preflight runs the doc-orphan, figure, proof-count and unsafe-claim checks directly",
  ],
  [
    "supply-chain.yml:sbom",
    "preflight asserts the committed CycloneDX SBOM is in sync, which is what this job regenerates",
  ],
]);

/** Cannot fail a PR on its own merits — deploys, bots, release plumbing. */
export const NOT_A_GATE = new Map([
  ["pages.yml:build", "builds the GitHub Pages site; a publish step, not a correctness gate"],
  ["pages.yml:deploy", "publishes to GitHub Pages"],
  ["pr-triage.yml:triage", "labels and summarises the PR; advisory, never blocking"],
  ["promote.yml:open-promotion-pr", "opens a promotion PR between tiers; release automation"],
  [
    "scheduled-verification.yml:verify",
    "cron re-run of the same suite; catches rot over time rather than gating a specific push",
  ],
]);

/** Every job defined in `.github/workflows/`, as `file.yml:job-id`. */
export function enumerateCiJobs() {
  const jobs = [];
  for (const file of readdirSync(workflowDir).filter((f) => /\.ya?ml$/.test(f))) {
    const text = readFileSync(join(workflowDir, file), "utf8");
    const at = text.indexOf("\njobs:");
    if (at < 0) continue;
    const body = text.slice(at);
    for (const m of body.matchAll(/^ {2}([a-zA-Z0-9_-]+):$/gm)) {
      const after = body.slice(m.index + m[0].length, m.index + m[0].length + 400);
      const named = after.match(/^\s+name:\s*(.+)$/m);
      jobs.push({
        id: `${file}:${m[1]}`,
        label: named ? named[1].trim().replace(/^['"]|['"]$/g, "") : m[1],
      });
    }
  }
  return jobs.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Split the derived job list three ways, and report classifications that have gone stale.
 *
 * `stale` is the self-invalidating half: an id in MIRRORED or NOT_A_GATE that no workflow
 * defines any more. Callers are expected to FAIL on it rather than log it.
 */
export function classifyCiJobs() {
  const jobs = enumerateCiJobs();
  const ids = new Set(jobs.map((j) => j.id));
  const uncovered = jobs.filter((j) => !MIRRORED.has(j.id) && !NOT_A_GATE.has(j.id));
  const stale = [...MIRRORED.keys(), ...NOT_A_GATE.keys()].filter((id) => !ids.has(id));
  return { jobs, uncovered, stale };
}

/** One line per uncovered job, padded for the preflight footer. */
export function uncoveredLines() {
  const { uncovered } = classifyCiJobs();
  const width = Math.max(...uncovered.map((j) => j.id.split(":")[1].length), 0);
  return uncovered.map((j) => `${j.id.split(":")[1].padEnd(width)}  (${j.label})`);
}
