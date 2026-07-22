import Foundation
import UIKit

/// Manages the session lifecycle state machine
/// Now uses configurable BadgeReaderProvider and IdentityProvider for flexibility
final class SessionStateManager: ObservableObject, BadgeReaderProviderDelegate, BadgeReaderManagerDelegate {
    
    // MARK: - Singleton
    
    static let shared = SessionStateManager()
    
    // MARK: - Published Properties
    
    @Published private(set) var currentState: SessionState = .lockedIdle
    @Published private(set) var currentSession: SessionData?
    @Published private(set) var capturedBadgeId: String?
    @Published private(set) var lastError: Error?
    
    // MARK: - Properties
    
    private var badgeReaderProvider: BadgeReaderProvider?
    private var identityProvider: IdentityProvider?
    
    var currentSessionId: String? {
        currentSession?.sessionId
    }
    
    var isSessionActive: Bool {
        currentState == .activeSession && currentSession?.isActive == true
    }
    
    private var stateTransitionQueue = DispatchQueue(label: "com.enterprise.shell.stateQueue")
    private var activityTimer: Timer?
    private var timeoutTimer: Timer?
    private let timeoutGracePeriod: TimeInterval = 5.0
    
    // MARK: - Initialization
    
    private init() {
        // Load any persisted session state
        loadPersistedState()
        
        // Initialize providers from configuration
        initializeProviders()
    }
    
    // MARK: - Provider Initialization
    
    private func initializeProviders() {
        // Get providers from configuration service
        let configService = ProviderConfigurationService.shared
        
        badgeReaderProvider = configService.getBadgeReaderProvider()
        badgeReaderProvider?.delegate = self
        badgeReaderProvider?.setup()
        
        identityProvider = configService.getIdentityProvider()
        
        AuditLogger.shared.log(event: .providersInitialized, metadata: [
            "badgeReader": badgeReaderProvider?.displayName ?? "none",
            "identityProvider": identityProvider?.displayName ?? "none"
        ])
    }
    
    // MARK: - State Transitions
    
    /// Transition to a new state with validation
    func transition(to newState: SessionState, error: Error? = nil) {
        stateTransitionQueue.async { [weak self] in
            guard let self = self else { return }
            
            // Validate transition
            guard self.currentState.allowedTransitions.contains(newState) else {
                let invalidTransitionError = SessionError.invalidStateTransition(
                    from: self.currentState,
                    to: newState
                )
                self.handleError(invalidTransitionError)
                return
            }
            
            let previousState = self.currentState
            
            // Execute state-specific entry/exit actions
            self.exitState(previousState)
            self.currentState = newState
            self.enterState(newState)
            
            // Notify observers
            DispatchQueue.main.async {
                self.lastError = error
                NotificationCenter.default.post(
                    name: .sessionStateDidChange,
                    object: nil,
                    userInfo: [
                        SessionStateNotificationKeys.newState: newState,
                        SessionStateNotificationKeys.previousState: previousState,
                        SessionStateNotificationKeys.error: error as Any
                    ]
                )
            }
            
            // Log state transition
            AuditLogger.shared.log(event: .stateTransition, metadata: [
                "previousState": previousState.rawValue,
                "newState": newState.rawValue
            ])
        }
    }
    
    // MARK: - State Actions
    
    private func exitState(_ state: SessionState) {
        switch state {
        case .activeSession:
            stopActivityTimer()
            stopTimeoutTimer()
        default:
            break
        }
    }
    
