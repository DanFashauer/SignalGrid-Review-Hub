# Native — Swift, Kotlin, Rust: the fail-closed shape in three languages

The four outcomes are the product's whole vocabulary (`AssistOutcome.kt`, `assist.rs`:
"there is no fifth"; the TS core's literal union). Every native client parses an untrusted
wire and must DENY, with a reason, on anything it cannot read — and must never let a
compiler-provided default hide a new case. The two byte-faithful files
(`native/ios/EnterpriseShell/Services/DecisionEngine.swift`, `AppWorkflows.swift`) are never
edited for behaviour. Verified 2026-09-04.

## Swift (EnterpriseShell, SignalGridMobile)

1. **SAYS** `var stopNum = Int.random(in: 1...10)`; `Date()` inside logic.
   **BREAKS** golden rule 2 — deterministic. `RemediationAllow.swift` takes time as a
   parameter for exactly this reason.
   **DO** keep `Int.random`, `.random(`, `arc4random` and `Date()` out of `SignalContext`,
   `RemediationAllow`, `DecisionService` and `ExpiryPolicy` logic. Time is a parameter the
   test can pin.
2. **SAYS** `Calendar.current.dateComponents(…).year!` — force-unwrap the result.
   **BREAKS** fail-closed: an unknown value TIGHTENS the verdict; it does not crash the kiosk
   shell. `.swiftlint.yml`'s custom `force_unwrap` rule warns.
   **DO** `guard let y = … else { return <the restrictive value> }`. In anything feeding the
   Assist gate (`stale`, `lockedOut`, zone match) nil reads as the restrictive branch — the
   `SessionData.isExpired` pattern, where a blank justification reads EXPIRED.
3. **SAYS** `print("Hello \(name)")` — every example logs with `print(`.
   **BREAKS** `.swiftlint.yml` custom rule `print_statement`: "Use AuditLogger instead of
   print()" (advisory; `strict: false`).
   **DO** log through `native/ios/EnterpriseShell/Services/AuditLogger.swift`. Two call sites
   remain today; do not add a third.
4. **SAYS** `// TODO: update logic…`, `// FIXME: fix buggy behavior…`.
   **BREAKS** `.swiftlint.yml` custom rule `todo_without_severity` — regex
   `(TODO|FIXME):(?!\s+(HIGH|MEDIUM|LOW))`.
   **DO** `// TODO: HIGH …`. Better: record it in `docs/BUILD_BACKLOG.md` or lane mail, where
   the loop ritual reads.
5. **SAYS** `switch color { case "orange": … default: print("not a secondary color") }` —
   `default:` as the catch-all in every switch.
   **BREAKS** exhaustive switching over a verdict/state enum with NO `default:` is the
   compile-time guarantee that a new case is handled everywhere.
   **DO** omit `default:` over the repo's own enums. When a raw String must be classified,
   the fall-through maps to the STRICTEST outcome (the `RemediationAllow` pattern).
6. **SAYS** `for (emoji, meaning) in dict { … }`; `print(setC) // ["D", "C"]` — emit whatever
   order you get.
   **BREAKS** Swift seeds hashing per PROCESS: Set/Dictionary iteration order differs on
   every launch, and provenance is the product.
   **DO** sort before joining or encoding — `value.keys.sorted()` as `JSONValue.displayText`
   does (`Models.swift`); `JSONEncoder().outputFormatting = [.sortedKeys]` for payloads.
