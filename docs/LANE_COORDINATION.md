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

## The loop as of 2026-09-05, second revision — read this first

The first revision (below) fixed the cloud side: delivery on its own branch, an
hourly steward, a wake channel. The owner's verdict later the same day was still
"not working and causing delay". The evidence: six cloud→Mac messages unread for
hours, no Mac commit since 09-03, a Swift twin the cloud had pinned with vectors
and then WAITED for. Every one of those waits was on a **human opening a Claude
session on the Mac**. The fix is to take the human-started session off the path
of everything that does not need a physical Mac, and to give the physical Mac an
automatic tick for what does.

**Rule 1 — the cloud lane does anything CI's macOS runners can verify.** Swift
twins against pinned vectors, `xcodebuild`s, `swift test`, shell-script fixes
in Mac-owned files: `ios-ci.yml` compiles and tests every one of them on
`macos-latest` on the PR, and `mac-lane.yml` runs the full harness on dispatch.
Precedent, same day: `PostureAllow.swift` was written by the cloud lane and
proven by CI in the batch that pinned its vectors (#456) — the remediation-allow
twin had waited three days for the Mac. "Mac lane owns this file" now means the
Mac lane is the reviewer of record, not the only author; the cloud announces the
edit in the commit and the lane message, per protocol rule 2.

**Rule 2 — what genuinely needs the physical Mac runs from a tick, unattended.**
`scripts/mac/lane-tick.sh` runs every 30 minutes from launchd
(`bash scripts/mac/install-launchd.sh`, once, on the Mac): fetch, refuse a dirty
or non-Alpha checkout, run every pending sim request, push results on a
`mac/tick-<stamp>` branch, and HEARTBEAT (the mac-lane-tick file under artifacts/agent-heartbeats,
written by the first tick) on every path — quiet, acted, skipped and why. The cloud steward opens the PR for
each `mac/tick-*` branch within the hour and, when that heartbeat is older than
three hours, escalates to the owner once with the one install command: a Mac
that has gone silent is a signal, not a mystery.

**Rule 3 — mail asks a person for judgment, never for a build.** A cloud→Mac
message now carries only what a person must decide or physically do (enrol a
device in Fleet, plug in the dock, approve a deletion). "Please build X",
"please port Y", "please run the harness" are not mail: the first two are the
cloud's, the third is a sim request the tick runs.

**What the owner does, once:** on the Mac, `bash scripts/mac/install-launchd.sh`.
Then nothing — `bash scripts/mac/install-launchd.sh --status` shows it running.

## The loop as of 2026-09-05, first revision (superseded above; kept for history)

The owner's verdict on the loop below was "not working and causing delay". The
evidence agreed, and none of it was about the Mac:

- The cloud lane's acks and heartbeats rode its CODE branch, so they were held
  whenever that branch carried an open pull request — mail waited behind a
  ten-minute CI run it had nothing to do with, then behind the merge.
- Nothing woke the cloud lane when Mac mail or a `mac/*` branch landed. It
  looked every FOUR hours, then reviewed, then opened a PR, then waited for CI.
- Messages carried no instant, so nobody could say how long one had waited.
  "Delay" was a feeling; the gate could only say "unread".
- Delivery was three commands after the write, and the third was the one that
  got skipped.

What changed, and what each lane does now:

| | Mac lane | Cloud lane |
| --- | --- | --- |
| Write + deliver mail, an ack, a heartbeat | `pnpm run lane:deliver send\|ack\|heartbeat …` — pushed **straight to `SignalGrid_Alpha`** from a throwaway worktree; your checkout is untouched (`git pull --ff-only` when convenient) | same command — pushed to **`lane/cloud-mail-<stamp>`**, then the session opens the PR and enables auto-merge. Never the code branch. |
| Wake the other lane now | after a delivery, `lane:deliver` comments on the **mailbox PR** (`docs/agent/lane-mailbox.json`, PR #439) if `gh` is on PATH, else prints its URL — one comment there, from any device, wakes the cloud session | subscribed to the mailbox PR every session start and every cycle |
| A topic branch pushed for review | push `mac/<name>`; `lane:inbox` lists your branches mainline does not carry yet | **hourly** cycle opens a DRAFT PR for every unmerged `mac/*` branch at once (CI starts before the review), subscribes to it, reviews, lands or comments the blocker |
| How long has this waited | `lane:inbox` shows it per message; `check-lane-messages` names it on every run; unread beyond 24h is STALE (reported, never fatal) — for EVERY message: a message with no `sentAt` ages by the commit that delivered it (since 2026-09-06; before that it could never be stale) | same |
| Withdraw an instruction | `lane:deliver send "…" "…" --supersedes <id>` — the gate names the superseded message, the inbox prints it last under a banner; prose alone does not withdraw anything | same |

Rules that did not change: the push is the delivery; only the addressee closes
a message; unread is loud and never fatal; the sim-request loop still carries
WORK and this channel carries KNOWLEDGE. The mailbox PR is **never merged and
never closed** — it changes no files, so it never conflicts, and closing it
removes the wake channel.

## Current handoff — superseded 2026-09-05 by the section above (kept for history)

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

### State as of 575d4a9

- **PR #152, #202, #203, #204 and #205 are all MERGED.** Every branch they were
  on is auto-deleted. A local branch named after any of them is stale.
- `SignalGrid_Alpha` carries both lanes' capacity work: the Mac lane's
  `bench:decision-throughput` (in-process core) and the cloud lane's
  `test:load` / `test:stress` (the `/v1` HTTP surface). Neither number is the
  other; each header says so.
- **The request loop has completed a full round-trip.** The Mac lane ran
  `mac-capacity-baseline` and committed the result with its platform, commit and
  clean-tree state attached; the cloud lane read it without anyone relaying
  anything, and reshaped the capacity section of `PARTNER_ONBOARDING.md` around
  it. **One of three requests is answered; two are still owed** — and
  `node scripts/check-sim-requests.mjs` is the live answer to which, so do not
  trust this bullet over that command. **That gate is the handoff for
  verification work**; it needs no chat and no relay.
- Capacity figures live in `artifacts/sim-results/`, not in prose. The
  `PARTNER_ONBOARDING` capacity section deliberately quotes no throughput
  number: `test:load`/`test:stress` REPORT throughput rather than gate it, so a
  figure retyped into a document would be unowned by construction and would go
  stale in silence. Cite the result file instead.

### If you are the Mac lane, your next actions

```bash
git fetch origin --prune
git checkout SignalGrid_Alpha && git reset --hard origin/SignalGrid_Alpha && pnpm install
export SIGNALGRID_MCP_PATH=~/Public/Projects/SignalGrid/signalgrid-mcp
pnpm run sim:run-requests --plan          # what is queued
pnpm run sim:run-requests                 # run everything still owed
git add artifacts/sim-results && git commit -m "sim results" && git push
```

Both remaining requests can only be answered on a Mac, and one of them —
`post-merge-baseline` — refreshes `artifacts/live-evidence/mac-run.json`, which
`check-live-sync` still reports STALE against a pre-merge tree. **No hardware
run has yet validated the merged default branch**, which makes it the largest
unearned affirmative currently on the board and the one thing here only your
machine can close.

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
6. **A lane that DIAGNOSES a defect may FIX it, in any lane's work.** Standing
   authority, owner-granted 2026-08-23, recorded as DR-017.

   This rule exists because its absence cost six hours. The Mac lane found that
   `live-headwind` could never authenticate, read the decompiled war, and pinned
   the exact scheme — then handed it back rather than applying a one-line change,
   on the reading that rule 1 forbids patching into another lane's recent work.
   That reading was reasonable; nothing above actually said it. The ambiguity
   resolved toward caution, and caution here meant three round trips to move a
   fix the finder already held.

   So it resolves the other way now: **whoever has the diagnosis has the
   authority.** Two conditions, both cheap:
   - the fix is committed with the EVIDENCE that justifies it, so the other lane
     can audit rather than re-derive;
   - a lane message says what was touched and why, in the same push.

   The sim-request loop stays, and its purpose narrows to what it was always
   good at: PROVENANCE — a committed record that an operation ran, on what
   revision, with what result. It is not a permission gate and was never meant
   to be one. Do not queue a request to ask whether you may fix something you
   have already proven is broken; queue it so the run is on the record.

   What still hands back: a change that would alter a RATIFIED decision
   (docs/DECISION_RECORDS.md), widen the launch profile, or edit the byte-faithful
   Swift ports for behaviour. Those are boundary changes, not defect repairs.

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
