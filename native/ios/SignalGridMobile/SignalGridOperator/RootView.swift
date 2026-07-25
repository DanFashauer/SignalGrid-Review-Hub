import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        TabView {
            OverviewView()
                .tabItem { Label("Overview", systemImage: "square.grid.2x2") }

            TrustLabView()
                .tabItem { Label("Trust", systemImage: "point.3.connected.trianglepath.dotted") }

            DecisionsView()
                .tabItem { Label("Decisions", systemImage: "list.bullet.rectangle") }

            SystemsView()
                .tabItem { Label("Systems", systemImage: "server.rack") }

            SettingsView()
                .tabItem { Label("Settings", systemImage: "slider.horizontal.3") }
        }
        .tint(Color.sgAccent)
        .signalGridSurface()
        .task {
            if model.context == nil {
                await model.bootstrap()
            }
        }
    }
}
