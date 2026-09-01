import Foundation
import UIKit

/// Protocol defining the interface for identity providers
/// Allows integration with any identity provider (OIDC, SAML, MDM, MFA, etc.)
protocol IdentityProvider: AnyObject {
    /// Unique identifier for this provider
    var providerId: String { get }
    
    /// Human-readable name for the provider
    var displayName: String { get }
    
    /// Type of identity provider
    var providerType: IdentityProviderType { get }
    
    /// Whether the user is currently authenticated
    var isAuthenticated: Bool { get }
    
    /// Current access token if authenticated
    var currentAccessToken: String? { get }
    
    /// Configure the provider with settings
    func configure(with config: IdentityProviderConfig)
    
    /// Authenticate a user with the given credentials
    /// - Parameters:
    ///   - credentials: Authentication credentials (badge ID, session token, etc.)
    ///   - persona: User persona from backend
    /// - Returns: Authentication result with tokens
    func authenticate(credentials: AuthenticationCredentials, persona: Persona) async throws -> AuthenticationResult
    
    /// Refresh the current access token
    func refreshToken() async throws
    
    /// Revoke the current authentication
    func revokeAuthentication(token: String) async throws
    
    /// Get the current access token (with automatic refresh if needed)
    func getAccessToken() -> String?
}

/// Types of identity providers supported
enum IdentityProviderType: String, Codable, CaseIterable {
    case oidc = "oidc"                    // OpenID Connect
    case saml = "saml"                     // SAML 2.0
    case mdm = "mdm"                       // MDM-based authentication
    case mfa = "mfa"                      // MFA-only provider
    case hybrid = "hybrid"                 // Combination of providers
    case custom = "custom"                 // Custom authentication
    
    var displayName: String {
        switch self {
        case .oidc:
            return "OpenID Connect (OIDC)"
        case .saml:
            return "SAML 2.0"
        case .mdm:
            return "MDM Authentication"
        case .mfa:
            return "MFA Provider"
        case .hybrid:
            return "Hybrid Authentication"
        case .custom:
            return "Custom Provider"
        }
    }
}

/// Authentication credentials from badge scan
struct AuthenticationCredentials {
    let credentialType: CredentialType
    let badgeId: String?
    let sessionToken: String?
    let deviceId: String?
    let mdmUserId: String?
    let mfaToken: String?
    let additionalData: [String: String]?
    
    enum CredentialType: String, Codable {
        case badge = "badge"
        case sessionToken = "session_token"
        case mdmUser = "mdm_user"
        case mfa = "mfa"
        case hybrid = "hybrid"
    }
}

/// Result of successful authentication
struct AuthenticationResult {
    let accessToken: String
    let refreshToken: String?
    let idToken: String?
    let expiry: ExpiryPolicy
    let userInfo: UserInfo?
    let persona: Persona?
    let providerSpecificData: [String: String]?
}

/// Identity provider configuration
struct IdentityProviderConfig: Codable {
    let providerType: IdentityProviderType
    
    // OIDC Configuration
    let clientId: String?
    let tenantId: String?
    let redirectUri: String?
    let scopes: [String]?
    let authorizationEndpoint: String?
    let tokenEndpoint: String?
    let issuer: String?
    
    // SAML Configuration
    let samlEntryPoint: String?
    let samlLogoutUrl: String?
    let certificate: String?
    
    // MDM Configuration
    let mdmProvider: MDMProviderType?
    let enrollmentEndpoint: String?
    
    // MFA Configuration
    let mfaProvider: MFAProviderType?
    let mfaApiKey: String?
    let mfaHost: String?
    
    // Generic Configuration
    let customEndpoint: String?
    let customApiKey: String?
    
    // Default OIDC configuration (Microsoft Entra ID)
    static let defaultMicrosoftEntraID = IdentityProviderConfig(
        providerType: .oidc,
        clientId: "<YOUR_CLIENT_ID>",
        tenantId: "<YOUR_TENANT_ID>",
        redirectUri: "com.enterprise.shell://auth/callback",
        scopes: ["openid", "profile", "email", "User.Read"],
        authorizationEndpoint: "https://login.microsoftonline.com/<TENANT>/oauth2/v2.0/authorize",
        tokenEndpoint: "https://login.microsoftonline.com/<TENANT>/oauth2/v2.0/token",
        issuer: "https://login.microsoftonline.com/<TENANT>/v2.0",
        samlEntryPoint: nil,
        samlLogoutUrl: nil,
        certificate: nil,
        mdmProvider: nil,
        enrollmentEndpoint: nil,
        mfaProvider: nil,
        mfaApiKey: nil,
        mfaHost: nil,
        customEndpoint: nil,
        customApiKey: nil
    )
    
