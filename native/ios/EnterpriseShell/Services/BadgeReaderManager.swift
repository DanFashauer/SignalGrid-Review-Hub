import Foundation
import ExternalAccessory
import UIKit

/// Protocol for badge reader events
protocol BadgeReaderManagerDelegate: AnyObject {
    func badgeReader(_ manager: BadgeReaderManager, didReadBadge badgeId: String)
    func badgeReader(_ manager: BadgeReaderManager, didFailWithError error: Error)
    func badgeReaderDidDisconnect(_ manager: BadgeReaderManager)
}

/// Manages communication with USB-C/Lightning badge readers
final class BadgeReaderManager: NSObject {
    
    // MARK: - Singleton
    
    static let shared = BadgeReaderManager()
    
    // MARK: - Properties
    
    weak var delegate: BadgeReaderManagerDelegate?
    
    private(set) var isConnected: Bool = false
    private(set) var connectedAccessory: EAAccessory?
    private var session: EASession?
    private let sessionQueue = DispatchQueue(label: "com.enterprise.shell.badgeReader")
    private let accessoryProtocol = "com.enterprise.badgereader" // Protocol string for badge readers
    
    private var dataBuffer = Data()
    private let headerByte: UInt8 = 0x02
    private let footerByte: UInt8 = 0x03
    private var isReading: Bool = false
    private let maxBadgeLength: Int = 50 // Maximum allowed badge ID length
    
    // MARK: - Initialization
    
    private override init() {
        super.init()
    }
    
    // MARK: - Setup
    
    /// Set up badge reader monitoring
    func setup() {
        // Register for accessory notifications
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(accessoryDidConnect),
            name: .EAAccessoryDidConnect,
            object: nil
        )
        
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleAccessoryDisconnectNotification),
            name: .EAAccessoryDidDisconnect,
            object: nil
        )
        
        // Check for already connected accessories
        checkConnectedAccessories()
    }
    
    // MARK: - Accessory Connection
    
    private func checkConnectedAccessories() {
        let accessories = EAAccessoryManager.shared().connectedAccessories
        
        for accessory in accessories {
            if accessory.protocolStrings.contains(accessoryProtocol) {
                connectToAccessory(accessory)
                break
            }
        }
    }
    
    private func connectToAccessory(_ accessory: EAAccessory) {
        guard session == nil else { return }
        
        connectedAccessory = accessory
        accessory.delegate = self
        
        session = EASession(accessory: accessory, forProtocol: accessoryProtocol)
        
        guard let session = session else {
            delegate?.badgeReader(self, didFailWithError: BadgeReaderError.sessionCreationFailed)
            return
        }
        
        session.inputStream?.delegate = self
        session.inputStream?.schedule(in: .main, forMode: .common)
        session.inputStream?.open()
        
        session.outputStream?.schedule(in: .main, forMode: .common)
        session.outputStream?.open()
        
        isConnected = true
        
        AuditLogger.shared.log(event: .badgeReaderConnected, metadata: [
            "name": accessory.name,
            "manufacturer": accessory.manufacturer,
            "model": accessory.modelNumber,
            "serial": accessory.serialNumber
        ])
    }
    
    private func disconnectFromAccessory() {
        session?.inputStream?.close()
        session?.inputStream?.remove(from: .main, forMode: .common)
        session?.outputStream?.close()
        session?.outputStream?.remove(from: .main, forMode: .common)
        
        session = nil
        connectedAccessory = nil
        isConnected = false
        
        delegate?.badgeReaderDidDisconnect(self)
    }
    
    // MARK: - Data Reading
    
    private func readData(_ data: Data) {
        sessionQueue.async { [weak self] in
            self?.processIncomingData(data)
        }
    }
    
    private func processIncomingData(_ data: Data) {
        dataBuffer.append(data)
        
        // Process complete messages (bounded by header and footer)
        while dataBuffer.count >= 2 {
            // Look for header byte
            if let headerIndex = dataBuffer.firstIndex(of: headerByte) {
                // Look for footer byte after header
                if let footerIndex = dataBuffer[headerIndex...].firstIndex(of: footerByte) {
                    // Extract message between header and footer
                    let messageStart = headerIndex + 1
                    let messageEnd = footerIndex
                    
                    if messageEnd > messageStart {
                        let messageData = dataBuffer[messageStart..<messageEnd]
                        parseBadgeData(messageData)
                    }
                    
                    // Remove processed data
                    dataBuffer.removeSubrange(headerIndex...footerIndex)
                } else if dataBuffer.count > 100 {
                    // Buffer overflow protection, clear buffer
                    dataBuffer.removeAll()
                    break
                } else {
                    // Incomplete message, wait for more data
                    break
                }
            } else {
                // No header found, clear buffer
                dataBuffer.removeAll()
            }
        }
    }
    
    private func parseBadgeData(_ data: Data) {
        guard let badgeString = String(data: data, encoding: .utf8) else {
            delegate?.badgeReader(self, didFailWithError: BadgeReaderError.invalidDataFormat)
            return
        }
        
        let trimmedBadge = badgeString.trimmingCharacters(in: .whitespacesAndNewlines)
        
        guard trimmedBadge.count >= 4 else {
            delegate?.badgeReader(self, didFailWithError: BadgeReaderError.invalidBadgeLength)
            return
        }
        
        guard trimmedBadge.count <= maxBadgeLength else {
            // Log security event for suspicious badge length
            AuditLogger.shared.log(event: .securitySuspiciousBadge, metadata: [
                "reason": "badge_length_exceeded",
                "length": String(trimmedBadge.count)
            ])
            delegate?.badgeReader(self, didFailWithError: BadgeReaderError.invalidBadgeLength)
            return
        }
        
        // Notify delegate
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.delegate?.badgeReader(self, didReadBadge: trimmedBadge)
        }
    }
    
    // MARK: - Send Command (for reader feedback)
    
    func sendCommand(_ command: Data) throws {
        guard let outputStream = session?.outputStream else {
            throw BadgeReaderError.notConnected
        }
        
        var written = 0
        while written < command.count {
            let buffer = command.withUnsafeBytes {
                [UInt8](UnsafeBufferPointer(start: $0, count: command.count))
            }
            
            let result = outputStream.write(buffer, maxLength: buffer.count - written)
            
            if result < 0 {
                throw BadgeReaderError.writeFailed(outputStream.streamError)
            }
            
            written += result
        }
    }
    
    // MARK: - Notifications
    
    @objc private func accessoryDidConnect(_ notification: Notification) {
        guard let userInfo = notification.userInfo,
              let accessory = userInfo[EAAccessoryKey] as? EAAccessory else {
            return
        }
        
        if accessory.protocolStrings.contains(accessoryProtocol) {
            connectToAccessory(accessory)
        }
    }
    
    @objc private func handleAccessoryDisconnectNotification(_ notification: Notification) {
        guard let userInfo = notification.userInfo,
              let accessory = userInfo[EAAccessoryKey] as? EAAccessory,
              accessory == connectedAccessory else {
            return
        }
        
        AuditLogger.shared.log(event: .badgeReaderDisconnected, metadata: [
            "name": accessory.name
        ])
        
        disconnectFromAccessory()
    }
    
    deinit {
        NotificationCenter.default.removeObserver(self)
        disconnectFromAccessory()
    }
    
    // MARK: - State Reset
    
    /// Reset the badge reader state for next user
    func resetReaderState() {
        // Clear data buffer
        dataBuffer.removeAll()
        
        // Reset reading state
        isReading = false
        
        AuditLogger.shared.log(event: .badgeReaderReset, metadata: nil)
    }
}

