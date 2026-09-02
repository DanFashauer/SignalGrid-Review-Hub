import Foundation
import CommonCrypto

/// The PURE half of `SecurityManager`'s request signing and token binding: hashing,
/// HMAC, the canonical signature base, the token-binding format and its
/// verification, with every input a parameter — no Keychain, no audit log, no
/// device state, no clock of its own. `SecurityManager` delegates here and adds the
/// device key, the audit records and `Date()`.
///
/// It is split out so the hermetic test bundle (`project.yml` `EnterpriseShellTests`
/// and `Package.swift`, which compile a named pure-Foundation set with no host app)
/// can prove the REASONS behind the 2026-09-02 SecurityManager changes: a binding
/// minted here verifies, one flipped nibble does not, a non-numeric timestamp never
/// does, the old `sha256("key:ts")` form never does, and a signature whose timestamp
/// does not parse is refused rather than verified on the HMAC alone.
/// `SecurityManagerTests.swift` is that proof. CommonCrypto is an Apple system module
/// on both iOS and macOS, so this file stays inside the package's portability claim.
enum DeviceBindingCrypto {

    // MARK: - Primitives

    /// SHA-256 of the UTF-8 bytes, lowercase hex.
    static func sha256Hex(_ input: String) -> String {
        let data = Data(input.utf8)
        var digest = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
        data.withUnsafeBytes { bytes in
            _ = CC_SHA256(bytes.baseAddress, CC_LONG(data.count), &digest)
        }
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    /// HMAC-SHA256 over the UTF-8 bytes of `message` with the UTF-8 bytes of `key`, lowercase hex.
    static func hmacSHA256Hex(key: String, message: String) -> String {
        let keyData = Data(key.utf8)
        let messageData = Data(message.utf8)
        var digest = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
        keyData.withUnsafeBytes { keyBytes in
            messageData.withUnsafeBytes { messageBytes in
                CCHmac(
                    CCHmacAlgorithm(kCCHmacAlgSHA256),
                    keyBytes.baseAddress,
                    keyData.count,
                    messageBytes.baseAddress,
                    messageData.count,
                    &digest
                )
            }
        }
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    /// Length-independent, constant-time compare (no early-exit oracle). Same shape
    /// as `KioskConfig.constantTimeEquals`, which is private to that type.
    static func constantTimeEquals(_ a: String, _ b: String) -> Bool {
        let x = Array(a.utf8)
        let y = Array(b.utf8)
        var diff = x.count ^ y.count
        for i in 0..<max(x.count, y.count) {
            let xa: UInt8 = i < x.count ? x[i] : 0
            let yb: UInt8 = i < y.count ? y[i] : 0
            diff |= Int(xa ^ yb)
        }
        return diff == 0
    }

    // MARK: - Request signature

    /// The canonical string a request signature is computed over:
    /// `METHOD|url` + timestamp + nonce + body (UTF-8, when present and non-empty).
    static func signatureBase(method: String, url: String, timestamp: String, nonce: String, body: Data?) -> String {
        var base = "\(method)|\(url)"
        base += timestamp
        base += nonce
        if let body = body, !body.isEmpty, let bodyString = String(data: body, encoding: .utf8) {
            base += bodyString
        }
        return base
    }

    /// Replay window for a signed request, in seconds.
    static let signatureWindow: TimeInterval = 300

    enum SignatureVerdict: Equatable {
        case valid
        /// The timestamp did not parse as whole seconds. Refused before any HMAC is
        /// compared: a signature over a non-numeric timestamp would otherwise escape
        /// the replay window entirely and verify on the HMAC alone.
        case malformedTimestamp
        /// Outside `signatureWindow` of `now`.
        case expired
        case mismatch
    }

    /// Verify a request signature against `key`, with an injected clock.
    static func verifySignature(
        signature: String,
        timestamp: String,
        nonce: String,
        method: String,
        url: String,
        body: Data?,
        key: String,
        now: Date
    ) -> SignatureVerdict {
        guard let ts = Int(timestamp) else { return .malformedTimestamp }
        if abs(now.timeIntervalSince1970 - TimeInterval(ts)) > signatureWindow { return .expired }
        let expected = hmacSHA256Hex(key: key, message: signatureBase(method: method, url: url, timestamp: timestamp, nonce: nonce, body: body))
        return constantTimeEquals(signature, expected) ? .valid : .mismatch
    }

    // MARK: - Token binding

    /// Separates the mint timestamp from the digest in a token binding.
    static let tokenBindingSeparator: Character = "."

    static func tokenBindingDigest(key: String, timestamp: String) -> String {
        hmacSHA256Hex(key: key, message: "token-binding|\(timestamp)")
    }

    /// `<unix-seconds>.<HMAC-SHA256(key, "token-binding|<unix-seconds>")>`. The
    /// timestamp travels WITH the digest so `verifyTokenBinding` can recompute the
    /// same value from the same inputs; the old form hashed the timestamp in and
    /// then threw it away, which left nothing a verifier could recompute against.
    static func mintTokenBinding(key: String, timestamp: String) -> String {
        "\(timestamp)\(tokenBindingSeparator)\(tokenBindingDigest(key: key, timestamp: timestamp))"
    }

    /// Split out the timestamp, recompute the digest from the same inputs
    /// `mintTokenBinding` used, compare in constant time. No freshness window: a
    /// binding lives as long as the session token it binds; `verifySignature` is the
    /// per-request check that carries the window.
    static func verifyTokenBinding(_ binding: String, key: String) -> Bool {
        let parts = binding.split(separator: tokenBindingSeparator, maxSplits: 1, omittingEmptySubsequences: false)
        guard parts.count == 2 else { return false }
        let timestamp = String(parts[0])
        guard Int(timestamp) != nil else { return false }
        return constantTimeEquals(String(parts[1]), tokenBindingDigest(key: key, timestamp: timestamp))
    }
}
