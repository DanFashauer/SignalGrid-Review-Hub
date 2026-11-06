<!-- STAGING NOTE — strip before publication.
Draft 4 of the article series queued in `docs/COMPANY_BUILD_PLAN.md` row 24
("the one-IdP Keycloak caveat"), staged for the owner's review only. The
owner has not reviewed or approved this draft, and no venue is chosen for it:
DR-005 item 2 named signalgrid.app's company blog for the first piece
specifically, and that does not by itself carry to this one. `sso-session`
is a DEFERRED connector family under `scripts/launch-profile.mjs` — this is
engineering prose about an unshipped connector's design, not a claim that
SignalGrid evaluates SSO sessions in any deployment today. The one-IdP
caveat is in the lede on purpose (row 24's corrected framing); do not move
it below the fold in any edit.
PUBLISHING IS THE OWNER'S SEND — nothing here authorizes posting it anywhere.
-->

# What one real IdP actually puts on the wire about a session

One caveat before anything else, because it bounds every sentence below:
**we drove exactly one identity provider — Keycloak 26.4, `master` realm at
defaults — and none of this generalizes to any other.** Entra, Okta and Ping
were not touched. The record this piece comes from notes, without having
driven either, that Entra does emit `amr` and that Okta exposes richer session APIs;
we did not verify either, and if you run one of those, your wire may differ
from ours in exactly the places this article cares about. Read what follows
as "what one standards-compliant IdP does at defaults," not as a claim about
IdPs.

With that fence up: a session check on a shared device wants to know three
things about the live SSO session — how strongly the person authenticated,
how much life the session has left, and whether the session in front of you
is the badge-holder's own. Our session dimension models those as
`assurance`, `freshness` and `binding`. We pointed a real Keycloak at them,
over real HTTP, and read what it actually emits. None of the three is a wire
fact:

| What the dimension asks | What Keycloak 26.4 emitted at defaults |
| --- | --- |
| `assurance` — phishing-resistant, MFA, or single-factor? | `acr: "1"` and no `amr` claim at all |
| `freshness` — fresh, near expiry, or expired? | `exp` on the token, which is not the session's lifetime |
| `binding` — is this session on this device the badge-holder's? | a session record with no device field |

## `amr` and `auth_time` are absent everywhere we looked

Across the OIDC client and the session bridge there are four places to look
for authentication facts: the ID token belongs to the client that asked for
it, and the other three are what a resource server or the bridge can read.
We checked all four:

| Surface | `acr` | `amr` | `auth_time` |
| --- | --- | --- | --- |
| Access token | `"1"` | absent | absent |
| ID token | `"1"` | absent | absent |
| `/userinfo` | absent | absent | absent |
| Introspection (RFC 7662) | `"1"` | absent | absent |

`/userinfo` returned three claims in total: `sub`, `preferred_username`,
`email_verified`. So a bridge reading a default Keycloak cannot tell
single-factor from MFA from phishing-resistant. The only lever left is `acr`,
and `acr` is an opaque value whose meaning the realm's ACR-to-LoA map
decides — two deployments can emit the same `"1"` for authenticators of
different strength, and neither would notice.

`auth_time` being absent matters just as much. `iat` is when the *token* was
issued, not when the *human* authenticated: a session refreshed at 09:00
from a password typed at 06:00 carries `iat: 09:00` and nothing else. That
is the same defect class our RADIUS lab found in a different plane, where a
`lastAuthAt` field read like an authentication fact the wire did not carry.

## The token's `exp` is not the session's lifetime

Read off the live realm: `accessTokenLifespan` 60 s,
`ssoSessionIdleTimeout` 1800 s, `ssoSessionMaxLifespan` 36000 s. At stock
settings, the access token lives one six-hundredth as long as the session
can. A bridge that computes freshness from the token's `exp` reports
`near_expiry` or `expired` on a session with up to ten hours left.

We demonstrated it rather than inferring it. A token was minted, and 75
seconds later — past its 60-second lifespan — both facts were read off the
server:

```
=== 75s later: is the ACCESS TOKEN still active? (lifespan 60s) ===
  active: False
=== is the SSO SESSION still there? (idle 1800s, max 36000s) ===
  live SSO sessions for nurse.alice: 4
```

The token was dead; the session it came from was alive, and so were three
other sessions for the same user. A freshness derived from that token would
have called its session expired while the IdP still held it open. Only one
token's expiry was observed, so this says nothing about the other three
sessions' tokens. And the session
record carries no expiry field of its own — only `start` and `lastAccess` —
so real freshness has to be computed from those against the realm's policy,
a second API call the token gives no hint of.

## The session record has no concept of a device

Keycloak's admin session API returns exactly these fields per session:

```
id, username, userId, ipAddress, start, lastAccess, rememberMe, clients, transientUser
```

`ipAddress` is the nearest thing to a device identifier, and it is not one.
Two logins by the same user from the same host produced two separate SSO
sessions, identical in every field except `id` and `start`. Nothing
device-shaped tells the two apart. That is not yet the leftover-session case
a shared-device session check exists to catch — the previous user's session
still live when a different person picks the device up — and this run did
not exercise a two-user handoff; `username` and `userId` would tell two
people apart. What it shows is narrower: the IdP cannot say which device a
session is on.

The consequence for anyone building the bridge: the device-to-session
association is not obtainable from this IdP. It has to come from the device
side — the session identifier the application on that device holds — and be
joined to the IdP's record. An implementation that asks for "sessions for
this user" and takes the first one is wrong in precisely the case the check
was built for.

## What the code already got right, and what was missing

None of this was a bug in the evaluator, and it is worth being precise about
that rather than dressing a documentation gap up as a defect. The connector
never derives freshness from a token: it normalizes a bridge-supplied
`freshness` (and `assurance`, and `binding`) through an allowlist with an
`unknown` fallback. The types state outright that the dimension "consumes
the evaluated session state; it does not itself mint or refresh tokens."
And the evaluator treats an `unknown` freshness or assurance as a reason to
step up, never to grant — only a session positively confirmed active, fresh
and MFA-backed or phishing-resistant reaches the top tier. The assurance type also already
declines to widen itself into credential detail, pointing at a sibling
passkey dimension instead; at session-evaluation time, a default Keycloak
gives you an opaque `acr` and nothing else, so that refusal now has a
measured reason behind it.

What was missing was the wire-truth record. The types described what the
decision needs; nothing described what an IdP will actually hand you, so
every bridge implementer would have rediscovered the `amr` gap and the `exp`
trap on their own. That record now exists, and our wire-truth ledger binds
it to the session types and the normalizer it checked, with the
divergence quoted verbatim.

The same lab also re-ran our DPoP proof against Keycloak and recorded it
passing 14/14, including Keycloak's `cnf.jkt` agreeing with our
independently computed RFC 7638 thumbprint across a different language and
JOSE stack. On the way there it failed 13/14 once, because the client was
set up by following prose that invites a misread mapper value — a small
argument for setup scripts over setup paragraphs.

**How these claims trace.** The Keycloak observations are a recorded, dated
observation (2026-08-19, per the ledger entry), not a rerunnable fixture:
the reads of `amr`, `auth_time`, the realm lifespans, the 75-second run and
the session fields were made against a disposable local container, and the
committed `proof:live-keycloak` does not re-check any of them — it is
DPoP-scoped. The shape-check record gives the container command and the proof
invocation, which bring up a Keycloak but not these observations: it does
not create the user, drive the login, query the four surfaces or the admin
sessions, or run the 75-second check. Treat the session-shape claims as a
historical record, not something the cited record lets you replay. The 14/14 and 13/14
are that record's report of a run, not a line this tree prints on demand
without a Keycloak to point at.

Worth being explicit about the boundary: one IdP, at defaults, was driven.
`acr` was not driven through a stronger authenticator — the realm's OTP
policy is `totp` and WebAuthn was unconfigured, so whether `acr` rises
under a configured LoA map was read from settings, not exercised. Entra,
Okta and Ping were not driven at all. The connector this describes is not
shipped; nothing here evaluates live SSO sessions anywhere today.

**Sources.** The lab, every value in the tables, the 75-second run, the
session field list and the scope limits: `docs/IDENTITY_LIVE_SHAPE_CHECK.md`
(the headline table; "`amr` is absent from every surface"; "The token's
`exp` is not the session's lifetime"; "The session record has no concept of
a device"; "Also confirmed live"; "What is NOT established here"). The
RADIUS `lastAuthAt` parallel: `docs/RADIUS_NAC_LIVE_SHAPE_CHECK.md`. The
allowlist normalization: `lib/integrations/src/integrations/sso-session/sso-session-connector.ts`
(`oneOf`, and `normalizeReport`'s `assurance`/`freshness` lines). The
"does not itself mint or refresh tokens" sentence and the assurance type's
refusal to widen: `lib/integrations/src/integrations/sso-session/types.ts`
(file header and the `SessionAssurance` doc comment). The step-up on
`unknown`: `lib/integrations/src/integrations/sso-session/evaluate.ts`
(the freshness and assurance branches). The ledger binding and date:
`docs/agent/wire-truth-ledger.json`, entry `identity-shape-check-sso-session`.
The DPoP lab and its client setup: `docs/KEYCLOAK_LIVE_INTEGRATION.md` and
`scripts/src/live-keycloak-proof.ts`. The deferred classification:
`scripts/launch-profile.mjs` (connector families).

---

*This came out of checking the SSO session shape SignalGrid's decision core
would consume against one real identity provider's wire. What SignalGrid
is — canonical, not paraphrased here — is [`docs/PURPOSE.md`](PURPOSE.md)
(DR-020); the full lab notes for this piece are public in our review
repository.*
