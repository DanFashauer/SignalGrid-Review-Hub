---
description: Repeatable refactor pass — the refactor-cleaner agent plus the ponytail minimalism lens on a target, with review:invariants and preflight kept green and one runnable check left behind. Deletion over addition, behavior unchanged.
argument-hint: [the file, module, or smell to refactor]
---

Run the SignalGrid refactor pass.

<target>
$ARGUMENTS
</target>

**0. Understand before cutting.** Trace the real flow end to end and grep every
caller of what you will touch. A smaller diff in the wrong place is a second bug,
not a refactor.

**1. Two lenses, together:**

- **refactor-cleaner** — dead code, duplication, consolidation (runs
  knip / ts-prune-style analysis where available); removes safely.
- **ponytail (ultra)** — the minimalism ladder: does it need to exist, is it
  already in this codebase, does stdlib / a native feature / an already-installed
  dep cover it, can it be one line. Deletion over addition.

**2. The golden rules bind hardest here.** Never change
`native/ios/EnterpriseShell/Services/DecisionEngine.swift` or `AppWorkflows.swift`
for behavior — they are byte-faithful ports and parity is the point. No
`Date.now()` / `Math.random()` / I/O in a decision path. Every decision, gating or
planner `switch` keeps its `default:`. Unknown raises assurance; it never lowers it.

**3. Prove behavior is unchanged.** `pnpm run typecheck`,
`pnpm run review:invariants`, and `node scripts/preflight.mjs` all green (quote
them); `test:api` N/N if the api-server moved. Leave ONE runnable check that fails
if the refactored logic breaks — an assert-based self-check or one small test — per
the repo's own rule; a trivial one-liner needs none.

**Failure mode this guards:** a "cleanup" that quietly changes behavior, or that
shrinks the diff by moving the bug. A refactor that cannot show behavior is
identical is not done.
