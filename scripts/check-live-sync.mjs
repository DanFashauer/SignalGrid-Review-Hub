// Live-sync gate — keeps the published sync manifest (what the Mac MCP lane and
// the iOS EnterpriseShell build against) truthful, and reports whether committed
// real-hardware evidence still matches today's contracts. See docs/LIVE_SYNC_LOOP.md.
//
//   node scripts/check-live-sync.mjs
//
// Two halves, deliberately different in strength:
//
//   (a) HARD: recompute the manifest body from the tracked sources (same code path
//       as the generator — imported, not copied) and fail if the committed
//       artifacts/sync/live-sync-manifest.json differs. A contract/enum/tool-surface
//       change that ships without republishing the manifest would hand the external
//       consumers stale instructions; that is the failure this gate exists to stop.
//       Also fails if the committed fingerprint does not match the committed body
//       (a hand-edited manifest is drift, not evidence).
//
//   (b) SOFT: report artifacts/live-evidence/*.json — each evidence file records the
//       manifestFingerprint it was produced against. Print FRESH/STALE per file and
//       one machine-greppable status line:  liveEvidence=fresh|stale|none
//       This half NEVER fails the gate: only the owner's real Mac (and Xcode) can
//       refresh the evidence, and blocking every commit on a hardware run would
//       stop all work. Staleness is surfaced so the scheduled bot / owner can see a
//       real-device run is due — not enforced.
//
// Exit code: non-zero ONLY when half (a) fails.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computeBody, fingerprintOf, stableStringify, MANIFEST_PATH } from "./generate-sync-manifest.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EVIDENCE_DIR = resolve(repoRoot, "artifacts/live-evidence");

// ── (a) HARD: committed manifest vs the repo's current contracts ──────────────
const body = computeBody();
const currentFingerprint = fingerprintOf(body);

let committed = null;
try {
  committed = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
} catch {
  committed = null;
}

let hardFail = false;
if (!committed?.fingerprint || !committed?.body) {
  console.error("✗ live-sync manifest missing or unreadable: artifacts/sync/live-sync-manifest.json");
  hardFail = true;
} else if (fingerprintOf(committed.body) !== committed.fingerprint) {
  console.error("✗ committed manifest is self-inconsistent (fingerprint does not match its own body — was it hand-edited?)");
  hardFail = true;
} else if (committed.fingerprint !== currentFingerprint || stableStringify(committed.body) !== stableStringify(body)) {
  console.error("✗ manifest drift: committed fingerprint " + committed.fingerprint.slice(0, 16) + "… vs current " + currentFingerprint.slice(0, 16) + "…");
  hardFail = true;
} else {
  console.log(
    `✓ live-sync manifest matches the repo (version ${committed.manifestVersion}, fingerprint ${currentFingerprint.slice(0, 16)}…)`,
  );
}
if (hardFail) {
  console.error("\nrepo contracts changed without republishing the sync manifest — run: node scripts/generate-sync-manifest.mjs");
  console.error("(then commit artifacts/sync/live-sync-manifest.json so external consumers build against current instructions)");
}

// ── (b) SOFT: committed real-hardware evidence vs the current fingerprint ─────
let evidenceFiles = [];
try {
  evidenceFiles = readdirSync(EVIDENCE_DIR).filter((f) => f.endsWith(".json")).sort();
} catch {
  evidenceFiles = [];
}

let anyStale = false;
for (const f of evidenceFiles) {
  let ev = null;
  try {
    ev = JSON.parse(readFileSync(join(EVIDENCE_DIR, f), "utf8"));
  } catch {
    ev = null;
  }
  const fp = ev?.manifestFingerprint;
  const fresh = typeof fp === "string" && fp === currentFingerprint;
  if (!fresh) anyStale = true;
  const detail = typeof fp === "string" ? `evidence fingerprint ${fp.slice(0, 16)}…` : "no manifestFingerprint field";
  const summary = ev?.summary ? ` ${JSON.stringify(ev.summary)}` : "";
  console.log(`  ${fresh ? "FRESH" : "STALE"}  artifacts/live-evidence/${f} (${detail})${summary}`);
}

const status = evidenceFiles.length === 0 ? "none" : anyStale ? "stale" : "fresh";
if (status === "stale") {
  console.log(
    "  note: stale evidence is REPORTED, never enforced — only the owner's Mac can refresh it:\n" +
      "        SIGNALGRID_MCP_PATH=/path/to/signalgrid-mcp node scripts/verify-all.mjs --require-mcp --emit-evidence",
  );
}
console.log(`liveEvidence=${status}`);

process.exit(hardFail ? 1 : 0);
