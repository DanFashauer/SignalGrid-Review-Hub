// The refusal an outbound emitter returns when it holds no signing secret.
//
// WHY IT IS ONE STRING IN ONE FILE. Three outbound paths sign a payload with an
// HMAC before POSTing it: webhooks/dispatch.ts, siem/webhook.ts and
// itsm/generic-webhook.ts. Only the first refused an absent secret. The other two
// wrote `if (secret) { ...sign... }` — so a missing secret SKIPPED the signature
// and the request went out unsigned, and siem/webhook.ts then returned status
// 'sent'. A receiver cannot tell such an event from anybody else's, which is the
// entire point of signing an audit forward.
//
// This module is deliberately NOT adapters/emit-gate.ts: `proof:emit-gate` asserts
// that no webhooks/ or caep-events/ module imports the emit gate (those families
// carry the policy in their own resolve.ts), and dispatch.ts needs this constant.
// A second tiny module is cheaper than weakening that assertion.
//
// `scripts/check-signing-unconditional.mjs` is the gate that keeps the shape:
// no signing branch in lib/integrations/src/integrations/** may be ENABLED by a
// truthiness test on a secret. `if (!secret) refuse` is the sanctioned form.

/** Exactly the wording webhooks/dispatch.ts has used since it was written. */
export const SIGNING_SECRET_MISSING = 'Webhook signing secret not configured';
