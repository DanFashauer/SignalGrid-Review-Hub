import Foundation

/// Data model representing a complete user session
struct SessionData: Codable {
    let sessionId: String
    let userId: String
    let badgeId: String
    let persona: Persona
    let accessToken: String?
    let refreshToken: String?
    let idToken: String?
    let expiresAt: Date?
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
        expiresAt: Date? = nil,
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
        self.expiresAt = expiresAt
        self.startedAt = startedAt
        self.lastActivityAt = lastActivityAt
        self.isActive = isActive
    }
    
    /// Check if the session token is expired
    var isExpired: Bool {
        guard let expiresAt = expiresAt else { return false }
        return Date() >= expiresAt
    }
    
    /// Time remaining until token expiration
    var timeUntilExpiration: TimeInterval? {
        guard let expiresAt = expiresAt else { return nil }
        return expiresAt.timeIntervalSince(Date())
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

/// Response from session start endpoint
struct StartSessionResponse: Codable {
    let success: Bool
    let sessionToken: String?
    let user: UserInfo?
    let persona: Persona?
    let error: APIError?
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
