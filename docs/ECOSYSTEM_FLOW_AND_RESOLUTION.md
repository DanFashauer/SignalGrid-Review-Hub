# SignalGrid Ecosystem Flow & Resolution Assistant (public-safe)

This document describes two connected ideas as a **deterministic, fixture-backed,
public-safe** design: (1) the hardware + software ecosystem as one signal-to-outcome
flow, and (2) the **Resolution Assistant**, a deterministic helper that turns a
non-allow decision into an ordered, approval-gated, simulated resolution path.

It is a **product-shaped review artifact, not the production core.** Everything here
is fixture-backed and deterministic: no secrets, no tenant IDs, no customer data, no
PHI/PII, and no live Microsoft Graph or vendor calls. Nothing described here executes
a change on a source system. This is not production, is not autonomous, and does not
replace any IAM, UEM/MDM, PACS, locker, dock, RTLS, or ITSM system of record. It
builds on the [Product Core Foundation](PRODUCT_CORE_FOUNDATION.md), the
[Realistic Launch Plan](REALISTIC_LAUNCH_PLAN.md), the
[Credential Reader Signal Model](CREDENTIAL_READER_SIGNAL_MODEL.md), the
[Smart Locker Identity & Custody Model](SMART_LOCKER_IDENTITY_CUSTODY_MODEL.md), and
the [DockBridge Strategy](DOCKBRIDGE_STRATEGY.md), and stays inside the guardrails in
[`AGENTS.md`](../AGENTS.md).

## 1. The ecosystem as one flow

SignalGrid sits between the systems that already own the truth and the people and
hardware that act on it. Hardware signals (credential/badge readers, smart lockers,
docks via DockBridge, RTLS/location) and software posture signals (Microsoft Entra ID
+ Intune, read-only) feed one decision loop. The loop normalizes those signals,
evaluates a versioned policy, captures immutable evidence, appends a tamper-evident
audit event, and then **routes the outcome back out** to hardware, to the worker, and
to the operator.

Existing systems remain systems of record. SignalGrid does not replace them. It
**normalizes** their public-safe signal shapes, **decides** an outcome, **routes**
approved actions, **audits** the evidence, and **verifies** the expected result.

```mermaid
flowchart TD
    subgraph Sources["Signal sources (systems of record)"]
        direction LR
        HW["Hardware signals<br/>credential / badge reader<br/>smart locker / bay<br/>dock (DockBridge)<br/>RTLS / location"]
        SW["Software posture signals<br/>Microsoft Entra ID + Intune<br/>(read-only, cached, fixture-backed)"]
    end

    HW --> N["Normalize<br/>map to typed signals<br/>mark freshness / confidence<br/>missing ⇒ unknown, never healthy"]
    SW --> N

    N --> D{"Decision<br/>versioned policy<br/>most-restrictive-wins<br/>fail-closed"}
    D -->|ALLOW| O
    D -->|STEP-UP| O
    D -->|RESTRICT| O
    D -->|DENY| O

    O["Outcome + reason codes<br/>matched rules"] --> E["Evidence snapshot<br/>(immutable, content-digested)"]
    E --> A["Audit event<br/>(append-only, digest-chained)"]

    A --> R["Resolution routing<br/>per-tenant ResolutionConfig<br/>approval-gated + simulated"]

    R --> RHW["Back to hardware<br/>badge-reader prompt<br/>smart-locker / bay instruction<br/>dock / device prompt"]
    R --> RW["Back to worker<br/>device prompt<br/>self-service resolution steps"]
    R --> RO["Back to operator<br/>operator console<br/>ITSM ticket (routed, not owned)"]

    RHW -.verify expected result.-> N
    RW -.verify expected result.-> N
    RO -.verify expected result.-> N
```

The dashed lines close the loop: after a routed (and, in this public core, simulated)
action, SignalGrid expects to re-observe the signal and verify the result, rather than
assuming success.

### What flows out to whom

| Destination | Example outbound instruction | Owned by |
| ----------- | ---------------------------- | -------- |
| Device (worker) | "Your device needs a posture re-sync before this session" prompt | Worker self-service |
| Badge / credential reader | Step-up / re-verify identity prompt at the reader | PACS / reader remains SoR |
| Smart locker / bay | "Return to the assigned bay" or hold-release instruction | Locker system remains SoR |
| Dock (DockBridge) | Device prompt on undock / wrong-slot return | Dock/MDM remain SoR |
| Operator console | Alert with reason codes + traceable evidence | SignalGrid surfaces, human decides |
| ITSM | Routed ticket for a compliance/security block | ITSM remains SoR for the ticket |

