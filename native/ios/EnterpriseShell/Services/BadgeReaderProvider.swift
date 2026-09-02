import Foundation
import UIKit

/// Protocol defining the interface for badge reader providers
/// Allows integration with any badge reader system (USB, Bluetooth, NFC, serial, etc.)
protocol BadgeReaderProvider: AnyObject {
    /// Unique identifier for this provider
    var providerId: String { get }
    
    /// Human-readable name for the provider
    var displayName: String { get }
    
    /// Whether the reader is currently connected
    var isConnected: Bool { get }
    
    /// Delegate for receiving badge events
    var delegate: BadgeReaderProviderDelegate? { get set }
    
    /// Initialize and start monitoring for badge readers
    func setup()
    
    /// Stop monitoring and cleanup resources
    func teardown()
    
    /// Reset reader state for next user
    func resetReaderState()
    
    /// Send a command to the badge reader (optional)
    func sendCommand(_ command: Data) throws
}

/// Delegate protocol for badge reader events
protocol BadgeReaderProviderDelegate: AnyObject {
    func badgeReader(_ provider: BadgeReaderProvider, didReadBadge badgeId: String)
    func badgeReader(_ provider: BadgeReaderProvider, didFailWithError error: Error)
    func badgeReaderDidDisconnect(_ provider: BadgeReaderProvider)
    func badgeReaderDidConnect(_ provider: BadgeReaderProvider)
}

/// Type of badge reader connection
enum BadgeReaderType: String, Codable, CaseIterable {
    case usbAccessory = "usb_accessory"      // Legacy shim over BadgeReaderManager
    case usbC = "usbc"                       // USB-C/Lightning via External Accessory
    case bluetoothLE = "bluetooth_le"       // Bluetooth Low Energy badge readers
    case nfc = "nfc"                         // NFC tag reading
    case serial = "serial"                  // Serial/RS-232 badge readers
    case keyboardWedge = "keyboard_wedge"    // Keyboard emulation mode
    case httpWebhook = "http_webhook"       // HTTP-based badge events
    case mdmEnrollment = "mdm_enrollment"   // MDM-based device/user linking
    
    var displayName: String {
        switch self {
        case .usbAccessory:
            return "USB Badge Reader"
        case .usbC:
            return "USB-C Badge Reader"
        case .bluetoothLE:
            return "Bluetooth LE Badge Reader"
        case .nfc:
            return "NFC Reader"
        case .serial:
            return "Serial Badge Reader"
        case .keyboardWedge:
            return "Keyboard Wedge Reader"
        case .httpWebhook:
            return "HTTP Webhook"
        case .mdmEnrollment:
            return "MDM Enrollment"
        }
    }
}

/// Badge reader configuration
struct BadgeReaderConfig: Codable {
    let readerType: BadgeReaderType
    let protocolString: String?           // For USB: protocol identifier
    let serviceUUID: String?             // For BLE: service UUID
    let characteristicUUID: String?       // For BLE: characteristic UUID
    let webhookURL: String?               // For HTTP webhook
    let webhookSecret: String?            // For HTTP webhook authentication
    let serialPort: String?               // For serial: port name
    let baudRate: Int?                   // For serial: baud rate
    let mdmProvider: MDMProviderConfig?  // For MDM enrollment
    
    // Default configurations for common readers
    static let defaultUSB = BadgeReaderConfig(
        readerType: .usbAccessory,
        protocolString: "com.enterprise.badgereader",
        serviceUUID: nil,
        characteristicUUID: nil,
        webhookURL: nil,
        webhookSecret: nil,
        serialPort: nil,
        baudRate: nil,
        mdmProvider: nil
    )
    
    static let defaultBLE = BadgeReaderConfig(
        readerType: .bluetoothLE,
        protocolString: nil,
        serviceUUID: nil,
        characteristicUUID: nil,
        webhookURL: nil,
        webhookSecret: nil,
        serialPort: nil,
        baudRate: nil,
        mdmProvider: nil
    )
    
    static let defaultKeyboardWedge = BadgeReaderConfig(
        readerType: .keyboardWedge,
        protocolString: nil,
        serviceUUID: nil,
        characteristicUUID: nil,
        webhookURL: nil,
        webhookSecret: nil,
        serialPort: nil,
        baudRate: nil,
        mdmProvider: nil
    )
}

/// MDM Provider configuration
struct MDMProviderConfig: Codable {
    let providerType: MDMProviderType
    let enrollmentEndpoint: String
    let apiKey: String?
    let certificatePath: String?
    let additionalConfig: [String: String]?
}

enum MDMProviderType: String, Codable {
    case jamf = "jamf"
    case microsoftIntune = "microsoft_intune"
    case vmwareWorkspaceOne = "vmware_workspace_one"
    case blackberryUEM = "blackberry_uem"
    case mosyle = "mosyle"
    case addigy = "addigy"
    case kandji = "kandji"
    case custom = "custom"
    
