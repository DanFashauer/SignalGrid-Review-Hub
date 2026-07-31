# Intake ledger — every idea in, every disposition out

The owner feeds SignalGrid a continuous stream of product inputs — screenshots,
infographics, PDFs, catalogs, links. Each one is assessed against the existing
fabric under a standing rule: **build genuine gaps, skip what is covered, and say
which happened**. This ledger is the durable record of that loop, committed so it
survives any session or container. Nothing submitted is allowed to vanish into a
chat scrollback.

Dispositions:

- **BUILT** — a genuine gap; shipped with a proof (commit ref given).
- **COVERED** — the fabric already models it; the covering surface is named.
- **OUT OF SCOPE** — outside the product boundary (e.g. tenant provisioning,
  write actuators, program/governance work) with the reason stated.
- **POSITIONED** — informed strategy/positioning docs rather than code.
- **PENDING** — submitted, not yet fully assessed. The queue to drain first.

## Ledger

| # | Input | Assessment | Disposition |
| --- | --- | --- | --- |
| 1 | ITSM KPIs table (19 KPIs) | Per-KPI review (18-agent workflow): 11 covered, 5 out of scope, 3 genuine | **BUILT** — resolution-timing axis on `response-accountability` (elapsed/target pair; SLA, time-to-restore, backlog aging). Metric-integrity KPI deliberately NOT built: `check-proof-figures` already answers "is this number re-derivable" by re-derivation |
| 2 | Palantir for Hospitals link ("problem or help?") | Competitive/segment analysis | **POSITIONED** — different category (operational data platform / ontology); not a competitor for the per-action frontline decision point. `docs/ECOSYSTEM_POSITIONING.md` gained the category row + objection handling |
| 3 | Palantir GitHub org + Foundry OSDK PDFs (TypeScript/Python) + dictionaryapi.dev | Reviewed for reusable patterns | **POSITIONED** — OSDK's typed-client codegen pattern noted; no dependency taken. Public repo stays vendor-neutral and fixture-backed |
| 4 | IT Support Communication Matrix (L1/L2/L3 flow) | The "user confirms fix" gate on L1/L2 branches is a watermelon route | **BUILT** — `resolutionEvidence` axis on `response-accountability`: user confirmation is never a signal re-check (`RESOLVED_ON_USER_CONFIRMATION_ONLY`, coherence gate) |
| 5 | Intune & Entra ID Complete Setup Handbook (5 pages) | Page-by-page against uem/policy-binding/identity-risk | **COVERED / OUT OF SCOPE** — tenant provisioning and licensing out of scope; dynamic groups covered by `policy-binding`; federation blind spot covered by `identity-risk` (`NOT_COVERED` → unknown/monitor). Built nothing, deliberately |
| 6 | Intune batch 2: activation/enrollment restrictions; enrollment methods; compliance/CA/endpoint security; apps-updates-reporting checklist; Intune Remediations SSO PDF | One genuine gap found: a policy that evaluates but does not act | **BUILT** — `enforcement` axis on `policy-binding` (report-only → monitor, disabled → restrict, absent → step_up). Grace period covered by `in_grace_period` (uem/graph); BYOD covered by the uem `ownership` axis; remediation scripts out of scope (write actuator) |
| 7 | NIST CSF 2.0 poster | All six functions already mapped in `docs/SECURITY_CONTROLS_MATRIX.md` (60 rows, verified by derivation); program work is human-owned | **COVERED** — built nothing. Corrected my own measurement in the process (a regex missed function-level tags) |
| 8 | CIS Benchmark catalog JSON (454 entries, 2026-07-30) + "follow these per workflow/persona" | The eighth unearned affirmative: `BaselineState` records the answer, nothing records whether the QUESTION was right | **BUILT** — `benchmark-selection` dimension (71-check proof, committed title-keyed catalog snapshot, licensing boundary enforced mechanically) + the `/v1` core arm (`benchmarkSelection` evidence field, active v1 misfit rule, v2 STRICT widening) |
| 9 | Cyber Resilience transition poster | Program-maturity model; its six bands map onto existing machinery (decision core, response-accountability, incident-playbook, proof/figure-guard evidence method) | **COVERED** — built nothing |

## How new intake is handled

1. A new upload gets a **PENDING** row here in the same change that starts its
   assessment — the row is the claim check.
2. Assessment runs against the existing fabric first (grep before build; the
   covering surface must be NAMED, not assumed).
3. The row is updated to its final disposition in the commit that closes it.
4. "Covered" and "out of scope" are first-class outcomes. The precedent that
   matters: batch 5 closed with *build nothing* — five pages, zero code, every
   page accounted for.
