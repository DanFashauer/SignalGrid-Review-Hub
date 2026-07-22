import Foundation

/// Native port of `@workspace/app-workflows` — the Assist model that gates
/// APPLICATION actions. An app calls SignalGrid before a sensitive action and
/// gets back which of its actions may run automatically vs. which must be
/// human-confirmed. This mirrors `lib/app-workflows/src/index.ts` so the on-device
/// behaviour matches the reference planner and the `embedded-host-app-demo`.
///
/// Design guarantees (identical to the TS planner):
///   • Nothing sensitive fires silently — a sensitive action is ALWAYS `assist`
///     on an allow (explicit human confirmation), or `applied` once confirmed.
///   • A sensitive action is held for step-up / blocked under restriction even if
///     it wasn't explicitly marked gated.
///   • Pure and deterministic; fails closed on an unrecognized outcome.
enum AppWorkflows {

    // MARK: - Model (mirrors index.ts)

    /// The decision core's verdict for an actor + device + workflow.
    enum DecisionOutcome: String {
        case allow, step_up, restrict, deny
    }

    enum AppRiskTier: String {
        case standard, elevated, critical
    }

    enum AppActionDisposition: String {
        case auto, assist, step_up, blocked, applied
    }

    enum AppSessionMode: String {
        case proceed, assist, step_up, hold, deny
    }

    /// A single gated action an integrated app can perform.
    struct AppAction {
        let key: String
        let label: String
        let riskTier: AppRiskTier
        /// Sensitive actions require human confirmation even on an allow.
        let sensitive: Bool
        /// Gated actions are held by `step_up` and blocked by `restrict`.
        let gatedByStepUp: Bool

        init(_ key: String, _ label: String, _ riskTier: AppRiskTier,
             sensitive: Bool? = nil, gated: Bool? = nil) {
            self.key = key
            self.label = label
            self.riskTier = riskTier
            self.sensitive = sensitive ?? (riskTier == .critical)
            self.gatedByStepUp = gated ?? (riskTier != .standard)
        }
    }

    /// An integrated application (a generic category, never a real product).
    struct AppIntegration {
        let id: String
        let name: String
        let category: String
        let vertical: String
        let workflowKey: String
        let actions: [AppAction]
    }

    struct AppActionPlan {
        let key: String
        let label: String
        let riskTier: AppRiskTier
        let sensitive: Bool
        let disposition: AppActionDisposition
        let requiresConfirmation: Bool
        let reason: String
    }

    struct AppSessionPlan {
        let integrationId: String
        let integrationName: String
        let outcome: DecisionOutcome
        let mode: AppSessionMode
        let summary: String
        let actions: [AppActionPlan]
    }

    struct AppPlanInput {
        let integration: AppIntegration
        let outcome: DecisionOutcome
        let reasonCodes: [String]
        /// Keys of `assist` actions a human has confirmed this turn.
        var confirmedActionKeys: [String] = []
        /// True once the holder has satisfied a step-up (badge tap / biometric).
        var stepUpSatisfied: Bool = false
        /// Who confirms a sensitive action, phrased for the vertical.
        var confirmer: String? = nil
    }

    private static let defaultConfirmer: [String: String] = [
        "healthcare": "clinician",
        "warehouse": "supervisor",
        "industrial": "supervisor",
        "global_fleet": "dispatcher",
        "retail": "manager",
        "data_center": "shift lead",
    ]

    private static func firstReason(_ codes: [String], _ fallback: String) -> String {
        codes.first ?? fallback
    }

    // MARK: - Planner (mirrors planAppSession)

