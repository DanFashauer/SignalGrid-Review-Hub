import UIKit

/// Kiosk lock via **Autonomous Single App Mode (ASAM)**.
///
/// A hard iOS truth: an app CANNOT, by itself, prevent being closed or force its
/// own relaunch — that is an OS capability, not an app one. The real mechanism is
/// ASAM: on an **MDM-supervised** device whose management profile authorizes this
/// bundle ID for Autonomous Single App Mode (the MDM payload
/// `com.apple.applicationaccess` key `autonomousSingleAppModePermittedAppIDs`),
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

    /// What the ASAM request answered. MAINTAINED ON THE MAIN THREAD ONLY — every
    /// write is inside a main-queue block — and read from main
    /// (`KioskConfig.localSessionAllowed` asserts it). A bare `isKioskActive == false`
    /// was being read as "not supervised", but it is also false BEFORE the ASAM
    /// callback returns and on a supervised device that is not in
    /// `AutonomousSingleAppModePermittedAppIDs`; only an explicit refusal means
    /// "no kiosk exists here".
    enum AsamProbe: String {
        /// No completed request yet (or the org opted out, so none was made).
        /// Proves nothing either way — and is therefore REFUSED as evidence.
        case notAttempted
        /// The OS refused ASAM: unsupervised or not permitted. The only answer that
        /// a code-free local sign-in may rely on.
        case unavailable
        /// ASAM (or manual Guided Access) was granted at least once this process:
        /// the device IS supervised. Sticky — a later release never downgrades it.
        case engaged
    }
    private(set) var asamProbe: AsamProbe = .notAttempted

    private func recordProbe(_ value: AsamProbe) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            if self.asamProbe == .engaged { return }   // sticky proof of supervision
            guard self.asamProbe != value else { return }
            self.asamProbe = value
            NotificationCenter.default.post(name: .asamProbeDidChange, object: nil)
        }
    }

    /// True when the device is ACTUALLY captive — either app-requested ASAM
    /// (`isLocked`) or a manually-enabled Guided Access session (the no-MDM
    /// alternative). Use this to verify the kiosk in testing without supervision.
    var isKioskActive: Bool { isLocked || UIAccessibility.isGuidedAccessEnabled }

    private func guidedAccessChanged() {
        let on = UIAccessibility.isGuidedAccessEnabled
        // Track the ACTUAL Guided Access / ASAM status in BOTH directions. If the
        // session ends outside releaseLock (a manual triple-click off, or a
        // system-driven change), leaving isLocked=true would make isKioskActive
        // report a captive device and enforceLock() exit at its already-locked
        // guard — so the pre-auth kiosk would never re-engage on the next scene
        // activation. Assigning `on` keeps the flag honest.
        isLocked = on
        if on { recordProbe(.engaged) }
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
                self.recordProbe(success ? .engaged : .unavailable)
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
                // Audit what actually HAPPENED (review finding): on a supervised device
                // that refuses/fails the ASAM release, `isLocked` correctly stays true
                // but the old path still recorded `kioskUnlocked` — an audit trail
                // claiming the kiosk was released while the holder stayed trapped in
                // the shell. Log the failure as a failure, and surface it so the UI
                // can show recovery guidance instead of pretending the device opened.
                if success {
                    self?.isLocked = false
                    AuditLogger.shared.log(event: .kioskUnlocked, metadata: ["reason": reason])
                } else {
                    AuditLogger.shared.log(
                        event: .kioskLockFailed,
                        metadata: ["reason": reason, "stage": "release_refused_still_locked"])
                    NotificationCenter.default.post(name: .kioskReleaseFailed, object: nil,
                                                    userInfo: ["reason": reason])
                }
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

    /// True when an MDM has delivered a Managed App Configuration dictionary
    /// (`com.apple.configuration.managed`). THIS PROVES NOTHING ABOUT SUPERVISION:
    /// app-config and the `com.apple.applicationaccess` ASAM authorisation are
    /// different payloads, and a supervised, kiosk-locked device may carry no
    /// app-config dictionary at all. Nothing here may loosen on its absence.
    static var isManaged: Bool {
        managed != nil
    }

    /// Disaster-recovery manual override with an admin code. OFF by default
    /// EVERYWHERE and NOT recommended — a company opts in via managed config
    /// (`AllowManualOverride = true`) together with a `RecoveryCode`.
    static var allowManualOverride: Bool {
        managedBool("AllowManualOverride", default: false)
    }

    /// Code-free local sign-in on an UNMANAGED phone. Requires a POSITIVE assertion
    /// by the person holding the device — the Settings-bundle toggle
    /// `local_session_allowed` (iOS Settings → Enterprise Shell, default OFF) — and
    /// an explicit OS refusal of ASAM (`KioskController.AsamProbe.unavailable`):
    /// a managed app-config dictionary, an engaged lock, or a probe that has not
    /// answered yet all refuse. MAIN THREAD ONLY (`asamProbe` is main-thread
    /// state); off-main callers hop first, as `BackendService.startSession` does.
    /// Absent policy is never permission:
    /// an earlier version defaulted manual login ON when the dictionary was absent,
    /// which on a supervised device with no app-config would have released the
    /// kiosk in two taps.
    static var localSessionAllowed: Bool {
        assert(Thread.isMainThread, "KioskConfig.localSessionAllowed reads main-thread kiosk state; hop to MainActor first")
        guard !isManaged else { return false }
        guard UserDefaults.standard.bool(forKey: "local_session_allowed") else { return false }
        return KioskController.shared.asamProbe == .unavailable
    }

    /// Whether the lock screen offers Manual login at all: the admin-code path
    /// (managed opt-in) or the local toggle path. Re-evaluated at the moment of the
    /// tap, never cached.
    static var manualLoginAvailable: Bool {
        allowManualOverride || localSessionAllowed
    }

    /// Control-plane base URL from Managed App Config (`BackendBaseURL`); the first
    /// step of `BackendService.resolveBaseURL()`'s order. Falls back to the
    /// same-named launch argument like every other key here.
    static var backendBaseURL: String? {
        managedString("BackendBaseURL")
    }

    /// Tenant bearer for the control plane (`BackendBearerToken`); the last step of
    /// `BackendService.tenantBearerToken`'s order.
    static var backendBearerToken: String? {
        managedString("BackendBearerToken")
    }

    /// `workflowKey` sent at session start (`BackendWorkflowKey`); see
    /// `BackendService.workflowKey` for the default.
    static var backendWorkflowKey: String? {
        managedString("BackendWorkflowKey")
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

    // A PRESENT managed dictionary answers only from itself: a key it lacks is an
    // absent value, never a launch argument. The plain-UserDefaults fallback (what
    // makes these keys settable with `-Key value` at launch) exists ONLY on a device
    // with no managed dictionary at all. Before this, a launch argument could set
    // `BackendBaseURL` on a managed device whose MDM had simply not set it.
    private static func managedBool(_ key: String, default def: Bool) -> Bool {
        if let dict = managed { return (dict[key] as? Bool) ?? def }
        if UserDefaults.standard.object(forKey: key) != nil { return UserDefaults.standard.bool(forKey: key) }
        return def
    }
    
    private static func managedString(_ key: String) -> String? {
        if let dict = managed { return dict[key] as? String }
        return UserDefaults.standard.string(forKey: key)
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

extension Notification.Name {
    /// Posted on the main thread whenever `KioskController.asamProbe` changes, so
    /// the lock screen can re-derive Manual login availability and its footer.
    static let asamProbeDidChange = Notification.Name("com.enterprise.shell.asamProbeDidChange")
}
