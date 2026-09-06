# Autopilot Intake Bot

> **SUPERSEDED 2026-09-06 in its "parked, not implemented" list — do not read it as current.**
> Last substantively written 2026-08-03; its sibling Autopilot pages carry ⛔ RETIRED
> 2026-08-15 banners. Three of the themes it parks ship as connector families with
> registered proofs — `access-governance`, `platform-sso`, `network-nac` under
> `lib/integrations/src/integrations/` — and the proof sequence it assumes was redirected
> by DR-012 (Fleet-first). The taxonomy is kept as a dated record.

The Intake Bot converts screenshots, links, notes, PR summaries, and workflow findings into public-safe backlog entries. It does not implement phases by itself.

## Classification taxonomy

Classify each input as one or more of:

- product thesis
- signal source
- credential/custody signal
- connector candidate
- workflow automation
- proof/scenario expansion
- dashboard/demo improvement
- platform strategy
- buyer/partner thesis
- pitch material
- live-integration blocked item
- parking-lot item

## Intake record

Each record should include input source, classification, proposed deliverable, risk lane, status, dependencies, validation, and notes. Ambiguous or high-risk material should be parked rather than implemented.

## Parked recent themes

These themes were intentionally parked for future scoped phases and were not implemented by the Autopilot Control Plane PR *(as written 2026-08-03; on 2026-09-06 the Entra governance, Platform SSO and network-segmentation themes SHIP as `access-governance`, `platform-sso` and `network-nac` — see the banner)*:

- IAM market signals / strategic buyer and partner thesis
- Microsoft Endpoint / Intune Lab Readiness
- Entra Identity Fabric / Governance Signal Model
- Healthcare operating-model demo narrative
- Apple + Intune ADE / Platform SSO enrollment signal model
- Network Trust / Cisco ACI segmentation model
- Approval-gated PowerShell remediation model
- Apple on-device AI / local assistant strategy

## Public-safety handling

Live vendor access, live Microsoft Graph access, tenant identifiers, customer data, PHI/PII, real device actions, MDM/PACS/IAM writes, and unsupervised production remediation stay blocked. Future work should begin fixture-backed and read-only unless the owner explicitly approves a safe private-test context.
