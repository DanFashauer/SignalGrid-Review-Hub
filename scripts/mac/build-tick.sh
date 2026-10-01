#!/usr/bin/env bash
# =============================================================================
# SignalGrid — the Mac lane's BUILD tick (DR-061 rule 4). Runs WITHOUT a person, from
# launchd every 3 hours (scripts/mac/install-build-tick.sh, label
# com.signalgrid.build-tick). The lane tick (lane-tick.sh) is separate and never builds.
#
#   bash scripts/mac/build-tick.sh                   # one run, prints a one-line result
#   bash scripts/mac/build-tick.sh --dry-run         # the task it would pick + the exact
#                                                    # command of every stage; runs nothing
#   bash scripts/mac/build-tick.sh --dry-run --state <file> [--remote <name|path>]
#                                                    # the same, against a scratch state
#                                                    # file / a scratch remote's heads
#
# --state / --remote are TEST SEAMS and touch only the scratch remote: the dry-run under them does
# not fetch the real origin (the sha comes from `git ls-remote` of the scratch remote) and does
# not call gh (open PRs read as none). A plain --dry-run reads the real origin, read-only.
#
# WHY (owner, 2026-09-29: "Yes, build it — The brain builds its top task unattended and
# opens PRs", then "Build it, I confirm"). Until this, nothing STARTED a ranked task in
# docs/agent/objective-state.json without a person opening a session. One Opus session per
# row was the first form (2026-09-29); owner, 2026-10-01: run the cheaper model where the
# work allows and keep Opus for judgment, so it is a STAGED pipeline (DR-047, DR-060).
#
# WHO DOES WHAT. The model stages live in scripts/mac/build-tick-stages.mjs (stage table,
# tool sets, scrubbed environment, verdict parsers, cost ledger):
#   triage   sonnet, READ-ONLY by tool absence (Read, Grep, Glob): done / blocked / build,
#            and the kind (mechanical | code | judgment). Runs BEFORE the claim;
#   build    haiku (mechanical) | sonnet (code) | opus (judgment): edits its clone only;
#   review   opus, READ-ONLY: ship, fix (one pass) or reject;
#   fix      at most one, on the build's own tier, then a second review.
# A `done` triage needs no build at all: the helper writes one plan-row marker and opus
# reviews it. No model session has git or GitHub credentials (no ssh agent,
# GIT_SSH_COMMAND=false, no git global config so no credential helper, an empty gh config,
# no tokens), and the build and fix stages have these commands deny-listed (BUILD_DENY in the
# helper): git push, commit, merge, fetch, reset, stash, update-ref, symbolic-ref, remote, config,
# git -c / -C and every other `git --option`, gh, ssh, curl, wget, lane-deliver, gh-pr and the
# lane:/hand: scripts. The helper makes LOCAL commits only. THIS SCRIPT does every
# outward act: it claims the row, refuses a change that touches an owner-reserved or
# forbidden path, runs preflight + breadth, and only on 0/0 pushes that one branch and
# opens its PR, whose body carries the reviews and a tiers-and-cost table. Nothing here
# merges. That is enforced by the environment, the deny list and this script, not an OS
# boundary. Named escapes, all deliberate: a `pnpm exec`/`node` one-liner that re-points git
# at ssh and the on-disk keys, a file a session writes straight into its clone's .git
# (config: core.sshCommand, url.*.insteadOf), or code a session writes that this script's own
# preflight then runs WITH credentials (DR-061 rule 4 accepts that risk).
#
# ONE BASE, PINNED. A session shares its clone's refs, and `git update-ref` is not the only way to
# move one, so nothing here measures against a ref. Step 0 asks the REAL remote (`git ls-remote`) for
# SignalGrid_Alpha's sha ONCE, fetches that sha, and the whole run — the re-exec, the clone reset,
# the diff the reviewer reads, CHANGED, the forbidden-path list, the landing classifier, the
# pr-refresh gating and the is-ancestor check before the push — uses that one sha. If the remote
# cannot be asked, the run is "skipped: origin unreachable" (it never runs a previous session's
# leftover).
#
# ONE RUN, in order:
#   0. pin mainline's sha (above) and re-exec THAT sha's copy of this script (a real run never
#      runs a branch copy);
#   1. one run at a time (a lock under ~/Library/Caches, never $TMPDIR, whose value
#      differs between launchd, a sandboxed shell and a plain one);
#   1a. the pause check: a tick the last run PAUSED (see 6 and 8) does nothing at all, the
#      refresh included, until a person deletes the paused file;
#   1b. REFRESH, before any row: mainline's PR-refresh script (when mainline has it) brings
#      ONE dirty mac/* PR up to date, under a wall-clock cap that kills its whole process
#      group. It needs no model; a failure never stops the build;
#   2. read tasks[] from the pinned sha's state (four origin failures in a row raise a hand);
#   3. take the first row nobody has claimed: no remote head and no open PR names it
#      ("row 12", "row-12", "rows 12", "row #12" in a head or title; "plan row 12" or
#      "row-12" in a body; a range like "rows 17-18" names only 17). A false match only
#      skips a row — the safe direction;
#   4. its OWN CLONE <repo>.build (`git clone --reference`, its own .git: a session cannot touch
#      the person's refs, config, stash or hooks), config reset and checked out detached at the
#      pinned sha every run. Every git call after a session may have written the clone runs with
#      hooks off (sgit) and the push goes to the origin URL read before any session;
#   5. deps when the lockfile moved; tsx's darwin esbuild from a cache outside the repo;
#   6. TRIAGE, before any claim. A BROKEN triage session pauses the tick before a claim is
#      pushed, so that row is not claimed. Broken means (build-tick-stages.mjs sessionBroken):
#      the envelope names an API error (api_error_status set, terminal_reason api_error, or
#      is_error without an error_max_* cap), which is what a logged-out CLI prints, or there is
#      no envelope and the exit is not 0 or 142. A turn or time cap is a hand, not a pause. A
#      blocked row raises a hand; otherwise CLAIM: re-read the branch and PR lists first (triage
#      can run as long as its stage-table cap; a row taken meanwhile is skipped, not claimed twice),
#      then push the empty branch mac/build-row-<id>-<stamp> at the pinned sha, so the next run
#      skips the row even if the pipeline finds nothing to do (the cloud's forward-build cycle skips
#      it only once its row reads mac/build-row-* heads too). A helper that wrote no verdict (or an
#      unknown one) also PAUSES: a hand would claim a new row every tick;
#   7. the pipeline (`build-tick-stages.mjs run`): build (or the marker), review, at most
#      one fix, a second review. Its commit message, PR title and body, or a hand, go into
#      a run directory OUTSIDE the clone (--add-dir); its verdict is RUN_DIR/outcome.json.
#      A session that is broken HERE (after the claim) PAUSES the tick too, but its claim stays
#      for a person, and so does a helper failure. A writing session that edited and then capped
#      or broke is not committed (the helper checks that before anything else).
#      `mechanical` (Haiku) is writer reruns and doc-only edits: the helper writes its commit
#      message and PR body after the last session, and a diff outside docs/** or the sync manifest
#      is a hand;
#   8. on `land`: refuse forbidden paths, preflight + breadth, push + PR only on 0/0 with each
#      gate's exact verdict line and a sentinel naming the pushed sha. The push is BY SHA, from a
#      clean tree whose HEAD is the commit the gates ran on. CI's frozen-lockfile install is the
#      lockfile guard for tick PRs: the repo's local pre-push hook is deliberately not run here,
#      because a session can edit hooks.
#      Anything else raises a hand and leaves the claim in place for a person.
#
# Stock macOS bash 3.2: guarded array expansion, here-strings, no mapfile, no ${var,,}.
# =============================================================================
set -u

