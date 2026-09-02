import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const mockGetWebhooksForEvent = vi.fn();
const mockRecordDelivery = vi.fn();
const mockAddToDLQ = vi.fn();

vi.mock('@/lib/integrations/webhooks/store', () => ({
  getWebhooksForEvent: mockGetWebhooksForEvent,
  getWebhookSecretHash: vi.fn(),
  recordDelivery: mockRecordDelivery,
  addToDLQ: mockAddToDLQ,
}));

describe('fail-closed fallback hardening', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('requires explicit ADMIN_API_KEY in checkApiKey helper', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ADMIN_API_KEY', '');

    const { checkApiKey } = await import('@/lib/utils/apiKeyAuth');

    const request = {
      headers: new Headers({ 'X-API-Key': 'any-non-empty-key', 'x-request-id': 'req-1' }),
    } as unknown as NextRequest;

    const response = checkApiKey(request);
    expect(response?.status).toBe(500);
    expect(await response?.json()).toMatchObject({
      error: 'API key not configured',
      code: 'API_KEY_NOT_CONFIGURED',
      requestId: 'req-1',
    });
  });

  it('fails webhook dispatch when signing secret is missing', async () => {
    const webhookId = '12345678-abcd-4abc-8abc-123456789abc';

    mockGetWebhooksForEvent.mockResolvedValue([
      {
        id: webhookId,
        url: 'https://example.com/webhook',
        events: ['session.start'],
        enabled: true,
        createdAt: new Date().toISOString(),
      },
    ]);

    const { dispatchEvent } = await import('@/lib/integrations/webhooks/dispatch');

    const result = await dispatchEvent('session.start' as any, { ok: true });

    expect(result).toMatchObject({
      dispatched: 1,
      succeeded: 0,
      failed: 1,
    });
    expect(mockRecordDelivery).toHaveBeenCalledWith(
      webhookId,
      expect.any(String),
      'failed',
      undefined,
      undefined,
      'Webhook signing secret not configured'
    );
  });

  // RETIRED 2026-09-02 — 'requires explicit encryption key for ITSM credential
  // encryption'. It reached the guard through `createITSMConfig`, which 45cdecf
  // (Ponytail cut 1) deleted from lib/integrations/src/integrations/itsm/store.ts
  // as zero-importer CRUD; the symbol now exists nowhere in this repository, so
  // the block named a door that is gone.
  //
  // The INVARIANT it encoded did not go with it, and that is why this is a
  // retirement rather than a loss. `getEncryptionKey()` still throws
  // 'ITSM encryption key not configured' (itsm/store.ts:141-143), and that exact
  // refusal is already ported onto the live surface and EXECUTED on every push:
  // `proof:itsm-credential-crypto` drives it through `__cryptoInternals.deriveKey`
  // and asserts 'a missing key is refused' and 'an empty key is refused', plus the
  // short-key refusals this block never covered.
  //
  // Per this directory's README rule — porting a spec onto the monorepo retires it
  // here — the block is removed rather than re-pointed. The other two blocks above
  // stay: `@/lib/utils/apiKeyAuth` has no counterpart in this tree at all, and the
  // webhook signing-secret refusal (dispatch.ts:219) is live but unported.
});
