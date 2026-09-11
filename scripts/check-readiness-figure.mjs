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
//   (b) LAUNCH SURFACE, EVIDENCE-BOUND — the launch profile's items are routes, packages and
//       families, not proof names (3 of 23 map by name), so a per-item ratio would be invented.
//       Instead: 100% only while the last full Mac evidence run (artifacts/live-evidence/
//       mac-run.json, minted only by a green Review-Hub preflight AND a green signalgrid-mcp
//       run on real macOS) is green AND no older than FRESH_DAYS by its commit date; 0%
//       otherwise. Stale evidence closes outreach until a Mac run refreshes it. Named
//       follow-up: give launch items explicit proof bindings and turn this into a ratio.
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
 * Pure: evidence dimension — 100 ONLY when the last Mac run is green, fresh, AND covers
 * the CURRENT contract; else 0, with the reason.
 *
 * The fingerprint clause is the fail-closed point of the whole gate. Green-and-fresh is
 * not enough: evidence bound to an OLD manifest fingerprint proves behaviour against a
 * contract the tree no longer ships (check-live-sync reports it STALE). Counting it 100
 * fail-OPENS outreach on stale hardware evidence. So (b) is 100 only when the evidence's
 * `manifestFingerprint` equals `currentFingerprint` (the live-sync manifest fingerprint,
 * computed the same way check-live-sync.mjs does). A missing or mismatched fingerprint,
 * or an uncomputable current fingerprint, → 0. Only a fresh Mac run reopens it.
 */
export function evidenceDimension(evidence, ageDays, currentFingerprint) {
  if (!evidence) return { pct: 0, reason: `${EVIDENCE} absent` };
  const green = evidence.reviewHubPass === true && evidence.mcpPass === true;
  if (!green) return { pct: 0, reason: "last Mac evidence run was not green on both halves" };
  if (!(ageDays <= FRESH_DAYS)) return { pct: 0, reason: `evidence is ${ageDays} day(s) old (> ${FRESH_DAYS})` };
  if (typeof currentFingerprint !== "string" || currentFingerprint.length === 0) {
    return { pct: 0, reason: "current live-sync manifest fingerprint could not be computed — fail-closed" };
  }
  const evFp = evidence.manifestFingerprint;
  if (typeof evFp !== "string" || evFp !== currentFingerprint) {
    return { pct: 0, reason: `evidence covers manifest ${shortFp(evFp)}, tree is ${shortFp(currentFingerprint)} — refresh on the Mac` };
  }
  return { pct: 100, reason: `green on both halves, ${ageDays} day(s) old, manifest ${shortFp(evFp)}` };
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

async function derive() {
  // (a)
  if (!existsSync(join(repo, GT))) throw new Broken(`${GT} missing`);
  const a = parseGroundTruth(readFileSync(join(repo, GT), "utf8"));
  // (b)
  let evidence = null, ageDays = Infinity;
  if (existsSync(join(repo, EVIDENCE))) {
    evidence = JSON.parse(readFileSync(join(repo, EVIDENCE), "utf8"));
    const ct = Number(git(["log", "-1", "--format=%ct", "--", EVIDENCE]));
    if (Number.isFinite(ct) && ct > 0) ageDays = Math.floor((Date.now() / 1000 - ct) / 86400);
  }
  const lp = await import(pathToFileURL(join(repo, "scripts/launch-profile.mjs")).href);
  const counts = { launch: 0, deferred: 0, demo_only: 0, internal: 0 };
  for (const s of lp.SURFACES) for (const k of Object.keys(counts)) counts[k] += (s[k] || []).length;
  // The current contract fingerprint, from the SAME source of truth as check-live-sync.mjs.
  // Fail-closed: if it cannot be computed, currentFingerprint stays "" and (b) resolves to 0.
  let currentFingerprint = "";
  try { currentFingerprint = fingerprintOf(computeBody()); } catch { currentFingerprint = ""; }
  const b = { ...evidenceDimension(evidence, ageDays, currentFingerprint), surfaces: counts };
  // (c) scenarios — run the engine's own list through the engine (seconds)
  // Spawned from scripts/: tsx and @workspace/signalgrid-simulator resolve in that package, not at the root.
  const sc = spawnSync("pnpm", ["exec", "tsx", "src/readiness-scenarios.ts"], { cwd: join(repo, "scripts"), encoding: "utf8" });
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
  checks.push(["evidence: green + fresh + fingerprint MATCHES current → 100", evidenceDimension({ reviewHubPass: true, mcpPass: true, manifestFingerprint: FP }, 3, FP).pct === 100]);
  checks.push(["evidence: green + fresh but fingerprint MISMATCH → 0 (stale-contract evidence must not open outreach)", evidenceDimension({ reviewHubPass: true, mcpPass: true, manifestFingerprint: FP }, 3, OTHER).pct === 0]);
  checks.push(["evidence: green + fresh but NO manifestFingerprint field → 0", evidenceDimension({ reviewHubPass: true, mcpPass: true }, 3, FP).pct === 0]);
  checks.push(["evidence: green + fresh + match but current fingerprint uncomputable → 0 (fail-closed)", evidenceDimension({ reviewHubPass: true, mcpPass: true, manifestFingerprint: FP }, 3, "").pct === 0]);
  checks.push(["evidence: green but stale → 0 (stale evidence closes outreach)", evidenceDimension({ reviewHubPass: true, mcpPass: true, manifestFingerprint: FP }, FRESH_DAYS + 1, FP).pct === 0]);
  checks.push(["evidence: one half red → 0", evidenceDimension({ reviewHubPass: true, mcpPass: false, manifestFingerprint: FP }, 1, FP).pct === 0]);
  checks.push(["evidence: absent → 0", evidenceDimension(null, 0, FP).pct === 0]);
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
    console.log(`  (b) launch surface, evidence  ${String(r.b).padStart(3)}%   ${d.evidence.reason}; launch ${d.evidence.surfaces.launch} · deferred ${d.evidence.surfaces.deferred} (deferred is the freeze, not a defect)`);
    console.log(`  (c) end-to-end                ${String(r.c).padStart(3)}%   scenarios ${d.endToEnd.scenarios.ran}/${d.endToEnd.scenarios.declared} · live operations proven ${d.endToEnd.live.proven}/${d.endToEnd.live.declared}${d.endToEnd.live.missing.length ? ` (unproven: ${d.endToEnd.live.missing.join(", ")})` : ""}`);
    console.log(`\n  HEADLINE ${r.headline}%  → ${r.verdict}`);
    console.log(`  floor ${FLOOR} · target ${TARGET_LOW}–${TARGET_HIGH} · goal ${GOAL}. A broken derivation exits 1; a low number exits 0 (REPORT).`);
  }).catch((e) => { console.error(`Readiness derivation BROKEN: ${e.message}`); process.exit(1); });
}
