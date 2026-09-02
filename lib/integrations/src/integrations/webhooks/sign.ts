/**
 * Webhook Signing — scheme v2
 *
 * HMAC-SHA256 over `${timestampMs}.${body}`, per-endpoint secret.
 *
 * WHY THE SCHEME MOVED. v1 signed the BODY ALONE and shipped
 * `X-Webhook-Timestamp: Date.now()` outside the signed material. A receiver that
 * built a replay window on that header bought nothing: a replayer re-POSTs the
 * captured body byte-for-byte, rewrites the timestamp header to "now", and the
 * v1 signature still verifies — the header it was checked against was never
 * covered by the MAC.
 *
 * MEASURED, not reasoned. Three retries of one delivery, driven through dispatch
 * with a record-and-throw fetch spy, 2026-09-02:
 *
 *   v1 (this file at e66da87): attempts=3 distinctSignatures=1 distinctTimestamps=2
 *                              stamps=1788356307736,1788356307742
 *   v2 (this file now):        attempts=3 distinctSignatures=1 distinctTimestamps=1
 *
 * One signature spanning two timestamps IS the proof the header was outside the
 * MAC: had it been covered, a moving stamp would have moved the signature.
 *
 * v2 (Stripe-shaped) puts the timestamp INSIDE the MAC. The receiver
 * reconstructs the identical string from the header and the raw body:
 *
 *     signedMaterial = `${X-Webhook-Timestamp}.${rawBody}`
 *     expected       = HMAC-SHA256(signedMaterial, secret)  // lowercase hex
 *     X-Webhook-Signature: v2=<expected>
 *
 * so altering the timestamp by one unit invalidates the signature, and a stale
 * timestamp can no longer be laundered into a fresh one.
 *
 * UNIT: `X-Webhook-Timestamp` is an integer count of MILLISECONDS since the Unix
 * epoch, UTC (e.g. `1756771200000`). Not seconds. The header value must be
 * compared and re-signed as the exact ASCII digits received — never reformatted.
 *
 * NO DUAL-ACCEPT. `verifySignedWebhook` refuses an unprefixed (v1) signature. A
 * verifier that accepted both would leave every receiver on the scheme with no
 * replay protection while reporting success, which is the defect this change
 * exists to close.
 *
 * WHEN THE TIMESTAMP IS MINTED — once per DELIVERY, not per ATTEMPT. The retry
 * loop calls `createSignedHeaders` once per attempt, so a per-call clock read
 * would give one delivery id MORE THAN ONE signature — falsified here on
 * 2026-09-02 by forcing a per-call `Date.now()`, which produced 2 distinct
 * signatures across 3 attempts (2, not 3, because two attempts landed inside the
 * same millisecond — which is itself why this must be structural and not a
 * timing hope). A strict receiver reads a second signature for a delivery id it
 * has already seen as forgery. The timestamp
 * is therefore DERIVED from the payload's own `timestamp` field, which
 * `buildPayload` mints once above the retry loop. Resolution order:
 *
 *   1. an explicit `options.timestampMs` (integer ms) if the caller threads one;
 *   2. otherwise the payload's own ISO-8601 `timestamp` — the dispatch path, always;
 *   3. otherwise REFUSE — `WebhookTimestampUnresolvable`.
 *
 * THIS MODULE READS NO CLOCK. (3) was `Date.now()` until 2026-09-02 and that was a
 * hole the same shape as the defect above: a payload with an unreadable
 * `timestamp` minted a fresh instant per CALL, and this function is called once
 * per ATTEMPT, so retries diverged again. Falsified before the arm was removed —
 * replacing it with a constant still passed 164/164, i.e. nothing was watching it.
 * Now it is gated: `proof:webhooks` drives an unreadable instant and asserts the
 * refusal BY NAME, and asserts the header on the wire equals the payload's own
 * `Date.parse(timestamp)`.
 */

import crypto from 'crypto';
import { ageMs } from '../../utils/freshness';

/** The scheme marker carried by `X-Webhook-Signature` (`v2=<hex>`). */
export const WEBHOOK_SIGNATURE_SCHEME = 'v2';

/** Header names, exported so a receiver and this module cannot drift apart. */
export const WEBHOOK_SIGNATURE_HEADER = 'X-Webhook-Signature';
export const WEBHOOK_TIMESTAMP_HEADER = 'X-Webhook-Timestamp';

/**
 * Sign an arbitrary string using HMAC-SHA256.
 *
 * This is the PRIMITIVE, not the scheme: it signs exactly the bytes it is given.
 * For webhook delivery, feed it `signedMaterial(timestampMs, body)` — signing a
 * bare body is v1 and is no longer accepted by any verifier here.
 */
