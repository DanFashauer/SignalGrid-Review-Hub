import UIKit
import LocalAuthentication

/// The invisible embedded flow, native — and vertical-agnostic.
///
/// The product's design law (`EMBEDDED_UX_PRINCIPLE.md`): the worker only ever
/// sees THEIR OWN app, deliberately not SignalGrid-branded. The trust layer runs
/// underneath. Non-sensitive actions run with no friction (`allow` → auto); a
/// sensitive action is HELD until the worker satisfies a native step-up (Face ID /
/// Touch ID) AND confirms in the app's own dialog (`step_up` → `assist` →
/// `applied`); a restricted/denied action is blocked and the app shows ITS OWN
/// message. Decisions come from `AppWorkflows` — the native port of the real
/// `@workspace/app-workflows` planner.
///
/// The behavior is identical across industries — only the app, the subject, and
/// who confirms change. This VC is config-driven so the same gate renders a
/// clinical chart or a warehouse handheld with no branching in the flow logic.
final class HostAppViewController: UIViewController {

    // MARK: - Config

    struct ScriptedStep {
        let key: String
        let label: String
        var hostHold: String = ""      // shown while HELD for a step-up
        var hostDone: String = ""      // shown when the action completes
        var hostBlocked: String = ""   // the app's OWN message on restrict/deny
        var confirmTitle: String = ""  // the app's own confirmation dialog title
    }

    /// The session-scoped verdict, computed once from the LIVE signal + location
    /// context (posture + deployment zone + demo injection) and routed through
    /// `DecisionService` (on-device engine, or the control plane when configured).
    /// The per-action difference (auto vs assist vs blocked) comes from the action's
    /// risk tier via `AppWorkflows`, not from per-step signals.
    private var cachedDecision: DecisionResult?
    /// Monotonic evaluation generation — only the latest may publish its verdict.
    private var evalGeneration = 0
    private func currentDecision() -> DecisionResult {
        cachedDecision ?? DecisionResult(
            outcome: .step_up, reasonCodes: ["DECISION_PENDING"],
            explanation: "Evaluating device trust…", source: .onDevice)
    }
    /// Simulator-only stand-ins for posture that can't be toggled from simctl
    /// (`UIScreen.isCaptured`, token expiry, security lockout), so the live
    /// re-evaluation path can be demonstrated. Always false on device.
    private var simulatedScreenCapture = false
    private var simulatedStale = false
    private var simulatedLockout = false
    /// Fingerprint of the posture inputs used for the last evaluation, so the poll /
    /// notifications only re-evaluate when something actually changed.
    private var postureFingerprint = ""
    private var posturePollTimer: Timer?

    struct HostAppConfig {
        let integration: AppWorkflows.AppIntegration
        let appName: String
        let appInitial: String
        let brandColor: UIColor
        let whoLabel: String
        let subjectTitle: String
        let subjectMeta: String
        let steps: [ScriptedStep]
    }

    private let config: HostAppConfig
    private var confirmer: String { AppWorkflows.confirmer(for: config.integration) }

