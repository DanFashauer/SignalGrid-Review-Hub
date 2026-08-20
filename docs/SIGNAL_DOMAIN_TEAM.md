# The signal-domain team — an IT professional behind every signal

**Established 2026-08-19, on the owner's question:** *"Where are my other
employees that are IT professionals in every department that represents a
signal which is based on a specific type of IT product … and they know how to
set up and build that into the system we call SignalGrid."*

The gap was real. `docs/VIRTUAL_TEAM.md` staffs **engineering functions** — QA,
security, PM, web, SRE, principal, mobile, compliance, performance. Those roles
review code. Not one of them is the person who has actually stood up Intune in
a 2,000-device tenant, argued with Cisco ISE about an 802.1X failure at 2am, or
tuned a Wazuh ruleset until it stopped crying wolf. **That knowledge is what
makes a connector correct**, and until now nothing in the org chart carried it.

So the team has a second axis. Function is *how* work is done; **domain is
what the signal actually is**, in the world, before it becomes a row in the
Grid.

## The rule that makes this more than a org-chart exercise

A signal-domain role is accountable for one thing above all others:

> **What does the real product actually emit, and does what SignalGrid
> consumes match it?**

That is the question the Fleet and Headwind live checks answered by standing up
a real server and driving its real wire protocol — and both times it found
something the fixture had wrong. Every department below owes its dimensions the
same treatment. A domain expert who only reads our own code is not a domain
expert; they are a second reviewer.

## The six departments

The 51 signal dimensions under `lib/integrations/src/integrations/` are not 51
jobs — in a real IT organization they sit in six departments, and that is how
they are staffed here.

### 1. Identity & Access Management (IAM)

**Real products the role represents:** Microsoft Entra ID, Okta, Keycloak,
Ping, ADFS; FIDO2/WebAuthn authenticators; PIM/PAM tooling.

**Dimensions owned:** `identity-risk`, `sso-session`, `platform-sso`,
`token-binding`, `passkey-assurance`, `oauth-consent`, `access-governance`,
`entitlement-binding`, `credential-rotation`, `credential-exposure`,
`bootstrap-credential`, `break-glass`, `local-authority`,
`challenge-capability`, `device-attestation`.

**Live-verified today:** Keycloak 26.4 (`proof:live-keycloak`) — including an
independent DPoP thumbprint agreement, which is the strongest kind of
cross-implementation check this repo has.

**Accountable for:** whether our notion of "this session is strongly
authenticated" survives contact with how these products are actually
configured — conditional access that is scoped to a group nobody audits, an
authentication method that cannot enforce the policy claimed on it, a token
whose binding is asserted but never verified.

### 2. Endpoint & Device Management (UEM / MDM)

**Real products:** Intune (+ Graph), Jamf Pro, Fleet, Headwind MDM, NanoMDM,
Omnissa/Workspace ONE, SOTI, 42Gears, Zebra StageNow / OEMConfig.

**Dimensions owned:** `uem`, `graph`, `macos-posture`,
`device-management-health`, `app-update`, `policy-binding`, `data-protection`,
`peripheral-control`, `service-lifecycle`.

**Live-verified today:** Fleet 4.89.2 end to end (`proof:live-fleet`,
`proof:live-fleet-workflow`, plus the live-query campaign collector) and
Headwind CE 5.30.3 (fixture shape-check over the real launcher protocol).

**Accountable for:** the platform-honesty line above all — an app cannot grant
device access, restrict other apps, make itself non-removable, or self-kiosk;
those are MDM/OS capabilities needing a supervised device. This department is
the one that must say so out loud when a claim drifts.

### 3. Security Operations (EDR / SIEM / vulnerability)

**Real products:** Wazuh, CrowdStrike Falcon, Microsoft Defender, Splunk,
Sentinel, Elastic Security; CIS-benchmark tooling; vulnerability scanners.

**Dimensions owned:** `edr-threat`, `siem`, `syslog`, `vuln-scan`,
`benchmark-selection`, `caep-events`, `observability-integrity`,
`response-accountability`, `agent-behavior`, `agent-identity`.

