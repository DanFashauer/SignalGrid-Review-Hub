# SignalGrid build backlog

A living, prioritized backlog for continued build — human- or agent-driven.
Each item is scoped to ship as one reviewable PR. Ground rules for any agent
picking these up:

- **Public-safe by default** — no secrets, PHI/PII, tenant data, or live vendor
  calls; no production-ready / compliance / partnership / replacement claims.
- **Fail closed & fixture-first** — deterministic seeds; high-risk actions stay
  approval-gated and simulated.
- **Prove it** — every substantive change lands with a passing proof/test and
  `pnpm run typecheck` + `pnpm run safety:check` green.
- **One PR per item** — open for review; do **not** auto-merge.

## Now (next up)

Re-triaged 2026-08-17 against the owner's "now vs backlog" directive: the Fleet
websocket collector moved to done (built and live-verified the same day); the
dual-control product question moved to **Owner-gated** where decisions live —
it was a decision wearing a task's clothes; the two Swift mirrors stay here but
are **Mac-lane only** (no Swift toolchain in the cloud lane, and an uncompiled
Swift edit is invisible until a human opens Xcode); `ReleaseLedger.holds` and
the webhook write-route stay recorded-not-fixed by their own stated rule (no
lone repairs into unreachable code).

- [x] **Align the new 27.0 `mdm.*` status items to the custody model (DDM connector, HIGH).**
      *(Row opened by the 2026-09-18 intake (#858). What 27.0 ADDS was unmodelled: `mdm.is-return-to-service`, `mdm.enrollment-type`,
      `mdm.is-shared-ipad`, `mdm.is-awaiting-configuration`, `security.lockdown-mode`,
      `device.system.health` — Apple `09f249a06e7e3289930bf6d05f38fb562f748ebf`. The first
      two are the facts the custody model and the Return-to-Service row need.)*
      **DONE 2026-09-18** — `lib/ddm-connector/src/index.ts` reads both as read-only status
      items with unknown-tightens semantics: `enrollmentTypeOf` accepts only Apple's own
      rangelist and treats an unpublished wire value as `unknown`, and `supervised` is true
      for the exact value `supervised` and nothing else, because golden rule 4's
      captive-device claim rests on supervision alone; `custodyPostureOf` reads
      `return_to_service` as custody IN TRANSIT and treats an absent field as `unknown`,
      since only an explicit `false` says a device is in ordinary service. Both raise
      assurance and neither can lower it. The other four are named in `apple-schema.ts` as
      known-and-unmodelled rather than silently skipped — a pin no code consumes is a pin
      nobody re-verifies. Two fixtures were added (`mac-noc-11` user-enrolled, `mac-noc-12`
      in return-to-service) and every other fixture now carries `enrollmentType:
      "supervised"` + `returnToService: false`, so each older assertion still isolates the
      arm it names instead of passing for the new reason. NOTE: the 26.4 → 27.0 version
      constants overlap PR #856, which is unmerged; #856 also rewrote both headers to say
      no proof reads Apple's YAML, and the row below makes that sentence false. How you'd
      check: `pnpm run proof:ddm-connector` → `summary=pass (131/131)`.
      **CORRECTED 2026-09-24 — the return-to-service half above misread Apple.** Apple's
      `mdm.is-return-to-service` says "If true, the device is using the return to service
      with app preservation mode" — a standing shared-device configuration, not a device
      being wiped and handed on — and it is reported on iOS and visionOS 27.0 only (macOS,
      tvOS, watchOS: n/a). Reading `true` as custody in transit, and absence as unknown on
      the Mac fixtures, stepped every Mac up forever for an item it can never send. Now
      `returnToServiceStateOf` reads the platform (`device.operating-system.family`, vendored
      beside the other pins): n/a platform → `not_applicable`, no raise; `false` →
      `in_service`; `true` → `rts_app_preservation`, which does not raise on the RTS axis
      but does on update currency, because Apple's Return to Service page says "If Return to
      Service with app preservation is active, the device disables software updates—both
      automatic and user-initiated" and updates apply only at a reset whose cadence the
      connector cannot see — so declarative enforcement there reads `unknown`
      ("reset-bound") and raises. Absent where it applies, a pre-27 iOS/visionOS, an OS major
      that is not a whole number at or above 27, or an unknown platform → `unknown`, which
      raises (pre-27 `not_applicable` is Apple-correct but not an approved loosening — the
      open row below). The applicability table is frozen. Whether an erase is in flight is
      not observable from this item — that is MDM command status or the `device_returned`
      binding below. The Mac fixtures carry `platform: "macOS"` and no key; three iOS 27
      fixtures carry the three arms; the proof also holds the connector's applicability
      table against Apple's vendored `supportedOS`. How you'd check: `pnpm run
      proof:ddm-connector` → `summary=pass (169/169)`.

- [ ] **A real iPhone/iPad DDM report cannot read `standard` yet (DDM connector, MEDIUM; owner: endpoint-uem-domain).**
      Three things are owed, each fail-closed today (it tightens, never loosens), each the
      same "stepped up forever for something it can never send" shape the row above fixed
      for the Mac. (1) `binaryControl` and `privacy` are macOS facts (Endpoint Security,
      PPPC); the iOS fixtures carry `enforced`/`declared` as stand-ins and no ingest path
      produces an iOS value, so a real iOS report reads unknown on both and raises —
      define the iOS meaning or scope the two axes by platform. (2) Nobody has verified what
      an iPad sends for `device.operating-system.family`: Apple publishes no rangelist, the
      pinned example shows `"iOS"`, and a device sending `"iPadOS"` reads platform unknown
      and raises. Verify against a real enrolled iPad (or KMFDDM on NanoMDM,
      `docs/ZERO_COST_LIVE_TEST_MATRIX.md`) before mapping anything. (3) Owner sign-off on
      reading an absent `mdm.is-return-to-service` on iOS/visionOS 15–26 as `not_applicable`
      (Apple introduced the item in 27.0); if granted, bound it to a whole OS major at or
      above Apple's `device.operating-system.version` floor, never just `< 27`. Source: the
      2026-09-24 review of `claude/fix-ddm-return-to-service`.

- [x] **The ddm-connector likely misreads `mdm.is-return-to-service` — model it as standing configuration, not an erase in flight, once a real device confirms the reading (DDM connector, HIGH).**
      *(Opened 2026-09-24 by the owner's puck-flow intake, DR-055; the review read Apple's
      status YAML — *"If `true`, the device is using the return to service with app
      preservation mode"* — as a standing configuration, not custody in transit.)*
      **DONE 2026-09-24 in PR #1024 (mainline 0fd151a2), which landed before this row:** the
      reader is now `returnToServiceStateOf` in `lib/ddm-connector/src/index.ts`. Apple's item
      is read only where Apple publishes it (iOS/visionOS 27+); `true` is
      `rts_app_preservation`, a configured mode that does not raise on its own; an absent
      value there stays `unknown` and raises; macOS/tvOS/watchOS read `not_applicable`; and a
      device reporting `true` with declarative update enforcement reads update currency
      `unknown`, because updates in that mode apply only at reset. `pnpm run
      proof:ddm-connector` went 131/131 → `summary=pass (169/169)`, with every new arm
      falsified in #1024's body. The real-device precondition this row asked for was NOT run:
      #1024 is fail-closed on every unknown instead, and the open row above keeps what a
      real device still has to settle (the `iPadOS` family value and the pre-27 sign-off).

- [x] **Hold the DDM/macOS-posture schema pins against Apple's YAML (gate, MEDIUM).**
      *(Opened by the same intake, #858.)* **DONE 2026-09-18** — the ten status items the
      two catalogs pin (`DDM_APPLE_STATUS_ITEMS` ∪ `APPLE_DDM_STATUS_ITEMS`) are vendored
      verbatim under `third_party/apple-device-management/declarative/status/` at
      `09f249a06e7e3289930bf6d05f38fb562f748ebf` with Apple's MIT `LICENSE.txt` and a
      `VENDORED.md`, declared as a `third_party_intake` area in
      `scripts/publication-boundary.mjs` beside the other three vendored trees.
      `proof:ddm-connector` now resolves every pinned item to a vendored file and asserts
      its `payload.statusitemtype` equals the pinned name, that the value key the connector
      reads is declared, and — for `mdm.enrollment-type` — that Apple's `rangelist` EQUALS
      the connector's own value list. The header's promise that "a schema change surfaces
      as a failing check" was previously kept by nothing: the checks compared the catalog
      to itself, and a self-consistent catalog survives any upstream change. Only the
      pinned subset is vendored; Apple's whole vocabulary would be somebody else's work
      republished for no check. FALSIFIED by removing one vendored file (five assertions
      red). The rangelist self-test was itself wrong on its first run — a plain first-match
      replace hit the `allowed-enrollments` list higher up the file and left the rangelist
      intact, so it passed while proving nothing. How you'd check: `pnpm run
      proof:ddm-connector` → `summary=pass (131/131)`; `node
      scripts/check-publication-boundary.mjs` passes with the new area.

- [x] **27a — Normalization-version stamping on evidence (intake row 27). BUILT.**
      An adversarially-verified audit of the owner's canonical endpoint signal set found
      that nothing in the fabric recorded which version of the code produced a normalized
      record: `EvidenceSnapshot`/`Decision`/the /v1 `EvaluateResult` stamped only
      `policyVersion`, and the near-misses (`APPLE_DEVICE_MANAGEMENT_SCHEMA_VERSION`, the
      unconsumed posture-report.contract.json `schemaVersion`, work-context's
      `contextVersion`, the facility graph's `mapVersionMatch`) each version something
      else. `coreNormalizationVersion` now rides all three carriers and the /v1 response,
      inside the tamper-evident digest.
      **It is GENERATED, not a constant somebody bumps** — three designs went through four
      refute-by-default critics each, and the hand-set-constant-plus-pin design was killed
      by a specific attack: its pin is a committed file and a text editor is a second
      writer, so a human who edits the source and pastes the printed digest under an
      unchanged version satisfies every conjunct. `scripts/generate-core-normalization-version.mjs`
      recomputes the digest FROM SOURCE (a mechanical import closure over 12 core files)
      and derives the integer from the comparison, so there is no consistent pair a human
      can write that it will reproduce. Ten in-process negative controls (six on the digest,
      four on the version rule) and floors F1–F8 run on every invocation; `--check` is wired
      into preflight and CI.
      The version rule itself is hardened against the one direction it must never fail in:
      a bare `catch { /* genesis *\/ }` used to swallow EVERY read failure, so deleting or
      corrupting the artifact silently restarted the counter at 1 and re-minted a number
      that already meant something else. Now only `ENOENT` is genesis, genesis is refused
      outright when the artifact has git history, and a hand-edited version or digest is
      rejected rather than propagated (`"3" + 1 === "31"`).
      Migration is a single conditional spread in the digest body: an unstamped snapshot's
      canonical body stays byte-identical to the pre-stamp one, so rows written before the
      field existed keep verifying with no version-conditional branch anywhere. Pinned by
      the legacy digest in `proof:signalgrid-core`.

- [ ] **27b — Per-connector normalizer versioning. REFUSED, with reasons — this is a
      decision, not unbuilt scope.** The original row also asked for a version on the ~47
      `normalize*` functions under `lib/integrations`. It is not being built, and the
      refusal is recorded here so no future lane reads it as a gap:
      `lib/signalgrid-core/package.json` declares ZERO dependencies, so the core
      structurally cannot import them; nothing they produce is persisted or digested; and
      a version on them would therefore appear in no durable artifact where anything could
      ever detect that it was wrong. Unfalsifiable ceremony is precisely the defect the
      stamp exists to close, pointed backwards.
      **The refusal is self-invalidating rather than permanent.** Floors F7 and F8 in the
      generator fail the day it stops being true: F7 fails if `putSignal` is ever called
      from outside the core, and F8 fails if `lib/persistence` ever gains a signals table.
      Either would mean a signal could be normalized by one build and evaluated by another,
      at which point reopen this. Lane: principal-engineer.

- [x] **Change-window currency as a decision fact (intake row 45, the audit's one
      genuine near-term gap).** DONE — the `change-window` family
      (`@workspace/integrations/change-window`), `proof:change-window` (76 checks),
      fused as the `change_window` signal kind via `fromChangeWindow`.
      `change_window` had existed only as a declared flow signal id carrying a
      HEALTH status (`lib/flows/src/factory.ts:26,:94`) — "is the ITSM reachable",
      never "are we inside the approved window right now".
      Four axes, following the shift-context template (derived / trusted / posed)
      plus the caller-posed recency shape: window standing DERIVED from the record's
      bounds at a caller-supplied reference instant, the ITSM's approval state as the
      one trusted allowlisted enum, the named implementer compared only when the
      caller poses the operating actor, and record currency against a caller-supplied
      maximum age. Rejected/cancelled restricts; everything else that fails steps up.
      **The design decision worth recording is the one that was refused.** Change
      integrations conventionally RELAX controls inside a window, and that is a grant
      manufactured from an ITSM row. This family can only raise: the proof asserts it
      by composition, fusing all 576 reachable verdicts alongside an
      already-stepping-up device and confirming none of them lowers the outcome. For
      the same reason `change_class: "emergency"` is carried as evidence for the human
      answering the step-up and never read by the gate — otherwise anyone who can write
      that field can write themselves a pass.
      Placement was checked before building, using the new reachability ratchet:
      `pim-activation` (where the backlog's own text pointed) is proof-only, so the
      work went to `lib/integrations` + `posture-composition`, both of which ship.
      (Re-measured 2026-09-06: after the reachability extractor stopped crediting a
      package named only in a comment (b54be02, 2026-09-05), BOTH `lib/integrations`
      and `posture-composition` are in the unreachable list — the placement rationale
      above rested on the credited-by-prose reading. The code is where it is; the
      claim that both "ship" did not hold when it was written.)
- [ ] **`ReleaseLedger.holds` loses the second hold on the same task (found by the row-48
      second-pass audit; LATENT, not live — record the distinction).** `holds` is
      `Readonly<Record<string, string>>` (`lib/handoff-sim/src/types.ts:137`) — one
      exception per task — and `lib/handoff-sim/src/simulate.ts:134` assigns
      `holdsMap[step.taskRef] = carriedEntry`, which OVERWRITES the entry when a second
      hold-grade exception fires on the same task. A release naming the surviving
      exception then succeeds while the overwritten one is still in
      `unresolvedExceptionRefs`, moving the task held → active with an unresolved hold
      outstanding.
      The type's own comment is what makes this worth recording: `holds` was added
      *after* adversarial review demonstrated the CROSS-task version of exactly this
      hole ("a resolved+verified exception could free ANY held task, including one whose
      own blocker was still open"). The same-task twin was left behind by the fix.
      **Why it is latent rather than live, stated so nobody over-reacts to it:**
      `@workspace/handoff-sim` is not reachable from any shipped artifact — verified with
      `node scripts/check-package-reachability.mjs --why @workspace/handoff-sim`, which
      reports it imported only by the proof harness. The shipped decision plane does not
      consult this ledger; it ANDs over its whole condition set structurally every call.
      And the trace still carries the overwritten entry, so the evidence is not lost even
      in the simulation. Fix shape: `holds` becomes `Record<string, string[]>` (or the
      release check asserts every unresolved entry naming the task, not just the recorded
      one), plus the proof case that reproduces the overwrite. Bundle it with any future
      work that makes handoff-sim reachable rather than shipping a lone repair into a
      package nothing calls. Lane: principal-engineer.

- [x] **Mirror `coreNormalizationVersion` into the Swift models (row 27a follow-through).
      DONE 2026-09-18** — `Decision`, `EvaluateResult` and `EvidenceSnapshot` in
      `native/ios/SignalGridMobile/SignalGridMobileCore/Sources/SignalGridMobileCore/Models.swift`
      each carry an `Int?` (init parameter defaulted to `nil`, so no caller was broken),
      and `DecisionDetailView.swift` renders it as its own row —
      `unstamped (pre-provenance)` when absent, mirroring the web console's
      "Core normalization" row rather than folding provenance into the digest seal.
      The four `MockSignalGridAPI.swift` sites: `result(from:)` and
      `evidenceSnapshot(for:)` COPY THE STAMP THROUGH rather than dropping it (the
      defect `EvidenceFetch`'s own comment records); the two mints pass `nil`
      DELIBERATELY and say why — the mock runs no core, so a number there would be a
      provenance claim about a build that never executed. Checks: `node
      scripts/check-ios-dynamic-type.mjs`, `node scripts/check-ios-policy-defaults.mjs`,
      `node scripts/check-ios-port-sources.mjs`, `node scripts/check-cited-paths.mjs`;
      compilation is verified by ios-ci on the PR (no Swift toolchain in this lane).
      The stamp now rides three TypeScript carriers (`EvidenceSnapshot`, `Decision`,
      `EvaluateResult`) and the `/v1` OpenAPI response, all as an OPTIONAL field. The iOS
      mirror in `native/ios/.../Models.swift` has not been updated: the three structs need
      an `Int?`, with four construction sites in `MockSignalGridAPI.swift` (lines 86, 406,
      478, 515). **Not attempted blind.** No Swift toolchain exists in the cloud lane, so
      an edit here could not be compiled, and `native/ios` is the one tree where an
      uncompiled change is invisible until a human opens Xcode. Left as a recorded gap for
      the Mac lane rather than a plausible-looking patch. It is not urgent: the field is
      optional on every carrier and Swift's decoder ignores unknown keys, so the current
      apps decode the new payload correctly today — they simply cannot yet SHOW the stamp. Lane: mobile-native-engineer.

- [x] **A webhook WRITE route and its validation are one change, not two.**
      Opened as "should `CreateWebhookSchema`/`UpdateWebhookSchema` be `.strict()`?" and
      deferred once as "a breaking client contract change". **Both halves of that framing
      were wrong, and measuring settled it.** There is no client contract to break:
      `artifacts/api-server` exposes only `GET /v1/webhooks` and
      `GET /v1/webhooks/deliveries`, and `createWebhook`/`updateWebhook` have ZERO callers
      anywhere in the repository. And `.strict()` on its own would be decorative, because
      nothing calls `.parse()` on either schema — they are type sources, and a schema
      nobody parses cannot reject anything.
      The live finding underneath is different and worse: both write functions accept a
      typed argument and never validate it, so `url: z.string().url()` is a URL in the
      type system and an arbitrary string at runtime. Nothing untrusted can reach them
      today because the route does not exist; the day it does, whatever the handler passes
      lands in Redis and the delivery path POSTs to the stored `url`. That is the SSRF
      shape, latent behind a missing route rather than behind a check.
      Fix shape, in this order: (1) `CreateWebhookSchema.parse` / `UpdateWebhookSchema.parse`
      at the top of each function — the boundary belongs on the exported function, not in
      one handler; (2) THEN `.strict()` on both, which is load-bearing only once a parse
      exists, and closes the same asymmetry the `uem`/`nac` config schemas were tightened
      for (`secrets` for `secret` → an unsigned webhook; `state` for `status` → a webhook
      that stays enabled; a misspelled `rotateSecret` → a compromised secret still live).
      NOT pre-fixed, on the `lib/dual-control` precedent recorded in
      `check-package-reachability.mjs`: a repair shipped into a path nothing calls is
      proven by a proof and reachable by nothing, and it leaves the next reader believing
      a boundary is defended when the boundary does not exist yet. The trap is marked at
      both call sites and on both schemas instead. Lane: security-engineer.
      **DONE 2026-09-18 (validation half; the ROUTE stays an owner decision).** The premise the
      deferral rested on was re-measured and is false for one of the two functions:
      `createWebhook` has NINE callers (`scripts/src/webhooks-proof.ts` x8,
      `scripts/src/emit-gate-proof.ts` x1), every one casting `as never` — which is exactly
      how a type-system URL becomes a runtime string — and the `url` they store is what the
      delivery path POSTs to. So the boundary is live today and no longer waits on a route:
      `CreateWebhookSchema.parse` / `UpdateWebhookSchema.parse` at the top of each function
      (`lib/integrations/src/integrations/webhooks/store.ts`), THEN `.strict()` on both
      schemas (`./types.ts`) — in that order, for the reason this row gives.
      The ROUTE is left open deliberately, and not for the old reason: `artifacts/api-server`
      serves `GET /v1/webhooks` from `core.listWebhookEndpoints`, which is
      `lib/signalgrid-core`'s webhook store — a DIFFERENT store from this module. A
      `POST /v1/webhooks` over this module would read and write different stores on one path;
      over the core's store it would not reach these functions at all. Which store the write
      surface belongs to, and its launch-profile classification, is a product-surface call for
      the owner, not something to pick while closing a validation row.
      Check: `pnpm run proof:webhooks` 5b-BOUNDARY — ten assertions covering the parse (non-URL,
      empty name, empty events), strictness (`secrets` for `secret`, `state` for `status`,
      misspelled `rotateSecret`), parse-before-lookup, and two positive controls; removing the
      parse fails four, removing `.strict()` fails four others (both verified).

- [x] **Mirror `reconcileDecisions` into Swift (intake row 51 follow-through).
      DONE 2026-09-18** — `native/ios/EnterpriseShell/Services/DecisionContinuity.swift`,
      a new pure-Foundation file AROUND the ports exactly as golden rule 1 requires
      (`SignalContext.swift` pattern; `DecisionEngine.swift` and `AppWorkflows.swift`
      are untouched). It carries the whole reduction: `mostRestrictiveOutcome`, the
      product order `compareProvenance` with absent-stamp-is-UNKNOWN, the caller-posed
      `StandingBound` (no clock is read), the frontier, and the fail-closed veto with
      all five reason codes. `native/ios/EnterpriseShellTests/DecisionContinuityTests.swift` pins
      the same cases `scripts/src/decision-continuity-proof.ts` asserts, including
      order-independence, idempotence and every refusal. Registered in BOTH build
      systems — `native/ios/Package.swift` and `native/ios/project.yml` — and `node
      scripts/check-ios-port-sources.mjs` reports "both build systems compile the same
      11 port sources". STILL OPEN, stated rather than implied: nothing CALLS it yet.
      EnterpriseShell persists no offline decision to reconcile (`DecisionService`
      evaluates fresh every time), so a reconnect call site would be wiring to an empty
      store; that needs a held-decision store with provenance and is a separate row when
      one exists. Compilation and the XCTest run are verified by ios-ci on the PR.
      `lib/signalgrid-core/src/continuity.ts` answers which decision wins when a device
      has been deciding offline, and the device is where an offline decision is actually
      minted — so `EnterpriseShell` should reconcile on reconnect rather than leave it to
      the server alone. Blocked in the cloud lane for the same reason as the
      `coreNormalizationVersion` mirror above: no Swift toolchain, and `native/ios` is the
      one tree where an uncompiled change stays invisible until a human opens Xcode.
      **Golden rule 1 applies:** this goes AROUND `DecisionEngine.swift` in a new file, in
      the `SignalContext.swift` pattern — the port stays byte-faithful, and reconciliation
      is not part of what was ported. Nothing is broken meanwhile: the TS side reconciles
      whatever the device uploads, so the gap is that the device cannot decide locally
      *whether its own held decision still stands* before it reconnects. Lane: mobile-native-engineer.

- [x] **`/v1` arm for decision reconciliation (intake row 51 follow-through). BUILT.**
      `POST /v1/decisions/reconcile` — OpenAPI entry, Postman sample, and API integration
      coverage. The route stores nothing and reads nothing: every record is
      caller-supplied and the reduction is pure, so there is no decision to mint. Two
      properties are the wire layer's own rather than the library's, and both are tested:
      the parser fills NOTHING in (an omitted `evaluatedOffline` is a 400, not an
      "online" — a `?? false` here would be the MCP adapter's defect one layer out), and
      an oversized set is REFUSED rather than truncated, because a dropped record can only
      remove a restriction. See `docs/OFFLINE_FIRST_SYNC_CATALOG.md` §2a. The
      operator-console surface this entry once listed as remaining has SHIPPED
      (`OperatorConsoleSection.tsx` runs the real reconciler in-browser, §2b), and the
      catalog's own backlog table now reads *(nothing open)* for this line — the Swift
      mirror is the only piece left and it is blocked on toolchain, not design.

- [x] **Mobile-app-catalog scanner phase (intake row 33, owner-instructed YELLOW-lane build).
      SCANNER HALF DONE** — hardened build at `scripts/mobile-app-catalog/scan.py`
      (v2.0.0, each fix marked `HARDENED:` against the filed original), proven by
      `proof:mobile-app-catalog` (19 checks) over a committed adversarial fixture
      tree with byte-identical goldens. All five verified defects closed and each
      asserted against the failure the audit reproduced, not the code's
      description: the planted fake JWT under a non-secret key appears in neither
      output while the legitimate bundle id on the same file still surfaces
      (credential-shape filter, not a blanket); the file symlink to outside the
      root is refused loudly with no content read and the directory symlink is
      never traversed (`os.walk(followlinks=False)` + explicit pruning, closing
      the 3.12/3.13 rglob divergence); two runs are byte-identical with no wall
      clock and no absolute path anywhere (a clock exists only if the caller
      passes `--generated-at`); markdown cells are escaped; the oversized fixture
      is recorded `SizeCapExceeded` with content never read. Plus one hardening
      beyond the audit list: a MISSING scan root exits 2 rather than producing an
      empty green report. Registered atomically on all planned surfaces — root +
      scripts package.json, preflight.mjs (its NOTHING-BUT-NODE header amended
      honestly: the proof FAILS, never skips, when python3 is absent),
      review-hub-ci.yml, check-proof-figures, and a `.gitleaks.toml` exact-value
      allowlist for the planted JWT. Lane coordination checked first: no
      mobile-app-catalog work on `SignalGrid_Alpha`, base fully merged.
      **The Watchtower/PR-creating workflow half remains UNWRITTEN and
      owner-gated, unchanged** — everything below stands as the record of what
      that decision is about. ORIGINAL ENTRY:
      The owner's repository scanner is filed verbatim, UNHARDENED, in
      [inspiration/MOBILE_APP_CATALOG_AGENT.md](inspiration/MOBILE_APP_CATALOG_AGENT.md)
      with SHA-256 provenance; the adversarial intake audit VERIFIED (by
      execution) defects the build must fix before any committed run: the
      `BUNDLE_RE` JWT/dotted-secret leak into `identifiers` (which makes the
      emitted `publicSafety.valuesRedacted: true` an overclaim), the
      file-symlink escape, wall-clock + absolute-path non-determinism (two runs
      must become byte-identical), unescaped markdown table cells, and
      unbounded per-file reads. Build content: hardened scanner under
      `scripts/mobile-app-catalog/`, an adversarial fixture tree (DOCTYPE xml
      refused, planted fake JWT never emitted, symlink never followed) with a
      committed golden scoped to the fixtures (never docs/inspiration),
      `proof:mobile-app-catalog` that shells to python3 and FAILS (never
      skips) when python3 is missing, atomic four-surface registration (root +
      scripts package.json, preflight.mjs — amending its Node-only
      self-description honestly — and review-hub-ci.yml) plus `.gitleaks.toml`
      allowlisting for the planted fixture, with Mac-lane coordination first
      (proof registration is a LANE_COORDINATION shared surface). The
      owner-referenced scheduled PR-creating workflow stays UNWRITTEN — it
      would be the repo's first autonomous contents-write surface — unless the
      owner approves it as its own future phase. Online/store/vendor adapters,
      the recorder implementation, and any Postgres deployment stay spec-only.
      Intake row 46 (the Crucix reference) did NOT change that gate, but it did
      specify the design the gate is holding, so the owner's decision is now a
      yes/no on something concrete rather than on a blank: the agent the owner
      calls **Watchtower / Catalog Sentinel** would watch vendor API docs,
      GitHub repositories, OpenAPI specs, platform documentation, AppConfig
      schemas and standards bodies, and its loop is fixed by the owner as
      watch → fetch/parse/hash → compare prior version → classify change →
      score impact → generate an evidence artifact → **open a PR or issue** →
      require review → update the catalog only after merge. Two properties of
      that loop are the whole reason it could ever be safe and must survive
      into any implementation: it never mutates a catalog directly, and it
      never changes product behaviour — a proposal cannot activate itself, the
      same law `@workspace/adaptive-proposals` already enforces. The verified
      caveat from row 46: the referenced architecture (AGPL-3.0, so a
      reference only — never a source to copy, and reciprocity against a
      private core is a human legal question) is prior art for the sweep,
      delta, severity and evidence half ONLY. It opens no pull requests and
      writes to no repository, persisting to a local run directory instead. So
      the contents-write half still has no precedent to point at, and the
      first write surface would be exactly that: first. Sequencing is the
      owner's own — P2/P3, explicitly after the launch wedge.
- [ ] **Per-app managed-configuration RECEIPT as a decision dimension (intake
      row 33, verified candidate gap).** Nothing today can represent "the host
      app actually RECEIVED its managed-configuration payload, current
      version": device-management-health `policyDrift` is device-baseline
      scope, app-update grades the BINARY's channel/version, policy-binding
      grades assignment-and-enforcement — each compression was adversarially
      shown to distort (the checkInFreshness-collapse precedent). A session
      can earn managed_healthy + current_managed + bound_correctly while the
      host app runs on a default or stale AppConfig dictionary. Wire facts
      exist today (Intune Graph mobileAppConfigurations deviceStatuses; Apple
      managed-app config/feedback). Future family rules pinned by the
      verifier: read-only, fixture-first, its own family (never folded into
      the three neighbors), management-plane status anchors the affirmative
      (app self-attestation corroborates or downgrades only), first scope =
      Entra + Intune + the one launch host app. Reference contract shape:
      [inspiration/MOBILE_CONFIG_RECORDER_CONTRACT.md](inspiration/MOBILE_CONFIG_RECORDER_CONTRACT.md)
      — sequenced AFTER normalization-version stamping, and its recorder
      write-plane stays out of the public tree. Lane: endpoint-uem-domain.
- [x] **App Protection / MAM state as a decision dimension (intake row 33,
      verified candidate gap; SIGNAL_SOURCE_CATALOG's own
      "documentation-only roadmap" row).** No lib family models MAM
      (repo-wide grep: zero matches); device-management-health's header
      explicitly scopes the APP channel out; the connector emulator already
      scripts MISSING_MAM_POLICY_SENSITIVE_APP → restrict as an expectation no
      dimension can produce. Wire facts exist (Graph managedAppRegistrations
      appliedPolicies/flaggedReasons per user+device+app). Verifier-pinned
      rules: its own read-only fixture-first family; selective wipe NEVER
      enters the tree (the uem actuator-deletion precedent); unknown/stale
      raises; MAM non-applicability is an asserted positive; the emulator
      expectation and the SIGNAL_SOURCE_CATALOG row status reconcile in the
      same change; Intune App Protection first, other MAM vendors deferred. Lane: endpoint-uem-domain.
      **DONE 2026-09-20** — the `app-protection` family (`@workspace/integrations/app-protection`:
      types/evaluate/connector/mock-transport/index), read-only from birth (the read-only guard
      refuses every non-GET; selective wipe is a documented non-feature), fused as the new
      `app_protection` signal kind via `fromAppProtection`, proven by `proof:app-protection` in
      the breadth lane (deferred family per `launch-profile.mjs`). The management plane anchors
      the affirmative: a sensitive app with no applied policy → restrict (MISSING_MAM_POLICY_SENSITIVE_APP,
      the exact reason the connector emulator scripts, now produced by the real dimension); a
      flagged registration on a sensitive app → restrict; standard/unassessed → step_up; unknown
      or stale → step_up; MAM non-applicability is an asserted positive that grants only on a
      positively clean, current compliance read (`not_applicable` + clean + fresh/unassessed →
      none; `not_applicable` + flagged/unknown/stale → raise, and a flagged registration outranks
      report malformity).
      The proof enumerates every normalized state and every raw wire record and pins how many
      of each grant (the counts are on its `figures=` line, not restated here), and asserts by
      composition that the family can only raise. The
      SIGNAL_SOURCE_CATALOG row flipped out of "Documentation-only roadmap" in the same change;
      the emulator's scripted expectation is left stable and grounded by the proof rather than
      rewritten (its deterministic hash is untouched). How you'd check: `pnpm run proof:app-protection`
      → `summary=pass`.
      FOLLOW-UP before the live path is enabled (Codex P1, review of the fixture-backed
      family): the connector keys a registration lookup by `appRef` only, but a MAM plane
      keys managed-app state per (user, device, app). Thread a worker + device identifier
      through the request and validate them against the returned evidence, so a clean
      registration belonging to another user/device cannot be selected and granted. Deferred
      with the live transport (gated off today); the fixture path evaluates a single supplied
      record, so this is a live-query completeness requirement, not an exploitable path now.
      The modelled dimension is closed by PR #929; the (user, device, app) binding FOLLOW-UP
      above is still OPEN and is tracked as its own unchecked row directly below. The owner's
      2026-09-23 material separating Intune MDM, MAM and UEM (recorded as DR-055, #1026) is the
      requirement this row answers: MAM is its own read-only dimension, apart from
      device-management-health's MDM channel.
- [x] **MAM live path: bind the registration to (user, device, app) before enabling it
      (Codex P1 follow-up to the row above).** DONE 2026-09-25 (cloud lane).
      `AppProtectionRequest` now carries `userRef` + `deviceRef` beside `appRef`
      (`AppProtectionBinding`), `fetchNormalized(appRef, binding, opts)` refuses an unsafe or
      missing binding BEFORE dispatch (`invalid_binding`, transport never called) and refuses
      the RETURNED registration BEFORE normalization unless its own `user_ref` and
      `device_ref` echo the requested worker and device (`binding_mismatch` — absent,
      inherited, throwing, unreadable or differing echoes all refuse; the record never
      reaches the evaluator). The direct normalize path records an unreadable echo as
      malformed. `proof:app-protection` pins each refusal by name (116 checks;
      `mutation-guard --proof=proof:app-protection` survivors=0). The live transport stays
      gated off; this row was what blocked enabling it.

_Derived from repo data, not memory: `check-connector-discipline` reports 51/51 (2026-09-06; it said 36/36 here from 2026-08-21, flagged by the role-lens review the same day and left standing)
families with KNOWN_GAPS empty. The live-evidence status is NOT restated here —
`node scripts/check-live-sync.mjs` prints it (`liveEvidence=fresh|stale|none`), and
this paragraph once said "fresh" while the tool printed STALE, seven manifest
versions behind the artifact it cited (flagged 2026-08-21, corrected 2026-09-06;
`check-live-sync` now fails any doc that restates a status it does not print).
What remains is the LIVE-lane column of
[ZERO_COST_LIVE_TEST_MATRIX.md](ZERO_COST_LIVE_TEST_MATRIX.md) — every dimension
already has a fixture proof; these add a real vendor behind it._

- [x] **Wazuh (perpetual free) → edr-threat connector.** DONE — `proof:live-edr`
      (`f26cb0c`), 16 assertions against a real Wazuh 4.9.0 API. The measured answer
      is the valuable part: Wazuh supplies **5 of 8** `EndpointThreatRaw` fields and
      has no concept at all of `realtimeProtection`, `signatureAgeHours` or
      `threats[]` (it is HIDS/XDR, not signature AV; alerts live in a separate
      indexer). Those three are left ABSENT rather than mapped to something
      cheerful, and the proof pins what the connector does with the silence:
      `realtimeProtection`→`false` (not protected, never assumed on),
      `signatureAgeHours`→`null` (not `0`, which would read as freshly updated),
      verdict `degraded_protection`/`PROTECTION_DEGRADED`/`step_up`. Skipped loudly
      by name, never silently passed, when `WAZUH_URL` is unset.
- [x] **Keycloak 26.4 DPoP → token-binding.** DONE — `proof:live-keycloak` (14 assertions)
      against a real Keycloak 26.4. Its value was exactly what was predicted —
      cross-implementation agreement, not first coverage — and that turned out to be
      worth having: reordering the JWK members when computing the RFC 7638 thumbprint
      yields a COMPLETELY different value, and only a second implementation catches
      it. It also surfaced real integration work an in-process provider hides:
      Keycloak emits no tenant claim, so a deployment needs protocol mappers. See
      [KEYCLOAK_LIVE_INTEGRATION.md](KEYCLOAK_LIVE_INTEGRATION.md). ORIGINAL BELOW.

- [x] **Keycloak (original entry).** LOWER priority than it reads in the
      matrix: `live-idp-proof` already runs a complete real DPoP ceremony (client-held
      EC key, real proof JWT, provider-minted `cnf.jkt` equal to the RFC 7638
      thumbprint, verified through enterprise-auth). Keycloak's value is
      cross-implementation agreement, not first coverage.
- [x] **Graph posture over a real socket.** DONE — `proof:graph-wire` (`d0958a2`),
      11 assertions. Achieved with a local `http.Server` rather than Dev Proxy: same
      end (Graph-authentic 429 / 5xx / 401 / 403 / malformed bodies / paging over a
      genuine socket, real status codes, real chunked JSON) with no new external
      dependency, so it runs in CI unattended. Every error path fails closed —
      429/5xx→`upstream_error`, 401/403→`auth_failed` (distinguished), unparseable
      JSON and a collection with no `value` array→`bad_response` rather than being
      read as zero devices.
      **This is what surfaced the pagination defect below:** the cap holds (it must —
      it is a loop/DoS guard) but a capped read returns a bare array, so the caller
      cannot tell it from a complete one. Dev Proxy remains optional upside for
      Graph-specific throttling *semantics* (e.g. honouring `Retry-After`), which the
      connector deliberately does not implement today.
- [x] **Fleet Free + osquery → telemetry/fleetdm.ts.** DONE — `proof:live-fleet`,
      30 assertions against a real Fleet 4.89.2. This lane paid for the whole matrix:
      the adapter was documented as running "verbatim, zero shim code", and in fact
      **every host- and policy-level route in it 404'd**. Wrong global-policies path,
      a UUID passed to a numeric-id route, a `{host}` envelope cast away as a bare
      host (so every field was `undefined` while typechecking cleanly), a
      host-policies endpoint that does not exist, three wrong field names, and a
      live-query body Fleet rejects 400. All fixed and pinned.
      The trap worth remembering: `testConnection()` returned "Successfully connected
      to FleetDM" throughout — a health check that could not detect a completely
      non-functional integration. The adapter did fail CLOSED (no fabricated
      compliance), and that property is now asserted rather than assumed.
      Note the image is amd64-only; Docker Desktop emulates it on Apple Silicon, so
      the earlier from-source arm64 build is no longer needed.

- [x] **Fleet live-query results (websocket campaign collector). BUILT** — and verified
      against a REAL Fleet with a real enrolled `osqueryd`, in the cloud lane's own
      container (see `docs/FLEET_LIVE_INTEGRATION.md`, "Cloud-lane run, 2026-08-17").
      `runQuery()` POSTs the correct campaign body and collects per-host rows over
      `/api/v1/fleet/results/websocket` using Node's built-in WebSocket client (no new
      dependency, no lockfile change), with the result-collection policy this row asked
      for: bounded window (`opts.timeoutMs`, default 15s), per-host errors carried, and
      an early close returning what arrived flagged `partial: true` — a partial
      measurement reported as partial, never as the whole. The approval gate this row
      required exists and is its own refusal, not a synonym for the tier gate:
      `SIGNALGRID_ALLOW_LIVE_QUERY=true` is demanded IN ADDITION to the `isEnabled()`
      chokepoint and an explicit non-empty host list (a fleet-wide broadcast is refused,
      never implied). `proof:live-fleet` pins each gate from its own side — approval
      absent in a fully live tier refuses; approval present in dev tier still refuses;
      empty host list refuses — and then collects a real campaign end-to-end (rows from
      the live agent's `osquery_info`, attributed to the right host, `partial: false`).
      `scripts/check-ungated-fetch.mjs` was widened in the same change so `new
      WebSocket…(` counts as an outbound call site, mutation-tested by removing the
      collector's guard and watching the gate go red.
- [x] **Traccar → location-services.** DONE — `proof:live-location` (22 assertions)
      against a real Traccar 6.14.5, positions ingested over its genuine OsmAnd
      protocol. This connector has no hardcoded paths, so the lane found something
      else: Traccar's `geofenceIds: null` is AMBIGUOUS — it means both "outside every
      geofence" AND "no geofence is linked to this device". Proven live rather than
      argued: the SAME coordinates return `[1]` while linked and `null` after
      unlinking, from a device that never moved.
      The obvious `null → outside` mapping would report a device sitting at HQ centre
      as off-premises the moment someone unlinks a geofence, and `evaluateLocation`
      turns that into `OUTSIDE_AUTHORIZED_GEOFENCE`/`locate` — a config change
      becoming a location signal. The proof asserts that failure explicitly and pins
      the honest mapping, which needs a second call (`/api/geofences?deviceId=N`).
      Usually this repo catches absence graded as GOOD; here it would be graded BAD.
      Same mistake — reporting a measurement never taken.
      See [TRACCAR_LIVE_INTEGRATION.md](TRACCAR_LIVE_INTEGRATION.md). Does NOT cover
      rtls-custody: Traccar is outdoor GPS, not indoor RTLS.

- [ ] **Android: AMAPI Colab + Test DPC on an emulator** — managed/kiosk custody
      without hardware. Needs the Android SDK on the machine. Lane: mobile-native-engineer.
      **MEASURED, STILL OPEN 2026-09-18 (cloud lane, native pass):** there is no
      source-level half to do — the row asks for a RIG (Google's AMAPI Colab driving a
      policy onto Test DPC on an emulator), not for Kotlin, and `native/android/core` is
      pure Assist vocabulary and wire parsing that neither reads nor needs a management
      policy; inventing a managed-config reader here ahead of the rig would be the
      unfalsifiable ceremony this repo refuses. The emulator and the Android SDK are the
      whole row.

Not free, stated so the absence is deliberate rather than forgotten: identity-risk
and pim-activation have NO permanent free path (Entra P2 / Governance trial windows
only), and the DDM rig is gated on an APNs push certificate.

- [ ] **Three decided deletions, opened as a row so the Mac can execute them (org self-evaluation 2026-09-12, item 9; `docs/agent/LOOP.md` puts tracked-file deletion on the Mac lane). Lane: `mac-lane-steward` — one PR, the gate fixtures below adjusted in the same commit. Nothing is deleted by the row.** Decided 2026-09-05 and never given a row. Each path re-verified 2026-09-12 (what references it, its last commit, whether any gate reads it):
      1. `tests/load/` — `tests/load/location-report.js`, `tests/load/session-start.js`, `tests/load/webhooks.js` (`git ls-files tests/load | wc -l` → 3). Last commit `4b50c4d9` 2026-09-05 (predicates made 2xx-only, receiver required). Invoked by nothing: `scripts/check-test-execution.mjs:46` says so in its own header and deliberately does not pattern-match them; they drive `/api/session/start` and `/api/location/report`, routes this api-server never served (`docs/COMPANY_BUILD_PLAN.md` row 43), and `pnpm run test:load` already covers the served `/v1` surface. To adjust: the `tests` row in `docs/agent/SURFACE_REVIEW_COVERAGE.json` (removing the last subtree removes `tests/` itself, and `scripts/check-surface-review-coverage.mjs` fails a row whose path is gone — drop the row, regenerate with `--write` on a clean index, commit that separately); the `tests/load/**` surface glob in `docs/agent/org-roster.json` (performance-engineer); the `tests` paths-ignore comment in `.github/codeql/codeql-config.yml`; `README.md:60` (an owner-reserved surface — its "the k6 load tests" clause) with the matching evidence text in `docs/agent/CLAIM_INVENTORY.json`; and every backticked `tests/load/…` citation that `scripts/check-cited-paths.mjs` gates in `docs/COMPANY_BUILD_PLAN.md`, `docs/agent/SURFACE_REVIEW_COVERAGE.md`, `docs/CLAIM_INVENTORY.md`, `docs/agent/LOOP.md` and `docs/agent/EVIDENCE.md` — rewritten as history (unbackticked) or the gate fails on the first missing path.
      2. `.agents/agent_assets_metadata.toml` — 350 bytes: two `[[generated]]` entries naming artifacts/signalgrid-web/src/assets/architecture.png and decision-flow.png, neither ever tracked (`git ls-files | grep -i architecture.png` → empty). Last commit `c95b97ac` 2026-07-17. No script, workflow or gate reads it (`git grep -l agent_assets_metadata -- '*.mjs' '*.yml' '*.ts'` → nothing). To adjust: the `.agents/**` surface lines in `docs/agent/org-roster.json` (agent-platform-engineer), `docs/agent/agent-tiers.json` and `.claude/agents/agent-platform-steward.md`; the `.agents` row in `docs/agent/SURFACE_REVIEW_COVERAGE.json`; the row-73 bullet in `docs/COMPANY_BUILD_PLAN.md`.
      3. `site/index.html` — the pre-SPA landing page, 37 KB, NOT served: `.github/workflows/pages.yml:88` copies `artifacts/signalgrid-web/dist/public/` to the site root and takes only `site/CNAME` from that directory (`:117`). Last commit `29e29f73` 2026-09-05 (bannered superseded/not-served, put inside the launch-claims scan). Gates that read it: `scripts/check-product-framing.mjs:59` names it (a missing file is skipped at `:164` — delete the entry anyway, so the list is not a fossil); `scripts/check-launch-claims.mjs:166` derives `site/*.html` from `git ls-files` (an empty set is fine; the derivation stays); `scripts/check-repo-links.mjs:64` and `scripts/review-invariants.mjs:659` glob the directory (nothing to change). The `site` row in `docs/agent/SURFACE_REVIEW_COVERAGE.json` stays — `site/CNAME` remains and pages.yml pins the custom domain from it — but its open count closes; backticked citations in `docs/agent/LOOP.md` and `docs/agent/EVIDENCE.md` become history.
      Done = the three paths absent from `git ls-files`; `node scripts/check-cited-paths.mjs`, `node scripts/check-surface-review-coverage.mjs`, `node scripts/check-product-framing.mjs`, `node scripts/check-launch-claims.mjs`, `node scripts/check-org-roster.mjs` and `node scripts/check-claim-inventory-anchors.mjs` green on the deleting commit, last lines quoted in `docs/agent/EVIDENCE.md`.

## Next

### The post-decision cascade — the six stages DR-042 measured against the tree

Added 2026-09-12 from the founder's thesis statement (DR-042; quoted in full in
`docs/WHY_THIS_EXISTS.md`). His sentence describes what happens AFTER a verdict:
*"then if X process breaks then the solution can self resolve and notify the proper
protocol and teams that are assign to that resource and monitor the fix or jump in
and resolve problem and it will kick off tickets and change management while
notification for users affected."* The audit behind DR-042 found the two ends
built — the resolution planner and the incident playbook on one side, the gated
vendor emitters on the other — and **the joins between them missing**. These six
items are those joins, and nothing else. Each is fail-closed by construction (an
unknown or unreachable downstream REFUSES and says so; it never pretends), each is
deterministic (no wall clock in a decision path; every reference instant is
caller-supplied), and each names the clause of his sentence it serves.

- [x] **Cascade join 1 — the ticket actually opens: a fail-closed ITSM dispatch seam.**
      CLOSED 2026-09-25 (cloud lane): PR #819 merged on 2026-09-23 (a4422472), so
      `lib/incident-playbook/src/dispatch.ts` — `incidentToTicketRequest`, `dispatchIncident`,
      `ITSM_DISPATCH_REFUSALS`, `proof:itsm-dispatch` — is on mainline and the row's own
      closing condition below is met. `origin/claude/build-itsm-dispatch-seam` (the second,
      never-opened seam) is superseded and stays on the prune list.
      Serves *"it will kick off tickets"*. Both halves exist and nothing joins them:
      `lib/incident-playbook` turns a composed posture or a detection into a properly
      prioritized `Incident` (priority = impact × urgency on the ServiceNow matrix, an
      SLA per priority, an assignment group, an escalation flag, a correlation id,
      ranked drivers) and is pure; `lib/integrations/src/integrations/itsm` holds eight
      vendor adapters behind a live-call gate. There is no code path from one to the
      other, and no `/v1` route asks for a ticket. Build a pure mapper from `Incident`
      to the adapters' ticket-request shape, plus a dispatch seam that goes through the
      existing emission gate — so in this tree the resolved mode is always fixture and
      the result says so. **Fail-closed:** an unknown vendor, an absent credential or an
      unreachable backend REFUSES with a named reason and leaves the incident open; a
      fabricated ticket id and a 2xx-shaped non-answer are both failures (the family
      already exports its 2xx-shape refusal reasons for exactly this). **Deterministic:**
      no wall clock — the correlation id derives from the decision id, as the playbook's
      already does. Proof: the mapper's full priority × category matrix, and one refusal
      per refusal reason. Lane: itsm-ops-domain.
      **STILL OPEN, and deliberately not built twice (2026-09-18):** PR #819
      (`origin/claude/itsm-dispatch-v2`) already implements this row in full —
      a `dispatch.ts` in `lib/incident-playbook/src/` (path deliberately not backticked as a
      citation — it does not exist on mainline yet) with `incidentToTicketRequest`,
      `dispatchIncident`, `ITSM_DISPATCH_REFUSALS` and `proof:itsm-dispatch` — and it is
      unmerged, so a second seam on mainline would fork the join rather than close it.
      `proof:decision-cascade` (join 6) therefore asserts the ticket hop through the
      durable queue instead, which is the property that holds either way; when #819 lands,
      `dispatchIncident` becomes the sender behind that hop and nothing in the cascade
      proof moves. This row closes when #819 merges.

- [x] **Cascade join 2 — a change record is OPENED, not only read.** *(2026-09-17 —
      `lib/integrations/src/integrations/itsm/change-draft.ts`, `proof:change-draft`
      42/42 with a 3/3 self-test. It landed in `itsm/` rather than `change-window/`
      because that family's own header forbids it a write path in any form — reading
      the change plane and opening a change record are different acts, so the draft
      goes out through the outbound family's gate and the read-only family stays
      read-only. `draftChangeRequest` cannot receive a `changeClass` at all — it is a
      separate `withChangeClass` step — so the field this family refuses to grade
      never reaches a branch that could grade it. The relax defect was planted to
      check the proof can fail: an approved window dropping the approval-required
      steps turns three independent checks red.)*
      Serves *"and change management"*. The fabric today reads the change plane and
      never writes to it: `lib/integrations/src/integrations/change-window` grades
      whether a change-class operation is happening inside a window the organization
      approved, by the implementer the record names. Nothing anywhere drafts a change
      record. Build a change-request DRAFT derived from the resolution plan — what would
      change, on which target, why, and which reason codes it would clear — emitted
      through the same gate as the ticket seam. **Fail-closed:** the draft is
      `requires_approval` and simulated, exactly as `proposeRemediation` already is; an
      absent or unreachable change plane means *no change record exists*, which can
      never itself authorize the change. **The trap this must not walk into** is already
      written down in that family's own header: a change window may never RELAX a
      control, and `change_class` (standard / normal / emergency) is carried as evidence
      and never graded — a draft that inherits those rules keeps them, and one that
      quietly loosens them is the defect. Lane: itsm-ops-domain.

- [x] **Cascade join 3 — the people affected are told through a channel they already use.** *(2026-09-17,
      PR #796 — `lib/signalgrid-core/src/notification.ts`, `proof:affected-audience` 30/30.
      The constraint turned out to BE the design: PURPOSE.md §3 forbids SignalGrid any
      surface a worker must go and read, so this derives the audience and routes each
      person on a channel they ALREADY use, then hands off — it ships no transport, and
      cannot. Silence is never an outcome (four separate ways of resolving nobody all
      route to the named owner, `backstop: true`) and silence is never reported as told
      (`delivered` requires a host AND an instant; a blank either is refused back to
      undelivered). Falsified three ways at 27/30 each. The load-bearing negative: an
      area nobody supplied matches NOTHING — the widest audience is the wrong failure
      for a notification path, and it is what a helpful default would produce.)*
      Serves *"while notification for users affected"*. `pnpm run check:absence "affected
      user notification"` returned CORROBORATED across all four probes on 2026-09-12:
      nothing in the tree notifies an affected person. The constraint that shapes the
      build is `docs/PURPOSE.md` §3 and golden rule 3 — **SignalGrid may not add a
      surface the worker has to go and read**, so a SignalGrid notification app or a
      SignalGrid inbox is not the answer and never will be. Build an audience derivation
      (who else holds a device, a session or an assignment inside the affected scope —
      the department, area, room or equipment the grant was scoped to) plus a routing
      decision over the `ResolutionChannel` values that already exist in
      `lib/signalgrid-core/src/types.ts`, with delivery delegated to the host app or the
      organization's own communications system. **Fail-closed:** an audience that cannot
      be resolved routes to the named OWNER rather than to nobody, and a delivery that
      cannot be made is recorded as undelivered — silence is never reported as told.
      **Deterministic:** the audience is derived from evidence the decision already
      carries, never from a live directory query inside the decision path. Lane: principal-engineer.

- [x] **Cascade join 4 — monitor the fix: a post-execution verifier for the resolution path.** *(2026-09-17 —
      Serves *"and monitor the fix or jump in and resolve problem"*. What exists is
      narrower than the sentence: `simulateResolution` PREVIEWS the outcome after the
      resolvable fixes are applied, exception release lifts a restriction when the
      condition is observed to clear rather than on a timer, and decision continuity
      settles which verdict wins after a partition. Nothing observes whether a requested
      remediation actually landed —
      `docs/SIGNALGRID_CLOUD_PLATFORM_AND_CYBER_RESILIENCE_ARCHITECTURE.md` §9 says so in
      its own words. Build a record that pairs a requested remediation with the next real
      evidence read for the same subject and derives `cleared` / `not_cleared` /
      `unobserved` against a caller-supplied reference instant. **Fail-closed:**
      `unobserved` is not `cleared` — an unobserved fix keeps the restriction in place
      and escalates on the second miss, which is the *"or jump in"* half of his sentence.
      **Deterministic:** no clock; the reference instant is an argument, as it is on every
      recency axis in `lib/integrations`. Lane: principal-engineer.
      **DONE:** `lib/signalgrid-core/src/verification.ts` — `verifyRemediation`,
      `restrictionHolds`, `needsIntervention`. It consumes the `RemediationAction`
      `proposeRemediation` already mints rather than inventing a parallel request type.
      Two fail-closed arms beyond the row's own ask: a remediation nobody APPROVED reads
      `unobserved` regardless of the evidence (nothing executes here, so an unapproved
      action had nothing to observe, and a coincidental improvement must not close a fix
      never carried out), and `dismissed` holds the restriction but never escalates —
      a person already ruled on it. How you'd check: `pnpm run
      proof:remediation-verification` → `51/51`, `summary=pass`,
      `figures=assertions=51,states=3,inadmissibleShapes=8,failClosedArms=7`.
      FALSIFIED by three planted defects (`restrictionHolds` as `state === "not_cleared"`
      → 5 fail; approval checked after the evidence → 5 fail; unparseable instant coerced
      to `0` → 2 fail). The third run corrected the proof itself: a self-test asserted on
      a case the defect could not reach and passed WITH it planted.)

- [x] **Cascade join 5 — a durable outbound queue for the cascade emitters.**
      Serves *"notify the proper protocol and teams that are assign to that resource"*.
      The retry, backoff-with-jitter and dead-letter shapes exist
      (`lib/integrations/src/integrations/webhooks/retry.ts`, `dispatch.ts`, `store.ts`,
      and the deterministic model in `lib/signalgrid-core/src/webhooks.ts` whose backoff
      schedule is recorded and never awaited), but they are per-emitter and the store is
      Redis-or-memory. A cascade that spans a ticket, a change draft and an audience
      notification needs one queue with one dead-letter view, so a failure to notify is
      visible in the same place as a failure to ticket. **Fail-closed:** an unreachable
      backend leaves the item QUEUED and reports it; a dead-letter entry is a visible
      failure and never a silent drop, and a pending item never counts as delivered.
      **Deterministic:** the backoff schedule is computed and recorded; any path a proof
      drives never awaits it. No broker dependency — the point is one durable view, not
      Kafka. Lane: sre.
      **DONE 2026-09-18** — `lib/signalgrid-core/src/outbound-queue.ts`: one queue over four
      channels (`ticket` / `change_draft` / `notice` / `suspend`), one dead-letter view,
      one summary. Pure and clockless — the id is a digest of the request, the backoff is
      computed and recorded (1s, 2s, 4s) and nothing awaits it. Three fail-closed arms the
      row did not ask for by name and the design needed: a claimed success with a BLANK
      receipt is a refusal (the 2xx-shaped non-answer is the only failure that looks like
      the good outcome); a terminal row is never re-graded by a late answer, so a second
      "ok" cannot resurrect something already dead-lettered; and `allDelivered` is FALSE
      for an empty queue, because `[].every()` answering true is the vacuous pass this
      repository has been bitten by before. How you'd check: `pnpm run
      proof:decision-cascade` → `summary=pass (92/92)`, hops 4–6.

- [x] **Cascade join 6 — `proof:decision-cascade`: the whole chain, and every refusal in it.**
      Serves the sentence end to end. Each stage above will land with its own proof; what
      none of them covers is the chain, and the chain is the product claim — CLAUDE.md's
      *"a decision is the trigger for a cascade, not the end of it."* Build one proof that
      walks a fixture from a non-allow decision through plan → resolution path → incident
      → (gated) ticket request → change draft → audience routing → verification, and
      asserts at every hop that the fail-closed arm is reachable: an unreachable ITSM
      leaves the incident open, an unresolvable audience reaches the owner, an unobserved
      fix keeps the restriction. **It must fail without the fix** — a cascade proof that
      passes on a tree with the joins removed is a restatement, not a proof — and it
      registers in `package.json` as a `proof:*` script so the Mac harness enumerates it
      automatically. Lane: devex-tooling-engineer.
      **DONE 2026-09-18** — `scripts/src/decision-cascade-proof.ts`, registered in
      `package.json`, `scripts/package.json`, `scripts/preflight.mjs`,
      `.github/workflows/review-hub-ci.yml` and the figure guard's PROOFS registry. It
      walks a `restrict` fixture through plan → resolution path → incident → queued ticket
      request → change draft → audience routing → verification, then through the puck
      lifecycle (attached → session → removed → suspend requested → suspend verified), and
      asserts the fail-closed arm at each hop. IT FAILS WITHOUT THE FIX: `cascadeGaps()`
      grades a cascade record for missing hops and the self-test drives it against records
      with each of eight joins REMOVED — plus a vacuity control, since an `allow` has no
      cascade and must not be graded as a broken one. The ticket hop deliberately does NOT
      import PR #819's `dispatchIncident` (not on mainline): it asserts the property that
      survives either way — an unreachable backend leaves the request QUEUED, then
      dead-letters it, and the incident stays open. How you'd check: `pnpm run
      proof:decision-cascade` → `summary=pass (92/92)`, `--self-test` for the nine planted
      defects alone.

**Proposed join order (cloud lane note, 2026-09-12):** join 1 first, because ITSM dispatch has the shortest path to an existing consumer (`lib/incident-playbook`) and gives every later join something real to hang off; join 5 second, so joins 2–4 emit through the one durable queue from the start instead of being retrofitted onto it; join 2 third, because it reuses join 1's gate-and-mapper shape almost verbatim; join 3 fourth, because it has no dependency on the ITSM or change planes and can proceed once the queue exists; join 4 fifth, because a post-execution verifier needs a remediation already dispatched by joins 1–3 to have anything to observe; join 6 last, because a chain proof written before every join lands cannot fail without the fix, which is the one property it exists to have.

### The session puck's software half — DR-043 (hardware-free, fail-closed)

Added 2026-09-12 from the owner's research document *"Shared-Device Authentication
Puck: Hardware and Form-Factor Concept"* (DR-043; substance in
[`docs/SESSION_PUCK_HARDWARE_HYPOTHESIS.md`](SESSION_PUCK_HARDWARE_HYPOTHESIS.md)). The
hardware is a hypothesis behind the discovery gates and none of it moves here. These
five items are the half that needs no hardware at all — a fixture-backed signal
domain, a cascade rule, audit vocabulary, a simulator scenario and the gate itself —
each fail-closed by construction (an unknown attach state raises assurance and never
grants; a missing downstream refuses and says so) and deterministic (no wall clock in
a decision path; every reference instant caller-supplied). Dock and custody inputs
remain a deferred family in the launch profile: building is not claiming, and every
item below is a design target until its proof is green and named.

- [x] **Puck 1 — a dock/attach signal domain: `attached` | `removed` | `unknown`, fixture-backed, with a proof.**
      The change: a connector-style input in the deferred dock/custody family that
      normalizes a receiver's attach record (credential identifier, device identifier,
      observed-at, the receiver's own identity) into one of three states, beside the
      existing `badge_binding` dimension
      ([`lib/signalgrid-core/src/dock.ts`](../lib/signalgrid-core/src/dock.ts)) rather
      than replacing it — the badge read answers *who is bound*, this answers *is the
      credential physically seated*. Any wire value outside the two positive states, an
      unparseable record, a missing receiver identity or an observation older than the
      caller's bound is `unknown`. **Fail-closed:** `unknown` is at least `step_up` and
      is never a grant — deliberately stricter than the sibling `badgeBinding` and
      `dockState` fixtures, which pin `unknown` to `allow` under the day-one-quiet
      pattern ([`lib/signalgrid-core/src/seed.ts`](../lib/signalgrid-core/src/seed.ts)
      lines 480 and 484); the proof must pin the divergence, not inherit the sibling
      rule; `attached` alone grants nothing — it is one axis, and identity
      and posture must each positively confirm. **Deterministic:** the freshness bound
      and the reference instant are arguments. If this adds a signal kind, a connector
      directory or an API path, the same PR classifies it **deferred** in
      `scripts/launch-profile.mjs` under DR-043's authority, or
      `scripts/check-launch-profile.mjs` fails on silent omission — which is the check
      that would fail without it. The proof pins exactly one attach state as
      non-raising and sweeps every other combination; it fails on a tree where
      `unknown` is treated as `attached`. Cloud lane. Lane: principal-engineer.
      **DONE 2026-09-18** — `lib/signalgrid-core/src/attach.ts`: `normalizeAttachRecord`
      is pure and total (an unreadable record is an ANSWER, not an exception the cascade
      must survive) and resolves to `unknown` on a wire value outside the two positive
      states, an unparseable or absent instant, a MISSING RECEIVER IDENTITY — an anonymous
      assertion that a credential is seated is exactly the assertion an attacker would
      like to make — an observation older than the caller's bound, and one from the
      future. `unknown` is `step_up` and never a grant, and the proof PINS the divergence
      from `badgeBinding`/`dockState`, which pin `unknown` to `allow` in `seed.ts`:
      inheriting the sibling rule is the silent, plausible mistake here. `attached` alone
      grants nothing — with identity unconfirmed it is `step_up`. NO signal kind,
      connector directory or API path was added, so `scripts/check-launch-profile.mjs` has
      nothing to classify; the row's own condition is written as an if, and it does not
      fire. How you'd check: `pnpm run proof:decision-cascade` → hop 8 and the matrix.

- [x] **Puck 2 — removal → suspend, as a rule in the post-decision cascade (joins DR-042's six joins; adds no seventh).**
      The change: the `removed` transition on a live session is a cascade input that
      requests suspension through the same seam the six cascade-join items above build
      — the resolution path, the audience routing of join 3 (the host app is told,
      never the worker through a SignalGrid surface), and the post-execution verifier of
      join 4, which records `cleared` / `not_cleared` / `unobserved` for the suspend
      exactly as it does for a remediation. It lands as a hop inside
      `proof:decision-cascade` (join 6), not as its own proof: the cascade proof walks
      `attached → session → removed → suspend requested → suspend verified` and asserts
      the fail-closed arm at each hop. **Fail-closed:** an unobserved suspend is not a
      suspended session — the restriction stays and the second miss escalates; a forced
      or torn removal is `deny`, as the `badge_binding` rule already says; a re-dock
      within N seconds resumes only after a full re-evaluation, never silently.
      **Deterministic:** N is policy, the instants are arguments. The check that fails
      without it: join 6's proof on a tree where a `removed` transition leaves the
      session open. Deferred family; design target. Cloud lane. Lane: principal-engineer.
      **DONE 2026-09-18** — `requestSessionSuspend` in the same file mints the SAME
      `RemediationAction` the rest of the cascade carries (approval-required,
      simulated-only, no executed status), so `verifyRemediation` grades the suspend
      exactly as it grades a remediation: unobserved is NOT a suspended session, the
      restriction holds, and the second miss escalates. It adds no seventh join; it lands
      as hop 8 of `proof:decision-cascade`, as the row asked. `request_session_suspend` is
      a new `RemediationKind` rather than a reuse of `request_custody_check` — a custody
      check asks somebody to go and look, a suspend asks the host app to stop a session,
      and folding them together would have made "did the suspend land" unanswerable.
      `redockWithinWindow` answers only whether a re-dock was quick, and `puckVerdict`
      with `redockPendingReevaluation` is `step_up` however quick it was.

- [x] **Puck 3 — the puck lifecycle's audit events, in the Decision Envelope's ledger vocabulary.**
      The change: extend `AuditEventType` in
      [`lib/signalgrid-core/src/types.ts`](../lib/signalgrid-core/src/types.ts) (today six
      members: `decision.evaluated`, `connector.synced`, `policy.version_activated`,
      `evidence.captured`, `remediation.requested`, `remediation.approved`) with the
      eight the document's nine-event chain needs and the ledger cannot yet name —
      `credential.presented`, `dock.attached`, `identity.authenticated`,
      `posture.observed`, `session.opened`, `dock.removed`, `session.suspended`,
      `credential.revoked` — each carried in the tamper-evident chain with the
      envelope field it evidences, and each recording what the system knew at that
      instant, never rewritten afterwards. **Fail-closed:** an event with no
      `decisionId` or no subject is refused, not recorded blank. **Deterministic:** the
      chain digest is over the canonical body, as it is today. The check that fails
      without it: the audit proof's event-type census, which must count 14 and must
      refuse a fifteenth that is not in the union; and `proof:decision-cascade`, whose
      suspend hop asserts a `session.suspended` event exists in the chain. Design
      target; no shipped-audit claim moves. Cloud lane. Lane: principal-engineer.
      **DONE 2026-09-18** — `AuditEventType` is now DERIVED from a runtime array
      (`AUDIT_EVENT_TYPES`, 14 members) in `lib/signalgrid-core/src/types.ts`, because a
      bare type union is erased at runtime: nothing could count it and nothing could
      refuse a string outside it, so a caller could append `session.hijacked` and the
      ledger would record it tamper-evidently as a member of a vocabulary it is not in.
      `appendAudit` is the one writer into the chain and now refuses there — an unknown
      type, a blank subject, and a puck-lifecycle event with no `decisionId` — and a
      refused event consumes no sequence number and leaves no blank row. The decision id
      rides in `references` rather than in the digested body on purpose: adding a field to
      the canonical body would move every committed event's digest. The original six keep
      their old admission rule. How you'd check: `pnpm run proof:signalgrid-core` →
      `509` assertions including the 14-type census and the fifteenth's refusal; `pnpm run
      proof:decision-cascade` hop 8 asserts a `session.suspended` event is in the chain.

- [x] **Puck 4 — a simulator scenario: dock, session, undock, re-dock within N seconds, with the policy matrix as rows.**
      The change: one scenario in
      [`lib/signalgrid-simulator/src/scenarios.ts`](../lib/signalgrid-simulator/src/scenarios.ts)
      beside the existing `dock.device_undocked` signal, whose steps are the document's
      situation table on this tree's verdict ladder: known worker + compliant device +
      docked → `allow`; higher-risk app → `step_up`; removed → `restrict`, forced →
      `deny`; re-dock within N → resume after re-evaluation; walked away, puck seated →
      inactivity lock; **radio says gone, puck seated → do not assume gone**; lost or
      revoked puck → `deny`; **legacy 125 kHz read for a strong-enrolled worker →
      `deny`** (the downgrade rule); attach state `unknown` → `step_up`. Every branch is
      fixture-only — the note on the scenario says so, as every scenario's
      `safeDemoNote` already does. **Fail-closed:** the scenario's expected outcomes
      include no grant on any branch where a single axis is unknown. **Deterministic:**
      N and the instants are scenario data. The check that fails without it:
      `proof:signalgrid-simulator`, which enumerates scenarios and asserts each
      expected outcome; and the iOS parity rule (golden rule 1) — the scenario is added
      to the TS simulator and the Swift port's fixture set together, or the parity
      proof drifts. Design target; deferred family. Cloud lane for the TS half, Mac lane
      for the Swift twin. Lane: qa-engineer.
      **DONE 2026-09-18** — the scenario is `puck-session-lifecycle` in
      `lib/signalgrid-simulator/src/scenarios.ts` (dock → session → undock → re-dock at
      12s, resolving to `step_up` + the custody cascade, never `allow`, because the only
      posture read on file predates the removal). The POLICY MATRIX is eleven rows in
      `proof:decision-cascade` over `puckVerdict`, not in the simulator: the simulator's
      engine is a byte-faithful twin of the Swift port (golden rule 1) and must not grow
      branches, and it cannot emit `deny` at all. Two rows are argued in the code rather
      than left to be discovered — a legacy 125 kHz read for a strong-enrolled worker is
      `deny` and not `step_up` (stepping up asks the attacker to try again), and "radio
      says gone, puck seated" is `step_up`: not `allow`, because an unknown raises, and
      not `restrict`, because a dropped packet must not end a live session. NO Swift twin
      was needed: no scenario id is mirrored in `native/ios/` (verified by grep), so the
      parity rule has nothing to drift. How you'd check: `pnpm run
      proof:signalgrid-simulator` → `102/102`, 15 scenarios.

- [x] **Puck 5 — the hardware gate itself: a tally column in `docs/agent/DISCOVERY_LOG.md` that the go/no-go table reads from.**
      LANDED — `scripts/check-discovery-log.mjs` derives Rh/Ch/Ph from the Running tally's marks (canonical `X` only; any other nonempty value fails), enforces the base-mark invariant, and cross-checks `docs/SESSION_PUCK_HARDWARE_HYPOTHESIS.md`'s go/no-go table by name; 26/26 self-test, wired into preflight and CI (today's honest tally: 0 of 15 on Rh/Ch/Ph, per `docs/agent/EVIDENCE.md`).
      The change: the *Running tally* table gains a column **Rh** — a REQUIREMENT that
      maps specifically to faster or stronger physical session authentication or
      custody binding — beside R, so the hardware rows of the go/no-go table in
      `docs/SESSION_PUCK_HARDWARE_HYPOTHESIS.md` read a number that exists rather than a
      feeling. The gate stays the pre-registered one (≥ 4 of 15 Rh → bench prototype;
      ≥ 3 COMMITMENT → design-partner MVP; ≥ 5 PROBLEM with 0 COMMITMENT → no-go); this
      adds the column, not a threshold. The check that fails without it: a hardware
      authorization anywhere in the tree that cites no tally row — the same
      claim-must-quote-output rule `CLAUDE.md` applies to every number — and, once the
      column exists, `node scripts/check-readiness-figure.mjs` continues to derive the
      outreach figure independently of it (DR-036); neither number is typed. Nothing
      here builds hardware; the tally reads *0 of 15, 0 commitments* today. Design
      target for the hardware; deferred throughout. Cloud lane. Lane: icp-customer-research.

**Added 2026-09-24 under DR-055** — the owner's 2026-09-23 flow (C1–C7), recorded as a
refinement of this hypothesis, not a product (the component map and the new policy rows are in
the hypothesis page's *Owner refinement (2026-09-23, DR-055)* section). Four more hardware-free
rows, on the same terms as Puck 1–5: fixture-first, fail-closed, deterministic, a deferred
family, one PR each with its proof, and no hardware. A row that changes a verdict the decision
core returns (Puck 6, Puck 8, Puck 9) carries its own proposal record in its PR — the DR-051
pattern — and the owner approves it by merging.

- [ ] **Puck 6 — bind the existing `device_returned` custody event to the holder's credential, distinct from `removed`.**
      The change: the event contract already names `device_returned`
      (`lib/event-contract/src/types.ts:16`, read by `lib/event-contract/src/detect.ts`), so no
      new custody event is added. A return at a dock, carried by the credential that checked
      the device out, closes custody and ends the session without producing
      `CUSTODY_REMOVED`; an authorized release with no return still restricts
      (`CUSTODY_REMOVED`); a return with no device sensed in the bay is a custody exception; a
      seat release with no authorized release, or a tamper or seat-break reading, is forced
      (`deny`, `CUSTODY_TORN`); a torn removal stays `deny`. **The pins that move, named:**
      `ATTACH_STATES` (`lib/signalgrid-core/src/attach.ts:37`–`38`, *"The three states, and
      only three"*) stays at three — a returned credential is no longer seated, so the return
      reaches `puckVerdict` as its own input bound from `device_returned`, not as a fourth
      attach state; the puck-lifecycle audit census (Puck 3: `AUDIT_EVENT_TYPES`, 14 members,
      and the audit proof that refuses a fifteenth) moves to 15 with a `dock.returned` event
      beside `dock.removed`, because recording a return as `dock.removed` is the conflation
      this row removes — the census assertion moves in the same PR, never loosened. Plus a
      resolution note for PR #1005: its live `CUSTODY_REMOVED`
      rule has no resolution descriptor and escalates, so once it merges every planned
      end-of-shift return would read as an incident until this row lands — the note says so on
      the rule. **Fail-closed:** only a return the ledger can bind to the holder's own
      credential closes anything; an unreadable return is `unknown`. **Deterministic:** the
      instants are arguments. The check that fails without it: new rows in
      `proof:decision-cascade` — a holder's return must not yield `CUSTODY_REMOVED`, and a
      seat release with no authorized release must yield `deny` — both fail on today's
      `puckVerdict` (`lib/signalgrid-core/src/attach.ts`), which knows only attached, removed
      and unknown and has no return or authorized-release input; plus a row that an authorized
      release with no return stays `restrict` (`CUSTODY_REMOVED`), which passes today and
      keeps the new rule from turning every walk-away into `deny`. Decision-core behaviour, so
      its PR carries a proposal record. Lane: principal-engineer.

- [ ] **Puck 7 — the return leg: a readiness scenario where every clearing step must be observed.**
      The change: after `device_returned` (Puck 6), a device stays NOT READY until each step is
      positively seen in the system that owns it — sign-out observed (Entra shared device mode
      or the comms platform), the Epic user-to-device association removed (assumed Epic
      routing: that removing it stops alerts reaching the device is the review's inference, not
      sourced), the device re-enrolled or checked in over DDM after Return to Service (DDM
      status, after the ddm-connector row above) — not the erase acknowledgement alone, because
      Apple's `device.erase.yaml` says the device's response *"doesn't retry if it isn't
      successful the first time"* — device prep complete
      (`lib/integrations/src/integrations/app-update/device-prep.ts`), `sso-session` showing no
      live session, and cleaning attested by a named person, read as evidence from the system
      that owns the attestation (the locker or mobile-access-management vendor, the
      environmental-services or cleaning-tracking app, or the host app) and never captured on a
      SignalGrid surface (golden rule 3). Anything unknown means not ready. **Scope, measured:**
      three steps have a dimension today — device prep, `sso-session` and DDM status; three do
      not — shared-device-mode or comms-platform sign-out, the Epic user-to-device association,
      and cleaning attestation (`ls lib/integrations/src/integrations` has no such family, and
      Epic appears in `lib` only as a break-glass audit plane). Those three enter as new
      fixture inputs in this row's PR, deferred and classified in the launch profile
      (`scripts/launch-profile.mjs`) in the same PR; no other family is added. It links to the
      Return to Service row (*Bind `device_returned` to Apple's Return to Service*) rather than
      duplicating it. **Fail-closed:** readiness is positive evidence of each step, never the
      absence of a complaint; a cleaning step is an attestation, never inferred and never a
      claim. **Deterministic:** fixture data only. The check that fails without it: assertions
      added to a registered proof (as Puck 4's matrix was added to `proof:decision-cascade`,
      because the simulator's engine is a byte-faithful twin and must not grow branches —
      golden rule 1) where each step left unobserved in turn keeps the device out of the pool,
      and only the all-observed case is ready. Lane: qa-engineer.

- [ ] **Puck 8 — a user-verified axis, attach-proof strength and a clinical-continuity row in `puckVerdict`.**
      The change: (a) `identityConfirmed` (`lib/signalgrid-core/src/attach.ts:170`) is a plain
      yes/no today, so the `allow` row can be reached by a touch-only assertion; add whether the
      user was VERIFIED (PIN or biometric) and never let a presence-only assertion reach
      `allow` for a broad-scope session. (b) Record how the attach was proven — a cryptographic
      challenge the puck's key answers, or only a microswitch, Hall or contact sensor — and treat
      sensor-only as `unknown` when deciding whether to keep a session open. (c) "Device and
      puck missing together" → `deny` plus an approval-gated revoke request to the IdP and the
      PACS. (d) An active alarm or call assignment plus removal or an unknown state →
      escalate through break-glass (`lib/integrations/src/integrations/break-glass/`) and
      local-authority, never a silent suspend. **Fail-closed:** every new axis can only raise
      the bar or route to a human. The check that fails without it: `proof:decision-cascade`
      matrix rows — attached + compliant + touch-only identity must not be `allow`; sensor-only
      attach must be `step_up` for a keep-open decision; removal with an alarm assignment must
      not emit an unattended suspend — each failing on today's tree. Decision-core behaviour,
      so its PR carries a proposal record. Lane: principal-engineer.

- [ ] **Puck 9 — puck-to-checkout binding, and a *dock expected* site flag.**
      The change: (a) bind the puck to the device for the length of a checkout; a return with a
      different puck, or with a puck reported lost, is a custody exception and does not close
      the checkout, and checking out a device that still carries another worker's puck is
      `deny`. The custody ledger
      (`lib/integrations/src/integrations/rtls-custody/custody-ledger.ts`) tracks the requester
      today, not the credential. (b) `lib/signalgrid-core/src/evidence.ts` (lines 150–156)
      deliberately treats missing dock evidence as neutral because "no dock at all is a
      deployment shape"; add a site flag that declares docks expected, so that at such a site a
      missing dock feed tightens, per device. **Fail-closed:** both halves only tighten.
      The check that fails without it: `proof:rtls-custody` rows for a mismatched-puck return
      that must stay open, and a proof row where a dock-expected site with a missing feed is not
      ready while a no-dock site is unchanged. Decision-core behaviour — (a) adds a `deny` and
      (b) edits `lib/signalgrid-core/src/evidence.ts` — so its PR carries a proposal record.
      Lane: physical-ot-domain.

**Added 2026-09-24 under DR-055 item 6** — the owner's 2026-09-24 note (the shared-device puck is
one example; a one-to-one assigned mode for a knowledge worker or an executive sits beside it),
recorded as an in-place amendment to DR-055 (the mode table, the claim map and the
assignment-coherence rows are in the hypothesis page's *Assigned-device mode (owner note
2026-09-24, DR-055 amendment)* section). Six more hardware-free rows, on the same terms as
Puck 1–9. Puck 10 and Puck 13 change verdicts the decision core returns and carry their own
proposal records in their PRs — the DR-051 pattern — and the owner approves by merging. Every
reason code named below is a proposal: a `git grep -w` of `lib`, `scripts` and `artifacts` for
each one returned nothing on 2026-09-24, and the nearest existing names —
`ASSIGNMENT_BROKEN` and `ASSIGNMENT_LOCATION_MISMATCH` (clinical,
`lib/facility-trust-graph/src/clinical.ts:365`–`366`) — mean something else, so the PR that adds
them checks for a clash again. Until the owner answers which device *"not assigned"* means (DR-055
item 6(v)), every row reads the workstation.

- [ ] **Puck 10 — the device-assignment MODE as a declared tenant input: `shared | assigned | unknown`, per device group.**
      The change: the tenant declares each device group's mode, approval-gated, reusing the
      read-only policy-binding dimension for the declaration
      (`lib/integrations/src/integrations/policy-binding/types.ts:1`–`48`, with its
      `PolicyEnforcement` axis at `:87`). Assigned → shared is graded as a *binding too WIDE*
      change: approval-gated, audited, then a `step_up` cooldown (`ASSIGNMENT_MODE_CHANGED`);
      shared → assigned tightens and needs no gate. An undeclared or `unknown` mode, on a workflow
      the tenant has opted into assignment policy, is `step_up` (`ASSIGNMENT_MODE_UNKNOWN`) and
      never resolves to `shared`; the opt-in is itself declared configuration, never inferred from
      missing MDM data (the same rule `CLAUDE.md` applies to `managedBool` defaults). A device
      declared shared that carries an admin-set primary user is a drift finding. The mode is not
      a hosting model (`docs/DEPLOYMENT_MODELS.md` is untouched) and not a fifth `OwnerType`
      (`lib/signalgrid-core/src/types.ts:94`). **Fail-closed:** unknown raises; only a declared,
      approved change loosens. **Deterministic:** the declaration and its approval are fixture
      inputs. The check that fails without it: a proof fixture where an undeclared mode yields
      `step_up` with `ASSIGNMENT_MODE_UNKNOWN` and an unapproved flip to shared yields
      `ASSIGNMENT_MODE_CHANGED` — it cannot pass today, because no mode exists. Deferred family,
      classified in `scripts/launch-profile.mjs` in the same PR. Decision-core behaviour, so its
      PR carries a proposal record. Lane: endpoint-uem-domain.

- [ ] **Puck 11 — an assignment-coherence signal domain: a new read-only integration family (working name `device-assignment`) with fixtures and its own proof.**
      The change: compare the CREDENTIAL SUBJECT — the user the credential is registered to, never
      "the holder" — with the device's CONFIRMED assigned user, credential-agnostic (a phone
      passkey, a Wallet badge, Windows Hello for Business or a FIDO2 key all read the same), and
      only ever tighten. Reason codes: `ASSIGNMENT_MISMATCH` (`deny`, against a confirmed
      assignment only), `ASSIGNMENT_UNCONFIRMED`, `ASSIGNMENT_MISSING`, `ASSIGNMENT_UNKNOWN`,
      `ASSIGNMENT_STALE`, `ASSIGNMENT_SOURCES_DISAGREE`, `ASSIGNMENT_RECENTLY_CHANGED`,
      `ASSIGNMENT_SELF_GRANTED` (`deny` plus an alert), `ASSIGNMENT_IN_TRANSITION`,
      `LOANER_TEMPORARY_ASSIGNMENT` and `ASSIGNED_DEVICE_LOST`; the finding
      `ASSIGNMENT_NOT_ENFORCED_LOCALLY` (Puck 15); and a configuration-time alert,
      `POLICY_UNOBSERVABLE`, that refuses a "phone must be present" rule for a puck ceremony so it
      never becomes active (after platform-sso's `POLICY_INCOMPATIBLE_WITH_METHOD`,
      `lib/integrations/src/integrations/platform-sso/evaluate.ts:21`–`24`). It is modelled on
      pacs-access's `identityMatched` → `IDENTITY_MISMATCH`
      (`lib/integrations/src/integrations/pacs-access/evaluate.ts:153`–`156`) and on sso-session's
      subject binding, whose `SESSION_SUBJECT_MISMATCH` escalates an active session and restricts
      an expired one and never denies
      (`lib/integrations/src/integrations/sso-session/evaluate.ts:64`–`72`). Break-glass accounts
      are pinned in SignalGrid tenant config (approval-gated), not read from a Conditional Access
      exclusion group; the administrator break-glass this follows is platform-sso's
      (`lib/integrations/src/integrations/platform-sso/evaluate.ts:168`–`173`), not the clinician
      break-glass family (`lib/integrations/src/integrations/break-glass/types.ts:7`–`11`); every
      break-glass sign-in on an assigned workstation alerts. Contradicting presence (a door read at
      another site, a concurrent session, `impossible_travel` at
      `lib/integrations/src/integrations/identity-risk/types.ts:39`) is how a shared credential
      shows. The full row list is the hypothesis page's *Assignment-coherence policy rows*.
      **Fail-closed:** no unknown, stale, disagreeing, auto-set or absent input reaches `allow`.
      **Deterministic:** instants are arguments; no `Date.now()`. The check that fails without it:
      a registered `proof:device-assignment` (so `validate-sim-macos.sh` picks it up) asserting
      that no unknown, stale, disagreeing, auto-set or absent fixture returns `allow`, that a
      mismatch against a first-sign-in assignment returns `step_up` and not `deny`, and that a
      device missing from the read returns `ASSIGNMENT_UNKNOWN` and not `not_applicable`;
      `pnpm run review:invariants` stays green. `pnpm run check:absence "primary user"` is
      CORROBORATED absent today (2026-09-24). Deferred family, classified in
      `scripts/launch-profile.mjs` in the same PR. Lane: iam-domain.

- [ ] **Puck 12 — an MDM assigned-user field per device, read-only: who the MDM says the device belongs to, and how that came to be.**
      The change: per device, `{deviceId, assignedUser | null, source, provenance, readAt,
      changedAt, changedBy, ticketRef}`, where `source` is `intune_primary_user`,
      `entra_registered_owner`, `fleet_end_user_idp` or `jamf_user_and_location` and `provenance`
      is `admin_set`, `enrolling_user`, `first_sign_in`, `dem`, `api_override` or `unknown`.
      Intune: the primary user and its audit event; Intune sets it by first sign-in for hybrid join
      with the automatic-enrollment GPO and for co-management, to the enrolling device enrollment
      manager for DEM, and to none for bulk token, Autopilot self-deploying, Automated Device
      Enrollment without User Affinity and Android Dedicated
      (<https://learn.microsoft.com/intune/device-management/inventory-and-status/find-primary-user>).
      Fleet: each host's `end_users[].idp_username` with `idp_info_updated_at`; more than one
      entry is ambiguous (`ASSIGNMENT_UNKNOWN`), and a write through Fleet's device-mapping
      endpoint is `api_override`
      (<https://github.com/fleetdm/fleet/blob/main/docs/REST%20API/rest-api.md>). Jamf: the
      *User and Location* inventory category — its field list is unsourced, so sourcing it is this
      row's first step for Jamf. Freshness is the time since the last successful read, from an
      injected clock. It must NOT route through `toEstateSubjects`
      (`lib/integrations/src/integrations/graph/estate.ts:8`–`10`, `:17`–`29`), which skips
      ownerless devices and only counts them in `skippedOwnerless`, and must not inherit that
      mapping's hard-coded `assignedRole: "unassigned"` (`:42`) or `ownerType: "unknown"` (`:49`).
      The adapter is read-only and refused at injection if it exposes a write method (the
      `actuatorMethodsOn` check, `lib/integrations/src/integrations/deviceResolver.ts:25`).
      **Fail-closed:** null, missing and ambiguous never read as a match. **Deterministic:**
      fixture data only. The check that fails without it: fixtures where a declared-assigned
      device the Graph read reports with no owner yields `ASSIGNMENT_MISSING` (today it is only
      counted in `skippedOwnerless`), a Fleet host with two `end_users` yields
      `ASSIGNMENT_UNKNOWN`, and a stale `readAt` yields `ASSIGNMENT_STALE` with the clock injected.
      Lane: endpoint-uem-domain.

- [ ] **Puck 13 — a declared per-device or per-workflow *credential required* flag, so silence at a device that needs a credential tightens instead of reading `not_applicable`.**
      The change: PR #1005 (open, branch `claude/build-dr043-live-attach-rules`, read 2026-09-24)
      reads an attach category that never appears in a decision's evidence as `not_applicable`
      and a present-but-unreadable one as `unknown` (`readPresentOrNotApplicable` in its
      `lib/signalgrid-core/src/evidence.ts`), and its seed row *"no attach reading at all → still
      allow (not_applicable: a tenant with no pucks is not stepped up)"* keeps silence at `allow`.
      That is right where a credential is optional, and this row does not change what
      `not_applicable` means. But nothing lets a tenant say a workstation or a workflow REQUIRES a
      credential, so at such a workstation the same silence also allows; and a device declared
      assigned whose assignment is missing reads like `badgeBinding: "unknown"`, which allows
      today (`lib/signalgrid-core/src/seed.ts:480`, *"badge absent/unknown → no fabricated block
      (allow)"*). Add a declared flag: where it is set, a missing assertion or attach reading is
      `step_up` (`REQUIRED_CREDENTIAL_UNOBSERVED`) and a missing assignment on a declared-assigned
      device is `step_up`; where it is not set, PR #1005's behaviour stands. **Fail-closed:** the
      flag only tightens. **Deterministic:** the flag is a fixture input. The check that fails
      without it: a seed row in the core policy matrix — *declared required, no feed → `step_up`*
      — which fails today because the same input resolves to `allow` (and to `not_applicable`
      once PR #1005 merges); `pnpm --filter @workspace/api-server run test:api` all green if `/v1`
      evidence changes. Core surface: `docs/LANE_COORDINATION.md` applies before it is touched.
      Decision-core behaviour, so its PR carries a proposal record. Lane: principal-engineer.

- [ ] **Puck 14 — assigned-mode simulator scenarios, as rows in an existing registered proof.**
      The change: scenarios for assigned mode, added as rows to an existing proof the way Puck 4's
      matrix joined `proof:decision-cascade` — the simulator's engine is a byte-faithful twin and
      must not grow branches (golden rule 1): a match → `allow`; a confirmed mismatch → `deny`; a
      mismatch against a first-sign-in or DEM assignment → `step_up`; a loaner corroborated by the
      MDM → `step_up`, an ITSM ticket alone → the mismatch stands; a delegate with the executive's
      puck plus a contradicting door read or `impossible_travel` → `step_up` or escalate; a stale
      read; sources that disagree; a reassignment inside the cooldown; a self-grant; the phone
      lost, lost not observable, a swap with a recorded reason, a retire with none; break-glass on
      an assigned workstation → alert; an assigned → shared flip; SignalGrid unreachable → the
      local rule stands. **Fail-closed:** every row asserts its outcome AND its reason code.
      **Deterministic:** fixture data and injected instants only. The check that fails without
      it: each row's assertion; `pnpm run proof:signalgrid-simulator` fails until Puck 11's domain
      exists. Lane: qa-engineer.

- [ ] **Puck 15 — a local-enforcement drift auditor: does the OS actually restrict who can sign in to a declared-assigned workstation?**
      The change: compare a declared-assigned workstation's Windows `AllowLocalLogOn` and
      `DenyLocalLogOn` — device-scoped lists of users or groups
      (<https://learn.microsoft.com/windows/client-management/mdm/policy-csp-userrights#allowlocallogon>)
      — and, on a Mac, its local accounts and Platform SSO's `EnableCreateUserAtLogin` (false by
      default,
      <https://developer.apple.com/documentation/devicemanagement/extensiblesinglesignon/platformsso-data.dictionary>),
      with the confirmed assigned user, reusing policy-binding's `PolicyEnforcement` axis
      (`lib/integrations/src/integrations/policy-binding/types.ts:87`). `EnableCreateUserAtLogin`
      false stops new accounts being created at the login window; it does not remove an existing
      local account, which is why the Mac half reads the accounts too. A list that is unset or
      holds a broad group (Users, Authenticated Users, Guest) → the finding
      `ASSIGNMENT_NOT_ENFORCED_LOCALLY`, `step_up` for high-risk workflows from that workstation
      only — not every decision, which would lock most tenants out on day one — plus an
      approval-gated MDM change REQUEST; a readable list that diverges from the confirmed assigned
      user → a drift finding, the same high-risk-only `step_up` (a confirmed wrong named user never
      grades weaker than an unset list) and the same request. SignalGrid never writes the list. First task:
      source whether the EFFECTIVE user-rights list per device can be read back (unsourced today);
      unreadable → `unknown` → the finding, and `step_up` for high-risk workflows only.
      **Fail-closed:** unknown raises. **Deterministic:** fixture data only. The check that fails
      without it: a fixture where a declared-assigned PC whose list holds `Users` yields
      `ASSIGNMENT_NOT_ENFORCED_LOCALLY`, and a grep of `lib/` for a user-rights write call stays
      empty. Lane: endpoint-uem-domain.

- [x] **Both findings from the "status reported rather than measured" sweep — FIXED.**
      The sweep that produced the `itsm` tri-state health fix turned up two more instances of the
      same class. Both are now closed and both are pinned.

      1. ~~**Twelve connectors fabricate an HTTP status they never observed.**~~ **FIXED, and gated
         so it cannot come back.** Every `*-connector.ts` with the shape `async healthCheck(...)`
         returned `{ healthy: true, status: 200 }` after awaiting an INJECTED transport. There is no
         HTTP response on that path, so a 201, 202 or 204 upstream was reported as 200 and a reviewer
         reading the field believed a server had said it. All twelve now return `status: null` on the
         success path — a value the type can hold and which means exactly what happened: the
         transport resolved, no status was observed. Sites fixed: `access-governance`,
         `agent-identity`, `device-attestation`, `device-management-health`, `link-usability`,
         `macos-posture`, `oauth-consent`, `ot-posture`, `pacs-access`, `sso-session`,
         `task-exception`, `token-binding`.

         `scripts/check-fabricated-status.mjs` enforces it in preflight and CI. The gate is built on
         a distinction rather than a blanket ban: eleven families (`graph`, `carrier`,
         `credential-exposure`, `data-protection`, `edr-threat`, `identity-risk`,
         `location-services`, `network-nac`, `peripheral-control`, `rtls-custody`, `vuln-scan`) hold
         a real `Response` and `return { healthy: res.ok, status: res.status }` — a reading, not a
         claim, which must keep passing. Those 22 files are a positive control with a floor, so a
         green cannot be reached by making the honest connectors stop measuring. Verified against
         the pre-fix tree: 12/12 would have failed.

         **What this did NOT fix**, stated so the green is not read as more than it is: `healthy:
         true` still means "the injected transport resolved", which in fixture mode is true without
         anything being contacted. The connector cannot know which transport it was handed, so that
         belongs at the resolution layer — which already reports `mode: "fixture"` with a reason —
         rather than in twelve constructors. Still open, deliberately not closed with the status fix.

      2. ~~**`sourcingToSignalStates` labels a CAPABILITY with the HEALTH vocabulary.**~~ **FIXED —
         and it was worse than this entry said.** `lib/flows/src/signal-sourcing.ts` emitted
         `{ id, status: "healthy" }` for every source whose acquisition method is *wireable* —
         meaning it COULD be connected, not that it is delivering. This entry concluded "its only
         consumers are coverage evaluations, so nothing today reads it as a live health claim."
         **That was wrong, and re-reading the consumer rather than the producer is what found it.**
         `evaluateGridCoverage` took those states and returned `reason: "<flow> is active and fully
         fed — the Grid runs its response by itself"` with a `coveragePct` documented as what the
         Grid handles "right now" — present-tense operational claims assembled from a configuration
         fact nobody had measured. `GET /cp/v1/grid/coverage` served exactly that.

         The fix was NOT the one this entry proposed. Changing the `SignalStatus` vocabulary would
         have been wrong: `evaluateFlowHealth` would then have to decide what a "wireable" signal
         does to flow health, re-conflating the two axes. Instead the projection carries its own
         basis: `projectSourcingAsSignalStates` returns a tagged `SourcingProjection`, and
         `evaluateGridCoverage` **derives** `coverage.basis` (`observed` | `projected_from_sourcing`)
         from the argument's shape. There is no flag to pass, so none to set wrongly and none to
         forget. Under a projection every reason string is reworded — "every signal it requires has
         a wireable source … nothing here was observed", never "fully fed" — because a reader skims
         the reason, and a tag alone would have fixed nothing.

         Coverage MATH is untouched; only the claim changed. That is asserted, not asserted-about:
         `proof:grid-coverage` (45 assertions) pins both bases, that the basis is derived rather
         than passed (same inputs, opposite bases), the wording on each side, and that the count is
         identical across them. `summarizeGridConfig` had already reached this conclusion alone —
         it named its field `coveragePctAtFullHealth` — and that judgement now lives in the type
         instead of in one caller's care. Documented in `docs/SIGNAL_SOURCING.md` §"Wireable ≠
         wired ≠ delivering ≠ healthy".

- [x] **In-app step-up completion (real WebAuthn, possession + user-verification)** — the SERVER control
      is real: `/v1/step-up/enroll/{options,verify}` + `/v1/step-up/challenge` +
      `/v1/app-workflows/complete-step-up` wire the hardened `@workspace/webauthn`
      path (single-use tenant+identity-bound challenge → assertion → cryptographic
      verify with user-verification REQUIRED → plan re-cut with `stepUpSatisfied`).
      Attestation is `none`, so the server proves credential POSSESSION and an
      authenticator-asserted user-verification event — it does NOT prove the key
      is hardware-backed; requiring/validating attestation is a future policy
      choice, not a current claim.
      The released state is derived only from the verified assertion — nothing in
      any request body can set it; a failed/replayed assertion is a 403 with no
      plan, and a valid assertion never upgrades a restrict/deny (release applies
      only when the CURRENT outcome is step_up). Credentials are tenant-scoped.
      Proven in `test:api` with a GENUINE ES256 ceremony (real P-256 keypair, real
      DER signature, UV flag): enroll → release, plus fail-closed negatives
      (pre-enrollment 409, smuggled `stepUpSatisfied` ignored, tampered signature,
      challenge replay, cross-tenant 409). Spec'd in `lib/api-spec/v1-openapi.yaml`.
      Remaining (follow-up): point the demo UIs' clearly-labeled client-side
      simulation (`completeAppStepUp`) at the real endpoint via
      `navigator.credentials` on a platform authenticator.
- [x] **Reposition `signalgrid-mobile-pwa` as operator/support (not a worker
      destination)** — done. The branded first-person "My Access" worker screen is
      now the `AccessSupport` tab ("Access support · Worker session triage · relay
      guidance"): a support lead's window into worker sessions that relays guidance
      with no worker-executed controls. `docs/EMBEDDED_UX_PRINCIPLE.md` (Reconciliation)
      and `docs/APP_SUITE_MATRIX.md` updated to match.
- [x] **Per-integration workflow templates** — done. `@workspace/app-workflows`
      now ships per-vertical starter templates (`starterTemplate` / `STARTER_TEMPLATES`)
      an integrator clones, plus a fail-closed validation lint (`lintAppIntegration` /
      `lintAppIntegrations`) that enforces the planner's safety invariants (critical ⇒
      sensitive + gated, non-empty workflowKey, unique keys/ids). Proof:
      `proof:app-workflow-templates` (20 assertions, in preflight + CI); guide:
      `docs/APP_WORKFLOW_TEMPLATES.md`.

## Owner-gated (needs a decision before an agent builds it)

- [ ] **OWNER DECISION — adopt an on-premises inference runtime (AirLLM or a peer), or decline it.**
      Raised 2026-09-17 when the owner pointed at `github.com/lyogavin/airllm` and said it
      should be part of the system. What it provides that this repository needs is real and
      specific: **inference inside the building with no data egress, on modest hardware** —
      a 70B model on ~4 GB of VRAM by streaming layers from disk. That is the constraint
      that actually binds in the regulated verticals SignalGrid targets.
      **The decision path is already fenced off and that part is done** —
      `scripts/check-decision-path-purity.mjs` (preflight + CI) proves no verdict is
      fetched, spawned or sampled, so adopting a runtime cannot quietly reach the core.
      **What needs the owner, per the DR-020 rule DR-021 leaves standing:** a new inference
      platform is a decision record before it is a dependency. The three questions a DR
      would have to answer, none of which the README does: (a) WHICH surface — an
      explanation/Assist path or offline evidence summarisation, never a verdict; (b) at
      what LATENCY — **ANSWERED 2026-09-17, by the Mac lane RUNNING it rather than reading
      it** (`mac/intake-airllm`, PR #801): `TinyLlama-1.1B` produced 20 tokens in 207.1 s
      and again in 205.7 s = **0.1 tok/s**, while `qwen3:8b` under the Ollama already
      installed on that same Mac measures **12.7 tok/s** — roughly 100x faster on a model
      about 7x larger. Peak footprint was 2.44 GB for a 2.2 GB model, so the layering saved
      almost nothing, and `Llama-3.2-1B-Instruct` failed outright because the macOS backend
      cannot load a tied-embedding model. The README's 70B-on-4GB claim is about MEMORY and
      holds by construction; the cost it omits is TIME, which scales with layer count and
      size, so a 70B on that hardware would be minutes per token. This does not retire the
      want, it redirects it: the route to local inference with no egress is a quantized
      model under the Ollama already installed, not this;
      (c) who OPERATES the model, since a model in a customer's building is a thing that
      needs patching, and this repository has been careful never to claim on-device
      enforcement it does not have. Nothing is in `package.json` or any build today.
      Lane: solutions-architect (to draft the DR once the owner rules on whether to adopt at all).

- [ ] **A REACHABLE dual-control surface — OWNER-GATED, and NOT the defect the
      row-45 audit first described.** A three-seam design pass with adversarial
      critique (and independent re-verification by hand) established facts that
      correct the original framing, and they are recorded here because the
      original framing overstated the risk:
      1. `planFlowActions` has **zero shipped consumers**. `ActionPlan` and
         `requiresApprovals` occur repo-wide only in `lib/flows/src/index.ts` and
         `scripts/src/flows-proof.ts`; the sole other mention is a *comment* in
         `grid-config.ts`. `artifacts/api-server` imports eleven symbols from
         `@workspace/flows` and `planFlowActions` is not among them. So its
         `dual_approval` disposition is unreachable from any product path, and
         wiring the evaluator into it would be a decorative wire into dead code —
         all three critiques reached `closesDefect: false` for exactly this reason.
      2. The surface that DOES ship — `lib/app-workflows` via
         `POST /v1/app-workflows/evaluate` — is rigorous, not lax. The route
         deliberately does not read `confirmedActionKeys` from the request body
         ("This route NEVER releases held actions on a request-supplied signal");
         the one release path is `POST /v1/app-workflows/complete-step-up`, a real
         WebAuthn ceremony with user-verification required, an action-bound
         single-use challenge, tenant-scoped credential storage, and the release
         flag derived server-side from the verified assertion.
      **Therefore there is no live "two clicks instead of two people" defect on any
      shipped path.** `@workspace/dual-control` is an unwired primitive whose
      absence costs nothing today, because nothing today reaches a state it would
      have gated. What remains is a genuine PRODUCT question rather than a repair:
      should a two-person ceremony exist on a reachable surface at all — and if so,
      on which action class? That is the owner's call, not an agent's, because it
      adds a runtime obligation to the launch path rather than fixing something
      broken. **A field-tested reference design now exists for the "if yes, how?"
      half**: docs/research/SMPLIFY_DESIGN_STUDY.md records Smplify's shipped
      approval-gate lifecycle (five risk tiers, gate-after-RBAC placement,
      STRICT/DEFAULT self-approval modes pinned by compliance regime, idempotent
      request creation, 24h TTL, replay-under-service-authority on quorum,
      inbox/outbox, dry-run preview, loud break-glass refused for self) — the
      owner's decision stays the owner's, with a concrete design to say yes to.
      If taken, the design pass's own conclusions bind: evidence must cross
      the seam (a raw `DualControlRequestRaw` normalized by the primitive's own
      normalizer), never a caller-supplied verdict; a ceremony must bind to one
      action id and not be replayable across actions; and every new guard must be
      expressed in a shape `scripts/mutation-guard.mjs` can actually mutate — a
      `switch` arm is invisible to it and would pass vacuously over the release
      decision itself.
      **The generalizable lesson is now a gate.** The expensive part of this episode
      was not the wrong conclusion, it was that "does anything ship this?" took a
      full design pass to answer when it is derivable in a second.
      `scripts/check-package-reachability.mjs` computes the transitive closure from
      `artifacts/*` and reports every `lib/*` package no shipped artifact can reach —
      thirteen of thirty-five today, `dual-control` among them, and it prints WHY (no
      importers at all, versus imported only by the proof harness). The figure read
      eight until 2026-09-05, when the extractor stopped crediting a package NAMED in a
      comment as an imported one: six libraries had been reported shipped on the
      strength of prose, and the count is now measured from import positions only
      (`--self-test` pins the shapes). It is a ratchet
      pinned at the current count, not a hard gate: unreachable is a requirement to
      look before building, not a verdict to delete. It also corrected a hand count
      made during that pass — `lib/db` is untracked build residue (`dist/` and
      `node_modules/` with no manifest and no source), not a thirty-sixth package,
      which is the ordinary reason a derived figure beats a remembered one. Lane: principal-engineer.
- [x] **186 vendored shadcn components are unreferenced, holding 21 packages alive.** **DONE 2026-09-01 (Ponytail cut 41a, ECC: GO):** the owner decision is resolved by DR-024 — code the ladder says should not exist is removed. Measured by import-graph closure (ui→ui edges followed): 131 unreached `components/ui` files deleted across the three web apps (app 34 of 53, review 48 of 52, web 49 of 53) and 90 manifest entries only they held (24 / 33 / 33, incl. `@hookform/resolvers` which peers on the removed `react-hook-form`). Typecheck green, all three apps build, SBOM unaffected (dev-only deps). `npx shadcn add <name>` restores any one when a screen needs it. The same vendored set in signalgrid-desktop, signalgrid-mobile-pwa and mockup-sandbox is the follow-up (mockup-sandbox is itself an owner-call delete).
- [x] **Ponytail cut 4 (DR-024, 2026-09-02): the follow-up above (desktop/mobile-pwa vendored `ui/`), the A6 provider pattern generalized to the two apps the audit never covered, and a six-family emitter-resolver fold.** Measured by import-graph closure from each app's `artifacts/signalgrid-mobile-pwa/src/main.tsx`, same method as cut 41a:
  - `signalgrid-desktop`: 53 unreached `components/ui/*` and `hooks/*` files deleted (all 52 vendored ui files bar `tooltip.tsx`, which Dashboard's charts genuinely consume — kept, unlike the other three apps). `App.tsx` mounted `QueryClientProvider` and `<Toaster/>`. The toaster had zero `toast()` callers and is dropped. The `QueryClientProvider` was ALSO dropped on a "zero `useQuery`/`useMutation` in the app" grep — and that grep was true and the conclusion false: every page's data hook (`useListDecisions`, `useGetDecision`, …) is generated into `@workspace/api-client-react` on top of react-query, so the provider was the data path. The build stayed green; the client-surfaces E2E (`desktop reached the api-server: 0 calls`) caught it; the provider and the dependency are restored in the same PR. A consumer count must be taken over the dependency graph, not the app's own source. `TooltipProvider` kept. 40 now-unreachable `package.json` deps removed (`@tailwindcss/typography` too — zero `prose` class in the app, its `@plugin` line dropped from `index.css`). `git diff HEAD --shortstat -- artifacts/signalgrid-desktop`: 56 files changed, 8(+), 5379(-).
  - `signalgrid-mobile-pwa`: 56 files deleted the same way, including `tooltip.tsx` itself (no `TooltipProvider` was ever mounted here) and, once `components/ui/card.tsx` was gone, the orphaned `pages/not-found.tsx` that imported it and was itself unreached (this app is tab-based, not routed — no wouter `Router`, no path ever renders it) — deleting it then exposed the app's src/lib/utils.ts (the `cn()` helper; deleted in this cut, so not cited) and its `clsx`/`tailwind-merge` deps as unreached too; all four removed. `<Toaster/>` dropped from `App.tsx` (zero callers); the `QueryClientProvider` was dropped on the same false grep as the desktop's and restored (the tabs' hooks come from the generated client). 42 deps removed. `git diff HEAD --shortstat -- artifacts/signalgrid-mobile-pwa`: 59 files changed, 2(+), 5430(-).
  - `signalgrid-review` + `signalgrid-web` (audit item 3): the same three zero-consumer providers (`QueryClientProvider`, `TooltipProvider`, `<Toaster/>`) verified with the same greps (no `useQuery`/`useMutation`, no `<Tooltip`/`TooltipTrigger`/`TooltipContent` outside `ui/tooltip.tsx`, no `toast()` call) — dropped from both `App.tsx`; `toast.tsx`/`toaster.tsx`/`use-toast.ts`/`tooltip.tsx` deleted (5 files each), 3 deps each (`@tanstack/react-query`, `@radix-ui/react-tooltip`, `@radix-ui/react-toast`). Audit item 10 (`use-mobile.tsx` in review and web) had already been removed by the docs sweep (PR #372) before this cut landed, so this cut carries no change for it.
  - **lib/integrations emitter-resolver fold (item 4):** diffed the six families' `resolve.ts` byte-for-byte modulo name substitution — identical shape confirmed (`diff itsm/resolve.ts siem/resolve.ts` etc.: every hunk is a rename, no logic delta). Factored into `lib/integrations/src/integrations/adapters/emitter-resolver.ts` (`createEmitterResolver()`); each family's `resolve.ts` shrank to its docblock plus type aliases and a one-call binding (`ITSM_EMITTER_TOKEN`, its no-transport-reason text), keeping every exported name (`resolveItsmEmitter`, `ItsmEmitterResolution`, …) the six other modules and two proofs import by exact name. `git diff HEAD --shortstat -- lib/integrations`: 7 files changed, 222(+), 302(-). `proof:emit-gate` 109/109, `proof:emitter-discipline` 51/51 (both unchanged from the batch-A base), plus `proof:caep-events` 17/17, `proof:webhooks` 69/69, `proof:itsm-credential-crypto` 20/20, `proof:itsm-template` 10/10, `proof:telemetry-posture-cache` 21/21, `proof:telemetry-up` 7/7 — no standalone `proof:siem`/`proof:syslog` exist to name.
  - Declined `sonner`-migration item (audit item 5): the audit's premise — "`sonner` is installed AND `ui/sonner.tsx` is already vendored" in `signalgrid-app` — does not hold in this tree (`grep sonner artifacts/signalgrid-app/package.json` and `find … -iname sonner.tsx` both empty, likely retired by an earlier cut as itself-unreached before this migration could run). Doing it now means adding a new dependency and re-vendoring a file, not removing dead code — declined, reported per "verify with grep first."
  - `pnpm-lock.yaml` regenerated (`pnpm install --lockfile-only`), 1019(-)/29(+) lines. `pnpm run typecheck` green across all workspaces; `signalgrid-desktop`, `signalgrid-mobile-pwa`, `signalgrid-review`, `signalgrid-web` all `vite build` green. `review-invariants`, `check-launch-profile`, `check-review-coverage`, `check-role-coverage`, `check-proof-counts` (56/56), `check-proof-figures`, `check-doc-orphans` all pass unchanged from baseline; `check-cited-paths` fails its pre-existing 18 (all `docs/PRIVATE_CORE_HANDOFF.md`/`PRODUCT_CORE_FOUNDATION.md`/`COMPANY_BUILD_PLAN.md`/`SIGNALGRID_GRID_PROOF.md` citations to generic `src/*.ts` and `artifacts/proof/…` paths that never existed in this tree) — none name a file this cut touched. `pnpm run sbom` diff is 434 deletions only. `generate-sync-manifest.mjs` reports unchanged (version 47) — no cross-surface contract moved.
  - Not cut: trust-boundary validation, error handling (`ErrorBoundary` in `signalgrid-mobile-pwa`, kept and still reached), accessibility, anything a doc explicitly requests, any `proof:*`/gate self-test.
      ⚠️ **Owner decision: is this dead code, or an installed component library?**
      Measured, not estimated — same conservative check that justified deleting
      chart/calendar/resizable (`e5bad8e`): a component counts only if its module
      path appears NOWHERE in the repo outside its own file.

      31 distinct components, each unused in **all six** artifacts: accordion, alert,
      aspect-ratio, avatar, breadcrumb, button-group, carousel, checkbox, collapsible,
      command, context-menu, drawer, dropdown-menu, empty, field, hover-card,
      input-group, input-otp, item, kbd, menubar, navigation-menu, pagination, popover,
      progress, radio-group, scroll-area, slider, sonner, spinner, toggle-group.

      They keep **21 packages** in the tree that nothing else imports: 16 `@radix-ui/*`
      plus `cmdk`, `embla-carousel-react`, `input-otp`, `next-themes`, `sonner`. Each is
      a future major that will break code nobody calls — precisely what happened with
      react-resizable-panels (#157) and react-day-picker.

      WHY THIS IS NOT SIMPLY DELETED, unlike the first three: those were BLOCKING a
      dependency update, so removing them resolved a live problem. These block nothing
      today, and vendored shadcn components are commonly kept on purpose so a developer
      can reach for `dropdown-menu` without re-adding it. That trade-off — 21 fewer
      dependencies against having the palette ready — is a workflow preference, not an
      engineering fact, and it is not mine to settle.

      If the answer is "delete": it is reversible (`npx shadcn@latest add <name>`
      regenerates them), and the same verification applies — typecheck, 6/6 build,
      E2E 35/35, then regenerate the SBOM, which will fail preflight until you do.

      NOTE ON METHOD: a reachability analysis from entry points reported 281/314
      unreachable. That number is WRONG and was discarded — four artifacts load
      components through dynamic `import()`, and mockup-sandbox through an auto-generated
      module map that is empty at rest, so a static graph walk cannot see them. The
      186 figure above uses textual reference only, which makes no such assumption.

- [ ] **The UI-library majors (recharts / zod 4 + @hookform/resolvers).** Must ship
      WITH the bump — measured, not assumed. *Re-measured 2026-08-19: this entry named
      four libraries; `react-day-picker` and `react-resizable-panels` now appear in ZERO
      package.json files in the tree, so only the two above are still outstanding.*
      The grouping policy is fixed (`f51d86a`), so these now arrive as separate
      per-library PRs instead of one 65-package wall. What is already pre-landed and
      what cannot be, so nobody repeats the experiment:

      **Pre-landed** (version-agnostic, verified green under BOTH majors):
      `z.string().ip()` → node's `isIP`; `z.record(v)` → `z.record(k, v)` (`642dd20`);
      lucide's removed brand icons inlined as local SVG components (`f51d86a`).

      **Cannot pre-land — tried and reverted.** The policy forms need
      react-hook-form's three-generic form, `useForm<z.input<S>, unknown,
      z.output<S>>`, because zod's `.default()` gives `active` an optional INPUT type
      and a required OUTPUT type; `z.infer` is the OUTPUT, so typing the form with it
      contradicts the resolver and instantiates `Control<T>` with two different T's —
      which surfaces as the misleading "two different types with this name exist"
      (there is exactly ONE react-hook-form in the store; it is not a duplicate
      install). But the CURRENT `@hookform/resolvers` types `zodResolver` loosely
      enough that the explicit generics fail against it. So the fix is correct only
      alongside the new resolver, and forcing it earlier needs a cast — obfuscating
      today's code to suit tomorrow's dependency. It belongs in the bump PR.

      Remaining after the pre-landed work: ~120 errors, ~96 of them three VENDORED
      shadcn components duplicated per artifact (chart 60, resizable 30, calendar 6).
      The browser E2E suite covers five of the six artifacts, so that migration can be
      verified as RENDERING rather than merely typechecking — which is the standard it
      should be held to. Lane: web-engineer.

- [ ] **IP / disclosure posture** ⚠️ **owner decision first.** Before ANY detailed
      invention material is committed, the owner must confirm repo **visibility**
      (public GitHub = a public disclosure that starts the US 12-month patent
      clock and can bar patents abroad). Decisions the owner owns: file a
      **provisional patent** for the embedded-on-dock method + retrofit module +
      phone-case/locker embodiments; **trademark** "SignalGrid"; entity
      formation; **LICENSE posture** (the repo currently has no explicit
      proprietary notice — changing to "all rights reserved" or adding a LICENSE
      is a business call). An agent MAY, once the owner OKs and confirms the repo
      is private (or a private location is chosen): draft an invention-disclosure
      document from the architecture, add copyright/CONFIDENTIAL headers, and
      write a tiered-disclosure kit (public one-pager vs. NDA-gated technical
      brief) + an IP-and-disclosure posture document (planned, not yet written).
      Do NOT commit a detailed provisional spec into a public repo. Lane: commercial-counsel.

## Later / vision

_(see `docs/APP_WORKFLOWS_OPPORTUNITY_MAP.md` for the full app-workflow roadmap)_

## Done (recent)

- [x] **`check-ci-liveness.mjs` told the truth about a dark sweep and a blind gate in the same words.** **DONE 2026-09-14**
      — Found by being hit: on PR #742 the gating job failed with "the mutation sweep is
      not demonstrably alive" at 14:32:48Z, while `scheduled-verification` run
      34853811860 had all FOUR sweep shards green between 14:14:33Z and 14:20:54Z —
      twelve minutes earlier, inside the 48h threshold. The identical commit passed on
      re-run with nothing changed, so the payload differed, not the repository.
      Three situations all returned `null` and were reported as the third: the API
      returning no runs, runs carrying no sweep job (renamed, or an empty payload), and
      the sweep genuinely failing every shard. Only the last is this gate's finding, and
      the first two are "could not look" — the distinction this file's own header
      already demands ("a probe that could not run is not a probe that found nothing")
      and had applied to its inner fetch but not its outer loop.
      The per-run diagnostic line also sat *after* `if (!sweep.present) continue`, so the
      one shape needing evidence most — every run inspected, none matching — produced a
      red verdict with an empty log. That silence is why diagnosing it took an API
      cross-check instead of a glance.
      Fixed in PR #745: `classifyScan` separates could-not-look from dark, the
      could-not-look arm is fatal in CI with its own message and reported-not-fatal off
      CI, and the diagnostic prints for every inspected run. Four self-test cases,
      falsified by planting the old conflation. This gate has form — its previous fix
      (run 69) addressed shard-ORDER flakiness and its own commit called it "a flaky
      gate, in the gate that warns about flaky gates"; empty-payload flakiness is the
      same class, untouched until now.

*Re-filed out of **Owner-gated** on 2026-08-19 by the virtual team's PM shift: every one of these was already complete, so that section was implying decisions were still owed when none were. Original-entry records travel with their resolution, which is why some arrive as pairs — the historical reasoning is the point, not clutter.*

- [x] **Run the Mac lane → `liveEvidence` goes `none` → `fresh`.** **DONE 2026-08-07**
      — `artifacts/live-evidence/mac-run.json`, minted on the owner's Mac
      (macOS 26.6, arm64) and committed as `d107fa2`. `check-live-sync` now reports
      `liveEvidence=fresh`. This was the repo's longest-standing gap, and it turned
      out to need no supervised device and no purchase.
      A THIRD blocker existed and was invisible until a real Mac ran the lane: the
      evidence gate required `pnpm run build`, which pnpm-workspace.yaml makes
      impossible on macOS by stripping the darwin native binaries — a step the
      toolchain forbids on the only platform allowed to mint evidence. Fixed in
      `10dbc0b` (#176): steps that are structurally impossible on a platform are
      recorded UNAVAILABLE with the reason rather than failing, derived from the
      workspace config and only when the binary genuinely does not resolve. The
      evidence file carries `preflightCoverage` naming what did not run, so a green
      `mac-run.json` cannot be read as "the web bundle builds".
      The original two blockers, both cleared:
      1. *Review-Hub half* — `verify-all.mjs` runs the FULL preflight, which includes
         `pnpm run build`, believed unrunnable on macOS. It runs fine once the four
         stripped darwin binaries are supplied (commit `d637404`). **Cleared.**
      2. *signalgrid-mcp half* — its `pyproject.toml` pinned `mcp>=1.9.0` with no
         upper bound. The MCP Python SDK released **2.0.0**, which removes
         `mcp.server.fastmcp` outright (it moved under `mcp/server/mcpserver/`) and
         turns `mcp/types.py` into a package. `signalgrid-mcp/src/signalgrid_mcp/app.py` imports
         both, so the server raises `ModuleNotFoundError` at import and a client sees
         only `-32000: Connection closed`; pytest fails at COLLECTION with 4 errors
         and 0 tests run. It reads as a broken repo but is a moved API. **MERGED as
         `signalgrid-mcp` `369e08e` (PR #12) on 2026-08-06** — pinned `mcp>=1.9.0,<2`,
         which resolves 1.29.0. Verified as a matched pair: 99 tests pass under the
         pin; `ModuleNotFoundError` + 4 collection errors under 2.0.0. **Cleared.**

         Note for anyone registering the server with a client: `uv run --with
         mcp[cli]` builds an isolated environment and **ignores `pyproject.toml`**, so
         the merge does not fix such a registration. It has to carry the bound itself:
         `--with 'mcp[cli]<2'`.
      Verified end-to-end on 2026-07-31: with both in place, both halves pass and
      `mac-run.json` mints. That evidence was deliberately NOT committed, because it
      was produced against a local ad-hoc merge — the evidence schema records
      `mcpCommit`/`mcpDirty`, and publishing a run against an unpushed dirty tree
      would be exactly the manufactured confidence this repo keeps deleting.
      The committed run was minted against merged code with a clean checkout —
      `mcpCommit: 369e08e`, `mcpDirty: false` — so it is attributable and
      reproducible rather than "some tree passed once".
      **To refresh it** (the manifest fingerprint changes whenever contracts move,
      which turns the evidence stale): `./mac-kickoff.sh` from the repo root on the
      owner's Mac. It cannot be done from CI or a cloud sandbox — `--emit-evidence`
      refuses off-macOS AND on CI runners, on purpose, because green-ness is not
      hardware.

- [x] **`X ?? []` made an unreported collection indistinguishable from an empty
      one — in FIVE connectors.** **DONE.** The normalized collection is now `null`
      when the source never reported it and `[]` when it reported none, and each
      evaluator contributes an "unobserved" candidate that raises `monitor` instead
      of letting the `none` default win. New reason codes:
      `THREAT_FEED_UNOBSERVED`, `RISK_FEED_UNOBSERVED`, `PERIPHERAL_FEED_UNOBSERVED`,
      `SECRET_SCAN_UNOBSERVED`, `DLP_FEED_UNOBSERVED`.

      | connector | unreported (was → now) | reported-none (unchanged) |
      | --- | --- | --- |
      | `edr-threat` | `protected`/none → `monitored`/monitor | `protected`/none |
      | `identity-risk` | `trusted`/none → `unknown`/monitor | `trusted`/none |
      | `peripheral-control` | `no_removable`/none → `unknown`/monitor | `no_removable`/none |
      | `credential-exposure` | `clean`/none → `unknown`/monitor | `clean`/none |
      | `data-protection` | `protected`/none → `unknown`/monitor | `protected`/none |

      `monitor` on purpose, not something louder: the device may be entirely fine —
      we simply never read the feed. It is a blind spot to investigate, the same
      level as the existing `NOT_REPORTING`, and it loses to any genuinely observed
      problem, so a real active threat still outranks "we could not see". A vendor
      that DID look and found nothing is still clean with action `none`, which is
      what keeps this a distinction rather than a wall.
      Design taken from the repo rather than invented: `null = not reported,
      distinct from an explicit false` already appears in six normalized types
      (`rtls-custody.present`, `oauth-consent`/`sso-session` reachability,
      `agent-identity`, `pacs-access`, `task-exception`). This extends it to
      collections. Pinned by `proof:absent-collection` (20 assertions); suite
      96 passed / 0 failed.

      _Historical, kept because the reasoning is the point:_

- [x] **`X ?? []` (original entry — the fail-open as first measured).** Each
      normalizer did `(raw.threats ?? []).map(...)` or a sibling.
      After that single line, "the vendor could not report this" and "the vendor
      reported nothing" are the same value, and every evaluator downstream reads the
      empty set as good news **with action `none`**:

      | connector | unreported collection → verdict |
      | --- | --- |
      | `edr-threat` | `protected` / `NO_THREATS_HEALTHY` / none |
      | `identity-risk` | `trusted` / `NO_RISK` / none |
      | `peripheral-control` | `no_removable` / `NO_REMOVABLE` / none |
      | `credential-exposure` | `clean` / `NO_FINDINGS` / none |
      | `vuln-scan` | `clean` / `NO_FINDINGS` / none |

      Not hypothetical: `proof:live-edr` MEASURED that Wazuh's alerts live in a
      separate indexer, so "reports protection health, cannot report detections" is
      the real shape of the one live EDR this repo has been pointed at. Wazuh escapes
      today only because it also cannot report `realtimeProtection` or
      `signatureAgeHours`, which independently force `degraded_protection`. Any
      vendor that reports protection health but not detections lands on `protected` /
      action none. `identity-risk` is the starkest: a principal whose risk detections
      were never fetched is graded **trusted**.
      It also COMPOUNDS the capped-read defect below — a truncated page returns fewer
      items, and fewer items read as cleaner. Same root cause: a read that never
      happened must not equal a read that found nothing.
      Fixing it needs an "observed" distinction on five normalized types (nullable
      collection, or an `xObserved` flag) plus new reason codes, hence owner-gated.
      Pinned meanwhile by `proof:absent-collection`, which asserts the CURRENT
      behaviour so it cannot drift and fails — with instructions — the moment the
      distinction is added.

- [x] **`vuln-scan` grades an empty finding set as CLEAN by default.** **DONE** —
      fixed by DERIVING the flag: `options.scanned ?? findings.length > 0`. A non-empty
      set is its own evidence a scan ran; the empty set — the only ambiguous case —
      now fails closed to NOT_SCANNED/monitor, and a caller that knows a scan happened
      states it. No legitimate caller broke, which is itself evidence the default was
      wrong. ORIGINAL ENTRY BELOW.

- [x] **`vuln-scan` (original entry).** ⚠️ **owner
      decision — API change across callers.** `evaluateVulnPosture([], {})` returns
      `clean` / `NO_FINDINGS` / action `none`. `[]` is genuinely ambiguous — a
      scanned device with zero findings really is clean — which is why the `scanned`
      flag exists; the question is which way the DEFAULT falls.
      It falls the opposite way from every sibling. Measured across all four places
      this repo grades a collection: `passkey-assurance` (`[]` → `NOT_COVERED` /
      `step_up`), `edr-threat` (nothing observed → `AGENT_ABSENT` / `alert`), and
      `telemetry/fleetdm` (`policies.length > 0 && every(pass)`) all DERIVE their
      caution from the data. `vuln-scan` alone requires the caller to remember
      `scanned: false` — and a safety property that depends on being asked for
      politely is not a safety property. The failure mode is a caller that gets `[]`
      from a truncated page, an errored request, or a device with no scan record and
      forwards it: the device is reported clean, action none.
      LATENT, not live: there are no production callers of these evaluators today —
      only tests and proofs — which is why this is recorded rather than fixed.
      Options: make `scanned` required (loudest, breaks every call site), flip the
      default to `false` (safest, makes existing tests declare their intent), or
      accept it explicitly with the reasoning written down.
      Pinned meanwhile by `proof:absent-collection`, which asserts the current
      behaviour so it cannot drift further and fails — with instructions — the
      moment the default is changed.

- [x] **Truncation signal on capped reads.** **DONE** — all eleven now throw
      `incomplete_read` when the page cap is hit with a next-page cursor still in
      hand, rather than returning a partial inventory as a complete one. Chosen over
      a richer return type because it needs NO signature change: every caller already
      handles connector errors, so there is no new call site that can forget. The cap
      itself stays — it is the loop/DoS guard against an endless cursor — and a tenant
      that FITS reads normally, so it is a refusal, not a wall. The remedy is named in
      the message: raise `pageLimit`. `KNOWN_SILENT` in the guard is now EMPTY.
      Design taken from the repo: `policy.ts` and the simulator both answer
      incompleteness with "trust is incomplete → step up", and passkey/ddm fail closed
      on partial sets. ORIGINAL ENTRY BELOW.

- [x] **Truncation signal on capped reads** (original entry — API change across 11
      connectors.** Eleven connectors paginate with their own copy of `getAllPages`,
      looping `while (url && pages < this.pageLimit)` and returning a plain array.
      The cap is correct (a loop/DoS guard against an endless `nextLink`) but the
      caller learns nothing: a tenant with more pages than the cap yields a SHORT
      list indistinguishable from a complete one. For a posture fabric that is a
      fail-open — an absent device reads as "no such device", so a non-compliant
      host past the cap reads as no problem. Measured over a real socket in
      `proof:graph-wire`.
      Fixing it changes the return type of all eleven and every caller, so it is
      the owner's call: richer return (`{items, truncated}`), a thrown error on
      cap-hit, or a documented accept-the-risk. `scripts/check-pagination-truncation.mjs`
      stops a TWELFTH being added silently in the meantime — the eleven are listed
      there, so the debt is stated rather than implied.

_These need the owner's call — an agent should not act on them unsupervised._

- [x] …and the platform pin was necessary but not sufficient — the follow-up the
      entry below needed. A real `docker compose build` on the owner's Mac, the
      first one ever run, found `Dockerfile.web` still broken twice over after the
      fix: `tsconfig.base.json` was never copied into the build context (both app
      tsconfigs open with `"extends": "../../tsconfig.base.json"`, so vite could not
      resolve it) and neither were `scripts/package.json` + `scripts/enforce-pnpm.cjs`
      (the root `preinstall` hook runs the latter, so `pnpm install` crashed before
      it began). `Dockerfile.api` already carried that second pair, with a comment
      explaining why — the rule was copied between files instead of shared, and the
      copy fell behind.
      Both fixed; `docker compose up` now brings api + web + nginx up with all three
      answering healthchecks. The durable correction is that CI's deploy-stack job
      now runs `docker build -f Dockerfile.web` for real, because
      `check-container-native-base.mjs` **cannot** catch this class: the build context
      is assembled BY the Dockerfile, so a path that is never COPY'd does not exist,
      and no static read reveals it. That guard's header and its success message now
      say so instead of implying the stronger claim. The gate was not wrong — it was
      answering a narrower question than its output suggested, which is the same
      defect shape it was built to catch.

- [x] The delivery images could not be built (fourth blocker of this class) —
      `Dockerfile.web` used a `node:22-alpine` builder, and alpine is **musl**,
      while `pnpm-workspace.yaml` strips `@rollup/rollup-linux-x64-musl`,
      `lightningcss-linux-x64-musl` and `@tailwindcss/oxide-linux-x64-musl`. The
      vite build inside it could never have succeeded, on any host. Neither
      builder stage pinned `--platform`, so both also inherited the build host's
      architecture: linux/amd64 on the CI runner (which is why the API image
      always passed there) and linux/arm64 on an Apple Silicon Mac, where
      `@esbuild/linux-arm64` is stripped too. Nothing caught it because CI's
      `deploy-stack` job builds `docker-compose.prod.yml`, which declares only
      `db` and `api`; the web image is referenced solely by the dev
      `docker-compose.yml`, which no job ever built. Fixed by pinning both
      builder stages to `--platform=linux/amd64` on `node:22-bookworm-slim` —
      linux-x64-gnu is the one triple the workspace ships a complete native set
      for. New gate `scripts/check-container-native-base.mjs` (preflight + CI)
      derives the supported triples from `pnpm-workspace.yaml` at run time and
      fails any bundler build stage that is unpinned or targets an unsupported
      triple; it was written against the defect and reproduced it before the fix.
      `mac-kickoff.sh --with-docker` now also runs `docker compose build api web`,
      because a static check is not a build and that lane is the only one with a
      daemon. Same shape as the three blockers before it: something reported
      success while not doing its job.

- [x] macOS / Windows desktop host-app demo (cross-platform parity) —
      `docs/embedded-desktop-demo.html` (published at `/desktop-demo.html`): the
      same invisible Assist flow as the mobile demo, in a generic NOC desktop app
      ("NetOps Console", no SignalGrid branding), where a config push to a core
      switch is held for a step-up then an in-app confirmation (two gates,
      fail-closed). A toggle swaps the native prompt Touch ID ↔ Windows Hello —
      the only per-platform difference. Ties the desktop story to the
      NOC/uptime + macOS-27 work. Self-contained, no external hosts; wired into
      the Pages deploy. CDP-verified across the full flow + both platforms.

- [x] DDM / device-health signal connector (`@workspace/ddm-connector`, macOS 27)
      — normalizes a Declarative Device Management report (enrollment, health
      reporting, binary-control state, declarative-privacy posture, last check-in)
      into the core's decision dimensions (deviceManaged / deviceCompliance /
      baselineCompliance / postureFreshness) plus an assurance hint. Fail-closed:
      any weak posture only raises assurance (auto → step-up), never lowers it —
      the proof caught and fixed a gap where an unknown/future-dated check-in
      wasn't raising. Complements OS binary control (the OS decides what launches;
      SignalGrid decides whether an action proceeds). Read API `GET /cp/v1/ddm`
      (OpenAPI + Postman); proof:ddm-connector (run in CI). See
      `docs/MACOS_27_DDM_SIGNAL_OPPORTUNITY.md`.

- [x] Data-center / NOC seeded tenant (Orion Data Centers) — the last vertical
      that was catalog-only now has a seeded tenant in BOTH the core (workflows
      matching the app-workflows catalog: noc-session / network-change /
      power-control / incident-response / facilities-control / compute-ops, NOC
      subjects spanning allow / restrict / step-up / deny, dock custody, policy,
      connector, owner key `sgk_demo_orion_owner`) and the control-plane (site,
      edge node, `noc_console` devices, signed bundle, telemetry). All **six**
      app-workflow catalogs now gate against a live decision, and the admin Fleet
      page + ops-intelligence span all six verticals. api test 113/113 (+ NOC
      config-push-held + power-cycle-blocked-under-restriction), control-plane
      proof 27/27, core proof 166/166. Completes the six-vertical story end to end.

- [x] Preflight mirrors the docs-sanity CI job — the required-docs check + the
      affirmative-unsafe-claim scan are now a shared `scripts/docs-sanity.mjs`
      used by BOTH the CI `docs-sanity` job and `pnpm run preflight`. A doc that
      trips the unsafe-claim denylist now fails preflight before the push, not
      just in CI. Preflight is now a complete mirror of all three CI jobs
      (validation, docs-sanity, supply-chain). `pnpm run docs:sanity` added.

- [x] Embedded host-app demo (worker-side invisible flow) —
      `docs/embedded-host-app-demo.html` (published at `/embedded-demo.html`): a
      generic clinical app ("Wardlink Chart", no SignalGrid branding in the phone
      frame) showing the loop from the worker's view — open chart / view results
      run with no friction (allow), a controlled med order is **held** for a
      step-up, the app triggers a native-style authenticator, and only the
      captured gesture releases it. A "behind the glass" panel (never seen by the
      worker) shows the `allow` / `step_up` decision. Step-up completion is a
      clearly-labeled demo simulation. Self-contained, theme-aware, no external
      hosts; wired into the Pages deploy. Realizes option (a) of
      `docs/EMBEDDED_UX_PRINCIPLE.md`.

- [x] Control-plane management-plane for retail + industrial — the
      `@workspace/control-plane` fleet rollup now spans five verticals: added
      **Vero Markets** (retail) and **Forge Industrial** (industrial) tenants
      with sites, edge nodes, fleet devices (new `pos_terminal` / `hmi_panel`
      kinds), signed policy bundles (keys matching the core), and telemetry, so
      the admin **Fleet & tenants** page and ops-intelligence rollups show all
      five. `Vertical` union + `VERTICAL_LABEL` extended on both the lib and the
      app client; Fleet UI renders them automatically. proof:control-plane (run in CI).
      Data-center/NOC remains catalog-only (its seeded tenant is the next item).

- [x] Invariant reviewer — public-safe-web check — `review:invariants` now also
      fails on any third-party vendor host (fonts / analytics / CDN) in a
      published web artifact (the Codex #81 font-CDN class), so a visitor's IP
      can't leak to a vendor. Self-host assets instead. Fifth invariant in
      `docs/SELF_REVIEW.md`.

- [x] signalgrid.app GitHub Pages deploy — the `Deploy site to Pages` workflow
      now publishes the `signalgrid-web` marketing site at the apex custom domain
      (base `/`), with the on-device console + battlecard preserved at
      `/console.html` and `/battlecard.html` and an SPA `404.html` fallback so
      deep links resolve. `site/CNAME` pins `signalgrid.app`. `docs/DOMAIN_SETUP.md`
      has the exact Namecheap DNS records (4× A + AAAA + `www` CNAME), the
      enforce-HTTPS / `.app` HSTS note, a WHOIS-privacy reminder, and a go-live
      checklist. Workflow stays manual (`workflow_dispatch`) — the owner runs it
      once after setting DNS + Pages source. Assemble verified locally.

- [x] Self-review layer — a second reviewer that runs BEFORE every push so a
      change is proven correct the first time (`docs/SELF_REVIEW.md`). Two parts:
      `pnpm run preflight` runs the whole CI gate suite locally in one command
      (typecheck / build / every proof / API test / safety / Postman sync), and
      `pnpm run review:invariants` is a deterministic adversarial reviewer that
      encodes the defect classes review keeps catching — fail-closed `default`
      arms in every gating-lib switch (Codex #70), determinism in the pure
      planners, critical⇒sensitive in the app catalog, and a truth-guard denylist
      for internal over-claims (Codex #79). Wired into CI. On its first run it
      caught two real fail-closed gaps (the app-workflow + orchestration
      `summarize` switches had no default arm) — now fixed.

- [x] Retail + industrial tenants in the core — two new seeded demo tenants
      (**Vero Markets** retail, **Forge Industrial** industrial) so the POS /
      age-rx-restricted and MES / SCADA-HMI app catalogs gate against a **live
      decision**, not a supplied one. Each has its own workflows (keys matching
      the app-workflows catalog: `pos-session`/`restricted-sale`, `line-ops`),
      shared-device policy, a spread of subjects (allow / restrict / step-up /
      deny), benign dock custody, webhooks, resolution config, and an owner demo
      key (`sgk_demo_vero_owner`, `sgk_demo_forge_owner`). Live in the admin
      App-workflows page. core proof 166/166 (relative counts), api test 110/110
      (+3 live retail/industrial gating assertions), safety gate green. The
      control-plane management rollup still shows three verticals — see "Now".

- [x] Data-center / NOC app catalog (P5) — a sixth vertical for
      `@workspace/app-workflows` gating the tools a NOC runs, with **uptime as
      the north star**: DCIM / change mgmt, network config, power / PDU, ITSM /
      incident, cooling / BMS, compute / orchestration. The uptime-affecting
      actions (execute a change, push config to a core device, power-cycle a
      rack, trigger a failover, bypass a change freeze) are `critical` → always
      sensitive: held for confirmation on allow, step-up when required, blocked
      under restriction/deny; reads/acks stay available so a NOC can always SEE
      even when it may not ACT. Confirmation phrased for the shift lead. Live in
      the admin App-workflows page; proof:app-workflows (run in CI; includes the
      NOC/uptime safety assertions). See `docs/APP_WORKFLOWS_OPPORTUNITY_MAP.md` §P5.

- [x] Admin "Grid intelligence" console — one calm surface (design law) tying
      flow-health/self-heal + learned recommendations + signal-discovery, read
      live from `/cp/v1`. Exceptions-first "Needs attention", advisory
      recommendations, and a discovery table that labels onboarding as a
      proposal (never a completed action). Route `/intelligence`.

- [x] Signal discovery + auto-onboarding (`@workspace/signal-discovery`) — tells
      admins what signals were detected across connected sources, classifies each
      (recognised / candidate / novel via signal-radar), and **auto-onboards** an
      unrecognised signal when its source exposes an API/connector — otherwise
      flags it for an admin (never silently added). Signal lifecycle
      (discovered → proposed → onboarded → active). Read API
      `GET /cp/v1/signal-discovery`; proof:signal-discovery (run in CI). The more
      sources/APIs a business opens, the more the Grid sees and uses.

- [x] Recommendations engine (`@workspace/recommendations`) — the Grid learns from
      observed usage and PROPOSES improvements (never applies): relax a gate that's
      always approved on healthy posture (one step), tighten an action showing
      denials/overrides, add a candidate signal to a flow that keeps breaking or
      runs hot, merge near-duplicate flows. Evidence-gated (min-sample threshold),
      confidence-ranked, advisory only. Read API `GET /cp/v1/recommendations`;
      proof:recommendations (run in CI).

- [x] Apple-inspired admin design law (`docs/ADMIN_DESIGN_PRINCIPLE.md`) —
      progressive disclosure, only-necessary-data, one source of truth, cross-
      surface consistency, calm-by-default; the test every admin surface must pass.

- [x] Admin flow layer (`@workspace/flows`) — administrators configure signals +
      flows; the Grid runs them. Per-action approval policy (automated / admin /
      dual / downtime-only user override with DR safety nets); flow + signal health
      (healthy / degraded / broken); a broken flow **self-heals** via a configured
      agent **or** raises an **ITSM-agnostic incident** (severity, support team,
      target ITSM named, never called); a grid-intelligence score that rises as
      more healthy signals feed more flows. Read API `GET /cp/v1/flows` +
      `/cp/v1/flows/health`; proof:flows (run in CI). See `docs/ADMIN_FLOWS.md`.

- [x] Embedded-UX design law captured (`docs/EMBEDDED_UX_PRINCIPLE.md`) — the end
      user never touches SignalGrid; everything happens inside the host app, for
      every role (frontline to CEO) and every platform (mobile / web / macOS /
      Windows). The `/v1/app-workflows/evaluate` product endpoint returns the plan
      AS DECIDED — a `step_up` keeps its high-assurance actions held; the API never
      releases them from a request-supplied signal.

- [x] App-workflow gating (`@workspace/app-workflows`) — SignalGrid now gates
      APPLICATION actions, not just physical ones: an app calls it before a
      sensitive action and gets back which of its actions may run automatically
      vs. which must be human-confirmed (Assist model), from a live decision.
      Catalog spans five verticals (healthcare EMR/BCMA/messaging/alarms;
      warehouse WMS/labor; industrial MES-HMI; fleet TMS/ELD/telematics; retail
      POS/restricted). New `GET /v1/app-workflows/integrations` +
      `POST /v1/app-workflows/evaluate` (OpenAPI + Postman), an "App workflows"
      admin page with live per-vertical gating, and `docs/APP_WORKFLOWS_OPPORTUNITY_MAP.md`.
      Proof: app-workflows 31/31 (incl. real-core EMR/BCMA end-to-end), api test 106/106.

- [x] Operational-intelligence rollups (Phase 3) — `operationalIntelligence()`
      on the control plane derives friction hotspots (from ingested telemetry),
      posture/config drift (nodes behind target bundle), and custody gaps
      (unreachable/degraded or stale-sync nodes) across sites, tenant-scoped.
      Exposed at `GET /cp/v1/ops-intelligence` (OpenAPI + Postman) and surfaced
      as a three-panel card on the admin Fleet page. Proof: control-plane 23/23.

- [x] Attestation verification — registration now verifies the attestation
      STATEMENT, not just the credential key. `none` (self-attested) is accepted;
      `packed` and `fido-u2f` are cryptographically verified (authData ||
      SHA-256(clientDataJSON), self- or x5c-attestation); any other format or a
      bad signature is refused (fail-closed). Proof: webauthn-verify 14/14
      (valid packed accepted; forged sig, alg/key mismatch, unsupported format,
      malformed none, malformed fido-u2f all rejected).

- [x] Global-fleet scenario pack — a third vertical (Meridian) added to the core
      seed and the Trusted-Entry runner + console: vehicle-mount field session and
      cross-region regulated-cargo checkout, across the full allow / step-up /
      restrict / deny spectrum. Fleet orchestration catalog (vehicle unlock,
      mount session, TMS route, cargo seal, dispatcher co-sign) + dispatcher
      confirmation language, cross-tenant fail-closed. Proof: room-sim 39/39,
      orchestration 40/40, core 166/166.

- [x] Warehouse scenario pack — the Trusted-Entry runner + on-device console now
      span two verticals: smart-hospital (Northwind) and warehouse (Atlas), with
      pick-aisle and controlled high-value/hazmat cage scenarios across the full
      allow / step-up / restrict / deny spectrum. Domain-aware orchestration
      catalog (zone gate, handheld, WES/WMS task, cage, supervisor witness) +
      confirmation language, cross-tenant fail-closed. Proof: room-sim 22/22,
      orchestration 35/35. (Also fixed a pre-existing api-contract parser bug
      where `/cp/v1/*` methods leaked onto the last `/v1` path.)

- [x] Per-vertical policy bundles surfaced in the admin Fleet UI — each tenant
      shows its signed bundle version + the workflow set it distributes
      (healthcare: clinical-session/med-admin; warehouse: pick-pack/controlled-area;
      global-fleet: field-session/vehicle-checkout). Reads `/api/cp/v1/policy-bundle`.

- [x] Signed policy bundles — config-down bundle is HMAC-signed (authenticity)
      on top of the checksum (integrity); edge verifies signature before applying,
      fail-closed on a checksum-valid forgery. Proofs updated (edge-sync 15/15,
      control-plane 17/17).

- [x] Telemetry-up wiring — real /v1 core decisions aggregated and ingested into
      the control-plane rollup (proof:telemetry-up, 7/7).
- [x] `/cp/v1` documented in the OpenAPI spec + Postman collection (with a
      lockstep coverage check for both `/v1` and `/cp/v1`).
- [x] Edge-sync contract proof — walks a node behind → synced (pull, verify
      checksum, reject tampered bundle fail-closed, apply, idempotent). 12/12.
- [x] Control-plane admin surface — "Fleet & tenants" page reading `/api/cp/v1/*`
      (rollup, per-vertical breakdown, edge-node sync + health across verticals).
- [x] SaaS control-plane scaffold (`@workspace/control-plane`) + `/cp/v1` routes
      + proof (3 verticals: healthcare / warehouse / global fleet).
- [x] WebAuthn step-up hardening (exact origin, User-Verification required).
- [x] Live `/v1` decision panel on the admin dashboard.
- [x] Admin console → api-server data layer; marketing site; deployment models;
      IGA adjacency; founder portfolio; multi-vertical narrative.

## Discovered

### The event contract cannot express "we were blind" — OWNER-GATED (2026-09-14, from the iLOQ intake)

`lib/event-contract/src/types.ts` carries exactly **one** time field: `occurredAt`,
"supplied by the emitter". There is no `ingestedAt` / `receivedAt` / `recordedAt`
anywhere in the canonical contract (verified by field enumeration and by grep across
`lib/` and `artifacts/api-server/src`; `occurredAt` has only two non-fixture consumers,
`validate.ts` and the CAEP format adapter).

In the **connected** topology `SIGNALGRID_SMARTDOCK.md` assumes — "the dock connects to
power and network" — that is harmless: occurred-time and learned-time are the same
instant. In a **carrier** topology, where a puck or phone physically ferries state
between an offline endpoint and the fabric (the shape iLOQ ships, and the shape
`SESSION_PUCK_HARDWARE_HYPOTHESIS.md` describes), every event is late by construction
and the gap between those instants IS the blind window. One timestamp cannot carry both,
so a stale fact and a just-learned one are the same value and nothing downstream can
raise assurance for the window — which golden rule 2 would otherwise require.

The repo already refuses this exact collapse one layer down:
`firmware/dock/core/src/custody.rs` — built firmware, unlike the deferred dock families
above — keeps `NotReported` and `Faulted` distinct because
"a sensor that is simply absent from this build is not the same as one that answered
with garbage or timed out".

**Why this is not built here.** Adding a field to the canonical event contract is a
decision-core change (DR-020 territory) and needs a decision record the lane may not
write. The custody/dock families are also still deferred in the launch profile, so
nothing about this is claimable today. The shape a record would have to settle, stated
so the decision is cheap to make and not re-derived:

- whether the second instant is a contract FIELD or a transport-layer envelope value
  that never enters a decision path (determinism: no clock in `lib/signalgrid-core`);
- whether an absent second instant means "connected topology, treat as simultaneous"
  (fail-open) or "unknown blind window, raise assurance" (fail-closed) — the latter is
  what golden rule 2 says, and it changes every existing emitter;
- whether the blind window is evidence only, or gates a verdict.

No code, contract, proof, gate or claim changed for this entry.
### Wiring the custody-ledger evaluator into `/v1` needs a package extraction first — OWNER-GATED, deferred family (2026-09-14, measured by attempting it)

`evaluateCustodyLedger` grades the custody contradiction the runbooks cite most (the custody
and dock families stay deferred in the launch profile; none of this is shipped or claimed) — what the
checkout ledger says about a device against what the dock bay sees, plus the requester's
cap. It is built, proven by `proof:rtls-custody`, and has **no product caller**: its only
callers are its own file and its proof, and `artifacts/api-server/src` imports
`@workspace/integrations` zero times. (Correcting a stronger claim made earlier the same
day: the family IS exported — `./rtls-custody` is one of 67 per-family subpath exports in
`lib/integrations/package.json`. It is reachable; nothing reaches for it.)

**The wiring was built end to end and then reverted, and the reason is the useful part.**
Nothing below is a claim of current capability — the family remains deferred.
Two read-only fixture-backed routes (`GET /v1/custody/ledger/fixtures` and
`/fixtures/{name}`) worked against a live server — the phantom fixture graded
`stale_return` / `step_up` / `CUSTODY_STALE_RETURN_OTHER`, `readyForCheckout: false`, with
the contradiction named; unknown name 404, unauthenticated 401 — and `test:api` went
409/409 to 416/416. Eleven surfaces stayed in sync (OpenAPI spec, API tests, the
route-count figure, Postman requests + env, two derived request counts, a file-length
figure, the claim-inventory anchors after the spec insertion moved a cited line, the Bruno
collection + env, and four `.bru`-count sentences).

**What stopped it: `check-deployment-runbook.mjs`.** That gate resolves the server's
TRANSITIVE `@workspace/*` runtime dependencies to their source dirs and requires every env
var any of them boot-reads to appear in the deployment runbook's table. Declaring
`@workspace/integrations` as an api-server dependency therefore adds **80 distinct env
vars** — measured, not estimated — taking the documented surface from 119 to ~199.
Narrowing the import to a new `./rtls-custody/custody-ledger` subpath did NOT help: the
gate reads the dependency graph, not the import graph, which is the correct design because
a declared runtime dependency *could* read any of them.

Those 80 belong to other deferred families — access-governance, agent-behavior, agent-identity,
credential-exposure, MDE, SSO, SSE and more — and the custody route cannot use one of
them; `evaluateCustodyLedgerFixture` is pure. Documenting them to pass the gate would tell
an operator those knobs exist on this service when they do not, which is the exact
dishonesty the runbook gate exists to prevent. Fixing the copy to fit the gate is right;
fitting the gate's *inputs* to the copy is not.

**The shape that would work**, for whoever takes it, with the family still deferred: extract
the evaluator into its own
small workspace package with no env reads (`custody-ledger.ts` imports exactly one thing,
`posedBound` from `../../utils/posed-bound`), have `rtls-custody` re-export from it so
there stays one definition and one proof, and depend the api-server on that. It is a
`lib/**` structural change (DECISION_PATH under `classifyDiff`), so it is owner-gated and
wants a deliberate decision rather than a rider on an unrelated branch.

The honest summary, for a family that stays deferred either way: the custody layer is not
unwired by oversight. It is unwired because
the obvious wiring widens the API's configuration surface by 80 variables it cannot use,
and a gate refuses to let that go undocumented.

### api-zod / v1 input-validation hardening — design targets (2026-09-04, from the fail-closed audit)

Filed from the `lib/api-zod` fail-closed audit (recorded in `docs/agent/EVIDENCE.md`). No
live fail-open — the schemas are fail-closed by construction and the live `/v1` boundary
(`v1.ts` → core `validateRequest`) is fail-closed end-to-end. **These are design targets,
not shipped, and none is a live loosening.** Public-safe and fixture-first.

- [x] **api-zod wiring gate — a defined-but-dead input validator must not masquerade as coverage (design target, MEDIUM).** The generated `*Body`/`*QueryParams`/`*Params` schemas in `lib/api-zod/src/generated/api.ts` are mostly never invoked; the live `/v1` routes hand-roll validation in `artifacts/api-server/src/routes/v1.ts`. Add a gate that derives the exported generated input schemas and asserts each is referenced by a `.parse`/`.safeParse` in `artifacts/api-server/src/routes/**` (flagging orphans), OR deliberately mark the api-zod input schemas client/type-only. Must not assert *where* or *that the call is correct* — only non-orphaned. gate-and-proof-engineer. Lane: devex-tooling-engineer. **DONE 2026-09-18** — the deliberate CLIENT/TYPE-ONLY marking, made checkable: `lib/api-zod/src/index.ts` now states that the input schemas are a client contract and not the served boundary, and `scripts/check-api-zod-wiring.mjs` (preflight + CI, `--self-test` 13/13) derives the 13 exported `*Body`/`*QueryParams`/`*Params` schemas and fails on any that is neither invoked by `.parse`/`.safeParse` under `artifacts/api-server/src/routes/**` nor declared client/type-only with a reason. Live: 1 WIRED (`GetIntegrationParams`), 12 declared. It asserts non-orphanhood only — never where, never that the call is right. It also REPORTS (never fatal) the 7 schemas whose operationId is gone from `openapi.yaml`, re-derived from the spec rather than labelled by hand.
- [x] **Latent api-zod schema tightenings — fix in the OpenAPI source, not the generated file (design target, LOW; deferred until the schemas are wired to a boundary).** `z.string()` with no `.min(1)` on identity/device/tenant/workflow fields; `z.coerce.number()` `limit` with `""`→0 and no `.int().min().max()`; `sourceTimestamp` `z.coerce.date()` with no upper bound (far-future reads as always-fresh). The file is orval-generated ("Do not edit manually"), so the durable fix is the OpenAPI spec + regenerate; a gate on the generated output will re-fire until the spec is corrected, which is correct. Lane: api-contract-architect. **DONE 2026-09-18** — fixed in the OpenAPI source, by DELETION: every field this row names (`identityId`/`deviceId`/`workflowId` with no `minLength`, `sourceTimestamp` with no bound) lived in `DecisionRequest`, `SignalIngestionRequest` and `PolicyInput` — three components left dangling when the six never-served write operations were pruned, referenced by no path. Decorating dead schemas with `minLength` would have been ceremony; they are gone from `lib/api-spec/openapi.yaml`, and the generated `EvaluateDecisionBody`/`IngestSignalBody`/`CreatePolicyBody`/`UpdatePolicyBody` go with them at the next regeneration (still blocked on orval 8.24 vs zod 3.25 — its own row below; `check-api-zod-wiring.mjs` REPORTS those 7 until then). The one LIVE tightening, `limit`: both query parameters now carry `minimum: 1`/`maximum: 200` and the default the handler actually uses, gated by `scripts/check-api-fixture-contract.mjs` rule R3.
- [x] **Estate posture refresh loop.** **DONE 2026-09-18** — `SIGNALGRID_ESTATE_REFRESH_SECONDS` (integer, ≥30s) starts a server-side interval in [`artifacts/api-server/src/lib/core.ts`](../artifacts/api-server/src/lib/core.ts): wall time is read there, at the boundary, and the records are handed to `SignalGridCore.refreshEstatePosture()` ([`lib/signalgrid-core/src/engine.ts`](../lib/signalgrid-core/src/engine.ts)), which re-runs the same `runPostureSync` — same normalization, same skip-and-count rule, one sync-run record per pass, an audit line per pass, and a 403 on a demo core. The knob is documented in `docs/DEPLOYMENT.md`'s table and passed through `docker-compose.prod.yml` (`node scripts/check-deployment-runbook.mjs` holds the three in sync); set on a non-estate core or below the floor it refuses at boot. Checks: `pnpm run proof:estate-refresh` (15/15, `--self-test` catches a refreshed unknown-compliance read as compliant) and four `test:api` assertions against a running estate server. LEFT: a refresh re-applies posture to subjects the boot read established — a device the source starts reporting AFTER boot is skipped and counted, never added; adding subjects at refresh time is a separate decision (it changes who the deployment can decide about). Original text follows. `SIGNALGRID_CORE=estate` reads Graph posture ONCE at boot; a device that changes compliance an hour later is decided on stale signals until restart (posture_freshness ages honestly, so the verdict tightens, but never re-reads). Needs a scheduled re-read on the connector-worker interval that re-runs `runPostureSync` for the estate connector, with the same skip-and-count rule and a sync-run record per pass. Discovered 2026-09-18 while landing the non-demo constructor. Lane: principal-engineer.
- [ ] **Screen inventory and investor demo-path brief for the operator surfaces (design, MEDIUM; owner decides who designs).** No screen has had a design pass: the admin console (`artifacts/signalgrid-app`), operator console (`artifacts/signalgrid-review`), mobile PWA and desktop shell are engineer-built against two written laws (`docs/EMBEDDED_UX_PRINCIPLE.md`: the worker never sees SignalGrid; `docs/ADMIN_DESIGN_PRINCIPLE.md`: the admin console "just works") and three gates (WCAG AA decision palette, iOS Dynamic Type, browser E2E). What a designer would start from does not exist yet: an inventory of every screen per surface with its launch status from `scripts/launch-profile.mjs` (app-surfaces: 3 launch, 5 deferred, 7 demo-only, 15 internal on 2026-09-18), and ONE demo path — a decision minted in the admin console and answered in a host-app embed on a supervised iPhone — written as the sequence of screens an investor sees. Deliverable is a doc, cloud-buildable; hiring or contracting the designer is the owner's call (asked 2026-09-18). Lane: brand-design.
- [x] **Defense-in-depth: reject empty bindings at the `/v1` boundary too (design target, LOW).** `parseEvaluate` (`v1.ts`) accepts an empty-string `identityRef`/`deviceRef`/`workflowKey`; the core's `validateRequest` already rejects it (`decision.ts:208`, `.trim().length === 0` → 400), so this is not a live fail-open — but rejecting at the boundary too matches the empty-scope-is-not-a-wildcard lesson (control-plane Finding 3). Lane: api-contract-architect. **DONE 2026-09-18** — `parseEvaluate` (`artifacts/api-server/src/routes/v1.ts`) now also rejects a trimmed-empty `identityRef`/`deviceRef`/`workflowKey`; both `/v1/decisions/evaluate` and `/v1/authorize` parse through it, so the guard lands once for both. Check: `test:api` asserts the 400 carries the BOUNDARY's message (`required non-empty strings`) rather than the core's `Field "identityRef" is required…` — a status-only assertion passes with the guard deleted, which is why it is pinned on the message; 414/422 with the guard removed (verified).

### Shared-device custody fidelity — design targets (2026-09-04, from the owner's real runbooks)

Filed from [`docs/research/SHARED_DEVICE_CUSTODY_GROUND_TRUTH.md`](research/SHARED_DEVICE_CUSTODY_GROUND_TRUTH.md),
which mapped a real shared-clinical-device deployment onto the tree. The domain fits the
existing surfaces almost one-to-one; these three are the genuine fidelity gaps. **These are
design targets, not shipped capability.** All touch the decision core / simulator
(behaviour), so each is DR-020 territory (deferred) — a decision record first, then one
reviewable PR with a deterministic proof. Public-safe and fixture-first.

- [x] **"Phantom custody" — a device checked out to a prior holder, or unpaired yet occupying a dock slot (custody ground truth, HIGH). MODELED 2026-09-11** as a checkout DECISION, not (yet) a timeline detection: [`lib/integrations/src/integrations/rtls-custody/custody-ledger.ts`](../lib/integrations/src/integrations/rtls-custody/custody-ledger.ts) grades what the ledger says against what the bay sees — a seated device still assigned to a prior holder is a hold naming `stale_return_other`, an unpaired device in a bay is contained (`CUSTODY_UNPAIRED_IN_SLOT`), a clear ledger over an empty bay escalates (`CUSTODY_DEVICE_UNACCOUNTED`); a sweep of all 4,320 combos pins the single grant (`proof:rtls-custody`). The `detect.ts` detection over the event timeline is split out to the next row. Original text kept for the record: (deferred design target).** The single most-cited operational pain: a returned device still reads as another person's, or sits unpaired in a bay while the console shows it present. That is a custody-state contradiction across the dock, MAM and posture planes — exactly the shape [`lib/event-contract/src/detect.ts`](../lib/event-contract/src/detect.ts) exists to catch, and no current detection covers it. Add a deterministic `CUSTODY_STALE_OR_CONTESTED`-style cross-domain detection with fixtures, and an assertion that fails if it stops firing on the contested timeline. Cloud lane.
- [x] **Checkout-cap contradiction surfaced as a decision, not a mystery beep (custody ground truth, MEDIUM). MODELED 2026-09-11** in the same surface: the cap axis is COMPUTED from the requester's open-checkout count, the tenant cap and the count of those checkouts physically docked — a cap hit only by returns that never cleared holds with `CUSTODY_CAP_BLOCKED_BY_STALE_RETURN`, a cap genuinely reached is contained with `CUSTODY_CAP_REACHED`, a missing count is unknown and raises, contradictory counts are malformed. No decision record was needed: it is a read-only evaluator in an integration family, not a decision-core change. Original text kept for the record: (deferred design target).** A per-user checkout cap that blocks a clinician because a prior return never cleared is a fabric-visible condition today only as a dock beep code. Model the cap state and emit a legible reason when it blocks, with a fixture. Small state addition; DR first. Cloud lane.
- [x] **`CUSTODY_STALE_OR_CONTESTED` as a cross-domain DETECTION over the event timeline (custody ground truth follow-up, MEDIUM; decision-core, DR first). BUILT 2026-09-13 — PROPOSED via PR #720 (DR-051), owner-gated (SAFETY_MACHINERY: decision-core + DR + fixtures/proof); not merged.** Added a sixth detection `CUSTODY_STALE_OR_CONTESTED` (severity `high`) to [`lib/event-contract/src/detect.ts`](../lib/event-contract/src/detect.ts) beside `CHECKOUT_WITHOUT_COMPLIANCE`: fires on any of three custody contradictions from the pure event stream (no ledger read) — a bay re-locked around a still-checked-out device (`dock_relocked` + open grant, no return), more than one grant with no clearing return (contested), or a seated device unpaired/unknown in posture (phantom slot). Fail-closed and deterministic: only adds a detection, an absent return is read as "still out", an unknown posture fires. Proven by five assertions ADDED to the existing `proof:event-contract` (three positive shapes, a severity+evidence check, and a negative control that a properly returned-and-racked device does NOT fire it). See DR-051. Original text kept for the record: The custody-ledger evaluator grades one reconciliation report; the timeline form — a `device_returned` / `dock_relocked` sequence with no matching ledger clear, seen in [`lib/event-contract/src/detect.ts`](../lib/event-contract/src/detect.ts) beside `CHECKOUT_WITHOUT_COMPLIANCE` — would catch the same phantom from the event stream without a ledger read. Decision core (DR-020 territory): a decision record first, then fixtures and an assertion that fails if it stops firing. Cloud lane. Lane: principal-engineer.
- [x] **`CUSTODY_CAP_BLOCKED_BY_STALE_RETURN` as a cross-domain DETECTION over the event timeline (custody ground truth follow-up, MEDIUM; decision-core, DR first). BUILT 2026-09-14 — PROPOSED via PR #724 (DR-052), owner-gated (SAFETY_MACHINERY: decision-core + DR + fixtures/proof); not merged.** The twin of the row above for the checkout cap: the `rtls-custody` ledger evaluator (row above this pair) grades the requester's open-checkout count against the tenant cap into `CUSTODY_CAP_BLOCKED_BY_STALE_RETURN`; the timeline form — a `checkout_denied` seen against a prior custody that never cleared (an open `checkout_granted`/`device_removed` with no `device_returned`, or a `non_return`/`custody_expired` on record), added to [`lib/event-contract/src/detect.ts`](../lib/event-contract/src/detect.ts) beside `CHECKOUT_WITHOUT_COMPLIANCE` — surfaces the cap block as a legible decision from the event stream with no ledger read, so the clinician's "mystery beep" is named. Fail-closed and deterministic: an absent return is read as "still out", a lapsed prior raises assurance, the block is surfaced (never a grant), and a bare denial with no prior open custody is not falsely attributed. Proven by six assertions ADDED to the existing `proof:event-contract` (three positive shapes, a severity+evidence check, and two negative controls). See DR-052. Cloud lane. Lane: principal-engineer.
- [ ] **Brace-less guards join the mutation sweep, family by family (gate infrastructure, HIGH; ratchet opened 2026-09-11).** `scripts/mutation-guard.mjs` gained the `oneline-cond-false` mutator (`if (...) return x;` → `if (false) return x;`), the guard shape three reviews had found invisible to the sweep. Measured over every registered file before it landed: 1732 mutations, 117 new survivors across 41 files (plus 4 break-glass disjuncts a separate PR fixes). A gate that goes red over 117 unpinned guards gets switched off, so the mutator applies only to targets that opt in (`oneLine: true`) after their one-line guards are pinned by checks that fail without them or documented inert with a reason, and every run prints the census of targets that have not joined. Joined at the opening: rtls-custody, device-attestation, verdict-attestation (11 guards pinned — two of them the alg-membership and key/alg-mismatch refusals in signature verification, which no input had ever exercised), app-update (two shadowed guards deleted, three pinned). Pending, by survivors measured 2026-09-11: facility-trust-graph 22 · dual-control 7 · benchmark-selection 7 · bootstrap-credential 6 · macos-posture 5 · sse-egress, shift-context, pacs-access, nac, change-window 4 each · uem, service-lifecycle, pim-activation, passkey-assurance, challenge-capability 3 each · vuln-scan, task-exception, agent-behavior 2 each · sso-session, policy-binding, platform-sso, observability-integrity, network-nac, local-authority, entitlement-binding, device-management-health, decision-continuity, custody-beacon, credential-rotation, caep-events, agent-identity, access-governance 1 each. When `nac` joins, re-register `nac/cisco-ise.ts` and `nac/aruba-clearpass.ts` (de-registered 2026-08-25 for exactly this shape). Cloud lane. Lane: devex-tooling-engineer.
- [x] **A faithful end-to-end smart-charging simulator scenario (custody ground truth, MEDIUM; deferred design target).** The simulator carries no scenario shaped like the real workflow (badge → dock → provision → in-use → check-in) with its real failure branches (unpaired / network-down / cap-hit / dock-fault). Add one so proofs exercise the real thing rather than abstractions. Builds on the remediation-allow cascade ([`lib/signalgrid-simulator/src/remediation-allow.ts`](../lib/signalgrid-simulator/src/remediation-allow.ts)). Cloud lane. Lane: qa-engineer.
      **DONE 2026-09-18** — `smart-charging-checkout-to-checkin` in
      [`lib/signalgrid-simulator/src/scenarios.ts`](../lib/signalgrid-simulator/src/scenarios.ts):
      badge at the cabinet, seated and charging to the cap, provisioned, in use, taken by
      the holder the assignment names. The four failure branches are DERIVED from that same
      fixture in [`scripts/src/signalgrid-simulator-proof.ts`](../scripts/src/signalgrid-simulator-proof.ts)
      — unpaired (no assignment claims the checkout), network-down (the cabinet controller
      is unreachable), cap-hit (the charge cap held it at 22% for a full round), dock-fault
      (returned to a bay the assignment does not name) — so each branch differs from the
      green run by exactly the fact it names; a branch built from scratch could differ in
      ten ways and prove nothing about which. The load-bearing assertion is that the happy
      path is the ONLY one of the five that allows. Falsified: flipping the unpaired
      branch's `active` back to true turns three assertions red. The last `gap` row in
      `docs/research/SHARED_DEVICE_CUSTODY_GROUND_TRUTH.md` is now `modeled`, and
      `node scripts/check-readiness-figure.mjs` prints `(a) runbook ground truth 100% — 17
      modeled / 0 partial / 0 gap`. How you'd check: `pnpm run proof:signalgrid-simulator`
      → `102/102`.

### ECC-role review findings (2026-09-01) — the ones not fixed in the same pass

- [x] **UEM's check-in freshness axis was a dead axis presented as coverage (independent sweep, HIGH).** **DONE 2026-09-01:** `lastCheckInAgeSeconds` was documented on `NormalizedUemDeviceState` as this family's freshness axis while all three adapters hardcoded it `null`, `evaluateUem` never read it, only the fixtures carried numbers, and `evaluateUem` has no caller outside its own proof. The proof's one assertion about it (`null || Number.isInteger(...)`) could not fail — `null` satisfied it for every fixture and it would have stayed green after the field was deleted. Field removed from the type, the three adapters, the unknown-vendor record and every fixture; Jamf's `last_contact_time_utc` payload declaration is KEPT with a comment saying the vendor reports it and this family does not grade it; the vacuous assertion is replaced by a source scan that fails if the token reappears anywhere under `lib/integrations/src/integrations/uem/`, with a positive control so an empty walk cannot pass. Planted and reverted in both directions before claiming it. `proof:uem` 75 -> 76 checks, the state sweep and the nine-grant pin unmoved, mutation guard 29/29 killed. **The design for when this family gains a real consumer** (do not rebuild it before then): adapters carry `lastCheckInAt: string | null` — the vendor's own timestamp, not a derived age — `evaluateUem` takes `options.nowMs` plus a posed bound `staleCheckInSeconds` via `posedBound`, and grades with the four members of `mapCheckInFreshness` in `lib/integrations/src/integrations/device-management-health/graph-transport.ts` (`fresh`/`stale`/`never`/`unknown`, future-dated reads to `unknown` so a skewed clock cannot look healthy). `unknown` FORECLOSES — step_up at most, never a grant and never a deny — and is unreachable without a posed clock, so an unposed caller keeps today's behaviour byte-identically. Note two dated ledger rows in `docs/INTAKE_LEDGER.md` (rows 48 and 31) describe the field in the present tense; they are records of an adjudication on their date and were left alone.
- [x] **`verdict-attestation` reads two posed bounds with `??` (posed-bound gate, reported not gated).** **DONE 2026-09-04** (re-found by the surface-review sweep and fixed with the package's own copy of the rule, as this row proposed): `verifyVerdict` now fails closed on a non-finite verification clock or bound — `if (!Number.isFinite(options.now) || !Number.isFinite(maxAge) || !Number.isFinite(maxSkew)) return fail("expired")` — before the two freshness comparisons, because `x > NaN`/`NaN > x` are both false and a `NaN` `now`/`maxAgeMs`/`maxSkewMs` (which `??` does not fill) would silently disable both checks and let a stale/future attestation verify. `isMalformed` already guarded `att.issuedAt`; this closes the caller-supplied half. Six proof vectors added (NaN clock → `expired` and never verified; Infinity clock → expired; non-finite maxAge/maxSkew cannot switch the check off; `openVerdict` on a NaN clock degrades to step_up), five of which fail without the guard (Infinity is already caught by the expiry comparison). `proof:verdict-attestation` 76 → 82 checks; the "(76 checks)" figure in `docs/PRODUCT_CORE_THREAT_MODEL.md` updated to 82; falsified in both directions.
- [x] **Two freshness values computed and consulted by nothing (sweep, MEDIUM).** `edr-threat/edr-connector.ts` carries `lastSeen` and `graph/posture-connector.ts` carries `deviceLastSeenAt`; no evaluator reads either, so a record last updated years ago that still claims a healthy agent grades protected. Grade them or stop carrying them. Lane: secops-domain. **DONE 2026-09-18 — GRADED, both of them.** EDR: `evaluateThreatPosture` (`lib/integrations/src/integrations/edr-threat/evaluate.ts`) grades `lastSeen` through the shared `deriveFreshness` against a CALLER-POSED `nowMs` (no clock is read — golden rule 2); stale or unknown adds an `ENDPOINT_NOT_RECENTLY_SEEN` / `degraded_protection` / `step_up` candidate, and the verdict gained `lastSeenFreshness`, whose fourth member `"ungraded"` means no instant was posed — so a verdict can no longer read as "seen recently" when the question was never asked (the `segmentPolicy` precedent in `network-nac/evaluate.ts`). Graph: `fromDevicePosture` (`lib/posture-composition/src/adapters.ts`) now reads `deviceLastSeenAt` — the last field on `GraphPostureSignal` it did not read — against the signal's OWN `observedAt`, so no clock is needed and the adapter stays pure; `DEVICE_POSTURE_STALE` and `DEVICE_LAST_SEEN_UNKNOWN` are separate `step_up` candidates, which is the "a grant requires positive confirmation of every input" rule that function already states, applied to the input it had missed. Checks: `pnpm run proof:edr-threat` 60/60 (eight assertions: fresh grants, stale raises, absent/unparseable/future-dated raise as unknown, unposed is `ungraded`, an active threat still outranks, a garbled bound raises) — 56/60 with the candidate removed; `pnpm run proof:posture-composition` 86/86 (eight assertions incl. a non-vacuity grant and a never-denies check) — 81/86 with the candidates removed. `check-freshness-divergence` and `check-nan-fail-open` green.

Two were fixed immediately (fleetDMFreshness future-date fail-open; /v1/step-up/challenge
authorize gap). These remain; see `docs/agent/REVIEW_STRUCTURE_COMPARISON.md`.

- [x] **Durable audit ledger is tenant-less and /v1/audit reads the in-memory ledger (architect, CONFIRMED high — candidate decision record).** **DONE 2026-09-01 (DR-025):** nullable `tenant_id` (migration v3), hashed only when present so pre-column rows keep their hashes, tenant-scoped READ over the one global chain, `/v1/audit` names its source (`durable` | `memory`) and pages; the Postgres half (migration v3 + every pg proof) ran on a disposable cluster in the cloud lane. Original finding: `audit_ledger` (migrations.ts:43) has no `tenant_id` while its sibling tables all do; `/v1/audit` (v1.ts) returns the in-memory `core.listAudit()` (wiped on restart, per-replica), and decision-evaluation audit events are never persisted durably while admin events go only to the durable global chain. You cannot hand tenant A a verifiable copy of only its events. This is the compliance differentiator — it needs a deliberate design (schema migration + tenant-scoped durable read + wiring /v1/audit to the durable ledger), likely a DR, not a rushed patch.
- [x] **Dead code: competing webhook implementations + unreachable adapters (refactor-cleaner, 3× medium).** Two webhook-endpoint implementations (the unused one still carries a full CRUD/admin surface) — open, not yet verified. Three vendor adapter files (siem/sentinel.ts, siem/splunk.ts, telemetry/mde.ts) unreachable from their own factories — declined, `scripts/src/emit-gate-proof.ts` reads their source. `webhooks/emitter.ts` — `webhooks/emitter.ts` went in the third cut, not the second (PR #366 claimed it; the file was still tracked; see FALSE_CLAIMS `pr-366-deleted-webhooks-emitter`). Lane: devex-tooling-engineer. **DONE 2026-09-18** — the open third ("two webhook-endpoint implementations, the unused one still carries a full CRUD/admin surface") is VERIFIED AND DOES NOT HOLD. Both are reachable and do different jobs: `lib/signalgrid-core/src/webhooks.ts` (`deliverEvent`) is on the served decision path (`decision.ts:180`) behind `GET /v1/webhooks` and `/v1/webhooks/deliveries`, and `lib/integrations/src/integrations/webhooks/**` is the emitter family two proofs and six gates exercise. Inside `webhooks/store.ts`, `getWebhook` and `listWebhooks` have no EXTERNAL caller but are called by `updateWebhook` and by `getWebhooksForEvent` (3 live callers), so they are not dead; `updateWebhook` is deliberately retained as the marked trap of the open security-engineer row above. Truly dead and DELETED: `export interface WebhookWithNewSecret` — zero references anywhere in the tree, including inside its own file (grep + `pnpm run typecheck` clean). `emitter.ts` is already gone; the three vendor adapters stay declined for the reason recorded.
- [x] **iOS ExpiryPolicy/isExpired has no unit test (code-reviewer, medium — native lane).** The Mac lane's 5e3b5c3 nil-expiry fix is safety-critical and framed as closing a fail-open, but no EnterpriseShellTests file exercises `SessionData.isExpired`/`ExpiryPolicy` — a wrong-logic edit inside an existing case would compile and pass every gate. Add a Swift unit test. Mac lane. **DONE (a9116532):** `native/ios/EnterpriseShellTests/SessionExpiryTests.swift` (6 cases) pins the contract and was falsified against the old `.nonExpiring: return false` — the two blank-justification cases go red, the rest stay green. Hardened alongside: a `.nonExpiring` whose justification is blank reads as expired, because the justification is what makes that case a deliberate state rather than an unknown one. Scope stated honestly on land (cloud review): this is a value invariant, not a persistence defence — `KeychainService.getSession` has no caller today, a malformed blob throws on decode rather than yielding a blank justification, and a tamperer can write any justification; what it closes is a future producer that mints an unjustified `.nonExpiring`. `native/ios/EnterpriseShell/Models/SessionData.swift` wired into both the Xcode test target and the SwiftPM port. Verified on the Mac: xcodebuild TEST SUCCEEDED 63/0.
- [x] **Performance figures quoted outside `RELIABILITY_SLO.md` have no gate (fail-closed auditor, medium, 2026-09-02).** The four capacity figures (the 240/min limiter default, 585 req/sec over HTTP, 1,529 and 5,370 decisions/sec in process) are restated in `docs/DEPLOYMENT_MODELS.md` with their measurement date beside each, which is the dated-measurement rule's shape but not a binding: `check-derived-doc-figures` sweeps only tree-derived values, `check-proof-figures` binds figures to `proof:*` scopes, and neither reads a bare `240` or `585`. Specify: extend the derived-doc-figures sweep with a named set of performance figures whose authority is `RELIABILITY_SLO.md`, asserting every other occurrence under `docs/**` sits within the 80-character dated window or carries a declared exemption; exempt the historical quotations in `CLAIM_INVENTORY.md`, `INTAKE_LEDGER.md` and the product-limit quote in `PARTNER_ONBOARDING.md`; never cover percentile tables, which move on every runner; validate by planting a drifted figure in the deployment doc and watching it fail. Cloud lane. Lane: devex-tooling-engineer. **DONE 2026-09-18** — `scripts/check-performance-figures.mjs` (preflight + CI, `--self-test` 16/16). The three units are matched by their UNIT PHRASE, so a DRIFTED number is a hit rather than a miss, and each value is lifted from its own source instead of typed: `585 req/sec` and `1,529`/`5,370 decisions/sec` from `RELIABILITY_SLO.md`, with a date required within 80 characters of either end of the phrase; the `240`/min limiter from `limitFromEnv("SIGNALGRID_V1_RATE_LIMIT", 240)` in `rateLimit.ts`, with NO date required because it is a shipped constant rather than a measurement. Exemptions are declared with reasons (CLAIM_INVENTORY, INTAKE_LEDGER, PARTNER_ONBOARDING, this file, and API_SIGNAL_DISCOVERY's Verkada quota) and a stale one fails. Percentile tables are out of scope by construction — no unit matches milliseconds. Two LIVE findings fixed: `COMPANY_BUILD_PLAN.md` quoted the superseded 5,128 attributed to RELIABILITY_SLO.md and undated (COST_MODEL's twin was repaired by hand on 2026-09-06 and this copy was not), and `DEPLOYMENT_MODELS.md` put its date out of reach of the 1,529 phrase. Validated as the row asks: a planted `900 requests per second` in the deployment doc fails.
- [x] **sim-result provenance can name a commit not in the repo (fail-closed auditor, medium, 2026-09-02).** `artifacts/sim-results/2026-09-02-ios-shell-repair.json` stamps `provenance.commit` 0c7f53a2, which `git cat-file -e` cannot resolve on Alpha — the sim runner samples the local HEAD before the runs (CLAUDE.md), and a squash-land drops that sha from shared history, so the committed provenance points at nothing and its green attestation cannot be checked. Specify a gate: for each `artifacts/sim-results/*.json`, assert `provenance.commit` resolves via `git cat-file -e` AND is an ancestor of HEAD, and that no file in the JSON's referenced evidence dir has a later last-touch commit than the JSON itself; REPORT (not fail) a cross-lane sha that has not landed yet, since this repo/CI is a shallow clone; never cover throughput/latency numbers. Mac lane re-mints this JSON at the merged head first (lane mail sent 2026-09-02). Cloud lane owns the gate. Lane: devex-tooling-engineer. **DONE 2026-09-18** — `scripts/check-sim-result-provenance.mjs` (preflight + CI, `--self-test` 12/12). Per result: `provenance.commit` must be a 40-hex sha (fatal otherwise); if it RESOLVES here it must be an ancestor of HEAD (fatal otherwise); every cited evidence path must exist (fatal) and carry a last-touch commit no later than the result's own (fatal, waivable per directory with a reason). An unresolvable sha is REPORTED and never fatal, because CI clones shallow. Throughput and latency numbers are out of scope by construction. Live: 18 results, all resolving ancestors. One waiver, checked to be load-bearing: `ios-shell-repair-2026-09-03/` landed in 35fac302 (#412) 3.4h after the result commit 7b80a646 — history that cannot be un-split, recorded rather than rewritten. The 0c7f53a2 this row names had already been re-minted by the Mac lane to ebf341d5.
- [x] **Console PolicyDetail renders a loaded-but-empty test set as 0/0 green (fail-closed auditor, low, 2026-09-02).** `artifacts/signalgrid-app/src/pages/policies/PolicyDetail.tsx` shows a loaded `tests.data.results` of length zero as "0/0 passed" with `bg-status-allow` (green) — a legitimately empty result reading as a pass. Pre-existing server semantics, outside the unknown-as-good batch that just landed. Confirm the server never returns zero tests as `passed:true`; if it can, render 0/0 as a neutral/unknown state, not green. Cloud lane. Lane: web-engineer. **DONE 2026-09-18** — confirmed it can: `GET /v1/policies/:id/tests` (`artifacts/api-server/src/routes/v1.ts`) computes `passed = results.every((r) => r.passed)`, which is vacuously `true` on an empty array. Fixed on the render side (`artifacts/signalgrid-app/src/pages/policies/PolicyDetail.tsx`): a zero-length result set now reads "no tests pinned" with the neutral `bg-signal-unknown` badge, never green, via a new pure classifier `artifacts/signalgrid-app/src/lib/policyTests.ts` (`policyTestSetStatus`: `"empty" | "passed" | "failing"`). Test: `artifacts/signalgrid-app/src/lib/policyTests.test.ts`, 3/3 (`node --test`, the package's first test — added `"test"` to its `package.json` scripts since none existed).
- [x] **Webhook dead_letter status + fixture-sync fail-safe are untested (tdd-guide, medium).** The `dead_letter` terminal delivery status is defined and implemented but never produced or asserted; the 'unresolvable subject → skip, don't trust' fail-safe branch in both fixture-sync paths has no test. Add coverage. Lane: qa-engineer. **DONE 2026-09-18** — `dead_letter` was not merely untested, it was never PRODUCED: `dispatchWithRetry` wrote the DLQ entry and left the delivery log's last row as `failed`, byte-identical to every attempt before it, so the per-webhook log could not distinguish "failed, will retry" from "failed, and nobody will try again". `lib/integrations/src/integrations/webhooks/dispatch.ts` now records a terminal `dead_letter` row before the DLQ write. The skip branch exists in THREE fixture-sync paths, not two — `runFixtureSync` (`connector.ts`) was already driven; `runDockSync` (`dock.ts`) and `runShiftSync` (`shift.ts`) were not, and `runShiftSync` had no proof caller at all. Checks: `pnpm run proof:webhooks` 5f-DEAD-LETTER (four assertions; three fail without the terminal row, verified) and `pnpm run proof:signalgrid-core` (b2) (ten assertions, all-orphan + known-subject control for both paths; 499/505 with the skip counters removed, verified). The core proof's pinned figure moved 495 → 505 in `PRIVATE_CORE_HANDOFF.md`, `PRODUCT_CORE_FOUNDATION.md` and `WHAT_SIGNALGRID_DOES_TODAY.md`; `node scripts/check-proof-figures.mjs` green.

- [ ] **iOS fixed-height rows truncate scaled Dynamic Type text (native lane).** 2026-09-01, flagged by the Mac lane after the Dynamic Type conversion (row 78): `HostAppViewController` has 5 `heightAnchor.constraint(equalToConstant:)` and 0 `greaterThanOrEqualToConstant`, so the now-scaling labels sit in fixed rows and will truncate/overlap at large accessibility text sizes — the conversion was necessary but not sufficient. Static-confirmed; needs a real AX render on the Assist-gate screen (behind a demo-badge injection) to verify each row. Mac lane owns it (Swift + simulator). Screenshot at tools/ios-ax-render.png on the Mac. Lane: mobile-native-engineer. **DONE 2026-09-18** — every `equalToConstant` row height in `HostAppViewController` is now `greaterThanOrEqualToConstant` (top bar 48, app bar 52, primary button 48, step row 40), each paired with the thing that makes a floor mean something: the labels may wrap (`numberOfLines = 0`, and the narrow button gets `2` plus `minimumScaleFactor`), every row's content is pinned with `greaterThanOrEqualTo`/`lessThanOrEqualTo` padding so the row GROWS instead of clipping, and the pairs that could collide got an explicit `lessThanOrEqualTo` gap plus compression priorities — the exit control and the DONE/HELD/BLOCKED verdict never yield. The SIBLING bar in `ManagedAppViewController` had the identical defect and is fixed in the same commit; leaving it would have repeated the bash-3.2 idiom that was documented in one script and omitted from the next. The one remaining `equalToConstant` is the 28pt logo chip, a graphic, whose initial now shrinks with `minimumScaleFactor` rather than the chip deforming the bar. `node scripts/check-ios-dynamic-type.mjs` green; layout at `accessibility-extra-large` is verified by ios-ci on the PR and still wants the Mac's AX screenshot for the visual record.

### ECC full evaluation (run 2026-09-05) — findings not fixed in the same pass

From `docs/agent/ECC_FULL_EVALUATION_2026-09-01.md`, the owner-directed six-stage run on
the Mac lane. None changes what the gates certify today; each names the lane that owns
the surface.

- [x] **`createStepUpSession` dual-writes when Redis is authoritative and swallows the Redis error (ECC security-reviewer, LOW, dormant path).** `lib/webauthn/src/webauthn/store.ts:485-509` writes Redis inside a swallowing `try`/`catch` and then sets the in-memory mirror unconditionally, outside `if (redis)` — the rule `saveChallenge` and `getUser` in the same file state and follow says Redis is the SOLE store when configured. Loosens (a failed durable write reads as success; a session invalidated on the authoritative store can read live from another instance). Unreachable today: `verifyStepUp` has no caller in `artifacts/api-server`; the live path uses `lib/webauthn/src/stepUpStore.ts`. Fix: make the mirror conditional on `!redis` and propagate the error — or delete the dead path with `verifyStepUp`. Cloud lane. Lane: security-engineer. **DONE 2026-09-18** — `lib/webauthn/src/webauthn/store.ts`: the Redis write now PROPAGATES its error and the in-memory mirror is written only when no Redis is configured (`return` inside the `if (redis)` branch), matching `saveUser`/`saveChallenge`; the read half (`getStepUpSession`) was the same divergence and now treats a Redis miss as a MISS instead of falling through to the per-process mirror. Check: `pnpm run proof:webauthn-verify` section 9a-REDIS points `REDIS_URL` at a closed port and asserts the mint THROWS and leaves nothing in the mirror — both assertions fail with the defect replanted (verified).
- [x] **Step-up session ids logged in cleartext (ECC security-reviewer, LOW, module not yet wired).** `lib/webauthn/src/stepUpStore.ts:161, 167, 197, 209, 215, 221, 227` print the full `stepUpSessionId` on every branch; inside the 300 s TTL that id is bearer-equivalent for the operation it gates. Log a truncated hash (the `keyReference` pattern in `lib/enterprise-auth`). Cloud lane. Lane: security-engineer. **DONE 2026-09-18** — `lib/webauthn/src/stepUpStore.ts`: all seven branches now print `sessionRef(id)` — `su#` + SHA-256 truncated to 12 hex — the `keyReference` shape from `lib/enterprise-auth`; the three remaining `${...stepUpSessionId}` interpolations are Redis KEYS, not logs. Check: `pnpm run proof:webauthn-verify` section 9c-LOG captures `console.log` around a real mint and every rejecting verify branch and asserts the id's own characters never appear (and that a correlatable `su#` reference still does); fails with the cleartext form replanted (verified).
- [x] **`/v1` per-key rate limiter keys on the rotatable OIDC bearer (ECC security-reviewer, LOW).** `artifacts/api-server/src/middlewares/rateLimit.ts:54-72` buckets by the raw JWT before `requireTenantContext` runs (`artifacts/api-server/src/routes/v1.ts:56`), so a refreshed or concurrently minted JWT is a fresh bucket; `artifacts/api-server/src/middlewares/idempotency.ts:54-64` already solves the same hazard for its cache by keying on the principal. Keep the ordering (a 429 must carry `x-request-id`; the limiter must stay upstream of auth) and key on a non-verifying claim peek instead. Cloud lane. Lane: security-engineer. **DONE 2026-09-18** — `artifacts/api-server/src/middlewares/rateLimit.ts` now keys through an exported `rateLimitKey(req)`: an UNVERIFIED `iss`/`sub` peek (`peekJwtCallerRef`, new in `lib/enterprise-auth/src/jwt.ts` beside `peekJwtKid`, with the forged-claim cost stated on it), falling back to a SHA-256 digest of an opaque bearer and then to the subnet-bucketed address. Ordering unchanged — the limiter stays upstream of `requireTenantContext` and the 429 still carries `x-request-id`. Check: `test:api` drives it over the wire — two DIFFERENT JWTs with the same `iss`/`sub` must decrement one `ratelimit-remaining` counter, and a different subject must get its own bucket; 413/414 with the raw-token keying replanted (verified).
- [x] **`lib/api-spec/v1-openapi.yaml` under-documents the server's fail-closed refusals and is looser than its validation (Schemathesis 4.4.4, 2,632 cases over 59 operations, 0 server errors).** 401 is documented on no protected operation while every one returns it to a missing or unknown bearer; 404 is undocumented on `GET /v1/policies/{id}/versions`, `GET /v1/policies/{id}/tests`, `GET /v1/connectors/{id}/sync-runs`; 429 appears nowhere; and ten operations (`POST /v1/authorize`, `/v1/decisions/evaluate`, `/v1/decisions/reconcile`, the three `/v1/step-up/*` writes, `/v1/app-workflows/evaluate` and three more) answer 400 to bodies the document allows because `parseEvaluate`/`parseReconcile`/`sanitizeContext` in `artifacts/api-server/src/routes/v1.ts` validate more strictly than the schemas state. The server is the stricter party; the document is what to tighten. Cloud lane (api-contract-architect). **DONE 2026-09-18** — every refusal documented and the schemas tightened to the validator. 68 findings across 36 operations closed: 429 added everywhere (every `/v1` route is behind `v1RateLimiter` and it appeared nowhere), 401 on the 26 protected operations that lacked it, and the missing 400/404/409 — with new `TooManyRequests` and `Conflict` response components and a `ValidationError` description naming `parseEvaluate`/`parseReconcile`/`requireString` as the reason the server refuses bodies the schema allows. Tightened TO the validator, not past it: `minLength: 1` on the nine `requireString`-fed fields of the four step-up/app-workflows bodies (an empty string is a 400 there), and `requestContext` now carries `sanitizeContext`'s real limits — `maxProperties: 32`, `propertyNames.pattern`, `maxLength: 256` — with a note that non-conforming entries are DROPPED rather than refused. `EvaluateRequest`'s three refs deliberately did NOT get `minLength`, because `parseEvaluate` accepts `""`; the document matches the validator rather than out-tightening it. Gated by `scripts/check-v1-refusal-coverage.mjs` (preflight + CI, `--self-test` 11/11), which derives each route's statuses from handler bodies plus one level of shared helpers, adds 401/429 for every route after the auth guard, cross-checks `security: []`, REPORTS documented statuses the core throws from outside this file, and carries three floors.
- [x] **`lib/api-spec/openapi.yaml` (the legacy `/api` monitoring document) has drifted from the served fixtures (Schemathesis, 613 cases over 15 operations).** `GET /api/integrations` returns `lastSync: null` against `string, date-time`; `GET /api/metrics/dashboard` returns `avgLatencyMs: 11.4` against `integer` (both fixtures in `artifacts/api-server/src/routes/monitoring.ts` and `artifacts/api-server/src/routes/integrations.ts`); the document's write operations (`POST /api/decisions`, `POST /api/signals/ingest`, `POST /api/policies`, `GET`/`PUT`/`DELETE /api/policies/{id}`) hit the JSON 404 catch-all; three enum query parameters (`outcome`, `signalType`, `window`) are accepted as any string and filter to empty (the tightening direction, but not what an enum promises). Decide whether this document is retired or brought under the drift gate that already guards the `/v1` document (`docs/API_CONTRACT_AUDIT.md`). Cloud lane. Lane: api-contract-architect. **DONE 2026-09-18** — BROUGHT UNDER A GATE, not retired. Corrected from the served truth: `lastSync` is `type: [string, "null"]` (the catalog serves literal `null`), `avgLatencyMs` is `number` (it serves 11.4), both `limit` defaults were CROSSED and now match `clampLimit` (20 for listDecisions, 50 for listLatestSignals) with `minimum: 1`/`maximum: 200`, the `window`/`granularity` parameters are gone from both metrics operations because those handlers take `_req` and never read them, and the `outcome`/`signalType` enums now say in the document that an unlisted value FILTERS TO EMPTY rather than 400 — the document must not promise a refusal the server does not make. Gated by `scripts/check-api-fixture-contract.mjs` (preflight + CI, `--self-test` 11/11): four rules derived from the route sources — R1 nullable, R2 integer-vs-decimal, R3 `limit` default/ceiling, R4 a documented query parameter on a handler that ignores its request — each with a FLOOR so a refactor cannot turn it green by making it blind. Planted drifts on the live tree fail (default 20→55; `[string, "null"]`→`string`). Route-set drift stays `proof:api-contract`'s job and is not duplicated here.
- [ ] **Ponytail native cuts, part 2 (Mac lane).** Part 1 (`mac/ponytail-native-cuts`, 2026-09-05) retired the identity-provider registry, the configuration service's dead surface and two wrapper scripts. Still on the audit's list (`docs/agent/PONYTAIL_AUDIT_2026-09-01.md`): the badge-reader plug-in registry (`HTTPWebhookBadgeReaderProvider` with its no-op server, `MDMBadgeReaderProvider` whose query always throws, `MDMProviderConfig`/`MDMProviderType`, the unregistered `nfc`/`serial` cases and their inert `BADGE_SERIAL_PORT`/`BADGE_BAUD_RATE` reads — keep `keyboardWedge`, `bluetoothLE`, `usbAccessory`, `usbC`; a switch replaces the factory), the `SessionStateManager` double delegate conformance, and the fail-closed assertion for a nil badge provider. Each needs Xcode; each is a separate build-and-test. Lane: mac-lane-steward. **PARTLY DONE 2026-09-18 (cloud lane, native pass):** the third item — the fail-closed assertion for a nil badge provider — is closed differently from how the audit imagined it, and the measurement is why: the shell was ALREADY fail-closed (no provider means no badge means no session, and `LockedIdleView` shows `badgeReaderUnavailableReason`), so nothing needed to be refused; what was missing was the half of fail-closed that gets read after the fact, because `SessionStateManager`'s `providersInitialized` audit record wrote `"none"` for both "nothing configured" and "a reader this build cannot construct", and it now states either unavailability reason by name. The registry cut and the `SessionStateManager` double-delegate conformance are LEFT OPEN for the Mac: both are multi-hundred-line Swift refactors across `BadgeReaderProvider.swift`, `ProviderConfigurationService.swift`, `LockedIdleViewController` and `native/ios/PROVIDER_CONFIGURATION.md`, and no Linux gate can tell a correct one from a broken one.
- [ ] **DecisionEngine port parity: the TS engine suspends a session on an unauthorized removal, the Swift port has no removal rule (2026-09-14, cloud lane found in review of PR #748, DECLARED as trigger drift rather than left silent).** `lib/signalgrid-simulator/src/decisionEngine.ts:155` computes `hasUnauthorizedRemoval` (a `dock.device_undocked` with no active session) and routes it to `CUSTODY_EXCEPTION`; the mirror block in `native/ios/EnterpriseShell/Services/DecisionEngine.swift:66-80` has no such predicate. Both sides emit `CUSTODY_EXCEPTION` with identical outcomes, so the parity gate's vocabulary and wiring sections stay green — the divergence is in what makes the code FIRE, which no text comparison can decide. Consequence while it stands: an unclaimed lift from the dock is a custody exception in the fabric and `allow` on the phone, with nothing going red anywhere. Bounded by CLAUDE.md golden rule 4 (on-device evaluation is a demo, `/v1` is the decision authority), and now pinned both ways by `DECLARED_TRIGGER_DRIFT` in `scripts/check-decision-port-parity.mjs` — the entry fails the gate the moment the port lands or the TS rule disappears, so it cannot outlive its reason. The repair is a re-port from the current TS, which touches a byte-faithful port and therefore wants a decision record (DR-020) and Xcode: the owner's call, Mac lane to execute. Scope note, because this row names a DEFERRED family: custody is deferred in `scripts/launch-profile.mjs` and nothing in this row claims it ships — it describes a divergence between two demo evaluators and the design target that would close it. Lane: mobile-native-engineer. **STILL OPEN 2026-09-18 (cloud lane, native pass):** the only sanctioned repair is a re-port of the byte-faithful file from the current TS with the parity gate green — a hand edit to `DecisionEngine.swift` is what golden rule 1 forbids — and that re-port needs the decision record (DR-020) plus Xcode to compile and replay it, neither of which this lane has; `DECLARED_TRIGGER_DRIFT` in `scripts/check-decision-port-parity.mjs` still reports it on every run and will fail the moment the port lands, so it cannot outlive its reason.
- [ ] **AppWorkflows port parity: TS releases step-up per action, the Swift port still uses one global boolean (review row 101, Mac lane found, cloud lane decides).** `lib/app-workflows/src/index.ts:124-137` computes `releasedKeys`/`heldKeys`/`allHeldReleased` and a per-action `actionReleased`; `native/ios/EnterpriseShell/Services/AppWorkflows.swift:122` has only `stepUpDone`. `scripts/check-decision-port-parity.mjs` compares "3 enums + 4 operations" — vocabulary and operation shape — so it cannot see this divergence and stays green. Latent today (`HostAppViewController` reads one action out of the plan; `plan.mode`/`plan.summary` are read nowhere) but `v1.ts` already speaks the scoped form. `AppWorkflows.swift` is a golden-rule byte-faithful port: the re-port from the current TS is parity maintenance, not a behaviour change, and is the cloud lane's and the owner's call — with a parity-gate extension that would have caught it. Lane: mobile-native-engineer. **STILL OPEN 2026-09-18 (cloud lane, native pass):** the parity-gate extension has already landed (section 3b compares the five record shapes field for field and pins this as `DECLARED_WORKFLOW_DRIFT`), so what remains is only the re-port of a byte-faithful file, which golden rule 1 routes through the sanctioned port process and which needs Xcode to compile and the owner's call — not a hand edit from here.

- [ ] **SignalGridMobile theme tokens are dark-only behind a `.preferredColorScheme(.dark)` pin (review row 103, Mac lane).** `native/ios/SignalGridMobile/SignalGridOperator/SignalGridOperatorApp.swift:11` pins dark; `native/ios/SignalGridMobile/SignalGridOperator/Theme.swift` carries fixed dark hex tokens. Cloud's note stands: make the tokens adaptive FIRST (light and dark pairs measured against AA, the way `DesignSystem.swift` does for EnterpriseShell), then drop the pin — dropping the pin first would render a dark palette on a light system. Row 104's background token was corrected on `mac/ponytail-native-cuts`; this is the design pass that remains. Needs the simulator in both appearances. Lane: mobile-native-engineer. **DONE 2026-09-18** — `Theme.swift` now declares every token as a `dynamic(light:dark:)` pair, the same shape and the same contract as `DesignSystem.swift` (both values parsed once, up front). The DARK values are byte-for-byte what the file already shipped, so dark rendering is unchanged; the LIGHT values are `DesignSystem.swift`'s ratified counterparts, so one SignalGrid does not render two palettes. IN THAT ORDER, per cloud's note: tokens first, then `.preferredColorScheme(.dark)` dropped from `SignalGridOperatorApp.swift`. `scripts/check-decision-palette.mjs` was EXTENDED to read the adaptive shape and measure BOTH appearances — it would otherwise have found no tokens at all — and it still reads the old flat literal, recorded as the same value in both modes, so a regression to dark-only now fails against the light grounds instead of disappearing from the gate; two self-tests anchor exactly those two regressions (20/20). Measured light, on background / panel / card: allow 5.41 / 5.76 / 6.11, review 5.53 / 5.89 / 6.24, deny 6.50 / 6.91 / 7.33, and the 12% badge composite 4.61 / 4.89 / 5.16, 4.70 / 4.99 / 5.26, 5.44 / 5.77 / 6.09 — every one above AA, printed by the gate. `Previews.swift` keeps its own `.preferredColorScheme(.dark)`: it is developer scaffolding, not the shipped scene. Both appearances on the simulator are verified by ios-ci on the PR.

- [x] **Row 101 answered (cloud lane, 2026-09-12): the AppWorkflows drift is a judgment call, not a mechanical re-port — the Swift stays untouched from this lane, the parity gate now pins the drift both ways, and the re-port is `mobile-native-engineer`'s in Xcode.** There is no generator from the TS to the Swift (the port was hand-written in #107 — the same commit that added the scoped release to the TS reference), and `scripts/check-decision-port-parity.mjs` proves vocabulary and record shape, not bodies; so no regeneration exists that the gate could then prove byte-faithful, and this lane cannot compile Swift (CLAUDE.md, "Now" section). The exact drift, both files read in full:
      · `lib/app-workflows/src/index.ts:85-90` declares `stepUpSatisfiedActionKeys?: string[]` (a release scoped to the actions a verified gesture was bound to); `:144-149` derive `knownKeys` / `releasedKeys` / `heldKeys` / `allHeldReleased`; `:158` releases each action individually — `actionReleased = stepUpDone || (outcome === "step_up" && releasedKeys.has(a.key))`. `native/ios/EnterpriseShell/Services/AppWorkflows.swift:85-95` has no such field, and `:122` reads `let stepUpDone = input.outcome == .step_up && input.stepUpSatisfied` — one global boolean. Effect: the device can release every held action or none; it cannot express "this gesture released this action only", which `/v1` already speaks (`artifacts/api-server/src/routes/v1.ts:825`) and `proof:app-workflows` pins (`scripts/src/app-workflows-proof.ts:103-122`, including the read-only-integration and bogus-key cases the Swift has no equivalent of).
      · A second divergence no text gate can see (string bodies): the confirmer for a vertical outside the table is `"an authorized confirmer"` in TS (`lib/app-workflows/src/index.ts:116-119`, commit `d431b201` — an unknown must not read as a named authority) and `"supervisor"` in Swift (`native/ios/EnterpriseShell/Services/AppWorkflows.swift:113` and `:120`). Latent: every Swift-side integration names a vertical the table has.
      · Latent on the device today: `native/ios/EnterpriseShell/Views/HostAppViewController.swift:577-579`, `:682-684` and `:750-751` gate ONE action at a time and set `stepUpSatisfied` only after a real native authentication, so for a single action the global flag and the scoped set coincide; `plan.mode` and `plan.summary` are read nowhere.
      GATED NOW: section 3b of `scripts/check-decision-port-parity.mjs` compares the five record shapes (`AppAction`, `AppIntegration`, `AppActionPlan`, `AppSessionPlan`, `AppPlanInput`) field for field and pins this one drift in `DECLARED_WORKFLOW_DRIFT`, checked in both directions — stale if the TS field goes, "the port landed; remove the declaration" the day the Swift gains it. With the declaration emptied the gate is red on this tree (planted; output in `docs/agent/EVIDENCE.md`, 2026-09-12). The re-port itself: port `stepUpSatisfiedActionKeys` with the `:144-158` release logic and the confirmer fallback into the Swift, delete the declaration, build and verify at `accessibility-extra-large`, and let the gate prove the shapes agree. Never from this lane; the owner vetoes the re-port by saying so.

      **DONE 2026-09-18 — this row's own question is answered and there is nothing left for THIS lane to build.** Reconfirmed live: `node scripts/check-decision-port-parity.mjs` passes today with `AppPlanInput.stepUpSatisfiedActionKeys` declared and pinned both ways (1 declared drift, exactly as this row states). No generator exists to make the re-port mechanical, this session has no Xcode/Swift toolchain, and the row already names the owning lane (`mobile-native-engineer`) and the exact change (port `stepUpSatisfiedActionKeys` + the `:144-158` release logic + the confirmer fallback, delete the declaration, verify at `accessibility-extra-large`). Not owner-gated: the owner holds an ordinary veto over the re-port ("by saying so"), same as any other change (CLAUDE.md, "Dan decides"), not a pending decision blocking it — the instruction above stands as-is for `mobile-native-engineer` to execute.

### Full-evaluation completion list (2026-09-01) — the real distance to a paying customer

Surfaced by the independent six-dimension evaluation; see
`docs/agent/SOLUTION_READINESS_ASSESSMENT.md`. Four gap ids exist in
`scripts/launch-profile.mjs` GAPS on 2026-09-06 (this said "six of seven"; one of the seven,
assist-wire-unserved, was retired by DR-023) — the evaluation confirms that accounting is honest.

- [x] **Non-demo core constructor.** **DONE 2026-09-18** — `SignalGridCore.fromEstate()` builds a core around a customer tenant, its own bearer tokens, and subjects + posture read through the read-only Graph connector (`lib/signalgrid-core/src/estate.ts`, `lib/integrations/src/integrations/graph/estate.ts`); the served API boots it under `SIGNALGRID_CORE=estate` (`artifacts/api-server/src/lib/core.ts`), refusing to start on a malformed setting instead of falling back to demo. `proof:estate-core` (13 checks, self-test) proves no `allow` fires on facts Graph did not read. STILL OPEN, and kept in the launch profile as gap `non-demo-core-constructor`: the demo core is the default boot, posture is read once with no refresh loop (Discovered row below), and a live read needs the beta/prod gate plus `GRAPH_ACCESS_TOKEN` (row "Real connector auth in the deployable image"). Lane: principal-engineer.
- [x] **Verdict enforcement / step-up answerability.** **DONE 2026-09-18** — two launch routes answer the verdict: `POST /v1/decisions/{id}/step-up/challenge` mints a single-use WebAuthn challenge bound to ONE step_up decision (subjects read from the decision, never from the request), and `POST /v1/decisions/{id}/step-up` verifies the user-verifying assertion against the credential enrolled for that identity and records the answer via `SignalGridCore.answerStepUp()`. The decision is NOT rewritten — a step_up stays a step_up, because it was computed from digested, immutable evidence; `GET /v1/decisions/{id}` now carries `stepUp` (null when unanswered, which is the fail-closed reading). Fails closed on a foreign decision (404), a non-step_up or already-answered decision (409), an unenrolled identity (409), an unknown/expired/mis-bound challenge (403), a tampered assertion (403) and a replay (403/409). Both routes are on the GA fence (`artifacts/api-server/src/lib/profile.ts`), classified `launch` in `scripts/launch-profile.mjs` (LAUNCH_PROFILE_VERSION 5→6, with the two enrollment routes moved deferred→launch as the prerequisite), specced in `lib/api-spec/v1-openapi.yaml`, and `assurance.stepUpAnswerable` now derives from the ANSWER route rather than any path under `/v1/step-up`. The gap `step-up-answerability` is REMOVED because its `closedWhen` condition is met in code. Checks: 22 new `test:api` assertions driving the whole ceremony against the wire (437/437). LEFT: the app-workflows step-up variants stay deferred with the integration catalog; the answer is recorded and read, and nothing downstream of SignalGrid is obliged to consult it — that is the embedded-UX contract, not a gap. Lane: principal-engineer.
- [x] **Real connector auth in the deployable image.** **DONE 2026-09-18** — the shipped server now imports the Graph transport (`artifacts/api-server/src/lib/core.ts` → `@workspace/integrations/graph`) and `SIGNALGRID_CORE=estate` reads posture through it, with the token from `GRAPH_ACCESS_TOKEN`. VERIFIED against the BUILT image rather than the source: `test:api` boots `dist/index.mjs` as an estate server pointed at a stub Graph on `127.0.0.1` and asserts the live reads were issued, that every one was a GET, that they carried the configured bearer, that the connector recorded `mode: live`, and that `/v1/launch-status` then reads `observed`; a second server with every live precondition set EXCEPT the tier gate records `mode: fixture` and the stub sees **zero** requests — the refusal happens before the wire, not after. Three further assertions read the bundle itself for the production endpoint `https://graph.microsoft.com/v1.0`, the two read paths, and the gated resolver, because a bundle that kept the transport and lost the default endpoint would pass the behavioural test (the stub sets `GRAPH_BASE_URL`) and address nothing in production. `docs/DEPLOYMENT.md`'s live section is corrected — it said the server imported none of this, which was true until today — along with the six sibling banners that repeated the clause. **NO CLAIM IS MADE ABOUT A REAL TENANT: none exists here and none has been read.** The gap `device-management-health` is NOT closed and is untouched — its condition is the device-management-health transport default flipping from the generic bridge to Graph, which this does not do. Lane: release-engineer.
- [x] **Secrets management.** **DONE 2026-09-18 (first slice).** `lib/secret-model` ([`lib/secret-model/src/index.ts`](../lib/secret-model/src/index.ts)) is the ONE read site for every secret the served api-server reads: `METRICS_TOKEN`, `SIGNALGRID_ENROLLMENT_SECRET`, both estate bearer tokens and `GRAPH_ACCESS_TOKEN`. Each carries a `_NEXT` successor honoured during rotation — while both are set an inbound secret accepts either value, and deleting the successor is the moment the old credential stops working, which is DR-010 rule 4's acceptance test executed rather than described. Fail-closed: an unconfigured secret matches nothing including the empty string, a blank-but-set value reads unconfigured AND present-but-blank so a consumer refuses at boot, comparison is constant-time over digests with no early return. No value is loggable — the boot line prints an 8-character fingerprint per secret and there is no accessor returning values together. Direction is enforced (inbound compared, outbound presented) and an unregistered name is refused. `pnpm run proof:secrets` (28/28; `--self-test` plants an unconfigured secret accepting anything) also SCANS `artifacts/api-server/src` and fails on any direct `process.env` read of a registered name, so "one place" is checked. `scripts/check-deployment-runbook.mjs` now reads the registry as a second source of boot-read names — three variables silently dropped out of it the day they were routed behind the accessor — so every secret and successor is in `docs/DEPLOYMENT.md`'s table and `docker-compose.prod.yml`. LEFT, and written into `docs/SECRET_MODEL.md`'s new "implemented vs still a runbook claim" section: no OpenBao instance, nothing migrated, no rotation ever executed against a real credential; rules 1/2/5 (vault naming, service identities, sealed storage) entirely unbuilt; `DATABASE_URL`, `REDIS_URL` and the OIDC settings are read inside `@workspace/persistence` / `@workspace/webauthn` / `@workspace/enterprise-auth` and are NOT yet behind the seam. Lane: security-engineer.
- [x] **Data lifecycle (retention / deletion / DSAR).** **DONE 2026-09-18 (first slice).** [`lib/persistence/src/lifecycle.ts`](../lib/persistence/src/lifecycle.ts) implements all three over the durable decision and evidence stores: a per-tenant retention policy with a default (decisions and their snapshots share one window; the caller-supplied `requestContext` has its own, shorter one, and an invalid override falls back to the default and NEVER to unbounded — retention is the one place where fail-closed means keep less); `eraseSubject`, tenant-scoped, removing a subject's decisions and their snapshots; and `exportSubject`, a DSAR read that names what it does not include and appends nothing. The audit chain is never edited — erasure APPENDS a tombstone and `verifyLedgerFull()` passes before and after — and the tombstone carries the operator's request id and counts, NEVER the subject: writing an identifier into an append-only store in response to a request to erase it makes a permanent new copy, and a digest of a low-entropy ref is reversible by guessing. `pnpm run proof:data-lifecycle` (31/31; `--self-test` plants exactly that mistake and the proof catches it). LEFT, and written into `docs/DATA_RETENTION_AND_PERSONAL_DATA.md`'s new correction section: **no route serves any of this and none should** — the `signalgrid_runtime` role holds no DELETE by design, so this is an admin-credential job whose schedule, invocation and runbook are still undesigned (the separate "retention/deletion admin job" row above); the SQL in `PostgresLifecycleStore` is NOT exercised against a live database (there is none in CI — the proof drives the same interface in memory against the REAL audit ledger); sessions, the ledger itself and the in-memory core are untouched; and reconciling DR-003's intended default with the constants in `lifecycle.ts` needs a decision record, not an edit. Lane: compliance-analyst.
- [x] **Serve the Assist wire the SDKs bind.** Kotlin/Rust SDKs bind a planned `POST /v1/authorize` not served or specced; real envelope is `POST /v1/decisions/evaluate`. (gap `assist-wire-unserved`, DR-007.) **DONE 2026-09-01 (DR-023):** served in `v1.ts` + registered in `v1-openapi.yaml` (`AssistResult`); gap entry retired, route classified `launch`, `LAUNCH_PROFILE_VERSION` 4→5; server-side contract bound in `test:api` (200 / vocab / agreement with evaluate / restrict-with-reasons / 401 / 403 / 400). Same decision, second envelope — the host-app obedience surface stays minimal.
- [x] **Runtime enforced-vs-observed status route.** **DONE 2026-09-18** — `GET /v1/launch-status` (`artifacts/api-server/src/routes/v1.ts`) reports, per signal family this process holds, whether the behaviour is `enforced` / `observed` / `simulated`. Every field is derived from `core.signalInventory()` — the connector modes behind the signals actually held — and nothing is configurable: `SIGNALGRID_LIVE_INTEGRATIONS` caused exactly this defect once, when `/v1/context` read a permission flag as a posture. A family sourced entirely from fixtures (or from no resolvable connector, the fail-closed direction) reads `simulated`; any live connector makes it `observed`. `enforced` is reported UNREACHABLE with its reason, because no verdict this service returns is applied by this service and an enum value nothing can produce is an overclaim unless the report retires it. Aggregate and anonymous: counts and modes only, asserted by a test that greps the response for ids, refs and tenant ids. On the GA fence, `launch` in `scripts/launch-profile.mjs` (LAUNCH_PROFILE_VERSION 6→7, gap removed), specced in `lib/api-spec/v1-openapi.yaml`. Checks: `test:api` 453/453, including BOTH arms — the fixture core reads `simulated`, and a second estate server reading LIVE through the built image against a stub Graph on localhost reads `observed`, so the label is a measurement rather than a constant. LEFT: the row is per core SIGNAL CATEGORY (what the core holds), not per `SIGNAL_KINDS` entry from `lib/posture-composition`; mapping the two vocabularies is a separate change. Lane: api-contract-architect.

New ideas land here first (CLAUDE.md scope rule), then get ranked.

- [ ] Marketing-site narrative still tells the v1 gate story. 2026-08-31: the
      retired "Shared-Device Trust Gateway" label was scrubbed from the title,
      social meta, hero badge, About page and review deck, and the framing gate
      now scans those files — but the hero headline ("Should this shared device
      proceed right now?") and the page's flow still frame SignalGrid as a
      yes/no gate, not the DR-020 orchestration grid (a decision as the trigger
      for a cascade; the worker never sees it). That is a copy/design pass, not
      a label swap — same shape as the Sessions-first IA rework in the app. Lane: positioning-messaging.
- [x] Credential revocation has storage but no semantics. 2026-08-31 (IAM
      coverage sweep): `removeCredential` exists in the WebAuthn store with no
      route exposing it and no proof asserting revocation behavior — and the
      security roster (row 82) separately found it lacks the lock its
      neighbors have. Route + lock + an add/remove concurrency proof belong in
      one change. See `docs/research/IAM_CORE_COVERAGE_MAP.md`. Lane: security-engineer.
      **DONE 2026-09-18** — the lock and the concurrency proof (`proof:enrollment-race`)
      already landed (security roster row 82, 2026-09-12); this closes the route, the
      last of the three. `POST /v1/step-up/enroll/revoke` (`artifacts/api-server/src/routes/v1.ts`)
      calls `webauthnStore.removeCredential` under the SAME owner/operator + out-of-band-secret
      gate as enrolling (`requireEnrollmentPrincipal`), validated (`identityRef`/`credentialId`
      required), and fail-closed/idempotent (`revoked:false` on an unknown credential, never a
      404 that would let a caller distinguish "wrong id" from "already revoked"). Documented in
      `lib/api-spec/v1-openapi.yaml` (`stepUpEnrollRevoke`, passes `check-openapi-valid.mjs`) and
      in the Bruno collection (`artifacts/api-collection/review-demo/v1/step-up-enroll-revoke.bru`,
      `check-api-collection.mjs` — 79/79 routes covered). Tested in `test:api`: RBAC refusal
      (auditor 403), validation (missing field 400), an unknown credential id (200,
      `revoked:false`), the real revoke (200, `revoked:true`), the effect proven end to end (a
      step-up challenge for the now-unenrolled identity gets the same 409 as never-enrolled),
      and a second revoke of the same id (200, `revoked:false`, not an error) — 416/416
      assertions pass.
- [ ] The iOS shell captures SAML config keys backed by nothing. 2026-08-31
      (IAM coverage sweep): `ProviderConfigurationService.swift` accepts
      SAML_ENTRY_POINT / SAML_LOGOUT_URL / SAML_CERTIFICATE while no SAML
      assertion processing exists anywhere — a dangling surface to remove or
      implement, never to leave half-present. Native lane. Lane: mobile-native-engineer.
- [ ] The retention/deletion admin job is still undesigned. 2026-08-31 (IAM
      coverage sweep): DR-003's status note ratifies that no durable store has
      a retention mechanism and the runtime role is proven-denied DELETE, so
      honoring any window or DSAR needs an admin-credential job that does not
      exist. `check-retention-claims` keeps surfaces honest meanwhile. See
      `docs/DATA_RETENTION_AND_PERSONAL_DATA.md`. Lane: compliance-analyst.
- [x] **The legacy OpenAPI spec generates a TypeScript SDK with six operations the
      server never serves, and a shipped page calls one. 2026-09-01 (contract-drift
      sweep, HIGH).** **DONE 2026-09-05, one sub-item open:** the six operations are
      pruned from `openapi.yaml` and the served-but-undocumented routes added (`/readyz`,
      `/signals/catalog`, `/signals/radar`, the five `/simulator/*`); `api-contract-proof`
      now holds BOTH documents, each against its own router set, with a route-file
      registry (`sim.ts` undocumented by design, with the reason) — a planted spec-only
      op fails it. `@workspace/api-client-react` regenerated (orval 8.24, typecheck 0).
      OPEN: `@workspace/api-zod` could NOT be regenerated — orval 8.24 emits the zod-v4
      API (`z.int()`) against the workspace's zod 3.25, so its output fails typecheck;
      the committed api-zod output (orval 8.9.1) still carries schemas for the six
      pruned operations. Closing it needs either zod 4 across the workspace or an orval
      pin that targets zod 3. Original finding follows. `lib/api-spec/openapi.yaml` is orval's input for
      `@workspace/api-client-react` / `@workspace/api-zod`; it promises `POST /decisions`,
      `POST /signals/ingest`, `POST /policies`, `GET/PUT/DELETE /policies/{id}`, while
      `routes/monitoring.ts` serves only the GETs. `PolicyCreate.tsx` (`/policies/new`,
      preview-bannered) calls `useCreatePolicy` → 404 "No such API route" toast; any
      integrator importing the typed client gets hooks that 404 on first call. No
      gate reads this spec (`api-contract-proof` holds only `v1-openapi.yaml`). Fix:
      prune the six unserved operations and regenerate, or serve them; either way
      extend the contract proof to hold `openapi.yaml` against the monitoring/
      integrations/health routers. `docs/REPO_LAYOUT.md` should stop calling this
      client "bindings for the /v1 API" — it binds the fixture monitoring surface.
- [ ] **Orphan third spec `lib/api-spec/product-openapi.json` describes an API that
      does not exist. 2026-09-01 (contract-drift sweep, MEDIUM).** Ten paths
      (`/api/v1/session/start`, `/api/v1/location/report`, `/api/v1/devices` …),
      eight unserved, servers `api.signalgrid.local`, committed 2026-08-03, referenced
      by nothing, validated by no gate, sitting in the directory `REPO_LAYOUT.md`
      calls "The OpenAPI contract". Anyone importing it builds against phantom
      routes. Fix: delete it, or move under `docs/archive/` with a header. Lane: api-contract-architect.
- [x] **SDK docs say "append `/v1/authorize` to the base URL"; the server serves it
      at `/api/v1/authorize`. 2026-09-01 (contract-drift sweep, MEDIUM, latent).**
      `GateEndpoint.kt` and `endpoint.rs` trim a trailing slash "so callers can
      append /v1/authorize"; neither mentions `/api`; the spec's `servers` is `/api`
      and nginx routes `/` to the web tier. A partner following the SDK docs posts
      to the root, gets an HTML 404 from the web app, and the SDK denies. Latent —
      neither native shell issues HTTP yet — but iOS hit exactly this trap
      (`DecisionService.swift:74`). Fix: document `/api/v1/authorize` and have
      `check-assist-wire-served.mjs` assert the prefix, or make `validate()`
      append `/api`. Lane: api-contract-architect. **DONE 2026-09-21 (cloud lane) —
      both halves.** The DOC half was already repaired: both stubs now state "THE BASE
      MUST BE THE `/api` MOUNT … a bare `https://host` appends to `https://host/v1/authorize`,
      a 404 — and a 404 is a DENY", and `endpoint.rs` carries a unit test
      (`the_api_mount_is_the_base_and_appending_the_route_reaches_authorize`) proving
      `https://host/api` + `/v1/authorize` = `https://host/api/v1/authorize`. What was
      missing was the GATE half this row named. `check-assist-wire-served.mjs` now asserts
      the served base `/api` agrees across THREE sources — the OpenAPI `servers` url, the
      api-server router mount (`app.use("/api", router)` in `app.ts:163`), and both SDK
      stubs documenting the full served path `/api/v1/authorize` — so the drift that made a
      partner POST to a bare-host 404 (DENY) cannot come back silently. Falsifiable: three
      new self-test cases drift each source and confirm the gate fires (`--self-test` 19/19,
      was 15). Already wired in preflight + CI; no `validate()` logic change (Rust/Kotlin
      compilation is not a cloud-lane gate, and the doc route this row offers is complete).
- [x] **`/v1/app-workflows/evaluate` — the one route a shipping native client binds —
      has no response schema and omits 401/403 in the spec. 2026-09-01
      (contract-drift sweep, MEDIUM).** iOS decodes `{decision:{outcome,reasonCodes,
      explanation}, plan:{outcome,mode}}`; the spec's 200 is description-only, so a
      partner cannot learn `plan.outcome` exists. The api tests already pin the shape
      — the schema can be written from them. `API_CONTRACT_AUDIT.md` lists response
      shapes as unchecked; this is the highest-consequence instance. Lane: api-contract-architect.
      **Response schema BUILT 2026-09-19 (#888):** the 200 is `Envelope + { decision:
      EvaluateResult, plan: AppSessionPlan }`, with `AppSessionPlan`/`AppActionPlan`
      written from `lib/app-workflows/src/index.ts` and the api tests. The 401/403
      half rides #863 (`check-v1-refusal-coverage`), which already edits this block;
      **DONE 2026-09-20:** both halves are on mainline — the 401/403 half landed with #863
      (4df66f2a) and the schema half lands with this merge, together with the `403` the core's
      `authorize(principal, "decision:evaluate")` throws on this route, which neither half had
      documented (the box was ticked early on #888; Codex caught it twice; it is ticked now that
      every refusal the route returns is in the document). Still unchecked by any gate: the
      schema against the handler (`API_CONTRACT_AUDIT.md`, "What is still not checked").
- [x] **Small contract-name drift. 2026-09-01 (contract-drift sweep, LOW).**
      `LAUNCH_CONSOLE_WIREFRAMES.md` names `GET /v1/connectors/:id/syncs`; the served
      path is `/sync-runs`. The SDKs and vectors read an optional `obligations` array
      that `AssistResult` and the handler never emit (tolerated, but an SDK-documented
      field no server sends — either emit it on step_up or drop it from the SDK docs). Lane: api-contract-architect.
      **DONE 2026-09-18.** Half (a) was already repaired upstream and is verified gone:
      `grep -rn 'connectors/{id}/sync' docs/LAUNCH_CONSOLE_WIREFRAMES.md` prints `sync-runs` at
      :72 and :194, and a repo-wide `grep -rn '/syncs'` (excluding node_modules and this file)
      returns nothing — no code change was needed and none was invented.
      Half (b) was closed by KEEPING the field unemitted and GATING the pairing, rather than
      emitting an obligation nobody asked for: both SDK READMEs already say the spec "declares no
      `obligations` field", and the shared vectors already pin that absent means not-stated
      (never nothing-required), which is a safety rule and is untouched. What was missing was
      anything watching the pairing. `scripts/check-assist-wire-served.mjs` now reads the
      `AssistResult` SCHEMA BLOCK (not the whole document — `obligations` appears in prose and
      near the reason-code list) and fails in BOTH directions: the spec adding the field while a
      README still says it declares none, and a README dropping the sentence while the spec still
      declares none — which is the SDK-documented-field-no-server-sends drift itself. A block it
      cannot FIND is fatal, never silent agreement. `--self-test` 15/15, four of them new.
- [ ] Census figures in `docs/PRODUCT_COMPLETION_PLAN.md` read as a dated
      point-in-time analysis but risk drifting from live counts. 2026-09-01
      (security/adversarial scan, fail-closed auditor): the doc's "48 deferred
      families" (:180), "47 gates fire on deferred families" (:295), "167
      entries", "204 documents" are hand-maintained and no longer track the
      tree (140 `proof:*` today; the deferred-family list at
      `scripts/launch-profile.mjs` holds ~49). Not a confirmed drift finding —
      each figure would need to be tied to a live category before rewriting —
      but a fossil risk on a hand-maintained census. Either derive the numbers
      or mark the doc as a fixed dated snapshot so a reader stops treating them
      as current measurements. Lane: docs-writer.
- [ ] Default `review-demo` profile mounts sim + control-plane routes
      unauthenticated. 2026-09-01 (security/adversarial scan, attack-surface
      review): informational, not a code defect — `POST /api/sim/room-entry`
      and `/cp/v1/*` carry no auth under the default profile and the sim route
      mints a seed tenant's own token server-side. Already documented and
      gated: `SIGNALGRID_PRODUCT_PROFILE=shared-device-gateway` unmounts both
      routers, cross-checked by `scripts/check-launch-profile.mjs`. A real
      (non-review) deployment must set that variable — a deployment-checklist
      item, not an in-code bypass. Lane: security-engineer.
- [x] **`check-console-unknown-render` — the unknown-as-good-state gate for the
      console (G2 from the 2026-09-02 console fix batch). SPEC ONLY, deferred: a
      deterministic version could not be built at acceptable precision in the
      batch's time.** **DONE 2026-09-21 (cloud lane)** — built as `scripts/check-console-unknown-render.mjs`,
      an AST data-flow gate (the first script to use the TypeScript compiler API), not a
      text scan. It collects each `.tsx`'s query-result identifiers (the `useQuery`/
      generated-hook object, the destructured `data`/`isError`/`error`/`isLoading` bindings,
      and vars DERIVED from query data to a fixpoint), then flags a good-state marker that a
      per-branch boolean model finds is NOT proven to be reached with data present (directly,
      or by ruling out both the error and loading flags). A STRONG affirmation phrase ("no
      stale", "all clear", "all systems operational", …) is flagged whenever unhandled; a
      good-state CLASS (`emerald`/`status-allow`) or a WEAK conclusion word ("healthy",
      "operational", "nominal") is flagged only when it is chosen by the data-absent branch
      OR its element also renders a query-data value that is not itself presence-gated. The
      naive version's own false positives were the calibration
      target: it flagged 17 correct sites (a static emerald category colour over a
      `s ? String(x) : "-"` value, an `accent={s ? "emerald" : x}` ternary the ancestor walk
      missed) — the AST version reports ZERO on the current tree. Exempt a site with
      `// unknown-ok: <reason>`. Registered in `scripts/preflight.mjs` and
      `.github/workflows/review-hub-ci.yml` (parity gate green). Two-direction self-test
      plus a PLANT that removes the presence guard from a real component
      (`SignalSourcing.tsx`) and watches the gate fire: `node
      scripts/check-console-unknown-render.mjs --self-test`. SAFETY_MACHINERY — merged under
      DR-037.
      ORIGINAL SPEC (kept for the record): The intent: flag a `.tsx` in `artifacts/signalgrid-app/src`
      that calls `useQuery`/a generated hook, has a `?? []`/`?? {}`/`?.` fallback
      flowing into a class containing `emerald`/`status-allow` or a phrase from
      {"all clear","No stale","no … found","healthy","operational"}, AND never
      references `.isError`/`.error` — exempt only with an explicit
      `// unknown-ok: <reason>` line. **Why it is not built:** the doctrine-correct
      fix for this defect class gates the good state on DATA PRESENCE
      (`data ? good : muted`), not on `.isError`, so "never references .isError"
      over-flags correct code. Calibrated on 2026-09-02 against the just-fixed
      tree, the naive heuristic flagged 9 files of which the majority are false
      positives — `SignalSourcing.tsx` and `AppResilience.tsx` were fixed in this
      very batch to gate on `s ?`/`fleet ?` and still trip it; `Dashboard.tsx`
      handles the error via a destructured `error: signalsError` the `.error`
      probe cannot see. A gate at that false-positive rate teaches authors to
      sprinkle `// unknown-ok:` on correct code — the "write for the regex"
      anti-pattern this repo already warns about three times. **To make it real,
      the flag condition must recognise data-presence gating** (a `<var> ?`/`!<var>`
      guard on the query result reaching the emerald branch counts as handled),
      which is a small data-flow analysis, not a text scan. Until then the class
      is covered by the widened doctrine review, not a gate. Ships as its own PR
      with a two-direction self-test (a bug shape flagged, a data-presence-gated
      shape not) and a validation that plants an unknown-as-emerald into a real
      component and watches it fail. Cloud lane. Lane: devex-tooling-engineer.

- [ ] **`check-console-unknown-render` — two conservative false-negatives to close
      (Codex review of #953).** Both UNDER-flag (never over-flag), so the gate stays
      sound; each is deferred because the naive fix would raise the false-positive
      rate on a mandatory gate. (1) **Per-query provenance (P1-7):** the handled-check
      treats ANY query identifier in a guard test as covering ANY query-data render in
      that branch, so a file with two queries where the emerald branch is guarded on
      query A but renders query B's data reads as handled. The same missing provenance
      means a value extracted into a child presentation component (`<Panel items={items} />`)
      is analysed in the child without the parent's query origin, bypassing the gate.
      Fix: track which query each `data`/derived var descends from, require the guard to
      test the SAME query, and carry provenance across component props (or enforce an
      equivalent call-site contract).
      (2) **Const-class resolution (P2-5):** a good-state class assembled through a
      `const cls = "... emerald ..."` binding, or a `clsx`/template-literal join, is
      matched only when the literal is inline on the element — a class hoisted to a
      const is missed. Fix: resolve string-const bindings and template quasis before
      the class match. Ships with a self-test extending each shape. Cloud lane.
      Lane: devex-tooling-engineer.

- [x] **The 8 remediation-allow reason codes are absent from `docs/REASON_CODES.md` (Mac-lane flag, #403). DONE.**
      Closed by teaching `scripts/gen-reason-codes.mjs` to derive the wrapper's declared
      `REMEDIATION_ALLOW_REASONS` as part of the simulator/iOS vocabulary (drift-guarded:
      any reason-code literal in the wrapper not in the declared array fails generation),
      and bumping `check-reason-codes.mjs` `SIM_FLOOR` 18->25. The seven engine-never-emits
      codes now appear in the catalogue and are held by the byte-equality gate.
      `docs/REASON_CODES.md` is generated by parsing `decisionEngine.ts` only, so the eight
      reason codes the remediation-allow wrapper emits
      (`lib/signalgrid-simulator/src/remediation-allow.ts`, pinned in
      `native/shared/remediation-allow-vectors.json`: `REMEDIATION_VERIFIED`,
      `REMEDIATION_NOT_REQUIRED`, `REMEDIATION_RECORDED_NOT_VERIFIED`,
      `REMEDIATION_VERIFICATION_FAILED`, `REMEDIATION_EVIDENCE_STALE`,
      `REMEDIATION_ABSENT_WHERE_REQUIRED`, `REMEDIATION_STATE_ILLEGIBLE`,
      `ALLOW_WITHHELD_CONCURRENT_FAILURE`) never reach the human-facing catalogue. Either
      extend the generator to also read the remediation-allow wrapper, or add the eight with
      provenance plus a gate that fails if the wrapper's emitted set drifts from the doc.
      Ships as its own PR with a two-direction self-test. Cloud lane.

- [ ] **`signalgrid` CLI harness — the CLI-Anything method applied to this repository's
      own control plane (DR-040, 2026-09-12).** Follow `third_party/cli-anything/HARNESS.md`
      as adapted by `.claude/skills/cli-anything/SKILL.md`: discover the `/v1` routes and
      the MCP tools, design a stateful session (base URL, tenant, token from the
      environment; session file outside the tree, exclusive-locked), build a TypeScript
      CLI under `artifacts/` with dual human/`--json` output (`decide`, `explain`,
      `signals`, `audit`, `connectors`), read-only against the fabric by default,
      fixture-tested against the api-server harness, with a generated SKILL.md that
      passes both skill gates. No registry, no telemetry, no live tenant. Done = the
      api-server suite green with every assertion, the CLI's own proof registered in
      preflight and CI, and this box ticked. Lane: devex-tooling-engineer.

- [ ] **Security roster row 82: two of its three items landed (cloud lane, 2026-09-12); the revoke route stays open — `security-engineer`.** (1) LOCK: `removeCredential` now runs under the same per-user `SET NX PX` lock as `addCredential`, through one `withUserLock` helper (`lib/webauthn/src/webauthn/store.ts:187`, `:227`, `:294`); its in-memory branch has no await between read and write (`:327`), where the old code awaited the client factory between the splice and the user delete; and a failed Redis `DEL` now propagates instead of returning `true` over a key the store still held. Proven: `proof:enrollment-race` gained a 516-interleaving in-memory sweep and a revocation-racing-twelve-enrolments Redis race; on the unfixed store 9/11 (43 interleavings deleted the user together with its new credential; the Redis race lost `cred-100`), on the fixed store 11/11 — outputs in `docs/agent/EVIDENCE.md`. (3) `hasValidStepUpSession` (`lib/webauthn/src/stepUpStore.ts:261`): its `return false` is NOT a fail-open — it can never say `true` about a session that does not exist, so a caller must require a fresh step-up — but its docstring claimed a check the function has never performed; it now says NOT IMPLEMENTED and the function is `@deprecated`; nothing calls it (`git grep hasValidStepUpSession` → the definition only); deleting the module is DR-024's open owner cut. STILL OPEN: (2) the attestation `'none'` assumption in `lib/webauthn/src/webauthn/verify.ts` wants its comment (`lib/webauthn/src/webauthn/verify.ts:398`; the roster's `:348` is stale), and the revoke ROUTE (the row above, "Credential revocation has storage but no semantics") — the lock is live the day that route is wired.
      **PARTIALLY DONE 2026-09-18** — the revoke route landed (see "Credential
      revocation has storage but no semantics", above, now `[x]`); the lock (already
      live) now guards it too, since the route calls the same
      `webauthnStore.removeCredential`. Row stays open: item (2), the attestation
      `'none'` comment in `lib/webauthn/src/webauthn/verify.ts:398`, is untouched by
      this change and remains the one open item.

### Video intake — one owner-gated option (2026-09-20, from an owner-shared clip)

Filed from the 2026-09-20 row in [`docs/agent/RESOURCE_INTAKE.md`](agent/RESOURCE_INTAKE.md). Not
shipped capability; not a vendor integration; nothing here makes a live call from this tree.

- [ ] **A by-reference operator procedure for YouTube URLs whose media download fails (video intake, LOW).** On 2026-09-12 a full-video `/watch` run on a public YouTube URL got HTTP 403 on the media download: the CAPTIONS still arrived (`.claude/skills/watch/scripts/watch.py` pulls them before it downloads), so the transcript existed and the FRAMES did not — the gap is the visual half, not the spoken half. A 2026-09-20 owner-shared clip's recipe for that gap is a Gemini key from Google AI Studio, whose YouTube-native read returns an account of what is on screen without a download. That is an upload of the URL — and, for owner media, the file — to a third party, so it is the same per-machine owner decision as a Whisper key (DR-040, DR-029), and a live vendor API call has no place in this public repository (AGENTS.md scope: no live API calls). If the owner takes it, the deliverable here is ONE paragraph in `.claude/skills/video-intake/SKILL.md` naming the operator-side procedure — key and run both outside the tree; the output arriving as two plain files the skill already knows how to read, a timestamped visual account standing in for the frames and, only where captions also failed, a transcript; a `RESOURCE_INTAKE` row per use — NOT a script in this tree, NOT a flag on `transcribe-local.py`, NOT a gate that needs the network. Never a default, never on the Mac tick, never a transcript or visual account treated as a fixture (video-intake rule 3). The check that fails without it, offline: the skill's "What this skill does not do" names the boundary but no documented procedure exists for a URL whose download fails, so such a clip is logged with a transcript, no frames and no visual account. devex-tooling-engineer.

### GitHub Trending screening — three follow-ups (2026-09-12, from the owner's Trending snapshot)

Filed from the intake row in [`docs/agent/RESOURCE_INTAKE.md`](agent/RESOURCE_INTAKE.md) for the
GitHub Trending snapshot the owner shared: 23 repository rows screened against the tree, 20 touch
nothing, these three do. **None is shipped capability, and none is a claim about a partnership,
integration or endorsement with any of the projects named.** Public-safe and fixture-first.

- [ ] **A maplibre-gl-js operator map over the shipped facility trust graph (console view, MEDIUM; blocked on tiles).** [`docs/inspiration/SPATIAL_TRUST_RESEARCH_REPORT.md`](inspiration/SPATIAL_TRUST_RESEARCH_REPORT.md) already names `maplibre/maplibre-gl-js` (BSD-3-Clause) as the operator-map renderer beside the shipped `lib/facility-trust-graph`, which today has no spatial view at all. The blocker is not the renderer: it is **where vector tiles come from in a repository with no network calls and no tenant data** — a fixture tile set, a floor-plan raster, or nothing. Resolve the tile source FIRST, in one paragraph, then a console view with a deterministic fixture and no live vendor call. Do not add a map that silently fetches a hosted style. web-engineer.
- [ ] **Vendor-doc drift is unwatched — decide whether a report-only watcher is worth its operator machine (research infrastructure, MEDIUM).** `docs/` cites 2,209 unique external URLs across 996 hosts (measured 2026-09-12) and every link gate in this repo is OFFLINE by design, so a vendor renaming or retiring a page is found only by hand — twice so far, both recorded in the catalogs (CyberArk → Idira; the `privx-ot` product URL now 404). `dgtlmoon/changedetection.io` (Apache-2.0, with a hosting-triggered commercial licence that matters only if we ever hosted it) is the shape that would watch them. Scope if taken: report-only, on the operator's own machine, never a gate, never in CI, no page content committed — only "this URL changed, look at it". The real question this row answers is whether the watch list is maintainable at 996 hosts or should be a curated 30. records-archivist.
- [ ] **`docs/BACKUP_AND_RESTORE.md` states "No encryption at rest, and no opinion about where archives live" — give it one, as a runbook sentence (docs, LOW).** The gap is named in the document itself and has no filling. rclone's `crypt` (client-side encryption over any remote) and `hashsum` (verify an archive after transfer) are the two backends that close it in operator terms; the deliverable is a paragraph in that runbook naming the commands and what they do and do not promise — NOT a dependency, NOT a script in this tree, and NOT a compliance claim. docs-writer.
- [ ] **Bind `device_returned` to Apple's Return to Service as an approval-gated recommendation — the device-side re-provision the custody ground truth describes in prose and nothing models (connector fixture first, MEDIUM).** Apple's Platform Deployment guide (2026-09-17 edition) and its `device.erase.yaml` make "returned to the dock → erased → re-enrolled → Home Screen, supervision kept" one MDM erase command carrying a Wi-Fi profile and the enrollment to return to. **Facts corrected 2026-09-24 (DR-055; sources in `native/ios/FLEET_MDM.md` item 7):** the `ReturnToService` key exists from iOS 17.0; app preservation needs iOS / iPadOS 26, Automated Device Enrollment, an escrowed bootstrap token and an iPad not set up as Shared iPad — the Shared iPad limit belongs to app preservation only; iOS / iPadOS 27 adds enrollment retry and, inside the app-preservation reset only, a Control Center or inactivity-timeout start that checks in with the MDM; Activation Lock must be off. This row used to say "iOS / iPadOS 26 and later … not Shared iPad" and to build the erase as a `fleet-connector` operation, but that package is "READ-ONLY BY CONSTRUCTION" (`lib/fleet-connector/src/client.ts`). **Reshaped:** `device_returned` produces a planned, approval-gated "erase with Return to Service" RECOMMENDATION to the MDM — simulated, never executed from this tree, and counted against the tenant's wipe cap — refused BY NAME when the device is unsupervised or not enrolled, Activation Lock is on, app preservation is asked for on a Shared iPad or without a bootstrap token, or the Wi-Fi profile is absent. `lib/fleet-connector` stays read-only; no write path enters the public tree unless a decision record says so, and whether any erase may run under a standing approval is the owner's open question (DR-055 item 5). [`docs/research/SHARED_DEVICE_CUSTODY_GROUND_TRUTH.md`](research/SHARED_DEVICE_CUSTODY_GROUND_TRUTH.md) maps the re-provision step to the `app-update` family in prose only; Puck 7 consumes this row's answer. The check that fails without it: a fixture proof where each refusal names its reason, a clean supervised device yields a recommendation that requires approval and carries no executed status, and a grep of `lib/fleet-connector/src` for an erase call stays empty. The on-device half is the Mac lane's, on a real supervised iPhone. Lane: mobile-native-engineer.
- [x] **A maplibre-gl-js operator map over the shipped facility trust graph (console view, MEDIUM; blocked on tiles).** [`docs/inspiration/SPATIAL_TRUST_RESEARCH_REPORT.md`](inspiration/SPATIAL_TRUST_RESEARCH_REPORT.md) already names `maplibre/maplibre-gl-js` (BSD-3-Clause) as the operator-map renderer beside the shipped `lib/facility-trust-graph`, which today has no spatial view at all. The blocker is not the renderer: it is **where vector tiles come from in a repository with no network calls and no tenant data** — a fixture tile set, a floor-plan raster, or nothing. Resolve the tile source FIRST, in one paragraph, then a console view with a deterministic fixture and no live vendor call. Do not add a map that silently fetches a hosted style. web-engineer. **DONE 2026-09-18** — measured, then built: `lib/facility-trust-graph/src/graph.ts`'s `SpaceNode` carries no coordinate of any kind (no lat/lon, no floor-plan pixel, no vendor map position) — its only positional fact is `parentId`, so a tile renderer has nothing to project and the row's "resolve the tile source first" question dissolves: there is no tile source because the shipped data isn't geography, it's a tree. Built the tile-less view instead — `artifacts/signalgrid-app/src/lib/facilityGraphLayout.ts` (pure leaf-counting tree layout, no new dependency) feeding a plain inline `<svg>` in the new `/facility-graph` console page (`artifacts/signalgrid-app/src/pages/FacilityGraph.tsx`), reading the bundled `@workspace/facility-trust-graph` fixture — no network call, no maplibre, no live vendor style. Nav-registered (`GRID_NAV`, preview-wrapped per the launch-surface law) and reachable (`check-console-routes-reachable.mjs`, `check-dead-nav.mjs` both pass). Test: `artifacts/signalgrid-app/src/lib/facilityGraphLayout.test.ts`, 7/7 (`node --test`), covering depth ordering, parent vs. door edges, sibling column separation + parent centering, determinism, and an out-of-set `parentId` falling back to a root instead of being silently dropped.
- [x] **Vendor-doc drift is unwatched — decide whether a report-only watcher is worth its operator machine (research infrastructure, MEDIUM).** `docs/` cites 2,209 unique external URLs across 996 hosts (measured 2026-09-12) and every link gate in this repo is OFFLINE by design, so a vendor renaming or retiring a page is found only by hand — twice so far, both recorded in the catalogs (CyberArk → Idira; the `privx-ot` product URL now 404). `dgtlmoon/changedetection.io` (Apache-2.0, with a hosting-triggered commercial licence that matters only if we ever hosted it) is the shape that would watch them. Scope if taken: report-only, on the operator's own machine, never a gate, never in CI, no page content committed — only "this URL changed, look at it". The real question this row answers is whether the watch list is maintainable at 996 hosts or should be a curated 30. records-archivist. **DONE 2026-09-18** — decided: a watcher is worth it, cheaper than the changedetection.io shape (no network fetch, no operator machine). `scripts/check-vendor-doc-drift.mjs` holds the 247 unique vendor URLs cited in `docs/inspiration/ENDPOINT_MANAGEMENT_API_CATALOG.md` (the catalog measured for this row's scope, not the full 996-host figure) against a committed dated ledger (`docs/agent/VENDOR_DOC_MANIFEST.json`, regenerated with `--write`) and reports URLs newly cited with no manifest entry, URLs stale past 90 days, and manifest URLs the catalog no longer cites. REPORT-ONLY: the check always exits 0; only `--self-test` (10/10) can fail a build. Registered in `scripts/preflight.mjs` and `.github/workflows/review-hub-ci.yml`; `node scripts/check-preflight-ci-parity.mjs` confirms it's wired.
- [x] **`docs/BACKUP_AND_RESTORE.md` states "No encryption at rest, and no opinion about where archives live" — give it one, as a runbook sentence (docs, LOW).** The gap is named in the document itself and has no filling. rclone's `crypt` (client-side encryption over any remote) and `hashsum` (verify an archive after transfer) are the two backends that close it in operator terms; the deliverable is a paragraph in that runbook naming the commands and what they do and do not promise — NOT a dependency, NOT a script in this tree, and NOT a compliance claim. docs-writer. **DONE 2026-09-18** — `docs/BACKUP_AND_RESTORE.md`, "What this does NOT give you": the bullet now names `rclone crypt` (client-side AES-256-CTR before the archive leaves the machine) and `rclone hashsum` (post-copy corruption/truncation check), states plainly that neither is a dependency of this repo, and says explicitly that `crypt` is not a compliance claim — a regulated operator still needs the human compliance review CLAUDE.md requires. Checked truthful against `docker-compose.prod.yml` (the `db:backup` dump is a plain unencrypted Postgres logical dump into an operator-chosen destination) and `docs/DEPLOYMENT.md` ("backups and restore testing" are explicitly out of scope, owned by whoever operates the stack) — nothing claims the code does anything it doesn't.

### Context7 re-scan under DR-053 (2026-09-20, from the owner's re-share)

Filed from the 2026-09-20 row in [`docs/agent/RESOURCE_INTAKE.md`](agent/RESOURCE_INTAKE.md) — the first
resource run through the independent-scan → cross-confirmation → choice procedure. Reference tooling only;
nothing here touches the decision path.

- [ ] **Bump the Context7 pin `4.0.4 → 4.1.1` and make pin staleness visible (tooling, LOW).** `scripts/install-context7.mjs:24`, `scripts/setup-mcp-lane.mjs:20,66` and `docs/MCP_AND_SKILLS_LANE_PARITY.md` all say 4.0.4; `npm view @upstash/context7-mcp version` printed 4.1.1 (published 2026-09-14) on 2026-09-20 — seven published versions behind and nothing in the tree says so. The bump re-runs an installer that mutates user-scope MCP config, so it lands from the Mac with `--status` output quoted, and the installer prints a one-line pin-vs-published comparison when the network is available (REPORTED, never fatal, never in CI). The check that fails without it, offline: the three files above disagree with no single source — a small parity check that the pin string is identical across them would catch the next drift. devex-tooling-engineer.
- [ ] **Say the non-determinism condition where Context7 is registered (tooling, LOW).** Keyless Context7 returned a 98 B "Monthly quota exceeded" error and then 1,556 B of real docs for the same query on consecutive runs (2026-09-20, shared-egress rate limit), and it cannot answer with sockets denied. The parity doc now says so; the installer banner (`scripts/install-context7.mjs`) and `scripts/setup-mcp-lane.mjs`'s `ok(...)` line do not. Add the one sentence — output is not a pure function of the tree, so it is never cited in a gate, a proof, a fixture or a doc figure — to both. The check that fails without it: nothing today stops a lane pasting a Context7 answer into a fixture; the sentence at the registration site is the cheapest guard short of a gate, and a gate is not warranted for a reference tool. devex-tooling-engineer.
- [ ] **Gate `.claude/commands/*.md` front matter the way `check-skill-plane-conformance.mjs` gates skills (agent platform, LOW).** The prompt-master scan (2026-09-20) counted 12 tracked slash commands with no gate over their `description` / `argument-hint` front matter, while every skill and agent is held to a name-matches-home and non-empty-description rule. Extend the existing conformance gate to `.claude/commands/`: a command with no `description` is RED; a self-test plants one. The check that fails without it: a command can ship with an empty or missing description and nothing notices until a person types it. agent-platform-engineer.
- [ ] **Activate the vendored `prompt-master` skill on ONE fixture brain dump and record what it emits (agent platform, LOW).** The 2026-09-20 intake row is a source review: the skill is a markdown procedure a model executes and it was never run, so its proposals are predictions. The trial: one fixture dump under `artifacts/` (public-safe, no owner text), the skill activated twice by the same tier, the two outputs diffed — repeatability is the measurement and the skill's own 6-point lock is the pass/fail — and the intake row relabelled from source review to by-use with the counts. No network, no key, nothing written outside the scratchpad. Lane: agent-platform-engineer.

### Agent tooling — detector gaps in the lane's own seams (2026-09-20, measured on this lane's branches; not part of the Trending snapshot above)

- [x] **`pnpm run loop:state` and the stop hook read a squash-landed branch as "not on the hub" when mainline ALSO moved a file the branch touched (2026-09-20, cloud lane; devex-tooling-engineer).** `scripts/loop-state.mjs` `hasLandedByContent` clears a squash-merged branch only when every file it changed is byte-identical to SOME blob in mainline's history of that path. A squash merge lands the pull request's MERGE tree, not the branch tip's tree, so a shared file that mainline changed between the branch's last mainline merge and the squash lands as a three-way merge result that never equals the branch's blob. Measured 2026-09-20 on the two branches the stop hook has named every turn since their PRs merged: `claude/build-native-ios` (#860, c7dc6610) and `claude/video-intake-beat-timeline` (#900, f7148343) each fail on exactly one file, `docs/BUILD_BACKLOG.md`, NEVER-MATCHED at history depth 111; every other file matches. Change — LOCAL, no network (AGENTS.md: no live API calls; the stop hook and `loop:state` run on every turn and must never depend on GitHub): compute the patch-id of the branch's whole diff against its merge-base with whitespace PRESERVED (`git diff <base> <tip> | git patch-id --verbatim` — `--stable` strips whitespace, so two different whitespace-only edits collide and a never-landed tip would read LANDED) and compare it with the same verbatim patch-id of each squash commit's own diff in the bounded mainline history the byte check already walks; on a match, confirm with an exact follow-up comparison (the branch's hunks re-applied to the squash's parent must reproduce the squash tree for every touched file) before clearing; a squash of a clean merge carries exactly the branch's hunks even when mainline moved the same file, so a confirmed match is content that landed and anything else stays reported. Bind it to the CURRENT tip: a branch reused or extended after its merge has a different whole-diff patch-id and must stay reported. Keep the byte check as the first path and say which of the two cleared the branch. A by-hand `gh api …/pulls?state=closed&head=<owner>:<branch>` confirmation stays an operator step outside the automatic path, never in the hook. The checks that fail without it, all offline against fixture commits: (a) a fixture branch whose one changed file was also moved on mainline after the merge-base, squash-landed at exactly its tip, must be reported LANDED; (b) the same branch with one more local commit must stay reported as unpushed; (c) a branch whose only difference from a squash-landed twin is a whitespace-only edit must stay reported (the `--stable` collision fixture). A THIRD shape, measured the same day on this very branch: `noRemote` at `scripts/loop-state.mjs:242` drops any branch whose NAME exists on the hub, so a local tip AHEAD of its same-named remote is never examined by either the unpushed seam or the "carrying commits" warning (that one covers only worktree branches with no hub name) — `claude/landing-record-2026-09-20` sat at d29bf79f, one commit ahead of `origin/claude/landing-record-2026-09-20`, and the seam named nothing. Check (c): a fixture branch whose same-named remote exists and whose tip is one commit ahead of it must be reported, with the count. Lane: devex-tooling-engineer. **DONE 2026-09-20 (cloud lane, PR on `claude/loop-state-squash-seam`):** `scripts/loop-state.mjs` gained `landedByPatchId` (whole-branch `git patch-id --verbatim` against every single-parent commit in the bounded mainline walk, then the exact follow-up: the branch's hunks applied to the squash's parent in a throwaway index must write the squash's own tree) and `aheadOfHub` (a same-named branch is compared by sha against the ls-remote tip; ahead is a gated fail with the count, an unfetched tip is reported UNKNOWN and never counted clean). Evidence: `node scripts/loop-state.mjs --self-test` → `self-test passed (8/8)` — the byte check still cannot clear the fixture (the gap, kept as the positive control), the hunk check clears it (a), one more commit stays reported (b), the whitespace twin stays reported (c), same-name ahead reads `+1` (d), an unknown Hub sha reads unknown; registered in preflight and CI ("Loop-state seam self-test"). Live: `pnpm run loop:state` now reads "Local branches all present on the Review Hub" with `claude/build-native-ios` and `claude/video-intake-beat-timeline` listed under "squash-landed, exact hunks found in a mainline squash", and "Same-named branches at or behind their Hub tip". No network added: the hook still makes only the ls-remote it always made.
- [x] **Lift the workspace `esbuild` override 0.27.3 → 0.28.2, or record why not (supply chain, LOW; owner: release-engineer).** `pnpm audit` on 2026-09-19 reports one LOW advisory on `esbuild >=0.27.3 <0.28.1`, and the `pnpm-workspace.yaml` override pins the whole workspace at 0.27.3 (it began as a drizzle-kit transitive fix; the three package.json declarations that said 0.28.2 were dead text and now say 0.27.3). Lifting it changes the bundler under `artifacts/api-server`, `artifacts/mcp-server` and every proof, so it is its own change. Source: the Context7 self-scan row in `docs/agent/RESOURCE_INTAKE.md` (2026-09-19). **DONE 2026-09-23 (mac lane):** override + the three package.json declarations lifted to 0.28.2; `pnpm install --lockfile-only` regenerated the lockfile (diff is esbuild-scoped, 54/54, `@esbuild/linux-x64: 0.28.2` present for CI), `pnpm install --frozen-lockfile` exit 0 (consistent, no re-divergence). `build.mjs` uses only stable esbuild API (`build({platform:"node",bundle:true,format:"esm"})` + the pino plugin, whose lockfile peer updated cleanly), so 0.28 is compatible; the Mac cannot run the darwin esbuild build (override strips the darwin binary), so preflight's `test:api` skips via `platform-native-build.mjs` and CI/linux does the authoritative build. Reversible: revert the four version bumps + regenerate.
- [x] **Gate: a `pnpm-workspace.yaml` override must match every package's own declaration (gates, LOW; owner: devex-tooling-engineer).** Three package.json files declared `esbuild` 0.28.2 while the override resolved 0.27.3, and nothing noticed. Derive the set from the overrides table intersected with each workspace package.json's dependency blocks; a declared version that differs from the override fails, offline, in preflight AND CI (parity gate). Proposed by the gate-and-proof-engineer and fail-closed-auditor perspectives on the Context7 self-scan, 2026-09-19; filed rather than landed in the same change. **DONE 2026-09-22 (mac lane, PR #975):** `scripts/check-override-parity.mjs` parses the flat `overrides:` block dependency-free, keeps only bare-name keys pinned to a concrete semver (`esbuild: "0.27.3"`), and fails a package.json only when its own declaration is itself a concrete pin that differs — a range or `workspace:`/`npm:` protocol the override satisfies is honest and skipped. Fail-closed on zero pins (guards the esbuild-override-lift backlog row) AND on an unparseable package.json (never a silent skip). `--self-test` + falsifications green; registered in `preflight.mjs` and `review-hub-ci.yml` ("Override parity"), parity gate green.
- [x] **Brain-cycle dispatch stage: a lens-file writer contract and a stale-input guard, so a board can exist (agent plane, MEDIUM; owner: principal-engineer).** `git ls-files artifacts/brain-cycle | wc -l` → 0 on every ref, against `docs/agent/BRAIN_CYCLE_DESIGN.md:99` "one committed directory per cycle"; the four true lens agents (`code-reviewer`, `security-reviewer`, `fail-closed-auditor`, `verdict-core-reader`) have no write scope for `artifacts/brain-cycle/**` — that write-power decision is the precondition. From the ICM clip's self-scan, 2026-09-19. **DONE 2026-09-23 (mac lane, PR):** (a) `readBoard` in `scripts/brain-cycle.mjs` (owner-gated safety machinery — owner-reviewed PR) now requires `_manifest.cycle` (the audited sha, non-empty or throw) and treats a lens whose `auditedSha` ≠ `cycle` (or is absent) as `ran:false`/`UNVERIFIED` — the stale-input guard, the fail-closed "a missing lens is a NO" law extended to a leftover from a previous cycle. The `--self-test` gained fixtures with `cycle`/`auditedSha`, a planted STALE lens (`auditedSha` mismatch → `ran:false` → no winner) and a no-`auditedSha` case → green. (b) the write contract + the write-power grant live in `docs/agent/BRAIN_CYCLE_DESIGN.md` §5 (each lens writes ONE board file via Bash, `auditedSha` = the reviewed sha, `ran:true` only for executed commands, `UNVERIFIED` never omitted; the four lens roles + `signalgrid-reviewer` granted board-write) — placed there, not appended to each lens agent's body, to avoid a merge conflict with the DR-054 raise-hand clause PR that edits those same agent files; `verdict-core-reader` gained the `Bash` tool so it can write. Fixture-only until a real cycle writer runs — the guard is proven, the writer is contracted.
- [ ] **Gate: an intake row that cites a `docs/agent/resource-scans/` file must be backed by it (gates, LOW; owner: devex-tooling-engineer).** Copy `scripts/check-sim-requests.mjs`'s binding shape: for every `RESOURCE_INTAKE.md` row that cites a scan file, the file must exist and hold `proposals[].tasks`, ≥1 `confirms[]` and a `decision` whose task ids ⊆ the proposal's; a decision `landed` names a path that exists. Trigger on the citation, not on the word "Self-scan" (a row can describe the process without a file, and that must read as "no scan file", never as a match). Report the count walked; 0 rows is reported, never silently green. Preflight + CI, parity-gated. Fails without it: a row claiming N confirmed tasks with no confirm record. ICM-3, 2026-09-19.
- [x] **loop:state: warn when the LOOP.md STATE date trails mainline's newest commit by more than a week (loop, LOW; owner: docs-writer).** `grep -rn "LAST TOUCHED" scripts/*.mjs .claude/hooks/*.sh` → only a comment; nothing reads the STATE block's date, and `docs/agent/LOOP.md:1268-1270` records a prior two-day STATE↔body contradiction. One `add()` in `scripts/loop-state.mjs`: parse LAST TOUCHED, compare with `git log -1 --format=%cI origin/SignalGrid_Alpha` (two git dates, no wall clock), warn — `gated: false`, like the Discovery rows — past 7 days. An unparseable date or an unfetched remote produces the warn row itself, never a silent skip. Self-test with a fixture block older than a fixture commit. ICM-5, 2026-09-19. **DONE 2026-09-22 (mac lane):** section 5b in `scripts/loop-state.mjs` reads LAST TOUCHED and compares it with `git log -1 --format=%cI origin/SignalGrid_Alpha`; the verdict is a pure clock-free helper (`stateFreshness`) so the fixtures are deterministic — `>7d` → stale warn, within a week → ok, unparseable → `no-date` warn, unfetched remote → `no-remote` warn, all `gated:false`. Four checks added to the existing `loop-state --self-test` (registered in preflight + CI); `--self-test` → 12/12, live row "STATE (2026-09-21) within 1 day(s) of mainline's newest commit", full preflight exit 0.
- [x] **Decide whether a report-only `claude plugin eval` run belongs beside the shape gates for first-party skills (agent plane, MEDIUM; owner: qa-engineer).** `pnpm run check:absence "prompt regression"` → CORROBORATED: nothing tests a first-party skill's BEHAVIOUR when its `SKILL.md` changes; `scripts/check-skill-plane-conformance.mjs` gates name, description and (since 2026-09-19) model only. The CLI ships `claude plugin eval` (verified with `--help`: `case.yaml` or `prompt.md` + `graders/*.md`, a no-plugin baseline arm). The row: one eval case per high-stakes first-party behaviour (start with `video-intake` — "a transcript is model output, never a fixture" — and `signalgrid-reviewer`), run BY HAND on the Mac when that skill changes, results REPORTED into `docs/agent/EVIDENCE.md`; a run that did not happen is written "not evaluated" and never reads as "no regression". It needs a model, so intake rule 3 and CI's no-model runner keep it off preflight; graders are model output, so a flaky grader is a flaky gate and stays a report. Where `evals/` directories sit under `.claude/skills/<skill>/` they need a publication-boundary class. From the "five weekend projects" clip's self-scan (V-2), 2026-09-19. **DONE 2026-09-23 (Mac lane):** decision is YES, adopt as a REPORT (not a gate). First case landed — `.claude/skills/video-intake/evals/doctrine-transcript-not-a-figure/` — measuring the "transcript is model output, never a figure/fixture/capability sentence" doctrine: `claude plugin eval` (CLI 2.1.281, `--judge-model sonnet --no-publish`) scored WITH-plugin 1.000, W/OUT 0.333, **Δ +0.667** — the skill refused all three forbidden asks every run; without it the model complied 2 of 3. Recorded in `docs/agent/EVIDENCE.md` 2026-09-23. `results/` is gitignored (`/.claude/skills/*/evals/results/`); the case falls under the existing `.claude/skills/video-intake` tooling carve-out (longest-prefix, no `AREAS` edit); no DR — a report does not change how green is certified. `signalgrid-reviewer` case is the next increment, NOT YET evaluated.

### DR-054 silent-stall sweep — remaining LOW-severity follow-ups (2026-09-23, mac lane)

The `silent-stall-sweep` workflow (DR-054) surfaced 9 confirmed sites; the medium ones landed in the sweep PR. These LOW-severity ones are tracked here, not dropped (the law applies to the sweep's own output too):

- [ ] **`catch { continue }` conflates ENOENT with unreadable in 5 gate scan loops (gates, LOW; owner: devex-tooling-engineer).** `check-launch-claims.mjs:1350`, `check-documented-branches.mjs:385`, `check-live-sync.mjs:214`, `check-connector-discipline.mjs:325`, `check-emitter-wire-discipline.mjs:67` each do `try { body = readFileSync(f) } catch { continue }` — a legitimately-absent file (ENOENT, skip correct) and a present-but-unreadable file (a real blocker) are treated the same, so the gate concludes clean over content it never examined. Convert to the `check-override-parity.mjs:117` template: `catch (e) { if (e.code === "ENOENT") continue; unreadable.push(\`${f}: ${e.message}\`); }` and fail if `unreadable.length`. (For `deriveEmitterFamilies` the ENOENT skip is legitimate; only the non-ENOENT branch surfaces.) From the DR-054 sweep, finding #7.
- [ ] **`scripts/lib/ci-jobs.mjs:100` drops a workflow whose `jobs:` is on line 1, with no log (gates, LOW; owner: devex-tooling-engineer).** `const at = text.indexOf("\njobs:"); if (at < 0) continue;` requires a preceding newline, so a workflow starting with `jobs:` contributes zero jobs silently and shrinks preflight's "not covered" disclaimer. Anchor to `/^jobs:/m`, and add a `--self-test` to the parity gate asserting a known job id enumerates and that workflow-files-parsed equals the readdir count. The `check-preflight-ci-parity.mjs` CI-job **floor** already landed (DR-054 sweep PR); this is its paired root-cause + self-test. Finding #5.
- [ ] **`.github/workflows/supply-chain.yml:177` — grype `|| true` hides a scanner crash (CI, LOW; owner: release-engineer).** With no `--fail-on` threshold, grype exits non-zero only on a genuine error (findings do not raise the code), so `|| true` serves no purpose except swallowing a scanner failure — the SBOM step reports success over a scan that never ran. Drop `|| true`, or capture status: `grype … --file grype-report.json; gs=$?; [ $gs -eq 0 ] || { echo "::error::grype failed ($gs)"; exit 1; }`. Finding #9.
- [ ] **`scripts/mac/lane-tick.sh:336` dead monitoring line (loop, LOW; owner: devex-tooling-engineer).** `node scripts/lane-message.mjs inbox | grep -c "→ mac"` anchors on an arrow the inbox CLI never prints (it lives only in `auditLaneMessages`'s returned array, not the CLI output), so the block at 336-341 can never fire. Not a hidden blocker — `append_unread_state` already folds unread state into RESULT — so this is dead code: delete 336-341, or repoint it at `check-lane-messages.mjs` output which does emit the arrow-tagged count. Finding #8.

- [x] **Register `node scripts/objective-loop.mjs --self-test --check` as a fatal preflight gate AND its CI job in ONE pull request, after PR #1019 lands (agent plane, MEDIUM; owner: devex-tooling-engineer).** DONE 2026-09-25 (cloud, after #1019 landed as `19b4dfb7`): two rows appended to `scripts/preflight.mjs` after the raised-hands self-test — `objective-loop.mjs --check` and `--self-test` (`main()` takes one flag at a time, so "--self-test --check" would only self-test; they are two gates) — and the same two `run:` lines in the `validation` job of `.github/workflows/review-hub-ci.yml`. Check: `node scripts/check-preflight-ci-parity.mjs` prints `0 unwired` with the gate count up by two, and `grep -n 'objective-loop.mjs --check' .github/workflows/review-hub-ci.yml` finds the run line. DR-056 §5 pre-authorizes it, so no second record is needed. Not in the DR-056 PR because `scripts/check-preflight-ci-parity.mjs` reds mainline on a preflight row with no CI job, and #1019 is adding its own gate to `scripts/preflight.mjs` — append after that landing and announce the append in the commit message (LANE_COORDINATION rule 2). The check that would fail without it: `node scripts/check-preflight-ci-parity.mjs` must still print 0 unwired, and `node scripts/objective-loop.mjs --check` must be a real `run:` line in a workflow. From the 2026-09-24 objective-loop build.
- [x] **Add `docs/agent/objective.json` to `SAFETY_MACHINERY` in `scripts/check-owner-gated-surfaces.mjs` — the second belt on the owner attestation (agent plane, LOW; owner: agent-platform-engineer).** DONE 2026-09-25 (cloud): one `{rule, re}` line (`the declared objective (DR-056 attestation pointer)`) plus two self-test lines — `objective.json` classifies owner-gated, and the tick-written `objective-state.json` does NOT (the Mac rewrites it unattended). Check: `node scripts/check-owner-gated-surfaces.mjs --self-test` prints 28/28. The criterion ids, scopes and attestation token already live in `scripts/objective-loop.mjs`, so the json alone cannot reach `goal_met`; this makes the file itself owner-gated so a changed `attestedIn` pointer is reviewed as safety machinery, not as a doc. One `{rule, re}` line plus its self-test line; deferred from the DR-056 PR only because #1019 also edits that file's neighbours. From the 2026-09-24 objective-loop build (critic finding, taken).
- [x] **Run the Browser E2E step inside the Apple-container Linux VM on the Mac, so the evidence dimension can reach 100% from this machine (Mac lane, HIGH; owner: devex-tooling-engineer).** DONE 2026-09-25 (PR #1051, DR-057): `scripts/mac/linux-web-build.sh --e2e --attest <path>` runs Playwright chromium + build + the E2E suite in the VM and writes a tree-bound attestation outside the tree; `scripts/verify-all.mjs --vm-native-build` records the two steps from it only when `scripts/lib/native-build-attestation.mjs` binds it fail-closed (schema, status, HEAD sha, clean at launch and at mint, registered names). How you'd check: run the evidence mint with the flag and then `node scripts/check-readiness-figure.mjs`. Measured on the branch HEAD f2d1a459: VM `53 passed (1.7m)`; emitter `native-build attestation: Browser E2E (review console, website, admin) + Build (all packages) attested from the VM run`, `preflightCoverage.stepsNotRun: []`, `verify-all exit=0`; readiness `(b) launch surface, evidence 100% … 20/20 bound proofs/steps current`, `HEADLINE 100% → OUTREACH OPEN`. The minted file was not committed on the branch (it names a sha a squash-merge orphans); the mainline re-mint after landing is the one that counts. Original row: Measured 2026-09-25 after the post-#686 re-mint: readiness (b) = 95% — 19/20 bound proofs/steps current, the ONE not current is `step:Browser E2E (review console, website, admin)`, which `scripts/verify-all.mjs` lists under `stepsNotRun` because the web build is linux-x64-only (`pnpm-workspace.yaml` overrides strip the darwin bundler binaries) and `check-readiness-figure.mjs` counts an unrecorded step as 0 for that entry, fail-closed. The Mac already builds the five vite apps in the Linux VM (`scripts/mac/linux-web-build.sh`, Apple `container`, ~51 s); the change: a `--e2e` mode of that script that installs the pinned Playwright chromium in the VM and runs `pnpm --filter @workspace/scripts run test:e2e` against the built sites, and a `verify-all` step record `{status, manifestFingerprint, reviewHubCommit, sourceDigest}` for it so the emitter no longer excludes it. The check that fails without it: `node scripts/check-readiness-figure.mjs` prints `(b) … 95%` with that step named as not current; with it, 100%. Note for the objective loop (PR #1031): its `evidence-fresh` criterion stays strict (`pct === 100`), so until this lands the loop keeps that criterion unmet and queues the `evidence` operation — that is the honest signal of this gap, not a defect to loosen.
- [ ] **Stamp every open Global-backlog row in `docs/COMPANY_BUILD_PLAN.md` with a `re-measured YYYY-MM-DD`, and make `scripts/objective-loop.mjs` refuse to rank a row whose stamp is missing or older than 14 days (agent plane, MEDIUM; owner: program-manager → devex-tooling-engineer).** Four of the loop's top-ranked rows (5, 6, 8, 9) were found on 2026-09-25 to have shipped 23–36 days earlier with the row still reading open: the loop was ranking finished work, and the tick's `tasks[0..2]` steered the forward-build trigger at it. A stale row is an unknown input, and unknown tightens (rank nothing from it and name the row) rather than loosens. Check that would fail today: an `objective-loop.mjs --self-test` case where a row stamped 15 days ago is excluded with a named reason, and where an unstamped open row fails `--check`.
- [ ] **Estate posture must age: derive freshness at decision time from the record's own sync stamp against the decision clock, not once at sync (decision core, HIGH; owner: principal-engineer → security-engineer; DR-051 proposal before the change).** Found by the 2026-09-25 verdict-core read: `buildEvidence` in `lib/signalgrid-core/src/decision.ts` is handed no clock, so the freshness stamped by `runPostureSync` in `lib/signalgrid-core/src/connector.ts` is final. Reproduced on `8fdc143c`: a Graph-shaped record already `40` days old at read → `restrict POSTURE_STALE_STRICT` (v2); the same device read fresh, then `40` days with no refresh → `step_up` with no stale code; with encrypted/osSupported in the spec → `allow TRUST_ESTABLISHED` at boot and still `allow` `40` days later. Reachable on /v1 estate mode: the refresh loop is off unless `SIGNALGRID_ESTATE_REFRESH_SECONDS` is set, and a failing loop keeps the last good posture. Check that would fail today: a core proof that boots an estate, advances the injected clock past the freshness window with no refresh, and asserts the verdict tightens.
- [ ] **A posture refresh must retract: a fact the source stopped reporting, or a device the source stopped listing, evaluates as unknown after the refresh, and an empty refresh is not a healthy success (decision core, HIGH; owner: principal-engineer → security-engineer; same DR-051 proposal as the row above).** `runPostureSync` in `lib/signalgrid-core/src/connector.ts` upserts and never retracts, which contradicts its own comment and the FixturePostureRecord doc ("absent evaluates as unknown" — true only on the first sync). Reproduced on `8fdc143c`: boot with `encrypted:true` → allow; refresh the same device with `encrypted` omitted → still allow, run `success` (control: booting without it → step_up); a device dropped from the refresh keeps its last posture → allow, run `success`, connector `healthy`; an empty refresh `[]` → `success`/`healthy`, every verdict unchanged. Latent under today's Graph mapper (it never supplies those fields), live for any EstateSpec caller that does. Check that would fail today: `estate-refresh-proof.ts` asserting that a refresh omitting a previously-true fact tightens the verdict and that `[]` is not reported healthy (its current "processes nothing" assertion cannot fail for `[]` by construction).
- [ ] **`fromDevicePosture` in `lib/posture-composition/src/adapters.ts` must fail closed on out-of-domain or missing input instead of falling through to `COMPLIANT_MANAGED` (posture composition, MEDIUM — latent, zero production callers; owner: security-engineer).** Every rule is `value === known-bad/unknown`, so `identityStatus: undefined`, `deviceComplianceState: "error"`/`"conflict"`/`"COMPLIANT"`, `deviceManagementState: "Managed"` or `userRisk: "atRisk"` each → `none/COMPLIANT_MANAGED` (reproduced 2026-09-25). The Graph normalizer maps vendor strings into the domain before this function, and nothing in production calls it, so the grant is latent. Check that would fail today: the 900-state enumeration in `posture-composition-proof.ts` extended with one out-of-domain value per field, each asserting `step_up`. Same read: five adapters (`fromBreakGlass`, `fromCredentialRotation`, `fromCustodyBeacon`, `fromLocalAuthority`, `fromObservabilityIntegrity`) have no caller anywhere and a missing `reasonCodes` throws.
- [ ] **The evaluate-time 'skip malformed rule' in `lib/signalgrid-core/src/policy.ts` is fail-closed only for allow rules: a deny rule with a typo'd field is skipped and an invalid first outcome is returned verbatim (decision core, LOW — unreachable while every stored version passes `validatePolicyRules` or is a seed constant; owner: principal-engineer).** Reproduced 2026-09-25: a deny rule on field `tamperStat` beside healthy-allow, with the real condition confirmed → allow; `mostRestrictive` given `"DENY"` first returns `"DENY"`. The lazy fix is one guard: a stored rule that fails validation at evaluate time evaluates as `deny` with a `POLICY_RULE_MALFORMED` code, never as absent. Check that would fail today: a core proof that writes a malformed deny rule through the store directly and asserts the verdict is deny, not allow.
- [ ] **Dead-authority census from the 2026-09-25 verdict-core read — decide keep-and-read or delete for each (decision core + resolution, LOW; owner: principal-engineer).** `Decision.signalIds` (`lib/signalgrid-core/src/decision.ts`) is persisted and served on /v1 with no first-party reader; `summaryForOperator`, `clears`, `projectedReasonCodes`, `appliedReasonCodes`, `originalOutcome` and `autoResolvable` in `lib/signalgrid-core/src/resolution.ts` have no first-party reader and no proof asserts `summaryForWorker` text; `42` of `43` posture-composition adapters have no production caller. A computed value nobody reads is authority nobody checks (the standing example is `SignalGridDecision.confidence`). Check: the cited-symbols gate holds each name to its file; the decision per field is recorded here.
- [x] **Commit the Tier-1 read-list as data and print `Tier 1: N/25` every run, ratcheted (review coverage, MEDIUM; owner: devex-tooling-engineer).** DONE 2026-09-26 (cloud): `docs/agent/review-tiers.json` carries the 25 Tier-1 paths from the plan's read-list with `targetDepth: audited` and a `mark`; `scripts/check-review-coverage.mjs` gains `auditTier` — N counts files whose best live row is at or above the target, FATAL when N falls below the mark (a read un-read without a retirement), when a listed file is not tracked, or when a row's new optional `sha` is not 7–40 hex; staleness (commits to the file since the row's `sha`, else since its `date`) is REPORTED per file as the re-read queue. First run: `Tier 1: 19/25 at depth >= audited (mark 19) — 10 stale, 1 below depth, 5 with no row`. The six rows read at `8fdc143c` carry their sha. Check: `node scripts/check-review-coverage.mjs` (the Tier 1 line) and `--self-test` (22/22).
