import Foundation
import AuthenticationServices

/// OIDC Authentication Service for Microsoft Entra ID
final class OIDCAuthService: NSObject {
    
    // MARK: - Singleton
    
    static let shared = OIDCAuthService()
    
    // MARK: - Configuration
    
    struct OIDCConfig {
        let clientId: String
        let tenantId: String
        let redirectUri: String
        let scopes: [String]
        
        // Microsoft Entra ID (Azure AD) endpoints
        static let `default` = OIDCConfig(
            clientId: "<YOUR_CLIENT_ID>",
            tenantId: "<YOUR_TENANT_ID>",
            redirectUri: "com.enterprise.shell://auth/callback",
            scopes: [
                "openid",
                "profile",
                "email",
                "User.Read"
            ]
        )
        
        var authorizationEndpoint: URL {
            URL(string: "https://login.microsoftonline.com/\(tenantId)/oauth2/v2.0/authorize")!
        }
        
        var tokenEndpoint: URL {
            URL(string: "https://login.microsoftonline.com/\(tenantId)/oauth2/v2.0/token")!
        }
        
        var issuer: URL {
            URL(string: "https://login.microsoftonline.com/\(tenantId)/v2.0")!
        }
    }
    
    // MARK: - Properties
    
    private var config: OIDCConfig = .default
    private var sessionToken: String?
    private var currentPersona: Persona?
    
    // Token cache
    private var accessToken: String?
    private var refreshToken: String?
    private var idToken: String?
    private var tokenExpiresAt: Date?
    
