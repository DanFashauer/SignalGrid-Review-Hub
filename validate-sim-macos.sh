#!/usr/bin/env bash
# =============================================================================
# SignalGrid-Review-Hub — "real-life simulation" validation harness (macOS/arm64)
#
# Runs the full deterministic proof/sim suite that CI runs, natively on an Apple
# Silicon Mac — WITHOUT Docker. The repo's pnpm-workspace.yaml strips every
# non-linux-x64 native binary, which long read as "the web build cannot run here".
# It can: nothing about the SOURCES is linux-only, so this harness supplies the
# four stripped darwin binaries for the run and builds every web artifact too.
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

# How many web artifacts `pnpm run build` produces — DERIVED from the workspace,
# never typed. This said "6" in four places and went stale the moment
# artifacts/mockup-sandbox was deleted (ponytail cut 3), so the harness announced a
# gate over a population that no longer existed. The count is the number of
# artifacts whose build script invokes vite.
#
# bash 3.2 (the only bash on a stock Mac): plain command substitution and `wc -l`
# only — no mapfile, no `${var@Q}`, no arrays to expand under `set -u`.
WEB_ARTIFACTS=$(grep -lE '"build"[[:space:]]*:[[:space:]]*"[^"]*vite build' artifacts/*/package.json 2>/dev/null | wc -l | tr -d '[:space:]')
# FLOOR. A derivation that finds nothing must not be reported as "0 web artifacts
# built" — that reads as a fact and is a broken parse. Refuse instead.
if [ "${WEB_ARTIFACTS:-0}" -lt 1 ]; then
  echo "FATAL: derived 0 web artifacts from artifacts/*/package.json — the parse drifted," >&2
  echo "       or this is not the repo root. Refusing to run a suite that cannot count" >&2
  echo "       what it builds. (Expected: package.json files whose build script runs vite.)" >&2
  exit 1
fi

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
# workspace strips are. Supply them for the run and every web artifact builds on
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
# Vite 8 bundles with ROLLDOWN, not rollup — so the `@rollup/rollup-*` line above
# now resolves to an empty version and adds nothing, and this line is the one that
# actually supplies the bundler. Without it `vite build` dies on darwin with
# "Cannot find module '@rolldown/binding-darwin-arm64'" and the harness reports
# the `build (N web artifacts)` gate failed on a tree that is fine — exactly what
# it did once the web packages moved to Vite 8. pnpm-workspace.yaml strips this
# binding like all the others; the list here has to track the bundler.
want "@rolldown/binding-$PLAT"  "$(pkg_ver rolldown)"
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

# -- proofs that SKIP THEMSELVES ----------------------------------------------
# Five proofs open with `const url = process.env.DATABASE_URL; if (!url) { …
# console.log("… SKIPPED …"); process.exit(0); }`. On a machine with no Postgres
# they print one line, exit 0, and `gate` above recorded five PASSES for five
# proofs that executed not one assertion — the harness's own summary line ("a skip
# is not a pass") contradicted by five silent skips it counted as passes.
#
# DERIVED, never typed: the list comes from scripts/src/*.ts via the parity gate,
# which fails if a sixth self-skipping proof appears unclassified. Same law as
# WEB_ARTIFACTS above — and the same FLOOR, because an empty derivation would
# quietly restore the old behaviour for all five.
#
# bash 3.2: a space-delimited STRING and `case`, never an array. `"${a[@]}"` on an
# empty array is UNBOUND under `set -u` here, and this harness runs under -u.
DB_SELF_SKIP_PROOFS="$(node scripts/check-preflight-ci-parity.mjs --list-self-skipping-proofs 2>/dev/null | awk '{print $1}' | tr '\n' ' ')"
if [ -z "$(printf '%s' "$DB_SELF_SKIP_PROOFS" | tr -d '[:space:]')" ]; then
  echo "FATAL: derived 0 self-skipping proofs from scripts/src/*.ts." >&2
  echo "       node scripts/check-preflight-ci-parity.mjs --list-self-skipping-proofs returned nothing," >&2
  echo "       so the harness cannot tell a proof that ran from one that skipped itself and exited 0." >&2
  echo "       Refusing to run: every such proof would be counted PASSED." >&2
  exit 1
fi
echo "-- self-skipping proofs (derived, skipped unless DATABASE_URL is set):$DB_SELF_SKIP_PROOFS"

# TWO BUGS lived in the block below, and both were found by running this harness
# against PR #152 rather than by reading it. That branch adds proof:config-scope,
# which asserts REDIS_URL is UNSET so it can prove the in-memory path — the
# documented default deployment — is genuinely the one under test. It failed here
# while passing 58/58 in isolation. proof:device-resolver passed all 14 assertions
# and was then killed by the 200s alarm, because a dangling ioredis client kept
# retrying a dead endpoint and the process never exited.
#
# BUG 1 — REDIS_URL was `export`ed process-wide for ONE proof that needs it. Every
# other proof silently switched to a Redis path it was never written for. Redis is
# provisioned for proof:enrollment-race; it is now handed to that gate ALONE, and
# an ambient REDIS_URL is likewise confined to it rather than leaking into all ~110.
#
# BUG 2 — readiness was never actually established. The wait loop breaks on PONG,
# but falls through after 20 tries and exported REDIS_URL regardless, so a slow
# container yielded a URL pointing at nothing. Worse, `"$SG_ENGINE" exec redis-cli ping`
# tests the server from INSIDE the container, while every proof connects from the
# HOST through `-p 6381:6379` — and that port forwarding comes up strictly later
# than the server does. The probe could not observe what the proofs depend on.
# That is the whole reason device-resolver saw ECONNREFUSED on 6381 while
# enrollment-race, running later in the same suite, connected fine.
#
# Now the host port is probed, and the URL is set ONLY when a real connection
# succeeded. No connection → no URL → enrollment-race SKIPs loudly, which is the
# behaviour this block already promised for the no-Docker case.
SGVAL_REDIS_URL=""
if [ -n "${REDIS_URL:-}" ]; then
  # Someone set it deliberately. Honour it for the race proof, but do not let it
  # reach the other proofs — several are written for the no-Redis default and one
  # now asserts it.
  SGVAL_REDIS_URL="$REDIS_URL"
  unset REDIS_URL
  echo "-- using your REDIS_URL for proof:enrollment-race only (unset for the rest)"
elif { . "$(dirname "$0")/scripts/lib/container-engine.sh"; sg_resolve_engine; }; then
  "$SG_ENGINE" rm -f "$REDIS_CONTAINER" >/dev/null 2>&1
  if "$SG_ENGINE" run -d --name "$REDIS_CONTAINER" -p "$REDIS_PORT:6379" "$SG_IMAGE_REDIS" >/dev/null 2>&1; then
    trap '"$SG_ENGINE" rm -f "$REDIS_CONTAINER" >/dev/null 2>&1' EXIT
    for _ in $(seq 1 20); do
      if "$SG_ENGINE" exec "$REDIS_CONTAINER" redis-cli ping 2>/dev/null | grep -q PONG &&
         (exec 3<>"/dev/tcp/127.0.0.1/$REDIS_PORT") 2>/dev/null; then
        exec 3>&- 2>/dev/null
        SGVAL_REDIS_URL="redis://127.0.0.1:$REDIS_PORT"
        break
      fi
      sleep 1
    done
    if [ -n "$SGVAL_REDIS_URL" ]; then
      echo "-- started $REDIS_CONTAINER on $REDIS_PORT for proof:enrollment-race"
    else
      echo "-- $REDIS_CONTAINER never answered on 127.0.0.1:$REDIS_PORT; enrollment-race will SKIP"
    fi
  fi
fi

echo; echo "== real-life simulator scenarios =="
# The scenario count is DERIVED from the catalogue, not typed: this line said "11
# scenarios" by hand in the one file that derives WEB_ARTIFACTS from the filesystem
# to avoid exactly that (eighth audit round, 2026-09-05).
SIM_SCENARIOS="$(grep -c '^    id: "' lib/signalgrid-simulator/src/scenarios.ts 2>/dev/null || echo '?')"
gate "proof:signalgrid-simulator ($SIM_SCENARIOS scenarios)" $PNPM run proof:signalgrid-simulator
gate "proof:room-sim"                            $PNPM run proof:room-sim
gate "proof:signalgrid-core"                     $PNPM run proof:signalgrid-core
gate "proof:signalgrid-grid"                     $PNPM run proof:signalgrid-grid

if [ "$SIM_ONLY" != "--sim-only" ]; then
  echo; echo "== full CI-mirror proof suite =="
  for p in $(node -e "const s=require('./package.json').scripts;console.log(Object.keys(s).filter(k=>k.startsWith('proof:')&&!['proof:signalgrid-simulator','proof:room-sim','proof:signalgrid-core','proof:signalgrid-grid'].includes(k)).join(' '))"); do
    # The race proof needs a real shared store. With one, run it like any other
    # gate; without one, say so — an unrun proof is never a passed proof.
    if [ "$p" = "proof:enrollment-race" ]; then
      if [ -z "$SGVAL_REDIS_URL" ]; then
        skip "$p" "needs a reachable REDIS_URL (no container engine, or the container never answered); run it via pnpm run verify:docker"
        continue
      fi
      # Injected for THIS gate only — see the two bugs documented above.
      gate "$p" env REDIS_URL="$SGVAL_REDIS_URL" $PNPM run "$p"
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
    # proof:live-headwind reads a REAL Headwind CE (postgres + hmdm, amd64 under
    # emulation) and refuses (exit 3) without HMDM_URL — exactly like its live
    # siblings. It arrived in #256 without this guard, so the harness ran it,
    # took the refusal as a FAILURE, and reported "1 failed" on an otherwise
    # green tree — the every-proof enumerator meeting a proof it never satisfied,
    # the precise trap the Redis block above documents. Named as skipped with the
    # command to run it, never silently passed.
    if [ "$p" = "proof:live-headwind" ] && [ -z "${HMDM_URL:-}" ]; then
      skip "$p" "needs a live Headwind CE (HMDM_URL); run ./scripts/run-live-lanes.sh --only headwind"
      continue
    fi
    # proof:live-fleet-workflow drives the DECISION workflow from a live Fleet
    # host, and its flip section (FLEET_LAB_WRITE_OK=true) writes to that Fleet
    # — lab only. Same skip law: named, with the docs pointer, never silent.
    if [ "$p" = "proof:live-fleet-workflow" ] && [ -z "${FLEET_URL:-}" ]; then
      skip "$p" "needs a live Fleet (FLEET_URL + FLEET_TOKEN + FLEET_HOST_UUID); see docs/FLEET_LIVE_INTEGRATION.md"
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
    # proof:live-glpi joined after this guard block was written and never got its
    # row: with GLPI_URL unset the proof defaults to 127.0.0.1:8430 and exits 1
    # when nothing answers — which failed the hosted-runner rehearsal (Mac lane
    # run #8: 140 passed, 1 failed, and the 1 was this) on a VM that cannot host
    # a GLPI. Same skip law as the four above: named, with the pointer, never
    # silent. (proof:live-idp needs no row — it stands up its own server.)
    if [ "$p" = "proof:live-glpi" ] && [ -z "${GLPI_URL:-}" ]; then
      skip "$p" "needs a live GLPI (GLPI_URL); run ./scripts/run-live-lanes.sh --only glpi"
      continue
    fi
    # The self-skipping Postgres proofs (derived into DB_SELF_SKIP_PROOFS above).
    # Unlike every guard above, these do NOT refuse — they exit 0 — so without this
    # row the harness ran them and counted five unearned passes. With DATABASE_URL
    # set they run for real and fall through to `gate` like anything else.
    if [ -z "${DATABASE_URL:-}" ]; then
      case " $DB_SELF_SKIP_PROOFS " in
        *" $p "*)
          skip "$p" "self-skips without DATABASE_URL (it exits 0 having proven nothing); CI runs it against a real Postgres in the durable-persistence job"
          continue
          ;;
      esac
    fi
    gate "$p" $PNPM run "$p"
  done

  echo; echo "== non-proof gates =="
  gate "typecheck"            $PNPM run typecheck
  gate "build ($WEB_ARTIFACTS web artifacts)" $PNPM run build
  gate "test:api"             $PNPM run test:api
  gate "safety:check"         $PNPM run safety:check
  gate "docs:sanity"          $PNPM run docs:sanity
  gate "review:invariants"    $PNPM run review:invariants
  gate "lane:messages"        node scripts/check-lane-messages.mjs
