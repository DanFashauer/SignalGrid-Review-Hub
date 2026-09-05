import Foundation
import UIKit

/// Protocol defining the interface for identity providers.
///
/// Two implementations exist and both are constructed directly by
/// `ProviderConfigurationService.initializeProviders()` through
/// `IdentityProviders.make(for:)`: `OIDCIdentityProvider` (chosen explicitly with
/// `IDENTITY_PROVIDER_TYPE=oidc`) and `ControlPlaneSessionIdentityProvider` (the
/// default). The MDM, MFA and Hybrid providers and the plug-in registry that held
/// them were retired on 2026-09-05 (Ponytail audit 2026-09-01, the `yagni:` item
/// ECC confirmed): the MDM provider's identity lookup was a `return nil`
/// placeholder — and an app cannot read MDM identity at all (CLAUDE.md rule 4) —
/// the MFA provider's verification always threw `mfaNotConfigured`, and Hybrid
/// composed those two stubs. A second factor that does not exist must not be
/// selectable by configuration, so the types are gone, not just unregistered.
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

/// The identity providers this build can construct. The raw values are the
/// external contract that `IDENTITY_PROVIDER_TYPE` (simulator / launch argument) and
/// the managed `identity_provider_type` key are decoded into. A value outside this
/// enum is REFUSED by `ProviderConfigurationService` — no provider, authentication
/// fails closed, and the audit record names the value — never mapped to the
/// default. The retired `mdm`, `mfa`, `hybrid`, `saml` and `custom` values fall in
/// that class on purpose: a device an MDM configured for a factor this build does
/// not have must say so, not quietly authenticate some other way.
enum IdentityProviderType: String, Codable, CaseIterable {
    case oidc = "oidc"                                     // OpenID Connect via the backend token exchange
    case controlPlaneSession = "control_plane_session"     // the control plane's own session (the default)

    var displayName: String {
        switch self {
        case .oidc:
            return "OpenID Connect (OIDC)"
        case .controlPlaneSession:
            return "Control-plane session"
        }
    }
}

/// Authentication credentials from badge scan
struct AuthenticationCredentials {
    let credentialType: CredentialType
    let badgeId: String?
    let sessionToken: String?
    let deviceId: String?
    let additionalData: [String: String]?

    enum CredentialType: String, Codable {
        case badge = "badge"
        case sessionToken = "session_token"
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

/// Identity provider configuration. Only the OIDC provider reads any of it; the
/// control-plane session provider carries the `controlPlaneSession` record so the
/// configuration the audit trail reports matches the provider that was built.
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

    /// Fields still holding a template placeholder (`<...>` or `YOUR_`). A config
    /// with any is refused by the providers: `<YOUR_TENANT_ID>` makes
    /// `URL(string:)` nil, which used to be a crash rather than an error.
    var placeholderFields: [String] {
        let candidates: [(String, String?)] = [
            ("clientId", clientId), ("tenantId", tenantId),
            ("authorizationEndpoint", authorizationEndpoint), ("tokenEndpoint", tokenEndpoint),
            ("issuer", issuer)
        ]
        return candidates.compactMap { name, value in
            guard let value = value else { return nil }
            return (value.contains("<") || value.contains(">") || value.contains("YOUR_")) ? name : nil
        }
    }

    // Default OIDC configuration (Microsoft Entra ID). TEMPLATE: the placeholders
    // are refused at authenticate time; the shell's default identity provider is
    // ControlPlaneSessionIdentityProvider unless IDENTITY_PROVIDER_TYPE is set.
    static let defaultMicrosoftEntraID = IdentityProviderConfig(
        providerType: .oidc,
        clientId: "<YOUR_CLIENT_ID>",
        tenantId: "<YOUR_TENANT_ID>",
        redirectUri: "com.enterprise.shell://auth/callback",
        scopes: ["openid", "profile", "email", "User.Read"],
        authorizationEndpoint: "https://login.microsoftonline.com/<TENANT>/oauth2/v2.0/authorize",
        tokenEndpoint: "https://login.microsoftonline.com/<TENANT>/oauth2/v2.0/token",
        issuer: "https://login.microsoftonline.com/<TENANT>/v2.0"
    )

    /// The record the default provider carries. It reads none of these fields.
    static let controlPlaneSession = IdentityProviderConfig(
        providerType: .controlPlaneSession,
        clientId: nil,
        tenantId: nil,
        redirectUri: nil,
        scopes: nil,
        authorizationEndpoint: nil,
        tokenEndpoint: nil,
        issuer: nil
    )
}

/// Constructs the one provider a configuration names.
///
/// Exhaustive over `IdentityProviderType` with NO default arm, so adding a type is
/// a compile error here until it says which class implements it. The registry this
/// replaces keyed a dictionary by type and answered `nil` for anything unregistered
/// — which is how `saml` and `custom` stayed selectable for a year with no class
/// behind them, and how the unregistered answer was indistinguishable from a
/// misconfiguration.
enum IdentityProviders {
    static func make(for config: IdentityProviderConfig) -> IdentityProvider {
        switch config.providerType {
        case .oidc:
            let provider = OIDCIdentityProvider()
            provider.configure(with: config)
            return provider
        case .controlPlaneSession:
            return ControlPlaneSessionIdentityProvider()
        }
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
        // Refuse a configuration that still holds template placeholders, by name.
        if let config = config, !config.placeholderFields.isEmpty {
            throw IdentityProviderError.placeholderConfiguration(config.placeholderFields)
        }

        // Exchange session token for OIDC tokens via backend
        return try await exchangeSessionToken(sessionToken: sessionToken)
    }

