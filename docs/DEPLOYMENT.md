# Deployment — durable stack

How to run the SignalGrid API with **durable Postgres persistence** turned on.
Public-safe: the stack makes no external vendor calls by default.

## One command

```bash
docker compose -f docker-compose.prod.yml up --build
```

This builds the API image (`Dockerfile.api`) and starts two services:

- **db** — `postgres:16` with a persistent volume.
- **api** — the SignalGrid API on `:8080`, wired to Postgres.

The API is then at `http://localhost:8080` (health: `/api/healthz`, metrics: `/metrics`).

**This one command is a liveness-only boot, deliberately.** It serves the
gateway profile with the zero-step owner database URL and no IdP configured,
so `/api/healthz` goes green but **`/api/readyz` answers 503 until the
production posture is completed** — and that refusal is correct twice over:
the owner credential holds DELETE on the ledger (a rewritable ledger fails
the append-only probe), and a gateway with no OIDC configured can
authenticate nobody. A stack that should take real traffic follows
[Schema — migrate first, then boot](#schema--migrate-first-then-boot) (runtime
role + password) and sets the OIDC variables from the table below. For an
evaluation stack with the demo surfaces instead, prefix the same command with
`SIGNALGRID_PRODUCT_PROFILE=review-demo`.

## What turns durability on

The persistence layer (audit ledger, decision + evidence store, session store) is
**gated on `DATABASE_URL`**. With it set (as the compose file does), those records
persist to Postgres and survive a restart. With it unset, the API runs entirely
in-memory (the fixture-safe default used by the public build and CI).

