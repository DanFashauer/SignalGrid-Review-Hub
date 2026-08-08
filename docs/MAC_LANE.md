# The Mac lane — what a cloud runner can prove, and what only your Mac can

Most of this repo runs anywhere. Three things do not, and conflating them with the
rest is how a rehearsal starts reading as evidence.

## The three tiers, and why the boundary is load-bearing

| Tier | Where it runs | What it genuinely proves | What it cannot prove |
| --- | --- | --- | --- |
| **Linux CI** (`review-hub-ci.yml`) | every PR | typecheck, build, every proof, API tests, safety gate, supply chain | anything macOS- or device-specific |
| **Mac rehearsal** (`mac-lane.yml`) | dispatch + weekly, `macos-latest` | the full suite passes on macOS (the harness loops every `proof:*` gate, so its size moves — read `M` from `== SUMMARY: N passed, M failed ==`, not a total pinned here); iOS targets compile | **nothing about real hardware** — a hosted runner is a throwaway VM |
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

## Docker or Podman — the container lane runs on either

The container lanes no longer spell the engine as the literal string `docker`.
`scripts/lib/container-engine.mjs` (and its shell twin `container-engine.sh`) resolve
one engine and every lane uses it.

```bash
pnpm run verify:docker                      # auto-detect: docker if its daemon answers, else podman
CONTAINER_ENGINE=podman pnpm run verify:docker   # pin the engine explicitly
```

**Auto-detection prefers Podman** — it is the chosen runtime. A machine that only has
Docker keeps working untouched: Docker is tried next and selected automatically, and
`CONTAINER_ENGINE=docker` pins it explicitly.

`CONTAINER_ENGINE` is **authoritative**. If it names an engine that does not answer,
the run FAILS rather than quietly using the other one — you asked to test a specific
engine, and silently testing the other makes the result mean something different.
Same rule as `SIGNALGRID_MCP_PATH`.

### On a Mac

Podman needs no Docker Desktop and no licence:

```bash
brew install podman && podman machine init && podman machine start
CONTAINER_ENGINE=podman ./mac-kickoff.sh --with-docker
```

### What was actually verified, and what was not

Verified under **podman 4.9.3, linux/amd64, rootful**, in this repo's cloud sandbox:

- `podman build -f Dockerfile.api` completes both stages and commits an image, with
  **no Dockerfile change** — they are ordinary OCI Dockerfiles.
- That image runs and serves `/api/healthz` → `{"status":"ok","tier":"dev","liveIntegrations":false}`.
- **The full `docker-verify` lane passes**: postgres:16 + redis:7, the three
  durable-persistence proofs (22 assertions) and the enrollment-race proof (4).
- Docker could not run in that same sandbox at all — no daemon. Podman is daemonless,
  so it gave the container lane back where there previously was none.

**NOT verified — do not read the above as covering it:**

- **Anything on macOS.** Podman on a Mac runs a VM (`podman machine`), a different
  execution model. It has to be tried on the actual Mac.
- **Rootless podman.** The verified run was rootful; rootless changes port binding
  below 1024 and volume ownership.
- **Rootless podman.** The verified run was rootful; rootless changes port binding
  below 1024 and volume ownership.

CI now runs the container lane under **both** engines on every PR — `Prod stack
(Podman)` alongside `Prod stack (Docker compose smoke)` — so a divergence between them
is a red check rather than a surprise on someone's laptop.

### One thing this fixed for both engines

Images are now named with their registry — `docker.io/library/postgres:16`, not
`postgres:16`. A short name is not a name, it is a lookup against whatever search
list the engine is configured with: Docker silently implies `docker.io`, Podman
refuses outright. Relying on the implicit default put a supply-chain decision in host
config instead of in the repo. Podman surfaced it; the fix is an improvement on both.


## What actually needs your Mac — measured, not assumed

This file used to imply the Mac was needed for most of the lane. That was overstated,
and the overstatement mattered: work deferred to a machine its owner rarely uses is
work deferred to nowhere. Checked rather than assumed:

| Capability | Where it really runs | Evidence |
| ---------- | -------------------- | -------- |
| Full gate suite (`preflight`, 110 gates) | **Cloud / CI, Linux** | runs on every PR |
| Container lane (postgres + redis + durable proofs) | **Cloud, under Podman** | 22 pg assertions + 4 race assertions green; Docker cannot start in that sandbox at all |
| Image builds (`Dockerfile.api`, `Dockerfile.web`) | **Cloud, under Podman** | both stages build; image runs and serves `/api/healthz` |
| `signalgrid-mcp` test suite | **Cloud, on Linux** | **99 passed in 2.76s** — the macOS-only reads exercise their graceful-degradation paths, which is exactly what those tests are for |
| iOS build + unit tests (EnterpriseShell, SignalGridMobile) | **GitHub `macos-latest` runners** | `ios-ci.yml`, real `xcodebuild`, on every push/PR |
| Full macOS gate suite | **GitHub `macos-latest` runners** | `mac-lane.yml`, weekly + on dispatch |
| Browser/E2E | **Cloud** | Chromium preinstalled at `/opt/pw-browsers` |

**What genuinely requires the owner's real Mac — and always will:**

- **Live evidence from a real managed device.** A hosted macOS runner is a throwaway
  VM: not MDM-enrolled, not supervised, not the machine whose posture `macos-posture`
  actually reads. `verify-all.mjs` refuses to mint evidence under CI for exactly this
  reason. A rehearsal on a runner proves the gates pass on macOS; it proves nothing
  about real hardware.
- **Anything asserting on-device MDM enforcement**, which needs a supervised device
  (ABM + APNs) — see the platform-honesty rule in `CLAUDE.md`.

Everything else in the list above is cloud-runnable today. If a doc tells you to go to
the Mac for something not in that short list, the doc is wrong.

### Solved: why the web image used to fail under Podman

`Dockerfile.web` used to fail under Podman with `vite build` reporting a **different**
unresolvable module on every run (`motion-dom`, `@radix-ui/react-context`,
`@radix-ui/react-toast`, `clsx`, …). Docker built the same file fine. Root cause,
measured rather than guessed:

```
BUILD-TIME  nofile=1024      <- podman build RUN steps
RUN-TIME    nofile=20000     <- podman run
```

**Podman's build steps default to 1024 file descriptors.** Rollup opens hundreds of
modules concurrently; at 1024 it hits `EMFILE` and reports whichever module lost the
race as "failed to resolve". The nondeterminism was the tell — a config or filesystem
fault would fail the same way twice. Docker's builder inherits the daemon's far higher
limit, so the defect never appeared there.

Two changes fix it, and both are now in the repo:

1. `podman build --ulimit nofile=<hard limit, capped>`. Do **not** hardcode 65535 — a
   value above the host's hard limit fails at container init with
   `error setting rlimit`. CI computes it from `ulimit -Hn`.
2. `FROM docker.io/library/nginx:alpine` in the runtime stage. Podman refuses
   unqualified short names; Docker silently implies `docker.io`. Same registry-naming
   fix already applied to the compose files.

**Both engines now build both images**, and the `Prod stack (Podman)` CI job builds the
web image rather than declaring it out of scope.

What was ruled out along the way, each by experiment, so nobody re-runs them: a single
combined `RUN` layer; `node-linker=hoisted`; `--shamefully-hoist`; `--isolation=chroot`
(its apparent success was layer-cache reuse — with `--no-cache` it failed 3/3);
undeclared dependencies (all were declared); and the storage driver — **`vfs` fails
identically to `overlay`**, which is what finally killed the filesystem theory and
pointed at the process environment instead.

