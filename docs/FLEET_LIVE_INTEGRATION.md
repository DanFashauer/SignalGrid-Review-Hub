# Fleet connector — private-validation design notes

`@workspace/fleet-connector`'s **committed, CI-gated evidence is the fixture
proof** (`proof:fleet-connector`) — this public repo stays fixture-backed and
records no live vendor integration. This note captures DESIGN FINDINGS from a
one-off validation exercise the owner performed **privately, out-of-tree** (an
open-source Fleet server stood up locally for the exercise); nothing here is, or
substitutes for, the repo's evidence, and no live system, credential, or
reproduction artifact is part of this repository.

## What the private exercise covered

- **Fleet v4.89.2**, open-source (MIT), built from source for **arm64**
  (`go build ./cmd/fleet`; the frontend `make generate` is not required — the REST
  API serves without the embedded UI), against native-arm64 `mysql:8` + `redis:6.2`,
  TLS on `:1337`.
- A **real `osqueryd` 5.23.1** agent enrolled as a host over TLS.
- The **actual connector source** (`FleetClient.listHostPosture()`,
  `normalizeFleetReport`, `fleetSummary`, `FleetClient.applyDecision()`) driven
  against `https://<fleet>/api/v1/fleet/...`. The connector's only workspace import
  is type-only, so it runs standalone with no build step.

## Result

`listHostPosture()` returned the live host; `normalizeFleetReport()` produced:

```json
{
  "deviceManaged": false,
  "enforceable": false,
  "assurance": "raise_step_up",
  "rationale": "not MDM-enrolled in Fleet, unsupervised (kiosk/allowlist/non-removable cannot engage), disk encryption unknown, check-in unknown"
}
```

An unmanaged/unsupervised host **raises** assurance to step-up and reports
`enforceable:false` — the fail-safe direction (a weak posture never lowers
assurance). The private exercise observed the same behavior the committed
fixture proof pins — the fixture proof remains the evidence of record.

## Boundary found: enforcement (team transfer) is Fleet Premium

`applyDecision()` moves a host between Fleet **teams** (the mechanism that carries
the `fleet/` restriction profiles). Teams and `POST /api/v1/fleet/hosts/transfer`
are a **Fleet Premium** feature: on free/open-source Fleet the call returns HTTP
`422`, and the connector **fails closed** (throws) rather than reporting a
non-existent enforcement. So:

| Half of the loop | Endpoint | Open-source Fleet | Needs |
| --- | --- | --- | --- |
| Posture **read** (signal source) | `GET /api/v1/fleet/hosts` | ✅ works | — |
| **Enforcement** (actuator) | `POST /api/v1/fleet/hosts/transfer` | ❌ 422 → fail-closed | Fleet **Premium** (teams) |

Enforcement on a real device still additionally requires a **supervised** iPhone/iPad
(Apple Business Manager + APNs) — see `native/ios/FLEET_MDM.md`. Fleet Premium (teams)
is the control-plane prerequisite; a supervised device is the on-device prerequisite.

## Validating privately (optional, out-of-tree)

If you want to repeat the exercise in a PRIVATE test environment of your own,
the read path can be pointed at any reachable Fleet with a token you provision
there — this is private-lab guidance, not a repo artifact:

```bash
# Trust the local Fleet's CA explicitly — never disable TLS verification.
FLEET_BASE=https://<fleet>:1337 FLEET_TOKEN=<api-token> \
NODE_EXTRA_CA_CERTS=/path/to/fleet-ca.pem \
  tsx path/to/driver.mts   # listHostPosture → normalize → summary → applyDecision
```

The self-contained bring-up used here (arm64 Fleet-from-source + mysql/redis +
osquery enroll, all in one shell run) is kept out-of-tree as a scratch harness; the
connector code and `proof:fleet-connector` are the committed, CI-gated artifacts.

---

# `telemetry/fleetdm.ts` vs a live Fleet — a different package, a worse result

Everything above concerns **`@workspace/fleet-connector`**. This section concerns a
DIFFERENT piece of code that also talks to Fleet:
`lib/integrations/src/integrations/telemetry/fleetdm.ts`. They were written
separately, and only one of them was ever pointed at a real server.

`proof:live-fleet` is a committed, opt-in live proof (the `proof:live-edr` pattern:
it REFUSES without `FLEET_URL`/`FLEET_TOKEN` and the macOS harness skips it BY NAME,
never silently). 30 assertions, all green after the fixes below.

## What a real Fleet 4.89.2 said

[ZERO_COST_LIVE_TEST_MATRIX.md](ZERO_COST_LIVE_TEST_MATRIX.md) claimed this adapter
"is written against Fleet's exact API paths, so it needs zero shim code." Measured:

