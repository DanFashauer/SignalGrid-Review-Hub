import { SignalGridCore } from "@workspace/signalgrid-core";

/**
 * Shared, process-wide product core, preloaded with the deterministic
 * public-safe demo seed. This backs the /v1 product surface WITHOUT a database:
 * the core is an in-memory, fixture-backed store, so the tenant/auth/policy/
 * decision/evidence/audit endpoints work out of the box for review. It carries
 * no real credentials, tenant data, or live vendor calls.
 */
export const core: SignalGridCore = SignalGridCore.demo();

/**
 * Mint a small, deterministic set of REAL decisions at boot so the console's
 * /v1 list/detail/evidence/audit views have something to show before anyone
 * presses Evaluate. These are not fixtures layered on top of the core — each
 * one runs the full decision loop (evidence → policy → snapshot → audit), so
 * everything downstream (digests, chains, reason codes) is engine-produced.
 * Deterministic because the demo core's clock is fixed; a restart reproduces
 * the same records.
 */
const DEMO_DECISION_SEEDS: ReadonlyArray<{ identityRef: string; deviceRef: string; workflowKey: string }> = [
  { identityRef: "nurse.compliant", deviceRef: "ipad-ward-01", workflowKey: "clinical-session" },
  { identityRef: "nurse.noncompliant", deviceRef: "ipad-ward-02", workflowKey: "clinical-session" },
  { identityRef: "nurse.stale", deviceRef: "ipad-ward-03", workflowKey: "clinical-session" },
  { identityRef: "tech.unmanaged", deviceRef: "ipad-byod-01", workflowKey: "clinical-session" },
  { identityRef: "nurse.disabled", deviceRef: "ipad-ward-04", workflowKey: "clinical-session" },
  { identityRef: "nurse.nosync", deviceRef: "ipad-ward-05", workflowKey: "clinical-session" },
];

const demoOperatorToken = core
  .demoApiKeys()
  .find((k) => k.role === "operator" && k.tenantId === "tenant_northwind")?.token;

if (demoOperatorToken) {
  for (const seed of DEMO_DECISION_SEEDS) {
    try {
      core.evaluate(demoOperatorToken, seed);
    } catch {
      // A missing seed subject must not stop the server from booting — the
      // console simply starts with fewer pre-minted decisions.
    }
  }
}

/**
 * The public-safe demo API keys, surfaced so the operator console and reviewers
 * can authenticate against the seeded tenants. These are obviously-fake tokens,
 * never real secrets.
 */
export const DEMO_KEYS = core.demoApiKeys().map((key) => ({
  tenant: key.tenantId,
  role: key.role,
  token: key.token,
  keyReference: key.keyReference,
}));
