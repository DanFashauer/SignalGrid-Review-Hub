# App-workflow opportunity map

So far SignalGrid gates **infrastructure and physical actions** (unlock a room /
gate / vehicle, start a device session). The larger opportunity is to gate
**application workflows**: any app calls SignalGrid before it performs a
sensitive software action, and SignalGrid answers `allow / step-up / restrict /
deny` and returns which actions may run automatically vs. which must be
human-confirmed (the Assist model). SignalGrid becomes the **trust gateway in
front of the apps people actually use all day** — not just the doors.

This is one engine (the deterministic decision core) exposed through an
**app-integration API**. Each integrated app declares a catalog of *workflow
actions* with a risk tier; SignalGrid gates them from the actor's live trust
context. Everything stays public-safe: generic app **categories** (no real
vendor names, no PHI, no live calls), fixture-backed, high-risk actions
approval-gated and simulated.

## Priority order (top → down)

### P1 — Healthcare: clinical app workflows (nursing first)  ← building now
The explicit top priority. Gate the software a nurse touches every shift.

| App category | Example gated actions | Highest-risk (Assist) |
|---|---|---|
| **EMR / chart** | open patient chart, view results, document a note | place/verify **medication order**, release **discharge** |
| **BCMA** (barcode med admin) | scan patient, scan medication | **controlled-substance** admin, **dose override** |
| **Secure clinical messaging** | send secure message, acknowledge | **broadcast a code/RRT alert**, escalate to physician |
| **Alarms / middleware** | acknowledge alarm, route to holder | silence a **critical** physiologic alarm |

Why first: shared devices + high-consequence actions + a real "who is holding
this iPad right now, and is the device trustworthy" gap that badge/posture/
custody already answer. The Assist model (nothing sensitive fires silently) maps
exactly to clinical safety.

### P2 — Warehouse & industrial: execution + controlled-equipment app workflows
| App category | Example gated actions | Highest-risk (Assist) |
|---|---|---|
| **WMS / WES** | assign pick task, confirm pick | release **hazmat / high-value** pick, inventory adjust |
| **Labor / task** | clock into task, accept assignment | override a **safety hold** |
| **MES / SCADA-HMI** (industrial) | view line status, ack event | **start/stop a line**, change a **setpoint**, bypass an interlock |

### P3 — Large mobile transportation / fleet
| App category | Example gated actions | Highest-risk (Assist) |
|---|---|---|
| **TMS / dispatch** | view manifest, accept load | **cross-region checkout**, reassign a regulated load |
| **ELD / hours-of-service** | start duty status | **edit** a duty log, personal-conveyance override |
| **Telematics** | view vehicle status | remote **immobilizer / seal** release |

### P4 — Retail
| App category | Example gated actions | Highest-risk (Assist) |
|---|---|---|
| **POS** | ring a sale, look up price | **no-sale drawer open**, manager **void/refund** |
| **Age/rx-restricted** | scan item | approve an **age-restricted** or **pharmacy** sale |
| **Inventory** | count, receive | **markdown / write-off** above a threshold |

### P5 — Data center / NOC (uptime is the north star) — ✅ live
_Built as a sixth `@workspace/app-workflows` vertical (`data_center`): the six
app categories below, live in the admin App-workflows page, with every
uptime-affecting action held for confirmation/step-up and blocked under
restriction. A seeded NOC tenant (**Orion Data Centers**) now backs it in both
the decision core and the control-plane, so the catalog evaluates against a live
decision and shows on the Fleet page. proof:app-workflows + the api integration
test cover the uptime-safety invariants (config-push held, power-cycle blocked
under restriction)._

A strong fit: uptime is everything, and the highest-risk actions must never run
from an untrusted device/context without verification. SignalGrid gates them
invisibly, holding the uptime-affecting ones for confirmation + step-up — for
every role, up to the CEO (`docs/EMBEDDED_UX_PRINCIPLE.md`).

| App category | Example gated actions | Highest-risk (Assist / step-up) |
|---|---|---|
| **DCIM / change mgmt** | view topology, open a change | **execute a change**, **bypass a change freeze** |
| **Network config** | view config, stage a diff | **push config** to a core device, ACL/route change |
| **Power / PDU** | read draw, view breakers | **power-cycle a rack / PDU**, shed load |
| **ITSM / incident** | view ticket, update status | declare/resolve a **Sev-1**, page an exec bridge |
| **Cooling / BMS** | read sensors, ack | change a **setpoint**, override an interlock |
| **Compute / orchestration** | view nodes | **drain a node / trigger failover**, cordon a cluster |

The "resources it needs for proper usage" — capacity, power, cooling, network,
and compute headroom — are exactly what the operational-intelligence rollups
(friction / drift / gaps) already model; a NOC view would surface uptime-risk
concentration the same way.

## Cross-cutting building blocks (enable all of the above)

1. **App-workflow orchestration engine** — generalize the Assist model from
   physical actions to app actions: `planAppSession(trust, integration)` → each
   action classified auto / assist / step-up / blocked. *(P1 build.)*
2. **App-integration API** (`/v1/app-workflows`) — the endpoint an app calls:
   "given this actor + device + context, what can this app do right now?" plus a
   single-action gate. Bearer-authed, runs the real decision core. *(P1 build.)*
3. **In-app step-up (real, user-verified)** — when a decision is `step_up`, the
   **host app** drives the platform's *native* authenticator (Face ID / Touch ID /
   Windows Hello / badge tap); the assertion is verified cryptographically by the
   hardened `@workspace/webauthn` path, and only then does the held action
   release. The user sees only their own app's familiar prompt — never a SignalGrid
   screen (`docs/EMBEDDED_UX_PRINCIPLE.md`). Because a public-safe fixture can't
   provide real hardware evidence, the product API does **not** ship a release
   stand-in; in the demo, step-up completion is a clearly-labeled simulation. This
   is the next build.
4. **Workflow templates** — per-vertical starter catalogs an integrator clones.
5. **Admin surface** — an "App workflows" page: the integration catalog + a live
   gated-action preview per vertical.

## Guardrails (unchanged)
Generic app categories only — never a real vendor/product name or a
partnership/compliance/replacement claim. No PHI/PII, no live EMR/vendor calls;
every high-risk action is approval-gated and simulated. `pnpm run safety:check`
stays green.

---

**Now building: P1 + building blocks 1–2** — the app-workflow orchestration
engine, the healthcare app catalog (EMR / BCMA / secure messaging / alarms), the
`/v1/app-workflows` API, a proof, and an admin preview. P2–P4 catalogs are data
that plug into the same engine and follow next.
