# CI and Validation

SignalGrid Review Hub has its own repository-native CI because it is the public review and validation surface for SignalGrid. Checks that run in `/DEV` are Alpha or legacy checks; they do not protect this public repository, its documentation, or its proof scaffolds.

## Review Hub CI

The `Review Hub CI` workflow runs on pull requests, pushes to `SignalGrid_Alpha`,
and manual workflow dispatch. **This page deliberately does not enumerate its
commands** — an eight-command list written here in July described 5% of the CI
that exists by August, and read as current the whole time. The workflow file is
the truth; what this page owes you is the shape:

- **Six jobs in `review-hub-ci.yml`**: `validation` (the full gate lane —
  typecheck, build, every registered preflight gate and `proof:*` script),
  `breadth` (the deferred connector families and doctrine proofs),
  `docs-sanity`, `durable-persistence` (the Postgres-backed gates),
  `podman-stack` and `deploy-stack` (the compose smokes).
- **Fifteen workflow files total** — the Apple lane, Android, supply-chain
  (SBOM + image evidence + keyless signing), CodeQL, scheduled verification,
  windows desktop, and the rest.
- **The guarantee that keeps this page honest**:
  `scripts/check-preflight-ci-parity.mjs` fails CI when any gate registered in
  `scripts/preflight.mjs` is not wired into a workflow — so "the gate exists"
  and "CI runs it" cannot drift apart silently. The live gate count is the
  parity checker's own output on every run — **read it there**. A figure used to
  sit in this parenthesis; it was 48 short by 2026-09-02, in the one sentence on
  the page whose whole point is that derived numbers do not get copied.

The docs sanity job verifies that required public-review docs exist and checks for narrow, direct unsafe claims such as production-ready, replacement, partner, MFi certification, or autonomous production-remediation claims. It is not intended to block explicit disclaimers, guardrail language, or validation-command examples that document the scanner itself.

## Apple lane — iOS, iPadOS and macOS

`.github/workflows/ios-ci.yml` runs on `macos-latest` for any change under
`native/ios/**` (and for changes to the workflow itself). It carries four jobs:

| Job | What it proves |
| --- | --- |
| `EnterpriseShell (iPhone simulator)` | the app target builds and its unit tests pass on iPhone |
| `EnterpriseShell (iPad simulator)` | the same, on iPad |
| `macOS native (SwiftPM, no simulator)` | the decision port and `SignalGridMobileCore` build and test as native macOS binaries |
| `SignalGridMobile` / `Lint & Security` | `native/ios/SignalGridMobile/scripts/verify.sh`, SwiftLint, and the credential/insecure-URL scan |

**Why iPad is its own job.** Every app target in `native/ios/project.yml` sets
`TARGETED_DEVICE_FAMILY: "1,2"` — a claim that the app supports iPad. Before this
matrix existed the workflow picked *the first available iOS simulator*, which on
GitHub's images is always an iPhone, so the iPad half of that claim was asserted and
never once built. The matrix uses `fail-fast: false`, so a green iPhone cannot hide a
red iPad, and `native/ios/scripts/pick-simulator.py` **refuses** rather than falling
back when a device family is missing from the runner — the fallback is precisely what
made the gap invisible. That refusal has its own negative controls
(`pick-simulator.py --self-test`), which run in the job before the picker is trusted.

**Why macOS is not a simulator run.** `native/ios/Package.swift` compiles the six
pure-Foundation port files — `DecisionEngine.swift`, `AppWorkflows.swift` and the
services around them — as a SwiftPM library, and runs the same XCTest suite against
it. That buys two things a simulator run cannot: the whole logic suite runs in seconds
with nothing booted, and "the port is pure Foundation" stops being a comment and
becomes a compile error the moment somebody reaches for UIKit.

