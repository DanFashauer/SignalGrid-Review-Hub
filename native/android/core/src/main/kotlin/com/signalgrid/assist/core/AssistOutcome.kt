package com.signalgrid.assist.core

/**
 * What the Assist gate returned, and what the host app is therefore allowed to do.
 *
 * THIS MODULE DOES NOT DECIDE ANYTHING. It parses a decision the server already made
 * and shapes it for display. That is a deliberate boundary, not an oversight:
 * `native/ios` carries a byte-faithful port of the TypeScript engine and pays for it
 * with a parity gate (`scripts/check-decision-port-parity.mjs`) that fails the build
 * when the two drift. A second port would be a second thing to keep in lockstep.
 * Android is a client of `/v1`, so there is nothing to keep in lockstep.
 *
 * The four outcomes are the product's whole vocabulary — see docs. SignalGrid is
 * invisible to the worker; their own host app asks the gate and honours the answer.
 */
enum class Assist {
    /** Proceed. Nothing further is required. */
    ALLOW,

    /** Proceed only after satisfying an additional challenge. */
    STEP_UP,

    /** Proceed, but with a reduced capability ceiling. */
    RESTRICT,

    /** Do not proceed. */
    DENY;

    /**
     * Does this outcome, ON ITS OWN, let the host app continue with nothing further?
     *
     * ONLY ALLOW.
     *
     * STEP_UP is the answer most likely to be mishandled: a host app that treats
     * "step up" as "yes, eventually" and opens the screen while the challenge is
     * pending has already granted the access.
     *
     * RESTRICT USED TO RETURN TRUE HERE, AND THAT WAS A DEFECT. It was found by the
     * shared conformance vectors on their first run against the Rust desktop client,
     * which disagreed. Checked against the source of truth rather than settled by
     * preference: `lib/orchestration/src/index.ts` maps `restrict` to orchestration
     * mode `hold`, not `proceed`. RESTRICT means "continue, but under a reduced
     * capability ceiling" — applying that ceiling IS further action, and a host app
     * that read `true` here would carry on at FULL capability, silently discarding
     * the restriction. Which is the whole failure this property exists to prevent,
     * reproduced in the property itself.
     *
     * Use [requiresChallenge] and the decision's obligations to tell the three
     * non-proceeding outcomes apart; do not reintroduce a second thing that is
     * "nearly allow".
     */
    val proceedsWithoutFurtherAction: Boolean
        get() = this == ALLOW

    /** True when the worker must be shown something before anything else happens. */
    val requiresChallenge: Boolean
        get() = this == STEP_UP

    companion object {
        /**
         * Parse the wire value.
         *
         * FAIL-CLOSED ON ANYTHING UNRECOGNISED. A value this client does not know is
         * not a reason to guess, and it is not "probably allow" — a newer server
         * emitting an outcome an older client has never heard of is exactly when
         * guessing is most expensive. Unknown becomes DENY, which is the same law the
         * decision core applies to unknown signals: an unknown never lowers assurance.
         *
         * Returns null ONLY for a genuinely absent value, so a caller can tell
         * "the server said something I don't understand" (deny) apart from "the
         * server said nothing at all" (a transport problem, reported as such).
         *
         * NO SPELLING ALIASES. This used to accept "step-up" and "stepup" as STEP_UP,
         * which contradicted the paragraph directly above it. The wire vocabulary is
         * exactly four values — see `VALID_OUTCOMES` in `lib/signalgrid-core/src/
         * policy.ts` and `AccessOutcome` in `lib/fleet-connector/src/client.ts`;
         * neither spelling appears anywhere in the product. So a gate sending
         * "stepup" is a gate this client does not understand, and mapping it to
         * STEP_UP is strictly MORE PERMISSIVE than denying: STEP_UP offers the worker
         * a challenge and therefore a route to proceeding, where DENY offers none.
         * Guessing a route forward from a misspelling is the exact thing the comment
         * above forbids. Found by the shared conformance vectors.
         */
        fun parse(raw: String?): Assist? {
            if (raw == null || raw.isBlank()) return null
            return when (raw.trim().lowercase()) {
                "allow" -> ALLOW
                "step_up" -> STEP_UP
                "restrict" -> RESTRICT
                "deny" -> DENY
                else -> DENY
            }
        }
    }
}

/**
 * A decision as this client understands it.
 *
 * @param assist the outcome
 * @param reasons why, in the gate's own words — shown to an operator, never invented here
 * @param obligations what must happen for the outcome to hold (e.g. a challenge type)
 * @param decisionId the server's identifier, for correlating with the audit ledger
 */
data class AssistDecision(
    val assist: Assist,
    val reasons: List<String> = emptyList(),
    val obligations: List<String> = emptyList(),
    val decisionId: String? = null,
) {
    /**
     * The single line a host app should show when it blocks or limits someone.
     *
     * "Ask your administrator" with no reason is the failure mode this avoids: the
     * worker cannot act on it, and the help desk cannot either. When the gate gave
     * reasons, they are shown. When it gave none, THAT is stated plainly rather than
     * papered over with a friendly-sounding sentence that means nothing.
     */
    fun explanation(): String = when {
        reasons.isNotEmpty() -> reasons.joinToString("; ")
        assist == Assist.ALLOW -> "Allowed."
        else -> "No reason was supplied by the gate (decision ${decisionId ?: "unknown"})."
    }
}
