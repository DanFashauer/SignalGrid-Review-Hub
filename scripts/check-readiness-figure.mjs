#!/usr/bin/env node
// Readiness figure — the number that gates outreach (DR-036), DERIVED, never typed.
//
//   node scripts/check-readiness-figure.mjs              # REPORT: three dimensions + headline + verdict
//   node scripts/check-readiness-figure.mjs --json       # machine-readable (loop:state reads this)
//   node scripts/check-readiness-figure.mjs --self-test  # prove the derivation can fail
//
// WHY. The owner's rule (2026-09-10): no outreach until the solution is confirmed working —
// floor 80%, target 92–95%, goal 100% — "I don't want to burn contacts or sources when I
// don't have a valid and effective solution that's working." A bar nobody can measure is a
// feeling, and this repository's whole discipline is that numbers come from output. So the
// figure is computed from three sources that already exist, each reported on its own, and the
// headline is the LOWEST of the three — no single easy dimension can carry the product over.
//
//   (a) RUNBOOK GROUND TRUTH — docs/research/SHARED_DEVICE_CUSTODY_GROUND_TRUTH.md maps the
//       real-world workflow steps and failure modes from the owner's own runbooks (DR-034) to
//       what the tree models: `modeled` rows over all rows. `partial` and `gap` count against.
//   (b) LAUNCH SURFACE, EVIDENCE-BOUND — a RATIO since 2026-09-12 (DR-036's named
//       follow-up). Every launch item in scripts/launch-profile.mjs binds the `proof:*`
//       scripts (or, since 2026-09-12, `step:<name>` preflight steps) that certify it
//       (`proofs: [...]`, gated by check-launch-proof-bindings.mjs — `validateBindings`
//       there is called FIRST, below, so a launch item that lost its `proofs` array
//       throws Broken instead of silently shrinking the denominator).
//       Of the DISTINCT proofs/steps the launch items bind, (b) is the share the last
//       full Mac evidence run (artifacts/live-evidence/mac-run.json, minted only by a
//       green preflight + breadth lane AND a green signalgrid-mcp run on real macOS)
//       records as current in `proofs.passed` / `proofs.steps` AGAINST THE MANIFEST THE
//       TREE CARRIES. Preconditions stay: the run must be green on both halves and no
//       older than FRESH_DAYS, else 0. Then, per bound name: no record → 0; a record
//       whose manifest fingerprint (its own, or the file's) is not the current one → 0;
//       for a `proof:*`, its `sourceDigest` (2026-09-12 review finding) must ALSO match
//       what proofSourceDigest recomputes against the CURRENT tree — a manifest
//       fingerprint is a CONTRACT hash and does not move when a proof or the product
//       code it imports changes, so a legacy string-form "passed" record (no digest at
//       all) NEVER counts as current, closing the loophole where such a record could
//       read current for up to FRESH_DAYS regardless of what the code did meanwhile. A
//       `step:*` binding is counted the same way minus the digest requirement (a
//       preflight step is not one file with an import list). A file with no per-proof
//       results at all (minted before the emitter recorded them) → 0/N. A missing field
//       never raises the ratio.
//       Until DR-036 this was binary (100 while green+fresh+current, else 0) because only
//       3 of 23 launch ids matched a proof name and a per-item ratio would have been invented.
//   (c) END-TO-END — the simulator scenarios (declared by the engine, run here) and the live
//       vendor operations (declared in scripts/lib/sim-operations.mjs) that carry at least one
//       PASSED, provenance-bound result in artifacts/sim-results/. The lower of the two.
//
// REPORT, not a gate: it exits 0 on any number and 1 only when a derivation is broken — a
// missing file, an empty table, a scenario runner that cannot start. A broken derivation must
// never read as a number.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
// The CURRENT live-sync manifest fingerprint, computed the SAME WAY check-live-sync.mjs
// does (one source of truth) — dimension (b) only counts evidence that covers it.
import { computeBody, fingerprintOf } from "./generate-sync-manifest.mjs";
// The distinct proofs/steps the launch items bind (the denominator of (b)), the
// fail-closed check that catches an unbound launch item BEFORE that denominator is
// trusted, and the per-proof source-fingerprint derivation — all read through the
// binding gate's own functions so the ratio divides by, and verifies against,
// exactly what that gate certifies.
import { boundProofs, validateBindings, proofScriptFiles, workspacePackageDirs, proofSourceDigest } from "./check-launch-proof-bindings.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const FLOOR = 80, TARGET_LOW = 92, TARGET_HIGH = 95, GOAL = 100, FRESH_DAYS = 7;
const GT = "docs/research/SHARED_DEVICE_CUSTODY_GROUND_TRUTH.md";
const EVIDENCE = "artifacts/live-evidence/mac-run.json";
const RESULTS = "artifacts/sim-results";

