# Self-review — a second reviewer before every push

SignalGrid catches defects with a layered check-and-balance so that a change is
**proven correct before it is pushed**, not after. Codex reviews the PR *after*
the push; these two layers run *before* it, so the first version is the right
version and Codex has less to find.

## The two layers

### 1. Mechanical — `pnpm run preflight`
Runs the **entire CI gate suite locally** in one command (typecheck, build,
every proof, the API integration test, the safety gate, Postman/spec sync, and
the invariant reviewer below). A green preflight means CI will be green.

```
pnpm run preflight          # full suite — what CI runs
pnpm run preflight --quick  # skip the heavy web/app builds for a fast loop
```

It stops at the first failing gate and prints the failing output, so there is no
guessing about what broke.

### 2. Adversarial — the invariant reviewer + an agent read
`pnpm run review:invariants` is a deterministic, dependency-free "second
reviewer" that encodes the classes of defect this repo's reviews keep catching,
so they fail the build instead of shipping:

| Invariant | What it enforces | Lesson it encodes |
|---|---|---|
| **Fail-closed control flow** | every `switch` in the decision / gating / planner libs has a `default:` arm | Codex #70 — an unrecognized outcome fell through to *allow* |
| **Determinism** | no `Date.now` / `Math.random` in the pure planner libs | the decision core must be replayable from fixtures |
| **Assist invariant** | no app-workflow action is `critical` yet non-sensitive | a high-consequence action must always require confirmation |
| **Truth guard** | an extensible denylist of internal over-claims that contradicted the code | Codex #79 — "every catalog gates live" when one vertical is catalog-only |
| **Public-safe web** | no third-party vendor host (fonts / analytics / CDN) in a published web artifact | Codex #81 — the marketing site loaded fonts from a Google CDN |

The invariant reviewer is a *floor*, not a ceiling. For anything non-trivial,
also do an **adversarial agent review of the diff before pushing** — read the
change as a skeptic trying to break it, with these questions:

- **Fail closed?** Does every unrecognized / missing / conflicting input degrade
  to the *most restrictive* outcome? Is there any path where a sensitive action
  runs without confirmation?
- **Truthful?** Does every comment, doc, and UI label match what the code
  actually does? No "every / all / always" that the code doesn't guarantee; no
  past-tense "done" wording for something that is only *proposed* or *simulated*.
- **Public-safe?** No secrets, PHI/PII, real vendor/product names, or live
  vendor calls. Fixtures are deterministic.
- **Boundary honest?** Is the approval / simulation / step-up boundary visible
  and un-bypassable? The product API never releases a held action from a
  request-supplied signal.
- **Proven?** Is there a passing proof/test that exercises the new behavior end
  to end — including the failure and fail-closed paths, not just the happy path?

## The checklist before opening a PR

1. `pnpm run preflight` is green (or `--quick` during the loop, full before push).
2. The change has a proof/test that covers its **failure** paths, not just success.
3. An adversarial read of the diff against the questions above found nothing.
4. Docs / comments / labels updated to stay true to the code.
5. One reviewable concern per PR.

When all five hold, push. Codex becomes a confirmation, not a rework loop.
