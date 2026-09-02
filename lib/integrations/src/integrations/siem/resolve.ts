// Live-call gate for the siem emitter family.
//
// EMITTING IS AN ACTION. This family forwards a security event to a SIEM (Sentinel, Splunk, or a generic webhook) —
// the outbound half the read-only dimensions deliberately do not have. It is
// gated exactly like every connector in this repository: dev/alpha never emit;
// beta/prod may, but only with SIGNALGRID_LIVE_INTEGRATIONS=true AND a credential
// AND an INJECTED transport — and this repository ships none, so the live path's
// failure mode here is "there is no code".
//
// THE FIXTURE EMITTER NEVER CLAIMS DELIVERY. Every record it captures carries
// `delivered: false` and the mode that produced it — the same unrepresentable-
// lie shape as the other five families.

/** What this family emits, opaque at the gate. The vendor modules type their own
 *  payloads; the gate decides WHETHER anything may leave, not what it looks like. */
export type SiemEmitPayload = Record<string, unknown>;

/** A live delivery transport. Deliberately NOT implemented in this repository. */
export type SiemEmitTransport = (payload: SiemEmitPayload) => Promise<void>;

/** One captured fixture emission. `delivered` is a literal false — the type
 *  cannot express a fixture record that claims it was sent. */
export interface SiemFixtureRecord {
  readonly seq: number;
  readonly payload: SiemEmitPayload;
  readonly delivered: false;
  readonly mode: "fixture";
}

/** Deterministic in-memory recorder — no network, no clock, no randomness. */
export class SiemFixtureEmitter {
  private readonly log: SiemFixtureRecord[] = [];
  record(payload: SiemEmitPayload): SiemFixtureRecord {
    const entry: SiemFixtureRecord = { seq: this.log.length + 1, payload, delivered: false, mode: "fixture" };
    this.log.push(entry);
    return entry;
  }
  entries(): readonly SiemFixtureRecord[] {
    return this.log;
  }
}

export type SiemEmitterResolution =
  | { readonly mode: "fixture"; readonly reason: string; readonly emitter: SiemFixtureEmitter }
  | { readonly mode: "live"; readonly deliver: SiemEmitTransport };

/**
 * Decide whether this deployment may make a live siem emission.
 * Fail-closed and unanimous; the transport must be INJECTED.
 */
export function resolveSiemEmitter(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: SiemEmitTransport,
): SiemEmitterResolution {
  const fixture = (reason: string): SiemEmitterResolution => ({ mode: "fixture", reason, emitter: new SiemFixtureEmitter() });
  const tier = (env["SIGNALGRID_TIER"] ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return fixture(`tier "${tier}" never makes live vendor calls`);
  }
  if (env["SIGNALGRID_LIVE_INTEGRATIONS"] !== "true") {
    return fixture("SIGNALGRID_LIVE_INTEGRATIONS is not 'true'");
  }
  if (!env["SIEM_EMITTER_TOKEN"]?.trim()) {
    return fixture("SIEM_EMITTER_TOKEN is not set");
  }
  if (!transportOverride) {
    return fixture("no siem delivery transport is available — this repository ships none");
  }
  return { mode: "live", deliver: transportOverride };
}
