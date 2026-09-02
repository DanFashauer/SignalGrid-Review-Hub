// Shared factory behind the six emitter families' resolve.ts (itsm, siem,
// syslog, telemetry, webhooks, caep-events).
//
// Ponytail cut 4 folded these: diffed byte-for-byte modulo family-specific
// names, they were one policy typed six times — tier check, LIVE_INTEGRATIONS
// check, token check, injected-transport check, in that order, fail-closed.
// See adapters/emit-gate.ts for the DIFFERENT shared gate the four vendor-
// adapter modules (siem/, syslog/, telemetry/, itsm/) call inline before an
// outbound request — this factory is the per-family resolve.ts policy all six
// families carry regardless of whether their adapters also call that gate.
//
// THE FIXTURE EMITTER NEVER CLAIMS DELIVERY. Every record it captures carries
// `delivered: false` and the mode that produced it — a fixture record cannot
// be typed to claim it was sent.
//
// Env is read at CALL TIME, not captured at module load, so it stays provable
// per call.

/** What a family emits, opaque at the gate. The vendor modules type their own
 *  payloads; the gate decides WHETHER anything may leave, not what it looks like. */
export type EmitPayload = Record<string, unknown>;

/** A live delivery transport. Deliberately NOT implemented in this repository. */
export type EmitTransport<P = EmitPayload> = (payload: P) => Promise<void>;

/** One captured fixture emission. `delivered` is a literal false — the type
 *  cannot express a fixture record that claims it was sent. */
export interface FixtureRecord<P = EmitPayload> {
  readonly seq: number;
  readonly payload: P;
  readonly delivered: false;
  readonly mode: "fixture";
}

/** Deterministic in-memory recorder — no network, no clock, no randomness. */
export class FixtureEmitter<P = EmitPayload> {
  private readonly log: FixtureRecord<P>[] = [];
  record(payload: P): FixtureRecord<P> {
    const entry: FixtureRecord<P> = { seq: this.log.length + 1, payload, delivered: false, mode: "fixture" };
    this.log.push(entry);
    return entry;
  }
  entries(): readonly FixtureRecord<P>[] {
    return this.log;
  }
}

export type EmitterResolution<P = EmitPayload> =
  | { readonly mode: "fixture"; readonly reason: string; readonly emitter: FixtureEmitter<P> }
  | { readonly mode: "live"; readonly deliver: EmitTransport<P> };

export interface EmitterFamilyConfig {
  /** e.g. "ITSM_EMITTER_TOKEN" */
  readonly tokenEnvVar: string;
  /** The fixture reason when tier/flag/token all pass but no transport was injected. */
  readonly noTransportReason: string;
}

/**
 * Build one family's resolveXEmitter(). Fail-closed and unanimous; the
 * transport must be INJECTED.
 */
export function createEmitterResolver<P = EmitPayload>(
  config: EmitterFamilyConfig,
): (env?: NodeJS.ProcessEnv, transportOverride?: EmitTransport<P>) => EmitterResolution<P> {
  return (env: NodeJS.ProcessEnv = process.env, transportOverride?: EmitTransport<P>): EmitterResolution<P> => {
    const fixture = (reason: string): EmitterResolution<P> => ({ mode: "fixture", reason, emitter: new FixtureEmitter<P>() });
    const tier = (env["SIGNALGRID_TIER"] ?? "dev").toLowerCase();
    if (tier !== "beta" && tier !== "prod") {
      return fixture(`tier "${tier}" never makes live vendor calls`);
    }
    if (env["SIGNALGRID_LIVE_INTEGRATIONS"] !== "true") {
      return fixture("SIGNALGRID_LIVE_INTEGRATIONS is not 'true'");
    }
    if (!env[config.tokenEnvVar]?.trim()) {
      return fixture(`${config.tokenEnvVar} is not set`);
    }
    if (!transportOverride) {
      return fixture(config.noTransportReason);
    }
    return { mode: "live", deliver: transportOverride };
  };
}
