import Foundation

/// How a session's lifetime is bounded.
///
/// Replaces the old `expiresAt: Date?`, whose `nil` conflated two very different
/// things — "no token TTL by design" (an MDM session) and "expiry unknown" (a
/// malformed or partial auth path) — and made `isExpired` return `false` for
/// BOTH. `stale` (derived from `isExpired`) is a live posture input to the Assist
/// gate; an unknown expiry that reads as a live session is a fail-OPEN on the
/// safety-critical path, and `nil` is producible by a real auth path.
///
/// This type makes the ignorant third case UNREPRESENTABLE: a session must
/// either name its expiry instant or justify not having one, so `isExpired` has
/// no ignorance branch to fall through.
enum ExpiryPolicy: Codable, Equatable {
    /// The token expires at a specific instant.
    case expiresAt(Date)
    /// No token TTL by design — e.g. an MDM session whose lifetime is governed by
    /// MDM enrolment and device security, not a token. The justification is
    /// REQUIRED so "non-expiring" is always a stated choice, never a silent default.
    case nonExpiring(justification: String)
}

/// Data model representing a complete user session
struct SessionData: Codable {
    let sessionId: String
    let userId: String
    let badgeId: String
    let persona: Persona
    let accessToken: String?
    let refreshToken: String?
    let idToken: String?
    let expiry: ExpiryPolicy
    let startedAt: Date
    var lastActivityAt: Date
    var isActive: Bool
    
    init(
        sessionId: String = UUID().uuidString,
        userId: String,
        badgeId: String,
        persona: Persona,
        accessToken: String? = nil,
        refreshToken: String? = nil,
        idToken: String? = nil,
        expiry: ExpiryPolicy,
        startedAt: Date = Date(),
        lastActivityAt: Date = Date(),
        isActive: Bool = true
    ) {
        self.sessionId = sessionId
        self.userId = userId
        self.badgeId = badgeId
        self.persona = persona
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.idToken = idToken
        self.expiry = expiry
        self.startedAt = startedAt
        self.lastActivityAt = lastActivityAt
        self.isActive = isActive
    }
    
    /// Whether the session token is expired. No ignorance branch: a session that
    /// cannot state a concrete expiry is `.nonExpiring` with a justification, not a
    /// silent "not expired".
    ///
    /// The type removes the *in-code* ignorance case. The justification is the
    /// only thing that makes a `.nonExpiring` session a deliberate state rather
    /// than an unknown one, so a blank justification reads as EXPIRED: an
    /// unjustified "never expires" is the fail-OPEN on the Assist gate's staleness
    /// input this type exists to remove. The sole in-code producer
    /// (`IdentityProvider`'s MDM branch) always states a full reason.
    ///
    /// Scope, stated honestly: this is a VALUE invariant, not a persistence
    /// defence. `ExpiryPolicy` is `Codable` and `KeychainService.getSession`
    /// decodes `SessionData` from the Keychain, but that read path has no caller
    /// today — a session is only ever assigned from a fresh authenticate. A
    /// malformed blob does not decode to a blank justification; the synthesized
    /// decoder throws and `try?` yields nil, which the consumer reads as stale.
    /// And a writer who can tamper with the blob can write any justification.
    /// What the check closes is a future producer, in code or from a server,
    /// that mints an unjustified `.nonExpiring`.
    var isExpired: Bool {
        switch expiry {
        case .expiresAt(let date): return Date() >= date
        case .nonExpiring(let justification):
            return justification.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }

    /// The concrete expiry instant, or nil for a non-expiring session. Convenience
    /// for timeout/refresh checks that should only act when a token TTL exists.
    var expiresAt: Date? {
        if case .expiresAt(let date) = expiry { return date }
        return nil
    }

    /// Time remaining until token expiration, or nil for a non-expiring session.
    var timeUntilExpiration: TimeInterval? {
        switch expiry {
        case .expiresAt(let date): return date.timeIntervalSince(Date())
        case .nonExpiring: return nil
        }
    }
    
    /// Update last activity timestamp
    mutating func updateActivity() {
        self.lastActivityAt = Date()
    }
}

/// Persona model representing user role and permissions
struct Persona: Codable {
    let roleId: String
    let roleName: String
    let permissions: [String]
    let workspaceConfig: WorkspaceConfig
    let appLaunchConfig: AppLaunchConfig
    let restrictions: SessionRestrictions
}

/// Workspace UI configuration
struct WorkspaceConfig: Codable {
    let layout: WorkspaceLayout
    let visibleModules: [String]
    let dashboardWidgets: [DashboardWidget]
    let theme: ThemeConfig
}

enum WorkspaceLayout: String, Codable {
    case grid = "grid"
    case list = "list"
    case single = "single"
}

struct DashboardWidget: Codable {
    let id: String
    let type: String
    let title: String
    let position: Int
    let config: [String: String]
}

struct ThemeConfig: Codable {
    let primaryColor: String
    let accentColor: String
    let logoUrl: String?
}

/// App launch configuration for enterprise apps
struct AppLaunchConfig: Codable {
    let requiredApps: [EnterpriseApp]
    let optionalApps: [EnterpriseApp]
    let autoLaunchApps: [String]
    let defaultApp: String
}

struct EnterpriseApp: Codable {
    let appId: String
    let bundleId: String
    let displayName: String
    let launchUrl: String?
    let isDeepLink: Bool
}

/// Session restrictions based on persona
struct SessionRestrictions: Codable {
    let maxSessionDuration: TimeInterval?
    let idleTimeout: TimeInterval
    let allowCopyPaste: Bool
    let allowScreenCapture: Bool
    let allowPrint: Bool
    let allowAirDrop: Bool
    let allowedDomains: [String]?
    let blockedFeatures: [String]
}

// MARK: - Session API Models

/// Request to start a new session
struct StartSessionRequest: Codable {
    let badgeId: String
    let deviceId: String
    let deviceSerial: String
    let timestamp: Date
    let metadata: [String: String]
}

/// The shell's app-level session-start result. Built from the control plane's
/// `{session, decision}` wire response (`BackendService.startSession`), from the
/// simulator demo (`DemoMode`), or from a local/offline session.
struct StartSessionResponse: Codable {
    let success: Bool
    let sessionToken: String?
    let user: UserInfo?
    let persona: Persona?
    let error: APIError?
    /// The control plane's `session.id` when it minted the session; nil for demo
    /// and local sessions.
    var controlPlaneSessionId: String? = nil
    /// The expiry instant the server (or the local session) stated, when known.
    var expiresAt: Date? = nil
    /// The gating decision's outcome verbatim (`allow` / `step_up` / `restrict` /
    /// `deny`) when a control plane answered.
    var decisionOutcome: String? = nil
}

// MARK: - Control-plane wire models
//
// The SERVED shapes, from `lib/api-spec/v1-openapi.yaml` (`EvaluateRequest`,
// `EvaluateResult`) and `artifacts/api-server/src/routes/v1.ts` (`Session`, from
// `lib/persistence/src/session-store.ts`). Responses arrive inside
// `envelope()` — `{requestId, timestamp, ...data}` — so decoding the named keys
// and ignoring the rest is the whole of the unwrapping. Dates are ISO-8601 strings
// with fractional seconds (`Date.toISOString()`); `ISO8601Wire.parse` reads them.

/// `POST /api/v1/sessions/start` body (`EvaluateRequest`, plus the optional TTL).
struct SessionStartWireRequest: Codable {
    let identityRef: String
    let deviceRef: String
    let workflowKey: String
    let ttlSeconds: Int?
}

/// `Session` as the server stores and returns it.
struct ControlPlaneSession: Codable {
    let id: String
    let tenantId: String?
    let identityRef: String
    let deviceRef: String
    let workflowKey: String
    let status: String
    let outcome: String?
    let decisionId: String?
    let createdAt: String?
    let lastSeenAt: String?
    let expiresAt: String?
}

/// `EvaluateResult` — the gating decision.
struct ControlPlaneDecision: Codable {
    let decisionId: String
    let outcome: String
    let reasonCodes: [String]?
    let explanation: String?
}

/// `{session, decision}` from `sessions/start`.
struct SessionStartWireResponse: Codable {
    let session: ControlPlaneSession
    let decision: ControlPlaneDecision
}

/// `{session}` from `sessions/{id}`, `/refresh` and `/end`.
struct SessionWireEnvelope: Codable {
    let session: ControlPlaneSession
}

/// ISO-8601 on the wire, both with and without fractional seconds. Foundation's
/// `ISO8601DateFormatter` accepts exactly one of those per configuration, and the
/// server emits the fractional form.
enum ISO8601Wire {
    private static let fractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let whole: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    static func parse(_ raw: String?) -> Date? {
        guard let raw = raw, !raw.isEmpty else { return nil }
        return fractional.date(from: raw) ?? whole.date(from: raw)
    }

