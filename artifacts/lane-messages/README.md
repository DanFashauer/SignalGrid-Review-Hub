# artifacts/lane-messages — the lanes talk to each other through git

One JSON file per message, plus `acks/` — one JSON file per acknowledgement.
Committed, because the commit is the delivery.

## What lives here, and what does not

This directory carries what one lane needs the other to **know**: a branch
moved, a PR already exists, a gate flaked once and here is what could not be
determined. It does **not** carry work — work goes through
`artifacts/sim-requests/`, which names allowlisted operations and records what
actually executed, on which machine, at which commit. If a message finds itself
describing an operation to run, it should have been a request.

## Using it

```bash
pnpm run lane:inbox                                   # addressed to this machine, unread, with how long each has waited
pnpm run lane:inbox --all                             # including acknowledged
pnpm run lane:deliver send "subject" "body…"          # write to the other lane AND deliver it (one step)
pnpm run lane:deliver ack <id> "what I did"           # acknowledge, with the answer, AND deliver it
pnpm run lane:deliver heartbeat <routine> "quiet"     # a routine's firing evidence, delivered
pnpm run lane:deliver batch ops.json                  # several of the above in ONE commit
```

`lane:deliver` (since 2026-09-05) builds the commit in a throwaway worktree at
`origin/SignalGrid_Alpha`, runs this directory's gate inside it, pushes, confirms
with `git ls-remote`, and comments on the mailbox PR (`docs/agent/lane-mailbox.json`)
when `gh` is on PATH so the other lane wakes now. Your own checkout is never
touched. On the Mac the push goes straight to mainline; on the cloud it goes to a
`lane/cloud-mail-<stamp>` branch that the cloud session opens as a PR with
auto-merge — the cloud lane's credentials cannot push mainline directly, and mail
must never wait behind a code PR again.

`lane:send` and `lane:ack` still exist and only WRITE the file. A written file
is not a delivered message:

```bash
pnpm run lane:send "subject" "body…"      # write only
pnpm run lane:ack <id> "what I did"       # write only
git add artifacts/lane-messages && git commit -m "lane mail" && git push
```

Which lane you are is **derived, not declared**: macOS is the Mac lane — it is
the only machine that can run the hardware operations, which is the whole reason
two lanes exist — and everything else is the cloud lane. `SIGNALGRID_LANE`
overrides when that rule is wrong; a value that names no real lane is ignored
rather than obeyed, so a typo cannot invent a third lane nobody reads.

## The laws the gate enforces

`node scripts/check-lane-messages.mjs` runs in preflight and in CI, in both
lanes.

- **Unread is reported, never fatal.** Every unacknowledged message is named on
  every run. It does not fail the build: the other lane's machine is not always
  awake, and failing CI because somebody has not read their mail would be the
  dishonesty running the other way. Naming it is how it stays non-silent.
- **Every unread message has an age, and unread beyond 24h is STALE** (reported,
  never fatal). The instant is `sentAt` when the message carries one (schema 2,
  since 2026-09-05), else the commit that delivered it — the commit *is* the
  delivery. Until 2026-09-06 a message without `sentAt` could never be stale
  while one with an unparseable `sentAt` correctly was; the oldest unread message
  in the tree (13 days) printed with no age at all. Absent is never fresh.
- **A message can supersede another.** `lane:deliver send … --supersedes <id>`
  (or `"supersedes": ["<id>"]` in a batch op) withdraws an earlier message by
  reference: the gate names the superseded one, the inbox prints it last under a
  banner, and an id that names no message is fatal. A withdrawal that lives only
  as prose in a later body is not a withdrawal the reader can find — the inbox
  once printed a three-part work order above the notice cancelling it.
- **An ack carries a note.** The writer refuses a blank one (schema 2), the gate
  fails a blank schema-2 note and reports a blank schema-1 one — "I read it" must
  not look like "I did it". Round-trip time is measured from `ackedAt`, or from
  the ack's commit date for the 79 acks written before that field existed.
- **A lane cannot acknowledge its own message.** Only the addressee closes one.
  A sender's ack is refused and the message stays unread — otherwise "delivered"
  is self-certified, which is this repository's recurring defect wearing a hat.
- **Incoherence fails.** An unknown lane, a message addressed to its own sender,
  an ack for a message that was never sent, an empty body (it says nothing and
  still looks answered), an id that disagrees with its filename.

`node scripts/check-lane-messages.mjs --self-test` proves the gate can fail;
`pnpm run proof:lane-messages` proves the CLI enforces it live rather than only
in the pure audit.
