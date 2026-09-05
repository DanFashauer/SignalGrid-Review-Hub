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
    # Container restores resurrect a STALE gitignored web build, and the
    # launch-claims gate then reds on copy that no longer exists in any
    # source — three times now, most recently text carrying a label retired
    # under DR-019/DR-020. A remote container may only ever scan output it
    # built itself, so the restored copy goes at session start.
    node -e "require('fs').rmSync('artifacts/signalgrid-web/dist',{recursive:true,force:true})" 2>/dev/null \
      && echo "  stale dist  cleared (remote containers rebuild; restored copies lie)"
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
#    Lane identity is DERIVED the way proof:lane-messages derives it
#    (scripts/lib/lane-identity.mjs: darwin ⇒ mac, else cloud, SIGNALGRID_LANE
#    overrides). Until 2026-09-05 this line grepped a hardcoded "→ cloud (from
#    mac)", so on the Mac lane it was structurally incapable of reporting mail,
#    and a node failure (2>/dev/null) printed the same reassuring "none". Now an
#    unreadable mailbox is reported as UNKNOWN, never as empty.
if [ -f scripts/check-lane-messages.mjs ]; then
  LANE="$(node --input-type=module -e "import('./scripts/lib/lane-identity.mjs').then(m => process.stdout.write(m.currentLane()))" 2>/dev/null)"
  if [ -z "$LANE" ]; then LANE=cloud; [ "$(uname -s 2>/dev/null)" = "Darwin" ] && LANE=mac; fi
  OTHER=mac; [ "$LANE" = "mac" ] && OTHER=cloud
  if MAIL_OUT="$(node scripts/check-lane-messages.mjs 2>/dev/null)"; then
    MAIL_N="$(printf '%s\n' "$MAIL_OUT" | grep -cE "→ ${LANE} \(from ${OTHER}\)")"
    if [ "$MAIL_N" -gt 0 ]; then
      echo "  lane mail   ${MAIL_N} message(s) addressed to this lane (${LANE}) — pnpm run lane:inbox"
    else
      echo "  lane mail   none addressed to this lane (${LANE})"
    fi
  else
    echo "  lane mail   UNKNOWN — check-lane-messages.mjs failed; run pnpm run lane:inbox yourself"
  fi
fi
if [ -f scripts/check-sim-requests.mjs ]; then
  # Every pending id is counted; the first three are shown and the rest are
  # said out loud. The old `grep -A 2 | head -3` capped the listing at two rows
  # with no "and N more", so five pending requests read as two.
  if SIM_OUT="$(node scripts/check-sim-requests.mjs 2>/dev/null)"; then
    SIM_IDS="$(printf '%s\n' "$SIM_OUT" | sed -n '/PENDING/,/^$/p' | grep -oE '· [0-9a-z-]+' | sed 's/^· //')"
    SIM_N="$(printf '%s\n' "$SIM_IDS" | grep -c .)"
    if [ "$SIM_N" -gt 0 ]; then
      printf '%s\n' "$SIM_IDS" | head -3 | sed 's/^/  sim pending /'
      [ "$SIM_N" -gt 3 ] && echo "  sim pending …and $((SIM_N - 3)) more — node scripts/check-sim-requests.mjs"
    fi
  else
    echo "  sim pending UNKNOWN — check-sim-requests.mjs failed; run it yourself"
  fi
fi

# 4. The operating loop (2026-08-28 handoff Task 4b, merged under DR-021 —
#    the handoff's "Engineering FROZEN" banner is NOT reproduced here because
#    DR-021 lifted the freeze; the STATE block below is the live phase).
#    Condensed to the STATE block rather than the whole file: this hook's
#    contract is loud and short, and LOOP.md's own first line says where to
#    read the rest.
if [ -f docs/agent/LOOP.md ]; then
  echo "  loop        docs/agent/LOOP.md STATE:"
  sed -n '/^PHASE:/,/^NEXT ACTION:/p' docs/agent/LOOP.md | sed 's/^/              /'
fi
if node -e "process.exit(((require('./package.json').scripts)||{})['loop:state']?0:1)" 2>/dev/null; then
  pnpm run --silent loop:state 2>/dev/null | tail -n +1 | sed 's/^/  loop:state  /' | head -12 || echo "  loop:state  (failed — run pnpm run loop:state yourself)"
fi
echo "─────────────────────────────────────────────────────────────────────────"
exit 0