SignalGrid routes to these destinations; it does not own them and does not write to
them in this public Review Hub. Routed actions are approval-gated and simulated.

## 2. The Resolution Assistant

When a decision is **not** `allow` (`step_up`, `restrict`, or `deny`), a worker or
operator is left with a blocked action and a set of reason codes. The Resolution
Assistant is a deterministic, fixture-backed helper that turns that non-allow decision
into a resolution **plan** and can **simulate** the projected outcome.

It does four things, all deterministically and all from the existing decision record:

1. **Explains why** access was blocked.
2. **Produces ordered resolution steps**, each with an audience, a channel, and a
   resolution class.
3. **Simulates** the resolution: applies the simulated fixes for resolvable reason
   codes and re-evaluates the policy to show the projected outcome.
4. **Escalates** only what genuinely needs a person.

### 2.1 Explain why (reason codes → language)

Each reason code on the decision maps to two public-safe explanations: worker-facing
(plain, actionable) and operator-facing (precise, diagnostic). No PHI/PII, no tenant
data — only the reason code and the normalized signal shape.

> **Canonical catalog:** [`docs/REASON_CODES.md`](REASON_CODES.md) — generated
> from the engine source and gate-enforced (`scripts/check-reason-codes.mjs`).
> The tables below are an illustrative subset. An earlier revision of this
> section named four codes the engine has never emitted (DEVICE_POSTURE_STALE,
> IDENTITY_UNVERIFIED, WRONG_BAY_OR_CUSTODY, CRITICAL_ON_UNTRUSTED_DEVICE) —
> corrected 2026-08-21; absence corroborated four ways per code.

| Reason code | Worker-facing | Operator-facing |
| ----------- | ------------- | --------------- |
| `POSTURE_STALE` | "Reconnect the device (or return it to its dock) to refresh its compliance check, then retry." | Posture freshness lapsed; request a posture re-sync from the device-management source, then re-evaluate. |
| `IDENTITY_STATE_UNKNOWN` | "We couldn't confirm your account's status. Step up to continue." | Identity state unreported by the IdP source; unknown raises assurance (step-up), never lowers it. |
| `DEVICE_NONCOMPLIANT` | "This device needs an admin fix before you can continue." | Intune compliance state non-compliant; remediation is owner/admin-gated. |
| `DEVICE_UNMANAGED` | "This device isn't enrolled for this workflow." | Device not managed / not enrolled; enrollment is admin-gated. |
| `CUSTODY_EXCEPTION` | "A custody issue was flagged — an operator is reviewing the device's dock/bay status." | Custody exception raised (removed without a session?); review and clear or route it. |
| `IDENTITY_DISABLED` | "Your account is disabled. Contact your administrator." | Entra identity disabled; hard block, no self-service path. |
| `CRITICAL_WORKFLOW_UNTRUSTED_DEVICE` | "This high-risk workflow requires a managed, trusted device — switch to one to continue." | Critical workflow attempted on an untrusted device; do not grant on this device. |

### 2.2 Ordered resolution steps and resolution classes

Every step carries an **audience** (`worker` / `operator` / `admin` / `system`), a
**channel** (device prompt, badge reader, smart-locker/bay, operator console, ITSM),
and a **resolution class**:

- **`auto_proposed`** — low-risk, reversible, and safe to propose and simulate
  directly (e.g. request a posture re-sync, or re-verify identity at the reader).
- **`requires_approval`** — an owner or admin must approve before it could ever run
  (e.g. device compliance remediation, enrollment, encryption enforcement).
- **`manual_only`** — a hard block that needs a human decision with no simulated fix
  (e.g. a disabled account, or a critical workflow attempted on an untrusted device).

