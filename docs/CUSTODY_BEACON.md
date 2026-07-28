# Custody beacon — asset recovery when every online signal has gone dark

## The gap

Everything SignalGrid has for *where is the device* is **online and
infrastructure-dependent**, and it all goes blind at the same moment:

| Dimension | Needs | Blind when… |
| --- | --- | --- |
| `rtls-custody` | deployed BLE/UWB anchors + a broadcasting device | device off, or outside the anchored facility |
| `location-services` | device powered, on-network, reporting a geofence | device off/dark or network-detached |
| `reachability` / `carrier` | device on a network | device powered off or SIM pulled |
| SmartDock / dock-state | device seated in a bay | device removed |

They go dark **together** — the instant a device is powered off, battery-dead,
or walked out the door, which is exactly the theft/loss case.

**Native recovery does not serve shared enterprise fleets here.** Consumer Find
My needs a personal Apple ID (shared, supervised, ABM-enrolled devices do not
have one). The supervised-device equivalent — MDM **Lost Mode** / **Activation
Lock** — needs the device *powered and reaching APNs*; a thief just powers it off
or pulls the SIM and it is dark. That is a structural blind spot, not a
configuration miss.

## The dimension

`custody-beacon` (`@workspace/integrations/custody-beacon`) consumes an
**independent recovery beacon** — a case-embedded, weeks-long, infrastructure-free
tag (a Find My-network accessory, or a dedicated cellular/LoRaWAN asset tracker)
that survives the phone being off and reports a coarse last-seen **zone** through
its own finding network, plus the device's out-of-band **reachability**. It is
*recovery*, not surveillance: the reading is coarse and lagging by design.

The decision value is the **fusion**. A dot on a map is commodity
asset-tracking. The beacon is the out-of-band channel that breaks the tie the
online signals collapse into one:

| Beacon zone | Device reachability | Verdict | Why |
| --- | --- | --- | --- |
| in custody zone | reachable + **fresh** | `none` — custody confirmed | positively in place and live |
| in custody zone | **unreachable** | `monitor` — benign | **powered off in its bay** — do not alarm |
| in custody zone | reachable but **stale** reading | `step_up` | cannot confirm *current* location |
| departing | reachable | `alert` | moving toward the boundary, still online |
| departing | unreachable | `restrict` | leaving and going dark |
| **off premises** | reachable | `restrict` | out and controllable — contain it |
| **off premises** | **unreachable** | `escalate` | **highest-confidence removal** → lost-mode/wipe + incident |
| unknown | unreachable | `restrict` | dark *and* location unconfirmed |
| unknown | reachable | `step_up` | online but location unconfirmed |

No other dimension can make the **benign-offline vs stolen** distinction, because
they all go blind with the device. Fail-closed throughout: the grant (`none`)
requires the device positively **in zone, reachable, on a fresh reading, clean
parse** — every axis confirmed. It never lowers what the online custody
dimensions say; the fabric still fuses worst-concern-wins.

## Right fit, not surveillance

This is an **asset-recovery** signal, and its honesty depends on staying that:

- **Not live GPS tracking of staff.** The reading is coarse and lagging (crowd/
  independent-network updates are intermittent, not real-time). It answers "is
  the device roughly where custody says it should be", not "where is this person
  right now". Location visibility and retention are governed by the same
  who-can-see model as every other signal (see grid governance).
- **Complements, never replaces, the online signals.** It is a recovery channel
  for after a device goes dark — a lagging backstop, not a prevention control.
- **The beacon is hardware + firmware.** An app cannot power a tag, and SignalGrid
  activates no recovery mechanism itself — it reports a posture the fabric fuses,
  and recommends lost-mode/wipe for a human/MDM to carry out.

## Hardware: the modular-case recovery module

The natural home for the beacon is a **module in the modular case** — the same
shell that already carries the device for survivability and battery. A
weeks-long, infrastructure-free tag there is physically separable from the device
it protects (so a powered-off or wiped phone still reports), and its distinct
credential/identity is what makes an independent recovery channel real rather
than "the same dead phone, asked twice". This composes with the elevated-access
token concept — see [Elevated-access hardware token](HARDWARE_ELEVATED_ACCESS_TOKEN.md).
Platform honesty is the same: the module is hardware/firmware; on-device
enforcement of anything (lost-mode, wipe) still needs a supervised, MDM-enrolled
device.

## Proof

`pnpm run proof:custody-beacon` (43 checks) is fully offline and deterministic.
It pins every zone×reachability fusion (the benign in-zone-offline case and the
off-premises-dark escalation especially), the fail-closed unknown/stale paths,
`covered=false`, and hostile report shapes (prototype-inherited/aliased keys,
descriptor-hiding and throwing proxies, a throwing accessor, non-object bodies).
It brute-forces the grant twice — the full normalized space (96 states, exactly
one grants) and a hostile raw-wire space (192 readings, exactly one grants) —
asserting custody is confirmed for **exactly** the fully-clean in-zone/fresh/
reachable reading and nothing else.

## Boundary

Not legal, clinical, or compliance advice, and not a claim of production
readiness. SignalGrid activates no recovery mechanism and writes nothing back —
it reports a posture and records the evidence.
