# Raised hands (DR-054)

Durable blocker records. When any lane, routine, gate, or session gets stuck and cannot
clear it alone, it **raises its hand** here instead of failing silently — the fail-closed
rule applied to its own progress.

- **Raise one:** `node scripts/raise-hand.mjs --doing "…" --blocked "…" --need "…" --domain <d> --who <owner|other-lane|tool:x>` writes `<date>-<slug>.json`.
- **Take one before working it:** `pnpm run hand:take -- <id>` (so two sessions never work the same hand).
- **Monitor:** `node scripts/check-raised-hands.mjs` (also surfaced by `loop:state` and the Mac tick) reports every OPEN hand, routes each to the org-roster role that owns it, and flags any with **no owner** as a capability GAP.
- **Everything stuck + the gate + the owner's page:** `pnpm run hands` (`scripts/raised-hands.mjs`) adds the stalls nobody raised a hand for, fails preflight/CI when one sits past 3× its limit uncovered, and feeds the hourly `raised-hands` issue.
- **Address one:** the `blocker-dispatcher` agent routes it to that role's executor, or specs a new agent/skill when it's a GAP.
- **Close one:** `node scripts/raise-hand.mjs --resolve <id> "how it was unblocked"` — the note is required.

A record carries the DR-054 four: what you were doing, what blocked you, what you need, and
who can unblock it (`domain` + `whoCanUnblock`). Deliver records with a `raise` / `take` / `clear` op in
`pnpm run lane:deliver batch` so the other lane sees them without a code branch. A resolved record stays as history; the monitor stops surfacing it.
