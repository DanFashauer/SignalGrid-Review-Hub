import Foundation
import CommonCrypto

/// Service for security-related functionality including rate limiting, validation, and request signing
final class SecurityManager {
    
    // MARK: - Singleton
    
    static let shared = SecurityManager()
    
    // MARK: - Configuration
    
    struct SecurityConfig {
        // Rate limiting
        var maxBadgeAttemptsPerMinute: Int = 5
        var maxAuthAttemptsPerMinute: Int = 3
        var lockoutDuration: TimeInterval = 300 // 5 minutes
        
        // Badge validation
        var minBadgeLength: Int = 4
        var maxBadgeLength: Int = 32
        var requireAlphanumericBadge: Bool = true
        
        // Request signing
        var signingAlgorithm: String = "HMAC-SHA256"
        var requestTimeout: TimeInterval = 30
    }
    
    // MARK: - Properties
    
    private var config: SecurityConfig = SecurityConfig()
    
    // Rate limiting tracking
    private var badgeAttemptTimestamps: [String: [Date]] = [:]
    private var authAttemptTimestamps: [Date] = []
    private var isLockedOut: Bool = false
    private var lockoutEndTime: Date?
    private let rateLimitQueue = DispatchQueue(label: "com.enterprise.shell.rateLimit")
    
    // Device binding
    private var deviceBindingKey: String?
    /// Whether `deviceBindingKey` incorporates an MDM-supplied hardware serial.
    /// False means the key is bound to Keychain state only — per-install, not per-device.
    private var deviceBindingAttested: Bool = false
    
    // MARK: - Initialization
    
    private init() {
        initializeDeviceBinding()
    }
    
    // MARK: - Configuration
    
    func configure(with config: SecurityConfig) {
        self.config = config
    }
    
    // MARK: - Device Binding
    
    private func initializeDeviceBinding() {
        // Generate or retrieve device binding key
        // This binds sessions to this specific device
        if let existingKey = try? KeychainService.shared.retrieve(forKey: "device_binding_key"),
           let key = String(data: existingKey, encoding: .utf8) {
            deviceBindingKey = key
            // The attestation belongs to the key that was stored, not to whatever the
            // environment happens to say now, so it is read back beside it. A key stored
            // before this field existed reads as unattested, which is the safe direction.
            let storedAttestation = try? KeychainService.shared.retrieve(forKey: "device_binding_attested")
            deviceBindingAttested = storedAttestation
                .flatMap { String(data: $0, encoding: .utf8) } == "true"
        } else {
            let attested = DeviceInfo.serialNumber != nil
            let newKey = generateDeviceBindingKey()
            if let data = newKey.data(using: .utf8) {
                try? KeychainService.shared.save(data, forKey: "device_binding_key")
            }
            if let data = String(attested).data(using: .utf8) {
                try? KeychainService.shared.save(data, forKey: "device_binding_attested")
            }
            deviceBindingKey = newKey
            deviceBindingAttested = attested
        }
    }
    
    private func generateDeviceBindingKey() -> String {
        // Create a unique device binding key combining multiple identifiers
        let deviceId = DeviceInfo.identifier
        // A missing serial used to become a fresh UUID here. That kept the key unique but
        // made a key bound to no device fact indistinguishable from one that was — and on
        // real hardware the serial is ALWAYS missing, so every shipped key took that path
        // while `deviceBindingEnabled` reported true. The absence is now named, and the
        // entropy still comes from `DeviceInfo.identifier`, itself a Keychain-held UUID.
        let serial = DeviceInfo.serialNumber ?? "unattested"
        let bundleId = Bundle.main.bundleIdentifier ?? "unknown"
        
        let combined = "\(deviceId):\(serial):\(bundleId)"
        return hashString(combined)
    }
    
    // MARK: - Rate Limiting
    
