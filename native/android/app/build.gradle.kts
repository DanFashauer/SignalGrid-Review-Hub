// The Android shell. Deliberately thin.
//
// Everything that decides what a worker is told lives in `:assist-core`, a plain
// Kotlin build whose tests run without an Android SDK (no count here: the last one
// went stale within weeks, and `scripts/check-android-core-tests.mjs` derives the
// real figure from the source on every run). This module owns
// only what genuinely needs Android: an Activity, a screen, and the HTTP call. If a
// behavioural rule ever appears in THIS module, it has escaped its test coverage —
// that is the review question to ask of any change here.
plugins {
    id("com.android.application") version "8.7.3"
    kotlin("android") version "2.1.0"
    id("org.jetbrains.kotlin.plugin.compose") version "2.1.0"
}

android {
    namespace = "com.signalgrid.assist"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.signalgrid.assist"
        // 26 covers the rugged Android fleet this product targets (Zebra TC-series,
        // Honeywell CT-series). Going higher would exclude devices still in service.
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            // No signing config here ON PURPOSE. A keystore committed to a PUBLIC
            // repository can never be un-published, and `.gitignore` already refuses
            // *.jks/*.keystore. Release signing belongs in the release pipeline.
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        // BuildConfig.DEBUG gates the emulator-loopback widening in DeviceGate; AGP 8
        // stopped generating BuildConfig by default, so it is asked for by name.
        buildConfig = true
    }

    // JVM unit tests for the one Android-side security decision (DeviceGate). They
    // are pure Kotlin, but they live in THIS module because the function reads
    // Build.PRODUCT and BuildConfig.DEBUG at its call site, and a test in `:assist-core`
    // cannot see either. `gradle -p native/android/app test` runs them; CI does.
    testOptions.unitTests.all { it.useJUnitPlatform() }
}

kotlin {
    compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) }
}

dependencies {
    implementation("com.signalgrid:signalgrid-assist-core")

    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")

    testImplementation(kotlin("test"))
}
