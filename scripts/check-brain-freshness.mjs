// Brain-freshness gate — the Standing Brain Cycle's STEP 0 (DR-032).
//
//   node scripts/check-brain-freshness.mjs             # runtime precondition (live, diffs origin)
//   node scripts/check-brain-freshness.mjs --self-test # the fail-closed comparator, both directions
//
// WHY THIS EXISTS. The brain cycle (docs/agent/BRAIN_CYCLE_DESIGN.md, DR-032) audits the
// real HEAD tree with the lens panel this lane carries. If this lane's BRAIN — its
// skills, agents, connector wiring and plugin manifest — is behind mainline, it audits
// the wrong code with the wrong reviewers. So before the cycle fans out a single lens it
// asserts, fail-closed, that this lane's brain matches origin. A brain behind mainline
// does not audit; it refuses and heartbeats "stale brain, did not audit."
//
// SCOPE — the brain, and ONLY the brain: `.claude/`, `.mcp.json`, `.claude-plugin/plugin.json`.
// Deliberately NOT `docs/`: the cycle itself commits into docs/agent/ and artifacts/, so
// including docs/ would make this near-self-deadlocking (constant refusal on the lane that
// just wrote a heartbeat) or vacuous (the ephemeral cloud lane re-pulls to tip anyway).
// The judges of the design flagged both failure modes; the scope is the fix.
//
// COMPARED AGAINST origin/SignalGrid_Alpha, never local HEAD — mainline is the source of
// truth for the brain. Identity is required for Slice 1; a benign one-commit-ahead
// tolerance is a Slice-2 refinement, noted in the design, deliberately not guessed here.
//
// FAIL-CLOSED at every unknown (golden rule 2): an empty derived scope (a vanished
// `.claude/`) FAILS; a fetch that cannot reach origin FAILS ("could not look" is never
// "agrees"); any drift FAILS and names the files. This runtime check is NOT a per-push
// preflight/CI gate — a feature branch legitimately differs from origin — so preflight/CI
// run only `--self-test`, which proves the comparator can fail in both directions.
//
// SCOPE IS DERIVED from `git ls-files`, so a new brain file joins the check the moment it
// is tracked; an untracked scratch file can neither widen nor narrow it.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE_REF = "origin/SignalGrid_Alpha";
// The brain: the operating plane git carries byte-identically between lanes.
const SCOPE = [".claude", ".mcp.json", ".claude-plugin/plugin.json"];

function git(args, opts = {}) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", ...opts });
}

// The tracked brain files, derived from git — fail-closed on an empty derivation.
function trackedBrainFiles(root) {
  const out = execFileSync("git", ["ls-files", ...SCOPE], { cwd: root, encoding: "utf8" });
  return out.split("\n").map((s) => s.trim()).filter(Boolean).sort();
}

// PURE detector. Given the tracked brain paths and two path->blobHash maps (this lane's
// working tree vs origin), return the list of drift strings. Empty tracked set is itself a
// drift (fail-closed). Both the live gate and the self-test drive this one function.
export function brainDrift(tracked, localHashes, originHashes) {
  const v = [];
  if (!tracked || tracked.length === 0) {
    v.push("no tracked brain files under .claude/ / .mcp.json / .claude-plugin/plugin.json — refusing to pass on an empty derivation (a vanished brain is a defect, not a match)");
    return v;
  }
  for (const p of tracked) {
    const local = localHashes[p];
    const origin = originHashes[p];
    if (origin === undefined) {
      v.push(`brain file present on this lane but NOT on ${BASE_REF}: ${p}`);
    } else if (local === undefined) {
      v.push(`brain file on ${BASE_REF} but MISSING from this lane: ${p}`);
    } else if (local !== origin) {
      v.push(`brain file differs from ${BASE_REF}: ${p}`);
    }
  }
  // A brain file that exists on origin but is not in this lane's tracked set is drift too.
  const trackedSet = new Set(tracked);
  for (const p of Object.keys(originHashes)) {
    if (!trackedSet.has(p)) v.push(`brain file on ${BASE_REF} but not tracked on this lane: ${p}`);
  }
  return v;
}

