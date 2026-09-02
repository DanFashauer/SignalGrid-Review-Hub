import SwiftUI
import UIKit
import ExternalAccessory
import os.log

// MARK: - Hosting seam

extension LockedIdleView {
    /// The ONE place `SessionStateManager`'s factory reaches SwiftUI. Returning a
    /// `UIViewController` keeps the state machine and `SceneDelegate` UIKit-only:
    /// the cross-dissolve root swap, `SessionWindow` (the idle timeout observes
    /// touches at the window), `ScreenCaptureGuard.attach(to:)` and the ASAM
    /// re-assert all keep working unchanged.
    static func hostingController() -> UIViewController {
        let host = UIHostingController(rootView: LockedIdleView())
        host.view.backgroundColor = SG.background
        return host
    }
}

// MARK: - View

/// The lock screen, rebuilt in SwiftUI — Phase 1 of the view-layer rebuild.
///
/// Composition follows the DEV prototype's "glance layer": one dominant hero
/// affordance and a raised status card — rendered in the ratified `SG` tokens
/// (adaptive light/dark, WCAG-AA decision colors) and Dynamic-Type text styles, so
/// the screen follows the device instead of pinning an appearance or a point size.
/// Every line of status is derived from live state, never a constant.
///
/// Behaviour is the UIKit screen's, preserved through `LockedIdleModel`: the
/// `lock_screen_presented` rows the Mac-lane proof greps, the manual-login gate
/// re-checked at the moment of the tap, and the invisible keyboard-wedge sink that
/// lets an HID badge reader type into this screen.
struct LockedIdleView: View {
    @StateObject private var model = LockedIdleModel()
    @State private var pulse = false

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.sgBackground.ignoresSafeArea()

            // Keyboard-wedge sink: 1x1, off the visual path, never laid out over text.
            KeyboardWedgeSink(armToken: model.wedgeArmToken)
                .frame(width: 1, height: 1)
                .accessibilityHidden(true)

