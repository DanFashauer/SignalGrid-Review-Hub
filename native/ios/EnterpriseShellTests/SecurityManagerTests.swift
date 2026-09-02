import XCTest

// In Xcode these sources are compiled directly into the test bundle (see
// `EnterpriseShellTests` in ../project.yml), so there is no module to import. Under
// SwiftPM (../Package.swift) the same files are a library, and this brings it in.
#if canImport(EnterpriseShellPort)
@testable import EnterpriseShellPort
#endif

/// Pins the REASONS behind the 2026-09-02 SecurityManager changes, on the pure core
/// SecurityManager delegates to (`DeviceBindingCrypto`). SecurityManager itself is not
/// compiled here: this bundle is hermetic — no host app, no Keychain, no audit log —
/// and SecurityManager's only additions over this core are the device key, the audit
/// records and `Date()`. What is proven:
///
///   · a token binding minted by this key verifies, and only with this key;
///   · the same binding with ONE hex nibble flipped fails (a recomputation, not a
///     prefix match — the old check accepted any string sharing the key's first 8
///     characters);
///   · a non-numeric timestamp never verifies, minted or hand-built;
///   · the OLD form, `sha256("key:ts")` with the timestamp thrown away, never verifies;
///   · a request signature whose timestamp does not parse is REFUSED, not verified on
///     the HMAC alone (the pre-existing `if let ts = Int(timestamp)` skipped the window);
///   · the window and the HMAC each fail on their own, with an injected clock.
final class SecurityManagerTests: XCTestCase {

    // A key in the shape SecurityManager stores: sha256 hex of device facts.
    private let key = DeviceBindingCrypto.sha256Hex("device-id:unattested:com.enterprise.shell")
    private let otherKey = DeviceBindingCrypto.sha256Hex("other-device:unattested:com.enterprise.shell")
    private let timestamp = "1756800000"

    // MARK: - Token binding

    func testMintedBindingVerifiesWithTheSameKeyOnly() {
        let binding = DeviceBindingCrypto.mintTokenBinding(key: key, timestamp: timestamp)
        XCTAssertTrue(DeviceBindingCrypto.verifyTokenBinding(binding, key: key))
        XCTAssertFalse(DeviceBindingCrypto.verifyTokenBinding(binding, key: otherKey))
        // Shape: `<ts>.<64 hex>` — the timestamp travels with the digest.
        let parts = binding.split(separator: ".")
        XCTAssertEqual(parts.count, 2)
        XCTAssertEqual(String(parts[0]), timestamp)
        XCTAssertEqual(parts[1].count, 64)
    }

    func testOneFlippedNibbleFails() {
        let binding = DeviceBindingCrypto.mintTokenBinding(key: key, timestamp: timestamp)
        var chars = Array(binding)
        // Flip the LAST hex character: a prefix match would still pass this.
        let last = chars.count - 1
        chars[last] = chars[last] == "0" ? "1" : "0"
        let flipped = String(chars)
        XCTAssertNotEqual(flipped, binding)
        XCTAssertFalse(DeviceBindingCrypto.verifyTokenBinding(flipped, key: key))
        // And the first nibble of the digest, for symmetry.
        let digestStart = timestamp.count + 1
        chars = Array(binding)
        chars[digestStart] = chars[digestStart] == "0" ? "1" : "0"
        XCTAssertFalse(DeviceBindingCrypto.verifyTokenBinding(String(chars), key: key))
    }

    func testNonNumericTimestampNeverVerifies() {
        let digest = DeviceBindingCrypto.tokenBindingDigest(key: key, timestamp: "soon")
        XCTAssertFalse(DeviceBindingCrypto.verifyTokenBinding("soon.\(digest)", key: key))
        // Even a binding MINTED with a non-numeric timestamp is refused on verify.
        let minted = DeviceBindingCrypto.mintTokenBinding(key: key, timestamp: "soon")
        XCTAssertFalse(DeviceBindingCrypto.verifyTokenBinding(minted, key: key))
        // The no-key marker SecurityManager emits without a binding key.
        XCTAssertFalse(DeviceBindingCrypto.verifyTokenBinding("unbound.\(UUID().uuidString)", key: key))
        // No separator at all, empty halves.
        XCTAssertFalse(DeviceBindingCrypto.verifyTokenBinding(timestamp, key: key))
        XCTAssertFalse(DeviceBindingCrypto.verifyTokenBinding(".", key: key))
        XCTAssertFalse(DeviceBindingCrypto.verifyTokenBinding("", key: key))
    }

