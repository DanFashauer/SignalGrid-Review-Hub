import UIKit

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
    
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        // Initialize core services. `SessionStateManager.shared` configures the
        // active badge-reader provider (setup + delegate) in its initializer via the
        // BadgeReaderProvider abstraction — the app must NOT wire the legacy
        // BadgeReaderManager directly here, or it would overwrite the provider's own
        // delegate registration and bypass the validated badge path.
        _ = SessionStateManager.shared
        _ = KeychainService.shared
        _ = AuditLogger.shared

        // Log app launch
        AuditLogger.shared.log(event: .appLaunched, metadata: [
            "deviceId": DeviceInfo.identifier,
            "bundleVersion": Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "unknown"
        ])
        
        return true
    }
    
    // MARK: - UISceneSession Lifecycle
    
    func application(
        _ application: UIApplication,
        configurationForConnecting connectingSceneSession: UISceneSession,
        options: UIScene.ConnectionOptions
    ) -> UISceneConfiguration {
        return UISceneConfiguration(
            name: "Default Configuration",
            sessionRole: connectingSceneSession.role
        )
    }
    
    func application(
        _ application: UIApplication,
        didDiscardSceneSessions sceneSessions: Set<UISceneSession>
    ) {
        // Handle discarded scenes if needed
    }
    
    // MARK: - Background Tasks
    
    func applicationDidEnterBackground(_ application: UIApplication) {
        // Log background entry
        AuditLogger.shared.log(event: .appEnteredBackground, metadata: nil)
        
        // Check session timeout
        Task {
            await SessionStateManager.shared.checkSessionTimeout()
        }
    }
    
    func applicationWillEnterForeground(_ application: UIApplication) {
        // Log foreground entry
        AuditLogger.shared.log(event: .appEnteredForeground, metadata: nil)
        
        // Check if session needs to be validated
        Task {
            await SessionStateManager.shared.validateActiveSession()
        }
    }
}
