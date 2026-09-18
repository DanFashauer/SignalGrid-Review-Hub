# Secret model — the rules that exist BEFORE the first stored secret

Backlog row 35, ordered the METRIC_STANDARDS way: the model is written and
ratified before OpenBao holds anything, because the moment credentials move
into a secret manager is the moment its conventions fossilize. Owned by
`secops-domain`. Adoption authority: DR-010, RATIFIED by the
owner 2026-08-22 — write authority granted; unseal custody with the owner,
outside this repository. (The DR-008 gate held the row at
`mutationsAllowed: false` until this ratification existed, firing once on an
intake attempt to record otherwise — the gate working.)

## What exists today, honestly

Roughly **75 distinct credential-shaped environment names** across the
api-server, connectors and harnesses (`*_ACCESS_TOKEN` per connector family,
`METRICS_TOKEN`, `SIGNALGRID_ENROLLMENT_SECRET`, fixture tokens, plus
`DATABASE_URL`/`PGPASSWORD`). Nearly all are **fixture/lab tokens** — the
decision core is fixture-backed by design and CI mints throwaways — so this
is not a leak in progress. It becomes one the day a REAL tenant credential
(a Graph application secret, a Fleet API token against a customer instance)
follows the same path. The boundary must exist before that day.

## The five rules

1. **Naming is the audit trail.** Every secret lives at
   `sg/<env>/<consumer>/<source-family>/<purpose>` — e.g.
   `sg/lab/api-server/graph/app-token`,
   `sg/prod/connector-fleet/fleet/read-token`. `<env>` is `lab` or `prod`,
   never mixed in one mount. A secret whose path cannot name its single
   consumer does not get created — shared secrets are the anti-pattern this
   scheme exists to make visible.

2. **Service identities, not people, not agents.** Each consumer
   authenticates as its own identity (AppRole or equivalent) with a policy
   scoped to its own subtree, read-only unless the DR for that identity says
   otherwise. No wildcard policies. The owner's break-glass identity is the
   only human path and its use is an audited event.

3. **What an agent may NEVER hold** — the report's warning, made a rule:
   secret-zero (the credential that bootstraps a service identity), unseal
   or recovery key material, the root token, and any secret VALUE in
   conversation. An AI lane may request that a consumer be issued a
   credential; it may never read one back. Tooling returns lease metadata
   (path, TTL, version), never the material. The MCP surface, if it ever
   touches this system, gets health and metadata reads only — this is
   already the posture DR-008 assumes.

4. **Leases over lifetimes.** Everything issued has a TTL and a renewal
   path; static long-lived secrets are the migration INPUT, not an allowed
   end state. Rotation is proven by rotating: the row-35 acceptance test is
   that the old credential stops working and nothing else does. A rotation
   that has never been executed is a runbook claim, not a capability.

5. **The store is not the backup of itself.** Sealed-storage snapshots ride
   the existing backup discipline (manifest counts, restore actually
   exercised — the ledger-restore precedent applies). Unseal/recovery
   material lives with the owner, outside the repository, outside any
   agent's reach, and its custody is recorded in DR-010 when ratified.

## Migration order (when DR-010 is ratified and an engine exists)

1. Stand up OpenBao in the lab profile (`run-live-lanes.sh` idiom: pinned
   image, health-checked, skip-with-reason).
2. Migrate ONE real credential end to end — `DATABASE_URL` for the lab
   Postgres is the candidate: highest blast radius, simplest consumer.
