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

// Evidence is classified by KIND, and only HARDWARE evidence answers
// `liveEvidence=` (review finding on this file's own new sibling lane): this
// directory used to be globbed indiscriminately, so ANY committed *.json with a
// current fingerprint flipped the status to `fresh`. The Docker lane
// (scripts/docker-verify.mjs) emits `kind: "docker-run"`, which proves the
// DEPLOYED SERVER TOPOLOGY against a real database — it says nothing whatsoever
// about a supervised iOS device or a real Mac. Letting it answer this line would
// have made the repo claim hardware validation it does not have, which is the
// exact "green-ness is not hardware" failure docs/LIVE_SYNC_LOOP.md forbids.
// Legacy files without a `kind` are treated as hardware (mac-run.json predates
// the field), so this cannot silently downgrade existing evidence.
const HARDWARE_KINDS = new Set(["mac-run", undefined, null, ""]);

let anyStale = false;
let hardwareCount = 0;
const otherLanes = [];
for (const f of evidenceFiles) {
  let ev = null;
  try {
    ev = JSON.parse(readFileSync(join(EVIDENCE_DIR, f), "utf8"));
  } catch {
    ev = null;
  }
  const fp = ev?.manifestFingerprint;
  const fresh = typeof fp === "string" && fp === currentFingerprint;
  const detail = typeof fp === "string" ? `evidence fingerprint ${fp.slice(0, 16)}…` : "no manifestFingerprint field";
  const summary = ev?.summary ? ` ${JSON.stringify(ev.summary)}` : "";
  const isHardware = HARDWARE_KINDS.has(ev?.kind);
  if (isHardware) {
    hardwareCount += 1;
    if (!fresh) anyStale = true;
  } else {
    otherLanes.push(`${ev.kind}:${fresh ? "fresh" : "stale"}`);
  }
  const lane = isHardware ? "hardware" : `${ev?.kind} lane — NOT hardware evidence`;
  console.log(`  ${fresh ? "FRESH" : "STALE"}  artifacts/live-evidence/${f} [${lane}] (${detail})${summary}`);
}

const status = hardwareCount === 0 ? "none" : anyStale ? "stale" : "fresh";
if (otherLanes.length > 0) {
  console.log(`  (other verification lanes present: ${otherLanes.join(", ")} — reported separately, they never answer liveEvidence)`);
}
if (status === "stale") {
  console.log(
    "  note: stale evidence is REPORTED, never enforced — only the owner's Mac can refresh it:\n" +
      "        SIGNALGRID_MCP_PATH=/path/to/signalgrid-mcp node scripts/verify-all.mjs --require-mcp --emit-evidence",
  );
}
console.log(`liveEvidence=${status}`);

process.exit(hardFail ? 1 : 0);