## Environment variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `SIGNALGRID_PRODUCT_PROFILE` | **The profile fence.** `shared-device-gateway` for every real deployment; `review-demo` (the unset default) serves demo credentials via `/v1/keys`, the unauthenticated simulator, and accepts demo bearers — measured: a stack without this variable handed an anonymous caller nine bearer tokens, a tenant owner among them. | unset ⇒ `review-demo` |
| `DATABASE_URL` | Postgres connection string, **as the `signalgrid_runtime` role** (see Schema below). Set ⇒ durable persistence on. | unset (in-memory) |
| `SIGNALGRID_TIER` | `dev` \| `alpha` \| `beta` \| `prod`. | `dev` |
| `SIGNALGRID_LIVE_INTEGRATIONS` | `true` only permits live vendor calls, and only on `beta`/`prod`. **Pinned `false` in the compose stack**: that image has no live-integration wiring, so a `true` would only make `/healthz` and `/v1/context` claim live signals the fixture-backed routes cannot produce. | unset (off) |
| `PORT` | API listen port. | `8080` |
| `LOG_LEVEL` | pino log level. | `info` |
| `CORS_ALLOWED_ORIGINS` | Comma-separated browser origins allowed to call `/v1`. | none (deny all cross-origin) |
| `SIGNALGRID_ENROLLMENT_SECRET` | Set ⇒ `/v1/step-up/enroll/*` additionally requires the `x-enrollment-authorization` header to carry this value (out-of-band enrollment authorization — required for any real deployment, since a demo core publishes operator/owner tokens via `/v1/keys`). | unset (self-service demo, labeled via `demoNote`) |
| `OIDC_ISSUER` | Enterprise IdP issuer. Set ⇒ OIDC/JWT bearer auth on for `/v1`. | unset (demo keys) |
| `OIDC_AUDIENCE` | Expected token audience (the API's app/client id). | unset |
| `OIDC_JWKS_URI` | IdP JWKS endpoint (discovery `jwks_uri`). | unset |
| `OIDC_TENANT_CLAIM` / `OIDC_ROLE_CLAIM` | Claims carrying the IdP tenant / role. | `tid` / `roles` |
| `METRICS_TOKEN` | Set ⇒ `/metrics` requires this bearer. Set but BLANK ⇒ the server refuses to boot (since 2026-09-06; a blank token is an operator who believes the endpoint is protected). `docker-compose.prod.yml` passes it key-only so an unset host variable stays unset in the container. | unset (open on the internal port) |
| `NODE_ENV` | Standard Node environment switch; the compose file sets `production`. | unset |
| `SIGNALGRID_DEPRECATED_ROUTES` | Comma-separated route ids to serve with a `Deprecation` header during a migration window. | unset |
| `SIGNALGRID_V1_RATE_LIMIT` | Requests/min/bearer on `/v1`. Malformed values fall back — never to "unlimited". | `240` |
| `SIGNALGRID_GLOBAL_RATE_LIMIT` | Requests/min/IP across the server. `/api/healthz`, `/api/readyz`, and — only when `METRICS_TOKEN` is set — `/metrics` are exempt. | `600` |
| `SIGNALGRID_MAX_DECISIONS_PER_TENANT` | In-memory decisions retained per tenant (FIFO), with the audit/webhook/remediation collections derived from it. Older rows are served by the durable store when `DATABASE_URL` is set. `GET /v1/metrics` reports `metrics.window.capped` once the bound has evicted anything, so a truncated aggregate is never read as a full one. Must be a positive integer — **an invalid value refuses at boot rather than silently using the default**. | `5000` |
| `OIDC_TENANT_MAP` / `OIDC_ROLE_MAP` | JSON maps: IdP value → internal tenant id / role. **Required** once OIDC is on — without both, the config is invalid and every request is 401. | unset |
| `OIDC_SUBJECT_CLAIM` | Claim used as the caller's subject id. | `sub` |
| `OIDC_CLOCK_TOLERANCE_SEC` | Allowed clock skew when validating token times. | `60` |

### Running behind a proxy or ingress

The server does **not** set Express's `trust proxy`, and leaving it unset is the
right default: with it on, any caller can spoof `X-Forwarded-For` and be keyed to
an address they chose, which turns the per-address rate limit into no limit at
all.

The cost of leaving it off is that behind an ingress every caller arrives from the
same socket peer, so all of them share one `SIGNALGRID_GLOBAL_RATE_LIMIT` bucket.
Two things blunt that in the default configuration: `/v1` is limited per bearer
token rather than per address, and the liveness and readiness probes are exempt
from the global limiter entirely, so a shared bucket can no longer make a healthy
instance look dead.

If you do terminate at a proxy you control, set `trust proxy` to that **specific
hop count or CIDR** — never `true`, which trusts the whole chain including the
part an attacker writes.

| `REDIS_URL` | Set ⇒ WebAuthn step-up session state persists to Redis instead of in-memory. That is the ONLY Redis-backed state in this deployment: the connector/webhook routes run the in-process core, and the `@workspace/integrations` Redis stores are not part of the served API. | unset (in-memory) |
| `STEPUP_TTL_SECONDS` | Step-up session time-to-live. | `300` |
| `WEBAUTHN_RP_ID` / `WEBAUTHN_RP_NAME` / `WEBAUTHN_ORIGIN` | WebAuthn relying-party identity for step-up ceremonies; must match the origin the operator console is served from. | `localhost` / dev defaults |
| `WEBAUTHN_REQUIRE_STEP_UP_FOR_ADMIN` | **Reserved — currently UNENFORCED.** The value is parsed into the WebAuthn config, but no route consults it yet: admin actions enforce their role checks only. Do not rely on it as a control; the wiring is tracked as backlog work. | unset |
| `GRAPH_ACCESS_TOKEN` | Read-only Microsoft Graph token for the posture connector. | unset (fixture mode) |
| `CARRIER_ACCESS_TOKEN` | Read-only carrier/IoT-connectivity token for the reachability connector. | unset (fixture mode) |
| `LOCATION_ACCESS_TOKEN` | Read-only token for the device location-services connector. | unset (fixture mode) |
| `VULN_SCAN_ACCESS_TOKEN` | Read-only token for the vulnerability-scanner connector. | unset (fixture mode) |
| `NAC_ACCESS_TOKEN` | Read-only token for the network/NAC posture connector. | unset (fixture mode) |
| `EDR_ACCESS_TOKEN` | Read-only token for the EDR/EPP endpoint threat-state connector. | unset (fixture mode) |
| `IDENTITY_RISK_ACCESS_TOKEN` | Read-only token for the identity/SSO sign-in-risk connector. | unset (fixture mode) |
| `RTLS_ACCESS_TOKEN` | Read-only token for the RTLS/badge-dwell physical-custody connector. | unset (fixture mode) |
| `PERIPHERAL_ACCESS_TOKEN` | Read-only token for the removable-media/peripheral-control connector. | unset (fixture mode) |
| `DLP_ACCESS_TOKEN` | Read-only token for the data-protection/DLP posture connector. | unset (fixture mode) |

**The ten `*_ACCESS_TOKEN` rows above describe library surfaces, not the served decision path.** Each connector family lives in `@workspace/integrations` and is exercised by its `proof:*` script; in this build `artifacts/api-server/src` does not import that package and no file under it reads any of the ten variables (measured 2026-09-06: `grep -rn "@workspace/integrations" artifacts/api-server/src --include=*.ts` → no output; `grep -rl <VAR> artifacts/api-server/src | wc -l` → 0 for all ten). Setting one of them alongside `SIGNALGRID_LIVE_INTEGRATIONS=true` therefore changes nothing the `/v1` API decides — neither a live read nor a fixture read runs there. Wiring a family into the served core is tracked as backlog work, not as a configuration step.

## Enterprise sign-in (OIDC) — gated

With `OIDC_ISSUER`, `OIDC_AUDIENCE`, and `OIDC_JWKS_URI` set, the `/v1` surface also
accepts a real **OIDC JWT** bearer: the token's **RS256 signature** is verified
against the IdP's JWKS and its **issuer / audience / expiry** are enforced, then
the verified claims are mapped (`OIDC_TENANT_MAP` / `OIDC_ROLE_MAP`) to a
tenant-scoped principal. `alg:none` and HMAC (`HS*`) tokens are rejected outright
(algorithm-confusion defense). With the OIDC vars unset — the default — the API
keeps using the public-safe demo bearer keys and nothing here runs. Wiring it to a
real Entra/Okta/Auth0 tenant is a one-time configuration step, no code change.

## Read-only Microsoft Graph connector — gated

> **Library surface, not wired into the served `/v1` decision path in this build.** Exercised by its `proof:*` script; `artifacts/api-server/src` does not import `@workspace/integrations` and never reads `GRAPH_ACCESS_TOKEN` (measured 2026-09-06, see the note under the environment table).

The read-only Graph posture connector reads **users + managed devices** and
normalizes them to SignalGrid's posture vocabulary. It is **read-only by
construction** (only GET requests are issued) and **gated exactly like every
other integration**: it makes live Graph calls only on `beta`/`prod` **and** with
`SIGNALGRID_LIVE_INTEGRATIONS=true` **and** `GRAPH_ACCESS_TOKEN` set — otherwise it
runs in offline **fixture mode**. So it is safe to stand up for evaluation with no
tenant, and its normalization/pagination/error paths are proven offline in CI
(`pnpm run proof:graph-connector`).

## Post-exit reachability (carrier connectivity) — gated

> **Library surface, not wired into the served `/v1` decision path in this build.** Exercised by its `proof:*` script; `artifacts/api-server/src` does not import `@workspace/integrations` and never reads `CARRIER_ACCESS_TOKEN` (measured 2026-09-06, see the note under the environment table).

Once a shared device leaves managed Wi-Fi, MDM "find/ring/lock" commands become
opportunistic. The read-only **carrier reachability connector** reads per-SIM
session + last-seen state from a carrier/IoT platform (shaped for Verizon
ThingSpace, Cisco IoT Control Center, Twilio Super SIM), and a **pure,
deterministic evaluator** turns it into a posture (`reachable` / `degraded` /
`unreachable` / `wifi_only_blindspot`) plus the single self-managing playbook
action it warrants (`monitor` / `locate` / `alert` / `escalate`) — so a lost
device becomes a self-triaging event instead of something an admin must chase.
Read-only by construction and gated exactly like every other integration (live
only on `beta`/`prod` + `SIGNALGRID_LIVE_INTEGRATIONS=true` + `CARRIER_ACCESS_TOKEN`;
otherwise fixture mode). Proven offline in CI (`pnpm run proof:carrier-reachability`).

## EDR/EPP endpoint threat-state — gated

> **Library surface, not wired into the served `/v1` decision path in this build.** Exercised by its `proof:*` script; `artifacts/api-server/src` does not import `@workspace/integrations` and never reads `EDR_ACCESS_TOKEN` (measured 2026-09-06, see the note under the environment table).

The vulnerability connector answers "what known CVEs does this device carry?";
the read-only **EDR/EPP connector** answers the other half — "is this endpoint
actually protected, and is anything live on it right now?" It reads per-endpoint
**agent health** (installed / running / real-time protection / signature age) and
**threat detections** (with their remediation state) from an endpoint-protection
platform (shaped for Microsoft Defender for Endpoint, CrowdStrike Falcon,
SentinelOne, Jamf Protect, Sophos Intercept X, VMware Carbon Black), and a **pure,
deterministic evaluator** fuses them into one posture (`protected` / `monitored` /
`degraded_protection` / `unprotected` / `active_threat` / `critical_compromise` /
`unknown`) plus the single action it warrants (`none` / `monitor` / `step_up` /
`alert` / `restrict` / `escalate`). Fail-safe by construction: an absent/disabled
agent is a **blind spot** (never "clean"), an unclassifiable detection is treated
as **active**, and the worst active concern drives the verdict. Read-only by
construction and gated exactly like every other integration (live only on
`beta`/`prod` + `SIGNALGRID_LIVE_INTEGRATIONS=true` + `EDR_ACCESS_TOKEN`; otherwise
fixture mode). Proven offline in CI (`pnpm run proof:edr-threat`), and fused with
the other dimensions by `@workspace/posture-composition`.

## Identity / SSO sign-in risk — gated

> **Library surface, not wired into the served `/v1` decision path in this build.** Exercised by its `proof:*` script; `artifacts/api-server/src` does not import `@workspace/integrations` and never reads `IDENTITY_RISK_ACCESS_TOKEN` (measured 2026-09-06, see the note under the environment table).

Every other dimension asks about the **device**; this one asks about the
**person/session**: is the identity signing in actually who they claim, or is it
compromised? The read-only **identity-risk connector** reads per-principal risk
state + risk detections from an IdP's risk engine (shaped for Microsoft Entra ID
Protection risky-users/risk-detections, Okta ThreatInsight, Ping Identity, Cisco
Duo, Google Workspace context-aware access), and a **pure, deterministic
evaluator** aggregates them into one posture (`trusted` / `low_risk` / `at_risk` /
`high_risk` / `compromised` / `unknown`) plus the action it warrants (`none` /
`monitor` / `step_up` / `alert` / `restrict` / `escalate`). Fail-safe by
construction: a principal with **no IdP risk coverage** is a blind spot (never
"trusted"), a **confirmed-compromised** identity escalates, an **unclassifiable
detection** is never treated as benign, and a **risky sign-in that bypassed MFA**
is treated as worse than one that didn't (a step-up can't fix a factor that was
already skipped). Read-only by construction and gated exactly like every other
integration (live only on `beta`/`prod` + `SIGNALGRID_LIVE_INTEGRATIONS=true` +
`IDENTITY_RISK_ACCESS_TOKEN`; otherwise fixture mode). Proven offline in CI
(`pnpm run proof:identity-risk`), and fused with the other dimensions by
`@workspace/posture-composition`.

