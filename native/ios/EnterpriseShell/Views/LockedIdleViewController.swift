import UIKit
import os.log

/// View controller for the locked idle state - shows login prompt
final class LockedIdleViewController: UIViewController {

    /// Unified-log channel the Mac-lane proof greps
    /// (`log stream --predicate 'subsystem == "com.enterprise.shell"'`).
    private static let lockLog = OSLog(subsystem: "com.enterprise.shell", category: "lockscreen")
    
    // MARK: - UI Components
    
    private lazy var backgroundView: UIView = {
        let view = UIView()
        view.backgroundColor = SG.background
        view.translatesAutoresizingMaskIntoConstraints = false
        return view
    }()
    
    private lazy var logoImageView: UIImageView = {
        let imageView = UIImageView()
        imageView.contentMode = .scaleAspectFit
        imageView.image = UIImage(systemName: "square.grid.3x3.fill")
        imageView.tintColor = SG.primary
        imageView.translatesAutoresizingMaskIntoConstraints = false
        return imageView
    }()
    
    private lazy var titleLabel: UILabel = {
        let label = UILabel()
        label.text = "Enterprise Device"
        label.font = SG.sans(28, .bold)
        label.adjustsFontForContentSizeCategory = true
        label.numberOfLines = 0
        label.textAlignment = .center
        label.textColor = SG.foreground
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()
    
    private lazy var instructionLabel: UILabel = {
        let label = UILabel()
        label.text = "Tap your badge to begin session"
        label.font = SG.sans(18, .medium)
        label.adjustsFontForContentSizeCategory = true
        label.numberOfLines = 0
        label.textAlignment = .center
        label.textColor = SG.mutedFg
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()
    
    private lazy var badgeIconView: UIImageView = {
        let imageView = UIImageView()
        imageView.contentMode = .scaleAspectFit
        imageView.image = UIImage(systemName: "creditcard.fill")
        imageView.tintColor = SG.accent
        imageView.translatesAutoresizingMaskIntoConstraints = false
        return imageView
    }()
    
    private lazy var statusLabel: UILabel = {
        let label = UILabel()
        label.font = SG.sans(14, .regular)
        label.adjustsFontForContentSizeCategory = true
        label.numberOfLines = 0
        label.textAlignment = .center
        label.textColor = SG.mutedFg
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()
    
    private lazy var activityIndicator: UIActivityIndicatorView = {
        let indicator = UIActivityIndicatorView(style: .medium)
        indicator.color = SG.mutedFg
        indicator.hidesWhenStopped = true
        indicator.translatesAutoresizingMaskIntoConstraints = false
        return indicator
    }()
    
    private lazy var errorLabel: UILabel = {
        let label = UILabel()
        label.font = SG.sans(14, .medium)
        label.adjustsFontForContentSizeCategory = true
        label.textAlignment = .center
        label.textColor = SG.deny
        label.numberOfLines = 0
        label.translatesAutoresizingMaskIntoConstraints = false
        label.isHidden = true
        return label
    }()

    /// The truthful footer: whether the device is under managed configuration,
    /// which backend (if any) is configured, and any reader that is declared but
    /// not implemented. Every line is derived from live state, never a constant.
    private lazy var footerLabel: UILabel = {
        let label = UILabel()
        label.font = SG.sans(12, .regular)
        label.adjustsFontForContentSizeCategory = true
        label.textAlignment = .center
        label.textColor = SG.mutedFg
        label.numberOfLines = 0
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()
    
    /// Manual login without a badge. Shown only on a POSITIVE assertion: the managed
    /// opt-in (`AllowManualOverride` + `RecoveryCode`, admin code required) or, on an
    /// unmanaged phone, the Settings-bundle toggle `local_session_allowed` — and
    /// never while a kiosk lock is actually engaged (see `KioskConfig`).
    private lazy var recoveryButton: UIButton = {
        let button = UIButton(type: .system)
        button.setTitle("Manual login", for: .normal)
        button.setTitleColor(SG.mutedFg.withAlphaComponent(0.6), for: .normal)
        button.titleLabel?.font = SG.sans(12, .regular)
        button.titleLabel?.adjustsFontForContentSizeCategory = true
        button.titleLabel?.numberOfLines = 0
        button.titleLabel?.lineBreakMode = .byWordWrapping
        button.addTarget(self, action: #selector(recoveryTapped), for: .touchUpInside)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.isHidden = true
        return button
    }()

    /// KEYBOARD-WEDGE INPUT PATH. Most USB / Bluetooth badge readers are HID
    /// keyboards: they "type" the badge id and press Return. The default reader
    /// provider (`KeyboardWedgeBadgeReaderProvider`) listens for
    /// `.badgeReaderKeyboardInput`, and until this field existed NOTHING posted
    /// it — the lock screen had no first responder, so every keystroke from a real
    /// reader went nowhere and the screen was dead on every real phone.
    ///
    /// Invisible and keyboard-less on purpose: `inputView` is an empty view so the
    /// software keyboard never appears (the field only receives hardware input),
    /// and every keystroke is forwarded and DISCARDED — the provider owns the
    /// buffer, this field never accumulates a badge id.
    private lazy var wedgeField: UITextField = {
        let field = UITextField()
        field.delegate = self
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
        field.translatesAutoresizingMaskIntoConstraints = false
        return field
    }()

    private static let hidEnterKeyCode: UInt16 = 0x28

    private var badgeReaderObserver: NSObjectProtocol?
    private var stateChangeObserver: NSObjectProtocol?
    private var becameActiveObserver: NSObjectProtocol?
    private var asamProbeObserver: NSObjectProtocol?

    #if targetEnvironment(simulator)
    /// Ensures `-SimulateBadge` injects only once (see viewDidAppear).
    private static var didInjectSimulatedBadge = false
    #endif

    // MARK: - Lifecycle
    
    override func viewDidLoad() {
        super.viewDidLoad()
        setupUI()
        setupBadgeReaderObserver()
        setupStateChangeObserver()
        becameActiveObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            // The holder may have flipped the Settings toggle and come back.
            self?.recoveryButton.isHidden = !KioskConfig.manualLoginAvailable
            self?.armKeyboardWedge()
            self?.updateReaderStatus()
            self?.updateFooter()
            self?.logLockScreenPresented(trigger: "did_become_active")
        }
        // The ASAM probe answers AFTER the screen is first shown; re-derive and
        // re-log when it does, so the last log row reflects the settled state.
        asamProbeObserver = NotificationCenter.default.addObserver(
            forName: .asamProbeDidChange,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.recoveryButton.isHidden = !KioskConfig.manualLoginAvailable
            self?.updateFooter()
            self?.logLockScreenPresented(trigger: "asam_probe_changed")
        }
    }
    
    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        recoveryButton.isHidden = !KioskConfig.manualLoginAvailable
        updateReaderStatus()
        updateFooter()
        checkForLastError()
    }
    
    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        stopBadgeIconAnimation()
        wedgeField.resignFirstResponder()
    }
    
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        updateReaderStatus()
        armKeyboardWedge()
        logLockScreenPresented(trigger: "did_appear")
        #if targetEnvironment(simulator)
        // The simulator has no badge-reader hardware. If launched with
        // `-SimulateBadge <id>`, inject that badge ONCE so the session flow can be
        // exercised without a physical reader. (The launch arg lives in the argument
        // domain and can't be cleared via removeObject, so guard with a static flag
        // to avoid re-injecting every time we return to LockedIdle.)
        if !Self.didInjectSimulatedBadge {
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
    
    deinit {
        if let observer = badgeReaderObserver {
            NotificationCenter.default.removeObserver(observer)
        }
        if let observer = stateChangeObserver {
            NotificationCenter.default.removeObserver(observer)
        }
        if let observer = becameActiveObserver {
            NotificationCenter.default.removeObserver(observer)
        }
        if let observer = asamProbeObserver {
            NotificationCenter.default.removeObserver(observer)
        }
        NotificationCenter.default.removeObserver(self)
    }
    
    // MARK: - Setup
    
    private func setupUI() {
        view.addSubview(backgroundView)
        view.addSubview(logoImageView)
        view.addSubview(titleLabel)
        view.addSubview(instructionLabel)
        view.addSubview(badgeIconView)
        view.addSubview(activityIndicator)
        view.addSubview(statusLabel)
        view.addSubview(errorLabel)
        view.addSubview(footerLabel)
        view.addSubview(recoveryButton)
        view.addSubview(wedgeField)
        recoveryButton.isHidden = !KioskConfig.manualLoginAvailable

        // The badge icon sits at the optical center at normal text sizes, but that
        // center is pinned to the VIEW, not to the text above it — so once the
        // instruction label wraps under Dynamic Type it grew straight into the icon.
        // Dropping the priority lets the >= constraint below win exactly when it has
        // to, leaving the designed layout untouched at normal sizes.
        let badgeCenterY = badgeIconView.centerYAnchor.constraint(
            equalTo: view.centerYAnchor, constant: 40)
        // 500, deliberately BELOW a label's default vertical compression resistance
        // (750). At .defaultHigh the two tied and Auto Layout satisfied the centering
        // by squashing the instruction label back down to one truncated line — the
        // overlap became an ellipsis, which is not a fix. Ranking the text above the
        // centering makes the icon move and the words stay whole.
        badgeCenterY.priority = UILayoutPriority(500)

        // The text must never be the thing that gives.
        titleLabel.setContentCompressionResistancePriority(.required, for: .vertical)
        instructionLabel.setContentCompressionResistancePriority(.required, for: .vertical)

        // The footer sits above the manual-login affordance; it must never climb
        // into the error text. Optional (750) so an accessibility size that cannot
        // satisfy both prefers to let them touch rather than break the layout.
        let footerBelowError = footerLabel.topAnchor.constraint(
            greaterThanOrEqualTo: errorLabel.bottomAnchor, constant: 8)
        footerBelowError.priority = .defaultHigh

        NSLayoutConstraint.activate([
            recoveryButton.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            recoveryButton.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 20),
            recoveryButton.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -20),
            recoveryButton.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -16),

            // Footer
            footerLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            footerLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
            footerLabel.bottomAnchor.constraint(equalTo: recoveryButton.topAnchor, constant: -8),
            footerBelowError,

            // Keyboard-wedge sink: 1x1, off the visual path, never laid out over text
            wedgeField.widthAnchor.constraint(equalToConstant: 1),
            wedgeField.heightAnchor.constraint(equalToConstant: 1),
            wedgeField.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            wedgeField.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),

            // Background
            backgroundView.topAnchor.constraint(equalTo: view.topAnchor),
            backgroundView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            backgroundView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            backgroundView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            
            // Logo
            logoImageView.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            logoImageView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 80),
            logoImageView.widthAnchor.constraint(equalToConstant: 100),
            logoImageView.heightAnchor.constraint(equalToConstant: 100),
            
            // Title
            titleLabel.topAnchor.constraint(equalTo: logoImageView.bottomAnchor, constant: 24),
            titleLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            titleLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            
            // Instruction
            instructionLabel.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 12),
            instructionLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            instructionLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            
            // Badge Icon
            badgeIconView.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            badgeCenterY,
            // Never overlap the instruction text, whatever size the user picked.
            badgeIconView.topAnchor.constraint(
                greaterThanOrEqualTo: instructionLabel.bottomAnchor, constant: 24),
            badgeIconView.widthAnchor.constraint(equalToConstant: 80),
            badgeIconView.heightAnchor.constraint(equalToConstant: 60),
            
