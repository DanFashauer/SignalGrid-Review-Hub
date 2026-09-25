#!/usr/bin/env bash
# =============================================================================
# SignalGrid — the Mac lane's automatic tick. Runs WITHOUT a person and WITHOUT a
# Claude session, from launchd (scripts/mac/install-launchd.sh); the interval is the
# installer's (default 5 min). A short interval picks up queued sim requests fast; to
# keep that from flooding SignalGrid_Alpha with heartbeat commits, a QUIET tick
# heartbeats at most once per QUIET_HEARTBEAT_MIN minutes (a tick that ACTED, SKIPPED
# or FAILED always heartbeats). The steward's 3-hour staleness window stays satisfied.
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
#   a. fetch --prune; never touch a DIRTY checkout or one parked on another branch
#      (a person's work is never pulled over) — since 2026-09-12 the tick then runs
#      from its OWN detached worktree (SIGNALGRID_TICK_WORKTREE, default a sibling
#      directory `<repo>.tick`) at origin/SignalGrid_Alpha, so a person's checkout
#      never stops the unattended work; before that it heartbeat "skipped" every 5
#      minutes for as long as the checkout stayed parked (an hour and a half on
#      2026-09-11/12, with a landing branch checked out);
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
# The `evidence` sim-operation needs SIGNALGRID_MCP_PATH (scripts/lib/sim-operations.mjs,
# `needsEnv`). launchd's plist carries PATH and HOME only (install-launchd.sh), so derive it
# from the sibling checkout when that exists — never invent one: absent stays absent, and
# the objective loop then ESCALATES instead of queuing a request nobody can run (DR-056).
if [ -z "${SIGNALGRID_MCP_PATH:-}" ] && [ -f "$REPO_ROOT/../signalgrid-mcp/pyproject.toml" ]; then
  SIGNALGRID_MCP_PATH="$(cd "$REPO_ROOT/../signalgrid-mcp" && pwd)"
  export SIGNALGRID_MCP_PATH
fi
export PATH

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_PREFIX="lane-tick $STAMP"
say() { printf '%s  %s\n' "$LOG_PREFIX" "$1"; }

# ── one tick at a time ───────────────────────────────────────────────────────
# launchd never overlaps its own label, but a PERSON running this script by hand while
# the launchd tick is mid-run would race it on one whole-file JSON state (DR-056). mkdir
# is atomic and needs no flock (bash 3.2). A lock whose holder is DEAD is stale and is
# cleared here — a crashed tick must never latch every later tick into silence.
TICK_LOCK="${TMPDIR:-/tmp}/signalgrid-lane-tick.lock"
if ! mkdir "$TICK_LOCK" 2>/dev/null; then
  _holder="$(cat "$TICK_LOCK/pid" 2>/dev/null || true)"
  if [ -n "$_holder" ] && kill -0 "$_holder" 2>/dev/null; then
    say "another tick (pid $_holder) holds $TICK_LOCK — exiting; the running tick delivers the heartbeat"
    exit 0
  fi
  say "stale tick lock (holder ${_holder:-unknown} is gone) — clearing it"
  rm -f "$TICK_LOCK/pid"; rmdir "$TICK_LOCK" 2>/dev/null || true
  mkdir "$TICK_LOCK" 2>/dev/null || { say "could not take $TICK_LOCK — exiting"; exit 0; }
fi
printf '%s' "$$" > "$TICK_LOCK/pid"
trap 'rm -f "$TICK_LOCK/pid"; rmdir "$TICK_LOCK" 2>/dev/null' EXIT

