# Live-Sync Loop — keeping external builders on current instructions

> **Vision anchor:** [Issue #136 — Define portable work context and adaptive Grid
> Intelligence vision](https://github.com/DanFashauer/SignalGrid-Review-Hub/issues/136).
> The loop below is the *mechanical* half of that direction: the person-first grid
> only stays believable if every surface that builds against this repo — including
> the two that CI cannot reach — provably builds against the repo's **current**
> contracts, and the repo can tell when its committed real-hardware evidence has
> gone stale.

Two consumers build **outside** this repo's CI:

1. **The owner's Mac MCP lane** — the separate `signalgrid-mcp` checkout, run
   together with this repo by `scripts/verify-all.mjs`, tied through the shared
   canonical contract at
   `lib/integrations/src/integrations/macos-posture/contract/posture-report.contract.json`.
2. **The iOS EnterpriseShell app** — `native/ios/EnterpriseShell` (Swift; built in
   Xcode on the owner's Mac, exercised by `.github/workflows/ios-ci.yml` for
   compile-level checks only).

Neither can be run from a Linux sandbox or a scheduled bot. The loop below keeps
them honest anyway, with an explicitly bounded division of labor: **automation
maintains the truth of the instructions and detects staleness; only the owner's
hardware can produce fresh evidence.**

## The manifest

`node scripts/generate-sync-manifest.mjs` deterministically publishes
`artifacts/sync/live-sync-manifest.json`:

- `manifestVersion` — monotonic integer, bumped **only** when the fingerprinted
  body changes; regenerating an unchanged repo is byte-identical.
- `fingerprint` — sha256 over the canonical JSON of `body`.
- `body` — the cross-surface contract surface, extracted from the tracked sources
  of truth: the posture-report contract file's sha256, the runtime `SIGNAL_KINDS`
  list (`lib/posture-composition`), the `SignalCategory` union
  (`lib/signalgrid-core`), the task-exception reason codes
  (`lib/integrations` task-exception), the work-context trust ceilings
  (`lib/work-context`), the handoff-sim refusal codes (`lib/handoff-sim`), the
  documented proof-count table (the same pattern `scripts/check-proof-counts.mjs`
  enforces over `docs/`), and the MCP tool surface
  (`artifacts/mcp-server/src/index.ts`). **No timestamps or commit hashes live in
  the body** — it must be a pure function of the tracked sources.
- `generatedFrom` — outside the fingerprint; records `git rev-parse HEAD` only
  when `--stamp` is passed.

## Asking the Mac to run something: the request/result loop

The manifest below answers *"are the instructions current?"*. It does not answer
the other half of the same problem: **the cloud lane cannot run anything on the
owner's Mac, and the Mac cannot be reached by CI.** Until this loop existed, the
bus between them was prose — a message saying "please run the harness", and a
human remembering to. Prose leaves no artifact, so from the cloud side an unrun
simulation and a passing one looked identical. That is the unearned affirmative,
one layer out from the code where this repository usually finds it.

Two committed directories close it:

| Direction | Artifact | Written by |
| --- | --- | --- |
| cloud → Mac | `artifacts/sim-requests/<id>.json` | the cloud lane, in a commit |
| Mac → cloud | `artifacts/sim-results/<id>.json` | `pnpm run sim:run-requests` |

**A request names KEYS, never commands.** `scripts/lib/sim-operations.mjs` is the
allowlist — 27 operations covering the deterministic suites, the running
`/v1` API (functionally and **under concurrency**, via `load` and `stress`), the
browser E2E layer, the turnkey Mac runs (proofs → API → MCP over real JSON-RPC →
EnterpriseShell in the iOS simulator with mimicked hardware), the real-hardware
evidence emission, the container stack, the live vendor lanes (one key per lane
plus the all-or-nothing `live-lanes`), and the native Android and desktop lanes
(`android-core-tests`, `desktop-core-tests`, and the macOS-only
`desktop-window-smoke`, which is the only thing anywhere that opens the Tauri
window).
The machine that executes decides what a key means. This is the security
property, not a convenience: request files are authored by one lane and executed
on another lane's machine, with that machine's filesystem and credentials, so a
request carrying a shell string would make *"please run a simulation"* and
*"please run anything"* the same message. `proof:sim-requests` pins it over every
call site — no spawn in the runner takes its program from a request field, and
none opts into a shell.

That count is checkable: `node -e
"import('./scripts/lib/sim-operations.mjs').then(m => console.log(m.OPERATION_KEYS.length))"`.
It is also GATED, since 2026-09-02, by a `sim-operations` row in
`scripts/check-derived-doc-figures.mjs` that derives the figure from the
allowlist's source — because a written-out count is exactly the kind of figure
no guard could see: it went stale within an hour of being written, when `load`
and `stress` landed, and it said "fifteen" until 2026-09-02 while the file held
twenty-three. The next operation added moves this sentence or fails the gate.

**An operation the machine cannot honestly run is REFUSED, never downgraded.** A
macOS-only run on Linux records `refused_platform` and says so; it is never
quietly replaced by a weaker run reported under the stronger name. The proof
verifies this live, because it runs on Linux where every macOS-only operation
must refuse.

**An unrun run is PENDING, and pending is loud.** `node
scripts/check-sim-requests.mjs` names every asked-for operation with no result
row on every invocation — including operations missing from a result that
otherwise completed, which is the case most likely to be read as done. Pending
never counts green and never fails the build: CI has no Mac, and blocking the
build on hardware CI cannot reach would be the same dishonesty running the other
way. Only *incoherence* fails — a result naming a request that does not exist, a
green row for work nobody asked for, a status outside the closed set, or a result
that cannot name the commit it ran against.

```bash
# On the Mac, from the repo root:
pnpm run sim:run-requests            # run everything still pending
pnpm run sim:run-requests --plan     # show what would run, run nothing
pnpm run sim:run-requests --id <id>  # one request
git add artifacts/sim-results && git commit -m "sim results" && git push
```

Results carry provenance — platform, arch, Node version, macOS version, commit,
branch, and whether the working tree was clean — because "the proofs passed"
means nothing without "on what, at which commit". A result minted from a dirty
tree cannot be reproduced from the commit it names, so that is recorded rather
than assumed away.

## The cycle, honestly bounded

### (i) Repo changes contracts → the gate hard-fails until the manifest is republished

`node scripts/check-live-sync.mjs` recomputes the manifest body from the sources
(importing the generator's own extractors — no second copy to drift) and
**hard-fails** if the committed manifest differs:

```
repo contracts changed without republishing the sync manifest — run: node scripts/generate-sync-manifest.mjs
```

So a change to any listed contract cannot merge with a stale manifest — the
instructions the external surfaces consume are always current. A hand-edited
manifest (fingerprint not matching its own body) fails the same way.

### (ii) The scheduled bot detects — it cannot run the Mac side

The report-only Scheduled Verification lane
(`.github/workflows/scheduled-verification.yml`) is the natural home for a daily
`node scripts/check-live-sync.mjs` step: it re-checks manifest drift on the
default branch and reads the `liveEvidence=` status line, notifying the **owner**
(via its existing tracking-issue mechanism) when committed evidence has gone
stale and a real-device run is needed. The bot's boundary is stated plainly: it
maintains the truth of the instructions and detects staleness. It **cannot** run
`signalgrid-mcp` pytest against a real Mac or build EnterpriseShell in Xcode, so
it never produces evidence — it only asks the one person who can.

### (iii) The owner's one command on the Mac

```
SIGNALGRID_MCP_PATH=/path/to/signalgrid-mcp node scripts/verify-all.mjs --require-mcp --emit-evidence
```

After a fully-green run of **both** halves (Review-Hub preflight passed, and the
signalgrid-mcp checkout was found, ran, and passed against this repo's contract
file), this writes `artifacts/live-evidence/mac-run.json` recording the
committed manifest's fingerprint plus pass booleans and public-safe summary
counts. The owner then commits `artifacts/live-evidence/` — that commit *is* the
evidence that real hardware validated the current contracts. Emission is refused
when any half is not green or when the MCP side merely skipped, so a sandbox
without the checkout can never fabricate a "real Mac run".

### (iii-b) The Docker lane — one command, on any machine with Docker

```
pnpm run verify:docker            # bring the stack up, verify, tear down
pnpm run verify:docker -- --emit-evidence   # ...and write committable evidence
```

`scripts/docker-verify.mjs` starts `postgres:16` (published on **5433**, so a
local 5432 is never disturbed), waits for real readiness rather than sleeping a
guessed interval, and runs the three durable-persistence proofs against it:
the audit ledger (durability, tamper-evidence, redaction, concurrency), the
decision + evidence store (tenant isolation, tamper-evident snapshots), and the
session lifecycle. Those are the claims that are only meaningful over a real
socket — every other gate in this repo runs the core in memory.

It inherits this loop's central discipline: **evidence is never fabricated.**
A missing daemon is a refusal, not a skip; a red or partial run emits nothing.
On a fully green run with `--emit-evidence` it writes
`artifacts/live-evidence/docker-run.json` carrying the committed manifest's
fingerprint, the Docker server version, and assertion counts — fingerprints,
booleans and counts only, no hostnames, paths or timestamps. Committing
`artifacts/live-evidence/` is the record that a real stack ran.

This lane does **not** replace the Mac/Xcode evidence in (iii): Docker proves the
deployed server topology, not a supervised iOS device. They close different gaps.

### (iv) iOS: EnterpriseShell pins to the manifest version

The app lives at `native/ios/EnterpriseShell`. The instruction (documented here,
not implemented from this Linux checkout — the Xcode project is owner-side) is:

- copy `artifacts/sync/live-sync-manifest.json` into the app as a bundled JSON
  resource (next to `native/ios/EnterpriseShell/Resources/`), **or** add an Xcode
  build phase that reads the repo file directly; either way the build records the
  `manifestVersion` it was produced against;
- a build-phase check (a short `run script` phase) compares the bundled/pinned
  `manifestVersion` against the repo's current one and fails the build when they
  differ — the iOS analog of half (a), enforced where the iOS build actually
  runs.

Until that phase exists in the Xcode project, the pin is a documented procedure,
not an enforced one; `check-live-sync` still guarantees the manifest the app
would copy is current.


### Evidence can only be minted on real hardware — proven, not promised

`--emit-evidence` refuses outright when the process is not running on macOS
(`platform=linux` and every other value), with no override flag on purpose. The
first dry run of the live-sync bot caught exactly the failure this prevents: a
cloud sandbox holding an MCP checkout went green on both halves and minted an
evidence file claiming a "real Mac run." Green-ness is not hardware. The refusal
was added the same hour, the fabricated file deleted, and the platform is now
recorded inside every evidence body so a reader can check the claim instead of
trusting it.

## What the contract does NOT check: the VALUE

Measured 2026-07-31 by driving the live `signalgrid-macos` MCP server from this side
and feeding its real output through the real connector — the first time this lane
was exercised end-to-end from the Review-Hub.

`posture-report.contract.json`'s `requiredFields` asserts that a field is PRESENT.
It says nothing about what is in it, and on this Mac several fields are present with
CLI failure text as their value:

| field | value on a real Mac |
| --- | --- |
| `updates.AutomaticCheckEnabled` | `…defaults[94442] The domain/default pair of (…) does not exist` |
| `updates.LastUpdatesAvailable` | same shape |
| `xprotect.xprotect_definitions` | same shape |
| `time_machine.latest_backup` | `Failed to mount backup destination, error: …` |

`defaults read` writes its failure to stdout as an ordinary string, so a missing key
arrives looking exactly like data. A presence check passes; the field is there.

It was not harmless. `malwareDefs()` graded the XProtect blob as `"present"` — a
message saying the version key DOES NOT EXIST read as "definitions are present" —
so `xprotect` never reached `controlsUnknown`. Fixed in `15e9473`: `readableString`
now rejects `defaults[pid:tid]` banners and "does not exist" text, alongside the
`%Su` substitution artifacts it already rejected. `autoUpdate()` was never exposed
because it compares strictly against booleans.

**The producer already knows how to do this correctly**, which is what makes it
worth writing down rather than just patching. The `sharing` section of the SAME
report handles an un-runnable probe properly:

```json
"remote_login_ssh": { "raw": "You need administrator access to run this tool... exiting!",
                      "enabled": null },
"_unknown": ["remote_login_ssh"]
```

Failure text stays in `raw`, the parsed field is `null`, and the key is listed in
`_unknown`. `updates`, `xprotect` and `time_machine` put the failure text in the
parsed field itself. Same server, two conventions.

Two consequences, stated rather than assumed:

- **Consumer exposure is closed.** Only `osVersion` and `malwareDefs` pass through
  `readableString`, and the connector reads just `os`, `security`, `mdm`, `updates`,
  `xprotect`, `system_extensions` — `time_machine` is not consumed today, so its
  error blob is latent rather than live.
- **The root fix belongs in signalgrid-mcp**: emit `null` plus `_unknown`, as
  `sharing` already does. Until then this side defends itself, which it should do
  regardless — a consumer that trusts its producer's error text is one bad probe
  away from a fabricated reading.

A contract that checks presence and not plausibility is worth strengthening on both
sides; doing so needs the producer test (which reads this same file) to change with
it, so it is recorded here rather than altered unilaterally.

## Proof pointer

```
node scripts/check-live-sync.mjs
```

Prints one `✓`/`✗` line for the manifest half (e.g.
`✓ live-sync manifest matches the repo (version 1, fingerprint …)`), one
`FRESH`/`STALE` line per file in `artifacts/live-evidence/`, and a final
machine-greppable status line: `liveEvidence=fresh|stale|none`. Exit code is
non-zero **only** for manifest drift. Evidence staleness is reported, never
enforced — only the owner's hardware can refresh it, and blocking every commit
on a hardware run would stop all work.

## Public safety

Everything this loop commits is public-repo safe by construction:

- the manifest body contains only contract hashes, enum/tool **names**, and
  documented counts — no credentials, tenants, or environment details;
- `artifacts/live-evidence/mac-run.json` contains fingerprints, booleans, and
  counts only — **no hostnames, usernames, serial numbers, local paths, or
  timestamps** (git history already dates the commit);
- nothing here weakens the public/private split: the private core and the
  owner's machines stay outside the repo; only their *verdict* (pass, against
  which fingerprint) is committed.

## Wiring

Landed (as of 2026-09-06): the `package.json` scripts `sync:manifest` and
`check:live-sync`; `scripts/preflight.mjs:359` runs `node scripts/check-live-sync.mjs`
(the hard half locally); `.github/workflows/review-hub-ci.yml` runs the same step (the
hard half in CI). Two of the three bullets that stood here until 2026-09-06 were
already done.

Still to be added by the owner (`.github/` is out of scope for automation here):

- `.github/workflows/scheduled-verification.yml` (drift + staleness watch): a step
  running `node scripts/check-live-sync.mjs` — `grep -n live-sync
  .github/workflows/scheduled-verification.yml` returns nothing as of 2026-09-06;
  §(ii) above describes what it would do.