if [ "$(uname -s)" != "Darwin" ]; then
  echo "build-tick.sh: the build tick is the Mac lane's (launchd + a local claude CLI); on this host the cloud lane builds." >&2
  exit 2
fi

DRY=0
STATE_FILE=""
REMOTE="origin"
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --state|--remote)
      [ $# -ge 2 ] || { echo "$1 needs a value" >&2; exit 2; }
      if [ "$1" = "--state" ]; then STATE_FILE="$2"; else REMOTE="$2"; fi
      shift ;;
    *) echo "unknown flag: $1 (known: --dry-run, --state <file>, --remote <name|path>)" >&2; exit 2 ;;
  esac
  shift
done
# The overrides are test seams: a REAL run always builds from mainline's own state.
if [ "$DRY" = "0" ] && { [ -n "$STATE_FILE" ] || [ "$REMOTE" != "origin" ]; }; then
  echo "--state / --remote are for --dry-run only; a real run reads mainline's state and origin" >&2
  exit 2
fi
SEAMS=0
if [ -n "$STATE_FILE" ] || [ "$REMOTE" != "origin" ]; then SEAMS=1; fi

# launchd starts with a minimal PATH (install-build-tick.sh); claude lives in ~/.local/bin.
PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.nvm/current/bin:$HOME/Library/pnpm"
export PATH
CACHE="$HOME/Library/Caches/signalgrid/build-tick"
mkdir -p "$CACHE" || { echo "cannot create $CACHE" >&2; exit 1; }
REPO_ROOT="${SG_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_LOG=""
say() {
  printf 'build-tick %s  %s\n' "$STAMP" "$1"
  [ -n "$RUN_LOG" ] && printf 'build-tick %s  %s\n' "$STAMP" "$1" >> "$RUN_LOG"
  return 0
}

# A hand through lane-deliver (straight to mainline on the Mac), never only a file in the
# build clone — that clone is reset next run. raise-hand.mjs keys a hand on the day
# and its `blocked` text.
raise_hand() {
  if [ "$DRY" = "1" ]; then say "dry-run: would raise a hand: $1"; return 0; fi
  _ops="$(mktemp "$CACHE/hand.XXXXXX")" || { say "WARN could not raise a hand (mktemp)"; return 0; }
  if node -e 'const [f, blocked, where] = process.argv.slice(1);
      require("fs").writeFileSync(f, JSON.stringify([{ op: "raise", who: "mac lane", domain: "lane", where,
        doing: "the unattended build tick (scripts/mac/build-tick.sh)", blocked,
        need: "a person on the Mac to read the log named in where, fix the cause or re-rank the row, and delete the claim branch it names when the row should be retried" }]));' \
      "$_ops" "$1" "${RUN_LOG:-launchd log ~/Library/Logs/signalgrid-build-tick.log}" \
    && node "$REPO_ROOT/scripts/lane-deliver.mjs" batch "$_ops" >> "${RUN_LOG:-/dev/null}" 2>&1; then
    say "raised a hand: $1"
  else
    say "WARN could not deliver a hand (already raised today, or lane-deliver refused): $1"
    printf '%s  %s\n' "$STAMP" "$1" >> "$CACHE/undelivered-hands.log"
  fi
  rm -f "$_ops"
}
fail() { say "result: failed: $1"; raise_hand "$1"; exit 1; }

# An asleep Mac is common and says nothing; four failures in a row (12 h) is not. A run that cannot
# ask the real remote for mainline's sha does NOTHING (it never runs a previous session's leftover).
FETCH_FAILS="$CACHE/fetch-failures"
origin_down() {
  _n=0
  if [ "$DRY" = "0" ]; then
    _n=$(( $(cat "$FETCH_FAILS" 2>/dev/null || echo 0) + 1 ))
    printf '%s' "$_n" > "$FETCH_FAILS"
    [ "$_n" = "4" ] && raise_hand "origin has been unreachable on 4 build ticks in a row ($1; auth expired? repo locked?)"
  fi
  say "result: skipped: origin unreachable ($1; $_n in a row)"
  exit 0
}
# SignalGrid_Alpha's sha, from the remote named by $1 (a URL, a name or a scratch path). Exact ref match, 40 hex, or nothing.
remote_mainline_sha() {
  git ls-remote "$1" refs/heads/SignalGrid_Alpha 2>/dev/null | awk '$2 == "refs/heads/SignalGrid_Alpha" { print $1 }' | grep -E '^[0-9a-f]{40}$' | head -1
}

