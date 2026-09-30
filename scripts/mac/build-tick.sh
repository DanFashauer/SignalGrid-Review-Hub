#!/usr/bin/env bash
# =============================================================================
# SignalGrid — the Mac lane's BUILD tick (DR-061 rule 4). Runs WITHOUT a person, from
# launchd every 3 hours (scripts/mac/install-build-tick.sh, label
# com.signalgrid.build-tick). The lane tick (lane-tick.sh) is separate and never builds.
#
#   bash scripts/mac/build-tick.sh                   # one run, prints a one-line result
#   bash scripts/mac/build-tick.sh --dry-run         # the task it would pick + the exact
#                                                    # session command; runs nothing
#   bash scripts/mac/build-tick.sh --dry-run --state <file> [--remote <name|path>]
#                                                    # the same, against a scratch state
#                                                    # file / a scratch remote's heads
#
# WHY (owner, 2026-09-29: "Yes, build it — The brain builds its top task unattended and
# opens PRs", then "Build it, I confirm"). Until this, nothing STARTED a ranked task in
# docs/agent/objective-state.json without a person opening a session.
#
# WHO DOES WHAT. The headless session only EDITS its worktree and runs local checks. It
# starts with no git or GitHub credentials (no ssh agent, GIT_SSH_COMMAND=false, no git
# global config so no credential helper, an empty gh config, no tokens) and with push,
# commit, merge, gh and lane-mail commands deny-listed. THIS SCRIPT does every outward
# act: it claims the row, commits the session's change, runs preflight + breadth, and
# only on 0/0 pushes that one branch and opens its PR. Nothing here merges. That is
# enforced by the environment and the deny list, not an OS boundary — a session that
# deliberately wrote its own push script could still escape (DR-061 rule 4 says so).
#
# ONE RUN, in order:
#   0. re-exec mainline's copy of this script (a real run never runs a branch copy);
#   1. one run at a time (a lock under ~/Library/Caches, never $TMPDIR, whose value
#      differs between launchd, a sandboxed shell and a plain one);
#   2. fetch (four failures in a row raise a hand), read tasks[] from mainline's state;
#   3. take the first row nobody has claimed: no remote head and no open PR names it
#      ("row 12", "row-12", "rows 12", "#12" in a head or title; "plan row 12" or
#      "row-12" in a body). A false match only skips a row — the safe direction;
#   4. its OWN worktree <repo>.build, reset to origin/SignalGrid_Alpha every run;
#   5. deps when the lockfile moved; tsx's darwin esbuild from a cache outside the repo;
#   6. CLAIM: push the empty branch mac/build-row-<id>-<stamp> before the session, so the
#      next run and the cloud lane skip the row even if the session finds nothing to do;
#   7. the session, under a wall-clock cap, writing its commit message, PR title and
#      body — or a hand — into a run directory OUTSIDE the worktree (--add-dir);
#   8. commit, preflight + breadth, push + PR only on 0/0; anything else raises a hand
#      and leaves the claim in place for a person.
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
  if ! git -C "$_root" show origin/SignalGrid_Alpha:scripts/mac/build-tick.sh > "$CACHE/build-tick.mainline.sh" 2>/dev/null; then
    echo "build-tick: origin/SignalGrid_Alpha has no scripts/mac/build-tick.sh — nothing to run"
    exit 0
  fi
  SG_BUILD_TICK_MAINLINE=1 SG_REPO_ROOT="$_root" exec /bin/bash "$CACHE/build-tick.mainline.sh"
fi
REPO_ROOT="${SG_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$REPO_ROOT" || { echo "cannot enter $REPO_ROOT" >&2; exit 1; }

MAX_TURNS=200
SESSION_SECONDS=7200     # the session; preflight + breadth follow inside the 3 h slot's spirit
PREFLIGHT_SECONDS=5400
BREADTH_SECONDS=3600
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
    say "result: skipped: another build tick (pid ${_holder:-starting}) holds $LOCK"
    exit 0
  fi
  say "stale build lock (holder ${_holder:-unknown} is gone) — clearing it"
  rm -f "$LOCK/pid"; rmdir "$LOCK" 2>/dev/null || true
  mkdir "$LOCK" 2>/dev/null || { say "result: skipped: could not take $LOCK"; exit 0; }
fi
printf '%s' "$$" > "$LOCK/pid"
trap 'rm -f "$LOCK/pid"; rmdir "$LOCK" 2>/dev/null' EXIT

for _tool in git gh node pnpm npm claude perl; do
  command -v "$_tool" >/dev/null 2>&1 || fail "$_tool is not on PATH for launchd (edit PATH at the top of scripts/mac/build-tick.sh)"
