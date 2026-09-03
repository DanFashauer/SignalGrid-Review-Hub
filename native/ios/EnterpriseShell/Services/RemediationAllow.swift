import Foundation

/// Remediation-allow resolution — the guard that lives AROUND the engine.
///
/// This is the Swift twin of `lib/signalgrid-simulator/src/remediation-allow.ts`,
/// ported against `native/shared/remediation-allow-vectors.json` (the 40 pinned
/// cases both sides answer identically). Read that TS file for the full argument;
/// the short version:
///
/// `DecisionEngine.swift`'s remediation branch adds `allow` when a verified
/// remediation signal arrives with an authenticated identity and a posture reading.
/// The base-trust allow one block below it additionally requires that NOTHING else
/// was found; the remediation branch does not. So a finding that is not itself a
/// restrict/deny/step_up (an integration route degraded, a low battery, a degraded
/// health check) rides along and the decision still carries `allow` — the identical
/// evidence WITHOUT the remediation record would not allow. A remediation record
/// therefore buys an allow that base trust refused, the inverse of what remediation
/// evidence means.
///
/// The engine is not fixed in place: `DecisionEngine.swift` is a byte-faithful port
/// of `decisionEngine.ts` (CLAUDE.md golden rule 1, held by
/// `scripts/check-decision-port-parity.mjs`), and this file is NOT that port — it is
/// a new guard beside it, the SignalContext pattern. Editing the engine to fix this
/// would silently diverge the two ports. So the fix goes around the engine on both
/// sides: the TS module, and this twin.
///
/// THE RULE, stated once: an `allow` the engine offered stands only if the
/// remediation evidence is VERIFIED and nothing else was found alongside it. A
/// remediation that is recorded-but-not-verified, recorded with a failure, absent
/// where one was required, stale beyond the caller's declared window, or illegible
/// never yields `allow`; any other finding present in the same decision never yields
/// `allow`; the withheld allow drops to the NEXT-STRICTER outcome with a named reason
/// code; an unknown or illegible remediation state RAISES the outcome and never
/// lowers it; and this wrapper never moves the engine's own outcome in the permissive
/// direction.
///
/// Deterministic and clock-free: the reference instant is a required argument. There
/// is no `Date()` anywhere in this file and there must not be one — the twin has to
/// reproduce every vector exactly.
enum RemediationAllow {

    /// The four outcomes a host app can actually meet (CLAUDE.md embedded-UX law).
    /// Raw values are the wire strings the vectors and the TS twin use.
    enum HostOutcome: String, CaseIterable {
        case allow
        case stepUp = "step_up"
        case restrict
        case deny
    }

    /// The six remediation states this wrapper distinguishes.
    enum RemediationState: String {
        case verified
        case recordedUnverified = "recorded_unverified"
        case recordedFailed = "recorded_failed"
        case stale
        case absent
        case illegible
    }

    /// Every reason code this wrapper can emit. These are the WRAPPER's codes; they
    /// are not in `docs/REASON_CODES.md` (that catalog is generated from
    /// `decisionEngine.ts` only). The shared vector file pins them.
    enum Reason: String {
        /// Evidence is verified and fresh; the engine's outcome stands unchanged.
        case verified = "REMEDIATION_VERIFIED"
        /// No remediation was required and none was offered; nothing to withhold.
        case notRequired = "REMEDIATION_NOT_REQUIRED"
        /// A record exists and has not been verified. Recorded is not verified.
        case recordedNotVerified = "REMEDIATION_RECORDED_NOT_VERIFIED"
        /// A record exists and its verification FAILED.
        case verificationFailed = "REMEDIATION_VERIFICATION_FAILED"
        /// Verified, but older than the caller's declared evidence window.
        case evidenceStale = "REMEDIATION_EVIDENCE_STALE"
        /// The decision required a remediation and no record arrived.
        case absentWhereRequired = "REMEDIATION_ABSENT_WHERE_REQUIRED"
        /// The record, its instant, or the freshness bound could not be read at all.
        case stateIllegible = "REMEDIATION_STATE_ILLEGIBLE"
        /// Evidence was fine; the engine reported another finding in the same decision.
        case concurrentFailure = "ALLOW_WITHHELD_CONCURRENT_FAILURE"
    }

