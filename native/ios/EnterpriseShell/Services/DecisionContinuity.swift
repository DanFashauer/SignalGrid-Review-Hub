import Foundation

/// Decision continuity — which answer stands when the device decided offline and the
/// control plane decided too.
///
/// A mirror of `lib/signalgrid-core/src/continuity.ts`, which holds the full design
/// argument. The short version, because the reasoning is the safety property:
///
///   - NOT last-write-wins. On a shared, badge-checked-out device the clock is settable
///     by whoever holds the device, so "newest wins" makes changing the date a grant
///     primitive. Nothing here reads a clock; the caller states elapsed time as data.
///   - NOT a CRDT join. A join only moves UP its lattice, and policy relaxation moves
///     DOWN — a fabric built on one is fail-STUCK, vetoed forever by a stale `deny`
///     from a device that never came back.
///
/// It is an order-independent set reduction over the product order on
/// (policyVersion, coreNormalizationVersion), with a fail-closed veto on top: an
/// authority that decided offline, or knowingly under a superseded policy, may raise
/// the outcome on its own but may never RELAX below the fail-closed join of every
/// record.
///
/// WHY IT LIVES HERE AND NOT IN `DecisionEngine.swift`. That file is a byte-faithful
/// port of the TS simulator and parity with it is the point (CLAUDE.md golden rule 1);
/// reconciliation is not part of what was ported. This goes AROUND it, the way
/// `SignalContext.swift` does — pure Foundation, no UIKit, so the hermetic test target
/// and the macOS SwiftPM target both compile it.
///
/// WHY ON THE DEVICE AT ALL. The device is where an offline decision is actually
/// minted. `POST /v1/decisions/reconcile` reconciles whatever the device uploads, but
/// until it reconnects the device still has to answer "does my own held decision still
/// stand?" — and the honest answer needs this reduction, not a timestamp.
///
/// WHAT THIS IS NOT: a transport. No queue, no retry, no persistence, no backoff —
/// those belong to the host app, and none of them can manufacture a grant on their own.
/// The one transport fact that could is carried as data (`policyKnownSuperseded`).
enum DecisionContinuity {

    // MARK: - Errors

    /// Refusing beats returning. A reconciler that guesses is a reconciler that can be
    /// fed a guess, and any outcome invented here would be indistinguishable from a
    /// real one downstream.
    enum ContinuityError: Error, Equatable {
        case validation(String)
    }

    // MARK: - Outcome ordering

    /// Worst-first precedence, matching the TS twin's `OUTCOME_RANK`.
    private static func rank(_ outcome: AppWorkflows.DecisionOutcome) -> Int {
        switch outcome {
        case .deny: return 4
        case .restrict: return 3
        case .step_up: return 2
        case .allow: return 1
        }
    }

    /// The fail-closed join on outcomes: the most restrictive of the set wins.
    ///
    /// Swift's enum is closed, so the TS twin's unknown-outcome guard has no Swift
    /// twin to write — an unrankable outcome is not representable. The EMPTY case
    /// still refuses rather than inventing one.
    static func mostRestrictiveOutcome(
        _ outcomes: [AppWorkflows.DecisionOutcome]
    ) throws -> AppWorkflows.DecisionOutcome {
        guard let first = outcomes.first else {
            throw ContinuityError.validation("mostRestrictiveOutcome requires at least one outcome.")
        }
        return outcomes.dropFirst().reduce(first) { worst, next in
            rank(next) > rank(worst) ? next : worst
        }
    }

    // MARK: - Provenance

