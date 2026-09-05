import Charts
import SwiftUI
import SignalGridMobileCore

struct OverviewView: View {
    @Environment(AppModel.self) private var model

    private let columns = [
        GridItem(.flexible(), spacing: 10),
        GridItem(.flexible(), spacing: 10)
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 18) {
                    header
                    PublicSafetyBanner()

                    if let message = model.errorMessage {
                        ErrorCard(message: message) {
                            Task { await model.refresh() }
                        }
                        // A failed refresh leaves the sections below holding the PREVIOUS
                        // load. Say so beside the error, and date it, rather than letting
                        // stale figures read as current under a small error card.
                        if let last = model.lastRefresh {
                            Text("Figures below are from the last successful refresh at \(last.formatted(date: .omitted, time: .standard)), not from this attempt.")
                                .font(.caption2)
                                .foregroundStyle(Color.sgStepUp)
                        }
                    }

                    if model.isLoading && model.metrics == nil {
                        LoadingStateView(label: "Loading trust telemetry")
                    } else {
                        metricsSection
                        outcomeSection
                        recentDecisionsSection
                        connectorSection
                    }
                }
                .padding(16)
            }
            .navigationBarHidden(true)
            .refreshable { await model.refresh() }
            .signalGridSurface()
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 12) {
            BrandMark(size: 30)
            VStack(alignment: .leading, spacing: 2) {
                Text("SignalGrid")
                    .font(.title2.weight(.bold))
                Text(model.context?.tenant.name ?? "Operator Console")
                    .font(.caption)
                    .foregroundStyle(Color.sgMuted)
                // `lastRefresh` was computed on every load and read by nothing.
                Text(model.lastRefresh.map { "Refreshed \($0.formatted(date: .omitted, time: .standard))" } ?? "Not yet refreshed")
                    .font(.caption2.monospaced())
                    .foregroundStyle(Color.sgMuted)
            }
            Spacer()
            ModePill(isLive: model.isLive)
        }
        .padding(.top, 4)
    }

    @ViewBuilder
    private var metricsSection: some View {
        if let metrics = model.metrics {
            VStack(alignment: .leading, spacing: 10) {
                SectionHeading(title: "Operational trust", subtitle: "Current tenant decision telemetry")
                LazyVGrid(columns: columns, spacing: 10) {
                    MetricTile(title: "Decisions", value: metrics.totalDecisions.formatted())
                    MetricTile(title: "Allow rate", value: metrics.allowRate.formatted(.percent.precision(.fractionLength(1))))
                    MetricTile(title: "Restrict / deny", value: metrics.restrictDenyRate.formatted(.percent.precision(.fractionLength(1))))
                    MetricTile(title: "P95 latency", value: "\(Int(metrics.p95LatencyMs)) ms")
                    MetricTile(title: "Evidence", value: "\(metrics.decisionsWithEvidence)", note: "snapshot-backed")
                    MetricTile(title: "Pending review", value: "\(metrics.pendingReview)")
                }
            }
        }
    }

    @ViewBuilder
    private var outcomeSection: some View {
        if let metrics = model.metrics {
            SGCard {
                SectionHeading(title: "Decision mix", subtitle: "ALLOW · STEP-UP · RESTRICT · DENY")
                Chart(DecisionOutcome.allCases, id: \.self) { outcome in
                    BarMark(
                        x: .value("Outcome", outcome.title),
                        y: .value("Count", metrics.count(for: outcome))
                    )
                    .foregroundStyle(Color.outcome(outcome))
                    .cornerRadius(4)
                }
                .chartYAxis {
                    AxisMarks(position: .leading) {
                        AxisGridLine(stroke: StrokeStyle(lineWidth: 0.5))
                            .foregroundStyle(Color.sgBorder)
                        AxisValueLabel()
                            .foregroundStyle(Color.sgMuted)
                    }
                }
                .chartXAxis {
                    AxisMarks {
                        AxisValueLabel()
                            .foregroundStyle(Color.sgMuted)
                    }
                }
                .frame(height: 190)
                .padding(.top, 10)
            }
        }
    }

    private var recentDecisionsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                SectionHeading(title: "Recent decisions", subtitle: "Evidence-backed fixture activity")
                Spacer()
                NavigationLink("View all") { DecisionsView() }
                    .font(.caption.weight(.semibold))
            }

            if model.decisions.isEmpty {
                SGCard {
                    EmptyStateView(
                        icon: "rectangle.stack.badge.questionmark",
                        title: "No decisions yet",
                        message: "Run a trust scenario to create the first decision."
                    )
                }
            } else {
                ForEach(model.decisions.prefix(5)) { decision in
                    NavigationLink {
                        DecisionDetailView(decision: decision)
                    } label: {
                        DecisionRow(decision: decision)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var connectorSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeading(title: "Connector health", subtitle: "Fixture-only systems of record")
            SGCard {
                VStack(spacing: 12) {
                    ForEach(model.connectors) { connector in
                        HStack(spacing: 12) {
                            Circle()
                                .fill(Color.connector(connector.status))
                                .frame(width: 9, height: 9)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(connector.kind.replacingOccurrences(of: "-", with: " ").capitalized)
                                    .font(.subheadline.weight(.medium))
                                Text(connector.ingestionMode ?? connector.mode)
                                    .font(.caption2.monospaced())
                                    .foregroundStyle(Color.sgMuted)
                            }
                            Spacer()
                            Text(connector.status.rawValue.replacingOccurrences(of: "_", with: " ").uppercased())
                                .font(.caption2.monospaced().weight(.bold))
                                .foregroundStyle(Color.connector(connector.status))
                        }
                        if connector.id != model.connectors.last?.id {
                            Divider().overlay(Color.sgBorder)
                        }
                    }
                }
            }
        }
    }
}

struct DecisionRow: View {
    let decision: Decision

    var body: some View {
        HStack(spacing: 12) {
            OutcomeBadge(outcome: decision.outcome)
            VStack(alignment: .leading, spacing: 3) {
                Text(decision.explanation)
                    .font(.subheadline.weight(.medium))
                    .lineLimit(2)
                Text(decision.reasonCodes.joined(separator: " · "))
                    .font(.caption2.monospaced())
                    .foregroundStyle(Color.sgMuted)
                    .lineLimit(1)
            }
            Spacer(minLength: 4)
            VStack(alignment: .trailing, spacing: 3) {
                Text("v\(decision.policyVersion)")
                    .font(.caption2.monospaced())
                    .foregroundStyle(Color.sgMuted)
                Text("\(decision.latencyMs) ms")
                    .font(.caption2.monospaced())
                    .foregroundStyle(Color.sgMuted)
            }
        }
        .padding(14)
        .background(Color.sgCard)
        .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 13, style: .continuous)
                .stroke(Color.sgBorder, lineWidth: 1)
        }
    }
}
