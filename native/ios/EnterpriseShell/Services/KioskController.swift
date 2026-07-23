import UIKit

/// Kiosk lock via **Autonomous Single App Mode (ASAM)**.
///
/// A hard iOS truth: an app CANNOT, by itself, prevent being closed or force its
/// own relaunch — that is an OS capability, not an app one. The real mechanism is
/// ASAM: on an **MDM-supervised** device whose management profile authorizes this
/// bundle ID for Autonomous Single App Mode (the MDM payload
/// `com.apple.applicationaccess` key `AutonomousSingleAppModePermittedAppIDs`),
/// the app locks itself in — Home / App-Switcher / notification gestures are
/// disabled and the user cannot leave until the app releases the lock. This is
/// what makes the device captive to the shell "until badge tap".
///
/// Two things still require MDM, and no in-app code can substitute for them:
///   • **Auto-relaunch if the app crashes / is force-quit** — that is MDM *Single
///     App Mode* (device locked to one app by the server), which relaunches it.
///   • **Take-over from first install** — provisioning the app into Single App /
///     ASAM permitted-apps via the management profile.
///
/// Fail-safe & dev-safe: when the device is NOT authorized (dev, simulator, an
/// unsupervised device), `requestGuidedAccessSession(enabled:)` simply returns
/// `false` — we log that and the app runs as a normal app. Nothing crashes; the
/// lock just isn't available until the device is properly supervised.
final class KioskController {

    static let shared = KioskController()
    private init() {}

    private(set) var isLocked = false
    private(set) var isRecoveryUnlocked = false

    /// Enforce the kiosk lock. Call whenever the app becomes active so the device
    /// stays captive to the shell the ENTIRE time it is running — including the
    /// badge-locked idle screen, not only during an active session.
    func enforceLock() {
        guard KioskConfig.singleAppModeEnabled else { return }
        guard !isRecoveryUnlocked else { return }        // a sanctioned recovery exit is active
        guard !isLocked else { return }                  // already locked
        UIAccessibility.requestGuidedAccessSession(enabled: true) { [weak self] success in
            self?.isLocked = success
            AuditLogger.shared.log(
                event: success ? .kioskLockEngaged : .kioskLockFailed,
                metadata: ["asam": success ? "engaged" : "unavailable_needs_mdm_supervision"])
        }
    }

    /// Release the lock. Only used for a sanctioned exit (disaster recovery) — never
    /// on badge-out (the device must STAY captive between users).
    func releaseLock(reason: String) {
        UIAccessibility.requestGuidedAccessSession(enabled: false) { [weak self] success in
            if success { self?.isLocked = false }
            AuditLogger.shared.log(event: .kioskUnlocked, metadata: ["reason": reason])
        }
    }

    // MARK: - Disaster-recovery manual override (OFF by default; not recommended)

    /// Validate a recovery code and, if correct, release the kiosk lock so an admin
    /// can service the device without a badge (e.g. reader failure). Gated by
    /// `KioskConfig.allowManualOverride`, which is off unless a company opts in via
    /// managed configuration. Returns whether the override was granted.
    @discardableResult
    func attemptRecoveryOverride(code: String) -> Bool {
        guard KioskConfig.allowManualOverride, KioskConfig.validateRecoveryCode(code) else {
            AuditLogger.shared.log(event: .kioskRecoveryDenied, metadata: nil)
            return false
        }
        isRecoveryUnlocked = true
        AuditLogger.shared.log(event: .kioskRecoveryOverride, metadata: ["result": "granted"])
        releaseLock(reason: "disaster_recovery_override")
        return true
    }

    /// End a recovery session and re-assert the kiosk lock.
    func endRecovery() {
        isRecoveryUnlocked = false
        enforceLock()
    }
}

/// Kiosk configuration, sourced from MDM **Managed App Configuration** (delivered
/// by the server under the `com.apple.configuration.managed` UserDefaults key),
/// with safe defaults for an unmanaged/dev build.
enum KioskConfig {

    /// Whether the shell locks itself into ASAM. Default ON — this is a locked
    /// shared-device kiosk. An MDM/managed config can turn it off for staging.
    static var singleAppModeEnabled: Bool {
        managedBool("SingleAppModeEnabled", default: true)
    }

    /// Disaster-recovery manual override. OFF by default and NOT recommended — a
    /// company may opt in (managed config `AllowManualOverride = true`) to let an
    /// admin code release the kiosk without a badge.
    static var allowManualOverride: Bool {
        managedBool("AllowManualOverride", default: false)
    }

    /// Validate a disaster-recovery code against the one provisioned by managed
    /// config (`RecoveryCode`). Never hardcoded; empty ⇒ always denied. Compared in
    /// constant time so a wrong code leaks no length/prefix timing.
    static func validateRecoveryCode(_ code: String) -> Bool {
        guard allowManualOverride else { return false }
        let expected = managedString("RecoveryCode") ?? ""
        guard !expected.isEmpty else { return false }
        return constantTimeEquals(code, expected)
    }

    // MARK: - Managed-config plumbing

    private static var managed: [String: Any]? {
        UserDefaults.standard.dictionary(forKey: "com.apple.configuration.managed")
    }

    private static func managedBool(_ key: String, default def: Bool) -> Bool {
        if let value = managed?[key] as? Bool { return value }
        if UserDefaults.standard.object(forKey: key) != nil { return UserDefaults.standard.bool(forKey: key) }
        return def
    }

    private static func managedString(_ key: String) -> String? {
        (managed?[key] as? String) ?? UserDefaults.standard.string(forKey: key)
    }

    /// Length-independent, constant-time string compare (avoid an early-exit oracle).
    private static func constantTimeEquals(_ a: String, _ b: String) -> Bool {
        let lhs = Array(a.utf8), rhs = Array(b.utf8)
        var diff = lhs.count ^ rhs.count
        for i in 0..<max(lhs.count, rhs.count) {
            let x = i < lhs.count ? lhs[i] : 0
            let y = i < rhs.count ? rhs[i] : 0
            diff |= Int(x ^ y)
        }
        return diff == 0
    }
}
