# Cost model — the cost side the published prices never had

Backlog row 22, landed from the finance-lens draft. The site publishes $8/$14
per-device prices; until this page, no cost side existed anywhere in the tree.
Rules of this document, in force before any number: **every figure is
repo-verified or marked TBD/ASSUMED — an invented dollar is this lens's
version of the unearned green.** Owned by finance-fundraising +
agent-ops-economics.

**The owner-private channel.** The three billing values the owner has already
supplied (Claude, ChatGPT, domain) and any future ones are deliberately NOT in
this public repository. They live in the owner's private record; computation
happens in-session against this page's published denominators, and only
DERIVED, non-reversible aggregates (e.g. cost-per-shift trend direction) may
ever be committed. A TBD line below is closed by the owner naming the number
in chat, never by committing it here.

## 1. Serving one tenant — deferred architecture (`docker-compose.prod.yml`)

- **Stack**: 1× postgres:16 (durable volume `sg_pgdata`) + 1× node:22 api
  container (2.2MB bundle, `/api/healthz` liveness). Web is a static build
  behind nginx (dev compose only; no gate builds it). **No Redis in the
  product** — Redis appears only inside Fleet's own stack.
- **Capacity**: limiter-bound, not compute-bound. Default 240 req/min per key
  (`rateLimit.ts:56`, `SIGNALGRID_V1_RATE_LIMIT`); decision core p95 1.27ms,
  5,128 decisions/sec on 4 workers (`RELIABILITY_SLO.md`). One small VM
  (2 vCPU / 4GB class) over-serves a tenant by orders of magnitude; marginal
  compute per added tenant ≈ $0 until the limiter is deliberately raised.
- **Line items**: VM hosting — TBD (public price list, agent-computable).
  Backup storage for `sg_pgdata` — TBD. TLS/domain — optional
  (`OWNER_ACTIONS.md:197`).

## 2. MDM / device lines (per deployment)

- **Fleet self-hosted**: mysql:8 + redis:6.2 + fleet server (MIT, license $0)
  = a second small VM — hosting TBD.
- **Fleet Premium**: OPEN — the team-scoped `getPolicies()` branch needs
  Premium; trial expires 2026-09-16; per-device price TBD (public page,
  agent-computable). This is the one identified paid software dependency.
- **APNs + Apple Business Manager**: owner enrollment; Apple Developer
  Program fee ASSUMED ~$99/yr — confirm (owner hands, billing item).
- **Supervised devices**: hardware is customer-side; no hardware for sale
  (`Pricing.tsx` FAQ).

## 3. Company run-rate

- **CI**: $0 while this repo is public. Exposure if that changes: ios-ci up
  to 135 macOS-minutes/trigger at the 10× multiplier; desktop windows matrix
  2×; mac-lane 60 macOS-min weekly; scheduled-verification 45 ubuntu-min
  daily; observed volume 576 commits/month. The first real bill arrives the
  day visibility changes or a private sibling repo replicates these lanes.
- **Agent org**: Claude subscription/API spend — owner hands, the only
  missing numerator. (Supplied 2026-08-21 through the private channel; not
  republished here, per the rule above.)

## 4. Cost-per-shift — computable today except the dollars

- **shift** := one bounded engagement whose outcome is a committed ledger row
  (`VIRTUAL_TEAM.md:30-32`; 97 rows at draft time — the ledger is the live
  count).
- **Denominators from committed artifacts, no new tooling**: Claude-authored
  commits per shift (377 since 2026-07-20 vs ~178 owner-authored, via git-log
  ranges between ledger-row commits); verification wall-clock per shift from
  `sim-results` `durationMs` (e.g. `everything` = 108.3s, `live-lanes` =
  68.7s) and `build-loop/history.jsonl` timestamps.
- **Definition, armed for the day the numerator lands**:
  cost-per-shift = (monthly agent spend) ÷ (ledger rows closed that month),
  reported beside commits/shift so efficiency drift is visible.
- **Rule**: publish denominators now; never publish an invented dollar.

## What closes each TBD

| Line | Closes when | Who |
| --- | --- | --- |
| VM + backup hosting | an agent computes it from a public price list at deployment-decision time | any lane |
| Fleet Premium per-device | read from Fleet's public pricing page when the Premium decision is live | any lane |
| Apple Developer fee | owner confirms status + fee (billing item, still owed) | owner |
| Agent spend numerator | already supplied via the private channel; recomputed monthly there | owner + session |
