import Foundation
import Observation
import SignalGridMobileCore

@MainActor
@Observable
final class AppModel {
    enum ConnectionMode: String, CaseIterable, Identifiable {
        case demo
        case live

        var id: String { rawValue }
        var title: String { self == .demo ? "Offline demo" : "Live API" }
    }

    var mode: ConnectionMode = .demo
    var context: TenantContext?
    var metrics: MetricsSummary?
    var decisions: [Decision] = []
    var connectors: [Connector] = []
    var policies: [Policy] = []
    var fleetPosture: FleetPosture?
    var audit: AuditResponse?
    var appIntegrations: [AppIntegration] = []
    var activeSession: Session?
    var lastEvaluation: EvaluateResult?
    var lastAppEvaluation: AppWorkflowEvaluation?
    var isLoading = false
    var isEvaluating = false
    var errorMessage: String?
    var lastRefresh: Date?
    var baseURLText: String
    var tokenPresent = false

    @ObservationIgnored private var api: any SignalGridAPI
    @ObservationIgnored private let keychain = KeychainStore()
    @ObservationIgnored private let defaults = UserDefaults.standard
    @ObservationIgnored private var evidenceCache: [String: EvidenceSnapshot] = [:]

    init() {
        self.api = MockSignalGridAPI()
        self.baseURLText = UserDefaults.standard.string(forKey: "signalgrid.baseURL")
            // Loopback default for the local dev/demo control plane only — the same
            // exemption the insecure_url rule already grants the "localhost" spelling.
            // Any non-loopback base URL must be HTTPS; the rule still enforces that.
            // swiftlint:disable:next insecure_url
            ?? "http://127.0.0.1:5174/api"
        self.tokenPresent = KeychainStore().load() != nil
    }

    var isLive: Bool { mode == .live }

    func bootstrap() async {
        guard !isLoading else { return }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            async let contextValue = api.fetchContext()
            async let metricsValue = api.fetchMetrics()
            async let decisionsValue = api.fetchDecisions()
            async let connectorsValue = api.fetchConnectors()
            async let policiesValue = api.fetchPolicies()
            async let auditValue = api.fetchAudit()
            async let integrationsValue = api.fetchAppIntegrations(vertical: nil)

            context = try await contextValue
            metrics = try await metricsValue
            decisions = try await decisionsValue
            connectors = try await connectorsValue
            policies = try await policiesValue
            audit = try await auditValue
            appIntegrations = try await integrationsValue
            // Fleet (open-source MDM) posture via the control plane — non-fatal.
            fleetPosture = try? await api.fetchFleetPosture()
            lastRefresh = Date()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func refresh() async {
        await bootstrap()
    }

    /// Startup entry point. The `-LiveBaseURL <url> -LiveToken <token>` launch-arg
    /// live connect is a SIMULATOR-ONLY convenience (Settings can't be typed into
    /// via simctl) and is compiled out of device builds entirely: this public
    /// Review-Hub app must never be launch-arg-pointed at a live endpoint on a real
    /// device. The Settings-driven `connectLive()` path (Keychain-backed, signed
    /// builds) remains the only live route off-simulator.
    func startup() async {
        #if targetEnvironment(simulator)
        let d = UserDefaults.standard
        if let base = d.string(forKey: "LiveBaseURL"), !base.isEmpty,
           let token = d.string(forKey: "LiveToken"), !token.isEmpty,
           let url = URL(string: base) {
            // Launch-arg live connect for demos. Use the token IN-MEMORY only — an
            // unsigned simulator build has no Keychain entitlement (errSecMissingEntitlement
            // -34018), so connectLive()'s keychain.save() would fail. The Settings-driven
            // path still persists to Keychain on a signed build.
            defaults.set(base, forKey: "signalgrid.baseURL")
            baseURLText = base
            tokenPresent = true
            mode = .live
            api = LiveSignalGridAPI(configuration: APIConfiguration(baseURL: url, bearerToken: token))
            await bootstrap()
            return
        }
        #endif
        await bootstrap()
    }

    func useDemoMode() async {
        mode = .demo
        api = MockSignalGridAPI()
        activeSession = nil
        lastEvaluation = nil
        lastAppEvaluation = nil
        evidenceCache.removeAll()
        await bootstrap()
    }

    func connectLive(baseURL: String, token: String) async -> Bool {
        guard let url = URL(string: baseURL), !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            errorMessage = "Enter a valid API base URL and bearer token."
            return false
        }

        do {
            try keychain.save(token: token)
        } catch {
            errorMessage = error.localizedDescription
            return false
        }

        defaults.set(baseURL, forKey: "signalgrid.baseURL")
        baseURLText = baseURL
        tokenPresent = true
        mode = .live
        api = LiveSignalGridAPI(configuration: APIConfiguration(baseURL: url, bearerToken: token))
        await bootstrap()
        return errorMessage == nil
    }

