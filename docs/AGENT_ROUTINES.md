# Agent routines — the always-on lanes, declared

The machine half is [`docs/agent/scheduled-routines.json`](agent/scheduled-routines.json),
gate-enforced by `scripts/check-scheduled-routines.mjs` (preflight + CI).
This page is the human reading of the same facts. Per the org design
(`docs/company/ORG_STRUCTURE.md`, AI/Agent Operations): **which agents may
do what, on whose authorization, writing where, escalating when** — declared
before run, never inferred after.

The gate's honest limits, stated the way the repo states everything: it
holds the committed **declaration** and the **firing evidence** (heartbeat
artifacts under `artifacts/agent-heartbeats/`); it cannot read the live
account scheduler. The registry records the date it was last transcribed
from the live scheduler; re-transcription is a deliberate act.

## The three standing lanes

| Routine | Cadence | Authorized by | Writes | Stops and escalates when |
| --- | --- | --- | --- | --- |
| `mac-lane-steward-duty-cycle` | every 4 hours | the owner, 2026-08-21, by direct request in-session | `artifacts/lane-messages/**` + its heartbeat | only what only the owner can clear (credentials, Mac-side actions) |
| `live-sync-loop-keeper` | daily 13:00 UTC | the owner, 2026-07-27 (owner-directed live-sync build) | the sync manifest, its notice marker, its heartbeat | live evidence stale >3 days and not recently notified; anything large is flagged, not fixed |
| `nightly-build-agent` | daily 14:00 UTC | the owner, 2026-07-15 | `claude/build-agent-*` branches ONLY — never merges, never the mainline | anything ambiguous or refactor-sized: pushes nothing |

## Heartbeats — "ran and did nothing" must differ from "never ran"

Every fire of a heartbeat-carrying routine writes its heartbeat file —
including a fire that changed nothing — so a quiet lane leaves evidence of
its quietness. A heartbeat older than the routine's declared tolerance is
**reported on every gate run** (never fatal — the lanes are not always
awake, but silence is never silent). The nightly build agent carries a
declared **null** heartbeat with its reason recorded: its write scope is
review branches only, and a mainline heartbeat commit would widen that
scope — worse than the gap it fills. Its firing evidence is the pushed
branch, or the run's completion notification when nothing was actionable.

## What is deliberately NOT in the registry

One-shot self-reminders (the operating session's `send_later` check-ins
that drive a PR to merge and then delete themselves) — they are ephemeral
work-pacing inside an owner-directed task, not standing lanes. A one-shot
that grew into a recurring schedule would belong here from its first
recurring fire.
