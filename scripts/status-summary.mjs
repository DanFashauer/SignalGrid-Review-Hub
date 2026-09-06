#!/usr/bin/env node
// Solution status summary — one paste-ready report of whether the whole system is
// consistent, current, and flowing as intended.
//
//   node scripts/status-summary.mjs           # fast gates (seconds)
//   node scripts/status-summary.mjs --full    # + the heavy preflight (typecheck/build/proofs/E2E)
//   node scripts/status-summary.mjs --write   # rewrites STATUS.md (there is no --md flag; docs/VALIDATION_COMMANDS.md carried one until 2026-09-06)
//
// WHY THIS EXISTS. A status report is only worth pasting if it cannot overstate.
// This script therefore reports EXACTLY what it ran and nothing else: every gate is
// executed live, and anything not executed is printed as `not run` rather than
// silently omitted or assumed green. A summary that quietly drops a failing gate is
// worse than no summary, because it launders a regression into a clean bill of
// health — the same reasoning behind the repo's proof-count and FIGURE guards.
//
// It deliberately does NOT re-implement any check. It shells out to the same gates
// CI and preflight use, so this can never drift from them.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const full = process.argv.includes("--full");
// `--write` commits the report to docs/STATUS.md so a reader who is NOT running
// this command — another agent session, a reviewer, anyone reading the repo —
// sees the same numbers straight from the tooling.
const write = process.argv.includes("--write");

/** Run a gate. Returns {status, detail} — never throws, never guesses. */
function gate(name, cmd, args, { skip = false, reason = "" } = {}) {
  if (skip) return { name, status: "not run", detail: reason };
  const r = spawnSync(cmd, args, { cwd: repoRoot, encoding: "utf8", timeout: 30 * 60_000 });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  // A gate that was ASKED to run but couldn't spawn is a failure, not "not run" —
  // "not run" is reserved for gates deliberately skipped WITH a reason. Reporting
  // a spawn error as "not run" would let a broken gate read as merely deferred.
  if (r.error) return { name, status: "FAIL", detail: `could not run: ${r.error.message}` };
  return { name, status: r.status === 0 ? "pass" : "FAIL", detail: out.trim().split("\n").filter(Boolean).slice(-1)[0] ?? "" };
}

/** Run git with an argument VECTOR — never interpolate values into a shell string.
 *  Branch names are attacker-influencable text; execSync(`git ls-remote origin ${branch}`)
 *  is a command injection the moment a branch is named `x; rm -rf .`. */
function gitOut(args) {
  const r = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  return r.status === 0 ? (r.stdout ?? "").trim() : "";
}

