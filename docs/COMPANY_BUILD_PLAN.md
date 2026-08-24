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
    38/48. An assertion that cannot distinguish the fix from the bug is not
    coverage.
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
    The core proof now runs 225 assertions. Falsified by exit code, not by eye:
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
    resolves each against the profile itself: 7 references against 179
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
    Reading the eight `tests/security-reference/` suites settled what they are:
    not portable, and honestly labelled. They are Vitest specs against the
    retired DEV Next.js server — `/api/session/start`, `/api/health`,
    `badgeUid`, launched with `bun run scripts/test-server.ts` — and none of
    those endpoints exist on this monorepo's `/v1` surface. One of them tests
    step-up enforcement, a DEFERRED family, so there is no shipping surface to
    port it onto yet. Their README already says "reference to port, not yet
    wired into CI", and it is true.
    That truthfulness was the problem: prose does not fail a build, and nothing
    stopped those eight from being written and never run, or an eleventh from
    joining them. `scripts/check-test-execution.mjs` (preflight + CI, parity
    green at 212 gates) now derives what actually runs — expanding package
    scripts transitively from preflight, the CI workflows and
    validate-sim-macos.sh, 110 scripts reached — and requires every
    test-shaped file to be REACHED or DECLARED with a reason and a disposition.
    It reports 21 test files: 12 reached, 9 declared. A declaration that
    outlives its reason fails, so porting a suite retires its line and the last
    one out deletes the entry. Falsified three ways: a planted orphan test →
    exit 1; a declared file that IS reached → exit 1; restored → exit 0.
    STILL OPEN under this row: `artifacts/mcp-server/test/server.test.ts` (its
    unique assertions want folding into the gated `proof:mcp-server`, then the
    orphan deleted) and the k6 scripts in `tests/load/`, which the gate
    deliberately does not pattern-match and says so in its own header.
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
    The decision, which is not this lane's to make silently: widen
    signalgrid-core to claim both web trees, or add a web skill and give it
    them. Either way the two roles get re-pointed and the executor gate starts
    meaning something for them. Until then `lane` is correct and should not be
    quietly upgraded to make the roster look better staffed.

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