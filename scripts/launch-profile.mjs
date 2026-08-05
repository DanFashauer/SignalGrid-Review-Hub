// The LAUNCH PROFILE — what "SignalGrid Shared-Device Trust Gateway" is, and
// what it is not.
//
// WHY THIS FILE EXISTS. The owner's launch plan names ten blockers. Three of them
// are the same problem seen from three angles:
//
//   Blocker 1  the pull request has outgrown reviewability — 320 files, 47k lines.
//   Blocker 8  too many API and app surfaces.
//   Blocker 10 mixed autonomy claims: what is ENFORCED, what is merely OBSERVED and
//              what is SIMULATED is not consistently stated.
//
// All three are downstream of one missing artifact: nothing in this repository
// says which of the 51 connector families, 41 signal kinds, 54 API paths and 17
// client surfaces are the PRODUCT, and which are proven work that is not shipping
// yet. Without that, every surface reads as equally load-bearing, and a reviewer
// has no way to tell a launch-critical file from a deferred one. Breadth was never
// the defect on its own — breadth with no declared edge is.
//
// So this is the edge, declared, with every item on one side of it or the other.
//
// THE CRITERION, quoted from the owner's plan and not softened:
//
//     "one tenant-aware product, one host app, one read-only Entra/Intune
//      connector, one operator console, one design partner, one paid deployment"
//
// Every "launch" entry below has to survive that sentence. Most things do not,
// and that is the point: "deferred" is not a demotion, it is the freeze working.
//
// THE FOUR STATUSES, and the distinction Blocker 10 turns on:
//
//   launch     in the Limited GA surface.
//   deferred   real, gated, proven, staying in the repository — NOT Limited GA.
//   demo_only  exists to demonstrate or explain. Must never be presented as
//              shipping product.
//   internal   harness, generator or evidence plumbing. Not a product surface at all.
//
// WHY EVERY ITEM IS LISTED, including the 134 that are merely deferred. A profile
// that named only the launch set would let a 52nd connector family appear tomorrow
// and be silently deferred by default — which is exactly the breadth the freeze
// forbids, arriving through the door marked "not in scope". Because every derived
// item must appear here by name, adding one FAILS `scripts/check-launch-profile.mjs`
// until a human classifies it. The freeze is not a promise in a document; it is
// this list, and the gate that reads it.
//
// THE GATE CHECKS BOTH DIRECTIONS, because one direction is not a bijection:
//   · every id here must exist in the repository  (no phantom scope)
//   · every real item must appear here            (no silent omission)
//
// SCOPE OF THE PROFILE ITSELF, stated so its silence is not mistaken for coverage:
// it covers the four surfaces where scope sprawl is the blocker — connector
// families, signal kinds, published API paths, and client/app surfaces. It does
// NOT classify the 35 workspace libraries: those are implementation behind the
// api-server, not surfaces a customer or reviewer meets, and enumerating them
// would add noise to the artifact whose whole job is removing it.
//
// WHAT THIS FILE DOES NOT DO. It does not change one line of runtime behaviour.
// Exposing launch status at runtime — a /v1 arm reporting, per signal kind,
// enforced vs observed vs simulated — would close Blocker 10 more completely and
// is deliberately NOT done here, because it would widen the API surface and add
// diff to the pull request that Blocker 1 says is already too large. Recorded as a
// gap rather than quietly skipped.
//
// RATIFICATION. Scope is the owner's call, not the architect's. This file is the
// proposal in reviewable form: the launch set is small enough to argue with line
// by line, and every exclusion is visible. Change a status, re-run the gate.

/** Bumped whenever a status changes. Not a semver — a serial number, so a doc or a
 *  review can name the exact revision of the scope it was written against. */
export const LAUNCH_PROFILE_VERSION = 1;

export const PRODUCT_NAME = "SignalGrid Shared-Device Trust Gateway";
export const TARGET = "Limited GA, 2027-02-04";

/** The criterion every `launch` entry is tested against, quoted verbatim. */
export const CRITERION =
  "one tenant-aware product, one host app, one read-only Entra/Intune connector, " +
  "one operator console, one design partner, one paid deployment";

/** Shared reason for every `deferred` item, written once rather than restated 134
 *  times. Deferred means: it exists, it is gated, it is proven, its proof runs in
 *  CI — and it is not part of Limited GA. Nothing here is deleted or doubted. */
export const DEFERRED_RATIONALE =
  "Real, gated and proven, and outside Limited GA: the criterion says ONE of most things, " +
  "and every additional surface is a surface the design partner, the security assessor and " +
  "the on-call rotation would each have to cover.";

