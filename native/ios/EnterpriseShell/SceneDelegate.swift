import UIKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    
    var window: UIWindow?
    
    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard let windowScene = (scene as? UIWindowScene) else { return }

        window = SessionWindow(windowScene: windowScene)

        // Set up the root view controller based on session state
        let rootViewController = SessionStateManager.shared.currentViewController()
        window?.rootViewController = rootViewController
        window?.makeKeyAndVisible()
        
        // Observe session state changes
        observeSessionStateChanges()

        // REQUEST a kiosk lock while idle / pre-auth — a no-op unless the device is
        // MDM-supervised and this bundle ID is ASAM-permitted, in which case the OS
        // holds it until we release it on auth. Not a lock this app can impose.
        if SessionStateManager.shared.currentState == .lockedIdle {
            KioskController.shared.enforceLock()
        }

        // Attach the screen-capture guard (redacts on recording, audits screenshots).
        ScreenCaptureGuard.shared.attach(to: window)

        // Log scene connection
        AuditLogger.shared.log(event: .sceneConnected, metadata: [
            "sessionId": SessionStateManager.shared.currentSessionId ?? "none"
        ])
    }
    
    func sceneDidDisconnect(_ scene: UIScene) {
        AuditLogger.shared.log(event: .sceneDisconnected, metadata: nil)
    }
    
    func sceneDidBecomeActive(_ scene: UIScene) {
        // Re-assert the kiosk lock on activation ONLY while idle / pre-auth. During an
        // authenticated session the device stays unlocked for normal use.
        if SessionStateManager.shared.currentState == .lockedIdle {
            KioskController.shared.enforceLock()
        }
        // Validate session when becoming active
        Task {
            await SessionStateManager.shared.validateActiveSession()
        }
    }
    
    func sceneWillResignActive(_ scene: UIScene) {
        // Log before resigning active
        AuditLogger.shared.log(event: .sceneWillResignActive, metadata: nil)
    }
    
    func sceneWillEnterForeground(_ scene: UIScene) {
        // Check session validity on foreground
        Task {
            await SessionStateManager.shared.validateActiveSession()
        }
    }
    
    func sceneDidEnterBackground(_ scene: UIScene) {
        // Check timeout when entering background
        Task {
            await SessionStateManager.shared.checkSessionTimeout()
        }
    }
    
    // MARK: - Private Methods
    
    private func observeSessionStateChanges() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(sessionStateDidChange),
            name: .sessionStateDidChange,
            object: nil
        )
    }
    
    @objc private func sessionStateDidChange(_ notification: Notification) {
        guard let newState = notification.userInfo?["newState"] as? SessionState else { return }
        
        // Update root view controller based on new state
        let viewController = SessionStateManager.shared.viewController(for: newState)
        
        // Animate transition
        UIView.transition(
            with: window ?? UIWindow(),
            duration: 0.3,
            options: .transitionCrossDissolve,
            animations: {
                self.window?.rootViewController = viewController
            },
            completion: nil
        )
        
        // Log state transition
        AuditLogger.shared.log(event: .sessionStateChanged, metadata: [
            "newState": newState.rawValue
        ])
    }
    
    deinit {
        // `statusBarObserver` was declared and never registered, so this used to
        // unregister an observer that never existed. The selector-based observers this
        // scene DOES add are covered by removeObserver(self).
        NotificationCenter.default.removeObserver(self)
    }
}
