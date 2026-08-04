# Passkey assurance — a passkey is not a passkey

## Where this came from

A widely-shared framing: *"One of the biggest misconceptions I hear is: a passkey
is a passkey. All modern passkeys are phishing-resistant… however, they aren't all
designed for the same use case, recovery model or level of assurance."* The
recommendation attached to it is the familiar tier: synced passkeys for everyday
users, device-bound for business users, dedicated FIDO2 keys for privileged
accounts, a backup and a recovery plan for everyone.

The thesis is right. The line, checked against Microsoft's own Entra
documentation, falls somewhere slightly different — and the difference is exactly
what a decision fabric needs to get correct.

## Two corrections that change the verdict

**1. The boundary is ATTESTATION, not synced-versus-device-bound.**

> *"Unattested passkeys, including synced passkeys **and unattested device-bound
> passkeys**, don't provide device provenance."*
> — Microsoft Entra, *Authentication methods — passkeys (FIDO2)*

So an unattested device-bound passkey sits with synced passkeys, not with security
keys. "Device-bound = high assurance" holds only when attestation is enforced,
which is a passkey-profile setting an administrator has to turn on — not a property
of the credential type. Entra is explicit that enabling it *excludes* synced
passkeys from the profile entirely, and equally explicit about how to read an
unattested one:

> *"Treat synced passkeys as phishing-resistant credentials but with the same
> security posture as other unattested authenticators."*

A dimension that graded credential TYPE alone would reproduce the very
misconception it set out to correct, one tier over: it would grant to a
device-bound credential whose provenance was never verified.

**2. Synced custody is unknowable BY CONSTRUCTION, which forecloses rather than lowers.**

> *"Administrators can't see or control exactly which devices hold a copy of a
> synced passkey, nor can they query where a synced passkey has been synchronized."*
> — Microsoft Entra, *Frequently asked questions about passkeys*

This is not a weak signal that better tooling would sharpen. It is an axis with no
reading available to anyone. Under this fabric's grant discipline — a grant
requires positive confirmation of every input — that means a synced credential can
never confirm device custody, no matter how healthy every other axis is. On a
shared, badge-checked-out device, where the entire question is which human is
holding it, that is the decision.

## The dimension

`passkey-assurance` (`@workspace/integrations/passkey-assurance`) grades one
registered credential from the IdP's own authentication-methods export.
`evaluatePasskey` answers for ONE credential; `evaluateIdentityPasskeys` answers
for an identity, worst-wins across all of them (see below — that distinction is
load-bearing, not tidiness).

| Observation | Verdict | Why |
| --- | --- | --- |
| registered + security key or device-bound + **attestation verified** + user-verified + backed up + clean | `none` — the grant | provenance and custody both positively confirmed |
| **user verification discouraged** | `restrict` | possession only — single-factor wearing a phishing-resistant label. A known-false reliance, not an unknown |
| attestation **not provided** (either credential type) | `step_up` | no device provenance; the type alone earns nothing |
| credential is **synced** | `step_up` | custody unknowable by construction — forecloses the grant |
| attestation policy claims **enforced** while the credential is synced | `alert` | the platform is not applying the claimed control — config drift |
| **no backup** credential registered | `monitor` | one lost device from a lockout; flagged, not distrusted |
| not registered, or any TRUST axis unknown (type, attestation, policy, UV, parse, credential ref, identity ref) | `step_up` | unknown raises, never grants |
| **backup unknown** | `monitor` | the recovery axis only — an unreadable backup is a recovery gap, not a trust one |

Wire-level integrity: a report asserting `synced` **and** `attestation: verified`
describes something that cannot exist, so the normalizer marks it malformed rather
than merely surprising. Without that rule a hostile or buggy export could claim
both and collect the attestation half of the grant.

## Two scoping rules that are easy to get wrong

**User verification is graded at AUTHENTICATION, not registration.** WebAuthn's
registration-time `userVerification` is a *preference*; the authentication ceremony
independently decides whether to require UV and whether to reject an assertion
without the UV flag — this repo's own relying party requires it at authentication
(`lib/webauthn/src/webauthn/server.ts`). A credential registered "discouraged" but
always authenticated with UV required is **not** possession-only, so grading the
registration preference would restrict a perfectly sound credential. The wire field
is therefore `user_verification_policy`, and an integrator with only the
registration preference available must report `unknown` (which raises to `step_up`)
rather than asserting a fact that was never established.

