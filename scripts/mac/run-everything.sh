#!/usr/bin/env bash
# =============================================================================
# SignalGrid — run EVERYTHING on a Mac, one command.
#
#   ./scripts/mac/run-everything.sh              # full: proofs → API → MCP → iOS sim
#   ./scripts/mac/run-everything.sh --fast       # sim scenarios only in the proof phase
#   ./scripts/mac/run-everything.sh --no-ios     # skip the iOS simulator phase
#   ./scripts/mac/run-everything.sh --keep-up    # leave the API + console running after
#   ./scripts/mac/run-everything.sh --plan       # print what would run, run nothing
#
# WHAT THIS COVERS, and what it honestly cannot:
#   proofs   — the full deterministic suite CI runs (validate-sim-macos.sh)
#   api      — the real /v1 decision API, built and exercised end-to-end (test:api)
#   mcp      — the SignalGrid MCP server, spoken to over real JSON-RPC exactly the
#              way Claude Desktop would; tools listed live, one tool invoked
#   ios      — EnterpriseShell in the iOS Simulator with MIMICKED HARDWARE: the
#              badge reader, kiosk state and demo signals are injected via
#              DemoMode launch flags. A simulator cannot be MDM-enrolled and no
#              real reader is attached — that is the platform-honesty boundary,
#              stated rather than papered over. Real-hardware custody (SmartDock,
#              RFID case) stays fixture-backed in the proofs phase.
#
# Every phase reports PASS / FAIL / SKIPPED(reason). Exits non-zero if any phase
# that RAN failed. No silent success.
# =============================================================================
set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT" || { echo "cannot enter $REPO_ROOT" >&2; exit 1; }

FAST=0; NO_IOS=0; KEEP_UP=0; PLAN=0
for arg in "$@"; do
  case "$arg" in
    --fast) FAST=1 ;;
    --no-ios) NO_IOS=1 ;;
    --keep-up) KEEP_UP=1 ;;
    --plan) PLAN=1 ;;
    *) echo "unknown flag: $arg (known: --fast --no-ios --keep-up --plan)"; exit 2 ;;
  esac
done

declare -a RESULTS=()
FAILED=0

