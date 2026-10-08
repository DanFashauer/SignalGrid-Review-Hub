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
| `worktree` | yes | Absolute path to the worker's own worktree — the only one touched. |
| `branch` | yes | The branch being landed. |
| `tag` | yes | Short tag for this run's lock/log filenames. |
| `klass` | yes | `SAFETY_MACHINERY` \| `DECISION_PATH` \| anything else, for the PR's "Owner decision needed" section. |
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
`cd <worktree> && rm -f <scratch>/<tag>-verify.out && node <worktree>/scripts/lib/land-branch-gate.mjs --verify --scratch <scratch> --tag <tag> --worktree <worktree> --branch <branch> --head <headSha> | tee <scratch>/<tag>-verify.out && grep -q "^land-branch-gate --verify PASS: head <headSha> " <scratch>/<tag>-verify.out && git push -u origin HEAD:refs/heads/<branch>`.
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

## signalgrid-review-wave

Adversarial review of worker PRs on the DR-047 tiers: a Sonnet reviewer per
PR in its own detached worktree (`<scratch>/rv<PR>w<round>`, cut from the
already-fetched `refs/remotes/pr/<PR>`), then an Opus refuter that tries to
overturn the verdict in a second worktree (`…r`). Reviewers never write into
the shared checkout, never run preflight/breadth/test:api (fixed ports collide
across concurrent reviewers — the landing chain runs those), plant mutants
only inside their worktree and revert each with `git restore`, and end by
deleting the worktree's `node_modules` with `find … -delete` (never the
worktree itself — L22). Verdict is `ship` / `fix-needed` / `owner-decision`;
`owner-decision` whenever the diff classifies DECISION_PATH or OWNER_RESERVED.

Invoke with the Workflow tool, `name: "signalgrid-review-wave"`, and this
`args` object:

| Field | Required | What it is |
| --- | --- | --- |
| `prs` | yes | Array of `{ pr, head, round, tier, refute, title }` — full 40-char head sha, round number for the verdict comment, `tier` from `classifyDiff`, `refute: true` to add the Opus stage. |
| `repo` | yes | Absolute path to the shared repository root (read-only for the agents). |
| `scratch` | yes | Absolute path to the scratchpad base holding the review worktrees. |
| `alpha` | yes | The `origin/SignalGrid_Alpha` sha the review is measured against. |
| `stamp` | yes | A label for the wave, folded into the log line and the returned object. |

It returns `{ stamp, results: [{ pr, round, review, refute }] }`; a reviewer
that died returns `review: null` and the script logs it as DEAD rather than
filtering it away (DR-054). The journal under the run's transcript directory
holds every agent's raw return value.

### helpers/

Session-independent copies of the two scripts the coordinator runs around the
wave, kept in the tree because a container rebuild wiped the scratchpad copies
on 2026-10-08 and they had to be rewritten from memory:

- `helpers/review-wave-verdict.py <journal.jsonl> <wave> [out_dir]` — turns
  the wave's journal into one `c<PR>w<wave>.md` verdict comment per PR: the
  reviewer's verdict, the refuter's upheld/refuted call (the refuter's
  counter-verdict wins when it refutes), findings with the command and exit
  code behind each, and the "Next" paragraph for that verdict. It replaces
  `@claude` with `@ claude` so a posted comment never summons the GitHub
  workflow. Run it with `python3 -I`; the coordinator posts the file with
  `gh api -X POST …/issues/<PR>/comments -F body=@<file>`.
- `helpers/land-first-half.sh <PR> <branch> <expected-head>` — the first half
  of a DR-037 landing for a `ship` verdict, used when the `land-branch`
  workflow cannot be dispatched: fetch, refuse if the branch head moved,
  detach a worktree at `<scratch>/wt-<PR>`, merge `origin/SignalGrid_Alpha`,
  regenerate the sync manifest and the coverage page on a clean index (each as
  its own commit), run preflight then breadth into `<scratch>/land-<PR>-*.log`,
  and push `HEAD:refs/heads/<branch>` ONLY when both logs carry their literal
  PASSED line. Needs `SIGNALGRID_SCRATCH` (absolute scratchpad path) and
  optionally `SIGNALGRID_REPO`. The second half — re-read the head, wait for
  the gating check on it, merge with the full sha, post the landing record —
  stays with the coordinator; this script never merges.
