import { CoreError, SignalGridCore, type Clock, type EstateSpec } from "@workspace/signalgrid-core";
import { resolveGraphPostureConnector, toEstateSubjects, type GraphPostureConnector } from "@workspace/integrations/graph";
import { readSecret, outboundSecret, secretInventory } from "@workspace/secrets";
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
 *   - unset / empty / "demo": the seeded public-safe demo core on a fixed clock (default,
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
 * The posture is read ONCE, here, before the socket opens. A scheduled RE-read is
 * `SIGNALGRID_ESTATE_REFRESH_SECONDS` below; the core itself still performs no I/O
 * either way — every read happens out here, at the boundary, and the records are
 * handed in.
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
    // Through the ONE read site (`@workspace/secrets`, DR-010). The accessor also
    // hands back the STAGED SUCCESSOR, and a deployment's own bearer is the credential
    // rotation matters most for: registering both as principals means the old key and
    // the new one are simultaneously valid for exactly as long as both variables are
    // set, so an integrator can move without a window of 401s. They get DIFFERENT
    // subject ids on purpose — the audit line then says which key was used, which is
    // the question somebody asks during a rotation.
    const reading = readSecret(variable);
    if (reading.presentButBlank) {
      throw new Error(`${variable} (or its _NEXT successor) is set but blank — refusing to start.`);
    }
    for (const [token, suffix] of [
      [reading.value, ""],
      [reading.next, "_next"],
    ] as const) {
      if (token === undefined) {
        // Only the OWNER is mandatory, and only in its current form.
        if (suffix === "" && role === "owner") {
          throw new Error(`${variable} must be set for SIGNALGRID_CORE=estate — refusing to start.`);
        }
        continue;
      }
      if (token.length < 24 || token.startsWith("sgk_demo_")) {
        throw new Error(
          `${variable}${suffix === "_next" ? "_NEXT" : ""} must be at least 24 characters and not a demo key — refusing to start.`,
        );
      }
      principals.push({ role, token, subjectId: `user_${slug}_${role}${suffix}` });
    }
  }
  return {
    tenant: { id: `tenant_${slug}`, slug, name: slug },
    principals,
  };
}

/**
 * `SIGNALGRID_ESTATE_REFRESH_SECONDS` — how often the estate core RE-READS posture.
 *
 * Unset/empty means no refresh loop: the boot read stands, which is the behaviour
 * before this knob existed. Anything else must be a positive integer and REFUSES AT
 * BOOT otherwise — a deploy that believed it was refreshing hourly and was not is the
 * silent failure this whole file is written against. A floor of 30s keeps a typo
 * (`5` meant as minutes) from hammering the source.
 */
export function estateRefreshSecondsFromEnv(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const raw = env["SIGNALGRID_ESTATE_REFRESH_SECONDS"];
  if (raw === undefined || raw.trim() === "") return undefined;
  const text = raw.trim();
  if (!/^\d+$/.test(text) || Number(text) < 30) {
    throw new Error(
      `SIGNALGRID_ESTATE_REFRESH_SECONDS must be an integer of at least 30 seconds, got "${raw}" — ` +
        "refusing to start rather than running with a refresh interval nobody meant.",
    );
  }
  return Number(text);
}

/** The boot read's clock and connector, RETURNED beside the core so the refresh loop
 *  reuses both. Returned rather than stashed in a module-level `let`: the boot read
 *  is an output of building the core, and the demo path has none by construction. */
interface EstateRead {
  clock: Clock;
  connector: GraphPostureConnector;
}

