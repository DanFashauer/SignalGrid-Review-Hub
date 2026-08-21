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

**Status (August 21, 2026).** The decision stands; its tense was wrong. 90
days is the **intended** default — no retention mechanism is implemented in
any durable store (per-store evidence: `docs/DATA_RETENTION_AND_PERSONAL_DATA.md`;
the runtime role is denied DELETE, so honouring any window requires an
admin-credential job that has not been designed). Until the mechanism exists,
no surface states a retention duration as shipped; the pricing page carries
the export claim only. `scripts/check-retention-claims.mjs` enforces this.

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

**Source, quoted verbatim** — the operative portion of that message, preserved
here because this file's contract requires the evidence to be recoverable, and
a summary cannot be audited against itself. Public-safe; the message contains
no credentials or personal data beyond what the owner published in the PRs.

> "The company should now execute the existing sweep in this order:
> 1. Protect the trust engine first. […] extend the same adversarial
>    grant-safety testing across the remaining uncovered connector families […]
> 2. Finish the production data boundary. Separate the PostgreSQL runtime role
>    from the database owner/admin role and make backup/restore preserve those
>    permissions. […]
> 3. Close the actual product journey. Fix the native iOS badge/session API
>    mismatch, then prove one complete shared-device flow […]
> 4. Make the public product tell only the launch truth. Remove present-tense
>    claims for deferred badge, zone, and shift capabilities; lock the site to
>    the ratified Shared-Device Trust Gateway scope; and add a gate so
>    marketing cannot drift beyond implemented capability again.
> 5. Use the low-cost lab as the engineering engine. […] Microsoft Entra and
>    Intune remain the enterprise production target, but they no longer block
>    product development.
> 6. Move the company from engineering proof to buyer proof. […] Do not
>    activate customer-success machinery before a real customer exists."

Elisions ([…]) drop only examples and restatements; every clause this record
relies on is quoted in full above.

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

