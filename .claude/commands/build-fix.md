---
description: Repeatable build-fix pass — reproduce the failing check, route the fix to the agent that OWNS the failing surface (never past its boundary), then prove it green by re-running the same check. Never bypasses a gate.
argument-hint: [optional: which check is failing (typecheck | preflight | test:api | harness), or paste the error]
---

Run the SignalGrid build-fix pass on the failing build or gate.

<target>
$ARGUMENTS
</target>

**1. Reproduce first, from output — never from memory.** Run the exact failing
check and quote its real output before touching anything. If `<target>` names the
check, run that; otherwise run `pnpm run typecheck` then `node scripts/preflight.mjs`
to locate the break.

- types: `pnpm run typecheck`
- every per-push gate: `node scripts/preflight.mjs`
- the /v1 API surface: `pnpm --filter @workspace/api-server run test:api` (compare N/N)
- proofs + web build (macOS only): `./validate-sim-macos.sh` (read the SUMMARY line: M against 0 AND S — a skip is not a pass)

**2. Route the fix by the FAILING SURFACE — each writer has a boundary
(`docs/agent/agent-tiers.json`); never make one edit outside it.** Read which files
the failure is in, then:

- `artifacts/` (api-server, web) → **build-error-resolver** (its writeScope is
  `artifacts/`).
- `scripts/src/e2e/` → **e2e-runner** (that subtree is carved OUT of
  gate-and-proof-engineer and assigned to e2e-runner in agent-tiers.json).
- the rest of `scripts/` or a gate/proof → **gate-and-proof-engineer**.
- `lib/signalgrid-core` / `lib/signalgrid-simulator` (a decision path) or
  `native/ios/.../DecisionEngine.swift` / `AppWorkflows.swift` → **STOP and
  escalate.** Those are golden-rule surfaces (determinism, byte-faithful ports),
  not build-fix scope.
- other `lib/*` → the owning library writer; if unclear, escalate rather than
  cross a boundary.

Whichever agent you route to: fix the error ONLY — no refactor, no architecture
change, no new dependency, smallest diff. Changed a package's deps? Regenerate the
lockfile (`pnpm install --lockfile-only`) and commit it; never hand-edit
`pnpm-lock.yaml`.

**3. Prove it green.** Re-run the SAME check from step 1 and quote the passing
output, then run `node scripts/preflight.mjs` to confirm nothing else broke.

**Never** `--no-verify`, never stash-to-dodge, never a quiet flag, never push past
the lockfile pre-push hook. A red gate is fixed at its cause (by the surface's
owner) or reported — never silenced, never fixed across a boundary.

**Failure mode this guards:** the "fix" that makes the command exit 0 without the
underlying build actually passing, and the fix that makes one agent edit a surface
it does not own. Done = the exact command that failed now passes, quoted, changed
only by the surface's owner.
