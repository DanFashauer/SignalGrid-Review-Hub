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
# Wazuh IS auto-provisioned since 2026-08-21 (pinned 4.14.7 — native on both
# architectures, up in seconds; the never-start rule dated from the amd64-only
# 4.9.0 era). First run pulls a ~2GB image. To skip the EDR lane:
#   ./scripts/run-live-lanes.sh --only fleet,location,keycloak
# =============================================================================
set -uo pipefail
cd "$(dirname "$0")/.." || { echo "cannot enter repo root" >&2; exit 1; }

KEEP=0
ONLY=""
WITH_TELEMETRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --keep) KEEP=1 ;;
    --only) ONLY="${2:-}"; shift ;;
    --with-telemetry) WITH_TELEMETRY=1 ;;
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

# Lab TLS material cleanup is registered ONCE, at top level: the earlier trap
# lived inside Fleet's provisioning branch, so a run selecting only another
# lane (--only edr) never installed it and left extracted certs behind.
cleanup_lab_tls() {
  if [ "${KEEP:-0}" -eq 0 ] && [ -n "${FLEET_TLS_DIR:-}" ]; then rm -rf "$FLEET_TLS_DIR"; fi
  if [ "${KEEP:-0}" -eq 0 ] && [ -n "${WAZUH_CA:-}" ]; then rm -f "$WAZUH_CA" "$WAZUH_CA.combined"; fi
}
trap cleanup_lab_tls EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

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
    # Fleet Premium (teams, the transfer endpoint) needs a licence key on the SERVER.
    # Read from the caller's environment only — never from a file in this tree — and
    # passed straight through; the proof reads the tier the server actually reports
    # and runs its Premium section only when that says premium. The lab this script
    # mints is disposable by construction, so it is also marked writable for the
    # proofs' write-bearing sections (a team, a policy, one host transfer and back).
    # Verified 2026-09-06 (cloud lane, the owner's trial key, Fleet 4.89.2) — see
    # docs/FLEET_LIVE_INTEGRATION.md. Note: Premium keeps usage statistics ON
    # (enable_analytics cannot be set false); block the lab's egress if that matters.
    if [ -n "${FLEET_LICENSE_KEY:-}" ]; then
      E="$E -e FLEET_LICENSE_KEY=$FLEET_LICENSE_KEY"
      export FLEET_LAB_WRITE_OK=true
      echo "   licence: FLEET_LICENSE_KEY present in the environment (passed to the server; the proof reports the tier)"
    fi
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