| Reason code | Proposed step | Audience | Channel | Class |
| ----------- | ------------- | -------- | ------- | ----- |
| `POSTURE_STALE` | Request a posture re-sync, then re-evaluate | worker / system | device prompt | `auto_proposed` |
| `IDENTITY_STATE_UNKNOWN` | Step up (re-verify) to continue; IdP state re-queried | worker | device prompt | `auto_proposed` |
| `CUSTODY_EXCEPTION` | Operator reviews and clears the custody exception | operator | operator console | `requires_approval` |
| `DEVICE_NONCOMPLIANT` | Open compliance remediation for owner/admin approval | admin | operator console / ITSM | `requires_approval` |
| `DEVICE_UNMANAGED` | Propose enrollment for admin approval | admin | operator console / ITSM | `requires_approval` |
| `IDENTITY_DISABLED` | Escalate to administrator | operator | operator console / ITSM | `manual_only` |
| `CRITICAL_WORKFLOW_UNTRUSTED_DEVICE` | Advise a managed shared device; no grant on this one | operator | operator console | `manual_only` |

Steps are emitted in a deterministic order: `auto_proposed` first (fastest safe
self-service), then `requires_approval`, then `manual_only`.

### 2.3 Simulate the resolution (preview only)

The assistant can **simulate** the plan: it applies the simulated fixes for the
resolvable reason codes to a copy of the evidence and re-evaluates the same versioned
policy to project the outcome. For example, "after a posture re-sync this decision
would become `ALLOW`," or "resolving identity would move this from `deny` to
`step_up`; the remaining `DEVICE_NONCOMPLIANT` block still requires admin approval."

This is a **preview only**. The simulation never mutates the original decision, never
touches a source system, and never runs a real fix. It re-runs the deterministic
policy engine over a hypothetical evidence set and reports the projected outcome and
which reason codes would clear.

```mermaid
flowchart LR
    DEC["Non-allow decision<br/>+ reason codes"] --> CLASSIFY["Classify each reason code<br/>auto / approval / manual"]
    CLASSIFY --> SIM["Simulate: apply fixes for<br/>resolvable codes to an<br/>evidence COPY"]
    SIM --> REEVAL["Re-evaluate same<br/>policy version"]
    REEVAL --> PROJ["Projected outcome<br/>e.g. would become ALLOW"]
    PROJ -. preview only, nothing executed .-> DEC
```

### 2.4 Safety (stated explicitly)

- Every proposed action is **approval-gated and simulated**. SignalGrid **records and
  simulates — it never executes a change on a source system.**
- There is **no autonomous production remediation**. Nothing in this public core runs
  a real fix; the flow is diagnose → propose → simulate → (human approves in the
  private core).
- `requires_approval` steps cannot be run from a default path; the approval gate is
  explicit and is not bypassed.
- `manual_only` blocks never receive a simulated fix — they always reach a human.
- Malformed, missing, or ambiguous high-risk input does not produce an allow: missing
  evidence is treated as `unknown`, and allow is suppressed fail-closed.
- The private production core is where a real fix would ever run, and it would gate
  that execution behind explicit human approval. This public Review Hub does not.

To restate: **there is no autonomous production remediation here.** SignalGrid does
not execute changes on Entra, Intune, PACS, locker, dock, RTLS, or ITSM systems. It
proposes and simulates; a human approves; a source system (not SignalGrid) remains the
actor and the system of record.

### 2.5 Time saved / self-service

The assistant automates the diagnosis and proposes and simulates the safe, reversible
fixes, escalating only what genuinely needs a person. In practice:

- Many `step_up` and `restrict` cases (stale posture, unverified identity, wrong bay)
  become **self-service** — the worker resolves them from a device or reader prompt
  and the projected outcome is shown before they act.
- Only true security/compliance blocks (`requires_approval` remediation, or
  `manual_only` disabled-account / untrusted-device blocks) reach an operator.

The result is less operator time spent triaging routine posture problems, and a
shorter path from "blocked" to "resolved" for the worker — without weakening any
approval gate.

## 3. Per-organization control (ResolutionConfig)

Each organization controls the flow through a per-tenant **`ResolutionConfig`**. The
config is tenant-scoped like every other entity — it is derived from the authenticated
key, never supplied by the caller. Two fields drive behavior:

- **`primaryHardwareChannel`** — the hardware surface a tenant leads with for
  worker-facing resolution (e.g. `credential_reader` for a hospital, `smart_locker`
  for a warehouse).
- **`autoProposeEnabled`** — whether the assistant may surface `auto_proposed` steps
  as self-service, or route everything to a human. When `false`, even low-risk
  reversible steps are routed to an operator instead of proposed self-service.
  `requires_approval` and `manual_only` are unaffected — they always require a human
  regardless of this toggle.

