# Lane coordination — multiple Claude sessions, one repository

The owner runs SignalGrid work in parallel Claude lanes. They have already
collided once: the Mac lane and the cloud lane independently implemented nac
discipline and webhooks gating, and reconciling the 8-file conflict cost a
merge commit and an owner decision (PR #152, merge `d125a0a`). This file is
the standing protocol that keeps that from recurring. It is committed so every
lane loads it; CLAUDE.md points here.

## The lanes

| Lane | Session | Branch | Scope |
| --- | --- | --- | --- |
| Cloud (this file's author) | `session_01D3GJ2Fs8sVppPgzuJdnNLn` | `claude/signalgrid-launch-plan-emxm01` (PR #152) | Decision fabric: connector families, core /v1, proofs/gates, MCP server, docs, intake ledger |
| Mac | `session_01N7uHGuc22upGPW3AZvHLAn` | pushes to `SignalGrid_Alpha` | iOS/EnterpriseShell, local harness (`validate-sim-macos.sh`), Mac-side verification |

Sessions cannot read or message each other (cross-session triggers are
disabled for this organization). The coordination bus is THIS FILE plus the
git history — and the owner, who sees both chats.

## The protocol

1. **Check before touching a SHARED SURFACE.** These files serialize across
   lanes; whoever touches one should expect the other lane has too:
   `scripts/check-connector-discipline.mjs` (KNOWN_GAPS), `scripts/mutation-guard.mjs`
   (TARGETS/ALLOWED), `artifacts/sync/live-sync-manifest.json` (regenerate,
   never hand-edit), `scripts/preflight.mjs` + `.github/workflows/review-hub-ci.yml`
   (proof registration), `lib/integrations/package.json` (subpath exports),
   and any connector family the other lane's recent commits name.
2. **Announce in the commit, not just the chat.** A lane starting work on a
   shared surface says so in its next commit message ("touches
   check-connector-discipline; cloud lane coordinate before merging"). Chat
   context dies with the session; git history does not.
3. **The cloud lane absorbs base movement.** When `SignalGrid_Alpha` moves,
   the cloud lane merges it into the PR branch promptly (owner-approved
   standing resolution: prefer the deeper implementation, verify file by
   file, keep both when complementary — the webhooks dual-gate is the
   precedent). The Mac lane does not need to rebase around PR #152.
4. **Don't re-implement what the other lane shipped.** Before building a
   gate, family, or proof, `git log --oneline -20` on BOTH `SignalGrid_Alpha`
   and `origin/claude/signalgrid-launch-plan-emxm01` — five seconds that
   saves an eight-file conflict.
5. **Keep this table current.** A lane that changes branch, scope, or goes
   dormant updates its row in the same commit as the change.

## Standing hazards (learned, not hypothetical)

- `validate-sim-macos.sh` runs `pnpm add -w` and rewrites `package.json` /
  `pnpm-lock.yaml` — Mac lane only, never in the cloud lane.
- `scripts/mutation-guard.mjs` mutates working-tree files; never run it
  concurrently with anything else in the same checkout.
- The sync manifest is generated (`node scripts/generate-sync-manifest.mjs`);
  a hand-edit or a stale copy fails `check:live-sync` on the next push.
