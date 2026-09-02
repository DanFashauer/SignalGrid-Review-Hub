package com.signalgrid.assist.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Turning an HTTP result from `/v1` into something the host app may act on.
 *
 * THIS IS WHERE A TRUST CLIENT USUALLY GOES WRONG, which is the whole reason it
 * lives in the module with no Android dependency: an emulator-only file is a file no
 * gate reaches. Every path below has a test.
 *
 * The failure that matters is not a crash — a crash is loud and gets fixed. It is a
 * client that receives something it does not understand and carries on as though the
 * answer were yes: a 500, a truncated body, an HTML error page from a proxy, a field
 * renamed by a newer server. Each of those is indistinguishable from "allow" to code
 * that only checks whether parsing threw.
 *
 * So the rule here is the repository's rule, applied at the edge: an unknown never
 * lowers assurance. Anything not positively understood as a decision becomes DENY,
 * and carries a reason saying which of the failures it was.
 */
object AssistWire {

    private val json = Json {
        ignoreUnknownKeys = true // a newer server adding fields must not break an older client
        isLenient = false // ...but malformed JSON is a defect, not something to guess through
    }

    /**
     * @param status the HTTP status actually received
     * @param body   the raw response body, exactly as read
     */
    fun parse(status: Int, body: String?): AssistDecision {
        // ── Transport-level outcomes ─────────────────────────────────────────
        // A gate that cannot be reached is not a gate that said yes. 5xx, 401/403 on
        // the gate itself, a timeout surfaced as status 0 — all deny, all named.
        if (status !in 200..299) {
            return AssistDecision(
                assist = Assist.DENY,
                reasons = listOf("the Assist gate returned HTTP $status; no decision was made"),
            )
        }
        if (body.isNullOrBlank()) {
            return AssistDecision(
                assist = Assist.DENY,
                reasons = listOf("the Assist gate returned HTTP $status with an empty body"),
            )
        }

        // ── Body-level outcomes ──────────────────────────────────────────────
        val root: JsonObject = try {
            json.parseToJsonElement(body).jsonObject
        } catch (e: Exception) {
            // Includes the classic case: a proxy or captive portal answering 200 with
            // an HTML login page. It parses as neither JSON nor permission.
            return AssistDecision(
                assist = Assist.DENY,
                reasons = listOf("the Assist gate's response was not a JSON object (${e.javaClass.simpleName})"),
            )
        }

        val rawAssist = root["assist"]?.let {
            runCatching { it.jsonPrimitive.content }.getOrNull()
        }

        val parsed = Assist.parse(rawAssist)
        if (parsed == null) {
            // Present-and-unreadable is already DENY inside Assist.parse. Reaching
            // here means the field was absent entirely — a shape mismatch, reported
            // as one rather than silently defaulted.
            return AssistDecision(
                assist = Assist.DENY,
                reasons = listOf("the Assist gate's response carried no \"assist\" field"),
                decisionId = stringOrNull(root, "decisionId"),
            )
        }

        // `obligations` is OPTIONAL-ABSENT, and absent is the served case: the
        // /api/v1/authorize contract (lib/api-spec/v1-openapi.yaml, AssistResult)
        // declares `assist`, `decisionId` and `reasons` only. Absent means no
        // obligation is known to be satisfied — an empty list is never permission;
        // only ALLOW proceeds, whatever this list holds.
        //
        // PRESENT-BUT-NOT-A-LIST IS MALFORMED, and malformed is DENY — the same rule
        // `assist` gets above. Coercing it to empty (as this once did) let a step_up
        // stand with its obligations silently dropped, an asymmetry the shared
        // vectors now pin closed.
        val obligationsEl = root["obligations"]
        if (obligationsEl != null && obligationsEl !is JsonArray) {
            return AssistDecision(
                assist = Assist.DENY,
                reasons = listOf("the Assist gate's response carried an \"obligations\" field that is not a list"),
                decisionId = stringOrNull(root, "decisionId"),
            )
        }

        return AssistDecision(
            assist = parsed,
            reasons = stringList(root, "reasons"),
            obligations = stringList(root, "obligations"),
            decisionId = stringOrNull(root, "decisionId"),
        )
    }

    private fun stringOrNull(root: JsonObject, key: String): String? =
        root[key]?.let { runCatching { it.jsonPrimitive.content }.getOrNull() }?.takeIf { it.isNotBlank() }

    /**
     * Read a list of strings, tolerating the shapes a real server actually emits.
     *
     * A missing list is an EMPTY list, not an error — `reasons` is genuinely optional
     * on an allow. But a list whose entries are not strings is dropped rather than
     * stringified: rendering `{"code":42}` to a worker as "{code=42}" is worse than
     * showing nothing, because it looks like an explanation and is not one.
     */
    private fun stringList(root: JsonObject, key: String): List<String> {
        val el = root[key] ?: return emptyList()
        val arr = runCatching { el.jsonArray }.getOrNull() ?: return emptyList()
        return arr.mapNotNull { item ->
            runCatching { item.jsonPrimitive }.getOrNull()
                ?.takeIf { it.isString }
                ?.content
                ?.takeIf { it.isNotBlank() }
        }
    }
}
