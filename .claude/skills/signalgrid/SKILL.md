---
name: signalgrid
description: Working rules for the SignalGrid repositories — a deterministic, fail-closed Assist gate for frontline devices with a public-safe Review Hub. Use whenever reading, changing, reviewing, documenting, or making claims about SignalGrid code, proofs, gates, connectors, iOS/Android/firmware surfaces, or its docs. Covers the decision doctrine, the validation ladder, how to add a proof or connector without leaving it ungated, the publication boundary, and the specific defect classes this repo has already been bitten by.
---

# SignalGrid

A pnpm/TypeScript monorepo for a signal- and location-driven **Assist gate**.
Signals in → normalize → evaluate → `allow` / `step_up` / `restrict` / `deny` →
routed actions → audit evidence explaining why. Deterministic and fixture-backed.
Native surfaces under `native/` (iOS, Android, desktop) and `firmware/`.

This repo has unusually strong engineering discipline already. **Your job is to
work inside it, not around it.** Most of what follows was written after a real
defect. Treat each rule as a scar.

---

## The doctrine — three words that decide every judgement call

**Fail-closed. Deterministic. Truthful.**

- **Fail-closed** — an unknown, missing, malformed, or unreachable signal
  *raises* assurance. It never lowers it. Ambiguous high-risk input must never
  produce an allow. Every `switch` in a decision/gating/planner lib needs a
  `default:` arm.
- **Deterministic** — no `Date.now()`, no `Math.random()`, no I/O in decision
  paths. Same inputs, same verdict, forever. This is the product's entire claim.
- **Truthful** — a failing gate is reported as failing. Docs describe what the
  tree does, not what it should do. Never claim production-readiness,
  compliance certification, partnership, or autonomous remediation.

`pnpm run review:invariants` enforces the first two mechanically. Nothing
enforces the third except you — see *Prose is unguarded* below.

---

## Orient before you touch anything

```bash
cat CLAUDE.md                  # golden rules; they override default behaviour
cat AGENTS.md                  # public-safety scope for the Review Hub
cat docs/LANE_COORDINATION.md  # parallel Claude sessions share this repo
node scripts/check-known-false-claims.mjs --list   # what has already been claimed and disproven
```

Then measure rather than assume: `git ls-files | grep …`, not "the doc says."

---

## Rules that are not negotiable

1. **Never change the byte-faithful Swift ports for behaviour** —
   `native/ios/EnterpriseShell/Services/DecisionEngine.swift` and
   `AppWorkflows.swift` mirror the TS engine. Parity *is* the feature. New logic
   goes around them (see `SignalContext.swift` for the pattern).
2. **Embedded UX law.** SignalGrid is invisible to the worker. They use their own
   host app; the gate returns an outcome. Domain safety — patient lookup,
   clinical guidance, anything vertical — belongs in the HOST app, never here.
3. **Platform honesty.** An app cannot grant device access, restrict other apps,
   make itself non-removable, or self-kiosk. Those are MDM/OS capabilities
   requiring a supervised device (Apple Business Manager + APNs). A simulator
   can never be MDM-enrolled, so never claim on-device enforcement from one.
4. **Public-safe boundary.** No secrets, credentials, tenant IDs, customer data,
   PHI, PII. No live vendor or Graph calls. No third-party host (fonts, CDN,
   analytics) in a published web artifact — that leaks a visitor's IP.
5. **Read-only and fixture-backed first.** New connectors start read-only unless
   the task explicitly says otherwise and supplies a safe private context.
6. **Approval gates are explicit.** A default path must never bypass one.
7. **Don't merge your own PR.** Merge decisions belong to the owner. Ask before
   destructive git, before sending data anywhere external, and before pushing.

---

## The validation ladder

Climb from cheapest to most complete. Stop at the first failure and fix it.

```bash
pnpm run typecheck              # seconds
pnpm run review:invariants      # the automated second reviewer
pnpm run preflight --quick      # fast loop, skips heavy builds
pnpm run preflight              # the service-free CI gate suite
./validate-sim-macos.sh         # full local harness
```

**Read the summary correctly.** The harness prints `== SUMMARY: N passed, M
failed, S skipped ==`. **Compare M against 0 AND read S** — a skip is not a pass,
and the skipped gates are named above the line. Never compare N against a total
quoted in any document — the suite grows, and a pinned total silently converts a
regression into a pass.

**Know what preflight does *not* cover.** Do not retype the number here: `node
scripts/check-preflight-ci-parity.mjs` prints how many CI jobs preflight mirrors
and how many it cannot (external services, macOS runners, scheduled lanes). This
paragraph used to name "three of six" and a list of three jobs; the derived answer
was 23 uncovered of 31, and the list named a job that is not even in the main
workflow. A green preflight does **not** mean CI will be green.

**Touched api-server?** `pnpm --filter @workspace/api-server run test:api` must
be N/N green. Adding a route near others: confirm you didn't drop the neighbours.

