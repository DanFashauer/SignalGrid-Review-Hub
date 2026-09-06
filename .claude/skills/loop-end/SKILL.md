---
name: loop-end
description: End-of-session SignalGrid ritual — both gates, adversarial review, push, confirm on remote, update LOOP.md STATE last.
---
1. Run BOTH gates and paste the passing output of each: `./validate-sim-macos.sh`
   (compare "M failed" against 0 AND read the skipped count — a skip is not a pass)
   and `node scripts/preflight.mjs` (the per-push lane CI mirrors; add
   `pnpm run verify:breadth` when the change touches gates, doc figures or the
   launch surface). One gate is not both; CLAUDE.md says why.
2. Run the reviewer before anything leaves the machine: `signalgrid-reviewer`
   (adversarial pass, findings only — its own description says "before any push
   or PR"). Until 2026-09-06 this ritual skipped straight from gate to push, which
   is the miss the reviewer role was written from.
3. Commit and push (Dan approves when present; autonomous lanes push their
   own work per DR-021).
4. `git ls-remote origin <branch>` — the remote SHA must equal local HEAD.
   If not, push again; not done until it matches.
5. Update the STATE block in `docs/agent/LOOP.md` LAST.
6. Report in two lines: what changed, what's next.
