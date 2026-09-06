import XCTest

// In Xcode these sources are compiled directly into the test bundle (see
// `EnterpriseShellTests` in ../project.yml), so there is no module to import. Under
// SwiftPM (../Package.swift) the same files are a library, and this brings it in.
#if canImport(EnterpriseShellPort)
@testable import EnterpriseShellPort
#endif

/// The Swift twin of the posture-allow wrapper, held to the SAME 52 cases as the
/// TypeScript side: `native/shared/posture-allow-vectors.json`. The file is read by
/// path (via `#filePath`), not bundled — so this test binds to the exact table the TS
/// proof binds to, the two ports cannot drift onto separate copies, and the literal
/// filename in this file is what `scripts/check-posture-allow-conformance.mjs` scans
/// `native/` for when it reports a native client as bound.
///
/// The gate's scan proves only that a Swift file NAMES the vectors. THIS test is the
/// substance: it runs every case through `PostureAllow.resolve` and asserts all five
/// pinned answers, and it holds the Swift `postureBearing` table to the one the
/// vector file carries.
final class PostureAllowTests: XCTestCase {

    // MARK: - Vector loading

    /// …/native/ios/EnterpriseShellTests/PostureAllowTests.swift → up three to
    /// …/native → shared/posture-allow-vectors.json. The string literal below is also
    /// the token the conformance gate greps for.
    private static let vectorsRelativePath = "shared/posture-allow-vectors.json"

    private struct VectorDoc {
        let cases: [[String: Any]]
        let requires: [String: Any]
        let postureBearing: [String: Any]
    }

    private func loadVectors(file: StaticString = #filePath) throws -> VectorDoc {
        let here = URL(fileURLWithPath: "\(file)")
        let nativeRoot = here.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let vectorsURL = nativeRoot.appendingPathComponent(Self.vectorsRelativePath)
        let data = try Data(contentsOf: vectorsURL)
        let root = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let cases = root?["cases"] as? [[String: Any]]
        let requires = root?["requires"] as? [String: Any]
        let bearing = root?["postureBearing"] as? [String: Any]
        // A wrong path reads nothing and would pass vacuously. Fail loudly instead.
        XCTAssertNotNil(cases, "could not read `cases` from \(vectorsURL.path)")
        XCTAssertNotNil(requires, "could not read `requires` from \(vectorsURL.path)")
        XCTAssertNotNil(bearing, "could not read `postureBearing` from \(vectorsURL.path)")
        return VectorDoc(cases: cases ?? [], requires: requires ?? [:], postureBearing: bearing ?? [:])
    }

    // MARK: - Non-vacuity floor (honored independently of the TS client)

    func testVectorFloorIsSatisfied() throws {
        let doc = try loadVectors()
        let cases = doc.cases

        if let minCases = doc.requires["minCases"] as? Int {
            XCTAssertGreaterThanOrEqual(cases.count, minCases, "below the file's own declared floor")
        } else {
            XCTFail("vectors declare no minCases floor")
        }
        XCTAssertGreaterThanOrEqual(cases.count, 40, "the shared table is expected to hold at least 40 cases")

        let outcomes = Set(cases.compactMap { $0["expectOutcome"] as? String })
        let states = Set(cases.compactMap { $0["expectState"] as? String })
        let reasons = Set(cases.compactMap { $0["expectReasonCode"] as? String })

        for expected in (doc.requires["outcomesPresent"] as? [String] ?? []) {
            XCTAssertTrue(outcomes.contains(expected), "no case exercises host outcome \(expected)")
        }
        for expected in (doc.requires["statesPresent"] as? [String] ?? []) {
            XCTAssertTrue(states.contains(expected), "no case exercises posture state \(expected)")
        }
        for expected in (doc.requires["reasonCodesPresent"] as? [String] ?? []) {
            XCTAssertTrue(reasons.contains(expected), "no case exercises reason code \(expected)")
        }
        // The two that kill the trivial clients, asserted directly.
        XCTAssertTrue(outcomes.contains("allow"), "no case expects ALLOW — a step_up-only client would pass")
        XCTAssertTrue(cases.contains { ($0["expectAllowWithheld"] as? Bool) == true },
                      "no case withholds an offered allow — a pass-through client would pass")
    }

    // MARK: - The attribute table is the SAME table on both sides