**Changed any package's deps?** `pnpm install --lockfile-only` and commit
`pnpm-lock.yaml`. A pre-push hook enforces this. If you do the macOS
platform-binary dance, restore manifests **first**, regenerate the lockfile
**after** — doing it the other way re-diverges the lockfile post-fix.

---

## Adding things without leaving them ungated

### A proof
1. Write it in `scripts/src/<name>-proof.ts`.
2. Register `proof:<name>` in `package.json`.
3. Register it in **both** `scripts/preflight.mjs` and
   `.github/workflows/review-hub-ci.yml` — `guard:ci-sync` fails otherwise. *A
   gate that runs only locally is not a gate.*
4. If it enumerates an allow path (imports `enumerateGrantSafety`), register the
   connector with the mutation guard.
5. If it prints a `figures=` line, register it with the figure guard — docs may
   quote those numbers.
6. Give it a `--self-test` that proves the gate can fail.

### A connector
Read-only, fixture-backed, one signal domain. Unknown maps to unknown — never to
a negative posture. Add the proof, then run `node scripts/check-connector-discipline.mjs`
(it has no `pnpm` alias; preflight invokes it directly).

### A document
It must be reachable from an index (`check:doc-orphans`) and every path it cites
must exist (`check:cited-paths`). Do not quote a proof total that will age.

### A claim
Before writing that anything is missing: `pnpm run check:absence <topic>`. One
empty grep is evidence of one grep, not of absence.

---

## The defect classes this repo has already paid for

Recognise these shapes; they recur.

**Fossil figures.** A number written into prose ages the moment the code moves.
Docs said "166 assertions" when the proof emitted 213. Derive figures from a run,
or guard them with `check:proof-counts`.

**Stale coverage lists.** A `SignalKind` list restated by hand drifted five kinds
behind, leaving five dimensions' routing ungated. *A guard whose coverage list is
stale is worse than no guard, because it reports success over the part it has
stopped looking at.* Derive coverage from the code.

**Prose is unguarded.** No gate reads English. A paragraph in `SELF_REVIEW.md`
claimed preflight mirrored all CI jobs — false in both halves — and survived
because nothing checks sentences. When you write a claim, verify it by running
something.

**Documents overtaken same-day.** `DELIVERY_GAP_ANALYSIS.md` said "Android does
not exist"; a native Android app landed hours later. Never cite a document as the
state of the tree. Measure the tree.

**Partial runs read as failures.** A serial harness killed mid-run was reported
as a hang. `proof:service-lifecycle` passes 82/82 in isolation. Never report
"it fails" or "it hangs" without a completed, isolated run.

**Neighbour regressions.** Adding a route beside others dropped the others. When
editing a list, diff the whole list.

**Lane collisions.** Two Claude sessions independently built nac discipline and
webhooks gating; reconciling cost eight files and an owner decision. Before
touching a shared surface — `check-connector-discipline.mjs` KNOWN_GAPS,
`mutation-guard.mjs` TARGETS, `live-sync-manifest.json`, `preflight.mjs`,
`review-hub-ci.yml`, `lib/integrations/package.json` — check recent commits and
announce in the commit message, not only in chat.

---

## Toolchain wrinkles

- `pnpm-workspace.yaml` overrides strip every native binary except
  linux-x64-gnu. `pnpm run build` (vite) therefore only runs on linux-x64 / CI.
  **Do not try to "fix" a web-build failure on macOS** — it is expected there.
- iOS: build from the repo root of the checked-out revision; paths are
  repo-relative. New sources go in a test target's explicit `sources` list in
  `project.yml`, then `xcodegen generate`. App targets auto-glob.
- Some proofs need services: `proof:enrollment-race` refuses without `REDIS_URL`;
  the `-pg` proofs need Postgres. Refusing is correct behaviour — and it is a SKIP, not a pass: it lands in the summary's third field.

---

## Working style that fits this repo

- **One task, one branch.** Show the plan and the file list before coding.
- **Never weaken or delete a proof to make something pass.** If a proof is
  wrong, say why and fix the proof deliberately.
- **Don't refactor what you weren't asked to touch.** Drive-by changes are the
  main way this repo breaks.
- **Record what you did NOT verify.** Coverage gaps are findings. An honest
  "not checked: iOS build, no Xcode here" is worth more than silence.
- **Prefer deleting to adding.** With ~1,800 files, 144 `proof:*` scripts (2026-09-06; `node scripts/check-status-figures.mjs` prints the live count) and four native
  surfaces maintained by one non-engineer, added surface area is a cost. The
  question is rarely "can this be built" — it is "should this exist."

---

## Definition of done

- [ ] `pnpm run typecheck` clean
- [ ] `pnpm run review:invariants` green
- [ ] `pnpm run preflight` green (state that Postgres/Docker/gitleaks jobs are CI-only)
- [ ] New gates registered in preflight **and** CI
- [ ] Lockfile regenerated and committed if deps changed
- [ ] Docs cite only paths that exist; no figure quoted that will age
- [ ] PR body: summary, what changed, validation performed, public-safety note,
      remaining risks, and what you could not verify
- [ ] Owner merges, not you
