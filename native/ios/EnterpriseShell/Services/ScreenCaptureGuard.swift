import UIKit

/// Applies the session's screen-capture restriction as far as an app can. When the persona forbids
/// screen capture (`restrictions.allowScreenCapture == false`) during an active
/// session, it redacts on-screen content while the screen is being recorded /
/// mirrored / AirPlayed, and audits every screenshot as a policy violation.
///
/// The redaction genuinely protects a recording (the overlay covers the content in
/// the captured stream). A single screenshot can't be prevented by an app, so that
/// is detected and audited (aligning with the product's record-everything ethos).
/// All decisions come from the pure `ScreenCapturePolicy` so they are unit-tested.
final class ScreenCaptureGuard {

    static let shared = ScreenCaptureGuard()
    private init() {}

    private weak var window: UIWindow?
    private var overlay: UIView?
    private var observers: [NSObjectProtocol] = []

    func attach(to window: UIWindow?) {
        guard let window else { return }
        self.window = window
        let nc = NotificationCenter.default
        observers.append(nc.addObserver(forName: UIScreen.capturedDidChangeNotification,
                                        object: nil, queue: .main) { [weak self] _ in self?.refresh() })
        observers.append(nc.addObserver(forName: UIApplication.userDidTakeScreenshotNotification,
                                        object: nil, queue: .main) { [weak self] _ in self?.handleScreenshot() })
        observers.append(nc.addObserver(forName: .sessionStateDidChange,
                                        object: nil, queue: .main) { [weak self] _ in self?.refresh() })
        refresh()
    }

    private var sessionActive: Bool {
        SessionStateManager.shared.currentState == .activeSession
    }

    private var allowScreenCapture: Bool {
        SessionStateManager.shared.currentSession?.persona.restrictions.allowScreenCapture ?? true
    }

    private func refresh() {
        let redact = ScreenCapturePolicy.shouldRedact(
            sessionActive: sessionActive,
            allowScreenCapture: allowScreenCapture,
            isCaptured: UIScreen.main.isCaptured)
        redact ? showOverlay() : hideOverlay()
    }

    private func handleScreenshot() {
        guard ScreenCapturePolicy.isScreenshotViolation(
            sessionActive: sessionActive, allowScreenCapture: allowScreenCapture) else { return }
        AuditLogger.shared.log(event: .screenshotDetected, metadata: [
            "state": SessionStateManager.shared.currentState.rawValue])
    }

    private func showOverlay() {
        guard let window, overlay == nil else { return }
        let view = UIView(frame: window.bounds)
        view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.backgroundColor = SG.background

        let label = UILabel()
        label.text = "Screen capture is not permitted during this session."
        label.textColor = SG.mutedFg
        label.font = SG.sans(16, .semibold)
        label.adjustsFontForContentSizeCategory = true
        label.textAlignment = .center
        label.numberOfLines = 0
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            label.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 32),
            label.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -32),
        ])

        window.addSubview(view)
        overlay = view
        AuditLogger.shared.log(event: .screenRecordingStarted, metadata: nil)
    }

    private func hideOverlay() {
        guard overlay != nil else { return }
        overlay?.removeFromSuperview()
        overlay = nil
        AuditLogger.shared.log(event: .screenRecordingStopped, metadata: nil)
    }
}
