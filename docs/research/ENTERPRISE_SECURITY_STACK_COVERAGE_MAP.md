# Enterprise security stack — SignalGrid coverage map

**Absorbed 2026-09-01** from the owner's "Modern Enterprise Cybersecurity
Architecture Stack" reference diagram (a five-layer industry model). This maps
that model against what SignalGrid **actually proves in this tree** — every row
names a `proof:*` gate or connector family that exists today. It is a
positioning aid, not a claim of completeness, and it stays honest about the
layers SignalGrid does **not** own.

## The one-sentence position

SignalGrid is the **decision layer** of this stack, not a replacement for any of
its five bands. It reads posture from every layer as *evidence*, fuses it
deterministically, and returns `allow / step_up / restrict / deny` — the DR-020
thesis: *a decision is the trigger for a cascade, and the worker never sees
SignalGrid.* Its own weight sits in **Layer 3 (Zero Trust Identity Mesh)**,
which is the launch surface; its reach into the other four layers is through
read-only, fail-closed connector families, most of them **deferred** (real,
gated, and not part of the launch wedge — see `docs/DECISION_RECORDS.md` DR-001).

## Layer 3 — Zero Trust Identity Mesh — *SignalGrid's core (launch + deferred)*

This is what SignalGrid is. The launch surface (Entra + Intune posture → one
shared-device decision loop) lives here, and the deepest deferred coverage
extends it.

| Diagram capability | SignalGrid surface (real) | Status |
| --- | --- | --- |
| Multi-Factor Authentication / step-up | `proof:webauthn-verify`, `proof:passkey-assurance`; the `/v1/step-up/challenge` route (cryptographically bound to tenant+identity+integration+device+action) | live in core |
| Conditional Access Policies | `proof:intune-entra-posture`, `proof:policy-binding`, `proof:orchestration` (the deterministic decision core) | launch |
| Continuous Authorization | `proof:caep-events`, `proof:sso-session`, `proof:service-lifecycle`, `proof:session-readiness`, `proof:decision-continuity` | deferred |
| Least Privilege Access | `proof:grant-safety`, `proof:entitlement-binding`, `proof:pim-activation`, `proof:dual-control`, `proof:break-glass` | deferred |
| Identity Governance | `proof:access-governance`, `proof:identity-risk`, `proof:oauth-consent`, `proof:provisioning` / `proof:provisioning-teardown` | deferred |
| Token / proof-of-possession | `proof:token-binding` (DPoP / mTLS vs replayable bearer) | deferred |

## Layer 1 — AI Security and Agent Governance — *real deferred position*

SignalGrid already treats a non-human / agentic actor as a first-class principal
and questions the *action*, not just the identity.

| Diagram capability | SignalGrid surface (real) | Status |
| --- | --- | --- |
| Agent identity / autonomous agents | `proof:agent-identity` (non-human-identity governance) | deferred |
| Agent guardrails / action judgment | `proof:agent-behavior` (the layer that questions the action) | deferred |
| Preventing hallucinations / LLM answer discipline | `proof:mcp-answer-discipline`, `proof:mcp-server` — a fail-closed MCP plane where an unknown **tightens** and is never fabricated into a grant | deferred |
| Governance & policy compliance | the deterministic decision core (`proof:signalgrid-core`, `proof:policy-binding`) | launch |

## Layer 2 — Data Protection and DSPM — *consumed as signal, not owned*

SignalGrid reads data-plane posture and keeps its own tamper-evident record. It
is **not** a DSPM or DLP product; discovery and classification of sensitive data
belong to the host/data plane.

| Diagram capability | SignalGrid surface (real) | Status |
| --- | --- | --- |
| Data Loss Prevention (DLP) posture | `proof:data-protection` (DLP posture as a decision signal) | deferred |
| Encryption key / credential material | `proof:itsm-credential-crypto`, `proof:credential-rotation`, `proof:bootstrap-credential` | mixed |
| Monitoring access / audit | `proof:audit-ledger` (+ `proof:audit-ledger-pg`) — hash-chained, tamper-evident; `proof:credential-exposure` | live in core |
| Discover & classify sensitive data (DSPM) | **not covered** — host/data-plane responsibility | out of scope |

## Layer 4 — Cloud Workload and Hybrid Cloud Security — *evidence source*

SignalGrid runs *as* a workload; it does not secure other workloads. It consumes
device/workload risk posture as a signal.

| Diagram capability | SignalGrid surface (real) | Status |
| --- | --- | --- |
| Vulnerability / device risk posture | `proof:vuln-scan`, `proof:macos-posture`, `proof:ot-posture`, `proof:device-management-health` | deferred |
| Endpoint threat state (EDR) | `proof:edr-threat`, `proof:live-edr` | deferred |
| Infrastructure-as-code posture | `proof:iac` | deferred |
| CWPP / KSPM / shift-left / microservices scanning | **not covered** — platform-security responsibility | out of scope |

## Layer 5 — Secure Network and SASE Foundation — *evidence source*

SignalGrid is a zero-trust *decision point*, not a network enforcer. It reads
network/access posture; it provides no SASE, SD-WAN, FWaaS, SWG, or DNS control.

