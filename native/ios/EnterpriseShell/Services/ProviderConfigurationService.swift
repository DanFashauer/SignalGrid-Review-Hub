import Foundation

/// Central configuration service for badge reader and identity provider integration.
///
/// Reduced on 2026-09-05 (Ponytail audit 2026-09-01, `delete:` item): the seven
/// preset `AppConfiguration`s, the update/available-types/description accessors, and
/// the `SecurityConfig` / `BackendConfig` mirrors with their eleven `SEC_*` /
/// `CERT_*` / `BACKEND_TIMEOUT` environment reads had no caller and fed nothing but
/// an uncalled description string — `SecurityManager` and `BackendService` read their
/// own configuration. What remains is what the app actually consumes: the configured
/// badge reader, the configured identity provider, and the two lock-screen facts
/// about them.
final class ProviderConfigurationService {

    // MARK: - Singleton

    static let shared = ProviderConfigurationService()

    // MARK: - Configuration

    /// The two provider choices the app is built from.
    struct AppConfiguration: Codable {
        var badgeReader: BadgeReaderConfig
        var identityProvider: IdentityProviderConfig
    }

    /// How the identity provider was chosen. `unrecognised` is the fail-closed arm:
    /// an explicit value this build cannot construct yields NO provider (so
    /// authentication is refused — SessionStateManager throws "No identity provider
    /// configured") and the audit record names the value. It is never mapped to the
    /// default; a device an MDM configured for a factor that does not exist here must
    /// say so rather than quietly authenticate another way.
    private enum IdentitySelection {
        case defaulted
        case explicit(IdentityProviderType)
        case unrecognised(String)
    }

    // MARK: - Properties

    private var configuration: AppConfiguration
    private let identitySelection: IdentitySelection
    private var badgeReaderProvider: BadgeReaderProvider?
    private var identityProvider: IdentityProvider?
    /// Set when the configured reader type has no provider in this build; the lock
    /// screen shows it in its footer.
    private(set) var badgeReaderUnavailableReason: String?
    /// Set when `IDENTITY_PROVIDER_TYPE` / the managed key named a provider this
    /// build cannot construct (the retired `mdm`, `mfa`, `hybrid`, `saml`, `custom`
    /// values land here). While set, `getIdentityProvider()` is nil on a device.
    private(set) var identityProviderUnavailableReason: String?

    // Managed App Configuration keys
    private enum ConfigKeys {
        static let badgeReaderType = "badge_reader_type"
        static let identityProviderType = "identity_provider_type"
    }

    /// Configuration an MDM pushed to this device, under the key Apple reserves for
    /// Managed App Configuration. This is the ONLY one of the sources below that
    /// exists on a shipped device: process environment is a simulator/launch-argument
    /// affordance, so without this a supervised device had no way to be told which badge
    /// reader or identity provider to use — the comment here once promised a UserDefaults
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
    /// process environment can never outrank what the MDM pushed — the provider choice
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
        let loaded = Self.loadConfiguration()
        self.configuration = loaded.configuration
        self.identitySelection = loaded.identitySelection
        initializeProviders()
    }

    // MARK: - Configuration Loading

    private static func loadConfiguration() -> (configuration: AppConfiguration, identitySelection: IdentitySelection) {
        // Managed App Configuration when present (simulator env may override), else
        // environment, else defaults — see configured(env:managed:).
        let readerType = configured(env: "BADGE_READER_TYPE", managed: ConfigKeys.badgeReaderType)
        let providerType = configured(env: "IDENTITY_PROVIDER_TYPE", managed: ConfigKeys.identityProviderType)

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

        // Identity provider. Three outcomes, kept distinct on purpose: nothing
        // configured (the control-plane session default), a recognised explicit type,
        // or an explicit value this build cannot construct — which is recorded, not
        // corrected. The template OIDC config holds placeholders that the provider
        // refuses at authenticate time (see IdentityProviderConfig.placeholderFields).
        let identityProviderConfig: IdentityProviderConfig
        let identitySelection: IdentitySelection
        if let raw = providerType {
            if let providerTypeEnum = IdentityProviderType(rawValue: raw) {
                identitySelection = .explicit(providerTypeEnum)
                switch providerTypeEnum {
                case .oidc:
                    identityProviderConfig = IdentityProviderConfig(
                        providerType: .oidc,
                        clientId: ProcessInfo.processInfo.environment["OIDC_CLIENT_ID"],
                        tenantId: ProcessInfo.processInfo.environment["OIDC_TENANT_ID"],
                        redirectUri: ProcessInfo.processInfo.environment["OIDC_REDIRECT_URI"],
                        scopes: ProcessInfo.processInfo.environment["OIDC_SCOPES"]?
                            .split(separator: ",").map(String.init),
                        authorizationEndpoint: ProcessInfo.processInfo.environment["OIDC_AUTH_ENDPOINT"],
                        tokenEndpoint: ProcessInfo.processInfo.environment["OIDC_TOKEN_ENDPOINT"],
                        issuer: ProcessInfo.processInfo.environment["OIDC_ISSUER"]
                    )
                case .controlPlaneSession:
                    identityProviderConfig = .controlPlaneSession
                }
            } else {
                identitySelection = .unrecognised(raw)
                identityProviderConfig = .controlPlaneSession
            }
        } else {
            identitySelection = .defaulted
            identityProviderConfig = .controlPlaneSession
        }

        return (
            AppConfiguration(badgeReader: badgeReaderConfig, identityProvider: identityProviderConfig),
            identitySelection
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

        // Initialize identity provider. The default is the control-plane session
        // provider: the served /v1 surface has no token-exchange route. An explicit
        // recognised type is constructed through the exhaustive switch in
        // IdentityProviders.make(for:). An unrecognised explicit value constructs
        // NOTHING — authentication then fails closed at SessionStateManager — and is
        // named in the audit record below.
        switch identitySelection {
        case .defaulted:
            identityProvider = ControlPlaneSessionIdentityProvider()
            identityProviderUnavailableReason = nil
        case .explicit:
            identityProvider = IdentityProviders.make(for: configuration.identityProvider)
            identityProviderUnavailableReason = nil
        case .unrecognised(let raw):
            identityProvider = nil
            identityProviderUnavailableReason =
                "IDENTITY_PROVIDER_TYPE '\(raw)' names no identity provider in this build " +
                "(accepted: \(IdentityProviderType.allCases.map(\.rawValue).joined(separator: ", "))); " +
                "authentication is refused until it is corrected"
        }

        // Log initialization. The identity type logged is the PROVIDER's, not the
        // configuration record's, so the trail says what was actually built.
        var metadata: [String: String] = [
            "badgeReaderType": configuration.badgeReader.readerType.rawValue,
            "identityProviderType": identityProvider?.providerType.rawValue ?? "none"
        ]
        if let reason = identityProviderUnavailableReason {
            metadata["identityProviderUnavailable"] = reason
        }
        AuditLogger.shared.log(event: .providerConfigurationLoaded, metadata: metadata)
    }

    // MARK: - Public Accessors

    /// Get the configured badge reader provider
    func getBadgeReaderProvider() -> BadgeReaderProvider? {
        return badgeReaderProvider
    }

    /// Get the configured identity provider. Nil when the configured type is one this
    /// build cannot construct — see `identityProviderUnavailableReason`.
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
}
