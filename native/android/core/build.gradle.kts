// The Assist outcome, as plain Kotlin with NO Android dependency.
//
// Split out deliberately. Everything that decides what a worker sees lives here and
// is unit-tested on a bare JVM; the Android module is a thin shell that renders what
// this returns. Two reasons, both learned elsewhere in this repo:
//
//   1. It can be TESTED WITHOUT THE ANDROID SDK. `gradle -p core test` runs anywhere,
//      including the environment that maintains this repo, so the logic has a gate
//      that does not depend on an emulator or a licensed SDK download.
//   2. It cannot drift into a second decision engine. This module SHAPES a decision
//      the server already made; it never makes one. `native/ios` carries a
//      byte-faithful port of the TS engine plus a parity gate to keep it honest —
//      that is a real maintenance cost, and Android does not pay it because Android
//      does not decide anything.
plugins {
    kotlin("jvm") version "2.1.0"
    kotlin("plugin.serialization") version "2.1.0"
}

repositories { mavenCentral() }

dependencies {
    // JSON, in the module that can be tested without an emulator. The parsing of a
    // /v1 response is where a client most easily becomes permissive by accident, so
    // it belongs here rather than in the Android shell where no gate can reach it.
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    testImplementation(kotlin("test"))
}

// Target 17 bytecode WITHOUT demanding a JDK 17 installation. `jvmToolchain(17)`
// asks Gradle to find or download a specific JDK, which fails on any machine that
// has only a newer one — including the environment that maintains this repo, which
// ships JDK 21. `-release 17` produces the same artifact from any JDK >= 17, so the
// module builds on a maintainer's box, a CI runner, and a contributor's laptop
// without each of them provisioning a second JDK.
//
// 17 is the floor because that is what current Android Gradle Plugin requires of
// the modules it consumes.
kotlin {
    compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) }
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

tasks.test { useJUnitPlatform() }
