import Foundation

/// Pure policy for screen-capture protection during a session. Kept UIKit-free so
/// it is unit-testable and the guard (`ScreenCaptureGuard`) just applies UI from it.
///
/// A shared-device session may forbid screen capture (`persona.restrictions
/// .allowScreenCapture == false`). We can't stop the OS from taking a single
/// screenshot, but we CAN redact on-screen content while the screen is being
/// recorded/mirrored, and audit every screenshot as a policy violation.
enum ScreenCapturePolicy {

    /// Redact content only when a session is active AND the persona forbids screen
    /// capture AND the screen is currently captured (recording / mirroring / AirPlay).
    static func shouldRedact(sessionActive: Bool, allowScreenCapture: Bool, isCaptured: Bool) -> Bool {
        sessionActive && !allowScreenCapture && isCaptured
    }

    /// Whether a screenshot taken in this state is a policy violation worth auditing.
    static func isScreenshotViolation(sessionActive: Bool, allowScreenCapture: Bool) -> Bool {
        sessionActive && !allowScreenCapture
    }
}
