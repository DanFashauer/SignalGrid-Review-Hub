import Foundation

// MARK: - Shared JSON

public enum JSONValue: Codable, Hashable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Unsupported JSON value"
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }

    public var displayText: String {
        switch self {
        case .string(let value): return value
        case .number(let value):
            return value.rounded() == value ? String(Int(value)) : String(value)
        case .bool(let value): return value ? "true" : "false"
        case .object(let value):
            return value.keys.sorted().map { "\($0): \(value[$0]?.displayText ?? "")" }.joined(separator: ", ")
        case .array(let value): return value.map(\.displayText).joined(separator: ", ")
        case .null: return "—"
        }
    }
}

public enum TriStateBool: Hashable, Sendable {
    case value(Bool)
    case unknown

    public var displayText: String {
        switch self {
        case .value(true): return "Yes"
        case .value(false): return "No"
        case .unknown: return "Unknown"
        }
    }
}

extension TriStateBool: Codable {
    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let value = try? container.decode(Bool.self) {
            self = .value(value)
        } else if let value = try? container.decode(String.self), value == "unknown" {
            self = .unknown
        } else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Expected a Boolean or the string 'unknown'"
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .value(let value): try container.encode(value)
        case .unknown: try container.encode("unknown")
        }
    }
}

// MARK: - Auth and tenancy

public enum Role: String, Codable, CaseIterable, Hashable, Sendable {
    case owner
    case admin
    case `operator`
    case auditor
    case connector
}

public struct DemoKey: Codable, Hashable, Identifiable, Sendable {
    public var id: String { token }
    public let tenant: String
    public let role: Role
    public let token: String
    public let keyReference: String

    public init(tenant: String, role: Role, token: String, keyReference: String) {
        self.tenant = tenant
        self.role = role
        self.token = token
        self.keyReference = keyReference
    }
}

public struct Principal: Codable, Hashable, Sendable {
    public let tenantId: String
    public let principalType: String
    public let subjectId: String
    public let role: Role
    public let keyReference: String
}

public struct Tenant: Codable, Hashable, Identifiable, Sendable {
    public let id: String
    public let slug: String
    public let name: String
    public let createdAt: String
}

public struct TenantContext: Codable, Hashable, Sendable {
    public let principal: Principal
    public let tenant: Tenant
}

// MARK: - Decision core

public enum DecisionOutcome: String, Codable, CaseIterable, Hashable, Sendable {
    case allow
    case stepUp = "step_up"
    case restrict
    case deny

    public var title: String {
        switch self {
        case .allow: return "Allow"
        case .stepUp: return "Step-up"
        case .restrict: return "Restrict"
        case .deny: return "Deny"
        }
    }
}

public enum Severity: String, Codable, CaseIterable, Hashable, Sendable {
    case low
    case medium
    case high
    case critical
}

public enum ReviewStatus: String, Codable, Hashable, Sendable {
    case notRequired = "not_required"
    case pendingReview = "pending_review"
    case reviewed
}

public struct MatchedRule: Codable, Hashable, Identifiable, Sendable {
    public var id: String { ruleId }
    public let ruleId: String
    public let reasonCode: String
    public let outcome: DecisionOutcome
    public let severity: Severity

    public init(ruleId: String, reasonCode: String, outcome: DecisionOutcome, severity: Severity) {
        self.ruleId = ruleId
        self.reasonCode = reasonCode
        self.outcome = outcome
        self.severity = severity
    }
}

public struct Decision: Codable, Hashable, Identifiable, Sendable {
    public let id: String
    public let tenantId: String
    public let identityId: String
    public let deviceId: String
    public let workflowId: String
    public let outcome: DecisionOutcome
    public let policyId: String
    public let policyVersionId: String
    public let policyVersion: Int
    public let matchedRules: [MatchedRule]
    public let reasonCodes: [String]
    public let signalIds: [String]
    public let evidenceSnapshotId: String
    public let requestContext: [String: String]
    public let latencyMs: Int
    public let createdAt: String
    public let reviewStatus: ReviewStatus
    public let reviewable: Bool
    public let explanation: String

    public init(
        id: String,
        tenantId: String,
        identityId: String,
        deviceId: String,
        workflowId: String,
        outcome: DecisionOutcome,
        policyId: String,
        policyVersionId: String,
        policyVersion: Int,
        matchedRules: [MatchedRule],
        reasonCodes: [String],
        signalIds: [String],
        evidenceSnapshotId: String,
        requestContext: [String: String],
        latencyMs: Int,
        createdAt: String,
        reviewStatus: ReviewStatus,
        reviewable: Bool,
        explanation: String
    ) {
        self.id = id
        self.tenantId = tenantId
        self.identityId = identityId
        self.deviceId = deviceId
        self.workflowId = workflowId
        self.outcome = outcome
        self.policyId = policyId
        self.policyVersionId = policyVersionId
        self.policyVersion = policyVersion
        self.matchedRules = matchedRules
        self.reasonCodes = reasonCodes
        self.signalIds = signalIds
        self.evidenceSnapshotId = evidenceSnapshotId
        self.requestContext = requestContext
        self.latencyMs = latencyMs
        self.createdAt = createdAt
        self.reviewStatus = reviewStatus
        self.reviewable = reviewable
        self.explanation = explanation
    }
}

