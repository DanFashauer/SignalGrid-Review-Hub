# Git, GitHub Actions, gh — the commands the hooks refuse and the names that differ

The default branch is `SignalGrid_Alpha`, not `main`. `.claude/hooks/block-dangerous.sh`
denies `git reset --hard`, `git stash`, `--force`/`-f` pushes and `--no-verify` at
PreToolUse (quoted spans are stripped first, so only an INVOCATION trips it — a commit
message that mentions the command does not). `.claude/settings.json` adds
`Bash(git stash *)`. CLAUDE.md: destructive git is ask-first; done means the commit is
visible via `git ls-remote`. `docs/LANE_COORDINATION.md` governs how two lanes share a
branch. Verified 2026-09-04.

## Local git

1. **SAYS** "Revert everything to the last commit: `git reset --hard`."
   **BREAKS** BANNED — hook-denied, and it destroys the other lane's unsaved batch edits
   along with yours.
   **DO** save the patch first: `git add -A -N && git diff HEAD > "$TMPDIR/patch"`; then
   discard by NAMED path: `git restore --worktree --staged -- <paths>`. To catch up to
   origin: `git fetch origin` then `git merge --ff-only origin/SignalGrid_Alpha`.
2. **SAYS** `git stash` / `stash list` / `stash pop` / `stash drop`.
   **BREAKS** BANNED in all forms (hook, settings, CLAUDE.md "no stash-to-dodge"). The stash
   stack is also SHARED across every worktree and every concurrent session — a `pop` can
   take another session's changes.
   **DO** commit a WIP on the branch (follow-up commit later — never amend once pushed), or
   open a second worktree with the native `EnterWorktree` tool. `git switch` already carries
   non-conflicting changes across branches.
3. **SAYS** "Diff of what is changed but not staged: `git diff`."
   **BREAKS** a staged change is invisible to it. PR #366's `emitter.ts` and the shared
   `scripts/lib/sanitize.mjs` (staged as a new file) were both lost this way on 2026-09-01.
   **DO** `git add -A -N && git diff HEAD` (intent-to-add makes untracked files visible;
   `HEAD` includes staged), then compare the patch's file list against the claimed changes
   BEFORE writing the description.
4. **SAYS** "Checkout a single file from another branch: `git checkout <branch> -- <file>`"
   (and `git restore <file>` used the same way).
   **BREAKS** CLAUDE.md: never inside a sandbox holding unsaved batch edits — it discards them
   along with whatever you meant to undo.
   **DO** inspect without touching the tree: `git show <branch>:<path>`, `git diff <branch>
   -- <path>`. Only after the batch is committed, `git restore --source=<branch> -- <path>`.
   To test a guard, plant a self-test string in a COPY of the file.
5. **SAYS** "Commit all your tracked files: `git commit -am "…"`."
   **BREAKS** LANE_COORDINATION standing hazard: `validate-sim-macos.sh` runs `pnpm add -w`
   and rewrites `package.json` / `pnpm-lock.yaml` with darwin binaries on the Mac; `-a`
   commits the rewritten manifests, and CI then fails on `Install dependencies`.
   **DO** `git status --porcelain` first; stage by path; never `-a`/`-A` after a harness run.
   If the manifests were rewritten: restore them FIRST, then `pnpm install --lockfile-only`,
   then stage.
6. **SAYS** `git commit --amend -m`, `git commit --amend --no-edit`, `git push origin --delete
   <branch>`, `git branch -D`.
   **BREAKS** CLAUDE.md "Ask before: destructive git (force-push, history rewrite, branch
   deletion)"; `git push --force`/`-f` is hook-denied.
   **DO** fix with a follow-up commit. Amend only a commit that `git log origin/<branch>..HEAD`
   PROVES is still local. Delete branches only through the Actions "Branch prune" workflow
   (dry run, read the plan, then `apply`) or with the owner's explicit yes.
7. **SAYS** "Apply commits of the current branch ahead of the specified one: `git rebase
   <branch>`."
   **BREAKS** LANE_COORDINATION rule 3: base movement is absorbed by MERGE into the lane branch
   (prefer the deeper implementation, verify file by file, keep both when complementary).
   A rebase rewrites SHAs the other lane may already hold.
   **DO** `git fetch origin --prune` then `git merge --ff-only origin/SignalGrid_Alpha` (a
   plain merge when diverged). Rebase only commits `git log origin/<branch>..HEAD` shows are
   unpublished.
8. **SAYS** Conventional Commits — "commits MUST be prefixed with a type": `feat(ui)!: …`.
   **BREAKS** this repo's convention is a narrative subject that names the evidence and any
   SHARED SURFACE touched (LANE_COORDINATION rule 2: announce in the commit, not just the
   mail). Adopting `type:` prefixes is a doctrine change for the owner, not a lane's call.
   **DO** narrative subject + the two required trailers (`Co-Authored-By`, `Claude-Session`).
   The sheet's trailer rules do apply: one blank line after the body, `-` for whitespace in
   the token, `Token: value`.

## GitHub Actions

9. **SAYS** `run: npm install`, `npm install -g bats`, `npm test`.
   **BREAKS** ALWAYS `pnpm install --frozen-lockfile` on Node 22; npm ignores the
   `pnpm-workspace.yaml` overrides that strip every native binary except linux-x64-gnu.
   **DO** copy the `review-hub-ci.yml` preamble as-is: SHA-pinned `pnpm/action-setup` (v6,
   `version: 10.28.1`, `run_install: false`) → `actions/setup-node@v7` (node 22, `cache:
   pnpm`) → `pnpm install --frozen-lockfile`.
10. **SAYS** `node-version: '14'`, `actions/setup-node@v1`/`v2`/`v3`, `actions/checkout@v2`,
    `actions/cache@v2` with a `hashFiles('**/lockfile')` key.
    **BREAKS** Node 22 is pinned; `checkout@v7`, `setup-node@v7`, `upload-artifact@v7` are in
    use; third-party actions are pinned to a commit SHA with a `# vN` comment
    (`supply-chain.yml` convention).
    **DO** take action versions from an existing workflow, never from a sheet; pin
    non-GitHub actions by SHA; rely on `cache: pnpm`, not `actions/cache`.