# ── 0. pin mainline, then always THAT sha's copy ──────────────────────────────
# launchd runs the path the installer wrote, in whatever state the person's checkout is
# in (another branch, behind). A real run asks the REAL remote for SignalGrid_Alpha's sha,
# fetches that sha into the person's repo (this runs before any session exists), and re-execs the
# copy of this script AT that sha, handing the sha and the origin URL down so nothing downstream
# reads a ref or re-derives either. --dry-run runs the file in front of you.
#
# The marker that "step 0 is done" is SG_MAINLINE_SHA itself, not a flag. An older parent (a checkout
# that has not pulled this script yet) re-execs mainline's copy with only SG_BUILD_TICK_MAINLINE and
# SG_REPO_ROOT set; this copy then pins and re-execs itself once more, instead of refusing to run.
ORIGIN_URL="${SG_ORIGIN_URL:-}"
MAINLINE_SHA="${SG_MAINLINE_SHA:-}"
# The extracted mainline copy is this run's alone; unlink it now (bash keeps reading the open file).
case "$0" in "$CACHE"/mainline.*) rm -f "$0" ;; esac
if [ "$DRY" = "0" ] && [ -z "$MAINLINE_SHA" ]; then
  ORIGIN_URL="$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null)"
  [ -n "$ORIGIN_URL" ] || origin_down "$REPO_ROOT has no origin remote"
  MAINLINE_SHA="$(remote_mainline_sha "$ORIGIN_URL")"
  [ -n "$MAINLINE_SHA" ] || origin_down "git ls-remote could not read refs/heads/SignalGrid_Alpha"
  git -C "$REPO_ROOT" fetch -q "$ORIGIN_URL" "$MAINLINE_SHA" 2>/dev/null || origin_down "could not fetch mainline $MAINLINE_SHA"
  rm -f "$FETCH_FAILS"
  # A fresh file per run: bash reads a script as it runs, so overwriting one a live run
  # is reading would feed it misaligned text.
  _f="$(mktemp "$CACHE/mainline.XXXXXX")" || exit 1
  if ! git -C "$REPO_ROOT" show "$MAINLINE_SHA:scripts/mac/build-tick.sh" > "$_f" 2>/dev/null; then
    rm -f "$_f"
    echo "build-tick: mainline $MAINLINE_SHA has no scripts/mac/build-tick.sh — nothing to run"
    exit 0
  fi
  SG_BUILD_TICK_MAINLINE=1 SG_REPO_ROOT="$REPO_ROOT" SG_MAINLINE_SHA="$MAINLINE_SHA" SG_ORIGIN_URL="$ORIGIN_URL" exec /bin/bash "$_f"
fi
if [ "$DRY" = "0" ]; then
  # Past step 0 only with the sha and URL it resolved (a hand-set SG_MAINLINE_SHA that is not a sha pins nothing).
  if ! printf '%s' "$MAINLINE_SHA" | grep -qE '^[0-9a-f]{40}$' || [ -z "$ORIGIN_URL" ]; then
    echo "build-tick: SG_MAINLINE_SHA is not a 40-hex sha, or SG_ORIGIN_URL is empty — step 0 sets both; refusing" >&2
    exit 2
  fi
fi
cd "$REPO_ROOT" || { echo "cannot enter $REPO_ROOT" >&2; exit 1; }

# Wall-clock budgets. The per-stage caps live in build-tick-stages.mjs's stage table and
# nowhere else; the four restated below feed the hung-hand budget, and the helper's --self-test
# fails if any differs from the table or if STAGES_SECONDS is not the helper's worst case. The
# hung-hand threshold is DERIVED from what a run can legitimately take (a refresh, every model
# stage, this run's preflight and breadth, and an hour of git/gh slack), not a guess.
PREFLIGHT_SECONDS=5400
BREADTH_SECONDS=3600
REFRESH_SECONDS=$((PREFLIGHT_SECONDS + BREADTH_SECONDS + 1800))
TRIAGE_SECONDS=900
BUILD_SECONDS=7200
FIX_SECONDS=$((BUILD_SECONDS / 2))
REVIEW_SECONDS=1800
STAGES_SECONDS=$((TRIAGE_SECONDS + BUILD_SECONDS + FIX_SECONDS + 2 * REVIEW_SECONDS))
HUNG_SECONDS=$((REFRESH_SECONDS + STAGES_SECONDS + PREFLIGHT_SECONDS + BREADTH_SECONDS + 3600))
BUILD_WT="$(cd "$REPO_ROOT/.." && pwd)/$(basename "$REPO_ROOT").build"
# Mainline's copy of the landing classifier, extracted from git at classify time (step 8) and removed at exit.
CLASSIFIER="$CACHE/classify-$STAMP.mjs"
NOHOOKS="$CACHE/no-hooks"
# The gates' exact verdict lines. A quick-mode preflight prints a longer line and does not count.
PF_VERDICT='^Preflight PASSED — everything it runs is green\.$'
BR_VERDICT='^Breadth lane PASSED( — .*)?$'
# owner/repo for gh, from the URL read before any session — never from the clone's own config, which a session can edit.
REPO_SLUG="$(printf '%s' "$ORIGIN_URL" | sed -E 's#^.*github\.com[:/]##; s#\.git$##; s#/+$##')"
printf '%s' "$REPO_SLUG" | grep -qE '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' || REPO_SLUG=""

# Every script-side git call in the build clone goes through sgit. A session can plant .git/hooks,
# point core.hooksPath at hooks it wrote, or set core.fsmonitor to a command; none of that may run
# with this script's credentials. CI's frozen-lockfile install is the lockfile guard for tick PRs
# (the repo's local pre-push hook is the one thing this deliberately does not run).
sgit() { git -c core.hooksPath="$NOHOOKS" -c core.fsmonitor=false "$@"; }

# The build clone, ready for this run: created on the first run (`git clone --reference` the person's
# repo, so the objects are borrowed and only new ones cross the network), its config rewritten from
# scratch EVERY run, then fetched to the pinned sha and reset to it. The first form of this tick used
# a linked worktree of the person's repo (a .git FILE); that is removed, never reused. Output goes to the run log.
prepare_clone() {
  git -C "$REPO_ROOT" worktree prune
  if [ -e "$BUILD_WT" ] && [ ! -d "$BUILD_WT/.git" ]; then
    git -C "$REPO_ROOT" worktree remove --force "$BUILD_WT" || return 1
  fi
  _fresh=0
  if [ ! -d "$BUILD_WT/.git" ]; then
    git clone -q --reference "$REPO_ROOT" --no-checkout "$ORIGIN_URL" "$BUILD_WT" || return 1
    _fresh=1
  fi
  # What a dead session left in the clone's own control files: replaced, not trusted.
  _cfg="$BUILD_WT/.git/config"
  rm -f "$_cfg"
  git config --file "$_cfg" core.repositoryformatversion 0 \
    && git config --file "$_cfg" core.filemode true \
    && git config --file "$_cfg" core.bare false \
    && git config --file "$_cfg" core.logallrefupdates true \
    && git config --file "$_cfg" remote.origin.url "$ORIGIN_URL" \
    && git config --file "$_cfg" remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*' || return 1
  mkdir -p "$BUILD_WT/.git/info" && : > "$BUILD_WT/.git/info/exclude" && : > "$BUILD_WT/.git/info/attributes" || return 1
  PREP_LEFT=0
  if [ "$_fresh" = "0" ]; then PREP_LEFT="$(sgit -C "$BUILD_WT" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"; fi
  sgit -C "$BUILD_WT" fetch -q "$ORIGIN_URL" "$MAINLINE_SHA" || return 1
  sgit -C "$BUILD_WT" checkout -q -f --detach "$MAINLINE_SHA" || return 1
  sgit -C "$BUILD_WT" clean -fdq || return 1
}

