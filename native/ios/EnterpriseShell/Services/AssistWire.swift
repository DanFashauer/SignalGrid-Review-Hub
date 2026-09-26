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

        let rawAssist = primitiveContent(root["assist"])
        guard let parsed = Assist.parse(rawAssist) else {
            // Present-and-unreadable is already DENY inside Assist.parse. Reaching here
            // means the field was absent entirely (or not a primitive) — a shape
            // mismatch, reported as one rather than silently defaulted.
            return AssistDecision(assist: .deny,
                                  reasons: ["the Assist gate's response carried no \"assist\" field"],
                                  decisionId: stringOrNil(root, "decisionId"))
        }

        // `obligations` is OPTIONAL-ABSENT, and absent is the served case: the
        // /api/v1/authorize contract declares `assist`, `decisionId` and `reasons` only.
        // Absent means no obligation is known to be satisfied — an empty list is never
        // permission; only ALLOW proceeds, whatever this list holds.
        // PRESENT-BUT-NOT-A-LIST IS MALFORMED, and malformed is DENY — the same rule
        // `assist` gets above. Coercing it to empty let a step_up stand with its
        // obligations silently dropped, an asymmetry the shared vectors pin closed.
        if let obligations = root["obligations"], !(obligations is [Any]) {
            return AssistDecision(assist: .deny,
                                  reasons: ["the Assist gate's response carried an \"obligations\" field that is not a list"],
                                  decisionId: stringOrNil(root, "decisionId"))
        }

        return AssistDecision(assist: parsed,
                              reasons: stringList(root, "reasons"),
                              obligations: stringList(root, "obligations"),
                              decisionId: stringOrNil(root, "decisionId"))
    }

    /// The textual content of a JSON primitive, the way the Kotlin twin reads
    /// `jsonPrimitive.content`: a string as itself, a number or boolean as its text
    /// (so it reaches `Assist.parse` and is denied as unrecognised, never mistaken for
    /// absent). An object, an array, or JSON null is not a primitive here → nil.
    /// (Kotlin renders JSON null as the text "null"; it is denied on either reading, and
    /// a null `decisionId` must not become the id "null", so null reads as absent.)
    private static func primitiveContent(_ value: Any?) -> String? {
        guard let value = value else { return nil }
        if let s = value as? String { return s }
        if let n = value as? NSNumber {
            if CFGetTypeID(n) == CFBooleanGetTypeID() { return n.boolValue ? "true" : "false" }
            return n.stringValue
        }
        return nil
    }

    private static func stringOrNil(_ root: [String: Any], _ key: String) -> String? {
        guard let s = primitiveContent(root[key]) else { return nil }
        return s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : s
    }

    /// Read a list of strings, tolerating the shapes a real server actually emits. A
    /// missing list is an EMPTY list, not an error — `reasons` is genuinely optional on
    /// an allow. But an entry that is not a string is dropped rather than stringified:
    /// rendering `{"code":42}` to a worker as "{code=42}" is worse than showing nothing.
    private static func stringList(_ root: [String: Any], _ key: String) -> [String] {
        guard let list = root[key] as? [Any] else { return [] }
        return list.compactMap { item -> String? in
            guard let s = item as? String else { return nil }
            return s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : s
        }
    }
}
