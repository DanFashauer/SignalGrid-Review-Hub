import UIKit

/// A window that reports genuine user interaction to SessionStateManager so the
/// active-session idle timeout resets on touch. Because it observes at the window
/// level, taps on any control (buttons, scrolling, etc.) count as activity — which
/// is what an inactivity timeout should measure.
final class SessionWindow: UIWindow {
    override func sendEvent(_ event: UIEvent) {
        if event.type == .touches,
           let touches = event.allTouches,
           touches.contains(where: { $0.phase == .began || $0.phase == .ended }) {
            SessionStateManager.shared.userDidInteract()
        }
        super.sendEvent(event)
    }
}
