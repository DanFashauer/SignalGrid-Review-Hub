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

export type SyslogEmitPayload = EmitPayload;
export type SyslogEmitTransport = EmitTransport<SyslogEmitPayload>;
export type SyslogFixtureRecord = FixtureRecord<SyslogEmitPayload>;
export type SyslogFixtureEmitter = FixtureEmitter<SyslogEmitPayload>;
export type SyslogEmitterResolution = EmitterResolution<SyslogEmitPayload>;

/**
 * Decide whether this deployment may make a live syslog emission.
 * Fail-closed and unanimous; the transport must be INJECTED.
 */
export const resolveSyslogEmitter = createEmitterResolver<SyslogEmitPayload>({
  tokenEnvVar: "SYSLOG_EMITTER_TOKEN",
  noTransportReason: "no syslog delivery transport is available — this repository ships none",
});
