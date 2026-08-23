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
// says which of the connector families, signal kinds, API paths and client
// surfaces are the PRODUCT, and which are proven work that is not shipping yet.
// (Deliberately no counts in this sentence — the first version said "17 client
// surfaces" and the real number was already 18; the live totals are derived by
// the gate and published by proof:launch-profile, never restated here.)
// Without that, every surface reads as equally load-bearing, and a reviewer
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
// WHY EVERY ITEM IS LISTED, including the deferred majority. A profile
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
// RATIFICATION: **v4 IS RATIFIED IN FULL** — docs/DECISION_RECORDS.md DR-005
// (August 20, 2026), in the owner's words: "v4 is no longer a proposal. Treat
// every current classification in scripts/launch-profile.mjs as ratified unless
// a future decision record explicitly changes it." A future DECISION RECORD is
// the only path that re-opens a status; changing one here without a record is
// scope drift, and the owner's companion constraint stands: "do not widen the
// product again now." (History: DR-004 first item-ratified six signal kinds;
// DR-005 superseded that carve-out by ratifying everything. The per-item
// ratification field still arrives with the launch-claims gate, which needs it
// to check public copy mechanically.)

/** Bumped whenever a status changes. Not a semver — a serial number, so a doc or a
 *  review can name the exact revision of the scope it was written against. */
export const LAUNCH_PROFILE_VERSION = 4;

// VERSION HISTORY, kept because a scope decision that changes silently is not a
// decision anyone can hold you to.
//
//   4  THE FREEZE EXTENSION (2026-08-16). The app-surfaces derivation read
//      artifacts/, tools/ and the two iOS project files — and nothing else. An
//      ENTIRE ANDROID PORT (native/android: Compose shell + :assist-core, unit-
//      tested without an emulator), a Tauri desktop port (native/desktop), the
//      cross-port wire-conformance fixture (native/shared) and the SmartDock
//      firmware core (firmware/dock: no_std Rust, CI-compiled for
//      thumbv7em-none-eabihf) all sat outside the bijection. The freeze's whole
//      argument is that a new surface cannot arrive unexamined; these four were
//      real, tracked, and unexamined, because the gate only looked where
//      surfaces had appeared before. The derivation now reads native/* (iOS
//      still at target granularity) and firmware/* too. Classifications in this
//      bump: three deferred (android, desktop, dock — real, proven in CI, not
//      Limited GA; nothing about the criterion's "one host app" moves), one
//      internal (the conformance fixture). No launch-set change. Ratification
//      landed 2026-08-20: DR-005 ratified v4 in full, these four included.
//   3  THE SOURCE-AGNOSTIC REDIRECT (owner-directed, 2026-08-11 — intake ledger
//      row 77). The criterion's "one read-only Entra/Intune connector" made
//      Microsoft a PREREQUISITE; the owner reframed it as the COMMERCIAL TARGET:
//      open-source MDM (Fleet; a Headwind-shaped Android lab fixture) is the
//      low-cost engineering lab that proves the same decision engine first, and
//      Microsoft Graph/Intune is the first supported enterprise production
//      connector — swapped in later without changing the engine. The mechanical
//      form of that claim is the DeviceManagementEvidence contract in
//      lib/integration-bridge and `proof:evidence-adapter`, which drives the
//      SAME device states through fleet/headwind/intune adapters and fails
//      unless the decisions are identical. No membership change in this bump:
//      the three launch families stand (graph stays launch AS the enterprise
//      target; its fixture mode needs no tenant), and the lab adapters live in
//      the bridge + lib/fleet-connector, which this profile's family surface
//      does not classify. The criterion string changed, so the serial moves.
//   2  `/v1/keys` moved launch → demo_only. Version 1 called it "API-key
//      authentication for the above", which was reasoned rather than read: the
//      route is a demo credential dispenser sitting ABOVE the auth guard, handing
//      the raw owner bearer for every seeded tenant to anonymous callers, and
//      `demoSurfacesEnabled()` had ALREADY been refusing to register it outside
//      review-demo. The runtime fence was right and the scope was wrong — found
//      by checking the launch set against the code instead of against intent.
//      The other seven launch paths were verified the same way and all sit below
//      the guard.
//   1  Initial profile.

export const PRODUCT_NAME = "SignalGrid Shared-Device Trust Gateway";
export const TARGET = "Limited GA, 2027-02-04";

