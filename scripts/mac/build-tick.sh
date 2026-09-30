#!/usr/bin/env bash
# =============================================================================
# SignalGrid — the Mac lane's BUILD tick. Runs WITHOUT a person, from launchd every
# 3 hours (scripts/mac/install-build-tick.sh, label com.signalgrid.build-tick): one
# headless Claude session builds the objective loop's top buildable task and opens
# a PR. The lane tick (lane-tick.sh) is unchanged and separate — it runs sim
# requests and heartbeats; this one builds.
#
#   bash scripts/mac/build-tick.sh                   # one run, prints a one-line result
#   bash scripts/mac/build-tick.sh --dry-run         # the task it would pick + the exact
#                                                    # claude command; runs nothing
#   bash scripts/mac/build-tick.sh --dry-run --state <file> [--remote <name|path>]
#                                                    # the same, against a scratch state
#                                                    # file / a scratch remote's heads
#
# WHY (owner, 2026-09-29, DR-061: "Yes, build it — The brain builds its top task
# unattended and opens PRs"). The objective loop ranks tasks[] in
# docs/agent/objective-state.json every 5 minutes, and until this script nothing
# STARTED one of them without a person opening a session.
#
# WHAT ONE RUN DOES, in order:
#   1. one run at a time (mkdir lock; a dead holder's lock is stale and cleared);
#   2. fetch, then read tasks[] from origin/SignalGrid_Alpha's objective-state.json;
#   3. walk tasks[] in rank order and take the first row with NO in-flight work — no
#      remote branch mac/build-row-<id>-*, and no open PR whose title or head names
#      "plan row <id>" (REST, never GraphQL). Work that cannot be LISTED is not known
#      to be absent: an unreadable branch or PR list stops the run, never builds blind;
#   4. its OWN worktree (<repo>.build, a sibling of <repo>.tick), reset to a fresh
#      origin/SignalGrid_Alpha every run — never the person's checkout, never the tick's;
#   5. deps only when the lockfile moved (lane-tick.sh's stamp), and tsx's darwin
#      esbuild binary from a cache OUTSIDE the repo (package.json and the lockfile are
#      never touched), exported as ESBUILD_BINARY_PATH;
#   6. `claude -p` on scripts/mac/build-tick-brief.md with the row substituted, an
#      explicit tool allowlist and --permission-mode acceptEdits (NEVER
#      bypassPermissions / --dangerously-skip-permissions), under a wall-clock cap;
#   7. log to ~/Library/Logs/signalgrid/build-tick-<stamp>.log, print one result line,
#      and raise a hand (DR-054, delivered through lane-deliver) on any failure after
#      the pick — including a non-zero session exit.
#
# Stock macOS bash 3.2: guarded array expansion only, no mapfile, no ${var,,}.
# =============================================================================
set -u

if [ "$(uname -s)" != "Darwin" ]; then
  echo "build-tick.sh: the build tick is the Mac lane's (launchd + a local claude CLI); on this host the cloud lane builds." >&2
  exit 2
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT" || { echo "cannot enter $REPO_ROOT" >&2; exit 1; }

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

# launchd starts with a minimal PATH (install-launchd.sh); claude lives in ~/.local/bin.
# Appended, never prepended, so a person's PATH still wins when run by hand.
PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.nvm/current/bin:$HOME/Library/pnpm"
export PATH

MAX_TURNS=200
WALL_SECONDS=10800   # the launchd interval: a session never outlives its own slot
BUILD_WT="$(cd "$REPO_ROOT/.." && pwd)/$(basename "$REPO_ROOT").build"
BRIEF_FILE="$REPO_ROOT/scripts/mac/build-tick-brief.md"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_LOG=""
say() {
  printf 'build-tick %s  %s\n' "$STAMP" "$1"
  [ -n "$RUN_LOG" ] && printf 'build-tick %s  %s\n' "$STAMP" "$1" >> "$RUN_LOG"
  return 0
}

