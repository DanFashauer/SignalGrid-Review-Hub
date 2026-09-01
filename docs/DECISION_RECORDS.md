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
no surface states a retention duration as shipped, and export is stated
honestly as the operator-side CLI (`db:export-ledger`, no tenant filter) —
not a customer self-serve route. `scripts/check-retention-claims.mjs`
enforces the duration half.

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

## DR-007 — The Assist wire: **one served envelope, and the planned one is a declared gap, not a phantom contract**

**Question.** Three native Assist clients decode three different answers from
the server. The Kotlin and Rust SDKs — the two bound by the 42 shared
conformance vectors and `scripts/check-assist-conformance.mjs` — decode an
envelope `{assist, reasons, decisionId}` from `POST /v1/authorize`, a route
this repository does not implement (verified: the OpenAPI spec registers no
such path; the only `/v1/authorize` mentions in the tree are URL-normalization
comments). The one client that talks to the real server — iOS
`RemoteDecisionService` — decodes `{decision:{outcome}, plan:{outcome}}` from
`POST /v1/app-workflows/evaluate`, and sits OUTSIDE the vector suite under a
disclaimer whose stated reason ("EnterpriseShell ports the decision engine
rather than consuming /v1") stopped being true when that service landed. Which
envelope is the Assist wire?

**Call.** The **served** Assist surface is what the launch profile already
ratifies: `POST /v1/decisions/evaluate` returning `EvaluateResult` — outcome,
reasonCodes (the DR-catalogued vocabulary, `docs/REASON_CODES.md`), matched
rules, evidence reference. That is the envelope a host app integrates TODAY.
The `{assist, reasons, decisionId}` / `/v1/authorize` envelope the SDKs bind
is a **planned wire, recorded as a declared gap** (`assist-wire-unserved` in
`scripts/launch-profile.mjs` GAPS) — the vectors stay, the SDK suites stay
(they still catch real parse defects, which is why the Kotlin lane matters),
but no document may present that wire as served until the gap closes. The gap
closes mechanically when the spec registers `/v1/authorize`; building that
route now would widen the frozen launch surface and is deliberately not done.

**Enforcement.** `scripts/check-assist-wire-served.mjs` (preflight + CI)
reads the bound wire as DATA — the `route` field the shared vectors file now
carries — and fails when that route is neither served by the spec nor claimed
BY NAME in the declared-gap entry: deleting the gap entry, retargeting the
vectors to a second unserved route, and SDK documentation drifting from the
vectors' route all fail. (The first version of this paragraph claimed the
retarget case before the vectors carried a route at all — the gate then read
two SDK doc comments through two different regexes; the assurance review
executed the retarget and it passed. Corrected the same day: the route is
data, the gap must name it, and the gate prints the route it actually
checked.)

**The second unserved wire, stated.** The client this record calls "the one
that talks to the real server" — iOS `RemoteDecisionService`, and
SignalGridMobile beside it — posts to `/v1/app-workflows/evaluate`, which the
launch profile classifies **deferred** and the gateway profile fences: under
`shared-device-gateway` it 404s (executed: 404 on the gateway boot, 401 —
served — under review-demo). So the iOS wire is served only on the
review-demo surface today. It needs no second gap entry because the
deferral IS its declaration — `/v1/app-workflows/evaluate` sits in the
launch profile's deferred route list, which is the register for exactly
this; what the deferral does NOT license is calling that envelope "served"
for a commercial deployment, and no surface may. The conformance gate's iOS disclaimer is corrected in the same
change: EnterpriseShell consumes `/v1` through `RemoteDecisionService` (its
local `DecisionEngine` remains the offline fallback), and bringing that
envelope under shared vectors is follow-on work, not a reason to misstate
the present.

**Reversal path.** If the owner later ratifies serving `/v1/authorize`, the
gap's `closedWhen` clears on the spec change itself; this record then reads
as the period when the wire was declared ahead of the server, which is what
happened.

---

## DR-008 — Three-plane architecture: Bruno contract plane, MCP agent plane, deterministic trust plane (2026-08-21)

**Question.** The repository now carries three surfaces that all touch the
API from outside the core: a committed Bruno workspace
(`artifacts/api-collection/`), two MCP servers (the in-repo
`artifacts/mcp-server/` fabric server and the public sibling `signalgrid-mcp`
posture source), and the deterministic decision core they both orbit. Absent
a ratified relationship, each surface drifts toward doing the others' jobs —
a Bruno request that "checks" behavior becomes a shadow test suite, an MCP
tool that acts on results becomes a shadow control plane, and an agent
reading evidence becomes, one convenience at a time, a thing that decides.
What is the standing relationship?

**Decision.** Three planes, each with exactly one job, owner-directed:
**Plane 1, the API contract** — Bruno, two-directionally gated by
`scripts/check-api-collection.mjs`, proves what the API serves and what it
refuses. **Plane 2, agent interoperability** — MCP gives agents controlled
access: the in-repo server exposes the fabric as read-only tools over stdio,
the sibling `signalgrid-mcp` reads macOS posture as a signal source; neither
decides anything. **Plane 3, the trust authority** — the deterministic core
alone turns evidence into a verdict. The two governing principles, stated as
doctrine: **"Bruno proves the API. MCP gives agents controlled access to the
API. SignalGrid determines what the evidence means."** and **"MCP is an
orchestration interface, not a new trust authority."**

**What this forbids.** Three moves, each of which would have been easy and
each of which is now a doctrine violation: (1) **MCP mutation tools without
approval gates** — no tool that changes durable state lands without an
explicit human-approval step in the loop and its own decision record; today
the server has none, and `scripts/check-mcp-surface.mjs` makes a new tool
visible the moment it registers. (2) **Agents deciding trust** — no agent
output, tool result, or model judgment may bypass the core or be returned as
a verdict the core did not compute. (3) **Collapsing planes** — Bruno does
not evaluate, MCP does not certify the contract, the core grows no
agent-facing bypass; a change making one plane do another's job is wrong even
when it works.

