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

/** What this family emits, opaque at the gate: an UNSIGNED claims set built by
 *  ./format. The gate decides WHETHER anything may leave, not what it looks like. */
export type CaepEmitPayload = EmitPayload;

/** A live delivery transport (sign + serialize + deliver). Deliberately NOT
 *  implemented in this repository. */
export type CaepEmitTransport = EmitTransport<CaepEmitPayload>;

export type CaepFixtureRecord = FixtureRecord<CaepEmitPayload>;
export type CaepFixtureEmitter = FixtureEmitter<CaepEmitPayload>;
export type CaepEmitterResolution = EmitterResolution<CaepEmitPayload>;

/**
 * Decide whether this deployment may make a live session-signal emission.
 * Fail-closed and unanimous; the transport must be INJECTED.
 */
export const resolveCaepEmitter = createEmitterResolver<CaepEmitPayload>({
  tokenEnvVar: "CAEP_EMITTER_TOKEN",
  noTransportReason: "no session-signal delivery transport is available — this repository ships none",
});
