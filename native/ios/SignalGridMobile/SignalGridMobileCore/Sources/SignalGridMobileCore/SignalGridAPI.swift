import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public struct APIConfiguration: Hashable, Sendable {
    public let baseURL: URL
    public let bearerToken: String

    public init(baseURL: URL, bearerToken: String) {
        self.baseURL = baseURL
        self.bearerToken = bearerToken
    }
}

public enum SignalGridAPIError: Error, LocalizedError, Equatable, Sendable {
    case invalidURL
    case transport(String)
    case invalidResponse
    case server(statusCode: Int, message: String)
    case decoding(String)

    public var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "The SignalGrid API URL is invalid."
        case .transport(let message):
            return "Network error: \(message)"
        case .invalidResponse:
            return "SignalGrid returned an invalid response."
        case .server(let statusCode, let message):
            return "SignalGrid returned \(statusCode): \(message)"
        case .decoding(let message):
            return "Could not read the SignalGrid response: \(message)"
        }
    }
}

public protocol SignalGridAPI: Sendable {
    func fetchDemoKeys() async throws -> [DemoKey]
    func fetchContext() async throws -> TenantContext
    func fetchMetrics() async throws -> MetricsSummary
    func fetchDecisions() async throws -> [Decision]
    func fetchDecision(id: String) async throws -> Decision
    func fetchEvidence(decisionId: String) async throws -> EvidenceSnapshot
    func evaluate(_ request: EvaluateRequest) async throws -> EvaluateResult

    func startSession(_ request: EvaluateRequest, ttlSeconds: Int) async throws -> SessionStartResult
    func fetchSession(id: String) async throws -> Session
    func refreshSession(id: String, ttlSeconds: Int) async throws -> Session
    func endSession(id: String) async throws -> Session

    func fetchConnectors() async throws -> [Connector]
    func fetchSyncRuns(connectorId: String) async throws -> [ConnectorSyncRun]
    func syncConnector(id: String) async throws -> ConnectorSyncRun
    func fetchFleetPosture() async throws -> FleetPosture

    func fetchPolicies() async throws -> [Policy]
    func fetchPolicyVersions(policyId: String) async throws -> [PolicyVersion]
    func fetchAudit() async throws -> AuditResponse

    func fetchAppIntegrations(vertical: AppVertical?) async throws -> [AppIntegration]
    func evaluateAppWorkflow(_ request: AppWorkflowRequest) async throws -> AppWorkflowEvaluation
}

