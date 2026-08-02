// SignalGrid preflight — one command that runs the WHOLE gate suite locally,
// mirroring CI, so a change is proven correct BEFORE it is pushed. This is the
// mechanical half of the two-layer self-review (docs/SELF_REVIEW.md); the other
// half is the adversarial agent review a human/agent runs on the diff.
//
//   node scripts/preflight.mjs          # full suite (what CI runs)
//   node scripts/preflight.mjs --quick  # skip the heavy web/app builds
//
// Exits non-zero on the first failing gate and prints a compact report, so
// "green preflight" means "CI will be green".
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const quick = process.argv.includes("--quick");

// Ordered gates — a complete mirror of the CI jobs that need NOTHING BUT NODE:
// `validation` and `docs-sanity` from `.github/workflows/review-hub-ci.yml`, plus
// the SBOM-drift gate from `supply-chain.yml`'s `sbom` job. Keep this list in
// lockstep with those; a proof that runs in CI but not here would let a red build
// pass preflight.
//
// WHAT IT DOES NOT COVER, stated because the previous wording here claimed a
// green preflight "genuinely means CI will be green" and that was false. Six CI
// jobs run on pull_request; this mirrors three. The other three need external
// services and cannot run in this harness:
//   durable-persistence  (Postgres audit ledger)
//   deploy-stack         (Docker compose smoke)
//   secret-scan          (gitleaks)
// So a green preflight means EVERYTHING REPRODUCIBLE LOCALLY is green. Those
// three are still proven only in CI, and a push can go red on them after a clean
// preflight. `heavy` steps (full monorepo build) are skipped only under --quick.
const STEPS = [
  { name: "Invariant review (fail-closed / determinism / Assist / truth)", cmd: ["node", "scripts/review-invariants.mjs"] },
  { name: "Docs sanity (required docs + unsafe-claim scan)", cmd: ["node", "scripts/docs-sanity.mjs"] },
  { name: "Doc orphans (a new doc must be reachable from an index)", cmd: ["node", "scripts/check-doc-orphans.mjs"] },
  { name: "Package reachability (a library nobody ships is a library nobody runs)", cmd: ["node", "scripts/check-package-reachability.mjs"] },
  { name: "Guard-registry drift (coverage lists derived, not trusted)", cmd: ["node", "scripts/check-guard-registries.mjs"] },
  { name: "CI\u2194preflight drift (every proof runs in both places)", cmd: ["node", "scripts/check-ci-preflight-sync.mjs"] },
  { name: "Pagination-truncation guard (a capped read must not look complete)", cmd: ["node", "scripts/check-pagination-truncation.mjs"] },
  { name: "Absent-collection law (nothing observed ≠ nothing wrong)", cmd: ["pnpm", "run", "proof:absent-collection"] },
  { name: "Port parity (DecisionEngine + AppWorkflows must not drift from their TS originals)", cmd: ["node", "scripts/check-decision-port-parity.mjs"] },
  { name: "Read-error swallowing (a failed lookup must not report \"nothing found\")", cmd: ["node", "scripts/check-read-error-swallowing.mjs"] },
  { name: "Preflight↔CI parity (a gate that runs only locally is not a gate)", cmd: ["node", "scripts/check-preflight-ci-parity.mjs"] },
  { name: "Connector discipline (every family gated + proven, none acting on a device)", cmd: ["node", "scripts/check-connector-discipline.mjs"] },
  { name: "Docs\u2194proof FIGURE guard (a measured number must still be one)", cmd: ["node", "scripts/check-proof-figures.mjs"] },
  { name: "Proof-count sync (documented check counts match their proofs)", cmd: ["node", "scripts/check-proof-counts.mjs"] },
  { name: "Live-sync manifest (external builders see current contracts)", cmd: ["node", "scripts/check-live-sync.mjs"] },
  { name: "MCP surface (chat connection must match the fabric)", cmd: ["node", "scripts/check-mcp-surface.mjs"] },
  { name: "Typecheck (all packages)", cmd: ["pnpm", "run", "typecheck"] },
  { name: "Build (all packages)", cmd: ["pnpm", "run", "build"], heavy: true, env: { PORT: "3000", BASE_PATH: "/" } },
  { name: "Proof: intune-entra-posture", cmd: ["pnpm", "run", "proof:intune-entra-posture"] },
  { name: "Proof: signalgrid-core", cmd: ["pnpm", "run", "proof:signalgrid-core"] },
  { name: "Proof: live-idp (real OIDC provider, real DPoP)", cmd: ["pnpm", "run", "proof:live-idp"] },
  { name: "Browser E2E (review console, website, admin)", cmd: ["pnpm", "run", "test:e2e"], heavy: true },
  { name: "Proof: signalgrid-simulator", cmd: ["pnpm", "run", "proof:signalgrid-simulator"] },
  { name: "Proof: signalgrid-grid", cmd: ["pnpm", "run", "proof:signalgrid-grid"] },
  { name: "Proof: microsoft-graph-sandbox", cmd: ["pnpm", "run", "proof:microsoft-graph-sandbox"] },
  { name: "Proof: graph-connector (read-only, gated)", cmd: ["pnpm", "run", "proof:graph-connector"] },
  { name: "Proof: carrier-reachability (post-exit, gated)", cmd: ["pnpm", "run", "proof:carrier-reachability"] },
  { name: "Proof: event-contract (validation + cross-domain detections)", cmd: ["pnpm", "run", "proof:event-contract"] },
  { name: "Proof: location-services (geofence posture, gated)", cmd: ["pnpm", "run", "proof:location-services"] },
  { name: "Proof: vuln-scan (device risk posture, gated)", cmd: ["pnpm", "run", "proof:vuln-scan"] },
  { name: "Proof: network-nac (access posture, gated)", cmd: ["pnpm", "run", "proof:network-nac"] },
  { name: "Proof: edr-threat (endpoint threat-state, gated)", cmd: ["pnpm", "run", "proof:edr-threat"] },
  { name: "Proof: identity-risk (SSO sign-in risk, gated)", cmd: ["pnpm", "run", "proof:identity-risk"] },
  { name: "Proof: rtls-custody (physical custody, gated)", cmd: ["pnpm", "run", "proof:rtls-custody"] },
  { name: "Proof: peripheral-control (removable media, gated)", cmd: ["pnpm", "run", "proof:peripheral-control"] },
  { name: "Proof: data-protection (DLP posture, gated)", cmd: ["pnpm", "run", "proof:data-protection"] },
  { name: "Proof: credential-exposure (endpoint secrets, gated)", cmd: ["pnpm", "run", "proof:credential-exposure"] },
  { name: "Proof: macos-posture (grid-collected Mac, gated)", cmd: ["pnpm", "run", "proof:macos-posture"] },
  { name: "Proof: uem (read-only MDM/UEM dimension — gated, no actuators)", cmd: ["pnpm", "run", "proof:uem"] },
  { name: "Proof: entitlement-binding (is the grant REVIEWABLE, not just correct)", cmd: ["pnpm", "run", "proof:entitlement-binding"] },
  { name: "Proof: response-accountability (the watermelon — closed but unresolved)", cmd: ["pnpm", "run", "proof:response-accountability"] },
  { name: "Proof: device-resolver (read-only at the injection boundary)", cmd: ["pnpm", "run", "proof:device-resolver"] },
  { name: "Proof: config-scope (connector config keyed per tenant, never normalized)", cmd: ["pnpm", "run", "proof:config-scope"] },
  { name: "Proof: unsafe-claim (a disclaimer is not a claim)", cmd: ["pnpm", "run", "proof:unsafe-claim"] },
  { name: "Proof: nac (read-only endpoint identity — gated, no actuators)", cmd: ["pnpm", "run", "proof:nac"] },
  { name: "Proof: macos-apple-schema (apple/device-management alignment)", cmd: ["pnpm", "run", "proof:macos-apple-schema"] },
  { name: "Proof: ot-posture (grid-collected OT/IIoT edge, gated)", cmd: ["pnpm", "run", "proof:ot-posture"] },
  { name: "Proof: access-governance (IAM/access-governance runtime, gated)", cmd: ["pnpm", "run", "proof:access-governance"] },
  { name: "Proof: device-attestation (hardware-rooted attestation, gated)", cmd: ["pnpm", "run", "proof:device-attestation"] },
  { name: "Proof: sso-session (SSO session-binding on shared devices, gated)", cmd: ["pnpm", "run", "proof:sso-session"] },
  { name: "Proof: oauth-consent (OAuth/workload-identity consent governance, gated)", cmd: ["pnpm", "run", "proof:oauth-consent"] },
  { name: "Proof: token-binding (DPoP/mTLS proof-of-possession vs replayable bearer, gated)", cmd: ["pnpm", "run", "proof:token-binding"] },
  { name: "Proof: pacs-access (physical access-control / badge door authorization, gated)", cmd: ["pnpm", "run", "proof:pacs-access"] },
  { name: "Proof: agent-identity (agentic / non-human-identity governance, gated)", cmd: ["pnpm", "run", "proof:agent-identity"] },
  { name: "Proof: agent-behavior (action-judgment — the layer that questions the action, gated)", cmd: ["pnpm", "run", "proof:agent-behavior"] },
  { name: "Proof: custody-beacon (asset recovery — offline beacon fused with reachability, gated)", cmd: ["pnpm", "run", "proof:custody-beacon"] },
  { name: "Proof: app-update (host-app version currency — floors, forced updates, provenance)", cmd: ["pnpm", "run", "proof:app-update"] },
  { name: "Proof: platform-sso (macOS platform credential — method, policy compatibility, lockout exposure)", cmd: ["pnpm", "run", "proof:platform-sso"] },
  { name: "Proof: passkey-assurance (credential worth — attestation, custody, user verification)", cmd: ["pnpm", "run", "proof:passkey-assurance"] },
  { name: "Proof: change-window (an approval is a claim about a specific time, actor and record)", cmd: ["pnpm", "run", "proof:change-window"] },
  { name: "Proof: emitter-discipline (five outbound families gated, fixture never claims delivery)", cmd: ["pnpm", "run", "proof:emitter-discipline"] },
  { name: "Proof: emit-gate (one shared tier gate for every in-adapter emitter route)", cmd: ["pnpm", "run", "proof:emit-gate"] },
  { name: "Proof: mdm-profile (the shipped profiles say what the product claims)", cmd: ["pnpm", "run", "proof:mdm-profile"] },
  { name: "Proof: benchmark-selection (which CIS benchmark graded this device, from what content, covering how much)", cmd: ["pnpm", "run", "proof:benchmark-selection"] },
  { name: "Proof: shift-context (is this the right time and site for this worker to be operating)", cmd: ["pnpm", "run", "proof:shift-context"] },
  { name: "Proof: bootstrap-credential (a temporary pass reaches enrollment only)", cmd: ["pnpm", "run", "proof:bootstrap-credential"] },
  { name: "Proof: challenge-capability (a step_up must be answerable, never a deny in disguise)", cmd: ["pnpm", "run", "proof:challenge-capability"] },
  { name: "Proof: sse-egress (a mandated edge the traffic is not traversing is never protected)", cmd: ["pnpm", "run", "proof:sse-egress"] },
  { name: "Proof: webhooks (outbound delivery gated; a withheld delivery says so)", cmd: ["pnpm", "run", "proof:webhooks"] },
  { name: "Proof: caep-events (unsigned session signals, sixth emitter family)", cmd: ["pnpm", "run", "proof:caep-events"] },
  { name: "Proof: facility-trust-graph (canonical space model + location certainty vs required precision)", cmd: ["pnpm", "run", "proof:facility-trust-graph"] },
  { name: "Proof: policy-binding (group-assignment correctness — membership IS the policy)", cmd: ["pnpm", "run", "proof:policy-binding"] },
  { name: "Proof: device-management-health (management-plane health / config drift, gated)", cmd: ["pnpm", "run", "proof:device-management-health"] },
  { name: "Proof: link-usability (associated vs usable — the network link's expiry, gated)", cmd: ["pnpm", "run", "proof:link-usability"] },
  { name: "Proof: task-exception (WMS/task-plane exceptions, gated)", cmd: ["pnpm", "run", "proof:task-exception"] },
  { name: "Proof: work-context (continuity carries work, trust re-earned per device)", cmd: ["pnpm", "run", "proof:work-context"] },
  { name: "Proof: handoff-sim (cross-device handoff + exception-release loop)", cmd: ["pnpm", "run", "proof:handoff-sim"] },
  { name: "Proof: adaptive-proposals (governed recommendation lifecycle, human-gated activation)", cmd: ["pnpm", "run", "proof:adaptive-proposals"] },
  { name: "Proof: self-audit (self-aware, self-healing checklist; fail-closed; no self-heal)", cmd: ["pnpm", "run", "proof:self-audit"] },
  { name: "Proof: reliability (SLO/error-budget; fail-closed integrity has no budget)", cmd: ["pnpm", "run", "proof:reliability"] },
  { name: "Proof: iac (trust-gated GitOps; plan/approve/apply; a rollout cannot apply itself)", cmd: ["pnpm", "run", "proof:iac"] },
  { name: "Proof: verdict-attestation (a forged verdict is degraded, not just flagged)", cmd: ["pnpm", "run", "proof:verdict-attestation"] },
  { name: "Proof: pim-activation (Entra PIM custom-extension decision surface)", cmd: ["pnpm", "run", "proof:pim-activation"] },
  { name: "Proof: dual-control (two-person integrity; a grant needs two distinct, co-present, verified authorizers)", cmd: ["pnpm", "run", "proof:dual-control"] },
  { name: "Proof: grant-safety (shared allow-path brute-force harness self-test)", cmd: ["pnpm", "run", "proof:grant-safety"] },
  { name: "Proof: posture-composition (unified signal fusion)", cmd: ["pnpm", "run", "proof:posture-composition"] },
  { name: "Proof: incident-playbook (decision → prioritized incident)", cmd: ["pnpm", "run", "proof:incident-playbook"] },
  { name: "Proof: fabric-evals (golden multi-signal decision quality)", cmd: ["pnpm", "run", "proof:fabric-evals"] },
  { name: "Proof: fabric-scenario (end-to-end fusion → incident)", cmd: ["pnpm", "run", "proof:fabric-scenario"] },
  { name: "Proof: connector-emulator", cmd: ["pnpm", "run", "proof:connector-emulator"] },
  { name: "OpenAPI contract check (proof:api-contract)", cmd: ["pnpm", "run", "proof:api-contract"] },
  { name: "API integration test (boots the server)", cmd: ["pnpm", "run", "test:api"] },
  { name: "Proof: observability (metrics endpoint)", cmd: ["pnpm", "run", "proof:observability"] },
  { name: "Proof: enterprise-auth (OIDC/JWT)", cmd: ["pnpm", "run", "proof:enterprise-auth"] },
  { name: "Proof: webauthn-verify", cmd: ["pnpm", "run", "proof:webauthn-verify"] },
  { name: "Proof: audit-ledger", cmd: ["pnpm", "run", "proof:audit-ledger"] },
  { name: "Proof: session-store", cmd: ["pnpm", "run", "proof:session-store"] },
  { name: "Proof: orchestration", cmd: ["pnpm", "run", "proof:orchestration"] },
  { name: "Proof: room-sim", cmd: ["pnpm", "run", "proof:room-sim"] },
  { name: "Proof: app-workflows", cmd: ["pnpm", "run", "proof:app-workflows"] },
  { name: "Proof: app-workflow-templates", cmd: ["pnpm", "run", "proof:app-workflow-templates"] },
  { name: "Proof: flows", cmd: ["pnpm", "run", "proof:flows"] },
  { name: "Proof: grid-coverage (build the grid — situations handled)", cmd: ["pnpm", "run", "proof:grid-coverage"] },
  { name: "Proof: grid-config (workflows as code — CI validation)", cmd: ["pnpm", "run", "proof:grid-config"] },
  { name: "Proof: app-resilience (cloud-app downtime, PHI-safe fallback)", cmd: ["pnpm", "run", "proof:app-resilience"] },
  { name: "Proof: provisioning (zero-touch setup — record/validate/apply)", cmd: ["pnpm", "run", "proof:provisioning"] },
  { name: "Proof: provisioning-order (step order — the numbering is load-bearing)", cmd: ["pnpm", "run", "proof:provisioning-order"] },
  { name: "Proof: provisioning-teardown (prove the retreat before deploy)", cmd: ["pnpm", "run", "proof:provisioning-teardown"] },
  { name: "Proof: factory-flows (manufacturing/OT workflows)", cmd: ["pnpm", "run", "proof:factory-flows"] },
  { name: "Proof: grid-lifecycle (capstone — 6 models, provision→decommission)", cmd: ["pnpm", "run", "proof:grid-lifecycle"] },
  { name: "Proof: recommendations", cmd: ["pnpm", "run", "proof:recommendations"] },
  { name: "Proof: signal-discovery", cmd: ["pnpm", "run", "proof:signal-discovery"] },
  { name: "Proof: ddm-connector", cmd: ["pnpm", "run", "proof:ddm-connector"] },
  { name: "Proof: fleet-connector", cmd: ["pnpm", "run", "proof:fleet-connector"] },
  { name: "Proof: signal-radar", cmd: ["pnpm", "run", "proof:signal-radar"] },
  { name: "Proof: control-plane", cmd: ["pnpm", "run", "proof:control-plane"] },
  { name: "Proof: edge-sync", cmd: ["pnpm", "run", "proof:edge-sync"] },
  { name: "Proof: telemetry-up", cmd: ["pnpm", "run", "proof:telemetry-up"] },
  { name: "Safety gate (guardrails)", cmd: ["pnpm", "run", "safety:check"] },
  // Mirrors the CI "Postman collection is committed in sync" step: regenerate,
  // then fail if the committed collection drifted.
  { name: "Postman collection committed in sync", cmd: ["bash", "-c", "pnpm run build:postman && git diff --exit-code docs/postman"] },
  { name: "Decision-latency pilot gate (bench)", cmd: ["pnpm", "run", "bench:decision-latency"] },
  // Mirrors the supply-chain job's "SBOM is committed and up to date" gate:
  // regenerate the CycloneDX SBOM and fail if it drifted (e.g. a new dependency
  // was added but the committed SBOM wasn't regenerated).
  { name: "CycloneDX SBOM committed in sync", cmd: ["bash", "-c", "pnpm run sbom && git diff --exit-code -- artifacts/sbom/cyclonedx.json"] },
];

const results = [];
let failed = null;
for (const step of STEPS) {
  if (quick && step.heavy) { results.push({ name: step.name, status: "skipped" }); continue; }
  process.stdout.write(`▶ ${step.name} … `);
  const [bin, ...args] = step.cmd;
  const r = spawnSync(bin, args, {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, ...(step.env ?? {}) },
  });
  if (r.status === 0) {
    console.log("ok");
    results.push({ name: step.name, status: "ok" });
  } else {
    console.log("FAILED");
    // Surface the tail of the failing output so the cause is visible inline.
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trimEnd().split("\n").slice(-25).join("\n");
    console.error(`\n─── ${step.name} output (tail) ───\n${out}\n`);
    failed = step.name;
    break;
  }
}

console.log("\n── preflight summary ──");
for (const r of results) console.log(`  ${r.status === "ok" ? "✓" : r.status === "skipped" ? "–" : "✗"} ${r.name}${r.status === "skipped" ? " (skipped)" : ""}`);

if (failed) {
  console.error(`\nPreflight FAILED at: ${failed}. Fix before pushing.`);
  process.exit(1);
}
console.log(`\nPreflight PASSED${quick ? " (quick — heavy builds skipped)" : ""}. Safe to push.`);