            // Activity Indicator
            activityIndicator.topAnchor.constraint(equalTo: badgeIconView.bottomAnchor, constant: 24),
            activityIndicator.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            
            // Status
            statusLabel.topAnchor.constraint(equalTo: activityIndicator.bottomAnchor, constant: 16),
            statusLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            statusLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            
            // Error Label
            errorLabel.topAnchor.constraint(equalTo: statusLabel.bottomAnchor, constant: 12),
            errorLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            errorLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24)
        ])
        
        // Animate badge icon
        animateBadgeIcon()
    }
    
    private func setupBadgeReaderObserver() {
        badgeReaderObserver = NotificationCenter.default.addObserver(
            forName: .EAAccessoryDidConnect,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.updateReaderStatus()
        }
        
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(accessoryDisconnected),
            name: .EAAccessoryDidDisconnect,
            object: nil
        )
    }
    
    private func setupStateChangeObserver() {
        stateChangeObserver = NotificationCenter.default.addObserver(
            forName: .sessionStateDidChange,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let newState = notification.userInfo?[SessionStateNotificationKeys.newState] as? SessionState else {
                return
            }
            
            // Check for errors when transitioning to lockedIdle
            if newState == .lockedIdle {
                self?.checkForLastError()
            }
        }
    }
    
    private func checkForLastError() {
        if let error = SessionStateManager.shared.lastError {
            errorLabel.text = error.localizedDescription
            errorLabel.textColor = SG.deny
            errorLabel.isHidden = false
            
            // Auto-hide after 10 seconds
            DispatchQueue.main.asyncAfter(deadline: .now() + 10) { [weak self] in
                self?.errorLabel.isHidden = true
            }
        } else {
            errorLabel.isHidden = true
        }
    }

    // MARK: - Status + footer (derived from the CONFIGURED provider and live config)
    
    /// Reads the CONFIGURED reader's readiness. This used to read the legacy
    /// `BadgeReaderManager.shared.isConnected`, which nothing configures, so it
    /// said "No badge reader detected" forever while a keyboard-wedge reader was
    /// the configured default.
    private func updateReaderStatus() {
        let status = ProviderConfigurationService.shared.badgeReaderStatus()
        statusLabel.text = status.text
        statusLabel.textColor = status.ready ? SG.accent : SG.mutedFg
        if status.ready {
            activityIndicator.stopAnimating()
        } else {
            activityIndicator.startAnimating()
        }
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
        footerLabel.text = lines.joined(separator: "\n")
    }
    
    @objc private func accessoryDisconnected() {
        updateReaderStatus()
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

    // MARK: - Keyboard wedge

    private var keyboardWedgeConfigured: Bool {
        ProviderConfigurationService.shared.getConfiguration().badgeReader.readerType == .keyboardWedge
    }

    /// Make the invisible field first responder so an HID reader's keystrokes
    /// reach the keyboard-wedge provider. Re-armed on appear, on app activation,
    /// and after every alert this screen presents (an alert steals the responder).
    private func armKeyboardWedge() {
        // Deferred one turn: a UIAlertAction handler runs while its alert is still
        // being dismissed, when `presentedViewController` is not yet nil.
        DispatchQueue.main.async { [weak self] in
            guard let self = self,
                  self.keyboardWedgeConfigured,
                  self.view.window != nil,
                  self.presentedViewController == nil else { return }
            if !self.wedgeField.isFirstResponder {
                self.wedgeField.becomeFirstResponder()
            }
        }
    }

    private static func postWedgeKey(keyCode: UInt16, characters: String) {
        NotificationCenter.default.post(
            name: .badgeReaderKeyboardInput,
            object: nil,
            userInfo: ["keyCode": keyCode, "characters": characters]
        )
    }

    // MARK: - Manual login

    /// Manual login without a badge. Two paths, both audited, both re-checked at
    /// the moment of the tap:
    ///  • managed opt-in (`AllowManualOverride`): prompt for the admin code; every
    ///    guess consumes the device-wide auth-attempt budget;
    ///  • local toggle (`KioskConfig.localSessionAllowed`: no managed dictionary,
    ///    `local_session_allowed` ON in iOS Settings, and NO kiosk lock engaged):
    ///    confirm and proceed. Any session this starts is what `BackendService`
    ///    allows — a local, app-less workspace when no backend is configured.
    /// Anything else: the affordance is refused, and the footer says why.
    @objc private func recoveryTapped() {
        guard KioskConfig.allowManualOverride else {
            guard KioskConfig.localSessionAllowed else {
                recoveryButton.isHidden = true
                updateFooter()
                showRecoveryResult("Manual login is not available on this device.", ok: false)
                return
            }
            let alert = UIAlertController(
                title: "Manual login",
                message: "Local sign-in is enabled in iOS Settings for this unmanaged device. Start a session without a badge? This is logged.",
                preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { [weak self] _ in
                self?.armKeyboardWedge()
            })
            alert.addAction(UIAlertAction(title: "Log in", style: .default) { [weak self] _ in
                self?.showRecoveryResult("Local sign-in accepted (unmanaged device, Settings toggle on).", ok: true)
                SessionStateManager.shared.beginManualOverrideLogin()
                self?.armKeyboardWedge()
            })
            present(alert, animated: true)
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
            self?.armKeyboardWedge()
        })
        alert.addAction(UIAlertAction(title: "Log in", style: .default) { [weak self] _ in
            defer { self?.armKeyboardWedge() }
            // Bounded + audited (review finding): every guess consumes the device-wide
            // auth-attempt budget BEFORE the validator runs, and every rejection is
            // recorded. Without this, anyone at the idle shared device could make
            // unlimited local guesses at a short numeric code until the badge-free
            // login gate opened. Exceeding the budget locks the affordance out
            // (SecurityManager audits the rate-limit denial) until the window passes.
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
        present(alert, animated: true)
    }

    private func showRecoveryResult(_ message: String, ok: Bool) {
        errorLabel.text = message
        errorLabel.textColor = ok ? SG.accent : SG.deny
        errorLabel.isHidden = false
    }
    
    private func animateBadgeIcon() {
        UIView.animate(
            withDuration: 1.5,
            delay: 0,
            options: [.repeat, .autoreverse],
            animations: {
                self.badgeIconView.transform = CGAffineTransform(scaleX: 1.1, y: 1.1)
            }
        )
    }
    
    private func stopBadgeIconAnimation() {
        badgeIconView.layer.removeAllAnimations()
        badgeIconView.transform = .identity
    }
}

// MARK: - UITextFieldDelegate (keyboard-wedge sink)

extension LockedIdleViewController: UITextFieldDelegate {
    /// Every character an HID reader types is forwarded to the keyboard-wedge
    /// provider as one `.badgeReaderKeyboardInput` and DISCARDED here (returns
    /// false): the provider owns the buffer and the badge id never sits in a text
    /// field. A newline is the reader's Return.
    func textField(_ textField: UITextField, shouldChangeCharactersIn range: NSRange, replacementString string: String) -> Bool {
        for scalar in string.unicodeScalars {
            if scalar == "\n" || scalar == "\r" {
                Self.postWedgeKey(keyCode: Self.hidEnterKeyCode, characters: "")
            } else {
                Self.postWedgeKey(keyCode: 0, characters: String(scalar))
            }
        }
        return false
    }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        Self.postWedgeKey(keyCode: Self.hidEnterKeyCode, characters: "")
        return false
    }
}
