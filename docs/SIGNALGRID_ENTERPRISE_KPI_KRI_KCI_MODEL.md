# SignalGrid Enterprise KPI / KRI / KCI Model

> **An indicator is a rollup over history. A decision is about one action, now.
> SignalGrid lets an indicator raise the assurance it requires — it never lets a
> favourable indicator create a grant the direct evidence does not support.**

The companion the Security Operations Evidence Fabric named as *planned, not linked*
(`SIGNALGRID_SECURITY_OPERATIONS_EVIDENCE_MODEL.md` §10). This document is now that
model, and this is the link that closed the loop.

Enforced by `scripts/src/kpi-kri-kci-model-proof.ts` (`pnpm run
proof:kpi-kri-kci`). Every claim below is tagged **PROVEN** (asserted against the
shipped engine), **STRUCTURAL** (guaranteed by a type or an absence in the code),
**DERIVED** (computed from evidence that already exists), or **DOCTRINE** (a
governance position the specification would realize).

---

## 1. Purpose

Enterprises measure their security and operations programs with three families of
indicator:

```text
KPI — Key Performance Indicator   is the control OPERATING?     (coverage, latency, throughput)
KRI — Key Risk Indicator          is risk RISING?               (leading signals of trouble)
KCI — Key Control Indicator       is the control EFFECTIVE?     (does it actually catch what it should)
```

They are essential for running a program and dangerous for making a decision, and the
danger is a single confusion this document exists to foreclose:

> A KPI describes the estate over a window of time. A SignalGrid decision is about one
> worker, one device, one action, right now. **The rollup is not the event.**

The line worth keeping, in the owner's words:

> Logging coverage healthy ≠ this specific event was captured.
> EDR installed ≠ this device is safe right now.

---

## 2. The one rule everything else follows

**An indicator can raise the assurance bar. It cannot lower it, and it cannot by itself
produce an `allow`. (PROVEN.)**

This is not a new law. It is the same fail-closed law the whole product rests on, viewed
from the indicator side: an absent, unknown, or unfavourable signal may only *add*
friction. A *favourable* indicator is treated with exactly the same caution as any other
non-authoritative input — it can inform the posture, but the direct evidence for the
specific action still has to hold.

`proof:kpi-kri-kci` asserts this against the shipped `evaluatePolicy`: taking a fully
healthy evidence set and blanking a single direct signal to `unknown` never yields a
decision more permissive than the fully-evidenced one — no matter how favourable the
surrounding posture. A change that let a green rollup relax a decision goes red on the
commit that made it.

---

## 3. A green indicator is a ceiling, not a measurement (PROVEN)

This is the most important and the least intuitive part, and SignalGrid already has the
mechanism for it in code — shipped, gated, and rendered.

Coverage — "how much of what we could measure, can we measure?" — is a KPI. SignalGrid's
grid-coverage result carries a **`basis`**:

| `basis` | What the number means |
| --- | --- |
| `observed` | computed from real signal states — a measurement of *now* |
| `projected_from_sourcing` | computed from which signals *could* be wired — a **ceiling**, nothing observed |

`evaluateGridCoverage` derives the basis from the shape of its input, not from a flag a
caller could set wrongly, and the operator console will not paint a projection green:
green is reserved for an observed basis, because green means measured. A 100% coverage
KPI computed from acquisition posture says "this estate *could* answer everything once
every wireable signal is wired and healthy" — it does **not** say "this event was
captured."

That is the whole KPI doctrine in one built mechanism: **a favourable rollup is a
ceiling, and a ceiling is never mistaken for the observation of the specific event.**
`proof:kpi-kri-kci` pins that a projected coverage of 100% still carries
`basis: projected_from_sourcing`, so it can never be read as an observation.

---

## 4. The KCI SignalGrid already computes — the watermelon (PROVEN)

The canonical Key Control Indicator is *effectiveness*: does the control actually catch
what it is supposed to? SignalGrid ships one, deterministically, and it is the sharpest
control-effectiveness indicator in the product.

`lib/integrations/.../response-accountability` grades a response record and detects the
**watermelon** — green on the outside, red on the inside: a concern **claimed
RESOLVED while the underlying problem is still present**. It is a KCI in the exact sense
that matters: a closed ticket is a *claim* that the control worked; the watermelon is the
measurement that it did not.

Two properties make it a real indicator rather than a dashboard tile, and both are
proven:

- **Deterministic.** The same record always grades to the same verdict — no clock, no
  randomness — so the indicator is replayable and auditable, not a moving average that
  can be argued with. (`proof:kpi-kri-kci` asserts identical verdicts across repeated
  evaluation.)
