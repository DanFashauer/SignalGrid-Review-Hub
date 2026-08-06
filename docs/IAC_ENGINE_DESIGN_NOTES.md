# What's worth borrowing from Terraform / OpenTofu / Pulumi

Design notes for `@workspace/iac`. **Ideas only.** No code from any of these projects is
copied, adapted, or vendored here, and none should be without an explicit owner
decision — see the licensing note at the end, which is the reason this file is design
prose rather than a dependency.

## Why look at all

`lib/iac` already models the same problem those three engines solve: take a declared
desired state, observe what is actually there, compute the difference, get a human to
approve it, and change the world in a controlled order. The vocabulary lines up almost
one-for-one — `DesiredState`, `ObservedState`, `Plan`, `PlanItem`, `DriftFinding`,
`approve` / `reject` / `apply`, `isLegalTransition`.

Three engines have spent a decade discovering where that shape breaks. Reading their
answers is cheap. The point of this file is to name which of those answers are worth
adopting and which are load-bearing only at a scale SignalGrid does not have.

## Worth borrowing

### 1. The plan is a durable artifact, not a screenful of text

Terraform's `plan -out` writes the plan to a **file**, and `apply` consumes exactly
that file. The approval attaches to a specific computed diff, so what a human said yes
to is provably what runs — the world cannot shift between review and execution without
invalidating the artifact.

`lib/iac` has `Plan`, `markPlanned` and `approve`, so the shape is present. The
borrowable refinement is making the approval **bind to a plan identity** (a hash of the
plan's items), so an apply against a re-computed plan is rejected rather than silently
running a different change. This is the same reasoning as binding a step-up challenge
to the selected action key — an approval that floats free of what it approved is not an
approval.

### 2. Refresh, plan, and apply are three phases, not two

All three engines separate *reading the world* from *computing the diff*. That
separation buys two things worth having: you can refresh without proposing changes
(cheap drift detection on a schedule), and you can plan against a known-stale snapshot
deliberately, which matters when the upstream is rate-limited or down.

`drift.ts` and `plan.ts` already lean this way. Making the phase boundary explicit in
the type system — a refresh produces `ObservedState`, and `Plan` records *which*
observation it was computed from — makes "this plan was built on stale data" a
representable state rather than an unknown.

### 3. Stable resource addresses

Terraform's `module.a.aws_instance.b[0]` and Pulumi's URNs exist so a resource keeps
its identity across runs even when its attributes change. Without stable addressing,
a rename reads as *delete plus create*, which for infrastructure means destroying
something and rebuilding it.

For SignalGrid this matters less today (the resources are policy and configuration,
not databases), but the failure mode is the same shape as the identity problems the
decision core already takes seriously: if you cannot say *this is the same thing as
before*, you cannot compute drift, only difference.

### 4. Ordered teardown is the graph run backwards

The dependency graph is not primarily for parallelism — it is for **destroy order**.
You tear down in reverse dependency order or you strand resources.

SignalGrid already learned this independently: `proof:provisioning-teardown` exists
because the retreat must be proven before the deploy is trusted, and it checks that the
allow profile is removed *last, in dependency order*. That is the same insight, arrived
at from the device side. Worth noting as convergent rather than borrowed.

### 5. Pulumi's Automation API — the closest analogue to what SignalGrid is

This is the most directly relevant idea of the three engines. Pulumi's Automation API
exists so a **product can embed the engine** and drive plan/preview/apply
programmatically, instead of shelling out to a CLI and scraping text.

That is exactly the posture `lib/iac` needs: SignalGrid is not a CLI a human types into,
it is a decision layer other systems call. If an IaC engine is ever adopted here rather
than written, the embeddability of its API matters more than its provider ecosystem.

## Not worth borrowing

- **The provider plugin ecosystem.** Its value is breadth across hundreds of clouds.
  SignalGrid's connectors are read-only and deliberately narrow, and each is gated and
  proven individually. Adopting a plugin protocol would import a large surface to serve
  a need that does not exist.
- **The state file as a stored artifact.** Terraform/OpenTofu state routinely contains
  secrets in plaintext, which is why so much tooling exists to encrypt and lock it. A
  design that makes secret storage a *default* consequence is the wrong direction for a
  repository whose boundary gate exists to keep sensitive material out.
- **Kubernetes-scale orchestration generally.** Recorded because it keeps coming up:
  these engines earn their complexity across many machines and many teams. SignalGrid
  has neither. Docker Compose already runs the stack and is CI-proven on every PR.

## The licensing constraint, which drove this file's existence

| Project | Licence | Can code be used here? |
|---|---|---|
| **Pulumi** | Apache-2.0 | Yes — permissive, patent grant, no field-of-use restriction |
| **OpenTofu** | MPL-2.0 | Yes, but any derived file stays MPL and must be disclosed |
| **Terraform** | BSL 1.1 | **No** — bars offering it "on a hosted or embedded basis in order to compete with IBM Corp.'s paid version(s)" |

Verified from each project's own `LICENSE`, not from memory.

The word that decides it is **"embedded."** SignalGrid is an embedded decision layer.
Terraform's Business Source License carves out precisely that use, so its code is not
available to this project regardless of how good the design is — which is why the ideas
above are described rather than imported.

If an engine is ever adopted, **Pulumi is the answer**: Apache-2.0 removes the licensing
question entirely, its SDK is TypeScript-native like this repository, and the Automation
API is built for embedding.

**When, not whether:** adopting one is worth doing when there is real infrastructure to
provision — a cloud account, a tenant, a customer. Until then `lib/iac` plans and proves
against fixtures, which is the honest scope, and adding an engine would add a dependency
with nothing to act on.
