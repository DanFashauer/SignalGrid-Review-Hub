#!/usr/bin/env bash
# mac-kickoff.sh — the whole Mac lane, from a cold Mac to committed live evidence.
#
#   cd /path/to/SignalGrid-Review-Hub && ./mac-kickoff.sh
#
# Why this file exists
# --------------------
# The Mac lane is the ONE thing no agent, no CI runner and no cloud sandbox can do
# for you: `verify:all --emit-evidence` refuses unless it is running on macOS AND
# not on a CI runner, on purpose, because green-ness is not hardware (see the long
# comment in scripts/verify-all.mjs). So the work cannot be automated away from
# this machine — but it CAN be reduced to one command, which is what this is.
#
# It also encodes three things that cost real debugging time, so they are never
# re-derived by hand:
#
#   1. The signalgrid-mcp checkout must sit at a path verify-all.mjs actually
#      searches: SIGNALGRID_MCP_PATH, ../signalgrid-mcp, ./signalgrid-mcp, or
#      /workspace/signalgrid-mcp. A checkout anywhere else is invisible to it.
#   2. Its `.venv` must exist, or verify-all falls back to a bare `python3` that
#      has no pytest. `./verify.sh` in that repo builds the venv correctly.
#   3. A `claude mcp add ... --with mcp[cli] ...` registration pins NOTHING and
#      IGNORES pyproject.toml, so it installs MCP SDK 2.x, where
#      `mcp.server.fastmcp` no longer exists — the server dies at import and the
#      client reports only "-32000: Connection closed". The bound has to be in the
#      registration itself: --with 'mcp[cli]<2'.
#
# Everything here is read-only with respect to your machine's configuration except
# the `claude mcp` re-registration in step 4, which is announced and skippable.
#
# Flags:
#   --skip-mcp-register   leave `claude mcp` alone (step 4 becomes a no-op)
#   --no-push             do everything, commit nothing, push nothing
#   --yes                 don't pause for confirmation before the commit

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MCP_DIR="${SIGNALGRID_MCP_PATH:-$(cd "$REPO_ROOT/.." && pwd)/signalgrid-mcp}"
MCP_REMOTE="https://github.com/DanFashauer/signalgrid-mcp.git"
MCP_SERVER_NAME="signalgrid-macos"

SKIP_REGISTER=0
NO_PUSH=0
ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    --skip-mcp-register) SKIP_REGISTER=1 ;;
    --no-push)           NO_PUSH=1 ;;
    --yes|-y)            ASSUME_YES=1 ;;
    -h|--help)           sed -n '2,40p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown flag: $arg (try --help)" >&2; exit 2 ;;
  esac
