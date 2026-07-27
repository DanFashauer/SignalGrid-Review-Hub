# Fleet connector — live integration (validated against a real Fleet)

`@workspace/fleet-connector` is exercised in CI against fixtures
(`proof:fleet-connector`, 45 assertions). This note records an **end-to-end run
against a genuinely live open-source Fleet server** — real server, real enrolled
osquery host, real REST responses — and the free-vs-Premium boundary it surfaced.

## What ran

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
assurance). This matches the fixture behavior, now confirmed on live data.

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

## Reproduce

The read path can be validated against any reachable Fleet with a token:

```bash
# Trust the local Fleet's CA explicitly — never disable TLS verification.
FLEET_BASE=https://<fleet>:1337 FLEET_TOKEN=<api-token> \
NODE_EXTRA_CA_CERTS=/path/to/fleet-ca.pem \
  tsx path/to/driver.mts   # listHostPosture → normalize → summary → applyDecision
```

The self-contained bring-up used here (arm64 Fleet-from-source + mysql/redis +
osquery enroll, all in one shell run) is kept out-of-tree as a scratch harness; the
connector code and `proof:fleet-connector` are the committed, CI-gated artifacts.
