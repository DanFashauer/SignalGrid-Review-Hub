package com.signalgrid.assist.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class AssistWireTest {

    // ── The happy path, so the deny cases below mean something ────────────────

    @Test
    fun `a well formed allow is an allow`() {
        val d = AssistWire.parse(200, """{"assist":"allow","decisionId":"dec_1"}""")
        assertEquals(Assist.ALLOW, d.assist)
        assertEquals("dec_1", d.decisionId)
    }

    @Test
    fun `reasons and obligations survive the round trip`() {
        val d = AssistWire.parse(
            200,
            """{"assist":"step_up","reasons":["unmanaged device"],"obligations":["webauthn"],"decisionId":"dec_2"}""",
        )
        assertEquals(Assist.STEP_UP, d.assist)
        assertEquals(listOf("unmanaged device"), d.reasons)
        assertEquals(listOf("webauthn"), d.obligations)
    }

    @Test
    fun `an unknown field from a newer server does not break an older client`() {
        val d = AssistWire.parse(200, """{"assist":"allow","somethingAddedLater":{"a":1}}""")
        assertEquals(Assist.ALLOW, d.assist)
    }

    // ── Transport failures. A gate that did not answer did not say yes ────────

    @Test
    fun `a server error denies and names the status`() {
        for (status in listOf(500, 502, 503, 504)) {
            val d = AssistWire.parse(status, """{"assist":"allow"}""")
            assertEquals(Assist.DENY, d.assist, "HTTP $status must deny")
            assertTrue(d.explanation().contains("$status"))
        }
    }

    @Test
    fun `an auth failure on the gate itself denies`() {
        // 401/403 means we could not ask. It is emphatically not an allow, and a body
        // that happens to contain the word "allow" must not rescue it.
        assertEquals(Assist.DENY, AssistWire.parse(401, """{"assist":"allow"}""").assist)
        assertEquals(Assist.DENY, AssistWire.parse(403, """{"assist":"allow"}""").assist)
    }

    @Test
    fun `status zero — the shape a timeout usually takes — denies`() {
        assertEquals(Assist.DENY, AssistWire.parse(0, null).assist)
    }

    @Test
    fun `a 200 with an empty body denies`() {
        assertEquals(Assist.DENY, AssistWire.parse(200, "").assist)
        assertEquals(Assist.DENY, AssistWire.parse(200, "   ").assist)
        assertEquals(Assist.DENY, AssistWire.parse(200, null).assist)
    }

    // ── Body failures ─────────────────────────────────────────────────────────

    @Test
    fun `a captive portal answering 200 with HTML denies`() {
        // The realistic hostile case on a hospital or warehouse wifi: the gate was
        // never reached, but the transport reports success.
        val d = AssistWire.parse(200, "<!doctype html><html><body>Sign in to WiFi</body></html>")
        assertEquals(Assist.DENY, d.assist)
        assertTrue(d.explanation().contains("not a JSON object"))
    }

    @Test
    fun `a truncated body denies rather than throwing`() {
        assertEquals(Assist.DENY, AssistWire.parse(200, """{"assist":"al""").assist)
    }

    @Test
    fun `a JSON array instead of an object denies`() {
        assertEquals(Assist.DENY, AssistWire.parse(200, """["allow"]""").assist)
    }

    @Test
    fun `a missing assist field denies and says which field was missing`() {
        val d = AssistWire.parse(200, """{"decisionId":"dec_3","reasons":["x"]}""")
        assertEquals(Assist.DENY, d.assist)
        assertTrue(d.explanation().contains("assist"))
        assertEquals("dec_3", d.decisionId)
    }

    @Test
    fun `an assist value this build does not know denies`() {
        val d = AssistWire.parse(200, """{"assist":"allow_with_conditions"}""")
        assertEquals(Assist.DENY, d.assist)
    }

    @Test
    fun `a null assist denies`() {
        assertEquals(Assist.DENY, AssistWire.parse(200, """{"assist":null}""").assist)
    }

    // ── Shape tolerance that must NOT become permissiveness ───────────────────

    @Test
    fun `absent reasons is an empty list, not a failure`() {
        val d = AssistWire.parse(200, """{"assist":"allow"}""")
        assertEquals(Assist.ALLOW, d.assist)
        assertTrue(d.reasons.isEmpty())
    }

    @Test
    fun `non string reasons are dropped rather than stringified`() {
        // Rendering {"code":42} to a worker as "{code=42}" looks like an explanation
        // and is not one. Showing nothing is more honest than showing that.
        val d = AssistWire.parse(200, """{"assist":"deny","reasons":[{"code":42},"real reason",null,""]}""")
        assertEquals(listOf("real reason"), d.reasons)
    }

    @Test
    fun `reasons that is not an array at all is treated as absent`() {
        val d = AssistWire.parse(200, """{"assist":"deny","reasons":"a string not an array"}""")
        assertEquals(Assist.DENY, d.assist)
        assertTrue(d.reasons.isEmpty())
    }

    @Test
    fun `no input shape produces an outcome that proceeds unless the gate said so`() {
        // The invariant behind every case above, asserted directly: across a spread of
        // malformed, hostile and truncated inputs, nothing may come back proceedable.
        val hostile = listOf(
            null, "", "null", "0", "[]", "{}", """{"assist":""}""", """{"assist":" "}""",
            "<html></html>", """{"assist":"ALLOW_ALL"}""", """{"Assist":"allow"}""",
        )
        for (body in hostile) {
            val d = AssistWire.parse(200, body)
            assertEquals(
                Assist.DENY,
                d.assist,
                "body ${body?.take(30)} must not yield anything but DENY",
            )
        }
    }
}
