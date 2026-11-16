# Branch hygiene — what the branches mean, and which ones are load-bearing

A visitor to this repo sees the branch list before they see anything else. This
file says what that list means, so an outsider can tell live work from residue
without asking.

## Stop the backlog rebuilding — one repo setting

**Settings → General → Pull Requests → "Automatically delete head branches."** With
it on, a squash-merged branch is deleted the moment its PR merges, and the 60-odd
branch backlog this file exists to describe never forms again. The prune workflow
below then only ever has history to deal with, not a steady inflow.

That setting is the cure. Everything after this is the cleanup.

## The convention

| Prefix | Meaning | Lifetime |
| ------ | ------- | -------- |
| `SignalGrid_Alpha` | **The default branch.** Everything merges here. | permanent |
| `claude/<topic>` | One topic, one PR, squash-merged. | delete on merge |
| `codex/<topic>` | Same, from the earlier Codex lane (Jun–Jul 2026). | delete on merge |
| `dependabot/*` | Bot-owned. Never hand-edit, never delete manually. | bot-managed |
| `fix/*`, `validation/*` | Historical one-offs, kept only while their PR is open. | delete on merge |

**Squash-merge hides merged-ness from `git`.** A squash makes one new commit, so the
original branch's commits are never ancestors of the default branch. `git branch
--merged` therefore reports a squash-merged branch as UNMERGED, and
`git cherry` only agrees when the branch held exactly one commit. Neither is a
reliable signal on its own. **The authoritative signal is the PR's merge state**, and
any pruning must be decided on that, cross-checked against ancestry — not on ancestry
alone. Getting this backwards deletes live work or preserves dead branches forever.

## What must never be deleted casually

- **`SignalGrid_Alpha`** — the default branch.
- **`dependabot/*`** — owned by the bot; deleting one makes Dependabot re-open it.
- **Any branch with an OPEN pull request.** Deleting it closes the PR and orphans the
  review conversation.

## The pruning procedure

`artifacts/sync/merged-branches-to-prune.txt` holds the current verified-merged set,
one `<tip-sha> <branch>` per line. **The tip SHA is recorded so every deletion is
reversible**: a deleted branch is restored with

```bash
git push origin <tip-sha>:refs/heads/<branch>
```

**To prune: Actions → "Branch prune" → Run workflow.** Leave `apply` unchecked for a
dry run that writes the full plan and a restore command per branch to the run
summary; read it, then run again with `apply` checked. It works from the GitHub
mobile app, so this needs no laptop.

The workflow (`.github/workflows/branch-prune.yml`,
`scripts/prune-merged-branches.mjs`) **re-derives everything at run time and never
reads the snapshot below.** Two independent sufficient conditions, either of which
releases a branch:

1. it has a **merged** pull request, or
2. its tip is **already contained** in the default branch (compare status
   `identical` or `behind`) — every commit on it is reachable from the default
   branch, so the ref is a pointer and nothing else.

Condition 2 exists because the four tier pointers `alpha`/`beta`/`dev`/`prod` were
absorbed by direct push and never had a pull request. Judging on PR state alone
would strand them forever; judging by name would be a hand-typed exception list
that goes stale the moment someone adds a fifth.

Everything else is **refused and named in the summary**: the default branch,
`dependabot/*`, any open PR, any protected branch, any branch carrying commits that
exist nowhere else, and — importantly — any branch whose API lookup *errored*. A
failed read is not an empty result, and the consequence here is irreversible.

### Deleting a branch that holds unmerged work

The `force_branches` input takes a comma-separated list of **exact** branch names and
releases them despite the unmerged-work refusal. It is deliberately awkward — exact
names typed per run, never a pattern — and it is narrow:

- **It cannot override the other refusals.** The default branch, `dependabot/*`, an
  open pull request and branch protection stay refused even when named. Those are
  about breaking something live, not about losing history, and naming a branch does
  not make deleting it safe. (Verified: naming all three of those changed nothing.)
- **It cannot delete unanchored work.** The tip is tagged `archive/<branch>` first,
  the tag is then *read back* to confirm it exists at that SHA, and only then is the
  branch deleted. A tag that fails to create or fails to verify leaves the branch
  alone. Deleting unmerged work immediately after failing to save it is the worst
  outcome available, so the code makes it unreachable.

The ordering is the entire safety property. A tip SHA written in a document works only
while the object stays reachable, and an unreferenced commit is eventually collected;
a tag is a real ref, so the commits outlive the branch indefinitely. Restore with:

```bash
git push origin archive/<branch>:refs/heads/<branch>
```

### Why a workflow rather than a command

This is worth recording because the previous explanation, given here and repeated
three times, was **wrong**. The blocker was described as "a sandboxed agent proxy
refusing delete refspecs with HTTP 403". The proxy never saw the request: its
failure log was empty and it reported no git conflicts. The real refusal came from
the maintaining agent's own **permission classifier**, which treats
`git push --delete` as destructive git — a local guardrail, correctly applied, and
nothing to do with network policy. The GitHub MCP surface has `create_branch` and no
delete counterpart, so that route was closed too.

Neither was worth fighting. A runner already holds `contents: write`, which is
exactly the permission a ref deletion needs. Moving the operation there is the fix:
not more permission for the agent, but the work running where the permission
already is.

`artifacts/sync/merged-branches-to-prune.txt` remains as the **historical recovery
record** — a dated capture of `<tip-sha> <branch>`. It is no longer an input to
anything.

## Known orphan: `codex/add-signalgrid-autopilot-evidence-bot`

The only branch carrying work that is **not** present on the default branch: two
scripts that exist only on that branch — check-text-safety.cjs and
signalgrid-autopilot-evidence.cjs (768 lines, last touched 2026-07-08). Reviewed and
**not** landed, for reasons that are about the code rather than its age:

- `signalgrid-autopilot-evidence.cjs` runs a **hardcoded list of nine commands**.
  `scripts/preflight.mjs` supersedes it and derives its gate list instead. Landing a
  hand-maintained command list would reintroduce exactly the declared-not-derived
  defect this repo has spent its history removing.
- `check-text-safety.cjs` asserts `minLines` against five specific paths, **four of
  which do not exist** on the default branch
  (`.github/workflows/signalgrid-autopilot-evidence.yml`, two `docs/*.md`,
  `.gitattributes`). It would fail on its first run.

**One idea in it was worth keeping, and has now been taken.** `check-text-safety.cjs`
scanned for U+FEFF and the bidirectional override/isolate range (U+202A–U+202E,
U+2066–U+2069) — the **Trojan Source** class (CVE-2021-42574): invisible characters
that make source render differently from how it compiles. No such scan existed
anywhere in this repo; gitleaks looks for secrets, not for text that lies about
itself, and for a codebase whose premise is that what you read is what runs, that was
a real gap.

`scripts/check-text-safety.mjs` now closes it, and closes it the way this repo builds
gates rather than the way the orphan did:

- **Scope derived, not typed.** Tracked files come from `git ls-files`; the character
  set comes from Unicode general category **Cf** (`\p{Cf}`), which is the standard's
  own name for invisible formatting characters and contains the entire Trojan Source
  range by definition. Four blank-rendering *letters* (the Hangul fillers) are named
  explicitly, because no Unicode property means "letter that looks like nothing".
- **Its silence is tested.** A scan for characters that almost never occur is
  indistinguishable from a scan that is not looking. So planted specimens — stated
  independently of the detector — must be caught before the gate will report on the
  repository at all. The first draft read its specimens *out of* the detector; a
  mutation test killed it, because deleting a code point deleted its only test too.

Wired into `scripts/preflight.mjs` and `Review Hub CI`.

**The open item is closed, and the owner then chose to delete the branch.** It was
never merged, so removing it discarded a pointer to commits that existed nowhere else
— which is why it went through `force_branches` rather than the normal rules, and why
its tip was tagged before the ref was removed. The work is still there:

```bash
# the four commits live on, restore the branch with
git push origin archive/codex/add-signalgrid-autopilot-evidence-bot:refs/heads/codex/add-signalgrid-autopilot-evidence-bot
```

The same applies to `codex/review-hub-local-dev-api-health` (1 commit) and
`codex/signalgrid-real-life-simulator-foundation` (4 commits), deleted in the same
run and anchored at `archive/<branch>` the same way.

## State at the last capture

**These are snapshot numbers and they go stale — recompute rather than cite them.**
The prune list's own header carries the date and the `SignalGrid_Alpha` commit it was
taken at, and this is the command that recomputes what is left over:

```bash
comm -23 <(git branch -r | grep -v HEAD | sed 's|.*origin/||' | sort) \
         <(awk '!/^#/ {print $2}' artifacts/sync/merged-branches-to-prune.txt | sort)
```

At the 2026-08-08 capture: **75 remote branches, 63 verified merged** and listed for
pruning, leaving 12 —

- `SignalGrid_Alpha`, the default branch.
- 7 `dependabot/*` branches, bot-owned.
- 1 open-PR branch: `claude/signalgrid-launch-plan-emxm01` → #152.
- 3 `codex/*` orphans: the evidence-bot branch above, plus
  `codex/review-hub-local-dev-api-health` and
  `codex/signalgrid-real-life-simulator-foundation`, whose content **did** reach the
  default branch by another route (`scripts/enforce-pnpm.cjs` and 21 simulator files
  are present) but which are not ancestors of it.

Merged state was read from each pull request, not from `git branch --merged` — for the
squash reason above. Note that GitHub's *list* endpoint returns `merged: false` even
for merged pull requests; the field that is actually populated there is `merged_at`,
and reading the wrong one would misclassify every branch on this page as live.

The four tier branches `alpha`, `beta`, `dev`, `prod` are in the prune list. They had
not moved since 2026-07-15 and nothing in CI or the compose files referenced them; as
stale pointers they implied a promotion flow this repo does not run.

**2026-09-02 — the promotion workflow was retired with them.**
`.github/workflows/promote.yml` ("Promote Tier") is deleted. It was a
`workflow_dispatch` whose `from`/`to` inputs were fixed choice lists over exactly
those four branch names, so with the branches pruned every dispatch it could
accept named a ref that resolves to nothing: `git ls-remote --heads origin`
returns none of `dev`/`alpha`/`beta`/`prod`. A workflow that can only fail is
worse than no workflow — it trains people to ignore red — and its own run
summary had already been rewritten once to explain, at run time, why every
promotion it offered was empty. Two related edits landed in the same change,
because neither could be deferred without breaking a gate or leaving a false
statement in the tree:

- `.github/workflows/codeql.yml` no longer triggers on `dev`/`alpha`/`beta`/`prod`
  pushes; those triggers had the same problem, and a scan wired to a ref that
  does not exist is a scan that never runs.
- `scripts/lib/ci-jobs.mjs` lost its `promote.yml:open-promotion-pr` NOT_A_GATE
  entry. `check-preflight-ci-parity.mjs` fails on a classification whose subject
  no longer exists, so the two are inseparable by construction.

The `release-engineer` review claim over the workflow is **retired, not deleted**,
in `docs/agent/review-coverage.json` (`retiredOn` / `retiredWhy`) — a deleted
surface retires its evidence rather than erasing it.

The tiers themselves are unaffected as **deployment environments**:
`SIGNALGRID_TIER`, `config/tiers/<tier>.env.example` and the fixture-safe rule in
`docs/BRANCHING_AND_ENVIRONMENTS.md` all still hold — read that page's branch
table as historical intent, since its own banner records that the branch half of
the model no longer exists. What is gone is the
branch-per-tier promotion flow. Reinstating it means recreating the four branches
*and* a promotion workflow — an owner decision, not a side effect of this sweep.
