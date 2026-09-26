# LOOP - where SignalGrid actually is

**Read this first, in any tool. Update it last, before you close anything.**

One page. If it grows past one page, it has stopped working.

---

## The loop

```
START  ->  read this file (2 min)
          run `pnpm run loop:state`      <- catches what fell between tools
          v
WORK   ->  one task, in one tool
          v
END    ->  update the four lines below (3 min)
          push, and confirm it landed
```

Ten minutes a week keeps this alive. Skipping the END step is how a week
disappears - that is exactly how Phase 0 sat unpushed while every tool
individually reported success.

---

## Which tool for what

| Tool | Use it for | Do not use it for |
| --- | --- | --- |
| **Chat** | Thinking, strategy, research, reviewing evidence, arguing back | Editing the repo |
| **Claude Code** | Patches, gates, tests, anything touching files | Deciding what to build |
| **Cowork** | Documents, discovery notes, spreadsheets, non-repo work | Code |

**The rule that matters:** the tool that *decides* is never the tool that
*builds*. Decisions come from the owner or from a chat session; Claude Code
executes them. That separation is what stopped the freeze dying quietly when a
well-argued networking proposal arrived.

**A plain chat window has no repo checkout.** If a session cannot find this
file, it is not lost - clone the repo, or attach it.
Plain chat sessions have no repo checkout — attach LOOP.md to the chat or
clone `SignalGrid_Alpha`; `git pull` is not available there.

---

## STATE - update these four lines every session

