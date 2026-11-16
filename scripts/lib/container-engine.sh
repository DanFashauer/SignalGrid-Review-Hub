# shellcheck shell=sh
# Shell twin of scripts/lib/container-engine.mjs. Same rules, same reasons — read
# that file's header for the full argument and for exactly what was and was not
# verified under podman.
#
#   . "$(dirname "$0")/lib/container-engine.sh"
#   if sg_resolve_engine; then "$SG_ENGINE" run ...; fi
#
# Sets SG_ENGINE and returns 0 on success; sets SG_ENGINE="" and returns 1 otherwise.
# CONTAINER_ENGINE is AUTHORITATIVE: if it names an engine that does not answer, this
# fails rather than quietly using the other one, because a caller who named an engine
# is making a claim about what is being tested.
#
# Auto-detection prefers DOCKER; podman is tried next, so a machine that only has
# podman keeps working with no change.
#
# FLIPPED 2026-09-09 (engine split adjudicated in the #555 ack: docker is the engine
# of record). The header said podman while the Mac's entire lab — every sg-* container,
# the Fleet stack, the live-vendor lanes — runs on docker, and scripts/mac/sg-stack.sh
# had to work AROUND this preference, noting that "a blind sg_resolve_engine would
# manage the empty podman and report the docker containers" as missing. A stated
# default that contradicts the running system is a lie the next reader has to discover.
#
# SAFE FOR THE PODMAN-ONLY LANE by construction: the loop below requires the engine to
# ANSWER (`version --format` must succeed), not merely to be installed, so a box where
# docker is absent or its daemon is dead falls through to podman exactly as before.
# That is the cloud sandbox, where docker cannot start at all.

sg_resolve_engine() {
  if [ -n "${CONTAINER_ENGINE:-}" ]; then
    if command -v "$CONTAINER_ENGINE" >/dev/null 2>&1 &&
      "$CONTAINER_ENGINE" version --format '{{.Server.Version}}' >/dev/null 2>&1; then
      SG_ENGINE="$CONTAINER_ENGINE"
      return 0
    fi
    SG_ENGINE=""
    return 1
  fi
  for _sg_e in docker podman; do
    if command -v "$_sg_e" >/dev/null 2>&1 &&
      "$_sg_e" version --format '{{.Server.Version}}' >/dev/null 2>&1; then
      SG_ENGINE="$_sg_e"
      return 0
    fi
  done
  SG_ENGINE=""
  return 1
}

# EXPORTED rather than shellcheck-disabled. This file is sourced, and $SG_ENGINE has 20
# external call sites (validate-sim-macos.sh, run-live-lanes.sh) that shellcheck cannot
# see — "export if used externally" is the warning's own suggested fix, and it is the
# honest one here: the variable really is part of this library's interface.
export SG_ENGINE

# Images are named WITH their registry: podman refuses unqualified short names, and
# relying on an engine's implicit search list puts a supply-chain decision in host
# config instead of in the repo. Works identically on docker.
#
# SC2034 is disabled for these because this file is SOURCED — the consumers are
# validate-sim-macos.sh and scripts/run-live-lanes.sh, and shellcheck cannot see a
# cross-file use. Verified rather than assumed: SG_IMAGE_REDIS has 2 external uses and
# SG_IMAGE_MYSQL has 1.
#
# `SG_IMAGE_POSTGRES` was here too and has been REMOVED: it had zero uses anywhere in
# the repository, so shellcheck was right about that one and a blanket disable would
# have buried a true finding under three false ones. Re-add it at the point of use if a
# Postgres lane ever spins its own container.
# shellcheck disable=SC2034
SG_IMAGE_REDIS="docker.io/library/redis:7"
# shellcheck disable=SC2034
SG_IMAGE_MYSQL="docker.io/library/mysql:8"

# Fleet is PINNED, and it is the one that most needed to be.
#
# `fleetdm/fleet:latest` was used here while mysql and redis beside it were pinned —
# exactly backwards. The proof asserts nothing about MySQL's or Redis's behaviour;
# it asserts a great deal about FLEET's, and docs/FLEET_LIVE_INTEGRATION.md records
# that those 30 assertions were established against **v4.89.2** specifically.
# Running the lane at `latest` meant a red result could be our regression OR
# upstream shipping a new Fleet on an unrelated Tuesday, with no way to tell the
# two apart from the failure alone.
#
# Checking whether the adapter still holds against a NEWER Fleet is real work and
# worth doing — but as a deliberate act, not as a side effect:
#
#   FLEET_IMAGE=docker.io/fleetdm/fleet:latest ./scripts/run-live-lanes.sh --only fleet
#
# shellcheck disable=SC2034
SG_IMAGE_FLEET="docker.io/fleetdm/fleet:v4.89.2"
# Same drift rule as Fleet: pinned so two runs of one commit run one agent,
# overridable for a deliberate compatibility check:
#
#   OSQUERY_IMAGE=docker.io/osquery/osquery:latest ./scripts/run-live-lanes.sh --only fleet
#
# Chosen the hard way: osquery's Docker Hub tags are VERSION-DISTRO pairs and
# lag the project badly — a bare "5.23.1" does not exist (a silent pull
# failure that cost a full lane run to notice), and :latest is osqueryd
# 4.9.0. This is the newest published tag; the lane re-verifies it live on
# every run — the enroll wait and the loud agent-start warning report a tag
# that cannot serve. The docs' "osqueryd 5.23.1" run of 2026-08-17 used the
# out-of-tree scratch harness, not this image.
# shellcheck disable=SC2034
SG_IMAGE_OSQUERY="docker.io/osquery/osquery:5.17.0-ubuntu24.04"
# 4.14.7, NOT 4.9.0, and the difference is not preference: 4.9.0 is published
# amd64-only, and under QEMU on Apple Silicon it does not run slowly — it DIES
# (segfault in wazuh-modulesd, no API, ever). 4.14.7 ships native arm64 and is
# up in seconds on both engines. Measured on the Mac lane 2026-08-21 (commit
# c22177e); do not "upgrade" this pin to an amd64-only tag without checking
# the manifest lists both architectures.
# shellcheck disable=SC2034
SG_IMAGE_WAZUH="docker.io/wazuh/wazuh-manager:4.14.7"