    var displayName: String {
        switch self {
        case .jamf:
            return "Jamf"
        case .microsoftIntune:
            return "Microsoft Intune"
        case .vmwareWorkspaceOne:
            return "VMware Workspace ONE"
        case .blackberryUEM:
            return "BlackBerry UEM"
        case .mosyle:
            return "Mosyle"
        case .addigy:
            return "Addigy"
        case .kandji:
            return "Kandji"
        case .custom:
            return "Custom MDM"
        }
    }
}

/// Badge reader factory for creating appropriate provider instances
final class BadgeReaderProviderFactory {
    
    static let shared = BadgeReaderProviderFactory()
    
    private var registeredProviders: [String: () -> BadgeReaderProvider] = [:]
    
    private init() {
        // Register built-in providers
        registerBuiltInProviders()
    }
    
    private func registerBuiltInProviders() {
        // USB Accessory provider (existing implementation)
        registeredProviders[BadgeReaderType.usbAccessory.rawValue] = {
            ExternalAccessoryBadgeReaderProvider()
        }
        
        // Bluetooth LE provider
        registeredProviders[BadgeReaderType.bluetoothLE.rawValue] = {
            BLEBadgeReaderProvider()
        }
        
        // Keyboard wedge provider
        registeredProviders[BadgeReaderType.keyboardWedge.rawValue] = {
            KeyboardWedgeBadgeReaderProvider()
        }
        
        // HTTP webhook provider
        registeredProviders[BadgeReaderType.httpWebhook.rawValue] = {
            HTTPWebhookBadgeReaderProvider()
        }
        
        // MDM enrollment provider
        registeredProviders[BadgeReaderType.mdmEnrollment.rawValue] = {
            MDMBadgeReaderProvider()
        }
        
        // USB-C provider (parity with BLE). Registered under the ENUM case, not a
        // bare string: `"usbc"` used to be registered while `BadgeReaderType` had no
        // such case, so no configuration could ever select it — dead wiring.
        registeredProviders[BadgeReaderType.usbC.rawValue] = {
            USBCBadgeReaderProvider()
        }
    }

    /// Why a declared reader type cannot be built here, or nil when it can.
    /// `nfc` and `serial` are declared in `BadgeReaderType` and have no provider.
    func unavailableReason(for type: BadgeReaderType) -> String? {
        if registeredProviders[type.rawValue] != nil { return nil }
        return "Badge reader \"\(type.displayName)\" (\(type.rawValue)) is declared in configuration but not implemented in this build"
    }
    
    /// Register a custom badge reader provider
    func registerProvider(type: BadgeReaderType, factory: @escaping () -> BadgeReaderProvider) {
        registeredProviders[type.rawValue] = factory
    }
    
    /// Create a badge reader provider for the given configuration. A type with no
    /// provider returns nil AND says so in the audit log — silently returning nil
    /// left the lock screen waiting on a reader that could never exist.
    func createProvider(config: BadgeReaderConfig) -> BadgeReaderProvider? {
        guard let factory = registeredProviders[config.readerType.rawValue] else {
            // BadgeReaderType declares more transports than are implemented: `nfc` and
            // `serial` have no provider class. Returning a bare nil left the caller
            // unable to tell "not implemented" from "failed to build", and left an
            // operator with a configured reader that silently read nothing. Recorded
            // under its own event rather than `badgeReaderProviderInitialized` with a
            // provider of "none": a reader that cannot exist was never initialised, and
            // `ProviderConfigurationService.badgeReaderUnavailableReason` puts the same
            // fact on the lock screen.
            AuditLogger.shared.log(event: .badgeReaderProviderUnavailable, metadata: [
                "provider": "none",
                "readerType": config.readerType.rawValue,
                "reason": "declared, not implemented",
                "error": "no provider registered for this reader type"
            ])
            return nil
        }
        return factory()
    }
    
    /// Get all available reader types
    func availableReaderTypes() -> [BadgeReaderType] {
        return BadgeReaderType.allCases
    }
}

// MARK: - Keyboard Wedge Badge Reader Provider

/// Badge reader that uses keyboard emulation (HID)
/// Most common USB badge readers work in this mode
final class KeyboardWedgeBadgeReaderProvider: BadgeReaderProvider {
    
    var providerId: String { "keyboard_wedge_\(UUID().uuidString.prefix(8))" }
    var displayName: String { "Keyboard Wedge Reader" }
    var isConnected: Bool { true } // Always "connected" in keyboard wedge mode
    
    weak var delegate: BadgeReaderProviderDelegate?
    
    private var dataBuffer = ""
    private var lastKeyTime: Date?
    private let keyTimeout: TimeInterval = 0.1 // Max time between keystrokes
    private let enterKey: UInt16 = 0x28 // HID Enter key
    