    init(config: HostAppConfig) {
        self.config = config
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .fullScreen
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    // MARK: - Flow state

    private enum FlowState { case idle, awaitingStepUp, awaitingConfirm, finished }
    private var flow: FlowState = .idle
    private var stepIndex = 0
    /// Whether a REAL native device-owner authentication completed for the action
    /// currently being confirmed. This is the only proof of step-up; the confirm
    /// path must never infer step-up from the re-evaluated outcome, or a posture
    /// escalation that happens while the confirm dialog is open would release the
    /// action with no authentication at all. Reset per action in `primaryTapped`,
    /// set true only in `stepUpSatisfied`.
    private var nativeStepUpCompleted = false
    private var currentStep: ScriptedStep? { stepIndex < config.steps.count ? config.steps[stepIndex] : nil }

    // MARK: - UI

    private let scrollView = UIScrollView()
    private let stack = UIStackView()
    private let rowsStack = UIStackView()
    private let hostBanner = UILabel()
    private let primaryButton = UIButton(type: .system)
    private var topBarBottom: NSLayoutYAxisAnchor!
    private var appBarBottom: NSLayoutYAxisAnchor!

    private var glassVisible = false
    private let glassPanel = UIView()
    private let glassAction = UILabel()
    private let glassVerdict = UILabel()
    private let glassBody = UILabel()
    private let glassWhy = UILabel()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.965, green: 0.973, blue: 0.984, alpha: 1)
        buildTopBar()
        buildAppBar()
        buildBody()
        buildGlassPanel()
        renderStep()
        primaryButton.isEnabled = false   // held until the session verdict resolves
        AuditLogger.shared.log(event: .appLaunched, metadata: [
            "appId": config.integration.id, "mode": "embedded_assist"])
        // Posture is live for the WHOLE session: screen recording (event), session
        // state/freshness and security lockout (notification + a time-based poll) all
        // re-evaluate the gate mid-session. See checkPostureChange.
        NotificationCenter.default.addObserver(
            self, selector: #selector(screenCaptureDidChange),
            name: UIScreen.capturedDidChangeNotification, object: nil)
        NotificationCenter.default.addObserver(
            self, selector: #selector(sessionStateDidChange),
            name: .sessionStateDidChange, object: nil)
        evaluateSessionDecision(isInitial: true)
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        posturePollTimer?.invalidate()
    }

    // MARK: - Live session decision (signals + location → verdict)

    /// Gather the live context, resolve the decision service, evaluate, cache the
    /// verdict. On initial open it releases the UI + starts the demo; on a later
    /// re-evaluation (posture changed mid-session) it reflects the new verdict.
    /// Runs the async decision off the tap path so the synchronous flow is unchanged.
    private func evaluateSessionDecision(isInitial: Bool, reason: String = "session_open") {
        let ctx = buildEnvironmentContext()
        let service = DecisionServiceProvider.resolve(
            backendURL: configuredBackendURL, bearerToken: configuredBackendToken)
        // Version each evaluation (review finding): overlapping remote evaluations
        // each capture a different ctx, and whichever finished LAST used to win —
        // so an older healthy result could overwrite a newer restrictive one and
        // re-open auto actions against the current risk signal. Only the latest
        // generation may publish; superseded results are discarded (audited).
        evalGeneration += 1
        let gen = evalGeneration
        Task { @MainActor in
            let previous = self.cachedDecision?.outcome
            let result = await AccessDecision.evaluate(
                ctx, integration: config.integration,
                identityRef: backendIdentityRef,
                deviceRef: backendDeviceRef,
                via: service)
            guard gen == self.evalGeneration else {
                AuditLogger.shared.log(event: .assistActionEvaluated, metadata: [
                    "scope": "session", "trigger": reason,
                    "outcome": result.outcome.rawValue,
                    "superseded": "true"])
                return
            }
            self.cachedDecision = result
            AuditLogger.shared.log(event: .assistActionEvaluated, metadata: [
                "scope": "session", "trigger": reason,
                "outcome": result.outcome.rawValue,
                "reason": result.reasonCodes.joined(separator: "|"),
                "source": result.source.rawValue])
            if isInitial {
                self.postureFingerprint = self.postureFingerprintNow()
                self.renderStep()
                self.scheduleDemoPostureChangesIfNeeded()
                self.startPosturePoll()
                self.startAutoDemoIfNeeded()
            } else {
                self.applyReevaluation(previous: previous, result: result)
            }
        }
    }

    // MARK: - Live posture change detection

    /// Live posture inputs, from what iOS genuinely exposes (+ simulator stand-ins).
    private func livePosture() -> (screenCaptured: Bool, stale: Bool, lockedOut: Bool) {
        let screenCaptured = UIScreen.main.isCaptured || simulatedScreenCapture
        let stale = (SessionStateManager.shared.currentSession?.isExpired ?? true) || simulatedStale
        let lockedOut = ((SecurityManager.shared.getSecurityStatus()["isLockedOut"] as? Bool) ?? false) || simulatedLockout
        return (screenCaptured, stale, lockedOut)
    }

    private func postureFingerprintNow() -> String {
        let p = livePosture()
        return "\(p.screenCaptured)|\(p.stale)|\(p.lockedOut)"
    }

    /// The single, deduped entry point: re-evaluate the gate ONLY when a posture
    /// input actually changed since the last evaluation. Fed by the screen-capture
    /// event, the session-state notification, and the time-based poll.
    private func checkPostureChange(reason: String) {
        let fp = postureFingerprintNow()
        guard fp != postureFingerprint else { return }
        postureFingerprint = fp
        evaluateSessionDecision(isInitial: false, reason: reason)
    }

    /// `UIScreen.isCaptured` flipped (real recording/mirroring) or the sim stand-in fired.
    @objc private func screenCaptureDidChange() { checkPostureChange(reason: "screen_capture_changed") }

    /// The session state/freshness changed (token refresh, activity, expiry-driven transition).
    @objc private func sessionStateDidChange() { checkPostureChange(reason: "session_state_changed") }

    /// Freshness (token expiry) and lockout are time-based with no event, so poll for
    /// them; the fingerprint gate makes this a no-op until something actually changes.
    private func startPosturePoll() {
        posturePollTimer?.invalidate()
        posturePollTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
            self?.checkPostureChange(reason: "posture_poll")
        }
    }

    /// Reflect a mid-session verdict change in the host app's OWN UI (SignalGrid
    /// never appears). Subsequent actions already read the refreshed verdict via
    /// `currentDecision()`, so this only surfaces the change and refreshes controls.
    private func applyReevaluation(previous: AppWorkflows.DecisionOutcome?, result: DecisionResult) {
        guard previous != result.outcome else { return }
        let why = result.reasonCodes.joined(separator: " · ")
        let tightened = result.outcome != .allow
        setGlass("session", result.outcome.rawValue, why,
                 tightened
                 ? "Posture changed mid-session → the gate tightened live. Actions are re-evaluated against the new verdict."
                 : "Posture recovered mid-session → the gate re-opened. Trusted actions run again.")
        showBanner(postureBanner(tightened: tightened, reasons: result.reasonCodes),
                   kind: tightened ? .blocked : .ok)
        if flow == .idle { renderStep() }
    }

    /// The host app's OWN message for a posture change, derived from the reason codes
    /// (never mentions SignalGrid).
    private func postureBanner(tightened: Bool, reasons: [String]) -> String {
        guard tightened else { return "Device posture recovered — access restored." }
        if reasons.contains("POSTURE_STALE") || reasons.contains("STATE_FRESHNESS_FAILURE") {
            return "Device check-in is stale — some actions now require re-verification."
        }
        if reasons.contains("SECURITY_RISK_ESCALATION") { return "Security risk detected — some actions are now unavailable." }
        if reasons.contains("DEVICE_NON_COMPLIANT") { return "Device is out of compliance — some actions are now unavailable." }
        if reasons.contains("ZONE_MISMATCH") || reasons.contains("ZONE_UNKNOWN") { return "Device is outside its authorized zone — access denied." }
        return "Device posture changed — some actions are now unavailable."
    }

    /// Simulator-only: flip a posture stand-in after a delay so each live
    /// re-evaluation trigger can be captured in a screenshot walk
    /// (`-DemoScreenCaptureAfter` / `-DemoStaleAfter` / `-DemoLockoutAfter`).
    private func scheduleDemoPostureChangesIfNeeded() {
        #if targetEnvironment(simulator)
        scheduleDemoFlip(DemoMode.screenCaptureAfter, reason: "screen_capture_changed") { $0.simulatedScreenCapture = true }
        scheduleDemoFlip(DemoMode.staleAfter, reason: "session_stale") { $0.simulatedStale = true }
        scheduleDemoFlip(DemoMode.lockoutAfter, reason: "lockout_engaged") { $0.simulatedLockout = true }
        #endif
    }

    #if targetEnvironment(simulator)
    private func scheduleDemoFlip(_ after: TimeInterval?, reason: String, _ flip: @escaping (HostAppViewController) -> Void) {
        guard let after = after, after > 0 else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + after) { [weak self] in
            guard let self = self else { return }
            flip(self)
            self.checkPostureChange(reason: reason)
        }
    }
    #endif

    /// Build the live context from the posture iOS genuinely exposes, the deployment
    /// zone, and (simulator-only) demo injection for conditions iOS can't sense.
    private func buildEnvironmentContext() -> SignalContext.EnvironmentContext {
        let authenticated = SessionStateManager.shared.currentSession != nil
        let posture = livePosture()

        // Fail-closed on location: with NO trusted location source wired on a real
        // device, the detected zone is UNKNOWN (nil), so LocationGate denies rather
        // than granting on a fabricated match. Hard-coding detected == expected here
        // would erase the zone restriction for every physical deployment (an
        // unknown/mismatched-zone deny that never fires). Production must derive the
        // detected zone from a trusted source (geofence / MDM-provisioned deployment
        // metadata); until then, unknown → deny is the honest posture.
        var expectedZone = "default"
        var detectedZone: String? = nil
        var injected: Set<String> = []
        // Fail-closed on posture too: with no real device-compliance/management source
        // wired on a physical device, posture is NOT positively observed, so the engine
        // must not be told `device.posture_observed` (which is its base allow evidence).
        var postureObserved = false
        #if targetEnvironment(simulator)
        // Simulator-only: DemoMode injects the zones AND the compliance/management
        // posture iOS cannot sense, so the demo can exercise match / mismatch / unknown
        // deterministically — and posture IS positively sourced (from the demo).
        expectedZone = DemoMode.location
        detectedZone = DemoMode.zone ?? DemoMode.location
        injected = DemoMode.injectedSignals
        postureObserved = true
        #endif

        return SignalContext.EnvironmentContext(
            authenticated: authenticated,
            expectedZone: expectedZone,
            detectedZone: detectedZone,
            screenCaptured: posture.screenCaptured,
            sessionStale: posture.stale,
            lockedOut: posture.lockedOut,
            injected: injected,
            postureObserved: postureObserved)
    }

    private var configuredBackendURL: URL? {
        #if targetEnvironment(simulator)
        return DemoMode.backendURL
        #else
        return nil
        #endif
    }

    private var configuredBackendToken: String? {
        #if targetEnvironment(simulator)
        return DemoMode.backendToken
        #else
        return nil
        #endif
    }

    /// Refs sent to the control plane. Real refs come from the session/device; a demo
    /// may override with tenant-seeded refs so a real control-plane verdict is returned.
    private var backendIdentityRef: String {
        #if targetEnvironment(simulator)
        if let id = DemoMode.backendIdentity, !id.isEmpty { return id }
        #endif
        return SessionStateManager.shared.currentSession?.userId ?? "operator"
    }
    private var backendDeviceRef: String {
        #if targetEnvironment(simulator)
        if let d = DemoMode.backendDevice, !d.isEmpty { return d }
        #endif
        return DeviceInfo.identifier
    }

    // MARK: - Top bar (kiosk containment, matches ManagedAppViewController)

    private func buildTopBar() {
        let bar = UIView()
        bar.backgroundColor = .secondarySystemBackground
        bar.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(bar)

        let title = UILabel()
        title.text = config.appName
        title.font = SG.sans(17, .semibold)
        title.adjustsFontForContentSizeCategory = true
        title.translatesAutoresizingMaskIntoConstraints = false

        let done = UIButton(type: .system)
        done.setTitle("Done", for: .normal)
        done.titleLabel?.font = SG.sans(17, .semibold)
        done.titleLabel?.adjustsFontForContentSizeCategory = true
        done.addTarget(self, action: #selector(close), for: .touchUpInside)
        done.translatesAutoresizingMaskIntoConstraints = false

        bar.addSubview(title); bar.addSubview(done)
        NSLayoutConstraint.activate([
            bar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            bar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            bar.heightAnchor.constraint(equalToConstant: 48),
            title.centerXAnchor.constraint(equalTo: bar.centerXAnchor),
            title.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
            done.trailingAnchor.constraint(equalTo: bar.trailingAnchor, constant: -16),
            done.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
        ])

        // The "behind the glass" operator instrumentation is a SIMULATOR-ONLY demo
        // affordance. On a real device the worker must never see SignalGrid — the
        // reveal toggle is compiled out entirely (the panel is unreachable), so it
        // cannot be used to break the invisible-gate containment.
        #if targetEnvironment(simulator)
        let eye = UIButton(type: .system)
        eye.setImage(UIImage(systemName: "eye"), for: .normal)
        eye.addTarget(self, action: #selector(toggleGlass), for: .touchUpInside)
        eye.translatesAutoresizingMaskIntoConstraints = false
        bar.addSubview(eye)
        NSLayoutConstraint.activate([
            eye.leadingAnchor.constraint(equalTo: bar.leadingAnchor, constant: 16),
            eye.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
        ])
        #endif

        topBarBottom = bar.bottomAnchor
    }

    private func buildAppBar() {
        let appBar = UIView()
        appBar.backgroundColor = config.brandColor
        appBar.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(appBar)

        let logo = UILabel()
        logo.text = config.appInitial
        logo.textColor = .white
        logo.font = SG.sans(15, .heavy)
        logo.adjustsFontForContentSizeCategory = true
        logo.textAlignment = .center
        logo.backgroundColor = UIColor.white.withAlphaComponent(0.22)
        logo.layer.cornerRadius = 6
        logo.clipsToBounds = true
        logo.translatesAutoresizingMaskIntoConstraints = false

        let name = UILabel()
        name.text = config.appName
        name.textColor = .white
        name.font = SG.sans(16, .bold)
        name.adjustsFontForContentSizeCategory = true
        name.translatesAutoresizingMaskIntoConstraints = false

        let who = UILabel()
        who.text = config.whoLabel
        who.textColor = UIColor.white.withAlphaComponent(0.85)
        who.font = SG.sans(12, .regular)
        who.adjustsFontForContentSizeCategory = true
        who.translatesAutoresizingMaskIntoConstraints = false

        appBar.addSubview(logo); appBar.addSubview(name); appBar.addSubview(who)
        NSLayoutConstraint.activate([
            appBar.topAnchor.constraint(equalTo: topBarBottom),
            appBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            appBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            appBar.heightAnchor.constraint(equalToConstant: 52),
            logo.leadingAnchor.constraint(equalTo: appBar.leadingAnchor, constant: 16),
            logo.centerYAnchor.constraint(equalTo: appBar.centerYAnchor),
            logo.widthAnchor.constraint(equalToConstant: 28),
            logo.heightAnchor.constraint(equalToConstant: 28),
            name.leadingAnchor.constraint(equalTo: logo.trailingAnchor, constant: 10),
            name.centerYAnchor.constraint(equalTo: appBar.centerYAnchor),
            who.trailingAnchor.constraint(equalTo: appBar.trailingAnchor, constant: -16),
            who.centerYAnchor.constraint(equalTo: appBar.centerYAnchor),
        ])
        appBarBottom = appBar.bottomAnchor
    }

    private func buildBody() {
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scrollView)
        stack.axis = .vertical
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        scrollView.addSubview(stack)

        NSLayoutConstraint.activate([
            scrollView.topAnchor.constraint(equalTo: appBarBottom),
            scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scrollView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            stack.topAnchor.constraint(equalTo: scrollView.topAnchor, constant: 16),
            stack.leadingAnchor.constraint(equalTo: scrollView.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: scrollView.trailingAnchor, constant: -16),
            stack.bottomAnchor.constraint(equalTo: scrollView.bottomAnchor, constant: -24),
            stack.widthAnchor.constraint(equalTo: scrollView.widthAnchor, constant: -32),
        ])

        // Subject card (synthetic — patient / order / asset, no PII).
        let card = cardView()
        let subjTitle = UILabel()
        subjTitle.text = config.subjectTitle
        subjTitle.font = SG.sans(17, .bold)
        subjTitle.adjustsFontForContentSizeCategory = true
        let subjMeta = UILabel()
        subjMeta.text = config.subjectMeta
        subjMeta.font = SG.sans(12)
        subjMeta.adjustsFontForContentSizeCategory = true
        subjMeta.textColor = .secondaryLabel
        subjMeta.numberOfLines = 0
        let cardStack = UIStackView(arrangedSubviews: [subjTitle, subjMeta])
        cardStack.axis = .vertical
        cardStack.spacing = 2
        cardStack.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(cardStack)
        NSLayoutConstraint.activate([
            cardStack.topAnchor.constraint(equalTo: card.topAnchor, constant: 12),
            cardStack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 14),
            cardStack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -14),
            cardStack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -12),
        ])
        stack.addArrangedSubview(card)

        rowsStack.axis = .vertical
        rowsStack.spacing = 8
        stack.addArrangedSubview(rowsStack)

        hostBanner.numberOfLines = 0
        hostBanner.font = SG.sans(13, .medium)
        hostBanner.adjustsFontForContentSizeCategory = true
        hostBanner.layer.cornerRadius = 10
        hostBanner.clipsToBounds = true
        hostBanner.isHidden = true
        stack.addArrangedSubview(hostBanner)

        primaryButton.backgroundColor = config.brandColor
        primaryButton.setTitleColor(.white, for: .normal)
        primaryButton.titleLabel?.font = SG.sans(15, .bold)
        primaryButton.titleLabel?.adjustsFontForContentSizeCategory = true
        primaryButton.layer.cornerRadius = 10
        primaryButton.addTarget(self, action: #selector(primaryTapped), for: .touchUpInside)
        primaryButton.heightAnchor.constraint(equalToConstant: 48).isActive = true
        stack.addArrangedSubview(primaryButton)
    }

    private func cardView() -> UIView {
        let v = UIView()
        v.backgroundColor = .systemBackground
        v.layer.cornerRadius = 12
        v.layer.borderWidth = 1
        v.layer.borderColor = UIColor.separator.withAlphaComponent(0.4).cgColor
        v.translatesAutoresizingMaskIntoConstraints = false
        return v
    }

    // MARK: - Flow (disposition-driven; identical across verticals)

    @objc private func primaryTapped() {
        SessionStateManager.shared.userDidInteract()
        guard let step = currentStep else { return }
        nativeStepUpCompleted = false                     // fresh action attempt — no step-up yet
        let d = currentDecision()                         // session verdict (signals + location)
        let why = d.reasonCodes.joined(separator: " · ")
        let input = AppWorkflows.AppPlanInput(
            integration: config.integration, outcome: d.outcome, reasonCodes: d.reasonCodes)
        let plan = AppWorkflows.gateAppAction(input, step.key)
        AuditLogger.shared.log(event: .assistActionEvaluated, metadata: [
            "action": step.key, "outcome": d.outcome.rawValue,
            "disposition": plan?.disposition.rawValue ?? "?"])

        switch plan?.disposition {
        case .auto:
            setGlass(step.key, "auto", why,
                     "Non-sensitive action on a trusted session → runs automatically. The worker sees no gate.")
            AuditLogger.shared.log(event: .assistActionAuto, metadata: ["action": step.key])
            addRow(step.label, state: .done)
            showBanner(step.hostDone, kind: .ok)
            advance()
        case .blocked:
            let verdict = d.outcome.rawValue // restrict / deny
            setGlass(step.key, verdict, why,
                     "Blocked — the action isn't available on this device in this context. The app shows its OWN message; SignalGrid never appears. Fail-closed: nothing fires.")
            AuditLogger.shared.log(event: .assistActionBlocked, metadata: [
                "action": step.key, "outcome": verdict])
            addRow(step.label, state: .blocked)
            showBanner(step.hostBlocked.isEmpty
                       ? "\(config.appName): not available on this device in this location."
                       : step.hostBlocked, kind: .blocked)
            advance()
        case .step_up:
            setGlass(step.key, "step_up", why,
                     "High-assurance action → HELD. SignalGrid does not release it; it asks the app to capture a real native gesture. It does not fire yet.")
            AuditLogger.shared.log(event: .assistStepUpRequested, metadata: [
                "action": step.key, "reason": why])
            addRow(step.label, state: .held)
            showBanner(step.hostHold, kind: .hold)
            flow = .awaitingStepUp
            primaryButton.isEnabled = false
            #if targetEnvironment(simulator)
            if DemoMode.assistAuto { return }
            #endif
            requestNativeStepUp(step)
        case .assist:
            // allow + sensitive, no step-up needed → straight to the app's own confirm.
            setGlass(step.key, "assist", "SENSITIVE · AWAITING_CONFIRMATION",
                     "Sensitive action prepared — but it requires an explicit \(confirmer) confirmation in the app. Not fired yet.")
            addRow(step.label, state: .held)
            flow = .awaitingConfirm
            primaryButton.isEnabled = false
            presentConfirm(step)
        default:
            break
        }
    }

    private func advance() {
        stepIndex += 1
        flow = .idle
        renderStep()
    }

    /// Trigger the device's OWN authenticator. Falls back to a clearly-labeled
    /// simulated authenticator when biometrics aren't available.
    private func requestNativeStepUp(_ step: ScriptedStep) {
        let context = LAContext()
        var authError: NSError?
        let reason = "Verify it's you before this action on a shared device."
        if context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &authError) {
            context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { [weak self] ok, _ in
                DispatchQueue.main.async {
                    if ok { self?.stepUpSatisfied(step) } else { self?.stepUpDeclined(step) }
                }
            }
        } else {
            // Device-owner authentication is UNAVAILABLE (no passcode/biometrics
            // configured, or LA refused). What happens next differs by build:
            #if targetEnvironment(simulator)
            // Simulator demo: the simulator has no real authenticator, so a clearly
            // labeled simulated one keeps the demo walkable. Simulator-only by
            // compilation — this alert can never appear on hardware.
            let sheet = UIAlertController(
                title: "Confirm it's you",
                message: "Demo · simulated authenticator\n\n\(config.appName) needs to verify this action on a shared device. No real biometric is used.",
                preferredStyle: .alert)
            sheet.addAction(UIAlertAction(title: "Cancel", style: .cancel) { [weak self] _ in self?.stepUpDeclined(step) })
            sheet.addAction(UIAlertAction(title: "Simulate Face ID", style: .default) { [weak self] _ in self?.stepUpSatisfied(step) })
            present(sheet, animated: true)
            #else
            // Physical device (review finding): a freely tappable simulated gesture
            // here would release gated actions with NO identity check the moment a
            // device lacks a passcode. Fail closed: the step-up is treated as failed,
            // the action stays held, and the holder is told why.
            AuditLogger.shared.log(event: .assistStepUpFailed,
                                   metadata: ["action": step.key, "reason": "device_owner_authentication_unavailable"])
            let sheet = UIAlertController(
                title: "Authentication unavailable",
                message: "This device has no passcode or biometric configured, so identity cannot be verified. The action stays held — set a device passcode and try again.",
                preferredStyle: .alert)
            sheet.addAction(UIAlertAction(title: "OK", style: .default) { [weak self] _ in self?.stepUpDeclined(step) })
            present(sheet, animated: true)
            #endif
        }
    }

    /// Step-up satisfied → the action is NOT placed yet if it is sensitive; it stays
    /// ASSIST until an explicit confirmation (mirrors completeAppStepUp).
    private func stepUpSatisfied(_ step: ScriptedStep) {
        let d = currentDecision()
        var input = AppWorkflows.AppPlanInput(
            integration: config.integration, outcome: d.outcome, reasonCodes: d.reasonCodes)
        let plan = AppWorkflows.completeAppStepUp(input)
        let action = plan.actions.first { $0.key == step.key }
        // A REAL device-owner authentication completed (LAContext, or the labeled
        // simulated authenticator in the demo). This is the only place the flag is
        // set true, so a later confirmation can trust it as genuine step-up proof.
        nativeStepUpCompleted = true
        AuditLogger.shared.log(event: .assistStepUpSatisfied, metadata: ["action": step.key])

        if action?.disposition == .assist {
            setGlass(step.key, "assist", "STEP_UP_SATISFIED · AWAITING_CONFIRMATION",
                     "Step-up satisfied — but a critical action still requires an explicit confirmation in the app. SignalGrid holds it as ASSIST; the biometric alone does not fire it.")
            showBanner("Identity confirmed. Now confirm to proceed.", kind: .hold)
            AuditLogger.shared.log(event: .assistActionAwaitingConfirmation, metadata: ["action": step.key])
            flow = .awaitingConfirm
            presentConfirm(step)
        } else if action?.disposition == .applied || action?.disposition == .auto {
            // Gated-but-not-sensitive → released after the step-up.
            input.stepUpSatisfied = true
            setGlass(step.key, "applied", "RELEASED_AFTER_STEP_UP",
                     "Step-up satisfied and the action is not sensitive → released. One gate cleared.")
            markHeldRowDone()
            showBanner(step.hostDone, kind: .ok)
            AuditLogger.shared.log(event: .assistActionApplied, metadata: ["action": step.key])
            advance()
        } else {
            // Posture tightened to restrict/deny while the identity prompt was open,
            // so the freshly re-evaluated disposition is `blocked` (or still
            // `step_up`). Fail-closed: a satisfied step-up can NEVER release a
            // now-blocked action — it is not applied.
            setGlass(step.key, action?.disposition.rawValue ?? "blocked", "BLOCKED_AFTER_REEVALUATION",
                     "Access changed while verifying identity — posture degraded past step-up, so the action is blocked. Fail-closed: the gesture releases nothing.")
            AuditLogger.shared.log(event: .assistActionBlocked, metadata: ["action": step.key, "reason": "posture_tightened_after_step_up"])
            showBanner("Blocked — access changed. The action does not fire.", kind: .hold)
            flow = .idle
            primaryButton.isEnabled = true
        }
    }

    private func stepUpDeclined(_ step: ScriptedStep) {
        setGlass(step.key, "step_up", "STEP_UP_NOT_SATISFIED",
                 "The worker declined the check, so the held action never fires. Fail-closed: no gesture, no release.")
        AuditLogger.shared.log(event: .assistStepUpFailed, metadata: ["action": step.key])
        showBanner("Cancelled. The action stays held — nothing fired.", kind: .hold)
        flow = .idle
        primaryButton.isEnabled = true
    }

    private func presentConfirm(_ step: ScriptedStep) {
        let confirm = UIAlertController(
            title: step.confirmTitle.isEmpty ? "Verify \(step.label)" : step.confirmTitle,
            message: "\(config.subjectTitle)\nThis is the app's own confirmation, not a SignalGrid screen.",
            preferredStyle: .alert)
        confirm.addAction(UIAlertAction(title: "Cancel", style: .cancel) { [weak self] _ in self?.confirmDeclined(step) })
        confirm.addAction(UIAlertAction(title: "Confirm", style: .default) { [weak self] _ in self?.confirmAction(step) })
        present(confirm, animated: true)
    }

    private func confirmAction(_ step: ScriptedStep) {
        let d = currentDecision()
        var input = AppWorkflows.AppPlanInput(
            integration: config.integration, outcome: d.outcome, reasonCodes: d.reasonCodes)
        // Step-up is satisfied ONLY if a real native authentication actually ran —
        // never inferred from the current outcome. Otherwise a posture escalation
        // (allow → step_up) that lands while this confirm dialog is open would be
        // mistaken for a successful step-up and release the action with no
        // authentication at all.
        input.stepUpSatisfied = nativeStepUpCompleted
        let plan = AppWorkflows.confirmAppActions(input, [step.key])
        let action = plan.actions.first { $0.key == step.key }
        AuditLogger.shared.log(event: .assistActionConfirmed, metadata: ["action": step.key])

        // Escalation at confirm time: the action now REQUIRES a step-up that hasn't
        // happened. Launch the real native step-up rather than applying or dead-ending
        // — the confirmation resumes via stepUpSatisfied → presentConfirm once a
        // genuine gesture completes.
        if action?.disposition == .step_up && !nativeStepUpCompleted {
            setGlass(step.key, "step_up", "STEP_UP_REQUIRED_AT_CONFIRM",
                     "Access tightened to require identity verification before this action. Launching a native step-up; nothing fires until it completes.")
            AuditLogger.shared.log(event: .assistStepUpRequested, metadata: ["action": step.key, "reason": "escalated_at_confirm"])
            flow = .awaitingStepUp
            requestNativeStepUp(step)
            return
        }

        // Fail-closed on a hard tighten (restrict/deny → blocked): a confirmation does
        // NOT release a now-blocked action.
        guard action?.disposition == .applied || action?.disposition == .auto else {
            setGlass(step.key, action?.disposition.rawValue ?? "blocked", "BLOCKED_AFTER_REEVALUATION",
                     "Access changed before confirmation — posture degraded, so the action is blocked. Fail-closed: the confirmation releases nothing.")
            AuditLogger.shared.log(event: .assistActionBlocked, metadata: ["action": step.key, "reason": "posture_tightened_after_confirm"])
            showBanner("Blocked — access changed. The action does not fire.", kind: .hold)
            flow = .idle
            primaryButton.isEnabled = true
            return
        }
        AuditLogger.shared.log(event: .assistActionApplied, metadata: ["action": step.key])
        let gatesCleared = nativeStepUpCompleted
            ? "Two gates cleared: a native step-up AND an explicit confirmation."
            : "One gate cleared: an explicit confirmation."
        setGlass(step.key, action?.disposition.rawValue ?? "applied",
                 "CONFIRMED_BY_\(confirmer.uppercased().replacingOccurrences(of: " ", with: "_"))",
                 "The \(confirmer) confirmed in the app's own dialog → the held action is applied. \(gatesCleared)")
        markHeldRowDone()
        showBanner(step.hostDone, kind: .ok)
        advance()
    }

    private func confirmDeclined(_ step: ScriptedStep) {
        setGlass(step.key, "assist", "CONFIRMATION_DECLINED",
                 "No explicit confirmation means the action does not fire — even with a satisfied step-up. Fail-closed.")
        AuditLogger.shared.log(event: .assistActionBlocked, metadata: ["action": step.key, "reason": "confirmation_declined"])
        showBanner("Confirmation cancelled. Nothing fired.", kind: .hold)
        flow = .idle
        primaryButton.isEnabled = true
    }

    // MARK: - Rendering

    private func renderStep() {
        if currentStep == nil {
            flow = .finished
            primaryButton.setTitle("All done ✓", for: .normal)
            primaryButton.isEnabled = false
            primaryButton.backgroundColor = .systemGray3
            return
        }
        primaryButton.isEnabled = true
        primaryButton.setTitle(currentStep?.label, for: .normal)
    }

    private enum RowState { case done, held, blocked }

    private func addRow(_ label: String, state: RowState) {
        let row = UIView()
        row.tag = state == .held ? 99 : 0
        row.backgroundColor = .systemBackground
        row.layer.cornerRadius = 10
        row.layer.borderWidth = 1
        row.layer.borderColor = UIColor.separator.withAlphaComponent(0.4).cgColor
        row.translatesAutoresizingMaskIntoConstraints = false
        row.heightAnchor.constraint(equalToConstant: 40).isActive = true

        let lbl = UILabel()
        lbl.text = label
        lbl.font = SG.sans(13, .semibold)
        lbl.adjustsFontForContentSizeCategory = true
        lbl.translatesAutoresizingMaskIntoConstraints = false

        let status = UILabel()
        status.tag = 1
        status.font = SG.sans(11, .heavy)
        status.adjustsFontForContentSizeCategory = true
        status.translatesAutoresizingMaskIntoConstraints = false
        switch state {
        case .done:    status.text = "DONE";    status.textColor = .systemGreen
        case .held:    status.text = "HELD";    status.textColor = .systemOrange
        case .blocked: status.text = "BLOCKED"; status.textColor = .systemRed
        }

        row.addSubview(lbl); row.addSubview(status)
        NSLayoutConstraint.activate([
            lbl.leadingAnchor.constraint(equalTo: row.leadingAnchor, constant: 12),
            lbl.centerYAnchor.constraint(equalTo: row.centerYAnchor),
            status.trailingAnchor.constraint(equalTo: row.trailingAnchor, constant: -12),
            status.centerYAnchor.constraint(equalTo: row.centerYAnchor),
        ])
        rowsStack.addArrangedSubview(row)
    }

    private func markHeldRowDone() {
        guard let row = rowsStack.arrangedSubviews.first(where: { $0.tag == 99 }) else { return }
        row.tag = 0
        if let status = row.viewWithTag(1) as? UILabel {
            status.text = "DONE"; status.textColor = .systemGreen
        }
    }

    private enum BannerKind { case ok, hold, blocked }

    private func showBanner(_ text: String, kind: BannerKind) {
        hostBanner.isHidden = text.isEmpty
        hostBanner.text = "  " + text
        switch kind {
        case .ok:
            hostBanner.backgroundColor = UIColor.systemGreen.withAlphaComponent(0.12)
            hostBanner.textColor = UIColor(red: 0.086, green: 0.396, blue: 0.204, alpha: 1)
        case .hold:
            hostBanner.backgroundColor = UIColor.systemOrange.withAlphaComponent(0.14)
            hostBanner.textColor = UIColor(red: 0.6, green: 0.204, blue: 0.07, alpha: 1)
        case .blocked:
            hostBanner.backgroundColor = UIColor.systemRed.withAlphaComponent(0.12)
            hostBanner.textColor = UIColor(red: 0.6, green: 0.15, blue: 0.15, alpha: 1)
        }
    }

    // MARK: - Behind the glass (operator-only)

    private func buildGlassPanel() {
        glassPanel.backgroundColor = SG.card
        glassPanel.layer.cornerRadius = 14
        glassPanel.translatesAutoresizingMaskIntoConstraints = false
        glassPanel.isHidden = true
        view.addSubview(glassPanel)

        let heading = UILabel()
        heading.text = "BEHIND THE GLASS · operator view · the worker never sees this"
        heading.font = SG.mono(9, .semibold)
        heading.adjustsFontForContentSizeCategory = true
        heading.textColor = SG.accent
        heading.numberOfLines = 0

        glassAction.font = SG.mono(12, .medium)
        glassAction.adjustsFontForContentSizeCategory = true
        glassAction.textColor = .white
        glassVerdict.font = SG.mono(15, .bold)
        glassVerdict.adjustsFontForContentSizeCategory = true
        glassBody.font = SG.sans(12)
        glassBody.adjustsFontForContentSizeCategory = true
        glassBody.textColor = SG.mutedFg
        glassBody.numberOfLines = 0
        glassWhy.font = SG.mono(10, .regular)
        glassWhy.adjustsFontForContentSizeCategory = true
        glassWhy.textColor = SG.mutedFg.withAlphaComponent(0.7)
        glassWhy.numberOfLines = 0

        let s = UIStackView(arrangedSubviews: [heading, glassAction, glassVerdict, glassBody, glassWhy])
        s.axis = .vertical
        s.spacing = 7
        s.translatesAutoresizingMaskIntoConstraints = false
        glassPanel.addSubview(s)
        NSLayoutConstraint.activate([
            glassPanel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 12),
            glassPanel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -12),
            glassPanel.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -12),
            s.topAnchor.constraint(equalTo: glassPanel.topAnchor, constant: 14),
            s.leadingAnchor.constraint(equalTo: glassPanel.leadingAnchor, constant: 14),
            s.trailingAnchor.constraint(equalTo: glassPanel.trailingAnchor, constant: -14),
            s.bottomAnchor.constraint(equalTo: glassPanel.bottomAnchor, constant: -14),
        ])
    }

    #if targetEnvironment(simulator)
    @objc private func toggleGlass() {
        glassVisible.toggle()
        glassPanel.isHidden = !glassVisible
    }
    #endif

    private func setGlass(_ action: String, _ verdict: String, _ why: String, _ body: String) {
        glassAction.text = "action · \(action)"
        glassVerdict.text = verdict.uppercased()
        glassVerdict.textColor = verdictColor(verdict)
        glassBody.text = body
        glassWhy.text = "reason · \(why)\nsource · \(decisionSource.rawValue)"
    }

    /// Which decision service actually produced the session verdict — reported by the
    /// resolved `DecisionResult` (on-device engine, or control plane when a backend is
    /// configured, with on-device fallback).
    private var decisionSource: DecisionSource {
        cachedDecision?.source ?? .onDevice
    }

    private func verdictColor(_ v: String) -> UIColor { SG.decisionColor(v) }

    // MARK: - Auto-walk (simulator screenshot driver)

    #if targetEnvironment(simulator)
    private func startAutoDemoIfNeeded() {
        guard DemoMode.assistAuto else { return }
        glassVisible = true
        glassPanel.isHidden = false
        scheduleAutoTick(after: 1.2)
    }

    private func scheduleAutoTick(after: TimeInterval) {
        DispatchQueue.main.asyncAfter(deadline: .now() + after) { [weak self] in self?.autoTick() }
    }

    private func autoTick() {
        switch flow {
        case .idle:
            guard currentStep != nil else { return }
            primaryTapped()
            scheduleAutoTick(after: 2.4)
        case .awaitingStepUp:
            guard let step = currentStep else { return }
            stepUpSatisfied(step)
            scheduleAutoTick(after: 2.4)
        case .awaitingConfirm:
            guard let step = currentStep else { return }
            if DemoMode.assistDecline {
                // Fail-closed demo: decline the confirmation → nothing fires.
                dismiss(animated: false) { [weak self] in self?.confirmDeclined(step) }
                return // stop the walk on the declined state
            }
            dismiss(animated: false) { [weak self] in self?.confirmAction(step) }
            scheduleAutoTick(after: 2.4)
        case .finished:
            return
        }
    }
    #else
    private func startAutoDemoIfNeeded() {}
    #endif

    // MARK: - Close

    @objc private func close() {
        SessionStateManager.shared.userDidInteract()
        dismiss(animated: true)
    }
}

