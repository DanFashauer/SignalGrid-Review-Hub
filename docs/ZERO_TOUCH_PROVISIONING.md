# Zero-touch provisioning — record once, replay on join

The out-of-box promise from [OPEN_ORCHESTRATION_VISION.md](OPEN_ORCHESTRATION_VISION.md):
a device powers on for the first time and, by **serial + network join**, the Grid
configures it — so the end user never hand-sets-up a device. A **Designer / Device
Action Recorder** in the mobile app captures what a setup should do **once**; that
recording is a declarative artifact the CI/CD pipeline validates (like
[workflows-as-code](OPEN_ORCHESTRATION_VISION.md)) and the Grid replays.

Modeled in `@workspace/flows` → `provisioning.ts`
(`DeviceSetupRecording`, `lintSetupRecording`, `planZeroTouchSetup`), proven by
`pnpm run proof:provisioning`.

## The recording

A `DeviceSetupRecording` is: a **device match** (serial prefix and/or model — at
least one), one or more **triggers** (`first_boot` / `network_join` /
`serial_match`), and an ordered list of **steps** (`wifi`, `profile`, `cert`,
`app_install`, `policy`, `restriction`, `account`). A step may be marked
`sensitive` (regulated/lockdown config) or `gridLifted` (the Grid performs it
itself because the vendor system exposes no API — see
[SIGNAL_SOURCING.md](SIGNAL_SOURCING.md)).

`lintSetupRecording` validates it before it can be used — fail-safe errors: no
steps, no trigger, no device selector (a recording that matches nothing — or, if
unguarded, everything), an unknown step kind or trigger, duplicate step keys, a
missing id. A sensitive step is a **warning** (it needs approval at apply time,
not blocked at authoring).

## The safety boundary (non-negotiable)

`planZeroTouchSetup` is **simulated by default**. It will only ever actually run a
step when **both** are true: the plan is requested in `enforced` mode **and** the
owner master switch `enforcementEnabled` is `true`. In every other case each step
is `held_simulated` — described, not executed. And even under real enforcement:

- A device that does **not match** the recording's selector is **never touched**.
- An **invalid** recording is **never applied**.
- A `sensitive` step is `approval_required` — **never** auto-applied, in any mode.
- An empty/absent selector matches **nothing** (fail closed), never everything.

So the recorder + config give you the *convenience* of zero-touch setup without
ever handing the Grid unattended authority it wasn't explicitly granted. Real
enforcement stays off until an owner turns it on; until then this is a faithful
plan you can inspect, not an action taken.

## Seeing it — the operator surface

The operator console (mobile PWA, `artifacts/signalgrid-app`) has a **Device
recorder** view that reads this model live from `GET /cp/v1/grid/provisioning`:

- the **recording** rendered as the Designer artifact — match selectors, triggers,
  and the ordered steps with their kind and any `sensitive` / `gridLifted` marker;
- the **validation** state (`recordingValid` + `issues`), the same CI check the
  pipeline runs before the Grid replays it;
- a **zero-touch plan preview** you can point at a device. Pass `?serial=` to plan
  against a chosen device: a serial matching the recording's prefix shows the
  simulated per-step disposition (`held_simulated` while enforcement is off); a
  non-matching serial (e.g. `WARE-88120` against a `CLIN-` recording) shows the
  device **untouched** — the fail-safe, visible rather than merely claimed.

The view is read-only and simulated end to end; it never enrolls or contacts a
device. It is the "see the mobile app in action" surface for provisioning.

## Boundary

No device is contacted by this module — it is a pure planner over a recording and
a device descriptor. It does not claim an MDM/UEM enrollment integration; it
produces the plan a real enrollment path would carry out once enabled. See
[WHAT_SIGNALGRID_DOES_TODAY.md](WHAT_SIGNALGRID_DOES_TODAY.md).
