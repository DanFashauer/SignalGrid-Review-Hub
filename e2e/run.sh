#!/usr/bin/env bash
# Full-stack web E2E runner: build + serve the api-server and all 5 consoles, then
# run the Playwright suite against them, then tear everything down.
#
#   cd e2e && ./run.sh
#
# Works on macOS/arm64 and Linux (x64/arm64). The repo's pnpm-workspace.yaml strips
# native build binaries to linux-x64; on other hosts we add the matching variant
# back for the vite build and revert the manifest churn on exit (same trick as
# ../validate-sim-macos.sh).
set -uo pipefail
cd "$(dirname "$0")/.."          # repo root
ROOT="$PWD"
API=5174; ADMIN=5173; USER=5180; PWA=5181; DESK=5182; WEB=5183
PIDS=()
# `lsof -ti tcp:PORT` silently misses IPv6 `*:PORT` listeners, which let stale
# servers survive cleanup and shadow the next run against the wrong CORS config.
# -nP -iTCP:PORT -sTCP:LISTEN matches both families.
free_ports() {
  for port in "$@"; do
    lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | xargs kill -9 2>/dev/null || true
  done
}
cleanup() {
  for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done
  free_ports $API $ADMIN $USER $PWA $DESK $WEB
  git checkout package.json pnpm-lock.yaml 2>/dev/null || true
}
trap cleanup EXIT

# Clear anything already holding our ports BEFORE starting, so a leftover server
# can't serve the tests instead of the one this run configures.
free_ports $API $ADMIN $USER $PWA $DESK $WEB
sleep 1

command -v pnpm >/dev/null 2>&1 && PNPM=pnpm || PNPM="corepack pnpm@10.28.1"

# -- add host-native build binaries the workspace overrides strip -----------------
OS=$(uname -s | tr 'A-Z' 'a-z'); ARCH=$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/')
ver() { ls node_modules/.pnpm 2>/dev/null | grep -oE "$1@[0-9.]+" | head -1 | sed 's/.*@//'; }
if [ "$OS" != "linux" ] || [ "$ARCH" != "x64" ]; then
  SUF=""; [ "$OS" = "linux" ] && SUF="-gnu"
  echo "== adding $OS-$ARCH native build binaries =="
  $PNPM add -w --save-optional \
    "@rollup/rollup-$OS-$ARCH$SUF@$(ver rollup)" \
    "lightningcss-$OS-$ARCH$SUF@$(ver lightningcss)" \
    "@tailwindcss/oxide-$OS-$ARCH$SUF@$(ver '@tailwindcss\+oxide')" \
    "@esbuild/$OS-$ARCH@$(ver esbuild)" >/dev/null 2>&1 || echo "  (add reported an issue; continuing)"
fi

# -- build the api-server + consoles ----------------------------------------------
echo "== build api-server =="
$PNPM --filter @workspace/api-server run build >/dev/null 2>&1 || { echo "api-server build failed"; exit 1; }
echo "== build consoles =="
VITE_API_BASE_URL="http://127.0.0.1:$API" $PNPM --filter @workspace/signalgrid-app --filter @workspace/signalgrid-desktop --filter @workspace/signalgrid-mobile-pwa run build >/dev/null 2>&1 || { echo "live console build failed"; exit 1; }
$PNPM --filter @workspace/signalgrid-review --filter @workspace/signalgrid-web run build >/dev/null 2>&1 || { echo "static console build failed"; exit 1; }

# -- start api-server (CORS) + serve consoles -------------------------------------
echo "== start servers =="
( cd artifacts/api-server && CORS_ALLOWED_ORIGINS="http://127.0.0.1:$USER,http://127.0.0.1:$PWA,http://127.0.0.1:$DESK" PORT=$API node dist/index.mjs >/tmp/e2e-api.log 2>&1 ) & PIDS+=($!)
( cd artifacts/signalgrid-app && $PNPM run serve --port $USER >/tmp/e2e-user.log 2>&1 ) & PIDS+=($!)
( cd artifacts/signalgrid-mobile-pwa && $PNPM run serve --port $PWA >/tmp/e2e-pwa.log 2>&1 ) & PIDS+=($!)
( cd artifacts/signalgrid-desktop && $PNPM run serve --port $DESK >/tmp/e2e-desk.log 2>&1 ) & PIDS+=($!)
( cd artifacts/signalgrid-review && $PNPM run serve --port $ADMIN >/tmp/e2e-admin.log 2>&1 ) & PIDS+=($!)
( cd artifacts/signalgrid-web && $PNPM run serve --port $WEB >/tmp/e2e-web.log 2>&1 ) & PIDS+=($!)

echo "== wait for readiness =="
for port in $API $USER $PWA $DESK $ADMIN $WEB; do
  for i in $(seq 1 30); do [ "$(curl -s -o /dev/null -w %{http_code} http://127.0.0.1:$port/ 2>/dev/null)" = "200" ] && break; sleep 1; done
done

# -- run Playwright ---------------------------------------------------------------
cd "$ROOT/e2e"
[ -d node_modules/@playwright ] || npm install >/dev/null 2>&1
# On Linux (CI) also pull the browser's system libraries; on macOS they're built in.
if [ "$OS" = "linux" ]; then
  npx playwright install --with-deps chromium >/dev/null 2>&1 || npx playwright install chromium >/dev/null 2>&1
else
  npx playwright install chromium >/dev/null 2>&1
fi
echo "== run e2e =="
npx playwright test