class Broken extends Error {}
const pct = (num, den) => (den > 0 ? Math.floor((100 * num) / den) : 0);

/** Pure: modeled / partial / gap counts from the ground-truth table; status is the LAST non-empty cell. */
export function parseGroundTruth(text) {
  const c = { modeled: 0, partial: 0, gap: 0 };
  for (const line of text.split("\n")) {
    if (!line.startsWith("| ")) continue;
    const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((s) => s.trim());
    if (cells.length < 3 || cells[0].startsWith("---") || cells[0] === "Real-world element") continue;
    // Strip markdown emphasis (`**gap**`, `_gap_`) and surrounding whitespace BEFORE
    // classifying. Without this a bold `**gap**` status matched none of the keywords and
    // fell out of the denominator entirely — three real gap rows were invisible, inflating
    // dimension (a). Emphasis is presentation, not status.
    const st = cells.filter(Boolean).pop().toLowerCase().replace(/^[\s*_]+/, "").replace(/[\s*_]+$/, "");
    for (const k of ["modeled", "partial", "gap"]) if (st.startsWith(k)) { c[k] += 1; break; }
  }
  const total = c.modeled + c.partial + c.gap;
  if (total === 0) throw new Broken(`${GT}: no rows with a modeled/partial/gap status — the table shape changed`);
  return { ...c, total, pct: pct(c.modeled, total) };
}

const shortFp = (fp) => (typeof fp === "string" && fp.length > 0 ? fp.slice(0, 12) : "(none)");

/**
 * Pure: evidence dimension — the share of the launch profile's BOUND proofs/steps that
 * the last Mac run records as CURRENT against the CURRENT contract and CURRENT source.
 * `bound` is the distinct list of `proof:*`/`step:*` names the launch items bind
 * (check-launch-proof-bindings.mjs keeps it honest). `currentDigests` is a Map
 * `proof:name -> sourceDigest` recomputed against the CURRENT tree (proofSourceDigest);
 * absent or empty for a run that has none to compare (every such proof simply cannot
 * be current).
 *
 * Run-level preconditions first, each → 0/N with the reason: evidence absent, not green
 * on both halves, older than FRESH_DAYS, or the current fingerprint uncomputable.
 *
 * Then PER NAME, fail-closed:
 *   `step:<name>` → looked up in `evidence.proofs.steps[name]` (bare name, no prefix).
 *   Current when `status === "passed"` and its fingerprint (own, or the file's) equals
 *   `currentFingerprint`. No sourceDigest requirement — a preflight step is not one file
 *   with an import list.
 *   `proof:<name>` → looked up in `evidence.proofs.passed[name]`: the LEGACY string
 *   "passed" (bound only to the file's `manifestFingerprint`, and carrying no
 *   sourceDigest at all) or an object `{ status, manifestFingerprint, sourceDigest }`.
 *   Current only when status is "passed" AND its fingerprint equals `currentFingerprint`
 *   AND its sourceDigest equals `currentDigests.get(name)` — a manifest fingerprint is a
 *   CONTRACT hash and does not move when the proof or the product code it imports
 *   changes, so a string-form record (no digest) can NEVER be current: closing the
 *   loophole where such a record read current for up to FRESH_DAYS regardless of what
 *   the code did in the meantime (2026-09-12 review finding). `reviewHubCommit`, if
 *   present, is recorded for audit only and never compared here.
 * No record → 0 either way. A file whose fingerprint is stale → every record missing a
 * per-record fingerprint of its own is 0 (check-live-sync reports the evidence STALE;
 * counting it would fail-OPEN outreach on hardware evidence for a contract the tree no
 * longer ships) — only a record carrying the current fingerprint (and, for a proof,
 * current digest) survives a stale file. A file with neither `proofs.passed` nor
 * `proofs.steps` (minted before the emitter recorded either) → 0/N. An empty `bound` →
 * 0, never 100: nothing bound means nothing certified, and the binding gate is red in
 * that state anyway.
 */
