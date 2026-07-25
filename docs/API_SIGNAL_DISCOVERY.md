# API Signal Discovery — the living catalog of candidate signal APIs

A running record of **public, read-only vendor APIs** evaluated as candidate signal
sources for the decision fabric, and how each maps onto a normalized SignalGrid
dimension. This is a research artifact: it exists so connector design starts from
what real APIs actually expose, instead of from an invented shape.

> **Non-claims.** Nothing here is a partnership, endorsement, certification,
> integration, procurement recommendation, or vendor ranking. No live vendor call is
> made anywhere in this repository — every connector is fixture-backed and gated.
> Vendor names appear as *public API surfaces studied*, nothing more. Where an entry
> says "unverified", it has not been confirmed against primary documentation and must
> not be treated as fact.

## How to read this

| Column | Meaning |
| --- | --- |
| **Signal surface** | The read-only facts the API exposes that a decision could use. |
| **Maps to** | The SignalGrid dimension that already normalizes this class of signal. |
| **Verified** | ✅ confirmed against primary docs / an open-source reference implementation; ⚠️ partial; ❓ not yet verified. |

---

## Physical access control (PACS) → `pacs-access`

The [`pacs-access`](INTEGRATION_CATALOG.md) dimension was designed against these
surfaces. Two independent vendors were studied to keep the normalized shape
vendor-neutral rather than modeled on any single product.

### UniFi Access (Ubiquiti) — ✅ verified

Local **REST + WebSocket** on the controller; real-time door events without polling.
Confirmed via the official developer portal summary and the open-source Home
Assistant integration (`imhotep/hass-unifi-access`), which is a useful public
reference for the event shape.

| Observed | Detail |
| --- | --- |
| Event names | `unifi_access_entry`, `unifi_access_exit`, `unifi_access_access` |
| Event metadata | `actor`, `authentication`, `method`, `result`, `reader_id`, `reader_name` |
| Result values | `ACCESS` (granted) vs `BLOCKED` / other non-ACCESS (denied) |
| Auth methods | NFC, PIN code, Face |
| Door position | Door Position Sensor (DPS) binary sensor — open / closed; **absent DPS reports closed** |

**Why it matters for the lab:** this is the lowest-cost real PACS with a documented
local API — a genuine door → event → decision loop can be stood up without an
enterprise access-control procurement cycle.

### Verkada Command — ✅ verified (event model + operational limits)

Cloud access control with **Access Events Webhooks** (`notification_type`, including
`door_held_open`).

| Observed | Detail |
| --- | --- |
| Door held open | **DHO** with a configurable DHO threshold |
| Door forced open | **DFO** |
| Tailgating | Dedicated detection — multiple people entering on a single access grant raises a tailgating-flagged event |
| Hardware dependency | DHO / DFO / tailgating alerts require a **door position indicator (DPI)** to be installed |

**Operational limits for a live bridge** (from `apidocs.verkada.com`): the API token is
obtained by calling the token endpoint with an API key and is **valid 30 minutes**,
passed as an `x-verkada-auth` header; the rate limit is **300 requests/minute per
organization across all endpoints**, returning HTTP 429 on breach with a **5-second
cooldown** before retrying. The Access Events API requires a key scoped to the Access
Control endpoints.

These numbers set the shape of any live adapter: a 30-minute token means refresh has to
be built in rather than bolted on, and a per-org (not per-key) budget means SignalGrid's
polling has to share headroom with whatever else the customer already runs against
Command. That argues for the webhook path over polling wherever the customer's
deployment supports it.

### Control iD (biometric door & turnstile controllers) — ✅ verified

Device-level API studied via its published Postman collection. Read surface includes
**access logs**, **access rules + access-rule time zones**, **cards**, **alarm logs**,
**anti-passback modes** (daily / timed variants), and reader configuration including
**HID reader modes (Wiegand W26/W37, Mifare, Indala)** and **OSDP** settings. The same
collection also exposes *write* operations (activate turnstile relay, emergency,
configuration) — deliberately **out of scope**: SignalGrid reads and decides; the PACS
actuates.

### Cross-vendor field mapping

The normalized `pacs-access` fields hold across both verified vendors — evidence the
shape is genuinely vendor-neutral:

| `pacs-access` field | UniFi Access | Verkada Command |
| --- | --- | --- |
| `accessResult` | `result` = `ACCESS` / `BLOCKED` | access granted / denied event |
| `credentialType` | `method` / `authentication` — NFC, PIN, Face | credential / badge type |
| `doorState` | Door Position Sensor (open/closed) | DPI + **DFO** (forced), **DHO** (held open) |
| `antipassback` | anti-passback configuration | **tailgating detection** event |
| `authorization` | access policy / schedule | access level + schedule |
| `identityMatched` | `actor` vs the checked-out badge-holder | user identity vs holder |

