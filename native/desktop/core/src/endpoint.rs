//! Where the Assist gate is, and whether we are willing to talk to it.
//!
//! THE RULE: a trust gate is reached over TLS or it is not reached.
//!
//! A decision arrives over the network and is then obeyed — the host app opens a
//! screen, or refuses to. Over plaintext, anyone on the path can rewrite `deny` to
//! `allow`, and nothing downstream can tell. On a shared frontline device that is not
//! a theoretical position: hospital and warehouse wifi is exactly where an attacker
//! sits on the path, and it is the same network the captive-portal case in `wire`
//! comes from.
//!
//! The one exception is loopback, because there is no path to sit on: a developer
//! running the api-server on the same machine is not exposed by it, and refusing that
//! would push people toward disabling the check entirely — trading a narrow, reasoned
//! exception for a blanket one. That is the trade that usually gets made badly.

/// Hosts where plaintext is acceptable because the traffic never leaves the machine.
const LOOPBACK: [&str; 4] = ["localhost", "127.0.0.1", "::1", "[::1]"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Endpoint {
    /// The URL with any trailing slash removed, so callers appending `/v1/authorize`
    /// do not produce `//v1/authorize` — which 404s on some servers and silently
    /// redirects on others.
    ///
    /// THE BASE MUST BE THE `/api` MOUNT. The api-server mounts its router at `/api`
    /// (artifacts/api-server/src/app.ts) and the route is `/v1/authorize` under it,
    /// so the only base that reaches a decision is `https://host/api`: appending
    /// gives `https://host/api/v1/authorize`. A bare `https://host` appends to
    /// `https://host/v1/authorize`, which is a 404 — and a 404 is a DENY here, so
    /// the symptom of a mis-set base is every worker refused, not an error message.
    Usable(String),
    Refused(String),
}

impl Endpoint {
    pub fn base_url(&self) -> Option<&str> {
        match self {
            Endpoint::Usable(u) => Some(u),
            Endpoint::Refused(_) => None,
        }
    }

    pub fn is_usable(&self) -> bool {
        matches!(self, Endpoint::Usable(_))
    }
}

/// Normalise and vet a configured base URL.
pub fn validate(raw: Option<&str>) -> Endpoint {
    let url = raw.unwrap_or("").trim();
    if url.is_empty() {
        return Endpoint::Refused("no gate URL is configured".to_string());
    }

    let Some((scheme, after_scheme)) = url.split_once("://") else {
        return Endpoint::Refused(format!(
            "gate URL \"{url}\" has no scheme; expected https://"
        ));
    };
    let scheme = scheme.to_ascii_lowercase();
    if scheme.is_empty() {
        return Endpoint::Refused(format!(
            "gate URL \"{url}\" has no scheme; expected https://"
        ));
    }
    if scheme != "https" && scheme != "http" {
        return Endpoint::Refused(format!("gate URL scheme \"{scheme}\" is not http(s)"));
    }

    // The authority ends at the first '/', '?' or '#'.
    let authority: String = after_scheme
        .chars()
        .take_while(|c| *c != '/' && *c != '?' && *c != '#')
        .collect();
    if authority.is_empty() {
        return Endpoint::Refused(format!("gate URL \"{url}\" has no host"));
    }
    // Credentials in a URL end up in logs and crash reports. Refuse rather than
    // strip: stripping would silently change which identity the request carries, and
    // the password is already in whatever logged the config.
    if authority.contains('@') {
        return Endpoint::Refused(
            "gate URL must not carry credentials in the authority".to_string(),
        );
    }

    let host = host_of(&authority);
    if host.is_empty() {
        return Endpoint::Refused(format!("gate URL \"{url}\" has no host"));
    }

    if scheme == "http" && !LOOPBACK.contains(&host.to_ascii_lowercase().as_str()) {
        return Endpoint::Refused(format!(
            "refusing to reach the Assist gate over plaintext http at \"{host}\" — \
             a decision that can be rewritten in transit is not a decision"
        ));
    }

    Endpoint::Usable(url.trim_end_matches('/').to_string())
}

/// Strip a port, and the brackets around an IPv6 literal, to get the bare host.
fn host_of(authority: &str) -> String {
    if let Some(rest) = authority.strip_prefix('[') {
        return match rest.find(']') {
            Some(i) => authority[..i + 2].to_string(),
            None => String::new(),
        };
    }
    authority.split(':').next().unwrap_or("").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn usable(raw: &str) -> String {
        match validate(Some(raw)) {
            Endpoint::Usable(u) => u,
            other => panic!("expected usable for {raw}, got {other:?}"),
        }
    }

    fn refused_reason(raw: Option<&str>) -> String {
        match validate(raw) {
            Endpoint::Refused(r) => r,
            other => panic!("expected refusal for {raw:?}, got {other:?}"),
        }
    }

    #[test]
    fn https_is_accepted() {
        assert_eq!(
            usable("https://gate.example.com"),
            "https://gate.example.com"
        );
        assert_eq!(
            usable("https://gate.example.com:8443"),
            "https://gate.example.com:8443"
        );
        assert_eq!(
            usable("https://gate.example.com/api"),
            "https://gate.example.com/api"
        );
    }

    #[test]
    fn a_trailing_slash_is_removed_so_paths_do_not_double_up() {
        assert_eq!(
            usable("https://gate.example.com/"),
            "https://gate.example.com"
        );
        assert_eq!(
            usable("https://gate.example.com/api/"),
            "https://gate.example.com/api"
        );
    }

    #[test]
    fn the_api_mount_is_the_base_and_appending_the_route_reaches_authorize() {
        // The one composition that reaches a decision, pinned as a vector so the
        // "append /v1/authorize" comments cannot drift from what actually resolves.
        let base = usable("https://host/api");
        assert_eq!(
            format!("{base}/v1/authorize"),
            "https://host/api/v1/authorize"
        );
        // And with the slash a config field usually carries.
        let base = usable("https://host/api/");
        assert_eq!(
            format!("{base}/v1/authorize"),
            "https://host/api/v1/authorize"
        );
    }

    #[test]
    fn surrounding_whitespace_from_a_config_field_is_tolerated() {
        assert_eq!(
            usable("  https://gate.example.com  "),
            "https://gate.example.com"
        );
    }

    // ── The rule this file exists for ────────────────────────────────────────

    #[test]
    fn plaintext_http_to_a_remote_host_is_refused() {
        let reason = refused_reason(Some("http://gate.example.com"));
        assert!(reason.contains("plaintext"), "{reason}");
    }

    #[test]
    fn plaintext_http_is_refused_even_on_a_plausible_internal_host() {
        // The tempting exception: "it is on our own network". Hospital and warehouse
        // wifi is exactly where the attacker sits.
        refused_reason(Some("http://10.20.30.40"));
        refused_reason(Some("http://signalgrid.internal"));
        refused_reason(Some("http://192.168.1.50:3000"));
    }

    #[test]
    fn plaintext_loopback_is_allowed_because_there_is_no_path_to_sit_on() {
        assert_eq!(usable("http://localhost:3000"), "http://localhost:3000");
        assert_eq!(usable("http://127.0.0.1:3000"), "http://127.0.0.1:3000");
        assert_eq!(usable("http://[::1]:3000"), "http://[::1]:3000");
    }

    #[test]
    fn the_android_emulator_alias_is_not_loopback_on_the_desktop() {
        // 10.0.2.2 is loopback only INSIDE an Android emulator. On a desktop it is a
        // routable address on somebody's network, so the exception must not be copied
        // across from native/android/core just because the file looks similar.
        refused_reason(Some("http://10.0.2.2:3000"));
    }

    #[test]
    fn a_host_that_merely_contains_localhost_is_not_loopback() {
        // The classic bypass: `localhost.attacker.com` resolves wherever the attacker
        // wants. Matching must be exact, not substring.
        refused_reason(Some("http://localhost.attacker.com"));
        refused_reason(Some("http://notlocalhost"));
        refused_reason(Some("http://127.0.0.1.attacker.com"));
    }

    #[test]
    fn credentials_in_the_authority_are_refused_not_stripped() {
        let reason = refused_reason(Some("https://user:pass@gate.example.com"));
        assert!(reason.contains("credentials"), "{reason}");
    }

    #[test]
    fn a_userinfo_trick_cannot_smuggle_a_loopback_host_past_the_check() {
        // "http://localhost@evil.example.com" has authority localhost@evil…, whose
        // real host is evil.example.com. Refused on the credentials rule before host
        // parsing can be fooled.
        refused_reason(Some("http://localhost@evil.example.com"));
    }

    #[test]
    fn non_http_schemes_are_refused() {
        refused_reason(Some("ftp://gate.example.com"));
        refused_reason(Some("file:///etc/passwd"));
        refused_reason(Some("wss://gate.example.com"));
    }

    #[test]
    fn empty_blank_and_malformed_input_is_refused_rather_than_defaulted() {
        refused_reason(None);
        refused_reason(Some(""));
        refused_reason(Some("   "));
        refused_reason(Some("gate.example.com")); // no scheme — must not be assumed https
        refused_reason(Some("https://"));
        refused_reason(Some("https:///path-with-no-host"));
    }

    #[test]
    fn nothing_that_is_not_https_or_loopback_is_ever_usable() {
        // The invariant, asserted over the whole spread rather than left implied.
        let must_refuse = [
            None,
            Some(""),
            Some("  "),
            Some("gate.example.com"),
            Some("http://gate.example.com"),
            Some("http://10.20.30.40"),
            Some("http://10.0.2.2:3000"),
            Some("http://localhost.attacker.com"),
            Some("ftp://x.example.com"),
            Some("file:///etc/passwd"),
            Some("https://"),
            Some("https://user:pass@gate.example.com"),
        ];
        for raw in must_refuse {
            assert!(!validate(raw).is_usable(), "must refuse: {raw:?}");
        }
    }
}