7. Mac-lane findings from the SwiftUI view-layer rebuild (Phases 1–3, #394/#402/#412):
   `Color.sg*` tokens and `SGType.*` fonts ONLY — `.font(.system(size:))` fails
   `scripts/check-ios-dynamic-type.mjs`; SwiftUI is hosted INSIDE the UIKit lifecycle through
   one `hostingController()` seam per screen (`SessionWindow`, `ScreenCaptureGuard` and the
   ASAM re-assert stay UIKit); `.sgKioskTypeCap()` is the OUTERMOST modifier; verify at
   `xcrun simctl ui booted content_size accessibility-extra-large`; and the retirement trap —
   a UIKit file you delete may define a helper the design system uses (`UIColor(hex:)` did) —
   so relocate it in the SAME build you delete the file. The sheet has no Codable /
   `decodeIfPresent`, `@Published`/`@StateObject` or `ObservableObject` section; the repo's
   own views are the reference for those.

## Kotlin (`native/android/core`) and Rust (`native/desktop/core`, `native/desktop/app`, `firmware/dock/core`)

8. **SAYS** `$ rustc Hello_World.rs && ./Hello_World`.
   **BREAKS** every Rust lane is cargo-driven and the three crates are deliberately NOT a
   workspace (the comment in `native/desktop/app/Cargo.toml`).
   **DO** `cargo test --manifest-path native/desktop/core/Cargo.toml` (likewise
   `firmware/dock/core`, `native/desktop/app`), and CI's triple: `cargo fmt --check`,
   `cargo clippy --all-targets -- -D warnings`, `cargo test`. `cargo test -- --nocapture`
   surfaces the `eprintln!` summary `44 shared conformance cases pass (5 of them proceedable)`.
9. **SAYS** sheet snippets: `let mut a: u32 = 8;` (never mutated), `print!(…)`, `return x;` as
   the last statement, `S_string`, parentheses around a cast.
   **BREAKS** `desktop.yml` / `firmware.yml` run clippy with `-D warnings`; pasting these into a
   crate fails the build.
   **DO** `let` unless actually mutated; `println!`/`eprintln!`; a trailing expression;
   snake_case; `std::f64::consts::PI`; `arr[i] *= arr[2]`; run clippy before pushing.
10. **SAYS** `let n: i64 = original as i64` — "to cast in Rust one must use `as`".
    **BREAKS** `as` between integer widths WRAPS silently (`65736u64 as u16` is 200) — an
    out-of-range signal must tighten, never loosen.
    **DO** `u16::try_from(n)` / `.and_then(|n| u16::try_from(n).ok())` and DENY with a reason
    on failure, as `wire.rs` does for every other unreadable value. `as` only on values
    already proven in range.
11. **SAYS** `match day { 1 => …, 7 => …, _ => println!("Default!") }`; Kotlin `when (grade) {
    … else -> … }`.
    **BREAKS** a `_`/`else` arm over the repo's own enum means a fifth outcome compiles.
    **DO** wildcard ONLY at the parse boundary on untrusted strings, and only as `_ =>
    Assist::Deny` / `else -> DENY`. Over own enums: exhaustive, no default arm; let the
    compiler find every site when a case is added.
12. **SAYS** Elvis default `val l = b?.length ?: -1`.
    **BREAKS** defaulting an unreadable security-relevant field is the exact fail-open the
    shared vectors caught.
    **DO** distinguish ABSENT from PRESENT-BUT-UNREADABLE: absent `assist` → DENY "carried no
    assist field"; wrong type → DENY naming the field. Elvis-to-empty only for genuinely
    optional display fields. Both clients preserve this asymmetry (`Assist.parse` returns
    null only for a genuinely absent value).
13. **SAYS** `val l = b!!.length` — "throws NPE if b is null".
    **BREAKS** in `native/android/core/src/main` a thrown exception is not a decision: a
    crash is loud and gets fixed; a client that receives something it does not understand
    must DENY.
    **DO** `?.let { runCatching { … }.getOrNull() }` and return `AssistDecision(assist =
    Assist.DENY, reasons = listOf("…which failure"))`; keep `!!` confined to tests.

## Forms that survived — keep these

- Fail-closed parse skeleton, both twins: Rust `if !(200..=299).contains(&status) { return
  DENY }` (`wire.rs`); Kotlin `if (status !in 200..299) return DENY` (`AssistWire.kt`,
  `GateEndpoint.kt`).
- Cross-client test loops COLLECT failures and assert once at the end (`conformance.rs`,
  `SharedConformanceTest.kt`) so one bad vector does not hide the rest.
- Adding a shared conformance case: edit `native/shared/assist-wire-conformance.json` with
  the allowed keys only (`id`, `why`, `status`, `body`, `expect`, …) — both loaders reject
  unknown keys.
- All three `Cargo.toml` carry `[lints.rust] unsafe_code = "forbid"`; the firmware crate has
  ZERO dependencies by design and pins `rust-version`. Its "claim that matters" is not
  reproducible on this Mac: Homebrew `rust` has no `rustup` and no target sysroot.
- Kotlin lane on the Mac, verified: `JAVA_HOME=/opt/homebrew/opt/openjdk@17 gradle -p
  native/android/core test --rerun --console=plain`, sandbox OFF (Gradle's native library
  will not load inside it). State the skew in every report: Mac Gradle 9.7.1 + JVM 17.0.x
  (Homebrew keg) versus the versions `.github/workflows/android.yml` pins.
- Build output from every toolchain is gitignored and leaves the tree clean:
  `native/desktop/.gitignore` (`target/`), `firmware/.gitignore`, `native/android/**/build/`,
  `native/ios/build/`. A new toolchain's output must be added BEFORE its first run, or every
  later sim result is stamped dirty.
