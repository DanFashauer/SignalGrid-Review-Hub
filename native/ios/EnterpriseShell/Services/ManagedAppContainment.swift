import Foundation

/// The pure host-containment policy for the in-app managed browser
/// (`ManagedAppViewController`), factored out so the safety-critical matching can be
/// unit-tested without a `WKWebView` or a running simulator.
///
/// FAIL CLOSED (golden rule 2): an absent or empty persona allowlist does NOT mean
/// "roam anywhere" — the permitted set is always the app's own launch origin plus any
/// allowlist, so an unconfigured or unknown persona is contained to the site the shell
/// deliberately opened, never unrestricted. The only empty set is a hostless launch URL
/// with no allowlist, which then permits nothing.
enum ManagedAppContainment {
    /// The hosts this managed app may reach: ALWAYS its launch origin, plus any persona
    /// `allowedDomains`. Lower-cased; empty only when `launchHost` is nil and no allowlist.
    static func permittedHosts(launchHost: String?, allowedDomains: [String]?) -> [String] {
        ([launchHost?.lowercased()].compactMap { $0 }) + (allowedDomains ?? []).map { $0.lowercased() }
    }

    /// Fail-closed host match: a request host is permitted only when it EXACTLY equals a
    /// permitted host or is a dot-boundary subdomain of one. The `"." + $0` boundary is
    /// what stops a look-alike (`notexample.com`, `example.com.attacker.com`) from
    /// matching `example.com`. An empty permitted set permits nothing.
    static func isPermitted(host: String, permitted: [String]) -> Bool {
        let h = host.lowercased()
        return permitted.contains { h == $0 || h.hasSuffix("." + $0) }
    }
}
