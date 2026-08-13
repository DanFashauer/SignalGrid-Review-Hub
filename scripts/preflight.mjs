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
import { uncoveredLines } from "./lib/ci-jobs.mjs";
import { nativeBuildExclusion } from "./lib/platform-native-build.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const quick = process.argv.includes("--quick");

// Ordered gates — a complete mirror of the CI jobs that need NOTHING BUT NODE
// (one honest exception: `proof:mobile-app-catalog` shells to python3, which is
// present on every CI image and every dev machine this repo targets; by design
// that proof FAILS — never skips — when python3 is absent, so this list still
// cannot silently pass a gate it could not run):
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
  // Immediately after the lockfile gate, and for the same reason: the Docker-compose
  // smoke is one of the three CI jobs this file does NOT mirror, so anything only a
  // `docker build` can see is invisible here by construction. A root lifecycle hook
  // whose entrypoint the Dockerfile does not COPY is exactly that — every source-reading
  // gate stays green and the image build dies on `pnpm install`. Reads two text files.
  { name: "Docker carries every install-hook entrypoint", cmd: ["node", "scripts/check-docker-lifecycle-copy.mjs"] },
  { name: "Invariant review (fail-closed / determinism / Assist / truth)", cmd: ["node", "scripts/review-invariants.mjs"] },
  // Shell was the only language here with no static analysis: CodeQL takes JS/TS,
  // tsc takes types, gitleaks takes secrets, the proofs take behaviour. See
  // scripts/check-shell.mjs for why the floor is `warning` and why the Mac lane's
  // validate-sim-macos.sh is DEFERRED rather than excluded.
  { name: "Shell lint (the one language with no static analysis)", cmd: ["node", "scripts/check-shell.mjs"] },
  { name: "Docs sanity (required docs + unsafe-claim scan)", cmd: ["node", "scripts/docs-sanity.mjs"] },
  { name: "Doc orphans (a new doc must be reachable from an index)", cmd: ["node", "scripts/check-doc-orphans.mjs"] },
  { name: "Package reachability (a library nobody ships is a library nobody runs)", cmd: ["node", "scripts/check-package-reachability.mjs"] },
  { name: "Core normalization-version (the provenance stamp must track the code it names)", cmd: ["node", "scripts/generate-core-normalization-version.mjs", "--check"] },
  { name: "Guard-registry drift (coverage lists derived, not trusted)", cmd: ["node", "scripts/check-guard-registries.mjs"] },
  { name: "CI\u2194preflight drift (every proof runs in both places)", cmd: ["node", "scripts/check-ci-preflight-sync.mjs"] },
  // Pure static analysis of the Dockerfiles against pnpm-workspace.yaml — no
  // daemon needed, which is the point: the web image was unbuildable for months
  // because no gate ever built it.
  { name: "Container native base (a Dockerfile that cannot build is not a deploy path)", cmd: ["node", "scripts/check-container-native-base.mjs"] },
  { name: "Publication boundary (nothing reaches a public repo unclassified)", cmd: ["node", "scripts/check-publication-boundary.mjs"] },
  { name: "Pagination-truncation guard (a capped read must not look complete)", cmd: ["node", "scripts/check-pagination-truncation.mjs"] },
  { name: "Absent-collection law (nothing observed ≠ nothing wrong)", cmd: ["pnpm", "run", "proof:absent-collection"] },
  // The doctrine-document proofs (zero-trust, security-operations-evidence,
  // kpi-kri-kci, municipal-resilience, itom-itsm-bridge, grid-lifecycle,
  // factory-flows, fabric-scenario) and the 47 deferred-family gates moved to
  // the BREADTH LANE on 2026-08-11 — `pnpm run verify:breadth`
  // (scripts/verify-breadth.mjs), a parallel required CI job on every PR. They
  // are kept and still gate every pull request; they no longer tax every local
  // per-push run. check-ci-preflight-sync.mjs holds the two lanes disjoint and
  // jointly complete. Run the breadth lane locally when touching a deferred
  // family or a doctrine document.
  // Completeness in both directions: every reason code a refusal can carry has an IT
  // layer and an owner, and nothing is classified that nothing emits. A new family or
  // a new rule fails this until a human classifies it — which is also one more
  // mechanical guard on the breadth freeze.
  { name: "IT-layer model (every refusal has an owner; nothing routes to a phantom)", cmd: ["node", "scripts/check-it-layer-model.mjs"] },
  { name: "IT-layer model self-test (the gate can actually fail)", cmd: ["node", "scripts/check-it-layer-model.mjs", "--self-test"] },
  { name: "Port parity (DecisionEngine + AppWorkflows must not drift from their TS originals)", cmd: ["node", "scripts/check-decision-port-parity.mjs"] },
  // Sibling of the gate above, one level down. That one keeps the Swift port faithful
  // to the TypeScript reference; this one keeps the two BUILD SYSTEMS that compile the
  // Swift port compiling the same files — the Xcode test target and the SwiftPM package
  // that gives it a macOS run. Both lists are hand-written, so both can drift, and the
  // drift is invisible: two green lanes covering different code.
  { name: "iOS port sources (Xcode and SwiftPM must compile the same port)", cmd: ["node", "scripts/check-ios-port-sources.mjs"] },
  // Three languages now implement the same fail-closed Assist rule (TypeScript,
  // Kotlin, Rust), each with its own tests — which is exactly how they diverge while
  // all three stay green. This checks every client is bound to ONE shared set of
  // cases. It found two real Kotlin defects the day it was written.
  { name: "Assist conformance (every client answers the shared cases the same way)", cmd: ["node", "scripts/check-assist-conformance.mjs"] },
  { name: "Read-error swallowing (a failed lookup must not report \"nothing found\")", cmd: ["node", "scripts/check-read-error-swallowing.mjs"] },
  // Every other gate here checks what the text MEANS. This one checks that the text
  // is what it appears to be: no bidirectional control or invisible character may
  // make a tracked file render differently from how it executes (CVE-2021-42574).
  { name: "Text safety (no file may render differently from how it executes)", cmd: ["node", "scripts/check-text-safety.mjs"] },
  // Sibling of the gate above. That one catches text engineered to deceive; this
  // one catches text nobody meant to ship — and a conflict marker reached the
  // default branch in Dockerfile.web, where it broke the web image outright.
  { name: "Merge markers (no unresolved conflict may be committed)", cmd: ["node", "scripts/check-merge-markers.mjs"] },
  { name: "Proof: mcp-server (the published plugin path boots and serves its declared tools)", cmd: ["pnpm", "run", "proof:mcp-server"] },
  { name: "Preflight↔CI parity (a gate that runs only locally is not a gate)", cmd: ["node", "scripts/check-preflight-ci-parity.mjs"] },
  { name: "Assessor package (every link, command and path in it resolves)", cmd: ["node", "scripts/check-assessor-package.mjs"] },
  { name: "Connector discipline (every family gated + proven, none acting on a device)", cmd: ["node", "scripts/check-connector-discipline.mjs"] },
  { name: "Launch profile (the declared product edge matches the real one)", cmd: ["node", "scripts/check-launch-profile.mjs"] },
  { name: "Ungated fetch (a health check is still a live call)", cmd: ["node", "scripts/check-ungated-fetch.mjs"] },
  // Sibling of the ungated-fetch gate. That one asks whether a call was allowed to happen;
  // this one asks whether the RESULT reported was one anybody observed. Twelve connectors
  // returned `status: 200` after awaiting an injected transport that resolves a payload —
  // there was no response, so there was no status.
  { name: "Fabricated status (a connector may not report a status it never observed)", cmd: ["node", "scripts/check-fabricated-status.mjs"] },
  { name: "Fabricated status self-test (the gate can actually fail)", cmd: ["node", "scripts/check-fabricated-status.mjs", "--self-test"] },
  // A core proof can show authorizedContext refuses the wrong role; only this shows the
  // ROUTES still call it. Without it a handler could regress to context() and stay green.
  { name: "Durable-path authorization (a durable read must authorize, not just authenticate)", cmd: ["node", "scripts/check-durable-path-authorization.mjs"] },
  // SIX offline proofs ran in NO pull-request gate — not here, not in any workflow
  // except mac-lane.yml, which fires weekly and on dispatch, never on a PR. Each is
  // self-described as pure and offline, so there was no reason for it beyond nobody
  // wiring them up. proof:isolation-scope is the one that stings: it asserts no tenant
  // can read another tenant's row, across every scoped reader, and a break in that
  // would have passed preflight and every PR check.
  { name: "Proof: isolation-scope (no tenant can read another's row)", cmd: ["pnpm", "run", "proof:isolation-scope"] },
  { name: "Proof: graph-wire (throttling, 5xx, auth and malformed bodies fail closed)", cmd: ["pnpm", "run", "proof:graph-wire"] },
  { name: "Docs\u2194proof FIGURE guard (a measured number must still be one)", cmd: ["node", "scripts/check-proof-figures.mjs"] },
  { name: "Proof-count sync (documented check counts match their proofs)", cmd: ["node", "scripts/check-proof-counts.mjs"] },
  { name: "Live-sync manifest (external builders see current contracts)", cmd: ["node", "scripts/check-live-sync.mjs"] },
  { name: "MCP surface (chat connection must match the fabric)", cmd: ["node", "scripts/check-mcp-surface.mjs"] },
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
  { name: "Proof: event-contract (validation + cross-domain detections)", cmd: ["pnpm", "run", "proof:event-contract"] },
  { name: "Proof: local-authority (may this device act on its own authority now)", cmd: ["pnpm", "run", "proof:local-authority"] },
  { name: "Proof: launch-profile (the declared Limited GA scope is coherent and its figures are published)", cmd: ["pnpm", "run", "proof:launch-profile"] },
  { name: "Proof: launch-seam (fixture connector → bridge → core decision → evidence, all 3 launch families, offline)", cmd: ["pnpm", "run", "proof:launch-seam"] },
  { name: "Proof: evidence-adapter (source-agnostic — swap fleet/headwind/intune, the decision must not change)", cmd: ["pnpm", "run", "proof:evidence-adapter"] },
  { name: "Proof: mobile-app-catalog (hardened scanner — leak/symlink/determinism/cap; needs python3, FAILS without it)", cmd: ["pnpm", "run", "proof:mobile-app-catalog"] },
  { name: "Proof: sim-requests (the cloud↔Mac loop — a request cannot carry a command, an unrun run is never green)", cmd: ["pnpm", "run", "proof:sim-requests"] },
  { name: "/v1 under concurrency (correctness gated; throughput and saturation reported, never asserted)", cmd: ["pnpm", "run", "test:load"], heavy: true },
  { name: "Simulation request loop (every result binds to a request; pending is reported, never silent)", cmd: ["node", "scripts/check-sim-requests.mjs"] },
  { name: "Simulation request loop self-test (the gate can actually fail)", cmd: ["node", "scripts/check-sim-requests.mjs", "--self-test"] },
  { name: "Surface claims (no doc may deny a platform the tree contains)", cmd: ["node", "scripts/check-surface-claims.mjs"] },
  { name: "Surface-claim self-test (the gate can actually fail, and a retraction may quote the old claim)", cmd: ["node", "scripts/check-surface-claims.mjs", "--self-test"] },
  { name: "Proof: lane-messages (the cloud↔Mac channel — identity is derived, and no lane acknowledges its own mail)", cmd: ["pnpm", "run", "proof:lane-messages"] },
  { name: "Lane messages (unread mail is named on every run; only the addressee can close one)", cmd: ["node", "scripts/check-lane-messages.mjs"] },
  { name: "Lane message self-test (the gate can actually fail)", cmd: ["node", "scripts/check-lane-messages.mjs", "--self-test"] },
  { name: "Proof: operating-method (the handbook is a gate — buckets, ladder, dispositions, links, roles)", cmd: ["pnpm", "run", "proof:operating-method"] },
  { name: "Proof: evidence-coverage (what can this estate actually answer)", cmd: ["pnpm", "run", "proof:evidence-coverage"] },
  { name: "Proof: device-resolver (read-only at the injection boundary)", cmd: ["pnpm", "run", "proof:device-resolver"] },
  { name: "Proof: config-scope (connector config keyed per tenant, never normalized)", cmd: ["pnpm", "run", "proof:config-scope"] },
  { name: "Proof: unsafe-claim (a disclaimer is not a claim)", cmd: ["pnpm", "run", "proof:unsafe-claim"] },
  { name: "Proof: macos-apple-schema (apple/device-management alignment)", cmd: ["pnpm", "run", "proof:macos-apple-schema"] },
  { name: "Proof: mcp-answer-discipline (silence is not an affirmative, over the raw wire)", cmd: ["pnpm", "run", "proof:mcp-answer-discipline"] },
  { name: "Proof: mdm-profile (the shipped profiles say what the product claims)", cmd: ["pnpm", "run", "proof:mdm-profile"] },
  { name: "Proof: facility-trust-graph (canonical space model + location certainty vs required precision)", cmd: ["pnpm", "run", "proof:facility-trust-graph"] },
  { name: "Proof: device-management-health (management-plane health / config drift, gated)", cmd: ["pnpm", "run", "proof:device-management-health"] },
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
  { name: "Proof: connector-emulator", cmd: ["pnpm", "run", "proof:connector-emulator"] },
  { name: "OpenAPI contract check (proof:api-contract)", cmd: ["pnpm", "run", "proof:api-contract"] },
  { name: "API integration test (boots the server)", cmd: ["pnpm", "run", "test:api"] },
  { name: "Proof: observability (metrics endpoint)", cmd: ["pnpm", "run", "proof:observability"] },
  { name: "Proof: enterprise-auth (OIDC/JWT)", cmd: ["pnpm", "run", "proof:enterprise-auth"] },
  { name: "Proof: webauthn-verify", cmd: ["pnpm", "run", "proof:webauthn-verify"] },
  // Absorbed from the base lane. It SELF-SKIPS when DATABASE_URL is unset, which is
  // exactly why it belongs here rather than on the CI-only exempt list: preflight
  // stays deterministic and needs no Postgres, and an operator who HAS a database
  // gets the restore path exercised locally.
  { name: "Proof: backup-restore (the restore path, exercised not assumed)", cmd: ["pnpm", "run", "proof:backup-restore"] },
  { name: "Proof: audit-ledger", cmd: ["pnpm", "run", "proof:audit-ledger"] },
  { name: "Proof: session-store", cmd: ["pnpm", "run", "proof:session-store"] },
  { name: "Proof: orchestration", cmd: ["pnpm", "run", "proof:orchestration"] },
  { name: "Proof: room-sim", cmd: ["pnpm", "run", "proof:room-sim"] },
  { name: "Proof: app-workflows", cmd: ["pnpm", "run", "proof:app-workflows"] },
  { name: "Proof: app-workflow-templates", cmd: ["pnpm", "run", "proof:app-workflow-templates"] },
  { name: "Proof: flows", cmd: ["pnpm", "run", "proof:flows"] },
  { name: "Proof: grid-coverage (build the grid — the coverage ceiling and its basis)", cmd: ["pnpm", "run", "proof:grid-coverage"] },
  { name: "Proof: grid-config (workflows as code — CI validation)", cmd: ["pnpm", "run", "proof:grid-config"] },
  { name: "Proof: app-resilience (cloud-app downtime, PHI-safe fallback)", cmd: ["pnpm", "run", "proof:app-resilience"] },
  { name: "Proof: provisioning (zero-touch setup — record/validate/apply)", cmd: ["pnpm", "run", "proof:provisioning"] },
  { name: "Proof: provisioning-order (step order — the numbering is load-bearing)", cmd: ["pnpm", "run", "proof:provisioning-order"] },
  { name: "Proof: provisioning-teardown (prove the retreat before deploy)", cmd: ["pnpm", "run", "proof:provisioning-teardown"] },
  { name: "Proof: recommendations", cmd: ["pnpm", "run", "proof:recommendations"] },
  { name: "Proof: signal-discovery", cmd: ["pnpm", "run", "proof:signal-discovery"] },
  { name: "Proof: ddm-connector", cmd: ["pnpm", "run", "proof:ddm-connector"] },
  { name: "Proof: fleet-connector", cmd: ["pnpm", "run", "proof:fleet-connector"] },
  { name: "Proof: signal-radar", cmd: ["pnpm", "run", "proof:signal-radar"] },
  { name: "Proof: control-plane", cmd: ["pnpm", "run", "proof:control-plane"] },
  { name: "Proof: edge-sync", cmd: ["pnpm", "run", "proof:edge-sync"] },
  { name: "Proof: decision-continuity (which decision wins across a partition)", cmd: ["pnpm", "run", "proof:decision-continuity"] },
  { name: "Safety gate (guardrails)", cmd: ["pnpm", "run", "safety:check"] },
  // Mirrors the CI "Postman collection is committed in sync" step: regenerate,
  // then fail if the committed collection drifted.
  // `git ls-files --error-unmatch` FIRST. `git diff --exit-code <path>` reports nothing at
  // all for an UNTRACKED path, so on its own this gate passes whether the file is correct,
  // corrupt, forgotten at `git add`, deleted, or gitignored. Demonstrated, not theorised: a
  // review replaced a generated file's entire contents with garbage and the diff-only form
  // exited 0.
  { name: "Postman collection committed in sync", cmd: ["bash", "-c", "git ls-files --error-unmatch docs/postman >/dev/null && pnpm run build:postman && git diff --exit-code docs/postman"] },
  // Mirrors the CI "Evidence Coverage page is committed in sync" step. The page is a
  // GENERATED artifact with the real coverage model bundled into it, and its browser
  // E2E loads the COMMITTED file — so a stale commit would be tested instead of the
  // current model, and would keep passing for every model change that did not happen to
  // move one of the pinned figures. esbuild's output is byte-stable for a given input,
  // which is what makes the diff a usable gate rather than a flake.
  { name: "Evidence Coverage page committed in sync", cmd: ["bash", "-c", "git ls-files --error-unmatch docs/evidence-coverage.html >/dev/null && pnpm run build:evidence-coverage && git diff --exit-code -- docs/evidence-coverage.html"] },
  // NOT a regenerate-and-diff gate, unlike the three above, and the difference is
  // load-bearing: docs/STATUS.md embeds the HEAD sha by design (its own staleness
  // tell), so the commit that adds it changes HEAD and it can never equal its own
  // regeneration. Its generator is also slow and hits the network. So gate the part
  // that actually rots — the inventory counts, which are cheap and offline. They had
  // drifted to 95 proof gates against a real 122, 8 E2E specs against 10, and 12 CI
  // workflows against 16.
  { name: "STATUS.md figures still describe the repo", cmd: ["node", "scripts/check-status-figures.mjs"] },
  { name: "STATUS.md figure gate self-test (the gate can actually fail)", cmd: ["node", "scripts/check-status-figures.mjs", "--self-test"] },
  { name: "Decision-latency pilot gate (bench)", cmd: ["pnpm", "run", "bench:decision-latency"] },
  // The saturation companion. Its ops/sec figures are hardware-specific and
  // report-only — what it can fail on any machine is a throughput floor derived
  // from the latency gate above, a collapse when cores are added, and a verdict
  // that changes with thread count. Two-second windows keep it ~5s serial.
  {
    name: "Decision-throughput saturation gate (bench)",
    cmd: ["pnpm", "run", "bench:decision-throughput", "--", "--seconds=2"],
  },
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
// DERIVED from .github/workflows/, not hand-listed. It used to be three strings while
// the repo ran nineteen CI jobs, so CodeQL, the level-10 audit, the emulator smoke,
// phase-pr-evidence and the whole iOS suite were missing from the one list whose job is
// to say what is missing. See scripts/lib/ci-jobs.mjs.
const UNCOVERED = uncoveredLines();
// Kept from the base lane and complementary to the line above: a step the platform
// could not run is UNAVAILABLE, never passed. Two different honesty problems — what CI
// covers that preflight does not, and what preflight could not execute here.
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