    /// Check if badge scan is allowed (rate limiting)
    func isBadgeScanAllowed(badgeId: String) -> (allowed: Bool, reason: String?) {
        return rateLimitQueue.sync {
            // Check lockout
            if isLockedOut {
                if let endTime = lockoutEndTime, Date() >= endTime {
                    isLockedOut = false
                    lockoutEndTime = nil
                    badgeAttemptTimestamps.removeAll()
                } else {
                    return (false, "Device is locked due to too many failed attempts")
                }
            }
            
            let now = Date()
            let oneMinuteAgo = now.addingTimeInterval(-60)
            
            // Get or create timestamp array for this badge
            var timestamps = badgeAttemptTimestamps[badgeId] ?? []
            timestamps = timestamps.filter { $0 > oneMinuteAgo }
            
            if timestamps.count >= config.maxBadgeAttemptsPerMinute {
                // Trigger lockout
                isLockedOut = true
                lockoutEndTime = now.addingTimeInterval(config.lockoutDuration)
                
                AuditLogger.shared.log(event: .securityLockout, metadata: [
                    "badgeId": maskBadgeId(badgeId),
                    "reason": "max_attempts_exceeded",
                    "duration": String(config.lockoutDuration)
                ])
                
                return (false, "Too many failed attempts. Please try again later.")
            }
            
            timestamps.append(now)
            badgeAttemptTimestamps[badgeId] = timestamps
            
            return (true, nil)
        }
    }
    
    /// Check if authentication attempt is allowed
    func isAuthAttemptAllowed() -> Bool {
        return rateLimitQueue.sync {
            let now = Date()
            let oneMinuteAgo = now.addingTimeInterval(-60)
            
            // Clean old timestamps
            authAttemptTimestamps = authAttemptTimestamps.filter { $0 > oneMinuteAgo }
            
            if authAttemptTimestamps.count >= config.maxAuthAttemptsPerMinute {
                AuditLogger.shared.log(event: .securityRateLimitExceeded, metadata: [
                    "type": "auth_attempts",
                    "count": String(authAttemptTimestamps.count)
                ])
                return false
            }
            
            authAttemptTimestamps.append(now)
            return true
        }
    }
    
    /// Record a failed attempt
    func recordFailedAttempt(type: FailedAttemptType) {
        rateLimitQueue.async { [weak self] in
            guard let self = self else { return }
            
            AuditLogger.shared.log(event: .securityFailedAttempt, metadata: [
                "type": type.rawValue,
                "timestamp": ISO8601DateFormatter().string(from: Date())
            ])
            
            // Check if we should trigger lockout
            if type == .badgeValidation {
                // Already handled in isBadgeScanAllowed
            }
        }
    }
    
    enum FailedAttemptType: String {
        case badgeValidation = "badge_validation"
        case authentication = "authentication"
        case tokenExchange = "token_exchange"
        case enrollment = "enrollment"
    }
    
    // MARK: - Badge Validation
    
    /// Validate badge ID format
    func validateBadgeId(_ badgeId: String) -> (valid: Bool, error: String?) {
        let trimmed = badgeId.trimmingCharacters(in: .whitespacesAndNewlines)
        
        // Check length
        if trimmed.count < config.minBadgeLength {
            return (false, "Badge ID is too short (minimum \(config.minBadgeLength) characters)")
        }
        
        if trimmed.count > config.maxBadgeLength {
            return (false, "Badge ID is too long (maximum \(config.maxBadgeLength) characters)")
        }
        
        // Check for alphanumeric if required
        if config.requireAlphanumericBadge {
            let alphanumeric = CharacterSet.alphanumerics
            if trimmed.unicodeScalars.contains(where: { !alphanumeric.contains($0) }) {
                return (false, "Badge ID must be alphanumeric")
            }
        }
        
        // Check for injection attempts
        if containsSuspiciousPatterns(trimmed) {
            AuditLogger.shared.log(event: .securitySuspiciousBadge, metadata: [
                "badgeId": maskBadgeId(trimmed),
                "reason": "suspicious_pattern_detected"
            ])
            return (false, "Invalid badge format")
        }
        
        return (true, nil)
    }
    
