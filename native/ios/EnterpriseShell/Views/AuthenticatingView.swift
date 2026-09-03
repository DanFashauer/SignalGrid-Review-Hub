import SwiftUI
import UIKit

// MARK: - Hosting seam

extension AuthenticatingView {
    /// The ONE place `SessionStateManager`'s factory reaches SwiftUI for this
    /// screen. Returning a `UIViewController` keeps the state machine and
    /// `SceneDelegate` UIKit-only, exactly as `LockedIdleView.hostingController()`
    /// does. The factory calls this with no arguments — the UIKit
    /// `AuthenticatingViewController` took no init parameters, so there is nothing
    /// to read from `SessionStateManager.shared` here.
    static func hostingController() -> UIViewController {
        let host = UIHostingController(rootView: AuthenticatingView())
        host.view.backgroundColor = SG.background
        return host
    }
}

// MARK: - View

/// The authentication progress screen, rebuilt in SwiftUI — a byte-faithful port
/// of `AuthenticatingViewController` (Phase 1 view-layer rebuild pattern).
///
/// It is purely presentational: a spinner, the fixed title/status lines, an
/// animated progress bar, and a step label that advances through the four
/// authentication steps on a repeating timer while the state machine runs OIDC.
/// The UIKit screen holds NO log rows, NO NotificationCenter observers and NO
/// `SessionStateManager` reads — none are invented here. All behaviour (the 4.0s
/// four-step timer, the 0.2s cross-fade of the step label, and the animated
/// progress advance) lives in `AuthenticatingModel`, mirroring the UIKit
/// `startAnimation` / `stopAnimation` lifecycle.
///
/// Rendered in the ratified `SG` tokens (adaptive light/dark, Dynamic-Type text
/// styles) so the screen follows the device instead of pinning an appearance or a
/// point size.
struct AuthenticatingView: View {
    @StateObject private var model = AuthenticatingModel()

    var body: some View {
        ZStack {
            Color.sgBackground.ignoresSafeArea()

            GeometryReader { proxy in
                ScrollView {
                    VStack(spacing: 0) {
                        // UIActivityIndicatorView(style: .large), .systemBlue.
                        // No circular ProgressView size API on iOS, so .large is
                        // approximated with scaleEffect. It spins for as long as
                        // this view is on screen — i.e. between the UIKit screen's
                        // viewDidAppear and viewWillDisappear.
                        ProgressView()
                            .scaleEffect(1.5)
                            .tint(.sgPrimary)
                            .accessibilityHidden(true)

                        Text("Authenticating")
                            .font(SGType.title)                 // SG.sans(28, .bold)
                            .foregroundColor(.sgForeground)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.top, 24)

                        Text("Verifying your identity...")
                            .font(SGType.instruction)           // SG.sans(18, .medium)
                            .foregroundColor(.sgMutedFg)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.top, 12)

                        AuthProgressBar(value: model.progress)
                            .padding(.top, 32)

                        Text(model.stepText)
                            .font(SGType.body)                  // SG.sans(14, .regular)
                            .foregroundColor(.sgMutedFg)        // .tertiaryLabel (collapses to muted)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                            .opacity(model.stepOpacity)
                            .padding(.top, 24)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 40)                   // container leading 40 / trailing -40
                    .frame(maxWidth: .infinity, minHeight: proxy.size.height, alignment: .center) // centerY, scrolls at AX sizes
                }
            }
        }
        .sgKioskTypeCap()
        .onAppear { model.startAnimation() }                    // viewDidAppear
        .onDisappear { model.stopAnimation() }                  // viewWillDisappear
    }
}

// MARK: - Model (the UIKit screen's behaviour, verbatim)

/// Owns the authentication-step timer and derived progress/step state, mirroring
/// `AuthenticatingViewController`'s `startAnimation` / `stopAnimation` / `deinit`.
final class AuthenticatingModel: ObservableObject {
    private let authenticationSteps = [
        "Validating badge...",
        "Contacting authentication server...",
        "Verifying credentials...",
        "Establishing secure session..."
    ]

    /// 0...1 progress fill. Starts at 0 (UIKit `progressView.progress = 0`).
    @Published var progress: Double = 0
    /// Current step line. Starts at the first step (UIKit
    /// `stepLabel.text = authenticationSteps.first`).
    @Published var stepText: String
    /// Cross-fade alpha for the step label (UIKit animates `stepLabel.alpha`).
    @Published var stepOpacity: Double = 1

    private var stepIndex = 0
    private var progressTimer: Timer?

    init() {
        stepText = authenticationSteps.first ?? ""
    }

    deinit {
        progressTimer?.invalidate()
    }

    // MARK: Animation (verbatim from AuthenticatingViewController)

    func startAnimation() {
        let totalDuration: TimeInterval = 4.0
        let stepDuration = totalDuration / Double(authenticationSteps.count)

        progressTimer = Timer.scheduledTimer(withTimeInterval: stepDuration, repeats: true) { [weak self] timer in
            guard let self = self else {
                timer.invalidate()
                return
            }

            self.stepIndex += 1

            if self.stepIndex < self.authenticationSteps.count {
                // Fade the step label out, swap the text, fade it back in — the
                // UIKit two-stage 0.2s UIView.animate with its completion.
                withAnimation(.easeInOut(duration: 0.2)) { self.stepOpacity = 0 }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                    self.stepText = self.authenticationSteps[self.stepIndex]
                    withAnimation(.easeInOut(duration: 0.2)) { self.stepOpacity = 1 }
                }

                // Progress advances 0 -> 0.5 -> 0.75 -> 1.0 (never 0.25): the UIKit
                // arithmetic Float(stepIndex + 1) / count, animated. Do not "fix" it.
                let progress = Double(self.stepIndex + 1) / Double(self.authenticationSteps.count)
                withAnimation(.easeInOut) { self.progress = progress }
            } else {
                timer.invalidate()
            }
        }
    }

    func stopAnimation() {
        progressTimer?.invalidate()
    }
}

// MARK: - Progress bar

/// The linear progress indicator (UIKit `UIProgressView`, `.default` style).
/// `progressTintColor` → `.sgPrimary`, `trackTintColor` → `.sgBorder` (the brand
/// system forbids the original electric-blue / system-gray on branded chrome).
/// Built as two capsules so the fill and track colors stay in `SG` tokens; the
/// width change animates because the model wraps its `progress` write in
/// `withAnimation`, reproducing `setProgress(_:animated:)`.
private struct AuthProgressBar: View {
    var value: Double

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.sgBorder)
                Capsule().fill(Color.sgPrimary)
                    .frame(width: geo.size.width * CGFloat(min(max(value, 0), 1)))
            }
        }
        .frame(height: 4)
        .accessibilityHidden(true)
    }
}
