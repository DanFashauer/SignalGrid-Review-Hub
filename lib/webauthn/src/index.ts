// @workspace/webauthn — FIDO2/passkey registration + authentication and
// step-up-auth session enforcement, ported from the SignalGrid product build.
// NOTE: the attestation/assertion signature verification in server.ts is
// currently simplified (challenge/origin/replay + step-up lifecycle are real);
// the CBOR/signature crypto must be completed before production use.
// Redis-backed stores fall back to in-memory when REDIS_URL is unset.
export * as webauthn from "./webauthn/server";
export * as webauthnStore from "./webauthn/store";
export * as webauthnTypes from "./webauthn/types";
export * as stepUp from "./stepUpStore";
