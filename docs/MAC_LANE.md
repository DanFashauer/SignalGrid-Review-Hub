# The Mac lane — what a cloud runner can prove, and what only your Mac can

Most of this repo runs anywhere. Three things do not, and conflating them with the
rest is how a rehearsal starts reading as evidence.

## The three tiers, and why the boundary is load-bearing

| Tier | Where it runs | What it genuinely proves | What it cannot prove |
| --- | --- | --- | --- |
| **Linux CI** (`review-hub-ci.yml`) | every PR | typecheck, build, every proof, API tests, safety gate, supply chain | anything macOS- or device-specific |
| **Mac rehearsal** (`mac-lane.yml`) | dispatch + weekly, `macos-latest` | the full suite passes on macOS; iOS targets compile | **nothing about real hardware** — a hosted runner is a throwaway VM |
| **Real Mac** (your machine) | you, by hand | genuine macOS posture read off a real managed device; the signalgrid-mcp half against the shared contract | on-device MDM enforcement, unless the Mac is actually supervised |

The middle row is new, and it closed a real hole. `verify-all.mjs` gated evidence
minting on `process.platform === "darwin"`, reasoning that this was *"a condition a
cloud sandbox cannot satisfy by accident."* A GitHub macOS runner is a cloud sandbox
that satisfies it exactly — and this repo already runs one for `ios-ci.yml`. Adding a
macOS workflow without fixing that first would have let CI mint a file asserting your
real machine ran it. `verify-all.mjs` now refuses under CI, so the boundary is
enforced by the script rather than by everyone remembering.

## What CI now does for you

`mac-lane.yml` runs `./validate-sim-macos.sh` on `macos-latest` — on manual dispatch
and weekly. Before this, the largest gate set in the repo was the one least often
run, and "the suite is green" rested on whoever last ran it by hand.

It also asserts the harness restored `package.json` and `pnpm-lock.yaml` after its
`pnpm add -w`. If that restore ever breaks, the lockfile drifts and CI's
`--frozen-lockfile` starts failing on unrelated PRs — a confusing symptom a long way
from its cause. Better to fail at the source.

**What the first run actually taught us**, since a workflow nobody has run is a claim
rather than a lane:

- The lockfile-restore assertion **passed** — "package.json and pnpm-lock.yaml are
  unchanged". It was written blind and it works.
- The suite reported **86 passed, 1 failed** — 87 gates, which independently confirms
  the count corrected in `CLAUDE.md`. The pinned "66/66" that count replaced would have
  read as a pass while 21 gates went unaccounted for.
- The one failure was `proof:enrollment-race`, which races 12 concurrent WebAuthn
  enrollments against a **real Redis** and REFUSES to run without `REDIS_URL` rather
  than skipping quietly. That refusal is correct — for a race proof a silent skip is
  indistinguishable from a pass — and the missing piece was this workflow, which never
  provided Redis. Now installed via Homebrew (macOS runners cannot use `services:`,
  which is Linux-container only) and health-checked before the suite starts, so a Redis
  that fails to come up is attributable rather than showing up as a mysterious proof
  failure.

Installing the dependency rather than dropping the gate is deliberate: a lane that
quietly omits a gate while calling itself "the full suite" is exactly the failure the
rest of this repo's guards exist to prevent.

**What the second and third runs taught us**, because the Redis fix shipped
*unverified* — a macOS runner cannot be driven from the cloud lane, and the whole
lesson of the first run was that an unrun workflow is a claim:

- The second dispatch was **cancelled before it ran a single gate**, and the run that
  survived was testing the older, broken commit. `concurrency.group` was keyed on
  `github.ref`, so a re-run of the earlier failing attempt shared a group with a fresh
  dispatch of the fix and killed it. Keyed on `github.sha` now — two dispatches of the
  same commit still dedupe, which is the real waste, while a run of one commit can no
  longer cancel a run of another. A cancelled run is not a failed run, and it is easy
  to skim past; this one silently inverted which code was under test.
- The third dispatch ran clean: **`== SUMMARY: 88 passed, 0 failed ==`**. Redis came
  up via Homebrew, `proof:enrollment-race` ran and passed, and the lockfile-restore
  assertion held again.

Note the count moved — the first run saw 87 gates, this one 88. That is the suite
growing, and it is exactly why neither this file nor `CLAUDE.md` pins a total: compare
the failure count against zero, never the pass count against a number written down
here.

Dispatch it from **Actions → Mac lane (full suite) → Run workflow**. `--sim-only` is
exposed as an input for a fast scenario-only pass.

## What still needs your actual Mac

Only this, and it is the highest-value thing on the list — it is the one place the
product touches real hardware:

```bash
# 1. Point at a signalgrid-mcp checkout (sibling clone is found automatically)
export SIGNALGRID_MCP_PATH=/path/to/signalgrid-mcp

# 2. Run both halves against the shared posture-report contract, and mint evidence
pnpm run verify:all --emit-evidence

# 3. If it emitted, publish the run
git add artifacts/live-evidence/ && git commit -m "evidence: live Mac run"
```

Emission is refused — deliberately, with no override flag — unless **all** of:

- the process is genuinely on macOS, and **not** on a CI runner;
- the Review-Hub preflight passed **and** the signalgrid-mcp pytest ran and passed
  (a *skip* does not count — a skip that minted evidence would be the lie);
- the committed `live-sync-manifest.json` exists and its contract sha matches the
  contract file on disk;
- the MCP checkout is a real git repository, so the evidence can name and reproduce
  the code that passed.

The file records fingerprints, booleans and counts only. No hostnames, usernames,
serials, local paths, or timestamps — it is committed to a public repo, and git
history already dates it.

## Two honest limits

**A green Mac rehearsal is not a green CI.** `preflight` mirrors the service-free
gates only. This suite is no longer quite service-free — it now provisions Redis for
`proof:enrollment-race` — but it still does not run `durable-persistence` (Postgres),
`deploy-stack` (Docker compose) or `secret-scan` (gitleaks), which remain Linux-CI
only. Nor does it run `phase-pr-evidence`, a job neither this lane nor `preflight`
covers; the full CI job set is larger than the six previously enumerated, and deriving
that list mechanically instead of maintaining it by hand is tracked work.

**Neither tier proves on-device enforcement.** An app cannot grant device access,
restrict other apps, make itself non-removable, or self-kiosk. Those are MDM/OS
capabilities needing a supervised device (Apple Business Manager + APNs). A hosted
runner cannot be enrolled, and a simulator cannot either. If a claim depends on
enforcement rather than observation, no lane in this table establishes it.
