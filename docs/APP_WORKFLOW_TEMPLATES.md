# App-workflow templates + validation lint

**Public-safe. A review artifact, not a shipping SDK.** This describes how an
integrator wires a new application into SignalGrid's Assist gating: clone a
starter template, map its actions, and run the validation lint before shipping.
It lives in `@workspace/app-workflows` alongside the planner and catalog.

## Why templates + a lint

An integrated app calls SignalGrid before a sensitive action and gets back which
of its actions may run automatically versus which must be human-confirmed (the
Assist model — see [`EMBEDDED_UX_PRINCIPLE.md`](EMBEDDED_UX_PRINCIPLE.md)). That
only holds if the app's action definition is well-formed. A single mis-tagged
action — a critical, irreversible operation left non-sensitive — would let that
action fire automatically on an `allow`, which is exactly the hole the gate
exists to close.

The linter is a **fail-closed check-and-balance** run at authoring time: it
enforces the same safety invariants the planner relies on, so a misconfigured
integration is caught before it ships rather than in production.

## Clone a starter template

```ts
import { starterTemplate, lintAppIntegration } from "@workspace/app-workflows";

const app = starterTemplate("data_center"); // a valid, lint-clean scaffold
app.id = "netops-console";
app.name = "NOC console";
app.category = "Network operations";
// map app.workflowKey to the decision-core workflow for this session
// replace the TODO actions with your app's real operations …

const result = lintAppIntegration(app);
if (!result.ok) throw new Error(result.errors.map((e) => e.message).join("\n"));
```

`starterTemplate(vertical)` returns a deep copy (safe to mutate) with one action
at each disposition: a low-risk **visible read**, an **elevated write**, and a
**critical** action that is sensitive + gated. `STARTER_TEMPLATES` exposes all
six at once.

## Action model (what each field means)

| Field | Meaning |
| ----- | ------- |
| `riskTier` | `standard` (low-risk read/ack) · `elevated` (writes / sensitive reads) · `critical` (irreversible / high-consequence) |
| `sensitive` | Requires explicit human confirmation even on an `allow`. **Critical actions must be sensitive.** |
| `gatedByStepUp` | Held by a `step_up` decision and blocked by a `restrict`. Non-gated actions stay available under restriction (so the app can always *see*). |

## What the lint enforces

**Errors (fail closed — `ok` is false):**

- `critical-not-sensitive` — a `critical` action must be `sensitive`.
- `critical-not-gated` — a `critical` action must be `gatedByStepUp`.
- `sensitive-not-gated` — a `sensitive` action must also be gated.
- `workflow-key-empty` — every app must map to a decision workflow, or it is
  never gated.
- `no-actions` / `action-key-empty` / `action-label-empty` — structural.
- `action-key-duplicate` — keys unique within an integration.
- `id-duplicate` — ids unique across a catalog (checked by
  `lintAppIntegrations`).
- `vertical-unknown` / `id-empty` / `name-empty` / `category-empty`.

**Warnings (never block):**

- `action-key-convention` — keys should be dot-namespaced (`chart.open`).
- `id-convention` — ids should be kebab-case.
- `no-visible-read` — keep one non-gated read so the app shows something under a
  restriction.
- `standard-sensitive` — a `standard` action marked sensitive is unusual.

## Verify it

`pnpm --filter @workspace/scripts run proof:app-workflow-templates` proves the
templates lint clean, the shipping catalog passes the linter (so the lint is not
vacuous), and the linter fails closed on each unsafe shape. The proof runs in
CI and local preflight.
