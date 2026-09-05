import Foundation

/// Posture-allow resolution — the SECOND guard that lives AROUND the engine.
///
/// This is the Swift twin of `lib/signalgrid-simulator/src/posture-allow.ts`,
/// ported against `native/shared/posture-allow-vectors.json` (the 52 pinned cases
/// both sides answer identically). Read that TS file for the full argument; the
/// short version:
///
/// `DecisionEngine.swift`'s base-trust allow fires when an authenticated identity
/// meets a posture-bearing signal (`device.posture_observed` or
/// `apple.ddm_declared_state`) and no `device.non_compliant` is present. The posture
/// ATTRIBUTES on that signal are read only for their known-bad members —
/// `compliance == "non_compliant"`, `managementState == "unmanaged"`,
/// `freshness == "stale"`, `declaredState == "stale"`. Any other value — `"unknown"`,
/// `"expired"`, `"pending"`, a number, an absent key — matches none of those
/// literals, so the signal counts as posture and the decision carries `allow`.
/// Measured on the real TS engine before the wrapper was written (eighth
/// verdict-core round, 2026-09-05). The unknown loosened the answer.
///
/// The engine is not fixed in place: `DecisionEngine.swift` is a byte-faithful port
/// (CLAUDE.md golden rule 1), and this file is NOT that port — it is a guard beside
/// it, the `RemediationAllow` pattern. So the fix goes around the engine on both
/// sides: the TS module, and this twin.
///
/// THE RULE, stated once: an `allow` the engine offered stands only if EVERY
/// posture-bearing signal in the decision's input AFFIRMS every posture attribute
/// the engine consults — a `device.posture_observed` must read `compliance:
/// "compliant"` and `freshness: "fresh"`, an `apple.ddm_declared_state` must read
/// `declaredState: "current"` and `compliance: "compliant"`, and `managementState`,
/// when either carries it, must read `"managed"`. Any other member is UNAFFIRMED; an
/// attribute absent where required, or not a string, is ILLEGIBLE. Either withholds
/// the allow, which drops to the NEXT-STRICTER outcome with a named reason code; an
/// unaffirmed or illegible posture RAISES the outcome and never lowers it; and this
/// wrapper never moves the engine's own outcome in the permissive direction.
///
/// Deterministic and clock-free: nothing here reads a clock, and nothing may — the
/// twin has to reproduce every vector exactly.
enum PostureAllow {

    /// The host's four outcomes, shared with the remediation wrapper (same ladder,
    /// same projection, same next-stricter step — one definition, not two).
    typealias HostOutcome = RemediationAllow.HostOutcome

    /// The posture states this wrapper distinguishes.
    enum PostureState: String, CaseIterable {
        /// Every posture-bearing signal affirmed every attribute the engine consults.
        case affirmed
        /// A consulted attribute carries a member that is not the affirmative one.
        case unaffirmed
        /// A consulted attribute is absent where required, or is not a string.
        case illegible
        /// No posture-bearing signal at all.
        case absent
    }

    /// Every reason code this wrapper can emit. These are the WRAPPER's codes,
    /// catalogued by `scripts/gen-reason-codes.mjs` from the TS array; the shared
    /// vector file pins them.
    enum Reason: String {
        case affirmed = "POSTURE_AFFIRMED"
        case unaffirmed = "POSTURE_UNAFFIRMED"
        case illegible = "POSTURE_ILLEGIBLE"
        case absent = "POSTURE_ABSENT"
        case withheldUnaffirmed = "ALLOW_WITHHELD_POSTURE_UNAFFIRMED"
        case withheldIllegible = "ALLOW_WITHHELD_POSTURE_ILLEGIBLE"
    }

    /// A signal as it arrives across a boundary. `attributes` is `[String: Any]?` on
    /// purpose: a value that is not a string (a number, a JSON null bridged to NSNull,
    /// a boolean) must be READABLE as "not a string" so the illegible branch is
    /// reachable in Swift exactly where it is reachable in TS. Typing the attributes
    /// `[String: String]` would make illegibility unrepresentable here and
    /// representable in production, which is the fail-open this module closes.
    struct Signal {
        var type: String
        var attributes: [String: Any]?

        init(type: String, attributes: [String: Any]?) {
            self.type = type
            self.attributes = attributes
        }
    }

    /// One attribute that failed to affirm, named so the host can say why.
    struct Deficiency: Equatable {
        enum Kind: String {
            /// A member other than the affirmative one.
            case unaffirmed
            /// Absent where required, or not a string.
            case illegible
        }
        var signalType: String
        var attribute: String
        var kind: Kind
    }

    /// The attributes the engine consults on each posture-bearing signal type, and
    /// the ONE member of each that affirms. Order matches the TS `POSTURE_BEARING`
    /// object's key order, so deficiencies list in the same order on both sides.
    /// `required` attributes must be present; `optional` ones are judged only when
    /// present. The shared vector file carries this table too, and the twin's test
    /// asserts the two are identical.
    struct Spec {
        let required: [(attribute: String, affirmative: String)]
        let optional: [(attribute: String, affirmative: String)]
    }

