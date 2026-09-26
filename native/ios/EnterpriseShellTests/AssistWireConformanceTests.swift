import XCTest

// In Xcode these sources are compiled directly into the test bundle (see
// `EnterpriseShellTests` in ../project.yml), so there is no module to import. Under
// SwiftPM (../Package.swift) the same files are a library, and this brings it in.
// `canImport` keeps one set of tests serving both.
#if canImport(EnterpriseShellPort)
@testable import EnterpriseShellPort
#endif

/// The shared Assist-wire conformance vectors, run against this client.
///
/// There are now four independent implementations of the same fail-closed rule —
/// TypeScript in `lib/`, Kotlin in `native/android/core`, Rust in `native/desktop/core`,
/// and `AssistWire.swift` here. Each has (or will have) its own hand-written tests, and
/// that is exactly the arrangement in which they diverge silently: every suite stays
/// green while one client starts treating `{"assist":true}` as something other than a
/// denial, because nobody wrote that case in that language.
///
/// `native/shared/assist-wire-conformance.json` is one set of cases every client must
/// agree on, read here by path (via `#filePath`) exactly as the Kotlin test reads it two
/// levels up from its project dir. THE NON-VACUITY FLOOR: a suite made only of denials
/// is satisfied by a client that returns DENY unconditionally, so this asserts the file
/// contains every outcome including a proceedable one, and asserts afterwards that a
/// proceedable case actually proceeded. `scripts/check-assist-conformance.mjs` binds this
/// client by finding the vectors' filename in this file; ios-ci.yml's `swift test` and
/// xcodebuild lanes are what execute it.
final class AssistWireConformanceTests: XCTestCase {

    /// …/native/ios/EnterpriseShellTests/AssistWireConformanceTests.swift → up three to
    /// …/native → shared/assist-wire-conformance.json.
    private static let vectorsRelativePath = "shared/assist-wire-conformance.json"

    private func load(file: StaticString = #filePath) throws -> [String: Any] {
        let here = URL(fileURLWithPath: "\(file)")
        let nativeRoot = here.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let vectorsURL = nativeRoot.appendingPathComponent(Self.vectorsRelativePath)
        // Not a skip. A missing vector file means this client ran against nothing, and
        // "no cases ran" must never be mistaken for "all cases passed".
        let data = try Data(contentsOf: vectorsURL)
        let root = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        return try XCTUnwrap(root, "shared conformance vectors at \(vectorsURL.path) are not a JSON object")
    }

    private func expectedAssist(_ name: String) throws -> Assist {
        return try XCTUnwrap(Assist(rawValue: name), "vector file names an outcome this client does not have: \(name)")
    }

    func testTheVectorFileIsNotVacuous() throws {
        let doc = try load()
        let cases = try XCTUnwrap(doc["cases"] as? [[String: Any]], "no `cases`")
        let requires = try XCTUnwrap(doc["requires"] as? [String: Any], "no `requires`")

        let min = try XCTUnwrap(requires["minCases"] as? Int, "no minCases floor")
        XCTAssertGreaterThanOrEqual(cases.count, min,
            "the vector file has \(cases.count) cases but declares a floor of \(min); a suite that shrinks below its own floor is a suite that stopped proving things")

        let present = cases.compactMap { $0["expect"] as? String }
        for outcome in (requires["outcomesPresent"] as? [String] ?? []) {
            XCTAssertTrue(present.contains(outcome),
                "no case expects \"\(outcome)\". Without one, a client that answers the same way to everything would pass this file.")
        }
        // The one that actually kills the trivial client.
        XCTAssertTrue(present.contains("allow"), "no case is expected to ALLOW, so a client hardcoded to DENY would pass")

        let ids = cases.compactMap { $0["id"] as? String }
        XCTAssertEqual(ids.count, Set(ids).count, "duplicate case ids in the vector file")
    }

    func testEverySharedCaseAgreesWithThisClient() throws {
        let doc = try load()
        let cases = try XCTUnwrap(doc["cases"] as? [[String: Any]], "no `cases`")
        var failures: [String] = []
        var allowed = 0

        for c in cases {
            let id = c["id"] as? String ?? "(no id)"
            let why = c["why"] as? String ?? ""
            guard let status = c["status"] as? Int else { failures.append("  \(id): status is not a number"); continue }
            // `body` is a JSON string or JSON null; the latter means "no body was read".
            let body = c["body"] as? String
            let expect = try expectedAssist(try XCTUnwrap(c["expect"] as? String, "\(id): no expect"))

            let decision = AssistWire.parse(status: status, body: body)
            if decision.assist != expect {
                failures.append("  \(id): expected \(expect), got \(decision.assist) — \(why)")
                continue
            }

            // Assert the CONSEQUENCE, not just the label. COLLECTED, NOT ASSERTED IN
            // PLACE, so one disagreement never hides the ones after it.
            let proceeds = decision.assist.proceedsWithoutFurtherAction
            if expect == .allow {
                allowed += 1
                if !proceeds { failures.append("  \(id): an allow must proceed without further action") }
            } else if proceeds {
                failures.append("  \(id): \(expect) must NOT proceed without further action")
            }
            if expect == .step_up, !decision.assist.requiresChallenge {
                failures.append("  \(id): a step_up must require a challenge")
            }

            // The obligations a client must have PARSED — the served shape declares
            // none, and "empty" is the assertion, not merely "still a step_up".
            if let want = c["expectObligations"] as? [String], decision.obligations != want {
                failures.append("  \(id): obligations parsed as \(decision.obligations), expected \(want)")
            }
            for fragment in (c["expectExplanationContains"] as? [String] ?? []) where !decision.explanation().contains(fragment) {
                failures.append("  \(id): explanation \"\(decision.explanation())\" does not mention \"\(fragment)\"")
            }
        }

        XCTAssertTrue(failures.isEmpty,
            "\(failures.count) shared conformance case(s) disagree with this client:\n" + failures.joined(separator: "\n"))
        XCTAssertGreaterThan(allowed, 0, "no case reached ALLOW — this run proved only that things fail")
    }
}
