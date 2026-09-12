# Recommended Design — The Standing Brain Cycle

**Spine:** Design 1 (Blackboard Brain Cycle), the highest-scored design (feasibility 5, security 4, cost 3, maintainability 4).
**Grafts:** the one-file-per-lens board + consensus floor (Design 2), provenance-before-run + touched-surface router + the absent=HARD-NO self-test (Design 3), and the surface-fingerprint cost cache + two-lane parity precondition (Design 4).

Routine id: `brain-cycle`. Verdict: build it. Ship Slice 1, auto-OPEN-only, cloud-first.

---

## 1. The loop, in one picture

Once a day the cloud lane wakes on its account trigger and runs one orchestrator (`scripts/brain-cycle.mjs`):

1. **Brain-parity gate (STEP 0, fail-closed).** `git fetch origin SignalGrid_Alpha`, then assert this lane's `.claude/` + `.mcp.json` + `.claude-plugin/plugin.json` tree matches `origin/SignalGrid_Alpha`. Behind → **refuse, heartbeat "stale brain, did not audit."** A brain behind mainline audits the wrong code.
2. **Swarm audit.** Fan the touched-surface lens panel — the four repo-signature agents plus the generic panel — in parallel over the real HEAD diff via `.claude/skills/dispatching-parallel-agents`. Each lens writes exactly one file.
3. **Blackboard.** All lens files land in one committed per-cycle directory. A derived `_manifest.json` names every lens that was *expected*, so a lens that failed to post is visibly MISSING, never silently absent.
4. **Orchestrator decides.** Pure deterministic code reads the whole board, ranks findings, and picks the single winning route — never a model verdict (golden rule 2).
5. **Validation gauntlet.** The winner's implemented diff climbs a fixed pipeline: `preflight` → `verify:breadth` → touched-surface adversarial panel → publication/claim gates → `classifyDiff`. Any red halts.
6. **Auto-PR of the winner.** If every stage is green, auto-OPEN a PR (never auto-merge). Owner-gated surfaces open a PR at most; a human still merges.
7. **Recurrence.** Deliver a firing heartbeat through `scripts/lane-deliver.mjs`; wake the other lane via mailbox PR #439.

On a quiet day it opens nothing and heartbeats "quiet." That is a success, not a gap.

---

## 2. Architecture mapping

**Hybrid = Centralized Orchestrator (shell) + Blackboard (substrate) + Collaborative-Swarm fan-out (audit) + Pipeline (gauntlet), with Role-Based routing.** The owner's own words — "all audits land in one shared space and are compared," "the brain picks" — map one-to-one onto Blackboard + Orchestrator.

| Owner pattern | Role here | Why |
| --- | --- | --- |
| **Centralized Orchestrator** | The shell and the *only* decider | Fail-closed doctrine (golden rule 2) needs one deciding authority and one veto point. `scripts/brain-cycle.mjs` is a reader/comparator, not a manager. |
| **Blackboard** | Where audits land and are compared | The repo already treats committed `artifacts/` (sim-results, heartbeats, lane-messages) as durable shared state. A committed cycle directory is the same move, not new infra. |
| **Collaborative Swarm** | The parallel audit fan-out | Lens diversity is the point: `fail-closed-auditor` sees what `code-reviewer` cannot, and neither waits on the other. One file per lens → zero write contention (the swarm invariant). But it is a **bounded** role set, dispatched — not an unbounded, non-deterministic swarm. |
| **Pipeline** | The gauntlet tail | `preflight → verify:breadth → adversarial panel → publication/claim → classifyDiff`, fixed order, each stage abortive. |
| **Role-Based** | Who audits + who reviews | Only the lenses a diff touches run — the cost bound — mirroring `docs/DEFINITION_OF_DONE.md`: "every role the change actually touches, no more, no fewer." |
| **Event-Driven** | The edge only | Wake = a comment on mailbox PR #439 (`docs/agent/lane-mailbox.json`) via `subscribe_pr_activity`. Reused, not built. |

