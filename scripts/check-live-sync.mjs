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
import { execSync } from "node:child_process";
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
// current fingerprint flipped the status to `fresh`. The container lane
// (scripts/docker-verify.mjs) proves the DEPLOYED SERVER TOPOLOGY against a real
// database — it says nothing whatsoever about a supervised iOS device or a real
// Mac. Letting it answer this line would have made the repo claim hardware
// validation it does not have, which is the exact "green-ness is not hardware"
// failure docs/LIVE_SYNC_LOOP.md forbids.
//
// TWO SPELLINGS OF THE CONTAINER LANE, both of them real: the committed artifact
// `artifacts/live-evidence/docker-run.json` carries `kind: "docker-run"`, and the
// emitter now writes `kind: "container-run"` (docker-verify.mjs:206) because the
// lane runs under podman as readily as docker. This comment named only the first,
// so it described a value the generator had stopped writing. Neither is hardware,
// and the classification below never depended on the spelling — it is an
// EXCLUSION rule — but a comment that names the wrong constant is how the next
// reader learns something untrue.
const HARDWARE_KIND = "mac-run";
// The ONE legacy artifact that predates the `kind` field. Grandfathered BY NAME,
// not by absence-of-field. It was the latter — `HARDWARE_KINDS` contained
// `undefined`, `null` and `""` — which means any evidence file that arrived with
// no kind at all, or that failed to PARSE (an unreadable file yields `ev = null`,
// and `null?.kind` is `undefined`), was counted as HARDWARE evidence. The one
// direction this file must never fail in is claiming hardware validation the repo
// does not have, and an unreadable file was doing exactly that.
const LEGACY_HARDWARE_FILES = new Set(["mac-run.json"]);

/**
 * How one evidence file is classified. Pure, so `--self-test` can drive every arm.
 * @returns {"hardware"|"other"|"unreadable"}
 */
export function classifyEvidence(fileName, ev) {
  if (ev === null || typeof ev !== "object") return "unreadable";
  if (ev.kind === HARDWARE_KIND) return "hardware";
  if (ev.kind === undefined || ev.kind === null || ev.kind === "") {
    return LEGACY_HARDWARE_FILES.has(fileName) ? "hardware" : "unreadable";
  }
  return "other";
}

if (process.argv.includes("--self-test")) {
  const checks = [
    ["mac-run kind is HARDWARE", classifyEvidence("mac-run.json", { kind: "mac-run" }) === "hardware"],
    ["the legacy mac-run.json with NO kind is grandfathered as hardware", classifyEvidence("mac-run.json", { manifestFingerprint: "x" }) === "hardware"],
    ["a NEW file with no kind is NOT hardware — grandfathering is by name, not by absence", classifyEvidence("new-lane.json", { manifestFingerprint: "x" }) === "unreadable"],
    ["an UNREADABLE file (parse failed → null) is NOT hardware — the planted defect", classifyEvidence("mac-run.json", null) === "unreadable"],
    ["the container lane's LEGACY spelling is not hardware", classifyEvidence("docker-run.json", { kind: "docker-run" }) === "other"],
    ["the container lane's CURRENT spelling is not hardware either", classifyEvidence("docker-run.json", { kind: "container-run" }) === "other"],
    ["an unknown lane is not hardware", classifyEvidence("whatever.json", { kind: "something-new" }) === "other"],
    ["an empty-string kind on a new file is not hardware", classifyEvidence("new.json", { kind: "" }) === "unreadable"],
  ];
  // LIVE: the emitter's own kind string, read from the generator rather than retyped —
  // if docker-verify.mjs renames it again, this arm notices instead of a comment rotting.
  const emitted = readFileSync(join(repoRoot, "scripts/docker-verify.mjs"), "utf8").match(/kind:\s*"([a-z-]+)"/);
  checks.push([
    `the container lane's emitted kind (${emitted ? emitted[1] : "NOT FOUND"}) is classified, and is NOT hardware`,
    emitted !== null && classifyEvidence("docker-run.json", { kind: emitted[1] }) === "other",
  ]);
  let bad = 0;
  for (const [n, ok] of checks) {
    console.log(`  ${ok ? "ok  " : "FAIL"} — ${n}`);
    if (!ok) bad += 1;
  }
  console.log(`\nself-test ${bad === 0 ? "passed" : "FAILED"} (${checks.length - bad}/${checks.length})`);
  process.exit(bad === 0 ? 0 : 1);
}

let anyStale = false;
let hardwareCount = 0;
const otherLanes = [];
const unreadable = [];
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
  const klass = classifyEvidence(f, ev);
  if (klass === "hardware") {
    hardwareCount += 1;
    if (!fresh) anyStale = true;
  } else if (klass === "other") {
    otherLanes.push(`${ev.kind}:${fresh ? "fresh" : "stale"}`);
  } else {
    unreadable.push(f);
  }
  const lane =
    klass === "hardware"
      ? "hardware"
      : klass === "other"
        ? `${ev.kind} lane — NOT hardware evidence`
        : "UNREADABLE or unclassified — counted as nothing";
  console.log(`  ${fresh ? "FRESH" : "STALE"}  artifacts/live-evidence/${f} [${lane}] (${detail})${summary}`);
}

const status = hardwareCount === 0 ? "none" : anyStale ? "stale" : "fresh";
if (unreadable.length > 0) {
  console.log(
    `  \u26a0 ${unreadable.length} evidence file(s) unreadable or carrying no recognised kind — counted as ` +
      `NOTHING, never as hardware: ${unreadable.join(", ")}`,
  );
}
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

// A DOCUMENT that restates this status is a claim that goes stale the moment the
// manifest moves — docs/BUILD_BACKLOG.md said "reports `liveEvidence=fresh`" while
// this script printed STALE, for sixteen days and seven manifest versions (flagged
// in ROLE_LENS_REVIEW_2026-08-21.md, still there on 2026-09-06). Any doc line that
// says this tool REPORTS a status must match what it reports right now.
const restated = findRestatedStatuses(repoRoot);
for (const { file, line, word } of restated) {
  if (word !== status) {
    console.error(`  ✗ ${file}:${line} says check-live-sync reports liveEvidence=${word}; it reports ${status} — a status is printed, never restated`);
    hardFail = true;
  }
}

process.exit(hardFail ? 1 : 0);

/** Every `reports \`liveEvidence=<word>\`` line in tracked markdown under docs/. */
export function findRestatedStatuses(root, files = null) {
  const out = [];
  const list = files ?? execSync("git ls-files -- 'docs/*.md' 'docs/**/*.md'", { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
  for (const rel of list) {
    let text;
    try { text = readFileSync(join(root, rel), "utf8"); } catch { continue; }
    text.split("\n").forEach((l, i) => {
      // A QUOTATION of a restated status is a record of the drift, not a
      // restatement: the 2026-08-21 role-lens review cites the backlog's wrong
      // sentence verbatim in order to refute it. Citation lines and blockquotes
      // are therefore exempt; every other line is a live claim.
      if (/Citation:/.test(l) || /^\s*>/.test(l)) return;
      const m = l.match(/reports\s+`liveEvidence=(fresh|stale|none)`/);
      if (m) out.push({ file: rel, line: i + 1, word: m[1] });
    });
  }
  return out;
}
