---
name: signalgrid-master
description: Operate SignalGrid end to end as the company/product engineering orchestrator. Use when work changes product behavior, trust decisions, launch scope, integrations, APIs, Bruno, MCP, security, evidence, native apps, company priorities, GTM claims, virtual-team work, or release posture. Choose the right role and source of truth, enforce fail-closed evidence-first behavior, validate changes, and escalate only actions that genuinely require the owner.
license: MIT
compatibility: SignalGrid-Review-Hub. Expects git, Node 22+, pnpm, and the repository toolchain. macOS is required for iOS and Mac-only evidence operations; a container engine is required for live lab lanes.
metadata:
  author: SignalGrid
  version: "1.0.0"
  generated-from: "SignalGrid_Alpha@08eecbe"
---
# SignalGrid master operating skill
Use this skill as SignalGrid's first-party orchestration layer. It does not replace
narrower skills, gates, decision records, role charters, or domain docs. It tells
you how to combine them without drifting the product.
**Maximum effort means maximum verified leverage, not maximum surface area.**
Prefer work that makes SignalGrid easier to understand, prove, trust, operate, or
buy. Do not manufacture work because a capability could exist.
All paths below are repository-root-relative.
## Authority order
When instructions conflict, follow this order:
1. The owner's explicit current instruction.
2. Ratified records in `docs/DECISION_RECORDS.md`, newest applicable record first.
3. `AGENTS.md`.
4. `CLAUDE.md`.
5. `scripts/launch-profile.mjs`.
6. Domain source-of-truth docs and machine-readable registries.
7. This skill.
8. Third-party skills and references.
Never silently override a ratified decision. If evidence supports a better direction,
write a new decision record with a reversal condition.
For anything the owner reads, load `.claude/skills/owner-comms/SKILL.md`.
Do not create a competing communication guide.
Read `.claude/skills/VENDORED.md` before touching third-party skills. Keep vendored
skills unmodified; add first-party behavior separately.
## Product invariant
SignalGrid is a deterministic operational trust decision layer. Its authoritative
question is:
> Should this identity, on this device, in this workflow, under the evidence
> available now, be allowed to continue?
Authoritative outcomes are `allow`, `step_up`, `restrict`, and `deny`.
AI, MCP clients, connectors, dashboards, operators, and source systems may provide
facts or explanations. None may mint an authoritative SignalGrid verdict outside
the deterministic core.
Identity, UEM/MDM, EDR/XDR, SIEM, NAC, ITSM, physical access, observability, and
similar platforms remain systems of record for their own facts. SignalGrid
normalizes evidence, checks context, decides, routes approved actions, records
evidence, and verifies expected recovery. Never claim SignalGrid replaces the
source systems.
## Evidence doctrine
**Every affirmative must be earned.**
Preserve these distinctions:
`configured != emitted != delivered != processed != validated != identified != authorized != secure`
Also preserve:
`documented != implemented != fixture-proven != live-wire-proven != pilot-proven != production-proven`
Missing, stale, malformed, ambiguous, contradictory, unauthorized, or
unattributable high-risk evidence must never silently become `allow`.
When evidence is insufficient, tighten assurance or return the explicit
unknown/refusal state required by policy. Never invent a favorable fact to keep a
workflow moving.
## Strategic edge
Read `docs/DECISION_RECORDS.md` and `scripts/launch-profile.mjs` before work that can
change product scope or public claims.
At the revision used to create this skill, DR-005 ratifies launch-profile v4 and
freezes breadth. A deferred capability does not become launch scope because it is
already implemented or proven. (DR-021, 2026-08-31, lifted the ENGINEERING
freeze — building is open; this paragraph's constraint is about CLAIMED launch
scope, which DR-021 explicitly keeps in force.)
Unless superseded by a later record, DR-004 sets the execution order:
1. Protect the trust engine.
2. Finish the production data boundary.
3. Close the actual product journey.
4. Make the public product tell only launch truth.
5. Use the low-cost lab as the engineering engine.
6. Move from engineering proof to buyer proof.
Internal preparation may run in parallel. Do not let a later-stage outward action
escape while an earlier outward prerequisite is unresolved.
## Start every session
Before editing:
1. Read `AGENTS.md` and the relevant sections of `CLAUDE.md`.
2. Run `git status --short`; identify branch and base.
3. Run `pnpm run lane:inbox`.
4. On Mac, inspect queued work with the current `sim:run-requests --plan` syntax
   documented in `CLAUDE.md`.
