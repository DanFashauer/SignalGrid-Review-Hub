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

## Cross-cutting building blocks (enable all of the above)

1. **App-workflow orchestration engine** — generalize the Assist model from
   physical actions to app actions: `planAppSession(trust, integration)` → each
   action classified auto / assist / step-up / blocked. *(P1 build.)*
2. **App-integration API** (`/v1/app-workflows`) — the endpoint an app calls:
   "given this actor + device + context, what can this app do right now?" plus a
   single-action gate. Bearer-authed, runs the real decision core. *(P1 build.)*
3. **In-app step-up** — when a decision is `step_up`, the app drives a WebAuthn
   badge-tap / biometric (the hardened path already exists) and re-requests.
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
