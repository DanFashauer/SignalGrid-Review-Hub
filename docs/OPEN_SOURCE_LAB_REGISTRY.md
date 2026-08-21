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

## The index (owner-ranked, 1–30)

| Rank | Repo | Classification | Licence | Caution | Deployed today |
| ---: | --- | --- | --- | :-: | :-: |
| 1 | `fleetdm/fleet` | LAB_SOURCE | MIT (open core; ee/ paid) | — | yes |
| 2 | `keycloak/keycloak` | LAB_SOURCE | Apache-2.0 | — | yes |
| 3 | `h-mdm/hmdm-server` | LAB_SOURCE | Apache-2.0 | — | no |
| 4 | `microsoftgraph/msgraph-sdk-javascript` | PRODUCTION_CONNECTOR_TARGET | MIT | — | no |
| 5 | `open-telemetry/opentelemetry-collector` | DEFERRED_RESEARCH | Apache-2.0 | — | no |
| 6 | `open-policy-agent/opa` | REFERENCE_ARCHITECTURE | Apache-2.0 | — | no |
| 7 | `cedar-policy/cedar` | REFERENCE_ARCHITECTURE | Apache-2.0 | — | no |
| 8 | `wazuh/wazuh` | LAB_SOURCE | GPL-2.0 | ⚠ | yes |
| 9 | `glpi-project/glpi` | DEFERRED_RESEARCH | GPL-3.0 | ⚠ | no |
| 10 | `FreeRADIUS/freeradius-server` | DEFERRED_RESEARCH | GPL-2.0 | ⚠ | no |
| 11 | `inverse-inc/packetfence` | DEFERRED_RESEARCH | GPL-2.0 | ⚠ | no |
| 12 | `ocsf/ocsf-schema` | OPEN_STANDARD | Apache-2.0 | — | no |
| 13 | `PostHog/posthog` | DEFERRED_RESEARCH | MIT (open core) | — | no |
| 14 | `anchore/syft` | INTERNAL_COMPANY_TOOL | Apache-2.0 | — | no |
| 15 | `anchore/grype` | INTERNAL_COMPANY_TOOL | Apache-2.0 | — | no |
| 16 | `sigstore/cosign` | INTERNAL_COMPANY_TOOL | Apache-2.0 | — | no |
| 17 | `Velocidex/velociraptor` | DEFERRED_RESEARCH | AGPL-3.0 | ⚠ | no |
| 18 | `SigmaHQ/sigma` | OPEN_STANDARD | Detection Rule License (custom) | ⚠ | no |
| 19 | `zeek/zeek` | DEFERRED_RESEARCH | BSD-3-Clause | — | no |
| 20 | `OISF/suricata` | DEFERRED_RESEARCH | GPL-2.0 | ⚠ | no |
| 21 | `prometheus/prometheus` | DEFERRED_RESEARCH | Apache-2.0 | — | no |
| 22 | `grafana/grafana` | DEFERRED_RESEARCH | AGPL-3.0 | ⚠ | no |
| 23 | `openfga/openfga` | REFERENCE_ARCHITECTURE | Apache-2.0 | — | no |
| 24 | `micromdm/nanomdm` | REFERENCE_ARCHITECTURE | MIT | — | no |
| 25 | `gravitational/teleport` | REFERENCE_ARCHITECTURE | AGPL-3.0 (community edition) | ⚠ | no |
| 26 | `langfuse/langfuse` | DEFERRED_RESEARCH | MIT (open core) | — | no |
| 27 | `promptfoo/promptfoo` | INTERNAL_COMPANY_TOOL | MIT | — | no |
| 28 | `zammad/zammad` | DEFERRED_RESEARCH | AGPL-3.0 | ⚠ | no |
| 29 | `twentyhq/twenty` | DEFERRED_RESEARCH | AGPL-3.0 | ⚠ | no |
| 30 | `n8n-io/n8n` | INTERNAL_COMPANY_TOOL | Sustainable Use License (NOT open source) | ⚠ | no |

Licence values are recorded from owner research (2026-08-21) as commonly known;
where an entry carries a `basis` field in the JSON, verify against the upstream
repository before any code reuse.

## The deployed-lab truth

"Deployed today" means one thing: `scripts/run-live-lanes.sh` starts the
service. That script runs **four lanes** — `fleet` (Fleet server + MySQL +
Redis + a real enrolled osqueryd agent), `location` (Traccar), `keycloak`
(Keycloak with DPoP), and `edr` (Wazuh manager). Of the 30 repos in this index,
that makes exactly three deployed: **Fleet**, **Keycloak**, and **Wazuh**, each
with `deployedEvidence: scripts/run-live-lanes.sh` in the JSON. Traccar (the
`location` lane) runs too but is not one of the owner's 30 ranked repos, so it
appears here only as this note. Everything else — including Prometheus, which
is ranked but has no lane — is not deployed, and the gate fails any entry that
claims otherwise without evidence on disk.

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
