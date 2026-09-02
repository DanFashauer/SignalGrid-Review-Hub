# Owner-only actions

The items below are the steps that require **you** — they need repo-admin /
account permissions an automated agent doesn't hold, or a judgment call that's
yours to make. Each says why it needs you and exactly what to click. (The build
backlog itself lives in `docs/BUILD_BACKLOG.md` and its Now section says what
is done versus held; this file used to open by claiming the backlog was
finished, which stopped being true the moment new work was filed.)

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

**There is nothing to choose between any more, and that is the correction.** The
promotion refs `dev`, `alpha`, `beta` and `prod` were **pruned** — all four sit in
`artifacts/sync/merged-branches-to-prune.txt` (lines 4, 5, 63, 65, each at the same
tip `7ee88ef`), and `docs/BRANCH_HYGIENE.md` gives the reason: they had not moved
since 2026-07-15 and nothing in CI or the compose files referenced them, so as stale
pointers they implied a promotion flow this repo does not run. `SignalGrid_Alpha` is
the working base and the only long-lived ref. Verified 2026-09-02 with
`git ls-remote --heads origin`.

This section has now been corrected twice for the same class of error. It first
claimed the four refs tracked the current build; the correction said they existed
but were pinned to the `Merge PR #65` commit — accurate on the day it was written,
and false once they were pruned. A pruned ref is recoverable in one command
(`git push origin 7ee88ef:refs/heads/<name>`), so recreating the pipeline is still
an owner decision; it is just no longer a decision about which EXISTING branch is
default. Dispatch **Actions → Promote Tier** for live state: its "Tier state"
summary prints `branch does not exist` for each missing tier rather than restating
a number that would go stale the same way.

> Separately, and **not** something you need to fix: this repository does not let
> GitHub Actions open pull requests (*Settings → Actions → General → Workflow
> permissions*), which is GitHub's default and the safer posture. Promote Tier now
> hands back a one-click compare link instead of failing. Turning that setting on
> would let it open the PR for you and buys nothing else.

That makes this a decision about the *pipeline*, not just a label. Pick under
**Settings → General → Default branch**:

- Keep **`SignalGrid_Alpha`** as default and treat the tier branches as dormant —
  honest, and worth then deleting them so they stop implying a live pipeline; or
- Switch the default to **`dev`** and fast-forward the tier branches, which
  reconnects the promotion model end to end (work lands at the entry point, and
  `Promote Tier` starts having something to carry); or
- Switch to **`prod`**/`beta` so the default reflects the promotion model's stable
  end — see `docs/REPO_LAYOUT.md` for the tier map. Note this only helps once the
  tiers are actually fed; on today's refs it would make a stale commit the repo's
  public face.

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

## Waiting on you as of 2026-08-17 (phone-sized, newest first)

1. ~~Merge PR #206~~ **DONE 2026-08-18** — merged as `5301efa` with all 13
   checks green; the day's work (Fleet live end-to-end, the collector, the
   website truth pass, intake rows 81–91) is on the default branch.
