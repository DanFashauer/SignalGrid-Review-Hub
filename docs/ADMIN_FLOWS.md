# Admin flows: configure signals + flows, the Grid evaluates them

Administrators don't write logic. They **register signals** and **configure
flows**, and the Grid evaluates them: it derives each action from the live trust
decision (the Assist model), and it watches each flow's own health — recovering a
flow it owns, or raising an incident when something breaks. Whether a derived
action is ever carried out is the admin's call, set per action by the approval
policy below; carrying it out belongs to the host app and to the systems of
record. Fully customizable; it compounds (more signals ⇒ smarter, faster). See
`@workspace/flows`.

## What an admin configures

A **flow** is: the **signals** it depends on, the **actions** it drives, and per
action an **approval policy** — the admin's call on what's automated vs. gated:

| Approval policy | Who acts |
|---|---|
| `automated` | the Grid performs it (on an allow) |
| `admin_approval` | one administrator approves |
| `dual_approval` | two administrators approve (four-eyes) |
| `user_override_on_downtime` | the **only** time an end user acts — a break-glass override, permitted **only** during a declared downtime, gated by its disaster-recovery safety nets |

End users never approve anything. The one exception is a downtime override, and
even that is wrapped in DR safety nets (`safetyNets` per action) so the override
can't itself break things.

## What the Grid does with it

- **Action dispositions** — `planFlowActions(flow, decision, {downtime})` maps the
  admin's config + the live decision to `automated / admin_approval /
  dual_approval / user_override / blocked`. Deny/restrict blocks everything except
  a downtime override.
- **Flow health** — `evaluateFlowHealth(flow, signals)` → `healthy / degraded /
  broken` from the observed signal states (a missing/broken required signal breaks
  the flow; a stale one degrades it).
- **Break resolution** — `resolveFlowBreak(...)` is the "self-fix or raise an
  incident" fork the business configures:
  - flow has an **auto-resolving agent** → **self-heal** (uptime protected, no page);
  - flow has a **non-auto-resolving agent** → self-heal **and** a fallback incident;
  - flow has **no agent** → an **ITSM-agnostic incident** (severity, support team,
    and the target ITSM named) — patient-safety / high-assurance flows page a human.
- **Grid intelligence** — `gridIntelligence(...)` scores how smart the Grid is
  right now: more healthy signals feeding more flows ⇒ higher score, tighter
  decisions, faster break-detection.

## Surfaces
- `GET /cp/v1/flows` — the configured flows.
- `GET /cp/v1/flows/health` — per-flow health + resolution (self-heal / incident)
  + the grid-intelligence score, over a public-safe fixture signal snapshot.

## Guardrails
Public-safe fixtures. The incident is an **ITSM-agnostic descriptor** — it names
the target system, it never calls it. Self-heal is **simulated** (a named agent
+ steps), never an executed change. `pnpm run safety:check` stays green.

## Next
An admin **flow-configuration UI** (author signals + flows + approvals; a live
flow-health board showing self-heal vs. incident), and wiring real ITSM/agent
connectors behind the agnostic descriptors when a business opts in.
