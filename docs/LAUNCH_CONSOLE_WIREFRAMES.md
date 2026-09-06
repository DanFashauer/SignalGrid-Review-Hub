# Launch Console Wireframes — the six screens

Wireframe-first pass per [SIGNALGRID_OPERATING_METHOD.md](SIGNALGRID_OPERATING_METHOD.md) §4:
layout, flow, messaging, error states, URLs, API parameters and response data,
agreed **before** further code. Screens 1, 3 and 4 largely exist after the D2
console work — their wireframes ratify what shipped and name the gaps. Screens
2, 5 and 6 are the design for what is built next. **No feature breadth until
all six are coherent.**

Conventions for every screen:

- **Assurance strip** on every page (from `GET /api/v1/context` →
  `assurance`): fixture/live signal source · advisory verdicts · tier.
- **Break-loudly states**: loading, empty, error, `unknown`, stale and
  fixture-backed are each *visible, labelled states* — never blank space.
- Language is platform-honest: "management data available", "step-up
  answerable" — never "device trusted".

---

## 1. Operator dashboard — `/`  (BUILT; gaps named)

```
┌──────────────────────────────────────────────────────────────────┐
│ Overview                      [assurance: fixture-backed demo]   │
│ ┌────────┐ ┌────────┐ ┌───────────┐ ┌────────┐                  │
│ │Total   │ │Allow % │ │Restrict/  │ │Avg     │   (fixture       │
│ │decisions│ │        │ │deny %    │ │latency │    telemetry,    │
│ └────────┘ └────────┘ └───────────┘ └────────┘    labelled)     │
│ ┌──────────────────────────────────────────────────────────────┐│
│ │ LIVE DECISION PANEL · /v1 core   [preset subjects] [verdict] ││
│ └──────────────────────────────────────────────────────────────┘│
│ ┌───────────────────────────────┐ ┌────────────────────────────┐│
│ │ Recent decisions · /v1 core   │ │ Connector health (screen 2)││
│ │ badge · identity · device · t │ │ graph ● fixture (reason)   ││
│ └───────────────────────────────┘ └────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
```

- Data: `GET /api/v1/decisions` (recent 5), `POST /api/v1/decisions/evaluate`
  (panel), fixture metrics clearly labelled until a `/v1` series exists.
- Gap CLOSED (2026-08-11): the connector-health card (right) is built — screen
  2's summary embed, one row per launch family with the mode chip the server
  resolved off `/v1/context`, the one-line reason, and the primary connector's
  last sync off `/v1/connectors`.
- Error state: each card fails alone with its message; the page never blanks.

## 2. Microsoft connector setup & health — `/connectors/setup`  (BUILT 2026-08-11)

The screen that makes "bring your tenant" concrete. It renders the RESOLUTION
the gate actually computed — mode plus the resolver's own reason string —
never a hopeful status.

```
┌──────────────────────────────────────────────────────────────────┐
│ Microsoft connector · setup & health   [assurance strip]         │
│ Step gates (each independently required for live mode):          │
│  [✓] Tier is beta/prod          SIGNALGRID_TIER=dev → fixture    │
│  [✗] Live integrations flag     SIGNALGRID_LIVE_INTEGRATIONS     │
│  [✗] Read-only Graph token      GRAPH_ACCESS_TOKEN               │
│ ────────────────────────────────────────────────────────────────│
│ RESOLVED MODE: ● FIXTURE — "tier \"dev\" never makes live        │
│ vendor calls"  (fixture connector is WORKING: 7 synthetic        │
│ devices, paged reads, same code path as live)                    │
│ ────────────────────────────────────────────────────────────────│
│ Families: graph ●fixture · device-mgmt-health ●fixture ·         │
│           local-authority ●fixture                               │
│ [Run sync]  last sync: t · records: n · signals: n               │
└──────────────────────────────────────────────────────────────────┘
```

- Data: `GET /v1/connectors`, `GET /v1/connectors/{id}/sync-runs`,
  `POST /v1/connectors/{id}/sync` — all three are `launch` in
  `scripts/launch-profile.mjs` published-api-paths (added to the fence 2026-08-10;
  `docs/LAUNCH_PROFILE.md` records it). Read + sync only, no write. (Until
  2026-09-06 this bullet still said they were outside the GA route fence.)
- Messaging: the reason string is the resolver's own
  (`"GRAPH_ACCESS_TOKEN is not set"`) — setup instructions ARE the gate
  checklist; a partner flips the named env vars and the checks go green.
- Never claims live when fixture; the mode chip is the assurance truth.
- Addendum (2026-08-11, owner redirect): an **Evidence sources** block between
  the gate checklist and the connector inventory — three declared rows (fleet ·
  open-source lab; headwind · android lab fixture shape; intune · enterprise
  connector) with one line each, closing on the contract sentence: same state,
  any source, identical decision, provenance the only difference. Declared
  facts about the shipped code; the resolved-mode card above remains the only
  live/fixture runtime claim.

## 3. Decision detail — `/decisions/:id`  (BUILT in D2; ratified)

