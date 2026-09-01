/**
 * Webhook Signing
 * 
 * HMAC-SHA256 signing for webhook payloads.
 * Uses per-endpoint secrets for security.
 */

import crypto from 'crypto';

/**
 * Sign a webhook payload using HMAC-SHA256
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
 * Create signed webhook headers
 */
export function createSignedHeaders(
  payload: string,
  secret: string,
  deliveryId: string,
  eventId: string
): Record<string, string> {
  const signature = signPayload(payload, secret);
  
  return {
    'Content-Type': 'application/json',
    'X-Webhook-Signature': signature,
    'X-Webhook-Delivery-Id': deliveryId,
    'X-Webhook-Event-Id': eventId,
    'X-Webhook-Timestamp': Date.now().toString(),
  };
}