    /// A remediation record as it arrives from a ticketing / MDM boundary.
    ///
    /// Every field is an OPTIONAL String, present only when the byte that arrived was
    /// actually a string. This is the Swift equivalent of the TS `unknown` narrowed
    /// by `typeof x === "string"`: a status that arrived as the number `42`, a `null`,
    /// or an absent key all become `nil` here, and every reader below treats `nil` as
    /// "not a string" → illegible. Typing these `String` (non-optional) would make the
    /// illegible branch unreachable in Swift and reachable in production, which is the
    /// fail-open this module exists to close.
    struct Record {
        var id: String?
        var status: String?
        var verifiedAt: String?

        init(id: String? = nil, status: String? = nil, verifiedAt: String? = nil) {
            self.id = id
            self.status = status
            self.verifiedAt = verifiedAt
        }
    }

    struct Input {
        /// The engine's own decision outcomes. Read, never mutated, never re-derived.
        var outcomes: [String]
        /// The remediation record, or its absence.
        var record: Record?
        /// Reference instant, ISO-8601. Required: this module reads no clock.
        var asOf: String
        /// How old verified evidence may be, in ms. `nil`, non-finite, or negative
        /// reads ILLEGIBLE (the window itself could not be read, so "within the
        /// window" is unanswerable). `nil` mirrors a JSON `null` arriving here.
        var evidenceMaxAgeMs: Double?
        /// A requirement the CALLER knows about that the decision does not express. It
        /// can only ADD a requirement — never remove one the engine implied.
        var policyRequiresRemediation: Bool?

        init(outcomes: [String],
             record: Record?,
             asOf: String,
             evidenceMaxAgeMs: Double?,
             policyRequiresRemediation: Bool? = nil) {
            self.outcomes = outcomes
            self.record = record
            self.asOf = asOf
            self.evidenceMaxAgeMs = evidenceMaxAgeMs
            self.policyRequiresRemediation = policyRequiresRemediation
        }
    }

    struct Outcome: Equatable {
        /// What the engine offered, projected onto the host's four outcomes.
        var engineOutcome: HostOutcome
        /// What the host sees. Never less strict than `engineOutcome`.
        var hostOutcome: HostOutcome
        var remediationState: RemediationState
        var remediationRequired: Bool
        /// This wrapper's verdict ON THE REMEDIATION AXIS — not, in general, the cause
        /// of `hostOutcome`. An engine `restrict` with verified evidence passes through
        /// and reports `.verified`, which did not cause the restrict. Only when
        /// `allowWithheld` is true is this also the cause of the change.
        var reasonCode: Reason
        /// Every cause found, in the order they were evaluated.
        var reasonCodes: [Reason]
        /// True when the engine offered `allow` and this wrapper took it away.
        var allowWithheld: Bool
        /// Engine outcomes that are findings rather than grants. Derived below.
        var concurrentFindings: [String]
    }

    /// Outcomes that are NOT a finding: the grant itself, the audit record every
    /// decision carries, and the acknowledgement that remediation evidence was seen.
    /// The finding set is the COMPLEMENT, so a new outcome counts as a finding by
    /// default rather than being silently ignored.
    static let nonFindingOutcomes: Set<String> = ["allow", "record_audit", "verify_remediation"]

    /// Strictness ladder. Higher is stricter.
    static func strictness(of outcome: HostOutcome) -> Int {
        switch outcome {
        case .allow: return 0
        case .stepUp: return 1
        case .restrict: return 2
        case .deny: return 3
        }
    }

    /// The next-stricter outcome. `deny` is the ceiling and stays there.
    static func nextStricter(_ outcome: HostOutcome) -> HostOutcome {
        let rank = strictness(of: outcome)
        return HostOutcome.allCases.first { strictness(of: $0) == rank + 1 } ?? .deny
    }

    /// Project the engine's outcome SET onto the one outcome a host meets.
    ///
    /// Fail-closed and non-inventive: `allow` is returned only when the engine
    /// actually said `allow`. A decision with findings but no explicit gate outcome is
    /// NOT a grant, so it projects to the least-strict non-grant, `step_up` — projecting
    /// it to `allow` would manufacture a grant nobody issued.
    static func projectEngineOutcome(_ outcomes: [String]) -> HostOutcome {
        if outcomes.contains("deny") { return .deny }
        if outcomes.contains("restrict") { return .restrict }
        if outcomes.contains("step_up") { return .stepUp }
        if outcomes.contains("allow") { return .allow }
        return .stepUp
    }

    /// Was a remediation required? DERIVED from the decision the engine already made —
    /// `request_remediation` (one was asked for) or `verify_remediation` (one was
    /// acknowledged) — union'd with any requirement the caller states. Union only: the
    /// caller can add a requirement, never cancel one.
    static func remediationRequired(_ outcomes: [String], policyRequiresRemediation: Bool?) -> Bool {
        return outcomes.contains("request_remediation")
            || outcomes.contains("verify_remediation")
            || policyRequiresRemediation == true
    }

