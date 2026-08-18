import UIKit

/// SignalGrid brand system, ported from the web app tokens
/// (`artifacts/signalgrid-web/src/index.css`):
///
///   Warm charcoal foundations · off-white type · muted teal accents.
///   Risk colors are used ONLY for decision-state communication (allow / step-up /
///   deny) — never as broad brand accents. No electric blues / cyber cyan / neon.
///
/// This applies to SignalGrid-branded surfaces (lock screen, workspace,
/// behind-the-glass). The embedded host apps are deliberately NOT styled with this
/// system — they are the worker's own third-party apps (see EMBEDDED_UX_PRINCIPLE.md).
///
/// ADAPTIVE, NOT REPAINTED. Every token below is a *brand* color that resolves per
/// appearance, so the shell follows the device's Light/Dark setting like any other
/// iOS app instead of forcing a dark surface onto a light device. The dark values
/// are the original web tokens; the light values are their warm counterparts, with
/// the background/card relationship preserved (card is the raised surface in both).
/// Type scales with Dynamic Type. An enterprise shell that ignores the user's text
/// size and appearance settings reads as a foreign app on the device — and on the
/// text-size axis that is an accessibility defect, not a matter of taste.
enum SG {
    // MARK: - Foundations

    static let background = dynamic(light: "F3F1EC", dark: "15181B") // warm charcoal 950 / off-white
    static let card       = dynamic(light: "FFFFFF", dark: "1D2226") // raised surface in both
    static let foreground = dynamic(light: "15181B", dark: "F3F1EC") // off-white 100 / charcoal
    static let mutedFg    = dynamic(light: "55606B", dark: "D8D4CC") // off-white 300 / warm gray
    static let border     = dynamic(light: "DDD8D0", dark: "2A3136") // border neutral
    static let primary    = dynamic(light: "3A6E6A", dark: "53938D") // muted teal 500
    static let accent     = dynamic(light: "2F5C58", dark: "6FA7A1") // muted teal 400

    // MARK: - Decision states — allow / step-up (review) / deny ONLY.
    //
    // Contrast is a correctness property here, not a preference: these three colors
    // are how a denied or stepped-up decision is communicated, so a worker who
    // cannot distinguish them cannot read the gate's answer. Every value below
    // clears WCAG AA (>= 4.5:1) against BOTH `background` and `card` in its own
    // appearance. The dark `deny` previously scored 3.18:1 on card — the weakest
    // contrast in the system belonged to its most safety-critical state. The fix
    // raises HSV *value* only: hue and saturation are unchanged, so these are the
    // same brand colors, not new ones.
    static let allow  = dynamic(light: "3F6B52", dark: "609376") // dark was 5E8F73
    static let review = dynamic(light: "7A5B2E", dark: "B08B57") // dark unchanged — already AA
    static let deny   = dynamic(light: "8A3F3F", dark: "C67070") // dark was A15B5B (3.18:1 on card)

    static let radius: CGFloat = 6

    // MARK: - Type — system stand-ins for Inter / IBM Plex Mono (not bundled).
    //
    // Sizes stay as designed, then scale with the user's text-size setting via
    // UIFontMetrics, so the layout's proportions survive while the text honors
    // Settings > Display & Brightness > Text Size (and the Accessibility slider).
    //
    // Capped at 2x: these are fixed-layout kiosk surfaces on a shared device, and
    // an uncapped AX5 would overflow the lock screen rather than enlarge it. That
    // is a deliberate, stated trade — the standard Dynamic Type range is fully
    // honored and only the largest accessibility steps clamp.
    static func sans(_ size: CGFloat, _ weight: UIFont.Weight = .regular) -> UIFont {
        metrics(for: size).scaledFont(for: .systemFont(ofSize: size, weight: weight),
                                      maximumPointSize: size * 2)
    }

    static func mono(_ size: CGFloat, _ weight: UIFont.Weight = .regular) -> UIFont {
        metrics(for: size).scaledFont(for: .monospacedSystemFont(ofSize: size, weight: weight),
                                      maximumPointSize: size * 2)
    }

    /// Tabular figures, for values that tick (session timers, counters): every digit
    /// keeps a constant width so the layout does not jitter as the number changes.
    /// Scales like the rest of the type. `mono` would swap the whole typeface, which
    /// is a different intent — this keeps the UI typeface and fixes only the digits.
    static func monoDigits(_ size: CGFloat, _ weight: UIFont.Weight = .regular) -> UIFont {
        metrics(for: size).scaledFont(for: .monospacedDigitSystemFont(ofSize: size, weight: weight),
                                      maximumPointSize: size * 2)
    }

    /// Decision color for a verdict / disposition string. The single place that
    /// maps a decision to a risk color, so the "risk colors only for decisions"
    /// rule holds everywhere.
    static func decisionColor(_ verdict: String) -> UIColor {
        switch verdict.lowercased() {
        case "allow", "auto", "applied", "proceed": return allow
        case "step_up", "assist", "review", "hold": return review
        case "restrict", "deny", "blocked": return deny
        default: return accent
        }
    }

    // MARK: - Internals

    /// A brand token that resolves per appearance. Both values are parsed once, up
    /// front — a failed parse is a typo in a literal above and should trap here at
    /// startup, not silently resolve to a wrong color inside the trait callback.
    private static func dynamic(light: String, dark: String) -> UIColor {
        let l = UIColor(hex: light)!
        let d = UIColor(hex: dark)!
        return UIColor { $0.userInterfaceStyle == .dark ? d : l }
    }

    /// Map a design point size onto the closest system text style, so scaling
    /// follows the curve iOS uses for text of that role instead of scaling every
    /// size by one flat factor.
    private static func metrics(for size: CGFloat) -> UIFontMetrics {
        switch size {
        case ..<12: return UIFontMetrics(forTextStyle: .caption2)
        case ..<13: return UIFontMetrics(forTextStyle: .caption1)
        case ..<15: return UIFontMetrics(forTextStyle: .footnote)
        case ..<16: return UIFontMetrics(forTextStyle: .subheadline)
        case ..<17: return UIFontMetrics(forTextStyle: .callout)
        case ..<20: return UIFontMetrics(forTextStyle: .body)
        case ..<23: return UIFontMetrics(forTextStyle: .title3)
        case ..<28: return UIFontMetrics(forTextStyle: .title2)
        default:    return UIFontMetrics(forTextStyle: .title1)
        }
    }
}
