# Backlog landing - the open PR, issue and branch queue, and who may act on it

The owner, 2026-10-22: *"look for all these issues and pull requests plus need to get all the
branches merged into main branch."* This page is the short form of how that is done without
cutting a corner the repo already forbids. The procedure is the `backlog-landing` skill
(`.claude/skills/backlog-landing/SKILL.md`); the reading is one tool.

## What the queue is

Every open pull request, every open issue (a pull request is not an issue here) and every
branch that carries no open PR, read once from the GitHub REST API, with a **disposition and a
reason for each pull request**. The same inputs give the same answer twice: rows sort by
disposition and then number, and ages are measured from one instant that can be injected.

"Zero" does not mean an empty list. It means every item has a disposition, a named actor and one
quoted piece of evidence. Merging what DR-037 does not allow, or closing a PR to shrink the
number, is the failure this exists to prevent.

## The one command

```bash
node scripts/backlog-triage.mjs                       # markdown report on stdout
node scripts/backlog-triage.mjs --json                # the same data, stable key order
node scripts/backlog-triage.mjs --declared-live 1559,1586:worker B91
node scripts/backlog-triage.mjs --self-test           # fixture cases, no network
node scripts/backlog-triage.mjs --mutants             # every planted defect must turn the self-test red
```

It needs `GH_TOKEN` or `GITHUB_TOKEN`. It sends GET requests only, to `api.github.com`, carrying the
repository slug, numbers, head SHAs and changed-file paths GitHub already holds (the token goes in the
Authorization header to that host and is never printed), and it merges, approves,
comments, closes and deletes nothing; the one file it can write is the page named by
`--snapshot`, between the two markers below. It stops instead of printing a queue when the
token is missing or a placeholder (exit 2), when GitHub rejects it or answers as an anonymous
client (exit 2), when the rate limit left cannot cover the read (exit 2), or when the pulls
list, the issues list and the repository's own open count disagree after three reads (exit 3).
An empty page is "no PRs" only when the repository's count says zero.

Other refusals, each with a message and no queue:

- **A 403 that is not a rate limit, or a 404, on a read the whole queue depends on** (the rate
  limit, the repository, the open lists, the branch and closed-PR lists): exit 2, "GitHub
  refused or failed a read the whole queue depends on". It means the token cannot read the
  repository. `--snapshot` stamps the page "not generated here" (and leaves a real dated
  snapshot alone). A persistent 5xx after retries is the same message with exit 3. A 403 on
  the reads of ONE PR (its files, its checks, its comments) is that PR's UNKNOWN row, and the
  rest of the queue still prints.
- **A short page.** The branch list is read against a count from `per_page=1` and the `Link`
  header, as the closed-PR list is; fewer branches read than the repository reports is exit 3.
  Each PR's review comments are read against the PR's own `review_comments` count: a different
  number, or no count, makes that PR's comments unreadable, which blocks LAND (it does not stop
  the report).

Other flags: `--threads-file` (exact review-thread counts read elsewhere),
`--declared-live-file`, `--repo`, `--base`, `--repo-dir`, `--no-local-git`, `--now`,
`--concurrency`, `--allow-count-drift`. `--help` lists them. The report names the checkout
as "this checkout", never by its absolute path: the snapshot below is committed to a public repository.

## The dispositions, and who may act on each

A pull request gets the first rule that holds, in this order. A STALE, SUPERSEDED or IN-FLIGHT
row keeps what it would otherwise be in its `natural` field.

| Disposition | Rule | Who may act |
| --- | --- | --- |
| STANDING | the mailbox PR in `docs/agent/lane-mailbox.json` (number and branch match): a draft with no files. Any other PR from that branch is UNKNOWN, never LAND | nobody lands or closes it; it is the cloud lane's wake channel |
| IN-FLIGHT | named by `--declared-live` (the tool cannot see a worker) | leave it alone; its worker owns it |
| SUPERSEDED | its head is an ancestor of mainline, or a `mac/tick-*` snapshot whose every file was rewritten on mainline after its head commit, or is a sim-request whose result is on mainline | a person closes it; the brain proposes with the evidence the row prints |
| STALE | idle more than 14 days AND (conflicting OR red: the NEWEST run of the gating check, the Mac-only check or CodeQL failed; an older failed run that a re-run replaced is history; code scanning, `phase-pr-evidence` and the SBOM check are advisory) | the owner decides revive or close |
| OWNER-MERGE | the diff reaches DECISION_PATH or OWNER_RESERVED (`classifyDiff` in `scripts/check-owner-gated-surfaces.mjs`), an owner-named surface (AGENTS.md, the decision records, the launch profile, the launch-claims gate, the publication boundary), or the branch is Dependabot's, comes from a fork, or is not a lane's own | the owner merges; a lane only keeps it mergeable |
| MAC-ASK-NEEDED | any `mac/*` PR no earlier rule placed. DR-037 condition 5 wants the Mac's ask in MAIL, which the tool does not read, so it never prints LAND for a `mac/*` PR. A body line that reads as an ask prints `ask in body; confirm mail`. A `mac/tick-*` PR that is not SUPERSEDED is here too: a stricter reading than `docs/LANE_COORDINATION.md` rule 2, and "Tick PRs" below says why it holds | the Mac asks in mail; the cloud lane confirms the mail and lands only what it names |
| LAND-UNDER-DR-037 | a cloud-lane branch (`claude/*`, `lane/cloud-*`; never a `mac/*` PR or the mailbox PR) that is landable now: not a draft, not stacked, the gating check's newest run passed on the head, nothing failing or running, not conflicted, the review comments read in full with no thread it cannot show resolved, body mentions preflight and breadth | the cloud lane, one PR at a time, after DR-037's five conditions are read on the head |
| UNKNOWN | the rules have no row for what was read, or a fact could not be read (a file list cut short, a check list that failed to load, a mergeable state GitHub has not computed) | nobody lands it; the reason is on the row |