## RTLS / badge-dwell physical custody — gated

> **Library surface, not wired into the served `/v1` decision path in this build.** Exercised by its `proof:*` script; `artifacts/api-server/src` does not import `@workspace/integrations` and never reads `RTLS_ACCESS_TOKEN` (RTLS is a deferred family; measured 2026-09-06, see the note under the environment table).

The physical-plane signal that ties the cyber dimensions back to the two-plane
custody model: **where is the shared device physically, and is its custody
consistent with the badge checkout?** The read-only **RTLS connector** reads
per-device real-time zone, dwell, badge association, and egress state from a
Real-Time Location System (shaped for CenTrak, Stanley/HID AeroScout, Zebra
MotionWorks, Sonitor, Cisco Spaces, Kontakt.io), and a **pure, deterministic
evaluator** turns it into one custody posture (`in_zone` / `stale_fix` /
`off_zone` / `at_egress` / `abandoned` / `left_area` / `unknown`) plus the action
it warrants (`none` / `monitor` / `locate` / `alert` / `escalate`). Distinct from
location-services (GPS/geofence, on/off premises) — this is **indoor, zone-level,
and custody-aware**. Fail-safe by construction: a device **not currently detected
in the monitored area** is a custody breach (`escalate`), a **stale or
unconfirmable fix** means "go locate it", an **unattended device with no checkout
badge** is flagged abandoned, and an **untracked device** is a blind spot (never
"in custody"). Read-only by construction and gated exactly like every other
integration (live only on `beta`/`prod` + `SIGNALGRID_LIVE_INTEGRATIONS=true` +
`RTLS_ACCESS_TOKEN`; otherwise fixture mode). Proven offline in CI
(`pnpm run proof:rtls-custody`), and fused with the other dimensions by
`@workspace/posture-composition`.

