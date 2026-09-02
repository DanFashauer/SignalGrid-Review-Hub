/**
 * Webhook Dispatcher
 * 
 * Handles webhook delivery with retries, DLQ, and idempotency.
 * Security: HTTPS-only in production, blocks localhost.
 */

import crypto from 'crypto';
import {
  WebhookConfig,
  WebhookPayload,
  WebhookPayloadSchema,
  WebhookEventType,
  DeliveryStatus,
} from './types';
import { createSignedHeaders, WebhookTimestampUnresolvable } from './sign';
import { SIGNING_SECRET_MISSING } from '../adapters/signing';
import {
  WEBHOOK_URL_REFUSALS,
  WEBHOOK_URL_REFUSAL_REASONS,
  validateWebhookUrl,
} from '../adapters/url-guard';
import { isRedirectStatus, isRedirectRefusal, redirectRefusal } from '../adapters/redirect';
import { boundedText, VENDOR_BODY_TEXT_LIMIT, VENDOR_ERROR_TEXT_LIMIT } from '../adapters/bounded-text';
import {
  calculateBackoff,
  isRetryableStatus,
  hasReachedMaxAttempts,
  DEFAULT_RETRY_CONFIG,
  RetryConfig,
} from './retry';
import {
  getWebhooksForEvent,
  getWebhookSecretHash,
  recordDelivery,
  addToDLQ,
} from './store';

// NOTE: there is deliberately NO module-load environment constant here any more.
// `IS_PRODUCTION = process.env.NODE_ENV === 'production'` used to live at this
// line and gate the URL rules below, while `resolveWebhookDelivery` read
// SIGNALGRID_TIER at CALL time. Two gates on one outbound path, disagreeing about
// what "production" means: a deployment that set the repo's own tier vocabulary to
// prod and turned live integrations on had done everything this codebase asks, and
// still got plain-HTTP delivery of an HMAC-signed payload to loopback or an
// internal address, because NODE_ENV happened to be unset. Being read at module
// load made it unvariable per call as well.

/** Dispatcher configuration */
export interface DispatcherConfig {
  /** Timeout for each request in ms */
  timeoutMs: number;
  /** Retry configuration */
  retry: RetryConfig;
}

/** Default dispatcher configuration */
export const DEFAULT_DISPATCHER_CONFIG: DispatcherConfig = {
  timeoutMs: 30000, // 30 seconds
  retry: DEFAULT_RETRY_CONFIG,
};

/** Delivery result */
export interface DeliveryResult {
  success: boolean;
  statusCode?: number;
  responseBody?: string;
  error?: string;
  deadLettered?: boolean;
  /**
   * The tier gate withheld this delivery — nothing left the process. Distinct
   * from `success: false`, which means we tried and it did not work. A caller
   * that cannot tell those apart would report "webhook failed" for a tier that
   * is never supposed to send.
   */
  suppressed?: boolean;
  /**
   * This outcome cannot change on a retry, and the retry loop must stop NOW.
   *
   * STRUCTURAL, not a string. The other permanent outcomes are recognised by
   * `isPermanentDeliveryError` from things it can derive — a tier, a status code,
   * the URL validator's own reason table. A signing refusal has no such handle:
   * its text comes from an error's `message`, and matching on that text is the
   * exact defect the retry loop already shipped once (it compared `result.error`
   * against two literals `validateWebhookUrl` had stopped returning, and a dead
   * comparison does not fail — it just never matches). So the site that KNOWS the
   * outcome is final says so here, and the classifier reads a flag.
   */
  permanent?: boolean;
}

/**
 * Live-delivery gate. Webhooks POST to a customer-supplied URL, so this family
 * is an OUTBOUND EMITTER: unlike a device actuator it has a legitimate
 * read-only-disciplined form (send nothing), so it is gated rather than deleted.
 *
 * Same policy as every other live vendor path in this repo: dev/alpha NEVER send;
 * beta/prod may, and only with SIGNALGRID_LIVE_INTEGRATIONS=true. Env is read at
 * CALL TIME, never captured at module load — a gate that cannot be varied per
 * call cannot be proven, which is part of why this family went unproven for so
 * long. The URL validator below now reads the SAME resolution, passed in by the
 * caller, so the two cannot disagree about what "live" means.
 */
