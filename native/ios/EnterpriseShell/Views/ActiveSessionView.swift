import SwiftUI
import UIKit

// MARK: - Hosting seam

extension ActiveSessionView {
    /// The ONE place `SessionStateManager`'s factory reaches this SwiftUI screen —
    /// mirrors `LockedIdleView.hostingController()`. The active-session VC took no
    /// init parameters, so this takes none either; everything is read from
    /// `SessionStateManager.shared` inside `ActiveSessionModel`, exactly where the
    /// UIKit screen read it through its `session` computed property. Returning a
    /// `UIViewController` keeps the state machine and `SceneDelegate` UIKit-only.
    static func hostingController() -> UIViewController {
        let host = UIHostingController(rootView: ActiveSessionView())
        host.view.backgroundColor = SG.background
        return host
    }
}

// MARK: - View

/// The active-session workspace home, rebuilt in SwiftUI — the view-layer rebuild's
/// port of `ActiveSessionViewController`.
///
/// A faithful port of the UIKit workspace: the profile header (tenant-themed fill),
/// the session status bar with the live countdown, the required/available app grids
/// launched into the contained managed browser (or through `AppLauncher` for native
/// deep links), the four quick actions, and the persona's session restrictions.
///
/// Behaviour is the UIKit screen's, carried in `ActiveSessionModel`: the same
/// `app_launched` audit row, the same managed-webview containment branch, the same
/// `endSession` / `refreshActiveSession` / `userDidInteract` calls, the same
/// simulator demo auto-opens (once per session) and `.kioskReleaseFailed` recovery
/// alert. Rendered in the ratified `SG` tokens (adaptive light/dark, WCAG-AA) and
/// Dynamic-Type text styles, so it follows the device instead of pinning an
/// appearance or a point size.
struct ActiveSessionView: View {
    @StateObject private var model = ActiveSessionModel()

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                profileHeader
                sessionStatusBar

