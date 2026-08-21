# The Launch Profile — what ships as *SignalGrid Shared-Device Trust Gateway*

**Status: a proposal in reviewable form. Scope is the owner's call; this file and
`scripts/launch-profile.mjs` make the proposal concrete enough to argue with line by
line.**

Ratify it, amend it, or reject it — but it can no longer be *vague*, which was the
actual problem.

## Why this exists

The launch plan names ten blockers. Three of them are one problem seen from three
angles:

| Blocker | As stated |
|---|---|
| 1 | The pull request has outgrown reviewability — 320 files, 47k lines. |
| 8 | Too many API and app surfaces. |
| 10 | Mixed autonomy claims: enforced vs observed vs simulated is not consistently stated. |

All three are downstream of one missing artifact. Nothing in this repository said
which connector families, signal kinds, API paths and client surfaces are **the
product**, and which are proven work that is not shipping yet. Without that line,
every surface reads as equally load-bearing, and a reviewer has no way to tell a
launch-critical file from a deferred one.

Breadth was never the defect on its own. **Breadth with no declared edge is.**

## The criterion

Every `launch` entry has to survive this sentence, quoted from the plan and not
softened:

> one tenant-aware product, one host app, one read-only device-management evidence
> source (open-source lab first — Fleet; Microsoft Entra/Intune as the first
> enterprise production connector), one operator console, one design partner, one
> paid deployment

The connector clause changed at profile v3 (2026-08-11, owner-directed): Microsoft
moved from prerequisite to **commercial target**. The open-source lab (Fleet, plus a
Headwind-shaped Android fixture) proves the same decision engine through the
`DeviceManagementEvidence` adapter contract, and `proof:evidence-adapter` fails the
build unless swapping the fleet/headwind/intune adapters leaves every decision
identical — provenance is the only permitted difference.

Most things do not survive it. That is the point.

## What the profile says

Every figure in this section is published by `proof:launch-profile` and checked by the
docs↔proof figure guard on each run — stated here, beside the numbers, because scope
is per-section and a proof named three sections away checks nothing.

`scripts/launch-profile.mjs` classifies **177 classified items** across **4 profile
surfaces** — connector families, signal kinds, published API paths, and client/app
surfaces. Every item carries exactly one status:

| Status | Count | Meaning |
|---|---|---|
| `launch` | **22 launch items** | In the Limited GA surface. |
| `deferred` | **134 deferred items** | Real, gated, proven, staying in the repository — not Limited GA. |
| `demo_only` | **9 demo only items** | Exists to demonstrate or explain. Must never be presented as shipping product. |
| `internal` | **12 internal items** | Harness, generator or evidence plumbing. Not a product surface at all. |

`deferred` is not a demotion. It is the freeze working.

### The launch surface, in full

**Connector families (3 of 51).** `graph` is the one read-only Entra/Intune
connector — and the only family in the repository whose live transport actually
addresses `graph.microsoft.com`, which is worth stating plainly because several
families *named* for Microsoft do not. `device-management-health` grades whether an
Intune compliance answer is **current**, which is the reason a buyer picks this over
reading the Intune console directly. `local-authority` answers whether a shared
device may act on its own authority right now — device-reported, so it widens the
connector surface not at all.

**Signal kinds (3 of 41).** `device_posture`, `device_management_health`,
`local_authority` — exactly what the three launch families produce.

