# CI and Validation

SignalGrid Review Hub has its own repository-native CI because it is the public review and validation surface for SignalGrid. Checks that run in `/DEV` are Alpha or legacy checks; they do not protect this public repository, its documentation, or its proof scaffolds.

## Review Hub CI

The `Review Hub CI` workflow runs on pull requests, pushes to `SignalGrid_Alpha`, and manual workflow dispatch. It is intentionally conservative and validates the public-safe repo surface only.

The validation job runs:

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
PORT=3000 BASE_PATH=/ pnpm run build
pnpm run proof:intune-entra-posture
pnpm run proof:signalgrid-simulator
pnpm run proof:signalgrid-grid
pnpm run proof:microsoft-graph-sandbox
pnpm run proof:connector-emulator
```

The docs sanity job verifies that required public-review docs exist and checks for narrow, direct unsafe claims such as production-ready, replacement, partner, MFi certification, or autonomous production-remediation claims. It is not intended to block explicit disclaimers, guardrail language, or validation-command examples that document the scanner itself.

## Required local checks

Before opening or updating a pull request, run **one command** from the repository root:

```bash
pnpm install --frozen-lockfile
node scripts/preflight.mjs          # the whole gate suite; --quick skips the heavy web/app builds
```

`preflight.mjs` is the ordered mirror of every CI job that needs nothing but Node — well
over a hundred gates, including the typecheck, the build, every `proof:*`, the
unsafe-claim scan, and the drift ratchets. Its own header states honestly which three CI
jobs it does *not* mirror (Postgres, the Docker-compose smoke, and gitleaks), so a green
preflight means everything reproducible locally is green, not that CI cannot go red.

**Run the whole thing, not a hand-picked subset.** This section used to list five proofs
and a `git grep`, and that list was the defect it looked like a control against: it
omitted `proof:incident-playbook`, so a change that added a new composable signal kind
without an owning incident queue passed every check a contributor was told to run and
went red in CI. Picking the gates that "obviously relate" to a change is exactly how the
derived ones — the gates that exist because the relationship is *not* obvious — get
skipped.

`PORT` and `BASE_PATH` are required by several Vite review surfaces during production
builds; preflight sets them for the build step itself.

### Two consequences worth knowing before you push

- **A new composable signal kind needs an owning queue.** `proof:incident-playbook`
  enumerates the runtime `SIGNAL_KINDS` union and asserts that no kind falls through to
  the generic Service Desk, so adding one to `lib/posture-composition/src/types.ts`
  requires a matching `categoryForKind` case in `lib/incident-playbook/src/map.ts`.
- **Never run `scripts/mutation-guard.mjs` concurrently with anything else, and never
  under a timeout that may kill it.** It mutates source files in place and restores them
  afterwards; a sweep killed part-way leaves the tree mutated, which then surfaces as
  unrelated phantom failures elsewhere (a "stale allowlist entry" for code that had not
  moved, and a failing facility-trust-graph proof whose guard clause had been silently
  rewritten to `true`).

### Where new work is allowed to land

`node scripts/check-package-reachability.mjs` computes the transitive closure from the
shipped artifacts and reports every `lib/*` package none of them can reach. Eight of
thirty-five are unreachable today — one with no importers at all, the rest imported only
by the proof harness — and the check is a ratchet pinned at that count rather than a hard
gate, because unreachable is a requirement to *look*, not a verdict to delete.

Before building into a library, ask it how that library ships:

```bash
node scripts/check-package-reachability.mjs --why @workspace/<package>
```

It prints the shortest artifact→package path, or says plainly that the package is
unreachable and that work landed there is work nothing can call. It exists because a
design pass once scoped a repair into `lib/dual-control` before establishing that
`planFlowActions` has zero shipped consumers — the wiring would have been proven by a
proof and reachable by nothing.

## Branch protection

After the workflow is available on GitHub, branch protection should eventually require `Review Hub CI` before merge. Recommended settings for `SignalGrid_Alpha`:

- Require status checks before merging.
- Require `Review Hub CI`.
- Require conversation resolution before merging.
- Require the branch to be up to date before merging.

This keeps Review Hub independent from `/DEV` and makes the public validation surface self-protecting.

## The two verification layers added with the zero-cost test wave

- **Real-cryptography proof.** `pnpm run proof:live-idp` (31 checks) boots a
  certified OIDC provider in-process, mints genuine RS256 and DPoP-bound tokens
  over real HTTP, and drives every accept/reject decision through the production
  verifier in `lib/enterprise-auth` — tampered signatures, wrong issuer/audience,
  real 1-second expiry, HS256 algorithm-confusion forged from the provider's own
  public-key bytes, and `cnf.jkt` validated against the RFC 7638 thumbprint of
  the held key before the token-binding dimension is allowed to call the result
  sender-constrained. The fixture proof shows the logic is right; this shows it
  is right against bytes SignalGrid did not fabricate. Fully local, no tenant,
  no cost.
- **Browser-level E2E.** `pnpm run test:e2e` (35 tests, ~126 content-bearing
  assertions) runs Playwright against the BUILT review console, website,
  admin console, desktop client, and mobile PWA (the admin console, desktop
  client, and mobile PWA proxied to a live locally-booted api-server).
  It asserts what a human actually sees — decision evidence rows, reason codes,
  the corrected battery copy — and its maiden run caught a real gap no other
  gate could: a decision-evidence row the core carried and no console scenario
  ever rendered.

## CI ↔ preflight drift (`pnpm run guard:ci-sync`)

`scripts/preflight.mjs` calls itself a mirror of the CI jobs that need nothing but Node,
and asked a human to *"keep this list in lockstep"*. Two hand-maintained lists that must
agree is a promise, not a mechanism, and it fails silently in **both** directions: a proof
in CI but not preflight means a red build passes `Safe to push`; a proof in preflight but
not CI means it is verified only on a developer's machine while every status surface says
CI runs the full suite.

**Both had already drifted.** `proof:dual-control` and `proof:session-store` ran in
preflight and in **no workflow at all**. They are in CI now, and
`scripts/check-ci-preflight-sync.mjs` derives both lists from source so the next omission
is caught by a machine rather than by an audit that happened to look.

Three Postgres proofs (`audit-ledger-pg`, `decision-store-pg`, `session-store-pg`) are
exempt **by name with a reason**, not by a `/-pg$/` pattern that would quietly absorb the
next unrelated omission — and a stale exemption is itself reported, since silencing a
check for something now covered is its own drift. The gate also refuses to pass on an
implausibly small scan: both sides are read with a regex, and if either stops matching the
sets go empty and every comparison trivially succeeds. A drift checker that reports "no
drift" because its parser broke is the exact failure this repository keeps finding, so the
gate that hunts it carries a floor against having it.

## Unsafe-claim scan scope

The CI denylist is intentionally narrow and direct. It checks for production-ready, replacement, partnership, MFi certification, autonomous-remediation, and specific replacement phrases such as `replaces Jamf`, `replaces Intune`, `replaces Apple Configurator`, and `replaces GroundControl`, while allowing explicit disclaimers, guardrail wording, and validation-command lines that document the scanner itself.

**`scripts/docs-sanity.mjs` implemented that allowance; `phase-gate.ts` did not.** The two
scanners share a denylist and disagreed about how to read it. `docs-sanity` is
negation-aware and has been for some time — its `hasBareClaim` requires a negator to
appear *before* the phrase, and its comment records why a line-wide search is wrong. The
phase gate just ran the grep. A substring match cannot distinguish a partnership claim
from its own denial, and since this project's doctrine is platform honesty, its docs are
overwhelmingly the denials. Measured at the time of the fix: **64 hits, of which zero were
affirmative.** `unsafeClaims=found` had therefore printed on every run the gate had ever
made, and would have printed identically on a repository that *did* carry a real claim. A
signal that cannot vary carries no information, and the incentive ran backwards — writing
an honest disclaimer cost you a lane escalation.

`scripts/src/unsafe-claim-classifier.ts` now sorts each hit into `affirmative`,
`disclaimed`, `self_referential` or `registry`, and **only `affirmative` moves the lane**.
The two marker families are scoped differently on purpose:

- **Negation is positional** — counted only in the text *before* the match, within the
  same clause (`.`, `;` and `|` are boundaries, because these docs use markdown tables and
  a negation in one cell must not reach into the next). Words like "not" and "no" are
  ordinary prose, so a line-wide search would let a production-readiness assertion launder
  itself on a trailing "no" elsewhere in the sentence. This matches `docs-sanity`'s
  `hasBareClaim`, which reached the same conclusion first; the phase gate additionally
  narrows the window from the whole line to the clause.
- **Prohibition is lexical** — "avoid", "denylist", "guardrail", "disclaimer" and friends
  count anywhere in the clause, because they cannot plausibly co-occur with a sincere
  claim.

Anything not positively identified as disclaimed is affirmative: fail-closed, as
everywhere else here. The gate prints the full breakdown (`unsafeClaimMentions=total:…
affirmative:… disclaimed:… selfReferential:… registry:…`) so a collapse in the disclaimer
count is visible too.

**Known limitation, stated rather than implied by silence:** the registry exemption is
per-file, so a sincere claim written *inside* `docs/PUBLIC_MESSAGING_GUARDRAILS.md` — the
document whose purpose is to enumerate forbidden wording — is exempt. The `registry:`
count moves when that happens, but the lane does not. Closing it would require shape
heuristics about how that one document may be written, and a guard that fails on
legitimate edits gets switched off. `pnpm run proof:unsafe-claim` (40 checks) pins all of
the above, including that limitation and the adversarial trailing-negation case.