**What the order means — and does not.** The six steps rank priority and gate
what goes OUTWARD: nothing publishes, ships, or reaches a person outside the
company from a later step while an earlier step's outward preconditions are
open. They do not serialize internal work — the owner's own step 4 directs the
site rewrite in the same message that puts trust-engine work first, and step 6
gates *activation* ("do not activate customer-success machinery before a real
customer exists"), not preparation. Reading the list as a strict pipeline would
have the instruction forbidding work it explicitly assigns. Internal drafting
on any step may proceed in parallel; the sequence binds what leaves.

**What is ratified at the item level, precisely.** The owner's step 4 names its
own scope: *"Remove present-tense claims for deferred badge, zone, and shift
capabilities."* That sentence item-ratifies the six signal-kind classifications
the site rewrite depends on — the three launch kinds (`device_posture`,
`device_management_health`, `local_authority`) as the shipping wedge, and
`pacs_access` (badge), `location` (zone), and `shift_context` (shift) as
deferred, never present-tense. The owner's word "badge" ratifies the deferral
of every badge-shaped surface, not one enum: `pacs_access` (authorization at a
controlled door) AND the separate badge-binding evidence lane the review
console presents (`badgeBinding` in the operator evidence). When the
launch-claims gate derives its allowed terms from this subset, any badge-shaped
public claim resolves to this deferral — a claim escaping because it rode a
differently-named field would defeat the ratification it rode around. The remaining launch-profile classifications —
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

**Where the ratified subset is encoded.** For now: here, and only here.
`scripts/launch-profile.mjs` still describes itself as an unratified proposal
and its schema has no per-item ratification field, so tooling cannot yet
distinguish the six ratified items from the other 168. That encoding travels
with the launch-claims gate (build-plan item 6), which needs exactly that field
to check public copy mechanically — until it lands, this record is the source
of truth for the subset and the profile's blanket "proposal" language is read
as "except where DR-004 says otherwise."

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

## DR-005 — The five owner decisions of August 20, 2026

**Date:** August 20, 2026. **Decided by:** the owner, in a message that stated
each decision explicitly, with the operative wording quoted per decision below.
Written with the reversal conditions and verbatim sourcing DR-004 had to learn
in review, from the start.

### 1. Launch-profile v4 — ratified in full

> "v4 is no longer a proposal. Treat every current classification in
> `scripts/launch-profile.mjs` as ratified unless a future decision record
> explicitly changes it. This also ratifies the source-agnostic build order:
> open-source lab first; Microsoft enterprise validation next."

This **supersedes DR-004's carve-out** that held the item-level classifications
as proposals — by exactly the mechanism DR-004's own reversal clause named: a
later owner instruction. All 174 classifications are ratified: three launch
connector families (`graph`, `device-management-health`, `local-authority`),
three launch signal kinds, three launch app surfaces (API server, operator
console, `ios:EnterpriseShell`); everything else deferred, demo-only, or
internal as written. The positioning draft's groundings that DR-004 bounded
out (graph, EnterpriseShell, the `/v1` routes, the console) are now ratified
ground. The owner's closing constraint is part of the decision: **"do not
widen the product again now"** — the backlog executes against a fixed edge.

### 2. The first article — approved after one factual correction; company blog first

> "keep the article, correct that section, independently recheck the
> experiment, then publish it. Canonical venue should be a technical
> SignalGrid company blog on `signalgrid.app`."

The blocker the owner found is real and this record confirms it: the draft
prescribed "revoking DELETE" while the same company audit established there is
no GRANT to revoke — the application role *owns* the ledger table, so the real
fix is the owner/admin vs restricted-runtime role split (build-plan item 3).
The corrected canonical article is staged at `docs/HASH_CHAIN_TAIL_ARTICLE.md`.
The independent recheck exists as a standing fact: `proof:audit-ledger-pg`
re-runs the experiment against a real Postgres in the "Durable persistence" CI
job on every push — including, since review of this record, the operator CLI
itself: `db:verify-ledger` is spawned as a child process and BOTH its exit codes and
its verdict lines are asserted — "Chain intact" with the right count, "TOO FEW
RECORDS" naming both numbers, "CHAIN BROKEN at record index" localizing the
break — across the same three states the article's table publishes (clean,
short-of-floor, tampered), at smaller scale (8 records to the article's 40).
The claim is scoped to that: same code paths and verdict sentences, not a
literal 40-row replay. The
article's runtime-role grant is per-table: on the ledger, `SELECT` and
`INSERT` only — `UPDATE` would let an attacker rewrite a record and its hash
and the verifier would accept the result. Publication order:
signalgrid.app blog (to be built) first, then a shorter founder version on the
owner's LinkedIn linking back; no third-party outlet for the first piece.
**Publishing anything remains the owner's send.**

### 3. Deny color — re-toned; WCAG AA is now the floor

> "adopt WCAG AA as the minimum contrast standard for SignalGrid
> decision-state colors. Use: Dark deny: `#C67070`, Light deny: `#8A3F3F`.
> Do not waive the issue and do not artificially restrict where `deny` may
> be used."

These are the exact values the accessibility pass had tested in `dd55bca` and
reverted solely for lacking brand ratification — that ratification is this
record. Independently re-measured before applying: dark `#C67070` scores
5.05:1 on background and 4.55:1 on card; light `#8A3F3F` scores 6.50:1 and
7.33:1 — all four above the 4.5:1 floor, against the old dark value's 3.18:1
on card. Applied to web (`index.css`, a committed single-theme dark surface,
takes the dark value — as `0 43% 60.8%`, because `61%` rounds to `#C67171`
and quietly forks the platforms) and iOS (`DesignSystem.swift`, dynamic
light/dark) in the same commit, because a fork between them was the stated
reason the first attempt was reverted. Review caught the pairing the original
measurements missed: the re-tone that fixed deny-as-TEXT flipped the failure
onto deny-as-FILL — white on the new dark fill measures 3.53:1. Filled deny
controls now carry a paired foreground (`SG.onDeny`, and the web's
`--destructive-foreground`): charcoal on the dark fill (5.05:1), white kept on
the light fill (7.33:1). Color remains redundant with text/icon labels, never the
sole signal. The canonical decision-state palette now lives in THIS repository
(`docs/BRAND_CONTRAST_FINDING.md` records the resolution); DEV is retired and
does not receive the change.

### 4. Billing numbers — the one open item, owner-only by design

Four values, never estimated, per the cost model's own rule: monthly Claude
spend; Apple Developer status/fee; GitHub plan, price, and sibling-repo
visibility; total domain spend. The model carries TBDs until the owner sends
them.

### 5. Fleet Premium — out of baseline COGS

> "do not renew Fleet Premium for SignalGrid's baseline build. […] If it
> isn't completed by September 16, mark that capability
> `deferred/unverified-premium`; do not pay merely to preserve a test."

Baseline economics are Fleet Community/self-hosted: $0 license plus actual
hosting. The Premium-only `getPolicies()` team-scoped branch gets proven on
the remaining trial only if it costs no launch focus; otherwise it is marked
`deferred/unverified-premium` on September 16 and priced as a
customer-specific dependency if a customer ever requires it.

### Reversal

The owner reverses any line here by saying so. Specifically: a future decision
record can re-open any v4 classification (that is the only path — silence
does not); the article's venue or the palette values change only by owner
instruction, and a palette change re-runs the contrast measurements before it
applies; the Fleet Premium exclusion reverses if a paying customer requires a
Premium capability, at which point it enters that deployment's pricing, not
baseline COGS. The "do not widen" constraint stands until the owner lifts it.

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

## DR-006 — Allow re-tone and the onAllow pair (2026-08-21)

**Decision.** The owner ratified the recommended allow re-tone: dark
`#5E8F73` → `#639779` (hsl 145 21% 49% — same hue, same saturation, two
lightness steps), light `#3F6B52` unchanged. With it, the paired foreground
`onAllow` (light `FFFFFF`, dark `15181B`), the same shape as DR-005's
`onDeny`. Owner's words: "I allow color pick" — ratifying the recommended
option from the proposal of the same day.

**Why.** Dark allow sat at 4.32:1 on card — under the DR-005-ratified WCAG
AA floor for decision-state colors — and white toast text on the dark allow
fill sat at 3.72:1, the exact defect class onDeny closed for deny.

**Measured before applying, from the committed files** (the ratios are
computed from the token values as committed, not from intentions): dark
5.29:1 on background / 4.76:1 on card; light 5.41:1 / 6.11:1; onAllow dark
5.29:1 on the fill, light 6.11:1. Both web palettes' `--decision-allow`
round-trips to the identical hex as the iOS dark token — no cross-surface
fork, which is why the first deny attempt was reverted.

**Scope.** Landed together, per the ratified landing rule: canonical tokens
first (DesignSystem.swift + both web `index.css` palettes), the allow-filled
toast switched to `onAllow`, and signalgrid-app's rendered
`.text-status-allow`/`.bg-status-allow` classes moved off raw Tailwind
green onto the canonical token. The full palette-parity gate over every
rendered tree (the design lens's queued deliverable) is follow-up work, not
part of this record.

**Reversal.** A future decision record naming new hexes, measured the same
way, on every surface in the same commit.

### DR-006 addendum (2026-08-21, same day): the on-tint variant

Cross-lane review caught a composite the original nine measurements did not
cover: the operator console's tinted allow badge lightens its ground (10%
allow over card composites to ~#242E2E), putting the ratified #639779 text at
4.14:1 — under the floor. Resolution, measured from the committed files: tint
reduced to 8%, and badge text moved to a new canonical variant
`--decision-allow-on-tint` (hsl 145 21% 55%, #74A488) — 5.09:1 on the tinted
card, 5.55:1 on the tinted background, and ≥5.5:1 on both plain surfaces. The
lesson folds into the pending decision-palette gate: composited grounds are
render surfaces too, and must be in its measurement set.
