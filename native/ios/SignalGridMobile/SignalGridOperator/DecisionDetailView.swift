import SwiftUI
import SignalGridMobileCore

struct DecisionDetailView: View {
    @Environment(AppModel.self) private var model
    let decision: Decision
    @State private var evidence: EvidenceFetch?
    @State private var loadingEvidence = false

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 16) {
                SGCard {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            OutcomeBadge(outcome: decision.outcome)
                            Spacer()
                            Text("\(decision.latencyMs) ms")
                                .font(.caption.monospaced())
                                .foregroundStyle(Color.sgMuted)
                        }
                        Text(decision.explanation)
                            .font(.title3.weight(.semibold))
                        FlowLayout(spacing: 7) {
                            ForEach(decision.reasonCodes, id: \.self) { reason in
                                Text(reason)
                                    .font(.caption2.monospaced())
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 5)
                                    .foregroundStyle(Color.outcome(decision.outcome))
                                    .background(Color.outcome(decision.outcome).opacity(0.12))
                                    .clipShape(Capsule())
                            }
                        }
                    }
                }

                SGCard {
                    SectionHeading(title: "Decision record", subtitle: "Tenant-scoped immutable references")
                    VStack(spacing: 9) {
                        KeyValueRow(key: "Decision", value: decision.id)
                        KeyValueRow(key: "Tenant", value: decision.tenantId)
                        KeyValueRow(key: "Identity", value: decision.identityId)
                        KeyValueRow(key: "Device", value: decision.deviceId)
                        KeyValueRow(key: "Workflow", value: decision.workflowId)
                        KeyValueRow(key: "Policy", value: "v\(decision.policyVersion) · \(decision.policyVersionId)")
                        KeyValueRow(key: "Review", value: decision.reviewStatus.rawValue.replacingOccurrences(of: "_", with: " "))
                        KeyValueRow(key: "Created", value: ISODate.short(decision.createdAt))
                    }
                    .padding(.top, 10)
                }

                if !decision.matchedRules.isEmpty {
                    SGCard {
                        SectionHeading(title: "Matched rules", subtitle: "Deterministic policy evaluation")
                        VStack(spacing: 12) {
                            ForEach(decision.matchedRules) { rule in
                                HStack(alignment: .top, spacing: 10) {
                                    Circle()
                                        .fill(Color.outcome(rule.outcome))
                                        .frame(width: 8, height: 8)
                                        .padding(.top, 5)
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(rule.reasonCode)
                                            .font(.caption.monospaced().weight(.semibold))
                                        Text("\(rule.ruleId) · \(rule.severity.rawValue)")
                                            .font(.caption2.monospaced())
                                            .foregroundStyle(Color.sgMuted)
                                    }
                                    Spacer()
                                }
                            }
                        }
                        .padding(.top, 10)
                    }
                }

                evidenceSection
            }
            .padding(16)
        }
        .navigationTitle("Decision detail")
        .navigationBarTitleDisplayMode(.inline)
        .signalGridSurface()
        .task(id: decision.id) {
            loadingEvidence = true
            evidence = await model.evidence(for: decision)
            loadingEvidence = false
        }
    }

    @ViewBuilder
    private var evidenceSection: some View {
        if loadingEvidence {
            SGCard { LoadingStateView(label: "Loading evidence snapshot") }
        } else if let evidence {
            SGCard {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        SectionHeading(title: "Evidence snapshot", subtitle: "Signals captured at decision time")
                        Spacer()
                        // The seal is the SERVER's digest verdict, never a constant. It was
                        // a hardcoded green "Verified" while the API's `verified: false` was
                        // decoded and discarded — a failed tamper check rendered as a pass.
                        if evidence.verified {
                            Label("Verified", systemImage: "checkmark.seal.fill")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(Color.sgAllow)
                        } else {
                            Label("Digest check FAILED", systemImage: "exclamationmark.triangle.fill")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(Color.sgDeny)
                        }
                    }
                    KeyValueRow(key: "Snapshot", value: evidence.snapshot.id)
                    KeyValueRow(key: "Digest", value: evidence.snapshot.digest)
                    KeyValueRow(key: "Digest check", value: evidence.verified ? "recomputed by the server" : "FAILED — the stored snapshot does not match its digest")
                    KeyValueRow(key: "Policy version", value: "v\(evidence.snapshot.policyVersion)")
                    Divider().overlay(Color.sgBorder)
                    evidenceGrid(evidence.snapshot.evidence)
                    Divider().overlay(Color.sgBorder)
                    Text("NORMALIZED SIGNALS")
                        .font(.caption2.monospaced().weight(.semibold))
                        .foregroundStyle(Color.sgMuted)
                    ForEach(evidence.snapshot.signalsUsed) { signal in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(signal.category.replacingOccurrences(of: "_", with: " ").uppercased())
                                    .font(.caption2.monospaced().weight(.semibold))
                                Spacer()
                                Text(signal.freshness.rawValue.uppercased())
                                    .font(.caption2.monospaced())
                                    .foregroundStyle(signal.freshness == .fresh ? Color.sgAllow : Color.sgStepUp)
                            }
                            Text(signal.value.displayText)
                                .font(.subheadline)
                            Text(signal.sourceReference)
                                .font(.caption2.monospaced())
                                .foregroundStyle(Color.sgMuted)
                                .textSelection(.enabled)
                        }
                        .padding(10)
                        .background(Color.sgPanel)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                }
            }
        } else {
            SGCard {
                EmptyStateView(
                    icon: "doc.text.magnifyingglass",
                    title: "Evidence unavailable",
                    message: "The snapshot could not be loaded from the selected data source."
                )
            }
        }
    }

    private func evidenceGrid(_ value: DecisionEvidence) -> some View {
        VStack(spacing: 9) {
            KeyValueRow(key: "Identity enabled", value: value.identityEnabled.displayText)
            KeyValueRow(key: "Device managed", value: value.deviceManaged.displayText)
            KeyValueRow(key: "Compliance", value: value.deviceCompliance.rawValue)
            KeyValueRow(key: "Posture freshness", value: value.postureFreshness.rawValue)
            KeyValueRow(key: "Custody", value: value.custodyState)
            KeyValueRow(key: "Dock", value: value.dockState)
            KeyValueRow(key: "Badge", value: value.badgeBinding)
            KeyValueRow(key: "Baseline", value: value.baselineCompliance)
            KeyValueRow(key: "Critical signals", value: value.criticalSignalsPresent ? "Present" : "Incomplete")
        }
    }
}
