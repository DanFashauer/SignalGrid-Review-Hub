import Foundation

/// Central configuration service for badge reader and identity provider integration
/// This allows flexible mixing and matching of different providers
final class ProviderConfigurationService {
    
    // MARK: - Singleton
    
    static let shared = ProviderConfigurationService()
    
    // MARK: - Configuration
    
    /// Complete application configuration
    struct AppConfiguration: Codable {
        var badgeReader: BadgeReaderConfig
        var identityProvider: IdentityProviderConfig
        let security: SecurityConfig
        let backend: BackendConfig
        
        /// Default configuration - can be overridden
        static let `default` = AppConfiguration(
            badgeReader: .defaultKeyboardWedge,
            identityProvider: .defaultMicrosoftEntraID,
            security: .default,
            backend: .default
        )
    }
    
    /// Security configuration
    struct SecurityConfig: Codable {
        let enableRateLimiting: Bool
        let rateLimitAttempts: Int
        let rateLimitWindow: TimeInterval
        let lockoutDuration: TimeInterval
        let enableBadgeValidation: Bool
        let enableRequestSigning: Bool
        let enableDeviceBinding: Bool
        let maxBadgeLength: Int
        
        static let `default` = SecurityConfig(
            enableRateLimiting: true,
            rateLimitAttempts: 5,
            rateLimitWindow: 60,
            lockoutDuration: 300,
            enableBadgeValidation: true,
            enableRequestSigning: true,
            enableDeviceBinding: true,
            maxBadgeLength: 50
        )
    }
    
    /// Backend configuration
    struct BackendConfig: Codable {
        let baseUrl: String
        let enableCertificatePinning: Bool
        let certificateHashes: [String]
        let timeout: TimeInterval
        
        /// No placeholder host. The live base URL is `BackendService.resolveBaseURL()`
        /// (managed config → launch argument → environment → nil); this record only
        /// mirrors the environment value for the setup description.
        static let `default` = BackendConfig(
            baseUrl: "",
            enableCertificatePinning: false,
            certificateHashes: [],
            timeout: 30
        )
    }
    
    // MARK: - Properties
    
    private var configuration: AppConfiguration
    private var badgeReaderProvider: BadgeReaderProvider?
    private var identityProvider: IdentityProvider?
    /// True only when a provider type was chosen explicitly (IDENTITY_PROVIDER_TYPE
    /// or updateConfiguration). The template default is NOT a choice.
    private var identityProviderExplicit: Bool
    /// Set when the configured reader type has no provider in this build; the lock
    /// screen shows it in its footer.
    private(set) var badgeReaderUnavailableReason: String?
    
    // User defaults keys
    private enum ConfigKeys {
        static let badgeReaderType = "badge_reader_type"
        static let identityProviderType = "identity_provider_type"
        static let customConfig = "custom_provider_config"
        /// SAME key `KioskConfig.backendBaseURL` reads — the live resolution is
        /// `BackendService.resolveBaseURL()`; this record only mirrors it for the setup
        /// description. Two spellings for one URL would let an MDM set the one nothing
        /// reads, so there is one.
        static let backendBaseUrl = "BackendBaseURL"
    }

    /// Configuration an MDM pushed to this device, under the key Apple reserves for
    /// Managed App Configuration. This is the ONLY one of the three sources below that
    /// exists on a shipped device: process environment is a simulator/launch-argument
    /// affordance, so without this a supervised device had no way to be told which badge
    /// reader or identity provider to use — the comment here promised a UserDefaults
    /// fallback and none was written, and `ConfigKeys` was referenced nowhere at all.
    /// Same accessor shape as `KioskConfig` in KioskController.swift, deliberately.
    private static var managedConfiguration: [String: Any]? {
        UserDefaults.standard.dictionary(forKey: "com.apple.configuration.managed")
    }