/** The criterion every `launch` entry is tested against, quoted verbatim.
 *  Amended at v3 by the owner's source-agnostic redirect: the connector clause
 *  no longer names Microsoft as the prerequisite — it names the evidence-source
 *  ROLE, with the open-source lab proving the engine and Entra/Intune as the
 *  first enterprise production connector. */
export const CRITERION =
  "one tenant-aware product, one host app, one read-only device-management evidence " +
  "source (open-source lab first — Fleet; Microsoft Entra/Intune as the first enterprise " +
  "production connector), one operator console, one design partner, one paid deployment";

/** Shared reason for every `deferred` item, written once rather than restated a
 *  hundred-plus times. Deferred means: it exists, it is gated, it is proven, its proof runs in
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
      "The one read-only Entra/Intune connector — since v3, the first ENTERPRISE " +
      "production connector rather than the prerequisite: the open-source lab (Fleet, via " +
      "the DeviceManagementEvidence contract) proves the same engine without a Microsoft " +
      "tenant, and proof:evidence-adapter pins that the swap changes nothing but " +
      "provenance. Still the only family in the repository whose live transport actually " +
      "addresses graph.microsoft.com — a fact worth stating plainly, because several " +
      "families NAMED for Microsoft do not.",
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
      "OpenAPI contract gate holding it. RUNTIME FENCE, recorded here because it was stated nowhere: the entire `/cp/v1/*` block below is registered ONLY under the `review-demo` profile (`demoSurfacesEnabled()` in routes/index.ts) and 404s under `shared-device-gateway`. It is classified `deferred` rather than `demo_only` on purpose — `demo_only` here means SHIPS NEVER (the /v1/keys credential dispenser), whereas the control plane is a real product surface whose launch is deferred and whose unauthenticated fixture form is a demo IMPLEMENTATION, not a demo PURPOSE. Collapsing the two would cost the distinction that makes demo_only useful.",
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
  {
    id: "/v1/audit",
    reason:
      "The per-tenant audit chain a reviewer reads. Honestly: this route serves the core's " +
      "in-process digest chain, which does not survive a restart; the DURABLE hash-chain " +
      "ledger (@workspace/audit, Postgres-backed) has no route yet. Two chains, one launch " +
      "surface — docs/BACKUP_AND_RESTORE.md names both. Calling this one 'durable' was a " +
      "false claim and is the kind this file exists to prevent.",
  },
  { id: "/v1/metrics", reason: "Operability. A service nobody can watch cannot be run." },
  {
    id: "/v1/connectors",
    reason:
      "Read-only connector inventory: the setup/health screen (launch wireframe 2) renders " +
      "the MODE the gate actually resolved — 'bring your tenant' is not concrete without it.",
  },
  {
    id: "/v1/connectors/{id}/sync-runs",
    reason: "Read-only sync history: last sync, records processed, signals normalized.",
  },
  {
    id: "/v1/policies",
    reason:
      "Read-only policy inventory: the 'what decided this' page (launch wireframe 5). An " +
      "operator who cannot read the active policy cannot trust the verdicts it mints.",
  },
  {
    id: "/v1/policies/{id}/versions",
    reason:
      "Read-only versioned rule sets with content digests — the versioned half of every " +
      "decision's provenance (decisions carry policyVersionId).",
  },
  {
    id: "/v1/policies/{id}/tests",
    reason:
      "Runs the pinned policy tests against a version and reports pass/fail — evidence the " +
      "active rule set still behaves, on demand, read-only.",
  },
  {
    id: "/v1/connectors/{id}/sync",
    reason:
      "Trigger a FIXTURE sync (the core refuses non-fixture connectors by construction) — " +
      "how the setup screen demonstrates the pipeline without a tenant. No write to any " +
      "source system exists on this route.",
  },
  ],
    demo_only: [
      {
        id: "/v1/keys",
        reason:
          "NOT an authentication mechanism — a demo CREDENTIAL DISPENSER. It sits ABOVE the " +
          "auth guard in routes/v1.ts and publishes DEMO_KEYS, the raw owner bearer for every " +
          "seeded tenant, to anonymous callers. `demoSurfacesEnabled()` already refuses to " +
          "register it outside review-demo, so the runtime fence had this right while this " +
          "profile said it ships. Corrected in version 2.",
      },
    ],
    internal: [],
    deferred: [
      "/v1/decisions/reconcile",
      "/v1/decisions/{id}/simulate",
      "/v1/policies/{id}/versions/{versionId}/activate",
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
      "/cp/v1/self-audit",
      "/cp/v1/reliability",
      "/cp/v1/iac",
      "/v1/sessions/start",
      "/v1/sessions/{id}",
      "/v1/sessions/{id}/refresh",
      "/v1/sessions/{id}/end",
    ],
  },
  {
    key: "app-surfaces",
    derivedFrom:
      "every git-TRACKED directory under artifacts/, tools/, native/ and firmware/ (gitignored "+
      "build output such as artifacts/level-10 and artifacts/proof is not a surface, and reading "+
      "the filesystem instead made this gate answer differently on a machine that had run the "+
      "harness; native/ios is read at finer grain instead of as a directory), plus "+
      "every `type: application` target in BOTH " +
      "native/ios/project.yml and native/ios/SignalGridMobile/project.yml, prefixed `ios:` " +
      "(test targets and the SignalGridMobileCore framework are excluded — neither is a " +
      "surface anyone meets)",
    launch: [
  {
    id: "api-server",
    reason: "The product: one tenant-aware decision service. The whole of \"one product\".",
  },
  {
    id: "signalgrid-app",
    reason:
      "The one operator console, bound to the served /v1 surface: decisions list, decision " +
      "detail (reason codes, matched rules, digest-verified evidence, per-signal freshness), " +
      "the tamper-evident audit ledger, and an assurance label on every verdict. Ratified by " +
      "the 2026-08-10 product-design review (PRODUCT_COMPLETION_PLAN §10/§11): the console " +
      "must read the same API a customer would, not an in-browser copy of the core.",
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
    id: "signalgrid-review",
    reason:
      "The review deck: runs the decision core IN THE BROWSER (zero network) so a reviewer " +
      "can inspect every mechanism offline. Invaluable as a demo and review artifact — but a " +
      "console that does not exercise the served API cannot be THE console, so the launch " +
      "console role moved to signalgrid-app when it bound to /v1.",
  },
  {
    id: "signalgrid-desktop",
    reason: "A second client surface (fixture-fed). Blocker 8 names exactly this; the console is the one.",
  },
  {
    id: "signalgrid-mobile-pwa",
    reason: "A third client surface (fixture-fed). Same reason.",
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
    id: "api-collection",
    reason:
      "The committed Bruno workspace: .bru request files plus the intentionally-public " +
      "fixture tokens, so anyone can drive the API without credential handling. Developer " +
      "tooling for the API, not a product surface — guarded against route drift by " +
      "check-api-collection.mjs.",
  },
  {
    id: "build-loop",
    reason: "Build/verify harness. Not a product surface.",
  },
  {
    id: "live-evidence",
    reason: "Evidence artifacts written by verification lanes. Not a product surface.",
  },
  {
    id: "live-captures",
    reason:
      "Captures minted by the live-vendor proof lanes (proof:live-headwind writes " +
      "headwind.json from a real Headwind CE server) and read back by " +
      "proof:evidence-adapter's parity section — synthetic lab values only, no tenant " +
      "and no real device. Verification plumbing, sibling to live-evidence. Not a product surface.",
  },
  {
    id: "lane-messages",
    reason:
      "The cloud↔Mac message channel: committed JSON carrying what one lane needs the " +
      "other to know, plus the acknowledgements that prove it was read. Lane " +
      "coordination plumbing, not a product surface — no tenant, no worker and no " +
      "customer ever sees it. Its sibling `sim-requests` carries work; this carries " +
      "knowledge.",
  },
  {
    id: "lab-collections",
    reason:
      "Standalone Bruno collections for the external lab services " +
      "run-live-lanes.sh starts (Fleet, Traccar, Keycloak, Wazuh) — read-only " +
      "evidence requests against third-party surfaces, outside the api " +
      "collection because Bruno cannot run nested collections. Verification " +
      "tooling; no tenant, worker or customer ever sees it.",
  },
  {
    id: "agent-heartbeats",
    reason:
      "Firing evidence for the always-on agent routines declared in " +
      "docs/agent/scheduled-routines.json: one {firedAt, result} JSON per lane, written " +
      "on every fire so 'ran and did nothing' differs from 'never ran'. Agent-ops " +
      "plumbing gated by scripts/check-scheduled-routines.mjs — no tenant, no worker " +
      "and no customer ever sees it.",
  },
  {
    id: "sim-requests",
    reason:
      "The cloud→Mac half of the simulation request loop: committed JSON asking the " +
      "owner's machine to run named, allowlisted verification operations. Lane " +
      "coordination plumbing, not a product surface — no tenant, no worker and no " +
      "customer ever sees it. Its sibling `sim-results` carries the answers back.",
  },
  {
    id: "sim-results",
    reason:
      "The Mac→cloud half: what actually executed, on which machine, at which commit. " +
      "Verification evidence like `live-evidence` above, and equally not product.",
  },
  {
    id: "sbom",
    reason: "Supply-chain artifacts. Not a product surface.",
  },
  {
    id: "outreach-log",
    reason:
      "The audit trail of the guardrailed outreach lane: one JSON per send day, " +
      "dispositions only, reply content never committed " +
      "(docs/outreach/OPERATING_RULES.md). Company go-to-market plumbing — no " +
      "tenant, no worker and no customer-of-the-product ever sees it.",
  },
  {
    id: "scanner-comparison",
    reason:
      "Backlog row 37's evidence: dated records of one vulnerability scanner run " +
      "beside another over the same input, tool and database versions preserved, " +
      "disagreement recorded as data. Release-engineering evidence like `sbom` " +
      "above — no tenant, no worker and no customer ever sees it.",
  },
  {
    id: "native:shared",
    reason:
      "One JSON file: the assist-wire conformance fixture every native port (iOS, Android, " +
      "desktop) must parse identically, so the ports cannot drift apart on the wire. A " +
      "contract fixture between surfaces, not a surface — no person opens it.",
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
      // The v4 additions. Each is real and proven where it can be (Android core
      // unit-tested without an emulator; dock firmware CI-compiled for its real
      // Cortex-M target) — and none survives the criterion's "ONE host app",
      // which is ios:EnterpriseShell. The dock firmware additionally claims
      // nothing about hardware: no real dock has run it (docs/SIGNALGRID_SMARTDOCK.md).
      "native:android",
      "native:desktop",
      "firmware:dock",
    ],
  },
];

/**
 * GAPS — work a `launch` entry needs that does NOT exist yet.
 *
 * Kept as data rather than prose so the proof can count them and no document can
 * quietly describe the launch set as complete. A launch profile whose gaps live
 * only in a paragraph is a launch profile that will be read as a readiness claim.
 *
 * WHY EACH GAP NOW CARRIES `closedWhen`, and it is the correction this list needed.
 *
 * A declared gap is a claim about the code, and until now nothing checked it. The
 * gate verified that a gap named a real surface; the proof verified that its prose
 * was long enough and that one gap's text still contained the words "Graph
 * transport". Both are checks on the description, not on the world — the same
 * "compares a thing to itself" defect this repo keeps finding, wearing a governance
 * hat.
 *
 * It had already gone wrong. TWO of the five gaps below had been closed in code —
 * the runtime allowlist fence and the served-vs-published surface, both with tests
 * asserting a 404 for every deferred path — and this list still declared them
 * missing, as did LAUNCH_PROFILE.md. A third had drifted: the Graph transport it
 * said "has not been written" exists and is selectable.
 *
 * A stale gap understates readiness rather than overstating it, which is the safer
 * direction and is exactly why it can rot for so long unnoticed. It is still a
 * false statement about the repository, and worse, it makes the honest gaps cheaper
 * to ignore: a reader who finds two of five wrong stops trusting the other three.
 *
 * So each gap now states, mechanically, what would make it CLOSED, and
 * `check-launch-profile.mjs` evaluates that against source. Every condition met →
 * the build fails until the gap is removed or reworded. `closedWhen` is required;
 * a gap with no closure condition is one nobody can ever be told to delete.
 *
 * Conditions are evaluated against comment-stripped source on purpose: a gap must
 * not be closable by a sentence describing the work.
 */
