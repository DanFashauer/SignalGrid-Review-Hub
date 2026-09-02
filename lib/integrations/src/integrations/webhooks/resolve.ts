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
//
// The mechanical part of this (tier/flag/token/transport checks, the fixture
// recorder) is shared with the other five families via
// `../adapters/emitter-resolver` — Ponytail cut 4 folded six near-identical
// bodies into one factory. This file is the family's binding: its payload
// shape, its token env var, its fixture-reason text.

import {
  createEmitterResolver,
  type EmitPayload,
  type EmitTransport,
  type EmitterResolution,
  type FixtureEmitter,
  type FixtureRecord,
} from "../adapters/emitter-resolver";

export type WebhookEmitPayload = EmitPayload;
export type WebhooksEmitTransport = EmitTransport<WebhookEmitPayload>;
export type WebhooksFixtureRecord = FixtureRecord<WebhookEmitPayload>;
export type WebhooksFixtureEmitter = FixtureEmitter<WebhookEmitPayload>;
export type WebhooksEmitterResolution = EmitterResolution<WebhookEmitPayload>;

/**
 * Decide whether this deployment may make a live webhooks emission.
 * Fail-closed and unanimous; the transport must be INJECTED.
 */
export const resolveWebhooksEmitter = createEmitterResolver<WebhookEmitPayload>({
  tokenEnvVar: "WEBHOOKS_EMITTER_TOKEN",
  noTransportReason: "no webhooks delivery transport is available — this repository ships none",
});