                VStack(alignment: .leading, spacing: 0) {
                    sectionHeader("Required Apps")
                        .padding(.top, 20)
                    appGrid(model.requiredApps)
                        .padding(.top, 8)

                    sectionHeader("Available Apps")
                        .padding(.top, 20)
                    appGrid(model.optionalApps)
                        .padding(.top, 8)

                    sectionHeader("Quick Actions")
                        .padding(.top, 20)
                    quickActions
                        .padding(.top, 12)

                    sectionHeader("Session Restrictions")
                        .padding(.top, 24)
                    restrictions
                        .padding(.top, 12)
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 32)
            }
            .frame(maxWidth: .infinity)
        }
        .background(Color.sgBackground.ignoresSafeArea())
        // The overlay goes INSIDE the type cap (cap applied last, outermost): otherwise
        // the toast is a sibling above the capped subtree and its text scales unbounded
        // at AX4/AX5 while the rest of the screen is clamped.
        .overlay(alignment: .bottom) { toastOverlay }
        .sgKioskTypeCap()
        .onAppear { model.onAppear() }
        .onDisappear { model.onDisappear() }
    }

    // MARK: Profile header

    /// The tenant-themed header. The fill is a tenant-supplied hex (see
    /// `ActiveSessionModel.headerColor`), not an SG token, so its text can't use an SG
    /// foreground (which is adaptive and would be wrong on a fixed brand fill). The
    /// UIKit screen pinned white, which fails WCAG on a light tenant `primaryColor`;
    /// `model.headerTextColor` picks white or a fixed charcoal ink by the fill's
    /// luminance so all four labels stay legible whatever the tenant brand colour is.
    private var profileHeader: some View {
        let ink = model.headerTextColor
        return VStack(alignment: .leading, spacing: 0) {
            Circle()
                .fill(ink.opacity(0.2))
                .frame(width: 80, height: 80)
                .overlay(Circle().stroke(ink, lineWidth: 2))
                .overlay(
                    Text(model.initials)
                        .font(SGType.title)                       // SG.sans(28, .bold)
                        .foregroundColor(ink)
                )
                .padding(.bottom, 12)
                .accessibilityHidden(true)

            Text(model.roleName)
                .font(.title2.weight(.bold))                      // SG.sans(22, .bold)
                .foregroundColor(ink)
                .fixedSize(horizontal: false, vertical: true)

            Text(model.roleLine)
                .font(SGType.calloutEmphasis)                     // SG.sans(16, .medium)
                .foregroundColor(ink.opacity(0.9))
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 4)

            Text(model.userIdLine)
                .font(SGType.body)                                // SG.sans(14, .regular)
                .foregroundColor(ink.opacity(0.8))
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 2)
        }
        .padding(.horizontal, 20)
        .padding(.top, 40)
        .padding(.bottom, 20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(model.headerColor)
    }

    // MARK: Session status bar

    private var sessionStatusBar: some View {
        HStack(spacing: 8) {
            Image(systemName: "clock.fill")
                .foregroundColor(.sgAccent)
                .accessibilityHidden(true)
            Text("Session Active")
                .font(SGType.bodyEmphasis)                        // SG.sans(14, .medium)
                .foregroundColor(.sgForeground)
                .fixedSize(horizontal: false, vertical: true)

            Spacer(minLength: 12)

            // Countdown digits are monospaced-tabular so the layout does not jitter
            // as the seconds tick (the UIKit source used SG.monoDigits).
            Text(model.timerText)
                .font(SGType.bodyEmphasis.monospacedDigit())
                .foregroundColor(model.timerColor)
                .fixedSize(horizontal: false, vertical: true)

            // Destructive-confirm affordance: `sgDeny`/`sgOnDeny` is the platform
            // meaning of an irreversible action, not a decision verdict, ordinary
            // chrome, "done" state or accent — so it keeps the risk pairing.
            Button(action: { model.endSessionTapped() }) {
                Text("End Session")
                    .font(.subheadline.weight(.semibold))         // SG.sans(14, .semibold)
                    .foregroundColor(.sgOnDeny)
                    .lineLimit(nil)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .frame(minWidth: 100)
                    .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.sgDeny))
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("activeSession.endSession")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, minHeight: 56)
        .background(Color.sgCard)
    }

    // MARK: Sections

    private func sectionHeader(_ title: String) -> some View {
        Text(title)
            .font(.title3.weight(.bold))                          // SG.sans(18, .bold)
            .foregroundColor(.sgForeground)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// The required / available app tiles. The UIKit screen used horizontal
    /// collection views; per the port brief this is a `LazyVGrid`. Headers render
    /// unconditionally, matching the UIKit screen (an empty app list still shows its
    /// header). Tiles grow (`minHeight`, wrapping name) instead of clipping at
    /// accessibility text sizes.
    private func appGrid(_ apps: [EnterpriseApp]) -> some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: 96), spacing: 12)],
            alignment: .leading,
            spacing: 12
        ) {
            ForEach(apps, id: \.appId) { app in
                appTile(app)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func appTile(_ app: EnterpriseApp) -> some View {
        Button(action: { model.appTapped(app) }) {
            VStack(spacing: 8) {
                ZStack {
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .fill(Color.sgPrimary.opacity(0.18))
                        .frame(width: 60, height: 60)
                    Image(systemName: "app.fill")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 32, height: 32)
                        .foregroundColor(.sgAccent)
                }
                Text(app.displayName)
                    .font(SGType.caption)                         // SG.sans(12, .medium)
                    .foregroundColor(.sgForeground)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, minHeight: 120, alignment: .top)
            .overlay(alignment: .topTrailing) {
                // A link-type marker only: a filled dot for a native deep link, a
                // muted dot for a managed-web app. `sgAllow` here (the UIKit source)
                // encoded link type in the decision palette — purged to chrome tokens.
                Circle()
                    .fill(app.isDeepLink ? Color.sgAccent : Color.sgMutedFg)
                    .frame(width: 8, height: 8)
                    .padding(.top, 4)
                    .padding(.trailing, 4)
                    .accessibilityHidden(true)
            }
        }
        .buttonStyle(.plain)
    }

    /// Lock, Host App, Refresh, Help — the four quick actions, in the UIKit order,
    /// with the same SF Symbols and titles.
    private var quickActions: some View {
        HStack(spacing: 12) {
            quickAction(icon: "lock.fill", title: "Lock") { model.lockDeviceTapped() }
            quickAction(icon: "cross.case.fill", title: "Host App") { model.hostAppTapped() }
            quickAction(icon: "arrow.clockwise", title: "Refresh") { model.refreshSessionTapped() }
            quickAction(icon: "questionmark.circle.fill", title: "Help") { model.helpTapped() }
        }
        .frame(maxWidth: .infinity)
    }

    private func quickAction(icon: String, title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 8) {
                Image(systemName: icon)
                    .resizable()
                    .scaledToFit()
                    .frame(width: 24, height: 24)
                    .foregroundColor(.sgAccent)
                Text(title)
                    .font(SGType.caption)                         // SG.sans(12, .medium)
                    .foregroundColor(.sgAccent)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.7)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, minHeight: 80)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.sgAccent.opacity(0.15)))
        }
        .buttonStyle(.plain)
    }

    private var restrictions: some View {
        VStack(spacing: 8) {
            ForEach(model.restrictionItems) { item in
                HStack(spacing: 12) {
                    Image(systemName: item.icon)
                        .resizable()
                        .scaledToFit()
                        .frame(width: 20, height: 20)
                        .foregroundColor(.sgAccent)               // accent for every row, per the source
                        .accessibilityHidden(true)
                    Text(item.title)
                        .font(SGType.bodyEmphasis)                // SG.sans(14, .medium)
                        .foregroundColor(.sgForeground)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 12)
                    Text(item.value)
                        .font(SGType.body)                        // SG.sans(14, .regular)
                        .foregroundColor(.sgMutedFg)
                        .multilineTextAlignment(.trailing)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.sgCard))
            }
        }
    }

    // MARK: Toast

    @ViewBuilder
    private var toastOverlay: some View {
        if let toast = model.toast {
            // A transient "done" state — not a decision verdict — so it uses chrome
            // tokens (the UIKit source used the allow/deny palette here).
            Text(toast.message)
                .font(SGType.bodyEmphasis)
                .foregroundColor(toast.ok ? .sgAccent : .sgForeground)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .padding(12)
                .frame(maxWidth: 250)
                .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.sgCard))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(Color.sgBorder, lineWidth: 1))
                .padding(.bottom, 20)
                .transition(.opacity)
                .accessibilityIdentifier("activeSession.toast")
        }
    }
}

