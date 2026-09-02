import Foundation
import UIKit

/// Utility for accessing device information
struct DeviceInfo {
    
    private static var cachedIdentifier: String?
    private static let identifierLock = NSLock()

    /// Unique device identifier (stored in Keychain for security, changes on app
    /// reinstall). ALSO cached in memory: with no keychain-access-group
    /// entitlement (removed — nothing used it) an unsigned simulator build's save
    /// can fail with errSecMissingEntitlement, and before this cache every call
    /// then minted a NEW UUID — a different X-Device-ID on every request, and a
    /// different `deviceId` in every audit row of one process. The id is now
    /// stable for the life of the process whether or not the save succeeded.
    static var identifier: String {
        identifierLock.lock()
        defer { identifierLock.unlock() }
        if let cached = cachedIdentifier { return cached }
        // Use Keychain instead of UserDefaults for secure storage
        if let stored = try? KeychainService.shared.retrieve(forKey: "device_identifier"),
           let id = String(data: stored, encoding: .utf8) {
            cachedIdentifier = id
            return id
        }
        let newId = UUID().uuidString
        if let data = newId.data(using: .utf8) {
            try? KeychainService.shared.save(data, forKey: "device_identifier")
        }
        cachedIdentifier = newId
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
    
    // MARK: - MDM-supplied facts
    //
    // None of the four values below is readable by an app on iOS. The hardware serial,
    // the UDID, supervision and Single App Mode are properties of a supervised device
    // and reach an app only through MDM (golden rule 4). The environment reads exist so
    // a simulator can stand in for an MDM-supplied value during a demo or a proof, and
    // they are compiled out everywhere else: a launch argument the operator controls must
    // never reach an audit record, a session record or an identity payload as hardware
    // truth. On device each one answers "not known", which is the honest answer, and
    // callers already treat nil/false as the tighter side.

    /// Device serial number. MDM-supplied; nil unless a simulator stands one in.
    static var serialNumber: String? {
        #if targetEnvironment(simulator)
        return ProcessInfo.processInfo.environment["DEVICE_SERIAL"]
        #else
        return nil
        #endif
    }
    
    /// Device UDID. MDM-supplied; nil unless a simulator stands one in.
    static var udid: String? {
        #if targetEnvironment(simulator)
        return ProcessInfo.processInfo.environment["DEVICE_UDID"]
        #else
        return nil
        #endif
    }
    
    /// Whether the device is supervised. MDM-supplied; false unless a simulator stands it in.
    static var isSupervised: Bool {
        #if targetEnvironment(simulator)
        return ProcessInfo.processInfo.environment["MDM_SUPERVISED"] == "true"
        #else
        return false
        #endif
    }
    
    /// Whether the device is in kiosk/Single App Mode. MDM-supplied; false unless a
    /// simulator stands it in. An app cannot self-kiosk, so it cannot answer this alone.
    static var isKioskMode: Bool {
        #if targetEnvironment(simulator)
        return ProcessInfo.processInfo.environment["MDM_KIOSK_MODE"] == "true"
        #else
        return false
        #endif
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