/**
 * SURFACES. Each carries how its real membership is DERIVED — the gate re-derives
 * from that source every run and refuses to trust this file's own arithmetic.
 */
export const SURFACES = [
  {
    key: "connector-families",
    derivedFrom:
      "every subdirectory of lib/integrations/src/integrations/ that contains an index.ts " +
      "(adapters/ has none, so no exclusion list is needed and none is kept)",
    launch: [
  {
    id: "graph",
    reason:
      "THE one read-only Entra/Intune connector. It is also the only family in the " +
      "repository whose live transport actually addresses graph.microsoft.com — a fact " +
      "worth stating plainly, because several families NAMED for Microsoft do not.",
  },
  {
    id: "device-management-health",
    reason:
      "Grades whether an Intune compliance answer is CURRENT. A device reported " +
      "compliant that has not checked in for weeks is the unearned affirmative in its " +
      "purest form, and it is the single reason a buyer picks this product over reading " +
      "the Intune console directly.",
    gap:
      "Its live transport defaults to https://device-management-bridge.local/…, a generic " +
      "bridge — NOT graph.microsoft.com. Shipping it as part of the one Entra/Intune " +
      "connector requires a Graph-backed transport that does not exist yet. This is the " +
      "concrete content of the owner's Blocker 5.",
  },
  {
    id: "local-authority",
    reason:
      "Answers whether a shared device may act on its OWN authority right now — awaiting " +
      "first unlock after a restart, or past the interval its offline grant declares. " +
      "Device-reported, so it ships without widening the connector surface at all, and it " +
      "is the frontline half of the product the name promises.",
  },
  ],
    demo_only: [],
    internal: [],
    deferred: [
      "access-governance",
      "agent-behavior",
      "agent-identity",
      "app-update",
      "benchmark-selection",
      "bootstrap-credential",
      "break-glass",
      "caep-events",
      "carrier",
      "challenge-capability",
      "change-window",
      "credential-exposure",
      "credential-rotation",
      "custody-beacon",
      "data-protection",
      "device-attestation",
      "edr-threat",
      "entitlement-binding",
      "identity-risk",
      "itsm",
      "link-usability",
      "location-services",
      "macos-posture",
      "nac",
      "network-nac",
      "oauth-consent",
      "observability-integrity",
      "ot-posture",
      "pacs-access",
      "passkey-assurance",
      "peripheral-control",
      "platform-sso",
      "policy-binding",
      "response-accountability",
      "rtls-custody",
      "service-lifecycle",
      "session-readiness",
      "shift-context",
      "siem",
      "sse-egress",
      "sso-session",
      "syslog",
      "task-exception",
      "telemetry",
      "token-binding",
      "uem",
      "vuln-scan",
      "webhooks",
    ],
  },
  {
    key: "signal-kinds",
    derivedFrom: "the SIGNAL_KINDS const array in lib/posture-composition/src/types.ts",
    launch: [
      {
        id: "device_posture",
        reason: "What the one Graph connector produces.",
      },
      {
        id: "device_management_health",
        reason: "Whether that posture answer is current rather than merely present.",
      },
      {
        id: "local_authority",
        reason: "Whether the shared device may act on its own authority right now.",
      },
    ],
    demo_only: [],
    internal: [],
    deferred: [
      "access_governance",
      "agent_behavior",
      "agent_identity",
      "app_update",
      "attestation",
      "benchmark_selection",
      "bootstrap_credential",
      "break_glass",
      "challenge_capability",
      "change_window",
      "credential_exposure",
      "credential_rotation",
      "custody",
      "custody_beacon",
      "data_protection",
      "detection",
      "identity",
      "link_usability",
      "location",
      "location_certainty",
      "network",
      "oauth_consent",
      "observability_integrity",
      "ot_posture",
      "pacs_access",
      "peripheral",
      "platform_sso",
      "policy_binding",
      "reachability",
      "service_lifecycle",
      "session_readiness",
      "shift_context",
      "sse_egress",
      "sso_session",
      "task_exception",
      "threat",
      "token_binding",
      "vulnerability",
    ],
  },
  {
    key: "published-api-paths",
    derivedFrom:
      "path keys in lib/api-spec/v1-openapi.yaml — the PUBLISHED contract, which is what an " +
      "integrator and a security assessor actually meet. Deliberately not the served route " +
      "table: the server mounts this contract under /api and ALSO registers `/`, `/console` " +
      "and `/metrics` directly on the app, outside it. Those three are recorded as a gap " +
      "rather than folded in, because widening this surface to the served table would mean " +
      "writing a second route parser that drifts on its own, while the spec already has the " +
      "OpenAPI contract gate holding it.",
    launch: [
  {
    id: "/v1/decisions/evaluate",
    reason: "The Assist gate itself. If only one route shipped, it would be this one.",
  },
  {
    id: "/v1/decisions",
    reason: "The console's list view; without it an operator cannot see what the gate did.",
  },
  { id: "/v1/decisions/{id}", reason: "One decision in full." },
  {
    id: "/v1/decisions/{id}/evidence",
    reason:
      "WHY the gate answered as it did. The product's entire claim is that its answers are " +
      "explainable and reproducible, so this route is not optional garnish — it is the claim.",
  },
  { id: "/v1/context", reason: "Tenant context. \"Tenant-aware\" is in the criterion." },
  { id: "/v1/keys", reason: "API-key authentication for the above." },
  { id: "/v1/audit", reason: "The durable audit ledger a regulated pilot is bought on." },
  { id: "/v1/metrics", reason: "Operability. A service nobody can watch cannot be run." },
  ],
    demo_only: [],
    internal: [],
    deferred: [
      "/v1/decisions/reconcile",
      "/v1/decisions/{id}/simulate",
      "/v1/policies",
      "/v1/policies/{id}/versions",
      "/v1/policies/{id}/versions/{versionId}/activate",
      "/v1/policies/{id}/tests",
      "/v1/connectors",
      "/v1/connectors/{id}/sync-runs",
      "/v1/connectors/{id}/sync",
      "/v1/decisions/{id}/resolution",
      "/v1/decisions/{id}/resolve",
      "/v1/webhooks",
      "/v1/webhooks/deliveries",
      "/v1/remediation",
      "/v1/remediation/{id}/approve",
      "/v1/app-workflows/integrations",
      "/v1/app-workflows/evaluate",
      "/v1/step-up/enroll/options",
      "/v1/step-up/enroll/verify",
      "/v1/step-up/challenge",
      "/v1/app-workflows/complete-step-up",
      "/cp/v1/tenants",
      "/cp/v1/sites",
      "/cp/v1/edge-nodes",
      "/cp/v1/fleet",
      "/cp/v1/policy-bundle",
      "/cp/v1/sync/{nodeId}",
      "/cp/v1/telemetry",
      "/cp/v1/health",
      "/cp/v1/ops-intelligence",
      "/cp/v1/flows",
      "/cp/v1/flows/health",
      "/cp/v1/recommendations",
      "/cp/v1/signal-discovery",
      "/cp/v1/ddm",
      "/cp/v1/fleet-mdm",
      "/cp/v1/grid/coverage",
      "/cp/v1/grid/sourcing",
      "/cp/v1/grid/evidence-coverage",
      "/cp/v1/grid/config",
      "/cp/v1/grid/provisioning",
      "/cp/v1/apps/resilience",
      "/v1/sessions/start",
      "/v1/sessions/{id}",
      "/v1/sessions/{id}/refresh",
      "/v1/sessions/{id}/end",
    ],
  },
  {
    key: "app-surfaces",
    derivedFrom:
      "every directory under artifacts/, plus every `type: application` target in BOTH " +
      "native/ios/project.yml and native/ios/SignalGridMobile/project.yml, prefixed `ios:` " +
      "(test targets and the SignalGridMobileCore framework are excluded — neither is a " +
      "surface anyone meets)",
    launch: [
  {
    id: "api-server",
    reason: "The product: one tenant-aware decision service. The whole of \"one product\".",
  },
  {
    id: "signalgrid-review",
    reason: "The one operator console. Every other web surface below is not it.",
  },
  {
    id: "ios:EnterpriseShell",
    reason:
      "The one host app — the reference shell a design partner integrates against. Under " +
      "the embedded-UX law the worker uses their OWN app, so this ships as the integration " +
      "reference and the pilot vehicle, not as an app anyone is asked to adopt.",
  },
  ],
    demo_only: [
  {
    id: "mockup-sandbox",
    reason: "A mockup surface. Never shipping; exists to show shapes before they are built.",
  },
  {
    id: "connector-emulator",
    reason:
      "Emulates upstreams so connectors can be exercised with no vendor account. Presenting " +
      "it as a shipped integration would be the exact class of claim this repo polices.",
  },
  {
    id: "signalgrid-app",
    reason: "A second client surface. Blocker 8 names exactly this; the console is the one.",
  },
  {
    id: "signalgrid-desktop",
    reason: "A third client surface. Same reason.",
  },
  {
    id: "signalgrid-mobile-pwa",
    reason: "A fourth client surface. Same reason.",
  },
  {
    id: "tools:room-console",
    reason:
      "The Trusted Room Entry console: a browser page that esbuild-bundles the decision core " +
      "and runs it locally so an evaluator can drive it without a server. It is how the " +
      "product is SHOWN, never how it is sold, and it has no manifest of any kind — which is " +
      "why the first version of the gate could not see it at all.",
  },
  {
    id: "ios:WardlinkDemo",
    reason:
      "A demo app, named as one. It exists to show the Wardlink flow to a room, and the " +
      "moment it is described as shipping the product has made its first false claim.",
  },
  {
    id: "signalgrid-web",
    reason:
      "The public explanation surface. It markets the product; it is not part of it, and " +
      "its claims are governed by the docs-sanity gate rather than by this profile.",
  },
  ],
    internal: [
  {
    id: "build-loop",
    reason: "Build/verify harness. Not a product surface.",
  },
  {
    id: "level-10",
    reason: "Audit harness. Not a product surface.",
  },
  {
    id: "live-evidence",
    reason: "Evidence artifacts written by verification lanes. Not a product surface.",
  },
  {
    id: "proof",
    reason: "Proof outputs. Not a product surface.",
  },
  {
    id: "sbom",
    reason: "Supply-chain artifacts. Not a product surface.",
  },
  {
    id: "tools:evidence-coverage",
    reason: "Generated evidence-coverage output. Plumbing behind a proof, not a surface.",
  },
  {
    id: "sync",
    reason:
      "Generated contract manifests external builders read — live-sync, the core " +
      "normalization stamp, and this profile's own rendering. Plumbing, not product.",
  },
  ],
    deferred: [
      "mcp-server",
      "ios:SignalGridOperator",
    ],
  },
];

