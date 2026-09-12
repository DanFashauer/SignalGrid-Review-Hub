// =============================================================================
// model-routing-policy — the ONE source of truth for how build-lane work is
// routed to a model tier, imported by BOTH the tap (scripts/lib/agent-model-tap.mjs)
// and the boundary gate (scripts/check-model-tap-boundary.mjs) so doctrine and
// fence can never silently drift (DR-044, extending DR-029).
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

// The tiers. 'free-local' is routable; in the public Review Hub the tap serves it
// from committed FIXTURES and makes no network call (AGENTS.md — no live API
// calls here). The real free/local gateway CLIENT lives out of this repository
// (DR-029) and reads the env names below; they are declared here as the
// documented out-of-tree contract — naming them keeps check-env-doc-readers.mjs
// satisfied for the docs that instruct them, without the in-repo tap ever reading
// them for a live call. 'claude' means the coordinating session does it inline
// and the tap returns null.
export const TIERS = Object.freeze({
  "free-local": Object.freeze({
    routable: true,
    // ENV-only, never committed (the DR-029 rule). Read by the OUT-OF-TREE gateway
    // client, NOT by the in-repo tap (which is fixture-backed). Named here so a doc
    // that instructs them has a reader, and so the boundary gate can forbid them in
    // the decision path.
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
  // The NATIVE decision path — every operative verdict source, not just the engine
  // ports. DecisionEngine.swift and AppWorkflows.swift are byte-faithful ports of the
  // TS simulator (golden rule 1); DecisionService.swift SELECTS and clamps the effective
  // outcome (local vs remote); PostureAllow.swift and RemediationAllow.swift are the
  // guards AROUND the engine that can WITHHOLD an allow; SignalContext.swift's
  // `AccessDecision.evaluate` is the single entry point that COMPOSES the zone pre-gate
  // with the resolved DecisionService and RETURNS the effective verdict; and
  // HostAppViewController.swift is where that verdict is actually PRODUCED for a live
  // session — it builds the live signal/location context, CHOOSES which DecisionService
  // controls access (`ClampedLocalDecisionService`, `RefusedDecisionService`, a remote
  // provider), and calls `AccessDecision.evaluate` on it. A provider SDK or model endpoint
  // in ANY of these seven files would reach a decision as surely as one in lib/*, so the
  // fence SCANS them all (a model-call shape is forbidden). It never modifies them, so
  // parity is untouched. (Enumerated rather than globbed on Services/*.swift or Views/*.swift
  // because those directories also hold non-verdict UI/config files; these seven are the
  // verdict sources. Codex review, 2026-09-12: the original five omitted the two files
  // above — a model call added to either would have reached an effective verdict while the
  // fence stayed green, since neither matched a declared root. Deriving this list from a
  // Swift-aware call graph would close the class outright, but this repo's gates are
  // text-scanners, not a Swift compiler front-end — see check-model-tap-boundary.mjs's own
  // "LIMITS, stated honestly" for why per-file scanning, not import-graph resolution, is
  // the tool this repo has; hand-enumerating the verdict SOURCES, one line per file with the
  // reason it belongs, is what stays auditable at that tool's grain. A self-test below plants
  // a model call in each of these two files and proves the fence reddens.)
  "native/ios/EnterpriseShell/Services/DecisionEngine.swift",
  "native/ios/EnterpriseShell/Services/AppWorkflows.swift",
  "native/ios/EnterpriseShell/Services/DecisionService.swift",
  "native/ios/EnterpriseShell/Services/PostureAllow.swift",
  "native/ios/EnterpriseShell/Services/RemediationAllow.swift",
  "native/ios/EnterpriseShell/Services/SignalContext.swift",
  "native/ios/EnterpriseShell/Views/HostAppViewController.swift",
  // The other two native decision CLIENTS (iOS is not the only one): Android and
  // desktop are both thin clients of `/v1` — they carry no engine port, but
  // AssistWire.kt/wire.rs PARSE the `/v1` response into the four-outcome vocabulary
  // and AssistOutcome.kt/assist.rs define what the host may conclude from it
  // (`proceedsWithoutFurtherAction`, `requiresChallenge`). A provider endpoint or
  // model reference reaching either pair would let a model influence whether the
  // host proceeds, exactly as surely as one in the iOS verdict sources above, while
  // the fence's own claim ("no model can reach a verdict") stayed uncontradicted
  // only because these two clients were never in scope (Codex review, 2026-09-12).
  // GateEndpoint.kt/endpoint.rs are deliberately NOT included: they gate TLS/loopback
  // on the URL, they never see or shape the verdict itself.
  "native/android/core/src/main/kotlin/com/signalgrid/assist/core/AssistWire.kt",
  "native/android/core/src/main/kotlin/com/signalgrid/assist/core/AssistOutcome.kt",
  "native/desktop/core/src/wire.rs",
  "native/desktop/core/src/assist.rs",
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
  // The workspace-alias form of the same decision-path packages. A relative
  // "../lib/..." is caught by "/lib/", but "@workspace/signalgrid-core" is not —
  // and scripts/package.json makes those aliases resolvable, so without this the
  // tap could import decision-path code through an alias and the reciprocal fence
  // would stay green. The tap and policy import only each other (a relative path)
  // and node builtins, so forbidding every "@workspace/" import here is exact.
  "@workspace/",
]);
