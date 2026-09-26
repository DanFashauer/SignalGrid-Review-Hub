import XCTest

// In Xcode these sources are compiled directly into the test bundle (see
// `EnterpriseShellTests` in ../project.yml), so there is no module to import. Under
// SwiftPM (../Package.swift) the same files are a library, and this brings it in.
// `canImport` keeps one set of tests serving both.
#if canImport(EnterpriseShellPort)
@testable import EnterpriseShellPort
#endif

/// Behavioural parity of the Assist-planner port with its TypeScript original, held to
/// the SAME cases: `native/shared/app-workflows-vectors.json`, emitted by
/// `scripts/src/app-workflows-parity-proof.ts` from the TS planner's own decisions and
/// read here by path (via `#filePath`), not bundled — so both sides bind to one file.
///
/// `scripts/check-decision-port-parity.mjs` section 3b compares the two planners' record
/// SHAPES field for field; it cannot see a rule whose fields match and whose logic does
/// not (BUILD_BACKLOG row 101: the scoped step-up release). THIS test is the substance:
/// every case is replayed through `AppWorkflows.planAppSession` and the mode, the
/// summary, and every action's disposition, confirmation flag and reason must be what
/// the TypeScript planner produced. `AppWorkflows.swift` is never edited from here
/// (CLAUDE.md golden rule 1).
final class AppWorkflowsParityTests: XCTestCase {

    // MARK: - Vector loading

    /// …/native/ios/EnterpriseShellTests/AppWorkflowsParityTests.swift → up three to
    /// …/native → shared/app-workflows-vectors.json.
    private static let vectorsRelativePath = "shared/app-workflows-vectors.json"

    private struct VectorDoc {
        let cases: [[String: Any]]
        let requires: [String: Any]
    }

    private func loadVectors(file: StaticString = #filePath) throws -> VectorDoc {
        let here = URL(fileURLWithPath: "\(file)")
        let nativeRoot = here.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let vectorsURL = nativeRoot.appendingPathComponent(Self.vectorsRelativePath)
        let data = try Data(contentsOf: vectorsURL)
        let root = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let cases = root?["cases"] as? [[String: Any]]
        let requires = root?["requires"] as? [String: Any]
        // If the path resolves wrong, a naive test reads nothing and passes vacuously —
        // exactly the shape this repo keeps catching. Fail loudly instead.
        XCTAssertNotNil(cases, "could not read `cases` from \(vectorsURL.path)")
        XCTAssertNotNil(requires, "could not read `requires` from \(vectorsURL.path)")
        return VectorDoc(cases: cases ?? [], requires: requires ?? [:])
    }

    // MARK: - Decoding (a malformed vector fails the case, never silently defaults)

    private func integration(from raw: [String: Any], id: String) -> AppWorkflows.AppIntegration? {
        guard let iid = raw["id"] as? String, let name = raw["name"] as? String,
              let category = raw["category"] as? String, let vertical = raw["vertical"] as? String,
              let workflowKey = raw["workflowKey"] as? String,
              let rawActions = raw["actions"] as? [[String: Any]] else {
            XCTFail("\(id): integration is malformed")
            return nil
        }
        var actions: [AppWorkflows.AppAction] = []
        for a in rawActions {
            guard let key = a["key"] as? String, let label = a["label"] as? String,
                  let tierRaw = a["riskTier"] as? String, let tier = AppWorkflows.AppRiskTier(rawValue: tierRaw),
                  let sensitive = a["sensitive"] as? Bool, let gated = a["gatedByStepUp"] as? Bool else {
                XCTFail("\(id): action is malformed")
                return nil
            }
            actions.append(AppWorkflows.AppAction(key, label, tier, sensitive: sensitive, gated: gated))
        }
        return AppWorkflows.AppIntegration(id: iid, name: name, category: category, vertical: vertical,
                                           workflowKey: workflowKey, actions: actions)
    }

