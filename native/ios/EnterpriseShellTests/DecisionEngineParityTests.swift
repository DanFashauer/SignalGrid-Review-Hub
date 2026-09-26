import XCTest

// In Xcode these sources are compiled directly into the test bundle (see
// `EnterpriseShellTests` in ../project.yml), so there is no module to import. Under
// SwiftPM (../Package.swift) the same files are a library, and this brings it in.
// `canImport` keeps one set of tests serving both.
#if canImport(EnterpriseShellPort)
@testable import EnterpriseShellPort
#endif

/// Behavioural parity of the decision-engine port with its TypeScript original, held
/// to the SAME cases: `native/shared/decision-engine-vectors.json`, emitted by
/// `scripts/src/decision-engine-parity-proof.ts` from the TS engine's own decisions and
/// read here by path (via `#filePath`), not bundled — so both sides bind to one file and
/// cannot drift onto separate copies.
///
/// `scripts/check-decision-port-parity.mjs` compares the two engines' VOCABULARY (reason
/// codes, outcome literals); it cannot see a rule whose words match and whose logic does
/// not. THIS test is the substance: every case is replayed through
/// `DecisionEngine.evaluate` and the ordered outcome set and the reason codes must be
/// identical to what the TypeScript engine produced. Falsifiable — flip one expected
/// outcome in the vectors and the named case goes red (exercised in the lane's delivery).
/// `DecisionEngine.swift` is never edited from here (CLAUDE.md golden rule 1).
final class DecisionEngineParityTests: XCTestCase {

    // MARK: - Vector loading

    /// Repo path of the shared vectors, derived from this source file's own location:
    /// …/native/ios/EnterpriseShellTests/DecisionEngineParityTests.swift → up three to
    /// …/native → shared/decision-engine-vectors.json.
    private static let vectorsRelativePath = "shared/decision-engine-vectors.json"

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

    // MARK: - Non-vacuity floor (honored independently of the TS side)

    /// The vector file ships a floor precisely so each client checks it rather than
    /// trusting the other. A port that answered `restrict` to everything would match
    /// every restricting case; this asserts the table still forces a real spread.
    func testVectorFloorIsSatisfied() throws {
        let doc = try loadVectors()
        let cases = doc.cases

        if let minCases = doc.requires["minCases"] as? Int {
            XCTAssertGreaterThanOrEqual(cases.count, minCases, "below the file's own declared floor")
        } else {
            XCTFail("vectors declare no minCases floor")
        }
        XCTAssertGreaterThanOrEqual(cases.count, 40, "fewer than 40 cases — the synthetic sweep is missing")

        let outcomes = Set(cases.flatMap { ($0["expectOutcomes"] as? [String]) ?? [] })
        let reasons = Set(cases.flatMap { ($0["expectReasonCodes"] as? [String]) ?? [] })

        for expected in (doc.requires["outcomesPresent"] as? [String] ?? []) {
            XCTAssertTrue(outcomes.contains(expected), "no case expects outcome \(expected)")
        }
        for expected in (doc.requires["reasonCodesPresent"] as? [String] ?? []) {
            XCTAssertTrue(reasons.contains(expected), "no case expects reason code \(expected)")
        }
        // The ones that kill a trivial port, asserted directly (not only via the requires
        // lists, which a future edit could trim).
        XCTAssertTrue(outcomes.contains("allow"), "no case expects ALLOW — a restrict-everything port would pass")
        XCTAssertTrue(outcomes.contains("restrict"), "no case expects RESTRICT — an allow-everything port would pass")
        XCTAssertTrue(outcomes.contains("step_up"), "no case expects STEP_UP")
        XCTAssertGreaterThanOrEqual(reasons.count, 12, "fewer than 12 distinct reason codes are exercised")
    }

    // MARK: - The shared cases

    func testEveryVectorMatches() throws {
        let doc = try loadVectors()
        XCTAssertFalse(doc.cases.isEmpty, "no cases loaded")

        var compared = 0
        for (index, c) in doc.cases.enumerated() {
            let id = c["id"] as? String ?? "case[\(index)]"
            guard let rawSignals = c["signals"] as? [[String: Any]] else {
                XCTFail("\(id): `signals` missing or malformed")
                continue
            }
            let signals: [DecisionEngine.Signal] = rawSignals.map { raw in
                var attributes: [String: String] = [:]
                for (key, value) in (raw["attributes"] as? [String: Any] ?? [:]) {
                    // The emitter stringifies every attribute value; anything else is a
                    // malformed vector and must not silently vanish into a missing key.
                    if let s = value as? String {
                        attributes[key] = s
                    } else {
                        XCTFail("\(id): attribute `\(key)` is not a string in the vector")
                    }
                }
                return DecisionEngine.Signal(raw["type"] as? String ?? "",
                                             layer: raw["layer"] as? String,
                                             attributes: attributes)
            }
            let expectOutcomes = c["expectOutcomes"] as? [String]
            let expectReasonCodes = c["expectReasonCodes"] as? [String]
            XCTAssertNotNil(expectOutcomes, "\(id): expectOutcomes missing")
            XCTAssertNotNil(expectReasonCodes, "\(id): expectReasonCodes missing")

            let result = DecisionEngine.evaluate(signals)
            XCTAssertEqual(result.allOutcomes, expectOutcomes ?? [], "\(id): ordered outcome set differs from the TS engine")
            XCTAssertEqual(result.reasonCodes, expectReasonCodes ?? [], "\(id): reason codes differ from the TS engine")
            compared += 1
        }
        XCTAssertEqual(compared, doc.cases.count, "every case must have been compared — a skipped case is an unproven one")
    }
}
