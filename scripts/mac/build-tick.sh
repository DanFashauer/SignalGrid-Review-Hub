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
#   build    haiku (mechanical) | sonnet (code) | opus (judgment): edits its worktree only;
#   review   opus, READ-ONLY: ship, fix (one pass) or reject;
#   fix      at most one, on the build's own tier, then a second review.
# A `done` triage needs no build at all: the helper writes one plan-row marker and opus
# reviews it. No model session has git or GitHub credentials (no ssh agent,
# GIT_SSH_COMMAND=false, no git global config so no credential helper, an empty gh config,
# no tokens), and the build and fix stages have push, commit, merge, gh and lane-mail
# commands deny-listed. The helper makes LOCAL commits only. THIS SCRIPT does every
# outward act: it claims the row, refuses a change that touches an owner-reserved or
# forbidden path, runs preflight + breadth, and only on 0/0 pushes that one branch and
# opens its PR, whose body carries the reviews and a tiers-and-cost table. Nothing here
# merges. That is enforced by the environment, the deny list and this script, not an OS
# boundary. Named escapes, all deliberate: a `pnpm exec`/`node` one-liner that re-points git
# at ssh and the on-disk keys, or code a session writes that this script's own preflight
# then runs WITH credentials (DR-061 rule 4 accepts that risk).
#
# ONE RUN, in order:
#   0. re-exec mainline's copy of this script (a real run never runs a branch copy);
#   1. one run at a time (a lock under ~/Library/Caches, never $TMPDIR, whose value
#      differs between launchd, a sandboxed shell and a plain one);
#   1b. REFRESH, before any row: mainline's PR-refresh script (when mainline has it) brings
#      ONE dirty mac/* PR up to date. It needs no model, so a paused tick still does it;
#      a failure never stops the build. Then the pause check;
#   2. fetch (four failures in a row raise a hand), read tasks[] from mainline's state;
#   3. take the first row nobody has claimed: no remote head and no open PR names it
#      ("row 12", "row-12", "rows 12", "row #12" in a head or title; "plan row 12" or
#      "row-12" in a body; a range like "rows 17-18" names only 17). A false match only
#      skips a row — the safe direction;
#   4. its OWN worktree <repo>.build, reset to origin/SignalGrid_Alpha every run;
#   5. deps when the lockfile moved; tsx's darwin esbuild from a cache outside the repo;
#   6. TRIAGE, before any claim. A broken session pauses the tick WITHOUT claiming (a broken
#      session no longer burns a row); a blocked row raises a hand; otherwise CLAIM: push
#      the empty branch mac/build-row-<id>-<stamp>, so the next run skips the row even if
#      the pipeline finds nothing to do (the cloud's forward-build cycle skips it only once
#      its row reads mac/build-row-* heads too);
#   7. the pipeline (`build-tick-stages.mjs run`): build (or the marker), review, at most
#      one fix, a second review. Its commit message, PR title and body, or a hand, go into
#      a run directory OUTSIDE the worktree (--add-dir); its verdict is RUN_DIR/outcome.json;
#   8. on `land`: refuse forbidden paths, preflight + breadth, push + PR only on 0/0.
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

# launchd starts with a minimal PATH (install-build-tick.sh); claude lives in ~/.local/bin.
PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.nvm/current/bin:$HOME/Library/pnpm"
export PATH
CACHE="$HOME/Library/Caches/signalgrid/build-tick"
mkdir -p "$CACHE" || { echo "cannot create $CACHE" >&2; exit 1; }

# ── 0. always mainline's copy ─────────────────────────────────────────────────
# launchd runs the path the installer wrote, in whatever state the person's checkout is
# in (another branch, behind). A real run fetches and re-execs origin/SignalGrid_Alpha's
# copy, so the job is always mainline's; --dry-run runs the file in front of you.
if [ "$DRY" = "0" ] && [ -z "${SG_BUILD_TICK_MAINLINE:-}" ]; then
  _root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  git -C "$_root" fetch -q origin 2>/dev/null || true
  # A fresh file per run: bash reads a script as it runs, so overwriting one a live run
  # is reading would feed it misaligned text.
  _f="$(mktemp "$CACHE/mainline.XXXXXX")" || exit 1
  if ! git -C "$_root" show origin/SignalGrid_Alpha:scripts/mac/build-tick.sh > "$_f" 2>/dev/null; then
    rm -f "$_f"
    echo "build-tick: origin/SignalGrid_Alpha has no scripts/mac/build-tick.sh — nothing to run"
    exit 0
  fi
  SG_BUILD_TICK_MAINLINE=1 SG_REPO_ROOT="$_root" exec /bin/bash "$_f"
