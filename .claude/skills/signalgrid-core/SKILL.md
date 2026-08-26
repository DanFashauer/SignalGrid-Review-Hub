---
name: signalgrid-core
description: The decision-fabric builder for SignalGrid. Use for work on lib/*, the /v1 API and control plane, proofs and gates, connectors, and the signalgrid-app web console. Covers what this role owns, what it must never touch, how to add a proof or connector so it cannot end up ungated, and the scope freeze in force.
---

# SignalGrid — Core

You build the decision fabric. Inherits the base `signalgrid` skill; read it first.

## You own

```
lib/**                          decision core, connectors, flows, audit, auth
artifacts/api-server/**         /v1 decision API + control plane
artifacts/signalgrid-app/**     the operator console
artifacts/signalgrid-review/**  the public review dashboard
artifacts/signalgrid-web/**     the marketing site
scripts/src/*-proof.ts          proof harnesses
scripts/check-*.mjs             gates
```

**The two web trees were added 2026-08-24, and the reasoning is worth keeping
because two other skills were considered first and both were wrong.**

Nothing claimed them. `web-engineer`, whose charter LEADS with the marketing
site, and `accessibility-specialist`, whose charter is "the site and the served
consoles", had both been pointed at skills that exclude their own subject —
found when the executor field was added and each pointer was checked against the
scope it claimed.

`signalgrid-scribe` was the obvious candidate and is disqualified by its own
words: *"You touch no source."* It owns `docs/**` and `README.md`. These trees
are React source, and widening scribe past its stated boundary would be the same
over-generalisation this repo keeps finding.

A NEW web skill was considered and rejected. It would have been a label with
nothing behind it: `CLAUDE.md`'s four accessibility rules are entirely iOS —
`UIFont`, `UIFontMetrics`, `accessibility-extra-large`, the `SG` tokens — and
there is no written web a11y or brand doctrine anywhere in the tree to put in
one. A skill that exists to hold doctrine that does not exist is a role nobody
runs, one level up, which is the exact defect the roster gate was built for.

So they land here, where they actually fit: all three are Vite/React apps on one
toolchain, and this skill already owns a served console of the same magnitude
(98 files against 97 and 86).

WHAT THIS DOES NOT SOLVE, stated rather than smoothed. Claim-truth on these
trees is already mechanical — `check-launch-claims` and `check-retention-claims`
read them and need no skill to fire. CRAFT is not: `check-decision-palette` is
the only gate covering contrast and palette parity, and no prose anywhere tells
a web author what good looks like. `accessibility-specialist` and `brand-design`
therefore stay on `lane` deliberately. The fix for them is to WRITE the doctrine
when someone does that work, not to pre-create a skill to hold the absence.

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

## API, MCP, and endpoint evidence tooling

When this role is acting as `api-contract-architect`, `endpoint-uem-domain`, or
otherwise changing API/MCP/source-verification behavior, also read
`.claude/skills/signalgrid-evidence-toolchain/SKILL.md` and
`docs/agent/EVIDENCE_TOOLCHAIN_OWNERSHIP.md`.

Keep the proof layers distinct:

- **Bruno** is the curated, Git-reviewed API contract/wire suite.
- **Schemathesis** generates adversarial OpenAPI cases; a real defect it finds
  becomes a stable regression rather than remaining a one-off fuzz result.
- **oasdiff** makes base-versus-head breaking API changes visible before release.
- **Prism** provides spec-driven mocks/validation; mock success is not live-wire proof.
- **Hurl** is reserved for compact shell-friendly HTTP regressions and must not
  become a second canonical API suite.
- **MCP Inspector** is the independent MCP protocol/tool-surface check; repository
  MCP tests remain first-party regression coverage.
- **Fleet MCP** is a least-privilege and mutation-boundary design reference, not
  permission to copy its implementation.

Adding one of these tools is engineering proof infrastructure, not a connector-family
or launch-profile change. Installation/deployment/CI-required promotion follows the
open-source lab registry and licence rules in the evidence-toolchain skill.

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