    func reconnectSavedLiveMode() async -> Bool {
        guard let token = keychain.load(), let url = URL(string: baseURLText) else {
            errorMessage = "No saved live API token is available."
            return false
        }
        mode = .live
        api = LiveSignalGridAPI(configuration: APIConfiguration(baseURL: url, bearerToken: token))
        await bootstrap()
        return errorMessage == nil
    }

    func forgetLiveCredentials() async {
        keychain.delete()
        tokenPresent = false
        await useDemoMode()
    }

    func evaluate(scenario: TrustScenario) async {
        guard !isEvaluating else { return }
        isEvaluating = true
        errorMessage = nil
        defer { isEvaluating = false }

        do {
            let result = try await api.evaluate(
                EvaluateRequest(
                    identityRef: scenario.identityRef,
                    deviceRef: scenario.deviceRef,
                    workflowKey: scenario.workflowKey,
                    requestContext: [
                        "surface": "signalgrid-ios-operator",
                        "scenario": scenario.id
                    ]
                )
            )
            lastEvaluation = result
            decisions = try await api.fetchDecisions()
            metrics = try await api.fetchMetrics()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func evaluateApp(integration: AppIntegration, scenario: TrustScenario) async {
        guard !isEvaluating else { return }
        isEvaluating = true
        errorMessage = nil
        defer { isEvaluating = false }

        do {
            let result = try await api.evaluateAppWorkflow(
                AppWorkflowRequest(
                    integrationId: integration.id,
                    identityRef: scenario.identityRef,
                    deviceRef: scenario.deviceRef,
                    requestContext: [
                        "surface": "signalgrid-ios-operator",
                        "vertical": integration.vertical.rawValue
                    ]
                )
            )
            lastAppEvaluation = result
            lastEvaluation = result.decision
            decisions = try await api.fetchDecisions()
            metrics = try await api.fetchMetrics()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func startSession(scenario: TrustScenario) async {
        guard !isEvaluating else { return }
        isEvaluating = true
        errorMessage = nil
        defer { isEvaluating = false }

        do {
            let started = try await api.startSession(
                EvaluateRequest(
                    identityRef: scenario.identityRef,
                    deviceRef: scenario.deviceRef,
                    workflowKey: scenario.workflowKey,
                    requestContext: ["surface": "signalgrid-ios-operator"]
                ),
                ttlSeconds: 900
            )
            activeSession = started.session
            lastEvaluation = started.decision
            decisions = try await api.fetchDecisions()
            metrics = try await api.fetchMetrics()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func refreshSession() async {
        guard let activeSession else { return }
        do {
            self.activeSession = try await api.refreshSession(id: activeSession.id, ttlSeconds: 900)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func endSession() async {
        guard let activeSession else { return }
        do {
            self.activeSession = try await api.endSession(id: activeSession.id)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func evidence(for decision: Decision) async -> EvidenceSnapshot? {
        if let cached = evidenceCache[decision.id] {
            return cached
        }
        do {
            let value = try await api.fetchEvidence(decisionId: decision.id)
            evidenceCache[decision.id] = value
            return value
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func sync(connector: Connector) async {
        do {
            _ = try await api.syncConnector(id: connector.id)
            connectors = try await api.fetchConnectors()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func versions(for policy: Policy) async -> [PolicyVersion] {
        do {
            return try await api.fetchPolicyVersions(policyId: policy.id)
        } catch {
            errorMessage = error.localizedDescription
            return []
        }
    }
}
