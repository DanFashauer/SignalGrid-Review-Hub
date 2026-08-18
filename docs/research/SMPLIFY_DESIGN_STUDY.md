# Smplify design study — what a neighboring product's field-tested patterns teach SignalGrid

**Status: research note (intake rows 92–93).** Smplify (smplify.com) is an
agentless, API-first device-management control plane founded by Spurti Preetham
Gurram (Apple School/Business Manager, zero-touch enrollment at Apple) and Ben
Greiner (Robot Cloud, the first cloud-hosted Jamf). It occupies the ACTUATOR
slot beside SignalGrid's decision fabric — the slot Fleet fills in the lab —
and its public API design overlaps SignalGrid's doctrine in several places
worth learning from. This study records what was read, what each pattern maps
to here, and a disposition per pattern. **Nothing here is a connector, an
endorsement, or a partnership claim.**

## Sources, and their limits

Read: `smplify.com` (marketing), `docs.smplify.com/llms.txt` (the API index),
and the portions of `docs.smplify.com/llms-full.txt` a single fetch returned —
which covered Apple enrollment/MDM, app management, tags, authentication, the
**Approval Gates API in full**, and the **Audit Log API**. Named in the index
but NOT retrieved (the full-text file truncated before them): Software Update
Eligibility/Status, Rolling Update Policies, Schema Builder, Policy Bundles,
Tag Insight. Where this study says nothing about those, that is a statement
about our read, not about their product.

## Pattern 1 — the Approval Gates lifecycle (the one that matters most here)

SignalGrid's owner-gated open question (BUILD_BACKLOG, "A REACHABLE
dual-control surface") asks: *should a two-person ceremony exist on a
reachable surface at all — and if so, on which action class?* Smplify ships a
complete, field-tested answer to the mechanism half of that question, and its
vocabulary is worth adopting wholesale if the owner ever says "build":

**Risk-tier routing.** Every privileged action classifies into one of five
tiers — `AUTO` (runs), `NOTIFY` (runs, audit event), `APPROVE` (pends, quorum
1), `TWO_PERSON` (pends, quorum 2), `DENY` (blocked, 403). The gate sits
**after RBAC** ("intercepting destructive actions post-authorization"): having
the privilege is necessary, never sufficient. This is the same placement
SignalGrid's own design pass concluded — evidence crosses the seam, a
caller-supplied verdict never does.

**Self-approval semantics as tenant modes.** `DEFAULT` lets a privileged
requester self-authorize APPROVE-tier actions and pre-counts them as one of
TWO_PERSON's two; `STRICT` always demands distinct peer approvers; `DISABLED`
exists only for non-prod. Compliance-locked tenants are pinned to STRICT and
attempts to loosen return 403. The subtlety worth stealing: *the requester can
never be the approver* is a MODE, not an absolute — and the mode is what a
compliance regime pins.

**Lifecycle details that prevent the classic failure cases:**

- Gated actions return `202` + `requestId`; a retry of the same
  `(tenant, privilege, action, targets, requester)` returns the EXISTING
  pending request — the same idempotency doctrine SignalGrid's `/v1` mutating
  POSTs adopted (principal + body digest), applied to approvals.
- Pending requests carry a 24-hour TTL; expired ones answer `410 Gone` and
  must be resubmitted — an approval never lies dormant into a changed context.
- On quorum, "the original action replays automatically under service
  authority" — the approver approves the RECORDED action, not a re-supplied
  one; nothing the requester can edit after approval matters.
- Resources with pending requests carry visible soft-locks; requesters have an
  `outbox`, approvers an `inbox`, admins a full event timeline per request.
- `POST /approvals/preview` predicts gate behavior with **no mutation** — the
  dry-run the operator consults before acting.
- `BREAK_GLASS` bypasses quorum, fires a hardened audit event, and is refused
  for self-break-glass and for compliance-locked tenants — the emergency path
  exists, is loud, and cannot be a self-service loophole.

**Mapping to SignalGrid.** The five tiers rhyme with, but are NOT, the gate's
verdicts: allow/step_up/restrict/deny grade one request's evidence at decision
time; AUTO→DENY classify an action CLASS's governance ahead of time. A future
SignalGrid dual-control surface would use both: the launch profile (or a
successor policy object) assigns each admin action class a tier; the decision
engine still evaluates each instance; the approval lifecycle above carries the
pended ones. The design-pass conclusions already recorded in the backlog bind
unchanged — raw `DualControlRequestRaw` normalized by the primitive's own
normalizer, a ceremony bound to one action id and non-replayable, every guard
in a shape `scripts/mutation-guard.mjs` can mutate.

**Disposition: informs the owner's standing decision — recorded, not built.**
The owner-gated question stays owner-gated; what changes is that "if yes,
how?" now has a concrete, field-tested reference design instead of a blank
page.

## Pattern 2 — audit log searchability

Smplify's audit log records every privileged action (actor, tenant, privilege,
action, outcome, client IP/UA) with "a chain hash for tamper-evidence" —
convergent with SignalGrid's hash-chained ledger, and a useful confirmation
that chain-hashing is the industry answer, not an eccentricity. Two affordances
SignalGrid's durable ledger does not yet expose: **filterable search**
(`action`, `privilege`, `occurredAt` ranges) and a **count endpoint** for
sizing exports. SignalGrid's `db:export-ledger` exports the whole chain;
an assessor asking "show me every BREAK_GLASS-class event in March" is served
by filters, not a full export.

**Disposition: recorded as a candidate `/v1`-surface enhancement.** Touching
the launch surface needs classification (bijection gate), so this is a
follow-on for the owner board's next review, not a quiet addition.

## Pattern 3 — the named-but-unread surfaces

Software Update Eligibility/Status (the SOFA-adjacent Apple-currency question
from intake row 81), Rolling Update Policies, Schema Builder, Policy Bundles,
and Tag Insight are all present in Smplify's index and absent from our read.
Row 81's deferred SOFA work should read Smplify's eligibility contract before
designing its own — a second implementation to compare against is exactly what
the Keycloak exercise proved valuable ("cross-implementation agreement, not
first coverage").

**Disposition: recorded; attach to row 81's eventual build as prior art.**

## The partner-conversation frame (owner's call)

The complementarity is structural: Smplify actuates, SignalGrid decides — and
SignalGrid's IaC doctrine ("an apply is refused unless a live decision returns
allow") slots in front of Smplify's apply exactly as it slots in front of
Fleet GitOps. Their approval gates govern WHO may act; SignalGrid's gate
grades WHETHER the world's evidence supports acting now. Those compose rather
than compete. The founders are the "MDM/UEM vendors exploring orchestration
opportunities" audience the executive one-pager names. Outreach is the owner's
decision; this study and the live Fleet proofs are the show-and-tell if it
happens.
