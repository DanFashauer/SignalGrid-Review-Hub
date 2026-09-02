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
LAST TOUCHED: 2026-09-02 - Mac lane cleared the native ledger on branch
              mac/native-ledger-2026-09-02 (c2b61057 + 04c911e3): both standing
              HIGHs closed, three BackendService paths corrected against the
              served route table and three URLs that NO route serves marked
              declared-not-implemented rather than prefixed, the silent 404 on
              audit upload closed, four MDM facts a launch argument could forge
              made simulator-only, the binding key's attestation recorded
              instead of a random UUID standing in for a missing serial, 317
              lines of USB-C reader made reachable, and Managed App Config
              wired where a comment had promised a fallback that was never
              written. New shared surface: check-ios-dead-stored-properties,
              which rediscovers the reported HIGH at its exact lines and found
              six more. BUILD SUCCEEDED, 57/57 iOS tests, preflight 217/0,
              validate-sim-macos.sh 140/0/7 with the derived count confirmed
              at 5. Five lane messages acknowledged.
              Before that, cloud's second full DR-024 cycle, eight PRs merged (#369-#376):
              Ponytail cut 3 and cut 4 (-20,300 dead lines), README rebuilt,
              DR-025 follow-ups, the docs truth sweep, batches A/B/C of the
              full-file sweep, the native sweep mailed to the Mac lane, the
              public-apis catalogue (DR-027), one freshness rule, the INDEX
              audit with two gates, and the verdict-core second read (three
              independent reviews; two real fail-opens closed, one of them
              present at the merged head). Every landing reviewed before it
              landed; preflight + breadth green on every push; CI green.
BLOCKED ON: the simulator remediation-allow path, and the block has MOVED to
              the cloud lane by agreement: cloud writes the TS wrapper and its
              proof first, the Mac lane ports the Swift twin second, because
              the wrapper's shape is a design call and a Swift half written
              against a guess is byte-parity only by luck. Cloud mails the
              vector list when it lands.
              Still Mac-side, reported not fixed: MockSignalGridAPI's replayed
              vectors (waiting on cloud's parity gate), the DemoMode flag table
              verified on the simulator, and the equalToConstant rows at
              accessibility-extra-large - HostAppViewController has 5 fixed
              heights and 0 flexible, which is a live truncation risk now that
              the fonts scale.
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
3. **Nobody has used the product.** 140 proof gates and four native surfaces do
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