# What this run's commits changed, against the PINNED sha with rename detection off: a rename would list
# only the new name and hide the deletion of CLAUDE.md or a hook behind it. Fails (non-zero) if the sha is not a commit.
changed_since_base() { sgit diff --name-only --no-renames "$MAINLINE_SHA...HEAD"; }

# The push, by sha: HEAD must still be the commit the gates ran on, the tree clean (what the gates saw is what is
# pushed), and the pinned mainline an ancestor of it. Prints the reason on stdout and returns non-zero if not.
push_branch() {
  [ "$(sgit rev-parse HEAD)" = "$HEAD_SHA" ] || { echo "HEAD is no longer $HEAD_SHA (it moved while the gates ran)"; return 1; }
  [ -z "$(sgit status --porcelain)" ] || { echo "the tree is dirty after the gates, so what they saw is not what would be pushed: $(sgit status --porcelain | head -5 | tr '\n' ' ')"; return 1; }
  sgit merge-base --is-ancestor "$MAINLINE_SHA" "$HEAD_SHA" || { echo "$HEAD_SHA does not descend from the pinned mainline $MAINLINE_SHA"; return 1; }
  sgit push -q "$ORIGIN_URL" "$HEAD_SHA:refs/heads/$BRANCH"
}

# A gate is green only when it EXITED 0, printed its own full verdict line, and the sentinel this script
# appended after it names the commit being pushed: $1 the log, $2 PREFLIGHT|BREADTH, $3 the verdict (an anchored grep -E).
gate_green() {
  [ "$(tail -n 1 "$1" 2>/dev/null)" = "${2}_EXIT 0 $HEAD_SHA" ] && grep -qE "$3" "$1"
}

# A failure of the HELPER or of this script's own plumbing (no verdict written, an unknown verdict, an unreadable
# outcome) is a PAUSE, not only a hand: a hand keeps the claim and the next tick takes a NEW row, so a broken helper
# would burn the backlog 3 h at a time. Same rule as a broken session (1a). $1 why, $2 what is true of the claim.
pause_tick() {
  printf 'the build tick paused itself on %s: %s; log %s\n' "$STAMP" "$1" "${RUN_LOG:-none}" > "$PAUSED"
  fail "$1. The build tick is PAUSED (${2:-claim status unknown}): fix the cause, then delete $PAUSED"
}

# ── 1. one run at a time ─────────────────────────────────────────────────────
# mkdir is atomic (bash 3.2 has no flock). A lock with a live holder, or with no pid yet
# and younger than 60 s (the holder is between mkdir and writing its pid), is live.
LOCK="$CACHE/build-tick.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  _holder="$(cat "$LOCK/pid" 2>/dev/null || true)"
  _age=$(( $(date +%s) - $(stat -f %m "$LOCK" 2>/dev/null || date +%s) ))
  if { [ -n "$_holder" ] && kill -0 "$_holder" 2>/dev/null; } || { [ -z "$_holder" ] && [ "$_age" -lt 60 ]; }; then
    # A live holder past HUNG_SECONDS (longer than a full staged run can take) is hung (a
    # stalled install, fetch or gh call): say so once.
    if [ "$_age" -gt "$HUNG_SECONDS" ] && [ ! -e "$LOCK/hung-hand" ]; then
      : > "$LOCK/hung-hand"
      raise_hand "a build tick (pid $_holder) has held $LOCK for $((_age / 3600)) h (a full run fits in $((HUNG_SECONDS / 3600)) h) — it is hung; kill that pid and read the newest ~/Library/Logs/signalgrid/build-tick-*.log"
    fi
    say "result: skipped: another build tick (pid ${_holder:-starting}) holds $LOCK"
    exit 0
  fi
  say "stale build lock (holder ${_holder:-unknown} is gone) — clearing it"
  rm -f "$LOCK/pid" "$LOCK/hung-hand"; rmdir "$LOCK" 2>/dev/null || true
  mkdir "$LOCK" 2>/dev/null || { say "result: skipped: could not take $LOCK"; exit 0; }
fi
printf '%s' "$$" > "$LOCK/pid"
trap 'rm -f "$LOCK/pid" "$LOCK/hung-hand" "$CLASSIFIER"; rmdir "$LOCK" 2>/dev/null' EXIT
# The empty hooks directory every sgit call points core.hooksPath at, recreated empty each run before any session exists.
rm -rf "${CACHE:?}/no-hooks"
mkdir -p "$NOHOOKS" || { echo "cannot create $NOHOOKS" >&2; exit 1; }

for _tool in git gh node pnpm npm claude perl; do
  command -v "$_tool" >/dev/null 2>&1 || fail "$_tool is not on PATH for launchd (edit PATH at the top of scripts/mac/build-tick.sh)"
done

# ── 1a. paused? ──────────────────────────────────────────────────────────────
# A BROKEN session (logged out, usage limit, no Keychain under launchd) pauses the tick: build-tick-stages.mjs
# calls a session broken when its envelope names an API error or the CLI died with no envelope (a turn or
# time cap is not broken). A broken TRIAGE pauses before any claim, so no row is claimed; a session that
# breaks AFTER the claim pauses the tick but leaves that row's claim branch for a person. A helper that fails
# (cannot read a brief, throws) pauses it the same way. While paused the tick does nothing at all, the PR refresh included.
PAUSED="$CACHE/paused"
if [ "$DRY" = "0" ] && [ -f "$PAUSED" ]; then
  echo "build-tick: paused — $(head -c 300 "$PAUSED" | tr '\n' ' '); delete $PAUSED to resume"
  exit 0
fi

# Run a command under a wall-clock cap that kills its WHOLE PROCESS GROUP. perl forks the command into its own
# group; at the cap it TERMs the group, waits up to 5 s, KILLs it and exits 142. Otherwise it exits with the
# command's own status (128 + signal if the command was killed). A plain `alarm` + `exec` only ends the
# launcher: pr-refresh.mjs re-execs itself in a child, and preflight and breadth spawn children of their own;
# those would outlive the cap. Used for the refresh (1b), preflight and breadth (8); build-tick-stages.mjs runs
# every claude session under the SAME perl program (the helper's --self-test holds the two equal).
capped() {
  _cap="$1"; shift
  perl -e '
    my $cap = shift @ARGV;
    my $pid = fork();
    die "fork: $!" unless defined $pid;
    if (!$pid) { setpgrp(0, 0); exec @ARGV or die "exec: $!"; }
    setpgrp($pid, $pid);    # from the parent too: the group must exist before the first kill
    $SIG{ALRM} = sub {
      kill "TERM", -$pid;
      for (1 .. 50) { waitpid($pid, 1); last unless kill 0, -$pid; select(undef, undef, undef, 0.1); }
      kill "KILL", -$pid;
      waitpid($pid, 0);
      exit 142;
    };
    alarm $cap;
    waitpid($pid, 0);
    exit($? & 127 ? 128 + ($? & 127) : $? >> 8);' "$_cap" "$@"
}

