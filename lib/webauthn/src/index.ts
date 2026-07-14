// @workspace/webauthn — FIDO2/passkey registration + authentication and
// step-up-auth session enforcement, ported from the SignalGrid product build.
// Assertion/attestation signatures are verified cryptographically (see
// ./webauthn/verify.ts): registration extracts the COSE public key (ES256/RS256)
// from the attestation object, and authentication verifies the authenticator
// signature over authenticatorData || SHA-256(clientDataJSON), plus rpIdHash,
// user-presence, and signature-counter clone detection. Everything fails closed
// (a proof lives at scripts proof:webauthn-verify). Redis-backed stores fall
// back to in-memory when REDIS_URL is unset.
export * as webauthn from "./webauthn/server";
export * as webauthnStore from "./webauthn/store";
export * as webauthnTypes from "./webauthn/types";
export * as stepUp from "./stepUpStore";
