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

The promotion branches `dev` → `alpha` → `beta` → `prod` exist alongside the
working base `SignalGrid_Alpha`. They **no longer track the current build** — all
four are pinned to the `Merge PR #65` commit, while every PR since has merged into
`SignalGrid_Alpha`. This section previously claimed otherwise; it was true when
written and quietly stopped being true. Dispatch **Actions → Promote Tier** to see
the live gap: its "Tier state" summary measures each branch's position rather than
restating a number that would go stale the same way.

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

1. **Merge PR #206** when its checks are green — it now carries the Fleet
   live-lab verification (real server, real enrolled agent, every assertion
   green), the live-query collector behind its three-gate stack, the website
   truth pass (38 corrections, 5 upgrades), and intake rows 82–87.
2. **Comment `@dependabot rebase` on PR #163** — Dependabot ignores the agent's
   comments; it needs a human account.
   **The six major-version PRs behind it are now triaged and all six are
   MERGEABLE** (2026-08-18, cloud lane): pino 10 (#156), express-rate-limit 8
   (#158), vite 8 (#159), pino-http 11 (#160), chokidar 5 (#161), uuid 14
   (#162) were bumped together in a local experiment and every functional gate
   passed — full typecheck, `test:api` 301/301 (pino/pino-http/rate-limit live
   at runtime), `test:load` 15/15 (the limiter's 429s, headers and
   malformed-value fallback held under v8), and all six vite-8 web builds. The
   only red was the SBOM-sync gate flagging the uncommitted experiment — that
   gate working, not a compatibility failure. Suggested order: merge #163
   first (after its rebase), then the six majors in any order; each will
   re-run CI on its own, and each needs its lockfile regenerated by
   Dependabot's own rebase if #163 lands first. The experiment was fully
   reverted; nothing of it is committed.
3. **Ratify the launch-profile v4 classification** (or say what to change).
4. **Review two drafts:** `SECURITY_QUESTIONNAIRE_PACK.md` and
   `PILOT_SCOPE_SKELETON.md`.
5. **Four standing decisions:** tenant:admin scope, graph-default flip,
   shadow-mode step-up, and **retention** — retention now also shows on the
   pricing page as "owner decision pending", so it is customer-visible.
6. **Classify four candidate connector families** the freeze is holding —
   each is assessed and ready to start from its written record: facilities/CMMS
   (intake row 86), OT/MQTT warehouse telemetry (row 85), managed-config
   receipt and MAM/App-Protection state (both from row 33, sitting in the
   backlog's Now section). Say "build", "defer", or "drop" per family.
7. **At the Mac:** `pnpm run sim:run-requests` — two requests are queued
   (post-merge baseline, then the Fleet lab). The cloud lane already covered
   the free-Fleet half live; what only your machine can add is the Docker-on-Mac
   op and anything using your Premium license (the team-policy branch is the
   one unverified path). The license never leaves your machine.

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
