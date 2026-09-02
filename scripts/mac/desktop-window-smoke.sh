#!/usr/bin/env bash
# =============================================================================
# desktop-window-smoke.sh — build the Tauri desktop shell, open its window, and
# assert the process is still alive ten seconds later.
#
#   ./scripts/mac/desktop-window-smoke.sh               # build, launch, hold 10 s,
#                                                       # screenshot at 5 s, kill
#   ./scripts/mac/desktop-window-smoke.sh --self-check  # prove the assertion can
#                                                       # fail; touches nothing in
#                                                       # the tree
#
# WHY THIS EXISTS. `.github/workflows/desktop.yml` proves the executable LINKS on
# Linux and Windows. It never opens the window. The UI reaches the Rust core only
# through `window.__TAURI__.core.invoke("decision")`, and that global exists only
# when tauri.conf.json sets `app.withGlobalTauri` — which it did not, so every
# launch rendered "Could not read the decision from the core" over empty panels
# while CI stayed green. A cargo test now holds the config key; this script is the
# first thing anywhere that holds the RENDER, and it is honest about how little a
# script can hold:
#
#   ASSERTED: the release build succeeds, the process launches, it is still alive
#             after ten seconds (a webview that fails to initialise exits or crashes
#             well inside that), AND a screenshot PNG was produced. The screenshot is
#             MANDATORY, not opt-in: the defect this smoke was written for — the
#             withGlobalTauri banner — leaves the process alive (the JS catch
#             handles it), so "the process lived" on its own passes on the very
#             defect. A run that produces no PNG exits non-zero and cannot be
#             recorded as passed.
#   VISUAL:   whether the window shows the fixture step_up or the red error banner.
#             The script cannot read a webview's DOM. It captures the screen to a
#             PNG under mktemp and prints the path; a PERSON reads it. A pass here
#             without the screenshot being looked at is "the process lived and a
#             picture exists", nothing more.
#
# macOS only: `screencapture` is macOS, and this is the Mac lane's operation.
# bash 3.2 (stock macOS): no associative arrays, no `${var,,}`, and every array
# expansion guarded as ${A+"${A[@]}"} — an empty array is "unbound" under set -u.
# =============================================================================
set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_DIR="$REPO_ROOT/native/desktop/app"
BIN="$APP_DIR/target/release/signalgrid-assist-desktop"
HOLD_SECONDS="${SIGNALGRID_DESKTOP_HOLD_SECONDS:-10}"

