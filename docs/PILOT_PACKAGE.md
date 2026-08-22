# The Shared-Device Trust Pilot — 30–45 days, shadow mode, read-only

**One page a lean-IT lead can say yes to.** Basis: DR-011/DR-012 and the
launch profile — nothing offered here exceeds what ships at Limited GA, and
every capability named traces to a proof that runs on every commit.

## What you get

For 30–45 days, SignalGrid watches a slice of your shared-device fleet in
**shadow mode**: it computes an allow / step-up / restrict / deny verdict for
sensitive-action checkpoints, records the evidence — and **blocks nothing**.
At the end you have data nobody's console gives you today:

| The six questions the pilot answers | Why it matters |
| --- | --- |
| How many devices had FRESH management evidence when it counted? | "Compliant" with no timestamp is a guess wearing a badge |
| How often did local evidence disagree with your system of record? | Disagreement is where incidents live |
| How many "healthy" devices were actually stale? | The unearned green, counted |
| How often was the context a decision needed simply missing? | Missing is a finding, not a shrug |
| How fast can an operator understand WHY a verdict changed? | Evidence beats dashboards |
| After a fix, could recovery be verified automatically? | Trust restored is trust proven |

**Success measure zero, always on: unknown-to-trusted escapes = 0.** No
device earns trust it didn't prove. That property is machine-checked in our
public repository on every commit.

## What it costs you

- **Scope**: 25–100 shared endpoints, ONE operational workflow, your choice.
- **Access**: a read-only service account on your device-management source —
  Fleet is proven live end-to-end today; if you run something else, the
  evidence contract is source-agnostic and your stack sets our adapter
  priority. Read-only means read-only: the mutation-refusal property is
  gate-checked in public.
- **Time**: one 45-minute setup session, one mid-point check-in, one results
  readout. No agent rollout is required for the shadow phase's core signals.
- **Money**: the pilot is free. If it earns a yes, Limited GA pricing is
  published ($8/$14 per device/month) with its cost basis documented.

## What we will never do during the pilot

No writes to any of your systems. No device enforcement (that is your MDM's
job, and stays so). No clinical, financial, or personal record access —
verdicts are computed from device evidence, not business data. No claim in
any report that the public gates can't back. You can end the pilot with one
email; anything we hold is deleted on request.

## Why trust a company this small

Because you can read it. The engine, the proofs, the audit ledger, the
security review package, and the release evidence (SBOM, signed artifacts,
scanner results) are public: the repository is the due-diligence packet.
Your security reviewer starts at `docs/SECURITY_REVIEW_PACKAGE.md`; every
door in it is machine-checked to open.

## The ask

If you run 75–1,000 people with shared frontline devices and a small IT
team: 45 minutes to scope it, one read-only account, and a slice of your
fleet. We'll show you where your green is real — and where it's just the
last thing anyone recorded.