The Xcode test target and the SwiftPM package deliberately compile *the same files*
rather than a copy — duplicating a byte-faithful port to make it testable would defeat
the reason it is byte-faithful. The test sources carry
`#if canImport(EnterpriseShellPort)` around their import so one set of tests serves
both builds. Because both file lists are hand-maintained,
`scripts/check-ios-port-sources.mjs` derives them from `Package.swift` and
`project.yml` and fails if they diverge; it runs in `preflight` and in the
`macos-native` job. Without it the two lanes could drift into testing different code
while both stayed green.

**What none of this proves.** A hosted macOS runner is a throwaway VM and a simulator
is not a device: nothing here says anything about MDM enrolment, supervision, or
on-device enforcement. See `docs/MAC_LANE.md` for that boundary.

## Desktop lane — Windows and Linux

`.github/workflows/desktop.yml` builds and tests `native/desktop/core` — the Assist
gate client for the desktop shell — on **both `ubuntu-latest` and `windows-latest`**,
with `fail-fast: false` so a green Linux cannot hide a red Windows.

| Job | What it proves |
| --- | --- |
| `Assist core (ubuntu-latest)` / `(windows-latest)` | the trust rules compile and their 38 tests pass on both platforms |
| `Desktop shell (ubuntu-latest)` / `(windows-latest)` | a **runnable executable** builds on both, and is uploaded as a CI artifact |
| `Shared Assist vectors bind every client` | see the next section |

**The core came first, deliberately.** `native/desktop/core` is a Rust crate — the
Assist outcome vocabulary, fail-closed wire parsing, endpoint validation, 38 tests.
Everything that decides what a worker is told is testable with `cargo test` on any
machine, with no display server, installer, or signing certificate. `native/desktop/app`
is then a Tauri shell thin enough that nothing important can hide in it: it renders a
decision and says what the host app may do with it.

Windows is a separate job for the same reason iPad is one in the Apple lane: a platform
claimed from a build that never ran on it is a claim nothing checks.

**What the shell does not do.** It does not decide anything and it does not touch the
network. The decision it renders is a **fixture**, labelled as one *on screen* — a
`step_up`, chosen because it is the outcome most likely to be mishandled (an `allow`
would let a shell that ignores the outcome entirely still look correct). Its unit tests
assert the fixture stays a `step_up`, that it never renders as proceedable, and that an
unconfigured gate URL is **stated** rather than left blank.

**What CI produces is an executable, not an installer.** No bundling, no code signing,
no notarisation, no auto-update. On Linux the binary needs WebKitGTK present at run
time. `artifacts/signalgrid-desktop` remains a separate Vite web app — the operator
console — exactly as `docs/APP_SUITE_MATRIX.md` says.

**The icons are source.** `native/desktop/app/icons/generate-icons.mjs` encodes them as
a plain-text grid and emits deterministic PNG and ICO bytes; CI asserts the committed
files still match. Same reasoning `.github/workflows/android.yml` gives for having no
Gradle wrapper jar: a public repository should not carry a binary no reviewer reads and
no gate inspects.

## One set of Assist cases, three clients

There are now three independent implementations of the same fail-closed rule —
TypeScript in `lib/` (the source of truth), Kotlin in `native/android/core`, and Rust
in `native/desktop/core`. Each had its own hand-written tests, which is precisely the
arrangement in which they diverge silently: every suite stays green while one client
starts treating a malformed response differently from the others.

`native/shared/assist-wire-conformance.json` is **one set of 42 cases every client
must agree on** — happy paths, transport failures, captive-portal HTML, truncated
bodies, wrong-typed fields, and the near-misses (`allow_all`, `disallow`, `allowed`)
that a lenient parser could talk itself into accepting. Each client has a test that
reads the file and asserts its own parser agrees, case by case.

**It found two real defects in the Kotlin client on its first run**, neither visible
to that client's own suite:

| Defect | Why it mattered | Settled by |
| --- | --- | --- |
| `RESTRICT.proceedsWithoutFurtherAction` returned `true` | a host app would have carried on at **full** capability on a restrict decision, silently discarding the ceiling | `lib/orchestration/src/index.ts` maps `restrict` → mode `hold`, not `proceed` |
| `parse()` accepted `"stepup"` / `"step-up"` as `STEP_UP` | strictly **more permissive** than denying: `STEP_UP` offers a challenge and so a route to proceeding, `DENY` offers none | the Assist wire vocabulary is exactly the four underscore-spelled values of `VALID_OUTCOMES` (`lib/signalgrid-core/src/policy.ts`), which is also what every outcome enum in `lib/api-spec/v1-openapi.yaml` publishes. `step-up` is not a synonym to be waved through: it is a DIFFERENT contract's spelling — the older published 0.2.0 `/api` `DecisionOutcome` in `lib/api-spec/openapi.yaml`, carried by the generated `lib/api-zod` and `lib/api-client-react` clients — so a parser that accepted it would be guessing which surface it was talking to. Gated by `scripts/check-decision-vocabulary.mjs` |

Both were fixed against the source of truth rather than by editing the vectors to
match. **Never make a case pass by weakening it**: a disagreement here is a client
that will mishandle a real gate response.

Two things keep the file itself honest:

- **A non-vacuity floor.** A suite made only of denials is satisfied by a client that
  returns `DENY` unconditionally and decides nothing. The file declares its own
  minimum case count and required outcomes; every client asserts them *before* running
  the cases, and asserts afterwards that a proceedable case actually proceeded.
- **`scripts/check-assist-conformance.mjs`**, which derives the client list from
  `native/*/core` on disk rather than a written-down list — so a fourth client added
  without wiring the vectors fails the gate rather than quietly opting out. It runs in
  `preflight` and in the desktop workflow.

**Not established by a green run:** that the clients' tests *ran* (the language lanes
do that); iOS, which ports the decision engine rather than consuming `/v1` as a wire
client and is covered by `scripts/check-decision-port-parity.mjs`; or the TypeScript
source the vectors were written *from* — a case that misread the product would be
wrong in every client at once, and consistently.

## Required local checks

Before opening or updating a pull request, run **one command** from the repository root:

```bash
pnpm install --frozen-lockfile
node scripts/preflight.mjs          # the whole gate suite; --quick skips the heavy web/app builds
```

`preflight.mjs` is the ordered mirror of every CI job that needs nothing but Node — well
over a hundred gates, including the typecheck, the build, the launch-surface `proof:*`
suite, the unsafe-claim scan, and the drift ratchets. Its own header states honestly
which three CI jobs it does *not* mirror (Postgres, the Docker-compose smoke, and
gitleaks), so a green preflight means everything reproducible locally is green, not that
CI cannot go red.

**The breadth lane is separate since 2026-08-11.** The 47 deferred-family gates and the
8 doctrine-document proofs run as their own required CI job (`Breadth lane`, in parallel
with `validation`) via `pnpm run verify:breadth` — kept, still gating every pull
request, no longer a serial per-push tax. Touch a deferred connector family or a
doctrine document? Run the breadth lane locally too:

```bash
pnpm run verify:breadth             # deferred-family + doctrine-doc proofs
```

`check-ci-preflight-sync.mjs` holds the two lanes disjoint and jointly complete, and
`verify-breadth.mjs` itself refuses to run if a deferred family's proof has left both
lanes or a launch family's proof has drifted into it.

**Run the whole thing, not a hand-picked subset.** This section used to list five proofs
and a `git grep`, and that list was the defect it looked like a control against: it
omitted `proof:incident-playbook`, so a change that added a new composable signal kind
without an owning incident queue passed every check a contributor was told to run and
went red in CI. Picking the gates that "obviously relate" to a change is exactly how the
derived ones — the gates that exist because the relationship is *not* obvious — get
skipped.

`PORT` and `BASE_PATH` are required by several Vite review surfaces during production
builds; preflight sets them for the build step itself.

### Two consequences worth knowing before you push

- **A new composable signal kind needs an owning queue.** `proof:incident-playbook`
  enumerates the runtime `SIGNAL_KINDS` union and asserts that no kind falls through to
  the generic Service Desk, so adding one to `lib/posture-composition/src/types.ts`
  requires a matching `categoryForKind` case in `lib/incident-playbook/src/map.ts`.
