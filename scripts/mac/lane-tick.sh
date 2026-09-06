#!/usr/bin/env bash
# =============================================================================
# SignalGrid — the Mac lane's automatic tick. Runs WITHOUT a person and WITHOUT a
# Claude session, from launchd (scripts/mac/install-launchd.sh), every 30 minutes.
#
#   bash scripts/mac/lane-tick.sh            # one tick, prints what it did
#   bash scripts/mac/lane-tick.sh --dry-run  # say what would run, run nothing
#
# WHY THIS EXISTS (owner, 2026-09-05, second time: "this isn't working and causing
# delay"). Everything the cloud lane asked the Mac for waited on a HUMAN opening a
# Claude session on the Mac: six messages sat unread for hours, queued sim
# requests sat pending, and a Swift twin waited days. Two things fix that:
#
#   1. Anything CI's macOS runners can verify — an xcodebuild, `swift test`, a
#      Swift twin against pinned vectors, a shell-script fix — the CLOUD LANE now
#      does itself and ios-ci.yml proves. The Mac is no longer on that path.
#   2. What genuinely needs THIS machine — the sim-request loop (real hardware,
#      the local harness, the live lanes on the LAN), and the fact that the Mac
#      has SEEN the mail — runs from this tick, unattended.
#
# WHAT ONE TICK DOES, in order, each step reporting itself:
#   a. fetch --prune; refuse to touch a DIRTY checkout (a person's work is never
#      pulled over) — report and heartbeat "skipped: dirty";
#   b. on SignalGrid_Alpha (the only branch it drives): fast-forward, install
#      deps only if the lockfile moved (resume-lane.sh's stamp);
#   c. run every PENDING sim request (`pnpm run sim:run-requests`) — results land
#      in artifacts/sim-results/ with provenance;
#   d. commit + push any new results on a `mac/tick-<stamp>` branch (the cloud
#      steward opens the PR within the hour; if `gh` is on PATH the PR is opened
#      here) and return the checkout to SignalGrid_Alpha;
#   e. HEARTBEAT every tick, quiet or not, through `lane:deliver` — so "the Mac
#      ran and had nothing to do" is distinguishable from "the Mac never ran",
#      and the cloud steward escalates to the owner when this stops arriving.
#
# WHAT IT NEVER DOES: read or ack lane MAIL on a person's behalf (only the
# addressee closes a message — a machine cannot say it understood), touch a
# non-Alpha branch, or run an operation the request allowlist does not name.
#
# Stock macOS bash 3.2: guarded array expansion only, no mapfile, no ${var,,}.
# =============================================================================
set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT" || { echo "cannot enter $REPO_ROOT" >&2; exit 1; }

DRY=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    *) echo "unknown flag: $arg (known: --dry-run)" >&2; exit 2 ;;
  esac
done

# launchd starts with a minimal PATH; the tools this repo needs live in the usual
# places. Appended, never prepended, so a person's PATH still wins when run by hand.
PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:$HOME/.nvm/current/bin:$HOME/Library/pnpm"
export PATH

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_PREFIX="lane-tick $STAMP"
say() { printf '%s  %s\n' "$LOG_PREFIX" "$1"; }

# The heartbeat is the tick's ONLY obligation on every path, including failure
# paths: a tick that died silently is exactly what this script exists to prevent.
RESULT="quiet"
heartbeat() {
  if [ "$DRY" = "1" ]; then say "dry-run: would heartbeat: $RESULT"; return 0; fi
  if node scripts/lane-deliver.mjs heartbeat mac-lane-tick "$RESULT" >/dev/null 2>&1; then
    say "heartbeat delivered: $RESULT"
  else
    say "WARN heartbeat delivery FAILED (push refused or offline): $RESULT"
  fi
}

# ── a. sync, never over a person's work ──────────────────────────────────────
if ! git fetch origin --prune >/dev/null 2>&1; then
  RESULT="skipped: origin unreachable (offline?)"
  say "$RESULT"
  heartbeat
  exit 0
fi
if [ -n "$(git status --porcelain)" ]; then
  RESULT="skipped: checkout dirty (a person's uncommitted work; not touching it)"
  say "$RESULT"
  heartbeat
  exit 0
fi
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$BRANCH" != "SignalGrid_Alpha" ]; then
  RESULT="skipped: checkout on $BRANCH, not SignalGrid_Alpha (a person is mid-work; leaving it)"
  say "$RESULT"
  heartbeat
  exit 0
fi

# ── b. fast-forward + deps only when the lockfile moved ──────────────────────
if ! git merge-base --is-ancestor origin/SignalGrid_Alpha HEAD 2>/dev/null; then
  if git pull -q --ff-only origin SignalGrid_Alpha; then
    say "fast-forwarded SignalGrid_Alpha to $(git rev-parse --short HEAD)"
  else
    RESULT="skipped: SignalGrid_Alpha diverged from origin; resolve by hand (docs/LANE_COORDINATION.md)"
    say "$RESULT"
    heartbeat
    exit 0
  fi
fi
if ! command -v pnpm >/dev/null 2>&1 || ! command -v node >/dev/null 2>&1; then
  RESULT="skipped: pnpm/node not on PATH for launchd (edit PATH at the top of scripts/mac/lane-tick.sh)"
  say "$RESULT"
  # This arm was the ONE early exit with no heartbeat, and it is the arm most
  # likely to fire under launchd (a minimal PATH is launchd's default). The cloud
  # steward escalates on a MISSING heartbeat, so a tick that dies here looked
  # exactly like a Mac that never ran — the loudest possible failure reported as
  # silence. `heartbeat` itself shells to node and will WARN if it cannot; that is
  # still more than nothing, and it costs one line.
  heartbeat
  exit 0
