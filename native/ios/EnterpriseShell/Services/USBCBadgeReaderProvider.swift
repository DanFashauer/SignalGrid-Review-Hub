import Foundation
import ExternalAccessory

// MARK: - USB-C Badge Reader Provider

/// USB-C Badge Reader Provider implementing BadgeReaderProvider protocol
/// 
/// This provider handles USB-C/Lightning badge readers via the External Accessory framework.
/// It provides parity with BLEBadgeReaderProvider by emitting the same badge events
/// with reader.transport = "usbc".
///
/// ## Parity Requirements (Frozen):
/// - Implements BadgeReaderProvider protocol (same as BLE)
/// - Emits badge strings identical to BLE provider
/// - Uses same SecurityManager validation
/// - No new backend endpoints
/// - No new state machine transitions
/// - No new persona logic
///
/// ## Transport:
/// - USB-C badge readers via External Accessory Framework
/// - Lightning badge readers (legacy support)
///
final class USBCBadgeReaderProvider: NSObject, BadgeReaderProvider {
    
    // MARK: - BadgeReaderProvider Protocol
    
    var providerId: String { "usbc_\(uuidPrefix)" }
    var displayName: String { "USB-C Badge Reader" }
    var isConnected: Bool { connectedSession != nil }
    
    weak var delegate: BadgeReaderProviderDelegate?
    
    // MARK: - EAAccessory State
    
    private var accessoryManager: EAAccessoryManager!
    private var connectedSession: EASession?
    private var inputStream: InputStream?
    private var outputStream: OutputStream?
    
    // MARK: - Configuration
    
    /// Protocol string for USB badge readers (MFi)
    private let protocolString: String
    
    // MARK: - Data Buffer
    
    private var dataBuffer = Data()
    private let enterMarker: UInt8 = 0x0D // Carriage return
    private let newlineMarker: UInt8 = 0x0A // Newline
    
    // MARK: - State
    
    private let uuidPrefix: String
    
    // MARK: - Initialization
    
    init(protocolString: String = "com.enterprise.badgereader") {
        self.protocolString = protocolString
        self.uuidPrefix = String(UUID().uuidString.prefix(8))
        super.init()
    }
    
    // MARK: - BadgeReaderProvider Methods
    
