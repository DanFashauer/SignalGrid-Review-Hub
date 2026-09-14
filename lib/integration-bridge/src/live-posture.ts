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
// TWO GATES, IN TWO PLACES, BECAUSE THEY ANSWER DIFFERENT QUESTIONS.
//
//   ARM TIME — `resolveLivePosture(env)` returns a spec only if the repo's
//   existing `resolveEmission` gate resolves live (beta/prod tier AND
//   SIGNALGRID_LIVE_INTEGRATIONS === "true" AND FLEETDM_API_TOKEN present) and
//   SIGNALGRID_LIVE_POSTURE_TENANT names the tenant. No default tenant: guessing
//   one is how a posture read lands in the wrong one. It is the ONE new variable.
//
//   READ TIME — the destination is validated in `fleetPostureSource`, against the
//   config object then handed to the adapter, so the address checked IS the
//   address fetched. It is deliberately NOT checked at arm time: an earlier draft
//   validated `env["FLEETDM_BASE_URL"]` while the adapter resolved its own base
//   URL from `process.env.FLEETDM_BASE_URL ?? telemetryConfig.fleetdm.baseUrl` —
//   a different read of a possibly different value. The guard passed on one
//   address while the fetch went to another. A guard on a URL the transport never
//   reads is worse than no guard, because it gets quoted as one.
//
// WHAT THE DESTINATION GUARD DOES NOT COVER — all three reachable today:
//   • It checks the LITERAL host, so a public name resolving to 169.254.169.254
//     passes (the guard's own residue, documented at adapters/url-guard.ts).
//   • An IPv4-mapped IPv6 literal (`https://[::ffff:127.0.0.1]`) also passes; the
//     fix is on a separate branch (PR #727) and is NOT on this one.
//   • `OPERATOR_URL_FIELDS` still classifies `telemetry.baseUrl` REPORTED, not
//     GATED. This seam gates the destination for ITSELF and changes nothing for
//     any other Fleet read.
//
// The read itself is the EXISTING gated Fleet read — `FleetDMAdapter.getHosts()`
// — already behind resolveEmission, already carrying
// AbortSignal.timeout(TIMEOUT_PRESETS.normal) and redirect: 'manual', already
// covered by check-ungated-fetch.mjs and check-connector-discipline.mjs. No new
// fetch call site, no new URL field, no new connector family. No write path, no
// actuation, no remediation, nothing logged that carries the token.
//
// READ-ONLY is a property of WHAT IS CALLED, not of a guard: the only outbound
// call here is `getHosts()`, a GET. The adapter's one non-GET (`runQuery`, which
// POSTs osquery SQL) is not called here and additionally requires
// SIGNALGRID_ALLOW_LIVE_QUERY=true. An earlier draft wrapped the read in
// `guardReadOnly("GET")` — a string literal, so it could never throw. Deleted
// rather than dressed up: a guard that cannot fire reads in review as if it does.
import type {
  ConnectorKind,
  FixturePostureRecord,
  LivePostureSource,
} from "@workspace/signalgrid-core";
import { boundedText } from "@workspace/integrations/emit-gate/bounded-text";
import { resolveEmission } from "@workspace/integrations/emit-gate";
import { validateWebhookUrl } from "@workspace/integrations/emit-gate/url-guard";
import { FleetDMAdapter, getFleetDMConfig } from "@workspace/integrations/telemetry";
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

/** The full resolution, with the refusal reason. */
export function resolveLivePosture(env: NodeJS.ProcessEnv): LivePostureResolution {
  const emission = resolveEmission(env, {
    name: "FLEETDM_API_TOKEN",
    value: env["FLEETDM_API_TOKEN"],
  });
  if (emission.mode === "suppressed") return { refused: emission.reason };

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
 * DARK BY DEFAULT. Null unless every arm-time condition in the header holds, and
 * the destination is then checked at read time. With no configuration nothing is
 * armed: no live connector exists, `signalSource()` stays "fixtures", and zero
 * outbound calls are made.
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
 * writes no signal for an absent field.
 *
 * Remote strings are BOUNDED here, at the boundary where they enter the core.
 * `toHostReport` interpolates `raw.id` straight into `fleet:host#…` and takes
 * `raw.uuid` as the host reference, both unbounded; the reference is then copied
 * onto every signal the record produces, so a multi-megabyte `id` from a hostile
 * or broken server would be persisted once per signal per host.
 */
export function fleetHostsToRecords(
  hosts: readonly unknown[],
  ctx: { tenantId: string; nowIso: string },
): FixturePostureRecord[] {
  const records: FixturePostureRecord[] = [];
  for (const host of hosts) {
    if (!managementAnswered(host)) continue; // unknown stays unknown
    try {
      const raw = toHostReport(host as Record<string, unknown>);
      const report = {
        ...raw,
        hostRef: boundedText(raw.hostRef),
        // `sourceReference` is optional on the report; spread it back only when
        // it was there, so an absent one stays absent rather than becoming "".
        ...(raw.sourceReference === undefined
          ? {}
          : { sourceReference: boundedText(raw.sourceReference) }),
      };
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
  // NO RECORDS IS AN UNKNOWN, NOT A HEALTHY ZERO — and that holds whether the
  // response carried hosts this mapper could not use or carried none at all.
  // `{"hosts": []}` is what a revoked token scoped to nothing, a wrong team
  // filter, and an emptied Fleet all return with a 200; returning `[]` for it
  // would land in the core as a clean sync of an empty fleet, report `success`
  // and mark the connector `healthy`. Throwing puts it in runLiveSync's
  // fail-closed arm instead. A deployment that genuinely runs an empty Fleet
  // reads `partial`/`degraded`, which is the correct direction to be wrong in.
  if (records.length === 0) {
    throw Object.assign(
      new Error(
        "no posture was derived from the response: it carried " +
          `${hosts.length} host(s) and none answered anything this mapper could use`,
      ),
      // The class is STATED, not left for a classifier to infer from this text.
      { failureClass: "malformed_response" },
    );
  }
  return records;
}

/** The live read. One adapter call, one mapper, no new transport. */
export const fleetPostureSource: LivePostureSource = async (ctx) => {
  // Resolve ONCE, check the destination, then hand the SAME object to the
  // adapter. See the header: resolving twice would let the checked address and
  // the fetched address differ.
  const config = await getFleetDMConfig();
  const destination = validateWebhookUrl(config?.baseUrl ?? "", { live: true });
  if (!destination.valid) {
    // The refusal names the RULE, never the address: this string reaches a
    // persisted sync-run note.
    throw new Error(`live posture destination refused: ${destination.error}`);
  }

  const adapter = new FleetDMAdapter();
  await adapter.initialize(config);
  if (!adapter.isEnabled()) {
    // The adapter's own gate said no. Throwing lands this in runLiveSync's
    // fail-closed arm (partial / degraded / zero signals) rather than returning
    // an empty list, which would read as a clean sync of an empty fleet.
    throw new Error("Fleet posture adapter is not enabled in this process");
  }
  const hosts = await adapter.getHosts();
  return fleetHostsToRecords(hosts, { tenantId: ctx.tenantId, nowIso: ctx.nowIso });
};
