---
name: loop-end
description: End-of-session SignalGrid ritual — gate, push, confirm on remote, update LOOP.md STATE last.
---
1. Run the gate; paste the passing output.
2. Commit and push (Dan approves when present; autonomous lanes push their
   own work per DR-021).
3. `git ls-remote origin <branch>` — the remote SHA must equal local HEAD.
   If not, push again; not done until it matches.
4. Update the STATE block in `docs/agent/LOOP.md` LAST.
5. Report in two lines: what changed, what's next.