fi
# The extracted mainline copy is this run's alone; unlink it now (bash keeps reading the
# open file).
case "$0" in "$CACHE"/mainline.*) rm -f "$0" ;; esac
REPO_ROOT="${SG_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$REPO_ROOT" || { echo "cannot enter $REPO_ROOT" >&2; exit 1; }

# Wall-clock budgets. The per-stage caps live in build-tick-stages.mjs's stage table and
# nowhere else; STAGES_SECONDS restates their worst case (900 triage + 7200 judgment build
# + 3600 judgment fix + 2 x 1800 review = 15300), and the helper's --self-test fails if it
# ever falls below the table. The hung-hand threshold is DERIVED from what a run can
# legitimately take (a refresh, every model stage, this run's preflight and breadth, and an
# hour of git/gh slack), not a guess.
PREFLIGHT_SECONDS=5400
BREADTH_SECONDS=3600
REFRESH_SECONDS=$((PREFLIGHT_SECONDS + BREADTH_SECONDS + 1800))
STAGES_SECONDS=15300
HUNG_SECONDS=$((REFRESH_SECONDS + STAGES_SECONDS + PREFLIGHT_SECONDS + BREADTH_SECONDS + 3600))
BUILD_WT="$(cd "$REPO_ROOT/.." && pwd)/$(basename "$REPO_ROOT").build"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_LOG=""
say() {
  printf 'build-tick %s  %s\n' "$STAMP" "$1"
  [ -n "$RUN_LOG" ] && printf 'build-tick %s  %s\n' "$STAMP" "$1" >> "$RUN_LOG"
  return 0
}

# A hand through lane-deliver (straight to mainline on the Mac), never only a file in the
# build worktree — that worktree is reset next run. raise-hand.mjs keys a hand on the day
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
trap 'rm -f "$LOCK/pid" "$LOCK/hung-hand"; rmdir "$LOCK" 2>/dev/null' EXIT

for _tool in git gh node pnpm npm claude perl; do
  command -v "$_tool" >/dev/null 2>&1 || fail "$_tool is not on PATH for launchd (edit PATH at the top of scripts/mac/build-tick.sh)"
done

# ── 1b. refresh one dirty mac/* PR, before any row ───────────────────────────
# Mainline's own pr-refresh.mjs, never a branch copy, extracted to a fresh file with a .mjs
# name (node treats an extensionless file as CommonJS). It may push ONE fast-forward merge
# of origin/SignalGrid_Alpha onto ONE open mac/* PR head (never a mac/tick-* one), only after
# preflight and breadth exit 0 on that head; that preflight runs the PR's code WITH
# credentials (the registry row's writeScope says so). It needs no model, so a paused tick
# still refreshes. A refresh failure NEVER stops the build.
if [ "$DRY" = "1" ]; then
  say "dry-run: would run mainline's scripts/mac/pr-refresh.mjs --max 1"
elif git cat-file -e origin/SignalGrid_Alpha:scripts/mac/pr-refresh.mjs 2>/dev/null; then
  _rd="$(mktemp -d "$CACHE/pr-refresh.XXXXXX")" || _rd=""
  if [ -n "$_rd" ] && git show origin/SignalGrid_Alpha:scripts/mac/pr-refresh.mjs > "$_rd/pr-refresh.mjs" 2>/dev/null; then
    SG_REPO_ROOT="$REPO_ROOT" node "$_rd/pr-refresh.mjs" --max 1 >> "$CACHE/pr-refresh.log" 2>&1
    _rc=$?
    say "pr-refresh exited $_rc (log $CACHE/pr-refresh.log)"
  else
    say "WARN could not extract mainline's pr-refresh.mjs — skipping the refresh"
  fi
  if [ -n "$_rd" ]; then rm -f "$_rd/pr-refresh.mjs"; rmdir "$_rd" 2>/dev/null || true; fi
else
  say "mainline has no scripts/mac/pr-refresh.mjs yet — skipping the refresh"
fi

# A broken session (logged out, usage limit, no Keychain under launchd) would otherwise
# claim and burn one ranked row per run. The first such run pauses the tick instead (triage
# pauses it BEFORE claiming, so the row is not burned either).
PAUSED="$CACHE/paused"
if [ "$DRY" = "0" ] && [ -f "$PAUSED" ]; then
  echo "build-tick: paused — $(head -c 300 "$PAUSED" | tr '\n' ' '); delete $PAUSED to resume"
  exit 0
