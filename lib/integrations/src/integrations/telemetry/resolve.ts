// Live-call gate for the telemetry emitter family.
//
// EMITTING IS AN ACTION. This family emits an operational telemetry record to a fleet/telemetry backend —
// the outbound half the read-only dimensions deliberately do not have. It is
// gated exactly like every connector in this repository: dev/alpha never emit;
// beta/prod may, but only with SIGNALGRID_LIVE_INTEGRATIONS=true AND a credential
// AND an INJECTED transport — and this repository ships none, so the live path's
// failure mode here is "there is no code".
//
// THE FIXTURE EMITTER NEVER CLAIMS DELIVERY. Every record it captures carries
// `delivered: false` and the mode that produced it. The syslog family once
// returned status:'sent' for events it had silently dropped — the exact
// unearned affirmative this fabric exists to withdraw — and this surface is
// shaped so that lie is unrepresentable: there is no field a fixture record
// could set that reads as a completed send.

/** What this family emits, opaque at the gate. The vendor modules type their own
 *  payloads; the gate decides WHETHER anything may leave, not what it looks like. */
export type TelemetryEmitPayload = Record<string, unknown>;

/** A live delivery transport. Deliberately NOT implemented in this repository. */
export type TelemetryEmitTransport = (payload: TelemetryEmitPayload) => Promise<void>;

/** One captured fixture emission. `delivered` is a literal false — the type
 *  cannot express a fixture record that claims it was sent. */
export interface TelemetryFixtureRecord {
  readonly seq: number;
  readonly payload: TelemetryEmitPayload;
  readonly delivered: false;
  readonly mode: "fixture";
}

/** Deterministic in-memory recorder — no network, no clock, no randomness. */
export class TelemetryFixtureEmitter {
  private readonly log: TelemetryFixtureRecord[] = [];
  record(payload: TelemetryEmitPayload): TelemetryFixtureRecord {
    const entry: TelemetryFixtureRecord = { seq: this.log.length + 1, payload, delivered: false, mode: "fixture" };
    this.log.push(entry);
    return entry;
  }
  entries(): readonly TelemetryFixtureRecord[] {
    return this.log;
  }
}

export type TelemetryEmitterResolution =
  | { readonly mode: "fixture"; readonly reason: string; readonly emitter: TelemetryFixtureEmitter }
  | { readonly mode: "live"; readonly deliver: TelemetryEmitTransport };

/**
 * Decide whether this deployment may make a live telemetry emission.
 * Fail-closed and unanimous; the transport must be INJECTED.
 */
export function resolveTelemetryEmitter(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: TelemetryEmitTransport,
): TelemetryEmitterResolution {
  const fixture = (reason: string): TelemetryEmitterResolution => ({ mode: "fixture", reason, emitter: new TelemetryFixtureEmitter() });
  const tier = (env["SIGNALGRID_TIER"] ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return fixture(`tier "${tier}" never makes live vendor calls`);
  }
  if (env["SIGNALGRID_LIVE_INTEGRATIONS"] !== "true") {
    return fixture("SIGNALGRID_LIVE_INTEGRATIONS is not 'true'");
  }
  if (!env["TELEMETRY_EMITTER_TOKEN"]?.trim()) {
    return fixture("TELEMETRY_EMITTER_TOKEN is not set");
  }
  if (!transportOverride) {
    return fixture("no telemetry delivery transport is available — this repository ships none");
  }
  return { mode: "live", deliver: transportOverride };
}
