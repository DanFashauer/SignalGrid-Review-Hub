# .claude/workflows

Saved Workflow scripts (DR-060 rule 2, lesson L2) — plain JS files, each with a
top-level `export const meta = { name, description, phases }` that is a pure
literal (no logic, no `args` access) so the Workflow tool can list it without
running anything. The Workflow tool finds a workflow by that `name` field, not
by the filename.

## land-branch

Lands a worker branch: optional pre-edit stage, merge `origin/SignalGrid_Alpha`
and regenerate generated files on a clean index, run one sequential
preflight+breadth chain behind a file lock, push ONLY when the SCRIPT (not a
worker) verifies both exits are 0 on the unchanged expected head, then draft
and open the PR.

Invoke with the Workflow tool, `name: "land-branch"`, and this `args` object:

| Field | Required | What it is |
| --- | --- | --- |
| `repo` | yes | Absolute path to the shared repository root. |
| `scratch` | yes | Absolute path to the scratchpad base holding the chain lock and logs. |
| `worktree` | yes | Absolute path to the worker's own worktree — the only one touched. Must be a real `pnpm install --frozen-lockfile` checkout (the Merge stage, and the Pre stage too when `preBrief` is given, installs it offline when `scripts/node_modules/.bin/tsx` is missing — L17); a root `node_modules` symlink is not an install. |
| `branch` | yes | The branch being landed. |
| `tag` | yes | Short tag for this run's lock/log filenames. |
| `klass` | yes | The caller's initial GUESS at `SAFETY_MACHINERY` \| `DECISION_PATH` \| `OWNER_RESERVED` \| anything else. The Merge stage checks it against the diff and the DERIVED class wins for the PR's "Owner decision needed" section — see below — AND for whether the push runs at all: `--verify` re-derives the class itself at push time and refuses on a mismatch (Codex #1133 P1, see "The owner-decision class is derived, not trusted"). |
| `title` | yes | The PR title. |
| `trailers` | yes | The exact commit-trailer lines the caller wants on every commit this run makes. The script has no session baked in, so this and `sessionUrl` are how the caller supplies its own attribution. |
| `sessionUrl` | yes | The caller's session URL, appended under the PR body's "Generated with Claude Code" line. |
| `preBrief` | no | If set, runs an extra pre-edit stage before the merge. |
| `bodyNotes` | no | Extra notes folded into the PR body. |

Every required field is validated at the top of the script — not just for
presence, but for shape: `tag` must match `/^[a-z0-9][a-z0-9-]{0,31}$/`,
`repo`/`scratch`/`worktree` must be absolute paths with no spaces or shell
metacharacters, and `branch` must be a plain ref name with no `..`. A value
that fails throws immediately, before it is ever interpolated into shell text
handed to a worker — every field this file hands to a worker is a template
string, not an argv array, so an unvalidated `tag` containing `; rm -rf /`
would otherwise run on the landing host.

## The one rule

A workflow here never bypasses a gate. No `--no-verify`, no `--force`, no push
before the preflight+breadth sentinel reads 0/0 on the exact head it is
pushing.

**The push gate binds only when the push worker runs the given line as
given** — `--verify` is deterministic about what it checks, not about
whether an LLM agent's Bash tool actually runs it verbatim; a worker that ran
a bare `git push` instead would not be stopped by anything in this file
except the prompt telling it not to. Given that it runs, the push worker's
only git command is one shell line, invoked from `<worktree>` — never from
the shared `<repo>` checkout, which can sit on an older commit whose copy of
`land-branch-gate.mjs` predates `--verify` and silently no-ops on it — and
gated on the module's own literal `PASS` line via `grep`, not merely on exit
code (an older module that doesn't recognize `--verify` also exits 0 with no
output). Every step is chained with `&&`, never `;` — a failed `cd`, or the
verify command failing outright, stops the line before the push ever runs,
where a `;` after the `tee` once let a stale leftover file from an earlier
run under the same tag be mistaken for a fresh PASS (Codex #1130 P1) — and
the previous run's output file is removed FIRST, under `<scratch>`, never
under `/tmp`, so it can never be that stale leftover itself:
`cd <worktree> && rm -f <scratch>/<tag>-verify.out && node <worktree>/scripts/lib/land-branch-gate.mjs --verify --scratch <scratch> --tag <tag> --worktree <worktree> --branch <branch> --head <headSha> --klass <klass> | tee <scratch>/<tag>-verify.out && grep -q "^land-branch-gate --verify PASS: head <headSha> klass <klass> " <scratch>/<tag>-verify.out && git push -u origin HEAD:refs/heads/<branch>`.
`--verify` reads `<scratch>/<tag>-pf.log` and `<scratch>/<tag>-br.log` itself,
resolves `git -C <worktree> rev-parse HEAD` and
`git -C <worktree> rev-parse refs/heads/<branch>` itself, requires both to
equal the given `--head`, and applies the same `canPush()` the script already
uses for its own cheap first-pass gate
(`scripts/lib/land-branch-gate.mjs`'s `canPush()`, self-tested with
`node scripts/lib/land-branch-gate.mjs --self-test`, which also self-tests
`--verify` against a throwaway git repo under `os.tmpdir()`). What is
deterministic: file contents and ref resolution — `--verify` reads the
sentinel files and the worktree's own refs itself rather than trusting a
worker's paraphrase of them, and prints its literal `PASS`/`REFUSED` verdict
independent of any agent's account. What is not proven by any of this: that
`node scripts/preflight.mjs` and `pnpm run verify:breadth` actually ran on
this head — `--verify` only reads the sentinel files the chain job wrote; a
sentinel is trustworthy only insofar as the chain-run stage's own shell line
(§ Chain, land-branch.js) was the thing that produced it. A mismatch or a
missing/unparsable log file prints its reasons and the `grep -q` never
reaches the push. The push targets `HEAD:refs/heads/<branch>` explicitly,
rather than `git push origin <branch>`, so the ref that gets pushed is always
the validated worktree HEAD, never whatever `<branch>` happens to resolve to
locally if it does not match the checked-out ref. If a stage would need one
of those to proceed, it returns a blocker instead.

**`--klass` binds the push to the classifier's own answer, not to a worker's
report of it (Codex #1133 P1).** Before `--klass` existed, the Merge stage's
`klassLine` was worker-reported prose: a fabricated but validly-shaped line
(`KLASS other files=3 matched=0`) would resolve cleanly and steer both the PR
body and the returned `klass`, with nothing re-checking it against the real
diff at push time. Now, once the sentinel/head/ref checks above already pass,
`--verify --klass <klass>` runs
`node scripts/check-owner-gated-surfaces.mjs --classify-branch origin/SignalGrid_Alpha`
itself, in `<worktree>`, and refuses — `derived class <X> !== resolved class
<Y>`, or `classifier did not print a KLASS line: <raw>` — unless the
classifier's own verdict equals the `klass` the push worker was given. The
PASS line then carries the class: `land-branch-gate --verify PASS: head
<headSha> klass <klass> derived from origin/SignalGrid_Alpha in <worktree>`.
Omitting `--klass` keeps the exact pre-existing PASS line
(`… PASS: head <headSha> verified from <scratch>/<tag>-{pf,br}.log and
refs/heads/<branch>`) unchanged, so an older caller that never learned about
`--klass` keeps working.

## The owner-decision class is derived, not trusted

`klass` is only the caller's guess. After the Alpha merge, the Merge stage runs
`node scripts/check-owner-gated-surfaces.mjs --classify-branch origin/SignalGrid_Alpha`
in the worktree and returns its single printed line (`KLASS <klass> files=<n>
matched=<m>`, or `KLASS ERROR <reason>` on a git failure or an empty diff) as
`klassLine`. `scripts/lib/land-branch-gate.mjs`'s `resolveKlass()` parses that
line and lets the DERIVED class win over whatever `klass` the caller passed,
even when the caller's guess was already the safer one — an unparsable line
or an empty diff is a blocker, never a silent fall-back to the caller's claim.
`ownerDecisionText()` renders the "Owner decision needed" paragraph for the
resolved class. When the diff resolves to `OWNER_RESERVED` (the launch
profile, launch-claims gate, publication boundary, pricing, `LICENSE`/`NOTICE`,
or another owner-reserved surface), the workflow still pushes and opens the PR
so the owner can see it, but the run logs that the lane must not merge it, and
the returned object carries `klass` (the resolved verdict) so the coordinator
never merges an `OWNER_RESERVED` PR under DR-037. Both functions are MIRRORED
byte-for-byte into `.claude/workflows/land-branch.js` next to `canPush`'s
mirror, for the reason `canPush` is: the Workflow sandbox cannot import this
module.

## Re-running on a branch whose PR is already open

Running the workflow again on the same `branch`/`tag` after its PR has
already been opened pushes fine, but the PR-opener stage then fails: GitHub's
create-pull-request endpoint rejects a second call for the same `head`/`base`
pair with a 422 ("A pull request already exists for `<owner>:<branch>`") and
does not touch the existing PR's body. The opener stage only calls
`create_pull_request` — it has no update-on-existing path — so a re-run ends
with the PR stage reporting that 422 as a blocker, not with a refreshed body.
The coordinator refreshes the body by hand afterwards with
`update_pull_request` using the same `cleanBody` the run produced. (An
opener that instead called `update_pull_request` when create returns a 422
would make a re-run genuinely self-healing; that path does not exist yet and
should not be documented as if it did until it is built and tested.)