# ── dry-run only: pin the sha a real run would have pinned ───────────────────
# Under the seams that is the SCRATCH remote's SignalGrid_Alpha (and nothing is fetched); otherwise the real remote, read-only.
if [ "$DRY" = "1" ]; then
  [ -n "$ORIGIN_URL" ] || ORIGIN_URL="$(git remote get-url origin 2>/dev/null || true)"
  REPO_SLUG="$(printf '%s' "$ORIGIN_URL" | sed -E 's#^.*github\.com[:/]##; s#\.git$##; s#/+$##')"
  printf '%s' "$REPO_SLUG" | grep -qE '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' || REPO_SLUG=""
  if [ "$SEAMS" = "1" ]; then
    _dry_src="$REMOTE"; MAINLINE_SHA="$(remote_mainline_sha "$_dry_src")"
  else
    MAINLINE_SHA="$(remote_mainline_sha "$ORIGIN_URL")"
    [ -n "$MAINLINE_SHA" ] || origin_down "git ls-remote could not read refs/heads/SignalGrid_Alpha"
    git fetch -q "$ORIGIN_URL" "$MAINLINE_SHA" 2>/dev/null || origin_down "could not fetch mainline $MAINLINE_SHA"
  fi
  say "dry-run: mainline pinned at ${MAINLINE_SHA:-<unknown: the scratch remote has no SignalGrid_Alpha>}"
fi

# ── 1b. refresh one dirty mac/* PR, before any row ───────────────────────────
# Mainline's own pr-refresh.mjs at the PINNED sha, never a branch copy, extracted to a fresh file with a .mjs
# name (node treats an extensionless file as CommonJS). It may push ONE fast-forward merge
# of mainline onto ONE open mac/* PR head (never a mac/tick-* one), only after
# preflight and breadth exit 0 on that head; that preflight runs the PR's code WITH
# credentials (the registry row's writeScope says so). It needs no model. A refresh failure
# NEVER stops the build.
if [ "$DRY" = "1" ]; then
  if [ -n "$MAINLINE_SHA" ] && git cat-file -e "$MAINLINE_SHA:scripts/mac/pr-refresh.mjs" 2>/dev/null; then
    say "dry-run: would run mainline's scripts/mac/pr-refresh.mjs --max 1"
  else
    say "dry-run: mainline has no scripts/mac/pr-refresh.mjs yet — would skip the refresh"
  fi
elif git cat-file -e "$MAINLINE_SHA:scripts/mac/pr-refresh.mjs" 2>/dev/null; then
  _rd="$(mktemp -d "$CACHE/pr-refresh.XXXXXX")" || _rd=""
  if [ -n "$_rd" ] && git show "$MAINLINE_SHA:scripts/mac/pr-refresh.mjs" > "$_rd/pr-refresh.mjs" 2>/dev/null; then
    # Under a wall-clock cap (REFRESH_SECONDS, the budget HUNG_SECONDS counts): its own preflight
    # and breadth have none, and a hung refresh would hold the lock and starve every later tick.
    # The cap kills the process GROUP (capped above), so pr-refresh's re-exec'd child and the gates
    # it spawned die with the launcher.
    capped "$REFRESH_SECONDS" env SG_REPO_ROOT="$REPO_ROOT" SG_MAINLINE_SHA="$MAINLINE_SHA" node "$_rd/pr-refresh.mjs" --max 1 >> "$CACHE/pr-refresh.log" 2>&1 < /dev/null
    _rc=$?
    say "pr-refresh exited $_rc (142 = the ${REFRESH_SECONDS}s cap; log $CACHE/pr-refresh.log)"
  else
    say "WARN could not extract mainline's pr-refresh.mjs — skipping the refresh"
  fi
  if [ -n "$_rd" ]; then rm -f "$_rd/pr-refresh.mjs"; rmdir "$_rd" 2>/dev/null || true; fi
else
  say "mainline has no scripts/mac/pr-refresh.mjs yet — skipping the refresh"
fi

# ── 2. the ranked tasks, from the pinned sha ─────────────────────────────────
if [ -n "$STATE_FILE" ]; then
  STATE_JSON="$(cat "$STATE_FILE" 2>/dev/null)"
else
  STATE_JSON="$(git show "$MAINLINE_SHA:docs/agent/objective-state.json" 2>/dev/null)"
fi
# rowId goes into a branch name, a regex and the brief, so a row whose id is not
# [A-Za-z0-9] is SKIPPED (named in the log), never escaped, and never stops the rows
# below it. A title's "{{" is broken up so it cannot look like a placeholder. stderr goes
# to a file: a warning is never a task line.
_err="$(mktemp "$CACHE/tasks-err.XXXXXX")"
TASKS="$(printf '%s' "$STATE_JSON" | node -e '
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    try {
      const tasks = JSON.parse(s).tasks;
      if (!Array.isArray(tasks)) throw new Error("tasks[] is not an array");
      const out = [];
      for (const t of [...tasks].sort((a, b) => a.rank - b.rank)) {
        if (!/^[A-Za-z0-9]+$/.test(String(t.rowId))) { console.error(`skipped rowId ${JSON.stringify(t.rowId)}: not [A-Za-z0-9]+`); continue; }
        out.push(`${t.rowId}\t${String(t.title ?? "").replace(/\s+/g, " ").split("{{").join("{ {")}\n`);
      }
      process.stdout.write(out.join(""));
    } catch (e) { console.error(e.message); process.exit(1); }
  });' 2>"$_err")" || fail "could not read tasks[] from ${STATE_FILE:-mainline $MAINLINE_SHA:docs/agent/objective-state.json}: $(cat "$_err")"
[ -s "$_err" ] && say "$(tr '\n' ' ' < "$_err")"
rm -f "$_err"
if [ -z "$TASKS" ]; then
  say "result: nothing buildable (the state ranks no task)"
  exit 0
fi

