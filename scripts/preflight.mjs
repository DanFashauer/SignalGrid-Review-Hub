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
import { nativeBuildExclusion } from "./lib/platform-native-build.mjs";

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
  // FIRST, because it is the first thing CI does and the cheapest way to be told
  // this push cannot even install. It was missing, and that omission let preflight
  // print "Safe to push" over a lockfile that did not match its manifests — CI then
  // failed on `Install dependencies` before running a single gate.
  //
  // The specific way it broke is worth naming: this harness adds darwin platform
  // binaries to build locally (the repo pins linux-x64) and restores the manifests
  // afterwards. That dance leaked the four darwin entries into pnpm-lock.yaml while
  // package.json had been restored without them. Every other gate passed, because
  // every other gate reads source rather than the lockfile.
  //
  // `--lockfile-only`, NOT `--offline`. The first version used `--offline` to keep
  // the check fast, and that conflated two different failures: a genuine
  // lockfile/manifest mismatch, and a package simply not being in the local store.
  // Rebasing a dependency PR failed it with ERR_PNPM_NO_OFFLINE_TARBALL over a
  // lockfile that was perfectly consistent — a gate that cries wolf precisely on
  // the branches that change dependencies, which is the only time it matters.
  // `--lockfile-only` resolves without fetching tarballs: exit 0 when consistent
  // even with an unwarmed store, exit 1 on a real mismatch. Both verified.
  { name: "Lockfile matches manifests (what CI installs with)", cmd: ["pnpm", "install", "--frozen-lockfile", "--lockfile-only"] },
  { name: "Invariant review (fail-closed / determinism / Assist / truth)", cmd: ["node", "scripts/review-invariants.mjs"] },
  { name: "Docs sanity (required docs + unsafe-claim scan)", cmd: ["node", "scripts/docs-sanity.mjs"] },
  { name: "Doc orphans (a new doc must be reachable from an index)", cmd: ["node", "scripts/check-doc-orphans.mjs"] },
  { name: "Guard-registry drift (coverage lists derived, not trusted)", cmd: ["node", "scripts/check-guard-registries.mjs"] },
  // Pure static analysis of the Dockerfiles against pnpm-workspace.yaml — no
  // daemon needed, which is the point: the web image was unbuildable for months
  // because no gate ever built it.
  { name: "Container native base (a Dockerfile that cannot build is not a deploy path)", cmd: ["node", "scripts/check-container-native-base.mjs"] },
  { name: "Publication boundary (nothing reaches a public repo unclassified)", cmd: ["node", "scripts/check-publication-boundary.mjs"] },
  { name: "Pagination-truncation guard (a capped read must not look complete)", cmd: ["node", "scripts/check-pagination-truncation.mjs"] },
  { name: "Absent-collection law (nothing observed ≠ nothing wrong)", cmd: ["pnpm", "run", "proof:absent-collection"] },
  { name: "Port parity (DecisionEngine + AppWorkflows must not drift from their TS originals)", cmd: ["node", "scripts/check-decision-port-parity.mjs"] },
  { name: "Read-error swallowing (a failed lookup must not report \"nothing found\")", cmd: ["node", "scripts/check-read-error-swallowing.mjs"] },
  // Every other gate here checks what the text MEANS. This one checks that the text
  // is what it appears to be: no bidirectional control or invisible character may
  // make a tracked file render differently from how it executes (CVE-2021-42574).
  { name: "Text safety (no file may render differently from how it executes)", cmd: ["node", "scripts/check-text-safety.mjs"] },
  { name: "Proof: mcp-server (the published plugin path boots and serves its declared tools)", cmd: ["pnpm", "run", "proof:mcp-server"] },
  { name: "Preflight↔CI parity (a gate that runs only locally is not a gate)", cmd: ["node", "scripts/check-preflight-ci-parity.mjs"] },
  { name: "Assessor package (every link, command and path in it resolves)", cmd: ["node", "scripts/check-assessor-package.mjs"] },
  { name: "Connector discipline (every family gated + proven, none acting on a device)", cmd: ["node", "scripts/check-connector-discipline.mjs"] },
  { name: "Ungated fetch (a health check is still a live call)", cmd: ["node", "scripts/check-ungated-fetch.mjs"] },
  // A core proof can show authorizedContext refuses the wrong role; only this shows the
  // ROUTES still call it. Without it a handler could regress to context() and stay green.
  { name: "Durable-path authorization (a durable read must authorize, not just authenticate)", cmd: ["node", "scripts/check-durable-path-authorization.mjs"] },
  // SIX offline proofs ran in NO pull-request gate — not here, not in any workflow
  // except mac-lane.yml, which fires weekly and on dispatch, never on a PR. Each is
  // self-described as pure and offline, so there was no reason for it beyond nobody
  // wiring them up. proof:isolation-scope is the one that stings: it asserts no tenant
  // can read another tenant's row, across every scoped reader, and a break in that
  // would have passed preflight and every PR check.
  { name: "Proof: emit-gate (no outbound family sends from a non-emitting tier)", cmd: ["pnpm", "run", "proof:emit-gate"] },
  { name: "Proof: isolation-scope (no tenant can read another's row)", cmd: ["pnpm", "run", "proof:isolation-scope"] },
  { name: "Proof: nac (read-only, no device action reachable, live path gated)", cmd: ["pnpm", "run", "proof:nac"] },
  { name: "Proof: webhooks (outbound delivery gated; refusals explain themselves)", cmd: ["pnpm", "run", "proof:webhooks"] },
  { name: "Proof: mdm-profile (the shipped profiles say what the product claims)", cmd: ["pnpm", "run", "proof:mdm-profile"] },
  { name: "Proof: graph-wire (throttling, 5xx, auth and malformed bodies fail closed)", cmd: ["pnpm", "run", "proof:graph-wire"] },
  { name: "Docs\u2194proof FIGURE guard (a measured number must still be one)", cmd: ["node", "scripts/check-proof-figures.mjs"] },
  { name: "Proof-count sync (documented check counts match their proofs)", cmd: ["node", "scripts/check-proof-counts.mjs"] },
  { name: "Live-sync manifest (external builders see current contracts)", cmd: ["node", "scripts/check-live-sync.mjs"] },
  { name: "Typecheck (all packages)", cmd: ["pnpm", "run", "typecheck"] },
  // needsNativeBuild: rollup/esbuild/lightningcss/oxide platform binaries. The
  // workspace strips every triple but linux-x64, so on other platforms this step
  // is structurally absent rather than failing — see scripts/lib/platform-native-build.mjs.
  { name: "Build (all packages)", cmd: ["pnpm", "run", "build"], heavy: true, needsNativeBuild: true, env: { PORT: "3000", BASE_PATH: "/" } },
  { name: "Proof: intune-entra-posture", cmd: ["pnpm", "run", "proof:intune-entra-posture"] },
  { name: "Proof: signalgrid-core", cmd: ["pnpm", "run", "proof:signalgrid-core"] },
  { name: "Proof: live-idp (real OIDC provider, real DPoP)", cmd: ["pnpm", "run", "proof:live-idp"] },
  // Drives the built bundles, so it inherits the same platform constraint.
  { name: "Browser E2E (review console, website, admin)", cmd: ["pnpm", "run", "test:e2e"], heavy: true, needsNativeBuild: true },
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