PICK_ID=""
# A hand through lane-deliver (straight to mainline on the Mac), never only a file in the
# build worktree — that worktree is reset next run. raise-hand.mjs keys a hand on the day
# and its `blocked` text, so a failure that repeats every 3 hours raises ONE hand a day.
raise_hand() {
  if [ "$DRY" = "1" ]; then say "dry-run: would raise a hand: $1"; return 0; fi
  _ops="$(mktemp "${TMPDIR:-/tmp}/build-tick-hand.XXXXXX")" || { say "WARN could not raise a hand (mktemp)"; return 0; }
  if node -e 'const [f, blocked, where] = process.argv.slice(1);
      require("fs").writeFileSync(f, JSON.stringify([{ op: "raise", who: "mac lane", domain: "lane", where,
        doing: "the unattended build tick (scripts/mac/build-tick.sh)", blocked,
        need: "a person on the Mac to read the log named in where, fix the cause, or re-rank the row" }]));' \
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
# launchd never overlaps its own label; a PERSON running this by hand mid-session
# would. mkdir is atomic and needs no flock (bash 3.2). Same shape as lane-tick.sh.
LOCK="${TMPDIR:-/tmp}/signalgrid-build-tick.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  _holder="$(cat "$LOCK/pid" 2>/dev/null || true)"
  if [ -n "$_holder" ] && kill -0 "$_holder" 2>/dev/null; then
    say "result: skipped: another build tick (pid $_holder) holds $LOCK"
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
if ! git fetch -q origin --prune 2>/dev/null; then
  say "result: skipped: origin unreachable (offline?)"
  exit 0
fi
if [ -n "$STATE_FILE" ]; then
  STATE_JSON="$(cat "$STATE_FILE" 2>/dev/null)"
else
  STATE_JSON="$(git show origin/SignalGrid_Alpha:docs/agent/objective-state.json 2>/dev/null)"
fi
# rowId goes into a branch name, a regex and the brief, so anything but [A-Za-z0-9]
# is refused rather than escaped.
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
  });' 2>&1)" || fail "could not read tasks[] from ${STATE_FILE:-origin/SignalGrid_Alpha:docs/agent/objective-state.json}: $TASKS"
if [ -z "$TASKS" ]; then
  say "result: nothing buildable (the state ranks no task)"
  exit 0
fi

# ── 3. the first row with no in-flight work ──────────────────────────────────
HEADS="$(git ls-remote --heads "$REMOTE" 'refs/heads/mac/build-row-*' 2>&1)" \
  || fail "could not list $REMOTE's mac/build-row-* branches — in-flight work unknown, not building blind"
# gh fills {owner}/{repo} from this checkout's origin; --paginate reads past 100. The body
# rides along flattened to one line: a PR whose title was cut before its "(plan row N)"
# still names the row in its body (#1219 did, 2026-09-29).
PRS="$(gh api --paginate 'repos/{owner}/{repo}/pulls?state=open&per_page=100' --jq '.[] | "\(.head.ref)\t\(.title)\t\(.body // "" | gsub("\\s+"; " "))"' 2>&1)" \
  || fail "could not list open PRs (gh api) — in-flight work unknown, not building blind"
in_flight() {
  # Here-strings, not printf | grep -q: grep -q exits at the first match and printf then
  # dies on SIGPIPE, printing "write error: Broken pipe" into every log.
  if grep -q "refs/heads/mac/build-row-$1-" <<< "$HEADS"; then
    echo "a remote mac/build-row-$1-* branch exists"; return 0
  fi
  # "plan row 24" in a title or body, "plan-row-24" in a head, "row-24 bullet" in a body;
  # never row 241. A false match only skips a row — the safe direction.
  if grep -qiE "(plan[ -]row[ -]|row-)$1([^0-9A-Za-z]|\$)" <<< "$PRS"; then
    echo "an open PR names plan row $1"; return 0
  fi
  return 1
}
PICK_TITLE=""
N_TASKS=0
while IFS="$(printf '\t')" read -r _id _title; do
  [ -n "$_id" ] || continue
  N_TASKS=$((N_TASKS + 1))
  if _why="$(in_flight "$_id")"; then say "row $_id in flight ($_why) — next"; continue; fi
  PICK_ID="$_id"; PICK_TITLE="$_title"; break
done <<TASKS_EOF
$TASKS
TASKS_EOF
if [ -z "$PICK_ID" ]; then
  say "result: nothing buildable ($N_TASKS ranked task(s), every one in flight)"
  exit 0
fi
BRANCH="mac/build-row-$PICK_ID-$STAMP"
say "picked plan row $PICK_ID ('$PICK_TITLE') → $BRANCH"

# ── the brief and the exact command ──────────────────────────────────────────
# Rendered in node, not ${var//…}: bash 5.2 treats `&` in a replacement specially, and
# a title is free text.
BRIEF="$(node -e 'const [f, id, title, branch] = process.argv.slice(1);
  process.stdout.write(require("fs").readFileSync(f, "utf8")
    .split("{{ROW_ID}}").join(id).split("{{ROW_TITLE}}").join(title).split("{{BRANCH}}").join(branch));' \
  "$BRIEF_FILE" "$PICK_ID" "$PICK_TITLE" "$BRANCH" 2>&1)" || fail "could not render $BRIEF_FILE: $BRIEF"
case "$BRIEF" in *"{{"*) fail "$BRIEF_FILE still holds an unfilled {{placeholder}} after rendering" ;; esac
# The allowlist is the session's whole reach; anything else is denied, never prompted
# (-p has nobody to ask). acceptEdits covers edits inside the worktree only.
CLAUDE_CMD=(claude -p "$BRIEF" --model opus --max-turns "$MAX_TURNS" --permission-mode acceptEdits
  --allowedTools Read Edit Write Grep Glob "Bash(git *)" "Bash(pnpm *)" "Bash(node *)" "Bash(gh *)" "Bash(xcodebuild *)" "Bash(swift *)")