# An UNCHANGED tick heartbeats at most once per this many minutes, so a short launchd
# interval does not push a heartbeat commit to Alpha every run. Override with
# SIGNALGRID_QUIET_HEARTBEAT_MIN. The local stamp sits beside the install stamp in
# node_modules (gitignored, never pushed); its mtime is the last delivered heartbeat
# and the sibling file holds the RESULT that heartbeat carried.
#
# "Unchanged", not "quiet" (2026-09-12): the throttle used to exempt every skipped
# and failed result, so a checkout parked on a landing branch for an hour pushed
# "skipped: checkout on mac/land-…" to Alpha every 5 minutes — twelve pushes an hour,
# each starting four workflows, each cancelling the mainline CI run before it, and
# between them exhausting the repository's GITHUB_TOKEN budget until the CI liveness
# gate failed a product PR on a 403. A repeated result is not news; a CHANGED result
# is, and still delivers at once — including the first skip and the first failure.
QUIET_HEARTBEAT_MIN="${SIGNALGRID_QUIET_HEARTBEAT_MIN:-25}"
HB_STAMP="node_modules/.sg-last-heartbeat"
HB_LAST_RESULT="node_modules/.sg-last-heartbeat-result"

# The heartbeat is the tick's ONLY obligation on every path, including failure
# paths: a tick that died silently is exactly what this script exists to prevent.
RESULT="quiet"

# THE MAILBOX, FOLDED INTO THE HEALTH SIGNAL.
#
# This tick reported "quiet" on 2026-09-17 while FIVE cloud->mac messages sat
# unread, the oldest nearly four days. That was true about the tick and silent
# about the mailbox: it runs sim requests and heartbeats and does both correctly,
# but nothing in it reads the inbox, so "nothing happened" and "nobody looked"
# produced the same word.
#
# It deliberately does NOT acknowledge anything. An ack is supposed to say what was
# done, and a script has done nothing; a tick that acked its own inbox would be
# manufacturing exactly the false green this repo hunts. It only stops the state
# being invisible, which is the part a script can honestly do.
#
# The figure is COARSE (whole days) because an identical result is throttled: an age
# that ticks up continuously would differ every run and push a heartbeat commit to
# Alpha every five minutes, trading a silent mailbox for a flooded mainline.
# AND THE SAME DISTINCTION ONE LAYER DOWN, because the first draft of this function
# got it wrong in exactly the way the function exists to fix. It left RESULT
# untouched on a failed read — so an unreadable mailbox and an empty one both said
# "quiet", which is "nothing happened" and "nobody looked" wearing the same word
# again. An empty inbox is silence by design; a mailbox that could not be READ says
# so.
# This lane's own identity — the tick runs ON the Mac, so the inbox that matters is
# the one addressed to it. Overridable the same way lane-message.mjs allows, so this
# does not become a second, divergent notion of which lane you are.
LANE_SELF="${SIGNALGRID_LANE:-mac}"
append_unread_state() {
  _u="$(node scripts/check-lane-messages.mjs --unread-summary "$LANE_SELF" 2>/dev/null || true)"
  case "$_u" in
    unread=0) : ;;                                    # genuinely empty; silence is honest here
    unread=*) RESULT="$RESULT; $_u to $LANE_SELF" ;;  # e.g. "quiet; unread=5 oldest=3d to mac"
    *) RESULT="$RESULT; mailbox UNREADABLE" ;;        # never mistaken for an empty inbox
  esac
}

# Fold any OPEN raised hands (DR-054) into the heartbeat, so the unattended lane surfaces
# a blocker the same way it surfaces unread mail — never lost between sessions.
append_raised_hands_state() {
  _rh="$(node scripts/check-raised-hands.mjs --tick-summary 2>/dev/null || true)"
  case "$_rh" in
    "") : ;;                                   # none open, or monitor silent; loop:state catches a run failure
    raised-hands=*) RESULT="$RESULT; $_rh" ;;  # e.g. "quiet; raised-hands=2 gaps=1"
  esac
}