**Rejected as the dominant shape:** pure Collaborative Swarm / Decentralized (no single fail-closed authority; a robot merging its own safety net is forbidden by `scripts/check-owner-gated-surfaces.mjs` SAFETY_MACHINERY), and Hierarchical beyond one tier (over-built for a one-owner shop). It *is* a hybrid, but the load-bearing pair is Orchestrator + Blackboard; everything else is a thin tail.

---

## 3. Brain parity (cloud == Mac)

Parity is already **enforced on pull** for the git-half; the cycle's job is to refuse to run on a stale one.

**What git carries byte-identically on pull** (`docs/MCP_AND_SKILLS_LANE_PARITY.md`, canonical): `.claude/skills/` (32 tracked dirs), `.claude/agents/` (13), `.claude/commands/`, `.claude/settings.json`, `.claude/hooks/*.sh`, `.mcp.json` (`signalgrid-mcp` only, no creds), `.claude-plugin/plugin.json` (DR-030), and `docs/*`.

**What already holds that half internally consistent** (both `scripts/preflight.mjs` and `.github/workflows/review-hub-ci.yml`, self-tested both directions):
- `scripts/check-plugin-manifest.mjs` — the manifest `agents[]` must **equal** `git ls-files .claude/agents/*.md`. Scope derived from git, fail-closed on empty derivation. This is the pattern every new parity gate copies.
- `scripts/check-agent-roster.mjs`, `scripts/check-org-roster.mjs`, `scripts/check-skill-plane-conformance.mjs` — tier/charter/shape.

**The hole this design closes** — the current-state map's named single biggest hole: *nothing asserts cloud HEAD == Mac HEAD == origin for `.claude/`; parity ON PULL is discipline, not a gate.* We close it with a **new `scripts/check-brain-freshness.mjs`**, patterned exactly on `check-plugin-manifest.mjs` (scope derived from `git ls-files .claude/`, fail-closed on empty), wired into preflight + CI like the other four parity gates, and invoked as the cycle's STEP 0:

```
git fetch origin SignalGrid_Alpha
git diff --quiet origin/SignalGrid_Alpha -- .claude/ .mcp.json .claude-plugin/plugin.json
```

Two corrections the judges required, both load-bearing:
- **Scope is `.claude/` + `.mcp.json` + `plugin.json` — NOT `docs/`.** The cycle itself commits into `docs/agent/` and `artifacts/`; including `docs/` in the freshness check is near-self-deadlocking (constant refusal on the cloud lane) or vacuous (the ephemeral cloud lane re-pulls to tip anyway).
- **Diff against `origin/SignalGrid_Alpha`, not local HEAD.** The Mac's last-reported `.claude/` tree-hash rides in `artifacts/agent-heartbeats/mac-lane-tick.json`; the three-way compare (cloud HEAD == origin == Mac heartbeat) is the cross-lane parity check `RESOURCE_INTAKE` row 47 filed as unbuilt. Tolerate one-commit-ahead mid-merge (treat origin as source of truth) so a benign lag does not stall the whole cycle.

**Connectors — the one non-git half.** `pnpm run mcp:setup` (`scripts/setup-mcp-lane.mjs`) installs Context7 / Neural-Memory / Firecrawl / GitHub / Playwright per machine, keys env-only. STEP 0 runs it idempotently and **records each lane's registered MCP-server set + pins into the blackboard header**; divergence is REPORTED (keys are per-machine, best-effort). A **missing** research/memory connector downgrades those lenses to "did not run = NO" — never a silent pass. Promote `scripts/scan-agent-plane.mjs`'s DR-018 synced-mirror byte-compare from report-only to a **blocking** header line (DIVERGED → refuse).

---

## 4. Auditor roster

Every executable resource is a lens over the **real** HEAD tree (audit what shipped, not a description of it). Lenses emit `ReportFindings`-shaped findings; the deterministic gate suite + `classifyDiff` are the only fail-able authorities (golden rule 2 — a model never decides a verdict).

