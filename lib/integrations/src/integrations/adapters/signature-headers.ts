/**
 * Every signature header this repository can put on the wire, and its scheme.
 *
 * WHY A REGISTRY. Three outbound paths signed a payload and TWO SCHEMES existed
 * without anybody deciding there should be two: `webhooks/dispatch.ts` used v2
 * (HMAC over `${timestampMs}.${body}`, the timestamp inside the MAC), while
 * `siem/webhook.ts` and `itsm/generic-webhook.ts` sent `X-Signature` over the BODY
 * ALONE plus an `X-Signing-Algorithm` header and no timestamp at all — the exact
 * shape `webhooks/sign.ts` documents as replayable and its own verifier refuses by
 * name. The second scheme was not a decision; it was two files that had not been
 * read together.
 *
 * Both now emit v2. This registry exists so a THIRD scheme cannot appear unnamed:
 * assertion 4 of `scripts/check-emitter-wire-discipline.mjs` asserts that the set of signature
 * headers assigned anywhere in `lib/integrations/src/integrations/**` is exactly
 * the set declared here, and that every declared header is actually emitted. A
 * header added to a file without an entry here fails; an entry here that nothing
 * emits fails too, because a registry describing a header nobody sends is a fossil.
 */

/** A signature-bearing header, and what a receiver must do with it. */
export interface SignatureHeaderSpec {
  /** The header name, exactly as it goes on the wire. */
  readonly header: string;
  /** The scheme marker carried in the value, or null when the value is bare. */
  readonly scheme: string | null;
  /** What the MAC covers — the sentence a receiver implements. */
  readonly covers: string;
}

/**
 * THE ONLY SIGNATURE SCHEME. Adding a second one is a decision, and this constant
 * is where it gets made — not a header assignment in one adapter.
 */
export const SIGNATURE_HEADERS: readonly SignatureHeaderSpec[] = [
  {
    header: 'X-Webhook-Signature',
    scheme: 'v2',
    covers: 'HMAC-SHA256 over `${X-Webhook-Timestamp}.${rawBody}`, lowercase hex, per-endpoint secret',
  },
  {
    header: 'X-Webhook-Timestamp',
    scheme: null,
    covers: 'integer epoch MILLISECONDS, UTC — inside the MAC above, compared as the exact ASCII digits received',
  },
];

/**
 * Headers a signing path must NOT emit, with the reason, so the gate can name it.
 *
 * `X-Signature` was the v1 body-only signature and `X-Signing-Algorithm` announced
 * the primitive beside it. A receiver holding both learns the algorithm and gets no
 * replay protection: the captured body re-POSTs and verifies forever.
 */
export const RETIRED_SIGNATURE_HEADERS: readonly { header: string; reason: string }[] = [
  { header: 'X-Signature', reason: 'v1 body-only HMAC — replayable, superseded by X-Webhook-Signature: v2=' },
  { header: 'X-Signing-Algorithm', reason: 'announced the v1 primitive; v2 fixes the algorithm in the scheme marker' },
];