| Diagram capability | SignalGrid surface (real) | Status |
| --- | --- | --- |
| Network access control posture | `proof:nac`, `proof:network-nac` (read-only endpoint identity/access posture, no actuators) | deferred |
| Secure service edge egress | `proof:sse-egress` | deferred |
| ZTNA (as a decision) | the decision core returns the zero-trust verdict; the *network* enforces it | partial (decision only) |
| SASE / SD-WAN / Cloud FWaaS / SWG / DNS security / segmentation | **not covered** — network/SASE-vendor responsibility | out of scope |

## Second reference cross-check — Zero Trust AI-application layer (2026-09-08)

**Absorbed** from a second owner-shared reference: a *"Zero Trust — Never Trust,
Always Verify"* infographic that draws the same doctrine in **AI-application** framing
(USER → ACCESS CONTROL → CLOUD LAYER → AI APPLICATION LAYER → SECURITY & GOVERNANCE →
OBSERVABILITY → CONTINUOUS TRUST). It is the same zero-trust model as the five-layer
stack above, so most bands are already mapped; this cross-check records where each lands
and the two things this framing genuinely adds. No new surface, dependency, or launch
claim — intake logged in `docs/agent/RESOURCE_INTAKE.md`.

- **USER / ACCESS CONTROL** (MFA · SSO · IAM · RBAC/ABAC · verify device + risk + policy) —
  Layer 3 above (`proof:webauthn-verify`, `proof:passkey-assurance`, the bound
  `/v1/step-up/challenge`, `proof:intune-entra-posture`, `proof:policy-binding`,
  `proof:orchestration`).
- **CLOUD LAYER** (encryption · key/secrets management · logging & audit) — Layer 2 above
  (`proof:itsm-credential-crypto`, `proof:credential-rotation`, the hash-chained
  `proof:audit-ledger`). **Network segmentation / private endpoints / firewall-WAF** stay
  the network/SASE vendor's — the Layer 5 "decision point, not a network enforcer" line.
- **AI APPLICATION LAYER — Agentic AI** (agent authorization → Tool/MCP → API/DB/SaaS,
  plus guardrails) — Layer 1 above (`proof:agent-identity`, `proof:agent-behavior`,
  `proof:mcp-answer-discipline`, `proof:mcp-server`): a fail-closed MCP plane where an
  unknown tightens and is never fabricated into a grant.
- **AI APPLICATION LAYER — RAG** (query authorization → retrieval → Top-K/rerank → LLM →
  prompt guardrails) — **divergence, not a gap.** SignalGrid is a deterministic fail-closed
  decision gate, not a RAG/LLM application: there is no LLM in its decision path and no
  retrieval/rerank stage (golden rule 2 — no model nondeterminism in a decision). Its
  nearest analogue is deterministic *evidence* gathering that authorizes and fuses signals,
  not documents (`proof:evidence-coverage`, `proof:grid-coverage`); the LLM/guardrail band
  applies only to the agent-facing MCP plane above, never to the verdict.
- **SECURITY & GOVERNANCE** (PII · DLP · content safety · policy enforcement · audit ·
  secrets · compliance) — DLP posture as a signal (Layer 2, `proof:data-protection`); PII
  and content redaction through the shared sanitizer (`scripts/lib/sanitize.mjs`) and the
  publication boundary (`scripts/check-publication-boundary.mjs`); policy enforcement
  through the deterministic core (`proof:policy-binding`, `proof:signalgrid-core`); audit
  through `proof:audit-ledger`. **Compliance is not a guarantee** — CLAUDE.md is explicit
  that SignalGrid does not certify HIPAA/SOC 2 and a human review is required.
- **OBSERVABILITY & MONITORING** (identity · AI-quality · security monitoring) — the one
  band the five-layer stack above carries no row for, and the genuine addition from this
  reference: `proof:observability`, `proof:observability-integrity`, `proof:fabric-evals`
  (AI-quality/eval), `proof:telemetry-up`, `proof:telemetry-posture-cache`.
- **CONTINUOUS TRUST — "Verify Every Request"** — this closing principle *is* SignalGrid's
  own thesis, not a new requirement: every decision is re-evaluated per request, fail-closed
  and deterministic, and an unknown or stale signal raises assurance rather than lowering it
  (DR-020; `proof:signalgrid-core`, `proof:decision-continuity`, the freshness/skew gate).

The verdict is unchanged from the five-layer map: **SignalGrid is the decision layer** of
this reference too — it does not become a RAG app, a WAF, a DLP product, or an APM by
appearing as a band in someone's diagram.

## What this map is careful not to say

- **No layer here is "done" or "certified."** Deferred means the family has a
  gated proof and is deliberately outside the launch wedge, per DR-001. Launch
  means it is in the shipped decision path — still fixture-backed, not a
  production deployment.
- **SignalGrid does not replace any product in this diagram.** It fuses their
  posture into one decision. Where a row says *not covered*, that capability
  stays with the host app, the platform, or the network vendor (CLAUDE.md
  golden rule 3: domain and platform safety live in the host layers).
- **Every `proof:*` named above is a real gate in `package.json`** — verified by
  hand on 2026-09-06 (43 distinct names, 0 missing). No gate re-checks a bare
  `proof:*` mention in prose against the registry (`check-proof-counts.mjs` reads
  only the `proof:X (N checks)` shape), so a name that stops resolving here is
  caught by the next reader, not by CI; this sentence used to claim otherwise.