fi

# ── 2. the ranked tasks, from mainline ───────────────────────────────────────
# An asleep Mac is common and says nothing; four failures in a row (12 h) is not.
FETCH_FAILS="$CACHE/fetch-failures"
if ! git fetch -q origin --prune 2>/dev/null; then
  _n=$(( $(cat "$FETCH_FAILS" 2>/dev/null || echo 0) + 1 ))
  printf '%s' "$_n" > "$FETCH_FAILS"
  [ "$_n" = "4" ] && raise_hand "git fetch origin has failed on 4 build ticks in a row (auth expired? repo locked?)"
  say "result: skipped: git fetch origin failed ($_n in a row)"
  exit 0
fi
rm -f "$FETCH_FAILS"
if [ -n "$STATE_FILE" ]; then
  STATE_JSON="$(cat "$STATE_FILE" 2>/dev/null)"
else
  STATE_JSON="$(git show origin/SignalGrid_Alpha:docs/agent/objective-state.json 2>/dev/null)"
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
  });' 2>"$_err")" || fail "could not read tasks[] from ${STATE_FILE:-origin/SignalGrid_Alpha:docs/agent/objective-state.json}: $(cat "$_err")"
[ -s "$_err" ] && say "$(tr '\n' ' ' < "$_err")"
rm -f "$_err"
if [ -z "$TASKS" ]; then
  say "result: nothing buildable (the state ranks no task)"
  exit 0
fi

# ── 3. the first row nobody has claimed ──────────────────────────────────────
HEADS="$(git ls-remote --heads "$REMOTE" 2>&1)" \
  || fail "could not list $REMOTE's branches — in-flight work unknown, not building blind"
# gh fills {owner}/{repo} from this checkout's origin; --paginate reads past 100. Title
# (with its head) and body are matched separately: a body names rows in passing, so only
# "plan row N" / "row-N" there counts.
PRS="$(gh api --paginate 'repos/{owner}/{repo}/pulls?state=open&per_page=100' --jq '.[] | "\(.head.ref)\t\(.title | gsub("\\s+"; " "))\t\(.body // "" | gsub("\\s+"; " "))"' 2>&1)" \
  || fail "could not list open PRs (gh api) — in-flight work unknown, not building blind"
PR_HEADS_TITLES="$(cut -f1,2 <<< "$PRS")"
PR_BODIES="$(cut -f3- <<< "$PRS")"
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
# --dry-run shows the file in front of you; a real run uses the build worktree's, which is
# origin/SignalGrid_Alpha's.
TODAY="$(date -u +%Y-%m-%d)"
if [ "$DRY" = "1" ]; then
  _cmds="$(node "$REPO_ROOT/scripts/mac/build-tick-stages.mjs" commands --row "$PICK_ID" --title "$PICK_TITLE" --branch "$BRANCH" --run-dir "$RUN_DIR" --today "$TODAY" 2>&1)" \
    || fail "could not print the stage commands: $_cmds"
  say "dry-run: would triage (read-only), then claim $BRANCH, then run the staged pipeline in $BUILD_WT; the stage commands:"
  printf '%s\n' "$_cmds" | sed 's/^/dry-run: /'
  exit 0
fi

# ── 4. its own worktree, fresh every run ─────────────────────────────────────
LOG_DIR="$HOME/Library/Logs/signalgrid"
mkdir -p "$LOG_DIR" "$RUN_DIR" || fail "cannot create $LOG_DIR / $RUN_DIR"
RUN_LOG="$LOG_DIR/build-tick-$STAMP.log"
say "picked plan row $PICK_ID ('$PICK_TITLE') → $BRANCH; log $RUN_LOG"
git worktree prune >> "$RUN_LOG" 2>&1
if [ ! -e "$BUILD_WT/.git" ]; then
  git worktree add -q --detach "$BUILD_WT" origin/SignalGrid_Alpha >> "$RUN_LOG" 2>&1 \
    || fail "could not create the build worktree at $BUILD_WT"
fi
cd "$BUILD_WT" || fail "cannot enter the build worktree at $BUILD_WT"
# Dedicated to this script and locked above, so a leftover is a dead session's.
_left="$(git status --porcelain | wc -l | tr -d ' ')"
[ "$_left" = "0" ] || say "discarding $_left leftover path(s) from an earlier run"
{ git checkout -q -f --detach origin/SignalGrid_Alpha && git clean -fdq; } >> "$RUN_LOG" 2>&1 \
  || fail "could not reset the build worktree to origin/SignalGrid_Alpha"

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
# Triage is read-only and runs before the claim, so a broken session (logged out, usage limit,
# no Keychain under launchd) pauses the tick WITHOUT burning a row. Everything below the
# helper's stage table (tiers, caps, tool sets, scrubbed environment) is in the helper.
[ -f scripts/mac/build-tick-stages.mjs ] || fail "origin/SignalGrid_Alpha has no scripts/mac/build-tick-stages.mjs — nothing to run the stages with"
stages() {
  _sub="$1"; shift
  node scripts/mac/build-tick-stages.mjs "$_sub" --row "$PICK_ID" --title "$PICK_TITLE" --branch "$BRANCH" \
    --run-dir "$RUN_DIR" --cache "$CACHE" --today "$TODAY" --stamp "$STAMP" "$@"
}
claim() {
  git switch -q -c "$BRANCH" >> "$RUN_LOG" 2>&1 || fail "could not create $BRANCH in the build worktree"
  git push -q origin "HEAD:refs/heads/$BRANCH" >> "$RUN_LOG" 2>&1 || fail "could not push the claim branch $BRANCH"
  say "claimed plan row $PICK_ID with $BRANCH (at mainline's tip)"
}
rm -f "$RUN_DIR/next" "$RUN_DIR/outcome.json"
say "triage starting (read-only; tier and cap are the helper's stage table), no git/GitHub credentials"
stages triage >> "$RUN_LOG" 2>&1 < /dev/null
_next="$(head -1 "$RUN_DIR/next" 2>/dev/null)"
[ -n "$_next" ] || fail "plan row $PICK_ID: triage wrote no $RUN_DIR/next — not claiming a row it could not read"
_verb="${_next%% *}"
_rest="${_next#"$_verb"}"; _rest="${_rest# }"
case "$_verb" in
  pause)
    printf 'triage paused the build tick on %s (plan row %s): %s; log %s\n' "$STAMP" "$PICK_ID" "$_rest" "$RUN_LOG" > "$PAUSED"
    fail "plan row $PICK_ID: $_rest. The build tick is PAUSED and NO claim was pushed, so the row is not burned: fix the cause, then delete $PAUSED" ;;
  hand)
    claim   # claimed first, so the row is not re-triaged every 3 h
    fail "plan row $PICK_ID: triage: $_rest. Claim $BRANCH stays until a person deletes it" ;;
  marker|build) claim ;;
  *) fail "plan row $PICK_ID: triage wrote an unknown verdict: $_next" ;;
