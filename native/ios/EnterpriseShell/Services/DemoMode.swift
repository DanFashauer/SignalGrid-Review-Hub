#if targetEnvironment(simulator)
import Foundation

/// Simulator-only demo mode. Lets the full session lifecycle
/// (LockedIdle -> Authenticating -> Provisioning -> ActiveSession) run without a
/// real backend or identity provider. Enable by launching with `-DemoMode YES`,
/// typically alongside `-SimulateBadge <id>`:
///
///   xcrun simctl launch <udid> com.enterprise.shell -SimulateBadge 04A3F291 -DemoMode YES
///
/// This is compiled out of device builds entirely.
enum DemoMode {
    static var isEnabled: Bool {
        let on = UserDefaults.standard.bool(forKey: "DemoMode")
            || ProcessInfo.processInfo.arguments.contains("-DemoMode")
        return on
    }

    /// A canned successful session-start response with a complete demo persona.
    static func startSessionResponse(badgeId: String) -> StartSessionResponse {
        StartSessionResponse(
            success: true,
            sessionToken: "demo-session-\(badgeId)",
            user: UserInfo(
                userId: "demo-user-001",
                employeeId: "E-\(badgeId.prefix(6))",
                displayName: "Demo Operator",
                email: "demo.operator@enterprise.example.com",
                department: "Operations",
                title: "Shift Operator"
            ),
            persona: persona(),
            error: nil
        )
    }

    /// Canned successful session-end response (teardown demo).
    static func endSessionResponse() -> EndSessionResponse {
        EndSessionResponse(success: true, error: nil)
    }

    /// When enabled (`-DemoUnenrolled`), the scanned badge is treated as not
    /// enrolled so the enrollment flow can be demonstrated.
    static var unenrolled: Bool {
        UserDefaults.standard.bool(forKey: "DemoUnenrolled")
            || ProcessInfo.processInfo.arguments.contains("-DemoUnenrolled")
    }

    /// Session-start response indicating the badge is not enrolled.
    static func unenrolledStartResponse() -> StartSessionResponse {
        StartSessionResponse(
            success: false, sessionToken: nil, user: nil, persona: nil,
            error: APIError(code: "BADGE_NOT_ENROLLED", message: "Badge is not enrolled", details: nil)
        )
    }

    /// Enrollment-check response: badge needs provisioning by an administrator.
    static func enrollmentCheckResponse() -> BadgeEnrollmentResponse {
        BadgeEnrollmentResponse(
            isEnrolled: false, needsProvisioning: true, persona: nil, sessionToken: nil, user: nil,
            error: nil,
            enrollmentInstructions: "Ask your administrator to enroll this badge in the SignalGrid console."
        )
    }

    /// When enabled (`-DemoAutoEnd`), ActiveSession auto-ends after a short delay
    /// so the terminate -> teardown -> lockedIdle flow can be demonstrated.
    static var autoEnd: Bool {
        UserDefaults.standard.bool(forKey: "DemoAutoEnd")
            || ProcessInfo.processInfo.arguments.contains("-DemoAutoEnd")
    }

    static func persona() -> Persona {
        Persona(
            roleId: "demo-operator",
            roleName: "Shift Operator",
            permissions: ["session.start", "session.end", "dashboard.view"],
            workspaceConfig: WorkspaceConfig(
                layout: .grid,
                visibleModules: ["dashboard", "tasks"],
                dashboardWidgets: [
                    DashboardWidget(id: "w-status", type: "status", title: "Session Status", position: 0, config: [:]),
                    DashboardWidget(id: "w-tasks", type: "tasks", title: "My Tasks", position: 1, config: [:])
                ],
                theme: ThemeConfig(primaryColor: "#0A84FF", accentColor: "#30D158", logoUrl: nil)
            ),
            appLaunchConfig: AppLaunchConfig(
                requiredApps: [], optionalApps: [], autoLaunchApps: [], defaultApp: "none"
            ),
            restrictions: SessionRestrictions(
                maxSessionDuration: 3600,
                idleTimeout: 300,
                allowCopyPaste: true,
                allowScreenCapture: false,
                allowPrint: false,
                allowAirDrop: false,
                allowedDomains: nil,
                blockedFeatures: []
            )
        )
    }
}

/// Simulator-only identity provider that always authenticates successfully,
/// echoing back the persona supplied by the (demo) backend.
final class DemoIdentityProvider: IdentityProvider {
    var providerId: String { "demo" }
    var displayName: String { "Demo Identity Provider" }
    var providerType: IdentityProviderType { .mdm }
    var isAuthenticated: Bool { true }
    var currentAccessToken: String? { "demo-access-token" }

    func configure(with config: IdentityProviderConfig) {}

    func authenticate(credentials: AuthenticationCredentials, persona: Persona) async throws -> AuthenticationResult {
        AuthenticationResult(
            accessToken: "demo-access-token",
            refreshToken: "demo-refresh-token",
            idToken: nil,
            expiresAt: Date().addingTimeInterval(3600),
            userInfo: nil,
            persona: persona,
            providerSpecificData: nil
        )
    }

    func refreshToken() async throws {}
    func revokeAuthentication(token: String) async throws {}
    func getAccessToken() -> String? { "demo-access-token" }
}
#endif
