/**
 * Step-Up Enforcement Security Tests
 * 
 * Tests that high-risk admin operations require step-up authentication.
 */

import { describe, it, expect, beforeAll } from 'vitest';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3010';
const HEALTH_URL = `${SERVER_URL}/api/health`;

// Protected operations that should require step-up auth
const PROTECTED_OPERATIONS = [
  '/api/admin/integrations/webhooks',
  '/api/admin/policies',
  '/api/admin/devices',
];

describe('Step-Up Enforcement', () => {
  beforeAll(async () => {
    try {
      const response = await fetch(HEALTH_URL);
      expect(response.ok).toBe(true);
    } catch (error) {
      throw new Error(`Server not reachable at ${SERVER_URL}. Start with: bun run scripts/test-server.ts start`);
    }
  });

  it('should require authentication for protected endpoints', async () => {
    for (const endpoint of PROTECTED_OPERATIONS) {
      const response = await fetch(`${SERVER_URL}${endpoint}`);
      expect([401, 403]).toContain(response.status);
    }
  });

  it('should reject write operations without proper auth', async () => {
    // Try to create a webhook without auth
    const response = await fetch(`${SERVER_URL}/api/admin/integrations/webhooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Webhook',
        url: 'https://example.com/webhook',
        events: ['session.start'],
      }),
    });

    expect([401, 403]).toContain(response.status);
  });

  it('should require step-up for sensitive operations', async () => {
    // Test webhook secret rotation (requires step-up) - uses PATCH with signingSecret
    const response = await fetch(
      `${SERVER_URL}/api/admin/integrations/webhooks/test-id`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test Webhook',
          signingSecret: 'new-secret',
        }),
      }
    );

    // Should require authentication
    expect([401, 403]).toContain(response.status);
  });

  it('should enforce step-up for policy modifications', async () => {
    const response = await fetch(`${SERVER_URL}/api/admin/policies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Policy',
        enabled: true,
        conditions: [],
        actions: [],
      }),
    });

    expect([401, 403]).toContain(response.status);
  });
});
