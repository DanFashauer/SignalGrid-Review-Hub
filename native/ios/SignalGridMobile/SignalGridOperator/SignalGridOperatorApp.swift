import SwiftUI

@main
struct SignalGridOperatorApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            // NO `.preferredColorScheme` pin. The console follows the device, like any
            // other app on it; the `SG` tokens in Theme.swift resolve per appearance and
            // every decision color is measured against AA in BOTH (see that file's
            // header and `scripts/check-decision-palette.mjs`). The pin existed only
            // because the palette was hardcoded dark — it is gone now that the palette
            // is not.
            RootView()
                .environment(model)
        }
    }
}
