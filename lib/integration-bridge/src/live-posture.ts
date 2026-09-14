// The DARK EDGE — the resolver a deployment uses to build a live posture source,
// and it writes no new transport.
//
// NOTHING IN THIS REPOSITORY CALLS IT. The api-server does not import this
// package (doing so would widen its boot-read environment surface from 29
// variables to 170 — see artifacts/api-server/src/lib/core.ts and DR-053), no
// seed calls it, and no script outside the proof does. The seam ships as a
// library: a live connector exists only where a deployment calls the core's
// registerLiveConnector with a source this resolver returned.
//
// resolveLivePostureSource() returns null unless EVERY one of these holds, read
// at call time from the process environment:
//
//   1. `resolveEmission(env, { name: "FLEETDM_API_TOKEN", ... })` resolves live
//      — the repo's existing three-condition gate: beta/prod tier AND
//      SIGNALGRID_LIVE_INTEGRATIONS === "true" AND the named credential is
//      present. Reused, not recopied.
//   2. `FLEETDM_BASE_URL` is set and `validateWebhookUrl(url, { live: true })`
//      returns valid — the existing SSRF guard. HTTPS required; loopback,
//      RFC1918, RFC6598 and link-local denied; deny by default. No new allowlist
//      is invented here.
//   3. `SIGNALGRID_LIVE_POSTURE_TENANT` names the tenant the connector belongs
//      to. There is no default: guessing a tenant is how a posture read lands in
//      the wrong one. It is the ONE new variable this seam introduces.
//
// (1) and (2) name the variables the TRANSPORT actually reads — `FleetDMAdapter`
// resolves its base URL and token from exactly these through
// `getFleetDMConfig()`. An earlier draft gated on a pair of new
// SIGNALGRID_LIVE_POSTURE_* names, which validated a URL nothing would ever
// fetch: the guard would have passed on one address while the adapter called
// another.
//
// WHAT IS NOT COVERED, stated rather than implied: `validateWebhookUrl` checks
// the LITERAL host. A public hostname whose DNS resolves to 169.254.169.254
// passes it and is stopped by nothing here. That residue is the guard's, it is
// documented at its source (adapters/url-guard.ts), and this file does not claim
// to close it.
//
// The read itself is the EXISTING gated Fleet read — `FleetDMAdapter.getHosts()`
// — which already sits behind resolveEmission, already carries
// AbortSignal.timeout(TIMEOUT_PRESETS.normal) and redirect: 'manual', and is
// already covered by check-ungated-fetch.mjs and check-connector-discipline.mjs.
// No new fetch call site, no new URL field, no new connector family. No write
// path, no actuation, no remediation, and nothing logged that carries the token.
import type {
  ConnectorKind,
  FixturePostureRecord,
  LivePostureSource,
} from "@workspace/signalgrid-core";
import { resolveEmission } from "@workspace/integrations/emit-gate";
import { validateWebhookUrl } from "@workspace/integrations/emit-gate/url-guard";
import { createReadOnlyGuard } from "@workspace/integrations/utils/guard-read-only";
import { FleetDMAdapter } from "@workspace/integrations/telemetry";
import { toHostReport } from "@workspace/fleet-connector";
import {
  deviceManagementEvidenceToFixtureRecord,
  fleetHostToDeviceManagementEvidence,
} from "./evidence";

/** What `SignalGridCore.registerLiveConnector` needs to mint a live connector. */
export interface LiveConnectorSpec {
  tenantId: string;
  id: string;
  kind: ConnectorKind;
  permissionScope: string;
  credentialRef: string;
  source: LivePostureSource;
}

/** Either the spec, or the REASON nothing was armed. Separate reasons, because a
 *  refusal that collapses three causes into one cannot be asserted. */
export type LivePostureResolution =
  | { spec: LiveConnectorSpec }
  | { refused: string };

export const LIVE_POSTURE_CONNECTOR_ID = "conn_live_posture_fleet";

/** A non-GET on this path is a typed throw, not a code-review catch. */
export class LivePostureMethodError extends Error {
  constructor(method: string) {
    super(`live posture source is read-only: ${method} is refused (GET only)`);
    this.name = "LivePostureMethodError";
  }
}
export const guardReadOnly = createReadOnlyGuard((m) => new LivePostureMethodError(m));