public struct EvaluateRequest: Codable, Hashable, Sendable {
    public let identityRef: String
    public let deviceRef: String
    public let workflowKey: String
    public let requestContext: [String: String]?

    public init(
        identityRef: String,
        deviceRef: String,
        workflowKey: String,
        requestContext: [String: String]? = nil
    ) {
        self.identityRef = identityRef
        self.deviceRef = deviceRef
        self.workflowKey = workflowKey
        self.requestContext = requestContext
    }
}

public struct EvaluateResult: Codable, Hashable, Sendable {
    public let decisionId: String
    public let outcome: DecisionOutcome
    public let reasonCodes: [String]
    public let policyId: String
    public let policyVersion: Int
    public let policyVersionId: String
    public let evidenceSnapshotId: String
    public let matchedRules: [MatchedRule]
    public let reviewable: Bool
    public let latencyMs: Int
    public let explanation: String

    public init(
        decisionId: String,
        outcome: DecisionOutcome,
        reasonCodes: [String],
        policyId: String,
        policyVersion: Int,
        policyVersionId: String,
        evidenceSnapshotId: String,
        matchedRules: [MatchedRule],
        reviewable: Bool,
        latencyMs: Int,
        explanation: String
    ) {
        self.decisionId = decisionId
        self.outcome = outcome
        self.reasonCodes = reasonCodes
        self.policyId = policyId
        self.policyVersion = policyVersion
        self.policyVersionId = policyVersionId
        self.evidenceSnapshotId = evidenceSnapshotId
        self.matchedRules = matchedRules
        self.reviewable = reviewable
        self.latencyMs = latencyMs
        self.explanation = explanation
    }
}

// MARK: - Evidence

public enum ComplianceState: String, Codable, Hashable, Sendable {
    case compliant
    case nonCompliant = "non_compliant"
    case unknown
}

public enum Freshness: String, Codable, Hashable, Sendable {
    case fresh
    case stale
    case expired
    case missing
    case unknown
}

public struct DecisionEvidence: Codable, Hashable, Sendable {
    public let identityEnabled: TriStateBool
    public let deviceManaged: TriStateBool
    public let deviceCompliance: ComplianceState
    public let deviceEncrypted: TriStateBool
    public let osSupported: TriStateBool
    public let ownerType: String
    public let postureFreshness: Freshness
    public let workflowRiskTier: String
    public let custodyState: String
    public let dockChargeState: String
    public let tamperState: String
    public let dockState: String
    public let baselineCompliance: String
    public let badgeBinding: String
    public let criticalSignalsPresent: Bool
}

public struct NormalizedSignal: Codable, Hashable, Identifiable, Sendable {
    public let id: String
    public let tenantId: String
    public let connectorId: String
    public let subjectType: String
    public let subjectId: String
    public let category: String
    public let value: JSONValue
    public let observedAt: String
    public let freshness: Freshness
    public let sourceReference: String
}

public struct EvidenceSnapshot: Codable, Hashable, Identifiable, Sendable {
    public let id: String
    public let tenantId: String
    public let decisionId: String
    public let capturedAt: String
    public let evidence: DecisionEvidence
    public let signalsUsed: [NormalizedSignal]
    public let policyVersionId: String
    public let policyVersion: Int
    public let sourceReferences: [String]
    public let digest: String
}

// MARK: - Sessions

public enum SessionStatus: String, Codable, Hashable, Sendable {
    case active
    case ended
    case expired
}

public struct Session: Codable, Hashable, Identifiable, Sendable {
    public let id: String
    public let tenantId: String
    public let identityRef: String
    public let deviceRef: String
    public let workflowKey: String
    public let status: SessionStatus
    public let outcome: DecisionOutcome
    public let decisionId: String
    public let createdAt: String
    public let lastSeenAt: String
    public let expiresAt: String
}

public struct SessionStartResult: Codable, Hashable, Sendable {
    public let session: Session
    public let decision: EvaluateResult
}

// MARK: - Metrics, connectors, policies, audit

public struct MetricsSummary: Codable, Hashable, Sendable {
    public let totalDecisions: Int
    public let byOutcome: [String: Int]
    public let allowRate: Double
    public let restrictDenyRate: Double
    public let avgLatencyMs: Double
    public let p95LatencyMs: Double
    public let decisionsWithPolicyVersion: Int
    public let decisionsWithEvidence: Int
    public let pendingReview: Int

