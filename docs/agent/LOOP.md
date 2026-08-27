# LOOP — where SignalGrid actually is

**Read this first, in any tool. Update it last, before you close anything.**

One page. If it grows past one page, it has stopped working.

---

## The loop

```
START  →  read this file (2 min)
          run `pnpm run loop:state`      ← catches what fell between tools
          ↓
WORK   →  one task, in one tool
          ↓
END    →  update the four lines below (3 min)
          push, and confirm it landed
```

Ten minutes a week keeps this alive. Skipping the END step is how a week
disappears — that is exactly how Phase 0 sat unpushed while every tool
individually reported success.

---

## Which tool for what

| Tool | Use it for | Do not use it for |
| --- | --- | --- |
| **Chat (here)** | Thinking, strategy, research, reviewing evidence, arguing with me | Editing the repo |
| **Claude Code** | Patches, gates, tests, anything touching files | Deciding what to build |
| **Cowork** | Documents, discovery notes, spreadsheets, non-repo work | Code |

**The rule that matters:** the tool that *decides* is never the tool that
*builds*. Decisions come here or from you; Claude Code executes them. That
separation is what stopped the freeze dying quietly when a well-argued
networking proposal arrived.

---

## STATE — update these four lines every session

```
PHASE:        Customer Discovery. Engineering frozen.
LAST TOUCHED: 2026-08-27 · Phase 0 patches applied locally, push to Review Hub unconfirmed
BLOCKED ON:   confirming phase0/doctrine-alignment reached the Review Hub
NEXT ACTION:  send 8–10 warm reconnection messages
```

**Experiment started: 2026-08-27**
**Conversations logged: 0 of 15 · Commitments: 0**

---

## The three things that are true right now

1. **The doctrine is frozen.** `docs/PURPOSE.md` is canonical (DR-019). It
   changes only on evidence from customer discovery — never on internal
   preference, however good the argument.
2. **Engineering is stopped.** No new connectors, verticals, platforms, proofs,
   IA work, or polish. It resumes only when the demo fails to communicate the
   thesis, or a real user names a blocker.
3. **Nobody has used the product.** 140 proof gates and four native surfaces do
   not change that number. Only a conversation does.

---

## When something wants to be built

It will. It will arrive well-argued, framed as fitting the doctrine, and it will
be *interesting*. That is the shape that gets through.

Two questions, in order:

1. **Does this make SignalGrid better at demonstrating, validating or deploying
   the moment-of-use session decision?**
2. **Is it the P0 wedge — Entra + Intune + one shared-device session workflow —
   or a blocker named by a real user?**

If either answer is no: write it in `docs/BUILD_BACKLOG.md` under *Discovered*
and move on. Do not do it now. Do not do "just the small version."

---

## If you have been away a while

You do not need to re-read this conversation, the doctrine, or the repo.

```bash
git pull
pnpm run loop:state
```

Then read the STATE block above and do the NEXT ACTION. That is the whole
recovery procedure. It is designed to work when you are tired, distracted, or
six weeks out — because that is the normal condition of one person building
something alongside a life.

---

## The only number that moves the company

**Conversations logged: 0 of 15.**

Everything else in this repository is finished enough. If a month passes and
that number is still zero, the problem is not the product, the doctrine, the
gates or the plan — and no amount of work in any tool will fix it.
