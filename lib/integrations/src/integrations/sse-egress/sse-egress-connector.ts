// Read-only normalization + transport for the SSE-EGRESS connector.
//
// The source is the SSE's own device API — the service's already-evaluated view
// of its client on one device. Every operation is a read; there is no write
// path: SignalGrid routes no traffic, toggles no client, edits no bypass rule.
//
// Defensive normalization mirroring the challenge-capability connector: the
// bridge is an external system and may emit anything in any slot, so the
// normalizer — not the compiler — makes values safe. Own-property reads only;
// a report that asserts something unreadable is `malformed` and can never
// grade PROTECTED.

import {
  SSE_EGRESS_REPORT_KEYS,
  SseEgressConnectorError,
  type NormalizedSseEgress,
  type SseClientState,
  type SseEgressReportRaw,
  type SseReportIntegrity,
} from "./types";
import { createReadOnlyGuard } from "../../utils/guardReadOnly";

/** GET-only guard, mirroring the other connectors. */
export const guardReadOnly = createReadOnlyGuard(
  (method) => new SseEgressConnectorError("read_only_violation", `sse-egress is read-only; refused ${method}`),
);

/** Map a string to one of `allowed`, case-insensitively; anything else → fallback.
 *  An ALLOWLIST on purpose — an unrecognized value fails to the safe unknown. */
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof v !== "string") return fallback;
  const s = v.trim().toLowerCase();
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
}

/** Did the report ASSERT something here that we could not parse? `null` counts as absent. */
function enumMalformed(v: unknown, allowed: readonly string[]): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v !== "string") return true;
  return !allowed.includes(v.trim().toLowerCase());
}

/** Only an explicit boolean is trusted; null/undefined = not reported. */
function boolOrNull(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

/** Did the entry ASSERT a non-boolean in a boolean slot? `null` counts as absent. */
function boolMalformed(v: unknown): boolean {
  return v !== undefined && v !== null && typeof v !== "boolean";
}

/** Read a field ONLY if the object asserts it as an OWN property. */
function ownValue(o: object, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(o, key) ? (o as Record<string, unknown>)[key] : undefined;
}

function isPlainObject(v: unknown): v is object {
  return typeof v === "object" && v !== null && !Array.isArray(v) && v !== Object.prototype;
}

const MAX_PROTOTYPE_DEPTH = 64;

/** Does the object carry any key outside `known`? Walks the prototype chain even
 *  though value reads are own-only. */
function hasUnrecognizedKey(o: object, known: readonly string[]): boolean {
  try {
    let cur: object | null = o;
    for (let depth = 0; cur !== null && cur !== Object.prototype; depth += 1) {
      if (depth >= MAX_PROTOTYPE_DEPTH) return true;
      for (const k of Reflect.ownKeys(cur)) {
        if (depth > 0) return true;
        if (typeof k === "symbol") return true;
        if (!known.includes(k)) return true;
      }
      cur = Object.getPrototypeOf(cur) as object | null;
    }
    return false;
  } catch {
    return true;
  }
}

/** A trimmed non-empty string, or null. Never a fabricated placeholder. */
function textOf(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
}

const CLIENT_STATES = ["tunneled", "bypassed", "disabled", "not_installed", "unknown"] as const;

export interface SseNormalizeOptions {
  source?: string;
}

/** Normalize one egress report. A missing/errored field yields the fail-safe
 *  unknown, never a fabricated "tunneled". */
export function normalizeSseEgressReport(
  deviceId: string,
  report: SseEgressReportRaw,
  opts: SseNormalizeOptions = {},
): NormalizedSseEgress {
  const source = opts.source ?? "sse-egress-bridge";
  const plain = isPlainObject(report);
  const raw: Record<string, unknown> = {};
  let readThrew = false;
  try {
    if (plain) for (const k of SSE_EGRESS_REPORT_KEYS) raw[k] = ownValue(report, k);
  } catch {
    readThrew = true;
    for (const k of SSE_EGRESS_REPORT_KEYS) raw[k] = undefined;
  }

  const malformed =
    readThrew ||
    !plain ||
    enumMalformed(raw["client_state"], CLIENT_STATES) ||
    boolMalformed(raw["service_observing_traffic"]) ||
    boolMalformed(raw["bridge_reachable"]) ||
    hasUnrecognizedKey(report, SSE_EGRESS_REPORT_KEYS);
  const reportIntegrity: SseReportIntegrity = malformed ? "malformed" : "clean";

  return {
    sourceSystem: "sse-egress",
    deviceId,
    clientState: oneOf<SseClientState>(raw["client_state"], CLIENT_STATES, "unknown"),
    serviceObservingTraffic: boolOrNull(raw["service_observing_traffic"]),
    bridgeReachable: boolOrNull(raw["bridge_reachable"]),
    bridgeSource: textOf(raw["source_system"]),
    reportIntegrity,
    source,
  };
}

export interface SseEgressRequest {
  deviceId: string;
  token: string;
}

export type SseEgressTransport = (req: SseEgressRequest) => Promise<SseEgressReportRaw>;

export interface SseEgressConnectorConfig {
  accessToken: string;
  baseUrl: string;
  source?: string;
}

/** Read-only connector: fetches one device's egress standing and normalizes it. */
export class SseEgressConnector {
  constructor(
    private readonly config: SseEgressConnectorConfig,
    private readonly transport: SseEgressTransport,
  ) {}

  async fetchNormalized(deviceId: string, opts: SseNormalizeOptions = {}): Promise<NormalizedSseEgress> {
    guardReadOnly("GET");
    const raw = await this.transport({ deviceId, token: this.config.accessToken });
    return normalizeSseEgressReport(deviceId, raw, {
      ...opts,
      source: opts.source ?? this.config.source ?? "sse-egress-bridge",
    });
  }
}
