import Foundation
import Observation
import SignalGridMobileCore

@MainActor
@Observable
final class WardlinkModel {
    var selectedScenarioID = DemoFixtures.trustScenarios.first?.id ?? "healthy"
    var evaluation: AppWorkflowEvaluation?
    var pendingConfirmation: AppActionPlan?
    var pendingStepUp: AppActionPlan?
    var appliedActionKeys: Set<String> = []
    var isLoading = false
    var isAuthenticating = false
    var errorMessage: String?
    var hostMessage: String?
    var toastMessage: String?
    var showInstrumentation = false

    @ObservationIgnored private let api: any SignalGridAPI = MockSignalGridAPI()

    var scenario: TrustScenario {
        DemoFixtures.trustScenarios.first(where: { $0.id == selectedScenarioID })
            ?? DemoFixtures.trustScenarios[0]
    }

    var integration: AppIntegration {
        DemoFixtures.integrations.first(where: { $0.id == "emr-chart" })
            ?? DemoFixtures.integrations[0]
    }

    var actions: [AppActionPlan] {
        (evaluation?.plan.actions ?? []).map { action in
            guard appliedActionKeys.contains(action.key) else { return action }
            return AppActionPlan(
                key: action.key,
                label: action.label,
                riskTier: action.riskTier,
                sensitive: action.sensitive,
                disposition: .applied,
                requiresConfirmation: false,
                reason: "Confirmed in Wardlink"
            )
        }
    }

    func load() async {
        isLoading = true
        errorMessage = nil
        hostMessage = nil
        appliedActionKeys.removeAll()
        defer { isLoading = false }

        do {
            evaluation = try await api.evaluateAppWorkflow(
                AppWorkflowRequest(
                    integrationId: integration.id,
                    identityRef: scenario.identityRef,
                    deviceRef: scenario.deviceRef,
                    requestContext: [
                        "surface": "wardlink-native-ios-demo",
                        "patient": "synthetic"
                    ]
                )
            )
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func chooseScenario(_ id: String) async {
        selectedScenarioID = id
        pendingConfirmation = nil
        pendingStepUp = nil
        await load()
    }

    func perform(_ action: AppActionPlan) async {
        hostMessage = nil
        toastMessage = nil

        switch action.disposition {
        case .auto:
            appliedActionKeys.insert(action.key)
            toastMessage = "\(action.label) completed."
        case .assist:
            pendingConfirmation = action
        case .stepUp:
            pendingStepUp = action
            await authenticateForStepUp()
        case .blocked:
            hostMessage = "This action isn’t available on this device right now. Contact your support team if you need access."
        case .applied:
            toastMessage = "This action is already complete."
        }
    }

    func confirmPendingAction() {
        guard let action = pendingConfirmation else { return }
        appliedActionKeys.insert(action.key)
        pendingConfirmation = nil
        toastMessage = "\(action.label) confirmed."
    }

    func cancelPendingAction() {
        pendingConfirmation = nil
        toastMessage = "Action canceled."
    }

    private func authenticateForStepUp() async {
        guard !isAuthenticating else { return }
        isAuthenticating = true
        defer { isAuthenticating = false }

        // Routed through the core's fail-closed gate. `StepUpGate` had zero production
        // callers while this model hand-rolled the same LAContext call INVERTED: when
        // the device could not ask (no passcode — a plausible state for a shared
        // clinical iPad), an alert offered a "demo verification" button that granted
        // the gated action. "We could not ask" is not "they answered" (2026-09-05).
        let gate = StepUpGate(authenticator: LocalAuthenticationStepUp())
        let outcome = await gate.evaluate(outcome: .stepUp, reason: .privilegedAction)
        if StepUpGate.permits(outcome) {
            processStepUpSuccess()
            return
        }
        pendingStepUp = nil
        switch outcome {
        case .unavailable(let why):
            hostMessage = "This device cannot verify presence (\(why)). The action remains unavailable — set a device passcode or use a device with Face ID / Touch ID."
        default:
            hostMessage = "Verification was not completed. The action remains unavailable."
        }
    }

    private func processStepUpSuccess() {
        guard let action = pendingStepUp else { return }
        pendingStepUp = nil
        if action.sensitive {
            pendingConfirmation = AppActionPlan(
                key: action.key,
                label: action.label,
                riskTier: action.riskTier,
                sensitive: action.sensitive,
                disposition: .assist,
                requiresConfirmation: true,
                reason: "Native verification completed; Wardlink confirmation still required"
            )
        } else {
            appliedActionKeys.insert(action.key)
            toastMessage = "Verified. \(action.label) completed."
        }
    }
}
