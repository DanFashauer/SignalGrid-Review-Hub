# Branch hygiene — what the branches mean, and which ones are load-bearing

A visitor to this repo sees the branch list before they see anything else. This
file says what that list means, so an outsider can tell live work from residue
without asking.

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

To prune (needs a shell whose git can push delete refspecs — a sandboxed agent
proxy may refuse those with HTTP 403 while allowing ordinary pushes):

```bash
awk '!/^#/ {print $2}' artifacts/sync/merged-branches-to-prune.txt \
  | xargs -n 20 git push origin --delete
```

Regenerate the list before trusting it — it is a snapshot, not a live view. Verify
each entry against its PR merge state, not against `git branch --merged`.

## Known orphan: `codex/add-signalgrid-autopilot-evidence-bot`

The only branch carrying work that is **not** present on the default branch:
`scripts/check-text-safety.cjs` and `scripts/signalgrid-autopilot-evidence.cjs`
(768 lines, last touched 2026-07-08). Reviewed and **not** landed, for reasons that
are about the code rather than its age:

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

**The open item is closed, so the branch is no longer being kept for it.** It is
deliberately NOT in the prune list: that list holds branches verified *merged*, and
this one never was, so deleting it discards its two files rather than tidying a
pointer. It is now an ordinary owner decision — delete it, or keep it as a museum
piece — with nothing outstanding depending on the answer. Its tip is recorded here so
the choice stays reversible either way:

```bash
# restore if deleted
git push origin 9b3e618eebe8368415d337c6e86849ca5ea31777:refs/heads/codex/add-signalgrid-autopilot-evidence-bot
```

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
