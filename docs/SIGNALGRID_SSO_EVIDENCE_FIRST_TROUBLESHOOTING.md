# SSO Evidence-First Troubleshooting: First Relevant Divergence

> **Configured ≠ Emitted ≠ Delivered ≠ Processed ≠ Validated ≠ Identified ≠ Authorized ≠ Secure.**
> **Every transition is a claim. Every claim deserves evidence.**

**STATUS: DOCTRINE — NOT BUILT.** SignalGrid has no SAML transaction model, no SAML
connector family, and no `SAML_*` reason code. This document is the specification for
one, plus a method that already applies to everything the product *does* do. Read §7
before quoting any of it to a customer.

---

## 1. Why this is a doctrine document and not a feature

The bad SSO troubleshooting loop is universal and it looks like work:

```text
user cannot log in
  → reset password
  → clear cache
  → reassign the app
  → regenerate the certificate
  → it works now, nobody knows why
```

Every step is plausible. Several of them change security-relevant configuration. None of
them established *where the transaction actually diverged from what was expected*, so
the fix is a guess and the next occurrence starts from zero.

The correct loop asks six questions instead:

```text
What should have happened?
What actually happened?
At which boundary did it FIRST diverge?
What evidence proves that divergence?
What is the smallest justified remediation?
Did the full path retest — functionally, then securely?
```

This is the same shape as SignalGrid's core law. "Every affirmative must be earned"
applied to a federation transaction reads: **every green state must be earned at the
exact boundary where it is claimed.**

---

## 2. The transition chain

Eight states, seven transitions between them, and the entire method is the refusal to
collapse any two of them:

| State | Means | Does **not** mean the next one |
| --- | --- | --- |
| **Configured** | somebody set it in a console | that anything emitted it |
| **Emitted** | the IdP produced it | that it arrived |
| **Delivered** | it reached the SP's endpoint | that the SP processed it |
| **Processed** | the SP parsed it | that it validated |
| **Validated** | signature, issuer, audience, time all checked | that an identity resolved |
| **Identified** | a local user was resolved | that they are authorized |
| **Authorized** | policy permits the action | that the session is secure |
| **Secure** | the session itself is sound | — |

This generalizes far past SAML, which is why it belongs in this repository rather than
in a runbook. The same chain, in other clothes, is the defect class this codebase keeps
finding:

```text
Graph configured        ≠ connector healthy
token acquired          ≠ device trustworthy
Intune says compliant   ≠ compliance is current
a status                ≠ a diagnosis
nothing observed        ≠ nothing wrong
a rule exists           ≠ a rule fires
a gate is written       ≠ a gate runs in CI
```

Each of those has cost this project a real defect. See
`SIGNALGRID_ZERO_TRUST_DECISION_PRINCIPLES.md` §6 and `pnpm run proof:absent-collection`.

---

## 3. The seven validation boundaries

A federation transaction is not one event. It is seven, each with an owner:

| # | Boundary | What it establishes | Owner when it diverges |
| --- | --- | --- | --- |
| 1 | Request Generation | what the SP actually asked for | application owner |
| 2 | IdP Processing | what the IdP received and how it evaluated it | identity platform owner |
| 3 | Response Delivery | whether the response reached the right endpoint | application / network owner |
| 4 | Response Validation | signature, certificate, issuer, audience, recipient, time, replay | identity platform owner |
| 5 | Identity Mapping | which local account the assertion resolved to | application owner |
| 6 | Authorization | whether that account may perform this action | application owner |
| 7 | Session Establishment | whether the resulting session is itself secure | application owner |

The browser transports messages between SP and IdP. **It is not a trust anchor** and
must never be treated as evidence of anything but transport.

### Per-boundary questions

**1 · Request Generation** — What Entity ID did the SP use? Which ACS endpoint did it
request? Which binding? Was the AuthnRequest signed? What `NameIDPolicy` or
`RequestedAuthnContext` was asked for? Was RelayState present?