    // Default MDM configuration
    static let defaultMDM = IdentityProviderConfig(
        providerType: .mdm,
        clientId: nil,
        tenantId: nil,
        redirectUri: nil,
        scopes: nil,
        authorizationEndpoint: nil,
        tokenEndpoint: nil,
        issuer: nil,
        samlEntryPoint: nil,
        samlLogoutUrl: nil,
        certificate: nil,
        mdmProvider: .microsoftIntune,
        enrollmentEndpoint: nil,
        mfaProvider: nil,
        mfaApiKey: nil,
        mfaHost: nil,
        customEndpoint: nil,
        customApiKey: nil
    )
}

/// MFA Provider types
enum MFAProviderType: String, Codable, CaseIterable {
    case duo = "duo"
    case rsaSecurID = "rsa_securid"
    case cyberArk = "cyber_ark"
    case ping = "ping"
    case oktaVerify = "okta_verify"
    case googleAuthenticator = "google_authenticator"
    case custom = "custom"
    
    var displayName: String {
        switch self {
        case .duo:
            return "Duo Security"
        case .rsaSecurID:
            return "RSA SecurID"
        case .cyberArk:
            return "CyberArk"
        case .ping:
            return "Ping Identity"
        case .oktaVerify:
            return "Okta Verify"
        case .googleAuthenticator:
            return "Google Authenticator"
        case .custom:
            return "Custom MFA"
        }
    }
}

/// Identity provider factory for creating provider instances
final class IdentityProviderFactory {
    
    static let shared = IdentityProviderFactory()
    
    private var registeredProviders: [IdentityProviderType: () -> IdentityProvider] = [:]
    private var defaultProvider: IdentityProvider?
    
    private init() {
        registerBuiltInProviders()
    }
    
    private func registerBuiltInProviders() {
        // OIDC provider
        registeredProviders[.oidc] = {
            OIDCIdentityProvider()
        }
        
        // MDM provider
        registeredProviders[.mdm] = {
            MDMIdentityProvider()
        }
        
        // MFA provider
        registeredProviders[.mfa] = {
            MFAIdentityProvider()
        }
        
        // Hybrid provider (OIDC + MFA)
        registeredProviders[.hybrid] = {
            HybridIdentityProvider()
        }
    }
    
    /// Register a custom identity provider
    func registerProvider(type: IdentityProviderType, factory: @escaping () -> IdentityProvider) {
        registeredProviders[type] = factory
    }
    
    /// Create an identity provider for the given configuration
    func createProvider(config: IdentityProviderConfig) -> IdentityProvider? {
        guard let factory = registeredProviders[config.providerType] else {
            return nil
        }
        
        let provider = factory()
        provider.configure(with: config)
        return provider
    }
    
    /// Get all available provider types
    func availableProviderTypes() -> [IdentityProviderType] {
        return IdentityProviderType.allCases
    }
    
    /// Set the default provider to use
    func setDefaultProvider(_ provider: IdentityProvider) {
        defaultProvider = provider
    }
    
    /// Get the default provider
    func getDefaultProvider() -> IdentityProvider? {
        return defaultProvider
    }
}

// MARK: - OIDC Identity Provider

/// OIDC-based identity provider (Microsoft Entra ID, Okta, Auth0, etc.)
final class OIDCIdentityProvider: IdentityProvider {
    
    var providerId: String { "oidc_\(UUID().uuidString.prefix(8))" }
    var displayName: String { "OIDC Provider" }
    var providerType: IdentityProviderType { .oidc }
    var isAuthenticated: Bool { accessToken != nil || KeychainService.shared.getAccessToken() != nil }
    var currentAccessToken: String? { accessToken ?? KeychainService.shared.getAccessToken() }
    
