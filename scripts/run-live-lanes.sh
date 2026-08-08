#!/usr/bin/env bash
# =============================================================================
# Run every LIVE-vendor lane in one command.
#
# Four proofs read real vendor software rather than fixtures. Each refuses
# without its server, and the macOS harness skips them BY NAME — correct, but it
# left the live evidence effectively unreachable: the bring-up steps lived in four
# different documents, each with its own docker incantation, so in practice the
# lanes were documented rather than run.
#
#   ./scripts/run-live-lanes.sh              # bring up what it can, run those lanes
#   ./scripts/run-live-lanes.sh --keep       # leave the containers running afterwards
#   ./scripts/run-live-lanes.sh --only fleet,keycloak
#
# Honest by construction: a lane whose stack could not be started is reported
# SKIPPED with the reason, never counted as passed, and the exit code is non-zero
# only if a lane that RAN failed. Provisioning failure is reported, not hidden —
# but it is also not a proof failure, and conflating the two would teach the reader
# to ignore both.
#
# Wazuh is deliberately NOT auto-provisioned: it is a ~2GB image and minutes of
# boot. It runs only if WAZUH_URL is already set, and says so otherwise.
# =============================================================================
set -uo pipefail
cd "$(dirname "$0")/.."

KEEP=0
ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --keep) KEEP=1 ;;
    --only) ONLY="${2:-}"; shift ;;
    *) echo "unknown flag: $1"; exit 2 ;;
  esac
  shift
done
wanted() { [ -z "$ONLY" ] && return 0; case ",$ONLY," in *",$1,"*) return 0 ;; *) return 1 ;; esac; }

PNPM=pnpm; command -v pnpm >/dev/null 2>&1 || PNPM="corepack pnpm@10.28.1"
pass=0; fail=0; skipped=0; failed_lanes=""; skipped_lanes=""
started=""

ok()   { printf "  \033[32mPASS\033[0m  %s\n" "$1"; pass=$((pass+1)); }
bad()  { printf "  \033[31mFAIL\033[0m  %s  (log: %s)\n" "$1" "$2"; fail=$((fail+1)); failed_lanes="$failed_lanes $1"; }
skip() { printf "  \033[33mSKIP\033[0m  %s  (%s)\n" "$1" "$2"; skipped=$((skipped+1)); skipped_lanes="$skipped_lanes $1"; }

# shellcheck source=lib/container-engine.sh
. "$(dirname "$0")/lib/container-engine.sh"
# Engine-agnostic: these are OCI images, so podman runs them as well as docker.
# Resolved ONCE here so every lane below reports and uses the same engine.
sg_resolve_engine || true
have_engine() { [ -n "${SG_ENGINE:-}" ]; }
wait_http() { # url  seconds
  local i=0
  until [ "$(curl -s -o /dev/null -w '%{http_code}' "$1" 2>/dev/null)" = "200" ]; do
    i=$((i+1)); [ "$i" -ge "$2" ] && return 1; sleep 1
  done
}

echo "== SignalGrid live-vendor lanes =="
have_engine || echo "   (no container engine available — only lanes whose env vars are already set can run)"

