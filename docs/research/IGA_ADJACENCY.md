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

## What SignalGrid does not do: entitlement fulfilment

SignalGrid does not do entitlement fulfilment. It does not grant, provision,
deprovision or revoke identity entitlements (roles, groups, access packages),
in a target system or by opening an ITSM/ticketing request for someone to
fulfil one manually. The simulated device-setup plans in
`lib/flows/src/provisioning.ts` and `lib/flows/src/provisioning-teardown.ts`
carry `account` and `revoke` steps for a device's own bindings; those are not
IGA entitlement fulfilment and do not change this boundary. Provisioning,
including provisioning routed through ticketing for manual fulfilment, is an
IGA capability and stays with the IGA product. The orchestration plan a
SignalGrid decision carries acts on the workflow that is happening now; the
most it sends toward governance is the review or recertification request in
the handoff above, which the IGA product decides on and fulfils.

## Further IGA vendors a buyer may run

Named so the adjacency above is not read as limited to six products. Each line
is the vendor's own public description, paraphrased, from the page cited and
accessed on the date shown. Nothing here is a comparison, a rating, or a claim
that SignalGrid integrates with, partners with, or has been tested against any
of them.

| Vendor / product | Public self-description (paraphrased) | Source (accessed 2026-09-30) |
|---|---|---|
| Radiant Logic — RadiantOne | An identity data platform that aggregates, correlates and synchronises identity data from many sources and monitors access paths, entitlements and identity changes. Presented as a data foundation for an IAM programme; its site also lists governance and compliance capabilities (access review, role mining, segregation of duties) under https://www.radiantlogic.com/solutions/iga-capabilities/ (linked from the home page, not itself read). | https://www.radiantlogic.com/ |
| Oracle Identity Governance | Self-service, compliance, provisioning and password management for on-premises and cloud applications (product documentation, release 12.2.1.4). The Oracle marketing page https://www.oracle.com/security/identity-management/governance/ returned HTTP 403 on this date and was not read. | https://docs.oracle.com/en/middleware/idm/identity-governance/12.2.1.4/omadm/product-overview-oracle-identity-governance.html |
| Symantec Identity Governance and Administration (IGA), Broadcom | Automates user provisioning and access governance to enforce least-privileged access (TechDocs, release 15.0). | https://techdocs.broadcom.com/us/en/symantec-security-software/identity-security/identity-suite/15-0.html |
| OpenText NetIQ Identity Governance | Governs access across on-premises and SaaS resources, automating access reviews, approvals and policy enforcement. | https://www.opentext.com/products/identity-governance |
| IBM Verify Identity Governance | Provisioning, audit and reporting on user access and activity across lifecycle, compliance and analytics, on premises and in the cloud. The product page accessed names it "IBM Verify Identity Governance"; the earlier name "IBM Security Verify Governance" was not re-checked against IBM's own naming history. | https://www.ibm.com/products/verify-governance |

All five describe provisioning or access governance among what they do: the
IGA side of the "Who owns what" table, which SignalGrid does not occupy.

## Objection handling

**"We already have SailPoint / Saviynt / Entra ID Governance / Omada / One
Identity / Okta."**

Keep them — they're the right tool for governance, and SignalGrid is not trying
to replace them. What they do *not* do is stand at the shared ward tablet at
2 a.m. and decide whether *this* medication-administration workflow should
proceed on *this* device, given that the badge was just withdrawn, the device is
off its dock (badge and dock are deferred families, not Limited GA), and posture
is one hour stale. Entitlement says the nurse *may*
perform med-admin; SignalGrid decides whether *this attempt, right now* is
trustworthy — and holds the sensitive step for a human. That runtime,
in-context, per-workflow gap is what SignalGrid fills, on top of the identities
your IGA already governs.

**"Isn't 'access decisioning' just Conditional Access / policy in our IdP?"**

Conditional Access is identity-and-session centric and excellent at login.
SignalGrid decides per *workflow* on shared/frontline devices and fuses signals
an IdP doesn't see — device posture and device-management health today (Limited
GA); physical custody, dock state, badge binding and tamper as deferred
families, not Limited GA — then orchestrates the downstream action with a
human-confirmed assist on anything sensitive. It complements Conditional Access; it doesn't
replace it.

## Claim boundaries

- No replacement claim for any IGA, IAM/IdP, PAM, or Conditional Access product.
- No partnership, certification, validated-integration, marketplace, or alliance
  claim with any named vendor.
- No production-ready or compliance-certification claim.
- Vendor names appear only as the widely-known systems a buyer likely runs, to
  make the adjacency concrete.
- Custody, dock, badge and tamper signals are deferred families (design
  targets), not Limited GA; Limited GA today is Microsoft Graph,
  device-management health and local authority (`scripts/launch-profile.mjs`).

See also: [`POSITIONING.md`](../POSITIONING.md) (the live positioning page),
[`PURPOSE.md`](../PURPOSE.md) §2 (the product sentence; no category label is
ratified — DR-019/DR-020) and [`ECOSYSTEM_POSITIONING.md`](../ECOSYSTEM_POSITIONING.md)
(the full category matrix). Until 2026-09-06 this line also pointed at a retired
label exploration as "the category definition"; that page is superseded and is
kept for provenance only.