    private func enterState(_ state: SessionState) {
        switch state {
        case .lockedIdle:
            cleanupCurrentSession()
            capturedBadgeId = nil
            
        case .badgeCaptured:
            // Badge ID is already set before transition
            break
            
        case .authenticating:
            // Begin OIDC authentication flow
            Task {
                await beginAuthentication()
            }
            
        case .enrolling:
            // Badge enrollment flow - handled by handleUnenrolledBadge
            // UI shows enrollment instructions
            AuditLogger.shared.log(event: .badgeEnrollmentStarted, metadata: [
                "badgeId": maskBadgeId(capturedBadgeId ?? "unknown")
            ])
            
        case .provisioning:
            // Configure session based on persona
            Task {
                await provisionSession()
            }
            
        case .activeSession:
            startActivityTimer()
            startTimeoutTimer()
            
        case .terminating:
            // Begin session teardown
            Task {
                await terminateSession(reason: .userInitiated)
            }
        }
    }
    
    // MARK: - Badge Handling
    
    /// Called when a badge is scanned (from BadgeReaderProviderDelegate)
    func onBadgeScanned(_ badgeId: String) {
        guard currentState == .lockedIdle else {
            AuditLogger.shared.log(event: .badgeScannedUnexpectedState, metadata: [
                "badgeId": maskBadgeId(badgeId),
                "currentState": currentState.rawValue
            ])
            return
        }
        
        // SECURITY: Validate badge ID format before processing
        let validationResult = SecurityManager.shared.validateBadgeId(badgeId)
        if !validationResult.valid {
            AuditLogger.shared.log(event: .securitySuspiciousBadge, metadata: [
                "badgeId": maskBadgeId(badgeId),
                "reason": validationResult.error ?? "invalid_format"
            ])
            transition(to: .lockedIdle, error: SessionError.invalidBadgeFormat)
            return
        }
        
        // SECURITY: Check rate limiting before processing
        let rateLimitResult = SecurityManager.shared.isBadgeScanAllowed(badgeId: badgeId)
        if !rateLimitResult.allowed {
            AuditLogger.shared.log(event: .securityRateLimitExceeded, metadata: [
                "badgeId": maskBadgeId(badgeId),
                "reason": rateLimitResult.reason ?? "rate_limit_exceeded"
            ])
            transition(to: .lockedIdle, error: SessionError.rateLimited)
            return
        }
        
        capturedBadgeId = badgeId
        
        AuditLogger.shared.log(event: .badgeScanned, metadata: [
            "badgeId": maskBadgeId(badgeId)
        ])
        
        // Transition to badge captured state
        transition(to: .badgeCaptured)
    }
    
    // MARK: - Authentication Flow
    
    private func beginAuthentication() async {
        guard let badgeId = capturedBadgeId else {
            transition(to: .lockedIdle, error: SessionError.missingBadgeId)
            return
        }
        
        // Notify UI to show authenticating state
        transition(to: .authenticating)
        
        do {
            // Step 1: Validate badge with backend and get session token
            let startSessionResponse = try await BackendService.shared.startSession(
                badgeId: badgeId,
                deviceId: DeviceInfo.identifier,
                deviceSerial: DeviceInfo.serialNumber ?? "unknown"
            )
            
            // Check if badge is not enrolled - initiate enrollment flow
            if startSessionResponse.error?.code == "BADGE_NOT_ENROLLED" {
                await handleUnenrolledBadge(badgeId: badgeId)
                return
            }
            
            guard startSessionResponse.success,
                  let sessionToken = startSessionResponse.sessionToken,
                  let persona = startSessionResponse.persona,
                  let user = startSessionResponse.user else {
                
                let errorMessage = startSessionResponse.error?.message ?? "Unknown error"
                throw SessionError.authenticationFailed(errorMessage)
            }
            
            // Step 2: Authenticate using configured identity provider
            let credentials = AuthenticationCredentials(
                credentialType: .sessionToken,
                badgeId: badgeId,
                sessionToken: sessionToken,
                deviceId: DeviceInfo.identifier,
                mdmUserId: nil,
                mfaToken: nil,
                additionalData: nil
            )
            
            let authResult: AuthenticationResult
            if let provider = identityProvider {
                authResult = try await provider.authenticate(credentials: credentials, persona: persona)
            } else {
                // FLAGGED (get-it-building): OIDCAuthService returns OIDCTokenResult,
                // which is NOT adapted to AuthenticationResult here — assigning it was a
                // type error. Rather than guess the mapping, fail closed and require a
                // configured identity provider. TODO: add an OIDCTokenResult ->
                // AuthenticationResult adapter to restore this legacy fallback.
                throw SessionError.authenticationFailed("No identity provider configured")
            }
            
            // Create session data
            var session = SessionData(
                sessionId: UUID().uuidString,
                userId: user.userId,
                badgeId: badgeId,
                persona: persona,
                accessToken: authResult.accessToken,
                refreshToken: authResult.refreshToken,
                idToken: authResult.idToken,
                expiresAt: authResult.expiresAt
            )
            
            currentSession = session
            AuditLogger.shared.currentSessionId = session.sessionId

            // Transition to provisioning
            transition(to: .provisioning)
            
        } catch {
            // Check if this might be an unenrolled badge error
            if isUnenrolledBadgeError(error) {
                await handleUnenrolledBadge(badgeId: badgeId)
                return
            }
            
            AuditLogger.shared.log(event: .authenticationFailed, metadata: [
                "error": error.localizedDescription
            ])
            transition(to: .lockedIdle, error: error)
        }
    }
    