# ── 3. the first row nobody has claimed ──────────────────────────────────────
# Read the branch and open-PR lists into HEAD_LIST / PR_HEADS_TITLES / PR_BODIES. Called at pick time and
# again right before the claim (triage can run as long as its stage-table cap, and a lane or a person may take the row).
# The branch list is the REAL remote's, named by the URL read before any session; the PR list is gh's, by the
# owner/repo slug from that URL (never the cwd's own config). Under the dry-run seams the branch list is the scratch
# remote's and the PR list is empty: no gh call. Title (with its head) and body are matched separately: a body
# names rows in passing, so only "plan row N" / "row-N" there counts.
load_inflight() {
  _src="$REMOTE"
  if [ "$REMOTE" = "origin" ] && [ -n "$ORIGIN_URL" ]; then _src="$ORIGIN_URL"; fi
  HEADS="$(git ls-remote --heads "$_src" 2>&1)" \
    || fail "could not list $_src's branches — in-flight work unknown, not building blind"
  if [ "$SEAMS" = "1" ]; then
    PRS=""
  else
    [ -n "$REPO_SLUG" ] || fail "could not read owner/repo from the origin URL ($ORIGIN_URL) — in-flight work unknown, not building blind"
    PRS="$(gh api --paginate "repos/$REPO_SLUG/pulls?state=open&per_page=100" --jq '.[] | "\(.head.ref)\t\(.title | gsub("\\s+"; " "))\t\(.body // "" | gsub("\\s+"; " "))"' 2>&1)" \
      || fail "could not list open PRs (gh api) — in-flight work unknown, not building blind"
  fi
  PR_HEADS_TITLES="$(cut -f1,2 <<< "$PRS")"
  PR_BODIES="$(cut -f3- <<< "$PRS")"
}
load_inflight
in_flight() {
  _broad="(^|[^0-9A-Za-z])rows?[ -]*#?$1([^0-9A-Za-z]|\$)"
  if grep -qiE "$_broad" <<< "$HEADS"; then echo "a remote branch names row $1"; return 0; fi
  if grep -qiE "$_broad" <<< "$PR_HEADS_TITLES"; then echo "an open PR's title or head names row $1"; return 0; fi
  if grep -qiE "(plan[ -]rows?[ -]*#?|(^|[^0-9A-Za-z])row-)$1([^0-9A-Za-z]|\$)" <<< "$PR_BODIES"; then
    echo "an open PR's body names plan row $1"; return 0
  fi
  return 1
}
PICK_ID=""
PICK_TITLE=""
N_TASKS=0
while IFS="$(printf '\t')" read -r _id _title; do
  [ -n "$_id" ] || continue
  N_TASKS=$((N_TASKS + 1))
  if _why="$(in_flight "$_id")"; then say "row $_id claimed ($_why) — next"; continue; fi
  PICK_ID="$_id"; PICK_TITLE="$_title"; break
done <<TASKS_EOF
$TASKS
TASKS_EOF
if [ -z "$PICK_ID" ]; then
  say "result: nothing buildable ($N_TASKS ranked task(s), every one claimed)"
  exit 0
fi
BRANCH="mac/build-row-$PICK_ID-$STAMP"
RUN_DIR="$CACHE/runs/$STAMP"
say "picked plan row $PICK_ID ('$PICK_TITLE') → $BRANCH"

# ── the dry-run: the exact command of every stage ───────────────────────────
# The helper renders every brief for real (a broken one fails the dry-run), then prints one
# line per stage with the brief shown as a placeholder. Read from the helper's OWN file, so
# --dry-run shows the file in front of you; a real run uses the build clone's, which is
# the pinned sha's.
TODAY="$(date -u +%Y-%m-%d)"
if [ "$DRY" = "1" ]; then
  _cmds="$(node "$REPO_ROOT/scripts/mac/build-tick-stages.mjs" commands --row "$PICK_ID" --title "$PICK_TITLE" --branch "$BRANCH" --run-dir "$RUN_DIR" --today "$TODAY" --base "${MAINLINE_SHA:-unknown}" 2>&1)" \
    || fail "could not print the stage commands: $_cmds"
  say "dry-run: would triage (read-only), then claim $BRANCH, then run the staged pipeline in $BUILD_WT; the stage commands:"
  printf '%s\n' "$_cmds" | sed 's/^/dry-run: /'
  exit 0
fi

# ── 4. its own clone, fresh every run ────────────────────────────────────────
LOG_DIR="$HOME/Library/Logs/signalgrid"
mkdir -p "$LOG_DIR" "$RUN_DIR" || fail "cannot create $LOG_DIR / $RUN_DIR"
RUN_LOG="$LOG_DIR/build-tick-$STAMP.log"
say "picked plan row $PICK_ID ('$PICK_TITLE') → $BRANCH; log $RUN_LOG; mainline pinned at $MAINLINE_SHA"
# Dedicated to this script and locked above, so anything left in it is a dead session's.
PREP_LEFT=0
prepare_clone >> "$RUN_LOG" 2>&1 \
  || fail "could not prepare the build clone at $BUILD_WT at the pinned mainline $MAINLINE_SHA (see $RUN_LOG)"
[ "$PREP_LEFT" = "0" ] || say "discarded $PREP_LEFT leftover path(s) from an earlier run"
cd "$BUILD_WT" || fail "cannot enter the build clone at $BUILD_WT"

# ── 5. deps + tsx's esbuild ──────────────────────────────────────────────────
LOCK_SHA="$(shasum -a 256 pnpm-lock.yaml 2>/dev/null | cut -d' ' -f1)"
INSTALL_STAMP="node_modules/.sg-installed-lock-sha"
if [ -z "$LOCK_SHA" ] || [ ! -f "$INSTALL_STAMP" ] || [ "$(cat "$INSTALL_STAMP" 2>/dev/null)" != "$LOCK_SHA" ]; then
  pnpm install --frozen-lockfile >> "$RUN_LOG" 2>&1 || fail "pnpm install --frozen-lockfile in $BUILD_WT"
  printf '%s' "$LOCK_SHA" > "$INSTALL_STAMP"
  say "pnpm install --frozen-lockfile (lockfile moved)"
fi
# The workspace overrides strip every non-linux esbuild binary, so tsx cannot start here.
# Fetch the one tsx resolves into a cache OUTSIDE the repo, once per version.
ESB_VER="$(node -e 'const fs = require("fs"), { createRequire } = require("module");
  process.stdout.write(createRequire(fs.realpathSync("scripts/node_modules/tsx/package.json"))("esbuild/package.json").version);' 2>/dev/null)"
[ -n "$ESB_VER" ] || fail "could not resolve the esbuild version tsx uses"
ESB_PKG="@esbuild/darwin-$(uname -m | sed 's/x86_64/x64/')"
ESB_DIR="$HOME/Library/Caches/signalgrid/esbuild-$ESB_VER"
ESBUILD_BINARY_PATH="$ESB_DIR/node_modules/$ESB_PKG/bin/esbuild"
if [ ! -x "$ESBUILD_BINARY_PATH" ]; then
  npm install -q --prefix "$ESB_DIR" --no-save --no-package-lock "$ESB_PKG@$ESB_VER" >> "$RUN_LOG" 2>&1
  [ -x "$ESBUILD_BINARY_PATH" ] || fail "could not fetch $ESB_PKG@$ESB_VER into $ESB_DIR"
fi
export ESBUILD_BINARY_PATH

# ── 6. triage, THEN the claim ────────────────────────────────────────────────
# Triage is read-only and runs before the claim, so a BROKEN triage session (see 1a: an API-error
# envelope, which is what a logged-out CLI prints, or a CLI that died with no envelope) pauses the
# tick before any claim is pushed. A triage that hit its turn or time cap is a hand, not a pause.
# Everything below the helper's stage table (tiers, caps, tool sets, scrubbed environment) is in
# the helper.
[ -f scripts/mac/build-tick-stages.mjs ] || fail "mainline $MAINLINE_SHA has no scripts/mac/build-tick-stages.mjs — nothing to run the stages with"
stages() {
  _sub="$1"; shift
  node scripts/mac/build-tick-stages.mjs "$_sub" --row "$PICK_ID" --title "$PICK_TITLE" --branch "$BRANCH" \
    --run-dir "$RUN_DIR" --cache "$CACHE" --today "$TODAY" --stamp "$STAMP" --base "$MAINLINE_SHA" "$@"
}
claim() {
  # Triage can run as long as its stage-table cap. If the cloud lane or a person claimed this row meanwhile, skip it.
  load_inflight
  if _why="$(in_flight "$PICK_ID")"; then
    say "result: skipped: plan row $PICK_ID was claimed while triage ran ($_why) — nothing pushed"
    exit 0
  fi
  sgit switch -q -c "$BRANCH" >> "$RUN_LOG" 2>&1 || fail "could not create $BRANCH in the build clone"
  sgit push -q "$ORIGIN_URL" "$MAINLINE_SHA:refs/heads/$BRANCH" >> "$RUN_LOG" 2>&1 || fail "could not push the claim branch $BRANCH"
  say "claimed plan row $PICK_ID with $BRANCH (at the pinned mainline $MAINLINE_SHA)"
}
rm -f "$RUN_DIR/next" "$RUN_DIR/outcome.json"
say "triage starting (read-only; tier and cap are the helper's stage table), no git/GitHub credentials"
stages triage >> "$RUN_LOG" 2>&1 < /dev/null
_next="$(head -1 "$RUN_DIR/next" 2>/dev/null)"
[ -n "$_next" ] || pause_tick "plan row $PICK_ID: triage wrote no $RUN_DIR/next — not claiming a row it could not read" "NO claim was pushed, so this row is still unclaimed"
_verb="${_next%% *}"
_rest="${_next#"$_verb"}"; _rest="${_rest# }"
case "$_verb" in
  pause) pause_tick "plan row $PICK_ID: $_rest" "NO claim was pushed, so this row is still unclaimed" ;;
  hand)
    claim   # claimed first, so the row is not re-triaged every 3 h
    fail "plan row $PICK_ID: triage: $_rest. Claim $BRANCH stays until a person deletes it" ;;
  marker|build) claim ;;
  *) pause_tick "plan row $PICK_ID: triage wrote an unknown verdict: $_next" "NO claim was pushed, so this row is still unclaimed" ;;