// git's blob hash for each path at a ref (or the working tree when ref is null).
function hashesAt(paths, ref) {
  const out = {};
  for (const p of paths) {
    try {
      if (ref === null) {
        // working-tree content hash (honours uncommitted edits — the brain as it would audit)
        out[p] = execFileSync("git", ["hash-object", p], { cwd: repoRoot, encoding: "utf8" }).trim();
      } else {
        out[p] = execFileSync("git", ["rev-parse", `${ref}:${p}`], { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      }
    } catch {
      // absent at this ref/tree — left undefined, which brainDrift() reports as drift.
    }
  }
  return out;
}

function selfTest() {
  const tracked = [".claude/agents/a.md", ".mcp.json", ".claude-plugin/plugin.json"];
  const origin = { ".claude/agents/a.md": "h1", ".mcp.json": "h2", ".claude-plugin/plugin.json": "h3" };

  // 1. identical → no drift
  const clean = brainDrift(tracked, { ...origin }, { ...origin });
  if (clean.length !== 0) { console.error("SELF-TEST FAIL: identical brain reported as drifted:", clean); return 1; }

  // 2. one file differs → drift
  const changed = brainDrift(tracked, { ...origin, ".mcp.json": "DIFFERENT" }, origin);
  if (changed.length === 0) { console.error("SELF-TEST FAIL: a changed brain file was not flagged"); return 1; }

  // 3. a brain file missing on this lane → drift
  const missingLocal = { ...origin }; delete missingLocal[".claude/agents/a.md"];
  if (brainDrift(tracked, missingLocal, origin).length === 0) {
    console.error("SELF-TEST FAIL: a brain file missing from this lane was not flagged"); return 1;
  }

  // 4. a brain file on origin the lane does not track → drift
  const extraOrigin = { ...origin, ".claude/agents/ghost.md": "h9" };
  if (brainDrift(tracked, origin, extraOrigin).length === 0) {
    console.error("SELF-TEST FAIL: an origin-only brain file was not flagged"); return 1;
  }

  // 5. empty derived scope → FAIL-CLOSED (the keystone: could-not-derive is never a match)
  if (brainDrift([], {}, {}).length === 0) {
    console.error("SELF-TEST FAIL: an empty brain derivation passed — must fail closed"); return 1;
  }

  console.log("brain-freshness self-test: identical=clean, changed=flagged, missing=flagged, origin-only=flagged, empty=fail-closed — green");
  return 0;
}

function run() {
  const tracked = trackedBrainFiles(repoRoot);
  if (tracked.length === 0) {
    console.error("Brain-freshness gate FAILED: no tracked brain files under .claude/ / .mcp.json / .claude-plugin/plugin.json — refusing (fail-closed).");
    process.exit(1);
  }

  // Fetch origin's brain ref. Cannot look === does not agree.
  try {
    git(["fetch", "origin", "SignalGrid_Alpha"], { stdio: ["ignore", "ignore", "pipe"] });
  } catch (e) {
    console.error(`Brain-freshness gate FAILED: could not fetch ${BASE_REF} to verify freshness (${String(e.message || e).trim()}) — refusing; the cycle must not audit on an unverifiable brain.`);
    process.exit(1);
  }
  // Confirm the base ref resolves after the fetch.
  try {
    git(["rev-parse", "--verify", BASE_REF], { stdio: ["ignore", "ignore", "pipe"] });
  } catch {
    console.error(`Brain-freshness gate FAILED: ${BASE_REF} does not resolve after fetch — refusing.`);
    process.exit(1);
  }

  const originFiles = git(["ls-tree", "-r", "--name-only", BASE_REF, ...SCOPE])
    .split("\n").map((s) => s.trim()).filter(Boolean);
  const allPaths = Array.from(new Set([...tracked, ...originFiles]));
  const local = hashesAt(allPaths, null);
  const origin = hashesAt(allPaths, BASE_REF);
  const drift = brainDrift(tracked, local, origin);

  if (drift.length > 0) {
    console.error(`Brain-freshness gate FAILED — this lane's brain is not current with ${BASE_REF}:`);
    for (const d of drift) console.error("  - " + d);
    console.error("  Pull mainline before the brain cycle audits: git pull origin SignalGrid_Alpha");
    process.exit(1);
  }
  console.log(`Brain-freshness gate passed — this lane's brain (${tracked.length} tracked files) matches ${BASE_REF}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) process.exit(selfTest());
  run();
}
