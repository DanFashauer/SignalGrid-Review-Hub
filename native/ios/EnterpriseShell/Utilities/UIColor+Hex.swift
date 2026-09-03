import UIKit

extension UIColor {
    /// Parse a `#RRGGBB` (or `RRGGBB`) hex string into a UIColor.
    ///
    /// This lived in `ActiveSessionViewController` until the SwiftUI view-layer
    /// rebuild retired that file. `DesignSystem.swift` parses every SG brand token
    /// through it (`UIColor(hex:)!`), so it moved here to a surviving, dedicated home
    /// rather than being deleted with the view controller.
    convenience init?(hex: String) {
        var hexSanitized = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        hexSanitized = hexSanitized.replacingOccurrences(of: "#", with: "")

        var rgb: UInt64 = 0
        guard Scanner(string: hexSanitized).scanHexInt64(&rgb) else { return nil }

        let r = CGFloat((rgb & 0xFF0000) >> 16) / 255.0
        let g = CGFloat((rgb & 0x00FF00) >> 8) / 255.0
        let b = CGFloat(rgb & 0x0000FF) / 255.0

        self.init(red: r, green: g, blue: b, alpha: 1.0)
    }
}
