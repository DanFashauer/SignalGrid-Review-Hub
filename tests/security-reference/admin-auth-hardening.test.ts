import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

function createRequest(headers: Record<string, string> = {}): NextRequest {
  return {
    headers: new Headers(headers),
  } as unknown as NextRequest;
}

describe('admin auth hardening', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('rejects arbitrary non-empty admin key when API-key mode is active', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ENABLE_DEV_BYPASS', 'true');
    vi.stubEnv('ADMIN_API_KEY', 'expected-admin-key');

    const { authenticateAdminRequest } = await import('@/lib/auth');
    const request = createRequest({ 'x-admin-api-key': 'totally-wrong-but-non-empty' });

    const auth = await authenticateAdminRequest(request);

    expect(auth.authenticated).toBe(false);
    expect(auth.method).toBe('api-key');
  });

  it('still accepts explicit configured admin key in dev bypass mode', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ENABLE_DEV_BYPASS', 'true');
    vi.stubEnv('ADMIN_API_KEY', 'expected-admin-key');

    const { authenticateAdminRequest } = await import('@/lib/auth');
    const request = createRequest({ 'x-admin-api-key': 'expected-admin-key' });

    const auth = await authenticateAdminRequest(request);

    expect(auth.authenticated).toBe(true);
    expect(auth.method).toBe('api-key');
    expect(auth.roles).toEqual(['admin']);
  });
});