    /// Handle the case where a badge is not enrolled
    private func handleUnenrolledBadge(badgeId: String) async {
        AuditLogger.shared.log(event: .badgeNotEnrolled, metadata: [
            "badgeId": maskBadgeId(badgeId)
        ])
        
        // Transition to enrolling state to show enrollment UI
        transition(to: .enrolling)
        
        // Check enrollment status with backend
        do {
            let enrollmentResponse = try await BackendService.shared.checkBadgeEnrollment(
                badgeId: badgeId,
                deviceId: DeviceInfo.identifier,
                deviceSerial: DeviceInfo.serialNumber ?? "unknown"
            )
            
            if enrollmentResponse.isEnrolled {
                // Badge was enrolled, proceed to authentication
                await beginAuthentication()
            } else if enrollmentResponse.needsProvisioning {
                // Badge needs provisioning, continue with enrollment flow
                // The UI should show enrollment instructions
                // User would need to complete enrollment through another method
                // For now, return to locked idle with message
                transition(to: .lockedIdle, error: SessionError.enrollmentRequired)
            } else {
                // Cannot enroll badge
                transition(to: .lockedIdle, error: SessionError.enrollmentNotAvailable)
            }
            
        } catch {
            AuditLogger.shared.log(event: .badgeEnrollmentFailed, metadata: [
                "error": error.localizedDescription
            ])
            transition(to: .lockedIdle, error: error)
        }
    }
    
    /// Check if error indicates an unenrolled badge
    private func isUnenrolledBadgeError(_ error: Error) -> Bool {
        if let sessionError = error as? SessionError {
            switch sessionError {
            case .enrollmentRequired, .enrollmentNotAvailable:
                return true
            default:
                break
            }
        }
        
        let errorMessage = error.localizedDescription.lowercased()
        return errorMessage.contains("not enrolled") || 
               errorMessage.contains("enrollment") ||
               errorMessage.contains("badge not found")
    }
    
    /// Mask badge ID for privacy in logs
    private func maskBadgeId(_ badgeId: String) -> String {
        guard badgeId.count > 4 else {
            return "****"
        }
        let prefix = badgeId.prefix(2)
        let suffix = badgeId.suffix(2)
        return "\(prefix)****\(suffix)"
    }
    
    // MARK: - Session Provisioning
    