if [ "$DRY" = "1" ]; then
  say "dry-run: would run in $BUILD_WT, under a ${WALL_SECONDS}s cap:"
  printf '%q ' perl -e 'alarm shift; exec @ARGV or die "exec: $!"' "$WALL_SECONDS" ${CLAUDE_CMD+"${CLAUDE_CMD[@]}"}
  printf '\n'
  exit 0
fi

# ── 4. its own worktree, fresh every run ─────────────────────────────────────
LOG_DIR="$HOME/Library/Logs/signalgrid"
mkdir -p "$LOG_DIR" || fail "cannot create $LOG_DIR"
RUN_LOG="$LOG_DIR/build-tick-$STAMP.log"
say "picked plan row $PICK_ID ('$PICK_TITLE') → $BRANCH; log $RUN_LOG"
if [ ! -e "$BUILD_WT/.git" ]; then
  git worktree add -q --detach "$BUILD_WT" origin/SignalGrid_Alpha >> "$RUN_LOG" 2>&1 \
    || fail "could not create the build worktree at $BUILD_WT"
fi
cd "$BUILD_WT" || fail "cannot enter the build worktree at $BUILD_WT"
# Dedicated to this script and locked above, so a leftover is a dead session's, and the
# run resets over it (named in the log, never silently).
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

# ── 6. the session ───────────────────────────────────────────────────────────
git switch -q -c "$BRANCH" >> "$RUN_LOG" 2>&1 || fail "could not create $BRANCH in the build worktree"
say "session starting (opus, ${MAX_TURNS} turns, ${WALL_SECONDS}s cap)"
# No `timeout` on macOS. alarm survives exec, so SIGALRM ends claude at the cap; `or die`
# keeps a failed exec from exiting 0. ponytail: a tool the session left running (a
# preflight child) is orphaned, not killed — add a process group if that bites.
perl -e 'alarm shift; exec @ARGV or die "exec: $!"' "$WALL_SECONDS" ${CLAUDE_CMD+"${CLAUDE_CMD[@]}"} >> "$RUN_LOG" 2>&1 < /dev/null
SESSION_STATUS=$?

# ── 7. one result line ───────────────────────────────────────────────────────
if [ "$SESSION_STATUS" != "0" ]; then
  fail "the headless build session for plan row $PICK_ID exited $SESSION_STATUS (142 = the ${WALL_SECONDS}s cap)"
fi
if git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
  say "result: acted: plan row $PICK_ID pushed on $BRANCH (the PR is in the log)"
else
  say "result: session exited 0 without pushing $BRANCH — it stopped on purpose (already done or blocked; its hand says which); log $RUN_LOG"
fi
exit 0
