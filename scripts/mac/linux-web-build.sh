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
# Usage: bash scripts/mac/linux-web-build.sh                      build only; exit code = the build's
#        bash scripts/mac/linux-web-build.sh --e2e                build + Playwright chromium + the
#                                                                 Browser E2E suite, inside the VM
#        bash scripts/mac/linux-web-build.sh --e2e --attest <path> ...and on success write a
#                                                                 native-build ATTESTATION (JSON) at
#                                                                 <path> (outside the tree), bound to
#                                                                 this checkout's HEAD sha and clean
#                                                                 state at launch; verify-all reads it
#                                                                 (scripts/lib/native-build-attestation.mjs)
set -eu

E2E=0
ATTEST=""
while [ $# -gt 0 ]; do
  case "$1" in
    --e2e) E2E=1 ;;
    --attest) shift; ATTEST="${1:?--attest needs a path}" ;;
    *) echo "linux-web-build: unknown flag $1 (known: --e2e, --attest <path>)" >&2; exit 2 ;;
  esac
  shift
done

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

# The attestation binds to the tree AS LAUNCHED: sample HEAD and cleanliness (untracked
# included — the same rule sim-result provenance uses) BEFORE the VM starts, on the host,
# because the copy inside the VM excludes .git. A dirty tree still builds, but attests nothing.
TREE_SHA="$(git -C "$REPO" rev-parse HEAD 2>/dev/null || echo unknown)"
if [ -z "$(git -C "$REPO" status --porcelain 2>/dev/null)" ]; then TREE_CLEAN=true; else TREE_CLEAN=false; fi
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# --e2e: the same steps the Linux CI job runs — install the pinned Playwright chromium and
# its apt deps inside the VM (node:22 runs as root; the download is Playwright's own CDN,
# the one network fetch beyond the registry install), build every package, then the E2E
# suite with CI=1 so no stray local server is reused.
VM_SCRIPT='
    set -eo pipefail
    mkdir /tmp/w && cd /src
    tar --exclude=.git --exclude=node_modules -cf - . | tar -C /tmp/w -xf -
    cd /tmp/w && corepack enable
    pnpm install --frozen-lockfile
'
if [ "$E2E" = "1" ]; then
  VM_SCRIPT="$VM_SCRIPT
    pnpm --filter @workspace/scripts exec playwright install --with-deps chromium
    pnpm run build
    CI=1 pnpm --filter @workspace/scripts run test:e2e
"
else
  VM_SCRIPT="$VM_SCRIPT
    pnpm run build
"
fi

set +e
"$C" run --rm --arch amd64 -c 6 -m 12g \
  --mount "type=bind,source=$REPO,target=/src,readonly" \
  node:22 bash -c "$VM_SCRIPT"
RC=$?
set -e

if [ -n "$ATTEST" ]; then
  if [ "$RC" = "0" ] && [ "$E2E" = "1" ]; then
    # Written by node so the JSON is well-formed whatever the sha/paths contain. Only a
    # FULL green --e2e run attests, and only for the two steps the VM actually ran.
    TREE_SHA="$TREE_SHA" TREE_CLEAN="$TREE_CLEAN" STARTED_AT="$STARTED_AT" ATTEST="$ATTEST" node -e '
      const fs = require("node:fs");
      fs.writeFileSync(process.env.ATTEST, JSON.stringify({
        schema: "signalgrid-native-build-attestation/v1",
        status: "passed",
        treeSha: process.env.TREE_SHA,
        treeClean: process.env.TREE_CLEAN === "true",
        steps: ["Build (all packages)", "Browser E2E (review console, website, admin)"],
        startedAt: process.env.STARTED_AT,
        ranAt: new Date().toISOString(),
        runner: { kind: "apple-container", arch: "amd64", image: "node:22", host: "darwin" },
      }, null, 2) + "\n");
    '
    echo "linux-web-build: attestation written to $ATTEST (tree $TREE_SHA, clean=$TREE_CLEAN)"
  else
    rm -f "$ATTEST"
    echo "linux-web-build: NO attestation (exit $RC, e2e=$E2E) — nothing is recorded for a run that did not fully pass"
  fi
fi
exit $RC
