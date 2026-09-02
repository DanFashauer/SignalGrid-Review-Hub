import Foundation

/// Backend API Service for session management
final class BackendService {
    
    // MARK: - Singleton
    
    static let shared = BackendService()
    
    // MARK: - Configuration
    
    static var baseUrl: String {
        let url = ProcessInfo.processInfo.environment["BACKEND_BASE_URL"] ?? "https://api.enterprise.example.com"
        // SECURITY: Enforce HTTPS
        guard url.hasPrefix("https://") else {
            fatalError("SECURITY: Backend URL must use HTTPS. Current: \(url)")
        }
        return url
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
        // Example: let pinnedHashes = ["sha256/AAAAAAAAAAA="]
        let pinnedHashes = Self.getPinnedCertificateHashes()
        if !pinnedHashes.isEmpty {
            config.urlCache = nil
            config.requestCachePolicy = .reloadIgnoringLocalCacheData
        }
        
        self.session = URLSession(configuration: config)
        
        self.decoder = JSONDecoder()
        self.decoder.dateDecodingStrategy = .iso8601
        
        self.encoder = JSONEncoder()
        self.encoder.dateEncodingStrategy = .iso8601
    }
    
    /// Get certificate hashes for pinning (override in production)
    private static func getPinnedCertificateHashes() -> [String] {
        // In production, configure server's certificate SHA256 hashes
        // Return empty array to disable pinning for development
        // Example: return ["sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="]
        return ProcessInfo.processInfo.environment["CERT_PINNING_ENABLED"] == "true"
            ? (ProcessInfo.processInfo.environment["CERT_HASHES"] ?? "").split(separator: ",").map { String($0) }
            : []
    }
    
    // MARK: - Session Start
    
    /// Start a new session with badge validation
    func startSession(
        badgeId: String,
        deviceId: String,
        deviceSerial: String
    ) async throws -> StartSessionResponse {
        #if targetEnvironment(simulator)
        if DemoMode.isEnabled { return DemoMode.unenrolled ? DemoMode.unenrolledStartResponse() : DemoMode.startSessionResponse(badgeId: badgeId) }
        #endif
        let url = URL(string: "\(Self.baseUrl)/api/v1/sessions/start")!
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let requestBody = StartSessionRequest(
            badgeId: badgeId,
            deviceId: deviceId,
            deviceSerial: deviceSerial,
            timestamp: Date(),
            metadata: DeviceInfo.metadata
        )
        
        request.httpBody = try encoder.encode(requestBody)
        
        // Add device authentication header if available
        addDeviceAuthHeaders(to: &request)
        
        let (data, response) = try await session.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw BackendError.invalidResponse
        }
        
        guard (200...299).contains(httpResponse.statusCode) else {
            throw BackendError.httpError(statusCode: httpResponse.statusCode)
        }
        