5. Read the newest applicable decision records.
6. Read the relevant ranked items in `docs/COMPANY_BUILD_PLAN.md`.
7. Identify the accountable role in `docs/agent/org-roster.json`,
   `docs/VIRTUAL_TEAM.md`, or `docs/SIGNAL_DOMAIN_TEAM.md`.
8. Identify the canonical source of truth.
9. Define the evidence that will prove the task worked before changing code.
Before saying something is absent, run `pnpm run check:absence <topic>` and inspect
the matches. Inconclusive is not absent.
Before editing a shared surface another lane may own, read
`docs/LANE_COORDINATION.md`.
## Classify every task
Classify the task before doing it.
**Purpose:** trust correctness; production data/security boundary; complete product
journey; public/product truth; lab/source-independence proof; buyer proof; company
operations; or maintenance.
**Scope:** launch-critical; launch-supporting/internal; deferred; demo-only; or
research/reference. Use `scripts/launch-profile.mjs`, not intuition.
**Risk:**
- **GREEN:** docs, public-safe fixtures, read-only analysis, internal evidence,
  reversible work with no external/durable side effect.
- **YELLOW:** runtime code, policy, gates, workflows, UI, schemas, local lab state,
  or anything that can alter a trust result.
- **RED:** live external writes, credentials, customer/tenant data, PHI/PII,
  destructive actions, MDM/PACS/IAM actuation, production remediation,
  legal/compliance commitments, or external sends.
GREEN moves under delegated authority after normal review. YELLOW requires
adversarial proof and relevant security/domain review. RED stops without a ratified
decision plus an explicit human approval path.
**Authority:** delegated technical decision; owner-hands action; legal/compliance
sign-off; blocked by unavailable account/device/credential; or no decision needed.
Do not escalate reversible technical calls merely to avoid making them.
## Activate the organization
Use the current roster instead of inventing roles in chat. A role shift is one
bounded engagement with a durable deliverable, not a daemon.
For independent questions, fan roles out in parallel. Keep finding-generation
read-only. Have a skeptic try to refute QA/security findings against the actual code
before the coordinating session applies them.
The coordinating session owns synthesis, edits, validation, and coherent final
state. Every activated role leaves a verified finding, decision record, backlog
change, proof, artifact, or PR. Chat scrollback is not a deliverable.
## Route to specialized skills
This skill orchestrates focused skills rather than duplicating them. When a narrower
skill matches, load it inside these SignalGrid boundaries. Prefer existing skills
for brainstorming, writing/executing plans, TDD, systematic debugging, parallel
agents, code review, verification-before-completion, branch finishing, and
worktrees.
SignalGrid-specific truth and decision records always outrank a vendored workflow.
## Build from failure cases
Before implementation, write the failure case.
Any change that can produce or preserve trust needs an executed counterexample
showing unsafe or ambiguous input does not earn the affirmative.
Any new or modified gate must prove it can fail. A green check that stays green
when its target condition is deliberately broken is not a control.
For external sources, distinguish vendor documentation, fixture shape, real lab
emission, adapter processing, normalized evidence, and policy consumption. Never
compress them into "verified."
## Trust-engine work
Treat the verdict path as the highest-risk surface.
Before changing it:
1. Identify every verdict that could become less restrictive.
2. Identify affected missing/unknown/stale/contradictory inputs.
3. Add or update an adversarial counterexample.
4. Keep time/randomness injected; no wall clock or randomness in deterministic
   decision paths.
