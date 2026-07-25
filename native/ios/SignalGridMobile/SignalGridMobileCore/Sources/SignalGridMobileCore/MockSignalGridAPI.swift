import Foundation

public actor MockSignalGridAPI: SignalGridAPI {
    private var decisions: [Decision]
    private var sessions: [String: Session] = [:]
    private var connectors: [Connector] = DemoFixtures.connectors
    private var syncRuns: [String: [ConnectorSyncRun]] = [:]
    private var evaluationSequence = 100
    private var sessionSequence = 1

    public init() {
        self.decisions = Self.seedDecisions()
        for connector in DemoFixtures.connectors {
            syncRuns[connector.id] = [
                ConnectorSyncRun(
                    id: "sync_\(connector.id)_1",
                    tenantId: DemoFixtures.tenant.id,
                    connectorId: connector.id,
                    startedAt: "2026-07-13T14:54:00.000Z",
                    completedAt: "2026-07-13T14:55:00.000Z",
                    status: connector.status == .degraded ? "partial" : "success",
                    recordsProcessed: 12,
                    signalsNormalized: 48,
                    note: "Deterministic public-safe fixture sync."
                )
            ]
        }
    }

    public func fetchDemoKeys() async throws -> [DemoKey] { DemoFixtures.keys }

    public func fetchContext() async throws -> TenantContext {
        TenantContext(principal: DemoFixtures.principal, tenant: DemoFixtures.tenant)
    }

    public func fetchMetrics() async throws -> MetricsSummary {
        let counts = Dictionary(grouping: decisions, by: \.outcome).mapValues(\.count)
        let total = decisions.count
        let allow = counts[.allow] ?? 0
        let restrictDeny = (counts[.restrict] ?? 0) + (counts[.deny] ?? 0)
        let latencies = decisions.map(\.latencyMs).sorted()
        let average = latencies.isEmpty ? 0 : Double(latencies.reduce(0, +)) / Double(latencies.count)
        let p95Index = max(0, min(latencies.count - 1, Int((Double(latencies.count) * 0.95).rounded(.up)) - 1))
        let p95 = latencies.isEmpty ? 0 : Double(latencies[p95Index])

        return MetricsSummary(
            totalDecisions: total,
            byOutcome: Dictionary(uniqueKeysWithValues: DecisionOutcome.allCases.map { ($0.rawValue, counts[$0] ?? 0) }),
            allowRate: total == 0 ? 0 : Double(allow) / Double(total),
            restrictDenyRate: total == 0 ? 0 : Double(restrictDeny) / Double(total),
            avgLatencyMs: average,
            p95LatencyMs: p95,
            decisionsWithPolicyVersion: total,
            decisionsWithEvidence: total,
            pendingReview: decisions.filter { $0.reviewStatus == .pendingReview }.count
        )
    }

    public func fetchDecisions() async throws -> [Decision] {
        decisions.sorted { $0.createdAt > $1.createdAt }
    }

    public func fetchDecision(id: String) async throws -> Decision {
        guard let decision = decisions.first(where: { $0.id == id }) else {
            throw SignalGridAPIError.server(statusCode: 404, message: "Decision not found")
        }
        return decision
    }

    public func fetchEvidence(decisionId: String) async throws -> EvidenceSnapshot {
        let decision = try await fetchDecision(id: decisionId)
        return Self.evidenceSnapshot(for: decision)
    }

    public func evaluate(_ request: EvaluateRequest) async throws -> EvaluateResult {
        let verdict = Self.verdict(for: request)
        evaluationSequence += 1
        let createdAt = String(format: "2026-07-13T15:%02d:00.000Z", evaluationSequence % 60)
        let id = "dec_demo_\(evaluationSequence)"
        let rule = MatchedRule(
            ruleId: verdict.ruleId,
            reasonCode: verdict.reasonCode,
            outcome: verdict.outcome,
            severity: verdict.severity
        )
        let decision = Decision(
            id: id,
            tenantId: DemoFixtures.tenant.id,
            identityId: "id_\(request.identityRef.replacingOccurrences(of: ".", with: "_"))",
            deviceId: "dev_\(request.deviceRef.replacingOccurrences(of: "-", with: "_"))",
            workflowId: "wf_\(request.workflowKey)",
            outcome: verdict.outcome,
            policyId: DemoFixtures.policies[0].id,
            policyVersionId: DemoFixtures.policyVersions[0].id,
            policyVersion: 1,
            matchedRules: [rule],
            reasonCodes: [verdict.reasonCode],
            signalIds: ["sig_identity", "sig_device", "sig_freshness", "sig_custody"],
            evidenceSnapshotId: "ev_\(id)",
            requestContext: request.requestContext ?? [:],
            latencyMs: 7 + (evaluationSequence % 17),
            createdAt: createdAt,
            reviewStatus: verdict.outcome == .allow ? .notRequired : .pendingReview,
            reviewable: verdict.outcome != .allow,
            explanation: verdict.explanation
        )
        decisions.append(decision)
        return Self.result(from: decision)
    }

    public func startSession(_ request: EvaluateRequest, ttlSeconds: Int) async throws -> SessionStartResult {
        let decision = try await evaluate(request)
        let id = "sess_demo_\(sessionSequence)"
        sessionSequence += 1
        let session = Session(
            id: id,
            tenantId: DemoFixtures.tenant.id,
            identityRef: request.identityRef,
            deviceRef: request.deviceRef,
            workflowKey: request.workflowKey,
            status: .active,
            outcome: decision.outcome,
            decisionId: decision.decisionId,
            createdAt: "2026-07-13T15:00:00.000Z",
            lastSeenAt: "2026-07-13T15:00:00.000Z",
            expiresAt: "2026-07-13T15:15:00.000Z"
        )
        sessions[id] = session
        return SessionStartResult(session: session, decision: decision)
    }

    public func fetchSession(id: String) async throws -> Session {
        guard let session = sessions[id] else {
            throw SignalGridAPIError.server(statusCode: 404, message: "Session not found")
        }
        return session
    }

    public func refreshSession(id: String, ttlSeconds: Int) async throws -> Session {
        guard let old = sessions[id] else {
            throw SignalGridAPIError.server(statusCode: 404, message: "Session not found")
        }
        let refreshed = Session(
            id: old.id,
            tenantId: old.tenantId,
            identityRef: old.identityRef,
            deviceRef: old.deviceRef,
            workflowKey: old.workflowKey,
            status: .active,
            outcome: old.outcome,
            decisionId: old.decisionId,
            createdAt: old.createdAt,
            lastSeenAt: "2026-07-13T15:05:00.000Z",
            expiresAt: "2026-07-13T15:20:00.000Z"
        )
        sessions[id] = refreshed
        return refreshed
    }

    public func endSession(id: String) async throws -> Session {
        guard let old = sessions[id] else {
            throw SignalGridAPIError.server(statusCode: 404, message: "Session not found")
        }
        let ended = Session(
            id: old.id,
            tenantId: old.tenantId,
            identityRef: old.identityRef,
            deviceRef: old.deviceRef,
            workflowKey: old.workflowKey,
            status: .ended,
            outcome: old.outcome,
            decisionId: old.decisionId,
            createdAt: old.createdAt,
            lastSeenAt: "2026-07-13T15:07:00.000Z",
            expiresAt: old.expiresAt
        )
        sessions[id] = ended
        return ended
    }

    public func fetchConnectors() async throws -> [Connector] { connectors }

    public func fetchFleetPosture() async throws -> FleetPosture {
        FleetPosture(
            observedAt: "2026-07-16T14:00:00.000Z",
            summary: FleetPostureSummary(hosts: 3, managed: 3, enforceable: 2, diskEncrypted: 2, nonCompliant: 1, raiseStepUp: 2),
            signals: [
                FleetPostureHost(hostRef: "ipad-ward-01", deviceManaged: true, deviceCompliance: "compliant", baselineCompliance: "aligned", postureFreshness: "fresh", enforceable: true, assurance: "standard", rationale: "Fleet posture healthy — enrolled, supervised, encrypted, fresh"),
                FleetPostureHost(hostRef: "ipad-ward-02", deviceManaged: true, deviceCompliance: "non_compliant", baselineCompliance: "drifted", postureFreshness: "fresh", enforceable: true, assurance: "raise_step_up", rationale: "disk encryption off"),
                FleetPostureHost(hostRef: "ipad-byod-01", deviceManaged: true, deviceCompliance: "compliant", baselineCompliance: "aligned", postureFreshness: "fresh", enforceable: false, assurance: "raise_step_up", rationale: "unsupervised (kiosk/allowlist/non-removable cannot engage)"),
            ])
    }

    public func fetchSyncRuns(connectorId: String) async throws -> [ConnectorSyncRun] {
        syncRuns[connectorId] ?? []
    }

    public func syncConnector(id: String) async throws -> ConnectorSyncRun {
        guard let index = connectors.firstIndex(where: { $0.id == id }) else {
            throw SignalGridAPIError.server(statusCode: 404, message: "Connector not found")
        }
        let run = ConnectorSyncRun(
            id: "sync_\(id)_\((syncRuns[id]?.count ?? 0) + 1)",
            tenantId: DemoFixtures.tenant.id,
            connectorId: id,
            startedAt: "2026-07-13T15:09:00.000Z",
            completedAt: "2026-07-13T15:09:01.000Z",
            status: "success",
            recordsProcessed: 12,
            signalsNormalized: 48,
            note: "Deterministic fixture replay completed. No live vendor call was made."
        )
        syncRuns[id, default: []].insert(run, at: 0)
        let old = connectors[index]
        connectors[index] = Connector(
            id: old.id,
            tenantId: old.tenantId,
            kind: old.kind,
            mode: old.mode,
            ingestionMode: old.ingestionMode,
            permissionScope: old.permissionScope,
            credentialRef: old.credentialRef,
            status: .healthy,
            lastSyncAt: run.completedAt
        )
        return run
    }

    public func fetchPolicies() async throws -> [Policy] { DemoFixtures.policies }

    public func fetchPolicyVersions(policyId: String) async throws -> [PolicyVersion] {
        DemoFixtures.policyVersions.filter { $0.policyId == policyId }
    }

    public func fetchAudit() async throws -> AuditResponse {
        let events = decisions.sorted { $0.createdAt < $1.createdAt }.enumerated().map { index, decision in
            AuditEvent(
                id: "audit_\(index + 1)",
                tenantId: DemoFixtures.tenant.id,
                sequence: index + 1,
                type: "decision.evaluated",
                actor: "demo:operator",
                subject: decision.id,
                summary: "Decision \(decision.outcome.rawValue) recorded for \(decision.identityId).",
                references: [decision.id, decision.evidenceSnapshotId, decision.policyVersionId],
                recordedAt: decision.createdAt,
                previousDigest: index == 0 ? "GENESIS" : "sha256:audit-\(index)",
                digest: "sha256:audit-\(index + 1)"
            )
        }
        return AuditResponse(
            events: events,
            chain: AuditChain(valid: true, eventCount: events.count, firstInvalidSequence: nil)
        )
    }

    public func fetchAppIntegrations(vertical: AppVertical?) async throws -> [AppIntegration] {
        DemoFixtures.integrations.filter { vertical == nil || $0.vertical == vertical }
    }

    public func evaluateAppWorkflow(_ request: AppWorkflowRequest) async throws -> AppWorkflowEvaluation {
        guard let integration = DemoFixtures.integrations.first(where: { $0.id == request.integrationId }) else {
            throw SignalGridAPIError.server(statusCode: 404, message: "App integration not found")
        }
        let decision = try await evaluate(
            EvaluateRequest(
                identityRef: request.identityRef,
                deviceRef: request.deviceRef,
                workflowKey: integration.workflowKey,
                requestContext: request.requestContext
            )
        )
        let actions = integration.actions.map { action in
            Self.plan(action: action, outcome: decision.outcome, reasonCode: decision.reasonCodes.first ?? "UNKNOWN")
        }
        let mode: AppSessionMode
        switch decision.outcome {
        case .allow: mode = actions.contains(where: { $0.disposition == .assist }) ? .assist : .proceed
        case .stepUp: mode = .stepUp
        case .restrict: mode = .hold
        case .deny: mode = .deny
        }
        let summary: String
        switch mode {
        case .proceed: summary = "\(integration.name): trusted — all actions available."
        case .assist: summary = "\(integration.name): available; sensitive actions await confirmation."
        case .stepUp: summary = "\(integration.name): high-assurance actions held pending native step-up."
        case .hold: summary = "\(integration.name): limited — only low-risk actions permitted."
        case .deny: summary = "\(integration.name): denied; no action available."
        }
        return AppWorkflowEvaluation(
            decision: decision,
            plan: AppSessionPlan(
                integrationId: integration.id,
                integrationName: integration.name,
                outcome: decision.outcome,
                mode: mode,
                summary: summary,
                actions: actions
            )
        )
    }

    // MARK: - Helpers

    private static func verdict(for request: EvaluateRequest) -> Verdict {
        let identity = request.identityRef.lowercased()
        let device = request.deviceRef.lowercased()

        if identity.contains("disabled") {
            return Verdict(.deny, "IDENTITY_DISABLED", "identity-disabled", .critical, "The identity is disabled in the source identity system, so the workflow is denied.")
        }
        if identity.contains("badge_forced") {
            return Verdict(.deny, "BADGE_FORCED_REMOVAL", "badge-forced-removal", .critical, "A forced credential removal signal is present; the session fails closed.")
        }
        if identity.contains("noncompliant") || device.contains("ward-02") {
            return Verdict(.restrict, "DEVICE_NONCOMPLIANT", "device-noncompliant", .high, "The shared device is managed but does not meet its assigned compliance policy.")
        }
        if identity.contains("unmanaged") || device.contains("byod") {
            return Verdict(.restrict, "DEVICE_UNMANAGED", "device-unmanaged", .high, "The device is outside the required management authority for this workflow.")
        }
        if identity.contains("nosync") {
            return Verdict(.restrict, "POSTURE_MISSING", "posture-missing", .high, "Critical device posture is missing; SignalGrid does not fabricate an allow.")
        }
        if identity.contains("badge_removed") {
            return Verdict(.restrict, "BADGE_REMOVED", "badge-removed", .high, "The assigned badge is no longer bound to the shared device.")
        }
        if identity.contains("overdue") {
            return Verdict(.restrict, "CUSTODY_OVERDUE", "custody-overdue", .high, "The shared device is overdue in the custody system.")
        }
        if identity.contains("stale") {
            return Verdict(.stepUp, "POSTURE_STALE", "posture-stale", .medium, "Device posture is stale, so higher-assurance actions require a native step-up.")
        }
        if identity.contains("baseline_drift") {
            return Verdict(.stepUp, "BASELINE_DRIFTED", "baseline-drifted", .medium, "The device has drifted from its security baseline; a step-up is required.")
        }
        return Verdict(.allow, "TRUST_ESTABLISHED", "trust-established", .low, "Identity, device posture, custody context, and policy requirements are satisfied.")
    }

    private static func plan(action: AppAction, outcome: DecisionOutcome, reasonCode: String) -> AppActionPlan {
        let disposition: AppActionDisposition
        let requiresConfirmation: Bool
        let reason: String

        switch outcome {
        case .deny:
            disposition = .blocked
            requiresConfirmation = false
            reason = "Denied — \(reasonCode)"
        case .restrict:
            if action.gatedByStepUp || action.sensitive {
                disposition = .blocked
                requiresConfirmation = false
                reason = "Restricted — \(reasonCode)"
            } else {
                disposition = .auto
                requiresConfirmation = false
                reason = "Low-risk action permitted under restriction"
            }
        case .stepUp:
            if action.gatedByStepUp || action.sensitive {
                disposition = .stepUp
                requiresConfirmation = true
                reason = "Held for native step-up — \(reasonCode)"
            } else {
                disposition = .auto
                requiresConfirmation = false
                reason = "Low-risk action permitted pending step-up"
            }
        case .allow:
            if action.sensitive {
                disposition = .assist
                requiresConfirmation = true
                reason = "Prepared — requires in-app human confirmation"
            } else {
                disposition = .auto
                requiresConfirmation = false
                reason = "Trusted — performed automatically"
            }
        }

        return AppActionPlan(
            key: action.key,
            label: action.label,
            riskTier: action.riskTier,
            sensitive: action.sensitive,
            disposition: disposition,
            requiresConfirmation: requiresConfirmation,
            reason: reason
        )
    }

    private static func result(from decision: Decision) -> EvaluateResult {
        EvaluateResult(
            decisionId: decision.id,
            outcome: decision.outcome,
            reasonCodes: decision.reasonCodes,
            policyId: decision.policyId,
            policyVersion: decision.policyVersion,
            policyVersionId: decision.policyVersionId,
            evidenceSnapshotId: decision.evidenceSnapshotId,
            matchedRules: decision.matchedRules,
            reviewable: decision.reviewable,
            latencyMs: decision.latencyMs,
            explanation: decision.explanation
        )
    }

    private static func evidenceSnapshot(for decision: Decision) -> EvidenceSnapshot {
        let reason = decision.reasonCodes.first ?? "TRUST_ESTABLISHED"
        let evidence = DecisionEvidence(
            identityEnabled: reason == "IDENTITY_DISABLED" ? .value(false) : .value(true),
            deviceManaged: reason == "DEVICE_UNMANAGED" ? .value(false) : .value(true),
            deviceCompliance: reason == "DEVICE_NONCOMPLIANT" ? .nonCompliant : .compliant,
            deviceEncrypted: .value(true),
            osSupported: .value(true),
            ownerType: reason == "DEVICE_UNMANAGED" ? "personal" : "shared",
            postureFreshness: reason == "POSTURE_STALE" ? .stale : (reason == "POSTURE_MISSING" ? .missing : .fresh),
            workflowRiskTier: "elevated",
            custodyState: reason == "CUSTODY_OVERDUE" ? "overdue" : "checked_out",
            dockChargeState: "charged",
            tamperState: reason == "BADGE_FORCED_REMOVAL" ? "confirmed" : "none",
            dockState: "occupied",
            baselineCompliance: reason == "BASELINE_DRIFTED" ? "drifted" : "aligned",
            badgeBinding: reason == "BADGE_REMOVED" ? "removed" : (reason == "BADGE_FORCED_REMOVAL" ? "forced" : "present"),
            criticalSignalsPresent: !["IDENTITY_DISABLED", "POSTURE_MISSING"].contains(reason)
        )
        let signals = [
            NormalizedSignal(
                id: "sig_\(decision.id)_identity",
                tenantId: decision.tenantId,
                connectorId: "conn_northwind_ms",
                subjectType: "identity",
                subjectId: decision.identityId,
                category: "identity_state",
                value: .string(evidence.identityEnabled.displayText.lowercased()),
                observedAt: decision.createdAt,
                freshness: .fresh,
                sourceReference: "fixture:entra:identity"
            ),
            NormalizedSignal(
                id: "sig_\(decision.id)_compliance",
                tenantId: decision.tenantId,
                connectorId: "conn_northwind_ms",
                subjectType: "device",
                subjectId: decision.deviceId,
                category: "device_compliance",
                value: .string(evidence.deviceCompliance.rawValue),
                observedAt: decision.createdAt,
                freshness: evidence.postureFreshness,
                sourceReference: "fixture:intune:managedDevices"
            ),
            NormalizedSignal(
                id: "sig_\(decision.id)_badge",
                tenantId: decision.tenantId,
                connectorId: "conn_northwind_dockbridge",
                subjectType: "device",
                subjectId: decision.deviceId,
                category: "badge_binding",
                value: .string(evidence.badgeBinding),
                observedAt: decision.createdAt,
                freshness: .fresh,
                sourceReference: "fixture:credential-reader"
            )
        ]
        return EvidenceSnapshot(
            id: decision.evidenceSnapshotId,
            tenantId: decision.tenantId,
            decisionId: decision.id,
            capturedAt: decision.createdAt,
            evidence: evidence,
            signalsUsed: signals,
            policyVersionId: decision.policyVersionId,
            policyVersion: decision.policyVersion,
            sourceReferences: signals.map(\.sourceReference),
            digest: "sha256:\(decision.id)-evidence-demo"
        )
    }

    private static func seedDecisions() -> [Decision] {
        let seed: [(String, String, String, DecisionOutcome, String, Severity, String)] = [
            ("nurse.compliant", "ipad-ward-01", "clinical-session", .allow, "TRUST_ESTABLISHED", .low, "Identity, device, and workflow trust requirements are satisfied."),
            ("nurse.stale", "ipad-ward-03", "clinical-session", .stepUp, "POSTURE_STALE", .medium, "Stale posture requires native step-up for high-assurance actions."),
            ("nurse.noncompliant", "ipad-ward-02", "clinical-session", .restrict, "DEVICE_NONCOMPLIANT", .high, "Non-compliant device is limited to low-risk actions."),
            ("nurse.disabled", "ipad-ward-04", "clinical-session", .deny, "IDENTITY_DISABLED", .critical, "Disabled identity is denied."),
            ("nurse.badge_removed", "ipad-badge-01", "clinical-session", .restrict, "BADGE_REMOVED", .high, "Badge binding was removed from the shared device."),
            ("nurse.baseline_drift", "ipad-ward-06", "clinical-session", .stepUp, "BASELINE_DRIFTED", .medium, "Baseline drift requires additional verification.")
        ]

        return seed.enumerated().map { index, item in
            let (identity, device, workflow, outcome, reason, severity, explanation) = item
            return Decision(
                id: "dec_seed_\(index + 1)",
                tenantId: DemoFixtures.tenant.id,
                identityId: "id_\(identity.replacingOccurrences(of: ".", with: "_"))",
                deviceId: "dev_\(device.replacingOccurrences(of: "-", with: "_"))",
                workflowId: "wf_\(workflow)",
                outcome: outcome,
                policyId: DemoFixtures.policies[0].id,
                policyVersionId: DemoFixtures.policyVersions[0].id,
                policyVersion: 1,
                matchedRules: [MatchedRule(ruleId: reason.lowercased(), reasonCode: reason, outcome: outcome, severity: severity)],
                reasonCodes: [reason],
                signalIds: ["sig_1", "sig_2", "sig_3"],
                evidenceSnapshotId: "ev_seed_\(index + 1)",
                requestContext: ["surface": "ios-operator-demo"],
                latencyMs: 8 + index * 3,
                createdAt: String(format: "2026-07-13T14:%02d:00.000Z", 58 - index * 4),
                reviewStatus: outcome == .allow ? .notRequired : .pendingReview,
                reviewable: outcome != .allow,
                explanation: explanation
            )
        }
    }
}

private struct Verdict: Sendable {
    let outcome: DecisionOutcome
    let reasonCode: String
    let ruleId: String
    let severity: Severity
    let explanation: String

    init(_ outcome: DecisionOutcome, _ reasonCode: String, _ ruleId: String, _ severity: Severity, _ explanation: String) {
        self.outcome = outcome
        self.reasonCode = reasonCode
        self.ruleId = ruleId
        self.severity = severity
        self.explanation = explanation
    }
}
