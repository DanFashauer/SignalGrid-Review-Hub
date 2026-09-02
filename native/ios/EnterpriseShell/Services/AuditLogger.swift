import Foundation

/// Service for audit logging and event tracking
final class AuditLogger {
    
    // MARK: - Singleton
    
    static let shared = AuditLogger()
    
    // MARK: - Event Types
    
    enum AuditEvent: String {
        // App lifecycle
        case appLaunched
        case appEnteredBackground
        case appEnteredForeground
        case sceneConnected
        case sceneDisconnected
        case sceneWillResignActive
        
        // Session lifecycle
        case badgeScanned
        case badgeScannedUnexpectedState
        case badgeReaderConnected
        case badgeReaderDisconnected
        case authenticationStarted
        case authenticationFailed
        case authenticationSucceeded
        case stateTransition
        case sessionStarted
        case sessionEnded
        case sessionTimeout
        case sessionTokenExpired
        case tokenRefreshFailed
        case sessionProvisioningFailed
        case sessionTerminationError
        case appLaunchFailed
        
        // Badge reader
        case badgeTapDuringActiveSession
        case badgeReaderError
        
        // Errors
        case error
        case auditUploadFailed
        case auditUploaded
        /// Session audit recorded on the device because the server has no ingest route.
        case auditKeptLocal
        /// The bounded in-memory queue dropped its oldest entries (count in metadata).
        case auditQueueOverflow
        
        // MDM
        case mdmConfigurationReceived
        case mdmPolicyApplied
        
        // Device cleanup
        case deviceCleanupComplete
        case badgeReaderReset
        case cacheCleanupError
        
        // Badge enrollment
        case badgeNotEnrolled
        case badgeEnrollmentStarted
        case badgeEnrollmentCompleted
        case badgeEnrollmentFailed
        
        // Security events
        case securityLockout
        case securityRateLimitExceeded
        case securityFailedAttempt
        case securitySuspiciousBadge
        case securityRequestExpired
        case securityTokenBindingFailed
        case securityDeviceBindingRejected
        case securitySessionBindingRejected
        case securityInvalidSignature
        case securityDeviceCompromised
        
        // Provider events
        case providersInitialized
        case providerConfigurationLoaded
        case providerConfigurationUpdated
        case badgeReceived
        case badgeReaderProviderInitialized
        case badgeReaderDidConnect
        case badgeReaderDidDisconnect
        case badgeReaderProviderError
        case badgeReaderProviderStateChange
        /// A reader type is declared in configuration but has no provider in this build.
        case badgeReaderProviderUnavailable
        case sessionStateChanged
        case sessionRefreshed
        case sessionRefreshFailed
        /// One deterministic row per lock-screen appearance, with the exact inputs
        /// that decide Manual login — greppable from the unified log (os_log,
        /// subsystem com.enterprise.shell) by scripts/mac/ios-shell-repair.sh.
        case lockScreenPresented

        // Embedded Assist gate (app-workflows Assist model)
        case assistActionEvaluated
        case assistActionAuto
        case assistStepUpRequested
        case assistStepUpSatisfied
        case assistStepUpFailed
        case assistActionAwaitingConfirmation
        case assistActionConfirmed
        case assistActionApplied
        case assistActionBlocked

        // Data-protection / anti-tamper
        case screenshotDetected
        case screenRecordingStarted
        case screenRecordingStopped
        case pasteboardCleared

        // Kiosk lock (Autonomous Single App Mode)
        case kioskLockEngaged
        case kioskLockFailed
        case kioskUnlocked
        case kioskRecoveryOverride
        case kioskRecoveryDenied
    }

    // MARK: - Properties

    /// Current session id, PUSHED here by SessionStateManager on session start/end.
    /// The logger must not PULL from SessionStateManager.shared — doing so during
    /// singleton init re-enters that still-initializing singleton and deadlocks.
    var currentSessionId: String?

    // LOCAL ONLY. The served control plane has NO audit-ingest route (checked
    // 2026-09-02 against artifacts/api-server/src/routes/v1.ts — `/v1/audit` is a
    // GET; `/api/audit/logs` never existed). The previous version POSTed there
    // every 30 s, and on any non-2xx re-queued the batch at the FRONT of the
    // queue, forever: an unbounded queue that grew for the life of the process
    // against a route that could never answer. Now: a bounded in-memory queue
    // (cap `maxQueued`, drop-oldest, counted), flushed to the on-device file
    // (itself bounded) — never to the network, never re-queued.
    private var eventQueue: [AuditLogEntry] = []
    private let queue = DispatchQueue(label: "com.enterprise.shell.audit")
    private var batchTimer: Timer?
    private let batchSize = 50
    private let batchInterval: TimeInterval = 30
    private let maxQueued = 500
    /// Entries dropped from the in-memory queue since launch. Reported, so a
    /// silent loss is impossible; never reset.
    private(set) var droppedCount = 0
    
    // MARK: - Initialization
    
    private init() {
        startBatchTimer()
    }
    
    deinit {
        batchTimer?.invalidate()
        flushLogs()
    }
    
    // MARK: - Logging
    
