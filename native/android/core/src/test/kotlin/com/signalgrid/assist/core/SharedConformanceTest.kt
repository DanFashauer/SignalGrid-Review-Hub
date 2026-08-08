package com.signalgrid.assist.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * The shared Assist-wire conformance vectors, run against this client.
 *
 * WHY THIS EXISTS ALONGSIDE [AssistWireTest]. There are now three independent
 * implementations of the same fail-closed rule — TypeScript in `lib/`, this Kotlin
 * one, and Rust in `native/desktop/core`. Each has its own hand-written unit tests,
 * and that is exactly the arrangement in which they diverge silently: every suite
 * stays green while one client starts treating `{"assist":true}` as something other
 * than a denial, because nobody wrote that case in that language.
 *
 * `native/shared/assist-wire-conformance.json` is one set of cases every client must
 * agree on. Adding a case there obliges every client at once — which is the point. A
 * shared expectation nobody is forced to satisfy is a document, not a gate.
 *
 * THE NON-VACUITY FLOOR. A suite made only of denials is satisfied by a client that
 * returns DENY unconditionally and decides nothing at all. So this asserts the file
 * contains every outcome including a proceedable one, and asserts afterwards that a
 * proceedable case actually proceeded.
 */
class SharedConformanceTest {

    private val json = Json { ignoreUnknownKeys = true }

    /**
     * Test working directory is the Gradle project dir (`native/android/core`), so the
     * shared file is two levels up. Resolved through an absolute path so a failure
     * reports WHERE it looked rather than just "not found".
     */
    private val vectorFile = File("../../shared/assist-wire-conformance.json").absoluteFile

    private fun load(): JsonObject {
        if (!vectorFile.exists()) {
            // Not a skip. A missing vector file means this client ran against nothing,
            // and "no cases ran" must never be mistaken for "all cases passed".
            fail("shared conformance vectors not found at $vectorFile")
        }
        return json.parseToJsonElement(vectorFile.readText()).jsonObject
    }

    private fun expectedAssist(name: String): Assist = when (name) {
        "allow" -> Assist.ALLOW
        "step_up" -> Assist.STEP_UP
        "restrict" -> Assist.RESTRICT
        "deny" -> Assist.DENY
        else -> fail("vector file names an outcome this client does not have: $name")
    }

    @Test
    fun `the vector file is not vacuous`() {
        val doc = load()
        val cases = doc["cases"]!!.jsonArray
        val requires = doc["requires"]!!.jsonObject

        val min = requires["minCases"]!!.jsonPrimitive.int
        assertTrue(
            cases.size >= min,
            "the vector file has ${cases.size} cases but declares a floor of $min; " +
                "a suite that shrinks below its own floor is a suite that stopped proving things",
        )

        val present = cases.map { it.jsonObject["expect"]!!.jsonPrimitive.content }
        for (outcome in requires["outcomesPresent"]!!.jsonArray) {
            val name = outcome.jsonPrimitive.content
            assertTrue(
                present.contains(name),
                "no case expects \"$name\". Without one, a client that answers the same " +
                    "way to everything would pass this file.",
            )
        }
        // The one that actually kills the trivial client.
        assertTrue(
            present.contains("allow"),
            "no case is expected to ALLOW, so a client hardcoded to DENY would pass",
        )

        val ids = cases.map { it.jsonObject["id"]!!.jsonPrimitive.content }
        assertEquals(ids.size, ids.toSet().size, "duplicate case ids in the vector file")
    }

    @Test
    fun `every shared case agrees with this client`() {
        val cases = load()["cases"]!!.jsonArray
        val failures = mutableListOf<String>()
        var allowed = 0

        for (element in cases) {
            val case = element.jsonObject
            val id = case["id"]!!.jsonPrimitive.content
            val why = case["why"]?.jsonPrimitive?.content ?: ""
            val status = case["status"]!!.jsonPrimitive.int
            // `body` is a JSON string or JSON null; the latter means "no body was read".
            val bodyElement = case["body"]!!.jsonPrimitive
            val body = if (bodyElement.isString) bodyElement.content else null
            val expect = expectedAssist(case["expect"]!!.jsonPrimitive.content)

            val decision = AssistWire.parse(status, body)
            if (decision.assist != expect) {
                failures += "  $id: expected $expect, got ${decision.assist} — $why"
                continue
            }

            // Assert the CONSEQUENCE, not just the label. An "allow" that does not
            // proceed would satisfy the outcome check while blocking every worker.
            //
            // COLLECTED, NOT ASSERTED IN PLACE. The first version threw here, which
            // aborted the loop at the first disagreement and hid every later one —
            // the run reported ONE divergence when there were two. A report that
            // stops at the first finding makes the rest invisible, which is the same
            // defect shape this repo keeps removing from everything else.
            val proceeds = decision.assist.proceedsWithoutFurtherAction
            if (expect == Assist.ALLOW) {
                allowed += 1
                if (!proceeds) failures += "  $id: an allow must proceed without further action"
            } else if (proceeds) {
                failures += "  $id: $expect must NOT proceed without further action"
            }

            case["expectExplanationContains"]?.jsonArray?.forEach { fragment ->
                val text = fragment.jsonPrimitive.content
                if (!decision.explanation().contains(text)) {
                    failures += "  $id: explanation \"${decision.explanation()}\" does not mention \"$text\""
                }
            }
        }

        assertTrue(
            failures.isEmpty(),
            "${failures.size} shared conformance case(s) disagree with this client:\n" +
                failures.joinToString("\n"),
        )
        assertTrue(allowed > 0, "no case reached ALLOW — this run proved only that things fail")
    }
}
