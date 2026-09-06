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
  (`rateLimit.ts:56`, `SIGNALGRID_V1_RATE_LIMIT`); decision core p95 1.0458 ms,
  5,370 decisions/sec on 4 workers — the 2026-08-24 column of `RELIABILITY_SLO.md`
  (this line quoted the 2026-08-19 column, 1.27 ms / 5,128, until 2026-09-06; the two
  runs were on different hardware and are not a trend). One small VM
  (2 vCPU / 4GB class) over-serves a tenant by orders of magnitude; marginal
  compute per added tenant ≈ $0 until the limiter is deliberately raised.
- **Line items**: VM hosting — TBD (public price list, agent-computable).
  Backup storage for `sg_pgdata` — TBD. TLS/domain — optional
  (`OWNER_ACTIONS.md:210`).

## 2. MDM / device lines (per deployment)

- **Fleet self-hosted**: mysql:8 + redis:6.2 + fleet server (MIT, license $0)
  = a second small VM — hosting TBD.
- **Fleet Premium**: OPEN — the team-scoped `getPolicies()` branch needs
  Premium; trial expires 2026-09-16; per-device price TBD (public page,
  agent-computable). This is the one identified paid software dependency.
- **APNs + Apple Business Manager**: NOT YET ENROLLED (owner-confirmed
  2026-08-22) — $0 today. The ~$99/yr fee lands only when the supervised-
  device path needs APNs; the 30-day plan schedules enrollment at that
  point, not before.
- **Supervised devices**: hardware is customer-side; no hardware for sale
  (`Pricing.tsx` FAQ).

## 3. Company run-rate

- **CI**: $0 across the estate (owner-confirmed 2026-08-22: free plan, ALL
  seven repos public). Exposure if that ever changes: ios-ci up to 135
  macOS-minutes/trigger at the 10× multiplier; desktop windows matrix 2×;
  mac-lane 60 macOS-min weekly; scheduled-verification 45 ubuntu-min daily;
  observed volume 576 commits/month. The first real bill arrives the day any
  repo running these lanes goes private.
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
| Apple Developer fee | CLOSED 2026-08-22: not enrolled, $0 today; enrollment scheduled by the device-path milestone | — |
| Agent spend numerator | already supplied via the private channel; recomputed monthly there | owner + session |

## Register — every currency amount this tree states

`scripts/check-cost-figures.mjs` scans every tracked `.md`, `.ts` and `.tsx` file for
currency amounts and fails on any that is not a row below. It exists because three
documents under `docs/company/` asserted that "No cost or billing figure appears in this
repository, and none may" while `Pricing.tsx` printed $8 and $14 on a published page and
this document printed more — a false absolute survives exactly as long as nothing counts.
`docs/company/ROLE_LENS_REVIEW_2026-08-21.md:516` asked for the gate; this is the register
it resolves against.

**Classes.** `ZERO` — a stated cost of nothing (allowed outright; a cost of nothing is
rhetoric, not a price). `PUBLISHED-PRICE` — SignalGrid's own published price.
`VENDOR-PUBLIC` — a third party's published list price. `MARKET-PUBLIC` — a competitor's
or market's public financial figure. `PLANNING` — a band this repository reasons about,
never a price it has charged or a raise it has taken. `ILLUSTRATIVE` — an invented number
inside demo or fixture copy. `OWNER-SUPPLIED` / `TBD` / `HISTORICAL` — declared for the
lines this register does not yet carry.

**The four owner-only lines stay out of it.** Monthly Claude spend, Apple Developer
status/fee, GitHub plan and total domain spend are owner-only by DR-005 item 4 and live in
the owner's private channel. A `VENDOR-PUBLIC` row for Apple's published $99/yr list price
is not one of them; a figure for what this company actually pays would be, and the gate
fails on any amount published as our own spend on those four lines. An `ASSUMED`/`TBD`
marking is allowed and reported — deleting the word `ASSUMED` must never be the way to
make a build green.

**The register key is the money, not the typography.** Commas are dropped, the magnitude
letter is upper-cased, and a per-unit suffix is not part of the key: `$14`, `$14/device`
and `$ 14` are one row. This table's own rows are excluded from the scan — a catalogue of
a figure is not a statement of it, and counting them would make the stale-row report
permanently empty.