export function signPayload(
  payload: string,
  secret: string
): string {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload, 'utf8');
  return hmac.digest('hex');
}

/**
 * The exact string covered by the MAC: `${timestampMs}.${body}`.
 *
 * ONE definition, used by both the signer and the verifier in this file, so the
 * two halves cannot disagree about what was signed. A receiver in another
 * language reconstructs this same concatenation.
 */
export function signedMaterial(timestampMs: number, payload: string): string {
  return `${timestampMs}.${payload}`;
}

/** Sign a body under the v2 scheme. Returns bare hex (no scheme marker). */
export function signTimestampedPayload(
  payload: string,
  secret: string,
  timestampMs: number
): string {
  return signPayload(signedMaterial(timestampMs, payload), secret);
}

/** A finite, non-negative integer millisecond stamp, or null. */
function asTimestampMs(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (!Number.isInteger(value) || value < 0) return null;
  return value;
}

/**
 * The delivery timestamp carried by the payload itself.
 *
 * DERIVED, never re-minted: `WebhookPayload.timestamp` is an ISO-8601 string set
 * once per delivery in `buildPayload`, above the retry loop. Reading it here is
 * what makes three attempts carry one signature without threading a value
 * through the dispatcher.
 *
 * Returns null for anything it cannot read as an instant — a non-JSON body, a
 * JSON array or scalar, a missing or unparseable `timestamp`. Null means "I could
 * not read one", and the CALLER decides; `createSignedHeaders` refuses. It does
 * not mean "use now", which is what it used to mean.
 */
export function payloadTimestampMs(payload: string): number | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const raw = (parsed as { timestamp?: unknown }).timestamp;
  if (typeof raw !== 'string') return null;
  return asTimestampMs(Date.parse(raw));
}

/** Options for {@link createSignedHeaders}. */
export interface SignedHeaderOptions {
  /**
   * The delivery's instant, in integer epoch milliseconds. Thread this when the
   * caller owns the delivery lifetime; leave it UNSET to derive from the payload.
   *
   * PRESENT-BUT-UNREADABLE IS A REFUSAL, not a fall-through. A negative, float,
   * NaN or non-number value used to be silently ignored and the payload instant
   * used instead — so a caller that garbled its own timestamp got a correctly
   * signed delivery at some OTHER instant and no way to know. Garbled input
   * tightens.
   */
  timestampMs?: number;
}

/**
 * No delivery instant could be resolved, so nothing was signed.
 *
 * THROWN, not defaulted. The retired fallback here was `Date.now()`, and it was a
 * hole the exact shape of the defect this scheme closes: a payload whose
 * `timestamp` was unreadable minted a FRESH clock read on every call, so three
 * retries of one delivery carried three different signatures — per-attempt
 * signing, reintroduced through the error path of the fix for per-attempt
 * signing. Refusing is the only safe answer: a caller that cannot say when a
 * delivery happened cannot be given a signature that claims to.
 */
export class WebhookTimestampUnresolvable extends Error {
  constructor(public readonly detail: string) {
    super(`cannot resolve a delivery timestamp to sign: ${detail}`);
    this.name = 'WebhookTimestampUnresolvable';
  }
}

/**
 * Resolve the delivery instant this signature will cover.
 *
 * Extracted from {@link createSignedHeaders} so the two other outbound families
 * that sign a body — `siem/webhook.ts` and `itsm/generic-webhook.ts` — reach the
 * SAME resolution rather than growing a second one. There is still no clock read in
 * this module.
 */
function resolveDeliveryInstant(payload: string, options: SignedHeaderOptions): number {
  if (options.timestampMs !== undefined) {
    // Threaded but unreadable is an ERROR, never a reason to consult the payload:
    // the caller stated an instant and got it wrong, and signing at a different
    // instant than the one it named would hide that.
    const explicit = asTimestampMs(options.timestampMs);
    if (explicit === null) {
      throw new WebhookTimestampUnresolvable(
        `options.timestampMs must be a non-negative integer of epoch milliseconds, received ${JSON.stringify(options.timestampMs)}`,
      );
    }
    return explicit;
  }
  const derived = payloadTimestampMs(payload);
  if (derived === null) {
    throw new WebhookTimestampUnresolvable(
      "the payload carries no readable ISO-8601 `timestamp`, and no options.timestampMs was threaded",
    );
  }
  return derived;
}

