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
LAST TOUCHED: 2026-08-31 - DR-020 record written, DR-021 lifted the freeze;
              PRs #336/#337 merged; ECC's first pass found 4 fail-closed
              inversions in the #336 tooling (being fixed).
BLOCKED ON:   nothing
NEXT ACTION:  send 8-10 warm reconnection messages (conversations logged:
              0 of 15), and LAB_001 Step 1 - point the macOS posture
              connector at signalgrid-mcp so the core decides on a real
              signal.
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
2. **Two lanes are OPEN; the rest stay frozen.** Mac/iOS and API/Bruno/Postman
   are open, because invisibility cannot be proven in a container and for a
   product that connects systems the API surface *is* the product. Cloud logic,
   connectors, proofs, new verticals, platforms and hardware remain frozen.
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