# ── Fleet ────────────────────────────────────────────────────────────────────
if wanted fleet; then
  if [ -n "${FLEET_URL:-}" ]; then
    :
  elif have_engine; then
    echo "-- bringing up Fleet (mysql + redis + fleet, amd64 under emulation)"
    "$SG_ENGINE" network create sg-fleetnet >/dev/null 2>&1
    "$SG_ENGINE" rm -f sg-fleet sg-fleet-mysql sg-fleet-redis >/dev/null 2>&1
    "$SG_ENGINE" run -d --name sg-fleet-mysql --network sg-fleetnet -e MYSQL_ROOT_PASSWORD=root \
      -e MYSQL_DATABASE=fleet -e MYSQL_USER=fleet -e MYSQL_PASSWORD=fleet "$SG_IMAGE_MYSQL" >/dev/null 2>&1
    "$SG_ENGINE" run -d --name sg-fleet-redis --network sg-fleetnet "$SG_IMAGE_REDIS" >/dev/null 2>&1
    for _ in $(seq 1 90); do "$SG_ENGINE" exec sg-fleet-mysql mysqladmin ping -ufleet -pfleet >/dev/null 2>&1 && break; sleep 2; done
    E="-e FLEET_MYSQL_ADDRESS=sg-fleet-mysql:3306 -e FLEET_MYSQL_DATABASE=fleet -e FLEET_MYSQL_USERNAME=fleet -e FLEET_MYSQL_PASSWORD=fleet -e FLEET_REDIS_ADDRESS=sg-fleet-redis:6379 -e FLEET_SERVER_TLS=false"
    "$SG_ENGINE" run --rm --platform linux/amd64 --network sg-fleetnet $E docker.io/fleetdm/fleet:latest fleet prepare db --no-prompt >/dev/null 2>&1
    "$SG_ENGINE" run -d --name sg-fleet --platform linux/amd64 --network sg-fleetnet -p 8412:8080 $E docker.io/fleetdm/fleet:latest fleet serve >/dev/null 2>&1
    if wait_http http://127.0.0.1:8412/healthz 120; then
      started="$started sg-fleet sg-fleet-mysql sg-fleet-redis"
      curl -s -X POST http://127.0.0.1:8412/api/v1/setup -H 'Content-Type: application/json' -d '{"admin":{"name":"SG","email":"sg@signalgrid.test","password":"SignalGrid!2026x","password_confirmation":"SignalGrid!2026x"},"org_info":{"org_name":"SG"},"server_url":"http://127.0.0.1:8412"}' >/dev/null 2>&1
      export FLEET_URL=http://127.0.0.1:8412
      export FLEET_TOKEN=$(curl -s -X POST $FLEET_URL/api/v1/fleet/login -H 'Content-Type: application/json' -d '{"email":"sg@signalgrid.test","password":"SignalGrid!2026x"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).token||'')}catch(e){console.log('')}})")
      SECRET=$(curl -s -H "Authorization: Bearer $FLEET_TOKEN" $FLEET_URL/api/v1/fleet/spec/enroll_secret | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).spec.secrets[0].secret)}catch(e){console.log('')}})")
      curl -s -X POST $FLEET_URL/api/v1/fleet/global/policies -H "Authorization: Bearer $FLEET_TOKEN" -H 'Content-Type: application/json' -d '{"name":"Disk encryption","query":"SELECT 1;","platform":"darwin"}' >/dev/null 2>&1
      curl -s -X POST $FLEET_URL/api/v1/osquery/enroll -H 'Content-Type: application/json' -d "{\"enroll_secret\":\"$SECRET\",\"host_identifier\":\"SG-TEST\",\"host_details\":{\"system_info\":{\"uuid\":\"11111111-2222-3333-4444-555555555555\",\"hostname\":\"sg\",\"hardware_serial\":\"SGTEST\"},\"os_version\":{\"name\":\"macOS\",\"platform\":\"darwin\"}}}" >/dev/null 2>&1
    fi
  fi
  if [ -n "${FLEET_URL:-}" ] && [ -n "${FLEET_TOKEN:-}" ]; then
    if $PNPM run proof:live-fleet >/tmp/live_fleet.log 2>&1; then ok "proof:live-fleet"; else bad "proof:live-fleet" /tmp/live_fleet.log; fi
  else
    skip "proof:live-fleet" "could not stand up Fleet (see docs/FLEET_LIVE_INTEGRATION.md)"
  fi
fi

# ── Traccar ──────────────────────────────────────────────────────────────────
if wanted location; then
  if [ -z "${TRACCAR_URL:-}" ] && have_engine; then
    echo "-- bringing up Traccar"
    "$SG_ENGINE" rm -f sg-traccar >/dev/null 2>&1
    "$SG_ENGINE" run -d --name sg-traccar -p 8482:8082 -p 5055:5055 docker.io/traccar/traccar:latest >/dev/null 2>&1
    if wait_http http://127.0.0.1:8482/api/server 120; then
      started="$started sg-traccar"
      curl -s -X POST http://127.0.0.1:8482/api/users -H 'Content-Type: application/json' \
        -d '{"name":"SG","email":"sg@signalgrid.test","password":"SignalGrid!2026x"}' >/dev/null 2>&1
      export TRACCAR_URL=http://127.0.0.1:8482 TRACCAR_USER=sg@signalgrid.test TRACCAR_PASS='SignalGrid!2026x'
    fi
  fi
  if [ -n "${TRACCAR_URL:-}" ]; then
    if $PNPM run proof:live-location >/tmp/live_location.log 2>&1; then ok "proof:live-location"; else bad "proof:live-location" /tmp/live_location.log; fi
  else
    skip "proof:live-location" "could not stand up Traccar (see docs/TRACCAR_LIVE_INTEGRATION.md)"
  fi