done

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()   { printf '   \033[32mok\033[0m   %s\n' "$*"; }
warn() { printf '   \033[33mwarn\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31mFAILED\033[0m %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 0. Refuse early and clearly on the wrong machine, rather than failing deep in
#    step 5 with a confusing message from verify-all.
# ---------------------------------------------------------------------------
step "0/6  preflight — is this the right machine?"
[ "$(uname -s)" = "Darwin" ] || die "this is $(uname -s), not macOS.

  The Mac lane exists to record a REAL managed Mac. verify:all --emit-evidence
  refuses off-macOS by design, so running this anywhere else cannot produce
  evidence — it would only produce a confusing failure. Run it on your Mac."
ok "macOS $(sw_vers -productVersion 2>/dev/null || echo '?') on $(uname -m)"

command -v git >/dev/null 2>&1 || die "git not found"
command -v pnpm >/dev/null 2>&1 || die "pnpm not found — install with: npm i -g pnpm"
command -v node >/dev/null 2>&1 || die "node not found"
ok "node $(node -v), pnpm $(pnpm -v)"

# ---------------------------------------------------------------------------
# 1. Review-Hub side up to date.
# ---------------------------------------------------------------------------
step "1/6  update this repo"
BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"
if [ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]; then
  warn "working tree is dirty — NOT pulling, so nothing of yours is clobbered."
  warn "commit or stash first if you want the latest gates."
else
  git -C "$REPO_ROOT" pull --ff-only origin "$BRANCH" >/dev/null 2>&1 \
    && ok "pulled origin/$BRANCH" \
    || warn "could not fast-forward $BRANCH (diverged or offline) — continuing with what is here"
fi
ok "at $(git -C "$REPO_ROOT" rev-parse --short HEAD) on $BRANCH"

# ---------------------------------------------------------------------------
# 2. The signalgrid-mcp checkout, at a path verify-all can actually find.
# ---------------------------------------------------------------------------
step "2/6  signalgrid-mcp checkout"
if [ -d "$MCP_DIR/.git" ]; then
  ok "found $MCP_DIR"
  if [ -z "$(git -C "$MCP_DIR" status --porcelain)" ]; then
    git -C "$MCP_DIR" fetch -q origin main 2>/dev/null \
      && git -C "$MCP_DIR" checkout -q main 2>/dev/null \
      && git -C "$MCP_DIR" merge -q --ff-only origin/main 2>/dev/null \
      && ok "updated to origin/main" \
      || warn "could not fast-forward to main — continuing with the current checkout"
  else
    warn "checkout is dirty — leaving it exactly as it is"
  fi
elif [ -e "$MCP_DIR" ]; then
  die "$MCP_DIR exists but is not a git checkout. Move it aside and re-run."
else
  echo "   cloning $MCP_REMOTE"
  git clone -q "$MCP_REMOTE" "$MCP_DIR" || die "clone failed"
  ok "cloned to $MCP_DIR"
fi

# The pin is what makes any of this work; say plainly whether it is present rather
# than assuming the merge is in this checkout.
if grep -q 'mcp>=1\.9\.0,<2' "$MCP_DIR/pyproject.toml" 2>/dev/null; then
  ok "SDK pin present: mcp>=1.9.0,<2"
else
  warn "pyproject.toml does NOT carry the <2 bound. Against MCP SDK 2.x the server"
  warn "cannot import (mcp.server.fastmcp was removed). Pull main in $MCP_DIR."
fi

# ---------------------------------------------------------------------------
# 3. Build the MCP venv. verify-all prefers $MCP_DIR/.venv/bin/python and falls
#    back to a bare python3 that almost certainly has no pytest, so skipping this
#    produces a confusing failure two steps later.
# ---------------------------------------------------------------------------
step "3/6  build the signalgrid-mcp venv (its own ./verify.sh)"
if [ -x "$MCP_DIR/.venv/bin/pytest" ]; then
  ok ".venv already present — reusing it"
  ok "installed SDK: $("$MCP_DIR/.venv/bin/python" -c 'import importlib.metadata as m; print("mcp " + m.version("mcp"))' 2>/dev/null || echo 'mcp version unknown')"
else
  ( cd "$MCP_DIR" && ./verify.sh ) || die "signalgrid-mcp ./verify.sh failed.

  That script builds the venv and runs its own suite. If it failed at pytest
  COLLECTION with ModuleNotFoundError for mcp.server.fastmcp, the <2 pin is
  missing from this checkout: git -C $MCP_DIR pull"
  ok "venv built and the MCP suite passed"
fi

# ---------------------------------------------------------------------------
# 4. The Claude Code registration. Separate from everything above: it governs
#    your editor's MCP client, not this verification run.
# ---------------------------------------------------------------------------
step "4/6  claude mcp registration"
if [ "$SKIP_REGISTER" = "1" ]; then
  ok "skipped (--skip-mcp-register)"
elif ! command -v claude >/dev/null 2>&1; then
  warn "the 'claude' CLI is not on PATH — skipping. Register by hand later with:"
  warn "  claude mcp add $MCP_SERVER_NAME -- \"\$(command -v uv)\" run --python 3.12 --with 'mcp[cli]<2' python $MCP_DIR/server.py"
elif ! command -v uv >/dev/null 2>&1; then
  warn "'uv' is not on PATH — skipping. Install it (https://docs.astral.sh/uv/) or"
  warn "register against the venv python instead:"
  warn "  claude mcp add $MCP_SERVER_NAME -- $MCP_DIR/.venv/bin/python $MCP_DIR/server.py"
else
  UV_BIN="$(command -v uv)"
  echo "   re-registering '$MCP_SERVER_NAME' with the SDK bound in the command itself."
  echo "   (--with pins nothing and ignores pyproject.toml, so the bound must live here)"
  claude mcp remove "$MCP_SERVER_NAME" >/dev/null 2>&1 || true
  if claude mcp add "$MCP_SERVER_NAME" -- \
      "$UV_BIN" run --python 3.12 --with 'mcp[cli]<2' python "$MCP_DIR/server.py" >/dev/null 2>&1; then
    ok "registered — verify with: claude mcp list"
  else
    warn "registration failed; register by hand:"
    warn "  claude mcp add $MCP_SERVER_NAME -- $UV_BIN run --python 3.12 --with 'mcp[cli]<2' python $MCP_DIR/server.py"
  fi
fi

# ---------------------------------------------------------------------------
# 5. The actual point: both halves, then mint evidence.
# ---------------------------------------------------------------------------
step "5/6  verify:all --require-mcp --emit-evidence"
echo "   Review-Hub preflight + signalgrid-mcp pytest against the shared contract."
echo "   This is the slow part (full proof suite). Nothing is emitted unless BOTH halves pass."
SIGNALGRID_MCP_PATH="$MCP_DIR" pnpm run verify:all -- --require-mcp --emit-evidence
VERIFY_RC=$?
[ "$VERIFY_RC" -eq 0 ] || die "verify:all exited $VERIFY_RC — no evidence minted.

  This is the honest outcome, not a bug in this script: evidence is gated on a
  fully-green run of both halves. Read the summary above, fix the failing half,
  and re-run. Do not hand-write an evidence file."
ok "both halves green"

# ---------------------------------------------------------------------------
# 6. Commit the evidence. It is the deliverable — an uncommitted run proves
#    nothing to anyone but you.
# ---------------------------------------------------------------------------
step "6/6  commit the evidence"
EVIDENCE_DIR="artifacts/live-evidence"
if [ -z "$(git -C "$REPO_ROOT" status --porcelain -- "$EVIDENCE_DIR" 2>/dev/null)" ]; then
  warn "no change under $EVIDENCE_DIR — nothing to commit."
  warn "(verify:all passed, so this likely means an identical run is already committed.)"
  exit 0
fi
git -C "$REPO_ROOT" status --short -- "$EVIDENCE_DIR"

if [ "$NO_PUSH" = "1" ]; then
  ok "--no-push set: leaving the above uncommitted for you to review."
  exit 0
fi
if [ "$ASSUME_YES" != "1" ]; then
  printf '\n   commit and push the above? [y/N] '
  read -r reply
  case "$reply" in [yY]*) ;; *) ok "left uncommitted."; exit 0 ;; esac
fi

git -C "$REPO_ROOT" add "$EVIDENCE_DIR" || die "git add failed"
git -C "$REPO_ROOT" commit -q -m "evidence(mac): real-hardware verify:all run

Minted by mac-kickoff.sh on a real Mac. Both halves green: the Review-Hub
preflight and the signalgrid-mcp suite against the shared posture-report
contract. --emit-evidence refuses off-macOS and on CI runners, so this file
could not have been produced by a sandbox." || die "commit failed"

for attempt in 1 2 3 4; do
  if git -C "$REPO_ROOT" push -u origin "$BRANCH"; then
    ok "pushed to origin/$BRANCH"
    break
  fi
  [ "$attempt" = "4" ] && die "push failed after 4 attempts — the commit is local, retry with: git push -u origin $BRANCH"
  sleep $((2 ** attempt))
done

printf '\n\033[1mDone.\033[0m liveEvidence should now read "fresh" rather than "none".\n'
