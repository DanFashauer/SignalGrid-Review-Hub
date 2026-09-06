import { SignalGridCore } from "@workspace/signalgrid-core";
import { logger } from "./logger";

/**
 * Shared, process-wide product core, preloaded with the deterministic
 * public-safe demo seed. This backs the /v1 product surface WITHOUT a database:
 * the core is an in-memory, fixture-backed store, so the tenant/auth/policy/
 * decision/evidence/audit endpoints work out of the box for review. It carries
 * no real credentials, tenant data, or live vendor calls.
 */
/**
 * `SIGNALGRID_MAX_DECISIONS_PER_TENANT` — the in-memory per-tenant decision cap.
 * Exists so the FIFO bound and the `/v1/metrics` window are testable in five
 * evaluates, not five thousand. REFUSES AT BOOT on anything that is not a positive
 * integer; unset/empty means "use the default" and is the only value that falls through.
 */
function maxDecisionsPerTenantFromEnv(): number | undefined {
  const raw = process.env["SIGNALGRID_MAX_DECISIONS_PER_TENANT"];
  if (raw === undefined || raw.trim() === "") return undefined;
  const text = raw.trim();
  // Digits only: Number("1e4"), Number(" 3 ") and Number("0x10") all coerce to
  // something plausible, and a retention cap silently reinterpreted is the defect.
  if (!/^\d+$/.test(text) || Number(text) < 1) {
    throw new Error(
      `SIGNALGRID_MAX_DECISIONS_PER_TENANT must be a positive integer, got "${raw}" — ` +
        "refusing to start rather than silently using the default cap.",
    );
  }
  return Number(text);
}

export const core: SignalGridCore = SignalGridCore.demo(undefined, {
  maxDecisionsPerTenant: maxDecisionsPerTenantFromEnv(),
});

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

// SAY WHAT DID NOT HAPPEN. Not booting would be the wrong answer here — a missing
// seed subject must not stop the server — but the silent version of this loop made
// ALL SIX seeds failing, or the operator token being absent entirely, indistinguishable
// at runtime from a healthy boot. One line, after the loop, so an operator staring at
// an empty console learns why instead of guessing.
if (demoOperatorToken) {
  let failed = 0;
  for (const seed of DEMO_DECISION_SEEDS) {
    try {
      core.evaluate(demoOperatorToken, seed);
    } catch {
      // A missing seed subject must not stop the server from booting — the
      // console simply starts with fewer pre-minted decisions.
      failed += 1;
    }
  }
  const total = DEMO_DECISION_SEEDS.length;
  const minted = total - failed;
  // The healthy boot logs too, at info. Warning only on failure would leave the
  // ABSENCE of a line carrying the meaning, and an absence is exactly what the
  // silent version of this loop already proved nobody notices — it is also what
  // test/api.test.mjs reads to prove the counting happens at all.
  if (failed > 0) {
    logger.warn(
      { minted, failed, total },
      "boot seed: some demo decisions could not be minted; the console starts with fewer pre-minted decisions",
    );
  } else {
    logger.info({ minted, failed, total }, "boot seed: demo decisions minted");
  }
} else {
  logger.warn(
    { minted: 0, failed: 0, total: DEMO_DECISION_SEEDS.length, tenant: "tenant_northwind", role: "operator" },
    "boot seed: no demo operator key found, so NO decisions were pre-minted; the console starts empty",
  );
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