say()  { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
note() { printf '   %s\n' "$*"; }

record() { # phase status detail
  RESULTS+=("$1|$2|$3")
  [ "$2" = "FAIL" ] && FAILED=1
  return 0
}

if [ "$PLAN" = "1" ]; then
  cat <<'EOF'
Plan (nothing will run):
  1. prereqs — verify node >= 20, pnpm (or corepack), and whether Xcode tooling
     (xcodebuild + xcodegen) is present. Missing Xcode only skips the ios phase.
  2. proofs  — ./validate-sim-macos.sh  (or --sim-only with --fast). The full
     deterministic gate suite CI runs, natively. Prints "== SUMMARY: N passed,
     M failed ==" — M must be 0.
  3. api     — pnpm --filter @workspace/api-server run test:api. Builds the real
     api-server and exercises the /v1 surface end to end; prints N/N assertions.
  4. mcp     — builds artifacts/mcp-server, then speaks real JSON-RPC to it over
     stdio (initialize → tools/list → one signal_catalog call), exactly the
     handshake Claude Desktop performs. Prints the live tool list and the
     claude_desktop_config.json snippet to wire it into Claude on this Mac.
  5. ios     — cd native/ios && xcodegen generate && xcodebuild EnterpriseShell
     for the iPhone simulator, boot it, install, and launch with mimicked
     hardware: -DemoMode YES -SimulateBadge 04A3F291 (badge reader + kiosk flow
     with no physical reader). Skipped cleanly if Xcode tooling is absent.
Summary table at the end; non-zero exit if any phase that ran failed.
EOF
  exit 0
fi

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This runner is for a Mac. On Linux/CI use: pnpm run preflight (the same gates,"
  echo "minus the macOS-native and iOS-simulator phases). Refusing rather than half-running."
  exit 2
fi

# ── 1. prereqs ────────────────────────────────────────────────────────────────
say "1/5 prereqs"
PREREQ_OK=1
if command -v node >/dev/null 2>&1; then
  note "node $(node -v)"
else
  note "node MISSING — install Node 22 (https://nodejs.org) and re-run"; PREREQ_OK=0
fi
if command -v pnpm >/dev/null 2>&1; then
  note "pnpm $(pnpm -v)"
elif command -v corepack >/dev/null 2>&1; then
  note "pnpm via corepack (enabling)"; corepack enable >/dev/null 2>&1 || true
else
  note "pnpm MISSING — 'npm i -g pnpm' or enable corepack"; PREREQ_OK=0
fi
XCODE_OK=1
command -v xcodebuild >/dev/null 2>&1 || XCODE_OK=0
command -v xcodegen  >/dev/null 2>&1 || XCODE_OK=0
if [ "$XCODE_OK" = "1" ]; then note "Xcode tooling present (xcodebuild + xcodegen)"; else note "Xcode tooling absent — ios phase will be SKIPPED (brew install xcodegen; Xcode from the App Store)"; fi
if [ "$PREREQ_OK" = "1" ]; then record prereqs PASS "node + pnpm ready"; else record prereqs FAIL "missing core tooling — see notes above"; fi

# ── 2. proofs ─────────────────────────────────────────────────────────────────
say "2/5 proofs (the suite CI runs, natively)"
if [ "$PREREQ_OK" = "1" ]; then
  if [ "$FAST" = "1" ]; then PROOF_ARGS=(--sim-only); else PROOF_ARGS=(); fi
  # Guarded expansion: under `set -u`, bash 3.2 (the only bash on a stock Mac)
  # treats an EMPTY array's "${a[@]}" as unbound and aborts. Without --fast
  # PROOF_ARGS is empty, so a plain full run died here before any proof ran.
  # Same ${var+...} form used in scripts/cleanup-merged-branches.sh.
  if ./validate-sim-macos.sh ${PROOF_ARGS+"${PROOF_ARGS[@]}"}; then
    record proofs PASS "validate-sim-macos.sh${FAST:+ }$([ "$FAST" = "1" ] && echo '(--sim-only)') green"
  else
    record proofs FAIL "validate-sim-macos.sh reported failures — its SUMMARY line above names them"
  fi
else
  record proofs SKIPPED "prereqs failed"
fi

# ── 3. api ────────────────────────────────────────────────────────────────────
say "3/5 api (/v1 decision surface, end to end)"
if [ "$PREREQ_OK" = "1" ]; then
  if pnpm --filter @workspace/api-server run test:api; then
    record api PASS "test:api green (the N/N line above is the count)"
  else
    record api FAIL "test:api failed — the first failing assertion is named above"
  fi
else
  record api SKIPPED "prereqs failed"
fi

# ── 4. mcp ────────────────────────────────────────────────────────────────────
say "4/5 mcp (the server Claude Desktop would talk to, spoken to for real)"
if [ "$PREREQ_OK" = "1" ]; then
  if pnpm --filter @workspace/mcp-server run build >/dev/null 2>&1 \
     && node - <<'NODE'
const { spawn } = require("node:child_process");
const path = require("node:path");
const srv = spawn("node", [path.join("artifacts", "mcp-server", "dist", "index.mjs")], { stdio: ["pipe", "pipe", "inherit"] });
const send = (obj) => srv.stdin.write(JSON.stringify(obj) + "\n");
let buf = ""; const replies = [];
const done = new Promise((resolveDone, reject) => {
  const timer = setTimeout(() => reject(new Error("mcp: no reply within 20s")), 20000);
  srv.stdout.on("data", (d) => {
    buf += d.toString();
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx); buf = buf.slice(idx + 1);
      if (!line.trim()) continue;
      try { replies.push(JSON.parse(line)); } catch { continue; }
      if (replies.length >= 3) { clearTimeout(timer); resolveDone(null); }
    }
  });
  srv.on("error", reject);
});
send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "run-everything", version: "0" } } });
send({ jsonrpc: "2.0", method: "notifications/initialized" });
send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "signal_catalog", arguments: {} } });
done.then(() => {
  const tools = replies.find((r) => r.id === 2)?.result?.tools ?? [];
  const call = replies.find((r) => r.id === 3);
  console.log(`   live tools (${tools.length}): ${tools.map((t) => t.name).join(", ")}`);
  if (tools.length === 0) throw new Error("mcp: tools/list returned nothing");
  if (!call?.result) throw new Error("mcp: signal_catalog call returned no result");
  console.log("   signal_catalog answered — the fabric is reachable over MCP");
  srv.kill(); process.exit(0);
}).catch((err) => { console.error(`   ${err.message}`); srv.kill(); process.exit(1); });
NODE
  then
    record mcp PASS "initialize → tools/list → signal_catalog all answered over stdio"
    note "wire it into Claude Desktop — add to claude_desktop_config.json"
    note "(the mcp-up.sh launcher self-updates on every Claude Desktop restart):"
    note '  { "mcpServers": { "signalgrid": { "command": "/bin/bash",'
    note "      \"args\": [\"$REPO_ROOT/scripts/mac/mcp-up.sh\"] } } }"
    note "then restart Claude Desktop and ask it to evaluate a room-entry scenario."
  else
    record mcp FAIL "MCP handshake failed — output above says which step"
  fi
