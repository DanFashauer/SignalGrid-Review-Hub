# The build feedback loop — how this product gets built

Every change to SignalGrid ships through the same loop, whether a human or an
agent is doing the building. The loop is not advice; it is encoded as a runnable
harness (`scripts/build-loop.mjs`) plus the standing gates, so following it is
the path of least resistance and skipping it is visible.

## The loop

```
        ┌────────────────────────────────────────────────────────┐
        ▼                                                        │
  1. BUILD the change                                            │
  2. VERIFY with the same gates CI runs      node scripts/build-loop.mjs
  3. IDENTIFY issues → structured findings   (each with its exact fix path)
  4. FIX — mechanical fixes auto-apply (--fix); behavior fixes by hand
  5. RE-VERIFY — nothing counts as fixed until the re-run is green ──┘
  6. ADVERSARIAL REVIEW — a second agent tries to break the diff
  7. FIX FORWARD anything the review finds (back to 2)
  8. COMMIT + PUSH — only from a green loop
  9. WATCH CI — webhook events (reviews, CodeQL, build failures) re-enter at 3
```

Steps 2–5 are `scripts/build-loop.mjs`. Steps 6–9 are process, enforced by
review discipline and CI; their outcomes (a review finding, a red check, a bot
comment) re-enter the loop as new findings rather than being handled ad hoc.

## Running it

```bash
node scripts/build-loop.mjs          # one iteration: gates → findings + fix list
node scripts/build-loop.mjs --fix    # also apply allowlisted mechanical fixes, re-run to convergence
node scripts/build-loop.mjs --full   # include the heavy preflight (all proofs + builds + E2E)
```

Every iteration appends to `artifacts/build-loop/history.jsonl` (gitignored
evidence), so a "the loop converged" claim is backed by the recorded
iterations, not asserted.

## What the loop may fix itself — and what it must not

The `--fix` allowlist contains **pure regeneration of derived state only**
(today: the live-sync manifest and the Postman collection — both deterministic
functions of committed sources). This is the same governed principle as
self-audit heals and IaC rollouts: **the loop cannot approve itself into a
behavior change.** A failing invariant, type error, proof, or doc claim is
reported with a fix instruction and left for a human/agent to fix consciously —
then proven by a green re-run.

## Honesty rules

- The loop shells out to the SAME gate commands CI runs. It re-implements
  nothing, so it cannot drift from CI.
- A gate that was asked to run but could not spawn is a **failure**, not a skip.
- Skipped gates (e.g. preflight without `--full`) are printed as *not run* —
  the report never claims what it didn't execute.
- Iterations are bounded (max 5) — the loop converges or stops and says so.

## The adversarial-review half (step 6)

The mechanical gates cannot catch a plausible-but-wrong design. Every
substantive diff gets a second, independent review whose instruction is to
BREAK it — concrete failing inputs, not style notes. Review verdicts land as
findings: a confirmed defect is fixed forward (a new commit, so the catch is
visible in history) and re-verified through the loop before push. This has
caught real defects this repo shipped fixes for — a duplicate-id mask in
self-audit, a figure false-positive in reliability, missing observed-side
validation in IaC drift, and a rate-limiter double-count on badge readers —
each one found by review, fixed forward, and re-proven.

## Where this fits with the other self-* systems

| System | Question it answers |
| --- | --- |
| `build-loop` (this) | *Is the change I'm making right now verified, and what exactly do I fix if not?* |
| `self-audit` | *Is the whole system healthy across backend/frontend/API layers?* |
| `reliability` | *Is the decision plane meeting its SLOs over time?* |
| `iac` | *Does the fleet match what Git declares, and are rollouts governed?* |

The build loop is the innermost cycle; its green state is what the outer three
measure and protect.
