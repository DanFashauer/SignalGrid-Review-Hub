import Foundation
import UIKit

/// Service for launching enterprise applications
final class AppLauncher {
    
    // MARK: - Singleton
    
    static let shared = AppLauncher()
    
    // MARK: - Properties
    
    private var launchedApps: [String] = []
    private let launchQueue = DispatchQueue(label: "com.enterprise.shell.applauncher")
    
    // MARK: - Initialization
    
    private init() {}
    
    // MARK: - App Launching
    
    /// Launch an enterprise app
    func launchEnterpriseApp(_ app: EnterpriseApp) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            launchQueue.async { [weak self] in
                guard let self = self else {
                    continuation.resume(throwing: AppLauncherError.unknown)
                    return
                }
                
                // Try URL scheme first
                if let launchUrlString = app.launchUrl,
                   let url = URL(string: launchUrlString) {
                    
                    if UIApplication.shared.canOpenURL(url) {
                        UIApplication.shared.open(url, options: [:]) { success in
                            if success {
                                self.launchedApps.append(app.bundleId)
                                AuditLogger.shared.log(event: .sessionStarted, metadata: [
                                    "appLaunched": app.displayName
                                ])
                                continuation.resume()
                            } else {
                                // Try fallback methods if primary URL fails
                                self.tryFallbackLaunch(app: app, continuation: continuation)
                            }
                            return
                        }
                        return
                    }
                }
                
                // Try opening by bundle ID
                self.tryFallbackLaunch(app: app, continuation: continuation)
            }
        }
    }
    
    private func tryFallbackLaunch(app: EnterpriseApp, continuation: CheckedContinuation<Void, Error>) {
        // Try bundle ID URL scheme
        if let url = URL(string: "\(app.bundleId)://") {
            if UIApplication.shared.canOpenURL(url) {
                UIApplication.shared.open(url, options: [:]) { success in
                    if success {
                        self.launchedApps.append(app.bundleId)
                        continuation.resume()
                    } else {
                        // Last resort: open settings
                        self.openSettingsOrFail(app: app, continuation: continuation)
                    }
                }
                return
            }
        }
        
        // If all else fails, try opening in settings
        self.openSettingsOrFail(app: app, continuation: continuation)
    }
    
    private func openSettingsOrFail(app: EnterpriseApp, continuation: CheckedContinuation<Void, Error>) {
        if let settingsUrl = URL(string: UIApplication.openSettingsURLString) {
            UIApplication.shared.open(settingsUrl) { _ in
                // Open settings to let user manually open the app
                continuation.resume(throwing: AppLauncherError.appNotInstalled)
            }
            return
        }
        
        continuation.resume(throwing: AppLauncherError.unknown)
    }
    
    /// Launch app by bundle ID
    func launchApp(bundleId: String) async throws {
        let url = URL(string: "\(bundleId)://")!
        
        guard UIApplication.shared.canOpenURL(url) else {
            throw AppLauncherError.appNotInstalled
        }
        
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            UIApplication.shared.open(url) { success in
                if success {
                    self.launchedApps.append(bundleId)
                    continuation.resume()
                } else {
                    continuation.resume(throwing: AppLauncherError.launchFailed)
                }
            }
        }
    }
    
    /// Open a URL (for web links, deep links, etc.)
    func openUrl(_ url: URL) async throws {
        guard UIApplication.shared.canOpenURL(url) else {
            throw AppLauncherError.urlNotSupported
        }
        
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            UIApplication.shared.open(url) { success in
                if success {
                    continuation.resume()
                } else {
                    continuation.resume(throwing: AppLauncherError.launchFailed)
                }
            }
        }
    }
    
    // MARK: - App Management
    
    /// Get list of launched apps
    func getLaunchedApps() -> [String] {
        launchedApps
    }
    
    /// Check if app is installed
    func isAppInstalled(bundleId: String) -> Bool {
        let url = URL(string: "\(bundleId)://")!
        return UIApplication.shared.canOpenURL(url)
    }
    
    /// Get app display name from bundle
    func getAppDisplayName(bundleId: String) -> String? {
        guard let url = URL(string: "\(bundleId)://"),
              let scheme = url.scheme,
              let bundlePath = Bundle.main.path(forResource: scheme, ofType: "bundle"),
              let bundle = Bundle(path: bundlePath) else {
            return nil
        }
        
        return bundle.infoDictionary?["CFBundleDisplayName"] as? String ??
               bundle.infoDictionary?["CFBundleName"] as? String
    }
    
    // MARK: - Kiosk Mode Restrictions
    
    /// Request to exit kiosk mode (will fail on supervised devices)
    func requestExitKioskMode() {
        // This requires MDM configuration and will typically fail
        // in Single App Mode
        AuditLogger.shared.log(event: .error, metadata: [
            "action": "exit_kiosk_requested",
            "success": "false"
        ])
    }
    
    /// Notify MDM of session events (for supervision compliance)
    func notifyMDM(event: String, metadata: [String: String]) {
        // MDM can observe these notifications via NSNotificationCenter
        // or via Enterprise Management framework
        NotificationCenter.default.post(
            name: .MDMNotification,
            object: nil,
            userInfo: [
                "event": event,
                "metadata": metadata
            ]
        )
    }
}

// MARK: - MDM Notification

extension Notification.Name {
    static let MDMNotification = Notification.Name("com.enterprise.shell.mdm")
}

// MARK: - App Launcher Errors

enum AppLauncherError: LocalizedError {
    case appNotInstalled
    case launchFailed
    case urlNotSupported
    case unknown
    
    var errorDescription: String? {
        switch self {
        case .appNotInstalled:
            return "The requested app is not installed"
        case .launchFailed:
            return "Failed to launch the app"
        case .urlNotSupported:
            return "The URL scheme is not supported"
        case .unknown:
            return "An unknown error occurred"
        }
    }
}