# ── Wazuh ────────────────────────────────────────────────────────────────────
# Self-provisioned since 2026-08-21: the "never starts it for you" rule dated
# from the amd64-only 4.9.0 era (a ~2GB image, minutes of QEMU boot, and on
# Apple Silicon a fatal segfault). The pinned 4.14.7 ships native arm64 and is
# up in seconds on both engines — the Mac lane measured it (c22177e).
if wanted edr; then
  if [ -z "${WAZUH_URL:-}" ] && have_engine; then
    echo "-- bringing up Wazuh"
    "$SG_ENGINE" rm -f sg-wazuh >/dev/null 2>&1
    rm -f "$HOME"/.sg-wazuh-ca.* 2>/dev/null  # residue from any pre-trap crash, swept like the containers are
    WAZUH_IMG="${WAZUH_IMAGE:-$SG_IMAGE_WAZUH}"
    echo "   wazuh image: $WAZUH_IMG"
    "$SG_ENGINE" run -d --name sg-wazuh -p 55000:55000 "$WAZUH_IMG" >/dev/null 2>&1
    # Tracked the moment it exists: a container whose API never becomes healthy
    # must still be torn down, or the failure path leaks a running Wazuh.
    started="$started sg-wazuh"
    # EXPLICIT TRUST, verification never disabled: the container mints its own
    # self-signed API certificate; extract it and trust exactly it. Its SAN is
    # DNS:localhost ONLY — measured — so the URL must say localhost, not
    # 127.0.0.1, or hostname verification (correctly) fails.
    WAZUH_CA="$HOME/.sg-wazuh-ca.$$.crt"
    got_ca=0
    for _ in $(seq 1 60); do
      if "$SG_ENGINE" cp sg-wazuh:/var/ossec/api/configuration/ssl/server.crt "$WAZUH_CA" >/dev/null 2>&1; then got_ca=1; break; fi
      sleep 2
    done
    wazuh_up=0
    if [ "$got_ca" != "1" ]; then
      echo "   (certificate never appeared — the container likely failed before its API config was written)"
    else
      # wazuh:wazuh is the image's public default API credential, not a secret.
      for _ in $(seq 1 150); do
        [ "$(curl -s --cacert "$WAZUH_CA" -o /dev/null -w '%{http_code}' -u wazuh:wazuh -X POST https://localhost:55000/security/user/authenticate 2>/dev/null)" = "200" ] && { wazuh_up=1; break; } # gitleaks:allow — wazuh/wazuh-manager's documented default, same standing as postgres:16's POSTGRES_PASSWORD in CI
        sleep 2
      done
    fi
    if [ "$wazuh_up" = "1" ]; then
      export WAZUH_URL=https://localhost:55000
      SAVED_NODE_CA_EDR="${NODE_EXTRA_CA_CERTS:-}"
      if [ -n "$SAVED_NODE_CA_EDR" ] && [ -f "$SAVED_NODE_CA_EDR" ]; then
        cat "$SAVED_NODE_CA_EDR" "$WAZUH_CA" > "$WAZUH_CA.combined"
        export NODE_EXTRA_CA_CERTS="$WAZUH_CA.combined"
      else
        export NODE_EXTRA_CA_CERTS="$WAZUH_CA"
      fi
      NODE_CA_REPLACED_EDR=1
    else
      echo "   WARNING: Wazuh API never answered ($WAZUH_IMG) — the edr lane will be reported as skipped"
      rm -f "$WAZUH_CA"
    fi
  fi
  if [ -n "${WAZUH_URL:-}" ]; then
    if $PNPM run proof:live-edr >/tmp/live_edr.log 2>&1; then ok "proof:live-edr"; else bad "proof:live-edr" /tmp/live_edr.log; fi
  else
    skip "proof:live-edr" "could not stand up Wazuh (no engine, or the API never answered)"
  fi
  if [ "${NODE_CA_REPLACED_EDR:-0}" -eq 1 ]; then
    if [ -n "${SAVED_NODE_CA_EDR:-}" ]; then export NODE_EXTRA_CA_CERTS="$SAVED_NODE_CA_EDR"; else unset NODE_EXTRA_CA_CERTS; fi
  fi
fi

