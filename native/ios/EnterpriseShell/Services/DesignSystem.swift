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
    static let primary    = dynamic(light: "3A6E6A", dark: "4F8C87") // Muted Teal 500 (canonical)
    static let accent     = dynamic(light: "2F5C58", dark: "6FA7A1") // Muted Teal 400 (canonical)

    // MARK: - Decision states — allow / step-up (review) / deny ONLY.
    //
    // The DARK values are canonical and must not be "improved" here. They ORIGINATED
    // in DEV/docs/BRAND_SYSTEM.md ("Functional State Palette"), the repo where the
    // company and product were invented — which is RETIRED and receives no changes,
    // so it is history, not a source to reconcile against (see CANONICAL SOURCE
    // below). The live counterpart is artifacts/signalgrid-web/src/index.css, which
    // carries the same hexes. The two agree; an edit in this file alone forks the
    // platform, and a `deny` that is one red in the console and another on the device
    // is a worse failure than the one it would be fixing.
    //
    // FINDING RESOLVED for `deny` (DR-005, 2026-08-20): the owner ratified WCAG
    // AA as the floor for decision-state colors and the exact tones the earlier
    // accessibility pass had tested — light 8A3F3F / dark C67070. Re-measured
    // before applying: dark deny now 5.05:1 on background, 4.55:1 on card;
    // light 6.50:1 / 7.33:1. Web and iOS changed in the same commit, because a
    // fork between them was the reason the first attempt was reverted.
    //
    // The historical measurements, kept because two rows are still live:
    //     deny    3.53 on background   3.18 on card    <- WAS: fixed by DR-005
    //     primary 4.61                 4.15            <- card still under 4.5
    //     allow   4.80                 4.32            <- card still under 4.5
    //     review  5.67                 5.10            <- passes
    //
    // `allow` RESOLVED (DR-006, 2026-08-21): the owner ratified the proposed
    // re-tone — dark 5E8F73 → 639779 (hsl 145 21% 49%), light unchanged.
    // Measured before applying: dark 5.29 on background, 4.76 on card; light
    // 5.41 / 6.11. `onAllow` ratified with it for allow-filled surfaces. `primary` is the brand accent, not a
    // decision state; the ratified floor does not bind it, though the same
    // proposal should mention it.
    //
    // CANONICAL SOURCE: this file and artifacts/signalgrid-web/src/index.css,
    // together, per DR-005 — DEV (and its BRAND_SYSTEM.md) is retired and does
    // not receive changes. WCAG AA is the ratified floor for decision-state
    // colors; a change here lands in the web tokens in the same commit or not
    // at all. The light values are derived counterparts under the same floor.
    static let allow  = dynamic(light: "3F6B52", dark: "639779") // DR-006 re-tone: AA on both grounds
    static let review = dynamic(light: "7A5B2E", dark: "B08B57") // canonical dark
    static let deny   = dynamic(light: "8A3F3F", dark: "C67070") // DR-005 re-tone: AA on both grounds

    /// Foreground for FILLED deny controls (text/icon sitting ON a deny fill).
    /// The re-tone that fixed deny-as-text flipped the failure onto deny-as-fill:
    /// white on the new dark #C67070 measures 3.53:1 — under the ratified AA
    /// floor — while white on the light #8A3F3F clears it at 7.33:1. So the pair
    /// is theme-split: light keeps white, dark uses the charcoal background tone
    /// (#15181B on #C67070 = 5.05:1). Never hardcode .white on a deny fill.
    static let onDeny = dynamic(light: "FFFFFF", dark: "15181B")
    /// Text/icons ON an allow-filled surface (toast, chip). Same shape as
    /// `onDeny`, ratified with it in DR-006: white on the dark allow fill sat
    /// at 3.72:1 — the exact defect onDeny was created to fix. Measured:
    /// dark 15181B on 639779 = 5.29:1; light FFFFFF on 3F6B52 = 6.11:1.
    static let onAllow = dynamic(light: "FFFFFF", dark: "15181B")

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
