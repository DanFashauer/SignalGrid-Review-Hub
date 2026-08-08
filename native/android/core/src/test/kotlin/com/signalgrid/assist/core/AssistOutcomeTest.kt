package com.signalgrid.assist.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AssistOutcomeTest {

    @Test
    fun `every wire value this client claims to understand parses`() {
        assertEquals(Assist.ALLOW, Assist.parse("allow"))
        assertEquals(Assist.STEP_UP, Assist.parse("step_up"))
        assertEquals(Assist.RESTRICT, Assist.parse("restrict"))
        assertEquals(Assist.DENY, Assist.parse("deny"))
    }

    @Test
    fun `casing and surrounding space do not change the outcome`() {
        // Casing and padding are formatting artefacts of whatever serialised the
        // value. The SPELLING is not — see the next test.
        assertEquals(Assist.STEP_UP, Assist.parse("STEP_UP"))
        assertEquals(Assist.STEP_UP, Assist.parse("  step_up  "))
        assertEquals(Assist.DENY, Assist.parse("DENY"))
        assertEquals(Assist.ALLOW, Assist.parse(" Allow "))
    }

    @Test
    fun `a near-miss spelling denies rather than being guessed through`() {
        // These three USED TO PARSE AS STEP_UP. That was more permissive than denying
        // — STEP_UP offers the worker a challenge and so a route to proceeding, DENY
        // offers none — and it contradicted this client's own fail-closed rule. The
        // wire vocabulary is exactly {allow, step_up, restrict, deny}; see
        // VALID_OUTCOMES in lib/signalgrid-core/src/policy.ts.
        assertEquals(Assist.DENY, Assist.parse("step-up"))
        assertEquals(Assist.DENY, Assist.parse("stepup"))
        assertEquals(Assist.DENY, Assist.parse("StepUp"))
    }

    @Test
    fun `an unrecognised outcome denies rather than guessing`() {
        // The case that matters: a newer server emits something this build has never
        // heard of. Guessing "probably fine" here would hand out the access.
        assertEquals(Assist.DENY, Assist.parse("allow_with_conditions"))
        assertEquals(Assist.DENY, Assist.parse("permit"))
        assertEquals(Assist.DENY, Assist.parse("yes"))
        assertEquals(Assist.DENY, Assist.parse("0"))
    }

    @Test
    fun `absent is distinguishable from unrecognised`() {
        // null means the transport failed to give us a value at all — a different
        // problem from a value we could not interpret, and reported differently.
        assertNull(Assist.parse(null))
        assertNull(Assist.parse(""))
        assertNull(Assist.parse("   "))
    }

    @Test
    fun `step up does NOT let the host app proceed`() {
        // The single most mishandled outcome. "Step up" is not "yes, shortly".
        assertFalse(Assist.STEP_UP.proceedsWithoutFurtherAction)
        assertTrue(Assist.STEP_UP.requiresChallenge)
    }

    @Test
    fun `allow is the only outcome that proceeds with nothing further`() {
        // RESTRICT USED TO BE TRUE HERE. `lib/orchestration/src/index.ts` maps
        // restrict to orchestration mode "hold", not "proceed": it means "continue
        // under a reduced capability ceiling", and applying that ceiling is further
        // action. A host app reading true would have carried on at FULL capability,
        // discarding the restriction entirely.
        assertTrue(Assist.ALLOW.proceedsWithoutFurtherAction)
        assertFalse(Assist.RESTRICT.proceedsWithoutFurtherAction)
        assertFalse(Assist.STEP_UP.proceedsWithoutFurtherAction)
        assertFalse(Assist.DENY.proceedsWithoutFurtherAction)
        // Stated as the invariant, not four separate facts: exactly one outcome
        // proceeds. A fifth "nearly allow" added later fails this.
        assertEquals(1, Assist.entries.count { it.proceedsWithoutFurtherAction })
    }

    @Test
    fun `only step up asks for a challenge`() {
        val asking = Assist.entries.filter { it.requiresChallenge }
        assertEquals(listOf(Assist.STEP_UP), asking)
    }

    @Test
    fun `a blocked worker is told why, in the gate's words`() {
        val d = AssistDecision(
            assist = Assist.RESTRICT,
            reasons = listOf("device is unmanaged", "outside the ward geofence"),
        )
        assertEquals("device is unmanaged; outside the ward geofence", d.explanation())
    }

    @Test
    fun `a reasonless block says so instead of inventing comfort`() {
        // "Contact your administrator" with no reason is unactionable for the worker
        // AND for the help desk. Absence of a reason is itself the report.
        val d = AssistDecision(assist = Assist.DENY, decisionId = "dec_123")
        assertEquals(
            "No reason was supplied by the gate (decision dec_123).",
            d.explanation(),
        )
    }

    @Test
    fun `a reasonless block with no decision id still says which field was missing`() {
        val d = AssistDecision(assist = Assist.DENY)
        assertTrue(d.explanation().contains("unknown"))
    }

    @Test
    fun `the enum has exactly the four documented outcomes`() {
        // A fifth added here without the product vocabulary changing would mean this
        // client speaks something the rest of the system does not.
        assertEquals(
            listOf("ALLOW", "STEP_UP", "RESTRICT", "DENY"),
            Assist.entries.map { it.name },
        )
    }
}
