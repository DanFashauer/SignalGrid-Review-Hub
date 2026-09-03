import SwiftUI
import UIKit

// MARK: - Hosting seam

extension TerminatingView {
    /// The ONE place `SessionStateManager`'s factory reaches this SwiftUI screen.
    /// Returning a `UIViewController` keeps the state machine and `SceneDelegate`
    /// UIKit-only, exactly as `LockedIdleView.hostingController()` does. No init
    /// parameters: the UIKit `TerminatingViewController` took none, so there is
    /// nothing to read from `SessionStateManager.shared` here.
    static func hostingController() -> UIViewController {
        let host = UIHostingController(rootView: TerminatingView())
        host.view.backgroundColor = SG.background
        return host
    }
}

// MARK: - View

/// The teardown screen, rebuilt in SwiftUI — a byte-faithful behavioural port of
/// `TerminatingViewController`.
///
/// It is purely presentational: the original had no `os_log`, no
/// `AuditLogger` rows, no `NotificationCenter` observers, and read no state — it
/// simply ran a timed teardown animation. The state machine (`SessionStateManager`)
/// drives navigation away from this screen; the view never triggers a transition.
///
/// Rendered in the ratified `SG` tokens (adaptive light/dark, WCAG-AA) and
/// Dynamic-Type text styles, so the screen follows the device instead of pinning an
/// appearance or a point size. Colors map to brand tokens rather than the source's
/// system colors, following the reference screen's idiom (progress → `.sgMutedFg`,
/// complete → `.sgAccent`): a completion confirmation is not an allow/deny verdict,
/// so no risk color is used (DesignSystem.swift, "risk colors only for decisions").
struct TerminatingView: View {
    @StateObject private var model = TerminatingModel()

    var body: some View {
        ZStack {
            Color.sgBackground.ignoresSafeArea()

            ScrollView {
                VStack(spacing: 0) {
                    // Hero activity indicator (source: large, `.systemOrange`). Kept in
                    // the layout when complete — opacity toggles, matching the UIKit
                    // hidden-but-framed `stopAnimating()` so the title does not jump.
                    ProgressView()
                        .scaleEffect(1.6)
                        .tint(.sgAccent)
                        .opacity(model.isComplete ? 0 : 1)
                        .padding(.top, 100)
                        .accessibilityHidden(true)

                    Text("Ending Session")
                        .font(SGType.title)                       // SG.sans(28, .bold)
                        .foregroundColor(.sgForeground)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 24)
                        .padding(.horizontal, 20)

                    Text(model.statusText)
                        .font(SGType.instruction)                 // SG.sans(18, .medium)
                        .foregroundColor(model.isComplete ? .sgAccent : .sgMutedFg)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 12)
                        .padding(.horizontal, 20)
                        .accessibilityIdentifier("terminating.status")

                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(Array(TerminatingModel.terminationSteps.enumerated()), id: \.offset) { index, step in
                            stepRow(step: step, phase: model.stepPhases[index])
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 40)
                    .padding(.horizontal, 40)
                    .padding(.bottom, 24)
                }
                .frame(maxWidth: .infinity)
            }
        }
        .sgKioskTypeCap()
        .onAppear { model.onAppear() }
    }

    /// One termination step. Source: a hidden stopped spinner that starts, fades,
    /// then reveals a green `checkmark.circle.fill`; the dim (alpha 0.5) row
    /// brightens to full when it completes. The gray "circle" placeholder in the
    /// source is never actually shown (created `isHidden`, its image swapped to the
    /// checkmark at the instant it un-hides), so nothing renders for the pending slot.
    @ViewBuilder
    private func stepRow(step: String, phase: TerminatingModel.StepPhase) -> some View {
        HStack(alignment: .center, spacing: 12) {
            // Fixed-width leading slot keeps the labels aligned across phases, the
            // way the source's constant-size activity indicator held the column.
            ZStack {
                switch phase {
                case .pending:
                    EmptyView()
                case .inProgress:
                    ProgressView()
                        .tint(.sgMutedFg)
                case .done:
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundColor(.sgAccent)
                }
            }
            .frame(width: 24, height: 24)
            .accessibilityHidden(true)

            Text(step)
                .font(SGType.callout)                             // SG.sans(16)
                .foregroundColor(.sgForeground)
                .fixedSize(horizontal: false, vertical: true)

            Spacer(minLength: 0)
        }
        .opacity(phase == .done ? 1.0 : 0.5)
    }
}

// MARK: - Model (the UIKit screen's behaviour, verbatim)

final class TerminatingModel: ObservableObject {
    /// Per-step visual phase. `pending` renders nothing (the source's gray circle
    /// never appears), `inProgress` a spinner, `done` a checkmark.
    enum StepPhase {
        case pending
        case inProgress
        case done
    }

    /// The four teardown steps, in order — verbatim from `TerminatingViewController`.
    static let terminationSteps = [
        "Revoking authentication tokens...",
        "Clearing session data...",
        "Sending audit logs...",
        "Securing device..."
    ]

    @Published var statusText: String = "Securely closing your session..."
    @Published var isComplete: Bool = false
    @Published var stepPhases: [StepPhase] =
        Array(repeating: .pending, count: TerminatingModel.terminationSteps.count)

    /// The source's `viewDidAppear` restarted the whole animation on every
    /// appearance. SwiftUI's `.onAppear` can fire more than once for a hosted root,
    /// so a single-run guard keeps the teardown sequence to one pass — the screen is
    /// shown once and animates once.
    private var hasStarted = false

    func onAppear() {
        guard !hasStarted else { return }
        hasStarted = true
        startTerminationAnimation()
    }

    /// The teardown sequence, timing-faithful to the source:
    ///  • `delay += 0.6` per step (steps resolve at 0.6 / 1.2 / 1.8 / 2.4 s);
    ///  • completion at `delay + 1.0` (= 3.4 s) stops the hero spinner and flips the
    ///    status line to the secured message;
    ///  • the trailing `+ 1.0` `asyncAfter` is preserved as a no-op — the state
    ///    transition is owned by `SessionStateManager`.
    private func startTerminationAnimation() {
        // Each step's leading slot stays EMPTY until its own moment; then a spinner
        // flashes ~0.2 s before resolving to a checkmark. The source started each
        // step's indicator only INSIDE its delayed block (not all at once at t=0),
        // and its 0.2 s alpha fade revealed the check just after the delay elapsed.
        var delay: TimeInterval = 0

        for index in Self.terminationSteps.indices {
            delay += 0.6
            let stepDelay = delay
            DispatchQueue.main.asyncAfter(deadline: .now() + stepDelay) { [weak self] in
                self?.stepPhases[index] = .inProgress          // spinner appears at its moment
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + stepDelay + 0.2) { [weak self] in
                guard let self = self else { return }
                withAnimation(.easeInOut(duration: 0.3)) {
                    self.stepPhases[index] = .done             // ~0.2 s later, the checkmark
                }
            }
        }

        // Return to locked state after all steps complete.
        DispatchQueue.main.asyncAfter(deadline: .now() + delay + 1.0) { [weak self] in
            guard let self = self else { return }
            withAnimation {
                self.isComplete = true
                self.statusText = "Session ended securely"
            }

            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                // State transition is handled by SessionStateManager
            }
        }
    }
}
