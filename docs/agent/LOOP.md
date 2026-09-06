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
PHASE:        Build + Customer Discovery in parallel. Engineering UNFROZEN
              (DR-021, owner directive 2026-08-31); absorption mode - owner
              feeds resources, the repo absorbs them. Claim discipline
              unchanged.
LAST TOUCHED: 2026-09-06 (cloud lane, latest) - Batches K (#463), L (#465),
              M (#466), N (#468), O (#470), P (#471), Q (#473), R (#474) and
              S (#476), T (#477), U (#480) and V (#482) LANDED. Batch W
              (twenty-first round, on its PR) fixed the console's fourteen
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
NEXT ACTION: cloud: land Batch W (on its PR), then (1) Batch X - docs/company
              (scratchpad batch-x-company-findings.md:
              the investor one-pager's "in flight"/"live" over an empty
              outreach log, three false "no cost figure appears" absolutes the
              2026-08-21 lens review already named, iam 2/5/15, 47 vs 48
              families, v4/174 vs v5/180) plus docs/company into the buyer-
              facing claims scan and a REPORT of unbackticked path:line
              citations; (2) the six surfaces the ledger still marks partial
              (docs/*, docs/agent, docs/inspiration, docs/research,
              artifacts/api-server, scripts) - read them, not their indexes;
              (3) the console's remaining open items above (connector status
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
              discovery conversations (0 of 15) - nothing substitutes.
              owner: publish the MCP marketplace listing
              (docs/SIGNALGRID_MCP_MARKET_LISTING.md) on the creator page - only
              the owner has the login. owner decisions still pending: fork or
              delete the two vendored agent definitions; the four pasted chat
              files under attached_assets/.
```

**Experiment started: 2026-08-27**
**Conversations logged: 0 of 15 - Commitments: 0**

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