- **Never run `scripts/mutation-guard.mjs` concurrently with anything else, and never
  under a timeout that may kill it.** It mutates source files in place and restores them
  afterwards; a sweep killed part-way leaves the tree mutated, which then surfaces as
  unrelated phantom failures elsewhere (a "stale allowlist entry" for code that had not
  moved, and a failing facility-trust-graph proof whose guard clause had been silently
  rewritten to `true`).
  **"Anything else" includes a SECOND mutation guard, and includes preflight.** Two
  sweeps in one working tree race on the same in-place edits; a proof run by anything
  else can read a file mid-mutation and fail for a defect that is not there. This
  paragraph existed and was violated anyway on 2026-08-25, by starting a `--shard`
  run to check the new flag while the full sweep was still going — no damage, and
  only because the two happened to draw different families.
  **This is exactly why the CI shards are safe:** `--shard=i/N` splits the registry
  across SEPARATE RUNNERS, each with its own checkout. Sharding into one working tree
  would be the concurrency this bullet forbids, not a way around it.

### A name-drift gate is not a behaviour gate

`scripts/check-mcp-surface.mjs` asserts the MCP server, its ready message,
`docs/RUN_ON_MAC.md` and the live-sync manifest all list the same eight tool names.
That is worth having and it is not coverage: a tool can pass it while returning a
confidently wrong answer, and one did. `evaluate_location_certainty` defaulted two
optional inputs — `source_health ?? "healthy"` and `map_version ?? <the graph's own
version>` — before handing them to the decision library. The caller of an MCP tool is
an assistant in a chat that cannot know an RTLS source's health, so omitting the field
is the normal case, and every one of those calls was answered as though the source had
been confirmed healthy. Two calls in opposite epistemic states returned byte-identical
verdicts of `SUFFICIENT_CERTAINTY / none / known` with `unknownSignals` empty.

`pnpm run proof:mcp-answer-discipline` (55 checks) closes it by driving the real server
over its real newline-delimited JSON-RPC stdio wire — no MCP SDK dependency, because
testing through the vendor's client object would prove the client agrees with the server
rather than that the server is right. Its negative control is recorded: reintroducing the
two `??` defaults drops it from 55/55 to 48/55.

**The same class, found again one layer up — an advertised contract that was not
enforced.** Every tool published `additionalProperties: false` and enforced none of it:
the SDK wraps a raw shape with `z.object(shape)`, and zod's default for an object is
STRIP, so an unknown key was silently dropped and the call proceeded. This is worse than
the `??` defaults, because there the caller said nothing, whereas here the caller *did*
pose a bound and spelled it in the other convention the same tool uses. Measured on the
wire against an observation dated 2020 with the caller's own 2026 reference instant:

```
max_observation_age_seconds: 60   ->  DROPPED. recency "unbounded", SUFFICIENT_CERTAINTY, none
maxObservationAgeSeconds:    60   ->  recency "stale", LOCATION_STALE, step_up
```

A 6.5-year-stale fix graded as sufficient certainty because a key fell on the floor. Every
droppable field is one that would *tighten* the verdict, so the loss is one-directional.
The core already applies this law one layer down (`hasUnrecognizedKey` → `malformed`); the
adapter applied it to the observation and not to the requirement. Fixed by publishing
`z.object({...}).strict()`. Removing `.strict()` drops the proof to 43/55.

**Two naming conventions in that tool are deliberate, and pinned so nobody tidies them.**
snake_case inputs mirror `LocationObservationRaw` (what the source reported); camelCase
mirror `LocationRequirement` (what the caller poses). An adversarial pass over this
surface proposed "assert one casing convention" as a fix — that would have been a
regression, silently reclassifying a policy field as an observation field. The pin derives
the partition from the library's own `LOCATION_OBSERVATION_KEYS` rather than from
spelling, because spelling is not the discriminator: `confidence` has no underscore and is
an observation field. The first draft of that check classified by underscore and failed on
exactly that case.

