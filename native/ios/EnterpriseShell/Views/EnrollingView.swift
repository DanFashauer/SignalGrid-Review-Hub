import SwiftUI
import UIKit

// MARK: - Hosting seam

extension EnrollingView {
    /// The ONE place `SessionStateManager`'s factory reaches this SwiftUI screen.
    /// Mirrors `LockedIdleView.hostingController()`: returning a `UIViewController`
    /// keeps the state machine and `SceneDelegate` UIKit-only, so the cross-dissolve
    /// root swap and everything the window owns keep working unchanged.
    ///
    /// No init parameters. The UIKit `EnrollingViewController(badgeId:)` was handed
    /// `capturedBadgeId ?? "Unknown"` by the factory; the model reads the same
    /// `SessionStateManager.shared.capturedBadgeId`, with the identical `"Unknown"`
    /// fallback, so the masked value on screen is byte-for-byte what it was.
    static func hostingController() -> UIViewController {
        let host = UIHostingController(rootView: EnrollingView())
        host.view.backgroundColor = SG.background
        return host
    }
}

// MARK: - View

/// Shown when a scanned badge is not enrolled — the SwiftUI rebuild of
/// `EnrollingViewController`, following `LockedIdleView`'s pattern.
///
/// This screen is presentational and terminal: the served `/v1` surface has no
/// badge-enrollment route, so nothing is checked and nothing is waited on (the
/// UIKit screen's activity indicator was created `hidesWhenStopped` and only ever
/// stopped — it never appeared, so no spinner is rendered here). The guidance and
/// its two actions ARE the final state. Navigation is the state machine's job:
/// "Back to lock screen" asks `SessionStateManager` to transition, and the view
/// never drives a transition the UIKit screen did not.
struct EnrollingView: View {
    @StateObject private var model = EnrollingModel()

    var body: some View {
        ZStack {
            Color.sgBackground.ignoresSafeArea()

            ScrollView {
                VStack(spacing: 0) {
                    Image(systemName: "person.badge.key.fill")
                        .font(.largeTitle)
                        .imageScale(.large)
                        .foregroundColor(.sgPrimary)
                        .accessibilityHidden(true)
                        .padding(.top, 48)

                    Text("Badge Not Enrolled")
                        .font(SGType.title)
                        .foregroundColor(.sgForeground)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 24)
                        .padding(.horizontal, 20)

                    // Plain about what this device can and cannot do: the served /v1
                    // surface has no badge-enrollment route, so enrollment is an
                    // administrator's action in the SignalGrid console — never
                    // something this screen can finish or wait on.
                    Text("This badge is not enrolled. This backend does not support enrollment from the device — "
                        + "an administrator enrolls badges in the SignalGrid console. Try another badge, or go back to the lock screen.")
                        .font(SGType.body)
                        .foregroundColor(.sgMutedFg)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 16)
                        .padding(.horizontal, 32)

                    // Masked badge id, monospaced, on a raised card.
                    Text(model.badgeIdText)
                        .font(.system(.subheadline, design: .monospaced).weight(.medium))
                        .foregroundColor(.sgForeground)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 24)
                        .padding(.vertical, 14)
                        .frame(maxWidth: 250)
                        .sgCard()
                        .padding(.top, 24)
                        .accessibilityIdentifier("enrolling.badgeId")

                    Button(action: { model.retryTapped() }) {
                        Text("Back to lock screen")
                            .font(SGType.instruction)
                            .foregroundColor(.sgBackground)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, minHeight: 56)
                            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.sgPrimary))
                    }
                    .padding(.top, 48)
                    .padding(.horizontal, 24)
                    .accessibilityIdentifier("enrolling.retry")

                    Button(action: { model.contactAdminTapped() }) {
                        Text("Contact Administrator")
                            .font(SGType.bodyEmphasis)
                            .foregroundColor(.sgPrimary)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.top, 16)
                    .padding(.horizontal, 24)
                    .padding(.bottom, 24)
                    .accessibilityIdentifier("enrolling.help")
                }
                .frame(maxWidth: .infinity)
            }
        }
        .sgKioskTypeCap()
    }
}

// MARK: - Model (the UIKit screen's behaviour, verbatim)

/// Owns the derived masked-badge string and the two actions. There are no
/// observers or timers to keep alive — the UIKit screen had none — so no `deinit`
/// teardown is needed; the badge id is read once, exactly as the UIKit `init` read
/// its `badgeId` parameter.
final class EnrollingModel: ObservableObject {
    /// "Badge ID: XX****YY" — derived once, from the same source and with the same
    /// `"Unknown"` fallback the factory passed the UIKit `init(badgeId:)`.
    let badgeIdText: String

    init() {
        let badgeId = SessionStateManager.shared.capturedBadgeId ?? "Unknown"
        badgeIdText = "Badge ID: \(Self.maskBadgeId(badgeId))"
    }

    // MARK: Actions

    func retryTapped() {
        // Transition back to locked idle to try another badge.
        SessionStateManager.shared.transition(to: .lockedIdle)
    }

    func contactAdminTapped() {
        // Show contact information or help.
        showHelpAlert()
    }

    // MARK: Help alert (the UIKit screen's alert, verbatim)

    private func showHelpAlert() {
        let alert = UIAlertController(
            title: "Need Help?",
            message: "Please contact your IT administrator to enroll your badge. You may need to provide your employee information and the badge ID shown on screen.",
            preferredStyle: .alert
        )

        alert.addAction(UIAlertAction(title: "OK", style: .default))

        if let email = getAdminEmail() {
            alert.addAction(UIAlertAction(title: "Email IT Support", style: .default) { [weak self] _ in
                self?.openMailTo(email: email)
            })
        }

        presentAlert(alert)
    }

    private func getAdminEmail() -> String? {
        // Could be stored in configuration or retrieved from backend.
        return nil
    }

    private func openMailTo(email: String) {
        if let url = URL(string: "mailto:\(email)") {
            UIApplication.shared.open(url)
        }
    }

    static func maskBadgeId(_ badgeId: String) -> String {
        guard badgeId.count > 4 else {
            return "****"
        }
        let prefix = badgeId.prefix(2)
        let suffix = badgeId.suffix(2)
        return "\(prefix)****\(suffix)"
    }

    // MARK: Alert presentation

    /// Present through the hosting controller, mirroring `LockedIdleModel`. This
    /// screen is the window's root, so a `UIAlertController` (with its conditional
    /// "Email IT Support" action) keeps the exact UIKit behaviour on the iOS 15
    /// target.
    private func presentAlert(_ alert: UIAlertController) {
        guard let presenter = Self.topPresenter() else { return }
        presenter.present(alert, animated: true)
    }

    private static func topPresenter() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let window = scenes.flatMap { $0.windows }.first { $0.isKeyWindow } ?? scenes.first?.windows.first
        var top = window?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }
}