fi

# Mail, printed unconditionally — including on --sim-only, and including when a
# gate above failed. This is the Mac lane's only inbox, and a message the other
# lane needs read is not less urgent because a build went red.
echo; echo "== lane inbox =="
node scripts/lane-message.mjs inbox || true

echo
if [ "$SIM_ONLY" = "--sim-only" ]; then
  # The mode is part of the verdict. This block used to print the full-suite
  # NOTE ("all N web artifacts build") and "Simulation validation GREEN" after
  # running four gates of the whole suite — a --sim-only run was indistinguishable
  # from a full one in its own last lines (eighth audit round, 2026-09-05).
  echo "== MODE: --sim-only — ONLY the four simulator gates above ran =="
  echo "   NOT run by this mode: the full proof:* suite, typecheck, the web build, test:api,"
  echo "   safety:check, docs:sanity, review:invariants, lane:messages. Nothing about them is verified here."
else
  echo "== NOTE: the web build now RUNS here (it used to be skipped) =="
  echo "   — the vite/rollup/lightningcss/tailwind darwin binaries this repo strips are"
  echo "     added to node_modules for the run, exactly as tsx's esbuild binary always"
  echo "     was. Nothing about the sources is linux-only; all $WEB_ARTIFACTS web artifacts build on arm64."
fi
echo
if [ "$SIM_ONLY" = "--sim-only" ]; then
  echo "== SUMMARY (--sim-only, partial): $pass passed, $fail failed, $SKIPPED skipped =="
else
  echo "== SUMMARY: $pass passed, $fail failed, $SKIPPED skipped =="
fi
if [ "$fail" -ne 0 ]; then echo "   failed:$failed_gates"; exit 1; fi
# A skip is not a pass. Green still means "nothing failed", but the skipped gates
# are named so a reader is never left believing the suite covered them.
if [ "$SKIPPED" -ne 0 ]; then
  echo "   skipped (NOT verified by this run):$skipped_gates"
  echo "✅ Nothing failed — but see the skipped gate(s) above."
  exit 0
fi
if [ "$SIM_ONLY" = "--sim-only" ]; then
  echo "✅ Simulator scenarios GREEN (--sim-only: the rest of the suite did NOT run)."
  exit 0
fi
echo "✅ Simulation validation GREEN."
