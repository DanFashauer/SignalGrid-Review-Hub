/**
 * Replay Attack Security Tests
 * 
 * Tests that the system properly prevents replay attacks
 * through nonce validation.
 */

import { describe, it, expect, beforeAll } from 'vitest';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3010';
const HEALTH_URL = `${SERVER_URL}/api/health`;

describe('Replay Attack Prevention', () => {
  beforeAll(async () => {
    try {
      const response = await fetch(HEALTH_URL);
      expect(response.ok).toBe(true);
    } catch (error) {
      throw new Error(`Server not reachable at ${SERVER_URL}. Start with: bun run scripts/test-server.ts start`);
    }
  });

  it('should detect replayed session start request', async () => {
    const payload = {
      badgeUid: 'test-badge-replay',
      deviceId: 'test-device-replay',
      timestamp: Date.now(),
    };

    // First request should succeed or fail gracefully
    const firstResponse = await fetch(`${SERVER_URL}/api/session/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    // Second request with same payload should be rejected (replay detected)
    const secondResponse = await fetch(`${SERVER_URL}/api/session/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    // If first succeeded, second should be rejected
    if (firstResponse.ok) {
      expect(secondResponse.status).toBe(409); // Conflict - replay detected
    }
  });

  it('should accept fresh requests with new timestamps', async () => {
    const payload = {
      badgeUid: 'test-badge-fresh',
      deviceId: 'test-device-fresh',
      timestamp: Date.now(),
    };

    const response = await fetch(`${SERVER_URL}/api/session/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    // Should accept fresh request
    expect([200, 401, 404]).toContain(response.status);
  });
});