    /// Log an audit event
    func log(event: AuditEvent, metadata: [String: String]?) {
        let entry = AuditLogEntry(
            id: UUID().uuidString,
            timestamp: Date(),
            eventType: event.rawValue,
            deviceId: DeviceInfo.identifier,
            deviceSerial: DeviceInfo.serialNumber ?? "unknown",
            sessionId: currentSessionId,
            metadata: metadata ?? [:]
        )
        
        queue.async { [weak self] in
            guard let self = self else { return }
            self.eventQueue.append(entry)
            if self.eventQueue.count > self.maxQueued {
                let overflow = self.eventQueue.count - self.maxQueued
                self.eventQueue.removeFirst(overflow)
                self.droppedCount += overflow
                // One overflow row per breach, appended AFTER the trim so it is kept.
                self.eventQueue.append(AuditLogEntry(
                    id: UUID().uuidString,
                    timestamp: Date(),
                    eventType: AuditEvent.auditQueueOverflow.rawValue,
                    deviceId: entry.deviceId,
                    deviceSerial: entry.deviceSerial,
                    sessionId: self.currentSessionId,
                    metadata: ["droppedNow": String(overflow), "droppedTotal": String(self.droppedCount)]
                ))
            }
            self.checkBatchFlush()
        }
    }
    
    /// Log an event with custom metadata
    func log(
        event: AuditEvent,
        sessionId: String? = nil,
        metadata: [String: String]? = nil
    ) {
        log(event: event, metadata: metadata)
    }
    
    // MARK: - Batch Processing
    
    private func startBatchTimer() {
        batchTimer = Timer.scheduledTimer(withTimeInterval: batchInterval, repeats: true) { [weak self] _ in
            self?.flushLogs()
        }
    }
    
    private func checkBatchFlush() {
        guard eventQueue.count >= batchSize else { return }
        flushLogs()
    }
    
    /// Flush queued entries to the on-device audit file. No network: the server
    /// has no ingest route today. When one exists, THIS is the place to add the
    /// upload — and it must still never re-queue forever.
    func flushLogs() {
        queue.async { [weak self] in
            guard let self = self, !self.eventQueue.isEmpty else { return }
            
            let logsToPersist = self.eventQueue
            self.eventQueue.removeAll()
            
            self.storeLocally(logsToPersist)
        }
    }
    
    // MARK: - Local Storage for Offline
    
    private var localStorageURL: URL? {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first?.appendingPathComponent("audit_logs.json")
    }
    
    /// Store logs locally when offline using file-based persistence
    private func storeLocally(_ logs: [AuditLogEntry]) {
        guard let url = localStorageURL else { return }
        
        do {
            // Load existing logs
            var storedLogs = retrieveStoredLogs()
            
            // Append new logs (limit to last 1000 to prevent unbounded growth)
            storedLogs.append(contentsOf: logs)
            if storedLogs.count > 1000 {
                storedLogs = Array(storedLogs.suffix(1000))
            }
            
            // Encode and save with file protection
            let data = try JSONEncoder().encode(storedLogs)
            try data.write(to: url, options: .completeFileProtection)
        } catch {
            print("Failed to store audit logs locally: \(error)")
        }
    }
    
    /// Retrieve stored logs from local storage
    func retrieveStoredLogs() -> [AuditLogEntry] {
        guard let url = localStorageURL,
              FileManager.default.fileExists(atPath: url.path) else {
            return []
        }
        
        do {
            let data = try Data(contentsOf: url)
            return try JSONDecoder().decode([AuditLogEntry].self, from: data)
        } catch {
            print("Failed to retrieve stored audit logs: \(error)")
            return []
        }
    }
    
    /// Clear stored logs (called after successful upload)
    func clearStoredLogs() {
        guard let url = localStorageURL else { return }
        try? FileManager.default.removeItem(at: url)
    }
    
    // MARK: - Convenience Methods
    
    /// Log session start
    func logSessionStart(sessionId: String, userId: String, persona: String) {
        log(event: .sessionStarted, metadata: [
            "sessionId": sessionId,
            "userId": userId,
            "persona": persona
        ])
    }
    
    /// Log session end
    func logSessionEnd(sessionId: String, reason: String, duration: TimeInterval) {
        log(event: .sessionEnded, metadata: [
            "sessionId": sessionId,
            "reason": reason,
            "duration": String(duration)
        ])
    }
    
    /// Log authentication failure (badge ID is masked for privacy)
    func logAuthFailure(reason: String, badgeId: String) {
        log(event: .authenticationFailed, metadata: [
            "reason": reason,
            "badgeId": SecurityManager.shared.maskBadgeId(badgeId)
        ])
    }
}

// MARK: - Audit Log Entry

struct AuditLogEntry: Codable {
    let id: String
    let timestamp: Date
    let eventType: String
    let deviceId: String
    let deviceSerial: String
    let sessionId: String?
    var metadata: [String: String]
    
    enum CodingKeys: String, CodingKey {
        case id
        case timestamp
        case eventType = "event_type"
        case deviceId = "device_id"
        case deviceSerial = "device_serial"
        case sessionId = "session_id"
        case metadata
    }
}

// MARK: - Audit Log Batch

struct AuditLogBatch: Codable {
    let batchId: String
    let deviceId: String
    let logs: [AuditLogEntry]
}
