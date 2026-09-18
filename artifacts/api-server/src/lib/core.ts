import { CoreError, SignalGridCore, type Clock, type EstateSpec } from "@workspace/signalgrid-core";
import { resolveGraphPostureConnector, toEstateSubjects } from "@workspace/integrations/graph";
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

/**
 * `SIGNALGRID_CORE` — which core this process serves.
 *
 *   - unset / "demo": the seeded public-safe demo core on a fixed clock (default,
 *     unchanged).
 *   - "estate": a core built around THIS deployment's tenant, with subjects and
 *     posture read at boot through the Graph posture connector —
 *     `resolveGraphPostureConnector` decides fixture vs live exactly as it does
 *     everywhere else (beta/prod + SIGNALGRID_LIVE_INTEGRATIONS=true + a read-only
 *     GRAPH_ACCESS_TOKEN, otherwise the committed fixture dataset, and the
 *     connector's recorded `mode` says which). Needs SIGNALGRID_ESTATE_TENANT (a
 *     slug) and SIGNALGRID_ESTATE_OWNER_TOKEN (≥24 chars, not a demo key);
 *     SIGNALGRID_ESTATE_OPERATOR_TOKEN is optional. Anything malformed REFUSES AT
 *     BOOT — a server that silently fell back to the demo core while claiming an
 *     estate would be the worst of both.
 *
 * The posture is read ONCE, here, before the socket opens; the core performs no
 * I/O afterwards. A refresh loop is a separate piece of work (BUILD_BACKLOG).
 */
function estateSpecFromEnv(): Omit<EstateSpec, "subjects" | "connector"> {
  const slug = (process.env["SIGNALGRID_ESTATE_TENANT"] ?? "").trim();
  if (!/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/.test(slug)) {
    throw new Error(
      `SIGNALGRID_CORE=estate needs SIGNALGRID_ESTATE_TENANT as a slug (lowercase letters, digits, hyphens; 3–40 chars), got "${slug}" — refusing to start.`,
    );
  }
  const principals: EstateSpec["principals"] = [];
  for (const [role, variable] of [
    ["owner", "SIGNALGRID_ESTATE_OWNER_TOKEN"],
    ["operator", "SIGNALGRID_ESTATE_OPERATOR_TOKEN"],
  ] as const) {
    const token = (process.env[variable] ?? "").trim();
    if (token === "" && role !== "owner") continue;
    if (token.length < 24 || token.startsWith("sgk_demo_")) {
      throw new Error(`${variable} must be at least 24 characters and not a demo key — refusing to start.`);
    }
    principals.push({ role, token, subjectId: `user_${slug}_${role}` });
  }
  return {
    tenant: { id: `tenant_${slug}`, slug, name: slug },
    principals,
  };
}

async function buildCore(): Promise<SignalGridCore> {
  const storeOptions = { maxDecisionsPerTenant: maxDecisionsPerTenantFromEnv() };
  const mode = (process.env["SIGNALGRID_CORE"] ?? "demo").trim().toLowerCase();
  if (mode === "demo") return SignalGridCore.demo(undefined, storeOptions);
  if (mode !== "estate") {
    throw new Error(`SIGNALGRID_CORE must be "demo" or "estate", got "${mode}" — refusing to start.`);
  }
  const base = estateSpecFromEnv();
  // Wall time is read HERE, at the boundary, and handed to the core as its clock;
  // nothing inside the decision path reads it.
  const clock: Clock = { now: () => new Date() };
  const resolution = resolveGraphPostureConnector(process.env);
  const signals = await resolution.connector.fetchPosture(clock.now().toISOString());
  const mapped = toEstateSubjects(signals);
  const sourceDescription =
    resolution.mode === "live" ? "Microsoft Graph (live, read-only)" : `the committed Graph fixture dataset (${resolution.reason})`;
  logger.info(
    { mode: resolution.mode, tenant: base.tenant.slug, subjects: mapped.subjects.length, skippedOwnerless: mapped.skippedOwnerless },
    "estate core: posture read at boot",
  );
  try {
    return SignalGridCore.fromEstate(
      clock,
      {
        ...base,
        subjects: mapped.subjects,
        connector: {
          mode: resolution.mode,
          sourceDescription,
          permissionScope: "User.Read.All, DeviceManagementManagedDevices.Read.All, IdentityRiskyUser.Read.All (read-only)",
          credentialRef: resolution.mode === "live" ? "env:GRAPH_ACCESS_TOKEN" : "fixture:no-credential",
        },
      },
      storeOptions,
    );
  } catch (err) {
    // The core's own refusals are the honest ones; surface them as boot failures.
    if (err instanceof CoreError) throw new Error(`estate core refused to build: ${err.message}`);
    throw err;
  }
}

export const core: SignalGridCore = await buildCore();

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

const demoOperatorToken = core.isDemo()
  ? core.demoApiKeys().find((k) => k.role === "operator" && k.tenantId === "tenant_northwind")?.token
  : undefined;

// SAY WHAT DID NOT HAPPEN. Not booting would be the wrong answer here — a missing
// seed subject must not stop the server — but the silent version of this loop made
// ALL SIX seeds failing, or the operator token being absent entirely, indistinguishable
// at runtime from a healthy boot. One line, after the loop, so an operator staring at
// an empty console learns why instead of guessing.
if (!core.isDemo()) {
  logger.info({ core: "estate" }, "boot seed: estate core, no demo decisions pre-minted");
} else if (demoOperatorToken) {
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
export const DEMO_KEYS = (core.isDemo() ? core.demoApiKeys() : []).map((key) => ({
  tenant: key.tenantId,
  role: key.role,
  token: key.token,
  keyReference: key.keyReference,
}));
