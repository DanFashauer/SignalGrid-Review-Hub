import XCTest

// In Xcode these sources are compiled directly into the test bundle (see
// `EnterpriseShellTests` in ../project.yml), so there is no module to import. Under
// SwiftPM (../Package.swift) the same files are a library, and this brings it in.
// `canImport` keeps one set of tests serving both, with no #if around the tests
// themselves — a divergence there is how two builds start proving different things.
#if canImport(EnterpriseShellPort)
@testable import EnterpriseShellPort
#endif

/// Locks the Swift `AppWorkflows` planner port to the safety invariants of the
/// TypeScript reference (`lib/app-workflows/src/index.ts`). The central guarantee:
/// nothing sensitive fires silently.
final class AppWorkflowsTests: XCTestCase {

    private let emr = AppWorkflows.emrChart

    private func input(_ outcome: AppWorkflows.DecisionOutcome,
                       _ reasons: [String] = []) -> AppWorkflows.AppPlanInput {
        AppWorkflows.AppPlanInput(integration: emr, outcome: outcome, reasonCodes: reasons)
    }

    private func gate(_ outcome: AppWorkflows.DecisionOutcome, _ key: String) throws -> AppWorkflows.AppActionPlan {
        try XCTUnwrap(AppWorkflows.gateAppAction(input(outcome), key))
    }

    // allow + non-sensitive read → runs automatically.
    func testAllowNonSensitiveIsAuto() throws {
        let p = try gate(.allow, "chart.open") // elevated, not sensitive
        XCTAssertEqual(p.disposition, .auto)
        XCTAssertFalse(p.requiresConfirmation)
    }

    // allow + sensitive → held for confirmation (assist), never auto.
    func testAllowSensitiveIsAssist() throws {
        let p = try gate(.allow, "order.place") // critical, sensitive
        XCTAssertEqual(p.disposition, .assist)
        XCTAssertTrue(p.requiresConfirmation)
    }

    // A confirmed sensitive action is applied.
    func testConfirmSensitiveApplies() throws {
        let plan = AppWorkflows.confirmAppActions(input(.allow), ["order.place"])
        let a = try XCTUnwrap(plan.actions.first { $0.key == "order.place" })
        XCTAssertEqual(a.disposition, .applied)
    }

    // step_up holds a gated action.
    func testStepUpHoldsGated() throws {
        let p = try gate(.step_up, "chart.open") // gated
        XCTAssertEqual(p.disposition, .step_up)
        XCTAssertTrue(p.requiresConfirmation)
    }

    // step_up still permits a low-risk, non-gated action.
    func testStepUpPermitsStandard() throws {
        let p = try gate(.step_up, "note.document") // standard, not gated, not sensitive
        XCTAssertEqual(p.disposition, .auto)
    }

    // restrict blocks a sensitive/gated action…
    func testRestrictBlocksSensitive() throws {
        let p = try gate(.restrict, "order.place")
        XCTAssertEqual(p.disposition, .blocked)
    }

    // …but permits a low-risk one.
    func testRestrictPermitsStandard() throws {
        let p = try gate(.restrict, "note.document")
        XCTAssertEqual(p.disposition, .auto)
    }

    func testDenyBlocks() throws {
        let p = try gate(.deny, "chart.open")
        XCTAssertEqual(p.disposition, .blocked)
    }

    // THE key invariant: a satisfied step-up alone does NOT fire a sensitive action;
    // it stays assist until an explicit confirmation.
    func testStepUpSatisfiedKeepsSensitiveAtAssist() throws {
        let plan = AppWorkflows.completeAppStepUp(input(.step_up))
        let a = try XCTUnwrap(plan.actions.first { $0.key == "order.place" })
        XCTAssertEqual(a.disposition, .assist, "biometric alone must not fire a sensitive action")
        XCTAssertTrue(a.requiresConfirmation)
    }

    // A gated-but-not-sensitive action IS released once the step-up is satisfied.
    func testStepUpSatisfiedReleasesGatedNonSensitive() throws {
        let plan = AppWorkflows.completeAppStepUp(input(.step_up))
        let a = try XCTUnwrap(plan.actions.first { $0.key == "chart.open" })
        XCTAssertEqual(a.disposition, .auto)
    }

    // Session mode is `assist` when any sensitive action awaits confirmation.
    func testModeAssistWhenSensitivePresent() {
        XCTAssertEqual(AppWorkflows.planAppSession(input(.allow)).mode, .assist)
    }

    // Session mode is `proceed` when every action is non-sensitive.
    func testModeProceedWhenAllNonSensitive() {
        let allStandard = AppWorkflows.AppIntegration(
            id: "x", name: "X", category: "c", vertical: "healthcare", workflowKey: "w",
            actions: [AppWorkflows.AppAction("read", "Read", .standard)])
        let plan = AppWorkflows.planAppSession(
            AppWorkflows.AppPlanInput(integration: allStandard, outcome: .allow, reasonCodes: []))
        XCTAssertEqual(plan.mode, .proceed)
    }

    // Confirmer is phrased for the vertical.
    func testConfirmerPerVertical() {
        XCTAssertEqual(AppWorkflows.confirmer(for: AppWorkflows.emrChart), "clinician")
        XCTAssertEqual(AppWorkflows.confirmer(for: AppWorkflows.wms), "supervisor")
    }
}
