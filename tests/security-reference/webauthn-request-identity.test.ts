import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

function createRequest(headers: Record<string, string> = {}): NextRequest {
  return {
    headers: new Headers(headers),
  } as unknown as NextRequest;
}

describe('webauthn request identity hardening', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('fails closed when no user identity is provided and dev bypass is disabled', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ENABLE_DEV_BYPASS', 'false');

    const { getWebAuthnRequestIdentity } = await import('@/app/api/admin/webauthn/requestIdentity');

    const result = getWebAuthnRequestIdentity(createRequest());

    expect(result.identity).toBeNull();
    expect(result.errorResponse?.status).toBe(401);
    await expect(result.errorResponse?.json()).resolves.toMatchObject({
      error: expect.stringContaining('Missing user identity for WebAuthn request'),
    });
  });

  it('derives stable user identity from x-admin-api-key when x-user-id is absent', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    const { getWebAuthnRequestIdentity } = await import('@/app/api/admin/webauthn/requestIdentity');

    const result = getWebAuthnRequestIdentity(
      createRequest({
        'x-admin-api-key': 'configured-admin-key',
      })
    );

    expect(result.errorResponse).toBeNull();
    expect(result.identity?.userId).toMatch(/^api-key-user:[a-f0-9]{16}$/);
    expect(result.identity?.userEmail).toBe(`${result.identity?.userId}@local.invalid`);
    expect(result.identity?.displayName).toBe(result.identity?.userId);
  });

  it('allows explicit dev fallback identity only with development bypass', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ENABLE_DEV_BYPASS', 'true');

    const { getWebAuthnRequestIdentity } = await import('@/app/api/admin/webauthn/requestIdentity');

    const result = getWebAuthnRequestIdentity(createRequest());

    expect(result.errorResponse).toBeNull();
    expect(result.identity).toEqual({
      userId: 'dev-admin-user',
      userEmail: 'dev-admin@example.local',
      displayName: 'Dev Admin User',
    });
  });
});
