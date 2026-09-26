import Foundation

// The iOS Assist-wire client — the third implementation of one fail-closed rule.
//
// Transcribed 2026-09-26 from `native/android/core/src/main/kotlin/com/signalgrid/assist/
// core/AssistOutcome.kt` and `AssistWire.kt` (the Rust twin is `native/desktop/core`), and
// held to the SAME shared cases as both: `native/shared/assist-wire-conformance.json`,
// replayed by `EnterpriseShellTests/AssistWireConformanceTests.swift`. Until then iOS was
// carved out of those vectors (BUILD_BACKLOG / plan row 48) because the shell ports the
// decision engine instead of consuming `/v1/authorize`. It still does not CALL that route
// — its live wire is `POST /v1/app-workflows/evaluate` (`DecisionService.swift`) — so this
// is a conformant client with no caller yet; wiring the shell to the Assist wire is a
// product change (DR-007 / DR-023 territory), stated here rather than implied done.
//
// THIS FILE DOES NOT DECIDE ANYTHING. It parses a decision the server already made and
// shapes it for display. The failure that matters is not a crash — a crash is loud and
// gets fixed. It is a client that receives something it does not understand and carries
// on as though the answer were yes: a 500, a truncated body, an HTML error page from a
// proxy, a field renamed by a newer server. Each is indistinguishable from "allow" to
// code that only checks whether parsing threw. So the rule here is the repository's
// rule, applied at the edge: an unknown never lowers assurance. Anything not positively
// understood as a decision becomes DENY, and carries a reason saying which failure it was.

/// What the Assist gate returned, and what the host app is therefore allowed to do.
/// The four outcomes are the product's whole vocabulary.
enum Assist: String {
    /// Proceed. Nothing further is required.
    case allow
    /// Proceed only after satisfying an additional challenge.
    case step_up
    /// Proceed, but with a reduced capability ceiling.
    case restrict
    /// Do not proceed.
    case deny

    /// Does this outcome, ON ITS OWN, let the host app continue with nothing further?
    /// ONLY ALLOW. STEP_UP is "yes, eventually" only after the challenge; RESTRICT means
    /// "continue under a reduced ceiling", and applying that ceiling IS further action —
    /// a client that read `true` here would carry on at full capability (the defect the
    /// shared vectors found in the Kotlin client on their first run against Rust).
    var proceedsWithoutFurtherAction: Bool { self == .allow }

    /// True when the worker must be shown something before anything else happens.
    var requiresChallenge: Bool { self == .step_up }

    /// Parse the wire value. FAIL-CLOSED ON ANYTHING UNRECOGNISED: a value this client
    /// does not know is not "probably allow" — unknown becomes DENY. Returns nil ONLY for
    /// a genuinely absent (nil or blank) value, so a caller can tell "the server said
    /// something I don't understand" (deny) from "the server said nothing" (transport).
    /// NO SPELLING ALIASES: the wire vocabulary is exactly four values; "stepup" or
    /// "step-up" is a gate this client does not understand, and mapping it to STEP_UP
    /// would offer a route to proceeding that DENY does not.
    static func parse(_ raw: String?) -> Assist? {
        guard let raw = raw else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return nil }
        switch trimmed.lowercased() {
        case "allow": return .allow
        case "step_up": return .step_up
        case "restrict": return .restrict
        case "deny": return .deny
        default: return .deny
        }
    }
}

/// A decision as this client understands it.
struct AssistDecision: Equatable {
    /// The outcome.
    let assist: Assist
    /// Why, in the gate's own words — shown to an operator, never invented here.
    var reasons: [String] = []
    /// What must happen for the outcome to hold (e.g. a challenge type).
    var obligations: [String] = []
    /// The server's identifier, for correlating with the audit ledger.
    var decisionId: String? = nil