/** The full resolution, with the refusal reason. */
export function resolveLivePosture(env: NodeJS.ProcessEnv): LivePostureResolution {
  const emission = resolveEmission(env, {
    name: "FLEETDM_API_TOKEN",
    value: env["FLEETDM_API_TOKEN"],
  });
  if (emission.mode === "suppressed") return { refused: emission.reason };

  const url = env["FLEETDM_BASE_URL"];
  if (!url?.trim()) {
    return { refused: "FLEETDM_BASE_URL is absent — no destination to read" };
  }
  const destination = validateWebhookUrl(url, { live: true });
  if (!destination.valid) {
    return { refused: destination.error ?? "FLEETDM_BASE_URL was refused" };
  }

  const tenantId = env["SIGNALGRID_LIVE_POSTURE_TENANT"]?.trim();
  if (!tenantId) {
    return { refused: "SIGNALGRID_LIVE_POSTURE_TENANT is absent — a live connector must name its tenant" };
  }

  return {
    spec: {
      tenantId,
      id: LIVE_POSTURE_CONNECTOR_ID,
      // ConnectorKind is a closed union with no "fleet" member; the sync carrier
      // kind is cosmetic. Each record is source-tagged `fleet:host#…`.
      kind: "microsoft-entra-intune" satisfies ConnectorKind,
      permissionScope: "read-only device posture (Fleet GET /api/v1/fleet/hosts)",
      credentialRef: "env:FLEETDM_API_TOKEN",
      source: fleetPostureSource,
    },
  };
}

/**
 * DARK BY DEFAULT. Null unless every condition in the header holds. With no
 * configuration this is a no-op and the core is byte-identical to today.
 */
export function resolveLivePostureSource(env: NodeJS.ProcessEnv): LiveConnectorSpec | null {
  const resolved = resolveLivePosture(env);
  return "spec" in resolved ? resolved.spec : null;
}

/**
 * Fleet's own spellings for `mdm.enrollment_status`, and what each ANSWERS.
 * Anything else — absent, empty, "Pending", a version-skewed new value — answers
 * NOTHING, and a host that answers nothing about management is dropped.
 *
 * Why this guard is here and not left to `toHostReport`: that function derives
 * `mdmEnrolled` as `/^on/i.test(status)`, so an absent or unrecognised status
 * arrives as `false`, and `fleetHostToDeviceManagementEvidence` turns `false`
 * into the affirmative `"unmanaged"`. That is the unearned NEGATIVE
 * `deviceManagementEvidenceToFixtureRecord` refuses by name for the same field.
 * Changing `toHostReport` would move a value every other caller already grades
 * fail-safe, so the drop is applied at THIS boundary, where the record is minted.
 */
function managementAnswered(host: unknown): boolean {
  const status = (host as { mdm?: { enrollment_status?: unknown } } | null)?.mdm?.enrollment_status;
  if (typeof status !== "string") return false;
  return /^on\b/i.test(status.trim()) || /^off$/i.test(status.trim());
}

/**
 * Fleet hosts → core posture records, through the already-proven chain
 * `fleetHostToDeviceManagementEvidence` → `deviceManagementEvidenceToFixtureRecord`.
 * Exported so a proof drives the SAME mapper the live source uses rather than a
 * copy of it.
 *
 * Nothing Fleet does not answer is asserted: no identity at all (Fleet knows
 * devices, not people), and encryption only where the host reported it. The core
 * writes no signal for an absent field, and the evidence readers turn that
 * silence into unknown — which raises the assurance bar.
 */
export function fleetHostsToRecords(
  hosts: readonly unknown[],
  ctx: { tenantId: string; nowIso: string },
): FixturePostureRecord[] {
  const records: FixturePostureRecord[] = [];
  for (const host of hosts) {
    if (!managementAnswered(host)) continue; // unknown stays unknown
    try {
      const report = toHostReport(host as Record<string, unknown>);
      const evidence = fleetHostToDeviceManagementEvidence(report, ctx);
      records.push(
        deviceManagementEvidenceToFixtureRecord(evidence, {
          ...(report.diskEncryption === "unknown"
            ? {}
            : { encrypted: report.diskEncryption === "on" }),
        }),
      );
    } catch {
      // Any per-host mapping refusal (unknown management reaching the mapper):
      // dropped, never coerced.
    }
  }
  // A response that carried hosts but yielded NOTHING is a read that learned
  // nothing, and returning `[]` for it would land in the core as a clean sync of
  // an empty fleet — the exact shape connector.ts's skip accounting exists to
  // stop. Throwing puts it in runLiveSync's fail-closed arm instead.
  if (hosts.length > 0 && records.length === 0) {
    throw new Error(
      "every host in the response answered nothing this mapper could use; no posture was derived (malformed_response)",
    );
  }
  return records;
}

/** The live read. One adapter call, one mapper, no new transport. */
export const fleetPostureSource: LivePostureSource = async (ctx) => {
  guardReadOnly("GET");
  const adapter = new FleetDMAdapter();
  await adapter.initialize();
  if (!adapter.isEnabled()) {
    // The adapter's own gate said no. Throwing lands this in runLiveSync's
    // fail-closed arm (partial / degraded / zero signals) rather than returning
    // an empty list, which would read as a clean sync of an empty fleet.
    throw new Error("Fleet posture adapter is not enabled in this process");
  }
  const hosts = await adapter.getHosts();
  return fleetHostsToRecords(hosts, { tenantId: ctx.tenantId, nowIso: ctx.nowIso });
};