| Lens (resource) | What it audits | Lane |
| --- | --- | --- |
| `.claude/agents/fail-closed-auditor.md` (opus) | Directional unknown-loosens-vs-tightens; figure/doc drift; the operating loop ("a check that did not run is not a pass"). **VETO lens.** | Cloud |
| `.claude/agents/verdict-core-reader.md` (opus) | Decision path line-by-line, keyed to `docs/agent/review-coverage.json` (runs when the diff touches `lib/signalgrid-core` / `-simulator`) | Cloud |
| `.claude/agents/agent-platform-steward.md` (opus) | The `.claude/` instruction layer vs the code it governs | Cloud |
| `.claude/agents/gate-and-proof-engineer.md` (opus) | Can a gate actually fail (plant-defect both directions). **Remediation owner, not a voter**; the only Write-capable agent — read-only during audit. | Cloud |
| `.claude/agents/code-reviewer.md` (sonnet) | General correctness/quality, >80% confidence, on every diff | Cloud |
| `.claude/agents/security-reviewer.md` (sonnet) | OWASP Top 10, secrets, SSRF, injection, authz (auth/API/input). **VETO lens.** | Cloud |
| `.claude/skills/signalgrid-reviewer` / ORG.md Reviewer | Mandatory independent adversarial pass on every diff (7 PRs once merged with zero reviews because it was optional) | Cloud |
| `.claude/agents/architect.md`, `refactor-cleaner.md`, `tdd-guide.md`, `doc-updater.md` | Design smells; dead code; test coverage; doc drift (routed by surface) | Cloud |
| ECC (`pnpm run ecc:install`) | Review/plan/build-fix pass — **report-only advisory** | Cloud |
| ponytail (`pnpm run ponytail:install`, DR-024) | Minimalism ladder — **report-only advisory**, and the tie-breaker | Cloud |
| Native suite: `preflight`, `verify:breadth`, `review:invariants`, `check:*`, `proof:*`, `test:api` | The fail-able deterministic judges | Cloud |
| `signalgrid-mcp` tools (`evaluate_decision`/`explain_decision`/`evidence_freshness`/`query_audit`) | Decision behaviour + evidence freshness + audit trail vs the fixture core | Cloud |
| `.claude/agents/e2e-runner.md` (iOS-simulator half) | iOS UI journeys | **Mac** |
| Swift-twin `xcodebuild` (EnterpriseShell / SignalGridMobile) | Native build parity — **read-only**, never a behavior edit to `DecisionEngine.swift`/`AppWorkflows.swift` | **Mac** |
| `validate-sim-macos.sh` (full) | Native proof run | **Mac** |
| `verify:all --require-mcp --emit-evidence` | Sole minter of `artifacts/live-evidence/mac-run.json` (refuses on CI) | **Mac** |

**Cloud/Mac honesty (the NOT_SCANNED discipline).** A lens a lane cannot run posts a file with `verdict: UNVERIFIED` — never absent, never green — mirroring `scan-estate-citations`. When a winning route touches `native/ios` or the web bundle, the orchestrator **queues a sim-request** (`scripts/lib/sim-operations.mjs` → `artifacts/sim-requests/`) for the Mac tick and marks that finding `laneVerified:false`. It is never counted green until `artifacts/sim-results/` returns it. **Cloud never blocks on the Mac being awake.**

**Excluded (judge nothing):** `planner.md` (produces plans), `neural-memory` (substrate), OmniRoute / LM Studio (model access), all infographics. Naming them keeps them from being mistaken for lenses.

---

## 5. Blackboard

**One committed directory per cycle:** `artifacts/brain-cycle/<cycle-id>/` where `<cycle-id>` = the audited commit sha. It is autonomous-tier (not on the SAFETY_MACHINERY / OWNER_RESERVED lists in `check-owner-gated-surfaces.mjs`), so the ledger itself can ride inside an auto-mergeable PR.

- **One file per lens per lane:** `<lens>.<lane>.json`. One writer per file → zero write contention (the collaborative-swarm invariant) and a clean cross-lane, cross-cycle diff.
- **A derived `_manifest.json`** at the root listing which lenses were **expected** this cycle (membership derived the way `verify-breadth` membership is), so a lens that failed to post is visibly **MISSING**, not silently absent.
- **`decision.json`** — the orchestrator's ranking, winner, chosen workflow, `classifyDiff` tier, and gauntlet result.

