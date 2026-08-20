# Identity live shape-check — what a real IdP actually puts on the wire

**Role:** `iam-domain` (activated 2026-08-20)
**Lab:** Keycloak 26.4 (`quay.io/keycloak/keycloak:26.4 start-dev --features=dpop`),
`master` realm at defaults, driven over real HTTP. Every value below was read off a
live server. Nothing here is from documentation unless it says so.

This is the identity counterpart to `docs/RADIUS_NAC_LIVE_SHAPE_CHECK.md`, and it
finds the same defect class in a different plane: **fields that read like
authentication facts, which the wire does not carry.**

---

## The headline: three fields the `sso-session` dimension names, and a real IdP does not emit

`sso-session` grades a session on `state`, `binding`, `assurance` and `freshness`.
Measured against Keycloak, at defaults:

| What the dimension asks | What Keycloak 26.4 actually emits | Verdict |
| --- | --- | --- |
| `assurance` — phishing-resistant / MFA / single-factor? | `acr: "1"` and **no `amr` claim at all** | **Not a wire fact** |
| `freshness` — fresh / near-expiry / expired? | `exp` on the token, which is **not** the session's | **Not a wire fact** |
| `binding` — is this session on THIS device the badge-holder's? | The session record has **no device field** | **Not a wire fact** |

### `amr` is absent from every surface

Checked all four places a resource server could look:

| Surface | `acr` | `amr` | `auth_time` |
| --- | --- | --- | --- |
| Access token | `"1"` | **absent** | **absent** |
| ID token | `"1"` | **absent** | **absent** |
| `/userinfo` | absent | **absent** | **absent** |
| Introspection (RFC 7662) | `"1"` | **absent** | **absent** |

`/userinfo` returns three claims total: `sub`, `preferred_username`,
`email_verified`.

So a bridge cannot distinguish `single_factor` from `mfa` from
`phishing_resistant` by reading a default Keycloak. The only lever is `acr`, and
`acr` is an **opaque integer whose meaning is deployment-configured** — the realm's
ACR-to-LoA map decides whether `"1"` means "password" or anything else. Two
deployments can emit the same `acr` for different authenticator strengths, and
neither would notice.

`auth_time` being absent is the same shape as the RADIUS finding that `lastAuthAt`
is not an authentication fact. `iat` is when the **token** was issued, not when the
**human** authenticated; a session refreshed at 09:00 from a password typed at 06:00
carries `iat: 09:00` and nothing else.

### The token's `exp` is not the session's lifetime, and the gap is three orders of magnitude

Read off the live realm:

| Setting | Value |
| --- | --- |
| `accessTokenLifespan` | **60 s** |
| `ssoSessionIdleTimeout` | **1800 s** (30 min) |
| `ssoSessionMaxLifespan` | **36000 s** (10 h) |

A bridge that computes `SessionFreshness` from the access token's `exp` reports
`near_expiry` or `expired` on a session with **up to ten hours left**. The ratio
between the two is 1:600 at stock settings.

Demonstrated rather than inferred. A token was minted, and 75 seconds later — past
its 60-second lifespan — both facts were read off the live server:

```
=== 75s later: is the ACCESS TOKEN still active? (lifespan 60s) ===
  active: False
=== is the SSO SESSION still there? (idle 1800s, max 36000s) ===
  live SSO sessions for nurse.alice: 4
```

The token is dead. Every session is alive. A `freshness` derived from the first
would have reported `expired` for all four. And the SSO session record carries no
expiry field of its own — only `start` and `lastAccess` — so freshness must be
computed from those against the realm policy, which is a second API call the token
does not hint at.

### The session record has no concept of a device

The admin session API (`/admin/realms/{realm}/users/{id}/sessions`) returns exactly:

```
id, username, userId, ipAddress, start, lastAccess, rememberMe, clients, transientUser
```

`ipAddress` is the closest thing to a device identifier, and it is not one. Two
logins by the same user from the same host produced **two separate SSO sessions**,
identical in every field except `id` and `start` — which is precisely the
leftover-session scenario `sso-session` exists to catch, and Keycloak cannot tell
the two apart by anything device-shaped.

**Consequence for anyone building the bridge:** the device↔session association is
*not* obtainable from the IdP. It has to come from the device side — the `sid` the
application on that device holds — and be joined to the IdP's session record. An
implementation that queries "sessions for this user" and assumes the first one is
the one in front of you is wrong in exactly the case the dimension was built for.

---

## What the code already gets right

None of the above is a bug in this repository, and it is worth being precise about
that rather than dressing a documentation gap as a defect.

`sso-session-connector.ts` **normalizes a bridge-supplied `report.freshness`**
through `oneOf(...)` with an `"unknown"` fallback; it never derives freshness from a
token. `types.ts` states outright that the dimension "consumes the evaluated session
state; it does not itself mint or refresh tokens", and `evaluate.ts` folds every
`unknown` into raising the bar rather than granting. The fail-closed law holds.

`SessionAssurance`'s doc comment already refuses to widen itself to cover credential
detail, pointing at `passkey-assurance` instead — the right call, and now with a
measured reason behind it: at session-evaluation time a real IdP gives you an
opaque `acr` and nothing else.

What was missing was the wire-truth record. The types describe what the decision
needs; nothing described what an IdP will actually hand you, so every bridge
implementer would rediscover the `amr` gap and the `exp` trap independently.

## Also confirmed live

`proof:live-keycloak` passes **14/14** against this lab, including the one that
matters most: Keycloak's `cnf.jkt` and this repository's independently-computed RFC
7638 thumbprint agree, across a different language and a different JOSE stack.

The lab's client setup is described in `docs/KEYCLOAK_LIVE_INTEGRATION.md` in prose
only. Following that prose, this shift configured the `roles` mapper with the claim
value `connector` rather than `service`, and the proof failed 13/14 on
`no role claim value in [connector] maps to a known role`. The prose is accurate —
it says the proof maps `service` → the `connector` role — but "a role string" ahead
of the parenthetical invites exactly that misreading. A setup script would not have
made the mistake.

## What is NOT established here

- **Only Keycloak was driven.** Entra, Okta and Ping are named in this role's
  charter and were not touched. Where they differ matters: Entra *does* emit `amr`,
  and Okta exposes richer session APIs. Treat the table above as "what one real,
  standards-compliant IdP does at defaults", not as a claim about every IdP.
- **`acr` was not driven through a stronger authenticator.** The realm's OTP policy
  is `totp` and WebAuthn is unconfigured; whether `acr` rises to `"2"` under a
  configured LoA map was not exercised, only read from the realm settings.
- Ten of this role's fifteen dimensions remain unverified against any live IdP.
  Naming that is the point: four dimensions checked properly is a smaller claim than
  fifteen checked superficially, and it is the true one.

## Reproducing

```bash
docker run -d --name sg-keycloak -p 8480:8080 \
  -e KC_BOOTSTRAP_ADMIN_USERNAME=admin -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin \
  quay.io/keycloak/keycloak:26.4 start-dev --features=dpop
KEYCLOAK_URL=http://127.0.0.1:8480 pnpm run proof:live-keycloak
```

Admin credentials above are throwaway values for a disposable local container
holding nothing, and must never leave a laptop. See
`docs/KEYCLOAK_LIVE_INTEGRATION.md` for the client this proof expects.
