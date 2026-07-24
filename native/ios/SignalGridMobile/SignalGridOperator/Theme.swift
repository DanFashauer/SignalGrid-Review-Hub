import SwiftUI
import SignalGridMobileCore

extension Color {
    static let sgBackground = Color(red: 0.075, green: 0.090, blue: 0.102)
    static let sgPanel = Color(red: 0.102, green: 0.122, blue: 0.133)
    static let sgCard = Color(red: 0.118, green: 0.141, blue: 0.157)
    static let sgBorder = Color(red: 0.165, green: 0.190, blue: 0.208)
    static let sgInk = Color(red: 0.949, green: 0.941, blue: 0.914)
    static let sgMuted = Color(red: 0.682, green: 0.706, blue: 0.686)
    static let sgAccent = Color(red: 0.455, green: 0.671, blue: 0.647)
    static let sgAllow = Color(red: 0.435, green: 0.659, blue: 0.549)
    static let sgStepUp = Color(red: 0.761, green: 0.604, blue: 0.400)
    static let sgRestrict = Color(red: 0.788, green: 0.608, blue: 0.420)
    static let sgDeny = Color(red: 0.753, green: 0.455, blue: 0.455)

    static func outcome(_ outcome: DecisionOutcome) -> Color {
        switch outcome {
        case .allow: return .sgAllow
        case .stepUp: return .sgStepUp
        case .restrict: return .sgRestrict
        case .deny: return .sgDeny
        }
    }

    static func connector(_ status: ConnectorStatus) -> Color {
        switch status {
        case .healthy: return .sgAllow
        case .degraded: return .sgStepUp
        case .neverSynced: return .sgMuted
        }
    }
}

struct SignalGridBackground: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background(Color.sgBackground.ignoresSafeArea())
            .foregroundStyle(Color.sgInk)
            .tint(Color.sgAccent)
    }
}

extension View {
    func signalGridSurface() -> some View {
        modifier(SignalGridBackground())
    }
}
