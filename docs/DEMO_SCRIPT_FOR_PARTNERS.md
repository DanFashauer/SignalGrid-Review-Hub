# Demo Script for Partners — lab-first

Rewritten 2026-08-11 for the source-agnostic redirect (plan §12, intake ledger
row 77). The demo needs **no Microsoft tenant, no licensing, and no live
credentials**: everything runs on the open-source-MDM lab path, offline and
deterministic. "Bring your tenant" is the *enterprise chapter* at the end — an
option for later, never the entry ticket.

This script references only current validated assets. It must not be presented
as a production system, compliance artifact, live integration, current
partnership, or acquisition offer.

## What you demo with

- The **launch console** (`signalgrid-app`) served against the real `/v1` API —
  the same six screens the launch wireframes ratified: dashboard, connector
  setup & health, policies, decision detail, audit, deployment assurance.
- The **api-server** in fixture mode (its default): synthetic devices, real
  paging, the same code paths as live — nothing leaves the process.
- The proof suite, if the audience is technical — especially
  `proof:evidence-adapter`.

## Script

### 1. Set the boundary

"This is SignalGrid's pre-production review surface. Everything shown is
synthetic and fixture-backed. There are no credentials, tenant IDs, customer
data, PHI, PII, or live vendor API calls in this demo — and the deployment
itself tells you that: every screen carries the assurance label, and the
`/status` page states fixture-backed, advisory, and tier in the server's own
words, not copy."

### 2. The problem, in the worker's terms

"On shared and frontline devices, the worker just wants to do the job. The
question SignalGrid answers is whether work should continue *right now* on
*this* device — from evidence that already exists: MDM state, identity, device
posture, workflow, and whether the device may act on its own authority (just
rebooted? offline past its grant?). SignalGrid is not an MDM. It is the trust
layer that reads that evidence and returns allow, step-up, restrict, or deny —
the source systems remain the systems of record, and nothing here remediates
anything on its own."

### 3. Source-agnostic, shown not claimed

"Device-management evidence enters through one adapter contract. The decision
engine never learns which vendor produced a reading. In this repository that is
a build-breaking test, not a slide: `proof:evidence-adapter` expresses the same
device states as a Fleet host, a Headwind-shaped Android device, and
Intune-shaped evidence, runs all three through the full pipeline, and fails the
build unless the decisions are identical — provenance is the only difference.
Open-source MDM gives SignalGrid a low-cost lab; Microsoft Intune is the first
enterprise production connector."

### 4. Walk the console — the one launch experience

Follow the flow the wireframes ratified: connector setup → policy (read) →
**evaluate** → decision detail → evidence → audit → verification.

1. **`/status`** — the honest one-pager: profile, tier, fixture signal source,
   advisory verdicts, declared divergences. Every claim is server-derived.
2. **`/connectors/setup`** — the gate checklist IS the setup instruction: each
   live-call gate independently required, the resolved mode is the server's own
   computation, and "RUN FIXTURE SYNC" drives the real sync pipeline. The
   Sources block names what feeds the lab and what the enterprise connector is.
3. **`/policies`** — versioned rule sets with content digests; the pinned
   policy tests run server-side. Read-only at launch: policy changes ride the
   repository.
4. **Dashboard live panel** — evaluate a decision against the real `/v1` core:
   pick the non-compliant preset, watch RESTRICT come back with its reason
   code, decision id, evidence id, and the versioned policy that decided.
5. **Decision detail** — the trust moment: outcome, matched rules, reason
   codes, the tamper-evident evidence snapshot re-verified on this request,
   every signal with its **source chip**, freshness grade, and provenance
   string, and the ROUTE OWNER line — who picks the refusal up, per the
   declared IT-layer model.
6. **`/audit`** — the tamper-evident chain, every digest recomputed, read with
   the auditor role (separation of duties displayed, not hidden).

### 5. The shared-device story on the lab fixtures

Use the seeded subjects: the compliant nurse iPad allows; the non-compliant
ward iPad restricts with DEVICE_NONCOMPLIANT; the disabled account denies; the
just-rebooted device is awaiting first unlock and local authority is withheld.
For rugged/Android contexts, the Headwind-shaped lab devices tell the same
story on scanners and kiosks — same engine, different source.

### 6. The enterprise chapter — bring your tenant (later, optional)

"When an enterprise wants its own truth in the loop, the Microsoft Graph
connector is the first supported production connector. It is read-only, and it
is off by default behind three independent gates — deployment tier,
`SIGNALGRID_LIVE_INTEGRATIONS`, and a credential — so a lab can never
accidentally reach a tenant. Wiring it is configuration, not code: the same
contract, the same engine, new provenance." Any live integration requires
separate owner approval, safe test boundaries, and private validation.

### 7. Close with the next validation question

Ask which workflow and which evidence source the partner would want to see
first: their Fleet or another open-source lab this week, or a private
Entra/Intune sandbox review when they are ready. Both land in the same console,
because the engine cannot tell them apart.
