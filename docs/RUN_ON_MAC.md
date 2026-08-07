# Run SignalGrid — iPhone, iPad, or Mac

> **Just want the Mac lane to run itself?** From the repo root on your Mac:
>
> ```bash
> ./mac-kickoff.sh
> ```
>
> It updates both repos, clones `signalgrid-mcp` to a path `verify:all` actually
> searches, builds that repo's venv, re-registers the MCP server with the SDK
> bound the registration has to carry itself (`--with 'mcp[cli]<2'`), runs
> `verify:all --require-mcp --emit-evidence`, and offers to commit the evidence.
> It refuses immediately and says why if it is not on macOS. `--help` lists the
> flags (`--skip-mcp-register`, `--no-push`, `--yes`).
>
> This is the one lane that cannot be automated off this machine: `--emit-evidence`
> refuses off-macOS **and** on CI runners, on purpose, because green-ness is not
> hardware. See [MAC_LANE.md](./MAC_LANE.md) for what each half proves.

The smart-hospital simulation (Phase 1: **Trusted Room Entry**) runs entirely on
your own device with no cloud, no database, and no connection to any employer
system. Everything is **synthetic and public-safe** — fixture identities, rooms,
and assignments. SignalGrid is a *planner*: it computes decisions and an
orchestration plan; it never actuates a real device.

## Option A — Open it in a browser (zero setup — works on iPhone/iPad)

The whole decision core + orchestration is bundled into **one self-contained HTML
file** that runs entirely in the browser — no server, no network, no install. On
an iPhone, iPad, or any Mac:

- **Fastest:** open the hosted console link (a Claude Artifact) on your device and
  tap through the scenarios. Ask for the link and it opens right in Safari or the
  Claude app.
- **From the repo:** the same page is committed at
  [`docs/room-entry-console.html`](./room-entry-console.html) — open that file in
  any browser (or serve it from anywhere static). To rebuild it from source:
  `pnpm install && pnpm run build:room-console`.

This is the recommended path if you're on iOS — you can use, test, and show
SignalGrid entirely from the device in your hand.

## Option B — Docker (hosted API + console, on a Mac)

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

## Option C — Node + pnpm (no Docker)

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

## The operator console (admin app), fully populated

The React admin app (`signalgrid-app`) reads the api-server's `/api/*`
monitoring surface. With the api-server running on `:8080` (above), start the
app in a second terminal — its dev/preview server proxies `/api` to the
api-server automatically:

```bash
pnpm --filter signalgrid-app run dev     # http://localhost:5173
# or against a build:
pnpm --filter signalgrid-app run build
PORT=5173 pnpm --filter signalgrid-app exec vite preview
```

Open **http://localhost:5173** — the dashboard populates with decision
telemetry, the volume chart, integration health, and signals (deterministic,
public-safe **fixtures** — clearly labelled; the `/v1` core is the source of
truth for real evaluations).

- Proxy target defaults to `http://localhost:8080`; override with
  `API_PROXY_TARGET` if the api-server runs elsewhere.
- To point a **hosted/static** build at a remote api-server, build with
  `VITE_API_BASE_URL=https://your-api-host` and add that app origin to the
  api-server's `CORS_ALLOWED_ORIGINS`.

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