export function resolveWebhookDelivery(
  env: NodeJS.ProcessEnv = process.env,
): { mode: 'live' } | { mode: 'suppressed'; reason: string } {
  const tier = (env.SIGNALGRID_TIER ?? 'dev').toLowerCase();
  if (tier !== 'beta' && tier !== 'prod') {
    return { mode: 'suppressed', reason: `tier "${tier}" never delivers live webhooks` };
  }
  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== 'true') {
    return { mode: 'suppressed', reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  return { mode: 'live' };
}

/**
 * Validate a webhook target — MOVED to ../adapters/url-guard.ts.
 *
 * It is re-exported here under the identical names because two other families POST
 * to an operator-supplied URL and called nothing: a guard that only one of its
 * three callers can reach is a guard in the wrong file. Everything that imported
 * these three symbols from this module still does.
 */
export { WEBHOOK_URL_REFUSALS, WEBHOOK_URL_REFUSAL_REASONS, validateWebhookUrl };

/**
 * The reason recorded when the envelope itself will not build.
 *
 * EXPORTED so a proof can assert the REASON rather than merely that something
 * failed — `success === false` is satisfied by a network error, a 500, a missing
 * secret and this, and an assertion that cannot tell them apart is not holding the
 * behaviour it claims to.
 */
export const WEBHOOK_ENVELOPE_INVALID =
  'webhook envelope refused: the payload does not match WebhookPayloadSchema (a source edit added or renamed a top-level key)';

/**
 * No signed headers could be produced, so nothing was sent.
 *
 * The shared wording, exported for the same reason `WEBHOOK_ENVELOPE_INVALID` and
 * `SIGNING_SECRET_MISSING` are: an assertion that retypes a refusal's text is
 * pinning its own copy, and drifts silently when the real one changes.
 */
export const WEBHOOK_SIGNING_REFUSED =
  'webhook signing refused: no signed headers could be produced for this delivery';

/**
 * Build webhook payload — the CLOSED top-level set, now actually enforced.
 *
 * `WebhookPayloadSchema` has described this shape since the family was written and
 * NOTHING EVER PARSED IT. A schema nobody parses cannot reject anything; it is
 * documentation wearing a validator's clothes, and it made the boundary look
 * defended to the next reader. It is `.strict()` and it is parsed here, which is
 * the one place a webhook body is constructed — so the six top-level keys below
 * are the six keys that can leave, and an unknown seventh is a thrown error rather
 * than a silently-stripped field or a silently-forwarded one.
 *
 * SAID EXACTLY: this rejects a seventh key added to the literal below — a SOURCE
 * EDIT — and it does not validate caller content. Caller data is confined to `data`,
 * whose schema is `z.record(z.unknown())`: no caller FIELD can make this throw,
 * because every key inside `data` is accepted. The one caller-reachable failure is
 * `data` not being an object at all, which a JavaScript caller (or a TypeScript one
 * with a cast) can still produce. So the refusal path in `dispatchEvent` is mostly
 * about a developer's edit reaching production — and is reachable, which is why it is
 * driven rather than reasoned about.
 *
 * `data` IS THE DECLARED OPEN SLOT, and the only one. It is
 * `z.record(z.string(), z.unknown())` by design: the caller composes the event body
 * and this dispatcher does not interpret it. That is honest and it is bounded to
 * one key — it is NOT the same as copying the caller's object over the envelope.
 * Declared in ../adapters/payload-fields.ts, named in
 * docs/DATA_RETENTION_AND_PERSONAL_DATA.md.
 */
function buildPayload(
  eventType: WebhookEventType,
  data: Record<string, unknown>
): WebhookPayload {
  return WebhookPayloadSchema.parse({
    id: crypto.randomUUID(),
    type: eventType,
    timestamp: new Date().toISOString(),
    source: {
      service: 'tap-to-login',
      version: '1.0.0',
    },
    // DECLARED OPEN SLOT — the caller's own map, under its own key.
    data,
    deliveryId: crypto.randomUUID(),
  });
}

/**
 * Dispatch a webhook to a single endpoint
 */
async function dispatchToEndpoint(
  webhook: WebhookConfig,
  payload: WebhookPayload,
  config: DispatcherConfig = DEFAULT_DISPATCHER_CONFIG
): Promise<DeliveryResult> {
  // The tier gate comes FIRST: a suppressed tier must do no outbound work at all,
  // not merely skip the fetch after resolving secrets and signing a payload.
  // Recorded, not silent — a withheld delivery that left no trace would be
  // indistinguishable from one that was never requested.
  const delivery = resolveWebhookDelivery();
  if (delivery.mode === 'suppressed') {
    await recordDelivery(
      webhook.id,
      payload.id,
      'suppressed',
      undefined,
      undefined,
      delivery.reason,
    );
    return { success: false, suppressed: true, error: delivery.reason };
  }

  const urlValidation = validateWebhookUrl(webhook.url, { live: delivery.mode === 'live' });
  if (!urlValidation.valid) {
    // RECORDED, like the two refusals either side of it. This branch returned
    // without a row: the delivery was refused, dead-lettered after the retry loop,
    // and the per-webhook delivery log — the thing an operator opens to ask "what
    // happened to my webhook?" — showed nothing at all. A refusal nobody can see
    // is indistinguishable from an event that was never raised.
    await recordDelivery(
      webhook.id,
      payload.id,
      'failed',
      undefined,
      undefined,
      urlValidation.error,
    );
    return {
      success: false,
      error: urlValidation.error,
    };
  }

  // Get secret (stored as hash, we need to handle this)
  // Note: In production, you'd store encrypted secrets or use a secret manager
  // For now, we'll need to pass the secret or implement secret retrieval
  const secret =
    (webhook as unknown as { _secret?: string })._secret ||
    process.env[`WEBHOOK_SECRET_${webhook.id.slice(0, 8)}`];

  if (!secret) {
    const errorMessage = SIGNING_SECRET_MISSING;
    await recordDelivery(
      webhook.id,
      payload.id,
      'failed',
      undefined,
      undefined,
      errorMessage
    );
    return {
      success: false,
      error: errorMessage,
    };
  }
  
  const payloadStr = JSON.stringify(payload);

  // SIGN, OR REFUSE VISIBLY — the fourth refusal in this function, and the only one
  // that used to leave NO TRACE AT ALL.
  //
  // `createSignedHeaders` THROWS when no delivery instant resolves
  // (`WebhookTimestampUnresolvable`). This call sat in `dispatchToEndpoint`'s scope
  // but OUTSIDE its try, so the throw propagated out of `dispatchWithRetry`, rejected
  // that webhook's entry in `dispatchEvent`'s `Promise.allSettled`, was counted
  // `failed` — and wrote no `recordDelivery` row. Every other refusal in this family
  // records one; this was the single one that did not, so the per-webhook delivery
  // log an operator opens to ask "what happened to my webhook?" showed nothing.
  //
  // NOT REACHABLE FROM PRODUCTION CONFIG TODAY, and the fix is not a claim that it
  // is: `buildPayload` mints `timestamp` through `z.string().datetime()`, so the
  // dispatch path always hands this a readable instant. It is a LATENT no-row
  // refusal, which is why it is fixed structurally and driven rather than reasoned
  // about — the schema admits pre-epoch instants (`0000-01-01T00:00:00Z` parses to a
  // negative epoch-ms, which `payloadTimestampMs` refuses), so the distance between
  // "unreachable" and "reachable" here is one edit to the literal above.
  //
  // PERMANENT BY CONSTRUCTION, not by class-name matching. Signing is a pure
  // function of `(payloadStr, secret, deliveryId, eventId)` — the payload is built
  // ONCE above the retry loop and the secret is resolved from the same place every
  // attempt — so no input to it changes between attempts and no throw from it can be
  // transient. The flag says that; it is not read back out of the message.
  let headers: Record<string, string>;
  try {
    headers = createSignedHeaders(payloadStr, secret, payload.deliveryId, payload.id);
  } catch (error) {
    // The CLASS names the refusal, not a substring of the prose. `WebhookTimestampUnresolvable`
    // is referenced as a value here so a rename cannot leave this reading a stale label.
    const named =
      error instanceof WebhookTimestampUnresolvable
        ? WebhookTimestampUnresolvable.name
        : error instanceof Error
          ? error.name
          : 'Error';
    const detail = (error instanceof Error ? error.message : String(error))
      .replace(/\s+/g, ' ')
      .slice(0, 300);
    const errorMessage = `${WEBHOOK_SIGNING_REFUSED}: ${named}: ${detail}`;
    await recordDelivery(
      webhook.id,
      payload.id,
      'failed',
      undefined,
      undefined,
      errorMessage,
    );
    return {
      success: false,
      error: errorMessage,
      permanent: true,
    };
  }

  try {
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers,
      body: payloadStr,
      signal: AbortSignal.timeout(config.timeoutMs),
      // NEVER FOLLOWED. `validateWebhookUrl` above guards the FIRST hop only; the
      // default `follow` handed the second hop to whatever the collector's
      // `Location` header named, and `X-Webhook-Signature` survives a cross-origin
      // redirect in undici. See ../adapters/redirect.ts for the measurement.
      redirect: 'manual',
    });

    // A 3xx is a PERMANENT refusal, before the body is read: no retry re-routes a
    // configured target, and reading the body of a redirect we did not follow would
    // be reading an unvalidated origin's answer.
    if (isRedirectStatus(response.status)) {
      const reason = redirectRefusal(response.status, response.headers.get('location'));
      await recordDelivery(webhook.id, payload.id, 'failed', response.status, undefined, reason);
      return { success: false, statusCode: response.status, error: reason, permanent: true };
    }

    const rawBody = await response.text().catch(() => undefined);
    const responseBody = rawBody === undefined ? undefined : boundedText(rawBody, VENDOR_BODY_TEXT_LIMIT);

    const result: DeliveryResult = {
      success: response.ok,
      statusCode: response.status,
      responseBody,
    };

    // Record delivery attempt
    await recordDelivery(
      webhook.id,
      payload.id,
      result.success ? 'success' : 'failed',
      response.status,
      responseBody
    );

    return result;
  } catch (error) {
    const errorMessage = boundedText(
      error instanceof Error ? error.message : 'Unknown error',
      VENDOR_ERROR_TEXT_LIMIT,
    );

    await recordDelivery(
      webhook.id,
      payload.id,
      'failed',
      undefined,
      undefined,
      errorMessage
    );

    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Is this result final — must the retry loop stop?
 *
 * EXPORTED so it can be driven directly against `WEBHOOK_URL_REFUSAL_REASONS`.
 * As a closure inside dispatchWithRetry it was unreachable from any proof, and it
 * spent its whole life comparing against two strings validateWebhookUrl had
 * stopped returning.
 */
export function isPermanentDeliveryError(result: DeliveryResult): boolean {
  // STATED BY THE SITE THAT KNOWS. A signing refusal is final and carries no handle
  // this function could derive one from — its text is an error's `message`, and
  // matching on message text is how the dead string comparisons below got shipped.
  if (result.permanent === true) {
    return true;
  }

  // A tier does not change between attempts. Retrying a suppression is retrying a
  // policy decision — it wrote one suppressed delivery row per attempt and then
  // dead-lettered an event that was never supposed to leave.
  if (result.suppressed === true) {
    return true;
  }

  if (result.statusCode && !isRetryableStatus(result.statusCode)) {
    return true;
  }

  if (result.error === SIGNING_SECRET_MISSING) {
    return true;
  }

  // A REFUSED REDIRECT is permanent by construction, and it is recognised from the
  // shared constant rather than from a retyped copy of the sentence — the same
  // lesson as the URL reasons below. Retrying re-fetches the same 3xx from the same
  // configured host.
  if (isRedirectRefusal(result.error)) {
    return true;
  }

  // DERIVED, not retyped. Every string validateWebhookUrl can return is permanent
  // by construction: no retry makes an http:// URL https, or a loopback address
  // routable.
  return result.error !== undefined && WEBHOOK_URL_REFUSAL_REASONS.includes(result.error);
}

/**
 * Dispatch with retry logic
 */
async function dispatchWithRetry(
  webhook: WebhookConfig,
  payload: WebhookPayload,
  config: DispatcherConfig = DEFAULT_DISPATCHER_CONFIG
): Promise<DeliveryResult> {
  let lastResult: DeliveryResult | null = null;

  // WHAT IS PERMANENT, and why the list is no longer typed out here.
  //
  // This compared `result.error` against four literals, two of which
  // ('HTTPS required in production', 'Localhost not allowed in production') were
  // strings validateWebhookUrl had STOPPED RETURNING when its rules were rewritten.
  // A dead string comparison does not fail; it just never matches. So a live tier
  // pointed at a plain-http URL retried the refusal six times, and a dev tier —
  // where `suppressed` was not permanent either — retried a policy decision six
  // times, writing six suppressed delivery rows for one event and reporting
  // failed: 1 at the end.
  //
  // Both halves are fixed structurally rather than by editing the strings:
  // the URL reasons are DERIVED from the object validateWebhookUrl returns them
  // from, and a suppressed delivery is permanent by construction — no amount of
  // retrying changes a tier.


  for (let attempt = 1; attempt <= config.retry.maxAttempts; attempt++) {
    const result = await dispatchToEndpoint(webhook, payload, config);
    lastResult = result;

    if (result.success || isPermanentDeliveryError(result)) {
      return result;
    }

    // Check if we've reached max attempts
    if (hasReachedMaxAttempts(attempt, config.retry)) {
      break;
    }

    // Calculate backoff and wait
    const delay = calculateBackoff(attempt, config.retry);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  // All retries exhausted, add to DLQ. A suppressed result never reaches here —
  // it is permanent above — so this cannot dead-letter a delivery that policy
  // withheld, which is what used to happen at dev tier.
  const finalError = lastResult?.error || 'Max retries exceeded';
  await addToDLQ(
    webhook.id,
    payload.id,
    payload,
    finalError
  );

  return {
    success: false,
    error: finalError,
    deadLettered: true,
  };
}

/** What one dispatchEvent() call did. `dispatched === succeeded + failed +
 *  suppressed` always; `suppressed` is NOT a flavour of `failed`. */
export interface DispatchSummary {
  dispatched: number;
  succeeded: number;
  failed: number;
  /** The tier gate withheld these — nothing left the process, nothing is broken. */
  suppressed: number;
}

/**
 * Dispatch event to all subscribed webhooks
 */
export async function dispatchEvent(
  eventType: WebhookEventType,
  data: Record<string, unknown>,
  config: DispatcherConfig = DEFAULT_DISPATCHER_CONFIG
): Promise<DispatchSummary> {
  // Get all webhooks subscribed to this event
  const webhooks = await getWebhooksForEvent(eventType);
  
  if (webhooks.length === 0) {
    return { dispatched: 0, succeeded: 0, failed: 0, suppressed: 0 };
  }

  // BUILD, OR REFUSE VISIBLY. `buildPayload` parses through a `.strict()` schema,
  // so a seventh key added to its literal throws — and an uncaught throw here left
  // the worst possible trace: ZERO delivery rows, no summary, and an exception
  // surfacing in whatever raised the event, with nothing in the per-webhook
  // delivery log an operator opens to ask "what happened to my webhook?". That is
  // the same defect this file already fixed twice — a refusal nobody can see is
  // indistinguishable from an event that was never raised.
  //
  // So the refusal is RECORDED, one row per subscribed webhook naming the schema
  // error, and the summary is returned like any other outcome. `failed`, not
  // `suppressed`: no policy withheld this, a source edit broke the envelope and
  // somebody must chase it.
  let payload: WebhookPayload;
  try {
    payload = buildPayload(eventType, data);
  } catch (error) {
    const detail = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').slice(0, 300);
    const reason = `${WEBHOOK_ENVELOPE_INVALID}: ${detail}`;
    for (const webhook of webhooks) {
      await recordDelivery(webhook.id, crypto.randomUUID(), 'failed', undefined, undefined, reason);
    }
    return { dispatched: webhooks.length, succeeded: 0, failed: webhooks.length, suppressed: 0 };
  }

  // Dispatch to all webhooks in parallel
  const results = await Promise.allSettled(
    webhooks.map(webhook => dispatchWithRetry(webhook, payload, config))
  );

  let succeeded = 0;
  let failed = 0;
  let suppressed = 0;

  // THREE buckets, not two. `DeliveryResult.suppressed` has carried the
  // distinction since it was added — with a comment saying a caller that cannot
  // tell them apart "would report 'webhook failed' for a tier that is never
  // supposed to send" — and this loop then folded it into `failed` anyway, and
  // dropped the flag on the floor. A dev tier reported failed: 1 for a webhook
  // working exactly as designed.
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.success) {
      succeeded++;
    } else if (result.status === 'fulfilled' && result.value.suppressed === true) {
      suppressed++;
    } else {
      failed++;
    }
  }

  return {
    dispatched: webhooks.length,
    succeeded,
    failed,
    suppressed,
  };
}

// Re-export types and functions for convenience
export * from './types';
export * from './sign';
export * from './retry';
