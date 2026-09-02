# SignalGrid Authentication and Credential Architecture

## Status and boundary

This is the authoritative **target architecture** for a future private,
customer-capable SignalGrid core. Review Hub remains fixture-backed: it contains
no live credentials, tenant identifiers, customer authority, or vendor calls.

**What already exists here, stated so this page does not understate its own
repository** (added 2026-08-15 — an architecture doc that reads as "nothing is
built" ages just as badly as one that overclaims): the token-verification layer
is built and proof-gated in this public repo. `@workspace/enterprise-auth` is
the production verifier, and `proof:live-idp` exercises it against a real,
certified OpenID Connect provider booted in-process — real RS256 signatures
from the provider's own keystore and a real JWKS fetch; the DPoP `cnf.jkt`
binding is demonstrated at the IdP/client level (RFC 7638 thumbprint agreement
with the provider), not validated by the token verifier itself — covering a substantial slice of the negative-test families listed at
the bottom of this page (forged signature, `alg` confusion, wrong issuer, wrong
audience, expiry, token-type confusion). What remains future, exactly as this
page frames it: the customer-capable PROFILE around that verifier — user store,
rotation, revocation, enterprise session lifecycle — and any live Microsoft
Graph transport. Verifier: built and proven. Credential lifecycle: not built,
and not claimed.

## Keep the layers separate

- **OAuth 2.0** is an authorization framework for obtaining limited access to a
  resource.
- **OpenID Connect (OIDC)** adds end-user authentication and identity claims on
  top of OAuth 2.0.
- **JWT** is a compact claims representation. It may carry an ID token, access
  token, client assertion, or capability, but the format alone does not prove a
  human identity, authorize an action, prevent replay, or provide revocation.
- **API keys** are credentials that usually identify an integration, project,
  application, or service account. They do not carry standardized human
  authentication, assurance, consent, or delegation semantics.

OAuth and JWT are therefore not competing choices. An OAuth deployment may use
opaque access tokens, JWT access tokens, refresh tokens, authorization codes,
and signed JWT client assertions. “Stateless JWT authentication” is not an
architectural requirement: revocation, refresh rotation, replay detection,
authorization lookup, key rotation, and sessions may all require server state.

## Authoritative principle

> Authentication proves the actor. Authorization defines permitted access.
> Token format carries claims or evidence. SignalGrid policy decides whether the
> actor, application, device, workflow, and requested action should be trusted
> now.

## Surface matrix

| Surface | Principal | Target mechanism | Credential or proof |
| --- | --- | --- | --- |
| Operator console | Human | Entra ID OIDC authorization code + PKCE S256, preferably behind a BFF/server session | Audience-restricted access token plus secure session |
| High-risk step-up | Human | Phishing-resistant WebAuthn/passkey | Verified signed authenticator assertion |
| Microsoft Graph connector | Workload | OAuth client credentials with tenant-scoped, read-only application permission | Managed identity, workload federation, or certificate assertion; secret only as a temporary fallback |
| Host backend | Workload | OAuth client credentials | SignalGrid-audience access token with application role such as `decision.evaluate` |
| Host on behalf of user | Human + application | Delegated OAuth access token or validated on-behalf-of flow | User access token retaining both client and subject context |
| Offline mobile device | Device + bounded user/workflow | Short-lived, sender-bound capability lease | Signed JWT or COSE object; encoding is secondary to constraints |
| Webhook sender | Service | **Outbound signing is scheme v2 (shipped):** HMAC-SHA256 over `` `${timestampMs}.${rawBody}` ``, signature marked `v2=`, timestamp in epoch **milliseconds** and *inside* the MAC. Mutual TLS remains TARGET. | `X-Webhook-Signature: v2=<hex>` + `X-Webhook-Timestamp`, delivery ID, and a receiver-side replay window. **The retired v1 scheme — an unprefixed signature over the body alone — is not accepted; there is no dual-accept.** Key/certificate rotation remains TARGET. |

The webhook row is the one line in this table whose "timestamp … and replay window"
half is implemented rather than aspirational. Canonical spec, the reconstruction
string, the derived tolerance floor, and the no-dual-accept rule live in
[`docs/SIGNALGRID_SECURITY_OPERATIONS_EVIDENCE_MODEL.md`](SIGNALGRID_SECURITY_OPERATIONS_EVIDENCE_MODEL.md)
§6; the code is `lib/integrations/src/integrations/webhooks/sign.ts` and the gate is
`pnpm run proof:webhooks`. Inbound verification is a reference implementation driven
by that proof — **no inbound route in this repository verifies a webhook.**
| Public demo | Synthetic fixture | Demo-only credential | Never accepted by a customer-capable profile |

An ID token is for the client that performed sign-in and must not be used as a
SignalGrid API access token. A host application must not invent authoritative
user, tenant, device, or role context in unsigned request JSON.

## Validation baseline

Every accepted token path must, as applicable:

1. Verify the cryptographic signature with an approved, trusted key source.
2. Allowlist algorithms; never select trust from an attacker-controlled header.
3. Verify issuer and exact audience.
4. Verify expiration and not-before with a deliberately small clock-skew policy.
5. Distinguish ID, access, client-assertion, and capability token types.
6. Validate key identifier and discovery source without accepting arbitrary URLs.
7. Validate tenant membership, client application, scopes, roles, and subject.
8. Prevent token substitution across clients, APIs, tenants, or token types.
9. Apply replay detection or sender constraint where bearer-token theft is a
   material risk.
10. Fail closed on ambiguous, missing, malformed, stale, or unverifiable claims.

Authorization remains a separate server-side decision after token validation.
Possession of a structurally valid JWT does not imply permission.

## Surface requirements

### Human operator console

- Use OIDC authorization code with PKCE S256.
- Prefer a BFF or server-managed session so browser JavaScript does not retain
  long-lived bearer credentials.
- Require phishing-resistant MFA where available and WebAuthn/passkey step-up
  for high-risk approval.
- Validate issuer, audience, tenant, subject, client ID, roles/scopes,
  authentication context, authentication method, and lifetime.
- Bind privileged approval to the decision, action, tenant, policy version, and
  short validity window; an ordinary login is not reusable approval.

### Microsoft Graph connector

- Use OAuth client credentials with a distinct tenant-scoped workload identity.
- Prefer managed identity, then workload identity federation, then a certificate
  or private-key client assertion. Treat a client secret as temporary fallback.
- Request only approved read-only application permissions.
- Never use a pasted long-lived bearer token, static Graph API key, shared
  cross-tenant credential, committed secret, or plaintext stored secret.
- Cache normalized, provenance-bearing signals; do not make Graph a synchronous
  dependency of the decision path.

### Host applications

- Application-only requests use OAuth client credentials and an
  audience-restricted SignalGrid token with an explicit application role.
- User-delegated requests use a delegated access token or validated on-behalf-of
  exchange.
- Preserve and authorize the calling application and human subject separately.
- Derive authoritative tenant and principal context from verified credentials,
  never from client-provided identity fields.

### Offline mobile operation

A signed offline capability lease must be short-lived and include:

`tenant`, device binding, identity binding, workflow, permitted actions, policy
version, issued time, expiry, maximum offline age, evidence digest, unique lease
ID, and exact audience.

The verifier must enforce minimum permissions, one workflow, replay resistance,
a local append-only decision ledger, no silent offline renewal, and revocation
processing on reconnection. Copyable bearer JWTs are insufficient where theft
is material; require device-held proof and sender binding. A lost or stolen
device moves the lease to untrusted as soon as revocation state is available.

### Webhooks

Protect the exact body, not merely the HTTP caller. Require HMAC over the
canonical payload or mutual TLS, plus timestamp, unique delivery ID, body digest,
idempotency key, bounded replay window, rotating keys, and constant-time MAC
comparison. An API key header alone is insufficient.

### Public and customer-capable profiles

The public review/demo profile may use synthetic keys only for fixture tenants
and public-safe data. A future customer-capable profile must:

- omit the `/v1/keys` route entirely;
- reject every demo credential;
- fail startup if enterprise authentication is missing or invalid;
- prohibit fixture authentication fallback;
- require tenant, issuer, and audience validation on every protected path.

## Normalized authentication context

Every authenticated request and resulting decision should preserve these fields
where applicable:

```text
principalType          principalId          subjectId
tenantId               clientId             credentialClass
grantType              tokenFormat          issuer
audience               scopes               roles
authenticationMethod   authenticationStrength
senderBinding          tokenId              issuedAt
expiresAt              revocationState      stepUpCapability
offlineAuthorityState  sourceReference
```

Secrets, raw tokens, private keys, session cookies, authorization codes, and
reusable authenticator material must never enter decision evidence or logs.
Where correlation is required, store a non-secret reference or one-way digest
with a documented retention limit.

## Required reason codes

```text
AUTHENTICATION_REQUIRED
TOKEN_SIGNATURE_INVALID
TOKEN_ISSUER_UNTRUSTED
TOKEN_AUDIENCE_MISMATCH
TOKEN_EXPIRED
TOKEN_NOT_YET_VALID
TOKEN_TYPE_MISMATCH
TOKEN_REPLAY_SUSPECTED
TOKEN_SENDER_BINDING_MISSING
CLIENT_ROLE_INSUFFICIENT
USER_CONTEXT_UNVERIFIED
TENANT_MAPPING_UNRESOLVED
API_KEY_NOT_ALLOWED_IN_PROFILE
DEMO_CREDENTIAL_REJECTED
WORKLOAD_CREDENTIAL_WEAK
OFFLINE_LEASE_EXPIRED
OFFLINE_LEASE_SCOPE_MISMATCH
STEP_UP_REQUIRED
STEP_UP_UNANSWERABLE
```

These are target private-core contract values. Adding them to the deterministic
decision engine is a separate, proof-covered change; this document does not
alter simulator outcomes.

## Delivery gates

### Graph transport gate

Evidence must show OAuth client credentials, preferred workload credential,
read-only application permissions, tenant-scoped connector identity, safe secret
handling, throttling/retry behavior, and no live data committed to Review Hub.

### Public/private boundary gate

Negative tests must prove the customer-capable profile has no key-mint/list
surface, rejects demo tokens, cannot boot without enterprise authentication,
has no fixture fallback, and fails closed for invalid tenant or audience.

### Assessor package gate

The package must contain the authentication-flow and authorization matrices,
token-validation rules, credential inventory, rotation and revocation
procedures, offline model, lost-device response, and negative-test evidence.

## Required negative-test families

- forged signature, `alg` confusion, unknown key, malicious key URL;
- issuer, audience, tenant, client, token-type, scope, and role mismatch;
- expired, future-dated, excessive-lifetime, replayed, and revoked token;
- ID-token-as-access-token and cross-API token substitution;
- missing device/sender binding where policy requires it;
- demo credential and API-key use in the customer-capable profile;
- invented user context in a workload request;
- expired, copied, wrong-device, wrong-workflow, and over-scoped offline lease;
- webhook body mutation, stale timestamp, duplicate delivery, and wrong key.

No failure above may reach an `allow` outcome. High-risk step-up that cannot be
answered must remain restricted or denied, never silently downgraded.