    /// A CharacterSet that trims exactly what JavaScript's `String.prototype.trim()`
    /// trims — no more, no less — so `record.id`/`record.status` land in the same
    /// vocabulary bucket on both ports. Swift's `.whitespacesAndNewlines` differs from
    /// JS trim in two code points, and an adversarial parity audit found BOTH as
    /// fail-opens: it trims U+0085 (NEL) which JS keeps (a status `"verified\u{85}"`
    /// then read VERIFIED in Swift, ILLEGIBLE in TS), and it keeps U+FEFF (BOM) which JS
    /// trims (an id of a lone BOM stayed non-empty in Swift, trimmed to empty in TS).
    /// Removing NEL and adding BOM makes the two exact.
    private static let jsTrimSet: CharacterSet = {
        var set = CharacterSet.whitespacesAndNewlines
        set.remove(Unicode.Scalar(0x0085)!) // NEL: JS trim() does NOT treat it as whitespace
        set.insert(Unicode.Scalar(0xFEFF)!) // BOM/ZWNBSP: JS trim() DOES remove it
        return set
    }()

    /// Status vocabularies. An unrecognised word is ILLEGIBLE, never a pass.
    private static let statusVerified: Set<String> = ["verified", "verification_passed", "closed_verified"]
    private static let statusFailed: Set<String> = ["failed", "verification_failed", "rejected", "reopened"]
    private static let statusUnverified: Set<String> = [
        "requested", "recorded", "pending", "in_progress", "submitted", "unverified", "awaiting_verification",
    ]

    /// Parse an ISO-8601 instant to milliseconds since the epoch. An unreadable
    /// instant returns `nil`, and every caller below treats `nil` as ILLEGIBLE — never
    /// as fresh, never as absent.
    ///
    /// PARITY NOTE (the place this twin can drift from `Date.parse`, which the 40
    /// vectors cannot catch — all use clean `….000Z` or obvious garbage). It cuts BOTH
    /// ways, and an adversarial audit found both:
    ///   · `Date.parse` accepts forms `ISO8601DateFormatter` rejects — a date with no
    ///     time (`2026-06-09`), a time with no zone. Rejecting those TIGHTENS (illegible),
    ///     which is safe under golden rule 2.
    ///   · `ISO8601DateFormatter` TOLERATES leading/trailing whitespace that `Date.parse`
    ///     REJECTS (returns NaN) — a padded instant read fresh in Swift and illegible in
    ///     TS, the twin being MORE permissive, a real fail-open. Both ports only trim to
    ///     test EMPTINESS and then pass the RAW string to the parser, so the fix is to
    ///     reject any surrounding whitespace here and match `Date.parse`.
    static func instantMs(_ value: String?) -> Double? {
        guard let value = value else { return nil }
        if value.isEmpty { return nil }
        // Surrounding whitespace: Date.parse rejects it on an ISO-8601 string,
        // ISO8601DateFormatter tolerates it. Reject to stay fail-closed and matched.
        if value.trimmingCharacters(in: .whitespacesAndNewlines) != value { return nil }
        // .withInternetDateTime already accepts `Z` and numeric offsets; a second pass
        // adds fractional-second support without losing the plain form. The explicit
        // element type keeps each literal an OptionSet rather than an array.
        let optionSets: [ISO8601DateFormatter.Options] = [
            [.withInternetDateTime, .withFractionalSeconds],
            [.withInternetDateTime],
        ]
        for options in optionSets {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = options
            if let date = formatter.date(from: value) {
                return date.timeIntervalSince1970 * 1000
            }
        }
        return nil
    }

