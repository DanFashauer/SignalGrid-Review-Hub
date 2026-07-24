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
        case badgeReaderProviderStateChange
        case badgeReaderProviderError
        case badgeReaderDidConnect
        case badgeReaderDidDisconnect

        // Session state (observed by SceneDelegate)
        case sessionStateChanged
    }

    // MARK: - Properties
    
    private var eventQueue: [AuditLogEntry] = []
    private let queue = DispatchQueue(label: "com.enterprise.shell.audit")
    private var batchTimer: Timer?
    private let batchSize = 50
    private let batchInterval: TimeInterval = 30
    
    // Backend URL for audit logs
    private var auditEndpoint: URL? {
        URL(string: "\(BackendService.baseUrl)/api/audit/logs")
    }
    
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
            sessionId: SessionStateManager.shared.currentSessionId,
            metadata: metadata ?? [:]
        )
        
        queue.async { [weak self] in
            self?.eventQueue.append(entry)
            self?.checkBatchFlush()
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
    
    /// Flush queued logs to backend
    func flushLogs() {
        queue.async { [weak self] in
            guard let self = self, !self.eventQueue.isEmpty else { return }
            
            let logsToSend = self.eventQueue
            self.eventQueue.removeAll()
            
            self.uploadLogs(logsToSend)
        }
    }
    
    private func uploadLogs(_ logs: [AuditLogEntry]) {
        guard let endpoint = auditEndpoint else { return }
        
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        do {
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            request.httpBody = try encoder.encode(logs)
        } catch {
            print("Failed to encode audit logs: \(error)")
            // Store logs locally for later retry
            storeLocally(logs)
            return
        }
        
        // Use shared URLSession for upload
        let task = URLSession.shared.dataTask(with: request) { [weak self] _, response, error in
            if let error = error {
                print("Failed to upload audit logs: \(error)")
                // Store locally for retry later
                self?.storeLocally(logs)
            } else if let httpResponse = response as? HTTPURLResponse,
                      (200...299).contains(httpResponse.statusCode) {
                // Successfully uploaded
            } else {
                // Failed, re-queue
                self?.queue.async {
                    self?.eventQueue.insert(contentsOf: logs, at: 0)
                }
            }
        }
        task.resume()
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
