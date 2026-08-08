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
# Auto-detection prefers docker so existing machines behave exactly as before; podman
# is picked up only when docker is absent or its daemon is not running.

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

# Images are named WITH their registry: podman refuses unqualified short names, and
# relying on an engine's implicit search list puts a supply-chain decision in host
# config instead of in the repo. Works identically on docker.
SG_IMAGE_REDIS="docker.io/library/redis:7"
SG_IMAGE_POSTGRES="docker.io/library/postgres:16"
SG_IMAGE_MYSQL="docker.io/library/mysql:8"