heartbeat() {
  append_unread_state
  append_raised_hands_state
  if [ "$DRY" = "1" ]; then say "dry-run: would heartbeat: $RESULT"; return 0; fi
  # Throttle a result IDENTICAL to the last delivered one ("quiet" again, the same
  # "skipped: …" again, the same failure again) inside the window; anything that
  # differs from what Alpha already carries delivers now. A tick that ACTED names
  # what it did, so its result differs and always delivers. `find -mmin -N` and the
  # `cat` comparison are BSD/bash-3.2 safe; a missing result file compares unequal.
  LAST_RESULT=""
  [ -f "$HB_LAST_RESULT" ] && LAST_RESULT="$(cat "$HB_LAST_RESULT" 2>/dev/null)"
  if [ "$RESULT" = "$LAST_RESULT" ] && [ -f "$HB_STAMP" ] && [ -n "$(find "$HB_STAMP" -mmin -"$QUIET_HEARTBEAT_MIN" 2>/dev/null)" ]; then
    say "unchanged ($RESULT), last heartbeat <${QUIET_HEARTBEAT_MIN}m ago — tick ran, not re-pushing (avoids flooding Alpha)"
    return 0
  fi
  # --no-wake: the tick heartbeat is a STALENESS record, read from the heartbeat
  # FILE by the cloud steward's hourly cycle — it never carries cloud-addressed
  # mail (append_unread_state reports THIS lane's inbox, mac's), so it must not
  # post the mailbox-PR comment that wakes the cloud lane. Real cloud mail travels
  # on a separate `lane-deliver send` (no --no-wake), which still wakes at once;
  # new mac/* branches are reviewed by the steward within the hour. This ends the
  # every-tick quiet wake that flooded the cloud session (owner decision 2026-09-23).
  if node scripts/lane-deliver.mjs heartbeat mac-lane-tick "$RESULT" --no-wake >/dev/null 2>&1; then
    touch "$HB_STAMP" 2>/dev/null || true
    printf '%s' "$RESULT" > "$HB_LAST_RESULT" 2>/dev/null || true
    say "heartbeat delivered: $RESULT"
  else
    say "WARN heartbeat delivery FAILED (push refused or offline): $RESULT"
  fi
}

# ── the tick's own worktree, for when a person holds the main checkout ────────
# DETACHED at origin/SignalGrid_Alpha on purpose: a worktree that held the branch
# would make `git checkout SignalGrid_Alpha` in the main checkout refuse ("already
# checked out at …"), which is the person's next move after parking. Nothing here
# is pushed from a branch except the mac/tick-<stamp> result branches (step d).
TICK_WT="${SIGNALGRID_TICK_WORKTREE:-$REPO_ROOT/../$(basename "$REPO_ROOT").tick}"
IN_TICK_WT=0
use_tick_worktree() {
  why="$1"
  if [ ! -e "$TICK_WT/.git" ]; then
    if ! git worktree add -q --detach "$TICK_WT" origin/SignalGrid_Alpha >/dev/null 2>&1; then
      RESULT="skipped: $why; and the tick worktree could not be created at $TICK_WT"
      say "$RESULT"
      heartbeat
      exit 0
    fi
    say "created the tick worktree at $TICK_WT (detached at origin/SignalGrid_Alpha)"
  fi
  if ! cd "$TICK_WT"; then
    RESULT="skipped: $why; and the tick worktree at $TICK_WT cannot be entered"
    say "$RESULT"
    heartbeat
    exit 0
  fi
  if [ -n "$(git status --porcelain)" ]; then
    RESULT="skipped: $why; and the tick worktree at $TICK_WT is dirty too (a person's work; not touching it)"
    say "$RESULT"
    heartbeat
    exit 0
  fi
  IN_TICK_WT=1
  say "$why — ticking from the tick worktree at $TICK_WT instead"
}

# ── a. sync, never over a person's work ──────────────────────────────────────
if ! git fetch origin --prune >/dev/null 2>&1; then
  RESULT="skipped: origin unreachable (offline?)"
  say "$RESULT"
  heartbeat
  exit 0
fi
if [ -n "$(git status --porcelain)" ]; then
  use_tick_worktree "checkout dirty (a person's uncommitted work; not touching it)"