fi

# ── Keycloak ─────────────────────────────────────────────────────────────────
if wanted keycloak; then
  if [ -z "${KEYCLOAK_URL:-}" ] && have_engine; then
    echo "-- bringing up Keycloak (DPoP feature)"
    "$SG_ENGINE" rm -f sg-keycloak >/dev/null 2>&1
    "$SG_ENGINE" run -d --name sg-keycloak -p 8480:8080 -e KC_BOOTSTRAP_ADMIN_USERNAME=admin \
      -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin quay.io/keycloak/keycloak:26.4 start-dev --features=dpop >/dev/null 2>&1
    if wait_http http://127.0.0.1:8480/realms/master 180; then
      started="$started sg-keycloak"
      K=http://127.0.0.1:8480
      AT=$(curl -s -X POST "$K/realms/master/protocol/openid-connect/token" -d client_id=admin-cli -d username=admin -d password=admin -d grant_type=password | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).access_token)}catch(e){console.log('')}})")
      curl -s -X POST "$K/admin/realms/master/clients" -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' \
        -d '{"clientId":"sg-dpop","publicClient":false,"serviceAccountsEnabled":true,"standardFlowEnabled":false,"secret":"sg-dpop-secret","attributes":{"dpop.bound.access.tokens":"true"}}' >/dev/null 2>&1
      CID=$(curl -s "$K/admin/realms/master/clients?clientId=sg-dpop" -H "Authorization: Bearer $AT" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d)[0].id)}catch(e){console.log('')}})")
      if [ -n "$CID" ]; then
        curl -s -X POST "$K/admin/realms/master/clients/$CID/protocol-mappers/models" -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' \
          -d '{"name":"tenant-id","protocol":"openid-connect","protocolMapper":"oidc-hardcoded-claim-mapper","config":{"claim.name":"tid","claim.value":"master","jsonType.label":"String","access.token.claim":"true"}}' >/dev/null 2>&1
        curl -s -X POST "$K/admin/realms/master/clients/$CID/protocol-mappers/models" -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' \
          -d '{"name":"roles-claim","protocol":"openid-connect","protocolMapper":"oidc-hardcoded-claim-mapper","config":{"claim.name":"roles","claim.value":"service","jsonType.label":"String","access.token.claim":"true"}}' >/dev/null 2>&1
        export KEYCLOAK_URL=$K
      fi
    fi
  fi
  if [ -n "${KEYCLOAK_URL:-}" ]; then
    if $PNPM run proof:live-keycloak >/tmp/live_keycloak.log 2>&1; then ok "proof:live-keycloak"; else bad "proof:live-keycloak" /tmp/live_keycloak.log; fi
  else
    skip "proof:live-keycloak" "could not stand up Keycloak (see docs/KEYCLOAK_LIVE_INTEGRATION.md)"
  fi
fi

# ── Wazuh — never auto-provisioned ───────────────────────────────────────────
if wanted edr; then
  if [ -n "${WAZUH_URL:-}" ]; then
    if $PNPM run proof:live-edr >/tmp/live_edr.log 2>&1; then ok "proof:live-edr"; else bad "proof:live-edr" /tmp/live_edr.log; fi
  else
    skip "proof:live-edr" "needs WAZUH_URL — a ~2GB image and minutes of boot, so this script never starts it for you"
  fi
fi

if [ "$KEEP" -eq 0 ] && [ -n "$started" ]; then
  echo; echo "-- removing containers this run started:$started"
  # shellcheck disable=SC2086
  "$SG_ENGINE" rm -f $started >/dev/null 2>&1
  "$SG_ENGINE" network rm sg-fleetnet >/dev/null 2>&1
else
  [ -n "$started" ] && echo "-- leaving running (--keep):$started"
fi

echo
echo "== LIVE LANES: $pass passed, $fail failed, $skipped skipped =="
[ "$fail" -ne 0 ] && { echo "   failed:$failed_lanes"; exit 1; }
if [ "$skipped" -ne 0 ]; then
  echo "   skipped (NOT verified by this run):$skipped_lanes"
  echo "✅ Nothing failed — but a skipped lane proved nothing."
  exit 0
fi
echo "✅ Every live lane ran and passed."