    /// Resolve a raw record to one of the six states.
    ///
    /// Order matters and is fail-closed throughout: illegibility is decided BEFORE
    /// freshness, and freshness before the record is allowed to count as verified.
    static func classify(_ record: Record?, asOf: String, evidenceMaxAgeMs: Double?) -> RemediationState {
        guard let record = record else { return .absent }

        // A record with no readable identity cannot be reconciled with anything later.
        guard let id = record.id, !id.trimmingCharacters(in: Self.jsTrimSet).isEmpty else { return .illegible }
        _ = id
        guard let rawStatus = record.status,
              !rawStatus.trimmingCharacters(in: Self.jsTrimSet).isEmpty else { return .illegible }

        let status = rawStatus.trimmingCharacters(in: Self.jsTrimSet).lowercased()
        if statusFailed.contains(status) { return .recordedFailed }
        if statusUnverified.contains(status) { return .recordedUnverified }
        // Unknown vocabulary. It is NOT "probably fine": a word this build has never
        // seen is exactly the input a fail-open is made of.
        if !statusVerified.contains(status) { return .illegible }

        // From here the record CLAIMS verification, so the instants have to hold up.
        guard let referenceMs = instantMs(asOf), let verifiedMs = instantMs(record.verifiedAt) else { return .illegible }
        // The window itself is unreadable (null / non-finite / negative), so "within
        // the window" is unanswerable.
        guard let maxAgeMs = evidenceMaxAgeMs, maxAgeMs.isFinite, maxAgeMs >= 0 else { return .illegible }

        // Zero skew tolerance by design: both instants belong to one evaluation record
        // and there is no second clock to disagree. A verification dated AFTER the
        // reference is not evidence of freshness, so it RAISES to illegible rather than
        // reading fresh.
        if verifiedMs > referenceMs { return .illegible }
        // Evidence older than the caller's declared window is STALE rather than fresh.
        if referenceMs - verifiedMs > maxAgeMs { return .stale }

        return .verified
    }

    /// The reason code a deficient state carries. Total over `RemediationState`.
    private static func reason(for state: RemediationState) -> Reason {
        switch state {
        case .verified: return .verified
        case .recordedUnverified: return .recordedNotVerified
        case .recordedFailed: return .verificationFailed
        case .stale: return .evidenceStale
        case .absent: return .absentWhereRequired
        case .illegible: return .stateIllegible
        }
    }

    /// The outcome the host sees. See THE RULE at the top of this file.
    ///
    ///   1. project the engine's outcome set onto the host's four outcomes;
    ///   2. classify the remediation record;
    ///   3. a state other than `verified` is DEFICIENT — except `absent` when nothing
    ///      required a remediation, which is an ordinary decision and is left alone;
    ///   4. a finding present alongside the grant is DISQUALIFYING (the
    ///      `outcomes.size === 0` guard the base-trust allow applies and the engine's
    ///      remediation branch omits);
    ///   5. if the engine offered `allow` and either 3 or 4 holds, withhold it to the
    ///      next-stricter outcome; otherwise return the engine's outcome unchanged.
    ///
    /// Step 5 is the only step that can change an outcome, and it only ever moves in
    /// the stricter direction.
    static func resolve(_ input: Input) -> Outcome {
        let outcomes = input.outcomes
        let engineOutcome = projectEngineOutcome(outcomes)
        let required = remediationRequired(outcomes, policyRequiresRemediation: input.policyRequiresRemediation)
        let state = classify(input.record, asOf: input.asOf, evidenceMaxAgeMs: input.evidenceMaxAgeMs)

        let concurrentFindings = outcomes.filter { !nonFindingOutcomes.contains($0) }

        // `absent` with nothing requiring a remediation is not a deficiency — the
        // ordinary happy path (an identity-and-posture allow with no remediation near
        // it). Punishing it would make the wrapper fire on correct behaviour.
        let stateDeficient = state != .verified && !(state == .absent && !required)

        var reasonCodes: [Reason] = []
        if stateDeficient {
            reasonCodes.append(reason(for: state))
        } else if state == .verified {
            reasonCodes.append(.verified)
        } else {
            reasonCodes.append(.notRequired)
        }
        if !concurrentFindings.isEmpty && outcomes.contains("allow") {
            reasonCodes.append(.concurrentFailure)
        }

        let mustWithhold = engineOutcome == .allow && (stateDeficient || !concurrentFindings.isEmpty)
        let hostOutcome = mustWithhold ? nextStricter(engineOutcome) : engineOutcome

        // The primary cause names the EVIDENCE when the evidence is at fault, and the
        // concurrent finding only when the evidence was fine.
        let reasonCode: Reason
        if stateDeficient {
            reasonCode = reason(for: state)
        } else if mustWithhold {
            reasonCode = .concurrentFailure
        } else {
            reasonCode = reasonCodes[0]
        }

        return Outcome(
            engineOutcome: engineOutcome,
            hostOutcome: hostOutcome,
            remediationState: state,
            remediationRequired: required,
            reasonCode: reasonCode,
            reasonCodes: reasonCodes,
            allowWithheld: mustWithhold,
            concurrentFindings: concurrentFindings
        )
    }
}
