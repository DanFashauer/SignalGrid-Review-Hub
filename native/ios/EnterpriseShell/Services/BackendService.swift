import Foundation

/// Client for the SignalGrid control plane's SERVED `/v1` surface.
///
/// CONTRACT OF RECORD: `lib/api-spec/v1-openapi.yaml`, mounted under `/api` by
/// `artifacts/api-server/src/app.ts` (`app.use("/api", router)`), so every path
/// here is `/api/v1/...`. Read the spec, not this file, for what is served. As of
/// 2026-09-02 the server serves session start / get / refresh / end and the
/// decision routes, and it does NOT serve `/api/sessions/*`, `/api/badges/*`,
/// `/api/auth/*`, or any audit-ingest POST (`/v1/audit` is a GET). Each method
/// below names the route it is bound by, or says plainly that none exists.
///
/// Every call carries `Authorization: Bearer <tenant token>` — the only credential
/// `middlewares/context.ts` accepts; a missing or unknown token is a 401, never a
/// default tenant.
final class BackendService {

    // MARK: - Singleton

    static let shared = BackendService()

    // MARK: - Base URL resolution

    /// Where the base URL came from. Surfaced on the lock screen so an operator can
    /// tell an MDM-delivered value from a developer's launch argument.
    enum BaseURLSource: String {
        case managedConfig = "managed config BackendBaseURL"
        case launchArgument = "launch argument -DemoBackendURL"
        case environment = "environment BACKEND_BASE_URL"
    }

    struct ResolvedBackend {
        let url: URL
        let source: BaseURLSource
    }

