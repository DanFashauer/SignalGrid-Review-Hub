import Foundation
import CoreBluetooth

// MARK: - BLE Badge Reader Provider

/// BLE Badge Reader Provider implementing BadgeReaderProvider protocol
/// 
/// This provider scans for BLE badge readers using CoreBluetooth and processes
/// badge scan events. It integrates with SecurityManager for validation.
///
/// ## Features:
/// - CoreBluetooth scanning for known Service UUIDs
/// - Automatic reconnection with backoff
/// - Security validation via SecurityManager
/// - RSSI telemetry
/// - Connection state management
///
/// ## Payload Modes Supported:
/// - Mode A: Notify characteristic emits ASCII badge string (preferred)
/// - Mode B: BLE HID keyboard wedge (fallback - handled by KeyboardWedgeBadgeReaderProvider)
///
final class BLEBadgeReaderProvider: NSObject, BadgeReaderProvider {
    
    // MARK: - BadgeReaderProvider Protocol
    
    var providerId: String { "ble_\(uuidPrefix)" }
    var displayName: String { "BLE Badge Reader" }
    var isConnected: Bool { connectedPeripheral?.state == .connected }
    
    weak var delegate: BadgeReaderProviderDelegate?
    
    // MARK: - Configuration
    
    /// Service UUIDs to scan for (configure for your specific reader)
    private let targetServiceUUIDs: [CBUUID] = [
        // CBUUID(string: "0000180D-0000-1000-8000-00805F9B34FB"), // Heart Rate Service (example)
        // Add your badge reader's service UUID here
    ]
    
    /// Notify characteristic UUID for badge data
    private let notifyCharacteristicUUID: CBUUID? = nil
        // CBUUID(string: "00002A37-0000-1000-8000-00805F9B34FB") // Heart Rate Measurement (example)
    
    // MARK: - BLE State
    
    private var centralManager: CBCentralManager!
    private var connectedPeripheral: CBPeripheral?
    private var discoveredCharacteristics: [CBUUID: CBCharacteristic] = [:]
    
    // MARK: - Telemetry
    
    private var lastScanAt: Date?
    private var lastRSSI: Int = 0
    private var connectionState: ConnectionState = .disconnected
    
    // MARK: - Reconnection
    
    private var reconnectAttempts = 0
    private let maxReconnectAttempts = 5
    private var reconnectTimer: Timer?
    
    // MARK: - State
    
    private let uuidPrefix: String
    
    // MARK: - Initialization
    
    override init() {
        self.uuidPrefix = String(UUID().uuidString.prefix(8))
        super.init()
        centralManager = CBCentralManager(delegate: self, queue: DispatchQueue(label: "com.enterprise.shell.ble.reader"))
    }
    
    // MARK: - BadgeReaderProvider Methods
    
    func setup() {
        // CBCentralManager will call centralManagerDidUpdateState when powered on
        AuditLogger.shared.log(event: .badgeReaderProviderInitialized, metadata: [
            "provider": displayName,
            "type": BadgeReaderType.bluetoothLE.rawValue
        ])
    }
    
    func teardown() {
        stopScanning()
        disconnect()
        cancelReconnectTimer()
    }
    
    func resetReaderState() {
        discoveredCharacteristics.removeAll()
        reconnectAttempts = 0
    }
    
    func sendCommand(_ command: Data) throws {
        guard let peripheral = connectedPeripheral,
              peripheral.state == .connected else {
            throw BadgeReaderProviderError.notConnected
        }
        
        // Find writable characteristic and send command
        // Implementation depends on specific reader protocol
        throw BadgeReaderProviderError.notSupported
    }
    
    // MARK: - Scanning
    
    private func startScanning() {
        guard centralManager.state == .poweredOn else {
            return
        }
        
        connectionState = .scanning
        
        let options: [String: Any] = [
            CBCentralManagerScanOptionAllowDuplicatesKey: false
        ]
        
        if targetServiceUUIDs.isEmpty {
            // Scan for all peripherals if no specific UUIDs configured
            centralManager.scanForPeripherals(withServices: nil, options: options)
        } else {
            centralManager.scanForPeripherals(withServices: targetServiceUUIDs, options: options)
        }
        
        AuditLogger.shared.log(event: .badgeReaderProviderStateChange, metadata: [
            "provider": providerId,
            "state": "scanning"
        ])
    }
    