# ── Headwind CE ──────────────────────────────────────────────────────────────
# The SECOND live device-management source (DR-013 source-independence). The
# 2026-08-18 shape-check documented every wrinkle this lane handles: the image
# downloads its war from h-mdm.com at boot (under a TLS-intercepting proxy the
# in-container wget silently writes an empty ROOT.war — detected and repaired
# by fetching on the host and docker-cp'ing in); and stock CE seeds
# configuration 1 with password:null, which the sync handler MD5-hashes
# unconditionally → NPE on the first device sync. The lane sets the config
# password BEFORE the proof drives the launcher protocol.
# GLPI — the ITSM class, proven without any vendor signup (DR-013 item 3).
#
# Image and env are VERIFIED, not remembered: `glpi/glpi` returns HTTP 200 on
# Docker Hub with `11.0.8` a real published tag (`glpiproject/glpi` is a 404 and
# is not used), and GLPI_DB_* plus the MariaDB backend come from the image's own
# published description. The REST surface is NOT verified — GLPI ships a v1
# /apirest.php and a v2 whose shape differs by release — so proof:live-glpi is a
# SHAPE-DISCOVERY proof that records what the server answers instead of
# asserting a contract nobody here has driven. It fails loudly on a shape it
# cannot interpret; do not add a fallback that makes it green.
if wanted glpi; then
  if [ -z "${GLPI_URL:-}" ] && have_engine; then
    echo "-- bringing up GLPI (mariadb + glpi 11.0.8)"
    "$SG_ENGINE" network create sg-glpinet >/dev/null 2>&1
    "$SG_ENGINE" rm -f sg-glpi sg-glpi-db >/dev/null 2>&1
    "$SG_ENGINE" run -d --name sg-glpi-db --network sg-glpinet \
      -e MARIADB_DATABASE=glpi -e MARIADB_USER=glpi -e MARIADB_PASSWORD=glpi \
      -e MARIADB_RANDOM_ROOT_PASSWORD=yes \
      "${SG_IMAGE_MARIADB:-docker.io/library/mariadb:11}" >/dev/null 2>&1
    # GLPI serves on 80 in-container; bind high so rootless podman is happy.
    "$SG_ENGINE" run -d --name sg-glpi --network sg-glpinet -p 8430:80 \
      -e GLPI_DB_HOST=sg-glpi-db -e GLPI_DB_NAME=glpi \
      -e GLPI_DB_USER=glpi -e GLPI_DB_PASSWORD=glpi \
      "${SG_IMAGE_GLPI:-docker.io/glpi/glpi:11.0.8}" >/dev/null 2>&1
    # First boot runs the installer against a database that is itself still
    # starting, so this waits on GLPI answering rather than on the container.
    if wait_http http://127.0.0.1:8430/ 300; then
      started="$started sg-glpi sg-glpi-db"
      # The glpi/glpi image serves its SETUP WIZARD on first boot — it does NOT
      # auto-install from GLPI_DB_* (config_db.php is never written), so the DB
      # stays empty and every REST path returns the wizard HTML: a 200 that is
      # the installer, not the API. wait_http above is satisfied by that wizard,
      # so completing the install here is what turns the lane real. Verified live
      # on glpi 11.0.8: after these steps /apirest.php/initSession returns 400
      # JSON, /api.php returns 403 JSON, and a glpi/glpi initSession returns a
      # session_token. (Fresh containers every run — rm -f above — so
      # --reconfigure --force never double-installs.)
      for _ in $(seq 1 60); do "$SG_ENGINE" exec sg-glpi-db mariadb -uglpi -pglpi -e "SELECT 1" glpi >/dev/null 2>&1 && break; sleep 2; done
      "$SG_ENGINE" exec sg-glpi sh -lc 'cd /var/www/glpi && php bin/console database:install --db-host=sg-glpi-db --db-name=glpi --db-user=glpi --db-password=glpi --default-language=en_GB --no-interaction --reconfigure --force' >/dev/null 2>&1
      # REST API is off by default: enable it + credential login, and widen the
      # seeded "full access from localhost" client (127.0.0.1 only) to the
      # container network, then clear the config cache so it takes effect.
      "$SG_ENGINE" exec sg-glpi-db sh -lc "mariadb -uglpi -pglpi glpi -e \"UPDATE glpi_configs SET value='1' WHERE name IN ('enable_api','enable_api_login_credentials'); UPDATE glpi_apiclients SET ipv4_range_start=0, ipv4_range_end=4294967295 WHERE id=1;\"" >/dev/null 2>&1
      "$SG_ENGINE" exec sg-glpi sh -lc 'cd /var/www/glpi && php bin/console cache:clear' >/dev/null 2>&1
      export GLPI_URL=http://127.0.0.1:8430
    fi
  fi
  if [ -n "${GLPI_URL:-}" ]; then
    if $PNPM run proof:live-glpi >/tmp/live_glpi.log 2>&1; then
      ok "proof:live-glpi (shape discovery; capture written)"
    else
      bad "proof:live-glpi" /tmp/live_glpi.log
    fi
  else
    skip "proof:live-glpi" "could not stand up GLPI (no engine, or it never answered on :8430)"
  fi
fi

