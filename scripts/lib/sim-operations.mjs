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
