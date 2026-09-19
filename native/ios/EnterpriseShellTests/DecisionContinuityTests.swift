import XCTest

#if canImport(EnterpriseShellPort)
@testable import EnterpriseShellPort
#endif

/// Locks the device-side decision reconciler against the TS original it mirrors
/// (`lib/signalgrid-core/src/continuity.ts`). The assertions below are the same
/// cases `scripts/src/decision-continuity-proof.ts` pins, so a divergence in either
/// direction shows up as a red test rather than as two fabrics quietly disagreeing.
final class DecisionContinuityTests: XCTestCase {

    private typealias Prov = DecisionContinuity.DecisionProvenance
    private typealias Record = DecisionContinuity.ReconcilableDecision

    private func prov(policy: Int,
                      core: Int? = nil,
                      offline: Bool = false,
                      superseded: Bool = false) -> Prov {
        Prov(policyVersion: policy,
             coreNormalizationVersion: core,
             evaluatedOffline: offline,
             policyKnownSuperseded: superseded)
    }

    private func rec(_ id: String,
                     _ outcome: AppWorkflows.DecisionOutcome,
                     _ provenance: Prov) -> Record {
        Record(id: id, outcome: outcome, provenance: provenance)
    }

    // MARK: - The product order

    func testProvenanceOrdering() {
        let cmp = DecisionContinuity.compareProvenance
        XCTAssertEqual(cmp(prov(policy: 3, core: 2), prov(policy: 3, core: 2)), .equal)
        XCTAssertEqual(cmp(prov(policy: 4, core: 2), prov(policy: 3, core: 2)), .leftDominates)
        XCTAssertEqual(cmp(prov(policy: 3, core: 3), prov(policy: 3, core: 2)), .leftDominates)
        XCTAssertEqual(cmp(prov(policy: 2, core: 1), prov(policy: 3, core: 2)), .rightDominates)
        // One axis up, one down — a staged rollout, genuinely undecidable.
        XCTAssertEqual(cmp(prov(policy: 4, core: 1), prov(policy: 3, core: 2)), .incomparable)
        // Antisymmetry on a sample.
        XCTAssertEqual(cmp(prov(policy: 3, core: 2), prov(policy: 4, core: 2)), .rightDominates)
    }

    func testAbsentCoreStampIsUnknownNotZero() {
        let cmp = DecisionContinuity.compareProvenance
        XCTAssertEqual(cmp(prov(policy: 3), prov(policy: 3, core: 1)), .incomparable)
        // Incomparable even against a LOWER policy version — reading absence as zero is
        // exactly the back-dating this refuses.
        XCTAssertEqual(cmp(prov(policy: 9), prov(policy: 1, core: 1)), .incomparable)
        // Two absent stamps order by policy version alone.
        XCTAssertEqual(cmp(prov(policy: 4), prov(policy: 3)), .leftDominates)
    }

    // MARK: - Veto and un-stick

    func testOfflineAuthorityCannotRelaxAConnectedDeny() throws {
        let r = try DecisionContinuity.reconcileDecisions([
            rec("device", .allow, prov(policy: 8, core: 3, offline: true)),
            rec("plane", .deny, prov(policy: 7, core: 3))
        ])
        XCTAssertEqual(r.outcome, .deny)
        XCTAssertTrue(r.reasonCodes.contains("OFFLINE_AUTHORITY_CANNOT_RELAX"))
        // The device is still named as the provenance authority; it just may not relax.
        XCTAssertEqual(r.authorityIds, ["device"])
    }

    func testConnectedAuthorityUnderNewerPolicyDoesRelax() throws {
        let r = try DecisionContinuity.reconcileDecisions([
            rec("fresh", .allow, prov(policy: 8, core: 3)),
            rec("stale", .deny, prov(policy: 7, core: 3))
        ])
        XCTAssertEqual(r.outcome, .allow)
        XCTAssertTrue(r.reasonCodes.contains("NEWER_PROVENANCE_RELAXED_STALE_DECISION"))
    }

    func testOfflineAuthorityMayStillRaise() throws {
        let r = try DecisionContinuity.reconcileDecisions([
            rec("device", .restrict, prov(policy: 8, core: 3, offline: true)),
            rec("plane", .allow, prov(policy: 7, core: 3))
        ])
        XCTAssertEqual(r.outcome, .restrict)
        XCTAssertFalse(r.reasonCodes.contains("OFFLINE_AUTHORITY_CANNOT_RELAX"))
    }

