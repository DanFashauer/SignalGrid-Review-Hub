import SwiftUI
import UIKit

// MARK: - Hosting seam

extension ProvisioningView {
    /// The ONE place `SessionStateManager`'s factory reaches this SwiftUI screen —
    /// mirrors `LockedIdleView.hostingController()`. The provisioning VC took no
    /// init parameters, so this takes none either; the factory calls it with no
    /// args and the state machine (not this view) drives navigation to
    /// `.activeSession` when `provisionSession()` completes.
    static func hostingController() -> UIViewController {
        let host = UIHostingController(rootView: ProvisioningView())
        host.view.backgroundColor = SG.background
        return host
    }
}

// MARK: - View

/// The provisioning / progress screen, rebuilt in SwiftUI — the view-layer rebuild.
///
/// A byte-faithful port of `ProvisioningViewController`: the same title and status
/// copy, the same five provisioning steps, and the same staggered reveal — each step
/// fades from dim to full and its hollow circle becomes a filled check on a cumulative
/// 0.8s stagger, animated over 0.3s, exactly as the UIKit `startProvisioningAnimation`
/// loop did. It is PRESENTATIONAL: the UIKit screen logged nothing, observed nothing,
/// read no session state and made no transition, and neither does this. Rendered in the
/// ratified `SG` tokens (adaptive light/dark, WCAG-AA) and Dynamic-Type text styles.
struct ProvisioningView: View {
    @StateObject private var model = ProvisioningModel()

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                // UIActivityIndicatorView(style: .large), started, in the SG accent.
                ProvisioningActivityIndicator()
                    .padding(.top, 100)
                    .accessibilityHidden(true)

                Text("Setting Up Workspace")
                    .font(SGType.title)                         // SG.sans(28, .bold)
                    .foregroundColor(.sgForeground)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 20)
                    .padding(.top, 24)

                Text("Preparing your session...")
                    .font(SGType.instruction)                   // SG.sans(18, .medium)
                    .foregroundColor(.sgMutedFg)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 20)
                    .padding(.top, 12)

                VStack(spacing: 12) {                           // stepsStackView spacing
                    ForEach(Array(model.steps.enumerated()), id: \.offset) { index, step in
                        stepRow(index: index, step: step)
                    }
                }
                .padding(.horizontal, 40)                       // stepsStackView insets
                .padding(.top, 40)
            }
            .frame(maxWidth: .infinity)
        }
        .background(Color.sgBackground.ignoresSafeArea())
        .sgKioskTypeCap()
        .onAppear { model.onAppear() }
    }

    /// One step row: a 24pt status icon and the step label. Both live inside the
    /// row's opacity, so the 0.5 → 1.0 fade lifts the whole row exactly as the
    /// UIKit container's `alpha` animation did.
    private func stepRow(index: Int, step: String) -> some View {
        let done = model.completed[index]
        return HStack(alignment: .center, spacing: 12) {
            // Completed → filled check in the brand ACCENT (not sgAllow): a
            // provisioning step finishing is not an allow/deny verdict, and "risk
            // colours only for decisions" (DesignSystem.swift) — TerminatingView uses
            // sgAccent for the same "done" semantic, so this matches it. Pending → a
            // faint placeholder ring in the border token, so pending RECEDES and the
            // completed check advances (the staggered reveal exists to show that
            // hierarchy); sgMutedFg would render the pending ring as heavy as readable
            // status text and flatten the distinction.
            Image(systemName: done ? "checkmark.circle.fill" : "circle")
                .resizable()
                .scaledToFit()
                .frame(width: 24, height: 24)
                .foregroundColor(done ? .sgAccent : .sgBorder)
                .accessibilityHidden(true)
            Text(step)
                .font(SGType.callout)                           // SG.sans(16)
                .foregroundColor(.sgForeground)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .opacity(done ? 1.0 : 0.5)                              // stepView.alpha 0.5 → 1.0
    }
}

// MARK: - Model (the UIKit screen's animation loop, verbatim)

/// Owns the staggered reveal that `ProvisioningViewController.startProvisioningAnimation`
/// ran in `viewDidAppear`. The UIKit loop walked the step views, adding 0.8s to a
/// cumulative delay per step and animating each over 0.3s — flipping the row to full
/// opacity and its circle to a filled green check. This reproduces that timing exactly.
final class ProvisioningModel: ObservableObject {
    /// The five provisioning steps, top to bottom — VERBATIM from
    /// `ProvisioningViewController.provisioningSteps`.
    let steps = [
        "Loading user profile...",
        "Applying role permissions...",
        "Launching enterprise apps...",
        "Configuring workspace...",
        "Syncing data..."
    ]

    /// One flag per step: false = pending (dim row, hollow circle), true = complete
    /// (full-opacity row, filled green check). Revealed on the stagger below.
    @Published var completed: [Bool]

    /// The UIKit screen's animation constants, preserved.
    private static let stepInterval: TimeInterval = 0.8   // `delay += 0.8` per step
    private static let revealDuration: TimeInterval = 0.3 // `UIView.animate(withDuration: 0.3 …)`

    private var started = false
    private var pending: [DispatchWorkItem] = []

    init() {
        completed = Array(repeating: false, count: steps.count)
    }

    deinit {
        pending.forEach { $0.cancel() }
    }

    /// Started once when the screen appears — `viewDidAppear` created a fresh VC each
    /// entry, so a single run matches the observed behaviour. Schedules each step's
    /// reveal at its cumulative delay (0.8, 1.6, 2.4, 3.2, 4.0s), animated over 0.3s
    /// with ease-in-out, exactly as the UIKit loop did.
    func onAppear() {
        guard !started else { return }
        started = true

        var delay: TimeInterval = 0
        for index in steps.indices {
            delay += Self.stepInterval
            let work = DispatchWorkItem { [weak self] in
                withAnimation(.easeInOut(duration: Self.revealDuration)) {
                    self?.completed[index] = true
                }
            }
            pending.append(work)
            DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
        }
    }
}

// MARK: - Activity indicator (the one UIKit-only bit)

/// `UIActivityIndicatorView` has no first-class SwiftUI equal at the iOS 15 target,
/// so the UIKit widget the port used is wrapped verbatim — the large style, started,
/// tinted with the `SG.accent` brand token (the adaptive/AA source `Color.sgAccent`
/// itself derives from; a UIKit view can only take a `UIColor`).
struct ProvisioningActivityIndicator: UIViewRepresentable {
    func makeUIView(context: Context) -> UIActivityIndicatorView {
        let indicator = UIActivityIndicatorView(style: .large)
        indicator.color = SG.accent
        indicator.startAnimating()
        return indicator
    }

    func updateUIView(_ uiView: UIActivityIndicatorView, context: Context) {}
}
