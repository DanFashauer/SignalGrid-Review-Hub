import XCTest

// In Xcode ManagedAppContainment is compiled directly into this test bundle (see
// `EnterpriseShellTests` sources in ../project.yml), so there is no module to import.
// Under SwiftPM (../Package.swift) it is part of the EnterpriseShellPort library, and
// this brings it in, the same way the other port tests do.
#if canImport(EnterpriseShellPort)
@testable import EnterpriseShellPort
#endif
// These pin the fail-closed containment behavior landed in #989: an absent/empty
// allowlist contains the managed browser to its launch origin only — never
// unrestricted — and the host match cannot be fooled by a look-alike domain.

final class ManagedAppContainmentTests: XCTestCase {
    func testAbsentAllowlistContainsToLaunchOriginOnly() {
        let permitted = ManagedAppContainment.permittedHosts(launchHost: "app.example.com", allowedDomains: nil)
        XCTAssertEqual(permitted, ["app.example.com"], "nil allowlist must still permit the launch origin")
        XCTAssertTrue(ManagedAppContainment.isPermitted(host: "app.example.com", permitted: permitted))
        XCTAssertTrue(ManagedAppContainment.isPermitted(host: "sub.app.example.com", permitted: permitted))
        XCTAssertFalse(ManagedAppContainment.isPermitted(host: "evil.com", permitted: permitted),
                       "nil allowlist must NOT mean roam-anywhere")
        XCTAssertFalse(ManagedAppContainment.isPermitted(host: "other.example.com", permitted: permitted))
    }

    func testEmptyAllowlistIsNotUnrestricted() {
        let permitted = ManagedAppContainment.permittedHosts(launchHost: "app.example.com", allowedDomains: [])
        XCTAssertEqual(permitted, ["app.example.com"])
        XCTAssertFalse(ManagedAppContainment.isPermitted(host: "anywhere.com", permitted: permitted),
                       "empty allowlist is contained, not unrestricted")
    }

    func testAllowlistAddsHostsCaseInsensitively() {
        let permitted = ManagedAppContainment.permittedHosts(
            launchHost: "app.example.com", allowedDomains: ["auth.example.com", "CDN.EXAMPLE.NET"])
        XCTAssertTrue(ManagedAppContainment.isPermitted(host: "auth.example.com", permitted: permitted))
        XCTAssertTrue(ManagedAppContainment.isPermitted(host: "CDN.EXAMPLE.NET", permitted: permitted),
                      "matching is case-insensitive on both sides")
        XCTAssertTrue(ManagedAppContainment.isPermitted(host: "img.cdn.example.net", permitted: permitted))
    }

    func testLookalikeSuffixIsNotMatched() {
        let permitted = ManagedAppContainment.permittedHosts(launchHost: "example.com", allowedDomains: nil)
        // The dot boundary is what stops these — a bypass if `hasSuffix` were used raw.
        XCTAssertFalse(ManagedAppContainment.isPermitted(host: "notexample.com", permitted: permitted))
        XCTAssertFalse(ManagedAppContainment.isPermitted(host: "example.com.attacker.com", permitted: permitted))
        XCTAssertFalse(ManagedAppContainment.isPermitted(host: "evilexample.com", permitted: permitted))
    }

    func testHostlessLaunchWithNoAllowlistPermitsNothing() {
        let permitted = ManagedAppContainment.permittedHosts(launchHost: nil, allowedDomains: nil)
        XCTAssertTrue(permitted.isEmpty)
        XCTAssertFalse(ManagedAppContainment.isPermitted(host: "anything.com", permitted: permitted),
                       "no launch host and no allowlist → permit nothing (fail closed)")
    }
}
