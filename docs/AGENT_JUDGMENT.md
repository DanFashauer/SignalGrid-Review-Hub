# Agent judgment — the layer that questions the action

## The gap

The market is racing to solve agent **access**. Okta shipped an AI Agent Gateway;
Microsoft has Entra Agent ID; every IAM/IGA vendor is building a broker that
answers *who the agent is* and *what it can reach* — no more long-lived keys
pasted into a config so an agent can "go be you," every action traced to a real,
properly-scoped identity. That is the right move, and it is largely solved.

It is not sufficient. **An agent inherits your identity. It does not inherit your
judgment.** A perfectly-credentialed, least-privilege, fully-approved agent can
still take an action no human would:

- a one-line prompt that becomes **40,000 updates**,
- an identity that has **never once opened this application** reaching into it now,
- an action with **no originating process** — nothing says this should happen,
- one write that **fans out across a whole tenant**,
- a **cadence faster than any person** could produce.

Access asks *who* and *what can they reach*. Judgment asks *should this action, at
this rate, against this target, with this provenance, happen at all* — and almost
nobody is building it.

## Why this is SignalGrid's to own — and why not PBAC

SignalGrid's entire thesis is **runtime judgment**: fuse contextual signals into a
single allow / step-up / restrict / deny at the moment an action fires. The agent
judgment gap is that thesis applied to a non-human actor.

This is deliberately **not** policy-/role-based access control. PBAC is
deterministic and models human-paced traffic well — but an AI acting on behalf of
a human is rapid and context-dependent in ways a static policy cannot express. A
role can say "this identity may update records." It cannot say "this identity may
update records *unless* one prompt just became forty thousand of them against an
app it has never touched, with no change window behind it." That is behavioral,
contextual, per-action judgment.

## Two dimensions, one fabric

SignalGrid keeps the two questions separate and fuses both:

| Dimension | Question | Signals |
| --- | --- | --- |
| `agent-identity` (existing) | Is the actor a governed identity? | registered in the NHI inventory, short-lived scoped token, human approval, recorded — the **access** layer |
| `agent-behavior` (this) | Is the *action* in-pattern? | volume vs baseline, target familiarity, provenance, blast radius, cadence — the **judgment** layer |

The access brokers (Okta AI Agent Gateway, Entra Agent ID, an agent registry) are
the **signal source** for `agent-identity` — SignalGrid consumes their evaluated
identity view and adds the judgment layer on top. It brokers no access and mints no
token; it reports a posture the fabric fuses worst-concern-wins with every other
dimension.

## The judgment ladder (fail-closed)

`agent-behavior` normalizes an already-evaluated behavioral view (an agent-activity
monitor, a UEBA engine, or the gateway's own action telemetry) and folds it to one
posture + action:

- **escalate** — a `burst` volume: orders of magnitude over baseline (the
  prompt→40,000-updates case). A runaway action.
- **restrict** — `no provenance` (no authorizing intent/process/change-window), or a
  `broad` blast radius (one action fanning across many resources at once).
- **step_up** — an `elevated` volume, a `first_seen` target (never touched this app),
  a `superhuman` cadence, anything unreadable, or the bridge unreachable. Judgment
  needed; never trust silence.
- **none** — exactly one state grants: an action positively confirmed in-pattern on
  **every** signal — within-baseline volume, familiar target, authorized provenance,
  scoped blast radius, human-plausible cadence — with the bridge reachable.

## Proof

`pnpm run proof:agent-behavior` (36 checks) brute-forces the evaluator's entire
normalized input space — **1,944 combinations** — and asserts **exactly one** grants
(the fully-in-pattern, reachable, clean combination), every grant is `actionJudgedSafe`,
and every anomaly / unknown / malformed report does not. The named ladder checks
cover each rung; the enumeration guarantees there is no unnamed hole. The connector
is read-only and tier-gated (fixture unless beta/prod + `SIGNALGRID_LIVE_INTEGRATIONS`
+ `AGENT_BEHAVIOR_ACCESS_TOKEN`), mirroring every other live-integration in the fabric.

## Should the product adopt an agent gateway, or stick with what's built?

Both — they are complementary, not a choice:

- **Adopt the access broker as a signal source.** Okta AI Agent Gateway / Entra
  Agent ID solve identity and scope well; SignalGrid should consume that, not
  rebuild it. That is what `agent-identity` already models (registered, short-lived,
  least-privilege, approved, recorded).
- **Keep — and lead with — the judgment layer.** That is the gap the market post
  identifies and the one SignalGrid is uniquely built to fill. `agent-behavior` is
  that layer, now first-class in the fabric.
