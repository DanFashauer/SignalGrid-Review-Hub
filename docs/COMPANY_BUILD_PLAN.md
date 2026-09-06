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

29. **Assurance-pass advisories, batch one (2026-08-21)** — devex-tooling-engineer + brand-design + mobile-native-engineer, hours each. The org's first self-review confirmed 20 findings (all remediated in PR #231) and filed 14 advisories; the unapplied ones, each needing its executed check when picked up: a bash-3.2 compatibility gate (shellcheck is version-blind, so 4.x-isms pass the lint that exists because of a 3.2 failure); a Darwin guard for scripts/mac/*; pinning the "42 shared conformance vectors" figure and the step-up chip's 4.58:1 margin; a reachability assertion for declared-gap closedWhen dir-conditions (the evaluator must be able to read at least one file the condition names); the ECOSYSTEM §2.1 worker copy aligned to descriptor language; and the real one to watch — the iOS host app renders a near-divergent reason-code vocabulary from the catalog's, which is the catalog's next consumer to reconcile. (Gate-estate + design lenses.)

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
    1299-component SBOM (the SBOM of 2026-08-22 — the artifact recorded no digest of its input, so the figure is that day's and `check-licence-policy` reports today's) — 19 findings each, identical severity histograms,
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
    HALF DONE 2026-08-23: the PUBLISHED half is fixed and now gated; the prose
    docs are not. Auditing the three named documents found the more serious
    defect one layer down, in the gate meant to police exactly this. Rule 3 of
    `check-launch-claims.mjs` required a hedge somewhere in the FILE, so
    `docs/pitch-deck.html` — deployed to signalgrid.app by pages.yml — sold
    "badge / who + device custody & tamper + security baseline + workflow risk
    -> one verdict" on its How-it-works slide, with a card titled "Custody as a
    decision input", and passed green because slide 1 said "Pre-production
    concept" fifty-four lines earlier. Blanket immunity, bought with one word,
    and the deck's own UNDERstatement was what licensed its OVERstatements.
    Rule 3 is now block-scoped (same <section>, same paragraph), which surfaced
    12 live violations across 5 buyer-facing files that had all been green.
    Nine were real and the copy was rewritten: the deck's label, stage line,
    how-it-works slide, step-up claim and roadmap, and six battlecard sites
    including a moat pillar selling deferred custody as a current
    differentiator on a card whose own masthead says "never overclaim custody
    certainty". Three were the gate punishing honest copy in idioms it had not
    been taught to read — "candidate signals, not evaluated today", a page-scope
    banner that disclaims current capability outright, and a "Trap phrases to
    avoid" list — and those taught the gate, not the copy. Falsified: 13
    self-test cases, including the distant-hedge defect itself and the
    artifact-footer near-miss that must NOT earn a page exemption.
    2026-08-23, second pass: the OUTREACH surface is now in scope too, which
    matters more than the website. `docs/outreach/` is sent to real people as
    real email under the owner's identity, increasingly without a human reading
    each one, so it is where an overclaim costs most and gets checked least.
    Both `OPERATING_RULES.md` and `TEMPLATES.md` already promised that every
    product claim traces to POSITIONING.md — in prose, which does not fail a
    build, exactly like the security-questionnaire promise that turned out to be
    unenforced for two of four frameworks (row 49). The gate now scans the
    outreach directory AND every document those files cite as a claim-trace
    target, derived rather than listed, so citing a new document pulls it in on
    the next run. It was already clean: 89 files, 0 violations. Falsified in
    both scopes — an overclaim planted in a template fails, and one planted in
    the CITED pilot package fails, which is what proves the citation
    derivation works rather than merely existing. Both documents now name the
    gate that enforces them instead of asking to be believed.
    2026-08-23, third pass — this row is now DONE for every document that can
    reach an outsider, and the archival boundary is drawn by construction
    rather than by folder name.
    A THIRD derivation was needed, because the first two still missed the
    document whose entire purpose is to be handed to a stranger:
    `EXECUTIVE_ONE_PAGER.md` sat outside every scope while opening with a
    founder's name and a public address. The rule that catches it without a
    hand-list: a document that PUBLISHES THE PUBLIC CONTACT ADDRESS is
    addressed outside this repository by construction — nobody prints the
    founder's public address for an internal reader — so it is in scope from
    the moment it carries that address, which is exactly when it can start
    doing harm. Six documents qualify today.
    A wrinkle worth recording, because the gate caught it in this very row:
    the first draft of this paragraph spelled the address out while EXPLAINING
    the rule, which pulled this internal build plan into buyer-facing scope,
    where its own historical quotes of the original "Evaluated today" defect
    immediately tripped the overclaim markers. The rule cannot distinguish a
    document that PRINTS the address from one that DISCUSSES it, and trying to
    teach it that difference would be far more fragile than simply not spelling
    the address out in commentary. Fix the copy, never the gate — the second
    time that sentence has been earned in this sweep.
    EXECUTIVE_ONE_PAGER was superseded in every section and was rewritten to
    POSITIONING.md + DR-012 + DR-013: the ratified name and descriptor, three
    launch signals from one source, the 75–1,000-employee lean-IT segment
    instead of "regardless of company size", live open-source proof (Fleet with
    real osqueryd, Keycloak, FreeRADIUS, Wazuh) instead of "the proof is
    synthetic", and the deferred families named as deferred.
    ECOSYSTEM_POSITIONING opened with two unratified labels and stated the
    Microsoft wedge DR-012 reversed; its label, wedge, first-proof section and
    proof-flow diagram are corrected, and it now carries a header saying
    POSITIONING.md is canonical and this page does not get to define the
    product.
    The two archival outreach documents that carry the public address —
    `docs/research/OUTREACH_EMAIL_TEMPLATES.md` (nine overclaiming blocks, and
    dangerous precisely because it is a TEMPLATE file someone could reach for)
    and `FIRST_CALL_TALK_TRACK.md` — now carry dated SUPERSEDED banners naming
    the live replacement. Note what earns them their exemption: the banner
    states "nothing here is a claim of current capability", which is the
    PAGE_SCOPE disclaimer the gate already understood. `docs/research/` gets no
    exemption for its name; a retired document opts out by SAYING it is
    retired. Falsified: removing the banner re-flags the file.
    Gate now at 95 files, 0 violations. Falsified in the new scope too — an
    overclaim planted in a contact-bearing document fails.
    STILL OPEN, and now genuinely low-stakes: ~18 documents with no public
    contact line and no published route still carry retired labels or the
    superseded "synthetic proof" status. They cannot reach a buyer without
    first acquiring one of the three properties the gate derives from, at which
    point it catches them. POSITIONING.md:26-27's label contract ("any document
    using a label outside these three roles is wrong and gets fixed to this
    page") remains gateable repo-wide if that is ever wanted; it is deliberately
    not done here, because a gate over 18 archival documents would be a large
    rewrite in service of a regex rather than of a reader.
40b. **Module-scope temporal-dead-zone reads — gated for the COLUMN-0 shape,
    open for the rest.** — devex-tooling-engineer. This defect shipped twice in one day, silently both
    times: `context.ts` broke enterprise OIDC entirely (a hoisted function
    called at module load read a `const` declared 21 lines below), and
    `signalgrid-grid-proof.ts` never ran its enum guard (same mechanism, ~650
    lines apart). `function` hoists; `const` does not, and under a bundler the
    read surfaces as `undefined` rather than throwing.
    `scripts/check-module-init-order.mjs` (preflight + CI) detects it,
    transitively through local calls, for a call written at COLUMN 0 — 802
    source files, 0 false positives, and reintroducing the real OIDC defect
    fails it on demand.
    **It does NOT catch the grid-proof shape**, whose call sits inside a
    TOP-LEVEL `for` loop: indented, yet still executing at module load. Widening
    to any indentation and filtering out function bodies was tried and reverted
    — bounding those bodies by text is unreliable (arrow functions assigned to
    consts, class methods, nested braces) and it produced 75 false positives on
    a tree known clean. A gate with 75 false alarms is worse than none; it
    teaches people to ignore it.
    OPEN: doing this properly needs real scope analysis via a parser (the
    TypeScript compiler API), not regex. Sized honestly at hours, not minutes.
    Recorded here rather than papered over in the gate's own header.

40c. **NaN fail-open on parsed timestamps — found SIX times in one package,
    now gated.** DONE 2026-08-23. `Date.parse("not-a-date")` is NaN and every
    comparison with NaN is false, so `if (Date.parse(x) < Date.now())` answered
    "not expired" for the one value the code could not interpret. In
    `lib/webauthn` — the authentication surface — this was live at both
    challenge-verification sites, the challenge store's read, the in-memory
    purge sweep, the step-up session read, and a TTL computation that turned an
    unparseable expiry into a session with NO expiry at all. One variant was
    explicit: `if (!Number.isNaN(exp) && exp <= Date.now())` SKIPS the check
    when the value is unreadable. It is the fail-closed doctrine exactly
    inverted — the rule the decision core enforces was never carried to auth.
    A seventh instance sat in `lib/location`'s freshness check, where an
    undateable signal read as FRESH — and the auditor later found its twin
    eleven lines below, plus one more in `lib/persistence`, for NINE fail-open
    sites in total (see the widening note below).
    All nine are fixed to treat unparseable as expired/stale.
    `scripts/check-nan-fail-open.mjs` (preflight + CI, four rules, self-tested)
    holds the line. Two measurements, each attributed to the gate version that
    produced it, because conflating them is how a figure goes stale:
    the FIRST (clock-operand-only) gate, run against the pre-fix sources,
    rediscovered all seven then-known sites at their reported line numbers,
    printing EIGHT violations — `store.ts:430` trips two rules at once, so hits
    are not sites, a distinction worth stating since the first draft of this row
    miscounted straight from the gate's own output.
    The WIDENED gate, run against the true pre-PR base, reports **13 violations
    across 10 distinct sites**: the six in `lib/webauthn`, both in
    `lib/location`, one in `lib/persistence`, and one in
    `microsoft-graph-sandbox-proof.ts` that is direction-SAFE (an unreadable
    date already fell to `stale`) but was unguarded, and now returns `unknown`
    to match the connector it models.
    Against the fixed tree: 0 violations across 1217 source files.
    Eleven regression assertions pin the webauthn fixes in
    `proof:webauthn-verify` (37 → 48). The first version of those assertions
    checked only `success === false`, which passed identically with the defect
    planted back — any rejection satisfies it. They now assert the REASON
    (`error === "Challenge expired"`), and falsification drops the proof to
    38/48 (that change's 48; 56 today). An assertion that cannot distinguish the
    fix from the bug is not coverage.
    NOT COVERED, deliberately: forward TTL arithmetic (`now.getTime() + ttl`)
    is not flagged — it never compares a parsed value against the clock and
    flagging it would fire on every correct TTL in the repo. Rule 3's window is
    20 lines and matching is lexical, not dataflow, so a parsed date that
    crosses a helper before comparison is missed.
    `lib/webauthn/src/stepUpStore.ts` remains reachable by NO test runner, so
    its fix is held by the static gate alone — which is why the gate, not a
    runtime test, was the right instrument. Verified rather than assumed: every
    function it exports (`verifyStepUpSession`, `hasValidStepUpSession`,
    `consumeStepUpSession`, `requiresStepUp`, `getRequiredChallenge`) has zero
    callers repo-wide outside the file itself. A grep for "step_up" in the
    api-server DOES hit — but those are the decision OUTCOME (`plan.mode ===
    "step_up"`), an unrelated concept that shares the name; the WebAuthn
    step-up SESSION store is a deferred family with no shipping surface.

    **A hire came out of this, per DR-016.** The gate closes the shapes it can
    express; it cannot close the LENS that was missing. Seven live fail-opens
    sat on the authentication path and no existing reviewer asked the question
    that finds them, because none of them is directional: `code-reviewer` reads
    for correctness, `security-reviewer` for auth seams and injection,
    `verdict-core-reader` walks the decision path. The code at every one of
    those seven sites was correct on its happy path.
    `fail-closed-auditor` (tier 3, read-only, `.claude/agents/`) audits one
    property estate-wide — *when this code does not know, does the answer
    tighten or loosen?* — plus the same defect on a slower clock: figures,
    cited paths and exemptions that have drifted from what they describe. It
    reports a reproduction and the SHAPE of the gate that would hold each
    finding; `gate-and-proof-engineer` builds it. Read-only was not a
    compromise: the roster gate's own rule 4 says a non-writing agent cannot
    collide, and a reviewer that also fixes starts arguing for its own patches.
    Its charter encodes what this defect cost — verify the checker against the
    thing it checks, distinguish hits from sites, and never trust an assertion
    that has not been watched failing.
    Stated rather than discovered: it holds `Bash` (a finding it cannot run is a
    suspicion), so its read-only status is BEHAVIOURAL — the roster gate derives
    write capability from `Write`/`Edit` frontmatter only and would not catch a
    shell edit. The two vendored reviewers carry the identical hole.

    **The auditor's first run paid for itself, and its first finding was against
    THIS row.** Two more sites existed that the gate could not see, and one of
    them was eleven lines below a fix in a file already being edited:
    `lib/location/src/store.ts` — `getLast` got the guard, `cleanup()` did not.
    The second was `lib/persistence/src/session-store.ts`'s lazy expiry. Both
    were invisible for one reason: every rule required the literal `Date.now()`
    as the other operand, and these compare against a local `cutoff` and a
    `nowMs` parameter. The clock does not have to be spelled out for NaN to
    invert the meaning. Rules 2 and 3 now match ANY operand — SEVEN becomes
    NINE sites — and the widened gate catches both on demand while the narrow
    one saw neither.
    The session-store one is reported honestly as LATENT, not live: `expires_at`
    is `TIMESTAMPTZ NOT NULL` in both the migration and the inline DDL and `pg`
    returns a Date, so no path on the shipped schema reaches the `String(v)`
    fallback that would produce an unparseable value. Fixed anyway — one
    comparison, and "unreachable today" is a property of the schema, not of the
    function.
    Widening cost two rounds of false positives, both instructive. The first
    reported EIGHT violations, every one correct code: the connectors and the
    core's own `util.ts` guard with a REJECTING `Number.isNaN(x) → return
    "unknown"`, which the gate only recognised as `Number.isFinite`. It now
    accepts both — while still refusing `!Number.isNaN(x) &&`, which is not a
    guard but the skip-on-unknown shape rule 1 exists for. The second was a
    proof comparing two parsed timestamps against each other, which fails CLOSED
    (NaN loses either way); both-operands-parsed is now excluded, inline and via
    variables. Seven self-test cases pin every one of those decisions.
    **The claim this row previously carried about the simulator was REFUTED.**
    `decisionEngine.ts` has no remediation guard keyed on `outcomes.size === 0`;
    that expression appears once, at line 230, inside the base-trust allow gate,
    where it TIGHTENS — allow is considered only when nothing else objected, and
    still requires affirmative identity and posture evidence. Verified by running
    the engine: an unknown-type signal and an empty scenario both return
    `record_audit` only, neither reaches allow. It was queued for the Mac lane on
    an inherited belief nobody had checked; the queue entry is withdrawn.

40c-2. **A TENTH site survived the sweep, on the auth path, and the gate could
    not see it.** FIXED 2026-08-24, found by EXTERNAL review after the in-repo
    reviewer passed the same change.
    `lib/webauthn/src/webauthn/server.ts` `verifyStepUp` compared
    `new Date(session.expiresAt) < new Date()`. An Invalid Date coerces to NaN in
    a relational compare, the test is false, control falls through, and the
    step-up session RETURNS AS VALID. Same family as the other nine, in the same
    file the sweep declared finished.
    **Two mistakes let it through, and the second is the instructive one.**
    First, `PARSE_EXPR` recognised only `Date.parse(...)` and `.getTime()`, so a
    bare `new Date(x)` beside `<` matched nothing and the scan reported zero.
    Second — and worse — the gate carried a deliberate exemption for comparisons
    with a parse expression on BOTH sides, written on the reasoning that "NaN
    makes the comparison false either way, so no permissive branch is taken".
    **That reasoning is wrong.** Whether `false` is safe depends entirely on
    which branch REJECTS. In an assertion, false fails the test — safe. In
    `verifyStepUp`, false returns the session — a fail-open. The exemption
    codified the false belief and hid the defect from the gate written to catch
    it.
    Both fixed: `PARSE_EXPR` now covers bare `new Date(...)` in relational
    position, and the both-parsed exemption is gone in its inline and
    variable-tracking forms. The escaped shape is pinned in the self-test in both
    directions, and the FIRST attempt at the widening was caught by that
    self-test refusing to go green — the exemption still swallowed it.
    Removing the exemption surfaced one further site,
    `artifacts/api-server/test/api.test.mjs:1508`, where the direction happens to
    be safe (a false comparison fails the assertion). It was fixed rather than
    re-exempted: relying on which branch is permissive is the reasoning that
    shipped this defect. `test:api` 301/301, gate 0 violations across 1218 files.
    NOT VERIFIED: whether any equivalent shape exists in the Swift ports; the
    port-parity gate covers decision rules, not expiry arithmetic.

40d. **The fail-closed backstop let a STALE posture answer through — the two
    freshness ladders disagreed about the same word.** DONE 2026-08-23, found by
    `fail-closed-auditor` on its first run.
    `deriveCriticalSignalsPresent` rejected `postureFreshness` of `missing`,
    `unknown` and `expired`, but NOT `stale` — while the dock ladder eleven lines
    below rejected `stale` explicitly. Reproduced directly against the real
    function: `postureFreshness: "stale"` returned `true`,
    `dockEvidenceFreshness: "stale"` returned `false`.
    Shipped v1's `posture-stale` rule masks it, which is exactly why it survived
    — and exactly why it mattered. This file's own comment says the backstop "is
    the layer that is supposed to hold when the rules do not", and for a custom
    rule set that does not gate on freshness, it was not holding: a compliance
    answer of unknown age could reach `allow`.
    **The proof had the same asymmetry, which is why the then-221 green
    assertions never caught it**: the dock ladder was swept across all five
    `Freshness` values, and posture got a single hand-written `"expired"` case.
    The one value that mattered was the one nobody wrote down. A partial sweep is
    not coverage; it is a sample that looks like coverage.
    Both ladders now sweep the WHOLE union, from `FRESHNESS_VALUES` derived from
    the exhaustive `Record<Freshness, number>` severity map rather than listed
    again — add a member to the union and it fails to COMPILE until someone says
    what it means. Expectations are declared per ladder as
    `Record<Freshness, boolean>`, so the one place they legitimately differ
    (`missing`: no dock hardware is a deployment shape, a missing posture answer
    is the absence of the thing being asked about) is written down instead of
    left implicit in two chains of `!==`.
    The core proof ran 225 assertions at the time of that change (239 today; the
    figure guard holds every doc to the derived value). Falsified by exit code, not by eye:
    removing the one-line fix drops the proof to exit 1; restoring it, exit 0.
    Four documents cited the superseded figure. A plain grep found only one of
    them — the others read "invariant assertions" rather than "assertions" — and
    the figure guard caught every one. The gate was stricter than the search,
    which is the entire argument for having it.

40e. **The simulator's PASS verdict was the conjunction of two things that could
    not fail.** DONE 2026-08-23, found by `fail-closed-auditor`.
    `runScenario` computed `expectedOutcomes.every(...) && auditEvidence.length
    > 0`. Both halves verified by reading the artifacts, not inferred:
    `[].every()` is vacuously TRUE, so a scenario declaring no expectations
    passed while asserting nothing — it could emit `restrict`,
    `alert_operator` and `create_ticket` and still report PASS. And
    `createAuditEvidence` returns an unconditional two-element array literal,
    so `length > 0` has no input for which it is false. It read as a safety
    check and was a constant.
    Both halves are now falsifiable: expectations must EXIST (a scenario that
    asserts nothing is a FAIL, because there is nothing it could have got
    wrong), and the evidence must actually COVER what was routed — every routed
    action id must appear in the routing trace's references, which diverges the
    moment routing and evidence disagree.
    Falsified in both directions: a scenario with `expectedOutcomes: []` now
    reports FAIL where it reported PASS, and breaking the evidence references
    flips a real fixture from PASS to FAIL. Proofs stay green — simulator 43/43,
    grid proof exit 0.
    **NOT a golden-rule-1 change, verified rather than assumed.**
    `decisionEngine.ts` has a byte-faithful Swift port, so this was checked
    before touching it: `check-decision-port-parity.mjs` reports 16 TS rules vs
    16 Swift rules, 0 divergences, and the Swift port carries no
    `expectedOutcomes` or `status` at all. The PASS verdict is the simulator's
    self-assessment harness, not a decision rule, so there is no twin to keep in
    step.

40f. **The self-audit route treated PARSEABLE as VALID — and let an operator
    file overwrite the server's own honesty note.** DONE 2026-08-23, found by
    `fail-closed-auditor`.
    `/cp/v1/self-audit` spread `JSON.parse(status.json)` straight into the
    response. The `catch` only guarded text that is not JSON at all, so `[]`,
    `null`, `0` and `"corrupt"` each parsed and each produced a 200 carrying no
    `plain`, no `report` and no `proposedHeals` — a console rendering
    `plain.allClear` or `report.failures` sees nothing and shows CLEAN.
    Worse, the spread came AFTER the server's `note`, so a file containing its
    own `note` key replaced the honesty statement with its own text. On the
    surface whose entire job is reporting status honestly.
    Now shape-checked against what the emitter actually writes (read from
    `scripts/src/self-audit-run.ts` rather than guessed): an object with
    `source: "real-run"`, object `plain` and `report`, and an array
    `proposedHeals`. Anything else falls back to the labelled fixture, exactly
    as unparseable text already did. Server-authored `source` and `note` are
    now written AFTER the spread, so an operator file cannot overwrite either.
    Nine shape cases falsified, including the `{note: "All gates green."}` file
    that previously replaced the server's own words. `test:api` 301/301.

40g. **The determinism scope was a hand-listed fossil covering EIGHT of
    thirty-four packages.** DONE 2026-08-23.
    `review-invariants.mjs` check 2 scanned a literal `PURE_LIBS` array. A list
    like that is a fossil the day someone adds a package: the new one is simply
    not scanned, and nothing says so. Scope is now DERIVED from the filesystem —
    34 packages, 3 with declared clock reads (39 pinned), 31 held at zero.
    A package that legitimately reads the clock is DECLARED with a reason, a
    retirement condition, and a PINNED count. The pin fails in BOTH directions:
    more reads than declared means new ones arrived unexamined, FEWER means the
    entry has outlived part of its justification. A declared package that stops
    reading a clock entirely is a STALE exemption and fails too. All three
    directions were falsified against the real tree.
    The three declared: `lib/integrations` (22 — connector-boundary fixture
    stamps and freshness computed where wall-clock IS the input; the core
    receives the derived value and never reads a clock), `lib/location` (5 —
    observation stamps and the TTL sweep; it emits signals, not verdicts), and
    `lib/webauthn` (12 — challenge and step-up expiry, inherently
    clock-dependent; the risk there was never the read but its DIRECTION, now
    gated by `check-nan-fail-open.mjs` after nine fail-open sites).
    **Check 2 also did not mask string literals** while check 1 did — harmless
    across eight planner libs, immediately wrong across thirty-four, where a
    string containing the text of a clock call reads as a clock call. Fixed with
    the widening.
    `PURE_LIBS` stays narrow and hand-listed on purpose: checks 1 and 3 assert
    fail-closed switch shapes meaningful only for the planner libs, and widening
    THOSE would flag correct code everywhere. Only the clock rule is
    repository-wide.
    **A claim was nearly made here and checked instead.** The draft of this row
    said nothing prevented a clock read entering the decision core. That is
    FALSE: `scripts/safety-check.mjs` check 1 scans `lib/signalgrid-core/src/`
    for exactly this, and predates all of the above. The repo's own
    `check:absence` probe returned CORROBORATED and would have licensed the
    wrong claim — it tests a PHRASE, not a property, which is a limit worth
    knowing about that tool. Reading the gate settled it. The two gates together
    now cover every package under `lib/`.

41. **POSITIONING.md's claim-to-proof trace has fossilized** — DONE
    2026-08-23, exactly as the row prescribed: anchors that resolve by ID, plus
    a gate. Measured first: ALL FIVE `launch-profile.mjs` line anchors had
    rotted, and the other five references (types.ts, adapters.ts, preflight.mjs,
    review-invariants.mjs, v1-openapi.yaml) still resolved correctly.
    What the five pointed at instead — `:126-129` claimed the criterion string
    and pointed at `TARGET`; `:240-243` claimed `device_posture` is launch and
    pointed at `"webhooks"`, a DEFERRED entry; `:274-275` claimed location is
    deferred and pointed at `"credential_rotation"`; `:308-310` claimed
    `/v1/decisions/evaluate` and pointed at a comment about `/api` mounting;
    `:453-458` claimed `ios:EnterpriseShell` and pointed at the operator
    console.
    The distinction that matters: every CLAIM was true and every CITATION was
    false. `device_posture` really is launch; `location` really is deferred. A
    reader checking the work would have found nonsense at the line with no way
    to tell whether the claim or the pointer had drifted — which is worse than
    an uncited claim, because it looks checkable.
    The trace now references the profile BY ID (`launch-profile: \`x\` is
    \`status\``) and `scripts/check-positioning-trace.mjs` (preflight + CI)
    resolves each against the profile itself: 7 references against 180 (2026-09-06)
    classified items. An id that does not exist fails; an id whose status
    differs fails; a bare export reference that is not exported fails.
    Falsified all three ways. Only launch-profile references are GATED, because
    only they are mechanically resolvable — prose grounding stays with the
    cited-paths gate rather than being pretend-verified here.
42. **The verdict core still has no named reader** — DONE 2026-08-23, and it
    found a live fail-closed inversion on a reachable route.
    The row's figure was wrong and is now measured: **3,895 lines**, not
    ~2,900 (engine 560, decision 216, policy 764, resolution 522, evidence 340,
    continuity 409, simulator decisionEngine 313, posture-composition 771).
    The row's other two claims held on checking, and were not "corrected":
    `review-coverage.json` genuinely carried zero entries for the
    verdict-computing files — its one signalgrid-core entry is `auth.ts`, which
    is authorization, not verdict computation — and `review-tiers.json` was
    genuinely never committed.
    `verdict-core-reader` (hired by the DR-016 loop for exactly this) read all
    eleven files and filed nine ledger entries. What it found:
    **FIXED — prototype keys erased a deny.** `continuity.ts` gated outcomes
    with `record.outcome in OUTCOME_RANK`, and `in` walks Object.prototype, so
    `"constructor"` passed validation. It was not a harmless extra value:
    `mostRestrictiveOutcome` reduces with NO initial value, so a poisoned key
    arriving first becomes the accumulator, its rank is a function, `4 >
    function` is NaN, and nothing displaces it. `most(["constructor","deny"])`
    returned `"constructor"` while `most(["deny","constructor"])` returned
    `"deny"` — a genuine deny erased, and the answer order-dependent, which
    falsifies the module's own headline law twenty lines above. Reachable via
    `POST /v1/decisions/reconcile`, served under the default `review-demo`
    profile and fenced under `shared-device-gateway`. Fixed with Set membership
    in `validateRecord` AND inside the exported `mostRestrictiveOutcome`, which
    a caller can reach without validation at all. The prototype-less table was
    the first attempt and the proof rejected it — `policy.ts` holds a twin and a
    parity check requires the two byte-identical — so the defense moved to where
    the danger is rather than deforming a table that must match its twin.
    Regression assertions added; 72/72. Falsified honestly: reverting EITHER
    guard alone still passes, reverting BOTH drops seven, so what is pinned is
    the property, not which arm enforces it — recorded in the proof rather than
    left for a reader to assume.
    **FIXED 2026-08-23 — freshness is computed, stamped, and now CONSUMED.**
    `DecisionEvidence` gained `dockEvidenceFreshness`: the worst freshness across
    the dock-family signals that actually exist, folded into
    `deriveCriticalSignalsPresent`, so stale/expired/unreadable dock evidence
    suppresses `allow` to `step_up` through the existing fail-closed backstop and
    its existing reason code. No new policy rule and no new reason code were
    needed.
    Two traps were found on the way, both worth keeping:
    (a) **the obvious fix relaxes the gateway.** Degrading a stale VALUE to
    "unknown" would stop an expired `custody_state:"checked_out"` matching
    `custody-overdue` — a restriction would vanish. Staleness therefore travels
    as its own input into a backstop that can only ever tighten.
    (b) **`"missing"` must stay permissive.** A tenant with no dock hardware is a
    deployment shape, not a degraded signal; treating the two alike would step up
    every such tenant on day one. That arm is asserted explicitly.
    The snapshot canary fired on the first run, exactly as designed: the digest
    covers the whole evidence body, so adding a field moved it.
    `LEGACY_SNAPSHOT_DIGEST` re-pinned b8d6988973734339 → 6ab07be9ec3cdddc with
    the reason recorded beside the 2026-08-10 precedent, and
    `CORE_NORMALIZATION_VERSION` 5 → 6 records the same change as provenance.
    Real pre-change rows still verify — the digest FUNCTION is unchanged and each
    row is checked against its own stored body.
    Falsified across all five freshness values plus a non-vacuity control
    proving the intact case is genuinely intact. Core proof 221 assertions, 20
    evidence fields.
    **(superseded — the original finding, kept for provenance)** `dock.ts`
    classifies each record's age and stamps `freshness` on all six signals it
    emits; `buildEvidence` reads only category/value/observedAt and never
    consults it, and `DecisionEvidence` carries no per-signal freshness at all.
    A year-old `tamper_state:"none"` is indistinguishable from a fresh one, and
    the asymmetry is sharp: a dock that HONESTLY reports `sensor_unavailable`
    steps up, while a dock silent for a year does not. The operator console
    renders that same `freshness` as an evidence-quality badge, so it is shown
    to a human as meaningful while the verdict ignores it. Zero proof coverage.
    **OPEN — the simulator's remediation allow skips the base-trust guard.**
    `decisionEngine.ts:220-227` omits the `outcomes.size === 0` condition every
    other allow must pass, so `remediation.verified` plus a non-suppressing
    outcome (`api.integration_failed`, `low_battery`, `health_degraded`) yields
    an allow that the same evidence WITHOUT the remediation does not. NOT fixed
    here on purpose: this file is the byte-faithful source of the Swift port and
    editing it breaks parity — it needs the twin changed in the same commit.
    **FIXED 2026-08-23 — the backstop's "critical" set now includes
    `osSupported` and rejects an EXPIRED `postureFreshness`.** Both were masked
    by the shipped v1 rules (`healthy-allow` gates on `osSupported: true`, so an
    unknown one simply fails to match; `posture-stale` catches expired), and
    both were reachable by a custom rule set: `createPolicyDraft` activates
    anything `validatePolicyRules` accepts, and nothing requires an allow rule
    to gate on either field. A version whose only allow rule was
    `{deviceManaged: true}` would have allowed on unverifiable OS support with
    the backstop none the wiser — and the backstop is precisely the layer meant
    to hold when the rules do not. A posture answer whose own freshness says it
    has lapsed is not a posture answer.
    Blast radius measured before applying, not assumed: core proof exit 0 and
    the API suite 301/301 with the change probed in, so nothing existing
    depended on the hole. Falsified: reverting either clause fails exactly its
    own assertion. Core proof 221 assertions.
    **Dead computed fields:** `SignalGridDecision.confidence` confirmed zero
    readers anywhere, plus `summaryForOperator`, `projectedReasonCodes` and
    `clears` in `resolution.ts` — while the sibling `summaryForWorker` is
    rendered twice, which is what makes the operator one conspicuous.
43. **Falsifiability is enforced only for the connector tier** — devex-tooling-engineer. HALF DONE
    2026-08-23: the worst unfailable arm is fixed, and fixing it found a live
    bug. Note the path first, because the row named a package that does not
    exist: there is no `lib/signalgrid-grid`; `proof:signalgrid-grid` runs
    `scripts/src/signalgrid-grid-proof.ts`, a harness over the simulator.
    Its `safeMalformedRun` caught EVERY error and returned a synthesized
    result — status "validation_error", plus a one-element `auditEvidence`
    array built inside the catch block. The two assertions per case then
    checked that status and that `auditEvidence.length > 0`, both against data
    the catch had just written. All seven malformed inputs throw, so all
    fourteen assertions passed unconditionally and the simulator was never
    exercised on that path. Unfailable was the lesser half: it was fail-OPEN,
    because ANY error became "the guard worked".
    Each case now DECLARES the guard that must reject it
    (`expectRejectedBy`), the catch reports the real thrown message instead of
    minting evidence, and a rejection arriving from anywhere else fails.
    On its first run the rewritten assertions caught a real latent defect:
    `allowedSignalTypes` and `allowedSeverity` were `const`s declared ~650
    lines BELOW the top-level loop that reaches them, so the enum check ran in
    the temporal dead zone and threw `Cannot access 'allowedSignalTypes'
    before initialization`. The "invalid enum values" case had therefore never
    tested the enum guard at all — it crashed, and the old catch recorded the
    crash as a pass. Both sets are hoisted above first use; the enum guard now
    genuinely runs. Proof: 783/783, determinism hash unchanged in shape.
    Falsified both directions: pointing one `expectRejectedBy` at a message
    that never fires → 2 failures; re-introducing the temporal-dead-zone
    ordering → the same 2 failures it originally exposed; restored → 783/0.
    STILL OPEN, and deliberately NOT restated as measured here: a review pass
    reported roughly 334 further structurally-unfailable assertions in the
    same file (tautologies over values the code under test computes, and total
    functions that cannot return falsy). Only the fourteen above were verified
    by falsification, so the rest stays a reported figure until someone plants
    a defect against it. Also open: mutation coverage still does not reach the
    verdict core, and 21 of 50 check-gates carry no self-test.
    The unexecuted-test half is now DISPOSITIONED rather than merely known.
    Reading the eight `tests/security-reference/` suites settled what they were:
    Vitest specs against the retired DEV Next.js server — `/api/session/start`,
    `/api/health`, `badgeUid`, launched with `bun run scripts/test-server.ts` —
    none of whose endpoints exist on this monorepo's `/v1` surface.
    CORRECTED 2026-09-02, and the correction matters because this entry was
    read as a disposition. Both of its verdicts failed: the portability verdict
    was wrong for seven of the eight specs, and the claim about step-up having
    nothing to port onto was wrong as stated —
    FOUR step-up routes are live in `artifacts/api-server/src/routes/v1.ts:622`,
    `:640`, `:682` and `:745` (`/v1/step-up/enroll/options`, `/enroll/verify`,
    `/challenge`, `/v1/app-workflows/complete-step-up`), with coverage beside
    them, LIVE UNDER REVIEW-DEMO AND NOT ON THE LIMITED GA FENCE — `GA_ALLOWED_ROUTES`
    in `artifacts/api-server/src/lib/profile.ts` lists no `/v1/step-up` path, and
    `lib/assurance.ts:52-55` reports `stepUpAnswerable` from exactly that fact. So
    the family ships as a demo surface and is not claimable as GA; building and
    claiming are different acts. What was unportable was the ENDPOINT SHAPE, not
    the invariant. All seven are now ported and executed; the directory is
    deleted; see row 71.
    That truthfulness was the problem: prose does not fail a build, and nothing
    stopped those eight from being written and never run, or an eleventh from
    joining them. `scripts/check-test-execution.mjs` (preflight + CI, parity
    green) now derives what actually runs — expanding package
    scripts transitively from preflight, the CI workflows and
    validate-sim-macos.sh, every queued script reached — and requires every
    test-shaped file to be REACHED or DECLARED with a reason and a disposition.
    It reports every test file as REACHED or DECLARED with a reason and prints
    the live tally on each run (14 files, all reached, 0 declared as of
    2026-09-02). A declaration that outlives its reason fails, so porting a suite
    retires its line and the last one out deletes the entry. Falsified three ways:
    a planted orphan test → exit 1; a declared file that IS reached → exit 1;
    restored → exit 0. RESOLVED 2026-09-02: `artifacts/mcp-server/test/server.test.ts`
    was WIRED UP (preflight + review-hub-ci.yml, `pnpm --filter @workspace/mcp-server
    run test`) rather than folded-and-deleted — it carries wire-visible annotation
    coverage the proofs do not — so its declaration is gone. Only the k6 scripts in
    `tests/load/` remain unexecuted, which the gate deliberately does not
    pattern-match and says so in its own header. 2026-09-05 (sixth audit
    round): those three drivers were read for the first time and could not
    FAIL — 401/404/400 counted as success, so a server that never served
    `/api/session/start` or `/api/location/report` (this api-server serves
    `/v1/*`, neither route) scored a perfect run, and `webhooks.js` defaulted
    its target to a third-party host. Predicates are 2xx-only now and the
    receiver is required (4b50c4d). Their RETIREMENT is an owner decision:
    they are invoked by nothing, target routes that do not exist, and
    `pnpm run test:load` already covers the served surface — the cloud lane
    cannot delete tracked files, so the drivers stay until the owner says.