    /// The single line a host app should show when it blocks or limits someone. When
    /// the gate gave reasons, they are shown; when it gave none, THAT is stated plainly
    /// rather than papered over with a friendly sentence that means nothing.
    func explanation() -> String {
        if !reasons.isEmpty { return reasons.joined(separator: "; ") }
        if assist == .allow { return "Allowed." }
        return "No reason was supplied by the gate (decision \(decisionId ?? "unknown"))."
    }
}

/// Turning an HTTP result from `/v1` into something the host app may act on.
enum AssistWire {

    /// - Parameters:
    ///   - status: the HTTP status actually received (0 when no response was read)
    ///   - body: the raw response body, exactly as read; nil when none was read
    static func parse(status: Int, body: String?) -> AssistDecision {
        // ── Transport-level outcomes ─────────────────────────────────────────
        // A gate that cannot be reached is not a gate that said yes. 5xx, 401/403 on
        // the gate itself, a timeout surfaced as status 0 — all deny, all named.
        guard (200...299).contains(status) else {
            return AssistDecision(assist: .deny,
                                  reasons: ["the Assist gate returned HTTP \(status); no decision was made"])
        }
        guard let body = body, !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return AssistDecision(assist: .deny,
                                  reasons: ["the Assist gate returned HTTP \(status) with an empty body"])
        }

        // ── Body-level outcomes ──────────────────────────────────────────────
        // Strict JSON, and the top level must be an OBJECT. A proxy or captive portal
        // answering 200 with an HTML login page, a truncated body, a bare literal or an
        // array parse as neither JSON object nor permission. `JSONSerialization` with no
        // `.fragmentsAllowed` rejects bare literals; an array is rejected below.
        let root: [String: Any]
        do {
            let parsed = try JSONSerialization.jsonObject(with: Data(body.utf8), options: [])
            guard let object = parsed as? [String: Any] else {
                return AssistDecision(assist: .deny,
                                      reasons: ["the Assist gate's response was not a JSON object (top level is \(type(of: parsed)))"])
            }
            root = object
        } catch {
            return AssistDecision(assist: .deny,
                                  reasons: ["the Assist gate's response was not a JSON object (\((error as NSError).domain) \((error as NSError).code))"])
        }

        // A repeated top-level key is ambiguous JSON, and which copy Foundation keeps is an
        // implementation detail this client must not depend on (it read last-wins where
        // measured: {"assist":"deny","assist":"allow"} was an allow). Nothing is read
        // from such a body.
        if let repeated = repeatedTopLevelKey(body) {
            return AssistDecision(assist: .deny,
                                  reasons: ["the Assist gate's response carried a duplicate \"\(repeated)\" key"])
        }

        let decisionId = stringOrNil(root, "decisionId")
        func refuse(_ reason: String) -> AssistDecision {
            AssistDecision(assist: .deny, reasons: [reason], decisionId: decisionId)
        }

        let rawAssist = primitiveContent(root["assist"])
        guard let parsed = Assist.parse(rawAssist) else {
            // Present-and-unreadable is already DENY inside Assist.parse. Reaching here
            // means the field was absent entirely (or not a primitive) — a shape
            // mismatch, reported as one rather than silently defaulted.
            return refuse("the Assist gate's response carried no \"assist\" field")
        }

        // `obligations` is OPTIONAL-ABSENT, and absent is the served case: the
        // /api/v1/authorize contract declares `assist`, `decisionId` and `reasons` only.
        // Absent means no obligation is known to be satisfied — an empty list is never
        // permission; only ALLOW proceeds, whatever this list holds.
        // PRESENT-BUT-WRONG-TYPE IS MALFORMED, and malformed is DENY — for `obligations`
        // and `reasons` alike, and for a non-string ENTRY as much as for a non-list.
        // Coercing either to empty let a decision stand on a body this client did not
        // understand, with an obligation silently dropped.
        guard let obligations = stringList(root, "obligations") else {
            return refuse("the Assist gate's response carried an \"obligations\" field that is not a list of strings")
        }
        guard let reasons = stringList(root, "reasons") else {
            return refuse("the Assist gate's response carried a \"reasons\" field that is not a list of strings")
        }

