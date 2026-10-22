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

Other flags: `--threads-file` (exact review-thread counts read elsewhere),
`--declared-live-file`, `--repo`, `--base`, `--repo-dir`, `--no-local-git`, `--now`,
`--concurrency`, `--allow-count-drift`. `--help` lists them.

## The dispositions, and who may act on each

A pull request gets the first rule that holds, in this order. A STALE, SUPERSEDED or IN-FLIGHT
row keeps what it would otherwise be in its `natural` field.

| Disposition | Rule | Who may act |
| --- | --- | --- |
| STANDING | the mailbox PR in `docs/agent/lane-mailbox.json`: a draft with no files | nobody lands or closes it; it is the cloud lane's wake channel |
| IN-FLIGHT | named by `--declared-live` (the tool cannot see a worker) | leave it alone; its worker owns it |
| SUPERSEDED | its head is an ancestor of mainline, or a `mac/tick-*` snapshot whose every file was rewritten on mainline after its head commit, or is a sim-request whose result is on mainline | a person closes it; the brain proposes with the evidence the row prints |
| STALE | idle more than 14 days AND (conflicting OR red: the gating check, the Mac-only check or CodeQL failed; code scanning, `phase-pr-evidence` and the SBOM check are advisory) | the owner decides revive or close |
| OWNER-MERGE | the diff reaches DECISION_PATH or OWNER_RESERVED (`classifyDiff` in `scripts/check-owner-gated-surfaces.mjs`), an owner-named surface (AGENTS.md, the decision records, the launch profile, the launch-claims gate, the publication boundary), or the branch is Dependabot's, comes from a fork, or is not a lane's own | the owner merges; a lane only keeps it mergeable |
| MAC-ASK-NEEDED | a `mac/*` PR DR-037 lets the cloud lane land only on the Mac's ask: no ask in its body, or an ask with a blocker named on the row | the Mac asks; the cloud lane lands only what the Mac names |
| LAND-UNDER-DR-037 | a cloud-lane branch (or a `mac/*` PR whose body asks) that is landable now: not a draft, not stacked, gating check passed on the head, nothing failing or running, not conflicted, no review thread it cannot show resolved, body mentions preflight and breadth | the cloud lane, one PR at a time, after DR-037's five conditions are read on the head |
| UNKNOWN | the rules have no row for what was read, or a fact could not be read (a file list cut short, a check list that failed to load, a mergeable state GitHub has not computed) | nobody lands it; the reason is on the row |

UNKNOWN is never LAND. Unknown tightens (golden rule 2).

## What it cannot know

- **Review-thread resolution.** GitHub exposes it through GraphQL only. The tool reads each PR's
  review comments over REST and prints `~a/b` (b root comments, a with no reply). That is a
  heuristic, so a PR with any review thread is held back from LAND unless a caller supplies
  exact numbers with `--threads-file`.
- **Mac lane mail.** A `mac/*` ask is read from the PR body only.
- **A mergeability GitHub has not computed.** It recomputes every PR when mainline moves. A PR whose `mergeable_state` is still unknown after three re-reads is never called clean: it blocks landing, and an idle one past the window is UNKNOWN.
- **Live workers.** Only `--declared-live` makes a PR IN-FLIGHT. A PR touched in the last three
  hours and not declared is flagged.
- **Whether preflight and breadth really passed.** The tool checks the body mentions both.
- **Whether a branch's work reached mainline another way.** A branch is PRUNABLE only when a
  merged PR has its head ref and the tip is that PR's head; TIP-MOVED and UNMERGED say what is
  and is not known. Deleting any branch is a person's act (CLAUDE.md, "Ask before"), and the
  report prints how many branches say `protected: true`, which the prune scripts honour.
- **Mainline ancestry from a shallow or stale checkout.** Local git saying "yes" is conclusive;
  "no" is conclusive only for a whole checkout whose mainline ref is the live head. The REST
  compare endpoint answers the rest, and the report says how many PRs each source answered.

The read costs about six GET requests per open PR from the account-wide rate limit that every
session shares. Read it once per sweep.