fi
LOCK_SHA="$(shasum -a 256 pnpm-lock.yaml 2>/dev/null | cut -d' ' -f1)"
INSTALL_STAMP="node_modules/.sg-installed-lock-sha"
if [ -z "$LOCK_SHA" ] || [ ! -f "$INSTALL_STAMP" ] || [ "$(cat "$INSTALL_STAMP" 2>/dev/null)" != "$LOCK_SHA" ]; then
  if [ "$DRY" = "1" ]; then
    say "dry-run: would pnpm install --frozen-lockfile"
  elif pnpm install --frozen-lockfile >/dev/null 2>&1; then
    printf '%s' "$LOCK_SHA" > "$INSTALL_STAMP"
    say "pnpm install --frozen-lockfile (lockfile moved)"
  else
    RESULT="failed: pnpm install --frozen-lockfile (see ~/Library/Logs/signalgrid-lane-tick.log)"
    say "$RESULT"
    heartbeat
    exit 1
  fi
fi

# ── c. run what the cloud asked for ──────────────────────────────────────────
# `--plan` prints one `  PENDING <id> …` line per request it would run, then a
# `--plan: N request(s) PENDING …` summary. Until 2026-09-06 it printed NEITHER —
# the word PENDING lived only in that file's `//` comments — so this grep matched
# nothing on every tick since the tick was written, the count was always 0, and
# step (c), the only reason this script runs unattended, never once fired.
#
# The old line also swallowed a broken planner: `2>/dev/null | grep -c … || true`
# turns a crash into "0", which reads as "nothing to do". A plan this tick cannot
# READ is now a failure, never an empty queue — the summary line must be present.
PLAN_OUT="$(node scripts/mac/run-requests.mjs --plan 2>/dev/null)"
PLAN_STATUS=$?
if [ "$PLAN_STATUS" != "0" ] || ! printf '%s\n' "$PLAN_OUT" | grep -q '^--plan: [0-9][0-9]* request'; then
  RESULT="failed: could not read the sim-request plan (run-requests.mjs --plan exited $PLAN_STATUS with no roster) — pending work was NOT counted, and is NOT known to be zero"
  say "$RESULT"
  heartbeat
  exit 1
fi
PENDING="$(printf '%s\n' "$PLAN_OUT" | grep -c '^  PENDING')"
PENDING="${PENDING:-0}"
if [ "$PENDING" = "0" ]; then
  say "no pending sim requests"
else
  say "$PENDING pending sim request(s)"
  if [ "$DRY" = "1" ]; then
    say "dry-run: would pnpm run sim:run-requests"
  else
    # Results are written even when an operation fails; the exit status is
    # recorded in the result file, so a failed run is still a delivered run.
    if pnpm run sim:run-requests >/dev/null 2>&1; then
      say "sim requests ran"
    else
      say "sim requests ran with failures (recorded in the results)"
    fi
  fi
fi

# ── d. deliver results on a mac/tick-* branch ────────────────────────────────
if [ -n "$(git status --porcelain -- artifacts/sim-results artifacts/live-evidence 2>/dev/null)" ]; then
  TICK_BRANCH="mac/tick-$STAMP"
  if [ "$DRY" = "1" ]; then
    say "dry-run: would commit results to $TICK_BRANCH and push"
  else
    # RESULT used to be assigned AFTER this chain unconditionally, so a checkout,
    # commit or push that failed still heartbeat "results on mac/tick-<stamp>" — the
    # cloud lane was told work had been delivered to a branch that does not exist on
    # origin. The claim now lives INSIDE the success arm, and the failure arm says
    # what actually happened.
    if git checkout -q -b "$TICK_BRANCH" \
      && git add artifacts/sim-results artifacts/live-evidence 2>/dev/null \
      && git commit -q -m "Mac tick $STAMP: sim results ($PENDING request(s))" \
      && git push -q -u origin "$TICK_BRANCH"; then
      say "pushed $TICK_BRANCH (the cloud steward opens its PR within the hour)"
      RESULT="acted: ran $PENDING sim request(s); results on $TICK_BRANCH"
      if command -v gh >/dev/null 2>&1; then
        gh pr create --base SignalGrid_Alpha --head "$TICK_BRANCH" --fill >/dev/null 2>&1 && say "opened the PR for $TICK_BRANCH"
      fi
    else
      RESULT="failed: ran $PENDING sim request(s) and produced results, but the $TICK_BRANCH commit/push chain broke — the cloud lane CANNOT see them; they are still in this checkout"
      say "$RESULT"
    fi
    git checkout -q SignalGrid_Alpha || say "WARN could not return the checkout to SignalGrid_Alpha"
  fi
elif [ "$PENDING" != "0" ] && [ "$DRY" = "0" ]; then
  RESULT="acted: ran $PENDING sim request(s); no new result files (see the run log)"
fi

# The inbox is PRINTED so the log shows what a person still owes — it is not
# acked here, because a machine reading a message is not the addressee reading it.
UNREAD="$(node scripts/lane-message.mjs inbox 2>/dev/null | grep -c '→ mac' || true)"
UNREAD="${UNREAD:-0}"
if [ "$UNREAD" != "0" ]; then
  say "$UNREAD message(s) addressed to mac still unread — a person acks them: pnpm run lane:inbox"
  RESULT="$RESULT; $UNREAD cloud→mac message(s) unread (need a person)"
fi

# ── e. heartbeat, always ─────────────────────────────────────────────────────
heartbeat
exit 0