```jsonc
// public-safe shape (illustrative, not real config)
{
  "primaryHardwareChannel": "credential_reader", // or "smart_locker" | "dock" | "device"
  "autoProposeEnabled": true
}
```

### Hospital (Northwind) vs. warehouse (Atlas)

Both tenants read the same public-safe demo core; only their `ResolutionConfig`
differs. (Tenant labels below are the existing public-safe demo tenants, not customer
data.)

| Aspect | Northwind Health (hospital) | Atlas Logistics (warehouse) |
| ------ | --------------------------- | --------------------------- |
| `primaryHardwareChannel` | `credential_reader` (badge tap at shared iPad) | `smart_locker` (handheld checkout at bay) |
| `autoProposeEnabled` | `true` — stale posture / re-verify handled at the reader | `true` — wrong-bay / re-sync handled at the locker |
| Worker self-service leads with | Badge-reader step-up prompt | Smart-locker / bay instruction |
| Typical `auto_proposed` case | Re-verify identity at reader; request posture re-sync | Return to assigned bay; request posture re-sync |
| Typical `requires_approval` case | Compliance remediation on a shared clinical iPad | Enrollment of an unmanaged handheld |
| Typical `manual_only` case | Disabled clinician account | Critical workflow on an untrusted device |
| Escalation channel | Operator console + ITSM | Operator console + ITSM |

A tenant that prefers tighter control can set `autoProposeEnabled: false` so that
every resolution step — including low-risk ones — is routed to an operator rather than
offered as self-service. The organization, not SignalGrid, decides how much the system
self-proposes versus routes to a human.

## 4. The `/v1` endpoints

Two tenant-scoped endpoints expose the plan and the simulation. Both read the same
public-safe demo core, require the caller's bearer token, and derive the tenant from
that token — no route accepts a tenant id from the client, which is what keeps
cross-tenant access structurally impossible.

| Method & path | Permission | Purpose |
| ------------- | ---------- | ------- |
| `GET /api/v1/decisions/{id}/resolution` | `decision:read` | Return the resolution plan (explanations + ordered, classified steps) for a decision. Read-only; nothing is executed. |
| `POST /api/v1/decisions/{id}/resolve` | `decision:read` | Simulate the resolution: apply simulated fixes for resolvable reason codes, re-evaluate the same policy version, and return the projected outcome. Preview only; nothing is executed and the original decision is unchanged. |

`GET .../resolution` corresponds to the plan in §2.1–2.2. `POST .../resolve`
corresponds to the simulation in §2.3 — it is a projection, not an action. Neither
endpoint writes to a source system, and `POST .../resolve` requires only
`decision:read` precisely because it changes nothing: it simulates and returns a
preview. Any step classed `requires_approval` remains gated behind explicit human
approval in the private core and is never executed from these public endpoints.

Example (public-safe demo key, not a real credential):

```bash
# Get the resolution plan for a non-allow decision
curl -s http://localhost:5174/api/v1/decisions/decision-123/resolution \
  -H "Authorization: Bearer sgk_demo_northwind_operator"

# Simulate the resolution (preview only — nothing is executed)
curl -s -X POST http://localhost:5174/api/v1/decisions/decision-123/resolve \
  -H "Authorization: Bearer sgk_demo_northwind_operator"
```

## What is deliberately NOT here (private-core / human boundary)

Consistent with [`AGENTS.md`](../AGENTS.md) and the launch plan, this design does
**not** contain and does **not** claim:

- any execution of a change on a source system (Entra, Intune, PACS, locker, dock,
  RTLS, ITSM) — everything is proposed and simulated only;
- no autonomous production remediation;
- real authentication providers, secrets, tenant IDs, customer data, or PHI/PII;
- real Microsoft Graph or vendor calls;
- that SignalGrid does not replace any system of record. SignalGrid does not
  replace IAM, IGA, UEM/MDM, PACS, locker, dock, RTLS, or ITSM; they remain
  authoritative.

Real execution belongs to the private production core, gated behind explicit human
approval, with the source system remaining the actor and the system of record.
SignalGrid normalizes signals, decides outcomes, routes approved actions, audits
events, and verifies expected results.
