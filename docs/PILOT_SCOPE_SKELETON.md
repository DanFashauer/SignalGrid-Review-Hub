# Pilot Scope Skeleton — DRAFT

> **Status: DRAFT skeleton, awaiting owner completion and a named design partner.**
> This is the document the launch criterion's "one design partner" conversation
> converges on. The structural sections are written; every `OWNER:` field is a
> decision only the owner can make, left blank on purpose rather than filled with a
> plausible default — a skeleton with invented specifics would read as a plan
> nobody agreed to.

## Parties and term

- **Partner:** `OWNER: named organization`
- **Internal champion:** `OWNER: named person at the partner`
- **Pilot term:** `OWNER: start date, end date` (recommend a fixed end date; an
  open-ended pilot is a free production deployment with extra steps)
- **Commercial terms:** `OWNER:` (the criterion says "one paid deployment" — decide
  whether the pilot itself is paid or converts to paid)

## What the pilot exercises

The Limited GA launch surface as declared in `scripts/launch-profile.mjs` and held
against the repository by `scripts/check-launch-profile.mjs` — nothing that is
`deferred`, `demo_only`, or `internal` in the profile is part of the pilot:

1. **The Assist gate** — the partner's host app calls `/v1/decisions/evaluate` and
   renders the verdict. The reference integration is `ios:EnterpriseShell`
   (`native/ios/`); the partner integrates their **own** host app, per the embedded
   UX law: SignalGrid is invisible to end workers.
2. **The evidence source** — the open-source MDM lab path first (Fleet, via the
   `DeviceManagementEvidence` contract in `lib/integration-bridge`), with
   Entra/Intune as the enterprise chapter per the staged path in
   `docs/PARTNER_ONBOARDING.md`. Adapters supply evidence only; the partner's MDM
   remains the system of record.
3. **The operator console** — `signalgrid-app`, reading the served `/v1` API:
   decisions list, decision detail with reason codes and digest-verified evidence,
   the audit view, an assurance label on every verdict.
4. **Fleet shape:** `OWNER: which workflows, which device fleet, how many shared
   devices, which sites` (the review-deck activation narrative describes this
   triple — workflows, fleet, integration stack — as what "pilot scope is defined"
   means; this is where it gets defined for real).

## What the pilot is not — read to the partner, verbatim

- **Not a production deployment.** No SLA, no on-call, no incident-response
  process is claimed (`docs/SECURITY_QUESTIONNAIRE_PACK.md` says this to
  assessors; the pilot agreement should say it to the partner).
- **Not enforcement.** Limited GA runs in shadow mode: the gate returns `step_up`
  and no launch route answers one. The pilot measures whether the verdicts are
  *right*, not whether they *bind* — a declared, machine-checked gap in the launch
  profile.
- **Not an MDM.** SignalGrid consumes device-management evidence; it cannot grant
  device access, restrict apps, or self-kiosk, and the pilot must not be scoped as
  if it could (`threat_model.md`).
- **No customer data in the repository.** Pilot telemetry and partner data live in
  the partner's deployment; nothing from the pilot may be committed here
  (`AGENTS.md`).
- **No compliance coverage.** No SOC 2, no BAA. If the partner is in a regulated
  vertical, their compliance review gates the pilot — not ours, because we do not
  have one to offer.

## Success criteria

Skeleton — the owner picks the thresholds with the partner, and the thresholds are
written down **before** the pilot starts, because criteria chosen after the data
arrives are not criteria:

- **Decision quality:** `OWNER: target` — fraction of gate verdicts the partner's
  operators judge correct on review, measured from the console's decision list over
  a named period.
- **Evidence freshness:** `OWNER: target` — fraction of decisions made on signals
  within their declared freshness window (the per-signal freshness is on every
  decision detail).
- **Integration cost:** `OWNER: target` — engineering days for the partner to wire
  their host app to `/v1/decisions/evaluate` against the reference shell.
- **Operator adoption:** `OWNER: target` — does anyone at the partner open the
  console unprompted in week N?

## Exit and rollback

- **Exit review:** `OWNER: date` — the criteria above, scored, in writing.
- **Rollback:** the host app removes its gate call; because SignalGrid enforces
  nothing and holds no partner data, rollback is complete when that call is gone.
  This one-paragraph rollback story is a genuine selling point of the
  evidence-only architecture — use it.
- **Data on exit:** nothing to return or destroy on our side by construction; the
  partner's deployment and its data are theirs.

## Open owner decisions this document waits on

Tracked here so the skeleton cannot quietly read as ready:

1. The named partner and champion.
2. Paid pilot vs converting pilot.
3. Retention durations for the pilot deployment's decision/audit data.
4. Whether the graph transport default flips before or during the pilot (the
   `device-management-health` gap in `scripts/launch-profile.mjs`).

*A fifth item — "Ratification of launch-profile v4 classifications" — was listed
here as OPEN until 2026-09-02. It was not open: DR-005 ratified v4 in full on
2026-08-20, and the profile has since moved to v5 (DR-023). A decided question
sitting on an open-decisions list is a false claim about what the owner still owes.*