done

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
# rowId goes into a branch name, a regex and the brief, so anything but [A-Za-z0-9] is
# refused rather than escaped. stderr goes to a file: a warning is never a task line.
_err="$(mktemp "$CACHE/tasks-err.XXXXXX")"
TASKS="$(printf '%s' "$STATE_JSON" | node -e '
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    try {
      const tasks = JSON.parse(s).tasks;
      if (!Array.isArray(tasks)) throw new Error("tasks[] is not an array");
      const out = [];
      for (const t of [...tasks].sort((a, b) => a.rank - b.rank)) {
        if (!/^[A-Za-z0-9]+$/.test(String(t.rowId))) throw new Error(`rowId ${JSON.stringify(t.rowId)} is not [A-Za-z0-9]+`);
        out.push(`${t.rowId}\t${String(t.title ?? "").replace(/\s+/g, " ")}\n`);
      }
      process.stdout.write(out.join(""));
    } catch (e) { console.error(e.message); process.exit(1); }
  });' 2>"$_err")" || fail "could not read tasks[] from ${STATE_FILE:-origin/SignalGrid_Alpha:docs/agent/objective-state.json}: $(cat "$_err")"
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

# ── the brief and the exact command ──────────────────────────────────────────
if [ "$DRY" = "1" ]; then
  BRIEF_SRC="$(cat "$REPO_ROOT/scripts/mac/build-tick-brief.md" 2>/dev/null)"
else
  BRIEF_SRC="$(git show origin/SignalGrid_Alpha:scripts/mac/build-tick-brief.md 2>/dev/null)"
fi
[ -n "$BRIEF_SRC" ] || fail "could not read scripts/mac/build-tick-brief.md"
# Rendered in node, not ${var//…}: a title is free text and `&` is special in bash 5.2.
BRIEF="$(printf '%s' "$BRIEF_SRC" | node -e 'const [id, title, branch, run] = process.argv.slice(1);
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => process.stdout.write(
    s.split("{{ROW_ID}}").join(id).split("{{ROW_TITLE}}").join(title).split("{{BRANCH}}").join(branch).split("{{RUN_DIR}}").join(run)));' \
  "$PICK_ID" "$PICK_TITLE" "$BRANCH" "$RUN_DIR" 2>&1)" || fail "could not render the brief: $BRIEF"
case "$BRIEF" in *"{{"*) fail "the brief still holds an unfilled {{placeholder}} after rendering" ;; esac
EMPTY_GH="$CACHE/empty-gh-config"
# The session's reach. Allow rules are not the boundary under the user's sandbox
# auto-allow; deny rules still bind, and the scrubbed environment below is what makes a
# push or a gh call fail even if a command slips through.
SESSION_ENV=(env -u SSH_AUTH_SOCK -u GH_TOKEN -u GITHUB_TOKEN -u GH_ENTERPRISE_TOKEN
  GIT_SSH_COMMAND=false GIT_TERMINAL_PROMPT=0 GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GH_CONFIG_DIR="$EMPTY_GH")
CLAUDE_CMD=(claude -p "$BRIEF" --model opus --max-turns "$MAX_TURNS"
  --permission-mode acceptEdits --permission-prompts none --strict-mcp-config --add-dir "$RUN_DIR"
  --allowedTools Read Edit Write Grep Glob "Bash(git status*)" "Bash(git diff*)" "Bash(git log*)" "Bash(git show*)"
    "Bash(pnpm *)" "Bash(node *)" "Bash(xcodebuild *)" "Bash(swift *)"
  --disallowedTools "Bash(git push*)" "Bash(git commit*)" "Bash(git -C *)" "Bash(git remote*)" "Bash(git config*)"
    "Bash(gh *)" "Bash(ssh*)" "Bash(curl*)" "Bash(wget*)" "Bash(node scripts/lane-deliver*)" "Bash(node scripts/mac/gh-pr*)"
    "Bash(pnpm run lane:*)" "Bash(pnpm run hand:*)")
if [ "$DRY" = "1" ]; then
  say "dry-run: would claim $BRANCH, then run in $BUILD_WT under a ${SESSION_SECONDS}s cap:"
  printf '%q ' ${SESSION_ENV+"${SESSION_ENV[@]}"} perl -e 'alarm shift; exec @ARGV or die "exec: $!"' "$SESSION_SECONDS" ${CLAUDE_CMD+"${CLAUDE_CMD[@]}"}
  printf '\n'
  exit 0
fi

# ── 4. its own worktree, fresh every run ─────────────────────────────────────
LOG_DIR="$HOME/Library/Logs/signalgrid"
mkdir -p "$LOG_DIR" "$RUN_DIR" "$EMPTY_GH" || fail "cannot create $LOG_DIR / $RUN_DIR"
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

