#!/usr/bin/env bash
# scripts/mac/free-test-port.sh — free the api-server test port of a RUNNER-OWNED orphan
# before (and after) a self-hosted Mac job.
#
# WHY. A killed harness/preflight job can leave an ephemeral api-server (dist/index.mjs)
# bound to the test port; the next test:api on this box then cannot bind and hits the
# stale build instead (mac orphan PID-4293 on :5310, squatting 4h26m, 2026-09-12). A
# previous job's own exit trap cannot clean that up — it was killed before it ran — so the
# NEXT job frees the port at start, and every job frees it at teardown so it never orphans
# one for the next.
#
# SAFETY. Kill ONLY a dist/index.mjs holder whose command is under THIS runner's workspace
# ($GITHUB_WORKSPACE, the Actions worktree path). A developer's local `pnpm run test:api`
# from their own checkout lives under a different path and is left alone — Codex #696.
# bash 3.2 safe (no arrays), fail-safe (never aborts the job).
set -u
PORT="${1:-5310}"
OWN="${GITHUB_WORKSPACE:-$PWD}"   # only servers under the runner's checkout are ours to reap
killed=0
for pid in $(lsof -ti "tcp:${PORT}" 2>/dev/null || true); do
  cmd="$(ps -o command= -p "$pid" 2>/dev/null || true)"
  case "$cmd" in
    *dist/index.mjs*)
      case "$cmd" in
        *"$OWN"*)
          echo "free-test-port: killing runner-owned stale api-server pid $pid on :$PORT"
          echo "  cmd: $cmd"
          kill -9 "$pid" 2>/dev/null || true
          killed=$((killed + 1))
          ;;
        *)
          echo "free-test-port: leaving pid $pid on :$PORT — not under $OWN (cmd: $cmd)"
          ;;
      esac
      ;;
  esac
done
echo "free-test-port: done on :$PORT (killed $killed)"
