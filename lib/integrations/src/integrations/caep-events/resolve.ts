// Live-call gate for the CAEP / Shared Signals emitter family.
//
// EMITTING IS AN ACTION. This family transmits session-signal events (SETs)
// to cooperating applications — the outbound half the read-only dimensions
// deliberately do not have. It is gated exactly like every emitter in this
// repository: dev/alpha never emit; beta/prod may, but only with
// SIGNALGRID_LIVE_INTEGRATIONS=true AND a credential AND an INJECTED
// transport — and this repository ships none (signing a SET needs keys this
// public repository must not hold), so the live path's failure mode here is
// "there is no code".
//
// THE FIXTURE EMITTER NEVER CLAIMS DELIVERY. Every record it captures carries
// `delivered: false` and the mode that produced it — the same unrepresentable-
// lie shape as the other five families.

/** What this family emits, opaque at the gate: an UNSIGNED claims set built by
 *  ./format. The gate decides WHETHER anything may leave, not what it looks like. */
export type CaepEmitPayload = Record<string, unknown>;

/** A live delivery transport (sign + serialize + deliver). Deliberately NOT
 *  implemented in this repository. */
export type CaepEmitTransport = (payload: CaepEmitPayload) => Promise<void>;

/** One captured fixture emission. `delivered` is a literal false — the type
 *  cannot express a fixture record that claims it was sent. */
export interface CaepFixtureRecord {
  readonly seq: number;
  readonly payload: CaepEmitPayload;
  readonly delivered: false;
  readonly mode: "fixture";
}

/** Deterministic in-memory recorder — no network, no clock, no randomness. */
export class CaepFixtureEmitter {
  private readonly log: CaepFixtureRecord[] = [];
  record(payload: CaepEmitPayload): CaepFixtureRecord {
    const entry: CaepFixtureRecord = { seq: this.log.length + 1, payload, delivered: false, mode: "fixture" };
    this.log.push(entry);
    return entry;
  }
  entries(): readonly CaepFixtureRecord[] {
    return this.log;
  }
}

export type CaepEmitterResolution =
  | { readonly mode: "fixture"; readonly reason: string; readonly emitter: CaepFixtureEmitter }
  | { readonly mode: "live"; readonly deliver: CaepEmitTransport };

/**
 * Decide whether this deployment may make a live session-signal emission.
 * Fail-closed and unanimous; the transport must be INJECTED.
 */
export function resolveCaepEmitter(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: CaepEmitTransport,
): CaepEmitterResolution {
  const fixture = (reason: string): CaepEmitterResolution => ({ mode: "fixture", reason, emitter: new CaepFixtureEmitter() });
  const tier = (env["SIGNALGRID_TIER"] ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return fixture(`tier "${tier}" never makes live vendor calls`);
  }
  if (env["SIGNALGRID_LIVE_INTEGRATIONS"] !== "true") {
    return fixture("SIGNALGRID_LIVE_INTEGRATIONS is not 'true'");
  }
  if (!env["CAEP_EMITTER_TOKEN"]?.trim()) {
    return fixture("CAEP_EMITTER_TOKEN is not set");
  }
  if (!transportOverride) {
    return fixture("no session-signal delivery transport is available — this repository ships none");
  }
  return { mode: "live", deliver: transportOverride };
}
