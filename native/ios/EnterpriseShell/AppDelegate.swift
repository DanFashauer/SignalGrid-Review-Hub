import UIKit

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
    
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        // Initialize core services
        _ = SessionStateManager.shared
        _ = KeychainService.shared
        _ = AuditLogger.shared
        
        // NO parallel badge reader here (review finding): SessionStateManager's init
        // already resolved and set up the ONE configured provider via
        // ProviderConfigurationService. Unconditionally starting the legacy
        // ExternalAccessory manager as well made any matching USB accessory an
        // additional, UNCONFIGURED badge source — and when the configured provider
        // was itself the ExternalAccessory wrapper, this delegate assignment
        // overwrote the wrapper's bridge. ProviderConfigurationService owns the
        // single active reader.

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
        let config = UISceneConfiguration(
            name: "Default Configuration",
            sessionRole: connectingSceneSession.role
        )
        // Assign the delegate from the real Swift type — the Info.plist string
        // lookup (NSClassFromString) was silently failing, so willConnect never
        // fired and no window was created (black screen).
        config.delegateClass = SceneDelegate.self
        return config
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
