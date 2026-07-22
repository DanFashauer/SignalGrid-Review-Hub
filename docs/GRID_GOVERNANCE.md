# Grid governance — who owns the decision, who accepts the risk

> *"Technology grants access; governance decides who should have it."*

The hardest part of an identity/access program isn't the tooling — it's the
governance: **who owns the application, who approves access, who defines the
roles, who accepts the risk.** A runtime decision layer that acts on people's
behalf makes that sharper, not softer: a workflow the Grid runs **automatically**
with nobody accountable is the classic failure — *if nobody owns the decisions,
the technology won't fix the problem.*

So SignalGrid treats governance as a **first-class, lintable axis of the
declarative grid**, separate from technical validity. Modeled in
`@workspace/flows` grid-config (`governanceScorecard`, governance lint rules),
proven by `pnpm run proof:grid-config`, and surfaced read-only on the operator
console's Grid config view and `GET /cp/v1/grid/config`.

## The four questions, mapped to the config

| IAM governance question | Where it lives in a workflow |
|---|---|
| **Who approves access?** | each action's `approval` (`automated` / `admin_approval` / `dual_approval` / `user_override_on_downtime`) |
| **Who owns the decision?** | the workflow's `owner` |
| **Who accepts the residual risk?** | the workflow's `accountable` |
| **Who defines it?** | the declarative config in Git — reviewed, versioned, CI-validated |

## The governance lint (surfaced, never blocking)

Governance gaps are **warnings**, not errors — a config can be *technically* valid
yet *governance*-incomplete, and conflating the two would hide the real problem
(the tech was ready; the governance wasn't). The rules:

- **`workflow_unowned`** — a workflow with no declared `owner`. Nobody owns this
  decision.
- **`auto_action_unaccountable`** — a workflow that runs an **automated**
  (no-human-in-the-loop) action but declares no `accountable` risk-owner. The
  sharpest gap: the Grid would act on its own with nobody accepting the risk.

## The scorecard

`governanceScorecard(config)` turns the "clear ownership + shared accountability"
checklist into a computed number: `owned` / `accountable` / `autoActing` /
`autoActingUnaccountable` / `governanceGaps`, and a single honest bar —
**`complete`** — true only when *every* decision is owned and *nothing the Grid
does automatically* is left with no one accountable. The committed golden config
([`config/grid/example.grid.config.json`](../config/grid/example.grid.config.json))
is governance-complete; the proof pins both that and that the gap rules fire on a
config missing an owner or an accountable risk-owner.

## Boundary

This does not automate the human agreement itself — it makes ownership and
accountability **explicit, versioned, and checkable**, so the org can *see* where
a decision has no owner instead of discovering it after the fact. It is read-only
and advisory; assigning owners and accepting risk stays a human, business
decision. See [OPEN_ORCHESTRATION_VISION.md](OPEN_ORCHESTRATION_VISION.md).
