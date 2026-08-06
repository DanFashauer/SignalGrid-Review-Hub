// The publication boundary, as data.
//
// `NOTICE` and `docs/REPO_LINEAGE.md` already state the split: this repository is
// the PUBLIC review surface; the proprietary core, credentials, customer data,
// tenant configuration, production logs and unreleased policy logic live in the
// private repository and must never appear here. That policy has been correct and
// written down since the IP-hygiene pass — and until now nothing checked it. It was
// remembered, not gated, which for a boundary is the same as absent: the failure
// mode is a single commit, and the cost of noticing it late is that the content is
// already public and already mirrored.
//
// WHAT A BOUNDARY GATE CAN AND CANNOT DO, stated first because the temptation is to
// overclaim and then trust the green.
//
//   It CANNOT decide whether a given file is "core implementation detail". That is a
//   judgment, and any scanner claiming to make it would be theatre.
//
//   It CAN guarantee that nothing reaches this repository WITHOUT A HUMAN HAVING
//   CLASSIFIED IT. That is the whole mechanism: every tracked path must fall under a
//   declared area with a stated reason, and an unclassified path is a build failure.
//   New surface cannot arrive quietly — which is the only property that actually
//   distinguishes "gated" from "remembered".
//
// This is deliberately the same shape as `scripts/launch-profile.mjs`: declare the
// edge as data, then enforce a bijection in BOTH directions. There, the reverse
// direction IS the breadth freeze. Here, the reverse direction is the boundary.
//
// A denylist of bad strings is NOT the mechanism here, and that is a considered
// choice: `scripts/docs-sanity.mjs` spent two rounds learning that a denylist denies
// phrasings rather than claims, and each round found live instances the previous one
// had not covered. The content rules below are a narrow, self-controlled supplement
// to the classification bijection, not a substitute for it.

export const BOUNDARY_VERSION = 1;

/** What a classification MEANS. Each is a promise about the whole class. */
export const CLASSES = {
  public_review:
    "Public positioning, review and validation material. The reason this repository exists; publishing it is the point.",
  public_safe_code:
    "Buildable public-safe reference implementation: fixture-backed, deterministic, no live tenant and no customer data.",
  illustrative_data:
    "Fixture and example data. Must be invented. A real value here is a boundary breach even if it looks harmless.",
  tooling:
    "Build, CI, gate and container machinery. Publishable because it operates on public-safe content and carries no product secret.",
  third_party_intake:
    "Material the owner supplied that ORIGINATES ELSEWHERE. The risk here is not leaking outward — it is REPUBLISHING someone else's licensed work from a public repository. Every binary/document asset in this class needs a stated licence basis.",
};

/**
 * Every tracked path must fall under exactly one area. Order matters only for
 * readability; the gate requires the match to be unambiguous.
 *
 * `path` is a repo-relative prefix (a directory, or an exact root file).
 */