            ScrollView {
                VStack(spacing: 0) {
                    header
                        .padding(.top, 48)
                        .padding(.bottom, 28)

                    hero
                        .padding(.horizontal, 24)

                    statusCard
                        .padding(.horizontal, 24)
                        .padding(.top, 16)

                    if let message = model.message {
                        Text(message)
                            .font(SGType.bodyEmphasis)
                            .foregroundColor(model.messageIsOK ? .sgAccent : .sgDeny)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.horizontal, 24)
                            .padding(.top, 12)
                            .accessibilityIdentifier("lockedIdle.message")
                    }

                    footer
                        .padding(.horizontal, 24)
                        .padding(.top, 12)
                        .padding(.bottom, 24)
                }
                .frame(maxWidth: .infinity)
            }
        }
        .sgKioskTypeCap()
        .onAppear {
            pulse = true
            model.onAppear()
        }
    }

    private var header: some View {
        VStack(spacing: 12) {
            Image(systemName: "square.grid.3x3.fill")
                .font(.largeTitle)
                .imageScale(.large)
                .foregroundColor(.sgPrimary)
                .accessibilityHidden(true)
            Text("Enterprise Device")
                .font(SGType.title)
                .foregroundColor(.sgForeground)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 20)
    }

    /// The dominant affordance. The badge is tapped PHYSICALLY (HID / reader), so
    /// this carries the prototype's hero presence as an indicator, not a button.
    private var hero: some View {
        VStack(spacing: 16) {
            Image(systemName: "creditcard.fill")
                .font(.largeTitle)
                .imageScale(.large)
                .foregroundColor(.sgAccent)
                .scaleEffect(pulse ? 1.08 : 1.0)
                .animation(.easeInOut(duration: 1.5).repeatForever(autoreverses: true), value: pulse)
                .accessibilityHidden(true)
            Text("Tap your badge to begin session")
                .font(SGType.instruction)
                .foregroundColor(.sgForeground)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            Text("Access is verified by identity, device trust and policy.")
                .font(SGType.caption)
                .foregroundColor(.sgMutedFg)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 28)
        .padding(.horizontal, 20)
        .sgCard()
    }

    /// The raised status card: the configured reader's real readiness, then the
    /// truthful lines about management, kiosk state and backend.
    private var statusCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 10) {
                if model.readerReady {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundColor(.sgAccent)
                        .accessibilityHidden(true)
                } else {
                    ProgressView()
                        .tint(.sgMutedFg)
                }
                Text(model.readerText)
                    .font(SGType.body)
                    .foregroundColor(model.readerReady ? .sgAccent : .sgMutedFg)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if !model.footerLines.isEmpty {
                Divider().overlay(Color.sgBorder)
                ForEach(Array(model.footerLines.enumerated()), id: \.offset) { _, line in
                    Text(line)
                        .font(SGType.caption)
                        .foregroundColor(.sgMutedFg)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .sgCard()
        .accessibilityIdentifier("lockedIdle.status")
    }

    /// Manual login without a badge. Shown only on a POSITIVE assertion (see
    /// `KioskConfig.manualLoginAvailable`); absent policy is never permission.
    private var footer: some View {
        Group {
            if model.manualLoginAvailable {
                Button(action: { model.recoveryTapped() }) {
                    Text("Manual login")
                        .font(SGType.caption)
                        .foregroundColor(Color.sgMutedFg.opacity(0.7))
                        .multilineTextAlignment(.center)
                }
                .accessibilityIdentifier("lockedIdle.manualLogin")
            }
        }
    }
}

// MARK: - Model (the UIKit screen's behaviour, verbatim)

final class LockedIdleModel: ObservableObject {
    /// Unified-log channel the Mac-lane proof greps
    /// (`log stream --predicate 'subsystem == "com.enterprise.shell"'`).
    private static let lockLog = OSLog(subsystem: "com.enterprise.shell", category: "lockscreen")
    private static let hidEnterKeyCode: UInt16 = 0x28

    @Published var readerText: String = ""
    @Published var readerReady: Bool = false
    @Published var footerLines: [String] = []
    @Published var manualLoginAvailable: Bool = false
    @Published var message: String? = nil
    @Published var messageIsOK: Bool = false
    /// Bumped to (re-)arm the keyboard-wedge sink as first responder.
    @Published var wedgeArmToken: Int = 0

    private var observers: [NSObjectProtocol] = []
    private var hideMessageWork: DispatchWorkItem?

    #if targetEnvironment(simulator)
    /// Ensures `-SimulateBadge` injects only once across returns to this screen.
    private static var didInjectSimulatedBadge = false
    #endif

    init() {
        let nc = NotificationCenter.default
        observers.append(nc.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            // The holder may have flipped the Settings toggle and come back.
            self?.refresh()
            self?.armWedge()
            self?.logLockScreenPresented(trigger: "did_become_active")
        })
        // The ASAM probe answers AFTER the screen is first shown; re-derive and
        // re-log when it does, so the last log row reflects the settled state.
        observers.append(nc.addObserver(forName: .asamProbeDidChange, object: nil, queue: .main) { [weak self] _ in
            self?.refresh()
            self?.logLockScreenPresented(trigger: "asam_probe_changed")
        })
        observers.append(nc.addObserver(forName: .sessionStateDidChange, object: nil, queue: .main) { [weak self] notification in
            guard let newState = notification.userInfo?[SessionStateNotificationKeys.newState] as? SessionState,
                  newState == .lockedIdle else { return }
            self?.checkForLastError()
        })
        observers.append(nc.addObserver(forName: .EAAccessoryDidConnect, object: nil, queue: .main) { [weak self] _ in
            self?.updateReaderStatus()
        })
        observers.append(nc.addObserver(forName: .EAAccessoryDidDisconnect, object: nil, queue: .main) { [weak self] _ in
            self?.updateReaderStatus()
        })
    }

    deinit {
        observers.forEach { NotificationCenter.default.removeObserver($0) }
    }

    func onAppear() {
        refresh()
        checkForLastError()
        armWedge()
        logLockScreenPresented(trigger: "did_appear")
        #if targetEnvironment(simulator)
        injectSimulatedBadgeOnce()
        #endif
    }

    // MARK: Derived state (from the CONFIGURED provider and live config)

    private func refresh() {
        updateReaderStatus()
        updateFooter()
        manualLoginAvailable = KioskConfig.manualLoginAvailable
    }

    /// Reads the CONFIGURED reader's readiness — never the legacy manager that
    /// nothing configures.
    private func updateReaderStatus() {
        let status = ProviderConfigurationService.shared.badgeReaderStatus()
        readerText = status.text
        readerReady = status.ready
    }

    private func updateFooter() {
        var lines: [String] = []
        if !KioskConfig.isManaged {
            // No app-config dictionary. That does NOT mean unsupervised: ASAM is a
            // different payload. Only the OS's own answer to the kiosk request counts.
            switch KioskController.shared.asamProbe {
            case .engaged:
                lines.append("No managed app configuration, but the kiosk lock has engaged — this device is supervised. Manual login is unavailable.")
            case .notAttempted:
                lines.append("No managed app configuration. Kiosk state not yet determined — local sign-in is unavailable until the OS answers the kiosk request.")
            case .unavailable:
                if KioskConfig.localSessionAllowed {
                    lines.append("Unmanaged device (kiosk unavailable). Local sign-in is enabled in iOS Settings → Enterprise Shell.")
                } else {
                    lines.append("Unmanaged device (no managed app configuration; kiosk unavailable). Local sign-in is off — "
                        + "enable it in iOS Settings → Enterprise Shell → “Allow local sign-in on this unmanaged device”.")
                }
            }
        }
        lines.append(BackendService.statusLine)
        if let reason = ProviderConfigurationService.shared.badgeReaderUnavailableReason {
            lines.append(reason)
        }
        footerLines = lines
    }

    private func checkForLastError() {
        hideMessageWork?.cancel()
        if let error = SessionStateManager.shared.lastError {
            message = error.localizedDescription
            messageIsOK = false
            // Auto-hide after 10 seconds
            let work = DispatchWorkItem { [weak self] in self?.message = nil }
            hideMessageWork = work
            DispatchQueue.main.asyncAfter(deadline: .now() + 10, execute: work)
        } else {
            message = nil
        }
    }

    /// The one deterministic row the Mac-lane proof asserts on: exactly the inputs
    /// that decide Manual login, to the audit log AND the unified log. A row per
    /// appearance, activation and probe change; the proof greps for the presence
    /// or absence of `manual_login_available=true` across all of them.
    private func logLockScreenPresented(trigger: String) {
        let available = KioskConfig.manualLoginAvailable
        let managed = KioskConfig.isManaged
        let kioskActive = KioskController.shared.isKioskActive
        let probe = KioskController.shared.asamProbe.rawValue
        let local = KioskConfig.localSessionAllowed
        AuditLogger.shared.log(event: .lockScreenPresented, metadata: [
            "trigger": trigger,
            "manual_login_available": String(available),
            "managed": String(managed),
            "kiosk_active": String(kioskActive),
            "asam_probe": probe,
            "local_session_allowed": String(local)
        ])
        os_log(.default, log: Self.lockLog,
               "lock_screen_presented trigger=%{public}@ manual_login_available=%{public}@ managed=%{public}@ kiosk_active=%{public}@ asam_probe=%{public}@ local_session_allowed=%{public}@",
               trigger, String(available), String(managed), String(kioskActive), probe, String(local))
    }

    // MARK: Keyboard wedge

    private var keyboardWedgeConfigured: Bool {
        ProviderConfigurationService.shared.getConfiguration().badgeReader.readerType == .keyboardWedge
    }

    /// Ask the sink to become first responder so an HID reader's keystrokes reach
    /// the keyboard-wedge provider. Re-armed on appear, on app activation, and
    /// after every alert this screen presents (an alert steals the responder).
    func armWedge() {
        guard keyboardWedgeConfigured else { return }
        wedgeArmToken &+= 1
    }

    fileprivate static func postWedgeKey(keyCode: UInt16, characters: String) {
        NotificationCenter.default.post(
            name: .badgeReaderKeyboardInput,
            object: nil,
            userInfo: ["keyCode": keyCode, "characters": characters]
        )
    }

    fileprivate static func postWedgeEnter() {
        postWedgeKey(keyCode: hidEnterKeyCode, characters: "")
    }

    // MARK: Manual login (the UIKit screen's two paths, verbatim)

    /// Two paths, both audited, both re-checked at the moment of the tap:
    ///  • managed opt-in (`AllowManualOverride`): prompt for the admin code; every
    ///    guess consumes the device-wide auth-attempt budget;
    ///  • local toggle (`KioskConfig.localSessionAllowed`: no managed dictionary,
    ///    `local_session_allowed` ON in iOS Settings, and NO kiosk lock engaged):
    ///    confirm and proceed. Any session this starts is what `BackendService`
    ///    allows — a local, app-less workspace when no backend is configured.
    /// Anything else: the affordance is refused, and the card says why.
    func recoveryTapped() {
        guard KioskConfig.allowManualOverride else {
            guard KioskConfig.localSessionAllowed else {
                manualLoginAvailable = false
                updateFooter()
                showRecoveryResult("Manual login is not available on this device.", ok: false)
                return
            }
            let alert = UIAlertController(
                title: "Manual login",
                message: "Local sign-in is enabled in iOS Settings for this unmanaged device. Start a session without a badge? This is logged.",
                preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { [weak self] _ in
                self?.armWedge()
            })
            alert.addAction(UIAlertAction(title: "Log in", style: .default) { [weak self] _ in
                self?.showRecoveryResult("Local sign-in accepted (unmanaged device, Settings toggle on).", ok: true)
                SessionStateManager.shared.beginManualOverrideLogin()
                self?.armWedge()
            })
            presentAlert(alert)
            return
        }

        let alert = UIAlertController(
            title: "Manual login",
            message: "Sign in without a badge using the admin-issued login code. This is logged.",
            preferredStyle: .alert)
        alert.addTextField { field in
            field.isSecureTextEntry = true
            field.keyboardType = .numberPad
            field.placeholder = "Login code"
        }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { [weak self] _ in
            self?.armWedge()
        })
        alert.addAction(UIAlertAction(title: "Log in", style: .default) { [weak self] _ in
            defer { self?.armWedge() }
            // Bounded + audited (review finding): every guess consumes the device-wide
            // auth-attempt budget BEFORE the validator runs, and every rejection is
            // recorded. Exceeding the budget locks the affordance out until the window
            // passes (SecurityManager audits the rate-limit denial).
            guard SecurityManager.shared.isAuthAttemptAllowed() else {
                self?.showRecoveryResult("Too many attempts. Manual login is locked — try again later.", ok: false)
                return
            }
            let code = alert.textFields?.first?.text ?? ""
            if KioskConfig.validateRecoveryCode(code) {
                self?.showRecoveryResult("Manual login accepted.", ok: true)
                SessionStateManager.shared.beginManualOverrideLogin()
            } else {
                SecurityManager.shared.recordFailedAttempt(type: .authentication)
                self?.showRecoveryResult("Login code rejected.", ok: false)
            }
        })
        presentAlert(alert)
    }

    private func showRecoveryResult(_ text: String, ok: Bool) {
        hideMessageWork?.cancel()
        message = text
        messageIsOK = ok
    }

    /// Present through the hosting controller. The screen is the window's root, so
    /// the alert (with its secure code field, which SwiftUI cannot express on the
    /// iOS 15 target) keeps the exact UIKit behaviour the audited flow was built on.
    private func presentAlert(_ alert: UIAlertController) {
        guard let presenter = Self.topPresenter() else { return }
        presenter.present(alert, animated: true)
    }

    private static func topPresenter() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let window = scenes.flatMap { $0.windows }.first { $0.isKeyWindow } ?? scenes.first?.windows.first
        var top = window?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }

    // MARK: Simulator

    #if targetEnvironment(simulator)
    /// The simulator has no badge-reader hardware. If launched with
    /// `-SimulateBadge <id>`, inject that badge ONCE so the session flow can be
    /// exercised without a physical reader. (The launch arg lives in the argument
    /// domain and can't be cleared via removeObject, so guard with a static flag.)
    private func injectSimulatedBadgeOnce() {
        guard !Self.didInjectSimulatedBadge else { return }
        if let badge = UserDefaults.standard.string(forKey: "SimulateBadge"), !badge.isEmpty {
            Self.didInjectSimulatedBadge = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                SessionStateManager.shared.onBadgeScanned(badge)
            }
        } else if UserDefaults.standard.bool(forKey: "SimulateManualLogin"), KioskConfig.allowManualOverride {
            // Demo the manual-override login path (no code entry): -SimulateManualLogin YES
            Self.didInjectSimulatedBadge = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                SessionStateManager.shared.beginManualOverrideLogin()
            }
        }
    }
    #endif
}