export function evidenceDimension(evidence, ageDays, currentFingerprint, bound, currentDigests = new Map()) {
  const names = Array.isArray(bound) ? bound.filter((b) => typeof b === "string") : [];
  const n = names.length;
  const closed = (reason) => ({ pct: 0, bound: n, current: 0, missing: [...names], reason });
  if (n === 0) return closed("the launch items bind no proofs — check-launch-proof-bindings.mjs must be red");
  if (!evidence) return closed(`${EVIDENCE} absent`);
  const green = evidence.reviewHubPass === true && evidence.mcpPass === true;
  if (!green) return closed("last Mac evidence run was not green on both halves");
  if (!(ageDays <= FRESH_DAYS)) return closed(`evidence is ${ageDays} day(s) old (> ${FRESH_DAYS})`);
  if (typeof currentFingerprint !== "string" || currentFingerprint.length === 0) {
    return closed("current live-sync manifest fingerprint could not be computed — fail-closed");
  }
  const proofsBlock = evidence.proofs;
  if (proofsBlock === null || typeof proofsBlock !== "object" || Array.isArray(proofsBlock)) {
    return closed("evidence records no per-proof or per-step results (proofs absent — minted before the emitter recorded them); refresh on the Mac");
  }
  const records = proofsBlock.passed;
  const stepRecords = proofsBlock.steps;
  const hasPassed = records !== null && typeof records === "object" && !Array.isArray(records);
  const hasSteps = stepRecords !== null && typeof stepRecords === "object" && !Array.isArray(stepRecords);
  if (!hasPassed && !hasSteps) {
    return closed("evidence records no per-proof or per-step results (proofs.passed/proofs.steps absent — minted before the emitter recorded them); refresh on the Mac");
  }
  const fileFp = evidence.manifestFingerprint;
  const current = [], missing = [];
  for (const name of names) {
    if (name.startsWith("step:")) {
      const stepName = name.slice("step:".length);
      const r = hasSteps && Object.prototype.hasOwnProperty.call(stepRecords, stepName) ? stepRecords[stepName] : undefined;
      const status = r !== null && typeof r === "object" ? r.status : undefined;
      const fp = r !== null && typeof r === "object" && "manifestFingerprint" in r ? r.manifestFingerprint : fileFp;
      (status === "passed" && typeof fp === "string" && fp === currentFingerprint ? current : missing).push(name);
      continue;
    }
    const r = hasPassed && Object.prototype.hasOwnProperty.call(records, name) ? records[name] : undefined;
    const isObj = r !== null && typeof r === "object" && !Array.isArray(r);
    const status = isObj ? r.status : typeof r === "string" ? r : undefined;
    const fp = isObj && "manifestFingerprint" in r ? r.manifestFingerprint : fileFp;
    const digest = isObj && "sourceDigest" in r ? r.sourceDigest : undefined;
    const expectedDigest = currentDigests?.get ? currentDigests.get(name) : undefined;
    const digestOk = typeof digest === "string" && typeof expectedDigest === "string" && digest === expectedDigest;
    (status === "passed" && typeof fp === "string" && fp === currentFingerprint && digestOk ? current : missing).push(name);
  }
  const reason =
    current.length === n
      ? `${n}/${n} bound proofs/steps current (passed, matching manifest fingerprint and, for proofs, source digest) — green on both halves, ${ageDays} day(s) old, manifest ${shortFp(fileFp)}`
      : current.length === 0 && (typeof fileFp !== "string" || fileFp !== currentFingerprint)
        ? `0/${n} bound proofs/steps current — evidence covers manifest ${shortFp(fileFp)}, tree is ${shortFp(currentFingerprint)}; refresh on the Mac`
        : `${current.length}/${n} bound proofs/steps current against manifest ${shortFp(currentFingerprint)}; not current (stale fingerprint, stale/absent source digest, or unrecorded): ${missing.join(", ")}`;
  return { pct: pct(current.length, n), bound: n, current: current.length, missing, reason };
}

/**
 * Pure: how old the evidence is, in whole days, and WHICH clock said so.
 *
 * Uses the artifact's own `mintedAt` (written by the emitter at mint time). The git commit
 * date is the LEGACY fallback, for an artifact minted before the emitter wrote a stamp —
 * and only then: it is unreliable on a shallow clone (it reports the clone boundary, not
 * the mint — how this file was mis-aged twice) and it is re-writable by anyone who
 * re-commits the file. Fail-closed on a bad stamp: a `mintedAt` that is PRESENT but not a
 * string, unparseable, or in the FUTURE relative to `nowSec` (a wrong clock must never
 * read as "fresh") is an assertion we could not read, and the age is Infinity — never the
 * git date (review finding: falling back to git let a re-commit of an old artifact with an
 * invalid stamp mint a fresh age and score the evidence dimension 100). With no stamp and
 * no usable git date the age is also Infinity; `evidenceDimension` scores Infinity 0.
 */
export function evidenceAgeDays(evidence, gitCommitSec, nowSec) {
  if (evidence !== null && typeof evidence === "object" && "mintedAt" in evidence) {
    const minted = typeof evidence.mintedAt === "string" ? Date.parse(evidence.mintedAt) / 1000 : NaN;
    if (Number.isFinite(minted) && minted <= nowSec) return { ageDays: Math.floor((nowSec - minted) / 86400), source: "mintedAt" };
    return { ageDays: Infinity, source: "invalid-mintedAt" };
  }
  if (Number.isFinite(gitCommitSec) && gitCommitSec > 0) return { ageDays: Math.floor((nowSec - gitCommitSec) / 86400), source: "git" };
  return { ageDays: Infinity, source: "none" };
}

