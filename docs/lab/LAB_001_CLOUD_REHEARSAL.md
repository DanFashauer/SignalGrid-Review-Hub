# LAB 001 — cloud rehearsal of Step 1's verification protocol

**Date: 2026-08-31. Lane: cloud sandbox. Status: protocol PROVEN over the real
wire. The Mac's half — real posture, real hardware — RAN on 2026-09-02 (as of
2026-09-06: `artifacts/sim-results/2026-08-31-lab001-step1-real-posture.json`,
status passed, exit 0, working tree clean); this record is the cloud rehearsal
that preceded it and is not that evidence.**

## What this is, and is not

LAB_001 Step 1's product moment — the core deciding on the MacBook's real
posture — can only happen on the Mac (`docs/lab/LAB_001.md`). But the
verification protocol the owner named as the check not to skip — *"force an
unreadable probe and confirm unknown raises assurance rather than lowering
it"* — is testable against the first-party MCP server's real stdio wire, and
the owner directed that the simulator carry the tasks a container can carry.
This record is that rehearsal, and it is an ANALOGUE, not a baseline: it drives
the in-repo TypeScript server (`artifacts/mcp-server`, registered in
`.mcp.json` under the name `signalgrid-mcp`) and its `evaluate_location_certainty`
tool over the fixture hospital graph — a LOCATION observation graded for
certainty. The Mac's half runs a DIFFERENT server (the separate Python
repository `signalgrid-mcp`, which `scripts/verify-all.mjs` clones and runs
with pytest — the two share a name and nothing else) against a DIFFERENT
signal (macOS POSTURE: FileVault, SIP, Gatekeeper, firewall). Same JSON-RPC
wire discipline, same unknown-tightens law under test; not the same server,
not the same tool. Driven with a healthy baseline and four forced-unknown
probes.

Not claimed: anything about real hardware. The signals here are the tool's
deterministic inputs, not a machine's posture. What IS established: the wire
works end to end, and the unknown-tightens law holds at the served boundary,
not just inside library unit tests.

## Method

`artifacts/mcp-server` driven over stdio (tsx, the committed `.mcp.json`
registration), `initialize` → `tools/call evaluate_location_certainty`, five
cases. All times passed explicitly — no wall clock. Raw JSON-RPC replies were
captured; the verdict fields are quoted verbatim below.

## Results — every probe tightened, none loosened

| Case | Input forced | `state` | `reasonCode` | `recommendedAction` |
| --- | --- | --- | --- | --- |
| baseline_healthy | fresh, confident, `source_health: healthy` | `known` | `SUFFICIENT_CERTAINTY` | `none` |
| probe_health_OMITTED | `source_health` absent — the unreadable probe | `degraded` | `SOURCE_DEGRADED` | `step_up` |
| probe_health_unavailable | `source_health: unavailable` | `unavailable` | `SOURCE_UNAVAILABLE` | `step_up` (critical finding recorded) |
| probe_stale_10min | observation 10 min old vs 120 s budget | `stale` | `LOCATION_STALE` | `step_up` (critical: `observation_stale`) |
| probe_accuracy_unknown | `accuracy_class: unknown` | `degraded` | `LOCATION_UNKNOWN` | `step_up` (`unknownSignals` names it) |

The one that matters most is the second row: a source that says nothing about
its own health is graded `unknown` by the server and the verdict tightens to
`step_up` — the exact opposite of the NaN fail-open family this repository
spent last week killing, holding at the served boundary.

## What this hands the Mac

`artifacts/sim-requests/2026-08-31-lab001-step1-real-posture.json` asked the
Mac lane to run the real half: `verify:all --require-mcp --emit-evidence`
against the Python `signalgrid-mcp` reading the MacBook's actual posture,
minting `artifacts/live-evidence/mac-run.json`. It ran on 2026-09-02 (as of
2026-09-06, the result file named in the header: `99 passed`, evidence
written). Two things a reader must not conclude from that:

- **The table above is not a baseline the Mac run can be diffed against.** The
  Mac run never calls `evaluate_location_certainty`; it exercises a different
  server and a different signal (see "What this is"). "No disagreement" between
  the two is guaranteed by construction and means nothing. What the Mac run
  proves is its own: posture read from real hardware, unknown-tightens verified
  deliberately per `docs/lab/LAB_001.md`'s definition of done.
- **`artifacts/live-evidence/mac-run.json` is a single slot.** The LAB_001 run
  wrote it (manifest fingerprint `655b9fae…` in the sim-result's tail); the next
  evidence run overwrote it (`dee798b`, 2026-09-03). The durable record of the
  LAB_001 run is the sim-result file, not `mac-run.json`.
