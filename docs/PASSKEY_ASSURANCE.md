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
registered credential from the IdP's own authentication-methods export:

| Observation | Verdict | Why |
| --- | --- | --- |
| registered + security key or device-bound + **attestation verified** + user-verified + backed up + clean | `none` — the grant | provenance and custody both positively confirmed |
| **user verification discouraged** | `restrict` | possession only — single-factor wearing a phishing-resistant label. A known-false reliance, not an unknown |
| attestation **not provided** (either credential type) | `step_up` | no device provenance; the type alone earns nothing |
| credential is **synced** | `step_up` | custody unknowable by construction — forecloses the grant |
| attestation policy claims **enforced** while the credential is synced | `alert` | the platform is not applying the claimed control — config drift |
| **no backup** credential registered | `monitor` | one lost device from a lockout; flagged, not distrusted |
| not registered, or any axis unknown | `step_up` | unknown raises, never grants |

Wire-level integrity: a report asserting `synced` **and** `attestation: verified`
describes something that cannot exist, so the normalizer marks it malformed rather
than merely surprising. Without that rule a hostile or buggy export could claim
both and collect the attestation half of the grant.

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

Proven by `proof:passkey-assurance` (51 checks; the three headline claims pinned
individually, per-field integrity, hostile shapes, both grant-safety enumerations
including a non-vacuity guard, connector surface; deterministic, offline).
