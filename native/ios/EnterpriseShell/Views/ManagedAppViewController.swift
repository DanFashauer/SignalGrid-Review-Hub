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
    private let webView = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
    private let progress = UIActivityIndicatorView(style: .medium)

    init(app: EnterpriseApp, url: URL) {
        self.app = app
        self.url = url
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
