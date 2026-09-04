# Reliability — SLOs and error budgets for the decision plane

> **Origin:** the SRE discipline (*"the goal is not zero failures; the goal is fast
> recovery and continuous improvement"*), applied to SignalGrid itself. This is the
> operational-reliability companion to [`docs/SELF_AUDIT.md`](./SELF_AUDIT.md): the
> self-audit answers *is the system working right now*, and this answers *is it
> meeting its reliability objectives over time, and how much budget is left*.

`@workspace/reliability` (`lib/reliability/src/`) turns a window of decision outcomes
into service-level indicators (SLIs), compares them to objectives (SLOs), and reports
the remaining **error budget** in plain language. It is pure, deterministic, and
fixture-backed — SLIs are computed from supplied records, never a clock.

## Measure what matters — three SLOs

| SLO | What it measures | Objective | Budget? |
| --- | --- | --- | --- |
| **Decision availability** | Fraction of evaluations that return a valid verdict (not an error/timeout) | 99.9% | yes |
| **Decision latency** | Fraction of decisions that return under the latency target (50 ms) | 99% | yes |
| **Fail-closed integrity** | Fraction of decisions that did **not** grant on an unknown/unreachable signal | 100% | **no — zero-tolerance** |

## The SignalGrid twist: a fail-closed violation has no budget

Error budgets exist so reliability and velocity can be balanced — some slow decisions,
some transient errors, are acceptable, and the budget says how many before you should
stop shipping risk. That logic applies to **latency** and **availability**.

It does **not** apply to fail-closed integrity. A decision that *granted access on a
signal it could not verify* is the one thing the fabric exists to prevent, so it is
modeled as a **zero-tolerance** SLO with a zero error budget: a single occurrence
exhausts it, at any window size — a million clean decisions do not buy back one
fail-open. Reliability you could purchase at the cost of the core promise would be no
reliability at all. The proof sweeps window sizes from 1 to 100,000 and confirms a
fail-open breach is **never** reported as healthy or at-risk.

## Fail-safe on no data

An empty (or too-small) window for a measurable SLO is **`unknown`**, never `healthy`
— not knowing your reliability is not "fine", the same instinct the fabric uses
everywhere. `unknown` outranks `at_risk` in worst-status-wins. (A zero-tolerance SLO
with no data is `healthy`: the absence of a breach is a true statement, unlike the
absence of latency data.)

## Plain language for the owner

`summarizeReliability` turns the report into sentences: a headline
(*"Reliability is on track."* / *"N reliability objectives need attention."*), each
objective worded in ordinary terms — *"On track"*, *"Getting close"*, *"Not
measured"*, *"Over budget"* — worst-first, and a fail-open breach worded as **critical**.
This is the same plain-language contract the System Health admin screen uses, so
reliability slots into the "just works" surface without new vocabulary.

## The proof

`pnpm run proof:reliability` (30 checks) proves the budget math, the zero-tolerance
invariant (including the window-size sweep), the fail-safe-on-no-data behavior, the
plain-language wording, and determinism/immutability. It prints its live figures:

```
figures=slos=3,zeroToleranceSlos=1,statuses=4
```

Run it directly:

```bash
cd scripts && npx tsx ./src/reliability-proof.ts    # proof:reliability (30 checks)
```

## Public-safety boundaries

- Deterministic and fixture-backed: no `Date.now`/`Math.random`, no network, no
  secrets, no live tenant identifiers. SLIs come from a supplied window of records.
- Descriptive, never permissive: this measures and reports reliability; it enacts
  nothing. Using the error budget to *gate* a change (freeze risky changes when the
  budget is spent) is a governed decision for the proposal lifecycle, not an action
  this module takes.
- The error budget can be spent on latency and availability; it can **never** be
  spent on fail-closed integrity.

## Measured performance baseline — and why it is REPORTED, not gated

Owned by the `performance-engineer` role (`docs/ORG_CHART.md`). The figures the
documentation quotes were re-measured on **2026-08-24** and all still hold:

| Quoted claim | Where | Re-measured 2026-08-24 | Previous, 2026-08-19 |
| --- | --- | --- | --- |
| decision core **p95 1.3 ms** | intake ledger row 80, `rateLimit.ts` header | **p95 1.0458 ms** (mean 0.6228, p50 0.5719, p99 1.3859, max 7.7317; 5,000 iterations after 200 warmup) | p95 1.2671 ms |
| **750 ms** pilot gate | `bench:decision-latency` | asserted and passing, ~717× margin on p95 | passing |
| **240 requests/min** per key | pricing page, intake row 80 | confirmed as the shipped default in `artifacts/api-server/src/middlewares/rateLimit.ts`, and re-confirmed live by `test:load` (60 of 300 burst requests throttled; a malformed limit falls back to exactly 240, never to 0) | confirmed |
| parallel scaling | `bench:decision-throughput` | 1,529 decisions/sec on one core; **5,370/sec aggregate on 4 workers, 3.51× (88% of linear)**, identical verdicts on every worker | 5,128/sec, 3.38× (85%) |

**A DIFFERENT RUNNER, SO THIS IS A FRESH MEASUREMENT AND NOT A REGRESSION
COMPARISON.** The 2026-08-19 column is kept for shape, not for subtraction:
absolute rates here are hardware-specific and this box reports 4 cores. Reading
"1.0458 vs 1.2671" as a 17% improvement would be exactly the kind of arithmetic
across incomparable runs this section exists to prevent. What the re-measurement
establishes is narrower and is the whole point: **every quoted figure is still
true on the current head.**

## The in-process number and the over-HTTP number are NOT the same number

Quantified once, on ONE machine and ONE commit (2026-08-24), because these two
figures are quoted in different places and are routinely read as interchangeable.
They are not, and the distance between them is the transport.

| | In-process core (`bench:decision-throughput`) | Over HTTP (`test:load`, concurrency 32) | Gap |
| --- | --- | --- | --- |
| throughput | 5,370 decisions/sec (4 workers) | **585 req/sec** | **9.2× lower** |
| throughput, single core | 1,529 decisions/sec | — | 2.6× the whole HTTP figure |
| p50 latency | 0.6065 ms (under saturation) | **36.7 ms** | **~60× higher** |
| p95 latency | 1.3845 ms (under saturation) | **92.1 ms** | **~67× higher** |
| p99 latency | 4.0391 ms (under saturation) | **609.6 ms** | ~151× higher |

WHAT THE GAP IS MADE OF, and what it is not. The bench measures the decision
core alone — no HTTP parse, no JSON, no middleware chain, no connector, no
database. The load figure carries all of that plus the auth, context and
rate-limit middlewares, and it runs the client on the same 4-core box as the
server at concurrency 32, so its p99 includes QUEUING and client cost, not
transport alone. The honest reading is directional: the transport and middleware
dominate the decision itself by roughly two orders of magnitude on latency.

**AND NEITHER IS THE CAPACITY NUMBER THAT MATTERS.** The shipped default rate
limit is 240 requests/minute per key — four decisions a second. That is ~146×
below the measured HTTP throughput and ~1,340× below the in-process aggregate.
The LIMITER, not the engine and not the transport, defines per-tenant capacity
today. Any performance claim that quotes 5,370/sec or 585/sec as what a customer
gets is wrong by construction; what a customer gets is 4/sec unless
`SIGNALGRID_V1_RATE_LIMIT` is raised deliberately.

**These numbers are deliberately NOT gated on their absolute values, and that is
a decision rather than an omission.** A latency threshold asserted on a shared
CI runner is a flaky gate, and this repository's standing position is that a
flaky gate gets switched off — which would cost more than the threshold ever
bought. So the benches gate only what is machine-independent (a throughput
floor derived from the pilot gate, no parallel collapse, determinism under
concurrency) and report the rest.

The consequence, stated so it is not discovered later: **`check-proof-figures.mjs`
does not cover these.** That guard catches comma-formatted numbers of 1000 or
more inside a section naming a proof; `1.3 ms` is neither. Nothing mechanical
keeps the latency figure true, so keeping it true is a standing duty of the
performance-engineer role — re-measure when the decision path changes, and
re-date this table.

**The distinction that matters most here is already honest elsewhere and is
repeated because it is the easiest one to lose:** every figure above is the
decision core **in-process** — no HTTP, no connector, no database. The `/v1`
surface under concurrent traffic is a different measurement (`test:load` /
`test:stress`), and quoting an in-process number as an API number would be
exactly the unearned affirmative this estate exists to refuse.
