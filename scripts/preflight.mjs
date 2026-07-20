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

// Ordered gates — a COMPLETE mirror of the CI validation + docs-sanity jobs, so
// a green preflight genuinely means CI will be green. Keep this list in lockstep
// with `.github/workflows/review-hub-ci.yml`; a proof that runs in CI but not
// here would let a red build pass preflight. `heavy` steps (full monorepo build)
// are skipped only under --quick.
const STEPS = [
  { name: "Invariant review (fail-closed / determinism / Assist / truth)", cmd: ["node", "scripts/review-invariants.mjs"] },
  { name: "Docs sanity (required docs + unsafe-claim scan)", cmd: ["node", "scripts/docs-sanity.mjs"] },
  { name: "Typecheck (all packages)", cmd: ["pnpm", "run", "typecheck"] },
  { name: "Build (all packages)", cmd: ["pnpm", "run", "build"], heavy: true, env: { PORT: "3000", BASE_PATH: "/" } },
  { name: "Proof: intune-entra-posture", cmd: ["pnpm", "run", "proof:intune-entra-posture"] },
  { name: "Proof: signalgrid-core", cmd: ["pnpm", "run", "proof:signalgrid-core"] },
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
  { name: "Proof: posture-composition (unified signal fusion)", cmd: ["pnpm", "run", "proof:posture-composition"] },
  { name: "Proof: incident-playbook (decision → prioritized incident)", cmd: ["pnpm", "run", "proof:incident-playbook"] },
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
  { name: "Proof: recommendations", cmd: ["pnpm", "run", "proof:recommendations"] },
  { name: "Proof: signal-discovery", cmd: ["pnpm", "run", "proof:signal-discovery"] },
  { name: "Proof: ddm-connector", cmd: ["pnpm", "run", "proof:ddm-connector"] },
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
