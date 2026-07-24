import SwiftUI
import SignalGridMobileCore

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var baseURL = ""
    @State private var token = ""
    @State private var showingToken = false
    @State private var connecting = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    PublicSafetyBanner()
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                }

                Section("Connection mode") {
                    HStack {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(model.isLive ? "Live API" : "Offline deterministic demo")
                                .font(.headline)
                            Text(model.isLive ? model.baseURLText : "No network or database required")
                                .font(.caption)
                                .foregroundStyle(Color.sgMuted)
                        }
                        Spacer()
                        ModePill(isLive: model.isLive)
                    }
                    .listRowBackground(Color.sgCard)

                    Button {
                        Task { await model.useDemoMode() }
                    } label: {
                        Label("Use offline demo", systemImage: "shippingbox")
                    }
                    .listRowBackground(Color.sgCard)
                }

                Section("Connect to SignalGrid API") {
                    TextField("API base URL", text: $baseURL)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        .autocorrectionDisabled()
                    Group {
                        if showingToken {
                            TextField("Bearer token", text: $token)
                        } else {
                            SecureField("Bearer token", text: $token)
                        }
                    }
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()

                    Toggle("Show token", isOn: $showingToken)
                    Button("Use public demo token") {
                        token = DemoFixtures.keys.first?.token ?? ""
                    }
                    Button {
                        connecting = true
                        Task {
                            _ = await model.connectLive(baseURL: baseURL, token: token)
                            connecting = false
                        }
                    } label: {
                        HStack {
                            if connecting { ProgressView() }
                            Text("Connect")
                        }
                    }
                    .disabled(connecting || baseURL.isEmpty || token.isEmpty)
                }
                .listRowBackground(Color.sgCard)

                if model.tokenPresent {
                    Section("Stored credential") {
                        Text("The bearer token is stored in the iOS Keychain. It is never printed in the UI or logs by this app.")
                            .font(.caption)
                            .foregroundStyle(Color.sgMuted)
                        Button("Forget live credential", role: .destructive) {
                            Task { await model.forgetLiveCredentials() }
                        }
                    }
                    .listRowBackground(Color.sgCard)
                }

                Section("Current tenant") {
                    KeyValueRow(key: "Tenant", value: model.context?.tenant.name ?? "—")
                    KeyValueRow(key: "Tenant ID", value: model.context?.tenant.id ?? "—")
                    KeyValueRow(key: "Role", value: model.context?.principal.role.rawValue ?? "—")
                    KeyValueRow(key: "Subject", value: model.context?.principal.subjectId ?? "—")
                }
                .listRowBackground(Color.sgCard)

                Section("Product boundary") {
                    Label("Operator and reviewer surface", systemImage: "person.2.badge.gearshape")
                    Text("Frontline workers do not open this app. SignalGrid remains embedded beneath their normal host applications; see the included Wardlink demo target for that flow.")
                        .font(.caption)
                        .foregroundStyle(Color.sgMuted)
                    Text("Not production-ready · not compliance certification · no live vendor partnership claims · no autonomous production remediation.")
                        .font(.caption)
                        .foregroundStyle(Color.sgMuted)
                }
                .listRowBackground(Color.sgCard)

                Section("Build") {
                    KeyValueRow(key: "App", value: "SignalGrid Operator")
                    KeyValueRow(key: "Core", value: "SignalGridMobileCore")
                    KeyValueRow(key: "Minimum OS", value: "iOS 17")
                }
                .listRowBackground(Color.sgCard)
            }
            .scrollContentBackground(.hidden)
            .background(Color.sgBackground)
            .navigationTitle("Settings")
            .onAppear {
                if baseURL.isEmpty { baseURL = model.baseURLText }
            }
            .signalGridSurface()
        }
    }
}