    private var config: IdentityProviderConfig?
    private var accessToken: String?
    private var refreshToken: String?
    private var idToken: String?
    private var tokenExpiresAt: Date?
    
    func configure(with config: IdentityProviderConfig) {
        self.config = config
    }
    
    func authenticate(credentials: AuthenticationCredentials, persona: Persona) async throws -> AuthenticationResult {
        guard let sessionToken = credentials.sessionToken else {
            throw IdentityProviderError.invalidCredentials
        }
        
        // Exchange session token for OIDC tokens via backend
        return try await exchangeSessionToken(sessionToken: sessionToken)
    }
    
    private func exchangeSessionToken(sessionToken: String) async throws -> AuthenticationResult {
        guard let backendTokenUrl = URL(string: "\(BackendService.baseUrl)/api/auth/exchange-token") else {
            throw IdentityProviderError.invalidConfiguration
        }
        
        var request = URLRequest(url: backendTokenUrl)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body: [String: Any] = [
            "session_token": sessionToken,
            "client_id": config?.clientId ?? "",
            "grant_type": "urn:ietf:params:oauth:grant-type:token-exchange",
            "requested_token_type": "urn:ietf:params:oauth:token-type:access_token"
        ]
        
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        
        // Sign request for security
        SecurityManager.shared.signRequest(&request, body: request.httpBody)
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw IdentityProviderError.authenticationFailed
        }
        
        let tokenResponse = try JSONDecoder().decode(TokenExchangeResponse.self, from: data)
        
        // Store tokens
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
        
        return AuthenticationResult(
            accessToken: tokenResponse.accessToken,
            refreshToken: tokenResponse.refreshToken,
            idToken: tokenResponse.idToken,
            expiry: tokenExpiresAt.map(ExpiryPolicy.expiresAt) ?? .expiresAt(.distantPast),
            userInfo: nil,
            persona: nil,
            providerSpecificData: ["token_type": tokenResponse.tokenType]
        )
    }
    
    func refreshToken() async throws {
        guard let refreshToken = KeychainService.shared.getRefreshToken() else {
            throw IdentityProviderError.noRefreshToken
        }
        
        // Token refresh implementation would go here
        // Similar to exchangeSessionToken but with refresh_token grant
    }
    
    func revokeAuthentication(token: String) async throws {
        accessToken = nil
        refreshToken = nil
        idToken = nil
        tokenExpiresAt = nil
        
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
            URLSession.shared.dataTask(with: request).resume()
        }
    }
    
    func getAccessToken() -> String? {
        // Check if token needs refresh
        if let expiresAt = tokenExpiresAt,
           expiresAt.timeIntervalSinceNow < 300 {
            Task {
                try? await refreshToken()
            }
        }
        return currentAccessToken
    }
}

// MARK: - MDM Identity Provider

/// MDM-based identity provider
/// Uses MDM enrollment to link device to user identity
final class MDMIdentityProvider: IdentityProvider {
    
    var providerId: String { "mdm_\(UUID().uuidString.prefix(8))" }
    var displayName: String { "MDM Authentication" }
    var providerType: IdentityProviderType { .mdm }
    var isAuthenticated: Bool { currentUserId != nil }
    var currentAccessToken: String? { mdmToken }
    
    private var config: IdentityProviderConfig?
    private var currentUserId: String?
    private var mdmToken: String?
    private var tokenExpiresAt: Date?
    
    func configure(with config: IdentityProviderConfig) {
        self.config = config
    }
    
    func authenticate(credentials: AuthenticationCredentials, persona: Persona) async throws -> AuthenticationResult {
        // Use MDM to get user identity. (Can't use `??` with an async call on the
        // right-hand side — the autoclosure isn't async — so resolve explicitly.)
        var resolvedUserId = credentials.mdmUserId
        if resolvedUserId == nil {
            resolvedUserId = try await queryMDMForUser()
        }
        guard let userId = resolvedUserId else {
            throw IdentityProviderError.mdmNotAvailable
        }
        
        currentUserId = userId
        
        // Create MDM-based session
        // In a real implementation, this would call the backend to create a session
        let sessionToken = try await createMDMSession(userId: userId, deviceId: credentials.deviceId ?? DeviceInfo.identifier)
        
        return AuthenticationResult(
            accessToken: sessionToken,
            refreshToken: nil,
            idToken: nil,
            expiry: .nonExpiring(justification: "MDM session: lifetime governed by MDM enrolment and device security, not a token TTL"),
            userInfo: nil,
            persona: persona,
            providerSpecificData: ["mdm_user_id": userId, "mdm_provider": config?.mdmProvider?.rawValue ?? "unknown"]
        )
    }
    
