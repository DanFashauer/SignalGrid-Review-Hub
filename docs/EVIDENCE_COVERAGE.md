# Evidence coverage — what a deployment can actually tell us

> The first-conversation instrument. It reads no customer data, no CSV and no
> connector — there is nothing to hand over — and it **cannot flatter the product**,
> because its entire output is the size of the gap.

Modeled in `@workspace/flows` (`lib/flows/src/evidence-coverage.ts`); proven by
`pnpm run proof:evidence-coverage` (25 checks). Two surfaces render it, both from the
same function: `GET /cp/v1/grid/evidence-coverage` and the **Evidence Coverage**
section of the review console (`artifacts/signalgrid-review`).

## Why this exists — the artifact it replaced

The obvious design-partner artifact is a **replay backtest**: take a prospect's
existing exports, run them through the decision engine, and show what SignalGrid
would have decided. An adversarial review killed it before it was built, and the
reason is worth keeping written down.

The active v1 rule set is deliberately **day-one quiet** on several evidence axes. An
unknown baseline, an unverified benchmark selection, an unverified shift context, an
unknown badge binding and an unknown dock state all still grade `allow`, and
`lib/signalgrid-core/src/seed.ts` pins each of those as expected with the comment
"no fabricated block". That is *right* for a live tenant whose connectors are still
being deployed — you do not block a fleet because an integration is pending.

It is catastrophic as the engine behind a backtest. In a replay of a customer's
existing exports those axes are absent for **every row by construction**, because the
data plane that would fill them does not exist in that customer's estate yet. The
engine emits a clean grant at scale, and the grant came from *absence of data* — on
the one product whose whole claim is that it refuses to convert silence into a pass.
A prospect's security reviewer who traces a single row finds exactly that.

So the honest artifact is not "here is what we would have decided". It is:

> **"Here is what your systems can and cannot tell us, and here is the question each
> missing one would have answered."**

## The model

- **Source planes** — coarse, deliberately. "Do you have a workforce-management
  system we could read?" is answerable in a meeting; "which WFM, at what version,
  with which API scopes" is not. Each plane carries the question that establishes it
  (`SOURCE_PLANE_PROMPTS`), so the surface asks in the operator's words rather than
  showing them our schema keys.
- **Evidence axes** — one per field of `DecisionEvidence`, each with the question it
  answers in a sentence a non-engineer can act on, and an **explicit allowlist** of
  planes that can supply it. An axis with an empty list is answerable by nothing a
  deployment could plausibly have — a legitimate answer, and the reason the row is
  shown rather than quietly omitted.
- **`dayOneQuiet`** — true when the active rule set still grants on the axis's
  *ignorance* member. Not an opinion: each `true` corresponds to a policy test in
  `seed.ts`, and the proof asserts the flag and the rule set stay in step rather than
  trusting the comment.
- **Silent holes** — the headline. An axis that is *both* unanswerable by this
  deployment *and* day-one quiet: the engine grants, no operator sees a finding, and
  a naive backtest reads it as health. These rank first in every surface.

### The two properties that keep it honest

**Fail-closed by construction.** An axis is `answerable` only when a plane that
supplies it was *explicitly declared*. No inference, no "they probably have that", no
default plane. An unrecognised plane can never raise coverage — asserted directly by
the proof rather than left to review.

**It cannot flatter.** Every number gets worse as the estate gets thinner, and the
figure it leads with counts holes rather than coverage. Declare nothing and most of the
axis table is dark, and most of *that* is dark silently. That is the honest opening
position. Note that the silent holes are a **subset** of the dark axes, not a fourth
bucket — only `answerable + needsInstrumentation + notSourced` partitions the table,
and every surface states that denominator rather than leaving a reader to add four
numbers that were never meant to sum.

## Using it

The control-plane arm takes the declared planes as a query parameter and refuses an
unrecognised one with a 400 that **names the valid planes** — a refusal that does not
say what would have worked is a dead end, not a control:

```bash
# every route is mounted under /api; ?planes= also accepts the repeated form
curl 'http://localhost:8080/api/cp/v1/grid/evidence-coverage?planes=identity,device_management'
```

The review console renders the same report interactively: tick the planes a
deployment really has and the table re-sorts, silent holes first, each naming what
would answer it. It calls `buildCoverageReport` **in the browser** — the same function
the route calls — so neither surface holds a transcribed copy of the other's numbers.
That is not a guarantee they always agree: the console is a static build that inlines
`lib/flows` at build time, so one deployed from an older commit than the api-server can
disagree with it. The browser E2E asserts the two agree — totals *and* per-axis
coverage — for the build under test, which is the part a gate can hold.

One thing the page does **not** compute: `dayOneQuiet`. Every "silent hole" it shows
comes from that flag on the axis table, verified against the shipped rule set offline by
the proof. The page says so, because its neighbours in that console really do run the
decision core in the browser and a reader would otherwise reasonably assume this one
did too.

## The boundary

This is a *coverage* report, not a *decision* report. It says which questions a
deployment can answer, and says nothing about what the answers would be — that needs
real data from a real tenant, which lives behind the publication boundary
([`IP_AND_LICENSING.md`](IP_AND_LICENSING.md),
[`PILOT_READINESS_CRITERIA.md`](PILOT_READINESS_CRITERIA.md)). It also holds no
per-axis confidence: the model carries no per-axis collection method, so it reports
none rather than inventing one a reader would take as measured.