3. Prove rotation on it (rule 4's acceptance test).
4. Only then batch the connector-family tokens, lab first.
5. Fixture tokens in CI stay env-minted throwaways — moving worthless
   secrets into a vault adds ceremony, not security, and the model says so
   rather than pretending otherwise.

## What is IMPLEMENTED, and what is still a runbook claim (2026-09-18)

The model above is unchanged. What changed is that one piece of it is now code,
and the piece was chosen because without it none of the rest could start.

**Implemented — `lib/secrets` ([`lib/secrets/src/index.ts`](../lib/secrets/src/index.ts)),
proven by `pnpm run proof:secrets` (28 checks; `--self-test` plants an
unconfigured secret that accepts anything and the proof catches it):**

- **One read site.** Every secret the served api-server reads is named in that
  module's `REGISTRY` and reached through it. The proof scans
  `artifacts/api-server/src` and fails if any registered name is read off
  `process.env` directly, so "one place" is checked rather than asserted. The
  five today: `METRICS_TOKEN`, `SIGNALGRID_ENROLLMENT_SECRET`,
  `SIGNALGRID_ESTATE_OWNER_TOKEN`, `SIGNALGRID_ESTATE_OPERATOR_TOKEN`,
  `GRAPH_ACCESS_TOKEN`. An **unregistered** name is refused outright.
- **A rotation WINDOW — rule 4's acceptance test, executed.** Every secret has a
  `NAME_NEXT` successor. While both are set, an inbound secret accepts **either**
  value; once the successor is promoted and deleted, the old credential stops
  working and nothing else does. That sentence was the acceptance test and is now
  a check. Before this there was no window at all: the instant an operator changed
  a variable, every caller holding the old value was refused.
- **Fail closed, in the directions that cost nothing to state.** An unconfigured
  secret matches **nothing**, including the empty string; a variable set to `""`
  or whitespace reads as unconfigured **and** is reported present-but-blank, so a
  consumer can refuse at boot rather than serve open (which `/metrics` once did).
  Comparison is constant-time over digests, and every candidate is compared with
  no early return, so the timing does not reveal how far into a rotation a
  deployment is.
- **No value is loggable.** The printable status carries an 8-character SHA-256
  fingerprint and never the material; the boot line prints the whole inventory
  that way. There is deliberately no accessor that returns the values together.
- **Direction is enforced.** An inbound secret is compared and can never be read
  out; an outbound one is read out and can never be compared. An outbound
  successor is read and **reported** but deliberately not used — one Graph call
  carries one credential, and silently preferring the successor would make "which
  key made that request" unanswerable exactly when somebody needs to know.
- **The knobs are held to the deployment path.** `scripts/check-deployment-runbook.mjs`
  now reads the registry as a second source of boot-read names (the accessor reads
  `env[name]` through a parameter, invisible to a literal scan — which is how three
  variables silently dropped out of that gate the day they were routed through it),
  so every secret **and its successor** must appear in `docs/DEPLOYMENT.md`'s table
  and pass through `docker-compose.prod.yml`. A successor an operator cannot set is
  a rotation nobody can perform.

**Still a runbook claim, and named so it is not read as done:**

- **No OpenBao instance exists**, nothing has been migrated, and no secret has
  ever been rotated in a real deployment. The window exists; the migration in the
  section above has not started.
- **Naming (rule 1) is unenforced.** No `sg/<env>/<consumer>/<source-family>/<purpose>`
  path exists, because nothing stores anything. The registry names *variables*, not
  vault paths.
- **Service identities (rule 2), leases and TTLs (rule 4's other half), and sealed
  storage (rule 5) are entirely unbuilt.** `lib/secrets` fetches nothing, leases
  nothing, renews nothing and stores nothing. It is an environment reader with one
  door and a successor, and calling it a secret manager would be exactly the kind
  of claim this document exists to prevent.
- **`DATABASE_URL`, `REDIS_URL` and the OIDC settings are NOT in the registry.**
  They are read inside `@workspace/persistence`, `@workspace/webauthn` and
  `@workspace/enterprise-auth`, not in the api-server's own source, so routing them
  through this seam means changing those libraries. That is the next slice, not a
  claim about today.
- **The nine other `*_ACCESS_TOKEN` connector families are not registered** and are
  not reachable from the served bundle at all (see `docs/DEPLOYMENT.md`). Adding a
  family to the served core means adding its token here.

## What this document does NOT claim

No OpenBao instance exists yet; no secret has been migrated; rotation has
never been executed against a real credential in a real deployment. This is the
model that makes those steps reviewable when they happen — the registry row and
build-plan row 35 track the state. The section above is the honest boundary
between the model and the code.
