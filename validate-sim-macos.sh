#!/usr/bin/env bash
# =============================================================================
# SignalGrid-Review-Hub — "real-life simulation" validation harness (macOS/arm64)
#
# Runs the full deterministic proof/sim suite that CI runs, natively on an Apple
# Silicon Mac — WITHOUT Docker. The repo's pnpm-workspace.yaml strips every
# non-linux-x64 native binary, which long read as "the web build cannot run here".
# It can: nothing about the SOURCES is linux-only, so this harness supplies the
# four stripped darwin binaries for the run and builds all six web artifacts too.
# The simulator + proof gates are pure TS via tsx. Everything runs natively.
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
# matching version back for THIS RUN only.
#
# `pnpm add -w` rewrites package.json AND pnpm-lock.yaml, so we snapshot both and
# restore them afterwards — the installed binary stays in node_modules (all we
# need) while the committed manifests are left byte-identical. Without this the
# stray root dependency gets committed and every CI job's first step
# (`pnpm install --frozen-lockfile`) fails on a lockfile/manifest mismatch.
#
# This covers tsx's esbuild AND the web build's toolchain. The header of this file
# used to say the web build was unrunnable here; that was wrong in an important
# way. Nothing about the SOURCES is linux-only — only the four native binaries the
# workspace strips are. Supply them for the run and all six web artifacts build on
# darwin/arm64. "The build is linux-x64-only" was a fact about node_modules being
# read as a fact about the code.
PLAT="$(uname -s | tr 'A-Z' 'a-z')-$(uname -m | sed 's/x86_64/x64/')"
pkg_ver() { ls node_modules/.pnpm 2>/dev/null | grep -oE "^$1@[0-9.]+" | head -1 | sed "s/^$1@//"; }

# Added UNCONDITIONALLY rather than probed-then-added. A `.pnpm/<pkg>@<ver>` store
# directory survives the `install --frozen-lockfile` above while no longer being
# LINKED into the consumer's node_modules — so "the directory exists" is not the
# same question as "rollup can require it", and probing for it reported present
# for binaries the build then could not load. `pnpm add` is idempotent and costs
# under a second; a wrong answer costs a red gate that looks like a real failure.
WANT=""
want() { [ -n "$2" ] && WANT="$WANT $1@$2"; }
want "@esbuild/$PLAT"           "$(pkg_ver esbuild)"
want "@rollup/rollup-$PLAT"     "$(pkg_ver rollup)"
want "lightningcss-$PLAT"       "$(pkg_ver lightningcss)"
want "@tailwindcss/oxide-$PLAT" "$(pkg_ver '@tailwindcss\+oxide')"

if [ -n "$WANT" ]; then
  echo "-- add platform binaries for this run:$WANT"
  cp package.json /tmp/sgval_pkg.bak 2>/dev/null
  cp pnpm-lock.yaml /tmp/sgval_lock.bak 2>/dev/null
  # shellcheck disable=SC2086
  run add -w --save-optional $WANT >/tmp/sgval_esbuild.log 2>&1 || echo "   (add reported an issue; continuing)"
  cp /tmp/sgval_pkg.bak package.json 2>/dev/null
  cp /tmp/sgval_lock.bak pnpm-lock.yaml 2>/dev/null
  echo "   (manifests restored; binaries kept in node_modules)"
fi

echo "-- build api-server (esbuild; needed for observability + api integration test)"
run --filter @workspace/api-server run build >/tmp/sgval_apibuild.log 2>&1 \
  && echo "   dist built" || { echo "   api-server build FAILED"; tail /tmp/sgval_apibuild.log; exit 1; }

# -- Redis for the one proof that races a real shared store --------------------
# proof:enrollment-race REFUSES (exit 1) without REDIS_URL rather than passing
# vacuously — correct, but this harness enumerates every proof:* script, so it ran
# a proof it never satisfied and reported "1 failed" on a wholly green tree. A gate
# that can never reach 0 failures trains its reader to ignore failures, and
# CLAUDE.md tells that reader to compare M against 0. So: provide the store when
# Docker can, and when it cannot, SKIP the proof loudly with the reason — never
# silently, and never counted as passed.
REDIS_CONTAINER=sgval-redis
REDIS_PORT=6381   # not 6379/6380: leaves a local Redis and docker-verify's alone
SKIPPED=0; skipped_gates=""
skip() { printf "  \033[33mSKIP\033[0m  %s  (%s)\n" "$1" "$2"; SKIPPED=$((SKIPPED+1)); skipped_gates="$skipped_gates $1"; }

