# SignalGrid Security Operations Evidence Fabric

> **Security operations detect, validate, investigate, and respond. SignalGrid decides
> what that evidence means for the workflow happening now — and holds the restriction
> until recovery is proven, not merely ticketed.**

Nested inside `SIGNALGRID_ENTERPRISE_IT_LAYER_MODEL.md`, under its **IT Security & Risk
Management** layer. That layer's four domains are closed — *Cybersecurity · Threat
Detection & Response · Identity & Access Management · IT Risk Assessment* — and the
twelve security-operations domains below are read as evidence classes **inside** those
four, not as new domains. The layer-model gate rejects a domain that is not one of the
four, which is the gate working, not a limitation.

Every claim here is tagged **PROVEN** (a gate re-checks it on every commit),
**STRUCTURAL** (true by a type or an absent code path), **SPECIFICATION** (a shape
proposed for a later phase, deliberately not on the wire), or **DOCTRINE** (a design
principle, not yet mechanically checked). The tag is the honesty contract: read it
before you read the sentence.

Enforced by `scripts/src/security-operations-evidence-proof.ts` (`pnpm run
proof:security-operations-evidence`).
Companions: `SIGNALGRID_ZERO_TRUST_DECISION_PRINCIPLES.md`,
`SIGNALGRID_ENTERPRISE_IT_LAYER_MODEL.md`, `SIGNALGRID_ENTERPRISE_ITSM_LAYER_MODEL.md`,
`SIGNALGRID_SSO_EVIDENCE_FIRST_TROUBLESHOOTING.md`.

---

## 1. Purpose

A security stack produces findings. It does not, by itself, know what a finding means
for the medication pass, the inventory adjustment, or the plant-floor change happening
on a shared device right now. That translation — *finding → what should happen to this
workflow* — is the gap this model closes.

The organizing claim, in one line:

> **Detection is not decision. Triage is not recovery. Remediation is not verified
> until evidence proves it.** SignalGrid connects the chain, and holds the line until
> it's proven.

And the rule that keeps it honest **(DOCTRINE)**:

> Security evidence can raise friction or restrict risk. It must not create trust by
> itself. *Logging coverage healthy* ≠ *this event was captured*. *EDR installed* ≠
> *this device is safe now*.

---

## 2. The defensive chain, as evidence classes

Twelve security-operations domains, recorded so a later edit is visibly an edit. Each is
an **evidence class** — a distinct kind of thing the estate can prove — not a scoring
input to be collapsed into one vague "security risk".

