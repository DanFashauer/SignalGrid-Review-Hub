// REFERENCE DOCUMENT — EXECUTED BY NO LANE. Read this file as a specification to port,
// never as coverage. Nothing in this repository runs it.
//
// VERIFIED AT THIS TREE (2026-09-02) by search, not memory: this file is named by no
// script in `package.json` or `scripts/package.json`, by no gate in
// `scripts/preflight.mjs`, by no step in any `.github/workflows/*.yml`, and by no line
// of `validate-sim-macos.sh`. It is a Vitest spec; no Vitest is installed here, `tests/`
// sits outside the pnpm workspace, and `@/lib/utils/apiKeyAuth` — imported below — does
// not exist in this repository. See `tests/security-reference/README.md`.
//
// THE UNRUN-NESS IS DECLARED AND GATED, which is the only reason it is allowed to sit
// here. `scripts/check-test-execution.mjs` derives the reachable runner set from the
// real entry points and FAILS on any test-shaped file that neither runs nor carries a
// written reason; `tests/security-reference/` carries one, and a stale declaration is
// itself fatal. That gate runs in both lanes:
//   · scripts/preflight.mjs:185 — "Test execution (a test no runner reaches is not coverage; self-tested)"
//   · .github/workflows/review-hub-ci.yml:288-289 — "Test execution (a test no runner reaches is not coverage)"
//
// WHERE EACH INVARIANT BELOW ACTUALLY LIVES, said block by block, because "a spec
// exists" is not "the behaviour is held":
//   · ITSM encryption-key refusal (RETIRED at the foot of this file) — HELD AND
//     EXECUTED by `proof:itsm-credential-crypto`, at scripts/preflight.mjs:319 and
//     .github/workflows/review-hub-ci.yml:662-663.
//   · `checkApiKey` refusing an unset ADMIN_API_KEY — NOT HELD ANYWHERE. There is no
//     `@/lib/utils/apiKeyAuth` counterpart in this tree, and `ADMIN_API_KEY` appears in
//     no source file here (only in these specs and in native/ios/README.md prose).
//   · Webhook dispatch failing without a signing secret — the CODE is live
//     (lib/integrations/src/integrations/webhooks/dispatch.ts:218) but NO lane drives
//     it: `proof:webhooks` (scripts/verify-breadth.mjs:103) covers outbound delivery
//     gating and never exercises the missing-secret path.
//
// Do not wire this file up to close that gap — it addresses a server that does not
// exist here. Port each block onto the /v1 surface, then delete it, per this
// directory's README rule.
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
