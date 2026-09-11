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
endorsements. This document uses only *"aligned with"* and *"informed by"* — or
something tighter still (*"analogue"*, *"not established"*) — a design and
positioning aid, never a certification, compliance, or partnership claim
(`docs/PUBLIC_MESSAGING_GUARDRAILS.md`). The NIST works cited are public
U.S.-government publications, each under its own license: the macOS Security
Compliance Project is **CC BY 4.0** (attribution required, and the
Apple-contributed vendor descriptions in it are explicitly *not* licensed
material); the SP 800 series is public-domain U.S. government work. SignalGrid
consumes their **structure and guidance**, not any seal of approval. Where a fit is a direction rather than
shipped, it is labelled a **design target**.

## The one-sentence position

The NIST corpus gives SignalGrid an external, authoritative frame for four
capabilities at different maturities: **per-call, least-privilege decisioning**
(SP 800-207 Zero Trust) — the *point-in-time* decision loop is in the **Limited GA
(launch)** surface; **grading identity/authenticator assurance** (SP 800-63) — the
`step_up` *verdict* is launch, but the authenticator-assurance machinery
(passkey/WebAuthn, token-binding, the `/v1/step-up/*` routes) is **deferred**;
**reading Apple device posture against a recognized baseline** (macOS Security
Compliance Project) — **deferred**, fixture-backed; and **enriching vulnerability
signal from the national feeds** — NVD (CVEs) → the `vuln-scan` lane and SCAP
checklists → the `security_baseline`/`benchmark-selection` lane, two distinct
lanes, both **deferred** design directions. Each
row below carries its status; the map reads these as *evidence and vocabulary* and
claims none of their authority. **Nothing here is shipped** — this repository is a
pre-announcement, fixture-backed review artifact
(`docs/WHAT_SIGNALGRID_DOES_TODAY.md`); "launch" means *implemented, fixture-backed,
and selected for the Limited GA surface*, not generally available. **Continuous
reevaluation over elapsed time is not established** (`docs/SIGNALGRID_ZERO_TRUST_DECISION_PRINCIPLES.md`;
`proof:zero-trust-principles` prints the same limitation) and stays deferred.

## 1 — macOS Security Compliance Project (mSCP) → Mac-lane posture