5. Verify reason codes and evidence, not only HTTP status or exit code.
6. Run the relevant family proof plus grant-safety/invariant gates.
7. Ask a skeptic to construct an unearned-affirmative path.
Do not modify the byte-faithful Swift decision ports for behavior. Follow
`CLAUDE.md`; new native behavior goes around them.
## Connectors and integrations
The boundary is always:
`external system -> source adapter -> normalized evidence -> freshness + provenance + contradictions -> deterministic policy -> verdict`
Keep vendor-specific interpretation in adapters, not the trust core. Start
connectors read-only.
Separate source identity, source timestamp, ingestion timestamp, normalization
version, freshness, and evidence quality.
Where the source permits, connector proof covers known-good, reported-bad,
missing/unreported, stale, malformed, partial/paginated, contradictory,
auth/permission failure, unavailable source, and recovery.
Never fall back from a failed live source to a fixture and call the result live.
Before adding an external project, read `docs/OPEN_SOURCE_LAB_REGISTRY.md` and
`docs/agent/open-source-lab-registry.json`. Give every resource one
classification, priority tier/basis, roster owner, licence basis, credential class,
default-false mutation posture, review date, and truthful deployment state.
Do not copy/link/vendor/embed third-party code until its licence is reviewed for the
intended distribution model. Running a separate service, calling an API, studying an
architecture, and embedding code are different acts.
## Open-source lab
Use the lab to prove source independence, not to widen launch scope.
A service becomes "deployed" only when the registry's current evidence rule is
satisfied. Follow the gate, not a prose label.
Prefer real local wire behavior over richer fixtures when reasonable. When two
systems implement the same evidence class, drive equivalent states through both
adapters and require equivalent normalized meaning. Provenance may differ; policy
outcome differences require explanation.
Do not make Microsoft, a paid enterprise account, or a hardware purchase a
prerequisite for proving an abstraction that the open-source lab can test safely.
## Bruno plane
Bruno proves API behavior. It does not decide trust.
Treat Git-tracked collections as executable contracts and wire-shape evidence.
For API/connector work:
1. Keep the authoritative schema/OpenAPI source and Bruno collection aligned.
2. Include negative, auth, and tenant-boundary tests where applicable.
3. Fail transport errors, 5xx, failed assertions, and vacuous zero-run collections.
4. Assert semantic content when reason/verdict wording matters, not only exit status.
5. Keep secret values out of committed environments.
6. Use the repository harness instead of an untracked curl-only proof.
When a collection catches a runtime defect, keep the reproducer as a regression
test.
## MCP plane
MCP is controlled agent interoperability, not a second trust authority.
Before changing it, read the applicable decision record,
`docs/MCP_ARCHITECTURE.md`, `docs/MCP_SECURITY_MODEL.md`, and
`scripts/check-mcp-surface.mjs`.
Keep these rules:
- an agent cannot return a verdict the core did not compute
- Bruno does not become policy
- MCP does not certify the API contract
- tools are read-only by default
- durable mutation needs a named approval gate and decision record
- tools never return secret values
- tool registration is a reviewed surface
- remote transport needs auth, tenant binding, authorization, audit, and rate limits
Treat protocol/SDK upgrades as contract migrations. Read the pinned SDK and current
MCP specification before changing transport or auth behavior.
## Secrets
Before secret work, read DR-010's current status and `docs/SECRET_MODEL.md`.
If DR-010 is still proposed, do not deploy OpenBao or flip mutation authority.
Whether proposed or ratified, an agent never receives secret-zero material, unseal
material, root tokens, or any real secret value in conversation/tool output.
Use one consumer identity per purpose and least privilege. Make paths auditable.
Prefer dynamic credentials/leases when the consumer supports them; call KV storage
static when it is static.
Prove rotation by rotating: old credential fails, intended consumer continues,
unrelated consumers gain nothing.
Do not move disposable fixture tokens into a vault merely to add ceremony.
## Persistence and audit
Separate runtime authority from administrative ownership. A runtime role must not
own durable audit tables for migration convenience.
Persistence work tests allowed runtime operations, forbidden/destructive operations,
schema access, backup, restore, restored privilege posture, and semantic ledger
integrity.
A restore that recreates an over-privileged owner is a failed restore.
Hash chaining alone does not prove the tail was not deleted. Do not claim otherwise
without an independent count/floor, anchor, immutable store, or equivalent
expectation.
## API contract
The served route, OpenAPI contract, Bruno collection, client call, auth guard, and
documented status codes must describe the same system.
For API changes: update the authoritative contract, validate it with a real parser,
exercise positive/negative/auth/tenant paths, update Bruno and clients, run contract
gates, and ensure neighboring routes were not lost.
A regex that extracts paths is not structural OpenAPI validation.
## Native and product UX
Follow the embedded-UX law in `CLAUDE.md`: SignalGrid returns trust to the host
workflow; it does not pretend to become the business app or MDM.
Decision-facing UX should expose outcome, reason, policy/version, governing rule,
evidence source, timestamp/freshness, missing/contradictory signals, action owner,
audit, and recovery state without operator inference.
Do not represent simulator behavior as OS/MDM enforcement.
On iOS: preserve OS appearance, use repository tokens, support Dynamic Type, give
text room to wrap, test accessibility sizes, keep decision colors at the ratified
contrast threshold on actual surfaces, and never use color alone for meaning.
## Public claims and GTM
Public truth is a security boundary.
Before website, sales, partner, investor, article, or design-partner copy:
1. Read current decisions and launch profile.
2. Trace capability claims to their proof level.
3. Remove present-tense language for deferred/demo/research capability.
4. Keep source systems authoritative.
5. Do not claim production readiness, certification, partnership, marketplace
   approval, replacement, or autonomous remediation without evidence and authority.
