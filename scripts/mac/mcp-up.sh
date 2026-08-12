#!/usr/bin/env bash
# mcp-up.sh — the self-updating SignalGrid MCP launcher for Claude Desktop.
#
# Point Claude Desktop at THIS script instead of dist/index.mjs and the
# connection stops drifting: every time Claude Desktop starts (it spawns the
# MCP command fresh each session), this script fast-forwards the branch,
# reinstalls dependencies if the lockfile moved, rebuilds the server if its
# sources moved, and only then execs the server.
#
#   { "mcpServers": { "signalgrid": {
#       "command": "/bin/bash",
#       "args": ["<repo>/scripts/mac/mcp-up.sh"] } } }
#
# FAIL OPEN TO STALE, NEVER TO BROKEN. If the network is down, the tree is
# dirty, or the pull cannot fast-forward, the script says so on stderr and
# serves the EXISTING build — a stale server that works beats no server. It
# never resets, stashes, or force-pulls: your local edits are yours.
#
# STDOUT IS THE MCP TRANSPORT. Every line this script prints goes to stderr;
# nothing may touch stdout before exec'ing node.

set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BRANCH="claude/signalgrid-launch-plan-emxm01"
DIST="$REPO/artifacts/mcp-server/dist/index.mjs"
log() { echo "[mcp-up] $*" >&2; }

cd "$REPO" || { log "repo not found at $REPO"; exit 1; }

update_failed=""
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  update_failed="working tree has local changes — not pulling over them"
elif ! git fetch origin "$BRANCH" --quiet 2>/dev/null; then
  update_failed="git fetch failed (offline?)"
else
  local_sha="$(git rev-parse HEAD 2>/dev/null)"
  remote_sha="$(git rev-parse "origin/$BRANCH" 2>/dev/null)"
  if [ "$local_sha" = "$remote_sha" ]; then
    log "up to date at ${local_sha:0:9}"
  elif git merge-base --is-ancestor HEAD "origin/$BRANCH" 2>/dev/null; then
    if git merge --ff-only "origin/$BRANCH" --quiet 2>/dev/null; then
      log "updated ${local_sha:0:9} -> ${remote_sha:0:9}"
      # Lockfile or source moved? Reinstall/rebuild only when needed.
      if ! git diff --quiet "$local_sha" HEAD -- pnpm-lock.yaml 2>/dev/null; then
        log "lockfile changed — pnpm install (frozen)"
        pnpm install --frozen-lockfile >&2 || update_failed="pnpm install failed"
      fi
    else
      update_failed="fast-forward merge failed"
    fi
  else
    update_failed="local branch has diverged from origin — resolve manually"
  fi
fi
[ -n "$update_failed" ] && log "UPDATE SKIPPED: $update_failed — serving the existing build"

# Rebuild when the built server is missing or older than any of its inputs.
needs_build=""
if [ ! -f "$DIST" ]; then
  needs_build="no build yet"
else
  newer="$(find artifacts/mcp-server/src lib/signalgrid-core/src lib/room-sim/src lib/signal-radar/src lib/facility-trust-graph/src -name '*.ts' -newer "$DIST" -print -quit 2>/dev/null)"
  [ -n "$newer" ] && needs_build="sources newer than build ($newer)"
fi
if [ -n "$needs_build" ]; then
  log "rebuilding mcp-server: $needs_build"
  if ! pnpm --filter @workspace/mcp-server run build >&2; then
    if [ -f "$DIST" ]; then
      log "BUILD FAILED — serving the previous build (stale but working)"
    else
      log "BUILD FAILED and no previous build exists"
      exit 1
    fi
  fi
fi

log "launching $(git rev-parse --short HEAD 2>/dev/null)"
exec node "$DIST"