Each lens file is self-describing and evidence-first:
```json
{
  "cycle": "<sha>", "lens": "...", "lane": "cloud|mac",
  "auditedSha": "<sha>",
  "provenance": { "workingTreeClean": true, "headSha": "<sha>" },
  "verdict": "APPROVE|WARNING|BLOCK|UNVERIFIED",
  "findings": [ { "category", "file", "line", "summary", "failure_scenario", "verdict", "confidence", "veto", "proposedRoute" } ],
  "evidence": "<quoted real command output — never a claim>",
  "ran": true, "ranAt": "..."
}
```

Two rules the repo already learned the hard way, imported verbatim:
- **Provenance is sampled BEFORE the runs** (`scripts/mac/run-requests.mjs` rule) — the field answers "what code produced this result," i.e. the state at launch, not the runner's own output.
- **Evidence is quoted command output, never a claim** (Truth-and-completion rules).

**Delivery.** The board is **not** routed through `lane-deliver.mjs` — its `MAIL_DIRS` stages only `artifacts/lane-messages` + `artifacts/agent-heartbeats` + the coverage page. The full session commits the board on its own lane branch (`lane/cloud-mail-<stamp>` on cloud → PR + `enable_pr_auto_merge`; direct to `SignalGrid_Alpha` on Mac). `lane-deliver` is reused **only** for the one-line firing heartbeat — so no `lane-deliver` change is needed. "Compared" = a deterministic merge in the script: dedup by `file`+`category`, sort by `(severity, confidence)`, float any CONFIRMED veto-lens finding to the top.

---

## 6. Orchestrator decision

Pure deterministic code with its own self-test — "the brain picks" means **the script ranks, it does not ask a model which route is best.** The orchestrator never re-judges code; it selects among routes the swarm surfaced and the deterministic gates validated.

**Router (the cost bound + the "how many votes" surface).** A touched-surface → lens map that **mirrors `classifyDiff`'s path→tier mapping** and reads `docs/agent/review-coverage.json` for surface coverage:
- auth / API / input → `security-reviewer`
- `lib/signalgrid-core` / `-simulator` → `verdict-core-reader` + `fail-closed-auditor`
- any `scripts/` → `gate-and-proof-engineer` (remediation, not a vote)
- every diff → `code-reviewer` + the independent `signalgrid-reviewer`

Only the panel a diff touches runs. **A "run the full panel to be safe" fallback is explicitly forbidden** — that is the expensive anti-pattern, and it is capped by a hard per-cycle agent count.

**Eligibility (fail-closed).** A candidate route is eligible only when ALL hold:
1. **Consensus with a floor:** CONFIRMED by ≥1 veto lens **OR** ≥2 independent lenses. A lone unconfirmed finding never wins. (The floor is what stops a daily swarm from opening low-value PRs that train the owner to ignore them.)
2. **Zero veto:** neither `security-reviewer` nor `fail-closed-auditor` posted a BLOCK touching it.
3. **No missing/unverified expected lens:** every lens in `_manifest.json` posted, and none is `UNVERIFIED` on a surface the route depends on. A lens that did not run / was rate-limited / was skipped for a missing credential is a **HARD NO in the orchestrator's own logic** — deliberately not deferred to a gate, because there is no gate that asserts a reviewer ran (a permanent-condition check gets scrolled past).
4. **Tier known:** `classifyDiff(files)` (imported from `scripts/check-owner-gated-surfaces.mjs`, never re-derived) returns a clean tier. An unrecognised owner-gated shape escalates.

**Ranking among eligible candidates:** fewest/lowest-severity residual WARNs → then the ponytail minimalism ladder (DR-024, smallest correct diff) → then lowest verification cost (a cloud-verifiable candidate outranks a Mac-required one). Ties escalate to the owner.

