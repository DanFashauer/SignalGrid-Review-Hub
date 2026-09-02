package com.signalgrid.assist

import android.os.Build
import com.signalgrid.assist.core.GateEndpoint

/**
 * The one place the Android shell decides which loopback set the gate validator
 * uses — and therefore the one place `http://10.0.2.2` can ever be accepted.
 *
 * WHY THIS IS IN THE APP MODULE AND NOT IN `:assist-core`. `10.0.2.2` is loopback
 * only INSIDE an Android emulator: it is the emulator's alias for the host machine.
 * On a physical device it is a routable address on somebody's network, and plaintext
 * to it is exactly the on-path rewrite GateEndpoint exists to refuse. The core
 * module cannot know which of the two it is running on (it has no Android
 * dependency, by design), so it defaults to the strict set and lets the caller widen
 * it. This file is that caller, and it widens the set only when BOTH hold:
 *
 *   1. the build is a DEBUG build (`BuildConfig.DEBUG`). A release APK never widens
 *      the set whatever the product string says — a spoofed `Build.PRODUCT` on a
 *      device running the shipped artefact changes nothing;
 *   2. `Build.PRODUCT` starts with `sdk`, `google_sdk` or `emulator`, which is what
 *      the emulator images Google ships report (`sdk_gphone64_arm64`,
 *      `sdk_google_phone_x86`, `emulator64_x86_64`). Prefix match, deliberately: the
 *      suffixes vary per image and API level. A product string like `sdkfoo` is
 *      therefore treated as an emulator — pinned by test so the rule is the rule.
 *
 * Both are still heuristics, stated as such: there is no API that answers "am I an
 * emulator". The exposure is bounded — a spoof can only make a DEBUG build on a real
 * device accept plaintext to that ONE address, a weaker posture the device's owner
 * chose — and without it every emulator demo would need the check turned off.
 *
 * `isEmulator` is a PURE function of its two inputs so it can be unit-tested on the
 * JVM (`src/test/kotlin`, run by `gradle -p native/android/app test` in CI); the
 * Android reads happen at the single call site in [endpoint].
 *
 * Documented in native/android/README.md under "Emulator loopback".
 */
object DeviceGate {

    /** Prefixes of `Build.PRODUCT` on the emulator images Google ships. */
    val EMULATOR_PRODUCT_PREFIXES: List<String> = listOf("sdk", "google_sdk", "emulator")

    /**
     * Pure: may this build widen the loopback set to the emulator alias?
     *
     * @param product `Build.PRODUCT` (nullable: a missing value is a device, never an emulator)
     * @param debug `BuildConfig.DEBUG` — false in a release APK, and then nothing widens
     */
    fun isEmulator(product: String?, debug: Boolean): Boolean {
        if (!debug) return false
        val p = product ?: return false
        return EMULATOR_PRODUCT_PREFIXES.any { p.startsWith(it) }
    }

    /** The validator this device should use: emulator set on a debug-build emulator, strict otherwise. */
    fun endpoint(): GateEndpoint =
        if (isEmulator(Build.PRODUCT, BuildConfig.DEBUG)) GateEndpoint(GateEndpoint.EMULATOR_LOOPBACK) else GateEndpoint()
}
