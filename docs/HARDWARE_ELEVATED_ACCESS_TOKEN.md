# Elevated-access hardware token — the modular case + dedicated key concept

Status: **concept / discovery.** No partnership, endorsement, integration, or
production hardware is claimed. This documents a hardware idea and, importantly,
draws the honest line between what hardware can do and what only the operating
system, an MDM, or a firmware vendor can do. The **software** half of the idea is
built and proven: see [Dual control](DUAL_CONTROL.md).

## The idea

A shared frontline device (a badge-checked-out iPhone/iPad) already rides in a
rugged case for survivability and battery. The concept adds a **modular bay** to
that case that seats a **dedicated hardware authentication token** — a FIDO2 /
USB-C security key of the YubiKey 5C NFC / Google Titan class, under the USB-C
Authentication Program. The token is *physically distinct* from the phone: a
separate credential, a separate device, carried in the same shell.

Its job is narrow and deliberate. The token is not a badge and not a login. It is
the **second, physically-separate key** for the small set of **elevated actions**
that warrant two-person integrity — a sysadmin performing a privileged operation
on a specialty account that lives outside the normal AD tree, a break-glass into
an emergency role, a bulk export. When such an action is attempted, the grid runs
the [dual-control](DUAL_CONTROL.md) workflow: the actor's own gesture (Face/Touch
+ PIN) is one authorizer; the **token in the case, verified by a second permitted
person**, is the other — the software analogue of the two-key narcotics cabinet.
The token is idle for everything else, which is the point: the heavy control
appears only for the heavy action, and disappears for routine work.

## What the hardware genuinely adds

- **A distinct credential instance.** `dual-control` refuses to grant if one
  authenticator signs both halves (a shared token is a single point of forgery).
  A case-mounted key that is physically a different device is exactly what makes
  the second authorization independent rather than "the same phone, twice".
- **Proximity and custody.** The key is where the action happens — no hunting for
  a loose USB stick — which is what makes an at-the-point-of-action second-person
  approval practical instead of a process people route around.
- **Session-scoped availability.** The bay can expose the token only for the
  duration of a checked-out session/shift and re-seat it on return, so an elevated
  key is not left live on an unattended shared device.

## Platform honesty — what hardware and an app CANNOT do

This is where most "smart case" pitches quietly overclaim. Being explicit:

- **A phone app cannot lock, unlock, or power a case bay**, cannot make itself
  non-removable, cannot restrict other apps, and cannot self-kiosk. Those are
  OS / MDM / firmware capabilities. Any "the case locks the token until end of
  shift" behavior is a **hardware + firmware** function of the case, optionally
  coordinated by an **MDM on a supervised device** — never something SignalGrid's
  software enforces from inside iOS.
- **On-device enforcement needs a supervised, MDM-enrolled device** (Apple
  Business Manager + APNs; Fleet is the chosen MDM in this repo's docs). A
  simulator or an unmanaged device cannot be enrolled and cannot enforce.
  SignalGrid never claims on-device enforcement from an environment that can't be
  managed.
- **The token proves possession + user verification; it does not prove the
  action is wise.** FIDO2 answers "a specific key, held by a verified user,
  responded." Whether *this* elevated action should happen is the judgment layer —
  `dual-control` for the two-person question, and the wider fabric
  (`pim-activation`, device posture) for the context. Hardware is an input to
  that judgment, not a substitute for it.
- **No vendor integration is implied.** Naming the YubiKey / Titan / USB-C
  Authentication Program classes is category description for a discovery concept,
  not a partnership or a claim that any such device has been integrated.

## Division of labor (honest boundary)

| Capability | Owner | In this repo? |
| --- | --- | --- |
| Two-person-integrity decision for an elevated action | SignalGrid software | **Built** — `@workspace/dual-control`, `proof:dual-control` |
| "Which actions require two people" selection | SignalGrid software (grid/flows policy) | Built pattern (right-fit control) |
| FIDO2 gesture / possession proof | The security key + WebAuthn | Modeled — `@workspace/webauthn` |
| Case bay lock / power / token exposure | Case **hardware + firmware** | Concept only — not software |
| Making the token available only per session, enforced on-device | **Supervised device + MDM** (Fleet) | Requires managed hardware; not simulable |

## Where this fits the product story

The recurring thesis — a "smart enterprise" that behaves like a smart home:
**proactive, right-fit, fatigue-reducing** — lands cleanly here. The grid doesn't
demand a hardware key for every tap; it invokes the heaviest control (two people,
two distinct keys, co-present, verified) only for the handful of actions whose
blast radius earns it, and stays invisible otherwise. The software that makes
that judgment is real and proven today; the case + token is a hardware concept
that *would make the second key convenient at the point of action* — documented
here with its limits stated, not implied.

See also: [Dual control](DUAL_CONTROL.md) · [Hardware partner matrix](HARDWARE_PARTNER_MATRIX.md)
· [Credential-reader signal model](CREDENTIAL_READER_SIGNAL_MODEL.md) · [SmartDock](SIGNALGRID_SMARTDOCK.md).
