# App-update currency — the honest half of "custom OTA updates"

## Where this came from, and what iOS actually allows

A recurring enterprise proposal (the "Beyond the App Store" pattern) has an iOS
app check a server for a newer version, download the IPA, hash-check it, and
install it over itself via `UIApplication.open`. **That mechanism does not exist
on iOS.** An iOS app cannot install, replace, or update itself; self-serve IPA
installation is an Android sideload pattern. Claiming otherwise fails this
repo's platform-honesty rule, so SignalGrid does not build or simulate it.

What Apple actually provides for enterprise distribution:

| Path | Who | What the app can do |
| --- | --- | --- |
| `itms-services://` manifest install | Apple Developer **Enterprise** Program (in-house apps) | The app may **open the URL to trigger** an install; the **OS** downloads, verifies code signing, and installs. A client-side hash check of a self-downloaded IPA plays no part — integrity is code signing + the manifest, enforced by the OS. |
| MDM `InstallApplication` | Any managed device — **Fleet**, this repo's chosen MDM | Nothing. The MDM pushes the app/update; supervised devices need no user tap. This is the repo's committed actuator. |
| ABM custom apps / TestFlight | Apple Business Manager | Nothing; distribution is Apple-mediated. |

"No App Store review" is only legitimate on the first path (in-house
distribution to your own employees). The rest of the proposal's *goals* —
instant delivery, forced updates, release rings, full control — are delivered
honestly by MDM, not by an app updating itself.

## What IS real: version currency is posture

The proposal's decision content survives contact with the platform, and it was
missing from the fabric: **`min_version` floors and `force_update` flags are
posture**. A frontline device running a stale, vulnerable build of its host app
should lose `allow` exactly the way an OS-below-floor device does (the
fleet-connector `osFloor` pattern) — and an app that arrived **outside the
managed channel** is an unverified provenance claim, not a trusted install.

`app-update` (`@workspace/integrations/app-update`) normalizes two
already-resolved, read-only inputs — the **MDM app-inventory row** (installed
version + install channel, as MDM observed them, never the app's claim about
itself) and the tenant's **release manifest** (latest, `min_version`,
`force_update`) — and grades them on the fabric's unified ladder:

| Situation | Verdict | Why |
| --- | --- | --- |
| current + managed channel + clean parse | `none` — currency confirmed | the grant; positively confirmed |
| behind latest, floor satisfied, not forced | `monitor` | an advisory nudge, not fatigue |
| behind latest, `force_update` set | `restrict` | the flag's one meaning is "older versions must not be used" |
| behind latest, force flag unreadable | `step_up` | cannot confirm the lag is permitted |
| below the enforced `min_version` | `restrict` | the affirmative bad fact — the floor exists because those builds are unsafe |
| unmanaged install (affirmative) | `restrict` | untrusted provenance on a frontline device, even when fully current |
| channel unknown | `step_up` | provenance must be positively managed |
| version relationship unknowable | `step_up` | unknown raises, never grants |
| manifest contradicts itself (`min_version` > latest) | `step_up` (malformed) | no version could satisfy it — a broken manifest is not a gradable posture |

The **currency is computed, never asserted**: the normalizer derives
current/behind/below-floor from the raw version strings (numeric dotted compare,
strict parse — an unparseable version is an unknown, not an approximation), so
the wire cannot claim "current" directly.

One reasoned exception to every-axis-positive: the force flag does **not** gate
the grant. A forced update to a version the device already runs is satisfied by
construction, so `current` grants under any force-flag state — and the proof
pins exactly that (of 216 normalized states with the stability bound posed,
exactly the three current+managed+clean+stable states grant; of 864 hostile
raw reports, exactly six).

## The stability axis (intake ledger row 19)

The same host app has a RUNTIME record on this device, and the analytics plane
(Omnissa Intelligence, Crashlytics-class SDKs and their peers) already computes
it. The wire may carry `crash_count` and `stability_window_hours` — the
source's own figures, validated but never reinterpreted — and the CALLER poses
the bound (`maxCrashesInWindow`). More crashes than the bound → `step_up`
(`APP_UNSTABLE`): a crashing host app is operational risk for the workflow
about to start in it, and the remedy is a challenge and a device swap, never a
block. An unposed bound is `unassessed` — carried visibly, never a defaulted
pass and never a foreclosed grant; a POSED bound the figures cannot answer
(count or window missing — a count without its window is uninterpretable) is
`unknown` and raises. A garbled count, a garbled window, or a zero-hour window
is a malformed report. No threshold is tuned here: the source counted, the
operator bounded, the fabric graded.

## Boundaries

- **Read-only.** The connector fetches and normalizes; there is no write path.
  Distribution and enforcement stay with the platform/MDM listed above.
- **Fixture-gated.** Live reads require beta/prod tier +
  `SIGNALGRID_LIVE_INTEGRATIONS=true` + `APP_UPDATE_ACCESS_TOKEN`, like every
  other connector; dev/alpha never call out.
- **No self-attestation.** The installed version and channel come from the MDM
  inventory. An app reporting its own version can support UX ("update
  available" messaging in the host app), but a *grant* never rests on it.

Proven by `proof:app-update` (70 checks; targeted checks, hostile report shapes, and the
grant-safety enumerations above; deterministic, offline).
