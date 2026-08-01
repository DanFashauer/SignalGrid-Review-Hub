# Zero-Cost Live-Test Matrix

This is the map of how to test SignalGrid against REAL external systems without paying. It complements — and deliberately does not duplicate — the deterministic fixture surface documented in [Cloud Connector Emulator Harness](CLOUD_CONNECTOR_EMULATOR_HARNESS.md) and the system inventory in [Integration Catalog](INTEGRATION_CATALOG.md): those cover what the fixtures prove; this covers what live systems can prove for $0.

Conventions used throughout, non-negotiable:

- Every external claim carries its confidence marker inline: **[verified July 2026]** with a source link, or **[unverified — confirm before relying]**. Verification dates are from the July 2026 research pass; re-verify anything older than a quarter.
- A free **trial** is never written as "free". Free **tiers** get their limits stated (user counts, quotas, expiry, non-production clauses).
- Vendor names are candidates only. Nothing here implies a partnership, endorsement, or certification by any vendor.
- "Owner action" means an account signup, legal-entity verification, or purchase only the repository owner can perform — consolidated in section 10 so nothing hides.

## 1. What is already free, already built, and already running

| Layer | Mechanism | What it verifies | Cost |
| --- | --- | --- | --- |
| Every decision dimension | 82 deterministic proof scripts (`pnpm run proof:*`), grant-safety enumeration (millions of raw states), mutation guard (500 mutations, 460 killed, 40 documented-inert, 0 survivors), figure/registry/count drift guards | The decision logic itself, adversarially | $0, every commit |
| Cloud connectors | Connector-emulator harness (`proof:connector-emulator`, scenario packs) | Connector normalize/evaluate against emulated vendor responses incl. malformed/hostile | $0 |
| REAL hardware posture | The signalgrid-mcp Mac lane: `verify:all` on the owner's Mac collects genuine macOS posture (encryption, screen lock, system extensions, USB inventory) and runs it through the real fabric verdict ([RUN_ON_MAC.md](RUN_ON_MAC.md)) | Live end-to-end on real hardware the owner already owns | $0 |
| API surface | API integration test (boots the real server; a route-coverage check proves all 33 registered /v1 routes are exercised, and the test itself verifies that this very number still matches the server), OpenAPI contract check, Postman collection kept in sync | The wire contract | $0 |
| Persistence | Postgres audit-ledger + decision-store proofs (Dockerized) | Durability + tamper-evidence on a real database | $0 |
| Prod shape | Docker compose smoke in CI | The deployable stack boots | $0 |
| Supply chain | CodeQL, gitleaks, Dependabot, CycloneDX SBOM, release-age policy on new deps | The repo itself | $0 (public repo) |
| Browser surfaces | NEW: Playwright E2E (`pnpm run test:e2e`) — 35 tests, ~126 content-bearing assertions across the review console, public website, admin console, desktop client, and mobile PWA (admin, desktop, and PWA wired to a live api-server); ~38s wall clock including all six app builds. The suite shipped with one deliberately-red test that PROVED a real product gap: the review console never surfaced the Battery health row even though the core correctly returned `restrict`/`BATTERY_FAILING` — the console's scenario list had no failing-battery entry. The one-line scenario fix landed in that same change, taking the suite to 15/15 **as it stood then** (it has since grown to the 35 tests counted above). That red-first test is the pattern to keep: E2E asserts what a human sees, not what the core knows. | What a human actually sees renders and says the right thing | $0 |
| Real cryptography | NEW: live-idp-proof (`pnpm run proof:live-idp`) — 31/31 checks against a real in-process `oidc-provider`, through lib/enterprise-auth's production verifier: real JWKS fetch, real RS256 signatures, real expiry, wrong-aud/wrong-iss rejection, HS256 algorithm-confusion and `alg:none` rejection, and a real DPoP-bound token whose `cnf.jkt` matches the RFC 7638 thumbprint of the held key. ~3s, fully offline. | Auth layer against real crypto, not fixtures | $0 |

**Running the live lanes: `pnpm run verify:live`.** Four proofs read real vendor
software rather than fixtures (Fleet, Traccar, Keycloak, Wazuh). Each refuses without
its server and is skipped BY NAME, which is correct but had left the live evidence
effectively unreachable — the bring-up steps lived in four separate documents. That
one command stands up whatever Docker allows, runs those lanes, removes what it
started (`--keep` to leave them), and reports a lane it could not provision as
SKIPPED with the reason rather than counting it as passed. `--only fleet,keycloak`
narrows it. Wazuh is never auto-started (~2GB image); it runs only if WAZUH_URL is
already set.

Everything below extends this base outward to external systems.

### Dimension → first live lane (quick index)