    private func provisionSession() async {
        guard var session = currentSession else {
            transition(to: .lockedIdle, error: SessionError.missingSession)
            return
        }
        
        do {
            // Apply persona-based configuration
            applyPersonaConfiguration(session.persona)
            
            // Launch required apps
            await launchRequiredApps(for: session.persona)
            
            // Save session to secure storage
            try KeychainService.shared.saveSession(session)
            
            // Transition to active session
            transition(to: .activeSession)
            
            AuditLogger.shared.log(event: .sessionStarted, metadata: [
                "sessionId": session.sessionId,
                "userId": session.userId,
                "persona": session.persona.roleName
            ])
            
        } catch {
            AuditLogger.shared.log(event: .sessionProvisioningFailed, metadata: [
                "error": error.localizedDescription
            ])
            transition(to: .lockedIdle, error: error)
        }
    }
    
    // MARK: - Persona Configuration
    
    private func applyPersonaConfiguration(_ persona: Persona) {
        // Apply restrictions
        applyRestrictions(persona.restrictions)
        
        // Apply theme
        applyTheme(persona.workspaceConfig.theme)
    }
    
    private func applyRestrictions(_ restrictions: SessionRestrictions) {
        // Configure Keychain access groups
        // Configure pasteboard restrictions
        // Configure screen capture settings
        
        // Store for reference during session
        UserDefaults.standard.set(restrictions.idleTimeout, forKey: "idle_timeout")
        UserDefaults.standard.set(restrictions.allowCopyPaste, forKey: "allow_copy_paste")
    }
    
    private func applyTheme(_ theme: ThemeConfig) {
        // Apply theme colors and configuration
        // This would update UI appearance
    }
    
    // MARK: - App Launching
    
    private func launchRequiredApps(for persona: Persona) async {
        let launcher = AppLauncher.shared
        
        for app in persona.appLaunchConfig.requiredApps {
            do {
                try await launcher.launchEnterpriseApp(app)
            } catch {
                AuditLogger.shared.log(event: .appLaunchFailed, metadata: [
                    "appId": app.appId,
                    "error": error.localizedDescription
                ])
                // Continue launching other apps
            }
        }
    }
    
    // MARK: - Session Termination
    
    private var isTerminating = false
    
    func endSession(userInitiated: Bool = false) {
        // Prevent concurrent termination attempts
        guard !isTerminating else { return }
        guard currentState == .activeSession else { return }
        
        isTerminating = true
        let reason: SessionEndReason = userInitiated ? .userInitiated : .timeout
        Task {
            await terminateSession(reason: reason)
            isTerminating = false
        }
    }
    
    private func terminateSession(reason: SessionEndReason) async {
        guard currentState != .terminating else { return }
        
        transition(to: .terminating)
        
        guard let session = currentSession else {
            transition(to: .lockedIdle)
            return
        }
        
        do {
            // Step 1: Revoke identity provider tokens
            if let accessToken = session.accessToken {
                if let provider = identityProvider {
                    try await provider.revokeAuthentication(token: accessToken)
                } else {
                    // Fallback to legacy OIDC
                    try await OIDCAuthService.shared.revokeToken(accessToken)
                }
            }
            
            // Step 2: Send audit logs to backend
            try await sendSessionAudit(session: session, reason: reason)
            
            // Step 3: Notify backend of session end
            try await BackendService.shared.endSession(
                sessionId: session.sessionId,
                reason: reason
            )
            
            // Step 4: Clear all local data
            clearLocalSessionData()
            
            // Transition to locked idle
            transition(to: .lockedIdle)
            
            AuditLogger.shared.log(event: .sessionEnded, metadata: [
                "sessionId": session.sessionId,
                "reason": reason.rawValue,
                "duration": String(-session.startedAt.timeIntervalSinceNow)
            ])
            
        } catch {
            AuditLogger.shared.log(event: .sessionTerminationError, metadata: [
                "error": error.localizedDescription
            ])
            // Still clear local data and return to locked state
            clearLocalSessionData()
            transition(to: .lockedIdle)
        }
    }
    
    // MARK: - Data Cleanup
    