else
  BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  if [ "$BRANCH" != "SignalGrid_Alpha" ]; then
    use_tick_worktree "checkout on $BRANCH, not SignalGrid_Alpha (a person is mid-work; leaving it)"
  fi
fi

# ── b. fast-forward + deps only when the lockfile moved ──────────────────────
if ! git merge-base --is-ancestor origin/SignalGrid_Alpha HEAD 2>/dev/null; then
  if [ "$IN_TICK_WT" = "1" ]; then
    # Detached: move to origin's tip directly (no branch to fast-forward).
    if git checkout -q --detach origin/SignalGrid_Alpha; then
      say "tick worktree moved to origin/SignalGrid_Alpha $(git rev-parse --short HEAD)"
    else
      RESULT="failed: the tick worktree could not move to origin/SignalGrid_Alpha"
      say "$RESULT"
      heartbeat
      exit 1
    fi
  elif git pull -q --ff-only origin SignalGrid_Alpha; then
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
    # A per-operation FAILURE writes a result with its status recorded — but a runner
    # CRASH (a malformed request, a write error) writes NOTHING. Those two exit-1 cases
    # were indistinguishable while stderr was thrown away, and the else-branch claimed
    # "recorded in the results" even on the crash. Keep stderr (drop the inner 2>&1) so
    # the trace reaches the launchd log, and let step d's `git status` on the results dir
    # be the honest test of whether any result actually landed. (DR-054.)
    if pnpm run sim:run-requests >/dev/null; then
      say "sim requests ran"
    else
      say "sim requests exited non-zero — see stderr in the log; whether any result landed is decided in step d"
    fi
  fi
fi

# ── c'. evaluate + replan (DR-056) — AFTER step c, never before ──────────────
# run-requests.mjs samples provenance.workingTreeClean from `git status --porcelain`
# (untracked included) at ITS launch; a state file written before step c would stamp
# every result in this tick dirty. The loop rewrites docs/agent/objective-state.json only
# when the DECISION changed, queues at most one request the tick can actually run, and
# mails the cloud once per NEW escalation id. A loop that cannot run is named in the
# heartbeat, never swallowed (DR-054).
LOOP_VERDICT="not run"
if [ "$DRY" = "1" ]; then
  say "dry-run: would node scripts/objective-loop.mjs --write --deliver"
  LOOP_VERDICT="dry-run"
else
  LOOP_OUT="$(node scripts/objective-loop.mjs --write --deliver 2>&1)"
  LOOP_STATUS=$?
  # Select the summary by its PREFIX, never by position: a node warning on stderr would
  # otherwise become the verdict in the commit message and the heartbeat.
  LOOP_LINE="$(printf '%s\n' "$LOOP_OUT" | grep -m1 '^objective-loop: ' || true)"
  say "${LOOP_LINE:-objective-loop printed no summary line}"
  if [ "$LOOP_STATUS" = "0" ] && [ -n "$LOOP_LINE" ]; then
    LOOP_VERDICT="${LOOP_LINE#objective-loop: }"
    LOOP_VERDICT="${LOOP_VERDICT%% —*}"
  elif [ "$LOOP_STATUS" = "0" ]; then
    LOOP_VERDICT="BROKEN (no summary line)"
  else
    LOOP_VERDICT="BROKEN (objective-loop exit $LOOP_STATUS)"
    printf '%s\n' "$LOOP_OUT" | tail -n +2 | while IFS= read -r _l; do say "  $_l"; done
  fi
fi

