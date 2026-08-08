// WHERE PLUGINS AND DEPENDENCIES COME FROM.
//
// This block is not boilerplate, and its absence is what failed this build's first
// CI run:
//
//   Plugin [id: 'com.android.application', version: '8.7.3'] was not found
//     Searched in the following repositories:
//       Gradle Central Plugin Repository
//
// The Android Gradle Plugin is NOT published to the Gradle Plugin Portal — it lives
// on Google's Maven repository, as do all the androidx artifacts. Declaring a plugin
// without declaring where it comes from is the same defect this repository keeps
// removing in another costume: a dependency asserted rather than resolved.
pluginManagement {
    repositories {
        // Narrowed by group so an unrelated artifact cannot be silently sourced from
        // Google's mirror. A repository list is a supply-chain decision; leaving it
        // open means the first repo that answers wins, which is not a property anyone
        // chose on purpose.
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    // A module that declares its own repositories is a module that can be pointed
    // somewhere else without this file changing. Fail instead.
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
    }
}

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
