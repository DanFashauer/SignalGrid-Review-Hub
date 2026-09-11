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

The NIST corpus gives SignalGrid an external, authoritative frame for four
capabilities at different maturities: **per-call, least-privilege decisioning**
(SP 800-207 Zero Trust) — this is the **launch** decision loop, *point-in-time*
evaluation; **grading identity/authenticator assurance** (SP 800-63) — launch
step-up plus deferred rungs; **reading Apple device posture against a recognized
baseline** (macOS Security Compliance Project) — **deferred**, fixture-backed; and
**enriching vulnerability signal from the national feed** (NVD/SCAP) — a
**deferred** design direction. Each row below carries its status; the map reads
these as *evidence and vocabulary* and claims none of their authority. Only the
per-call decision loop is a shipped capability today; **continuous
reevaluation over elapsed time is not established** (`docs/SIGNALGRID_ZERO_TRUST_DECISION_PRINCIPLES.md`;
`proof:zero-trust-principles` prints the same limitation) and stays deferred.

## 1 — macOS Security Compliance Project (mSCP) → Mac-lane posture

[`usnistgov/macos_security`](https://github.com/usnistgov/macos_security) is the
open mSCP: it generates macOS/iOS/visionOS security configuration and *compliance
verification* artifacts from a rule library that maps to NIST SP 800-53r5, SP
800-171, CIS Benchmarks/Controls, CNSSI 1253, and DISA STIG (it implements NIST
SP 800-219 for automated macOS secure configuration). This is the strongest,
most concrete fit — it names, in a recognized baseline, the posture the
`macos-posture` family models. **Status:** the mSCP-facing posture surfaces
(`macos-posture`, `ddm-connector`, `uem`) are **deferred** and fixture-backed
(`scripts/launch-profile.mjs`); the one **launch** family here is
`device-management-health`. The mapping is a positioning aid, not a claim that a
live mSCP-driven posture path ships today. Each row carries its own status.

| mSCP element | SignalGrid surface (real) | Status | Relationship |
| --- | --- | --- | --- |
| macOS security rules / baseline compliance | `proof:macos-posture`, `proof:macos-apple-schema`, `macos-posture` family | **deferred**, fixture-backed proof | **informed by** — mSCP names which posture facts matter; the family models them fail-closed |
| Declarative Device Management (DDM) assets | `proof:ddm-connector`, `ddm-connector` family | **deferred**, fixture-backed proof | informed by — same DDM surface modeled as a posture source |
| Compliance verification scripts (report posture) | `proof:posture-composition`, `proof:posture-allow` (in-repo, fixture-backed); the **live** read is the separate **`DanFashauer/signalgrid-mcp`** Python server | **deferred**; live posture read is the sibling server, verification per `docs/LIVE_SYNC_LOOP.md` | informed by — mSCP *reports* a device's state; SignalGrid *would decide* on it (golden rule 2: unknown posture raises assurance) |
| Device management health (is the UEM/MDM reporting) | `proof:device-management-health`, `device-management-health` family | **launch** | aligned with — the launch signal that a device's management channel is healthy |
| Broader UEM posture | `proof:uem`, `uem` family | **deferred** | informed by — the wider UEM surface beyond the launch health check |

**Two MCP servers, kept distinct** (`docs/MCP_ARCHITECTURE.md`): the *in-repo*
`mcp__signalgrid-mcp` (`artifacts/mcp-server/`) exposes the **decision fabric** as
tools — it does not collect macOS posture. The **macOS device-posture** reads
come from the *separate* [`DanFashauer/signalgrid-mcp`](https://github.com/DanFashauer/signalgrid-mcp)
Python server (a read-only signal source; its tool count is derived from a real
checkout by `pnpm run verify:all`, printed UNVERIFIED when absent). This row is
about that sibling, not the in-repo namespace.

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
| Policy Decision Point / Policy Engine | the deterministic decision core; `proof:zero-trust-principles` and `proof:signalgrid-core` exercise `evaluatePolicy` directly (`proof:orchestration` tests the downstream cascade, not the PDP itself) | aligned with — the launch decision loop *is* a PDP for the shared-device workflow |
| Per-request evaluation (point-in-time) | the launch decision loop evaluates each request | **launch** — aligned with |
| *Continuous* reevaluation over elapsed time | `proof:caep-events`, `proof:sso-session`, `proof:session-readiness` (families all **deferred**, `scripts/launch-profile.mjs`) | **deferred** — not established (`proof:zero-trust-principles` prints this limitation); a design direction, not shipped |
| Decision from many signal sources | the read-only, fail-closed connector families (identity, EDR, NAC, posture, plus the RTLS/custody families that are **deferred**, DR-001) | aligned with |
| Least privilege / dynamic policy | `allow / step_up / restrict / deny`; `proof:entitlement-binding`, `proof:break-glass` | aligned with |

## 3 — SP 800-63 Digital Identity → the assurance ladder

NIST SP 800-63 **Revision 4** — the current, finalized suite as of 2025
([`usnistgov/800-63-4`](https://github.com/usnistgov/800-63-4), with SP 800-63B-4
for authenticators; Rev 3 is superseded) — grades identity/authenticator/
federation assurance (IAL/AAL/FAL). SignalGrid's step-up path is an assurance
ladder in the same spirit — a weak or replayable authenticator raises assurance
requirements rather than passing silently.

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

The National Vulnerability Database and SCAP tooling are the national feed the
**deferred** `vuln-scan` family is designed to consume (`scripts/launch-profile.mjs`;
precedent: intake ledger row 30, NVD → `vuln-scan`). **Status, stated plainly:**
`proof:vuln-scan` runs against a **synthetic fixture** (`scripts/fixtures/vuln-scan/findings.json`),
NVD data has **not** entered any decision path (`docs/research/PUBLIC_API_SOURCES.md`),
and the family is not part of the launch wedge. The alignment is prospective:
fixture-first by rule (a public feed enters the tree only as a committed, dated
fixture; live only behind tier + opt-in — DR-027), so NVD → `vuln-scan` is a
**design direction**, not a shipped enrichment.

## 6 — Mobile Threat Catalogue → the shared-device threat model

[`usnistgov/mobile-threat-catalogue`](https://github.com/usnistgov/mobile-threat-catalogue)
(NIST/NCCoE) is a structured taxonomy of mobile threats. It is an external
cross-check for the threat model in
[`SHARED_DEVICE_CUSTODY_GROUND_TRUTH.md`](SHARED_DEVICE_CUSTODY_GROUND_TRUTH.md)
— informed by, for review of the `custody-beacon` / `rtls-custody` / `carrier` /
`device-attestation` detections (**deferred** families, DR-001). No code change;
a review lens.

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