    public init(
        totalDecisions: Int,
        byOutcome: [String: Int],
        allowRate: Double,
        restrictDenyRate: Double,
        avgLatencyMs: Double,
        p95LatencyMs: Double,
        decisionsWithPolicyVersion: Int,
        decisionsWithEvidence: Int,
        pendingReview: Int
    ) {
        self.totalDecisions = totalDecisions
        self.byOutcome = byOutcome
        self.allowRate = allowRate
        self.restrictDenyRate = restrictDenyRate
        self.avgLatencyMs = avgLatencyMs
        self.p95LatencyMs = p95LatencyMs
        self.decisionsWithPolicyVersion = decisionsWithPolicyVersion
        self.decisionsWithEvidence = decisionsWithEvidence
        self.pendingReview = pendingReview
    }

    public func count(for outcome: DecisionOutcome) -> Int {
        byOutcome[outcome.rawValue] ?? 0
    }
}

public enum ConnectorStatus: String, Codable, Hashable, Sendable {
    case healthy
    case degraded
    case neverSynced = "never_synced"
}

public struct Connector: Codable, Hashable, Identifiable, Sendable {
    public let id: String
    public let tenantId: String
    public let kind: String
    public let mode: String
    public let ingestionMode: String?
    public let permissionScope: String
    public let credentialRef: String
    public let status: ConnectorStatus
    public let lastSyncAt: String?
}

public struct ConnectorSyncRun: Codable, Hashable, Identifiable, Sendable {
    public let id: String
    public let tenantId: String
    public let connectorId: String
    public let startedAt: String
    public let completedAt: String
    public let status: String
    public let recordsProcessed: Int
    public let signalsNormalized: Int
    public let note: String
}

public struct Policy: Codable, Hashable, Identifiable, Sendable {
    public let id: String
    public let tenantId: String
    public let key: String
    public let name: String
    public let description: String
    public let workflowPattern: String
    public let activeVersionId: String
}

public struct PolicyRule: Codable, Hashable, Identifiable, Sendable {
    public let id: String
    public let description: String
    public let match: [JSONValue]
    public let outcome: DecisionOutcome
    public let reasonCode: String
    public let severity: Severity
}

public enum PolicyVersionStatus: String, Codable, Hashable, Sendable {
    case active
    case superseded
    case draft
}

public struct PolicyVersion: Codable, Hashable, Identifiable, Sendable {
    public let id: String
    public let tenantId: String
    public let policyId: String
    public let version: Int
    public let status: PolicyVersionStatus
    public let rules: [PolicyRule]
    public let createdAt: String
    public let digest: String
}

public struct AuditEvent: Codable, Hashable, Identifiable, Sendable {
    public let id: String
    public let tenantId: String
    public let sequence: Int
    public let type: String
    public let actor: String
    public let subject: String
    public let summary: String
    public let references: [String]
    public let recordedAt: String
    public let previousDigest: String
    public let digest: String

    // The /v1/audit API sends `seq` and `prevDigest`; map them to the model names.
    enum CodingKeys: String, CodingKey {
        case id, tenantId
        case sequence = "seq"
        case type, actor, subject, summary, references, recordedAt
        case previousDigest = "prevDigest"
        case digest
    }
}

public struct AuditChain: Codable, Hashable, Sendable {
    public let valid: Bool
    public let eventCount: Int
    public let firstInvalidSequence: Int?

    // The /v1/audit API sends `length` and `brokenAtSeq`; map to the model names.
    enum CodingKeys: String, CodingKey {
        case valid
        case eventCount = "length"
        case firstInvalidSequence = "brokenAtSeq"
    }
}

public struct AuditResponse: Codable, Hashable, Sendable {
    public let events: [AuditEvent]
    public let chain: AuditChain
}

// MARK: - Embedded app workflow

public enum AppVertical: String, Codable, CaseIterable, Hashable, Sendable {
    case healthcare
    case warehouse
    case industrial
    case globalFleet = "global_fleet"
    case retail
    case dataCenter = "data_center"

    public var title: String {
        switch self {
        case .healthcare: return "Healthcare"
        case .warehouse: return "Warehouse"
        case .industrial: return "Industrial"
        case .globalFleet: return "Global fleet"
        case .retail: return "Retail"
        case .dataCenter: return "Data center"
        }
    }
}

public enum AppRiskTier: String, Codable, Hashable, Sendable {
    case standard
    case elevated
    case critical
}

public struct AppAction: Codable, Hashable, Identifiable, Sendable {
    public var id: String { key }
    public let key: String
    public let label: String
    public let riskTier: AppRiskTier
    public let sensitive: Bool
    public let gatedByStepUp: Bool
}

public struct AppIntegration: Codable, Hashable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let category: String
    public let vertical: AppVertical
    public let workflowKey: String
    public let actions: [AppAction]
}

