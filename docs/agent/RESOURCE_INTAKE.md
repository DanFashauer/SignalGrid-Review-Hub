# Resource intake — what the owner feeds in, and what became of it

**Why this file exists (DR-021, 2026-08-31).** The owner feeds resources
continuously — repositories, articles, tools, vendor material — and directed
that they be absorbed: *"I'm going to be feeding you information all the time
for you to absorb and use to better strengthen the repo."* Every resource gets
a row here: what it was, what was done with it, and what it changed in the
tree. A row saying "evaluated, not adopted" must name what was actually run or
read — not just reasons.

**The failure mode this replaces, recorded so it is not repeated.** On
2026-08-30 the owner shared the ECC toolkit and asked for it to be set up and
used. The first response was a memo of cautions with a question at the end —
correct facts, wrong posture. The owner's correction the next day ("absorb and
use") is the operating rule now: a resource is answered with a working
integration, a measured result, or a named blocker — never with only reasons.

## Intake log

| Date | Resource | Directed by | Disposition | What it changed |
| --- | --- | --- | --- | --- |
| 2026-08-31 | IAM core-architecture framework diagram (authentication / identity / authorization boundaries around an access decision engine; no author attribution on the graphic) | Owner: shared under absorption mode | **Absorbed.** A six-reader parallel sweep held all 92 of its concepts against the tree's real code, proofs and gates: 83 proven with citations that `check:cited-paths` now verifies on every run, 3 doctrine-only, 3 absent-relevant, 3 out-of-scope with the boundary stated. Its Access Decision Engine box independently mirrors the Decision Envelope + DR-020 cascade. Product: [`docs/research/IAM_CORE_COVERAGE_MAP.md`](../research/IAM_CORE_COVERAGE_MAP.md) + three backlog rows (credential-revocation route+proof, the iOS shell's dangling SAML config keys, the undesigned retention/deletion admin job). | `docs/research/IAM_CORE_COVERAGE_MAP.md`, `docs/BUILD_BACKLOG.md`, `docs/INDEX.md` |
| 2026-08-31 | API-types taxonomy infographic ("The Complete Guide to API Types," Sathish Kumar Subramani) — open / internal / partner APIs classified by audience | Owner: shared as pattern input under absorption mode | **Absorbed.** Evaluated against the repo's real API surface: the docs classified the three served surfaces by mechanism but never by audience. `docs/API_ACCESS_AND_CONNECTORS.md` now carries a "Who each surface is for" table — `/v1` partner-facing (full contract promises), `/cp/v1` internal (fewer promises on purpose, not for third-party integration), the demo surface explicitly NOT an open API. The load-bearing sentence the taxonomy surfaced: a route being reachable does not make it supported. | `docs/API_ACCESS_AND_CONNECTORS.md` |
| 2026-08-30 | [affaan-m/ECC](https://github.com/affaan-m/ECC) — agent-harness toolkit (`ecc-universal`, MIT): review/plan/build-fix passes for coding agents | Owner: "use this as an overall strategy and final pass or additional passes" | **Absorbed.** The Mac lane hosts the harness dormant, report-only, hooks off. Its first pass (2026-08-31) found four verified fail-closed inversions in the #336 self-check tooling; all four fixed, three further findings verified and fixed, the suite wired into preflight. Cloud sessions install on demand: `pnpm run ecc:install` (pinned `ecc-universal@2.2.0`, user scope, hooks off, non-interactive — verified by a live install in the cloud sandbox 2026-08-31 on the owner's go: payload is 68 agents / 286 skills / 94 commands / 23 rules at git `005eff4`, hooks shipped but disabled, the repo's own `.claude/settings.json` untouched; commands load at next session start, so ephemeral containers re-run the script per session). One installer side effect to know: it writes `includeCoAuthoredBy: false` into user settings. ECC advises; only preflight/verify:breadth certify green (DR-021 §4). | `scripts/classify-failure.mjs`, `scripts/check-gate-census.mjs`, `scripts/scan-gaps.mjs`, `scripts/preflight.mjs`, `scripts/verify-breadth.mjs`, `docs/agent/KNOWN_CONDITIONS.json`, `package.json` (`ecc:install`) |

## Rules for a new row

1. Log the resource the day it arrives, before evaluating it.
2. Evaluate by USE — install it, run it, point it at this repo — not by
   reading its README and predicting.
3. Third-party code is pinned to an exact version and never auto-executed
   from a hook; adoption of a tool that runs in sessions gets a decision
   record if it changes how green is certified.
4. Security boundaries hold: no secrets into third-party tools, no tenant
   data, and the publication boundary applies to anything a tool writes into
   the tree.
