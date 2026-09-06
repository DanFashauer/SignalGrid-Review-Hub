# What needs Dan

**The single view of everything waiting on you.** The goal: automation gets work
to ~85–95% done, and this page is the short list of what only you can decide or
do. Everything not here is either done or being handled autonomously — **when the
page is current**; read the staleness tell below before trusting an empty-looking
queue. Claude refreshes this when it acts; check it first, act on the links, and the
rest keeps moving.

_Last refreshed: 2026-07-18 (session `emxm01`)._

> **Staleness tell — the same shape as `docs/STATUS.md`.** This page describes the
> queue as it stood on 2026-07-18, when the newest pull request it names was #89. If
> `git log --oneline --merges -1` shows a merged PR numbered above the highest PR
> linked on this page, the page is STALE: an empty-looking queue then means *nobody
> refreshed it*, not *nothing is waiting*. Refresh before acting. (Noted 2026-09-06:
> mainline was at PR #487 while the rows below still named #72 and #89, and the
> "re-checking hourly" line was a statement from that July session, not a live
> process.)

## 🔴 Decisions / actions only you can take

| What | Why it needs you | Link |
| ---- | ---------------- | ---- |
| **Merge + archive the legacy repo** | Clean, mergeable README-retire PR; then Settings → Archive so the old repo shows the "Public archive" banner. | [signalgrid#1](https://github.com/DanFashauer/signalgrid/pull/1) |
| **Review / un-draft PR #89** | Refinement work (mobile-pwa operator/support, app-workflow templates+lint, dev dispatch). CI fully green, no review findings. Merging my own PR into the default branch is your call. | [PR #89](https://github.com/DanFashauer/SignalGrid-Review-Hub/pull/89) |
| **Decide the Dependabot npm bump** | The 58-package group bump **breaks the build** — can't merge as-is. Recommend a smaller, staged update instead (I can do it on request). | [PR #72](https://github.com/DanFashauer/SignalGrid-Review-Hub/pull/72) |

## 🟡 Owner-gated (need your call before I build)

| What | The decision | Reference |
| ---- | ------------ | --------- |
| **IP / disclosure posture** | Repo visibility → provisional patent → trademark → LICENSE, before any detailed invention material is committed. | `docs/BUILD_BACKLOG.md` (Owner-gated) |
| **Domain go-live** | Enable WHOIS privacy, add DNS records, run the Pages workflow, enforce HTTPS — manual Namecheap/GitHub steps. | `docs/DOMAIN_SETUP.md` |

## 🟢 Being handled for you (no action needed)

- **Issue #67 (scheduled verification)** — verified green on the current default branch and **closed**.
- **Dependabot #63 (GitHub-Actions bumps)** — CI green, **merged**.
- **PR #89 + signalgrid#1** — I'm subscribed and re-checking hourly; I only ping you when something is newly actionable.

## How this page stays current

Claude refreshes this list when it acts. The rule: if an item needs *your*
decision or a manual step only you can do, it lives in the top two sections with
a link; everything else is automated and lives in "being handled" until done.