**Where a surface's omission semantics actually live.** `evaluate_room_entry` takes two
inputs that RELEASE held actions, and omission is normalized three times on the way down
— in the MCP adapter (`stepUpSatisfied ?? false`), again in `lib/room-sim`, and again by
`lib/orchestration`'s strict `=== true`. Only the OUTERMOST one is falsifiable from the
chat surface: flipping either inner default leaves the proof at full marks because the
layer above has already turned `undefined` into `false`, while flipping the adapter's
default drops it to 53/55. That was measured rather than assumed, and it is recorded in
the proof itself so a future lane hardening the library comparison knows its change is
unobservable from here. `stepUpSatisfied` is also a caller-*asserted* simulation input
rather than a ceremony the tool performs — the shipped path
(`/v1/app-workflows/complete-step-up`, verified WebAuthn) is deliberately stricter, and
the tool description now says so, because an assistant reads it to decide how to report
the answer.

**There are two MCP proofs and neither is redundant.** `pnpm run proof:mcp-server`
(11 checks) came from the Mac lane on the same day — both lanes noticed the same hole
independently, which is the second entry in `LANE_COORDINATION.md`'s collision log. It
boots the PUBLISHED plugin path through the vendor's own SDK client and asserts the
served surface equals the surface the live-sync manifest declares to external builders;
it catches a server that will not start, a handler that throws, a manifest that has
drifted. `proof:mcp-answer-discipline` asks the other half: given that it serves, is the
answer EARNED. A server passes either while failing the other, so they were kept as a
pair rather than one being discarded to resolve a filename collision.

**The general rule this leaves behind: on any surface that answers a caller, every
optional input is a CLAIM, and omitting it is a non-claim rather than a pass.** Hand
the caller's value through and let the normalizer decide what silence means — the
libraries in `lib/` already grade absence fail-closed, and a `??` in the adapter is
how that grading gets bypassed.

### Proving a merge rule, not just a merge

`proof:decision-continuity` (75 checks) guards `lib/signalgrid-core/src/continuity.ts`,
which answers "which decision wins" when a device has been deciding offline. It is worth
noting here because of *how* it is guarded rather than what it guards.

Five laws are **measured over exhaustive sweeps** rather than asserted on examples:
order-independence over 9,216 ordered pairs and 13,824 three-record sets in all six
permutations; idempotence over the same pair space; monotonicity over 55,296 additions
(no non-dominating record ever relaxed the outcome); the offline veto over 3,744
compromised-frontier pairs; and the un-stick path over 288 clean-authority pairs. Two of
those sweeps carry an explicit **non-vacuity check** — a sweep that finds zero
counterexamples because it found zero *opportunities* proves nothing, and that failure
mode is invisible unless you look for it.

The negative controls did real work rather than confirming the design. The proof header
records five mutations with their measured scores, and one of them **changed the code**:
the first draft predicted that reading an absent `coreNormalizationVersion` as zero would
break the offline-veto law, and measuring showed it did not. The design choice was still
right — reading absence as zero lets a stamped record dominate on an axis where nothing
is known about its opponent, converting a legacy `deny` into an `allow` — so the proof
now pins it as an **outcome** as well as an ordering. A prediction that survives being
measured is evidence; a prediction that is never measured is a comment.

The one duplication in the file is pinned rather than tolerated: `continuity.ts` keeps its
own `OUTCOME_RANK` because `policy.ts` is inside the core-normalization import closure and
this file deliberately is not, so sharing the constant would drag a reconciliation edit
into the stamp on every decision record. The proof reads both literals as text and fails
if they diverge.

### A coverage rule that is right for what it covers can still leave a hole

`scripts/check-guard-registries.mjs` derives its mutation-coverage requirement from proofs
importing `enumerateGrantSafety` — the connector allow-path harness — because that is
"the population where an unfalsifiable guard is most dangerous". `continuity.ts` is not a
connector, so `proof:decision-continuity` passed that gate legitimately while being
exactly the population the gate exists for: `reconcileDecisions` can return `allow`, and a
weakened branch would let a stale or offline record produce one.

