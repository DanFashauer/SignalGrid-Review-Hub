# Decision records — calls the team made under delegated authority

**Established 2026-08-19.** The founder's instruction was direct: *"why fight
me in that when I know you will make the right call."* This file is where the
team makes those calls instead of routing them back. Each record states the
question, the call, the evidence actually read, and — the part that makes
delegation safe — **exactly what would reverse it**. The founder overrides any
line here by saying so; nothing needs his approval first.

What is NOT here, by design, is anything on the short never-list in
`docs/VIRTUAL_TEAM.md`: outward-facing sends, legal or compliance sign-off,
irreversible operations, anything needing credentials the team does not hold,
and genuine matters of taste or strategy.

---

## DR-001 — The five connector families: **DEFER, all five**

**Question.** The owner board asked for build / defer / drop on facilities-CMMS
(intake row 86), OT/MQTT warehouse telemetry (row 85), managed-config receipt
and MAM/App-Protection state (both row 33), and Apple software-update currency
/ SOFA (row 81).

**Call: all five DEFER. The breadth freeze stands, and no family is lifted.**

**Rationale — the founder already answered this, and the board was asking him
twice.** The sequencing boundary is his own, recorded verbatim in intake row
55: *"Do not make this the first build wedge — the launch path remains Entra +
Intune → one shared-device workflow → one customer-approved sandbox → one live
decision loop."* Every one of the five is expansion, not wedge. Asking him to
classify them individually was asking him to re-decide something he had
already decided as a policy.

Three mechanical facts make DEFER the only currently-permitted answer anyway:

- A new family is a 52nd connector family; the moment its directory exists it
  trips the silent-omission arm of `scripts/check-launch-profile.mjs`.
