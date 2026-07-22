import XCTest

/// Locks the Swift `DecisionEngine` port to the invariants of the TypeScript
/// reference (`lib/signalgrid-simulator/src/decisionEngine.ts`,
/// `SIMULATOR_DECISION_ENGINE.md`). If the port drifts from the reference rules,
/// these fail.
final class DecisionEngineTests: XCTestCase {

    private typealias Signal = DecisionEngine.Signal

    // A trusted identity + fresh posture is the only path to `allow`.
    func testIdentityAndPostureAllows() {
        let r = DecisionEngine.evaluate([.authenticated, .postureObserved])
        XCTAssertEqual(r.outcome, .allow)
        XCTAssertTrue(r.reasonCodes.contains("IDENTITY_AND_POSTURE_TRUSTED"))
        XCTAssertTrue(r.allOutcomes.contains("record_audit"), "every decision records audit")
    }

    func testDeclaredStateAllows() {
        let r = DecisionEngine.evaluate([.authenticated, Signal("apple.ddm_declared_state")])
        XCTAssertEqual(r.outcome, .allow)
        XCTAssertTrue(r.reasonCodes.contains("APPLE_DECLARED_STATE_TRUSTED"))
    }

    // Stale posture cannot be treated as fully trusted → step_up, allow removed.
    func testStalePostureStepsUp() {
        let r = DecisionEngine.evaluate([.authenticated, .postureObserved, .staleCheckin])
        XCTAssertEqual(r.outcome, .step_up)
        XCTAssertTrue(r.reasonCodes.contains("POSTURE_STALE"))
        XCTAssertFalse(r.allOutcomes.contains("allow"))
    }

    // A non-compliant device cannot map to allow.
    func testNonCompliantRestricts() {
        let r = DecisionEngine.evaluate([.authenticated, .postureObserved, .nonCompliant])
        XCTAssertEqual(r.outcome, .restrict)
        XCTAssertTrue(r.reasonCodes.contains("DEVICE_NON_COMPLIANT"))
        XCTAssertFalse(r.allOutcomes.contains("allow"))
    }

    // High security risk escalates.
    func testSecurityRiskRestricts() {
        let r = DecisionEngine.evaluate([.authenticated, .postureObserved, .securityRisk])
        XCTAssertEqual(r.outcome, .restrict)
        XCTAssertTrue(r.reasonCodes.contains("SECURITY_RISK_ESCALATION"))
    }

    // A device-trust failure via management state.
    func testUnmanagedRestricts() {
        let r = DecisionEngine.evaluate([
            .authenticated,
            Signal("device.posture_observed", attributes: ["managementState": "unmanaged"]),
        ])
        XCTAssertEqual(r.outcome, .restrict)
        XCTAssertTrue(r.reasonCodes.contains("DEVICE_TRUST_FAILURE"))
    }

    // A location/custody exception produces routing but no gate-allow → fail-closed step_up.
    func testWrongZoneFailsClosed() {
        let r = DecisionEngine.evaluate([.authenticated, .postureObserved, .wrongZone])
        XCTAssertEqual(r.outcome, .step_up)
        XCTAssertFalse(r.allOutcomes.contains("allow"))
        XCTAssertTrue(r.reasonCodes.contains("LOCATION_EXCEPTION"))
    }

    // Verified remediation makes the device an allow candidate.
    func testRemediationVerifiedAllows() {
        let r = DecisionEngine.evaluate([Signal("remediation.verified")])
        XCTAssertEqual(r.outcome, .allow)
        XCTAssertTrue(r.reasonCodes.contains("REMEDIATION_VERIFIED"))
    }

    // An allow candidate is removed when a higher-risk outcome is also present.
    func testAllowRemovedDueToHigherRisk() {
        let r = DecisionEngine.evaluate([Signal("remediation.verified"), .staleCheckin])
        XCTAssertFalse(r.allOutcomes.contains("allow"))
        XCTAssertTrue(r.reasonCodes.contains("ALLOW_REMOVED_DUE_TO_HIGHER_RISK"))
        XCTAssertEqual(r.outcome, .step_up)
    }

    // An allow candidate is removed on an active custody-integrity failure.
    func testAllowRemovedDueToCustodyFailure() {
        let r = DecisionEngine.evaluate([
            Signal("remediation.verified"),
            Signal("device.posture_observed", attributes: ["zone": "wrong"]),
        ])
        XCTAssertFalse(r.allOutcomes.contains("allow"))
        XCTAssertTrue(r.reasonCodes.contains("ALLOW_REMOVED_DUE_TO_CUSTODY_FAILURE"))
    }

    // No signals → fail-closed default (never allow) + audit.
    func testEmptyContextFailsClosed() {
        let r = DecisionEngine.evaluate([])
        XCTAssertEqual(r.outcome, .step_up)
        XCTAssertFalse(r.allOutcomes.contains("allow"))
        XCTAssertTrue(r.allOutcomes.contains("record_audit"))
    }

    // Deterministic: identical inputs → identical outputs.
    func testDeterministic() {
        let ctx: [Signal] = [.authenticated, .postureObserved, .staleCheckin]
        XCTAssertEqual(DecisionEngine.evaluate(ctx).outcome, DecisionEngine.evaluate(ctx).outcome)
        XCTAssertEqual(DecisionEngine.evaluate(ctx).reasonCodes, DecisionEngine.evaluate(ctx).reasonCodes)
    }
}
