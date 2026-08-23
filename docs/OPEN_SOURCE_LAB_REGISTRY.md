# Open-source lab registry

The owner's 30-repo research index, made a governed artifact. This is the human
half; the machine half is [`docs/agent/open-source-lab-registry.json`](agent/open-source-lab-registry.json)
and the gate is `scripts/check-lab-registry.mjs` (`--self-test` proves the gate
can fail; the live run cross-checks this table against the JSON and the JSON
against the disk). Transcribed from the owner research directive, 2026-08-21.

## The classification rule

Every external system relates to SignalGrid through exactly one boundary, and
the boundary never changes shape:

> external system → source adapter → normalized evidence → freshness +
> provenance + contradictions → deterministic policy → verdict

A repository in this index is therefore never "part of SignalGrid". It is one of
six things:

| Classification | Meaning |
| --- | --- |
| `LAB_SOURCE` | A real external system the lab stands up (or intends to) so adapters have something true to talk to. |
| `PRODUCTION_CONNECTOR_TARGET` | A system a shipping connector would target. Connector scope is frozen (DR-005), so these are targets on paper, not connectors in the tree. |
| `OPEN_STANDARD` | A schema or vocabulary studied for field naming and interop — read, never embedded. |
| `REFERENCE_ARCHITECTURE` | A design studied for how it solves a problem SignalGrid also has. The decision core stays in-house, deterministic, and fixture-backed. |
| `INTERNAL_COMPANY_TOOL` | Tooling for the company's own build/release/ops surface. Never product surface. |
| `DEFERRED_RESEARCH` | On the owner's radar, not in any lane today. |

**The never-rule:** no repository's code is copied or embedded into SignalGrid
until its licence has been reviewed against the distribution model. Studying a
design, deploying a service as a separate container, and speaking a wire
protocol are not the same act as embedding code — the caution flags below mark
where that review is mandatory before reuse of any kind.

## The index

Ranks 1–30 are the owner's original ranking; unranked rows arrived with the
2026-08-21 research report. `Tier` is the build priority (P0 prove the
product / P1 prove the enterprise workflow / P2 ecosystem depth) — a P1 tier
on a `DEFERRED_RESEARCH` row means "picked up at that phase", not "in use".
`Owner` is the org-roster role accountable for the relationship; the gate
fails on any owner the roster does not carry.

