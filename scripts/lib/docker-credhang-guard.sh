# shellcheck shell=sh
# docker-credhang-guard — stop Docker Desktop's credential helper from hanging a
# headless image pull.
#
#   . scripts/lib/docker-credhang-guard.sh
#   sg_guard_docker_credhang
#
# WHY. Docker Desktop writes `"credsStore": "desktop"` into ~/.docker/config.json.
# On a `docker pull`/`run` that must fetch an image, docker calls that helper to get
# registry credentials; the helper wants a GUI/Keychain prompt, and from a headless
# shell (a Claude session, launchd, ssh, CI without a TTY) there is nothing to answer
# it, so the command HANGS instead of failing. This is the "won't run the
# image/container" symptom: the run never errors, it just never returns.
#
# THE FIX, and why it is safe. The SignalGrid lab images are all public
# (docker.io/library/*, quay.io/keycloak, fleetdm, glpi, wazuh) and need no registry
# login, so docker needs no credential helper for them. Pointing DOCKER_CONFIG at a
# directory whose config.json is `{}` means "no helper configured" — pulls proceed
# with anonymous access and never block on a prompt.
#
# GUARDED so it changes nothing it should not:
#   · if the caller already set DOCKER_CONFIG, that wins (never overridden);
#   · if there is no ~/.docker/config.json, or its credsStore is not "desktop"
#     (Linux CI, podman, a machine without Docker Desktop), it does nothing;
#   · it only ever POINTS AWAY from the helper — it never edits the real config, so
#     `docker login` for real registries elsewhere is untouched.
sg_guard_docker_credhang() {
  [ -n "${DOCKER_CONFIG:-}" ] && return 0
  [ -f "${HOME}/.docker/config.json" ] || return 0
  grep -q '"credsStore"[[:space:]]*:[[:space:]]*"desktop"' "${HOME}/.docker/config.json" 2>/dev/null || return 0
  DOCKER_CONFIG="${HOME}/.sg-docker-nohelper"
  export DOCKER_CONFIG
  mkdir -p "$DOCKER_CONFIG"
  [ -f "$DOCKER_CONFIG/config.json" ] || printf '{}\n' > "$DOCKER_CONFIG/config.json"
}