**Evidence.** Read from the committed files, not asserted:
`artifacts/api-collection/README.md` and `scripts/check-api-collection.mjs`
(both coverage directions, self-test proving both can fail);
`artifacts/mcp-server/src/index.ts` (stdio transport, demo core, the
registered tool set — reads and in-memory evaluations only);
`scripts/mac/mcp-up.sh` (the launcher, stdout reserved for the transport);
`docs/ESTATE_SYNC_REPORT.md` §2.1 (the sibling's 22-tool read-only posture
surface, verified from a checkout at `369e08e`);
`docs/OPEN_SOURCE_LAB_REGISTRY.md` (the evidence boundary the planes overlay).
The deferred items — an MCP execute-bridge for Bruno, HTTP transport, OAuth
scopes — are recorded as design intent in `docs/MCP_ARCHITECTURE.md` and
`docs/MCP_SECURITY_MODEL.md`, in the future tense they are entitled to and no
other.

**Reversal.** A future decision record, owner-ratified, that either (a)
grants a named MCP tool mutation rights together with its approval-gate
design, or (b) merges two planes with the drift risks above answered
mechanically — a gate, not a promise — for each of the three forbidden moves.
Absent that record, the planes stay separate and the prohibitions stand.

**Status: ratified by owner directive, 2026-08-21. Confidence: high.**

---

## DR-009 — Signing-key custody: keyless Sigstore OIDC via the CI identity (2026-08-21)

**Question.** The release-evidence lane (backlog row 32, `docs/RELEASE_EVIDENCE.md`)
reaches the signature stage: before the first cosign signature exists, who —
or what — holds the key? Two custody models were on file: (a) keyless
Sigstore OIDC bound to the repository's CI identity, trust rooted in a public
transparency log; (b) an owner-custodied key pair.

**Decision.** Keyless — option (a), the recommendation as filed, ratified by
the owner 2026-08-21 in his own words: "I will go with recommendation on key
custody model." A solo founder holding a private signing key is a single
point of loss, and the transparency log is the assessor-legible answer. The
signing identity is the repository's GitHub Actions OIDC identity
(`id-token: write`, granted to exactly one job); every signature lands in the
public Rekor log by construction.

**Scope of the first signatures.** Blob signatures over the per-push release
evidence (the image SBOM and vulnerability report), produced only on `push`
events to the protected branches — never on pull requests, where a fork's
context must not mint repository-identity signatures. Signing a REGISTRY
image by digest arrives when an image registry exists to push to; nothing
here claims it early.

**What this forbids.** Any privately-held signing key for release artifacts
without a superseding decision record; any signing step in a job that
installs third-party dependencies (the signing job must stay
install-nothing-untrusted, the same isolation reasoning as `sbom-sync`);
any claim that a signature proves more than "this exact byte content
existed in this repository's CI at this time."

**Reversal.** A future decision record choosing held keys — expected only if
a customer's air-gapped verification requirement makes the public log
unusable, which is a real scenario and the reason option (b) stays written
down rather than deleted.

**Status: ratified by owner directive, 2026-08-21. Confidence: high.**

---

## DR-010 — OpenBao as the secret boundary (RATIFIED by owner, decision session 2026-08-22)

**Question.** Report v3 names secrets management one of the three most
important gaps: ~75 credential-shaped environment names exist, and while
nearly all are fixture/lab throwaways today, the first real tenant
credential must not follow that path. Adopt OpenBao (MPL-2.0, registry row,
P0) as the secret boundary?

**Proposal.** Yes, under docs/SECRET_MODEL.md's five rules — path-naming as
audit trail, per-consumer service identities, the agent-never-holds list
(secret-zero, unseal material, root token, any secret value in
conversation), leases with rotation proven by rotating, and sealed-storage
snapshots under the existing backup discipline. Migration starts with ONE
real credential (the lab DATABASE_URL) and fixture tokens deliberately stay
env-minted throwaways.

**What ratification changes.** The registry row's `mutationsAllowed` flips
true citing this DR (the DR-008 gate refused it without one — it fired on
intake, correctly), and the lab deployment plus first migration proceed.
Until then: model only, no instance, no stored secret.

**What this forbids either way.** Any AI lane reading a secret VALUE back
through any tool; root-token or unseal material anywhere an agent can
reach; a shared secret whose path cannot name its single consumer.

**Reversal.** A superseding record choosing a different secret manager, or
returning to environment-file credentials — expected only if OpenBao's
operational burden exceeds its benefit at this scale, which the first
rotation exercise will show. Reversing costs the migration back and the
rotation runbook; nothing else depends on the choice.

**Status: RATIFIED by owner, decision session 2026-08-22. Custody: unseal /
recovery material lives with the owner, outside this repository and outside
any agent's reach — recorded here per the proposal's own terms. Deployment
proceeds when a container engine is available (Mac lane, or the cloud
engine if restored); first migrated credential is the lab DATABASE_URL,
rotation proven on it before anything else moves.**

---

## DR-011 — Positioning ratified: sentence, label hierarchy (2026-08-22)