| Repo dimension / surface | First zero-cost live lane | Section |
| --- | --- | --- |
| lib/webauthn | Chromium CDP virtual authenticator | 2 |
| lib/enterprise-auth | live-idp-proof (built); then Keycloak / Okta / Entra tenants | 1, 2 |
| token-binding connector | live-idp-proof (built); Keycloak 26.4 as a SECOND independent issuer — **DONE**, `proof:live-keycloak` | 1, 2 |
| identity-risk connector | Entra P2 trial only — no permanent free path | 2, 10 |
| graph posture + device-management-health | Dev Proxy wire simulation; then the one Intune trial window | 3 |
| lib/pim-activation | P2/Governance trial window only | 3, 10 |
| macos-posture connector | signalgrid-mcp Mac lane (running) | 1, 4 |
| lib/ddm-connector | NanoMDM + KMFDDM rig, after ABM lands | 4 |
| Android managed/kiosk custody | AMAPI Colab + Test DPC on an emulator | 5 |
| telemetry/fleetdm.ts | ~~Fleet Free + osquery, zero shim~~ **DONE** — `proof:live-fleet`; "zero shim" was false | 6 |
| edr-threat connector | Wazuh (perpetual); CrowdStrike 15-day trial for vendor vocabulary | 6 |
| siem/splunk.ts, siem/sentinel.ts | Splunk trial → perpetual Free license; Sentinel 31-day trial | 6 |
| network-nac connector | FreeRADIUS in Docker | 7 |
| link-usability connector | netns + dnsmasq ladder; hwsim for 802.11; Meraki sandbox for vendor cloud | 7 |
| carrier-reachability | transport-half only; real session data needs a SIM | 7, 10 |
| pacs-access connector | Seam sandbox (simulated Brivo) | 8 |
| rtls-custody connector | Traccar covers location-services only (**DONE**); indoor RTLS still unmet | 8 |
| DockBridge charge/battery | app_in_dock script on owner's Mac/phone; dock/tamper/badge-binding stay emulator-only | 8, 10 |
| Five web artifact UIs + api-server | Playwright E2E suite (running) | 1, 9 |
| native/ios EnterpriseShell | Xcode Simulator + XCTest (**DONE** — 57/57); Maestro still REQUIRED for any visual E2E, see section 9 | 9 |

## 2. Identity / SSO / FIDO2-WebAuthn

**Do this first:** Playwright + Chromium's CDP WebAuthn virtual authenticator over a thin RP harness on lib/webauthn — it converts the repo's strongest fixture proof (`scripts/src/webauthn-verify-proof.ts`) into evidence against real browser-generated CTAP2 credentials, including the positive fido-u2f x5c attestation path the fixture file documents as out of scope. Then Keycloak in Docker: three env vars (`OIDC_ISSUER`/`OIDC_AUDIENCE`/`OIDC_JWKS_URI`, exactly as `lib/enterprise-auth/src/config.ts` documents) light up the whole pipeline against a live JWKS, and Keycloak 26.4's DPoP support is a SECOND zero-cost way to mint a genuinely sender-constrained token for the token-binding connector — `live-idp-proof` (section 1) already does this against an in-process `oidc-provider`, so Keycloak's value here is cross-implementation agreement, not first coverage.

