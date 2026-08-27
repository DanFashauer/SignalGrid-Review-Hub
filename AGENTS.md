# SignalGrid Review Hub Agent Instructions

These instructions apply to the entire repository.

**[`docs/PURPOSE.md`](docs/PURPOSE.md) is canonical (DR-019).** It states what
SignalGrid is, what remains unproven, and what may not be claimed. Reference it;
do not paraphrase it. Paraphrase is how the company description drifts. These
instructions govern agent conduct, not product truth.

## Owner-facing communication

For any text written directly to the owner — chat replies, status reports, PR summaries, owner-board entries, or action instructions — follow `.claude/skills/owner-comms/SKILL.md` as the canonical communication standard, even when the current agent is not Claude.

That skill adapts the Google developer documentation style guide to SignalGrid. The priority order is:

1. SignalGrid-specific truth, guardrails, and explicit owner instructions.
2. The Google developer documentation style guide.
3. Third-party style references only when the first two do not answer the question.

Keep one source of truth. Do not create a parallel ChatGPT-, Codex-, Gemini-, or Claude-specific owner-writing guide that can drift from `owner-comms`.

## Repository scope

SignalGrid Review Hub is the public pre-production, review, and validation surface for SignalGrid. It may contain documentation, deterministic fixtures, proof harnesses, review apps, and public-safe automation that explain or validate the SignalGrid direction without exposing protected core implementation details.

Keep the public Review Hub inside this scope:

- Use public-safe fixtures only.
- Do not add secrets, credentials, tenant IDs, customer data, PHI, PII, or environment-specific private values.
- Do not add real vendor calls, real Microsoft Graph calls, live API calls, or production integrations.
- Do not claim the repository is production-ready.
- Do not claim compliance certification, attestation, or regulatory approval.
- Do not claim current partnerships, alliances, marketplace certification, or vendor endorsement.
- Do not claim SignalGrid replaces IAM, IGA, UEM, MDM, DEX, RMM, monitoring, observability, SIEM, SOAR, ITSM, NAC, or other source systems.
- Do not claim autonomous production remediation.
- Keep high-risk actions simulated and approval-required.
- Treat existing enterprise systems as systems of record.
- Frame SignalGrid as the layer that normalizes signals, decides outcomes, routes approved actions, audits events, and verifies expected results.

## Implementation guardrails

- Prefer deterministic fixtures, documented proof commands, and public-safe examples.
- Do not touch simulator decision logic unless the task explicitly requires it.
- If simulator decision logic changes, update proof coverage and explain why.
- Malformed, missing, or ambiguous high-risk input must not produce an unsafe allow decision.
- Approval gates must be explicit and must not be bypassed by default paths.
- New connector or integration work should start read-only and fixture-backed unless a task explicitly says otherwise and provides a safe private-test context.

## Evidence-toolchain routing

For work involving Bruno/OpenAPI, MCP, Fleet/osquery, macOS posture evidence, source-independence testing, or adoption of an external verification tool, read `.claude/skills/signalgrid-evidence-toolchain/SKILL.md` and `docs/agent/EVIDENCE_TOOLCHAIN_OWNERSHIP.md` in addition to the role's normal skill.

Use the existing roles named there; do not create a new department because a useful repository exists. Bruno remains the curated API contract/wire plane, MCP remains controlled agent interoperability, independent sources preserve their own provenance, and the deterministic SignalGrid core remains the only trust authority. Researching or installing a proof tool does not widen the ratified launch profile.

## Validation commands

Run the relevant checks before opening or updating a pull request. For standard Review Hub changes, use:

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
PORT=3000 BASE_PATH=/ pnpm run build
pnpm run proof:intune-entra-posture
pnpm run proof:signalgrid-simulator
pnpm run proof:signalgrid-grid
git grep -nE "SignalGrid is production-ready|SignalGrid replaces|SignalGrid is an Imprivata partner|SignalGrid is MFi certified|autonomous production remediation|replaces ServiceNow|replaces PagerDuty|replaces CrowdStrike|replaces Defender|replaces ControlUp|Imprivata partner|MFi certified|replaces Jamf|replaces Intune|replaces Apple Configurator|replaces GroundControl" -- README.md docs artifacts/signalgrid-review/src || true
git diff --check
```

If an environment limitation prevents a command from running, document the limitation in the PR body.

## Pull request guidance

Every PR should include:

- Summary
- What changed
- Validation performed
- Public-safety note
- Remaining risks or owner decisions
- Screenshots or local QA notes when UI changes are perceptible

Do not merge your own PR. Leave merge decisions to the repository owner.

## Review guidelines

When reviewing changes, flag:

- Unsafe allow decisions.
- Approval-gate bypasses.
- Malformed input producing allow outcomes.
- Secret, customer, tenant, PHI, or PII exposure.
- Real vendor/API calls in the public Review Hub.
- Production, compliance, partnership, replacement, or autonomous remediation claims.
- Untested changes to simulator decision logic.
- Changes that reduce deterministic proof coverage.
