# Green / Yellow / Red Merge Policy

> **SUPERSEDED 2026-09-06 in its two unsafe-claim bullets — the lanes themselves stand.**
> Last substantively written 2026-08-03. The rule that any protected-wording match
> demotes the lane "even when the match appears to be disclaimer or guardrail wording"
> describes a gate that was fixed: `scripts/src/unsafe-claim-classifier.ts` sorts each hit
> into `affirmative`, `disclaimed`, `self_referential` or `registry`, and only
> `affirmative` moves the lane (`scripts/src/phase-gate.ts`; the record is
> `docs/CI_AND_VALIDATION.md`, "only `affirmative` moves the lane"). The two bullets are
> rewritten below.

This policy classifies scoped phase PRs by risk. It supports fast review of safe work while keeping risky work approval-gated.

## GREEN

A PR can be green only when all of these are true:

- Docs only.
- Public-safe fixtures only.
- No workflow changes.
- No proof logic changes.
- No runtime behavior changes.
- All CI is green.
- No automated-review P1/P2 comments remain unresolved.
- Unsafe-claim scan is clean of **affirmative** hits. Only an `affirmative` classification demotes the lane out of GREEN; `disclaimed`, `self_referential` and `registry` hits are counted and printed but do not move the lane (`scripts/src/unsafe-claim-classifier.ts`). *(Until 2026-09-06 this bullet said any match demoted, even disclaimer wording — the superseded behaviour.)*

## YELLOW

A PR is yellow when it includes any of these:

- GitHub Actions changes.
- Proof logic changes.
- Dashboard/UI behavior changes.
- Scripts.
- An `affirmative` unsafe-claim hit (a protected claim asserted, not disclaimed). Disclaimer, scanner-registry and self-referential hits are classified as such and do not by themselves make a PR yellow. *(Rewritten 2026-09-06; see the banner.)*
- Fixture model expansion.
- New deterministic decision rules.
- Any change that affects CI, artifacts, or emulator output.

Yellow-lane work requires explicit human approval before merge.

## RED

A PR is red when it includes or enables any of these:

- Live API calls.
- Authentication.
- Secrets.
- Tenant, customer, PHI, or PII data.
- Device actions.
- MDM, PACS, IAM, or source-system writes.
- Remediation outside simulation and approval gates.
- Production, compliance, partnership, replacement, or autonomous-remediation claims.
- Anything that could affect real systems.

Red-lane work requires explicit human approval before implementation and merge. In the public Review Hub, convert red items into public-safe documentation or fixture-backed plans whenever possible.
