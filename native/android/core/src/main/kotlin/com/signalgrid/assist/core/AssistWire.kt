package com.signalgrid.assist.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
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

        // A repeated top-level key is ambiguous JSON, and kotlinx keeps the LAST copy:
        // {"assist":"deny","assist":"allow"} read as allow. Nothing is read from such a
        // body. The scan cannot fail on text the parser just accepted; if it somehow
        // does, that is a body this client does not understand, which is DENY.
        val repeated = runCatching { repeatedTopLevelKey(body) }.getOrElse { "(unscannable)" }
        if (repeated != null) {
            return AssistDecision(
                assist = Assist.DENY,
                reasons = listOf("the Assist gate's response carried a duplicate \"$repeated\" key"),
            )
        }

        val decisionId = stringOrNull(root, "decisionId")
        fun refuse(reason: String) = AssistDecision(assist = Assist.DENY, reasons = listOf(reason), decisionId = decisionId)

        // `assist` must be a JSON STRING. A number, boolean, null, object or list is
        // present-and-unreadable, which is DENY; only a genuinely absent (or blank) value
        // reports as missing. Reading `.content` without `isString` would let an
        // unquoted token the lexer kept as a primitive stand in for the word allow.
        val assistEl = root["assist"]
        val parsed: Assist = when {
            assistEl == null -> null
            assistEl is JsonPrimitive && assistEl.isString -> Assist.parse(assistEl.content)
            else -> Assist.DENY
        } ?: return refuse("the Assist gate's response carried no \"assist\" field")

        // `obligations` is OPTIONAL-ABSENT, and absent is the served case: the
        // /api/v1/authorize contract (lib/api-spec/v1-openapi.yaml, AssistResult)
        // declares `assist`, `decisionId` and `reasons` only. Absent means no
        // obligation is known to be satisfied — an empty list is never permission;
        // only ALLOW proceeds, whatever this list holds.
        //
        // PRESENT-BUT-WRONG-TYPE IS MALFORMED, and malformed is DENY — for `obligations`
        // and `reasons` alike, and for a non-string ENTRY as much as for a non-list.
        // Coercing either to empty (as this once did) let a decision stand on a body
        // this client did not understand, with an obligation silently dropped.
        val obligations = stringList(root, "obligations")
            ?: return refuse("the Assist gate's response carried an \"obligations\" field that is not a list of strings")
        val reasons = stringList(root, "reasons")
            ?: return refuse("the Assist gate's response carried a \"reasons\" field that is not a list of strings")

        // REQUIRED on every outcome (AssistResult `required: [assist, decisionId]`).
        // Every real decision is persisted and audited under its id, and a step_up is
        // answered through it; a body without one is not a decision anybody recorded.
        if (decisionId == null) {
            return AssistDecision(
                assist = Assist.DENY,
                reasons = listOf("the Assist gate's response carried no usable \"decisionId\" (the contract requires a non-blank string)"),
            )
        }

        return AssistDecision(assist = parsed, reasons = reasons, obligations = obligations, decisionId = decisionId)
    }

    /** A non-blank JSON STRING. JSON null (once read as the text "null"), numbers, booleans, objects and lists are not ids. */
    private fun stringOrNull(root: JsonObject, key: String): String? =
        (root[key] as? JsonPrimitive)?.takeIf { it.isString }?.content?.takeIf { it.isNotBlank() }

    /**
     * Read an optional list of strings.
     *
     * Absent is an EMPTY list, not an error — `reasons` is genuinely optional on an
     * allow. Present must be a list whose every entry is a JSON string; anything else
     * is null, which the caller turns into DENY. Blank strings are well-typed and are
     * dropped from display rather than shown as an empty explanation.
     */
    private fun stringList(root: JsonObject, key: String): List<String>? {
        val el = root[key] ?: return emptyList()
        val arr = el as? JsonArray ?: return null
        return arr.map { item -> (item as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null }
            .filter { it.isNotBlank() }
    }

    /**
     * The first top-level key that appears twice, or null. Only ever run on a body
     * [json] has already accepted as an object, so the text is well-formed; each key is
     * decoded by the same parser before comparing, so "\u0061ssist" is caught as a
     * second "assist". Keys below the top level are out of scope: nothing there is read
     * as part of the decision. Mirrors the reference scan the Swift client uses.
     */
    private fun repeatedTopLevelKey(body: String): String? {
        val seen = HashSet<String>()
        var depth = 0
        var i = 0
        while (i < body.length) {
            when (body[i]) {
                '{', '[' -> depth++
                '}', ']' -> depth--
                '"' -> {
                    val start = i
                    i++
                    while (body[i] != '"') {
                        if (body[i] == '\\') i++
                        i++
                    }
                    if (depth == 1) {
                        var j = i + 1
                        while (body[j] == ' ' || body[j] == '\t' || body[j] == '\n' || body[j] == '\r') j++
                        if (body[j] == ':') {
                            val key = json.parseToJsonElement(body.substring(start, i + 1)).jsonPrimitive.content
                            if (!seen.add(key)) return key
                        }
                    }
                }
            }
            i++
        }
        return null
    }
}
