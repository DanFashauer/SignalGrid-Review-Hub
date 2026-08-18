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
pnpm run lane:inbox                       # addressed to this machine, unread
pnpm run lane:inbox --all                 # including acknowledged
pnpm run lane:send "subject" "body…"      # write to the other lane
pnpm run lane:ack <id> "what I did"       # acknowledge, with the answer
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
- **A lane cannot acknowledge its own message.** Only the addressee closes one.
  A sender's ack is refused and the message stays unread — otherwise "delivered"
  is self-certified, which is this repository's recurring defect wearing a hat.
- **Incoherence fails.** An unknown lane, a message addressed to its own sender,
  an ack for a message that was never sent, an empty body (it says nothing and
  still looks answered), an id that disagrees with its filename.

`node scripts/check-lane-messages.mjs --self-test` proves the gate can fail;
`pnpm run proof:lane-messages` proves the CLI enforces it live rather than only
in the pure audit.
