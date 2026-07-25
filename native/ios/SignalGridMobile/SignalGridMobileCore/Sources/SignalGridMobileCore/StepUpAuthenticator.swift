import Foundation

// Makes a `step_up` verdict real on the device.
//
// A step_up verdict is only worth anything if something actually asks the person to
// prove they are still there. On Apple platforms that is LocalAuthentication —
// `LAContext.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics)` — which runs Face
// ID or Touch ID inside the Secure Enclave and returns success or failure without the
// app ever seeing biometric data.
//
// The shape here is deliberate. The protocol and the whole decision path are PURE SWIFT
// so they compile and are tested on Linux in CI; only the concrete Apple implementation
// is behind `#if canImport(LocalAuthentication)`. That keeps the logic that decides
// *whether* to challenge — the part that can be wrong in a way that matters —
// verifiable on every platform, while the part that can only run on a device stays
// thin enough to read in one sitting.

/// Why a step-up was requested, so the prompt can say something true and specific.
/// Apple's `localizedReason` is shown to the person verbatim; a vague one ("authenticate
/// to continue") teaches people to approve reflexively, which defeats the control.
public enum StepUpReason: String, Sendable, Equatable {
    case posture = "device posture"
    case custody = "badge custody"
    case privilegedAction = "privileged action"
    case staleSession = "stale session"

    /// The sentence shown in the system biometric prompt.
    public var localizedReason: String {
        switch self {
        case .posture: return "Confirm it's you — this device's security posture changed."
        case .custody: return "Confirm it's you — this shared device's badge custody changed."
        case .privilegedAction: return "Confirm it's you before this high-assurance action."
        case .staleSession: return "Confirm it's you — this session has been idle."
        }
    }
}

public enum StepUpOutcome: Sendable, Equatable {
    /// The person proved presence. The action may proceed.
    case satisfied
    /// The person was asked and did not prove presence (cancelled, failed, locked out).
    case refused(String)
    /// No authenticator is available on this device at all.
    case unavailable(String)
}

/// Anything that can challenge for presence. Injectable so the decision path is
/// testable without a device.
public protocol StepUpAuthenticating: Sendable {
    func challenge(reason: StepUpReason) async -> StepUpOutcome
}

/// Decides whether a verdict requires a presence challenge, and interprets the result.
///
/// The rule is fail-closed and worth stating explicitly: an action is permitted only on
/// `satisfied`. Both `refused` and `unavailable` withhold it. A device with no
/// biometric hardware does not get a free pass — "we could not ask" is not "they
/// answered", which is the same discipline the server-side connectors apply to an
/// unreadable signal.
public struct StepUpGate: Sendable {
    private let authenticator: StepUpAuthenticating

    public init(authenticator: StepUpAuthenticating) {
        self.authenticator = authenticator
    }

    /// Does this outcome require the person to prove presence before proceeding?
    /// `restrict` and `deny` are not step-ups — they are refusals, and challenging for
    /// one would imply the action becomes available if the person authenticates. It
    /// does not.
    public static func requiresChallenge(for outcome: DecisionOutcome) -> Bool {
        outcome == .stepUp
    }

    /// Run the gate for a verdict. Returns nil when no challenge was needed.
    public func evaluate(outcome: DecisionOutcome, reason: StepUpReason) async -> StepUpOutcome? {
        guard StepUpGate.requiresChallenge(for: outcome) else { return nil }
        return await authenticator.challenge(reason: reason)
    }

    /// May the action proceed? Fail-closed: only an explicit `satisfied` permits it.
    public static func permits(_ outcome: StepUpOutcome?) -> Bool {
        switch outcome {
        case .none: return true          // no challenge was required
        case .satisfied: return true
        case .refused, .unavailable: return false
        }
    }
}

#if canImport(LocalAuthentication)
import LocalAuthentication

/// The real Apple implementation. Face ID / Touch ID via the Secure Enclave; biometric
/// data never leaves it and is never visible to this process.
public struct LocalAuthenticationStepUp: StepUpAuthenticating {
    private let policy: LAPolicy

    /// Defaults to biometrics-with-passcode-fallback. A shared clinical device where a
    /// gloved clinician cannot present a face still needs a way through, and the
    /// fallback is a device passcode, not a bypass.
    public init(policy: LAPolicy = .deviceOwnerAuthentication) {
        self.policy = policy
    }

    public func challenge(reason: StepUpReason) async -> StepUpOutcome {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(policy, error: &error) else {
            return .unavailable(error?.localizedDescription ?? "no authenticator available")
        }
        do {
            let ok = try await context.evaluatePolicy(policy, localizedReason: reason.localizedReason)
            return ok ? .satisfied : .refused("not authenticated")
        } catch {
            return .refused(error.localizedDescription)
        }
    }
}
#endif