2. ~~The Dependabot queue~~ **CLEARED 2026-08-18** — all nine dependency PRs
   merged the same afternoon your rebase comment fired: #211 (the 51-update
   group superseding #163), the three CI-action bumps (#208-#210), and the five
   npm majors — express-rate-limit 8, chokidar 5, uuid 14, the pino 10 +
   pino-http 11 pair (CI proved those two are only type-compatible together,
   so one PR carried both and #160 closed superseded), and vite 8 with the
   Rolldown native-binary policy (three Codex findings confirmed and fixed
   in-branch: a stale-catalog rollback, missing Rolldown guardrails, and a
   win32-binding regression the desktop lane's windows CI depends on).
   One durable item remains from the episode — the agent unblocked the SBOMs:
   the supply-chain workflow's self-heal step regenerated the SBOM but was
   REJECTED pushing it — a repository ruleset protects `dependabot/*` refs from
   the Actions token (GH013 "Cannot update this protected ref"), which is why
   every Dependabot PR's SBOM check has been red by construction. The agent's
   own credentials could push, so #211 is fixed; for future dependency PRs to
   self-heal without an agent in the loop, **add a ruleset bypass for the
   github-actions app on `dependabot/**` refs** (Settings → Rules → Rulesets),
   or the SBOM-fix step will keep failing on every bot PR. (An earlier
   version of this entry carried the pre-merge triage playbook for the six
   major-version PRs — merge order, per-PR gate evidence, rebase notes. All
   six merged the same day, so the playbook was instructions for work already
   done; the virtual team's PM shift caught the contradiction and it is gone.
   The ruleset-bypass ask above is the one thing from the episode still
   waiting on you.)
3. ~~Company vs product separation~~ **RATIFIED 2026-08-18** — one repository
   with the explicit boundary (`docs/COMPANY_VS_PRODUCT.md`); the split
   triggers stay recorded there for the day one fires.
4. **At the Mac:** `pnpm run sim:run-requests` — two requests are queued
   (post-merge baseline, then the Fleet lab). The cloud lane already covered
   the free-Fleet half live; what only your machine can add is the Docker-on-Mac
   op and anything using your Premium license (the team-policy branch is the
   one unverified path). The license never leaves your machine.

## What came OFF this list on 2026-08-19, and why

You said: *"explain exactly what I need to decide on and why fight me in that
when I know you will make the right call."* That was a fair challenge, and
re-reading this board against it, most of what sat here was not a decision only
you could make — it was reversible technical work wearing a governance label.
Four items moved to the team under the delegated authority now recorded in
`docs/VIRTUAL_TEAM.md`:

- **Launch-profile v4 classification, the connector-family classifications,
  and the standing decisions** → `docs/DECISION_RECORDS.md`. The families all
  resolved to DEFER on evidence, and the strongest reason is that **you had
  already decided this**: intake row 55 records your own sequencing boundary
  ("the launch path remains Entra + Intune → one shared-device workflow → one
  customer-approved sandbox → one live decision loop"). Asking you to classify
  five expansion families one at a time was asking you to re-answer a policy
  you had set. `tenant:admin` and the retention default are decided there too,
  each with its reversal path.
- **The technical review of `SECURITY_QUESTIONNAIRE_PACK.md` and
  `PILOT_SCOPE_SKELETON.md`** → the compliance-analyst role. Checking whether
  those drafts overstate what the tree can evidence is engineering work. Only
  the **sign-off** is yours, and that stays yours — Claude Code does not
  guarantee HIPAA/SOC 2, and a human compliance review is required, not
  optional.
  **DONE 2026-08-19 — the questionnaire pack is accurate.** Every one of its 12
  cited files and 3 cited commands resolves, and the two claims an assessor
  would probe hardest were checked against the code rather than taken on trust:
  `docs-sanity.mjs` really does carry a denylist of would-be certification
  boasts (the SOC 2, FedRAMP, CMMC and Common Criteria phrasings all sit in it,
  quoted at `scripts/docs-sanity.mjs:75-94`), and the API suite really does
  assert 401-before-404 from *both* sides, so an unauthenticated prober cannot
  enumerate routes. That first claim then proved itself the hard way: an earlier
  draft of this very paragraph quoted the denylisted phrases verbatim, and the
  gate failed the build on it. The control is real enough to bite the person
  documenting it. Nothing overstated, and the "Not built, not
  claimed" rows are honest. **It is ready for you to read and sign.** The shift
  also closed a gap it found on the way: cited *paths* were gated but cited
  *commands* were not, so a renamed script could silently falsify the document
  a security assessor reads — `scripts/check-cited-commands.mjs` now gates all
  130 of them.

Two of the four standing decisions — the **graph-default flip** and
**shadow-mode step-up** — are recorded as still open in `DECISION_RECORDS.md`,
because the records behind those board labels were not located in that pass
and deciding them from the label alone would be inventing an answer. They are
team work, not yours.

**Everything left on this list needs your hands, not your judgement**: a
setting only a repo admin can change, a repository only you can archive, or
your physical Mac. Where a choice is involved (the default branch), the
recommendation is written next to it — you are approving a call, not making
one from scratch.

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
