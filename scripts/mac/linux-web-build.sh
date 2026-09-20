#!/bin/bash
# linux-web-build.sh — run the vite web build (`pnpm run build`) on this Mac,
# inside an amd64 Linux VM using Apple's `container`, with nobody at the keyboard.
#
# Why: pnpm-workspace.yaml's overrides keep only the linux-x64-gnu native binaries,
# so the build cannot run natively on arm64 macOS — and `--arch arm64` Linux fails
# on the rolldown binding for the same reason. amd64 under Rosetta works (measured
# 2026-09-18, exit 0 in ~55 s; see the Apple row in docs/agent/RESOURCE_INTAKE.md).
#
# Install is USER-LEVEL, no admin step: Apple's signed + notarized
# container-1.4.1-installer-signed.pkg (sha256 c0d2716a…a6a4) unpacked with
# `pkgutil --expand-full` into ~/.local/container. The service is not registered
# to survive a reboot, so this script starts it when it is down.
#
# The checkout is mounted READ-ONLY and copied inside the VM: nothing is written
# into the tree (sim-result provenance counts untracked files).
#
# Usage: bash scripts/mac/linux-web-build.sh        exit code = the build's
set -eu

C="${SG_CONTAINER_BIN:-$HOME/.local/container/bin/container}"
ROOT="$HOME/.local/container"
DATA="$HOME/.local/share/container"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"

if [ ! -x "$C" ]; then
  echo "linux-web-build: $C not found — unpack Apple's container pkg into $ROOT (see header)" >&2
  exit 2
fi

# The binary must be invoked by its real path, never a symlink: through a link,
# `system start` fails with "No such file or directory".
# Match the status ROW: the stopped message is "apiserver is not running", which a
# bare grep for "running" reads as up.
if ! "$C" system status 2>/dev/null | grep -qE '^status[[:space:]]+running'; then
  mkdir -p "$DATA/app" "$DATA/logs"
  "$C" system start --install-root "$ROOT" --app-root "$DATA/app" \
    --log-root "$DATA/logs" --enable-kernel-install --timeout 300
fi

exec "$C" run --rm --arch amd64 -c 6 -m 12g \
  --mount "type=bind,source=$REPO,target=/src,readonly" \
  node:22 bash -c '
    set -e
    mkdir /tmp/w && cd /src
    tar --exclude=.git --exclude=node_modules -cf - . | tar -C /tmp/w -xf -
    cd /tmp/w && corepack enable
    pnpm install --frozen-lockfile
    pnpm run build
  '