    func testPostureBearingTableMatchesVectors() throws {
        let doc = try loadVectors()
        XCTAssertEqual(Set(doc.postureBearing.keys), Set(PostureAllow.postureBearing.keys),
                       "the Swift table judges a different set of signal types than the vectors declare")
        for (type, spec) in PostureAllow.postureBearing {
            let raw = doc.postureBearing[type] as? [String: Any]
            let required = raw?["required"] as? [String: String] ?? [:]
            let optional = raw?["optional"] as? [String: String] ?? [:]
            XCTAssertEqual(Dictionary(uniqueKeysWithValues: spec.required.map { ($0.attribute, $0.affirmative) }),
                           required, "\(type): required attributes differ from the vectors")
            XCTAssertEqual(Dictionary(uniqueKeysWithValues: spec.optional.map { ($0.attribute, $0.affirmative) }),
                           optional, "\(type): optional attributes differ from the vectors")
        }
    }

    // MARK: - The shared cases

    func testEveryVectorMatches() throws {
        let doc = try loadVectors()
        XCTAssertFalse(doc.cases.isEmpty, "no cases loaded")

        for (index, c) in doc.cases.enumerated() {
            let id = c["id"] as? String ?? "case[\(index)]"
            let outcomes = c["engineOutcomes"] as? [String] ?? []
            let signals = Self.signals(from: c)
            let outcome = PostureAllow.resolve(outcomes: outcomes, signals: signals)

            if let expectEngine = c["expectEngineOutcome"] as? String {
                XCTAssertEqual(outcome.engineOutcome.rawValue, expectEngine, "\(id): engineOutcome")
            }
            if let expectState = c["expectState"] as? String {
                XCTAssertEqual(outcome.postureState.rawValue, expectState, "\(id): postureState")
            }
            if let expectOutcome = c["expectOutcome"] as? String {
                XCTAssertEqual(outcome.hostOutcome.rawValue, expectOutcome, "\(id): hostOutcome")
            }
            if let expectReason = c["expectReasonCode"] as? String {
                XCTAssertEqual(outcome.reasonCode.rawValue, expectReason, "\(id): reasonCode")
            }
            if let expectWithheld = c["expectAllowWithheld"] as? Bool {
                XCTAssertEqual(outcome.allowWithheld, expectWithheld, "\(id): allowWithheld")
            }
            // Never permissive movement, on every case.
            XCTAssertGreaterThanOrEqual(RemediationAllow.strictness(of: outcome.hostOutcome),
                                        RemediationAllow.strictness(of: outcome.engineOutcome),
                                        "\(id): moved in the permissive direction")
        }
    }

    /// Build the wrapper's signals from a raw vector case the way a boundary payload
    /// arrives: `attributes` that is not a JSON object becomes `nil`, and inside it a
    /// value that is not a string (a number, a JSON null bridged to NSNull) stays
    /// non-string so the illegible cases are reachable.
    private static func signals(from c: [String: Any]) -> [PostureAllow.Signal] {
        let raw = c["signals"] as? [[String: Any]] ?? []
        return raw.map { s in
            PostureAllow.Signal(type: s["type"] as? String ?? "", attributes: s["attributes"] as? [String: Any])
        }
    }

    // MARK: - Swift-side edges no shared vector exercises

    /// A signal whose attributes are not an object at all (a JSON string, an array)
    /// reads as illegible, never as affirmed.
    func testNonObjectAttributesAreIllegible() {
        let out = PostureAllow.resolve(
            outcomes: ["allow", "record_audit"],
            signals: [PostureAllow.Signal(type: "device.posture_observed", attributes: nil)]
        )
        XCTAssertEqual(out.postureState, .illegible)
        XCTAssertEqual(out.hostOutcome, .stepUp)
        XCTAssertTrue(out.allowWithheld)
    }

    /// A boolean attribute bridges to NSNumber in Foundation; it must not read as the
    /// string it is not.
    func testBooleanAttributeIsIllegible() {
        let out = PostureAllow.resolve(
            outcomes: ["allow", "record_audit"],
            signals: [PostureAllow.Signal(type: "device.posture_observed", attributes: ["compliance": true, "freshness": "fresh"])]
        )
        XCTAssertEqual(out.postureState, .illegible)
        XCTAssertEqual(out.reasonCode, .withheldIllegible)
    }

    /// Deficiencies are listed in signal order, then attribute order, and both
    /// kinds are reported when both occur.
    func testDeficienciesAreNamedAndOrdered() {
        let classified = PostureAllow.classify([
            PostureAllow.Signal(type: "identity.authenticated", attributes: ["risk": "low"]),
            PostureAllow.Signal(type: "device.posture_observed", attributes: ["compliance": "unknown"]),
        ])
        XCTAssertEqual(classified.state, .illegible)
        XCTAssertEqual(classified.deficiencies, [
            PostureAllow.Deficiency(signalType: "device.posture_observed", attribute: "compliance", kind: .unaffirmed),
            PostureAllow.Deficiency(signalType: "device.posture_observed", attribute: "freshness", kind: .illegible),
        ])
    }
}
