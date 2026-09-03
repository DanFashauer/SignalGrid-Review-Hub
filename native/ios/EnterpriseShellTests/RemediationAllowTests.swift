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

        // A JSON boolean bridges to NSNumber in Foundation (__NSCFBoolean), so a naive
        // `as? NSNumber` would turn `true` into 1.0 — where TS `Number.isFinite(true)`
        // is false. Exclude booleans so a non-number window decodes to nil -> illegible.
        let maxAge: Double?
        if let n = c["evidenceMaxAgeMs"] as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() {
            maxAge = n.doubleValue
        } else {
            maxAge = nil
        }
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

    /// Dirty boundary inputs an adversarial TS/Swift parity audit found the twin
    /// reading MORE permissively than the canonical wrapper — each outside the 40
    /// shared vectors. On every one TS resolves to illegible/step_up/withheld; these
    /// pin the Swift twin to the same so the fixes cannot silently regress. Exercised
    /// through the real JSON decoder (`input(from:)`), because the divergences lived at
    /// the boundary, not only in `classify`.
    func testDirtyBoundaryInputsAreIllegibleLikeTS() {
        let base: [String: Any] = [
            "engineOutcomes": ["verify_remediation", "allow", "record_audit"],
            "asOf": "2026-06-09T14:05:00.000Z",
            "evidenceMaxAgeMs": 3600000,
            "policyRequiresRemediation": true,
        ]
        func cleanRecord() -> [String: Any] {
            ["id": "rem-x", "status": "verified", "verifiedAt": "2026-06-09T13:55:00.000Z"]
        }
        var cases: [(String, [String: Any])] = []

        // 1. leading whitespace on verifiedAt — ISO8601DateFormatter tolerates, Date.parse rejects
        var c1 = base; var r1 = cleanRecord(); r1["verifiedAt"] = " 2026-06-09T13:55:00.000Z"; c1["record"] = r1
        cases.append(("whitespace-padded-verifiedAt", c1))
        // 2. leading whitespace on asOf
        var c2 = base; c2["asOf"] = " 2026-06-09T14:05:00.000Z"; c2["record"] = cleanRecord()
        cases.append(("whitespace-padded-asOf", c2))
        // 3. trailing NEL (U+0085) on status — Swift's default set trims it, JS trim does not
        var c3 = base; var r3 = cleanRecord(); r3["status"] = "verified\u{0085}"; c3["record"] = r3
        cases.append(("status-trailing-NEL", c3))
        // 4. a lone BOM (U+FEFF) id — Swift's default set does NOT trim it, JS trim does
        var c4 = base; var r4 = cleanRecord(); r4["id"] = "\u{FEFF}"; c4["record"] = r4
        cases.append(("id-lone-BOM", c4))
        // 5. a JSON boolean window — Foundation bridges it to NSNumber, TS reads it non-finite
        var c5 = base; var r5 = cleanRecord(); r5["verifiedAt"] = "2026-06-09T14:05:00.000Z"; c5["record"] = r5
        c5["evidenceMaxAgeMs"] = true
        cases.append(("boolean-window", c5))

        for (name, dict) in cases {
            let out = RemediationAllow.resolve(Self.input(from: dict))
            XCTAssertEqual(out.remediationState, .illegible, "\(name): state")
            XCTAssertEqual(out.hostOutcome, .stepUp, "\(name): hostOutcome must withhold to step_up")
            XCTAssertEqual(out.reasonCode, .stateIllegible, "\(name): reasonCode")
            XCTAssertTrue(out.allowWithheld, "\(name): the allow must be withheld")
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
