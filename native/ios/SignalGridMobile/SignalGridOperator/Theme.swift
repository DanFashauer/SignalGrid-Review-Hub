import SwiftUI
import SignalGridMobileCore

extension Color {
    static let sgBackground = Color(red: 0.075, green: 0.090, blue: 0.102)
    static let sgPanel = Color(red: 0.102, green: 0.122, blue: 0.133)
    // #1D2226 — the canonical card (DesignSystem.swift). The prior #1E2428
    // measured deny at 4.45:1 — under AA — on the ground decision rows
    // actually render on (.listRowBackground in DecisionsView).
    static let sgCard = Color(red: 0.114, green: 0.133, blue: 0.149)
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

    // On-tint foregrounds for the tinted OutcomeBadge (12% tint composites
    // over the card and LIGHTENS it — flat colors measured 3.92-4.27:1 there).
    // Measured over 0.12 tint on card/panel/background, all >= 4.5:1:
    //   allow  #74A488 -> 4.80 / 4.99 / 5.46   (the web allow-on-tint value)
    //   stepUp #B69465 -> 4.74 / 4.95 / 5.41
    //   deny   #CC7F7F -> 4.55 / 4.69 / 5.14   (the web deny-on-tint value)
    static let sgAllowOnTint = Color(red: 0.455, green: 0.643, blue: 0.533)
    static let sgStepUpOnTint = Color(red: 0.714, green: 0.580, blue: 0.396)
    static let sgDenyOnTint = Color(red: 0.800, green: 0.498, blue: 0.498)

    static func outcomeOnTint(_ outcome: DecisionOutcome) -> Color {
        switch outcome {
        case .allow: return .sgAllowOnTint
        case .stepUp: return .sgStepUpOnTint
        default: return .sgDenyOnTint // restrict renders the deny red everywhere
        }
    }

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
