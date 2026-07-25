// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "SignalGridMobileCore",
    platforms: [
        .iOS(.v17),
        .macOS(.v14)
    ],
    products: [
        .library(name: "SignalGridMobileCore", targets: ["SignalGridMobileCore"])
    ],
    targets: [
        .target(name: "SignalGridMobileCore"),
        .testTarget(
            name: "SignalGridMobileCoreTests",
            dependencies: ["SignalGridMobileCore"]
        )
    ]
)