    private func stopScanning() {
        centralManager.stopScan()
        connectionState = .disconnected
    }
    
    // MARK: - Connection
    
    private func connect(to peripheral: CBPeripheral) {
        stopScanning()
        
        connectedPeripheral = peripheral
        peripheral.delegate = self
        connectionState = .connecting
        
        centralManager.connect(peripheral, options: nil)
        
        AuditLogger.shared.log(event: .badgeReaderProviderStateChange, metadata: [
            "provider": providerId,
            "peripheral": peripheral.name ?? "unknown",
            "state": "connecting"
        ])
    }
    
    private func disconnect() {
        if let peripheral = connectedPeripheral {
            centralManager.cancelPeripheralConnection(peripheral)
        }
        connectedPeripheral = nil
        discoveredCharacteristics.removeAll()
        connectionState = .disconnected
    }
    
    // MARK: - Reconnection
    
    private func scheduleReconnect() {
        guard reconnectAttempts < maxReconnectAttempts else {
            AuditLogger.shared.log(event: .badgeReaderProviderError, metadata: [
                "provider": providerId,
                "error": "max_reconnect_attempts_exceeded"
            ])
            
            delegate?.badgeReader(self, didFailWithError: BadgeReaderProviderError.notConnected)
            return
        }
        
        reconnectAttempts += 1
        
        // Exponential backoff: 1s, 2s, 4s, 8s, 16s
        let delay = pow(2.0, Double(reconnectAttempts - 1))
        
        reconnectTimer = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { [weak self] _ in
            self?.attemptReconnect()
        }
    }
    
    private func attemptReconnect() {
        if let peripheral = connectedPeripheral {
            connect(to: peripheral)
        } else {
            startScanning()
        }
    }
    
    private func cancelReconnectTimer() {
        reconnectTimer?.invalidate()
        reconnectTimer = nil
    }
    
    // MARK: - Badge Payload Processing
    
    private func handleBadgePayload(_ data: Data) {
        // Mode A: ASCII string payload (preferred)
        guard let raw = String(data: data, encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines),
              !raw.isEmpty else {
            // Mode B: BLE HID keyboard wedge - not handled here
            // (handled by KeyboardWedgeBadgeReaderProvider)
            return
        }
        
        processBadge(raw)
    }
    
    private func processBadge(_ badgeId: String) {
        // SECURITY: Validate badge format first
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
        // chokepoint (SessionStateManager.badgeRejection). It must NOT be called
        // here too: isBadgeScanAllowed is stateful (it records an attempt), so a
        // second call per scan would double-count and lock the reader out at half
        // the configured threshold. Format is still validated above.
        lastScanAt = Date()
        
        AuditLogger.shared.log(event: .badgeReceived, metadata: [
            "provider": providerId,
            "badgeId": SecurityManager.shared.maskBadgeId(badgeId),
            "transport": BadgeReaderType.bluetoothLE.rawValue,
            "rssi": String(lastRSSI)
        ])
        
        delegate?.badgeReader(self, didReadBadge: badgeId)
    }
    
    // MARK: - Connection State
    
    enum ConnectionState {
        case disconnected
        case scanning
        case connecting
        case connected
    }
}

// MARK: - CBCentralManagerDelegate

