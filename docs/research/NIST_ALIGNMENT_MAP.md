# NIST resources — SignalGrid alignment map

**Absorbed 2026-09-11** from the owner's share of the NIST GitHub organization
([`github.com/usnistgov`](https://github.com/usnistgov)) —
*"an excellent one to have and use for both lanes and the whole system … the
security team and others [will be] happy having these resources."* This maps the
highest-relevance NIST projects and publications against what SignalGrid
**actually builds in this tree** — every row names a `proof:*` gate, a connector
family, or a document that exists today.

## Honesty boundary (read first)

SignalGrid is **not** NIST-certified, NIST-endorsed, or a compliance
attestation, and nothing here changes that. NIST publishes no product
endorsements. This document uses only *"aligned with"* and *"informed by"* — a
design and positioning aid, never a certification, compliance, or partnership
claim (`docs/PUBLIC_MESSAGING_GUARDRAILS.md`). The NIST works cited are public,
U.S.-government, and mostly public-domain; SignalGrid consumes their **structure
and guidance**, not any seal of approval. Where a fit is a direction rather than
shipped, it is labelled a **design target**.

## The one-sentence position

The NIST corpus gives SignalGrid an external, authoritative frame for four things
it already does: **decide continuously and least-privilege** (SP 800-207 Zero
Trust), **grade identity/authenticator assurance** (SP 800-63), **read Apple
device posture against a recognized baseline** (macOS Security Compliance
Project), and **enrich vulnerability signal from the national feed** (NVD/SCAP).
It reads these as *evidence and vocabulary*; it claims none of their authority.

## 1 — macOS Security Compliance Project (mSCP) → Mac-lane posture

[`usnistgov/macos_security`](https://github.com/usnistgov/macos_security) is the
open mSCP: it generates macOS/iOS/visionOS security configuration and *compliance
verification* artifacts from a rule library that maps to NIST SP 800-53r5, SP
800-171, CIS Benchmarks/Controls, CNSSI 1253, and DISA STIG (it implements NIST
SP 800-219 for automated macOS secure configuration). This is the strongest,
most concrete fit — it names, in a recognized baseline, exactly the posture
SignalGrid's Mac lane reads.

| mSCP element | SignalGrid surface (real) | Relationship |
| --- | --- | --- |
| macOS security rules / baseline compliance | `proof:macos-posture`, `proof:macos-apple-schema`, `macos-posture` family | **informed by** — mSCP names which posture facts matter; SignalGrid consumes them fail-closed as evidence |
| Declarative Device Management (DDM) assets | `proof:ddm-connector`, `ddm-connector` family | aligned with — same DDM surface SignalGrid models as a posture source |
| Compliance verification scripts (report posture) | `mcp__signalgrid-mcp` posture tools; `proof:posture-composition`, `proof:posture-allow` | aligned with — mSCP *reports* a device's state; SignalGrid *decides* on it (golden rule 2: unknown posture raises assurance, never lowers it) |
| Device management health | `proof:device-management-health`, `uem` family | aligned with |

**Boundary:** SignalGrid is not an MDM and cannot enforce a baseline on a device
(CLAUDE.md golden rule 4 — enforcement is a supervised-device/OS capability).
mSCP is the *baseline*; SignalGrid is the *runtime decision* that reads whether a
device meets it. Design target: a committed, dated fixture derived from an mSCP
rule set so posture citations resolve to a named baseline, not a hand-listed set.

## 2 — SP 800-207 Zero Trust Architecture → the decision fabric

NIST SP 800-207 defines Zero Trust as per-request, continuously-evaluated,
least-privilege access decisions made by a Policy Decision Point from multiple
signal sources. That is SignalGrid's core thesis (DR-020), and its own
[`ENTERPRISE_SECURITY_STACK_COVERAGE_MAP.md`](ENTERPRISE_SECURITY_STACK_COVERAGE_MAP.md)
already places its weight in the Zero Trust Identity Mesh layer.

| SP 800-207 tenet | SignalGrid surface (real) | Relationship |
| --- | --- | --- |
| Policy Decision Point / Policy Engine | the deterministic decision core; `proof:orchestration`, `proof:policy-binding` | aligned with — SignalGrid *is* a PDP for shared-device custody |
| Per-request, continuous evaluation | `proof:caep-events`, `proof:sso-session`, `proof:session-readiness` | aligned with |
| Decision from many signal sources | the read-only, fail-closed connector families (identity, EDR, NAC, posture, RTLS, custody) | aligned with |
| Least privilege / dynamic policy | `allow / step_up / restrict / deny`; `proof:entitlement-binding`, `proof:break-glass` | aligned with |

## 3 — SP 800-63 Digital Identity → the assurance ladder

NIST SP 800-63 ([`usnistgov/800-63-3`](https://github.com/usnistgov/800-63-3),
and 800-63B for authenticators) grades identity/authenticator/federation
assurance (IAL/AAL/FAL). SignalGrid's step-up path is an assurance ladder in the
same spirit — a weak or replayable authenticator raises assurance requirements
rather than passing silently.

| SP 800-63 concept | SignalGrid surface (real) | Relationship |
| --- | --- | --- |
| Authenticator assurance (AAL) / phishing-resistant | `proof:passkey-assurance`, `proof:webauthn-verify` | informed by |
| Proof-of-possession vs replayable bearer | `proof:token-binding` (DPoP / mTLS) | aligned with |
| Step-up when assurance is insufficient | `step_up` verdict + the `/v1/step-up/challenge` route | aligned with |

## 4 — OSCAL → control-evidence format (design target)

[`usnistgov/OSCAL`](https://github.com/usnistgov/OSCAL) and
[`usnistgov/oscal-content`](https://github.com/usnistgov/oscal-content) define
machine-readable formats (XML/JSON/YAML) for control catalogs, implementations,
and **assessment results**. SignalGrid already emits structured, tamper-evident
decision evidence (`proof:verdict-attestation`, `proof:response-accountability`,
the audit ledger). OSCAL is the recognized shape that evidence could speak.

- **Design target, not shipped:** an OSCAL *assessment-results* export of
  SignalGrid's decision/evidence records, so a security team can ingest them in a
  format they already use. Filed as a direction; no exporter exists today and no
  claim is made that one does.

## 5 — NVD / SCAP → the vulnerability lane

The National Vulnerability Database and SCAP tooling are the national feed
SignalGrid's `vuln-scan` family already targets (precedent: intake ledger row 30,
NVD → `vuln-scan`; NVD CVE 2.0 answered keyless in that probe). `proof:vuln-scan`
consumes CVE evidence fixture-first (a public feed enters the tree only as a
committed, dated fixture; live only behind tier + opt-in — DR-027).

## 6 — Mobile Threat Catalogue → shared-device custody threat model

[`usnistgov/mobile-threat-catalogue`](https://github.com/usnistgov/mobile-threat-catalogue)
(NIST/NCCoE) is a structured taxonomy of mobile threats. It is an external
cross-check for the custody threat model in
[`SHARED_DEVICE_CUSTODY_GROUND_TRUTH.md`](SHARED_DEVICE_CUSTODY_GROUND_TRUTH.md)
— informed by, for review of the `custody-beacon` / `rtls-custody` / `carrier` /
`device-attestation` detections. No code change; a review lens.

## 7 — Adjacent, noted not wired

- [`usnistgov/dioptra`](https://github.com/usnistgov/dioptra) (AI test/eval) is
  relevant to **agent governance**, not the decision path — a model decides no
  verdict here (golden rule 2, DR-029). Noted for the `agent-behavior` /
  brain-cycle lane as an evaluation reference only; nothing wired.
- Cryptographic-validation projects (ACVP, SP 800-90B entropy) are the province
  of the crypto libraries SignalGrid depends on, not SignalGrid itself. Out of
  scope, boundary stated.

## What this changed

A positioning and review map — no `lib/*`, `/v1`, connector, proof, or
decision-path change, and no claim moved. Two design targets are filed as
directions (an mSCP-derived posture fixture; an OSCAL assessment-results export),
proposed rather than built. The security team gets a single page tying
SignalGrid's real surfaces to the NIST works they already know.