# ── d. deliver results on a mac/tick-* branch ────────────────────────────────
if [ -n "$(git status --porcelain -- artifacts/sim-results artifacts/live-evidence docs/agent/objective-state.json artifacts/sim-requests 2>/dev/null)" ]; then
  TICK_BRANCH="mac/tick-$STAMP"
  if [ "$DRY" = "1" ]; then
    say "dry-run: would commit results to $TICK_BRANCH and push"
  else
    # RESULT used to be assigned AFTER this chain unconditionally, so a checkout,
    # commit or push that failed still heartbeat "results on mac/tick-<stamp>" — the
    # cloud lane was told work had been delivered to a branch that does not exist on
    # origin. The claim now lives INSIDE the success arm, and the failure arm says
    # what actually happened.
    # A new result file moves the tracked-file count, and the derived coverage
    # page is gated against it (check-surface-review-coverage): the first tick PR
    # (#844, 2026-09-18) went red on exactly that and needed a cloud commit to
    # land. Re-derive the page here so the result lands on its own.
    #
    # ORDER MATTERS: the page counts TRACKED files (git ls-files). Deriving it before
    # `git add` counted nothing new, so a tick that queued its first sim request (#1052,
    # 2026-09-25) committed a page derived without the request file and went red on the
    # very gate this block exists to satisfy. Stage the new files first, derive second,
    # then stage the page.
    if git checkout -q -b "$TICK_BRANCH" \
      && git add artifacts/sim-results artifacts/live-evidence docs/agent/objective-state.json artifacts/sim-requests 2>/dev/null \
      && { node scripts/check-surface-review-coverage.mjs --write >/dev/null 2>&1 \
           || say "WARN could not re-derive docs/agent/SURFACE_REVIEW_COVERAGE.md — the PR will fail the coverage gate until it is"; } \
      && git add docs/agent/SURFACE_REVIEW_COVERAGE.md 2>/dev/null \
      && git commit -q -m "Mac tick $STAMP: sim results ($PENDING request(s)); objective loop: $LOOP_VERDICT" \
      && git push -q -u origin "$TICK_BRANCH"; then
      say "pushed $TICK_BRANCH (the cloud steward opens its PR within the hour)"
      RESULT="acted: ran $PENDING sim request(s); results on $TICK_BRANCH"
      if command -v gh >/dev/null 2>&1; then
        gh pr create --base SignalGrid_Alpha --head "$TICK_BRANCH" --fill >/dev/null 2>&1 && say "opened the PR for $TICK_BRANCH"
      fi
    else
      RESULT="failed: ran $PENDING sim request(s) and produced results, but the $TICK_BRANCH commit/push chain broke — the cloud lane CANNOT see them; they are still in this checkout"
      say "$RESULT"
      # The loop's own writes are put back so the next tick does not find a dirty
      # worktree and skip forever (a latched-off executor is the silent stall DR-054
      # forbids). Sim RESULTS are deliberately left: they are evidence, not derivable.
      # Reset the INDEX first: `git checkout -- <path>` restores from the index, and `git clean`
      # skips a path the index holds, so after a failed `git commit` both would be no-ops.
      git reset -q -- docs/agent/objective-state.json artifacts/sim-requests >/dev/null 2>&1 || true
      if git ls-files --error-unmatch docs/agent/objective-state.json >/dev/null 2>&1; then
        git checkout -q -- docs/agent/objective-state.json 2>/dev/null || true
      else
        rm -f docs/agent/objective-state.json
      fi
      git clean -fq -- "artifacts/sim-requests/objective-loop-*.json" >/dev/null 2>&1 || true
      # ...and forget the delivery stamp, so the next tick re-derives AND re-delivers.
      rm -f node_modules/.sg-objective-loop-last.json
    fi
    if [ "$IN_TICK_WT" = "1" ]; then
      git checkout -q --detach origin/SignalGrid_Alpha || say "WARN could not return the tick worktree to origin/SignalGrid_Alpha"
    else
      git checkout -q SignalGrid_Alpha || say "WARN could not return the checkout to SignalGrid_Alpha"
    fi
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

RESULT="$RESULT; objective: $LOOP_VERDICT"

# ── e. heartbeat, always ─────────────────────────────────────────────────────
heartbeat
exit 0