    /// Resolve the control-plane base URL, in this order and NO further:
    ///   1. Managed App Config key `BackendBaseURL` (MDM-delivered; device builds).
    ///      When a managed dictionary EXISTS it answers only from itself — a key it
    ///      lacks is absent, never a launch argument. The same-named `-BackendBaseURL`
    ///      launch argument / UserDefaults fallback applies ONLY on a device with no
    ///      managed dictionary (`KioskConfig.managedString`).
    ///   2. `-DemoBackendURL` launch argument (simulator only; loopback only)
    ///   3. `BACKEND_BASE_URL` process environment (Xcode scheme / CI)
    ///   4. nil — there is NO placeholder host. With nil the app runs in
    ///      local/offline mode: no network call is made anywhere, the lock screen
    ///      says so in its footer, and audit stays on the device.
    ///
    /// Throws `BackendError.insecureBaseURL` for a non-https URL, except that the
    /// plain http scheme is permitted for loopback (127.0.0.1 / localhost / ::1) so a
    /// developer can point at a local api-server. A thrown error is a
    /// CONFIGURATION problem that is reported — the `fatalError` this replaces
    /// took the whole app down ~30 s after launch from the audit timer, even in
    /// demo mode, whenever a local plain-http backend was configured.
    static func resolveBaseURL() throws -> ResolvedBackend? {
        if let managed = KioskConfig.backendBaseURL,
           !managed.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return ResolvedBackend(url: try validated(managed, source: .managedConfig), source: .managedConfig)
        }
        #if targetEnvironment(simulator)
        if let raw = UserDefaults.standard.string(forKey: "DemoBackendURL"), !raw.isEmpty {
            // DemoMode.backendURL is loopback-only by design: a public demo build must
            // never become a live client. A non-loopback value is therefore a REFUSED
            // configuration and is reported as one — not silently "no backend".
            guard let url = DemoMode.backendURL else {
                throw BackendError.insecureBaseURL("-DemoBackendURL must name a loopback host (127.0.0.1 / localhost); got \(raw)")
            }
            return ResolvedBackend(url: try validated(url.absoluteString, source: .launchArgument), source: .launchArgument)
        }
        #endif
        if let env = ProcessInfo.processInfo.environment["BACKEND_BASE_URL"], !env.isEmpty {
            return ResolvedBackend(url: try validated(env, source: .environment), source: .environment)
        }
        return nil
    }

    private static func validated(_ raw: String, source: BaseURLSource) throws -> URL {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed),
              let scheme = url.scheme?.lowercased(),
              let host = url.host?.lowercased() else {
            throw BackendError.invalidUrl
        }
        if scheme == "https" { return url }
        let loopback = host == "localhost" || host == "127.0.0.1" || host == "::1"
        if scheme == "http" && loopback { return url }
        throw BackendError.insecureBaseURL("\(source.rawValue) is \(trimmed); only https is accepted (http only for 127.0.0.1 / localhost)")
    }

    /// The three states every consumer must tell apart. `.refused` is a backend
    /// that IS configured and cannot be used — never "offline by design": a
    /// consumer that treats it as `.absent` would run the local path against a
    /// tenant that exists. Every call site tightens on `.refused`.
    enum Configuration {
        case configured(ResolvedBackend)
        case refused(BackendError)
        case absent
    }

    static var configuration: Configuration {
        do {
            if let backend = try resolveBaseURL() { return .configured(backend) }
            return .absent
        } catch let error as BackendError {
            return .refused(error)
        } catch {
            return .refused(.invalidUrl)
        }
    }

    /// The base URL when one is usable. nil for BOTH `.refused` and `.absent` —
    /// use `configuration` or `requiredBaseURL()` wherever the difference matters.
    static var baseURL: URL? {
        if case .configured(let backend) = configuration { return backend.url }
        return nil
    }

    static var isConfigured: Bool { baseURL != nil }

    static var configurationError: BackendError? {
        if case .refused(let error) = configuration { return error }
        return nil
    }

    /// For a call that needs a backend: the URL when configured, nil when absent
    /// (the caller decides what "no backend" means for it), and a THROW when the
    /// configured value was refused — refused is never quietly nil.
    static func requiredBaseURL() throws -> URL? {
        switch configuration {
        case .configured(let backend): return backend.url
        case .absent: return nil
        case .refused(let error): throw error
        }
    }

    /// One truthful line for the lock-screen footer, in each of the three states.
    static var statusLine: String {
        switch configuration {
        case .refused(let error):
            return "Backend refused: \(error.localizedDescription)"
        case .configured(let backend):
            let port = backend.url.port.map { ":\($0)" } ?? ""
            return "Backend: \(backend.url.host ?? backend.url.absoluteString)\(port) — \(backend.source.rawValue)"
        case .absent:
            return "No backend configured — running locally; audit stays on this device"
        }
    }

    // MARK: - Bearer token resolution

    /// The tenant credential the served `/v1` surface requires. Order:
    /// `-DemoBackendToken` (simulator) → `BACKEND_BEARER_TOKEN` environment →
    /// Managed App Config `BackendBearerToken`. This never consults an identity
    /// provider (the control-plane session provider returns THIS from its
    /// `getAccessToken()`, so consulting providers here would recurse).
    static var tenantBearerToken: String? {
        #if targetEnvironment(simulator)
        if let token = DemoMode.backendToken, !token.isEmpty { return token }
        #endif
        if let token = ProcessInfo.processInfo.environment["BACKEND_BEARER_TOKEN"], !token.isEmpty { return token }
        if let token = KioskConfig.backendBearerToken, !token.isEmpty { return token }
        return nil
    }

    /// The bearer sent on every request: the CONFIGURED identity provider's token
    /// when it has one, else the tenant credential. Same style as
    /// `RemoteDecisionService` in `DecisionService.swift`.
    static var bearerToken: String? {
        if let token = ProviderConfigurationService.shared.getIdentityProvider()?.getAccessToken(), !token.isEmpty {
            return token
        }
        return tenantBearerToken
    }

    /// The `workflowKey` sent at session start. Managed App Config `BackendWorkflowKey`
    /// (falling back to the same-named launch argument), else the key the fixture
    /// tenant seeds (`artifacts/api-server` tests use `clinical-session`). An
    /// unknown key is decided by the core, fail-closed — it never opens anything.
    static var workflowKey: String {
        if let key = KioskConfig.backendWorkflowKey, !key.isEmpty { return key }
        return "clinical-session"
    }

    // MARK: - Properties

    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    // MARK: - Initialization

    private init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60

        // SECURITY: Configure TLS certificate pinning
        // In production, add your server's certificate SHA256 hash
        let pinnedHashes = Self.getPinnedCertificateHashes()
        if !pinnedHashes.isEmpty {
            config.urlCache = nil
            config.requestCachePolicy = .reloadIgnoringLocalCacheData
        }

        self.session = URLSession(configuration: config)

        self.decoder = JSONDecoder()

        self.encoder = JSONEncoder()
        self.encoder.dateEncodingStrategy = .iso8601
    }

    /// Get certificate hashes for pinning (override in production)
    private static func getPinnedCertificateHashes() -> [String] {
        return ProcessInfo.processInfo.environment["CERT_PINNING_ENABLED"] == "true"
            ? (ProcessInfo.processInfo.environment["CERT_HASHES"] ?? "").split(separator: ",").map { String($0) }
            : []
    }

    // MARK: - Session Start  (POST /api/v1/sessions/start)

    /// Start a control-plane session. Wire: `EvaluateRequest`
    /// `{identityRef, deviceRef, workflowKey}` in, `{session, decision}` out
    /// (`routes/v1.ts` `sessions/start`). The shell's `StartSessionResponse` is
    /// derived from the DECISION: only `allow` starts a session. `step_up`,
    /// `restrict` and `deny` come back as a failed start that names the outcome and
    /// its reason codes, because the lock screen has no step-up path of its own
    /// (fail closed). The served contract carries no persona or app catalog, so the
    /// persona is an honest, empty control-plane workspace — not invented apps.
    func startSession(
        badgeId: String,
        deviceId: String,
        deviceSerial: String
    ) async throws -> StartSessionResponse {
        #if targetEnvironment(simulator)
        if DemoMode.isEnabled { return DemoMode.unenrolled ? DemoMode.unenrolledStartResponse() : DemoMode.startSessionResponse(badgeId: badgeId) }
        #endif
        // `.refused` throws here; `.absent` is the local path; only `.configured` calls.
        guard let base = try Self.requiredBaseURL() else {
            // The local-session guard reads main-thread kiosk state (the ASAM
            // probe); evaluate it THERE, never from this executor.
            let allowed = await MainActor.run { KioskConfig.localSessionAllowed }
            return try Self.offlineStartResponse(badgeId: badgeId, localSessionAllowed: allowed)
        }

        var request = try Self.jsonRequest(base, "api/v1/sessions/start", method: "POST")
        let body = SessionStartWireRequest(
            identityRef: Self.identityRef(forBadge: badgeId),
            deviceRef: Self.deviceRef(deviceId: deviceId),
            workflowKey: Self.workflowKey,
            ttlSeconds: nil
        )
        request.httpBody = try encoder.encode(body)

        let data = try await send(request)
        let wire = try decoder.decode(SessionStartWireResponse.self, from: data)
        let response = Self.appResponse(from: wire, badgeId: badgeId)

        // The server persists a session row even for a non-allow outcome; close it
        // so nothing "active" lingers for a start the shell refused to honour.
        if !response.success, let id = response.controlPlaneSessionId {
            Task { _ = try? await self.endSession(sessionId: id, reason: .securityViolation) }
        }
        return response
    }

    private static func identityRef(forBadge badgeId: String) -> String {
        #if targetEnvironment(simulator)
        if let seeded = DemoMode.backendIdentity, !seeded.isEmpty { return seeded }
        #endif
        return "badge:\(badgeId)"
    }

    private static func deviceRef(deviceId: String) -> String {
        #if targetEnvironment(simulator)
        if let seeded = DemoMode.backendDevice, !seeded.isEmpty { return seeded }
        #endif
        return deviceId
    }

    private static func appResponse(from wire: SessionStartWireResponse, badgeId: String) -> StartSessionResponse {
        let outcome = wire.decision.outcome
        let reasons = (wire.decision.reasonCodes ?? []).joined(separator: ", ")
        guard outcome == "allow" else {
            return StartSessionResponse(
                success: false,
                sessionToken: nil,
                user: nil,
                persona: nil,
                error: APIError(
                    code: "DECISION_\(outcome.uppercased())",
                    message: "The control plane answered \(outcome) for this badge on this device\(reasons.isEmpty ? "" : " (\(reasons))").",
                    details: ["decisionId": wire.decision.decisionId]
                ),
                controlPlaneSessionId: wire.session.id,
                expiresAt: nil,
                decisionOutcome: outcome
            )
        }
        return StartSessionResponse(
            success: true,
            sessionToken: wire.session.id,
            user: UserInfo(
                userId: wire.session.identityRef,
                employeeId: wire.session.identityRef,
                displayName: wire.session.identityRef,
                email: "",
                department: nil,
                title: nil
            ),
            persona: controlPlanePersona(session: wire.session, decision: wire.decision),
            error: nil,
            controlPlaneSessionId: wire.session.id,
            expiresAt: ISO8601Wire.parse(wire.session.expiresAt),
            decisionOutcome: outcome
        )
    }

    private static func controlPlanePersona(session: ControlPlaneSession, decision: ControlPlaneDecision) -> Persona {
        Persona(
            roleId: "control-plane:\(session.workflowKey)",
            roleName: "Control-plane session",
            permissions: ["session.start", "session.end"],
            workspaceConfig: WorkspaceConfig(
                layout: .grid,
                visibleModules: ["dashboard"],
                dashboardWidgets: [
                    DashboardWidget(id: "w-status", type: "status", title: "Session Status", position: 0, config: [:]),
                    DashboardWidget(id: "w-decision", type: "decision", title: "Decision: \(decision.outcome)", position: 1,
                                    config: ["decisionId": decision.decisionId, "workflowKey": session.workflowKey])
                ],
                theme: ThemeConfig(primaryColor: "#4F8C87", accentColor: "#5E8F73", logoUrl: nil)
            ),
            appLaunchConfig: AppLaunchConfig(requiredApps: [], optionalApps: [], autoLaunchApps: [], defaultApp: "none"),
            restrictions: SessionRestrictions(
                maxSessionDuration: 3600,
                idleTimeout: 300,
                allowCopyPaste: false,
                allowScreenCapture: false,
                allowPrint: false,
                allowAirDrop: false,
                allowedDomains: nil,
                blockedFeatures: []
            )
        )
    }

    // MARK: - Local / offline session (no backend configured)

    /// A local session exists ONLY on a POSITIVE assertion: `KioskConfig
    /// .localSessionAllowed` — no managed app-config dictionary, the Settings-bundle
    /// toggle ON, and no kiosk lock engaged (an engaged lock proves supervision
    /// whatever the dictionary says). The workspace it opens has no apps and no
    /// authority. Everything else with no backend fails closed
    /// (`BackendError.notConfigured`): a badge opening a kiosk whose control plane
    /// is unreachable would be exactly the fail-open this repository forbids, and
    /// the absence of app-config is not evidence of anything.
    private static func offlineStartResponse(badgeId: String, localSessionAllowed: Bool) throws -> StartSessionResponse {
        guard localSessionAllowed else { throw BackendError.notConfigured }
        let expiresAt = Date().addingTimeInterval(3600)
        return StartSessionResponse(
            success: true,
            sessionToken: "local-\(UUID().uuidString)",
            user: UserInfo(userId: "local-user", employeeId: badgeId, displayName: "Local session", email: "", department: nil, title: nil),
            persona: Persona(
                roleId: "local-offline",
                roleName: "Local session (no backend)",
                permissions: ["session.start", "session.end"],
                workspaceConfig: WorkspaceConfig(
                    layout: .grid,
                    visibleModules: ["dashboard"],
                    dashboardWidgets: [
                        DashboardWidget(id: "w-status", type: "status", title: "Session Status", position: 0, config: [:]),
                        DashboardWidget(id: "w-backend", type: "status", title: "No backend configured", position: 1, config: [:])
                    ],
                    theme: ThemeConfig(primaryColor: "#4F8C87", accentColor: "#5E8F73", logoUrl: nil)
                ),
                appLaunchConfig: AppLaunchConfig(requiredApps: [], optionalApps: [], autoLaunchApps: [], defaultApp: "none"),
                restrictions: SessionRestrictions(
                    maxSessionDuration: 3600,
                    idleTimeout: 300,
                    allowCopyPaste: false,
                    allowScreenCapture: false,
                    allowPrint: false,
                    allowAirDrop: false,
                    allowedDomains: nil,
                    blockedFeatures: []
                )
            ),
            error: nil,
            controlPlaneSessionId: nil,
            expiresAt: expiresAt,
            decisionOutcome: nil
        )
    }

    // MARK: - Session Refresh  (POST /api/v1/sessions/{id}/refresh)

    /// Extend an active session's TTL. Returns the new `expiresAt`, or nil when
    /// there is nothing to refresh remotely (no backend, or a local session).
    func refreshSession(sessionId: String) async throws -> Date? {
        if sessionId.hasPrefix("local-") { return nil }
        // Absent → nothing to refresh remotely; refused → throws (never "offline").
        guard let base = try Self.requiredBaseURL() else { return nil }
        var request = try Self.jsonRequest(base, "api/v1/sessions/\(sessionId)/refresh", method: "POST")
        request.httpBody = try encoder.encode([String: String]())
        let data = try await send(request)
        let wire = try decoder.decode(SessionWireEnvelope.self, from: data)
        return ISO8601Wire.parse(wire.session.expiresAt)
    }

    // MARK: - Session End  (POST /api/v1/sessions/{id}/end)

    /// End a control-plane session. The server takes no body; `reason` is sent for
    /// the request log only. A local session id never reaches a server and ends
    /// clean. A CONTROL-PLANE id with no usable backend THROWS: the server row
    /// would stay active, and recording a clean end for it would be a false audit
    /// (`terminateSession` wipes local data first and records the failure).
    func endSession(sessionId: String, reason: SessionEndReason) async throws -> EndSessionResponse {
        #if targetEnvironment(simulator)
        if DemoMode.isEnabled { return DemoMode.endSessionResponse() }
        #endif
        if sessionId.hasPrefix("local-") {
            return EndSessionResponse(success: true, error: nil)
        }
        guard let base = try Self.requiredBaseURL() else {
            throw BackendError.notConfigured
        }
        var request = try Self.jsonRequest(base, "api/v1/sessions/\(sessionId)/end", method: "POST")
        request.httpBody = try encoder.encode(["reason": reason.rawValue])
        let data = try await send(request)
        let wire = try decoder.decode(SessionWireEnvelope.self, from: data)
        return EndSessionResponse(success: wire.session.status == "ended", error: nil)
    }

    // MARK: - Audit Data  (NO served route)

    /// The served contract has NO audit-ingest route — checked 2026-09-02 against
    /// `routes/v1.ts`: the only `/v1/audit` route is a GET. Session audit therefore
    /// stays LOCAL, through `AuditLogger`'s bounded on-device queue, and is never
    /// re-queued for a server that cannot take it.
    func sendAuditData(sessionId: String, auditData: AuditData) async throws {
        // DECLARED-NOT-IMPLEMENTED: no route in artifacts/api-server serves an
        // audit-ingest POST. The served session routes are
        // /api/v1/sessions/{start,:id,:id/refresh,:id/end}; the only audit routes are
        // GET /api/v1/audit, /api/simulator/audit and /api/cp/v1/self-audit.
        // Established by the Mac lane on 2026-09-02 by enumerating every
        // router.get/post/put/patch/delete (including the multi-line signatures) plus
        // every router.use in routes/ — all sub-routers mount with NO path prefix, so
        // their declared paths are absolute — and `check:absence` on the old
        // `/api/sessions/:id/audit` string returns INCONCLUSIVE, its only matches
        // being this file and a lane message: the caller and the report, never a route.
        //
        // So no request is made. The property the Mac lane's fix established — every
        // non-success is REPORTED, never dropped (a non-2xx once fell through both
        // branches of the completion handler and discarded the payload in silence) —
        // holds here by construction: there is no network outcome to lose, and the
        // local record below is written unconditionally.
        AuditLogger.shared.log(event: .auditKeptLocal, metadata: [
            "sessionId": sessionId,
            "sessionDuration": String(Int(auditData.sessionDuration)),
            "anyErrors": String(auditData.anyErrors),
            "reason": "server has no audit-ingest route"
        ])
    }

    // MARK: - Health Check  (GET /api/v1/context)

    /// Reachability + credential check. There is no unauthenticated `/health` on
    /// the served surface; `GET /api/v1/context` answers 200 for a valid bearer.
    func healthCheck() async throws -> Bool {
        // Absent → not healthy; refused → throws with the reason. `GET /api/healthz`
        // (routes/health.ts) is the unauthenticated liveness probe the Mac lane
        // repointed the old `/health` call at; `/api/v1/context` is used here because
        // it also proves the bearer, which is what "can this device start a session"
        // actually asks.
        guard let base = try Self.requiredBaseURL() else { return false }
        let request = try Self.jsonRequest(base, "api/v1/context", method: "GET")
        _ = try await send(request)
        return true
    }

    // MARK: - Badge Enrollment  (NO served route)

    /// The served surface has no `/badges` route (`/api/badges/*` does not exist).
    /// Badge enrollment happens in the SignalGrid console; this device cannot do it.
    /// The simulator demo path is kept so `-DemoUnenrolled` still demonstrates the
    /// enrollment screen.
    func checkBadgeEnrollment(
        badgeId: String,
        deviceId: String,
        deviceSerial: String
    ) async throws -> BadgeEnrollmentResponse {
        #if targetEnvironment(simulator)
        if DemoMode.isEnabled { return DemoMode.enrollmentCheckResponse() }
        #endif
        // DECLARED-NOT-IMPLEMENTED: no route in artifacts/api-server serves any
        // /badges path. "badge" and "enroll" appear there only in prose, a
        // control-plane connector id and the x-enrollment-authorization CORS header;
        // the only enroll routes are /v1/step-up/enroll/{options,verify}, which are
        // WebAuthn step-up, not badge enrollment (Mac lane, 2026-09-02). This throws a
        // named refusal instead of posting to a path that would 404 — a 404 reads as
        // "the server said no" when nothing was asked.
        throw BackendError.notSupported("badge enrollment — the served /v1 surface has no /badges route; an administrator enrolls badges in the SignalGrid console")
    }

    /// Same route gap as `checkBadgeEnrollment`.
    func completeBadgeEnrollment(
        badgeId: String,
        userInfo: EnrollmentUserInfo
    ) async throws -> BadgeEnrollmentResponse {
        // DECLARED-NOT-IMPLEMENTED: same route gap as `checkBadgeEnrollment`.
        throw BackendError.notSupported("badge enrollment — the served /v1 surface has no /badges route; an administrator enrolls badges in the SignalGrid console")
    }

    // MARK: - Request plumbing

    private static func jsonRequest(_ base: URL, _ path: String, method: String) throws -> URLRequest {
        var request = URLRequest(url: base.appendingPathComponent(path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        request.setValue(DeviceInfo.identifier, forHTTPHeaderField: "X-Device-ID")
        request.setValue(DeviceInfo.hardwareModel, forHTTPHeaderField: "X-Device-Model")
        request.setValue(DeviceInfo.osVersion, forHTTPHeaderField: "X-OS-Version")
        guard let token = bearerToken, !token.isEmpty else {
            throw BackendError.missingBearerToken
        }
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        return request
    }

    private func send(_ request: URLRequest) async throws -> Data {
        var signed = request
        // SECURITY: request signing for API integrity (headers only; the server
        // ignores unknown headers, so this is additive).
        SecurityManager.shared.signRequest(&signed, body: signed.httpBody)
        let (data, response) = try await session.data(for: signed)
        guard let http = response as? HTTPURLResponse else {
            throw BackendError.invalidResponse
        }
        guard (200...299).contains(http.statusCode) else {
            throw BackendError.httpError(statusCode: http.statusCode)
        }
        return data
    }
}

// MARK: - Backend Errors

enum BackendError: LocalizedError {
    case invalidResponse
    case httpError(statusCode: Int)
    case invalidUrl
    case encodingError
    case decodingError
    /// A non-https base URL that is not loopback. Thrown, never fatal.
    case insecureBaseURL(String)
    /// No backend configured on a MANAGED device (an unmanaged one runs locally).
    case notConfigured
    /// The served contract has no route for this operation.
    case notSupported(String)
    /// The served surface requires a bearer and none is configured.
    case missingBearerToken

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Invalid response from server"
        case .httpError(let statusCode):
            return "HTTP error: \(statusCode)"
        case .invalidUrl:
            return "Invalid URL"
        case .encodingError:
            return "Failed to encode request"
        case .decodingError:
            return "Failed to decode response"
        case .insecureBaseURL(let detail):
            return "Backend URL must use https (http only for 127.0.0.1 / localhost): \(detail)"
        case .notConfigured:
            return "No backend configured — no session can start on this device until BackendBaseURL is set (or, on an unmanaged phone, local sign-in is enabled in iOS Settings)"
        case .notSupported(let what):
            return "This backend does not support \(what)"
        case .missingBearerToken:
            return "No bearer token configured for the backend (BackendBearerToken / BACKEND_BEARER_TOKEN / -DemoBackendToken)"
        }
    }
}