/** Pure: live operations declared vs those with a PASSED result somewhere on disk. */
export function liveDimension(declaredLiveIds, results, greenStatuses) {
  const proven = new Set();
  for (const r of results) for (const run of r.runs || []) {
    if (declaredLiveIds.includes(run.operation) && greenStatuses.includes(run.status)) proven.add(run.operation);
  }
  return { declared: declaredLiveIds.length, proven: proven.size, missing: declaredLiveIds.filter((i) => !proven.has(i)), pct: pct(proven.size, declaredLiveIds.length) };
}

export const headline = (dims) => Math.min(...dims);
export const verdict = (h) =>
  h < FLOOR ? `OUTREACH CLOSED — readiness ${h}% is below the ${FLOOR}% floor`
  : h < TARGET_LOW ? `OUTREACH OPEN at the floor — readiness ${h}% (target ${TARGET_LOW}–${TARGET_HIGH}%)`
  : `OUTREACH OPEN — readiness ${h}% meets the ${TARGET_LOW}–${TARGET_HIGH}% target (goal ${GOAL}%)`;

function git(args) { const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" }); return r.status === 0 ? r.stdout.trim() : ""; }

/**
 * Pure: what derive() runs BEFORE it trusts boundProofs() for anything. A launch
 * item with a missing/empty `proofs` array does not show up as a zero in
 * boundProofs()'s output — it just vanishes, shrinking the denominator instead of
 * failing loud. Kept as its own function (rather than inlined in derive()) so the
 * self-test below proves the EXACT check derive() runs, not just that the
 * underlying validator can produce problems in isolation.
 */
export function assertBindingsComplete(surfaces) {
  const problems = validateBindings(surfaces);
  if (problems.length > 0) {
    throw new Broken(`launch-proof bindings incomplete — ${problems.length} launch item(s) bind no proofs (run check-launch-proof-bindings.mjs for the full list): ${problems[0]}`);
  }
}

async function derive() {
  // (a)
  if (!existsSync(join(repo, GT))) throw new Broken(`${GT} missing`);
  const a = parseGroundTruth(readFileSync(join(repo, GT), "utf8"));
  // (b)
  let evidence = null, ageDays = Infinity, ageSource = "none";
  if (existsSync(join(repo, EVIDENCE))) {
    evidence = JSON.parse(readFileSync(join(repo, EVIDENCE), "utf8"));
    const ct = Number(git(["log", "-1", "--format=%ct", "--", EVIDENCE]));
    ({ ageDays, source: ageSource } = evidenceAgeDays(evidence, ct, Date.now() / 1000));
  }
  const lp = await import(pathToFileURL(join(repo, "scripts/launch-profile.mjs")).href);
  // FAIL-CLOSED, before boundProofs() is trusted at all: a launch item with no
  // `proofs` array does not appear as a zero in that map's output, it just isn't
  // there — self-test: plant one unbound launch entry → Broken (review finding).
  assertBindingsComplete(lp.SURFACES);
  const counts = { launch: 0, deferred: 0, demo_only: 0, internal: 0 };
  for (const s of lp.SURFACES) for (const k of Object.keys(counts)) counts[k] += (s[k] || []).length;
  // The current contract fingerprint, from the SAME source of truth as check-live-sync.mjs.
  // Fail-closed: if it cannot be computed, currentFingerprint stays "" and (b) resolves to 0.
  let currentFingerprint = "";
  try { currentFingerprint = fingerprintOf(computeBody()); } catch { currentFingerprint = ""; }
  const bound = [...boundProofs(lp.SURFACES).keys()].sort();
  if (bound.length === 0) throw new Broken("the launch items bind no proofs — the (b) denominator is empty");
  // The CURRENT sourceDigest for every bound `proof:*` — recomputed the same way
  // verify-all.mjs recorded it, so a stale evidence digest is caught rather than
  // trusted (2026-09-12 review finding). `step:*` bindings carry no digest.
  const rootScripts = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).scripts ?? {};
  const subScripts = JSON.parse(readFileSync(join(repo, "scripts/package.json"), "utf8")).scripts ?? {};
  const proofFiles = proofScriptFiles(repo, rootScripts, subScripts);
  const pkgDirs = workspacePackageDirs(repo);
  const currentDigests = new Map();
  for (const name of bound) {
    if (!name.startsWith("proof:")) continue;
    const relPath = proofFiles.get(name);
    if (relPath) currentDigests.set(name, proofSourceDigest(repo, relPath, pkgDirs));
  }
  const b = { ...evidenceDimension(evidence, ageDays, currentFingerprint, bound, currentDigests), boundProofs: bound, ageSource, surfaces: counts };
  // (c) scenarios — run the engine's own list through the engine (seconds)
  // Spawned from scripts/: tsx and @workspace/signalgrid-simulator resolve in that package, not at the root.
  // `node --import tsx`, not `pnpm exec tsx`: the tsx CLI opens an IPC socket under /tmp that a
  // sandboxed Claude session cannot bind (EPERM listen), so the gate read BROKEN in every such
  // session while the same TypeScript ran fine through the loader hook (self-evaluation 2026-09-12).
  const sc = spawnSync(process.execPath, ["--import", "tsx", "src/readiness-scenarios.ts"], { cwd: join(repo, "scripts"), encoding: "utf8" });
  if (sc.status !== 0) throw new Broken(`simulator scenarios could not be run: ${(sc.stderr || "").trim().split("\n").pop()}`);
  const scen = JSON.parse(sc.stdout.trim().split("\n").pop());
  if (!(scen.declared > 0)) throw new Broken("the engine declares zero scenarios");
  // (c) live operations
  const ops = await import(pathToFileURL(join(repo, "scripts/lib/sim-operations.mjs")).href);
  const o = ops.SIM_OPERATIONS;
  const ids = Array.isArray(o) ? o.map((x) => x.id ?? x.key) : Object.keys(o);
  const liveIds = ids.filter((i) => /^live-/.test(i));
  if (liveIds.length === 0) throw new Broken("sim-operations declares no live-* operations");
  const results = existsSync(join(repo, RESULTS))
    ? readdirSync(join(repo, RESULTS)).filter((f) => f.endsWith(".json")).map((f) => { try { return JSON.parse(readFileSync(join(repo, RESULTS, f), "utf8")); } catch { return {}; } })
    : [];
  const live = liveDimension(liveIds, results, ops.GREEN_STATUSES || ["passed"]);
  const c = { scenarios: { ...scen, pct: pct(scen.ran, scen.declared) }, live, pct: Math.min(pct(scen.ran, scen.declared), live.pct) };
  const h = headline([a.pct, b.pct, c.pct]);
  return { a: a.pct, b: b.pct, c: c.pct, headline: h, floor: FLOOR, target: [TARGET_LOW, TARGET_HIGH], goal: GOAL, verdict: verdict(h), details: { groundTruth: a, evidence: b, endToEnd: c } };
}

