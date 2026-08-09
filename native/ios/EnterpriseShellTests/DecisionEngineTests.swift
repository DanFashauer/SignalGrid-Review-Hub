import XCTest

// In Xcode these sources are compiled directly into the test bundle (see
// `EnterpriseShellTests` in ../project.yml), so there is no module to import. Under
// SwiftPM (../Package.swift) the same files are a library, and this brings it in.
// `canImport` keeps one set of tests serving both, with no #if around the tests
// themselves — a divergence there is how two builds start proving different things.
#if canImport(EnterpriseShellPort)
@testable import EnterpriseShellPort
#endif

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

    // Verified remediation restores an allow candidate — WITH base trust present.
    func testRemediationVerifiedAllows() {
        let r = DecisionEngine.evaluate([
            Signal("remediation.verified"),
            Signal("identity.authenticated"),
            Signal("device.posture_observed"),
        ])
        XCTAssertEqual(r.outcome, .allow)
        XCTAssertTrue(r.reasonCodes.contains("REMEDIATION_VERIFIED"))
    }

    // Negative control (review finding): remediation evidence ALONE — no authenticated
    // identity, no observed posture — must not release anything. The evidence is
    // verified and audited, but the gate holds for a step-up, never allow.
    func testRemediationAloneDoesNotAllow() {
        let r = DecisionEngine.evaluate([Signal("remediation.verified")])
        XCTAssertFalse(r.allOutcomes.contains("allow"))
        XCTAssertTrue(r.allOutcomes.contains("verify_remediation"))
        XCTAssertEqual(r.outcome, .step_up)
    }

    // An allow candidate is removed when a higher-risk outcome is also present.
    func testAllowRemovedDueToHigherRisk() {
        let r = DecisionEngine.evaluate([
            Signal("remediation.verified"),
            Signal("identity.authenticated"),
            Signal("device.posture_observed"),
            .staleCheckin,
        ])
        XCTAssertFalse(r.allOutcomes.contains("allow"))
        XCTAssertTrue(r.reasonCodes.contains("ALLOW_REMOVED_DUE_TO_HIGHER_RISK"))
        XCTAssertEqual(r.outcome, .step_up)
    }

    // An allow candidate is removed on an active custody-integrity failure. Base
    // trust (identity + posture) is supplied so the remediation branch actually
    // inserts the allow candidate this test removes — remediation alone no longer
    // creates one (see testRemediationAloneDoesNotAllow).
    func testAllowRemovedDueToCustodyFailure() {
        let r = DecisionEngine.evaluate([
            Signal("remediation.verified"),
            Signal("identity.authenticated"),
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
