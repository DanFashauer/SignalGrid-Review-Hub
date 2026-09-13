---
description: Repeatable refactor pass over the decision fabric (lib/) — refactor-cleaner plus the ponytail lens, dead code found with the repo's OWN tools (no npx), behavior proven unchanged by typecheck + review:invariants + preflight + verify:breadth, one check left behind.
argument-hint: [a file, module, or smell UNDER lib/ to refactor]
---

Run the SignalGrid refactor pass.

<target>
$ARGUMENTS
</target>

**Scope: `lib/` only.** The **refactor-cleaner** agent's writeScope is `lib/` (the
decision fabric). If `<target>` is outside `lib/` (artifacts, scripts, native,
docs), this pass does not apply — route it to the agent that owns that surface
(`docs/agent/agent-tiers.json`) or, for a decision path / Swift twin, escalate.
Do not have refactor-cleaner edit across its boundary.

**0. Understand before cutting.** Trace the real flow end to end and grep every
caller of what you will touch. A smaller diff in the wrong place is a second bug.

**1. Two lenses, together:**

- **refactor-cleaner** — behavior-preserving cleanup. Find dead code with the
  repo's OWN tools, NOT `npx knip` / `depcheck` / `ts-prune` (none is installed;
  its charter forbids adding them ad hoc): `pnpm run typecheck`, the reachability
  gate `node scripts/check-package-reachability.mjs`, and `git grep` for consumers.
- **ponytail (ultra)** — the minimalism ladder: does it need to exist, is it
  already in this codebase, does stdlib / a native feature / an already-installed
  dep cover it, can it be one line. Deletion over addition.

**2. The golden rules bind hardest here.** Never change
`native/ios/EnterpriseShell/Services/DecisionEngine.swift` or `AppWorkflows.swift`
for behavior — byte-faithful ports, parity is the point (and they are outside
`lib/` anyway). No `Date.now()` / `Math.random()` / I/O in a decision path. Every
decision, gating or planner `switch` keeps its `default:`. Unknown raises assurance.

**3. Prove behavior is unchanged.** `pnpm run typecheck`,
`pnpm run review:invariants`, `node scripts/preflight.mjs`, AND
`pnpm run verify:breadth` all green (quote them) — verify:breadth is REQUIRED here
because the deferred-family proofs (NAC, webhooks, device-attestation, credential
exposure, …) live only there, not in preflight, so a `lib/` change can pass every
preflight gate while its own proof goes unrun. `test:api` N/N if a served surface
moved. Leave ONE runnable check that fails if the refactored logic breaks — prefer an
assert-based self-check or small test co-located in `lib/`, which is inside
refactor-cleaner's writeScope. If the only adequate check is a `proof:*` under
`scripts/`, do NOT have refactor-cleaner write it (its writeScope is `lib/`) —
dispatch **gate-and-proof-engineer** to add it, or identify and name an existing
runnable check that already covers the refactored behavior. A trivial one-liner
needs none.

**Failure mode this guards:** a "cleanup" that quietly changes behavior; one that
shrinks the diff by moving the bug; a refactor-cleaner edit outside `lib/`; an
`npx`-downloaded analysis tool the charter forbids; and a "behavior unchanged"
claim that never ran the affected breadth proof.