UNKNOWN is never LAND. Unknown tightens (golden rule 2).

## What it cannot know

- **Review-thread resolution.** GitHub exposes it through GraphQL only. The tool reads each PR's
  review comments over REST and prints `~a/b` (b root comments, a with no reply). That is a
  heuristic, so a PR with any review thread is held back from LAND unless a caller supplies
  exact numbers with `--threads-file`.
- **Mac lane mail.** The tool does not read it. A body line that reads as an ask is flagged,
  never trusted: a body has no provenance (every lane pushes as one account, and a body can be
  rewritten). The detector counts a sentence only when it is about THIS PR ("the cloud lane
  may merge under DR-037 once CI is green", "land this PR") and not when it describes the rule
  ("the cloud lane can merge its own PRs") or names another PR (`#1234`). The skill's section 3,
  step 6 confirms the ask in `pnpm run lane:inbox` and `artifacts/lane-messages/`.
- **A mergeability GitHub has not computed.** It recomputes every PR when mainline moves. A PR whose `mergeable_state` is still unknown after three re-reads is never called clean: it blocks landing, and an idle one past the window is UNKNOWN.
- **Live workers.** Only `--declared-live` makes a PR IN-FLIGHT. A PR touched in the last three
  hours and not declared is flagged.
- **Whether preflight and breadth really passed.** The tool checks the body mentions both.
- **Whether a branch's work reached mainline another way.** A branch is PRUNABLE only when a
  merged PR has its head ref and the tip is that PR's head; TIP-MOVED and UNMERGED say what is
  and is not known. Deleting any branch is a person's act (CLAUDE.md, "Ask before"), and the
  report prints how many branches say `protected: true`, which the prune scripts honour.
- **Which run of a check name is the verdict.** The tool takes the newest run (highest id) of
  each name. Two workflows that share a job name collapse to the newer; the gating check, the
  Mac-only check and CodeQL are unique names.
- **Mainline ancestry from a shallow or stale checkout.** Local git saying "yes" is conclusive;
  "no" is conclusive only for a whole checkout whose mainline ref is the live head. The REST
  compare endpoint answers the rest, and the report says how many PRs each source answered.

The read costs about six GET requests per open PR from the account-wide rate limit that every
session shares. Read it once per sweep.

## Tick PRs: rule 2 and DR-037 condition 5 read differently, and the stricter one holds here

`docs/LANE_COORDINATION.md` rule 2 has the cloud steward open each `mac/tick-*` PR and merge it
after the lesson L12 check, and the objective-loop decision record says the cloud merges tick
PRs under DR-037. DR-037 condition 5 lets the lane land only a PR it opened or was asked to
drive. `scripts/mac/lane-tick.sh` opens the PR itself whenever `gh` is on the Mac's PATH, and
every lane pushes as one account, so the API cannot say who opened a given tick PR.

The tool therefore never reads an unsuperseded tick PR as landable: it prints MAC-ASK-NEEDED
and the row says why. That is the stricter reading, taken because the tool cannot see the one
fact rule 2 turns on; it is not a claim that rule 2 is wrong. The steward routine keeps landing
the tick PRs it opened under rule 2. A sweep lands a tick PR only when the steward opened it or
the Mac's mail names it. A tick PR is SUPERSEDED only on the tool's per-file evidence.

## This PR is the owner's

The PR that added this page, the skill and the tool (`claude/build-backlog-landing-skill`)
edits `scripts/publication-boundary.mjs`, the carve-out a first-party skill needs. The tool's own
classifier prints an owner-named publication-boundary surface for that file list
(`scripts/backlog-triage.mjs --self-test` runs the list through it). So:

> this PR is the owner's, by the tool's rule.

DR-037 says the same in its own words: the lane does not "merge anything that changes the launch
profile, the launch-claims gate or the publication boundary". A lane keeps this PR mergeable and
does not land it. The same holds for any later PR that adds a first-party skill.

## Checking the tool

`node scripts/backlog-triage.mjs --self-test` runs the fixture cases against an in-memory GitHub,
each rule beside a control that lands the other way. `node scripts/backlog-triage.mjs --mutants`
plants each defect in `MUTANTS` (a rule removed, a guard turned off, a doc line reverted) in a
temporary copy and demands that the self-test turn red for it; the normal self-test also checks
that every row of that table still applies, so the table cannot drift from the source.
Preflight and the CI job run both.

Ceilings, named so nobody mistakes them for guarantees:

- The planted defects are text substitutions that someone chose. They show that these removals
  are caught, not that every defect is.
- The branch and closed-PR counts trust the `Link` header's last page. GitHub sends it through
  the agent proxy (checked 2026-10-22: 224 branches); a proxy that stripped it would read as one
  page and blind the short-page guard.
- The review-comment count check is exact. A comment posted between the PR read and the comment
  read makes the two differ, and that PR reads as UNKNOWN for that run: fail-closed, not wrong.
- The body-ask detector is a sentence heuristic. A false positive costs one confirming look at
  the mail; the mail is the ask, so a false negative costs only a missed prompt.
- Reading the newest run of each check name collapses two workflows that share a job name.

## Snapshot

The block below is written by `node scripts/backlog-triage.mjs --markdown --snapshot docs/agent/BACKLOG_LANDING.md`
and by nothing else. It is a dated reading, not a live view: re-generate before acting on it.

<!-- backlog-triage:snapshot:begin - generated by `node scripts/backlog-triage.mjs --markdown --snapshot docs/agent/BACKLOG_LANDING.md`; never hand-edit between the markers -->

_Snapshot read 2026-10-22T22:58:37.958Z from DanFashauer/SignalGrid-Review-Hub; mainline SignalGrid_Alpha @ 93e8a90fc. It is a dated reading, not a live view: re-generate before acting on it._

| Disposition | Count |
| --- | --- |
| MAC-ASK-NEEDED | 1 |
| OWNER-MERGE | 39 |
| SUPERSEDED | 4 |
| STALE | 30 |
| IN-FLIGHT | 3 |
| STANDING | 1 |
| **Total** | **78** |

| Disposition | claude | mac | lane | dependabot |
| --- | --- | --- | --- | --- |
| MAC-ASK-NEEDED | 0 | 1 | 0 | 0 |
| OWNER-MERGE | 25 | 6 | 0 | 8 |
| SUPERSEDED | 0 | 4 | 0 | 0 |
| STALE | 12 | 17 | 0 | 1 |
| IN-FLIGHT | 3 | 0 | 0 | 0 |
| STANDING | 0 | 0 | 1 | 0 |

- MAC-ASK-NEEDED (1): #1354
- OWNER-MERGE (39): #1050 #1083 #1117 #1146 #1153 #1219 #1220 #1224 #1239 #1240 #1242 #1251 #1255 #1265 #1280 #1307 #1321 #1330 #1337 #1357 #1381 #1382 #1383 #1384 #1385 #1386 #1387 #1431 #1438 #1439 #1440 #1441 #1442 #1443 #1445 #1459 #1463 #1556 #1562
- SUPERSEDED (4): #1509 #1510 #1511 #1569
- STALE (30): #1037 #1118 #1121 #1133 #1190 #1215 #1222 #1225 #1228 #1230 #1244 #1246 #1247 #1309 #1314 #1320 #1322 #1323 #1336 #1338 #1353 #1356 #1379 #1390 #1398 #1416 #1417 #1422 #1424 #1433
- IN-FLIGHT (3): #1559 #1585 #1586
- STANDING (1): #439

Issues: 6 open; no two share a title.
Branches: 224 total, 78 with an open PR, 145 without (4 PRUNABLE, 6 TIP-MOVED, 135 UNMERGED); 224 report protected: true.

How this was read:

- Open items: 78 PRs + 6 issues = 84; the repository's open count says 84 (agree).
- Mainline ancestry: local git: this checkout is shallow, its origin/SignalGrid_Alpha is the live head; it answered 0 PR(s), the REST compare endpoint 75, 0 left unread.
- Review threads: REST heuristic: root review comments and which have a reply, each list checked against the PR's own review_comments count (a different number makes that PR's comments unreadable, which blocks LAND). GitHub shows resolution through GraphQL only, which this tool does not call, so any PR with a review thread counts as having an open one.
- Declared in-flight: #1559 #1585 #1586.
- Mac lane mail is not read by this tool, and a line in a mac/* PR body is never the Mac's ask: the tool prints no LAND for a mac/* PR (a body ask reads "ask in body; confirm mail").
- A PR is IN-FLIGHT only if --declared-live names it; the tool cannot see a worker.

<!-- backlog-triage:snapshot:end -->

## Related

- `.claude/skills/backlog-landing/SKILL.md` - the procedure: order of work, landing one PR, reporting.
- `.claude/skills/landing-under-dr-037/SKILL.md` and DR-037 in `docs/DECISION_RECORDS.md` - the five conditions.
- `docs/LANE_COORDINATION.md` - who may land whose PR, and how the lanes mail each other.
- `docs/BUILD_BACKLOG.md` - the backlog row for the duplicate "Raised hands" issues.
