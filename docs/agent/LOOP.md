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
LAST TOUCHED: 2026-09-02 (Mac lane, latest) - PHASE 1 OF THE SWIFTUI REBUILD
              landed on mac/ios-shell-swiftui-phase1 (3c118917), mailed to
              cloud to review+land. The owner ran the shell, said it isn't
              looking the way they intended, and approved rebuilding the VIEW
              LAYER in SwiftUI (not ground-up): the intended design is the
              DEV/ios/Prototype "glance layer"; decision core + #387 plumbing
              stay untouched. Seam = SessionStateManager.viewController(for:)
              .lockedIdle -> UIHostingController, hosted INSIDE the UIKit
              lifecycle (SessionWindow / ScreenCaptureGuard / ASAM unchanged).
              DesignSystem+SwiftUI derives Color.sg* via Color(uiColor:) (never
              retyped); LockedIdleView = the prototype's composition in SG
              tokens with the UIKit behaviour verbatim (log rows, manual-login
              gate, keyboard-wedge sink); the 635-line LockedIdleViewController
              is retired. check-ios-dynamic-type now catches SwiftUI
              .system(size:) too. Verified: BUILD SUCCEEDED, ios-shell-repair
              8/8 against the new screen, a11y-XL wraps with NO truncation
              (closes the ellipsis), preflight PASSED, breadth 56/0. Glance
              card deferred (owner call). Next: Phase 2 (the linear session
              screens) once Phase 1 lands.
              Before that, same session: the iOS shell was BROKEN FOR THE
              OWNER; cloud's repair batch (#387) landed but had never met a
              compiler. Built + ran it green: BUILD SUCCEEDED (their ~1300 lines
              compile clean), ios-shell-repair 8/8 + everything-fast, clean
              provenance on Alpha. Step 6 (the 40 s loopback soak) had failed on
              EVERY run - root cause was a self-inflicted grep: saw_fatal matched
              the log-stream PREDICATE ECHO (the predicate filters FOR the words
              "fatal"/"crash"), not a crash; the app never crashed (proven: no
              crash report, only a harness simctl-terminate; isolated + post-churn
              40 s soaks both alive with the backend call succeeding). Fixed
              saw_fatal to strip the header (still catches a real fatal). Two
              visual findings mailed: demo shows a correct ActiveSession (the
              "kiosk could not be released" alert is honest on a non-supervised
              simulator); the a11y-XL lock screen wraps cleanly but the
              "Unmanaged device (...)" status line truncates at extra-large.
              Earlier this session - synced mainline into the
              lane, then delivered LAB_001 Step 1 with CLEAN provenance on
              mainline: the evidence op re-run on a clean afeb8c5e tree after
              #385 landed (reviewHubPass+mcpPass true), replacing the dirty-tree
              0a70c3ca run cloud had flagged pending. Refreshed the
              ios-dynamic-type sim result on current head. Closed backlog row 58,
              which the ExpiryPolicy type change had MOVED, not closed:
              SessionData is Codable and KeychainService.getSession restores it
              by decode, so a tampered blob decodes to .nonExpiring("") - the
              ignorance case relocated into persistence, granting a permanent
              session on the Assist gate's stale input. Hardened isExpired (a
              blank justification reads EXPIRED) and wrote the missing
              SessionExpiryTests (6 cases, falsified against the old fail-open),
              on branch mac/session-expiry-hardening - CI-green (swift 63/0,
              xcodebuild TEST SUCCEEDED 63/0, preflight PASSED, breadth 56/0) -
              mailed to cloud to review+land like #385. Also closed a delivery
              gap: evidence and acks had been landing on a side branch cloud
              cannot read; moved them to mainline and re-acked seven messages
              there. #385 landed the earlier native-ledger work independently.
              Before that, cloud's second full DR-024 cycle, eight PRs merged (#369-#376):
              Ponytail cut 3 and cut 4 (-20,300 dead lines), README rebuilt,
              DR-025 follow-ups, the docs truth sweep, batches A/B/C of the
              full-file sweep, the native sweep mailed to the Mac lane, the
              public-apis catalogue (DR-027), one freshness rule, the INDEX
              audit with two gates, and the verdict-core second read (three
              independent reviews; two real fail-opens closed, one of them
              present at the merged head). Every landing reviewed before it
              landed; preflight + breadth green on every push; CI green.
BLOCKED ON: (UNBLOCKED) the simulator remediation-allow TS wrapper + pinned
              vector table LANDED via #389 (bb23a449). The Mac lane can now port
              the Swift twin against the real wrapper shape - next native task.
              Still Mac-side, reported not fixed: MockSignalGridAPI's replayed
              vectors (waiting on cloud's parity gate), the DemoMode flag table
              verified on the simulator, and the equalToConstant rows at
              accessibility-extra-large - HostAppViewController has 5 fixed
              heights and 0 flexible, which is a live truncation risk now that
              the fonts scale. Row 58 (the Swift nil-expiry fail-open) is now
              FIXED on branch mac/session-expiry-hardening, pending cloud land.
NEXT ACTION: owner: discovery conversations (0 of 15) - nothing substitutes.
              owner decisions pending: fork or delete the two vendored agent
              definitions; the four pasted chat files under attached_assets/.
              Closed 2026-09-02 by the owner: the retired Codex reviewer's
              GitHub app uninstalled; the neural-memory upstream bug filed.
              cloud: the Mac lane's replies as they arrive; the next
              independent scan (connector families' emit paths).
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
3. **Nobody has used the product.** 141 proof gates and four native surfaces do
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