say()  { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
note() { printf '   %s\n' "$*"; }
fail() { printf '   FAIL: %s\n' "$*" >&2; }

# ── the one assertion, factored so --self-check can drive it ─────────────────
# launch_and_hold <seconds> <cmd...>
#   0 — the process was still alive after <seconds> (then killed)
#   1 — it exited before then
# If HOLD_HOOK names a function, it is called once, at HOLD_HOOK_AT seconds into
# the hold, while the process is still up — that is when the screenshot is taken.
HOLD_HOOK=""
HOLD_HOOK_AT=5
launch_and_hold() {
  local seconds="$1"; shift
  "$@" &
  local pid=$!
  local elapsed=0
  while [ "$elapsed" -lt "$seconds" ]; do
    sleep 1
    elapsed=$((elapsed + 1))
    if [ -n "$HOLD_HOOK" ] && [ "$elapsed" -eq "$HOLD_HOOK_AT" ]; then
      "$HOLD_HOOK"
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      wait "$pid" 2>/dev/null
      note "process $pid exited after ${elapsed}s (status $?)"
      return 1
    fi
  done
  kill "$pid" 2>/dev/null
  wait "$pid" 2>/dev/null
  note "process $pid was alive at ${seconds}s; stopped"
  return 0
}

# ── --self-check: the assertion can pass AND can fail; the tree is untouched ──
if [ "${1:-}" = "--self-check" ]; then
  say "desktop-window-smoke --self-check"
  WORK="$(mktemp -d "${TMPDIR:-/tmp}/desktop-window-smoke.XXXXXX")"
  trap 'rm -rf "$WORK"' EXIT
  BEFORE="$(cd "$REPO_ROOT" && git status --porcelain 2>/dev/null)"
  FAILED=0

  # 1. a process that outlives the hold is reported alive
  if launch_and_hold 2 sleep 30 >"$WORK/alive.log" 2>&1; then
    note "ok   — a long-lived process is reported alive"
  else
    fail "a long-lived process was reported dead"; FAILED=1
  fi

  # 2. a process that dies inside the hold is reported dead — the negative control.
  #    Without this a launch_and_hold that always returned 0 would pass the smoke.
  if launch_and_hold 3 sh -c 'exit 3' >"$WORK/dead.log" 2>&1; then
    fail "a process that exited immediately was reported alive"; FAILED=1
  else
    note "ok   — a process that exits early is reported dead"
  fi

  # 3. the config key the whole smoke exists for is present in the file that ships
  if grep -Eq '"withGlobalTauri"[[:space:]]*:[[:space:]]*true' "$APP_DIR/tauri.conf.json"; then
    note "ok   — tauri.conf.json sets app.withGlobalTauri: true"
  else
    fail "tauri.conf.json does not set app.withGlobalTauri: true — the window would render the error banner"; FAILED=1
  fi

  # 4. the UI fails closed when the core cannot be read: the catch block must write
  #    the DENY verdict text and the deny badge, not only the note. Grepped for the
  #    sentence, not the element id — an inverted verdict ("may proceed") written to
  #    the same element must fail here. This is what the screenshot would show on
  #    the withGlobalTauri defect, so it is held here too.
  CATCH="$(sed -n '/render().catch/,/^      });/p' "$APP_DIR/ui/index.html")"
  if printf '%s' "$CATCH" | grep -q 'must NOT proceed' \
     && printf '%s' "$CATCH" | grep -q 'badge deny' \
     && ! printf '%s' "$CATCH" | grep -q 'may proceed'; then
    note "ok   — index.html's render().catch writes 'must NOT proceed' and the deny badge"
  else
    fail "index.html's render().catch does not write 'must NOT proceed' + deny badge — a core read failure would render as 'no decision yet' or worse"; FAILED=1
  fi

  # 5. the script wrote nothing into the tree
  AFTER="$(cd "$REPO_ROOT" && git status --porcelain 2>/dev/null)"
  if [ "$BEFORE" = "$AFTER" ]; then
    note "ok   — working tree byte-identical (git status unchanged; scratch under $WORK only)"
  else
    fail "working tree changed during --self-check"; FAILED=1
  fi

  if [ "$FAILED" = "0" ]; then
    echo "self-check: pass"
    exit 0
  fi
  echo "self-check: FAILED" >&2
  exit 1
fi

# ── the real run ─────────────────────────────────────────────────────────────
if [ "$(uname -s)" != "Darwin" ]; then
  fail "this smoke is macOS-only (screencapture, and it is the Mac lane's operation); this is $(uname -s)"
  exit 2
fi
command -v cargo >/dev/null 2>&1 || { fail "cargo not on PATH"; exit 2; }

say "build native/desktop/app (release)"
if ! (cd "$APP_DIR" && cargo build --release); then
  fail "cargo build --release failed"
  exit 1
fi
[ -x "$BIN" ] || { fail "built, but $BIN is missing or not executable"; exit 1; }

OUT_DIR="${SIGNALGRID_DESKTOP_SMOKE_OUT:-$(mktemp -d "${TMPDIR:-/tmp}/desktop-window-smoke.XXXXXX")}"
# Stamped per run (epoch + pid), and refused if it somehow already exists: a stale
# PNG left in a reused SIGNALGRID_DESKTOP_SMOKE_OUT must never satisfy THIS run's
# mandatory-screenshot check.
SHOT="$OUT_DIR/desktop-window-$(date +%s)-$$.png"
if [ -e "$SHOT" ]; then
  fail "refusing to start: $SHOT already exists — a pre-existing PNG cannot stand in for this run's capture"
  exit 2
fi
SHOT_OK=0
take_screenshot() {
  if screencapture -x "$SHOT" 2>/dev/null && [ -s "$SHOT" ]; then
    SHOT_OK=1
    note "screenshot: $SHOT"
  else
    # A failed capture is a FAILED RUN, not a note: without the PNG this run cannot
    # be told apart from the banner defect. Screen Recording permission for the
    # terminal is the usual cause.
    fail "screencapture produced no PNG at $SHOT (Screen Recording permission for the terminal?)"
  fi
}

say "launch, screenshot at ${HOLD_HOOK_AT}s, hold for ${HOLD_SECONDS}s"
HOLD_HOOK=take_screenshot
declare -a EXTRA=()
if launch_and_hold "$HOLD_SECONDS" "$BIN" ${EXTRA+"${EXTRA[@]}"}; then
  ALIVE=1
else
  ALIVE=0
fi

say "result"
if [ "$ALIVE" != "1" ]; then
  echo "FAIL — the shell exited within ${HOLD_SECONDS}s of launch." >&2
  exit 1
fi
if [ "$SHOT_OK" != "1" ] || [ ! -s "$SHOT" ]; then
  echo "FAIL — the process lived, but no screenshot was captured by this run ($SHOT). Without the PNG this run cannot be told apart from the banner defect, so it is not a pass." >&2
  exit 1
fi
echo "PASS — the shell built, its process survived ${HOLD_SECONDS}s, and a screenshot exists at:"
echo "  $SHOT"
echo "LOOK AT IT. A red 'Could not read the decision from the core' banner over a deny"
echo "badge means withGlobalTauri did not take effect; the fixture step_up with two"
echo "reasons and 'Step up required; the gate did not state an obligation' means it did."
echo "This script cannot tell the two apart. That check is visual."
exit 0
