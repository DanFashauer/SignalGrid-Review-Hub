# Owner-only actions

Everything in `docs/BUILD_BACKLOG.md` is done and verified (see each PR's proof
list). The items below are the only steps that require **you** — they need repo-
admin / account permissions an automated agent doesn't hold, or a judgment call
that's yours to make. Each says why it needs you and exactly what to click.

Order doesn't matter much; #1 and #2 are the ones worth doing soon.

---

## 1. Point the repo "Website" field at the live console (2 min)

**Why you:** editing a repo's metadata is an owner/admin setting; there's no API
the agent is authorized to use for it.

- GitHub → this repo → **About** (gear icon, top-right of the repo home) →
  **Website**.
- Remove the old `replit.com` link and set it to the published GitHub Pages URL:
  `https://danfashauer.github.io/SignalGrid-Review-Hub/`
- (Pages itself is already enabled and deploying — nothing to do there.)

## 2. Retire the two legacy repos (5 min)

**Why you:** merging a PR in another repo and archiving a repo are owner actions.

Two legacy-retirement PRs are already open (they prepend a "legacy / pre-dev
concept — superseded by SignalGrid-Review-Hub" banner):

- **DEV** repo → PR **#110** → review + **Merge**.
- **SignalGrid** repo → PR **#1** → review + **Merge**.

Then, for each of those two repos: **Settings → General → Danger Zone →
Archive this repository.** Archiving makes them read-only so nobody mistakes
them for the live codebase, without deleting any history.

> VaultLens is a separate side project — leave it as-is.

## 3. Choose the default branch (2 min)

**Why you:** the default branch is the public face of the repo; which tier is
"default" is a product decision, not something to guess.

The promotion branches exist and track the current build: `dev` → `alpha` →
`beta` → `prod`, alongside the working base `SignalGrid_Alpha`. Pick one as the
repo default under **Settings → General → Default branch**:

- Keep **`SignalGrid_Alpha`** if you want the current integration branch to stay
  the default (no change needed), or
- Switch to **`prod`** (or `beta`) if you'd rather the default reflect the
  promotion model — see `docs/REPO_LAYOUT.md` for the tier map.

After a change, update branch-protection to match (below).

## 4. (Recommended) Turn on branch protection for the default branch (3 min)

**Why you:** protection rules require admin.

**Settings → Branches → Add rule** for the default branch: require the
`Typecheck, build, and proof scaffold`, `CodeQL`, and `Secret scan (gitleaks)`
checks to pass before merging, and require a PR. That makes the guardrails that
already run advisory into blocking.

## 5. Delete stale/merged branches (1 min)

**Why you:** housekeeping; harmless but tidy.

- On the **Branches** page, delete any leftover `codex/…` branch(es) from the
  earlier closed PRs.
- The tier branches (`dev/alpha/beta/prod`) and `SignalGrid_Alpha` should stay.

---

## Not needed yet (future, when you go past the demo)

These aren't required for the current concept/pre-dev stage — noted so you know
they're deliberate gaps, not oversights:

- **Real vendor connectors / secrets.** Everything is fixture-backed and
  fail-closed by design (`pnpm run safety:check` enforces it). Wiring real Entra/
  Intune/Graph or telematics would mean adding secrets in repo/environment
  settings and flipping connectors off "fixture" mode — a deliberate later step.
- **A real attestation trust store.** WebAuthn attestation statements are now
  verified (`packed`/`fido-u2f`), but there's no root-CA allow-list / MDS check
  yet; add one if/when you enforce specific authenticator models.
- **Custom domain for Pages.** Optional; add a `CNAME` if you want a branded URL.

If you'd like, I can open a follow-up PR for any of the "future" items, or script
the branch/default changes where the API allows — just say which.