// MARK: - Vertical configs (same gate, different app / subject / confirmer)

extension HostAppViewController {

    static func forLocation(_ location: String) -> HostAppConfig {
        switch location {
        case "warehouse": return warehouse()
        case "government", "gov", "public_sector": return government()
        case "industrial": return industrial()
        case "global_fleet", "fleet", "logistics": return globalFleet()
        case "retail": return retail()
        case "data_center", "datacenter", "noc": return dataCenter()
        default: return clinical()
        }
    }

    /// Healthcare — a generic clinical chart (mirrors embedded-host-app-demo.html).
    static func clinical() -> HostAppConfig {
        HostAppConfig(
            integration: AppWorkflows.emrChart,
            appName: "Wardlink Chart",
            appInitial: "W",
            brandColor: UIColor(red: 0.043, green: 0.388, blue: 0.808, alpha: 1), // #0B63CE
            whoLabel: "RN · Shared iPad",
            subjectTitle: "Rivera, A.",
            subjectMeta: "Room 4B · MRN 00-DEMO · synthetic record",
            // Verdicts come from the LIVE session context (posture + zone + injection),
            // not per-step signals; each action's disposition follows its risk tier.
            steps: [
                ScriptedStep(key: "chart.open", label: "Open chart", hostDone: "Chart opened."),
                ScriptedStep(key: "results.view", label: "View lab results", hostDone: "Results shown."),
                ScriptedStep(key: "order.place", label: "Place controlled med order",
                             hostHold: "One quick check to confirm it's you on this shared device.",
                             hostDone: "Controlled med order placed.",
                             confirmTitle: "Verify controlled medication order"),
            ])
    }

