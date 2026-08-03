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

## Collision log

Kept because the protocol above is only as persuasive as the evidence that it is
needed. Both entries are real, both cost real time.

1. **nac + webhooks, eight files** (PR #152, merge `d125a0a`) — the reason this
   file exists. Both lanes independently implemented nac discipline and webhooks
   gating. Resolved by preferring the deeper nac implementation and keeping BOTH
   webhook gates as complementary layers.
2. **`scripts/src/mcp-server-proof.ts`, add/add** — both lanes noticed on the same
   day that the MCP server was the only answer-producing surface with no
   behavioural proof, and both wrote one. Rule 4 ("`git log` both branches first")
   would have caught it and neither lane ran it.
   **Resolved by keeping both, because they ask different questions.** The Mac
   lane's `proof:mcp-server` boots the PUBLISHED plugin path through the vendor's
   own SDK client and asserts the served surface equals the surface the live-sync
   manifest declares — it catches a server that will not start, a handler that
   throws, a manifest that has drifted. The cloud lane's proof, renamed to
   `proof:mcp-answer-discipline`, speaks the raw wire and asks whether what is
   served is EARNED — it caught `source_health ?? "healthy"`, which made a caller
   who asserted nothing indistinguishable from one who asserted everything. A
   server passes either while failing the other, so discarding one to resolve a
   filename collision would have discarded a live gate.
   **What the auto-merge silently produced, worth knowing:** duplicate
   `"proof:mcp-server"` keys in BOTH `package.json` files. Duplicate JSON keys are
   valid and last-one-wins, so a gate can disappear without any parser complaining.
   Whenever this merge lands on a shared registry file, `grep -c` the key.

3. **A root `prepare` hook broke the prod image, and only CI could see it.** The Mac
   lane added `"prepare": "node scripts/install-git-hooks.mjs"` to the root
   `package.json`. `Dockerfile.api` deliberately copies a MINIMAL slice of `scripts/`
   — the workspace manifest plus the one hook entrypoint it knew about — so the new
   file was not in the image and `pnpm install` died inside `docker build` with
   `Cannot find module '/app/scripts/install-git-hooks.mjs'`. Every local gate stayed
   green, because every local gate reads source.
   **Two things are worth carrying forward.** First, it surfaced on the cloud lane's
   PR before the base branch's own CI showed it, because GitHub builds the PR MERGE
   ref — my branch plus the current base — so a lane can be broken by a base commit it
   has not merged yet. Checking `mergeable_state` is not enough; the merge ref runs
   code neither branch has in isolation. Second, `install-git-hooks.mjs` is written to
   be non-fatal in every branch (it exits 0 on CI, on a missing `.git`, on a missing
   hook file) and none of that care survived the file being ABSENT, because
   `node <missing file>` fails before its first line runs. **A script's own defensive
   handling cannot cover the case where the script is not there.**
   Resolved by copying the entrypoint in both Dockerfiles — which also surfaced that
   `Dockerfile.web` had never copied `scripts/` at all and would have failed on the
   OLDER `preinstall` hook for anyone who built it, latent because the compose smoke
   only builds the API image — and by deriving the requirement instead of remembering
   it: `scripts/check-docker-lifecycle-copy.mjs` reads the root lifecycle hooks out of
   `package.json` and fails if any Dockerfile that runs `pnpm install` does not carry
   their entrypoints. Wired into preflight and CI, since the compose smoke is one of
   the three CI jobs preflight does not mirror.

## Standing hazards (learned, not hypothetical)

- `validate-sim-macos.sh` runs `pnpm add -w` and rewrites `package.json` /
  `pnpm-lock.yaml` — Mac lane only, never in the cloud lane.
- `scripts/mutation-guard.mjs` mutates working-tree files; never run it
  concurrently with anything else in the same checkout.
- The sync manifest is generated (`node scripts/generate-sync-manifest.mjs`);
  a hand-edit or a stale copy fails `check:live-sync` on the next push.