// MARK: - Model (the UIKit screen's behaviour, verbatim)

/// Owns everything `ActiveSessionViewController` owned: the derived session/persona
/// state, the 1s display timer that ticks the countdown, the quick-action and
/// app-tile actions, the simulator demo auto-opens, and the `.kioskReleaseFailed`
/// recovery alert. The UIKit-only host screens (`HostAppViewController`,
/// `ManagedAppViewController`) and every `UIAlertController` are presented through a
/// top-presenter helper, exactly as `LockedIdleModel` does.
final class ActiveSessionModel: ObservableObject {
    /// A transient bottom toast (refresh outcome). Nil when nothing is shown.
    struct ToastState { let message: String; let ok: Bool }

    /// One session-restriction row.
    struct RestrictionItem: Identifiable {
        // Stable identity keyed on the (unique) title. The row set is fixed and the 1s
        // timer republishes @Published state each tick, so a fresh UUID() per access
        // would make ForEach tear down and rebuild all rows every second.
        var id: String { title }
        let icon: String
        let title: String
        let value: String
    }

    /// Read live from the manager each access — the UIKit screen's `session`
    /// computed property, verbatim. The session does not change while this screen is
    /// up, but the timer re-reads it every tick exactly as the source did.
    private var session: SessionData? {
        SessionStateManager.shared.currentSession
    }

    @Published var timerText: String = "--:--:--"
    @Published var timerColor: Color = .sgAccent
    @Published var toast: ToastState?

