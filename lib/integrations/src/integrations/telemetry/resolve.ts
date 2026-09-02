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

export type TelemetryEmitPayload = EmitPayload;
export type TelemetryEmitTransport = EmitTransport<TelemetryEmitPayload>;
export type TelemetryFixtureRecord = FixtureRecord<TelemetryEmitPayload>;
export type TelemetryFixtureEmitter = FixtureEmitter<TelemetryEmitPayload>;
export type TelemetryEmitterResolution = EmitterResolution<TelemetryEmitPayload>;

/**
 * Decide whether this deployment may make a live telemetry emission.
 * Fail-closed and unanimous; the transport must be INJECTED.
 */
export const resolveTelemetryEmitter = createEmitterResolver<TelemetryEmitPayload>({
  tokenEnvVar: "TELEMETRY_EMITTER_TOKEN",
  noTransportReason: "no telemetry delivery transport is available — this repository ships none",
});
