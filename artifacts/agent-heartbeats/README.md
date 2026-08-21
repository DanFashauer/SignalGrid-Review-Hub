# Agent heartbeats

One JSON file per always-on routine declared in
[`docs/agent/scheduled-routines.json`](../../docs/agent/scheduled-routines.json)
— `{"firedAt": "<ISO timestamp>", "result": "<one line>"}` — written on EVERY
fire, quiet ones included, so "ran and did nothing" leaves different evidence
than "never ran". `scripts/check-scheduled-routines.mjs` (preflight + CI) holds
these against the registry: a heartbeat with no declared routine is fatal (an
undeclared lane is running); a stale heartbeat is reported, never fatal (the
lanes are not always awake, but silence is never silent). Human overview:
[`docs/AGENT_ROUTINES.md`](../../docs/AGENT_ROUTINES.md).