**2 · IdP Processing** — Which enterprise application participated? What request did the
IdP actually receive? Did authentication succeed? Which access controls participated —
MFA, conditional access, risk? Was app assignment required, and satisfied? Which tenant
and service principal?

**3 · Response Delivery** — Was a response issued? Did the browser POST it to the
correct ACS? Was it blocked, lost, modified, or delivered somewhere else?

**4 · Response Validation** — Did the signature verify against *trusted* signing
material? Is the certificate current, and was a rollover handled? Do issuer, audience,
recipient and destination match? Are the time conditions inside skew? Was `InResponseTo`
checked? Is replay resisted? Is the response shaped in a way that invites XML signature
wrapping?

**5 · Identity Mapping** — Which claim or NameID was used? Is it unique? Is it *stable*?
Did it map to exactly one local account? Were the required attributes actually emitted —
as opposed to configured?

**6 · Authorization** — Was the user authenticated but not authorized? Does the app
require its own role assignment? Did the claim map to the expected role? Does the app
enforce its own authorization boundary at all?

**7 · Session Establishment** — Is the cookie secure? Is the lifetime appropriate? Was
session fixation avoided? Is the session bound to the right user *and* tenant? Is logout
handled?

---

## 4. The "don't assume" rules

Seven collapses that look like success and are not:

```text
IdP sign-in success   ≠ SSO success
configured claim      ≠ claim emitted
response received     ≠ validation passed
signature element     ≠ signature valid
known certificate     ≠ trusted certificate
identity resolved     ≠ identity authorized
access granted        ≠ session secure
```

Stated as engine obligations, for when this is built:

- If IdP authentication succeeded but SP response validation failed, SignalGrid **must
  not** report SSO success.
- If a claim is configured but absent from the emitted assertion, SignalGrid must report
  **claim-emission divergence** — not "misconfiguration."
- If a user maps successfully but app authorization fails, SignalGrid must report
  **authenticated-not-authorized**, not a generic login failure.

---

## 5. The method

```text
1  collect evidence            logs, IDs, requests, responses, configs
2  correlate                   one unified transaction timeline
3  compare                     expected vs observed, across BOTH lanes
4  identify first divergence   the EARLIEST relevant one
5  targeted validation         validate the hypothesis with focused evidence
6  establish root cause        prove the cause with evidence
7  minimum justified fix       change only what is necessary
8  end-to-end retest           functional
9  security validation         then security review
```

**Rule: do not remediate downstream conditions until the earliest divergence is
understood.** Later stages may also show differences — they are usually *consequences*.
Fixing a consequence produces the worst outcome available: the symptom disappears, the
cause remains, and a security-relevant setting was changed for no reason.

The failure this prevents, concretely:

```text
observed:   SAML response failed validation
bad fix:    add the user to another group          ← changes access, fixes nothing
real cause: SP expected Entity ID A, IdP emitted audience B
```

or:

```text
observed:   intermittent login failures after Tuesday
bad fix:    regenerate the SP certificate           ← breaks every other SP
real cause: IdP signing certificate rolled; SP still trusts only the old one
```

---

## 6. Decision impact — how this *would* affect a workflow

A federation divergence should not blanket-block everything. Impact depends on the
boundary and the risk of the action. This table is **DOCTRINE** for the build:

| First relevant divergence | Low-risk workflow | Critical workflow |
| --- | --- | --- |
| Request generation mismatch | monitor / step-up | restrict |
| IdP authentication failed | deny | deny |
| MFA not satisfied | step-up | restrict unless step-up can be completed |
| Response delivery failure | step-up | restrict |
| Response validation failed | deny | deny |
| Identity mapping failed | deny | deny |
| Authorization failed | restrict | deny |
| Session insecure | restrict | deny |
| Certificate rollover unverified | step-up | deny |
| Missing optional claim | monitor | step-up if policy requires it |

