# Company build plan — full-estate sweep, 20 Aug 2026

**How this was produced.** Eleven parallel audit lenses — one per part of the
company — read this repository simultaneously, each returning findings with
file-level evidence and ranked actions. A synthesis pass merged them into the
single plan below. 95 findings, 74 proposed actions, 5 drafted deliverables.

**Verification status.** The five blocking claims were independently reproduced
by the operating session before this document was committed — not taken on the
sweep's word:

| Blocking claim | Reproduced |
| --- | --- |
| `network-nac` grants `on_trusted_segment`/`none` with `nacCompliant` and `lastAuthAt` both null | Yes — executed, same output |
| `identity-risk` grades `riskState: "unknown"` as `trusted`/`NO_RISK` | Yes — executed, same output |
| iOS `BackendService.swift` calls `/api/sessions/*` and `/api/badges/*`; server serves `/api/v1/sessions/*` and no badges routes | Yes — grep confirmed both sides |
| No GRANT/REVOKE SQL exists anywhere; the app role creates (so owns) `audit_ledger` | Yes — grep confirmed |
| The public site presents badge/zone/shift signals as present-tense product; all three are deferred | Yes — both files confirmed |

Everything below the blocking tier carries the evidence its lens recorded;
claims marked ASSUMED in the lens records were not independently re-verified.
The raw per-lens records live in the session transcript, not this document.

**Status of "this week" item 1:** the two grant wedges (backlog 1–2) were fixed
the same day this plan landed — see the commit that follows this one.

---

Three of your security connectors hand out trust on inputs they never verified, the audit-ledger hardening queued last shift cannot work as designed, and your flagship iOS app calls five backend endpoints that do not exist — those five items head this plan. The engineering estate is genuinely disciplined wherever a gate watches it, and provably drifting everywhere one does not: the defects found this sweep sit almost entirely in the 14 unguarded connector families, the unread decision core, the docs no gate scopes, and the marketing copy nothing checks. The go-to-market layer is furthest behind: five buyer-facing surfaces describe five different products, the public site sells deferred capability in the present tense, and the published per-device prices float above a cost model that does not exist.

## Global backlog (ranked across the whole company)

Blocking items first. "Fail-closed" means: when the system cannot verify something, it tightens the answer rather than waving the action through.