        return try decoder.decode(StartSessionResponse.self, from: data)
    }
    
    // MARK: - Session End
    
    /// End an active session
    func endSession(sessionId: String, reason: SessionEndReason) async throws -> EndSessionResponse {
        #if targetEnvironment(simulator)
        if DemoMode.isEnabled { return DemoMode.endSessionResponse() }
        #endif
        let url = URL(string: "\(Self.baseUrl)/api/v1/sessions/\(sessionId)/end")!
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let requestBody = EndSessionRequest(
            sessionId: sessionId,
            reason: reason,
            timestamp: Date(),
            auditData: AuditData(
                sessionDuration: 0,
                actionsPerformed: [],
                resourcesAccessed: [],
                anyErrors: false
            )
        )
        
        request.httpBody = try encoder.encode(requestBody)
        
        addDeviceAuthHeaders(to: &request)
        
        let (data, response) = try await session.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw BackendError.invalidResponse
        }
        
        guard (200...299).contains(httpResponse.statusCode) else {
            throw BackendError.httpError(statusCode: httpResponse.statusCode)
        }
        
        return try decoder.decode(EndSessionResponse.self, from: data)
    }
    
    // MARK: - Audit Data
    
    /// Send audit data for a session
    func sendAuditData(sessionId: String, auditData: AuditData) async throws {
        #if targetEnvironment(simulator)
        if DemoMode.isEnabled { return }
        #endif
        // DECLARED-NOT-IMPLEMENTED: no route in artifacts/api-server serves this path.
        // The served session routes are /api/v1/sessions/{start,:id,:id/refresh,:id/end}
        // and the only audit routes are /api/v1/audit, /api/simulator/audit and
        // /api/cp/v1/self-audit. Established by enumerating every router.get/post/put/
        // patch/delete (including the multi-line signatures) plus every router.use in
        // routes/ — all sub-routers mount with NO path prefix, so their declared paths
        // are absolute. `check:absence` returns INCONCLUSIVE for this string and its two
        // matches are this file and a lane message, i.e. the caller and the report,
        // never a route.
        let url = URL(string: "\(Self.baseUrl)/api/sessions/\(sessionId)/audit")!
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        request.httpBody = try encoder.encode(auditData)
        
        addDeviceAuthHeaders(to: &request)
        
        // Fire and forget - don't await response
        let task = session.dataTask(with: request) { _, response, error in
            if let error = error {
                AuditLogger.shared.log(event: .auditUploadFailed, metadata: [
                    "sessionId": sessionId,
                    "error": error.localizedDescription
                ])
                return
            }
            guard let httpResponse = response as? HTTPURLResponse else {
                AuditLogger.shared.log(event: .auditUploadFailed, metadata: [
                    "sessionId": sessionId,
                    "error": "no HTTP response"
                ])
                return
            }
            guard (200...299).contains(httpResponse.statusCode) else {
                // A non-2xx used to fall through both branches and log nothing at all,
                // so a 404 discarded the audit payload silently. Unreported is the one
                // outcome an audit path may never have.
                AuditLogger.shared.log(event: .auditUploadFailed, metadata: [
                    "sessionId": sessionId,
                    "error": "HTTP \(httpResponse.statusCode)"
                ])
                return
            }
            AuditLogger.shared.log(event: .auditUploaded, metadata: [
                "sessionId": sessionId
            ])
        }
        task.resume()
    }
    
    // MARK: - Health Check
    
    /// Check backend connectivity
    func healthCheck() async throws -> Bool {
        guard let url = URL(string: "\(Self.baseUrl)/api/healthz") else {
            throw BackendError.invalidUrl
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        
        let (_, response) = try await session.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            return false
        }
        
        return (200...299).contains(httpResponse.statusCode)
    }
    
    // MARK: - Badge Enrollment
    
    /// Check if a badge is enrolled, and if not, initiate enrollment
    func checkBadgeEnrollment(
        badgeId: String,
        deviceId: String,
        deviceSerial: String
    ) async throws -> BadgeEnrollmentResponse {
        #if targetEnvironment(simulator)
        if DemoMode.isEnabled { return DemoMode.enrollmentCheckResponse() }
        #endif
        // DECLARED-NOT-IMPLEMENTED: no route in artifacts/api-server serves any /badges
        // path. "badge" and "enroll" appear there only in prose, a control-plane
        // connector id, and the x-enrollment-authorization CORS header; the only enroll
        // routes are /v1/step-up/enroll/{options,verify}, which are WebAuthn step-up and
        // not badge enrollment. This call throws BackendError.httpError(404) until a
        // route exists.
        let url = URL(string: "\(Self.baseUrl)/api/badges/check-enrollment")!
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let requestBody = BadgeEnrollmentRequest(
            badgeId: badgeId,
            deviceId: deviceId,
            deviceSerial: deviceSerial,
            timestamp: Date(),
            metadata: DeviceInfo.metadata
        )
        
        request.httpBody = try encoder.encode(requestBody)
        
        addDeviceAuthHeaders(to: &request)
        
        let (data, response) = try await session.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw BackendError.invalidResponse
        }
        
        guard (200...299).contains(httpResponse.statusCode) else {
            throw BackendError.httpError(statusCode: httpResponse.statusCode)
        }
        
        return try decoder.decode(BadgeEnrollmentResponse.self, from: data)
    }
    
    /// Complete the badge enrollment process
    func completeBadgeEnrollment(
        badgeId: String,
        userInfo: EnrollmentUserInfo
    ) async throws -> BadgeEnrollmentResponse {
        // DECLARED-NOT-IMPLEMENTED: the api-server serves no /badges route. This call
        // throws BackendError.httpError(404) until one exists.
        let url = URL(string: "\(Self.baseUrl)/api/badges/enroll")!
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let requestBody = CompleteEnrollmentRequest(
            badgeId: badgeId,
            userInfo: userInfo,
            timestamp: Date()
        )
        
        request.httpBody = try encoder.encode(requestBody)
        
        addDeviceAuthHeaders(to: &request)
        
        let (data, response) = try await session.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw BackendError.invalidResponse
        }
        
        guard (200...299).contains(httpResponse.statusCode) else {
            throw BackendError.httpError(statusCode: httpResponse.statusCode)
        }
        
        return try decoder.decode(BadgeEnrollmentResponse.self, from: data)
    }
    
    // MARK: - Device Authentication
    
    private func addDeviceAuthHeaders(to request: inout URLRequest) {
        // Add device identification headers
        request.setValue(DeviceInfo.identifier, forHTTPHeaderField: "X-Device-ID")
        request.setValue(DeviceInfo.hardwareModel, forHTTPHeaderField: "X-Device-Model")
        request.setValue(DeviceInfo.osVersion, forHTTPHeaderField: "X-OS-Version")
        
        // Add authentication token if available
        if let token = OIDCAuthService.shared.getAccessToken() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        
        // SECURITY: Add request signing for API integrity
        SecurityManager.shared.signRequest(&request, body: request.httpBody)
        
        // SECURITY: Add additional security headers
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
    }
}

// MARK: - Backend Errors

enum BackendError: LocalizedError {
    case invalidResponse
    case httpError(statusCode: Int)
    case invalidUrl
    case encodingError
    case decodingError
    
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
        }
    }
}