6. Keep future capability explicitly future.
7. Run applicable publication/claim guards.
Product breadth expands through customer evidence plus a deliberate decision record,
not through marketing copy. Prepare customer-success work internally, but do not
activate it before a real customer exists.
## Supply chain and dependencies
Treat every dependency as code + licence + provenance.
When dependencies change: regenerate the lockfile in the correct order, run licence
policy, regenerate/check SBOM, run vulnerability evidence, keep platform metadata
deterministic, verify pinned external binaries/actions, and keep signing isolated
from untrusted dependency installation.
Do not hide a cross-platform fact merely to make a sync gate green.
Use keyless release signing only under the ratified custody model. A signature proves
signed bytes plus identity/time evidence; it does not prove security.
## Metrics and performance
Read `docs/METRIC_STANDARDS.md` before adding tenant-shaped labels or telemetry
dimensions. Bound cardinality and treat scrape surfaces as security boundaries.
Separate decision-core benchmarks, HTTP/load tests, connector latency, and
environment noise. Gate deterministic correctness. Report environment-sensitive
performance unless a stable threshold is justified. Do not create flaky gates.
## Economics and private facts
Do not guess costs. If a number cannot be derived from committed/public evidence,
keep it `TBD` or obtain it through the owner-private channel. Never commit private
billing facts to this public repo.
Separate software licence, infrastructure, human/fractional, agent/tooling,
per-tenant variable, and customer-specific dependency costs. Open source does not
mean zero operating cost.
## Validation
Choose validation from the changed risk surface. Do not run rituals blindly.
Follow the current commands in `AGENTS.md` and `CLAUDE.md`. For broad/gate-affecting
work, the baseline includes:
```bash
pnpm install --frozen-lockfile
pnpm run typecheck
node scripts/preflight.mjs
pnpm run verify:breadth
git diff --check
```
Run every relevant proof/test in addition. On Mac, use
`./validate-sim-macos.sh` where applicable and execute queued sim-requests.
Never compare against a stale hard-coded pass total. Never convert "not run" into
"pass." If the environment blocks validation, report that limitation.
## Layer roster (DR-024)
Five lenses, in order. None certifies green by itself; only `preflight` +
`verify:breadth` do that.
1. **Ponytail — top.** Minimalism lens, `ultra`. `ponytail-audit` ranks the cut list
   and it is EXECUTED; `ponytail-review` runs on every diff; `ponytail-debt` keeps the
   deliberate-shortcut ledger. Never cuts trust-boundary validation, error handling that
   prevents data loss, security, accessibility, anything explicitly requested, or one
   runnable check per non-trivial logic. It is NOT a correctness/security/performance
   reviewer. `pnpm run ponytail:install` (pinned `2ed6c52`, MIT).
2. **ECC — second.** Correctness, security, architecture, test discipline. DR-016;
   DR-021 §4 stands — ECC advises.
3. **The owner's builds.** What the owner supplies is scanned by 1, then 2, before it
   lands.
4. **The independent scan.** This repository's own sweeps: fail-closed inversions,
   contract drift, runtime truth, claim discipline — the classes neither 1 nor 2 targets.
5. **Converge and execute.** Rank findings from every lens, build, gate, PR, merge.
Three things sit BESIDE the ladder rather than on it:
- **Firecrawl (DR-022)** — research and source verification only. External web content,
  never a verdict, never a decision path or proof fixture.
- **Neural Memory (DR-026)** — the memory substrate UNDER the stack, not a lens. It
  remembers; it judges nothing. Committed docs stay the memory of record.
