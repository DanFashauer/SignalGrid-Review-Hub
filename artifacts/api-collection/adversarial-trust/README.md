# Adversarial trust — no unearned affirmative

Every request in this folder attacks the same claim from a different angle:
**an affirmative must be earned.** A passing run means the engine refused,
tightened, or correctly scoped every one of these — live, on the wire, with
the reason codes named. Every expected verdict here was DERIVED by probing
the running fixture server before it was pinned; nothing is asserted from
imagination.

| Attack | Engine's answer |
| --- | --- |
| Unknown device / identity / workflow | 404 — never graded |
| Cross-tenant refs | 404 — indistinguishable from nonexistent |
| Missing posture source | restrict, `POSTURE_MISSING` |
| Stale evidence | step_up, `POSTURE_STALE` |
| Noncompliant device | restrict, `DEVICE_NONCOMPLIANT` |
| Disabled identity (on a healthy device) | deny, `IDENTITY_DISABLED` |
| Contradictory custody (forced badge removal) | deny, `TAMPER_SUSPECTED` + `BADGE_FORCED_REMOVAL` |
| Type-confused refs | 400 at the parser |
| Malformed/invented request context | discarded — verdict identical to the evidence-only baseline |
| Replay, same key + same body | stored decision replayed, marked `Idempotency-Replay: true` |
| Replay, same key + different body | fresh execution — the body is part of the key |

Out of scope here, stated so silence is not coverage: shift/off-clock and
app-workflow-level conditions live on the deferred `/v1/app-workflows`
surface, not the base evaluate path — `nurse.offclock` allows on this route
by design and is NOT pinned as an adversarial case.

Runs as its own pass in `scripts/run-bruno-collection.mjs` (review-demo
profile, where the fixtures authenticate). Backlog row 31 of
`docs/COMPANY_BUILD_PLAN.md`, from the owner's 2026-08-21 research report.
