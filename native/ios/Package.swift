// swift-tools-version: 5.9
import PackageDescription

// The EnterpriseShell decision port, as a package that builds and tests on macOS.
//
// WHY THIS EXISTS. `DecisionEngine.swift` and `AppWorkflows.swift` are byte-faithful
// ports of the TypeScript simulator, and parity with it is the point (see CLAUDE.md,
// golden rule 1). Until now the only thing that ever compiled them was an iOS
// simulator test bundle — which means the most important Swift in the repository
// could only be checked by booting a simulator, and could only be checked on iOS.
//
// Two things follow from that, and this package fixes both:
//
//   1. PLATFORM. The port is pure Foundation — every one of the seven files below
//      imports Foundation and nothing else (DeviceBindingCrypto also imports
//      CommonCrypto, an Apple system module present on both iOS and macOS). That is a claim, and a claim nothing
//      checks is a claim that decays: one `import UIKit` added for convenience and
//      the port silently stops being portable, with no gate to say so. Building it
//      for macOS makes the claim falsifiable. If someone reaches for UIKit, this
//      fails to compile, on the commit that did it.
//
//   2. SPEED. `swift test` here runs the whole logic suite in seconds with no
//      simulator boot. A gate that is cheap gets run; the iOS-simulator run stays
//      as the thing that proves the app target itself still builds.
//
// THIS DOES NOT REPLACE THE XCODE TEST TARGET, and deliberately compiles the very
// same files rather than a copy. Duplicating a byte-faithful port to make it
// testable would defeat the reason it is byte-faithful. `project.yml` lists these
// same sources in `EnterpriseShellTests`; both consumers read one set of files.
//
// The test sources carry `#if canImport(EnterpriseShellPort)` around their import,
// so they compile unchanged in both places: inside Xcode the module does not exist
// and the sources are compiled directly into the test bundle, exactly as before.
let package = Package(
    name: "EnterpriseShellPort",
    platforms: [
        .macOS(.v13),
        .iOS(.v15)
    ],
    targets: [
        // Explicit `sources` rather than a directory scan: EnterpriseShell/ is an
        // app tree full of UIKit view controllers, asset catalogs and an Info.plist.
        // Naming the files keeps this target to exactly the pure-Foundation port —
        // and makes any attempt to widen it a visible edit to this list.
        .target(
            name: "EnterpriseShellPort",
            path: "EnterpriseShell",
            sources: [
                "Services/DecisionEngine.swift",
                "Services/AppWorkflows.swift",
                "Services/DecisionService.swift",
                "Services/SignalContext.swift",
                "Services/ScreenCapturePolicy.swift",
                "Services/DeviceBindingCrypto.swift",
                "Models/SessionState.swift"
            ]
        ),
        .testTarget(
            name: "EnterpriseShellPortTests",
            dependencies: ["EnterpriseShellPort"],
            path: "EnterpriseShellTests"
        )
    ]
)
