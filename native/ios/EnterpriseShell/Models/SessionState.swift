import Foundation

/// Defines all possible states in the session lifecycle
enum SessionState: String, CaseIterable {
    case lockedIdle = "LockedIdle"
    case badgeCaptured = "BadgeCaptured"
    case authenticating = "Authenticating"
    case enrolling = "Enrolling"  // For unenrolled badges - provisioning flow
    case provisioning = "Provisioning"
    case activeSession = "ActiveSession"
    case terminating = "Terminating"
    
    /// Human-readable description of the state
    var displayName: String {
        switch self {
        case .lockedIdle:
            return "Locked - Idle"
        case .badgeCaptured:
            return "Badge Captured"
        case .authenticating:
            return "Authenticating..."
        case .enrolling:
            return "Setting Up Access..."
        case .provisioning:
            return "Provisioning Session..."
        case .activeSession:
            return "Active Session"
        case .terminating:
            return "Ending Session..."
        }
    }
    
    /// Whether this state represents an authenticated session
    var isAuthenticated: Bool {
        switch self {
        case .activeSession:
            return true
        default:
            return false
        }
    }
    
    /// Whether this is a terminal state (transitioning away)
    var isTerminal: Bool {
        switch self {
        case .terminating:
            return true
        default:
            return false
        }
    }
    
    /// Allowed transitions from this state
    var allowedTransitions: [SessionState] {
        switch self {
        case .lockedIdle:
            return [.badgeCaptured, .authenticating, .enrolling]
        case .badgeCaptured:
            return [.lockedIdle, .authenticating, .enrolling]
        case .authenticating:
            return [.lockedIdle, .provisioning, .enrolling]
        case .enrolling:
            return [.lockedIdle, .provisioning]
        case .provisioning:
            return [.lockedIdle, .activeSession]
        case .activeSession:
            return [.terminating, .lockedIdle]
        case .terminating:
            return [.lockedIdle]
        }
    }
}

/// Notification posted when session state changes
extension Notification.Name {
    static let sessionStateDidChange = Notification.Name("sessionStateDidChange")
    static let deviceReadyForNewSession = Notification.Name("deviceReadyForNewSession")
}

/// User info keys for session state notifications
struct SessionStateNotificationKeys {
    static let newState = "newState"
    static let previousState = "previousState"
    static let error = "error"
}
