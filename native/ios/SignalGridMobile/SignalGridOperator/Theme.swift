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
    static let sgAllow = Color(red: 0.388, green: 0.592, blue: 0.475)   // #639779 — DR-006, matches every other tree
    static let sgStepUp = Color(red: 0.690, green: 0.545, blue: 0.341)  // #B08B57 — canonical review
    // #C67070 — restrict RENDERS THE DENY RED everywhere (DesignSystem.swift
    // maps restrict→deny); a caution amber here changed what the verdict color
    // means from one SignalGrid surface to the next.
    static let sgRestrict = Color(red: 0.776, green: 0.439, blue: 0.439)
    static let sgDeny = Color(red: 0.776, green: 0.439, blue: 0.439)    // #C67070 exactly — DR-005

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