1. **Close the network-nac grant wedge** — network-domain. DONE (PR #219, Shift 1 tranche 1 — full-space enumeration closed it and caught a fourth wedge). An authenticated device with both compliance and auth-freshness unreported currently earns a full grant; per the live-shape record that unconfirmed combination is the *common* case on a real RADIUS wire, not an edge. (Blocking; decision-core lens, executed counterexample.)
2. **Make identity-risk treat "unknown" as unknown** — iam-domain. DONE (PR #219 — riskState "unknown" has its own raising arm at evaluate.ts:116, "none" separated). Today riskState "unknown" grades a principal trusted with no action, and a vendor renaming one enum value silently converts parse failure into trust. Give the vendor value "none" its own arm and make "unknown" raise. (Blocking; decision-core lens.)
3. **Build the database role split the ledger hardening actually requires** — data-persistence-engineer. DONE (PR #222 — restricted runtime role, both directions proven on real Postgres). There is no DELETE grant to revoke — the app role owns the tables it created, so a plain REVOKE is theater. Ship a grants bootstrap: a restricted runtime role with exactly the SELECT/INSERT/UPDATE set this sweep measured, and two-URL operation (runtime vs admin). Verify the audit backend still boots under the restricted role. (Blocking; security-persistence lens.)
4. **Teach the restore path to preserve that posture** — data-persistence-engineer. DONE (PR #222 — restore recreates the posture; DELETE refused + INSERT works pinned in proof:backup-restore). As written, the first real restore either strands the app with zero privileges or silently re-mints it as table owner with DELETE back. Re-apply grants after pg_restore and pin both directions in proof:backup-restore (DELETE refused, INSERT still works). (Blocking; security-persistence lens.)
5. **Point EnterpriseShell's badge/session lane at the real backend** — mobile-native-engineer, days. BackendService.swift calls five endpoints that exist nowhere in this repo; on a real device the first badge tap 404s, silently. Port the session lane the way DecisionService already was, and either build the badges routes or declare the gap in the launch profile. (Blocking; native lens.)
6. **Rewrite the public site to the launch scope, then gate it** — web-engineer (copy, hours) + devex-tooling-engineer (gate, days). The site currently presents badge, zone, and shift signals — all deferred — as the shipping product. Rewrite Hero/Problem/Verticals/About to the three launch signals; then build the launch-claims gate that fails buyer-facing copy asserting deferred capability, so this cannot recur. (Blocking; positioning lens.)
7. **Land one sentence and one category label** — positioning-messaging, credited also to proof-led-content, hours; plus docs-writer days to reconcile EXECUTIVE_ONE_PAGER.md and ECOSYSTEM_POSITIONING.md to it. Five incompatible product labels are in circulation and design-partner outreach is blocked on this by the roster's own record. The draft exists (see Drafts below) — land it as docs/POSITIONING.md with its per-claim trace. (Blocking; positioning + proof-led-content lenses.)
8. **Read the verdict code** — principal-engineer, days. The ~2,900 lines that compute every allow/step_up/restrict/deny (engine, decision, policy, resolution, evidence, composition, simulator) have no named reader while the web frontend sits at 15% coverage. Run Tier-1 shifts 1–2 from the committed read-list, adversarially against the fail-closed invariant. (Blocking; review-coverage lens.)
9. **Extend the grant-safety enumeration and mutation guard to the 14 unguarded families** — security-engineer, days. All three confirmed grant defects live in exactly the tier outside both harnesses, and that tier is the security-heaviest (EDR, attestation, NAC, identity risk, credential exposure). First tranche: the five named; the credential-exposure scannerEnrolled defect falls out of this work. Track the remaining nine as a visible checklist. (Decision-core lens.)
10. **Fix the gates that cannot fail or over-claim** — devex-tooling-engineer + qa-engineer. DONE 2026-08-22, all four in one pass, each falsification-checked: (1) check-pagination-truncation gained a vacuity floor (11 capped connectors detected, floor 8 — fewer means the DETECTOR broke) and a self-test the regexes must pass before the scan may conclude anything; (2) the mutation-guard header's hand-written 'every connector' claim is now self-limiting — coverage is the proof's own output, because a hand-written 'every' once outlives its registry; (3) the parity checker no longer silently drops bash -c gate registrations while claiming otherwise — the three bash gates now resolve to real keys (all three were, fortunately, already wired in CI) and an unparseable bash gate fails loudly; (4) the iOS 'Security Analysis' step, which ended every check in '|| echo PASS' and could not fail in either direction, now FAILS on credential-shaped literals and non-local http:// URLs (filters verified clean against the tree AND catching planted bad lines) with TODO counts honestly labelled reported-not-gated. Four in one batch: the mutation-guard header claiming coverage it does not have; check-pagination-truncation's missing vacuity floor and self-test; the parity checker silently skipping bash -c steps while its comment says otherwise; and the iOS CI "Security Analysis" step that passes whether or not it finds a secret. A gate that is green in both directions is the repo's own named worst defect class. (Decision-core, gate-estate, native lenses.)
11. **Widen the determinism gate and disposition lib/location** — devex-tooling-engineer + principal-engineer, days. The largest body of decision logic (46 evaluators plus four gating libs) sits outside every no-wall-clock/no-randomness scan — clean today by grep, not by gate — and lib/location is an orphaned package with Date.now in signal-admission logic and zero importers. Extend review-invariants; wire lib/location behind a real surface with an injected clock or remove it with a tombstone. (Decision-core + gate-estate lenses.)
12. **Commit the tiered read-list and run Tier-1 shifts 3–5** — program-manager, security-engineer, data-persistence-engineer, devex-tooling-engineer, days. Shift 3: the /v1 auth chain (context.ts is the single point where a bearer token becomes a tenant principal, and it is unread). Shift 4: the durable path including the ledger write path. Shift 5: the meta-gates that define what green means, plus the two unread launch-family evaluators. While there, harden the coverage ledger itself: record commit SHAs, stop prefix claims covering files added later. (Review-coverage lens.)
13. **Fix the OpenAPI spec's omissions and structural invalidity** — api-contract-architect. LARGELY DONE 2026-08-22: the three sessions paths declare {id} via the components Id ref, and the new validator exposed 12 responses whose unquoted flow-style descriptions had silently parsed into bogus extra keys (a comma inside { } splits the scalar) — all quoted; the file now validates as OpenAPI 3.1. REMAINING: the response-code completeness half (missing 401/403/400/404 entries) — that enumeration belongs to row 14's observed-vs-documented probe, which is the gate that keeps it closed. Add the missing 401/403/400/404 entries this sweep enumerated, declare the {id} parameter on the three sessions paths (any partner validator rejects the file today), scope the rate-limit sentence, document the idempotency edges. All additive. (API lens.)
14. **Build the status-code arm of the contract gate** — qa-engineer, days. Extend the existing spec parser ~30 lines to capture documented response codes, probe each /v1 route from the already-booting test harness, fail when an observed 4xx is undocumented. 8 of 12 sampled routes drift today; nothing catches the next one. (API lens.)
15. **Put a real OpenAPI validator in preflight** — devex-tooling-engineer. DONE 2026-08-22: scripts/check-openapi-valid.mjs — @seriousme/openapi-schema-validator (zero transitive deps) plus the AST path-parameter check the schema alone does not enforce, SELF-TESTED first (refuses to run if the validator passes a broken document), registered in preflight AND CI (parity green). It caught 12 real corrupted responses on its first run — the gate paid for itself before it was even committed. Nothing in the repo parses the published contract as OpenAPI — two regex readers, and codegen reads the other file. One devDependency, one preflight row. (API lens.)
16. **Close the markdown secret-scan blind spot** — security-engineer. DONE 2026-08-22, both halves FALSIFICATION-TESTED: the blanket .md path exemption in .gitleaks.toml is REPLACED by line-scoped allowances (measured first — gitleaks 8.30.0 over the full tree found exactly 5 findings without the exemption, every one illustrative: the RFC 7638 public-thumbprint exhibit, YOUR_* placeholders, two word/word prose fragments — each allowlisted by its own shape, with the prose class targeted at the candidate SECRET so real keys on the same line still fire). A high-entropy GitHub PAT planted in a doc is now CAUGHT (github-pat rule; it passed green before). The safety-check backstop grew from 5 to 10 patterns plus the connection-string-with-real-password rule the row named (entropy-proxy tuned so lab fleet:fleet and CI ci-smoke throwaways do not fire), with a SELF-TEST that refuses to scan if any pattern misses its runtime-built plant. Gitleaks path-allowlists every .md file and the backstop scanner knows five patterns, so a real connection-string password or API key pasted into docs passes both gates green — in exactly the file class where operators paste DATABASE_URL command lines. Widen the backstop patterns with self-test fixtures, replace the blanket .md exemption with line-scoped ones. (Security-persistence lens.)
17. **Run the three wire-truth shifts and bind the records to the code** — itsm-ops-domain, iam-domain, devex-tooling-engineer, records-archivist, days. Every live check so far has found a real fixture-vs-wire divergence — 10 checks, 10 hits — so the 35 unchecked dimensions are a statistical certainty, not a hypothetical. Next shifts in weight order: ITSM lab (28 combined references, seven never-driven vendor adapters), shift-context (19 references and it grades allow when unverified), access-governance (11 references on the Keycloak lab that already exists). Also: annotate the three orphaned shape-check records at the types they verified, and commit the coverage ledger doc so counts stop drifting in prose. (Wire-truth lens.)
18. **Make iOS port parity behavioral, not textual** — mobile-native-engineer, days. Emit deterministic decision vectors from the TS engine, replay them in a Swift test, add the TS engine paths to the iOS CI trigger. The gate's stated excuse — no Mac in CI — stopped being true when the macos-native job landed. (Native lens.)
19. **Finish Dynamic Type and pin it with a lint rule** — accessibility-specialist, days. The screens that render the Assist verdict still hold 14 fixed-size font calls; writing the rule in CLAUDE.md twice has not held it, so add a SwiftLint error banning raw systemFont outside DesignSystem.swift. Queue the Mac-lane sim-request that screenshots the verdict screen at accessibility-extra-large. (Native lens.)
20. **Fix the docs entry points and drain the orphan list to zero** — docs-writer. DONE 2026-08-22: the CI doc's first screen no longer enumerates a stale command list (it described 5% of the CI that exists) — it now names the six jobs, the fifteen workflows, and the parity gate that makes drift impossible, with counts phrased as the gates' own output; the index's '31 roles' fossil trued to the 41-role roster with derived phrasing; the orphan list already drains to zero on every gate run; and PROOF_COVERAGE_AUDIT.md carries the honest scope line ('28 gates as of 2026-08-03; the suite is at 136 — treat unlisted gates as UNAUDITED, not as fine'). The CI doc's first screen describes 5% of the CI that exists; the index claims 31 roles against a 40-role roster; the doctrine doc behind a CLAUDE.md golden rule is unreachable from any index; two ready-to-use owner drafts are filed where you cannot find them. Add the honest "28 of 134, as of 2026-08-03" scope line to the proof-coverage audit. (Docs lens.)
21. **Write the glossary and tier the index** — docs-writer. DONE 2026-08-22: docs/GLOSSARY.md (42 terms, usage-grounded, including the honest entry for "Level 10" as a recorded fossil warning), the first-hour-by-audience table now opens INDEX.md (five audiences, the unsubstantiated "Level 10 review" heading retired per CLAIM_INVENTORY), and REPO_LAYOUT.md carries the derived 43-package table dated and marked derived-not-curated. The corpus is written in a house idiom ("unearned affirmative", "breadth freeze", "Level 10") no outsider can parse, and the 64KB index fails its one job. A ~40-term glossary plus a 20-line "first hour by audience" table on top of the existing catalog. Refresh REPO_LAYOUT.md to all 35 packages. (Docs lens.)
22. **Stand up the cost model and shift economics** — finance-fundraising + agent-ops-economics. LANDED 2026-08-22 as docs/COST_MODEL.md from this sweep's draft: serving economics, device lines, run-rate exposure, cost-per-shift denominators published, every unpriced line TBD with its closing condition named, and the owner-private channel defined (billing VALUES never committed; computation in-session; only derived aggregates may land). REMAINING: the TBD closures per the doc's own table — two agent-computable at decision time, one owner billing fact (Apple fee), the spend numerator recomputed monthly in the private channel. The site publishes $8/$14 per-device prices with no cost side anywhere in the tree. The skeleton is fully derivable from committed files today (see Drafts); every unpriced line stays TBD, never guessed. Publish shift denominators now so one owner billing number later yields cost-per-shift instantly. (Finance lens.)
23. **Decide the Fleet Premium question before 2026-09-16** — endpoint-uem-domain, hours. The one identified paid dependency in the evidence path; whether a per-deployment license line exists in COGS is currently unknowable, and the trial clock has ~27 days. (Finance lens.)
24. **Stage the ledger-truncation article for your review** — proof-led-content + compliance-analyst, hours. The draft exists (below), every number traces, and it publishes nowhere without your approval. Independent verification pass first; drafts 2–4 queue behind it with the corrected framings (NAC as "derived state, not wire fact"; the gateway CA name generalized; the one-IdP caveat in the Keycloak lede). (Proof-led-content lens.)
25. **Bound the CI jobs and wire the Mac lane's alarm** — sre, hours. Nine CI jobs have no timeout (two of them PR-gating; a hang holds a required check for six hours), and the weekly macOS lane fails into a tab nobody reads between Mondays. (Gate-estate lens.)

26. **Role-split follow-ups from PR #222's round-9 review (post-cutoff)** — data-persistence-engineer + security-engineer, days total, none launch-blocking. Eight findings arrived after the declared review cutoff (PR #222 comment, 2026-08-20); the core append-only-by-privilege claim is unaffected — these deepen adjacent hardening. Each needs its executed counterexample when picked up, per the standing acceptance bar:
    - Invoker (non-definer) BEFORE INSERT triggers on the ledger can suppress or rewrite an append without UPDATE privilege; also have `appendWithChain` verify the inserted row count. (P1)
    - Archive-shape validation before destructive restore: an older archive carrying a rule/definer-trigger on a managed table is refused only after `pg_restore --clean` replaced the target; validate the archive's structure first (staging restore or catalog scan of the dump). (P1)
    - PUBLIC-inherited grants on noncanonical relations: the runtime can inherit read/write access to tables outside the four managed ones; extend the effective-privilege refusal beyond schema CREATE. (P1)
    - Migration v1 DDL and `schema_version` are search_path-relative while v2 grants and store DML are `public.`-qualified; force a migration-local `search_path` or qualify the baseline. (P1)
    - Negative (forbidden-privilege) readiness probes for the decisions/evidence/sessions stores, mirroring the ledger's — DELETE/TRUNCATE drift currently rides under a green /readyz. (P1)
    - Schema `USAGE` in every store's readiness probe: table ACLs answer true even when the schema itself is unreachable. (P1)
    - TEMPORARY privilege: PUBLIC holds TEMP by default, so `CREATE TEMP TABLE` still works under the "no DDL" wording — revoke it or narrow the documented boundary (shadowing is already defused by qualified statements). (P2)
    - Definer-routine refusal over-fires for routines in schemas the runtime cannot USE — combine the function ACL with effective schema access to avoid blocking migrations on unreachable paths. (P2)

27. **Wire WEBAUTHN_REQUIRE_STEP_UP_FOR_ADMIN or retire it** — security-engineer + api-contract-architect, hours. The flag is parsed into the WebAuthn config but no route consults `requireStepUpForAdmin`: admin actions (e.g. `/v1/remediation/:id/approve`) enforce role checks only, so setting it changes nothing — a documented security control that is a dead knob (found by PR #225 round-7 review; the runbook row now says UNENFORCED). Either enforce a fresh step-up on the named admin actions with an executed counterexample proving the refusal, or delete the config field and the row. (Security lens.)

28. **Positive-path OIDC in the gateway smoke** — devex-tooling-engineer + iam-domain, days. The CI deploy-stack job proves the negative auth path on the packaged image (demo bearer 401, unconfigured/empty-map gateway → not-ready) but the positive path only at the test:api layer: no signed, mapped enterprise token ever completes an allowed `/v1` request against the running container, so a broken JWKS fetch or claim-mapping in the packaged composition would ride under a green job. Stand up a deterministic local JWKS/IdP fixture in the compose smoke and require one valid token end-to-end. (Filed at PR #225's declared cutoff, round-8 finding; gate-estate lens.)

29. **Assurance-pass advisories, batch one (2026-08-21)** — devex-tooling + design + mobile-native, hours each. The org's first self-review confirmed 20 findings (all remediated in PR #231) and filed 14 advisories; the unapplied ones, each needing its executed check when picked up: a bash-3.2 compatibility gate (shellcheck is version-blind, so 4.x-isms pass the lint that exists because of a 3.2 failure); a Darwin guard for scripts/mac/*; pinning the "42 shared conformance vectors" figure and the step-up chip's 4.58:1 margin; a reachability assertion for declared-gap closedWhen dir-conditions (the evaluator must be able to read at least one file the condition names); the ECOSYSTEM §2.1 worker copy aligned to descriptor language; and the real one to watch — the iOS host app renders a near-divergent reason-code vocabulary from the catalog's, which is the catalog's next consumer to reconcile. (Gate-estate + design lenses.)

Dropped below the cut, tracked in lens records: the shared-evaluator-skeleton refactor (week+), the /metrics timing-safe compare, the cp/v1 requestId envelope fix, the shell-lint population widening, the Autopilot-era doc archival stamps, and the weekly deferred-family sampling cadence (starts after Tier 1 completes).
30. **Graph launch-subset Bruno collection + transport abstraction check** — endpoint-uem-domain + api-contract-architect. LARGELY BUILT 2026-08-21: artifacts/lab-collections/microsoft-graph/ transcribes the connector's REAL three-request transport (not the report's wider proposal — the collection must not assert more than posture-connector.ts does) with permissions.json as the least-privilege consent record. REMAINING: the msgraph-metadata OpenAPI cross-diff (too large to vendor; belongs in a CI job) and live-tenant validation, a milestone that arrives with the tenant. Per the 2026-08-21 research report: curate a Bruno collection under `artifacts/lab-collections/microsoft-graph/` covering ONLY the ratified launch endpoint families (`managedDevices`, compliance policies, groups/transitive members), generated or hand-derived from `microsoftgraph/msgraph-metadata` rather than from memory; assert the existing graph connector's fixture shapes against it, and record the application-identity least-privilege permission list (`DeviceManagementManagedDevices.Read.All` class) as data. No live tenant required; live validation is a milestone that arrives with the tenant. No launch-scope change — graph is already the launch family.
31. **Adversarial-trust Bruno folder** — qa-engineer + api-contract-architect, days. The report's strongest test idea: a collection folder where every request PROVES no unearned affirmative — missing source, stale evidence, unknown device, contradictory identity, expired local authority, cross-tenant IDs, unsupported signal, malformed timestamps, replay. Wire into `scripts/run-bruno-collection.mjs` as a third pass; each request asserts the tightened verdict, not just a status code.
32. **Release-evidence lane: Syft + Grype + Cosign** — release-engineer. LARGELY BUILT 2026-08-21 (same day as filed): image SBOM + vulnerability evidence live in supply-chain.yml (per-PR, reported) and scheduled-verification.yml (daily, gated on critical-with-fix), tools sha256-pinned; docs/RELEASE_EVIDENCE.md records the chain. REMAINING: cosign signing — held for the owner's key-custody decision (owner hands, below). Adopt the three `INTERNAL_COMPANY_TOOL` P0 rows the registry now carries: SBOM-from-image (complementing the in-repo source-scope generator, whose docs already state container scope is NOT covered), vulnerability scan with database version recorded as evidence, and artifact signing with key-custody decision recorded BEFORE the first signature. CI stages after the existing supply-chain job; scanner-database drift means results are evidence with a timestamp, never a frozen claim.
33. **Lab telemetry: OTel Collector + Prometheus profile** — sre. BUILT 2026-08-21: opt-in lane in run-live-lanes.sh (--with-telemetry; app /metrics → collector → Prometheus asserted end to end via the Prometheus query API), pinned images, docs/METRIC_STANDARDS.md written BEFORE any tenant-shaped label exists (rule 2 requires a DR for one). REMAINING: first live run — queued as sim-request 2026-08-21-telemetry-lane-first-run (no engine in the cloud session); deployedInLab flips on its pass. A compose profile (off by default, like the heavy lanes) giving the lab connector-health, decision-latency and stale-evidence metrics; a metric privacy/cardinality standard BEFORE the first tenant-shaped label. The registry reclassified both rows for this (OPEN_STANDARD / INTERNAL_COMPANY_TOOL, P0 tier); adoption is this row, and `deployedInLab` flips only when `run-live-lanes.sh` actually starts them.

### Report v3 intake (2026-08-22): open-source lab + integration stack

The owner's third research report arrived 2026-08-22. Most of its thirty rows
were already dispositioned — 43 of the registry's rows predate it, its six
integration classes and three priority tiers are the registry's own enum, and
its "profiles, not one giant compose file" doctrine is what
`run-live-lanes.sh` already is (each lane a profile; Wazuh auto-provisioned
but skippable; telemetry opt-in). The genuine deltas, filed:

34. **Registry delta v3** — DONE 2026-08-22 with intake: openbao (P0),
    authentik (P1), trivy (P1), uptime-kuma + zitadel (deferred, with
    reasons), snipe-it org corrected to grokability. Registry at 48 rows,
    both halves synced.
35. **OpenBao secret boundary** — secops-domain, days. MODEL DRAFTED
    2026-08-22, same day as filed: docs/SECRET_MODEL.md (five rules: path
    naming as audit trail, per-consumer service identities, the
    agent-never-holds list, leases with rotation proven by rotating,
    snapshots under backup discipline) and DR-010 PROPOSED. BLOCKED on two
    things, honestly: owner ratification of DR-010 (owner hands, below) and
    a runnable container engine for the lab deployment. Until both: no
    instance, no stored secret, mutationsAllowed false.
36. **Second-IdP source independence: authentik** — iam-domain, days.
    The Fleet/Headwind pattern applied to identity: Keycloak (live-proven
    2026-08-21) and authentik feeding the same normalized evidence must
    produce the same decisions under fresh/stale/missing/contradictory
    states. Trigger: identity breadth scheduling, not before row 35 (its
    credentials should be born inside the secret boundary).
37. **Trivy beside Grype** — release-engineer. DONE 2026-08-22:
    trivy v0.74.0 (sha-recorded) beside grype v0.112.0 over the committed
    1299-component SBOM — 19 findings each, identical severity histograms,
    ZERO true disagreements; the eight per-side deltas are the same
    vulnerabilities under different id schemes (GHSA vs CVE), mapped 1:1 in
    artifacts/scanner-comparison/2026-08-22-grype-vs-trivy.json. DECISION
    the row asked for: corroboration, not divergence — no second gate;
    trivy stays an on-demand cross-check, re-run on scanner majors or when
    image-scope scanning exists (where the analyzers genuinely differ).
38. **Free-tier proprietary validation targets** — design-partner-outreach +
    endpoint-uem-domain, when a pilot's stack matches: Miradore (free plan,
    up to 50 devices) and ManageEngine Endpoint Central (free to 25
    endpoints) are the report's proprietary-SMB contrast points to Fleet.
    Validate API entitlement IN the free tier before any connector work —
    do not assume the free plan includes the API.

Two report items deliberately NOT adopted as rows: its Aug-24 twelve-week
gantt (this repo runs a live queue, not a calendar plan — sequencing above
is by trigger) and its MCP tool list (16 tools exist and their surface is
wire-proven; a reconciliation pass against the report's list belongs in the
next MCP change, not as standalone churn).

### DR-013 org sweep (2026-08-23) — the roles' own findings

Ten chartered seats reviewed the repository under DR-013 (open-source proof
IS product proof; everything legitimate, including the source itself) before
a usage limit stopped the remaining thirty-one. Their raw findings are
preserved in the workflow journal; the substantive ones are queued here.
**Two were fixed on discovery** because they indicted work shipped hours
earlier — that is the loop working, not a reason to soften the record.

39. **~~Launch-claims gate blind to its own defect class~~** — DONE
    2026-08-23 (found by web-engineer + positioning seats, fixed same hour):
    the gate matched `Evaluated today` but not `evaluated-today`, so the
    pricing page sold **six** evaluated-today dimensions against a
    three-signal scope, green. It also scanned only the SPA source while
    `pages.yml` publishes seven standalone `docs/*.html` pages to
    signalgrid.app — the competitive battlecard among them, carrying sixteen
    unhedged deferred-capability claims including "we fuse custody/tamper +
    CIS baseline (they don't)" as our differentiator, live to buyers. Fixed:
    markers are case/separator-insensitive AND negation-aware (Hardware.tsx's
    correct "*not* evaluated today" must never be punished — a gate that
    punishes honesty is worse than none); scope is now DERIVED from the
    deploy workflow, so adding a page to pages.yml puts it under the gate
    with no second edit. Copy fixed at source: pricing, integrations, the
    room-console generator, fabric/evidence banners, and four battlecard
    differentiators rewritten to the provable ones (per-action + freshness +
    fail-closed + evidence).
40. **Row 7's reconcile half never ran** — docs-writer + positioning, days.
    EXECUTIVE_ONE_PAGER, ECOSYSTEM_POSITIONING and pitch-deck still open with
    the retired "operational trust orchestration layer" and name custody /
    credential-reader / network as connected capability. DR-011 rules those
    wrong; no gate scopes prose docs. (Verified 2026-08-23.)
41. **POSITIONING.md's claim-to-proof trace has fossilized** —
    positioning + devex, days. The trace is what makes the positioning
    DR-013-legitimate, and its `launch-profile.mjs` line anchors now point at
    unrelated content. Needs anchors that resolve by ID, plus a gate.
42. **The verdict core still has no named reader** — principal-engineer,
    days. `review-coverage.json` carries zero entries for the ~2,900 lines
    computing every verdict; `review-tiers.json` was never committed.
    Blocking row 8 restated with measurement.
43. **Falsifiability is enforced only for the connector tier** —
    qa-engineer, days. Mutation coverage does not reach the verdict core;
    `signalgrid-grid` still ships ~90 assertions over local literals that
    cannot fail; 21 of 50 check-gates carry no self-test; eight written
    security suites (`tests/security-reference/`) run nowhere.
44. **Two ungated contracts in the governance layer** — HALF DONE
    2026-08-23: the decision-record format contract now has
    scripts/check-decision-record-format.mjs (preflight + CI). DR-010 through
    DR-013 — every record written in one fast day — were missing the reversal
    clause the file's own preamble promises; all four now carry one. The gate
    GATES the reversal clause (the explicit safety promise, and the exact
    property that drifted) and REPORTS prose-shaped question/call/grounding
    sections rather than policing style: an earlier draft demanded a status
    line the file never promised and would have had nine older records
    rewritten to satisfy a regex. REMAINING: `CLAIM_INVENTORY.md` is declared
    always-derived but its generator is not a package script and no gate
    enforces the derivation.
45. **~~DR-002's mandated mechanical check was never built~~** — DONE
    2026-08-23: scripts/check-permission-enforcement.mjs extracts the
    Permission union and every authorize() call site, and fails when a
    declared scope is required by no surface. Measured: 10 of 11 enforced;
    `tenant:admin` is now a DECLARED exemption naming the private-core
    surfaces that will require it — and the gate fails if that exemption
    outlives its reason (a permission that becomes enforced must lose its
    entry). Self-tested with union/call-site floors. Registered preflight +
    CI.
46. **Production OIDC branch of /v1 never executes in any test** —
    security-engineer, days. Only its rejections run; the middleware wiring
    that turns a bearer token into a tenant principal is unproven end to end.
47. **~~METRICS_TOKEN compared non-constant-time~~** — DONE 2026-08-23:
    the operator's real secret now goes through the same constantTimeEquals
    the core already used for its PUBLIC demo keys. The weaker guard had been
    sitting on the stronger secret.
48. **Native parity is textual, not behavioral** — mobile-native, days. The
    port-parity gate compares extracted vocabulary and says so itself; iOS is
    carved out of the shared assist-wire conformance vectors; ios-ci does not
    trigger on simulator/workflow library changes; BackendService still calls
    five endpoints that exist nowhere.
49. **Assessor-facing overstatement** — compliance-analyst, hours. The
    security questionnaire pack tells assessors docs-sanity fails the build
    on ISO 27001 / HIPAA certification claims; it does not. Also:
    SECURITY_CONTROLS_MATRIX's status column has no drift gate.
50. **Operability claims without live evidence** — sre, days. The SLO surface
    has never consumed a real decision outcome (its only non-proof caller is
    an all-healthy fixture); nine CI jobs remain unbounded, two of them
    PR-gating; the daily mutation sweep — the repo's only falsifiability
    measurement — has no liveness evidence and is absent from the routine
    registry.
51. **`lib/location` remains an undispositioned orphan** — principal-engineer
    + devex, days. `Date.now()` in signal-admission logic, zero importers,
    outside the determinism gate's scan prefixes while CLAUDE.md asserts the
    rule repo-wide.

The thirty-one seats the limit cut short re-run on the next sweep; their
absence is stated rather than counted as clean.

## Owner hands

Only the items genuinely yours:

1. ~~**Ratify launch-profile v4.**~~ **RESOLVED — DR-005 ratified v4 in full.** Every classification is still marked "proposal". Scope is your call, and any positioning published against an unratified scope can be invalidated overnight. One sitting.
2. ~~**Approve or reject the ledger-truncation article, and pick the venue**~~ **RESOLVED — DR-005: approved after the role-split correction; venue is the signalgrid.app blog.** (company blog to be built, personal blog, or third-party outlet). Nothing publishes without this.
3. ~~**Decide the deny-color contrast question.**~~ **RESOLVED — DR-005: re-toned to #C67070/#8A3F3F, applied.** The deny state fails the accessibility contrast bar (3.18:1 where 4.5:1 is required) on its most safety-critical surface. Three options come to you on one screen: re-tone, constrain usage, or decline explicitly. Open since 2026-08-19.
4. **Decide signing-key custody** — DECIDED 2026-08-21, same day: the owner ratified the keyless recommendation ('I will go with recommendation on key custody model') → DR-009, and the signing stage landed in supply-chain.yml (cosign v3.1.3 sha256-pinned, push events only, Rekor-logged).
5. **Supply four billing numbers** — PARTIALLY ANSWERED 2026-08-21: the owner supplied the Claude, ChatGPT, and domain figures directly (a fifth line item, ChatGPT, that the original list did not have — it pays for the cross-lane reviewer). The VALUES are deliberately not republished here: this repository is public and the owner-only rule these documents state applies to the repository too, not only to estimation. They live in the owner's private record and in the session that received them; the cost-model work (backlog row 22) must define the owner-private channel that carries them into computation without ever committing them. CLOSED 2026-08-22 (decision session): Apple — not enrolled, $0 today, enrollment scheduled by the device-path milestone; GitHub — free plan, all seven repos public, CI $0 across the estate. All five billing facts now answered.
5. ~~**Ratify or amend DR-010 (OpenBao secret boundary)**~~ **RATIFIED
   2026-08-22 (decision session)** — write authority live, unseal custody
   with the owner, deployment queued on engine availability.
6. ~~**Sign up for a ServiceNow developer instance and/or Jira free tier**~~ **RESOLVED BY REDIRECT 2026-08-22 (DR-012)** — no vendor signups on the critical path; GLPI becomes the ITSM lab when an engine is available, and vendor wires arrive when a prospect's stack names one.
6. **Start the Intune/Entra trial when ready.** The launch-tier Graph connector — the one family whose transport points at Microsoft's production wire — has never been driven live; zero of three launch families have.

## This week

Chosen for leverage per unit of effort, in execution order:

1. **Close the two grant wedges** (backlog 1–2, hours each). Two executed counterexamples where "unknown" earns the word "trusted" plus a grant, in the product whose entire promise is that unknown tightens the answer.
2. **Fix the restore path and start the role split** (backlog 4 then 3). The restore fix is hours and without it the days-scale hardening dissolves on first use.
3. **Fix the four gates that cannot fail** (backlog 10, hours). Cheapest possible restoration of trust in what green means, across three lenses at once.
4. **Land POSITIONING.md and rewrite the site copy** (backlog 7 and the copy half of 6, hours). Stops the public over-claim and unblocks design-partner outreach in one afternoon; the launch-claims gate follows.
5. **Start the evaluate-chain audit** (backlog 8, days — start now, finish next week). The maximum-cost unread code in the estate, and its defects replicate byte-for-byte into the iOS port.

## Division state summaries

**Engineering.** Strong core, drifting edges — and the edges are the security-heavy part. The tenant-facing decision core is genuinely fail-closed and the newer connector discipline (brute-force enumeration plus mutation testing) is the best thing in the repo, but it covers only 32 of 46 evaluators, and all three grant defects found this sweep live in the uncovered 14. The API server is solid with an under-documented spec; the gate estate is unusually self-aware but has four gates that lie in at least one direction; persistence hardening was queued on a false premise (no grant exists to revoke) and needs real design work. The most uncomfortable number: the code that computes every verdict has never been read by a named reviewer, while the marketing site's frontend is the best-covered area in the repo. Coverage is inverted relative to risk, and the "6.3% reviewed" headline is really 1.3% once directory-prefix claims are unwound.

**Signal domain.** Ten of 51 signal dimensions have ever touched a real wire, and all ten checks found a real divergence between what the fixtures assumed and what the wire says — a 100% hit rate that converts "the other 35 are probably fine" into "the other 35 certainly are not." The verification work that exists is honest and well-recorded, but three of five live records are bound to nothing in the code they corrected, network's live coverage is entirely one-shot and will rot on the next type edit, and the highest-decision-weight domain (ITSM/workforce — 28 references, seven shipped vendor adapters) has never been driven at all and is the only domain the zero-cost test matrix skipped. The launch wedge itself — the three families actually shipping — is at zero live runs against production wires, gated on your Intune trial.

**Company.** The docs corpus is honest wherever a gate reaches it and fossilizing everywhere else: the entry-point CI doc describes a 5-proof pipeline that is now 94 commands, the recommended first read is 85 commits stale, the proof audit silently covers 21% of the estate it appears to map, and the whole thing is written in a private idiom with no glossary. Finance does not exist as a discipline yet: public prices with no cost side, a launch budget framed for a human team the company does not employ, one paid dependency expiring in 27 days with its necessity undecided, and an agent org that has completed ~97 shifts without a single cost figure attached to any of them. None of this is dishonest — it is unaccounted, which is the precursor.

**Go-to-market.** The raw material is better than most funded startups have — every load-bearing claim is enforced by a gate rather than asserted — and none of it is usable yet. Five surfaces describe five different products; the public site presents deferred capability in the present tense; the internal shorthand ("signal- and location-driven") itself over-claims at launch because location is deferred; the one differentiating concept, the Assist gate, appears nowhere a buyer looks. The proof-led-content role, chartered as the differentiator competitors cannot cheaply copy, has never run. This sweep closes some of the gap by drafting the positioning and the first article, but both are staged work products awaiting your two decisions (ratify scope, approve publication), and the copy gate must land before the next edit re-breaks the site.

## Drafts produced by this sweep

Preserved verbatim, as required.

### From the signal-dimensions-vs-wire-truth lens

# Signal-dimension wire-truth coverage — measured 2026-08-20

Tier definitions: **live** = a real server/wire was driven against the dimension's shapes (repeatable proof lane, or a one-shot shape-check record); **doc-tier** = verified against primary vendor docs or an OSS reference implementation (✅/◐ rows in docs/API_SIGNAL_DISCOVERY.md), no wire driven; **fixtures-only** = everything else.

| Division | Dims | Live | Doc-tier | Fixtures-only |
| --- | --- | --- | --- | --- |
| endpoint-uem | 9 | **2** — macos-posture (Mac lane, artifacts/live-evidence/mac-run.json); device-management-health (Fleet 4.89.2 via the DeviceManagementEvidence contract — proof:live-fleet-workflow — plus Headwind CE 5.30.3 shape-check; **not** via its Graph transport, which does not exist — launch-profile.mjs:169-172) | **1** — graph (✅ in API_SIGNAL_DISCOVERY; live transport addresses graph.microsoft.com but has never been driven; the Graph smoke test is a runbook, not a run) | **6** — uem, app-update, policy-binding, data-protection, peripheral-control, service-lifecycle |
| iam | 15 | **2** — token-binding (proof:live-idp 31/31 + proof:live-keycloak 14/14, RFC 7638 cross-implementation DPoP agreement); sso-session (IDENTITY_LIVE_SHAPE_CHECK, Keycloak 26.4) | **3** — oauth-consent, access-governance, identity-risk (Okta/Graph ✅ rows, API_SIGNAL_DISCOVERY.md:147-158) | **10** — platform-sso, passkey-assurance, entitlement-binding, credential-rotation, credential-exposure, bootstrap-credential, break-glass, local-authority (launch-tier), challenge-capability, device-attestation |
| network | 6 | **3** — network-nac (FreeRADIUS, RADIUS_NAC_LIVE_SHAPE_CHECK); link-usability + sse-egress (real intercepting proxy, NETWORK_EGRESS_LIVE_SHAPE_CHECK). All three are one-shot records; no repeatable lane exists in verify:live | **0** | **3** — nac (cisco-ise.ts / aruba-clearpass.ts never driven), carrier, webhooks |
| itsm-ops | 6 | **1** — telemetry (Fleet + real osqueryd, proof:live-fleet 30 assertions + live-fleet-workflow end-to-end verdict) | **0** | **5** — itsm (7 vendor adapters never driven), change-window, shift-context, task-exception, session-readiness |
| physical-ot | 5 | **1** — location-services (Traccar 6.14.5, proof:live-location 22 assertions) | **1** — pacs-access (UniFi/Verkada/ControlID ✅, API_SIGNAL_DISCOVERY.md:40-114) | **3** — rtls-custody, custody-beacon, ot-posture |
| secops | 10 | **1** — edr-threat (Wazuh 4.9.0, proof:live-edr) | **1** — siem (adapters written to vendor docs; sentinel.ts flagged as targeting the deprecated Data Collector API) | **8** — syslog, vuln-scan, benchmark-selection, caep-events, observability-integrity, response-accountability, agent-behavior, agent-identity |
| **Total** | **51** | **10 (19.6%)** — 5 repeatable, 5 one-shot | **~6 (11.8%)** | **35 (68.6%)** |

Every live check so far found a real fixture-vs-wire divergence (Fleet 404s; Traccar geofenceIds:null ambiguity; no quarantine on the RADIUS wire; no amr from Keycloak; dns_failing unobservable behind a proxy; Headwind NPE + string-not-array fields). Assume the 35 fixtures-only dimensions hide the same class of defect until checked.

## Decision weight of the unverified (measured)

Boundary-exact grep of each dimension's kebab id + SIGNAL_KINDS token across lib/{flows,app-workflows,signalgrid-simulator,room-sim,handoff-sim,posture-composition,signalgrid-core}/src. Top unverified dimensions: shift-context **19**, itsm **11**, task-exception **11**, access-governance **11**, benchmark-selection **10**, break-glass 7, device-attestation 6, change-window 6.

## The three next shifts

1. **itsm** (change-window + task-exception ride the same lab) — combined 28 references; seven shipped vendor adapters never driven (the Fleet-404 precondition); ITSM/WFM is the only domain with no section in ZERO_COST_LIVE_TEST_MATRIX.md. Lab: OSS ITSM in Docker driving generic-webhook live + doc-tier field-check of servicenow.ts/jira.ts; owner PDI signup later unlocks the vendor adapters themselves.
2. **shift-context** — the highest single unverified weight (19) and a day-one-quiet evidence axis (unverified still grades allow: EVIDENCE_COVERAGE.md:31-36, seed.ts day-one-quiet pins) — the exact combination where a wire surprise becomes an unearned allow. Lab candidate: an OSS workforce system with a real shift-assignment API (verify candidate surface before relying).
3. **access-governance** — 11 references at near-zero marginal cost: the Keycloak 26.4 lab, client setup, and proof pattern already exist in-repo; drive role/group/composite-role and effective-access reads over the admin REST API. Closes one of iam-domain's self-declared ten unverified dimensions.

Runner-up: **benchmark-selection** (10 references, day-one-quiet 'unverified → allow' pinned at seed.ts:469) via OpenSCAP evaluating a real CIS profile — cheap and CI-able, queued behind the three above.

### From the positioning-messaging lens

## SignalGrid — buyer-legible positioning (Limited GA scope, launch-profile v4)

Every claim below is checked against the `launch` class in scripts/launch-profile.mjs. Nothing deferred appears — which is why location, badges, custody, network, and threat signals are absent: they are real and proven in this repository, and they are not Limited GA.

### 1. The one sentence

SignalGrid is a decision gate built invisibly into the apps your staff already use: before a sensitive action on a shared device it answers allow, step up, restrict, or deny — from the device's compliance, how current that compliance answer really is, and whether the device can vouch for itself right now — and anything it can't verify tightens the answer instead of waving it through.

### 2. The 100-word version

SignalGrid is an access-decision service embedded invisibly in the apps your staff already use on shared frontline devices. Before a sensitive action, the host app asks and gets one answer — allow, step_up, restrict, or deny — computed from three signals: device compliance, read-only from your device-management source (Microsoft Entra/Intune is the first enterprise connector); whether that compliance answer is still current; and whether the device may act on its own authority right now. Every verdict carries reproducible evidence an operator can audit. Missing or stale signals tighten the decision, never loosen it. Your app applies the verdict, including the step-up prompt.

### 3. The boundary paragraph — what SignalGrid is NOT

SignalGrid is not an MDM: it never enrolls, configures, locks, or wipes a device, and it cannot enforce anything on the device itself — no app can restrict other apps or make itself non-removable; enforcement on the device is your MDM's job on a supervised device, and Fleet, Intune, or Jamf remain your management plane. SignalGrid reads their evidence, read-only. It is not an IdP: it does not authenticate users, hold identities, or run MFA — when it returns step_up, your app satisfies it with your existing authenticator and identity provider; at Limited GA SignalGrid conducts no challenge itself. It is not an EDR or a SIEM: it detects nothing and investigates nothing. It sits downstream of systems like these and consumes their evidence rather than replacing them — and at Limited GA it consumes exactly one source: your device-management evidence. Domain safety — patient lookup, clinical rules — stays in the host application; SignalGrid answers only whether this device, in its current state, should proceed.

### Claim-to-proof trace

| Claim | Grounding |
|---|---|
| "invisibly into the apps your staff already use" | docs/EMBEDDED_UX_PRINCIPLE.md:1-32 (design law); ios:EnterpriseShell is launch as the reference host app (launch-profile.mjs:453-458) |
| "allow, step up, restrict, deny" | lib/signalgrid-core/src/types.ts:374; lib/api-spec/v1-openapi.yaml:243; /v1/decisions/evaluate is launch (launch-profile.mjs:308-310) |
| "device's compliance" | signal kind device_posture, launch (launch-profile.mjs:240-243); graph family launch (:151-160) |
| "how current that answer really is" | signal kind device_management_health, launch (:245-247); family reason: a stale 'compliant' is "the unearned affirmative in its purest form" (:162-168) |
| "vouch for itself right now" | signal kind local_authority, launch (:249-251); family launch (:175-181) |
| "tightens instead of waving through" / "never loosen" | lib/posture-composition/src/adapters.ts:543; enforced structurally by scripts/review-invariants.mjs:144-176, run in preflight (preflight.mjs:67) |
| "reproducible evidence an operator can audit" | /v1/decisions/{id}/evidence launch (:317-321, "it is the claim"); operator console signalgrid-app launch (:444-451) |
| "read-only from your device-management source" | criterion string (launch-profile.mjs:126-129); no write route to any source system (:362-367) |
| "your app applies the verdict, including the step-up prompt" | GAPS step-up-answerability (:633-646): Limited GA is shadow mode — SignalGrid returns step_up, /v1/step-up/* is deferred; the host app's native authenticator answers it (EMBEDDED_UX_PRINCIPLE.md:34-37) |
| Deliberately omitted: location | 'location' and 'location_certainty' are deferred signal kinds (launch-profile.mjs:274-275) — say it in the roadmap, never in the present tense |

### From the proof-led content lens

# A hash-chained audit log can't see its own tail

Hash chaining is the standard prescription for tamper-evident audit logs. Each record stores a hash over its own contents plus the hash of the record before it; change anything, anywhere, and every link downstream stops recomputing. It is cheap, it needs no special infrastructure, and nearly every tutorial on the pattern stops there — leaving an implication hanging that turns out to be false. A hash chain detects edits. It cannot detect deletion from the end. And the end of the log is exactly where the records an attacker cares about live.

We measured this rather than reasoned about it. The lab was PostgreSQL 16 in a container, an audit ledger writing through its real Postgres backend, and a chain verifier that walks the table in batches and exits non-zero on any break. Three runs:

| Table state | Verifier says | Exit code |
| --- | --- | --- |
| 40 records, untouched | `Chain intact` (40 records) | 0 |
| `actor.id` rewritten on record 17, stored hash left alone | `CHAIN BROKEN at record index 16`, with expected and actual hashes | 1 |
| 40 records, then `DELETE … WHERE seq > 30` | `Chain intact` (30 records) | 0 |

The middle row is the pattern working exactly as advertised: one field edited, the break localised to the exact index, non-zero exit. The last row is ten audit records removed with one ordinary `DELETE` — and the tamper-evidence tool reporting a clean chain.

The reason is structural, not a bug. A hash chain proves that every surviving record is consistent with the one before it. Truncate the suffix and every surviving link still recomputes; what remains is a shorter chain that is perfectly valid. Nothing inside the chain knows how long the chain is supposed to be. Only something outside it can know that.

Threat-model it for a second and it gets worse. The attacker most worth designing against is someone who just did a thing and wants the trace gone. Their records are the newest ones — the tail. The one operation the chain is blind to is the one that most precisely serves the person the chain was built against.

While pinning this down we found a second, quieter instance of the same defect class in the same tool. The verifier already refused to run without a database URL, on grounds we would stand by anywhere: a verifier that can green-light the void is worse than none. But on an empty table it printed "The ledger is EMPTY. Nothing to verify is not the same as verified history" — and exited 0. A human reads the sentence. A cron job, a monitoring probe and a CI step read the exit code, and to all three, a wiped ledger was indistinguishable from a verified one.

What actually closes the gap is a record count asserted from outside the chain:

- **An operator-asserted floor.** Our verifier now takes `--min-records N` and fails hard below it: 30 records against `--min-records 40` exits 1 with `TOO FEW RECORDS: 30 < 40`; an empty ledger against `--min-records 1` exits 1; 30 against 30 stays green, so it does not cry wolf. It is a flag rather than an unconditional check because a first-run deployment has a legitimately empty ledger, and a check that cries wolf on day one is a check somebody switches off by day three.
- **Revoking DELETE.** Our application's database role held `DELETE` on the ledger table, and nothing needed it. Revoking it converts truncation from a detection problem into a permissions problem, which is strictly better.
- **External anchoring or WORM storage.** Periodically record the count and head hash somewhere the database credentials cannot reach. Backup manifests are a free version of this: ours already record counts, so a restore that comes back shorter than its manifest is catchable — if something compares.

One more move worth stealing. We pinned the limitation into the test suite as a *passing* assertion: the proof seeds twelve records, deletes down to eight, and asserts that verification still returns ok. That reads backwards until you consider the alternative, which is rediscovering the limit during an incident. The day someone adds an external anchor or a monotonic counter, that assertion fails, and the doctrine gets updated on purpose instead of drifting. Both new assertions were confirmed to fail when the deletion step is removed — a test that cannot fail proves nothing.

Reproducing this on your own ledger takes five minutes: delete the last N rows with plain SQL, run your integrity verifier, and read the exit code, not the prose. If it says 0, your tamper evidence has the same hole ours did — and now you know which of the three fixes fits your deployment.

---

*This came out of hardening the audit ledger behind SignalGrid, a fail-closed assist gate for shared frontline devices; the full lab notes are public in our review repository.*

---
[EDITORIAL NOTE — not for publication. Pick rationale: of the four candidates, this one has the widest practitioner audience because hash-chained audit logs are built independently by generalist backend, security, and compliance engineers in every stack — no NAC appliance, SSE proxy, or Keycloak context required to care. It corrects a widely taught pattern rather than documenting a vendor quirk, its reproduction is plain SQL, and every figure traces to docs/LEDGER_TRUNCATION_FINDING.md. 831 words. PUBLISHES NOWHERE without the owner's explicit approval.]

### From the finance + agent-ops economics lens

COST MODEL SKELETON (draft for docs/COST_MODEL.md — every figure below is repo-verified unless marked TBD/ASSUMED)

1. SERVING ONE TENANT — deferred architecture (docker-compose.prod.yml)
   Stack: 1x postgres:16 (durable volume sg_pgdata) + 1x node:22 api container (2.2MB bundle, /api/healthz liveness). Web is a static build behind nginx (dev compose only; no gate builds it). NO Redis in the product — Redis appears only inside Fleet's own stack.
   Capacity: limiter-bound, not compute-bound. Default 240 req/min per key (rateLimit.ts:56, SIGNALGRID_V1_RATE_LIMIT); decision core p95 1.27ms, 5,128 decisions/sec on 4 workers (RELIABILITY_SLO.md). One small VM (2 vCPU / 4GB class) over-serves a tenant by orders of magnitude; marginal compute per added tenant ~= $0 until the limiter is deliberately raised.
   Line items: VM hosting — TBD (public price list, agent-computable). Backup storage for sg_pgdata — TBD. TLS/domain — optional (OWNER_ACTIONS.md:197).

2. MDM / DEVICE LINES (per deployment)
   Fleet self-hosted: mysql:8 + redis:6.2 + fleet server (MIT, license $0) = a second small VM — hosting TBD.
   Fleet Premium: OPEN — team-scoped getPolicies() branch needs Premium; trial expires 2026-09-16; per-device price TBD (public page, agent-computable). This is the one identified paid software dependency.
   APNs + Apple Business Manager: owner enrollment; Apple Developer Program fee ASSUMED ~$99/yr — confirm (ownerHands).
   Supervised devices: hardware is customer-side; no hardware for sale (Pricing.tsx FAQ).

3. COMPANY RUN-RATE
   CI: $0 while this repo is public. Exposure if private: ios-ci up to 135 macOS-min/trigger at 10x multiplier; desktop windows matrix 2x; mac-lane 60 macOS-min weekly; scheduled-verification 45 ubuntu-min daily; observed volume 576 commits/month. First real bill the day visibility changes or a private sibling repo replicates these lanes.
   Agent org: Claude subscription/API spend — ownerHands, the only missing numerator.

4. COST-PER-SHIFT (agent-ops metric, computable today except dollars)
   shift := one bounded engagement, outcome = a committed ledger row (VIRTUAL_TEAM.md:30-32; 97 rows to date).
   Denominators from committed artifacts, no new tooling: Claude-authored commits per shift (377 since 2026-07-20 vs ~178 owner, via git log ranges between ledger-row commits); verification wall-clock per shift from sim-results durationMs (e.g. 'everything' = 108.3s, live-lanes = 68.7s) and build-loop/history.jsonl timestamps.
   Definition once owner supplies spend: cost-per-shift = (monthly agent spend) / (ledger rows closed that month), reported alongside commits/shift so efficiency drift is visible.
   Rule: publish denominators now; never publish an invented dollar — a fabricated cost figure is this lens's version of the unearned green.

### From the review-coverage strategy lens

TIERED READ-LIST — SignalGrid-Review-Hub (all listed files verified UNREAD against docs/agent/review-coverage.json as of 2026-08-20; line counts from wc -l)

== TIER 1 — 25 files, ~7,900 lines. An unread defect here costs the most. Target: 25/25 at depth >= audited within 5 shift-days. ==

Decision core (the verdict mechanism):
1. lib/signalgrid-core/src/engine.ts (560) — SignalGridCore itself; every /v1 decision flows through it via api-server lib/core.ts.
2. lib/signalgrid-core/src/decision.ts (216) — where allow/step_up/restrict/deny is actually computed.
3. lib/signalgrid-core/src/policy.ts (764) — policy resolution feeding the verdict; the largest logic file in the core.
4. lib/signalgrid-core/src/resolution.ts (522) — signal-to-assurance resolution; the file where 'unknown raises assurance, never lowers it' must hold.
5. lib/signalgrid-core/src/evidence.ts (340) — mints the WHY behind /v1/decisions/{id}/evidence; the product's entire claim is that its answers are explainable.
6. lib/signalgrid-core/src/store.ts (420) — in-memory store semantics behind every tenant-scoped read; a cross-tenant leak would live here.
7. lib/signalgrid-simulator/src/decisionEngine.ts (313) — parity source the iOS port is byte-faithful to; a defect here ships on two platforms at once.
8. lib/posture-composition/src/compose.ts (57) — composes signal kinds into posture; tiny, but every launch signal passes through it.
9. lib/posture-composition/src/adapters.ts (591) — maps connector output into composition; a silent mis-map fails open.

Auth chain (bearer token to tenant principal):
10. artifacts/api-server/src/middlewares/context.ts (172) — THE /v1 auth middleware; OIDC/demo-key fork; unread while neighbor rateLimit.ts was audited.
11. lib/enterprise-auth/src/jwt.ts (178) — token verification.
12. lib/enterprise-auth/src/claims.ts (99) — claims-to-principal mapping; tenant derivation lives here.
13. lib/enterprise-auth/src/jwks.ts (46) — key fetch/cache; wrong caching means accepting rotated-out keys.
14. artifacts/api-server/src/lib/profile.ts (162) — the review-demo vs shared-device-gateway fence; a classification bug mounts demo surfaces in production.
15. artifacts/api-server/src/lib/core.ts (55) — the seam where HTTP hands to the decision core.
16. artifacts/api-server/src/middlewares/idempotency.ts (109) — durable-write dedupe on the decision path.

Served surface and durable path:
17. artifacts/api-server/src/routes/v1.ts (923) — every served /v1 route including evaluate and the release-path re-evaluation; the spec was audited, the implementation was not.
18. lib/audit/src/backend.ts (185) — the Postgres ledger WRITE path; the audited verify path is provably blind to tail truncation, so append guarantees live only here.
19. lib/persistence/src/decision-store.ts (174) — durable decision writes.
20. lib/persistence/src/session-store.ts (228) — durable session writes and tenant scoping.

Meta-gates (what green means) and launch connectors:
21. scripts/preflight.mjs (377) — the per-push lane CI mirrors; a gate mis-registered here disappears quietly.
22. scripts/launch-profile.mjs (666) — the 174-item classification every launch claim trusts; audit each 'launch' reason against source.
23. scripts/check-guard-registries.mjs (186) — the registry-drift detector; a hole here makes gaps silent by construction.
24. lib/integrations/src/integrations/local-authority/evaluate.ts (190) — launch family; device-reported authority, the frontline half of the product.
25. lib/integrations/src/integrations/device-management-health/evaluate.ts (290) — launch family; grades whether a compliance answer is CURRENT — the anti-unearned-affirmative connector, which had better not contain one.

== TIER 2 — ~50 files, weeks 2-3 at the same shift cadence ==
Rest of signalgrid-core: continuity.ts (409), seed.ts (1065), types.ts (840), connector.ts (218), remediation.ts (189), webhooks.ts (78), dock.ts (137), shift.ts (99), audit.ts (93), util.ts (129), metrics.ts (55), simulate.ts (35).
Rest of simulator: routing.ts (211), scenarios.ts (186), types.ts (173), audit.ts (27).
Rest of api-server: app.ts (123), routes/control-plane.ts (524), routes/integrations.ts (2042 — the largest unread file in artifacts), routes/monitoring.ts, health.ts, sim.ts, simulator.ts, radar.ts; middlewares/errors.ts (104 — error envelope, a leak and fail-open vector), deprecation.ts, metrics.ts; lib/assurance.ts, tier.ts, logger.ts, metrics.ts.
Auth/step-up periphery: lib/enterprise-auth/src/config.ts, provider.ts, base64url.ts; lib/webauthn/src/stepUpStore.ts (283) + webauthn/; lib/verdict-attestation/src/attest.ts (263), canonical.ts, types.ts; lib/dual-control/src/evaluate.ts, normalize.ts, types.ts; lib/persistence/src/migrations.ts (136); lib/audit/src/types.ts.
Launch connector remainder: graph/posture-connector.ts (254), graph/types.ts, graph/mock-transport.ts; device-management-health/graph-transport.ts (199, the Blocker-5 gap), device-management-health-connector.ts; local-authority/normalize.ts (154).
Native seam: SignalContext.swift (135), DemoMode.swift (291), plus read-verify of DecisionEngine.swift (190) and AppWorkflows.swift (332) against their TS sources.
Meta-gate remainder: check-launch-profile.mjs (327), check-preflight-ci-parity.mjs (190), check-publication-boundary.mjs (232), check-decision-port-parity.mjs (298), check-connector-discipline.mjs; validate-sim-macos.sh; .githooks/pre-push; threat_model.md.

== TIER 3 — everything else, SAMPLED, standing one shift per week ==
47 deferred connector families: read types.ts + evaluate.ts only, two families per week, prioritized by proximity to recent audit findings (identity-risk, token-binding, caep-events, break-glass first — they border the Keycloak work). tests/ (12 files): read all in one sitting, they are small and gate meaning depends on them. native/ios remainder (~135 files), docs (263), .claude (64), config/docker/firmware: 10% risk-weighted samples. Promotion rule: any sampled file yielding a finding promotes its whole directory to Tier 2.

== CADENCE — Tier 1 to 100% within one week ==
Five shifts, one per day, each ending with FILE-level ledger entries (never directory prefixes) at depth 'audited' with a note naming what was checked:
- Shift 1 (principal-engineer): files 1-4 — the verdict mechanism as one unit (~2,060 lines).
- Shift 2 (principal-engineer): files 5-9 — evidence, store, composition, parity source (~1,720 lines).
- Shift 3 (security-engineer): files 10-16 — the auth chain end to end (~820 lines), audited against the tenant-derivation claim the OpenAPI audit flagged.
- Shift 4 (data-persistence-engineer): files 17-20 — the durable path (~1,510 lines), backend.ts checked against the known tail-truncation blindness.
- Shift 5 (devex-tooling-engineer): files 21-25 — meta-gates plus launch evaluates (~1,710 lines), each gate verified to read the surface it claims to gate.
Tracking: docs/agent/review-tiers.json committed alongside, and check-review-coverage.mjs (or a companion) prints 'Tier 1: N/25' every run so the number cannot hide. Tier 2 follows at the same cadence (~5 more shifts, weeks 2-3); Tier 3 sampling runs as a standing weekly shift thereafter.