    static func string(_ date: Date) -> String {
        fractional.string(from: date)
    }
}

/// Request to end a session
struct EndSessionRequest: Codable {
    let sessionId: String
    let reason: SessionEndReason
    let timestamp: Date
    let auditData: AuditData
}

/// Response from session end endpoint
struct EndSessionResponse: Codable {
    let success: Bool
    let error: APIError?
}

/// User information from backend
struct UserInfo: Codable {
    let userId: String
    let employeeId: String
    let displayName: String
    let email: String
    let department: String?
    let title: String?
}

/// Reason for ending a session
enum SessionEndReason: String, Codable {
    case userInitiated = "user_initiated"
    case timeout = "timeout"
    case securityViolation = "security_violation"
    case adminTerminated = "admin_terminated"
    case appBackgrounded = "app_backgrounded"
    case systemLock = "system_lock"
}

/// Audit data to send with session end
struct AuditData: Codable {
    let sessionDuration: TimeInterval
    let actionsPerformed: [String]
    let resourcesAccessed: [String]
    let anyErrors: Bool
}

/// API error model
struct APIError: Codable {
    let code: String
    let message: String
    let details: [String: String]?
}

// MARK: - Badge Enrollment Models

/// Request to check badge enrollment status
struct BadgeEnrollmentRequest: Codable {
    let badgeId: String
    let deviceId: String
    let deviceSerial: String
    let timestamp: Date
    let metadata: [String: String]
}

/// Request to complete badge enrollment
struct CompleteEnrollmentRequest: Codable {
    let badgeId: String
    let userInfo: EnrollmentUserInfo
    let timestamp: Date
}

/// User info for badge enrollment
struct EnrollmentUserInfo: Codable {
    let employeeId: String
    let displayName: String
    let email: String
    let department: String?
    let title: String?
}

/// Response from badge enrollment check
struct BadgeEnrollmentResponse: Codable {
    let isEnrolled: Bool
    let needsProvisioning: Bool
    let persona: Persona?
    let sessionToken: String?
    let user: UserInfo?
    let error: APIError?
    let enrollmentInstructions: String?
}
