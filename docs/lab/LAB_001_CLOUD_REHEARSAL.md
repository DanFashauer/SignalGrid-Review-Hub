# LAB 001 — cloud rehearsal of Step 1's verification protocol

**Date: 2026-08-31. Lane: cloud sandbox. Status: protocol PROVEN over the real
wire; real-hardware evidence NOT minted — that is the Mac's half, by design.**

## What this is, and is not

LAB_001 Step 1's product moment — the core deciding on the MacBook's real
posture — can only happen on the Mac (`docs/lab/LAB_001.md`). But the
verification protocol the owner named as the check not to skip — *"force an
unreadable probe and confirm unknown raises assurance rather than lowering
it"* — is testable against the first-party MCP server's real stdio wire, and
the owner directed that the simulator carry the tasks a container can carry.
This record is that rehearsal: the same server, the same JSON-RPC wire, the
same tool the Mac run will use, driven with a healthy baseline and four
forced-unknown probes.

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

`artifacts/sim-requests/2026-08-31-lab001-step1-real-posture.json` asks the
Mac lane to run the real half: `verify:all --require-mcp --emit-evidence`
against `signalgrid-mcp` reading the MacBook's actual posture, minting
`artifacts/live-evidence/mac-run.json`. When that lands, LAB_001 Step 1 is
done for real, and this rehearsal is its known-good wire baseline: if the
Mac's run disagrees with a row above, the disagreement is the finding.
