import Foundation

/// Native port of the deterministic simulator decision engine
/// (`lib/signalgrid-simulator/src/decisionEngine.ts`, per `SIMULATOR_DECISION_ENGINE.md`).
///
/// Maps a set of normalized signals (identity, device posture/compliance, state
/// freshness, custody/location, dock, workflow, security risk) to a primary gate
/// outcome + reason codes. Deterministic and fail-closed. This replaces hand-set
/// per-action verdicts: the host app builds a signal context and the engine
/// decides, exactly as the sim suite does — so the on-device flow reflects the
/// real decision logic, not a script.
enum DecisionEngine {

    struct Signal {
        let type: String
        var layer: String? = nil
        var attributes: [String: String] = [:]

        init(_ type: String, layer: String? = nil, attributes: [String: String] = [:]) {
            self.type = type; self.layer = layer; self.attributes = attributes
        }

        // Convenience signal contexts (public-safe, synthetic).
        static let authenticated = Signal("identity.authenticated")
        static let postureObserved = Signal("device.posture_observed")
        static let staleCheckin = Signal("device.stale_checkin")   // → step_up (POSTURE_STALE)
        static let nonCompliant = Signal("device.non_compliant")   // → restrict (DEVICE_NON_COMPLIANT)
        static let wrongZone = Signal("rtls.wrong_zone")           // custody/location exception
        static let securityRisk = Signal("identity.risk_detected") // → restrict (SECURITY_RISK_ESCALATION)
    }

    struct Result {
        let outcome: AppWorkflows.DecisionOutcome   // gate outcome fed to the planner
        let reasonCodes: [String]
        let explanation: String
        let allOutcomes: [String]                   // full ordered simulator outcome set
    }

