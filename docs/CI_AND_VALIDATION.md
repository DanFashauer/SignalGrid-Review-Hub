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

Before opening or updating a pull request, run these commands from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
PORT=3000 BASE_PATH=/ pnpm run build
pnpm run proof:intune-entra-posture
pnpm run proof:signalgrid-simulator
pnpm run proof:signalgrid-grid
pnpm run proof:microsoft-graph-sandbox
pnpm run proof:connector-emulator
git grep -nE "SignalGrid is production-ready|SignalGrid replaces|SignalGrid is an Imprivata partner|SignalGrid is MFi certified|autonomous production remediation|replaces ServiceNow|replaces PagerDuty|replaces CrowdStrike|replaces Defender|replaces ControlUp|Imprivata partner|MFi certified|replaces Jamf|replaces Intune|replaces Apple Configurator|replaces GroundControl" -- README.md docs artifacts/signalgrid-review/src || true
git diff --check
```

`PORT` and `BASE_PATH` are required because several Vite review surfaces read those environment variables during production builds.

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