# ── 6. claim the row before any work ─────────────────────────────────────────
git switch -q -c "$BRANCH" >> "$RUN_LOG" 2>&1 || fail "could not create $BRANCH in the build worktree"
git push -q origin "HEAD:refs/heads/$BRANCH" >> "$RUN_LOG" 2>&1 || fail "could not push the claim branch $BRANCH"
say "claimed plan row $PICK_ID with $BRANCH (at mainline's tip)"

# ── 7. the session ───────────────────────────────────────────────────────────
say "session starting (opus, ${MAX_TURNS} turns, ${SESSION_SECONDS}s cap, no git/GitHub credentials)"
# No `timeout` on macOS. alarm survives exec, so SIGALRM ends claude at the cap (142).
# ponytail: a tool the session left running is orphaned, not killed — add a process
# group if that bites.
${SESSION_ENV+"${SESSION_ENV[@]}"} perl -e 'alarm shift; exec @ARGV or die "exec: $!"' "$SESSION_SECONDS" \
  ${CLAUDE_CMD+"${CLAUDE_CMD[@]}"} >> "$RUN_LOG" 2>&1 < /dev/null
SESSION_STATUS=$?
say "session exited $SESSION_STATUS (142 = the ${SESSION_SECONDS}s cap)"

# ── 8. the outward half: commit, gate, push, PR ──────────────────────────────
if [ -s "$RUN_DIR/hand.txt" ]; then
  fail "plan row $PICK_ID: the session stopped and asked for a hand: $(head -c 600 "$RUN_DIR/hand.txt" | tr '\n' ' '). Claim $BRANCH stays until a person deletes it"
fi
if [ -z "$(git status --porcelain)" ]; then
  fail "plan row $PICK_ID: the session (exit $SESSION_STATUS) changed nothing and left no hand.txt. Claim $BRANCH stays until a person deletes it"
fi
for _f in commit-msg.txt pr-title.txt pr-body.md; do
  [ -s "$RUN_DIR/$_f" ] || fail "plan row $PICK_ID: the session (exit $SESSION_STATUS) left changes but no $RUN_DIR/$_f. The work is uncommitted in $BUILD_WT until the next run resets it"
done
printf '\nCo-Authored-By: Claude <noreply@anthropic.com>\nBuild-Tick: %s\n' "$STAMP" >> "$RUN_DIR/commit-msg.txt"
{ git add -A && git commit -q -F "$RUN_DIR/commit-msg.txt"; } >> "$RUN_LOG" 2>&1 \
  || fail "plan row $PICK_ID: could not commit the session's change on $BRANCH"
HEAD_SHA="$(git rev-parse HEAD)"
say "committed $HEAD_SHA; preflight then breadth"
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
  fail "plan row $PICK_ID: gates red on $HEAD_SHA (preflight exit $PF: ${PF_LINE:-no verdict line}; breadth exit $BR: ${BR_LINE:-not run}). Nothing pushed past the claim; the commit is the local branch $BRANCH in $BUILD_WT until the next run resets it. Logs: $RUN_DIR"
fi
git push -q origin "HEAD:refs/heads/$BRANCH" >> "$RUN_LOG" 2>&1 || fail "plan row $PICK_ID: gates green but the push of $BRANCH failed"
{ cat "$RUN_DIR/pr-body.md"
  printf '\n\n## Gates (run by scripts/mac/build-tick.sh on %s, after the session)\n\n- `node scripts/preflight.mjs` exit %s: %s\n- `pnpm run verify:breadth` exit %s: %s\n\nOpened by the unattended build tick (DR-061 rule 4). It never merges; a lane merges it, if at all, under DR-037 / DR-061 rule 1.\n' \
    "$HEAD_SHA" "$PF" "$PF_LINE" "$BR" "$BR_LINE"
} > "$RUN_DIR/pr-body-final.md"
node scripts/mac/gh-pr.mjs open --head "$BRANCH" --title "$(head -1 "$RUN_DIR/pr-title.txt")" --body-file "$RUN_DIR/pr-body-final.md" >> "$RUN_LOG" 2>&1 \
  || fail "plan row $PICK_ID: pushed $BRANCH but gh-pr.mjs could not open its PR"
_open="$(gh api "repos/{owner}/{repo}/pulls?head=$(gh api 'repos/{owner}/{repo}' --jq .owner.login 2>/dev/null):$BRANCH&state=open" --jq length 2>/dev/null)"
[ "${_open:-0}" -ge 1 ] 2>/dev/null || fail "plan row $PICK_ID: pushed $BRANCH but no open PR for it could be found afterwards"
say "result: acted: plan row $PICK_ID — $BRANCH at $HEAD_SHA, preflight + breadth green, PR open"
exit 0
