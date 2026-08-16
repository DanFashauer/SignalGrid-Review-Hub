# Realistic Launch Plan for SignalGrid

This is a public-safe, honest launch plan. It describes where SignalGrid actually
stands today, the exact first product to build, and the credible sequence from the
current review/validation surface to a real company and production SaaS. Readiness
scores, timelines, pricing, and budgets are planning hypotheses and target gates,
not current claims or vendor quotes.

## The straight answer

SignalGrid is currently a strong public-safe concept, simulator, evidence system,
and pitch package. It is **not yet** a paid-pilot product or production SaaS.

With disciplined scope and the following minimum team —

- you as founder / product lead,
- one dedicated senior full-stack / security engineer,
- fractional cloud / security help,
- startup counsel and accounting support,
- access to one Microsoft sandbox or design-partner tenant —

a realistic schedule is:

| Milestone                                          | Realistic target |
| -------------------------------------------------- | ---------------- |
| Hosted, demo-complete alpha                        | 2–4 weeks        |
| Investor / design-partner-ready product foundation | 10–14 weeks      |
| First paid sandbox pilot                           | 4–6 months       |
| Defensible multi-tenant production SaaS            | 9–15 months      |
| Broader commercial scale                           | 15–24 months     |

If this remains founder-only, part-time, with agents doing most coding but no
dedicated engineering / security owner, double the schedule.

The fastest legitimate path is **not** to "finish every possible integration." It is:

> One painful shared-device workflow → one tenant-aware product → one read-only
> Microsoft connector → one explainable decision loop → one design partner → one
> paid pilot → production hardening.

---

## 1. Where SignalGrid actually stands today

### What is already valuable

The public Review Hub already has:

- Operational Trust Orchestration positioning
- deterministic simulator and connector fixtures
- Microsoft Graph-shaped posture proofs
- credential-reader and smart-locker signal models
- decision guardrails
- connector emulator dashboard
- credential-reader / smart-locker dashboard
- automated proof runs and evidence artifacts
- Autopilot / phase automation
- pitch, outreach, social, diligence, and founder-strategy materials
- a v0.2 readiness roadmap

The repository itself correctly describes its current state as a public
pre-production / review / validation surface, not the production core. It also says
the private SignalGrid repository is intended to remain the protected core
implementation.

The public-safe "Level 10" scorecard measured Review Hub at 7.69/10, but that score
explicitly concerns demo, proof, documentation, messaging, and controlled-testing
readiness — not production deployment.

### What is not yet real

The v0.2 plan honestly records the missing product foundations:

- product-shaped authentication
- durable persistence
- tenant-aware routes
- production authorization
- real connector scaffolding
- real sandbox testing
- design-partner validation
- operational support and security controls

The v0.2 roadmap also makes the correct recommendation: build the
production-shaped tenant / auth scaffold **before** the Microsoft connector, because
every future signal, decision, policy, connector run, and audit record must be
securely tenant-scoped.

### Current active engineering state

**STALE — CORRECTED.** PR #36 was CLOSED WITHOUT MERGING on 2026-07-15; `docs/BRANCHES.md` already records it as closed-unmerged. The only non-Dependabot PR open today is #152. The paragraph below described it as open with outstanding review findings and made clearing it the first action of Week 1, which would have sent a reader chasing a PR that no longer exists. Retained struck-through rather than deleted so the correction is visible.

~~PR #35 is merged. PR #36 remains open as the Autopilot Evidence Bot. Its workflows~~
are green, but two automated-review P2 findings remain around committed-diff checking and
unsafe-claim suppression.

The `signalgrid-complete.zip` package is a meaningful next step. It contains:

- a deterministic in-memory API store
- Postgres fallback switching
- 11 passing engine / store tests
- API route rewrites
- simulator UI changes
- a bootstrap script (`bootstrap.sh`), not present in this repo
- run and go-live documentation

That package can make the public demo demo-complete, but it is **not** yet the
production tenant / auth / connector core.

### Honest readiness assessment