## Removable-media / peripheral control — gated

> **Library surface, not wired into the served `/v1` decision path in this build.** Exercised by its `proof:*` script; `artifacts/api-server/src` does not import `@workspace/integrations` and never reads `PERIPHERAL_ACCESS_TOKEN` (measured 2026-09-06, see the note under the environment table).

The data-exfiltration / malware-ingress surface: is an unauthorized or unencrypted
removable device attached to the shared device? On a shared frontline (especially
clinical) workstation, a writable USB drive is a real HIPAA/exfil and ingress
vector. The read-only **peripheral-control connector** reads per-device attached-
peripheral inventory + device-control policy state from a device-control platform
(shaped for Microsoft Intune device control, Microsoft Defender for Endpoint device
control, CrowdStrike Falcon Device Control, Ivanti Device Control, Forcepoint), and
a **pure, deterministic evaluator** turns it into one posture (`no_removable` /
`controlled` / `policy_unenforced` / `unencrypted_media` / `unauthorized_media` /
`exfil_risk` / `unknown`) plus the action it warrants (`none` / `monitor` /
`step_up` / `alert` / `restrict`). Fail-safe by construction: a writable removable
whose **authorization or encryption we cannot confirm** is treated as the exfil/
ingress surface it might be (never assumed safe), an **unknown access value** on a
storage device is treated as writable, and a device with **no device-control
coverage** is a blind spot (never "clean"). Read-only by construction and gated
exactly like every other integration (live only on `beta`/`prod` +
`SIGNALGRID_LIVE_INTEGRATIONS=true` + `PERIPHERAL_ACCESS_TOKEN`; otherwise fixture
mode). Proven offline in CI (`pnpm run proof:peripheral-control`), and fused with
the other dimensions by `@workspace/posture-composition`.