export const GAPS = [
  {
    id: "device-management-health",
    surface: "connector-families",
    whatIsMissing:
      "A Microsoft Graph transport shipped as the DEFAULT. The transport itself now exists " +
      "(`graph-transport.ts`, mapping Graph's managedDevice onto the connector's raw report) " +
      "and is selectable with DEVICE_MANAGEMENT_HEALTH_TRANSPORT=graph — but the live default " +
      "is still the generic bridge URL, so an operator who sets nothing gets the bespoke " +
      "endpoint rather than Graph. Until the default flips, this family is not part of the " +
      "one read-only Entra/Intune connector without explicit configuration, and the launch " +
      "connector set is graph alone.",
    // Closed when the resolver stops defaulting the transport kind to "bridge".
    closedWhen: [
      {
        file: "lib/integrations/src/integrations/device-management-health/index.ts",
        absent: 'toLowerCase() || "bridge"',
      },
    ],
  },
  {
    id: "step-up-answerability",
    surface: "published-api-paths",
    whatIsMissing:
      "Limited GA ships in SHADOW mode: the gate returns step_up, and no launch route can " +
      "answer one. /v1/step-up/* exists and is deferred on purpose — enabling bounded " +
      "enforcement is a later phase of the owner's plan, not this one. Stated here so " +
      "\"returns step_up\" is never read as \"performs step-up\".",
    // Closed when the GA allowlist admits a step-up path — i.e. a served route can
    // answer the verdict the gate returns. Deliberate today, so this is the one gap
    // expected to stay open longest; it still gets a condition, because "deliberate"
    // and "permanent" are different and only the second needs no check.
    closedWhen: [
      { file: "artifacts/api-server/src/lib/profile.ts", contains: "/v1/step-up" },
    ],
  },
  {
    id: "runtime-launch-status",
    surface: "published-api-paths",
    whatIsMissing:
      "A runtime report of enforced-vs-observed-vs-simulated per signal kind. The labels " +
      "exist here, in a governance file; nothing serves them, so an operator cannot ask the " +
      "running server what it is actually enforcing. It would close Blocker 10 more " +
      "completely than a governance file can, and it is deliberately not built here: it " +
      "widens the API surface and adds diff to a pull request Blocker 1 says is already too " +
      "large to review.",
    // Closed when some route file carries all three labels — the shape a served
    // report must have. Verified against today's tree: no routes file has all three.
    closedWhen: [
      { dir: "artifacts/api-server/src/routes", anyFileContainsAll: ['"enforced"', '"observed"', '"simulated"'] },
    ],
  },
  {
    id: "non-demo-core-constructor",
    surface: "app-surfaces",
    whatIsMissing:
      "A decision core a CUSTOMER deployment can boot. SignalGridCore has one public " +
      "factory — demo(), a seeded core on a fixed clock — and the served API constructs " +
      "exactly that (artifacts/api-server/src/lib/core.ts). The shared-device-gateway " +
      "profile fences the demo SURFACES, and the database posture is real, but the " +
      "evaluated tenants/identities/devices are still the demo seed: this deployment " +
      "demonstrates in a customer environment and does not yet decide about the " +
      "customer's own estate.",
    // Closed when the served core stops being the demo factory — the only
    // mechanical fact that matters, checked where the server constructs it.
    closedWhen: [
      { file: "artifacts/api-server/src/lib/core.ts", absent: "SignalGridCore.demo()" },
    ],
  },
  {
    id: "assist-wire-unserved",
    surface: "published-api-paths",
    whatIsMissing:
      "The Assist wire the Kotlin and Rust SDKs bind — POST /v1/authorize returning " +
      "{assist, reasons, decisionId} — is not served: no route implements it and the " +
      "OpenAPI spec registers no such path. The 42 shared conformance vectors and both " +
      "SDK suites test a PLANNED wire (DR-007); the envelope a host app integrates " +
      "today is EvaluateResult from POST /v1/decisions/evaluate. Building /v1/authorize " +
      "now would widen the frozen launch surface, so the wire stays declared-ahead " +
      "rather than quietly implied as served. scripts/check-assist-wire-served.mjs " +
      "fails if the vectors bind an unserved route while this entry is missing.",
    // Closed mechanically the moment the spec registers the path — the same
    // change that would make the SDK binding true. The FILE form, deliberately:
    // the dir evaluator reads only .ts files, so a dir condition on lib/api-spec
    // could never see the YAML and the gap would have reported "open" forever —
    // the assurance review proved it by inserting the path and watching the
    // predicate stay false (the stale-gap defect this register exists to
    // prevent, reintroduced by the entry citing it).
    closedWhen: [
      { file: "lib/api-spec/v1-openapi.yaml", contains: "/v1/authorize:" },
    ],
  },
];

export const STATUSES = ["launch", "deferred", "demo_only", "internal"];
