import SwiftUI
import SignalGridMobileCore

struct DecisionsView: View {
    @Environment(AppModel.self) private var model
    @State private var filter: DecisionOutcome?

    private var filtered: [Decision] {
        guard let filter else { return model.decisions }
        return model.decisions.filter { $0.outcome == filter }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Picker("Outcome", selection: $filter) {
                        Text("All outcomes").tag(nil as DecisionOutcome?)
                        ForEach(DecisionOutcome.allCases, id: \.self) { outcome in
                            Text(outcome.title).tag(Optional(outcome))
                        }
                    }
                    .pickerStyle(.menu)
                    .listRowBackground(Color.sgCard)
                }

                Section("Evidence-backed decisions") {
                    if filtered.isEmpty {
                        EmptyStateView(
                            icon: "rectangle.stack.badge.questionmark",
                            title: "No matching decisions",
                            message: "Run a scenario in Trust Lab or change the outcome filter."
                        )
                        .listRowBackground(Color.sgCard)
                    } else {
                        ForEach(filtered) { decision in
                            NavigationLink {
                                DecisionDetailView(decision: decision)
                            } label: {
                                DecisionListLabel(decision: decision)
                            }
                            .listRowBackground(Color.sgCard)
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Color.sgBackground)
            .navigationTitle("Decisions")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await model.refresh() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                }
            }
            .refreshable { await model.refresh() }
            .signalGridSurface()
        }
    }
}

private struct DecisionListLabel: View {
    let decision: Decision

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                OutcomeBadge(outcome: decision.outcome)
                Spacer()
                Text(ISODate.short(decision.createdAt))
                    .font(.caption2.monospaced())
                    .foregroundStyle(Color.sgMuted)
            }
            Text(decision.explanation)
                .font(.subheadline.weight(.medium))
                .lineLimit(2)
            HStack {
                Label("v\(decision.policyVersion)", systemImage: "doc.badge.gearshape")
                Label("\(decision.signalIds.count) signals", systemImage: "waveform.path.ecg")
                Label("\(decision.latencyMs) ms", systemImage: "timer")
            }
            .font(.caption2)
            .foregroundStyle(Color.sgMuted)
        }
        .padding(.vertical, 5)
    }
}
