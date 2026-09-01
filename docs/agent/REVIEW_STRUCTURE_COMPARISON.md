# Two independent reviews, compared: dimension-shaped vs ECC-role-shaped

**Date: 2026-09-01. Two structurally different reviews were run over the same
tree (`7691bbe`) and their findings diffed. The first (the "full evaluation")
was organized by CONCERN — build, tests, security, decision-core, claims,
operational readiness. The second was organized the way ECC is built, by
REVIEWER ROLE — code-reviewer, security-reviewer, refactor-cleaner, architect,
tdd-guide, fail-closed-auditor — each agent running that role's own prompt, then
a verify pass. The point was not to re-confirm; it was to see whether a different
structure finds a different class of defect. It does.**

## The headline

**The two structures are complementary, not redundant — each caught a whole
class the other missed.** That is the real result, and it is why ECC runs
*beside* the repo's own gates rather than replacing them, and why neither review
alone is sufficient.

- The **concern-shaped** review caught every **claim / doctrine** defect (three
  buyer-facing overclaims) — because it had a claims reviewer. The role-shaped
  review has no such role and missed all three.
- The **role-shaped** review caught **correctness, architecture, and dead-code**
  defects — because it has a fail-closed auditor, an architect, and a refactor
  cleaner. The concern review's security dimension said "no bypass found" and
  stopped; it missed a fail-open and an authz asymmetry a narrower role found.

Neither found a critical, and both independently judged the codebase unusually
disciplined with no pinnable auth-bypass — that convergence is the strongest
signal in either review.

## Where they converged (high confidence)

- No critical/high correctness or auth-bypass defect pinnable to a line. Both the
  code-reviewer role and the concern-review's security dimension reached this
  independently.
- The `/cp/v1` control plane is unauthenticated in the demo profile and `/v1/keys`
  dispenses demo credentials — both reviews flagged it; both agree it is a
  declared demo-only posture, not a live breach.

## What the ECC-role structure caught that the concern review missed

| Finding | Role | Severity | Disposition |
| --- | --- | --- | --- |
| `fleetDMFreshness` reads a FUTURE-dated check-in as "fresh" — a fail-open every sibling deriver guards | fail-closed-auditor | medium | **FIXED this pass** — future-skew guard added, 3 regression assertions in `proof:evidence-adapter` |
| `POST /v1/step-up/challenge` has no `authorize()` — a read-only auditor / connector could probe enrollment | tdd-guide | medium | **FIXED this pass** — `decision:evaluate` required; auditor-403 regression in the API suite (315/315) |
| Durable audit ledger has no `tenant_id`; `/v1/audit` reads the ephemeral in-memory core ledger, not the durable one | architect | **high (CONFIRMED)** | **Backlog + candidate decision record** — architecture, needs a migration; the compliance differentiator, so it deserves a deliberate design, not a rushed patch |
| Dead code: competing webhook implementations, unreachable vendor adapters, a false-header emitter | refactor-cleaner | medium ×3 | Backlog |
| The new Swift `ExpiryPolicy`/`isExpired` logic has no unit test | code-reviewer | medium | Backlog (native lane — needs the Mac) |
| Webhook `dead_letter` terminal status never produced; fixture-sync fail-safe branch untested | tdd-guide | medium | Backlog |

## What the concern structure caught that the role review missed

| Finding | Dimension | Severity | Disposition |
| --- | --- | --- | --- |
| Retired category label live on the pitch deck, one-pager, and POSITIONING.md | claims | high ×3 | Fixed 2026-09-01 (PR #349) |
| One-pager claimed live-vendor proofs "run in CI" — they don't | claims | high | Fixed + registered in FALSE_CLAIMS.json |
| The seven operational-readiness items to a paying customer | operational | — | Enumerated in `SOLUTION_READINESS_ASSESSMENT.md` + backlog |

## The lesson for how this repo is reviewed

Run both shapes. A review organized by *concern* will always have a blind spot
where it has no concern named — claims here — and a review organized by *role*
will miss whatever no role owns — operational readiness and claims here. ECC's
role-shaped pass is now demonstrably worth its keep: on this run it surfaced two
real defects (both fixed above) and one confirmed architectural gap that four
prior concern-shaped passes had not. Keep it in the loop; keep the concern
review too; let the repo's own gates remain the only thing that certifies green.