esac

# ── 7. the pipeline ──────────────────────────────────────────────────────────
# `marker`: the helper writes one plan-row marker, commits it, opus reviews it. `build`: the
# build stage on the tier its kind names, a review, at most one fix on the build's own tier,
# a second review. Each stage logs its tier, turns, cost and exit into the run log; the
# verdict is $RUN_DIR/outcome.json (land | hand | pause).
say "pipeline starting: path $_verb${_rest:+ ($_rest)}"
stages run --path "$_verb" --kind "${_rest:-none}" >> "$RUN_LOG" 2>&1 < /dev/null
[ -s "$RUN_DIR/outcome.json" ] || fail "plan row $PICK_ID: the pipeline wrote no $RUN_DIR/outcome.json. Claim $BRANCH stays until a person deletes it"
_oc="$(node -e 'const o = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  process.stdout.write(`${o.outcome}\t${String(o.reason ?? "").replace(/\s+/g, " ")}`);' "$RUN_DIR/outcome.json" 2>&1)" \
  || fail "plan row $PICK_ID: could not read $RUN_DIR/outcome.json: $_oc"
IFS="$(printf '\t')" read -r OUTCOME REASON <<< "$_oc"
say "pipeline outcome: $OUTCOME — $REASON"

# ── 8. the outward half: gate, push, PR ──────────────────────────────────────
case "$OUTCOME" in
  land) ;;
  pause)
    # The session itself is broken: pause, so the next runs do not claim and burn the rows below.
    printf 'the staged pipeline paused the build tick on %s (plan row %s): %s; log %s\n' "$STAMP" "$PICK_ID" "$REASON" "$RUN_LOG" > "$PAUSED"
    fail "plan row $PICK_ID: $REASON. The build tick is PAUSED: fix the cause, delete $PAUSED, and delete the claim $BRANCH" ;;
  hand) fail "plan row $PICK_ID: $REASON. Claim $BRANCH stays until a person deletes it" ;;
  *) fail "plan row $PICK_ID: the pipeline's outcome was '$OUTCOME', not land, hand or pause" ;;