    /// Same precedence as `KioskConfig.managedString`: a PRESENT managed dictionary
    /// answers only from itself — a key it lacks is an absent value, never the
    /// environment. The environment arm exists for the simulator (a launch argument or
    /// Xcode scheme standing in for MDM) and for a device with NO managed dictionary at
    /// all; on a managed device it is compiled out, so `IDENTITY_PROVIDER_TYPE` in the
    /// process environment can never outrank what the MDM pushed — `identityProviderExplicit`
    /// is an authentication decision, and the first cut read the environment FIRST on
    /// every build. Callers supply the default.
    private static func configured(env: String, managed: String) -> String? {
        if let dict = managedConfiguration {
            #if targetEnvironment(simulator)
            if let value = ProcessInfo.processInfo.environment[env], !value.isEmpty { return value }
            #endif
            if let value = dict[managed] as? String, !value.isEmpty { return value }
            return nil
        }
        if let value = ProcessInfo.processInfo.environment[env], !value.isEmpty { return value }
        return nil
    }
    
    // MARK: - Initialization
    
    private init() {
        // Load configuration from environment or defaults
        self.configuration = Self.loadConfiguration()
        // Explicit from whichever source `configured(env:managed:)` answers from — the
        // managed key an MDM pushed, or the environment on a simulator / unmanaged
        // build. Consulting only the environment here would load a managed
        // `identity_provider_type` and then ignore it in initializeProviders().
        self.identityProviderExplicit = Self.configured(env: "IDENTITY_PROVIDER_TYPE", managed: ConfigKeys.identityProviderType)
            .flatMap { IdentityProviderType(rawValue: $0) } != nil
        initializeProviders()
    }
    
    // MARK: - Configuration Loading
    
