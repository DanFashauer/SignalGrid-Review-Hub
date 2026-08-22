---
name: signalgrid-core
description: The decision-fabric builder for SignalGrid. Use for work on lib/*, the /v1 API and control plane, proofs and gates, connectors, and the signalgrid-app web console. Covers what this role owns, what it must never touch, how to add a proof or connector so it cannot end up ungated, and the scope freeze in force.
---

# SignalGrid — Core

You build the decision fabric. Inherits the base `signalgrid` skill; read it first.

## You own

```
lib/**                        decision core, connectors, flows, audit, auth
artifacts/api-server/**       /v1 decision API + control plane
artifacts/signalgrid-app/**   the operator console
scripts/src/*-proof.ts        proof harnesses
scripts/check-*.mjs           gates
```

## You never touch

`native/**`, `firmware/**`, `validate-sim-macos.sh` — Native owns those.
Docs prose — Scribe owns that. You may update a code comment; you may not
rewrite `docs/`.

## Shared surfaces — check first, announce in the commit

`scripts/preflight.mjs` · `.github/workflows/review-hub-ci.yml` ·
`scripts/mutation-guard.mjs` · `scripts/check-connector-discipline.mjs` ·
`artifacts/sync/live-sync-manifest.json` · `lib/integrations/package.json` ·
`package.json` / `pnpm-lock.yaml`

If another lane has recent or uncommitted changes there, stop and hand back.

## The rules that bind this role hardest

- **Deterministic.** No `Date.now()`, no `Math.random()`, no I/O in a decision
  path. `pnpm run review:invariants` enforces it — keep it green.
- **Fail-closed.** Every `switch` in a decision/gating/planner lib gets a
  `default:`. An unknown signal raises assurance; it never lowers it.
- **Read-only first.** A new connector is read-only and fixture-backed unless
  the task explicitly says otherwise and gives you a safe context.
- **Approval gates are explicit.** No default path may bypass one.

## Adding a proof — all six steps, or it is ungated

1. `scripts/src/<name>-proof.ts`
2. Register `proof:<name>` in `package.json`
3. Register in **both** `scripts/preflight.mjs` and `review-hub-ci.yml`
   (`guard:ci-sync` fails otherwise — a gate that runs only locally is not a gate)
4. Enumerates an allow path (`enumerateGrantSafety`)? Register with the mutation guard
5. Prints a `figures=` line? Register with the figure guard
6. Give it `--self-test` so the gate can be seen to fail

## Adding a connector

One signal domain. Read-only. Unknown maps to unknown — never to a negative
posture. Then `node scripts/check-connector-discipline.mjs`.

## Before you hand to the reviewer

```bash
pnpm run typecheck
pnpm run review:invariants
pnpm run preflight
pnpm --filter @workspace/api-server run test:api    # if you touched the API
```

Changed deps? `pnpm install --lockfile-only` and commit the lockfile. On macOS,
restore manifests **first**, regenerate **after** — the other order re-diverges it.

Note plainly which CI jobs you could not run locally: `durable-persistence`
(Postgres), `deploy-stack` (Docker), `secret-scan` (gitleaks).

## Scope freeze — in force until there is a paying design partner

No new verticals. No new connectors beyond the five in the product design. No
new proofs written for their own sake. If a task asks for one, escalate rather
than build it.
