# Ideas from the source material

> Public-safe. Every claim below is sourced to a reference diagram in the founder's
> project folder, to code in this repository, or to the May 2025 second-opinion review.
> Nothing here is a commitment, a roadmap, or a claim that anything is built. Where an
> idea is **not implemented**, it says so.

Read `WHY_THIS_EXISTS.md` first — it establishes the nine-layer observation this page
builds on. This page asks the next question: **what does that observation imply that
the product does not do yet?**

---

## The organising insight, and it is already in this codebase

`lib/ddm-connector/src/apple-schema.ts` maps each device property to how Apple's
Declarative Device Management reports it. Three of its notes matter more than the rest:

| Property | What the schema records |
| --- | --- |
| privacy (PPPC) | *"configuration-declared, not a status item — no DDM status key"* |
| binaryControl | *"a CONFIGURATION declaration, not a status item… **Reported out-of-band / on-device**"* |
| lastCheckInAt | *"a transport/control-plane fact, not a device-reported status item"* |

That is a distinction between **intent** and **evidence**.

- A **configuration declaration** says what was *asked for*.
- A **status item** says what is *true on the device*.

The management plane can always tell you the first. For several layers it structurally
cannot tell you the second — not because of a missing integration, but because the
platform exposes no status key at all.

**And that is precisely the seam the nine-layer diagram walks.** Every failure it lists
is the same failure in a different costume: *the intent was recorded, and something
downstream did not honour it.* Profile assigned but not received. PPPC payload present
but TCC still denying. Extension policy present but the extension silently not loading.
Nine layers, nine chances for a declaration to be true and reality to disagree.

An operator with that diagram is doing one thing, nine times, by hand: **comparing what
was declared against what was observed, and finding the layer where they diverge.**

---

## The idea: make the divergence itself the signal

**Status: NOT IMPLEMENTED. This is a proposal, and the gap is measured, not assumed.**

What exists today:

- `lib/signalgrid-simulator/src/decisionEngine.ts:120` reads `declaredState` and fails
  closed when it is `"stale"`.
- `lib/signalgrid-simulator/src/scenarios.ts:16` carries an
  `apple.ddm_declared_state` signal with `configurationStatus: "applied"`.
- `apple-schema.ts` already knows which properties can be observed and which can only be
  declared.

What does not exist:

```
$ grep -rl "observedState" lib/signalgrid-core/src lib/signalgrid-simulator/src | wc -l
0
```

So the engine can consume a declaration, and it can notice a declaration has gone
stale. **What it cannot express is that a declaration and an observation disagree.**

The proposal is a signal shape that carries both, plus its provenance:

- what the management plane **declares** for a property,
- what an independent source **observed** for the same property,
- and the verdict when they differ.

Divergence would be a first-class outcome, not an absence. It is not "unknown" — it is
worse than unknown, because one system is actively asserting something another
contradicts. Under this repository's fail-closed doctrine, a contradiction must tighten
the answer at least as hard as an absence does, and probably harder: an unknown is a
gap, a contradiction is a *fault*.

### Why this is defensible rather than clever

The pattern already exists in this codebase, in one family, and was arrived at
independently:

`device-attestation/evaluate.ts` refuses to abstain when a report declares
`attestable: false` while *also* carrying attestation evidence. Its comment: *"A report
that says the device cannot attest yet still presents a chain or attested facts is
malformed or tampered; it must NEVER abstain."* That is exactly declared-versus-observed
divergence, treated as a fault, in one dimension. The proposal is to make it a general
capability rather than one family's local insight.

### What it would need

1. A signal shape carrying declared and observed values with their sources.
2. A rule in the decision core: divergence tightens, and names both sources so the
   operator sees *which two systems disagree* — the answer the layer walk was hunting
   for.
3. An independent observer for the layers DDM cannot report. **This lane already has
   one**: the Fleet/osquery telemetry connector and the live Fleet lab lane. Whether
   osquery can read a given layer is an open question per layer and must be tested, not
   assumed — but the second source exists, which is the hard part.

---

## What the layer walk says about coverage

The diagram's nine layers against the 51 connector families, checked rather than
recalled:

| Layer | Coverage today |
| --- | --- |
| MDM check-in | **Strong.** `device-management-health` carries `mdmCheckInFreshness`, `agentCheckInFreshness`, `enrollmentState`, `complianceCoverage`, `managementEffective`, `policyDrift`. |
| System / kernel extension | **Partial.** `macos-posture` carries `sysextConflict`, `sysextResidual`, `sysextUnreliable` — extension *health*, not the diagram's *approval* state (Team ID approved, extension allowed). |
| Application / service | **Partial**, across `app-update`, `service-lifecycle`, `link-usability`. |
| APNs delivery | **Thin.** `managementReachable` is the nearest thing. |
| Config profile installation | **Thin.** `policyDrift` is adjacent; profile-received / payload-conflict / scope-mismatch are not modelled. |
| **PPPC / TCC privacy decision** | **Structurally unobservable via DDM** — and `check:absence "TCC privacy permission"` returns CORROBORATED across four probes: no file, no directory, no workflow, no source mention. |
| User experience | The Assist gate itself. |

The bottom row is the interesting one, and not because someone forgot it. **The layer
with no signal is the layer the platform declines to report** — and per the diagram it
is the layer that produces the most user-visible symptom of all: *"user prompt still
appearing."* The worker sees a permission dialog nobody can explain, and the management
console says everything is compliant. Both are telling the truth.

---

## What the other sources point at

**The hospital information system diagram** gives the pilot its concreteness. Its
modules are not equally risky: medication administration touches pharmacy and clinical
records; scheduling does not. `lib/app-workflows` already carries risk tiers — keying
them to named HIS modules turns "high-stakes workflow" from an adjective into
something a customer can point at on their own architecture diagram.

**The convergence research in `attached_assets/`** — physical access control, identity,
mobile credentials, FIDO2 — describes the seam that is this product's actual moat, and
the connectors already exist for it (`pacs-access`, `rtls-custody`, `custody-beacon`,
`passkey-assurance`). Physical custody is the one input no IAM or UEM vendor holds,
because it originates in a badge reader and a door, not in software.

**The second-opinion review** asked how SignalGrid answers *"why not just extend our
existing Okta / CrowdStrike / ServiceNow deployment?"* The declared-versus-observed
framing is the sharpest answer available: **the existing stack is the thing making the
declaration.** It cannot audit its own assertion, and a vendor cannot corroborate itself
from one vantage point. A layer whose entire job is comparing two independent sources is
structurally something no single incumbent can be — not because they lack the
engineering, but because they are one of the two sources.

---

## Honest limits

- Everything under "the idea" is **unbuilt**. The measurement of what is missing is
  real; the design is a proposal and no more.
- Whether osquery can observe any specific layer is **untested here**. Naming Fleet as
  the second source is a hypothesis with a lane attached, not a capability.
- The nine-layer diagram is macOS. Whether the same seam exists in the same shape on
  iOS, Android and Windows is unexamined, and the answer probably differs per platform.
- Nothing here is sourced from the founder's personal screen-capture archive. That
  material is private, contains medical correspondence, and no part of it informs this
  page or belongs in this repository.
