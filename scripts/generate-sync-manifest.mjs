// Live-sync manifest generator — the single machine-readable statement of the
// repo's cross-surface contracts, for the two consumers that build OUTSIDE this
// repo's CI: the owner's Mac signalgrid-mcp lane (scripts/verify-all.mjs) and the
// iOS EnterpriseShell app (native/ios/EnterpriseShell). See docs/LIVE_SYNC_LOOP.md.
//
//   node scripts/generate-sync-manifest.mjs            # (re)publish the manifest
//   node scripts/generate-sync-manifest.mjs --stamp    # also record `git rev-parse HEAD`
//
// Writes artifacts/sync/live-sync-manifest.json:
//
//   manifestVersion — a monotonic integer. It increments ONLY when the fingerprint
//                     changes; regenerating an unchanged repo rewrites the file
//                     BYTE-IDENTICALLY, so `scripts/check-live-sync.mjs` (and plain
//                     `git diff`) can treat any difference as real drift.
//   fingerprint     — sha256 over the canonical (stable-key-ordered) JSON of `body`.
//   body            — the fingerprinted facts (see computeBody below). Contains NO
//                     timestamps, NO commit hashes, NO absolute paths, NO host or
//                     user identifiers: the body must be a pure function of the
//                     tracked sources, or determinism (and the drift gate) dies.
//   generatedFrom   — OUTSIDE the fingerprint. `{ commit }` from `git rev-parse
//                     HEAD` when --stamp is passed; otherwise the previous stamp is
//                     carried forward unchanged (so a no-op regeneration stays
//                     byte-identical) or null for a fresh manifest.
//
// Extraction note (deliberate trade-off): the signal-kind / category / reason-code
// lists live in TypeScript sources (`as const` arrays and string-literal unions).
// Importing TS from an .mjs script would need a loader/transpile step this
// dependency-free script shouldn't drag in, so each list is extracted by parsing
// the source text: comments are stripped first (so prose can't inject values),
// the exact exported declaration is anchored by name, the quoted members are
// collected, and every extractor FAILS LOUDLY if the anchor or members are not
// found or a member is not a plausible identifier — a refactor of the source
// breaks this generator rather than silently publishing an empty list. This is
// the same source-anchored discipline scripts/check-guard-registries.mjs uses.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const MANIFEST_PATH = resolve(repoRoot, "artifacts/sync/live-sync-manifest.json");

// Repo-relative paths of every source of truth this manifest snapshots.
const CONTRACT_REL = "lib/integrations/src/integrations/macos-posture/contract/posture-report.contract.json";
const SOURCES = {
  contract: CONTRACT_REL,
  signalKinds: "lib/posture-composition/src/types.ts",
  signalCategories: "lib/signalgrid-core/src/types.ts",
  taskException: "lib/integrations/src/integrations/task-exception/types.ts",
  workContext: "lib/work-context/src/types.ts",
  handoffSim: "lib/handoff-sim/src/types.ts",
  mcpServer: "artifacts/mcp-server/src/index.ts",
};

function die(msg) {
  console.error(`generate-sync-manifest: ${msg}`);
  process.exit(1);
}

function readSource(rel) {
  try {
    return readFileSync(resolve(repoRoot, rel), "utf8");
  } catch {
    return die(`cannot read ${rel} — has the source of truth moved? Update SOURCES here.`);
  }
}

// Strip /* */ and // comments so doc prose can never contribute (or hide) members.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, "");
}

const MEMBER_RE = /^[A-Za-z0-9_]+$/;

