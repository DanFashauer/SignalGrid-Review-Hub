import SwiftUI

@main
struct WardlinkDemoApp: App {
    @State private var model = WardlinkModel()

    var body: some Scene {
        WindowGroup {
            WardlinkView(model: model)
        }
    }
}
