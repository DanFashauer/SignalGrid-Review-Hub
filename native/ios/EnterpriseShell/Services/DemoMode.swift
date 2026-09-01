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
    /// Read a launch flag honoring an EXPLICIT boolean value (review finding): the
    /// conventional pair `-DemoMode NO` registers `false` in UserDefaults, but a bare
    /// `arguments.contains("-DemoMode")` check still read it as enabled — invalidating
    /// simulator runs that deliberately exercise the non-demo path. When the key has a
    /// registered value, that value wins; a bare `-Key` (no value) remains an opt-in.
    private static func flag(_ key: String) -> Bool {
        if UserDefaults.standard.object(forKey: key) != nil {
            return UserDefaults.standard.bool(forKey: key)
        }
        return ProcessInfo.processInfo.arguments.contains("-\(key)")
    }

    static var isEnabled: Bool { flag("DemoMode") }

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
        flag("DemoUnenrolled")
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
        flag("DemoAutoEnd")
    }

    /// When enabled (`-DemoIdleLock`), the persona uses a short idle timeout so the
    /// inactivity auto-lock can be demonstrated in seconds instead of minutes.
    static var idleLock: Bool {
        flag("DemoIdleLock")
    }

    /// When enabled (`-DemoOpenApp`), the first workspace app auto-opens in the in-app
    /// managed browser to demonstrate that app access stays native/contained.
    static var openApp: Bool {
        flag("DemoOpenApp")
    }

    /// When enabled (`-DemoAssist`), the embedded Assist host-app demo auto-opens so
    /// the invisible-gate flow (allow → step-up → confirm → applied) can be shown.
    static var assist: Bool {
        flag("DemoAssist")
    }

    /// When enabled (`-DemoAssistAuto`), the embedded host-app demo self-walks the
    /// full gate flow (auto reads → held step-up → confirm → applied) so each state
    /// can be captured without manual taps.
    static var assistAuto: Bool {
        flag("DemoAssistAuto")
    }

    /// When enabled (`-DemoAssistDecline`), the auto-walk declines the confirmation
    /// so the fail-closed "nothing fires" state can be captured.
    static var assistDecline: Bool {
        flag("DemoAssistDecline")
    }

    /// Optional control-plane base URL (`-DemoBackendURL http://localhost:8080`). When
    /// set with a token, the app resolves a RemoteDecisionService; otherwise it stays
    /// on-device. LOOPBACK-ONLY (review finding): a simulator can reach live or
    /// production hosts, so an arbitrary URL here would turn the public demo into an
    /// authenticated live client — which the Review Hub must never be. The documented
    /// use (a locally running api-server) is loopback, and that is all this accepts;
    /// any other host resolves nil and the app stays on-device (fail closed).
    static var backendURL: URL? {
        guard let s = UserDefaults.standard.string(forKey: "DemoBackendURL"), let u = URL(string: s) else { return nil }
        let host = (u.host ?? "").lowercased()
        let loopback = host == "localhost" || host == "127.0.0.1" || host == "::1"
        return loopback ? u : nil
    }

    /// Bearer token for the control plane (`-DemoBackendToken <tok>`).
    static var backendToken: String? {
        UserDefaults.standard.string(forKey: "DemoBackendToken")
    }

    /// Optional identity/device refs to send to a control-plane backend, so a demo
    /// can use TENANT-SEEDED refs (`-DemoBackendIdentity nurse.compliant`
    /// `-DemoBackendDevice ipad-ward-01`) and get a real control-plane verdict rather
    /// than a fail-closed fallback (the demo session's own refs aren't seeded).
    static var backendIdentity: String? { UserDefaults.standard.string(forKey: "DemoBackendIdentity") }
    static var backendDevice: String? { UserDefaults.standard.string(forKey: "DemoBackendDevice") }

    /// Building/area the device is deployed in (`-DemoLocation warehouse|clinic|office`).
    /// Drives which role + app workspace the user is provisioned with — mirroring how the
    /// SignalGrid control plane configures a persona by workflow and location.
    static var location: String {
        (UserDefaults.standard.string(forKey: "DemoLocation") ?? "office").lowercased()
    }

    /// The zone the device is actually sensed in (`-DemoZone warehouse`). iOS can't
    /// sense position here, so this is injected; `nil` ⇒ matches `location` (no
    /// mismatch). Use e.g. `-DemoLocation clinic -DemoZone warehouse` to force a
    /// zone mismatch → deny.
    static var zone: String? {
        guard let z = UserDefaults.standard.string(forKey: "DemoZone"), !z.isEmpty else { return nil }
        return z.lowercased()
    }

    /// Comma-separated conditions to inject that iOS can't natively detect
    /// (`-DemoSignal stale,non_compliant,security_risk,remediated`). Drives the
    /// live signal context so allow → step_up → restrict can be demonstrated.
    static var injectedSignals: Set<String> {
        guard let raw = UserDefaults.standard.string(forKey: "DemoSignal") else { return [] }
        return Set(raw.lowercased()
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty })
    }

    /// Seconds after the host app opens to simulate screen recording starting
    /// (`-DemoScreenCaptureAfter 4`). `UIScreen.isCaptured` can't be toggled from
    /// simctl, so this drives the live re-evaluation path for demos. `nil` ⇒ off.
    static var screenCaptureAfter: TimeInterval? {
        let v = UserDefaults.standard.double(forKey: "DemoScreenCaptureAfter")
        return v > 0 ? v : nil
    }

    /// Seconds after the host app opens to simulate the session going stale
    /// (`-DemoStaleAfter 4`) — freshness is time-based, so this drives the live
    /// re-evaluation path deterministically. `nil` ⇒ off.
    static var staleAfter: TimeInterval? {
        let v = UserDefaults.standard.double(forKey: "DemoStaleAfter")
        return v > 0 ? v : nil
    }

    /// Seconds after the host app opens to simulate a security lockout engaging
    /// (`-DemoLockoutAfter 4`). `nil` ⇒ off.
    static var lockoutAfter: TimeInterval? {
        let v = UserDefaults.standard.double(forKey: "DemoLockoutAfter")
        return v > 0 ? v : nil
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
            expiry: .expiresAt(Date().addingTimeInterval(3600)),
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
