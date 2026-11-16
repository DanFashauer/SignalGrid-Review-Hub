import SwiftUI
import UIKit
import SignalGridMobileCore

// ADAPTIVE, NOT REPAINTED. Every token below resolves per appearance, exactly the way
// `EnterpriseShell/Services/DesignSystem.swift` does — the operator console follows the
// device's Light/Dark setting instead of forcing charcoal onto a light phone. The DARK
// values are byte-for-byte what this file already shipped (review row 104's corrected
// background included); the LIGHT values are `DesignSystem.swift`'s warm counterparts,
// so one SignalGrid does not render two palettes.
//
// ORDER MATTERS, and this is why the tokens moved first: the app pinned
// `.preferredColorScheme(.dark)` over a hardcoded dark palette. Dropping the pin before
// the tokens were adaptive would have painted the dark palette onto a light system —
// a worse screen than the one being fixed. Tokens first, then the pin.
//
// EVERY DECISION COLOR IS MEASURED, both appearances, against all three rendered
// grounds plus the 12% OutcomeBadge composite, by `scripts/check-decision-palette.mjs`.
// Light, on background / panel / card:
//   allow  #3F6B52 -> 5.41 / 5.76 / 6.11      on-tint over 12% -> 4.61 / 4.89 / 5.16
//   review #7A5B2E -> 5.53 / 5.89 / 6.24      on-tint over 12% -> 4.70 / 4.99 / 5.26
//   deny   #8A3F3F -> 6.50 / 6.91 / 7.33      on-tint over 12% -> 5.44 / 5.77 / 6.09
// In light mode the on-tint foreground IS the base tone: the tint composites over a
// light ground and DARKENS it, the mirror of the dark-mode case where it lightens.
extension Color {
    // MARK: - Foundations
    static let sgBackground = dynamic(light: "F3F1EC", dark: "15181B")
    static let sgPanel = dynamic(light: "FAF8F4", dark: "1A1F22")
    static let sgCard = dynamic(light: "FFFFFF", dark: "1D2226")
    static let sgBorder = dynamic(light: "DDD8D0", dark: "2A3035")
    static let sgInk = dynamic(light: "15181B", dark: "F2F0E9")
    static let sgMuted = dynamic(light: "55606B", dark: "AEB4AF")
    static let sgAccent = dynamic(light: "2F5C58", dark: "74ABA5")

    // MARK: - Decision states
    //
    // The dark tones are canonical (DR-005 deny, DR-006 allow) and must not be
    // "improved" here; the light tones are `DesignSystem.swift`'s ratified counterparts.
    // `restrict` RENDERS THE DENY RED everywhere (DesignSystem.swift maps
    // restrict -> deny); a caution amber here changed what the verdict color means from
    // one SignalGrid surface to the next.
    static let sgAllow = dynamic(light: "3F6B52", dark: "639779")
    static let sgStepUp = dynamic(light: "7A5B2E", dark: "B08B57")
    static let sgRestrict = dynamic(light: "8A3F3F", dark: "C67070")
    static let sgDeny = dynamic(light: "8A3F3F", dark: "C67070")

    // On-tint foregrounds for the tinted OutcomeBadge (a 12% tint composites over the
    // ground and lightens it in dark mode, darkens it in light mode).
    static let sgAllowOnTint = dynamic(light: "3F6B52", dark: "74A488")
    static let sgStepUpOnTint = dynamic(light: "7A5B2E", dark: "B69465")
    static let sgDenyOnTint = dynamic(light: "8A3F3F", dark: "CC7F7F")

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

    // MARK: - Internals

    /// A brand token that resolves per appearance. Both values are parsed once, up
    /// front — a failed parse is a typo in a literal above and should trap here at
    /// startup, not silently resolve to a wrong color inside the trait callback.
    /// Same contract as `DesignSystem.swift`'s `dynamic(light:dark:)`.
    private static func dynamic(light: String, dark: String) -> Color {
        let l = UIColor(sgHex: light)
        let d = UIColor(sgHex: dark)
        return Color(UIColor { $0.userInterfaceStyle == .dark ? d : l })
    }
}

private extension UIColor {
    /// Six-digit RRGGBB only. Traps on anything else: every caller passes a literal
    /// from this file, so a bad value is a typo to fix, never a color to guess.
    convenience init(sgHex hex: String) {
        precondition(hex.count == 6, "SignalGrid token must be 6 hex digits, got \(hex)")
        guard let v = UInt32(hex, radix: 16) else {
            preconditionFailure("SignalGrid token is not hex: \(hex)")
        }
        self.init(red: CGFloat((v >> 16) & 0xFF) / 255,
                  green: CGFloat((v >> 8) & 0xFF) / 255,
                  blue: CGFloat(v & 0xFF) / 255,
                  alpha: 1)
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