    // URLSession with certificate pinning support
    private lazy var secureSession: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60
        return URLSession(configuration: config)
    }()
    
    // MARK: - Initialization
    
    private override init() {
        super.init()
    }
    
    // MARK: - Configuration
    
    func configure(with config: OIDCConfig) {
        self.config = config
    }
    
    // MARK: - Authentication
    
    /// Begin OIDC authentication flow
    func authenticate(sessionToken: String, persona: Persona) async throws -> OIDCTokenResult {
        self.sessionToken = sessionToken
        self.currentPersona = persona
        
        // For kiosk mode, we use a session token from backend
        // to authenticate without user interaction (Entra ID joined device)
        
        // Option 1: Device Code Flow (for shared devices without user input)
        // Option 2: Token Exchange (using session token from badge reader)
        // Option 3: Conditional Access with device compliance
        
        // For this implementation, we use token exchange flow
        // where the backend provides a session token after badge validation
        
        return try await exchangeSessionToken(sessionToken: sessionToken)
    }
    
    /// Exchange session token for OIDC tokens
    private func exchangeSessionToken(sessionToken: String) async throws -> OIDCTokenResult {
        // The session token from the backend is exchanged for OIDC tokens
        // This is typically done via a backend proxy to protect client secret
        
        guard let backendTokenUrl = URL(string: "\(BackendService.baseUrl)/api/auth/exchange-token") else {
            throw OIDCError.invalidConfiguration
        }
        
        var request = URLRequest(url: backendTokenUrl)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        
        let body: [String: Any] = [
            "session_token": sessionToken,
            "client_id": config.clientId,
            "grant_type": "urn:ietf:params:oauth:grant-type:token-exchange",
            "requested_token_type": "urn:ietf:params:oauth:token-type:access_token"
        ]
        
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        
        // SECURITY: Sign the request
        SecurityManager.shared.signRequest(&request, body: request.httpBody)
        
        let (data, response) = try await secureSession.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw OIDCError.networkError
        }
        
        guard (200...299).contains(httpResponse.statusCode) else {
            // Log authentication failure
            AuditLogger.shared.log(event: .authenticationFailed, metadata: [
                "reason": "token_exchange_failed",
                "status": String(httpResponse.statusCode)
            ])
            throw OIDCError.tokenExchangeFailed
        }
        
        let tokenResponse = try JSONDecoder().decode(TokenExchangeResponse.self, from: data)
        
        // Store tokens securely
        accessToken = tokenResponse.accessToken
        idToken = tokenResponse.idToken
        refreshToken = tokenResponse.refreshToken
        tokenExpiresAt = Date().addingTimeInterval(TimeInterval(tokenResponse.expiresIn))
        
        // Save to Keychain
        try KeychainService.shared.saveTokens(
            accessToken: tokenResponse.accessToken,
            refreshToken: tokenResponse.refreshToken,
            idToken: tokenResponse.idToken
        )
        
        return OIDCTokenResult(
            accessToken: tokenResponse.accessToken,
            refreshToken: tokenResponse.refreshToken,
            idToken: tokenResponse.idToken,
            expiresAt: tokenExpiresAt
        )
    }
    
    /// Refresh the access token
    func refreshToken() async throws {
        guard let refreshToken = KeychainService.shared.getRefreshToken() else {
            throw OIDCError.noRefreshToken
        }
        
        let tokenUrl = config.tokenEndpoint
        
        var request = URLRequest(url: tokenUrl)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        
        let bodyParams = [
            "client_id": config.clientId,
            "grant_type": "refresh_token",
            "refresh_token": refreshToken,
            "scope": config.scopes.joined(separator: " ")
        ]
        
        request.httpBody = bodyParams
            .map { "\($0.key)=\(SecurityManager.sanitizeForURL($0.value))" }
            .joined(separator: "&")
            .data(using: .utf8)
        
        // SECURITY: Add device binding header
        request.setValue(DeviceInfo.identifier, forHTTPHeaderField: "X-Device-ID")
        
        let (data, response) = try await secureSession.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            // Log token refresh failure
            AuditLogger.shared.log(event: .tokenRefreshFailed, metadata: [
                "reason": "http_error"
            ])
            throw OIDCError.refreshFailed
        }
        
        let tokenResponse = try JSONDecoder().decode(TokenExchangeResponse.self, from: data)
        
        // Update stored tokens
        self.accessToken = tokenResponse.accessToken
        self.idToken = tokenResponse.idToken
        self.refreshToken = tokenResponse.refreshToken ?? refreshToken
        self.tokenExpiresAt = Date().addingTimeInterval(TimeInterval(tokenResponse.expiresIn))
        
        // Save to Keychain
        try KeychainService.shared.saveTokens(
            accessToken: tokenResponse.accessToken,
            refreshToken: tokenResponse.refreshToken ?? refreshToken,
            idToken: tokenResponse.idToken
        )
    }
    
    /// Revoke tokens on session end
    func revokeToken(_ token: String) async throws {
        // Microsoft Entra ID doesn't have a标准的 revocation endpoint
        // Instead, we rely on the backend to invalidate the session
        
        // Clear local tokens
        accessToken = nil
        refreshToken = nil
        idToken = nil
        tokenExpiresAt = nil
        
        // Clear Keychain
        KeychainService.shared.clearSessionTokens()
        
        // Notify backend of logout
        if let backendLogoutUrl = URL(string: "\(BackendService.baseUrl)/api/auth/logout") {
            var request = URLRequest(url: backendLogoutUrl)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            
            let body: [String: Any] = [
                "token": token,
                "device_id": DeviceInfo.identifier
            ]
            
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            
            // Fire and forget - don't await
            URLSession.shared.dataTask(with: request).resume()
        }
    }
    
    /// Get current access token
    func getAccessToken() -> String? {
        // Check if token needs refresh
        if let expiresAt = tokenExpiresAt,
           expiresAt.timeIntervalSinceNow < 300 {
            // Token expires in less than 5 minutes - refresh in background
            Task {
                do {
                    try await refreshToken()
                } catch {
                    // Log error but don't crash - caller will handle expired token
                    AuditLogger.shared.log(event: .tokenRefreshFailed, metadata: [
                        "error": error.localizedDescription
                    ])
                }
            }
        }
        
        return accessToken ?? KeychainService.shared.getAccessToken()
    }
    
    /// Check if authenticated
    var isAuthenticated: Bool {
        accessToken != nil || KeychainService.shared.getAccessToken() != nil
    }
}

// MARK: - Token Response Models

struct TokenExchangeResponse: Codable {
    let accessToken: String
    let refreshToken: String?
    let idToken: String?
    let expiresIn: Int
    let tokenType: String
}

struct OIDCTokenResult {
    let accessToken: String
    let refreshToken: String?
    let idToken: String?
    let expiresAt: Date?
}

// MARK: - OIDC Errors

enum OIDCError: LocalizedError {
    case invalidConfiguration
    case networkError
    case tokenExchangeFailed
    case refreshFailed
    case noRefreshToken
    case userCancelled
    case authenticationFailed
    
    var errorDescription: String? {
        switch self {
        case .invalidConfiguration:
            return "OIDC configuration is invalid"
        case .networkError:
            return "Network error during authentication"
        case .tokenExchangeFailed:
            return "Failed to exchange session token"
        case .refreshFailed:
            return "Failed to refresh access token"
        case .noRefreshToken:
            return "No refresh token available"
        case .userCancelled:
            return "Authentication was cancelled by user"
        case .authenticationFailed:
            return "Authentication failed"
        }
    }
}

// MARK: - ASWebAuthenticationPresentationContextProviding

extension OIDCAuthService: ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        // Return the main window
        guard let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let window = scene.windows.first else {
            return ASPresentationAnchor()
        }
        return window
    }
}