function membersOf(block, what) {
  const vals = [...block.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
  if (vals.length === 0) die(`extracted zero members for ${what} — extraction anchor drifted.`);
  for (const v of vals) {
    if (!MEMBER_RE.test(v)) die(`suspicious member '${v}' extracted for ${what} — refusing to publish a mis-parse.`);
  }
  return vals;
}

/** `export const NAME = [ ... ] as const` → the quoted members, in source order. */
function extractConstArray(rel, name) {
  const src = stripComments(readSource(rel));
  const m = src.match(new RegExp(`export const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const`));
  if (!m) return die(`could not find 'export const ${name} = [...] as const' in ${rel}.`);
  return membersOf(m[1], `${rel}#${name}`);
}

/** `export type NAME = "a" | "b" | ...;` → the quoted members, in source order. */
function extractTypeUnion(rel, name) {
  const src = stripComments(readSource(rel));
  const m = src.match(new RegExp(`export type ${name}\\s*=([\\s\\S]*?);`));
  if (!m) return die(`could not find 'export type ${name} = ...' in ${rel}.`);
  return membersOf(m[1], `${rel}#${name}`);
}

/** The documented proof-count table — the SAME pattern scripts/check-proof-counts.mjs
 *  enforces over docs/ (that gate proves the numbers true; this snapshots them).
 *  Files are scanned in sorted order and disagreements between docs are fatal here
 *  exactly as they are there. */
function extractProofCounts() {
  const PATTERN = /proof:([a-z0-9-]+)`?\s*\((\d+)\s+checks/g;
  const docsDir = join(repoRoot, "docs");
  const counts = {};
  // RECURSIVE on purpose (D3): moved docs stay inside manifest scope.
  for (const file of readdirSync(docsDir, { recursive: true }).map(String).filter((f) => f.endsWith(".md")).sort()) {
    const text = readFileSync(join(docsDir, file), "utf8");
    for (const m of text.matchAll(PATTERN)) {
      const [, name, count] = m;
      if (name in counts && counts[name] !== Number(count)) {
        die(`docs disagree on proof:${name} (${counts[name]} vs ${count}) — fix docs (check-proof-counts will also fail).`);
      }
      counts[name] = Number(count);
    }
  }
  if (Object.keys(counts).length === 0) die("found zero documented proof counts in docs/ — pattern drifted?");
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** MCP tool surface: every `server.registerTool("name", ...)` in the server source. */
function extractMcpTools() {
  const src = stripComments(readSource(SOURCES.mcpServer));
  const tools = [...src.matchAll(/server\.registerTool\(\s*"([^"]+)"/g)].map((m) => m[1]);
  if (tools.length === 0) die(`found zero registerTool calls in ${SOURCES.mcpServer}.`);
  return tools;
}

/** Canonical JSON: keys sorted recursively, no whitespace — the fingerprint input. */
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function fingerprintOf(body) {
  return createHash("sha256").update(stableStringify(body)).digest("hex");
}

/** The fingerprinted body — a pure function of the tracked sources. */
export function computeBody() {
  const contractBytes = readFileSync(resolve(repoRoot, CONTRACT_REL));
  return {
    schema: "signalgrid-live-sync-manifest/v1",
    contract: {
      path: CONTRACT_REL,
      sha256: createHash("sha256").update(contractBytes).digest("hex"),
    },
    signalKinds: extractConstArray(SOURCES.signalKinds, "SIGNAL_KINDS"),
    // `SignalCategory` used to be a hand-written union and is now derived from the
    // `SIGNAL_CATEGORIES` const array — the same correction `SIGNAL_KINDS` already
    // carries, made so the count is readable at runtime instead of existing only in the
    // type system. The extractor follows the value, not the type: a bare union has
    // nothing to publish from once the members move.
    signalCategories: extractConstArray(SOURCES.signalCategories, "SIGNAL_CATEGORIES"),
    taskExceptionReasonCodes: extractTypeUnion(SOURCES.taskException, "TaskExceptionReasonCode"),
    workContextTrustCeilings: extractConstArray(SOURCES.workContext, "CONTEXT_TRUST_CEILINGS"),
    handoffSimRefusalCodes: extractTypeUnion(SOURCES.handoffSim, "HandoffSimErrorCode"),
    proofCounts: extractProofCounts(),
    mcpTools: extractMcpTools(),
    consumers: {
      macMcpLane: "scripts/verify-all.mjs (SIGNALGRID_MCP_PATH=... --require-mcp --emit-evidence)",
      ios: "native/ios/EnterpriseShell",
    },
  };
}

function main() {
  const stamp = process.argv.includes("--stamp");
  const body = computeBody();
  const fingerprint = fingerprintOf(body);

  let existing = null;
  try {
    existing = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  } catch {
    existing = null;
  }

  const unchanged = existing?.fingerprint === fingerprint;
  const manifestVersion = unchanged
    ? existing.manifestVersion
    : (Number.isInteger(existing?.manifestVersion) ? existing.manifestVersion : 0) + 1;

  // generatedFrom lives OUTSIDE the fingerprint. Without --stamp a no-op
  // regeneration carries the previous stamp forward so the file stays
  // byte-identical; a CHANGED body without --stamp drops the old stamp rather
  // than let a stale commit hash masquerade as this body's origin.
  const generatedFrom = stamp
    ? { commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim() }
    : unchanged
      ? (existing.generatedFrom ?? null)
      : null;

  const manifest = { manifestVersion, fingerprint, body, generatedFrom };
  mkdirSync(dirname(MANIFEST_PATH), { recursive: true });
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `live-sync manifest ${unchanged ? "unchanged" : "UPDATED"} — version ${manifestVersion}, fingerprint ${fingerprint.slice(0, 16)}…`,
  );
  console.log(`  ${MANIFEST_PATH}`);
  console.log(
    `  kinds=${body.signalKinds.length} categories=${body.signalCategories.length} ` +
      `taskExceptionCodes=${body.taskExceptionReasonCodes.length} ceilings=${body.workContextTrustCeilings.length} ` +
      `refusals=${body.handoffSimRefusalCodes.length} proofs=${Object.keys(body.proofCounts).length} mcpTools=${body.mcpTools.length}`,
  );
}

// Run only when invoked directly (check-live-sync imports the extractors above).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