    private func cleanupCurrentSession() {
        // Always clear session data when transitioning to lockedIdle
        // The guard was removed because by the time this is called,
        // currentState has already been changed to .lockedIdle
        
        // Stop any running timers to prevent memory leaks or unexpected callbacks
        stopActivityTimer()
        stopTimeoutTimer()
        
        clearLocalSessionData()
        
        // Perform comprehensive device cleanup for next user
        performDeviceCleanup()
    }
    
    private func clearLocalSessionData() {
        // Clear Keychain items
        KeychainService.shared.clearAllSessionData()
        
        // Clear UserDefaults session data
        clearUserDefaultsSessionData()
        
        // Clear any cached data
        clearCacheData()
        
        // Reset session data
        currentSession = nil
        AuditLogger.shared.currentSessionId = nil
        capturedBadgeId = nil
        lastError = nil
    }
    
    private func clearUserDefaultsSessionData() {
        let sessionKeys = [
            "current_session_id",
            "idle_timeout",
            "allow_copy_paste",
            "session_start_time",
            "user_persona",
            "user_display_name",
            "user_email"
        ]
        
        for key in sessionKeys {
            UserDefaults.standard.removeObject(forKey: key)
        }
    }
    
    private func clearCacheData() {
        // Clear URL cache completely
        let cache = URLCache.shared
        cache.removeAllCachedResponses()
        
        // Clear temporary directory
        clearTemporaryDirectory()
        
        // Clear any custom caches
        clearCustomCaches()
    }
    
    private func clearTemporaryDirectory() {
        let tempDir = FileManager.default.temporaryDirectory
        do {
            let tempContents = try FileManager.default.contentsOfDirectory(
                at: tempDir,
                includingPropertiesForKeys: nil
            )
            
            for file in tempContents {
                // Only remove files, not directories
                try? FileManager.default.removeItem(at: file)
            }
        } catch {
            AuditLogger.shared.log(event: .cacheCleanupError, metadata: [
                "error": "Failed to clear temp directory: \(error.localizedDescription)"
            ])
        }
    }
    
    private func clearCustomCaches() {
        // Clear any enterprise app-specific cached data
        let cacheDir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
        
        if let cacheDir = cacheDir {
            // Clear app cache but preserve system caches
            let allowedCacheFolders = ["com.enterprise.shell"]
            
            do {
                let contents = try FileManager.default.contentsOfDirectory(
                    at: cacheDir,
                    includingPropertiesForKeys: nil
                )
                
                for folder in contents {
                    if allowedCacheFolders.contains(folder.lastPathComponent) {
                        try FileManager.default.removeItem(at: folder)
                    }
                }
            } catch {
                // Cache cleanup failed, continue anyway
            }
        }
    }
    
    /// Comprehensive device cleanup for next user
    /// Ensures all traces of previous user are removed
    private func performDeviceCleanup() {
        // Reset badge reader state
        resetBadgeReaderState()
        
        // Clear any pending network requests
        cancelPendingRequests()
        
        // Reset device to ready state
        resetDeviceToReadyState()
        
        AuditLogger.shared.log(event: .deviceCleanupComplete, metadata: [
            "timestamp": ISO8601DateFormatter().string(from: Date())
        ])
    }
    
    private func resetBadgeReaderState() {
        // Reset badge reader buffer
        BadgeReaderManager.shared.resetReaderState()
        
        // Clear any pending badge reads
        capturedBadgeId = nil
    }
    
    private func cancelPendingRequests() {
        // Cancel any pending authentication or network requests
        // This is handled by URLSession automatically, but we can
        // invalidate sessions if needed
    }
    
    private func resetDeviceToReadyState() {
        // Ensure device is ready for next user
        // This may include:
        // - Resetting UI state
        // - Clearing any background tasks
        // - Ensuring all resources are freed
        
        // Post notification that device is ready for new session
        NotificationCenter.default.post(name: .deviceReadyForNewSession, object: nil)
    }
    