esac

# ── 7. the pipeline ──────────────────────────────────────────────────────────
# `marker`: the helper writes one plan-row marker, commits it, opus reviews it. `build`: the
# build stage on the tier its kind names, a review, at most one fix on the build's own tier,
# a second review. Each stage logs its tier, turns, cost and exit into the run log; the
# verdict is $RUN_DIR/outcome.json (land | hand | pause).
say "pipeline starting: path $_verb${_rest:+ ($_rest)}"
stages run --path "$_verb" --kind "${_rest:-none}" >> "$RUN_LOG" 2>&1 < /dev/null
[ -s "$RUN_DIR/outcome.json" ] || pause_tick "plan row $PICK_ID: the pipeline wrote no $RUN_DIR/outcome.json" "claim $BRANCH stays until a person deletes it"
_oc="$(node -e 'const o = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  process.stdout.write(`${o.outcome}\t${String(o.reason ?? "").replace(/\s+/g, " ")}`);' "$RUN_DIR/outcome.json" 2>&1)" \
  || pause_tick "plan row $PICK_ID: could not read $RUN_DIR/outcome.json: $(printf '%s' "$_oc" | head -c 300 | tr '\n' ' ')" "claim $BRANCH stays until a person deletes it"
IFS="$(printf '\t')" read -r OUTCOME REASON <<< "$_oc"
say "pipeline outcome: $OUTCOME — $REASON"

# ── 8. the outward half: gate, push, PR ──────────────────────────────────────
case "$OUTCOME" in
  land) ;;
  pause) pause_tick "plan row $PICK_ID: $REASON" "the claim $BRANCH stays; delete it too" ;;
  hand) fail "plan row $PICK_ID: $REASON. Claim $BRANCH stays until a person deletes it" ;;
  *) pause_tick "plan row $PICK_ID: the pipeline's outcome was '$OUTCOME', not land, hand or pause" "the claim $BRANCH stays; delete it too" ;;
