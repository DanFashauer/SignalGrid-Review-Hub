# Company-building vs product-building — the boundary, drawn where it already is

**RATIFIED by the owner, 2026-08-18: one repository, explicit boundary.**

The owner asked whether company-building and product-building need separating.
The honest answer: **the separation already exists inside this repository, and
making it physical (two repos) today would weaken the product's strongest
property.** This document draws the existing boundary explicitly, states the
recommendation and its reasons, and names the concrete triggers that would
flip the answer — so the decision is recorded rather than re-argued.

## The two tracks, as they stand

**Product-building** (the thing that must be provably true):

| Surface | What lives there |
| --- | --- |
| `lib/*` | decision core, connectors, flows, bridges — the deterministic engine |
| `artifacts/api-server`, `artifacts/signalgrid-*`, `artifacts/mcp-server` | the served surfaces |
| `scripts/*` | every proof, gate, and guard; preflight; the sim/lane loops |
| `native/*`, `firmware/*` | the app and dock surfaces (launch profile classifies each) |
| `docs/` (technical) | CI_AND_VALIDATION, LAUNCH_PROFILE, threat_model, the live-integration write-ups |

**Company-building** (the thing that must be persuasively true — and is held
to the same honesty bar):

| Surface | What lives there |
| --- | --- |
| `docs/research/*` | competitive briefs, partner candidates, market landscape, design studies |
| `docs/EXECUTIVE_ONE_PAGER.md`, `OUTREACH_EMAIL_TEMPLATES.md`, `FIRST_CALL_TALK_TRACK.md` | outreach voice (hello@signalgrid.app lives ONLY here) |
| `docs/PARTNER_ONBOARDING.md`, `SECURITY_QUESTIONNAIRE_PACK.md`, `PILOT_SCOPE_SKELETON.md` | the partner/assessor path |
| `docs/OWNER_ACTIONS.md`, `docs/INTAKE_LEDGER.md`, `docs/BUILD_BACKLOG.md` | operating memory — deliberately spanning both tracks |
| `artifacts/signalgrid-web` | the marketing site — a company artifact BUILT like a product artifact, and truth-swept like one |

## Recommendation: one repository, explicit boundary — not a split

Three reasons, in order of weight:

1. **The gates are the moat, and they only bite across the boundary.** The
   cited-path gate holds every company claim against the product tree; the
   docs-sanity and figure guards fail the build when marketing drifts from
   measurement; the website truth pass was possible BECAUSE the site sits in
   the same tree as the proofs it must not contradict. Split the repos and
   every one of those checks goes blind exactly where over-claiming happens.
2. **One founder, one review surface.** Two repos double the PR queues, the CI
   fleets, the sync gates, and the places a bot must watch — for a team of one
   plus agents, that is pure overhead with no isolation benefit.
3. **The estate is already consolidating, not expanding.** Seven repositories
   exist; two (dev, signalgrid) are retirement-pending on the owner board.
   Adding an eighth while retiring two would move against the current.

## The triggers that flip this answer

Recorded so the split happens for a reason, not a mood:

- **A person joins who needs company docs but must not hold the code** (a
  fractional exec, an agency, a diligence data room) — split the company docs
  into a private repo at that moment, and keep a cited-path gate pointing back.
- **The website needs its own deploy cadence** faster than the product's CI.
- **An investor process demands a clean data room** — export, don't fork: the
  one-pager, questionnaire pack, and pilot skeleton are already self-contained.

## The watch fabric — which agent checks what, and when

This table is the answer to "are the bots synced and always validating":

| Watcher | Cadence | Scope | Verified green as of 2026-08-18 |
| --- | --- | --- | --- |
| Per-push CI (13 checks) | every push/PR | full gate suite, both prod stacks, CodeQL, secret scan, SBOM | ✅ every merged head |
| Scheduled Verification | daily 07:17 UTC | launch gates + breadth lane on the default branch; opens a tracking issue on regression | ✅ ran this morning |
| Mac lane (full suite) | weekly Mon 06:00 UTC | the macOS CI mirror of the harness | ✅ ran 2026-08-17 |
| CodeQL + supply-chain | weekly Mon 07:17 UTC | static analysis + SBOM/secret sweep | ✅ |
| Dependabot | weekly, grouped | dependency currency (queue cleared 2026-08-18, nine for nine) | ✅ |
| Codex review bot | every PR ready/push | independent automated review (three real findings on the vite bump alone) | ✅ active |
| Cloud agent session | hourly self check-in + PR webhooks | drive-to-green on watched PRs, lane inbox, sim-request loop | ✅ this session |
| Owner's Mac lane | when awake | `sim:run-requests`, live evidence mint, lane mail | last active 2026-08-18 (baseline + bash fix) |
| `scan:estate` | on demand (cloud lane, needs /workspace clones) | cited paths across all seven repositories | ✅ 7/7 scanned 2026-08-18 |

Two known holes, stated rather than smoothed: the estate scan is on-demand
(not CI — CI has one checkout), and the Mac lane is a human-cadence watcher by
design — its pending work is always visible via `check-sim-requests` and
`check-lane-messages`, which report but never silently pass.
