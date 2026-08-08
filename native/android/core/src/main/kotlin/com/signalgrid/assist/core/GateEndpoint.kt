package com.signalgrid.assist.core

/**
 * Where the Assist gate is, and whether we are willing to talk to it.
 *
 * WHY THIS IS HERE AND NOT IN THE ANDROID MODULE. Deciding whether a URL is
 * acceptable is a security decision, and security decisions belong where a test can
 * reach them. An `OkHttpClient` built in an Activity is verifiable only by running the
 * app; this is verifiable by `gradle test`, on any machine, in seconds.
 *
 * THE RULE: a trust gate is reached over TLS or it is not reached.
 *
 * A decision arrives over the network and is then obeyed — the host app opens a
 * screen, or refuses to. Over plaintext, anyone on the path can rewrite `deny` to
 * `allow`, and nothing downstream can tell. That is not a theoretical position on a
 * shared frontline device: hospital and warehouse wifi is exactly where an attacker
 * sits on the path, and it is the same network the captive-portal case in AssistWire
 * comes from.
 *
 * The one exception is loopback, because there is no path to sit on: a developer
 * running the api-server on the same machine is not exposed by it, and refusing that
 * would push people toward disabling the check entirely — trading a narrow, reasoned
 * exception for a blanket one. Which is the trade that usually gets made badly.
 */
object GateEndpoint {

    /** Hosts where plaintext is acceptable because the traffic never leaves the device. */
    private val LOOPBACK = setOf(
        "localhost",
        "127.0.0.1",
        "::1",
        "[::1]",
        // The Android emulator's alias for the host machine's loopback. Without this,
        // every emulator-based demo would need the check turned off.
        "10.0.2.2",
    )

    sealed interface Result {
        data class Usable(val baseUrl: String) : Result
        data class Refused(val reason: String) : Result
    }

    /**
     * Normalise and vet a configured base URL.
     *
     * Returns the URL with any trailing slash removed, so callers can append paths
     * without producing `//v1/authorize` — a small thing that reliably produces a
     * confusing 404 against some servers and a silent redirect against others.
     */
    fun validate(raw: String?): Result {
        val url = raw?.trim()
        if (url.isNullOrEmpty()) {
            return Result.Refused("no gate URL is configured")
        }

        val scheme = url.substringBefore("://", missingDelimiterValue = "").lowercase()
        if (scheme.isEmpty()) {
            return Result.Refused("gate URL \"$url\" has no scheme; expected https://")
        }
        if (scheme != "https" && scheme != "http") {
            return Result.Refused("gate URL scheme \"$scheme\" is not http(s)")
        }

        val afterScheme = url.substringAfter("://")
        if (afterScheme.isEmpty()) {
            return Result.Refused("gate URL \"$url\" has no host")
        }
        // Authority ends at the first '/', '?' or '#'.
        val authority = afterScheme.takeWhile { it != '/' && it != '?' && it != '#' }
        if (authority.isEmpty()) {
            return Result.Refused("gate URL \"$url\" has no host")
        }
        // Credentials in a URL end up in logs and crash reports. Refuse rather than strip:
        // stripping would silently change which identity the request carries.
        if (authority.contains('@')) {
            return Result.Refused("gate URL must not carry credentials in the authority")
        }

        val host = hostOf(authority)
        if (host.isEmpty()) {
            return Result.Refused("gate URL \"$url\" has no host")
        }

        if (scheme == "http" && host.lowercase() !in LOOPBACK) {
            return Result.Refused(
                "refusing to reach the Assist gate over plaintext http at \"$host\" — " +
                    "a decision that can be rewritten in transit is not a decision",
            )
        }

        return Result.Usable(url.trimEnd('/'))
    }

    /** Strip a port, and the brackets around an IPv6 literal, to get the bare host. */
    private fun hostOf(authority: String): String {
        if (authority.startsWith("[")) {
            val close = authority.indexOf(']')
            return if (close > 0) authority.substring(0, close + 1) else ""
        }
        return authority.substringBefore(':')
    }
}