    static func planAppSession(_ input: AppPlanInput) -> AppSessionPlan {
        let confirmed = Set(input.confirmedActionKeys)
        let confirmer = input.confirmer ?? defaultConfirmer[input.integration.vertical] ?? "supervisor"

        let stepUpDone = input.outcome == .step_up && input.stepUpSatisfied
        let effective: DecisionOutcome = stepUpDone ? .allow : input.outcome

        let actions: [AppActionPlan] = input.integration.actions.map { a in
            var disposition: AppActionDisposition
            var reason: String
            var requiresConfirmation = false

            switch effective {
            case .deny:
                disposition = .blocked
                reason = "Denied — \(firstReason(input.reasonCodes, "trust conditions not met"))"
            case .restrict:
                // A sensitive action is never low-risk → blocked under restriction
                // regardless of the gatedByStepUp flag.
                if a.gatedByStepUp || a.sensitive {
                    disposition = .blocked
                    reason = "Restricted — \(firstReason(input.reasonCodes, "elevated risk"))"
                } else {
                    disposition = .auto
                    reason = "Low-risk action permitted under restriction"
                }
            case .step_up:
                // Hold a sensitive action for step-up even if not marked gated.
                if a.gatedByStepUp || a.sensitive {
                    disposition = .step_up
                    requiresConfirmation = true
                    reason = "Held for step-up — \(firstReason(input.reasonCodes, "additional verification required"))"
                } else {
                    disposition = .auto
                    reason = "Low-risk action permitted pending step-up"
                }
            case .allow:
                if a.sensitive {
                    if confirmed.contains(a.key) {
                        disposition = .applied
                        reason = "Confirmed by \(confirmer)"
                    } else {
                        disposition = .assist
                        requiresConfirmation = true
                        reason = "Prepared — requires \(confirmer) confirmation (sensitive)"
                    }
                } else {
                    disposition = .auto
                    reason = stepUpDone ? "Released after step-up" : "Trusted — performed automatically"
                }
            }

            return AppActionPlan(
                key: a.key, label: a.label, riskTier: a.riskTier, sensitive: a.sensitive,
                disposition: disposition, requiresConfirmation: requiresConfirmation, reason: reason
            )
        }

        let mode = deriveMode(effective, actions)
        return AppSessionPlan(
            integrationId: input.integration.id,
            integrationName: input.integration.name,
            outcome: input.outcome,
            mode: mode,
            summary: summarize(mode, input.integration, confirmer, stepUpDone),
            actions: actions
        )
    }

    private static func deriveMode(_ outcome: DecisionOutcome, _ actions: [AppActionPlan]) -> AppSessionMode {
        switch outcome {
        case .deny: return .deny
        case .restrict: return .hold
        case .step_up: return .step_up
        case .allow: return actions.contains { $0.disposition == .assist } ? .assist : .proceed
        }
    }

    private static func summarize(_ mode: AppSessionMode, _ integration: AppIntegration,
                                  _ confirmer: String, _ stepUpDone: Bool) -> String {
        let after = stepUpDone ? " after step-up" : ""
        switch mode {
        case .proceed: return "\(integration.name): trusted — all actions available\(after)."
        case .assist:  return "\(integration.name): available\(after); sensitive actions await \(confirmer) confirmation."
        case .step_up: return "\(integration.name): high-assurance actions held pending a step-up (badge tap / biometric)."
        case .hold:    return "\(integration.name): limited — only low-risk actions permitted under restriction."
        case .deny:    return "\(integration.name): denied; no action available. Recorded with reason."
        }
    }

    /// Gate a SINGLE named action.
    static func gateAppAction(_ input: AppPlanInput, _ actionKey: String) -> AppActionPlan? {
        planAppSession(input).actions.first { $0.key == actionKey }
    }

    /// Confirm one or more `assist` actions (a human approving a sensitive step).
    static func confirmAppActions(_ input: AppPlanInput, _ actionKeys: [String]) -> AppSessionPlan {
        var next = input
        next.confirmedActionKeys = Array(Set(input.confirmedActionKeys + actionKeys))
        return planAppSession(next)
    }

    /// Simulate the holder satisfying a step-up (badge tap / biometric).
    static func completeAppStepUp(_ input: AppPlanInput) -> AppSessionPlan {
        var next = input
        next.stepUpSatisfied = true
        return planAppSession(next)
    }

    // MARK: - Catalog (subset of catalog.ts, public-safe generic categories)

    /// EMR / chart — the healthcare reference integration used by the embedded demo.
    static let emrChart = AppIntegration(
        id: "emr-chart",
        name: "EMR / chart",
        category: "Clinical record",
        vertical: "healthcare",
        workflowKey: "clinical-session",
        actions: [
            AppAction("chart.open", "Open patient chart", .elevated),
            AppAction("results.view", "View lab / imaging results", .elevated),
            AppAction("note.document", "Document a note", .standard),
            AppAction("order.place", "Place / verify a medication order", .critical),
            AppAction("discharge.release", "Release discharge", .critical),
        ]
    )
}
