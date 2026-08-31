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
| 2026-08-30 | [affaan-m/ECC](https://github.com/affaan-m/ECC) — agent-harness toolkit (`ecc-universal`, MIT): review/plan/build-fix passes for coding agents | Owner: "use this as an overall strategy and final pass or additional passes" | **Absorbed.** The Mac lane hosts the harness dormant, report-only, hooks off. Its first pass (2026-08-31) found four verified fail-closed inversions in the #336 self-check tooling; all four fixed, three further findings verified and fixed, the suite wired into preflight. Cloud sessions install on demand: `pnpm run ecc:install` (pinned `ecc-universal@2.2.0`). ECC advises; only preflight/verify:breadth certify green (DR-021 §4). | `scripts/classify-failure.mjs`, `scripts/check-gate-census.mjs`, `scripts/scan-gaps.mjs`, `scripts/preflight.mjs`, `scripts/verify-breadth.mjs`, `docs/agent/KNOWN_CONDITIONS.json`, `package.json` (`ecc:install`) |

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
