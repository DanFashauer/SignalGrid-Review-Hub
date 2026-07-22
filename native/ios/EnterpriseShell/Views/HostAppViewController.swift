import UIKit
import LocalAuthentication

/// The invisible embedded flow, native.
///
/// This is the product's core design law (`EMBEDDED_UX_PRINCIPLE.md`): the worker
/// only ever sees THEIR OWN app — here a generic clinical chart, deliberately not
/// SignalGrid-branded. The trust layer runs underneath. Non-sensitive actions run
/// with no friction; a sensitive action is HELD until the worker satisfies a
/// native step-up (Face ID / Touch ID) AND confirms in the app's own dialog. The
/// decisions come from `AppWorkflows` — the native port of `@workspace/app-workflows`.
///
/// The "behind the glass" panel is operator-only demo instrumentation showing the
/// allow / step_up / assist / applied verdict the core returned. The worker never
/// sees it in production; here it is a labeled toggle for the demo.
final class HostAppViewController: UIViewController {

    // MARK: - Scripted flow (mirrors embedded-host-app-demo.html)

    private struct DemoStep {
        let key: String
        let label: String
        let needsStepUp: Bool
        let hostDone: String
        let hostHold: String
    }

    private let steps: [DemoStep] = [
        DemoStep(key: "chart.open", label: "Open chart", needsStepUp: false,
                 hostDone: "Chart opened.", hostHold: ""),
        DemoStep(key: "results.view", label: "View lab results", needsStepUp: false,
                 hostDone: "Results shown.", hostHold: ""),
        DemoStep(key: "order.place", label: "Place controlled med order", needsStepUp: true,
                 hostDone: "Controlled med order placed.",
                 hostHold: "One quick check to confirm it's you on this shared device."),
    ]

    // The order.place decision the core returns for a shared device with drift.
    private var stepUpInput: AppWorkflows.AppPlanInput {
        AppWorkflows.AppPlanInput(
            integration: AppWorkflows.emrChart,
            outcome: .step_up,
            reasonCodes: ["BASELINE_DRIFTED", "SHARED_DEVICE"]
        )
    }

    private var stepIndex = 0

    // MARK: - UI

    private let scrollView = UIScrollView()
    private let stack = UIStackView()
    private let rowsStack = UIStackView()
    private let hostBanner = UILabel()
    private let primaryButton = UIButton(type: .system)

    /// Operator-only instrumentation (hidden by default).
    private var glassVisible = false
    private let glassPanel = UIView()
    private let glassAction = UILabel()
    private let glassVerdict = UILabel()
    private let glassBody = UILabel()
    private let glassWhy = UILabel()

    // Host app brand color (a generic clinical app — NOT SignalGrid).
    private let appColor = UIColor(red: 0.043, green: 0.388, blue: 0.808, alpha: 1) // #0B63CE

    override func viewDidLoad() {
        super.viewDidLoad()
        modalPresentationStyle = .fullScreen
        view.backgroundColor = UIColor(red: 0.965, green: 0.973, blue: 0.984, alpha: 1) // #F6F8FB
        buildTopBar()
        buildAppBar()
        buildBody()
        buildGlassPanel()
        renderStep()
        AuditLogger.shared.log(event: .appLaunched, metadata: [
            "appId": AppWorkflows.emrChart.id, "mode": "embedded_assist"
        ])
        startAutoDemoIfNeeded()
    }

    #if targetEnvironment(simulator)
    /// Self-walk the full gate flow so each state can be captured without taps.
    private func startAutoDemoIfNeeded() {
        guard DemoMode.assistAuto else { return }
        glassVisible = true
        glassPanel.isHidden = false
        let q = DispatchQueue.main
        q.asyncAfter(deadline: .now() + 1.0) { [weak self] in self?.primaryTapped() } // open chart → auto
        q.asyncAfter(deadline: .now() + 2.2) { [weak self] in self?.primaryTapped() } // view results → auto
        q.asyncAfter(deadline: .now() + 3.4) { [weak self] in self?.primaryTapped() } // order → HELD (step_up)
        q.asyncAfter(deadline: .now() + 6.0) { [weak self] in
            guard let self, self.stepIndex < self.steps.count else { return }
            self.stepUpSatisfied(self.steps[self.stepIndex])                            // → ASSIST + confirm dialog
        }
        q.asyncAfter(deadline: .now() + 8.6) { [weak self] in
            guard let self, self.stepIndex < self.steps.count else { return }
            self.dismiss(animated: false) { self.confirmOrder(self.steps[self.stepIndex]) } // → APPLIED
        }
    }
    #else
    private func startAutoDemoIfNeeded() {}
    #endif

