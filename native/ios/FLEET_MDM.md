# SignalGrid + Fleet (open-source MDM) — integration blueprint

Fleet (`github.com/fleetdm/fleet`, MIT) is an **osquery-based**, **API-first**,
**GitOps** device platform that does **Apple MDM** for iOS/iPadOS + macOS. It fits
SignalGrid better than a closed MDM at this stage because it is a **two-way** fit:

- **Signal source (in):** osquery gives live posture — compliance, disk
  encryption, OS/patch level, installed apps, screen-lock, firewall, MDM
  enrollment — the exact device-trust signals SignalGrid's `DecisionEngine`
  consumes.
- **Enforcement actuator (out):** Fleet pushes configuration profiles + MDM
  commands + Declarative Device Management, which is how SignalGrid's
  conditional-access decisions become real device restrictions.
- **Programmable + self-hostable:** REST API + `fleetctl` + GitOps YAML, MIT
  licensed. The SignalGrid backend integrates over the API; no closed dependency.

This is the enforcement layer the app itself cannot do (see `MDM_CONFIGURATION.md`);
Fleet is the concrete, open way to do it.

## Architecture (the loop)

```
iOS device ──osquery posture──▶ Fleet ──REST──▶ SignalGrid backend
                                                   │ DecisionEngine / AppWorkflows
iOS device ◀──config profiles/commands── Fleet ◀──┘ (allow/step_up/restrict/deny)
```

1. Fleet enrolls + supervises the device (ADE via Apple Business Manager for
   supervision; ASAM needs supervision). Automated Device Enrollment supervises
   automatically (iPhone since iOS 13); a pilot device with no Apple Business
   Manager can be supervised by hand with Apple Configurator for Mac — and adding
   it to ABM later wipes it (`docs/ZERO_COST_LIVE_TEST_MATRIX.md`). Source: the
   Apple Platform Deployment guide, "About Apple device supervision" (2026-09-17
   edition).
2. SignalGrid reads posture from Fleet (osquery) as signals → decision.
3. On the decision, SignalGrid calls the Fleet API to apply/relax the profiles
   below (tighten on restrict/deny, release on allow).

## Profiles SignalGrid has Fleet push

These are standard Apple `.mobileconfig` payloads delivered as Fleet **custom
configuration profiles** (Fleet supports arbitrary signed/unsigned profiles).

**a) Managed App Config for the shell** (`com.apple.configuration.managed` for
`com.enterprise.shell`) — the keys `KioskConfig` already reads:
```xml
<dict>
  <key>SingleAppModeEnabled</key><true/>
  <key>AllowManualOverride</key><true/>
  <key>RecoveryCode</key><string>REPLACE-WITH-ADMIN-ISSUED-CODE</string>
</dict>
```

**b) Autonomous Single App Mode authorization** (`com.apple.applicationaccess`,
supervised) — lets the shell self-lock the idle device:
```xml
<dict>
  <key>autonomousSingleAppModePermittedAppIDs</key>
  <array><string>com.enterprise.shell</string></array>
</dict>
```

**c) Released-device allowlist** (`com.apple.applicationaccess`, supervised) — the
"restricted to admin-configured apps" set, mirrors the persona's `appLaunchConfig`:
```xml
<dict>
  <key>allowListedAppBundleIDs</key>
  <array>
    <string>com.enterprise.shell</string>
    <string>com.acme.emr</string>
    <string>com.acme.wms</string>
  </array>
</dict>
```
On supervised iOS 27 / iPadOS 27 devices the same allow-or-deny rule also exists
as a **declarative configuration** — the deployment guide's *App settings*
configuration, which additionally sets default privacy permissions (camera,
microphone, location, Bluetooth, local network) with an organization
justification string, and whose page lists Automated Device Enrollment as its
supported enrollment. A declaration travels the MDM's declarative channel, not
a `.mobileconfig`; (c) stays the profile form until the Fleet connector speaks
DDM. Source: "App settings declarative configuration" and "Allow and deny apps
and binaries" (2026-09-17 edition).

**d) Intelligence off on a shared clinical device** — two declarative
configurations, both supervised-only, iOS / iPadOS 26.4 and later: *External
intelligence* (turn off external intelligence integrations and their sign-in;
optionally one allowed workspace ID) and *Apple Intelligence* (Writing Tools,
Genmoji, Image Playground, Image Wand, Visual Intelligence, the per-app Mail /
Notes / Safari / Calendar features; force on-device-only dictation and
translation). A device that passes between clinicians must not carry a prior
holder's AI session or send text to an external model; these are the switches,
and this repository had no row for them until the guide was read (2026-09-18).
Declarations, not `.mobileconfig` — delivered by the MDM's declarative channel.

**d) Non-removable install** — the shell must NOT be uninstallable by the worker;
only MDM (Fleet) or the SignalGrid admin console (driving Fleet) may remove it.
An app cannot enforce this itself — it is two MDM facts:
1. **Install as a managed app** with removal disallowed. Fleet installs the app as
   an MDM-managed app; the `InstallApplication`/managed-app record marks it
   non-removable (managed apps are removed only by the MDM that installed them).
