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

  it('requires explicit encryption key for ITSM credential encryption', async () => {
    vi.stubEnv('ITSM_ENCRYPTION_KEY', '');
    vi.stubEnv('ENCRYPTION_KEY', '');

    const { createITSMConfig } = await import('@/lib/integrations/itsm/store');

    await expect(
      createITSMConfig({
        name: 'ServiceNow Prod',
        vendor: 'servicenow',
        instanceUrl: 'https://acme.service-now.com',
        credentials: {
          username: 'admin',
          password: 'secret',
        },
      })
    ).rejects.toThrow('ITSM encryption key not configured');
  });
});