    func setup() {
        accessoryManager = EAAccessoryManager.shared()
        
        // Register for connected accessory notifications
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(accessoryDidConnect),
            name: .EAAccessoryDidConnect,
            object: nil
        )
        
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(accessoryDidDisconnect),
            name: .EAAccessoryDidDisconnect,
            object: nil
        )
        
        // Check for already connected accessories
        checkForConnectedAccessories()
        
        AuditLogger.shared.log(event: .badgeReaderProviderInitialized, metadata: [
            "provider": displayName,
            "type": BadgeReaderType.usbAccessory.rawValue,
            "protocol": protocolString
        ])
    }
    
    func teardown() {
        disconnect()
        
        NotificationCenter.default.removeObserver(self)
    }
    
    func resetReaderState() {
        dataBuffer = Data()
    }
    
    func sendCommand(_ command: Data) throws {
        guard let outputStream = outputStream else {
            throw BadgeReaderProviderError.notConnected
        }
        
        let bytes = [UInt8](command)
        outputStream.write(bytes, maxLength: bytes.count)
    }
    
    // MARK: - Connection Management
    
    private func checkForConnectedAccessories() {
        guard let connectedAccessories = accessoryManager?.connectedAccessories else {
            return
        }
        
        for accessory in connectedAccessories {
            if shouldConnect(to: accessory) {
                connect(to: accessory)
                break
            }
        }
    }
    
    private func shouldConnect(to accessory: EAAccessory) -> Bool {
        // Check if accessory supports our protocol
        return accessory.protocolStrings.contains(protocolString)
    }
    
    private func connect(to accessory: EAAccessory) {
        guard let session = EASession(accessory: accessory, forProtocol: protocolString) else {
            AuditLogger.shared.log(event: .badgeReaderProviderError, metadata: [
                "provider": providerId,
                "error": "failed_to_create_session"
            ])
            return
        }
        
        connectedSession = session
        
        // Setup streams
        inputStream = session.inputStream
        outputStream = session.outputStream
        
        inputStream?.delegate = self
        outputStream?.delegate = self
        
        // Schedule on run loop
        inputStream?.schedule(in: .main, forMode: .common)
        outputStream?.schedule(in: .main, forMode: .common)
        
        // Open streams
        inputStream?.open()
        outputStream?.open()
        
        AuditLogger.shared.log(event: .badgeReaderDidConnect, metadata: [
            "provider": providerId,
            "accessory": accessory.name,
            "serial": accessory.serialNumber ?? "unknown"
        ])
        
        delegate?.badgeReaderDidConnect(self)
    }
    
    private func disconnect() {
        inputStream?.close()
        outputStream?.close()
        
        inputStream?.remove(from: .main, forMode: .common)
        outputStream?.remove(from: .main, forMode: .common)
        
        inputStream = nil
        outputStream = nil
        connectedSession = nil
        
        AuditLogger.shared.log(event: .badgeReaderDidDisconnect, metadata: [
            "provider": providerId
        ])
        
        delegate?.badgeReaderDidDisconnect(self)
    }
    
    // MARK: - Badge Processing
    
    private func processData(_ data: Data) {
        dataBuffer.append(data)
        
        // Look for delimiter (CR or LF)
        while let delimiterIndex = dataBuffer.firstIndex(where: { $0 == enterMarker || $0 == newlineMarker }) {
            let lineData = dataBuffer.prefix(upTo: delimiterIndex)
            dataBuffer = dataBuffer.suffix(from: dataBuffer.index(after: delimiterIndex))
            
            // Process complete line
            if let badgeString = String(data: lineData, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines),
               !badgeString.isEmpty {
                processBadge(badgeString)
            }
        }
        
        // Prevent buffer overflow
        if dataBuffer.count > 1024 {
            dataBuffer = Data()
        }
    }
    
    private func processBadge(_ badgeId: String) {
        // SECURITY: Validate badge format (same as BLE)
        let validation = SecurityManager.shared.validateBadgeId(badgeId)
        if !validation.valid {
            AuditLogger.shared.log(event: .securitySuspiciousBadge, metadata: [
                "provider": providerId,
                "badgeId": SecurityManager.shared.maskBadgeId(badgeId),
                "reason": validation.error ?? "invalid_format"
            ])
            delegate?.badgeReader(self, didFailWithError: BadgeReaderProviderError.invalidBadgeLength)
            return
        }
        
        // SECURITY: rate-limit/lockout is enforced once, centrally, at the session
        // chokepoint (SessionStateManager.badgeRejection). Not called here (same as
        // BLE): isBadgeScanAllowed is stateful, so a second call per scan would
        // double-count and lock the reader out at half the configured threshold.
        AuditLogger.shared.log(event: .badgeReceived, metadata: [
            "provider": providerId,
            "badgeId": SecurityManager.shared.maskBadgeId(badgeId),
            "transport": BadgeReaderType.usbAccessory.rawValue
        ])
        
        delegate?.badgeReader(self, didReadBadge: badgeId)
    }
    
    // MARK: - Notifications
    
    @objc private func accessoryDidConnect(_ notification: Notification) {
        guard let userInfo = notification.userInfo,
              let accessory = userInfo[EAAccessoryKey] as? EAAccessory else {
            return
        }
        
        if shouldConnect(to: accessory) {
            connect(to: accessory)
        }
    }
    
    @objc private func accessoryDidDisconnect(_ notification: Notification) {
        guard let userInfo = notification.userInfo,
              let accessory = userInfo[EAAccessoryKey] as? EAAccessory else {
            return
        }
        
        // Check if our accessory disconnected
        if connectedSession?.accessory == accessory {
            disconnect()
        }
    }
}

// MARK: - StreamDelegate

extension USBCBadgeReaderProvider: StreamDelegate {
    
    func stream(_ aStream: Stream, handle eventCode: Stream.Event) {
        switch eventCode {
        case .openCompleted:
            break
            
        case .hasBytesAvailable:
            if aStream == inputStream {
                handleInputStream()
            }
            
        case .hasSpaceAvailable:
            break
            
        case .errorOccurred:
            AuditLogger.shared.log(event: .badgeReaderProviderError, metadata: [
                "provider": providerId,
                "error": "stream_error"
            ])
            disconnect()
            
        case .endEncountered:
            disconnect()
            
        default:
            break
        }
    }
    
    private func handleInputStream() {
        guard let inputStream = inputStream else { return }
        
        let bufferSize = 1024
        var buffer = [UInt8](repeating: 0, count: bufferSize)
        
        let bytesRead = inputStream.read(&buffer, maxLength: bufferSize)
        
        if bytesRead > 0 {
            let data = Data(bytes: buffer, count: bytesRead)
            processData(data)
        }
    }
}

// MARK: - USB-C Specific Configuration

extension USBCBadgeReaderProvider {
    
    /// Create provider with specific reader configuration
    static func withConfig(_ config: BadgeReaderConfig) -> USBCBadgeReaderProvider {
        return USBCBadgeReaderProvider(protocolString: config.protocolString ?? "com.enterprise.badgereader")
    }
}
