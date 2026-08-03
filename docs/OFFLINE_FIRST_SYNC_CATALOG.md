# SignalGrid Offline-First Mobile Synchronization Catalog

> *"The mobile app should work even when the network doesn't. A frontline nurse,
> warehouse picker, field engineer, or utility technician shouldn't lose the ability to
> complete a governed workflow because connectivity dropped."*
> — the owner's framing for this catalog

**What this file is.** A REPO-COMPILED catalog: every row names a file, package or proof
in *this* repository, and every claim in it is one you can check by opening the thing it
names. No vendor pages, no product comparisons, no URLs that were not fetched. That
inversion is deliberate — an externally-sourced catalog puts the honesty burden on the
source, and a repo-compiled one puts it on us.

**What it is for.** The offline-first proposal was submitted as intake row 51. Most of it
turned out to be already true in the fabric, some of it was genuinely missing, and a
little of it is deliberately refused. This file is where that adjudication lives so no
future lane has to re-derive it — and so nothing recorded here as *refused* is later
mistaken for unbuilt scope.

---

## 1. The premise, and the one thing it changes

The proposal's architecture — `UI → local DB → repository → sync engine → outbox →
background worker → API` — is the standard local-first stack, and for a *records* app it
is the whole answer. SignalGrid is not a records app. It synchronizes **decisions**, and
that changes exactly one thing, which the proposal itself names better than the source
article does:

> *"Conflict isn't: which record wins. Conflict is: which decision wins."*

Everything below follows from taking that sentence literally.

### Why a decision cannot be merged like a record

Going offline **shrinks the reachable signal set**. Golden rule 2 says an unreachable
signal raises assurance and never lowers it, so a decision made offline is by
construction made on *less evidence* than one made online. A naive offline-first build
makes the partition **neutral**: the local engine evaluates whatever it can still see and
returns `allow`. That is the unearned affirmative at the heart of offline-first, and it
is the defect this intake existed to find.

The two standard merges both fail here, for different reasons:

| Merge strategy | Why it fails on decisions |
| --- | --- |
| **Last-write-wins** (physical clock) | On a shared, badge-checked-out device the clock is settable by whoever holds the device. "Newest timestamp wins" makes *changing the date* a grant primitive: a stale `allow` beats a fresh `deny`. Golden rule 2 already forbids a wall-clock read in a decision path; this is the concrete harm behind the rule. |
| **CRDT join** (LUB on a semilattice) | Order-independent and clock-free, which is right — but a join only ever moves UP its lattice. Policy relaxation moves DOWN: version 8 exists precisely so that something version 7 restricted can now be allowed. A fabric built on a pure join is fail-**stuck**: one stale `deny` from a device that never came back vetoes the corrected policy forever. |

### Why there are no vector clocks

The article reaches for logical/vector clocks because record edits originate anywhere, so
causality has to be reconstructed after the fact. SignalGrid's decision provenance does
not originate anywhere:

- `policyVersion` is minted by the control plane (`@workspace/control-plane`).
- `coreNormalizationVersion` is generated from a source digest by
  `scripts/generate-core-normalization-version.mjs` and is never hand-set.

Both are already logical counters with a single writer. **The pair is the causal order**;
there is nothing left for a vector clock to recover. This is a real structural advantage
of a decision fabric over a records app, not a shortcut.

---

## 2. BUILT — decision continuity

`lib/signalgrid-core/src/continuity.ts`, proven by
`scripts/src/decision-continuity-proof.ts` (`pnpm run proof:decision-continuity`).

`reconcileDecisions()` is neither a clock tiebreak nor a CRDT. It is an
**order-independent set reduction** over a partial order of provenance, with a
fail-closed veto on top. It takes from the CRDT world the property that actually matters
— the answer does not depend on arrival order or on how many times a record arrived —
without pretending outcome merge is monotone.

**The order.** The product order on `(policyVersion, coreNormalizationVersion)`. An
*absent* core stamp is UNKNOWN, not zero: it is incomparable with every known value, so a
legacy record can neither dominate nor be dominated and always forces the fail-closed
join. Reading absence as zero would let a stamped record dominate on an axis where
nothing is known about its opponent — and, because a clean dominating authority is
allowed to relax, would silently convert a legacy `deny` into an `allow`. The proof pins
that as an outcome, not just as an ordering.

**The veto.** `evaluatedOffline` and `policyKnownSuperseded` are not part of the order —
"was offline" is not newer or older than anything. They are applied afterwards, as a
one-directional rule:

> A newer policy version licenses a device to be **more restrictive** on its own. It
> never licenses it to be **less restrictive** than a better-connected evaluation.

**The standing bound.** Caller-posed, never clock-read: the caller states the bound and
states the elapsed seconds per record, so the same inputs replay to the same answer
forever. An offline decision past its bound has its outcome **raised to a floor**
(`step_up` by default) — never dropped, because "no decision" reads downstream as
"nothing restricting me". A record whose age the caller does not state is treated as
**expired**, not fresh: an unstated age must not buy unbounded standing.

**The five laws, measured rather than asserted** (figures from the proof's `figures=`
line, guarded by `scripts/check-proof-figures.mjs`):

| Law | What it says | How it is measured |
| --- | --- | --- |
| L1 order-independence | The outcome depends on the SET, never the arrival order | exhaustive over 9,216 ordered pairs and 13,824 three-record sets (all 6 permutations each) |
| L2 idempotence | Re-delivering a record never moves the outcome | exhaustive over the same pair space |
| L3 monotonicity | A record that does not dominate the frontier can never RELAX the outcome — a stale sync payload cannot manufacture a grant | 55,296 additions, zero non-dominating relaxations, and the sweep is shown non-vacuous (relaxations *were* observed) |
| L4 offline cannot relax | A compromised frontier always resolves to the fail-closed join | 3,744 compromised-frontier pairs |
| L5 not fail-stuck | A fully-connected authority under strictly newer provenance CAN relax a stale restriction | 288 clean-authority pairs |

L1+L2 are what the offline-sync literature asks for. **L3+L4 are what it does not**, and
L5 is what a pure join cannot give you.

Each of the five negative controls listed in the proof header was applied to
`continuity.ts`, measured, and reverted. One of them corrected the design: the absent-stamp
mutation did *not* break L4 the way the first draft of that comment predicted, which is
why the proof now states that choice as an outcome as well as an ordering.

### 2a. On the wire

`POST /v1/decisions/reconcile` (`artifacts/api-server/src/routes/v1.ts`), documented in
`lib/api-spec/v1-openapi.yaml` and exercised by the API integration test.

**The route stores nothing and reads nothing.** Every record is caller-supplied and the
reduction is pure, so there is no decision id to mint and no evidence snapshot to write.
That is deliberate rather than incidental: the reconciler answers a question about
records the caller already holds, and minting a decision here would create a record with
no evidence behind it.

Two properties belong to the wire layer specifically, because they are the ones a
correct library can still be wrapped badly by:

- **The parser fills nothing in.** `evaluatedOffline` and `policyKnownSuperseded` are
  passed through exactly as sent, absent included, so the library's refusal is what the
  caller meets. A `?? false` here would be the MCP adapter's defect at a different layer
  — an omitted field buying a record the right to relax — and it would be invisible from
  the wire, because a defaulted request and an honest one produce the same 200. Two of
  the API tests exist only to hold that line.
- **An oversized set is REFUSED, never truncated.** The reduction is O(n²) in the record
  count so a cap is necessary, and refusing is the load-bearing half: truncating would
  silently drop records, and dropping a record can only ever remove a restriction. That
  is the same asymmetry that makes an expired local decision get raised to a floor
  rather than dropped, applied to the transport.

A posed `standingBound` with no `elapsedSecondsById` becomes an EMPTY map, not an absent
bound — so every offline record reads as age-unstated and expires. Treating it as "no
bound posed" would let a caller pose a bound and then escape it by omitting the ages.

### 2b. On screen

The Operator Console (`artifacts/signalgrid-review/.../OperatorConsoleSection.tsx`) runs
the real `reconcileDecisions` in the browser, the same way it already runs the real
decision core — so the outcome, reason codes, frontier and expiry a reviewer reads are
whatever the function returns, not a mock-up of an answer.

Four cases, chosen because they are the ones that distinguish this from the two merges a
reader will assume: an offline device holding the NEWER policy losing to a connected
`deny` (why it is not last-write-wins), a connected control plane relaxing a stale `deny`
(why it is not a pure join), a staged rollout where neither side is newer, and an offline
answer whose age nobody stated.

Pinned by a Playwright assertion in `scripts/src/e2e/review-console.spec.ts`, on the
precedent that made the Battery health row visible: **the core can be right while nothing
on screen says so.** The assertion was negative-controlled — flipping the first case's
device to online drops that one test and leaves the other 35 passing.

---

## 3. The state types the proposal names

| Proposed state | Where it already lives | Disposition |
| --- | --- | --- |
| **Identity state** | `lib/signalgrid-core/src/types.ts` `IdentityState` (`enabled`/`disabled`/**`unknown`**), fused via `lib/posture-composition` | **COVERED.** The contract can already say *unknown*, which is the only reason an offline read is safe to hold. |
| **Device posture** | the connector families under `lib/integrations/src/integrations/` → `lib/posture-composition` | **COVERED.** Freshness is caller-posed throughout (`lastCheckInAgeSeconds`, `fixAgeSeconds`, `maxObservationAgeSeconds`) — never `Date.now()`. |
| **Workflow state** | `lib/app-workflows`, `lib/work-context`, `lib/handoff-sim` (`proof:handoff-sim` covers cross-device handoff) | **COVERED.** |
| **Signal evidence** | `EvidenceSnapshot` in `lib/signalgrid-core/src/types.ts` + `evidence.ts` | **COVERED.** Carries `signalsUsed`, `sourceReferences`, `policyVersionId`, `policyVersion`, `coreNormalizationVersion`, and a content `digest`. |
| **Connector state** | `ConnectorStatus` (`healthy`/`degraded`/`never_synced`), `SyncStatus`, and the gateway mode verdict in `lib/facility-trust-graph/src/gateway.ts` | **COVERED.** `never_synced` is distinct from `degraded` — the distinction the article's tombstone section is really about. |
| **Policy version** | `PolicyVersion` + `PolicyBundle` (checksum **and** signature), `ControlPlane.syncPlan` / `applyBundle` | **COVERED**, and now load-bearing: it is one of the two axes of the continuity order. |
| **Decision history** | `Decision` + the digest-chained audit ledger (`lib/signalgrid-core/src/audit.ts`, `prevDigest`/`seq`, `proof:audit-ledger`) | **COVERED.** This is the proposal's Decision Ledger — see §5. |
| **Approvals** | `lib/dual-control`, `lib/pim-activation`, the governed-activation path in `lib/adaptive-proposals` | **COVERED** as primitives. Wiring dual-control into a shipped flow stays **owner-gated** (intake row 46 / backlog) — it is a product decision, not unbuilt scope. |
| **Audit events** | `lib/signalgrid-core/src/audit.ts` (TS) and `native/ios/EnterpriseShell/Services/AuditLogger.swift` (device) | **COVERED.** The iOS logger already persists to `audit_logs.json` when the backend is unreachable and re-queues on failure — store-and-forward existed before this intake. |
| **Configuration** | `@workspace/control-plane` + `proof:edge-sync` | **COVERED.** Pull, verify checksum, verify signature, refuse a tampered bundle fail-closed, apply, idempotent re-apply, unknown node yields nothing. |

**Nothing in this column was built for this intake.** The gap was never *what* to
synchronize — it was what to do when two synchronized answers disagree.

---

## 4. The five queues

The proposal splits the outbox into Decision / Evidence / Configuration / Workflow /
Telemetry queues with distinct retry semantics.

**Disposition: OUT OF SCOPE as transport, with one fact extracted.**

Apply the asymmetry test — *would this fact, if stale or wrong, manufacture a grant that
would not otherwise be given?* A retry schedule cannot. Backoff, jitter, per-queue
priority, WorkManager vs BackgroundTasks, silent-push triggering: none of them can move
an outcome, and all of them belong to the host app's platform layer rather than to a
deterministic decision core. Building a queue runtime here would put untestable
wall-clock scheduling inside the one package that is forbidden to read a clock.

**One property of the split does pass the test**, and it is the ordering hazard between
two of the queues: if Configuration (policy DOWN) lags behind Decision (decisions UP), the
device keeps minting decisions under a policy it *already knows* is superseded. That is
carried as data rather than rebuilt as machinery —
`DecisionProvenance.policyKnownSuperseded` is the edge-sync plan's `updateAvailable`
captured **at mint time**. A node that has since caught up cannot retroactively claim its
old decision was current, and a knowingly-superseded authority is barred from relaxing.

| Proposed queue | Carries | Decision-path relevance |
| --- | --- | --- |
| Decision | locally-minted decisions, UP | Reconciled by `reconcileDecisions`. The transport is the host's. |
| Evidence | `EvidenceSnapshot`s, UP | Tamper-evident by digest; arrival order is irrelevant because the snapshot is self-describing. |
| Configuration | policy bundles, DOWN | `proof:edge-sync`. Its *lag* is the one queue fact that reaches a decision, via `policyKnownSuperseded`. |
| Workflow | workflow/work-context state, both ways | `lib/work-context` + `proof:handoff-sim`. |
| Telemetry | metrics/events, UP | `lib/event-contract`, the emitter families, `proof:emitter-discipline`. Lossy by design; cannot reach a decision. |

---

## 5. The Decision Ledger

The proposal asks for a ledger row of *Decision # · Signals · Policy Version · Workflow
Version · Device Version · Identity Version · Outcome · Hash · Timestamp*.

**Disposition: COVERED**, by two existing structures rather than one:

| Proposed column | Where it is |
| --- | --- |
| Decision # | `Decision.id` (deterministic) + `AuditEvent.seq` (per-tenant monotone) |
| Signals | `EvidenceSnapshot.signalsUsed` + `signalIds` |
| Policy Version | `Decision.policyVersion` / `policyVersionId` |
| Workflow Version | `Decision.workflowId` + `lib/app-workflows` templates |
| Device Version | `EvidenceSnapshot.sourceReferences` (per-connector refs), plus `coreNormalizationVersion` for the *evaluating build* |
| Identity Version | `Decision.identityId` + the identity signal in `signalsUsed` |
| Outcome | `Decision.outcome` |
| Hash | `EvidenceSnapshot.digest`, and `AuditEvent.prevDigest` chaining every event to its predecessor |
| Timestamp | `Decision.createdAt` — recorded, **never read by a decision path** |

That last row is the one worth stating out loud. The fabric records time and refuses to
*decide* on it. `proof:audit-ledger` verifies the chain and reports `brokenAtSeq` on the
first break, so a ledger that was edited in transit is detectable rather than merely
signed.

---

## 6. Local AI

> *"I would never allow the model to execute actions. Instead observe / learn /
> recommend… The AI recommends. Policy remains authoritative."*

**Disposition: COVERED** by `@workspace/adaptive-proposals` (`proof:adaptive-proposals`),
whose module split is literally `observe.ts` / `simulate.ts` / `measure.ts` /
`lifecycle.ts`: a proposal is observed from evidence, simulated against recorded
decisions, measured, and can only become policy through a governed activation a human
approves. There is no code path by which a proposal enacts itself.

Nothing was built here, and nothing should be. The constraint the owner states is already
the invariant the package was written to hold.

---

## 7. Deliberately NOT built

Recorded with reasons so a future lane does not read these as unbuilt scope.

| Refused | Why |
| --- | --- |
| A queue/outbox runtime in `lib/*` | Transport cannot manufacture a grant (§4), and scheduling requires the wall clock the decision core is forbidden to read. The host app owns it. |
| CRDT merge types (G-counter, OR-set, LWW-register) | The thing being merged is an outcome under a policy, and policy relaxation is not monotone. A CRDT here would be safe and fail-stuck (§1). |
| Vector clocks | Both provenance counters already have a single writer; there is no causality left to reconstruct (§1). |
| A `Date.now()`-based staleness check anywhere in continuity | Golden rule 2. The bound is caller-posed instead — same guarantee, replayable. |
| Dropping an expired local decision | Removing a record removes a restriction, and downstream "no decision" reads as "nothing restricting me". Expiry raises to a floor instead. |
| Defaulting `evaluatedOffline` / `policyKnownSuperseded` to `false` | Both would default in the permissive direction: an omitted field would buy the record the right to relax. `reconcileDecisions` refuses a record that does not state them. |

---

## 8. Backlogged

| Open | Note |
| --- | --- |
| Swift mirror of `reconcileDecisions` | The device is where an offline decision is actually minted, so `EnterpriseShell` should reconcile on reconnect rather than let the server do it alone. Blocked in the cloud lane (no Swift toolchain) and subject to golden rule 1 — it goes *around* `DecisionEngine.swift`, in a new file, in the `SignalContext.swift` pattern. Tracked alongside the `coreNormalizationVersion` Swift-mirror entry in `docs/BUILD_BACKLOG.md`. |
| *(nothing open)* | The library, the `/v1` arm (§2a) and the operator-console panel (§2b) all ship. The Swift mirror below is the only remaining piece, and it is blocked on toolchain rather than design. |

---

## Related

- `docs/CI_AND_VALIDATION.md` — how the gates above are run and what each one proves.
- `docs/INTAKE_LEDGER.md` row 51 — the submission this file adjudicates.
- `docs/OPERATING_STACK_LAYER_MAP.md` — where the sync layer sits relative to everything else.
- `docs/LANE_COORDINATION.md` — read before touching `lib/signalgrid-core` from a second lane.