        // REQUIRED on every outcome (AssistResult `required: [assist, decisionId]`). Every
        // real decision is persisted and audited under its id, and a step_up is answered
        // through it; a body without one is not a decision anybody recorded.
        guard decisionId != nil else {
            return AssistDecision(assist: .deny,
                                  reasons: ["the Assist gate's response carried no usable \"decisionId\" (the contract requires a non-blank string)"])
        }

        return AssistDecision(assist: parsed, reasons: reasons, obligations: obligations, decisionId: decisionId)
    }

    /// The textual content of a JSON primitive, the way the Kotlin twin reads
    /// `jsonPrimitive.content` for `assist`: a string as itself, a number or boolean as
    /// its text (so it reaches `Assist.parse` and is denied as unrecognised, never
    /// mistaken for absent). An object, an array, or JSON null is not a primitive → nil.
    private static func primitiveContent(_ value: Any?) -> String? {
        guard let value = value else { return nil }
        if let s = value as? String { return s }
        if let n = value as? NSNumber {
            if CFGetTypeID(n) == CFBooleanGetTypeID() { return n.boolValue ? "true" : "false" }
            return n.stringValue
        }
        return nil
    }

    /// A non-blank JSON STRING. Numbers, booleans, null, objects and lists are not ids —
    /// a numeric 42 once became the id "42".
    private static func stringOrNil(_ root: [String: Any], _ key: String) -> String? {
        guard let s = root[key] as? String else { return nil }
        return s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : s
    }

    /// Read an optional list of strings. Absent is an EMPTY list, not an error —
    /// `reasons` is genuinely optional on an allow. Present must be a list whose every
    /// entry is a string; anything else is nil, which the caller turns into DENY. Blank
    /// strings are well-typed and are dropped from display.
    private static func stringList(_ root: [String: Any], _ key: String) -> [String]? {
        guard let value = root[key] else { return [] }
        guard let list = value as? [Any] else { return nil }
        var out: [String] = []
        for item in list {
            guard let s = item as? String else { return nil }
            if !s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { out.append(s) }
        }
        return out
    }

    /// The first top-level key that appears twice, or nil. Only ever run on a body
    /// JSONSerialization has already accepted as an object, so the text is well-formed;
    /// each key is decoded by the same parser before comparing, so "\u0061ssist" is
    /// caught as a second "assist". Keys below the top level are out of scope: nothing
    /// there is read as part of the decision. Bounds are checked anyway — a scan must
    /// never trap the shell — and anything it cannot read is reported as a duplicate,
    /// which denies. Mirrors `repeatedTopLevelKey` in the Kotlin twin.
    private static func repeatedTopLevelKey(_ body: String) -> String? {
        let b = Array(body.utf8)
        let quote = UInt8(ascii: "\""), backslash = UInt8(ascii: "\\")
        var seen = Set<String>()
        var depth = 0
        var i = 0
        while i < b.count {
            switch b[i] {
            case UInt8(ascii: "{"), UInt8(ascii: "["):
                depth += 1
            case UInt8(ascii: "}"), UInt8(ascii: "]"):
                depth -= 1
            case quote:
                let start = i
                i += 1
                while i < b.count, b[i] != quote {
                    if b[i] == backslash { i += 1 }
                    i += 1
                }
                guard i < b.count else { return "(unterminated string)" }
                guard depth == 1 else { break }
                var j = i + 1
                while j < b.count, [0x20, 0x09, 0x0A, 0x0D].contains(b[j]) { j += 1 }
                guard j < b.count, b[j] == UInt8(ascii: ":") else { break }
                let token = Data(b[start...i])
                guard let key = (try? JSONSerialization.jsonObject(with: token, options: .fragmentsAllowed)) as? String else {
                    return "(undecodable key)"
                }
                if !seen.insert(key).inserted { return key }
            default:
                break
            }
            i += 1
        }
        return nil
    }
}