    // The UIKit screen's 1s countdown timer. NOTE: the source ALSO declared a
    // `sessionTimer` property but never assigned it (its `stopTimers()` invalidated a
    // nil); only `displayTimer` ever existed, so only it is ported. No second
    // session/timeout timer is invented — that would add a side effect the screen
    // never had.
    private var displayTimer: Timer?

    // Once-per-session demo latches: the source guarded against re-presenting on
    // every reappearance. Instance-scoped, so a new session (a new hosting
    // controller, a new model) resets them — matching the UIKit VC's lifetime.
    private var didAutoOpenApp = false
    private var didAutoOpenAssist = false

    private var observers: [NSObjectProtocol] = []
    private var toastWork: DispatchWorkItem?

    init() {
        // A refused kiosk (ASAM) release leaves the holder trapped in the shell while
        // the session is already active: observe the failure signal KioskController
        // posts and surface recovery guidance. (UIKit `viewDidLoad`.)
        observers.append(NotificationCenter.default.addObserver(
            forName: .kioskReleaseFailed, object: nil, queue: .main
        ) { [weak self] _ in
            let alert = UIAlertController(
                title: "Device still locked",
                message: "The kiosk could not be released, so this device remains in Single App Mode. "
                    + "Try again from Settings, or contact an administrator — "
                    + "MDM supervision may need to re-apply the release.",
                preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "OK", style: .default))
            self?.present(alert)
        })
    }

    deinit {
        observers.forEach { NotificationCenter.default.removeObserver($0) }
        displayTimer?.invalidate()
        toastWork?.cancel()
    }

    // MARK: Lifecycle

    func onAppear() {
        updateSessionTimer()      // UIKit `viewWillAppear`
        startTimers()             // UIKit `viewDidLoad` -> `startTimers`
        runSimulatorDemoIfNeeded()// UIKit `viewDidAppear`
    }

    func onDisappear() {
        stopTimers()              // UIKit `viewWillDisappear`
    }

    // MARK: Derived state (read from the live session)

    var initials: String { Self.getInitials(from: session?.persona.roleName ?? "") }
    var roleName: String { session?.persona.roleName ?? "" }
    var roleLine: String { "Role: \(session?.persona.roleName ?? "")" }
    var userIdLine: String { "User ID: \(session?.userId ?? "")" }

    /// The tenant theme's primary colour, parsed from its hex string, falling back to
    /// the SG brand primary — exactly the UIKit screen's `UIColor(hex:) ?? SG.primary`.
    var headerColor: Color {
        if let hex = session?.persona.workspaceConfig.theme.primaryColor,
           let color = Self.color(fromHex: hex) {
            return color
        }
        return .sgPrimary
    }

    /// Legible text colour for the tenant header fill: white on a dark fill, a fixed
    /// charcoal ink on a light one, chosen by the fill's relative luminance. Fixed,
    /// not the adaptive `sgForeground`, because the fill is tenant-controlled rather
    /// than the app's light/dark surface. The `.sgPrimary` fallback (no tenant hex) is
    /// dark in both appearances, so a nil luminance defaults to white.
    var headerTextColor: Color {
        // Bind the optional String first, so `.flatMap` is Optional.flatMap (String? ->
        // Double?), not Sequence.flatMap over the String's characters.
        let hex: String? = session?.persona.workspaceConfig.theme.primaryColor
        let lum = hex.flatMap(Self.relativeLuminance(fromHex:)) ?? 0.0
        return lum > 0.6 ? Color(.sRGB, red: 0.082, green: 0.094, blue: 0.106, opacity: 1.0) : .white
    }

    /// sRGB-weighted relative luminance (0…1) of a `#RRGGBB` hex — enough to pick a
    /// legible text colour over the fill.
    private static func relativeLuminance(fromHex hex: String) -> Double? {
        var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        s = s.replacingOccurrences(of: "#", with: "")
        var rgb: UInt64 = 0
        guard Scanner(string: s).scanHexInt64(&rgb) else { return nil }
        let r = Double((rgb & 0xFF0000) >> 16) / 255.0
        let g = Double((rgb & 0x00FF00) >> 8) / 255.0
        let b = Double(rgb & 0x0000FF) / 255.0
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }

    var requiredApps: [EnterpriseApp] { session?.persona.appLaunchConfig.requiredApps ?? [] }
    var optionalApps: [EnterpriseApp] { session?.persona.appLaunchConfig.optionalApps ?? [] }

    /// The session-restriction rows, built exactly as `configureRestrictions` did:
    /// idle timeout, copy/paste, screen capture, print, and the optional max-session
    /// row. `allowAirDrop` exists on `SessionRestrictions` but the source did not
    /// render it, so it is not shown here.
    var restrictionItems: [RestrictionItem] {
        guard let r = session?.persona.restrictions else { return [] }
        var items: [RestrictionItem] = []
        let idleMinutes = Int(r.idleTimeout / 60)
        items.append(RestrictionItem(icon: "clock", title: "Idle Timeout", value: "\(idleMinutes) minutes"))
        items.append(RestrictionItem(
            icon: r.allowCopyPaste ? "checkmark.circle.fill" : "xmark.circle.fill",
            title: "Copy/Paste", value: r.allowCopyPaste ? "Allowed" : "Blocked"))
        items.append(RestrictionItem(
            icon: r.allowScreenCapture ? "checkmark.circle.fill" : "xmark.circle.fill",
            title: "Screen Capture", value: r.allowScreenCapture ? "Allowed" : "Blocked"))
        items.append(RestrictionItem(
            icon: r.allowPrint ? "checkmark.circle.fill" : "xmark.circle.fill",
            title: "Print", value: r.allowPrint ? "Allowed" : "Blocked"))
        if let maxDuration = r.maxSessionDuration {
            let hours = Int(maxDuration / 3600)
            items.append(RestrictionItem(icon: "hourglass", title: "Max Session", value: "\(hours) hours"))
        }
        return items
    }

    // MARK: Timer

    private func startTimers() {
        displayTimer?.invalidate()
        displayTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.updateSessionTimer()
        }
    }

    private func stopTimers() {
        displayTimer?.invalidate()
        displayTimer = nil
    }

    /// The countdown, computed exactly as the UIKit `updateSessionTimer` did — same
    /// duration source (`maxSessionDuration ?? idleTimeout`), same `H:MM:SS` / `MM:SS`
    /// formats, same "Expired" string, same thresholds. The COLOUR is the one
    /// deliberate change: the session timer is normal chrome, not a decision verdict,
    /// so the bands map to non-risk tokens instead of the source's review/deny.
    private func updateSessionTimer() {
        guard let session = session else {
            timerText = "--:--:--"
            timerColor = .sgAccent
            return
        }

        let startedAt = session.startedAt
        let sessionDuration = session.persona.restrictions.maxSessionDuration
            ?? session.persona.restrictions.idleTimeout
        let expiresAt = startedAt.addingTimeInterval(sessionDuration)
        let remaining = expiresAt.timeIntervalSince(Date())

        if remaining > 0 {
            let hours = Int(remaining) / 3600
            let minutes = (Int(remaining) % 3600) / 60
            let seconds = Int(remaining) % 60

            if hours > 0 {
                timerText = String(format: "%d:%02d:%02d", hours, minutes, seconds)
            } else {
                timerText = String(format: "%02d:%02d", minutes, seconds)
            }

            // Same thresholds as the source (< 60s, < 300s, else), mapped to chrome
            // tokens: accent (normal) -> primary (< 5 min) -> foreground (< 1 min).
            if remaining < 60 {
                timerColor = .sgForeground
            } else if remaining < 300 {
                timerColor = .sgPrimary
            } else {
                timerColor = .sgAccent
            }
        } else {
            timerText = "Expired"
            timerColor = .sgForeground
        }
    }

    // MARK: Quick actions

    func endSessionTapped() {
        let alert = UIAlertController(
            title: "End Session",
            message: "Are you sure you want to end your session? All unsaved work will be lost.",
            preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: "End Session", style: .destructive) { _ in
            SessionStateManager.shared.endSession(userInitiated: true)
        })
        present(alert)
    }

    func lockDeviceTapped() {
        let alert = UIAlertController(
            title: "Lock Device",
            message: "This will lock the device and require badge authentication to continue.",
            preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: "Lock", style: .default) { _ in
            SessionStateManager.shared.endSession(userInitiated: true)
        })
        present(alert)
    }

    /// Open the embedded Assist host-app demo — the invisible-gate reference — through
    /// the location-matched host app. Records interaction first, exactly as the UIKit
    /// `hostAppTapped` did.
    func hostAppTapped() {
        SessionStateManager.shared.userDidInteract()
        present(HostAppViewController(config: Self.hostAppConfig()))
    }

    /// Refresh through the CONFIGURED identity provider and report its real result.
    /// The action-less "Refreshing…" alert is a real modal block (SwiftUI cannot
    /// express it on the iOS 15 target), the refresh runs off its completion, and the
    /// alert is dismissed before the outcome toast — the exact UIKit sequence.
    func refreshSessionTapped() {
        let alert = UIAlertController(
            title: "Refreshing Session",
            message: "Asking the configured identity provider to extend the session…",
            preferredStyle: .alert)

        present(alert) {
            Task { @MainActor in
                let outcome: String
                let ok: Bool
                do {
                    let expiry = try await SessionStateManager.shared.refreshActiveSession()
                    ok = true
                    if let expiry = expiry {
                        let formatter = DateFormatter()
                        formatter.dateStyle = .none
                        formatter.timeStyle = .short
                        outcome = "Session refreshed — valid until \(formatter.string(from: expiry))"
                    } else {
                        outcome = "Session validated — the provider stated no new expiry"
                    }
                } catch {
                    ok = false
                    outcome = "Refresh failed: \(error.localizedDescription)"
                }
                alert.dismiss(animated: true) { [weak self] in
                    self?.showToast(outcome, ok: ok)
                }
            }
        }
    }

    func helpTapped() {
        let alert = UIAlertController(
            title: "Help & Support",
            message: "For assistance, please contact your IT administrator.",
            preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert)
    }

    // MARK: App launch (the UIKit `didSelectItemAt`, verbatim)

    /// Kiosk containment: a web app opens in the in-app managed browser so the device
    /// stays NATIVE and contained inside EnterpriseShell; only true native/deep-link
    /// apps launch through the OS via `AppLauncher`. The `app_launched` audit row and
    /// the persona's copy policy carried into the managed page are preserved.
    func appTapped(_ app: EnterpriseApp) {
        if !app.isDeepLink,
           let urlString = app.launchUrl,
           let url = URL(string: urlString),
           ["http", "https"].contains((url.scheme ?? "").lowercased()) {
            AuditLogger.shared.log(event: .appLaunched, metadata: [
                "appId": app.appId, "mode": "managed_webview"
            ])
            present(
                ManagedAppViewController(
                    app: app,
                    url: url,
                    allowedDomains: session?.persona.restrictions.allowedDomains,
                    allowCopyPaste: session?.persona.restrictions.allowCopyPaste ?? true
                )
            )
            return
        }

        Task {
            do {
                try await AppLauncher.shared.launchEnterpriseApp(app)
            } catch {
                showAppLaunchError(error)
            }
        }
    }

    private func showAppLaunchError(_ error: Error) {
        let alert = UIAlertController(
            title: "Cannot Launch App",
            message: error.localizedDescription,
            preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert)
    }

    // MARK: Toast

    private func showToast(_ message: String, ok: Bool) {
        toastWork?.cancel()
        withAnimation(.easeInOut(duration: 0.3)) {
            toast = ToastState(message: message, ok: ok)
        }
        let work = DispatchWorkItem { [weak self] in
            withAnimation(.easeInOut(duration: 0.3)) { self?.toast = nil }
        }
        toastWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.3, execute: work)
    }

    // MARK: Simulator demo (the UIKit `viewDidAppear`, verbatim)

    private func runSimulatorDemoIfNeeded() {
        #if targetEnvironment(simulator)
        // Demo: auto-open the first workspace app in the in-app managed browser to
        // show app access staying native/contained. Latched to fire ONCE per session.
        if DemoMode.openApp, !didAutoOpenApp,
           let app = SessionStateManager.shared.currentSession?.persona.appLaunchConfig.requiredApps.first,
           let urlString = app.launchUrl, let url = URL(string: urlString) {
            didAutoOpenApp = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
                guard let self, Self.rootHasNoPresentation() else { return }
                self.present(
                    ManagedAppViewController(
                        app: app,
                        url: url,
                        allowedDomains: SessionStateManager.shared.currentSession?.persona.restrictions.allowedDomains
                    )
                )
            }
        }
        // Demo: auto-open the embedded Assist host-app demo (invisible gate flow).
        // Once per session.
        if DemoMode.assist, !didAutoOpenAssist {
            didAutoOpenAssist = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
                guard let self, Self.rootHasNoPresentation() else { return }
                self.present(HostAppViewController(config: HostAppViewController.forLocation(DemoMode.location)))
            }
        }
        // Demo: auto-end the session after a beat so the terminate -> teardown ->
        // lockedIdle flow can be exercised without tapping "End Session".
        if DemoMode.autoEnd {
            DispatchQueue.main.asyncAfter(deadline: .now() + 4.0) {
                guard SessionStateManager.shared.currentState == .activeSession else { return }
                SessionStateManager.shared.endSession(userInitiated: true)
            }
        }
        #endif
    }

    /// The host app matching the deployment location (clinic → clinical chart,
    /// warehouse → warehouse handheld). Same invisible gate, different app. (UIKit
    /// `hostAppConfig`.)
    private static func hostAppConfig() -> HostAppViewController.HostAppConfig {
        #if targetEnvironment(simulator)
        return HostAppViewController.forLocation(DemoMode.location)
        #else
        return HostAppViewController.clinical()
        #endif
    }

    // MARK: Helpers

    private static func getInitials(from name: String) -> String {
        let words = name.split(separator: " ")
        let initials = words.prefix(2).compactMap { $0.first }.map { String($0) }
        return initials.joined().uppercased()
    }

    /// Parse a `#RRGGBB` hex string into a SwiftUI `Color`. A private, self-contained
    /// copy of the UIKit screen's `UIColor(hex:)` — named differently so this file
    /// neither redeclares that extension (a duplicate in-module) nor depends on the
    /// UIKit file surviving.
    private static func color(fromHex hex: String) -> Color? {
        var hexSanitized = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        hexSanitized = hexSanitized.replacingOccurrences(of: "#", with: "")
        var rgb: UInt64 = 0
        guard Scanner(string: hexSanitized).scanHexInt64(&rgb) else { return nil }
        let r = Double((rgb & 0xFF0000) >> 16) / 255.0
        let g = Double((rgb & 0x00FF00) >> 8) / 255.0
        let b = Double(rgb & 0x0000FF) / 255.0
        return Color(.sRGB, red: r, green: g, blue: b, opacity: 1.0)
    }

    // MARK: Presentation (mirrors LockedIdleModel)

    private func present(_ viewController: UIViewController, completion: (() -> Void)? = nil) {
        guard let presenter = Self.topPresenter() else { return }
        presenter.present(viewController, animated: true, completion: completion)
    }

    /// The deepest presented controller, for presenting alerts and user-initiated
    /// screens over whatever is on top.
    private static func topPresenter() -> UIViewController? {
        var top = keyWindow()?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }

    /// True when the root (the hosting controller) has nothing presented — the guard
    /// the UIKit demo auto-opens used (`self.presentedViewController == nil`).
    /// `topPresenter()` descends to the deepest controller, so its
    /// `presentedViewController` is vacuously nil and cannot serve as this guard.
    private static func rootHasNoPresentation() -> Bool {
        keyWindow()?.rootViewController?.presentedViewController == nil
    }

    private static func keyWindow() -> UIWindow? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        return scenes.flatMap { $0.windows }.first { $0.isKeyWindow } ?? scenes.first?.windows.first
    }
}