    // MARK: - Kiosk top bar (matches ManagedAppViewController containment)

    private func buildTopBar() {
        let bar = UIView()
        bar.backgroundColor = .secondarySystemBackground
        bar.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(bar)

        // Operator-only "behind the glass" toggle (a demo affordance).
        let eye = UIButton(type: .system)
        eye.setImage(UIImage(systemName: "eye"), for: .normal)
        eye.addTarget(self, action: #selector(toggleGlass), for: .touchUpInside)
        eye.translatesAutoresizingMaskIntoConstraints = false

        let title = UILabel()
        title.text = "Wardlink Chart"
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

    private var topBarBottom: NSLayoutYAxisAnchor!
    private var appBarBottom: NSLayoutYAxisAnchor!

    private func buildAppBar() {
        // The host app's OWN identity bar (generic clinical app, no SignalGrid).
        let appBar = UIView()
        appBar.backgroundColor = appColor
        appBar.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(appBar)

        let logo = UILabel()
        logo.text = "W"
        logo.textColor = .white
        logo.font = .systemFont(ofSize: 15, weight: .heavy)
        logo.textAlignment = .center
        logo.backgroundColor = UIColor.white.withAlphaComponent(0.22)
        logo.layer.cornerRadius = 6
        logo.clipsToBounds = true
        logo.translatesAutoresizingMaskIntoConstraints = false

        let name = UILabel()
        name.text = "Wardlink Chart"
        name.textColor = .white
        name.font = .systemFont(ofSize: 16, weight: .bold)
        name.translatesAutoresizingMaskIntoConstraints = false

        let who = UILabel()
        who.text = "RN · Shared iPad"
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

        // Patient card (synthetic record, no PHI).
        let card = cardView()
        let ptName = UILabel()
        ptName.text = "Rivera, A."
        ptName.font = .systemFont(ofSize: 17, weight: .bold)
        let ptMeta = UILabel()
        ptMeta.text = "Room 4B · MRN 00-DEMO · synthetic record"
        ptMeta.font = .systemFont(ofSize: 12)
        ptMeta.textColor = .secondaryLabel
        let cardStack = UIStackView(arrangedSubviews: [ptName, ptMeta])
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

        // Completed/held action rows.
        rowsStack.axis = .vertical
        rowsStack.spacing = 8
        stack.addArrangedSubview(rowsStack)

        // Host app's own status banner.
        hostBanner.numberOfLines = 0
        hostBanner.font = .systemFont(ofSize: 13, weight: .medium)
        hostBanner.layer.cornerRadius = 10
        hostBanner.clipsToBounds = true
        hostBanner.isHidden = true
        stack.addArrangedSubview(hostBanner)

        // Primary action button.
        primaryButton.backgroundColor = appColor
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

    // MARK: - Flow

    @objc private func primaryTapped() {
        SessionStateManager.shared.userDidInteract()
        guard stepIndex < steps.count else { return }
        let step = steps[stepIndex]

        if step.needsStepUp {
            evaluateAndHold(step)
        } else {
            // Non-sensitive read → the planner returns `auto` → runs immediately.
            let input = AppWorkflows.AppPlanInput(
                integration: AppWorkflows.emrChart, outcome: .allow,
                reasonCodes: ["TRUST_ESTABLISHED"])
            let plan = AppWorkflows.gateAppAction(input, step.key)
            setGlass(step.key, plan?.disposition.rawValue ?? "auto", "TRUST_ESTABLISHED",
                     "Non-sensitive action on a trusted session → runs automatically. The worker sees no gate.")
            AuditLogger.shared.log(event: .assistActionAuto, metadata: ["action": step.key])
            addRow(step.label, held: false)
            showBanner(step.hostDone, ok: true)
            stepIndex += 1
            renderStep()
        }
    }

    /// A sensitive action → HELD. SignalGrid does not release it; it asks the app
    /// to capture a real native gesture. The order does not fire yet.
    private func evaluateAndHold(_ step: DemoStep) {
        let plan = AppWorkflows.gateAppAction(stepUpInput, step.key)   // → .step_up
        setGlass(step.key, plan?.disposition.rawValue ?? "step_up", "BASELINE_DRIFTED · SHARED_DEVICE",
                 "High-assurance action on a shared device → HELD. SignalGrid does not release it; it asks the app to capture a real native gesture. The order does not fire yet.")
        AuditLogger.shared.log(event: .assistStepUpRequested, metadata: [
            "action": step.key, "reason": "BASELINE_DRIFTED,SHARED_DEVICE"])
        addRow(step.label, held: true)
        showBanner(step.hostHold, ok: false)
        primaryButton.isEnabled = false
        #if targetEnvironment(simulator)
        if DemoMode.assistAuto { return } // auto-walk satisfies the step-up on a timer
        #endif
        requestNativeStepUp(step)
    }

    /// Trigger the device's OWN authenticator (Face ID / Touch ID). Falls back to a
    /// clearly-labeled simulated authenticator when biometrics aren't available
    /// (e.g. an unconfigured simulator) — the demo stand-in the reference uses.
    private func requestNativeStepUp(_ step: DemoStep) {
        let context = LAContext()
        var authError: NSError?
        let reason = "Verify it's you before placing a controlled order on this shared device."
        if context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &authError) {
            context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { [weak self] ok, _ in
                DispatchQueue.main.async {
                    if ok { self?.stepUpSatisfied(step) } else { self?.stepUpDeclined(step) }
                }
            }
        } else {
            presentSimulatedAuthenticator(step)
        }
    }

    private func presentSimulatedAuthenticator(_ step: DemoStep) {
        let sheet = UIAlertController(
            title: "Confirm it's you",
            message: "Demo · simulated authenticator\n\nWardlink needs to verify this action on a shared device. No real biometric is used.",
            preferredStyle: .alert)
        sheet.addAction(UIAlertAction(title: "Cancel", style: .cancel) { [weak self] _ in
            self?.stepUpDeclined(step)
        })
        sheet.addAction(UIAlertAction(title: "Simulate Face ID", style: .default) { [weak self] _ in
            self?.stepUpSatisfied(step)
        })
        present(sheet, animated: true)
    }

    /// Step-up satisfied → the action is NOT placed yet. A critical action stays
    /// ASSIST: the app shows its OWN confirmation dialog (mirrors completeAppStepUp
    /// → still assist in the planner).
    private func stepUpSatisfied(_ step: DemoStep) {
        let plan = AppWorkflows.completeAppStepUp(stepUpInput)
        let action = plan.actions.first { $0.key == step.key }   // → .assist
        AuditLogger.shared.log(event: .assistStepUpSatisfied, metadata: ["action": step.key])
        setGlass(step.key, action?.disposition.rawValue ?? "assist", "STEP_UP_SATISFIED · AWAITING_CONFIRMATION",
                 "Step-up satisfied — but a critical action still requires an explicit confirmation in the app. SignalGrid holds it as ASSIST; the biometric alone does not place the order.")
        showBanner("Identity confirmed. Now verify the order to place it.", ok: false)
        AuditLogger.shared.log(event: .assistActionAwaitingConfirmation, metadata: ["action": step.key])

        let confirm = UIAlertController(
            title: "Verify controlled medication order",
            message: "Rivera, A. · Room 4B\nThis is the app's own confirmation, not a SignalGrid screen.",
            preferredStyle: .alert)
        confirm.addAction(UIAlertAction(title: "Cancel", style: .cancel) { [weak self] _ in
            self?.confirmDeclined(step)
        })
        confirm.addAction(UIAlertAction(title: "Confirm order", style: .default) { [weak self] _ in
            self?.confirmOrder(step)
        })
        present(confirm, animated: true)
    }

    private func stepUpDeclined(_ step: DemoStep) {
        // Fail-closed: no gesture, no release.
        setGlass(step.key, "step_up", "STEP_UP_NOT_SATISFIED",
                 "The worker declined the check, so the held action never fires. Fail-closed: no gesture, no release.")
        AuditLogger.shared.log(event: .assistStepUpFailed, metadata: ["action": step.key])
        showBanner("Cancelled. The action stays held — nothing was placed.", ok: false)
        primaryButton.isEnabled = true
    }

    private func confirmOrder(_ step: DemoStep) {
        // Explicit confirmation supplied → the held action is applied.
        var input = stepUpInput
        input.stepUpSatisfied = true
        let plan = AppWorkflows.confirmAppActions(input, [step.key])
        let action = plan.actions.first { $0.key == step.key }   // → .applied
        AuditLogger.shared.log(event: .assistActionConfirmed, metadata: ["action": step.key])
        AuditLogger.shared.log(event: .assistActionApplied, metadata: ["action": step.key])
        setGlass(step.key, action?.disposition.rawValue ?? "applied", "CONFIRMED_BY_CLINICIAN",
                 "The clinician confirmed in the app's own dialog → the held action is applied and the order proceeds. Two gates cleared: a native step-up AND an explicit confirmation.")
        markHeldRowDone()
        showBanner(step.hostDone, ok: true)
        stepIndex += 1
        renderStep()
    }

    private func confirmDeclined(_ step: DemoStep) {
        // Fail-closed even after a valid step-up.
        setGlass(step.key, "assist", "CONFIRMATION_DECLINED",
                 "Even with the step-up satisfied, no explicit confirmation means the critical action does not fire. Fail-closed.")
        AuditLogger.shared.log(event: .assistActionBlocked, metadata: ["action": step.key, "reason": "confirmation_declined"])
        showBanner("Confirmation cancelled. The order stays held and was never placed.", ok: false)
        primaryButton.isEnabled = true
    }

    // MARK: - Rendering

    private func renderStep() {
        if stepIndex >= steps.count {
            primaryButton.setTitle("All done ✓", for: .normal)
            primaryButton.isEnabled = false
            primaryButton.backgroundColor = .systemGray3
            return
        }
        primaryButton.isEnabled = true
        primaryButton.setTitle(steps[stepIndex].label, for: .normal)
    }

    private func addRow(_ label: String, held: Bool) {
        let row = UIView()
        row.tag = held ? 99 : 0
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
        status.text = held ? "HELD" : "DONE"
        status.font = .systemFont(ofSize: 11, weight: .heavy)
        status.textColor = held ? .systemOrange : .systemGreen
        status.tag = 1
        status.translatesAutoresizingMaskIntoConstraints = false

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
            status.text = "DONE"
            status.textColor = .systemGreen
        }
    }

    private func showBanner(_ text: String, ok: Bool) {
        hostBanner.isHidden = text.isEmpty
        hostBanner.text = "  " + text
        if ok {
            hostBanner.backgroundColor = UIColor.systemGreen.withAlphaComponent(0.12)
            hostBanner.textColor = UIColor(red: 0.086, green: 0.396, blue: 0.204, alpha: 1)
        } else {
            hostBanner.backgroundColor = UIColor.systemOrange.withAlphaComponent(0.14)
            hostBanner.textColor = UIColor(red: 0.6, green: 0.204, blue: 0.07, alpha: 1)
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
        glassWhy.text = "reason · \(why)"
    }

    private func verdictColor(_ v: String) -> UIColor {
        switch v {
        case "auto", "applied": return UIColor(red: 0.435, green: 0.659, blue: 0.549, alpha: 1)
        case "step_up", "assist": return UIColor(red: 0.761, green: 0.604, blue: 0.4, alpha: 1)
        case "blocked", "deny": return UIColor(red: 0.753, green: 0.455, blue: 0.455, alpha: 1)
        default: return .white
        }
    }

    // MARK: - Close

    @objc private func close() {
        SessionStateManager.shared.userDidInteract()
        dismiss(animated: true)
    }
}