    /// What a decision was decided WITH. Only the two counters participate in the
    /// ordering; the two booleans are vetoes applied after the order resolves, because
    /// "was offline" is not newer or older than anything — it states how much evidence
    /// was reachable.
    struct DecisionProvenance: Equatable {
        /// Control-plane-minted policy version the decision was evaluated against.
        let policyVersion: Int
        /// Which build of the core decision path evaluated it. OPTIONAL for the same
        /// reason it is optional on `EvidenceSnapshot`: a record minted before the stamp
        /// existed genuinely does not carry one. Absent is UNKNOWN, never zero.
        let coreNormalizationVersion: Int?
        /// True when one or more required sources were unreachable at evaluation time —
        /// the device decided on a shrunken signal set.
        let evaluatedOffline: Bool
        /// True when the evaluating node already knew a newer policy bundle was waiting
        /// and evaluated anyway. Captured at mint time, never re-derived here: a node
        /// that has since caught up must not be able to claim its old decision was current.
        let policyKnownSuperseded: Bool

        init(policyVersion: Int,
             coreNormalizationVersion: Int? = nil,
             evaluatedOffline: Bool,
             policyKnownSuperseded: Bool) {
            self.policyVersion = policyVersion
            self.coreNormalizationVersion = coreNormalizationVersion
            self.evaluatedOffline = evaluatedOffline
            self.policyKnownSuperseded = policyKnownSuperseded
        }
    }

    /// One side's answer, as it arrives at the reconciler.
    struct ReconcilableDecision: Equatable {
        /// Stable identifier — the decision id. Used for reporting and de-duplication.
        let id: String
        let outcome: AppWorkflows.DecisionOutcome
        let provenance: DecisionProvenance
    }

    enum ProvenanceComparison: String {
        case equal, leftDominates, rightDominates, incomparable
    }

    private enum AxisComparison {
        case equal, greater, less, incomparable
    }

    private static func compare(_ a: Int, _ b: Int) -> AxisComparison {
        if a == b { return .equal }
        return a > b ? .greater : .less
    }

    private static func compareOptional(_ a: Int?, _ b: Int?) -> AxisComparison {
        switch (a, b) {
        case (nil, nil): return .equal
        case (nil, _), (_, nil): return .incomparable
        case let (x?, y?): return compare(x, y)
        }
    }

    /// Compare two provenances under the product order on
    /// (policyVersion, coreNormalizationVersion).
    ///
    /// An ABSENT `coreNormalizationVersion` is unknown, and unknown is incomparable
    /// with every known value — including with a LOWER one. The alternative is to read
    /// absence as zero, which would let every stamped record dominate every legacy
    /// record on an axis where nothing is actually known. Two absent stamps are equal
    /// to each other, so a fleet predating the stamp still orders by policy version.
    static func compareProvenance(_ a: DecisionProvenance, _ b: DecisionProvenance) -> ProvenanceComparison {
        let policy = compare(a.policyVersion, b.policyVersion)
        let core = compareOptional(a.coreNormalizationVersion, b.coreNormalizationVersion)
        if policy == .incomparable || core == .incomparable { return .incomparable }
        if policy == .equal && core == .equal { return .equal }
        // A dominates B iff A is >= on every axis and > on at least one.
        if (policy == .greater || policy == .equal) && (core == .greater || core == .equal) {
            return .leftDominates
        }
        if (policy == .less || policy == .equal) && (core == .less || core == .equal) {
            return .rightDominates
        }
        // One axis up, the other down — a staged rollout, and genuinely undecidable.
        return .incomparable
    }

    // MARK: - Standing bound

    /// A caller-posed bound on how long a decision made offline may keep standing.
    ///
    /// CALLER-POSED, not clock-read: the caller states the bound and states how much
    /// time elapsed for each record. Nothing here reads a clock, so the same inputs
    /// replay to the same answer forever.
    struct StandingBound {
        /// Seconds an offline decision may stand without re-contact. Finite and > 0.
        let maxStandingSeconds: Double
        /// Elapsed seconds since each record was minted, by record id. A record the
        /// caller says nothing about is treated as EXPIRED, not as fresh — an unstated
        /// age that bought unbounded standing would be silence purchasing an affirmative.
        let elapsedSecondsById: [String: Double]
        /// What an expired offline decision becomes. Its outcome is RAISED to this
        /// floor, never dropped: dropping the record would remove a restriction from the
        /// set, and "no decision" reads downstream as "nothing restricting me".
        let floor: AppWorkflows.DecisionOutcome?