| Area                                | Current readiness                    |
| ----------------------------------- | ------------------------------------ |
| Product thesis and category         | 8/10                                 |
| Public proof and simulator          | 8/10                                 |
| Pitch and founder materials         | 8/10                                 |
| Demo application                    | 6/10 until zip is integrated + hosted |
| Automation and evidence             | 7/10 (~~pending PR #36 fixes~~ — PR #36 closed unmerged 2026-07-15; see §5 correction) |
| Tenant isolation and authentication | 1–2/10                               |
| Real Microsoft connector            | 1/10                                 |
| Versioned policy engine             | 2–3/10                               |
| Durable audit ledger                | 2/10                                 |
| Production security / operations    | 1–2/10                               |
| Customer traction                   | 0/10 until discovery / LOI / pilot   |
| Paid-pilot readiness overall        | roughly 2–3/10                       |
| Production SaaS readiness overall   | below 2/10                           |

This is not a criticism. It means the strategy and demonstration layer are unusually
developed relative to the production core. The next phase must reverse that imbalance.

---

## 2. The exact first product

### The wedge

Do not initially sell "an orchestration platform for everything." Sell one workflow:

> SignalGrid decides whether a frontline worker may begin or continue a session on a
> shared managed device.

Initial target environments:

- hospital shared iPhones / iPads
- warehouse handhelds
- manufacturing shared tablets
- retail shared mobile devices

Primary initial buyer:

- IAM leader
- Endpoint / UEM leader
- Security platform leader
- Frontline technology leader
- Enterprise platform engineering leader

### First real decision loop

```
Worker presents identity
        ↓
SignalGrid resolves tenant + user + role
        ↓
SignalGrid reads cached Entra/Intune posture
        ↓
SignalGrid adds workflow/session context
        ↓
Versioned policy evaluates evidence
        ↓
ALLOW | STEP-UP | RESTRICT | DENY
        ↓
Evidence snapshot + reason codes + policy version + audit event
```

Every decision must store:

```
decision_id
tenant_id
identity_id
device_id
workflow_id
outcome
policy_id
policy_version_id
matched_rules
signals_used
source references
reason codes
request context
latency_ms
created_at
review status
```

### First controlled scenario

A nurse or warehouse worker launches a controlled SignalGrid pilot app from a shared
device. SignalGrid checks:

- identity enabled / disabled
- device managed / unmanaged
- compliance state
- device ownership
- OS and management agent
- last Intune synchronization
- signal freshness
- workflow risk
- assigned role
- optional badge / custody context later

The pilot app calls `POST /v1/decisions/evaluate` and SignalGrid returns:

```json
{
  "outcome": "restrict",
  "reasonCodes": ["DEVICE_NONCOMPLIANT"],
  "policyVersion": "policy-v3",
  "evidenceSnapshotId": "evidence-123",
  "reviewable": true
}
```

During the first design-partner pilot, enforcement should occur **only** in the
controlled pilot app — not directly in the customer's EHR, MDM, or production access
stack. That keeps the first pilot read-only, reversible, and safe.

---

## 3. The correct repository and product structure

### Public repository

Keep SignalGrid-Review-Hub public for:

- synthetic fixtures
- public simulator
- product narrative
- demo UI
- pitch / social materials
- evidence artifacts
- public roadmap
- sanitized architecture
- design-partner review

Do not place live credentials, tenant identifiers, customer data, connector secrets,
private threat models, or production deployment details there. That matches the
repository's existing separation between Review Hub and the protected private core.

### Private production repository

Use the existing private SignalGrid repository as the real product monorepo:

```
apps/
  operator-console
  public-site
services/
  api
  connector-worker
packages/
  auth
  tenant-context
  policy-engine
  signal-normalizer
  audit-ledger
  microsoft-connector
db/
  migrations
infra/
  azure
docs/
  private-security
  deployment
  incident-response
```

The public demo may share sanitized packages or generated fixtures, but
customer-facing runtime logic belongs in the private core.

---

## 4. Product architecture to build

### Operator console

Required product areas: Dashboard, Decisions, Signals, Policies, Integrations, Audit,
Settings, Tenant administration.

### API

Use the existing TypeScript stack rather than rewriting the product. Required API
characteristics:

- OpenAPI contract
- Zod / request validation
- tenant context middleware
- authentication middleware
- RBAC authorization
- request IDs
- structured errors
- rate limits
- body size limits
- secure CORS
- PII-safe logs

### Connector worker

The connector should not call Microsoft Graph during every access decision. It should:

1. synchronize data on a controlled interval;
2. store sanitized raw-event references;
3. normalize useful posture signals;
4. mark signal freshness;
5. make cached signals available to the decision engine.

This provides reliable decision latency even when Graph is unavailable.

### Data model

The first durable schema should include:

```
tenants
users
memberships
roles
api_keys
connector_instances
connector_credential_refs
connector_sync_runs
connector_events_raw
identities
devices
workflows
normalized_signals
policies
policy_versions
policy_rules
policy_tests
decisions
decision_signal_evidence
decision_explanations
audit_events
remediation_actions
webhook_deliveries
```

Every customer-owned row must have `tenant_id`. Every object access must enforce
`object.id + tenant_id`. Never query a customer-owned object only by its ID.

OWASP's API Security Top 10 identifies broken object-level authorization as its first
API risk and specifically says object-level authorization checks should be applied
whenever an API accesses a data source using a user-provided ID. Application-layer
tenant checks should be supplemented with PostgreSQL row-level security where
practical.

---

## 5. The Microsoft connector path

### Initial scope

Build one read-only Microsoft connector: **Microsoft Entra ID + Microsoft Intune**.

Start with `GET /deviceManagement/managedDevices`. Microsoft documents
`DeviceManagementManagedDevices.Read.All` as the least-privileged application
permission for listing managed devices. The tenant must also have an active Intune
license.

Useful initial fields include: managed device ID, Entra device ID, user ID / UPN
reference, device name, owner type, operating system, OS version, management agent,
compliance state, last sync time, enrollment type, supervised / encrypted state.

### Authentication model

For service-to-service synchronization, use Microsoft's client credentials flow with
application permissions and administrator consent. Microsoft recommends supported
authentication libraries such as MSAL and supports certificates or federated
credentials for higher assurance instead of shared secrets. Credentials must never be
published in source code.

Recommended progression:

> Local fixture mode → Microsoft sandbox mode → customer-owned sandbox app
> registration → design-partner admin consent → production multi-tenant connector later.

For the first real connector:

- use read-only permission only;
- store only a Key Vault reference in the database;
- prefer certificate or workload identity federation;
- record connector health;
- record every sync run;
- implement retry / backoff;
- sanitize logs;
- do not implement device write / remediation actions.

---

## 6. Security and compliance foundation

SignalGrid is a trust product, so security is part of the product — not a later
add-on.

### Security baselines

- NIST SP 800-207 for the zero-trust architectural model
- NIST CSF 2.0 for the company security / risk program
- OWASP ASVS 5.0 as the application-security requirements baseline
- OWASP API Security Top 10 for API threat testing

NIST SP 800-207 focuses on users, assets, and resources rather than static network
perimeters and treats subject and device authentication / authorization as discrete
functions before a session is established. That closely matches SignalGrid's intended
decision loop. NIST CSF 2.0 is designed to help organizations reduce cybersecurity
risk. OWASP ASVS provides testable technical security-control requirements and a
secure-development requirements list.

### Minimum paid-pilot security controls

Before a customer sandbox pilot: real authentication, RBAC, tenant isolation tests,
secret manager, encryption in transit and at rest, API rate limiting, secure headers,
audit logging, dependency scanning, code scanning, secret scanning, backup / restore
test, incident response plan, threat model, vulnerability-disclosure contact, and a
penetration test or independent security review.

GitHub code scanning can analyze code for vulnerabilities and coding errors, while
Dependabot can raise automated pull requests for dependency security and version
updates. Generate a CycloneDX SBOM for release artifacts and add provenance / signing
later using a SLSA-aligned process.

### Healthcare boundary

Do not use patient context or PHI in the initial pilot. The first healthcare pilot
should use only: worker identity, device identifiers, device posture, workflow
identifier, role, non-clinical test context, and synthetic patient / workflow
references if needed.

If SignalGrid later creates, receives, maintains, or transmits electronic protected
health information as a covered entity or business associate, the HIPAA Security Rule
requires appropriate administrative, physical, and technical safeguards. That later
phase requires: legal determination of business-associate status, BAA, risk
assessment, access controls, audit controls, incident / breach procedures, retention
requirements, and workforce training.

### SOC 2

Do not start by claiming or buying "instant SOC 2." First build a readiness program:
control matrix, security policies, access reviews, change-management evidence,
incident response, vendor management, risk register, backup tests, and evidence
collection. SOC reporting is an assurance process performed by CPAs around
system-level controls relevant to security, availability, processing integrity,
confidentiality, or privacy. A Type I / Type II engagement comes after the controls
actually exist and operate.

---

## 7. Deployment architecture

### Demo environment

Use a managed runtime for the public alpha demo if that gives the
fastest live URL. The demo should: use synthetic data; not contain customer
credentials; not be marketed as production; be clearly bannered "public-safe
alpha / demo"; and have no sensitive admin functions.

### Staging and production-like environments

Because the first real connector is Microsoft, an Azure-aligned stack is practical:

- Azure Container Apps
- Azure Database for PostgreSQL
- Azure Key Vault
- Azure Monitor / Application Insights
- Azure Container Registry
- GitHub Actions

Required environments: `local`, `public-demo`, `staging`, `production`. Each needs
separate database, secrets, app registration, logging, hostname, deployment
configuration, and retention policy. Never reuse production credentials in demo or
staging.

---

## 8. Company formation from scratch

This work should happen in parallel with product development.

### First 30 days

Engage startup counsel and a CPA to decide entity type and formation state, founder
stock and vesting, tax treatment, IP assignment, and future investment structure. Do
not blindly choose a structure from a template. If institutional venture funding or
strategic acquisition is likely, specifically ask counsel whether a Delaware
corporation is appropriate.

The SBA's launch framework includes market research, business plan, funding,
structure selection, name selection, registration, tax IDs, permits, and business
banking.

Company setup checklist: legal entity, EIN, business bank account, bookkeeping /
accounting system, cap table, founder IP assignment, contractor IP agreements,
business insurance, cyber insurance quote, registered domain, business email,
brand / trademark clearance, privacy policy, terms of service, pilot agreement, NDA
template, and DPA / security addendum. The IRS issues the EIN used for banking and tax
administration. Search the USPTO trademark database and use counsel before making a
major brand investment.

### Intellectual property

Before talking seriously with investors or acquirers: ensure all code is owned by the
company; assign founder-created IP to the company; obtain IP assignments from
contractors; inventory open-source licenses; document third-party / generated code
provenance; confirm the public / private repo separation; and verify no former-employer
confidential material is included.

---

## 9. Team plan

### Minimum team through first paid pilot

- **Founder / CEO (you):** product vision, buyer discovery, vertical knowledge,
  strategic partnerships, fundraising / acquisition conversations, final product
  decisions.
- **Founding engineer:** private core architecture, authentication / tenancy,
  API / data layer, Microsoft connector, deployment, testing. This should be a senior
  engineer with security and enterprise SaaS experience — not only a front-end
  developer.
- **Fractional security / cloud architect:** threat model, Azure architecture,
  security baseline, tenant isolation review, incident response, paid-pilot security
  review.
- **Part-time product / UX designer:** operator console, demo flow, onboarding,
  design-partner usability.
- **Professional support:** startup attorney, CPA / bookkeeper, privacy / security
  counsel as needed, enterprise healthcare or frontline GTM advisor.

### After the first pilot

Add a solutions engineer / customer success lead, a second backend / integration
engineer, an enterprise seller or strategic partnerships lead, and a security /
compliance owner.

---

## 10. Go-to-market plan

### Do discovery while building

Do not wait until production to talk to buyers. First 60-day commercial targets:

- 25 qualified discovery interviews
- 10 full product demos
- 5 serious design-partner candidates
- 2 written pilot / LOI conversations
- 1 selected design partner

Target people: hospital endpoint / UEM directors, identity and access leaders,
shared-device platform owners, security architecture leaders, frontline mobility
leaders, warehouse / retail device operations leaders, and platform engineering
leaders.

### Design-partner offer

The first offer should be: a controlled, read-only shared-device trust decision pilot
using Microsoft Entra and Intune data in a sandbox environment.

Pilot scope: 1 tenant, 1 workflow, 1 application, 25–100 test / shared devices, no PHI,
no production remediation, read-only connector, 8–12 weeks, explicit success criteria,
weekly review.

Avoid free unlimited pilots. A planning hypothesis — not a published price — is a paid
design-partner pilot of **$25,000–$75,000**. Credit part of the fee toward the first
annual agreement if the customer converts.

### Initial pricing hypothesis

Do not price per trust decision initially. Use: base platform fee + tenant /
environment tier + managed device band + connector / workflow modules +
implementation / support. An internal early-enterprise annual hypothesis might be
**$75,000–$200,000+** annual contract. Validate this through discovery before
publishing it.

---

## 11. Pilot success metrics

### Technical (target gates, not current claims)

- 100% of decisions store policy version, evidence references, outcome, and reason
  codes
- zero successful cross-tenant access tests
- no plain allow on missing, stale, unknown, or degraded critical evidence
- p95 cached decision latency below 750 ms
- connector sync completion above 98% in the sandbox window
- operator can trace a decision from outcome to source evidence in under two minutes
- backup restore completes successfully
- all high-severity security findings remediated before production-adjacent use

### Commercial

- customer confirms the workflow is painful and funded
- buyer identifies budget owner
- measurable reduction in investigation effort
- documented value hypothesis
- willingness to continue into a paid annual arrangement
- reference or anonymized case study permission

---

## 12. Fundraising and strategic transaction plan

### Preferred order

1. Customer discovery
2. Live demo
3. Design-partner LOI
4. Real Microsoft sandbox connector
5. Paid pilot
6. Pre-seed or strategic investment
7. Broader production build

The company is more valuable after a paid pilot than after another 100 pages of
documentation.

### Capital strategy

1. bootstrap through hosted demo;
2. secure paid design partner;
3. consider a small pre-seed or strategic minority investment;
4. maintain founder / product control;
5. explore OEM / embedded relationships;
6. consider acquisition only after proof and leverage.

### Founder-control strategy

For a strategic investment or acquisition, negotiate with counsel around: founder
CEO / product leadership role, board or observer rights, product budget, roadmap
authority, hiring authority, IP ownership, licensing rights, change-of-control
protection, termination terms, earnout metrics based on outcomes you can influence,
and treatment of the public and private repositories.

Do not sign away exclusivity or core IP during an exploratory design-partner pilot.
NVCA publishes widely used model venture financing documents, but it explicitly states
that those documents are starting points and are not legal advice for specific
circumstances.

---

## 13. Investor and acquisition data room

Build this while the pilot is underway.

```
01 Company
  formation documents, cap table, IP assignments, founder bio, board/advisor records
02 Product
  pitch deck, executive summary, demo video, screenshots, roadmap, architecture, PRDs
03 Market
  ICP, buyer personas, discovery notes, competitor map, pricing hypotheses, thesis
04 Traction
  demo requests, LOIs, pilot agreement, pilot metrics, usage data, references
05 Technical
  repo overview, security architecture, threat model, API spec, connector design,
  deployment model, audit model, SBOM
06 Security and legal
  policies, risk register, privacy terms, DPA, pilot agreement, insurance, OSS review
07 Financial
  actual expenses, budget, runway, forecast, funding ask, use of funds
```

---

## 14. Realistic engineering sequence

### Phase A — Finish the public demo (2–4 weeks)

1. ~~Fix and merge PR #36.~~ (Closed unmerged 2026-07-15 — see the §5 correction; this step is retired, not pending.)
2. Integrate `signalgrid-complete.zip`.
3. Add the in-memory store and test suite.
4. Run the bootstrap script the package ships with, in your local environment.
5. Boot API and web.
6. Verify all listed endpoints.
7. Deploy a live public-safe demo.
8. Record a short demo video.

**Exit gate:** a reviewer can open a URL and understand SignalGrid without developer
assistance.

### Phase B — Private core tenancy / auth (weeks 3–8)

1. Create tenant, user, membership, role schema.
2. Add operator authentication.
3. Add tenant context middleware.
4. Add RBAC.
5. Add cross-tenant access tests.
6. Add Postgres persistence.
7. Add request validation and security middleware.

**Exit gate:** all customer-owned routes are authenticated and tenant-scoped.

### Phase C — Microsoft sandbox connector (weeks 7–12)

1. Register sandbox app.
2. Configure admin consent.
3. Use read-only permission.
4. Store credential reference in Key Vault.
5. Add connector instance / sync-run tables.
6. Sync managed-device data.
7. Normalize signals.
8. Display connector health.

**Exit gate:** one sandbox tenant produces real normalized device-posture signals
without writes.

### Phase D — Trusted decision loop (weeks 10–16)

1. versioned policies
2. active policy pointer
3. policy test fixtures
4. matched rules
5. evidence snapshots
6. signed or immutable decision records
7. replay / simulate
8. operator decision detail page

**Exit gate:** one real Microsoft-backed decision is explainable and replayable.

### Phase E — Pilot readiness (weeks 14–22)

1. durable audit ledger
2. staging deployment
3. backups and restore test
4. monitoring and alerting
5. incident response
6. security questionnaire
7. design-partner agreement
8. customer success criteria
9. independent security review

**Exit gate:** design partner can safely run a sandbox pilot.

### Phase F — Paid pilot (months 5–7)

1. onboard one design partner
2. connect read-only tenant
3. configure one workflow
4. run 8–12 weeks
5. collect metrics
6. document case study
7. negotiate annual agreement

### Phase G — Production SaaS (months 7–15)

1. hardened multi-tenancy
2. production operations
3. release process
4. availability targets
5. support process
6. privacy / security program
7. penetration test
8. SOC 2 readiness
9. second connector only after customer validation
10. second customer

---

## 15. Budget assumptions

These are planning ranges, not vendor quotes.

| Phase                                            | Approximate cash need (excl. founder salary) |
| ------------------------------------------------ | -------------------------------------------- |
| Company setup + demo completion                  | $15k–$50k                                    |
| Tenant / auth + Microsoft sandbox foundation     | $75k–$200k                                   |
| Paid-pilot readiness                             | cumulative $150k–$350k                       |
| Production SaaS first year                       | cumulative $500k–$1.2M                        |

A full-time salaried team, formal compliance work, or multiple simultaneous
integrations increases this substantially.

Suggested use of funds: 55–65% engineering / product, 10–15% security / cloud,
10–15% legal / accounting / insurance, 10–15% GTM / design-partner work, 5–10%
contingency. The most capital-efficient route is to get a paid design partner to
finance part of the pilot build.

---

## 16. What automation can and cannot do

### Automatable

Agents and GitHub workflows can handle most of: coding, tests, typechecking, builds,
fixture generation, documentation, PR creation, security scans, evidence artifacts,
deployment templates, migrations, runbooks, demo data, and regression checks.

### Cannot be responsibly automated away

You or authorized humans must decide or approve: company formation, tax / legal
structure, IP assignments, Microsoft admin consent, customer tenant access,
credentials and secret ownership, customer contracts, privacy / PHI decisions,
production launch, security risk acceptance, partnership terms, fundraising terms,
acquisition terms, and founder-control tradeoffs.

Engineering can be 85–90% automated. Company governance, customer trust, and
production risk cannot.

---

## 17. What not to build now

Do not build: ten connectors, AI copilot features, autonomous remediation, full
hardware fleet management, patient-context processing, complex billing, mobile store
apps, marketplace listings, federal-compliance claims, customer-specific forks, direct
EHR enforcement, or large hardware purchases. Those are future leverage points. Today
they are distractions.

---

## 18. The immediate 30-day operating plan

### Week 1

- ~~clear PR #36~~ (closed unmerged 2026-07-15 — see §5; retired)
- integrate demo-complete zip
- run full bootstrap
- deploy public alpha
- confirm business entity decision with counsel
- begin trademark / name search
- create business bank / accounting setup
- prepare one 5-minute demo

### Week 2

- begin private tenant / auth scaffold
- conduct five buyer interviews
- create design-partner one-pager
- identify 20 target organizations
- create Microsoft sandbox account / app-registration plan

### Week 3

- implement tenant schema / RBAC
- add cross-tenant tests
- conduct five more buyer interviews
- demo to two potential design partners
- draft pilot agreement and success criteria

### Week 4

- complete first tenant-aware operator login
- select top design-partner candidate
- finalize Microsoft connector sandbox scope
- publish first founder / category LinkedIn post
- record product demo video
- prepare investor / design-partner data-room shell

---

## Final definition of "launched"

SignalGrid has five launches, not one.

1. **Public demo** — a working URL with synthetic data and clear guardrails.
2. **Design-partner program** — a selected company agrees to evaluate the workflow and
   provides sandbox access.
3. **Paid pilot** — a customer pays for a controlled, read-only Microsoft-backed pilot.
4. **Production SaaS** — multiple tenant boundaries, production auth, durable data,
   monitoring, security controls, support, contracts, and independent review are in
   place.
5. **Strategic scale** — SignalGrid expands through enterprise sales, OEM
   partnerships, investment, or acquisition from a position of customer proof.

---

## Bottom line

The realistic path is:

> Finish the demo → form and protect the company → build tenancy / auth privately →
> connect one Microsoft sandbox → prove one shared-device decision → secure one paid
> design partner → harden for production → scale or negotiate strategic options.

The demo can be live within a month. The first serious design-partner product can be
ready within three to four months. A paid sandbox pilot is realistic within four to
six months. A defensible production SaaS is realistically a nine-to-fifteen-month
effort with dedicated engineering, security, legal, and customer participation.

That is the credible path from today's SignalGrid to a real company and product.
