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
      at which point reopen this.

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
      package nothing calls.

- [ ] **Mirror `coreNormalizationVersion` into the Swift models (row 27a follow-through).**
      The stamp now rides three TypeScript carriers (`EvidenceSnapshot`, `Decision`,
      `EvaluateResult`) and the `/v1` OpenAPI response, all as an OPTIONAL field. The iOS
      mirror in `native/ios/.../Models.swift` has not been updated: the three structs need
      an `Int?`, with four construction sites in `MockSignalGridAPI.swift` (lines 86, 406,
      478, 515). **Not attempted blind.** No Swift toolchain exists in the cloud lane, so
      an edit here could not be compiled, and `native/ios` is the one tree where an
      uncompiled change is invisible until a human opens Xcode. Left as a recorded gap for
      the Mac lane rather than a plausible-looking patch. It is not urgent: the field is
      optional on every carrier and Swift's decoder ignores unknown keys, so the current
      apps decode the new payload correctly today — they simply cannot yet SHOW the stamp.

- [ ] **A webhook WRITE route and its validation are one change, not two.**
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
      both call sites and on both schemas instead.

- [ ] **Mirror `reconcileDecisions` into Swift (intake row 51 follow-through).**
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
      *whether its own held decision still stands* before it reconnects.

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
      write-plane stays out of the public tree.
