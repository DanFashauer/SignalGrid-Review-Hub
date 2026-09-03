# MCP ecosystem — a source-independence map for SignalGrid's signal families

**Scope.** Nothing here is a claim of current capability. This is a fixture-first
research map, not a shipped, partner, or certified integration: **no external MCP
server is wired into this repository**, and no vendor named below is a partner,
customer, or endorser of SignalGrid. The map exists to make one true statement
concrete — *SignalGrid decides on top of the signals these systems produce, and
never replaces the system that produces them* — by showing, for each SignalGrid
signal-source family, which Model Context Protocol (MCP) servers in the wider
ecosystem expose that system's signals.

It mirrors the honesty of [`docs/SIGNAL_SOURCE_CATALOG.md`](../SIGNAL_SOURCE_CATALOG.md)
and the DR-027 `public-apis` absorption pattern: a public API or an MCP server is
a candidate signal source, read-only and behind an explicit opt-in if it is ever
wired at all; it is never a decision path, a proof fixture, or a shipped connector.
The family names are the real connector families under
`lib/integrations/src/integrations/`; the enterprise-stack framing is
[`docs/research/ENTERPRISE_SECURITY_STACK_COVERAGE_MAP.md`](ENTERPRISE_SECURITY_STACK_COVERAGE_MAP.md),
and the built connector detail is [`docs/INTEGRATION_CATALOG.md`](../INTEGRATION_CATALOG.md).

## Provenance

Gathered from public MCP directories and vendor documentation on **2026-09-02**.
`app.mcpmarket.com`'s deploy/creator side is authentication-walled and was **not**
enumerated; only the public directory and vendor docs were read. Tool counts and
per-server behaviours (elicitation, credential redaction, device-auth flow) are
external ecosystem facts recorded at that date and may age — the vendor's own docs
are authoritative, not this map. Absence of a server below is "not found by this
survey as of 2026-09-02", never "does not exist".

## How to read each row

Every row makes the same shape of claim, and only this shape:

- SignalGrid **ingests** the vendor-neutral signal these systems produce, normalizes
  it, fuses it, and returns `allow / step_up / restrict / deny` with audit evidence.
- SignalGrid **does not replace** the system of record — the IdP, EDR, SIEM, ITSM,
  NAC, physical-access system, UEM, scanner, or observability platform stays
  authoritative for its own domain (CLAUDE.md golden rule 3).
- An MCP server named here is one *possible* read-only transport for that signal in
  the ecosystem. None is wired; wiring one would send data to an external service and
  needs the owner's explicit go-ahead (DR-028), behind tier +
  `SIGNALGRID_LIVE_INTEGRATIONS` + a configured opt-in, as every connector already is.
- Where the ecosystem has **no** widely-adopted MCP server for a category, the row
  says so plainly rather than omitting the family.

<!-- MCP-ECOSYSTEM-MAP:BEGIN -->

| SignalGrid family / families | External system category | MCP servers in the ecosystem that expose that system's signals | SignalGrid's role (decides on top of; never replaces) |
| --- | --- | --- | --- |
| `identity-risk`, `sso-session`, `platform-sso`, `passkey-assurance`, `oauth-consent` | Identity / SSO / IAM | Okta MCP, Auth0 MCP, Keycloak OSS self-hosted MCP, Microsoft Entra ID MCP (via agentgateway), Casdoor built-in MCP | ingests sign-in risk, session, Platform SSO, passkey and OAuth-consent signals; decides on top; never replaces the IdP |
| `edr-threat`, `macos-posture`, `device-attestation` | EDR / endpoint threat & posture | CrowdStrike Falcon, SentinelOne Singularity, Microsoft Defender, Tanium (status/logs/scan/containment via MCP); Velociraptor MCP (DFIR) | ingests endpoint threat and hardening posture; decides on top; never replaces the EDR |
| `siem`, `syslog`, `telemetry` | SIEM / log / telemetry | Splunk MCP, Microsoft Sentinel MCP (+ Security Copilot / data lake), Elastic Security MCP | ingests correlated security signals; decides on top; never replaces the SIEM |
| `itsm` | ITSM | ServiceNow MCP (official), Jira MCP, PagerDuty MCP (community) | ingests ticket / change / approval state and routes; never replaces the ITSM |
| `nac`, `network-nac` | Network / NAC | Cisco Meraki via Meraki Magic MCP (Dashboard API); RADIUS CoA | ingests network access posture; decides on top; never replaces the NAC |
| `rtls-custody`, `pacs-access`, `custody-beacon` | Physical access / RTLS / custody | Seam MCP (smart locks & access codes across 100+ brands: list/get locks, create/update codes, lock/unlock) | ingests door and custody signals; decides on top; never replaces the access system |
| `uem`, `device-management-health` | MDM / UEM / device management | Fleet OSS MCP (osquery-based), Jamf, Intune, Kandji; osquery MCP | ingests device management and config-drift state; decides on top; never replaces the UEM |
| `vuln-scan` | Vulnerability scanning | Trivy MCP (container / IaC / misconfig / secret), Snyk MCP | ingests CVE and misconfiguration posture; decides on top; never replaces the scanner |
| `observability-integrity` | Observability / integrity | Grafana MCP (Prometheus / Loki / Tempo), Datadog MCP, Honeycomb MCP | ingests health and integrity posture; decides on top; never replaces the platform |
| `data-protection` | DLP / data protection | no widely-adopted dedicated MCP server known yet | gap: would ingest DLP posture if a source appears; never replaces the DLP |
| `peripheral-control` | Removable media / peripheral control | no widely-adopted dedicated MCP server known yet | gap: would ingest peripheral-control posture if a source appears |
| `carrier` | Carrier / connectivity | no widely-adopted dedicated MCP server known yet | gap: would ingest carrier/connectivity posture if a source appears |