| # | Domain | What it contributes | Existing SignalGrid family |
| --- | --- | --- | --- |
| 1 | SIEM & telemetry | log-source coverage, correlation, alert severity, retention | `siem` |
| 2 | SOC triage | validate → classify → escalate → investigate → close, with an owner | — (specification) |
| 3 | Penetration / adversarial validation | exploitability, proof of impact, remediation retest | — (specification) |
| 4 | Malware & threat analysis | IOCs, behaviour, persistence, C2, exfiltration, impact | `edr-threat` |
| 5 | Cryptographic trust | signatures, hashes, keys, certificates, TLS, replay | *(§6 — partly real, partly fixture)* |
| 6 | Network security controls | segmentation, firewall, VPN, IDS/IPS, protocol, monitoring | `network-nac`, `nac` |
| 7 | Web / API security | OWASP, access control, input validation, sessions, headers | *(SignalGrid's own API — §7)* |
| 8 | Linux / host security | hardening, SSH, services, patching, file integrity, audit | `credential-exposure`, `vuln-scan` |
| 9 | Incident response | identify → contain → eradicate → recover → learn | *(partly modelled — §5)* |
| 10 | Digital forensics | preservation, chain of custody, hashing, timeline | — (specification) |
| 11 | Observability integrity | is that silence an observation, or a gap? | `observability-integrity` |
| 12 | Credential lifecycle | exposure, rotation currency, bootstrap grading | `credential-rotation`, `bootstrap-credential` |

**Nine of the twelve already have a shipped connector family.** This layer is mostly
**doctrine and evidence-class discipline over things that exist**, not new breadth —
which is why it does not touch the connector freeze (task #212). The three without a
family — SOC triage, pen-test validation, digital forensics — stay **specification** in
§8, for the standing reason a code no rule emits is a string that looks like evidence
and is not.

---

## 3. SignalGrid's role

SignalGrid is not a security tool and does not become one here. It sits *downstream* of
detection and *upstream* of the workflow, and supplies the one thing the security stack
cannot: **what a finding means for the active identity, device, app, workflow, local
authority, and business action.**

```text
detection  →  security evidence (normalized)  →  SignalGrid decision  →  workflow outcome
                                                   allow · step_up · restrict · deny
                                                        │
                                                        └─ reason code → named owner → served path → recovery re-check
```

The launch-safe boundary, restated from the parent models:

> SignalGrid **decides and routes**; the host apps and MDM **enforce**. Security
> evidence enters as read-only normalized signals. No security actuator ships.

---

## 4. The evidence contract — SPECIFICATION

Each domain, were it wired, would produce one normalized shape. This is the target
contract, **proposed, not on the wire** — it mints no reason code and adds no connector:

```ts
type SecurityOperationsEvidence = {
  domain: SecurityOperationsDomain;   // one of the twelve, §2
  observedState: string;              // what the source actually reported
  expectedState?: string;             // what the workflow requires
  severity: "monitor" | "low" | "medium" | "high" | "critical";
  signalFreshness: "fresh" | "stale" | "expired" | "missing";
  confidence: "high" | "medium" | "low" | "unknown";
  routeOwner: string;                 // who works the exception (must resolve)
  affectedWorkflow?: string;
  evidenceDigest?: string;            // integrity anchor — §6
  observedAt: string;
  freshUntil?: string;
};
```

The two fields that make it SignalGrid-shaped rather than a generic alert are
`freshness` and `routeOwner`: a finding with no freshness cannot reduce friction, and a
finding with no owner cannot be a decision — both are enforced as doctrine below.

---

## 5. How evidence influences a decision

The table is the doctrine. The **PROVEN** rows are the ones already true of the shipped
engine; the rest are **DOCTRINE** the specification would realize.

| Evidence state | SignalGrid behaviour | Status |
| --- | --- | --- |
| Informational event | monitor only | DOCTRINE |
| **Missing security telemetry where required** | **does not lower assurance** | **PROVEN** |
| **Unknown / unreachable security signal** | **raises the assurance required, never lowers it** | **PROVEN** |
| Fresh, high-confidence issue tied to the active workflow | step-up or restrict | DOCTRINE |
| Critical issue on the active workflow | restrict or deny | DOCTRINE |
| Contradictory evidence | restrict and route the owner | DOCTRINE |
| Response requested but not verified | keep the restriction | DOCTRINE |
| Evidence not preserved | restrict critical change / incident closure | DOCTRINE |
| Recovery verified | re-evaluate; release if policy allows | STRUCTURAL |

The two PROVEN rows are the load-bearing ones, and they are the same fail-closed law the
whole product rests on: an absent or unreadable signal can only *add* friction. This is
checked against the shipped `evaluatePolicy` by `proof:security-operations-evidence`, so
a change that let a missing security signal relax a decision goes red on the commit that
made it.

**Release is by re-evaluation, not by ticket closure (STRUCTURAL).** A restriction lifts
when the decision, re-run against fresh evidence, reaches `allow` — never when a ticket
is marked done. `lib/signalgrid-core` holds no executed-remediation status by design;
`proposeRemediation` and `simulateResolution` record and preview, they do not execute.
A closed ticket is a claim that work happened; a re-evaluation that now reaches `allow`
is evidence the state changed. Those are different, and conflating them is the unearned
affirmative wearing an incident-response badge.

---

## 6. The cryptographic trust anchor — what is real, and what is fixture

This is the section most worth reading honestly, because "cryptographic trust" is where
a governance doc most easily overclaims. SignalGrid's crypto is **real in the places
that gate a decision, and fixture in the places that only demo distribution** — and the
code says so at each site.

**Real, and negative-tested (PROVEN):**

- **Verdict attestation.** `lib/verdict-attestation` seals a verdict with HMAC-SHA256
  and opens it with a length-check-then-constant-time comparison. A verdict that fails
  verification is **degraded to `step_up`, one-directionally** — a verdict that already
  says `restrict` is never *lowered* to `step_up` by a verification failure, because
  "we could not confirm it" is never a reason to trust a device more. `proof:verdict-attestation`
  exercises this across an exhaustive state enumeration.
- **Enterprise JWT / OIDC.** `lib/enterprise-auth` rejects a tampered signature, an
  expired or not-yet-valid token, a wrong issuer or audience, `alg:none`, HS256
  confusion, and an unknown `kid` — and `proof:live-idp` asserts the *reason*, not merely
  refusal, against a real certified `oidc-provider` booted in-process over real HTTP.
- **Webhook signing — scheme v2, the timestamp is inside the MAC.** Outbound
  deliveries carry `X-Webhook-Signature: v2=<64 lowercase hex>` and
  `X-Webhook-Timestamp` (`createSignedHeaders` in
  `lib/integrations/src/integrations/webhooks/sign.ts`, proven by `proof:webhooks`).

  **Reconstruction string.** A receiver recomputes, over the RAW request body
  before parsing:

  ```
  signedMaterial = `${X-Webhook-Timestamp}.${rawBody}`
  expected       = HMAC-SHA256(signedMaterial, endpointSecret)   // lowercase hex
  accept iff  X-Webhook-Signature === `v2=${expected}`  (constant-time compare)
  ```

  **Unit.** `X-Webhook-Timestamp` is an integer count of **milliseconds** since the
  Unix epoch, UTC (13 digits today, e.g. `1756771200000`). Not seconds. Compare and
  re-sign the exact ASCII digits received; never reformat them.

  **Tolerance guidance.** The timestamp is the **delivery's** instant, minted once
  and unchanged across retries, so a receiver's replay window must exceed the
  sender's whole retry envelope. Every integer below is DERIVED from the shipped
  configs and gated by `scripts/check-derived-doc-figures.mjs` (rows
  `webhook-retry-*`), because hand-computed prose is exactly the figure that rots
  when someone changes a default: `DEFAULT_RETRY_CONFIG` in
  `lib/integrations/src/integrations/webhooks/retry.ts` is `maxAttempts: 6` with
  backoff waits summing to 31s before jitter, and `DEFAULT_DISPATCHER_CONFIG` in
  `lib/integrations/src/integrations/webhooks/dispatch.ts` allows 30s per attempt —
  so a fully timing-out delivery can still be in flight 217s after its timestamp was
  minted. **A tolerance below 217s will reject the sender's own last retry.**

  `toleranceMs: 300_000` (five minutes) is the recommended setting. That
  recommendation is **REPORTED, not gated** — it is a judgement about how much
  headroom to leave above the derived floor, not a fact about the tree. Future-dated
  timestamps are refused by default; allow skew only deliberately (`futureSkewMs`).
  An **absent, repeated or malformed** timestamp must be refused, never waved
  through — absence tightens.

  **The previous scheme is NOT accepted. There is no dual-accept.** v1 signed the
  **body alone** and emitted an unprefixed 64-hex signature with the timestamp
  outside the signed material, so a replayer could re-POST a captured body with a
  freshened timestamp header and still verify — measured 2026-09-02 as 2 distinct
  timestamps under 1 signature across 3 attempts. `verifySignedWebhook` refuses an
  unprefixed signature by name so an operator upgrades the sender rather than
  hunting a key mismatch. A verifier that accepted both schemes would leave every
  receiver with no replay protection while reporting success.

**Fixture, and disclosed as fixture (STRUCTURAL):**

- **Control-plane bundle integrity.** The bundle "checksum" is a 32-bit non-cryptographic
  FNV-1a hash, and the HMAC signing keys are hard-coded public-safe fixtures committed in
  the source (`lib/control-plane/src/index.ts`). This is **not forgery-resistant against
  anyone who can read the repo**, and the file says exactly that: *"a real deployment
  would use per-tenant secrets or asymmetric signing."* It proves the tampering path
  fails closed; it does not prove authenticity against an attacker holding the key.
- **Inbound webhook verification is a REFERENCE IMPLEMENTATION, not a deployed path.**
  No inbound route in this repository receives or verifies a webhook. `sign.ts` exports
  `verifySignedWebhook(headers, body, secret, { toleranceMs, now })` — the verifier a
  receiver ports, with `now` **injected** so it reads no clock — and `proof:webhooks`
  drives it as an oracle across acceptance, staleness, future skew, absent/malformed/
  repeated headers, tampering, wrong secret, and v1 refusal. That is a proven function,
  not a proven deployment. (An earlier unused verifier was deleted as dead code on
  2026-09-01 precisely because nothing exercised it; this one is exercised, and its
  docblock says in-file that it is wired to no route.) Signing itself still only engages
  in the live tier. Treating an inbound webhook as authenticated is **not** something the
  product does today.

The doctrine rule that ties these together **(DOCTRINE)**:

> If the cryptographic proof fails, the trust claim fails. Where the proof is a fixture,
> the trust claim is a fixture — and must be labelled one, not shipped as authenticity.

---

## 7. Web / API security — SignalGrid's own surface

Domain 7 turns inward: the Shared-Device Trust Gateway cannot be launch-ready if its own
API has the OWASP failures it would refuse in someone else's. What is **already proven**
of the api-server (PROVEN, via `test:api`, `check-durable-path-authorization.mjs`, and
the GA route fence): a cross-tenant decision or audit read fails; a demo key is rejected
under the customer profile; every deferred route 404s behind the allowlist (with a
positive control that the server is genuinely up); a durable read authorizes rather than
merely authenticating. These are the OWASP *broken-access-control* and
*security-misconfiguration* categories, checked rather than asserted.

The gaps that remain here are the launch profile's declared gaps, each with a
machine-checked closure predicate (see `LAUNCH_PROFILE.md`); they are not restated as
prose here so they cannot drift out of sync with the one place that owns them.

---

## 8. Reason codes — SPECIFICATION, and the gate that now catches a broken promise

Roughly ninety `SIEM_* / SOC_* / PENTEST_* / MALWARE_* / CRYPTO_* / NETWORK_* / WEB_* /
LINUX_* / INCIDENT_* / FORENSIC_* / SECURITY_*` codes were proposed across the source
images. **None are minted.** They are rollup vocabulary and a target contract, held to
the same standing decision as the `ZERO_TRUST_*`, ~80 `SAML_*` and twelve `ITSM_*`
codes: a code no rule emits is a string that looks like evidence and is not.

This is safe to do **only because minting one is now actually caught.** The layer-model
gate (`check-it-layer-model.mjs`) enforces a bijection — every emitted reason code has an
IT layer and an owner; nothing is classified that nothing emits. Building this model
surfaced a real hole in that gate: its rule parser read policy.ts by block structure, so
a reason code minted in a rule shape the parser could not see would ship **unclassified
while the gate stayed green** — verified live with a one-line injected rule. A
form-agnostic completeness cross-check now closes it: every `reasonCode:` literal in the
file must be read by the parser, or the build fails naming the code. So the promise "a
new security reason code cannot ship without an owner" is now a mechanical fact, not a
convention — which is the precondition for keeping ninety of them as specification
safely.

When a security-operations reason code *is* minted in a later phase, it will need a rule
that emits it, a layer and owner in `REASON_CODE_LAYERS`, and it will fail the build
until both exist. That is the intended cost, and it is now unavoidable.

---

## 9. Limited GA scope

**No new connector family, catalog, or reason code ships for this layer.** The launch
families stay exactly three: `graph`, `device-management-health`, `local-authority`.

For the launch spine, only these seven security-operations **assertions** are in scope —
all already true or trivially checkable, none expanding the product edge:

1. A security-affecting decision identifies its telemetry source.
2. An audit / evidence digest is present where a decision claims one.
3. Cryptographic validation failures fail closed (PROVEN, §6).
4. A route owner exists for every security-affecting refusal (PROVEN via the layer gate).
5. Incident and recovery state can be represented (STRUCTURAL, §5).
6. Evidence gaps do not become an allow (PROVEN, §5).
7. Logging / audit gaps are visible rather than silent (the absent-collection law).

---

## 10. Assessor-package additions

The independent-security-review package (`SECURITY_REVIEW_PACKAGE.md`, task #220) gains a
**Security Operations Evidence** section pointing an assessor at: the real-vs-fixture
crypto boundary (§6) as the first thing to attack; the fail-closed decision law and its
proof; the reason-code bijection and its now-closed parser blind spot; and the OWASP
assertions already covered by `test:api`. The minimum tests an assessor should expect to
pass, each mapping to an existing gate:

- an invalid signature does not update trust *(verdict-attestation, JWT proofs)*;
- a missing security signal cannot relax a decision *(this doc's proof)*;
- a newly minted reason code cannot ship without an owner *(layer gate, §8)*;
- recovery must be re-evaluated, not ticket-closed, to lift a restriction *(structural)*;
- the fixture crypto boundary is disclosed, not hidden *(§6, in-source comments)*.

---

## Running the gate

```bash
pnpm run proof:security-operations-evidence          # the checkable half, against the shipped engine
node scripts/check-it-layer-model.mjs                # the reason-code bijection + parser completeness
node scripts/check-it-layer-model.mjs --self-test    # controls, including the additive-blind-spot control
```

Related: `SIGNALGRID_ENTERPRISE_IT_LAYER_MODEL.md` (the container),
`SIGNALGRID_ZERO_TRUST_DECISION_PRINCIPLES.md`,
`SIGNALGRID_ENTERPRISE_ITSM_LAYER_MODEL.md`,
[`SIGNALGRID_ENTERPRISE_KPI_KRI_KCI_MODEL.md`](./SIGNALGRID_ENTERPRISE_KPI_KRI_KCI_MODEL.md)
(the control-effectiveness companion — now built),
`SIGNALGRID_SSO_EVIDENCE_FIRST_TROUBLESHOOTING.md`, `LAUNCH_PROFILE.md`,
`SECURITY_REVIEW_PACKAGE.md`.

> **One named companion is now built; one is still planned.** The KPI/KRI/KCI model is
> linked above — the line the earlier draft said "is where the link goes" is now that
> link. An Authentication & Federation model is still referenced by the source material
> and does not exist yet; it is named as *planned*, not linked, so this document links no
> phantom.