// MARK: - EAAccessoryDelegate

extension BadgeReaderManager: EAAccessoryDelegate {
    func accessoryDidDisconnect(_ accessory: EAAccessory) {
        if accessory == connectedAccessory {
            disconnectFromAccessory()
        }
    }
}

// MARK: - StreamDelegate

extension BadgeReaderManager: StreamDelegate {
    func stream(_ aStream: Stream, handle eventCode: Stream.Event) {
        switch eventCode {
        case .hasBytesAvailable:
            if let inputStream = aStream as? InputStream {
                var buffer = [UInt8](repeating: 0, count: 256)
                var data = Data()
                
                while inputStream.hasBytesAvailable {
                    let bytesRead = inputStream.read(&buffer, maxLength: buffer.count)
                    if bytesRead > 0 {
                        data.append(buffer, count: bytesRead)
                    }
                }
                
                readData(data)
            }
            
        case .errorOccurred:
            if let streamError = aStream.streamError {
                delegate?.badgeReader(self, didFailWithError: streamError)
            }
            
        case .endEncountered:
            // Handle graceful disconnect
            break
            
        default:
            break
        }
    }
}

// MARK: - Badge Reader Errors

enum BadgeReaderError: LocalizedError {
    case notConnected
    case sessionCreationFailed
    case invalidDataFormat
    case invalidBadgeLength
    case writeFailed(Error?)
    case unknown
    
    var errorDescription: String? {
        switch self {
        case .notConnected:
            return "Badge reader is not connected"
        case .sessionCreationFailed:
            return "Failed to create session with badge reader"
        case .invalidDataFormat:
            return "Invalid data format from badge reader"
        case .invalidBadgeLength:
            return "Badge ID is too short"
        case .writeFailed(let error):
            if let error = error {
                return "Failed to write to badge reader: \(error.localizedDescription)"
            }
            return "Failed to write to badge reader"
        case .unknown:
            return "Unknown badge reader error"
        }
    }
}