/**
 * GAPS — work a `launch` entry needs that does NOT exist yet.
 *
 * Kept as data rather than prose so the proof can count them and no document can
 * quietly describe the launch set as complete. A launch profile whose gaps live
 * only in a paragraph is a launch profile that will be read as a readiness claim.
 */
export const GAPS = [
  {
    id: "device-management-health",
    surface: "connector-families",
    whatIsMissing:
      "A Microsoft Graph transport. The family's live default points at a generic bridge " +
      "URL, so today it cannot be part of the one read-only Entra/Intune connector. Until " +
      "it is, the launch connector set is graph alone.",
  },
  {
    id: "step-up-answerability",
    surface: "published-api-paths",
    whatIsMissing:
      "Limited GA ships in SHADOW mode: the gate returns step_up, and no launch route can " +
      "answer one. /v1/step-up/* exists and is deferred on purpose — enabling bounded " +
      "enforcement is a later phase of the owner's plan, not this one. Stated here so " +
      "\"returns step_up\" is never read as \"performs step-up\".",
  },
  {
    id: "runtime-launch-status",
    surface: "published-api-paths",
    whatIsMissing:
      "A runtime report of enforced-vs-observed-vs-simulated per signal kind. It would close " +
      "Blocker 10 more completely than a governance file can, and it is deliberately not " +
      "built here: it widens the API surface and adds diff to a pull request Blocker 1 says " +
      "is already too large to review.",
  },
  {
    id: "served-surface-exceeds-published",
    surface: "published-api-paths",
    whatIsMissing:
      "The server serves more than it publishes. Every contract path is mounted under /api, " +
      "and `/`, `/console` and `/metrics` are registered directly on the Express app outside " +
      "it — /metrics being open to anonymous callers unless METRICS_TOKEN is set. A Limited " +
      "GA build should register exactly the launch set and 404 the rest; today nothing " +
      "asserts that, so this profile governs the published contract and says so.",
  },
  {
    id: "runtime-profile-fence",
    surface: "published-api-paths",
    whatIsMissing:
      "A runtime fence that matches this file. `artifacts/api-server/src/lib/profile.ts` " +
      "ALREADY declares ProductProfile = review-demo | shared-device-gateway — the launch " +
      "profile has a runtime counterpart carrying the same product name. It currently " +
      "unmounts only the simulator router, the control-plane router and /v1/keys. Making it " +
      "serve exactly the launch set, with a test asserting 404 for everything deferred, is " +
      "the single highest-value follow-on from this file and is NOT done here: it is runtime " +
      "behaviour, and this commit deliberately changes none.",
  },
];

export const STATUSES = ["launch", "deferred", "demo_only", "internal"];
