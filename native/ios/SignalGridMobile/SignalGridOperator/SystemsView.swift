import SwiftUI
import SignalGridMobileCore

struct SystemsView: View {
    @Environment(AppModel.self) private var model
    @State private var segment: Segment = .connectors

    enum Segment: String, CaseIterable, Identifiable {
        case connectors = "Connectors"
        case policies = "Policies"
        case audit = "Audit"
        var id: String { rawValue }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("System view", selection: $segment) {
                    ForEach(Segment.allCases) { item in
                        Text(item.rawValue).tag(item)
                    }
                }
                .pickerStyle(.segmented)
                .padding(16)

                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 14) {
                        switch segment {
                        case .connectors: connectors
                        case .policies: policies
                        case .audit: audit
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 20)
                }
                .refreshable { await model.refresh() }
            }
            .navigationTitle("Systems")
            .signalGridSurface()
        }
    }

    @ViewBuilder
    private var connectors: some View {
        SectionHeading(title: "Systems of record", subtitle: "Fixture-only, read-only connectors")
        ForEach(model.connectors) { connector in
            SGCard {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Circle()
                            .fill(Color.connector(connector.status))
                            .frame(width: 10, height: 10)
                        Text(connector.kind.replacingOccurrences(of: "-", with: " ").capitalized)
                            .font(.headline)
                        Spacer()
                        Text(connector.status.rawValue.replacingOccurrences(of: "_", with: " ").uppercased())
                            .font(.caption2.monospaced().weight(.bold))
                            .foregroundStyle(Color.connector(connector.status))
                    }
                    KeyValueRow(key: "Mode", value: connector.mode)
                    KeyValueRow(key: "Ingestion", value: connector.ingestionMode ?? "service sync")
                    KeyValueRow(key: "Permission", value: connector.permissionScope)
                    KeyValueRow(key: "Credential ref", value: connector.credentialRef)
                    KeyValueRow(key: "Last sync", value: connector.lastSyncAt.map(ISODate.short) ?? "Never")
                    Button {
                        Task { await model.sync(connector: connector) }
                    } label: {
                        Label("Run read-only sync", systemImage: "arrow.triangle.2.circlepath")
                    }
                    .buttonStyle(.bordered)
                    .tint(Color.sgAccent)
                }
            }
        }
    }

    @ViewBuilder
    private var policies: some View {
        SectionHeading(title: "Versioned policies", subtitle: "Test-before-activate product model")
        ForEach(model.policies) { policy in
            PolicyCard(policy: policy)
        }
    }

    @ViewBuilder
    private var audit: some View {
        SectionHeading(title: "Audit ledger", subtitle: "Append-oriented decision and configuration evidence")
        if let audit = model.audit {
            SGCard {
                HStack {
                    Label(
                        audit.chain.valid ? "Chain verified" : "Chain invalid",
                        systemImage: audit.chain.valid ? "checkmark.seal.fill" : "xmark.seal.fill"
                    )
                    .foregroundStyle(audit.chain.valid ? Color.sgAllow : Color.sgDeny)
                    .font(.subheadline.weight(.semibold))
                    Spacer()
                    Text("\(audit.chain.eventCount) events")
                        .font(.caption.monospaced())
                        .foregroundStyle(Color.sgMuted)
                }
            }
            ForEach(audit.events.prefix(30)) { event in
                SGCard {
                    HStack(alignment: .top, spacing: 12) {
                        Circle()
                            .fill(Color.sgAccent)
                            .frame(width: 9, height: 9)
                            .padding(.top, 5)
                        VStack(alignment: .leading, spacing: 5) {
                            Text(event.type.replacingOccurrences(of: ".", with: " · ").uppercased())
                                .font(.caption2.monospaced().weight(.bold))
                                .foregroundStyle(Color.sgAccent)
                            Text(event.summary)
                                .font(.subheadline)
                            Text("\(event.actor) · \(ISODate.short(event.recordedAt))")
                                .font(.caption2.monospaced())
                                .foregroundStyle(Color.sgMuted)
                        }
                    }
                }
            }
        } else {
            SGCard {
                EmptyStateView(icon: "list.bullet.clipboard", title: "No audit data", message: "Refresh the app to load the fixture ledger.")
            }
        }
    }
}

private struct PolicyCard: View {
    @Environment(AppModel.self) private var model
    let policy: Policy
    @State private var versions: [PolicyVersion] = []
    @State private var expanded = false

    var body: some View {
        SGCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(policy.name).font(.headline)
                        Text(policy.description)
                            .font(.caption)
                            .foregroundStyle(Color.sgMuted)
                    }
                    Spacer()
                }
                KeyValueRow(key: "Key", value: policy.key)
                KeyValueRow(key: "Workflow", value: policy.workflowPattern)
                KeyValueRow(key: "Active version", value: policy.activeVersionId)

                Button(expanded ? "Hide versions" : "Show versions") {
                    expanded.toggle()
                    if expanded, versions.isEmpty {
                        Task { versions = await model.versions(for: policy) }
                    }
                }
                .buttonStyle(.bordered)
                .tint(Color.sgAccent)

                if expanded {
                    ForEach(versions) { version in
                        VStack(alignment: .leading, spacing: 5) {
                            HStack {
                                Text("Version \(version.version)")
                                    .font(.subheadline.weight(.semibold))
                                Spacer()
                                Text(version.status.rawValue.uppercased())
                                    .font(.caption2.monospaced().weight(.bold))
                                    .foregroundStyle(version.status == .active ? Color.sgAllow : Color.sgMuted)
                            }
                            Text("\(version.rules.count) rules · \(version.digest)")
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
        }
    }
}