if [ -z "${REDIS_URL:-}" ] && docker info >/dev/null 2>&1; then
  docker rm -f "$REDIS_CONTAINER" >/dev/null 2>&1
  if docker run -d --name "$REDIS_CONTAINER" -p "$REDIS_PORT:6379" redis:7 >/dev/null 2>&1; then
    for _ in $(seq 1 20); do
      docker exec "$REDIS_CONTAINER" redis-cli ping 2>/dev/null | grep -q PONG && break
      sleep 1
    done
    export REDIS_URL="redis://127.0.0.1:$REDIS_PORT"
    echo "-- started $REDIS_CONTAINER on $REDIS_PORT for proof:enrollment-race"
    trap 'docker rm -f "$REDIS_CONTAINER" >/dev/null 2>&1' EXIT
  fi
fi

echo; echo "== real-life simulator scenarios =="
gate "proof:signalgrid-simulator (11 scenarios)" $PNPM run proof:signalgrid-simulator
gate "proof:room-sim"                            $PNPM run proof:room-sim
gate "proof:signalgrid-core"                     $PNPM run proof:signalgrid-core
gate "proof:signalgrid-grid"                     $PNPM run proof:signalgrid-grid

if [ "$SIM_ONLY" != "--sim-only" ]; then
  echo; echo "== full CI-mirror proof suite =="
  for p in $(node -e "const s=require('./package.json').scripts;console.log(Object.keys(s).filter(k=>k.startsWith('proof:')&&!['proof:signalgrid-simulator','proof:room-sim','proof:signalgrid-core','proof:signalgrid-grid'].includes(k)).join(' '))"); do
    # The race proof needs a real shared store. With one, run it like any other
    # gate; without one, say so — an unrun proof is never a passed proof.
    if [ "$p" = "proof:enrollment-race" ] && [ -z "${REDIS_URL:-}" ]; then
      skip "$p" "needs REDIS_URL (no Docker here); run it via pnpm run verify:docker"
      continue
    fi
    # proof:live-edr reads a REAL Wazuh. Standing one up costs a ~2GB image and
    # minutes of boot, so unlike Redis it is NOT auto-provisioned here — it is
    # named as skipped with the command to run it, never silently passed.
    if [ "$p" = "proof:live-edr" ] && [ -z "${WAZUH_URL:-}" ]; then
      skip "$p" "needs a live Wazuh (WAZUH_URL); see docs/ZERO_COST_LIVE_TEST_MATRIX.md section 6"
      continue
    fi
    # proof:live-fleet reads a REAL Fleet (MySQL + Redis + Fleet, amd64 under
    # emulation). Same reasoning as Wazuh: too heavy to auto-provision, so it is
    # named as skipped with the command to run it, never silently passed.
    if [ "$p" = "proof:live-fleet" ] && [ -z "${FLEET_URL:-}" ]; then
      skip "$p" "needs a live Fleet (FLEET_URL + FLEET_TOKEN); see docs/FLEET_LIVE_INTEGRATION.md"
      continue
    fi
    # proof:live-location reads a REAL Traccar and INGESTS positions into it, so it
    # mutates that server's data — never point it at anything but a disposable one.
    if [ "$p" = "proof:live-location" ] && [ -z "${TRACCAR_URL:-}" ]; then
      skip "$p" "needs a live Traccar (TRACCAR_URL/USER/PASS); see docs/TRACCAR_LIVE_INTEGRATION.md"
      continue
    fi
    # proof:live-keycloak needs a real Keycloak with the DPoP feature AND a client
    # carrying tenant/role protocol mappers — configuration a proof cannot invent.
    if [ "$p" = "proof:live-keycloak" ] && [ -z "${KEYCLOAK_URL:-}" ]; then
      skip "$p" "needs a live Keycloak (KEYCLOAK_URL); see docs/KEYCLOAK_LIVE_INTEGRATION.md"
      continue
    fi
    gate "$p" $PNPM run "$p"
  done

  echo; echo "== non-proof gates =="
  gate "typecheck"            $PNPM run typecheck
  gate "build (6 web artifacts)" $PNPM run build
  gate "test:api"             $PNPM run test:api
  gate "safety:check"         $PNPM run safety:check
  gate "docs:sanity"          $PNPM run docs:sanity
  gate "review:invariants"    $PNPM run review:invariants
fi

echo
echo "== NOTE: the web build now RUNS here (it used to be skipped) =="
echo "   — the vite/rollup/lightningcss/tailwind darwin binaries this repo strips are"
echo "     added to node_modules for the run, exactly as tsx's esbuild binary always"
echo "     was. Nothing about the sources is linux-only; all 6 artifacts build on arm64."
echo
echo "== SUMMARY: $pass passed, $fail failed, $SKIPPED skipped =="
if [ "$fail" -ne 0 ]; then echo "   failed:$failed_gates"; exit 1; fi
# A skip is not a pass. Green still means "nothing failed", but the skipped gates
# are named so a reader is never left believing the suite covered them.
if [ "$SKIPPED" -ne 0 ]; then
  echo "   skipped (NOT verified by this run):$skipped_gates"
  echo "✅ Nothing failed — but see the skipped gate(s) above."
  exit 0
fi
echo "✅ Simulation validation GREEN."
