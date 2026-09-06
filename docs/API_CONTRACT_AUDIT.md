# API contract audit — the document against the product

**Role:** `api-contract-architect` (activated 2026-08-20)
**Charge:** `proof:api-contract` gates the *shape*. Nobody had asked whether the
DOCUMENT still describes the product.

The answer was no, in four ways. Three are fixed here; all four are gated now.

---

## 1. The opening sentence asserted the opposite of what a fifth of the surface does

`info.description` in `lib/api-spec/v1-openapi.yaml` began:

> *Every route is tenant-scoped: the tenant is derived from the authenticated
> bearer token, never from a client-supplied id.*

That is true of `/v1/*`. It is the **inverse** of `/cp/v1/*`, which is 24 of the
59 operations the same document publishes (as of 2026-09-06, parsed from
`lib/api-spec/v1-openapi.yaml`; 21 of 55 when this was written). Every one of them declares
`security: []`, carries no principal, and is scoped only by a client-supplied
`?tenant=` query parameter — a fact `artifacts/api-server/src/routes/index.ts`
states plainly in a comment that never reached the contract.

The direction matters. A reader was told client-supplied ids are never trusted,
on a page where 21 operations trust nothing else.

**Fixed:** the description now separates the two surfaces and says which is
which, in the security-relevant direction.

## 2. A documented path is not necessarily a served one

The whole `/cp/v1/*` surface and `GET /v1/keys` are registered **only** under
the `review-demo` profile (`demoSurfacesEnabled()`). Under
`shared-device-gateway` they are not mounted and answer 404. The document said
nothing, so an integrator reading it would build against a control plane that
does not exist in the profile they deploy.

The runtime fence is right and its reasoning is good — an unauthenticated
control plane cannot be made safe by a check inside it, and a route that exists
and refuses still answers *"does this deployment have a control plane?"*. The
defect was that the fence was invisible to everyone who reads the contract
rather than the source.

**Fixed:** recorded in `info.description`, and in the launch profile's
`published-api-paths` note, which had not stated it either.

## 3. Three served routes had drifted out of the document

`GET /cp/v1/self-audit`, `GET /cp/v1/reliability`, `GET /cp/v1/iac` — served
from `routes/control-plane.ts`, absent from the spec, absent from the Postman
collection, and absent from the launch profile's classification.

**Fixed:** all three documented (with their honest fixture/real-run labelling
and their approval requirements), added to the collection, and classified
`deferred` alongside the other 21 control-plane paths.

They are `deferred` rather than `demo_only` deliberately. In this profile
`demo_only` means *ships never* — it holds exactly one entry, `/v1/keys`, the
credential dispenser. The control plane is a real product surface whose
**launch** is deferred; its unauthenticated fixture form is a demo
*implementation*, not a demo *purpose*. Collapsing the two would cost the
distinction that makes `demo_only` worth having.

## 4. The gate that should have caught all of it was narrower than the document

`scripts/src/api-contract-proof.ts` read one route file and compared only `/v1`.
It said so out loud — *"Only the /v1 surface is contract-checked here"* — and
then printed **"Contract holds: every /v1 route is documented and vice versa"**
on every run, while three routes on the same server, in the same spec file,
were drifted.

This is the shape the repository exists to catch: a gate whose scope is
narrower than the artifact it guards, phrased in a sentence broad enough to
read as complete coverage.

**Fixed.** The proof now covers `/v1` and `/cp/v1`, reads both route files from
a declared registry, and **fails if any registered file yields zero routes** —
because a matcher that silently stops matching under-reports the
implementation, and under-reporting fails in the direction that looks green.
Self-test 10/10 as of 2026-09-06 (`pnpm run proof:api-contract -- --self-test`; 7/7 when this
was written), including the multi-line `router.post(\n  "/path"` form the
original matcher happened to handle and a naive rewrite would not, and a
negative control reproducing the exact drift that shipped.

---

## Two more things this shift found on the way

**The launch-profile gate is spec-driven, not route-driven** — by design and for
a stated reason (a second route parser would drift on its own). The consequence
was not stated: the same three routes were invisible to the **breadth freeze**
too, for exactly the reason they were invisible to the contract proof. They
became classifiable the moment they were documented, and the gate then demanded
it immediately. That is the freeze working; it is also a reminder that a
spec-derived gate inherits every gap in the spec.

**A gate failed with an empty reason.** `scripts/safety-check.mjs` reported
`✗ Postman/spec drift:` and nothing else. It kept only the **last line** of the
checker's output via `.split("\n").pop()`, and the checker prints a headline
followed by one line per drifted path — so the headline was discarded and, on
some paths, the whole message. Now relays the checker's own output whole,
stderr included, with a fallback when the command produced none. Verified by
inducing a real drift, not by reading the patch.

---

## What is still not checked

Path-and-method parity is the shallow half of a contract. The document also
claims **response shapes and status codes**, and nothing compares those to what
the handlers return. Two known gaps, recorded rather than smoothed:

- `/v1/*` handlers wrap responses in `envelope(req, …)`; `/cp/v1/*` handlers
  return bare JSON. The spec describes cp responses in prose only
  (`description:` with no schema), so it makes no false claim — but it makes no
  checkable one either.
- Documented status codes (`400`, `403`, `404`, `429`) are not exercised against
  the routes that declare them.

`pnpm --filter @workspace/api-server run test:api` covers behaviour for the
routes it names; it is not driven from the spec, so a documented status nobody
implemented would pass both. **Next for this role.**

---

## Commands

```bash
pnpm run proof:api-contract              # served routes ↔ spec, both surfaces
pnpm run proof:api-contract --self-test  # prove the comparison can still fail
node scripts/check-launch-profile.mjs    # every published path classified
node scripts/build-postman.mjs --check   # collection covers every spec path
pnpm run safety:check                    # includes the drift relay fixed above
```