    private func sendSessionAudit(session: SessionData, reason: SessionEndReason) async throws {
        let duration = Date().timeIntervalSince(session.startedAt)
        let auditData = AuditData(
            sessionDuration: duration,
            actionsPerformed: [],
            resourcesAccessed: [],
            anyErrors: lastError != nil
        )
        
        try await BackendService.shared.sendAuditData(
            sessionId: session.sessionId,
            auditData: auditData
        )
    }
    
    // MARK: - Timeout Management
    
    private func startActivityTimer() {
        stopActivityTimer()
        
        activityTimer = Timer.scheduledTimer(withTimeInterval: 60.0, repeats: true) { [weak self] _ in
            self?.updateActivity()
        }
    }
    
    private func stopActivityTimer() {
        activityTimer?.invalidate()
        activityTimer = nil
    }
    
    private func updateActivity() {
        currentSession?.updateActivity()
        // Reset the timeout timer when user is active
        startTimeoutTimer()
    }
    
    private func startTimeoutTimer() {
        stopTimeoutTimer()
        
        let timeout = UserDefaults.standard.object(forKey: "idle_timeout") as? TimeInterval ?? 300.0
        
        timeoutTimer = Timer.scheduledTimer(withTimeInterval: timeout, repeats: false) { [weak self] _ in
            self?.handleSessionTimeout()
        }
    }
    
    private func stopTimeoutTimer() {
        timeoutTimer?.invalidate()
        timeoutTimer = nil
    }
    
    private func handleSessionTimeout() {
        AuditLogger.shared.log(event: .sessionTimeout, metadata: nil)
        endSession(userInitiated: false)
    }
    
    // MARK: - Session Validation
    
    func checkSessionTimeout() async {
        guard isSessionActive else { return }
        
        if let expiresAt = currentSession?.expiresAt,
           Date() >= expiresAt {
            AuditLogger.shared.log(event: .sessionTokenExpired, metadata: nil)
            endSession(userInitiated: false)
        }
    }
    
    func validateActiveSession() async {
        guard isSessionActive else { return }
        
        // Check if token needs refresh
        if let expiresAt = currentSession?.expiresAt,
           expiresAt.timeIntervalSinceNow < 300 {
            // Token expires in less than 5 minutes, refresh it
            do {
                try await OIDCAuthService.shared.refreshToken()
            } catch {
                AuditLogger.shared.log(event: .tokenRefreshFailed, metadata: [
                    "error": error.localizedDescription
                ])
                endSession(userInitiated: false)
            }
        }
    }
    
    // MARK: - View Controller Factory
    
    func currentViewController() -> UIViewController {
        viewController(for: currentState)
    }
    
    func viewController(for state: SessionState) -> UIViewController {
        switch state {
        case .lockedIdle:
            return LockedIdleViewController()
        case .badgeCaptured:
            // Guard against nil badge ID - should not happen in normal flow
            guard let badgeId = capturedBadgeId else {
                // Return to locked idle if no badge ID
                transition(to: .lockedIdle, error: SessionError.missingBadgeId)
                return LockedIdleViewController()
            }
            return BadgeCapturedViewController(badgeId: badgeId)
        case .authenticating:
            return AuthenticatingViewController()
        case .enrolling:
            return EnrollingViewController(badgeId: capturedBadgeId ?? "Unknown")
        case .provisioning:
            return ProvisioningViewController()
        case .activeSession:
            return ActiveSessionViewController()
        case .terminating:
            return TerminatingViewController()
        }
    }
    
    // MARK: - Persistence
    
    private func loadPersistedState() {
        // Check for any persisted session state on launch
        // For security, we start in lockedIdle state
        currentState = .lockedIdle
    }
    
    // MARK: - Helpers
    