export const AREAS = [
  // ── the public review surface ─────────────────────────────────────────────
  { path: "docs", class: "public_review", reason: "The product/positioning documentation set — the de-facto PRD and the review surface itself." },
  { path: "README.md", class: "public_review", reason: "Repository entry point." },
  { path: "SECURITY.md", class: "public_review", reason: "Coordinated-disclosure policy; publishing it is its function." },
  { path: "NOTICE", class: "public_review", reason: "The IP notice this boundary enforces." },
  { path: "LICENSE", class: "public_review", reason: "The MIT grant over the code in this repository." },
  { path: "threat_model.md", class: "public_review", reason: "Published threat model; a reviewer needs it to assess the claims." },
  { path: "site", class: "public_review", reason: "GitHub Pages shell for the published console." },
  { path: "fleet", class: "public_review", reason: "Fleet MDM profile/team declarations — configuration intent, not a tenant's actual enrollment." },

  // ── the public-safe reference implementation ──────────────────────────────
  { path: "lib", class: "public_safe_code", reason: "Decision core, connectors and flow layer. Deterministic and fixture-backed by construction." },
  { path: "artifacts", class: "public_safe_code", reason: "API server, web surfaces and MCP server built from lib/." },
  { path: "native", class: "public_safe_code", reason: "iOS apps. Byte-faithful ports of the TS simulator; parity is the published claim." },
  { path: "tools", class: "public_safe_code", reason: "The room-console page — a user-facing surface that bundles the decision core." },

  // ── invented data ─────────────────────────────────────────────────────────
  { path: "fixtures", class: "illustrative_data", reason: "Scenario fixtures driving the proofs." },
  { path: "config", class: "illustrative_data", reason: "Example grid config and per-tier .env EXAMPLES — templates, never filled-in values." },

  // ── machinery ─────────────────────────────────────────────────────────────
  { path: "scripts", class: "tooling", reason: "Proof harnesses, gates and preflight — including this boundary gate." },
  { path: "tests", class: "tooling", reason: "Load and integration harnesses." },
  { path: ".github", class: "tooling", reason: "CI workflows and repository automation." },
  { path: ".githooks", class: "tooling", reason: "The pre-push lockfile hook." },
  { path: ".agents", class: "tooling", reason: "Agent-lane coordination material." },
  { path: "docker", class: "tooling", reason: "Container assets." },
  { path: "Dockerfile.api", class: "tooling", reason: "API image build." },
  { path: "Dockerfile.web", class: "tooling", reason: "Web image build." },
  { path: "docker-compose.yml", class: "tooling", reason: "Local stack." },
  { path: "docker-compose.prod.yml", class: "tooling", reason: "Production-shaped stack used by the CI smoke job." },
  { path: "docker-compose.sim.yml", class: "tooling", reason: "Simulator stack." },
  { path: "nginx.conf", class: "tooling", reason: "Static web serving config." },
  { path: "package.json", class: "tooling", reason: "Workspace root manifest." },
  { path: "pnpm-lock.yaml", class: "tooling", reason: "Lockfile; CI installs frozen against it." },
  { path: "pnpm-workspace.yaml", class: "tooling", reason: "Workspace + platform-binary overrides." },
  { path: "tsconfig.json", class: "tooling", reason: "TypeScript project root." },
  { path: "tsconfig.base.json", class: "tooling", reason: "Shared compiler options." },
  { path: ".gitignore", class: "tooling", reason: "Ignore rules." },
  { path: ".npmrc", class: "tooling", reason: "Package manager settings." },
  { path: ".gitleaks.toml", class: "tooling", reason: "Secret-scanner configuration." },
  { path: "validate-sim-macos.sh", class: "tooling", reason: "The full local harness." },
  { path: "CLAUDE.md", class: "tooling", reason: "Working rules for this repository." },
  { path: "AGENTS.md", class: "tooling", reason: "Agent-lane rules." },

  // ── other people's work ───────────────────────────────────────────────────
  {
    path: "attached_assets",
    class: "third_party_intake",
    reason:
      "Owner-supplied intake material. Classified separately BECAUSE the risk runs the other way: these did not originate here, and republishing them from a public repository is a licensing question, not a leak question.",
  },
];

/**
 * Formats that are REPUBLICATION when committed to a public repository: a document
 * or binary reproduced whole, rather than text written here. Each such file must be
 * listed in `THIRD_PARTY_DISPOSITIONS` with a licence basis, or the gate fails.
 *
 * This does not decide the licensing question — it refuses to let it go unasked.
 */
export const REPUBLICATION_FORMATS = [".pdf", ".docx", ".pptx", ".xlsx", ".epub"];

/**
 * The licence basis for each third-party asset, keyed by repo-relative path.
 *
 * `basis` is one of:
 *   · a string        — resolved: the stated right under which this is published.
 *   · "OWNER_PENDING" — a real, named, unresolved exposure. Reported IN FULL on
 *                       every run and counted, but does not fail the build.
 *   · absent entirely — the file is not here at all → the gate FAILS.
 *
 * WHY "OWNER_PENDING" IS NOT A SNOOZE, because that is the obvious objection and it
 * deserves an answer rather than a hope. A snooze is a switch that makes a finding
 * QUIET. This makes it LOUDER: the full note prints on every single run, the count
 * appears in the summary line, and an entry with no `ownerDecision` text fails. What
 * it does not do is redden CI on every unrelated branch over a question that is not
 * an engineer's to answer — a legal call about the owner's own material. A gate that
 * blocks all work until someone else decides gets deleted, and then the finding is
 * gone too. The forward-looking half stays strict: a NEW republished document with
 * no entry here is a hard failure, which is the property that matters for a boundary.
 *
 * This mirrors the QUEUED convention in `scripts/check-guard-registries.mjs`, which
 * prints its partial coverage every run "so partial coverage is never mistaken for
 * full coverage."
 */
export const THIRD_PARTY_DISPOSITIONS = [
  {
    path: "attached_assets/Best_Endpoint_Management_Tools_Reviews_2026_Gartner_Peer_Insig_1779426199751.pdf",
    basis: "OWNER_PENDING",
    note:
      "Gartner Peer Insights report, reproduced whole in a PUBLIC repository. Gartner content is licensed and its redistribution is restricted; nothing in this repository establishes a right to republish it. Intake ledger row 62 already recorded a related source marked 'unauthorized reproduction prohibited'. Nothing in the repo references this file and it is not copied to GitHub Pages.",
    ownerDecision:
      "Remove from the public tree (reversible; the assessment it fed is already recorded in the intake ledger), or record the licence that permits publication. Removal from HEAD does NOT remove it from git history — purging that needs a rewrite, which NOTICE says the provenance record should not undergo.",
  },
  {
    path: "attached_assets/Best_Identity_Governance_and_Administration_Reviews_2026_Gartn_1779499491759.pdf",
    basis: "OWNER_PENDING",
    note: "Same as above — Gartner Peer Insights, reproduced whole, no established right to republish, unreferenced, not on Pages.",
    ownerDecision: "As above: remove from the public tree, or record the licence that permits publication.",
  },
];

