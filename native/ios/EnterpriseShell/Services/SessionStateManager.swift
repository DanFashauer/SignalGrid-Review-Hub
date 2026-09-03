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
    
    /// A badge tapped DURING an active session, held until the full teardown reaches
    /// .lockedIdle and then replayed as a fresh authentication (see handleBadgeTap).
    private var pendingReplayBadgeId: String?
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
    
    /// Transition to a new state with validation.
    ///
    /// MAIN-CONFINED (review finding): every reader of this state machine —
    /// session UI, badge callbacks, timers, `isSessionActive` — runs on the main
    /// thread, while transitions used to mutate the same @Published properties and
    /// run entry/cleanup actions on a private GCD queue with no synchronization. A
    /// badge or timeout arriving mid-transition could observe stale state,
    /// overwrite the badge being authenticated, or validate against a state that
    /// had already changed. Serializing transitions on the MAIN queue puts writers
    /// on the same serial executor as every reader: ordering is preserved (async
    /// enqueue, exactly as before), and cross-thread interleaving is gone.
    func transition(to newState: SessionState, error: Error? = nil) {
        DispatchQueue.main.async { [weak self] in
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
            // Kiosk-lock the idle shared device until someone authenticates.
            KioskController.shared.enforceLock()
            // Replay a badge that arrived during the previous session, AFTER the full
            // teardown completed and the cleanup above ran — so the new authentication
            // starts from a clean state and its badge id is not erased by this entry.
            if let replay = pendingReplayBadgeId {
                pendingReplayBadgeId = nil
                AuditLogger.shared.log(event: .badgeTapDuringActiveSession, metadata: [
                    "newBadgeId": maskBadgeId(replay),
                    "stage": "replayed_after_teardown"
                ])
                capturedBadgeId = replay
                transition(to: .authenticating)
            }

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
            // Authenticated → release the kiosk so the device is usable normally
            // (still constrained to admin-configured apps/policy via MDM).
            KioskController.shared.releaseLock(reason: "authenticated_session")

        case .terminating:
            // Begin session teardown
            Task {
                await terminateSession(reason: .userInitiated)
            }
        }
    }
    
    // MARK: - Badge Handling
    
    /// Called when a badge is scanned (from BadgeReaderProviderDelegate)
    /// Format + rate-limit/lockout gates shared by EVERY badge entry point (the
    /// validated scan path AND the hardware-reader callbacks). Logs the reason and
    /// returns the SessionError to fail with, or nil if the badge passes. Keeping
    /// this in one place is the point: a reader callback must not be able to reach
    /// authentication without the same checks the simulator path enforces.
    private func badgeRejection(_ badgeId: String) -> SessionError? {
        // SECURITY: Validate badge ID format before processing
        let validationResult = SecurityManager.shared.validateBadgeId(badgeId)
        if !validationResult.valid {
            AuditLogger.shared.log(event: .securitySuspiciousBadge, metadata: [
                "badgeId": maskBadgeId(badgeId),
                "reason": validationResult.error ?? "invalid_format"
            ])
            return SessionError.invalidBadgeFormat
        }
        // SECURITY: Check rate limiting / lockout before processing
        let rateLimitResult = SecurityManager.shared.isBadgeScanAllowed(badgeId: badgeId)
        if !rateLimitResult.allowed {
            AuditLogger.shared.log(event: .securityRateLimitExceeded, metadata: [
                "badgeId": maskBadgeId(badgeId),
                "reason": rateLimitResult.reason ?? "rate_limit_exceeded"
            ])
            return SessionError.rateLimited
        }
        return nil
    }

    func onBadgeScanned(_ badgeId: String) {
        guard currentState == .lockedIdle else {
            AuditLogger.shared.log(event: .badgeScannedUnexpectedState, metadata: [
                "badgeId": maskBadgeId(badgeId),
                "currentState": currentState.rawValue
            ])
            return
        }

        if let rejection = badgeRejection(badgeId) {
            // Surface the ACTUAL rejection (review finding): this path only runs
            // while lockedIdle, and lockedIdle → lockedIdle is not a legal
            // transition — so transition(to:error:) surfaced a generic
            // invalidStateTransition instead of the format/lockout error.
            handleError(rejection)
            return
        }

        capturedBadgeId = badgeId
        
        AuditLogger.shared.log(event: .badgeScanned, metadata: [
            "badgeId": maskBadgeId(badgeId)
        ])
        
        // Transition to badge captured state
        transition(to: .badgeCaptured)
    }

    /// Manual override login — an alternative to a badge, gated by org opt-in
    /// (`KioskConfig.allowManualOverride`). The admin recovery code has already
    /// authorized it, so it skips badge-format validation and starts a REAL
    /// authenticated session (not just a kiosk release): it flows badgeCaptured →
    /// authenticating → provisioning → activeSession, and the kiosk-until-auth
    /// lifecycle unlocks the device on activeSession (re-locking when it ends).
    func beginManualOverrideLogin() {
        // Re-checked HERE, not only at the button: the admin-code path (managed
        // opt-in) or the local-toggle path (unmanaged, toggle on, no kiosk active).
        guard KioskConfig.manualLoginAvailable else { return }
        guard currentState == .lockedIdle else { return }
        AuditLogger.shared.log(event: .authenticationStarted, metadata: [
            "method": KioskConfig.allowManualOverride ? "manual_override" : "local_session_toggle"
        ])
        capturedBadgeId = "MANUAL-OVERRIDE"
        transition(to: .badgeCaptured)
    }

    // MARK: - Authentication Flow
    
    private func beginAuthentication() async {
        guard let badgeId = capturedBadgeId else {
            transition(to: .lockedIdle, error: SessionError.missingBadgeId)
            return
        }
        
        // No self-transition here (review finding): every normal path reaches this
        // method FROM enterState(.authenticating), so requesting .authenticating
        // again violated the state table and polluted lastError with a spurious
        // invalidStateTransition on every successful badge login. The UI already
        // observed the state change that got us here; start the backend work.
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
            
            // Step 2: Authenticate using configured identity provider. The stated
            // expiry travels with the credentials so the control-plane session
            // provider can refuse a session that never said when it ends.
            let credentials = AuthenticationCredentials(
                credentialType: .sessionToken,
                badgeId: badgeId,
                sessionToken: sessionToken,
                deviceId: DeviceInfo.identifier,
                mdmUserId: nil,
                mfaToken: nil,
                additionalData: startSessionResponse.expiresAt.map { ["expiresAt": ISO8601Wire.string($0)] }
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
            
            // Create session data. The id is the CONTROL PLANE's session id when it
            // minted one: `sessions/{id}/end` and `/refresh` are keyed by it, and a
            // locally minted UUID answered 404 on both.
            var session = SessionData(
                sessionId: startSessionResponse.controlPlaneSessionId ?? sessionToken,
                userId: user.userId,
                badgeId: badgeId,
                persona: persona,
                accessToken: authResult.accessToken,
                refreshToken: authResult.refreshToken,
                idToken: authResult.idToken,
                expiry: authResult.expiry
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
                // Stay on the enrollment screen so the user can read the guidance and
                // choose "Try Another Badge" or "Contact Administrator". Previously this
                // bounced straight back to lockedIdle, flashing the screen away before it
                // could be read. The EnrollingViewController's own actions drive next steps.
                AuditLogger.shared.log(event: .badgeEnrollmentStarted, metadata: [
                    "badgeId": maskBadgeId(badgeId),
                    "instructions": enrollmentResponse.enrollmentInstructions ?? ""
                ])
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
            
            // Save session to secure storage. In an UNSIGNED simulator build the
            // keychain has no entitlement and returns errSecMissingEntitlement (-34018);
            // don't let that abort the demo lifecycle (real/signed builds persist normally).
            #if targetEnvironment(simulator)
            if DemoMode.isEnabled {
                try? KeychainService.shared.saveSession(session)
            } else {
                try KeychainService.shared.saveSession(session)
            }
            #else
            try KeychainService.shared.saveSession(session)
            #endif
            
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
        let config = persona.appLaunchConfig
        let autoIds = Set(config.autoLaunchApps)

        // Only auto-launch apps explicitly flagged in autoLaunchApps; the rest appear
        // on the home page for the user to open. Previously this opened EVERY required
        // app on provisioning, immediately switching away from the configured workspace.
        let toLaunch = (config.requiredApps + config.optionalApps).filter { autoIds.contains($0.appId) }
        for app in toLaunch {
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

        // Wipe local secrets BEFORE the first await (review finding): `session` is a
        // value copy carrying everything the remote teardown needs, so nothing
        // requires the live tokens to stay resident. Previously the terminating
        // shared-device session kept its access/refresh tokens in memory and
        // Keychain until every network call finished — indefinitely if one stalled —
        // and killing the process mid-wait bypassed both cleanup paths. Clearing
        // first bounds the exposure to nothing; the requests below run from copies.
        clearLocalSessionData()

        do {
            // Step 1: Revoke identity provider tokens (from the captured copy)
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

            // Transition to locked idle (local data already cleared above)
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
            // Local data was already wiped before the first await; just return to
            // the locked state (the wipe is idempotent, remote failure changes nothing).
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

        // Wipe the system pasteboard so one user's copied data (a chart value, an
        // order number) can't be pasted by the NEXT user of this shared device.
        UIPasteboard.general.items = []
        AuditLogger.shared.log(event: .pasteboardCleared, metadata: nil)

        AuditLogger.shared.log(event: .deviceCleanupComplete, metadata: [
            "timestamp": ISO8601DateFormatter().string(from: Date())
        ])
    }
    
    private func resetBadgeReaderState() {
        // Reset the CONFIGURED reader's buffer (and the legacy manager's, harmlessly)
        badgeReaderProvider?.resetReaderState()
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

        // Schedule on the MAIN run loop (review finding): Timer.scheduledTimer
        // attaches to the CURRENT thread's run loop, and callers may arrive from a
        // background context — a run-loop-less thread would mean the timer never
        // fires and the shared-device session never idles out. Main-queue
        // scheduling guarantees a running run loop (transitions are themselves
        // main-confined now, so this also keeps timer state with the machine).
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.activityTimer = Timer.scheduledTimer(withTimeInterval: 60.0, repeats: true) { [weak self] _ in
                self?.heartbeatTick()
            }
        }
    }
    
    private func stopActivityTimer() {
        // Timers are scheduled on the main run loop; invalidate there too (a Timer
        // must be invalidated from the thread it was scheduled on).
        DispatchQueue.main.async { [weak self] in
            self?.activityTimer?.invalidate()
            self?.activityTimer = nil
        }
    }
    
    /// The 60-second heartbeat. Housekeeping ONLY (review finding): it must never
    /// touch the activity record or reset the idle timeout — the previous version
    /// called updateActivity() + startTimeoutTimer() on every tick, so the idle
    /// timeout was pushed back every 60s forever and an abandoned shared device
    /// never locked. Real user interaction resets the timeout via userDidInteract()
    /// (wired to actual touches in SessionWindow); the heartbeat only checks the
    /// server-side expiry.
    private func heartbeatTick() {
        Task { await self.checkSessionTimeout() }
    }

    private func startTimeoutTimer() {
        let timeout = UserDefaults.standard.object(forKey: "idle_timeout") as? TimeInterval ?? 300.0

        // Main run loop, same reasoning as startActivityTimer: this is reached from
        // the private state queue AND from userDidInteract (any thread); a timer
        // scheduled on a run-loop-less GCD worker never fires, which here means the
        // idle timeout silently never expires (review finding).
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.timeoutTimer?.invalidate()
            self.timeoutTimer = Timer.scheduledTimer(withTimeInterval: timeout, repeats: false) { [weak self] _ in
                self?.handleSessionTimeout()
            }
        }
    }
    
    private func stopTimeoutTimer() {
        DispatchQueue.main.async { [weak self] in
            self?.timeoutTimer?.invalidate()
            self?.timeoutTimer = nil
        }
    }
    
    private func handleSessionTimeout() {
        AuditLogger.shared.log(event: .sessionTimeout, metadata: nil)
        endSession(userInitiated: false)
    }

    /// Reset the inactivity timeout in response to genuine user interaction.
    /// The 60s activity heartbeat deliberately does NOT call this — otherwise the
    /// session could never idle-out. Wired to real touches via SessionWindow.
    func userDidInteract() {
        guard currentState == .activeSession else { return }
        startTimeoutTimer()
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
            // Token expires in less than 5 minutes: refresh through the CONFIGURED
            // identity provider (this used to call the legacy OIDCAuthService,
            // whose placeholder tenant endpoint could not even form a URL).
            do {
                _ = try await refreshActiveSession()
            } catch {
                AuditLogger.shared.log(event: .tokenRefreshFailed, metadata: [
                    "error": error.localizedDescription
                ])
                endSession(userInitiated: false)
            }
        }
    }

    /// Refresh the active session through the CONFIGURED identity provider and
    /// report what actually happened. Returns the new expiry when the provider
    /// states one (nil means "validated, no new expiry stated"). Throws when there
    /// is no provider, the provider cannot refresh, or the backend refused — the
    /// caller shows THAT, never a canned success.
    func refreshActiveSession() async throws -> Date? {
        guard isSessionActive else { throw SessionError.missingSession }
        guard let provider = identityProvider else { throw SessionError.tokenRefreshFailed }
        do {
            try await provider.refreshToken()
        } catch {
            AuditLogger.shared.log(event: .sessionRefreshFailed, metadata: [
                "provider": provider.displayName,
                "error": error.localizedDescription
            ])
            throw error
        }
        let newExpiry = (provider as? ControlPlaneSessionIdentityProvider)?.expiresAt
        if let newExpiry = newExpiry {
            await MainActor.run { self.applyRefreshedExpiry(newExpiry) }
        }
        AuditLogger.shared.log(event: .sessionRefreshed, metadata: [
            "provider": provider.displayName,
            "expiresAt": newExpiry.map(ISO8601Wire.string) ?? "unchanged"
        ])
        return newExpiry
    }

    /// Replace the session's expiry after a successful refresh (SessionData's
    /// fields are immutable by design; a refreshed session is a new value).
    private func applyRefreshedExpiry(_ date: Date) {
        guard let s = currentSession else { return }
        currentSession = SessionData(
            sessionId: s.sessionId,
            userId: s.userId,
            badgeId: s.badgeId,
            persona: s.persona,
            accessToken: s.accessToken,
            refreshToken: s.refreshToken,
            idToken: s.idToken,
            expiry: .expiresAt(date),
            startedAt: s.startedAt,
            lastActivityAt: s.lastActivityAt,
            isActive: s.isActive
        )
    }
    
    // MARK: - View Controller Factory
    
    func currentViewController() -> UIViewController {
        viewController(for: currentState)
    }
    
    func viewController(for state: SessionState) -> UIViewController {
        switch state {
        case .lockedIdle:
            return LockedIdleView.hostingController()
        case .badgeCaptured:
            // Fail-closed guard the UIKit init(badgeId:) relied on, PRESERVED across
            // the SwiftUI swap: .badgeCaptured with no captured badge cannot happen in
            // normal flow, and if it does we return to lockedIdle rather than render a
            // masked-empty badge and auto-advance. BadgeCapturedView reads capturedBadgeId
            // itself, so the id is not threaded through — but dropping this guard would
            // silently delete the missing-badge path, with no diff in the view to show it.
            guard capturedBadgeId != nil else {
                transition(to: .lockedIdle, error: SessionError.missingBadgeId)
                return LockedIdleView.hostingController()
            }
            return BadgeCapturedView.hostingController()
        case .authenticating:
            return AuthenticatingView.hostingController()
        case .enrolling:
            return EnrollingView.hostingController()
        case .provisioning:
            return ProvisioningView.hostingController()
        case .activeSession:
            return ActiveSessionView.hostingController()
        case .terminating:
            return TerminatingView.hostingController()
        }
    }
    
    // MARK: - Persistence
    
    private func loadPersistedState() {
        // Check for any persisted session state on launch
        // For security, we start in lockedIdle state
        currentState = .lockedIdle
        // Cold-start hygiene (review finding): if the app was killed or crashed
        // mid-session, the prior holder's tokens are still in the Keychain and
        // UserDefaults — starting lockedIdle in MEMORY alone leaves them to survive
        // into the next holder's process. Synchronously run the same local wipe
        // normal termination performs so nothing outlives the process that earned it.
        clearLocalSessionData()
    }
    
    // MARK: - Helpers
    
    /// Handle badge tap from hardware reader - clears session if active and starts new auth
    func handleBadgeTap(_ badgeId: String) {
        // SECURITY: gate every hardware-reader callback with the SAME format +
        // lockout checks as the validated scan path. Without this, the default
        // keyboard-wedge / webhook / legacy-accessory readers reach authentication
        // with malformed values and unlimited repeated scans.
        if let rejection = badgeRejection(badgeId) {
            // A rejected scan never advances to authentication — and never disturbs
            // work in flight. An active session stays intact, and an in-progress
            // authentication/provisioning is NOT torn down (review finding: queueing
            // .lockedIdle here raced the in-flight task, which could still assign
            // currentSession or persist the session to Keychain and then fail its
            // own transition — leaving credential-bearing session data behind the
            // idle UI). Only when the device is already idle is the rejection
            // surfaced to the holder — directly via handleError, because
            // lockedIdle → lockedIdle is not a legal transition and the old
            // transition(to:error:) call surfaced invalidStateTransition instead
            // of the actual rejection.
            if currentState == .lockedIdle {
                handleError(rejection)
            } else {
                AuditLogger.shared.log(event: .securitySuspiciousBadge, metadata: [
                    "badgeId": maskBadgeId(badgeId),
                    "stage": "rejected_scan_ignored_during_\(currentState.rawValue)"
                ])
            }
            return
        }

        // If there's an active session, finish it PROPERLY first (review finding):
        // the old shortcut cleared local data and queued .lockedIdle directly, which
        // skipped token revocation, the session audit upload, and
        // BackendService.endSession — and its capturedBadgeId assignment was erased
        // by the queued lockedIdle entry before the queued authentication ran,
        // failing the replacement auth with missingBadgeId. Defer the badge, run the
        // normal end-of-session teardown, and replay the badge when the machine
        // actually reaches .lockedIdle (see enterState).
        if currentState == .activeSession {
            AuditLogger.shared.log(event: .badgeTapDuringActiveSession, metadata: [
                "previousSessionId": currentSessionId ?? "none",
                "newBadgeId": maskBadgeId(badgeId),
                "stage": "deferred_until_teardown"
            ])
            pendingReplayBadgeId = badgeId
            endSession(userInitiated: true)
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
