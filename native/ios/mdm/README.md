# Kiosk lockdown — MDM configuration

**The device-side half of the kiosk.** An iOS app cannot make itself
non-removable, force full screen, or auto-relaunch — those are OS capabilities
gated on **supervision + MDM**. The app does its half (`UIRequiresFullScreen`,
and `KioskController` requests Autonomous Single App Mode); this profile does the
other half. **None of this works on an unsupervised device or the simulator** —
that is why the shell looks windowed/removable there.

## What `EnterpriseShell-Kiosk.mobileconfig` does

| Payload | Effect |
| --- | --- |
| `com.apple.app_lock` (Single App Mode) | Locks the device to `com.enterprise.shell`. The Home screen is **never reachable**, so the app **can't be closed or removed**, and iOS **auto-relaunches** it if it ever exits. `DisableAutoLock` keeps the screen on. |
| `com.apple.applicationaccess` | `allowAppRemoval = false` (belt-and-suspenders: app is non-deletable) and `AutonomousSingleAppModePermittedAppIDs` (lets `KioskController` self-enter ASAM between users). |
| `PayloadRemovalDisallowed = true` | The profile itself can't be removed on-device. |

This is what makes "the worker shouldn't be allowed to remove the app, and the
device is captive to the shell until badge tap" **actually true**.

## Deploy

1. **Supervise the device** — via Apple Business/School Manager + Automated Device
   Enrollment (preferred, for fleets) or Apple Configurator (for a few devices).
   Single App Mode requires supervision; it is refused otherwise.
2. **Enroll in your MDM** (Jamf, Intune, Kandji, Mosyle, …).
3. **Install this profile** through the MDM (or scope it to the kiosk device
   group). Push the Enterprise Shell app as a **managed, non-removable** app.
4. Verify: the device boots straight into Enterprise Shell, the Home
   gesture/button does nothing, and the app has no delete affordance.

> Single App Mode (this profile) locks the device to ONE app from the server side.
> Autonomous Single App Mode (the app's `KioskController`) lets the app lock/unlock
> itself *within* that authorization — used so the device stays captive even at the
> badge-idle screen and during teardown.

## Managed App Configuration (per-app, set in the MDM — not in this profile)

The shell reads these keys from Managed App Config (delivered under
`com.apple.configuration.managed`). Set them on the app assignment in your MDM:

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `SingleAppModeEnabled` | Boolean | `true` | Shell requests ASAM when active. |
| `AllowManualOverride` | Boolean | `false` | Show the disaster-recovery override on the lock screen. **Not recommended.** |
| `RecoveryCode` | String | — | Admin code that releases the kiosk for recovery (only if `AllowManualOverride`). Rotate per fleet. |

## What the simulator can and can't show

- **Can**: the full session flow, the configured per-role workspace and its
  launchable apps, teardown, idle-lock, the Assist gate.
- **Can't**: Single App Mode, non-removability, forced full screen,
  auto-relaunch — all require a supervised device with this profile. On the
  simulator the app is windowed and removable; that is expected, not a bug.