/**
 * Narrow content rules. Each carries its OWN controls, asserted on every run, so a
 * pattern that has quietly stopped matching anything cannot keep reporting clean —
 * the defect `scripts/check-guard-registries.mjs` exists to prevent, applied to a
 * scanner instead of a registry.
 *
 * Kept SHORT on purpose. A boundary gate that cries wolf gets switched off, and a
 * switched-off gate is worse than none because the policy still reads as enforced.
 */
export const CONTENT_RULES = [
  {
    id: "credential_in_url",
    why: "A username:password embedded in a URL to a real host is a live credential published in git history, where deleting the file does not remove it.",
    // THE HOST MUST BE A DOTTED FQDN. The first draft matched any host and produced
    // three findings, all false: `postgres://sg:sg@db:5432` (a compose SERVICE
    // ALIAS), and two occurrences of `https://user:pass@host/` inside the repo's own
    // work-context guard — which already refuses this exact shape and proves it.
    // A single-label host is an infrastructure alias, not a place a credential
    // leaks to. Loopback and the reserved-for-documentation TLDs stay excluded on
    // top of that. Every one of those three is now a control below, so this
    // narrowing cannot be silently widened back.
    pattern:
      /(?<![A-Za-z0-9])[a-z][a-z0-9+.-]*:\/\/[^\/\s:@]+:[^\/\s:@]+@(?!localhost|127\.0\.0\.1|\[::1\])(?![^\/\s]*\.(?:example|test|invalid|localhost)\b)[a-z0-9-]+(?:\.[a-z0-9-]+)+/i,
    controls: {
      // MUST fire: real dotted hosts.
      mustMatch: [
        "https://svc:hunter2@prod.contoso.com/api",
        "postgres://admin:pw@db.internal.corp:5432/prod",
      ],
      // MUST NOT fire. Each of these is real text in this repository today; without
      // these controls the rule would have to be deleted the first time it reddened
      // a green tree, which is how a gate dies.
      mustNotMatch: [
        "DATABASE_URL: postgres://sg:sg@localhost:5432/signalgrid",
        "DATABASE_URL: postgres://sg:sg@db:5432/signalgrid",
        "// Credentials smuggled inside a URL (`https://user:pass@host/`).",
        "postgres://user:pass@db.example.com/x",
        "see https://github.com/DanFashauer/SignalGrid for the private core",
      ],
    },
  },
  {
    id: "authenticated_git_remote",
    why: "A token-bearing git remote for the PRIVATE repository would publish both a credential and a write path into the protected core. Plain unauthenticated references to that repository are ordinary prose and must stay legal — docs/PHASE6_CUTOVER_RUNBOOK.md and docs/RUN_ON_MAC.md both contain them today.",
    pattern: /(?:x-access-token|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})[^\s]*@?|:[^\/\s:@]+@github\.com/,
    controls: {
      mustMatch: [
        "git remote add home https://x-access-token:REDACTED@github.com/DanFashauer/SignalGrid",
        "url = https://user:s3cr3t@github.com/DanFashauer/SignalGrid.git",
      ],
      mustNotMatch: [
        "git clone https://github.com/DanFashauer/SignalGrid.git   # or your fork/branch",
        "git ls-remote https://github.com/DanFashauer/SignalGrid",
      ],
    },
  },
];

/** Paths exempt from CONTENT_RULES, each with a reason a reader can check. */
export const CONTENT_EXEMPT = [
  {
    path: "scripts/publication-boundary.mjs",
    reason: "This file states the forbidden shapes as controls. It must contain them to be testable.",
  },
  {
    path: "scripts/check-publication-boundary.mjs",
    reason: "The gate that runs those controls.",
  },
  {
    path: "docs/PUBLICATION_BOUNDARY.md",
    reason: "Documents the rules, so it quotes them.",
  },
  {
    path: "scripts/src/work-context-proof.ts",
    reason:
      "Its `urlCred` case is a NEGATIVE CONTROL: it feeds `https://svc:hunter2@wms.internal/zone/3` to the work-context guard and asserts the guard REFUSES it. Flagging a proof for containing the shape it proves is rejected would be the gate punishing the very coverage it wants — the same file-level exemption `docs-sanity` gives PUBLIC_MESSAGING_GUARDRAILS.md, for the same reason.",
  },
];