<!-- MCP-ECOSYSTEM-MAP:END -->

## The rows, with their grounded detail

### Identity / SSO / IAM — `identity-risk`, `sso-session`, `platform-sso`, `passkey-assurance`, `oauth-consent`

- **Okta** ships an official MCP server (~20 tools at survey date) that elicits
  confirmation before destructive operations.
- **Auth0** ships an MCP server (~18 tools) with credential redaction and a
  device-authorization flow.
- **Keycloak** has an open-source, self-hosted MCP server. SignalGrid already drives
  Keycloak live in the lab — see [`docs/KEYCLOAK_LIVE_INTEGRATION.md`](../KEYCLOAK_LIVE_INTEGRATION.md)
  — so this row is the closest to a real wire, and still it is a *signal source*, not
  a decision authority.
- **Microsoft Entra ID** is reachable as an enterprise MCP SSO surface via
  agentgateway.
- **Casdoor** has a built-in MCP surface.

SignalGrid reads sign-in risk, live session binding, Platform SSO extension state,
passkey/authenticator assurance and OAuth-consent grants from these; the IdP still
owns authentication, SSO, MFA and directory policy.

### EDR / endpoint threat & posture — `edr-threat`, `macos-posture`, `device-attestation`

**CrowdStrike Falcon, SentinelOne Singularity, Microsoft Defender** and **Tanium**
are each reachable via MCP for status, logs, scan and containment; **Velociraptor**
has a DFIR MCP server (already on the Mac lane backlog). SignalGrid ingests the
resulting endpoint threat and hardening posture; the EDR still owns detection,
response and host telemetry. Hardware-rooted attestation (`device-attestation`) has
no dedicated attestation MCP server of its own — the attested facts arrive over the
same endpoint bridges — so it sits inside this category rather than as its own row.

### SIEM / log / telemetry — `siem`, `syslog`, `telemetry`

**Splunk**, **Microsoft Sentinel** (with Security Copilot and the data lake) and
**Elastic Security** expose correlated security signals over MCP. SignalGrid already
ships Splunk, Sentinel and webhook **emitters**, so the flow is bidirectional in the
ecosystem sense — it can both hand a decision to a SIEM and read a SIEM's signal —
while the SIEM keeps detection engineering, correlation and retention.

### ITSM — `itsm`

**ServiceNow** ships an official MCP server (incidents, changes, approvals, OAuth via
environment variables). **Jira** and a community **PagerDuty** MCP round out the
category. SignalGrid already ships Jira, BMC Helix and ManageEngine ticket emitters;
the ITSM still owns the service workflow and ticket lifecycle.

### Network / NAC — `nac`, `network-nac`

**Cisco Meraki** is reachable through the Meraki Magic MCP over the Meraki Dashboard
API; **RADIUS CoA** is the change-of-authorization path. SignalGrid already has live
RADIUS/NAC verification in the lab. The NAC still owns admission, segmentation and
enforcement — SignalGrid reads the posture and decides on top of it.

### Physical access / RTLS / custody — `rtls-custody`, `pacs-access`, `custody-beacon`