The response was to register the file by hand rather than widen the rule until it fit. The
rule is correct for what it was written to cover; stretching it to catch one more case
would have made it harder to reason about and no more complete.

**The same shape turned up again in a different guard** (intake ledger row 55).
`proof:absent-collection` pins one law — *nothing observed is not the same as nothing
wrong* — at every site that grades a collection, and it named seven. The `carrier`
dimension was not among them, and it held the plainest violation in the repository:
`wifiOnly` was derived from three absences (no ICCID, no SMS capability, no data
session) and asserted the positive fact "this device has no cellular backchannel at
all", which the evaluator short-circuited on ahead of every other check while
reporting `locatable: false`.

What made it invisible is that no amount of carrier-side evidence can settle the
question. A carrier API reports SIMs on the account it was asked about; silence covers
a partial read, a paginated tail, an eSIM on another operator's platform, and a device
attached to a private 5G network it has never heard of. So the fix is not a fourth
condition but a change of plane: the axis is posed from device inventory, a
carrier-only read now asserts its own ceiling (`unknown` on every signal, pinned by the
proof), and *no radio* and *nobody told us* resolve to different postures so no
consumer can conflate them. Five assertions were added to the law's proof and
negative-controlled — restoring the old default fails three of them.

Both cases share a lesson worth stating once: a guard's registry is itself a claim
about coverage, and it goes stale in exactly the way the guard exists to prevent.

**The sweep immediately earned it.** 22 mutations, 18 killed, **four survivors** — all
four shape-checks that the proof's `refuses()` helper structurally could not distinguish,
because it asserts only that a `CoreError` with code `validation` came back and each shape
throws *something* either way. Remove the null-record guard and `record.id` throws a
**TypeError**; remove the `elapsedSecondsById` guard and `Object.entries(undefined)` does
the same. At the wire that is the difference between a 400 and an unmapped 500, and
`refuses()` asserting `err instanceof CoreError` is the discriminator — which is why the
new cases had to be written separately rather than folded into existing ones.

The empty-set guard was the instructive one: with it removed, `reconcileDecisions([])`
still throws a validation `CoreError`, just from `mostRestrictiveOutcome` deeper in, so
every code-only assertion passed straight over the hole. What that guard buys is a
caller-accurate message rather than an internal one, so it needed a **message** pin. Five
assertions (60 → 65 checks) took the sweep to 22/22 killed, 0 survivors.

### A scope that cannot express the document is not a scope

`check-proof-figures.mjs` scopes by `##`/`###` **section** — deliberately, because
paragraph scope was tried first and missed the drift that actually happened. But
`docs/INTAKE_LEDGER.md` is one `## Ledger` section holding fifty-plus rows about
fifty-plus unrelated inputs, so under pure section scope every comma-formatted number
anywhere in that table was checked against every proof named anywhere in that table. A
row stating its *own* proof's live figures failed against five other proofs it merely
shares a table with.

The rule now: **a table row that names a proof is self-scoping; a row that names none
inherits its section's scope.** That keeps the coverage that matters — a laws table whose
figures sit under a heading paragraph naming the proof is still checked against it,
because those rows name no proof of their own — while stopping one row from being judged
against another row's proof. Both directions were verified by negative control: a wrong
number inside a self-scoped ledger row is caught (against exactly one proof, not six),
and a wrong number in a table row naming no proof is still caught through its section.

Measured coverage went **up**, not down: 27 → 31 distinct figures checked, because four
figures that could not previously live in the ledger at all now do and are guarded.

The same pass fixed a latent defect in the guard's own coverage line. `checked` counted
(proof, figure) *pairs*, and one figure can pair with several proofs sharing a scope — so
subtracting it from the document total understated the gap, and with enough multi-proof
sections would have gone negative. Distinct figures are now counted separately from
pairs. A guard that announces its own partial coverage has to measure that number as
carefully as the ones it polices.