2. **Supervised restriction** blocking app removal on the device:
```xml
<dict>
  <key>allowAppRemoval</key><false/>
  <key>allowUIAppInstallation</key><false/>   <!-- optional: lock the App Store too -->
</dict>
```
Net: the Home-screen "Remove App" path is gone; the app is retired only by a Fleet
command (which the SignalGrid admin console issues over the Fleet API).

## Fleet GitOps (declarative source of truth)

The tracked team file is `fleet/teams/signalgrid-shared-devices.yml` (schema
`apiVersion: v1 / kind: team / spec.team.mdm`), and the one profile it delivers
is `fleet/profiles/signalgrid-restrictions.mobileconfig` — ASAM authorization
(b) and the app allow-list (c) are both payload keys of that single
`com.apple.applicationaccess` profile. Managed App Configuration (a) is NOT a
profile in this tree: it is set as the app's managed configuration when Fleet
installs the shell as a managed app (`native/ios/mdm/README.md`, "Managed App
Config keys"). An earlier version of this section showed a three-file sketch
(`managed-app-config`, `asam-authorization`, `app-allowlist`) under the real
team file's name and a real `fleetctl apply` command; none of the three files
ever existed, and the schema shown was not Fleet's. Read the tracked files, not
this page, for what is applied. `proof:mdm-profile` holds the profile's keys.

## SignalGrid ↔ Fleet connector (backend)

A new connector alongside the existing Graph/DDM connectors:

**Posture in** (Fleet REST → SignalGrid signals):
| Fleet / osquery | SignalGrid signal |
| --- | --- |
| `disk_encryption` = off | `device.non_compliant` (compliance=non_compliant) |
| `os_version` below floor | `device.non_compliant` (compliance=non_compliant) |
| MDM enrollment absent / unsupervised | managementState=unmanaged |
| `mdm.enrollment_status`, last seen age | posture freshness |
| screen-lock / firewall off | posture attributes |

`GET /api/v1/fleet/hosts/{id}` and osquery live/scheduled queries → normalized into
the signal context the `DecisionEngine` already evaluates. (The Fleet REST path keeps
the `/fleet` segment — the same base the connector reads from, `/api/v1/fleet/hosts` —
so this documented validation path is executable and does not 404.)

**Decision out** (SignalGrid → Fleet REST): on `restrict`/`deny`, move the host to
a locked team / apply the tighter allowlist profile; on `allow`, apply the normal
team. Fleet endpoints: team assignment + `POST` MDM commands / profile apply.

## Test path

**Now (this Mac + Docker — where your VM/Docker offer helps):**
1. `fleetctl preview` → local Fleet server via Docker (MySQL+Redis+Fleet).
2. Enroll THIS Mac as a macOS host → confirm live osquery posture flowing.
3. Push a custom profile via `fleetctl apply` → confirm it applies.
4. Build the connector: read posture from Fleet → SignalGrid signals; push a
   profile change on a decision.

What PROVES the loop is the committed, fixture-backed proof —
`pnpm run proof:fleet-connector` (deterministic, runs in CI). The Docker/live
steps above are an optional private validation exercise on top of that proof,
not a substitute for it.

**Needs real hardware + Apple Business Manager:**
5. Enroll a real iPhone/iPad in Fleet (APNs cert required).
6. Supervise via ADE/ABM → the ASAM authorization + app allowlist actually engage
   (the app-controlled kiosk-until-auth lock, verified on-device).
7. **Return to Service** — the device-side half of the custody ground truth's
   "returns to any dock where it checks itself back in, re-provisions": one MDM
   erase command carrying a Wi-Fi profile and the enrollment to return to; the
   device erases, re-enrolls, keeps its supervision, language and region, and
   lands on the Home Screen with no Setup Assistant. Corrected 2026-09-24 (DR-055)
   against Apple's own sources — this item used to say "iOS / iPadOS 26 and later"
   and "Not available on Shared iPad", and neither is right:
   - **Return to Service itself:** the `ReturnToService` key of the erase command
     exists from **iOS 17.0** (Apple's `device.erase.yaml`); the device must be
     enrolled through Device Enrollment or Automated Device Enrollment, and a Wi-Fi
     profile is required unless the device has another way online.
   - **App preservation** (keeps managed app binaries, erases user data): **iOS /
     iPadOS 26** or later, Automated Device Enrollment, an escrowed **bootstrap
     token**, and an iPad **not** configured as Shared iPad. The Shared iPad limit
     applies here only; the erase command itself lists Shared iPad as allowed on the
     device channel.
   - **iOS / iPadOS 27** adds enrollment retry after the erase (with an increasing
     delay, up to five minutes) and — **inside the app-preservation reset only** —
     a user start from Control Center or an inactivity timeout, after which the
     device checks in with the MDM to fetch its enrollment. It is not an iPhone
     trigger outside app preservation.
   - **Activation Lock must be off** — *"The user needs to deactivate all
     activation locks for this feature to work correctly"*.
   - **The erase's acknowledgement is not retried.** *"The device sends a response to
     the server, but it doesn't retry if it isn't successful the first time."* It is
     the device's response to the server that is not retried, not the erase, so the MDM
     may never see the result of an erase that did run; readiness after a return should
     key off observed re-enrollment or a DDM check-in, not this acknowledgement alone.

   Nothing in this repository binds `device_returned` to it yet — that is a
   `docs/BUILD_BACKLOG.md` row, not a claim, and the row asks for an approval-gated
   recommendation, not an erase in `lib/fleet-connector`. Apple's guide publishes no
   duration for a reset, so no speed may be stated before this step has run on a
   real supervised iPhone. Sources: "Use Return to Service for Apple devices"
   (https://support.apple.com/guide/deployment/use-return-to-service-for-apple-devices-dep17cb455a0/web,
   2026-09-17 edition) and
   https://github.com/apple/device-management/blob/release/mdm/commands/device.erase.yaml,
   both re-read 2026-09-24.

## The tradeoff: Fleet against Jamf or Intune

Fleet is the chosen MDM for the proof stack (DR-012 in `docs/DECISION_RECORDS.md`:
Fleet-first, with Intune when a prospect brings a tenant). DR-012 records the
*order*; this section records the *tradeoff* behind it, so the choice reads as a
decision and not an assumption (plan row 167 in `docs/COMPANY_BUILD_PLAN.md`).

**What Fleet buys.** Openness and infrastructure-as-code.
- The source is public and self-hostable. Most of the repository is MIT; the
  `ee/` directory is under Fleet's own licence
  (https://github.com/fleetdm/fleet/blob/main/LICENSE). So "MIT" at the top of
  this page is true of the core, not of every feature.
- Configuration lives in Git as YAML and is applied with `fleetctl`
  (`fleet/teams/signalgrid-shared-devices.yml`, `docs/IAC_GITOPS.md`).
- osquery gives a live, queryable posture read, which is the signal SignalGrid
  needs. The read path has been run against a real Fleet in private validation
  (`docs/FLEET_LIVE_INTEGRATION.md`); the CI evidence is the fixture proof.
- It costs nothing to stand up a lab, which suits the lean-IT first market DR-012 names.

**What Fleet gives up.** Managed depth.
- Teams, and so the host-transfer endpoint, are Fleet Premium; open-source Fleet
  answers `422` (`docs/FLEET_LIVE_INTEGRATION.md`, "Boundary found"). The
  connector never actuates by design, so this limits the lab, not SignalGrid.
- The fleet connector does not yet speak Declarative Device Management; the DDM
  declarations above are delivered by "the MDM's declarative channel", not by
  anything in this tree.
- Jamf is the repo's own named "Apple-depth" path: ABM/ADE, DDM, Managed Device
  Attestation, Platform SSO and Self Service (`docs/INTEGRATION_CATALOG.md`,
  "Jamf / Apple-specific posture connector path"). Jamf Pro manages Apple
  devices only (https://www.jamf.com/products/jamf-pro/).
- Intune's device compliance feeds Microsoft Entra Conditional Access
  directly, which needs an Entra ID P1 or P2 licence
  (https://learn.microsoft.com/intune/device-security/conditional-access-integration/overview).
  An estate already on Microsoft 365 gets that gate without a second vendor.

**When Jamf or Intune is the conservative choice.**
- **Jamf** — an Apple-heavy shared-device estate (for example ward iPads) that
  wants the deepest Apple workflow and an admin team that works in a console,
  not in Git.
- **Intune** — any estate that already runs Entra and Microsoft 365, or has
  Windows as well as Apple devices, where compliance-to-access is the need.
- **Either** — when the buyer already owns one. Intune and Jamf can coexist
  in one estate (`docs/company/ICP_EVIDENCE.md`), and SignalGrid reads the one
  that is there; it never replaces it (`docs/ECOSYSTEM_POSITIONING.md`).

**Why Fleet still, for now.** SignalGrid reads evidence and does not own the
device. The `DeviceManagementEvidence` contract is the boundary (DR-013), so the
MDM is a source, not a dependency. Fleet is the one that is open, free to run
and scriptable, which is what a proof needs. The Graph/Intune adapter already
exists (`lib/integrations/src/integrations/graph/posture-connector.ts`) and
awaits a real tenant. No Jamf adapter exists in `lib/` yet.

**What does not change with the MDM.** Whichever one is used, the kiosk (ASAM),
the app allow-list and the non-removable install need a **supervised** device
enrolled through Apple Business Manager, with APNs. The shell cannot kiosk
itself, and none of this can be shown in the Simulator. Choosing Jamf or
Intune changes the console, not this.

**Known drift.** `docs/INTEGRATION_CATALOG.md` still ranks "Intune/Entra first;
Jamf Apple-depth second", which predates DR-012's Fleet-first order. This
section does not settle that; DR-012 is the record.

## Partnership note
Fleet manages + observes the device (open source, osquery, GitOps); SignalGrid
adds the trust/Assist conditional-access gate on top. Clean ecosystem split — a
natural integration + co-marketing story rather than a competitive overlap.