    static let postureBearingOrder: [String] = ["device.posture_observed", "apple.ddm_declared_state"]

    static let postureBearing: [String: Spec] = [
        "device.posture_observed": Spec(
            required: [(attribute: "compliance", affirmative: "compliant"), (attribute: "freshness", affirmative: "fresh")],
            optional: [(attribute: "managementState", affirmative: "managed")]
        ),
        "apple.ddm_declared_state": Spec(
            required: [(attribute: "declaredState", affirmative: "current"), (attribute: "compliance", affirmative: "compliant")],
            optional: [(attribute: "managementState", affirmative: "managed")]
        ),
    ]

    struct Outcome: Equatable {
        /// What the engine offered, projected onto the host's four outcomes.
        var engineOutcome: HostOutcome
        /// What the host sees. Never less strict than `engineOutcome`.
        var hostOutcome: HostOutcome
        var postureState: PostureState
        /// The verdict ON THE POSTURE AXIS. When `allowWithheld` is true it is also the
        /// cause of the change; otherwise it only says what the posture evidence read.
        var reasonCode: Reason
        /// Every cause found, in the order they were evaluated.
        var reasonCodes: [Reason]
        /// True when the engine offered `allow` and this wrapper took it away.
        var allowWithheld: Bool
        /// Every attribute that failed to affirm, in signal order then attribute order.
        var deficiencies: [Deficiency]
    }

    private static func reason(for state: PostureState) -> Reason {
        switch state {
        case .affirmed: return .affirmed
        case .unaffirmed: return .unaffirmed
        case .illegible: return .illegible
        case .absent: return .absent
        }
    }

    /// Judge one attribute. Mirrors the TS `judge()` exactly: an absent REQUIRED key is
    /// illegible, an absent optional key is fine, a present non-string is illegible,
    /// a present string other than the affirmative member is unaffirmed.
    private static func judge(signalType: String,
                              attribute: String,
                              affirmative: String,
                              attributes: [String: Any],
                              required: Bool,
                              into out: inout [Deficiency]) {
        guard let raw = attributes[attribute] else {
            if required { out.append(Deficiency(signalType: signalType, attribute: attribute, kind: .illegible)) }
            return
        }
        // A JSON null bridges to NSNull, a number to NSNumber, a bool to NSNumber —
        // none of them is a String, and none may read as a member.
        guard let value = raw as? String else {
            out.append(Deficiency(signalType: signalType, attribute: attribute, kind: .illegible))
            return
        }
        if value != affirmative {
            out.append(Deficiency(signalType: signalType, attribute: attribute, kind: .unaffirmed))
        }
    }

    /// Classify the posture evidence in a signal set. Illegible outranks unaffirmed
    /// outranks affirmed: the least-readable deficiency names the state, and every
    /// deficiency is listed so the classification never hides a second cause.
    static func classify(_ signals: [Signal]) -> (state: PostureState, deficiencies: [Deficiency]) {
        var deficiencies: [Deficiency] = []
        var seen = false
        for signal in signals {
            guard let spec = postureBearing[signal.type] else { continue }
            seen = true
            let attributes = signal.attributes ?? [:]
            for entry in spec.required {
                judge(signalType: signal.type, attribute: entry.attribute, affirmative: entry.affirmative,
                      attributes: attributes, required: true, into: &deficiencies)
            }
            for entry in spec.optional {
                judge(signalType: signal.type, attribute: entry.attribute, affirmative: entry.affirmative,
                      attributes: attributes, required: false, into: &deficiencies)
            }
        }
        if !seen { return (.absent, deficiencies) }
        if deficiencies.contains(where: { $0.kind == .illegible }) { return (.illegible, deficiencies) }
        if !deficiencies.isEmpty { return (.unaffirmed, deficiencies) }
        return (.affirmed, deficiencies)
    }

    /// Resolve whether an `allow` the engine offered survives the posture evidence.
    /// Pure over its input; the engine's outcome is projected, never re-derived, and
    /// is never moved in the permissive direction.
    static func resolve(outcomes: [String], signals: [Signal]) -> Outcome {
        let engineOutcome = RemediationAllow.projectEngineOutcome(outcomes)
        let classified = classify(signals)
        var reasonCodes: [Reason] = [reason(for: classified.state)]

        var hostOutcome = engineOutcome
        var allowWithheld = false
        if engineOutcome == .allow && classified.state != .affirmed {
            // `absent` cannot reach here through the real engine (base trust needs a
            // posture-bearing signal), but a caller can hand this wrapper any outcome
            // set, and an allow with NO posture evidence is withheld like an illegible
            // one — an absent reading is the least legible reading there is.
            hostOutcome = RemediationAllow.nextStricter(engineOutcome)
            allowWithheld = true
            reasonCodes.append(classified.state == .unaffirmed ? .withheldUnaffirmed : .withheldIllegible)
        }

        return Outcome(
            engineOutcome: engineOutcome,
            hostOutcome: hostOutcome,
            postureState: classified.state,
            reasonCode: reasonCodes[reasonCodes.count - 1],
            reasonCodes: reasonCodes,
            allowWithheld: allowWithheld,
            deficiencies: classified.deficiencies
        )
    }
}