| The adapter used | Real Fleet 4.89.2 |
| --- | --- |
| `GET /api/v1/fleet/policies` | **404** — global policies live at `/api/v1/fleet/global/policies` |
| `GET /api/v1/fleet/hosts/{uuid}` | **404** — that route takes a NUMERIC id; a UUID needs `/hosts/identifier/{uuid}` |
| `/hosts/{id}` → a bare host | a `{ host: ... }` **envelope**; the old `as Promise<FleetDMHost>` cast produced an object whose every field is `undefined` while typechecking cleanly |
| `GET /hosts/{id}/policies` → `{results}` | **404** — no such route; results embed in the host under `?populate_policies=true` |
| `policy_id` / `policy_name` / `policy_response` | `id` / `name` / `response` |
| `host.serial_number` | `host.hardware_serial` (so this was always `undefined`, though typed non-optional) |
| `POST /queries/run {query, host_ids}` | **400** "no hosts targeted" — and see below |
| `GET /api/v1/fleet/config` (testConnection) | ✅ 200 — the only substantive path that worked |

**The trap is that last row.** `testConnection()` returned "Successfully connected to
FleetDM" while every host and policy read 404'd. A health check that cannot detect a
completely non-functional integration does not measure health; it manufactures
confidence. This is the same defect class as syslog reporting `sent` for a no-op.

**The redeeming part, now pinned rather than assumed:** the adapter failed CLOSED.
`getHost` 404 → `null` → `getPostureForHost` → `null`, and `compliant` already
required at least one policy AND all of them passing. A broken read never became a
cheerful verdict — so this was a availability bug, not a safety bug.

## `runQuery` refuses instead of being repaired

Correcting the request body alone would have been the wrong fix. A Fleet live query
is **asynchronous**: a successful POST returns `{ campaign: ... }` and rows stream
back over a **websocket**. There is no results array — the old `data.results` was
`undefined` despite its `Record<string, unknown>[]` type, so any caller reaching for
`.length` or `.map` would have thrown.

So "fixing" the body would have armed the single most dangerous call in the package
— it POSTs arbitrary osquery SQL to real production hosts — while still returning
nothing usable. Full blast radius, zero value. It now throws `not implemented` and
sends nothing, the way syslog now reports `not_implemented`. Implementing the
campaign/websocket collector is tracked as a feature in
[BUILD_BACKLOG.md](BUILD_BACKLOG.md).

## Reproducing it (amd64 under emulation — no Go toolchain needed)

The published `fleetdm/fleet` image is amd64-only; Docker Desktop on Apple Silicon
runs it under emulation, which is why this no longer needs the from-source arm64
build described earlier in this document.

```bash
docker network create sg-fleetnet
docker run -d --name sg-fleet-mysql --network sg-fleetnet \
  -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=fleet \
  -e MYSQL_USER=fleet -e MYSQL_PASSWORD=fleet mysql:8.0
docker run -d --name sg-fleet-redis --network sg-fleetnet redis:7

ENVS="-e FLEET_MYSQL_ADDRESS=sg-fleet-mysql:3306 -e FLEET_MYSQL_DATABASE=fleet \
 -e FLEET_MYSQL_USERNAME=fleet -e FLEET_MYSQL_PASSWORD=fleet \
 -e FLEET_REDIS_ADDRESS=sg-fleet-redis:6379 -e FLEET_SERVER_TLS=false"

docker run --rm --platform linux/amd64 --network sg-fleetnet $ENVS \
  fleetdm/fleet:latest fleet prepare db --no-prompt
docker run -d --name sg-fleet --platform linux/amd64 --network sg-fleetnet \
  -p 8412:8080 $ENVS fleetdm/fleet:latest fleet serve
```

Then create the first admin (`POST /api/v1/setup`), log in for a token
(`POST /api/v1/fleet/login`), add a global policy, and enroll a host through Fleet's
genuine osquery protocol (`POST /api/v1/osquery/enroll` with the enroll secret from
`GET /api/v1/fleet/spec/enroll_secret`) — no osqueryd binary required, because the
enrollment protocol is what creates the host record. Finally:

```bash
FLEET_URL=http://127.0.0.1:8412 FLEET_TOKEN=<token> pnpm run proof:live-fleet
```

TLS is off here deliberately: this is a disposable local server on the loopback
interface holding no real data. Point the same proof at a Fleet holding anything real
only over TLS, with `NODE_EXTRA_CA_CERTS` as in the section above.

Two limits this lane cannot cross, stated so they are not mistaken for coverage:
**teams are Fleet Premium** (so the team-policy branch of `getPolicies()` is
UNVERIFIED and was deliberately left untouched — changing an unverified path because
its sibling was wrong is a guess wearing a fix's clothes), and the enrolled host has
no live `osqueryd`, so every policy comes back `unknown` rather than `pass`/`fail`.
That absence is what proves the fail-closed path, but it does mean a genuine `pass`
has not been observed end-to-end.