11. **SAYS** `concurrency: group: ${{ github.head_ref }}  cancel-in-progress: true`.
    **BREAKS** `github.head_ref` is EMPTY on `push` events — every push run shares one nameless
    group, and a push to `SignalGrid_Alpha` cancels an unrelated in-flight run.
    **DO** `group: ${{ github.workflow }}-${{ github.ref }}` for push/PR workflows
    (`review-hub-ci.yml`); `group: mac-lane-${{ github.sha }}` for dispatched/scheduled long
    suites; `cancel-in-progress: false` where a cancelled run would lose evidence.
12. **SAYS** `if: github.ref == 'refs/heads/main'`.
    **BREAKS** the default branch is `SignalGrid_Alpha`. A copied `main` condition NEVER fires
    and the step silently never runs — a fail-OPEN gate, the exact shape the repo forbids.
    **DO** `if: github.event_name == 'push'` (`supply-chain.yml` — push triggers only on
    `SignalGrid_Alpha`) or spell it out: `github.ref == 'refs/heads/SignalGrid_Alpha'`. Add a
    step that PROVES the guarded step ran.
13. **SAYS** `run: echo "The secret is ${{ secrets.MY_SECRET }}"`, and `${{ … }}` interpolated
    inside `run:` generally.
    **BREAKS** prints a secret into the run log (`supply-chain.yml` carries a `secret-scan`
    job that will find it), and inline expression interpolation into `run:` is the
    script-injection vector.
    **DO** pass values through `env:` and consume them from a script — `env: GH_TOKEN: ${{
    github.token }}` → `run: node scripts/prune-merged-branches.mjs` (`branch-prune.yml`).
    Never echo a secret.
14. **SAYS** every workflow skeleton in the sheet — no `permissions:` block.
    **BREAKS** repo workflows declare least privilege at the top (`permissions: contents:
    read`, plus `actions: read` where `check-ci-liveness.mjs` must read runs). A missing
    block means the default token scope, which is wider.
    **DO** every new workflow starts with an explicit `permissions:` block; a write scope
    lives on the JOB that needs it, with a comment naming the step and why.
15. **SAYS** cron examples `15 2 * * 1L` (last Monday), `15 0 * * 4#2`, `?`, `@daily`, `@reboot`.
    **BREAKS** Actions `schedule:` is POSIX 5-field only; `L`, `W`, `#`, `?` and `@` strings
    are Quartz/Vixie extensions that make the workflow INVALID.
    **DO** plain 5-field UTC (`17 7 * * *`, `0 6 * * 1`). For "last Monday" logic, schedule
    weekly and test the date inside the job. (On the Mac, cron itself is the wrong tool —
    see `mac-host.md`.)

## gh

16. **SAYS** `gh auth --with-token < token.txt`; `gh auth token` ("print the token gh uses").
    **BREAKS** credential-shaped commands — the Bash classifier blocks them, and `gh auth
    token` prints a LIVE token into the transcript. On this Mac the keyring token is
    currently INVALID, so empty `gh` output means nothing.
    **DO** `gh auth status` (read-only) before trusting ANY gh output; hand `gh auth refresh -h
    github.com` (browser flow) to the owner; never print or paste the token.
17. **SAYS** `gh repo delete`, `gh release delete`, `gh run delete`, `gh workflow disable` as
    plain one-liners.
    **BREAKS** ask-first, external effect — and `gh workflow disable` silently switches off a
    gate.
    **DO** ask. Prefer the reversible verbs: `gh run cancel`, `gh run rerun --failed`, `gh
    workflow view`, `gh run view <id> --log-failed`, `gh run watch`. To stop a scheduled
    workflow, edit its `on:` in a reviewed commit so the change is visible in history.

## Forms that survived — keep these

- `git ls-remote origin refs/heads/<branch>` — this repo's definition of DONE, and absent
  from every sheet's "synchronize" section.
- `git log origin/<branch>..HEAD` — what is still local (the test before any amend).
  `git log branchB..branchA` (on A, not B); `git diff branchB...branchA`.
- `git log -S'<term>'` (search by content), `git log --follow <file>`, `git log --stat -M`.
- `git reflog` → `git branch rescue-<x> <sha>` — never the sheet's `git checkout <hash>`.
- `git cherry-pick -x <sha>` records the source SHA in the message.
- `git worktree list` / `prune` / `remove <path>` (refuses a LOCKED tree). The worktree
  guard in this repo refuses compound git chains (`a && b`), `export PATH=` and `curl | sh`
  — run plain, single git commands.
- Actions step conditions: `if: failure()`, `if: always()`, `if: github.event_name ==
  'push'`; `workflow_dispatch:` with typed `inputs:`; `echo "NAME=value" >> "$GITHUB_ENV"`
  to pass a computed value between steps.
