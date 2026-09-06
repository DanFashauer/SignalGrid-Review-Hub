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
  // The iOS shell repair of 2026-09-02 was written without a Swift toolchain; this
  // is the run that proves or falsifies it, step by step with a PASS/FAIL line each
  // (generate, build, demo launch, no-flag launch before and after the local
  // sign-in toggle, a 40 s no-crash soak against a loopback backend, and the
  // accessibility-extra-large lock screen). A single green row for `everything-fast`
  // could not stand in for those; a request that named them only in notes would
  // have closed on that one row.
  "ios-shell-repair": {
    argv: ["./scripts/mac/ios-shell-repair.sh"],
    platform: "macos",
    needs: "Xcode + iOS platform + xcodegen; an api-server on API_PORT (default 8080) for the soak step",
    what: "EnterpriseShell generated, built, and launched through the demo, no-flag, local-toggle, loopback-backend and accessibility paths, with screenshots",
  },

  // ── the native Android and desktop lanes ──────────────────────────────────
  //
  // The two core suites run anywhere with a JDK / a Rust toolchain, so they are
  // `any`: calling them macOS-only would make a Linux runner REFUSE work it can
  // do, and the proof pins the macOS-only set to the genuinely hardware-bound
  // lanes. They are here so the Mac can be ASKED to run them — darwin truth for
  // suites that have only ever run on Linux CI. The window smoke is macOS-only
  // because it opens a real window and (optionally) takes a screenshot with
  // `screencapture`; CI never opens the window at all.
  "android-core-tests": {
    argv: ["gradle", "-p", "native/android/core", "test", "--console=plain"],
    platform: "any",
    needs: "Gradle 8.14.3 and a JDK 17+ on PATH; no Android SDK",
    what: "the pure-Kotlin Assist core: fail-closed wire parsing, endpoint validation, the shared conformance vectors",
  },
  "desktop-core-tests": {
    argv: ["cargo", "test", "--manifest-path", "native/desktop/core/Cargo.toml"],
    platform: "any",
    needs: "a Rust toolchain (rust-version 1.74+)",
    what: "the Rust Assist core: the same rules as the Kotlin client, plus the shared conformance vectors",
  },
  "desktop-window-smoke": {
    argv: ["./scripts/mac/desktop-window-smoke.sh"],
    platform: "macos",
    needs: "a Rust toolchain, and Screen Recording permission for the terminal (the screenshot is mandatory: no PNG, no pass)",
    what: "builds the Tauri shell, launches it, asserts the process is still alive after ten seconds AND a screenshot was captured; the error-banner check is visual, from that screenshot",
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
  // against a real Fleet still recorded refused_missing_prerequisite because an
  // unrelated lane skipped. That made 2026-08-12-fleet-lab-real-source permanently
  // unresolvable on this Mac, even though its own notes said "Fleet is the one that
  // matters here; Wazuh/Keycloak/Traccar skipping is fine".
  //
  // The coarse status was not wrong — an unrun lane is genuinely not green. The
  // request simply had no way to name the lane it cared about. These are that way.
  // Each maps to the `--only` filter run-live-lanes.sh already supported: with the
  // other lanes filtered out nothing is skipped, so a lane that passes exits 0 and
  // records `passed` rather than being dragged to refused by an unrelated lane.
  //
  // WAZUH SELF-PROVISIONS TOO, since 2026-08-21. Four statements here said the
  // opposite — "run-live-lanes.sh never starts Wazuh for you", "the script refuses
  // to pull a ~2GB image for you", "this lane is NOT self-provisioning", and
  // "refuses (never passes) when WAZUH_URL is unset" — and two of them were the
  // `needs`/`what` STRINGS the runner prints to the operator, not just prose. The
  // never-start rule was true of the amd64-only 4.9.0 era; `scripts/run-live-lanes.sh`
  // has stood Wazuh up itself since the pin moved to 4.14.7
  // (`SG_IMAGE_WAZUH` in scripts/lib/container-engine.sh), which is native on both
  // architectures and up in seconds — see run-live-lanes.sh lines 21-23 and the
  // `if wanted edr` block that runs `$SG_ENGINE run -d --name sg-wazuh`. An operator
  // reading this file was told to go find a Wazuh server the lane would have
  // started for them.
  //
  // What is still true, and is why the lanes are NOT interchangeable: Wazuh's image
  // is ~2GB, so its FIRST run is minutes of pull where Fleet, Keycloak and Traccar
  // are seconds. And a lane whose API never answers is still reported skipped, never
  // passed.
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
  "live-glpi": {
    argv: ["./scripts/run-live-lanes.sh", "--only", "glpi"],
    platform: "any",
    needs: "a container engine; pulls glpi/glpi:11.0.8 + mariadb:11 on first run (the lane completes GLPI's CLI install and enables the REST API itself)",
    what: "the live ITSM source: GLPI 11 stood up and installed, its REST v1/v2 shapes discovered and a capture written",
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
    needs: "a running container engine; the script stands Wazuh up itself (pinned wazuh-manager:4.14.7, ~2GB on the FIRST pull), or WAZUH_URL pointing at one you already run",
    what: "the Wazuh EDR lane alone, against a real Wazuh; reported skipped — never passed — if the API does not answer",
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