## Data-protection / DLP posture — gated

> **Library surface, not wired into the served `/v1` decision path in this build.** Exercised by its `proof:*` script; `artifacts/api-server/src` does not import `@workspace/integrations` and never reads `DLP_ACCESS_TOKEN` (measured 2026-09-06, see the note under the environment table).

The peripheral-control dimension covers the hardware exfil surface (attached
removable media); this one covers the **data exfil surface across every channel** —
a sensitive file leaving via cloud upload, personal email, web post, print, or
clipboard is a data-loss event regardless of hardware. The read-only **DLP
connector** reads per-device DLP policy state + recent violations from a data-
protection platform (shaped for Microsoft Purview DLP, Forcepoint, Symantec/
Broadcom DLP, Zscaler, Netskope), and a **pure, deterministic evaluator** turns
them into one posture (`protected` / `monitored` / `policy_unenforced` /
`data_egress` / `confirmed_exfiltration` / `unknown`) plus the action it warrants
(`none` / `monitor` / `step_up` / `alert` / `restrict` / `escalate`). Fail-safe by
construction: a violation whose outcome we **cannot confirm was blocked** is
treated as data that may have left, **regulated data (PHI/PII/PCI) that egressed**
escalates, unenforced DLP policy is a gap, and a device with **no DLP coverage** is
a blind spot (never "protected"). Read-only by construction and gated exactly like
every other integration (live only on `beta`/`prod` + `SIGNALGRID_LIVE_INTEGRATIONS=true`
+ `DLP_ACCESS_TOKEN`; otherwise fixture mode). Proven offline in CI
(`pnpm run proof:data-protection`), and fused with the other dimensions by
`@workspace/posture-composition`.

**Fixture-safe by default:** even at `SIGNALGRID_TIER=prod`, no live vendor calls
are made unless `SIGNALGRID_LIVE_INTEGRATIONS=true` is also set — so this stack is
safe to stand up for evaluation without any external credentials. And in this build the
flag has nothing to enable in the served API: the connector families above are not
imported by `artifacts/api-server/src` (`artifacts/api-server/src/lib/assurance.ts`
records the same — "permits live calls; none exist").

## Schema — migrate first, then boot

Do not rely on first-connect table creation: a real deployment runs the API as
the minimally-privileged `signalgrid_runtime` role, which owns nothing and may
not create tables — the ledger is append-only **by privilege** (migration v2;
see `docs/BACKUP_AND_RESTORE.md` § "The runtime role"). The sequence is:

1. **Migrate with the admin credential** — `DATABASE_URL="$ADMIN_DATABASE_URL"
   pnpm run db:migrate`. This creates the schema AND provisions the role split;
   it refuses up front (nothing half-applied) if the credential cannot. (The
   variable form is deliberate: a `<admin>` placeholder pasted literally is
   shell redirection and dies on `admin: No such file or directory`.)

   **Against the bundled two-service stack**, the database is deliberately
   unpublished and the api image carries no migration source, so use the
   migration overlay to reach it from a repo checkout. Export the admin URL
   once — step 2 below reads the same variable:

   ```bash
   docker compose -f docker-compose.prod.yml -f docker-compose.migrate.yml up -d db
   export ADMIN_DATABASE_URL=postgres://sg:sg@127.0.0.1:55432/signalgrid
   DATABASE_URL="$ADMIN_DATABASE_URL" pnpm run db:migrate
   ```

   The overlay publishes Postgres on the loopback only. Keep it active
   through step 2 (the password command uses the same loopback URL); after
   both steps, `docker compose -f docker-compose.prod.yml up -d db`
   re-creates the db unpublished. (The CI deploy-stack job runs exactly
   this sequence.)
2. **Set the runtime password out of band** —
   `psql "$ADMIN_DATABASE_URL" -c '\password signalgrid_runtime'` (prompts;
   never inline a password into a command).
3. **Boot the API as the runtime role** — export `DATABASE_URL` pointing at
   `signalgrid_runtime` before
   `docker compose -f docker-compose.prod.yml up -d` (name the file: a bare
   `docker compose up` selects `docker-compose.yml`, which passes neither
   the profile nor `DATABASE_URL` — the exported credential is discarded
   and the stack serves review-demo). The prod compose file interpolates it
   (`${DATABASE_URL:-…}`), falling back to the zero-step owner URL only
   when unset. Store initialization is LAZY: the process starts and
   `/healthz` goes green before any database work happens, so a wrong runtime
   password or missing grant is not a boot failure. The stores verify their
   exact privileges on first use and on every `/readyz`.
4. **Verify readiness before taking traffic** — `curl -sf
   http://localhost:8080/api/readyz`. This is the call that exercises the
   database with the runtime credential and its privilege probes (including
   the forbidden direction on the ledger); a 503 here names the remedy.
   `/healthz` is liveness only and must stay database-free — wiring readiness
   into the compose healthcheck would restart-loop a working process through
   any database blip.

`pnpm run db:migrate` is also the repair command: on an already-current
database it re-applies the idempotent role split, so a dropped grant is fixed
by exactly the command the error messages name.

## Upgrade and rollback

Upgrades: migrate first (admin credential), then roll the API image. The
migration runner applies only versions the database has not recorded.

Rollbacks: rolling the API image back is always safe against the same schema.
Rolling back **past a migration** is a restore, not a downgrade — migrations
have no down path by design, and `db:migrate` refuses a database from the
future. Use `pnpm run db:restore` with the pre-upgrade backup
(`docs/BACKUP_AND_RESTORE.md`); the restore re-applies the privilege posture
itself.

## What this deployment decides about

Be precise about the decision core this stack serves: the API boots the
demo-seeded core (`artifacts/api-server/src/lib/core.ts:32` —
`SignalGridCore.demo()`), whose only constructor path is the demo factory with
a fixed clock (`lib/signalgrid-core/src/engine.ts:51,92`). The
`shared-device-gateway` profile fences off the demo *surfaces* (credential
dispenser, simulator, demo bearers), but the tenants, identities, and devices
the core evaluates are still the seeded fixtures — a customer's own directory
and fleet are not yet wired in. That gap is declared mechanically in
`scripts/launch-profile.mjs` (GAPS: `non-demo-core-constructor`) and closes
when the served core stops being `SignalGridCore.demo()`.

## How it's validated

The `deploy-stack` CI job builds this exact image, brings up the api+Postgres
stack, and runs `scripts/smoke-stack.mjs` against it — evaluating a real
decision, reading it back from Postgres, verifying its evidence, confirming
cross-tenant isolation, and scraping `/metrics`. The same smoke script runs
against any running stack (`BASE_URL=… node scripts/smoke-stack.mjs`).

## Not included here (needs your infrastructure)

Managed secrets, TLS termination / a reverse proxy, backups and restore testing,
centralized log shipping, and alerting are deployment-environment concerns owned
by whoever operates the stack — see `docs/SECURITY_CONTROLS_MATRIX.md` for the
full production-controls picture.
