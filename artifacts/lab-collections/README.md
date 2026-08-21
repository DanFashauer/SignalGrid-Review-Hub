# Source collections — the lab services that actually run

Bruno collections for the **external lab services** `scripts/run-live-lanes.sh`
starts today — plus exactly one deliberate exception: `microsoft-graph/`, the
launch profile's production connector TARGET, whose collection transcribes the
connector's real transport for a tenant that does not exist in any lab (its
own README states why it is here and why it never runs in CI). Everything
else: deployed lanes only, and none that are not. Each subdirectory is a standalone
Bruno collection (its own `bruno.json` + `environments/`) — open the service
folder directly in Bruno, not this directory. They are deliberately separate
from the parent SignalGrid API collection: the parent maps the api-server's
own routes and is two-directionally gated by
`scripts/check-api-collection.mjs`; these map third-party surfaces that gate
has no business auditing, so it excludes `sources/` by name.

## What belongs here

A collection for a service **only if `scripts/run-live-lanes.sh` starts it**
(the launched-lane rule from the doctrine: "the lab runs X" only if the script
actually starts X). Today that is exactly four lanes:

| Folder | Lane | Container(s) | Started at |
| --- | --- | --- | --- |
| `fleet/` | `fleet` | `sg-fleet` (+ mysql, redis, osquery) | `scripts/run-live-lanes.sh:143` |
| `traccar/` | `location` | `sg-traccar` | `scripts/run-live-lanes.sh:238` |
| `keycloak/` | `keycloak` | `sg-keycloak` | `scripts/run-live-lanes.sh:258` |
| `wazuh/` | `edr` | `sg-wazuh` | `scripts/run-live-lanes.sh:295` |

Requests mirror the paths the repo's own connector/proof code already calls
(`lib/integrations`, `lib/fleet-connector`, `scripts/src/live-*-proof.ts`) —
this is a map of what SignalGrid actually reads, not a tour of each vendor's
API. Every request is **read-only evidence collection**; auth-bootstrap
requests (login/token) are the only POSTs, and nothing here creates users,
enrolls hosts, or deletes anything.

## What does NOT belong here

Aspirational or one-shot-history services — FreeRADIUS, and anything else on
the owner's research radar that has no repeatable lane — are registered in
`docs/OPEN_SOURCE_LAB_REGISTRY.md` as `DEFERRED_RESEARCH` (or `LAB_SOURCE`
once a lane exists) and get **no folder here** until `run-live-lanes.sh`
starts them. A collection for a service nobody can start is documentation of
an API that does not exist in the lab — the drift these collections exist to
prevent.

## Credentials

**No credentials beyond documented public image defaults and the script's own
per-run lab bootstrap values.** Everything in these environments is
public-safe by the same standing as the repo's existing precedent
(`.gitleaksignore`: wazuh:wazuh is the wazuh-manager image's DOCUMENTED
default API credential; mysql root/root the same): `admin`/`admin` is
Keycloak's `KC_BOOTSTRAP_ADMIN_*` container default, `wazuh`/`wazuh` the
Wazuh image default, and `sg@signalgrid.test` / `SignalGrid!2026x` is the lab
bootstrap account `run-live-lanes.sh` itself mints into a per-run localhost
container. Nothing here is, or may ever become, a real secret.

## The boundary

These requests collect **evidence**. No request here grants trust —
normalization and the decision stay in SignalGrid, per the boundary in
`docs/OPEN_SOURCE_LAB_REGISTRY.md`: external system → source adapter →
normalized evidence → freshness + provenance + contradictions →
deterministic policy → verdict.
