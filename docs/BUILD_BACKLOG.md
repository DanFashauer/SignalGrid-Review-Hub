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

_Derived from repo data, not memory: `check-connector-discipline` reports 36/36
families with KNOWN_GAPS empty, and `check-live-sync` reports `liveEvidence=none`.
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

- [ ] **Fleet live-query results (websocket campaign collector).** `runQuery()` now
      THROWS `not implemented` and sends nothing. Fixing its request body alone would
      have armed the most dangerous call in the package — arbitrary osquery SQL to
      real production hosts — while still returning nothing usable, because a Fleet
      live query is asynchronous: the POST returns `{campaign}` and rows stream over a
      websocket, so the old `data.results` was always `undefined` despite its array
      type. Doing this properly means a websocket client plus a result-collection
      policy (timeout, partial results, per-host errors) — and, given the blast
      radius, an explicit approval gate rather than only the tier gate.
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

- [ ] **The UI-library majors (recharts / react-day-picker / react-resizable-panels /
      zod 4 + @hookform/resolvers).** Must ship WITH the bump — measured, not assumed.
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

- [ ] **Merge `signalgrid-mcp#fix/unblock-live-evidence` → `liveEvidence` goes
      `none` → `fresh`.** ⚠️ **one merge in the OTHER repo; everything else is done.**
      This is the repo's longest-standing gap (`STATUS.md`: "real-hardware evidence:
      none"), and it turned out not to need a supervised device or any purchase.
      Two things blocked it, both now cleared or diagnosed:
      1. *Review-Hub half* — `verify-all.mjs` runs the FULL preflight, which includes
         `pnpm run build`, believed unrunnable on macOS. It runs fine once the four
         stripped darwin binaries are supplied (commit `d637404`). **Cleared.**
      2. *signalgrid-mcp half* — its `pyproject.toml` pinned `mcp>=1.9.0` with no
         upper bound. The MCP Python SDK released **2.0.0**, removing
         `create_connected_server_and_client_session` from `mcp.shared.memory`, so a
         fresh checkout fails at pytest COLLECTION: 4 files error, 0 tests run. It
         reads as a broken repo but is a moved API. Pinning `<2` restores it and
         `verify.sh` exits 0. **Fix pushed as a branch, NOT merged — owner call.**
      Verified end-to-end on 2026-07-31: with both in place, both halves pass and
      `mac-run.json` mints. That evidence was deliberately NOT committed, because it
      was produced against a local ad-hoc merge — the evidence schema records
      `mcpCommit`/`mcpDirty`, and publishing a run against an unpushed dirty tree
      would be exactly the manufactured confidence this repo keeps deleting.
      After merging: `SIGNALGRID_MCP_PATH=~/signalgrid-mcp node scripts/verify-all.mjs
      --require-mcp --emit-evidence`, then commit `artifacts/live-evidence/`.

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
      brief) + `docs/IP_AND_DISCLOSURE.md`. Do NOT commit a detailed provisional
      spec into a public repo.

## Later / vision

_(see `docs/APP_WORKFLOWS_OPPORTUNITY_MAP.md` for the full app-workflow roadmap)_

## Done (recent)

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
