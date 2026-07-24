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
        } else {
            let newKey = generateDeviceBindingKey()
            if let data = newKey.data(using: .utf8) {
                try? KeychainService.shared.save(data, forKey: "device_binding_key")
            }
            deviceBindingKey = newKey
        }
    }
    
    private func generateDeviceBindingKey() -> String {
        // Create a unique device binding key combining multiple identifiers
        let deviceId = DeviceInfo.identifier
        let serial = DeviceInfo.serialNumber ?? UUID().uuidString
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
        
        // Create signature base (canonicalized format)
        var signatureBase = "\(request.httpMethod ?? "GET")|\(request.url?.absoluteString ?? "")"
        signatureBase += "\(timestamp)"
        signatureBase += "\(nonce)"
        
        if let body = body, !body.isEmpty {
            if let bodyString = String(data: body, encoding: .utf8) {
                signatureBase += bodyString
            }
        }
        
        // Generate HMAC-SHA256 signature
        let signature = hmacSHA256(key: signingKey, message: signatureBase)
        request.setValue(signature, forHTTPHeaderField: "X-Request-Signature")
        
        // Add device binding claim
        request.setValue(signingKey, forHTTPHeaderField: "X-Device-Binding")
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
        
        // Check timestamp is within acceptable window (5 minutes)
        if let ts = Int(timestamp) {
            let requestTime = TimeInterval(ts)
            let now = Date().timeIntervalSince1970
            if abs(now - requestTime) > 300 {
                AuditLogger.shared.log(event: .securityRequestExpired, metadata: [
                    "timestamp": timestamp
                ])
                return false
            }
        }
        
        // Verify signature (canonicalized format)
        var signatureBase = "\(method)|\(url)"
        signatureBase += "\(timestamp)"
        signatureBase += "\(nonce)"
        
        if let body = body, !body.isEmpty {
            if let bodyString = String(data: body, encoding: .utf8) {
                signatureBase += bodyString
            }
        }
        
        let expectedSignature = hmacSHA256(key: signingKey, message: signatureBase)
        return signature == expectedSignature
    }
    
    // MARK: - HMAC-SHA256
    
    private func hmacSHA256(key: String, message: String) -> String {
        guard let keyData = key.data(using: .utf8),
              let messageData = message.data(using: .utf8) else {
            return ""
        }
        
        var digest = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
        
        keyData.withUnsafeBytes { keyBytes in
            messageData.withUnsafeBytes { messageBytes in
                CCHmac(
                    CCHmacAlgorithm(kCCHmacAlgSHA256),
                    keyBytes.baseAddress,
                    keyData.count,
                    messageBytes.baseAddress,
                    messageData.count,
                    &digest
                )
            }
        }
        
        return digest.map { String(format: "%02x", $0) }.joined()
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
    
    /// Generate a token binding identifier
    func generateTokenBinding() -> String {
        guard let deviceKey = deviceBindingKey else {
            return UUID().uuidString
        }
        
        let timestamp = String(Int(Date().timeIntervalSince1970))
        return hashString("\(deviceKey):\(timestamp)")
    }
    
    /// Verify token is bound to this device
    func verifyTokenBinding(_ binding: String) -> Bool {
        guard let deviceKey = deviceBindingKey else { return false }
        
        // The binding should contain device-specific information
        // We verify by checking if the binding was created with our device key
        let expectedPrefix = String(deviceKey.prefix(8))
        return binding.hasPrefix(expectedPrefix) || binding.contains(deviceKey.prefix(16))
    }
    
    // MARK: - Hashing
    
    private func hashString(_ input: String) -> String {
        guard let data = input.data(using: .utf8) else { return "" }
        
        var digest = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
        
        data.withUnsafeBytes { bytes in
            _ = CC_SHA256(bytes.baseAddress, CC_LONG(data.count), &digest)
        }
        
        return digest.map { String(format: "%02x", $0) }.joined()
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