**Design insight taken from this research:** door-state detection depends on physical
DPS/DPI hardware. Where no sensor exists, forced/held **cannot** be known — so
`doorState: "unknown"` is a real-world state, not a defensive edge case. The evaluator
treats it as `step_up` (never a grant), which the 8,100-combination brute-force proof
enforces.

### HID Origo (mobile credential plane) — ✅ verified (auth + surface)

Not a door-event API — a **credential lifecycle** API, which is why it belongs here
rather than in the event mapping. Public documentation at `doc.origo.hidglobal.com/api/`.

| Observed | Detail |
| --- | --- |
| Auth | OAuth 2.0 bearer token, issued to a **System Account** created in the Origo Management Portal under the Organization Administrator role |
| Surfaces | Mobile Identities (user / device / credential administration), Credential Management (issuance), User Management |
| Identity sync | User Management supports **SCIM v2** |

**Why it matters:** a badge that has been *revoked in Origo* but is still physically in
someone's hand is exactly the "leaver still holding a key" case the fabric already
models for non-human identities. This is a credential-state signal, not an entry event —
it would pair with `pacs-access` rather than replace it.

### Genetec Security Center — ◐ partial (surface confirmed, shape not)

Integration is via the **WebSDK REST API**; the Web App exposes a *door activity report*
covering access-denied events and door status, and third-party visitor/access systems
integrate cardholder, credential and permission data through it. Enough to confirm a
door-event surface exists and is REST-reachable. The concrete field names and event
enums are **not** public, so nothing is mapped into the cross-vendor table below on the
strength of this — recorded as partial rather than guessed at.

### PACS — still to verify (❓)

Brivo, LenelS2 OnGuard, HID Aero (the controller line, distinct from Origo above),
Gallagher, ZKBio CVSecurity. Most gate their API documentation behind partner or
customer login, so they are recorded here as *unverified* rather than guessed at.

---

## Identity, IGA and PAM → `sso-session`, `oauth-consent`, `access-governance`

Surfaced via the Postman public network (official publisher workspaces):

| API | Signal surface | Maps to | Verified |
| --- | --- | --- | --- |
| Okta Admin Management | users, sessions, devices, policies | `sso-session` | ✅ present |
| Okta OpenID Connect & OAuth 2.0 | token / grant introspection | `oauth-consent`, `token-binding` | ✅ present |
| Okta **Privileged Access** | privileged session + elevation state | `access-governance` | ✅ present |
| Okta **Governance** (IGA) | entitlement, certification, SoD | `access-governance` | ✅ present |
| Okta Access Gateway | app access enforcement context | `sso-session` | ✅ present |
| Microsoft Graph | identity, device compliance, risk | `graph`, `intune-entra-posture`, `identity-risk` | ✅ built |

## ITSM / incident routing → `incident-playbook`

ServiceNow (public collections present). The Priority = Impact × Urgency matrix and
assignment-group routing the playbook implements follow the ServiceNow model.

## Device management plane → (queued dimension)

`ugurkocde/IntuneAutomation` — a public catalog of read-only Intune/Graph automation
scripts. Signals worth a dimension: device **check-in staleness**, **policy drift**
from an assigned baseline, **compliance-policy coverage gaps**, **enrollment failures**,
and recovery-key escrow / LAPS rotation state.

**Status: built.** Shipped as the `device-management-health` dimension — see
[INTEGRATION_CATALOG](INTEGRATION_CATALOG.md). Four of the five signals above are
modelled (`checkInFreshness`, `policyDrift`, `complianceCoverage`, `enrollmentState`);
recovery-key escrow / LAPS rotation state is **not** yet modelled and remains open.

---

## Method

1. Search the public Postman network per signal category (single-vendor queries
   return far better results than multi-vendor phrases).
2. For anything gated, fall back to primary vendor documentation and **open-source
   reference implementations** — a working integration is often a more reliable record
   of the real event shape than marketing docs.
3. Record only what was verified; mark the rest ❓.
4. Where two independent vendors agree on a concept, that concept is a strong
   candidate for a normalized field. Where only one does, treat it as vendor-specific
   and keep it out of the normalized shape.

### Status of the automated sweep

The recurring discovery sweep is **not yet automated**, and the blocker is now precise
rather than vague. The Postman connector is **authenticated at the org level but toggled
off for this session** (`connected: true`, `enabledInChat: false`) — re-enabling it is a
manual switch in the session's connector settings and cannot be done from here.
Separately, several vendor documentation sites reject automated fetches through the
proxy, so the findings above were established via public search plus open-source
reference implementations rather than by fetching vendor docs directly.

When the connector is enabled, the intended shape is a scheduled job that re-runs step 1
across every signal category and opens a PR appending new findings to this file. The
per-vendor entries above are what that job would produce by hand today; the entries
marked ❓ are the queue it would work through.
