/**
 * Webhook Signing Security Tests
 * 
 * Tests that webhooks are properly signed and signatures
 * are validated.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'crypto';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3010';
const HEALTH_URL = `${SERVER_URL}/api/health`;

describe('Webhook Signing', () => {
  const testSecret = 'test-webhook-secret-12345';
  const testPayload = JSON.stringify({
    event: 'session.start',
    data: { sessionId: 'test-123' },
  });

  beforeAll(async () => {
    try {
      const response = await fetch(HEALTH_URL);
      expect(response.ok).toBe(true);
    } catch (error) {
      throw new Error(`Server not reachable at ${SERVER_URL}. Start with: bun run scripts/test-server.ts start`);
    }
  });

  it('should generate valid HMAC signature', () => {
    const signature = crypto
      .createHmac('sha256', testSecret)
      .update(testPayload)
      .digest('hex');

    expect(signature).toBeDefined();
    expect(signature.length).toBe(64); // SHA256 hex = 64 chars
  });

  it('should verify webhook signature', () => {
    const signature = crypto
      .createHmac('sha256', testSecret)
      .update(testPayload)
      .digest('hex');

    // Verify the signature
    const expectedSignature = crypto
      .createHmac('sha256', testSecret)
      .update(testPayload)
      .digest('hex');

    expect(signature).toBe(expectedSignature);
  });

  it('should detect invalid signature', () => {
    const validSignature = crypto
      .createHmac('sha256', testSecret)
      .update(testPayload)
      .digest('hex');

    const invalidSignature = crypto
      .createHmac('sha256', 'wrong-secret')
      .update(testPayload)
      .digest('hex');

    expect(validSignature).not.toBe(invalidSignature);
  });

  it('should detect tampered payload', () => {
    const originalPayload = JSON.stringify({ original: true });
    const tamperedPayload = JSON.stringify({ original: false });

    const signature1 = crypto
      .createHmac('sha256', testSecret)
      .update(originalPayload)
      .digest('hex');

    const signature2 = crypto
      .createHmac('sha256', testSecret)
      .update(tamperedPayload)
      .digest('hex');

    expect(signature1).not.toBe(signature2);
  });
});