| Amount | Class | What it is, and where the tree states it |
| --- | --- | --- |
| `$0` | ZERO | a stated cost of nothing, 27× across the tree — `docs/COST_MODEL.md` §1–3, `docs/ZERO_COST_LIVE_TEST_MATRIX.md`, `docs/DECISION_RECORDS.md`. Allowed outright by the gate; this row records why. |
| `$14` | PUBLISHED-PRICE | SignalGrid Enterprise, per device / month — `artifacts/signalgrid-web/src/pages/Pricing.tsx` |
| `$8` | PUBLISHED-PRICE | SignalGrid Starter, per device / month — `artifacts/signalgrid-web/src/pages/Pricing.tsx` |
| `$10` | VENDOR-PUBLIC | an NFC tag, ~street price — `docs/lab/LAB_001.md` |
| `$1199` | VENDOR-PUBLIC | Visual Studio Professional/Enterprise standard subscription, first year — `docs/ZERO_COST_LIVE_TEST_MATRIX.md` |
| `$25` | VENDOR-PUBLIC | physical FIDO2 key, ~street price — `docs/ZERO_COST_LIVE_TEST_MATRIX.md` |
| `$250` | VENDOR-PUBLIC | Maestro Cloud, ~per device / month — `docs/ZERO_COST_LIVE_TEST_MATRIX.md` |
| `$299` | VENDOR-PUBLIC | Apple Developer Enterprise Program annual fee — `docs/ZERO_COST_LIVE_TEST_MATRIX.md` |
| `$45-169` | VENDOR-PUBLIC | Proxmark3 / Flipper Zero, unverified street range — `docs/ZERO_COST_LIVE_TEST_MATRIX.md` |
| `$9` | VENDOR-PUBLIC | Entra ID P2 / Governance, ~per user / month — `docs/ZERO_COST_LIVE_TEST_MATRIX.md` |
| `$99` | VENDOR-PUBLIC | Apple Developer Program annual fee, stated ASSUMED/unverified — `docs/COMPANY_BUILD_PLAN.md`, `docs/ZERO_COST_LIVE_TEST_MATRIX.md`, §2 above; also the illustrative Enterprise tier in `.claude/agents/planner.md` |
| `$150K-350K` | PLANNING | cumulative build-cost band, paid-pilot readiness — `docs/REALISTIC_LAUNCH_PLAN.md` |
| `$15K-50K` | PLANNING | build-cost band, company setup + demo completion — `docs/REALISTIC_LAUNCH_PLAN.md` |
| `$250-750K` | PLANNING | the pre-seed reference class path B frames — `docs/company/FUNDING_READINESS.md`, `docs/company/INVESTOR_ONE_PAGER.md`. A band this repository reasons about, not a raise it has taken. |
| `$25000-75000` | PLANNING | proposed design-partner pilot fee band — `docs/REALISTIC_LAUNCH_PLAN.md` |
| `$500K-1.2M` | PLANNING | cumulative build-cost band, production SaaS first year — `docs/REALISTIC_LAUNCH_PLAN.md` |
| `$75000-200000` | PLANNING | proposed annual contract band, to be validated in discovery — `docs/REALISTIC_LAUNCH_PLAN.md` |
| `$75K-200K` | PLANNING | build-cost band, tenant/auth + Microsoft sandbox foundation — `docs/REALISTIC_LAUNCH_PLAN.md` |
| `$10000` | ILLUSTRATIVE | invented inventory-adjustment threshold in demo fixture copy — `artifacts/signalgrid-review/src/data/demoData.ts` |
| `$240000` | ILLUSTRATIVE | invented pallet-movement value in demo fixture copy — `artifacts/signalgrid-review/src/data/demoData.ts` |
| `$29` | ILLUSTRATIVE | example Pro tier in an agent prompt's worked example — `.claude/agents/planner.md` |
| `$380000` | ILLUSTRATIVE | invented mortgage value in demo fixture copy — `artifacts/signalgrid-review/src/data/demoData.ts` |
| `$4500` | ILLUSTRATIVE | invented merchandise value in demo fixture copy — `artifacts/signalgrid-review/src/data/demoData.ts` |
| `$1.1B` | MARKET-PUBLIC | Teleport Series C valuation — `docs/research/COMPETITIVE_TELEPORT.md` |
| `$10-25M` | MARKET-PUBLIC | OLOID revenue, third-party estimate marked soft — `docs/research/COMPETITIVE_OLOID.md` |
| `$100B` | MARKET-PUBLIC | CrowdStrike platform scale, approximate — `docs/research/COMPETITIVE_SGNL.md` |
| `$110M` | MARKET-PUBLIC | Teleport Series C — `docs/research/COMPETITIVE_TELEPORT.md` |
| `$12M` | MARKET-PUBLIC | OLOID Series A — `docs/research/COMPETITIVE_OLOID.md` |
| `$130M` | MARKET-PUBLIC | Imprivata getLatka revenue figure — `docs/research/COMPETITIVE_IMPRIVATA.md`, quoted in `docs/COMPANY_BUILD_PLAN.md` |
| `$169M` | MARKET-PUBLIC | Teleport total raised, approximate — `docs/research/COMPETITIVE_TELEPORT.md` |
| `$26.4M` | MARKET-PUBLIC | OLOID total raised, precise figure — `docs/research/COMPETITIVE_OLOID.md` |
| `$26M` | MARKET-PUBLIC | OLOID total raised, approximate — `docs/research/COMPETITIVE_OLOID.md` |
| `$30M` | MARKET-PUBLIC | SGNL funding round — `docs/research/COMPETITIVE_SGNL.md` |
| `$400M` | MARKET-PUBLIC | Claroty Series E — `docs/inspiration/OT_ICS_SCADA_API_CATALOG.md` |
| `$42M` | MARKET-PUBLIC | SGNL total raised — `docs/research/COMPETITIVE_SGNL.md` |
| `$500M` | MARKET-PUBLIC | Imprivata revenue figure, rounded — `docs/research/COMPETITIVE_IMPRIVATA.md`, quoted in `docs/COMPANY_BUILD_PLAN.md` |
| `$544M` | MARKET-PUBLIC | Imprivata revenue figure — `docs/research/COMPETITIVE_IMPRIVATA.md` |
| `$5M` | MARKET-PUBLIC | OLOID seed — `docs/research/COMPETITIVE_OLOID.md` |
| `$600` | MARKET-PUBLIC | GE Vernova's sale of Proficy to TPG, stated in millions — `docs/inspiration/OT_ICS_SCADA_API_CATALOG.md` |
| `$600M` | MARKET-PUBLIC | the same Proficy sale, stated with the magnitude letter — `docs/inspiration/OT_ICS_SCADA_API_CATALOG.md` |
| `$6M` | MARKET-PUBLIC | OLOID Series A1, approximate — `docs/research/COMPETITIVE_OLOID.md` |
| `$740M` | MARKET-PUBLIC | CrowdStrike's announced acquisition price for SGNL — `docs/research/COMPETITIVE_SGNL.md`, `docs/research/COMPETITIVE_BATTLECARD.md`, `docs/research/MARKET_LANDSCAPE.md` |