- [ ] **App Protection / MAM state as a decision dimension (intake row 33,
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
      same change; Intune App Protection first, other MAM vendors deferred.

_Derived from repo data, not memory: `check-connector-discipline` reports 36/36
families with KNOWN_GAPS empty, and `check-live-sync` reports `liveEvidence=fresh`
(`artifacts/live-evidence/mac-run.json`, minted on a real Mac 2026-08-07).
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
      without hardware. Needs the Android SDK on the machine.

Not free, stated so the absence is deliberate rather than forgotten: identity-risk
and pim-activation have NO permanent free path (Entra P2 / Governance trial windows
only), and the DDM rig is gated on an APNs push certificate.

## Next

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
      eight of thirty-five today, `dual-control` among them, and it prints WHY (no
      importers at all, versus imported only by the proof harness). It is a ratchet
      pinned at the current count, not a hard gate: unreachable is a requirement to
      look before building, not a verdict to delete. It also corrected a hand count
      made during that pass — `lib/db` is untracked build residue (`dist/` and
      `node_modules/` with no manifest and no source), not a thirty-sixth package,
      which is the ordinary reason a derived figure beats a remembered one.
- [ ] **186 vendored shadcn components are unreferenced, holding 21 packages alive.**
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
      should be held to.

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
      Do NOT commit a detailed provisional spec into a public repo.

## Later / vision

_(see `docs/APP_WORKFLOWS_OPPORTUNITY_MAP.md` for the full app-workflow roadmap)_

## Done (recent)

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

### ECC-role review findings (2026-09-01) — the ones not fixed in the same pass

Two were fixed immediately (fleetDMFreshness future-date fail-open; /v1/step-up/challenge
authorize gap). These remain; see `docs/agent/REVIEW_STRUCTURE_COMPARISON.md`.

- [ ] **Durable audit ledger is tenant-less and /v1/audit reads the in-memory ledger (architect, CONFIRMED high — candidate decision record).** `audit_ledger` (migrations.ts:43) has no `tenant_id` while its sibling tables all do; `/v1/audit` (v1.ts) returns the in-memory `core.listAudit()` (wiped on restart, per-replica), and decision-evaluation audit events are never persisted durably while admin events go only to the durable global chain. You cannot hand tenant A a verifiable copy of only its events. This is the compliance differentiator — it needs a deliberate design (schema migration + tenant-scoped durable read + wiring /v1/audit to the durable ledger), likely a DR, not a rushed patch.
- [ ] **Dead code: competing webhook implementations + unreachable adapters (refactor-cleaner, 3× medium).** Two webhook-endpoint implementations (the unused one still carries a full CRUD/admin surface); three vendor adapter files (SIEM Sentinel/Splunk, telemetry MDE) unreachable from their own factories; `webhooks/emitter.ts` dead with a now-false header. Verify each is truly unreferenced (some knip hits are false positives per the same review), then remove.
- [ ] **iOS ExpiryPolicy/isExpired has no unit test (code-reviewer, medium — native lane).** The Mac lane's 5e3b5c3 nil-expiry fix is safety-critical and framed as closing a fail-open, but no EnterpriseShellTests file exercises `SessionData.isExpired`/`ExpiryPolicy` — a wrong-logic edit inside an existing case would compile and pass every gate. Add a Swift unit test. Mac lane.
- [ ] **Webhook dead_letter status + fixture-sync fail-safe are untested (tdd-guide, medium).** The `dead_letter` terminal delivery status is defined and implemented but never produced or asserted; the 'unresolvable subject → skip, don't trust' fail-safe branch in both fixture-sync paths has no test. Add coverage.

- [ ] **iOS fixed-height rows truncate scaled Dynamic Type text (native lane).** 2026-09-01, flagged by the Mac lane after the Dynamic Type conversion (row 78): `HostAppViewController` has 5 `heightAnchor.constraint(equalToConstant:)` and 0 `greaterThanOrEqualToConstant`, so the now-scaling labels sit in fixed rows and will truncate/overlap at large accessibility text sizes — the conversion was necessary but not sufficient. Static-confirmed; needs a real AX render on the Assist-gate screen (behind a demo-badge injection) to verify each row. Mac lane owns it (Swift + simulator). Screenshot at tools/ios-ax-render.png on the Mac.

### Full-evaluation completion list (2026-09-01) — the real distance to a paying customer

Surfaced by the independent six-dimension evaluation; see
`docs/agent/SOLUTION_READINESS_ASSESSMENT.md`. Six of seven are self-declared in
`scripts/launch-profile.mjs` GAPS — the evaluation confirms that accounting is honest.

- [ ] **Non-demo core constructor.** The served API builds `SignalGridCore.demo()`; it never wires the real Graph connector in `lib/`. Largest gap to a real customer. (gap `non-demo-core-constructor`.)
- [ ] **Verdict enforcement / step-up answerability.** The gate returns `step_up` in shadow mode with no launch route to answer one. (gap `step-up-answerability`.)
- [ ] **Real connector auth in the deployable image.** Graph transport exists but the shipped server imports none of it; prod image runs the fixture core. (gap `device-management-health`.)
- [ ] **Secrets management.** No manager exists; DR-010 model unimplemented, rotation is a runbook claim. The one real security gap. (`docs/SECRET_MODEL.md`.)
- [ ] **Data lifecycle (retention / deletion / DSAR).** None implemented in any durable store; caller request-context persisted with no deletion path. (`docs/DATA_RETENTION_AND_PERSONAL_DATA.md`, DR-003.)
- [ ] **Serve the Assist wire the SDKs bind.** Kotlin/Rust SDKs bind a planned `POST /v1/authorize` not served or specced; real envelope is `POST /v1/decisions/evaluate`. (gap `assist-wire-unserved`, DR-007.)
- [ ] **Runtime enforced-vs-observed status route.** No route reports what the running server actually enforces per signal kind (Blocker 10). (gap `runtime-launch-status`.)

New ideas land here first (CLAUDE.md scope rule), then get ranked.

- [ ] Marketing-site narrative still tells the v1 gate story. 2026-08-31: the
      retired "Shared-Device Trust Gateway" label was scrubbed from the title,
      social meta, hero badge, About page and review deck, and the framing gate
      now scans those files — but the hero headline ("Should this shared device
      proceed right now?") and the page's flow still frame SignalGrid as a
      yes/no gate, not the DR-020 orchestration grid (a decision as the trigger
      for a cascade; the worker never sees it). That is a copy/design pass, not
      a label swap — same shape as the Sessions-first IA rework in the app.
- [ ] Credential revocation has storage but no semantics. 2026-08-31 (IAM
      coverage sweep): `removeCredential` exists in the WebAuthn store with no
      route exposing it and no proof asserting revocation behavior — and the
      security roster (row 82) separately found it lacks the lock its
      neighbors have. Route + lock + an add/remove concurrency proof belong in
      one change. See `docs/research/IAM_CORE_COVERAGE_MAP.md`.
- [ ] The iOS shell captures SAML config keys backed by nothing. 2026-08-31
      (IAM coverage sweep): `ProviderConfigurationService.swift` accepts
      SAML_ENTRY_POINT / SAML_LOGOUT_URL / SAML_CERTIFICATE while no SAML
      assertion processing exists anywhere — a dangling surface to remove or
      implement, never to leave half-present. Native lane.
- [ ] The retention/deletion admin job is still undesigned. 2026-08-31 (IAM
      coverage sweep): DR-003's status note ratifies that no durable store has
      a retention mechanism and the runtime role is proven-denied DELETE, so
      honoring any window or DSAR needs an admin-credential job that does not
      exist. `check-retention-claims` keeps surfaces honest meanwhile. See
      `docs/DATA_RETENTION_AND_PERSONAL_DATA.md`.
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
      as current measurements.
- [ ] Default `review-demo` profile mounts sim + control-plane routes
      unauthenticated. 2026-09-01 (security/adversarial scan, attack-surface
      review): informational, not a code defect — `POST /api/sim/room-entry`
      and `/cp/v1/*` carry no auth under the default profile and the sim route
      mints a seed tenant's own token server-side. Already documented and
      gated: `SIGNALGRID_PRODUCT_PROFILE=shared-device-gateway` unmounts both
      routers, cross-checked by `scripts/check-launch-profile.mjs`. A real
      (non-review) deployment must set that variable — a deployment-checklist
      item, not an in-code bypass.
