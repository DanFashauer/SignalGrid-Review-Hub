# .claude/workflows

Saved Workflow scripts (DR-060 rule 2, lesson L2) — plain JS files, each with a
top-level `export const meta = { name, description, phases }` that is a pure
literal (no logic, no `args` access) so the Workflow tool can list it without
running anything. The Workflow tool finds a workflow by that `name` field, not
by the filename.

## land-branch

Lands a worker branch: optional pre-edit stage, merge `origin/SignalGrid_Alpha`
and regenerate generated files on a clean index, run one sequential
preflight+breadth chain behind a file lock, push ONLY when both exits are 0 on
the unchanged expected head, then draft and open the PR.

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
| `preBrief` | no | If set, runs an extra pre-edit stage before the merge. |
| `bodyNotes` | no | Extra notes folded into the PR body. |

## The one rule

A workflow here never bypasses a gate. No `--no-verify`, no `--force`, no push
before the preflight+breadth sentinel reads 0/0 on the exact head it is
pushing. If a stage would need one of those to proceed, it returns a blocker
instead.
