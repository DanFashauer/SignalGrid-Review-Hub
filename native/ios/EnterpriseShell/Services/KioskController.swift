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
    private init() {
        // Observe MANUAL Guided Access (triple-click side button). An app can't START
        // Guided Access — only the OS/user can — but this lets a device WITHOUT MDM
        // supervision be locked for testing/low-MDM deployments, and the shell then
        // recognizes it as an active kiosk. ASAM (requestGuidedAccessSession) remains
        // the supervised, app-requested path.
        NotificationCenter.default.addObserver(
            forName: UIAccessibility.guidedAccessStatusDidChangeNotification,
            object: nil, queue: .main) { [weak self] _ in self?.guidedAccessChanged() }
    }

    private(set) var isLocked = false
    private(set) var isRecoveryUnlocked = false

    /// True when the device is ACTUALLY captive — either app-requested ASAM
    /// (`isLocked`) or a manually-enabled Guided Access session (the no-MDM
    /// alternative). Use this to verify the kiosk in testing without supervision.
    var isKioskActive: Bool { isLocked || UIAccessibility.isGuidedAccessEnabled }

    private func guidedAccessChanged() {
        let on = UIAccessibility.isGuidedAccessEnabled
        if on { isLocked = true }   // reflect a manual Guided Access lock as active
        AuditLogger.shared.log(
            event: on ? .kioskLockEngaged : .kioskUnlocked,
            metadata: ["mode": "guided_access_manual"])
    }

    /// Lock the IDLE device into Autonomous Single App Mode, so a shared device is
    /// held captive to the badge / login screen until someone authenticates. Called
    /// when the session machine enters `.lockedIdle` and on scene-active while still
    /// idle. Gated by `KioskConfig.singleAppModeEnabled`; a no-op on unsupervised/dev
    /// devices. Released once an authenticated session begins (see `releaseLock`).
    /// Safe to call from any thread — the UIKit request is marshaled to main.
    func enforceLock() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            guard KioskConfig.singleAppModeEnabled else { return }   // org opt-out → normal iPhone
            guard !self.isRecoveryUnlocked else { return }   // a sanctioned override is active
            guard !self.isLocked else { return }             // already locked
            UIAccessibility.requestGuidedAccessSession(enabled: true) { success in
                self.isLocked = success
                AuditLogger.shared.log(
                    event: success ? .kioskLockEngaged : .kioskLockFailed,
                    metadata: ["asam": success ? "engaged" : "unavailable_needs_mdm_supervision"])
            }
        }
    }

    /// Release the kiosk lock so the device returns to normal use. Called when an
    /// authenticated session begins (badge, or a manual override login if the org
    /// allows) and for a sanctioned recovery exit. The device RE-LOCKS when the
    /// session ends and the machine returns to `.lockedIdle`. Any-thread safe.
    func releaseLock(reason: String) {
        DispatchQueue.main.async { [weak self] in
            UIAccessibility.requestGuidedAccessSession(enabled: false) { success in
                if success { self?.isLocked = false }
                AuditLogger.shared.log(event: .kioskUnlocked, metadata: ["reason": reason])
            }
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

    /// Whether the shell runs the **kiosk-until-auth** model. **Default ON.** A shared
    /// device is held captive to the badge / login screen while IDLE (pre-auth); once
    /// a worker authenticates (badge, or a manual override login if the org allows),
    /// the lock is released and the device is usable like a normal iPhone — then
    /// constrained to the apps/policy the admin configured on the backend, which is
    /// enforced by MDM restrictions (`com.apple.applicationaccess` allowlist), NOT by
    /// this app (an app cannot restrict which other apps the OS runs). It re-locks when
    /// the session ends. An org can opt out via managed config (`SingleAppModeEnabled
    /// = false`). Requires MDM supervision to actually engage — a no-op on dev/personal
    /// devices, which simply run the shell as a normal app.
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