| Rank | Repo | Classification | Tier | Owner | Licence | Caution | Deployed today |
| ---: | --- | --- | :-: | --- | --- | :-: | :-: |
| 1 | `fleetdm/fleet` | LAB_SOURCE | P0 | `endpoint-uem-domain` | MIT (open core; ee/ paid) | — | yes |
| 2 | `keycloak/keycloak` | LAB_SOURCE | P0 | `iam-domain` | Apache-2.0 | — | yes |
| 3 | `h-mdm/hmdm-server` | LAB_SOURCE | P1 | `endpoint-uem-domain` | Apache-2.0 | — | no |
| 4 | `microsoftgraph/msgraph-sdk-javascript` | PRODUCTION_CONNECTOR_TARGET | P0 | `endpoint-uem-domain` | MIT | — | no |
| 5 | `open-telemetry/opentelemetry-collector` | OPEN_STANDARD | P0 | `sre` | Apache-2.0 | — | yes |
| 6 | `open-policy-agent/opa` | REFERENCE_ARCHITECTURE | P1 | `solutions-architect` | Apache-2.0 | — | no |
| 7 | `cedar-policy/cedar` | REFERENCE_ARCHITECTURE | P1 | `solutions-architect` | Apache-2.0 | — | no |
| 8 | `wazuh/wazuh` | LAB_SOURCE | P1 | `secops-domain` | GPL-2.0 | ⚠️ | yes |
| 9 | `glpi-project/glpi` | LAB_SOURCE | P0 | `itsm-ops-domain` | GPL-3.0 | ⚠️ | no |
| 10 | `FreeRADIUS/freeradius-server` | DEFERRED_RESEARCH | P1 | `network-domain` | GPL-2.0 | ⚠️ | no |
| 11 | `inverse-inc/packetfence` | DEFERRED_RESEARCH | P2 | `network-domain` | GPL-2.0 | ⚠️ | no |
| 12 | `ocsf/ocsf-schema` | OPEN_STANDARD | P0 | `secops-domain` | Apache-2.0 | — | no |
| 13 | `PostHog/posthog` | DEFERRED_RESEARCH | P1 | `lifecycle-activation` | MIT (open core) | — | no |
| 14 | `anchore/syft` | INTERNAL_COMPANY_TOOL | P0 | `release-engineer` | Apache-2.0 | — | no |
| 15 | `anchore/grype` | INTERNAL_COMPANY_TOOL | P0 | `release-engineer` | Apache-2.0 | — | no |
| 16 | `sigstore/cosign` | INTERNAL_COMPANY_TOOL | P0 | `release-engineer` | Apache-2.0 | — | no |
| 17 | `Velocidex/velociraptor` | DEFERRED_RESEARCH | P2 | `secops-domain` | AGPL-3.0 | ⚠️ | no |
| 18 | `SigmaHQ/sigma` | OPEN_STANDARD | P2 | `secops-domain` | Detection Rule License (custom, non-SPDX) | ⚠️ | no |
| 19 | `zeek/zeek` | DEFERRED_RESEARCH | P2 | `network-domain` | BSD-3-Clause | — | no |
| 20 | `OISF/suricata` | DEFERRED_RESEARCH | P2 | `network-domain` | GPL-2.0 | ⚠️ | no |
| 21 | `prometheus/prometheus` | INTERNAL_COMPANY_TOOL | P0 | `sre` | Apache-2.0 | — | yes |
| 22 | `grafana/grafana` | DEFERRED_RESEARCH | P1 | `sre` | AGPL-3.0 | ⚠️ | no |
| 23 | `openfga/openfga` | REFERENCE_ARCHITECTURE | P2 | `solutions-architect` | Apache-2.0 | — | no |
| 24 | `micromdm/nanomdm` | REFERENCE_ARCHITECTURE | P2 | `endpoint-uem-domain` | MIT | — | no |
| 25 | `gravitational/teleport` | REFERENCE_ARCHITECTURE | P2 | `iam-domain` | AGPL-3.0 (community edition) | ⚠️ | no |
| 26 | `langfuse/langfuse` | DEFERRED_RESEARCH | P1 | `agent-ops-economics` | MIT (open core) | — | no |
| 27 | `promptfoo/promptfoo` | INTERNAL_COMPANY_TOOL | P1 | `agent-ops-economics` | MIT | — | no |
| 28 | `zammad/zammad` | DEFERRED_RESEARCH | P2 | `itsm-ops-domain` | AGPL-3.0 | ⚠️ | no |
| 29 | `twentyhq/twenty` | DEFERRED_RESEARCH | P2 | `design-partner-outreach` | AGPL-3.0 | ⚠️ | no |
| 30 | `n8n-io/n8n` | INTERNAL_COMPANY_TOOL | P2 | `devex-tooling-engineer` | Sustainable Use License (NOT open source) | ⚠️ | no |
| — | `osquery/osquery` | REFERENCE_ARCHITECTURE | P0 | `endpoint-uem-domain` | multiple licences reported by GitHub — inspect per file | ⚠️ | yes |
| — | `microsoftgraph/msgraph-metadata` | OPEN_STANDARD | P0 | `api-contract-architect` | MIT | — | no |
| — | `microsoftgraph/msgraph-sdk-powershell` | INTERNAL_COMPANY_TOOL | P1 | `endpoint-uem-domain` | MIT | — | no |
| — | `modelcontextprotocol/typescript-sdk` | OPEN_STANDARD | P0 | `agent-ops-economics` | MIT (existing code) / Apache-2.0 (new contributions) | — | no |
| — | `modelcontextprotocol/servers` | REFERENCE_ARCHITECTURE | P2 | `agent-ops-economics` | MIT (existing code) / Apache-2.0 (new contributions) | — | no |
| — | `usebruno/bruno` | INTERNAL_COMPANY_TOOL | P0 | `api-contract-architect` | MIT core; commercial offerings exist | — | no |
| — | `usebruno/bruno-mcp` | DEFERRED_RESEARCH | P2 | `agent-ops-economics` | unspecified in surfaced repository metadata | ⚠️ | no |
| — | `grokability/snipe-it` | LAB_SOURCE | P2 | `itsm-ops-domain` | AGPL-3.0 | ⚠️ | no |
| — | `Ylianst/MeshCentral` | DEFERRED_RESEARCH | P2 | `endpoint-uem-domain` | Apache-2.0 |  | no |
| — | `netbox-community/netbox` | REFERENCE_ARCHITECTURE | P2 | `network-domain` | Apache-2.0 |  | no |
| — | `github/github-mcp-server` | INTERNAL_COMPANY_TOOL | P1 | `devex-tooling-engineer` | MIT |  | no |
| — | `grafana/mcp-grafana` | INTERNAL_COMPANY_TOOL | P2 | `sre` | Apache-2.0 |  | no |
| — | `amidaware/tacticalrmm` | DEFERRED_RESEARCH | P2 | `endpoint-uem-domain` | source-available, NOT open source; commercial/SaaS use restricted | ⚠️ | no |
| 9 | `openbao/openbao` | INTERNAL_COMPANY_TOOL | P0 | `secops-domain` | MPL-2.0 |  | no |
| 18 | `goauthentik/authentik` | LAB_SOURCE | P1 | `iam-domain` | MIT core; enterprise components separately licensed | ⚠️ | no |
| 28 | `aquasecurity/trivy` | INTERNAL_COMPANY_TOOL | P1 | `release-engineer` | Apache-2.0 |  | no |
| — | `louislam/uptime-kuma` | DEFERRED_RESEARCH | P2 | `sre` | MIT |  | no |
| — | `zitadel/zitadel` | DEFERRED_RESEARCH | P2 | `iam-domain` | AGPL-3.0 | ⚠️ | no |