- **"Closed" is not "resolved" (DERIVED).** A concern closed as resolved that nobody
  re-checked is graded as its own state — the state in which a watermelon survives
  unseen — never as clean. Absence of a re-check is never read as "the problem is gone."

This is the KCI form of the product's release law: a restriction lifts when the decision,
re-run against fresh evidence, reaches `allow` — never when a ticket is marked done.

---

## 5. The three families, mapped to what SignalGrid produces

Every indicator below is **DERIVED** from evidence the engine already produces. None is a
new evidence source, a new connector family, or a new reason code.

### KPI — is the control operating?

| Indicator | Derived from | Note |
| --- | --- | --- |
| Evidence-coverage % | `evidence-coverage` (declared estate) | a **ceiling** — carries basis, §3 |
| Grid-coverage % | `grid-coverage` | observed vs projected, §3 |
| Decision latency | api-server decision path | measured, not a decision input |
| Signals wired / wireable | `signal-sourcing` | acquisition posture, not health |

### KRI — is risk rising?

| Indicator | Derived from | Leading signal of |
| --- | --- | --- |
| Unknown-signal rate | fail-closed step-ups | evidence going dark |
| Stale-posture rate | `postureFreshness` | measurement plane aging |
| Absent-collection rate | absent-collection law | a plane that stopped reporting |
| Blind-spot count | `grid-coverage` | situations no active workflow covers |

### KCI — is the control effective?

| Indicator | Derived from | Catches |
| --- | --- | --- |
| **Watermelon rate** | `response-accountability` | "resolved" that was not, §4 |
| Re-eval-reaches-allow rate | decision re-evaluation | releases that were actually earned |
| Owner-routing completeness | IT-layer model gate | a refusal that could route to nobody |
| Remediation-retest coverage | (specification) | fixes closed without a retest |

---

## 6. How an indicator may — and may not — touch a decision

```text
indicator (rollup over history)
   │  MAY:  inform the assurance posture a workflow requires
   │  MAY:  raise the bar — a rising KRI can make a workflow demand step-up
   │  NEVER: create an allow the direct evidence does not support
   │  NEVER: substitute for the observation of the specific event
   ▼
direct evidence for THIS action, now  ──►  the decision
```

The asymmetry is the doctrine: indicators flow **upward** into posture and governance;
they do not flow **downward** into a grant. Formally (DOCTRINE, with the PROVEN floor
from §2): let `d(E)` be the decision on direct evidence `E` and `d(E, K)` the decision
with any indicator set `K` also in hand. Then `d(E, K)` is never more permissive than
`d(E)`. An indicator can only move a decision toward *more* friction, never less.

---

## 7. Limited GA scope

**No indicator ships as a decision input, and none is minted as a reason code.** The
launch families stay `graph`, `device-management-health`, `local-authority`. What exists
today and is real: the coverage KPI with its `basis` (§3), the watermelon KCI (§4), and
the fail-closed floor (§2) that makes the whole asymmetry safe.

What is **SPECIFICATION**: a served indicator surface (a `/v1` rollup of KPIs/KRIs/KCIs),
the remediation-retest KCI (needs the write lifecycle that is deferred), and any
program-level scorecard. These are named here as planned, not built — and the proof
asserts that none of the proposed indicator names appears as a decision reason code, so
a future scorecard cannot quietly become a decision input.

---

## 8. Assessor-package relevance

An indicator is only defensible to an assessor if it cannot launder a claim. The two
properties that make SignalGrid's indicators defensible are the two this document proves:
a green KPI is a ceiling that names itself as one (§3), and the sharpest KCI catches the
exact lie a closed ticket tells (§4). Both belong in the independent-security-review
package's control-effectiveness section, alongside the Security Operations Evidence
material.

---

## Running the gate

```bash
node --import tsx scripts/src/kpi-kri-kci-model-proof.ts    # or: pnpm run proof:kpi-kri-kci
```

Related: `SIGNALGRID_SECURITY_OPERATIONS_EVIDENCE_MODEL.md` (the companion that named
this one), `SIGNALGRID_ZERO_TRUST_DECISION_PRINCIPLES.md`,
`SIGNALGRID_ENTERPRISE_IT_LAYER_MODEL.md`, `SIGNALGRID_ENTERPRISE_ITSM_LAYER_MODEL.md`,
`SIGNAL_SOURCING.md` (the coverage-basis mechanism §3 rests on), `LAUNCH_PROFILE.md`.

> **One named companion is still referenced but not built:** an Authentication &
> Federation model. It is named as *planned*, not linked, so this document contains no
> link to a phantom. When it is built, this line is where the link goes.
