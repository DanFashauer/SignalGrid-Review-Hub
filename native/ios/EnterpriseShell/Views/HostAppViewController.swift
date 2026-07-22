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
        /// The normalized signals present when this action is attempted. The
        /// DecisionEngine computes the verdict + reason codes from these — nothing
        /// is hand-set. Empty defaults to a trusted identity+posture context.
        let signals: [DecisionEngine.Signal]
        var hostHold: String = ""      // shown while HELD for a step-up
        var hostDone: String = ""      // shown when the action completes
        var hostBlocked: String = ""   // the app's OWN message on restrict/deny
        var confirmTitle: String = ""  // the app's own confirmation dialog title
    }

    /// The live decision for a step, computed from its signal context.
    private func decision(for step: ScriptedStep) -> DecisionEngine.Result {
        DecisionEngine.evaluate(step.signals)
    }

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
        AuditLogger.shared.log(event: .appLaunched, metadata: [
            "appId": config.integration.id, "mode": "embedded_assist"])
        startAutoDemoIfNeeded()
    }

    // MARK: - Top bar (kiosk containment, matches ManagedAppViewController)

    private func buildTopBar() {
        let bar = UIView()
        bar.backgroundColor = .secondarySystemBackground
        bar.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(bar)

        let eye = UIButton(type: .system)
        eye.setImage(UIImage(systemName: "eye"), for: .normal)
        eye.addTarget(self, action: #selector(toggleGlass), for: .touchUpInside)
        eye.translatesAutoresizingMaskIntoConstraints = false

        let title = UILabel()
        title.text = config.appName
        title.font = .systemFont(ofSize: 17, weight: .semibold)
        title.translatesAutoresizingMaskIntoConstraints = false

        let done = UIButton(type: .system)
        done.setTitle("Done", for: .normal)
        done.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
        done.addTarget(self, action: #selector(close), for: .touchUpInside)
        done.translatesAutoresizingMaskIntoConstraints = false

        bar.addSubview(eye); bar.addSubview(title); bar.addSubview(done)
        NSLayoutConstraint.activate([
            bar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            bar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            bar.heightAnchor.constraint(equalToConstant: 48),
            eye.leadingAnchor.constraint(equalTo: bar.leadingAnchor, constant: 16),
            eye.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
            title.centerXAnchor.constraint(equalTo: bar.centerXAnchor),
            title.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
            done.trailingAnchor.constraint(equalTo: bar.trailingAnchor, constant: -16),
            done.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
        ])
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
        logo.font = .systemFont(ofSize: 15, weight: .heavy)
        logo.textAlignment = .center
        logo.backgroundColor = UIColor.white.withAlphaComponent(0.22)
        logo.layer.cornerRadius = 6
        logo.clipsToBounds = true
        logo.translatesAutoresizingMaskIntoConstraints = false

        let name = UILabel()
        name.text = config.appName
        name.textColor = .white
        name.font = .systemFont(ofSize: 16, weight: .bold)
        name.translatesAutoresizingMaskIntoConstraints = false

        let who = UILabel()
        who.text = config.whoLabel
        who.textColor = UIColor.white.withAlphaComponent(0.85)
        who.font = .systemFont(ofSize: 12, weight: .regular)
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
        subjTitle.font = .systemFont(ofSize: 17, weight: .bold)
        let subjMeta = UILabel()
        subjMeta.text = config.subjectMeta
        subjMeta.font = .systemFont(ofSize: 12)
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
        hostBanner.font = .systemFont(ofSize: 13, weight: .medium)
        hostBanner.layer.cornerRadius = 10
        hostBanner.clipsToBounds = true
        hostBanner.isHidden = true
        stack.addArrangedSubview(hostBanner)

        primaryButton.backgroundColor = config.brandColor
        primaryButton.setTitleColor(.white, for: .normal)
        primaryButton.titleLabel?.font = .systemFont(ofSize: 15, weight: .bold)
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
        let d = decision(for: step)                       // verdict computed from signals
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
            showBanner(step.hostBlocked, kind: .blocked)
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
            let sheet = UIAlertController(
                title: "Confirm it's you",
                message: "Demo · simulated authenticator\n\n\(config.appName) needs to verify this action on a shared device. No real biometric is used.",
                preferredStyle: .alert)
            sheet.addAction(UIAlertAction(title: "Cancel", style: .cancel) { [weak self] _ in self?.stepUpDeclined(step) })
            sheet.addAction(UIAlertAction(title: "Simulate Face ID", style: .default) { [weak self] _ in self?.stepUpSatisfied(step) })
            present(sheet, animated: true)
        }
    }

    /// Step-up satisfied → the action is NOT placed yet if it is sensitive; it stays
    /// ASSIST until an explicit confirmation (mirrors completeAppStepUp).
    private func stepUpSatisfied(_ step: ScriptedStep) {
        let d = decision(for: step)
        var input = AppWorkflows.AppPlanInput(
            integration: config.integration, outcome: d.outcome, reasonCodes: d.reasonCodes)
        let plan = AppWorkflows.completeAppStepUp(input)
        let action = plan.actions.first { $0.key == step.key }
        AuditLogger.shared.log(event: .assistStepUpSatisfied, metadata: ["action": step.key])

        if action?.disposition == .assist {
            setGlass(step.key, "assist", "STEP_UP_SATISFIED · AWAITING_CONFIRMATION",
                     "Step-up satisfied — but a critical action still requires an explicit confirmation in the app. SignalGrid holds it as ASSIST; the biometric alone does not fire it.")
            showBanner("Identity confirmed. Now confirm to proceed.", kind: .hold)
            AuditLogger.shared.log(event: .assistActionAwaitingConfirmation, metadata: ["action": step.key])
            flow = .awaitingConfirm
            presentConfirm(step)
        } else {
            // Gated-but-not-sensitive → released after the step-up.
            input.stepUpSatisfied = true
            setGlass(step.key, "applied", "RELEASED_AFTER_STEP_UP",
                     "Step-up satisfied and the action is not sensitive → released. One gate cleared.")
            markHeldRowDone()
            showBanner(step.hostDone, kind: .ok)
            AuditLogger.shared.log(event: .assistActionApplied, metadata: ["action": step.key])
            advance()
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
        let d = decision(for: step)
        var input = AppWorkflows.AppPlanInput(
            integration: config.integration, outcome: d.outcome, reasonCodes: d.reasonCodes)
        input.stepUpSatisfied = (d.outcome == .step_up)
        let plan = AppWorkflows.confirmAppActions(input, [step.key])
        let action = plan.actions.first { $0.key == step.key }
        AuditLogger.shared.log(event: .assistActionConfirmed, metadata: ["action": step.key])
        AuditLogger.shared.log(event: .assistActionApplied, metadata: ["action": step.key])
        let gatesCleared = d.outcome == .step_up
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
        lbl.font = .systemFont(ofSize: 13, weight: .semibold)
        lbl.translatesAutoresizingMaskIntoConstraints = false

        let status = UILabel()
        status.tag = 1
        status.font = .systemFont(ofSize: 11, weight: .heavy)
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
        glassPanel.backgroundColor = UIColor(red: 0.098, green: 0.118, blue: 0.137, alpha: 1)
        glassPanel.layer.cornerRadius = 14
        glassPanel.translatesAutoresizingMaskIntoConstraints = false
        glassPanel.isHidden = true
        view.addSubview(glassPanel)

        let heading = UILabel()
        heading.text = "BEHIND THE GLASS · operator view · the worker never sees this"
        heading.font = .monospacedSystemFont(ofSize: 9, weight: .semibold)
        heading.textColor = UIColor(red: 0.454, green: 0.671, blue: 0.647, alpha: 1)
        heading.numberOfLines = 0

        glassAction.font = .monospacedSystemFont(ofSize: 12, weight: .medium)
        glassAction.textColor = .white
        glassVerdict.font = .monospacedSystemFont(ofSize: 15, weight: .bold)
        glassBody.font = .systemFont(ofSize: 12)
        glassBody.textColor = UIColor(white: 0.75, alpha: 1)
        glassBody.numberOfLines = 0
        glassWhy.font = .monospacedSystemFont(ofSize: 10, weight: .regular)
        glassWhy.textColor = UIColor(white: 0.55, alpha: 1)
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

    @objc private func toggleGlass() {
        glassVisible.toggle()
        glassPanel.isHidden = !glassVisible
    }

    private func setGlass(_ action: String, _ verdict: String, _ why: String, _ body: String) {
        glassAction.text = "action · \(action)"
        glassVerdict.text = verdict.uppercased()
        glassVerdict.textColor = verdictColor(verdict)
        glassBody.text = body
        glassWhy.text = "reason · \(why)\nsource · \(decisionSource.rawValue)"
    }

    /// Which decision service produced the panel's verdicts. The synchronous flow is
    /// driven by the on-device engine; a control-plane backend (when configured) is
    /// available via RemoteDecisionService and used with on-device fallback.
    private var decisionSource: DecisionSource {
        #if targetEnvironment(simulator)
        return DemoMode.backendURL != nil && !(DemoMode.backendToken ?? "").isEmpty ? .controlPlane : .onDevice
        #else
        return .onDevice
        #endif
    }

    private func verdictColor(_ v: String) -> UIColor {
        switch v {
        case "auto", "applied": return UIColor(red: 0.435, green: 0.659, blue: 0.549, alpha: 1)
        case "step_up", "assist": return UIColor(red: 0.761, green: 0.604, blue: 0.4, alpha: 1)
        case "blocked", "deny", "restrict": return UIColor(red: 0.753, green: 0.455, blue: 0.455, alpha: 1)
        default: return .white
        }
    }

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
        location == "warehouse" ? warehouse() : clinical()
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
            steps: [
                // Trusted identity + fresh posture → engine returns allow.
                ScriptedStep(key: "chart.open", label: "Open chart",
                             signals: [.authenticated, .postureObserved], hostDone: "Chart opened."),
                ScriptedStep(key: "results.view", label: "View lab results",
                             signals: [.authenticated, .postureObserved], hostDone: "Results shown."),
                // Stale posture on the shared device → engine returns step_up (POSTURE_STALE).
                ScriptedStep(key: "order.place", label: "Place controlled med order",
                             signals: [.authenticated, .postureObserved, .staleCheckin],
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
                ScriptedStep(key: "task.accept", label: "Accept pick task",
                             signals: [.authenticated, .postureObserved], hostDone: "Task accepted."),
                ScriptedStep(key: "pick.confirm", label: "Confirm pick",
                             signals: [.authenticated, .postureObserved], hostDone: "Pick confirmed."),
                // Non-compliant device → engine returns restrict (DEVICE_NON_COMPLIANT).
                ScriptedStep(key: "inventory.adjust", label: "Adjust inventory",
                             signals: [.authenticated, .postureObserved, .nonCompliant],
                             hostBlocked: "Inventory adjust isn't available on this device right now."),
                // Stale posture → engine returns step_up (POSTURE_STALE).
                ScriptedStep(key: "highvalue.release", label: "Release high-value pick",
                             signals: [.authenticated, .postureObserved, .staleCheckin],
                             hostHold: "Quick check to confirm it's you before releasing a high-value pick.",
                             hostDone: "High-value pick released.",
                             confirmTitle: "Verify high-value pick release"),
            ])
    }
}
