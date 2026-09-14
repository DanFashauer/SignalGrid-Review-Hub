// The live connector sync runner — pure, injected, and fail-closed.
//
// It does NOT fetch, and it holds no timer. The core is compiled with NO node
// and NO dom types on purpose (see lib/signalgrid-core/tsconfig.json), so
// `AbortSignal`, `setTimeout` and `Date.now` are all simply unavailable here —
// which is exactly the property that keeps `scripts/safety-check.mjs` check 1
// and the determinism invariant true of this file by construction rather than by
// discipline. The clock stays injected; the posture read arrives as a function
// the PROCESS supplied (see `SignalGridCore.registerLiveConnector`).
//
// WHERE THE TIMEOUT LIVES, stated because its absence here looks like a gap: at
// the socket, in the source. The Fleet read this seam reuses already carries
// `AbortSignal.timeout(TIMEOUT_PRESETS.normal)` and `redirect: 'manual'`. A
// source that does not bound itself can hang a request — a hang is not a grant,
// but it is not acceptable either, so bounding is part of a source's contract
// and `proof:live-connector-sync` drives a never-answering server to prove the
// bound-and-fail-closed path end to end.
//
// The fail-closed arm is the default outcome, not the error path. On ANY
// rejection — connection refused, timeout, auth failure, malformed body — this
// writes ZERO signals, reports the run `partial`, and marks the connector
// `degraded`. No signal written means the evidence readers see the previous
// observedAt age out into `unverified`, which RAISES the assurance bar. It never
// synthesizes a healthy reading and it never returns `success`.
import type { MemoryStore } from "./store";
import type { Clock } from "./util";
import { deterministicId } from "./util";
import { applyPostureRecords, type FixturePostureRecord } from "./connector";
import type { Connector, ConnectorSyncRun } from "./types";

/** What a live source is told. `nowIso` comes from the CORE's injected clock, so
 *  a source never has to read a clock of its own to stamp what it observed. */
export interface LivePostureSourceContext {
  connectorId: string;
  tenantId: string;
  nowIso: string;
}

/**
 * A process-supplied read of a real posture system, normalized to the core's
 * record shape. Registered only by a process edge; no route can install one.
 *
 * CONTRACT: it must bound its own I/O and it must REJECT on any failure. A
 * source that returns `[]` where it meant "I could not read" turns an outage
 * into a clean sync of an empty fleet, which is the one shape this runner
 * cannot tell from the truth.
 */
export type LivePostureSource = (
  ctx: LivePostureSourceContext,
) => Promise<FixturePostureRecord[]>;

/**
 * The failure CLASS, and nothing else.
 *
 * The run note is persisted and shown; an error message from a transport can
 * carry the destination URL, a query string or a response body, and any of those
 * can carry a credential. So the note names a class derived here and never
 * echoes the message.
 */
export function classifyLiveFailure(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : String(err ?? "");
  if (name === "TimeoutError" || name === "AbortError") return "timeout";
  if (/\b(401|403)\b|unauthor|forbidden|invalid token|authentication/i.test(message)) {
    return "authentication_refused";
  }
  if (/ECONNREFUSED|ENOTFOUND|ECONNRESET|EHOSTUNREACH|fetch failed|socket hang up|network/i.test(message)) {
    return "unreachable";
  }
  if (/JSON|malformed|unexpected token|not an array|envelope|parse/i.test(message)) {
    return "malformed_response";
  }
  return "source_error";
}

/**
 * Read a live-mode connector's posture through its registered source and apply
 * it with the SAME normalizer the fixture path uses (`applyPostureRecords`), so
 * signal shape, freshness grading and the skip/partial accounting are shared,
 * not copied.
 */
export async function runLiveSync(
  store: MemoryStore,
  clock: Clock,
  connector: Connector,
  source: LivePostureSource,
): Promise<ConnectorSyncRun> {
  const startedAt = clock.now().toISOString();
  let records: FixturePostureRecord[];
  try {
    records = await source({
      connectorId: connector.id,
      tenantId: connector.tenantId,
      nowIso: startedAt,
    });
  } catch (err) {
    const failureClass = classifyLiveFailure(err);
    const completedAt = clock.now().toISOString();
    const run: ConnectorSyncRun = {
      id: deterministicId("sync", connector.id, startedAt),
      tenantId: connector.tenantId,
      connectorId: connector.id,
      startedAt,
      completedAt,
      status: "partial",
      recordsProcessed: 0,
      signalsNormalized: 0,
      note:
        `Live sync did not complete (${failureClass}). No signals were written, so the ` +
        "previously observed posture ages out into unverified rather than being replaced " +
        "by a reading nobody took.",
    };
    store.putSyncRun(run);
    store.putConnector({ ...connector, status: "degraded", lastSyncAt: completedAt });
    return run;
  }
  return applyPostureRecords(store, clock, connector, records);
}