function selfTest() {
  const checks = [];
  const table = "| Real-world element | Surface | Status |\n| --- | --- | --- |\n| a | x | modeled |\n| b | x | modeled |\n| c | x | partial (half) |\n| d | x | gap |\n";
  const gt = parseGroundTruth(table);
  checks.push(["ground truth: 2 modeled of 4 rows → 50%, partial and gap count against", gt.modeled === 2 && gt.partial === 1 && gt.gap === 1 && gt.pct === 50]);
  // A markdown-BOLD `**gap**` status must still count as a gap and stay in the denominator —
  // it fell out entirely before emphasis was stripped, inflating the modeled ratio.
  const boldGap = parseGroundTruth("| Real-world element | Surface | Status |\n| --- | --- | --- |\n| a | x | modeled |\n| b | x | **gap** |\n| c | x | modeled |\n");
  checks.push(["ground truth: a **gap** (markdown-bold) status counts as gap and stays in the denominator", boldGap.modeled === 2 && boldGap.gap === 1 && boldGap.total === 3 && boldGap.pct === 66]);
  let threw = false; try { parseGroundTruth("# nothing\n"); } catch (e) { threw = e instanceof Broken; }
  checks.push(["ground truth: an empty table is BROKEN, never 0% and never 100%", threw]);
  const FP = "6f6a47998f01ccb605646b4f83ca6e768ede38144878f979675148ca1a336be1";
  const OTHER = "00f6aa9cf3d1a9510238984266d09eeb24b65793f2e89c5304afa5b074dacf3e";
  const DIGEST_A = "aaaa000000000000000000000000000000000000000000000000000000001";
  const DIGEST_B = "bbbb000000000000000000000000000000000000000000000000000000002";
  const STALE_DIGEST = "ffff000000000000000000000000000000000000000000000000000000009";
  // (b) is a RATIO over the bound proofs: two bound here, so the cases can show it MOVE.
  const BOUND = ["proof:alpha", "proof:beta"];
  const DIGESTS = new Map([["proof:alpha", DIGEST_A], ["proof:beta", DIGEST_B]]);
  const rec = (digest, fp = FP, status = "passed") => ({ status, manifestFingerprint: fp, reviewHubCommit: "deadbeef", sourceDigest: digest });
  const ev = (passed, fp = FP, extra = {}) => ({ reviewHubPass: true, mcpPass: true, manifestFingerprint: fp, proofs: { passed }, ...extra });
  const both = { "proof:alpha": rec(DIGEST_A), "proof:beta": rec(DIGEST_B) };
  const full = evidenceDimension(ev(both), 3, FP, BOUND, DIGESTS);
  checks.push(["evidence: green + fresh + fingerprint MATCHES + both bound proofs current (fingerprint AND source digest match) → 100 (2/2)", full.pct === 100 && full.current === 2 && full.bound === 2 && full.missing.length === 0]);
  const half = evidenceDimension(ev({ "proof:alpha": rec(DIGEST_A) }), 3, FP, BOUND, DIGESTS);
  checks.push(["evidence: one of two bound proofs recorded → 50, and the missing one is NAMED (a proof with no record counts as 0)", half.pct === 50 && half.current === 1 && half.missing.join() === "proof:beta"]);
  checks.push(["evidence: a record whose status is not \"passed\" (failed / skipped) is not current", evidenceDimension(ev({ "proof:alpha": rec(DIGEST_A), "proof:beta": rec(DIGEST_B, FP, "failed") }), 3, FP, BOUND, DIGESTS).pct === 50 && evidenceDimension(ev({ "proof:alpha": rec(DIGEST_A, FP, "skipped"), "proof:beta": rec(DIGEST_B, FP, "skipped") }), 3, FP, BOUND, DIGESTS).pct === 0]);
  checks.push(["evidence: a record for a proof NOT bound raises nothing (denominator is the bound set)", evidenceDimension(ev({ "proof:alpha": rec(DIGEST_A), "proof:zeta": rec(DIGEST_A) }), 3, FP, BOUND, DIGESTS).pct === 50]);
  const legacy = evidenceDimension({ reviewHubPass: true, mcpPass: true, manifestFingerprint: FP }, 3, FP, BOUND, DIGESTS);
  checks.push(["evidence: green + fresh + match but NO proofs block at all → 0/2, never inferred from the run-level pass", legacy.pct === 0 && legacy.current === 0 && /no per-proof or per-step results/.test(legacy.reason)]);
  checks.push(["evidence: an EMPTY proofs.passed → 0 (a missing record never raises the ratio)", evidenceDimension(ev({}), 3, FP, BOUND, DIGESTS).pct === 0]);
  checks.push(["evidence: proofs.passed of the wrong shape (an array, a string) → 0", evidenceDimension({ reviewHubPass: true, mcpPass: true, manifestFingerprint: FP, proofs: { passed: ["proof:alpha", "proof:beta"] } }, 3, FP, BOUND, DIGESTS).pct === 0 && evidenceDimension({ reviewHubPass: true, mcpPass: true, manifestFingerprint: FP, proofs: { passed: "passed" } }, 3, FP, BOUND, DIGESTS).pct === 0]);
  checks.push(["evidence: green + fresh but the FILE fingerprint MISMATCHES → every record without its OWN matching fingerprint is 0 (stale-contract evidence must not open outreach)", evidenceDimension(ev(both), 3, OTHER, BOUND, DIGESTS).pct === 0 && /refresh on the Mac/.test(evidenceDimension(ev(both), 3, OTHER, BOUND, DIGESTS).reason)]);
  const perProofFp = evidenceDimension(ev({ "proof:alpha": rec(DIGEST_A, OTHER), "proof:beta": rec(DIGEST_B) }, FP), 3, OTHER, BOUND, DIGESTS);
  checks.push(["evidence: under a stale FILE fingerprint, a per-proof record carrying the CURRENT fingerprint (and matching digest) still counts (1/2 → 50), the file-bound one does not", perProofFp.pct === 50 && perProofFp.missing.join() === "proof:beta"]);
  const noFpRecords = { "proof:alpha": { status: "passed", sourceDigest: DIGEST_A }, "proof:beta": { status: "passed", sourceDigest: DIGEST_B } };
  checks.push(["evidence: green + fresh but NO manifestFingerprint field anywhere (neither file nor record) → 0", evidenceDimension({ reviewHubPass: true, mcpPass: true, proofs: { passed: noFpRecords } }, 3, FP, BOUND, DIGESTS).pct === 0]);
  checks.push(["evidence: green + fresh + match but current fingerprint uncomputable → 0 (fail-closed)", evidenceDimension(ev(both), 3, "", BOUND, DIGESTS).pct === 0]);
  checks.push(["evidence: green but stale → 0 (stale evidence closes outreach)", evidenceDimension(ev(both), FRESH_DAYS + 1, FP, BOUND, DIGESTS).pct === 0]);
  checks.push(["evidence: one half red → 0", evidenceDimension(ev(both, FP, { mcpPass: false }), 1, FP, BOUND, DIGESTS).pct === 0]);
  checks.push(["evidence: NOTHING bound → 0, never 100 (nothing bound means nothing certified)", evidenceDimension(ev(both), 3, FP, [], DIGESTS).pct === 0 && evidenceDimension(ev(both), 3, FP, undefined, DIGESTS).pct === 0]);
  checks.push(["evidence: pct floors (1 of 3 → 33), so a partial never rounds up", evidenceDimension(ev({ "proof:a": rec(DIGEST_A) }), 3, FP, ["proof:a", "proof:b", "proof:c"], new Map([["proof:a", DIGEST_A]])).pct === 33]);
  // sourceDigest is REQUIRED, not merely recorded (2026-09-12 review finding, the
  // whole fix): a proof or an imported lib/*·artifacts/* package can change without
  // moving the live-sync manifest fingerprint (a CONTRACT hash), so before this a
  // string-form "passed" record — carrying no source signal at all — read current
  // for up to FRESH_DAYS regardless of what the code did in the meantime.
  const staleDigest = evidenceDimension(ev({ "proof:alpha": rec(STALE_DIGEST), "proof:beta": rec(DIGEST_B) }), 3, FP, BOUND, DIGESTS);
  checks.push(["evidence: a record whose sourceDigest does NOT match the current tree is NOT current even with a matching manifestFingerprint (self-test: planted stale-digest record → not current)", staleDigest.pct === 50 && staleDigest.missing.join() === "proof:alpha"]);
  checks.push(["evidence: a LEGACY string-form record (\"passed\", no sourceDigest at all) never counts as current — the exact loophole this closes", evidenceDimension({ reviewHubPass: true, mcpPass: true, manifestFingerprint: FP, proofs: { passed: { "proof:alpha": "passed", "proof:beta": "passed" } } }, 3, FP, BOUND, DIGESTS).pct === 0]);
  checks.push(["evidence: reviewHubCommit is recorded but NEVER compared — a docs-only commit (reviewHubCommit moves, digest and fingerprint do not) must not zero the ratio", evidenceDimension(ev({ "proof:alpha": { ...rec(DIGEST_A), reviewHubCommit: "some-other-sha" }, "proof:beta": rec(DIGEST_B) }), 3, FP, BOUND, DIGESTS).pct === 100]);
  // step: bindings — counted "like proofs" (status passed + current fingerprint),
  // keyed under proofs.steps by the BARE step name; no sourceDigest requirement.
  const STEP_BOUND = ["proof:alpha", "step:Browser E2E (review console, website, admin)"];
  const evWithStep = (passed, steps, fp = FP) => ({ reviewHubPass: true, mcpPass: true, manifestFingerprint: fp, proofs: { passed, steps } });
  const stepFull = evidenceDimension(evWithStep(both, { "Browser E2E (review console, website, admin)": { status: "passed", manifestFingerprint: FP } }), 3, FP, STEP_BOUND, DIGESTS);
  checks.push(["evidence: a step: binding recorded passed under proofs.steps (keyed by the bare name) counts toward the ratio", stepFull.pct === 100 && stepFull.current === 2]);
  const stepUnrecorded = evidenceDimension(evWithStep(both, {}), 3, FP, STEP_BOUND, DIGESTS);
  checks.push(["evidence: an UNRECORDED step (e.g. Browser E2E structurally excluded on a non-linux-x64 Mac) is 0 for that entry, fail-closed, never inferred from the proof half passing", stepUnrecorded.pct === 50 && stepUnrecorded.missing.join() === "step:Browser E2E (review console, website, admin)"]);
  checks.push(["evidence: a step record against a STALE manifest fingerprint is not current", evidenceDimension(evWithStep(both, { "Browser E2E (review console, website, admin)": { status: "passed", manifestFingerprint: OTHER } }), 3, FP, STEP_BOUND, DIGESTS).pct === 50]);
  // Evidence AGE reads the artifact's own mintedAt; git is the LEGACY fallback for an
  // artifact with no stamp at all; a present-but-invalid stamp is Infinity, never git.
  const NOW = 1_800_000_000; // a fixed "now" so the cases are deterministic
  const DAY = 86400;
  const aged = evidenceAgeDays({ mintedAt: new Date((NOW - 2 * DAY) * 1000).toISOString() }, NOW - 10 * DAY, NOW);
  checks.push(["age: a valid mintedAt is preferred over the git date (2 days, source mintedAt)", aged.ageDays === 2 && aged.source === "mintedAt"]);
  const noStamp = evidenceAgeDays({}, NOW - 3 * DAY, NOW);
  checks.push(["age: no mintedAt at all (legacy artifact) → the git commit date (3 days, source git)", noStamp.ageDays === 3 && noStamp.source === "git"]);
  const garbage = evidenceAgeDays({ mintedAt: "not-a-date" }, NOW - 4 * DAY, NOW);
  checks.push(["age: an unparseable mintedAt → Infinity (invalid-mintedAt), NOT the 4-day git date and never NaN", garbage.ageDays === Infinity && garbage.source === "invalid-mintedAt"]);
  const future = evidenceAgeDays({ mintedAt: new Date((NOW + 5 * DAY) * 1000).toISOString() }, NOW - 6 * DAY, NOW);
  checks.push(["age: a FUTURE mintedAt (wrong clock) → Infinity, NOT the 6-day git date and never a negative 'fresh' age", future.ageDays === Infinity && future.source === "invalid-mintedAt"]);
  const nonString = evidenceAgeDays({ mintedAt: NOW - 1 * DAY }, NOW - 7 * DAY, NOW);
  checks.push(["age: a present-but-non-string mintedAt (a number, null) → Infinity, not git", nonString.ageDays === Infinity && evidenceAgeDays({ mintedAt: null }, NOW - 7 * DAY, NOW).ageDays === Infinity]);
  const nothing = evidenceAgeDays({}, 0, NOW);
  checks.push(["age: no mintedAt and no git date → Infinity (fail-closed; scores 0)", nothing.ageDays === Infinity && nothing.source === "none"]);
  checks.push(["age: Infinity scores the evidence dimension 0", evidenceDimension(ev(both), Infinity, FP, BOUND, DIGESTS).pct === 0]);
  checks.push(["evidence: absent → 0", evidenceDimension(null, 0, FP, BOUND, DIGESTS).pct === 0]);
  // derive()'s fail-closed guard (finding #1): an unbound launch entry must never
  // silently vanish from boundProofs() and read as a false 100%.
  let threwUnbound = false;
  try { assertBindingsComplete([{ key: "s", launch: [{ id: "unbound", reason: "r" }] }]); } catch (e) { threwUnbound = e instanceof Broken; }
  checks.push(["derive()'s fail-closed guard: self-test — plant one unbound launch entry → Broken (never a false 100% from boundProofs() silently dropping it)", threwUnbound]);
  let okBound = true;
  try { assertBindingsComplete([{ key: "s", launch: [{ id: "bound", reason: "r", proofs: ["proof:x"] }] }]); } catch { okBound = false; }
  checks.push(["derive()'s fail-closed guard: a fully-bound profile does not throw", okBound]);
  const lv = liveDimension(["live-a", "live-b", "live-c"], [{ runs: [{ operation: "live-a", status: "passed" }, { operation: "live-b", status: "refused" }] }], ["passed"]);
  checks.push(["live: only PASSED counts — 1 of 3 proven, refused is not proven", lv.proven === 1 && lv.pct === 33 && lv.missing.join() === "live-b,live-c"]);
  checks.push(["headline is the LOWEST dimension, never an average", headline([100, 79, 100]) === 79]);
  checks.push(["verdict: 79 closes outreach; 80 opens at the floor; 93 meets target", /CLOSED/.test(verdict(79)) && /OPEN at the floor/.test(verdict(80)) && /meets/.test(verdict(93))]);
  const failed = checks.filter(([, ok]) => !ok);
  for (const [n, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${n}`);
  console.log(`\nself-test ${failed.length ? "FAILED" : "passed"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) process.exit(selfTest());
  derive().then((r) => {
    if (process.argv.includes("--json")) { console.log(JSON.stringify(r)); return; }
    const d = r.details;
    console.log(`Readiness figure — DR-036: derived, never typed; headline = the lowest dimension\n`);
    console.log(`  (a) runbook ground truth      ${String(r.a).padStart(3)}%   ${d.groundTruth.modeled} modeled / ${d.groundTruth.partial} partial / ${d.groundTruth.gap} gap of ${d.groundTruth.total} real-world elements (${GT})`);
    console.log(`  (b) launch surface, evidence  ${String(r.b).padStart(3)}%   proofs current ${d.evidence.current}/${d.evidence.bound} (bound by ${d.evidence.surfaces.launch} launch items) — ${d.evidence.reason} (age via ${d.evidence.ageSource}); launch ${d.evidence.surfaces.launch} · deferred ${d.evidence.surfaces.deferred} (deferred is the freeze, not a defect)`);
    console.log(`  (c) end-to-end                ${String(r.c).padStart(3)}%   scenarios ${d.endToEnd.scenarios.ran}/${d.endToEnd.scenarios.declared} · live operations proven ${d.endToEnd.live.proven}/${d.endToEnd.live.declared}${d.endToEnd.live.missing.length ? ` (unproven: ${d.endToEnd.live.missing.join(", ")})` : ""}`);
    console.log(`\n  HEADLINE ${r.headline}%  → ${r.verdict}`);
    console.log(`  floor ${FLOOR} · target ${TARGET_LOW}–${TARGET_HIGH} · goal ${GOAL}. A broken derivation exits 1; a low number exits 0 (REPORT).`);
  }).catch((e) => { console.error(`Readiness derivation BROKEN: ${e.message}`); process.exit(1); });
}
