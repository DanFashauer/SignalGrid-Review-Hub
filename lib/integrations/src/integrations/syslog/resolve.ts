// Live-call gate for the syslog emitter family.
//
// EMITTING IS AN ACTION. This family transmits an RFC 5424 / CEF / LEEF formatted line to a collector —
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
export type SyslogEmitPayload = Record<string, unknown>;

/** A live delivery transport. Deliberately NOT implemented in this repository. */
export type SyslogEmitTransport = (payload: SyslogEmitPayload) => Promise<void>;

/** One captured fixture emission. `delivered` is a literal false — the type
 *  cannot express a fixture record that claims it was sent. */
export interface SyslogFixtureRecord {
  readonly seq: number;
  readonly payload: SyslogEmitPayload;
  readonly delivered: false;
  readonly mode: "fixture";
}

/** Deterministic in-memory recorder — no network, no clock, no randomness. */
export class SyslogFixtureEmitter {
  private readonly log: SyslogFixtureRecord[] = [];
  record(payload: SyslogEmitPayload): SyslogFixtureRecord {
    const entry: SyslogFixtureRecord = { seq: this.log.length + 1, payload, delivered: false, mode: "fixture" };
    this.log.push(entry);
    return entry;
  }
  entries(): readonly SyslogFixtureRecord[] {
    return this.log;
  }
}

export type SyslogEmitterResolution =
  | { readonly mode: "fixture"; readonly reason: string; readonly emitter: SyslogFixtureEmitter }
  | { readonly mode: "live"; readonly deliver: SyslogEmitTransport };

/**
 * Decide whether this deployment may make a live syslog emission.
 * Fail-closed and unanimous; the transport must be INJECTED.
 */
export function resolveSyslogEmitter(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: SyslogEmitTransport,
): SyslogEmitterResolution {
  const fixture = (reason: string): SyslogEmitterResolution => ({ mode: "fixture", reason, emitter: new SyslogFixtureEmitter() });
  const tier = (env["SIGNALGRID_TIER"] ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return fixture(`tier "${tier}" never makes live vendor calls`);
  }
  if (env["SIGNALGRID_LIVE_INTEGRATIONS"] !== "true") {
    return fixture("SIGNALGRID_LIVE_INTEGRATIONS is not 'true'");
  }
  if (!env["SYSLOG_EMITTER_TOKEN"]?.trim()) {
    return fixture("SYSLOG_EMITTER_TOKEN is not set");
  }
  if (!transportOverride) {
    return fixture("no syslog delivery transport is available — this repository ships none");
  }
  return { mode: "live", deliver: transportOverride };
}
