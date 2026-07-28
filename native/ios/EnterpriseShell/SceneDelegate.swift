import UIKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    
    var window: UIWindow?
    private var statusBarObserver: NSObjectProtocol?
    
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

        // Kiosk-lock the device while idle / pre-auth so it can't be tampered with
        // before a badge or login (no-op until MDM-supervised). Released on auth.
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
        if let observer = statusBarObserver {
            NotificationCenter.default.removeObserver(observer)
        }
        NotificationCenter.default.removeObserver(self)
    }
}
