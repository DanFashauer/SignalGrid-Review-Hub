// =============================================================================
// agent-model-tap — the build-lane tap that hands a low-stakes chore's FIRST
// DRAFT to the free/local tier (DR-044, extending DR-029). Report-only: it
// RETURNS text and never writes the tree, gates, decides, throws, exits, or
// blocks. A miss returns null; the caller then proceeds on its deterministic
// path, or hands the task to the coordinating Claude session.
//
// PUBLIC-SAFE BY CONSTRUCTION (AGENTS.md — no live API calls in the Review Hub).
// This in-repo tap makes NO network call. The real free/local gateway client
// (the DR-029 model-access layer) lives OUT OF THIS REPOSITORY and is referenced
// only. In-repo, draftWithModel() returns a committed FIXTURE draft for a
// routable task class, or null — so the routing policy and its fence can be
// exercised and gated here without a live integration ever entering the public
// surface. check-model-tap-boundary.mjs enforces the no-live-call rule on the
// tap itself, and the reciprocal fence keeps it out of the decision path.
//
//   import { draftWithModel, isRoutingConfigured } from "./agent-model-tap.mjs";
//   const draft = await draftWithModel({ taskClass: "log-triage", input: log });
//   if (draft) use(draft.text);   // draft.provenance.verified === false, always
//   else fallBackDeterministicallyOrToClaude();
// =============================================================================
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tierFor, TIERS, isRoutable } from "./model-routing-policy.mjs";

const FIXTURES_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "agent-model-tap-fixtures.json");

function note(reason) {
  // One honest line on stderr; never stdout (callers may parse stdout), never fatal.
  try { process.stderr.write(`agent-model-tap: ${reason}\n`); } catch { /* ignore */ }
}

// The committed fixture drafts, read fresh each call and defensively. A missing,
// truncated, or malformed fixtures file is not fatal — it degrades to "no draft".
function loadFixtures() {
  try {
    const raw = JSON.parse(readFileSync(FIXTURES_PATH, "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

// True only when the class routes to a routable tier AND a fixture draft exists
// for it — so a caller can branch before asking for a draft. No env, no network.
export function isRoutingConfigured(taskClass) {
  if (!isRoutable(taskClass)) return false;
  const draft = loadFixtures()[taskClass];
  return typeof draft === "string" && draft.length > 0;
}

// Returns { text, model:'fixture', tier, provenance:{drafted:'fixture', verified:false} }
// or null. NEVER throws. NEVER calls the network — the live gateway is out-of-tree.
export async function draftWithModel({ taskClass, system, input } = {}) {
  try {
    const tier = tierFor(taskClass);
    if (!TIERS[tier]?.routable) {
      // CLAUDE tier (or unknown class -> claude): by design the coordinating
      // session does this inline; the tap is not the path. Not a miss.
      return null;
    }
    if (typeof input !== "string" || input.length === 0) {
      note("no input — proceeding without a draft");
      return null;
    }
    const draft = loadFixtures()[taskClass];
    if (typeof draft !== "string" || draft.length === 0) {
      // No in-repo fixture for this class. The live free/local draft is the
      // out-of-tree gateway's job (DR-029); in the public Review Hub we proceed
      // deterministically or hand the task to the coordinating session.
      note(`no fixture for "${taskClass}" — proceeding without a draft (live routing is out-of-tree, DR-029)`);
      return null;
    }
    return { text: draft, model: "fixture", tier, provenance: { drafted: "fixture", verified: false } };
  } catch (e) {
    // The tap must never throw. Any unexpected error degrades to "no draft".
    note(`error (${e && e.message ? e.message : "unknown"}) — proceeding without a draft`);
    return null;
  }
}
