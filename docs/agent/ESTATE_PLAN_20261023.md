# Estate plan, 2026-10-23

> Nothing on this page is current positioning. It is an operating inventory of the repository's branches, pull requests and issues, measured on 2026-10-23 for the owner's cleanup directive; every PR title and branch name below is quoted as it stands in GitHub, not as a statement of what SignalGrid ships.

measuredAt: 2026-10-23T23:05:00Z · repository DanFashauer/SignalGrid-Review-Hub · mainline SignalGrid_Alpha · live re-reads (GET only): PRs and issues 2026-10-23T23:35:33Z, branches 2026-10-23T23:41:04Z

Owner directives (verbatim, 2026-10-23): "Clean up all branches and make sure only the main branch stays the only branch unless it's 100% to have this secondary branches. Plus all issues and pulls need to be resolved now. Let local see what it can handle first then see if you need to step in and resolve or provide the fixes for local to run these properly and everything to be automated." Earlier: the local second brain runs everything; the cloud and Codex are final inspection and approval.

This plan closes, merges and deletes nothing itself. It names what to do, who does it first (the Mac brain), and what the cloud does after 2026-10-24T01:24:00Z.

## 1. Summary

1. Branches: 227 besides mainline at 23:05Z (229 live with mainline at 23:41Z). Delete 10 verified zero-loss; 1 refuted (claude/land-mac-1248) goes to the owner.
2. Keep 81: lane/mailbox, 1 live Mac claim, and 79 open-PR heads (live). The other 136 hold unique work and are the owner's to abandon.
3. Of the 136: 4 in-flight cloud branches (open a PR), 46 mac/tick, 43 lane/cloud-mail, 7 merged-PR residue, 29 closed-unmerged, 7 parked with no PR.
4. PRs triaged: 79. OWNER 48, DEPENDABOT 9, MAC 7, NEEDS_WORK 6, CLOSE 6 (5 still open; #1638 merged 23:22Z), LAND_DR037 2, MAILBOX 1.
5. Live at 23:35Z: 80 open PRs, i.e. the 78 triaged still open plus #1639 and #1640 (new, untriaged). The verifier's "30 open" was a pagination bug.
6. Issues: 6 open. Keep 1 (#1597), Mac 2 (#1546, #338), cloud 1 (#1165, CVE gate red 18 days), owner 2 (#141, #136).
7. Owner decisions: 65. 19 are one-click merges ready now; DR-061 (#1246) alone would move most owner merges to the lanes.
8. Brain first: delete the 10, close Mac ticks #1336 #1509 #1510 #1511, refresh and fix the 7 MAC PRs and the Mac-headed OWNER PRs, find the #1165 CVE.
9. Cloud at 2026-10-24T01:24:00Z, only where a done-check fails: zero-loss deletes, then #1585 then #1586 under DR-037 after a SHIP refute, then close the 4 ticks.
10. Blockers: DR-037's text bars lanes from deleting branches (OD01; DR-064 rule 7, PR #1641, grants it for zero-loss and owner-abandoned branches); the Default ruleset (one rule, Copilot code review, on every branch) does NOT block deletion — it only makes every branch read protected=true, which the prune tool treats as a refusal (OD02 is a tool fix, not a settings change).

## 2. Branches

### 2a. Verified zero-loss deletion list (10)

Source: docs/agent/estate-20261023/verify-delete-list.json `confirmedZeroLoss`. Every tip re-read live at 2026-10-23T23:41:04Z: unchanged. None is the head of any of the 80 open PRs. Run them through `docs/agent/estate-20261023/delete-zero-loss-verified.sh` (re-checks, archive tag, read back, delete), never the old `delete-zero-loss.sh`, which still includes the refuted branch.

```bash
git push origin --delete claude/build-carrier-topology-finding   # tip d68b4916; ancestor of origin/SignalGrid_Alpha (0 unique commits)
git push origin --delete claude/build-gate-survivors-liveness-scratch-git   # tip 531e141f; not ancestor; 1 unique commit(s) of which 1 merge; cherry: 0 '+' / 0 '-'
git push origin --delete claude/land-mac-tier1-downgrade   # tip 72165d7d; ancestor of origin/SignalGrid_Alpha (0 unique commits)
git push origin --delete claude/loop-state-20260914-1700Z   # tip a7349016; not ancestor; 1 unique commit(s) of which 0 merge; cherry: 0 '+' / 1 '-'
git push origin --delete land/1052   # tip 4a987e82; ancestor of origin/SignalGrid_Alpha (0 unique commits)
git push origin --delete land/1061   # tip 3fcf7da5; ancestor of origin/SignalGrid_Alpha (0 unique commits)
git push origin --delete land/1067   # tip 5a45a791; ancestor of origin/SignalGrid_Alpha (0 unique commits)
git push origin --delete lane/cloud-puck1-attach-domain-20260912-1040Z   # tip 8edaa68e; ancestor of origin/SignalGrid_Alpha (0 unique commits)
git push origin --delete lane/cloud-puck4-smart-charging-20260912-1040Z   # tip 8edaa68e; ancestor of origin/SignalGrid_Alpha (0 unique commits)
git push origin --delete mac/pr-1216-fix-backup   # tip 5a270174; not ancestor; 4 unique commit(s) of which 1 merge; cherry: 0 '+' / 3 '-'
```

Refuted by the verifier (not on the list): `claude/land-mac-1248` (tip 7a76ed44). merge commit 7a76ed44d carries a conflict-resolution hunk (docs/agent/SURFACE_REVIEW_COVERAGE.md derived counts 2988/477) that neither parent nor any Alpha commit contains; git cherry skips merge commits so its empty output is vacuous. Owner decision OD03.

Note on `mac/pr-1216-fix-backup`: a lane message kept it "until the Mac says otherwise", deletable once #1216's head was pushed; #1216 merged 2026-10-01T16:54:30Z, so the hold's own condition is met.

### 2b. Keep list (81 live)

| branch | why |
| --- | --- |
| lane/mailbox | PR #439, the cloud lane's wake channel; never merge, never close; #1546 directive: preserve #439 |
| mac/build-row-17c-20261021T214648Z | live Mac build-row claim (last commit 2026-10-21T21:46:41Z); the Mac releases it |
| 79 open-PR heads | each stays while its PR is open; the list is in docs/agent/estate-20261023/estate-plan.json `branches.keep.openPrHeads`. Gone since 23:05Z: lane/cloud-mail-20261023-225852Z (#1638 merged, branch auto-deleted). New: claude/local-brain-primary-20261023 (#1639), lane/cloud-mail-20261023-232656Z (#1640) |

### 2c. Unmerged branches (136)

No open PR, not an ancestor of mainline, at least one patch not on mainline (docs/agent/estate-20261023/branches-unmerged.md). PR history is a live GET. The owner decides abandonment for every row except the in-flight four; abandonment means archive tag `archive/<branch>` first, then delete (`docs/agent/estate-20261023/archive-delete-owner-approved.sh`). Fold into an open PR: no row matched one.

| name | ahead | last commit (UTC) | author | subject | PRs | proposed call |
| --- | --- | --- | --- | --- | --- | --- |
| claude/build-local-brain-capabilities | 11 | 2026-10-23T04:41:09Z | Claude (cloud lane) | WIP local-brain round 3: the cloud builder's uncommitted edits at the 03:28Z stop (unverif | none | open a PR (cloud lane in-flight work of 2026-10-23); keep until then (its own subject: WIP, unverified, handed over; open as a DRAFT PR) |
| claude/build-backlog-landing-skill | 21 | 2026-10-23T03:27:29Z | Claude | surface coverage page: regenerated by its tool after the mainline merge | none | open a PR (cloud lane in-flight work of 2026-10-23); keep until then |
| claude/plan-remeasure-20261023 | 4 | 2026-10-23T03:26:43Z | Claude | plan: correct the wiring cites and two sentences in the 2026-10-23 re-measure stamps | none | open a PR (cloud lane in-flight work of 2026-10-23); keep until then |
| claude/build-tick-followup-1593 | 23 | 2026-10-23T01:57:14Z | Claude | mac-build-tick row: heartbeatSince at this round's last commit | none | open a PR (cloud lane in-flight work of 2026-10-23); keep until then |
| mac/tick-20261021T000143Z | 1 | 2026-10-21T00:01:48Z | DanFashauer | Mac tick 20261021T000143Z: sim results (0 request(s)); objective loop: escalate | #1574 closed | record as abandoned and delete (owner); generated tick output (mainline re-derived objective-state.json 2026-10-23T00:27Z; not checked branch by branch) |
| mac/tick-20261020T000023Z | 1 | 2026-10-20T00:00:28Z | DanFashauer | Mac tick 20261020T000023Z: sim results (0 request(s)); objective loop: escalate | #1573 closed | record as abandoned and delete (owner); generated tick output (mainline re-derived objective-state.json 2026-10-23T00:27Z; not checked branch by branch) |
| mac/tick-20261019T000449Z | 1 | 2026-10-19T00:04:54Z | DanFashauer | Mac tick 20261019T000449Z: sim results (0 request(s)); objective loop: escalate | #1572 closed | record as abandoned and delete (owner); generated tick output (mainline re-derived objective-state.json 2026-10-23T00:27Z; not checked branch by branch) |
| mac/tick-20261018T000019Z | 1 | 2026-10-18T00:00:23Z | DanFashauer | Mac tick 20261018T000019Z: sim results (0 request(s)); objective loop: escalate | #1571 closed | record as abandoned and delete (owner); generated tick output (mainline re-derived objective-state.json 2026-10-23T00:27Z; not checked branch by branch) |
| claude/build-raised-hands-e2e-tracked-copy | 4 | 2026-10-17T18:26:03Z | Claude | backlog: annotate the raised-hands e2e row FIX PROPOSED (B90) | #1570 closed | record as abandoned and delete (owner), or reopen its PR if the work is still wanted |
| mac/tick-20261015T000314Z | 1 | 2026-10-15T00:03:18Z | DanFashauer | Mac tick 20261015T000314Z: sim results (0 request(s)); objective loop: escalate | #1512 closed | record as abandoned and delete (owner); generated tick output (mainline re-derived objective-state.json 2026-10-23T00:27Z; not checked branch by branch) |
| mac/tick-20261011T000008Z | 1 | 2026-10-11T00:00:11Z | DanFashauer | Mac tick 20261011T000008Z: sim results (0 request(s)); objective loop: escalate | #1508 closed | record as abandoned and delete (owner); generated tick output (mainline re-derived objective-state.json 2026-10-23T00:27Z; not checked branch by branch) |
| mac/tick-20261010T000228Z | 1 | 2026-10-10T00:02:31Z | DanFashauer | Mac tick 20261010T000228Z: sim results (0 request(s)); objective loop: escalate | #1507 closed | record as abandoned and delete (owner); generated tick output (mainline re-derived objective-state.json 2026-10-23T00:27Z; not checked branch by branch) |
| mac/tick-20261009T000011Z | 1 | 2026-10-09T00:00:14Z | DanFashauer | Mac tick 20261009T000011Z: sim results (0 request(s)); objective loop: escalate | #1479 closed | record as abandoned and delete (owner); generated tick output (mainline re-derived objective-state.json 2026-10-23T00:27Z; not checked branch by branch) |
| mac/tick-20261008T221721Z | 1 | 2026-10-08T22:17:37Z | DanFashauer | Mac tick 20261008T221721Z: sim results (0 request(s)); objective loop: escalate | #1476 closed | record as abandoned and delete (owner); generated tick output (mainline re-derived objective-state.json 2026-10-23T00:27Z; not checked branch by branch) |
| claude/build-restamp-landed-rows-round-4 | 1 | 2026-10-02T16:27:15Z | Claude | LOOP: 2026-10-02 cloud lane - docs: restamp landed rows round 4 merged | #1372 merged (older tip) | record as abandoned and delete (owner); its PR merged, the residue is post-merge or edited commits (human diff first) |
| mac/tick-20260930T123706Z | 1 | 2026-09-30T12:37:10Z | DanFashauer | Mac tick 20260930T123706Z: sim results (0 request(s)); objective loop: escalate | #1299 closed | record as abandoned and delete (owner); generated tick output (mainline re-derived objective-state.json 2026-10-23T00:27Z; not checked branch by branch) |
| mac/tick-20260930T123135Z | 1 | 2026-09-30T12:31:47Z | DanFashauer | Mac tick 20260930T123135Z: sim results (0 request(s)); objective loop: escalate | #1298 closed | record as abandoned and delete (owner); generated tick output (mainline re-derived objective-state.json 2026-10-23T00:27Z; not checked branch by branch) |
| mac/tick-20260930T122606Z | 1 | 2026-09-30T12:26:20Z | DanFashauer | Mac tick 20260930T122606Z: sim results (0 request(s)); objective loop: escalate | #1297 closed | record as abandoned and delete (owner); generated tick output (mainline re-derived objective-state.json 2026-10-23T00:27Z; not checked branch by branch) |
| mac/tick-20260930T122050Z | 1 | 2026-09-30T12:20:54Z | DanFashauer | Mac tick 20260930T122050Z: sim results (0 request(s)); objective loop: escalate | #1294 closed | record as abandoned and delete (owner); generated tick output (mainline re-derived objective-state.json 2026-10-23T00:27Z; not checked branch by branch) |
| mac/tick-20260930T121507Z | 1 | 2026-09-30T12:15:22Z | DanFashauer | Mac tick 20260930T121507Z: sim results (0 request(s)); objective loop: escalate | #1293 closed | record as abandoned and delete (owner); generated tick output (mainline re-derived objective-state.json 2026-10-23T00:27Z; not checked branch by branch) |
| mac/tick-20260930T120951Z | 1 | 2026-09-30T12:09:55Z | DanFashauer | Mac tick 20260930T120951Z: sim results (0 request(s)); objective loop: escalate | #1292 closed | record as abandoned and delete (owner); generated tick output (mainline re-derived objective-state.json 2026-10-23T00:27Z; not checked branch by branch) |
| mac/tick-20260930T120414Z | 1 | 2026-09-30T12:04:28Z | DanFashauer | Mac tick 20260930T120414Z: sim results (0 request(s)); objective loop: escalate | #1291 closed | record as abandoned and delete (owner); generated tick output (mainline re-derived objective-state.json 2026-10-23T00:27Z; not checked branch by branch) |
| mac/tick-20260930T115900Z | 1 | 2026-09-30T11:59:04Z | DanFashauer | Mac tick 20260930T115900Z: sim results (0 request(s)); objective loop: escalate | #1290 closed | record as abandoned and delete (owner); generated tick output (mainline re-derived objective-state.json 2026-10-23T00:27Z; not checked branch by branch) |
| mac/tick-20260930T115321Z | 1 | 2026-09-30T11:53:36Z | DanFashauer | Mac tick 20260930T115321Z: sim results (0 request(s)); objective loop: escalate | #1289 closed | record as abandoned and delete (owner); generated tick output (mainline re-derived objective-state.json 2026-10-23T00:27Z; not checked branch by branch) |
| mac/tick-20260930T114806Z | 1 | 2026-09-30T11:48:11Z | DanFashauer | Mac tick 20260930T114806Z: sim results (0 request(s)); objective loop: escalate | #1288 closed | record as abandoned and delete (owner); generated tick output (mainline re-derived objective-state.json 2026-10-23T00:27Z; not checked branch by branch) |
| mac/tick-20260930T114227Z | 1 | 2026-09-30T11:42:40Z | DanFashauer | Mac tick 20260930T114227Z: sim results (0 request(s)); objective loop: escalate | #1287 closed | record as abandoned and delete (owner); generated tick output (mainline re-derived objective-state.json 2026-10-23T00:27Z; not checked branch by branch) |
| mac/tick-20260930T113712Z | 1 | 2026-09-30T11:37:16Z | DanFashauer | Mac tick 20260930T113712Z: sim results (0 request(s)); objective loop: escalate | #1286 closed | record as abandoned and delete (owner); generated tick output (mainline re-derived objective-state.json 2026-10-23T00:27Z; not checked branch by branch) |
| mac/tick-20260930T113140Z | 1 | 2026-09-30T11:31:52Z | DanFashauer | Mac tick 20260930T113140Z: sim results (0 request(s)); objective loop: escalate | #1284 closed | record as abandoned and delete (owner); generated tick output (mainline re-derived objective-state.json 2026-10-23T00:27Z; not checked branch by branch) |
| mac/tick-20260930T112626Z | 1 | 2026-09-30T11:26:29Z | DanFashauer | Mac tick 20260930T112626Z: sim results (0 request(s)); objective loop: escalate | #1283 closed | record as abandoned and delete (owner); generated tick output (mainline re-derived objective-state.json 2026-10-23T00:27Z; not checked branch by branch) |
| mac/tick-20260930T112058Z | 1 | 2026-09-30T11:21:07Z | DanFashauer | Mac tick 20260930T112058Z: sim results (0 request(s)); objective loop: escalate | #1282 closed | record as abandoned and delete (owner); generated tick output (mainline re-derived objective-state.json 2026-10-23T00:27Z; not checked branch by branch) |
| mac/tick-20260930T111523Z | 1 | 2026-09-30T11:15:36Z | DanFashauer | Mac tick 20260930T111523Z: sim results (0 request(s)); objective loop: escalate | #1281 closed | record as abandoned and delete (owner); generated tick output (mainline re-derived objective-state.json 2026-10-23T00:27Z; not checked branch by branch) |
| mac/tick-20260930T111009Z | 1 | 2026-09-30T11:10:13Z | DanFashauer | Mac tick 20260930T111009Z: sim results (0 request(s)); objective loop: escalate | #1279 closed | record as abandoned and delete (owner); generated tick output (mainline re-derived objective-state.json 2026-10-23T00:27Z; not checked branch by branch) |
| mac/tick-20260930T110435Z | 1 | 2026-09-30T11:04:48Z | DanFashauer | Mac tick 20260930T110435Z: sim results (0 request(s)); objective loop: escalate | #1278 closed | record as abandoned and delete (owner); generated tick output (mainline re-derived objective-state.json 2026-10-23T00:27Z; not checked branch by branch) |
| mac/tick-20260930T105921Z | 1 | 2026-09-30T10:59:25Z | DanFashauer | Mac tick 20260930T105921Z: sim results (0 request(s)); objective loop: escalate | #1276 closed | record as abandoned and delete (owner); generated tick output (mainline re-derived objective-state.json 2026-10-23T00:27Z; not checked branch by branch) |
| mac/tick-20260930T105344Z | 1 | 2026-09-30T10:53:57Z | DanFashauer | Mac tick 20260930T105344Z: sim results (0 request(s)); objective loop: escalate | #1275 closed | record as abandoned and delete (owner); generated tick output (mainline re-derived objective-state.json 2026-10-23T00:27Z; not checked branch by branch) |
| mac/tick-20260930T104829Z | 1 | 2026-09-30T10:48:33Z | DanFashauer | Mac tick 20260930T104829Z: sim results (0 request(s)); objective loop: escalate | #1273 closed | record as abandoned and delete (owner); generated tick output (mainline re-derived objective-state.json 2026-10-23T00:27Z; not checked branch by branch) |
| mac/tick-20260930T104251Z | 1 | 2026-09-30T10:43:04Z | DanFashauer | Mac tick 20260930T104251Z: sim results (0 request(s)); objective loop: escalate | #1271 closed | record as abandoned and delete (owner); generated tick output (mainline re-derived objective-state.json 2026-10-23T00:27Z; not checked branch by branch) |
| mac/tick-20260930T103737Z | 1 | 2026-09-30T10:37:41Z | DanFashauer | Mac tick 20260930T103737Z: sim results (0 request(s)); objective loop: escalate | #1270 closed | record as abandoned and delete (owner); generated tick output (mainline re-derived objective-state.json 2026-10-23T00:27Z; not checked branch by branch) |
| mac/tick-20260930T103206Z | 1 | 2026-09-30T10:32:16Z | DanFashauer | Mac tick 20260930T103206Z: sim results (0 request(s)); objective loop: escalate | #1269 closed | record as abandoned and delete (owner); generated tick output (mainline re-derived objective-state.json 2026-10-23T00:27Z; not checked branch by branch) |
| mac/tick-20260930T082854Z | 1 | 2026-09-30T08:28:58Z | DanFashauer | Mac tick 20260930T082854Z: sim results (0 request(s)); objective loop: escalate | #1262 closed | record as abandoned and delete (owner); generated tick output (mainline re-derived objective-state.json 2026-10-23T00:27Z; not checked branch by branch) |
| mac/tick-20260930T073541Z | 1 | 2026-09-30T07:35:45Z | DanFashauer | Mac tick 20260930T073541Z: sim results (0 request(s)); objective loop: escalate | #1257 closed | record as abandoned and delete (owner); generated tick output (mainline re-derived objective-state.json 2026-10-23T00:27Z; not checked branch by branch) |
| lane/cloud-mail-20260929-214503Z | 1 | 2026-09-29T21:45:08Z | Claude | Lane mail (cloud): heartbeat mac-lane-steward-duty-cycle | #1211 closed | record as abandoned and delete (owner); stale lane mail of September (later heartbeats exist; undelivered acks or sends not checked one by one) |
| lane/cloud-mail-20260929-103423Z | 1 | 2026-09-29T10:34:28Z | Claude | Lane mail (cloud): heartbeat mac-lane-steward-duty-cycle | #1205 closed | record as abandoned and delete (owner); stale lane mail of September (later heartbeats exist; undelivered acks or sends not checked one by one) |
| lane/cloud-mail-20260928-161928Z | 1 | 2026-09-28T16:19:32Z | Claude | Lane mail (cloud): ack mac-merge-steps-done-1118-and-1037-are-conflict-, raise 2026-09-28- | #1194 closed | record as abandoned and delete (owner); stale lane mail of September (later heartbeats exist; undelivered acks or sends not checked one by one) |
| lane/cloud-mail-20260928-161219Z | 1 | 2026-09-28T16:12:28Z | Claude | Lane mail (cloud): ack mac-merge-steps-done-1118-and-1037-are-conflict-, raise 2026-09-28- | #1193 closed | record as abandoned and delete (owner); stale lane mail of September (later heartbeats exist; undelivered acks or sends not checked one by one) |
| lane/cloud-mail-20260928-154829Z | 1 | 2026-09-28T15:48:34Z | Claude | Lane mail (cloud): ack mac-merge-steps-done-1118-and-1037-are-conflict-, raise 2026-09-28- | #1192 closed | record as abandoned and delete (owner); stale lane mail of September (later heartbeats exist; undelivered acks or sends not checked one by one) |
| lane/cloud-mail-20260928-153025Z | 1 | 2026-09-28T15:30:31Z | Claude | Lane mail (cloud): ack mac-merge-steps-done-1118-and-1037-are-conflict-, raise 2026-09-28- | #1189 closed | record as abandoned and delete (owner); stale lane mail of September (later heartbeats exist; undelivered acks or sends not checked one by one) |
| lane/cloud-mail-20260928-145139Z | 1 | 2026-09-28T14:51:45Z | Claude | Lane mail (cloud): ack mac-merge-steps-done-1118-and-1037-are-conflict-, raise 2026-09-28- | #1187 closed | record as abandoned and delete (owner); stale lane mail of September (later heartbeats exist; undelivered acks or sends not checked one by one) |
| lane/cloud-mail-20260928-144319Z | 1 | 2026-09-28T14:43:30Z | Claude | Lane mail (cloud): ack mac-merge-steps-done-1118-and-1037-are-conflict-, clear 2026-09-28- | #1186 closed | record as abandoned and delete (owner); stale lane mail of September (later heartbeats exist; undelivered acks or sends not checked one by one) |
| lane/cloud-mail-20260928-074936Z | 1 | 2026-09-28T07:49:40Z | Claude | Lane mail (cloud): raise 2026-09-28-the-cloud-s-message-cloud-fyi-nothing-asked-your | #1180 closed | record as abandoned and delete (owner); stale lane mail of September (later heartbeats exist; undelivered acks or sends not checked one by one) |
| lane/cloud-mail-20260928-074218Z | 1 | 2026-09-28T07:42:22Z | Claude | Lane mail (cloud): raise 2026-09-28-the-cloud-s-fyi-message-cloud-fyi-nothing-asked- | #1179 closed | record as abandoned and delete (owner); stale lane mail of September (later heartbeats exist; undelivered acks or sends not checked one by one) |
| lane/cloud-mail-20260927-152546Z | 1 | 2026-09-27T15:25:50Z | Claude | Lane mail (cloud): heartbeat mac-lane-steward-duty-cycle, heartbeat forward-build-cycle | none | record as abandoned and delete (owner); stale lane mail of September (later heartbeats exist; undelivered acks or sends not checked one by one) |
| lane/cloud-mail-20260927-152527Z | 1 | 2026-09-27T15:25:32Z | Claude | Lane mail (cloud): heartbeat mac-lane-steward-duty-cycle, heartbeat forward-build-cycle | none | record as abandoned and delete (owner); stale lane mail of September (later heartbeats exist; undelivered acks or sends not checked one by one) |
| lane/cloud-mail-20260927-112452Z | 1 | 2026-09-27T11:24:56Z | Claude | Lane mail (cloud): heartbeat mac-lane-steward-duty-cycle | #1163 closed | record as abandoned and delete (owner); stale lane mail of September (later heartbeats exist; undelivered acks or sends not checked one by one) |
| mac/tick-20260926T205824Z | 1 | 2026-09-26T20:58:33Z | DanFashauer | Mac tick 20260926T205824Z: sim results (0 request(s)); objective loop: escalate | #1140 closed | record as abandoned and delete (owner); generated tick output (mainline re-derived objective-state.json 2026-10-23T00:27Z; not checked branch by branch) |
| lane/cloud-mail-20260926-202834Z | 1 | 2026-09-26T20:28:39Z | Claude | Lane mail (cloud): ack mac-pr-1136-ios-joins-the-shared-assist-wire-con, send cloud-assist | #1137 closed | record as abandoned and delete (owner); stale lane mail of September (later heartbeats exist; undelivered acks or sends not checked one by one) |
| lane/cloud-mail-20260926-144512Z | 1 | 2026-09-26T14:45:16Z | Claude | Lane mail (cloud): heartbeat mac-lane-steward-duty-cycle | #1131 closed | record as abandoned and delete (owner); stale lane mail of September (later heartbeats exist; undelivered acks or sends not checked one by one) |
| mac/tick-20260926T061928Z | 1 | 2026-09-26T06:19:40Z | DanFashauer | Mac tick 20260926T061928Z: sim results (0 request(s)); objective loop: escalate | #1115 closed | record as abandoned and delete (owner); generated tick output (mainline re-derived objective-state.json 2026-10-23T00:27Z; not checked branch by branch) |
| mac/tick-20260926T053327Z | 1 | 2026-09-26T05:33:31Z | DanFashauer | Mac tick 20260926T053327Z: sim results (0 request(s)); objective loop: escalate | #1112 closed | record as abandoned and delete (owner); generated tick output (mainline re-derived objective-state.json 2026-10-23T00:27Z; not checked branch by branch) |
| mac/tick-20260926T051221Z | 1 | 2026-09-26T05:12:29Z | DanFashauer | Mac tick 20260926T051221Z: sim results (0 request(s)); objective loop: escalate | #1108 closed | record as abandoned and delete (owner); generated tick output (mainline re-derived objective-state.json 2026-10-23T00:27Z; not checked branch by branch) |
| mac/tick-20260926T045137Z | 1 | 2026-09-26T04:51:40Z | DanFashauer | Mac tick 20260926T045137Z: sim results (0 request(s)); objective loop: escalate | #1107 closed | record as abandoned and delete (owner); generated tick output (mainline re-derived objective-state.json 2026-10-23T00:27Z; not checked branch by branch) |
| mac/tick-20260926T044600Z | 1 | 2026-09-26T04:46:13Z | DanFashauer | Mac tick 20260926T044600Z: sim results (0 request(s)); objective loop: escalate | #1105 closed | record as abandoned and delete (owner); generated tick output (mainline re-derived objective-state.json 2026-10-23T00:27Z; not checked branch by branch) |
| mac/tick-20260926T042441Z | 1 | 2026-09-26T04:24:51Z | DanFashauer | Mac tick 20260926T042441Z: sim results (0 request(s)); objective loop: escalate | #1101 closed | record as abandoned and delete (owner); generated tick output (mainline re-derived objective-state.json 2026-10-23T00:27Z; not checked branch by branch) |
| mac/tick-20260925T203034Z | 1 | 2026-09-25T20:50:37Z | DanFashauer | Mac tick 20260925T203034Z: sim results (1 request(s)); objective loop: escalate | #1064 closed | Mac confirms its 1 sim-result record(s) are not needed, then record as abandoned and delete (owner) |
| mac/tick-20260925T200508Z | 1 | 2026-09-25T20:25:24Z | DanFashauer | Mac tick 20260925T200508Z: sim results (1 request(s)); objective loop: escalate | #1063 closed | Mac confirms its 1 sim-result record(s) are not needed, then record as abandoned and delete (owner) |
| mac/tick-20260925T191227Z | 1 | 2026-09-25T19:34:36Z | DanFashauer | Mac tick 20260925T191227Z: sim results (1 request(s)); objective loop: escalate | #1060 closed | Mac confirms its 1 sim-result record(s) are not needed, then record as abandoned and delete (owner) |
| claude/raised-hand-monitor | 1 | 2026-09-23T21:49:10Z | DanFashauer | Project-manager absorption: the brain self-directs, the owner isn't the task queue | #1014 closed | record as abandoned and delete (owner), or reopen its PR if the work is still wanted |
| claude/custody-journey-v2 | 10 | 2026-09-23T16:07:39Z | Claude | Merge origin/SignalGrid_Alpha into claude/custody-journey-v2 (picks up #999 grid phone-pat | #821 closed | record as abandoned and delete (owner), or reopen its PR if the work is still wanted (custody is a deferred capability in docs/LAUNCH_PROFILE.md; a branch or PR name here is a GitHub identifier, not a claim) |
| mac/decision-path-classifier-gap | 7 | 2026-09-22T00:15:11Z | Claude | chore: regenerate coverage + manifest after Alpha merge | #758 merged (older tip), #719 merged (older tip) | record as abandoned and delete (owner); its PR merged, the residue is post-merge or edited commits (human diff first) |
| claude/merge-authorizer-v2 | 6 | 2026-09-21T21:57:25Z | Claude | docs: preflight.mjs is 784 lines after the Alpha merge (figure guard) | #820 closed | record as abandoned and delete (owner), or reopen its PR if the work is still wanted |
| lane/cloud-mail-20260921-145924Z | 1 | 2026-09-21T14:59:27Z | Claude | Lane mail (cloud): send cloud-re-mint-evidence-remint-after-customer-pat | #956 closed | record as abandoned and delete (owner); stale lane mail of September (later heartbeats exist; undelivered acks or sends not checked one by one) |
| mac/tick-20260921T140443Z | 1 | 2026-09-21T14:37:50Z | DanFashauer | Mac tick 20260921T140443Z: sim results (2 request(s)) | #955 closed | Mac confirms its 2 sim-result record(s) are not needed, then record as abandoned and delete (owner) |
| lane/cloud-mail-20260921-012526Z | 1 | 2026-09-21T01:25:29Z | Claude | Lane mail (cloud): heartbeat mac-lane-steward-duty-cycle | #938 closed | record as abandoned and delete (owner); stale lane mail of September (later heartbeats exist; undelivered acks or sends not checked one by one) |
| claude/fix-tsbuildinfo-colocation | 1 | 2026-09-20T21:54:38Z | Claude | build: co-locate tsc buildinfo inside each lib's dist/ (fail-silent typecheck hardening) | #932 closed | record as abandoned and delete (owner), or reopen its PR if the work is still wanted |
| lane/cloud-mail-20260920-195841Z | 1 | 2026-09-20T19:58:45Z | Claude | Lane mail (cloud): ack mac-retraction-facilitygraph-tsx-is-not-a-bug-ci, heartbeat mac-lan | #930 closed | record as abandoned and delete (owner); stale lane mail of September (later heartbeats exist; undelivered acks or sends not checked one by one) |
| lane/cloud-mail-20260920-092707Z | 1 | 2026-09-20T09:27:10Z | Claude | Lane mail (cloud): heartbeat mac-lane-steward-duty-cycle | #913 closed | record as abandoned and delete (owner); stale lane mail of September (later heartbeats exist; undelivered acks or sends not checked one by one) |
| mac/video-intake-icm-and-five-projects | 1 | 2026-09-20T02:57:39Z | DanFashauer | Two owner clips under the intake rule: ICM staged handoffs and five LLM-ops projects — one | #903 closed | record as abandoned and delete (owner), or reopen its PR if the work is still wanted |
| mac/context7-self-scan | 1 | 2026-09-20T02:16:42Z | DanFashauer | Two resources under the new intake rule (self-scan, roster confirms, brain decides): Conte | #901 closed | record as abandoned and delete (owner), or reopen its PR if the work is still wanted |
| lane/cloud-mail-20260919-094113Z | 1 | 2026-09-19T09:41:16Z | Claude | Lane mail (cloud): heartbeat cloud-lane-hygiene-sweep | #880 closed | record as abandoned and delete (owner); stale lane mail of September (later heartbeats exist; undelivered acks or sends not checked one by one) |
| mac/intake-apple-and-mcp-list | 2 | 2026-09-19T00:47:41Z | DanFashauer | Mac web build with nobody at the keyboard: user-level Apple container + a self-starting bu | #856 closed | record as abandoned and delete (owner), or reopen its PR if the work is still wanted |
| claude/build-live-connector-path | 4 | 2026-09-18T08:45:10Z | Claude | docs(build-plan): undo an over-broad substitution — nine prose mentions of a path had gain | #725 closed | record as abandoned and delete (owner), or reopen its PR if the work is still wanted |
| claude/loop-state-20260918-0840Z | 1 | 2026-09-18T08:37:59Z | Claude | docs(loop): STATE for 2026-09-18 08:40Z — the Mac red that was a workspace cycle, the gate | #835 closed | record as abandoned and delete (owner), or reopen its PR if the work is still wanted |
| lane/cloud-gate-falsification | 4 | 2026-09-18T08:34:28Z | Claude | Merge origin/SignalGrid_Alpha into lane/cloud-gate-falsification | #723 closed | record as abandoned and delete (owner), or reopen its PR if the work is still wanted |
| claude/intake-spec-kit | 2 | 2026-09-18T04:35:11Z | Claude | fix(check-shell): a deferral pinned to one shellcheck's output is not a fact about the fil | #826 closed | record as abandoned and delete (owner), or reopen its PR if the work is still wanted |
| claude/loop-state-20260918 | 1 | 2026-09-18T02:05:47Z | Claude | docs(loop): record the replay session — seven PRs, seven defects the originals could not s | #823 closed | record as abandoned and delete (owner), or reopen its PR if the work is still wanted |
| lane/cloud-mail-20260917-232525Z | 1 | 2026-09-17T23:25:27Z | Claude | Lane mail (cloud): send cloud-detect-ts-is-being-pinned-your-3-7d-old-me, heartbeat mac-la | #816 closed | record as abandoned and delete (owner); stale lane mail of September (later heartbeats exist; undelivered acks or sends not checked one by one) |
| mac/intake-airllm | 2 | 2026-09-17T18:46:22Z | Dan Fashauer | Merge branch 'SignalGrid_Alpha' into mac/intake-airllm | #801 closed | record as abandoned and delete (owner), or reopen its PR if the work is still wanted |
| claude/build-affected-audience-v2 | 5 | 2026-09-17T18:42:04Z | Claude | Re-derive the figures against a base carrying two new proofs | #803 merged (older tip) | record as abandoned and delete (owner); its PR merged, the residue is post-merge or edited commits (human diff first) |
| claude/intake-airllm | 3 | 2026-09-17T18:27:20Z | Claude | The latency question is answered: 0.1 tok/s, measured on the Mac | #800 closed | record as abandoned and delete (owner), or reopen its PR if the work is still wanted (verifier: 196 of 200 added lines already on mainline (near-landed squash with edits); human diff before deleting) |
| claude/build-affected-audience | 4 | 2026-09-17T15:41:07Z | Claude | Tick cascade join 3 in the backlog with what actually landed | #796 closed | record as abandoned and delete (owner), or reopen its PR if the work is still wanted (superseded by claude/build-affected-audience-v2 (PR #803 merged)) |
| claude/build-itsm-dispatch-seam | 3 | 2026-09-15T15:39:02Z | Claude | Regenerate the surface-coverage page for the two new files | #782 closed | record as abandoned and delete (owner), or reopen its PR if the work is still wanted |
| lane/cloud-mail-20260915-102456Z | 1 | 2026-09-15T10:24:59Z | Claude | Lane mail (cloud): heartbeat mac-lane-steward-duty-cycle | #777 closed | record as abandoned and delete (owner); stale lane mail of September (later heartbeats exist; undelivered acks or sends not checked one by one) |
| claude/signalgrid-launch-plan-emxm01 | 35 | 2026-09-15T00:38:32Z | Claude | Stop this branch reverting live heartbeats | #531 closed, #528 merged (older tip), #505 merged (older tip), #492 merged (older tip), +96 more (98 merged in total) | record as abandoned and delete (owner); its PR merged, the residue is post-merge or edited commits (human diff first) (long-lived branch: about 100 PRs from it merged; the last (#531) closed unmerged at this tip) |
| lane/cloud-mail-20260915-002529Z | 1 | 2026-09-15T00:25:31Z | Claude | Lane mail (cloud): heartbeat mac-lane-steward-duty-cycle | #764 closed | record as abandoned and delete (owner); stale lane mail of September (later heartbeats exist; undelivered acks or sends not checked one by one) |
| mac/custody-removal-suspends | 2 | 2026-09-14T22:34:35Z | DanFashauer | Clear cloud's review of #748: the blocker, two stale figures, and the Swift drift declared | #748 merged | record as abandoned and delete (owner); its PR merged, the residue is post-merge or edited commits (human diff first) (custody is a deferred capability in docs/LAUNCH_PROFILE.md; a branch or PR name here is a GitHub identifier, not a claim) |
| claude/build-custody-v1-wiring | 2 | 2026-09-14T17:10:47Z | Claude | Merge remote-tracking branch 'origin/SignalGrid_Alpha' into claude/build-custody-v1-wiring | #751 merged | record as abandoned and delete (owner); its PR merged, the residue is post-merge or edited commits (human diff first) (custody is a deferred capability in docs/LAUNCH_PROFILE.md; a branch or PR name here is a GitHub identifier, not a claim) |
| claude/build-liveness-empty-payload | 1 | 2026-09-14T15:23:48Z | Claude | fix(ci-liveness): "could not look" is not "the sweep is dark" | #745 closed | record as abandoned and delete (owner), or reopen its PR if the work is still wanted |
| lane/cloud-pin-detect-ts | 2 | 2026-09-14T12:54:56Z | Claude | Pin the two custody silences the event fabric cannot express | #732 closed | record as abandoned and delete (owner), or reopen its PR if the work is still wanted (custody is a deferred capability in docs/LAUNCH_PROFILE.md; a branch or PR name here is a GitHub identifier, not a claim) |
| lane/cloud-merge-authorizer | 2 | 2026-09-14T06:46:53Z | Claude | Test the exit code, not just the decision — the #723 defect applied to this gate | #729 closed | record as abandoned and delete (owner), or reopen its PR if the work is still wanted |
| lane/cloud-custody-journey | 2 | 2026-09-14T06:25:55Z | Claude | Model the smart-charging custody journey as ordered simulator scenarios (DR-054 PROPOSAL) | #730 closed | record as abandoned and delete (owner), or reopen its PR if the work is still wanted (custody is a deferred capability in docs/LAUNCH_PROFILE.md; a branch or PR name here is a GitHub identifier, not a claim) |
| lane/cloud-loop-state-20260914 | 2 | 2026-09-14T06:14:57Z | Claude | docs(loop): bring the STATE record up to 2026-09-14 | #733 closed | record as abandoned and delete (owner), or reopen its PR if the work is still wanted |
| claude/build-checkout-cap | 2 | 2026-09-14T00:55:39Z | Claude | docs(backlog): record PR #724 on the checkout-cap detection follow-up row | #724 closed | record as abandoned and delete (owner), or reopen its PR if the work is still wanted |
| lane/cloud-mail-20260913-234326Z | 1 | 2026-09-13T23:43:29Z | Claude | Lane mail (cloud): ack mac-auto-merge-activation-no-go-today-decision-c, heartbeat mac-lan | #721 closed | record as abandoned and delete (owner); stale lane mail of September (later heartbeats exist; undelivered acks or sends not checked one by one) |
| lane/cloud-brain-cycle-activate-20260913-0210Z | 7 | 2026-09-13T09:14:07Z | Claude | Merge remote-tracking branch 'origin/SignalGrid_Alpha' into HEAD | #705 closed | record as abandoned and delete (owner), or reopen its PR if the work is still wanted |
| lane/cloud-mail-20260912-192755Z | 1 | 2026-09-12T19:27:57Z | Claude | Lane mail (cloud): heartbeat mac-lane-steward-duty-cycle | #694 closed | record as abandoned and delete (owner); stale lane mail of September (later heartbeats exist; undelivered acks or sends not checked one by one) |
| lane/cloud-nist-alignment-20260911-132625Z | 18 | 2026-09-11T23:41:06Z | Claude | docs(agent): regenerate the surface-review coverage page after merging SignalGrid_Alpha | #638 closed | record as abandoned and delete (owner), or reopen its PR if the work is still wanted |
| lane/cloud-sweep-liveness-20260911-182300Z | 2 | 2026-09-11T23:41:00Z | Claude | Merge origin/SignalGrid_Alpha into lane/cloud-sweep-liveness-20260911-182300Z | #645 closed | record as abandoned and delete (owner), or reopen its PR if the work is still wanted |
| lane/cloud-runbook-partials-20260911-154128Z | 18 | 2026-09-11T23:40:22Z | Claude | Merge origin/SignalGrid_Alpha into lane/cloud-runbook-partials-20260911-154128Z | #641 closed | record as abandoned and delete (owner), or reopen its PR if the work is still wanted (verifier: 162 of 1431 added lines absent on mainline; real unique work) |
| lane/cloud-mail-20260911-132957Z | 1 | 2026-09-11T13:29:59Z | Claude | Lane mail (cloud): heartbeat mac-lane-steward-duty-cycle | #639 closed | record as abandoned and delete (owner); stale lane mail of September (later heartbeats exist; undelivered acks or sends not checked one by one) |
| lane/cloud-mail-20260911-094549Z | 1 | 2026-09-11T09:45:51Z | Claude | Lane mail (cloud): heartbeat cloud-lane-hygiene-sweep | #633 closed | record as abandoned and delete (owner); stale lane mail of September (later heartbeats exist; undelivered acks or sends not checked one by one) |
| lane/cloud-mail-20260911-094131Z | 1 | 2026-09-11T09:41:33Z | Claude | Lane mail (cloud): heartbeat cloud-lane-hygiene-sweep | #632 closed | record as abandoned and delete (owner); stale lane mail of September (later heartbeats exist; undelivered acks or sends not checked one by one) |
| lane/cloud-mail-20260911-072920Z | 1 | 2026-09-11T07:29:22Z | Claude | Lane mail (cloud): heartbeat mac-lane-steward-duty-cycle | #628 closed | record as abandoned and delete (owner); stale lane mail of September (later heartbeats exist; undelivered acks or sends not checked one by one) |
| lane/cloud-mail-20260911-062504Z | 1 | 2026-09-11T06:25:07Z | Claude | Lane mail (cloud): heartbeat mac-lane-steward-duty-cycle | #626 closed | record as abandoned and delete (owner); stale lane mail of September (later heartbeats exist; undelivered acks or sends not checked one by one) |
| lane/cloud-mail-20260911-020236Z | 1 | 2026-09-11T02:02:39Z | Claude | Lane mail (cloud): heartbeat mac-lane-steward-duty-cycle, send cloud-shared-surface-additi | #619 closed | record as abandoned and delete (owner); stale lane mail of September (later heartbeats exist; undelivered acks or sends not checked one by one) |
| lane/cloud-mail-20260910-224442Z | 1 | 2026-09-10T22:44:45Z | Claude | Lane mail (cloud): heartbeat mac-lane-steward-duty-cycle | #615 closed | record as abandoned and delete (owner); stale lane mail of September (later heartbeats exist; undelivered acks or sends not checked one by one) |
| lane/cloud-mail-20260910-223915Z | 1 | 2026-09-10T22:39:18Z | Claude | Lane mail (cloud): heartbeat mac-lane-steward-duty-cycle | #614 closed | record as abandoned and delete (owner); stale lane mail of September (later heartbeats exist; undelivered acks or sends not checked one by one) |
| lane/cloud-mail-20260910-205158Z | 1 | 2026-09-10T20:52:00Z | Claude | Lane mail (cloud): send cloud-mac-tick-skipping-checkout-dirty, heartbeat mac-lane-steward | #612 closed | record as abandoned and delete (owner); stale lane mail of September (later heartbeats exist; undelivered acks or sends not checked one by one) |
| lane/cloud-mail-20260910-204419Z | 1 | 2026-09-10T20:44:23Z | Claude | Lane mail (cloud): heartbeat mac-lane-steward-duty-cycle | #611 closed | record as abandoned and delete (owner); stale lane mail of September (later heartbeats exist; undelivered acks or sends not checked one by one) |
| lane/cloud-mail-20260910-202632Z | 1 | 2026-09-10T20:26:35Z | Claude | Lane mail (cloud): heartbeat mac-lane-steward-duty-cycle | #610 closed | record as abandoned and delete (owner); stale lane mail of September (later heartbeats exist; undelivered acks or sends not checked one by one) |
| lane/cloud-mail-20260910-172551Z | 1 | 2026-09-10T17:25:53Z | Claude | Lane mail (cloud): heartbeat mac-lane-steward-duty-cycle | #606 closed | record as abandoned and delete (owner); stale lane mail of September (later heartbeats exist; undelivered acks or sends not checked one by one) |
| lane/cloud-mail-20260910-150458Z | 1 | 2026-09-10T15:05:00Z | Claude | Lane mail (cloud): send cloud-landed-on-mainline-8589d49-dr-033-phase-pi | #602 closed | record as abandoned and delete (owner); stale lane mail of September (later heartbeats exist; undelivered acks or sends not checked one by one) |
| lane/cloud-mail-20260910-022853Z | 1 | 2026-09-10T02:28:55Z | Claude | Lane mail (cloud): send cloud-phase-corrected-past-customer-discovery-cu | #585 closed | record as abandoned and delete (owner); stale lane mail of September (later heartbeats exist; undelivered acks or sends not checked one by one) |
| mac/fleet-premium-proof | 1 | 2026-09-09T15:05:17Z | DanFashauer | WIP checkpoint: parked Fleet Premium proof work, backed up (not reviewed, not for merge) | none | owner: archive-tag and delete, or keep parked until Fleet Premium work resumes (no PR; its own subject says parked WIP, not reviewed, not for merge) |
| lane/cloud-mail-20260909-063238Z | 1 | 2026-09-09T06:32:40Z | Claude | Lane mail (cloud): send cloud-undefined, heartbeat mac-lane-steward-duty-cycle | none | record as abandoned and delete (owner); stale lane mail of September (later heartbeats exist; undelivered acks or sends not checked one by one) |
| lane/cloud-mail-20260906-064100Z | 1 | 2026-09-06T06:41:02Z | Claude | Lane mail (cloud): send cloud-correction-acks-go-through-lane-deliver-ba, heartbeat mac-la | #479 closed | record as abandoned and delete (owner); stale lane mail of September (later heartbeats exist; undelivered acks or sends not checked one by one) |
| lane/cloud-mail-20260906-062319Z | 1 | 2026-09-06T06:23:21Z | Claude | Lane mail (cloud): send cloud-correction-acks-go-through-lane-deliver-ba, heartbeat mac-la | #478 closed | record as abandoned and delete (owner); stale lane mail of September (later heartbeats exist; undelivered acks or sends not checked one by one) |
| lane/cloud-mail-20260905-202512Z | 1 | 2026-09-05T20:25:14Z | Claude | Lane mail (cloud): heartbeat mac-lane-steward-duty-cycle | #450 closed | record as abandoned and delete (owner); stale lane mail of September (later heartbeats exist; undelivered acks or sends not checked one by one) |
| mac/native-ledger-2026-09-02 | 6 | 2026-09-02T16:31:33Z | DanFashauer | Lane acks: four cloud messages closed, mainline merged into the native-ledger branch | #385 merged (older tip) | record as abandoned and delete (owner); its PR merged, the residue is post-merge or edited commits (human diff first) |
| claude/steward-heartbeat-2026-08-28-1624 | 25 | 2026-09-01T04:25:44Z | Claude | steward heartbeat — 04:24 cycle: Mac closed the iOS request (incl. row-58 nil-expiry fix); | none | record as abandoned and delete (owner) (no PR; 25 steward heartbeat commits from 2026-08-28..09-01, superseded by every later heartbeat) |
| claude/steward-heartbeat-2026-08-27-1226 | 1 | 2026-08-27T12:32:12Z | Claude | steward heartbeat — 12:26 cycle: quiet, no Mac activity; Phase 0 awaits owner local apply | #334 closed | record as abandoned and delete (owner), or reopen its PR if the work is still wanted |
| shift2-role-split-hold | 1 | 2026-08-20T19:23:38Z | Claude | Shift 2: the database role split — the ledger append-only BY PRIVILEGE, both directions pr | none | owner: open a PR, or archive-tag and delete (no PR; explicitly held Shift 2 database role split (2026-08-20); compare with open #1219 (Postgres role split) first) |
| shift1-tranche3-hold | 2 | 2026-08-20T18:23:24Z | Claude | Shift 1, tranche 3b: vuln-scan under full-space enumeration — wedge #14 — and the tier-cov | none | owner: open a PR, or archive-tag and delete (no PR; explicitly held Shift 1 tranche 3b work (2026-08-20)) |
| shift1-tranche2-hold | 3 | 2026-08-20T17:37:55Z | Claude | Shift 1, tranche 2c: macos-posture under full-space enumeration — clean across 52,488 comb | none | owner: open a PR, or archive-tag and delete (no PR; explicitly held Shift 1 tranche 2c work (2026-08-20)) |
| mac-sim-2026-08-20 | 1 | 2026-08-20T01:38:42Z | DanFashauer | sim results: fleet-lab-real-source (live-lanes FAIL) | none | record as abandoned and delete (owner; Mac confirms the sim record is not needed) (no PR; one sim-result commit (fleet-lab-real-source, live-lanes FAIL)) |
| claude/ruleset-probe | 4 | 2026-08-08T14:53:44Z | Claude | feat(android): parse the gate's answer where a gate can watch the parsing | #214 closed | record as abandoned and delete (owner), or reopen its PR if the work is still wanted |
| archive/launch-plan-emxm01-local-a83a16fd | 30 | 2026-07-28T17:27:49Z | Dan Fashauer | evidence: docker-verify durable-persistence run (real Postgres) | none | owner: convert to tag archive/launch-plan-emxm01-local-a83a16fd and delete the branch, or keep (no PR ever; verifier sample: 73 of 2467 added lines in 6 sampled commits absent on mainline; already named as an archive) |

## 3. Pull requests

Triaged at 2026-10-23T23:05:00Z: 79 (prs-triage-0..5). Gating check = "Typecheck, build, and proof scaffold". "Open live" is the 2026-10-23T23:35:33Z GET.

### 3a. LAND_DR037 candidates (2) — cloud lands after its own inspection

| PR | head | head sha | gating check-run | mergeable | open threads | still owed before landing |
| --- | --- | --- | --- | --- | --- | --- |
| #1585 | claude/build-tone-pairing-and-fetch-unreadable | 93288d4cb3becf95cb9c459f214a8df87bfbef0b | 120228729764 (success) | clean | 0 | Opus landing refute on head 93288d4c (last refute, round 6 on d925cf5f, was fix-needed); Codex never reviewed this head (usage limit). Land FIRST of the pair. |
| #1586 | claude/build-gate-symlink-entry-guard | 6d11676083b057c66b6d923977b527a81ba0a61d | 120212588268 (success) | clean | 0 | Opus landing refute on head 6d116760 (rounds 1,3,4,5,6,7 all fix-needed); Codex never reviewed (usage limit). Edits scripts/lib/land-branch-gate.mjs and three scripts/mac/ files: mail the Mac before landing. Land after #1585, with mainline merged in and the coverage page regenerated. |

DR-037's five conditions, all on the current head: (1) gating check-run passed; (2) preflight and verify:breadth passed locally before the push, quoted in the body or EVIDENCE; (3) every thread resolved, bot findings fixed or answered; (4) not conflicted with SignalGrid_Alpha, regenerated files regenerated by tooling; (5) the lane never approves and merges only its own PRs or a Mac landing the Mac asked for in mail. Never for the launch profile, launch-claims gate or publication boundary.

### 3b. NEEDS_WORK (6)

| PR | head | gating check-run | blocker |
| --- | --- | --- | --- |
| #1133 land-branch derives the owner-decision class from the diff ( | claude/land-branch-derive-klass @ 992cb2a7 | 108603295317 (success) | conflicted (26 ahead, 3399 behind); after the refresh re-check the tier: its body says the classifier and gate become owner-reserved under its own manifests |
| #1190 Stage article draft 4: what one real IdP puts on the wire ab | claude/build-identity-wire-truth-article @ e3ea3bf0 | 111011976503 (success) | conflicted (2467 behind); docs-only article draft, publishes nowhere without the owner sending it |
| #1230 Console: an unrecognised verdict renders restrictive, never  | claude/build-live-panel-unknown-tone @ a77859ae | 111030684434 (success) | conflicted (10 ahead, 2462 behind) |
| #1390 ci: shell lint uses the runner's shellcheck and waits for th | claude/build-ci-shellcheck-no-apt-lock @ c88ea58c | 113294340169 (success) | conflicted (39 ahead, 2113 behind); the round-13 fix-needed review covered the older head 9dd03f46, nothing reviews c88ea58c; raised-hands page shows it PAST LIMIT (conflicted, untouched 15.5d) |
| #1398 mutation-guard: journal-based restore on signal + carrier ev | claude/build-mutation-guard-restore-and-carrier-evaluate @ b8b37678 | 113321722901 (success) | draft and conflicted (16 ahead, 2100 behind) |
| #1611 Container shipped-import model: a script shipped alone must  | claude/build-shipped-import-model @ c8451bfb | 120227820357 (success) | draft; round-1 refute on 4e25a736 fix-needed, no verdict on c8451bfb; no Codex review; mark ready only after its landing refute passes |

### 3c. OWNER (48) — only Dan merges

**Merge now: one click each (green, mergeable clean, 0 open threads) (19)** — suggested order top to bottom; after each merge a lane re-reads the rest and refreshes any that went dirty.

| PR | head | gating check-run | state | decision |
| --- | --- | --- | --- | --- |
| #1438 persistence: unknown durable session status reads as ex | claude/build-session-store-status-normalize @ b9a0204c | 113331284995 (success) | clean | Merge: unknown durable session status reads as expired. |
| #1439 persistence: refresh guards on status=active and the lo | claude/build-session-refresh-active-guard @ 528b2641 | 113330469058 (success) | clean | Merge after #1438 (same session-store.ts): refresh guards on status=active. |
| #1440 auth: a null JOSE header, JWKS element or payload refus | claude/build-jwt-null-segments-refuse @ c9ba4e54 | 113418506190 (success) | clean | Merge: null JOSE header/JWKS/payload refuses instead of a 500 (then decide #1220). |
| #1220 Enterprise auth: JSON-null JOSE parts fail closed, malf | mac/enterprise-auth-hardening @ c1782472 | 110431539655 (success) | clean | Overlaps #1440 (same jwt.ts, jwks.ts): merge #1440 first, then the Mac refreshes #1220 and you merge it, or close #1220. |
| #1441 core: SIGNALGRID_ESTATE_REFRESH_SECONDS rejects values  | claude/build-estate-refresh-upper-bound @ 67e4f28a | 113330447265 (success) | clean | Merge: SIGNALGRID_ESTATE_REFRESH_SECONDS upper bound. |
| #1443 core: stepUpAnswers evicted with their decision (backlo | claude/build-store-stepup-answers-evict @ bbf2aee5 | 113418361217 (success) | clean | Accept the /v1 behaviour change (stepUpAnswers evicted with their decision) and merge. |
| #1445 api-server: decision:evaluate is authorized before WebA | claude/build-step-up-authorize-before-webauthn @ 468a38c9 | 113307860291 (success) | clean | Merge: decision:evaluate is authorized before WebAuthn consumes the challenge. |
| #1556 integrations: the webhook URL guard refuses the ::ffff: | claude/build-url-guard-translated-form-trailing-dot @ d607c5c9 | 117410603878 (success) | clean | Merge: webhook URL guard refuses ::ffff:0: and trailing-dot localhost. |
| #1239 api-server: HEAD served where GET is under the gateway; | claude/build-api-head-and-demo-envelope @ 42b0841f | 119917471663 (success) | clean | Merge: HEAD served under the gateway, demo routers reuse requestId. |
| #1240 webauthn: force the revocation/enrolment race orderings | claude/build-webauthn-revocation-race @ e9359955 | 113916040680 (success) | clean | Merge: webauthn revocation/enrolment race proof. |
| #1242 integrations: honest ITSM health, DLQ attempts, resolve | claude/build-integrations-honesty @ 2d5a158a | 120018945958 (success) | clean | Merge: integrations honesty batch (ITSM health, DLQ attempts, finite CVSS). |
| #1244 proofs: derive ladderRungs from the ladder, gate typed  | claude/build-ladder-rungs-derived @ e77470cf | 120242692230 (success) | clean | Merge: ladderRungs derived from the ladder. |
| #1251 posture-composition: fromDevicePosture fails closed on  | mac/posture-composition-device-posture-fail-closed @ d4faea6b | 109766795065 (success) | clean | Merge: fromDevicePosture fails closed. |
| #1255 control-plane: one canonical bundle encoding for checks | mac/control-plane-unambiguous-canonical-bundle @ 566806c7 | 109773658898 (success) | clean | Merge: one canonical bundle encoding for checksum and signature. |
| #1219 Postgres role split and stores: refuse triggers, PUBLIC | mac/pg-role-split-stores @ feca7ca9 | 110384478014 (success) | clean | Merge: Postgres role split, immutable decisions. |
| #1117 L1 root cause: the OIDC and load tests and the observab | claude/tests-ephemeral-ports-oidc-load-observability @ 261eefba | 109663124642 (success) | clean | Merge: test-only port fix, DECISION_PATH by path only. |
| #1146 Core digest: hash UTF-8 bytes, escape deterministicId p | claude/core-digest-utf8 @ 642e4751 | 108653687545 (success) | clean | Accept that ids and digests change (UTF-8 hashing, escaped deterministicId)? Merge or close. |
| #1153 Assist wire, server side: /v1/authorize returns a non-b | claude/assist-wire-server-four-outcomes @ 26a39479 | 108537426452 (success) | clean | Merge: /v1/authorize returns a string decisionId and string-only reasons. |
| #1337 gates: an unreadable scanned file fails launch-claims + | claude/build-gate-unreadable-scan-siblings @ 64e0ddcf | 113374587547 (success) | clean | Merge: launch-claims gate fails on an unreadable file, only ENOENT skips (the launch-claims gate is yours). |

**Doctrine and content calls on PRs (17)**

| PR | head | gating check-run | state | decision |
| --- | --- | --- | --- | --- |
| #1246 DR-061 (owner decision): lanes merge decision-path PRs  | mac/dr-061-delegation @ 756064fa | 109746145128 (success) | dirty | Accept DR-061 (lanes merge decision-path PRs under conditions)? Yes moves most of these 48 merges off you. The Mac refreshes it after your answer. |
| #1050 Puck 6 (DR-058 proposal): a holder-bound device_returne | claude/build-puck6-return-binding @ fc2ba648 | 109738032833 (success) | clean | Accept DR-058 (a holder-bound device_returned closes custody) into the core and DECISION_RECORDS? Merge or close. (custody is a deferred capability in docs/LAUNCH_PROFILE.md; a branch or PR name here is a GitHub identifier, not a claim) |
| #1083 DR-059 (proposal): estate posture ages at decision time | claude/proposal-dr059-posture-ages-refresh-retracts @ d0c62647 | 109671519583 (success) | clean | Accept DR-059 (posture ages at decision time; a refresh retracts what the source stopped reporting)? Merge or close. |
| #1322 DR-062 (owner decision): SignalGrid's scope is the whol | mac/dr-062-company-scope @ a6ce6572 | 110014367225 (failure) | unstable | Accept DR-062 (company-wide scope incl. legacy systems, fully automatic by default)? Gating is red on this head; the Mac fixes after your yes. |
| #1357 DR-063 (owner decision): the brain ecosystem — per-repo | mac/dr-063-brain-ecosystem @ f9260f1d | 110392463389 (success) | unstable | Accept DR-063 (brain ecosystem)? The cloud round-2 verdict says the body is untruthful; the Mac fixes the body first. |
| #1433 Absorb the ARC kiosk + puck-as-token owner note: puck r | mac/arc-puck-intake-v2 @ af395c3f | 111075759427 (success) | dirty | Adopt the DR-055 amendment and the launch-claims rewrite (ARC kiosk, puck-as-token)? 6 threads and a fix-needed verdict come first. |
| #1118 iOS port parity is behavioural: the TS engine's decisio | mac/ios-parity-behavioral @ 8f97bb73 | 109679080078 (success) | dirty | Allow a behaviour change to DecisionEngine.swift (golden rule 1 file)? Yes: the Mac refreshes, you merge. No: close. |
| #1121 AppWorkflows port parity is behavioural too: TS plans r | mac/app-workflows-parity @ 2848a9a1 | 108370612810 (success) | dirty | Allow the AppWorkflows.swift change (golden rule 1, stacked on #1118)? Decide together with #1118. |
| #1314 webauthn: a revoked step-up credential stays revoked (P | claude/cool-curie-mgkzox @ c16adf05 | 113447381485 (success) | dirty, draft | Pick the gap-1 option for a revoked step-up credential (B is shipped, A on request); a lane refreshes. |
| #1442 core: groupLatest orders observedAt in UTC regardless o | claude/build-evidence-observedat-utc-order @ f4a995db | 113729960703 (success) | dirty | Make the open design call (cross-tier accusations, Codex P1 in evidence.ts); a lane refreshes. |
| #1321 cli: signalgrid CLI harness, read-only by default (back | claude/build-signalgrid-cli-harness @ d3198896 | 120239822196 (success) | clean | Make the two open calls (handed to the Mac in #1638) and approve its docs/LAUNCH_PROFILE.md edit; 73 open threads must clear first. |
| #1417 Adopt icm-architect (DR-053 re-run): vendor byte-identi | mac/icm-architect-adopt @ 572b7a4b | 110947942024 (success) | dirty | Adopt icm-architect (reverses the cloud's intake verdict) and its publication-boundary registry edit? Yes: the Mac refreshes. No: close. |
| #1037 intake: unlazy linter + templates under third_party/, v | mac/intake-unlazy-skills @ b1d6ea8d | 108933792157 (success) | dirty | Accept this intake's edits to the publication boundary and the block-dangerous hook? Yes: the Mac refreshes and fixes 3 CodeQL threads. No: close. |
| #1265 web: live regions on polling views, labelled icon delet | claude/build-web-a11y-live-regions @ 3c7a4398 | 120239934233 (success) | clean | Approve buyer-facing a11y changes in artifacts/signalgrid-review once the open Codex findings are answered. |
| #1307 web+auth: self-host fonts in review/desktop, pin blank  | claude/build-self-host-fonts-review-desktop @ d46fd156 | 113916533762 (success) | clean, draft | Approve self-hosted fonts in buyer-facing review/desktop plus the blank OIDC_ISSUER pin? Mark ready and merge, or close. |
| #1309 docs: retire the file-count fossil, date the completion | claude/build-fossil-figures-orphan-spec @ 1f882fcc | 113569596940 (success) | dirty, draft | Approve archiving lib/api-spec/product-openapi.json to docs/archive; a lane refreshes the draft, you merge. |
| #1338 gates: derive the Assist-wire vector figure and self-te | claude/build-launch-profile-dir-closedwhen-vector-figure @ a26aab07 | 113372083040 (success) | dirty | Approve the launch-profile gate and v1.ts vector-figure change; a lane refreshes, then you merge. |

**Approve in principle; a lane refreshes or fixes; then you merge (12)**

| PR | head | gating check-run | state | decision |
| --- | --- | --- | --- | --- |
| #1215 Refuse telemetry from nodeIds outside the seeded edge n | claude/build-telemetry-known-node @ 4cb60605 | 109658194454 (success) | dirty | Approve the telemetry nodeId refusal in principle; a lane refreshes it (3135 behind), then you merge. |
| #1222 Answer unknown root paths with the JSON not_found envel | claude/build-gateway-root-json-404 @ bd964d53 | 109685292714 (success) | dirty | Approve the JSON not_found envelope in principle; a lane refreshes it, then you merge. |
| #1224 Core evidence: a not-fresh reading cannot erase a fresh | mac/core-evidence-freshness @ 92cb816b | 110448980307 (success) | clean | Wait: an upheld MEDIUM (round 2 fix-needed) on this head; the Mac fixes it, then you merge. |
| #1228 api-server fail-closed batch: profile, step-up authz or | mac/api-profile-stepup-estate @ 40f194fe | 110440069482 (success) | dirty | Approve the api-server fail-closed batch (round-2 owner-decision); the Mac refreshes, then you merge. |
| #1247 Device-management-health: an out-of-union or absent jud | mac/dmh-evaluate-unknowns @ 36ef2251 | 109997536387 (success) | dirty | Approve device-management-health unknowns read unverified; the Mac refreshes, then you merge. |
| #1280 core: registerVerifiedPrincipal refuses unknown roles ( | claude/build-core-principal-policy-guards @ 4c9cd27e | 113669329979 (success) | dirty, draft | Approve registerVerifiedPrincipal refusing unknown roles (round-4 owner-decision); a lane refreshes the draft, you merge. |
| #1320 simulator: drop constant status conjuncts, pin three un | claude/build-sim-status-constants-key-pins @ 2fc1035f | 110005357099 (success) | dirty, draft | Approve dropping constant status conjuncts in the TS simulator decisionEngine.ts; a lane refreshes the draft. |
| #1330 handoff-sim: keep every hold on a task, not just the la | claude/build-handoff-sim-same-task-holds @ 15129993 | 113744501213 (success) | dirty | Approve handoff-sim keeping every hold on a task; a lane refreshes, then you merge. |
| #1422 Retire dead WEBAUTHN admin step-up knob (plan row 27) | mac/webauthn-admin-step-up @ fead8e86 | 110954621474 (success) | dirty | Approve retiring the dead WEBAUTHN admin step-up knob (squash merge asked); the Mac refreshes. |
| #1431 test: ephemeral-port probes bind the wildcard the serve | claude/fix-port-probe-wildcard-bind @ e570af93 | 111075085925 (success) | clean | Approve the port-probe test change after a lane fixes the 2 Codex P2 threads (IPv6-only wildcard). |
| #1459 api-server: GET /v1/audit verifies the whole durable ch | claude/build-audit-route-verify-ledger-full @ e2a4ac05 | 113735571652 (success) | dirty | Approve GET /v1/audit verifying the whole chain; a lane refreshes and gets a verdict on the current head. |
| #1463 api-server: /metrics exports connector-health and stale | claude/build-connector-health-and-stale-evidence-metrics @ d160264f | 113649840132 (success) | dirty | Approve /metrics connector-health and stale-evidence series; a lane refreshes, then you merge. |

### 3d. MAC (7) — the brain refreshes and fixes; the cloud lands under DR-037 when the Mac asks in mail

| PR | head | gating check-run | next |
| --- | --- | --- | --- |
| #1225 Mac shell scripts: bash-3.2 rule and Darwin-guard rule in th | mac/sim-scripts-bash32-darwin @ 216d0dc4 | 110401326290 (success) | refresh (11 ahead, 2691 behind); fix the round-4 fix-needed findings (refuter overturned ship) |
| #1323 Live demo: pnpm run demo:live plays signal → decision → tick | mac/demo-live @ 79945354 | 110234300580 (success) | refresh (7 ahead, 2764 behind); resolve 1 thread; fix CodeQL and phase-pr-evidence; the demo:live script in the title no longer exists in any package.json (historical) |
| #1353 pr-refresh: a no-model bot that re-merges mainline into dirt | mac/pr-refresh @ cb62b1bd | 110239541864 (success) | refresh (5 ahead, 2758 behind); resolve 2 CodeQL threads; fix the round-1 fix-needed review |
| #1354 docs: RESOURCE_INTAKE row for the Cole Medin team-brain vide | mac/intake-row-cole-medin-team-brain @ 1c857ef1 | 110242829040 (success) | mergeable clean; fix the two documentation findings (round-1 fix-needed) and phase-pr-evidence; the Mac holds it exclusively (lane mail 2026-10-23T20:03Z) |
| #1356 scan:estate finds sibling checkouts and scans one only when  | mac/scan-estate-sibling-locator @ 03462b7e | 110430902495 (success) | refresh (9 ahead, 2671 behind); fix the round-2 fix-needed findings |
| #1416 Add the @claude GitHub workflow (DR-063 GitHub-App trigger,  | mac/claude-github-action @ b02d067e | 110896767339 (success) | refresh (5 ahead, 2551 behind); fix the round-1 fix-needed review; it wires a DR-063 trigger while DR-063 itself (#1357) is unmerged |
| #1424 proof: Keycloak access-governance bridge and live proof, nev | mac/keycloak-access-governance @ f780c701 | 110964894975 (success) | refresh (8 ahead, 2482 behind); fix the round-1 fix-needed verdict; Codex left only a usage-limit notice |

### 3e. DEPENDABOT (9) — wait for the owner's policy (OD04)

| PR | gating check-run | state | note |
| --- | --- | --- | --- |
| #1379 ci: bump the github-actions-minor-and-patch group with 2 upd | 110441305542 (failure) | unstable | dependabot[bot] PR bumping 2 actions across 7 CI workflow definitions (SAFETY_MACHINERY only), 0 threads, mergeable true/unstable (1 ahead, 2666 behind mainline), but gating run 110441305542 completed/failure on 524ce94d (annotation: Process completed with exit code 100), so it also needs work; the owner's 2026-10-15 dependabot decision is pending. |
| #1381 deps: bump thread-stream from 3.1.0 to 4.2.0 | none on head (0 check-runs) | unstable | dependabot[bot] major bump of thread-stream 3.1.0 to 4.2.0 (artifacts/api-server/package.json, DECISION_PATH), still unapplied on mainline; gating check-run is absent on 3d05112e (0 check-runs, combined status pending/0), mergeable true/unstable (2 ahead, 2666 behind mainline), 0 threads; the owner's 2026-10-15 dependabot decision is pending. |
| #1382 deps: bump @types/node from 25.6.2 to 26.6.3 | none on head (0 check-runs) | unstable | dependabot[bot] major bump of @types/node 25.6.2 to 26.6.3 (pnpm-workspace.yaml catalog), still unapplied on mainline; gating check-run is absent on 3616e506 (0 check-runs, combined status pending/0), mergeable true/unstable (2 ahead, 2666 behind mainline), 0 threads; the owner's 2026-10-15 dependabot decision is pending. |
| #1383 deps: bump ioredis from 5.11.1 to 6.0.0 | none on head (0 check-runs) | unstable | dependabot[bot] major bump of ioredis 5.11.1 to 6.0.0 (lib/integrations, lib/webauthn, scripts package.json; DECISION_PATH), still unapplied on mainline; gating check-run is absent on c4529c3d (0 check-runs, combined status pending/0), mergeable true/unstable (2 ahead, 2666 behind mainline), 0 threads; the owner's 2026-10-15 dependabot decision is pending. |
| #1384 deps: bump lucide-react from 0.545.0 to 1.48.0 | none on head (0 check-runs) | unstable | dependabot[bot] major bump of lucide-react 0.545.0 to 1.48.0 (pnpm-workspace.yaml catalog), still unapplied on mainline; gating check-run is absent on 2755e2ba (0 check-runs, combined status pending/0), mergeable true/unstable (2 ahead, 2666 behind mainline), 0 threads; the owner's 2026-10-15 dependabot decision is pending. |
| #1385 deps: bump zod from 3.25.76 to 4.6.5 | none on head (0 check-runs) | unstable | dependabot[bot] major bump of zod 3.25.76 to 4.6.5 (pnpm-workspace.yaml catalog), still unapplied on mainline; gating check-run is absent on 69596f57 (0 check-runs, combined status pending/0), mergeable true/unstable (2 ahead, 2666 behind mainline), 0 threads; the owner's 2026-10-15 dependabot decision is pending. |
| #1386 deps: bump @hookform/resolvers from 3.10.0 to 5.9.1 | none on head (0 check-runs) | unstable | dependabot[bot] major bump of @hookform/resolvers 3.10.0 to 5.9.1 (artifacts/signalgrid-app/package.json), still unapplied on mainline; gating check-run is absent on d75569f0 (0 check-runs, combined status pending/0), mergeable true/unstable (2 ahead, 2666 behind mainline), 0 threads; the owner's 2026-10-15 dependabot decision is pending. |
| #1387 deps: bump framer-motion from 12.38.0 to 13.4.4 | none on head (0 check-runs) | unstable | dependabot[bot] major bump of framer-motion 12.38.0 to 13.4.4 (pnpm-workspace.yaml catalog), still unapplied on mainline; gating check-run is absent on f12459b9 (0 check-runs, combined status pending/0), mergeable true/unstable (2 ahead, 2666 behind mainline), 0 threads; the owner's 2026-10-15 dependabot decision is pending. |
| #1562 deps: bump the npm-minor-and-patch group across 1 directory  | 117432738558 (success) | unstable | Dependabot author (npm-minor-and-patch group, 35 updates, 13 files: 11 package.json plus pnpm-lock.yaml and pnpm-workspace.yaml); the owner's 2026-10-15 dependabot decision is pending, and on the head dbdaeb2e gating run 117432738558 is success but mergeable_state is unstable with Mac-only checks, phase-pr-evidence and CycloneDX SBOM failing, 2 unresolved threads, Codex has_unresolved_findings true, and 766 commits behind mainline. |

### 3f. CLOSE_CANDIDATE (6; 5 still open)

| PR | head | superseding evidence | who closes |
| --- | --- | --- | --- |
| #1336 Mac tick 20260930T204503Z: sim results (0 request( | mac/tick-20260930T204503Z @ 8388d0ba | Its generated docs/agent/objective-state.json (derived 2026-09-30T20:45Z) is superseded by mainline's derivation of 2026-10-23T00:27Z and by the newer open tick PR #1569 (same objective-state.json and coverage page, plus result objective-loop-evidence-fresh-2026-10-17-2), and its own gating run 110090030031 is failure at objective-loop --check on a conflicted PR (mergeable false/dirty, 1 ahead / 2858 behind mainline). | brain (Mac lane) first; cloud after 01:24Z |
| #1509 Mac tick 20261012T000306Z: sim results (0 request( | mac/tick-20261012T000306Z @ b743ae7c | Its only change is docs/agent/objective-state.json derived 2026-10-12T00:03:08Z, superseded by mainline's derivation of 2026-10-23T00:27:33Z (commit 9f2990ae) and by the newer open tick PR #1569 (2026-10-17, same file), and it is itself failing (gating run 114610006992 completed/failure on b743ae7c), conflicted (mergeable false/dirty, 1 ahead / 1614 behind mainline) with 1 unresolved Codex P1 thread (queued request lives on another unmerged branch). | brain (Mac lane) first; cloud after 01:24Z |
| #1510 Mac tick 20261013T000348Z: sim results (0 request( | mac/tick-20261013T000348Z @ 3deddcf5 | Its only file, the generated docs/agent/objective-state.json snapshot derived 2026-10-13 ("evidence is 10 day(s) old"), is superseded by mainline's rewrite (derivedAt 2026-10-23T00:27:33Z, last commit 94aada541 Mac tick 20261023T002730Z) and by open tick #1569, and the PR itself has gating run 115062679308 failed, mergeable false/dirty (1 ahead, 1614 behind) and 1 unresolved thread. | brain (Mac lane) first; cloud after 01:24Z |
| #1511 Mac tick 20261014T000011Z: sim results (0 request( | mac/tick-20261014T000011Z @ 21bc1f85 | Its only file, the generated docs/agent/objective-state.json snapshot derived 2026-10-14 ("evidence is 11 day(s) old"), is superseded by mainline's rewrite (derivedAt 2026-10-23T00:27:33Z, last commit 94aada541 Mac tick 20261023T002730Z) and by open tick #1569, and the PR itself has gating run 115604960364 failed, mergeable false/dirty (1 ahead, 1614 behind) and 2 unresolved threads. | brain (Mac lane) first; cloud after 01:24Z |
| #1569 Mac tick 20261017T182020Z: sim results (1 request( | mac/tick-20261017T182020Z @ 4d0599cc | All four files have newer versions on mainline: live-evidence/mac-run.json was re-minted 2026-10-21T22:14:07Z (f3b55f717) over this PR's 2026-10-17 mint, the same-named sim-result objective-loop-evidence-fresh-2026-10-17-2.json on mainline is the 2026-10-21T22:14:10Z run, objective-state.json was re-derived 2026-10-23T00:27:33Z, and the coverage page has been regenerated since; the PR is also mergeable false/dirty (1 ahead, 734 behind) although gating run 117477480952 is success with 0 threads. | Mac lane only (Mac confirms the evidence record) |
| #1638 Lane mail (cloud): PR #1321 open decisions handed  | lane/cloud-mail-20261023-225852Z @ c2b74fee | Already merged: PR #1638 was merged at 2026-10-23T23:22:27Z as 055fb2a0 (the live SignalGrid_Alpha tip), its head c2b74fee is an ancestor of origin/SignalGrid_Alpha, its one file's blob is identical on mainline, and the lane/cloud-mail-20261023-225852Z branch is already deleted (404), so there is nothing left to land or close. | nobody: already merged 2026-10-23T23:22:27Z |

### 3g. Mailbox and new

- #439 lane/mailbox: keep forever (standing draft, 0 files, body says never merge and never close).
- #1640 lane/cloud-mail-20261023-232656Z @ c2151d15: Lane mail (cloud): steward 23:24Z — the owner's two directives to the Mac brain (run everything; resolve every. Opened after 23:05Z; no input classifies it; the cloud's own PR, lands only under DR-037 / lane-mail rules.
- #1639 claude/local-brain-primary-20261023 @ df73a9eb: docs(loop, lanes): record the owner's 23:00Z directive — the local second brain runs everything; the cloud and. Opened after 23:05Z; no input classifies it; the cloud's own PR, lands only under DR-037 / lane-mail rules.

## 4. Issues

### KEEP (1)

| issue | evidence (short) | action |
| --- | --- | --- |
| #1597 Raised hands — what is stuck | Label raised-hands, bot-authored, title starts 'Raised hands'. Last updated 2026-10-23T23:02:26Z, i.e. refreshed ~3 min before measuredAt. Body says '80 open': 55 need Dan, 11 need the cloud lane, 14 need the Mac lane. It replaced #1068 (closed 2026-10-22T19:0 | Never close. This is the owner's single stuck-list. Closing the 80 hands it lists is a separate job, done by clearing each hand (pnpm run hand:clear) when its blocker is cleared. |

### MAC (2)

| issue | evidence (short) | action |
| --- | --- | --- |
| #1546 Mac-local AI operations brain: budgeted Claude/Codex escalat | Owner directive (updated 2026-10-20) for a local-first Mac AI operations brain; body says 'Keep one issue for this cross-cutting integration'. Mainline (origin/SignalGrid_Alpha 2a46fd1) carries only the primitives so far: scripts/mac/local-brain/{job-state,tas | KEEP OPEN as the single tracking issue for the local-brain work; the Mac lane owns it. Do not close on the strength of the primitives landing. The 2026-10-20 directive inside it is also the written authority for this cleanup run (stop heartbeat-only PR churn first, archive before deleting branches, preserve #439, mainline stays SignalGrid_Alpha). |
| #338 LAB 001 - decide on a real signal (Step 1: live macOS postur | Not done. The Mac did land a sim-result for LAB_001 Step 1 (artifacts/sim-results/2026-08-31-lab001-step1-real-posture.json, passed, completedAt 2026-09-02T16:51:33Z, workingTreeClean true), but that run is the verify:all evidence op (signalgrid-mcp pytest 99  | KEEP OPEN, Mac lane. Next move is the flag plus a live-posture reader in lib/integrations/src/integrations/macos-posture (mac-lane work; an unreadable probe must raise assurance, verified by forcing one). Outside docs/agent/ORG_SELF_EVALUATION_2026-09-12.md (which flagged it as an unread channel), my grep of docs/scripts found no doc citing #338; give it a backlog row or a hand so a lane sees it. |

### CLOUD (1)

| issue | evidence (short) | action |
| --- | --- | --- |
| #1165 Scheduled verification failing | Bot-opened by .github/workflows/scheduled-verification.yml (label scheduled-verification; it comments instead of opening a second issue). 32 bot comments. The DAILY IMAGE VULNERABILITY GATE has failed on every daily comment from 2026-10-06 through the latest o | NOT a done-candidate: a real gate has been red 18 days. Cloud lane: read the job's grype output in the Actions UI, bump the affected base layer or dependency in the api image, land under DR-037. Close only when the next scheduled run is green (the workflow reopens a new issue on the next failure, so closing early just recreates it). Edit the stale #1068 sentence away or ignore it. |

### OWNER (2)

| issue | evidence (short) | action |
| --- | --- | --- |
| #141 Product 100 launch program — freeze breadth, prove one live  | Owner-written (2026-07-28) 'Product 100 launch program' with a P0/P1 checklist and a launch scorecard (commercial readiness 58/100, customer validation 15/100) that is three months old; CLAUDE.md now says readiness is derived by scripts/check-readiness-figure. | Cannot be closed by a lane. Owner decides its fate; until answered it stays open. Owner: Is #141 still the live launch plan (then re-score it from check-readiness-figure and tick the done P0 items), or retire it in favor of docs/COMPANY_BUILD_PLAN.md and close it? |
| #136 Define portable work context and adaptive Grid Intelligence  | Owner-written founder vision (2026-07-27), 0 comments. Six mainline docs name it 'Canonical source' or 'Vision anchor' by number (ADAPTIVE_PROPOSALS, HANDOFF_SIMULATION, LIVE_SYNC_LOOP, PORTABLE_WORK_CONTEXT, SELF_AUDIT, VISION_PERSON_FIRST_GRID), and docs/BRA | Do not close without the owner: closing leaves six docs pointing at a closed 'canonical' issue. Owner: Keep #136 open as the standing vision anchor (recommended, label it standing), or copy its text into a docs file, repoint the six docs, and close it? |

## 5. The owner's list

Only Dan can decide these. One line each.


**Authority and settings**

- OD01 Branch-deletion authority: DR-037 says a lane "does not ... delete branches"; your 2026-10-23 directive says clean up all branches. Confirm lanes may delete the verified zero-loss list (archive tag first) and record it as a DR-037 amendment (docs/DECISION_RECORDS.md is yours).
- OD02 Prune tool, not the ruleset (corrected by the cloud's inspection at 23:52Z): ruleset 20587603 "Default" targets every branch but carries one rule, copilot_code_review, and no deletion rule, so GitHub does not block `git push --delete`; scripts/prune-merged-branches.mjs refuses because the API reports protected=true for any branch a ruleset targets. Decision: approve a prune-tool change that reads the ruleset's rules (refuse only on a deletion rule), or leave the tool and let the lanes delete with git directly under DR-064 rule 7. No settings change is needed.
- OD03 claude/land-mac-1248 (verifier REFUTED): Only a regenerable derived count line in docs/agent/SURFACE_REVIEW_COVERAGE.md is not on mainline; #1248 merged 2026-10-21. Waive and delete, or keep.
- OD04 Dependabot policy (pending since 2026-10-15): #1562 #1379 #1381 #1382 #1383 #1384 #1385 #1386 #1387: Choose: the 35-update group #1562 after its fixes; the 8 majors one at a time, or close them and ignore the majors; the actions group #1379 (gating red). Note #1562 may carry the fix #1165 needs (unverified).

**Merge now: one click each (green, mergeable clean, 0 open threads)**

- OD05 PR #1438 persistence: unknown durable session status reads as expired (backlog : Merge: unknown durable session status reads as expired.
- OD06 PR #1439 persistence: refresh guards on status=active and the losing refresh wr: Merge after #1438 (same session-store.ts): refresh guards on status=active.
- OD07 PR #1440 auth: a null JOSE header, JWKS element or payload refuses instead of t: Merge: null JOSE header/JWKS/payload refuses instead of a 500 (then decide #1220).
- OD08 PR #1220 Enterprise auth: JSON-null JOSE parts fail closed, malformed nbf/iat/e: Overlaps #1440 (same jwt.ts, jwks.ts): merge #1440 first, then the Mac refreshes #1220 and you merge it, or close #1220.
- OD09 PR #1441 core: SIGNALGRID_ESTATE_REFRESH_SECONDS rejects values past Node's tim: Merge: SIGNALGRID_ESTATE_REFRESH_SECONDS upper bound.
- OD10 PR #1443 core: stepUpAnswers evicted with their decision (backlog row): Accept the /v1 behaviour change (stepUpAnswers evicted with their decision) and merge.
- OD11 PR #1445 api-server: decision:evaluate is authorized before WebAuthn consumes t: Merge: decision:evaluate is authorized before WebAuthn consumes the challenge.
- OD12 PR #1556 integrations: the webhook URL guard refuses the ::ffff:0: translated I: Merge: webhook URL guard refuses ::ffff:0: and trailing-dot localhost.
- OD13 PR #1239 api-server: HEAD served where GET is under the gateway; demo routers r: Merge: HEAD served under the gateway, demo routers reuse requestId.
- OD14 PR #1240 webauthn: force the revocation/enrolment race orderings in proof:enrol: Merge: webauthn revocation/enrolment race proof.
- OD15 PR #1242 integrations: honest ITSM health, DLQ attempts, resolver docstring, fi: Merge: integrations honesty batch (ITSM health, DLQ attempts, finite CVSS).
- OD16 PR #1244 proofs: derive ladderRungs from the ladder, gate typed literals (plan : Merge: ladderRungs derived from the ladder.
- OD17 PR #1251 posture-composition: fromDevicePosture fails closed on out-of-domain i: Merge: fromDevicePosture fails closed.
- OD18 PR #1255 control-plane: one canonical bundle encoding for checksum + signature : Merge: one canonical bundle encoding for checksum and signature.
- OD19 PR #1219 Postgres role split and stores: refuse triggers, PUBLIC grants, TEMP; : Merge: Postgres role split, immutable decisions.
- OD20 PR #1117 L1 root cause: the OIDC and load tests and the observability proof bin: Merge: test-only port fix, DECISION_PATH by path only.
- OD21 PR #1146 Core digest: hash UTF-8 bytes, escape deterministicId parts, gate lega: Accept that ids and digests change (UTF-8 hashing, escaped deterministicId)? Merge or close.
- OD22 PR #1153 Assist wire, server side: /v1/authorize returns a non-blank string dec: Merge: /v1/authorize returns a string decisionId and string-only reasons.
- OD23 PR #1337 gates: an unreadable scanned file fails launch-claims + proof-bindings: Merge: launch-claims gate fails on an unreadable file, only ENOENT skips (the launch-claims gate is yours).

**Doctrine and content calls on PRs**

- OD24 PR #1246 DR-061 (owner decision): lanes merge decision-path PRs under condition: Accept DR-061 (lanes merge decision-path PRs under conditions)? Yes moves most of these 48 merges off you. The Mac refreshes it after your answer.
- OD25 PR #1050 Puck 6 (DR-058 proposal): a holder-bound device_returned closes custod: Accept DR-058 (a holder-bound device_returned closes custody) into the core and DECISION_RECORDS? Merge or close. (custody is a deferred capability in docs/LAUNCH_PROFILE.md; a branch or PR name here is a GitHub identifier, not a claim)
- OD26 PR #1083 DR-059 (proposal): estate posture ages at decision time; a refresh ret: Accept DR-059 (posture ages at decision time; a refresh retracts what the source stopped reporting)? Merge or close.
- OD27 PR #1322 DR-062 (owner decision): SignalGrid's scope is the whole company incl.: Accept DR-062 (company-wide scope incl. legacy systems, fully automatic by default)? Gating is red on this head; the Mac fixes after your yes.
- OD28 PR #1357 DR-063 (owner decision): the brain ecosystem — per-repo instructions, : Accept DR-063 (brain ecosystem)? The cloud round-2 verdict says the body is untruthful; the Mac fixes the body first.
- OD29 PR #1433 Absorb the ARC kiosk + puck-as-token owner note: puck requirements, DR: Adopt the DR-055 amendment and the launch-claims rewrite (ARC kiosk, puck-as-token)? 6 threads and a fix-needed verdict come first.
- OD30 PR #1118 iOS port parity is behavioural: the TS engine's decisions replayed thr: Allow a behaviour change to DecisionEngine.swift (golden rule 1 file)? Yes: the Mac refreshes, you merge. No: close.
- OD31 PR #1121 AppWorkflows port parity is behavioural too: TS plans replayed through: Allow the AppWorkflows.swift change (golden rule 1, stacked on #1118)? Decide together with #1118.
- OD32 PR #1314 webauthn: a revoked step-up credential stays revoked (PR #1240 review : Pick the gap-1 option for a revoked step-up credential (B is shipped, A on request); a lane refreshes.
- OD33 PR #1442 core: groupLatest orders observedAt in UTC regardless of host timezone: Make the open design call (cross-tier accusations, Codex P1 in evidence.ts); a lane refreshes.
- OD34 PR #1321 cli: signalgrid CLI harness, read-only by default (backlog row, DR-040: Make the two open calls (handed to the Mac in #1638) and approve its docs/LAUNCH_PROFILE.md edit; 73 open threads must clear first.
- OD35 PR #1417 Adopt icm-architect (DR-053 re-run): vendor byte-identical, nested-ins: Adopt icm-architect (reverses the cloud's intake verdict) and its publication-boundary registry edit? Yes: the Mac refreshes. No: close.
- OD36 PR #1037 intake: unlazy linter + templates under third_party/, vercel-labs/skil: Accept this intake's edits to the publication boundary and the block-dangerous hook? Yes: the Mac refreshes and fixes 3 CodeQL threads. No: close.
- OD37 PR #1265 web: live regions on polling views, labelled icon delete, reduced moti: Approve buyer-facing a11y changes in artifacts/signalgrid-review once the open Codex findings are answered.
- OD38 PR #1307 web+auth: self-host fonts in review/desktop, pin blank OIDC_ISSUER (pl: Approve self-hosted fonts in buyer-facing review/desktop plus the blank OIDC_ISSUER pin? Mark ready and merge, or close.
- OD39 PR #1309 docs: retire the file-count fossil, date the completion-plan census, a: Approve archiving lib/api-spec/product-openapi.json to docs/archive; a lane refreshes the draft, you merge.
- OD40 PR #1338 gates: derive the Assist-wire vector figure and self-test the dir clos: Approve the launch-profile gate and v1.ts vector-figure change; a lane refreshes, then you merge.

**Approve in principle; a lane refreshes or fixes; then you merge**

- OD41 PR #1215 Refuse telemetry from nodeIds outside the seeded edge nodes (plan row : Approve the telemetry nodeId refusal in principle; a lane refreshes it (3135 behind), then you merge.
- OD42 PR #1222 Answer unknown root paths with the JSON not_found envelope (plan row 9: Approve the JSON not_found envelope in principle; a lane refreshes it, then you merge.
- OD43 PR #1224 Core evidence: a not-fresh reading cannot erase a fresh accusation; st: Wait: an upheld MEDIUM (round 2 fix-needed) on this head; the Mac fixes it, then you merge.
- OD44 PR #1228 api-server fail-closed batch: profile, step-up authz order, revoke aud: Approve the api-server fail-closed batch (round-2 owner-decision); the Mac refreshes, then you merge.
- OD45 PR #1247 Device-management-health: an out-of-union or absent judged field reads: Approve device-management-health unknowns read unverified; the Mac refreshes, then you merge.
- OD46 PR #1280 core: registerVerifiedPrincipal refuses unknown roles (plan row 86; ro: Approve registerVerifiedPrincipal refusing unknown roles (round-4 owner-decision); a lane refreshes the draft, you merge.
- OD47 PR #1320 simulator: drop constant status conjuncts, pin three unset attribute k: Approve dropping constant status conjuncts in the TS simulator decisionEngine.ts; a lane refreshes the draft.
- OD48 PR #1330 handoff-sim: keep every hold on a task, not just the last (backlog row: Approve handoff-sim keeping every hold on a task; a lane refreshes, then you merge.
- OD49 PR #1422 Retire dead WEBAUTHN admin step-up knob (plan row 27): Approve retiring the dead WEBAUTHN admin step-up knob (squash merge asked); the Mac refreshes.
- OD50 PR #1431 test: ephemeral-port probes bind the wildcard the server binds, not 12: Approve the port-probe test change after a lane fixes the 2 Codex P2 threads (IPv6-only wildcard).
- OD51 PR #1459 api-server: GET /v1/audit verifies the whole durable chain (verifyLedg: Approve GET /v1/audit verifying the whole chain; a lane refreshes and gets a verdict on the current head.
- OD52 PR #1463 api-server: /metrics exports connector-health and stale-evidence serie: Approve /metrics connector-health and stale-evidence series; a lane refreshes, then you merge.

**Issues**

- OD53 Issue #141 Product 100 launch program: Is #141 still the live launch plan (then re-score it from check-readiness-figure and tick the done P0 items), or retire it in favor of docs/COMPANY_BUILD_PLAN.md and close it?
- OD54 Issue #136 portable work context / Grid Intelligence vision: Keep #136 open as the standing vision anchor (recommended, label it standing), or copy its text into a docs file, repoint the six docs, and close it?

**Branch abandonment (archive tag first, then delete)**

- OD55 G1: 46 unmerged mac/tick-* branches: Abandon all? Each PR closed unmerged; generated tick output, and mainline re-derived objective-state.json on 2026-10-23 (not checked branch by branch). The Mac first confirms 4 that carry sim-result records: mac/tick-20260925T203034Z, mac/tick-20260925T200508Z, mac/tick-20260925T191227Z, mac/tick-20260921T140443Z.
- OD56 G2: 43 unmerged lane/cloud-mail-* branches: Abandon all? Lane mail from 2026-09-05..09-29 (40 PRs closed unmerged, 3 never opened). Later heartbeats exist; before deleting, `node scripts/check-lane-messages.mjs` shows whether any ack or send in them is still owed.
- OD57 G3: 7 branches whose PR merged but carry residue: Abandon all after a human diff? claude/build-restamp-landed-rows-round-4, mac/decision-path-classifier-gap, claude/build-affected-audience-v2, claude/signalgrid-launch-plan-emxm01, mac/custody-removal-suspends, claude/build-custody-v1-wiring, mac/native-ledger-2026-09-02. (custody is a deferred capability in docs/LAUNCH_PROFILE.md; a branch or PR name here is a GitHub identifier, not a claim)
- OD58 G4: 29 branches whose PR was closed unmerged: Abandon all, or name the ones to reopen (biggest: lane/cloud-nist-alignment-20260911-132625Z 18 ahead, lane/cloud-runbook-partials-20260911-154128Z 18 ahead, claude/custody-journey-v2 10 ahead). Full list in section 2. (custody is a deferred capability in docs/LAUNCH_PROFILE.md; a branch or PR name here is a GitHub identifier, not a claim)
- OD59 mac/fleet-premium-proof: owner: archive-tag and delete, or keep parked until Fleet Premium work resumes (no PR; its own subject says parked WIP, not reviewed, not for merge).
- OD60 claude/steward-heartbeat-2026-08-28-1624: record as abandoned and delete (owner) (no PR; 25 steward heartbeat commits from 2026-08-28..09-01, superseded by every later heartbeat).
- OD61 shift2-role-split-hold: owner: open a PR, or archive-tag and delete (no PR; explicitly held Shift 2 database role split (2026-08-20); compare with open #1219 (Postgres role split) first).
- OD62 shift1-tranche3-hold: owner: open a PR, or archive-tag and delete (no PR; explicitly held Shift 1 tranche 3b work (2026-08-20)).
- OD63 shift1-tranche2-hold: owner: open a PR, or archive-tag and delete (no PR; explicitly held Shift 1 tranche 2c work (2026-08-20)).
- OD64 mac-sim-2026-08-20: record as abandoned and delete (owner; Mac confirms the sim record is not needed) (no PR; one sim-result commit (fleet-lab-real-source, live-lanes FAIL)).
- OD65 archive/launch-plan-emxm01-local-a83a16fd: owner: convert to tag archive/launch-plan-emxm01-local-a83a16fd and delete the branch, or keep (no PR ever; verifier sample: 73 of 2467 added lines in 6 sampled commits absent on mainline; already named as an archive).

## 6. The brain's runbook

Ordered. Every step is idempotent and ends with the check that proves it done. Stuck means raise a hand (`pnpm run hand:raise`), never a silent stall.

**Step 0. Start, announce, read the mail**

```bash
cd "$SG_REPO" && git fetch --prune origin && git status --porcelain   # must print nothing; else work in a throwaway worktree
pnpm run lane:inbox
pnpm run lane:deliver send "ESTATE PLAN 20261023: brain started" "step 0 at <UTC>; plan measuredAt 2026-10-23T23:05:00Z"
```

Done when: The start message is on origin/SignalGrid_Alpha under artifacts/lane-messages/ (git log -1 origin/SignalGrid_Alpha -- artifacts/lane-messages) and the mailbox PR #439 got its wake comment.

**Step 1. Re-measure before acting (read-only)**

```bash
git ls-remote --heads origin | wc -l    # 229 at 2026-10-23T23:41:04Z, mainline included
gh api "repos/DanFashauer/SignalGrid-Review-Hub/pulls?state=open&per_page=100&page=1" --jq length    # 80 at 2026-10-23T23:35:33Z (one page; check page 2 if 100)
gh api "repos/DanFashauer/SignalGrid-Review-Hub/issues?state=open&per_page=100&page=1" --jq '[.[]|select(.pull_request|not)]|length'    # 6
```

Done when: Numbers written into the step-0 thread. If a number moved, re-read the affected rows of this plan before acting on them.

**Step 2. Delete the 10 verified zero-loss branches (archive tag first)**

```bash
bash docs/agent/estate-20261023/delete-zero-loss-verified.sh            # dry run: expect WOULD x10, SKIPPED 0
bash docs/agent/estate-20261023/delete-zero-loss-verified.sh --apply    # expect DELETED or DONE x10, SKIPPED 0
```

Done when: For each of the 10: `git ls-remote --exit-code --heads origin <branch>; echo $?` prints 2, and `git ls-remote origin refs/tags/archive/<branch>` prints the measured tip. The earlier, unverified list (delete-zero-loss, 11 lines) is not shipped: it includes the refuted claude/land-mac-1248.

**Step 3. Close the superseded Mac tick PRs the Mac owns**

```bash
for n in 1336 1509 1510 1511; do gh api repos/DanFashauer/SignalGrid-Review-Hub/pulls/$n --jq '[.state,.head.sha]|@tsv'; done   # expect open + the measured head sha
gh api -X POST repos/DanFashauer/SignalGrid-Review-Hub/issues/<n>/comments -f body="Closed under ESTATE_PLAN_20261023: superseded by mainline docs/agent/objective-state.json derivedAt 2026-10-23T00:27:33Z (9f2990ae) and by tick #1569; the file is rewritten whole, nothing unique is lost."
gh api -X PATCH repos/DanFashauer/SignalGrid-Review-Hub/pulls/<n> -f state=closed
#1569: the Mac lane decides first whether the 2026-10-17 evidence-execution record (provenance 117b41dd) must be kept; close only if not.
```

Done when: `gh api repos/.../pulls/<n> --jq .state` prints closed for 1336, 1509, 1510, 1511 (and 1569 if the Mac chose to). Their head branches join owner group G1; they are not deleted here.

**Step 4. Refresh and fix the 7 MAC PRs, then ask the cloud to inspect**

```bash
Order: #1354 (clean already), #1225, #1356, #1424, #1416, #1323, #1353.
Per PR, in its own worktree: git merge origin/SignalGrid_Alpha; regenerate derived files with the repo tooling (node scripts/generate-sync-manifest.mjs, the coverage page), never by hand.
Fix the findings named in the last cloud verdict on the PR; resolve every thread with a fix or a reason.
node scripts/preflight.mjs && pnpm run verify:breadth   # quote both summary lines in the PR body
git push; then pnpm run lane:deliver send "land #<n> under DR-037" "<head sha>, gating <check-run id>"
```

Done when: `gh api repos/DanFashauer/SignalGrid-Review-Hub/pulls/<n> --jq "[.mergeable_state,.head.sha]"` shows clean; the "Typecheck, build, and proof scaffold" check-run on the new head is success; unresolved threads 0; the lane mail asking for the DR-037 landing is on mainline.

**Step 5. Prepare the Mac-headed OWNER PRs so each is one click for the owner**

```bash
Fix first, no owner answer needed: #1224 (upheld MEDIUM), #1357 (body untruthful), #1433 (6 threads), then refresh conflicted #1228, #1247, #1422.
Only after the owner says yes: refresh #1037, #1118 then #1121 (stacked), #1246, #1417, #1322.
Already one click, touch nothing: #1219, #1251, #1255; #1220 only after #1440 merges.
```

Done when: mergeable_state clean and gating success on the new head for each PR touched; a one-line PR comment "ready for the owner: <what he is deciding>".

**Step 6. Refresh cloud-worker PRs the brain can handle (claim first)**

```bash
Claim by lane mail before pushing to any claude/* head (one lane per branch at a time; docs/LANE_COORDINATION.md).
NEEDS_WORK: #1230, #1390, #1398, #1190, #1133 (re-check its tier after), #1611 stays draft until its refute passes.
OWNER conflicted, after the owner approves in principle: #1215, #1222, #1280, #1309, #1314, #1320, #1330, #1338, #1442, #1459, #1463; #1431 fix the 2 Codex P2 threads.
```

Done when: Each refreshed PR: mergeable_state clean, gating success on its new head, threads 0, a lane mail naming the head for the cloud inspection.

**Step 7. Issues**

```bash
#1165: on the Mac, gh run view 39954968059 --log-failed (real gh CLI) or the Actions UI; find the CRITICAL CVE with a fix in the api image; bump the base layer or dependency; PR; the cloud lands it under DR-037.
#338: build the live-posture flag the issue names (the macOS posture environment variable, set to live; a proposed flag, nothing reads it yet) and a live-posture reader in lib/integrations/src/integrations/macos-posture; force an unreadable probe and show assurance rises; lib/ means the owner merges unless DR-061 is accepted.
#1546: post progress on this plan there; keep open.
#1597: pnpm run hands; pnpm run hand:clear -- <id> "<what unblocked it>" for each hand this plan clears; never close the issue.
```

Done when: #1165: the next scheduled-verification run is green (only then may it close). #338: a Decision Envelope carrying source: signalgrid-mcp. #1597: its "N open" count falls.

**Step 8. Dependabot, after the owner's policy answer (OD04)**

```bash
Per his answer: comment "@dependabot recreate" on accepted majors, or "@dependabot ignore this major version" on rejected ones and close; fix #1562's failing checks and 2 threads if he keeps the group.
```

Done when: Every dependabot PR is merged by the owner, closed with an ignore, or has a green gating run waiting on him.

**Step 9. Delete owner-abandoned branches (archive tag first)**

```bash
Only after the owner answers OD groups G1..G5 in his own words: uncomment the approved lines in docs/agent/estate-20261023/owner-abandon-candidates.txt.
bash docs/agent/estate-20261023/archive-delete-owner-approved.sh docs/agent/estate-20261023/owner-abandon-candidates.txt "owner: <quote> <UTC>"           # dry run
bash docs/agent/estate-20261023/archive-delete-owner-approved.sh docs/agent/estate-20261023/owner-abandon-candidates.txt "owner: <quote> <UTC>" --apply
```

Done when: Each approved branch: ls-remote exit code 2 and refs/tags/archive/<branch> at the measured tip; the script prints skipped=0.

**Step 10. Close out**

```bash
git ls-remote --heads origin | wc -l
pnpm run lane:deliver heartbeat <routine-id> "acted: estate plan steps done <list>"
pnpm run hand:raise -- --doing "estate plan step <n>" --blocked "<what>" --need "<exact ask>" --who owner   # for anything stuck
```

Done when: Remaining branches are only: SignalGrid_Alpha, lane/mailbox, open-PR heads, live mac/build-row-* claims, and in-flight branches awaiting their PR. Anything else has a raised hand naming who decides.

## 7. The cloud's step-in at 2026-10-24T01:24:00Z

Step in only if, at 01:24Z, no "ESTATE PLAN 20261023: brain started" mail is on mainline (pnpm run lane:inbox) or a step's done-check still fails and no Mac claim covers it. Do only the steps whose done-check fails; every step is idempotent.

1. **Zero-loss deletions.** bash docs/agent/estate-20261023/delete-zero-loss-verified.sh, then --apply (same checks; 10 branches). If the cloud harness refuses git push --delete, do not work around it: the Branch prune workflow refuses too (every branch is protected=true via the Default ruleset). Raise a hand to the owner naming the 10 and OD01/OD02.
2. **DR-037 landings, one at a time.** #1585 first, then #1586 (mainline merged in, coverage page regenerated, the Mac mailed because it edits scripts/mac/*). Each only when, on the CURRENT head: an Opus landing refute says SHIP (none exists yet for 93288d4c or 6d116760); the gating check-run is success (measured 120228729764 and 120212588268; a new head means a new id); preflight and verify:breadth passed locally on the branch before the push and are quoted; every thread resolved and bot findings answered; not conflicted; body says "merged under DR-037" with the check-run id; never approve. A Mac PR from step 4 lands only when the Mac asked in mail. #1639 and #1640 (opened after triage, the cloud's own) follow the same conditions and the lane-mail protocol.
3. **Close verified CLOSE candidates.** #1336, #1509, #1510, #1511: re-check still open and head sha unchanged, comment with the superseding evidence, close. Not #1569 (the Mac must confirm the 2026-10-17 evidence record first). #1638 is already merged; nothing to do.
4. **Then its own work.** #1165 CVE fix; refresh its own NEEDS_WORK PRs the brain did not claim; open PRs for the 4 in-flight cloud branches.

The cloud never:

- Merge any of the 48 OWNER PRs, or anything touching the launch profile, the launch-claims gate, the publication boundary, docs/DECISION_RECORDS.md, OWNER_RESERVED paths or the lib/ decision core.
- Approve any PR.
- Delete any of the 136 unmerged branches, or claude/land-mac-1248, without the owner's recorded abandonment.
- Delete lane/mailbox, a mac/build-row-* claim, a dependabot/* branch or any open-PR head.
- Merge a dependabot PR before the owner's policy answer.
- Land a Mac PR the Mac has not asked for in mail; push to a branch the Mac has claimed.
- Force-push, rewrite history, or bypass a check.
- Close #1597, #1546, #338, #141 or #136; close #1165 before a green scheduled run.

## Input caveats

- Mainline tips differ across inputs: docs/agent/estate-20261023/branches.json and the unmerged list used 2a46fd16; the verifier used 9ce88fa0; triage files 2a46fd16/4057f56b/055fb2a0/9ce88fa0. Live mainline at 2026-10-23T23:35:33Z was 9ce88fa0. Each later tip only added a heartbeat or lane-mail commit per the triage notes.
- The read-only checkout is a shallow clone: ancestor and cherry "=" results are reliable, refusals are conservative.
- The verifier's caveat "open PR heads fell from 79 to 30; 51 closed or merged" is WRONG. Its collector built pulls?state=open?per_page=100 (two question marks), so GitHub returned its default page of 30. A live GET at 2026-10-23T23:35:33Z found 80 open: 78 of the 79 triaged (#1638 merged 23:22:27Z) plus #1639 and #1640. Re-checked against all 80: none of the 11 deletion candidates is an open-PR head.
- Live branch list at 2026-10-23T23:41:04Z: 229 including mainline; since 23:05Z one branch went (lane/cloud-mail-20261023-225852Z, auto-deleted on merge; delete_branch_on_merge is true), two arrived (#1639, #1640 heads); no measured tip moved; the 10 zero-loss tips are unchanged.
- PR history per unmerged branch (closed / merged / none) is a live GET taken while writing this plan, not one of the listed inputs; it only informs the proposed call.
- All 229 branches report protected=true because of the Default ruleset (copilot_code_review on every branch). It has no deletion rule, so git push --delete is not blocked by GitHub, but scripts/prune-merged-branches.mjs (the Branch prune workflow) refuses any protected branch, so that automated route refuses everything until OD02 is answered.
- DR-037 itself says a lane "does not ... delete branches"; this plan relies on the owner's 2026-10-23 directive for the zero-loss deletions and asks him to record it (OD01). CLAUDE.md also lists branch deletion under "Ask before".
- Unknown: the CVE id behind #1165 (the job log was not readable through the API); whether #1562 fixes it; Codex never reviewed the two LAND heads (usage limit), so the landing refute is the only independent review.
- #1639 and #1640 are not triaged by any input; they are listed, not classified.
- This plan and its two scripts live in the cloud session scratchpad. They reach the Mac only when the orchestrator delivers them (lane mail or a PR).

Helper files (written, not executed): `docs/agent/estate-20261023/delete-zero-loss-verified.sh`, `docs/agent/estate-20261023/archive-delete-owner-approved.sh`, `docs/agent/estate-20261023/owner-abandon-candidates.txt`. Do not run: `docs/agent/estate-20261023/delete-zero-loss.sh (includes the refuted claude/land-mac-1248)`.