        init(maxStandingSeconds: Double,
             elapsedSecondsById: [String: Double],
             floor: AppWorkflows.DecisionOutcome? = nil) {
            self.maxStandingSeconds = maxStandingSeconds
            self.elapsedSecondsById = elapsedSecondsById
            self.floor = floor
        }
    }

    struct ReconciliationResult: Equatable {
        let outcome: AppWorkflows.DecisionOutcome
        /// Stable, sorted, order-independent.
        let reasonCodes: [String]
        /// Ids on the provenance frontier — the maxima of the partial order. Sorted.
        let authorityIds: [String]
        /// True when the frontier holds two mutually incomparable provenances.
        let contested: Bool
        /// Ids whose outcome was raised by the standing bound. Sorted.
        let expiredIds: [String]
        /// How many distinct records were reduced.
        let considered: Int
    }

    // MARK: - The reduction

    /// Reduce a set of decisions for the SAME subject and action to the one that stands.
    ///
    ///  1. Validate — a malformed record or bound is refused outright.
    ///  2. Apply the standing bound: an offline decision past its bound (or with an
    ///     unstated age) has its outcome RAISED to the floor.
    ///  3. Find the frontier — the maxima of the provenance partial order.
    ///  4. Join the frontier's outcomes fail-closed. That is the AUTHORITY outcome.
    ///  5. Veto: a contested frontier, or one holding an offline or knowingly-superseded
    ///     record, may not RELAX below the fail-closed join of every record.
    ///
    /// The result depends only on the SET of records — never on their order, never on
    /// how many copies of one arrived.
    static func reconcileDecisions(
        _ records: [ReconcilableDecision],
        standingBound: StandingBound? = nil
    ) throws -> ReconciliationResult {
        guard !records.isEmpty else {
            throw ContinuityError.validation("reconcileDecisions requires at least one decision.")
        }

        // ── 1. validate + de-duplicate ─────────────────────────────────────────
        var deduped: [String: ReconcilableDecision] = [:]
        var unique: [ReconcilableDecision] = []
        for record in records {
            try validate(record)
            if let existing = deduped[record.id] {
                // The same id twice must be the same record. Two different answers under
                // one id is a corrupted sync payload, not a conflict to reconcile.
                if existing.outcome != record.outcome
                    || compareProvenance(existing.provenance, record.provenance) != .equal {
                    throw ContinuityError.validation(
                        "reconcileDecisions received conflicting records under id \"\(record.id)\"."
                    )
                }
                continue
            }
            deduped[record.id] = record
            unique.append(record)
        }
        if let bound = standingBound { try validate(bound) }

        var reasonCodes = Set<String>()
        var expiredIds: [String] = []

        // ── 2. standing bound ──────────────────────────────────────────────────
        let effective: [ReconcilableDecision] = try unique.map { record in
            guard let bound = standingBound, record.provenance.evaluatedOffline else { return record }
            let elapsed = bound.elapsedSecondsById[record.id]
            let unstated = elapsed == nil
            if let elapsed, elapsed <= bound.maxStandingSeconds { return record }
            let floor = bound.floor ?? .step_up
            expiredIds.append(record.id)
            reasonCodes.insert(unstated ? "OFFLINE_STANDING_AGE_UNSTATED" : "OFFLINE_STANDING_BOUND_EXCEEDED")
            let raised = try mostRestrictiveOutcome([record.outcome, floor])
            if raised == record.outcome { return record }
            return ReconcilableDecision(id: record.id, outcome: raised, provenance: record.provenance)
        }

        // ── 3. frontier ────────────────────────────────────────────────────────
        let frontier = effective.filter { candidate in
            !effective.contains { other in
                other.id != candidate.id
                    && compareProvenance(other.provenance, candidate.provenance) == .leftDominates
            }
        }

        let contested = frontier.contains { a in
            frontier.contains { b in
                a.id != b.id && compareProvenance(a.provenance, b.provenance) == .incomparable
            }
        }

        // ── 4/5. join, then veto ───────────────────────────────────────────────
        let authorityOutcome = try mostRestrictiveOutcome(frontier.map(\.outcome))
        let failClosedOutcome = try mostRestrictiveOutcome(effective.map(\.outcome))
        let authorityWouldRelax = rank(authorityOutcome) < rank(failClosedOutcome)

        var outcome = authorityOutcome
        if contested {
            reasonCodes.insert("PROVENANCE_CONTESTED_FAIL_CLOSED")
            outcome = failClosedOutcome
        } else if authorityWouldRelax {
            let offlineAuthority = frontier.contains { $0.provenance.evaluatedOffline }
            let supersededAuthority = frontier.contains { $0.provenance.policyKnownSuperseded }
            if offlineAuthority { reasonCodes.insert("OFFLINE_AUTHORITY_CANNOT_RELAX") }
            if supersededAuthority { reasonCodes.insert("SUPERSEDED_POLICY_AUTHORITY_CANNOT_RELAX") }
            if offlineAuthority || supersededAuthority {
                outcome = failClosedOutcome
            } else {
                // The un-stick path, and the only place a relaxation is honoured: a fully
                // connected evaluation under a strictly newer policy overrides an older
                // restriction. Without it the fabric is fail-stuck.
                reasonCodes.insert("NEWER_PROVENANCE_RELAXED_STALE_DECISION")
            }
        }

        if frontier.count == effective.count && effective.count > 1 && !contested {
            // Every record is a maximum and none is incomparable — they share one
            // provenance, so nothing was superseded and the join is the whole answer.
            reasonCodes.insert("PROVENANCE_UNIFORM_ACROSS_RECORDS")
        }

        return ReconciliationResult(
            outcome: outcome,
            reasonCodes: reasonCodes.sorted(),
            authorityIds: frontier.map(\.id).sorted(),
            contested: contested,
            expiredIds: expiredIds.sorted(),
            considered: effective.count
        )
    }

