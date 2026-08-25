# SignalGrid — investor one-pager (DRAFT, prepared per FUNDING_READINESS path B)

**Status: PREPARED, not in use.** Per the funding recommendation, pre-seed
conversations open only at first-pilot-live and only on the founder's word.
This page exists so that day requires zero preparation. Every claim traces
to the public repository; an investor's diligence packet is `git clone`.

## One sentence

SignalGrid is a **Shared-Device Trust Gateway** — an access-decision service
built invisibly into the apps frontline staff already use: before a
sensitive action on a shared device it answers allow, step up, restrict, or
deny, and anything it can't verify tightens the answer instead of waving it
through.

## The problem (measured, not asserted)

Lean IT teams (75–1,000 employees, 1–10 IT staff) run fleets of shared
scanners, carts, and terminals. Their management console shows the last
state it recorded — not whether that answer is still true when a worker
picks the device up. In our lab, every live wire check ever run (10 of 10)
found the system of record diverging from device reality. "Green" is just
the last thing anyone recorded.

## Why now / why us

- **Proof-first, in public**: 140 proof gates (the figure `docs/STATUS.md`
  publishes and `check-status-figures.mjs` keeps true — this page cites it
  rather than keeping a second copy that can drift), fail-closed
  by doctrine, tamper-evident audit ledger, signed release artifacts — the
  entire product is a public repository. Diligence is reading, not trusting.
- **Open-source-proven** (DR-013): live end-to-end against Fleet, Keycloak,
  FreeRADIUS, Traccar, Wazuh — zero vendor spend. Paid platforms are thin
  adapters, not product risk.
- **Cost structure**: limiter-bound serving; one small VM over-serves a
  tenant; marginal tenant cost ≈ $0; one identified paid software
  dependency. Published at docs/COST_MODEL.md.
- **An AI-operated company that works**: one founder, a 42-role agent org
  with decision records, standing routines, and a public audit trail —
  every change through the full gate suite, on a public commit history.
  {AT-USE: merge count over a named window — read off `git log` on the day
  this is sent, never a figure typed once and left to decay.}

## Traction (updated at use time — no forward-dated claims)

Shadow-mode pilot program live; first outreach wave to researched lean-IT
targets in flight; pilot terms published. {AT-USE: pilot count, conversation
count, any conversion — filled from the outreach log on the day this is
sent, never projected.}

## The ask (set at use time)

{AT-USE: amount and instrument — the founder sets these; FUNDING_READINESS
path B frames $250–750k-shaped pre-seed as the reference class.} Use of
funds: founder full-time runway + pilot-to-production engineering; the cost
model shows where every dollar does NOT need to go.

## Boundaries stated up front

No certifications claimed (SOC 2 / HIPAA are roadmap, stated honestly).
Not an MDM, IdP, or EDR — reads their evidence, replaces none of them.
Pre-revenue at draft time. The unsafe-claim scan in `docs-sanity` fails our
own CI if this document ever says otherwise — verified by planting a false
"certified" claim here and watching the build go red.