if wanted headwind; then
  if have_engine; then
    echo "-- bringing up Headwind CE (postgres + hmdm 0.1.5 / 5.30.3-os)"
    "$SG_ENGINE" network create sg-hmdmnet >/dev/null 2>&1
    "$SG_ENGINE" rm -f sg-hmdm sg-hmdm-pg >/dev/null 2>&1
    "$SG_ENGINE" run -d --name sg-hmdm-pg --network sg-hmdmnet \
      -e POSTGRES_DB=hmdm -e POSTGRES_USER=hmdm -e POSTGRES_PASSWORD=hmdm \
      "$SG_IMAGE_POSTGRES" >/dev/null 2>&1
    for _ in $(seq 1 60); do "$SG_ENGINE" exec sg-hmdm-pg pg_isready -U hmdm >/dev/null 2>&1 && break; sleep 2; done
    "$SG_ENGINE" run -d --name sg-hmdm --network sg-hmdmnet -p 127.0.0.1:8425:8080 \
      -e SQL_HOST=sg-hmdm-pg -e SQL_BASE=hmdm -e SQL_USER=hmdm -e SQL_PASS=hmdm \
      -e PROTOCOL=http -e BASE_DOMAIN=localhost -e LOCAL_IP=127.0.0.1 \
      "$SG_IMAGE_HMDM" >/dev/null 2>&1
    started="$started sg-hmdm sg-hmdm-pg"
    # The war-download dance can take minutes; a zero-byte ROOT.war means the
    # proxy ate it — repair from the host, which trusts the proxy CA.
    # CREDENTIALS. This lane shipped hardcoding admin/admin, and the Mac lane
    # proved on a live sg-hmdm 0.1.5 container that the seeded admin password is
    # NOT 'admin' — the stored hash (349242D3…) is neither sha1('admin') nor
    # md5('admin'), the login returns 401 with audit errorCode=2 (bad
    # credentials, not missing user), and resetting the row to sha1('admin')
    # still 401s, so the comparison is not sha1(plaintext) either. That was
    # tested three ways, including a container restart to rule out a cached
    # user. There is no published web-panel default for this image.
    #
    # Consequence, recorded because it was missed once: this lane has NEVER
    # authenticated on any machine. The proof it feeds went "27/27 green with
    # the capture ABSENT", so the admin/admin assumption was never exercised —
    # a green that came from the capture step being skipped, not from it
    # working.
    #
    # So the credential is no longer hardcoded to a value known to fail. It must
    # be supplied. Absent it the lane SKIPS with the reason, which is what the
    # runner already does correctly: a skipped lane proved nothing, and the
    # sim-request stays open rather than counting green.
    # THE CREDENTIAL WAS NEVER WRONG — THE ENCODING WAS.
    #
    # This lane spent two rounds believing the seeded admin password was unknown.
    # It is 'admin'. The Mac lane pinned the scheme by decompiling the pinned war
    # (hmdm-5.30.3-os, CFR) rather than guessing:
    #
    #   com.hmdm.util.PasswordUtil
    #     PASS_SALT           = "5YdSYHyg2U"   (a compiled-in constant — not a
    #                            column, not a properties file, not per-install)
    #     getHashFromRaw(pw)  = SHA1( UPPER(hex(MD5(pw))) + PASS_SALT )
    #     passwordMatch(e,db) = SHA1( e + PASS_SALT ) == db   (case-insensitive)
    #
    # JWTAuthResource's own Swagger text says it outright: "The password field
    # should contain the MD5 hash of the actual password." The server never
    # hashes plaintext. We POSTed plaintext, so every login 401'd — which is why
    # this lane had authenticated on no machine to date.
    #
    # Verified here rather than taken on trust:
    #   SHA1( UPPER(md5("admin")) + "5YdSYHyg2U" )
    #     == 349242D38ED8667B5C11D2412EBEA4636BD3CA3A
    # the hash actually observed in the container's users row.
    #
    # CASE MATTERS for the seeded row: equalsIgnoreCase applies to the SHA1
    # output, not to the md5 fed into it, and the startup migration uppercased
    # the seeded md5 — so the seeded admin needs UPPERCASE md5 hex.
    HMDM_LOGIN="${HMDM_ADMIN_LOGIN:-admin}"
    HMDM_PLAINTEXT="${HMDM_ADMIN_PASSWORD:-admin}"
    HMDM_PW=$(node -e 'process.stdout.write(require("node:crypto").createHash("md5").update(process.argv[1]).digest("hex").toUpperCase())' "$HMDM_PLAINTEXT")
    HMDM_UP=0
    HMDM_CRED_OK=1
    if [ -z "$HMDM_PW" ]; then HMDM_CRED_OK=0; fi
    for i in $(seq 1 90); do
      [ "$HMDM_CRED_OK" = "1" ] || break
      code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:8425/rest/public/jwt/login" -X POST -H 'Content-Type: application/json' -d "{\"login\":\"$HMDM_LOGIN\",\"password\":\"$HMDM_PW\"}" 2>/dev/null)
      [ "$code" = "200" ] && { HMDM_UP=1; break; }
      if [ "$i" = "30" ]; then
        SZ=$("$SG_ENGINE" exec sg-hmdm sh -c 'stat -c %s /usr/local/tomcat/webapps/ROOT.war 2>/dev/null || echo 0')
        if [ "${SZ:-0}" -lt 1000000 ]; then
          echo "   war download failed in-container (size=$SZ) — repairing from host"
          HMDM_TMP=$(mktemp)
          curl -sL --max-time 300 -o "$HMDM_TMP" "https://h-mdm.com/files/hmdm-5.30.3-os.war" && \
            "$SG_ENGINE" cp "$HMDM_TMP" sg-hmdm:/usr/local/tomcat/webapps/ROOT.war && \
            "$SG_ENGINE" restart sg-hmdm >/dev/null 2>&1
          rm -f "$HMDM_TMP"
        fi
      fi
      sleep 4
    done
    if [ "$HMDM_UP" = "1" ]; then
      # Clear the seeded admin's "must change password on first login" flag.
      # HMDM ships the admin row with passwordReset=true; while it is set,
      # AuthFilter 403s EVERY /rest/private/* call even with a valid JWT
      # (verified on a live 5.30.3-os container: PUT /rest/private/devices and
      # GET /rest/private/configurations/1 both return 403 while the flag is
      # set, 200 once it clears). Without this the config patch below and the
      # proof's device calls all fail. Deterministic DB update via the pg
      # sidecar, same standing as the config-password patch.
      "$SG_ENGINE" exec sg-hmdm-pg psql -U hmdm -d hmdm -c "UPDATE users SET passwordReset=false WHERE login='$HMDM_LOGIN';" >/dev/null 2>&1
      # Pre-empt the upstream NPE: set an admin password on configuration 1.
      HW_JWT=$(curl -s -X POST "http://127.0.0.1:8425/rest/public/jwt/login" -H 'Content-Type: application/json' -d "{\"login\":\"$HMDM_LOGIN\",\"password\":\"$HMDM_PW\"}" | sed -n 's/.*"id_token" *: *"\([^"]*\)".*/\1/p')
      HW_CFG=$(curl -s "http://127.0.0.1:8425/rest/private/configurations/1" -H "Authorization: Bearer $HW_JWT")
      # shellcheck disable=SC2001
      HW_CFG_PATCHED=$(echo "$HW_CFG" | sed 's/"data" *: *{/"data":{/; s/{"status":"OK","data":{/{/; s/}}$/}/' )
      curl -s -X PUT "http://127.0.0.1:8425/rest/private/configurations" -H "Authorization: Bearer $HW_JWT" -H 'Content-Type: application/json' \
        -d "$(echo "$HW_CFG_PATCHED" | sed 's/"password" *: *null/"password":"lab-config-pass"/; s/"password" *: *""/"password":"lab-config-pass"/')" >/dev/null 2>&1
      LOG=$(mktemp)
      # Hand the SAME credential to the proof. The proof reads HMDM_ADMIN /
      # HMDM_PASSWORD (not HMDM_ADMIN_LOGIN / HMDM_ADMIN_PASSWORD); without this
      # it fell back to the plaintext 'admin' default and 401'd even though the
      # lane above authenticated fine.
      if HMDM_URL=http://127.0.0.1:8425 HMDM_ADMIN="$HMDM_LOGIN" HMDM_PASSWORD="$HMDM_PW" $PNPM run proof:live-headwind >"$LOG" 2>&1; then
        ok "headwind (CE 5.30.3 driven over the launcher protocol; capture written)"
      else
        bad headwind "$LOG"
      fi
    else
      if [ "$HMDM_CRED_OK" = "1" ]; then
        skip headwind "hmdm never became healthy after the war dance (see: $SG_ENGINE logs sg-hmdm)"
      else
        skip headwind "could not compute the md5 of the admin password (is node on PATH?) — HMDM's login wants MD5 hex, never plaintext"
      fi
    fi
  else
    skip headwind "no container engine"
  fi