    /// Check for suspicious patterns in badge ID
    private func containsSuspiciousPatterns(_ badgeId: String) -> Bool {
        let suspiciousPatterns = [
            "..",           // Path traversal
            "<script",      // XSS
            "javascript:",  // XSS
            "onerror=",     // XSS
            "onclick=",     // XSS
            "' OR '",       // SQL injection
            "' OR \"",       // SQL injection
            "--",           // SQL injection
            "UNION",        // SQL injection
            "SELECT",       // SQL injection
            "DROP",         // SQL injection
            "DELETE",       // SQL injection
            "<%",           // Template injection
            "%>"            // Template injection
        ]
        
        let lowercased = badgeId.lowercased()
        return suspiciousPatterns.contains { lowercased.contains($0.lowercased()) }
    }
    
    // MARK: - Request Signing
    
    /// Sign a request with HMAC-SHA256
    func signRequest(_ request: inout URLRequest, body: Data? = nil) {
        guard let signingKey = deviceBindingKey else { return }
        
        // Add timestamp
        let timestamp = String(Int(Date().timeIntervalSince1970))
        request.setValue(timestamp, forHTTPHeaderField: "X-Request-Timestamp")
        
        // Add nonce
        let nonce = UUID().uuidString
        request.setValue(nonce, forHTTPHeaderField: "X-Request-Nonce")
        
        // Create signature base (canonicalized format — DeviceBindingCrypto owns it,
        // so signing and verification cannot drift apart)
        let signatureBase = DeviceBindingCrypto.signatureBase(
            method: request.httpMethod ?? "GET",
            url: request.url?.absoluteString ?? "",
            timestamp: timestamp,
            nonce: nonce,
            body: body
        )
        
        // Generate HMAC-SHA256 signature
        let signature = hmacSHA256(key: signingKey, message: signatureBase)
        request.setValue(signature, forHTTPHeaderField: "X-Request-Signature")
        
        // Device binding claim: a non-reversible IDENTIFIER of the key, never the key.
        // Until 2026-09-02 the key itself went out here, on the same request it had
        // just signed, so one observed request held everything needed to forge every
        // later signature and the HMAC authenticated nothing against an observer.
        //
        // NO ROUTE IN artifacts/api-server READS THIS HEADER — nor X-Request-Signature,
        // X-Request-Timestamp or X-Request-Nonce; no server source names any of the
        // four (checked 2026-09-02, native/ios/README.md "Backend API" table). The
        // headers are additive until a server-side verifier exists; that verifier and
        // this header's meaning are the cloud lane's wire contract to define.
        request.setValue(deviceBindingIdentifier(for: signingKey), forHTTPHeaderField: "X-Device-Binding")
    }
    
    /// What may leave the device as a device-binding claim: SHA-256 (hex) of the
    /// binding key. The key is HMAC material and stays in the Keychain.
    private func deviceBindingIdentifier(for key: String) -> String {
        hashString(key)
    }
    
    /// Verify request signature (for backend to call)
    func verifySignature(
        signature: String,
        timestamp: String,
        nonce: String,
        method: String,
        url: String,
        body: Data?
    ) -> Bool {
        guard let signingKey = deviceBindingKey else { return false }
        
        // Window (5 minutes) then HMAC, in DeviceBindingCrypto. A timestamp that does
        // not parse used to SKIP the window and verify on the HMAC alone, so a replay
        // could carry a non-numeric timestamp forever; it is refused now
        // (`.malformedTimestamp`), and the tests pin that.
        let verdict = DeviceBindingCrypto.verifySignature(
            signature: signature, timestamp: timestamp, nonce: nonce,
            method: method, url: url, body: body, key: signingKey, now: Date()
        )
        if verdict == .expired {
            AuditLogger.shared.log(event: .securityRequestExpired, metadata: [
                "timestamp": timestamp
            ])
        }
        return verdict == .valid
    }
    
    // MARK: - HMAC-SHA256
    
    private func hmacSHA256(key: String, message: String) -> String {
        DeviceBindingCrypto.hmacSHA256Hex(key: key, message: message)
    }
    
