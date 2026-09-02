import XCTest
#if canImport(EnterpriseShellPort)
@testable import EnterpriseShellPort
#endif

/// Locks the fail-closed contract of `SessionData.isExpired` / `ExpiryPolicy`.
///
/// `isExpired` drives `stale`, a live posture input to the Assist gate — golden
/// rule 2: an unknown or degraded signal must TIGHTEN the answer, never loosen it.
/// `ExpiryPolicy` removes the in-code "unknown expiry" case; the justification is
/// what makes `.nonExpiring` a deliberate state. These tests pin that a blank
/// justification reads as EXPIRED and would go red if a future edit re-opened
/// the fail-open (row 58). The decode cases exercise the `Codable` round trip
/// `KeychainService.getSession` would perform; that read path has no caller
/// today, and a malformed blob throws on decode rather than yielding a blank
/// justification, so these pin a value invariant, not a persistence defence.
///
/// Without this file `SessionData.isExpired` had no test at all: a wrong-logic
/// edit inside either case would compile and pass every existing gate.
final class SessionExpiryTests: XCTestCase {

    // MARK: fixtures

    private func makePersona() -> Persona {
        Persona(
            roleId: "role-1",
            roleName: "Test Role",
            permissions: [],
            workspaceConfig: WorkspaceConfig(
                layout: .single,
                visibleModules: [],
                dashboardWidgets: [],
                theme: ThemeConfig(primaryColor: "#000000", accentColor: "#FFFFFF", logoUrl: nil)),
            appLaunchConfig: AppLaunchConfig(
                requiredApps: [], optionalApps: [], autoLaunchApps: [], defaultApp: ""),
            restrictions: SessionRestrictions(
                maxSessionDuration: nil,
                idleTimeout: 60,
                allowCopyPaste: true,
                allowScreenCapture: false,
                allowPrint: false,
                allowAirDrop: false,
                allowedDomains: nil,
                blockedFeatures: []))
    }

    private func session(_ expiry: ExpiryPolicy) -> SessionData {
        SessionData(userId: "u", badgeId: "b", persona: makePersona(), expiry: expiry)
    }

    // MARK: concrete-expiry cases

    func testExpiresAtInThePastIsExpired() {
        XCTAssertTrue(session(.expiresAt(Date().addingTimeInterval(-1))).isExpired)
    }

    func testExpiresAtInTheFutureIsNotExpired() {
        XCTAssertFalse(session(.expiresAt(Date().addingTimeInterval(3600))).isExpired)
    }

    // MARK: non-expiring cases — the fail-closed contract

    func testNonExpiringWithJustificationIsNotExpired() {
        XCTAssertFalse(
            session(.nonExpiring(justification: "MDM session: lifetime governed by enrolment")).isExpired)
    }

    /// A blank or whitespace-only justification is never produced deliberately (the
    /// sole in-code producer states a full reason); it is the shape of a malformed
    /// or tampered decoded blob, and must read as EXPIRED.
    func testNonExpiringWithBlankJustificationIsExpired() {
        XCTAssertTrue(session(.nonExpiring(justification: "")).isExpired)
        XCTAssertTrue(session(.nonExpiring(justification: "   \n\t  ")).isExpired)
    }

    // MARK: the Codable round trip (the shape KeychainService.getSession would perform)

    /// A round-tripped blank-justification session must still fail closed after decode.
    func testDecodedBlankJustificationSessionIsExpired() throws {
        let data = try JSONEncoder().encode(session(.nonExpiring(justification: "")))
        let restored = try JSONDecoder().decode(SessionData.self, from: data)
        XCTAssertTrue(restored.isExpired,
                      "a decoded blank-justification session must read as expired (fail closed)")
    }

    /// A legitimate MDM session survives the same round trip as not-expired.
    func testDecodedJustifiedNonExpiringSessionIsNotExpired() throws {
        let data = try JSONEncoder().encode(session(.nonExpiring(justification: "MDM session")))
        let restored = try JSONDecoder().decode(SessionData.self, from: data)
        XCTAssertFalse(restored.isExpired)
    }
}
