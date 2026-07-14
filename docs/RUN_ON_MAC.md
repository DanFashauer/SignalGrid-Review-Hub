# Run SignalGrid locally on your Mac

The smart-hospital simulation (Phase 1: **Trusted Room Entry**) runs entirely on
your own machine with no cloud, no database, and no connection to any employer
system. Everything is **synthetic and public-safe** — fixture identities, rooms,
and assignments. SignalGrid is a *planner*: it computes decisions and an
orchestration plan; it never actuates a real device.

## Option A — Docker (recommended)

Requires **Docker Desktop for Mac** (Apple Silicon or Intel).

```bash
git clone https://github.com/DanFashauer/SignalGrid.git   # or your fork/branch
cd SignalGrid
docker compose -f docker-compose.sim.yml up --build
```

Then open **http://localhost:8080/console**.

Pick a scenario on the left; SignalGrid runs the real decision core and shows the
signals it evaluated, the decision and why, and the downstream orchestration —
with sensitive actions (a controlled-room door, a PHI display) held for your
confirmation. Stop with `Ctrl-C`.

## Option B — Node + pnpm (no Docker)

Requires **Node 22+** and **pnpm 10+** (`corepack enable` gives you pnpm).

```bash
cd SignalGrid
pnpm install
pnpm --filter @workspace/api-server run build
PORT=8080 node artifacts/api-server/dist/index.mjs
```

Open **http://localhost:8080/console**.

For live-reload development instead of a build:

```bash
pnpm --filter @workspace/api-server run dev   # tsx watch on the API
```

## What you can do

- **Try every scenario.** They span the full decision range: a clean allow, a
  bedside session, a controlled med room, a non-compliant device, security-
  baseline drift, a withdrawn badge (custody lost), a tamper flag, and a disabled
  account — each producing a real allow / step-up / restrict / deny and a matching
  orchestration plan.
- **Confirm an assist action.** On an allow, sensitive steps show a **Confirm**
  button (the "Assist" model). Click it to simulate a clinician approving that
  step — it moves to *applied*, and once all sensitive steps are confirmed the
  orchestration mode becomes *proceed*.

## The API directly (for building on it)

```bash
# List scenarios
curl localhost:8080/api/sim/room-entry/scenarios

# Evaluate one end-to-end (decision + orchestration plan)
curl -X POST localhost:8080/api/sim/room-entry \
  -H 'content-type: application/json' \
  -d '{"scenarioId":"compliant-medroom"}'

# Confirm a sensitive action
curl -X POST localhost:8080/api/sim/room-entry \
  -H 'content-type: application/json' \
  -d '{"scenarioId":"compliant-medroom","confirmedActionIds":["act-MED-1-clinical.display.activate"]}'

# Health (reports the tier + whether live integrations are enabled — they're not)
curl localhost:8080/api/healthz
```

The underlying `/v1` product API (decision core: tenancy → decision → evidence →
audit) is also available on the same server — see
[`PRODUCT_CORE_FOUNDATION.md`](./PRODUCT_CORE_FOUNDATION.md).

## Guardrails (always on)

- No real hospital, patient data (PHI/PII), credentials, or vendor/Graph/API
  calls — the simulation is deterministic and offline.
- `SIGNALGRID_TIER=dev` keeps live integrations disabled no matter what.
- Sensitive actions are never performed automatically — they require explicit
  human confirmation. SignalGrid assists and coordinates; it does not silently
  override a clinician.

See the vision and architecture in
[`SMART_HOSPITAL_TRUST_FABRIC.md`](./SMART_HOSPITAL_TRUST_FABRIC.md).