| Option | Exercises | Cost | Effort | Confidence |
| --- | --- | --- | --- | --- |
| Playwright CDP virtual authenticator | lib/webauthn verify paths, UV flag, sign-counter, fido-u2f x5c | free | minutes | **[verified July 2026](https://www.corbado.com/blog/passkeys-e2e-playwright-testing-webauthn-virtual-authenticator)** |
| Keycloak self-hosted (Docker) | lib/enterprise-auth full pipeline; token-binding via DPoP; sso-session bridge | free (OSS) | minutes | **[verified July 2026](https://www.keycloak.org/2025/10/dpop-support-26-4)** |
| Okta Integrator Free Plan | enterprise-auth vs a hosted commercial IdP; sso-session + oauth-consent bridges | free tier: 10 users, 100 auth/min, non-production terms | minutes | **[verified July 2026](https://developer.okta.com/blog/2025/05/13/okta-developer-edition-changes)** |
| Microsoft Entra ID free tenant | enterprise-auth against its documented target IdP; oauth-consent via Graph | free tier (no P1/P2 features) | minutes | **[verified July 2026](https://learn.microsoft.com/en-us/graph/tutorial-riskdetection-api)** |
| Entra ID P2 trial + risk simulation | identity-risk connector against a real risk engine (the only no-purchase path) | free trial, ~30 days, then paid | hours | **[verified July 2026](https://learn.microsoft.com/en-us/entra/id-protection/how-to-deploy-identity-protection)** |

Also considered: Auth0 free tier (25,000 MAU; no DPoP, so no token-binding value) **[verified July 2026](https://comparetiers.com/tools/auth0)**; Authentik self-hosted (MIT core; realistically redundant with Keycloak) **[verified July 2026](https://github.com/goauthentik/authentik)**; Duo Free (10 users forever, but no Admin API on the free tier, so almost nothing for a bridge to read — weakest fit here) **[verified July 2026](https://duo.com/docs/adminapi)**.

Caveats that will burn you:

- Playwright cannot configure virtual authenticators in WebKit (open issue microsoft/playwright#26621) — Safari/platform-authenticator behavior stays untested. The emulator also never produces a genuine hardware AAGUID or FIDO-MDS-listed cert: "is this a real YubiKey" needs hardware.
- Okta Integrator Free orgs deactivate after 180 days of inactivity; the old Developer Edition orgs were already deactivated in July 2025 — every older tutorial is stale. Okta's sign-in-risk engine (Identity Threat Protection) is a paid add-on: identity-risk is NOT exercisable there.
- identity-risk needs an Entra P2 trial — it is a trial with a ~30-day clock, and risk detections can take minutes-to-hours to materialize after simulation; offline detections (leaked credentials) cannot be triggered on demand. Write the Graph transport adapter and the simulation playbook BEFORE starting the clock.
- Graph paginates with `@odata.nextLink` while the connectors expect `nextPageToken` — a ~20-line injectable-transport adapter bridges it, but pagination is then exercised through translation. Exact Okta sessions/grants endpoint shapes are **[unverified — confirm before relying]**, as is free-tier readability of `oauth2PermissionGrants` via Graph.
- The sso-session and token-binding connectors consume already-evaluated bridge reports: a ~50-line bridge translating Keycloak/Okta API responses into the report shapes is new glue code, not an existing repo surface. Keycloak mTLS-bound tokens ("mtls" binding) need cert plumbing that is meaningfully more setup than DPoP.

## 3. Microsoft Graph / Intune / Entra management plane

**Do this first:** Dev Proxy — genuinely free and permanent, and it maps one-to-one onto the repo's injected-transport design: the Graph connector issues real HTTPS requests while Dev Proxy injects Graph-authentic 429/`Retry-After`, 5xx, and paging behavior, exercising exactly the error-mapping, pagination-cap, and fail-closed paths the mocks assert but have never seen over a real wire. Pair with Graph Explorer's no-login sample tenant to harvest authentic payloads as fixture-drift checks.

| Option | Exercises | Cost | Effort | Confidence |
| --- | --- | --- | --- | --- |
| Dev Proxy (Graph error/paging simulation) | graph posture-connector + device-management-health wire handling | free | minutes | **[verified July 2026](https://learn.microsoft.com/en-us/microsoft-cloud/dev/dev-proxy/how-to/simulate-errors-microsoft-graph-apis)** |
| Graph Explorer sample tenant (no sign-in) | fixture fidelity of graph normalizers vs real payload shapes | free | none | **[verified July 2026](https://developer.microsoft.com/en-us/graph/graph-explorer)** |
| Free Entra tenant as real-IdP crypto source | enterprise-auth vs live login.microsoftonline.com JWKS; real 403s exercise `auth_failed` | free tier, but the 2026 tenant-signup path has tightened | minutes | **[unverified — confirm before relying]** (signup door: Microsoft restricts new workforce tenants from free accounts; Azure free account wants a credit card for identity verification) |
| Intune free trial (EMS bundle, 25 licenses) | live `/deviceManagement/managedDevices`, real `lastSyncDateTime`/`complianceState` with one throwaway enrolled device | free trial, 30 days, then paid | hours | **[verified July 2026](https://learn.microsoft.com/en-us/intune/fundamentals/free-trial-sign-up)** |
| Entra PIM (pim-activation) | the fail-open/fail-closed question in [PIM_ACTIVATION_LIVE_RUNBOOK.md](PIM_ACTIVATION_LIVE_RUNBOOK.md) | P2/Governance license required — trial window only, no permanent free path | owner action | **[verified July 2026](https://learn.microsoft.com/en-us/entra/id-governance/licensing-fundamentals)** |

Also considered: the Microsoft 365 Developer Program E5 sandbox — the once-free full-stack jackpot is closed to the general public since ~Jan 2024, gated on an active Visual Studio Professional/Enterprise STANDARD subscription (itself ~$1,199 first year) or partner-program enrollment **[verified July 2026](https://learn.microsoft.com/en-us/office/developer-program/join-with-visual-studio)**. Do not budget around it without confirming eligibility.

Caveats that will burn you:

- Dev Proxy is a high-fidelity simulator, not a tenant: it proves wire/error handling, never that normalizers match your tenant's data. It needs its local root CA trusted and proxy env vars set — inside this repo's sandboxed agent environment that collides with the pre-configured agent proxy, so run it on the owner's machine.
- The Intune trial is a hard 30-day clock: treat it as a planned one-shot proof window. Enroll only disposable devices/VMs — MDM enrollment of a daily-driver has wipe/policy implications. Confirm at signup whether the trial SKU carries P2 (EMS E5) or only P1 (EMS E3): that decides whether PIM testing stacks into the same window.
- Run the PIM runbook (including deliberately killing the decision endpoint to record fail-open vs fail-closed) inside the same licensed window; the custom-extension surface is Graph beta/preview per the repo's own runbook, so reconcile `lib/pim-activation/src/types.ts` against Microsoft's current schema as step zero.
- The Graph Explorer demo tenant is GET-only and does not serve Intune fleet data on many management endpoints (the errors are themselves useful for the 403 path) — verify per-endpoint.

## 4. Apple device management

**Do this first:** keep exercising the signalgrid-mcp Mac lane ([RUN_ON_MAC.md](RUN_ON_MAC.md)) — it already collects real posture from real hardware at $0. In parallel, build the NanoMDM + KMFDDM rig now (free OSS; server, DB, enrollment profile, declarations authored against the `apple/device-management` v26.4 items the repo pins) and enroll a UTM macOS VM the moment the owner's ABM enrollment yields a push certificate. That combination is the only zero-cost path that speaks the REAL Apple MDM + DDM protocol end-to-end into lib/ddm-connector's pinned status items.

| Option | Exercises | Cost | Effort | Confidence |
| --- | --- | --- | --- | --- |
| signalgrid-mcp Mac lane (existing) | macos-posture connector, posture-report contract, real verdicts | free | none | [verified in-repo] |
| NanoMDM / MicroMDM self-hosted | real Apple MDM check-ins; device-management-health MDM channel | free (OSS), but gated on an APNs MDM push certificate | hours | **[verified July 2026](https://github.com/micromdm/nanomdm)** |
| KMFDDM on NanoMDM | live DDM status items — the exact five `lib/ddm-connector/src/apple-schema.ts` pins | free (OSS) | hours | **[verified July 2026](https://github.com/jessepeterson/kmfddm)** |
| UTM macOS VM as disposable managed device | destructive posture scenarios (FileVault off, stale check-ins) without touching the daily driver | free (OSS) | hours | **[verified July 2026]** (ADE-in-VM limitation per Microsoft's Intune docs; link not captured — re-verify) |
| Apple Business Manager enrollment | enrollment provenance; unlocks push cert + ADE | free, owner action, days-long verification | owner action | **[verified July 2026]** (US signups use a Federal Taxpayer ID since April 2026, per Apple Support + Der Flounder; link not captured — re-verify) |

Also considered: Apple Configurator (free apps; installs profiles and adds owned devices to ABM, but is not an MDM server — no check-ins, no DDM channel) **[unverified — confirm before relying]**; iOS Simulator (free with Xcode; app lane ONLY — it has no MDM client, so a green Simulator run is never device-management evidence) **[unverified — confirm before relying]**.

Caveats that will burn you:

- The push certificate is the honest bottleneck: mdmcert.download issues free certs only to legally recognized organizations, and 2026 reporting suggests issuance is now ABM-tied — sequence the rig AFTER ABM enrollment lands, and verify the current issuance path at identity.apple.com then **[unverified — confirm before relying]**.
- Automated Device Enrollment categorically does not work in VMs: ADE validates the serial against ABM and Apple Silicon VMs cannot present an ABM-registered serial. Zero-touch testing needs a physical Apple device whose serial is in ABM.
- KMFDDM self-describes as experimental R&D software — fine as a test rig, not a product dependency. macOS guests: max 2 concurrent VMs, Apple Silicon hosts only; some VM builds lack a Secure Enclave, so Managed Device Attestation needs real hardware.
- Apple Configurator's add-existing-devices-to-ABM flow WIPES the device during the add — plan it for devices you can afford to erase.
- The $99/yr Developer Program is NOT needed for any of the above — see section 10 for what it actually gates.

## 5. Android + rugged handhelds

**Do this first:** Android Management API via Google's free Colab quickstart against an Android Studio emulator — the only zero-cost option with a REAL production EMM control plane (no trial clock, no hardware). The kiosk codelab provisions a dedicated device exactly like a warehouse shared handheld, and `devices.get` returns genuine `policyCompliant`/`lastPolicySyncTime`/`nonComplianceDetails` payloads for the device-management-health dimension. Layer Zebra's DataWedge intent simulation on the same emulator to fire real scan-intent custody events through the warehouse scenario pack.

| Option | Exercises | Cost | Effort | Confidence |
| --- | --- | --- | --- | --- |
| Android Management API (Colab quickstart + kiosk codelab) | device-management-health vs real Google EMM payloads; dedicated-device custody | free (needs a Google Cloud project; API itself no-charge) | minutes | **[verified July 2026](https://developers.google.com/android/management/quickstart)** |
| Test DPC as device owner on an emulator | device-side managed behavior: lock-task/kiosk, work profile, forced teardown | free | minutes | **[verified July 2026](https://github.com/googlesamples/android-testdpc)** |
| Zebra DataWedge intent simulation on a stock emulator | scan-driven custody events with the exact intent contract a real TC5x/MC9xxx emits | free | minutes | **[verified July 2026](https://developer.zebra.com/blog/test-your-zebra-scanning-application-emulator)** |
| Headwind MDM Community Edition (self-hosted) | a fully self-owned MDM with a REST API as a live check-in source | free (Apache 2.0 core; open-core) | hours | **[verified July 2026](https://github.com/h-mdm/hmdm-server)** |
| Samsung Remote Test Lab | the mobile PWA + OIDC login on real Galaxy hardware | free tier: 20 credits/day, 1 credit = 15 min | minutes | **[verified July 2026](https://developer.samsung.com/remote-test-lab)** |

Also considered: Firebase Test Lab Spark tier (10 virtual + 5 physical runs/day; consumer hardware only, no rugged devices) **[verified July 2026](https://firebase.google.com/docs/test-lab/usage-quotas-pricing)**; Honeywell Mobility SDK / Datalogic SDK free downloads for multi-vendor intent-contract testing **[unverified — confirm before relying]**.

Caveats that will burn you:

- The repo has no AMAPI adapter (uem/ has intune/jamf/workspace-one only) — capture live payloads into fixtures or write a thin read-only adapter; Test DPC is local policy only, with no server-side compliance API, so it proves device behavior, not connector ingest.
- Nothing free emulates the scan engine, MX layer, or StageNow staging: Zebra confirms EMDK value-adds cannot be emulated, and no free public Zebra/Honeywell/Datalogic device cloud was found in 2026 searches. Free demo/dev kits exist only inside Zebra's PartnerConnect ISV program (business registration, owner action) **[unverified — confirm before relying]** on exact eligibility.
- Knox Manage trials are no longer self-serve — contact-sales, ~3 months/30 devices: a trial, not free **[verified July 2026](https://www.samsungknox.com/en/blog/notice-on-knox-manage-trial-policy-update)**. Samsung RTL units restrict device-owner provisioning and factory-reset flows, so MDM enrollment is not testable there.

## 6. EDR / SIEM / DEX / operational health

**DONE — and it repaid the effort by proving this entry wrong.** This section used to
say `telemetry/fleetdm.ts` "is written against Fleet's exact API paths, so it needs
zero shim code." A real Fleet 4.89.2 says otherwise: **every host- and policy-level
route in that adapter 404'd**, the host response is an envelope the code cast away,
and a live query returns a websocket campaign rather than the results array the code
read. See `proof:live-fleet` (30 assertions) and
[FLEET_LIVE_INTEGRATION.md](FLEET_LIVE_INTEGRATION.md) for the measured table.

That is the whole argument for this matrix in one lane: the "zero shim" claim was
sincere, plausible, and false, and only a live server could tell us. Fixtures written
from the same assumptions as the code agree with the code by construction.

| Option | Exercises | Cost | Effort | Confidence |
| --- | --- | --- | --- | --- |
| Fleet Free + osquery (self-hosted) | telemetry/fleetdm.ts — hosts, policies, fail-closed logic. NOT verbatim: four routes were wrong and are now fixed + pinned by `proof:live-fleet` | free (OSS self-hosted; some vuln/MDM features are paid) | hours | **[verified July 2026](https://fleetdm.com/pricing)** |
| Wazuh (self-hosted OSS SIEM/XDR) | edr-threat connector with real agents/alerts via a ~30-line transport adapter | free (GPL/Apache OSS) | hours | **[verified July 2026](https://wazuh.com/platform/overview/)** |
| Elastic Security, self-managed Basic | siem/webhook.ts push + edr-threat read via Elastic Defend alerts | free (self-managed Basic only) | hours | **[verified July 2026](https://www.elastic.co/subscriptions)** |
| Splunk Enterprise trial → perpetual Free license | siem/splunk.ts exactly as written (real HEC) | free trial 60 days, then a perpetual Free license capped at 500MB/day with features disabled | minutes | **[verified July 2026](https://www.splunk.com/en_us/download/splunk-enterprise.html)** |
| Microsoft Sentinel trial workspace | siem/sentinel.ts end-to-end vs a real Log Analytics workspace | free trial, 31 days (10 GB/day waived), then billed; Azure signup wants a credit card | hours | **[verified July 2026](https://learn.microsoft.com/en-us/azure/sentinel/billing)** |

Also considered: Datadog free tier (5 hosts, 1-day retention; excludes logs, APM, and all security products — DEX prototyping only) **[verified July 2026](https://costbench.com/software/observability/datadog/free-plan/)**; CrowdStrike Falcon 15-day free trial as a one-shot scripted evidence run **[verified July 2026](https://www.crowdstrike.com/en-us/free-trial-guide/)**; Microsoft Defender for Endpoint trial for mde.ts **[unverified — confirm before relying]** (trial terms change frequently); SentinelOne — no self-service trial exists; list it honestly as "no zero-cost path".

Caveats that will burn you:

- Only Elastic's SELF-MANAGED Basic is perpetually free — Elastic Cloud is a 14-day free trial. Same trap with Splunk Cloud (14-day trial) vs the on-prem Free license.
- The post-trial Splunk Free license disables authentication and alerting; whether HEC remains usable past day 60 is **[unverified — confirm before relying]**.
- A Sentinel live run will likely surface that `siem/sentinel.ts` targets the legacy HTTP Data Collector API, which Microsoft has deprecated in favor of the Logs Ingestion API + DCRs, with retirement reportedly in 2026 — valuable signal, but verify the retirement date first. Tear the workspace down at day 31 or billing starts silently.
- The commercial DEX platforms named in [OPERATIONAL_HEALTH_DEX_LAYER_STRATEGY.md](OPERATIONAL_HEALTH_DEX_LAYER_STRATEGY.md) (Nexthink, ControlUp, Aternity, SysTrack, Tanium) have no self-service free tiers at all — the DEX dimension is only live-testable via proxies like Fleet and Datadog free.
- Practicalities: Fleet live queries need an online enrolled host at test time; the single-node Wazuh stack wants ~4-8GB RAM; the edr-threat connector expects Graph-flavored `{value, nextPageToken}` collections while Wazuh returns `{data: {affected_items}}` — the injectable transport makes that a ~30-line adapter, but it is adapter work, not plug-and-play.

## 7. Network / NAC / Wi-Fi link health

**Do this first:** the fully-local pair — FreeRADIUS in Docker (real 802.1X Access-Accept/Reject driving network-nac's `normalizeAuthState`) plus a Linux netns + dnsmasq failure ladder (real DHCP/DNS failures driving link-usability's `dhcp_failing`/`dns_failing`/`carrying_traffic` rungs). Free forever, no account, no hardware, and CI-able: netns creation was proven by direct execution in the repo's own CI-class container during the July 2026 research pass.

| Option | Exercises | Cost | Effort | Confidence |
| --- | --- | --- | --- | --- |
| FreeRADIUS in Docker + EAP clients | network-nac listSessions/normalizeAuthState with genuine RADIUS outcomes | free (OSS) | hours | **[verified July 2026](https://hub.docker.com/r/freeradius/freeradius-server)** |
| netns + dnsmasq failure ladder | link-usability LinkProgress rungs from kernel-real failures | free | hours | **[verified July 2026](https://thekelleys.org.uk/dnsmasq/doc.html)** (plus direct in-session execution) |
| mac80211_hwsim + hostapd virtual Wi-Fi | real 802.11 association/roams; roamCapability/roamHealth; chains to FreeRADIUS for full NAC+link | free | hours | **[unverified — confirm before relying]** (needs a real Linux VM or GH Actions VM runner; not loadable in ordinary containers) |
| Cisco DevNet Meraki Always-On sandbox | link-usability transport vs the live Meraki Dashboard API's per-rung connection stats | free, owner DevNet login required | owner action | **[verified July 2026](https://developer.cisco.com/docs/sandbox/)** |
| Self-hosted UniFi Network Server (Docker) | controller API auth/protocol handling (cookie+CSRF, stat endpoints) | free to run (proprietary freeware; MongoDB sidecar) | hours | **[verified July 2026](https://hub.docker.com/r/linuxserver/unifi-network-application)** |

Also considered: DevNet reservable Meraki-Enterprise/ISE sandboxes for the `nac/cisco-ise.ts` adapter (VPN-gated, time-boxed, inventory **[unverified — confirm before relying]**); carrier/IoT developer signups (KORE/Twilio-Super-SIM class) exercise only the carrier-reachability transport half — with no SIM, `sessionState`/`lastConnectedAt` never populate **[unverified — confirm before relying]**.

Caveats that will burn you:

- The widely published shared Meraki sandbox API key is REVOKED — api.meraki.com returns 401 for it (tested live, July 2026). Every tutorial-copied credential path is dead; fresh sandbox credentials require the owner's free DevNet login.
- demo.ui.com is gone — it 301-redirects to ui.com (tested live, July 2026). The self-hosted controller is the honest substitute, but it is protocol-real/data-empty: with zero adopted APs, `stat/sta` is an empty list.
- `eapol_test` is not packaged in Ubuntu 24.04 — build it from wpa_supplicant source, or start with the bundled radtest/radclient for PAP/CHAP smoke tests. FreeRADIUS speaks RADIUS, not the Cisco ISE ERS or ClearPass REST APIs, so the vendor adapters stay fixture-proven.
- hwsim approximates roam refusal but there is no real RF fading — the `sticky` roamHealth pathology as it occurs on a warehouse floor ultimately needs real APs and a moving client.

## 8. PACS / RTLS / custody hardware (the thin category)

Blunt up front: this is the thinnest category for free live testing because the signal IS the hardware. `dock_state` bay occupancy, `tamper_state`, `badge_binding`, and physical checkout/return transitions remain emulator-only (fixtures + `docker-compose.sim.yml`) until an owner buys or borrows a rig — nothing on the free internet emits those signals. See [API_SIGNAL_DISCOVERY.md](API_SIGNAL_DISCOVERY.md) and [HARDWARE_PARTNER_MATRIX.md](HARDWARE_PARTNER_MATRIX.md).

**Do this first:** Seam's sandbox workspace with its simulated Brivo Access system — the only option here that is live and self-serve (no sales email, no approval queue, no shipped hardware). It emits PACS-shaped access events from a real authenticated cloud API, exercising exactly what fixtures cannot: the pacs-access connector's injectable transport against real HTTP auth, pagination, rate limits, and failure modes. Pair it in the same session with Traccar + the owner's phone for rtls-custody.

| Option | Exercises | Cost | Effort | Confidence |
| --- | --- | --- | --- | --- |
| Seam sandbox (simulated Brivo Access) | pacs-access live-bridge transport: auth, pagination, 401/429/5xx | free tier: up to 3 devices, sandbox workspaces | minutes | **[verified July 2026](https://docs.seam.co/latest/device-and-system-integration-guides/brivo-access/brivo-access-sample-data)** |
| Brivo official developer sandbox | raw first-party Brivo semantics (25,000 calls/mo, 25/sec) | free if approved — human-reviewed request via email | owner action | **[verified July 2026](https://apidocs.brivo.com/)** |
| Traccar self-hosted + phone client | **DONE for location-services** (`proof:live-location`, 22 assertions — see [TRACCAR_LIVE_INTEGRATION.md](TRACCAR_LIVE_INTEGRATION.md)): real geofence membership, fix-age, precise-coordinate flagging. rtls-custody remains uncovered — Traccar is outdoor GPS, not indoor RTLS | free (Apache 2.0) | hours | **[verified July 2026](https://www.traccar.org/)** |
| libosdp software CP↔PD loop | badge-read protocol layer (IEC 60839-11-5 OSDP), secure-channel failure, reader-offline | free (OSS) | hours | **[verified July 2026](https://github.com/goToMain/libosdp)** |
| app_in_dock battery telemetry on the owner's Mac/phone | DockBridge `charge_state`/`battery_health` from real hardware (real BATTERY_CRITICAL that clears on plug-in) | free | hours | [verified in-repo] |

Also considered: HID Origo trial subscription (credential lifecycle only — no door events without readers; trial terms **[unverified — confirm before relying]**); public MQTT brokers + phone BLE beacon apps (hardens YOUR bridge code, tests no real RTLS product; **[unverified — confirm before relying]**); Proxmark3/Flipper Zero badge emulation (paid hardware, and useless until a real reader rig exists — a Flipper emulating into empty air tests nothing).

Caveats that will burn you:

- Seam is Seam's simulation of Brivo, not Brivo's cloud — semantics are Seam-normalized, and exact event coverage (door forced/held, anti-passback) is unconfirmed, so `doorState`/anti-passback enums may stay fixture-proven.
- The Brivo sandbox is free-if-approved, not self-serve: register, then email their API team with the integration purpose; the grant is discretionary and may become a sales conversation. Do not plan a milestone around it.
- Traccar is outdoor GPS, not indoor RTLS: no room/unit zones, no `badgeAssociated`, and dwell must be computed in your adapter. Kontakt.io has no hardware-free tier — Kio Cloud accounts exist to claim shipped hardware orders **[verified July 2026]** (source link not captured in the research log — re-verify at Kontakt.io's portal).
- The dock/kiosk/locker aisle (Beam Mobile, LocknCharge, ARC kiosks, Traka/Vecos) has no public sandboxes of any kind, consistent with [HARDWARE_PARTNER_MATRIX.md](HARDWARE_PARTNER_MATRIX.md).

## 9. Cross-platform app testing

**Do this first:** nothing — the Playwright E2E layer landed in this change (section 1) and covers the web artifacts, admin+api full-stack path, and the real-crypto OIDC lane. The next marginal wins: a Lighthouse installability audit of the mobile PWA (guaranteed real finding: `public/manifest.json` declares icons that do not exist and no service worker is registered anywhere), then the owner's-Mac lane for native/ios.

| Option | Exercises | Cost | Effort | Confidence |
| --- | --- | --- | --- | --- |
| Playwright E2E suite (landed) | review console, website, admin console, desktop client, mobile PWA + live api-server | free | done | [verified in-repo] |
| Lighthouse PWA installability audit | signalgrid-mobile-pwa manifest/service-worker gaps | free (OSS) | minutes | **[unverified — confirm before relying]** (OSS status stable but not re-verified) |
| Xcode Simulator + XCTest for native/ios EnterpriseShell | session state machine, OIDC flow, Keychain, teardown — `project.yml` is already unsigned-simulator-ready | free (no paid Apple account for Simulator) | owner's Mac | **[VERIFIED 2026-07-31 on this Mac]** — `xcodegen generate` + `xcodebuild` on Xcode 26.6/iPhone 17 sim: **BUILD SUCCEEDED, 57 tests, 0 failures**, including all 10 `SignalContextTests` (allow / step-up on stale / restrict on non-compliant, screen-capture and security-risk / deny on zone mismatch WITHOUT calling the service / deny on unknown zone / unobserved posture fails closed). Needs `brew install xcodegen`. |
| Maestro CLI (YAML flows) | badge-in → workspace → teardown journeys in Simulator + web mode | free (Apache-2.0 CLI/Studio; Maestro Cloud is paid, ~$250/device/mo, 7-day trial only) | owner's Mac | **[verified July 2026](https://maestro.dev/pricing)** |
| Appium (OSS) | the only free path to REAL iOS Safari (Simulator) for the PWA; XCUITest driver alternative | free (Apache-2.0) | owner's Mac, hours | **[unverified — confirm before relying]** |

Also considered: signalgrid-desktop is a Vite web app with no Electron/Tauri shell yet — Playwright desktop-viewport coverage is FULL coverage of everything that exists; any "we E2E-test the desktop app" claim beyond browser behavior would be overstated **[verified July 2026](https://www.electronjs.org/docs/latest/tutorial/automated-testing)**. BrowserStack: no permanent general free plan — the free trial is minutes-capped (30 min Live / 60 min Automate) and exhausts in one afternoon; unlimited access requires a discretionary Open Source Program approval **[verified July 2026](https://www.browserstack.com/open-source)**. Firebase Test Lab Spark tier (10 virtual + 5 physical runs/day) runs app binaries, not web tests — marginal until an Android app exists **[verified July 2026](https://firebase.google.com/docs/test-lab/usage-quotas-pricing)**.

Caveats that will burn you:

- Playwright's WebKit build is NOT real iOS Safari — no add-to-home-screen, no iOS quirks. Real iOS Safari means Appium driving Simulator Safari, or a real iPhone over LAN.
- The Simulator cannot exercise the External Accessory badge-reader path, supervised-device/MDM behaviors, or push. Free-Apple-ID installs on a physical iPhone expire every 7 days.
- Maestro flows assert on visible UI, not internal state — pair with the repo's proof gates for logic coverage.
- **Maestro is not optional for the visual E2E, and here is why (measured 2026-07-31).** On a
  Simulator the app is reachable and authenticates, but ASAM (Autonomous Single App Mode)
  release ALWAYS fails — the Simulator has no MDM client and no supervision — so
  `ActiveSessionViewController` receives `.kioskReleaseFailed` and raises a modal
  ("Device still locked … MDM supervision may need to re-apply the release"). That is the
  correct fail-closed behaviour: the code comments say it surfaces recovery guidance rather
  than "rendering the normal workspace as if the device had opened", and the alert appearing
  is itself evidence the refused-release path works. But it lands at launch and blocks the
  `-DemoAssist` host-app from auto-presenting, and `simctl` cannot tap. So a per-verdict
  screenshot run needs a tap-capable driver (Maestro/XCUITest) or a genuinely supervised
  device — it cannot be done with `simctl launch` + `simctl io screenshot` alone.
  The DECISION logic needs neither: the 10 `SignalContextTests` above already assert every
  verdict in that matrix, including the zone-mismatch deny.
  Note when installing: `brew install --cask maestro` is a DIFFERENT product
  (runmaestro.ai, an AI agent console). The mobile UI framework is mobile-dev-inc's.

## 10. The owner-only boundary

Everything that genuinely requires payment, hardware, or an owner account action — consolidated so nothing hides:

| Blocked item | Why it is blocked | Unblocks |
| --- | --- | --- |
| Apple Business Manager enrollment | Legal-entity signup (US: Federal Taxpayer ID since April 2026), days-long Apple verification; no sandbox ABM exists | MDM push certificate → NanoMDM/KMFDDM rig; ADE; device records |
| Apple Developer Program, $99/yr **[unverified — confirm before relying]** on current price | Paid membership | TestFlight, App Attest/DeviceCheck, push entitlements, installs beyond the 7-day free-provisioning window. (MDM vendor CSR signing is the $299/yr Enterprise Program.) |
| Entra ID P2 / Governance license | identity-risk risk engine and PIM are P2-gated; ~30-day trial only, then ~$9/user/mo | identity-risk live data; the PIM fail-open/fail-closed answer |
| Intune license + device enrollment | 30-day trial then paid; a real device must be enrolled by the owner | live managedDevices data; MDM-vs-IME check-in split |
| M365 Developer Program E5 sandbox | Closed to the general public since ~Jan 2024; gated on a paid VS standard subscription or partner programs | the one persistent free full-stack Microsoft tenant, if eligible |
| Hosted-tenant signups (Okta, Entra, Auth0, Azure, Google Cloud/Firebase, Cisco DevNet, Seam, Samsung) | Account creation, admin consent, and any credit-card identity checks are owner actions (Azure free account requires a card) | every hosted lane in sections 2-9 |
| UniFi Access door rig (hundreds of dollars) | Physical hub + reader purchase | real door events; the single highest-value purchase in the PACS category — also makes Proxmark/Flipper meaningful |
| Proxmark3 / Flipper Zero (~$45-169, **[unverified — confirm before relying]**) | Hardware purchase; useless without a reader rig; clone only credentials you own | adversarial badge scenarios (leaver's badge, cloned card) |
| PACS/RTLS vendor rigs: Verkada (hardware via sales motion), Genetec (paid partner program), Kontakt.io (hardware order), dock/kiosk/locker vendors (no sandboxes) | Sales engagements and shipped hardware, not free tiers | vendor-grade door/RTLS/dock signals |
| Rugged hardware: Zebra PartnerConnect ISV kits, Knox Manage (sales-gated trial), scan engines | Business registration / sales contact / physical devices | real scan engine, MX/StageNow, Knox enrollment |
| SentinelOne; DEX platforms (Nexthink, ControlUp, Aternity, SysTrack, Tanium) | No self-service trials or free tiers — enterprise sales only | nothing at zero cost; say so in any coverage claim |
| Physical SIM + carrier account | Billing identity + hardware | carrier-reachability with real session data |
| Physical FIDO2 key (~$25+) or Secure Enclave device | Hardware | genuine AAGUID/x5c attestation against FIDO MDS; Managed Device Attestation |
| Brivo developer sandbox; BrowserStack Open Source Program; HID Origo trial | Discretionary human approval of an owner's application | first-party Brivo semantics; unlimited cross-browser cloud; credential-lifecycle plane |

## Suggested first week

Five free lanes, ordered by real-world verification per hour of setup (each is the lead recommendation of its category):

1. **Playwright CDP WebAuthn virtual authenticator** over lib/webauthn (minutes): converts the repo's strongest fixture proof into evidence against real browser-generated CTAP2 credentials, including the fido-u2f x5c positive path the fixture file marks out of scope.
2. **Keycloak in Docker** (minutes): three env vars light up all of lib/enterprise-auth against a live JWKS, and its DPoP support mints the only zero-cost genuinely sender-constrained token for token-binding — extending the live-idp-proof lane to an independent production IdP.
3. ~~**Fleet + osquery, self-hosted**~~ **DONE** (hours): and the "runs verbatim with zero shim code" claim did not survive contact — every host/policy route 404'd against a real Fleet 4.89.2. Fixed and pinned by `proof:live-fleet`.
4. **FreeRADIUS + netns/dnsmasq ladder** (hours): real 802.1X outcomes and kernel-real DHCP/DNS failures drive the exact enums network-nac and link-usability gate on — and it can become a CI job, the only vendor-cloud-free option class with that property.
5. **Seam sandbox + Traccar** (an afternoon): the two thinnest-category connectors (pacs-access, rtls-custody) both get genuine live-transport proof — real cloud auth/pagination/failure modes and real movement/geofence/staleness — for $0.

Week two, once accounts exist: Dev Proxy for Graph wire behavior on the owner's machine, the AMAPI Colab kiosk codelab, and the Okta Integrator Free tenant. Spend the single Entra P2 30-day trial deliberately and LAST, once the identity-risk transport adapter and the PIM runbook are ready, so one trial window answers everything that requires a licensed tenant.