**Decision.** The owner ratified the filed positioning draft as written — the
one sentence, the 100-word version, and the boundary paragraph, every claim
traced to a launch-class proof — landing as docs/POSITIONING.md. On the
category label the owner answered "all", ratified here as a HIERARCHY rather
than a contradiction: "Shared-Device Trust Gateway" is the product
name/category (matching DR-005's launch-profile name), "access-decision
service" is the descriptor phrase, "workflow trust engine" is the vision
phrase reserved for roadmap contexts. One name everywhere that names, one
explainer everywhere that explains.

**Reversal.** The owner amends any of it by saying so; the mechanical cost is
the site copy, the outreach templates, and this file — all of which copy FROM
this page, so a change here propagates rather than fragments. The label
hierarchy is the reversible part; the narrowness of the claim is doctrine
(DR-005's launch profile), not positioning.

**What this unblocks.** The public-site rewrite to launch scope (backlog row
6), the launch-claims gate, the GTM pack, and every outreach message — all of
which now copy from POSITIONING.md and nowhere else.

**Status: ratified by owner, decision session 2026-08-22.**

---

## DR-012 — Target market and proof stack: lean-IT first, Fleet-first, Microsoft when a prospect brings a tenant (2026-08-22)

**Decision, in the owner's own direction (decision session).** Asked to start
a Microsoft Intune/Entra trial, the owner redirected: use Fleet (or another
open alternative) to prove the connector story for now — "Microsoft is not
the only one that can help prove this," and jumping straight at major
enterprise "would be crazy." The first market is organizations with LIMITED
IT STAFF OR LIMITED RESOURCES — the SMB/mid-market lean-IT segment the
research reports independently identified as the sweet spot — beginning
there to scale correctly rather than missing the industry that can take the
most advantage of this product.

**What this fixes in place:**

1. **Proof stack**: Fleet-first. The source-agnostic DeviceManagementEvidence
   contract is already proven LIVE against Fleet (TLS + real osqueryd,
   proof:live-fleet + live-fleet-workflow). That is the demo. The Graph/
   Intune adapter stays implemented and wire-hardened (12/12 socket proof),
   honestly described as awaiting a real tenant — which arrives when a
   PROSPECT brings one, not from a trial the owner buys first.
2. **ITSM the same way**: no ServiceNow/Jira signups on the critical path;
   GLPI (registry P0 lab source) becomes the ITSM lab when an engine is
   available. Proof scripts stay ready for the day a prospect's stack names
   a vendor.
3. **Outreach targeting** follows the segment: 75–1,000-employee
   organizations, 1–10 IT people, shared/frontline devices, consolidation
   pressure — not Fortune-500 procurement.
4. **Positioning amendment (owner-sourced)**: DR-011's ratified 100-word
   version named Intune as the first enterprise connector; amended same-day
   to state the Fleet-first truth with Intune as the enterprise-roadmap
   connector. The launch profile itself is untouched — this is GTM
   sequencing, not scope change.

**Reversal.** A prospect arriving with a Microsoft tenant reverses the
sequencing immediately and cheaply — the Graph adapter is already
wire-hardened, so "Fleet-first" is an ORDER, not an exclusion. The market
choice (lean-IT before enterprise) reverses at higher cost: outreach targeting,
site copy, and the pilot package all assume it.

**Status: owner-directed, decision session 2026-08-22.**

---

## DR-013 — Open-source proof IS product proof; paid platforms are wires, not milestones (2026-08-22)

**Owner-directed, in his own words:** "focus on proof validating even with
open source cause if it can work with open source then there shouldn't be
any reason why it shouldn't work with paid platforms." Extends DR-012 from
GTM sequencing into VALIDATION DOCTRINE.

**The doctrine.** The DeviceManagementEvidence contract (and its identity
and ITSM siblings) is the product boundary. A capability proven live against
an open-source implementation of a source class is proven FOR THE PRODUCT;
a paid platform in the same class adds a thin adapter and exactly ONE
honest obligation — a single live-wire verification when a real tenant
exists — because this repository's own record says so: all live checks ever
run (10 for 10) found some fixture-vs-wire divergence. Adapter work is a
day per vendor; it is never again treated as product risk, a launch
blocker, or a reason to buy a vendor trial.

**What this re-aims the proof queue at — the source-independence
milestones (report v3's own capstone):**
1. Fleet + Headwind → same normalized contract → SAME decisions under
   fresh/stale/missing/contradictory states (endpoint class, second
   implementation).
2. Keycloak (live-proven) + authentik → same, for identity.
3. GLPI live-driven → the ITSM class proven without any vendor signup.
4. The CROSS-SOURCE CONTRADICTION MATRIX: one workflow, all classes, the
   engine detecting disagreement between independent open sources — the
   demo that sells, per the reports and per this doctrine.

Engine-dependent pieces queue to the Mac lane via sim-requests; nothing
waits on a purchased platform.

**Reversal.** A live-wire divergence that turns out to be STRUCTURAL rather
than detail — an open-source implementation whose contract genuinely cannot
represent what a paid platform emits — would reverse the doctrine for that
source class. Nothing observed so far suggests it; the ten divergences found
to date were all field-level. Reversing costs the proof queue's ordering, not
the evidence contract itself.

**Status: owner-directed, 2026-08-22.**

## DR-014 — The Mac lane is the build host that offsets cloud's hard limits (owner-directed 2026-08-23)

**The question.** The cloud lane runs on a Linux box with no container engine,
no arm64/darwin toolchain, and no Xcode — so a growing set of the product's own
proofs (every live vendor lane, the arm64 SBOM, the iOS build, the source-
independence captures) cannot execute there at all. Where should that work run,
and how freely may that machine install what the work requires?

**Owner-directed, in his own words:** "I want the repo to be able to use the Mac
for installing anything it needs to build whatever required so it can offset
limitations in cloud that cannot be done period. I can install additional apps
if needed." Said 2026-08-23 while distinguishing three things he had previously
conflated: the Bash sandbox (a restriction — kept OFF), MCP servers (tool/data
connectors, not a way to install software), and the machine's own package
managers (brew, pnpm, cargo, podman, Xcode — the actual install path).

**The call.** This Mac is the designated build host for everything the cloud
lane physically cannot do. It installs build dependencies without prompting —
brew, the JS/Rust/Python/Ruby/Go package managers, podman/docker images, and the
Xcode toolchain — encoded as an allowlist in the gitignored
`.claude/settings.local.json`. The mechanism is already the product's: the
cloud lane queues engine-dependent work as sim-requests, the Mac runs it and
commits the result, and gaps get lane-mailed back (DR-013 routes the source-
independence milestones here for exactly this reason). This grants install
latitude ONLY; it does not lift the guardrails that are not about installing —
sending data to an external service, destructive git, and any compliance /
production / certification claim still stop for the owner. Apps that need an
Apple ID, a licence, or a GUI installer remain the owner's to install by hand.

**Evidence this is load-bearing, not theoretical.** In the sessions preceding
this record the Mac lane alone produced: the live telemetry lane's first run
anywhere (the cloud box had no engine), Fleet + osquery live under emulation,
the arm64 SBOM byte-identity proof that Linux CI could not see, and the Headwind
CE capture — every one blocked on cloud by construction.

**Reversal.** A supervised-device / hosted-runner path that gives the cloud lane
a real container engine and an arm64 + macOS build surface would retire the
Mac's role as the sole offset host and fold this latitude back behind that
managed boundary. Until such a runner exists and is proven, revoking the install
latitude would strand the engine-dependent proofs with nowhere to run, which is
the exact failure this record exists to prevent. Narrowing it — dropping to a
per-command allowlist, or re-enabling prompts — is a one-line edit to the
settings file and costs only convenience, not capability.

## DR-015 — The accuracy doctrine: truth over helpfulness, company-wide (2026-08-23)

**Owner-directed, in his own words:** "You are committed to truth and accuracy
above everything else, including being helpful. A wrong answer delivered
confidently is worse than no answer." He directed that this "be applied across
the entire company and be the main starting point for the company."

**The question.** This repository already enforces truthfulness about ITSELF —
fail-closed decisions, gates that must be able to fail, a publication boundary,
a claim registry. It enforced nothing about how an agent SPEAKS: to the owner,
in a pull request, in an outreach email, in a document a buyer reads. Every
mechanism aimed at the artifact. None aimed at the sentence.

**The call — seven rules, binding on every agent, every surface, every reply.**

1. **Uncertainty.** Not fully certain, say so. "I am not certain, but…" /
   "You may want to verify this…". Never state a guess as fact.
2. **Sources.** Never invent a paper title, author, URL, or book. Cannot name a
   real verifiable source: say "I do not have a verified source for this."
3. **Statistics.** Flag any number not held with full confidence. Say
   "approximately", and recommend verification against a primary source.
4. **Recent events.** Say when a topic may have moved since the knowledge
   cutoff. Never present outdated information as current.
5. **People and quotes.** Never attribute a quote to a real person unless
   certain. Unsure: "I cannot confirm this quote is accurate."
6. **Code and technical.** Never invent a function name, library method, or API
   signature. Unsure it exists: say so and point at current docs.
7. **Logic gaps.** Do not fill missing context with assumptions. Unclear: ask a
   clarifying question BEFORE answering.

**Why this is the starting point and not a style guide.** Rule 1 and Rule 7
outrank the instinct to be useful, which is the instinct that produces the
failure this company exists to prevent. A gateway that answers `allow` when it
cannot verify would be a defect; an agent that answers confidently when it
cannot verify is the same defect wearing prose. The doctrine makes them one
rule rather than two.

**Gated vs REPORTED, honestly split.** Some of these are mechanically checkable
and some are not, and claiming otherwise would break Rule 1 on the first day.
`scripts/check-accuracy-doctrine.mjs` gates the checkable ones — invented
citation shapes, unhedged superlative figures, quote attribution without a
source, references to code symbols that do not exist. Rules 1, 4 and 7 are
behavioural and are REPORTED, not gated: no regex distinguishes warranted
confidence from unwarranted confidence. Saying so IS the doctrine working.

**Reversal.** If the gated half produces false positives that push authors
toward hedging true statements — the failure this repository already hit twice
in one day, where a gate flagged honest copy and would have taught the next
author to delete a true sentence — the offending rule comes out of the GATED
set and moves to REPORTED, with the instance recorded. The behavioural half is
reversed only by the owner, in writing, because it is the company's stated
first principle and an agent must not be able to argue itself out of it.

**Status: owner-directed, 2026-08-23.**

## DR-016 — The org becomes tiered and self-extending; ECC is its skills substrate (2026-08-23)

**Owner-directed, in his own words:** an automation loop where "if you can't
complete the loop then that's a gap you need to fill like evaluate that it's
needed and if so apply and hire employee aka agent with that skill needed then
start to main loop back again until everything has a agent aka employee w skill
of that assignment until everything is done", plus "create this and x level tier
of something trying to continue to build layers within the org as agents aka
employees", and that the import be "stacked so it's not replacing anything
unless it makes sense".

**What this amends.** `docs/agent/ORG.md` ratified FOUR roles under the heading
"Why only four", on the reasoning that breadth is the standing risk: every extra
role is another lane that can collide. That reasoning was sound and is not
discarded — it is re-scoped. The collision risk it names is real for roles that
BUILD in the same tree at the same time. It is not the same risk for a tier of
narrow, read-only or single-surface agents that cannot write where another lane
writes. The freeze therefore moves from "four roles" to "every role declares a
boundary, and boundaries may not overlap in write scope."

That same page also says product and go-to-market are not agent roles because an
unsupervised agent "will produce plausible, confident, slightly wrong claims."
The owner has since authorised autonomous outreach, and the answer to that
objection is now mechanical rather than organisational: DR-015's doctrine plus
`check-launch-claims.mjs` over the outreach surface. The objection was right; it
has been paid for in gates rather than in abstention.

**The call.**
1. **Tiers.** Tier 0 doctrine (DR-015, binding on all). Tier 1 the four owning
   roles, unchanged. Tier 2 narrow specialists with a single declared surface.
   Tier 3 read-only reviewers and evaluators, which can never collide because
   they never write source.
2. **Hiring is autonomous.** An agent may define, register and merge a new agent
   on green CI without the owner in the loop — owner-directed, this session.
3. **Hiring is gated.** `scripts/check-agent-roster.mjs` requires every agent to
   carry a charter, a tier, a declared write boundary, and a non-overlapping
   scope. An agent that grants itself authority another agent already holds
   fails the build. Autonomy is in WHO decides; the shape is not negotiable.
4. **ECC is vendored as substrate, stacked not merged.** Third-party agent,
   rule, skill and command definitions land in their own directory with their
   licence intact, and override nothing that exists.

**Licensing, which decided the source.** The URL the owner supplied
(`worldflowai/everything-claude-code`) carries NO licence file — verified, HTTP
404 — while declaring "MIT" inside a JSON manifest. `.claude/skills/VENDORED.md`
already states the rule in bold: absence of a licence is not permission. It is
also a snapshot from 2026-01-23, and only 6 of its 81 files are byte-identical
to today's upstream. The vendoring is therefore taken from
`affaan-m/everything-claude-code`, which carries a real MIT licence
(Copyright (c) 2026 Affaan Mustafa), at its current commit, restricted to the
component set the owner asked for rather than all 3,493 files.

**Reversal.** If two agents collide in write scope despite the roster gate, or
if the roster grows faster than the owner can audit it, hiring reverts to
propose-only and the tiers below 1 are frozen — the gate already records every
agent's charter and tier, so the roster is the audit trail that makes that
reversal cheap. If the vendored substrate ever conflicts with first-party
doctrine, the vendored copy loses: it is deleted, not edited, because an edited
vendor copy can no longer be diffed against upstream.

**Status: owner-directed, 2026-08-23.**

## DR-017 — Whoever has the diagnosis has the authority to fix it (2026-08-23)

**Owner-directed, in his own words:** "The Mac lane I want to be absolutely
clear one more time you have free use and can do whatever you want and or need
from that path", and — the correction that prompted this record — "if you cannot
determine the outcome then build it and assign it to yourself and or employee
aka agent with that skill can perform that task."

**The question.** Two lanes work this repository. `LANE_COORDINATION.md` rule 1
said to check before touching a shared surface. It did not say a lane may not
repair a defect it found in the other lane's work — but that is how it was read,
and reasonably so. Should a finder hand back, or fix?

**What the reading cost, measured rather than supposed.** The Mac lane
established that `live-headwind` had never authenticated on any machine,
decompiled the pinned war, and pinned the scheme exactly:
`SHA1(UPPER(hex(MD5(pw))) + "5YdSYHyg2U")`, with the login endpoint wanting MD5
hex rather than plaintext. It held a one-line fix and handed it back. Three
round trips and roughly six hours later the same one-line fix landed, unchanged.
Nothing was learned in the interval that the finder did not already know.

**The call.** A lane that diagnoses a defect may fix it, in any lane's work,
under two cheap conditions: the fix is committed WITH the evidence that
justifies it, and a lane message names what was touched. The sim-request loop
narrows to what it was always good at — provenance, a committed record that an
operation ran on a known revision — and is explicitly NOT a permission gate.

**What still hands back**, because these are boundary changes rather than defect
repairs: altering a ratified decision record, widening the launch profile, or
editing the byte-faithful Swift ports for behaviour (golden rule 1 — parity is
the point, and a behaviour change there needs both twins in one commit).

**Why not merge the lanes instead.** The owner asked whether to collapse
everything onto the Mac. Considered and declined, on evidence: the cloud lane
merged twenty pull requests in a session during which the Mac was mostly idle,
and it is the lane holding continuous CI and merge authority. Going fully local
trades always-on throughput for the convenience of one tree. The split is not
the cost; the HANDBACK was, and this record removes it. Revisit if the cloud
lane's inability to run a container engine ever blocks more work than the
coordination saves — today it blocks two queued operations and nothing else.

**Reversal.** If a repair made under this authority breaks something the finding
lane did not understand — the shape rule 1 was guarding against — the authority
narrows to surfaces the fixing lane already owns, and the evidence-with-the-fix
condition becomes a review rather than a commit note. The collision log in
`LANE_COORDINATION.md` is where that evidence would appear, and it is empty of
such a case today.

**Status: owner-directed, 2026-08-23.**

## DR-018 — The skill that speaks for this repository lives outside it (2026-08-25)

**Status: RATIFIED by the owner, 2026-08-25.** Asked as a direct choice — copy it
in, leave it, or defer — the owner chose to copy it in. Vendored the same day to
`.claude/skills/signalgrid-master/`, with the seventh row added to the
first-party exception table in `.claude/skills/VENDORED.md`.

**The question.** `signalgrid-master` is a 378-line skill in the owner's synced
skills, at `~/.claude/skills/synced/signalgrid-master/`. It describes itself as
"SignalGrid's first-party orchestration layer", publishes an authority order for
this exact repository, and every Claude session in this account loads it. It is
not in the repository. Should it be?

**What was measured, on 2026-08-25, before any of the argument below.** All 18
repository-relative paths it cites resolve in this tree. It pins no figure — every
reference to a decision record is written as a conditional ("unless superseded by
a later record"), which is why it has not gone stale. It repeats none of the six
entries in `docs/agent/FALSE_CLAIMS.json`. It ranks itself SEVENTH in its own
authority order, below `AGENTS.md`, `CLAUDE.md` and the ratified decision records.
Its frontmatter declares `license: MIT` and `author: SignalGrid`, so it is
first-party and carries a grant this public repository can republish.

**So the content is not the problem, and that is the whole point.** It is accurate
today and nothing in this tree established that — the audit did, by hand, once.
`scripts/check-org-roster.mjs` derives every dispatchable executor from disk and
reads exactly two directories under the repository root, `.claude/agents` and
`.claude/skills`. That scope is deliberate and correct: a roster may only name an
executor that is committed and reviewable. It also means this file cannot be seen
from here. It changes with no diff, no review, and no gate. `CLAUDE.md` could be
edited tomorrow to contradict it and both documents would read as correct in
isolation.

The asymmetry matters more than it first sounds: **21 of the 42 roles in
`docs/agent/org-roster.json` already name a `skill:` executor.** Skills are
first-class authority in this org, and every other one of them is a committed
file.

**Option A — vendor it into `.claude/skills/signalgrid-master/`.**
It becomes reviewable, diffable, and nameable as an executor. The cost is a second
copy that can drift from the synced original, and `VENDORED.md` documents that
exact failure happening here already: its "one exception" note was true the day it
was written, silently became false when five first-party skills landed two days
later, and a re-vendor following it literally would have overwritten four of the
org's executors.

**Option B — leave it where it is.**
One copy, no drift. `pnpm run scan:agent-plane` (added with row 169) reports it and
any other out-of-repo skill that speaks for this repository, including citations
that stop resolving. But a reporter is not a review, and it is local-only — CI has
no `~/.claude`, so no build can ever depend on it.

**The recommendation, and the reason it is not a coin flip.** Take Option A.
Vendoring does not create the divergence risk so much as move which copy is
AUTHORITATIVE. Today the unreviewable copy is authoritative and the repository has
no say. After vendoring, the reviewable copy is authoritative and the synced one
becomes a convenience mirror — which `scan:agent-plane` already watches and will
report when the two disagree. Drift between them is detectable; unreviewability is
not detectable from inside the repository at all, which is the property that
actually bites. Add the row to `VENDORED.md`'s first-party exception table in the
same commit, making seven, because that table is what a future re-vendor reads.

**What this does NOT decide.** Nothing about the skill's content. If it is
vendored it is vendored as it stands, and any change to what it says is a separate,
reviewable commit. It also does not promote the skill's authority: it stays seventh
in its own order, below `CLAUDE.md`, and vendoring must not be read as ratifying
anything it asserts.

**Mechanical verification.** `check-org-roster.mjs` derives executors from disk, so
a vendored copy becomes nameable the moment it lands and a deleted one becomes a
FATAL dangling pointer — no new gate needed for that half. `scan:agent-plane`
reports the synced original alongside it.

**What ratification changed, concretely.** `check-org-roster.mjs` derives
dispatchable executors from disk and now counts 34, `skill:signalgrid-master`
among them — so a role may name it, and deleting the file becomes a FATAL
dangling pointer rather than a silent gap. The synced original is untouched and
still loads; `VENDORED.md` records that it is now a MIRROR and that the committed
copy wins if the two disagree.

**Reversal.** Delete `.claude/skills/signalgrid-master/` and remove its row from
the `VENDORED.md` table. The synced original is untouched by this record and keeps
working, so reversal costs one commit and loses nothing. Reverse it if the two
copies are found to have diverged twice without anyone noticing, which would mean
the mirror is being edited in preference to the committed file and the vendored
copy has become the fiction rather than the source.

## DR-019 — PURPOSE.md becomes canonical; DR-004's category-label authority is superseded (2026-08-26)

**Question.** `docs/PURPOSE.md` now states what SignalGrid is. DR-004 ratified
"Shared-Device Trust Gateway" as the canonical category label. Both cannot be
canonical, and leaving both standing recreates exactly the drift PURPOSE.md
exists to end — every future contributor picks whichever phrase is convenient.

**The call.**

1. **`docs/PURPOSE.md` is canonical for current product truth.** Every other
   document references it rather than paraphrasing it. Paraphrase is how
   "decision layer" mutates back into "trust fabric."
2. **DR-004 is preserved unchanged as historical record.** Its execution-order
   ratification stands. Its ratification of "Shared-Device Trust Gateway" as
   SignalGrid's canonical category label is **superseded** by PURPOSE.md.
3. **No replacement category label is ratified.** PURPOSE.md's purpose and
   product sentences are sufficient. Whether the recognised category is decision
   infrastructure, trust orchestration, shared-device security, contextual
   access or something unnamed is a question for buyers. Manufacturing a
   category before discovery is the error DR-004 made cheaply and would make
   expensively a second time.

**Evidence read.** A framing census of the tree on 2026-08-26: `decision layer`
35 files, `Assist gate` 19, `Shared-Device Trust Gateway` 16, `trust
orchestration` 16, `runtime decision layer` 15, `trust fabric` 8 — against
`moment of use`, the canonical framing, in 2.

**Also corrected under this record.** PURPOSE.md was frozen carrying a factual
error: it listed the verdict enum as `allow · deny · step-up · hold`. The
published OpenAPI contract (`DecisionOutcome`, 0.2.0) is
`allow · step-up · restrict · deny`. `restrict` is implemented, ported to the
native surfaces and asserted by the proof suite; `hold` has no implementation
evidence. The doctrine now follows the contract.

This is the freeze rule working, not being broken. PURPOSE.md permits material
change on new evidence and forbids it on internal preference. Implementation
evidence falsified a statement, so the statement was corrected. Renaming
"moment of use" because someone preferred different words would remain
prohibited.

**Reversal.** The owner reverses any part of this by saying so. Short of that:
the category-label question reopens when customer discovery produces evidence
that buyers recognise a specific category, and a later DR ratifies it. The
verdict enum reopens only if a design partner demonstrates a workflow requiring
a distinct deferred/human-review state that `restrict` cannot express.

## DR-020 — The orchestration thesis: PURPOSE.md corrected from gate to grid (2026-08-27; recorded 2026-08-31)

**Provenance of this record.** The decision was ratified and executed on
2026-08-27 in commit `62679cb` ("DR-020: correct PURPOSE to the orchestration
thesis"), which rewrote `docs/PURPOSE.md` to v2 without appending a record
here. Ten tracked files then cited DR-020 while this file's last entry was
DR-019 — a dangling citation no gate caught, because `check:cited-paths`
validates file paths, not DR numbers. This record is a reconstruction from
that commit's message and PURPOSE.md v2, written to close the gap; the
substance below is the 2026-08-27 decision, not a new one.

**Question.** PURPOSE.md v1 described a gate — "decides whether a shared-device
session should proceed." That is one cell of the grid, not the company. It was
written by reading the repository instead of asking the owner what the
repository was for, and every agent skill then enforced the narrower reading.

**The call.**

1. **Product reframed to orchestration.** A decision is not the output; it is
   the trigger for a cascade — environment, workflow, verification, and
   escalation when reality does not match.
2. **The credential is the spine, not a signal.** One badge or phone carries a
   person through door, device, room and app. The identity is continuous; the
   systems are what is fragmented. This is why the connector surface is wide —
   it is the platform surface, not sprawl.
3. **The embedded UX law is promoted from constraint to thesis.** The worker
   never sees SignalGrid. Adoption is the product; security and evidence are
   by-products. Evidence cited: Sinsky 2016, Hassidim 2017 (quoted from the
   studies, unverified in this repository).
4. **Verticals are configuration, not code.** Healthcare is the first
   vertical. Nothing industry-specific may enter the core.
5. **Lanes, as set on 2026-08-27:** Mac/iOS and API/Bruno/Postman REOPENED
   (invisibility cannot be proven in a container; for a product that connects
   systems, the API surface is the product). Cloud logic, connectors and
   proofs stayed frozen, as did new verticals, platforms and hardware.
   *That residual freeze is lifted by DR-021.*

**Why this was legitimate under the freeze rule.** A correction of owner
intent, not preference drift — the category PURPOSE.md's own change rule
permits.

**Reversal.** The owner reverses any part of this by saying so.

## DR-021 — The engineering freeze is lifted; the repo runs in absorption mode (2026-08-31)

**Question.** DR-020 left cloud logic, connectors, proofs, and new
verticals/platforms/hardware frozen, and a 2026-08-28 session handoff wrote
that freeze into the operating loop ("Engineering frozen — loop plumbing /
merges / doc-state only"). On 2026-08-31 the owner directed otherwise.

**The directive, quoted.** "Break the engineering freeze that needs to stop
because I'm going to be feeding you information all the time for you to absorb
and use to better strengthen the repo and its ability to use resources for
easier access to build this solution exactly the way I intended it to be
finally." Separately, on the same day, the owner directed that the ECC toolkit
(github.com/affaan-m/ECC) be set up and used as "an overall strategy and final
pass or additional passes" for this repository.

**The call.**

1. **The engineering freeze is lifted in full.** Every lane is open: cloud
   logic, connectors, proofs, native surfaces, API, and — with a decision
   record per DR-020's rule — verticals, platforms and hardware. "No small
   versions of frozen work" is void because nothing is frozen.
2. **Claim discipline is NOT lifted, and is not the freeze.** The
   launch-claims gate, the launch-profile classification, the publication
   boundary, and the no-overclaim rules (production-ready, certified,
   compliant, partner, autonomous remediation) stay exactly as they are.
   Building something and claiming it ships remain two different acts; only
   the first is unfrozen. A change to what is *claimed* still requires its
   own decision record.
3. **Absorption mode.** The owner feeds resources — repositories, articles,
   tools, vendor material — continuously. Each one gets absorbed: logged in
   `docs/agent/RESOURCE_INTAKE.md`, evaluated by use, and where useful, wired
   into the repo. The failure mode this replaces is documented there: a
   resource answered with a memo of reasons instead of a working integration.
4. **ECC is adopted as review tooling, and it has already earned the seat.**
   The Mac lane hosts the harness dormant and report-only with hooks off; its
   first pass (2026-08-31) found four verified fail-closed inversions in the
   #336 self-check tooling — the tooling meant to enforce fail-closedness.
   Cloud sessions install it on demand via the pinned, opt-in
   `pnpm run ecc:install` (`ecc-universal@2.2.0`); it is never auto-executed
   from a hook, because a public repo's hooks must not run third-party code
   invisibly. ECC advises; only preflight/verify:breadth certify green.
5. **The 2026-08-28 handoff enforcement pack is installed, with recorded
   divergences:** (a) its three freeze-phase lines are updated to this
   record's phase, because installing "Engineering FROZEN" banners on the day
   the owner ended the freeze would encode a falsehood; (b) its
   ask-on-commit/push permission list is omitted, because the owner's own
   scheduled autonomous lanes (steward and hygiene heartbeats) require
   unattended commits — the deny list and the Stop-hook push verification are
   installed in full and enforce the same goal; (c) its MCP registration is
   pointed at the repository's real Node MCP server
   (`artifacts/mcp-server`), not the nonexistent `signalgrid_mcp` Python
   module the handoff assumed.
6. **Discovery remains the number that moves the company.** Conversations
   logged (`docs/agent/DISCOVERY_LOG.md`) still gate the thesis; unfrozen
   engineering widens what can be built, not what has been validated.

**Reversal.** The owner reverses any part of this by saying so. Re-freezing
any lane requires a new record naming the lane.

---

## DR-022 — Firecrawl is adopted as a research/verification lane, on top of ECC (owner-directed 2026-09-01)

**Question.** The owner forwarded Firecrawl's marketing email (CLI + Agent Skill
+ hosted MCP server; "turn websites into LLM-ready data") with the instruction:
*"Please also add this on top of ECC please."* Firecrawl had a prior recorded
disposition — `docs/INTAKE_LEDGER.md` row 97 rated it **OUT OF SCOPE for the
product, NOT NEEDED for research** (existing fetch tooling covers it; AGPL-3.0
noted as a reason not to reach for it casually). Does the owner's direction
stand, and how is it added safely?

**Call: adopt it, as opt-in research/verification infrastructure only — the
owner's direction supersedes row 97's "not needed."** Firecrawl joins ECC in the
evidence toolchain (`.claude/skills/signalgrid-evidence-toolchain`) as the
web-research / source-verification lane. It is installed the same disciplined way
ECC was, and it is bounded the same way.

**What "adopt" means here, precisely:**

- **Pinned client, not the vendor one-liner.** `pnpm run firecrawl:install`
  (`scripts/install-firecrawl.mjs`) registers the **MIT-licensed** `firecrawl-mcp@3.24.0`
  hosted-API client as a **user-scoped** MCP server for Claude Code. It does the
  opposite of the advertised `npx -y firecrawl-cli@latest init --all --browser`
  on every axis the repo cares about: exact version not `@latest`, one client not
  `--all`, and fail-CLOSED on a missing key not `-y` auto-confirm.
- **The API key is a secret.** It is read from `FIRECRAWL_API_KEY` in the
  environment and never enters the repo tree, a commit, or the installer file.
  No key → the installer refuses and exits non-zero.
- **The AGPL concern is sidestepped, not ignored.** Row 97's copyleft note was
  about the self-hostable `firecrawl/firecrawl` **server** (AGPL-3.0). This
  adoption uses the hosted API through the MIT client only; it does not vendor or
  self-host that server, so no copyleft surface is added.
- **Report-only, never in a decision path.** Firecrawl returns external web
  content. It is a way to fetch what a human would read — competitive/source
  research, verifying an external claim. It never feeds the deterministic core, a
  proof fixture, a connector, or the public product build. The decision core
  stays offline and deterministic (golden rule 2).

**Why the reversal is coherent.** Row 97 answered a different question — "should
we clone the AGPL server as a product/research dependency?" — and answered it
well for that framing. The owner is asking a narrower one: "use the hosted
service, through its permissive client, as a research convenience on top of ECC."
The blocking facts row 97 raised (copyleft, redundancy) are addressed by the
boundary above, and where they are a matter of the owner's convenience-vs-
diligence tradeoff, that is his call to make, and he made it.

**Evidence.** `scripts/install-firecrawl.mjs`; `package.json` (`firecrawl:install`);
`docs/INTAKE_LEDGER.md` row 97 (the prior disposition, now annotated); the
`firecrawl-mcp` npm licence (MIT) vs the `firecrawl/firecrawl` server licence
(AGPL-3.0); the ECC precedent (DR-016, `ecc:install`).

**Reversal.** The owner reverses by saying so. If the hosted service is dropped,
remove the `firecrawl:install` script and the MCP registration; nothing in the
product depends on it, by construction.

---

## DR-023 — The Assist wire is served: DR-007's declared gap closes (2026-09-01)

**Question.** DR-007 recorded `POST /v1/authorize` — the `{assist, reasons,
decisionId}` envelope the Kotlin and Rust host-app SDKs bind and the 42 shared
conformance vectors hold — as a **declared gap**, for one stated reason:
*"building that route now would widen the frozen launch surface."* DR-021 has
since lifted that freeze, and the owner's standing directive is to close every
known gap. Does the wire get served?

**Call: yes — the route is served, the gap entry is retired, and the route is
classified `launch`.** The only blocker DR-007 named no longer exists.

**What was built, precisely.**

- `POST /v1/authorize` (`artifacts/api-server/src/routes/v1.ts`) is the **same
  decision** as `POST /v1/decisions/evaluate`: same request body
  (`EvaluateRequest`), same `core.evaluate`, same persisted decision record,
  same `decisionId`. It differs only in envelope — top-level `assist`,
  `decisionId`, `reasons` — the minimal obedience surface a shared-device host
  app consumes. `assist` **is** `DecisionOutcome` by construction (the same four
  strings in `lib/signalgrid-core/src/types.ts`), so no mapping table exists to
  drift; `reasons` is `reasonCodes` verbatim.
- The OpenAPI contract (`lib/api-spec/v1-openapi.yaml`) registers the path and
  an `AssistResult` schema. Registering the path is exactly the `closedWhen`
  DR-007's gap entry named, so the gap closed on the mechanism it declared.
- `scripts/launch-profile.mjs`: the `assist-wire-unserved` gap entry is
  removed (the served-ness gate fails on a served route with a stale gap), the
  route is classified `launch` beside the evaluate route it duplicates, and
  `LAUNCH_PROFILE_VERSION` is bumped 4 → 5 — the mechanical record that a
  launch-surface change was taken deliberately (DR-001).
- `scripts/check-assist-wire-served.mjs` keeps every failure mode it had, now
  synthesised from a served baseline: an unserved wire with no gap, a served wire
  with a stale gap, a retargeted gap, an emptied vector suite.
- The api test suite binds the server side of the contract: 200, top-level
  `assist` in vocabulary, agreement with evaluate's outcome for the same input,
  restrict-with-reasons, and the same 401/403/400 discipline as evaluate
  (an auditor cannot mint a decision through the Assist wire either).

**Why two envelopes over one decision, and not one.** A host app on a frontline
device obeys one word and must fail closed on anything else — the vectors read
any non-2xx and any unrecognised `assist` as deny. `EvaluateResult` carries
policy ids, matched rules and an evidence reference that the console's
explainability surface needs and a host app must never have to parse to stay
safe. Keeping them separate keeps the two surfaces from dragging each other.

**What this does NOT change.** Claim discipline (DR-021 §3): the wire is
served and fixture-backed on the review surface; it is not a production
deployment and no document may say otherwise. The iOS `/v1/app-workflows/evaluate`
wire DR-007 also discussed remains deferred, exactly as that record left it.

**Evidence.** `artifacts/api-server/src/routes/v1.ts`; `lib/api-spec/v1-openapi.yaml`;
`scripts/launch-profile.mjs` (version 5, GAPS 5 → 4); `scripts/check-assist-wire-served.mjs`;
`native/shared/assist-wire-conformance.json` (routeComment); `artifacts/api-server/test/api.test.mjs`.

**Reversal.** The owner reverses by saying so; un-serving the route means
restoring a gap entry that names it and bumping the profile version again.