public enum AppActionDisposition: String, Codable, Hashable, Sendable {
    case auto
    case assist
    case stepUp = "step_up"
    case blocked
    case applied
}

public struct AppActionPlan: Codable, Hashable, Identifiable, Sendable {
    public var id: String { key }
    public let key: String
    public let label: String
    public let riskTier: AppRiskTier
    public let sensitive: Bool
    public let disposition: AppActionDisposition
    public let requiresConfirmation: Bool
    public let reason: String

    // A public memberwise init is required so host-app consumers (e.g. WardlinkDemo)
    // can construct/override a plan across the module boundary; the default
    // memberwise init of a public struct is only `internal`.
    public init(
        key: String,
        label: String,
        riskTier: AppRiskTier,
        sensitive: Bool,
        disposition: AppActionDisposition,
        requiresConfirmation: Bool,
        reason: String
    ) {
        self.key = key
        self.label = label
        self.riskTier = riskTier
        self.sensitive = sensitive
        self.disposition = disposition
        self.requiresConfirmation = requiresConfirmation
        self.reason = reason
    }
}

public enum AppSessionMode: String, Codable, Hashable, Sendable {
    case proceed
    case assist
    case stepUp = "step_up"
    case hold
    case deny
}

public struct AppSessionPlan: Codable, Hashable, Sendable {
    public let integrationId: String
    public let integrationName: String
    public let outcome: DecisionOutcome
    public let mode: AppSessionMode
    public let summary: String
    public let actions: [AppActionPlan]
}

public struct AppWorkflowRequest: Codable, Hashable, Sendable {
    public let integrationId: String
    public let identityRef: String
    public let deviceRef: String
    public let requestContext: [String: String]?

    public init(
        integrationId: String,
        identityRef: String,
        deviceRef: String,
        requestContext: [String: String]? = nil
    ) {
        self.integrationId = integrationId
        self.identityRef = identityRef
        self.deviceRef = deviceRef
        self.requestContext = requestContext
    }
}

public struct AppWorkflowEvaluation: Codable, Hashable, Sendable {
    public let decision: EvaluateResult
    public let plan: AppSessionPlan
}

// MARK: - Fixture selections

public struct TrustScenario: Identifiable, Hashable, Sendable {
    public let id: String
    public let title: String
    public let subtitle: String
    public let identityRef: String
    public let deviceRef: String
    public let workflowKey: String
    public let expectedOutcome: DecisionOutcome

    public init(
        id: String,
        title: String,
        subtitle: String,
        identityRef: String,
        deviceRef: String,
        workflowKey: String,
        expectedOutcome: DecisionOutcome
    ) {
        self.id = id
        self.title = title
        self.subtitle = subtitle
        self.identityRef = identityRef
        self.deviceRef = deviceRef
        self.workflowKey = workflowKey
        self.expectedOutcome = expectedOutcome
    }
}

// MARK: - Fleet (open-source MDM) posture — GET /cp/v1/fleet-mdm

public struct FleetPostureHost: Codable, Hashable, Identifiable, Sendable {
    public var id: String { hostRef }
    public let hostRef: String
    public let deviceManaged: Bool
    public let deviceCompliance: String
    public let baselineCompliance: String
    public let postureFreshness: String
    public let enforceable: Bool
    public let assurance: String
    public let rationale: String
    public init(hostRef: String, deviceManaged: Bool, deviceCompliance: String, baselineCompliance: String, postureFreshness: String, enforceable: Bool, assurance: String, rationale: String) {
        self.hostRef = hostRef; self.deviceManaged = deviceManaged; self.deviceCompliance = deviceCompliance
        self.baselineCompliance = baselineCompliance; self.postureFreshness = postureFreshness
        self.enforceable = enforceable; self.assurance = assurance; self.rationale = rationale
    }
}

public struct FleetPostureSummary: Codable, Hashable, Sendable {
    public let hosts: Int
    public let managed: Int
    public let enforceable: Int
    public let diskEncrypted: Int
    public let nonCompliant: Int
    public let raiseStepUp: Int
    public init(hosts: Int, managed: Int, enforceable: Int, diskEncrypted: Int, nonCompliant: Int, raiseStepUp: Int) {
        self.hosts = hosts; self.managed = managed; self.enforceable = enforceable
        self.diskEncrypted = diskEncrypted; self.nonCompliant = nonCompliant; self.raiseStepUp = raiseStepUp
    }
}

public struct FleetPosture: Codable, Hashable, Sendable {
    public let observedAt: String
    public let summary: FleetPostureSummary
    public let signals: [FleetPostureHost]
    public init(observedAt: String, summary: FleetPostureSummary, signals: [FleetPostureHost]) {
        self.observedAt = observedAt; self.summary = summary; self.signals = signals
    }
}
