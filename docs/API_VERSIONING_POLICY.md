# API Versioning Policy — what `/v1` promises and how it is allowed to change

The `/v1` prefix is a **contract**, not a namespace. This page says exactly what
that contract permits, what it forbids, and how a client finds out about change —
so "we won't break you" is a checkable claim rather than a vibe. The enforcement
lives in code: the OpenAPI contract gate holds `lib/api-spec/v1-openapi.yaml`
against the running server, and the API test suite
(`artifacts/api-server/test/api.test.mjs`) asserts response **bodies**, so a
shape change that would break a client breaks the build first.

## What `/v1` may do without notice (additive, non-breaking)

- Add a **new route** under `/v1`.
- Add a **new field** to a response object. Clients must ignore fields they do
  not recognize — this is the one obligation the contract places on *them*.
- Add a **new optional** request field or query parameter, with behavior
  unchanged when it is absent.
- Add new `reasonCodes` values, signal kinds, or enum members that are already
  documented as open sets.
- Tighten a rate limit or loosen one (the limits are operational, documented in
  the spec's rate-limiting section, and never part of the compatibility promise;
  the 429 *shape* is part of the promise).

## What `/v1` may never do (breaking — requires `/v2`)

- Remove or rename a route, a response field, or an enum member a client could
  already receive.
- Change a field's type or meaning, or make an optional request field required.
- Change the **error envelope**. Every error of every class answers the flat
  `{requestId, error, message}` shape; that shape is load-bearing for clients
  and is asserted on bodies in the test suite.
- Change authentication semantics on an existing route (the 401-before-404
  anti-enumeration ordering included).

There is no `/v2` today and none is planned; this section exists so that the
day one is proposed, the bar it must clear is already written down.

## How change is announced: `Deprecation` and `Sunset`

A route is never removed or incompatibly changed without a machine-readable
warning period. A deprecated route answers with:

- `Deprecation: @<unix-seconds>` (RFC 9745) — when the deprecation was declared.
- `Sunset: <HTTP-date>` (RFC 8594) — the earliest moment the route may stop
  answering.
- Optionally `Link: <url>; rel="deprecation"` — where the replacement is
  documented.

The mechanism is **already served** (`artifacts/api-server/src/middlewares/deprecation.ts`)
and its registry is **empty** — both facts asserted live in the test suite: no
route today carries a `Deprecation` header, and an injected registry entry
produces the headers in the documented wire format. Shipping the mechanism
before it is needed is deliberate: a policy that names headers nothing can
serve is a promise with no delivery path.

Deprecating a route is a scope decision, not an edit: it changes the launch
surface, so it goes through the same ratification as any status change in
`scripts/launch-profile.mjs`.

## What the version in the spec means

`info.version` in `lib/api-spec/v1-openapi.yaml` tracks the *document*, not the
contract: it may move on any additive change. The contract's identity is the
`/v1` path prefix, and it changes only by the rules above.

## Infrastructure endpoints are outside the contract

`/healthz` (liveness) and `/readyz` (readiness) are deliberately not in the
OpenAPI document — they are probes for the machine running the service, not for
integrators, and their shape may evolve with operational needs. What *is*
promised: `/healthz` stays pure liveness (no dependency checks), and `/readyz`
stays fail-closed (a configured-but-unreachable durable store answers 503).
