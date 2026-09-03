import SwiftUI
import UIKit

// MARK: - Hosting seam

extension BadgeCapturedView {
    /// The ONE place `SessionStateManager`'s factory reaches this SwiftUI screen.
    /// Returning a `UIViewController` keeps the state machine and `SceneDelegate`
    /// UIKit-only: the cross-dissolve root swap, `SessionWindow`, `ScreenCaptureGuard`
    /// and the ASAM re-assert all keep working unchanged. No init parameters — the
    /// factory calls this with no args, so the badge id is read from
    /// `SessionStateManager.shared.capturedBadgeId` inside the model (see below),
    /// exactly where the UIKit `init(badgeId:)` used to take it.
    static func hostingController() -> UIViewController {
        let host = UIHostingController(rootView: BadgeCapturedView())
        host.view.backgroundColor = SG.background
        return host
    }
}

// MARK: - View

/// Shown immediately after a badge is captured — SwiftUI port of
/// `BadgeCapturedViewController`, part of the view-layer rebuild.
///
/// Presentational: the state machine drives navigation. This screen makes exactly
/// the two transitions the UIKit screen made — a guarded auto-advance to
/// `.authenticating` a beat after appearing (so the holder sees the recognized
/// badge first), and Cancel → `.lockedIdle` — both carried in `BadgeCapturedModel`.
///
/// Rendered in the ratified `SG` tokens (adaptive light/dark, WCAG-AA) and
/// Dynamic-Type text styles, so it follows the device instead of pinning an
/// appearance or a point size. The masked badge id is formatted exactly as the
/// UIKit screen formatted it.
struct BadgeCapturedView: View {
    @StateObject private var model = BadgeCapturedModel()
    /// Drives the icon's spring-in (UIKit animated `iconView` from 0.1 to identity).
    @State private var iconScale: CGFloat = 0.1

    var body: some View {
        ZStack {
            Color.sgBackground.ignoresSafeArea()

            GeometryReader { proxy in
                ScrollView {
                    VStack(spacing: 0) {
                        // Success icon — an 80×80 fixed size, matching the UIKit
                        // constraint, animated in with a spring on appear.
                        Image(systemName: "checkmark.circle.fill")
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                            .frame(width: 80, height: 80)
                            .foregroundColor(.sgAccent)
                            .scaleEffect(iconScale)
                            .accessibilityHidden(true)

                        Text("Badge Recognized")
                            .font(SGType.title)
                            .foregroundColor(.sgForeground)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.top, 20)

                        Text(model.badgeText)
                            .font(SGType.mono)                     // SG.mono(16) — scales
                            .foregroundColor(.sgMutedFg)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.top, 8)

                        Text("Authenticating...")
                            .font(SGType.instruction)
                            .foregroundColor(.sgMutedFg)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.top, 24)

                        Button(action: { model.cancelTapped() }) {
                            Text("Cancel")
                                .font(SGType.calloutEmphasis)
                                .foregroundColor(.sgPrimary)
                                .multilineTextAlignment(.center)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(.top, 40)
                        .accessibilityIdentifier("badgeCaptured.cancel")
                    }
                    .padding(.horizontal, 40)
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: proxy.size.height)
                }
            }
        }
        .sgKioskTypeCap()
        .onAppear {
            model.onAppear()
            withAnimation(.spring(response: 0.5, dampingFraction: 0.6)) {
                iconScale = 1.0
            }
        }
    }
}

// MARK: - Model (the UIKit screen's behaviour, verbatim)

final class BadgeCapturedModel: ObservableObject {
    /// "Badge ID: XX****YY", masked exactly as the UIKit screen masked it. Read
    /// once from the captured badge, which never changes while this screen is up —
    /// the UIKit view took it as an `init(badgeId:)` param and did the same.
    let badgeText: String

    init() {
        let badgeId = SessionStateManager.shared.capturedBadgeId ?? ""
        badgeText = "Badge ID: \(Self.maskBadgeId(badgeId))"
    }

    /// Advance from badge-captured to authentication. Previously nothing drove this
    /// transition, so the session dead-ended here showing "Authenticating…" without
    /// ever authenticating. Brief delay lets the user see the recognized badge
    /// first; guarded so a Cancel tap can't race it. (UIKit `viewDidAppear`.)
    func onAppear() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
            guard SessionStateManager.shared.currentState == .badgeCaptured else { return }
            SessionStateManager.shared.transition(to: .authenticating)
        }
    }

    /// UIKit `cancelTapped`.
    func cancelTapped() {
        SessionStateManager.shared.transition(to: .lockedIdle)
    }

    private static func maskBadgeId(_ badgeId: String) -> String {
        guard badgeId.count > 4 else { return "****" }
        let prefix = String(badgeId.prefix(2))
        let suffix = String(badgeId.suffix(2))
        return "\(prefix)****\(suffix)"
    }
}