```
┌──────────────────────────────────────────────────────────────────┐
│ [RESTRICT] dec_…        t · 12ms · tenant_northwind [assurance]  │
│ explanation sentence from the engine                             │
│ ┌─Context──────┐ ┌─Why · matched rules───────────────────────┐  │
│ │ identity     │ │ [restrict] DEVICE_NONCOMPLIANT rule·sev    │  │
│ │ device       │ │ reason-code chips                          │  │
│ │ workflow     │ ├─Evidence snapshot [digest verified]────────┤  │
│ │ policy·vN    │ │ evid_… · captured t · policy vN            │  │
│ │ review state │ │ evidence facts grid (17-category derived)  │  │
│ │ core-norm vN │ │ signals used: category·value·freshness·src │  │
│ │ → audit link │ └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

- Data: `GET /api/v1/decisions/:id` + `GET /api/v1/decisions/:id/evidence`
  (`verified` recomputed server-side per request).
- Gap CLOSED (2026-08-11): the "route owner" line is built — the refusal's
  owner role(s) from the IT-layer model, so the operator sees who picks this
  up. Owner routing is deliberately not on the wire (a named gap in
  `scripts/it-layer-model.mjs`), so the console carries a client-side mirror
  that `check-it-layer-model.mjs` drift-checks against the model both ways.

## 4. Evidence / audit — `/audit`  (BUILT in D2; ratified)

```
┌──────────────────────────────────────────────────────────────────┐
│ Audit  [chain verified — N events, every digest recomputed]      │
│ READ WITH THE DEMO AUDITOR KEY (audit:read)     [assurance]      │
│ seq · type · actor · summary · recorded · digest…                │
└──────────────────────────────────────────────────────────────────┘
```

- Data: `GET /api/v1/audit` → `{events, chain}`; broken chain renders as the
  loud red state with `brokenAtSeq`.
- Separation of duties is displayed, not hidden: operator ≠ auditor.

## 5. Policy version — `/policies/:id`  (BUILT 2026-08-11 — rebound to `/v1`)

Today's policies pages read the fixtures client. The launch version reads the
core's versioned policy store — the "what decided this" page.

```
┌──────────────────────────────────────────────────────────────────┐
│ Policy: shared-device · ACTIVE v2        [assurance strip]       │
│ workflow binding · rule-set digest · activated t by actor        │
│ ┌─Versions─┐ ┌─Rules in v2──────────────────────────────────┐   │
│ │ v2 ●     │ │ id · description · match fields · outcome ·   │   │
│ │ v1       │ │ severity · reason code   (read-only at launch)│   │
│ └──────────┘ └───────────────────────────────────────────────┘   │
│ [Run policy tests]  N/N passed against vN                        │
└──────────────────────────────────────────────────────────────────┘
```

- Data: `GET /v1/policies`, `GET /v1/policies/{id}/versions`,
  `GET /v1/policies/{id}/tests` — all three `launch` in `scripts/launch-profile.mjs`
  published-api-paths (fence additions of 2026-08-10); the page reads them
  (`artifacts/signalgrid-app/src/pages/policies/PolicyDetail.tsx:19-20`). Read-only:
  **no policy editing UI at launch** — versions are read and tested, changes ride
  the repo.

## 6. Limited-GA assurance status — `/status`  (BUILT 2026-08-11)

The honest one-pager a partner opens first: what this deployment IS.

```
┌──────────────────────────────────────────────────────────────────┐
│ SignalGrid · deployment assurance          [assurance strip]     │
│ profile: shared-device-gateway · tier: dev                       │
│ signal source: FIXTURES (no live vendor call possible here)      │
│ verdict effect: ADVISORY · step-up answerable: NO                │
│ launch families: graph ●fixture · dmh ●fixture · local-auth ●fx  │
│ core: 17 categories · normalization v4 · policy v2               │
│ known divergences: on-device demo engine lacks 2 core categories │
│ verification: preflight/CI suite green at <sha>                  │
└──────────────────────────────────────────────────────────────────┘
```

- Data: `GET /api/v1/context` (assurance), `GET /api/v1/metrics`, the declared
  divergence list, connector modes from screen 2's source.
- This page is the assurance-labelling P0 finished: every claim on it is a
  value the server derived, none is copy.

---

## Flow (the one launch experience)

Connector setup → connector health → policy (read) → **evaluate** → decision
detail → evidence → audit → route owner → verification. Screens 2 → 5 → 1 →
3 → 4 → 6 cover it end to end; nothing else is launch UI.

"Nothing else is launch UI" is ENFORCED in the console since 2026-08-11
(P0 #239): the sidebar carries three labelled groups (Launch console · /v1 /
Fixture previews · not launch / Build the grid · demo), and every non-launch
route renders a route-level PREVIEW banner a deep link cannot bypass —
including `/policies/new`, because policy editing is off the launch fence.
Both are pinned in the admin-console e2e suite.

## Build order and governance

1. Screen 6 (`/status`) — smallest, closes the assurance P0 loop. GREEN. — BUILT
   2026-08-11 (`artifacts/signalgrid-app/src/App.tsx:125`).
2. Screen 2 (`/connectors/setup`) — the read-only fence additions `GET /v1/connectors`,
   `GET /v1/connectors/{id}/sync-runs`, `POST /v1/connectors/{id}/sync` landed
   2026-08-10 as `launch` routes. — BUILT 2026-08-11
   (`artifacts/signalgrid-app/src/App.tsx:126`).
3. Screen 5 rebind — `GET /v1/policies*` are `launch` routes and the page reads them
   (`artifacts/signalgrid-app/src/pages/policies/PolicyDetail.tsx:19-20`). — BUILT
   2026-08-11.
4. Screen 1 connector-health card + screen 3 route-owner line. GREEN. — BUILT
   2026-08-11; all six screens are now coherent and e2e-pinned.