    // MARK: - URL Sanitization
    
    /// Sanitize string for URL query parameters
    static func sanitizeForURL(_ value: String) -> String {
        // First try standard URL encoding
        if let encoded = value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) {
            // Additional sanitization to prevent encoding attacks
            let sanitized = encoded
                .replacingOccurrences(of: "%00", with: "")  // Remove null bytes
                .replacingOccurrences(of: "%0a", with: "")  // Remove newlines
                .replacingOccurrences(of: "%0d", with: "")  // Remove carriage returns
            return sanitized
        }
        return value
    }
    
    // MARK: - Token Binding
    
    /// Generate a token binding for THIS device's key:
    /// `<unix-seconds>.<HMAC-SHA256(deviceBindingKey, "token-binding|<unix-seconds>")>`
    /// (`DeviceBindingCrypto.mintTokenBinding`). The timestamp travels WITH the digest
    /// so `verifyTokenBinding` can recompute the same value; the old form hashed the
    /// timestamp in and then threw it away, which left nothing to recompute against.
    func generateTokenBinding() -> String {
        guard let deviceKey = deviceBindingKey else {
            // No key: an unbound marker `verifyTokenBinding` always rejects (fail closed).
            return "unbound\(DeviceBindingCrypto.tokenBindingSeparator)\(UUID().uuidString)"
        }
        let timestamp = String(Int(Date().timeIntervalSince1970))
        return DeviceBindingCrypto.mintTokenBinding(key: deviceKey, timestamp: timestamp)
    }
    
    /// Verify a token binding was minted by THIS device's key — recomputed from the
    /// same inputs and compared in constant time (`DeviceBindingCrypto
    /// .verifyTokenBinding`; `SecurityManagerTests` pins the reasons).
    ///
    /// Until 2026-09-02 this accepted any string beginning with the key's first 8
    /// characters or containing its first 16 — a substring match against material
    /// `signRequest` was publishing in a header — so it confirmed possession of
    /// something already disclosed and never recomputed anything.
    func verifyTokenBinding(_ binding: String) -> Bool {
        guard let deviceKey = deviceBindingKey else { return false }
        return DeviceBindingCrypto.verifyTokenBinding(binding, key: deviceKey)
    }
    
    // MARK: - Hashing
    
    private func hashString(_ input: String) -> String {
        DeviceBindingCrypto.sha256Hex(input)
    }
    
    // MARK: - Privacy
    
    /// Mask badge ID for privacy
    func maskBadgeId(_ badgeId: String) -> String {
        guard badgeId.count > 4 else {
            return "****"
        }
        let prefix = badgeId.prefix(2)
        let suffix = badgeId.suffix(2)
        return "\(prefix)****\(suffix)"
    }
    
    // MARK: - Security Status
    
    /// Get current security status
    func getSecurityStatus() -> [String: Any] {
        return rateLimitQueue.sync {
            var status: [String: Any] = [
                "isLockedOut": isLockedOut,
                "deviceBindingEnabled": deviceBindingKey != nil,
                // Enabled says a key exists. Attested says it is bound to a hardware fact.
                // They were the same field until the second answer was almost always no.
                "deviceBindingAttested": deviceBindingAttested,
                "rateLimitConfig": [
                    "maxBadgeAttemptsPerMinute": config.maxBadgeAttemptsPerMinute,
                    "maxAuthAttemptsPerMinute": config.maxAuthAttemptsPerMinute,
                    "lockoutDuration": config.lockoutDuration
                ]
            ]
            
            if let lockoutEnd = lockoutEndTime {
                status["lockoutEndTime"] = ISO8601DateFormatter().string(from: lockoutEnd)
            }
            
            return status
        }
    }
    
    /// Reset rate limiting (for testing or admin)
    func resetRateLimiting() {
        rateLimitQueue.async { [weak self] in
            self?.badgeAttemptTimestamps.removeAll()
            self?.authAttemptTimestamps.removeAll()
            self?.isLockedOut = false
            self?.lockoutEndTime = nil
        }
    }
}