    /// Warehouse — a generic handheld execution app. Shows the SAME gate with a
    /// different confirmer (supervisor) plus a restrict→BLOCKED branch.
    static func warehouse() -> HostAppConfig {
        HostAppConfig(
            integration: AppWorkflows.wms,
            appName: "StockPilot WES",
            appInitial: "S",
            brandColor: UIColor(red: 0.761, green: 0.255, blue: 0.047, alpha: 1), // #C2410C
            whoLabel: "Picker · Shared handheld",
            subjectTitle: "Order SO-4471 · Aisle 12",
            subjectMeta: "Tote T-88 · synthetic order",
            steps: [
                ScriptedStep(key: "task.accept", label: "Accept pick task", hostDone: "Task accepted."),
                ScriptedStep(key: "pick.confirm", label: "Confirm pick", hostDone: "Pick confirmed."),
                ScriptedStep(key: "inventory.adjust", label: "Adjust inventory",
                             hostBlocked: "Inventory adjust isn't available on this device right now."),
                ScriptedStep(key: "highvalue.release", label: "Release high-value pick",
                             hostHold: "Quick check to confirm it's you before releasing a high-value pick.",
                             hostDone: "High-value pick released.",
                             confirmTitle: "Verify high-value pick release"),
            ])
    }

    /// Government / public sector — a benefits/case-management app. Same gate; the
    /// confirmer is the authorizing officer; eligibility/payment are sensitive.
    static func government() -> HostAppConfig {
        HostAppConfig(
            integration: AppWorkflows.caseManagement,
            appName: "StateCase",
            appInitial: "G",
            brandColor: UIColor(red: 0.101, green: 0.357, blue: 0.290, alpha: 1), // gov green #1A5B4A
            whoLabel: "Case officer · Shared workstation",
            subjectTitle: "Case #NW-2207 · Rivera, A.",
            subjectMeta: "Program: benefits · synthetic record",
            steps: [
                ScriptedStep(key: "case.open", label: "Open case", hostDone: "Case opened."),
                ScriptedStep(key: "record.view", label: "View eligibility record", hostDone: "Record shown."),
                ScriptedStep(key: "eligibility.adjudicate", label: "Adjudicate eligibility",
                             hostHold: "Confirm it's you before adjudicating eligibility on this shared device.",
                             hostDone: "Eligibility adjudicated.",
                             confirmTitle: "Verify eligibility adjudication"),
                ScriptedStep(key: "payment.release", label: "Release benefit payment",
                             hostHold: "Confirm before releasing a benefit payment.",
                             hostDone: "Benefit payment released.",
                             confirmTitle: "Verify benefit payment release"),
            ])
    }