esac
HEAD_SHA="$(git rev-parse HEAD)"
# The brief forbids these paths; the script enforces it, and derives the landing class
# from the diff rather than trusting the session's own "Owner decision needed:" line.
CHANGED="$(git diff --name-only origin/SignalGrid_Alpha...HEAD)"
FORBIDDEN="$(grep -E '^(CLAUDE\.md|AGENTS\.md|docs/DECISION_RECORDS\.md|docs/agent/(objective\.json|LOOP\.md|launch-claims-)|docs/(LAUNCH_PROFILE|PUBLICATION_BOUNDARY)\.md|\.claude/|\.githooks/|scripts/(launch-profile|check-launch-profile|check-launch-claims|publication-boundary|check-publication-boundary)|native/ios/EnterpriseShell/Services/(DecisionEngine|AppWorkflows)\.swift)' <<< "$CHANGED")"
CLASS="$(node --input-type=module -e 'import { classifyDiff } from "./scripts/check-owner-gated-surfaces.mjs";
  const files = process.argv[1].split("\n").filter(Boolean);
  const cats = new Set(classifyDiff(files).matched.map((m) => m.category));
  process.stdout.write(cats.has("OWNER_RESERVED") ? "OWNER_RESERVED" : cats.has("DECISION_PATH") ? "DECISION_PATH" : "SAFETY_MACHINERY");' "$CHANGED" 2>>"$RUN_LOG")"
[ -n "$CLASS" ] || fail "plan row $PICK_ID: could not classify the change with check-owner-gated-surfaces.mjs — not pushing an unclassified change"
if [ -n "$FORBIDDEN" ] || [ "$CLASS" = "OWNER_RESERVED" ]; then
  fail "plan row $PICK_ID: the change touches paths the build tick may not land ($CLASS; $(tr '\n' ' ' <<< "$FORBIDDEN")). Nothing pushed past the claim; the commit $HEAD_SHA stays on the local branch $BRANCH"
fi
say "committed $HEAD_SHA ($CLASS); preflight then breadth"
perl -e 'alarm shift; exec @ARGV or die "exec: $!"' "$PREFLIGHT_SECONDS" node scripts/preflight.mjs > "$RUN_DIR/preflight.log" 2>&1
PF=$?
BR=1
if [ "$PF" = "0" ]; then
  perl -e 'alarm shift; exec @ARGV or die "exec: $!"' "$BREADTH_SECONDS" pnpm run verify:breadth > "$RUN_DIR/breadth.log" 2>&1
  BR=$?
fi
PF_LINE="$(grep -E 'Preflight (PASSED|FAILED)' "$RUN_DIR/preflight.log" | tail -1)"
BR_LINE="$(grep -E 'Breadth lane (PASSED|FAILED)' "$RUN_DIR/breadth.log" 2>/dev/null | tail -1)"
if [ "$PF" != "0" ] || [ "$BR" != "0" ]; then
  fail "plan row $PICK_ID: gates red on $HEAD_SHA (preflight exit $PF: ${PF_LINE:-no verdict line}; breadth exit $BR: ${BR_LINE:-not run}). Nothing pushed past the claim; the commit stays on the local branch $BRANCH (the next run resets only the worktree). Logs: $RUN_DIR"
fi
git push -q origin "HEAD:refs/heads/$BRANCH" >> "$RUN_LOG" 2>&1 || fail "plan row $PICK_ID: gates green but the push of $BRANCH failed"
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
OWNER="$(git remote get-url origin | sed -E 's#^.*github\.com[:/]([^/]+)/.*$#\1#')"
[ -n "$OWNER" ] && [ "$OWNER" != "$(git remote get-url origin)" ] || fail "plan row $PICK_ID: pushed $BRANCH but could not read the repo owner from origin to verify its PR"
_open="$(gh api "repos/{owner}/{repo}/pulls?head=$OWNER:$BRANCH&state=open" --jq length 2>/dev/null)"
[ "${_open:-0}" -ge 1 ] 2>/dev/null || fail "plan row $PICK_ID: pushed $BRANCH but no open PR for it could be found afterwards"
say "result: acted: plan row $PICK_ID — $BRANCH at $HEAD_SHA, preflight + breadth green, PR open"
exit 0