    // MARK: - Validation

    private static func validate(_ record: ReconcilableDecision) throws {
        if record.id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            throw ContinuityError.validation("reconcileDecisions record has no id.")
        }
        let p = record.provenance
        if p.policyVersion < 1 {
            throw ContinuityError.validation(
                "reconcileDecisions record \"\(record.id)\" has a non-positive policyVersion."
            )
        }
        if let core = p.coreNormalizationVersion, core < 1 {
            throw ContinuityError.validation(
                "reconcileDecisions record \"\(record.id)\" has a non-positive coreNormalizationVersion."
            )
        }
        // The two booleans are non-optional on the Swift struct, which is the type-level
        // form of the TS twin's rule that they are REQUIRED rather than defaulted:
        // defaulting either to false would default in the permissive direction, and an
        // omitted field would buy the record the right to relax. The caller has to say.
    }

    private static func validate(_ bound: StandingBound) throws {
        if !bound.maxStandingSeconds.isFinite || bound.maxStandingSeconds <= 0 {
            throw ContinuityError.validation("standingBound.maxStandingSeconds must be a finite positive number.")
        }
        for (id, elapsed) in bound.elapsedSecondsById {
            // A negative elapsed is the clock attack in a different coat: it would buy
            // standing that was never served. Reject rather than clamp — clamping makes a
            // tampered payload indistinguishable from an honest one.
            if !elapsed.isFinite || elapsed < 0 {
                throw ContinuityError.validation(
                    "standingBound.elapsedSecondsById[\"\(id)\"] must be a finite, non-negative number."
                )
            }
        }
    }
}