    func testOldHashedFormNeverVerifies() {
        // Until 2026-09-02: `hashString("\(deviceKey):\(timestamp)")`, no separator,
        // the timestamp unrecoverable; accepted then by an 8-character prefix match.
        let old = DeviceBindingCrypto.sha256Hex("\(key):\(timestamp)")
        XCTAssertFalse(DeviceBindingCrypto.verifyTokenBinding(old, key: key))
        XCTAssertFalse(DeviceBindingCrypto.verifyTokenBinding("\(timestamp).\(old)", key: key))
        // The key's own prefix — what the old check actually tested for — is not a binding.
        XCTAssertFalse(DeviceBindingCrypto.verifyTokenBinding(String(key.prefix(8)), key: key))
        XCTAssertFalse(DeviceBindingCrypto.verifyTokenBinding("\(timestamp).\(key.prefix(16))", key: key))
    }

    // MARK: - Request signature

    private func sign(timestamp: String, nonce: String = "n-1", body: Data? = Data("{\"a\":1}".utf8), key: String? = nil) -> String {
        let base = DeviceBindingCrypto.signatureBase(method: "POST", url: "https://cp.example/api/v1/sessions/start", timestamp: timestamp, nonce: nonce, body: body)
        return DeviceBindingCrypto.hmacSHA256Hex(key: key ?? self.key, message: base)
    }

    private func verify(signature: String, timestamp: String, nonce: String = "n-1", body: Data? = Data("{\"a\":1}".utf8), now: Date) -> DeviceBindingCrypto.SignatureVerdict {
        DeviceBindingCrypto.verifySignature(
            signature: signature, timestamp: timestamp, nonce: nonce,
            method: "POST", url: "https://cp.example/api/v1/sessions/start", body: body, key: key, now: now
        )
    }

    func testSignatureWithNonNumericTimestampIsRefusedNotVerifiedOnHMACAlone() {
        // A CORRECT HMAC over a base that carries a non-numeric timestamp.
        let signature = sign(timestamp: "not-a-time")
        XCTAssertEqual(verify(signature: signature, timestamp: "not-a-time", now: Date()), .malformedTimestamp)
        XCTAssertEqual(verify(signature: signature, timestamp: "", now: Date()), .malformedTimestamp)
    }

    func testSignatureVerifiesInsideTheWindowAndFailsOnEachInputAlone() {
        let ts = Int(timestamp)!
        let now = Date(timeIntervalSince1970: TimeInterval(ts) + 10)
        let signature = sign(timestamp: timestamp)
        XCTAssertEqual(verify(signature: signature, timestamp: timestamp, now: now), .valid)
        // Window, either side, on the injected clock.
        XCTAssertEqual(verify(signature: signature, timestamp: timestamp, now: Date(timeIntervalSince1970: TimeInterval(ts) + 301)), .expired)
        XCTAssertEqual(verify(signature: signature, timestamp: timestamp, now: Date(timeIntervalSince1970: TimeInterval(ts) - 301)), .expired)
        // Wrong key, wrong nonce, altered body: each a mismatch, never valid.
        XCTAssertEqual(verify(signature: sign(timestamp: timestamp, key: otherKey), timestamp: timestamp, now: now), .mismatch)
        XCTAssertEqual(verify(signature: signature, timestamp: timestamp, nonce: "n-2", now: now), .mismatch)
        XCTAssertEqual(verify(signature: signature, timestamp: timestamp, body: Data("{\"a\":2}".utf8), now: now), .mismatch)
    }

    func testConstantTimeEqualsIsAnEqualityNotAPrefixCheck() {
        XCTAssertTrue(DeviceBindingCrypto.constantTimeEquals("abc", "abc"))
        XCTAssertFalse(DeviceBindingCrypto.constantTimeEquals("abc", "abd"))
        XCTAssertFalse(DeviceBindingCrypto.constantTimeEquals("abc", "ab"))
        XCTAssertFalse(DeviceBindingCrypto.constantTimeEquals("", "a"))
        XCTAssertTrue(DeviceBindingCrypto.constantTimeEquals("", ""))
    }
}
