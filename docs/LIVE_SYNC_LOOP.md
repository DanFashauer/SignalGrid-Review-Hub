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

## Wiring (to be added by the owner — files out of scope for automation here)

- `package.json` scripts:
  `"sync:manifest": "node scripts/generate-sync-manifest.mjs"` and
  `"check:live-sync": "node scripts/check-live-sync.mjs"`.
- `scripts/preflight.mjs` STEPS (the hard half locally):
  `{ name: "Live-sync manifest (contracts vs published manifest)", cmd: ["node", "scripts/check-live-sync.mjs"] }`.
- `.github/workflows/review-hub-ci.yml` (the hard half in CI) and
  `.github/workflows/scheduled-verification.yml` (drift + staleness watch):
  a step running `node scripts/check-live-sync.mjs`.
