import SwiftUI
import SignalGridMobileCore

struct TrustLabView: View {
    @Environment(AppModel.self) private var model
    @State private var selectedScenarioID = DemoFixtures.trustScenarios.first?.id ?? ""
    @State private var selectedIntegrationID = DemoFixtures.integrations.first?.id ?? ""

    private var scenario: TrustScenario {
        DemoFixtures.trustScenarios.first(where: { $0.id == selectedScenarioID })
            ?? DemoFixtures.trustScenarios[0]
    }

    private var integration: AppIntegration {
        (model.appIntegrations.isEmpty ? DemoFixtures.integrations : model.appIntegrations)
            .first(where: { $0.id == selectedIntegrationID })
            ?? DemoFixtures.integrations[0]
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 18) {
                    HStack {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Trust Lab")
                                .font(.title2.weight(.bold))
                            Text("Run the repo’s deterministic shared-device decision loop")
                                .font(.caption)
                                .foregroundStyle(Color.sgMuted)
                        }
                        Spacer()
                        ModePill(isLive: model.isLive)
                    }

                    PublicSafetyBanner()
                    scenarioPicker
                    evaluateCard
                    if let result = model.lastEvaluation {
                        resultCard(result)
                    }
                    appWorkflowCard
                    sessionCard
                }
                .padding(16)
            }
            .navigationBarHidden(true)
            .signalGridSurface()
        }
    }

    private var scenarioPicker: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeading(title: "Scenario", subtitle: "Northwind Health · synthetic fixtures")
            Picker("Scenario", selection: $selectedScenarioID) {
                ForEach(DemoFixtures.trustScenarios) { item in
                    Text(item.title).tag(item.id)
                }
            }
            .pickerStyle(.menu)
            .tint(Color.sgAccent)

            SGCard {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        OutcomeBadge(outcome: scenario.expectedOutcome)
                        Spacer()
                        Text(scenario.id.uppercased())
                            .font(.caption2.monospaced())
                            .foregroundStyle(Color.sgMuted)
                    }
                    Text(scenario.title)
                        .font(.headline)
                    Text(scenario.subtitle)
                        .font(.subheadline)
                        .foregroundStyle(Color.sgMuted)
                    Divider().overlay(Color.sgBorder)
                    KeyValueRow(key: "Identity", value: scenario.identityRef)
                    KeyValueRow(key: "Device", value: scenario.deviceRef)
                    KeyValueRow(key: "Workflow", value: scenario.workflowKey)
                }
            }
        }
    }

    private var evaluateCard: some View {
        SGCard {
            VStack(alignment: .leading, spacing: 12) {
                SectionHeading(
                    title: "Evaluate trust",
                    subtitle: "identity + device + workflow + current normalized signals"
                )
                Button {
                    Task { await model.evaluate(scenario: scenario) }
                } label: {
                    HStack {
                        if model.isEvaluating {
                            ProgressView().tint(Color.sgInk)
                        } else {
                            Image(systemName: "point.3.connected.trianglepath.dotted")
                        }
                        Text(model.isEvaluating ? "Evaluating…" : "Run decision")
                            .fontWeight(.semibold)
                        Spacer()
                    }
                    .padding(.vertical, 5)
                }
                .buttonStyle(.borderedProminent)
                .tint(Color.sgAccent)
                .disabled(model.isEvaluating)
            }
        }
    }

    private func resultCard(_ result: EvaluateResult) -> some View {
        SGCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    SectionHeading(title: "Decision", subtitle: "Versioned and evidence-backed")
                    Spacer()
                    OutcomeBadge(outcome: result.outcome)
                }
                Text(result.explanation)
                    .font(.subheadline)
                Divider().overlay(Color.sgBorder)
                KeyValueRow(key: "Policy", value: "v\(result.policyVersion) · \(result.policyVersionId)")
                KeyValueRow(key: "Latency", value: "\(result.latencyMs) ms")
                KeyValueRow(key: "Evidence", value: result.evidenceSnapshotId)
                KeyValueRow(key: "Reviewable", value: result.reviewable ? "Yes" : "No")
                if !result.reasonCodes.isEmpty {
                    VStack(alignment: .leading, spacing: 7) {
                        Text("REASON CODES")
                            .font(.caption2.monospaced().weight(.semibold))
                            .foregroundStyle(Color.sgMuted)
                        FlowLayout(spacing: 7) {
                            ForEach(result.reasonCodes, id: \.self) { reason in
                                Text(reason)
                                    .font(.caption2.monospaced())
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 5)
                                    .background(Color.outcome(result.outcome).opacity(0.12))
                                    .foregroundStyle(Color.outcome(result.outcome))
                                    .clipShape(Capsule())
                            }
                        }
                    }
                }
            }
        }
    }

    private var appWorkflowCard: some View {
        SGCard {
            VStack(alignment: .leading, spacing: 12) {
                SectionHeading(
                    title: "Embedded app gate",
                    subtitle: "The host app asks SignalGrid before a sensitive action"
                )
                Picker("Integrated app", selection: $selectedIntegrationID) {
                    ForEach(model.appIntegrations.isEmpty ? DemoFixtures.integrations : model.appIntegrations) { item in
                        Text(item.name).tag(item.id)
                    }
                }
                .pickerStyle(.menu)
                .tint(Color.sgAccent)

                Button {
                    Task { await model.evaluateApp(integration: integration, scenario: scenario) }
                } label: {
                    Label("Evaluate \(integration.name)", systemImage: "app.badge.checkmark")
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 4)
                }
                .buttonStyle(.bordered)
                .tint(Color.sgAccent)
                .disabled(model.isEvaluating)

                if let evaluation = model.lastAppEvaluation {
                    Divider().overlay(Color.sgBorder)
                    HStack {
                        OutcomeBadge(outcome: evaluation.decision.outcome)
                        Text(evaluation.plan.mode.rawValue.replacingOccurrences(of: "_", with: " ").uppercased())
                            .font(.caption2.monospaced().weight(.bold))
                            .foregroundStyle(Color.sgMuted)
                    }
                    Text(evaluation.plan.summary)
                        .font(.subheadline)
                    ForEach(evaluation.plan.actions) { action in
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: actionIcon(action.disposition))
                                .foregroundStyle(actionColor(action.disposition))
                                .frame(width: 18)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(action.label)
                                    .font(.subheadline.weight(.medium))
                                Text(action.reason)
                                    .font(.caption)
                                    .foregroundStyle(Color.sgMuted)
                            }
                            Spacer()
                            Text(action.disposition.rawValue.replacingOccurrences(of: "_", with: " ").uppercased())
                                .font(.caption2.monospaced().weight(.bold))
                                .foregroundStyle(actionColor(action.disposition))
                        }
                        .padding(.vertical, 3)
                    }
                }
            }
        }
    }

    private var sessionCard: some View {
        SGCard {
            VStack(alignment: .leading, spacing: 12) {
                SectionHeading(
                    title: "Session lifecycle",
                    subtitle: "Start, refresh, and end a trust-gated session"
                )
                if let session = model.activeSession {
                    HStack {
                        OutcomeBadge(outcome: session.outcome)
                        Text(session.status.rawValue.uppercased())
                            .font(.caption2.monospaced().weight(.bold))
                            .foregroundStyle(session.status == .active ? Color.sgAllow : Color.sgMuted)
                        Spacer()
                    }
                    KeyValueRow(key: "Session", value: session.id)
                    KeyValueRow(key: "Expires", value: ISODate.short(session.expiresAt))
                    HStack {
                        Button("Refresh 15 min") { Task { await model.refreshSession() } }
                            .buttonStyle(.bordered)
                        Button("End session", role: .destructive) { Task { await model.endSession() } }
                            .buttonStyle(.bordered)
                    }
                } else {
                    Text("No active session. Start one with the selected scenario.")
                        .font(.caption)
                        .foregroundStyle(Color.sgMuted)
                    Button {
                        Task { await model.startSession(scenario: scenario) }
                    } label: {
                        Label("Start session", systemImage: "play.circle")
                    }
                    .buttonStyle(.bordered)
                    .tint(Color.sgAccent)
                }
            }
        }
    }

    private func actionIcon(_ disposition: AppActionDisposition) -> String {
        switch disposition {
        case .auto: return "bolt.fill"
        case .assist: return "person.crop.circle.badge.checkmark"
        case .stepUp: return "faceid"
        case .blocked: return "nosign"
        case .applied: return "checkmark.circle.fill"
        }
    }

    private func actionColor(_ disposition: AppActionDisposition) -> Color {
        switch disposition {
        case .auto, .applied: return .sgAllow
        case .assist, .stepUp: return .sgStepUp
        case .blocked: return .sgDeny
        }
    }
}

/// Tiny wrapping layout for reason-code pills without a third-party dependency.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var usedWidth: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > maxWidth {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            usedWidth = max(usedWidth, x + size.width)
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        return CGSize(width: usedWidth, height: y + rowHeight)
    }

    func placeSubviews(
        in bounds: CGRect,
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(width: size.width, height: size.height))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

extension ISODate {
    static func short(_ raw: String) -> String {
        guard let date = ISO8601DateFormatter().date(from: raw) else { return raw }
        return date.formatted(date: .abbreviated, time: .shortened)
    }
}