    private func queryMDMForUser() async throws -> String? {
        // Query MDM for enrolled user
        // Implementation depends on MDM provider
        // For Intune: /deviceManagement/managedDevices/{deviceId}/userId
        // For Jamf: /api/v1/authenticated-sessions
        
        guard let endpoint = config?.enrollmentEndpoint else {
            throw IdentityProviderError.mdmNotConfigured
        }
        
        // Placeholder - implement actual MDM API
        return nil
    }
    
    private func createMDMSession(userId: String, deviceId: String) async throws -> String {
        guard let url = URL(string: "\(BackendService.baseUrl)/api/auth/mdm-session") else {
            throw IdentityProviderError.invalidConfiguration
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body: [String: Any] = [
            "mdm_user_id": userId,
            "device_id": deviceId,
            "device_serial": DeviceInfo.serialNumber ?? "unknown"
        ]
        
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw IdentityProviderError.authenticationFailed
        }
        
        let sessionResponse = try JSONDecoder().decode(MDMSessionResponse.self, from: data)
        mdmToken = sessionResponse.sessionToken
        tokenExpiresAt = Date().addingTimeInterval(TimeInterval(sessionResponse.expiresIn))
        
        return sessionResponse.sessionToken
    }
    
    func refreshToken() async throws {
        // MDM tokens may not support refresh
        throw IdentityProviderError.notSupported
    }
    
    func revokeAuthentication(token: String) async throws {
        currentUserId = nil
        mdmToken = nil
        tokenExpiresAt = nil
    }
    
    func getAccessToken() -> String? {
        return mdmToken
    }
}

// MARK: - MFA Identity Provider

/// MFA-based identity provider
/// Integrates with MFA solutions for additional authentication
final class MFAIdentityProvider: IdentityProvider {
    
    var providerId: String { "mfa_\(UUID().uuidString.prefix(8))" }
    var displayName: String { "MFA Provider" }
    var providerType: IdentityProviderType { .mfa }
    var isAuthenticated: Bool { mfaToken != nil }
    var currentAccessToken: String? { mfaToken }
    
    private var config: IdentityProviderConfig?
    private var mfaToken: String?
    private var tokenExpiresAt: Date?
    
    func configure(with config: IdentityProviderConfig) {
        self.config = config
    }
    
    func authenticate(credentials: AuthenticationCredentials, persona: Persona) async throws -> AuthenticationResult {
        guard let mfaTokenValue = credentials.mfaToken else {
            throw IdentityProviderError.mfaRequired
        }
        
        // Verify MFA token with MFA provider
        let verificationResult = try await verifyMFAToken(
            token: mfaTokenValue,
            userId: credentials.badgeId ?? ""
        )
        
        guard verificationResult.verified else {
            throw IdentityProviderError.mfaFailed(verificationResult.error ?? "Verification failed")
        }
        
        mfaToken = verificationResult.sessionToken
        tokenExpiresAt = Date().addingTimeInterval(TimeInterval(verificationResult.expiresIn))
        
        return AuthenticationResult(
            accessToken: verificationResult.sessionToken,
            refreshToken: nil,
            idToken: nil,
            expiry: tokenExpiresAt.map(ExpiryPolicy.expiresAt) ?? .expiresAt(.distantPast),
            userInfo: nil,
            persona: persona,
            providerSpecificData: ["mfa_provider": config?.mfaProvider?.rawValue ?? "unknown"]
        )
    }
    
    private func verifyMFAToken(token: String, userId: String) async throws -> MFAVerificationResult {
        guard let mfaHost = config?.mfaHost,
              let apiKey = config?.mfaApiKey else {
            throw IdentityProviderError.mfaNotConfigured
        }
        
        // Placeholder - implement actual MFA verification
        // Different MFA providers have different APIs
        
        throw IdentityProviderError.mfaNotConfigured
    }
    