    /// Handle badge tap from hardware reader - clears session if active and starts new auth
    func handleBadgeTap(_ badgeId: String) {
        // If there's an active session, clear it first
        if currentState == .activeSession {
            AuditLogger.shared.log(event: .badgeTapDuringActiveSession, metadata: [
                "previousSessionId": currentSessionId ?? "none",
                "newBadgeId": maskBadgeId(badgeId)
            ])
            
            // Immediately clear all session data and transition to locked idle
            // This ensures clean state for new badge authentication
            clearLocalSessionData()
            
            // Stop any running timers
            stopActivityTimer()
            stopTimeoutTimer()
            
            // Transition to locked idle state (ready for new badge authentication)
            transition(to: .lockedIdle)
            
            // Start authentication process with new badge
            capturedBadgeId = badgeId
            transition(to: .authenticating)
        } else {
            // No active session - start new authentication
            capturedBadgeId = badgeId
            transition(to: .authenticating)
        }
    }
    
    private func handleError(_ error: Error) {
        DispatchQueue.main.async {
            self.lastError = error
            AuditLogger.shared.log(event: .error, metadata: [
                "error": error.localizedDescription
            ])
        }
    }
    
    // MARK: - BadgeReaderManagerDelegate
    
    func badgeReader(_ manager: BadgeReaderManager, didReadBadge badgeId: String) {
        // Handle badge read event from hardware reader
        DispatchQueue.main.async { [weak self] in
            self?.handleBadgeTap(badgeId)
        }
    }
    
    func badgeReader(_ manager: BadgeReaderManager, didFailWithError error: Error) {
        AuditLogger.shared.log(event: .badgeReaderError, metadata: [
            "error": error.localizedDescription
        ])
    }
    
    func badgeReaderDidDisconnect(_ manager: BadgeReaderManager) {
        AuditLogger.shared.log(event: .badgeReaderDisconnected, metadata: nil)
    }

    // MARK: - BadgeReaderProviderDelegate

    func badgeReader(_ provider: BadgeReaderProvider, didReadBadge badgeId: String) {
        DispatchQueue.main.async { [weak self] in
            self?.handleBadgeTap(badgeId)
        }
    }

    func badgeReader(_ provider: BadgeReaderProvider, didFailWithError error: Error) {
        AuditLogger.shared.log(event: .badgeReaderError, metadata: [
            "error": error.localizedDescription
        ])
    }

    func badgeReaderDidDisconnect(_ provider: BadgeReaderProvider) {
        AuditLogger.shared.log(event: .badgeReaderDisconnected, metadata: nil)
    }

    func badgeReaderDidConnect(_ provider: BadgeReaderProvider) {
        AuditLogger.shared.log(event: .badgeReaderConnected, metadata: nil)
    }
}

// MARK: - Session Errors

enum SessionError: LocalizedError {
    case invalidStateTransition(from: SessionState, to: SessionState)
    case missingBadgeId
    case authenticationFailed(String)
    case missingSession
    case tokenRefreshFailed
    case enrollmentRequired
    case enrollmentNotAvailable
    case invalidBadgeFormat
    case rateLimited
    case securityViolation(String)
    
    var errorDescription: String? {
        switch self {
        case .invalidStateTransition(let from, let to):
            return "Invalid state transition from \(from.rawValue) to \(to.rawValue)"
        case .missingBadgeId:
            return "Badge ID is missing"
        case .authenticationFailed(let message):
            return "Authentication failed: \(message)"
        case .missingSession:
            return "Session data is missing"
        case .tokenRefreshFailed:
            return "Failed to refresh authentication token"
        case .enrollmentRequired:
            return "Badge is not enrolled. Please contact your administrator to enroll your badge."
        case .enrollmentNotAvailable:
            return "Badge enrollment is not available. Please contact your administrator."
        case .invalidBadgeFormat:
            return "Invalid badge format detected"
        case .rateLimited:
            return "Too many attempts. Please try again later."
        case .securityViolation(let reason):
            return "Security violation: \(reason)"
        }
    }
}