    func setup() {
        // Register for keyboard input notifications
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleKeyboardInput),
            name: .badgeReaderKeyboardInput,
            object: nil
        )
        
        AuditLogger.shared.log(event: .badgeReaderProviderInitialized, metadata: [
            "provider": displayName,
            "type": BadgeReaderType.keyboardWedge.rawValue
        ])
    }
    
    func teardown() {
        NotificationCenter.default.removeObserver(self)
    }
    
    func resetReaderState() {
        dataBuffer = ""
        lastKeyTime = nil
    }
    
    func sendCommand(_ command: Data) throws {
        // Keyboard wedge mode is input-only
        throw BadgeReaderProviderError.notSupported
    }
    
    @objc private func handleKeyboardInput(_ notification: Notification) {
        guard let userInfo = notification.userInfo,
              let keyCode = userInfo["keyCode"] as? UInt16,
              let characters = userInfo["characters"] as? String else {
            return
        }
        
        let now = Date()
        
        // Check for timeout between keys
        if let lastTime = lastKeyTime, now.timeIntervalSince(lastTime) > keyTimeout {
            // Too much time passed, start new badge
            dataBuffer = ""
        }
        
        lastKeyTime = now
        
        // Check for Enter key (badge read complete)
        if keyCode == enterKey {
            processBadgeData(dataBuffer)
            dataBuffer = ""
        } else {
            // Append characters to buffer
            dataBuffer += characters
        }
    }
    
    private func processBadgeData(_ data: String) {
        let trimmedBadge = data.trimmingCharacters(in: .whitespacesAndNewlines)
        
        guard trimmedBadge.count >= 4 else {
            delegate?.badgeReader(self, didFailWithError: BadgeReaderProviderError.invalidBadgeLength)
            return
        }
        
        guard trimmedBadge.count <= 50 else {
            delegate?.badgeReader(self, didFailWithError: BadgeReaderProviderError.invalidBadgeLength)
            return
        }
        
        delegate?.badgeReader(self, didReadBadge: trimmedBadge)
    }
}

// MARK: - HTTP Webhook Badge Reader Provider

/// Badge reader that receives badge events via HTTP webhooks
/// Useful for cloud-based badge systems or middleware
final class HTTPWebhookBadgeReaderProvider: BadgeReaderProvider {
    
    var providerId: String { "http_webhook_\(UUID().uuidString.prefix(8))" }
    var displayName: String { "HTTP Webhook Reader" }
    var isConnected: Bool { false } // Passive listener
    
    weak var delegate: BadgeReaderProviderDelegate?
    
    // NOT IMPLEMENTED: this provider starts no listener. It previously held a
    // `config` and an `httpServer` that nothing ever assigned, plus a stub HTTPServer
    // whose stop() was a no-op — so `teardown()` stopped a server that had never been
    // started, and the fields made an unbuilt listener read as a built one. Badge events
    // reach this provider ONLY when the host calls processIncomingBadge(_:metadata:).
    
    func setup() {
        // Deliberately starts nothing. Recorded so an operator reading the audit trail
        // sees a passive provider that was initialised, not a listener that is running.
        AuditLogger.shared.log(event: .badgeReaderProviderInitialized, metadata: [
            "provider": displayName,
            "type": BadgeReaderType.httpWebhook.rawValue,
            "listener": "not_implemented"
        ])
    }
    
    func teardown() {
        // Nothing is started, so nothing is stopped.
    }
    
    func resetReaderState() {
        // No state to reset for HTTP webhook
    }
    
    func sendCommand(_ command: Data) throws {
        // Could send commands back to badge system
    }
    
    /// Process incoming badge from webhook
    func processIncomingBadge(badgeId: String, metadata: [String: String]?) {
        delegate?.badgeReader(self, didReadBadge: badgeId)
        
        AuditLogger.shared.log(event: .badgeReceived, metadata: [
            "provider": providerId,
            "badgeId": maskBadgeId(badgeId),
            "source": "http_webhook"
        ])
    }
    
    private func maskBadgeId(_ badgeId: String) -> String {
        guard badgeId.count > 4 else { return "****" }
        return "\(badgeId.prefix(2))****\(badgeId.suffix(2))"
    }
}

// MARK: - MDM Badge Reader Provider

/// MDM-based badge reader that links device/user via MDM enrollment
/// Used when MDM provides user identity rather than physical badge
final class MDMBadgeReaderProvider: BadgeReaderProvider {
    
    var providerId: String { "mdm_enrollment_\(UUID().uuidString.prefix(8))" }
    var displayName: String { "MDM Enrollment Reader" }
    var isConnected: Bool { false } // MDM doesn't "connect" like a reader
    
    weak var delegate: BadgeReaderProviderDelegate?
    
