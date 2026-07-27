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
   supervision; ASAM needs supervision).
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

```yaml
# fleet/teams/signalgrid-shared-devices.yml
name: SignalGrid Shared Devices
controls:
  macos_settings: {}
  ios_updates: {}
  custom_settings:
    - path: ./profiles/managed-app-config.mobileconfig   # (a)
    - path: ./profiles/asam-authorization.mobileconfig   # (b)
    - path: ./profiles/app-allowlist.mobileconfig        # (c)
```
`fleetctl apply -f fleet/teams/signalgrid-shared-devices.yml`

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

`GET /api/v1/hosts/{id}` and osquery live/scheduled queries → normalized into the
signal context the `DecisionEngine` already evaluates.

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
6. Supervise via ADE/ABM → the ASAM allowlist + Single App Mode actually engage
   (the kiosk-until-auth lock, verified on-device).

## Partnership note
Fleet manages + observes the device (open source, osquery, GitOps); SignalGrid
adds the trust/Assist conditional-access gate on top. Clean ecosystem split — a
natural integration + co-marketing story rather than a competitive overlap.
