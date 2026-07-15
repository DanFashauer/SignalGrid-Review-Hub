import Foundation
import UIKit

/// Utility for accessing device information
struct DeviceInfo {
    
    /// Unique device identifier (stored in Keychain for security, changes on app reinstall)
    static var identifier: String {
        // Use Keychain instead of UserDefaults for secure storage
        if let stored = try? KeychainService.shared.retrieve(forKey: "device_identifier"),
           let id = String(data: stored, encoding: .utf8) {
            return id
        }
        let newId = UUID().uuidString
        if let data = newId.data(using: .utf8) {
            try? KeychainService.shared.save(data, forKey: "device_identifier")
        }
        return newId
    }
    
    /// Hardware identifier (e.g., iPad14,1)
    static var hardwareModel: String {
        var systemInfo = utsname()
        uname(&systemInfo)
        let modelCode = withUnsafePointer(to: &systemInfo.machine) {
            $0.withMemoryRebound(to: CChar.self, capacity: 1) {
                String(validatingUTF8: $0)
            }
        }
        return modelCode ?? "unknown"
    }
    
    /// Human-readable device name
    static var deviceName: String {
        UIDevice.current.name
    }
    
    /// Device type (iPad, iPhone)
    static var deviceType: String {
        UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone"
    }
    
    /// iOS version
    static var osVersion: String {
        UIDevice.current.systemVersion
    }
    
    /// Full OS string
    static var osDescription: String {
        "\(deviceType) running iOS \(osVersion)"
    }
    
    /// Screen resolution
    static var screenResolution: String {
        let screen = UIScreen.main
        let scale = screen.scale
        return "\(Int(screen.bounds.width * scale))x\(Int(screen.bounds.height * scale))"
    }
    
    /// App version string
    static var appVersion: String {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "unknown"
        return "\(version) (\(build))"
    }
    
    /// Device serial number (requires MDM/Enterprise)
    static var serialNumber: String? {
        // This requires special entitlements and MDM API access
        // Return nil by default, override with MDM value if available
        return ProcessInfo.processInfo.environment["DEVICE_SERIAL"]
    }
    
    /// Device UDID (requires MDM)
    static var udid: String? {
        // This requires special entitlements
        return ProcessInfo.processInfo.environment["DEVICE_UDID"]
    }
    
    /// Whether device is supervised
    static var isSupervised: Bool {
        // Check for MDM-managed supervision
        return ProcessInfo.processInfo.environment["MDM_SUPERVISED"] == "true"
    }
    
    /// Whether device is in kiosk/single app mode
    static var isKioskMode: Bool {
        // This would be set by MDM configuration
        return ProcessInfo.processInfo.environment["MDM_KIOSK_MODE"] == "true"
    }
    
    /// Collect all device metadata for API requests
    static var metadata: [String: String] {
        [
            "device_type": deviceType,
            "hardware_model": hardwareModel,
            "os_version": osVersion,
            "screen_resolution": screenResolution,
            "app_version": appVersion,
            "device_identifier": identifier,
            "is_supervised": String(isSupervised),
            "is_kiosk_mode": String(isKioskMode)
        ]
    }
}