    // `mdmConfig` was declared here and never assigned or read; queryMDMForUser()
    // takes its parameters from the MDM API call itself.
    
    func setup() {
        // Initialize MDM provider
        AuditLogger.shared.log(event: .badgeReaderProviderInitialized, metadata: [
            "provider": displayName,
            "type": BadgeReaderType.mdmEnrollment.rawValue
        ])
        
        // Query MDM for enrolled user
        queryMDMForUser()
    }
    
    func teardown() {
        // Cleanup
    }
    
    func resetReaderState() {
        // Clear cached user data
    }
    
    func sendCommand(_ command: Data) throws {
        throw BadgeReaderProviderError.notSupported
    }
    
    private func queryMDMForUser() {
        // Query MDM for currently enrolled user
        // This would use MDM APIs to get user identity
        // For demonstration, we'll use a placeholder
        
        Task {
            do {
                // Query MDM for user info
                let userInfo = try await queryMDMAPI()
                
                if let userId = userInfo["userId"] {
                    // Emit badge read event with MDM user ID
                    delegate?.badgeReader(self, didReadBadge: userId)
                    
                    AuditLogger.shared.log(event: .badgeReceived, metadata: [
                        "provider": providerId,
                        "userId": maskUserId(userId),
                        "source": "mdm_enrollment"
                    ])
                }
            } catch {
                delegate?.badgeReader(self, didFailWithError: error)
            }
        }
    }
    
    private func queryMDMAPI() async throws -> [String: String] {
        // Placeholder - implement actual MDM API calls
        // Different MDMs have different APIs:
        // - Jamf: /api/v1/authenticated-sessions
        // - Intune: /deviceManagement/managedDevices
        // - Workspace ONE: /API/mdm/devices
        
        throw BadgeReaderProviderError.mdmNotConfigured
    }
    
    private func maskUserId(_ userId: String) -> String {
        guard userId.count > 4 else { return "****" }
        return "\(userId.prefix(2))****\(userId.suffix(2))"
    }
}

// MARK: - Badge Reader Provider Errors

enum BadgeReaderProviderError: LocalizedError {
    case notSupported
    case notConnected
    case invalidConfiguration
    case invalidBadgeLength
    case mdmNotConfigured
    case mdmQueryFailed(String)
    
    var errorDescription: String? {
        switch self {
        case .notSupported:
            return "This operation is not supported by the badge reader"
        case .notConnected:
            return "Badge reader is not connected"
        case .invalidConfiguration:
            return "Invalid badge reader configuration"
        case .invalidBadgeLength:
            return "Badge ID is too short or too long"
        case .mdmNotConfigured:
            return "MDM provider is not configured"
        case .mdmQueryFailed(let reason):
            return "MDM query failed: \(reason)"
        }
    }
}

// MARK: - Notification Names

extension Notification.Name {
    static let badgeReaderKeyboardInput = Notification.Name("badgeReaderKeyboardInput")
    static let badgeReaderBadgeReceived = Notification.Name("badgeReaderBadgeReceived")
}

// MARK: - External Accessory Provider (Existing Implementation Wrapper)

/// Wrapper for the existing ExternalAccessory badge reader
/// This maintains backward compatibility while using the new protocol
final class ExternalAccessoryBadgeReaderProvider: NSObject, BadgeReaderProvider {
    
    var providerId: String { "usb_accessory_\(UUID().uuidString.prefix(8))" }
    var displayName: String { "USB Badge Reader" }
    var isConnected: Bool { BadgeReaderManager.shared.isConnected }
    
    weak var delegate: BadgeReaderProviderDelegate? {
        didSet {
            BadgeReaderManager.shared.delegate = self
        }
    }
    
    func setup() {
        BadgeReaderManager.shared.setup()
    }
    
    func teardown() {
        // BadgeReaderManager cleanup
    }
    
    func resetReaderState() {
        BadgeReaderManager.shared.resetReaderState()
    }
    
    func sendCommand(_ command: Data) throws {
        try BadgeReaderManager.shared.sendCommand(command)
    }
}

// MARK: - BadgeReaderManagerDelegate Bridge

extension ExternalAccessoryBadgeReaderProvider: BadgeReaderManagerDelegate {
    func badgeReader(_ manager: BadgeReaderManager, didReadBadge badgeId: String) {
        delegate?.badgeReader(self, didReadBadge: badgeId)
    }
    
    func badgeReader(_ manager: BadgeReaderManager, didFailWithError error: Error) {
        delegate?.badgeReader(self, didFailWithError: error)
    }
    
    func badgeReaderDidDisconnect(_ manager: BadgeReaderManager) {
        delegate?.badgeReaderDidDisconnect(self)
    }
    
    func badgeReaderDidConnect(_ manager: BadgeReaderManager) {
        delegate?.badgeReaderDidConnect(self)
    }
}
