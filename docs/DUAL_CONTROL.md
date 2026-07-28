# Dual control — two-person integrity for the one action that can't be undone

## The gap

The market has largely solved elevated **access**. Microsoft Entra PIM does
just-in-time role activation; every PAM vendor brokers a privileged session;
FIDO2 keys (YubiKey 5C NFC, Google Titan) prove one strong gesture; SignalGrid's
own [`pim-activation`](../lib/pim-activation) surface answers *may this one
requester activate this role, right now, given the device the grid can see*.

None of them enforce the control the highest-consequence actions actually
need: **two people.** A break-glass into a specialty admin account that lives
outside the normal AD tree, a bulk export of a whole patient index, a
privileged config change to the trust fabric itself — these are the actions
where a single compromised or coerced credential should not be enough, no
matter how strong the gesture behind it. Hospitals already know this: a
controlled-substance cabinet requires **two authorized people, each with their
own key, at the same time.** That is dual control, and software elevation has
mostly never had it.

`pim-activation` routes what it can't auto-approve to an approver group — but
that is an **asynchronous, single-approver** review: one person clicks approve,
later, from somewhere else. It is the right control for most elevations and the
wrong one for the few that can destroy a tenant. Those need two authorized
humans, **concurrently present**, each **independently verified**, each
**binding their gesture to the same specific action**, with **neither able to
stand in for the other.** That rule is this surface, and only this surface.

## Why this is SignalGrid's to own

SignalGrid's thesis is **runtime judgment** — fuse the context and return
allow / step-up / restrict / deny at the moment an action fires. Dual control is
that thesis at its sharpest: the judgment that *this* action, at *this* blast
radius, requires two-person integrity before it is released. SignalGrid
releases nothing itself. It answers `Granted` / `SecondAuthorizerRequired` /
`Denied` and records the evidence; the host system performs the action, or not,
on that answer.

## The primitive

`@workspace/dual-control` (`lib/dual-control`) is a pure, deterministic decision
surface — no clock, no randomness. A request carries the **action** (an id and a
class) and **two authorizer attestations** (initiator and second authorizer).
Each attestation carries an opaque identity reference, the **specific
authenticator instance** that signed, whether the user-verification gesture
(biometric + PIN, the two-factor "key") positively completed, whether that
gesture was **bound to this exact action**, and whether that identity is in the
**permitted authorizer set** for the action. Whether the two gestures landed
inside the bounded co-presence window is computed by the runtime that owns the
clock and handed in as `coPresence` — exactly as `pim-activation` takes
`signalsFresh`.

The ladder is three-way, and — as in `pim-activation` — the middle rung is a
state of the process, not a middle severity:

- **Granted** is the release, and it carries the discipline the whole repo
  applies to a grant: **positive confirmation of every input.** A known action
  class, a concrete action id, two positively-**distinct** identities, two
  positively-**distinct** credential instances, both authorizers user-verified,
  both bound to this action, both role-authorized, co-presence confirmed, and a
  request that parsed cleanly. Anything short of all of it does not grant.
- **SecondAuthorizerRequired** is the default and the safe non-grant. Every
  **unknown** lands here — a malformed envelope, an unestablished co-presence, an
  authorizer who hasn't yet verified, a distinctness that can't be determined. It
  neither releases the action nor punishes the first authorizer; it says "not
  enough, yet", which is the honest answer whenever two-person integrity is not
  yet positively proven.
- **Denied** is reserved for **affirmative bad facts**: the two authorizers are
  the same person (self-authorization), one credential signed both halves (a
  shared token — a single point of forgery, not dual control), an authorizer's
  verification explicitly failed, a gesture was bound to a *different* action (a
  replay), an authorizer is explicitly not permitted, or the two authorizations
  were explicitly **not** concurrent (the window expired).

Two invariants make this genuinely two-person and not "two clicks":

- **Distinct identities.** The initiator and second authorizer must be
  positively different people. Same identity → `Denied` (self-authorization).
  Distinctness is *derived* from the two references, never guessed from an
  absence: one reference missing yields "unknown", not "distinct".
- **Distinct credential instances.** One stolen or shared authenticator cannot
  sign both halves. Same credential → `Denied` (shared credential). This is the
  invariant a phone-case-mounted hardware token is built to satisfy: the second
  authorizer's key is physically a different device.

## Right fit, not more friction

This product exists to **reduce** fatigue, not add a two-person ceremony to
every click. The design principle is the opposite of "dual-control everything":
the grid selects dual control **only** for the actions whose blast radius
warrants it, and leaves everything else to the lighter gates (a single step-up,
a PIM activation, nothing at all). Forcing two-person integrity on a routine
action is exactly the friction to avoid; withholding it from the one action that
can destroy a tenant is exactly the failure to prevent. **Picking the right fit
per action is the whole point** — the same "smart enterprise" logic that lets a
smart home lock only the doors that matter.

## Where it sits next to the access brokers

Dual control does not replace the access layer — it **composes** with it, and the
composition is the honest division of labor:

| Layer | Question it answers | Example |
| --- | --- | --- |
| Okta AI Agent Gateway / Entra Agent ID | *Who is this actor and what may it reach?* | agent identity, scoped token |
| WebAuthn / FIDO2 (YubiKey, Titan) | *Did one strong gesture happen?* | one Face ID / security-key tap |
| `token-binding` | *Can this token be replayed?* | DPoP / mTLS vs bearer |
| `pim-activation` | *May this one requester activate this role now?* | JIT elevation, async approver |
| **`dual-control`** | *Are two distinct, authorized people concurrently authorizing THIS action?* | break-glass, bulk export |

The brokers establish *who*. `dual-control` establishes *that two of them, right
now, together, said yes to this specific thing.* That is the layer above access,
and it is where the irreversible actions live.

## Proof

`pnpm run proof:dual-control` (43 checks) is fully offline and deterministic. It
asserts the three outcomes, every affirmative-bad deny, and every unknown routing
to `SecondAuthorizerRequired`; it feeds hostile request shapes (prototype-inherited
keys, aliased keys inside an authorizer, descriptor-hiding and throwing proxies,
non-object bodies, string-quoted booleans) and confirms none can reach a grant;
and it brute-forces the grant path twice — over the **full normalized decision
space** and over a **hostile raw-wire space** through the real normalizer —
asserting `Granted` is emitted for **exactly** the one fully-confirmed state and
for nothing else. The enumeration counts are published on the proof's `figures=`
line and guarded against doc drift.

## Boundary

Not legal, clinical, or compliance advice, and not a claim of production
readiness. SignalGrid activates nothing and writes nothing back to any system —
it answers the dual-control question and records the evidence. The hardware that
makes a second, physically-distinct token convenient at the point of action is a
separate, honestly-bounded concept: see
[Elevated-access hardware token](HARDWARE_ELEVATED_ACCESS_TOKEN.md).