    private static func loadConfiguration() -> AppConfiguration {
        // Managed App Configuration when present (simulator env may override), else
        // environment, else defaults — see configured(env:managed:).
        let readerType = configured(env: "BADGE_READER_TYPE", managed: ConfigKeys.badgeReaderType)
        let providerType = configured(env: "IDENTITY_PROVIDER_TYPE", managed: ConfigKeys.identityProviderType)
        let backendUrl = configured(env: "BACKEND_BASE_URL", managed: ConfigKeys.backendBaseUrl)
        
        var badgeReaderConfig: BadgeReaderConfig
        if let type = readerType, let readerTypeEnum = BadgeReaderType(rawValue: type) {
            badgeReaderConfig = BadgeReaderConfig(
                readerType: readerTypeEnum,
                protocolString: ProcessInfo.processInfo.environment["BADGE_READER_PROTOCOL"],
                serviceUUID: ProcessInfo.processInfo.environment["BADGE_READER_SERVICE_UUID"],
                characteristicUUID: ProcessInfo.processInfo.environment["BADGE_READER_CHAR_UUID"],
                webhookURL: ProcessInfo.processInfo.environment["BADGE_WEBHOOK_URL"],
                webhookSecret: ProcessInfo.processInfo.environment["BADGE_WEBHOOK_SECRET"],
                serialPort: ProcessInfo.processInfo.environment["BADGE_SERIAL_PORT"],
                baudRate: ProcessInfo.processInfo.environment["BADGE_BAUD_RATE"].flatMap { Int($0) },
                mdmProvider: nil
            )
        } else {
            badgeReaderConfig = .defaultKeyboardWedge
        }
        
        var identityProviderConfig: IdentityProviderConfig
        if let type = providerType, let providerTypeEnum = IdentityProviderType(rawValue: type) {
            identityProviderConfig = IdentityProviderConfig(
                providerType: providerTypeEnum,
                clientId: ProcessInfo.processInfo.environment["OIDC_CLIENT_ID"],
                tenantId: ProcessInfo.processInfo.environment["OIDC_TENANT_ID"],
                redirectUri: ProcessInfo.processInfo.environment["OIDC_REDIRECT_URI"],
                scopes: ProcessInfo.processInfo.environment["OIDC_SCOPES"]?.split(separator: ",").map(String.init),
                authorizationEndpoint: ProcessInfo.processInfo.environment["OIDC_AUTH_ENDPOINT"],
                tokenEndpoint: ProcessInfo.processInfo.environment["OIDC_TOKEN_ENDPOINT"],
                issuer: ProcessInfo.processInfo.environment["OIDC_ISSUER"],
                samlEntryPoint: ProcessInfo.processInfo.environment["SAML_ENTRY_POINT"],
                samlLogoutUrl: ProcessInfo.processInfo.environment["SAML_LOGOUT_URL"],
                certificate: ProcessInfo.processInfo.environment["SAML_CERTIFICATE"],
                mdmProvider: ProcessInfo.processInfo.environment["MDM_PROVIDER"].flatMap { MDMProviderType(rawValue: $0) },
                enrollmentEndpoint: ProcessInfo.processInfo.environment["MDM_ENROLLMENT_ENDPOINT"],
                mfaProvider: ProcessInfo.processInfo.environment["MFA_PROVIDER"].flatMap { MFAProviderType(rawValue: $0) },
                mfaApiKey: ProcessInfo.processInfo.environment["MFA_API_KEY"],
                mfaHost: ProcessInfo.processInfo.environment["MFA_HOST"],
                customEndpoint: ProcessInfo.processInfo.environment["CUSTOM_AUTH_ENDPOINT"],
                customApiKey: ProcessInfo.processInfo.environment["CUSTOM_AUTH_API_KEY"]
            )
        } else {
            identityProviderConfig = .defaultMicrosoftEntraID
        }
        
        let securityConfig = SecurityConfig(
            enableRateLimiting: ProcessInfo.processInfo.environment["SEC_RATE_LIMITING"]?.lowercased() == "true",
            rateLimitAttempts: ProcessInfo.processInfo.environment["SEC_RATE_LIMIT_ATTEMPTS"].flatMap { Int($0) } ?? 5,
            rateLimitWindow: ProcessInfo.processInfo.environment["SEC_RATE_LIMIT_WINDOW"].flatMap { Double($0) } ?? 60,
            lockoutDuration: ProcessInfo.processInfo.environment["SEC_LOCKOUT_DURATION"].flatMap { Double($0) } ?? 300,
            enableBadgeValidation: ProcessInfo.processInfo.environment["SEC_BADGE_VALIDATION"]?.lowercased() != "false",
            enableRequestSigning: ProcessInfo.processInfo.environment["SEC_REQUEST_SIGNING"]?.lowercased() != "false",
            enableDeviceBinding: ProcessInfo.processInfo.environment["SEC_DEVICE_BINDING"]?.lowercased() != "false",
            maxBadgeLength: ProcessInfo.processInfo.environment["SEC_MAX_BADGE_LENGTH"].flatMap { Int($0) } ?? 50
        )
        
        let backendConfig = BackendConfig(
            baseUrl: backendUrl ?? "",
            enableCertificatePinning: ProcessInfo.processInfo.environment["CERT_PINNING_ENABLED"]?.lowercased() == "true",
            certificateHashes: ProcessInfo.processInfo.environment["CERT_HASHES"]?.split(separator: ",").map(String.init) ?? [],
            timeout: ProcessInfo.processInfo.environment["BACKEND_TIMEOUT"].flatMap { Double($0) } ?? 30
        )
        
        return AppConfiguration(
            badgeReader: badgeReaderConfig,
            identityProvider: identityProviderConfig,
            security: securityConfig,
            backend: backendConfig
        )
    }
    
    // MARK: - Provider Initialization
    
