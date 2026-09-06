# SignalGrid and IGA — adjacent, not overlapping

> **Public-safe positioning note.** SignalGrid does not replace, and makes no
> partnership/certification claim about, any IGA product. This note is informed
> by the current IGA landscape; it does not reproduce any analyst's ratings,
> quotes, or proprietary content.

The most common question from an identity-mature buyer is *"we already run
SailPoint / Saviynt / Microsoft Entra ID Governance — where does SignalGrid
fit?"* The short answer: **IGA governs who *should* have access; SignalGrid
decides whether an action *should proceed right now*.** Different question,
different moment, different system of record.

## The one-line distinction

- **IGA** answers **"should this person hold this entitlement?"** — decided
  ahead of time and reviewed on a cadence (birthright access, roles, access
  certifications, separation-of-duty, joiner/mover/leaver lifecycle).
- **SignalGrid** answers **"should this workflow proceed on this device, in this
  context, right now?"** — decided at the instant the workflow fires, per
  request, from live signals.

Governance sets the standing rules. SignalGrid makes the runtime call the
moment a shared tablet changes hands and a high-risk workflow starts.

## Who owns what

| Dimension | IGA (governance) | SignalGrid (runtime decision) |
|---|---|---|
| Question answered | Should this identity have this entitlement? | Should this action proceed here, now? |
| When it's decided | Ahead of time; reviewed periodically | At the moment the workflow fires |
| Cadence | Certifications, JML events (quarterly / on change) | Continuous, per request |
| Unit of decision | Entitlements, roles, access packages | One workflow on one device, in context |
| Primary inputs | HR / directory, roles, entitlement catalog, access history | Identity state + device posture + custody / physical + workflow risk |
| Output | Provision / deprovision, certify, revoke, remediate entitlement | allow / step-up / restrict / deny + an orchestration plan |
| System of record | The entitlement & identity lifecycle | The decision + its evidence (not entitlements) |

## The handoff (they work together)

SignalGrid **consumes** IGA governance state as *one signal among many* —
privileged-identity status, certification/attestation state, entitlement
context — and can **emit** a recertification or access-review request back when
a runtime decision suggests one. IGA remains the system of record for
entitlements and lifecycle; SignalGrid never tries to own that.

Because the IGA cadence above is periodic while the decision is continuous,
the consumed state itself has a currency: a bridge whose upstream HR/SCIM sync
silently broke keeps truthfully relaying its **last** evaluation — affirmative
values, aged. The `access-governance` family therefore carries a
governance-read recency axis (intake ledger row 42): the bridge reports the
instant its relayed state was last synchronized (the shape Entra exposes
read-only per object — provisioning-log `activityDateTime`,
`onPremisesLastSyncDateTime`, the synchronization job's last successful
execution), the caller poses how old that read may be, and a stale read steps
up — a challenge, never a lockout, and never a downgrade of stale *bad* news
(a leaver relayed stale still escalates). Consuming that timestamp owns the
provisioning pipeline no more than consuming certification state owns
certifications.

```
IGA  ──(governance state: entitlements, cert status, privileged flag)──▶  SignalGrid
SignalGrid  ──(runtime decision evidence, review / recertification request)──▶  IGA
```

## Objection handling

**"We already have SailPoint / Saviynt / Entra ID Governance / Omada / One
Identity / Okta."**

Keep them — they're the right tool for governance, and SignalGrid is not trying
to replace them. What they do *not* do is stand at the shared ward tablet at
2 a.m. and decide whether *this* medication-administration workflow should
proceed on *this* device, given that the badge was just withdrawn, the device is
off its dock, and posture is one hour stale. Entitlement says the nurse *may*
perform med-admin; SignalGrid decides whether *this attempt, right now* is
trustworthy — and holds the sensitive step for a human. That runtime,
in-context, per-workflow gap is what SignalGrid fills, on top of the identities
your IGA already governs.

**"Isn't 'access decisioning' just Conditional Access / policy in our IdP?"**

Conditional Access is identity-and-session centric and excellent at login.
SignalGrid decides per *workflow* on shared/frontline devices and fuses signals
an IdP doesn't see — physical custody, dock state, badge binding, tamper, device
baseline drift — then orchestrates the downstream action with a human-confirmed
assist on anything sensitive. It complements Conditional Access; it doesn't
replace it.

## Claim boundaries

- No replacement claim for any IGA, IAM/IdP, PAM, or Conditional Access product.
- No partnership, certification, validated-integration, marketplace, or alliance
  claim with any named vendor.
- No production-ready or compliance-certification claim.
- Vendor names appear only as the widely-known systems a buyer likely runs, to
  make the adjacency concrete.

See also: [`ECOSYSTEM_POSITIONING.md`](../ECOSYSTEM_POSITIONING.md) (the full
category matrix) and
[`OPERATIONAL_TRUST_ORCHESTRATION.md`](../OPERATIONAL_TRUST_ORCHESTRATION.md)
(the category definition).
