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
    /// Persona copy/paste policy. When false, selection + copy are disabled inside
    /// the managed page (review finding): wiping the pasteboard at teardown does not
    /// enforce the advertised IN-SESSION restriction — a holder could copy web-app
    /// content and paste it into another permitted app before logout.
    private let allowCopyPaste: Bool
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

    init(app: EnterpriseApp, url: URL, allowedDomains: [String]? = nil, allowCopyPaste: Bool = true) {
        self.app = app
        self.url = url
        self.allowedDomains = allowedDomains
        self.allowCopyPaste = allowCopyPaste
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
        title.font = SG.sans(17, .semibold)
        title.adjustsFontForContentSizeCategory = true
        title.textAlignment = .center
        title.translatesAutoresizingMaskIntoConstraints = false

        let done = UIButton(type: .system)
        done.setTitle("Done", for: .normal)
        done.titleLabel?.font = SG.sans(17, .semibold)
        done.titleLabel?.adjustsFontForContentSizeCategory = true
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

        if !allowCopyPaste {
            // Document-start script in all frames: disable selection and swallow
            // copy/cut events so the standard Copy menu has nothing to act on.
            let js = """
            (function () {
              var s = document.createElement('style');
              s.textContent = '* { -webkit-user-select: none !important; user-select: none !important; }';
              (document.head || document.documentElement).appendChild(s);
              ['copy', 'cut'].forEach(function (t) {
                document.addEventListener(t, function (e) { e.preventDefault(); }, true);
              });
            })();
            """
            webView.configuration.userContentController.addUserScript(
                WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        }

        progress.startAnimating()
        loadWithDomainContainment()
    }

    /// Enforce the persona's `allowedDomains` on ALL web traffic, not just top-level
    /// navigation (review finding): `decidePolicyFor` governs navigations only, so a
    /// script on an allowed page could still fetch/XHR/beacon session data to any
    /// origin. A WKContentRuleList blocks every request whose domain is not on the
    /// allowlist at the resource layer. FAIL CLOSED: with an allowlist configured,
    /// nothing loads until the rules are compiled and attached; if compilation fails,
    /// the page is not loaded at all rather than loaded unrestricted.
    private func loadWithDomainContainment() {
        guard let allow = allowedDomains, !allow.isEmpty else {
            webView.load(URLRequest(url: url))
            return
        }
        let permitted = (([url.host?.lowercased()].compactMap { $0 }) + allow.map { $0.lowercased() })
            .map { "*\($0)" }
        let rules = """
        [
          {"trigger": {"url-filter": ".*"}, "action": {"type": "block"}},
          {"trigger": {"url-filter": ".*", "if-domain": \(jsonStringArray(permitted))}, "action": {"type": "ignore-previous-rules"}}
        ]
        """
        WKContentRuleListStore.default().compileContentRuleList(
            forIdentifier: "managed-app-domain-allowlist-\(app.appId)",
            encodedContentRuleList: rules
        ) { [weak self] list, error in
            guard let self = self else { return }
            DispatchQueue.main.async {
                guard let list = list, error == nil else {
                    self.progress.stopAnimating()
                    AuditLogger.shared.log(event: .error, metadata: [
                        "error": "managed_app_content_rules_failed",
                        "app": self.app.appId
                    ])
                    let alert = UIAlertController(
                        title: "App unavailable",
                        message: "The web containment policy for this app could not be applied, so the app was not opened (fail closed).",
                        preferredStyle: .alert)
                    alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in self.dismiss(animated: true) })
                    self.present(alert, animated: true)
                    return
                }
                self.webView.configuration.userContentController.add(list)
                self.webView.load(URLRequest(url: self.url))
            }
        }
    }

    /// Minimal JSON encoding for the rule list's domain array (hosts are validated
    /// config values, but encode defensively anyway).
    private func jsonStringArray(_ values: [String]) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: values)) ?? Data("[]".utf8)
        return String(data: data, encoding: .utf8) ?? "[]"
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
