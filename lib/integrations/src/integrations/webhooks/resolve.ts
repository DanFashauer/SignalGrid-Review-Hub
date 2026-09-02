// Live-call gate for the webhooks emitter family.
//
// EMITTING IS AN ACTION. This family delivers a signed outbound webhook to a subscriber endpoint —
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
export type WebhookEmitPayload = Record<string, unknown>;

/** A live delivery transport. Deliberately NOT implemented in this repository. */
export type WebhooksEmitTransport = (payload: WebhookEmitPayload) => Promise<void>;

/** One captured fixture emission. `delivered` is a literal false — the type
 *  cannot express a fixture record that claims it was sent. */
export interface WebhooksFixtureRecord {
  readonly seq: number;
  readonly payload: WebhookEmitPayload;
  readonly delivered: false;
  readonly mode: "fixture";
}

/** Deterministic in-memory recorder — no network, no clock, no randomness. */
export class WebhooksFixtureEmitter {
  private readonly log: WebhooksFixtureRecord[] = [];
  record(payload: WebhookEmitPayload): WebhooksFixtureRecord {
    const entry: WebhooksFixtureRecord = { seq: this.log.length + 1, payload, delivered: false, mode: "fixture" };
    this.log.push(entry);
    return entry;
  }
  entries(): readonly WebhooksFixtureRecord[] {
    return this.log;
  }
}

export type WebhooksEmitterResolution =
  | { readonly mode: "fixture"; readonly reason: string; readonly emitter: WebhooksFixtureEmitter }
  | { readonly mode: "live"; readonly deliver: WebhooksEmitTransport };

/**
 * Decide whether this deployment may make a live webhooks emission.
 * Fail-closed and unanimous; the transport must be INJECTED.
 */
export function resolveWebhooksEmitter(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: WebhooksEmitTransport,
): WebhooksEmitterResolution {
  const fixture = (reason: string): WebhooksEmitterResolution => ({ mode: "fixture", reason, emitter: new WebhooksFixtureEmitter() });
  const tier = (env["SIGNALGRID_TIER"] ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return fixture(`tier "${tier}" never makes live vendor calls`);
  }
  if (env["SIGNALGRID_LIVE_INTEGRATIONS"] !== "true") {
    return fixture("SIGNALGRID_LIVE_INTEGRATIONS is not 'true'");
  }
  if (!env["WEBHOOKS_EMITTER_TOKEN"]?.trim()) {
    return fixture("WEBHOOKS_EMITTER_TOKEN is not set");
  }
  if (!transportOverride) {
    return fixture("no webhooks delivery transport is available — this repository ships none");
  }
  return { mode: "live", deliver: transportOverride };
}
