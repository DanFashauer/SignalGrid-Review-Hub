import SwiftUI
import SignalGridMobileCore

struct WardlinkView: View {
    @Bindable var model: WardlinkModel

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 16) {
                    patientCard
                    if let message = model.hostMessage {
                        hostMessage(message)
                    }
                    if model.isLoading {
                        ProgressView("Checking session…")
                            .frame(maxWidth: .infinity, minHeight: 160)
                    } else if let error = model.errorMessage {
                        hostMessage("Wardlink could not verify this session: \(error)")
                    } else {
                        actionSection
                    }
                }
                .padding(16)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Wardlink Chart")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    HStack(spacing: 7) {
                        RoundedRectangle(cornerRadius: 6, style: .continuous)
                            .fill(Color.blue)
                            .frame(width: 26, height: 26)
                            .overlay {
                                Text("W")
                                    .font(.caption.weight(.bold))
                                    .foregroundStyle(.white)
                            }
                        Text("RN · Shared iPad")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        model.showInstrumentation = true
                    } label: {
                        Image(systemName: "testtube.2")
                    }
                    .accessibilityLabel("Open demo instrumentation")
                }
            }
            .task {
                if model.evaluation == nil {
                    await model.load()
                }
            }
            .sheet(item: $model.pendingConfirmation) { action in
                ConfirmationSheet(action: action, model: model)
                    .presentationDetents([.medium])
            }
            .sheet(isPresented: $model.showInstrumentation) {
                DemoInstrumentationView(model: model)
                    .presentationDetents([.medium, .large])
            }
            .overlay(alignment: .bottom) {
                if let toast = model.toastMessage {
                    Text(toast)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 11)
                        .background(Color.black.opacity(0.88))
                        .clipShape(Capsule())
                        .padding(.bottom, 18)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                        .task(id: toast) {
                            try? await Task.sleep(for: .seconds(2.3))
                            if model.toastMessage == toast {
                                withAnimation { model.toastMessage = nil }
                            }
                        }
                }
            }
            .animation(.easeInOut(duration: 0.2), value: model.toastMessage)
        }
    }

    private var patientCard: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Rivera, Avery")
                        .font(.title3.weight(.bold))
                    Text("Room 4B · MRN 00-DEMO")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text("SYNTHETIC")
                    .font(.caption2.monospaced().weight(.bold))
                    .foregroundStyle(Color.orange)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color.orange.opacity(0.10))
                    .clipShape(Capsule())
            }
            Divider()
            HStack {
                Label("Allergies reviewed", systemImage: "checkmark.circle.fill")
                Spacer()
                Text("Updated 2 min ago")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(16)
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var actionSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Clinical actions")
                    .font(.headline)
                Spacer()
                if model.isAuthenticating {
                    ProgressView()
                }
            }

            ForEach(model.actions) { action in
                Button {
                    Task { await model.perform(action) }
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: icon(for: action))
                            .font(.title3)
                            .frame(width: 30, height: 30)
                            .foregroundStyle(color(for: action))
                            .background(color(for: action).opacity(0.10))
                            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        VStack(alignment: .leading, spacing: 3) {
                            Text(action.label)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(.primary)
                            Text(workerCopy(for: action))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .multilineTextAlignment(.leading)
                        }
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(.tertiary)
                    }
                    .padding(14)
                    .background(Color(.secondarySystemGroupedBackground))
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .buttonStyle(.plain)
                .disabled(model.isAuthenticating)
            }

            Text("Wardlink requests extra verification only when the current device or session context requires it. You remain in Wardlink throughout the workflow.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.top, 4)
        }
    }

    private func hostMessage(_ message: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Color.orange)
            Text(message)
                .font(.subheadline)
            Spacer(minLength: 0)
        }
        .padding(13)
        .background(Color.orange.opacity(0.10))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func icon(for action: AppActionPlan) -> String {
        switch action.disposition {
        case .auto: return "bolt.fill"
        case .assist: return "person.crop.circle.badge.checkmark"
        case .stepUp: return "faceid"
        case .blocked: return "lock.fill"
        case .applied: return "checkmark.circle.fill"
        }
    }

    private func color(for action: AppActionPlan) -> Color {
        switch action.disposition {
        case .auto, .applied: return .green
        case .assist, .stepUp: return .orange
        case .blocked: return .red
        }
    }

    private func workerCopy(for action: AppActionPlan) -> String {
        switch action.disposition {
        case .auto: return "Available"
        case .assist: return "Confirm in Wardlink"
        case .stepUp: return "Verify with Face ID, Touch ID, or passcode"
        case .blocked: return "Not available on this device right now"
        case .applied: return "Completed"
        }
    }
}

