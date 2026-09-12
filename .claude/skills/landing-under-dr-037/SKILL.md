---
name: landing-under-dr-037
description: Use when the cloud lane is about to merge its own green product PR, or several in a row — before pressing merge, and before deciding the order they land in.
---

# Landing a product PR under DR-037

DR-037 (owner-directed 2026-09-12) moved the merge button from the owner to the
cloud lane: *"I didn't want that on me."* The authority is conditional, and the
conditions are the whole record. `docs/LANE_COORDINATION.md` protocol item 7 is
the short form.

## The five conditions — all of them, on the CURRENT head

1. The gating check "Typecheck, build, and proof scaffold" has **passed on that
   head**. Read the check RUN. A `check_suite.completed` event is not a pass, and
   a pass on an earlier head is not a pass on this one.
2. `node scripts/preflight.mjs` and `pnpm run verify:breadth` passed **locally on
   the branch**, before the push that produced that head, with the output quoted
   in the PR body or in `docs/agent/EVIDENCE.md`. CI green is necessary, never
   sufficient (CLAUDE.md, "Before you push").
3. Every review thread is resolved, and every bot finding was verified against the
   source and then fixed or answered with the reason. A human reviewer's thread is
   never resolved by the lane unless the lane addressed it.
4. The PR is not conflicted with `SignalGrid_Alpha`. A conflict is merged in and
   regenerated files are regenerated with the repo's own tooling.
5. The lane never approves, never merges a PR it did not open — except a Mac lane
   landing PR the Mac asked for in mail — never merges a change to the launch
   profile, the launch-claims gate or the publication boundary, and never deletes
   a branch.

A SAFETY_MACHINERY PR (`scripts/**`, `.github/workflows/**`, fixtures) may be
merged under the same five conditions, and the PR body must say so under "Owner
decision needed" as "merged under DR-037" with the check-run id.

## The merge call

Pass the **full 40-character head sha** as `expectedHeadSha`. An abbreviated sha
is not accepted, and the parameter is the only thing standing between "the head I
verified" and "whatever the head is now" — re-read the head immediately before the
call and merge that exact string.

## Order, when several land in a row

Each landing moves generated files, so they land ONE AT A TIME, and the next one
is rebuilt on top of the last:

1. Merge `SignalGrid_Alpha` into the branch — never rebase, never force anything.
2. Regenerate ON TOP of the previous landing:
   ```bash
   node scripts/generate-sync-manifest.mjs
   node scripts/check-surface-review-coverage.mjs --write
   ```
   Regenerate the coverage page on a CLEAN index only, so the write is the
   generator's output and not a half-staged tree. Never hand-edit either file.
3. Resolve a conflict in `docs/agent/LOOP.md` or `docs/agent/EVIDENCE.md` by
   **keeping both sides**. They are append-only records of two lanes; a dropped
   entry is a lost record, and the STATE block is edited afterwards, not during
   the merge.
4. Re-run `node scripts/preflight.mjs` and `pnpm run verify:breadth` on the merged
   tree, push, and wait for the check run on the NEW head before merging.

## After the last one

The manifest has moved N times; the Mac's evidence covers the first of them. Mail
the Mac lane for **ONE** re-mint, after the last manifest move, naming the final
fingerprint:

```bash
pnpm run lane:deliver send --to mac --subject "<subject>" --body "<body>"
```

Readiness dimension (b) reads 0 until that re-mint lands — by design
(`node scripts/check-readiness-figure.mjs`), not a regression to work around. One
request per batch: a queued request runs the moment the Mac's checkout returns to
`SignalGrid_Alpha`, so a request written early runs against an intermediate
manifest and cannot be superseded afterwards.

## Never

- Never merge on CI green alone — condition 2 is the local half.
- Never merge on a head you have not re-read.
- Never approve a PR, delete a branch, or merge a launch-profile, launch-claims or
  publication-boundary change; those stay the owner's.
- Never hand-edit `artifacts/sync/live-sync-manifest.json` or
  `docs/agent/SURFACE_REVIEW_COVERAGE.md`.
- Never land two PRs in parallel that both move the manifest.
- Never close a landing without the record: the PR body, the `docs/agent/EVIDENCE.md`
  entry and the LOOP STATE line each name the merged sha.
