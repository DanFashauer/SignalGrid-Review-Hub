import XCTest

// In Xcode these sources are compiled directly into the test bundle (see
// `EnterpriseShellTests` in ../project.yml), so there is no module to import. Under
// SwiftPM (../Package.swift) the same files are a library, and this brings it in.
// `canImport` keeps one set of tests serving both.
#if canImport(EnterpriseShellPort)
@testable import EnterpriseShellPort
#endif

/// The Swift twin of the remediation-allow wrapper, held to the SAME 40 cases as the
/// TypeScript side: `native/shared/remediation-allow-vectors.json`. The file is read
/// by path (via `#filePath`), not bundled — so this test binds to the exact table the
/// TS proof binds to, the two ports cannot drift onto separate copies, and the literal
/// filename in this file is what `scripts/check-remediation-allow-conformance.mjs`
/// scans `native/` for when it reports a native client as bound.
///
/// The gate's scan proves only that a Swift file NAMES the vectors. THIS test is the
/// substance: it runs every case through `RemediationAllow.resolve` and asserts all
/// five pinned answers, and it is falsifiable — mutate the wrapper and named cases go
/// red (exercised in the lane's delivery, both directions).
final class RemediationAllowTests: XCTestCase {

    // MARK: - Vector loading

    /// Repo path of the shared vectors, derived from this source file's own location:
    /// …/native/ios/EnterpriseShellTests/RemediationAllowTests.swift → up three to
    /// …/native → shared/remediation-allow-vectors.json. The string literal below is
    /// also the token the conformance gate greps for.
    private static let vectorsRelativePath = "shared/remediation-allow-vectors.json"

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

    // MARK: - Non-vacuity floor (honored independently of the TS client)

    /// The vector file ships a floor precisely so each client checks it rather than
    /// trusting the other. A client that answered `step_up` to everything would pass
    /// every withholding case; this asserts the table still forces a real spread.
    func testVectorFloorIsSatisfied() throws {
        let doc = try loadVectors()
        let cases = doc.cases

        if let minCases = doc.requires["minCases"] as? Int {
            XCTAssertGreaterThanOrEqual(cases.count, minCases, "below the file's own declared floor")
        } else {
            XCTFail("vectors declare no minCases floor")
        }
        XCTAssertEqual(cases.count, 40, "the shared table is expected to hold 40 cases")

        let outcomes = Set(cases.compactMap { $0["expectOutcome"] as? String })
        let states = Set(cases.compactMap { $0["expectState"] as? String })
        let reasons = Set(cases.compactMap { $0["expectReasonCode"] as? String })

        for expected in (doc.requires["outcomesPresent"] as? [String] ?? []) {
            XCTAssertTrue(outcomes.contains(expected), "no case exercises host outcome \(expected)")
        }
        for expected in (doc.requires["statesPresent"] as? [String] ?? []) {
            XCTAssertTrue(states.contains(expected), "no case exercises remediation state \(expected)")
        }
        for expected in (doc.requires["reasonCodesPresent"] as? [String] ?? []) {
            XCTAssertTrue(reasons.contains(expected), "no case exercises reason code \(expected)")
        }
        // The one that kills the trivial client, asserted directly (not only via the
        // requires list, which a future edit could trim).
        XCTAssertTrue(outcomes.contains("allow"), "no case expects ALLOW — a step_up-only client would pass")
        XCTAssertTrue(outcomes.contains { $0 != "allow" }, "every case expects ALLOW — withholding is unproven")
    }

    // MARK: - The 40 shared cases

