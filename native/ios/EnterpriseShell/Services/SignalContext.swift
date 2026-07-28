import Foundation

/// Assembles the LIVE signal context that drives the embedded Assist gate, so the
/// verdict reflects the device's actually-detected posture and its deployment
/// location — not a per-step script.
///
/// Two responsibilities, both pure and deterministic (no UIKit, so the hermetic
/// test target compiles this directly):
///   1. `signals(_:)` maps a gathered `EnvironmentContext` onto the normalized
///      `DecisionEngine.Signal`s the engine already understands. The engine
///      (`DecisionEngine.swift`) and planner (`AppWorkflows.swift`) are untouched
///      byte-faithful ports of the TS simulator.
///   2. `LocationGate` is a thin pre-gate: a device outside its authorized zone is
///      DENIED before the engine runs. Deny lives here (not in the engine) because
///      the engine has no `deny` producer and treats custody exceptions as
///      step-up/route — forcing deny inside it would diverge from the TS mirror.
///
/// What is genuinely "detected" on iOS (screen capture, session freshness,
/// lockout, zone match) vs. demo-injected (compliance/EDR/geo, which iOS cannot
/// sense) is decided by the caller; this layer just maps whatever it is handed.
enum SignalContext {

    /// Plain inputs gathered by the caller from live posture + location + demo flags.
    struct EnvironmentContext {
        var authenticated: Bool
        /// The zone the device is deployed to (its persona/location).
        var expectedZone: String
        /// The zone the device is actually in. `nil` = could not be determined.
        var detectedZone: String?
        /// A screen recording / mirror is active (`UIScreen.isCaptured`).
        var screenCaptured: Bool
        /// The session's posture check-in is stale.
        var sessionStale: Bool
        /// Security lockout is in effect (rate-limit / failed attempts).
        var lockedOut: Bool
        /// Demo-injected raw conditions for things iOS can't sense
        /// (`stale`, `non_compliant`, `security_risk`, `remediated`).
        var injected: Set<String>
        /// Whether device posture was POSITIVELY sourced (a real compliance/management
        /// observation, or the demo's injected posture). When false, the engine must
        /// NOT be told `device.posture_observed` — otherwise unknown posture becomes the
        /// base allow path. Fail-closed default.
        var postureObserved: Bool

        init(authenticated: Bool,
             expectedZone: String,
             detectedZone: String?,
             screenCaptured: Bool = false,
             sessionStale: Bool = false,
             lockedOut: Bool = false,
             injected: Set<String> = [],
             postureObserved: Bool = false) {
            self.authenticated = authenticated
            self.expectedZone = expectedZone
            self.detectedZone = detectedZone
            self.postureObserved = postureObserved
            self.screenCaptured = screenCaptured
            self.sessionStale = sessionStale
            self.lockedOut = lockedOut
            self.injected = injected
        }
    }

    /// Map the gathered context onto the engine's existing signal vocabulary.
    static func signals(_ ctx: EnvironmentContext) -> [DecisionEngine.Signal] {
        var out: [DecisionEngine.Signal] = []
        if ctx.authenticated { out.append(.authenticated) }
        // Only tell the engine posture was observed when it POSITIVELY was. Emitting
        // this unconditionally made unknown posture (an authenticated session with no
        // real compliance/management observation) the engine's base allow path — a
        // fail-open. Absent a positive observation, the signal is withheld and the
        // engine has no posture evidence to allow on.
        if ctx.postureObserved { out.append(.postureObserved) }

        // Active screen recording during a session → exfiltration risk (restrict).
        if ctx.screenCaptured {
            out.append(DecisionEngine.Signal("device.posture_observed",
                                             attributes: ["securityRisk": "high"]))
        }
        // Stale posture check-in → step_up (POSTURE_STALE).
        if ctx.sessionStale || ctx.injected.contains("stale") {
            out.append(.staleCheckin)
        }
        // Device out of compliance → restrict (DEVICE_NON_COMPLIANT).
        if ctx.injected.contains("non_compliant") {
            out.append(.nonCompliant)
        }
        // Identity/security risk (lockout or injected) → restrict (SECURITY_RISK_ESCALATION).
        if ctx.lockedOut || ctx.injected.contains("security_risk") {
            out.append(DecisionEngine.Signal("identity.risk_detected"))
        }
        // Remediation verified → allow-after-remediation path.
        if ctx.injected.contains("remediated") {
            out.append(DecisionEngine.Signal("remediation.verified"))
        }
        return out
    }
}

/// Zone pre-gate: a device whose detected zone is unknown or does not match its
/// authorized/expected zone is denied access before the engine runs.
enum LocationGate {
    static func denied(expected: String, detected: String?) -> Bool {
        guard let detected = detected, !detected.isEmpty else { return true }
        return detected != expected
    }
}

/// Composes the location pre-gate with the (local or control-plane) decision
/// service. This is the single entry point the host app uses to resolve a verdict
/// for a session from its live context.
enum AccessDecision {
    static func evaluate(_ ctx: SignalContext.EnvironmentContext,
                         integration: AppWorkflows.AppIntegration,
                         identityRef: String,
                         deviceRef: String,
                         via service: DecisionService) async -> DecisionResult {
        if LocationGate.denied(expected: ctx.expectedZone, detected: ctx.detectedZone) {
            let reason = (ctx.detectedZone?.isEmpty ?? true) ? "ZONE_UNKNOWN" : "ZONE_MISMATCH"
            let detected = ctx.detectedZone?.isEmpty ?? true ? "unknown" : ctx.detectedZone!
            return DecisionResult(
                outcome: .deny,
                reasonCodes: [reason],
                explanation: "Device is outside its authorized zone "
                    + "(expected \(ctx.expectedZone), detected \(detected)) → access denied.",
                source: .onDevice)
        }
        let request = AppDecisionRequest(
            integrationId: integration.id,
            identityRef: identityRef,
            deviceRef: deviceRef,
            localSignals: SignalContext.signals(ctx))
        return await DecisionServiceProvider.evaluateWithFallback(service, request)
    }
}