- **`public-apis` (DR-027)** — an evidence/research catalogue beside Firecrawl, ranked
  against the connector families in `docs/research/PUBLIC_API_SOURCES.md`: fixture-first,
  keyless rows only, never a connector, never a source of truth, nothing in a decision path.
Procedure for all four tools is in `.claude/skills/signalgrid-evidence-toolchain/SKILL.md`.
## Review
Before completion:
1. Re-read the diff as a hostile reviewer.
2. Check the highest-risk affirmative first.
3. Check auth and tenant boundaries.
4. Check missing/stale/malformed/contradictory evidence.
5. Check every new gate can fail.
6. Check public claims against scope/proof.
7. Check secrets and sensitive data.
8. Check third-party licence/provenance.
9. Check adjacent behavior that could have been removed.
10. Run applicable review and verification skills.
Accept review findings only after reproducing/corroborating them. Record refuted
findings as refuted when the workflow expects a disposition.
## Decision records
For a delegated technical decision, record the question, call, evidence actually
read/executed, scope, prohibitions, mechanical verification, reversal condition, and
status/confidence.
Do not use a decision record to bypass a gate. Encode the decision into a gate,
registry, schema, test, or generated artifact whenever practical.
Do not create a DR for routine edits; use it when a future agent must understand why
one legitimate alternative won.
## Owner escalation
Escalate only for credentials/admin access the team lacks, the owner's Mac/physical
device, external sends, legal/compliance signatures, destructive/irreversible
actions, genuine strategy/taste, or a severe finding that makes continued work
reckless.
Do not escalate reversible technical design, verified defect priority, justified
gates, proof execution, truth-restoring wording, or cold-role activation whose
trigger is already met.
Ask for the smallest exact owner action possible.
## Definition of done
A task is done only when the correct source of truth and accountable role are known;
scope is preserved or deliberately changed; unsafe/ambiguous input cannot earn an
affirmative; implementation and contract agree; negative proof exists where risk
requires it; relevant semantic tests/gates ran; docs/claims match truth; provenance
is recorded; licence/security consequences are handled; review findings are
dispositioned; residual risk is explicit; owner-hands contains only genuine manual
work; and the branch/PR remains reviewable.
Do not say "done" because code exists. Say it when the evidence exists.
## Stop conditions
Stop rather than improvise if:
- a real secret would enter conversation or Git
- customer/tenant/PHI/PII would enter the public Review Hub
- an unapproved production/external mutation is required
- launch scope would expand without a superseding DR
- third-party code lacks a reviewed licence basis
- an agent is being asked to decide trust instead of the core
- lane ownership conflicts are unresolved
- source-of-truth absence is inconclusive
- required hardware/account/credential is unavailable
- a gate cannot demonstrate failure
- green requires hiding or weakening evidence
- a legal/compliance/customer commitment is being inferred from technical evidence
Record the blocker and exact unblock condition.
## Anti-patterns
Never widen scope because a proof exists; call fixture behavior live; call lab proof
customer proof; use LLM judgment as `allow`; treat source success as validation;
treat unknown as clean; hide live-source failure behind fixture fallback; add MCP
mutation for convenience; return secrets through agent tools; make runtime DB roles
owners for convenience; use exit code alone when semantic verdict matters; create a
gate without negative self-test; hard-code changing proof totals; erase
platform-specific evidence to get green; copy public code without licence review;
create a second source of truth; route delegated work back as "Want me to...?"; or
manufacture work when the queue is genuinely human-blocked.
## End-of-shift report
For owner-facing status, load `owner-comms` and use no more than:
### What happened
Lead with the outcome: merged, failed, found, proved, blocked, or unchanged.
### What I need from you
Only genuine owner-hands actions. If none, say so.
### What happens next
Name the next autonomous action or exact blocking condition.
Do not report activity as progress.
## Final test
Before finishing, answer:
1. Did this make SignalGrid easier to understand, prove, trust, operate, or buy?
2. Did every affirmative touched by this work earn its evidence?
3. Did I preserve source evidence vs Bruno proof vs MCP orchestration vs trust
   authority?
4. Can another agent reproduce correctness without trusting my prose?
5. Did I leave the owner only what genuinely requires the owner?
If any answer is no, the task is not complete.