- The launch profile's criterion — *one* read-only device-management evidence
  source — is already spent on `graph`, so `deferred` is the only status the
  profile permits for a second one (row 81's own analysis).
- `AGENTS.md` bans live API calls outright, so even SOFA's public,
  credential-free feed could only ever ship fixture-default behind an env gate
  (the graph-transport precedent).

**Evidence.** `docs/INTAKE_LEDGER.md` rows 33, 55, 81, 85, 86;
`scripts/check-launch-profile.mjs`; `scripts/launch-profile.mjs`; `AGENTS.md`.

**Reversal.** This flips when the launch wedge actually ships — one live
decision loop with a real customer — not on a date and not on appetite. When
it does, **SOFA (row 81) goes first**: its own audit rates it the strongest of
the recent intakes, it is read-only Apache-2.0 public data with no tenant
credentials and no actuator, and it closes a genuinely non-overlapping gap
(OS currency against Apple's published cadence). Lifting the freeze for it
requires a `LAUNCH_PROFILE_VERSION` bump, which is the mechanical record that
the decision was taken deliberately.

**Confidence: high.** The founder can override any single family by naming it.

---

## DR-002 — `tenant:admin`: **narrow the scope, then enforce it or delete it**

**Question.** What should the `tenant:admin` permission cover?

**Call.** `tenant:admin` covers exactly two things — **tenant lifecycle**
(create, suspend, delete a tenant) and **credential material** (mint, revoke,
and read unmasked API-key material). Nothing else. It is deliberately NOT a
super-role: `admin` already holds policy write, connector sync, audit read and
remediation approval, and widening `tenant:admin` to mean "admin, but more"
would make it a role rather than a scope.

**And the finding that made this urgent:** `tenant:admin` is currently
declared and granted but **required by nothing**. It appears in the permission
union (`lib/signalgrid-core/src/types.ts:26`) and in the `owner` role's grant
list (`lib/signalgrid-core/src/auth.ts:23`), and no route, guard or check in
`lib/` or `artifacts/api-server/src/` ever demands it. A permission that
protects nothing is worse than no permission at all: it reads, to anyone
auditing the role table, as a control that exists.

So the call has a second half: **a declared permission that no surface
requires is a defect, and should be caught mechanically** — the same shape as
every other guard in this repo. Either the scope gets enforced on the surfaces
above when they exist, or it comes out of the union.

**Evidence.** `lib/signalgrid-core/src/auth.ts` (role table),
`lib/signalgrid-core/src/types.ts` (the union), `lib/signalgrid-core/src/engine.ts`
(the `demoApiKeys()` comment that already names `tenant:admin` as the intended
guard for masked key references), and a repository-wide search finding zero
enforcement sites.

**Reversal.** If a real deployment needs a tenant-scoped administrator who is
*not* the owner, split the scope rather than widening it —
`tenant:lifecycle` and `credential:admin` — so the audit trail still says
which power was exercised.

**Confidence: high** on the scope and on the unenforced-permission finding.

---

## DR-003 — Audit-ledger retention: **90 days hot, exportable, operator-configurable — a default, not a promise**

**Question.** What retention should the tamper-evident audit ledger have? It is
customer-visible: the pricing page currently reads *"retention: owner decision
pending"*.

**Call.** The shipped **default** is 90 days in the queryable store, with the
full hash-chain exportable at any time before expiry (`db:export-ledger`
already exists), and the window operator-configurable. The pricing page stops
saying "owner decision pending" and states the default plus the fact that it
is configurable.

**Rationale.** 90 days is the common floor for security-incident review and it
is short enough not to imply an archival commitment this product does not yet
make. The important property is not the number — it is that **export is
always available**, so a customer's real retention requirement is satisfied by
their archive, not by our storage. That framing keeps a technical default from
quietly becoming a contractual one.

**The line this does not cross.** A *contractual* retention or availability
commitment in a signed agreement is not the team's to make (never-list item 2).
This is the engineering default and is labelled as such.

**Reversal.** Any customer or assessor requirement that names a specific window
overrides this immediately; the value is configuration, not architecture.

**Confidence: medium-high** on the default; the number is a judgement call and
the founder should override it freely if he has a market reason.

---

## DR-004 — Execution order ratified; the category label is "Shared-Device Trust Gateway"

**Date:** August 20, 2026. **Decided by:** the owner, in his own words, in the
message that verified PR #215 and opened PR #216.

**Decision 1 — the execution order.** The company works the build plan in this
sequence, quoted in substance from the owner: (1) protect the trust engine —
extend adversarial grant-safety testing across the uncovered connector families;
(2) finish the production data boundary — the Postgres runtime/admin role split,
with backup/restore preserving it; (3) close the actual product journey — the iOS
badge/session API mismatch, then one complete shared-device flow end to end;
(4) make the public product tell only the launch truth, with a gate so marketing
cannot drift again; (5) use the low-cost lab (Fleet Community, Headwind, Keycloak,
Wazuh, FreeRADIUS) as the engineering engine, with Entra/Intune the enterprise
target but no longer a blocker; (6) move from engineering proof to buyer proof —
and "do not activate customer-success machinery before a real customer exists."

**Decision 2 — the category label.** The owner's step 4 directs the site be
locked to "the ratified Shared-Device Trust Gateway scope." That settles the
five-labels-in-circulation defect the sweep found: **Shared-Device Trust
Gateway** — already `PRODUCT_NAME` in `scripts/launch-profile.mjs` — is the
category label. The other four labels get reconciled out, not kept as synonyms.

**What is ratified at the item level, precisely.** The owner's step 4 names its
own scope: *"Remove present-tense claims for deferred badge, zone, and shift
capabilities."* That sentence item-ratifies the six signal-kind classifications
the site rewrite depends on — the three launch kinds (`device_posture`,
`device_management_health`, `local_authority`) as the shipping wedge, and
`pacs_access` (badge), `location` (zone), and `shift_context` (shift) as
deferred, never present-tense. The remaining launch-profile classifications —
connector families, app surfaces, API paths — stay marked "proposal" until the
owner reviews them or ratifies them wholesale. Reading blanket approval into a
sentence about the site would be the unearned affirmative again.

**Consequence for the roster:** `positioning-messaging` is unblocked for the
site rewrite and POSITIONING.md, **bounded by the ratified subset**: public
copy may claim only the three ratified launch kinds and may name the three
ratified deferred kinds only as roadmap. Any claim resting on a classification
outside those six waits for item-level ratification.
`design-partner-outreach` stays blocked behind positioning and ICP research per
the owner's own step 6.

**Reversal.** The owner reverses any part of this by saying so, as with every
record here. Short of that: the execution order is superseded the moment a
later owner instruction sequences the work differently, and the earlier order
does not linger as doctrine; the category label is reversed only by the owner
naming a different one, at which point every surface carrying "Shared-Device
Trust Gateway" is reconciled in the same shift rather than left to drift; and
the six item-level ratifications above are reversed individually if the owner
re-classifies a named signal kind, which re-blocks any public copy resting on
it until the copy is reconciled.

---

## Still open, and honestly so

Two of the four "standing decisions" are **not** decided here, because the
searches run for this pass did not locate their recorded reasoning, and
deciding them from their board titles alone would be exactly the unearned
affirmative this repository exists to refuse:

- **graph-default flip** — no record found under that name; the graph
  connector's fixture-vs-live default needs its actual reasoning located first.
- **shadow-mode step-up** — no record found; "shadow" appears in `lib/` only
  in unrelated senses (shadow agents, shadow copies).

These stay open as **team** work, not owner work: the next shift finds the
records and decides them. They are listed here rather than silently dropped.
