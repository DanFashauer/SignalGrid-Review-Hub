# Self-audit — a self-aware, self-healing checklist

> **Canonical source:** [Issue #136 — portable work context and adaptive Grid
> Intelligence](https://github.com/DanFashauer/SignalGrid-Review-Hub/issues/136).
> This is the operational-trust side of the adaptive loop turned on the fabric
> ITSELF: the same "propose, never mutate" governance that
> [`docs/ADAPTIVE_PROPOSALS.md`](./ADAPTIVE_PROPOSALS.md) applies to a policy
> change, applied to the health of the solution's own backend, frontend, and API
> integrations.

`@workspace/self-audit` (`lib/self-audit/src/`) is a deterministic, fixture-backed
engine that answers three questions about the whole stack, honestly:

1. **What should be true?** — a checklist, DERIVED from the machine-readable
   contract inventory the repo already keeps (the live-sync manifest).
2. **Is it true right now?** — each item resolved from an injected probe result,
   **fail-closed**: a missing or malformed probe is `unknown`, and `unknown` is
   never `healthy`.
3. **What do we do about what isn't?** — a **governed** heal proposal per broken
   item, which **cannot apply itself**.

It implements nothing live: no route, no vendor call, no production remediation.
It is a pure decision layer with a machine-checked proof.

## Self-aware: a blind spot is a finding, not a green check

The dangerous failure of any checklist is the item nobody wrote. A new signal
kind, connector, or route ships, no check covers it, and every run still reports
green over a thing it never looked at.

`deriveChecklist` closes that by cross-checking the declared items against the
manifest's contract dimensions and **synthesizing a `meta` coverage-gap finding
for every dimension no item covers**. The checklist reports the boundaries of its
own coverage. A gap is `broken`, never silence.

```
deriveChecklist(declaredItems, { dimensions: [...manifest dimensions] })
  → declared items + one coverage-gap item per uncovered dimension
```

## Fail-closed: healthy must be earned

`runAudit(checklist, probeResults)` resolves each item's `probeKey` against the
supplied results and aggregates **worst-status-wins**. The status ladder, worst
last: `healthy < drifted < unknown < broken`. `unknown` outranks `drifted` on
purpose — an unmonitored item can hide an outright break, so *not knowing* is
treated as worse than a *known* partial degrade. A probe that is absent, malformed,
or returns an unrecognized status resolves to `unknown`; nothing is ever coerced
toward `healthy`.

## Self-healing, governed: a heal cannot heal itself

`proposeHeals(report)` emits one `proposed` `HealProposal` per `broken`/`drifted`
item that is `healable`. A proposal is **description-only data** — it names the item
and states the remediation as prose; it carries no executable payload and enacts
nothing. A broken item that is not `healable` (a policy decision, not a mechanical
fix) is reported but proposes nothing — the engine never fabricates a fix it cannot
describe safely.

Applying a heal is a governed act with the **same human gate** as
`@workspace/adaptive-proposals`:

```
proposed ──approveHeal(ref)──▶ approved ──applyHeal()──▶ applied
   │                              │
   └──────── rejectHeal() ────────┴──▶ rejected
```

There is **no `proposed → applied` edge**. `approveHeal` refuses a blank approver
ref, and `applyHeal` re-checks the ref a second time so that even a hand-forged
`approved` proposal with an emptied ref cannot reach `applied`. Applying is a state
transition on the record — it registers that a human approved a described fix; it
never runs one. Enacting the remediation belongs to the system of record the item
names, under the same governance.

## The proof

`pnpm run proof:self-audit` (56 checks) proves every invariant above over a
representative four-layer checklist, and prints its live figures so a stale quote is
catchable:

```
figures=layers=4,declaredItems=4,coverageGaps=1,healStatuses=4,pairsToApplied=4,legalRoutesToApplied=1,defaultItems=7
```

The load-bearing assertions:

- **Fail-closed** — an omitted probe (and a malformed one, and an unrecognized
  status string) each resolve to `unknown`, and overall health is `unknown` rather
  than `healthy` whenever any item is unprobed.
- **Self-aware** — exactly one coverage-gap item is synthesized for the one
  deliberately-uncovered manifest dimension; a covered dimension produces none.
- **Descriptive, never permissive** — a heal proposal carries only data (no
  function-valued field), and `proposeHeals` marks nothing applied; a non-healable
  broken item proposes no heal.
- **No self-heal** — an exhaustive sweep of all sixteen `(from, to)` status pairs
  confirms **exactly one** legal route to `applied` (`approved → applied` carrying a
  non-empty approver ref); a blank ref is refused at both approve and apply.
- **Deterministic + immutable** — identical input yields byte-identical output,
  every returned value is deep-frozen, and an input proposal is never mutated across
  a transition.

Run it directly:

```bash
cd scripts && npx tsx ./src/self-audit-proof.ts    # proof:self-audit (56 checks)
```

## Running it for real

The engine is pure and the demo route serves a fixture, but the audit runs against
REAL gate results too:

```bash
pnpm run self-audit:run           # runs the mapped proofs, prints plain-language health
pnpm run self-audit:run --full    # also runs the heavy browser-screen check
pnpm run self-audit:run --json    # machine output (plain + report + proposed heals)
```

`scripts/src/self-audit-run.ts` maps each checklist item's probe key to the actual
gate/proof command that answers it (`proof:api-contract`, `proof:posture-composition`,
`proof:grant-safety` for connector fail-closedness, `proof:task-exception`,
`proof:handoff-sim`, `proof:work-context`, and the browser E2E under `--full`), runs
them, and feeds the outcomes into the SAME engine and plain-language layer the admin
screen uses. So the words an owner reads are backed by proofs that actually ran. It is
fail-closed to the letter: a heavy check skipped without `--full`, or a probe with no
command mapping, resolves to *Not checked* (never *Working*), and coverage is measured
against the committed live-sync manifest so a contract dimension no item covers surfaces
as its own attention line. The command exits non-zero unless everything is clear, so it
can gate a pipeline.

## Public-safety boundaries

- No live checks here — probes are injected; a real probe runner (a CI job, the
  `status-summary` script) supplies results. This package only decides.
- A heal proposal is never authorization and never a command. It is a described fix
  an owner approves; execution stays with the system of record under governance.
- Deterministic and fixture-backed: no `Date.now`/`Math.random`, no network, no
  secrets, no live tenant identifiers.
