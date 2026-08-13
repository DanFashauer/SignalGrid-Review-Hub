# Delivery gap analysis — every surface, measured against the tree

> ## ⚠️ SUPERSEDED IN PART — VERIFY BEFORE ACTING
>
> **Re-measured 2026-08-12 against the tree.** This document was accurate when
> written (2026-08-08, PR #188), but the repository moved the same day and has
> taken **77+ commits since**. At least one headline finding is now false:
>
> | Claim below | Status on 2026-08-12 | Evidence |
> | --- | --- | --- |
> | "Android — **ABSENT** — zero `.kt`/`.gradle`/android files" | **FALSE — Android exists** | `native/android/` : Kotlin `MainActivity.kt`, `core` module (`AssistOutcome`, `AssistWire`, `GateEndpoint`), 4 test classes incl. `SharedConformanceTest`, CI `.github/workflows/android.yml` runs `gradle test` + `assembleDebug`. Landed 2026-08-08 in PR #196 — hours after this document. |
> | "one genuinely native platform (iOS)" | **FALSE — three** | iOS (68 Swift files), Android (Kotlin), and Rust dock firmware (`firmware/dock/core`: `custody.rs`, `state.rs`, `wire.rs`). |
>
> | "no Electron, Tauri, `.csproj`, `.sln` files" | **FALSE — a Tauri desktop app exists** | `native/desktop/app/tauri.conf.json` and supporting files. |
>
> **Confirmed still true:** the `artifacts/signalgrid-desktop` *package* is a Vite
> web app despite its name (the real desktop shell lives at `native/desktop/`);
> `signalgrid-mobile-pwa` is a PWA, not native; no FedRAMP/air-gap artifacts exist.
>
> **Verified green 2026-08-12** (executed, not read): `pnpm install
> --frozen-lockfile`, `pnpm run typecheck`, `pnpm -r run build`, **122 `proof:*`
> gates pass with 0 failures**, `scripts/check-proof-counts.mjs` reports all 56
> documented counts matching, and the core proof reports
> `assertions=213, categories=17, evidenceFields=20`.
>
> **Do not treat any row in this file as current without re-running its named
> search.** Regenerate with a fresh measurement pass before using it to plan work.

What exists, what partly exists, and what does not exist at all. **Derived by reading
the repository**, not from the task list or from memory — several entries below
contradict a task marked "completed", and where they do, the tree wins.

Method: `git ls-files` counts, `package.json` dependency inspection, and file-type
searches. Anything stated as ABSENT means a search for it returned zero files, and the
search is named so you can re-run it.

## The headline tension, before the table

This repo already made a **scope decision**: the Shared-Device Trust Gateway launch
profile, with a GA route fence that 404s everything deferred. The list this document
assesses is far wider than that profile. Building all of it and keeping the launch
profile honest are in direct conflict — the profile exists precisely to stop the
surface expanding faster than the evidence.

So this is a map, not a plan. **Nothing here should be built without first deciding
whether it is inside or outside the launch line.**

~~A second, structural problem sits underneath: **the launch profile itself is mostly
not on the default branch.** Files matching the profile: **7** on
`claude/signalgrid-launch-plan-emxm01` (PR #152) versus **2** on `SignalGrid_Alpha`.
The scope decision that should govern all of this is stranded in an unmerged branch.~~

> **CORRECTED 2026-08-13 — THIS PARAGRAPH WAS THE MOST DAMAGING THING IN THIS FILE.**
> PR #152 merged to `SignalGrid_Alpha` on 2026-08-12 (merge commit `e11f2cc`,
> "SignalGrid Shared-Device Trust Gateway — the launch spine"). The launch profile
> has governed the default branch ever since, enforced in three places:
> `scripts/preflight.mjs` (the gate and its proof), `.github/workflows/review-hub-ci.yml`
> (both run on every pull request), and `package.json`. Measured today:
> `git ls-tree -r --name-only origin/SignalGrid_Alpha | grep -icE 'launch.profile'`
> returns **5**, and the same command on the launch branch returns **5** — the same
> files, not 7 versus 2.
>
> **The "7 versus 2" was never a file count.** The 7 was
> `git rev-list --left-right --count` — the branch's *commits ahead*. The 2 was
> `git diff --name-only` — the number of profile files that branch *modifies*. Two
> unrelated measurements, printed as though they were one.
>
> This is recorded at length because the sentence outlived its accuracy and kept
> working: **two separate external analyses have since opened with it as their
> headline finding** — one repeating "7 files versus 2" verbatim, the other
> restating it as "220 commits ahead" (the real figure is 8, and 0 behind). Both
> then ranked "merge the stranded launch profile" as the task blocking all others.
> Neither ran a command. A wrong number in a document that reads as measured is not
> a stale fact; it is a fact-shaped object that keeps being cited, and it costs more
> than the omission would have.

## 1. Deployment models

| Model | State | Evidence |
| ----- | ----- | -------- |
| Cloud / SaaS (recommended install) | **PARTIAL** | `docs/DEPLOYMENT_MODELS.md` documents a cloud control plane + local decision plane and its honest boundaries. `docker-compose.prod.yml` runs api + Postgres. No tenant provisioning, billing, or managed-service operations exist. |
| Self-hosted on a customer's server | **PARTIAL** | The same compose stack is the self-host story, and it is proven to run (`Prod stack` CI, `docker-verify` under both engines). What is missing is upgrade/migration paths, backup/restore procedure, and a supported-configuration statement. |
| Federal / government | **ABSENT** | No FedRAMP, StateRAMP, IL-level, FIPS, or air-gap document exists (`ls docs \| grep -iE 'gov\|fedramp\|air.?gap'` → nothing). This is not a small doc gap: it implies FIPS-validated crypto, boundary/SSP artifacts, and continuous monitoring — a compliance programme, not a feature. |

**Honest note:** per `CLAUDE.md`, Claude Code does not guarantee HIPAA/SOC 2, and a
human compliance review is required rather than optional. Federal is strictly further
than that.

## 2. Apps and platform surfaces

**The measured result contradicts the task list.** Task #18 ("Platform apps — admin +
end-user across iOS/Android/Web/macOS/Windows") is marked completed. It is not.

Every artifact below the iOS line is the **same Vite web stack** — verified by reading
each `package.json`:

| Surface | What it actually is | State |
| ------- | ------------------- | ----- |
| `signalgrid-web` — "Operational Trust Orchestration for Shared Devices" | Vite web | **BUILT** (marketing/product site) |
| `signalgrid-app` — "Operator Dashboard" | Vite web | **BUILT** — this is the admin console |
| `signalgrid-review` — "Second-Opinion Review" | Vite web | **BUILT** |
| `signalgrid-desktop` — "SignalGrid Desktop" | Vite web | **MISLEADING NAME** — not a desktop app |
| `signalgrid-mobile-pwa` — "SignalGrid Mobile (PWA)" | Vite web | **BUILT as a PWA**, not a native app |
| `native/ios` — EnterpriseShell + SignalGridMobile | Swift, 109 files, real `xcodebuild` in CI | **BUILT** |
| **Android** | `native/android/` Kotlin app + `core` module | **BUILT (corrected 2026-08-12)** — `MainActivity.kt`, 4 test classes, CI runs `gradle test` + `assembleDebug`. The original ABSENT finding was overtaken by PR #196 the same day. |
| ~~**Native Windows / macOS desktop**~~ | `native/desktop/` Tauri shell (Rust) | **BUILT (corrected 2026-08-13)** — ~~zero Electron, Tauri, `.csproj`, `.sln` files~~. `native/desktop/app/` carries `tauri.conf.json`, a Rust `main.rs` and Cargo manifest; CI builds runnable executables on Linux and Windows. Landed 2026-08-08 in PR #199, the same day this row was written. Caught by `scripts/check-surface-claims.mjs`, not by a human re-reading the table. |

**What this means in plain terms:** there is one genuinely native platform (iOS). The
"desktop app" is a web page named Desktop. The "mobile app" for non-Apple platforms is
a PWA. ~~Android does not exist in any form.~~ **CORRECTED 2026-08-12: a native Android app exists** (`native/android/`), plus Rust dock firmware — so there are three native platforms, not one.

A PWA is a legitimate answer for Android and desktop — but it must be *called* one.
Naming a web artifact `signalgrid-desktop` is the same class of defect this repo has
spent its history removing: a label asserting more than the thing does.

## 3. Dock / smart charging

| Piece | State | Evidence |
| ----- | ----- | -------- |
| Dock as a decision signal | **BUILT** | `lib/signalgrid-core/src/dock.ts`, DockBridge connector, proofs |
| Product/strategy documents | **BUILT** | `docs/DOCKBRIDGE_PRODUCT_CONNECTOR.md`, `DOCKBRIDGE_STRATEGY.md`, `SIGNALGRID_SMARTDOCK.md` |
| ~~**Embedded firmware / controller software**~~ | **BUILT (corrected 2026-08-13)** | ~~Zero `.ino`, `.c`, `.cpp`, `.h` files in the entire repository~~ — the search was the error: it enumerated C-family extensions only, so it *could not* have found the firmware, which is Rust. `firmware/dock/` is a `no_std` Cortex-M4F crate with `unsafe_code = "forbid"` and its own CI workflow. It landed on 2026-08-08, hours after this row was written, and the row's own "genuinely blocked on the physical thing" conclusion was falsified the same day. |

SignalGrid currently *consumes* dock state as a signal. It does not *control* a dock.
Writing embedded code to drive charging hardware without a terminal is a different
discipline (firmware, a hardware abstraction layer, a safety story for controlling
power delivery) and is the single largest genuinely-new engineering item on this list.

It also runs into the platform-honesty rule: software cannot grant itself device
authority. Controlling charging hardware needs a real controller and real hardware to
test against.

## 4. Website, repo page, marketing

| Piece | State |
| ----- | ----- |
| Marketing/positioning documents | **BUILT, and arguably over-built** — pitch packs, outreach templates, LinkedIn drafts, battlecards, talk tracks, target matrices |
| Public website (`signalgrid-web`) | **BUILT** |
| README front page | **BUILT** but oriented to *review*, not to a product install — it opens "SignalGrid Review Hub" and explains repository roles, not what to install or how to start |
| Demo simulation | **BUILT and strong** — `docs/fabric-console.html`, the room simulator, scenario packs, 110 gates |

The marketing surface is the most complete thing on this list. The gap is not volume,
it is that the README addresses a reviewer rather than a prospective user or operator.

## 5. What I would sequence, if the launch line allows it

Ordered by *ratio of honesty gained to effort*, not by ambition:

1. **Rename `signalgrid-desktop`** or relabel it as the PWA/web surface it is. Hours,
   and it removes a false claim from the tree.
2. ~~**Land #152**, so the launch profile that governs scope is actually on the default
   branch. Nothing below should be decided while the scope decision is stranded.~~
   **DONE 2026-08-12** — merged as `e11f2cc`. See the correction at the top of this
   file; do not re-open this as a task, and treat any plan that opens with it as
   having been written from this document rather than from the repository.
3. **README rewrite for an operator audience** — what it is, how to run it, what it
   does not do. Small, high leverage, it is the front page.
4. **Self-host hardening** — upgrade path, backup/restore, supported configurations.
   Turns an existing compose stack into something a customer could actually run.
5. **Android via the existing PWA** (installable, verified on a device) before any
   native Android work. Cheapest honest answer to "Android".
6. **Native desktop** only if a signal genuinely requires OS-level access a browser
   cannot reach. Otherwise the PWA is the answer and should be stated as such.
7. **Federal** — a compliance programme, not a sprint. Needs a human compliance lead.
8. **Dock firmware** — needs hardware. Genuinely blocked on the physical thing.

## What this document does not establish

It does not say any of the BUILT surfaces are *good*, only that they exist and that
their stack is what it claims. Quality, coverage and UX are separate questions —
`docs/PROOF_COVERAGE_AUDIT.md` and the gate suite speak to some of it, and neither
speaks to the web surfaces' rendered behaviour beyond the E2E layer.

(The first draft of this file cited a `COVERAGE_GAP_REPORT.md` that does not exist.
Caught by checking the reference rather than trusting it — the same move the rest of
this document argues for, and worth recording as a reminder that writing the rule does
not exempt you from it.)