**Outcome.** Top eligible candidate is the winner; its ordered edit plan is recorded and handed to the **owning writer agent** (`gate-and-proof-engineer` for `scripts/`, the surface's role otherwise) — auditors are behaviourally read-only and never fix what they found. No eligible candidate → open nothing, heartbeat "quiet." Ambiguous / owner-gated / tie → escalate to the owner, never auto-pick.

---

## 7. Validation gauntlet

Composes the two disjoint layers that already exist (`docs/SELF_REVIEW.md`; `DEFINITION_OF_DONE.md` gates 2+3) into one auto-ship decision — the missing piece is only the composition. The winner's **implemented diff** clears this pipeline, in order, before any PR opens. Config lives in one committed file (`docs/agent/brain-cycle-config.json`): the per-surface panel map, required-vs-advisory stages, veto lenses, min confidence, per-cycle agent + token cap, and the GREEN auto-merge master switch (default OFF).

1. **Mechanical.** `scripts/preflight.mjs` FULL (never `--quick`; verdict read in a separate step) + `pnpm run verify:breadth` (its own CI job) + `scripts/check-preflight-ci-parity.mjs` + `scripts/check-ci-preflight-sync.mjs`, so the gauntlet cannot pass on a gate that runs only locally. A self-skipped or platform-unavailable step counts as **NOT passed**. Read the SUMMARY honestly: M against 0, and read S.
2. **Adversarial.** The routed touched-surface panel (§6), re-run on the diff. Pass condition = **UNANIMITY** on the routed panel with 0 CONFIRMED CRITICAL / fail-open findings; `security-reviewer` and `fail-closed-auditor` are vetoes. Not N-of-M voting.
3. **Bug hunt.** `/code-review` at high/max + `gate-and-proof-engineer`'s planted-defect-both-directions on any new/changed gate.
4. **Publication / claim.** `scripts/check-publication-boundary.mjs` + `scripts/check-launch-claims.mjs` gate what the PR may **say** (building ≠ claiming, DR-021).
5. **Merge classification.** `classifyDiff(winner.files)` — imported.

**What BLOCKS the auto-PR:** any mechanical gate red or skipped; any CONFIRMED CRITICAL / fail-open finding; any veto BLOCK; any lens `ran:false`; any Mac-only UNVERIFIED surface the winner depends on; a publication-boundary violation; and — critically — a **reviewer absent / rate-limited / credential-skipped, which is a HARD NO in the orchestrator's own logic.**

**What can NEVER auto-merge (owner-gated, per doctrine):** `classifyDiff` → owner-gated blocks auto-merge (auto-OPEN is still allowed). Two lists, verified fail-closed (autonomous only when NO file hits either; one owner-gated file taints the whole diff):
- **SAFETY_MACHINERY:** `scripts/**`, `.github/workflows/**`, any `*proof*.{ts,mjs,js}`, `fixtures/`, gate/guard registries, `pnpm-workspace.yaml` / `pnpm-lock.yaml`, `docs/DECISION_RECORDS.md`. A robot cannot merge a change to its own safety net — the mutation sweep that would catch a weakened gate runs POST-merge. **The cycle's own machinery is SAFETY_MACHINERY, so it can never self-merge its own improvements.**
- **OWNER_RESERVED:** LICENSE/NOTICE, compliance & threat-model docs, `docs/LAUNCH_PROFILE.md`, `docs/COST_MODEL.md`, pricing/positioning (`Pricing.tsx`, `docs/POSITIONING.md`), buyer-facing site & outreach.

**Auto-MERGE** (`mcp__github__enable_pr_auto_merge`) is wired to **REFUSE** unless `classifyDiff==autonomous` AND every stage green AND `classification==GREEN` AND the owner's explicit GREEN opt-in switch is set (`docs/LEVEL_10_AUTOPILOT_RUNBOOK.md`: GREEN auto-merge is a future owner-only opt-in). Until per-PR gate falsification exists, **the cycle ships auto-OPEN only.**

---

## 8. Recurrence

**One account trigger** (`trig_*`, created out-of-tree via `create_trigger`/`CronCreate` **after** owner authorization), **self-session bound** — NOT fresh-session-per-fire (the retired `live-sync-loop-keeper` proves a fresh session has no push path and delivered zero heartbeats in 41 days). It fires a cloud self-session that can run `lane-deliver`.

**One row** in `docs/agent/scheduled-routines.json`, shaped on `cloud-lane-hygiene-sweep` (its closest analogue: cloud self-session, daily-ish cron, heartbeat via `lane-deliver`):
- `id: "brain-cycle"`, `binding: "self-session"`
- `cron: "35 8 * * *"` — an `N H * * *` shape `cronIntervalHours()` already parses, so **no gate change**
- `cadenceToleranceHours: 50` — rule 3 requires ≤ `max(3×interval, 3h)` = 72 for daily; the registry uses 50
- `writeScope`: `artifacts/brain-cycle/**` + `artifacts/lane-messages/**` + `artifacts/agent-heartbeats/<routine>.json (created on first fire)`
- `heartbeatPath: artifacts/agent-heartbeats/<routine>.json (created on first fire)`
- `authorizedBy` + `authorizationEvidence` quoting a **real** owner message — FATAL if missing; no consent inferred. Until Dan authorizes, ship the row as `status:"awaiting-activation"` with `awaitingReason` ≥40 chars + `awaitingSince`, exactly like `mac-lane-tick`.
- Bump the registry's top-level `transcribedFrom` to the new `trig_*` transcription date (an undated transcription is itself FATAL).

**Gate.** `scripts/check-scheduled-routines.mjs` validates the row unchanged (preflight + CI + inside `lane-deliver`'s worktree) and holds the declaration against the firing evidence. It gets one new self-test case.

**Delivery + wake.** `pnpm run lane:deliver heartbeat brain-cycle "quiet | acted: opened PR #NNN for <route>"` — a throwaway worktree at `origin/SignalGrid_Alpha`, gated inside the worktree, then: **Mac** → direct push to Alpha; **cloud** → `lane/cloud-mail-<stamp>` + `gh pr create` + `enable_pr_auto_merge`. Confirm with `git ls-remote`, then wake the other lane by commenting on mailbox PR #439 (`docs/agent/lane-mailbox.json`). Add a brain-cycle freshness line to the cloud session-start brief (Slice 2).

**Both lanes, no new Mac routine.** The Mac half is **not** a second account trigger: brain-cycle's Mac-only audits are queued as `artifacts/sim-requests/` and serviced by the existing `scripts/mac/lane-tick.sh` `*/30` launchd tick → `sim:run-requests` → committed `artifacts/sim-results/`, which is how the cloud learns the Mac run happened.

**BOOTSTRAP ORDER (strict).** Land the `brain-cycle` row on `SignalGrid_Alpha` FIRST — `lane-deliver` builds its worktree from origin and reads mainline's registry, so a heartbeat for an undeclared routine refuses ("not a routine declared") and an unowned heartbeat file would be FATAL. Deliver the first heartbeat SECOND.

---

## 9. Phased build plan

### Slice 1 — smallest end-to-end proof (cloud-only, auto-OPEN only, ~1–2 sessions)
The whole loop with the minimum panel and the terminal push proven, plus the fail-closed arm.

**Deliverable:** `scripts/brain-cycle.mjs` that on the cloud lane runs:
1. **STEP 0 brain-freshness** via the new `scripts/check-brain-freshness.mjs` (built in this slice — it is a PREREQUISITE, not a follow-on): `git fetch` + assert `.claude/` + `.mcp.json` + `plugin.json` match `origin/SignalGrid_Alpha`; refuse + heartbeat if behind.
2. **Dispatch the panel** over the HEAD diff via `dispatching-parallel-agents`: **both** veto lenses ALWAYS (`fail-closed-auditor` + `security-reviewer`) + `code-reviewer` + the independent `signalgrid-reviewer`, each writing one board file + a derived `_manifest.json` that names them. The manifest MUST include every configured veto lens — `decide()` HARD-NOs a manifest that omits one (`vetoLenses ⊆ expected`), so both vetoes run every cycle regardless of the touched surface.
3. **Write the board** `artifacts/brain-cycle/<sha>/` (lens files + `decision.json`).
4. **Decide** deterministically, constrained to one autonomous, mechanically-verifiable class (a fossil-figure / dead-authority-field fix where `classifyDiff==autonomous`). **Churn dedup built in now** (winner vs open PRs + a committed already-proposed ledger) — a daily cycle re-opening the same finding is the predictable failure mode.
5. **Gauntlet** on the implemented diff: `preflight` FULL + `verify:breadth` + `classifyDiff`. Green → auto-OPEN a **draft** PR via `gh`; never merge.
6. **Heartbeat** via `lane-deliver`; confirm on remote with `git ls-remote`.

**Also in Slice 1:**
- The `brain-cycle` registry row (`awaiting-activation`, honest `awaitingReason`, **no invented authorization**) landed on `SignalGrid_Alpha` first, `check-scheduled-routines.mjs` shown green with quoted output.
- **Planted-defect self-tests (gate-and-proof-engineer pattern, both directions):** (a) plant a BLOCK finding → orchestrator refuses, opens nothing; (b) **plant a `ran:false` lens → orchestrator treats it as HARD NO.** Test (b) is non-negotiable — the absent=HARD-NO branch is the loop's one un-gated trust anchor, so it must itself be provably fail-closed. Prove the owner-gated arm too: point it at a `scripts/` change → STOP at `classifyDiff==owner-gated`. **The 2026-09-10 adversarial pass added the arms the anchor actually needs** (see DR-032 Hardening): a missing/unparsable/empty `_manifest.json` → HARD-NO (not a silent `expected=[]`), a manifest omitting a veto lens → HARD-NO, a record missing `ran` → HARD-NO, a duplicate `ran:false` lane not masked by a `ran:true` one, and a fileless route → escalate not auto-pick.

Because `brain-cycle.mjs` and `check-brain-freshness.mjs` are `scripts/**` = SAFETY_MACHINERY, Slice 1 lands by a **normal owner-reviewed PR**, correctly not self-mergeable.

### Slice 2 — full panel + full gauntlet + Mac routing (additive)
- The complete touched-surface router (all four signature lenses + generic panel + ECC/ponytail advisory).
- `preflight` + `verify:breadth` + `check-preflight-ci-parity` + `check-ci-preflight-sync` + the adversarial panel + publication/claim gates composed as the ordered pipeline.
- Mac-only surfaces routed to `sim-requests`, marked UNVERIFIED, reconciled on the next cloud fire from `artifacts/sim-results/`. Winners on those surfaces auto-OPEN as **draft**, held.
- The surface-fingerprint **cost cache** in the board (`git tree hash` of exactly the audited paths), with a self-test proving BOTH the hit and miss paths — recurring audits re-run only changed surfaces.

### Slice 3 — the account trigger + owner GREEN switch (owner-gated)
- After Dan authorizes: `create_trigger` (self-session, cloud), transcribe the `trig_*` id, flip the row off `awaiting-activation`.
- Wire `enable_pr_auto_merge` behind `classifyDiff==autonomous` AND GREEN AND the explicit owner opt-in switch (`docs/agent/brain-cycle-config.json`), default OFF.
- Promote `scan-agent-plane`'s DR-018 mirror-drift compare from report-only to a blocking STEP 0 header line.

---

## 10. Decision record draft — DR-0xx: The Standing Brain Cycle

**Decision.** Adopt a daily, cloud-fired **Standing Brain Cycle** (`brain-cycle`): a Centralized-Orchestrator-over-Blackboard hybrid that guarantees brain parity as its first fail-closed act, fans a bounded touched-surface lens panel over the real HEAD diff, lands their verdicts in a committed per-cycle blackboard, deterministically picks the smallest route that clears its panel, drives the winner through the composed mechanical + adversarial gauntlet, and **auto-OPENs (never auto-merges)** the winner as a PR. It reuses `classifyDiff`, `lane-deliver`, `check-scheduled-routines`, the 13 agents, `preflight`/`verify:breadth`, and mailbox PR #439 verbatim; the only new code is one orchestrator, one freshness gate, one config, one registry row, and self-tests.

**Alternatives considered.**
- *Collaborative Swarm / Decentralized (Design 2, Swarmboard's dominant framing).* Rejected as the dominant shape: no single fail-closed authority for the owner-gated merge boundary; a robot cannot merge changes to its own safety net. Its **one-file-per-lens board + derived expected-set manifest + consensus floor** are grafted in.
- *Orchestrator-first with candidate generation (Design 3).* Strong; its **provenance-before-run, quoted-evidence board, router reading `review-coverage.json`, and the absent=HARD-NO planted-defect self-test** are grafted. Candidate generation is deferred (highest cost, least specified) — Slice 1 audits HEAD only.
- *Two-lane fingerprint-cached cycle (Design 4).* Its **cost cache, three-way parity precondition, and Mac-only-as-draft reconciliation** are grafted; its LLM-verdict-enforced-only-by-JS weakness is answered by the mandatory absent=HARD-NO self-test.

**Consequences.** A standing, evidence-first mechanism that fixes small autonomous-tier defects daily and escalates everything else — without ever merging a change to its own safety net, ever assuming the Mac is awake, or ever letting a model decide a verdict. The cycle cannot bootstrap its own improvements autonomously (its machinery is SAFETY_MACHINERY); every change to it is an owner-reviewed PR, which deliberately paces the effort.

**Doctrine guardrails.**
- **Fail-closed (golden rule 2):** stale/DIVERGED brain refuses; any absent/rate-limited/UNVERIFIED lens is a HARD NO; unrecognised owner-gated shape escalates; no eligible candidate opens nothing. `review:invariants` stays green.
- **Publication boundary (DR-021):** `check-publication-boundary.mjs` + `check-launch-claims.mjs` gate what the PR may say; buyer-facing surfaces are OWNER_RESERVED → auto-OPEN only. Building ≠ claiming.
- **Dan decides:** auto-OPEN is the shipped ceiling; auto-MERGE sits behind an explicit owner GREEN switch; the irreversible boundary (outreach, signing, external publish, money, any HIPAA/SOC 2 sign-off) always queues for the owner; the routine cannot be declared active without a quoted owner authorization.
- **No behavior edits to `DecisionEngine.swift` / `AppWorkflows.swift` (golden rule 1):** audited read-only as byte-faithful ports; any finding there yields a route *around* them (the `SignalContext.swift` pattern) or an owner escalation — never an auto-PR touching them.

---

## 11. Risks + open questions for the owner

**Risks (with mitigations).**
- **The un-gated trust anchor.** "A reviewer that did not run = NO" lives only in orchestrator logic; there is deliberately no gate asserting it (a permanent-condition check gets scrolled past). A single slip there silently approves on nothing. *Mitigation:* the Slice-1 planted-defect self-test on the `ran:false` branch is non-negotiable; record `ran:bool` per lens.
- **Cost / churn.** A daily fan-out of ~10 opus/sonnet lenses is expensive (parallelism cuts latency, not spend), and low-value PRs train the owner to rubber-stamp. *Mitigation:* the touched-surface router (never a "full panel to be safe" fallback), a hard per-cycle agent cap, the fingerprint cost cache (Slice 2), and the consensus floor on what opens a PR.
- **Mac liveness.** `mac-lane-tick` is still `awaiting-activation` (launchd not installed; owner escalated 2026-09-06). Until `bash scripts/mac/install-launchd.sh` runs on the owner's Mac, Swift/evidence winners stay UNVERIFIED forever and cannot ship from cloud alone. *Mitigation:* mark them never-green and escalate staleness; cloud never blocks.
- **Cache correctness.** A fingerprint that never matches re-audits everything daily; one too loose reuses a stale clean verdict over changed code. *Mitigation:* hash the exact audited paths' git tree; self-test both hit and miss.
- **Self-deadlock on freshness.** Getting STEP 0's scope wrong (including `docs/`, or diffing local HEAD) makes the cycle constantly refuse or vacuously pass. *Mitigation:* scope `.claude/` + `.mcp.json` + `plugin.json`, diff `origin`, tolerate one-commit-ahead.

**Open questions for the owner (Dan decides).**
1. **Authorization.** Do you want `brain-cycle` to exist, and at what cadence (daily `35 8 * * *` proposed)? The row and trigger are FATAL-blocked on a real authorization message — quote it and I land the row.
2. **Mac tick.** Will you run `bash scripts/mac/install-launchd.sh` on your Mac? Without it, Swift/iOS/evidence audits never fire unattended.
3. **GREEN auto-merge.** Keep it OFF (auto-OPEN only, you merge)? I recommend OFF until per-PR gate falsification exists — the mutation sweep that would catch a weakened gate runs post-merge.
4. **Scope of what the cycle may auto-OPEN.** Start narrow (fossil-figure / dead-field fixes) and widen slice by slice, or open it to the full autonomous tier at Slice 2?