    /// Industrial — a line-operations / SCADA-HMI app.
    static func industrial() -> HostAppConfig {
        HostAppConfig(
            integration: AppWorkflows.mesScada,
            appName: "LineOps HMI", appInitial: "L",
            brandColor: UIColor(red: 0.902, green: 0.490, blue: 0.133, alpha: 1), // amber
            whoLabel: "Operator · Shared HMI",
            subjectTitle: "Line 3 · Extruder A",
            subjectMeta: "Shift B · synthetic telemetry",
            steps: [
                ScriptedStep(key: "line.status", label: "View line status", hostDone: "Line status shown."),
                ScriptedStep(key: "event.ack", label: "Acknowledge event", hostDone: "Event acknowledged."),
                ScriptedStep(key: "setpoint.change", label: "Change a setpoint",
                             hostHold: "Confirm it's you before changing a setpoint on this shared HMI.",
                             hostDone: "Setpoint changed.",
                             confirmTitle: "Verify setpoint change"),
            ])
    }

    /// Global fleet — a transportation-management / dispatch app.
    static func globalFleet() -> HostAppConfig {
        HostAppConfig(
            integration: AppWorkflows.tmsDispatch,
            appName: "DispatchPro", appInitial: "D",
            brandColor: UIColor(red: 0.149, green: 0.388, blue: 0.714, alpha: 1), // blue
            whoLabel: "Driver · Shared cab tablet",
            subjectTitle: "Load LD-8842 · Dallas → Denver",
            subjectMeta: "Manifest MF-77 · synthetic load",
            steps: [
                ScriptedStep(key: "manifest.view", label: "View manifest", hostDone: "Manifest shown."),
                ScriptedStep(key: "load.accept", label: "Accept load", hostDone: "Load accepted."),
                ScriptedStep(key: "crossregion.checkout", label: "Cross-region checkout",
                             hostHold: "Confirm before a cross-region checkout.",
                             hostDone: "Cross-region checkout complete.",
                             confirmTitle: "Verify cross-region checkout"),
            ])
    }

