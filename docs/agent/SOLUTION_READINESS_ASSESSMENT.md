# Solution readiness assessment — the whole repo, evaluated end to end

**Date: 2026-09-01. Method: an independent six-dimension evaluation (build,
tests, security-adversarial, decision-core, claims, operational readiness), each
dimension read the real code and cited file:line; the severe findings were then
adversarially re-verified against the tree. An ECC full-evaluation pass is queued
to the Mac lane in parallel (`artifacts/sim-requests/2026-09-01-ecc-full-evaluation.json`)
so two independent verdicts can be compared. This is a snapshot of what the code
does today — not a certification.**

## The one-paragraph verdict

SignalGrid is an **unusually rigorous, unusually honest engineering demonstrator
with a real persistence spine and no security bypass found** — and it is **not
yet a system that decides about a real customer's estate.** Those are both true,
and the distance between them is well-defined and largely self-declared. The hard
parts are done: the decision core is deterministic and fail-closed, 139 proofs
each assert something that can fail, every surface builds, and an adversarial read
of the auth and decision paths found no auth bypass, no tenant crossing, and no
fail-open. What remains is not more of the same — it is the set of things that
need a real tenant, real credentials, and a real integration wire to build
against: the served product runs the demo core, no secret ever flows through a
manager, no connector authenticates to a live vendor in the deployable image, and
the verdict the gate returns (`step_up`) has no launch path that can answer it.
**The reason it can feel like "only parts get done" is that the finished parts are
the deep engineering and the unfinished parts are the ones gated on customer
reality — which is why the discovery number, not the code, is what moves next.**

## Six-dimension scorecard

| Dimension | Standing | The honest summary |
| --- | --- | --- |
| Build & release | **Strong** | Every surface builds (verified, not taken on faith); lockfile↔CI parity real; Docker images boot-smoke-tested end to end. Gap is *delivery*: no hosted instance, self-host compose only — disclosed, not hidden. |
| Tests & proofs | **Strong** | ~15 proofs sampled + the load-bearing core read: zero tautological proofs found; negative controls and exhaustive sweeps are real. Among the most rigorous coverage the reader had seen. |
| Security (adversarial) | **Strong** | A paper attack on WebAuthn, OIDC, tenant isolation, step-up and the decision core found **no** auth bypass, tenant crossing, or fail-open. The one real security gap is operational: no secrets manager (below). |
| Decision core | **Strong** | Determinism enforced structurally (no clock/random in the decision path), fail-closed on the mainline, verdict enum matches DR-020. Minor hardening notes, no correctness break. |
| Claims & doctrine | **Was weak, now repaired** | Three confirmed-high buyer-facing overclaims — fixed this pass (see below). The gate hole that hid them is closed. |
| Operational readiness | **Partial — this is the real roadmap** | Persistence spine is near-ready; secrets, live connector wiring, data lifecycle, the real tenant, and verdict enforcement are missing. Detailed below. |

## What this pass already fixed (claims dimension)

Three high-severity findings, each confirmed against the code and remediated in
commit that precedes this document:

1. The retired category label (superseded by DR-019/DR-020) was live on the
   investor pitch deck, the executive one-pager, and `docs/POSITIONING.md` — the
   declared single source of truth. All reconciled; `docs/PURPOSE.md` owns the
   product sentence and no category label is ratified.
2. The executive one-pager claimed four live-vendor proofs "run in CI"; they do
   not. Corrected to the truth and registered in `docs/agent/FALSE_CLAIMS.json`
   so the phrasing cannot silently return.
3. The retired-label gate scanned only the app source and README, never the
   published docs — so it could not see any of the above. Folded the buyer-facing
   document set into the scan; it immediately caught three more (the talk track
   and outreach templates) that were also fixed.

## What is actually left to build — the real completion list

From the operational-readiness read and the launch profile's own declared
`GAPS`, verified against source. These are the items between "green here" and
"runs for a paying customer," most consequential first:

1. **A non-demo core.** The served API constructs `SignalGridCore.demo()` on a
   fixed clock with seeded fixtures; it never wires the real Graph connector code
   that exists in `lib/`. This is the single largest gap — the deployment
   demonstrates *in* a customer environment but does not decide *about* the
   customer's estate. (`scripts/launch-profile.mjs` gap `non-demo-core-constructor`.)
2. **Verdict enforcement.** The gate returns `step_up` in shadow mode — no launch
   route can answer one. A recommended verdict the product cannot perform is only
   half a product. (gap `step-up-answerability`.)
3. **Real connector auth in the deployable image.** The read-only Graph transport
   exists and makes real calls, but the shipped server imports none of it; the
   prod image runs the fixture core. (gap `device-management-health`.)
4. **Secrets management.** No manager exists; the ratified model (DR-010) is
   unimplemented, rotation is a runbook claim. Every credential flows as plain
   env today. (`docs/SECRET_MODEL.md`.) This is the one security gap the
   adversarial pass flagged as real.
5. **Data lifecycle.** No retention, deletion, or DSAR mechanism in any durable
   store; caller-supplied request context is persisted whole with no deletion
   path. (`docs/DATA_RETENTION_AND_PERSONAL_DATA.md`, DR-003.)
6. **The Assist wire an SDK actually binds.** The Kotlin/Rust SDKs bind a planned
   `POST /v1/authorize` that is not served or in the spec; the real envelope today
   is `POST /v1/decisions/evaluate`. (gap `assist-wire-unserved`, DR-007.)
7. **Runtime enforced-vs-observed status.** No route reports, per signal kind,
   what the running server actually enforces. (gap `runtime-launch-status`.)

Items 1–7 are now tracked as backlog rows. Six of the seven are self-declared in
the launch profile already — the evaluation confirms the repo's own accounting is
honest, which is itself the strongest maturity signal here.

## The sequence you asked for, mapped to reality

Build → test → secure → review → brute-force → test again → validate, against
what is actually true today:

- **Build** — done. Every surface compiles; CI mirrors it.
- **Test** — done for what exists. `preflight` + `verify:breadth` green; 139
  falsifiable proofs. Coverage is honest about what it does *not* cover.
- **Secure** — strong on code (no bypass found), with one real gap: secrets
  management (#4). Security is not a one-time pass; the gates keep it standing.
- **Review** — this evaluation, plus the ECC pass queued to the Mac lane. Compare
  the two verdicts when ECC's lands; a disagreement is a finding.
- **Brute-force / adversarial** — the paper attack is done (no live infra exists
  to attack). Real fuzz (Schemathesis against `/v1`, which the evidence-toolchain
  skill blesses) is part of the queued ECC sequence on the Mac lane.
- **Test again / validate** — `preflight` + `verify:breadth` are green as of this
  commit; re-run after each completion-list item lands.

The completion list is not a testing gap — it is a *build* gap, and most of it
cannot be honestly built without a design partner's tenant and credentials. That
is the strategic finding: the code is ready for a customer to be built against;
the missing input is the customer.
