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
cd "$(dirname "$0")/.." || { echo "cannot enter repo root" >&2; exit 1; }

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
wait_http() { # url  seconds   (honours WAIT_CACERT for self-signed lab TLS)
  local i=0
  until [ "$(curl -s ${WAIT_CACERT:+--cacert "$WAIT_CACERT"} -o /dev/null -w '%{http_code}' "$1" 2>/dev/null)" = "200" ]; do
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
    echo "-- bringing up Fleet (mysql + redis + fleet + osqueryd, amd64 under emulation)"
    "$SG_ENGINE" network create sg-fleetnet >/dev/null 2>&1
    "$SG_ENGINE" rm -f sg-fleet sg-fleet-mysql sg-fleet-redis sg-osquery >/dev/null 2>&1
    "$SG_ENGINE" run -d --name sg-fleet-mysql --network sg-fleetnet -e MYSQL_ROOT_PASSWORD=root \
      -e MYSQL_DATABASE=fleet -e MYSQL_USER=fleet -e MYSQL_PASSWORD=fleet "$SG_IMAGE_MYSQL" >/dev/null 2>&1
    "$SG_ENGINE" run -d --name sg-fleet-redis --network sg-fleetnet "$SG_IMAGE_REDIS" >/dev/null 2>&1
    for _ in $(seq 1 90); do "$SG_ENGINE" exec sg-fleet-mysql mysqladmin ping -ufleet -pfleet >/dev/null 2>&1 && break; sleep 2; done
    # TLS is forced by the REAL AGENT below: osquery's remote plugins (enroll,
    # config, logger, distributed) are TLS-only — there is no plain-http mode —
    # and without a live agent nothing ever answers a distributed campaign, so
    # the collector assertions added 2026-08-17 could never pass (the Mac lane
    # proved this at 33/37). Self-signed, minted per run, discarded with the
    # run; trusted EXPLICITLY at every client (curl --cacert, the proof via
    # NODE_EXTRA_CA_CERTS, osqueryd via --tls_server_certs) — verification is
    # never disabled anywhere.
    # Under $HOME, not bare mktemp: on the Mac lane, podman machine only shares
    # the home directory into its Linux VM, and a default mktemp dir lives in
    # /var/folders — a bind mount from there would arrive EMPTY in the VM and
    # Fleet would never see its cert. $HOME works on both engines.
    FLEET_TLS_DIR=$(mktemp -d "$HOME/.sg-fleet-lab.XXXXXX")
    # Captured HERE, before any branch can fail: the restore below must know
    # the caller's original trust bundle even when Fleet never becomes
    # healthy — restoring "empty" after a failed bring-up would unset a
    # bundle this script never replaced.
    SAVED_NODE_CA="${NODE_EXTRA_CA_CERTS:-}"
    NODE_CA_REPLACED=0
    # Registered the moment the directory exists: an interrupted run must not
    # leave the (deliberately world-readable) lab key and enroll secret on a
    # shared machine. --keep intentionally KEEPS them — retained containers are
    # useless without the CA/key they were started with; the path is printed so
    # the caller knows what to trust and what to delete. INT/TERM must EXIT
    # after cleanup — a bare handler would return into the script and keep
    # starting containers against a directory the handler just deleted.
    cleanup_fleet_tls() {
      if [ "${KEEP:-0}" -eq 0 ] && [ -n "${FLEET_TLS_DIR:-}" ]; then rm -rf "$FLEET_TLS_DIR"; fi
    }
    trap cleanup_fleet_tls EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM
    # SAN via a config file, not -addext: stock macOS ships LibreSSL at
    # /usr/bin/openssl, and its req has no -addext — the silent failure mode
    # is no certificate at all and a lane that reports "could not stand up
    # Fleet". The config-file form works on OpenSSL and LibreSSL alike.
    cat > "$FLEET_TLS_DIR/req.cnf" <<'REQCNF'
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = sg-fleet
[ext]
subjectAltName = DNS:sg-fleet,DNS:localhost,IP:127.0.0.1
REQCNF
    openssl req -x509 -newkey rsa:2048 -nodes -days 2 \
      -keyout "$FLEET_TLS_DIR/fleet.key" -out "$FLEET_TLS_DIR/fleet.crt" \
      -config "$FLEET_TLS_DIR/req.cnf" >/dev/null 2>&1
    # World-readable ON PURPOSE: the fleet container runs unprivileged and must
    # read the key across the bind mount. Lab-only, per-run, deleted at exit.
    # The DIRECTORY too — mktemp -d mints 700, which blocks traversal for the
    # container user even when the files themselves are readable.
    chmod 755 "$FLEET_TLS_DIR"
    chmod 644 "$FLEET_TLS_DIR/fleet.key" "$FLEET_TLS_DIR/fleet.crt"
    E="-e FLEET_MYSQL_ADDRESS=sg-fleet-mysql:3306 -e FLEET_MYSQL_DATABASE=fleet -e FLEET_MYSQL_USERNAME=fleet -e FLEET_MYSQL_PASSWORD=fleet -e FLEET_REDIS_ADDRESS=sg-fleet-redis:6379 -e FLEET_SERVER_CERT=/fleet-tls/fleet.crt -e FLEET_SERVER_KEY=/fleet-tls/fleet.key"
    # The version the 30 assertions were established against, overridable for a
    # deliberate upstream-drift check. See scripts/lib/container-engine.sh.
    FLEET_IMG="${FLEET_IMAGE:-$SG_IMAGE_FLEET}"
    echo "   fleet image: $FLEET_IMG"
    "$SG_ENGINE" run --rm --platform linux/amd64 --network sg-fleetnet $E "$FLEET_IMG" fleet prepare db --no-prompt >/dev/null 2>&1
    "$SG_ENGINE" run -d --name sg-fleet --platform linux/amd64 --network sg-fleetnet -p 8412:8080 \
      -v "$FLEET_TLS_DIR:/fleet-tls" $E "$FLEET_IMG" fleet serve >/dev/null 2>&1
    WAIT_CACERT="$FLEET_TLS_DIR/fleet.crt"
    if wait_http https://127.0.0.1:8412/healthz 120; then
      started="$started sg-fleet sg-fleet-mysql sg-fleet-redis"
      # A FUNCTION, not a scalar command string: a $HOME with whitespace
      # (custom macOS/CI accounts) reaches FLEET_TLS_DIR, and an unquoted
      # scalar would word-split the --cacert path — leaving FLEET_TOKEN empty
      # and the proof skipped while Fleet sat healthy. (Arrays are off the
      # table on the Mac lane: bash 3.2 under set -u, see CLAUDE.md.)
      sgcurl() { curl -s --cacert "$FLEET_TLS_DIR/fleet.crt" "$@"; }
      sgcurl -X POST https://127.0.0.1:8412/api/v1/setup -H 'Content-Type: application/json' -d '{"admin":{"name":"SG","email":"sg@signalgrid.test","password":"SignalGrid!2026x","password_confirmation":"SignalGrid!2026x"},"org_info":{"org_name":"SG"},"server_url":"https://127.0.0.1:8412"}' >/dev/null 2>&1
      export FLEET_URL=https://127.0.0.1:8412
      # The proof is a Node child; this is the explicit-trust path for it.
      # COMBINED with any CA bundle the caller already supplied — clobbering it
      # would break a later lane (Keycloak over HTTPS) whose CA was configured
      # correctly. Restored right after the Fleet proof runs.
      NODE_CA_REPLACED=1
      if [ -n "$SAVED_NODE_CA" ] && [ -f "$SAVED_NODE_CA" ]; then
        cat "$SAVED_NODE_CA" "$FLEET_TLS_DIR/fleet.crt" > "$FLEET_TLS_DIR/combined-ca.crt"
        export NODE_EXTRA_CA_CERTS="$FLEET_TLS_DIR/combined-ca.crt"
      else
        export NODE_EXTRA_CA_CERTS="$FLEET_TLS_DIR/fleet.crt"
      fi
      # Declared then exported SEPARATELY (SC2155): `export X=$(cmd)` returns the
      # EXPORT's status, not the command's, so a failed login would export an empty
      # token and the live lane below would run against fixtures while reporting it
      # ran live. `export` is required — proof:live-fleet is a child process.
      FLEET_TOKEN=$(sgcurl -X POST "$FLEET_URL"/api/v1/fleet/login -H 'Content-Type: application/json' -d '{"email":"sg@signalgrid.test","password":"SignalGrid!2026x"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).token||'')}catch(e){console.log('')}})")
      export FLEET_TOKEN
      SECRET=$(sgcurl -H "Authorization: Bearer $FLEET_TOKEN" $FLEET_URL/api/v1/fleet/spec/enroll_secret | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).spec.secrets[0].secret)}catch(e){console.log('')}})")
      # A darwin-platform policy the LINUX agent below will never answer and the
      # synthetic host cannot answer: the fail-closed assertions ("an unreported
      # policy grades unknown") need at least one never-answered policy alive at
      # proof time, per the re-run note in docs/FLEET_LIVE_INTEGRATION.md.
      sgcurl -X POST $FLEET_URL/api/v1/fleet/global/policies -H "Authorization: Bearer $FLEET_TOKEN" -H 'Content-Type: application/json' -d '{"name":"Disk encryption","query":"SELECT 1;","platform":"darwin"}' >/dev/null 2>&1
      # The SYNTHETIC host stays: it is the host that never answers anything,
      # which the unknown-grading and non_compliant-hold assertions are about.
      sgcurl -X POST $FLEET_URL/api/v1/osquery/enroll -H 'Content-Type: application/json' -d "{\"enroll_secret\":\"$SECRET\",\"host_identifier\":\"SG-TEST\",\"host_details\":{\"system_info\":{\"uuid\":\"11111111-2222-3333-4444-555555555555\",\"hostname\":\"sg\",\"hardware_serial\":\"SGTEST\"},\"os_version\":{\"name\":\"macOS\",\"platform\":\"darwin\"}}}" >/dev/null 2>&1
      # The REAL agent: a live osqueryd polling /distributed/read is the only
      # thing that can ever answer a live-query campaign — the collector
      # assertions (2026-08-17) require exactly that, and a synthetic curl
      # enroll can never provide it.
      printf '%s' "$SECRET" > "$FLEET_TLS_DIR/secret"
      OSQ_IMG="${OSQUERY_IMAGE:-$SG_IMAGE_OSQUERY}"
      echo "   osquery image: $OSQ_IMG"
      "$SG_ENGINE" run -d --name sg-osquery --platform linux/amd64 --network sg-fleetnet \
        -v "$FLEET_TLS_DIR:/fleet-tls" --entrypoint osqueryd "$OSQ_IMG" \
        --enroll_secret_path=/fleet-tls/secret \
        --tls_hostname=sg-fleet:8080 \
        --tls_server_certs=/fleet-tls/fleet.crt \
        --host_identifier=instance \
        --enroll_tls_endpoint=/api/v1/osquery/enroll \
        --config_plugin=tls --config_tls_endpoint=/api/v1/osquery/config --config_refresh=10 \
        --logger_plugin=tls --logger_tls_endpoint=/api/v1/osquery/log \
        --disable_distributed=false --distributed_plugin=tls --distributed_interval=5 \
        --distributed_tls_read_endpoint=/api/v1/osquery/distributed/read \
        --distributed_tls_write_endpoint=/api/v1/osquery/distributed/write \
        --disable_events --force >/dev/null 2>&1
      # LOUD when the agent did not start (bad tag, failed pull, bad flags):
      # the silenced run -d above once swallowed a nonexistent-tag pull error,
      # and the only symptom was a campaign that timed out minutes later.
      if ! "$SG_ENGINE" inspect -f '{{.State.Running}}' sg-osquery 2>/dev/null | grep -q true; then
        echo "   WARNING: osquery agent container did not start ($OSQ_IMG) — campaigns will have no responder"
      fi
      started="$started sg-osquery"
      # Wait until the REAL agent is enrolled and checking in — a campaign fired
      # before its first /distributed/read poll would time out legitimately.
      printf '   waiting for the live agent to enroll'
      for _ in $(seq 1 60); do
        AGENT_HOSTS=$(sgcurl -H "Authorization: Bearer $FLEET_TOKEN" "$FLEET_URL/api/v1/fleet/hosts" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log((JSON.parse(d).hosts||[]).length)}catch(e){console.log(0)}})")
        [ "${AGENT_HOSTS:-0}" -ge 2 ] && break
        printf '.'; sleep 2
      done
      echo " ($AGENT_HOSTS hosts enrolled)"
    fi
    WAIT_CACERT=""
  fi
  if [ -n "${FLEET_URL:-}" ] && [ -n "${FLEET_TOKEN:-}" ]; then
    if $PNPM run proof:live-fleet >/tmp/live_fleet.log 2>&1; then ok "proof:live-fleet"; else bad "proof:live-fleet" /tmp/live_fleet.log; fi
  else
    skip "proof:live-fleet" "could not stand up Fleet (see docs/FLEET_LIVE_INTEGRATION.md)"
  fi
  # Hand the caller's own trust bundle back to every later lane — but ONLY
  # if this script actually replaced it; a failed bring-up never did.
  if [ "${NODE_CA_REPLACED:-0}" -eq 1 ]; then
    if [ -n "${SAVED_NODE_CA:-}" ]; then export NODE_EXTRA_CA_CERTS="$SAVED_NODE_CA"; else unset NODE_EXTRA_CA_CERTS; fi
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
  [ -n "${FLEET_TLS_DIR:-}" ] && echo "-- lab TLS material kept for the retained containers: $FLEET_TLS_DIR (delete it when you remove them)"
fi

echo
echo "== LIVE LANES: $pass passed, $fail failed, $skipped skipped =="
[ "$fail" -ne 0 ] && { echo "   failed:$failed_lanes"; exit 1; }
if [ "$skipped" -ne 0 ]; then
  echo "   skipped (NOT verified by this run):$skipped_lanes"
  echo "✅ Nothing failed — but a skipped lane proved nothing."
  # EXIT 3, NOT 0. This script's own header has always said a skip is "never
  # counted as passed, and the exit code is non-zero", and for as long as it
  # exited 0 that sentence was false — any wrapper reading the exit code recorded
  # a run where Fleet never started as a PASS. The simulation request loop was
  # exactly such a wrapper. 3 rather than 1 keeps "something failed" and "nothing
  # ran" distinguishable, which is the whole point.
  exit 3
fi
echo "✅ Every live lane ran and passed."
