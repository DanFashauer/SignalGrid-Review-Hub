---
description: Repeatable build-fix pass — reproduce the failing check, fix it with a minimal diff via the build-error-resolver agent, then prove it green by re-running the same check. Never bypasses a gate.
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

**2. Delegate the fix to the `build-error-resolver` agent**, with a hard constraint:
fix the error only. No refactor, no architecture change, no new dependency. Smallest
diff that makes the check pass. Changed a package's deps? Regenerate the lockfile
(`pnpm install --lockfile-only`) and commit it — never hand-edit `pnpm-lock.yaml`.

**3. STOP if the fix would touch a golden-rule surface** — a decision path
(`lib/signalgrid-core`, `lib/signalgrid-simulator`) or
`native/ios/EnterpriseShell/Services/DecisionEngine.swift` / `AppWorkflows.swift`.
Those are byte-faithful / determinism surfaces, not build-fix scope; report instead.

**4. Prove it green.** Re-run the SAME check from step 1 and quote the passing
output, then run `node scripts/preflight.mjs` to confirm nothing else broke.

**Never** `--no-verify`, never stash-to-dodge, never a quiet flag, never `git push
--no-verify` to get past the lockfile pre-push hook. A red gate is fixed at its
cause or reported — never silenced.

**Failure mode this guards:** the "fix" that makes the command exit 0 without the
underlying build actually passing — a silenced check reads as green and ships the
break. Done = the exact command that failed now passes, quoted.