esac
HEAD_SHA="$(sgit rev-parse HEAD)" && [ -n "$HEAD_SHA" ] || fail "plan row $PICK_ID: could not read the build clone's HEAD"
sgit merge-base --is-ancestor "$MAINLINE_SHA" "$HEAD_SHA" || fail "plan row $PICK_ID: the commit $HEAD_SHA does not descend from the pinned mainline $MAINLINE_SHA — not landing a rewritten history"
[ -z "$(sgit status --porcelain)" ] || fail "plan row $PICK_ID: the tree is not clean after the pipeline's last commit $HEAD_SHA, so the gates would not be testing what is pushed"
# The brief forbids these paths; the script enforces it, and derives the landing class
# from the diff rather than trusting the session's own "Owner decision needed:" line. The diff is
# against the PINNED sha with renames off (changed_since_base), never a ref or a rename-collapsed list.
CHANGED="$(changed_since_base)" || fail "plan row $PICK_ID: could not diff $HEAD_SHA against the pinned mainline $MAINLINE_SHA"
[ -n "$CHANGED" ] || fail "plan row $PICK_ID: the pipeline said land but $HEAD_SHA changes nothing against the pinned mainline $MAINLINE_SHA"
# CLAUDE.md, AGENTS.md, .claude/ and .githooks/ are forbidden at ANY depth (a nested copy steers a later session too).
# So is the classifier itself (check-owner-gated-surfaces): a session that edits it is hand-back, not a landing.
FORBIDDEN_RE='(^|/)(CLAUDE|AGENTS)\.md$|(^|/)\.claude/|(^|/)\.githooks/|^(docs/DECISION_RECORDS\.md|docs/agent/(objective\.json|LOOP\.md|launch-claims-)|docs/(LAUNCH_PROFILE|PUBLICATION_BOUNDARY)\.md|scripts/(launch-profile|check-launch-profile|check-launch-claims|publication-boundary|check-publication-boundary|check-owner-gated-surfaces)|native/ios/EnterpriseShell/Services/(DecisionEngine|AppWorkflows)\.swift)'
FORBIDDEN="$(grep -E "$FORBIDDEN_RE" <<< "$CHANGED")"
# The class comes from MAINLINE's classifier at the pinned sha, extracted from git into the cache, never the build clone's copy: the
# session had write access there and could re-classify its own owner-reserved change as SAFETY_MACHINERY. The file
# imports only node: builtins, so one file is enough. The path goes in by env, never argv[1]: the classifier's
# main-module guard would otherwise run its CLI and print its manifest into the answer. Prints the class, or fails.
classify_change() {
  git -C "$REPO_ROOT" show "$MAINLINE_SHA:scripts/check-owner-gated-surfaces.mjs" > "$CLASSIFIER" 2>>"${RUN_LOG:-/dev/null}" && [ -s "$CLASSIFIER" ] || return 1
  SG_CLASSIFIER="$CLASSIFIER" node --input-type=module -e 'import { pathToFileURL } from "node:url";
    const { classifyDiff } = await import(pathToFileURL(process.env.SG_CLASSIFIER).href);
    const files = process.argv[1].split("\n").filter(Boolean);
    const cats = new Set(classifyDiff(files).matched.map((m) => m.category));
    process.stdout.write(cats.has("OWNER_RESERVED") ? "OWNER_RESERVED" : cats.has("DECISION_PATH") ? "DECISION_PATH" : "SAFETY_MACHINERY");' "$1" 2>>"${RUN_LOG:-/dev/null}"
}
if [ -n "$FORBIDDEN" ]; then
  fail "plan row $PICK_ID: the change touches paths the build tick may not land ($(tr '\n' ' ' <<< "$FORBIDDEN")). Nothing pushed past the claim; the commit $HEAD_SHA stays on the local branch $BRANCH"
fi
CLASS="$(classify_change "$CHANGED")"
rm -f "$CLASSIFIER"
case "$CLASS" in
  OWNER_RESERVED|DECISION_PATH|SAFETY_MACHINERY) ;;
  *) fail "plan row $PICK_ID: could not classify the change with mainline's check-owner-gated-surfaces.mjs — not pushing an unclassified change" ;;
esac
if [ "$CLASS" = "OWNER_RESERVED" ]; then
  fail "plan row $PICK_ID: the change touches owner-reserved paths the build tick may not land ($CLASS). Nothing pushed past the claim; the commit $HEAD_SHA stays on the local branch $BRANCH"
fi
say "committed $HEAD_SHA ($CLASS); preflight then breadth"
capped "$PREFLIGHT_SECONDS" node scripts/preflight.mjs > "$RUN_DIR/preflight.log" 2>&1 < /dev/null
PF=$?
printf '\nPREFLIGHT_EXIT %s %s\n' "$PF" "$(sgit rev-parse HEAD 2>/dev/null)" >> "$RUN_DIR/preflight.log"
BR=1
if [ "$PF" = "0" ]; then
  capped "$BREADTH_SECONDS" pnpm run verify:breadth > "$RUN_DIR/breadth.log" 2>&1 < /dev/null
  BR=$?
  printf '\nBREADTH_EXIT %s %s\n' "$BR" "$(sgit rev-parse HEAD 2>/dev/null)" >> "$RUN_DIR/breadth.log"
fi
PF_LINE="$(grep -E 'Preflight (PASSED|FAILED)' "$RUN_DIR/preflight.log" | tail -1)"
BR_LINE="$(grep -E 'Breadth lane (PASSED|FAILED)' "$RUN_DIR/breadth.log" 2>/dev/null | tail -1)"
if [ "$PF" != "0" ] || [ "$BR" != "0" ] || ! gate_green "$RUN_DIR/preflight.log" PREFLIGHT "$PF_VERDICT" || ! gate_green "$RUN_DIR/breadth.log" BREADTH "$BR_VERDICT"; then
  fail "plan row $PICK_ID: gates not green on $HEAD_SHA (preflight exit $PF: ${PF_LINE:-no verdict line}; breadth exit $BR: ${BR_LINE:-not run}; a green gate needs exit 0, its exact full verdict line and a sentinel naming $HEAD_SHA). Nothing pushed past the claim; the commit stays on the local branch $BRANCH (the next run resets only the clone). Logs: $RUN_DIR"
fi
_why="$(push_branch 2>&1)" || fail "plan row $PICK_ID: gates green but the push of $BRANCH was refused or failed: $_why"
{ printf 'Landing class (derived from the diff by check-owner-gated-surfaces.mjs): **%s**\n\n' "$CLASS"
  cat "$RUN_DIR/pr-body.md"
  printf '\n\n'
  cat "$RUN_DIR/pr-body-stages.md"
  printf '\n\n## Gates (run by scripts/mac/build-tick.sh on %s, after the pipeline)\n\n- `node scripts/preflight.mjs` exit %s: %s\n- `pnpm run verify:breadth` exit %s: %s\n\nOpened by the unattended build tick (DR-061 rule 4). It never merges; a lane merges it, if at all, under DR-037 / DR-061 rule 1.\n' \
    "$HEAD_SHA" "$PF" "$PF_LINE" "$BR" "$BR_LINE"
} > "$RUN_DIR/pr-body-final.md"
node scripts/mac/gh-pr.mjs open --head "$BRANCH" --title "$(head -1 "$RUN_DIR/pr-title.txt")" --body-file "$RUN_DIR/pr-body-final.md" >> "$RUN_LOG" 2>&1 \
  || fail "plan row $PICK_ID: pushed $BRANCH but gh-pr.mjs could not open its PR"
# The owner comes from origin's URL; an empty owner would make head=:<branch> match any PR.
OWNER="${REPO_SLUG%%/*}"
[ -n "$OWNER" ] || fail "plan row $PICK_ID: pushed $BRANCH but could not read the repo owner from origin to verify its PR"
_open="$(gh api "repos/$REPO_SLUG/pulls?head=$OWNER:$BRANCH&state=open" --jq length 2>/dev/null)"
[ "${_open:-0}" -ge 1 ] 2>/dev/null || fail "plan row $PICK_ID: pushed $BRANCH but no open PR for it could be found afterwards"
say "result: acted: plan row $PICK_ID — $BRANCH at $HEAD_SHA, preflight + breadth green, PR open"
exit 0
