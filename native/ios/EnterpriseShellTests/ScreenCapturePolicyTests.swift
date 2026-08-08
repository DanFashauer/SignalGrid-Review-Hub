import XCTest

// In Xcode these sources are compiled directly into the test bundle (see
// `EnterpriseShellTests` in ../project.yml), so there is no module to import. Under
// SwiftPM (../Package.swift) the same files are a library, and this brings it in.
// `canImport` keeps one set of tests serving both, with no #if around the tests
// themselves — a divergence there is how two builds start proving different things.
#if canImport(EnterpriseShellPort)
@testable import EnterpriseShellPort
#endif

/// Locks the screen-capture protection policy. Fail-safe: redaction/violation only
/// when a session is active AND the persona forbids capture.
final class ScreenCapturePolicyTests: XCTestCase {

    func testRedactOnlyWhenActiveForbiddenAndCaptured() {
        XCTAssertTrue(ScreenCapturePolicy.shouldRedact(
            sessionActive: true, allowScreenCapture: false, isCaptured: true))
    }

    func testNoRedactWhenCaptureAllowed() {
        XCTAssertFalse(ScreenCapturePolicy.shouldRedact(
            sessionActive: true, allowScreenCapture: true, isCaptured: true))
    }

    func testNoRedactWhenNotCaptured() {
        XCTAssertFalse(ScreenCapturePolicy.shouldRedact(
            sessionActive: true, allowScreenCapture: false, isCaptured: false))
    }

    func testNoRedactWhenNoActiveSession() {
        // No active session (e.g. locked idle) → nothing to protect yet.
        XCTAssertFalse(ScreenCapturePolicy.shouldRedact(
            sessionActive: false, allowScreenCapture: false, isCaptured: true))
    }

    func testScreenshotViolationOnlyWhenActiveAndForbidden() {
        XCTAssertTrue(ScreenCapturePolicy.isScreenshotViolation(
            sessionActive: true, allowScreenCapture: false))
        XCTAssertFalse(ScreenCapturePolicy.isScreenshotViolation(
            sessionActive: true, allowScreenCapture: true))
        XCTAssertFalse(ScreenCapturePolicy.isScreenshotViolation(
            sessionActive: false, allowScreenCapture: false))
    }
}