    func refreshToken() async throws {
        throw IdentityProviderError.notSupported
    }
    
    func revokeAuthentication(token: String) async throws {
        mfaToken = nil
        tokenExpiresAt = nil
    }
    
    func getAccessToken() -> String? {
        return mfaToken
    }
}

// MARK: - Hybrid Identity Provider

/// Hybrid identity provider that combines multiple providers
/// For example: Badge + MFA, or MDM + OIDC
final class HybridIdentityProvider: IdentityProvider {
    
    var providerId: String { "hybrid_\(UUID().uuidString.prefix(8))" }
    var displayName: String { "Hybrid Authentication" }
    var providerType: IdentityProviderType { .hybrid }
    var isAuthenticated: Bool { primaryProvider?.isAuthenticated == true }
    var currentAccessToken: String? { primaryProvider?.currentAccessToken }
    
    private var config: IdentityProviderConfig?
    private var primaryProvider: IdentityProvider?
    private var secondaryProvider: IdentityProvider?
    
    func configure(with config: IdentityProviderConfig) {
        self.config = config
    }
    
    func authenticate(credentials: AuthenticationCredentials, persona: Persona) async throws -> AuthenticationResult {
        // First, authenticate with primary provider (e.g., badge-based)
        // Then, optionally verify with secondary provider (e.g., MFA)
        
        // This is a simplified example - actual implementation would be configurable
        
        guard let sessionToken = credentials.sessionToken else {
            throw IdentityProviderError.invalidCredentials
        }
        
        // Use OIDC as primary provider
        let oidcProvider = OIDCIdentityProvider()
        if let config = config {
            oidcProvider.configure(with: config)
        }
        
        let result = try await oidcProvider.authenticate(credentials: credentials, persona: persona)
        
        // If MFA token is provided, verify it
        if let mfaToken = credentials.mfaToken {
            let mfaProvider = MFAIdentityProvider()
            if let config = config {
                mfaProvider.configure(with: config)
            }
            
            let mfaCredentials = AuthenticationCredentials(
                credentialType: .mfa,
                badgeId: credentials.badgeId,
                sessionToken: nil,
                deviceId: credentials.deviceId,
                mdmUserId: credentials.mdmUserId,
                mfaToken: mfaToken,
                additionalData: nil
            )
            
            _ = try await mfaProvider.authenticate(credentials: mfaCredentials, persona: persona)
        }
        
        return result
    }
    
    func refreshToken() async throws {
        try await primaryProvider?.refreshToken()
    }
    
    func revokeAuthentication(token: String) async throws {
        try await primaryProvider?.revokeAuthentication(token: token)
        try await secondaryProvider?.revokeAuthentication(token: token)
    }
    
    func getAccessToken() -> String? {
        return primaryProvider?.getAccessToken()
    }
}

// MARK: - Identity Provider Errors

enum IdentityProviderError: LocalizedError {
    case invalidConfiguration
    case invalidCredentials
    case authenticationFailed
    case noRefreshToken
    case notSupported
    case mdmNotAvailable
    case mdmNotConfigured
    case mfaRequired
    case mfaNotConfigured
    case mfaFailed(String)
    case networkError
    
    var errorDescription: String? {
        switch self {
        case .invalidConfiguration:
            return "Identity provider configuration is invalid"
        case .invalidCredentials:
            return "Invalid authentication credentials"
        case .authenticationFailed:
            return "Authentication failed"
        case .noRefreshToken:
            return "No refresh token available"
        case .notSupported:
            return "This operation is not supported"
        case .mdmNotAvailable:
            return "MDM is not available on this device"
        case .mdmNotConfigured:
            return "MDM provider is not configured"
        case .mfaRequired:
            return "MFA verification is required"
        case .mfaNotConfigured:
            return "MFA provider is not configured"
        case .mfaFailed(let reason):
            return "MFA verification failed: \(reason)"
        case .networkError:
            return "Network error during authentication"
        }
    }
}

// MARK: - Response Models

struct MDMSessionResponse: Codable {
    let sessionToken: String
    let expiresIn: Int
}

struct MFAVerificationResult {
    let verified: Bool
    let sessionToken: String
    let expiresIn: Int
    let error: String?
}