// MARK: - Keyboard-wedge sink

/// KEYBOARD-WEDGE INPUT PATH. Most USB / Bluetooth badge readers are HID
/// keyboards: they "type" the badge id and press Return. The default reader
/// provider (`KeyboardWedgeBadgeReaderProvider`) listens for
/// `.badgeReaderKeyboardInput`; without a first responder on the lock screen every
/// keystroke from a real reader goes nowhere and the screen is dead on a phone.
///
/// Invisible and keyboard-less on purpose: `inputView` is an empty view so the
/// software keyboard never appears (the field only receives hardware input), and
/// every keystroke is forwarded and DISCARDED — the provider owns the buffer; this
/// field never accumulates a badge id.
struct KeyboardWedgeSink: UIViewRepresentable {
    /// Bumped by the model whenever the sink should (re-)take first responder.
    let armToken: Int

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> UITextField {
        let field = UITextField()
        field.delegate = context.coordinator
        field.autocorrectionType = .no
        field.autocapitalizationType = .none
        field.spellCheckingType = .no
        field.smartDashesType = .no
        field.smartQuotesType = .no
        field.smartInsertDeleteType = .no
        field.keyboardType = .asciiCapable
        field.returnKeyType = .done
        field.inputView = UIView(frame: .zero)          // no on-screen keyboard
        field.inputAccessoryView = nil
        field.inputAssistantItem.leadingBarButtonGroups = []
        field.inputAssistantItem.trailingBarButtonGroups = []
        field.tintColor = .clear
        field.alpha = 0.02                              // a hidden view cannot be first responder
        field.isAccessibilityElement = false
        return field
    }