**Seam MCP** (`keithah/seam-mcp`) exposes smart locks and access codes across 100+
lock brands: list and get locks, create and update access codes, lock and unlock.
This is the door and custody signal SignalGrid is most differentiated on — it reads
whether the device is where it should be and who holds it, and decides on top; the
access system still opens the door.

### MDM / UEM / device management — `uem`, `device-management-health`

**Fleet** (open-source, osquery-based) is SignalGrid's chosen MDM and is already live
in the lab — see [`docs/FLEET_LIVE_INTEGRATION.md`](../FLEET_LIVE_INTEGRATION.md).
**Jamf**, **Intune** and **Kandji** are the broader UEM candidates, and **osquery**
has its own MCP. SignalGrid reads compliance, management and config-drift state; the
UEM still owns enrollment, policy and device actions.

### Vulnerability scanning — `vuln-scan`

**Trivy MCP** (listed on `mcpmarket.com/server/trivy`: container, IaC, misconfig and
secret scanning) and **Snyk MCP** expose vulnerability posture. SignalGrid already
compares Grype against Trivy in the lab (`docs/OPEN_SOURCE_LAB_REGISTRY.md`; `artifacts/scanner-comparison/2026-08-22-grype-vs-trivy.json`). The scanner
still owns discovery; SignalGrid reads the CVE/misconfig posture and decides on top.

### Observability / integrity — `observability-integrity`

**Grafana MCP** (Prometheus / Loki / Tempo), **Datadog MCP** (GA 2026) and
**Honeycomb MCP** expose health and integrity posture. SignalGrid reads it as a
confidence and freshness input; the platform still owns the metrics and traces.

## The gaps, stated plainly

Three externally-sourced families have **no** widely-adopted dedicated MCP server yet,
and the map says so rather than omitting them:

- **DLP / data protection** (`data-protection`).
- **Removable media / peripheral control** (`peripheral-control`).
- **Carrier / connectivity** (`carrier`).

If a source for any of these appears, it enters as a candidate signal source under the
same fixture-first, read-only, opt-in rule as every other row — never as a shipped or
partner integration on the strength of this map.

## What this map folds in rather than giving its own row

Some connector families read an external system too, but do not appear as their own
row because the map is indexed by *distinct external product category*, and these
read a category a row above already represents, or a category with no consumer MCP
ecosystem this survey found. They are named here so nothing is silently dropped, and
the machine check (`scripts/check-mcp-ecosystem-map.mjs`) records the reason for each:

- **Identity/authorization sub-dimensions over the same IdP/IGA/token infrastructure**
  the Identity / SSO / IAM row maps: `access-governance` and `entitlement-binding`
  (IGA/PAM — SailPoint/Saviynt-class, no dedicated governance MCP server surveyed),
  `token-binding` (RFC 9449/8705 token proof-of-possession — a protocol, not a product
  category), `agent-identity` (non-human/agent governance — emerging, no consumer MCP
  ecosystem), `agent-behavior` (UEBA), `oauth-consent`'s neighbour `credential-exposure`
  (endpoint secret exposure, adjacent to the vulnerability-scanning row), and `graph`
  (Microsoft Graph — it *is* the Entra ID infrastructure the identity row maps).
- **Physical/network sub-dimensions**: `location-services` (RTLS/location provider,
  folded into the physical-access row), `link-usability` (connectivity quality),
  `ot-posture` (OT/ICS edge gateway — a distinct plane the enterprise-security map
  keeps out of consumer-IT scope, no widely-adopted OT MCP surveyed), and `sse-egress`
  (SASE — out of scope in the coverage map, no adopted SASE MCP surveyed).
- **Control / workflow / assurance planes** rather than signal-source products:
  `app-update`, `change-window`, `shift-context`, `task-exception`, `break-glass`,
  `challenge-capability`, `benchmark-selection`, `credential-rotation`,
  `bootstrap-credential`, `service-lifecycle`, `session-readiness`, `local-authority`,
  `policy-binding`, `response-accountability`.
- **Outbound formatters** that name no external product category: `caep-events`
  (CAEP/Shared-Signals) and `webhooks` (generic signed HTTPS).

## Boundary

This is a fixture-first ecosystem map. It adds no code, no dependency, no connector
family, and no proof. It names no partnership, certification, or endorsement, and it
does not assert that any wire is served. The deterministic decision core stays
offline and fixture-backed; an MCP server becomes a real signal source only behind an
explicit, owner-approved opt-in, and even then it is a source SignalGrid decides on
top of — never a system SignalGrid replaces.