    func testKnowinglySupersededAuthorityCannotRelax() throws {
        let r = try DecisionContinuity.reconcileDecisions([
            rec("device", .allow, prov(policy: 8, core: 3, superseded: true)),
            rec("plane", .restrict, prov(policy: 7, core: 3))
        ])
        XCTAssertEqual(r.outcome, .restrict)
        XCTAssertTrue(r.reasonCodes.contains("SUPERSEDED_POLICY_AUTHORITY_CANNOT_RELAX"))
        XCTAssertFalse(r.reasonCodes.contains("OFFLINE_AUTHORITY_CANNOT_RELAX"))
    }

    func testContestedFrontierResolvesFailClosed() throws {
        let r = try DecisionContinuity.reconcileDecisions([
            rec("a", .allow, prov(policy: 9, core: 1)),
            rec("b", .restrict, prov(policy: 8, core: 4))
        ])
        XCTAssertTrue(r.contested)
        XCTAssertEqual(r.outcome, .restrict)
        XCTAssertTrue(r.reasonCodes.contains("PROVENANCE_CONTESTED_FAIL_CLOSED"))
    }

    func testStampedRecordCannotRelaxAnUnstampedDeny() throws {
        let r = try DecisionContinuity.reconcileDecisions([
            rec("stamped", .allow, prov(policy: 9, core: 4)),
            rec("legacy", .deny, prov(policy: 8))
        ])
        XCTAssertEqual(r.outcome, .deny)
        XCTAssertTrue(r.contested)
        XCTAssertTrue(r.reasonCodes.contains("PROVENANCE_CONTESTED_FAIL_CLOSED"))
    }

    func testUniformProvenanceJoinsFailClosed() throws {
        let r = try DecisionContinuity.reconcileDecisions([
            rec("a", .allow, prov(policy: 5, core: 2)),
            rec("b", .step_up, prov(policy: 5, core: 2))
        ])
        XCTAssertEqual(r.outcome, .step_up)
        XCTAssertFalse(r.contested)
        XCTAssertTrue(r.reasonCodes.contains("PROVENANCE_UNIFORM_ACROSS_RECORDS"))
    }

    func testLoneRecordReconcilesToItself() throws {
        let r = try DecisionContinuity.reconcileDecisions([
            rec("only", .allow, prov(policy: 3, core: 1))
        ])
        XCTAssertEqual(r.outcome, .allow)
        XCTAssertEqual(r.considered, 1)
        XCTAssertEqual(r.authorityIds, ["only"])
    }

    // MARK: - Standing bound

    private func offlineAllow(_ id: String = "device") -> Record {
        rec(id, .allow, prov(policy: 8, core: 3, offline: true))
    }

    func testOfflineDecisionInsideItsBoundStands() throws {
        let r = try DecisionContinuity.reconcileDecisions(
            [offlineAllow()],
            standingBound: DecisionContinuity.StandingBound(maxStandingSeconds: 600, elapsedSecondsById: ["device": 120])
        )
        XCTAssertEqual(r.outcome, .allow)
        XCTAssertTrue(r.expiredIds.isEmpty)
    }

    func testOfflineDecisionPastItsBoundIsRaisedToTheFloor() throws {
        let r = try DecisionContinuity.reconcileDecisions(
            [offlineAllow()],
            standingBound: DecisionContinuity.StandingBound(maxStandingSeconds: 600, elapsedSecondsById: ["device": 900])
        )
        XCTAssertEqual(r.outcome, .step_up)
        XCTAssertEqual(r.expiredIds, ["device"])
        XCTAssertTrue(r.reasonCodes.contains("OFFLINE_STANDING_BOUND_EXCEEDED"))
    }

    func testUnstatedAgeExpiresAndSaysSo() throws {
        // Silence buys nothing: an unstated age is an unknown, and an unknown that
        // bought unbounded standing is the defect this whole file refuses.
        let r = try DecisionContinuity.reconcileDecisions(
            [offlineAllow()],
            standingBound: DecisionContinuity.StandingBound(maxStandingSeconds: 600, elapsedSecondsById: [:])
        )
        XCTAssertEqual(r.outcome, .step_up)
        XCTAssertTrue(r.reasonCodes.contains("OFFLINE_STANDING_AGE_UNSTATED"))
        XCTAssertFalse(r.reasonCodes.contains("OFFLINE_STANDING_BOUND_EXCEEDED"))
    }

