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

/**
 * Verify a webhook signature (for webhook endpoints that need to verify incoming calls)
 */
export function verifySignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expected = signPayload(payload, secret);
  const provided = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  // timingSafeEqual throws a RangeError on length-mismatched buffers, which a
  // caller expecting a boolean would surface as a crash rather than a rejected
  // signature. Length divergence already means the signatures differ, so fail
  // closed (return false) instead of throwing.
  if (provided.length !== expectedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(provided, expectedBuf);
}

/**
 * Generate a new webhook secret
 */
export function generateSecret(length = 32): string {
  return crypto.randomBytes(length).toString('hex');
}