    private func initializeProviders() {
        // Initialize badge reader provider. A declared-but-unimplemented type is
        // recorded here so the lock screen can say so instead of waiting forever.
        badgeReaderUnavailableReason = BadgeReaderProviderFactory.shared.unavailableReason(
            for: configuration.badgeReader.readerType
        )
        badgeReaderProvider = BadgeReaderProviderFactory.shared.createProvider(
            config: configuration.badgeReader
        )
        
        // Initialize identity provider. Unless one was chosen explicitly, the
        // default is the control-plane session provider: the served /v1 surface has
        // no token-exchange route, and the template OIDC config holds placeholders
        // that are refused (see IdentityProviderConfig.placeholderFields).
        if identityProviderExplicit {
            identityProvider = IdentityProviderFactory.shared.createProvider(
                config: configuration.identityProvider
            )
        } else {
            identityProvider = ControlPlaneSessionIdentityProvider()
        }
        
        // Log initialization
        AuditLogger.shared.log(event: .providerConfigurationLoaded, metadata: [
            "badgeReaderType": configuration.badgeReader.readerType.rawValue,
            "identityProviderType": configuration.identityProvider.providerType.rawValue
        ])
    }
    
    // MARK: - Public Accessors
    
    /// Get the configured badge reader provider
    func getBadgeReaderProvider() -> BadgeReaderProvider? {
        return badgeReaderProvider
    }
    
    /// Get the configured identity provider
    func getIdentityProvider() -> IdentityProvider? {
        #if targetEnvironment(simulator)
        if DemoMode.isEnabled { return DemoIdentityProvider() }
        #endif
        return identityProvider
    }
    
    /// Get the current configuration
    func getConfiguration() -> AppConfiguration {
        return configuration
    }
    
    /// What the lock screen should say about the CONFIGURED reader — not the legacy
    /// `BadgeReaderManager`, which nothing configures. `ready` drives the spinner.
    func badgeReaderStatus() -> (text: String, ready: Bool) {
        let type = configuration.badgeReader.readerType
        guard let provider = badgeReaderProvider else {
            return (badgeReaderUnavailableReason ?? "No badge reader provider", false)
        }
        switch type {
        case .keyboardWedge:
            return ("\(provider.displayName) — ready; an HID reader types into this screen", true)
        case .httpWebhook, .mdmEnrollment:
            return ("\(provider.displayName) — passive; waiting for an event", false)
        default:
            return provider.isConnected
                ? ("\(provider.displayName) connected — Ready to scan", true)
                : ("\(provider.displayName) configured — not connected", false)
        }
    }
    
    /// Update the configuration
    func updateConfiguration(_ newConfig: AppConfiguration) {
        self.configuration = newConfig
        self.identityProviderExplicit = true
        initializeProviders()
        
        AuditLogger.shared.log(event: .providerConfigurationUpdated, metadata: [
            "badgeReaderType": configuration.badgeReader.readerType.rawValue,
            "identityProviderType": configuration.identityProvider.providerType.rawValue
        ])
    }
    
    /// Update badge reader configuration
    func updateBadgeReader(config: BadgeReaderConfig) {
        var newConfig = self.configuration
        newConfig.badgeReader = config
        updateConfiguration(newConfig)
    }
    
    /// Update identity provider configuration
    func updateIdentityProvider(config: IdentityProviderConfig) {
        var newConfig = self.configuration
        newConfig.identityProvider = config
        updateConfiguration(newConfig)
    }
    
    // MARK: - Available Options
    
    /// Get all available badge reader types
    func getAvailableBadgeReaderTypes() -> [BadgeReaderType] {
        return BadgeReaderProviderFactory.shared.availableReaderTypes()
    }
    
    /// Get all available identity provider types
    func getAvailableIdentityProviderTypes() -> [IdentityProviderType] {
        return IdentityProviderFactory.shared.availableProviderTypes()
    }
    
    /// Get a description of the current setup
    func getCurrentSetupDescription() -> String {
        return """
        Current Configuration:
        - Badge Reader: \(configuration.badgeReader.readerType.displayName)
        - Identity Provider: \(configuration.identityProvider.providerType.displayName)
        - Backend: \(BackendService.baseURL?.absoluteString ?? "(none — local/offline)")
        - Rate Limiting: \(configuration.security.enableRateLimiting ? "Enabled" : "Disabled")
        - Request Signing: \(configuration.security.enableRequestSigning ? "Enabled" : "Disabled")
        - Device Binding: \(configuration.security.enableDeviceBinding ? "Enabled" : "Disabled")
        """
    }
}

