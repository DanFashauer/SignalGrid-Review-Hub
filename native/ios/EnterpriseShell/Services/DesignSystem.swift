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
enum SG {
    // Foundations
    static let background = UIColor(hex: "15181B")!   // warm charcoal 950
    static let card       = UIColor(hex: "1D2226")!   // warm charcoal 900
    static let foreground = UIColor(hex: "F3F1EC")!   // off-white 100
    static let mutedFg    = UIColor(hex: "D8D4CC")!   // off-white 300
    static let border     = UIColor(hex: "2A3136")!   // border neutral
    static let primary    = UIColor(hex: "4F8C87")!   // muted teal 500
    static let accent     = UIColor(hex: "6FA7A1")!   // muted teal 400

    // Decision states — allow / step-up (review) / deny ONLY.
    static let allow  = UIColor(hex: "5E8F73")!
    static let review = UIColor(hex: "B08B57")!
    static let deny   = UIColor(hex: "A15B5B")!

    static let radius: CGFloat = 6

    // Type — system stand-ins for Inter / IBM Plex Mono (not bundled).
    static func sans(_ size: CGFloat, _ weight: UIFont.Weight = .regular) -> UIFont {
        .systemFont(ofSize: size, weight: weight)
    }
    static func mono(_ size: CGFloat, _ weight: UIFont.Weight = .regular) -> UIFont {
        .monospacedSystemFont(ofSize: size, weight: weight)
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
}
