#!/usr/bin/env bash
# scripts/mac/free-test-port.sh — reap a RUNNER-OWNED api-server orphan before (and after)
# a self-hosted Mac job.
#
# WHY. A killed harness/preflight/pr-mac-checks job can leave an ephemeral api-server
# (artifacts/api-server/dist/index.mjs) bound to a test port; the next test:api on this box
# then cannot bind and its readiness probe talks to the STALE build instead (mac orphan
# PID-4293 on :5310, squatting 4h26m, 2026-09-12). The prior job's own exit trap cannot
# clean that up — it was killed before it ran — so each job reaps at start, and at teardown
# so it never orphans one for the next.
#
# WHAT. Reap EVERY process whose command is this runner's api-server binary
# ($GITHUB_WORKSPACE/artifacts/api-server/dist/index.mjs), on ANY port — test:api uses 5310
# and several higher ports (5311+), so a per-port kill would miss orphans on the others
# (Codex #696). No lsof, no port list: match the process by its own binary path.
#
# SAFETY (Codex #696).
#  - Match the EXACT canonical path under $GITHUB_WORKSPACE, so a sibling checkout such as
#    "$GITHUB_WORKSPACE-local" (unbounded-substring collision) is never matched, and a
#    developer's local test:api from a different checkout is left alone.
#  - `ps -Aww` — repeated -w gives untruncated argv; plain `ps -o command=` truncates to the
#    window width on macOS and could drop the trailing marker, silently no-op'ing the reap.
#  - bash 3.2 safe (no arrays; while-read from a heredoc keeps the counter out of a subshell),
#    fail-safe (every step guarded; never aborts the job).
#
# The optional first arg (a port) is accepted for call-site readability but is not used to
# scope the reap — ownership is by binary path, which covers every port the suite uses.
set -u
OWN="${GITHUB_WORKSPACE:-$PWD}"
SERVER="$OWN/artifacts/api-server/dist/index.mjs"   # the exact api-server this runner builds
killed=0
while read -r pid cmd; do
  [ -n "${pid:-}" ] || continue
  case "$cmd" in
    *"$SERVER"*)
      echo "free-test-port: reaping runner-owned api-server pid $pid"
      echo "  cmd: $cmd"
      kill -9 "$pid" 2>/dev/null || true
      killed=$((killed + 1))
      ;;
  esac
done <<EOF
$(ps -Aww -o pid= -o command= 2>/dev/null || true)
EOF
echo "free-test-port: done — reaped $killed runner-owned api-server(s) under $OWN"
