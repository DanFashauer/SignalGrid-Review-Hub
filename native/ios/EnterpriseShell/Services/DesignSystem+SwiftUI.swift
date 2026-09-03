import SwiftUI
import UIKit

/// SwiftUI bindings for the SG brand tokens.
///
/// DERIVED from `SG` by construction, never retyped. `SignalGridMobile/…/Theme.swift`
/// re-typed these hexes as literals and drifted (#1E2428 vs the canonical #1D2226,
/// measured under AA) — a third hand-typed copy would fork the palette again.
/// Binding through `Color(uiColor:)` keeps the adaptive light/dark provider AND the
/// ratified DR-005 / DR-006 values, so DesignSystem.swift (together with the web
/// tokens) stays the single source of truth for every tree.
extension Color {
    static let sgBackground = Color(uiColor: SG.background)
    static let sgCard       = Color(uiColor: SG.card)
    static let sgForeground = Color(uiColor: SG.foreground)
    static let sgMutedFg    = Color(uiColor: SG.mutedFg)
    static let sgBorder     = Color(uiColor: SG.border)
    static let sgPrimary    = Color(uiColor: SG.primary)
    static let sgAccent     = Color(uiColor: SG.accent)
    static let sgAllow      = Color(uiColor: SG.allow)
    static let sgReview     = Color(uiColor: SG.review)
    static let sgDeny       = Color(uiColor: SG.deny)
    static let sgOnDeny     = Color(uiColor: SG.onDeny)
    static let sgOnAllow    = Color(uiColor: SG.onAllow)

    /// Decision color for a verdict string — the same single mapping `SG` owns, so
    /// the "risk colors only for decisions" rule holds on SwiftUI surfaces too.
    static func sgDecision(_ verdict: String) -> Color {
        Color(uiColor: SG.decisionColor(verdict))
    }
}

/// Type roles for SwiftUI surfaces, as Dynamic-Type TEXT STYLES.
///
/// SwiftUI text styles scale with the user's text size by default and follow the
/// per-role curve iOS uses — exactly what `SG.sans` reproduces for UIKit through
/// UIFontMetrics. A fixed `.system(size:)` would not scale: the same defect the
/// UIKit gate exists to catch, and `scripts/check-ios-dynamic-type.mjs` now catches
/// the SwiftUI spelling too. Each role names the UIKit design size it stands in for.
enum SGType {
    static let title: Font           = .title.weight(.bold)        // SG.sans(28, .bold)
    static let instruction: Font     = .title3.weight(.medium)     // SG.sans(18, .medium)
    static let callout: Font         = .callout                    // SG.sans(16)
    static let calloutEmphasis: Font = .callout.weight(.medium)    // SG.sans(16, .medium)
    static let body: Font            = .subheadline                // SG.sans(14)
    static let bodyEmphasis: Font    = .subheadline.weight(.medium)
    static let caption: Font         = .caption                    // SG.sans(12)
    /// Monospaced value display (badge ids, codes) — the SwiftUI twin of SG.mono(16).
    /// A text STYLE, so it scales with Dynamic Type; `.system(size:)` would not.
    static let mono: Font            = .system(.callout, design: .monospaced)
}

extension View {
    /// The kiosk-surface cap `SG.sans` applies (2x): the standard Dynamic Type range
    /// is honored in full and only the largest accessibility steps clamp, so a
    /// fixed-layout shared-device screen enlarges rather than overflows.
    func sgKioskTypeCap() -> some View {
        dynamicTypeSize(...DynamicTypeSize.accessibility3)
    }

    /// The raised card surface: SG.card fill, SG.border hairline, continuous corners.
    func sgCard(cornerRadius: CGFloat = 16) -> some View {
        background(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous).fill(Color.sgCard))
            .overlay(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous).stroke(Color.sgBorder, lineWidth: 1))
    }
}
