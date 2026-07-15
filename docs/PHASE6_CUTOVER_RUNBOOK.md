# Phase 6 — Consolidation Cutover Runbook

**Goal:** make `DanFashauer/SignalGrid` the single Production home for SignalGrid —
carrying the validated monorepo (this repo's baseline + the DEV harvest), the
four-tier `dev → alpha → beta → prod` promotion pipeline, and preserved git
history from all three source repos — then archive the sources.

> **Why this is a runbook and not an automated step.** Everything in Phase 6
> mutates repositories and org settings your account owns: it force-updates a
> default branch, sets branch protection, creates deployment environments and
> secrets, and archives two repos. Those are irreversible-ish, outward-facing
> actions, and the sandboxed agent's git proxy intentionally blocks pushes to
> `DanFashauer/SignalGrid` and ref/settings changes. So **you run this from a
> machine authenticated as you** (`gh auth status` green), or you explicitly
> authorize the agent per step. Every script here is idempotent and supports
> `DRY_RUN=1`.

---

## 0. The three repos and their fate

| Repo | Role today | After cutover |
| ---- | ---------- | ------------- |
| `DanFashauer/SignalGrid` | Old Vite monorepo (`main`, stale) | **Home.** Content replaced by the consolidation; `dev` becomes default; tiers + protection applied. |
| `DanFashauer/SignalGrid-Review-Hub` | Clean baseline + the validated consolidation (branch `claude/signalgrid-launch-plan-emxm01`) | **Archived** (read-only). Its history lives on inside the home repo. |
| `DanFashauer/DEV` | Source of harvested capabilities | **Archived** (read-only). Harvested pieces + full history preserved in the home repo. |

The consolidated **tree** is exactly what is on
`SignalGrid-Review-Hub@claude/signalgrid-launch-plan-emxm01` (build ✓, typecheck ✓,
core proof 166/166, API 76/76). Phase 6 does not re-do the merge of *files* — that
work is done and validated. Phase 6 moves it to the home repo, **attaches the
other two histories as ancestry**, and stands up the pipeline.

---

## 1. Preconditions

Run these once and confirm each is green before starting.

```bash
gh auth status                      # authenticated as DanFashauer
gh repo view DanFashauer/SignalGrid            --json nameWithOwner,isArchived
gh repo view DanFashauer/SignalGrid-Review-Hub --json nameWithOwner,isArchived
gh repo view DanFashauer/DEV                    --json nameWithOwner,isArchived
git --version                       # 2.20+ (for --allow-unrelated-histories ergonomics)
```

Decide the exact source refs (defaults shown):

| Var | Meaning | Default |
| --- | ------- | ------- |
| `HOME_REPO` | The home repo | `DanFashauer/SignalGrid` |
| `CONSOLIDATION_REF` | Validated consolidation branch in Review-Hub | `claude/signalgrid-launch-plan-emxm01` |
| `REVIEWHUB_REPO` | Baseline source | `DanFashauer/SignalGrid-Review-Hub` |
| `DEV_REPO` | Harvest source | `DanFashauer/DEV` |
| `OLD_SIGNALGRID_MAIN` | Old home content branch to retain as ancestry | `main` |
| `DEV_MAIN` | DEV branch to retain as ancestry | `main` |

> **⚠️ One-way door.** `DanFashauer/SignalGrid` currently has a real history on
> `main`. Cutover keeps `main` intact and adds `dev` as the new default — it does
> **not** delete `main`. Old `main` is also recorded as a merge parent of `dev`,
> so nothing is orphaned. Do **not** delete `main` until you've confirmed `dev`
> is healthy (Section 8).

---

## 2. Build the consolidated `dev` branch with preserved history

This is the history-preservation heart of the cutover. We take the validated
consolidation tree and record the **other two repos' histories as ancestry** using
`-s ours` merges — which keep the tree byte-for-byte identical while making
`git log` walk into SignalGrid's and DEV's commits (full attribution retained).

Run: `scripts/cutover/01-build-consolidated-history.sh` — or by hand:

```bash
WORK=$(mktemp -d)
git clone https://github.com/DanFashauer/SignalGrid-Review-Hub "$WORK/mono"
cd "$WORK/mono"
git checkout claude/signalgrid-launch-plan-emxm01     # the validated consolidation

# Bring the other two repos in as fetchable ancestry.
git remote add home       https://github.com/DanFashauer/SignalGrid
git remote add dev-source https://github.com/DanFashauer/DEV
git fetch home dev-source

# Record their histories as parents WITHOUT changing our tree (-s ours).
git merge -s ours --allow-unrelated-histories --no-edit \
  home/main dev-source/main \
  -m "Consolidate SignalGrid + DEV history into the monorepo

Tree is the validated Review-Hub consolidation, unchanged. The -s ours merge
attaches the SignalGrid (old home) and DEV histories as ancestry so git log
retains every source commit and author."

# This commit's tree == the consolidation; its parents == consolidation + old main + DEV main.
git branch -f dev
git log --oneline --graph -3
git rev-parse dev^{tree}   # note this tree hash; Section 8 verifies it is unchanged
```

**Sanity gate (do not skip):** the tree hash of `dev` **must equal** the tree hash
of `claude/signalgrid-launch-plan-emxm01`. If it doesn't, the `-s ours` merge picked
up content — stop and investigate.

```bash
[ "$(git rev-parse dev^{tree})" = "$(git rev-parse claude/signalgrid-launch-plan-emxm01^{tree})" ] \
  && echo "OK: tree unchanged" || echo "STOP: tree changed"
```

---

## 3. Push the tiers to the home repo

Create the four long-lived tier branches, all starting identical to `dev`, and push
them to `DanFashauer/SignalGrid`.

Run: `scripts/cutover/02-create-tiers.sh` — or by hand:

```bash
cd "$WORK/mono"
git remote set-url home https://github.com/DanFashauer/SignalGrid   # push target

for tier in dev alpha beta prod; do
  git branch -f "$tier" dev
done

# Push dev first (new default), then the rest.
git push home dev
git push home alpha beta prod
```

Set `dev` as the default branch:

```bash
gh repo edit DanFashauer/SignalGrid --default-branch dev
```

---

## 4. Branch protection

`prod` and `beta` are protected (no direct push; review + green CI required). `dev`
and `alpha` get a lighter rule (green CI required; no force-push).

Run: `scripts/cutover/03-protect-and-environments.sh` — protection portion. It PUTs
`repos/OWNER/REPO/branches/<b>/protection` with a JSON body per tier. Key settings:

| Branch | Required review approvals | Required status check | Enforce on admins | Force-push |
| ------ | ------------------------- | --------------------- | ----------------- | ---------- |
| `prod` | 1 | `SignalGrid CI` | yes | blocked |
| `beta` | 1 | `SignalGrid CI` | yes | blocked |
| `alpha` | 0 | `SignalGrid CI` | no | blocked |
| `dev` | 0 | `SignalGrid CI` | no | blocked |

> The required check context is **`SignalGrid CI`** — the `name:` of the job in
> `.github/workflows/review-hub-ci.yml`. If you rename that workflow/job, update
> the protection contexts to match or merges will hang waiting on a check that
> never reports.

---

## 5. Per-tier deployment environments

Create four GitHub Environments matching the tiers. Only `beta`/`prod` may hold real
integration credentials, and only they may set `SIGNALGRID_LIVE_INTEGRATIONS=true`.
`dev`/`alpha` stay fixture-safe — no secrets, flag never set.

Run: `scripts/cutover/03-protect-and-environments.sh` — environments portion. It:

```bash
for env in dev alpha beta prod; do
  gh api -X PUT repos/DanFashauer/SignalGrid/environments/$env >/dev/null
done

# beta/prod only — set the gate flag as an ENVIRONMENT variable (not a secret).
gh variable set SIGNALGRID_LIVE_INTEGRATIONS --env beta --repo DanFashauer/SignalGrid --body true
gh variable set SIGNALGRID_LIVE_INTEGRATIONS --env prod --repo DanFashauer/SignalGrid --body true
gh variable set SIGNALGRID_TIER --env dev   --repo DanFashauer/SignalGrid --body dev
gh variable set SIGNALGRID_TIER --env alpha --repo DanFashauer/SignalGrid --body alpha
gh variable set SIGNALGRID_TIER --env beta  --repo DanFashauer/SignalGrid --body beta
gh variable set SIGNALGRID_TIER --env prod  --repo DanFashauer/SignalGrid --body prod
```

**Real vendor credentials** (Intune/Okta/ServiceNow/etc.) are added by you, by hand,
as **environment secrets on `beta`/`prod` only**, when you're ready to run a live
deploy. Never commit them; never add them to `dev`/`alpha`. Public-safe examples of
the variable names live in `config/tiers/<tier>.env.example`.

Optionally require a manual approver on `prod` deploys:

```bash
# In the UI: Settings → Environments → prod → Required reviewers → add yourself.
```

---

## 6. Issue triage & migration (Phase 4, folded in here)

Before archiving, sweep open issues in the two source repos and re-home the ones
worth keeping. `scripts/cutover/00-triage-issues.sh` snapshots all open issues from
both sources to `docs/consolidation/issues-snapshot.json` (an auditable record), and
prints a migration checklist. Migrate the keepers into `DanFashauer/SignalGrid` with:

```bash
gh issue list --repo DanFashauer/SignalGrid-Review-Hub --state open --limit 200
gh issue list --repo DanFashauer/DEV                    --state open --limit 200
# For each keeper:
gh issue create --repo DanFashauer/SignalGrid --title "<t>" --body "<b>\n\nMigrated from <old-url>"
```

Leave a closing comment on the source issue pointing at the new one so the trail is
explicit.

---

## 7. Archive the source repos

**Only after Section 8 passes.** Archiving makes a repo read-only; it can be
un-archived later if needed.

Run: `scripts/cutover/04-archive-sources.sh` — or by hand:

```bash
gh repo archive DanFashauer/SignalGrid-Review-Hub --yes
gh repo archive DanFashauer/DEV --yes
```

Apply the post-cutover home README (drafted at
[`docs/consolidation/HOME_REPO_README.md`](consolidation/HOME_REPO_README.md) — it
notes the consolidation, links the archived sources for provenance, and replaces the
old "Review Hub" README). Do this on `dev`, then let it promote up the tiers:

```bash
cd "$WORK/mono"
git checkout dev
# Strip the leading HTML draft comment, then install as the top-level README.
sed '/^<!--/,/-->/d' docs/consolidation/HOME_REPO_README.md | sed '/./,$!d' > README.md
git add README.md
git commit -m "Adopt consolidated home README"
git push home dev
```

---

## 8. Verification checklist (gate for Section 7)

Do **not** archive anything until every box is checked.

- [ ] `git ls-remote https://github.com/DanFashauer/SignalGrid` shows `dev alpha beta prod`.
- [ ] Default branch is `dev` (`gh repo view DanFashauer/SignalGrid --json defaultBranchRef`).
- [ ] `dev`'s tree hash equals the validated consolidation tree hash (Section 2 gate).
- [ ] `git log dev` shows commits authored in **SignalGrid-Review-Hub, old SignalGrid, and DEV** (history preserved).
- [ ] A fresh clone of `DanFashauer/SignalGrid@dev` runs green:
      `pnpm install && pnpm -w run build && pnpm run typecheck && pnpm run proof:signalgrid-core && pnpm run test:api`
      (expected: build 0, typecheck 0, core 166/166, API 76/76).
- [ ] `GET /api/healthz` on a `dev`/`alpha` run reports `"liveIntegrations": false`.
- [ ] Branch protection active on `prod`/`beta` (direct push rejected; PR required).
- [ ] The **Promote Tier** workflow opens a `dev → alpha` PR successfully (dry test).
- [ ] Environments `dev/alpha/beta/prod` exist; `SIGNALGRID_LIVE_INTEGRATIONS` set only on `beta`/`prod`.
- [ ] Keeper issues migrated; snapshot committed.

---

## 9. Rollback

Nothing here is unrecoverable if you stop before Section 7.

| If… | Then… |
| --- | ----- |
| `dev` tree hash mismatch (Section 2) | Delete local `dev`, redo the `-s ours` merge. Nothing pushed yet. |
| Bad push to a tier branch | The tier branches are fresh; force-update from the good `dev`: `git push -f home <tier>`. Old `main` is untouched. |
| Regret the whole cutover after push, before archive | Repoint default back to `main` (`gh repo edit --default-branch main`), delete `dev/alpha/beta/prod`, remove protection/environments. Sources are still live (not archived). |
| Archived a source too early | `gh repo unarchive <repo>` (or Settings → General → Unarchive). |

---

## 10. What stays fixture-safe / public-safe (unchanged by cutover)

Cutover does not relax any guardrail:

- `dev`/`alpha` are **always** fixture-safe; `isLiveIntegrationsEnabled()` returns
  `false` there regardless of env.
- Real vendor/Graph/API calls happen only in a `beta`/`prod` deploy that both sets
  `SIGNALGRID_LIVE_INTEGRATIONS=true` **and** supplies real credentials — which live
  only as environment secrets you add by hand.
- No secrets, tenant IDs, or PII/PHI enter git. `config/tiers/*.env.example` are
  placeholders only.
- High-risk remediation stays approval-gated and simulated.