/**
 * The TWO signature headers alone, for a family that owns the rest of its headers.
 *
 * WHY IT IS EXPORTED. `siem/webhook.ts` and `itsm/generic-webhook.ts` each emitted
 * their own `X-Signature` over the BODY ALONE plus an `X-Signing-Algorithm` header
 * and no timestamp — v1, the scheme `verifySignedWebhook` in this same file refuses
 * by name as replayable. They now call this. Two schemes existed because two files
 * had not been read together; one implementation is the fix, not a third copy of the
 * HMAC. Those families do not want this module's `Content-Type`,
 * `X-Webhook-Delivery-Id` or `X-Webhook-Event-Id` — they set their own — so the
 * signing half is separable and `createSignedHeaders` is built on it.
 *
 * MINTED ONCE PER DELIVERY. Call this ABOVE a retry loop, never inside one: the
 * timestamp is inside the MAC, so a per-attempt instant gives one delivery more than
 * one signature and a strict receiver reads the second as forgery.
 */
export function v2SignatureHeaders(
  payload: string,
  secret: string,
  options: SignedHeaderOptions = {},
): Record<string, string> {
  const timestampMs = resolveDeliveryInstant(payload, options);
  return {
    [WEBHOOK_SIGNATURE_HEADER]: `${WEBHOOK_SIGNATURE_SCHEME}=${signTimestampedPayload(payload, secret, timestampMs)}`,
    // Integer epoch MILLISECONDS, UTC. Covered by the signature above.
    [WEBHOOK_TIMESTAMP_HEADER]: timestampMs.toString(),
  };
}

/**
 * Create signed webhook headers (scheme v2).
 */
export function createSignedHeaders(
  payload: string,
  secret: string,
  deliveryId: string,
  eventId: string,
  options: SignedHeaderOptions = {}
): Record<string, string> {
  // RESOLUTION, and it REFUSES rather than falling back. There is no clock read in
  // this module at all: `Date.now()` here would mint a fresh instant per call, and
  // this function is called once per ATTEMPT, so an unreadable payload timestamp
  // would silently restore per-attempt signing. Shared with the two other outbound
  // families through v2SignatureHeaders above, so there is one resolution.
  return {
    'Content-Type': 'application/json',
    ...v2SignatureHeaders(payload, secret, options),
    'X-Webhook-Delivery-Id': deliveryId,
    'X-Webhook-Event-Id': eventId,
  };
}

/** Headers as a receiver sees them: names in any case, values possibly absent. */
export type IncomingHeaders = Record<string, string | string[] | undefined>;

/** Options for {@link verifySignedWebhook}. Both clocks are the CALLER's. */
export interface VerifyOptions {
  /**
   * How far in the PAST a timestamp may sit and still be accepted, in ms. Must
   * exceed the sender's whole retry envelope, because the timestamp is the
   * delivery's instant and does not move between attempts.
   */
  toleranceMs: number;
  /**
   * The receiver's current time in epoch ms. REQUIRED and injected: this helper
   * never reads a clock, so a test can drive the whole window deterministically
   * and a caller cannot be surprised by which clock was consulted.
   */
  now: number;
  /**
   * How far in the FUTURE a timestamp may sit, in ms. Defaults to 0 — the
   * strictest reading. Absent input tightens; loosening for NTP drift is a
   * deliberate act by the receiver.
   */
  futureSkewMs?: number;
}

/** The verdict, with a reason whenever it refuses. */
export interface WebhookVerification {
  valid: boolean;
  /** Present iff `valid` is false. Safe to log; carries no secret material. */
  reason?: string;
}

const refuse = (reason: string): WebhookVerification => ({ valid: false, reason });

/**
 * Case-insensitive single-value header read.
 *
 * THREE OUTCOMES, not two. A repeated header is REFUSED rather than merged or
 * first-wins — but it must be distinguishable from an ABSENT one, which it was
 * not: both returned null, so "repeated" was reported to the operator as
 * "missing" and the repeat-rejection assertion in the proof was riding the
 * absent-header branch, pinning a path it was not testing.
 */
type HeaderRead =
  | { kind: 'found'; value: string }
  | { kind: 'absent' }
  | { kind: 'repeated' };

function readHeader(headers: IncomingHeaders, name: string): HeaderRead {
  const wanted = name.toLowerCase();
  let found: string | null = null;
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() !== wanted) continue;
    if (typeof value === 'string') {
      if (found !== null) return { kind: 'repeated' };
      found = value;
    } else if (Array.isArray(value)) {
      // A multi-valued header is a repeat by another spelling; a non-string entry
      // is not a header value we will guess at.
      if (found !== null || value.length !== 1 || typeof value[0] !== 'string') {
        return { kind: 'repeated' };
      }
      found = value[0];
    }
  }
  return found === null ? { kind: 'absent' } : { kind: 'found', value: found };
}