    func testExpiryNeverLowersAnOutcome() throws {
        let r = try DecisionContinuity.reconcileDecisions(
            [rec("device", .deny, prov(policy: 8, core: 3, offline: true))],
            standingBound: DecisionContinuity.StandingBound(maxStandingSeconds: 600, elapsedSecondsById: ["device": 900])
        )
        XCTAssertEqual(r.outcome, .deny)
    }

    func testStandingBoundDoesNotTouchAnOnlineDecision() throws {
        let r = try DecisionContinuity.reconcileDecisions(
            [rec("plane", .allow, prov(policy: 8, core: 3))],
            standingBound: DecisionContinuity.StandingBound(maxStandingSeconds: 1, elapsedSecondsById: [:])
        )
        XCTAssertEqual(r.outcome, .allow)
        XCTAssertTrue(r.expiredIds.isEmpty)
    }

    func testCallerPosedFloorIsHonoured() throws {
        let r = try DecisionContinuity.reconcileDecisions(
            [offlineAllow()],
            standingBound: DecisionContinuity.StandingBound(maxStandingSeconds: 600,
                                 elapsedSecondsById: ["device": 900],
                                 floor: .deny)
        )
        XCTAssertEqual(r.outcome, .deny)
    }

    // MARK: - Set semantics

    func testOrderIndependenceAndIdempotence() throws {
        let a = rec("a", .allow, prov(policy: 9, core: 1))
        let b = rec("b", .restrict, prov(policy: 8, core: 4))
        let c = rec("c", .step_up, prov(policy: 8, core: 4, offline: true))
        let base = try DecisionContinuity.reconcileDecisions([a, b, c])
        for permutation in [[c, b, a], [b, a, c], [c, a, b]] {
            XCTAssertEqual(try DecisionContinuity.reconcileDecisions(permutation), base)
        }
        // Re-delivering a record is de-duplication, not a new vote.
        XCTAssertEqual(try DecisionContinuity.reconcileDecisions([a, b, c, a, b]), base)
    }

    // MARK: - Refusals

    func testEmptyInputIsRefused() {
        XCTAssertThrowsError(try DecisionContinuity.reconcileDecisions([]))
    }

    func testConflictingRecordsUnderOneIdAreRefused() {
        // Two different answers under one id is a corrupted sync payload, not a
        // conflict to reconcile.
        XCTAssertThrowsError(try DecisionContinuity.reconcileDecisions([
            rec("dup", .allow, prov(policy: 8, core: 3)),
            rec("dup", .deny, prov(policy: 8, core: 3))
        ]))
    }

    func testMalformedProvenanceIsRefused() {
        XCTAssertThrowsError(try DecisionContinuity.reconcileDecisions([
            rec("bad", .allow, prov(policy: 0, core: 3))
        ]))
        XCTAssertThrowsError(try DecisionContinuity.reconcileDecisions([
            rec("bad", .allow, prov(policy: 1, core: 0))
        ]))
        XCTAssertThrowsError(try DecisionContinuity.reconcileDecisions([
            rec("   ", .allow, prov(policy: 1, core: 3))
        ]))
    }

    func testMalformedStandingBoundIsRefused() {
        XCTAssertThrowsError(try DecisionContinuity.reconcileDecisions(
            [offlineAllow()],
            standingBound: DecisionContinuity.StandingBound(maxStandingSeconds: 0, elapsedSecondsById: [:])
        ))
        // A negative elapsed is the clock attack in a different coat — rejected, not clamped.
        XCTAssertThrowsError(try DecisionContinuity.reconcileDecisions(
            [offlineAllow()],
            standingBound: DecisionContinuity.StandingBound(maxStandingSeconds: 600, elapsedSecondsById: ["device": -1])
        ))
    }

    func testMostRestrictiveOutcomeRefusesAnEmptySet() {
        XCTAssertThrowsError(try DecisionContinuity.mostRestrictiveOutcome([]))
        XCTAssertEqual(try DecisionContinuity.mostRestrictiveOutcome([.allow, .deny, .step_up]), .deny)
    }
}