    /// Retail — a point-of-sale app.
    static func retail() -> HostAppConfig {
        HostAppConfig(
            integration: AppWorkflows.pos,
            appName: "RegisterOne", appInitial: "R",
            brandColor: UIColor(red: 0.612, green: 0.153, blue: 0.361, alpha: 1), // magenta
            whoLabel: "Associate · Shared register",
            subjectTitle: "Register 4 · Store 118",
            subjectMeta: "Txn 0042 · synthetic sale",
            steps: [
                ScriptedStep(key: "price.lookup", label: "Look up a price", hostDone: "Price shown."),
                ScriptedStep(key: "sale.ring", label: "Ring a sale", hostDone: "Sale rung."),
                ScriptedStep(key: "refund.void", label: "Manager void / refund",
                             hostHold: "Confirm it's you before a manager void / refund.",
                             hostDone: "Void / refund applied.",
                             confirmTitle: "Verify manager void / refund"),
            ])
    }

    /// Data center — a DCIM / change-management app.
    static func dataCenter() -> HostAppConfig {
        HostAppConfig(
            integration: AppWorkflows.dcimChange,
            appName: "GridDCIM", appInitial: "N",
            brandColor: UIColor(red: 0.200, green: 0.549, blue: 0.549, alpha: 1), // teal
            whoLabel: "NOC engineer · Shared console",
            subjectTitle: "Change CR-3391 · Row 12",
            subjectMeta: "DC-East · synthetic change",
            steps: [
                ScriptedStep(key: "topology.view", label: "View topology", hostDone: "Topology shown."),
                ScriptedStep(key: "change.open", label: "Open change record", hostDone: "Change opened."),
                ScriptedStep(key: "change.execute", label: "Execute a change",
                             hostHold: "Confirm it's you before executing a change.",
                             hostDone: "Change executed.",
                             confirmTitle: "Verify change execution"),
            ])
    }
}