public actor LiveSignalGridAPI: SignalGridAPI {
    private let configuration: APIConfiguration
    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    public init(configuration: APIConfiguration, session: URLSession = .shared) {
        self.configuration = configuration
        self.session = session
        self.decoder = JSONDecoder()
        self.encoder = JSONEncoder()
    }

    public func fetchDemoKeys() async throws -> [DemoKey] {
        let response: KeysEnvelope = try await request(path: "v1/keys", authenticated: false)
        return response.keys
    }

    public func fetchContext() async throws -> TenantContext {
        let response: ContextEnvelope = try await request(path: "v1/context")
        return TenantContext(principal: response.principal, tenant: response.tenant)
    }

    public func fetchMetrics() async throws -> MetricsSummary {
        let response: MetricsEnvelope = try await request(path: "v1/metrics")
        return response.metrics
    }

    public func fetchFleetPosture() async throws -> FleetPosture {
        // Control-plane route: GET /api/cp/v1/fleet-mdm (Fleet osquery host posture).
        try await request(path: "cp/v1/fleet-mdm")
    }

    public func fetchDecisions() async throws -> [Decision] {
        let response: DecisionsEnvelope = try await request(path: "v1/decisions")
        return response.decisions
    }

    public func fetchDecision(id: String) async throws -> Decision {
        let response: DecisionEnvelope = try await request(path: "v1/decisions/\(escape(id))")
        return response.decision
    }

    public func fetchEvidence(decisionId: String) async throws -> EvidenceSnapshot {
        let response: EvidenceEnvelope = try await request(path: "v1/decisions/\(escape(decisionId))/evidence")
        return response.evidence
    }

    public func evaluate(_ requestBody: EvaluateRequest) async throws -> EvaluateResult {
        let response: EvaluationEnvelope = try await request(
            path: "v1/decisions/evaluate",
            method: "POST",
            body: requestBody
        )
        return response.decision
    }

    public func startSession(_ requestBody: EvaluateRequest, ttlSeconds: Int) async throws -> SessionStartResult {
        let body = SessionStartRequest(
            identityRef: requestBody.identityRef,
            deviceRef: requestBody.deviceRef,
            workflowKey: requestBody.workflowKey,
            requestContext: requestBody.requestContext,
            ttlSeconds: ttlSeconds
        )
        let response: SessionStartEnvelope = try await request(
            path: "v1/sessions/start",
            method: "POST",
            body: body
        )
        return SessionStartResult(session: response.session, decision: response.decision)
    }

    public func fetchSession(id: String) async throws -> Session {
        let response: SessionEnvelope = try await request(path: "v1/sessions/\(escape(id))")
        return response.session
    }

    public func refreshSession(id: String, ttlSeconds: Int) async throws -> Session {
        let response: SessionEnvelope = try await request(
            path: "v1/sessions/\(escape(id))/refresh",
            method: "POST",
            body: TTLRequest(ttlSeconds: ttlSeconds)
        )
        return response.session
    }

    public func endSession(id: String) async throws -> Session {
        let response: SessionEnvelope = try await request(
            path: "v1/sessions/\(escape(id))/end",
            method: "POST",
            body: EmptyBody()
        )
        return response.session
    }

    public func fetchConnectors() async throws -> [Connector] {
        let response: ConnectorsEnvelope = try await request(path: "v1/connectors")
        return response.connectors
    }

    public func fetchSyncRuns(connectorId: String) async throws -> [ConnectorSyncRun] {
        let response: SyncRunsEnvelope = try await request(path: "v1/connectors/\(escape(connectorId))/sync-runs")
        return response.syncRuns
    }

    public func syncConnector(id: String) async throws -> ConnectorSyncRun {
        let response: SyncRunEnvelope = try await request(
            path: "v1/connectors/\(escape(id))/sync",
            method: "POST",
            body: EmptyBody()
        )
        return response.syncRun
    }

    public func fetchPolicies() async throws -> [Policy] {
        let response: PoliciesEnvelope = try await request(path: "v1/policies")
        return response.policies
    }

    public func fetchPolicyVersions(policyId: String) async throws -> [PolicyVersion] {
        let response: PolicyVersionsEnvelope = try await request(path: "v1/policies/\(escape(policyId))/versions")
        return response.versions
    }

    public func fetchAudit() async throws -> AuditResponse {
        let response: AuditEnvelope = try await request(path: "v1/audit")
        return AuditResponse(events: response.events, chain: response.chain)
    }

    public func fetchAppIntegrations(vertical: AppVertical?) async throws -> [AppIntegration] {
        var path = "v1/app-workflows/integrations"
        if let vertical {
            path += "?vertical=\(escape(vertical.rawValue))"
        }
        let response: AppIntegrationsEnvelope = try await request(path: path)
        return response.integrations
    }

    public func evaluateAppWorkflow(_ requestBody: AppWorkflowRequest) async throws -> AppWorkflowEvaluation {
        let response: AppWorkflowEnvelope = try await request(
            path: "v1/app-workflows/evaluate",
            method: "POST",
            body: requestBody
        )
        return AppWorkflowEvaluation(decision: response.decision, plan: response.plan)
    }

    private func request<Response: Decodable>(
        path: String,
        method: String = "GET",
        authenticated: Bool = true
    ) async throws -> Response {
        try await request(path: path, method: method, bodyData: nil, authenticated: authenticated)
    }

    private func request<Response: Decodable, Body: Encodable>(
        path: String,
        method: String,
        body: Body,
        authenticated: Bool = true
    ) async throws -> Response {
        let bodyData: Data
        do {
            bodyData = try encoder.encode(body)
        } catch {
            throw SignalGridAPIError.transport("Could not encode request body: \(error.localizedDescription)")
        }
        return try await request(path: path, method: method, bodyData: bodyData, authenticated: authenticated)
    }

    private func request<Response: Decodable>(
        path: String,
        method: String,
        bodyData: Data?,
        authenticated: Bool
    ) async throws -> Response {
        guard let url = makeURL(path: path) else {
            throw SignalGridAPIError.invalidURL
        }

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = method
        urlRequest.timeoutInterval = 20
        urlRequest.setValue("application/json", forHTTPHeaderField: "Accept")
        urlRequest.setValue(UUID().uuidString, forHTTPHeaderField: "X-Request-ID")
        if let bodyData {
            urlRequest.httpBody = bodyData
            urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if authenticated {
            urlRequest.setValue("Bearer \(configuration.bearerToken)", forHTTPHeaderField: "Authorization")
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: urlRequest)
        } catch {
            throw SignalGridAPIError.transport(error.localizedDescription)
        }

        guard let http = response as? HTTPURLResponse else {
            throw SignalGridAPIError.invalidResponse
        }

        guard (200..<300).contains(http.statusCode) else {
            let message = decodeErrorMessage(data) ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode)
            throw SignalGridAPIError.server(statusCode: http.statusCode, message: message)
        }

        do {
            return try decoder.decode(Response.self, from: data)
        } catch {
            throw SignalGridAPIError.decoding(error.localizedDescription)
        }
    }

    private func makeURL(path: String) -> URL? {
        let normalizedBase = configuration.baseURL.absoluteString.hasSuffix("/")
            ? configuration.baseURL.absoluteString
            : configuration.baseURL.absoluteString + "/"
        return URL(string: path, relativeTo: URL(string: normalizedBase))?.absoluteURL
    }

    private func escape(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? value
    }

    private func decodeErrorMessage(_ data: Data) -> String? {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        if let error = object["error"] as? [String: Any], let message = error["message"] as? String {
            return message
        }
        return object["message"] as? String
    }
}

