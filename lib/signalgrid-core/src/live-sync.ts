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
// `degraded`. It never synthesizes a healthy reading and it never returns
// `success`. In a store whose only posture source is this connector, a failed
// first read leaves no posture at all, and the evidence readers grade an absent
// category `missing` — which raises the assurance bar. `proof:live-connector-sync`
// drives that arm.
//
// WHAT IS NOT CLAIMED, because an earlier draft of this header claimed it: a
// reading ALREADY in the store does NOT age out when a later read fails. Posture
// freshness is graded ONCE, at sync time, against `record.lastSyncAt`, and stored
// as the `posture_freshness` signal's VALUE, which `buildEvidence` reads back
// verbatim — so a reading that graded `fresh` yesterday still reads `fresh`
// however long the connector has been degraded. Re-grading at read time against
// the evaluation clock is the fix and is an owner decision, not a comment: it
// moves every decision the core makes on every existing fixture (DR-053, "WHAT IS
// NOT CLOSED").
//
// This file IS inside the `CORE_NORMALIZATION_VERSION` import closure (named in
// ROOTS by scripts/generate-core-normalization-version.mjs), so inverting
// `partial` to `success` below cannot pass with the version gate green.
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

/** The classes a run note may name. Anything unrecognised is `source_error`. */
const FAILURE_CLASSES = new Set([
  "timeout",
  "unreachable",
  "authentication_refused",
  "malformed_response",
  "source_error",
]);

/** Socket-level codes Node reports on `err.cause.code` for a fetch that never
 *  reached an HTTP response. */
const UNREACHABLE_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
]);

/**
 * The failure CLASS, and nothing else.
 *
 * The run note is persisted and shown; an error message from a transport can
 * carry the destination URL, a query string or a response body, and any of those
 * can carry a credential. So the note names a class derived here and never
 * echoes the message.
 *
 * EVERY TEST BELOW IS A STRUCTURED FACT — the error's constructor name, the
 * socket code on `cause`, the HTTP status the transport carried, or a class the
 * source stated outright. None reads the message text. The previous version
 * matched substrings and was wrong in both directions: a 502 whose body quoted a
 * 403 read as `authentication_refused`. A classifier steerable by remote text is
 * being told its answer by the thing it is classifying.
 */
export function classifyLiveFailure(err: unknown): string {
  if (typeof err !== "object" || err === null) return "source_error";
  const e = err as {
    name?: unknown;
    status?: unknown;
    failureClass?: unknown;
    cause?: { code?: unknown } | null;
  };

  // A source that KNOWS its class says so. Honoured only if it names one of ours.
  if (typeof e.failureClass === "string" && FAILURE_CLASSES.has(e.failureClass)) {
    return e.failureClass;
  }
  // The constructor's own name: AbortSignal.timeout rejects with TimeoutError,
  // an aborted fetch with AbortError, and JSON.parse throws SyntaxError.
  if (e.name === "TimeoutError" || e.name === "AbortError") return "timeout";
  if (e.name === "SyntaxError") return "malformed_response";
  // The socket code the runtime attached — a fetch that never got a response.
  const code = e.cause?.code;
  if (typeof code === "string" && UNREACHABLE_CODES.has(code)) return "unreachable";
  // The HTTP status the transport carried as a property (fleetdm.ts attaches it
  // on every non-ok response). 401/403 are the auth pair; nothing else is guessed.
  if (typeof e.status === "number") {
    return e.status === 401 || e.status === 403 ? "authentication_refused" : "source_error";
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
        `Live sync did not complete (${failureClass}). No signals were written and the ` +
        "connector is degraded; nothing was replaced by a reading nobody took.",
    };
    store.putSyncRun(run);
    store.putConnector({ ...connector, status: "degraded", lastSyncAt: completedAt });
    return run;
  }
  return applyPostureRecords(store, clock, connector, records);
}