**The right rule was attached to the wrong syntax.** `INTEGRATION_CATALOG`'s
endpoint-management/NAC/entitlement proofs section is a bulleted list of one entry per
proof — the ledger table's structure written with `-` instead of `|`. It behaved
correctly only because none of the proofs it named were registered with the figure guard.
Registering one (`proof:service-lifecycle`) immediately made every *other* bullet's
figures — entitlement-binding's sweep size, uem's, response-accountability's two — read
as claims about the one registered proof, and the guard failed on numbers that were
perfectly accurate about their own subject. So a top-level list item that names a proof
is now self-scoping too, reconstructed as the `-` line plus its indented continuations,
because a multi-line bullet is one bullet.

Narrowing a guard needs evidence rather than an argument, so the pair sets were computed
under both scopings and differenced: exactly five pairs lost, none gained, and every lost
pair is the newly-registered proof against a number belonging to a different bullet (one
of which was never a figure at all — it is a character-length allowlist bound). No proof
loses a pair of its own. That is the same safety property the table-row rule claims, this
time measured rather than reasoned about.

### Where new work is allowed to land

`node scripts/check-package-reachability.mjs` computes the transitive closure from the
shipped artifacts and reports every `lib/*` package none of them can reach. Eight of
thirty-five are unreachable today — one with no importers at all, the rest imported only
by the proof harness — and the check is a ratchet pinned at that count rather than a hard
gate, because unreachable is a requirement to *look*, not a verdict to delete.

Before building into a library, ask it how that library ships:

```bash
node scripts/check-package-reachability.mjs --why @workspace/<package>
```

It prints the shortest artifact→package path, or says plainly that the package is
unreachable and that work landed there is work nothing can call. It exists because a
design pass once scoped a repair into `lib/dual-control` before establishing that
`planFlowActions` has zero shipped consumers — the wiring would have been proven by a
proof and reachable by nothing.

## Branch protection

After the workflow is available on GitHub, branch protection should eventually require `Review Hub CI` before merge. Recommended settings for `SignalGrid_Alpha`:

- Require status checks before merging.
- Require `Review Hub CI`.
- Require conversation resolution before merging.
- Require the branch to be up to date before merging.

This keeps Review Hub independent from `/DEV` and makes the public validation surface self-protecting.

## The two verification layers added with the zero-cost test wave

- **Real-cryptography proof.** `pnpm run proof:live-idp` (31 checks) boots a
  certified OIDC provider in-process, mints genuine RS256 and DPoP-bound tokens
  over real HTTP, and drives every accept/reject decision through the production
  verifier in `lib/enterprise-auth` — tampered signatures, wrong issuer/audience,
  real 1-second expiry, HS256 algorithm-confusion forged from the provider's own
  public-key bytes, and `cnf.jkt` validated against the RFC 7638 thumbprint of
  the held key before the token-binding dimension is allowed to call the result
  sender-constrained. The fixture proof shows the logic is right; this shows it
  is right against bytes SignalGrid did not fabricate. Fully local, no tenant,
  no cost.
- **Browser-level E2E.** `pnpm run test:e2e` (35 tests, ~126 content-bearing
  assertions) runs Playwright against the BUILT review console, website,
  admin console, desktop client, and mobile PWA (the admin console, desktop
  client, and mobile PWA proxied to a live locally-booted api-server).
  It asserts what a human actually sees — decision evidence rows, reason codes,
  the corrected battery copy — and its maiden run caught a real gap no other
  gate could: a decision-evidence row the core carried and no console scenario
  ever rendered.

## CI ↔ preflight drift (`pnpm run guard:ci-sync`)

`scripts/preflight.mjs` calls itself a mirror of the CI jobs that need nothing but Node,
and asked a human to *"keep this list in lockstep"*. Two hand-maintained lists that must
agree is a promise, not a mechanism, and it fails silently in **both** directions: a proof
in CI but not preflight means a red build passes `Safe to push`; a proof in preflight but
not CI means it is verified only on a developer's machine while every status surface says
CI runs the full suite.

