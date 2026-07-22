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

    /// When enabled (`-DemoIdleLock`), the persona uses a short idle timeout so the
    /// inactivity auto-lock can be demonstrated in seconds instead of minutes.
    static var idleLock: Bool {
        UserDefaults.standard.bool(forKey: "DemoIdleLock")
            || ProcessInfo.processInfo.arguments.contains("-DemoIdleLock")
    }

    /// When enabled (`-DemoOpenApp`), the first workspace app auto-opens in the in-app
    /// managed browser to demonstrate that app access stays native/contained.
    static var openApp: Bool {
        UserDefaults.standard.bool(forKey: "DemoOpenApp")
            || ProcessInfo.processInfo.arguments.contains("-DemoOpenApp")
    }

    /// When enabled (`-DemoAssist`), the embedded Assist host-app demo auto-opens so
    /// the invisible-gate flow (allow → step-up → confirm → applied) can be shown.
    static var assist: Bool {
        UserDefaults.standard.bool(forKey: "DemoAssist")
            || ProcessInfo.processInfo.arguments.contains("-DemoAssist")
    }

    /// When enabled (`-DemoAssistAuto`), the embedded host-app demo self-walks the
    /// full gate flow (auto reads → held step-up → confirm → applied) so each state
    /// can be captured without manual taps.
    static var assistAuto: Bool {
        UserDefaults.standard.bool(forKey: "DemoAssistAuto")
            || ProcessInfo.processInfo.arguments.contains("-DemoAssistAuto")
    }

    /// When enabled (`-DemoAssistDecline`), the auto-walk declines the confirmation
    /// so the fail-closed "nothing fires" state can be captured.
    static var assistDecline: Bool {
        UserDefaults.standard.bool(forKey: "DemoAssistDecline")
            || ProcessInfo.processInfo.arguments.contains("-DemoAssistDecline")
    }

    /// Optional control-plane base URL (`-DemoBackendURL https://host`). When set with
    /// a token, the app resolves a RemoteDecisionService; otherwise it stays on-device.
    static var backendURL: URL? {
        guard let s = UserDefaults.standard.string(forKey: "DemoBackendURL"), let u = URL(string: s) else { return nil }
        return u
    }

    /// Bearer token for the control plane (`-DemoBackendToken <tok>`).
    static var backendToken: String? {
        UserDefaults.standard.string(forKey: "DemoBackendToken")
    }

    /// Building/area the device is deployed in (`-DemoLocation warehouse|clinic|office`).
    /// Drives which role + app workspace the user is provisioned with — mirroring how the
    /// SignalGrid control plane configures a persona by workflow and location.
    static var location: String {
        (UserDefaults.standard.string(forKey: "DemoLocation") ?? "office").lowercased()
    }

    static func persona() -> Persona {
        let p = locationProfile(location)
        return Persona(
            roleId: p.roleId,
            roleName: p.roleName,
            permissions: ["session.start", "session.end", "dashboard.view", "apps.launch"],
            workspaceConfig: WorkspaceConfig(
                layout: .grid,
                visibleModules: ["dashboard", "apps", "tasks"],
                dashboardWidgets: [
                    DashboardWidget(id: "w-status", type: "status", title: "Session Status", position: 0, config: [:]),
                    DashboardWidget(id: "w-location", type: "location", title: p.area, position: 1, config: [:])
                ],
                theme: ThemeConfig(primaryColor: p.color, accentColor: "#5E8F73", logoUrl: nil)
            ),
            appLaunchConfig: AppLaunchConfig(
                requiredApps: p.required,
                optionalApps: p.optional,
                autoLaunchApps: [], // don't auto-open; show the configured home page
                defaultApp: p.required.first?.appId ?? "none"
            ),
            restrictions: SessionRestrictions(
                maxSessionDuration: 3600,
                idleTimeout: idleLock ? 8 : 300,
                allowCopyPaste: true,
                allowScreenCapture: false,
                allowPrint: false,
                allowAirDrop: false,
                allowedDomains: nil,
                blockedFeatures: []
            )
        )
    }

    private static func app(_ id: String, _ name: String, _ url: String) -> EnterpriseApp {
        EnterpriseApp(appId: id, bundleId: "com.enterprise.\(id)", displayName: name, launchUrl: url, isDeepLink: false)
    }

    private struct LocationProfile {
        let roleId: String, roleName: String, area: String, color: String
        let required: [EnterpriseApp], optional: [EnterpriseApp]
    }

    /// Role + app workspace per deployment location. In production these come from the
    /// control plane's persona/app-catalog config keyed by workflow + building/area.
    private static func locationProfile(_ location: String) -> LocationProfile {
        switch location {
        case "warehouse":
            return LocationProfile(
                roleId: "warehouse-operator", roleName: "Warehouse Operator",
                area: "Dock 4 · Building B", color: "#4F8C87",
                required: [app("scanner", "Scanner", "https://example.com/scanner"),
                           app("picklist", "Pick List", "https://example.com/picklist"),
                           app("inventory", "Inventory", "https://example.com/inventory")],
                optional: [app("directory", "Directory", "https://example.com/directory"),
                           app("safety", "Safety", "https://example.com/safety")])
        case "clinic", "hospital":
            return LocationProfile(
                roleId: "clinical-operator", roleName: "Clinical Operator",
                area: "Ward 3 · North Wing", color: "#4F8C87",
                required: [app("ehr", "Patient Chart", "https://example.com/ehr"),
                           app("rounds", "Rounds", "https://example.com/rounds"),
                           app("meds", "Med Admin", "https://example.com/meds")],
                optional: [app("directory", "Directory", "https://example.com/directory"),
                           app("protocols", "Protocols", "https://example.com/protocols")])
        default: // office
            return LocationProfile(
                roleId: "shift-operator", roleName: "Shift Operator",
                area: "Floor 2 · HQ", color: "#4F8C87",
                required: [app("timeclock", "Time Clock", "https://example.com/timeclock"),
                           app("tasks", "Task Board", "https://example.com/tasks"),
                           app("email", "Email", "https://example.com/email")],
                optional: [app("directory", "Directory", "https://example.com/directory"),
                           app("kb", "Knowledge Base", "https://example.com/kb")])
        }
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
