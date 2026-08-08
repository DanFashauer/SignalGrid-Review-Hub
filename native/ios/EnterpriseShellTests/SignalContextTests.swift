import XCTest

// In Xcode these sources are compiled directly into the test bundle (see
// `EnterpriseShellTests` in ../project.yml), so there is no module to import. Under
// SwiftPM (../Package.swift) the same files are a library, and this brings it in.
// `canImport` keeps one set of tests serving both, with no #if around the tests
// themselves — a divergence there is how two builds start proving different things.
#if canImport(EnterpriseShellPort)
@testable import EnterpriseShellPort
#endif

/// Locks the live signal-context layer: how detected posture + demo injection map
/// to engine signals, the zone pre-gate, and `AccessDecision` composition.
final class SignalContextTests: XCTestCase {

    private typealias Env = SignalContext.EnvironmentContext

    private func env(expected: String = "clinic",
                     detected: String? = "clinic",
                     screenCaptured: Bool = false,
                     sessionStale: Bool = false,
                     lockedOut: Bool = false,
                     injected: Set<String> = [],
                     postureObserved: Bool = true) -> Env {
        Env(authenticated: true, expectedZone: expected, detectedZone: detected,
            screenCaptured: screenCaptured, sessionStale: sessionStale,
            lockedOut: lockedOut, injected: injected, postureObserved: postureObserved)
    }

    // A trusted, in-zone session with fresh, OBSERVED posture → allow.
    func testTrustedContextAllows() {
        let r = DecisionEngine.evaluate(SignalContext.signals(env()))
        XCTAssertEqual(r.outcome, .allow)
        XCTAssertTrue(r.reasonCodes.contains("IDENTITY_AND_POSTURE_TRUSTED"))
    }

    // Negative control for the fail-closed posture gate: an authenticated,
    // in-zone session whose posture was NEVER positively sourced must NOT get
    // the base allow evidence — absence of observation is not observed-good.
    func testUnobservedPostureFailsClosed() {
        let r = DecisionEngine.evaluate(SignalContext.signals(env(postureObserved: false)))
        XCTAssertNotEqual(r.outcome, .allow)
    }

    // Stale posture (real freshness OR injected) → step_up.
    func testStalePostureStepsUp() {
        XCTAssertEqual(DecisionEngine.evaluate(SignalContext.signals(env(sessionStale: true))).outcome, .step_up)
        XCTAssertEqual(DecisionEngine.evaluate(SignalContext.signals(env(injected: ["stale"]))).outcome, .step_up)
    }

    // Injected non-compliance → restrict.
    func testNonCompliantRestricts() {
        let r = DecisionEngine.evaluate(SignalContext.signals(env(injected: ["non_compliant"])))
        XCTAssertEqual(r.outcome, .restrict)
        XCTAssertTrue(r.reasonCodes.contains("DEVICE_NON_COMPLIANT"))
    }

    // Active screen recording maps to a high security risk → restrict.
    func testScreenCaptureRestricts() {
        let r = DecisionEngine.evaluate(SignalContext.signals(env(screenCaptured: true)))
        XCTAssertEqual(r.outcome, .restrict)
        XCTAssertTrue(r.reasonCodes.contains("SECURITY_RISK_ESCALATION"))
    }

    // Lockout or injected security risk → restrict.
    func testSecurityRiskRestricts() {
        XCTAssertEqual(DecisionEngine.evaluate(SignalContext.signals(env(lockedOut: true))).outcome, .restrict)
        XCTAssertEqual(DecisionEngine.evaluate(SignalContext.signals(env(injected: ["security_risk"]))).outcome, .restrict)
    }

    // MARK: - Zone pre-gate

    func testLocationGate() {
        XCTAssertFalse(LocationGate.denied(expected: "clinic", detected: "clinic"))
        XCTAssertTrue(LocationGate.denied(expected: "clinic", detected: "warehouse"))
        XCTAssertTrue(LocationGate.denied(expected: "clinic", detected: nil))
        XCTAssertTrue(LocationGate.denied(expected: "clinic", detected: ""))
    }

    // MARK: - AccessDecision composition

    /// A stub that records whether it was consulted, so we can prove the zone
    /// pre-gate short-circuits BEFORE any decision service is called.
    private final class SpyService: DecisionService {
        var called = false
        let result: DecisionResult
        init(_ result: DecisionResult) { self.result = result }
        func evaluate(_ request: AppDecisionRequest) async throws -> DecisionResult {
            called = true
            return result
        }
    }

    func testAccessDeniedOnZoneMismatchWithoutCallingService() async {
        let spy = SpyService(DecisionResult(outcome: .allow, reasonCodes: [], explanation: "", source: .onDevice))
        let r = await AccessDecision.evaluate(
            env(expected: "clinic", detected: "warehouse"),
            integration: AppWorkflows.emrChart,
            identityRef: "op", deviceRef: "dev", via: spy)
        XCTAssertEqual(r.outcome, .deny)
        XCTAssertTrue(r.reasonCodes.contains("ZONE_MISMATCH"))
        XCTAssertFalse(spy.called, "zone deny must short-circuit before the decision service")
    }

    func testAccessUnknownZoneDenies() async {
        let spy = SpyService(DecisionResult(outcome: .allow, reasonCodes: [], explanation: "", source: .onDevice))
        let r = await AccessDecision.evaluate(
            env(expected: "clinic", detected: nil),
            integration: AppWorkflows.emrChart,
            identityRef: "op", deviceRef: "dev", via: spy)
        XCTAssertEqual(r.outcome, .deny)
        XCTAssertTrue(r.reasonCodes.contains("ZONE_UNKNOWN"))
        XCTAssertFalse(spy.called)
    }

    func testAccessDelegatesToServiceWhenInZone() async {
        let spy = SpyService(DecisionResult(outcome: .allow, reasonCodes: ["X"], explanation: "", source: .onDevice))
        let r = await AccessDecision.evaluate(
            env(expected: "clinic", detected: "clinic"),
            integration: AppWorkflows.emrChart,
            identityRef: "op", deviceRef: "dev", via: spy)
        XCTAssertTrue(spy.called, "in-zone sessions defer to the decision service")
        XCTAssertEqual(r.outcome, .allow)
    }
}