private struct ConfirmationSheet: View {
    let action: AppActionPlan
    @Bindable var model: WardlinkModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 18) {
                Image(systemName: "checkmark.shield")
                    .font(.largeTitle)
                    .foregroundStyle(Color.blue)
                Text("Confirm controlled action")
                    .font(.title2.weight(.bold))
                Text(action.label)
                    .font(.headline)
                Text("Review the action in Wardlink before continuing. This is Wardlink’s own confirmation step.")
                    .foregroundStyle(.secondary)
                Spacer()
                Button {
                    model.confirmPendingAction()
                    dismiss()
                } label: {
                    Text("Confirm \(action.label)")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                Button("Cancel", role: .cancel) {
                    model.cancelPendingAction()
                    dismiss()
                }
                .frame(maxWidth: .infinity)
            }
            .padding(22)
            .navigationBarHidden(true)
        }
    }
}

private struct DemoInstrumentationView: View {
    @Bindable var model: WardlinkModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("This panel is demo instrumentation for reviewers. It is not part of the frontline worker experience and would not appear in a host application deployment.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Section("Fixture scenario") {
                    Picker("Scenario", selection: $model.selectedScenarioID) {
                        ForEach(DemoFixtures.trustScenarios) { scenario in
                            Text(scenario.title).tag(scenario.id)
                        }
                    }
                    .onChange(of: model.selectedScenarioID) { _, newValue in
                        Task { await model.chooseScenario(newValue) }
                    }
                    Text(model.scenario.subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                if let evaluation = model.evaluation {
                    Section("Behind the glass") {
                        LabeledContent("Decision") {
                            Text(evaluation.decision.outcome.title.uppercased())
                                .font(.caption.monospaced().weight(.bold))
                                .foregroundStyle(instrumentationColor(evaluation.decision.outcome))
                        }
                        LabeledContent("Policy") {
                            Text("v\(evaluation.decision.policyVersion)")
                                .font(.caption.monospaced())
                        }
                        LabeledContent("Latency") {
                            Text("\(evaluation.decision.latencyMs) ms")
                                .font(.caption.monospaced())
                        }
                        Text(evaluation.decision.explanation)
                            .font(.subheadline)
                        ForEach(evaluation.decision.reasonCodes, id: \.self) { code in
                            Text(code)
                                .font(.caption.monospaced())
                        }
                    }

                    Section("Host app plan") {
                        Text(evaluation.plan.summary)
                        ForEach(evaluation.plan.actions) { action in
                            HStack {
                                Text(action.label)
                                Spacer()
                                Text(action.disposition.rawValue.replacingOccurrences(of: "_", with: " ").uppercased())
                                    .font(.caption2.monospaced().weight(.bold))
                            }
                        }
                    }
                }

                Section("Public-safety boundary") {
                    Text("Synthetic fixture only. No live tenant data, PHI/PII, vendor API call, production enforcement, certification, partnership claim, or autonomous remediation.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Demo instrumentation")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private func instrumentationColor(_ outcome: DecisionOutcome) -> Color {
        switch outcome {
        case .allow: return .green
        case .stepUp: return .orange
        case .restrict: return .orange
        case .deny: return .red
        }
    }
}