**Both had already drifted.** `proof:dual-control` and `proof:session-store` ran in
preflight and in **no workflow at all**. They are in CI now, and
`scripts/check-ci-preflight-sync.mjs` derives both lists from source so the next omission
is caught by a machine rather than by an audit that happened to look.

Three Postgres proofs (`audit-ledger-pg`, `decision-store-pg`, `session-store-pg`) are
exempt **by name with a reason**, not by a `/-pg$/` pattern that would quietly absorb the
next unrelated omission — and a stale exemption is itself reported, since silencing a
check for something now covered is its own drift. The gate also refuses to pass on an
implausibly small scan: both sides are read with a regex, and if either stops matching the
sets go empty and every comparison trivially succeeds. A drift checker that reports "no
drift" because its parser broke is the exact failure this repository keeps finding, so the
gate that hunts it carries a floor against having it.

## Unsafe-claim scan scope

The CI denylist is intentionally narrow and direct. It checks for production-ready, replacement, partnership, MFi certification, autonomous-remediation, and specific replacement phrases such as `replaces Jamf`, `replaces Intune`, `replaces Apple Configurator`, and `replaces GroundControl`, while allowing explicit disclaimers, guardrail wording, and validation-command lines that document the scanner itself.

**`scripts/docs-sanity.mjs` implemented that allowance; `phase-gate.ts` did not.** The two
scanners share a denylist and disagreed about how to read it. `docs-sanity` is
negation-aware and has been for some time — its `hasBareClaim` requires a negator to
appear *before* the phrase, and its comment records why a line-wide search is wrong. The
phase gate just ran the grep. A substring match cannot distinguish a partnership claim
from its own denial, and since this project's doctrine is platform honesty, its docs are
overwhelmingly the denials. Measured at the time of the fix: **64 hits, of which zero were
affirmative.** `unsafeClaims=found` had therefore printed on every run the gate had ever
made, and would have printed identically on a repository that *did* carry a real claim. A
signal that cannot vary carries no information, and the incentive ran backwards — writing
an honest disclaimer cost you a lane escalation.

`scripts/src/unsafe-claim-classifier.ts` now sorts each hit into `affirmative`,
`disclaimed`, `self_referential` or `registry`, and **only `affirmative` moves the lane**.
The two marker families are scoped differently on purpose:

- **Negation is positional** — counted only in the text *before* the match, within the
  same clause (`.`, `;` and `|` are boundaries, because these docs use markdown tables and
  a negation in one cell must not reach into the next). Words like "not" and "no" are
  ordinary prose, so a line-wide search would let a production-readiness assertion launder
  itself on a trailing "no" elsewhere in the sentence. This matches `docs-sanity`'s
  `hasBareClaim`, which reached the same conclusion first; the phase gate additionally
  narrows the window from the whole line to the clause.
- **Prohibition is lexical** — "avoid", "denylist", "guardrail", "disclaimer" and friends
  count anywhere in the clause, because they cannot plausibly co-occur with a sincere
  claim.

Anything not positively identified as disclaimed is affirmative: fail-closed, as
everywhere else here. The gate prints the full breakdown (`unsafeClaimMentions=total:…
affirmative:… disclaimed:… selfReferential:… registry:…`) so a collapse in the disclaimer
count is visible too.

**Known limitation, stated rather than implied by silence:** the registry exemption is
per-file, so a sincere claim written *inside* `docs/PUBLIC_MESSAGING_GUARDRAILS.md` — the
document whose purpose is to enumerate forbidden wording — is exempt. The `registry:`
count moves when that happens, but the lane does not. Closing it would require shape
heuristics about how that one document may be written, and a guard that fails on
legitimate edits gets switched off. `pnpm run proof:unsafe-claim` (40 checks) pins all of
the above, including that limitation and the adversarial trailing-negation case.