    func updateUIView(_ field: UITextField, context: Context) {
        guard armToken != context.coordinator.lastArmToken else { return }
        // Deferred one turn: a UIAlertAction handler runs while its alert is still
        // being dismissed, when the presented controller is not yet nil. The token
        // is only consumed once the field is actually in a window, so an early
        // update (before attachment) retries on the next one instead of being lost.
        DispatchQueue.main.async {
            guard field.window != nil else { return }
            context.coordinator.lastArmToken = armToken
            guard field.window?.rootViewController?.presentedViewController == nil,
                  !field.isFirstResponder else { return }
            field.becomeFirstResponder()
        }
    }

    final class Coordinator: NSObject, UITextFieldDelegate {
        var lastArmToken = -1

        /// Every character an HID reader types is forwarded to the keyboard-wedge
        /// provider as one `.badgeReaderKeyboardInput` and DISCARDED here (returns
        /// false): the provider owns the buffer and the badge id never sits in a
        /// text field. A newline is the reader's Return.
        func textField(_ textField: UITextField, shouldChangeCharactersIn range: NSRange, replacementString string: String) -> Bool {
            for scalar in string.unicodeScalars {
                if scalar == "\n" || scalar == "\r" {
                    LockedIdleModel.postWedgeEnter()
                } else {
                    LockedIdleModel.postWedgeKey(keyCode: 0, characters: String(scalar))
                }
            }
            return false
        }

        func textFieldShouldReturn(_ textField: UITextField) -> Bool {
            LockedIdleModel.postWedgeEnter()
            return false
        }
    }
}
