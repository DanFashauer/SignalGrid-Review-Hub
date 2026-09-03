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
LAST TOUCHED: 2026-09-03 (cloud lane) - FIVE PRs merged, each independently
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
              #402/#403 mailed to the Mac lane.
BLOCKED ON: nothing cloud-side. Mac lane, non-blocking, from the mailed review
              notes: the SwiftUI Phase 2 nits (a decision colour on one
              non-decision checkmark, type-scale drift, one inline font, a button
              contrast to eyeball); the twin's ISO8601 parser is stricter than JS
              Date.parse on non-RFC3339 instants (fail-closed, documented -
              literal bit-parity would need a shared strict parser); the twin
              test's per-field checks are conditional; and the older open items
              (MockSignalGridAPI replayed vectors, DemoMode flag table on the
              simulator, the equalToConstant rows at accessibility-XL).
NEXT ACTION: owner: discovery conversations (0 of 15) - nothing substitutes.
              owner: publish the MCP marketplace listing
              (docs/SIGNALGRID_MCP_MARKET_LISTING.md) on the creator page - only
              the owner has the login. owner decisions still pending: fork or
              delete the two vendored agent definitions; the four pasted chat
              files under attached_assets/. Mac lane: run pnpm run mcp:setup and
              fold the #402/#403 review notes. cloud: the Mac lane's replies as
              they arrive; the next independent scan (connector families' emit paths).
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
