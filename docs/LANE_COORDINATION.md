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
| Cloud (this file's author) | `session_01D3GJ2Fs8sVppPgzuJdnNLn` | `claude/signalgrid-launch-plan-emxm01`, restarted from the default branch after each merge | Decision fabric: connector families, core /v1, proofs/gates, MCP server, docs, intake ledger, the simulation request loop |
| Mac | `session_01N7uHGuc22upGPW3AZvHLAn` | topic branches off `SignalGrid_Alpha`, merged by PR | iOS/EnterpriseShell, local harness (`validate-sim-macos.sh`), benches, Mac-side verification and the only lane that can run the hardware operations |

PR #152 — the launch spine — merged on 2026-08-12, along with #202, #203 and
#204. The cloud lane's branch name is reused rather than retired: it is
restarted from the default branch after every merge, so a branch that appears
in an old PR link is not the branch that exists now.

Sessions cannot read or message each other (cross-session triggers are
disabled for this organization). The coordination bus is THIS FILE plus the
git history — and the owner, who sees both chats.

## Current handoff — read this first (updated 2026-08-12)

**The owner is not a message bus.** They are phone-first and at the remote
office only a few hours a day, so a lane that needs the other lane to know
something WRITES IT DOWN and pushes. Do not ask the owner to relay between
sessions. Direct session-to-session messaging is not a substitute: it has proved
one-way in practice (cloud→Mac sends returned HTTP 401), it is invisible to the
owner, and it leaves no artifact — so a claim about what the other lane was told
is unverifiable afterwards.

**Since 2026-08-12 there is a channel, and this file is no longer where you type
a message.** Run it on both machines:

```bash
pnpm run lane:inbox                       # what the other lane needs me to know
pnpm run lane:send "subject" "body…"      # write back
pnpm run lane:ack <id> "what I did"       # close one, with the answer
git add artifacts/lane-messages && git commit -m "lane mail" && git push
```

The push is the delivery. Until an ack is pushed,
`node scripts/check-lane-messages.mjs` names the message as UNREAD on every run
of preflight and CI, **in both lanes** — so an unread message is loud without
being fatal (the other machine is not always awake, and failing a build over
somebody's unread mail would be the dishonesty running the other way). A lane
cannot acknowledge its own message; only the addressee closes one. That is the
same law the request loop enforces one layer down, where a refusal never closes
a request.

Division of labour between the two channels: **`artifacts/sim-requests/` carries
WORK** — named, allowlisted operations and the record of what actually ran, on
which machine, at which commit. **`artifacts/lane-messages/` carries KNOWLEDGE** —
what one lane needs the other to know. If a message finds itself describing an
operation to run, it should have been a request. This file keeps the standing
protocol below; it is no longer the inbox.

### State as of 41ce4d2

- **PR #152, #202, #203, #204 and #205 are all MERGED.** Every branch they were
  on is auto-deleted. A local branch named after any of them is stale.
- `SignalGrid_Alpha` carries both lanes' capacity work: the Mac lane's
  `bench:decision-throughput` (in-process core) and the cloud lane's
  `test:load` / `test:stress` (the `/v1` HTTP surface). Neither number is the
  other; each header says so.
- The simulation request loop is live. `artifacts/sim-requests/` holds three
  queued requests; `node scripts/check-sim-requests.mjs` says what is still
  owed at any moment. **That gate is the handoff for verification work** — it
  needs no chat and no relay.

### If you are the Mac lane, your next actions

```bash
git fetch origin --prune
git checkout SignalGrid_Alpha && git reset --hard origin/SignalGrid_Alpha && pnpm install
export SIGNALGRID_MCP_PATH=~/Public/Projects/SignalGrid/signalgrid-mcp
pnpm run sim:run-requests --plan          # what is queued
pnpm run sim:run-requests                 # run everything still owed
git add artifacts/sim-results && git commit -m "sim results" && git push
```

Two of the three queued requests can only be answered on a Mac, and one of
them refreshes `artifacts/live-evidence/mac-run.json`, which `check-live-sync`
still reports STALE against a pre-merge tree — no hardware run has yet
validated the merged default branch.

### One open observation, offered not asserted

`bench:decision-throughput` failed once inside a full preflight on a 4-core
Linux container, passed on rerun, and passed under deliberate CPU contention
(1.63–1.81x scaling against a 1.0x threshold). Which assertion failed is
UNKNOWN — the cloud lane truncated preflight's diagnostic output and lost it,
so there is no evidence and no conclusion, only a note to watch it. If it
recurs on Mac hardware, the shape worth considering is making "no parallel
collapse" a collapse detector (N cores not SLOWER than one) rather than a ratio
target — the same reasoning behind that bench's own 6,000x floor headroom.

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

3. **Both lanes appended gate steps on the same day** (2026-08-12; cloud #204,
   Mac #205). The cloud lane added `proof:sim-requests`, the sim-request gate
   and `test:load`; the Mac lane added `bench:decision-throughput`. Both edited
   `scripts/preflight.mjs`, `.github/workflows/review-hub-ci.yml` and both
   `package.json` files — the shared surfaces rule 1 names — within hours of
   each other, neither having read the other's commits first.

   **Recorded because it did NOT become the eight-file conflict, and the reason
   is worth generalising: both changes were APPENDS to a list.** Two lanes
   adding steps to the same gate suite do not disagree; two lanes rewriting the
   same gate do. Whoever merges second rebases and keeps BOTH sets of steps, and
   the resolution is mechanical rather than a judgement call. #204 landed first,
   so #205 carries the rebase.

   The near-miss that would NOT have been mechanical: the two benches measure
   different things — `bench:decision-throughput` is the in-process decision
   core, `test:load` is the `/v1` HTTP surface, and each publishes its own
   number in its own output rather than here (a capacity figure restated in a
   coordination doc is a figure nothing re-measures). Had either lane assumed
   the other's number was the same number, the repo
   would have grown two contradictory capacity claims. They are complementary
   and each says so in its own header — the gap between them is the transport.
   If a future pair of lanes measures the same thing twice, rule 4 applies and
   one of them is redundant; if they measure different things, both stay AND
   each must name what it is not.