## The deployed-lab truth

"Deployed today" means one thing: `scripts/run-live-lanes.sh` starts the
service. That script runs **five lanes** — `fleet` (Fleet server + MySQL +
Redis + a real enrolled osqueryd agent), `location` (Traccar), `keycloak`
(Keycloak with DPoP), `edr` (Wazuh manager), and `telemetry` (OTel Collector +
Prometheus, opt-in via `--with-telemetry` or `--only telemetry`). That makes
**six** entries deployed, each with `deployedEvidence:
scripts/run-live-lanes.sh` in the JSON: **Fleet**, **Keycloak**, **Wazuh**,
**osquery** (the enrolled agent the `fleet` lane starts), **OpenTelemetry
Collector**, and **Prometheus**. The last two flipped on 2026-08-21 when the
telemetry lane first executed anywhere — on the Mac lane, because the cloud
session had no runnable container engine that day; the run asserted
`signalgrid_up` traversing api `/metrics` -> collector -> Prometheus, recorded
in `artifacts/sim-results/2026-08-21-telemetry-lane-first-run.json`. Traccar
(the `location` lane) runs too but is not one of the owner's ranked repos, so
it appears here only as this note. Everything else is not deployed, and the
gate fails any entry that claims otherwise without evidence on disk.

## Licence caution

`licenceCaution: true` marks the families where the never-rule bites hardest:

- **GPL-2.0 / GPL-3.0** (Wazuh, GLPI, FreeRADIUS, PacketFence, Suricata) and
  **AGPL-3.0** (Velociraptor, Grafana, Teleport community, Zammad, Twenty):
  copyleft. Running them as separate lab containers and talking to their APIs is
  fine; copying code into this MIT-licensed tree, linking, or (for AGPL)
  offering them over a network as part of a product each trigger obligations
  that need a distribution-model review first.
- **Custom / non-SPDX terms**: SigmaHQ's rules ship under the Detection Rule
  License, and **n8n's Sustainable Use License is not an open-source licence at
  all** — n8n is classified `INTERNAL_COMPANY_TOOL` with that restriction stated
  in its entry: internal use only, never distributed or embedded.
- **Open core** (Fleet, PostHog, Langfuse): the repo licence does not cover the
  paid directories (Fleet's `ee/` is the recorded example). Reuse review must
  check the path, not just the repo.

## What we deploy now vs later

**Now** (tooling and lab surface only — launch scope is frozen under DR-005):
the three deployed `LAB_SOURCE` systems above, run as containers by
`scripts/run-live-lanes.sh` so the adapters and `proof:live-*` gates have real
systems to be truthful against. The `INTERNAL_COMPANY_TOOL` rows are candidates
for the company's own build/release/ops pipeline and never touch product
surface.

**Later, and only after licence review**: everything marked
`DEFERRED_RESEARCH` waits for a decision record; `PRODUCTION_CONNECTOR_TARGET`
waits for the connector-scope freeze to lift; `REFERENCE_ARCHITECTURE` and
`OPEN_STANDARD` rows are read, cited, and never embedded. Any change to a row's
classification, licence, caution flag, or deployed status is made in the JSON
and this table together — `scripts/check-lab-registry.mjs` fails the build when
the two halves disagree.