fi

# ── Telemetry (OPT-IN: --with-telemetry or --only telemetry) ─────────────────
# Backlog row 33: the OTel Collector + Prometheus lab profile. OFF by default
# like the heavy lanes — telemetry is operational tooling, not a vendor-evidence
# proof, and pulling two more images on every run would tax the default path.
# What it proves when it runs: the api-server's dependency-free /metrics
# (decision outcomes, latency histogram, liveness) travels the vendor-neutral
# transport end to end — app → OTel collector (prometheus receiver) →
# Prometheus — and comes back out of Prometheus's query API. The assertion
# metric is signalgrid_up==1 WITH the full chain in the middle, not a direct
# scrape shortcut.
TELEMETRY_WANTED=0
if [ "$WITH_TELEMETRY" = 1 ]; then TELEMETRY_WANTED=1; fi
case ",$ONLY," in *",telemetry,"*) TELEMETRY_WANTED=1 ;; esac
if [ "$TELEMETRY_WANTED" = 1 ]; then
  if have_engine; then
    echo "-- bringing up telemetry (otel-collector + prometheus, api-server on the host)"
    TEL_LOG=$(mktemp)
    ( cd artifacts/api-server && $PNPM run build >/dev/null 2>&1 )
    if [ ! -f artifacts/api-server/dist/index.mjs ]; then
      skip telemetry "api-server build did not produce dist/index.mjs"
    else
      PORT=5330 node artifacts/api-server/dist/index.mjs >"$TEL_LOG" 2>&1 &
      TEL_API_PID=$!
      if ! wait_http "http://127.0.0.1:5330/metrics" 30; then
        kill "$TEL_API_PID" >/dev/null 2>&1
        skip telemetry "api-server never served /metrics (log: $TEL_LOG)"
      else
        "$SG_ENGINE" network create sg-telnet >/dev/null 2>&1
        "$SG_ENGINE" rm -f sg-otelcol sg-prometheus >/dev/null 2>&1
        "$SG_ENGINE" run -d --name sg-otelcol --network sg-telnet \
          --add-host host.docker.internal:host-gateway \
          -v "$PWD/scripts/lab/otel-collector.yaml:/etc/otelcol-contrib/config.yaml:ro" \
          "$SG_IMAGE_OTELCOL" >/dev/null 2>&1
        "$SG_ENGINE" run -d --name sg-prometheus --network sg-telnet -p 127.0.0.1:5390:9090 \
          -v "$PWD/scripts/lab/prometheus.yml:/etc/prometheus/prometheus.yml:ro" \
          "$SG_IMAGE_PROMETHEUS" >/dev/null 2>&1
        started="$started sg-otelcol sg-prometheus"
        # A few real requests so decision/latency series exist, not just liveness.
        for _ in 1 2 3; do curl -s -o /dev/null "http://127.0.0.1:5330/metrics"; done
        TEL_OK=0
        i=0
        # signalgrid_up must arrive VIA the chain: Prometheus's own target list
        # names only the collector, so the metric existing in a query result
        # proves app → collector → prometheus, no shortcut possible.
        until [ "$i" -ge 45 ]; do
          RES=$(curl -s "http://127.0.0.1:5390/api/v1/query?query=signalgrid_up" 2>/dev/null)
          case "$RES" in *'"value"'*'"1"'*) TEL_OK=1; break ;; esac
          i=$((i+1)); sleep 2
        done
        kill "$TEL_API_PID" >/dev/null 2>&1
        if [ "$TEL_OK" = 1 ]; then
          ok "telemetry (signalgrid_up traversed app -> otel-collector -> prometheus)"
        else
          bad telemetry "$TEL_LOG"
        fi
      fi
    fi
  else
    skip telemetry "no container engine"
  fi
fi

if [ "$KEEP" -eq 0 ] && [ -n "$started" ]; then
  echo; echo "-- removing containers this run started:$started"
  # shellcheck disable=SC2086
  "$SG_ENGINE" rm -f $started >/dev/null 2>&1
  "$SG_ENGINE" network rm sg-fleetnet sg-telnet sg-hmdmnet >/dev/null 2>&1
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
