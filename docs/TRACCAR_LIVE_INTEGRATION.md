# location-services vs a live Traccar — what an ambiguous `null` costs

`proof:live-location` runs the **location-services** connector against a real
[Traccar](https://www.traccar.org/) server (Apache-2.0, self-hosted, no account, no
trial clock). It is an opt-in live proof following the `proof:live-edr` /
`proof:live-fleet` pattern: it REFUSES without `TRACCAR_URL`, and the macOS harness
skips it **by name**, never silently.

Unlike the Fleet lane, this connector has **no hardcoded vendor paths** — it takes
an injectable transport — so there were no wrong URLs to find. A live server was
still worth it, for a different reason.

## The finding: `geofenceIds: null` means two different things

Traccar reports geofence membership on each position as `geofenceIds`. Measured on
**6.14.5**, positions ingested through its real OsmAnd protocol and read back
through its REST API:

| Fix | Coordinates | Geofence linked? | `geofenceIds` |
| --- | --- | --- | --- |
| 1 | 37.4220, -122.0841 (centre) | yes | `[1]` |
| 2 | 37.4700, -122.1400 (~5 km away) | yes | `null` |
| 3 | **37.4220, -122.0841 — identical to fix 1** | **no** | `null` |

Fixes 1 and 3 are the same coordinates from the same stationary device. The only
difference is whether a geofence was linked. So `null` means BOTH *"outside every
geofence"* and *"this device has no geofence to be outside of"*, and the position
response cannot tell them apart.

The proof reproduces this experiment against the live server on every run, rather
than asserting it from a fixture.

## Why it matters

The obvious mapping is `null → "outside"`. With it, a device sitting at the exact
centre of headquarters reports as **off-premises** the moment somebody unlinks a
geofence — a configuration change silently becomes a location signal. And it does
not stop at the connector boundary: `evaluateLocation` faithfully turns `outside`
into `OUTSIDE_AUTHORIZED_GEOFENCE` / `locate`, so the fabrication enters the fabric
wearing a real verdict's clothes. The proof asserts that failure explicitly, so the
trap is demonstrated rather than described.

This is the same law the rest of the repo keeps running into from the other
direction. Usually the danger is absence graded as *good* (syslog reporting `sent`
for a no-op; a capped read that looks complete; a Fleet policy nobody answered
counted as `pass`). Here absence would be graded as *bad*. Both are the same
mistake: **reporting a measurement that was never taken.**

## The mapping a Traccar adapter must use

`geofenceIds` alone cannot answer "is this device off-premises". The second fact —
does this device have any geofence at all — has to come from elsewhere
(`GET /api/geofences?deviceId=N`). Without it, the only honest answer is `unknown`:

```ts
const geofenceState = !deviceHasGeofences
  ? undefined          // → normalizes to "unknown": nothing to be outside of
  : ids && ids.length > 0 ? "inside" : "outside";
```

The connector is already fail-safe underneath this — `normalizeGeofence` sends
anything it does not recognise to `unknown`, and `unknown` yields
`NO_LOCATION` / `monitor`, a question rather than a claim. That is pinned too, so a
future change cannot quietly make `unknown` optimistic.

## What Traccar supplies

Five of `LocationFixRaw`'s fields, all genuinely: `deviceId`, `capturedAt`
(`fixTime`), `accuracyMeters` (`accuracy`), and `latitude`/`longitude`. Geofence
membership needs the second call above. Freshness is derived by the evaluator from
the real `fixTime`, and precise coordinates set `hasPreciseCoordinates` so a policy
can audit precise-location use.

## Bring-up

```bash
docker run -d --name sg-traccar -p 8482:8082 -p 5055:5055 traccar/traccar:latest
# 6.14.x ships with registration disabled but an open /api/users on a fresh DB;
# the first user created becomes an administrator.
curl -s -X POST http://127.0.0.1:8482/api/users -H 'Content-Type: application/json' \
  -d '{"name":"SG","email":"sg@signalgrid.test","password":"<pick-one>"}'

TRACCAR_URL=http://127.0.0.1:8482 \
TRACCAR_USER=sg@signalgrid.test TRACCAR_PASS='<pick-one>' \
  pnpm run proof:live-location
```

Port 5055 is Traccar's OsmAnd ingest protocol — the proof posts positions through
it rather than writing rows, so the data under test travels the same path a real
phone's would.

**This proof WRITES to the server** (it creates a device and a geofence, links and
unlinks them, and ingests positions). Point it only at a disposable local instance,
never at anything holding real fleet data. It is plain HTTP on loopback for the same
reason; a Traccar holding anything real should be behind TLS with
`NODE_EXTRA_CA_CERTS`.

Two limits, stated so they are not mistaken for coverage: Traccar is **outdoor GPS,
not indoor RTLS**, so it cannot exercise the `rtls-custody` dimension's zone
semantics (`zoneType`, `badgeAssociated`, `atEgress`, dwell) — see
[ZERO_COST_LIVE_TEST_MATRIX.md](ZERO_COST_LIVE_TEST_MATRIX.md) section 8. And the
positions here are synthetic coordinates ingested over a real protocol, not a real
phone moving through a real geofence; the transport, the geofence computation and
the ambiguity are real, the journey is not.