[`usnistgov/macos_security`](https://github.com/usnistgov/macos_security) is the
open mSCP: it generates macOS/iOS/visionOS security configuration and *compliance
verification* artifacts from a rule library that maps to NIST SP 800-53r5, SP
800-171, CIS Benchmarks/Controls, CNSSI 1253, and DISA STIG (it implements NIST
SP 800-219 for automated macOS secure configuration). This is the strongest,
most concrete fit — it names, in a recognized baseline, the posture the
`macos-posture` family models. **Status:** the mSCP-facing posture *families*
`macos-posture` and `uem` are **deferred** and fixture-backed
(`scripts/launch-profile.mjs`); `lib/ddm-connector` is a workspace *library*, which
the profile does not classify at all. Two families named here are **launch**:
`device-management-health` — which the profile records with an open shipping
gap (its live transport is a generic bridge, not Microsoft Graph; the owner's
Blocker 5) — and `local-authority`. The mapping is a positioning aid, not a
claim that a live mSCP-driven posture path ships today. Each row carries its own
status.

| mSCP element | SignalGrid surface (real) | Status | Relationship |
| --- | --- | --- | --- |
| macOS security rules / baseline compliance | `proof:macos-posture`, `proof:macos-apple-schema`, `macos-posture` family | **deferred**, fixture-backed proof | **informed by** — mSCP names which posture facts matter; the family models them fail-closed |
| Declarative Device Management (DDM) assets | `proof:ddm-connector`, the `lib/ddm-connector` workspace library (not a connector family) | fixture-backed; **unclassified** by the launch profile, which classifies families and routes, not libraries — not launch | informed by — same DDM surface modeled as a posture source |
| Compliance verification scripts (report posture) | `proof:posture-composition`, `proof:posture-allow` (in-repo, fixture-backed); the **live** read is the separate **`DanFashauer/signalgrid-mcp`** Python server | **deferred**; live posture read is the sibling server, verification per `docs/LIVE_SYNC_LOOP.md` | informed by — mSCP *reports* a device's state; SignalGrid *would decide* on it (golden rule 2: unknown posture raises assurance) |
| Device management health (is the UEM/MDM reporting) | `proof:device-management-health`, `device-management-health` family | **launch**, with an open gap the profile records against it: its live transport is a generic bridge, not Microsoft Graph, and a Graph-backed transport does not exist yet (the owner's Blocker 5) | aligned with — the launch signal that a device's management channel is healthy |
| FileVault / first-unlock (bootstrap-token) state | `proof:local-authority`, `local-authority` family | **launch** | aligned with — the offline/degraded grant that waits for first unlock after a restart; a posture fact mSCP carries rules for |
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
Such a fixture is a derivative of a **CC BY 4.0** corpus: it must carry mSCP's
attribution, and must not reproduce the Apple-contributed vendor descriptions,
which mSCP's license excludes.

## 2 — SP 800-207 Zero Trust Architecture → the decision fabric

NIST SP 800-207 defines Zero Trust as per-request, continuously-evaluated,
least-privilege access decisions made by a Policy Decision Point from multiple
signal sources. This is a *subordinate architectural mapping* of SignalGrid's
decision-fabric role, not a restatement of the company thesis — the canonical
thesis is [`docs/PURPOSE.md`](../PURPOSE.md) (DR-020): orchestration that acts on
a person's behalf while staying invisible to the worker. Its own
[`ENTERPRISE_SECURITY_STACK_COVERAGE_MAP.md`](ENTERPRISE_SECURITY_STACK_COVERAGE_MAP.md)
places its weight in the Zero Trust Identity Mesh layer.

Note the SP 800-207 split: a Policy Decision Point = a **Policy Engine (PE)** that
decides + a **Policy Administrator (PA)** that executes the decision. SignalGrid's
deterministic core is the **PE**; the remediation/action cascade is the **PA**.

| SP 800-207 tenet | SignalGrid surface (real) | Status | Relationship |
| --- | --- | --- | --- |
| Policy **Engine** (the decide step) | the deterministic decision core; `proof:zero-trust-principles` and `proof:signalgrid-core` exercise `evaluatePolicy` directly | **launch** | aligned with — the core is the PE for the shared-device workflow |
| Policy **Administrator** (execute the decision) | the remediation/action cascade; `proof:orchestration` tests `planOrchestration` against **simulated** dispositions (its only non-proof consumer is `lib/room-sim`) | **deferred/demo** — both `/v1/remediation*` routes are deferred (`scripts/launch-profile.mjs`); no launch surface serves the PA | an orchestration *analogue* / design target — NIST's PA commands a PEP to establish or terminate the access path; `planOrchestration` actuates nothing (it emits simulated action descriptions), so this is not a demonstrated PA, only the PE's downstream side |
| Per-request evaluation (point-in-time) | the decision loop evaluates each request | **launch** | aligned with |
| *Continuous* reevaluation over elapsed time | `proof:caep-events`, `proof:sso-session`, `proof:session-readiness` (families all deferred) | **deferred** | not established (`proof:zero-trust-principles` prints this limitation); a design direction |
| Decision from many signal sources | the read-only, fail-closed connector families, by real id and status: identity — `graph` **launch**, `identity-risk` deferred; EDR — `edr-threat` deferred; NAC — `nac`, `network-nac` deferred; posture — `macos-posture` deferred; RTLS/custody — `rtls-custody`, `custody-beacon` deferred (DR-001) | mostly **deferred** — of these only `graph` is launch | aligned with |
| Least privilege / dynamic policy | the core PE emits `allow / step_up / restrict / deny` | **launch** (the verdicts) | aligned with — `proof:entitlement-binding` and `proof:break-glass` are **deferred** connector-evaluator *inputs*, not PE evidence (break-glass grades an override after the fact; it is not a policy type) |

## 3 — SP 800-63 Digital Identity → the assurance ladder

NIST SP 800-63 **Revision 4** — the current, finalized suite as of 2025
([`usnistgov/800-63-4`](https://github.com/usnistgov/800-63-4), with SP 800-63B-4
for authenticators; Rev 3 is superseded) — grades identity/authenticator/
federation assurance (IAL/AAL/FAL). SignalGrid's step-up path is an assurance
ladder in the same spirit — a weak or replayable authenticator raises assurance
requirements rather than passing silently. **Status:** the `step_up` *verdict* is
a launch decision output, but the WebAuthn/passkey assurance machinery that would
satisfy a step-up — the `passkey-assurance` and `token-binding` families and the
`/v1/step-up/*` routes — is **deferred** (`scripts/launch-profile.mjs`).

| SP 800-63 concept | SignalGrid surface (real) | Status | Relationship |
| --- | --- | --- | --- |
| The decision can *require* step-up | the `step_up` verdict from the core | **launch** | aligned with — the core can raise assurance |
| Authenticator assurance (AAL) / phishing-resistant | `proof:passkey-assurance`, `proof:webauthn-verify` | **deferred** | informed by |
| Proof-of-possession vs replayable bearer | `proof:token-binding` (DPoP / mTLS) | **deferred** | informed by |
| The step-up enrollment/challenge flow | the `/v1/step-up/*` routes | **deferred** (`scripts/launch-profile.mjs`) | informed by — the machinery that would satisfy a `step_up`, not yet in the launch surface |

## 4 — OSCAL → control-evidence format (design target)

[`usnistgov/OSCAL`](https://github.com/usnistgov/OSCAL) and
[`usnistgov/oscal-content`](https://github.com/usnistgov/oscal-content) define
machine-readable formats (XML/JSON/YAML) for control catalogs, implementations,
and **assessment results**. SignalGrid's **audit ledger** emits structured decision
evidence today (`proof:audit-ledger`); `proof:verdict-attestation` and
`proof:response-accountability` are **modeled/deferred** primitives
(`response-accountability` is deferred in `scripts/launch-profile.mjs`), not wired
to a launch surface. OSCAL is the recognized shape that the ledger's evidence
could speak.

- **Design target, not shipped:** an OSCAL *assessment-results* export of
  SignalGrid's decision/evidence records, so a security team can ingest them in a
  format they already use. Filed as a direction; no exporter exists today and no
  claim is made that one does.

## 5 — NVD and SCAP → two different lanes

These are **two distinct feeds mapping to two distinct signals**, not one:

- **NVD (CVEs / CVSS) → the deferred `vuln-scan` family.** `proof:vuln-scan` runs
  against a **synthetic fixture** (`scripts/fixtures/vuln-scan/findings.json`); NVD
  data has **not** entered any decision path (`docs/research/PUBLIC_API_SOURCES.md`).
- **SCAP / XCCDF / OVAL (checklist compliance) → the `security_baseline` signal via
  the deferred `benchmark-selection` family**, not `vuln-scan`
  (`docs/SECURITY_BASELINE_ALIGNMENT.md`). SignalGrid does **not** run a
  CIS/STIG/SCAP scan; it would *consume* a checklist result as a baseline signal.

Both are **deferred** (`scripts/launch-profile.mjs`) and fixture-first by rule (a
public feed enters the tree only as a committed, dated fixture; live only behind
tier + opt-in — DR-027). Both are **design directions**, not shipped enrichment.

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
