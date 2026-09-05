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
LAST TOUCHED: 2026-09-05 (cloud lane, latest) - EIGHT audit batches landed in one
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
              gated. FOUND, NOT FIXED, next PR (batch I): the shipping site links
              13 evidence URLs to a `main` branch that does not exist (every one
              404s live), `site/index.html` is unpublished AND outside the
              launch-claims scan while asserting deferred capability, About.tsx
              claims a deferred signal. OWNER DECISIONS: delete tests/load/ (k6
              drivers targeting unserved routes) and .agents/ (metadata for
              images that never existed) - the cloud lane cannot delete tracked
              files. Coverage ledger after H: 58 read / 9 partial / 33 not read.
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
              dimensions need live servers and the owner's Premium decision by
              2026-09-16. Found and filed, not fixed: the AppWorkflows port lacks
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
              later. Fleet/Headwind's 7 device dimensions: needs the live servers
              stood up on the Mac; the Premium-only getPolicies() branch needs the
              owner's licence key or, per DR-005, the deferred/unverified-premium
              mark on 2026-09-16. Owner, two items: Screen Recording permission for
              Terminal (System Settings > Privacy & Security > Screen Recording, then
              relaunch Terminal) - closes 2026-09-02-android-desktop-first-run; and
              the Fleet Premium decision above before 2026-09-16.
NEXT ACTION: cloud: land batch E, then keep reading unread surfaces (56 left; next
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
3. **Nobody has used the product.** 142 proof gates and four native surfaces do
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