else
  record mcp SKIPPED "prereqs failed"
fi

# ── 5. ios (mimicked hardware) ────────────────────────────────────────────────
say "5/5 ios simulator (badge reader + kiosk, hardware mimicked via DemoMode)"
if [ "$NO_IOS" = "1" ]; then
  record ios SKIPPED "--no-ios"
elif [ "$XCODE_OK" != "1" ]; then
  record ios SKIPPED "Xcode tooling absent"
else
  IOS_OK=1
  ( cd native/ios && xcodegen generate ) || IOS_OK=0
  if [ "$IOS_OK" = "1" ]; then
    ( cd native/ios && xcodebuild -scheme EnterpriseShell -sdk iphonesimulator \
        -destination 'platform=iOS Simulator,name=iPhone 17' \
        -derivedDataPath build build ) || IOS_OK=0
  fi
  if [ "$IOS_OK" = "1" ]; then
    xcrun simctl boot "iPhone 17" >/dev/null 2>&1 || true   # already booted is fine
    open -a Simulator || true
    APP_PATH="native/ios/build/Build/Products/Debug-iphonesimulator/EnterpriseShell.app"
    xcrun simctl install booted "$APP_PATH" || IOS_OK=0
  fi
  if [ "$IOS_OK" = "1" ]; then
    # THE HARDWARE MIMICRY: no reader case is attached, so the badge scan, kiosk
    # gate and demo signals are injected as launch arguments. DemoMode.swift is
    # the honest boundary — simulator-only, and it says so in its own header.
    xcrun simctl launch booted com.enterprise.shell -DemoMode YES -SimulateBadge 04A3F291 || IOS_OK=0
  fi
  if [ "$IOS_OK" = "1" ]; then
    record ios PASS "EnterpriseShell running in the simulator with an injected badge scan"
    note "more mimicry flags (see DemoMode.swift): -DemoUnenrolled, -DemoAssist,"
    note "-DemoAssistAuto, -DemoIdleLock, -DemoBackendURL http://localhost:8080"
  else
    record ios FAIL "one of generate/build/install/launch failed — the xcodebuild output above names it"
  fi
fi

# ── keep-up ───────────────────────────────────────────────────────────────────
if [ "$KEEP_UP" = "1" ] && [ "$PREREQ_OK" = "1" ]; then
  say "keeping the API + console up (--keep-up)"
  note "starting api-server on :8080 in the background — Ctrl-C when done"
  ( pnpm --filter @workspace/api-server run start & ) || true
  note "console: open docs/RUN_ON_MAC.md 'operator console' section for the UI steps"
fi

# ── summary ───────────────────────────────────────────────────────────────────
say "SUMMARY"
for row in "${RESULTS[@]}"; do
  IFS='|' read -r phase status detail <<<"$row"
  printf '   %-8s %-8s %s\n' "$phase" "$status" "$detail"
done
if [ "$FAILED" = "1" ]; then
  echo; echo "At least one phase that RAN failed — the details above name it. No silent success."
  exit 1
fi
echo; echo "Everything that ran is green."
