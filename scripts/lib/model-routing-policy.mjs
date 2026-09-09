// =============================================================================
// model-routing-policy — the ONE source of truth for how build-lane work is
// routed to a model tier, imported by BOTH the tap (scripts/lib/agent-model-tap.mjs)
// and the boundary gate (scripts/check-model-tap-boundary.mjs) so doctrine and
// fence can never silently drift (DR-032, extending DR-029).
//
// THE MODEL, in one breath: the coordinating Claude session is the brain. For a
// BULK, low-stakes, fully-recheckable chore it MAY hand a first draft to a
// free/local model reached through the DR-029 gateway (the tap). For anything
// that decides, judges, or authors shippable output it does the work itself
// (the CLAUDE tier — the tap is never called). And NO model, ever, may touch the
// product's deterministic decision path — that floor is the boundary gate, not
// this file's goodwill (golden rule 2).
//
// This module imports NOTHING from lib/*, artifacts/api-server, or a connector —
// it can never become a bridge into the decision path (the reciprocal fence the
// gate also enforces).
// =============================================================================

// The tiers. 'free-local' is reachable through the tap (env-configured gateway);
// 'claude' means the coordinating session does it inline and the tap returns null.
export const TIERS = Object.freeze({
  "free-local": Object.freeze({
    routable: true,
    // ENV-only, never committed (the DR-029 rule). The tap reads these three
    // names DIRECTLY (see agent-model-tap.mjs) so check-env-doc-readers.mjs sees
    // a reader for any doc that instructs them.
    baseUrlEnv: "SIGNALGRID_AGENT_MODEL_BASE_URL",
    modelEnv: "SIGNALGRID_AGENT_MODEL_NAME",
    keyEnv: "SIGNALGRID_AGENT_MODEL_KEY",
  }),
  claude: Object.freeze({ routable: false, inline: true }),
});

// Task class -> tier. Anything NOT listed here resolves to the CLAUDE tier: an
// unknown class is never routed to a cheap model (fail-closed — unknown tightens,
// never loosens, exactly like an unknown signal raising assurance).
const TASK_TIER = Object.freeze({
  // FREE/LOCAL — bulk, low-stakes, a gate can fully re-check the result.
  "log-triage": "free-local",
  "ci-triage": "free-local",
  "dev-summary": "free-local",
  "first-draft-prose": "free-local",
  "bulk-classify": "free-local",
  "reformat": "free-local",
  "dead-link-candidates": "free-local",
  "changelog-draft": "free-local",
  "commit-message-draft": "free-local",
  // CLAUDE — decides, judges, authors shippable output, or a gate cannot fully
  // re-check it. Listed for documentation; the default is CLAUDE anyway.
  decide: "claude",
  "review-verdict": "claude",
  authoring: "claude",
  "gate-design": "claude",
  security: "claude",
  "launch-claims": "claude",
  "owner-copy": "claude",
});

// Pure: task class -> tier name. Unknown -> 'claude' (fail-closed default).
export function tierFor(taskClass) {
  const tier = TASK_TIER[taskClass];
  return tier && TIERS[tier] ? tier : "claude";
}

export function isRoutable(taskClass) {
  return TIERS[tierFor(taskClass)]?.routable === true;
}

// ── The boundary the gate enforces (also single-sourced here) ────────────────
// Decision-path roots, as git-ls-files patterns. Scope is DERIVED from these at
// gate time (never a hand-list of files), so a NEW lib package, /v1 sub-path,
// connector family, or proof is covered the moment it exists. lib/**/src/**
// already covers connectors (lib/integrations/src/**); both are named for clarity
// and the gate dedups by resolved file.
export const FORBIDDEN_ROOTS = Object.freeze([
  "lib/**/src/**",
  "artifacts/api-server/src/**",
  "lib/integrations/src/**",
  // `**-proof.ts` matches a proof at ANY depth under scripts/src (the `.*` in the
  // gate's glob→regex spans `/`), not only the top level — so a proof moved into a
  // subdirectory cannot escape the fence.
  "scripts/src/**-proof.ts",
]);

// A decision-path file may reference NONE of these. Import specifiers for the tap
// or this policy; the env-var prefix; and the OpenAI-model-call shapes. Matched
// after comments are stripped (see the gate), case-insensitively where noted.
export const FORBIDDEN_IMPORT_SUBSTRINGS = Object.freeze([
  "agent-model-tap",
  "model-routing-policy",
]);
// Matched case-insensitively by the gate. Covers EVERY provider the doctrine names
// — "free, local, OR Claude" — not only the OpenAI shape, so an Anthropic/Ollama/
// Gemini/llama.cpp call in a decision-path file is caught too (golden rule 2 names
// Claude first, and a shape-specific denylist that omitted it would let the one
// model the product might most plausibly reach slip through).
export const FORBIDDEN_TOKENS = Object.freeze([
  "SIGNALGRID_AGENT_MODEL_", // the tap's env prefix
  // OpenAI-compatible (OpenAI, LM Studio, OmniRoute, most local servers)
  "chat/completions",
  ":1234/v1", // LM Studio local endpoint
  "new OpenAI(",
  "omniroute", // the gateway by name
  // Anthropic / Claude
  "@anthropic-ai",
  "api.anthropic.com",
  "new Anthropic(",
  "/v1/messages", // Anthropic REST messages endpoint
  // Ollama (local)
  ":11434",
  "/api/generate",
  "/api/chat",
  "/api/tags",
  // Google Gemini
  "generativelanguage",
  "generatecontent",
  "new GoogleGenerativeAI(",
  "@google/generative-ai",
  // llama.cpp bindings
  "node-llama-cpp",
]);

// The reciprocal fence: the tap and this policy must import from none of these.
export const TAP_MODULES = Object.freeze([
  "scripts/lib/agent-model-tap.mjs",
  "scripts/lib/model-routing-policy.mjs",
]);
export const RECIPROCAL_FORBIDDEN_IMPORT_SUBSTRINGS = Object.freeze([
  "/lib/",
  "artifacts/api-server",
  "integrations",
]);
