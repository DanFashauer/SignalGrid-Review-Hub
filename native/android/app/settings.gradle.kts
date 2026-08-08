rootProject.name = "signalgrid-assist-android"

// The pure-Kotlin core is a SEPARATE Gradle build, pulled in as a composite.
//
// Not a subproject, deliberately. If `core` lived inside this build, configuring it
// would require the Android plugin — and therefore the Android SDK — which would make
// `gradle -p core test` impossible on a machine without one. That is the machine that
// maintains this repository, and those 40 tests are the only thing standing between a
// refactor and a client that silently starts saying yes.
//
// As a composite, the core build stays independently buildable and testable, and this
// build substitutes the dependency automatically.
includeBuild("../core")