**Published API paths (13 of 54).** The Assist gate itself
(`/v1/decisions/evaluate`), the routes an operator console needs to see what it
did, `/v1/decisions/{id}/evidence` — which is not garnish but the product's
entire claim — plus `/v1/context`, `/v1/audit` and `/v1/metrics`. The
2026-08-10 wireframe-first pass added six read-side routes so the console's
setup and policy screens read the served API rather than fixtures: the
connector trio (`/v1/connectors`, `…/{id}/sync-runs`, and `…/{id}/sync`, whose
handler runs only the core's fixture pipeline) and the policy read trio
(`/v1/policies`, `…/{id}/versions`, `…/{id}/tests`). Draft creation and version
activation stay off the fence — policy changes ride the repository at launch.
All thirteen sit below the auth guard in `routes/v1.ts`, checked rather than
assumed.

Version 1 listed `/v1/keys` as an eighth, described as "API-key authentication for
the above". That was reasoned, not read. The route is a demo credential dispenser
sitting *above* the auth guard, handing the raw owner bearer for every seeded tenant
to anonymous callers — and `demoSurfacesEnabled()` had already been refusing to
register it outside the review demo. The runtime fence was right and the declared
scope was wrong. It is `demo_only` in version 2.

**App surfaces (3 of 25).** `api-server` (the product), `signalgrid-app` (the one
operator console — bound to the served `/v1` surface: decisions list, decision
detail, digest-verified evidence, audit ledger, assurance labels), and
`ios:EnterpriseShell` (the one host app, shipping as the integration reference a
design partner builds against). The console role moved from `signalgrid-review`
on 2026-08-10 when signalgrid-app bound to `/v1`: a console that runs an
in-browser copy of the core cannot be THE console, because it never exercises
the API a customer would. `signalgrid-review` remains the zero-network review
deck — reclassified `demo_only`, not diminished.

This denominator has moved twice, and both moves are worth stating. An earlier
revision of this page said "3 of 18" after three lane-coordination surfaces had
already joined the tree (real total then: 21) — the fraction sits in prose no
figure guard can see, which is exactly how it went stale. Profile **v4**
(2026-08-16) then widened the *derivation*: the gate had only ever read
`artifacts/`, `tools/` and the two iOS project files, so an entire Android port
(`native:android`), a desktop port (`native:desktop`), the cross-port wire
conformance fixture (`native:shared`) and the SmartDock firmware core
(`firmware:dock`) sat outside the freeze — real, tracked, and unexamined. The
derivation now reads `native/*` and `firmware/*` too; the four arrivals are
classified three `deferred` + one `internal`, and the launch set is unchanged.
**Ratified:** the owner ratified v4 in full on August 20, 2026 (DR-005 in
`docs/DECISION_RECORDS.md`) — every classification in this profile is decided,
and only a future decision record re-opens one.

## The gaps — read these before reading the launch set as readiness

There are **3 declared gaps**: work a `launch` entry needs that does not exist yet.
They are held as data in `GAPS`, not as prose, so the proof can count them and no
document can quietly describe the launch set as complete.

**There were five, and two of them had been fixed without anyone noticing.** Both the
runtime fence and the served-vs-published surface were built — with tests asserting a
404 for every deferred path, and a positive control confirming the server is up so
those 404s read as refusals rather than a dead port — while this file and `GAPS` went
on declaring them missing. A third, the Graph transport, had been written and was
still described as unwritten.

Nothing caught it because nothing was looking. The gate checked that a gap named a
real surface; the proof checked that its text was long enough and that one gap's
wording still contained the words "Graph transport". Both test the description rather
than the world — the same defect this repository keeps finding, wearing a governance
hat. A stale gap understates readiness, which is the safer direction and is exactly
why it can rot unnoticed; it is still false, and it makes the honest gaps cheaper to
ignore once a reader finds that two of five were wrong.

So every gap now carries a **`closedWhen`** condition — files to read and strings that
must be present or absent — which `check-launch-profile.mjs` evaluates against
comment-stripped source. All conditions met, the build fails until the gap is removed
or reworded. Comments are stripped deliberately: a gap must not be closable by a
sentence describing the work. `closedWhen` is mandatory, because a gap nobody can be
told to delete is a gap that will outlive its own fix.

The one that matters most:

- **The one connector is not yet Microsoft end to end.** The Graph transport now
  exists (`graph-transport.ts`, mapping Graph's `managedDevice` onto the connector's
  raw report) and is selectable with `DEVICE_MANAGEMENT_HEALTH_TRANSPORT=graph` — but
  the live **default** is still the generic bridge URL, so an operator who configures
  nothing does not get Graph. Until that default flips, `device-management-health` is
  not part of the one Entra/Intune connector without explicit configuration, and the
  launch connector set is `graph` alone. This is the remaining content of the plan's
  Blocker 5.

## How it cannot go stale

`scripts/check-launch-profile.mjs` re-derives the real membership of every surface
from source and checks a **bijection**, in both directions:

- **Phantom scope** — an id in the profile that exists nowhere. A launch set naming
  something that is not there is the unearned affirmative wearing a planning hat.
- **Silent omission** — something real the profile does not mention.

The second direction is the freeze, mechanically. Not a paragraph asking people to
stop adding breadth: a check that **fails** until a human writes down what a new
thing is. Add a 52nd connector family and the build goes red until someone
classifies it, because "unexamined" is the door breadth walks back in through.

Both directions caught real defects on the gate's first run, in its own author's
draft: a phantom `ios:SignalGridMobile` target that does not exist, and two real
shipping apps (`ios:SignalGridOperator`, `ios:WardlinkDemo`) the profile had missed
because it read only one of the two iOS project files. An adversarial re-derivation
then found `tools/room-console` — a real, user-facing page that bundles the decision
core and runs it in a browser — which every manifest-keyed derivation misses,
because it has no manifest. A surface is a surface because a person can open it.

A fourth defect appeared only in CI. The derivation read directory entries off disk,
so it counted gitignored build output — `artifacts/level-10` and `artifacts/proof`
exist on a machine that has run the harness and not in a clean checkout.
It had answered 20 surfaces locally against 19 in CI, and went red on a mismatch
that existed only because the two runs were asking different questions. It now
derives from
`git ls-files`, which is one reproducible answer everywhere and also the right
question: a directory that is not in version control is output, not a surface.

`proof:launch-profile` publishes the figures this document quotes, so the
docs↔proof figure guard fails the build if this page and the profile ever disagree.

## What this deliberately does not do

It changes **no runtime behaviour**. Exposing launch status at runtime — a `/v1` arm
reporting enforced vs observed vs simulated per signal kind — would close Blocker 10
more completely than a governance file can, and is deliberately not done here: it
widens the API surface and adds diff to a pull request Blocker 1 says is already too
large to review. It is recorded as a gap rather than quietly skipped.

It also does not classify the 35 workspace libraries. Those are implementation
behind the api-server, not surfaces a customer or a reviewer meets, and enumerating
them would add noise to the artifact whose whole job is removing it.

## Changing scope

Edit the status in `scripts/launch-profile.mjs`, bump `LAUNCH_PROFILE_VERSION`, and
run:

```bash
node scripts/check-launch-profile.mjs   # the edge still matches the repository
pnpm run proof:launch-profile           # the scope is still internally coherent
```
