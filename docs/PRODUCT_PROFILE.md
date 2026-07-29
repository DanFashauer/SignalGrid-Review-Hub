# Product profile — what a customer deployment refuses

## The finding

An audit of the running api-server found three surfaces that are correct for a public
review deployment and unacceptable in front of a customer:

| Surface | What it does | Why it survived |
| --- | --- | --- |
| `GET /v1/keys` | Registered **above** the auth guard, and `DEMO_KEYS` carries the **raw** bearer — so it publishes an owner token for all seven seeded tenants to anonymous callers | The route's own neighbouring comment already said *"any visitor can satisfy the role check … must not be inherited by a real deployment"*. Prose, no gate. |
| `POST /api/sim/room-entry` | Mounted with no auth; derives a tenant from a **client-supplied** `scenarioId`, mints that tenant's operator/owner token, and **writes** — decision, snapshot, two audit-ledger appends, a metrics increment | Nothing asserted it should require auth |
| `/cp/v1` (whole plane) | Mounted with no auth, so its client-supplied `?tenant=` query parameter is the only scoping present | Same |

**The `/v1` isolation model underneath is sound, and this is not a fix to it.** Every one
of the 32 `/v1` routes derives its tenant from the verified bearer; `parseEvaluate`
whitelists request fields and drops a body `tenantId`; and `scoped()` returns the same 404
for a cross-tenant read as for a nonexistent id, so there is no existence oracle. These
three are demo scaffolding reachable *in front of* a correct model.

**The uncomfortable part.** `api.test.mjs` asserted `"keys discovery is public (200)"` and
that a **government-tenant owner key is discoverable** — while spawning that server with
`NODE_ENV=production`. The suite never missed the leak; it certified it. `NODE_ENV` was
never the right signal: it says how Node should behave, not whether a customer is on the
other end.

## The switch

```bash
SIGNALGRID_PRODUCT_PROFILE=shared-device-gateway
```

| Profile | Demo surfaces | When |
| --- | --- | --- |
| `review-demo` (default, and what an unset or unrecognized value resolves to) | served | the public review deployment |
| `shared-device-gateway` | refused | a customer deployment |

**Additive by construction.** With nothing set, every surface behaves exactly as before —
the demo surfaces are how this repo is publicly reviewable, so switching them off is opt-in
and an existing deployment changes nothing by upgrading.

The fail direction is deliberately the **opposite** of `resolveTier`'s. An unreadable
*tier* must not enable live vendor calls; an unreadable *profile* must not switch off the
surfaces a reviewer depends on. The shared rule is that an unknown value resolves to the
option that changes nothing — it points opposite ways because the risky option differs.

Under `shared-device-gateway`, observed on a real booted server:

- `/v1/keys` → **401**, not 404. With the route unregistered the path falls under the `/v1`
  auth guard like every other `/v1` path, so it now *demands* a credential instead of
  handing one out.
- `/api/sim/room-entry` → **404**. Not mounted rather than 403'd: a route that exists and
  refuses still answers *"does this deployment have a simulator?"*.
- `/cp/v1/tenants` → **404**. Same reasoning.
- A demo bearer on `/v1/context` → **401**. With no OIDC configured there is no credential
  a gateway deployment can legitimately accept, so it refuses rather than degrading to the
  fixture keys — which are exactly the tokens `/v1/keys` used to publish.
- `/healthz` → **200**, so the refusals above are refusals and not a dead port.

## What proves it

`pnpm --filter @workspace/api-server run test:api` — the wire behaviour, in **both**
profiles, against a really-booted server.

A standalone `proof:product-profile` was written first and then deleted. It exercised the
predicate rather than the server, which is the weaker claim; and importing the api-server
module into `scripts/` crosses a package boundary this repo deliberately does not cross —
the existing proofs that touch the api-server reference it as a PATH (read the file, or
spawn the built server), never as a TypeScript import. Two gates asserting the same thing
at different strengths is how the weaker one ends up being the one people trust. The demo assertions are unchanged and still run; a fourth short-lived server runs the
gateway profile and asserts each refusal, plus a `/healthz` check so a failed-to-boot
server cannot satisfy a suite of absence assertions — every gateway check asserts an
ABSENCE, and a dead port would satisfy all of them.

Both halves are gated because the risk runs both ways: a switch that silently broke the
demo would trade one credibility problem for another.

## What this does NOT do

It does not narrow the supported product surface to the gateway — connectors, verticals and
the other `/v1` routes are untouched. It gates **demo affordances** only. A profile that
also restricts which dimensions are supported is separate work, and claiming it here would
be the kind of overstatement the rest of this repo's guards exist to prevent.