## Snapshot

The block below is written by `node scripts/backlog-triage.mjs --markdown --snapshot docs/agent/BACKLOG_LANDING.md`
and by nothing else. It is a dated reading, not a live view: re-generate before acting on it.

<!-- backlog-triage:snapshot:begin - generated by `node scripts/backlog-triage.mjs --markdown --snapshot docs/agent/BACKLOG_LANDING.md`; never hand-edit between the markers -->

_Snapshot read 2026-10-22T20:02:18.637Z from DanFashauer/SignalGrid-Review-Hub; mainline SignalGrid_Alpha @ af6fba6dc. It is a dated reading, not a live view: re-generate before acting on it._

| Disposition | Count |
| --- | --- |
| MAC-ASK-NEEDED | 1 |
| OWNER-MERGE | 40 |
| SUPERSEDED | 4 |
| STALE | 29 |
| IN-FLIGHT | 4 |
| STANDING | 1 |
| **Total** | **79** |

| Disposition | claude | mac | lane | dependabot |
| --- | --- | --- | --- | --- |
| MAC-ASK-NEEDED | 0 | 1 | 0 | 0 |
| OWNER-MERGE | 26 | 6 | 0 | 8 |
| SUPERSEDED | 0 | 4 | 0 | 0 |
| STALE | 11 | 17 | 0 | 1 |
| IN-FLIGHT | 4 | 0 | 0 | 0 |
| STANDING | 0 | 0 | 1 | 0 |

- MAC-ASK-NEEDED (1): #1354
- OWNER-MERGE (40): #1050 #1083 #1117 #1146 #1153 #1219 #1220 #1224 #1239 #1240 #1242 #1251 #1255 #1265 #1280 #1307 #1309 #1321 #1330 #1337 #1357 #1381 #1382 #1383 #1384 #1385 #1386 #1387 #1431 #1438 #1439 #1440 #1441 #1442 #1443 #1445 #1459 #1463 #1556 #1562
- SUPERSEDED (4): #1509 #1510 #1511 #1569
- STALE (29): #1037 #1118 #1121 #1133 #1190 #1215 #1222 #1225 #1228 #1230 #1244 #1246 #1247 #1314 #1320 #1322 #1323 #1336 #1338 #1353 #1356 #1379 #1390 #1398 #1416 #1417 #1422 #1424 #1433
- IN-FLIGHT (4): #1559 #1585 #1586 #1600
- STANDING (1): #439

Issues: 6 open; no two share a title.
Branches: 224 total, 79 with an open PR, 144 without (4 PRUNABLE, 6 TIP-MOVED, 134 UNMERGED); 224 report protected: true.

How this was read:

- Open items: 79 PRs + 6 issues = 85; the repository's open count says 85 (agree).
- Mainline ancestry: local git checkout /tmp/claude-0/-home-user-SignalGrid-Review-Hub/21d833ed-695c-5bbe-a64f-c20755d0e7bd/scratchpad/wt-backlog is shallow, its origin/SignalGrid_Alpha is the live head; it answered 0 PR(s), the REST compare endpoint 75, 0 left unread.
- Review threads: REST heuristic: root review comments and which have a reply. GitHub shows resolution through GraphQL only, which this tool does not call, so any PR with a review thread counts as having an open one.
- Declared in-flight: #1559 #1585 #1586 #1600.
- A mac/* PR's ask is read from its PR body only; Mac lane mail is not read by this tool.
- A PR is IN-FLIGHT only if --declared-live names it; the tool cannot see a worker.

<!-- backlog-triage:snapshot:end -->

## Related

- `.claude/skills/backlog-landing/SKILL.md` - the procedure: order of work, landing one PR, reporting.
- `.claude/skills/landing-under-dr-037/SKILL.md` and DR-037 in `docs/DECISION_RECORDS.md` - the five conditions.
- `docs/LANE_COORDINATION.md` - who may land whose PR, and how the lanes mail each other.
- `docs/BUILD_BACKLOG.md` - the backlog row for the duplicate "Raised hands" issues.