    func testEveryVectorMatches() throws {
        let doc = try loadVectors()
        XCTAssertFalse(doc.cases.isEmpty, "no cases loaded")

        for (index, c) in doc.cases.enumerated() {
            let id = c["id"] as? String ?? "case[\(index)]"
            let input = Self.input(from: c)
            let outcome = RemediationAllow.resolve(input)

            if let expectEngine = c["expectEngineOutcome"] as? String {
                XCTAssertEqual(outcome.engineOutcome.rawValue, expectEngine, "\(id): engineOutcome")
            }
            if let expectState = c["expectState"] as? String {
                XCTAssertEqual(outcome.remediationState.rawValue, expectState, "\(id): remediationState")
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
        }
    }

    /// Build a wrapper `Input` from a raw vector case, decoding the record the way a
    /// boundary payload arrives: a field that is not a JSON string becomes `nil`
    /// (`status: 42`, an absent `id`, a `null` verifiedAt), and a `null`/absent window
    /// becomes `nil`. This is what makes the illegible cases reachable.
    private static func input(from c: [String: Any]) -> RemediationAllow.Input {
        let outcomes = c["engineOutcomes"] as? [String] ?? []

        var record: RemediationAllow.Record?
        if let raw = c["record"] as? [String: Any] {
            record = RemediationAllow.Record(
                id: raw["id"] as? String,
                status: raw["status"] as? String,
                verifiedAt: raw["verifiedAt"] as? String
            )
        } else {
            record = nil // JSON null / absent → absent record
        }

        let maxAge: Double? = (c["evidenceMaxAgeMs"] as? NSNumber)?.doubleValue
        let policy = (c["policyRequiresRemediation"] as? Bool)

        return RemediationAllow.Input(
            outcomes: outcomes,
            record: record,
            asOf: c["asOf"] as? String ?? "",
            evidenceMaxAgeMs: maxAge,
            policyRequiresRemediation: policy
        )
    }

    // MARK: - Window edges no shared vector exercises (Swift-side only)

    /// A negative evidence window is unreadable, so freshness is unanswerable → illegible.
    /// No shared vector carries a negative window (the only non-happy value there is
    /// `null`), so this is asserted here rather than added to cloud's generated file.
    func testNegativeWindowIsIllegible() {
        let state = RemediationAllow.classify(
            RemediationAllow.Record(id: "x", status: "verified", verifiedAt: "2026-06-09T13:55:00.000Z"),
            asOf: "2026-06-09T14:05:00.000Z",
            evidenceMaxAgeMs: -1
        )
        XCTAssertEqual(state, .illegible)
    }

    /// A non-finite window (NaN / infinity) — reachable from a Swift caller, never from
    /// JSON — is likewise illegible.
    func testNonFiniteWindowIsIllegible() {
        for window in [Double.nan, Double.infinity, -Double.infinity] {
            let state = RemediationAllow.classify(
                RemediationAllow.Record(id: "x", status: "verified", verifiedAt: "2026-06-09T13:55:00.000Z"),
                asOf: "2026-06-09T14:05:00.000Z",
                evidenceMaxAgeMs: window
            )
            XCTAssertEqual(state, .illegible, "window \(window) should be illegible")
        }
    }

    /// A zero window is READABLE (finite, non-negative): any evidence older than the
    /// reference instant exceeds it and is stale, while evidence exactly at the instant
    /// still counts as verified. This pins that zero is not treated as illegible.
    func testZeroWindowIsStaleForAnyAge() {
        let stale = RemediationAllow.classify(
            RemediationAllow.Record(id: "x", status: "verified", verifiedAt: "2026-06-09T13:55:00.000Z"),
            asOf: "2026-06-09T14:05:00.000Z",
            evidenceMaxAgeMs: 0
        )
        XCTAssertEqual(stale, .stale, "older-than-instant evidence in a zero window is stale")

        let atInstant = RemediationAllow.classify(
            RemediationAllow.Record(id: "x", status: "verified", verifiedAt: "2026-06-09T14:05:00.000Z"),
            asOf: "2026-06-09T14:05:00.000Z",
            evidenceMaxAgeMs: 0
        )
        XCTAssertEqual(atInstant, .verified, "evidence exactly at the instant is fresh in a zero window")
    }
}
