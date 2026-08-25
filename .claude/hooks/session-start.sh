#!/bin/bash
# SessionStart hook — what every session in this repository must know before it
# touches anything, done rather than remembered.
#
# WHY THIS EXISTS, from one day's evidence rather than from theory:
#
#   1. THE WORKING TREE LIED, TWICE. On 2026-08-25 this container silently
#      reverted to a day-old snapshot mid-session. Commits that were already
#      safe on the remote read as missing, and the honest-looking response —
#      redo the work — would have been wrong both times. The fix is always
#      fetch and compare, so the comparison happens here, before anyone forms
#      an impression from `git status`.
#
#   2. A MISSING DEPENDENCY REDDENED A BUILD NOBODY HAD TOUCHED.
#      @fontsource/inter was declared and not installed, so `pnpm run build`
#      failed in a package the session had not opened. Ten minutes went into
#      proving it was not the session's fault.
#
#   3. CLAUDE.md SAYS "Run this first, every session" ABOUT THE LANE INBOX,
#      and nothing made that true. It ran when somebody remembered.
#
# IT REPORTS AND NEVER BLOCKS — every path exits 0 on purpose.
# This repository's doctrine is fail-closed, and a session start is the one
# place that inverts: a blocked session cannot be used to fix the thing that
# blocked it. So the hook is loud and harmless. Nothing here gates; the 180+
# gates in preflight do that, after there is something to gate.
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" || exit 0
echo "── SignalGrid session start ─────────────────────────────────────────────"

# 1. Dependencies — REMOTE ONLY, and the exclusion is not laziness.
#    CLAUDE.md records that local macOS builds add darwin platform binaries and
#    restore the manifests afterwards, which re-diverges the lockfile AFTER it
#    was correctly regenerated. A hook running pnpm install on the Mac would
#    manufacture exactly the drift the pre-push hook exists to catch. Remote
#    containers start clean, so this is safe there and harmful here.
if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  if pnpm install --frozen-lockfile >/tmp/sg-install.log 2>&1; then
    echo "  deps        installed from the frozen lockfile"
  else
    echo "  deps        INSTALL FAILED — see /tmp/sg-install.log. Expect unrelated build errors."
  fi
else
  echo "  deps        skipped (not a remote container; a local pnpm install can re-diverge the lockfile)"
fi

# 2. Does the working tree agree with the remote?
if git fetch origin --quiet 2>/dev/null; then
  HEAD_SHA="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
  BRANCH="$(git branch --show-current 2>/dev/null || echo detached)"
  UPSTREAM="$(git rev-parse --abbrev-ref '@{u}' 2>/dev/null || echo none)"
  if [ "$UPSTREAM" != "none" ]; then
    AHEAD="$(git rev-list --count '@{u}..HEAD' 2>/dev/null || echo 0)"
    BEHIND="$(git rev-list --count 'HEAD..@{u}' 2>/dev/null || echo 0)"
    if [ "$BEHIND" -gt 0 ]; then
      echo "  tree        ${BRANCH} is ${BEHIND} BEHIND ${UPSTREAM} (and ${AHEAD} ahead)."
      echo "              If work looks missing, it is probably here, not lost:"
      echo "              git fetch origin && git reset --hard ${UPSTREAM}"
    else
      echo "  tree        ${BRANCH} @ ${HEAD_SHA:0:7} — ${AHEAD} ahead, ${BEHIND} behind ${UPSTREAM}"
    fi
  else
    echo "  tree        ${BRANCH} @ ${HEAD_SHA:0:7} — no upstream set"
  fi
else
  echo "  tree        could not reach origin; treat any git status here as a sample, not a fact"
fi

# 3. The two loops CLAUDE.md says to read first.
if [ -f scripts/check-lane-messages.mjs ]; then
  node scripts/check-lane-messages.mjs 2>/dev/null \
    | grep -cE '→ cloud \(from mac\)' \
    | awk '{ if ($1 > 0) print "  lane mail   " $1 " message(s) addressed to this lane — pnpm run lane:inbox"; else print "  lane mail   none addressed to this lane" }'
fi
if [ -f scripts/check-sim-requests.mjs ]; then
  node scripts/check-sim-requests.mjs 2>/dev/null \
    | grep -A 2 'PENDING' | grep -oE '· [0-9a-z-]+' | head -3 \
    | sed 's/^· /  sim pending /' || true
fi

echo "─────────────────────────────────────────────────────────────────────────"
exit 0
