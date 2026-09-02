package com.signalgrid.assist

import com.signalgrid.assist.core.GateEndpoint
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * The only test of the only Android-side security decision. Before it existed,
 * replacing `isEmulator`'s body with `return true` left every gate green: the core
 * suite cannot see this module, and the app CI job only assembled. Pure JVM — no
 * Android runtime is needed because `isEmulator` takes its two inputs as parameters.
 */
class DeviceGateTest {

    @Test
    fun `the emulator images Google ships are recognised, in a debug build`() {
        assertTrue(DeviceGate.isEmulator("sdk_gphone64_arm64", debug = true))
        assertTrue(DeviceGate.isEmulator("sdk_google_phone_x86", debug = true))
        assertTrue(DeviceGate.isEmulator("google_sdk", debug = true))
        assertTrue(DeviceGate.isEmulator("emulator64_x86_64", debug = true))
    }

    @Test
    fun `a physical device is never an emulator`() {
        assertFalse(DeviceGate.isEmulator("SM-G991B", debug = true))
        assertFalse(DeviceGate.isEmulator("TC52", debug = true))
        assertFalse(DeviceGate.isEmulator("", debug = true))
        assertFalse(DeviceGate.isEmulator(null, debug = true))
    }

    @Test
    fun `a RELEASE build never widens the set, whatever the product string says`() {
        // The bound on the heuristic: a spoofed Build.PRODUCT on a shipped APK changes
        // nothing. If this ever flips, the spoof becomes a plaintext exception on a
        // real device.
        for (product in listOf("sdk_gphone64_arm64", "google_sdk", "emulator64_x86_64", "sdkfoo")) {
            assertFalse(DeviceGate.isEmulator(product, debug = false), product)
        }
    }

    @Test
    fun `the rule is a PREFIX match, pinned so it cannot quietly become something else`() {
        // "sdkfoo" is not an image Google ships, and it IS recognised: the rule is
        // "starts with", chosen because the real suffixes vary per image and API level.
        // Pinned here so a later "tightening" to exact names (which would silently drop
        // sdk_gphone64_arm64 on the next image rename) has to change this test.
        assertTrue(DeviceGate.isEmulator("sdkfoo", debug = true))
        assertFalse(DeviceGate.isEmulator("foosdk", debug = true))
        assertFalse(DeviceGate.isEmulator(" sdk_gphone64_arm64", debug = true))
    }

    @Test
    fun `the widened set adds the emulator alias and nothing else`() {
        assertEquals(setOf("10.0.2.2"), GateEndpoint.EMULATOR_LOOPBACK - GateEndpoint.STRICT_LOOPBACK)
    }
}
