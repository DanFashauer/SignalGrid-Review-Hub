import Foundation

/// Abstraction over "where does the Assist verdict come from".
///
/// Two implementations:
///  • `LocalDecisionService` — the on-device `DecisionEngine` port (default; works
///    offline, deterministic, no backend).
///  • `RemoteDecisionService` — the SignalGrid control plane's
///    `POST /v1/app-workflows/evaluate` (artifacts/api-server), which evaluates the
///    real tenant-seeded decision core and returns the plan AS DECIDED.
///
/// The host app resolves a service and treats the result identically; only the
/// `source` differs. This keeps the device backend-ready without changing the flow:
/// a control-plane outcome and an on-device outcome are the same shape.
protocol DecisionService {
    func evaluate(_ request: AppDecisionRequest) async throws -> DecisionResult
}

/// A request carries BOTH the on-device signal context (used by the local engine)
/// and the tenant refs (used by the control plane), so either service can answer it.
struct AppDecisionRequest {
    let integrationId: String
    let identityRef: String
    let deviceRef: String
    let localSignals: [DecisionEngine.Signal]
}

enum DecisionSource: String {
    case onDevice = "on-device"
    case controlPlane = "control-plane"
}

struct DecisionResult {
    let outcome: AppWorkflows.DecisionOutcome
    let reasonCodes: [String]
    let explanation: String
    let source: DecisionSource
}

enum DecisionServiceError: Error, Equatable {
    case invalidResponse
    case http(Int)
    case unknownOutcome(String)
}

/// On-device: the deterministic engine port. Always available.
struct LocalDecisionService: DecisionService {
    func evaluate(_ request: AppDecisionRequest) async throws -> DecisionResult {
        let r = DecisionEngine.evaluate(request.localSignals)
        return DecisionResult(outcome: r.outcome, reasonCodes: r.reasonCodes,
                              explanation: r.explanation, source: .onDevice)
    }
}

/// Control plane: calls the real api-server decision endpoint.
struct RemoteDecisionService: DecisionService {
    let baseURL: URL
    let bearerToken: String
    let session: URLSession

    init(baseURL: URL, bearerToken: String, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.bearerToken = bearerToken
        self.session = session
    }

    private struct Envelope: Decodable {
        struct Decision: Decodable { let outcome: String; let reasonCodes: [String]; let explanation: String? }
        struct Plan: Decodable { let outcome: String; let mode: String? }
        let decision: Decision
        let plan: Plan
    }

    func evaluate(_ request: AppDecisionRequest) async throws -> DecisionResult {
        var req = URLRequest(url: baseURL.appendingPathComponent("v1/app-workflows/evaluate"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
        req.httpBody = try JSONSerialization.data(withJSONObject: [
            "integrationId": request.integrationId,
            "identityRef": request.identityRef,
            "deviceRef": request.deviceRef,
        ])

        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw DecisionServiceError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else { throw DecisionServiceError.http(http.statusCode) }

        let env = try JSONDecoder().decode(Envelope.self, from: data)
        // The plan's outcome is the gate outcome AS DECIDED by the core.
        guard let outcome = AppWorkflows.DecisionOutcome(rawValue: env.plan.outcome)
            ?? AppWorkflows.DecisionOutcome(rawValue: env.decision.outcome) else {
            throw DecisionServiceError.unknownOutcome(env.plan.outcome)
        }
        return DecisionResult(outcome: outcome, reasonCodes: env.decision.reasonCodes,
                              explanation: env.decision.explanation ?? "", source: .controlPlane)
    }
}

/// Resolves the active service. Control plane when a backend URL + token are
/// configured; otherwise the on-device engine. A remote failure falls back to
/// on-device so the device keeps working if the control plane is unreachable.
enum DecisionServiceProvider {
    static func resolve(backendURL: URL?, bearerToken: String?) -> DecisionService {
        if let url = backendURL, let token = bearerToken, !token.isEmpty {
            return RemoteDecisionService(baseURL: url, bearerToken: token)
        }
        return LocalDecisionService()
    }

    /// Evaluate with fallback to on-device on any remote error — CLAMPED (review
    /// finding). When a configured decision service is unreachable, rejects the token,
    /// or returns garbage, the authoritative tenant policy supplied NO approval; local
    /// signals may inform the fallback but must never be MORE permissive than the
    /// authority that didn't answer. A local `allow` is therefore held as `step_up`;
    /// a local restrict/deny (more restrictive) stands as-is.
    /// Severity rank on the gate ladder, for the local-risk clamp below.
    private static func rank(_ o: AppWorkflows.DecisionOutcome) -> Int {
        switch o {
        case .allow: return 0
        case .step_up: return 1
        case .restrict: return 2
        case .deny: return 3
        }
    }

    static func evaluateWithFallback(_ service: DecisionService,
                                     _ request: AppDecisionRequest) async -> DecisionResult {
        do {
            let remote = try await service.evaluate(request)
            // Clamp with the LOCAL risk verdict (review finding): the control-plane
            // request does not carry request.localSignals, so newly detected screen
            // capture, session staleness, or lockout would be invisible to a healthy
            // seeded remote actor and its `allow` would keep elevated actions
            // automatic. The remote answer may TIGHTEN the local one but never relax
            // it: the effective outcome is the worse of the two.
            guard remote.source == .controlPlane,
                  let local = try? await LocalDecisionService().evaluate(request),
                  rank(local.outcome) > rank(remote.outcome) else {
                return remote
            }
            return DecisionResult(
                outcome: local.outcome,
                reasonCodes: remote.reasonCodes + local.reasonCodes + ["LOCAL_RISK_CLAMP"],
                explanation: "The control plane answered \(remote.outcome), but on-device signals require \(local.outcome) — the stricter verdict applies.",
                source: .controlPlane)
        } catch {
            let local = (try? await LocalDecisionService().evaluate(request))
                ?? DecisionResult(outcome: .step_up, reasonCodes: ["FALLBACK_FAIL_CLOSED"],
                                  explanation: "Fell back to a fail-closed default.", source: .onDevice)
            if local.outcome == .allow {
                return DecisionResult(outcome: .step_up,
                                      reasonCodes: local.reasonCodes + ["REMOTE_UNAVAILABLE_STEP_UP"],
                                      explanation: "The configured decision service did not answer; local signals are healthy, but an allow requires the tenant authority — held for step-up.",
                                      source: .onDevice)
            }
            return local
        }
    }
}
