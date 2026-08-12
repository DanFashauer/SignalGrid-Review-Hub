# Simulation results — what a machine actually ran

Answers to the requests in [`../sim-requests`](../sim-requests). Written by
`pnpm run sim:run-requests` on the machine that can honestly execute them, and
committed so the other lane can read them. One file per request id.

Nothing in this directory is authored by hand. The whole point is that a result
is a *record of an execution*, so a hand-written one would be the fabrication the
loop exists to make impossible.

## What a result carries

- **`runs[]`** — one row per operation the request asked for: `passed`, `failed`,
  `refused_platform`, `refused_missing_prerequisite`, or `skipped_by_operator`,
  with the exit code, duration, and the tail of the output.
- **`provenance`** — platform, arch, Node version, macOS version, commit, branch,
  and whether the working tree was clean. *"The proofs passed"* means nothing
  without *"on what, at which commit"*, and a result minted from a dirty tree
  cannot be reproduced from the commit it names.

## Two rules worth knowing before reading one

**Only `passed` and `failed` mean the work happened.** A refusal is an honest
record that something was *attempted* and could not be done on that machine — it
closes nothing out. `node scripts/check-sim-requests.mjs` keeps reporting the
operation as pending until a machine that can run it does. This rule exists
because it was once missing: an all-refused result on Linux closed out a request
the Mac had never touched.

**An unrun operation is never green.** Absence is reported on every gate run,
including an operation missing from a result that otherwise completed. Pending
never fails the build — CI has no Mac, and blocking on hardware CI cannot reach
would be the same dishonesty running the other way.

See [`docs/LIVE_SYNC_LOOP.md`](../../docs/LIVE_SYNC_LOOP.md) for the full loop.