**An identity is only as strong as its weakest credential.** The `backup` field
says *that* a second credential exists and deliberately nothing about its worth. An
identity holding an attested security key **and** a synced backup has a synced
authentication path, and an attacker uses the weakest path on offer. Reading a
per-credential `none` as an identity-level answer is a fail-open — and it was one
until a review caught it. `evaluateIdentityPasskeys` takes every registered
credential, grades each, and returns worst-wins plus `weakestCredentialRef` so
there is something concrete to go fix. An empty credential set is **not** a grant:
absence of evidence is not confirmation.

Every verdict carries `credentialRef`, so a per-credential answer cannot be mistaken
for an identity-wide one by a reader who only sees the payload.

**And the set must be evidently WHOLE before it can confirm.** Worst-wins is only
sound over every usable credential, and supplying a set does not establish that it
is complete — the connector reads one credential per call, so it structurally
cannot. So completeness is not a check the set can pass by default: an
**authoritative `expectedCredentialCount` is required for `identityConfirmed`**.
Without one, `evaluateIdentityPasskeys` still reports worst-wins over what it was
given, but returns `COMPLETENESS_UNPROVEN` and refuses to confirm — an unread axis
raises, and "is this every credential?" is an axis like any other. This was opt-in
until a review pointed out that an opt-in completeness check establishes nothing.

With a count in hand it fails closed on three signals of incompleteness: duplicate
credential refs (one credential counted twice is not two credentials); a report
asserting `backup: "registered"` while the set holds fewer than two distinct
credentials (the set contradicts its own contents); and a mismatch against the
count itself. `fetchNormalizedSet` takes the refs explicitly, so completeness is
the caller's visible responsibility rather than a silent assumption — and it marks
**substituted** reports malformed, because a source that answers a request for the
weak credential with a healthy *different* one would otherwise be graded as if the
requested credential had been read, and two such substitutions would satisfy the
count while the real credentials were never seen.

## Why `restrict` for missing user verification

Every other failure here raises to `step_up`, because an unread axis is a reason to
ask for more. Discouraged user verification is different in kind: the credential is
*known* to be exercisable on possession alone. That is the same shape as an OS
below its patch floor — something known-false is being relied upon — and it earns
the same rung. The distinction between "we could not read this" and "we read it and
it is bad" is the one the ladder exists to express, and the proof pins both sides:
`unknown` user verification raises to `step_up` with no critical finding, while
`discouraged` restricts and records one.

## What this replaces

`sso-session` grades a session's backing credential as
`phishing_resistant | mfa | single_factor | unknown`, with `phishing_resistant`
annotated *"(e.g. passkey / FIDO2 / platform)"*. That single bucket is the "a
passkey is a passkey" misconception encoded as a type: it cannot distinguish a
synced credential on a personal phone from a FIDO2 key in a badge holder. This
dimension supplies the missing resolution. `sso-session` is unchanged — it still
answers *"was this session backed by something phishing-resistant?"*, which is a
real question — but the fabric no longer has to stop there.

## Boundaries

- **Read-only.** Registration, revocation, and passkey-profile configuration stay
  with the IdP. Fixture-gated like every connector; `resolvePasskeyConnector`
  never makes a live call outside beta/prod with an explicit token.
- **It does not try to locate a synced passkey's copies.** That is precisely the
  thing no administrator can query, and pretending otherwise would be the
  fail-open this dimension exists to catch. `custody` is DERIVED from the
  credential type and the report is not entitled to overrule it.
- **It does not re-implement WebAuthn verification.** `lib/webauthn` verifies an
  assertion; this grades the standing worth of the credential behind it.
- Registered with the mutation guard from day one (TARGETS, zero survivors), not
  queued.

## One disagreement with the source framing

The post's *"business users → device-bound passkeys"* pushes device-bound one tier
lower than Microsoft's own guidance, which is device-bound for admins and
privileged users and synced for all non-admin users. That is a defensible
organizational choice, but it is a cost-and-recovery tradeoff rather than a
security given — and device-bound credentials have the *worse* recovery story,
which sits awkwardly beside the post's own insistence that everyone needs a
recovery plan. This dimension takes no position on which tier a given population
should hold; it grades what a credential actually is, and `recoveryRisk` makes the
tradeoff visible instead of implicit.

Proven by `proof:passkey-assurance` (87 checks; the three headline claims pinned
individually, per-field integrity, hostile shapes, both grant-safety enumerations
including a non-vacuity guard, the identity-level worst-wins aggregation, and the
connector surface; deterministic, offline).
