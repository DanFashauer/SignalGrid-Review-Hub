import UIKit
import WebKit

/// In-app, kiosk-contained browser for web-based enterprise apps.
///
/// After authentication the device must stay NATIVE and contained inside
/// EnterpriseShell — launching a web app must not hand off to the external Safari
/// app, which would let a user leave the locked shared-device kiosk. Web apps load
/// here in a `WKWebView` with minimal kiosk chrome (title + Done); only true
/// native/deep-link apps launch through the OS via AppLauncher.
final class ManagedAppViewController: UIViewController {
    private let app: EnterpriseApp
    private let url: URL
    /// Persona-scoped host allowlist for this contained browser. `nil`/empty means
    /// the persona set no web restriction (navigation is unrestricted, as before).
    private let allowedDomains: [String]?
    private let webView: WKWebView = {
        let cfg = WKWebViewConfiguration()
        // Per-session isolation on a SHARED device: an ephemeral (non-persistent)
        // website data store keeps cookies, localStorage, IndexedDB and cache in
        // memory only, so nothing a web app writes survives to the next badge
        // holder. Tearing down this VC drops the store entirely — the previous
        // holder's authenticated web session cannot be reopened.
        cfg.websiteDataStore = .nonPersistent()
        return WKWebView(frame: .zero, configuration: cfg)
    }()
    private let progress = UIActivityIndicatorView(style: .medium)

    init(app: EnterpriseApp, url: URL, allowedDomains: [String]? = nil) {
        self.app = app
        self.url = url
        self.allowedDomains = allowedDomains
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .fullScreen
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        // Kiosk top bar: app name + Done (no Safari escape affordances).
        let bar = UIView()
        bar.backgroundColor = .secondarySystemBackground
        bar.translatesAutoresizingMaskIntoConstraints = false

        let title = UILabel()
        title.text = app.displayName
        title.font = .systemFont(ofSize: 17, weight: .semibold)
        title.textAlignment = .center
        title.translatesAutoresizingMaskIntoConstraints = false

        let done = UIButton(type: .system)
        done.setTitle("Done", for: .normal)
        done.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
        done.addTarget(self, action: #selector(close), for: .touchUpInside)
        done.translatesAutoresizingMaskIntoConstraints = false

        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.navigationDelegate = self
        progress.translatesAutoresizingMaskIntoConstraints = false
        progress.hidesWhenStopped = true

        view.addSubview(bar)
        bar.addSubview(title)
        bar.addSubview(done)
        view.addSubview(webView)
        view.addSubview(progress)

        NSLayoutConstraint.activate([
            bar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            bar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            bar.heightAnchor.constraint(equalToConstant: 48),

            title.centerXAnchor.constraint(equalTo: bar.centerXAnchor),
            title.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
            done.trailingAnchor.constraint(equalTo: bar.trailingAnchor, constant: -16),
            done.centerYAnchor.constraint(equalTo: bar.centerYAnchor),

            webView.topAnchor.constraint(equalTo: bar.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            progress.centerXAnchor.constraint(equalTo: webView.centerXAnchor),
            progress.centerYAnchor.constraint(equalTo: webView.centerYAnchor)
        ])

        progress.startAnimating()
        webView.load(URLRequest(url: url))
    }

    @objc private func close() {
        // Any interaction (including closing an app) counts as activity.
        SessionStateManager.shared.userDidInteract()
        dismiss(animated: true)
    }
}

extension ManagedAppViewController: WKNavigationDelegate {
    /// Contain navigation to approved origins. Without this, a link, redirect, or
    /// script-driven navigation could carry the user OUT of the intended enterprise
    /// origin while still inside the kiosk browser — the same escape Safari/other
    /// apps are MDM-blocked to prevent. The app's own launch origin is always
    /// permitted; a persona allowlist adds further hosts. No allowlist configured
    /// ⇒ unrestricted (unchanged behavior).
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let allow = allowedDomains, !allow.isEmpty else {
            decisionHandler(.allow)
            return
        }
        guard let host = navigationAction.request.url?.host?.lowercased() else {
            // Hostless (about:blank, data:) — not an origin escape; allow.
            decisionHandler(.allow)
            return
        }
        let permitted = ([url.host?.lowercased()].compactMap { $0 }) + allow.map { $0.lowercased() }
        let ok = permitted.contains { host == $0 || host.hasSuffix("." + $0) }
        decisionHandler(ok ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        progress.stopAnimating()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        progress.stopAnimating()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        progress.stopAnimating()
    }
}