// MARK: - Response envelopes

private struct KeysEnvelope: Decodable { let keys: [DemoKey] }
private struct ContextEnvelope: Decodable { let principal: Principal; let tenant: Tenant }
private struct MetricsEnvelope: Decodable { let metrics: MetricsSummary }
private struct DecisionsEnvelope: Decodable { let decisions: [Decision]; let total: Int }
private struct DecisionEnvelope: Decodable { let decision: Decision }
private struct EvidenceEnvelope: Decodable { let evidence: EvidenceSnapshot; let verified: Bool }
private struct EvaluationEnvelope: Decodable { let decision: EvaluateResult }
private struct SessionEnvelope: Decodable { let session: Session }
private struct SessionStartEnvelope: Decodable { let session: Session; let decision: EvaluateResult }
private struct ConnectorsEnvelope: Decodable { let connectors: [Connector] }
private struct SyncRunsEnvelope: Decodable { let syncRuns: [ConnectorSyncRun] }
private struct SyncRunEnvelope: Decodable { let syncRun: ConnectorSyncRun }
private struct PoliciesEnvelope: Decodable { let policies: [Policy] }
private struct PolicyVersionsEnvelope: Decodable { let versions: [PolicyVersion] }
private struct AuditEnvelope: Decodable { let events: [AuditEvent]; let chain: AuditChain }
private struct AppIntegrationsEnvelope: Decodable { let integrations: [AppIntegration]; let total: Int }
private struct AppWorkflowEnvelope: Decodable { let decision: EvaluateResult; let plan: AppSessionPlan }

private struct SessionStartRequest: Encodable {
    let identityRef: String
    let deviceRef: String
    let workflowKey: String
    let requestContext: [String: String]?
    let ttlSeconds: Int
}

private struct TTLRequest: Encodable { let ttlSeconds: Int }
private struct EmptyBody: Encodable {}