async function buildCore(): Promise<{ core: SignalGridCore; estate: EstateRead | null }> {
  const storeOptions = { maxDecisionsPerTenant: maxDecisionsPerTenantFromEnv() };
  // Unset AND empty both mean the default: the compose file passes every knob
  // through as `${SIGNALGRID_CORE:-}`, so an operator who never set it hands the
  // container "" — refusing that booted nothing at all (deploy-stack, 2026-09-18).
  // Anything else non-empty that is not a known mode still refuses.
  const mode = (process.env["SIGNALGRID_CORE"] ?? "").trim().toLowerCase() || "demo";
  if (mode === "demo") return { core: SignalGridCore.demo(undefined, storeOptions), estate: null };
  if (mode !== "estate") {
    throw new Error(`SIGNALGRID_CORE must be "demo" or "estate", got "${mode}" — refusing to start.`);
  }
  const base = estateSpecFromEnv();
  // Wall time is read HERE, at the boundary, and handed to the core as its clock;
  // nothing inside the decision path reads it.
  const clock: Clock = { now: () => new Date() };
  // The Graph token comes through the ONE read site too (DR-010). The resolver still
  // decides fixture-vs-live exactly as it does everywhere else; what changes is that
  // the credential is resolved in one place, blank-checked there, and appears in the
  // boot line as a fingerprint rather than not at all.
  const resolution = resolveGraphPostureConnector({
    ...process.env,
    GRAPH_ACCESS_TOKEN: outboundSecret("GRAPH_ACCESS_TOKEN"),
  });
  // Returned for the refresh loop: the SAME resolved connector and the SAME clock, so
  // a later pass reads from the source this process booted against rather than
  // re-resolving (and possibly re-deciding fixture-vs-live) behind the operator.
  const estate: EstateRead = { clock, connector: resolution.connector };
  const signals = await resolution.connector.fetchPosture(clock.now().toISOString());
  const mapped = toEstateSubjects(signals);
  const sourceDescription =
    resolution.mode === "live" ? "Microsoft Graph (live, read-only)" : `the committed Graph fixture dataset (${resolution.reason})`;
  logger.info(
    { mode: resolution.mode, tenant: base.tenant.slug, subjects: mapped.subjects.length, skippedOwnerless: mapped.skippedOwnerless },
    "estate core: posture read at boot",
  );
  try {
    const estateCore = SignalGridCore.fromEstate(
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
    return { core: estateCore, estate };
  } catch (err) {
    // The core's own refusals are the honest ones; surface them as boot failures.
    if (err instanceof CoreError) throw new Error(`estate core refused to build: ${err.message}`);
    throw err;
  }
}

/**
 * ONE boot line naming every registered secret's STATE — configured, rotating,
 * blank-but-set — by FINGERPRINT (8 hex characters of a SHA-256), never by value.
 *
 * It exists because the alternative is what this repo keeps finding: an operator
 * cannot tell a configured secret from an unconfigured one without testing it in
 * production, and cannot tell mid-rotation from finished at all. A fingerprint answers
 * both — two deployments holding the same credential print the same eight characters —
 * and answers nothing else. There is deliberately no accessor that returns the values
 * together, so there is nothing here that a wider log level could turn into a leak.
 */
logger.info({ secrets: secretInventory() }, "secrets: registered inventory at boot (fingerprints only, never values)");

const built = await buildCore();
export const core: SignalGridCore = built.core;

/**
 * The estate posture REFRESH loop.
 *
 * A server-side interval, started once at boot. Every pass reads posture again
 * through the SAME read-only connector the boot read used, maps it the same way,
 * and hands the records to `core.refreshEstatePosture` — which re-runs the identical
 * sync (same normalization, same skip-and-count rule) and writes one sync-run record
 * per pass, visible at `GET /v1/connectors/{id}/sync-runs`.
 *
 * WALL TIME IS READ HERE AND NOWHERE ELSE. The interval is a boundary concern; the
 * core is handed records and its own clock, exactly as at boot.
 *
 * NEVER IN DEMO MODE. The demo core is a fixed-clock fixture world with no estate
 * connector — refreshing it would mint sync runs that describe nothing. Setting the
 * knob on a demo core is a configuration error, and it refuses to start rather than
 * running a loop the operator believes exists.
 *
 * A failing pass is LOGGED AND THE LOOP CONTINUES: a Graph outage must not take the
 * server down, and the last good posture keeps deciding. It also does not silently
 * become "fresh" — the previous sync run's timestamp is what the console shows, so a
 * refresh that stopped working looks like a refresh that stopped working.
 */
const estateRefreshSeconds = estateRefreshSecondsFromEnv();
if (estateRefreshSeconds !== undefined && (core.isDemo() || built.estate === null)) {
  throw new Error(
    "SIGNALGRID_ESTATE_REFRESH_SECONDS is set but this process does not serve an estate core " +
      "(SIGNALGRID_CORE is not \"estate\") — refusing to start rather than reporting a refresh loop that would never run.",
  );
}
if (estateRefreshSeconds !== undefined && built.estate !== null) {
  const read = built.estate;
  const timer = setInterval(() => {
    void (async () => {
      try {
        const signals = await read.connector.fetchPosture(read.clock.now().toISOString());
        const mapped = toEstateSubjects(signals);
        const run = core.refreshEstatePosture(
          mapped.subjects.map((subject) => ({
            deviceRef: subject.device.externalRef,
            identityRef: subject.identity.externalRef,
            ...subject.posture,
          })),
        );
        logger.info(
          {
            run: run.id,
            status: run.status,
            recordsProcessed: run.recordsProcessed,
            signalsNormalized: run.signalsNormalized,
            skippedOwnerless: mapped.skippedOwnerless,
          },
          "estate core: posture refreshed",
        );
      } catch (err) {
        logger.error(
          { err: err instanceof Error ? err.message : String(err) },
          "estate core: posture refresh FAILED; the last good posture still decides and no sync run was recorded",
        );
      }
    })();
  }, estateRefreshSeconds * 1000);
  // The loop must never be the reason a process refuses to exit.
  timer.unref();
  logger.info({ intervalSeconds: estateRefreshSeconds }, "estate core: posture refresh loop started");
}

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