extension BLEBadgeReaderProvider: CBCentralManagerDelegate {
    
    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        switch central.state {
        case .poweredOn:
            startScanning()
        case .poweredOff, .unauthorized, .unsupported:
            stopScanning()
            connectionState = .disconnected
        default:
            break
        }
    }
    
    func centralManager(_ central: CBCentralManager,
                        didDiscover peripheral: CBPeripheral,
                        advertisementData: [String: Any],
                        rssi RSSI: NSNumber) {
        
        lastRSSI = RSSI.intValue
        
        // Filter by name if needed (example: only connect to HID devices)
        // let name = peripheral.name ?? ""
        // guard name.hasPrefix("HID") || name.hasPrefix("Badge") else { return }
        
        // Connect to first discovered peripheral (MVP)
        connect(to: peripheral)
    }
    
    func centralManager(_ central: CBCentralManager,
                        didConnect peripheral: CBPeripheral) {
        
        connectionState = .connected
        reconnectAttempts = 0
        
        AuditLogger.shared.log(event: .badgeReaderDidConnect, metadata: [
            "provider": providerId,
            "peripheral": peripheral.name ?? "unknown"
        ])
        
        delegate?.badgeReaderDidConnect(self)
        
        // Discover services
        if targetServiceUUIDs.isEmpty {
            peripheral.discoverServices(nil)
        } else {
            peripheral.discoverServices(targetServiceUUIDs)
        }
    }
    
    func centralManager(_ central: CBCentralManager,
                        didFailToConnect peripheral: CBPeripheral,
                        error: Error?) {
        
        connectionState = .disconnected
        
        AuditLogger.shared.log(event: .badgeReaderProviderError, metadata: [
            "provider": providerId,
            "error": error?.localizedDescription ?? "connection_failed"
        ])
        
        // Attempt reconnection
        scheduleReconnect()
    }
    
    func centralManager(_ central: CBCentralManager,
                        didDisconnectPeripheral peripheral: CBPeripheral,
                        error: Error?) {
        
        connectionState = .disconnected
        discoveredCharacteristics.removeAll()
        
        AuditLogger.shared.log(event: .badgeReaderDidDisconnect, metadata: [
            "provider": providerId,
            "peripheral": peripheral.name ?? "unknown",
            "error": error?.localizedDescription ?? "none"
        ])
        
        delegate?.badgeReaderDidDisconnect(self)
        
        // Attempt reconnection if unexpected disconnect
        if error != nil {
            scheduleReconnect()
        }
    }
}

// MARK: - CBPeripheralDelegate

extension BLEBadgeReaderProvider: CBPeripheralDelegate {
    
    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard error == nil else {
            AuditLogger.shared.log(event: .badgeReaderProviderError, metadata: [
                "provider": providerId,
                "error": "service_discovery_failed"
            ])
            return
        }
        
        peripheral.services?.forEach { service in
            peripheral.discoverCharacteristics(nil, for: service)
        }
    }
    
    func peripheral(_ peripheral: CBPeripheral,
                    didDiscoverCharacteristicsFor service: CBService,
                    error: Error?) {
        
        guard error == nil else {
            AuditLogger.shared.log(event: .badgeReaderProviderError, metadata: [
                "provider": providerId,
                "error": "characteristic_discovery_failed"
            ])
            return
        }
        
        service.characteristics?.forEach { characteristic in
            // Store discovered characteristic
            discoveredCharacteristics[characteristic.uuid] = characteristic
            
            // Subscribe to notify characteristics
            if characteristic.properties.contains(.notify) {
                peripheral.setNotifyValue(true, for: characteristic)
            }
            
            // Read value if readable
            if characteristic.properties.contains(.read) {
                peripheral.readValue(for: characteristic)
            }
        }
    }
    
    func peripheral(_ peripheral: CBPeripheral,
                    didUpdateValueFor characteristic: CBCharacteristic,
                    error: Error?) {
        
        guard error == nil,
              let data = characteristic.value else {
            return
        }
        
        handleBadgePayload(data)
    }
    
    func peripheral(_ peripheral: CBPeripheral,
                    didUpdateNotificationStateFor characteristic: CBCharacteristic,
                    error: Error?) {
        
        if let error = error {
            AuditLogger.shared.log(event: .badgeReaderProviderError, metadata: [
                "provider": providerId,
                "error": "notification_setup_failed",
                "characteristic": characteristic.uuid.uuidString
            ])
        }
    }
}

// MARK: - Telemetry

extension BLEBadgeReaderProvider {
    
    /// Get current telemetry data
    func getTelemetry() -> [String: Any] {
        return [
            "providerId": providerId,
            "connectionState": String(describing: connectionState),
            "lastRSSI": lastRSSI,
            "lastScanAt": lastScanAt?.timeIntervalSince1970 ?? 0,
            "reconnectAttempts": reconnectAttempts,
            "connectedPeripheral": connectedPeripheral?.name ?? "none"
        ]
    }
}