// MARK: - Preset Configurations

extension ProviderConfigurationService {
    
    /// Preset configurations for common deployment scenarios
    
    /// Standard badge reader with Microsoft Entra ID
    static let standardMicrosoftEntraID = AppConfiguration(
        badgeReader: .defaultKeyboardWedge,
        identityProvider: .defaultMicrosoftEntraID,
        security: .default,
        backend: .default
    )
    
    /// USB badge reader with Microsoft Entra ID
    static let usbMicrosoftEntraID = AppConfiguration(
        badgeReader: .defaultUSB,
        identityProvider: .defaultMicrosoftEntraID,
        security: .default,
        backend: .default
    )
    
    /// BLE badge reader with Microsoft Entra ID (MVP)
    static let bleMicrosoftEntraID = AppConfiguration(
        badgeReader: .defaultBLE,
        identityProvider: .defaultMicrosoftEntraID,
        security: .default,
        backend: .default
    )
    
    /// MDM-based authentication with Intune
    static let mdmIntune = AppConfiguration(
        badgeReader: BadgeReaderConfig(
            readerType: .mdmEnrollment,
            protocolString: nil,
            serviceUUID: nil,
            characteristicUUID: nil,
            webhookURL: nil,
            webhookSecret: nil,
            serialPort: nil,
            baudRate: nil,
            mdmProvider: MDMProviderConfig(
                providerType: .microsoftIntune,
                enrollmentEndpoint: "",
                apiKey: nil,
                certificatePath: nil,
                additionalConfig: nil
            )
        ),
        identityProvider: .defaultMDM,
        security: .default,
        backend: .default
    )
    
    /// Badge reader with Okta OIDC
    static let badgeOkta = AppConfiguration(
        badgeReader: .defaultKeyboardWedge,
        identityProvider: IdentityProviderConfig(
            providerType: .oidc,
            clientId: "<OKTA_CLIENT_ID>",
            tenantId: "<OKTA_DOMAIN>",
            redirectUri: "com.enterprise.shell://auth/callback",
            scopes: ["openid", "profile", "email"],
            authorizationEndpoint: "https://<OKTA_DOMAIN>/oauth2/v1/authorize",
            tokenEndpoint: "https://<OKTA_DOMAIN>/oauth2/v1/token",
            issuer: "https://<OKTA_DOMAIN>/oauth2/default",
            samlEntryPoint: nil,
            samlLogoutUrl: nil,
            certificate: nil,
            mdmProvider: nil,
            enrollmentEndpoint: "",
            mfaProvider: nil,
            mfaApiKey: nil,
            mfaHost: nil,
            customEndpoint: nil,
            customApiKey: nil
        ),
        security: .default,
        backend: .default
    )
    
    /// Badge reader with MFA (Duo)
    static let badgeWithMFA = AppConfiguration(
        badgeReader: .defaultKeyboardWedge,
        identityProvider: IdentityProviderConfig(
            providerType: .mfa,
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
            mdmProvider: nil,
            enrollmentEndpoint: "",
            mfaProvider: .duo,
            mfaApiKey: nil,
            mfaHost: nil,
            customEndpoint: nil,
            customApiKey: nil
        ),
        security: .default,
        backend: .default
    )
    
    /// Hybrid: Badge + MFA with Microsoft Entra ID
    static let hybridBadgeMFA = AppConfiguration(
        badgeReader: .defaultKeyboardWedge,
        identityProvider: IdentityProviderConfig(
            providerType: .hybrid,
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
            enrollmentEndpoint: "",
            mfaProvider: .duo,
            mfaApiKey: nil,
            mfaHost: nil,
            customEndpoint: nil,
            customApiKey: nil
        ),
        security: .default,
        backend: .default
    )
}
