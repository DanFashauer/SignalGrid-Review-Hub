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
| `com.apple.applicationaccess` | `allowAppRemoval = false` (the app is non-deletable) and `autonomousSingleAppModePermittedAppIDs` (**authorizes** `com.enterprise.shell` to enter Autonomous Single App Mode — ASAM). |
| `PayloadRemovalDisallowed = true` | The profile itself can't be removed on-device (it is still removable remotely by the MDM that installed it). |

The lock is **ASAM, which the app controls** — `KioskController` enters it while
the device is badge-idle and **releases it on authentication** so the worker
reaches their admin-allowlisted apps. That is what makes "the worker can't remove
the app, and the device self-locks to the shell between users" true **without**
permanently trapping the device.

> **Why not hard Single App Mode (`com.apple.app_lock`)?** That payload pins the
> device to one app from the server side, and the app *cannot exit it on its own* —
> so `KioskController.releaseLock()` on sign-in would be a no-op and the worker
> would never reach normal apps. It is intentionally **omitted**: this product's
> model is kiosk-**until-auth**, then release, which only ASAM can express. (A true
> never-leaves-one-app kiosk — a wall display, a single-purpose scanner — is the
> case where `app_lock` is correct; this isn't that.)

## Deploy

1. **Supervise the device** — via Apple Business/School Manager + Automated Device
   Enrollment (preferred, for fleets) or Apple Configurator (for a few devices).
   ASAM authorization requires supervision; it is refused otherwise.
2. **Enroll in your MDM** (Jamf, Intune, Kandji, Mosyle, …).
3. **Install this profile** through the MDM (or scope it to the kiosk device
   group). Push the Enterprise Shell app as a **managed, non-removable** app.
4. Verify: at badge-idle the device is locked to Enterprise Shell (Home
   gesture/button do nothing) and the app has no delete affordance; after a valid
   badge tap the shell releases ASAM and the allowlisted apps become reachable.

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
- **Can't**: Autonomous Single App Mode, non-removability, forced full screen,
  auto-relaunch — all require a supervised device with this profile. On the
  simulator the app is windowed and removable; that is expected, not a bug.
