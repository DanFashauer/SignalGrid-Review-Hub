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
import { fetchWithTimeout, TIMEOUT_PRESETS } from '../../utils/fetchWithTimeout';

// Environment checks
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

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
}

/**
 * Validate webhook URL for security
 */
function validateWebhookUrl(url: string): { valid: boolean; error?: string } {
  try {
    const parsed = new URL(url);
    
    // Must be HTTPS in production
    if (IS_PRODUCTION && parsed.protocol !== 'https:') {
      return { valid: false, error: 'HTTPS required in production' };
    }
    
    // Block localhost/127.0.0.1 in production
    if (IS_PRODUCTION) {
      const hostname = parsed.hostname.toLowerCase();
      if (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '0.0.0.0' ||
        hostname === '::1'
      ) {
        return { valid: false, error: 'Localhost not allowed in production' };
      }
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
  const urlValidation = validateWebhookUrl(webhook.url);
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
    const response = await fetchWithTimeout(webhook.url, {
      method: 'POST',
      headers,
      body: payloadStr,
      timeoutMs: config.timeoutMs,
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

/**
 * Get webhook secret (for admin purposes)
 * In production, this would integrate with a secret manager
 */
export async function getWebhookSecret(webhookId: string): Promise<string | null> {
  const envKey = `WEBHOOK_SECRET_${webhookId.slice(0, 8)}`;
  return process.env[envKey] || null;
}

// Re-export types and functions for convenience
export * from './types';
export * from './sign';
export * from './retry';