    static func evaluate(_ signals: [Signal]) -> Result {
        func hasType(_ t: String) -> Bool { signals.contains { $0.type == t } }

        let hasCriticalOrHighSecurityRisk = signals.contains {
            $0.type == "identity.risk_detected" ||
            $0.attributes["securityRisk"] == "high" ||
            $0.attributes["edr"] == "disabled" ||
            $0.attributes["edrRisk"] == "high"
        }
        let hasIdentityIntegrityFailure = signals.contains {
            $0.layer == "identity" &&
            ($0.attributes["identityState"] == "invalid" ||
             $0.attributes["identityState"] == "disabled" ||
             $0.attributes["risk"] == "high")
        }
        let hasDeviceTrustFailure = signals.contains {
            $0.attributes["compliance"] == "non_compliant" ||
            $0.attributes["managementState"] == "unmanaged" ||
            $0.attributes["deviceCompromised"] == "true" ||
            $0.attributes["sourceIntegrity"] == "failed"
        }
        let hasStateFreshnessFailure = signals.contains {
            $0.attributes["declaredState"] == "stale" ||
            $0.attributes["ssoStatus"] == "missing" ||
            $0.attributes["freshness"] == "stale" ||
            $0.attributes["criticalInput"] == "malformed"
        }
        let hasCustodyFailure = signals.contains {
            $0.attributes["zone"] == "wrong" ||
            $0.attributes["location"] == "unknown" ||
            $0.attributes["missingReturn"] == "true" ||
            $0.attributes["overdue"] == "true" ||
            $0.attributes["returnBay"] == "wrong"
        }
        let hasWorkflowRoutingFailure = signals.contains {
            $0.attributes["workflowOwner"] == "missing" ||
            $0.attributes["requiredApproval"] == "missing" ||
            $0.attributes["escalationDestination"] == "unavailable"
        }
        let hasActiveCustodyIntegrityFailure = hasCustodyFailure ||
            hasType("dock.device_missing") || hasType("dock.wrong_slot_return") ||
            hasType("rtls.wrong_zone") || hasType("rts.staff_safety_alert")

        var outcomes = Set<String>()
        var reasonCodes: [String] = []

        if hasIdentityIntegrityFailure {
            outcomes.formUnion(["restrict", "alert_operator", "route_to_owner"]); reasonCodes.append("IDENTITY_INTEGRITY_FAILURE")
        }
        if hasDeviceTrustFailure {
            outcomes.formUnion(["restrict", "create_ticket", "alert_operator"]); reasonCodes.append("DEVICE_TRUST_FAILURE")
        }
        if hasStateFreshnessFailure {
            outcomes.formUnion(["step_up", "request_remediation"]); reasonCodes.append("STATE_FRESHNESS_FAILURE")
        }
        if hasCustodyFailure {
            outcomes.formUnion(["create_ticket", "alert_operator", "route_to_owner"]); reasonCodes.append("CUSTODY_EXCEPTION")
        }
        if hasWorkflowRoutingFailure {
            outcomes.formUnion(["step_up", "alert_operator", "route_to_owner"]); reasonCodes.append("WORKFLOW_ROUTE_UNAVAILABLE")
        }
        if hasType("device.non_compliant") {
            outcomes.formUnion(["restrict", "create_ticket", "alert_operator"]); reasonCodes.append("DEVICE_NON_COMPLIANT")
        }
        if hasType("device.stale_checkin") {
            outcomes.formUnion(["step_up", "request_remediation"]); reasonCodes.append("POSTURE_STALE")
        }
        if hasType("dock.device_missing") || hasType("dock.wrong_slot_return") {
            outcomes.formUnion(["create_ticket", "alert_operator", "route_to_owner"]); reasonCodes.append("DOCK_EXCEPTION")
        }
        if hasType("rtls.wrong_zone") || hasType("rts.staff_safety_alert") {
            outcomes.formUnion(["alert_operator", "route_to_owner"]); reasonCodes.append("LOCATION_EXCEPTION")
        }
        if hasType("device.low_battery") {
            outcomes.formUnion(["route_to_owner", "alert_operator"]); reasonCodes.append("BATTERY_WORKFLOW_RISK")
        }
        if hasType("device.health_degraded") {
            outcomes.formUnion(["route_to_owner", "create_ticket"]); reasonCodes.append("OPERATIONAL_HEALTH_DEGRADED")
        }
        if hasCriticalOrHighSecurityRisk {
            outcomes.formUnion(["restrict", "alert_operator", "route_to_owner"]); reasonCodes.append("SECURITY_RISK_ESCALATION")
        }
        if hasType("api.integration_failed") {
            outcomes.formUnion(["alert_operator", "route_to_owner"]); reasonCodes.append("INTEGRATION_ROUTE_DEGRADED")
        }
        if hasType("remediation.verified") {
            outcomes.formUnion(["verify_remediation", "allow"]); reasonCodes.append("REMEDIATION_VERIFIED")
        }

        if outcomes.isEmpty && hasType("identity.authenticated") &&
            (hasType("device.posture_observed") || hasType("apple.ddm_declared_state")) &&
            !hasType("device.non_compliant") {
            outcomes.insert("allow")
            reasonCodes.append(hasType("apple.ddm_declared_state") ? "APPLE_DECLARED_STATE_TRUSTED" : "IDENTITY_AND_POSTURE_TRUSTED")
        }

        outcomes.insert("record_audit")

        if outcomes.contains("allow") &&
            (outcomes.contains("restrict") || outcomes.contains("deny") || outcomes.contains("step_up")) {
            outcomes.remove("allow"); reasonCodes.append("ALLOW_REMOVED_DUE_TO_HIGHER_RISK")
        }
        if outcomes.contains("allow") && hasActiveCustodyIntegrityFailure {
            outcomes.remove("allow"); reasonCodes.append("ALLOW_REMOVED_DUE_TO_CUSTODY_FAILURE")
        }

        let order = ["deny", "restrict", "step_up", "alert_operator", "create_ticket",
                     "route_to_owner", "request_remediation", "verify_remediation", "allow", "record_audit"]
        let ordered = order.filter { outcomes.contains($0) }

        return Result(outcome: gateOutcome(ordered),
                      reasonCodes: reasonCodes,
                      explanation: explain(ordered, reasonCodes),
                      allOutcomes: ordered)
    }

    /// Reduce the full simulator outcome set to the four gate outcomes the
    /// app-workflows planner consumes. Fail-closed: if only routing/audit outcomes
    /// remain (no allow), hold for a step-up (mirrors NO_RULE_MATCHED_DEFAULT_STEP_UP).
    private static func gateOutcome(_ ordered: [String]) -> AppWorkflows.DecisionOutcome {
        if ordered.contains("deny") { return .deny }
        if ordered.contains("restrict") { return .restrict }
        if ordered.contains("step_up") { return .step_up }
        if ordered.contains("allow") { return .allow }
        return .step_up
    }

    private static func explain(_ outcomes: [String], _ reasonCodes: [String]) -> String {
        if outcomes.contains("restrict") {
            return "Risk exceeded the trust threshold, so the workflow is restricted and routed for review."
        }
        if outcomes.contains("step_up") {
            return "Trust is incomplete (posture freshness), so review/refresh is required before treating the device as fully trusted."
        }
        if outcomes.contains("alert_operator") || outcomes.contains("create_ticket") {
            return "Operational exception routed: \(reasonCodes.joined(separator: ", "))."
        }
        if outcomes.contains("verify_remediation") {
            return "Remediation verified → allow candidate with audit evidence."
        }
        return "Identity, posture, location, dock, and workflow signals are aligned, so the workflow is allowed with audit evidence."
    }
}