**Live-verified today:** Wazuh (`proof:live-edr`).

**Accountable for:** the distinction this fabric was built to keep — a *threat*
is not a *vulnerability*, an empty finding set is not a clean device, and an
unreachable agent raises assurance rather than lowering it. Also for knowing
what these consoles genuinely export versus what a dashboard merely displays.

### 4. Network & Connectivity

**Real products:** Cisco ISE, Aruba ClearPass, FortiNAC; Zscaler, Netskope,
Cloudflare/Cisco SSE; carrier and private-5G/eSIM platforms.

**Dimensions owned:** `nac`, `network-nac`, `link-usability`, `sse-egress`,
`carrier`, `webhooks`.

**Live-verified today:** none. **This is the department's first job** — it owns
the largest cluster of dimensions with no live source ever driven against it.

**Accountable for:** the rung ladder that already exists here — admission
(NAC) is not carriage (link usability) is not egress path (SSE) is not
out-of-band reachability (carrier) — and for the fact, already learned the hard
way in this tree, that a carrier API cannot prove the absence of a radio.

### 5. Physical, Facilities & OT

**Real products:** PACS/physical access control (badge readers, door
controllers), RTLS/BLE/UWB platforms, Traccar and fleet-location systems,
CMMS/facilities systems, OT/ICS historians and control networks.

**Dimensions owned:** `location-services`, `rtls-custody`, `custody-beacon`,
`pacs-access`, `ot-posture`.

**Live-verified today:** Traccar 6.14.5 (`proof:live-location`) — which found
that `geofenceIds: null` means both "outside every geofence" and "no geofence
linked", so the obvious mapping would report a stationary device at HQ as
off-premises.

**Accountable for:** the hardest honesty boundary in the product. A safety
system must be independent of everything else; a stale "safe" reading
manufactures a grant. This department holds the line that SignalGrid gates who
may *attempt* an action while the plant's own safety system decides whether the
machine is safe to move.

### 6. IT Service Management & Operations

**Real products:** ServiceNow, Jira Service Management, Freshservice; WMS and
task systems; osquery; change-advisory and shift-scheduling tooling.

**Dimensions owned:** `itsm`, `change-window`, `shift-context`,
`task-exception`, `session-readiness`, `telemetry`.

**Live-verified today:** osquery, via the Fleet lab (a real agent enrolled over
the genuine enroll/config/logger/distributed protocol).

**Accountable for:** the operational context that turns a technically-allowed
action into an appropriate one — is this inside an approved change window, is
this worker on shift, is this task exception real. And for the systems-of-record
boundary: the WMS stays the system of record; SignalGrid consumes and decides.

## What each department produces on a shift

Same shift loop as the function team (read-only findings → adversarial
verification → gated application), but the questions are domain questions:

1. **Wire truth.** Take one dimension. Find what the real product emits — from
   its own docs, or better, from a free/open-source instance actually stood up
   (the Fleet / Traccar / Keycloak / Wazuh / Headwind pattern). Compare against
   our fixture and normalizer, field by field. Report divergences.
2. **Deployment reality.** How is this product actually configured in the
   field, and which of our assumptions only hold in a lab? Group-scoped
   policies, licensing tiers that gate an API, an export that is console-only.
3. **The setup path.** What a customer's admin would actually have to do to
   feed this signal into SignalGrid — the runbook, the permissions required,
   the read-only boundary.
4. **The honest gap.** What this department cannot see, stated plainly.

## What this does not change

The breadth freeze stands: a domain expert identifying a gap does **not**
create a new connector family — `docs/DECISION_RECORDS.md` DR-001 defers all
five candidates until the launch wedge ships. These roles deepen the fifty-one
dimensions that already exist; they do not add a fifty-second. All the standing
constraints bind here too: no live credentials, no customer data, no production
claims, fixtures public-safe, and the embedded-UX law — domain safety belongs
in the host app, not in SignalGrid.