44. **Two ungated contracts in the governance layer** — devex-tooling-engineer (the gates) + principal-engineer (the records). HALF DONE
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
46. **Production OIDC branch of /v1 never executes in any test** — DONE
    2026-08-23, and the unexecuted path was hiding a defect that broke
    enterprise authentication completely.
    The gap was confirmed first: `scripts/src/live-idp-proof.ts` drives an
    issuer directly (`/token`, `/jwks`, discovery) and never touches
    `middlewares/context.ts`, and `api.test.mjs` carried ZERO OIDC references.
    So the most security-sensitive path in the product was held by review alone.
    **THE DEFECT: enterprise OIDC authentication had never worked in
    production.** `context.ts` called `initEnterpriseAuth()` at line 53 (module
    load) and declared `const defaultJwksFetch` at line 74 — twenty-one lines
    BELOW the call. `function` hoists; `const` does not, so the authenticator
    was constructed with an undefined fetch and every enterprise token failed
    with "could not load signing keys: fetchImpl is not a function". Any
    deployment that configured an IdP would have 401'd every real caller while
    logging "Enterprise OIDC authentication enabled for /v1."
    Second instance of this class in one day — `signalgrid-grid-proof.ts` had
    `allowedSignalTypes` declared ~650 lines below the loop that read it. Both
    silent, both in code no test executed. The rule is now written where it
    matters: initialisation above first use in module scope.
    `artifacts/api-server/test/oidc.test.mjs` (preflight + CI, parity green at
    216 gates) executes the real branch with no IdP: it mints an RSA key, serves
    a genuine JWKS over localhost and signs real RS256 tokens, so everything the
    middleware verifies is authentic and only the issuer is local. 14/14 —
    the valid token authenticates and maps to the INTERNAL tenant; a demo key is
    refused while OIDC is configured (the no-fallback rule); and wrong audience,
    wrong issuer, expired, unmapped tenant, unmapped role, `alg:none`, unknown
    signing key and non-JWT garbage are each refused.
    Falsified: moving the declaration back below its use drops it to 12/14 with
    the two positive assertions failing — the exact defect, reproduced on demand.
    Recorded because it cost a debugging round: a mapped internal tenant must
    ALREADY EXIST (`registerVerifiedPrincipal` calls `requireTenant` — "an OIDC
    identity cannot conjure one"), so an `OIDC_TENANT_MAP` naming an absent
    tenant produces a 401 indistinguishable from a bad token.
47. **~~METRICS_TOKEN compared non-constant-time~~** — DONE 2026-08-23:
    the operator's real secret now goes through the same constantTimeEquals
    the core already used for its PUBLIC demo keys. The weaker guard had been
    sitting on the stronger secret.
48. **Native parity is textual, not behavioral** — mobile-native-engineer, days. The
    port-parity gate compares extracted vocabulary and says so itself; iOS is
    carved out of the shared assist-wire conformance vectors; ios-ci does not
    trigger on simulator/workflow library changes; BackendService still calls
    five endpoints that exist nowhere.
49. **Assessor-facing overstatement** — compliance-analyst. HALF DONE 2026-08-23: the
    questionnaire pack told assessors that docs-sanity "fails the build if any
    document claims otherwise" for SOC 2 / ISO 27001 / HIPAA / FedRAMP. Of
    those four, only SOC 2 (in its "Type II certified" phrasing) and FedRAMP
    (hyphenated only) had denylist entries — ISO 27001 and HIPAA had NONE, in
    any form. Fixed by making the promise TRUE rather than softening it: twelve
    certification phrasings added, falsified both directions (a planted document
    asserting two of those framework certifications fails the gate; the clean
    tree passes — and this very row had to be reworded because quoting the
    planted phrases verbatim tripped the widened gate, which is the gate
    working: fix the copy, never the gate). The existing negation handling means the pack's own "None held,
    none claimed" row stays legal. REMAINING: SECURITY_CONTROLS_MATRIX's status
    column still has no drift gate (days).
50. **Operability claims without live evidence** — sre (the CI-bound half) + mac-lane-steward (live evidence is mintable only on the Mac). ONE THIRD DONE 2026-08-23.
    The CI-bound half is closed and gated; the other two remain open.
    **DONE — the nine unbounded jobs.** The row's figure was exactly right: 32
    real jobs, 9 without `timeout-minutes` (a first parse of mine said 43 and
    was wrong — it counted `on:` trigger keys as jobs; the corrected count
    matched the row). All nine now declare a bound, and
    `scripts/check-ci-job-timeouts.mjs` (preflight + CI) keeps it that way,
    with a declared-exemption escape that fails if it outlives its reason.
    Why it mattered: GitHub's default ceiling is 360 minutes, so a hung step
    does not fail — it holds the job, and on a PR-gating job the merge, for six
    hours while reporting "in progress". Indistinguishable from slow CI, which
    is how it went unnoticed. The bounds are set at roughly 2–3x observed
    runtime rather than at it, because a tight timeout is a flaky gate and this
    repository's standing position is that a flaky gate gets switched off.
    Falsified: stripping any single bound fails the gate.
    **STILL OPEN — the SLO surface has never consumed a real decision
    outcome.** Its only non-proof caller is an all-healthy fixture, so the
    operability claim rests on a shape that cannot report degradation.
    **PARTLY A CATEGORY ERROR, corrected 2026-08-23 — and the real half is
    still open.**
    "Absent from the routine registry" does not hold as written.
    `docs/agent/scheduled-routines.json` says in its own comment that it is the
    registry of ALWAYS-ON **agent** routines, transcribed from the live account
    scheduler via `list_triggers`. The daily sweep is
    `.github/workflows/scheduled-verification.yml` — a GitHub Actions cron
    (07:17 UTC, bounded at 45 minutes), not an agent lane. Adding it to that
    file would put a thing the account scheduler cannot see into a registry
    whose gate checks it against heartbeats and the org roster. Same shape as
    row 42's "no named reader": true in spirit, wrong in the letter, and acting
    on the letter would have made a document less accurate rather than more.
    **The liveness half DOES hold.** The workflow runs and leaves nothing
    committed, so nothing in this repository can answer "did the mutation sweep
    run today, and what did it measure" — only the Actions history can, and
    that is not evidence the repo carries.
    NOT DONE, and deliberately not decided by an agent: the obvious fix is the
    heartbeat pattern the two agent routines use, but that means a scheduled
    workflow committing to the repository every day. That is a standing change
    to what CI is allowed to write and how much noise the history carries, and
    it wants an owner's call rather than an agent's preference. The alternative
    — a separate always-on registry for CI-scheduled lanes, checked the same way
    — is the same decision wearing a different hat.
54. **Seven merges carried zero reviews — and the first diagnosis blamed the
    wrong thing.** — qa-engineer (the review that was never run) +
    program-manager (the loop that never called it). 2026-08-24.
    THE FINDING WAS REAL: #280-#286 all merged with ZERO reviews of any kind,
    measured one at a time through the API, including #283 which cleared a live
    CRITICAL on the shipping image. The session saw seven "You have reached your
    Codex usage limits" notices, called each informational, merged, and then
    said the reviewer's absence was fine because the gate suite carried the
    load. That is this repo's `absent-collection law` inverted in the operating
    loop: nothing observed is not nothing wrong, and silence is not an
    affirmative — both already gated for the product, neither watching the
    process that ships it.
    **THE DIAGNOSIS WAS WRONG.** The first fix built
    a `check-review-liveness` gate to name merges lacking an EXTERNAL review
    (built, then deleted in the same session — it is not in the tree and is
    named here only as the wrong turn it was), and re-requested all seven from
    Codex. Both actions assumed a
    reviewer that is RETIRED. The owner had said so; the repo says so too —
    `docs/BRANCH_HYGIENE.md` describes `codex/*` as "the earlier Codex lane
    (Jun-Jul 2026)", past tense, and seven consecutive quota rejections in one
    day is an account that is out, not an account that is busy. The gate was
    deleted rather than kept: a check that reports a permanent expected
    condition is the kind that gets ignored, and an ignored gate protects
    nothing.
    **WHAT THE GAP ACTUALLY IS.** The reviewer was never missing. `ORG.md`
    ratifies a Reviewer lane at line 159 — "Adversarial pass. Never fixes.
    Produces findings only." —
    `.claude/skills/signalgrid-reviewer/SKILL.md` says in its own description to
    use it "when a change is ready for review, BEFORE any push or PR"; the
    roster carries `code-reviewer`, `verdict-core-reader` and
    `fail-closed-auditor`, all read-only by construction. This lane shipped
    seven pull requests without invoking any of them, then went looking outside
    for a reviewer it already had. The control is not a third-party service. It
    is a role that exists and was not run.
    CORRECTION APPLIED: the reviewer is invoked before push, not after merge.
    The Codex attributions in `scripts/review-invariants.mjs` ("the exact class
    Codex #70 caught", #79, #81) STAY — they are accurate provenance for where
    those rules came from, and erasing history to match present tooling would be
    its own falsification.
    LOOSE END, recorded rather than tidied: seven `@codex review` comments were
    posted on #280-#286 before the retirement was known. #283's carried a 👀
    from the connector, so the trigger does work on a merged PR — a fact worth
    keeping even though the premise was wrong. They will not be answered. They
    are left in place because they carry the focused review asks and the record
    of what happened; seven retractions would double the noise to correct a
    premise this row already corrects. Anyone reading those PRs should treat the
    request as withdrawn.
    The `fail-closed-auditor` charter extension to the OPERATING LOOP survives
    this correction and matters more because of it: a check that did not run is
    not a check that passed, a job skipped for a missing credential is not a job
    that found nothing, and "no findings reported" is a different sentence from
    "no findings".

53. **CI liveness: the harness that proves every guard can fail had nothing
    watching whether it still ran.** DONE 2026-08-23.
    The mutation sweep is the only thing establishing that the gates in this
    repository are falsifiable, and it runs on a schedule — the one kind of work
    with no author waiting on its result. If it stopped, nothing would turn red.
    GitHub also disables scheduled workflows on inactive repositories, so "it
    stopped" is a real state.
    `scripts/check-ci-liveness.mjs` (preflight + CI, self-tested) resolves the
    sweep JOB's own last success and fails when it is older than 48h — one
    missed run tolerated, two consecutive misses fatal.
    **It gates the JOB, not the RUN, and row 52 is why.** That day the run
    reported `conclusion=failure` while the sweep itself SUCCEEDED; the failure
    was a sibling job on a real CRITICAL. "Did any job fail" and "did the sweep
    run" are different questions needing opposite responses, and a run-level
    conclusion conflates them. When the sweep passes inside a red run, this gate
    passes and says so explicitly in its output.
    **The committed-heartbeat design was rejected**, not merely un-chosen. It
    needs the workflow's GITHUB_TOKEN to push, which was never established as
    possible here — the repo's only precedent commits to a PR head branch, never
    the protected default — and it is strictly less truthful, because an artifact
    can be stale-but-present or written by a run that then failed, whereas a
    job's completion timestamp cannot lie about whether the job ran.
    FATAL in CI when the API is unreachable, REPORTED locally. Unknown must
    tighten, but a gate that fails a developer's preflight for holding no token
    is a gate that gets switched off, and a switched-off gate protects nothing.
    **The thing that would have broken the build was caught by reading, not by
    running**: `review-hub-ci.yml` granted `contents: read` only. Without
    `actions: read` the token cannot read workflow runs, the API call fails, and
    a gate that is fatal-on-unreachable in CI would have reddened every build the
    moment it merged. The scope is now granted deliberately.
    Also fixed in passing: importing the module used to execute the whole gate,
    including its network call. The pure decision is exported; the script body
    runs only on direct invocation.
    Falsified: disabling the staleness comparison makes the gate REFUSE TO RUN
    (exit 1) and name which cases broke, rather than passing quietly.

52. **The daily image-vulnerability gate had been RED for two days and nobody
    acted on it.** FIXED 2026-08-23, found while scoping the CI-liveness lane.
    Scheduled Verification reported `conclusion=failure` on 2026-08-22 and
    2026-08-23. **Read the JOBS, not the run**: the mutation sweep SUCCEEDED
    (28 min) and the launch-gate lane SUCCEEDED; the failing job was the daily
    image-vulnerability gate. A run-level conclusion answers "did any job fail",
    not "did the sweep run", and the first reading of this incident got that
    exactly backwards.
    Nor was it silent — the workflow opened issue #245 and refreshed it daily.
    The alerting worked. What failed was that nobody read it.
    **The finding, reproduced locally** with the same sha256-pinned grype
    0.112.0 CI uses: GHSA-23hp-3jrh-7fpw, `tar` 7.5.11 fixed in 7.5.19,
    CRITICAL, at `/usr/local/lib/node_modules/npm/node_modules/tar` — npm's
    BUNDLED tar, inside the `node:22-alpine` base image.
    **The issue's own advice could not be followed.** It said "bump the affected
    base layer or dependency"; scanning `docker.io/library/node:22-alpine`
    directly shows the CURRENT published tag still ships 7.5.11. There was
    nothing to bump to. The real choice was to suppress a live critical or to
    delete code the image does not run.
    npm is deleted from the runtime stage. Verified unused before removal: the
    install runs through corepack/pnpm, the entrypoint is plain `node`, the
    api-server source never shells out to npm or npx, and the compose migrate
    path runs `pnpm run db:migrate` from a repo CHECKOUT rather than inside the
    container. `Dockerfile.web` is unaffected — its runtime is `nginx:alpine`
    with no node at all.
    **The first attempt was INCOMPLETE, and CI caught it.** Removing npm alone
    left a second vulnerable copy: `corepack enable pnpm` fetches pnpm into the
    corepack cache, and pnpm 10.28.1 bundles its OWN `tar` at
    `dist/node_modules/tar` — version 7.5.3, also below the 7.5.19 fix.
    How it surfaced is the point. The per-PR image-evidence job reported
    `conclusion=success` — it is REPORT-ONLY, so its green says the job ran, not
    that the image is clean. Its log said `matches by severity: {'Critical': 1}`.
    That number alone proves nothing, because that job runs grype WITHOUT
    `--only-fixed` and therefore counts unfixable findings too. What made the
    leftover provable was scanning the base image separately: it has exactly ONE
    critical in total and it is fixed-available, and the repo dependency SBOM has
    ZERO criticals of any kind — so the surviving one could not be an unfixable
    base finding or an application dependency. It had to be something in neither
    scan, which is what the corepack cache is.
    Both package managers and the cache are now removed. The cache is FOUND by
    search rather than hardcoded, because its path depends on `$COREPACK_HOME`
    and on which user ran `corepack enable` — and a wrong hardcoded path fails
    SILENTLY, since `rm -rf` on a non-existent directory succeeds. The step then
    proves itself: any bundled `tar` surviving outside `/app` FAILS THE BUILD,
    rather than shipping an image the daily gate rejects hours later.
    **Limit stated: this could not be built here.** No Docker daemon in the
    cloud lane, so the image was never assembled locally; the base image was
    scanned directly from the registry instead. CI's compose smoke and the next
    daily vuln gate are the verification, and if the build breaks, that is where
    it surfaces.
    Carried into the CI-liveness design: the gate must distinguish "the sweep
    did not run" from "a sibling job failed". This incident is the proof that
    those get conflated, and they need different responses.

51a. **DISPOSITION OF ROW 51: `lib/location` is KEPT. Deletion considered and
    REJECTED 2026-08-23.** The row below measured it as an orphan with zero
    importers and queued deletion. The measurement was right and the conclusion
    was wrong, for a reason worth keeping.
    `location-services` is a DEFERRED CONNECTOR FAMILY, and `location` and
    `location_certainty` are DEFERRED SIGNAL KINDS — all three verified in the
    `deferred:` lists of `scripts/launch-profile.mjs`, not inferred. **Zero
    importers is the EXPECTED state of a deferred family's implementation**, not
    evidence that it is dead. It is unwired because the family has not shipped,
    which is the plan, not a defect.
    What would have been deleted: 440 lines implementing NAC RADIUS Accounting
    and DHCP-lease location ingest — MDM/UEM-agnostic, network-derived presence.
    That is committed future work, and irreversibly discarding it to reduce a
    package count would have been a bad trade.
    **The error was in the question, not the arithmetic.** "Does anything import
    this today" is the wrong measurement for a deferred family; "is this the
    implementation of something we have committed to ship" is the right one, and
    it answers yes. This is the same failure class `fail-closed-auditor` was
    hired for — a measurement that is accurate and answers something other than
    what was asked — applied to a plan row rather than to code.
    Two clock reads in it were fixed on the way past (`getLast` and the
    `cleanup()` twin, row 40c), and the package is now DECLARED in the
    determinism ledger (row 40g) with a retirement condition tied to the family
    shipping — not to the package being deleted.
    Reversal clause: revisit if `location-services` is ever moved from deferred
    to WONTFIX, at which point the implementation genuinely has no future and
    deletion becomes correct. Recoverable from history at `4a170db` regardless.

55. **The org chart had no edge to the agents that run it, and running a role
    once emptied its queue.** — program-manager. 2026-08-24, from the owner's
    question: are all roles assigned to skills, and does everything have a task
    and a backlog. Both halves were no.
    NO ROLE NAMED ITS EXECUTOR. `docs/ORG_CHART.md` opened with "Each is an
    agent whose job is to be the deepest skill the company has in one thing"
    while no role named the agent or skill that would run it. CORRECTED
    2026-08-24, same day, by an adversarial audit of this very row: the first
    version claimed "ZERO references to `.claude/agents/` or `.claude/skills/`
    across all SEVEN role documents", and that was FALSE TWICE OVER. "Seven" was
    not a defined set: three org documents plus "the four under `docs/company/`",
    a directory that holds NINE files. And `docs/agent/ORG.md:275` already
    carried one reference, to "the skills under `.claude/skills/`" as a category.
    Both counts are now stated rather than asserted, because the first attempt to
    correct this said "twelve role-adjacent documents" and that was the loosest
    available reading — it counted every file in `docs/company/`, including
    `ICP_EVIDENCE.md` and `INVESTOR_ONE_PAGER.md`, which mention a role once each.
    By FILE COUNT the set is twelve; by CONTENT — a document that actually
    describes roles — it is nine: the three org documents plus `ROLE_CATALOG.md`,
    `ROLE_ACTIVATION_MATRIX.md`, `RESPONSIBILITY_AND_DRI_MATRIX.md`,
    `ROLE_LENS_REVIEW_2026-08-21.md`, `ORG_STRUCTURE.md` and `HIRING_SEQUENCE.md`.
    The measured truth is the same under either: re-run at `a7a9ae7^`, exactly
    one reference across all twelve files, and it names no role's executor. The
    substantive finding survives; the quantification did not, and it failed for
    the reason everything else this week failed — the verification regex
    required a name after the slash (`.claude/skills/[a-z0-9-]+`) while the
    CLAIM said "references to `.claude/skills/`". An accurate measurement
    answering a narrower question than the sentence it was used to support.
    Forty one roles, twelve agent definitions, no edge between them. Every role
    now carries an
    `executor` — `agent:<name>`, `skill:<name>`, or `lane` — and
    check-org-roster.mjs FAILS on a missing one, a malformed one, or one
    naming a file that is not on disk. Falsified three ways against the live
    tree, including renaming `.claude/agents/architect.md` out from under its
    two callers: exit 1 each time, green again on restore. The honest number is
    printed on every run and is not repeated here: a minority of roles have a
    dedicated agent or skill and the rest are the main lane as a lens, which is
    a true roster of a small company rather than a chart of ghosts.
    ACTIVATION EMPTIED THE QUEUE. `nextAction` was required of COLD roles only,
    so eleven of the sixteen activated roles carried none and "activated" had
    quietly come to mean "finished, forever" — the same fossil as a title
    nobody runs, one shift later. It is now required of every role, and the
    eleven were written from what each role actually produced.
    THE BACKLOG'S OWNERS DID NOT RESOLVE. Nine rows carrying work named no
    role from the registry. Three abbreviated role names — `mobile-native`,
    `devex-tooling`, `design` — accounted for two of those nine (rows 29 and
    48); the first version of this row said "three of them", counting terms as
    rows. New gate scripts/check-backlog-ownership.mjs (preflight + CI) refuses
    an open or partially-done row that names no role, and reads the ids from the
    registry rather than listing them.
    THE GATE THEN FAILED OPEN, in the exact direction its own header calls the
    dangerous one, and the same audit found it within the hour. Markers were
    matched with String.includes, so a row reading "still NOT DONE, nobody owns
    it" contained "DONE", classified CLOSED, needed no owner, and the gate
    printed `passed` with zero problems. So did "UNDECIDED", which contains
    "DECIDED". Fixed two ways: a marker now counts only as a whole upper-case
    TOKEN, and a marker under a negation does not close a row. REJECTED was
    removed from the vocabulary outright — "approach A was REJECTED" disposes of
    an option, not of the work, and no row closed on it alone. The four rows
    that used to slip through are now negative controls in the self-test.
    THEN IT FAILED OPEN A SECOND TIME, on this row. Run against the document
    containing this very entry, the gate read the examples QUOTED two paragraphs
    above — the quoted string carrying `NOT DONE`, and the quoted `DECIDED` —
    as its own status, and closed row 55. The negation guard did fire on
    the first occurrence and was then defeated by the second, because a quotation
    reproduces a word without meaning it. Status is now read with quoted spans,
    curly-quoted spans and code spans stripped; ownership deliberately is not,
    because a wrongly-detected OWNER costs an unnecessary name and a wrongly
    detected CLOSED hides work. Self-test 11/11 to 21/21. Worth stating plainly:
    the gate's second and third defects were both found by pointing it at the
    row describing itself, which is the cheapest falsification available and was
    not part of the original plan.
    A FOURTH FAILURE, found by an independent review before merge, and worse in
    KIND than the first three. Those three misclassified a row's status. This one
    made a row INVISIBLE: `parseRows` keyed on `/^(\d+[a-z]*)\./`, which cannot
    match this document's own hyphenated sub-numbering — and `40c-2` exists
    right here. A heading that does not match is not skipped, it is APPENDED to
    the row above, so the whole of 40c-2 lived inside row 40c's 10,097-character
    body. A generous scan found 67 headings; the gate saw 66. An invisible row is
    never counted, never bucketed, and can never trigger the FATAL owner check
    whatever it says. Benign today only because both rows happen to be closed.
    Fixed two ways, because widening the pattern alone postpones it: the id
    grammar now accepts hyphenated ordinals, AND anything SHAPED like a row start
    that still fails to parse is now a FATAL problem rather than silent
    continuation text — the next grammar drift breaks the build instead of
    quietly shrinking the subject. A live self-test asserts parseRows sees every
    heading in the real document (67 of 67), so the count cannot shrink again
    unnoticed. Self-test 21/21 to 25/25.
    WHY NO SELF-TEST CAUGHT IT: every fixture used a bare `1.` id, so nothing
    exercised id parsing at all. Twenty-one green self-tests were twenty-one
    tests of everything except the thing that broke.
    IT HAPPENED A THIRD TIME while this paragraph was being written. The
    sentence describing the fix used the word `DECIDED` bare, outside quotes,
    and closed the row again — the gate was right and the prose was wrong. Every
    status word named in this document from here on is code-spanned for that
    reason. The rule the three rounds converge on: a document that discusses a
    vocabulary will contain that vocabulary, and any gate reading status out of
    free prose needs an explicit way to tell mention from use. Quoting is that
    way, and it only works if the writer uses it.
    A MEASUREMENT CORRECTED MID-TASK, recorded because the first answer was
    reported before it was checked: a first pass reported twelve unowned rows
    and the corrected pass six. The first read only each row's HEADING line, so
    an owner named on a continuation line was invisible. Same defect class as
    everything else this week — an accurate measurement answering a different
    question than the one asked.
    A RULE TRIED AND CUT: the gate first also failed any status-shaped word
    outside a closed vocabulary. Against the real document that produced
    sixteen findings, most of them prose rather than status — row 40c's "fails
    CLOSED" is this product's own fail-closed vocabulary. A rule that fights
    the domain's own words gets switched off; it was cut before landing, and
    the reasoning is in the gate's header so it is not retried blind.
    FOUR OF THE ELEVEN BACKFILLED NEXT ACTIONS WERE WRONG, and the method is
    why. They were written from each role's own `produced` field — which records
    what a role DID — rather than from the tree, which records what REMAINS. So
    they inherited every closure the `produced` field had not been updated for:
    devex-tooling-engineer was sent to make check-preflight-ci-parity.mjs
    resolve npm aliases, which it has done since `43ec8f7`, and to delete an
    exemption that is an empty Map; web-engineer was sent to disposition six
    findings that `INTAKE_LEDGER.md` row 95 records as closed, itemised, one of
    them explicitly declined; principal-engineer was sent to write a reversal
    path that DR-005's Reversal clause already contains. product-manager's
    asserted a count from a conversation nothing in this repository records, and
    is now marked as the open question it is. All four corrected in place, each
    against the primary source rather than against the roster.
    NO SKILL CLAIMS THE WEB — found while checking the mapping. `signalgrid-core`
    owns `artifacts/api-server/**` and `artifacts/signalgrid-app/**`;
    `signalgrid-native` owns `native/**` and `firmware/**`. Nothing claims
    `artifacts/signalgrid-web/**` (the marketing site) or
    `artifacts/signalgrid-review/**` (the review dashboard), so web-engineer —
    whose charter LEADS with the marketing site — and accessibility-specialist,
    whose charter is "the site and the served consoles", were both pointed at
    skills that exclude their own subject. Both now say `lane`, which is honest
    rather than flattering, and the gap is row 56.
    Still open, and now owned: 40b, 43, 44, 48, 49, 50, 54 carry named roles
    for the first time.

56. **No skill claims the two served web trees, so two roles point at skills
    that exclude their own subject.** — web-engineer (the decision) +
    devex-tooling-engineer (whatever gate follows). 2026-08-24, found while
    auditing row 55's executor mapping.
    `skill:signalgrid-core` declares `artifacts/api-server/**` and
    `artifacts/signalgrid-app/**`. `skill:signalgrid-native` declares
    `native/**` and `firmware/**`. Nothing under `.claude/skills/` declares
    `artifacts/signalgrid-web/**` — the marketing site — or
    `artifacts/signalgrid-review/**` — the review dashboard. Both are served
    surfaces that buyers see.
    The consequence was concrete and was corrected the same day: web-engineer,
    whose charter LEADS with the marketing site, had been pointed at
    signalgrid-core, and accessibility-specialist, whose charter reads "WCAG
    conformance across the site and the served consoles", had been pointed at
    signalgrid-native — a skill scoped to iOS, Android, desktop and firmware.
    Each executor excluded the role's own subject. Both now read `lane`, which
    is honest rather than flattering and is why the roster prints that count.
    DECIDED 2026-08-24 — the owner delegated the call ("go with your
    recommendation"). signalgrid-core now declares BOTH trees, `web-engineer`
    re-points to it, and NO new skill was created. The two rejected alternatives
    matter more than the chosen one, because each was rejected on evidence
    rather than taste.
    signalgrid-scribe was the obvious candidate and is disqualified BY ITS OWN
    WORDS: "You touch no source." It owns `docs/**` and `README.md`; these trees
    are React source. Widening it would have been the same over-generalisation
    that put two load-bearing guards behind a defense-in-depth comment in row 62
    — a scope stretched one step past what it says about itself.
    A NEW WEB SKILL was rejected because it would have been a label with nothing
    behind it. `CLAUDE.md` carries four accessibility rules and ALL FOUR are iOS
    — `UIFont`, `UIFontMetrics`, `accessibility-extra-large`, the `SG` tokens —
    and there is no web a11y or brand doctrine anywhere in the tree. A skill
    created to hold doctrine that does not exist is a role nobody runs, one
    level up, which is the defect the roster gate was built to catch.
    WHY CORE IS APT AND NOT A CONSOLATION: it is the only skill that both
    touches source and already owns a served web surface. All three trees are
    Vite/React on one toolchain, and the two being added are the same magnitude
    as the one it already has — 86 and 97 files against 98.
    MEASURED FIRST, as this cluster's whole lesson demands. Three gates already
    read those trees: `check-launch-claims` and `check-retention-claims` are
    CLAIM-TRUTH and fire without any skill, and `check-decision-palette` is the
    lone CRAFT gate. That split is what decided it — the truth half is already
    mechanical, so what a skill adds is source ownership, which is core's.
    WHAT THIS DELIBERATELY DOES NOT SOLVE. `accessibility-specialist` and
    `brand-design` STAY on `lane`, by decision rather than omission, and both
    now say so in their nextAction. Craft has one gate and no prose. The first
    work there is to WRITE the doctrine — focus order, live regions, reduced
    motion, contrast against both themes, stated the way the iOS rules are —
    and only then can a skill honestly claim it. Pre-creating one to hold the
    absence is what this row refused.

57. **The third absence claim shipped, and the fix is not a gate — measured, not
    assumed.** — competitive-analyst (the refresh) + docs-writer (the rule).
    2026-08-24.
    `docs/company/ICP_EVIDENCE.md` shipped the sentence *"no competitive surface
    anywhere in this repository names them"* about OLOID and Imprivata. False.
    `docs/research/COMPETITIVE_OLOID.md` (79 lines), `COMPETITIVE_IMPRIVATA.md`
    (74), `COMPETITIVE_TELEPORT.md` (102) and `COMPETITIVE_BATTLECARD.md` (127)
    were compiled 2026-07-14, two weeks earlier, every claim anchored to a URL —
    plus `docs/competitive-battlecard.html` and a rendered `CompetitiveSection`
    on the review dashboard. `pnpm run check:absence competitive` returns
    REFUTED and exits 1. It was not run. `CLAUDE.md` already recorded two prior
    instances of exactly this; its tally now reads three.
    A GATE WAS CONSIDERED AND REJECTED ON EVIDENCE. The obvious response is to
    fail any unhedged absence claim that does not cite a verification. Measured
    first: five narrow patterns for the universal shape — "no X in this
    repository", "nothing in this repository", "does not exist anywhere",
    "exists nowhere", "no X exists anywhere" — match 54 lines across 21 files
    today. Reading them, the overwhelming majority are not absence FINDINGS at
    all but deliberate BOUNDARY statements, and load-bearing ones: *"nothing in
    this repository is a production system"*, *"No customer data in the
    repository"*, *"there are no live vendor calls in this repository"*. Those
    are the publication boundary and the safety posture written down. A gate on
    this shape would fire on correct safety prose 50-odd times to catch the
    three that mattered, and this repository already states what happens to a
    gate that cries wolf.
    The distinguishing feature is not the sentence, it is whether the claim is a
    FINDING that motivates work or a BOUNDARY that constrains it — and no
    pattern separates those. Recorded here so the next person measures before
    building rather than after.
    WHAT ACTUALLY REMAINS: the competitive research is real but INTERNAL and
    last compiled 2026-07-14, and it predates IGEL shipping Imprivata Web SSO
    into the browser layer. That is a refresh of an existing surface, not the
    creation of a missing one, and ICP_EVIDENCE.md now says so.

58. **The NaN fail-open family HAS a Swift analogue — same semantics, different
    mechanism — and it reaches the Assist gate's own staleness input.** —
    mobile-native-engineer. REPORTED 2026-08-24 by the cloud lane, NOT FIXED:
    this lane has no Swift toolchain (`xcodebuild`, `swiftc` both absent), and
    editing auth-expiry behaviour that cannot be compiled or run is the exact
    confident-but-unverified move the rest of this week was spent undoing.
    THE QUESTION qa-engineer's queue asked was whether the ten TypeScript
    `NaN`-expiry sites crossed the port boundary. Strictly the defect cannot:
    Swift's `Date` is strongly typed, so there is no unparseable-date-compares-
    false path. The SEMANTICS crossed anyway, through the OPTIONAL:
    · `Models/SessionData.swift:44` — `var isExpired: Bool { guard let
      expiresAt = expiresAt else { return false } ... }`. A session carrying NO
      expiry is not expired, permanently.
    · `Services/SessionStateManager.swift:842` — `checkSessionTimeout()` guards
      on `if let expiresAt`, so a nil expiry makes the server-side expiry
      heartbeat a silent no-op.
    · `Services/SessionStateManager.swift:853` — `validateActiveSession()` does
      the same, so the token is never refreshed either.
    · `Views/HostAppViewController.swift:189` — `let stale =
      (SessionStateManager.shared.currentSession?.isExpired ?? false) ||
      simulatedStale`. TWO permissive defaults stacked: no session reads as not
      stale, and a session with no expiry reads as not stale. `stale` is a live
      posture input to the Assist gate.
    NIL IS REACHABLE FROM A REAL AUTH PATH, which is what makes this a finding
    rather than a shape. `Services/IdentityProvider.swift:442` — the MDM-based
    provider returns `AuthenticationResult(accessToken: sessionToken, ...,
    expiresAt: nil, ...)`: a genuine session token with no expiry. It flows to
    `SessionStateManager.swift:333` into `SessionData(expiresAt:)`. The `.mdm`
    auth type is a configured preset (`IdentityProvider.swift:165` sets
    `mdmProvider: .microsoftIntune`), not dead scaffold.
    STATED FAIRLY: that provider's own comment reads "In a real implementation,
    this would call the backend to create a session", so the MDM path is a stub
    today and no shipping configuration is known to select it. The defect is the
    DEFAULT, not a demonstrated live exploit — and golden rule 2 is about
    defaults: an unknown signal must raise assurance, never lower it. Each of
    the four expressions above resolves the unknown to the permissive side.
    THE TRADE-OFF IS A DESIGN CALL, not a mechanical fix, which is the other
    reason this is queued rather than patched. If `nil` legitimately means "this
    session type does not expire", flipping the default to `true` ends every
    such session instantly. The likely right answer is to make the absence
    explicit — a session that cannot say when it expires is not a session that
    never expires — but that belongs to the lane that can build and run it.
    FOR THE MAC LANE: reproduce by constructing a `SessionData` with
    `expiresAt: nil` and asserting `isExpired`, then decide the default. Note
    golden rule 1 does NOT apply — none of these four files is a frozen
    byte-faithful port.

59. **The image build makes two un-retried network fetches, and one of them
    flaked.** — release-engineer (the retry) + security-engineer (if the fix
    touches the corepack cache). 2026-08-24, first observed instance.
    `Dockerfile.api` runs `corepack enable pnpm` in BOTH stages (lines 19 and
    71). Corepack downloads pnpm lazily, so each stage fetches
    `registry.npmjs.org/pnpm/-/pnpm-10.28.1.tgz` at install time. On PR #287
    head `f52d54a` the BUILDER fetch succeeded — "Done in 5s using pnpm
    v10.28.1" — and the RUNTIME fetch four seconds later died inside Node's
    bundled HTTP parser: `AssertionError: assert(!this.paused)` at
    `Parser.finish (node:internal/deps/undici/undici:6165:9)`. A TLS stream
    aborted mid-download and surfaced as an internal assertion, failing the job.
    NOT A LOCKFILE PROBLEM, checked four ways before concluding: the commit
    touches no manifest or lockfile; `pnpm install --lockfile-only` locally
    regenerates the lockfile with zero diff; the builder stage resolved the same
    lockfile seconds earlier; and the same job passed on the previous commit.
    Re-running the failed job was the correct response and is what was done.
    THE FIX IS NOT OBVIOUS, which is why this is a row and not a patch. The
    cheap mitigation is a retry around the install. The tempting one — carry
    corepack's cache forward from the builder — is exactly what lines 97-111
    deliberately REMOVE from the shipping image, because corepack's downloaded
    pnpm is the copy that hides a CVE. Any fix must not undo that.
    Until then: an image build that depends on an unretried network fetch will
    flake again, and the failure will look like a build break rather than a
    network blip. That is the part worth having written down.

60. **The tool this repo mandates before writing "X does not exist" could not
    read documents — and the failure it was built to prevent was documents.** —
    devex-tooling-engineer. FIXED 2026-08-24, found by the pre-merge review.
    `scripts/agent/absence-check.mjs` ran its content probe as
    `git grep -lIi -e <topic> -- ':!*lock*' ':!*dist*' ':!*.map' ':!docs/*'`.
    That last pathspec excluded the entire docs tree.
    WHY THAT IS A FAIL-OPEN AND NOT A SCOPING CHOICE. The file's own header sets
    out the strength model in detail: a FILE hit is strong and REFUTES an absence
    claim; a WORD hit is weak and yields INCONCLUSIVE, "printed with their
    matches, and the caller reads them", precisely because "this repository is
    full of sentences naming things to disclaim them". Blinding the weak probe to
    docs did not make those sentences stop mattering. It converted "weak hit ->
    inconclusive" into "no hit -> CORROBORATED" — the strongest safe-to-claim
    verdict the tool can return. Excluding a source of weak evidence did not
    weaken the verdict; it strengthened it, wrongly. And the failure the file
    documents as its reason for existing is a DOCUMENT asserting "Android does
    not exist in any form".
    CAUGHT BY ITS OWN VICTIM. Row 55's queue work ran
    `check:absence "retired label"`, got CORROBORATED across all four probes, and
    rewrote positioning-messaging's nextAction to say the retired labels are
    "named NOWHERE in this repository" — retiring a real, live, buyer-facing
    problem. The same grep without the exclusion returns four files, three under
    docs/, that discuss retired labels by name. The labels themselves are live in
    `README.md:3` and `:136` ("Operational Trust Orchestration platform") and in
    `ReviewDashboard.tsx:350` and `About.tsx:50` ("Zero Trust orchestration
    platform"), against DR-004's ratified "Shared-Device Trust Gateway".
    FIXED: the exclusion is gone, with the reasoning written into the probe so it
    is not re-added, and two self-tests that would have caught it — a structural
    one asserting the content probe does not exclude docs, and a LIVE one
    asserting a prose-only topic classifies INCONCLUSIVE rather than corroborated.
    Self-test 12/12 to 14/14. The same query now returns INCONCLUSIVE.
    THE GENERAL LESSON, which is the reason this row is long: a checker that
    cannot see part of its subject does not report uncertainty about that part —
    it reports confidence about the rest. Every gate in this repository that
    carries an exclusion list is a candidate for the same shape, and nothing
    currently enumerates them.

61. **Swept every gate for the exclusion shape that broke `check:absence`. Nine
    of ninety-seven carry one; one was hiding forty-three documents.** —
    devex-tooling-engineer. 2026-08-24, the generalisation of row 60.
    Row 60's defect was not really about absence checking. It was: a checker that
    cannot see part of its subject does not report uncertainty about that part,
    it reports confidence about the rest. So every gate carrying an exclusion is
    a candidate. Ninety-seven scripts scanned for git pathspec negations and
    named SKIP/EXCLUDE/IGNORE lists; NINE carry one.
    EIGHT ARE LEGITIMATE and were confirmed by reading, not assumed: they skip
    `node_modules`, `dist`, `build`, `coverage`, `third_party`, `.git` — build
    output and vendored code, which are not those gates' subject. That includes
    `check-nan-fail-open.mjs`, written earlier the same day, which was checked
    precisely because it was recent and mine.
    THE NINTH WAS REAL. `check-accuracy-doctrine.mjs` excluded `^docs/research/`
    with no reason recorded anywhere — while its own SCOPE note says "first-party
    documents only" and separately handles vendored text. `docs/research/` holds
    43 FIRST-PARTY documents: the competitive briefs, the buyer/partner readiness
    pack, the outreach copy. Prose that asserts things about the outside world is
    exactly what an accuracy gate is for, and it was the prose the gate could not
    see.
    MEASURED BEFORE CHANGED, and the measurement decided it: including the tree
    took the scan from 236 documents to 279 and produced ZERO new violations. The
    exclusion cost forty-three documents of coverage and bought nothing, so it is
    gone. `docs/inspiration/` stays excluded — imported reference catalogues this
    repository does not assert, and those files say so themselves — but the
    reason is now written down, which it was not.
    NOTE THE OPPOSITE OUTCOME ON THE SAME AFTERNOON. Row 57 measured a candidate
    absence-claim gate, found its patterns matched 54 lines of correct safety
    prose, and did not build it. Row 61 measured a candidate exclusion removal,
    found zero cost, and made it. Same discipline, opposite answers — which is
    the argument for measuring rather than for having a policy about exclusions.
    BOTH DIRECTIONS ARE NOW SELF-TESTED AND WATCHED TO FAIL: re-excluding
    `docs/research/` exits 1, and scanning `docs/inspiration/` exits 1. Coverage
    can no longer shrink quietly, because a gate that scans less still prints
    that it passed — which is how this survived unnoticed in the first place.
    CORRECTED AGAIN 2026-08-24, and the qualification above was itself wrong.
    It said `docs/research/COMPETITIVE_IMPRIVATA.md:21` carries "five bare
    external figures ... and the gate flags none of them. Coverage without
    detection." Both halves fail on inspection.
    THEY ARE NOT BARE. The file carries 28 anchored sources in a `## Sources`
    section, hedges every figure with `~`, and CAVEATS the revenue number
    explicitly — "from sale-process reporting; a getLatka $130M figure appears
    stale and is not relied upon". That is the DR-015 discipline done properly,
    and calling it bare was a slander on prose more careful than the gate.
    THEY ARE NOT EXTERNAL STATISTICS BY THE GATE'S DEFINITION. Tested, not
    assumed: all five were run against `EXTERNAL_STAT` and NONE matches any of
    its three arms. `~47% of customers` misses because `customers` is not in the
    noun list; `~$500M revenue` misses because `revenue` is not
    market/TAM/opportunity/industry. The rule targets marketing-shaped claims,
    and vendor facts in a competitive brief sit outside that target by design.
    So "zero violations" here means the prose is OUT OF SCOPE, which is a third
    thing — neither "clean" nor "unreachable". The lesson is the one this
    cluster keeps relearning: I measured that the gate did not flag them and
    concluded it could not see them.
    A SECONDARY MISMATCH, real but not a defect: the discharge accepts
    `https?://`, and ZERO of the six `COMPETITIVE_*.md` files use a scheme —
    all cite bare domain-paths. Sources also sit at the FOOT, outside the
    same-BLOCK rule, and figures hedge with `~` where the regex wants the word
    "approximately". Three mechanical reasons a URL discharge could never fire
    in that tree. Whether to teach the gate this convention is
    competitive-analyst's call; nothing is wrong with the documents.
    That is the same defect class as everything else in this cluster, committed
    while writing about the defect class: a measurement that was accurate and
    answered a different question than the one it was used to support. The scan
    genuinely covers 279 documents now, and that is still worth having; it simply
    does not license the sentence "and the prose is clean".
    NOT WIDENED HERE, deliberately. Whether those figures are violations is a
    judgement, not a mechanical fact: the file's own header says every claim is
    anchored to a URL in its Sources section, so the convention in `docs/research/`
    may be to cite at the foot rather than in the block — which is precisely what
    the gate's same-BLOCK rule cannot see. Widening `EXTERNAL_STAT` or relaxing
    the block rule across 43 research documents is a real design change with a
    real blast radius, and this cluster's own lesson is to MEASURE that before
    building. Owner of the measurement: competitive-analyst for whether the
    convention is sound, devex-tooling-engineer for the rule if it is not.

62. **Two of three "deliberate redundancy" guards in the decision core were
    load-bearing and unproven — and the comment saying otherwise was the
    reason nobody looked.** — devex-tooling-engineer (the proof) +
    principal-engineer (the design call). FIXED 2026-08-24.
    The daily mutation sweep had been failing since `a50f6e7`. Read the JOBS,
    not the run: the image-vulnerability gate that owned issue #245 was SUCCESS
    (so #245 closed), daily verification was SUCCESS, and the failing job was
    the sweep. Three mutations survived in `lib/signalgrid-core/src/continuity.ts`.
    THE PROOF'S OWN HEADER ALREADY EXPLAINED THEM: "there are now TWO guards ...
    Reverting EITHER one alone leaves these assertions green (72/72); reverting
    BOTH drops seven ... That is deliberate defense in depth." True for the
    `reconcileDecisions` path. Generalised to the whole module, and wrong twice.
    MEASURED ONE GUARD AT A TIME rather than reasoned about:
    · `:384` validateRecord Set membership — disabled ALONE, all four probes
      still refused. GENUINE defense in depth; `:116` catches them downstream.
    · `:116` mostRestrictiveOutcome self-check — disabled ALONE, a direct call
      with an unknown outcome GETS THROUGH. The function is EXPORTED, so that is
      its own entry point and `:116` is the only guard on it. An unknown outcome
      reaching the ranking table compares as NaN and STICKS as the accumulator —
      the same fail-open family as the ten timestamp sites fixed the same week.
    · `:443` standingBound.floor — disabled ALONE, an invalid floor on a
      WITHIN-BOUND record passes silently. In plain terms: a caller who typed
      "denied" instead of "deny" gets no error and no floor. The safety floor
      they asked for does not exist.
    WHY THE EXISTING FLOOR ASSERTION NEVER CAUGHT IT: it uses a shape that
    EXCEEDS the bound, so the bad value reaches `:116` and is refused there. The
    assertion passed with `:443` disabled — it was testing a different guard than
    the one it names. The full proof stayed 72/72 with the floor check gone.
    FIXED with assertions aimed at the path where nothing else can refuse first:
    `mostRestrictiveOutcome` called directly with an unknown outcome and with a
    prototype key, and an unknown floor on a within-bound record. 72/72 to 75/75.
    Falsified: `:116` disabled now drops it to 73/75, `:443` to 74/75, and `:384`
    still passes at 75/75 — which is the measurement that earns `:384` an
    allowlist entry rather than an assertion. That entry states what was
    measured, that it is the only redundant one of the three, and the condition
    that should delete it.
    A SECOND INCIDENT, recorded because it nearly shipped a defect. The sweep was
    re-run locally under a 1200s timeout that was too short; it took SIGTERM
    mid-run and LEFT A PLANTED MUTATION in the tree —
    `passkey-assurance/evaluate.ts`, `report.registration === "registered"`
    rewritten to `true`, which would let an unregistered credential satisfy the
    assurance check. The push chain refused to run preflight on a dirty tree and
    exited rather than validate a poisoned one; the file was restored and the
    tree verified clean before anything was pushed. THE LESSON IS THE TIMEOUT:
    a mutation sweep mutates files IN PLACE and only restores them on a clean
    exit, so killing one is not a neutral act. Anything that runs it must either
    let it finish or restore from git afterwards.

63. **The public review hub is not the site this repo builds, and the gate that
    guards buyer-facing copy had never read it.** — web-engineer (the copy) +
    OWNER (the Pages setting, which only he can see or change). 2026-08-24,
    found because the owner asked whether the published site needed reviewing.
    FETCHED, not inferred. https://danfashauer.github.io/SignalGrid-Review-Hub/
    returns 200 and serves `README.md` rendered by Jekyll's DEFAULT THEME: the
    stock `assets/css/style.css`, a `<title>` in Jekyll's "Page | Repo" form,
    ZERO Vite fingerprints, and a body that is README verbatim. The Vite
    marketing site in `artifacts/signalgrid-web` — the thing `pages.yml` builds
    — is not what that URL serves.
    `pages.yml` HAS run: twelve times, last SUCCEEDING 2026-08-12. So the
    workflow works and something else determines what Pages actually publishes.
    WHAT I COULD NOT VERIFY, stated rather than guessed: the Pages source
    setting. `GET /repos/.../pages` returns 403 at this lane's proxy — "Access
    to this GitHub API path is not permitted" — so whether Pages is set to
    "Deploy from a branch" (which would explain Jekyll) or to GitHub Actions
    with a stale active deployment CANNOT be determined from here. That is an
    owner action: Settings -> Pages, check Source. Everything else in this row
    is measured from the bytes the URL actually returned.
    THE GATE WAS ACCURATE ABOUT THE WRONG DEPLOYMENT. check-launch-claims.mjs
    is carefully built — it DERIVES the published page set from `pages.yml`
    rather than hand-listing it, and refuses to "silently scan less" at three
    separate points. Every one of those derivations answers "what would the
    deploy workflow publish", and none answers "what does the site serve". The
    same shape as every other defect in this cluster, at the outermost layer:
    an accurate measurement answering a different question.
    WHAT WAS LIVE. Running the gate's own rules against README.md returned a
    real violation — `README.md:80`, the deferred-capability noun "RTLS" with no
    hedge in its block, in a sentence saying the simulator shows how those
    signals "fit together". `location` is a DEFERRED signal kind (row 51a).
    Confirmed present in the fetched HTML, not just the source.
    The opening sentence also read "Operational Trust Orchestration platform",
    the label DR-004 retired. DR-004 is the owner's own instruction: "lock the
    site to the ratified Shared-Device Trust Gateway scope; and add a gate so
    marketing cannot drift beyond implemented capability again." The gate was
    added a month ago and could not see the site it was added for.
    FIXED: README's opening claim now leads with the ratified label and cites
    DR-004; the RTLS mention is hedged as roadmap with a pointer to
    LAUNCH_PROFILE.md; and the gate now scans README.md as the landing page.
    NAMED, NOT DERIVED, and the header says why — which files Pages serves is a
    repository SETTING, not a fact in this tree, and the API that would answer
    it is blocked, so inventing a derivation from a source that cannot see the
    answer would be worse than an explicit name. Missing README now FAILS the
    gate rather than shrinking its coverage.
    FALSIFIED BOTH WAYS: restoring the exact unhedged sentence that was live
    exits 1 naming `README.md:80`; pointing LANDING_PAGE at a missing file exits
    1 rather than scanning less. Coverage went from 19 files to 96.
    STILL OPEN. Whether `docs/OPERATIONAL_TRUST_ORCHESTRATION.md` — a whole
    category-definition document — survives DR-004's ratification is
    positioning-messaging's call, not this row's. It was left alone
    deliberately: retiring a label in a buyer-facing sentence is copy work;
    retiring a category the repo spent a document defining is a positioning
    decision.

64. **The local stack and the production stack are not the same product, and
    nothing checks that they are.** — sre. 2026-08-24, found by actually reading
    the sre surface after the owner said roles were not reviewing their portions.
    `docker-compose.yml` runs **api + web + nginx and NO database**.
    `docker-compose.prod.yml` runs **db + api**, with the API exposed DIRECTLY
    on 8080 and zero nginx mentions in the file. Neither stack is the other.
    Every routing rule, path prefix and forwarded header exercised through the
    local proxy tier is ABSENT in production; every database behaviour proven in
    prod is absent locally. `docs/RUN_AND_GO_LIVE.md` never mentions nginx.
    WHY IT MATTERS BEYOND TIDINESS. `check-deployment-runbook.mjs` exists
    precisely to keep "the documented path" and "the real one" in agreement, and
    the CI job named "Prod stack (Docker compose smoke)" reads as though it
    validates what ships. Nothing compares the two compose topologies to each
    other, so the shape "the thing you test is not the thing you ship" is
    unguarded in the one place it is easiest to gate.
    TWO SMALLER FINDINGS in the same read, both LOCAL-ONLY and recorded so they
    are not rediscovered as new:
    · `nginx_certs` is mounted at `/etc/nginx/certs` and NOTHING reads it —
      `nginx.conf` has `listen 80` only and no `ssl_certificate` directive. A
      TLS volume wired in and consumed by nothing is the same shape as the
      `tenant:admin` precedent this repo was founded on: a control that reads as
      protection and is not.
    · `X-Forwarded-Proto` and `X-Forwarded-For` are set only on `/api/`. `/app/`
      and `/` set `X-Real-IP` alone, so anything behind them cannot learn the
      original scheme. Moot in prod, which has no proxy — which is finding 1.
    MOSTLY WITHDRAWN 2026-08-24, by the solutions-architect read of its OWN
    surface — the one this row should have started from. The measured facts above
    are all still true. The DIAGNOSIS was wrong: this is not an undocumented
    divergence that nothing accounts for. Both halves are documented, deliberate
    choices, in `docs/DEPLOYMENT.md` — a file this row never cites because I read
    `docker-compose*.yml` and `RUN_AND_GO_LIVE.md` and never opened it.
    · **The missing proxy in prod is scoped out on purpose.**
      `docs/DEPLOYMENT.md:311-315`, under "Not included here (needs your
      infrastructure)", names "TLS termination / a reverse proxy" among the
      concerns "owned by whoever operates the stack". The prod compose file
      exposing the API directly on 8080 is the documented contract, not an
      oversight, and the repo's `nginx.conf` is a local convenience whose rules
      were never meant to be a production contract.
    · **The missing database locally is also documented.**
      `docs/DEPLOYMENT.md:34-43` states durable persistence is "gated on
      `DATABASE_URL`", and that unset means in-memory — "the fixture-safe default
      used by the public build and CI". A local stack with no database is that
      default working as designed.
    WHAT SURVIVES: only the two smaller local-only nginx findings above. Nothing
    else.
    I FIRST WROTE, IN THIS SAME CORRECTION, that one thing survived — "nothing in
    either compose file SAYS it is one of two different intended deployments" —
    and then opened the files. Both already carry exactly that header.
    `docker-compose.yml`: "Local delivery topology ... The product is the
    deterministic, in-memory /v1 core — no database is required. nginx (reverse
    proxy) → api (/api) + web (/, /app)". `docker-compose.prod.yml`:
    "Production-shaped topology: the SignalGrid API with DURABLE Postgres
    persistence." A reader opening either file alone is told precisely which
    deployment it is and why. That claim is withdrawn too — asserted, again,
    without reading the file it was about.
    So the row's proposed gate is withdrawn as well: a topology-comparison gate
    would have failed the build over a difference `docs/DEPLOYMENT.md`
    deliberately licenses and both compose headers already explain.
    WHY THIS CORRECTION IS ITSELF THE LESSON. The row was written from the
    compose files plus the one doc that happened not to answer the question, and
    it concluded ABSENCE from a narrow read — the identical shape to the
    device-attestation error external review caught on PR #299 the same day, and
    to the `check:absence` fail-open recorded earlier. Three instances now, one
    session. Reading the surface you own BEFORE filing against it is the control,
    and it is the reason the coverage ledger exists.
    NOT FIXED HERE, deliberately. Whether prod SHOULD gain a proxy, or the local
    stack should lose one, is an architecture call with real consequences for
    TLS termination and the `/api` prefix the clients already use. Recording the
    divergence is this role's job; choosing the topology is solutions-architect's
    with principal-engineer, and it wants a decision record rather than a commit.
    THE POINT OF THE ROW, beyond its own content: this is the first finding in
    the repository produced by a role reading its declared surface end to end
    rather than by a gate shouting. It took twenty-two files, four of which are
    now recorded in the coverage ledger at the depth actually reached — a
    property scan across fifteen workflows is NOT a read and is not claimed.

65. **The ungated-fetch gate could not see an exported function, and passed with
    a planted ungated `fetch` in an ENFORCED directory.** — FIXED 2026-08-24,
    found by reading the itsm surface after the owner said roles were not
    reviewing their portions. `check-ungated-fetch.mjs` walked back from each
    `fetch` site to the enclosing declaration and then dropped everything that
    was not a CLASS METHOD (`if (start === -1 || !isClassMethod) continue`). Its
    own comment gave the reason for that scope as external callability — a
    method "is externally callable on a constructed adapter, so nothing stands
    between a caller and the network". An EXPORTED top-level function has
    exactly that property: `itsm/index.ts` re-exports it. It was neither gated
    nor counted in the unaudited remainder — invisible, not deferred.
    EVIDENCE. Appending
    `export async function plantedUngated(u: string) { return fetch(u, { method: "POST" }); }`
    to `lib/integrations/src/integrations/itsm/zendesk.ts` — itsm/ is one of the
    four directories where a finding FAILS the build — left the gate GREEN,
    exit 0. This is the session's recurring defect class once more: a
    measurement that was accurate about a real property and answered a different
    question than the one its own comment asked.
    WHY THE OBVIOUS FIX IS WRONG. Admitting every exported function re-opens the
    false-positive flood the gate's first draft died of: ~25
    `makeDefault*Transport(...)` factories that ARE gated one level up by the
    `resolve*Connector` calling them. Measured, not assumed — the naive widening
    flagged 25 of them plus one hard failure. The gate's own comment records why
    that matters: "A gate that cries wolf gets switched off, and a switched-off
    gate is worse than none because the policy still reads as enforced."
    THE FIX, verified rather than trusted, in the same shape as the two clearing
    rules already present. An exported top-level function is in scope; it clears
    only if it carries its own gate token, or if EVERY call site of it — in its
    own file or its family's `index.ts` — sits inside a function whose body
    carries one. Fail-closed twice: a function with NO call site does not clear
    (nothing local gates it, so its only caller is outside the family — the
    planted hole), and one ungated site among many gated ones does not clear.
    Non-exported top-level functions stay OUT of scope; they are internal
    plumbing, and flagging them is the original false positive.
    RESULT. Clean tree: zero findings, zero unaudited — all 25 factories cleared
    automatically, including `device-management-health/graph-transport.ts`, whose
    resolver lives one file over and is reached via the family index.ts source.
    Planted defect: exit 1. Non-exported equivalent: exit 0. Self-gated export:
    exit 0.
    LOCKED DOWN. The gate had NO self-test — which is how this survived. It now
    has one (9/9), with the planted defect kept permanently as fixture 1, and
    registered in both preflight and CI. Sabotaging the discriminator drops it
    to 4/9, so the self-test is watched failing rather than assumed to work.

66. **The ITSM credential store derived its AES-256 key by truncate-and-pad, and
    nothing had ever tested it.** — FIXED 2026-08-24, found by reading the itsm
    surface. `getEncryptionKey()` built the key as
    `Buffer.from(encryptionKey.slice(0, 32).padEnd(32, '0'))`. Accurate about
    producing 32 bytes, and answering a different question than the one being
    asked — whether those are 32 bytes of ENTROPY. Two silent losses:
    `ITSM_ENCRYPTION_KEY=secret` became `secret` plus 26 literal zero bytes, an
    AES-256 key with roughly 48 bits behind it; and a 64-hex-character secret,
    the natural way to express 32 bytes, was cut to its first 32 characters —
    16 bytes of entropy — and reported success. A short key was STRETCHED rather
    than refused, which inverts fail-closed doctrine: an under-specified input
    must tighten the answer, never pad itself into looking adequate.
    IT WAS AN OUTLIER, NOT THE HOUSE PATTERN. `webhooks/store.ts`, the sibling
    store in the SAME package, already derived with `createHash('sha256')`. Two
    stores, one package, two answers to the same question — and the weaker one
    held vendor API tokens.
    ZERO COVERAGE. This was the only `createCipheriv` site in the repository and
    nothing exercised it. `itsm-template-proof` covers the template half of the
    same module and never touches encrypt/decrypt.
    SEVERITY, STATED HONESTLY: LATENT, NOT LIVE. The config half of this store is
    wired to nothing — no api-server route reaches it, and `itsm/index.ts`
    deliberately exports only resolve+adapter. No stored ciphertext exists, which
    is also why changing the derivation needs no migration.
    THE FIX. SHA-256 derivation matching the sibling, plus a 32-character floor
    that THROWS instead of padding. `IV_LENGTH` also moves 16 → 12, GCM's
    standard nonce length (NIST SP 800-38D 5.2.1.1); `decrypt()` reads the IV out
    of the payload rather than assuming the constant, so the write-side change
    leaves previously written payloads readable.
    LOCKED DOWN. `proof:itsm-credential-crypto` — 20 checks, the encryption
    path's first test of any kind, registered in preflight and CI. Verified
    falsifiable: against the pre-fix implementation it fails 5 checks, including
    the one that matters most (two 64-char secrets sharing their first 32
    characters must derive DIFFERENT keys). A sixth check was written, passed
    against the broken code too, and was DELETED rather than kept — padding only
    appears for a secret under 32 chars, and such a secret now throws before
    derivation is reached, so it could never fail in either direction.

67. **A gate comment said two families were "STILL NOT ENFORCED" directly above
    the line that made them fatal — and contradicted itself in the same block.**
    — FIXED 2026-08-24, found while re-reading `check-ungated-fetch.mjs` during
    the row 65 work. The block listed, as ENFORCED, "EVERY outbound method under
    itsm/, siem/ and telemetry/", then said seven lines later: "STILL NOT
    ENFORCED ... the telemetry/ and passkey-assurance methods ... they stay
    visible here" — i.e. reported, not fatal. The next line read
    `const enforcedDir = /\/(itsm|siem|telemetry|passkey-assurance)\//.test(file)`,
    routing BOTH into the fatal list. So the comment contradicted the code
    beneath it AND its own preceding bullet, and the "not enforced" remainder it
    described has been EMPTY on a clean tree.
    WHY IT MATTERS. Nothing reads English. Anyone auditing the live-call boundary
    from this comment would conclude two connector families were an open,
    deferred gap and go looking for work that was already done — or, worse,
    trust that a deferral existed where the build actually fails. This is the
    prose-claim defect class the reviewer checklist names: "No gate reads
    English. Is the sentence true today?"
    WHAT ACTUALLY RESOLVED THE ORIGINAL CONCERN, now recorded where the stale
    claim was: telemetry/ and passkey-assurance methods genuinely ARE
    mode-polymorphic — the same method serves fixture transports in proofs — so
    an in-method `mode !== "live"` throw would break a fixture path it
    legitimately serves. That was answered by making the CLEARING rules smarter
    (the isEnabled() chokepoint check and the transport-injection check, both
    verifying that the gate one level up is real) rather than by exempting the
    directories. Fatal enforcement and working fixture paths, both.
    LOCKED DOWN, so the list cannot drift into prose again. `ENFORCED_DIRS` is
    now a named array; the regex is BUILT from it, the run PRINTS it
    ("enforced dirs (a finding FAILS): itsm, siem, telemetry, passkey-assurance"),
    and the unaudited banner interpolates it instead of restating it. Three
    self-test checks pin the derivation, including that an empty list would be
    caught — an empty ENFORCED_DIRS would silently turn every finding advisory.
    VERIFIED, not asserted: planting an exported ungated fetch in `itsm/` exits 1,
    and planting one in `telemetry/` also exits 1. The corrected sentence is
    demonstrated by the gate's own behaviour.

68. **The Fleet posture cache was WRITE-ONLY, and would have served stale device
    posture forever on its default path.** — FIXED 2026-08-24, found by reading
    the endpoint-uem-domain surface. `getPostureForHost()` ended
    `return inMemoryPosture.get(key) ?? null` — the cached entry, with no expiry
    check. `expiresAt` was computed on write, stored, and read by NOTHING: two
    write sites, zero readers, repository-wide.
    THE ASYMMETRY IS THE POINT. Redis expires its own keys via `EX`, so that half
    was covered by the server. The IN-MEMORY half is the default path whenever
    `REDIS_URL` is unset AND the fallback whenever Redis throws — and it would
    hand back posture whose `expiresAt` was long past, as though current. Stale
    device posture must TIGHTEN the answer, never be served as current.
    SEVERITY, STATED HONESTLY: the write is LIVE, the read is DEAD.
    `setPostureForHost` runs on every Fleet posture fetch
    (`fleetdm.ts:270`, 300s TTL), but the store's `getPostureForHost` has no
    caller — the identically-named method on `FleetDMAdapter` is a different
    function and does not read the cache. So nothing is being served stale TODAY;
    what existed was a trap armed for whoever wired up the read, who would reach
    for the obvious getter and receive indefinitely stale posture.
    SECOND DEFECT, SAME FAMILY: the Map never pruned. One entry per host UUID on
    every fetch, emptied only by an explicit `clearPostureCache()`, so a
    long-running process polling a fleet grew it without bound.
    THE FIX. `getPostureForHost` honours `expiresAt` on both paths and EVICTS the
    entry it finds expired; `purgeExpiredPosture()` sweeps on write, which is the
    path that actually runs. Fail-closed on anything unestablishable: malformed
    JSON, a missing `expiresAt`, a non-numeric one, and NaN/Infinity all read as
    "no cached posture", which forces a fresh fetch.
    THE NaN ARM IS NOT HYPOTHETICAL. `NaN <= now` evaluates FALSE, so a bare
    `entry.expiresAt <= now` would have reported a NaN expiry as STILL VALID and
    served it forever — the same fail-open family already fixed on auth expiry in
    this repository. Closed by requiring `Number.isFinite`, not by comparing and
    hoping.
    LOCKED DOWN. `proof:telemetry-posture-cache` — 21 checks, registered in
    preflight and CI, with `now` injected so expiry is driven deterministically
    rather than by sleeping. Verified falsifiable three ways: reverting the read
    fails 2 checks, and removing the write-path sweep fails the check written
    specifically to pin it — because asserting a purge function WORKS is not the
    same claim as asserting it RUNS.

69. **The reviewer's evidence log was empty while the reviewer role was
    running.** — FIXED 2026-08-24, found by reading the records-archivist
    surface (`docs/agent/**`). `docs/agent/EVIDENCE.md` sat at its seeded
    2026-08-22 template: 14 lines, a format spec, and the sentence "the first
    review writes the first entry". No review had. It is one of the
    signalgrid-reviewer role's only TWO write paths, and it was the one with
    nothing watching it — `FALSE_CLAIMS.json`, the other, is enforced by
    `check-known-false-claims.mjs`, which re-verifies every refutation against
    the tree and scans 442 documents for re-assertions.
    WHY IT MATTERS, and it is the owner's complaint exactly. Without it, a
    finding is only as durable as the pull request that carried it. The log is
    what makes a claim independently RE-CHECKABLE — claim, exact command,
    verbatim output — by the owner or by a session with no memory of this one.
    THE FIX IS THE RECORD ITSELF. Seven entries (this row first said EIGHT — see
    the correction at the end of the row), covering every verification
    behind rows 65-68 with the command and its real output: the planted ungated
    fetch that left the gate green at exit 0; the same plant exiting 1 after the
    fix, plus the two controls that prove it did not simply widen; the
    "STILL NOT ENFORCED" comment shown against the line that enforces; the
    key-derivation proof failing 5 checks pre-fix; the posture-cache proof
    failing 2.
    THREE ENTRIES RECORD MY OWN CLAIMS AS REFUTED, deliberately. The
    attestation reason codes that grep said were unasserted (the proof asserts on
    posture/action instead), the two branches whose codes looked unpinned
    (swapping them kills the proof), and credential-exposure's severity handling
    (folded into `highValue` at normalization). All three share one shape —
    reading an evaluator in isolation and assuming its input was raw — and
    writing them down is how the next session stops re-raising them.
    ALSO RECORDED: an explicit NOT VERIFIED HERE section — iOS/Swift (no Xcode),
    `validate-sim-macos.sh` on real macOS, and the Pages source setting, whose
    REST call 403s through this environment's proxy so the conclusion came from
    served artifacts rather than the API.
    LOCKED DOWN, as a REPORT rather than a gate. `check-known-false-claims.mjs`
    now prints the entry count and newest date on every run, and says so loudly
    when the log is empty or missing. Not gated, because entry COUNT is a real
    number but "did this session's reviews get written up" is a judgement, and a
    gate on it is satisfied by one junk entry. Both warning arms were falsified
    by reproducing the exact state the file was in.
    A BUG IN THE REPORTER ITSELF, caught and fixed before commit: the first
    version wrapped the read in a blanket `try/catch`, so a `ReferenceError`
    from a wrong variable name was reported as "the file is missing" — the
    reporter's own fail-open, the same defect class as the four above. The catch
    is now narrowed to an `existsSync` check.
    CORRECTED 2026-08-24, after external review (Codex) on PR #299 raised THREE
    findings against this very work. All three were verified against the tree and
    all three were right. The row is amended rather than rewritten, because a
    correction that hides what it corrected teaches nothing.
    · **One evidence entry stated the wrong MECHANISM.** It said the
      device-attestation proof "asserts on posture/recommendedAction/
      criticalFindings, not on the code strings". FALSE:
      `device-attestation-proof.ts:72` reads
      `v.reasonCode === spec.expected.reasonCode`, and
      `scripts/fixtures/device-attestation/devices.json:22,27` pin both codes the
      mutation swapped. The mutation dies because the codes are FIXTURE-BACKED.
      The conclusion (not a defect) was right and the reasoning was wrong, which
      in an evidence log is the part that matters — it teaches the next reader a
      false thing about where coverage comes from. Worse, line 72 was IN MY OWN
      GREP OUTPUT earlier in the session and I wrote the opposite. The reason the
      original grep found nothing is now recorded exactly: the codes live only in
      `scripts/fixtures/`, and I searched `scripts/src` — a narrow search over
      the wrong subtree, which is precisely what `pnpm run check:absence` exists
      to prevent and which I did not run before asserting absence.
    · **The entry count was inflated, by the session's own defect class.** The
      reporter matched `^## <date> — ` and nothing else, so the
      `NOT VERIFIED HERE` section — no claim, no command, no verdict — counted as
      an entry and made the number 8. A measurement accurate about a real
      property (dated headings) answering a different question than the one asked
      (complete, reproducible records). It now parses STRUCTURE, requiring
      Command/Output/Verdict, reports incomplete headings by name and by which
      field is missing, and carries 7 new self-test checks (21/21 total). The
      section is also re-headed so it no longer looks like a record.
    · **Entry 2 gave no reproducible command.** "same plant, then two controls"
      supplied neither the shell commands nor the fixture edits, in a file whose
      whole contract is exact-command/verbatim-output. Both controls now carry
      their full command block.
    THE LESSON IS THE ROW'S REAL CONTENT. A log written to make findings
    re-checkable shipped with an unreproducible entry, an inflated count, and a
    false explanation. It took an outside reader to catch all three, on the very
    change that argued for outside-checkable evidence.
    NOT FILED AS A DEFECT: `CONTINUITY.md`, also still an empty seeded template.
    It is self-described as a BUFFER that should be empty once its content has
    landed in real documents, and this session's did — in these rows, the review
    ledger, and a lane message. An empty buffer is its correct resting state; an
    empty evidence log is not.

70. **A deployed surface was handing every visitor's IP to Google, behind a
    green gate that said it was not.** — FIXED 2026-08-24 (the shipped half),
    found by the first `web-engineer` read of two apps that until that day had no
    owner. `review-invariants.mjs` printed "no third-party vendor host in any
    published web artifact" while scanning `artifacts/signalgrid-web/` plus
    `docs/*.html` and `site/*.html` — 19 files. SIX files in five other web trees
    carried `fonts.googleapis.com`, and the gate saw none of them. Its scope
    answered a narrower question than the sentence it printed.
    THE ONE THAT WAS SERVED: `artifacts/signalgrid-app` — `Dockerfile.web:58`
    copies its build to `/usr/share/nginx/html/app/`. A deployed console fetching
    fonts from a third party on every load, which is a privacy fact about
    visitors, not a style preference.
    FIXED by replicating what `signalgrid-web` already did: `@fontsource/inter`
    and `@fontsource/ibm-plex-mono`, the same seven faces the remote URL
    requested, imported in `main.tsx`. Verified by building: 43 `.woff2` files
    now bundled locally and `grep` finds no vendor host anywhere in `dist/`.
    SCOPE WIDENED, 19 files -> 503 across every web tree, with a GATED/REPORTED
    split that follows what is actually served. Trees `Dockerfile.web` builds are
    FATAL; demo-only trees are REPORTED loudly and not failed on, because failing
    the build over a surface nobody serves is how a gate gets switched off — which
    is how this one lost its scope to begin with.
    THE WIDENED GATE IMMEDIATELY CAUGHT ITS OWN AUTHOR. My explanatory comment in
    `main.tsx` contained the literal hostname, and the gate flagged it. The gate
    matches a literal string and does not parse comments; for a security check
    that is correct fail-closed behaviour, so the COMMENT was reworded rather than
    the gate weakened.
    STILL OPEN — web-engineer: three demo-only trees still load remote fonts and
    are reported on every run: `signalgrid-review`, `signalgrid-mobile-pwa`,
    `signalgrid-desktop`. Same fix, already proven twice.
    RE-COUNTED 2026-09-02: this row said **four** and named `mockup-sandbox`, which
    Ponytail cut 3 (DR-024) deleted — an open row naming a tree that no longer
    exists reads as work outstanding that is not. Re-derived rather than reasoned:
    `grep -rln "fonts.googleapis\|fonts.gstatic" artifacts/signalgrid-*` returns
    `signalgrid-review/index.html`, `signalgrid-mobile-pwa/{index.html,src/index.css}`
    and `signalgrid-desktop/index.html` — three trees, four files.

71. **Five of eight security reference tests cannot fail against broken code.**
    — FIXED 2026-09-02 by porting and deleting; see the disposition at the foot
    of this row. Originally raised by security-engineer. Found by the first `security-engineer` read of
    `tests/security-reference/**`, assigned to that role only on 2026-08-24, and
    INDEPENDENTLY VALIDATED by a second agent that re-derived every claim from
    source and was asked to refute them.
    · `webhook-signing.test.ts` — all four cases compute an HMAC locally and
      compare it to a second local HMAC. No application module is imported. It
      tests that Node's `crypto` is internally consistent.
    · `secret-redaction.test.ts:60-68` — asserts a hardcoded literal containing
      "Bearer" contains "Bearer". No redaction utility is invoked.
    · `rate-limit.test.ts:53-61` — the pass condition is a disjunction that
      includes `statusCodes.every(s => s === 200)`, so a limiter that does nothing
      satisfies it.
    · `rate-limit.test.ts:74-95` — computes `hasRateLimitHeader` and never
      asserts on it; the only `expect` checks a status code, despite the name.
    · `replay-attack.test.ts:23-48` — the only real assertion sits inside
      `if (firstResponse.ok)`, and no request carries auth.
    · `stepup-enforcement.test.ts` — asserts only that UNAUTHENTICATED access is
      rejected, never the step-up distinction its name claims.
    NOT A SILENT GAP, and this is why the row is a should-fix and not a blocker:
    `check-test-execution.mjs` already declares this whole directory unexecuted,
    with a dated reason, and that gate IS wired into preflight and CI. The specs
    were harvested from a retired DEV Next.js build whose modules do not exist
    here. The validator added a caveat the first agent missed: the three GOOD
    files cannot run here either, for a different reason — their imports do not
    resolve in this monorepo.
    THE ACTION WAS TRIAGE, NOT REPAIR, and the triage is now done — by porting
    the INVARIANTS onto the live surface rather than the FILES, which is what
    made the tautologies harmless: every ported assertion was falsified once
    against the real tree before being kept.
    · Ported to `artifacts/api-server/test/api.test.mjs` (346 → 363 assertions):
      the auth boundary, DERIVED from the position of `requireTenantContext` in
      `routes/v1.ts` so all 34 guarded routes are covered rather than the 3 the
      spec hand-listed (this replaces `stepup-enforcement` and the fail-closed
      half of `webauthn-request-identity`); and wire-level secret redaction —
      no response body may echo the caller's credential or a stack frame, which
      is the assertion `secret-redaction.test.ts:60-68` only appeared to make.
    · Ported to `scripts/src/webhooks-proof.ts` (90 → 116 assertions): the
      missing-signing-secret refusal at `webhooks/dispatch.ts:247`, live code no
      lane had ever driven; its permanence branch; and real signing coverage
      against `sign.ts` — the tautology in `webhook-signing.test.ts` is answered
      by driving the repository's own `signPayload`/`createSignedHeaders` and
      cross-checking against an independent HMAC. The secret path is proven
      END TO END THROUGH THE TRANSPORT offline, with a record-and-throw `fetch`
      spy: the signature that reaches the wire is verified against the body that
      reaches the wire.
    · Already held elsewhere, verified by citation rather than by name:
      `replay-attack` (idempotency, api.test.mjs), `rate-limit` (api.test.mjs),
      `admin-auth-hardening` (`"unknown token is 401"`), and the ITSM
      encryption-key block (`proof:itsm-credential-crypto`).
    · NOT ported, deliberately: `fail-closed-fallbacks` block 1 (`checkApiKey`,
      `ADMIN_API_KEY`). Neither symbol exists anywhere in this repository, so
      there is no surface to hold the invariant. Deleted rather than carried.
    The directory is gone. `check-test-execution.mjs` now enforces the reverse
    direction it always claimed — a DECLARED_UNEXECUTED key matching no file is
    fatal — which is what a stale exemption for this directory would have been.

72. **The org published four of its own agent definitions under another author's
    MIT grant, and told a re-vendor operator to overwrite five first-party
    skills.** — FIXED 2026-08-24 by the first audit of `.claude/`, a directory
    that until that day belonged to no role.
    · `publication-boundary.mjs` classed all of `.claude/agents` as
      `third_party_intake` under "MIT (c) 2026 Affaan Mustafa". NINE of thirteen
      are byte-identical to the vendored source; FOUR are first-party
      (`fail-closed-auditor`, `gate-and-proof-engineer`, `verdict-core-reader`,
      `agent-platform-steward`) — verified by `cmp` against
      `third_party/everything-claude-code/agents/`. In a PUBLIC repository this
      attributed this company's work to someone else. Carve-outs added.
    · `.claude/skills/VENDORED.md` said `owner-comms` was the ONE first-party
      skill and "everything else below describes the other 14". True when written
      on 2026-08-20; the five `signalgrid-*` skills landed on 08-22 in `fa0e32e`
      and nothing updated it. A re-vendor operator following it literally would
      have destroyed the skills defining four of the org's executors. Now names
      all six, with authored dates and what each defines.
    THE GATE PASSED THROUGHOUT, because it audits COVERAGE — is every path
    classified — and never the truth of the `reason` text. No gate reads English.

73. **What the first audit of the instruction layer found, and who owns each.**
    — OPEN. `.claude/`, `CLAUDE.md` and `AGENTS.md` had never been reviewed by
    anyone because no role owned them. Each item names its role.
    · agent-platform-engineer: `.agents/agent_assets_metadata.toml` is 100% of
      that surface and both its entries point at images that do not exist
      (verified five ways, including `find` and `git ls-files`). Nothing in the
      repo reads the file. Delete it or restore the images. RE-VERIFIED
      2026-09-05 (sixth audit round): still both entries, still no such
      images (`git ls-files | grep -i architecture.png` empty), still no
      reader. The images cannot be restored — they never existed in the
      tree — so deletion is the only closing move, and it is the OWNER's: the
      cloud lane's permission classifier refuses tracked-file deletion.
      Remove `.agents/` and the `.agents/**` lines in
      `docs/agent/org-roster.json`, `docs/agent/agent-tiers.json` and
      `.claude/agents/agent-platform-steward.md` in the same commit.
    · agent-platform-engineer [half CLOSED 2026-09-06: the proof count is now 144, dated; "~1,800 files" still stands against 2,306 tracked]: `signalgrid/SKILL.md:197` says "~1,800 files,
      ~131 proofs"; the tree has 2,328 and 139. A fossil inside a bullet whose
      argument is that surface area is a cost.
    · agent-platform-engineer: `signalgrid-scribe` and `signalgrid-reviewer` BOTH
      name `docs/agent/FALSE_CLAIMS.json` as a write path, and `records-archivist`
      owns `docs/agent/**` on top. Two lanes editing one registry is the
      eight-file collision shape `LANE_COORDINATION.md` exists for. Decide the
      direction — reviewer appends, scribe maintains — and state it in both.
    · agent-platform-engineer [CLOSED 2026-09-06: FALSE_CLAIMS.json preflight-mirrors-three-of-six-ci-jobs; the skills point at the parity gate]: two skills list the CI jobs preflight does not
      mirror and name `secret-scan`, which is not a `review-hub-ci.yml` job at all
      (it lives in `supply-chain.yml`); the real third service-dependent job is
      `podman-stack`. The correction cited at `signalgrid/SKILL.md:95` has itself
      drifted.
    · devex-tooling-engineer [CLOSED 2026-09-05: CLAUDE.md:63 dates the old figure and says do not retype one]: `CLAUDE.md:54,63` says "roughly thirty-five
      preflight gates" are outside the harness. Parsed from `preflight.mjs`: 176
      steps, 73 proofs, ~79 distinct non-proof gates, against seven in the
      harness — the gap is ~3x what the number says, in a paragraph whose whole
      job is to stop a reader trusting harness-green.
    · devex-tooling-engineer [CLOSED 2026-09-06: the exemption is derived from VENDORED.md via scripts/lib/skill-plane.mjs; first-party skills are checked]: `check-cited-paths.mjs` skips `.claude/skills/`
      entirely as "VENDORED third-party work", which has been false for six
      directories since 08-22, so every repo path cited in the first-party skills
      is ungated. Hand-audited: only one stale citation, and it is benign.
    · devex-tooling-engineer: running `check-role-coverage.mjs` WRITES its
      ratchet, so a read-only review run dirties the tree — and
      `provenance.workingTreeClean` in `sim-results` reads `git status`.
    · security-engineer [CLOSED: org-roster.json now names lib/enterprise-auth/**]: the roster gives it `lib/api-auth/**`, which matches
      nothing (three searches). Likely meant `lib/enterprise-auth/**`. A surface
      matching no file is a coverage claim about nothing.
    · principal-engineer: `qa-engineer`'s surface is `lib/**` + api-server +
      tests — 570 files — but its executor `skill:signalgrid-reviewer` is
      forbidden to write source. Both ownership gates count those files as owned,
      so they read as covered while no writer can touch them. Either mark the
      surface review-only in the schema, or move the write half.

74. **Three of my own exclusions were "nobody owns this" wearing a different
    label.** — FIXED 2026-08-24, on the owner's instruction the same day: "if the
    reason is due to no role or skill please acquire that and assign the work."
    He was right, and it was the first thing I got wrong about the ownership gate
    I had just built. Row 70's gate reached UNOWNED: 0 partly by EXCLUDING 75
    files. Re-examined, three of those rules were not describing generated output
    at all:
    · `third_party/**` — 48 files of agents, skills, commands, rules, contexts
      and MCP configs this org EXECUTES. "Upstream owns it" is true about
      AUTHORSHIP and false about ACCOUNTABILITY: upstream does not decide whether
      it is safe for us to run, and `VENDORED.md` itself admits the vendored set
      was "surveyed, not audited". Now owned by agent-platform-engineer for
      REVIEW; its writeScope stays `.claude/`, so it still cannot edit vendored
      source in place, which is the rule CLAUDE.md already sets.
    · `attached_assets/**` — 976 lines of the OWNER'S OWN research: the
      enterprise ITSM stack with APIs, the MDM/UEM/endpoint and networking
      repo-and-SDK list, the shared-device custody architecture, and the
      PACS/IAM/mobile-credential/FIDO2 convergence thesis. "A source, not a
      maintained surface" meant nobody was accountable for MINING it. Now owned
      by solutions-architect, whose existing next action — turn
      PILOT_SCOPE_SKELETON into a concrete reference architecture — this is the
      direct input for.
    · `LICENSE` and `NOTICE` — excluded as "legal text" while
      `commercial-counsel` had existed with ZERO surfaces the entire time. Now
      owned by it, and not cosmetically: row 72 found four first-party agent
      files published under another author's MIT grant in this public repo, so
      whether NOTICE reflects what we actually vendor is a live question.
    THE STRUCTURAL FIX, so this cannot recur. Every exclusion is now
    `[glob, reason, accountableRole]`, and the gate FAILS if the named role does
    not resolve in the roster. An exclusion is a promise that somebody is still
    accountable for that ground; a promise pointing at a name nobody answers to
    is exactly the gap the gate exists to close. Falsified both ways: a rule
    naming a non-existent role fails, and a rule naming no role fails.
    WHAT LEGITIMATELY REMAINS EXCLUDED: 21 files across 11 rules, all generated
    output — sim results and requests, live evidence, lane mail, heartbeats,
    build-loop history, emulator results, vendor captures, the SBOM, scanner
    comparisons, the lockfile. Those need no READER, but each now names the role
    accountable for the retention decision and the pipeline that mints it:
    mac-lane-steward, devex-tooling-engineer, security-engineer,
    agent-platform-engineer.
    Result: owned 2,253 -> 2,307, excluded 75 files -> 21, unowned still 0.
    A RESOURCE POOL NOBODY HAD OPENED, found by this re-examination and now
    queued on agent-platform-engineer: `third_party/everything-claude-code`
    holds 13 skills, 10 commands, 10 rules and 3 contexts that have NEVER been
    activated. Among them `frontend-patterns`, which carries an Accessibility
    Patterns section — directly refuting the reason recorded in row 56 for NOT
    creating a web skill, namely that "no web a11y/brand doctrine exists to put
    in it". It existed, vendored and unopened, while accessibility-specialist sat
    at 0 of 294 files with `lane` as its executor.

75. **The pre-DR-005 deny was live in three trees at 3.14:1 — worse than the
    historic worst this repo records — one line away from the gate that rejects
    it by name.** — FIXED 2026-08-24, found by the first `accessibility-specialist`
    execution. That role had read 0 of 294 files and its executor is `lane`.
    `check-decision-palette.mjs` exits 0 with "AA everywhere". Its own self-test
    asserts it would reject `#A05A5A`, the pre-DR-005 fork of deny, and names that
    exact hex. Meanwhile `artifacts/signalgrid-{review,desktop,mobile-pwa}/src/
    index.css` each declared `--destructive: 0 28% 49%` — the identical colour,
    in the same file, a few lines from the `--decision-*` block.
    MEASURED with the gate's OWN exported `hslToHex`/`contrast`, not asserted:
    `#A05A5A` is **3.14:1 on card** and 3.52:1 on background. The AA floor DR-005
    ratifies is 4.5:1, and CLAUDE.md records 3.18:1 as the worst this system ever
    shipped. This was worse, in three of five trees, behind a green check.
    `signalgrid-web` and `signalgrid-app` had migrated to `0 43% 60.8%`
    (`#C67070`, 4.55:1 on card). Three trees never did and nothing could tell.
    THE REAL BOUNDARY WAS THE EXTRACTOR, NOT THE AUDIT. Widening the canonical
    table alone changed NOTHING — `cssBlocks()` matches
    `--(decision-…|background|card)` and simply never collected `--destructive`,
    so no comparison could ever run on it. A token the extractor does not see can
    never be wrong. `destructive` is now in that pattern.
    IN SCOPE FROM THE START: DR-005 says "do not artificially restrict where
    `deny` may be used" and already brings `--destructive-foreground` into scope.
    `--destructive` paints destructive buttons and deny-coloured chart fills. It
    was never out of scope; it was merely unextracted.
    FALSIFIED PROPERLY, on the second attempt. The first run of the falsification
    reported PASS because I grepped the output instead of checking the exit code —
    the same wrong-signal error this session keeps finding. Re-run reading `$?`:
    exit 1, `✗ ... destructive is #A05A5A, canonical is #C67070`, with the 3.14:1
    row printed beside it.
    ALSO FIXED, from the same read: `maximum-scale=1` in the viewport meta of
    `signalgrid-app`, `signalgrid-review`, `signalgrid-desktop` and
    `mockup-sandbox` blocked pinch-zoom (WCAG 1.4.4). Removed. Chrome/Android
    honours it; iOS Safari has ignored it since iOS 10 — so the impact is real but
    narrower than "everyone", and is stated that way. `signalgrid-web` and the
    mobile PWA were already clean: the one tree built for phones got it right.
    `--chart-*` IS DELIBERATELY NOT PINNED. Its semantics vary by tree — in
    mobile-pwa `--chart-4` painted `restrict`, not `deny` — so a blanket equality
    rule would assert something untrue. Left to row 76 rather than papered over
    with a gate that reads stricter than it is.

76. **What the first accessibility execution found that is still open.** — OPEN,
    accessibility-specialist. Every item below was measured, not asserted; the
    ratios were computed with the ratified gate's own arithmetic.
    · **`restrict` and `deny` are the identical pixel** in
      `signalgrid-mobile-pwa/src/pages/Overview.tsx:45-48` — 1.000:1 — in a chart
      with **no legend, no tooltip, no axis and no text of any kind**. Colour is
      the sole channel and two of four colours are one colour. WCAG 1.4.1.
      Contrast with `signalgrid-app/src/components/LiveDecisionPanel.tsx`, which
      also maps both to deny but carries text labels, so colour is redundant
      exactly as DR-005 requires — that is the reference implementation.
    · **Two dashboards paint every verdict from raw Tailwind hex** —
      `signalgrid-app` and `signalgrid-desktop` `Dashboard.tsx`. Three of the four
      hexes are already on the palette gate's blocklist; it does not fire because
      the verdict arrives as `dataKey="allow"`, a JSX attribute with no colon,
      outside its modelled shapes. `#EF4444` measures **4.26:1 on card — below
      AA** on deny. This is a second decision palette, which
      `BRAND_CONTRAST_FINDING.md` calls a worse defect than any single ratio.
    · **Zero live regions in hand-written code** across five trees, while six
      views poll every 15-30s. A new deny landing in the list is announced to
      nobody. WCAG 4.1.3.
    · **Six ARIA attributes total** across ~294 files; three trees have none.
      `PolicyCreate.tsx:278` is an icon-only delete button whose accessible name
      is empty — verified against lucide's source, which sets `aria-hidden` by
      default. It deletes a policy rule.
    · Five unlabelled form controls, hand-rolled focus rings at 2.03:1 (below the
      3:1 non-text floor), `prefers-reduced-motion` honoured in only one of five
      trees, status dots conveying state by colour alone at 1.02-1.13:1, and
      desktop chart axis text at 1.74:1.

77. **There is no web accessibility standard in this repository, proven eight
    ways.** — OPEN, accessibility-specialist. This is why row 76 is advisory
    rather than enforceable, and it is the role's real first deliverable.
    `check:absence "web accessibility standard"` returns CORROBORATED across four
    probes. No a11y tooling in any `package.json` (axe, pa11y, lighthouse,
    jest-axe, eslint-plugin-jsx-a11y) — and **no eslint config exists at all**, so
    no `jsx-a11y` rules. Of the preflight gates and workflows (327 and 14 on 2026-09-06; `check-preflight-ci-parity.mjs` prints both),
    `check-decision-palette.mjs` is the only accessibility gate.
    WHAT IS RATIFIED IS NARROWER THAN IT LOOKS, and the distinction matters: DR-005
    ratifies WCAG AA for decision-state COLOURS, not conformance; DR-006 says
    outright that full palette parity over every rendered tree is follow-up work;
    CLAUDE.md's four accessibility rules are iOS-only. Nothing states a bar for
    keyboard access, focus order, live regions, reduced motion, form labelling,
    landmarks or zoom.
    THE MATERIAL TO WRITE IT WITH ALREADY EXISTS AND WAS NEVER OPENED:
    `third_party/everything-claude-code/skills/frontend-patterns` carries an
    Accessibility Patterns section (keyboard navigation, `aria-expanded`), vendored
    and unactivated — see row 74. Row 56 recorded "no web a11y/brand doctrine
    exists to put in it" as the reason not to create a web skill. That reason was
    false when written.

    CORRECTION, 2026-08-25, from an independent read of both web trees. The TITLE of
    this row overstates what its own body says, and the overstatement was repeated
    verbally to the owner. What exists is narrower than "a standard" and wider than
    "nothing": DR-005 and DR-006 ratify a WCAG AA 4.5:1 floor for decision colours,
    `docs/BRAND_CONTRAST_FINDING.md` records the analysis, and
    `check-decision-palette.mjs` ENFORCES that floor in CI across five web trees.
    `check:absence accessibility` returns INCONCLUSIVE with 31 mentions, not
    CORROBORATED — and the matches were read rather than counted. What genuinely does
    not exist is anything BEYOND decision colours: searching `scripts/` and `.github/`
    for `aria-|wcag|a11y|axe-core|accessib` yields two e2e specs asserting
    `aria-pressed`/`aria-live` on specific widgets, and NEITHER targets
    `signalgrid-app` or `signalgrid-mobile-pwa`. No axe-core, no keyboard or focus
    standard, no non-text-contrast rule — which is precisely what row 107 needs — and
    no colour-blind separation rule. The accurate claim is: **the web side has a
    ratified, enforced decision-colour floor and no other accessibility standard.**
    Read the body, not the title; the title is left in place so the correction stays
    legible rather than being quietly overwritten.

78. **What the first iOS execution found — including that CLAUDE.md's own way of
    checking one of its rules returns a false clean.** — OPEN,
    mobile-native-engineer. That role had read 0 of 129 files.
    · **THE VERIFICATION METHOD IS BROKEN, and this is the finding that matters
      most, because it hid the others.** CLAUDE.md says "Never call
      `UIFont.systemFont` / `monospacedSystemFont` directly". Grepping that exact
      spelling returns **ZERO**. Grepping Swift's implicit-member form,
      `.systemFont(ofSize`, returns **18** — all in
      `HostAppViewController.swift` (16) and `ManagedAppViewController.swift` (2).
      Anyone verifying the rule the way the rule is written concludes the codebase
      is clean. It is not. `dd55bca` (2026-08-18) converted eight view controllers
      to `SG` tokens with Dynamic Type and skipped exactly these two, and
      SG-adoption to `adjustsFontForContentSizeCategory` correlates 1:1 across
      every other file.
      WHY IT MATTERS: `HostAppViewController` IS the embedded Assist gate. It
      renders the verdict, the reason and the step-up copy at fixed 9pt, 10pt,
      11pt and 12pt. A worker at `accessibility-extra-large` sees no change on the
      one screen that tells them why they were blocked. No gate covers this —
      preflight has two native gates and neither concerns typography.
    · **Backlog row 58 — confirmed live at this read, CLOSED since (2026-09-02).**
      At the time of the read `SessionData.isExpired` was
      `guard let expiresAt = expiresAt else { return false }` — a session that
      could not say when it expires read as NOT expired — and
      `HostAppViewController:189` stacked a second permissive default on top
      (`?? false`). `stale` is a live posture input to the Assist gate. Golden
      rule 2 inverted, twice, on the gate's input. Closed by the Mac lane:
      `ExpiryPolicy` makes an unknown expiry unrepresentable, the consumer now
      defaults `?? true` (stale), and `mac/session-expiry-hardening` pins
      `isExpired` with `SessionExpiryTests` (6 cases, two falsifying).
    · **The Swift port is missing a fix the TypeScript side already made.**
      `lib/app-workflows/src/index.ts:124-138` gained `stepUpSatisfiedActionKeys`
      so that "a gesture obtained for one pending action can never release the
      rest of the integration (review finding)". `AppWorkflows.swift` has only the
      boolean full release, so `completeAppStepUp` releases EVERY held action.
      Bounded today because the one UI consumer steps action-by-action, but it is
      a fail-open in the port's public API that TS closed.
    · **Three attribute predicates compare a string where TS compares a boolean** —
      `DecisionEngine.swift:57,69,70` test `== "true"` where
      `decisionEngine.ts:115,129,130` test `=== true`. Latent: no Swift producer
      sets them today. It becomes live the moment anything decodes `/v1` signal
      JSON into `[String: String]` on device.
    · `KioskConfig` reads MDM-only security settings (`SingleAppModeEnabled`,
      `AllowManualOverride`, `RecoveryCode`) from the plain UserDefaults domain
      with equal authority to managed configuration, and unlike `DemoMode.swift`
      it carries no simulator build guard.
    WHY THE PARITY GATE MISSES TWO OF THESE, honestly: `check-decision-port-parity`
    compares reason-code vocabulary and reason-code-to-outcome wiring, and says of
    itself that it "cannot prove behavioural equivalence". Predicates and planner
    inputs are outside its model. It is not broken; it is narrower than a green run
    reads.
    CLEAN, and recorded so it is not re-litigated: `UIUserInterfaceStyle` is pinned
    nowhere (verified two ways); the decision-colour contrast passes with the
    3.18:1 regression fixed; `DecisionEngine`'s fourteen rule blocks are a faithful
    port in order, emission and outcome unions; the platform-honesty copy is
    exemplary and states outright that an app cannot prevent its own closure; and
    the entire Kotlin surface is fail-closed throughout.

79. **The palette gate had TWO independent holes, and the second one meant even a
    CORRECTLY-keyed step-up passed.** — FIXED 2026-08-25, found by the first
    `desktop-engineer` execution (0 of 94 files read) and confirmed against the
    accessibility read of row 76.
    · **Anchor hole.** The ramp scan is key-anchored (`allow:`) or
      comparison-anchored (`outcome ===`). A charting library uses neither: the
      verdict is a JSX ATTRIBUTE VALUE (`dataKey="allow" stroke="#22c55e"`) or a
      DATA value keyed on something else (`{ c: "#22c55e", l: "ALLOW" }`). No
      anchor fired, so the window never opened.
    · **Ramp-list hole, independent of the first.** `#eab308` — Tailwind
      yellow-500, the step-up colour — was simply ABSENT from the ramp list. Even
      a properly verdict-keyed use of it passed. Proven by fixing the anchors
      first and watching the gate STILL exit 0.
    THE ORDER IS THE EVIDENCE. Widening the ramp list alone: still exit 0. Adding
    the attribute anchor: exit 1, naming BOTH `signalgrid-desktop` and
    `signalgrid-app`. Two holes, and either one alone would have kept the defect
    invisible.
    WHAT WAS BEHIND THEM: both dashboards painted all four verdicts from raw
    Tailwind hex — a second, unratified decision palette in a shipped tree. Deny
    at `#EF4444` measures **4.26:1 on card**, below the 4.5:1 floor this gate
    enforces everywhere else, on the most safety-critical verdict.
    THE CAVEAT, STATED RATHER THAN BURIED: these marks are chart strokes and
    legend swatches — graphical objects, for which WCAG 1.4.11 sets 3:1, not 4.5:1.
    So the AA number is arguable AS WCAG. What is not arguable is that this
    repository's ratified rule applies 4.5:1 to decision colours on background and
    card with no text/non-text carve-out, and that a second palette was rendering
    behind a green gate.
    THE FIX AVOIDS INVENTING DOCTRINE. Only three decision tones are ratified
    (allow, review, deny) and four verdicts are drawn, so `restrict` has no
    colour of its own. Rather than mint a fourth — a design decision that is not
    mine — restrict now uses the deny tone distinguished by a DASH PATTERN, a
    non-colour channel, which is better doctrine than a new hue. `signalgrid-app`
    also had NO legend, so colour was the sole channel for four series; a
    `<Legend />` was added. Chart chrome moved off a third palette (slate) onto
    `--border`/`--muted-foreground`/`--popover`.
    SELF-TESTS ANCHORED TO THE REAL SHAPES, 14 -> 17, taken verbatim from the two
    Dashboard files rather than written against the new regex — anchoring a
    self-test to the regex it tests proves only that the regex is itself. Both
    apps build clean.
    STILL OPEN — brand-design/accessibility-specialist: whether `restrict`
    deserves its own ratified tone. The dash is a correct stopgap, not an answer.

80. **The Rust Assist client is the strongest of the three, and it is worth
    recording that a clean read happened.** — CLOSED 2026-08-25, no defect.
    The roster's standing open question — what an UNKNOWN resolves to in the
    Kotlin **and Rust** Assist clients — was answered for Kotlin on 2026-08-24 and
    left open for Rust. It is now answered, by execution rather than reading:
    `cargo` IS available in the cloud lane (1.94.1), so 36 unit + 2 conformance
    tests were run, plus `fmt --check` and `clippy -D warnings`, all clean.
    · Unrecognised outcome -> DENY (`assist.rs:32-41`); `None` only for genuine
      absence, matching Kotlin exactly.
    · Non-2xx, empty body, malformed JSON, non-object JSON, missing `assist`, and
      present-but-non-string `assist` each fail closed WITH a named reason
      (`wire.rs:20-79`). 401/403 are not rescued by an `allow` body.
    · No `#[derive(Deserialize)]` anywhere in the tree (corroborated by
      `check:absence deny_unknown_fields`), so serde's silent-unknown-field
      default has no surface. Unknown RESPONSE fields are tolerated deliberately —
      `deny_unknown_fields` there would flip a legitimate allow to deny when a
      newer server adds a field, which is fail-closed in the wrong place.
    · Two `unwrap_or` instances, both resolving the unknown to the TIGHTER side;
      no `unwrap_or_default` anywhere. The `?? false` family has no analogue here.
    · Plaintext refused off-loopback and credentials refused in the authority,
      with `10.0.2.2` deliberately OMITTED from the loopback set that Kotlin
      includes — on a desktop that is a routable address. Documented, stricter.
    ONE REAL GAP, and it is not the desktop's: Rust folds case with
    `to_ascii_lowercase()`, Kotlin with full-Unicode `lowercase()`. Different
    functions, and all 42 shared conformance vectors are ASCII, so nothing pins
    the difference. The direction is favourable — Unicode folding maps MORE inputs
    onto "allow", so Kotlin can only be equal or more permissive — which makes
    this a hole in `native/shared/assist-wire-conformance.json`, owned by
    api-contract-architect, not a desktop defect. Add non-ASCII vectors (NBSP-,
    U+3000- and ZWSP-padded `allow`, and a Cyrillic homoglyph) and both clients
    are obliged at once.

81. **The product's sharpest unbuilt idea was already latent in its own DDM
    schema: the difference between what is DECLARED and what is OBSERVED.** —
    PROPOSED 2026-08-25, not built. Owner-directed: mine the Drive source
    material for product ideas.
    THE SEAM. `lib/ddm-connector/src/apple-schema.ts` records, per property, how
    Apple's Declarative Device Management reports it. Three notes carry the
    insight: privacy/PPPC is "configuration-declared, not a status item — no DDM
    status key"; Endpoint Security binary control is "a CONFIGURATION
    declaration, not a status item ... Reported out-of-band / on-device";
    check-in recency is "a transport/control-plane fact, not a device-reported
    status item". That is intent versus evidence. The management plane can always
    tell you what was ASKED FOR. For several layers it structurally cannot tell
    you what is TRUE, because the platform exposes no status key at all.
    WHY THAT IS THE WHOLE PRODUCT. The founder's nine-layer macOS troubleshooting
    diagram (see `WHY_THIS_EXISTS.md`) lists a failure mode per layer, and every
    one is the same failure wearing a different costume: the intent was recorded
    and something downstream did not honour it. Profile assigned but not received.
    PPPC payload present but TCC still denying. Extension policy present but the
    extension silently not loading. An operator with that diagram is doing ONE
    thing, nine times, by hand — comparing declared against observed and finding
    where they diverge.
    THE GAP IS MEASURED, NOT ASSUMED. `decisionEngine.ts:120` already reads
    `declaredState` and fails closed on `"stale"`, and `scenarios.ts:16` carries
    an `apple.ddm_declared_state` signal. But `grep -rl "observedState"` over
    `lib/signalgrid-core/src` and `lib/signalgrid-simulator/src` returns ZERO.
    The engine can consume a declaration and notice one has gone stale; it cannot
    express that a declaration and an observation DISAGREE.
    THE PATTERN ALREADY EXISTS IN ONE FAMILY, arrived at independently, which is
    what makes this a generalisation rather than a clever idea:
    `device-attestation/evaluate.ts` refuses to abstain when a report declares
    `attestable: false` while also carrying attestation evidence — "malformed or
    tampered; it must NEVER abstain". That is declared-versus-observed divergence
    treated as a FAULT, in one dimension.
    DOCTRINE FIT: a contradiction must tighten at least as hard as an absence,
    and probably harder. An unknown is a gap; a contradiction is a fault, because
    one system is actively asserting something another contradicts.
    THE LAYER WITH NO SIGNAL IS THE ONE THE PLATFORM DECLINES TO REPORT.
    `check:absence "TCC privacy permission"` returns CORROBORATED across four
    probes — no file, no directory, no workflow, no source mention. Per the
    diagram that same layer produces the most user-visible symptom of all, "user
    prompt still appearing": the worker sees a permission dialog nobody can
    explain while the console reports compliant, and BOTH are telling the truth.
    THE SECOND SOURCE ALREADY EXISTS, which is the hard part — the Fleet/osquery
    telemetry connector and the live Fleet lab lane. Whether osquery can observe
    any GIVEN layer is untested and must not be assumed; naming Fleet is a
    hypothesis with a lane attached, not a capability.
    WHAT IT ANSWERS COMMERCIALLY. The May 2025 second-opinion review asked how
    SignalGrid answers "why not just extend our existing Okta/CrowdStrike/
    ServiceNow deployment?" and called differentiation the gap needing one more
    pass. This is the sharpest form available: the existing stack IS the thing
    making the declaration. It cannot audit its own assertion, and a vendor
    cannot corroborate itself from one vantage point. A layer whose whole job is
    comparing two independent sources is structurally something no incumbent can
    be — not for want of engineering, but because it is one of the two sources.
    NOT BUILT. Recorded as a proposal with its gap measured. Design, doctrine
    placement and per-platform applicability are open — the diagram is macOS, and
    whether the same seam has the same shape on iOS, Android and Windows is
    unexamined. principal-engineer and solutions-architect own the disposition.

82. **A credential REVOCATION can be silently undone by a concurrent enrolment —
    the one mutator in the store without the lock its neighbours carry.** — OPEN,
    security-engineer. Found by the first read of `lib/webauthn/**` and
    `lib/enterprise-auth/**`, and INDEPENDENTLY CONFIRMED before filing.
    · `addCredential` (`store.ts:166-239`) takes a per-user `SET NX PX` Redis lock
      before its read-modify-write, and carries a long comment explaining exactly
      why: "each read the user, append a credential, and each write the whole
      thing back. The later SET erases the earlier." It even records that a
      discarded WATCH/MULTI variant persisted only some concurrent enrollments
      (the shipped lock's proof, proof:enrollment-race, asserts all survive).
    · `advanceCredentialCounter` (`:301-357`) uses WATCH/MULTI, correctly — the
      counter must fail closed on a lost race.
    · `removeCredential` (`:241-277`) does neither. Plain `getUser()` -> splice ->
      save. Verified by reading it: no lock, no CAS.
    THE CONSEQUENCE, in the ordering that matters: a revocation reads the
    credential list, a concurrent enrolment takes the lock and writes, then the
    unlocked revocation writes its stale snapshot last — **restoring the
    credential that was just revoked.** That is precisely the outcome
    `addCredential`'s comment says the lock exists to make impossible, and the
    guarantee simply is not held on the removal side.
    SEVERITY, STATED HONESTLY: LATENT. No live API route calls `removeCredential`
    — established two differently-shaped ways (a repo-wide symbol search, and
    reading the v1 route file). Only `webauthn-enrollment-race-proof.ts` exercises
    it. It becomes live and security-relevant the moment an admin credential-revoke
    endpoint is wired, which is a normal thing to add and would not obviously
    require touching this file.
    FIX: give it the same per-user lock, or fold both into one lock-guarded mutate
    helper, and add a proof case exercising add/remove concurrency the way
    `proof:enrollment-race` exercises add/add.
    ALSO FOUND, same read, both should-fix or lower:
    · `packed` and `fido-u2f` full attestation verify only the LEAF certificate's
      signature (`verify.ts:348-352`, `:386`) — no chain to a trusted root, no
      validity period, no revocation. Mitigated because
      `generateRegistrationOptions` requests `attestation: 'none'`, so a conformant
      authenticator does not return a full statement in this product's own flow.
      It matters the moment attestation is tightened to direct/indirect, and the
      assumption should be commented at the call site so that change cannot
      silently inherit unchecked trust.
    · `stepUpStore.ts:251-258` — `hasValidStepUpSession` is a hardcoded
      `return false` under a docstring claiming it performs a real check. It fails
      CLOSED and is unreachable, but it is a SECOND, parallel step-up
      implementation with its own Redis client and session shape sitting unused
      beside the live one. A future integrator wiring the wrong one inherits an
      always-deny stub. Remove it or mark it deprecated in a header.
    AND A DEAD SURFACE, FIXED IN PASSING: the roster gave security-engineer
    `lib/api-auth/**`, which matches NO file in the tree (confirmed two ways).
    The intent was `lib/enterprise-auth/**`. Corrected — and the symptom was
    concrete rather than cosmetic: seven genuinely-read files did not count
    toward coverage until the glob pointed at something real.
    CLEAN, and recorded so it is not re-litigated: every expiry and freshness
    comparison across both directories now uses the `Number.isFinite`-guarded
    form, verified by two independently-shaped searches — no sibling of the
    original NaN fail-open family remains on this surface. `proof:webauthn-verify`
    (48/48) and `proof:enterprise-auth` (21/21, including alg-confusion,
    clock-tolerance boundary and cross-tenant denial) both executed clean. No
    secret, plaintext-password comparison or unparameterised query exists on this
    surface; logging carries IDs only, never tokens or key material.

83. **An OLDER, more permissive reading from a second connector silently erases a
    newer one — and the outcome flips deny to allow.** — FIXED 2026-08-25,
    principal-engineer. Was BLOCKING. Shipped in #309.
    THE FIX: `connector.id` is now part of the signal id at all three mint sites, so
    per-connector rows coexist and `groupLatest` does the greatest-observedAt
    arbitration it was always written for. Six assertions in
    `signalgrid-core-proof` (233 -> 239) construct the case the shipped seed cannot,
    because Northwind's two dock connectors cover disjoint devices.
    FALSIFIED: removing `connector.id` fails them with the original symptom — only
    one connector's row survives and the winner becomes `observedAt=14:00
    value=none`. `CORE_NORMALIZATION_VERSION` 8 -> 9 and the canary re-pinned with
    its reasoning, as the two prior re-pins did.
    HEADER CORRECTED 2026-08-25: this row said OPEN for several hours after the fix
    merged. A backlog that under-reports finished work sends someone to redo it —
    the mirror of the false-CLOSED that hides work, and worth naming rather than
    quietly flipping.
    ORIGINAL FINDING FOLLOWS.
    · Signal ids are minted as
      `deterministicId("sig", tenantId, subjectType, subjectId, category)` at all
      three sites (`dock.ts:107`, `shift.ts:69`, `connector.ts:201`). **The
      connector id is not in the key.** Confirmed structurally: zero mint sites
      anywhere derive an id from `connector.id`.
    · `store.ts:210-221` then does `bucket.set(signal.id, signal)` with no
      freshness comparison. Its own comment says a re-put "overwrites in place",
      which is correct for a re-put from the SAME source and wrong for a second one.
    · `evidence.ts:228-237` `groupLatest` exists to pick the greatest `observedAt`
      per category. It never gets the chance — only one row survives the store.
    REPRODUCED, one device, two dock connectors: a SmartDock observed
    `tamperState = confirmed` at 14:55 and the decision was **deny**. A second dock
    feed then reported `none` observed at **14:00 — 55 minutes EARLIER** — and the
    decision became **allow**. Signal count stayed at 9: nothing was added, the
    confirmed tamper was erased.
    WHY IT MATTERS: this is the repo's canonical defect class, in the decision core
    itself. A less-informed, older input made the answer strictly more permissive,
    and the worst-wins fold one layer up was bypassed entirely. The shipped seed
    hides it because Northwind's two dock connectors cover disjoint device sets, so
    no gate has a two-connectors-one-device case.
    FIX: include `connector.id` in the signal id at all three mint sites so
    per-connector rows coexist and `groupLatest` does the arbitration it was
    written for. If single-row-per-category is deliberate instead, `putSignal` must
    refuse to replace a row with a strictly older `observedAt` — and that rule needs
    a proof either way. `CORE_NORMALIZATION_VERSION` needs regenerating.

84. **The simulator never compares `zone` against `expectedZone`; 12 of 21
    attribute branches are unreachable from any fixture.** — OPEN,
    principal-engineer. `decisionEngine.ts:125-132` tests
    `attributes["zone"] === "wrong"` — a literal string match — and otherwise fires
    only on pre-classified event types. The `expectedZone` every location fixture
    carries is never read.
    REPRODUCED: a device honestly reported in `imaging` when it belongs in
    `east-unit` returns **allow**, unless the upstream already labelled the event as
    the exception. Same shape as `device.low_battery` firing on the event type while
    `batteryPct: 8` goes unread — the engine trusts the source's classification and
    never reads the measurement.
    COVERAGE HALF: 12 of the 21 attribute keys the engine branches on are never set
    by any scenario — including all of `hasWorkflowRoutingFailure` — while
    `proof:signalgrid-simulator` reports 51/51 assertions passed.
    FIX: add a `zone !== expectedZone` comparison, plus fixtures for the 12
    uncovered keys. **Golden rule 1 applies** — this file is byte-ported to
    `native/ios/EnterpriseShell/Services/DecisionEngine.swift`, so the port and the
    parity check move together. Coordinate with the Mac lane before touching it.

85. **A comment claims four falsifiable conjuncts; a 1024-case sweep shows two are
    constants.** — OPEN, principal-engineer. `decisionEngine.ts:38-66` says "the
    evidence must actually COVER what was routed… which diverges the moment routing
    and evidence disagree." They cannot disagree: `createAuditEvidence` builds
    `routing_trace.references` FROM the same `routedActions` array that line 57
    turns into `routedIds`.
    REPRODUCED by sweeping all 2^10 outcome subsets through the real routing and
    evidence functions: `evidenceCoversRouting === false` in **0** cases;
    `evidenceReferences.has(decision.id) === false` in **0** cases. The
    `expectedOutcomes` half IS genuinely falsifiable and does real work.
    WHY IT MATTERS: low blast radius, but a comment asserting falsifiability that a
    sweep refutes is the self-certifying shape this repo has been closing.
    FIX: derive the evidence references independently, or delete the two constant
    conjuncts and correct the comment. Deleting is honest and cheaper.

86. **`registerVerifiedPrincipal` does not validate the role its docstring says it
    validates.** — OPEN, principal-engineer. `engine.ts:147-174`; the docstring at
    `:138-146` states "the target tenant must exist and the role must be known — and
    fails closed otherwise." The tenant check is there. There is no role check.
    REPRODUCED: roles `superuser`, `constructor`, `__proto__` and `toString` are all
    ACCEPTED, and the next authorized call dies with an untyped `TypeError`.
    NOT A GRANT PATH, stated honestly: every `Object.prototype` key was probed and
    none resolves to an array, so `roleHasPermission` always throws rather than
    returning true. The defect is that a bad role claim from the enterprise OIDC
    path becomes a 500 on every subsequent call instead of a clean refusal — and
    that the docstring asserts a check that does not exist.
    FIX: validate `input.role` against the five known roles and throw a
    `CoreError("validation", …, 400)`. Independently, make `roleHasPermission` use
    `Object.hasOwn` and return `false` for an unknown role.

87. **`shift.ts` is the only core module missing from the barrel.** — OPEN,
    principal-engineer. 18 of 19 exported from `index.ts`; verified two ways. An
    external consumer can construct a `DockCustodyRecord` but not a
    `ShiftContextRecord`, though both are fixture-connector inputs of the same kind.
    Internal callers use relative imports, so nothing is broken today.

88. **`computeMetrics` accumulates an out-of-union outcome into a bucket the
    type says cannot exist, and serves it.** — OPEN, principal-engineer.
    NOTE severity, reporting path only. RE-ANCHORED 2026-09-02: this row used to be
    anchored on `outcomesCovered()`, which 45cdecf (Ponytail cut 1) deleted as
    zero-importer code — the symbol exists nowhere in the tree now, so half of the
    row named a function that is gone. The LIVE half survived the cut and is
    restated here against the symbol that still exists.
    `lib/signalgrid-core/src/metrics.ts:12` does `byOutcome[decision.outcome] += 1`
    unguarded over a `Record<DecisionOutcome, number>`, and
    `lib/signalgrid-core/src/types.ts:557` documents that durable snapshot rows are
    cast with an unchecked `as`. `SignalGridCore.metrics()`
    (`lib/signalgrid-core/src/engine.ts:418`) is the only caller and
    `GET /v1/metrics` (`artifacts/api-server/src/routes/v1.ts:348`) is the served
    surface, so the result reaches an operator.
    MEASURED 2026-09-02 rather than reasoned, and the earlier wording overstated it:
    the rates do NOT go NaN. Over `["allow","deny","quarantine"]` the four in-union
    counters stay correct, the out-of-union key lands as `quarantine: NaN` — `null`
    once `res.json` serialises it — and the poisoned decision is counted in `total`
    but in no bucket, so `allowRate + restrictDenyRate` = 0.333 + 0.333 = 0.666 over
    three decisions. The under-sum is the reporting defect; the extra key is a
    `MetricsSummary` that contradicts its own type.

89. **The connector's `identity_state` signal is normalized, recorded as "used",
    and never read: a disabled account allows.** — FIXED 2026-08-25,
    principal-engineer. Was BLOCKING. Shipped in #309.
    THE FIX: `foldIdentityEnabled` folds the identity row and the connector's
    signal worst-wins. An affirmative `false` from EITHER source wins, and SILENCE
    CHANGES NOTHING in either direction — an absent signal cannot loosen a disabled
    row and cannot promote an `"unknown"` row to `true`. That silence half is what
    made it safe to land: with no identity connector present the behaviour is
    byte-identical to before, which is why all 225 pre-existing assertions passed
    untouched. Eight assertions added; falsified by restoring the defect, which
    fails exactly the two that target it.
    HEADER CORRECTED 2026-08-25, same reason as row 83.
    ORIGINAL FINDING FOLLOWS.
    · Emitted at `connector.ts:150-163`. The only producer of
      `evidence.identityEnabled` is `evidence.ts:50-55`, which reads the STATIC
      `identity.state` store row instead.
    · Confirmed independently: `identity_state` appears in exactly two places in the
      whole package — the emit site and the `SIGNAL_CATEGORIES` declaration. **No
      reader anywhere.**
    REPRODUCED: with the store row saying `enabled` and the connector reporting
    `identityEnabled: false`, evidence reads `true`, `criticalSignalsPresent` stays
    true, and the outcome is **allow** with reason `TRUST_ESTABLISHED`.
    WORSE FOR THE AUDIT STORY: `decision.ts:94` puts identity signals into
    `signalsUsed`, which flows into `buildSnapshot` — so the evidence snapshot
    records `identity_state: false` as an input to a decision it did not influence.
    `docs/ECOSYSTEM_FLOW_AND_RESOLUTION.md:115` describes the intended model as
    connector-sourced; the docs and the code disagree about where this fact
    comes from.
    FIX: have `buildEvidence` fold the signal with `identity.state` worst-wins —
    either disagreeing yields `"unknown"` (already a step-up), or an affirmative
    `false` from either source wins. Do NOT simply switch to the signal: silence
    must stay `"unknown"`, never `true`.

90. **`groupLatest` orders timestamps with `localeCompare` on a decision path.** —
    OPEN, principal-engineer. NOTE. `evidence.ts:232` uses ICU collation, not
    code-point ordering, to pick the latest signal. Correct today because every
    `observedAt` is the identical ISO shape, but a source emitting `+00:00` instead
    of `Z`, or omitting milliseconds, would misorder. Use `<` or `Date.parse`.

91. **`activatePolicyVersion` does not require the version's own tests to pass.** —
    OPEN, principal-engineer. NOTE, governance gap not a fail-open. `engine.ts:311-351`
    never runs the pinned `PolicyTest` fixtures and does not reject a `superseded`
    target, so an owner can activate a version that fails its own tests. The
    `criticalSignalsPresent` backstop still holds.

92. **`docs/PRODUCT_DATA_MODEL.md` lists 13 signal categories; the code has 17.** —
    OPEN, docs-writer. Missing: `benchmark_selection`, `shift_context`,
    `device_management_health`, `local_authority`. `check-proof-figures.mjs` exits 0
    and its own output explains why it cannot see this: a hand-written list of
    backticked names is out of shape for `FIGURE_RE`. This is the fossil-list
    failure the `SIGNAL_CATEGORIES` comment says was designed out — the array is
    enumerable now, but the doc still restates it by hand.

93. **Any unauthenticated caller can grow the metrics registry without bound, and
    the rate limiter provably does not stop it.** — FIXED 2026-08-25,
    api-contract-architect. Was BLOCKING.
    THE FIX, two independent defences:
    · The route label now comes from the route Express MATCHED (`req.route.path`
      plus `req.baseUrl`), never from the URL the caller sent. `req.route` is set
      only when a layer actually matched and is undefined on a 404 — that is the
      discriminator. A real route contributes its PATTERN, already id-free by
      construction; anything unmatched contributes one shared `other` bucket.
    · A hard ceiling of 512 distinct label tuples per metric, in the registry
      itself. A SECOND NET on purpose: the middleware is one caller, and these are
      exported instruments any future caller can reach. Past the ceiling a new
      tuple folds into a visible overflow series rather than being dropped, so the
      count stays truthful. The docblock on `normalizeRoute` CLAIMED the label
      stayed bounded and nothing enforced it — that is the shape being closed.
    MEASURED, same probe as the original finding: 150 unauthenticated junk URLs now
    add **ONE** label series instead of 150. The exposition goes 2,119 -> 4,433
    bytes rather than 2,119 -> 185,583, and histogram bucket lines 36 rather than
    1,824. Zero series name a junk URL.
    FALSIFIED: restoring `normalizeRoute(req.originalUrl)` fails exactly the two
    targeted assertions (302/304); restored, 304/304. The suite also carries a
    NON-VACUITY check, because every other assertion here asserts an ABSENCE and a
    /metrics that errored would satisfy them all.
    INCIDENTALLY RECONFIRMED, and left open as its own row: the first attempt to
    measure this got a **429 from /metrics itself** — the global limiter throttles
    the metrics endpoint, which is row 94.
    ORIGINAL FINDING FOLLOWS.
    · The route label is `normalizeRoute(req.originalUrl)`, which collapses only
      RECOGNISED id shapes. Every other path becomes its own label, verbatim, in two
      unbounded `Map`s that never evict. Absence of any bound confirmed three
      differently-shaped ways; the only hits are the docblock CLAIMING boundedness.
    · 150 unauthenticated GETs to `/api/junk-N` created **150 label series**, grew
      the histogram to 1,824 bucket lines, and grew the `/metrics` body from 2,119
      to 185,583 bytes — **88× in 150 requests.**
    · **51 of those 150 series were created by requests the limiter had already
      rejected with a 429.** `metricsMiddleware` is registered at `app.ts:75` and
      `globalRateLimiter` at `:90`, and the comment at `:73-74` says that ordering is
      deliberate so throttled requests are still counted — which is exactly what
      removes the bound. Throttling cannot cap registry growth.
    REACHABLE WITH NO CREDENTIAL UNDER BOTH PROFILES: `metricsMiddleware` and
    `GET /metrics` are app-level, above the `/api` mount, so the GA fence never
    sees them.
    FIX: resolve the label from the MATCHED route pattern rather than the raw URL —
    under the gateway profile `routeServedByGateway` already computes exactly that —
    and collapse everything unmatched to a single `route="other"`. Failing that, cap
    distinct label tuples with the same FIFO shape `idempotency.ts:99-102` uses.

94. **The global limiter throttles `/healthz`, `/readyz` and `/metrics`.** — FIXED
    2026-08-25, api-contract-architect. Reproduced first, with
    `SIGNALGRID_GLOBAL_RATE_LIMIT=5`: `/api/healthz`, `/api/readyz` and `/metrics`
    all returned 429 inside twelve requests. `artifacts/api-server/src/lib/profile.ts` already keeps the two
    probes outside the GA fence on the reasoning that an orchestrator "would treat a
    fenced 404 as a dead instance and restart a working server" — a 429 lands in the
    same place, and it lands under load, which is when a false unhealthy verdict is
    most expensive.
    `globalRateLimiter` now takes a `skip`. The two probes are exempt
    unconditionally and by EXACT path match, never by prefix, so
    `/api/healthz-and-something-expensive` inherits nothing.
    `/metrics` is deliberately NOT unconditional. It is a data surface rather than a
    liveness signal, so its exemption is conditional on `METRICS_TOKEN` being set:
    authenticated, the scrape is exempt; unconfigured, the endpoint is open and the
    limiter is the only protection it has left, so the limit stays. The unknown case
    keeps the restriction. The token is read per request, not captured at module
    load — the defect already fixed once in `webhooks/dispatch.ts`.
    Nine assertions in `pnpm --filter @workspace/api-server run test:api` (305 → 314),
    including a positive control proving the limiter is still engaged on ordinary
    routes, so "not throttled" cannot pass against a limiter that was accidentally
    switched off. Falsified three ways, each hitting only its own assertions:
    removing the skip fails 4, making `/metrics` unconditionally exempt fails 1,
    prefix-matching instead of exact fails 1.
    SECOND HALF, dispositioned rather than coded. `trust proxy` stays unset — that
    is the correct posture against `X-Forwarded-For` spoofing, and turning it on
    would convert the per-address limit into no limit. The shared-bucket cost behind
    an ingress is real and is now blunted at both ends: `/v1` is keyed per bearer,
    and the probes can no longer be throttled into looking dead. `docs/DEPLOYMENT.md`
    carries the operator guidance, including that a proxy hop must be named by count
    or CIDR and never by `true`.

95. **`HEAD` on an allowlisted route 404s under the gateway profile.** — OPEN,
    api-contract-architect. Express auto-serves `HEAD` from a `GET` handler, but
    `profile.ts:171-175` compares the method against an allowlist containing only
    `GET`, so it 404s before the handler is reached. Verified: `HEAD /api/healthz`
    -> 404 while `GET` -> 200. `HEAD` is a common load-balancer liveness default, so
    the consequence is row 94's again — a healthy instance reporting 404 to its probe.
    FIX: treat `HEAD` as `GET` in `routeServedByGateway`. Do NOT drop the method
    check; the comment at `:157-166` documents a real hole it closes.

96. **The `/v1` limiter keys on the raw bearer string, not the principal — the
    exact class `idempotency.ts` already fixed.** — OPEN, api-contract-architect.
    NOTE. `rateLimit.ts:59-67` uses `tok:${token}`; the principal is never consulted.
    `idempotency.ts:56-62` spells out the reasoning for the mirror-image bug: under
    enterprise OIDC the context middleware mints a fresh opaque credential per
    request. Consequence here: an IdP rotating short-lived JWTs hands each new token
    a fresh 240/min bucket. Established by reading, not execution.
    CONSTRAINT: the limiter must run before authentication, so it cannot use
    `req.principal`. A second, principal-keyed limiter after `requireTenantContext`
    is the workable shape, leaving the pre-auth one as coarse DoS protection.

97. **`POST /cp/v1/telemetry` is an unauthenticated, unbounded, cross-tenant
    WRITE that the profile documentation does not name as a write.** — OPEN,
    api-contract-architect. Reproduced: one anonymous POST rewrote another tenant's
    rollup, moving the top hotspot to `edge_nw_general` with 9,000,000 decisions and
    a denyRate of 1. A second probe sent 200 batches with 60KB `nodeId` values and
    grew RSS from 102,864 kB to 146,128 kB — the route validates only
    `typeof nodeId === "string"`, with no length bound, format check or entry cap.
    NOT A PRODUCTION HOLE: the gateway profile does not mount this router (verified
    404). It is live on the public review deployment. Both `routes/index.ts:47-53`
    and `lib/profile.ts:20-30` enumerate the demo hazards and characterise `/cp/v1`
    purely as a read-scoping problem — the write is not written down anywhere.
    FIX: constrain `nodeId` to `cp.listEdgeNodes()` membership and refuse anything
    else, which closes both the poisoning and the growth. Then correct the two audit
    comments to name the write.

98. **Under the gateway profile, unknown ROOT paths return Express's default HTML
    error page.** — OPEN, api-contract-architect. NOTE. The JSON catch-all is scoped
    to `/api` on the stated reasoning that "the root serves human surfaces (demo
    console, /metrics) whose defaults stand" — but under the gateway profile the demo
    console is not mounted, so that premise is false. The path IS escaped (no XSS, no
    stack trace); it is the same class of framework disclosure that
    `app.disable("x-powered-by")` was added to remove.

99. **Two demo routers break the response-envelope contract.** — OPEN,
    api-contract-architect. NOTE. `/api/simulator/*` mints a FRESH uuid as
    `requestId` instead of reusing `req.requestId` (verified: header
    `x-request-id: CALLER-ID-123` against a body `requestId` of an unrelated uuid),
    and `/api/sim/*` omits `requestId` entirely while forwarding a raw library
    `err.message`. Nothing sensitive leaks today, but it is the one place on the
    surface where an unfiltered library string reaches a response body, and
    `routes/index.ts:25-28` records that a single deviant envelope here has already
    been treated as a defect worth fixing.
    RELATED, filed here rather than as its own row: the client picks the audit
    correlation id. `x-request-id` is accepted unvalidated and unbounded, reflected
    verbatim at 900 characters, and lands in the durable ledger's correlation field
    via `middlewares/context.ts:31-36`. Not XSS — the API answers JSON with `nosniff` — but in a
    repo whose stated position is "provenance is the product", a caller-chosen
    provenance field is worth closing. Accept the header only when it matches
    `^[A-Za-z0-9._-]{1,128}$`, else mint a uuid. This RELATED half landed
    2026-09-05 in PR #456 (eighth audit round; the row itself stays OPEN for the
    `sim.ts` envelope deviation above): artifacts/api-server/src/middlewares/context.ts
    now honours the header only in that shape and mints otherwise; three
    assertions in artifacts/api-server/test/api.test.mjs hold the boundary BY
    VALUE (129 chars and whitespace are replaced with a uuid, a conforming id is
    echoed) — the previous "is a string" assertion could not distinguish the
    change from the defect.
    Also landed the same day in PR #456, second door from row 94's change: `/api/readyz` was
    exempt from both limiters AND cost seven database round-trips per anonymous
    call (measured: 40 calls, 0 × 429, 280 probe units against pools of ten).
    The composite probe is now coalesced — concurrent callers share one in-flight
    probe and a settled result is reused for one second — observable as one
    `probedAt` across a burst, held by two api assertions on the DB-loss server.

100. **iOS: an unknown session expiry renders as "fresh", and a shipping identity
    provider produces exactly that.** — OPEN, mobile-native-engineer. BLOCKING.
    `SessionData.swift:44-47`: `guard let expiresAt = expiresAt else { return false }`.
    `expiresAt == nil` means "we do not know when this session expires", and the code
    answers "then it has not expired" — the permissive branch. It is reachable, not
    theoretical: `MDMIdentityProvider.authenticate` returns `expiresAt: nil`
    (`IdentityProvider.swift:442`), passed straight through at
    `SessionStateManager.swift:333`. Both server-side expiry checks (`:842`, `:853`)
    are `if let`, so they no-op on nil too.
    CONSEQUENCE: for any session created through the MDM provider, `sessionStale` is
    permanently false, so `device.stale_checkin` is never emitted, `POSTURE_STALE`
    never fires, and the session is never stepped up on freshness grounds. It also
    never triggers the token-expiry audit event or the refresh.
    This is the same NaN/nil fail-open family already fixed on the TypeScript auth
    surface, surviving on iOS. It is conspicuous because the neighbouring code is
    scrupulous: `HostAppViewController.swift:288-293` defaults `detectedZone` to nil
    precisely so the zone gate DENIES.
    FIX: keep `isExpired` for real expiry (it also drives teardown) and add a
    separate `freshnessUnknown` (true when `expiresAt == nil`) feeding `sessionStale`,
    so unknown freshness produces a STEP-UP rather than a session kill. Separately,
    have `MDMIdentityProvider` supply a bounded default expiry instead of nil.

101. **iOS: `AppWorkflows.swift` is missing the scoped step-up release the TS planner
    has, so one gesture releases every held action.** — OPEN, mobile-native-engineer.
    `AppWorkflows.swift:122` has only `let stepUpDone = input.outcome == .step_up &&
    input.stepUpSatisfied`; `lib/app-workflows/src/index.ts:124-137` computes
    `releasedKeys`/`heldKeys`/`allHeldReleased` and a per-action `actionReleased`.
    The TS comment at `:118-122` records this as a review finding — "a gesture for one
    action must never release the rest of the integration." The port omits it.
    HONESTLY SCOPED: latent, not live. The one shipping caller
    (`HostAppViewController.swift:685`) reads exactly one action out of the returned
    plan, and `plan.mode`/`plan.summary` are read nowhere in EnterpriseShell. But the
    control plane already speaks the scoped form (`v1.ts:813`), so the two sides can
    disagree today about what a step-up released.
    FIX: port the missing block — add `stepUpSatisfiedActionKeys` to `AppPlanInput`,
    compute the per-action `eff`, and switch on it rather than `effective`. Do not
    change the caller in the same commit.

102. **iOS: white text on the brand header fill fails WCAG AA, one label in both
    appearances.** — OPEN, mobile-native-engineer. `ActiveSessionViewController.swift:43`
    sets the header to `SG.primary`; four labels sit on it in hardcoded white at three
    alphas. Computed: `userRoleLabel` 5.08 light / **3.47 dark**; `departmentLabel`
    **4.39 light / 3.08 dark** — both under the 4.5 floor.
    The method is calibrated: it reproduces every figure `DesignSystem.swift` already
    asserts (deny dark 5.05/4.55, allow light 5.41/6.11, and the historical 3.72)
    exactly. This is the class the repo fixed twice — `onDeny` and `onAllow` exist
    because "white on the dark allow fill sat at 3.72:1" — but the lesson was never
    generalised to the brand fill, and there is no `onPrimary` token. Compounding it,
    `:611` lets a persona override the header with an arbitrary hex, so contrast there
    is unbounded.
    FIX: add an `onPrimary` token shaped like `onDeny`/`onAllow`, use it for all four
    labels, drop the alpha de-emphasis, and gate the persona override on a computed
    contrast check. Per DR-005 the token change lands in `index.css` in the same commit.

103. **iOS: `SignalGridOperator` pins dark mode at the app root.** — OPEN,
    mobile-native-engineer. `SignalGridOperatorApp.swift:11` calls
    `.preferredColorScheme(.dark)` — the SwiftUI equivalent of pinning
    `UIUserInterfaceStyle`, which CLAUDE.md forbids by name. System UI it presents
    inherits the forced scheme.
    IMPORTANT ORDERING: the pin is currently PROTECTING the app. `Theme.swift:5-21`
    defines every token as a single fixed dark value, so removing the pin alone would
    produce exactly the self-contradicting screen mix the rule exists to prevent. Make
    the tokens adaptive FIRST, then remove line 11.
    ALSO CORRECTS CLAUDE.md [APPLIED 2026-09-06]: its exemption says "SignalGridMobile is pure SwiftUI with
    semantic colors and needs none of this." That is true of `WardlinkDemo` and NOT of
    `SignalGridOperator`. The sentence should name the target. Not a UIKit conversion —
    fixable entirely in SwiftUI.

104. **iOS: one stray colour value forks the palette.** — OPEN, mobile-native-engineer. NOTE.
    `Theme.swift:5` decodes to `#13171A`; canonical Warm Charcoal 950 is `#15181B` in
    both `DesignSystem.swift:25` and `index.css:73`. Every OTHER token in the file
    decodes exactly and both asserted contrast figures verify, so this is one stray
    value in an otherwise carefully aligned file.

105. **iOS: `armv7` declared as a required device capability.** — OPEN,
    mobile-native-engineer. NOTE. `EnterpriseShell/Info.plist:53-55`. iOS has been 64-bit-only
    since iOS 11; the correct value is `arm64` or omission. NOT VERIFIED that this
    blocks installation — that needs a device or a build, neither of which exists in
    the cloud lane.

106. **iOS: `mdm/README.md` under-claims what the app can do alone.** — OPEN,
    mobile-native-engineer. NOTE. `:58` lists "forced full screen" as requiring supervision,
    but `UIRequiresFullScreen` is an app-declarable key needing no MDM, and the plist
    comment correctly presents it as such. Errs CONSERVATIVE — the opposite of the
    platform-honesty failure mode — but it is still inaccurate.

107. **Web: `restrict` and `deny` are the same pixel in the PWA's only chart, which
    has no legend, tooltip or axis.** — OPEN, web-engineer. BLOCKING. This confirms
    rows 76/77 by execution.
    `Overview.tsx:47-48` paints `restrict` from `--chart-4` and `deny` from
    `--destructive`. Both resolve to `hsl(0 43 60.8)` = **#C67070**. Adjacent stacked
    segment contrast = **1.0000:1** — no rendered boundary at all. A 40%-restrict /
    10%-deny bar is indistinguishable from its inverse.
    COLOURBLIND HALF: under simulated protanopia `allow` and `restrict` sit 7.98 dE
    apart — commonly treated as confusable — while restrict and deny are identical for
    everyone.
    The operator console's equivalent chart already carries that remedy (`Dashboard.tsx:83-87` added a
    `<Legend />` and a `strokeDasharray` on restrict). The PWA received neither half.
    FIX: give the chart a second channel (Legend + Tooltip at minimum, and a pattern
    or dash for restrict), and point all four `<Bar fill>` at the ratified
    `--decision-*` tokens so the palette gate can reach them.

108. **Web: the PWA still fetches fonts from Google on every cold load.** — OPEN,
    web-engineer. The @fontsource migration was applied to `signalgrid-app` and never
    to the PWA: 3 references in `index.html:19-21` plus an `@import` at `index.css:1`,
    and neither `@fontsource` package in its `package.json`.
    `review-invariants.mjs:384` lists only two SHIPPED_TREES, so the PWA falls into the
    REPORTED-not-gated branch — whose own message names the fix. CI does build this
    tree, so the remote fetch ships into the bundle.
    WHY IT MATTERS MORE HERE: a PWA is the one surface where a third-party font blocks
    first paint on bad hospital wifi, which is the exact condition it exists for.

109. **Web: an unrecognised verdict renders as NOTHING in the console's live decision
    panel.** — OPEN, web-engineer. `LiveDecisionPanel.tsx:50` indexes
    `TONE[decision.outcome]` unguarded; the same file guards the identical lookup 66
    lines later at `:116`. For an out-of-union outcome, `tone` is undefined, the verdict
    block is skipped, and the empty-state is ALSO skipped because `decision` is truthy —
    so the panel renders the preset buttons and no result.
    `"step-up"` is not hypothetical: `lib/api-zod` uses that spelling while
    `signalgrid-core` uses `step_up`, and `StatusBadge.tsx:8-9` handles both and says
    so. TypeScript cannot catch it — `v1.ts:78` is a bare cast across a fetch boundary.
    LATENT: `/v1` emits `step_up` today, so all four keys currently hit.
    WHY IT MATTERS: an unknown verdict produces NO signal — strictly worse than the
    restrictive tone. The blank card is indistinguishable from "nothing happened",
    which is the most permissive reading available.
    FIX: `TONE[...] ?? UNKNOWN_TONE` rendering the restrictive tone with the raw
    outcome as its label, and validate at the `v1.ts:78` boundary.

110. **Web: the PWA's outcome badge falls back to grey at 3.00:1 on any unrecognised
    verdict.** — OPEN, web-engineer. `OutcomeBadge.tsx:5` initialises to a zinc palette
    and only overwrites on four exact matches. Computed contrast of that fallback,
    composited the way the gate composites chips: **3.00:1**, below the 4.5 floor —
    the worst-contrast verdict rendering in the PWA, and the same shape as the historic
    3.18:1 deny finding, one state over.
    TWO doctrine violations in one line: the unknown verdict renders in the NEUTRAL
    tone rather than the restrictive one, and in text a reader may not be able to read.
    FIX: initialise to the restrictive class and render the raw outcome as the label.

111. **Web: four dead colour utilities in the PWA, two below AA, one a second red.** —
    OPEN, web-engineer. NOTE. `index.css:150-153` declares `.text-nominal`,
    `.text-anomalous`, `.text-critical` (#ef4444, **4.26:1**) and `.text-unknown`
    (#6b7280, **3.32:1**); zero uses anywhere. Someone reaching for a "critical" colour
    finds #ef4444 instead of the ratified #C67070 and nothing objects. Four
    `.text-status-*` rules are dead too.

112. **Web: a hand-maintained list claims a gate protects it; no gate reads that
    file.** — OPEN, web-engineer. NOTE. `Dashboard.tsx:310-313` pins the three launch
    connector families and asserts "the profile gate fails the build if this set
    changes." Four differently-shaped searches say otherwise: `launch-profile.mjs`
    never reads the app tree, and nothing in `scripts/` or `.github/` references
    `Dashboard.tsx`. The list is NOT yet stale — all three ids match today — but the
    claim about the gate is false. FIX: make it true (parse and diff, as
    `check-it-layer-model.mjs` already does for `route-owner.ts`) or delete the sentence.

113. **Web: the PWA manifest points at two icons that do not exist.** — CLOSED as filed (2026-09-06 check: manifest.json:9 now declares `"icons": []` — the dangling references were removed, no icons were added; an empty array satisfies any consumer that only checks the key exists),
    web-engineer. `manifest.json:10-11` declares 192px and 512px icons; neither file is
    tracked or on disk. Without them the PWA cannot be installed to a home screen,
    which is the only reason a manifest exists. Related: `start_url` is `/mobile/` and
    no Dockerfile or workflow serves that prefix, and there is NO service worker
    anywhere in the tree — so this "PWA" is a manifest and a viewport tag with no
    offline capability. No user-visible copy claims otherwise, so this is an
    expectation gap rather than a false claim.
    FIX: add the icons and wire the deploy, or trim the manifest to what is real. A
    small gate asserting every tracked manifest's `icons[].src` resolves to a tracked
    file would stop the recurrence.

114. **Web: the PWA's signal badge covers four of six signal types.** — OPEN,
    web-engineer. NOTE. `SignalBadge.tsx` branches on four values; the `SignalType`
    enum has six and `Signals.tsx:17` offers all six as filters, so the
    `network-posture` and `physical-access` filters yield all-grey screens. The
    fallback clears AA (5.28:1), so this is semantics-poor rather than illegible.
    Physical access is a first-class signal family for this product. FIX: derive the
    colour map from the enum keys so a new value fails typecheck instead of falling
    through to grey.

115. **Web: the PWA presents fixture decisions with no fixture label.** — OPEN,
    web-engineer. Overview (metrics, chart, integration health) and Decisions (list
    AND detail sheet) render synthetic data unlabelled; only `Signals.tsx:22-23`
    carries a rendered label. The console labels ten equivalents and carries an
    `AssuranceBadge` the PWA has no equivalent of.
    WHY IT MATTERS: the PWA is the surface most likely to be held up in a room, and
    "Allow Rate 94.2%" with no qualifier is a claim about a deployment.

116. **Web: the PWA's support triage surface has no `deny` scenario.** — OPEN,
    web-engineer. NOTE. `AccessSupport.tsx:22` types `Outcome` as
    `"allow" | "step-up" | "restrict"` — a deliberate narrowing of the four-verdict
    vocabulary at the type level. The one screen a support lead opens first cannot show
    the outcome they most need guidance for. The page is otherwise the most honest in
    either tree.

117. **The unsafe-claim gate reports ASSERTED and exits 0 — it can never fail CI.** —
    OPEN, devex-tooling-engineer. BLOCKING. INDEPENDENTLY VERIFIED before filing.
    `phase-gate.ts:153-160` escalates an affirmatively-asserted unsafe claim only to
    YELLOW, and `:194` sets a failing exit code only for RED, which is reachable solely
    from `redFilePattern`. Confirmed by running it: `unsafeClaims=ASSERTED`,
    `phaseLane=YELLOW`, `EXIT=0`. CI wires it as a plain `run:` step
    (`phase-pr-evidence.yml:40-41`), so the exit code is the only thing the job reads.
    CONSEQUENCE, AS ORIGINALLY FILED: a genuine certification claim merged into
    `docs/` today would print ASSERTED and the PR would go green. That second clause
    is WRONG — see the correction below. `missingValidation` at `:161-170`
    has the identical shape, despite its own comment saying drift "must actually move
    the lane, not just log a reason."
    This is the whole point of the negation-aware classifier defeated at the last step:
    the signal varies, and nothing consumes the variance.
    FIX: decide whether YELLOW fails CI. Either make the two CODE-DETECTED reasons
    (affirmative claim, missing validation) set a failing exit code while leaving the
    touch-based reasons informational, or promote an affirmative claim to RED. Either
    way the CI step must read something other than "not RED". Fix row 118 first or the
    gate turns permanently red on a disclaimer and gets switched off.
    CORRECTION, same day, found by this row's own text failing CI. The finding as
    filed OVERSTATED its consequence, and the overstatement came from checking one
    gate and concluding about the machinery — the narrow-search error this repo
    tracks, committed while filing a finding about gates.
    WHAT IS TRUE: `phase-gate.ts` does escalate an affirmative claim only to YELLOW
    and does exit 0, so ITS `unsafeClaims` signal is inert and the negation-aware
    classifier feeding it is unconsumed.
    WHAT IS FALSE: that an unsafe claim would therefore reach the default branch.
    `scripts/docs-sanity.mjs:253` collects the same class of finding and `:263` calls
    `process.exit(1)`, and it runs as its own CI job — `review-hub-ci.yml:720-735`,
    "Required docs and unsafe-claim sanity". It is not a paper gate: it FAILED this
    very commit, on the example phrases written into rows 117 and 118, before either
    row could be merged. Unsafe claims in `docs/` are gated. What is not gated is
    `phase-gate`'s own lane arithmetic.
    THE REAL FINDING, restated: the repo has TWO unsafe-claim mechanisms with
    different phrase lists and opposite enforcement. The sophisticated,
    negation-aware one cannot fail a build; the naive, negation-blind one is the only
    one that can. That split is the defect — not an absence of enforcement.

118. **The unsafe-claim classifier reads a DISCLAIMER as an affirmative claim.** —
    OPEN, devex-tooling-engineer. `unsafe-claim-classifier.ts:143-144` scopes negation
    to the text BEFORE the match, so a sentence of the form "<product> replaces no
    system of record" — where the negator is the verb's direct object — classifies as
    affirmative. Both live hits pinning `unsafeClaims=ASSERTED` are citations of
    exactly that disclaimer. (The phrase is deliberately NOT quoted verbatim here:
    writing it out trips `docs-sanity.mjs`, which is the point of the correction on
    row 117.)
    WHY IT MATTERS: it restores the defect the classifier was built to remove — a
    signal that reads the same on every run — inverted from constant-noisy to
    constant-alarming. It is invisible while row 117 stands; the moment 117 is fixed
    this becomes a permanently red gate someone will switch off.
    FIX: when the matched phrase ends in `replaces`, extend the negation window to the
    following token (`no|nothing|none`). Add BOTH directions to the proof — the
    disclaimer must clear and a genuine replacement claim followed by a trailing
    negation must still flag (that case exists at `:92-93` and must not regress).
    THE SAME DEFECT EXISTS IN THE HARD-FAILING GATE, and that is the more urgent half:
    `docs-sanity.mjs` has NO negation awareness at all. It matched the disclaimer form
    above as an unsafe claim and failed the build on it. So the negation-aware
    classifier — the one that would get this right — is wired to the gate that cannot
    fail, and the gate that CAN fail is the naive one. Fix the pair together.

119. **Five copies of the no-vendor-call scanner; one drifted permissive, and its
    self-test tests the pattern that survived.** — OPEN, devex-tooling-engineer.
    `response-accountability-proof.ts:546-553` carries 6 patterns where `nac-proof.ts`,
    `uem-proof.ts`, `entitlement-binding-proof.ts` and `service-lifecycle-proof.ts`
    each carry 9 byte-identical ones. Executed against planted lines: a static
    `import axios`, a `superagent` import, an aliased `const send = fetch`, a
    `net.connect`, and a dynamic `import("pg")` are ALL caught by the other four and
    ALL missed by this one.
    THE DANGEROUS PART: its non-vacuity self-test asserts `banned.some(...)` over a
    single planted `fetch(...)` — the one pattern that survived — so the guard reports
    "the scan can actually fire" while three classes of vendor call walk past.
    This is verbatim the failure `emit-gate-proof.ts:13-15` warns about: "four copies
    of a policy is four chances for one to drift permissive, and the drifted one is the
    one that ships." It has now happened, to the policy guaranteeing a connector family
    reaches no network.
    FIX: extract the pattern list into `scripts/src/lib/` beside `live-gate.ts` and
    have all five import it; change each self-test to assert one planted control PER
    PATTERN CLASS. Independently, add a `files.length > 0` floor to all five —
    `emit-gate-proof.ts:207` already applies exactly that floor and none of the five has it.

120. **A character class where alternation was intended makes the link checker skip
    every relative link starting with h, t or p.** — OPEN, devex-tooling-engineer.
    `operating-method-proof.ts:63` uses `[^)#http]`, which excludes the CHARACTERS
    h/t/p, not the string `http`. Executed against a control probe: `handbook.md` and
    `proofs.md` are silently dropped while the proof reports 31/31.
    The extractor-vs-audit boundary exactly: the per-link `existsSync` is perfectly
    correct about the links it receives and structurally blind to an alphabet slice.
    The `links.length >= 4` non-vacuity floor does not help — four good links satisfy it
    while a broken `handbook.md` sits unseen. Correct today by luck, not construction.
    FIX: match `\]\(([^)#][^)]*\.md)\)` and filter `^https?:` in code. Add a self-test
    asserting a `handbook.md`-shaped link is picked up.

121. **An unguarded `indexOf` slice can turn two targeted assertions into whole-file
    greps.** — OPEN, devex-tooling-engineer. NOTE. `emit-gate-proof.ts:238-241`: if
    `"\n  }"` is not found, `indexOf` returns -1, `slice(0,-1)` yields nearly the whole
    file, and the two following tests match anywhere in `mde.ts`. The FIRST `indexOf`
    fails safe (both checks fail); only the second is fail-open. The same file guards
    this correctly 116 lines earlier at `:124`, so the idiom is known here. Reported by
    reading, not by execution — the mutation guard was off-limits during a concurrent
    preflight.

122. **`proof:live-glpi` has never been executable from the path that invokes it.** —
    CLOSED 2026-09-06 (the root key exists and `pnpm run proof:live-glpi` resolves; note the proposed equality gate would fail on `proof:decision-palette`, a root-only alias — a subset rule is the right shape), devex-tooling-engineer. Registered only in `scripts/package.json`, never at
    the repo root, while `run-live-lanes.sh:387` invokes it after `cd` to the root.
    Verified: `pnpm run proof:live-glpi` -> `ERR_PNPM_NO_SCRIPT`. All seven sibling
    live proofs ARE registered at root; this is the sole scripts-only key.
    `validate-sim-macos.sh:176` enumerates `proof:*` from the ROOT manifest, so the
    harness never sees it either. Fails closed, but a 167-line proof that has never
    been runnable is not a proof — and if a Mac stands GLPI up, the failure will look
    like GLPI misbehaving.
    FIX: add the root registration, then add a gate asserting the two `proof:*` key
    sets are equal. That bijection is what would have caught this and nothing checks it.

123. **Five Postgres proofs exit 0 when skipped, and the local harness counts exit 0 as
    PASS.** — OPEN, devex-tooling-engineer. Executed all five with `DATABASE_URL`
    unset: each prints SKIPPED and exits 0. `validate-sim-macos.sh`'s `gate()` judges on
    exit code alone, so a Mac run reports five green proofs it never executed. CI does
    provision `DATABASE_URL`, so this is a LOCAL-HARNESS gap, not a CI one.
    `db-guard.ts:12-15` states the doctrine for exactly this case — "a proof that
    silently skipped would leave the gate green while testing nothing, which is the one
    outcome worse than red" — and applies it only to the disposable-cluster flag, not to
    the missing-URL branch three lines above.
    FIX: give the five a distinguishable skip exit code (the repo already uses 2 for
    refusals) and route it to the harness's existing `skip()` counter. Do NOT make it a
    hard failure — that breaks every developer without Postgres, which is how gates get
    switched off.

124. **`ladderRungs` is published as a derived figure by twelve proofs, is a literal in
    all twelve, and they disagree.** — OPEN, devex-tooling-engineer. NOTE. Ten publish
    6, one publishes 5, one publishes 3, and `verdict-attestation-proof.ts:53` defines
    an eight-rung ladder. Nothing reads the value. Inert today because the figure guard
    only holds docs to comma-formatted numbers >= 1,000 — but it sits on the same line
    as genuinely derived values, which makes it read as measured. That is the
    "fossil that looks precise" the figure guard's own header was written about. Same
    for `gateClausesPerFamily=4` in `emitter-discipline-proof.ts:140`, whose header
    still says "five families" against six entries in the array.

125. **The Graph connector reports a device MANAGED when the tenant never said
    so.** — FIXED 2026-08-25, endpoint-uem-domain. Was BLOCKING. Reproduced end to
    end before the fix, and the fix was FALSIFIED rather than assumed: restoring the
    old inference fails exactly the three defect cases (`eas`, `msSense`, a typo)
    while the three legitimate ones (no agent, `mdm`, `intuneClient`) still pass.
    THE FIX: `MDM_ENROLLMENT_AGENTS`, a conservative allowlist of the agent values
    that actually establish MDM enrollment. An agent the set does not name yields
    "unknown" — step_up — rather than "managed". `eas`, `msSense` and
    `configurationManagerClient` are absent on purpose. Six new assertions in
    `graph-connector-proof` (21 -> 27) pin BOTH directions, so the fix cannot
    degrade into "always unknown".
    `graph/posture-connector.ts:239-241` infers the affirmative state `managed`
    from a MISSING `managementState`, on the strength of any non-empty
    `managementAgent` string: `if (s === "" && a !== "") return "managed";`. Its
    four sibling normalizers in the same file — identity status, user risk,
    compliance, registration — all fall through to `unknown` on silence. This is
    the one that drifted.
    REPRODUCED through the real connector and the real composer. With
    `managementState` absent and `managementAgent` set to `eas` or `msSense` —
    both REAL Microsoft Graph values that specifically mean the device is NOT
    MDM-managed — the result is `deviceManagementState: managed` and a composed
    verdict of `compliant / none / COMPLIANT_MANAGED`. A typo string
    (`zzz-typo`) does the same. With the agent ALSO absent, the sibling behaviour
    kicks in: `unknown` -> `step_up / MANAGEMENT_STATE_UNKNOWN`.
    So adding an arbitrary string to one optional field flips a device from
    "challenge the worker" to "let them through".
    The author knew agent strings need vetting: `agent === "unknown"` is caught
    one line earlier and correctly returns `unmanaged`. The fallthrough just never
    got the same treatment. `graph` is one of only two families addressing a real
    `graph.microsoft.com` tenant, so this is on the shipped read path.
    `proof:graph-connector` is green (20/20) and no proof ever feeds a
    `managementAgent` into `normalizeManagement`.
    FIX: delete the two lines and fall to `return "unknown"`. If the inference is
    genuinely wanted it must be an ALLOWLIST of the agent values that actually
    denote MDM enrollment (`mdm`, `easMdm`, `intuneClient`,
    `configurationManagerClientMdm`), never `a !== ""`. Add a proof case feeding an
    unrecognised agent with no `managementState`.

126. **A rotation dated in the FUTURE grades as current, and the record says so
    while carrying a negative age.** — FIXED 2026-08-25, iam-domain. Was BLOCKING.
    Reproduced before the fix and FALSIFIED after: removing the guard fails exactly
    the three new assertions.
    THE FIX: a negative age yields `standing = "unknown"` and `ageDays = null` — not
    `overdue`, because a lapse nobody established must not be asserted either. The
    `no_policy` and `never_rotated` branches got the same treatment so no branch can
    emit a negative age as if it were a reading. Four new assertions in
    `credential-rotation-proof` (18 -> 22).
    `credential-rotation/normalize.ts:90-91` computes `ageDays` and compares it to
    the policy bound with no check that the timestamp is in the past. A future
    `lastRotatedAt` yields a negative age, trivially `<= maxAgeDays`, so the record
    grades `within_policy` -> `rotation_current` / `none` /
    `rotationConfirmed: true`.
    REPRODUCED, same record past-dated then future-dated: the past-dated one gives
    `rotation_overdue / step_up / CREDENTIAL_ROTATION_OVERDUE`; the future-dated one
    gives `{"standing":"within_policy","ageDays":-3653}` and a verdict of
    `rotation_current / none / ROTATION_WITHIN_POLICY` with
    `rotationConfirmed: true` and the summary "Within its rotation policy and held
    in the managed vault."
    THE ASYMMETRY IS THE FINDING. Four families in the same range guard this
    explicitly, each with a comment saying why — `local-authority/normalize.ts:127`
    ("Issued in the future relative to the reference — an unreadable clock, not the
    freshest grant ever minted"), `access-governance/evaluate.ts:90`,
    `carrier/evaluate.ts:136` and `location-services/evaluate.ts:79` (both via
    FUTURE_SKEW_TOLERANCE_MS), and `device-management-health/graph-transport.ts:93`.
    `credential-rotation` has none. Absence corroborated three differently-shaped
    ways plus `check:absence` (CORROBORATED across 4 probes).
    `proof:credential-rotation` is green (18/18) because it enumerates the
    NORMALIZED enum space and feeds only four hand-written past-dated instants —
    the wire-level temporal edge is outside what it enumerates by construction.
    WHY IT MATTERS: clock skew, a bad timezone conversion on a bridge, or anyone who
    can write that field gets a permanent clean bill on a static secret that has
    never been rotated — and `rotationConfirmed: true` is an affirmative other
    surfaces read as fact.
    FIX: treat a negative age as `unknown`, matching `local-authority`'s shape — NOT
    `overdue`, which would assert a lapse nobody established. The `no_policy` branch
    needs the same. Add a proof case feeding a future `lastRotatedAt`.
    CORRECTION, 2026-09-02. "Matching `local-authority`'s shape" was true of ONE of
    its two branches. A survey that read every now-comparison in `lib/*/src` — rather
    than trusting this entry — found `local-authority`'s `no_grant_policy` branch
    computing `Math.floor((now - issued) / 1000)` with NO future guard, publishing
    `grantAgeSeconds: -21600` for a grant dated SIX hours ahead (REF `12:00:00Z`,
    `grantIssuedAt` `18:00:00Z`). This entry and the proof's own comment both said
    "seven hours" and `-25200` for one day; re-planting the pre-fold line and running
    `pnpm run proof:local-authority` prints `... not a negative one (got -21600)`,
    `summary=fail (36/37)`. The standing was
    never wrong (`no_grant_policy` either way); the published age was. The copy this
    entry held up as the correct one was only three-quarters correct, which is the
    argument for one body rather than five good comments. Fixed by folding both
    branches onto `utils/freshness.ts`'s `ageMs`, pinned by a new assertion in
    `local-authority-proof` (36 -> 37) that fails on the pre-fold code. The same
    survey measured the tolerances and got that wrong too. It reported TWO distinct
    values, 60s and zero, "not the three an earlier audit reported". There are THREE,
    and the earlier audit was right: the survey ran through
    `scripts/check-freshness-divergence.mjs`, whose `now` pattern excluded a literal
    `Date.now()`, so `lib/location/src/validate.ts` — `Date.now() - input.observedAt`
    rejected at `< -30_000` — was never matched and never counted. Measured set, from
    `grep -rnE 'SKEW_MS|SKEW_TOLERANCE_MS|< *-[0-9_]+' lib/*/src --include=*.ts | grep -vE '//'`
    (six lines, three files): **60s** in `utils/freshness.ts`
    (`FUTURE_SKEW_TOLERANCE_MS`), **60s** in `verdict-attestation/attest.ts:18`
    (`DEFAULT_MAX_SKEW_MS`), **30s** in `lib/location/src/validate.ts:10`, and **0**
    everywhere else. The remembered "5 minutes" is `DEFAULT_MAX_AGE_MS = 5 * 60_000`,
    a staleness BOUND and not a skew tolerance — that part stands. The 30s site is
    marked local-by-design, not folded: `@workspace/location` declares no dependency
    on `@workspace/integrations`, and it REJECTS the input rather than resolving to
    `unknown`. Divergence is now gated by `scripts/check-freshness-divergence.mjs`,
    which — corrected the same day — no longer exempts a whole file for importing the
    helper (that hole covered twelve files) and no longer accepts an empty exemption
    reason.

127. **`edr-threat` reports full protection from an unreadable signature age,
    contradicting its own comment.** — OPEN, secops-domain. `evaluate.ts:87-88`
    guards only `null` then bare-compares with `>=`. A NaN on either side is false,
    so an unreadable freshness reads as FRESH, `protectionHealthy` goes true, and
    the verdict is `protected / NO_THREATS_HEALTHY / none`. The caller-posed
    `staleSignatureHours` at `:65` has no validation at all.
    REPRODUCED on an endpoint whose signatures are more than a decade out of
    date: the default bound gives `degraded_protection / step_up`; a NaN bound, a
    string bound, and `signatureAgeHours = NaN` all give `protected / none`.
    `NaN` is type-legal — `types.ts:70` declares `number | null`.
    The file's own comment at `:84-86` asserts the opposite of what it does: "We
    never report protection as fresh when its freshness cannot be confirmed."
    The correct pattern is two files over: `app-update/evaluate.ts:86` guards its
    caller-posed bound with `typeof` + `Number.isFinite` + `< 0`.
    SCOPED HONESTLY: should-fix, not blocking, because the shipped
    `edr-connector.ts` DOES guard the field with `Number.isFinite`. But the guard
    lives in one of two paths into the evaluator, and `evaluateThreatPosture` is
    re-exported from the public entry point, so any lane can call it with a record
    it built itself. `proof:edr-threat` is green (36/36) and the option has zero
    callers, zero tests and zero proof cases.
    FIX: make the value guard positive — stale unless
    `Number.isFinite(x) && x < staleHours` — and validate the bound with the
    `app-update` shape.

128. **The ITSM aggregate reports `unhealthy` for a call the gate never let it
    make.** — OPEN, itsm-ops-domain. When the emit gate suppresses, all eight
    adapters' `healthCheck()` return `false` without touching the network, and
    `adapter.ts:266-274` records that as `'unhealthy'`. The `ITSMAdapterHealth` type
    carries `'unchecked'` for exactly this case and the aggregate already uses it
    correctly for a DIFFERENT flavour of the same ignorance.
    REPRODUCED, both flavours side by side: gate suppressed with zero network
    traffic gives `{"zendesk":"unhealthy"}`; an adapter that exposes no healthCheck
    gives `{"jira":"unchecked"}`. Same ignorance, two answers.
    The docstring immediately above that loop names the principle it breaks: "'we
    never asked' and 'we asked and it is fine' arrived at the caller as the same
    value… the unearned affirmative this repository keeps finding." Reporting
    `unhealthy` for a call never made is that fabrication with the sign flipped.
    LOWER STAKES than 125/126 because it fabricates a NEGATIVE, not a grant — but it
    sends an operator chasing eight simultaneous vendor outages that are not
    happening, and the third state that would tell the truth is already in the type.
    FIX: widen `healthCheck()` to return `ITSMAdapterHealth` and have each adapter
    return `'unchecked'` with the suppression reason.

129. **Two more families accept an unvalidated staleness bound.** — OPEN,
    network-domain (carrier) and physical-ot-domain (location-services). NOTE.
    Both read `options.staleAfterMs ?? DEFAULT` with no finiteness check. They fail
    CLOSED on NaN but OPEN on Infinity: reproduced against a 7.5-year-old fix, an
    Infinity bound turns `off_premises_stale / STALE_LOCATION_FIX / locate` into
    `on_premises / INSIDE_AUTHORIZED_GEOFENCE / none`. Infinity is a less likely
    accident than NaN, which is why this is a note — but it is the same missing
    guard as row 127 and the three sites are one change.

130. **`deviceResolver`'s class docstring names a source that does not exist.** —
    OPEN, endpoint-uem-domain. NOTE. `deviceResolver.ts:52-60` lists four
    aggregation sources; the fourth, "FleetDM (posture/telemetry)", has no code
    path — `resolve()` and `aggregate()` try registry, UEM and NAC only, and
    `DeviceIdentity.source` cannot even represent a FleetDM result. Same class as
    the `registerVerifiedPrincipal` docstring in row 86: prose asserting a check or
    a source the code does not have.

131. **The empty-candidate backstop is present in five families and absent in
    ten.** — OPEN, secops-domain (to arbitrate, as the largest holder). NOTE, and
    recorded so the divergence is a decision rather than an accident. Five families
    end with an explicit "not positively confirmed and nothing objected -> force
    step_up" guard, each with its own reason code so a firing is visible. Ten do
    not. No reachable hole was found in the ten — their normalizers coerce every
    unrecognised value into an enum member that pushes a candidate — so this is a
    generational difference, not a live defect. It rests on a real split: the
    hardened connectors carry `oneOf` allowlists, `ownValue` own-property reads and
    a `hasUnrecognizedKey` prototype walk; seven others carry none of the three.
    Rows 125 and 127 are both instances of a non-confirmed input reaching a grant,
    which is exactly what this guard exists to catch late.

132. **`createTicketTemplate` mints ids at millisecond resolution.** — OPEN,
    itsm-ops-domain. NOTE. `itsm/store.ts:780` uses `custom-${Date.now()}`; two
    templates created in the same millisecond collide and `getTicketTemplate`
    resolves by `find`, returning the first. Not a decision path and not a doctrine
    violation — but `generateId()` using `crypto.randomUUID()` sits sixty lines
    above and is what every other id in the file uses.

133. **The syslog adapter reports the collector reachable without opening a
    socket — in a family that has no transport at all.** — FIXED 2026-08-25,
    secops-domain.
    REPRODUCED FIRST: at dev tier against a hostname that does not resolve,
    `healthCheck()` returned **true** while `sendEvent()` returned **suppressed**
    in the same process.
    THE FIX: the gate comes first, matching splunk/sentinel/webhook and the ITSM
    set — a health check is still a live call. But even when policy DOES permit
    emission there is nothing here to probe, so the answer stays `false`. That is
    not a failure report; it is "this cannot deliver", which is true. When a real
    transport lands this becomes gate-then-probe like its siblings.
    GATED by two assertions in `emit-gate-proof` (83 -> 84): the gate must be
    consulted, AND the config-truthiness shortcut must be gone. Two rather than one
    because either alone passes on the wrong thing, and a future gate-then-probe
    implementation should keep the first while changing the second.
    FALSIFIED: restoring the original one-liner fails both (82/84); restored, 84/84.
    NOTE, and it is the session's recurring shape: my own docstring explaining the
    old delivery-status lie CONTAINED the literal string the proof scans for, and
    failed the assertion that exists to keep it out of the code. Named obliquely now.
    ORIGINAL FINDING FOLLOWS.
    `syslog/transport.ts:173-179` is `return !!(this.config.host &&
    this.config.port)`. `port` is defaulted in the constructor and `host` is
    required, so this returns TRUE for every adapter that can be constructed —
    including this one, whose own comment at `:121` reads "THERE IS NO TRANSPORT,
    AND THIS NO LONGER CLAIMS OTHERWISE" and whose `sendEvent` throws on the live
    path.
    REPRODUCED at dev tier, no live flag, no credential, a hostname that does not
    resolve: `syslog healthCheck() = true` while `splunk`, `webhook` and
    `sentinel` all return `false`. In the same process `sendEvent()` returns
    `{"status":"suppressed"}`.
    WHY IT MATTERS: the docstring says "verify syslog server is reachable"; it
    verifies that a config object was populated. A SIEM forwarder reporting itself
    healthy while it cannot send anything defeats the audit trail it exists to
    produce — and does so most convincingly during an incident. This is the same
    unearned-affirmative shape as row 128, in the opposite direction.
    WHY NO GATE CAUGHT IT, checked three ways: `check-ungated-fetch.mjs`
    short-circuits on files with no fetch-like callee and this file has none;
    `check-read-error-swallowing.mjs` explicitly excludes `healthCheck()` on
    reasoning that covers a false, not a true; `emit-gate-proof.ts` asserts syslog
    opens no socket and throws when live, but asserts nothing about `healthCheck`.
    FIX: gate first (`resolveEmission()`, return false when not live), then either
    probe for real or — given there is no transport — return false with the reason.
    Add the assertion to `emit-gate-proof.ts` so a fifth instance cannot arrive
    quietly.

134. **A GARBLED readiness budget grades strictly better than no budget at all.** —
    FIXED 2026-08-25, iam-domain. Shipped in #309.
    THE FIX: a distinct `READINESS_BUDGET_UNREADABLE` rung, kept SEPARATE from
    UNPOSED because "you did not ask" and "your question is unreadable" have
    different owners and different fixes. Reads through the shared
    `utils/posed-bound.ts`.
    A FIRST PASS WAS INCOMPLETE and a probe caught it: `posedBound` treats
    `undefined` as "not posed" by contract, which is right at its own boundary and
    wrong inside a budget object where the threshold is not optional — so the
    misspelled-key case still granted. Closed, and pinned by its own assertion.
    HEADER CORRECTED 2026-08-25, same reason as row 83.
    ORIGINAL FINDING FOLLOWS. `session-readiness/evaluate.ts:93-113`, root cause at
    `index.ts:107,136` where `budget: opts.budget ?? null` passes through
    unvalidated while `elapsedToUsableSeconds` beside it goes through `asSeconds`.
    REPRODUCED, identical record each time (42s elapsed, usable, measured,
    critical risk):
    · budget 30 (honest)      -> `not_ready / restrict / READINESS_BUDGET_EXCEEDED`
    · budget null (unposed)   -> `degraded / monitor / READINESS_BUDGET_UNPOSED`
    · budget NaN              -> `ready / none / SESSION_READY`
    · budget Infinity         -> `ready / none / SESSION_READY`
    · budget `{}` (typo key)  -> `ready / none / SESSION_READY`
    MECHANISM: `elapsed > threshold` is false for NaN, Infinity and undefined, so
    no EXCEEDED candidate fires — AND because `budget !== null`, the honest
    UNPOSED monitor arm is skipped too. Both the finding and its fallback are
    switched off at once, and the seed grant survives.
    The comment at `:107-113` states the intent exactly — the unposed rung "must
    NOT be suppressible by omitting the budget" — and an unreadable threshold
    suppresses it just as completely. The `{}` case is the realistic one: a config
    with a misspelled key satisfies `ReadinessBudget` structurally.
    FIX: validate the pose where it enters, as `pacs-access` does. A budget whose
    `thresholdSeconds` is not a finite positive number is a GARBLED pose and needs
    its own raising rung, not the seed grant. Validating in the normalizer alone is
    not enough — `evaluateSessionReadiness` is exported and callable directly.

135. **A non-finite caller threshold turns an abandoned device into a full custody
    grant.** — FIXED 2026-08-25, physical-ot-domain. Shipped in #309.
    THE FIX: both bounds read through `utils/posed-bound.ts`, where a garbled pose
    yields `null` and each comparison treats null exactly as it treats an
    unconfirmable MEASUREMENT — it raises. The helper exists so the next family
    inherits the guard rather than the accident.
    MY FIRST ASSERTIONS PASSED FOR THE WRONG REASON: they asserted "does not grant"
    on a record where the ABANDONMENT axis fired independently, so they passed with
    the fix-age guard removed. Each axis is now isolated, and the proof records
    WHICH cases discriminate — NaN and Infinity do; zero and negative pass either
    way, because any positive age satisfies `>= 0`. Four falsifiable, two
    intentional.
    HEADER CORRECTED 2026-08-25, same reason as row 83.
    ORIGINAL FINDING FOLLOWS. `rtls-custody/evaluate.ts:56-57,102,107,109`.
    REPRODUCED, identical badge-less record in an authorized clinical zone with a
    fix age and dwell of 99,999s: defaults give `abandoned / alert / ABANDONED`;
    `staleFixSeconds` of NaN or Infinity both give `in_zone / none / CUSTODY_OK`.
    THE CROSS-FAMILY ASYMMETRY IS THE FINDING. Of the five numeric evaluator
    options in the m-z range, exactly one validates:
    · `pacs-access` `maxEventAgeSeconds` — GUARDED; executed, NaN/Infinity/0/-1 all
      yield `unknown`. Its comment states the rule: "a garbled pose is a question we
      cannot read — never answered optimistically."
    · `rtls-custody` `staleFixSeconds` / `abandonDwellSeconds` — FAIL OPEN.
    · `network-nac` `staleAfterMs` — accidentally safe (NaN still yields step_up).
    · `passkey-assurance` `expectedCredentialCount` — accidentally safe
      (`size !== NaN` is always true).
    The two safe ones are safe by ARITHMETIC ACCIDENT, not by a guard, so they will
    drift the moment a comparison changes shape.
    WHY IT MATTERS: this family's header says "a device we can't physically see is
    never mistaken for one in good custody." Every internal fail-safe in the file is
    careful, and all of it is defeated by one unreadable option from the caller.
    FIX: give all four options `pacs-access`'s treatment, ideally as one shared
    helper so the next family inherits the guard rather than the accident.

136. **The webhook URL safety guard keys off `NODE_ENV` while the delivery gate
    keys off `SIGNALGRID_TIER`.** — FIXED 2026-08-25, secops-domain.
    TWO DEFECTS, and the second was not in the original finding: the guard was
    gated on the wrong variable AND, even when it fired, it blocked only four
    loopback spellings. **Every RFC1918 address passed regardless.**
    THE FIX, two rules deliberately different in kind:
    · The SSRF BLOCK IS NOW UNCONDITIONAL — loopback, IPv6 loopback and
      unspecified, RFC1918, RFC6598 shared space, and IPv4/IPv6 link-local are
      refused in EVERY tier. There is no tier in which posting a signed customer
      payload at 127.0.0.1, or at a neighbour on the internal network, is intended.
      "We are not sending anyway" is not a reason to accept an internal target.
    · The HTTPS RULE is gated on live delivery, and the flag is passed in from the
      SAME `resolveWebhookDelivery` result that decides whether to send at all. One
      resolution, read once, per call — the two can no longer disagree. A suppressed
      tier may still point a fixture at a plain-HTTP mock.
    The module-load `IS_PRODUCTION` constant is deleted. A gate that cannot be
    varied per call cannot be proven, which is why this went uncovered.
    MEASURED in both tiers: with tier=prod, live=true and NODE_ENV unset — the exact
    reachable case — every internal target is refused and a public HTTPS target is
    still accepted. Same in a suppressed tier.
    GATED by 21 assertions in `webhooks-proof` (48 -> 69), including a NON-VACUITY
    check per tier, because a validator that refused EVERYTHING would otherwise
    satisfy all sixteen SSRF assertions.
    FALSIFIED: restoring the original guard fails 18 of them (51/69); restored,
    69/69. That proof previously exercised ONLY `resolveWebhookDelivery` and never
    the URL validator, which is exactly why nothing covered this.
    NOTE: my first placement of those assertions sat AFTER the summary line, so the
    proof printed "pass (48/48)" while 18 checks failed and it exited 1. Moved above
    the summary — a figure that does not count the checks beneath it is the defect
    class this repo keeps a figure guard for.
    RESIDUE, recorded 2026-08-25 rather than fixed, and the reason is scope. The
    block matches LITERAL address ranges. A hostname is not resolved, so
    `internal.example.com` pointing at 10.0.0.5, or any of the public
    resolve-to-loopback services, walks straight through every rule above. The naive
    case is covered; the deliberate one is not.
    CORRECTED 2026-09-02, and the correction is the point of re-reading an entry
    rather than trusting it. This paragraph said the exposure was "fire-and-forget,
    so an operator who aims one at internal infrastructure gets blind SSRF … rather
    than a response body". BOTH HALVES WERE FALSE AT THE TIME OF WRITING.
      · NOT BLIND. `dispatchToEndpoint` reads `await response.text()` and
        `recordDelivery` persists up to 1000 bytes of it to the per-webhook delivery
        log a tenant admin opens. The answer from the internal service came back and
        was stored.
      · A SECOND HOP EXISTED AND THIS ENTRY NEVER NAMED IT. No fetch in any of the
        six emitter families set `redirect`, so all 42 inherited undici's default
        `follow`, and `validateWebhookUrl` guards only the FIRST hop. Measured
        2026-09-02: a 307 from the configured host delivered the full signed body to
        an unvalidated loopback origin and the adapter reported `sent`.
        `X-Webhook-Signature` survives a cross-origin redirect (undici strips
        `Authorization`, not this); so the address rules could be satisfied by hop one
        and defeated by hop two, with the operator's own configured host doing the
        redirecting. That is not a narrowing of the SSRF finding — it is a bypass of it.
    FIXED 2026-09-02, WITH ITS SCOPE STATED. This entry first said "every outbound
    fetch in lib/integrations/src/integrations/**", which overshoots by about half:
    all 42 outbound fetches in the six emitter families set `redirect: 'manual'`, and
    the sites OUTSIDE those families (graph, passkey-assurance,
    device-management-health and the rest) do NOT — `check-ungated-fetch.mjs` prints
    them as REPORTED, not gated, with the ratio, on every run. Both figures here are
    derived by `check-derived-doc-figures.mjs` (rows `redirect-refusing-sites` and
    `redirect-emitter-families`), so the sentence moves when the tree does; the
    denominator deliberately is NOT frozen in prose, because a second derivation of
    it disagreed with the gate's own and two counts of one thing is drift.
    A 3xx is a PERMANENT refusal named by status and
    Location HOST, counted `failed`, recorded where the family records rows, and never
    retried, across the 6 emitter families that refuse redirects. `scripts/check-ungated-fetch.mjs` asserts the option on the call beside
    the AbortSignal assertion (planted-string self-test), and `proof:emitter-discipline`
    drives a 307 through the real adapter and asserts one attempt, the named reason,
    and that the Location HOST — not the attacker's full URL — reaches the log. Two
    families that POSTed to `config.url` with no guard at all (`siem/webhook.ts`,
    `itsm/generic-webhook.ts`) now call the same validator, moved to
    `adapters/url-guard.ts` because a guard only one of its three callers can reach is
    a guard in the wrong file.
    THE RESIDUE IS TWO THINGS, AND AN EARLIER DRAFT OF THIS LINE SAID ONE. It read
    "the residue after this batch is DNS resolution only", and that was false when
    written: the guard was called on three config fields named `url`, and ELEVEN other
    operator-supplied URL fields never reached it. Reproduced 2026-09-02 against a real
    socket — a Splunk `hecUrl` of `http://127.0.0.1:<port>` at prod +
    `SIGNALGRID_LIVE_INTEGRATIONS=true` POSTed the whole event, with the HEC token in
    the `Authorization` header, to loopback, and `sendEvent` returned status `sent`.
      · NOW GATED, and no longer residue: `siem`'s `hecUrl` (Splunk HEC — the adapter
        appends only the fixed `/services/collector` path) and `itsm`'s stored
        `webhookUrl`, guarded as a zod refinement where the credential is PARSED,
        because nothing fetches that field yet and a check at a call site that does not
        exist guards nothing.
      · STILL UNGUARDED, and REPORTED rather than claimed: the vendor-tenant hosts —
        `itsm:instanceUrl` (ServiceNow, Freshservice, Zendesk, ManageEngine, Ivanti,
        BMC Helix, and the ITSM config store), `itsm:baseUrl` (Jira), `itsm:tokenUrl`
        (BMC Helix) and `telemetry:baseUrl` (FleetDM). What is missing on these is the
        DESIGN, not the call: whether an on-premise ServiceNow at 10.x is a legitimate
        deployment is undecided, and refusing one would break it. The split is written
        down with a reason per field in `OPERATOR_URL_FIELDS`
        (`lib/integrations/src/integrations/adapters/url-guard.ts`) and
        `check-emitter-wire-discipline.mjs` asserts that registry against the fields it
        DERIVES from source, so an unclassified new field fails the build.
      · DNS RESOLUTION, on every field including the gated ones: the rules match the
        literal address in the URL. A hostname that RESOLVES to an internal address
        still passes. The next paragraph says what closing that would cost.
    WHY THE DNS HALF IS STILL NOT BEING FIXED: `webhooks` sits in the DEFERRED list in
    `scripts/launch-profile.mjs`. The URL is set by a tenant admin rather than an
    anonymous caller, which bounds who can aim it — it does not make the answer
    unreadable, and this entry used to claim it did.
    WHAT WOULD ACTUALLY CLOSE IT, so the next person does not re-derive it: resolve
    the hostname at dispatch time and apply the SAME range rules to every returned
    address, A and AAAA both. That is defence in depth, not a proof — resolution and
    connection are two separate lookups, so a record that changes between them
    (classic DNS rebinding) defeats it. Closing THAT means connecting to the
    validated address directly and carrying the hostname in the Host header, which
    is a custom agent and a materially bigger change than the check itself. State
    which of the two is being bought before building either.
    ORIGINAL FINDING FOLLOWS. `webhooks/dispatch.ts:32`
    reads `IS_PRODUCTION` from `NODE_ENV` AT MODULE LOAD and uses it at `:96,101`,
    while `resolveWebhookDelivery` at `:75-86` reads `SIGNALGRID_TIER` and
    `SIGNALGRID_LIVE_INTEGRATIONS` at call time.
    REPRODUCED in two processes, both with `SIGNALGRID_TIER=prod` and
    `SIGNALGRID_LIVE_INTEGRATIONS=true`. With `NODE_ENV=production` a
    `http://127.0.0.1:9/hook` target is rejected before delivery is recorded. With
    `NODE_ENV` UNSET the same URL passes the guard and reaches the signing step —
    as do `http://localhost:9/hook` and `http://192.168.0.5/hook`.
    WHY IT MATTERS: two gates guard one outbound path and disagree about what
    "production" means. A deployment that sets the repo's OWN tier vocabulary to
    prod and turns live integrations on has done everything this codebase asks, and
    still gets plain-HTTP delivery of an HMAC-signed payload to loopback or RFC1918
    — an SSRF surface pointed at whatever runs beside the process. Reading it at
    module load makes it unvariable per call, which is the very defect the comment
    at `:70-73` names while leaving the constant two lines above it.
    `webhooks-proof.ts` only exercises `resolveWebhookDelivery` and never calls
    `dispatchToEndpoint`, so nothing covers this.
    FIX: key the URL rules off the same call-time resolution the delivery gate uses
    and delete the module-load constant. Consider making the loopback/RFC1918 block
    unconditional — there is no tier in which posting a signed customer payload at
    127.0.0.1 is intended.

137. **A delivery the gate deliberately withheld is retried to exhaustion and
    dead-lettered as a failure.** — OPEN, secops-domain.
    `webhooks/dispatch.ts:253-298` — `isPermanentError` does not recognise
    `suppressed`.
    REPRODUCED at dev tier with a shortened 4-attempt config: `dispatchEvent`
    returns `{"dispatched":1,"succeeded":0,"failed":1}`, four delivery rows all
    reading `suppressed`, and one DLQ entry whose `lastError` is the suppression
    reason itself. Under the SHIPPED defaults the jittered backoff sums to ~33.6
    seconds of sleeping before dead-lettering.
    The `suppressed` field's own docstring at `:55-61` says a caller that cannot
    tell suppression from failure "would report 'webhook failed' for a tier that is
    never supposed to send". `dispatchWithRetry` is that caller. In dev and alpha —
    the tiers developers actually run — every event sleeps ~33s, writes six rows,
    reports a failure, and dead-letters a payload that was never meant to leave. The
    DLQ is what an operator reads during an incident, and it fills with entries
    describing policy working correctly.
    FIX: check `result.suppressed === true` explicitly and return before the loop
    with no DLQ write; count suppressed separately from failed.

138. **`addToDLQ` hardcodes an attempt count it did not observe.** — OPEN,
    secops-domain. NOTE. `webhooks/store.ts:357` is `attempts: 6, // After max
    retries`. Reproduced: with `maxAttempts: 4` and four attempts actually made, the
    DLQ entry still reads 6. Small, but it is a record asserting a number nobody
    counted, in the artefact an operator reads to reconstruct what happened.

139. **A dead safety-shaped constant sits beside two "unvalidated" warnings.** —
    FIXED 2026-08-25, secops-domain. `webhooks/store.ts` declared an environment
    constant and never read it, directly above two warnings about unvalidated input,
    so a reader scanning that file for guards counted one that did not exist. Removed,
    with a comment saying why nothing replaces it: the real environment decision lives
    in `dispatch.ts`, is passed in rather than captured at module load, and belongs in
    exactly one place. `pnpm run typecheck` clean.

140. **`vuln-scan` lets a non-finite CVSS into the evidence field while a sibling
    guards the same shape.** — OPEN, secops-domain. NOTE, and NOT a fail-open on
    the decision path — that was checked rather than assumed. `vuln-connector.ts:131`
    uses a bare `typeof === "number"`, so NaN and Infinity pass; but
    `normalizeSeverity`'s CVSS fallback tests `>=9`, `>=7`, `>=4`, `>0`, all false
    for NaN, so it lands on `unknown` and the evaluator's SEVERITY_UNVERIFIED arm
    handles it. Infinity maps to `critical`, which tightens.
    Still worth recording: `cvssScore` travels into the normalized finding and out
    to whatever renders evidence, carrying NaN or Infinity as if it were a reading,
    and `rtls-connector.ts:139-146` guards the identical shape one directory away.

141. **CHECKED AND CLEAN, recorded so it is not re-litigated: every m-z family
    raises on total ignorance.** — CLOSED, secops-domain. A maximally-unknown
    normalized input was built for all 21 evaluators in the m-z range and called
    with NO options. Every one raised — `step_up` or `monitor`, never a grant:
    macos-posture, ot-posture, peripheral-control, vuln-scan, rtls-custody,
    oauth-consent, token-binding, sso-session, pacs-access, platform-sso,
    policy-binding, shift-context, passkey-assurance, task-exception, sse-egress,
    uem, network-nac, observability-integrity, session-readiness,
    service-lifecycle, response-accountability. ZERO grants.
    The cross-family suspicion that opened that read — that `covered ?? true` (17
    occurrences) defaults a coverage flag to the permissive value — DOES NOT HOLD.
    Also verified: every family in that read's range (the list above) carries a tier + live-integrations gate,
    so no ungated live vendor call exists there; and the two `switch` statements
    without a `default:` on a decision path (`response-accountability:246`,
    `service-lifecycle:291`) are compiler-enforced exhaustive over closed unions,
    which is STRONGER than a default arm, not weaker.
    A clean read is a result. This row exists because "nobody checked" and "checked,
    nothing found" are different states and only the ledger tells them apart.

142. **Seven "approval gate" assertions and their violation counter are computed
    from a literal the proof writes itself, and none of the seven gates exists.** —
    FIXED 2026-08-25, devex-tooling-engineer. Was BLOCKING.
    THE FIX derives everything from the actions the simulator actually ROUTED —
    938 of them across the baseline and 231 mutations — and publishes those instead
    of the invented array. Assertions 783 -> 773: fourteen fabricated ones deleted,
    four derived ones added.
    WHAT IS ASSERTED NOW, and each was MEASURED before it was claimed:
    · Non-vacuity first — the routed set is non-empty across 7 distinct kinds.
      Without this the rest passes trivially on an empty set, which is how the old
      version proved nothing while reporting success.
    · No routed action is a device-mutating kind. THIS IS THE REAL CONTENT of the
      old literal: quarantine, lock, revoke, disable and push-remediation are
      emitted NOWHERE, and that absence is now checkable rather than asserted.
    · Every routed action is simulated-only — 0 violations, measured across all 938.
    · `request_remediation` is approval-gated — 62 emitted, all true.
    WHAT IS DELIBERATELY **NOT** ASSERTED, because it is false: "high severity
    implies approval". Of 674 actions at high or critical severity, **405 carry
    `approvalRequired: false`** — create_ticket, queue_retry and route_to_owner are
    notification and bookkeeping, not changes to a device. Asserting the tidier
    invariant would have replaced a fabricated gate with a wrong one.
    THE PER-ACTION CHECK, which used to read `typeof action.approvalRequired ===
    "boolean"` and therefore passed for `false`, now pins the VALUE against the
    kind's contract.
    FALSIFIED BOTH WAYS. Planting `simulatedOnly: false` fails 31 assertions and
    drives the violation counter from a structural 0 to **938** — it counts real
    actions now. Dropping approval from the remediation request fails 8. Restored,
    773 pass and the proof exits 0.
    THE EVIDENCE FILE no longer carries the fabricated array; it publishes
    `routedActionKinds`, `deviceMutatingKindsEmitted` (empty) and
    `routedActionCount` — observations rather than a claim the proof wrote itself.
    ORIGINAL FINDING FOLLOWS.
    `signalgrid-grid-proof.ts:102-109` builds `highRiskActionGates` by `.map`-ing a
    list of seven action NAMES and stamping `{simulatedOnly: true, approvalRequired:
    true}` on every element. `:247-249` then filters that same array for any element
    where either flag is `false`. The count is structurally zero. Fourteen assertions
    read the same two literals.
    THE NAMES CORRESPOND TO NOTHING. Across baseline plus 231 mutations the simulator
    emitted only: alert_operator, create_ticket, queue_retry, record_audit,
    request_remediation, route_to_owner, verify_remediation. No `quarantine`, no
    `lock device`, no `revoke session`, no `disable account`, no `push remediation`,
    no security-rule action.
    The one place REAL actions are checked reads
    `typeof action.approvalRequired === "boolean"` — and `false` is a boolean, so an
    action that dropped its approval requirement passes.
    The fabricated array is also serialised under `highRiskActionGates` into the
    grid-proof evidence JSON that `pnpm run proof:signalgrid-grid` generates into
    `artifacts/proof/` (gitignored), so the invented result LEAVES the proof as
    published evidence. The run prints "approval-gate violations: 0" and exits 0.
    FIX: delete the literal. Derive the gate set from the routed actions the simulator
    actually emits, classify by kind/severity, and assert every high-risk action
    carries both flags true — plus a non-vacuity assertion that the class is non-empty,
    so an empty classification fails instead of passing. Change the real-action check
    from a typeof test to the value the risk class demands. Stop writing the literal
    into the evidence file.

143. **`phase:summary-check` always reads the static template, so a CI gate verifies
    that a committed file contains its own bullet list.** — OPEN,
    devex-tooling-engineer. `phase-summary-check.ts:8-11` resolves
    `process.env.PHASE_SUMMARY_FILE ?? "docs/AUTOMATION_PHASE_TEMPLATE.md"`, and that
    variable is set NOWHERE in the repo — verified across workflows and both
    package manifests. The template's own bullets are exactly the sections the gate
    requires, so it passes on every pull request, forever, regardless of what the PR
    says. A PR with no summary, no validation section and no public-safety note
    passes it.
    FIX: have the workflow point it at the actual summary under review, and make the
    script REFUSE when the resolved path is the template, so falling back can never
    read as a pass.

144. **The PR risk report computes `block_merge` and exits 0; nothing reads it.** —
    OPEN, devex-tooling-engineer. `phase-pr-report.ts` contains no `process.exit` and
    no `exitCode` assignment anywhere — it is the only gate-shaped script on the
    surface with no exit path. The workflow generates the report and uploads it as an
    artifact; no step reads `risk_lane` or `merge_recommendation`.
    WORSE, AND THIS IS THE PART THAT BITES: its `unsafeClaimPattern` is a hand-copied
    duplicate carrying 16 alternatives, while `docs-sanity.mjs`'s DENYLIST — the copy
    that actually fails a build (row 117's correction) — carries 45. The extras are
    the regulated-framework attestation claims — the four naming a health-privacy
    regime, a service-organisation audit, an international security standard and a
    federal authorisation programme. The phase lane MISSES all four. (Named
    obliquely on purpose: writing them out trips `docs-sanity.mjs`, which is the
    whole point of this row — the gate that CAN fail carries the phrases, and the
    lane that cannot does not.)
    Third defect in the same file: `unsafeClaimScan` uses a helper returning `""` on
    ANY git failure, so "git grep found nothing" and "git grep failed" both read as
    clean.
    FIX: export the pattern once and import it in all three consumers, with a proof
    asserting every consumer sees the same list length; make a RED lane fail; and
    distinguish git exit 1 from any other exit.

145. **The grid proof's secret-scan regex cannot fire on the JSON it is given.** —
    OPEN, devex-tooling-engineer. `signalgrid-grid-proof.ts:946-951` matches
    `(api[_-]?key|secret|token|password)\s*[:=]\s*[a-z0-9_\-.]{12,}` against
    `JSON.stringify(...)`. In JSON a key is followed by `"` before the colon and a
    value begins with `"` — neither is `\s`, `[:=]`, nor a member of the value class.
    Executed: three plainly-leaked credentials in exactly the serialisation shape this
    proof produces, and the check returns false. It fires only if `key: value` appears
    INSIDE a single string literal — the least likely leak shape.
    This is one of two gates standing between the fixtures and a published
    public-safe evidence file, it is aimed at the highest-severity leak class, and it
    has always passed.
    FIX: walk the parsed object rather than regexing the serialised text, and add a
    negative control — a synthetic object carrying a fake credential must make the
    check FAIL — since without one this is invisible again the moment it recurs.

146. **The SBOM's maven half collects direct quoted coordinates only, and it is the
    one ecosystem with no completeness guard.** — OPEN, devex-tooling-engineer.
    `generate-sbom.ts:256-258`. Executed against real Gradle forms: it COLLECTS a
    quoted `implementation("group:artifact:version")` and MISSES version-catalog
    references, `compileOnly`, `ksp`, `androidTestImplementation`, `classpath`, and
    every `plugins {}` entry. The committed SBOM carries 875 npm and 418 cargo
    components against SEVEN maven — the seven quoted lines, no transitives, no
    plugins — while five third-party Gradle plugins are declared across the two build
    files and reach the document not at all.
    The generator HAS a fail-closed completeness guard and it is pointed at the
    ecosystem it does not parse: `assertSwiftHasNoExternalPackages` exits 1 if a
    Swift package appears. No maven twin exists — corroborated three ways plus
    `check:absence` (CORROBORATED across 4 probes).
    WHY IT MATTERS: an SBOM is read by whoever is deciding whether to accept the
    software, and this one presents the Android surface as having seven third-party
    dependencies. It passes its own staleness gate byte-for-byte, so nothing signals
    incompleteness.
    FIX: add a `assertGradleFullyParsed()` twin that fails on any dependency-like
    call the regex did not collect, anchor the configuration alternation, and either
    resolve transitives from a committed Gradle lock or state "direct declarations
    only" in the ecosystems-covered property.

147. **Three e2e specs abort external requests without asserting none were
    attempted; the fourth documents exactly why that is wrong.** — OPEN,
    devex-tooling-engineer. NOTE. `admin-console`, `review-console` and `website`
    call `route.abort()` and stop there. `evidence-coverage-page.spec.ts:56-61`
    records the lesson in its own words — "a page that grew a webfont, a logo or an
    analytics beacon would be silently neutered by the test and ship green to a
    public marketing domain. Aborting is the setup; this assertion is the test" — and
    the lesson stayed in the file it was learned in. `website.spec.ts` is the public
    marketing site, the surface that sentence names.
    FIX: an allowlist assertion rather than `toEqual([])` (these pages do legitimately
    use font hosts), in a shared helper so the next spec inherits it.

148. **The e2e README states a test count 18 behind, in the section whose own lesson
    is that hand-maintained test claims go stale.** — OPEN, devex-tooling-engineer.
    NOTE. It says the suite "has since grown to 35"; `playwright test --list` reports
    53 tests in 10 files. Two lines below, the same section says "a README describing
    a test's live state is a hand-maintained claim, and the test itself is the only
    version of that claim that cannot go stale."
    FIX: drop the parenthetical or point at `--list`. A number in a README that no
    gate reads has two stable states: absent, or wrong.

149. **1,700 lines and 239 assertions of the decision core's own proof are
    unreviewed.** — OPEN, devex-tooling-engineer. The reader executed
    `signalgrid-core-proof.ts` and read only the reporting tail and the check helper.
    This is the largest unexamined block left on the scripts surface and it guards the
    decision path. Recorded as a coverage gap rather than a defect: nobody has looked,
    and the ledger now says so.

150. **`ladderRungs=5` in the agent-behavior proof matches nothing in its source of
    truth.** — OPEN, devex-tooling-engineer. NOTE. The family's action type has 6
    members, the unified ladder has 8, its postures have 9, and the proof exercises 4
    distinct actions. Five is none of them. The proof IS registered in the figure
    guard, so this literal is what documentation about agent-behavior gets validated
    against — a doc correctly stating "six" would be FAILED by the guard.
    CONTEXT, not a separate row: eight other proofs publish `ladderRungs=6` and all
    eight are correct today, but every one is a hand-typed literal restating a bare
    TypeScript union with no runtime value. `agent-behavior` is the copy that already
    drifted.
    FIX: convert each family's action union to a const array and emit
    `${X_ACTIONS.length}` — for all nine, not just the one that drifted.

151. **The desktop Policies page paints `fail-closed` as danger and `fail-open` as
    healthy — the product's first invariant, inverted in pixels.** — FIXED
    2026-08-25, desktop-engineer. Was BLOCKING.
    THE FIX, all three sub-items together: a new
    `artifacts/signalgrid-desktop/src/lib/outcome-tone.ts` holds one TOTAL
    `Record<Outcome, string>` plus `failModeTone`, and all three call sites now route
    through it. `fail-open` carries the warning tone and `fail-closed` the allow
    tone; an unrecognised verdict OR an unrecognised fail mode resolves to the
    RESTRICTIVE tone, never a neutral one — a fail mode we cannot read is not one we
    can vouch for. The RESTRICT legend swatch now carries the chart's own dash
    pattern instead of reproducing deny's colour without its differentiator.
    Because the maps are total over closed unions, a new verdict is now a TYPECHECK
    failure rather than a silent fallthrough to whatever the final `else` happened
    to be — which is what let these three drift apart in the first place.
    STILL TRUE, and left open as its own row: `check-decision-palette.mjs` exits 0
    both before and after this fix. It asserts a verdict is painted from a ratified
    TOKEN and has no concept of which verdict maps to which token, nor of a legend.
    The mis-mapping was, and remains, structurally invisible to it — see row 168.
    ORIGINAL FINDING FOLLOWS.
    `Policies.tsx:30-36` is a two-branch ternary: `fail-closed` gets red, everything
    else gets green. The enum is closed to two values, so the green branch is reached
    by `fail-open` and nothing else. REACHABLE WITH THE SHIPPED FIXTURE — the served
    three-policy fixture's third entry is `failMode: "fail-open"`, so the rendered
    page shows two red FAIL-CLOSED badges and one green FAIL-OPEN badge, with no
    legend to say the colours mean anything else.
    The repo's own position, verbatim: "fail-closed integrity is zero-tolerance — one
    fail-open exhausts it and can never be bought back."
    WHY IT MATTERS: red means problem and green means fine to every viewer without
    instruction. This page tells an operator the two correctly-configured policies are
    the problem and the one dangerous policy is fine — and styles the policy a
    reviewer should ask about to be scrolled past.
    TWO SIBLINGS IN THE SAME TREE, filed here because they are one fix:
    · `Handoff.tsx:118-121` sends `restrict` to the STEP-UP tone via an else branch —
      colouring a more-restrictive verdict with a less-restrictive tone. `Policies.tsx`
      itself gets this right four lines later, so two files in one tree default
      opposite ways.
    · `Dashboard.tsx:69` gives RESTRICT and DENY the identical legend swatch:
      `hsl(0 43% 60.8%)` = #C67070 for both, a computed 1.0000:1. The chart BANDS
      differentiate by dash and opacity; the legend — the only thing mapping colour to
      name — does not.
    `check-decision-palette.mjs` exits 0 on all three: it asserts a verdict is painted
    from a RATIFIED TOKEN and has no concept of WHICH verdict maps to which token, nor
    of a legend.
    FIX: swap the fail-mode branches and take the tone from the ratified tokens; make
    Handoff a four-branch chain terminating in `text-status-restrict`; give the
    RESTRICT legend swatch the chart's own dash treatment. Then extract ONE
    `outcomeTone` helper for this tree, typed as a total Record, so the three
    ternaries cannot drift again.

152. **`artifacts/signalgrid-desktop` dresses a web app as a native window, and
    the repo has a REAL desktop shell somewhere else entirely.** — OPEN,
    desktop-engineer.
    CORRECTED BEFORE IT SHIPPED, and the correction is the more useful half. The
    reading that produced this row concluded from a keyword sweep that the
    repository contained no native desktop shell of any kind. That is FALSE, and
    `scripts/check-known-false-claims.mjs` refused the commit citing
    `tauri-desktop-absent` — a claim already disproven on 2026-08-08, when the same
    absence was asserted from a stale document hours before `native/desktop/` landed
    in PR #199. A narrow-search absence error, made twice, caught by a registry that
    exists because it was made the first time.
    WHAT IS ACTUALLY THERE: `native/desktop/app/tauri.conf.json` is a Tauri 2 config
    for **"SignalGrid Assist — reference host shell"**
    (`com.signalgrid.assist.desktop`), with `Cargo.toml`, `build.rs`, `native/desktop/app/src/main.rs`
    and a full icon set, and `.github/workflows/desktop.yml` builds
    `native/desktop/core` in CI.
    WHAT SURVIVES OF THE FINDING, narrower and still worth fixing: the tree named
    `signalgrid-desktop` is a Vite WEB app, and it dresses itself as a native window
    — a status bar reading "SignalGrid Desktop · macOS / Windows / Linux", simulated
    macOS traffic-light controls, and `-webkit-app-region: drag` in `index.css:104`,
    a property that only does anything inside a native shell and is inert in a
    browser. `docs/DELIVERY_GAP_ANALYSIS.md:114` already calls that tree a
    "MISLEADING NAME — not a desktop app", and `desktop.yml:5-6` says plainly there
    is no Windows or Linux BINARY in the repository.
    SO THE REAL DEFECT IS NAME COLLISION, not a bare overclaim: one artifact is a
    web mockup wearing native chrome, another is a genuine Tauri host shell, and
    they are both called "desktop". A reader cannot tell from the names which is
    which, and the web one is the one that renders a platform claim.
    FIX: rename or relabel so the two are distinguishable; state what the web tree
    is in its status bar rather than naming three operating systems; drop or comment
    the inert drag rule. Then re-check `Downloads.tsx`'s "native shells are a
    documented next step, not shipped" — with a Tauri config and a CI job present,
    that line may now UNDERSTATE what exists, which is the opposite failure and
    equally worth correcting.

153. **Four `.bg-status-*` utilities are declared in the desktop stylesheet and used
    nowhere in that tree.** — OPEN, desktop-engineer. NOTE. Zero references, verified
    two search shapes; they are live in three sibling trees, so this one copied the
    stylesheet without the components that consume it. It matters mainly because the
    comment above them documents measured contrast ratios for chips this tree never
    renders — inviting a reader to trust a verification with no rendered subject.

154. **Two demo trees declare a large social card and ship an image nothing
    references.** — OPEN, desktop-engineer and web-engineer. NOTE.
    `signalgrid-review` and `signalgrid-desktop` both set
    `twitter:card="summary_large_image"` with no `og:image` and no `twitter:image`,
    while each ships an unreferenced `public/opengraph.jpg`. `signalgrid-web` is the
    control and does it correctly including a base-path rewrite. This is the mirror of
    the missing-manifest-icons defect: here the file exists and the markup that would
    use it does not.

155. **An unguarded status lookup in desktop Integrations emits a literal
    `undefined` class.** — OPEN, desktop-engineer. NOTE. `Integrations.tsx:65` has no
    fallback, so an unrecognised status yields `className="... undefined"`, which
    Tailwind does not match — the cell inherits ordinary foreground and reads as a
    normal, healthy row. The map is typed `Record<string, string>` so TypeScript will
    not complain. The sibling `Signals.tsx:66` guards the same pattern with `?? ""`.
    FIX: type the map against the spec enum so an unmapped status is a typecheck
    failure, and give the lookup a RESTRICTIVE fallback plus a visible UNKNOWN marker
    — an unknown state must be stated, not styled away.

156. **`Partial<Record<DecisionOutcome, …>>` disables the exhaustiveness check that
    would catch a new verdict.** — OPEN, web-engineer. NOTE, and a REFUTED hypothesis
    recorded honestly: the reader expected an unmapped outcome and there is not one —
    all ten members are present, so the fallback is currently unreachable. What
    remains is that `Partial` is the annotation making an unmapped verdict LEGAL, and
    the fallback it enables is a neutral stone chip byte-identical to the tone already
    assigned to `record_audit`, the most benign outcome in the set. A future
    restrictive outcome would arrive looking like an audit note.
    FIX: drop `Partial` so an unhandled outcome is a compile error, and change the
    fallback to the restrictive tone.

157. **Six rendered assertions of a passing CI gate that does not exist.** — CLOSED 2026-09-06 (row 160 records the removal; `rc:smoke` has zero occurrences in artifacts/signalgrid-review/src — the two rows disagreed for days),
    web-engineer. The Review Hub scorecard cites `rc:smoke` as a passing workflow six
    times, and those citations are load-bearing for two of the eight published scores.
    Absence established three ways: `check:absence` returns INCONCLUSIVE with four
    word-mentions, all of which are the claim itself or the record of the claim — no
    script, no workflow, no gate; a grep across `package.json`, `.github/workflows/`
    and `scripts/` returns NOTHING.
    It was registered in the claim inventory on 2026-08-21 with action `remove`. It is
    still rendering four days later.
    WHY IT MATTERS: these sentences tell a reader a named CI gate is green. There is
    no such gate. A prospect who asks to see the run gets no answer, and everything
    else on the page becomes suspect at that moment.
    FIX: replace each with a gate that exists and can be linked, then RE-DERIVE the
    two scores that leaned on it — the substitution changes what they claim.

158. **52 claims marked for removal are still in the tree, and no gate reads the
    register.** — OPEN, docs-writer. `docs/agent/CLAIM_INVENTORY.json` prescribes an
    action for each of 1,023 rendered claims. Three scripts name the file: one
    GENERATES markdown from it, and two name it only to EXCLUDE it from their own
    scans. None asks whether a prescribed action was taken.
    Measured mechanically by taking the longest quoted span from each `remove`-actioned
    row and testing whether it is still present: 151 remove-rows on the read surface,
    **52 still present verbatim**, 68 no-longer-matching, 31 untestable.
    STATED HONESTLY: 52 is a lower bound and the 68 is NOT evidence of 68 fixes — many
    rows paraphrase rather than quote, so a non-match can mean the row was never
    testable this way. The load-bearing number is the zero: zero gates check.
    Row 157 is the concrete demonstration.
    FIX: a gate asserting that every `remove` row with a quotable span no longer
    matches its named file, ratcheting the still-present count downward rather than
    demanding zero on day one.

159. **MY OWN LEDGER WAS INFLATING ITS NUMBER, and the gate permitted it.** —
    FIXED 2026-08-25, devex-tooling-engineer. Found by a reader auditing the web
    trees, in the ledger rather than in the code.
    `docs/agent/review-coverage.json` carried TWO directory entries —
    `artifacts/signalgrid-web/src` and `.github/workflows` — and
    `check-review-coverage.mjs` treated a prefix claim as covering everything beneath
    it. Two lines therefore counted **93 files** as read. `docs/agent/REVIEW_CYCLE.md`
    already required "FILE-level ledger entries (never directory prefixes)"; the gate
    simply did not enforce the rule written beside it.
    Reported coverage was 17.3%. With the two entries removed it is 13.2%. **The
    4-point difference was never real** — the number this entire effort exists to make
    true was being inflated by its own checker.
    FIXED: the two entries are deleted and the gate now FAILS on any claim that is not
    an exact tracked file. Falsified — planting a directory claim back produces
    "a DIRECTORY standing in for 78 file(s)" and exit 1.

160. **The published "independent" review is dated twelve months later than its
    source, renumbered, and internally contradicts itself on a score.** — FIXED
    2026-08-25, docs-writer. Was BLOCKING for anything public-facing.
    OWNER DECISION, 2026-08-25: relabel as SignalGrid's own self-assessment rather
    than restore the source's numbers. Applied:
    · `index.html` — every meta description now reads "SignalGrid self-assessment …
      derived from a May 2025 external second-opinion review". The word
      "independent" is gone from the page's own description.
    · `robots` is now `noindex, nofollow`, with the reason in a comment beside it:
      indexing a self-assessment as though it were third-party judgement is not
      something a disclaimer repairs.
    · `REVIEW_DATE` and `REVIEW_VERSION` now name both things — that this is a
      self-assessment, and that the external review it derives from is v0.1, May
      2025 — with the full provenance recorded in a comment above them.
    · The 7-versus-8 contradiction is resolved to 8 in BOTH places, with the delta
      from the external review's 7 stated inline as SignalGrid's own later
      judgement rather than absorbed silently.
    · `rc:smoke` is gone from every rendered string in `reviewData.ts` and
      `demoData.ts` — seven sites — replaced by the CI gate suite that actually
      exists. Row 157 is closed by the same change. The only surviving occurrences
      are in gitignored `dist/` build output, which regenerates.
    ORIGINAL FINDING FOLLOWS. Found by reading the source
    PDF in the founder's Drive and diffing it against the shipped deck; the shipped
    values were then verified directly in the tree.
    · SOURCE: "SignalGrid Second-Opinion Review", **v0.1, May 2025**.
    · SHIPPED (`reviewData.ts:1-3`): `REVIEW_DATE = "May 2026"`,
      `REVIEW_VERSION = "v0.3 — Intune / Entra Posture Proof + Live Tracker"`.
    · The deck carries **TWO DIFFERENT Demo Readiness scores**: the scorecard block
      reads **8**, a later block reads **7**. The source says 7. So one was raised,
      and the deck now disagrees with itself in two places on the same page.
    · The 8 is justified in its own rationale by "rc:smoke workflow is complete and
      passing" — the gate row 157 proves does not exist.
    · A dimension the outside reviewer never wrote — "Integration Surface Coverage",
      3/10 — was added to a document presented as theirs.
    · `index.html:7,10,14` still describes it as an **"independent"** review and
      `:8` sets `robots: index, follow`, so it is publicly indexable.
    WHY THIS IS THE MOST SERIOUS ITEM ON THE PUBLIC SURFACE: every other overclaim in
    this repo is our own claim about our own work, and can be corrected by softening
    it. This one attributes edited content to a third party. The date, the version,
    the added dimension and the raised score are each defensible as an internal
    working document; none of them is defensible under the word "independent" on an
    indexable page.
    FIX (docs-writer, and this is an owner-visible decision): either restore the
    source's date, version and scores and mark every addition as SignalGrid's own
    annotation, clearly separated from the reviewer's text — or drop the word
    "independent", relabel the page as an internal self-assessment derived from a
    May 2025 external review, and set `robots: noindex`. Resolve the 7-versus-8
    contradiction either way. Row 157's `rc:smoke` removal is a prerequisite, not a
    separate task.

161. **Biometric and location privacy law is absent from the repo entirely.** —
    OPEN, security-engineer. The founder's own architecture research names three
    regimes that bear directly on a badge-plus-biometric custody product, and
    `docs/` has zero hits for the operative ones: Illinois **BIPA** written notice
    and release (0), **CCPA precise geolocation as sensitive personal information**
    (0), GDPR Art. 9 special-category framing (1 file, in passing).
    The source's operative rule is the part worth importing: **legal review precedes
    DESIGN FREEZE, not go-live.** A product that fuses badge identity, physical
    location and device custody can be architecturally committed to a position it
    cannot lawfully ship before anyone asks.
    NOTE THE BOUNDARY: this is a prompt to get human legal review, not a substitute
    for it. CLAUDE.md already says Claude Code does not guarantee HIPAA or SOC 2 and
    a human compliance review is required.

162. **The buyer's own program document describes the ICP in vocabulary the repo
    does not contain — and asks for the one thing the core refuses to do.** — OPEN,
    positioning-messaging (primary), product/principal-engineer (the guardrail half).
    `Enterprise_Mobility_Modernization` is a 200K+ device health-system mobility
    transformation deck. `docs/` returns ZERO hits for: "mobility modernization",
    "Access Central", "eSAF", "rogue tenant", "app consolidation", "Managed Apple
    ID", "ABM domain federation", "Microsoft Tunnel", "Cisco NAC".
    THE VALUABLE HALF: named pains (fragmented MDM estates and rogue tenants, a
    legacy access process blocking automation, clinical app sprawl, support overhead
    above benchmark), the IAM / Network-SASE / Mobility ownership split a
    solutions-architect must design against, and the explicit leadership approval
    gates a champion has to clear.
    THE DANGEROUS HALF, and it must be recorded as a NEGATIVE requirement: the deck
    asks for "AI triage and automated decision engines", "predictive routing &
    anomaly detection", and "auto-remediation". That is probabilistic decisioning
    plus autonomous remediation — precisely what `review:invariants` exists to keep
    out of the decision path. This language WILL arrive from buyers, not just from
    this document, so the guardrail belongs in
    `docs/PUBLIC_MESSAGING_GUARDRAILS.md` before it is needed.
    TWO FIGURES THAT MUST NEVER MIGRATE: "200K+ devices" is the CUSTOMER'S estate,
    not SignalGrid's scale, and "40-50% app reduction" is that program's target, not
    a result.
    HANDLING — OWNER DECISION 2026-08-25: **background reading only, never
    published.** The team may learn the buyer's vocabulary and named pains from it;
    nothing from it goes on the website, into the repo as content, or into any
    customer-facing material. It does not reach GitHub Pages in any form. Treat the
    ICP brief built from it (item 4 of the Drive synthesis) as written in our own
    words about a problem space, never as an excerpt.

163. **WITHDRAWN — the Gartner exposure was already closed, and I said the
    opposite.** — CLOSED 2026-08-25, security-engineer. This row asserted that two
    Gartner Peer Insights reports sat reproduced whole in `attached_assets/` and
    that the exposure was "worse than when it was filed". BOTH HALVES WERE WRONG.
    THE FACTS: the files were added 2026-08-03 (`4a170db`) and REMOVED 2026-08-06
    by `9143d73`, "chore(licensing): remove four republished third-party files and
    gate the class (#171)". They are absent from HEAD, absent from disk, and
    `attached_assets/` holds four pasted text files and nothing else.
    HOW THE ERROR HAPPENED, because the mechanism matters more than the row: I did
    not check the tree. I read `docs/PUBLICATION_BOUNDARY.md`, which still described
    the exposure in the PRESENT TENSE nineteen days after the fix, and repeated it —
    then a Drive scan found the same two documents in the founder's own Drive and I
    treated that as corroboration that they were still in the repo. Two independent
    sources agreeing, neither of them the tree. The stale doc has been corrected.
    WHAT REMAINS TRUE: the files are still in git HISTORY, which the boundary doc
    always said and which removal from HEAD never addressed. Purging that needs a
    history rewrite — the owner's call alone, and `NOTICE` argues against it for the
    provenance record. Recorded as a standing accepted condition, not a task.
    STILL WORTH DOING, and unaffected: the extracted facts are genuinely useful — a
    mandatory-feature list that draws the cleanest line between IGA and what
    SignalGrid is, four peer lessons usable as objection-handling, and an
    install-base ordering for connector prioritisation. Use facts and vendor names,
    never reproduce passages, never cite ratings or "Customers' Choice" marks on a
    public surface, and do not re-add a copy.

164. **Five IGA vendors the competitive surface has never mentioned.** — OPEN,
    competitive-analyst. `docs/research/IGA_ADJACENCY.md` names four vendors. The
    Gartner category listing shows 115 products, and these have ZERO mentions
    anywhere in `docs/`: Radiant Logic, Oracle Identity Governance, Symantec IGA
    (Broadcom), OpenText NetIQ, IBM Security Verify Governance. Thinly covered:
    Veza, Pathlock, One Identity, Netwrix, Lumos.
    ALSO, and it sharpens the boundary rather than widening it: "provisioning via
    integration to ITSM/ticketing to trigger manual fulfilment" is a MANDATORY IGA
    feature. That sits close to our orchestration story, so `IGA_ADJACENCY.md`
    should state explicitly that SignalGrid does not do entitlement fulfilment.

165. **`tamperState` is an enum where the source material describes a graph.** —
    OPEN, product/principal-engineer. `docs/EVENT_CONTRACT.md` carries
    `tamperState ∈ {none, suspected, confirmed}` with no notion of HOW "suspected"
    is reached. The architecture research names the constituent signals: latch
    forced, unexpected bay open, device absent while charge negotiation is unstable,
    repeated undock/redock within seconds, motion after closure, and tracker
    movement with no matching PACS event. "tamper" appears in 62 files; "tamper
    graph" in none.
    This matters beyond modelling: row 83 proved that a tamper state arriving from
    two sources could be silently overwritten. A derivation with named constituent
    signals is auditable in a way a bare enum is not.

166. **Two iOS CI workflows are documented that do not exist.** — OPEN,
    mobile-native-engineer. NOTE. The Drive copy of `CODE_REVIEW.md` cites
    `ios-code-quality.yml` and `swift-code-review.yml`; the repo has `ios-ci.yml`
    with a `lint-and-security` job. Every path it gives is `ios/…` rather than
    `native/ios/…`, against CLAUDE.md's rule. Importing it as-is would assert two CI
    workflows that are not there.
    WORTH TAKING FROM IT: the human-facing PR checklist for the iOS surface, which
    the repo does not have — the seven custom SwiftLint rules it documents ALL exist
    already in `native/ios/.swiftlint.yml`, so only the checklist is new.
    ALSO: it states "certificate pinning: enable for production" and "ALL API
    requests signed with HMAC" as present-tense guarantees; pinning is an env-var
    opt-in (`CERT_PINNING_ENABLED`), off unless set.

167. **The Fleet tradeoff is decided but never written down.** — OPEN,
    product/principal-engineer. NOTE. CLAUDE.md names Fleet as "the chosen MDM". The
    founder's own architecture research rates Fleet as better suited to
    organisations valuing openness and infrastructure-as-code over the deepest
    traditional mobile-workflow features, and names Jamf or Intune as the
    conservative choice for Apple estates. Fleet also does not appear in the Gartner
    endpoint-management listing — stated carefully, that listing showed 40 of 78
    products with a region filter, so it is corroboration and NOT proof of absence.
    The choice may well be right. What is missing is the tradeoff written beside it,
    so it reads as a decision rather than an assumption.

168. **The palette gate cannot see a verdict painted with the WRONG ratified
    token.** — MITIGATED 2026-08-25 by option (a), devex-tooling-engineer. Row 151
    was three real defects — fail-closed shown in the danger tone, `restrict`
    wearing the step-up tone, and two verdicts sharing one legend swatch — and
    `check-decision-palette.mjs` exited 0 before the fix and exits 0 after it. It
    asserts that a verdict is painted from a RATIFIED TOKEN, which all three were.
    It has no concept of WHICH verdict maps to which token, and none of a legend.
    OPTION (a) SHIPPED: `scripts/check-verdict-tone-source.mjs` fails on any inline
    expression that compares a verdict and picks a status class in the same breath,
    forcing every tone decision through a total `Record` the compiler checks.
    Registered in preflight and CI. A fourth independent ternary had survived in
    `artifacts/signalgrid-desktop/src/pages/Dashboard.tsx`; it now calls
    `outcomeTone`, and the tree scans clean across 231 files.
    Falsified by restoring the ternary — one finding, exit 1.
    TWO THINGS THE GATE GOT WRONG FIRST, both found by running it against the real
    file rather than only against fixtures. It scanned sliding windows and reported
    the WINDOW'S first line, which pointed at an innocent `<div>` four lines above
    the defect — a finding that names the wrong line gets checked, found blameless,
    and disbelieved, which is worse than a vague one. And it reported one chained
    ternary as two findings, because each arm matched its own window. It now anchors
    on the comparison line and coalesces the arms; both behaviours are pinned by
    assertions, one of which asserts the exact line number.
    WHAT IT STILL CANNOT DO, and this is why the row reads mitigated rather than
    fixed: a total `Record` with the WRONG colours in it passes. Centralising the
    decision does not make it correct — it makes it reviewable, and makes the next
    drift a typecheck failure instead of a silent fourth opinion. Options (b) —
    assert each verdict resolves to a DISTINCT rendered value, which is what would
    have caught the legend — and (c), pinning the mapping in one registry the gate
    reads, remain open and are the ones that would close it.

185. **The mutation registry was aimed at re-export barrels, and 45 guards had no
    test.** — FIXED 2026-08-26, qa-engineer, in PR #319 (merged, `2962e55`).
    `scripts/mutation-guard.mjs`; verify with `node scripts/mutation-guard.mjs`.
    `proof:device-attestation` registered `index.ts` — a barrel that re-exports —
    so `evaluate.ts`, the file granting this family's TOP assurance tier, was never
    mutated. Mutation operates on FILES; a re-export buys nothing. Audited across
    the fabric rather than fixed in place: 19 families had logic files no
    registration named, 33 files in all, including 14 `evaluate.ts` decision cores.
    1,160 mutations -> 1,367.
    THE FIRST SWEEP AFTER WIDENING FOUND 45 SURVIVORS — guards deletable with every
    proof still passing. That is the finding, and it is worth stating plainly: the
    sweep had been reporting green over files it never touched, and "every
    registered guard is falsifiable" was true only of the guards it could see.
    Resolved 42 by new assertions and 3 by documented-inert entries with executed
    reasoning (an exhaustive 1,680-state diff for identity-risk; an executed
    nine-value domain for the edr-threat typeof conjunct). Every new assertion
    carries a non-vacuity control, because each would otherwise pass for a
    normalizer that refused everything.
    THE THREE WORTH NAMING, because they are what the gap was hiding: a macOS
    system-extension section reporting ITSELF untrustworthy was believed anyway; a
    truncated device inventory could be returned as complete, which for a posture
    fabric means a missing device reads as a HEALTHY device; and a Redis outage
    could serve a stale config indefinitely with nothing said — in a file whose own
    header promises that cannot happen.
    The sweep is now SHARDED four ways (`--shard=i/N`, balanced by mutation count),
    with `scripts/check-mutation-sharding.mjs` proving the split is a partition —
    a sharder that dropped a target would report success over work it never did,
    which is this lane's own failure mode reintroduced at the scheduling layer.
    STILL OPEN, measured and deliberately not folded in: the mutators are
    line-oriented and require `if (...) {`, so a brace-less guard clause
    (`if (!v.ok) return null;`) cannot be reached at all. 417 of them sit in
    registered files across 49 of the 53 targets — an entire class this harness has
    never been able to falsify, and about a 31% mutation increase once a mutator
    exists. `nac/cisco-ise.ts` and `nac/aruba-clearpass.ts` are unregistered because
    of it, with the reason and a re-register instruction recorded at the registry.

184. **A guard sat one layer above the thing it guarded.** — FIXED 2026-08-25,
    qa-engineer, in PR #319.
    `lib/integrations/src/integrations/passkey-assurance/passkey-assurance-connector.ts`;
    verify with the passkey-assurance proof, which this change took from 87 checks
    to 91.
    `PasskeyAssuranceConnector.fetchNormalized(identityRef,
    credentialRef?)` took the requested credential ref and never compared it to
    the ref the source answered with. The substitution check lived on
    `fetchNormalizedSet`, which calls straight through to `fetchNormalized` with
    that same argument and then guards the result — so the SET path was protected
    and the primitive it is built on was not. A caller asking "grade cred-A" and
    answered with a healthy cred-B was told `passkeyConfirmed: true` about a
    credential nobody asked about. The verdict was not even a lie; it truthfully
    answered a question no one had put.
    Moved into the primitive; the set path now delegates instead of keeping a
    second copy of the rule, because a second copy of a rule is a second source of
    truth. It fires only when a ref was actually requested — `fetchNormalized(id)`
    means "whatever this identity has" and has nothing to contradict.
    That proof held at 87/87 across the fix, so it covered none of
    this; four assertions added, 87 -> 91.
    TWO PROBES LIED BEFORE THE THIRD TOLD THE TRUTH, and that is the part worth
    keeping. The first invented field names, so every case normalized `malformed`
    for unrelated reasons and the guard looked like it over-fired. The second used
    real field names but hit the mock's `credentialReports` branch, which returns
    `{}` on a miss, so the returned ref was empty and the guard correctly declined
    — and it looked like it under-fired. Both readings were about to be reported.
    A test fixture is code, and a wrong fixture produces a confident wrong answer
    exactly as fast as a right one.
    Falsified: disabling the guard fails three of the four new checks AND the
    pre-existing set-path check — the second half being the evidence that the set
    path now genuinely delegates rather than carrying its own copy.

183. **The org automated on a clock and never on an event.** — FIXED 2026-08-25,
    agent-platform-engineer. The owner asked for an assistant that acts "when x
    event or task plus function happens", and asked first whether something already
    built does this. It does, and researching before building is the whole finding.
    WHAT ALREADY EXISTED: `docs/agent/scheduled-routines.json` declares four
    routines on cron — steward duty cycle, live-sync keeper, nightly build agent,
    hygiene sweep — each gated on an authorizing human, a write scope and an
    escalation boundary. That is a TIME layer: "at 09:40 daily". There was no EVENT
    layer at all. `.claude/settings.json` and `.claude/hooks/` did not exist, so
    Claude Code's own hook system — SessionStart, Stop, PreToolUse, PostToolUse,
    which ships with the harness and needed building by nobody — was entirely
    unused. Nothing to invent; something to connect.
    WHAT THE HOOK DOES, chosen from one day's evidence rather than from a list of
    what hooks CAN do. Three things cost real time on 2026-08-25 and all three are
    now automatic: the container silently reverted to a day-old snapshot TWICE, so
    committed work read as missing and the instinctive response — redo it — would
    have been wrong both times; `@fontsource/inter` was declared and not installed,
    reddening a build in a package the session never opened; and `CLAUDE.md` says
    "Run this first, every session" about the lane inbox while nothing made that
    true, so it ran when somebody remembered.
    IT REPORTS AND NEVER BLOCKS, and that inversion is deliberate. This repository
    is fail-closed everywhere, and a session start is the one place where failing
    closed is wrong: a blocked session cannot be used to fix the thing that blocked
    it. Every path exits 0. Nothing here gates — preflight's gates do that (327 on 2026-09-06; the parity gate prints the live count),
    after there is something to gate.
    THE DEPENDENCY INSTALL IS REMOTE-ONLY, and the exclusion is load-bearing rather
    than lazy. `CLAUDE.md` records that local macOS builds add darwin platform
    binaries and restore the manifests afterwards, re-diverging the lockfile AFTER
    it was correctly regenerated. A hook running `pnpm install` on the Mac would
    manufacture exactly the drift `.githooks/pre-push` exists to catch.
    Falsified: reset one commit back and the hook names the drift and prints the
    recovery command; pointed at a directory that is not a repository it still
    exits 0.
    NOT DONE, and worth stating because the hook system offers it: no PreToolUse or
    PostToolUse hooks. A PostToolUse hook on Edit could have caught the
    check-then-read race committed twice in one day (rows 175, 182) at the moment
    of writing rather than in CodeQL hours later. That is a real candidate and it
    needs its own decision — a hook that fires on every edit is a tax on every edit.

182. **The claims gate read zero of 281 public documents.** — MITIGATED 2026-08-25,
    positioning-messaging. `scripts/check-launch-claims.mjs` reads the website, the
    Pages-derived HTML, the outreach surface and anything carrying the public
    contact address — 95 files. It read NO markdown under `docs/`, in a repository
    whose own `NOTICE` calls it a public reference surface. The first docs-writer
    shift found the pitch-deck defect reproduced there: a table headed "SignalGrid
    surface (today)" listing 23 deferred connector families, with the freeze
    disclaimer 180 lines below it.
    WHY A CEILING AND NOT A GATE, measured before deciding rather than after.
    Bringing `docs/` into the fatal scope fails 120 of 285 files on day one, and
    reading what is flagged says why that is wrong:
    `docs/inspiration/SPATIAL_TRUST_RESEARCH_REPORT.md` at 45 blocks,
    `docs/research/MARKET_LANDSCAPE.md`, `KONTAKT_RTLS_INTEGRATION_NOTES.md`. Those
    say "RTLS" and "geofence" because that is their SUBJECT — engineering and
    research notes, not copy promising anything. The gate's own header argues three
    separate times that a gate which cries wolf gets switched off.
    So `docs/agent/launch-claims-docs-ceiling.json` records the debt on the pattern
    row 170 established: a ceiling that may fall and may not rise. Baseline 511
    mentions across 121 files. The buyer-facing arm stays FATAL and unchanged.
    THE FIRST VERSION COUNTED THE WRONG THING, and falsifying it is the only reason
    that surfaced. It counted FILES — which answers "did a document acquire its
    first unhedged claim", not "did a new unhedged claim appear". A fresh deferred
    claim planted in a document already on the list left the count unchanged and
    the gate passed, so a new overclaim in any of the 121 worst documents was
    invisible. The unit is now MENTIONS. Three falsifications now fire: a new claim
    in an already-listed file, one in a previously clean file, and the original
    fatal arm on the website. Gate runs in 196 ms.
    WHAT IS STILL NOT DONE: narrowing the fatal scope to genuinely buyer-facing
    prose. `public_review` in the publication boundary answers "is this safe to
    publish", not "does a buyer read this as a promise", and covers all of `docs`,
    so it does not derive the answer. That is an editorial judgement nobody has
    made, and it is not pretended here.

178. **Four roles switched on for the first time, and the first shift of each found
    something the gates do not see.** — FIXED in part 2026-08-25, program-manager.
    `check-surface-ownership.mjs` reports 0 unowned files of 2,347 and
    `check-review-coverage.mjs` reports 389 read. Both true at once, and the gap
    between them was invisible because "assigned" reads as "handled".
    `scripts/role-work-queue.mjs` (`pnpm run role:queue`) derives, per role, the
    files it owns that nobody has read, ordered by consequence. Reported, never
    fatal — a queue that fails the build would make declaring a new surface a red
    build, which teaches a repository to declare less.
    THE QUEUE'S FIRST VERSION WAS WRONG in the way this document keeps recording:
    it ranked by path prefix, so `.gitkeep` and a tsconfig sat at the top of
    qa-engineer's list and a PNG at the top of docs-writer's. Ranking a real
    property, answering a different question. It now asks whether a file carries
    logic at all, reusing `isReviewable` from the coverage gate rather than
    restating it.
    FOUR SHIFTS RAN. qa-engineer, security-engineer, agent-platform-engineer and
    docs-writer — the last three had never been activated. What each found is
    recorded in rows 179-181; the pattern across them is that every finding was a
    claim outrunning its evidence, and not one was catchable by an existing gate.
    FIXED IN THIS PASS: the benchmark-selection fail-open (row 179), the
    permission-enforcement claim and its tautological control (row 180), the
    publication-boundary misclassification and the absent mirror-drift check (row
    181), and the Graph permission boundary's fifteen invented scopes.
    CLOSED SINCE: the passkey substitution guard moved into the primitive (row
    184), and the mutation-registry gap turned out to be far wider than
    device-attestation (row 185).
    STILL OPEN, each needing its own decision: device-attestation being the only
    connector of five with no report-integrity axis — SCOPED MORE PRECISELY
    2026-08-25 before building anything, because the fix is smaller than the
    finding sounded. Twenty-one of the fabric's families carry no `reportIntegrity`,
    so this is not device-attestation's private defect and "add it to the outlier"
    was the wrong frame; whether a family needs the axis depends on whether it can
    receive a report that is present but junk. For device-attestation the answer is
    yes, and the consequence is DIAGNOSTIC rather than a grant risk: a report of
    garbage and no report at all both normalize to `unknown` and both raise to
    `step_up`, so nothing is granted that should not be — the operator simply cannot
    tell an unenrolled device from a broken attestation bridge, and those need
    opposite responses. Worth building, not urgent, and not to be widened into a
    twenty-one-family sweep without asking the question separately for each;
    and the two structural gate gaps docs-writer measured — `check-launch-claims.mjs` reads zero `docs/*.md`
    in a PUBLIC repository (closed by row 182), and `check-proof-figures.mjs`
    cannot see a figure below 1,000, which is why every fossil it found survived.

179. **A malformed version erased the not-in-catalog finding.** — FIXED 2026-08-25,
    qa-engineer. `lib/integrations/src/integrations/benchmark-selection/benchmark-selection-connector.ts`
    read
    `versionShapeBad ? "unknown" : deriveRecognition(...)`, skipping the catalog
    lookup whenever the cited version was not a numeric triple. But
    `not_in_catalog` falls out of `versions.size === 0` — a TITLE-only test that
    never consults the version. So a report citing an unknown title AND an
    unparseable version lost the title finding, dropping the action from `alert` to
    `step_up` and deleting `benchmark_not_in_catalog` from the evidence.
    Adding a SECOND defect to a report made the answer softer. Measured rather than
    reasoned, and falsified side by side: with the bug, version `9.9.9` gives
    `not_in_catalog` while `3.0` on the same report gives `unknown`; fixed, both
    give `not_in_catalog` and `reportIntegrity` still reports `malformed`
    independently. `pnpm run proof:benchmark-selection` stays 95/95 throughout — which is the point
    worth noting: the proof never covered this, so a green proof was not evidence
    either way.

180. **The permission gate credits a call inside `if (false)`.** — MITIGATED
    2026-08-25, security-engineer. `check-permission-enforcement.mjs` matches
    `authorize(principal, "scope")` with a regex over file text. It has no call
    graph and no reachability analysis, so a syntactically-present call in an
    unreachable branch of an unimported function satisfies it — proven by planting
    exactly that in a scratch copy. Its header claimed the scope was "required by a
    surface", which is more than a regex can establish.
    The header now states the measurement and its ceiling, and says plainly that
    closing the reachability half needs a real parser — the same conclusion
    `check-module-init-order.mjs` already reached and declined.
    Its self-test was also tautological: `!enforced.has("nonexistent:scope")` is
    true for any string nobody typed and never reached the reporting path. The
    verdict is now a pure exported function the self-test drives over a synthetic
    corpus, asserting all four arms. Falsified twice; each mutation caught.

181. **The org published its own skill under another author's licence, and named a
    drift check that did not exist.** — FIXED 2026-08-25, agent-platform-engineer,
    on this role's first ever shift. Both defects were introduced the same day, by
    the DR-018 vendoring, and both survived a green build.
    `scripts/publication-boundary.mjs` classifies `.claude/skills` as
    `third_party_intake` — "obra/superpowers, 14 skills vendored unmodified under
    MIT © 2025 Jesse Vincent". Six first-party skills carry carve-outs;
    `signalgrid-master`, added hours earlier, did not. So this repository published
    its own orchestration skill under Jesse Vincent's grant. The gate stayed green
    because it proves every path is CLASSIFIED, never that a path is classified
    CORRECTLY — the same distinction as row 175's launcher.
    Separately, `.claude/skills/VENDORED.md` said `scan:agent-plane` "will say so
    when the two disagree". It did not: the scanner read three roots under the home
    directory and never opened the committed copy. The two were byte-identical at
    the time, so nothing had drifted — the control was simply absent, which is the
    harder half to notice. Now implemented and falsified by planting a divergence.
    The shift also verified what was RIGHT, which is why the finding is credible:
    all 51 vendored skill files hash byte-identical to obra/superpowers at the
    pinned commit, and all 9 vendored agents match their source.

177. **The evidence contract advertised six sources and implemented two.** —
    FIXED 2026-08-25, principal-engineer. Found while building the source registry
    the owner asked for, which is the registry earning its place before it shipped.
    `EvidenceSourceSystem` in `lib/integration-bridge/src/evidence.ts` names six
    members. `fleet` and `headwind` have product converters. `intune` and `nanomdm`
    are constructed INLINE INSIDE `scripts/src/evidence-adapter-proof.ts` and
    produced by no product code — the Graph production path reaches the
    device-management-health connector through `graph-transport.ts`, which does not
    emit this contract at all. `jamf` appears in twelve files as a vendor SignalGrid
    reads ABOUT and produces evidence in none of them. `omnissa` appears only in its
    own type declaration. None of the four was named in the launch profile's
    declared gaps.
    NOTHING WAS BROKEN BY THIS, and the row says so plainly: a union is a
    vocabulary, not a promise, and no caller could have obtained evidence from an
    unimplemented source. But a type member nobody implements READS as a
    capability, and this repository fails builds over that shape elsewhere — a
    launcher cited as deployment evidence (row 175), a field asserting attestation
    it never checked (row 174). The same defect, in the source vocabulary.
    `docs/agent/evidence-sources.json` now declares all six with an honest status —
    `converter`, `proof_only`, `vocabulary_only` — and
    `scripts/check-evidence-sources.mjs` enforces the bijection BOTH directions:
    every union member has an entry, every entry is a union member, a `converter`
    entry's named function must actually be exported from its named module, and a
    weaker status may not name a converter and launder itself into the stronger
    one. Registered in preflight and CI. Self-test 9/9, and falsified twice against
    the real tree — adding `kandji` to the union without registering it fails, and
    renaming the Fleet converter while the registry still claims it fails.
    WHAT THIS IS NOT, stated so the owner's larger ask is not reported as done: it
    does not make adding a source a no-code act. The converter is still a function
    somebody writes, and row 176 measured that at ~26 lines. This makes adding one
    a DECLARED act a gate can see, which is the precondition for a
    configuration-driven registry rather than the thing itself.

176. **"Adding a signal to the grid" is already the architecture, and I recommended
    against it on a mis-framing.** — MEASURED 2026-08-25, principal-engineer. The
    owner, asked whether to build live lanes for Velociraptor, Zeek and OpenVAS,
    rejected the question: "it's a signal and it can be added to the grid for easier
    overall smart automation orchestrator that just makes things work without having
    to know how they do it." Measuring before arguing, he is describing something
    that largely EXISTS.
    `pnpm run proof:evidence-adapter` measures sourceSystems=3 and swapScenarios=2,
    passes every assertion, and prints its own verdict: "source-agnostic: the engine
    could not tell fleet from headwind from intune — only the provenance can."
    `pnpm run proof:signal-discovery` passes over classify, auto-pull with an API,
    admin-gate without one, and lifecycle. The central claim was ratified by
    owner redirect on 2026-08-11 (intake row 77): the product must not care which
    source produced the evidence so long as the adapter emits the same normalized
    model.
    THE PER-SOURCE COST, measured rather than estimated:
    `fleetHostToDeviceManagementEvidence` is **26 lines** and
    `headwindLabToDeviceManagementEvidence` is **28**, both in
    `lib/integration-bridge/src/evidence.ts`. That is what a new source costs at the
    seam. What is expensive is the LAB LANE around it — the container, the auth
    archaeology, the wire capture — which is where the GLPI and Headwind bring-ups
    actually spent their time.
    WHERE MY RECOMMENDATION WAS WRONG. I advised holding all three on the ground
    that they touch families frozen under DR-005. The freeze governs LAUNCH SCOPE —
    which families are in Limited GA — not whether a deferred family may gain an
    evidence source. A deferred family gaining a source stays deferred; it gains
    evidence that it works, which is precisely what DR-013 blesses. Velociraptor,
    Zeek and OpenVAS map to `edr-threat`, `network-nac` and `vuln-scan`, all of
    which already exist. None of the three requires a new family.
    WHAT IS ACTUALLY MISSING, stated narrowly so it is not confused with the vision:
    the converters are hand-written functions in one file with no catalog and no
    declarative registration. Adding a source is cheap but not yet a configuration
    act, which is the gap between "26 lines" and "just build the workflow and the
    process takes it". Whether to close that gap is a product call and is NOT
    assumed here.

175. **Four deployment claims cited the script that could deploy them.** — FIXED
    2026-08-25, secops-domain. `docs/agent/open-source-lab-registry.json` carries six
    entries claiming `deployedInLab: true`, and `check-lab-registry.mjs` gates every
    one on citing evidence that exists on disk. Four of the six cited
    `scripts/run-live-lanes.sh` — the launcher. It exists, so the check passed, and
    would pass forever for every entry whether or not anything ever ran. The
    deployment claim was resting on the deployability of the tooling.
    THE REASON IT SURVIVED IS THE INTERESTING PART: all four claims were TRUE. Each
    traces to a recorded pass — `proof:live-edr` and `proof:live-keycloak` in
    `artifacts/sim-results/2026-08-12-fleet-lab-real-source.json`, fleet and osquery in
    `artifacts/sim-results/2026-08-22-source-independence-queue.json`. The citation was
    wrong while the fact was right, and only the fact was ever checked, so nothing
    ever presented as broken. `configured != emitted` is this repository's own first
    evidence distinction and the gate could not make it.
    A NEAR-MISS WORTH RECORDING. Two later sim-results list `proof:live-edr` under
    "skipped (NOT verified by this run)", and there is no `wazuh.json` in
    `artifacts/live-captures/`. Reading only those, the conclusion is that Wazuh was
    claimed deployed and never verified — a much sharper finding, and false. The
    2026-08-12 record shows it passing. This is the third time in one session that
    checking one more source reversed the answer, and the second time the reversal
    was away from the more dramatic claim.
    THE FIX, both halves. The four citations now point at the run that proved them,
    matching what `opentelemetry-collector` and `prometheus` already did. And the gate
    now REFUSES a citation that is not an execution record — `artifacts/sim-results/`
    or `artifacts/live-captures/`, the two artifact families that exist only as the
    residue of something running. Without the second half the data fix rots at the
    next entry.
    Two self-test assertions, 15 -> 17: a launcher is FATAL, and a live-capture is
    accepted, so the rule cannot pass by rejecting everything. Falsified by removing
    the rule — the negative control drops to 16/17 while the positive control
    correctly holds, since acceptance still obtains when nothing is rejected.

174. **`attested` claims authenticator provenance and proves only that the caller
    holds a key it supplied itself.** — MITIGATED 2026-08-25, security-engineer.
    Found by the resourcefulness sweep. In `lib/webauthn/src/webauthn/verify.ts`,
    both the `packed`-with-x5c and `fido-u2f` branches take the verifying key
    straight from the leaf certificate the CLIENT sent
    (`new X509Certificate(x5c[0]).publicKey`) and check the signature with it.
    Nothing validates that certificate: no trust anchor, no issuer check, no
    validity window, no `basicConstraints`, no AAGUID match against authenticator
    metadata. A self-signed certificate minted a second earlier satisfies it
    exactly as well as a vendor one, and the result is reported as
    `attested: true` — a field documented as meaning a cryptographic statement
    was actually verified.
    SEVERITY, MEASURED RATHER THAN ASSUMED, and it is milder than it first reads.
    The review that found this called it the cleanest library swap in the repo.
    Checking who consumes the field first: NOBODY does. `registerCredential`
    gates on `ok` — the signature checked out — and never consults `attested`;
    the only other occurrence in the tree is a generated `.d.ts`. Registration
    independently enforces the rpId hash, user presence and user verification.
    So a forged statement buys an attacker `true` in a value with no readers.
    This is an unearned CLAIM, not an authorization bypass, and the difference
    decides the fix.
    WHAT WAS DONE, and what was deliberately NOT. Not done: adopting
    `@simplewebauthn/server`. Real attestation means vendor root certificates or
    FIDO Metadata Service lookup — a genuine piece of work for a capability
    nothing in this product uses, against a breadth freeze. Done instead: the
    field now states precisely what it proves and what it does not, and
    `scripts/review-invariants.mjs` FAILS THE BUILD if any file outside the
    producing module reads `.attested`. Falsified by planting a
    `if (!attestation.attested)` gate in `server.ts` — exit 1, named file, named
    remedy; restored, exit 0.
    The comment alone was not enough. This document records the same lesson under
    several other numbers: prose does not stop drift, and the thing that turns a
    latent hole into a shipped one is somebody reasonably trusting a field that
    reads as trustworthy.
    TO CLOSE IT: implement chain validation and delete the invariant rule in the
    same commit. Until then the rule is the guard.

173. **A fix can add a branch no proof looks at, and the only thing that notices
    runs once a day.** — FIXED 2026-08-25, qa-engineer. Every pull request in this
    repository was red for two days and the cause was three of this lane's own
    fixes.
    WHAT HAPPENED, in order. The row 126 negative-age guards and the row 134/135
    readiness work added branches. The proofs for those families assert `standing`
    and never read `ageDays`, so the code computing the age could have been deleted
    with nothing failing. The daily mutation sweep noticed on 2026-08-24 and
    reported four survivors. `check-ci-liveness.mjs` is deliberately fatal in CI and
    reported-only off it, so once the last successful sweep aged past 48 hours every
    CI run went red — while `node scripts/preflight.mjs` stayed green locally,
    because that is precisely the asymmetry the gate is built on.
    THE GATES ALL WORKED. The sweep caught unfalsifiable guards; the liveness gate
    caught the sweep going dark; the liveness gate's local-versus-CI split is why a
    green preflight said nothing. Nothing here is a gate defect.
    THE LANE'S FAILURE WAS OBSERVATIONAL. Seven consecutive failures of the same CI
    job went unread because this lane kept querying check-run LISTS, which showed
    jobs still in flight, and never read the completions. Seven pushes landed on top
    of a red build. The check that would have caught it is not a gate — it is
    reading the exit state instead of the progress state, which is the same
    distinction this document records under other names in rows 107, 159 and 168.
    THE FIX. Six assertions added to `proof:credential-rotation` (22 -> 27), each
    mutation now dropping it by a different count (26/27, 25/27, 26/27) so they fail
    for distinct reasons rather than one shared check. One was subtler than it
    looked: the existing unreadable-reference assertion feeds both a policy and a
    lastRotatedAt, so removing the `now === null` arm lets the record fall through
    to the negative-age guard, which answers "unknown" as well — two guards, one
    verdict, either one removable. The new case poses no policy, which returns the
    arm to sole possession of the answer.
    THE FOURTH SURVIVOR WAS DELETED RATHER THAN EXEMPTED, and that is the part worth
    keeping. `state.budget !== null` in `session-readiness/evaluate.ts` sat beside a
    `budgetThreshold !== null` test whose value is derived from `state.budget` one
    line above, so the second implied the first and no mutation could kill it. The
    documented disposition for a genuinely inert term is an ALLOWED entry, and this
    one could not have one: `scripts/mutation-guard.mjs` matches exemptions by
    SUBSTRING against the trimmed source line, and the identical text appears in the
    READINESS_BUDGET_UNREADABLE branch nine lines up, which is real behaviour. A
    single entry would have covered both — a fail-open inside the control that
    exists to catch fail-opens.
    WHAT IS STILL OPEN, and it is the general form: the ALLOWED registry's
    substring matching means ANY exemption can silently reach a second, unrelated
    line that happens to share its text. Nothing warns about it. Keying an entry to
    a line NUMBER as well as a string, or refusing an entry whose string matches
    more than one line in the file, would close it; the second is cheaper and needs
    no maintenance when code moves. Filed rather than built, because it changes a
    registry every mutation target depends on and deserves its own falsification.

172. **An evidence artifact asserts six safety properties that nothing measures.** —
    OPEN, qa-engineer. `.github/workflows/connector-emulator-smoke.yml` generates an
    evidence manifest — uploaded as a build artifact, never committed, so it is not
    a path in this tree — carrying a `publicSafety` array that states, as literal
    data: synthetic fixtures only, no live vendor calls, no secrets, no tenant IDs,
    no customer data, no PHI/PII.
    `fetch`, no URL and no socket — and not one of them is measured. They are a
    string literal in a workflow file, written once and re-emitted on every run.
    Why it matters more here than in prose: this is an EVIDENCE file, uploaded as a
    build artifact, and this repository's whole position is that provenance is the
    product. A reader downstream cannot distinguish a property that was checked from
    a sentence somebody typed, because the artifact presents both identically. If
    the harness ever grew a live call — the exact change this repo's connector work
    keeps making elsewhere, deliberately — the manifest would keep saying there
    isn't one, and would say it with a run id and a commit sha beside it.
    THE CHEAP FIX IS NOT "delete the claims", because the claims are the useful
    part. It is to derive them: a static assertion that the harness and its
    scenario modules contain no network primitive is decidable and is the one that
    matters most, since the other five follow from a fixture-only run. Emit the
    result of that check rather than a literal, and emit it as a checked property
    with the check named, so the artifact says what was verified rather than what
    was intended.

171. **The daily rot check watches a hand-picked tenth of the gate suite, and its
    own header called that the full suite.** — OPEN, sre. Found by reading
    `.github/` rather than by a gate. `scripts/preflight.mjs` registers the gates `node scripts/check-preflight-ci-parity.mjs` counts (327 on 2026-09-06)
    and `review-hub-ci.yml` runs every one per PR, kept in step by
    `check-preflight-ci-parity.mjs`. `scheduled-verification.yml` — the only thing
    watching the default branch BETWEEN pull requests — runs about ten named
    proofs plus the breadth lane, and never invokes preflight.
    The header claim is now corrected: it said "Runs the full deterministic gate
    suite" and now says what it runs. Worth noting how it survived — the JOB was already
    renamed for exactly this reason ("Full gate suite" while running about ten), and
    the prose four lines above the rename outlived it. The visible label got
    corrected and the comment did not.
    THE SELECTION ITSELF IS THE OPEN PART, and the obvious fix is wrong twice over.
    Adding `node scripts/preflight.mjs` to the daily job would fail every night:
    `check-ci-liveness.mjs` is deliberately FATAL in CI when it cannot reach the
    Actions API, and this workflow's permissions are `contents: read` and
    `issues: write` with no `actions: read` — so the change would open a fresh
    tracking issue every morning, which is the fastest way to teach everyone to
    ignore the tracking issue. And it would be mostly redundant even if it worked:
    the large majority of the 179 are deterministic over the tree and cannot rot
    without a commit, so running them nightly repeats what the PR lane already did
    on the same commit.
    WHAT THE SELECTION SHOULD BE DERIVED FROM, since a hand-picked list is the
    fossil shape this repo derives scope to avoid everywhere else: the gates that
    can go red WITHOUT a commit. Those are the time-dependent ones (expiring pins,
    freshness windows, figure guards reading generated artifacts) and the
    externally-dependent ones (vulnerability data, licence policy, the liveness
    check itself). Deriving that set needs a way for a gate to declare which kind it
    is, which is the actual work here and is why this is filed rather than done.

170. **A row's status can be WRONG in either direction, and no gate can tell.** —
    OPEN, program-manager. This session produced both failures. Four rows (83, 89,
    134, 135) read `open` for fixes that had already merged in PRs #309-#312; row 107
    earlier read `closed` for work that had not. A ledger wrong in both directions is
    not a ledger. (Status words are written in lower-case backticks throughout this
    row on purpose — see the last paragraph.)
    The obvious control was built and discarded before shipping: "a row may not read
    `open` while naming a merged pull request" is decidable offline from
    `git log --merges`, and it fires ZERO times against the four rows that motivated
    it, because none of them named a PR at all. It would have been a gate measuring
    a real property and answering a different question than the one asked — the
    defect class this document keeps recording under other names.
    What shipped instead is the precondition, not the check:
    `scripts/check-backlog-evidence.mjs` requires a `closed` row to cite something a
    stranger could run or open — a PR, a commit, a command, or a file path. A debt
    ceiling of 28 bare closures is recorded in
    `docs/agent/backlog-evidence-ratchet.json`; a rise is fatal, a drop is recorded
    automatically. Note the polarity is inverted from `role-coverage-ratchet.json`,
    which is a high-water mark.
    WHAT IS STILL UNCOVERED, and will stay uncovered: nothing in a row's TEXT
    distinguishes "`open` beside unmerged work" from "`open` beside a merged fix". That
    direction needs someone who can read the tree, on a cadence, and no gate
    substitutes for it. The evidence ratchet makes that re-read cheap — every newly
    closed row now hands the reader the command — but it does not perform it. Until
    a standing re-read exists, treat a green backlog-evidence run as saying only
    that closures are checkable, never that they are true.
    ONE MORE THING THIS ROW LEARNED ABOUT ITSELF, and it is a correction. The first
    draft classified as `closed` by the new gate, on the commit that added it, off a
    marker string the row had reproduced while explaining the classifier. The first
    diagnosis written here blamed `check-backlog-ownership.mjs` for reading a quoted
    word as a claim. That was wrong, and the sibling gate deserves the retraction:
    it already strips quoted and code spans before reading status, on the stated
    grounds that "a quotation reproduces a word without meaning it". The new gate
    simply had not reused that step.
    Reading further turned one divergence into four. The new gate had re-implemented
    the sibling's classification instead of importing it, and got it wrong three
    ways: it scanned raw text rather than the stripped status span; it did not test
    partial markers first, though a partial marker contains a closed one; and it
    carried a hand-written copy of the marker list that invented two markers the
    sibling does not honour and omitted two that it does. The two gates disagreed
    about five rows of the same document while this file's own header claimed they
    could not disagree at all.
    Both now import the sibling's extraction, its partial list and its marker list,
    and the new gate's self-test classifies the REAL document with both and fails if
    any row buckets differently — falsified by re-forking the list, which drops it to
    13/14. The general lesson is the one this document keeps re-learning under new
    names: a second copy of a rule is a second source of truth, and the copy is
    wrong long before anybody looks.

169. **A skill outside the repository speaks with authority over it, and no gate
    can see it.** — MITIGATED 2026-08-25 (reported, not gated), agent-platform-engineer.
    `check-org-roster.mjs` derives the set of dispatchable executors from disk and
    reads exactly two directories, both under the repository root:
    `.claude/agents` and `.claude/skills`. That scope is correct — a roster may
    only name an executor that is committed and reviewable — and it is not the
    whole plane. Claude also loads skills from the user's home directory.
    An audit of that layer on 2026-08-25 found `signalgrid-master` in
    `~/.claude/skills/synced/`: 379 lines, generated from `SignalGrid_Alpha@08eecbe`,
    describing itself as "SignalGrid's first-party orchestration layer" and
    publishing an authority order for THIS repository.
    **It is accurate today** — all 18 repository paths it cites exist, it carries
    no pinned figure (every reference to a decision record is written as a
    conditional: "unless superseded by a later record"), it repeats none of the six
    entries in `docs/agent/FALSE_CLAIMS.json`, and it correctly ranks itself
    SEVENTH, below `CLAUDE.md` and the ratified decision records. The defect is not
    its content. The defect is that none of that was checkable from here, and
    nothing in this tree would notice if it stopped being true: the file never
    appears in a diff, no review sees it, and `CLAUDE.md` can be edited to
    contradict it with both documents still reading as correct in isolation.
    WHAT WAS DONE: `scripts/scan-agent-plane.mjs` (`pnpm run scan:agent-plane`)
    reports the out-of-repo plane — which user-level skills speak for this
    repository, which of them NAME it, and which of their citations no longer
    resolve. REPORTED, never fatal, and deliberately NOT registered in preflight
    or CI, for the same reason `scan:estate` is not: a CI runner has no
    `~/.claude`, so a gate asserting on it would pass vacuously every run, which
    is worse than no gate. It is fail-closed in the direction it can be — a root
    that cannot be read is NOT SCANNED and never counted clean.
    Its first live run found a second one and two real gaps: the generic
    `session-start-hook` skill instructs against `.claude/settings.json` and
    `.claude/hooks/session-start.sh`, neither of which exists in this tree.
    WHAT IS STILL OPEN: the reporter makes the plane visible; it does not put it
    under review. That tradeoff is now written up as **DR-018 (PROPOSED)** in
    `docs/DECISION_RECORDS.md`, with both options, what was measured, a
    recommendation and a reversal condition. It recommends vendoring, on the
    ground that vendoring moves which copy is AUTHORITATIVE rather than creating
    the divergence risk: drift between two copies is detectable and
    `scan:agent-plane` already watches for it, while unreviewability is not
    detectable from inside the repository at all. The call itself is the owner's
    and has not been made.

51. **`lib/location` remains an undispositioned orphan** — VERIFIED and
    MEASURED 2026-08-23, and now DECIDED: the disposition is row 51a below —
    `lib/location` is KEPT. Nothing is outstanding on this row.
    Every clause of the row holds. `lib/location` has ZERO importers (only a
    tsconfig project reference), and carries 5 real `Date.now()` calls across 3
    files — `validate.ts:8` does age arithmetic on admission, which is a clock
    inside a signal-admission path.
    **The larger finding underneath it: the determinism gate's scope is
    hand-listed and OPT-IN.** `review-invariants.mjs` scans 8 prefixes
    (`PURE_LIBS`) while the repository holds **35 lib packages** — so a new
    package is exempt by default until somebody remembers to add it, which is
    the fossil shape this repo derives scope to avoid everywhere else.
    Measured with comments stripped the way the gate itself strips them (a
    naive grep first reported 5 packages; two were comment-only, one of them
    the decision core's own comment EXPLAINING why a decision path may not read
    a clock — the figure below is the corrected one):
      lib/integrations  25 occurrences / 12 files — connector timeouts and
                        retry jitter; plausibly legitimate, needs a read
      lib/webauthn      13 / 3 — challenge expiry and randomness; expected for
                        this domain
      lib/location       5 / 3 — the orphan, and the only one where the clock
                        sits in admission logic
    So "the rule is enforced repo-wide" is not true today, and making it true
    means classifying 43 occurrences across three packages rather than flipping
    a flag. That is real work and a wrong call on connector code would be worse
    than the gap.
    **NEEDS AN OWNER CALL on `lib/location` specifically**, because the options
    trade different things and none is obviously right:
      (a) delete it — zero importers, and the breadth freeze argues for it, but
          it discards real work done for a deferred family;
      (b) keep and repair — make the 5 clock reads caller-posed like
          `continuity.ts` already does, then bring it under the gate. Real work
          with no current consumer;
      (c) keep and declare — an explicit exemption naming the reason and the
          condition that retires it, which is honest but leaves doctrine-
          violating code in the tree.
    Not chosen here: this is product scope, not a skill gap, and the loop's own
    rule is that an agent takes it to the edge and stops where a person carries
    the consequence.

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

## SignalGrid — buyer-legible positioning (Limited GA scope, launch-profile v5)

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
1. lib/signalgrid-core/src/engine.ts (578) — SignalGridCore itself; every /v1 decision flows through it via api-server lib/core.ts.
2. lib/signalgrid-core/src/decision.ts (216) — where allow/step_up/restrict/deny is actually computed.
3. lib/signalgrid-core/src/policy.ts (764) — policy resolution feeding the verdict; the largest logic file in the core.
4. lib/signalgrid-core/src/resolution.ts (576) — signal-to-assurance resolution; the file where 'unknown raises assurance, never lowers it' must hold.
5. lib/signalgrid-core/src/evidence.ts (790) — mints the WHY behind /v1/decisions/{id}/evidence; the product's entire claim is that its answers are explainable.
6. lib/signalgrid-core/src/store.ts (525) — in-memory store semantics behind every tenant-scoped read; a cross-tenant leak would live here.
7. lib/signalgrid-simulator/src/decisionEngine.ts (336) — parity source the iOS port is byte-faithful to; a defect here ships on two platforms at once.
8. lib/posture-composition/src/compose.ts (80) — composes signal kinds into posture; tiny, but every launch signal passes through it.
9. lib/posture-composition/src/adapters.ts (591) — maps connector output into composition; a silent mis-map fails open.

Auth chain (bearer token to tenant principal):
10. artifacts/api-server/src/middlewares/context.ts (198) — THE /v1 auth middleware; OIDC/demo-key fork; unread while neighbor rateLimit.ts was audited.
11. lib/enterprise-auth/src/jwt.ts (205) — token verification.
12. lib/enterprise-auth/src/claims.ts (99) — claims-to-principal mapping; tenant derivation lives here.
13. lib/enterprise-auth/src/jwks.ts (90) — key fetch/cache; wrong caching means accepting rotated-out keys.
14. artifacts/api-server/src/lib/profile.ts (194) — the review-demo vs shared-device-gateway fence; a classification bug mounts demo surfaces in production.
15. artifacts/api-server/src/lib/core.ts (105) — the seam where HTTP hands to the decision core.
16. artifacts/api-server/src/middlewares/idempotency.ts (109) — durable-write dedupe on the decision path.

Served surface and durable path:
17. artifacts/api-server/src/routes/v1.ts (1028) — every served /v1 route including evaluate and the release-path re-evaluation; the spec was audited, the implementation was not.
18. lib/audit/src/backend.ts (318) — the Postgres ledger WRITE path; the audited verify path is provably blind to tail truncation, so append guarantees live only here.
19. lib/persistence/src/decision-store.ts (288) — durable decision writes.
20. lib/persistence/src/session-store.ts (332) — durable session writes and tenant scoping.

Meta-gates (what green means) and launch connectors:
21. scripts/preflight.mjs (660) — the per-push lane CI mirrors; a gate mis-registered here disappears quietly.
22. scripts/launch-profile.mjs (758) — the 180-item (2026-09-06; `node scripts/check-launch-profile.mjs` prints the live total) classification every launch claim trusts; audit each 'launch' reason against source.
23. scripts/check-guard-registries.mjs (188) — the registry-drift detector; a hole here makes gaps silent by construction.
24. lib/integrations/src/integrations/local-authority/evaluate.ts (190) — launch family; device-reported authority, the frontline half of the product.
25. lib/integrations/src/integrations/device-management-health/evaluate.ts (290) — launch family; grades whether a compliance answer is CURRENT — the anti-unearned-affirmative connector, which had better not contain one.

== TIER 2 — ~50 files, weeks 2-3 at the same shift cadence ==
Rest of signalgrid-core: continuity.ts (409), seed.ts (1065), types.ts (840), connector.ts (218), remediation.ts (189), webhooks.ts (78), dock.ts (137), shift.ts (99), audit.ts (93), util.ts (129), metrics.ts (55), simulate.ts (35).
Rest of simulator: routing.ts (211), scenarios.ts (186), types.ts (173), audit.ts (27).
Rest of api-server: app.ts (123), routes/control-plane.ts (524), routes/integrations.ts (2042 — the largest unread file in artifacts), routes/monitoring.ts, health.ts, sim.ts, simulator.ts, radar.ts; middlewares/errors.ts (104 — error envelope, a leak and fail-open vector), deprecation.ts, metrics.ts; lib/assurance.ts, tier.ts, logger.ts, metrics.ts.
Auth/step-up periphery: lib/enterprise-auth/src/config.ts, provider.ts, base64url.ts; lib/webauthn/src/stepUpStore.ts (294) + webauthn/; lib/verdict-attestation/src/attest.ts (275), canonical.ts, types.ts; lib/dual-control/src/evaluate.ts, normalize.ts, types.ts; lib/persistence/src/migrations.ts (175); lib/audit/src/types.ts.
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