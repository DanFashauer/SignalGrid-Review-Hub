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
LAST TOUCHED: 2026-09-12 (cloud lane, latest) - OWNER-DIRECTED VENDORING (DR-038): the
              /watch skill from bradautomates/claude-video (pinned, hook NOT taken, two
              instructions overridden not edited) and the CLI-Anything method (the plugin
              directory under third_party/, the telemetry-bearing hub NOT taken) are in the
              tree, with two first-party skills around them: video-intake (frames via
              /watch, transcript locally with faster-whisper, no key, nothing uploaded)
              and cli-anything (the seven phases mapped onto a signalgrid CLI over /v1 and
              the MCP server, a backlog item). Vendored figure 14 -> 15, first-party
              exceptions TWELVE -> FOURTEEN, section E holds them. (Earlier 2026-09-12, Mac lane:) READINESS 94%, OUTREACH OPEN INSIDE THE TARGET
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
              caller poses, so a replayed snapshot never grants. 21 fixtures, a sweep of
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
BLOCKED ON: nothing cloud-side; Alpha is green. Cloud, to review + land:
              mac/ponytail-native-cuts (41b5ad87). Cloud, to decide: the AppWorkflows
              per-action step-up re-port and the parity-gate extension (backlog, row
              101). Mac lane, non-blocking, still open: Ponytail native cuts part 2
              (badge-reader registry, double delegate, nil-provider assertion); the
              residual Phase 2/3 nits (minor type-scale, the Enrolling contrast
              visual); SignalGridMobile adaptive tokens then the .dark pin (row 103);
              the twin test's per-field checks are conditional; older items
              (MockSignalGridAPI replayed vectors, DemoMode flag table).
              mac/native-ledger-2026-09-02 is CLOSED - fully superseded by #385 and
              later. Fleet/Headwind's 7 device dimensions: the Fleet half is DONE -
              the owner handed the Premium key to the cloud lane 2026-09-06; teams,
              inherited policies and the unlocked transfer endpoint are measured and
              proven (proof:live-fleet section 11, docs/FLEET_LIVE_INTEGRATION.md);
              Headwind's dimensions still need its live server. Owner, one item:
              Screen Recording permission for Terminal (System Settings > Privacy &
              Security > Screen Recording, then relaunch Terminal) - closes
              2026-09-02-android-desktop-first-run.
NEXT ACTION: cloud: land the plugin-packaging PR (DR-030) to SignalGrid_Alpha,
              then hold for owner direction. Batch Z landed earlier (049e3f8);
              the whole-repo review pass is complete and every surface is READ
              (now 102 of 102 with .claude-plugin and docs/reference added).
              Residual
              follow-ups, none blocking: (0) STATUS.md's "would run here now"
              column is cosmetically stale vs the F10 generator fix - no gate
              reads it and the generator cannot run to completion off a
              live-lane host, so regenerate it on the Mac lane or when a live
              lane is reachable; the two remaining localeCompare pinned
              defects (artifacts/mcp-server directory listing, self-audit
              fingerprint) are gated against growth, not fixed; the k6 load
              drivers no runner invokes (tests surface, COMPANY_BUILD_PLAN
              row 43). Owner decisions still recorded rather than made: the
              custody backstop blind to five custody axes (disclosed, pinned),
              NOT_COVERED credential exposure resolving to monitor, a GAPS
              entry for connector families unwired in the served core;
              (2) the console's remaining open items above (connector status
              rendered, the toaster, CATEGORY_ORDER derived, /sessions/:id
              linked) and Dashboard's chart-style deeper-path pending arms the
              error-state gate deliberately does not judge;
              the 194 symbols the cited-symbols gate leaves unpaired and the
              14 deny-list MENTIONS the skills gate reports are REPORTED, not
              owed;
              the 213 unasserted membership clauses are REPORTED, not owed -
              an evidence sentence that names an id without an arm is not
              wrong, only unchecked. OWNER: the ICP
              segment ("75-1,000 employees, 1-10 in IT") is stated flatly in
              INVESTOR_ONE_PAGER while ICP_EVIDENCE calls it an assumption -
              your call, not a gate's. OWNER, once, on the Mac, now that
              the installer is on mainline: `bash scripts/mac/install-launchd.sh`
              then `--status` - the steward escalates once a day while the tick
              stays silent. Mac lane (a person): nothing is owed; `pnpm run lane:inbox`
              only PRINTS the unread messages - an ack goes through
              `pnpm run lane:deliver batch <ops.json>` with a note per
              message (the eighteenth round made a blank note a refusal); a Premium
              re-run on the Mac is optional (FLEET_LICENSE_KEY in the env,
              `./scripts/run-live-lanes.sh --only fleet`) before 2026-09-16.
              EARLIER: land batch E, then keep reading unread surfaces (56 left; next
              lib/api-spec, lib/iac, then the docs families) and build the three
              gates batch E specified (NaN gate follows one helper hop;
              review-invariants flags localeCompare in lib/*/src with the five
              existing sites dispositioned; docs `path (N)` line counts
              re-measured); the hourly steward opens a draft PR for every mac/*
              branch on sight. Mac: use `pnpm run lane:deliver` and say whether gh
              is on PATH. owner: flip Settings > Pages > Source to "GitHub Actions"
              (the branch build has failed on every push since at least 09-04),
              then say so and the cloud lane runs the deploy workflow; say whether
              the three stale claude/* branches (ruleset-probe, two
              steward-heartbeat) may be deleted. owner: to wake the cloud lane at
              any moment, comment on PR #439 from the phone. owner:
              discovery is a valued input now, not the gate (DR-033, past Customer Discovery).
              owner: publish the MCP marketplace listing
              (docs/SIGNALGRID_MCP_MARKET_LISTING.md) on the creator page - only
              the owner has the login. owner decisions still pending: fork or
              delete the two vendored agent definitions; the four pasted chat
              files under attached_assets/.
```

**Customer Discovery as the operating phase ended 2026-09-10 (DR-033); the log stays open as an input.**
**Conversations logged: 0 of 15 - now a valued input, no longer the loop's gate.**

---

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
3. **Nobody has used the product.** 144 proof gates and four native surfaces do
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