    private func exchangeSessionToken(sessionToken: String) async throws -> AuthenticationResult {
        // NOTE: the served /v1 surface has no `/api/auth/exchange-token` route
        // (lib/api-spec/v1-openapi.yaml). Against this repo's api-server this
        // answers 404; it is kept for a backend that provides the route.
        // A REFUSED backend throws its own error here (tri-state); only absent is
        // "not configured for this provider".
        guard let base = try BackendService.requiredBaseURL() else {
            throw IdentityProviderError.invalidConfiguration
        }
        let backendTokenUrl = base.appendingPathComponent("api/auth/exchange-token")

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

        // Notify backend of logout (no such route on the served surface; skipped
        // entirely when no backend is configured).
        if let base = BackendService.baseURL {
            let backendLogoutUrl = base.appendingPathComponent("api/auth/logout")
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

// MARK: - Identity Provider Errors

enum IdentityProviderError: LocalizedError {
    case invalidConfiguration
    /// Named config fields still hold `<...>` / `YOUR_` template values.
    case placeholderConfiguration([String])
    case invalidCredentials
    case authenticationFailed
    case noRefreshToken
    case notSupported
    case networkError

    var errorDescription: String? {
        switch self {
        case .invalidConfiguration:
            return "Identity provider configuration is invalid"
        case .placeholderConfiguration(let fields):
            return "Identity provider configuration still holds template placeholders in: "
                + fields.joined(separator: ", ")
        case .invalidCredentials:
            return "Invalid authentication credentials"
        case .authenticationFailed:
            return "Authentication failed"
        case .noRefreshToken:
            return "No refresh token available"
        case .notSupported:
            return "This operation is not supported"
        case .networkError:
            return "Network error during authentication"
        }
    }
}

// MARK: - Control-plane session identity provider (the default)

/// The identity provider used when none is configured explicitly
/// (`IDENTITY_PROVIDER_TYPE` unset) or when it is set to `control_plane_session`.
/// The served `/v1` surface (`lib/api-spec/v1-openapi.yaml`) has NO token-exchange
/// route — `/api/auth/*` does not exist — so the session the control plane minted at
/// `POST /api/v1/sessions/start` IS the authenticated session: its id is the
/// session token, its `expiresAt` is the expiry, and refresh is
/// `POST /api/v1/sessions/{id}/refresh`. A local/offline session (no backend, on
/// an unmanaged device) has the same shape with a local expiry.
///
/// Fail closed: a session whose expiry was not stated is refused — an unknown
/// expiry must never read as a live session (see `ExpiryPolicy`).
final class ControlPlaneSessionIdentityProvider: IdentityProvider {
    var providerId: String { "control_plane_session" }
    var displayName: String { "Control-plane session" }
    var providerType: IdentityProviderType { .controlPlaneSession }
    var isAuthenticated: Bool { sessionId != nil }
    var currentAccessToken: String? { sessionId }

    private var sessionId: String?
    /// The expiry the server (or the local session) last stated.
    private(set) var expiresAt: Date?

    func configure(with config: IdentityProviderConfig) {}

    func authenticate(credentials: AuthenticationCredentials, persona: Persona) async throws -> AuthenticationResult {
        guard let token = credentials.sessionToken, !token.isEmpty else {
            throw IdentityProviderError.invalidCredentials
        }
        guard let expiry = ISO8601Wire.parse(credentials.additionalData?["expiresAt"]) else {
            throw IdentityProviderError.invalidConfiguration
        }
        sessionId = token
        expiresAt = expiry
        return AuthenticationResult(
            accessToken: token,
            refreshToken: nil,
            idToken: nil,
            expiry: .expiresAt(expiry),
            userInfo: nil,
            persona: persona,
            providerSpecificData: ["source": token.hasPrefix("local-") ? "local" : "control-plane"]
        )
    }

    /// Extend the session. Remote sessions go through `sessions/{id}/refresh`; a
    /// local session extends locally. Throws when the server refuses, so the
    /// caller reports that rather than a canned success.
    func refreshToken() async throws {
        guard let id = sessionId else { throw IdentityProviderError.noRefreshToken }
        if id.hasPrefix("local-") {
            expiresAt = Date().addingTimeInterval(3600)
            return
        }
        guard let newExpiry = try await BackendService.shared.refreshSession(sessionId: id) else {
            throw IdentityProviderError.notSupported
        }
        expiresAt = newExpiry
    }

    /// The remote session end itself is `BackendService.endSession`, which the
    /// session machine calls after this; here only the local handle is dropped.
    func revokeAuthentication(token: String) async throws {
        sessionId = nil
        expiresAt = nil
    }

    /// The credential the control plane requires on every call is the TENANT
    /// bearer, not the session id.
    func getAccessToken() -> String? {
        BackendService.tenantBearerToken
    }
}
