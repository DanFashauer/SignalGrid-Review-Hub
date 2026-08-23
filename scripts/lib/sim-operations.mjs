// The ALLOWLIST of simulation operations a run-request may ask for.
//
// This is the single source of truth read by BOTH the runner
// (`scripts/mac/run-requests.mjs`) and the gate (`scripts/check-sim-requests.mjs`).
// Two lists would drift, and the first drift would be a request the gate accepts
// and the runner cannot run — which reads as "queued" forever without anything
// saying so.
//
// WHY AN ALLOWLIST AND NOT A COMMAND STRING. A request file is authored by the
// cloud lane and executed on the owner's Mac, with the owner's filesystem and
// credentials. A request carrying a shell string would make "please run a
// simulation" and "please run anything" the same message. Requests name a KEY;
// the machine that executes decides what that key means. Nothing outside this
// file can ever be executed by the runner.
//
// `platform: "macos"` marks operations that genuinely require a Mac — the iOS
// simulator, the real-hardware evidence emission. On another platform the runner
// REFUSES them and records `refused_platform`; it never substitutes a weaker run
// and reports the strong one.

/** @typedef {{ argv: string[], platform: "any"|"macos", needs?: string, what: string }} SimOperation */

/** @type {Record<string, SimOperation>} */
export const SIM_OPERATIONS = {
  // ── deterministic suites (no hardware, no network) ────────────────────────
  "proofs-full": {
    argv: ["./validate-sim-macos.sh"],
    platform: "macos",
    what: "the full local harness CI mirrors — every proof gate and scenario",
  },
  "proofs-sim-only": {
    argv: ["./validate-sim-macos.sh", "--sim-only"],
    platform: "macos",
    what: "the simulator scenarios alone (fast path through the harness)",
  },
  preflight: {
    argv: ["node", "scripts/preflight.mjs"],
    platform: "any",
    what: "the per-push gate lane (everything reproducible without a Mac)",
  },
  breadth: {
    argv: ["node", "scripts/verify-breadth.mjs"],
    platform: "any",
    what: "the deferred-family + doctrine-proof lane",
  },
  simulator: {
    argv: ["pnpm", "run", "proof:signalgrid-simulator"],
    platform: "any",
    what: "the decision simulator proof — the scenario engine on its own",
  },

  // ── the running product ───────────────────────────────────────────────────
  api: {
    argv: ["pnpm", "--filter", "@workspace/api-server", "run", "test:api"],
    platform: "any",
    what: "the /v1 decision API exercised end to end, every assertion",
  },
  "bruno-collection": {
    argv: ["node", "scripts/run-bruno-collection.mjs"],
    platform: "any",
    what: "the committed Bruno collection executed with the real CLI against a self-booted fixture server, both product profiles, negative tests included",
  },
  load: {
    argv: ["pnpm", "--filter", "@workspace/api-server", "run", "test:load"],
    platform: "any",
    what: "the /v1 decision API under concurrency — correctness gated, throughput and latency reported",
  },
  stress: {
    argv: ["pnpm", "--filter", "@workspace/api-server", "run", "test:stress"],
    platform: "any",
    what: "the same, plus a concurrency ramp that reports where the server saturates",
  },
  e2e: {
    argv: ["pnpm", "--filter", "@workspace/scripts", "run", "test:e2e"],
    platform: "any",
    what: "the browser E2E layer against the rendered console",
  },

  // ── the turnkey Mac runs (proofs → API → MCP → iOS simulator) ─────────────
  everything: {
    argv: ["./scripts/mac/run-everything.sh"],
    platform: "macos",
    what: "proofs, API, MCP over real JSON-RPC, and EnterpriseShell in the iOS simulator with mimicked hardware",
  },
  "everything-fast": {
    argv: ["./scripts/mac/run-everything.sh", "--fast"],
    platform: "macos",
    what: "the same four phases with the proof phase reduced to scenarios",
  },
  "everything-no-ios": {
    argv: ["./scripts/mac/run-everything.sh", "--no-ios"],
    platform: "macos",
    what: "proofs, API and MCP without the simulator phase",
  },

  // ── real-hardware evidence (the only lane that can refresh mac-run.json) ──
  evidence: {
    argv: ["node", "scripts/verify-all.mjs", "--require-mcp", "--emit-evidence"],
    platform: "macos",
    needs: "SIGNALGRID_MCP_PATH pointing at the signalgrid-mcp checkout",
    what: "both halves against the shared contract, minting artifacts/live-evidence/mac-run.json",
  },

  // ── optional lanes that need something beyond the repo ────────────────────
  docker: {
    argv: ["node", "scripts/docker-verify.mjs"],
    platform: "any",
    needs: "a running container engine (Docker Desktop or podman)",
    what: "the production stack built and smoke-tested",
  },
  "live-lanes": {
    argv: ["./scripts/run-live-lanes.sh"],
    platform: "any",
    needs: "the live-lane credentials; skips loudly by name when unset",
    what: "the real-vendor lanes (Wazuh, Keycloak, Fleet, Traccar) where configured",
  },
  // ── one key per live lane ─────────────────────────────────────────────────
  //
  // A request that needs ONE vendor should be able to say so. `live-lanes` is
  // all-or-nothing: it exits 3 if ANY lane skipped, so a run where Fleet passed
  // against a real Fleet still recorded refused_missing_prerequisite because
  // proof:live-edr skipped — and run-live-lanes.sh never starts Wazuh for you
  // (~2GB image, minutes of boot). That made 2026-08-12-fleet-lab-real-source
  // permanently unresolvable on this Mac, even though its own notes said "Fleet
  // is the one that matters here; Wazuh/Keycloak/Traccar skipping is fine".
  //
  // The coarse status was not wrong — an unrun lane is genuinely not green. The
  // request simply had no way to name the lane it cared about. These are that way.
  // Each maps to the `--only` filter run-live-lanes.sh already supported: with the
  // other lanes filtered out nothing is skipped, so a lane that passes exits 0 and
  // records `passed` rather than being dragged to refused by an unrelated lane.
  //
  // THEY ARE NOT INTERCHANGEABLE. Fleet, Keycloak and Traccar stand their own
  // stacks up in Docker and tear them down. Wazuh does not — the script refuses to
  // pull a ~2GB image for you — so `live-edr` still records
  // refused_missing_prerequisite unless WAZUH_URL points at a real server. That is
  // the honest answer for it, not a gap to paper over with a self-provisioning
  // claim it cannot keep.
  "live-headwind": {
    argv: ["./scripts/run-live-lanes.sh", "--only", "headwind"],
    platform: "any",
    needs: "a container engine; pulls headwindmdm/hmdm:0.1.5 + postgres:16 on first run (the hmdm image downloads its war from h-mdm.com at boot)",
    what: "the second live device-management source: Headwind CE driven over the launcher protocol, capture written for the evidence-adapter parity section",
  },
  "live-telemetry": {
    argv: ["./scripts/run-live-lanes.sh", "--only", "telemetry"],
    platform: "any",
    needs: "a container engine; pulls the pinned otel-collector-contrib + prometheus images on first run",
    what: "the opt-in telemetry transport (api /metrics -> OTel collector -> Prometheus, asserted via the Prometheus query API)",
  },
  "live-fleet": {
    argv: ["./scripts/run-live-lanes.sh", "--only", "fleet"],
    platform: "any",
    needs: "a running container engine; the script stands Fleet up itself",
    what: "the Fleet device-management lane alone, against a real Fleet in Docker",
  },
  "live-keycloak": {
    argv: ["./scripts/run-live-lanes.sh", "--only", "keycloak"],
    platform: "any",
    needs: "a running container engine; the script stands Keycloak up itself",
    what: "the Keycloak identity lane alone (DPoP feature), against a real Keycloak",
  },
  "live-location": {
    argv: ["./scripts/run-live-lanes.sh", "--only", "location"],
    platform: "any",
    needs: "a running container engine; the script stands Traccar up itself",
    what: "the Traccar location lane alone, against a real Traccar",
  },
  "live-edr": {
    argv: ["./scripts/run-live-lanes.sh", "--only", "edr"],
    platform: "any",
    needs: "WAZUH_URL pointing at a real Wazuh — this lane is NOT self-provisioning",
    what: "the Wazuh EDR lane alone; refuses (never passes) when WAZUH_URL is unset",
  },
};

export const OPERATION_KEYS = Object.freeze(Object.keys(SIM_OPERATIONS).sort());

/** Terminal statuses a result may record for one operation.
 *
 *  `pending` is deliberately NOT here: a run that did not happen has no result
 *  row at all, and its absence is what the gate reports. Letting a result carry
 *  "pending" would put a not-yet-true row in the same file as the true ones. */
export const RUN_STATUSES = Object.freeze([
  "passed",
  "failed",
  "refused_platform",
  "refused_missing_prerequisite",
  "skipped_by_operator",
]);

/** Statuses that mean the operation ACTUALLY EXECUTED and succeeded. Only this
 *  set may ever be read as evidence that a simulation ran clean. */
export const GREEN_STATUSES = Object.freeze(["passed"]);

/** Statuses that mean the operation ACTUALLY EXECUTED, whatever the outcome.
 *
 *  A refusal or a skip is an honest record that something was ATTEMPTED and could
 *  not be done here — it closes nothing out. The gate treats every other status as
 *  still-owed, which is what stops a machine that cannot do the work from
 *  answering the request by declining it. */
export const EXECUTED_STATUSES = Object.freeze(["passed", "failed"]);