/**
 * Receiver-side verification of a v2 webhook.
 *
 * FAIL-CLOSED AT EVERY BRANCH. Absent, malformed, repeated, wrongly-schemed,
 * stale, or future-dated input all REFUSE with a reason. There is no input that
 * is "missing, therefore fine" — the v1 defect was exactly a value nobody
 * checked, and a verifier that shrugs at an absent timestamp reproduces it.
 *
 * NOT WIRED TO ANY INBOUND ROUTE. Nothing in this repository receives webhooks;
 * this is the reference implementation a receiver ports, and the oracle
 * `proof:webhooks` drives. Exporting it is not a claim that inbound
 * verification is deployed.
 */
export function verifySignedWebhook(
  headers: IncomingHeaders,
  body: string,
  secret: string,
  options: VerifyOptions
): WebhookVerification {
  if (typeof secret !== 'string' || secret.length === 0) {
    return refuse('no signing secret configured for this endpoint');
  }
  if (typeof body !== 'string') {
    return refuse('body must be the raw request string, verified before parsing');
  }

  const now = asTimestampMs(options?.now);
  if (now === null) {
    return refuse('options.now must be an integer epoch-ms instant supplied by the caller');
  }
  const tolerance = asTimestampMs(options?.toleranceMs);
  if (tolerance === null) {
    return refuse('options.toleranceMs must be a non-negative integer of milliseconds');
  }
  // freshness: local-by-design — the receiver's skew allowance is a caller option; the comparison itself is the shared ageMs body below
  const futureSkew = options?.futureSkewMs === undefined ? 0 : asTimestampMs(options.futureSkewMs);
  // freshness: local-by-design — option validation only; a garbled allowance refuses, the age is never computed here
  if (futureSkew === null) {
    return refuse('options.futureSkewMs must be a non-negative integer of milliseconds');
  }

  const signatureRead = readHeader(headers, WEBHOOK_SIGNATURE_HEADER);
  if (signatureRead.kind === 'repeated') {
    return refuse(`repeated ${WEBHOOK_SIGNATURE_HEADER} header`);
  }
  if (signatureRead.kind === 'absent' || signatureRead.value.length === 0) {
    return refuse(`missing ${WEBHOOK_SIGNATURE_HEADER}`);
  }
  const rawSignature = signatureRead.value;
  const marker = `${WEBHOOK_SIGNATURE_SCHEME}=`;
  if (!rawSignature.startsWith(marker)) {
    // A bare 64-hex value is the retired v1 scheme, which signed the body alone.
    // Refused by name so the operator reading the log knows to upgrade the sender
    // rather than hunting a key mismatch.
    return refuse(
      /^[0-9a-f]{64}$/.test(rawSignature)
        ? `unsigned-timestamp (v1) signature refused: expected ${WEBHOOK_SIGNATURE_SCHEME}= scheme`
        : `unrecognised signature scheme: expected ${WEBHOOK_SIGNATURE_SCHEME}= prefix`,
    );
  }
  const provided = rawSignature.slice(marker.length);
  if (!/^[0-9a-f]{64}$/.test(provided)) {
    return refuse('signature is not 64 lowercase hex characters');
  }

  const timestampRead = readHeader(headers, WEBHOOK_TIMESTAMP_HEADER);
  if (timestampRead.kind === 'repeated') {
    return refuse(`repeated ${WEBHOOK_TIMESTAMP_HEADER} header`);
  }
  if (timestampRead.kind === 'absent' || timestampRead.value.length === 0) {
    return refuse(`missing ${WEBHOOK_TIMESTAMP_HEADER}`);
  }
  const rawTimestamp = timestampRead.value;
  if (!/^[0-9]{1,15}$/.test(rawTimestamp)) {
    return refuse(`${WEBHOOK_TIMESTAMP_HEADER} must be integer epoch milliseconds`);
  }
  const timestampMs = Number(rawTimestamp);
  if (asTimestampMs(timestampMs) === null) {
    return refuse(`${WEBHOOK_TIMESTAMP_HEADER} must be integer epoch milliseconds`);
  }

  // One freshness body for the whole estate: ageMs returns null for a timestamp
  // ahead of the caller's clock by more than the allowance (and for anything it
  // cannot read), and never a negative number. Null tightens: a future-dated
  // signature is refused, it is not "maximally fresh".
  const age = ageMs(timestampMs, now, futureSkew);
  if (age === null) {
    return refuse(`timestamp is in the future beyond the ${futureSkew}ms skew allowance, or unreadable`);
  }
  if (age > tolerance) {
    return refuse(`timestamp is ${age}ms old, beyond the ${tolerance}ms tolerance (replay window)`);
  }

  // Freshness is decided BEFORE the MAC so a stale-but-authentic delivery is
  // refused for the true reason. The comparison itself is length-check then
  // constant-time, the same shape as lib/verdict-attestation.
  const expected = signTimestampedPayload(body, secret, timestampMs);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return refuse('signature does not verify over `${timestamp}.${body}` under this secret');
  }

  return { valid: true };
}
