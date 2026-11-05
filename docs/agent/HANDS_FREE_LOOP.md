# The hands-free loop: each leg, who owns it, and whether it runs

The owner's /goal (2026-11-02): "GitHub Repo -> Obsidian -> Mac Local LLM /
Obsidian-> GitHub Repo -> Obsidian -> Codex/Claude / Obsidian -> GitHub Repo".

This page maps each leg of that loop to the code that carries it. It records
whether the leg runs today, with the evidence, and which lane owns it. The cloud
lane measured it on 2026-11-02 at mainline `b0de57d179caa1a24e173433d4aaa8155be0ac8a`.

The vault itself is the owner's. Rule 8 of the local-first record in
`docs/DECISION_RECORDS.md` says so: it lives outside this tree, and nothing from
it is committed unless he puts it in. `scripts/work-queue.mjs` repeats the rule
for the queue: "Nothing from the private Obsidian vault is ever written here."
So every leg that reads or writes the vault runs on the Mac. The cloud lane
cannot see that machine, and this page cannot say whether those legs run there.
It can only say that this repository holds no code for them.

| # | Leg | Carried by | Owner | Runs today? | Evidence (2026-11-02) |
| --- | --- | --- | --- | --- | --- |
| 1 | GitHub → Obsidian | Not in this repo | Mac | **Runs on the Mac.** A launchd job (com.signalgrid.knowledge-mirror) mirrors the registers every 15 minutes; its script is outside this repo by design. | `git grep -i obsidian -- scripts` returns only two comments: the gitignore rule for `.obsidian/` and the privacy line in `work-queue.mjs`. |
| 2 | Obsidian → Mac local LLM (pick work) | `scripts/mac/local-brain/task-selector.mjs`, a pure function | Mac | **Selector only.** Nothing in the repo feeds it tasks or runs it. | Its only callers are its two test files and their preflight steps. |
| 3 | Mac LLM → GitHub (claim, build, PR) | `scripts/work-queue.mjs` (claims), `scripts/mac/estate-queue.mjs` (refresh and close), `scripts/mac/lane-tick.sh` (runs it hourly) | Mac | **Partly.** The estate queue runs. The claim queue has never been used. | `git ls-remote origin 'refs/queue/*'` printed nothing: zero claims on the Hub. `work-queue.mjs list` shows every task `free`. |
| 3a | Mac tick heartbeat → mainline | `lane-tick.sh`, which calls `lane-deliver heartbeat --no-wake` with a direct push | Mac | **Broken since 2026-10-24 07:30Z.** | The last heartbeat commit is `824328071` at 2026-10-24T03:30:41-04:00. The ruleset 25774497 rule `pull_request` now refuses direct pushes to mainline. The tick sends that failure to `/dev/null`, so the only trace is a WARN in its private log. The fix rides #1698: a heartbeat delivered by a protected PR. |
| 4 | Codex / Claude review | `work-queue.mjs review --lane codex\|cloud-claude` records each review against `{pr, head}`. Reviews also go on the PR itself. | Codex, cloud | **PR reviews run.** The queue record is blocked for the cloud. | `POST repos/…/git/commits` from the cloud session returned `HTTP 403 Write access to this GitHub API path is not permitted through this proxy.` The queue writes claims through that path, so `merged` (which needs both reviews) cannot be reached by queue rules. |
| 5 | Review → Obsidian | Not in this repo | Mac | **Not visible.** | Same as leg 1. |
| 6 | Obsidian → GitHub (land) | DR-037: the cloud lane lands; auto-merge fires when the gates pass | Cloud | **Runs.** | #1749 landed as `68cc378f`; #1755 landed as `b0de57d1` on 2026-11-02. |

## What closes each gap, and who does it

- **Legs 1, 2 and 5 (the Mac lane).**
  - The Mac brain names the script on its machine that does each of these, if one exists, and the schedule that runs it.
  - If none exists, it builds one outside this tree. A vault exporter and reader may not live here, under rule 8.
  - It reports back by lane mail what runs and when, never vault content.
- **Leg 3 (the Mac lane and Codex).** The builder claims through `work-queue.mjs claim` before it builds, so two lanes never build the same task. When the PR opens, it moves the claim to `pr` with the head.
- **Leg 3a (the Mac lane).** #1698 lands. The test is that `artifacts/agent-heartbeats/mac-lane-tick.json` on mainline reads a `firedAt` after 2026-10-24.
- **Leg 4 (the Mac lane and Codex propose; the owner decides if it touches access).** The cloud cannot write a claim commit. There are two options:
  - The owner lets this session write the Git Data API.
  - The queue accepts a cloud review recorded another way, such as a verdict comment on the PR that the Mac brain copies into the claim. The Mac must name where the comment came from.
  
  The second option weakens "each system uses its own credentials". It needs the Mac's and Codex's agreement, written into `work-queue.mjs`'s trust model, before it is used.

## When a paid model runs out (owner rule, 2026-11-02)

The owner, verbatim: "In any point of credit and or usage is up on any paid models then must switch to OmniRoute so it can determine best model to use and or allow LLM / Obsidian to gain and learn new skills to get the job done too."

- A lane whose paid model reports a usage or credit limit switches its model traffic to OmniRoute (DR-029, `docs/AGENT_GATEWAY.md`). OmniRoute picks the model, and the work continues. A limit is never a reason for a leg to stop or to be skipped.
- The switch happens where OmniRoute runs: on the Mac, keys out of tree. The cloud lane's model is set by its session and cannot be pointed at the gateway from here. When the cloud lane hits a limit, it says so by lane mail, and the Mac picks up the work through OmniRoute.
- Leg 4 has already hit this. On 2026-11-02 at 15:31Z, Codex's review of #1265 at `cc8cf974` ended with "You have reached your Codex usage limits for code reviews." Under this rule, the Mac runs that review through an OmniRoute-routed model and records which model and which head it read. Codex's own review resumes when its quota resets.
- A review routed through OmniRoute is recorded as what it is: the model and the route, never as a Codex review. The work-queue rule that `merged` needs both reviews is unchanged.
- The local LLM and the Obsidian brain may learn new skills to finish a job. A new skill lands as a reviewed PR like any other change, and vault content never enters the tree (rule 8).

## Publishing a reviewed local build

Use the [publisher source](../../scripts/mac/brain-proposal-pr.mjs) for one
`kind=build`/`status=review` job in SignalGrid-Review-Hub, with an owned
worktree and a nonempty public-safe diff.

```bash
node scripts/mac/brain-proposal-pr.mjs --job JOB_ID
node scripts/mac/brain-proposal-pr.mjs --job JOB_ID --publish
```

The default dry run still fetches and prepares a scratch commit. Publishing
pushes `brain/job-JOB_ID` and opens a PR. The CLI refuses owner/safety/decision
paths and specified private-path patterns; it does not certify arbitrary text
as secret-free, run full preflight/breadth, perform independent reviews, or
merge. Secret-safety review, full preflight/breadth and independent reviews
remain separate requirements before Cloud DR-037 landing.

## Never

- Never commit vault content, a vault path's contents, or a note title from the vault.
- Never record a review in the queue for a lane that did not perform it.
- Never read a leg as running because this page says so. Re-measure it with the commands in the evidence column.