// ── repo state ────────────────────────────────────────────────────────────────
const branch = gitOut(["rev-parse", "--abbrev-ref", "HEAD"]);
const head = gitOut(["rev-parse", "--short", "HEAD"]);
const baseRef = gitOut(["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]).replace("refs/remotes/", "") || "origin/SignalGrid_Alpha";
// The behind/ahead numbers are only meaningful against a FRESH origin. If the
// fetch fails (offline, auth), say so explicitly instead of quietly reporting
// counts from a stale cached ref — a green verdict over stale repo state would
// misreport how current the checkout is (adversarial-review finding).
const fetchResult = spawnSync("git", ["fetch", "origin", "--quiet"], { cwd: repoRoot, encoding: "utf8" });
const originFresh = fetchResult.status === 0;
const counts = gitOut(["rev-list", "--left-right", "--count", `${baseRef}...HEAD`]).split(/\s+/);
const behind = originFresh ? (counts[0] ?? "?") : "unverified";
const ahead = originFresh ? (counts[1] ?? "?") : "unverified";
const dirty = gitOut(["status", "--porcelain"]).split("\n").filter(Boolean).length;
const localHead = gitOut(["rev-parse", "HEAD"]);
// Push status is TRI-STATE. A failed or empty `ls-remote` — offline, no remote
// credentials, a detached HEAD, or simply no matching remote ref — does NOT mean "local
// is ahead"; it means the relationship is UNKNOWN. Only a SUCCESSFUL lookup that returns
// a ref hash lets us assert pushed/not-pushed, and even then a mismatch means "differs"
// (ahead, behind, OR diverged), never specifically "ahead". (Adversarial-review finding:
// an empty ls-remote was collapsed to false and reported as "local is ahead of the
// remote", misreporting a branch that may be behind, pushed under another ref, or simply
// unverifiable.)
const lsRemote = spawnSync("git", ["ls-remote", "origin", branch], { cwd: repoRoot, encoding: "utf8" });
const remoteHead = lsRemote.status === 0 ? ((lsRemote.stdout ?? "").trim().split(/\s+/)[0] ?? "") : "";
// A detached checkout reports branch "HEAD", and `git ls-remote origin HEAD`
// then resolves the remote DEFAULT branch — a successful lookup of the wrong ref
// (review finding). Detached ⇒ the relationship is unknown, full stop.
const pushState = branch === "HEAD" || lsRemote.status !== 0 || remoteHead === ""
  ? "unknown"
  : localHead && localHead === remoteHead
    ? "yes"
    : "no";

// ── inventory (facts, not claims) ─────────────────────────────────────────────
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const proofCount = Object.keys(pkg.scripts ?? {}).filter((k) => k.startsWith("proof:")).length;
const e2eDir = path.join(repoRoot, "scripts/src/e2e");
const e2eSpecs = fs.existsSync(e2eDir) ? fs.readdirSync(e2eDir).filter((f) => f.endsWith(".spec.ts")).length : 0;
const workflows = fs.existsSync(path.join(repoRoot, ".github/workflows"))
  ? fs.readdirSync(path.join(repoRoot, ".github/workflows")).filter((f) => f.endsWith(".yml")).length
  : 0;

// ── gates ─────────────────────────────────────────────────────────────────────
const results = [
  gate("Invariants (fail-closed / determinism / Assist / truth)", "node", ["scripts/review-invariants.mjs"]),
  gate("Docs sanity (required docs + unsafe-claim scan)", "node", ["scripts/docs-sanity.mjs"]),
  gate("Guard-registry drift", "node", ["scripts/check-guard-registries.mjs"]),
  gate("Docs↔proof FIGURE guard", "node", ["scripts/check-proof-figures.mjs"]),
  gate("Proof-count sync", "node", ["scripts/check-proof-counts.mjs"]),
  gate("Live-sync manifest (external builders)", "node", ["scripts/check-live-sync.mjs"]),
  gate("Preflight (typecheck, build, all proofs, browser E2E)", "node", ["scripts/preflight.mjs"], {
    skip: !full,
    reason: "heavy — re-run with --full",
  }),
];

// Live-evidence status comes from the live-sync gate's machine-greppable line.
const liveSync = spawnSync("node", ["scripts/check-live-sync.mjs"], { cwd: repoRoot, encoding: "utf8" });
const liveSyncOut = `${liveSync.stdout ?? ""}${liveSync.stderr ?? ""}`;
const evidence = (liveSyncOut.match(/liveEvidence=(\w+)/) ?? [, "unknown"])[1];
const manifestPath = path.join(repoRoot, "artifacts/sync/live-sync-manifest.json");
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : null;

// ── report ────────────────────────────────────────────────────────────────────
const failed = results.filter((r) => r.status === "FAIL");
const notRun = results.filter((r) => r.status === "not run");
// The headline never claims more than the run verified (review finding): a failed
// origin fetch means repo currency — a property this report explicitly states —
// was NOT verified, so an unqualified GREEN would overstate exactly what this
// script exists not to overstate. Origin-unverified qualifies the verdict the
// same way a skipped gate does.
const qualifiers = [];
if (notRun.length) qualifiers.push("see not-run");
if (!originFresh) qualifiers.push("origin unreachable — repo currency unverified");
const verdict = failed.length ? "RED" : qualifiers.length ? `GREEN (partial — ${qualifiers.join("; ")})` : "GREEN";

const L = [];
L.push(`# SignalGrid — solution status`);
L.push("");
L.push(`**Verdict: ${verdict}** · branch \`${branch}\` @ \`${head}\` · generated by \`scripts/status-summary.mjs\`${full ? " --full" : ""}`);
L.push("");
// The staleness tell. A committed status file whose numbers are three commits old
// is the same failure mode as a pinned proof count: it reads as current and is not.
// So it names the commit it describes and says plainly how to check.
L.push(`> This file describes commit \`${head}\`. If \`git rev-parse --short HEAD\` differs,`);
L.push(`> these numbers are STALE — regenerate with \`pnpm run status -- --write\`. Nothing`);
L.push(`> auto-updates it; a status file that silently ages is worse than none.`);
L.push("");
L.push(`## Repo state`);
L.push(`- vs \`${baseRef}\`: **${behind} behind / ${ahead} ahead**${originFresh ? "" : " — **origin could not be reached; repo-state is from a stale cache and is NOT verified current**"}`);
L.push(`- working tree: ${dirty === 0 ? "clean" : `**${dirty} uncommitted change(s)**`}`);
L.push(`- pushed: ${
  pushState === "yes"
    ? "yes — remote matches local"
    : pushState === "no"
      ? "**no — local differs from the remote branch (ahead, behind, or diverged)**"
      : "**unknown — could not read the remote ref (offline, no remote credentials, detached HEAD, or no matching remote branch)**"
}`);
L.push("");
L.push(`## Gates`);
L.push("");
L.push(`| Gate | Result |`);
L.push(`| --- | --- |`);
for (const r of results) {
  const icon = r.status === "pass" ? "✅ pass" : r.status === "FAIL" ? "❌ **FAIL**" : "⚪ not run";
  L.push(`| ${r.name} | ${icon}${r.status === "FAIL" && r.detail ? ` — ${r.detail.slice(0, 120)}` : ""}${r.status === "not run" && r.detail ? ` (${r.detail})` : ""} |`);
}
L.push("");
L.push(`## Live-sync loop (external builders: iOS EnterpriseShell + Mac MCP lane)`);
L.push(`- manifest: ${manifest ? `version **${manifest.manifestVersion}**, fingerprint \`${String(manifest.fingerprint ?? "").slice(0, 16)}…\`` : "**missing**"}`);
L.push(`- real-hardware evidence: **${evidence}**${evidence === "none" ? " — no committed proof a real machine ran both halves against current contracts" : ""}`);
L.push("");

// ── Live-vendor lanes ────────────────────────────────────────────────────────
// These proofs read REAL vendor software rather than fixtures, so they are opt-in
// and skipped by name without their server. That made them invisible in this
// report — a whole evidence category the reader could not see. Derived from
// package.json rather than listed by hand, so a new lane appears here on its own;
// a hand-maintained list is the drift this file exists to avoid.
const LANE_ENV = {
  "proof:live-edr": ["WAZUH_URL", "docs/ZERO_COST_LIVE_TEST_MATRIX.md §6"],
  "proof:live-fleet": ["FLEET_URL", "docs/FLEET_LIVE_INTEGRATION.md"],
  "proof:live-location": ["TRACCAR_URL", "docs/TRACCAR_LIVE_INTEGRATION.md"],
  "proof:live-keycloak": ["KEYCLOAK_URL", "docs/KEYCLOAK_LIVE_INTEGRATION.md"],
};
// Only lanes that need an EXTERNAL server. `proof:live-idp` also begins "live-" but
// runs an in-process oidc-provider and always executes in preflight — listing it as
// "would SKIP" would be a false statement in the one file whose entire purpose is
// not to overstate. So membership comes from LANE_ENV, intersected with the scripts
// that actually exist, and a lane added to package.json without an entry here shows
// up in the mismatch line below rather than being silently dropped.
const declaredLanes = Object.keys(LANE_ENV);
const liveLanes = declaredLanes.filter((s) => s in (pkg.scripts ?? {}));
const undeclared = Object.keys(pkg.scripts ?? {}).filter(
  (s) => s.startsWith("proof:live-") && s !== "proof:live-idp" && !declaredLanes.includes(s),
);
if (liveLanes.length) {
  L.push(`## Live-vendor lanes (opt-in — read real vendor software, not fixtures)`);
  L.push("");
  L.push(`| Lane | Needs | Would run here now? |`);
  L.push(`| --- | --- | --- |`);
  for (const lane of liveLanes.sort()) {
    const [envVar, doc] = LANE_ENV[lane] ?? ["(see docs)", ""];
    const armed = envVar !== "(see docs)" && !!process.env[envVar];
    L.push(`| \`${lane}\` | \`${envVar}\`${doc ? ` — ${doc}` : ""} | ${armed ? "yes (external lab)" : "self-provisions in Docker"} |`);
  }
  L.push("");
  L.push(
    `\`pnpm run verify:live\` stands up what Docker allows, runs those lanes and removes what it started. ` +
      `A lane it cannot provision is reported SKIPPED with the reason — never counted as passed. ` +
      `All four lanes self-provision (Wazuh since 2026-08-21, pinned 4.14.7; its first pull is ~2GB — omit it with --only fleet,location,keycloak).`,
  );
  if (undeclared.length) {
    L.push("");
    L.push(
      `> ⚠️ \`${undeclared.join("`, `")}\` looks like an external lane but has no entry in this ` +
        `report's LANE_ENV — add one, or it goes unlisted and this section quietly under-reports.`,
    );
  }
  L.push("");
}

// Truth-state taxonomy (docs/PURPOSE.md, DR-019). The single most misleading
// thing a repository of this size can do is let "it exists" read as "it works
// with a customer." Four states, derived rather than typed, because a hand-typed
// maturity claim is a fossil the day it is written.
L.push(`## Truth state — what "done" means here`);
L.push("");
L.push(`| State | Meaning | Where SignalGrid is |`);
L.push(`| --- | --- | --- |`);
L.push(`| **Implemented** | Code exists and its proof gate passes | **${proofCount}** proof gates |`);
L.push(`| **Fixture-backed** | Runs on public-safe fixtures; no live tenant, no customer data | **all connectors** |`);
L.push(`| **Live-validated** | Read real vendor software in an opt-in lane | **${liveLanes.length}** lane(s) available; run \`pnpm run verify:live\` for actual results |`);
L.push(`| **Customer-validated** | A named organisation ran it against their own estate | **none** |`);
L.push("");
L.push(`Implemented is not fixture-backed is not live-validated is not`);
L.push(`customer-validated. Nothing here has reached the fourth state, and no`);
L.push(`document, demo or gate can move it there — only a customer can.`);
L.push("");

L.push(`## Inventory`);
L.push(`- proof gates: **${proofCount}** · live-vendor lanes: **${liveLanes.length}** · browser E2E specs: **${e2eSpecs}** · CI workflows: **${workflows}**`);
L.push("");
if (failed.length) {
  L.push(`## What is red`);
  for (const r of failed) L.push(`- **${r.name}** — ${r.detail || "see gate output"}`);
  L.push("");
}
if (notRun.length) {
  L.push(`## Not verified by this run`);
  for (const r of notRun) L.push(`- ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  L.push("");
  L.push(`> Anything listed here was **not executed**, so this report makes no claim about it.`);
  L.push("");
}
L.push(`### Known hardware/licensing gates (cannot be closed in software)`);
L.push(`- On-device MDM enforcement (kiosk / app-allowlist / non-removable) requires a **supervised** iOS device (Apple Business Manager + APNs).`);
L.push(`- Fleet team-transfer enforcement requires **Fleet Premium**; posture read works on open-source Fleet.`);

const report = L.join("\n");
console.log(report);
if (write) {
  const out = path.join(repoRoot, "docs/STATUS.md");
  fs.writeFileSync(out, `${report}\n`);
  console.log(`\n(wrote ${out})`);
}
process.exitCode = failed.length ? 1 : 0;
