# negative-tests/ — refusals on schedule

These requests prove the API **refuses correctly** — a passing negative test is
a refusal happening on schedule. Each file carries an `assert`/`tests` block
pinning the exact expected failure status, read from the route handlers rather
than guessed:

| Request | Expects | Why that status |
| --- | --- | --- |
| `unauthenticated-context.bru` | 401 | `requireTenantContext` fails closed: no bearer is a 401, never a default tenant (`middlewares/context.ts`). |
| `cross-tenant-decision.bru` | 404 | Every lookup is keyed on (id, tenant-from-token), so another tenant's id is served the **same 404** as a nonexistent one — existence is never leaked as a 403 (`routes/v1.ts`). Run the compliant evaluate first so `decisionId` holds a Northwind decision. |
| `malformed-evaluate.bru` | 400 | `parseEvaluate` requires `identityRef`, `deviceRef`, `workflowKey` as strings; partial input is a clean validation 400, never a decision. |
| `gateway-fence-demo-route.bru` | 404 | The GA fence 404s everything outside `GA_ALLOWED_ROUTES`. **Proves only under `SIGNALGRID_PRODUCT_PROFILE=shared-device-gateway`** — under the default review-demo profile `/v1/keys` legitimately serves 200 and this test fails, correctly. |

Run the first three against the ordinary fixture server (`PORT=5310 pnpm
--filter @workspace/api-server run dev`). For the fence test, start the server
with `SIGNALGRID_PRODUCT_PROFILE=shared-device-gateway` set.
