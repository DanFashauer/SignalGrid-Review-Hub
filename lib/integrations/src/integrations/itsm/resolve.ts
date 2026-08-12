// Live-call gate for the itsm emitter family.
//
// EMITTING IS AN ACTION. This family creates a ticket/incident in an ITSM system (ServiceNow, Jira, Zendesk, Freshservice, BMC Helix, Ivanti, ManageEngine, or a generic webhook) —
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
export type ItsmEmitPayload = Record<string, unknown>;

/** A live delivery transport. Deliberately NOT implemented in this repository. */
export type ItsmEmitTransport = (payload: ItsmEmitPayload) => Promise<void>;

/** One captured fixture emission. `delivered` is a literal false — the type
 *  cannot express a fixture record that claims it was sent. */
export interface ItsmFixtureRecord {
  readonly seq: number;
  readonly payload: ItsmEmitPayload;
  readonly delivered: false;
  readonly mode: "fixture";
}

/** Deterministic in-memory recorder — no network, no clock, no randomness. */
export class ItsmFixtureEmitter {
  private readonly log: ItsmFixtureRecord[] = [];
  record(payload: ItsmEmitPayload): ItsmFixtureRecord {
    const entry: ItsmFixtureRecord = { seq: this.log.length + 1, payload, delivered: false, mode: "fixture" };
    this.log.push(entry);
    return entry;
  }
  entries(): readonly ItsmFixtureRecord[] {
    return this.log;
  }
}

export type ItsmEmitterResolution =
  | { readonly mode: "fixture"; readonly reason: string; readonly emitter: ItsmFixtureEmitter }
  | { readonly mode: "live"; readonly deliver: ItsmEmitTransport };

/**
 * Decide whether this deployment may make a live itsm emission.
 * Fail-closed and unanimous; the transport must be INJECTED.
 */
export function resolveItsmEmitter(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: ItsmEmitTransport,
): ItsmEmitterResolution {
  const fixture = (reason: string): ItsmEmitterResolution => ({ mode: "fixture", reason, emitter: new ItsmFixtureEmitter() });
  const tier = (env["SIGNALGRID_TIER"] ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return fixture(`tier "${tier}" never makes live vendor calls`);
  }
  if (env["SIGNALGRID_LIVE_INTEGRATIONS"] !== "true") {
    return fixture("SIGNALGRID_LIVE_INTEGRATIONS is not 'true'");
  }
  if (!env["ITSM_EMITTER_TOKEN"]?.trim()) {
    return fixture("ITSM_EMITTER_TOKEN is not set");
  }
  if (!transportOverride) {
    return fixture("no itsm delivery transport is available — this repository ships none");
  }
  return { mode: "live", deliver: transportOverride };
}
