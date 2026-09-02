package com.signalgrid.assist.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class GateEndpointTest {

    private fun refusedReason(raw: String?): String {
        val r = GateEndpoint.validate(raw)
        assertTrue(r is GateEndpoint.Result.Refused, "expected refusal for ${raw?.take(60)}, got $r")
        return (r as GateEndpoint.Result.Refused).reason
    }

    private fun usable(raw: String?): String {
        val r = GateEndpoint.validate(raw)
        assertTrue(r is GateEndpoint.Result.Usable, "expected usable for ${raw?.take(60)}, got $r")
        return (r as GateEndpoint.Result.Usable).baseUrl
    }

    @Test
    fun `https is accepted`() {
        assertEquals("https://gate.example.com", usable("https://gate.example.com"))
        assertEquals("https://gate.example.com:8443", usable("https://gate.example.com:8443"))
        assertEquals("https://gate.example.com/api", usable("https://gate.example.com/api"))
    }

    @Test
    fun `a trailing slash is removed so paths do not double up`() {
        // `${base}/v1/authorize` against a base ending in "/" yields "//v1/authorize",
        // which 404s on some servers and silently redirects on others.
        assertEquals("https://gate.example.com", usable("https://gate.example.com/"))
        assertEquals("https://gate.example.com/api", usable("https://gate.example.com/api/"))
    }

    @Test
    fun `the api mount is the base, and appending the route reaches authorize`() {
        // The one composition that reaches a decision, pinned so the "append
        // /v1/authorize" comments cannot drift from what actually resolves.
        assertEquals("https://host/api/v1/authorize", usable("https://host/api") + "/v1/authorize")
        assertEquals("https://host/api/v1/authorize", usable("https://host/api/") + "/v1/authorize")
    }

    @Test
    fun `surrounding whitespace from a config field is tolerated`() {
        assertEquals("https://gate.example.com", usable("  https://gate.example.com  "))
    }

    // ── The rule this file exists for ─────────────────────────────────────────

    @Test
    fun `plaintext http to a remote host is REFUSED`() {
        val reason = refusedReason("http://gate.example.com")
        assertTrue(reason.contains("plaintext"), reason)
        // A decision obeyed by the host app, sent over a network where anyone on the
        // path can rewrite deny to allow, is not a decision.
    }

    @Test
    fun `plaintext http is refused even on a plausible internal host`() {
        // The tempting exception: "it is on our own network". Hospital and warehouse
        // wifi is exactly where the attacker sits.
        refusedReason("http://10.20.30.40")
        refusedReason("http://signalgrid.internal")
        refusedReason("http://192.168.1.50:3000")
    }

    @Test
    fun `plaintext loopback IS allowed, because there is no path to sit on`() {
        assertEquals("http://localhost:3000", usable("http://localhost:3000"))
        assertEquals("http://127.0.0.1:3000", usable("http://127.0.0.1:3000"))
        assertEquals("http://[::1]:3000", usable("http://[::1]:3000"))
    }

    @Test
    fun `the emulator alias is NOT loopback by default, matching the Rust client`() {
        // 10.0.2.2 aliases the host only inside an emulator. On a physical device it
        // is a routable address, and accepting plaintext to it unconditionally — as
        // this validator once did — was the on-path rewrite the rule exists to refuse.
        val reason = refusedReason("http://10.0.2.2:3000")
        assertTrue(reason.contains("plaintext"), reason)
        assertTrue(GateEndpoint(GateEndpoint.STRICT_LOOPBACK).validate("http://10.0.2.2:3000") is GateEndpoint.Result.Refused)
    }

    @Test
    fun `the emulator set accepts the alias, and ONLY the alias, beyond strict`() {
        // The widened set exists so an emulator demo does not need the check turned
        // off. It must add exactly one host and nothing else.
        val emulator = GateEndpoint(GateEndpoint.EMULATOR_LOOPBACK)
        assertEquals("http://10.0.2.2:3000", (emulator.validate("http://10.0.2.2:3000") as GateEndpoint.Result.Usable).baseUrl)
        assertEquals(setOf("10.0.2.2"), GateEndpoint.EMULATOR_LOOPBACK - GateEndpoint.STRICT_LOOPBACK)
        assertTrue(emulator.validate("http://10.0.2.3:3000") is GateEndpoint.Result.Refused)
        assertTrue(emulator.validate("http://gate.example.com") is GateEndpoint.Result.Refused)
        assertTrue(emulator.validate("http://10.0.2.2.attacker.com") is GateEndpoint.Result.Refused)
    }

    @Test
    fun `a host that merely CONTAINS localhost is not loopback`() {
        // The classic bypass: `localhost.attacker.com` resolves wherever the attacker
        // wants. Matching must be exact, not substring.
        refusedReason("http://localhost.attacker.com")
        refusedReason("http://notlocalhost")
        refusedReason("http://127.0.0.1.attacker.com")
    }

    @Test
    fun `credentials in the authority are refused, not stripped`() {
        // Stripping would silently change which identity the request carries, and the
        // password would already be in whatever logged the config.
        val reason = refusedReason("https://user:pass@gate.example.com")
        assertTrue(reason.contains("credentials"), reason)
    }

    @Test
    fun `a userinfo trick cannot smuggle a loopback host past the check`() {
        // "https://localhost@evil.example.com" has authority localhost@evil...,
        // whose real host is evil.example.com. Refused on the credentials rule before
        // host parsing can be fooled.
        refusedReason("http://localhost@evil.example.com")
    }

    @Test
    fun `non http schemes are refused`() {
        refusedReason("ftp://gate.example.com")
        refusedReason("file:///etc/passwd")
        refusedReason("javascript:alert(1)")
        refusedReason("wss://gate.example.com")
    }

    @Test
    fun `empty, blank and malformed input is refused rather than defaulted`() {
        refusedReason(null)
        refusedReason("")
        refusedReason("   ")
        refusedReason("gate.example.com") // no scheme — must not be assumed https
        refusedReason("https://")
        refusedReason("https:///path-with-no-host")
    }

    @Test
    fun `nothing that is not https or loopback is ever usable`() {
        // The invariant, asserted over the whole spread rather than left implied.
        val mustRefuse = listOf(
            null, "", "  ", "gate.example.com", "http://gate.example.com",
            "http://10.20.30.40", "http://10.0.2.2:3000", "http://localhost.attacker.com", "ftp://x.example.com",
            "file:///etc/passwd", "https://", "https://user:pass@gate.example.com",
        )
        for (raw in mustRefuse) {
            assertTrue(
                GateEndpoint.validate(raw) is GateEndpoint.Result.Refused,
                "must refuse: ${raw?.take(40)}",
            )
        }
    }
}