```
PHASE:        Build / execution (past Customer Discovery, DR-033 2026-09-10).
              Engineering UNFROZEN (DR-021); absorption mode - owner feeds
              resources, the repo absorbs them. Discovery is an input, not the
              gate. Claim discipline unchanged. Near-term: a working core product
              that does what it claims, real in hand for partners before GTM.
LAST TOUCHED: 2026-09-26 (cloud lane, 02:35Z) - THE LOOP NOW REFUSES STALE ROWS AND MAILED THE CLOUD ITS QUEUE; A CI GATE HAD RUN UNAUTHENTICATED SINCE IT WAS WIRED.
              #1087 (ebf302b9, DR-037): an open plan row is ranked only while it carries a `re-measured YYYY-MM-DD` stamp
              at most `14` days old (`rowMeasuredAt` in scripts/objective-loop.mjs, quoted/code spans stripped); a refused
              row lands in the state's `unmeasured[]` with its reason and ONE `plan-rows-unmeasured` escalation names every
              id for the cloud; --check REPORTS the count rather than failing (`108` of `109` open rows were unstamped on
              landing day - a fatal gate would have been switched off the same hour). Self-test `77/77`. Three minutes
              after it landed the tick re-derived (#1089: tasks [12], unmeasured `108`) and mailed the cloud - the
              loop-to-cloud edge works end to end; the ack (#1090) commits the lane to measuring the rows in document
              order, one tranche per PR, starting 17/18/19, closing finished work and restamping only what was measured.
              #1088 (85daff21, DR-037): a mail PR's red gating run exposed that check-ci-liveness had called GitHub
              UNAUTHENTICATED on every CI run since it was wired (`limit=60`, the per-address budget) - Actions never
              exports GITHUB_TOKEN and no step handed it over; its header said "CI always has a token". Fixed both halves:
              the token env on every preflight-running step (review-hub-ci, both Mac workflows - the PR's own Mac run
              failed at the new check first, proving the second site) and `tokenProblem` making an absent token FATAL in CI.
              Lesson: two queued preflight waiters deadlocked because each one's `pgrep -f` pattern matched the OTHER
              waiter's command line; one sequential chain replaced them. Records #1085 (b36de43f), this one; steward
              #1086 (33c3640b). Owner owes: #1050 (DR-058), #1083 (DR-059, its test:api/preflight/breadth lines now in
              the body), the row-8 doctrine hand, #1037's CodeQL call; the Copilot scanner's model setting.
PREVIOUSLY:   2026-09-26 (cloud lane, 01:25Z) - SIX OF SIX RANKED ROWS WERE STALE; THE TIER LINE IS REAL; DR-059 IS THE OWNER'S CALL.
              Rows 11, 12, 14 measured before building (#1081, 79db279f): 11 shipped by 2026-09-06 (determinism scope
              derived from lib/, lib/location dispositioned KEPT as deferred), 14 shipped 2026-09-20 (#863's refusal-
              coverage gate IS the status-code arm), both read open for weeks - six of the loop's last six ranked rows
              were finished work, so the staleness stamp + loop refusal (BUILD_BACKLOG 2026-09-25) is now the highest-
              value gate on the loop's input. Row 12 stays open with its gate half landed (#1082, e8ad6d02): the Tier-1
              read-list is data (docs/agent/review-tiers.json), check-review-coverage prints and ratchets it - first run
              `Tier 1: 19/25 at depth >= audited (mark 19) - 10 stale, 1 below depth, 5 with no row` - and ledger rows
              may carry a checked sha. Then the product change the row-8 audit demanded: #1083 (a98d2013) is the DR-059
              PROPOSAL, the OWNER's merge - posture freshness re-derived at decision time worst-wins with the stamped
              value (`buildEvidence` takes the decision instant), a refresh RETRACTS every fact or device the source
              stopped reporting (value null, read as unknown), an empty refresh is partial/degraded; estate-refresh proof
              `24/24` with controls, core `597/597`, cascade `100/100`, simulator `102/102`, CORE_NORMALIZATION 25.
              Steward: heartbeat #1080 (1cb79caf; a first merge call carried a fabricated full sha and the API refused it -
              the head is re-read from the PR, never assembled). Records #1079 (03a26339), this one. Owner owes: #1050
              (DR-058), #1083 (DR-059), the row-8 doctrine hand, #1037's CodeQL call; the Copilot scanner's model setting.
PREVIOUSLY:   2026-09-26 (cloud lane, 00:20Z) - THE LOOP'S TOP FOUR ROWS WERE FINISHED WORK; ROW 8 IS NOW AN AUDIT WITH FINDINGS.
              Before building the next ranked row the lane measured it, as with row 5: rows 6 and 9 had shipped
              2026-08-20..22 (#253 / 905c243c; #219-#221) and read open for a month; row 8 was read 2026-08-23 but six
              of nine files sat at depth read. #1074 (91d9556e) re-measured all three (6 and 9 DONE with checks named,
              8 kept OPEN because the loop ranks open rows only) and added the consequence to BUILD_BACKLOG: open
              rows need a re-measured stamp and the loop should refuse to rank a stale one. Then the row 8 unit:
              verdict-core-reader (Opus, read-only) re-read engine/decision/policy/resolution/compose/adapters at depth
              audited on 8fdc143c; the lane re-ran every reproduction before recording; #1077 (9cadddaa) carries the
              ledger rows, row 8 DONE, five backlog rows and ONE OWNER HAND. Real findings: (1) estate posture freshness
              never ages between syncs - `buildEvidence` in lib/signalgrid-core/src/decision.ts gets no clock, so a
              record read fresh then aged `40` days with no refresh decides as fresh (v2: step_up with no stale code where
              a 40-day-old read restricts POSTURE_STALE_STRICT; with encrypted/osSupported it stays allow) - reachable
              on /v1 estate mode, refresh loop off by default; (2) a refresh never retracts - a fact omitted or a device
              dropped keeps the old affirmative and `[]` is a healthy success; both HIGH, DR-051 proposal next. Latent:
              `fromDevicePosture` grants on out-of-domain input (no caller); the malformed-rule skip is fail-closed only
              for allow rules. Owner hand: v1 stays silent on an emitted unreadable reading in the deferred dock/custody
              families where DR-043 fields step up - doctrine, not code. Records #1072 (24708b33), this one. Steward:
              ticks #1073 (8b6ded4e) and #1076 (3d52d8f3) landed, heartbeat #1075 (8fdc143c). Every PR today carried a
              red Copilot "AI findings" row: its job log now says `400 The requested model is not supported` - a
              GitHub-side scanner model setting, the owner's to change, never this tree's. #1050 still the owner's merge.
PREVIOUSLY:   2026-09-25 (cloud lane, 23:00Z) - ONE BUILT, ONE TICK LEAK CLOSED, ROW 5 RE-MEASURED; OWNER OWES ONE MERGE.
              Built and landed under DR-037 (SAFETY_MACHINERY): #1071 (a3bd808b) - scripts/check-shell-backend-paths.mjs
              GATES that every path EnterpriseShell's BackendService.swift builds (4) is declared in lib/api-spec/v1-openapi.yaml
              (62); the legacy OIDC api/auth/* sites are REPORTED; self-test 9/9 with the real tree as positive control;
              preflight + CI rows after "iOS restriction defaults". COMPANY_BUILD_PLAN row 5 had said the shell "calls five
              endpoints that exist nowhere" since 2026-09-02's port - re-measured DONE (port) + PINNED (gate). CodeQL caught
              a stat-then-read in the walker on the first head (js/file-system-race, high) - fixed in c4c5981a before merge.
              Also under DR-037: #1069 (28379161) - run-requests.mjs treats a result already on an unlanded mac/tick-* branch
              as AWAITING LANDING and never re-runs it (the tick had re-run the evidence operation on four consecutive
              ticks while the cloud landed the first; `self-test passed (7/7)`, a preflight row and a CI step). Steward: #1067 (a07c9e96,
              re-derived shared state: readiness 100, queue empty), #1070 (e171c0a5, heartbeat + a send asking the Mac
              to pull before its next tick and to look at the 20:50Z failed evidence run), #1063/#1064 closed superseded.
              #1050 (Puck 6, DR-058 proposal) at 331c6558: gating 108244715123 green, local preflight + breadth exit 0,
              body updated - the OWNER's merge is the one thing owed on the product side. Next bounded build comes from
              the loop's ranking (rows 6 public-site rewrite / 8 verdict-core read / 9 grant-safety enumeration), scoped first.
PREVIOUSLY:   2026-09-25 (cloud lane, 21:05Z) - READINESS 100% ON MAINLINE; THE LOOP CLOSED ITS OWN GAP.
              The DR-056 loop queued the evidence request (#1052), the Mac tick ran it unattended (19:39Z tick), and
              the cloud landed the result as #1061 (f248aece): mac-run.json re-minted 19:59Z with --vm-native-build
              against manifest 7c15496c; `node scripts/check-readiness-figure.mjs` on mainline reads (b) 20/20,
              launch items 28/28, HEADLINE 100% -> OUTREACH OPEN (DR-036 goal). #1060 (same request, older mint)
              closed superseded. Also landed under DR-037: #1062 (e3732b51) - the executor gap is an auto hand
              (needsExecutor rows standing 48h in a witnessed objective state raise ONE aggregated hand routed to
              the blocker-dispatcher; raised-hands self-test 53/53). #1050 (Puck 6, DR-058 proposal) refreshed on
              mainline (331c6558, local gates green) - the OWNER's merge. Both tick PRs went red on the coverage
              page because launchd ran the pre-#1057 lane-tick.sh from an unpulled checkout; the Mac is asked to
              pull, nothing else is owed. Record PRs #1059 (dcc47044) and this one; mail #1058 #1056 and the 21:02Z batch.
PREVIOUSLY:   2026-09-25 (cloud lane, 19:30Z) - DR-056 FOLLOW-UP LANDED; THE LOOP'S OWN REQUEST IS ON MAINLINE.
              Landed under DR-037 as SAFETY_MACHINERY: #1057 (55490bee) - objective-loop --check and --self-test are
              preflight + CI gates (rows after the raised-hands self-test), docs/agent/objective.json is owner-gated
              (objective-state.json deliberately not: the tick rewrites it), and lane-tick.sh now stages the new
              files BEFORE deriving the coverage page - the page counts TRACKED files, so the first tick that queued a
              sim request (#1052) committed a page derived without it and went red on the coverage gate. Steward
              landings: Mac tick #1054 (335bb282; mainline objective-state now reads readiness `25` / escalate, which is
              TRUE - the manifest moved to 7c15496c with #1019 and #1051 and the two Linux-only steps wait on the
              DR-057 re-mint with --vm-native-build) and #1052 (5474868a; Alpha merged in, objective-state kept from
              #1054, page re-derived) so objective-loop-evidence-fresh-2026-09-25 reached the tick - and as of 2026-09-25 20:00Z
              it RAN: result passed, mac-run.json re-minted 19:59Z against 7c15496c (#1061), readiness on that tree
              reads 20/20 and HEADLINE 100% - the cloud lands #1061 with the coverage page re-derived. Mail #1056 #1058.
              Not this lane's failures, each commented once: the Copilot "AI findings" scanner crashed in its own
              loop on every head today; #1052's Mac-only job failed CI-liveness while the sweep was green (run 84)
              and passed on the single re-run. Main checkout repaired (was 171 behind with a no-TTY install abort).
PREVIOUSLY:   2026-09-25 (cloud lane, 18:00Z) - "KEEP BUILDING": TWO BUILT, FOUR LANDED, THE BATCH IS CLOSED.
              Owner said "Keep building" (14:5xZ). Built: #1048 MAM (user, device, app) binding (LANDED 9602069a under
              DR-037 - the connector refuses an unbound or borrowed registration before it can grant; proof 116/116,
              mutation-guard survivors=0) and #1050 Puck 6 as the DR-058 PROPOSAL (owner merges: a holder-bound
              device_returned closes custody without CUSTODY_REMOVED, unauthorized release is torn, every unbound
              return keeps custody open; cascade proof `matrixRows=28`, `119/119`; core census 16/9; CORE_NORMALIZATION 25).
              Landed for the Mac: #1031 DR-056 objective loop (832c9224; the forward-build trigger now READS
              objective-state.json tasks[0..2] under the heartbeat witness rule instead of choosing by judgment) and
              #1019 DR-054 raise-your-hand (19b4dfb7, the last of the owner batch - the Mac did the merge step the
              cloud sandbox refused; #1011 merged through it, #1014 closed superseded). Mail: #1049 #1053; steward
              heartbeats #1041-#1047; hygiene #1044 freed 1.4G. Readiness 95% (Mac re-mint f5d4ceaa), OUTREACH OPEN;
              #1051 (DR-057 native-build attestation, the last 5%) refreshed on mainline 14649a0b and in preflight,
              lands under DR-037 when green; #1037 waits on the CodeQL call (owner dismiss or Mac paths-ignore).
              Lesson recorded: `lane:deliver send` takes POSITIONAL subject/body; a queued wait loop whose own command
              line contains the pgrep pattern never exits (two queued preflights never started until run directly).
PREVIOUSLY:   2026-09-25 (Mac lane, latest, 16:30Z) - THE 5% GAP IS CLOSED ON A BRANCH: PR #1051 (DR-057).
              The Mac's amd64 Linux VM now runs the two Linux-only preflight steps (build + Browser E2E) and
              verify-all records them ONLY from an attestation bound to this tree (HEAD sha, clean at launch
              AND at mint, registered names; else nothing) - scripts/lib/native-build-attestation.mjs, 15/15,
              in preflight + CI. First --vm-native-build mint on f2d1a459: VM 53 passed, both steps attested,
              stepsNotRun [], readiness (b) 20/20, HEADLINE 100% -> OUTREACH OPEN. The minted file is NOT on
              the branch (a squash would orphan its sha); mainline still reads 95% until #1051 lands and the
              Mac re-mints there (the `evidence` operation now carries the flag, so the DR-056 loop does it
              unasked). Cloud mailed af62b23. Backlog row closed with quoted output. Three full preflights
              were needed: two figure ledgers moved (claim-inventory citation, surface coverage) and were
              regenerated by their own writers; the first two runs died on a sandbox artifact (pgrep). Nothing
              waits on the owner. NEXT: cloud lands #1019 -> #1031 -> #1037 -> #1051 (any order); Mac
              re-mints on mainline; then the intake DR (number read from the tail) and the objective-loop
              self-test registration. 17:10Z: #1031 LANDED (DR-056 on mainline, the loop is live in the
              tick); the #1019 MERGE STEP the cloud's sandbox refused is done here - nine conflict files,
              not four, resolved and pushed as merge 820521f1 on claude/raise-your-hand, doc/registry gates
              green, cloud mailed; DR-057 claimed for #1051 (Puck 6 takes DR-058).
              PREVIOUSLY: 2026-09-25 (Mac lane) - "SEEMS LIKE THERE ARE DELAYS": ROOT CAUSES, AND NONE ON THE OWNER.
              Cloud landed 11 PRs in 24h. What looked delayed: (1) readiness read 0% because #686 moved the
              manifest (7c15496c) and the evidence had to be re-minted on the Mac; the cloud's request sat 12h
              UNREAD here - its subject was mangled ('--to') and I dismissed the heartbeat's unread=1 as my own
              mail (memory saved: unread>0 is a blocking read). Re-minted 15:21Z: preflight/breadth/mcp PASS,
              committed f5d4ceaa, readiness 0% -> 95% (OUTREACH OPEN). (2) The last three PRs went CONFLICTING
              behind the batch: #1031 and #1037 (mine) refreshed by merge-commit with union resolution, gates
              green, MERGEABLE; #1019's four conflict files named to the cloud with the recipe. (3) This clone
              fetched only SignalGrid_Alpha (stale remote refs all week) - refspec widened. THE 5% GAP is
              structural: Browser E2E is excluded on a non-linux-x64 Mac (verify-all stepsNotRun) - filed as a
              HIGH Mac backlog row (run it inside the Apple-container Linux VM); the objective loop's
              evidence-fresh criterion stays strict, so it keeps queuing `evidence` until that lands - the honest
              signal. Nothing waits on the owner: the DR-056 attestation gates no merge and no work. NEXT: cloud
              lands #1019 -> #1031 -> #1037 (any order); Mac builds the E2E-in-VM step; then the intake DR.
              PREVIOUSLY: 2026-09-25 (cloud lane, 03:20Z) - OWNER BATCH LANDED on the owner's 2026-09-24 direction ("Just get it done").
              In PMO order, each rebuilt on the previous landing, local preflight + verify:breadth quoted in the PR body,
              gating run green on the exact head, merged with the full head sha: #1024 0fd151a2, #1026 8137f402,
              #905 7c11ad86, #1005 a96ef30a, #929 1d764be8 (with the review round applied first: off-enum MAM states
              raise POLICY_STATE_UNKNOWN/COMPLIANCE_UNKNOWN instead of leaning on the backstop; unreadable app
              sensitivity fails toward sensitive), #686 77f4cf7e (five Codex threads verified, fixed, answered, resolved;
              readiness (b) now the lower of proof-current and item-current ratios, step: bindings digest-bound,
              98-binding ratchet). #686 was the last manifest mover: ONE Mac re-mint requested in PR #1039 against
              fingerprint 7c15496c; (b) reads 0/20 proofs, 0/28 items until it lands, by design. NOT landed: #1019
              (raise-your-hand) - the sandbox refused the local merge of mainline into its worktree (classifier:
              "Merge Without Review"); it needs an owner or Mac hand, no workaround attempted. #1031 awaits the
              Mac's B1/B2 fixes; #1037 awaits the Mac's CodeQL call. Previous entry (Mac, 2026-09-24 evening) follows.
PREVIOUS:     2026-09-24 (Mac lane, evening) - TWO OWNER RESOURCES ABSORBED: PR #1037; #1031 REVIEWED.
              Owner shared Leonxlnx/unlazy and vercel-labs/skills ("incorporate these into the brain"). Each
              resource self-scanned the tree (worktree-isolated agents), four roster lenses confirmed/amended/
              rejected, the PM lens ranked; everything measured in the sandbox with no keys. unlazy @ 16671491:
              ADOPTED, non-executing half only - third_party/unlazy/ (7 files byte-identical at the pin,
              VENDORED.md with a 21-row Overrides table), and the doctrine as +28 lines in
              orchestrator-over-workers (worker spec = a lintable leaf ledger; the orchestrator re-runs every
              CHECK: itself and quotes output; inherited ledgers are read, never run; ABANDON: = handoff). Its
              CHECK: executor, Stop hook and installer were measured to work and REFUSED on principle (an
              in-tree command runner the deny hook cannot see; intake rule 3). vercel-labs/skills @ 7407f389:
              evaluated, not adopted (unpinned fetch-and-install, opt-out telemetry, -g installs escape every
              git-ls-files gate) - and the refusal is now ENFORCED: two new deny tokens in the Bash hook
              (self-tested; they blocked my own commit command minutes later) plus seven refuse-only
              Overrides rows for nvidia-skill-finder; the conflicts gate went red without the rows, green
              with them. Preflight PASSED. Records: two RESOURCE_INTAKE rows, five BUILD_BACKLOG rows incl.
              the decision record to append AFTER #1019/#1031 land (numbers live there). Also today: #1031's
              four-lens adversarial review folded (token unquoted from the DR, delivery stamp, outstanding-only
              requests, heartbeat-witnessed freshness), the cloud's "one plan" mail answered item by item with
              its cloud-owned pieces named on the PR, #905 content finished and handed off, and the review-agent
              checkout-mutation incident cleaned and its rule saved. NEXT: cloud lands #1019 -> #1031 -> #1037
              (any order; all appends), then the pending DR for the intake; the owner's one open decision
              remains the DR-056 attestation.
              PREVIOUSLY 2026-09-24 (Mac lane) - THE OWNER'S AGENTIC LOOP IS BUILT: PR #1031 (DR-056).
              Owner shared the "Agentic AI system" diagram (Objective -> Orchestration -> Agents/Workflows ->
              Evaluate -> Replan over ONE shared task state) and directed it as the brain's operating model.
              Mapped box by box by 7 verified readers; 3 designs judged by 3 lenses; winner critiqued by 2
              adversaries (every fix taken); then a 4-lens review of the diff (4 findings confirmed, all fixed).
              Built: docs/agent/objective.json (DR-033 as four criteria; ids/scopes/attestation token live in
              scripts/** so the json cannot reach goal_met alone), scripts/objective-loop.mjs (pure evaluate/
              rank/finalize/readVerdict; content-addressed state; refuses to queue what the tick cannot run;
              one mail per NEW escalation; three-state --check; 62/62 self-test incl. a clock-scan of its own
              source), docs/agent/objective-state.json (first verdict ESCALATE: 3/4 met, owner-real-in-hand is
              the owner's; tasks = plan rows 5/6/8; ten plan rows still need an executor), step c' in the Mac tick (lock,
              SIGNALGRID_MCP_PATH from the sibling checkout, transactional rollback, verdict in the heartbeat),
              forward-build-cycle made the consumer (trusts the state only while the tick heartbeat is fresh AND
              names the verdict). Preflight PASSED, breadth 57/57. EXPECTED until #1031 merges: the live tick
              heartbeats "objective: BROKEN" (it runs this branch's lane-tick.sh from the sibling worktree where
              the script does not exist yet). Also this session: #905 content finished (cloud-directed, fefddc05,
              hands off), mac-run.json re-minted (readiness 100%), 16 PRs triaged (cloud's PMO plan answered:
              #686 stays, #929 revived, cloud lands the green batch), 9 tick branches + the superseded #753
              rebuild deleted. INCIDENT: review-verifier agents staged fake ticks inside the shared checkout
              (stray branches, a reverted file, a symlink) - stopped, cleaned, rule saved: any agent that may run
              git or the tick gets worktree isolation. NEXT: cloud lands #1031 before #1019 (or rebases #1019);
              then register `objective-loop --self-test --check` in preflight+CI in one PR; the owner's one open
              decision is the attestation (a decision record carrying the token), never a priority question.
              PREVIOUSLY 2026-09-23 (Mac lane) - DEFERRED QUEUE CLEARED + EVIDENCE RE-MINT + #753 RESOLVED.
              Four deferred items shipped as PRs: #1016 (esbuild 0.27->0.28), #1017 (iOS accessibility
              evidence), #1018 (brain-cycle stale-input guard, DR-032), #1021 (first report-only
              `claude plugin eval` case for video-intake - doctrine WITH 1.000 / W-OUT 0.333, delta +0.667:
              the skill measurably refuses transcript-as-figure pressure; adopted as a REPORT, off preflight).
              Re-minted artifacts/live-evidence/mac-run.json (d0ed0362, both halves green) - readiness back to
              100% on all three dimensions. The first attempt correctly REFUSED on a local esbuild node_modules
              drift (0.28.2 leftover from #1016) vs mainline's 0.27.3 lockfile; `pnpm install --frozen-lockfile`
              fixed it - not a mainline red. Acked all 7 cloud messages (9098a6e). #753: rebuilt the Alpha
              merge (core-type conflicts resolved by author judgment, typecheck 0, proof 562/562, preflight
              green, bbd64848) BEFORE the STOP arrived - it landed on Alpha after my last pull. Owner had
              CLOSED #753; #1005 (claude/build-dr043-live-attach-rules) supersedes it. Acked; bbd64848 is
              INERT (its PR is closed) and offered for deletion. Pruned 9 superseded tick branches (kept
              mac/tick-20260921T140443Z). PREVIOUSLY 2026-09-23 (cloud lane) - "GET EVERYONE IN LINE": QUEUE CLEARED, TWO ROOT CAUSES FOUND.
              Owner-directed sweep. Landed: #975 override-parity gate, #977 loop-state date warn, #989 iOS
              allowlist fail-closed (owner authorized the lane to land these three), #996 (Mac tick heartbeat
              passes --no-wake: it is a staleness record and never carries cloud mail, so it no longer wakes
              the cloud session every quiet tick - verified: no tick wake since it merged), #999 (grid proof
              phone-number safety pattern now needs a standalone number; the unbounded form matched digits
              inside the hex determinism hash on about 18% of scenario sets, a random red CI - owner chose
              "tighten, exempt nothing"; both directions self-tested and falsified), plus steward mail.
              Closed: seven Dependabot majors, stale #354, #826 (spec-kit - superseded by #997's one-checkpoint
              hybrid), #821 (owner decision: it was stacked on #820, which the owner closed on 2026-09-21).
              Rebuilt against mainline: #905 (its DR-052 collided with mainline's; now DR-053).
              ROOT CAUSE 1: the session-start hook clears dist/, and no cloud procedure rebuilt it, so every
              local preflight stopped at the mcp-server proof AND a local status-summary --write stamped a
              false "Verdict: RED" that broke a README claim anchor. `pnpm --filter @workspace/api-server run
              build` first fixes both; with it, preflight and breadth passed locally end to end.
              ROOT CAUSE 2: the steward's mail check read docs/agent/lane-mailbox.json (the wake-PR pointer),
              not the messages; four Mac messages sat unread 15-26h while cycles reported none. Read mail with
              `pnpm run lane:inbox` / scripts/check-lane-messages.mjs on an Alpha checkout. All acked (#1000).
              FINDING: the DR-043 attach matrix (puckVerdict et al. in lib/signalgrid-core/src/attach.ts) is
              called only by the decision-cascade proof - the live /v1 policy path cannot see attach, enrollment
              or read method. #753's re-cut is being built to wire three rows in with mainline's vocabulary,
              minus #753's two loosening defects (presence-gone -> allow; inverted enrollment domain).
              PREVIOUSLY (2026-09-21, cloud lane): THE CONSOLE FAIL-CLOSED GATE, THREE CODEX ROUNDS.
              check-console-unknown-render (the G2 unknown-as-good-state gate the 2026-09-02 console
              batch left spec-only) landed as #953 (squash 59f04e4b) under DR-037 (SAFETY_MACHINERY;
              owner confirmed self-merge of a self-authored gate is the standing rule). It is an AST
              data-flow gate (first script on the TypeScript compiler API) with a per-branch boolean
              guard model: dataPresentWhen/dataAbsentWhen/flagFalseWhen read &&/|| per branch, `!isError`
              is never proof of data (pending), and the react-query `loading?_:error?_:content` success
              pattern is recognised by ruling out both flags. Twenty-five Codex findings across three
              adversarial rounds, every one verified firsthand and either fixed with a plant->red
              self-test or deferred as a documented under-flag (cross-component provenance, const-class).
              Zero on the tree; self-test proves it can fail (BUG/ABSENT-CLASS/NEG-ERROR/USEQUERIES/
              PENDING/COMPOUND/FRAGMENT/ALIAS/ARIA/NO-REASON flag; OK/OK-GUARDS/NEGATIVE/CHILD-PROP/
              REASON/NON-QUERY clean; PLANT on real SignalSourcing.tsx). Same cycle: #954 steward
              heartbeat merged (37757d7c); #956 (a re-mint lane mail) WITHDRAWN as redundant after
              Codex showed the request is pending and the unattended tick re-mints it, and that the
              provenance mismatch is a mid-run tree/clock change, not enqueue-time sampling; #952 (Mac
              tick sim-results) HELD - provenance.commit 0e2d370f (manifest 998718c8) cannot reproduce
              the attested 6cc9a0ee, Mac lane asked to re-mint from a stable checkout (thread open).
              2026-09-20 10:50Z entry follows.
              10:50Z addendum: the landing record landed as #911 (bac640b5) after three Codex rounds
              (eleven findings, all verified and fixed); the loop:state seam fix landed as #917
              (f7f6a64e): a squash of a merge tree now clears by exact hunks (verbatim patch-id,
              re-applied to the squash's parent), a same-named branch is compared by sha against
              the Hub tip, and the seam has an 8-shape self-test in preflight and CI - the two
              branches the stop hook had named every turn since #860/#900 now clear. #905 (DR-052)
              is green, thread-free and waits on the OWNER's merge (publication-boundary file).
              Codex hit its review usage limit at 09:33Z; later PRs today had no Codex pass.
              08:00Z entry follows.
              The owner: "Merge the eight open PRs … you don't have to wait for me you can do this
              yourself." Done on that direction, under DR-037 WITH FIVE RECORDED EXCEPTIONS (condition 2 on
              #863: local pass after the push; the OWNER-GATED clause on #854, #869, #864, #866: launch-
              profile or publication-boundary files in the merged diff, merged by this session with the
              owner's credential - found by Codex on #911, verified, owner decisions still owed a decision
              record; see EVIDENCE), in this order, each merged with its
              head's full sha after the gating run on THAT head: #854 21221b1a (02:05Z), #869 93da3e28, #860 c7dc6610, #863 4df66f2a,
              #864 5df039f7, #866 e32bb885, #868 9018a8bc, #888 9fb4bc08 (07:39Z). Mainline merged INTO
              each branch in a scratch worktree, frozen install after the merge, manifest + coverage page
              regenerated on top of the previous landing, preflight + breadth on the merged tree on one
              shared port before the push - for SEVEN of the eight; #863's local pass came AFTER its
              push (a stale status file fired it), a DR-037 condition-2 exception recorded as such. Record with commands and output: docs/agent/EVIDENCE.md, the
              2026-09-20 entry (gating run ids, chain lines, the #863 early-push deviation, the derived
              figures each chain caught). Final manifest v82, fingerprint 6cc9a0eef68e5ca0; the ONE re-mint
              request to the Mac went AFTER the last landing (PR #910). Also landed today: #900 (video
              intake), #902/#904/#906/#907/#908/#909 (steward mail), and DR-052 (PR #905, the independent
              evaluation stage for every intake) is pushed at 2afcf8fa with two Codex rounds answered and
              its gating check running. Mac PRs #901 and #903 each carry one blocker comment from this lane
              (nine verified Codex findings); nothing was pushed to their branches. THE MAC TICK HAS BEEN
              SILENT since 02:26Z - owner escalated once at 06:25Z; readiness dimension (b) reads 0 until
              the Mac re-mints. One detector gap filed as a BUILD_BACKLOG row: loop:state reads squash-landed
              branches as unpushed (local patch-id proof, bound to the tip; no live API in the hook). A second draft row, "run-requests
              has no supersession field", was FALSE (supersededBy exists) and was struck before landing.
              PREVIOUSLY (2026-09-19 01:00Z, cloud lane): THE BACKLOG SWEEP, SIX LANES AT ONCE.
              MEASURED, not recalled (UTC, repo-scoped pulls endpoint, three pages): `29` pull requests
              merged on 2026-09-18, `49` opened, `48` open now; `33` had merged on 2026-09-17 by the
              same count (the `29` recorded below for that day was a local-day count).
              WHAT THE DAY WAS: the owner's directive ("all items cleared and backlog empty, then the
              full build") was executed as six parallel agents on six worktree branches, each owning a
              slice of docs/BUILD_BACKLOG.md, with the coordinator running every branch's
              preflight + breadth chain SERIALLY (one shared port) before any push. Result: six product
              PRs, all owner-merged under DR-037 - #860 (native iOS: coreNormalizationVersion and
              reconcileDecisions Swift mirrors, Dynamic Type row floors, adaptive Operator theme),
              #863 (five new gates over figures, provenance, api-zod wiring and both API documents;
              68 refusal findings closed in v1-openapi.yaml), #864 (cascade joins 5+6, the puck domain,
              proof:decision-cascade 92/92, 27.0 mdm.* items, Apple YAML pins held by a proof),
              #866 (PolicyDetail 0/0 no longer green, credential revoke route, tile-less facility
              graph, vendor-doc drift watcher), #868 (Redis-only step-up store, hashed session refs,
              per-caller rate limiting, empty-binding refusal, webhook input parsing, dead_letter
              terminal row, sighting freshness graded), #869 (stacked on #854: estate refresh loop,
              decision-bound step-up answer, runtime launch-status, live-image Graph proof, secrets
              seam, data lifecycle). #854 itself was refreshed with a mainline merge. Plus #858
              (intake: artemis, apple/device-management 27.0, awesome-mcp-servers by use) and four
              steward heartbeats, self-merged.
              WHAT THE GATES CAUGHT: seventeen chain failures across the six branches and NOT ONE was
              a code defect - every one was a derived figure (proof counts 148->151, route pairs,
              Bruno/Postman request counts, LAUNCH_PROFILE totals), a hand-listed collection (the
              Postman builder and the Bruno set both enumerate routes by hand; three new routes had
              neither), a classification (the revoke route unclassified in the launch profile), an
              env var instructed in a doc with no reader on that branch, a claim-inventory anchor moved
              by a file growing, a manifest not republished after a proof count moved, or a coverage
              page generated one step too early (before `git add`, or mid-merge - a conflicted index
              lists a path at three stages and the page counts all three). Each was fixed at its
              cause with the repo's own tool and re-queued at the tail; the record is in the commit
              messages. THE FINDING WORTH KEEPING: CI checks out the PR's MERGE REF. A branch that
              forked before mainline gained a file (#858's roster) carries a coverage page that is
              fresh against its own tree and stale against the merge tree - #868's gating check went
              red on exactly that, and #860/#863/#866, which CONFLICTED with mainline, had NO CI at
              all, because GitHub builds no merge ref for a conflicting PR. Every branch now carries
              mainline; the same defect is on the Mac lane's #856 and is theirs to fix.
              READINESS: 94% on mainline (dimension (a) 16/17); 100% on #864's branch, where the
              smart-charging scenario turns the last `gap` row `modeled`. Two sim requests ride #868
              and #869 to re-mint the Mac evidence after their manifest moves (v80, v81) land -
              dimension (b) will read stale for one tick after each merge, by design. The Mac tick was
              healthy all day (every hour on the hour, heartbeats on mainline); evidence 14:52Z.
              STILL OPEN, BY LANE, written into the rows: brace-less mutation ratchet (31 of 33
              families left; each survivor so far was a tsc-load-bearing guard, not a fixture);
              security roster row 82 item 2 (the `verify.ts` attestation comment); the webhook WRITE
              route (owner call: which store); the three decided deletions and Ponytail native cuts
              part 2 (Mac, Xcode); DecisionEngine/AppWorkflows re-port (backlog row five; owner call under DR-020);
              Android AMAPI (needs a rig, not Kotlin); data-lifecycle SQL against a live Postgres
              (Mac lab); the lifecycle admin job's invocation. One container restart at ~00:00Z killed
              two running chains; worktrees and commits survived, both relaunched, nothing lost.
              PREVIOUSLY (2026-09-18 08:40Z, cloud lane): THE MAC RED THAT WAS A CYCLE, AND THE GATE THAT NOW REFUSES IT.
              MEASURED, not recalled: `5` pull requests merged on 2026-09-18 so far (all lane mail) and `38` open
              (8 dependabot, 4 drafts); 2026-09-17 closed at `33` merged, not the 29 the previous entry counted at 21:20Z.
              #819's Mac column read "0 files found under lib/" and nothing more. #825 kept the errno, and the Mac then
              said ENAMETOOLONG under lib/integration-bridge/node_modules/@workspace/integrations/node_modules/
              @workspace/incident-playbook/node_modules/... - #819 had added integrations -> incident-playbook for one
              type-only import, incident-playbook already reached integrations through posture-composition, and pnpm
              links a workspace cycle into node_modules as an infinite symlink loop. macOS's recursive readdir follows
              it until the path overflows; Linux does not, so every Linux lane was green. Thirty-three gates walk lib/
              that way. Three fixes, all green on both lanes, all owner-gated: #819 moves the dispatch seam UP into
              incident-playbook (it reads every field of Incident; a structural copy would have duplicated the type)
              and drops the dependency; #825's walker now PRUNES node_modules before descent and never follows a
              symlink; #832 is a new gate, check-workspace-cycles, deriving the graph from pnpm-workspace.yaml and
              every package.json (43 packages, 90 workspace edges, 0 cycles on mainline) - run against #819's
              original manifest it names the cycle in order.
              #828 (a heartbeat) reddened at CI liveness on a GitHub 403 rate limit, the same line as #654 on 09-12:
              the gate retried a rate limit with six seconds of backoff and named neither the limit nor its reset.
              #829 waits it out by the response's own retry-after / x-ratelimit-reset up to a 120 s cap, fails at
              once naming the instant when that is past the cap, and prints the limit headers. What spent the token
              this time is NOT known - 31 workflow runs in the 75 minutes before, none of them the throttled Mac
              tick - and the next occurrence will say.
              Mainline merged into #772, #774, #742 (green, pushed, commented). #742's new CodeQL medium - branch
              names from the API written to the job summary - answered with an ingestion-time ref grammar: a name
              outside it is refused unread, 17-case self-test, falsified twice. #686, #723, #758, #753 merged the same
              way with their derived documents re-derived; their gates were running as this was written.
              Readiness measured on mainline: (a) 94% (16 of 17), (b) 0% (evidence minted 2026-09-12 against
              manifest 4afa60cf; the tree is 6906d8d9), (c) 100%; HEADLINE 0%. (b) needs a person at the Mac:
              SIGNALGRID_MCP_PATH=... pnpm run verify:all --require-mcp --emit-evidence. Two asks sit on mainline
              unacknowledged; #821 carries the sim request for it and (a)'s last gap.
              OWNED DEFECTS THIS SESSION, all in the cloud lane's own process, none in the product: a worktree run
              without its install read a missing tsx as a gate failure; a gate loop that dropped the .mjs suffix
              printed nine Node banners and was read as nine passes until re-run; and TWICE a chain waited on
              pgrep -f 'node scripts/preflight.mjs' and matched that text inside its own bash -c wrapper - a script
              that waits on its own name waits forever. Same shape the repo keeps finding: a signal that cannot tell
              "could not look" from "looked".
              (Earlier 2026-09-17 21:20Z, cloud lane:) A LONG MERGE-AND-BUILD SESSION.
              PREVIOUSLY (2026-09-18 02:05Z, cloud lane): THE CONFLICTED BACKLOG, REPLAYED.
              Seven old PRs rebuilt on current mainline: #815 (replays #745), #817 (#732),
              #818 (#724), #819 (#782), #820 (#729), #821 (#730), #822 (the four defect fixes
              from #531). Cherry-picked with authorship preserved - no history rewritten, no
              force-push, nothing merged that the owner gates.
              EVERY ONE FOUND A DEFECT THE ORIGINAL BRANCH COULD NOT HAVE SEEN, and they are
              the same defect wearing different clothes - a signal that cannot tell "I could
              not look" from "I looked and found nothing", or an unknown that LOOSENS:
                #820 - `git diff --name-only` QUOTES an unusual path, so
                       `"lib/signalgrid-core/src/d\303\251cision.ts"` did not start with `lib/`,
                       classified AUTONOMOUS, and the merge authorizer returned TRUE. The one
                       gate written so #719 could not recur would have waved through the
                       decision core. A rename away from ASCII was all it took.
                #818 - the cap-block detection reused a whole-timeline `returned` boolean, so
                       ONE device coming back silenced a cap block held by a DIFFERENT device
                       still out - the exact false negative DR-051 was written to catch
                       [this entry said DR-052 when written on 2026-09-18; DR-051 is the custody
                       timeline detection, DR-052 is now the 2026-09-20 intake rule].
                #818 - four positive assertions were driving the detector with `undefined`
                       eventTypes (`ev` gained a required id on mainline). They read GREEN on
                       the original branch. Green against events that could match no rule.
                #822 - the fabricated-status detector required `healthy` BEFORE `status`, so
                       `{ status: 200, healthy: true }` passed. Object key order means nothing
                       in JavaScript; the detector was reading a promise the language does not
                       make. Also: an absent plugin-manifest key SKIPPED invariant 3 rather
                       than failing it, CORS omitted the `idempotency-key` the server reads and
                       the contract documents, and three iOS DLP sites defaulted to PERMITTED
                       on a nil session - including an `init` default parameter, so every call
                       site that forgot the argument got the loose answer.
                #815 - the CI-liveness gate called a rate-limited sweep DARK.
              READINESS IS 0%, NOT 94%, AND NOT BECAUSE OF ANY OF THIS. Measured with
              `node scripts/check-readiness-figure.mjs`: (a) 100%, (b) 0%, (c) 100%, headline 0
              - OUTREACH CLOSED. artifacts/live-evidence/mac-run.json was minted 2026-09-13
              against manifest fingerprint 4afa60cf2fd5; the tree is 6906d8d9ecc5. The drift is
              ALREADY TRUE OF MAINLINE, and the cloud lane cannot repair it - `verify:all
              --require-mcp --emit-evidence` is macOS-only and refuses on CI. Sim request
              2026-09-18-evidence-remint-readiness-b is queued for the Mac. Until it runs,
              every readiness claim in this tree is false by derivation.
              MY OWN CONFLICT RESOLUTION WAS THE LEADING SOURCE OF DEFECTS in this work: it
              dropped DR-051's reversal clause, spliced DR-051's sections into DR-052, and ate
              a closing brace in detect.ts. Each was caught by a GATE, none by re-reading the
              diff. Resolve, then run the gates - reading it again is not a check.
              STILL OWNER-ONLY: narrow the `~ALL` ruleset (it marks all 72 branches protected
              and spawns the intermittent github-advanced-security check), and delete
              claude/build-affected-audience-v2 - the seam's last honest entry.
              PREVIOUSLY (2026-09-17 21:20Z, cloud lane): A LONG MERGE-AND-BUILD SESSION.
              MEASURED, not recalled: `29` pull requests merged on 2026-09-17 and `27` still open.
              The open count barely moved (30 -> 27) and that is the honest shape of it: much of what
              merged was lane mail and heartbeats opened and landed in the same breath, and the OLDER
              backlog (#724, #730, #745, #782, #729, #723, #758, #755, #686, #531, #725, #753, and
              eight dependabot bumps) is still sitting there, most of it now conflicted because
              mainline moved. What actually matters out of the session:
              THE MAC COLUMN WAS NEVER A MAC PROBLEM. `PR — Mac-only checks` had been red on
              essentially every PR for days and was blamed first on a firewall, then on Node drift.
              Both wrong, both retracted. #791's drop legibility made the gate name itself:
              `dropped=144/300, first: ECONNRESET`. The load harness opened all 300 connections at
              once, so the kernel's accept queue reset 144 of them before Express saw them - the
              limiter never ran (`429s=0`), and `allowed=156` is exactly `300 - 144`. One failure
              read as five. Fixed in #804 by bounding the burst to 32 in flight, which is what the
              assertion was always named for; CONFIRMED GREEN on the real macOS runner, twice.
              The somaxconn=128 mechanism remains INFERENCE - no macOS host here - and a passing
              check does not turn an inference into a measurement.
              CASCADE JOINS 2, 3 AND 4 ARE IN. Join 4 (#807, `lib/signalgrid-core/src/verification.ts`)
              answers "monitor the fix or jump in": `unobserved` is NOT `cleared`, an unapproved
              remediation cannot have landed whatever the evidence says, and `dismissed` holds the
              restriction without escalating. proof:remediation-verification 51/51, falsified by three
              planted defects. The third falsification CORRECTED THE PROOF ITSELF - a self-test
              asserted on a case its defect could not reach and passed WITH the defect planted.
              THE SEAM HAD FOUR HOLES OF ONE SHAPE, all now documented in loop-state.mjs: worktree
              naming, squash merges, hub aliases (#805), and mainline moving past a landed branch
              (#810). Reported-unpushed went 13 -> 1, and the one that remains is correctly
              unprovable: a squash applies the branch's DIFF, so a concurrently-edited file never
              matches verbatim. Both fixes were falsified before being trusted.
              OWNER-ONLY AND STILL OPEN: the "Default" ruleset targets `~ALL` branches with one rule,
              copilot_code_review. That single scope both marks every branch protected - branch-prune's
              dry run refuses all 72, `63 keep — branch protection` - and spawns the
              github-advanced-security check that failed 7 of 9 times today with
              `CAPIError: 400 The requested model is not supported`, thrown before any diff is read.
              An earlier claim that this was a static misconfiguration was RETRACTED on #803: it
              passes intermittently, which a wrong model cannot do.
              PREVIOUSLY (2026-09-14 21:20Z, mac lane): DR-043 ITEM (d) IS COMPLETE: BOTH POLICY ROWS
              ARE IN THE CORE. Row 1 (removal suspends the session, CUSTODY_EXCEPTION) landed in #748.
              Row 2 - a legacy read for a strong-enrolled worker DENIES with CREDENTIAL_DOWNGRADE - is
              on #753 (head 8c7bcb80), carried by two new signal domains, enrollment_strength and
              credential_read_method, alongside attach_state and presence_state. On that branch,
              `21` signal categories and `24` evidence fields — quoted from #753's own run, NOT
              mainline's, which still measures 17 and 20 until it lands. (The earlier version of this
              line said `25` evidence fields; proof:signalgrid-core on 8c7bcb80 prints
              evidenceFields=24, which the quoted-green block below had right and this sentence had
              wrong.) The distinction the family rests on: not_applicable (no such
              credential is in play) is NOT unknown (a read attempted and failed); collapsing them
              would step up every puck-less deployment on day one.
              WHAT THE PROOF CAUGHT, and it is wider than one rule: credential-downgrade is the core's
              FIRST two-condition rule, and the core proof's scope derivation could not see it. It
              probes one field at a time from one healthy baseline, so a field that is only ever half
              of an AND never fires the rule that names it. enrollmentStrength derived as out-of-scope
              while the sweep swept it, and the exact-equality scope check refused the mismatch rather
              than quietly shrinking coverage. Fixed IN THE DERIVATION - unresolved fields escalate to
              a derived family of bases (healthy plus every single-field perturbation) - not by typing
              a field into a list. The escalation's comment names what it does NOT close: the
              derivation sees conjunctions, the sweep is still single-axis.
              AUTO-MERGE IS ON AND #753 IS DELIBERATELY NOT ELIGIBLE. classifyDiff returns
              owner-gated: DECISION_PATH on lib/* and the /v1 server, OWNER_RESERVED on the
              buyer-facing site. That is the machinery working, not a blocker - the cloud review board
              merges it per DR-037.
              Green, quoted FROM #753 (head 8c7bcb80), not from mainline: preflight EXIT=0,
              verify:breadth 56 proofs EXIT=0, proof:signalgrid-core
              `assertions=526 categories=21 evidenceFields=24`, proof:evidence-coverage `30/30 axes=25`,
              proof:signal-radar 22/22, test:api 409/409, room-console sigClass 176 vectors + 10 pins,
              manifest v81, CORE_NORMALIZATION_VERSION 18 -> 19.
              STILL OWED BY CLOUD: the skill-instruction-conflicts gate hangs preflight forever
              (askHook spawns .claude/hooks/block-dangerous.sh with no timeout; traced to cloud's
              DR-047 skill commits). Also: scripts/mac/gh-pr.mjs is still only on
              mac/gh-pr-rest-helper, and its `open` exited 0 WITHOUT patching the PR body - the body
              had to land via `gh api -X PATCH`. Both are real defects, neither is fixed.
2026-09-14 16:36Z (cloud lane) - THE QUEUE IS THE BOTTLENECK, MEASURED, NOT
              GUESSED. Ran scripts/check-merge-authorization.mjs (from #729's worktree; it is not on
              mainline yet, which is itself the loop) against all eleven open PRs. Every one REFUSED
              as owner-gated: #727, #730, #729, #723, #737, #732, #741, #742, #744, #745, #748 all
              touch scripts/** or lib/**. The ONLY authorized merge in the set was #750, this
              session's own lane mail, merged through that verdict pinned to 2ccef410. So the layer
              the owner asked to see built and verified IS built and verified; it is waiting on
              eleven clicks, not on more engineering. REVIEWED the Mac lane's new PR #748
              (mac/custody-removal-suspends, 752d9106 - an unclaimed lift from the dock is a custody
              exception, DR-043's removal-suspends item). The rule is good and was FALSIFIED rather
              than trusted: dropping hasUnauthorizedRemoval from the routing branch fails
              custody-removal-without-session (80/81); forcing it true fails BOTH
              custody-removal-with-session and the pre-existing healthy-shared-device-checkout
              (82/84). Clean run 82/82, up from 73/73. typecheck, review:invariants and
              check-decision-port-parity all green. BLOCKED on one line: preflight fails at the doc
              line-count gate because the branch itself invalidates a figure -
              docs/COMPANY_BUILD_PLAN.md:4871 says decisionEngine.ts (336) and the branch makes the
              file 361 (mainline measured 336). Two ungated figures also go stale:
              VALIDATION_EVIDENCE.md:33 says '11 scenarios / 51 assertions ... the scenario count
              still holds' (now 13 / 82) and PROOF_COVERAGE_AUDIT.md:25,:68 say '11 scenarios x 22
              risk mutations' (proof:signalgrid-grid prints 11/231 on mainline, 13/273 on the
              branch). THE CAVEAT WORTH KEEPING: port parity is green BY CONSTRUCTION. The Mac lane
              reused CUSTODY_EXCEPTION with its existing outcome set, and that gate compares
              vocabulary and wiring, not predicates - its own header says it cannot prove behavioural
              equivalence. native/ios/EnterpriseShell/Services/DecisionEngine.swift:66-80 holds the
              mirror of that block and has NO removal rule, so after #748 merges an unclaimed lift
              decides CUSTODY_EXCEPTION in the fabric and allow on the phone with nothing going red
              anywhere - the exact failure that gate exists to catch. Golden rule 1 means it is not
              fixable inside that PR; it wants a decision record naming the re-port, or a declared
              drift pinned both ways like AppPlanInput.stepUpSatisfiedActionKeys already is. All of
              it posted on #748 and mailed to the Mac lane (both in #750). ALSO LANDED AS A BRANCH:
              #751, claude/build-custody-v1-wiring, docs-only - why evaluateCustodyLedger is still
              unwired. The wiring was built end to end (two read-only fixture routes live,
              test:api 409/409 -> 416/416, eleven surfaces synced) and then REVERTED, because
              check-deployment-runbook.mjs resolves the api-server's TRANSITIVE @workspace/*
              dependencies and declaring @workspace/integrations adds 80 distinct env vars (119 ->
              ~199) for families the custody route cannot use. A subpath import does not help: the
              gate reads the dependency graph, not the import graph, which is correct. Documenting
              80 knobs that do not exist would be the dishonesty that gate exists to prevent, so the
              finding was filed instead; the fix shape (extract the evaluator into its own env-free
              package, re-export from rtls-custody) is a lib/** change and owner-gated. preflight
              and verify:breadth both exit 0 on it; the launch-claims ceiling dropped 416 -> 408 and
              the gate wrote that itself.
              (Earlier 2026-09-14, cloud lane:) THE MERGE BUTTON IS NOW MACHINE-LOCKED, and the
              headline readiness is 94%, not 0%. PR 3 of the auto-merge safe path landed as #729
              (owner-gated, green, awaiting the owner): scripts/check-merge-authorization.mjs refuses
              a self-merge unless classifyDiff says the diff is autonomous, the branch tip still
              equals the sha the checks describe (read from the remote with git ls-remote, because
              this session's GitHub surface returns check runs with NO head_sha field - verified on
              #727 on both the list and single-check calls), every check is completed and none red,
              and the gating check is present and green by name. The changed-file list is DERIVED
              (`git diff --name-only base...head` run by the script), never supplied, so a model
              cannot shorten the list it is judged on - which is exactly what #719 got wrong.
              Self-test 27/27; live it REFUSED #727 (17 checks green, DECISION_PATH + SAFETY_MACHINERY)
              and REFUSED then AUTHORIZED #728, which was merged through that verdict pinned to its
              sha. First live run found a real defect in the gate itself (an abbreviated sha refused
              against its own full branch tip on a plain ===) - fixed with prefix matching, two
              self-test cases. #729 also carries a DR-037 AMENDMENT for the owner to decide by
              merging: DR-037 permitted a SAFETY_MACHINERY self-merge with a note, CONTINUITY.md
              called the same class an ABSOLUTE exclusion ten lines after repeating the permissive
              wording, and AGENTS.md says "Do not merge your own PR" - three documents, two answers,
              which is what produced the #719 overstep and four earlier ones (#716, #708, #689, #704;
              all safe-leaning, all left in place). The strict reading governs and is now mechanical.
              MEASURED CONSEQUENCE, stated because it changes what the switch buys: over 14 days, 173
              real merges - 59 autonomous, 114 owner-gated; of the 59, 47 are pure lane bookkeeping
              and 12 are docs/evidence. ZERO product code would land unattended, because #719 made
              all of lib/ DECISION_PATH and lib/ is the product. The narrowing (a PR whose changed
              gates are proven falsifiable on that PR by #723 may land itself, decision core still
              owner-only) is the next step, after #723 and #729 land. READINESS: check-readiness-figure
              prints (a) 94 / (b) 100 / (c) 100 -> HEADLINE 94%, OUTREACH OPEN. The single binding
              item is ONE ground-truth gap: the faithful end-to-end smart-charging journey (badge ->
              dock -> provision -> in-use -> check-in with the unpaired / network-down / cap-hit /
              dock-fault branches). Building now on lane/cloud-custody-journey. CAUTION for whoever
              lands it: a new proof moves proofCounts, which is INSIDE the sync-manifest fingerprint,
              so (b) fail-closes to 0 and the headline reads 0% until the Mac re-mints - queue an
              `evidence` sim request with the landing so the unattended tick does it. #725 (inert live
              connector path) REWORKED against its 11 findings (b60a081c) and deliberately NOT proposed
              for merge: nine fixed or truthfully withdrawn, #727 carries finding 2, and finding 5 (the
              fail-closed freshness guarantee) is parked on an owner decision rather than decided
              unilaterally. The shipped core was checked and is SOUND on that axis - buildEvidence takes
              no evaluation clock, but connector.ts grades freshness against an injected nowIso, a silent
              connector emits nothing and reads `missing`, and dock staleness already travels as its own
              input into a fail-closed backstop (types.ts:494). Owner's merge list, security first: #727,
              #720, #724, #723, #729. Independent adversarial reviews running on #720/#723/#724 because
              Codex is out of review credits and #725 proved green CI means little here.
              (Earlier 2026-09-12, mac lane:) NEEDLE INGESTED (DR-044): cactus-compute/needle
              evaluated by use (isolated venv, base weights, telemetry off) then hardened by a 4-agent workflow;
              adopted-by-reference as a NARROW base-weights-only OFFLINE extraction helper, NEVER on the decision
              path. It runs where LightRAG did not (~48MB warm, offline from cache, deterministic per fixed session
              state), but the workflow corrected first-pass claims and found real surfaces: confidence is a
              fail-closed GATE not a calibrated probability (a correct extraction landed at 0.38; polarity is
              BACKWARDS for golden rule 2; extract() discards the score; finetuning disables the head); the
              inference-engine binary's LICENCE is unverified; no revision= pin + pickle.load on fetched artifacts;
              .github has auto-publish workflows so NEVER vendor it; two more consent-gated egress paths. Boundary +
              reversal in DR-044; nothing of needle is in the tree. SAME COMMIT closed two self-eval Mac items:
              Graphify semantic-docs pass DROPPED (LightRAG key-free naive mode already covers doc retrieval,
              DR-041); Crucible /temper NOT joining brain-cycle-config.json (redundant with the gauntlet's
              /code-review bugHunt stage) - that shared file UNCHANGED. Both decision benches re-run GREEN +
              deterministic on the Mac (latency p95 0.19ms; throughput `29,535/sec` agg on 10 workers, 3.86x).
              RELIABILITY_SLO.md NOT partial-re-dated: its 08-24 table is a coordinated single-machine measurement
              and this Mac is a faster class; routed the coordinated re-date (benches + test:load, one machine) to
              the cloud. Killed an orphaned self-hosted-runner api-server squatting port 5310 for 4h+ that made the
              local api:test crash (fresh server couldn't bind; hit the stale old-build server); test:api then
              409/409 - the mac-runner-harness should SIGKILL leftover dist/index.mjs on 5310 at job teardown.
              Owner directive recorded (memory + [[ultracode-opus-fallback-default]]): default to ultracode
              workflows + Opus/smartest model, per-stage model choice, use the installed tools. Full preflight
              green; cloud mailed.
              2026-09-12 (cloud lane) - THE SESSION PUCK IS ON THE RECORD AS A
              HARDWARE HYPOTHESIS, NOT A PRODUCT (DR-043). The owner shared his own 25-page
              research document ('Shared-Device Authentication Puck: Hardware and Form-Factor
              Concept' - 'I'm going to blow your mind with this'). Read in full, held against
              the tree with three read-only maps, every path:line re-read before citation.
              Adopted under DR-039's bar: the three-function split (identity / custody binding
              / ongoing presence) is doctrine for every session-gating surface; the puck or any
              dock is a SOURCE OF EVIDENCE, never the policy engine (IdP owns identity, UEM
              owns posture, PACS owns the physical credential, SignalGrid correlates); the
              software half is five fail-closed backlog items built without hardware (attach
              signal domain with unknown -> step_up never a grant; removal -> suspend joined to
              DR-042's cascade items, no seventh; eight audit event names; a dock/undock/
              re-dock simulator scenario carrying the policy matrix; a hardware tally column in
              DISCOVERY_LOG); NO bench prototype, purchase or custom hardware until the
              pre-registered gates are met (4 of 15 REQUIREMENT -> bench; 3 COMMITMENT ->
              design-partner MVP; 5 PROBLEM with 0 COMMITMENT -> no-go; tally today 0/15, 0).
              Substance in docs/SESSION_PUCK_HARDWARE_HYPOTHESIS.md with every vendor fact
              attributed to the document; overlap recorded (badge_binding, dock/custody schema,
              SmartDock, case-bay token, division of authority all pre-existed as deferred
              design targets); new: worker-carried token across receivers, the prototype
              ladder, the lost-credential sequence, the legacy-downgrade rule, the privacy
              constraint. NOT claimed: HIPAA, disinfectant compatibility, relay-proof,
              on-device enforcement, any hardware built. Disclosure noted - the tree is public
              and the owner-gated IP-posture backlog row is still open. Nothing shipped moved;
              custody/dock families stay deferred. Verification pass
              (same day) found four stale citations this work had itself introduced: the
              2-line insertion at the top of PHYSICAL_CUSTODY_SIGNAL_MODEL.md shifted the
              dockState/custodyState rows to :20-22 while the page and DR-043 still said :18;
              AUTHENTICATION_AND_CREDENTIAL_ARCHITECTURE.md:73 was offered for ES256
              verification it does not describe (the real evidence is
              lib/webauthn/src/webauthn/verify.ts, PROOF_COVERAGE_AUDIT.md:21 and the :56
              step-up row); and the cross-reference sentence attributed badge_binding to a
              schema that does not own it. All corrected, gates re-run green.
              (Earlier 2026-09-12, cloud lane:) LIGHTRAG'S KEY-FREE HALF IS RUNNING AND IN
              THE TREE (DR-041, branch lane/cloud-lightrag-retrieval-20260912-0520Z). The Mac
              is running LightRAG in its GRAPH shape on Ollama and is still fighting it - five
              docs at the defaults timed out 4/5, retuned and re-queued, first query pending
              (entry below). The KEY-FREE half needs no LLM and no embedding endpoint at all:
              naive mode with only_need_context makes 0 LLM calls and fastembed embeds
              locally, so it answers today. There is now a pinned
              installer (scripts/install-lightrag.mjs, lightrag-hku 1.5.8 @ the full sha, a
              venv under ~/signalgrid-lightrag/key-free - the store convention DR-038 set -
              NOT the [api] extra whose server binds 0.0.0.0 with a guest token, refuses on
              CI) and pnpm run docs:retrieve over the TRACKED docs set, which writes nothing
              inside the repository. Measured here: 73 packages in 34.6s; all 311 tracked docs
              indexed in 1636.2s into a 34 MB store, then a 24.9s refresh of the seven docs the
              rebase moved; a query answers in 1.7s with 0 LLM calls. The GRAPH half is
              quantified and left out - two LLM calls per chunk, and the call and token totals
              for one index of this corpus are in DR-041 and the EVIDENCE entry rather than
              retyped here; that is the cost the Mac's Ollama plan is buying.
              TWO DEFECTS FOUND BY BUILDING IT, both fixed before the push: ainsert always
              runs entity extraction, so with no model every document ended FAILED after its
              chunks were embedded - 311 of 311 failed with every chunk already in the vector
              store and queries answering normally, an index green over its own failure -
              fixed with LightRAG's own
              PROCESS_OPTION_SKIP_KG plus a hard failure on any non-processed status; and
              LightRAG canonicalizes file_path to its BASENAME and rejects duplicates, which
              would have silently dropped all but the first README.md. Its answer is a POINTER
              to a tracked file, never a fact, and it never replaces pnpm run check:absence.
              Also landed: the GitHub Trending screening intake row and the three backlog
              items it produced (maplibre console view, vendor-doc drift watch, rclone runbook
              sentence).
              (Earlier 2026-09-12, cloud lane:) THE SKILL COLLECTIONS ARE IN THE TREE,
              UNDER THE OWNER'S BAR (DR-039): 85 skill directories from eleven upstreams
              vendored byte-identical at their pins (mattpocock 25, addyosmani 24,
              K-Dense 13, google 5, NVIDIA 4, mcollina 4, hig-doctor 3, finding-unknowns 3,
              poka-yoke 2, keep-the-why 1, ios-simulator 1). The bar was
              the owner's: adopted if any part of it can aid building any aspect of the
              company; overlap is a ROW, never a refusal. The only exclusions are the four
              hard lines - licence (trailofbits CC BY-SA, ramzesenok no LICENSE, and the
              NC/proprietary/GPL/unlicensed K-Dense skills), auto-execution (every hook,
              installer and marketplace manifest), egress (stated and overridden, never
              silently accepted), directory collision (addyosmani's
              test-driven-development loses to the incumbent). 37 override rows, not one
              vendored file edited. One first-party addition:
              docs/agent/SKILL_AUTHORING_STANDARD.md (the NVIDIA authoring bar in our own
              words, plus the Trail of Bits doctrine written up rather than copied).
              Bambushu/crucible NOT taken - the owner's list named one Crucible and the
              Mac lane's DR-038 adopted a different project of that name; its measurements
              are appended to that intake row. Vendored figure 15 -> 100, 117 tracked
              directories under .claude/skills (100 + the 17 first-party, three of them
              from #671 the same hour), section E holds all of it.
              (Earlier 2026-09-12, cloud lane:) THREE HAND-RUN WORKFLOWS ARE NOW SKILLS BOTH LANES
              LOAD FROM THE TREE (branch lane/cloud-four-skills-20260912-024500Z): tool-evaluation-by-use
              (how an owner-shared tool is evaluated BY USE and written into the intake log),
              landing-under-dr-037 (the five merge conditions, merge-then-regenerate order, one
              evidence re-mint after the last family) and orchestrator-over-workers (spec-write /
              fan-out / review / land one at a time). A fourth, media-intake, was written and then
              folded into DR-040's video-intake before landing - same procedure, one skill per
              resource kind; video-intake gained the placement rules (where a clip's substance
              lands) and audio-only material. VENDORED.md now SEVENTEEN: 32 tracked = 15 upstream
              + 17 first-party, section E holds it. Readiness untouched.
              (Earlier 2026-09-12, cloud lane:) THE FOUNDER'S THESIS IS ON THE RECORD
              IN HIS OWN WORDS (DR-042): dictated, quoted verbatim in WHY_THIS_EXISTS.md
              under 'What only the founder can write' - the section that had been
              deliberately blank since that page was written - and tested clause by clause
              against PURPOSE.md with a path:line each. Three clauses PURPOSE did not carry
              were added under DR-042's authority (DR-020's rule): the systems' OWNERS are
              separate, not just the systems; the auth factor is the customer's choice and
              the grid is agnostic to it; a grant is scoped to the department, area or
              equipment the person was assigned. Plus 'The cascade, named' - a per-stage
              status table, every unbuilt stage marked design intent and pointed at a
              backlog item, no shipped-capability claim moved. CASCADE AUDIT: both ends
              built, the joins missing - @workspace/incident-playbook is imported by four
              PROOFS and by nothing in lib/ or artifacts/, so no ticket can open; nothing
              opens a change record (the fabric only reads one); check:absence 'affected
              user notification' CORROBORATED across four probes. Six fail-closed backlog
              items opened for exactly those joins. The owner's infographic ('10 cloud
              architecture concepts', Rajender Ponnala - not committed) mapped concept by
              concept in the cloud-platform architecture page; several answers are
              deliberate refusals (no cache in the decision path, no retry inside a
              decision, no queue on ingestion) and no deployment-target claim was added.
              (Earlier 2026-09-12, Mac lane:) THE SIX TOOLS ARE INSTALLED AND EACH USED ONCE
              (owner ran the three refused installs himself). Crucible /temper on #649's custody-ledger
              landing: three finder angles -> 11 candidates, 10 deduped, one drafted Important; the two
              that could gate were adjudicated by execution and both REFUTED with the design cited
              (clock-free evaluator by contract + family convention; 'none' is a documented positive
              assertion the audit kept on purpose) -> tracked set empty -> Clean, ledger row emitted;
              eight non-gating drafts mailed to the cloud (fossil '864' comment, seven-vs-eight key
              comment, two doc sentences missing the 'caller stamps the age' precondition, shallow-
              frozen fixtures, null options throws, unknownSignals omits the holder axis, posed-bound
              outside the mutation sweep). /watch keyless: the Fleet demo's captions as a timestamped
              transcript (full download hit YouTube 403; the cloud's vendored video-intake with local
              faster-whisper is the better path, #666). LightRAG on Ollama (qwen3:8b + nomic-embed-
              text, store outside the tree): five docs at the defaults timed out 4/5 - two concurrent
              32k-context generations, not the model (12.7 tok/s) - retuned to one at a time / 8k /
              1800 s and re-queued; first query pending. Sandbox lesson for probes: node --import tsx
              runs TS where pnpm exec tsx dies on its IPC socket. Readiness untouched (the gate prints it: node scripts/check-readiness-figure.mjs).
              (Earlier 2026-09-12, Mac lane:) SIX AGENT TOOLS ABSORBED BY USE (DR-038,
              owner: 'install all of these and add them where needed and start using them now').
              Installed at user scope, hooks off, nothing in the repo's .claude/: last30days 3.24.0
              (first brief run - keyless coverage is HN-only and thin for niche topics), Ponytail
              4.9.0 (the cloud fixed the pin's spelling the same day: a full 40-char id fetches, an
              abbreviated one is read as a ref name), Graphify 0.9.58 (structural graph of this tree:
              about sixteen thousand nodes and thirty thousand edges in 677 communities, built in 3 s;
              strong on 'who calls X', blind to string-literal paths; semantic docs pass deferred),
              CLI-Anything (no target here), lightrag-hku 1.5.6 (waits on Ollama), ffmpeg 9.0.1 +
              yt-dlp. Owner-run because the auto-mode classifier refuses them for an agent: the
              /watch plugin install, `pnpm run crucible:install` (selective, adversarial skills only,
              pinned), `brew install ollama`. Repo side: five intake rows, DR-038, installer scripts +
              package.json rows for all six, .gitignore rows for every output dir they can write.
              Readiness untouched (the gate prints it: node scripts/check-readiness-figure.mjs). (Earlier 2026-09-12, cloud lane:) THE BAR IS THE FOUNDER'S (DR-039): a resource
              with any part that can aid building the company is adopted; only licence,
              auto-execution, egress without consent and directory collision exclude;
              overlap is recorded, contradictions get override rows. The founder's resume
              absorbed as standing context (docs/company/FOUNDER_PROFILE.md): a senior
              platform engineer, not a non-technical founder - owner-comms corrected, the
              base skill points every role at it, ICP Finding 9. (Earlier 2026-09-12, cloud lane:) THE MAC'S THREE ASKS ANSWERED IN ONE
(Earlier 2026-09-12, cloud lane:) OWNER-DIRECTED VENDORING (DR-040): the
              /watch skill from bradautomates/claude-video (pinned, hook NOT taken, two
              instructions overridden not edited) and the CLI-Anything method (the plugin
              directory under third_party/, the telemetry-bearing hub NOT taken) are in the
              tree, with two first-party skills around them: video-intake (frames via
              /watch, transcript locally with faster-whisper, no key, nothing uploaded)
              and cli-anything (the seven phases mapped onto a signalgrid CLI over /v1 and
              the MCP server, a backlog item). Vendored figure 14 -> 15, first-party
              exceptions TWELVE -> FOURTEEN, section E holds them. (Earlier 2026-09-12, cloud lane:) THE MAC'S THREE ASKS ANSWERED IN ONE
              PR: the ponytail pin is real (3 commits after tag v4.9.0, skills identical to
              the tag) and the installer now fetches it by its FULL id (an abbreviated id is a
              ref name to git - that was the whole failure); the LM Studio section of
              AGENT_GATEWAY.md that #531 carried but never landed is ported verbatim;
              Graphify measured in a sandbox and NOT adopted (hook-based integration,
              tree-dirtying rebuilds, oscillating output, a benchmark denominator of nodes
              x 50 words) - the intake row carries the numbers. (Earlier 2026-09-12, Mac lane:) READINESS INSIDE THE TARGET BAND, OUTREACH OPEN (the gate prints the number)
              (minted 2026-09-12T02:05Z, manifest v72). Two Mac re-mints tonight, each right after a landing moved the
              contract: v71 after #653 (134c25fd: headline 82%, the floor cleared for the
              first time), then v72 after the cloud landed #649 (minted 2026-09-12T02:05Z, manifest v72). Each with
              verify:all --require-mcp --emit-evidence (Review-Hub preflight PASS, breadth
              PASS, signalgrid-mcp pytest 99 passed at 10c5b52, 22 MCP tools = doc), each
              carrying its own mintedAt, full preflight PASSED on macOS before each push.
              The gate, quoted: (a) runbook 94% (16 modeled / 0 partial / 1 gap of 17) -
              (b) launch surface 100% (green on both halves, 0 days old, manifest 43771dfc,
              age via mintedAt) - (c) end-to-end 100% (scenarios 11/11, live operations
              8/8) -> HEADLINE 94%, OUTREACH OPEN (floor 80, target 92-95, goal 100). The
              number is derived, never typed: node scripts/check-readiness-figure.mjs.
              What moved it, all by proof: 62 -> 78 (three live ops proven on real
              software, 09-10) -> 70 (cloud's #620 made the gate honest) -> 82 (cloud
              modeled the last two partials in #641, landed via the Mac's #653) -> 94
              (cloud modeled two of the three gap rows in #649: custody-ledger
              reconciliation + the computed per-user checkout cap, rtls-custody family).
              THE LAST ROW (row 81 of the map): a faithful end-to-end smart-charging
              simulator scenario - badge -> dock -> provision -> in-use -> check-in with
              the real failure branches - modeled = 17/17 = 100. How #641/#645/#638
              landed: the owner said not to wait; the Mac's auto-mode classifier refuses
              gh pr merge, so the Mac rehearsed the combined landing locally (manifest and
              coverage page regenerated on the combined tree, preflight + breadth PASSED),
              opened #653 through REST (GraphQL quota exhausted by the shared token), and
              the cloud merged it under DR-037 (owner: the cloud merges green product PRs).
              OWNED DEFECT: the Mac checkout sat on mac/land-641-645-638 from 23:44Z to
              01:45Z and the pre-#657 tick pushed a 'skipped' heartbeat every 5 minutes -
              23 pushes in 2h, each starting four workflows, cancelling the mainline CI run
              before it, and exhausting GITHUB_TOKEN until check-ci-liveness failed on
              #654. Cloud fixed the throttle in #657 (an UNCHANGED result re-pushes once
              per 25 min); the Mac rule now: never leave the shared checkout parked past
              the run that needed it. STANDING RULE: after every manifest move, (b) reads 0
              by design until the Mac re-mints; keep mac-run.json within 7 days. (Earlier 2026-09-12, cloud lane:) DR-037 RECORDED: the owner ended
              'lanes open, owner merges' ('I didn't want that on me'); the cloud lane now
              merges its own green product PRs under five stated conditions, and landed
              #656, #657, #653 (the Mac's combined #641+#645+#638) and #649 that way; #654 is
              next, and the manifest moves again with it (v73), so ONE more re-mint follows.
              Two owner videos absorbed (RESOURCE_INTAKE 2026-09-12): 'paved paths' as
              the vocabulary of ICP Finding 2, and orchestrator-over-Opus-workers as the
              cloud lane's build pattern (first fan-out: the pending brace-less guard
              families).               (Earlier 2026-09-12, cloud lane:) THE MAC TICK NO LONGER FLOODS MAINLINE
              (branch lane/cloud-tick-heartbeat-throttle-20260912-005000Z; owner merges): a
              SKIPPED tick result was exempt from the quiet throttle, so a checkout parked on
              mac/land-641-645-638 pushed a heartbeat to Alpha every 5 minutes, each push
              starting four workflows, cancelling the mainline CI run of the merge before it,
              and exhausting the GITHUB_TOKEN budget until check-ci-liveness failed #654 on a
              403. The throttle now keys on an UNCHANGED result (a changed one still delivers
              at once), and the four push-triggered workflows ignore heartbeat-only pushes.
              The owner said YES (2026-09-12) to the cloud lane merging green product PRs
              itself - recorded as DR-037 - so the cloud now lands #656 (merged aa5c8151),
              this one, #653 (Mac landing of #641+#645+#638), #649 and #654 in that order. (Earlier 2026-09-12, cloud lane:) THE COVERAGE PAGE NO LONGER MOVES ON LANE MAIL
              (#656, merged aa5c8151): the mailbox trees
              (artifacts/lane-messages, artifacts/agent-heartbeats) stay claimed surfaces but
              their record counts are withheld from the render, so a send/ack/batch delivery
              leaves docs/agent/SURFACE_REVIEW_COVERAGE.md byte-identical (self-test proves
              it, 54/54) and open product PRs stop going unmergeable on it every cycle. Open
              for the owner: #653 (Mac's combined landing of #641+#645+#638), #649, #654
              (brace-less guards join the mutation sweep). (Earlier 2026-09-11, cloud lane:) THE LAST TWO RUNBOOK PARTIALS MODELED
              (PR #641, landed inside the Mac's combined #653 with #645 and #638):
              the supervision-identity lifecycle (device-attestation/supervision-identity.ts:
              supervised / this org vs another / identity lost / enrollment lost / never
              enrolled / commands unresponsive / unknown -> grant, hold or contain; a
              288-state sweep pins the single grant) and the iOS update / device-prep
              workflow (app-update/device-prep.ts: enrolled / profiles / required apps /
              prep stage / OS update -> ready, hold, contain, or advise; a 3072-state
              sweep pins the single grant). Each is a distinct fixture corpus + fail-closed
              evaluator + proof section on the break-glass fallback-sequence pattern;
              mutation-swept 42/42 and 59 killed + 4 documented-inert of 63, 0 survivors.
              READINESS (a) 70 -> 82% (14 modeled / 0 partial / 3 gap of 17) - the runbook
              dimension is OVER THE FLOOR. HEADLINE still 0% ONLY on (b): mac-run.json
              covers manifest 6f6a, the tree is now 6989 (manifest v70 after proofCounts
              moved device-attestation 77->119 and app-update 71->127). The Mac re-mint
              is the single remaining lever, and it got easier: verify-all.mjs now stamps
              mintedAt into mac-run.json and check-readiness-figure prefers it over the
              git date (a shallow clone mis-aged the file twice; fail-closed on a garbage
              or future stamp, 6 new self-test cases). Also this session: the NIST org
              absorbed as docs/research/NIST_ALIGNMENT_MAP.md (PR #638, awaits the
              owner's merge) through six review rounds - Codex to its budget, then the in-house
              fail-closed-auditor, which also showed the launch-claims vocabulary cannot
              see any capability that map names (follow-up: a profile-id <-> doc-status
              gate). The owner delegated routine merge calls this session (do what you
              need to do unless blocked); lane-mail auto-merges, product PRs await the
              owner because the harness refuses agent self-merge, self-approval, and
              self-authorizing edits to AGENTS.md or a DR - so that rule text stands as
              written. PR #641 then took three Codex findings, each real and each fixed
              at the root: own-property reads in both new normalizers (an inherited field
              could reach the grant), an invalid mintedAt is Infinity not the git date, and
              an optional-update advisory stays checkout-ready; round three made the
              grant a POSITIVE predicate (an out-of-union runtime value is held, not
              granted) and a throwing field read malformed; round four caught that cut
              (it skipped when an advisory had fired) - now an in-domain check on every
              axis, run whatever else fired; round five froze the domain lists at runtime
              (readonly is compile-time only); round six (Codex out of quota, so the
              in-house fail-closed-auditor) froze the REPORT_KEYS allowlists too and pinned
              the own-property read against a polluted Object.prototype - two P1s the
              external rounds had just walked past. Round seven (Codex, back on quota)
              closed the three holes the custody-ledger review had found the same hour -
              own-name fixture lookup, one-time axis snapshot, a revoked-Proxy catch - in
              both modules (proofs 148 -> 154 and 161 -> 167; sweeps 58/58 and 76 + 4 inert
              of 80, 0 survivors). (Earlier 2026-09-11, cloud lane:) BRACE-LESS GUARDS JOIN THE MUTATION SWEEP
              (branch lane/cloud-guard-braceless-20260911-220800Z; product PR, owner merges): the
              mutation guard only ever mutated braced `if` blocks, so every one-line
              `if (cond) return x;` guard - the dominant shape in the newer fail-closed
              normalizers - was never swept. New mutator oneline-cond-false, opt-in per
              target (`oneLine: true`), measured across the whole registry first: 1732
              mutations, 121 survivors (117 one-line across 41 files). Four families opted
              in and are clean under it (rtls-custody 14/14, device-attestation 25/25,
              verdict-attestation 42 with 0 survivors after one new pin and two shadowed
              guards DELETED, app-update 54 with 0 survivors after two shadowed guards
              deleted and six parseVersion pins). Docs proof counts 82->98 and 71->74.
              The guard now REPORTS "N of M targets opted in; K pending" every run and
              never fails on it; as of 2026-09-11 the BUILD_BACKLOG campaign row lists the pending families
              by survivor count. Still awaiting owner merge: #638, #641, #645, #649 (all
              green; Mac re-mints evidence ONCE after they land). (#654 landed after #653 and #649 under DR-037; manifest regenerated on top.)
              (Earlier 2026-09-11, cloud lane:) TWO OF THE THREE RUNBOOK GAPS MODELED
              (branch lane/cloud-custody-ledger-20260911-203200Z; product PR, owner merges):
              the custody-ledger RECONCILIATION in rtls-custody/custody-ledger.ts - what
              the checkout ledger says vs what the dock bay sees, plus the requester's cap.
              A seated device the ledger still assigns to a prior holder is a hold with the
              contradiction named (the runbooks' phantom); an unpaired device in a bay is
              contained; a clear ledger over an empty bay escalates; a cap hit only by
              returns that never cleared is a hold (CUSTODY_CAP_BLOCKED_BY_STALE_RETURN), a
              cap genuinely reached a containment - the cap axis is computed from three
              counts, never asserted; the observation's age is graded against a bound the
              caller poses, so a replayed snapshot never grants when the caller stamps the age at evaluation time. 21 fixtures, a sweep of
              all 4,320 combos pinning the single grant plus a raw-space sweep (230,400
              wire reports, two grant), every hostile-report shape from the sibling
              surfaces' six review rounds pinned on day one, then an in-house fail-closed
              audit (no P1; three P2s and five P3s, each verified and fixed or recorded)
              and a Codex round (own-name fixture lookup, one-time axis snapshot, revoked
              Proxy, identity binding, freshness - each executed before the fix);
              proof:rtls-custody 63 -> 214; mutation-swept, 0 survivors. The family stays
              deferred in the launch profile - built, not claimed. Ground-truth rows "custody integrity" and
              "per-user checkout cap" now read modeled: readiness (a) 16 modeled / 1 gap of
              17 once #641 lands (this base still carries #641's two rows as partial). The
              third gap (the smart-charging simulator scenario) and the detect.ts timeline
              detection are decision-core / simulator work (DR-020) and stay on the backlog
              for a decision record. Headline readiness still 0% on (b) until the Mac
              re-mint — no longer true on mainline, see the Mac's note next. (#649 landed after #653 under DR-037; manifest regenerated on top of v71.)
              (Earlier 2026-09-11, Mac lane:)
              HARDWARE EVIDENCE RE-MINTED against the
              manifest mainline carries (v68 / ce58f6): 53c60f4e, from verify:all --require-mcp
              --emit-evidence on this Mac (Review-Hub preflight PASS, breadth PASS, signalgrid-mcp
              pytest 99 passed at 10c5b52 on a clean checkout, 22 MCP tools derived = doc); the
              full preflight PASSED (319 gates) before the push. check-live-sync now prints
              liveEvidence=fresh. Readiness on mainline reads (a) 70 / (b) 100 / (c) 100 ->
              HEADLINE 70, OUTREACH CLOSED - bounded by the runbook rows until cloud's #641 lands
              (it models the last two partials: (a) -> 14/17 = 82). CAUTION for whoever merges:
              #641 carries manifest v75 / 72c7ce80 and #645 a DIFFERENT v70 / a5e4b3bc while
              mainline is v68 - the second one merged needs its manifest regenerated on top of
              the first, and the evidence reads stale-by-fingerprint again the moment either
              lands (by design); the Mac re-mints then. mintedAt rides #641 too, so this
              artifact still ages by commit date (the gate's legacy path). Four cloud messages
              acked in one delivery (66be8a5) with those two corrections. The self-triggering
              runner is PROVEN: the runner log shows PR checks on every push to #638 / #641 /
              #645 today (latest run on each Succeeded), and the first nightly fired - cron
              08:00Z queued until 12:23Z - lane=both Succeeded 12:30Z, lane=mcp Succeeded
              12:34Z. signalgrid-mcp sibling pulled to 10c5b52 (#13). (Earlier 2026-09-11,
              cloud lane:) READINESS-FIGURE HONESTY LANDED
              (#620, 52b395d). The DR-036 readiness gate was OVER-reporting - it
              fail-OPENED on two dimensions. Fixed at root, each with a control that
              fails pre-fix: (a) parseGroundTruth dropped markdown-bold **gap** rows
              from the denominator (runbook is 12 modeled/2 partial/3 gap = 70%, not
              the reported 85%); (b) evidenceDimension is now fail-closed - dimension
              (b) scores 100 only when mac-run.json's manifestFingerprint matches the
              live-sync manifest (missing/mismatch/uncomputable -> 0). Plus #6
              audit-evidence binding in the break-glass fallback (the out-of-band
              accountability record must match the sequence tenant/correlation/
              credential). HONEST readiness now 0% = lowest of (a) 70 / (b) 0
              fail-closed on stale-contract evidence / (c) 100 - OUTREACH CLOSED, and
              this is the gate telling the truth, not a regression. Recovery path:
              finish the two remaining runbook partials (moves a past 80) AND the Mac
              re-mints mac-run.json against manifest ce58f6 (requested via lane mail
              #622). Corrected the earlier "85% floor cleared" over-declaration to the
              owner. Verified: proof:break-glass 101/101, proof:event-contract 21/21,
              preflight PASS; sync manifest regenerated v68/ce58f6; INTEGRATION_CATALOG
              break-glass count 96->101. Steward heartbeat #621 + Mac evidence request
              #622 delivered and merged. badgeAuthOutcome documented in EVENT_CONTRACT.md.
              NOTE: this round's builder subagent HUNG (auto-mode classifier blocked it
              mid pre-fix sabotage-check); recovered by TaskStop + manual revert + verify.
              FILED (not done): the mutation-guard brace-less-clause mutator remains its
              own triage cycle, as documented in scripts/mutation-guard.mjs. (Earlier
              2026-09-10, Mac lane:) DR-034 LANDED (f5f084b2, owner-approved):
              the research basis is the founder's own domain practice, not customer
              engagement; the owner's Google Drive folder "Project > SignalGrid" is the
              canonical corpus of problems and solution ideas; an owner-supplied document
              is research to absorb, never a conversation to schedule. research-ops skill
              reconciled to DR-033/034; INTAKE_LEDGER row 98; RESOURCE_INTAKE row;
              provenance line in the custody ground-truth map. Same session: three
              macOS-only gate defects fixed (10deac53 - Apple git's grep -E reads \b as a
              literal b, so env-doc readers invented failures and the gap scan found no
              skipped tests; verify-done.sh made direction-aware); live evidence refreshed
              (19b64f51); every validate-sim-macos.sh skip closed on the Mac (Postgres
              proofs against a local postgres:16 with a version-matched client; the six
              live-vendor lanes; live-fleet-workflow wired into the fleet lane, 91396ed6);
              container-engine.sh docker-first with a drift self-test (e6cc4952; the .mjs
              twin is cloud's to flip); 17 cloud acks + one status message delivered
              (d1b6a8ee). Tick re-installed on the 5-min cadence. mac/* branch cleanup
              done with evidence (owner-approved): five landed branches deleted, each
              tied to its landing commit; kept mac/fleet-premium-proof (parked WIP) and
              mac/native-ledger-2026-09-02 (superseded, unmerged - a human call). Self-hosted
              runner signalgrid-mac registered and running as a launchd service; the
              read-only workflow_dispatch job mac-runner-harness.yml landed (a779f692,
              owner-approved) - cloud can now run the Mac harness/preflight on this
              hardware on demand. Its FIRST run caught a real defect no shallow clone can
              see: sim result 2026-08-23-headwind-first-capture named a pre-rebase
              provenance commit that never reached origin; re-minted from mainline with
              run-requests.mjs --id (0a40d1b4), and the workflow now reports preflight
              independently of the harness (b370417). The shared Mac MCP lane the owner
              asked for: lane=mcp (e7473ba6) clones the public signalgrid-mcp sibling and
              runs verify.sh + verify:all --require-mcp on real macOS for either lane
              (no evidence minted); audit of that repo: 11 of 12 PRs merged, PR #9
              superseded (cloud asked to close), its ubuntu CI smoke-only by design.
              The runner now triggers itself (mac-runner-auto.yml, b08374a3, owner-approved):
              every PR into mainline gets full-clone provenance + macOS preflight; nightly
              08:00 UTC runs lane=both then lane=mcp; manual dispatch optional. OPEN: proof
              of the first automatic run (next real PR / tonight's cron); re-push the Fleet
              restrictions profile. DR-035 LANDED (613071e9): PURPOSE.md §2 says source-agnostic
              is the point and forbids vendor lock; follow-up: widen the §2 sentence to "the
              company" with its four mirrors (POSITIONING.md owner-reserved). DR-036 LANDED
              (c97138d8, owner-approved): outreach is gated on a DERIVED readiness figure —
              node scripts/check-readiness-figure.mjs, lowest of three dimensions, floor 80 /
              target 92-95 / goal 100 — printed by loop:state every session; today it reads
              under the floor, outreach CLOSED. The live-operations lever is DONE (request
              fb9b5f46, result 59d00041: keycloak, location, edr all PASS on real software;
              end-to-end now fully proven). THE ONLY GAP TO THE FLOOR is the three runbook
              partials in SHARED_DEVICE_CUSTODY_GROUND_TRUTH.md: supervision-identity
              lifecycle, badge->manual fallback sequence, iOS update/device-prep - each a
              fixture-backed surface + proof around the frozen engine; one row clears the
              floor. Same session repaired mainline preflight (workflow count 15->16
              fallout, a pinned self-test fixture, coverage page, one claim citation).
              Preflight PASSED on macOS.
              (Earlier 2026-09-07, cloud lane:) PACKAGED THE REPO AS A CLAUDE
              CODE PLUGIN (DR-030, owner-directed). .claude-plugin/plugin.json
              names the `signalgrid` plugin and declares skills/agents/commands
              by path into the LIVE .claude/ (one source of truth, no drift
              copy; hooks excluded so they do not double-fire). claude plugin
              validate . exits 0. New anti-drift gate check-plugin-manifest.mjs
              (agents list == git ls-files .claude/agents/*.md; validate exit 0
              when CLI present) - self-tested, mutation-proven, wired preflight+CI,
              parity green. Records: DR-030, RESOURCE_INTAKE, docs/reference/
              CLAUDE_CODE_PLUGINS.md, INDEX, coverage 102/102, publication-boundary
              + surface-ownership areas for .claude-plugin. Preflight PASSED.
              (Earlier 2026-09-06:) Batches K (#463), L (#465),
              M (#466), N (#468), O (#470), P (#471), Q (#473), R (#474) and
              S (#476), T (#477), U (#480), V (#482), W (#484), X (#485) and
              Y (#489) LANDED. Batch Z (twenty-fourth round, on its PR) read
              the LAST TWO partial surfaces WHOLE - all of scripts/ (five
              independent chunks, ~373 files) and docs/inspiration's vendor-row
              bodies - and found the guards themselves failing the way
              everything they watch fails: a breadth self-test that read f.id
              on id strings so it could not go red, a mutation guard scoring an
              unrunnable proof as a kill, five DB proofs exiting 0 and counted
              as passes, a Mac tick grepping '^  PENDING' against a script that
              says it only in comments, ratchet reads treating a corrupt or
              deleted ceiling as a fresh start, localeCompare feeding the
              committed SBOM order. All fixed with plant->red assertions; two
              new gates (entry-guards, inspiration-catalog-structure) wired
              into preflight AND CI plus eight existing self-tests; core proof
              489->495, nac 45->46, unsafe-claim 40->50 (each confirmed against
              a live run); the ledger now reads 100 of 100 surfaces READ.
              Batch Y (twenty-third round) had read four of the six
              partial surfaces WHOLE - docs/research, docs/agent, artifacts/
              api-server and every loose docs/* file - with six independent
              fail-closed audits (~90 findings) and fixed them with seven
              agents: the served /console classified signal values by
              substring and painted a restrict cause green (now an exact map
              from the core's unions, driven through all nineteen scenarios
              by the api suite); stepUpAnswerable was a literal under
              review-demo (now derived from the mounted router); the load
              gate passed on zero requests (floored); a blank METRICS_TOKEN
              served /metrics open (refused at boot); the daily live-sync
              keeper had fired for forty-one days and delivered nothing
              (trigger disabled, retired in the registry, duties in the
              hourly steward, and a never-fired routine with no status is
              now fatal); the retired-label rule read a possessive as a
              quote; the room console's sigClass("broken") returned ok and
              its vector list is now derived from types.ts; the evidence-
              coverage page lacked the two launch-family axes (21 now, proof
              asserts both directions); PITCH_EXECUTION_PACK routed readers
              to do-not-send docs (cross-doc banner parity gate); a
              fabricated one-pager quotation is a FALSE_CLAIMS entry; three
              new gates (cross-doc banner parity, published-page scope
              banner, product-sentence drift REPORT) and four extended
              (launch-claims roots from every Dockerfile, derived-figure
              companion rule, scheduled-routines retirement/launchd/
              tolerance, room-console vectors). api suite 384 → 409.
              Batch X (twenty-second round, #485) repaired docs/company's
              twelve defects with every figure re-derived first: the investor
              one-pager no longer says the outreach wave is "in flight" or the
              pilot program "live" (an {AT-USE} bracket names the outreach log
              - only its README - and the 0-of-15 tally as the things to read
              on send day); FUNDING_READINESS's "already running / first sends
              Monday" is "prepared, zero sends logged"; iam verification is
              five of fifteen sourced to the roster (the folder had said 2, 5
              and 15); "No cost or billing figure appears in this repository"
              ×3 narrowed to owner-only billing (the product's own prices and
              the cost model DO appear) and check-cost-figures now resolves
              every currency amount in the tree against a register in
              COST_MODEL.md and refuses a concrete owner-only spend figure;
              "no cost model exists yet" ×2, "no lint rule yet" ×2, "47
              deferred families", "v4 / 174", "no hiring sequence published"
              all corrected to what the tree measures; the lens review's
              twelve fixed findings annotated in its own idiom, its dead and
              drifted unbackticked citations corrected, and check-cited-paths
              now REPORTS unbackticked path:line citations per document (2,535
              across 8 documents - CLAIM_INVENTORY alone 2,122) rather than
              being silently green over them. The buyer-facing claims scan
              gained a fifth rule - a document whose path or first heading
              names an investor, pitch, pilot, partner or funding audience -
              which found 43 unhedged deferred-noun and retired-label sites in
              seven partner/pitch documents outside docs/company (two are
              literal outreach email drafts opening with the retired label);
              fixed in the same batch, the ceilings never rose.
              Batch W (twenty-first round, #484) fixed the console's fourteen
              fail-open shapes and gated them: every "{!q.data && 'Loading…'}"
              site (nine — the read named eight, the gate found a ninth in
              GridConfig) renders a settled control-plane error as "unavailable";
              AppResilience shows a red "treat every app as blocked" card
              instead of an empty list; GridOverview's all-clear is unreachable
              while any read failed; the Dashboard buckets integration health
              from the IntegrationHealthStatus enum (NOT CONFIGURED tile, alert
              list = everything not connected, worst first, "+N more" so the
              slice hides nothing); the chart says "series unavailable" instead
              of loading forever; Fleet's drift column is three-way ("target
              unread") and "signed" became "signature present"; freshness
              badges take their tone from a mirror of the core's severity;
              PolicyDetail says "policies unreadable" before "not found";
              disconnected has its own danger label; every wire mode maps
              explicitly with hold → blocked; Audit's chain banner says
              "chain unverified" on error; /overview and /policies/new are in
              PREVIEW_NAV and /overview is preview-wrapped. Four gates, each
              with a self-test and proven against the committed pre-fix
              console: error states (nine flagged, zero after), enum coverage
              (not-configured unnamed → flagged), routes reachable + preview-
              wrapped (two orphans → zero), launch families (LAUNCH_FAMILIES
              mirrors the launch arm both ways). Still open on the surface:
              connector `status` rendered nowhere (every fixture connector is
              healthy today), the toaster nothing fires, the CATEGORY_ORDER
              hand list, a `/sessions/:id` canonical path nothing links to.
              Batch V (twentieth round, #482) read six partial surfaces WHOLE with four independent
              fail-closed audits: docs/lab, docs/preview, docs/assets and the
              vendored .claude/skills content are now READ and fixed; docs/company
              and artifacts/signalgrid-app are READ with their fixes owed by
              Batches X and W (findings in the scratchpad, open counts in the
              ledger). Fixed here: both public preview PNGs still rendered the
              retired "Operational Trust Orchestration" eyebrow five days after
              ab72355 struck it from their HTML (no gate read an image) — re-
              rendered from the committed sources with a synthetic-data
              disclosure the OG card lacked, and check-rendered-assets pins each
              PNG to the sha256 of its source; the SVG ladder's one arrow pointed
              at Restrict off-centre with two amber rungs at ΔE 11 → fan to four,
              recoloured, the ladder gate holds neighbours at ΔE ≥ 20 and text at
              AA (a luminance rule was tried first and could not tell green from
              yellow); the retired-label scan opens docs/**/*.svg; the LAB_001
              rehearsal called the Python posture server "the same tool" as the
              TypeScript location tool it drove and said "NOT minted" four days
              after the Mac ran it → rewritten, and check-sim-requests fails a
              doc that names a PASSED request in a paragraph still saying not
              yet / when that lands; two lab services bound to 0.0.0.0 on a LAN
              lane → loopback; signalgrid-master's authority ladder had lost
              "1. The owner's explicit current instruction" in a renumbering
              (f97cebf) → restored; the vendored brainstorm server beaconed a
              third-party image URL with the version string from every page →
              SUPERPOWERS_DISABLE_TELEMETRY=1 in settings.json env; VENDORED.md
              gained an Overrides table (23 rows: hook-denied commands, force-
              push-on-request, commit-without-asking, a fail-open except-arm
              taught as the good example, RED-phase outage fixtures, dead
              nested layouts); check-skill-instruction-conflicts judges every
              code span under .claude/skills by invoking the hook itself (found a
              third rm -rf inside a teardown script the hook can never see);
              check-gitignore-producers proved .superpowers/, .worktrees/ and
              diagrams/ were unignored (0/31 → 30/30) in a pristine git harness
              because git check-ignore cannot be told to ignore info/exclude.
              Batch U (nineteenth round, #480) built the gate the catalog auditor specified:
              scripts/check-cited-symbols.mjs - a symbol named beside a
              code-file citation must be one the file still holds on a
              non-comment line. It reads no English: pairing is positional
              (an explicit attribution after the symbol wins, else the nearest
              citation before it, broken by a `;`, a sentence end, a
              table-cell bar, a bare file name or a foreign possessive), a
              registry row pairs every symbol, and everything it cannot pair
              is counted and printed, never judged (194 unpaired). First live
              pass 123 pairs / 26 missing: 19 the iOS key registry's deleted
              keys (verbatim import, now opted out by a visible first-line
              marker the gate names on every run), 3 the gate mis-pairing
              sentences a reader gets right - each a self-test case BEFORE
              the rule moved (13/16 → 16/16) - and one real: MAC_LANE.md:248
              put SignalGridMobileCore under native/ios/Package.swift
              (check-cited-paths had passed the line) → both manifests named.
              After: 82 pairs, 80 hold, missing 0, ratchet committed at 0;
              a planted line fails by name (ROSE 0 → 1); registered in
              preflight and CI (parity 336, 0 unwired). Side repairs: the
              eighteenth-round evidence wrote a message count as a digit
              beside the lane-messages proof's name and the steward's next delivery
              broke it (mail PR #479) → words; the "acked with lane:inbox"
              instruction was still in this file's NEXT ACTION → corrected.
              Batch T (eighteenth round, #477) read the
              lane mail channel as a whole for the first time and the eleven
              inspiration catalogs' prose. Mail: a message with no sentAt could
              never go stale (the 13-day-unread Fleet handoff printed with no
              age; the self-test asserted that as correct) - every unread
              message now ages by sentAt or by the commit that delivered it;
              a routine that never fired was exempt from the routines gate's
              clock - measured from authorizedOn now (mac-lane-tick and
              live-sync-loop-keeper REPORTED as never fired); lane-deliver
              skipped a missing gate in silence - refused unless
              --allow-ungated; a supersedes field withdraws by reference and
              the inbox orders by sent instant; an ack needs a note; the false
              "lane:inbox acks in one go" instruction is corrected by a
              superseding message, never by editing a record. Every fixed shape
              fails by name with the old code planted back (19/19 → 16/19,
              28/28 → 25/28); the lane-messages proof 44/44. Catalogs: three said
              a thing did not exist that did (change-window family, hardened
              scanner, normalization-version stamping - the first registered
              in FALSE_CLAIMS.json), "423 entries with per-row URLs" measured
              352/399/134, the tier-drift warning named four of seven
              under-graded actions, 19 iOS config keys deleted by #436 still
              listed, the spatial report's risk-dependent fail-open paragraph
              marked NOT adopted.
              Batch S (seventeenth round, #476) built the
              membership check the auditor specified: a citation into the
              launch profile that names an id and an arm is tested by importing
              SURFACES (180 ids, floored) and pairing the id with the status
              word that governs it through link material only - nearest-word
              pairing was measured first and produced 33 false mismatches
              across two attempts, each now a self-test case; live 246 arms
              hold, 0 contradict, 213 clauses unasserted and reported; ratchet
              membershipMismatches starts at 0. The 11 absent evidence
              fragments were 8 claim echoes (the gate quoting the row's own
              claim back at the cited file - now a status, not a defect), 2
              stale citations re-cited, 1 superseded sentence de-cited; ratchet
              evidence fragments absent 12 → 0. Self-test 41/41.
              Batch R (sixteenth round, #474) applied the 53 dispositions Q left:
              47 remove-actioned claims no longer render (priced tier features
              nobody built, vendor API calls no connector makes, notifications
              SignalGrid has no surface to send, latency figures no harness
              measured, a Linux desktop, PHI controls, bring-your-own PKI), 6
              render inside a hedge in their own line and are reclassified
              rewrite with the reason, 2 older rewrite rows fell with the same
              edits and are resolved; which was which was decided by the anchor
              gate's own match, never by eye. Ratchet remove-actioned still
              present 53 → 0, absent 0, evidence fragments absent 12 → 11;
              launch-claims 100 files 0 violations, docs ceiling 453 held;
              typecheck Done.
              Batch Q (fifteenth round, #473) held the claim inventory to its
              evidence as well as its surfaces: 1,066 citations checked (none
              missing, none past EOF; 53 drifted fragments re-anchored, 12 absent
              ratcheted, the rest of the first 67 were the gate's own heuristics
              and are fixed - backtick identifiers, nearest-citation windows,
              entities and source seams); 325 vanished quotations resolved with
              their removing commit (125 of them #253, the 2026-08-22 site
              rewrite); five site surfaces re-extracted (120 rows) and the
              findings fixed - OutcomesSection's exit-violation block asserted a
              dock/badge/location/PACS flow no noun in check-launch-claims
              matched (widened, measured first), "Nobody Owns This Gap" against
              MARKET_LANDSCAPE, two more unbacked clauses, an og:description
              without its hedge; the 64 remove-actioned rows still rendering read
              one by one: 54 STILL ASSERT what the tree does not back (queued
              with current text + proposed edit in
              docs/agent/CLAIM_REMOVE_DISPOSITIONS_2026-09-06.json), 9 were
              hedged at extraction (reclassified), and demoData.ts:465 - a
              prepared prospect answer calling fail-open "configurable per
              workflow category" - was fixed on sight. The anchor gate now fails
              a remove-actioned row that carries a resolution while its words
              still render.
              Batch P (fourteenth round, #471) built the three gates O specified and each found more
              than its brief: check-nan-fail-open rule 5 (a number|null field
              compared before Number.isFinite, in the evaluators) fired on nine
              sites in six evaluators against the O head - the deferred RTLS
              family graded a NaN fix age FRESH and a NaN dwell SHORT, macos-posture a NaN
              residual count HARDENED, app-update a NaN crash count "unstable"
              for the wrong reason, entitlement-binding a NaN depth or budget
              GOVERNABLE, session-readiness a NaN elapsed time READY; all five
              fixed with the honest grade, proofs extended (56/56, 73/73, 71/71,
              62/62 over 2,160 states, 63/63), each assertion fails by name
              against the reverted evaluator, mutation guard 0 survivors.
              check-claim-inventory-anchors (new) measured the claim inventory
              against its surfaces for the first time: 57 of the 58 README rows
              quoted the README #370 rebuilt on 2026-09-01 with no resolution
              (resolved), 46 line citations had drifted (re-anchored), 334 quoted
              claims are absent elsewhere and 64 remove-actioned claims still
              render (both RATCHETED, not fixed - Batch Q below); 58 README rows
              re-extracted against the current README, every quotation anchored
              and every cited path:line opened, and five README lines corrected
              from that evidence (:48, :60, :79, :103-105, :172).
              launch-profile.mjs said native/shared held one JSON file and 42
              vectors; it holds three files and the fixture 44.
              Batch O (thirteenth round, #470) read both plans end to end and
              the remainders: the EDR threat
              evaluator graded a NaN signature age PROTECTED (null → step_up;
              NaN fell between the arms) - Number.isFinite, proven, mutation
              fails by name; the morning's markdown-link repair had rewritten
              two QUOTATIONS in CLAIM_INVENTORY.json (reverted; the renderer
              escapes link syntax in the claim column); three of eight swiftlint
              custom rules could not match their subject (force_unwrap matched
              casts, force_cast matched nothing, weak_delegate fired on weak) -
              all three fixed, check-swiftlint-rules holds each to a planted
              positive and negative; three unbannered social files held
              paste-ready DMs/posts the send-copy gate could not see (bannered;
              the gate reads outbound headings now); both plans carried stale
              gate counts (175/179/180-odd vs 327) and rows still OPEN that the
              tree had closed (row 73's five bullets, 157, 122, 113) - dated or
              closed; Postman coverage now checks both directions by method.
              OPEN, recorded: 58 CLAIM_INVENTORY README rows quote a README
              rebuilt 2026-09-01; a claim-anchor gate and nan-fail-open rule 5
              (number|null compared without isFinite) are specified, not built.
              Batch N (twelfth round) read the
              send surface, the remaining docs families and the skills every
              role loads: four doc gates exempted ALL of .claude/skills as
              vendored while VENDORED.md says 12 are first-party - 96
              citations unchecked, 3 dead (exemption now DERIVED from the
              carve-out table); three skills retyped "three of six CI jobs"
              + the exact list ci-jobs.mjs records as the defect it replaced
              (derived answer 23 of 31; now a registered false claim with
              denials); three skills quoted the harness summary without its
              skipped field; loop-end shipped without the reviewer; the
              positioning SVG drew Remediate/Record and no Restrict (fixed;
              check-svg-outcome-ladder is new); docs/consolidation described
              the superseded cutover as pending (bannered); outreach T2 said
              "in our lab" about a marketing scenario (reworded); estate
              "five of seven" was three of six. Batch M (eleventh round) read docs/research,
              docs/company, docs/inspiration and docs/connectors: the Graph
              permission page told an admin to grant two scopes and "nothing
              else" hours after #463 gave the connector a third read (403 ->
              unknown without it) - fixed, and check-graph-permission-boundary
              holds tables <-> reads both ways; five company docs said 41
              duties beside a sixth saying 42 (ten rows + a probe now); 35
              relative links dead since the 2026-08-10 relocation, invisible
              to every gate (check-markdown-links is new); a pitch pack held a
              ready subject line under a retired label outside every claim
              scan (bannered; check-send-copy-banner is new); a checklist
              prescribed configurable fail-open; the battlecard turned "no
              evidence" into "they don't". Coverage: 83 / 10 / 7 of 100.
              Batch L (tenth round) read the loose docs: CI_AND_VALIDATION
              said "Fifteen workflow files" four days after the fifteenth was
              retired - a WORD numeral the figure sweep could not see (it reads
              words now, and the count is a row); ZERO_COST's "140 are
              *-proof.ts" never added up (143, now a row); 3,080 path:line
              citations were never bounded (ten past EOF; the cited-paths gate
              bounds them now, historical records declare themselves); the
              Ponytail audit cited 44 paths through this container's absolute
              prefix (rejected now); the Graph runbook required an env variable
              nothing reads (removed; check-env-doc-readers is new); the
              evidence-log reporter miscounted 19 of 33 records as incomplete
              (detector widened, count ratcheted at zero). One audit claim was
              REFUTED by the tree: "no gate reads docs HTML" - check-doc-html-
              figures has since 2026-09-02. Coverage: 82 read / 7 partial / 11
              not read of 100. Earlier the same day: Batch J (#456) with the
              Mac-lane second revision; the owner's Fleet Premium key was used
              the same hour in the cloud lab (#461: the adapter's team branch
              dropped every inherited policy - fixed and proven; the transfer
              endpoint answers 200 under Premium and SignalGrid still has no
              path to it - asserted; proof:live-fleet 52/52, workflow 21/21).
              Batch K (ninth round, #463) read the rest of lib/integrations
              and the twelve data directories: the device registry's Redis key
              folded ':' and '_' (two valid ids, one record), its allowlist
              opened on any value but the exact string 'true' AND on absence,
              the production enroll validated nothing, lastSeenAt was never
              consulted - all fixed behind pure helpers + proof:device-registry
              (52, mutations caught by name); Graph user risk read a field the
              live $select never asked for (now a real riskyUsers read, 403 ->
              unknown) and an unresolved owner was the identity 'unknown' (now
              null); three gates fail-opened (future heartbeat read as fresh,
              no tolerance = exempt, lab evidence never parsed) and one result
              named a commit the repo never held - the gate resolves commits
              now; sim requests carry requestedAt; lab-collections got its
              first gate; BUILD_BACKLOG restated liveEvidence=fresh while the
              tool printed STALE for 16 days - check-live-sync refuses restated
              statuses now. Coverage: 81 read / 4 partial / 15 not read of 100.
              EARLIER (2026-09-05) - Batch J (eighth round, now on mainline)
              read the partial and unread code: the simulator engine ALLOWS on a
              posture whose compliance is unknown/expired/absent (measured live;
              engine frozen, so a posture-allow wrapper + proof 189 + shared
              vectors + conformance gate, Swift twin REQUESTED from the Mac lane);
              the core kept the first-inserted reading on an exact observedAt tie
              (array order deciding, permissive direction) - worst-wins now; the
              WebAuthn proof could not tell six checks from their absence (72/72
              by reason string), an unbound challenge was checked against nobody,
              a no-id registration stored undefined; /readyz was limiter-exempt at
              seven DB round-trips per anonymous call (coalesced); x-request-id was
              hashed into the audit chain unbounded (shape-bounded); the phone's
              evidence seal was hardcoded green over a decoded-and-dropped
              verified:false, and StepUpGate had zero callers while Wardlink's
              cannot-ask offered a button that granted (uncompiled here - Mac build
              requested); the Bash hook allowed valid JSON with no command field and
              could not deny without jq; CLAUDE.md understated the harness gap ~5x.
              Records: EVIDENCE.md eighth entry, FALSE_CLAIMS +2, ledger +13 reads.
              EARLIER TODAY - EIGHT audit batches landed in one
              day (#438, #443, #444, #446, #447, #449, #451 merged; batch H on its
              PR): the unknown loosened the answer in fourteen libraries, two
              consoles, the desktop and PWA apps, the emulator and the Stop hook,
              each fix mutation-proven (docs/agent/EVIDENCE.md, six entries dated
              today). Batch H (sixth round) read the operating floor itself: the
              Stop hook's gate arm could never fire (loop:state exited 0 on every
              outcome), the Bash deny-list allowed any pattern behind `sh -c`,
              the SessionStart hook could not report Mac-lane mail, the iOS
              security scan passed green on a missing directory, the MDM proof
              held its load-bearing rule on the profile Fleet does NOT ship, the
              desktop rendered a green "No active alerts" for an unreachable
              feed, and two verdict sites fell back to neutral grey. All fixed and
              gated (#452 merged). Batch I (seventh round, on its PR): the
              shipping site linked 13 evidence URLs to a `main` branch that does
              not exist (every one 404'd live) - repointed and GATED
              (check-repo-links.mjs: default branch + tracked path, offline);
              site/index.html put inside the launch-claims scan (two violations
              on first contact, hedged); "17"/"16" on the site bound to their
              sources (check-site-figures.mjs), SIGNALS FUSED computed. OWNER
              DECISIONS: delete tests/load/ (k6 drivers targeting unserved
              routes), .agents/ (metadata for images that never existed) and
              site/index.html (superseded, not served) - the cloud lane cannot
              delete tracked files. Coverage ledger: 58 read / 9 partial / 33 not
              read; every remaining not-read surface is a docs family or a data
              directory.
              Also today: the public Room Entry console had coloured non_compliant
              GREEN and shipped a stale core (now gated), the reachability gate
              credited comments as imports (pin 8 -> 13, honestly), and the web
              client's fetch boundary got its first proof. Coverage ledger 34 read /
              10 partial / 56 not read of 100. FOUND, NOT FIXED (owner setting): the
              legacy Pages Jekyll build fails on every Alpha push; pages.yml expects
              Settings > Pages > Source = "GitHub Actions". Earlier today: the lane
              loop rebuilt on the
              owner's "not working and causing delay": scripts/lane-deliver.mjs
              (write + gate + commit + push + wake in one step, from a worktree at
              origin/SignalGrid_Alpha; Mac pushes mainline, cloud pushes a
              lane/cloud-mail-* branch and auto-merges it - mail never rides the
              code branch again), the standing mailbox PR #439 whose comments wake
              the cloud session, the steward moved 4h -> hourly and now opens a
              draft PR for every unmerged mac/* branch on sight, sentAt/ackedAt on
              every message with unread age named on every gate run (STALE beyond
              24h, reported never fatal). Also landed today: #438 (lib/location NAC
              ingest stamped observedAt from the ingest clock, so its freshness
              guard could never fire - fixed, 8 assertions, mutation-proven), and
              four more surface audits returned (handoff-sim, incident-playbook,
              integration-bridge, fleet-connector: all LATENT, one family -
              unknown/off-ladder/zero-signal read as permissive - queued as the
              next fix batch with orchestration + work-context + pim-activation).
              Prior 2026-09-05 (Mac lane) - three deliverables. (1) Ponytail
              native cuts part 1 on branch mac/ponytail-native-cuts (41b5ad87, pushed,
              mailed to cloud to review + land like #385): the identity-provider
              registry retired - MDM/MFA/Hybrid stubs, saml/custom, the plug-in
              factory replaced by an exhaustive two-arm switch over oidc |
              control_plane_session; an unrecognised IDENTITY_PROVIDER_TYPE now
              constructs NO provider and is named in the audit record, fail closed
              where the old code silently fell to the template config - plus the
              configuration service's dead surface (six presets, the updaters,
              SecurityConfig/BackendConfig and their env reads), setup.sh and
              run-code-analysis.sh, and the mobile theme's #13171A -> #15181B (review
              row 104). IdentityProvider.swift 837 -> ~430 lines; 11 files,
              +293/-1247. xcodebuild TEST SUCCEEDED 76/76 twice, swiftlint clean,
              the three iOS gates green, preflight PASSED 245, breadth 56 on the
              branch. (2) The owner-directed ECC full evaluation RUN, all six stages,
              in docs/agent/ECC_FULL_EVALUATION_2026-09-01.md: ECC security-reviewer
              over auth/decision/API - 0 Critical/High/Medium, 3 Low, all in modules
              unreachable from the live API; Schemathesis 4.4.4 against BOTH OpenAPI
              documents - 2,632 cases over all 59 /v1 operations, 0 server errors, 0
              permissive acceptances on /v1, the deviations being the contract
              under-documenting the server's fail-closed 401/404/429 and ten
              operations the server validates more strictly than it documents; seven
              backlog rows filed under "ECC full evaluation" in docs/BUILD_BACKLOG.md.
              (3) Inbox triage against the tree: the native-ledger branch is fully
              superseded (#385 landed it; its provenance comments and both
              request-signing findings are on mainline - nothing was undelivered);
              nine cloud messages acked 09-04, three more today (ECC, Ponytail, the
              iOS rows) with status; one left open on purpose - Fleet/Headwind's 7
              dimensions need live servers; the Fleet Premium half was CLOSED
              2026-09-06 in the cloud lab with the owner's key. Found and filed, not fixed: the AppWorkflows port lacks
              the TS per-action step-up release and check-decision-port-parity
              compares shape only, so it cannot see it (row 101 -> backlog; cloud's
              call on a golden-rule file). Prior 2026-09-04 (Mac lane) - the
              owner-shared Fechin/reference
              cheatsheet site (215 sheets) absorbed BY USE as the twelfth first-party
              skill, .claude/skills/stack-reference/: SKILL.md (five cross-cutting
              laws) + eight domain files holding 102 VERIFIED contradictions between
              generic cheatsheet advice and this repo's rules, each with the form to
              use instead - bash 3.2/BSD here vs bash 5/GNU on CI (28 shell traps,
              several SILENT: a stepped brace range loops once with garbage at exit 0,
              BSD sed \s matches nothing, GNU-only grep {,m} reports absent for
              present, BSD find unit suffixes pass here and fail in CI), the two
              hook-banned history/stash commands, npm for pnpm, main for
              SignalGrid_Alpha (a copied workflow condition that never fires),
              --expose for -p, short image names, fail-open casts/defaults/wildcard
              arms in Swift/Kotlin/Rust/TS, 403 where the API answers 404, PCRE
              syntax in Node RegExp gates - plus ~140 sheet items that survived
              contact. Nine reader agents ran the doubtful commands on this Mac.
              VENDORED.md ELEVEN->TWELVE + table row, section-E carve-out added
              (gate reads 12 = 12 = 12), skill-plane conformance 26 skills green,
              intake row logged, lane mail sent. Earlier today (Mac lane): #407
              OpenSSL confirmed ON HARDWARE (api image rebuilt, libssl3/libcrypto3
              3.5.8-r0, both CVEs absent, 0 Criticals); Firecrawl lane parity
              complete (owner key, env-only); android/desktop toolchain installed,
              android-core + desktop-core PASS, window-smoke blocked on the owner's
              Screen Recording grant. Prior 2026-09-04 (cloud lane) - three PRs
              merged, preflight+breadth green
              on every push, branch restarted from Alpha after each. #414 OmniRoute
              absorbed as the org's agent/build AI-gateway (DR-029, keys-out-of-tree,
              may never enter the decision path). #415 surface-review sweep findings
              1+3: verdict-attestation fail-open (a non-finite options.now/maxAgeMs/
              maxSkewMs silently disabled BOTH freshness checks - x > NaN is false -
              so a stale or future attestation verified; now fails closed to expired,
              proof 76->82) + a webauthn fossil-figure comment. #416 sweep finding 2,
              the one held for an on-tree mutation run: dual-control's authorizer
              `!plain` and `readThrew` disjuncts were labelled "genuinely inert" (a
              239-shape behavioural diff) but each is the SOLE guard on one shape the
              diff never generated - a NULL authorizer body and a throwing accessor.
              The null case was a live fail-open on the highest-blast-radius grant
              (with `!plain` forced false, approver:null read clean). Both proven
              load-bearing (proof 58->60, mutation killed 25->26), removed from the
              inert allowlist; the identical top-level twins ARE inert and now carry
              an inert-at-top marker so the allowlist can never launder the load-
              bearing terms. Lesson recorded in SELF_REVIEW.md: a behavioural diff
              proves nothing about a shape it did not enumerate. Prior 2026-09-03
              (cloud lane) - eleven PRs merged, each independently
              reviewed before landing, preflight+breadth green on every push,
              the branch restarted from Alpha after each. #399 gate-suite
              hardening (the coverage ratchet cannot be hand-lowered; three gates
              fail closed on an empty scan; a new walker-floors meta-gate). #400
              MCP ecosystem absorbed (DR-028): a fixture-first source-
              independence map + public-safe listing copy for SignalGrid's own
              read-only MCP server + a check-mcp-ecosystem-map gate. #401 the two
              MCP Market leaderboards absorbed by use + Mac-lane MCP/skills
              parity (one command, pnpm run mcp:setup) + a skill-plane-
              conformance gate + a research-ops skill (the one research gap).
              #402 iOS SwiftUI Phase 2 - the five linear session screens
              (Auth/Badge/Enroll/Provision/Terminate) converted UIKit->SwiftUI
              on the untouched core; parity review approved-with-notes; CI
              compiled every iOS target. #403 the remediation-allow Swift twin
              bound to the 40 shared vectors; function-by-function parity review
              approved-with-notes (exact parity, determinism clean, 5 prior
              twin-only fail-opens closed, nothing looser than canonical); its
              conformance gate flipped REPORTED->GATED and mutation-tested three
              ways; CI Swift jobs ran the twin's tests green. Review notes for
              #402/#403 mailed to the Mac lane. #405 the eight remediation-allow
              reason codes joined docs/REASON_CODES.md (generator was parsing
              decisionEngine.ts only), byte-equality + floor gated. #406 closed
              the CI OUTAGE and the determinism note in one: remediation-allow's
              instantMs now rejects zoneless instants as illegible (golden rule 2,
              twin already strict, 40 vectors byte-identical); and the daily
              mutation sweep - red on Alpha since 2026-09-02, which had blocked
              every merge once its 48h grace expired - was revived by pinning the
              local-authority freshness survivor and registering the emitter
              factory in place of eleven zero-mutation shells. Sweep re-dispatched,
              green across all four shards; ci-liveness fresh; Alpha carries the
              fix so its daily sweep stays green. #407 patched the critical image
              vuln the daily gate flagged - CVE-2026-63073 / CVE-2026-75803 in the
              node:22-alpine OpenSSL (libssl3/libcrypto3 3.5.7-r0 -> 3.5.8-r0) via
              apk upgrade in Dockerfile.api; verified by dispatching the daily gate
              on the branch (job went green on the rebuilt image). #408 (owner
              directive 2026-09-03: keep the Mac lane fully utilized) shipped the
              Mac lane's standing agenda + a sim-request bundling the uniquely-Mac
              verifications (evidence, docker, proofs-full) + the held steward
              heartbeat. #410 the launch-claims engineering-doc carve-out (task #67):
              an explicit verified path-map (mirroring CODE_LABEL_EXEMPT, three
              fail-safes falsified) so engine-branch prose in engineering docs no
              longer counts against the buyer-claim ceiling; independently reviewed,
              approved. #412 the Mac lane's Phase 3 (final SwiftUI screen,
              ActiveSession UIKit->SwiftUI) reviewed (approved - core untouched,
              deterministic, removes 3 old colour bugs) and landed; the iOS SwiftUI
              view-layer rebuild is now COMPLETE, and native/ios/README's file-tree
              was corrected to match.
BLOCKED ON: the FOUNDER's queue, now on one page (docs/agent/ORG_SELF_EVALUATION_2026-09-12.md,
              'The founder's queue'): Screen Recording for Terminal; 'yes' to the
              branch cleanup; pick the FIRST of
              the seven DR-033 product gaps (docs/BUILD_BACKLOG.md, the full-evaluation section);
              confirm or soften the ICP wording before the first outreach send (the gate is OPEN -
              run node scripts/check-readiness-figure.mjs); IP/disclosure posture; Fleet Premium
              before 2026-09-16 (DR-005 says do not renew); approve the ten Dependabot runs; the
              PURPOSE.md s2 widening (DR-035 follow-up); LightRAG: smaller local model, remote
              endpoint with his key, or leave it recorded as not-working. Nothing on the pipes is
              blocked: lane mail 111/111 acked, sim requests 17/17, evidence fresh (v77). AND, measured
              2026-09-14 16:36Z by running the authorizer against every open PR: ELEVEN PRs - #727,
              #730, #729, #723, #737, #732, #741, #742, #744, #745, #748 - are all REFUSED as
              owner-gated and cannot be landed by either lane however green. #730 closes the last
              readiness gap and has been green since 06:30. This is now the binding constraint on
              the whole build; nothing else in the queue moves until those merge.
NEXT ACTION: cloud: (000000) 2026-09-25 21:05Z: readiness is at goal; the binding constraint moves to the OWNER's two
              calls - merge #1050 (DR-058 proposal) or leave it, and the #1037 CodeQL call. The cloud keeps both green
              and conflict-free and does not press merge. Next bounded build from objective-state tasks[0..2] under the
              heartbeat-witness rule (row 5 EnterpriseShell badge/session lane -> real backend is #1, skill:signalgrid-native)
              - a proposal PR if it touches the decision core, DR-037 otherwise. Merge the 21:02Z mail PR when green.
              PREVIOUSLY: cloud: (00000) 2026-09-25 19:30Z: the Mac re-mints on mainline (the tick's queued evidence op, or by hand)
              and (b) reads 20/20 again - nothing in the cloud clears that. Meanwhile keep building one bounded item:
              next is the executor-gap auto hand (one aggregated stall in raised-hands.mjs for objective-state's
              needsExecutor rows, routed to blocker-dispatcher via hand-routing.json) - a proposal-free SAFETY_MACHINERY
              change; then #1037 stays the owner's CodeQL call and #1050 the owner's DR-058 merge. Merge #1058 when green.
              PREVIOUSLY: cloud: (0000) 2026-09-25 18:00Z: land #1051 under DR-037 when its preflight + breadth are green (then
              the Mac re-mints on mainline with --vm-native-build: (b) 20/20). Then DR-056 cloud follow-up 2 on top of
              #1019: auto-raise a hand for needsExecutor[] / stalled-top-task (raise-hand.mjs) and fold the steward cycle
              onto the shared state. Owner merges: #1050 (DR-058). Owner call: #1037 CodeQL. Superseded lines below
              are kept as history.
              PREVIOUSLY: cloud: (000) 2026-09-25: #1019 last - merge SignalGrid_Alpha into claude/raise-your-hand, regenerate,
              raised-hands --check, preflight + breadth, land on the owner's direction; the cloud sandbox refused the local
              merge (see LAST TOUCHED), so the Mac lane or the owner does the merge step, then close #1011 and #1014.
              Then #1031 (after the Mac's B1/B2), #1037 (after the Mac's CodeQL call), then merge mail PR #1039 once green
              and confirm the re-mint against fingerprint 7c15496c brings (b) back. The items below are DONE except
              where they name #1019/#1031/#1037: DR-043 carve landed as #1005; #753 closed; #905, #997, #929, #686 landed.
              (00) 2026-09-23: land the DR-043 live-attach carve (branch claude/build-dr043-live-attach-rules)
              as an OWNER-merged product PR, then close #753; follow-up: unknown enrollment or read method still
              allows on both matrices (golden rule 2) - a new rule, not part of the carve. Owner merges owed:
              #905 (DR-053), #997 (spec-kit hybrid), #929, #686. Before any local preflight in this box, build
              the api-server; read mail with lane:inbox, never lane-mailbox.json.
              (0) PR #905 (DR-052, renumbered DR-053 on 2026-09-23) is the OWNER's merge - it touches scripts/publication-boundary.mjs,
              which DR-037's owner-gated clause keeps out of the lane's hands; the lane keeps it green
              and conflict-free, never presses merge. Once it is on mainline, apply DR-053's three
              stages to the two resources the owner named on
              2026-09-20 (upstash/context7, nidhinjs/prompt-master): the independent scan and evaluation
              FIRST, the confirmation second, the coordinator's choice third, each recorded in
              docs/agent/RESOURCE_INTAKE.md; the prompt-master by-use trial is an open BUILD_BACKLOG row.
              (1) When the Mac tick returns: confirm mac-run.json re-minted against fingerprint
              6cc9a0eef68e5ca0 (v82) and readiness dimension (b) back to 100%; if the tick stays silent past
              the 24h escalation window, escalate the owner ONCE more with the same command. (2) DONE 10:45Z - the
              loop:state seam fix landed as #917 (f7f6a64e) with its 8-shape self-test. (3) The rows still open by lane in docs/BUILD_BACKLOG.md; the
              brace-less mutation ratchet one family per session. (4) The owner decisions the sweep
              surfaced and the lane MERGED on the owner's direction without a per-change decision record
              (exceptions to DR-037's owner-gated clause, EVIDENCE 2026-09-20): LAUNCH_PROFILE_VERSION 5->7 and two
              GAP removals (#869); the /v1/step-up/enroll/revoke classification (#866); the
              third_party/apple-device-management publication-boundary area (#864); the launch-profile
              edit in #854; plus the positioning sentence the launch-profile gate forced (#869) and the
              webhook write route's store (#868) - each needs a decision record the owner ratifies; the DecisionEngine/AppWorkflows re-port (backlog rows,
              owner call under DR-020). Then build: Puck 5, Puck 1, the smart-charging scenario behind a DR.
              Mac: reply to the blocker comments on #901 and #903 before pushing more to those branches;
              run the two queued 2026-09-18 sim requests (each re-mints evidence against the checkout at run
              time, so against v82; #910 names the fingerprint the result must carry - not a third request);
              read the inbox BEFORE any long measurement. Owner: the BLOCKED ON list, and the launchd tick.
## The three things that are true right now

1. **The doctrine is `docs/PURPOSE.md` v2 (DR-020).** SignalGrid is an
   **orchestrator**, not a gate: a decision is the *trigger for a cascade*. One
   credential carries a person through door, device, room and app. **The worker
   never sees it** - adoption is the product. Verticals are configuration, not
   code. It changes only on customer evidence or a correction of owner intent -
   never on internal preference, however good the argument.
2. **Nothing is frozen; claim discipline is unchanged.** DR-021 (2026-08-31)
   lifted the engineering freeze **in full**, on the owner's direction: every
   lane is open — cloud logic, connectors, proofs, native surfaces, API, and,
   with a decision record per DR-020's rule, verticals, platforms and hardware.
   What did NOT lift, and is not the freeze: the launch-claims gate, the
   launch-profile classification, the publication boundary and the no-overclaim
   rules. **Building something and claiming it ships remain two different acts;
   only the first is unfrozen**, and a change to what is *claimed* still needs
   its own decision record. *This line said "Two lanes are OPEN; the rest stay
   frozen" until 2026-09-02 — two days after this file's own STATE section
   recorded DR-021 — which is the contradiction a doc can hold against itself
   when no gate reads English.*
3. **Nobody has used the product.** 154 proof gates and four native surfaces do
   not change that number. Only a conversation does.

---

## When something wants to be built

It will. It will arrive well-argued, framed as fitting the doctrine, and it will
be *interesting*. That is the shape that gets through.

Two questions, in order:

1. **Does this make SignalGrid better at demonstrating, validating or deploying
   the moment-of-use decision and its cascade?**
2. **Is it LAB_001, the P0 wedge (Entra + Intune + one shared-device session
   workflow), or a blocker named by a real user?**

If either answer is no: write it in `docs/BUILD_BACKLOG.md` under *Discovered*
and move on. Do not do it now. Do not do "just the small version."

---

## If you have been away a while

You do not need to re-read any conversation, the doctrine, or the repo.

```bash
git pull
pnpm run loop:state
```

Then read the STATE block above and do the NEXT ACTION. That is the whole
recovery procedure. It is designed to work when you are tired, distracted, or
six weeks out - because that is the normal condition of one person building
something alongside a life.

---

## The two numbers that move the company

**Real signals decided on: 0.** LAB_001 Step 1 makes it 1.
**Conversations logged: 0 of 15.**

Everything else in this repository is finished enough. If a month passes and
both are still zero, the problem is not the product, the doctrine, the gates or
the plan - and no amount of work in any tool will fix it.
