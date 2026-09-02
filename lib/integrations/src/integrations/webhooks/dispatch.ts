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
  WebhookEventType,
  DeliveryStatus,
} from './types';
import { createSignedHeaders } from './sign';
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
 * Validate a webhook target.
 *
 * TWO RULES, and they are deliberately different in kind.
 *
 * THE SSRF BLOCK IS UNCONDITIONAL. Loopback, link-local, and RFC1918 private
 * ranges are refused in every tier, because there is no tier in which posting a
 * signed customer payload at 127.0.0.1 — or at a neighbour on the internal
 * network — is the intended behaviour. It was previously gated on production AND
 * covered only four loopback spellings: 192.168.0.5, 10.0.0.7 and every other
 * RFC1918 address passed the guard even when it fired.
 *
 * THE HTTPS RULE IS GATED ON LIVE DELIVERY, passed in by the caller from the same
 * `resolveWebhookDelivery` result that decides whether to send at all. One
 * resolution, read once, per call. A suppressed tier may legitimately point a
 * fixture at a plain-HTTP mock; a live one may not.
 */
export function validateWebhookUrl(
  url: string,
  opts: { live: boolean },
): { valid: boolean; error?: string } {
  try {
    const parsed = new URL(url);

    if (opts.live && parsed.protocol !== 'https:') {
      return { valid: false, error: 'HTTPS required for live webhook delivery' };
    }

    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

    // Loopback and unspecified, in both families.
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname === '0.0.0.0' ||
      hostname === '::' ||
      hostname === '::1' ||
      /^127\./.test(hostname)
    ) {
      return { valid: false, error: 'Loopback and unspecified addresses are never valid webhook targets' };
    }

    // RFC1918 private ranges, RFC6598 shared address space, and link-local —
    // including IPv6 unique-local (fc00::/7) and link-local (fe80::/10).
    if (
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname) ||
      /^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\./.test(hostname) ||
      /^169\.254\./.test(hostname) ||
      /^f[cd][0-9a-f]{2}:/.test(hostname) ||
      /^fe[89ab][0-9a-f]:/.test(hostname)
    ) {
      return { valid: false, error: 'Private and link-local addresses are never valid webhook targets' };
    }

    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid URL' };
  }
}

/**
 * Build webhook payload
 */
function buildPayload(
  eventType: WebhookEventType,
  data: Record<string, unknown>
): WebhookPayload {
  return {
    id: crypto.randomUUID(),
    type: eventType,
    timestamp: new Date().toISOString(),
    source: {
      service: 'tap-to-login',
      version: '1.0.0',
    },
    data,
    deliveryId: crypto.randomUUID(),
  };
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
    const errorMessage = 'Webhook signing secret not configured';
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
  const headers = createSignedHeaders(payloadStr, secret, payload.deliveryId, payload.id);

  try {
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers,
      body: payloadStr,
      signal: AbortSignal.timeout(config.timeoutMs),
    });

    const responseBody = await response.text().catch(() => undefined);

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
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
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
 * Dispatch with retry logic
 */
async function dispatchWithRetry(
  webhook: WebhookConfig,
  payload: WebhookPayload,
  config: DispatcherConfig = DEFAULT_DISPATCHER_CONFIG
): Promise<DeliveryResult> {
  let lastResult: DeliveryResult | null = null;

  const isPermanentError = (result: DeliveryResult): boolean => {
    if (result.statusCode && !isRetryableStatus(result.statusCode)) {
      return true;
    }

    return (
      result.error === 'Webhook signing secret not configured' ||
      result.error === 'Invalid URL' ||
      result.error === 'HTTPS required in production' ||
      result.error === 'Localhost not allowed in production'
    );
  };

  for (let attempt = 1; attempt <= config.retry.maxAttempts; attempt++) {
    const result = await dispatchToEndpoint(webhook, payload, config);
    lastResult = result;

    if (result.success || isPermanentError(result)) {
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

  // All retries exhausted, add to DLQ
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

/**
 * Dispatch event to all subscribed webhooks
 */
export async function dispatchEvent(
  eventType: WebhookEventType,
  data: Record<string, unknown>,
  config: DispatcherConfig = DEFAULT_DISPATCHER_CONFIG
): Promise<{ dispatched: number; succeeded: number; failed: number }> {
  // Get all webhooks subscribed to this event
  const webhooks = await getWebhooksForEvent(eventType);
  
  if (webhooks.length === 0) {
    return { dispatched: 0, succeeded: 0, failed: 0 };
  }

  // Build payload
  const payload = buildPayload(eventType, data);

  // Dispatch to all webhooks in parallel
  const results = await Promise.allSettled(
    webhooks.map(webhook => dispatchWithRetry(webhook, payload, config))
  );

  let succeeded = 0;
  let failed = 0;

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.success) {
      succeeded++;
    } else {
      failed++;
    }
  }

  return {
    dispatched: webhooks.length,
    succeeded,
    failed,
  };
}

// Re-export types and functions for convenience
export * from './types';
export * from './sign';
export * from './retry';