// Is the native web build structurally impossible here? Derived from the committed
// pnpm-workspace.yaml plus whether the binaries actually resolve — never from a
// flag, so nobody can buy a skip by asking for one. On linux-x64 (CI) the binaries
// are present by design and this is always false, leaving the build mandatory.
const nativeExclusion = nativeBuildExclusion(repo);
if (nativeExclusion.excluded) {
  console.log(`ℹ native web build unavailable on ${nativeExclusion.target} — ${nativeExclusion.reason}\n`);
}

const results = [];
let failed = null;
for (const step of STEPS) {
  if (quick && step.heavy) { results.push({ name: step.name, status: "skipped" }); continue; }
  if (step.needsNativeBuild && nativeExclusion.excluded) {
    // NOT a pass. Recorded as absent, with the reason, and surfaced in the summary
    // and the final verdict so a reader is never told more than actually ran.
    results.push({ name: step.name, status: "unavailable" });
    console.log(`▶ ${step.name} … unavailable on this platform`);
    continue;
  }
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
for (const r of results) {
  const mark = r.status === "ok" ? "✓" : "–";
  const note =
    r.status === "skipped" ? " (skipped)"
    : r.status === "unavailable" ? " (UNAVAILABLE on this platform — not run, not passed)"
    : "";
  console.log(`  ${mark} ${r.name}${note}`);
}

if (failed) {
  console.error(`\nPreflight FAILED at: ${failed}. Fix before pushing.`);
  process.exit(1);
}
// "Safe to push" was an overstatement, and it was believed. This harness mirrors
// THREE of the six CI jobs; the other three need external services it cannot start.
// Twice now a green preflight was read as proof and the push went red anyway — once
// on a lockfile CI could not install, once on a Docker image build. Both times the
// header already said this. A caveat nobody reads at the moment of decision is not a
// caveat, so it now prints WITH the verdict rather than being documented above it.
//
// Same rule the status file follows: never claim more than the run verified.
const UNCOVERED = [
  "deploy-stack        (Docker image + compose smoke)",
  "durable-persistence (Postgres audit ledger)",
  "secret-scan         (gitleaks)",
];
const unavailable = results.filter((r) => r.status === "unavailable");
console.log(`\nPreflight PASSED${quick ? " (quick — heavy builds skipped)" : ""} — everything it runs is green.`);
if (unavailable.length > 0) {
  // Stated WITH the verdict, not below it. "Everything it runs is green" is true
  // and also incomplete; a reader deciding whether to trust this run needs to know
  // which steps never ran, and that this platform CANNOT run them.
  console.log(`\n  ${unavailable.length} step(s) did NOT run — unavailable on ${nativeExclusion.target}, not passed:`);
  for (const r of unavailable) console.log(`    · ${r.name}`);
  console.log(`    reason: ${nativeExclusion.reason}`);
  console.log("    These still run in CI on linux-x64, where the binaries exist. A green here");
  console.log("    is NOT evidence the web bundle builds.");
}
console.log("\n  NOT covered by this harness (CI runs these; a green preflight says nothing about them):");
for (const j of UNCOVERED) console.log(`    · ${j}`);
if (quick) console.log("    · the full monorepo build + browser E2E (--quick skipped them; drop --quick to include)");
console.log("\n  Changed a Dockerfile, a lifecycle script, or dependencies? Build the image before");
console.log("  pushing — `docker compose -f docker-compose.prod.yml up -d --build` — because");
console.log("  nothing above does.");