    private func input(from raw: [String: Any], integration: AppWorkflows.AppIntegration, id: String) -> AppWorkflows.AppPlanInput? {
        guard let outcomeRaw = raw["outcome"] as? String,
              let outcome = AppWorkflows.DecisionOutcome(rawValue: outcomeRaw),
              let reasonCodes = raw["reasonCodes"] as? [String],
              let confirmed = raw["confirmedActionKeys"] as? [String],
              let stepUpSatisfied = raw["stepUpSatisfied"] as? Bool,
              let scoped = raw["stepUpSatisfiedActionKeys"] as? [String] else {
            XCTFail("\(id): input is malformed")
            return nil
        }
        var input = AppWorkflows.AppPlanInput(integration: integration, outcome: outcome, reasonCodes: reasonCodes)
        input.confirmedActionKeys = confirmed
        input.stepUpSatisfied = stepUpSatisfied
        input.stepUpSatisfiedActionKeys = scoped
        if let confirmer = raw["confirmer"] as? String { input.confirmer = confirmer }
        return input
    }

    // MARK: - Non-vacuity floor (honored independently of the TS side)

    func testVectorFloorIsSatisfied() throws {
        let doc = try loadVectors()
        let cases = doc.cases

        if let minCases = doc.requires["minCases"] as? Int {
            XCTAssertGreaterThanOrEqual(cases.count, minCases, "below the file's own declared floor")
        } else {
            XCTFail("vectors declare no minCases floor")
        }
        XCTAssertGreaterThanOrEqual(cases.count, 100, "fewer than 100 cases — the sweep is missing")

        var dispositions = Set<String>()
        var modes = Set<String>()
        for c in cases {
            let expect = c["expect"] as? [String: Any] ?? [:]
            if let m = expect["mode"] as? String { modes.insert(m) }
            for a in (expect["actions"] as? [[String: Any]] ?? []) {
                if let d = a["disposition"] as? String { dispositions.insert(d) }
            }
        }
        for expected in (doc.requires["dispositionsPresent"] as? [String] ?? []) {
            XCTAssertTrue(dispositions.contains(expected), "no case expects disposition \(expected)")
        }
        for expected in (doc.requires["modesPresent"] as? [String] ?? []) {
            XCTAssertTrue(modes.contains(expected), "no case expects mode \(expected)")
        }
        // The ones that kill a trivial port, asserted directly.
        XCTAssertTrue(dispositions.contains("applied"), "no case expects APPLIED — a never-confirms port would pass")
        XCTAssertTrue(dispositions.contains("step_up"), "no case expects STEP_UP — a release-everything port would pass")
        XCTAssertTrue(dispositions.contains("auto"), "no case expects AUTO — a block-everything port would pass")
        XCTAssertEqual(modes.count, 5, "every planner mode must be exercised")
    }

    // MARK: - The shared cases

    func testEveryVectorMatches() throws {
        let doc = try loadVectors()
        XCTAssertFalse(doc.cases.isEmpty, "no cases loaded")

        var compared = 0
        for (index, c) in doc.cases.enumerated() {
            let id = c["id"] as? String ?? "case[\(index)]"
            guard let rawIntegration = c["integration"] as? [String: Any],
                  let rawInput = c["input"] as? [String: Any],
                  let expect = c["expect"] as? [String: Any],
                  let expectMode = expect["mode"] as? String,
                  let expectSummary = expect["summary"] as? String,
                  let expectActions = expect["actions"] as? [[String: Any]] else {
                XCTFail("\(id): case is malformed")
                continue
            }
            guard let integration = integration(from: rawIntegration, id: id),
                  let input = input(from: rawInput, integration: integration, id: id) else { continue }

            let plan = AppWorkflows.planAppSession(input)
            XCTAssertEqual(plan.mode.rawValue, expectMode, "\(id): mode differs from the TS planner")
            XCTAssertEqual(plan.summary, expectSummary, "\(id): summary differs from the TS planner")
            XCTAssertEqual(plan.actions.count, expectActions.count, "\(id): action count differs")
            for (i, ea) in expectActions.enumerated() where i < plan.actions.count {
                let a = plan.actions[i]
                let key = ea["key"] as? String ?? "action[\(i)]"
                XCTAssertEqual(a.key, key, "\(id): action order differs at \(i)")
                XCTAssertEqual(a.disposition.rawValue, ea["disposition"] as? String ?? "", "\(id) \(key): disposition differs from the TS planner")
                XCTAssertEqual(a.requiresConfirmation, ea["requiresConfirmation"] as? Bool ?? !a.requiresConfirmation, "\(id) \(key): requiresConfirmation differs")
                XCTAssertEqual(a.reason, ea["reason"] as? String ?? "", "\(id) \(key): reason differs from the TS planner")
            }
            compared += 1
        }
        XCTAssertEqual(compared, doc.cases.count, "every case must have been compared — a skipped case is an unproven one")
    }
}
