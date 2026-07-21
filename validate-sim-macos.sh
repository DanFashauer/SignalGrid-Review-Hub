#!/usr/bin/env bash
# =============================================================================
# SignalGrid-Review-Hub — "real-life simulation" validation harness (macOS/arm64)
#
# Runs the full deterministic proof/sim suite that CI runs, natively on an Apple
# Silicon Mac — WITHOUT Docker. The repo's toolchain is pinned to linux-x64 (its
# pnpm-workspace.yaml strips every non-linux-x64 native binary), so the *web*
# build can't run here. But the simulator + all proof gates are pure TS logic run
# via tsx; they run natively once tsx's esbuild binary is present and the
# (esbuild-based) api-server is built. This harness sets that up and runs it all.
#
#   ./validate-sim-macos.sh            # full suite
#   ./validate-sim-macos.sh --sim-only # just the real-life simulator scenarios
#
# Exits non-zero if any gate fails. No silent success.
# =============================================================================
set -uo pipefail
cd "$(dirname "$0")"
SIM_ONLY="${1:-}"

# -- pnpm: prefer an on-PATH pnpm, else corepack, else a shim -----------------
if command -v pnpm >/dev/null 2>&1; then PNPM=pnpm
elif command -v corepack >/dev/null 2>&1; then PNPM="corepack pnpm@10.28.1"
else echo "ERROR: need pnpm or corepack on PATH"; exit 1; fi
run() { $PNPM "$@"; }

# perl-based timeout (macOS has no coreutils `timeout`)
to() { perl -e 'alarm shift; exec @ARGV' "$@"; }

pass=0; fail=0; failed_gates=""
gate() { # label  cmd...
  local label="$1"; shift
  if to 200 "$@" >"/tmp/sgval_${label//[^a-zA-Z0-9]/_}.log" 2>&1; then
    printf "  \033[32mPASS\033[0m  %s\n" "$label"; pass=$((pass+1))
  else
    printf "  \033[31mFAIL\033[0m  %s  (log: /tmp/sgval_%s.log)\n" "$label" "${label//[^a-zA-Z0-9]/_}"
    fail=$((fail+1)); failed_gates="$failed_gates $label"
  fi
}

echo "== SignalGrid sim validation (host: $(uname -s) $(uname -m), node $(node -v)) =="

echo; echo "== setup =="
echo "-- install deps"
run install --frozen-lockfile >/tmp/sgval_install.log 2>&1 || { echo "install failed"; tail /tmp/sgval_install.log; exit 1; }

# tsx needs esbuild's platform binary; the workspace overrides strip it. Add the
# matching version back locally (idempotent; does not touch committed files after).
ESV=$(ls node_modules/.pnpm 2>/dev/null | grep -oE '^esbuild@[0-9.]+' | head -1 | cut -d@ -f2)
ARCHPKG="@esbuild/$(uname -s | tr 'A-Z' 'a-z')-$(uname -m | sed 's/x86_64/x64/')"
if [ -n "$ESV" ] && ! ls -d node_modules/.pnpm/${ARCHPKG#@esbuild/}* >/dev/null 2>&1; then
  echo "-- add $ARCHPKG@$ESV (tsx runtime binary for this platform)"
  run add -w "$ARCHPKG@$ESV" >/tmp/sgval_esbuild.log 2>&1 || echo "   (add reported an issue; continuing)"
fi

echo "-- build api-server (esbuild; needed for observability + api integration test)"
run --filter @workspace/api-server run build >/tmp/sgval_apibuild.log 2>&1 \
  && echo "   dist built" || { echo "   api-server build FAILED"; tail /tmp/sgval_apibuild.log; exit 1; }

echo; echo "== real-life simulator scenarios =="
gate "proof:signalgrid-simulator (11 scenarios)" $PNPM run proof:signalgrid-simulator
gate "proof:room-sim"                            $PNPM run proof:room-sim
gate "proof:signalgrid-core"                     $PNPM run proof:signalgrid-core
gate "proof:signalgrid-grid"                     $PNPM run proof:signalgrid-grid

if [ "$SIM_ONLY" != "--sim-only" ]; then
  echo; echo "== full CI-mirror proof suite =="
  for p in $(node -e "const s=require('./package.json').scripts;console.log(Object.keys(s).filter(k=>k.startsWith('proof:')&&!['proof:signalgrid-simulator','proof:room-sim','proof:signalgrid-core','proof:signalgrid-grid'].includes(k)).join(' '))"); do
    gate "$p" $PNPM run "$p"
  done

  echo; echo "== non-proof gates =="
  gate "typecheck"            $PNPM run typecheck
  gate "test:api"             $PNPM run test:api
  gate "safety:check"         $PNPM run safety:check
  gate "docs:sanity"          $PNPM run docs:sanity
  gate "review:invariants"    $PNPM run review:invariants
fi

echo
echo "== NOTE: the linux-x64 web build (pnpm run build) is intentionally skipped =="
echo "   — its vite/rollup/lightningcss/tailwind darwin binaries are stripped by the"
echo "     repo's own pnpm-workspace.yaml (CI runs linux-x64). Run it in CI / linux for web."
echo
echo "== SUMMARY: $pass passed, $fail failed =="
if [ "$fail" -ne 0 ]; then echo "   failed:$failed_gates"; exit 1; fi
echo "✅ Simulation validation GREEN."