Note the two `deny` columns that never soften: **validation** and **identity mapping**.
A response that cannot be validated, or that resolves to no one, is not a degraded
allow — it is not evidence at all.

---

## 7. What exists today, precisely

The honest boundary, so nothing here is mistaken for shipping product.

**Not built.** No SAML transaction model. No seven-boundary evidence record. No first-
relevant-divergence analysis. No `SAML_*` reason code — and none has been minted, for
the same reason the `ZERO_TRUST_*` codes were not: **a reason code no rule emits is a
string that looks like evidence and is not.** Roughly eighty were proposed alongside
this document. Minting them would put eighty claims into the operator console and the
assessor package that nothing in the engine can produce. They are kept here as a
*specification* for the build, which is a real artifact, rather than as product
vocabulary, which would be a false one. `scripts/check-it-layer-model.mjs` enforces the
same rule mechanically for the codes that do exist: classified-but-never-emitted fails.

**Built, and adjacent.** Five families already grade federation *evidence* — as opposed
to troubleshooting a *transaction*:

| Family | Question it answers |
| --- | --- |
| `sso-session` | Is this session bound to this person on this shared device, or inherited? |
| `platform-sso` | Which platform credential method and policy is in play? |
| `passkey-assurance` | What is this credential actually worth — attestation, custody, user verification? |
| `token-binding` | Proof-of-possession, or a replayable bearer token? |
| `oauth-consent` | What was delegated, to what workload, by whom? |

That distinction is the gap in one sentence: **SignalGrid can currently judge the
federation evidence it is handed; it cannot yet tell you where the federation
transaction broke.**

**The ordering rule for closing it**, same as everywhere else in this repository:
**boundary model first, rule second, reason code third, doc fourth.** Never the reverse.

---

## 8. What this means for the launch workstreams

**Graph-backed transport.** No SAML involvement — Graph sync is OAuth client
credentials. The doctrine still applies verbatim: *token acquired ≠ connector healthy*,
*request sent ≠ evidence processed*, *data received ≠ normalized signal trusted*.

**Public / private boundary.** Enterprise SSO configuration must **fail closed**.
Invalid metadata, wrong issuer, wrong audience, missing role mapping, or absent
enterprise auth must all refuse — and none of them may fall back to demo credentials. An
SSO misconfiguration that degrades into a demo key is the worst failure mode available,
because it looks like it worked.

**Assessor package.** The method is the contribution: evidence first, first relevant
divergence, minimum justified remediation, end-to-end retest, security validation after
the functional fix.

### Assessor tests, for when the model is built

1. IdP sign-in succeeds but SAML audience mismatches → **no** SSO success reported.
2. Response received but signature invalid → deny.
3. Claim configured but not emitted → claim-emission divergence, not "misconfigured."
4. NameID maps to no user → identity mapping failure.
5. User authenticated but not assigned to the app → authenticated-not-authorized.
6. Certificate rollover not trusted by the SP → response validation failure.
7. RelayState missing or tampered → response/session validation failure.
8. Session created with insecure cookie settings → access granted, **not** secure.
9. The first divergence is reported *earlier* than the downstream failures it caused.
10. Remediation targets the first divergence, not a later symptom.

Tests 9 and 10 are the ones that actually test the method. The other eight test the
boundaries.

---

## Positioning

> **SignalGrid does not ask "did SSO work?" It asks "where did trust first diverge from
> evidence?"**

And the layer this sits in — Identity & Access Management for the boundaries, IT Service
Management for the loop — is recorded in
`SIGNALGRID_ENTERPRISE_IT_LAYER_MODEL.md`.

Related: `SIGNALGRID_ZERO_TRUST_DECISION_PRINCIPLES.md`,
`AUTHENTICATION_AND_CREDENTIAL_ARCHITECTURE.md`, `SIGNALGRID_ENTERPRISE_IT_LAYER_MODEL.md`.
