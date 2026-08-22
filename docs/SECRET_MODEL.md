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

## What this document does NOT claim

No OpenBao instance exists yet; no secret has been migrated; rotation has
never been executed. This is the model that makes those steps reviewable
when they happen — the registry row and build-plan row 35 track the state.