# Telemetry lane (opt-in, --with-telemetry). Contrib image because the
# prometheus receiver lives there; the lane's collector config allowlists
# exactly two pipeline components regardless of what the image ships
# (docs/METRIC_STANDARDS.md). Pinned like every other lane image; a pull
# failure is a SKIP with the reason, never a silent fallback to :latest.
# shellcheck disable=SC2034
SG_IMAGE_OTELCOL="docker.io/otel/opentelemetry-collector-contrib:0.116.1"
# shellcheck disable=SC2034
SG_IMAGE_PROMETHEUS="docker.io/prom/prometheus:v3.1.0"

# Headwind CE lane: the exact build the 2026-08-18 shape-check verified
# (5.30.3-os). Postgres re-enters here after its earlier removal-for-zero-uses:
# this is the use.
# shellcheck disable=SC2034
SG_IMAGE_HMDM="docker.io/headwindmdm/hmdm:0.1.5"
# shellcheck disable=SC2034
SG_IMAGE_POSTGRES="docker.io/library/postgres:16"

# --- self-test -----------------------------------------------------------------
# This file is normally SOURCED. Executed directly with --self-test it asserts its own
# rules, including the one it was just fixed for: THE HEADER MUST NAME THE ENGINE THE
# LOOP ACTUALLY TRIES FIRST. The stated preference and the code disagreed for weeks —
# nothing could catch that, because a comment is not executable. This makes it so.
#
#   sh scripts/lib/container-engine.sh --self-test
sg_engine_self_test() {
  _st_pass=0; _st_fail=0
  _st() { # name, condition-already-evaluated ("ok"/"no")
    if [ "$2" = "ok" ]; then printf "  ok   — %s\n" "$1"; _st_pass=$((_st_pass+1))
    else printf "  FAIL — %s\n" "$1"; _st_fail=$((_st_fail+1)); fi
  }

  # 1. DOC↔CODE PARITY. Both are read out of this file rather than restated here, so
  #    editing one without the other fails instead of drifting silently.
  _st_self="${0}"
  _st_stated=$(grep -m1 '^# Auto-detection prefers ' "$_st_self" | awk '{print tolower($4)}' | tr -d ';')
  _st_first=$(grep -m1 '^  for _sg_e in ' "$_st_self" | awk '{print $4}' | tr -d ';')
  [ -n "$_st_stated" ] && [ "$_st_stated" = "$_st_first" ] && _st_r=ok || _st_r=no
  _st "the header's stated preference ($_st_stated) is the engine the loop tries first ($_st_first)" "$_st_r"

  # 2. CONTAINER_ENGINE IS AUTHORITATIVE — a named engine that does not answer must
  #    FAIL, never quietly resolve to the other one. That silent fallback would launder
  #    a claim about what was tested.
  ( CONTAINER_ENGINE=sg_no_such_engine_zz; SG_ENGINE=""; sg_resolve_engine ) 2>/dev/null && _st_r=no || _st_r=ok
  _st "CONTAINER_ENGINE naming an absent engine FAILS rather than falling back" "$_st_r"

  # 3. Auto-detection resolves to an engine that genuinely answers on this machine.
  SG_ENGINE=""
  if ( unset CONTAINER_ENGINE; sg_resolve_engine ) 2>/dev/null; then
    ( unset CONTAINER_ENGINE; sg_resolve_engine; printf "  ..   resolved: %s\n" "$SG_ENGINE" )
    _st "auto-detection resolves an engine that answers version" ok
  else
    _st "auto-detection resolves an engine that answers version (none present — reported, not passed)" no
  fi

  printf "\nself-test %s (%s/%s)\n" "$([ $_st_fail -eq 0 ] && echo passed || echo FAILED)" "$_st_pass" "$((_st_pass+_st_fail))"
  [ $_st_fail -eq 0 ]
}

case "${1:-}" in --self-test) sg_engine_self_test; exit $? ;; esac
