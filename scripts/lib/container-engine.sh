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
# Auto-detection prefers PODMAN (the chosen runtime); docker is tried next, so a
# machine that only has docker keeps working with no change.

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
  for _sg_e in podman docker; do
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
