# enterprise-auth vs a live Keycloak — a second DPoP implementation

`proof:live-keycloak` runs the repo's production token verifier (`lib/enterprise-auth`,
the one the API uses) against a real **Keycloak 26.4** over real HTTP. It is an opt-in
live proof following the `proof:live-edr` pattern: it REFUSES without `KEYCLOAK_URL`,
and the macOS harness skips it **by name**.

## Why, when `proof:live-idp` already does DPoP

`proof:live-idp` is a good proof — a complete DPoP ceremony against `oidc-provider`,
a certified implementation. But it shares a **runtime, a language and a JOSE stack**
with the code under test. Two implementations that agree while sharing their crypto
agree about less than it looks.

The Fleet lane taught this the expensive way: `telemetry/fleetdm.ts` passed every
fixture, and every route in it 404'd against a real server, because the fixtures were
written from the same assumptions as the code. A second, independent implementation
is the cheapest way to find out whether an agreement is real.

Keycloak is a different language (Java), a different JOSE stack, a different vendor,
in a separate process.

## What it proves that the in-process lane cannot

**RFC 7638 cross-implementation agreement.** We generate an EC key and compute its
thumbprint from first principles — SHA-256 over the required members only,
lexicographic, no whitespace — deliberately *without* a library, so agreement is about
the spec rather than about a shared dependency. Keycloak independently computes
`cnf.jkt` for the same key. They match.

That is not a formality. Reordering the JWK members from lexicographic
`{crv,kty,x,y}` to the natural-looking `{kty,crv,x,y}` produces a **completely
different** thumbprint:

```
keycloak = eFPVBNIrhWgjEA9TUxdF4flPF8h4HsJciYHT8WMQ-Zw
ours     = x6IbcgnIoJ3UtA9TzrfGy-HdlcmYs4aCESR78TgbIzY
```

Both sides would be internally consistent and neither would notice alone. Only a
second implementation catches it — the proof asserts this by construction.

It also proves the token is typed `DPoP` rather than `Bearer` (the binding is the
*server's* claim, not ours), that our verifier accepts a real token fetched over
Keycloak's real JWKS endpoint with no key injected, and that the issuer, audience and
signature gates still refuse a token that is genuine in every other respect.

## The integration work this lane surfaced

**Keycloak emits no tenant claim.** `tid` is an Entra-ism; `enterprise-auth` is
claim-mapped and requires one. A real deployment configures a protocol mapper — so
the proof's client carries two hardcoded-claim mappers, publishing the realm as `tid`
and a role as `roles`. That is genuine integration work an in-process provider hides,
because a test double is simply configured to emit whatever the test wants.

Also worth knowing: `enterprise-auth`'s `JwksFetch` returns a fetch-**like response**
(`ok`/`status`/`json()`), not a parsed body. Returning the body fails every
verification with `JWKS fetch failed: HTTP undefined` — and, more insidiously, makes
the negative assertions pass for free, because with no keys loaded every token is
refused. The proof now asserts each rejection is for its **own** reason (issuer,
audience, signature) and not a key-loading failure.

## Bring-up

```bash
docker run -d --name sg-keycloak -p 8480:8080 \
  -e KC_BOOTSTRAP_ADMIN_USERNAME=admin -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin \
  quay.io/keycloak/keycloak:26.4 start-dev --features=dpop
```

Then, with an admin token from `admin-cli` (password grant on the `master` realm):

1. Create a confidential client `sg-dpop` with `serviceAccountsEnabled: true` and the
   attribute `"dpop.bound.access.tokens": "true"`.
2. Add two `oidc-hardcoded-claim-mapper` protocol mappers to it — `tid` = the realm
   name, and `roles` = a role string (the proof maps `master` → a tenant and
   `service` → the `connector` role).

```bash
KEYCLOAK_URL=http://127.0.0.1:8480 pnpm run proof:live-keycloak
```

`KEYCLOAK_REALM`, `KEYCLOAK_CLIENT_ID` and `KEYCLOAK_CLIENT_SECRET` override the
defaults (`master` / `sg-dpop` / `sg-dpop-secret`).

Plain HTTP on loopback is deliberate: a disposable local server holding nothing. A
Keycloak holding anything real belongs behind TLS, with `NODE_EXTRA_CA_CERTS` set —
and the admin credentials above are demo values that must never leave a laptop.
