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

---

## DR-024 — The layered operating model: Ponytail on top, ECC second, the owner's builds scanned by both, then the independent scan, then execution (owner-directed 2026-09-01)

**Question.** The owner's directive, verbatim: *"This will now be the primary layer
that runs and controls this repo and will do its own independent scan of my repo and
adjust everything that needs to be redone and I don't care at this point if got to rip
everything out and build new cause this should be at top then second layer will be ECC
then my own that I build which will be scanned by both ponytail and ECC then you'll come
back and do own independent scan then finally come together and execute I'm hands off
fully and complete. Only time you need me will be to approve or allow access to something
otherwise I'm staying out of it now. My job now will be to feed you information and build
my product and solutions off what I provide you period no more freeze crap."* The layer
named is [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail). What is
it, and how does the stack run?

**What Ponytail is, established by use.** `@dietrichgebert/ponytail` v4.9.0 (MIT,
commit `2ed6c52`), "lazy senior dev mode for AI agents": a seven-rung ladder applied
before any code is written — does it need to exist (YAGNI) → already in this codebase →
stdlib → native platform → installed dependency → one line → only then the minimum — with
hard rules that trust-boundary validation, error handling that prevents data loss,
security, accessibility, anything explicitly requested, and one runnable check per
non-trivial logic are **never** cut. Six skills (`ponytail`, `-review`, `-audit`,
`-debt`, `-gain`, `-help`), three lifecycle hooks, a read-only MCP that serves the
ruleset. It is a **minimalism lens**. By its own charter it is **not** a correctness,
security, or performance reviewer; it routes those to a normal review pass.

**Call: the stack, in order, each a distinct lens; no lens certifies green by itself.**

1. **Ponytail — top.** `ponytail-audit` produces the ranked cut list; `ponytail-review`
   runs on every diff; `ponytail-debt` keeps the ledger of deliberate shortcuts. Its cut
   list is **executed**, not merely noted — "rip out and rebuild" is licensed wherever the
   ladder says the code should not exist — bounded only by its own never-cut rules and by
   this repository's gates. Default intensity `ultra`, per the owner's appetite.
2. **ECC — second.** Correctness, security, architecture, test discipline (DR-016;
   DR-021 §4 stands: ECC advises).
3. **The owner's builds.** What the owner provides is scanned by 1 and then 2 before it
   lands.
4. **The independent scan.** Fail-closed inversions, contract drift, runtime truth, claim
   discipline — the classes neither 1 nor 2 targets — run as this repository's own sweeps.
5. **Converge and execute.** Findings from every lens ranked, built, gated (`preflight` +
   `verify:breadth` certify green), PR'd, merged.

The owner is hands-off: the organisation comes to him only for approvals and access. No
engineering-freeze language anywhere; DR-021 stands and this record extends it. Claim
discipline is unchanged (DR-021 §3).

**Why Ponytail on top is coherent.** It removes what should not exist *before* the other
lenses spend effort reviewing it, and its never-cut list protects precisely what the
fail-closed doctrine protects. The two do not fight; the first audit proved it — every
one of its 70-odd findings left every proof, guard, and `default:` arm in place.

**How it is installed, and the one place this differs from ECC.** `pnpm run
ponytail:install` (`scripts/install-ponytail.mjs`) registers the **local clone at the
pinned commit** as the marketplace — the marketplace form of the install tracks the
upstream author's moving HEAD, which this repository does not permit — and installs at
user scope, non-interactively, then sets the default mode. Its three hooks are
**installed**, where ECC's stayed off: they were read (2026-09-01) and are small Node
scripts that only inject the ruleset text and record the mode under `~/.config/ponytail`
— no child process, no network, no secret reads; `claude plugin details` classes them as
harness-only with no model-context cost. ECC's hooks *run passes*; Ponytail's only speak.

**First scan.** `docs/agent/PONYTAIL_AUDIT_2026-09-01.md` — three parallel auditors
over `lib/`, `artifacts/`, and `scripts/`+`native/`, in `ultra`. Net possible:
roughly 21,000 + 3,100 + 3,500 lines and ~170 dependency entries, with the owner-call
deletions listed as decisions rather than applied. `ponytail-debt` baseline: clean ledger.

**Evidence.** The clone at `2ed6c52`; `claude plugin validate` / `details` output; the
hook sources; the three audit reports; `docs/agent/RESOURCE_INTAKE.md` (row 2026-09-01).

**Reversal.** The owner reverses by saying so: `claude plugin uninstall ponytail`, remove
the script and the rows. Nothing in the product depends on it, by construction.

## DR-025 — The durable audit ledger is tenant-readable: a tenant column hashed when present, a scoped READ over the one global chain, and an audit route that names its source (2026-09-01)

**Question.** The independent scan (DR-024 step 4) found that the durable ledger
(`lib/audit`) carried no tenant on a record, so a tenant could never be shown its
own durable history, and that `/v1/audit` answered from the in-memory core ledger
even when Postgres held the truth — a durable row was written on every decision and
nothing could read it back per tenant. Two tenants' rows were distinguishable only by
whatever the free-text `meta` happened to say.

**Call.**

1. **A nullable `tenant_id` column** (migration v3 in `lib/persistence/src/migrations.ts`,
   index on `(tenant_id, seq)`), written by every decision recorded from
   `/v1/decisions/evaluate` and `/v1/authorize` as a `decision.evaluated` event.
2. **The tenant is part of the hashed body ONLY when present.** The canonicalizer writes
   an absent key as `null`, so an unconditional key would have re-hashed every
   pre-column row and turned the migration into a false tamper alarm. Append and verify
   agree on this rule (`appendAuditRecord` and `verifySegment` in `lib/audit/src/index.ts`);
   rows written before the column keep their hashes, and moving a row between tenants is
   detected at that row.
3. **A tenant slice is a READ view over the single global chain, never a chain of its
   own.** `getAuditRecordsForTenant` returns the tenant's rows in ledger order, paged; the
   chain is verified whole and the response says so (`chain.scope: global-ledger`). No
   per-tenant head hash exists, so none is claimed.
4. **`/v1/audit` names the ledger that answered** — `source: durable` (tenant rows +
   whole-chain verdict, `?limit&offset`) when Postgres is configured, `source: memory`
   otherwise — instead of silently serving the demo ledger under a durable-sounding route.

**Evidence.** `pnpm run proof:audit-ledger` (seven tenant-scope assertions, including the
moved-row tamper and the untenanted row belonging to no tenant's view);
`pnpm --filter @workspace/api-server run test:api` (`source: memory` without Postgres);
`lib/api-spec/v1-openapi.yaml` (`listAudit` parameters and description). The Postgres half ran
on a disposable Postgres 16 cluster in the cloud lane (`SIGNALGRID_DB_DISPOSABLE=1`):
`pnpm run db:migrate` applied v1–v3 in order, then `proof:audit-ledger-pg`,
`proof:decision-store-pg`, `proof:db-role-split`, `proof:backup-restore` and
`db:verify-ledger` all passed with the column and its index present.

**Reversal.** Stop writing the tenant and drop the route branch; the column can stay, and
every row already hashed with a tenant keeps verifying, because the rule in call 2 is
symmetric. What cannot be reversed by deletion alone is a tenanted row's hash — so the
column is not dropped.

## DR-026 — Neural Memory is the memory substrate under the stack: MCP server only, pinned, hooks off, store outside the tree (owner-directed 2026-09-01)

**Question.** The owner's directive, verbatim: *"This need to be added to the stack this
is essential that this is added. https://github.com/nhadaututtheky/neural-memory"* What is
it, where in the DR-024 stack does it sit, and what has to be true for a memory that
persists across sessions to be safe in a repository that holds tenant fixtures and live
evidence?

**What Neural Memory is, established by use.** `neural-memory` v4.62.0 (MIT, commit
`2015cb9b`): a Python MCP server (`nmem-mcp`) over a local SQLite graph — memories as
nodes, typed links between them, recall by spreading activation rather than by embedding
search. Installed with `uv`, run over stdio, it gives Claude Code remember / recall /
recap tools. It also ships a plugin form: a PyPI-latest server plus four Claude Code
hooks — two of which ingest the session transcript (`hooks/stop.py` lines 303–345), one
of which records every tool call — a PyPI version check on start (`cli/update_check.py`
lines 21 and 75–93; `mcp/version_check_handler.py` lines 77–108), an optional Mem0 sync,
a sync service and a Telegram bridge. Its surface writer walks up to any
`.git`/`package.json` root and writes a `.neuralmemory/` directory there
(`surface/resolver.py` lines 36 and 65–70). Concurrent synapse adds on one SQLite
connection can drop edges (`pipeline_steps.py` lines 1503 and 1599): an upstream defect,
noted here and, on 2026-09-02, filed upstream by the owner from the cloud lane's draft —
filing sends content to an external service, which was the owner's call to make.

**Call: adopted as the MEMORY SUBSTRATE under the DR-024 stack — not a lens, not a
review layer. It remembers; it judges nothing.**

1. **MCP server only, user scope, pinned to the commit.** `pnpm run neural-memory:install`
   (`scripts/install-neural-memory.mjs`) runs `uv tool install --python 3.11 --force`
   against `git+https://github.com/nhadaututtheky/neural-memory@2015cb9b…` and registers
   `nmem-mcp` with `claude mcp add --scope user`. The plugin form is refused: its server
   floats on PyPI-latest and its hooks read the transcript and log every tool call — the
   same hooks-off call made for ECC, for the same reason.
2. **Hooks OFF.** None of the four `nmem-hook-*` executables is wired into any settings
   file. Memory is written deliberately, by a tool call, or not at all.
3. **Outbound off by config.** The installer writes a minimal `config.toml` —
   `[maintenance] version_check_enabled=false`, `[mem0_sync] enabled=false`,
   `[sync] enabled=false`, `[telegram] enabled=false` — only when none exists; an existing
   file is never overwritten, and the installer says which happened.
4. **The store lives OUTSIDE the repo.** `NEURALMEMORY_DIR` must resolve outside the
   tree; the installer refuses otherwise. `.neuralmemory/` is gitignored so the surface
   writer can never land a store in this checkout.
5. **Operating memory only.** The store holds what a session learned about working this
   repo — a gate's quirk, a lane's state, an owner preference. It never holds tenant data,
   secrets, PHI, `artifacts/live-evidence/`, or an index of the tree. Committed docs
   (`docs/agent/LOOP.md`, the decision records, the intake log) remain the memory of
   record; the store is a cache of them, never their source.
6. **Nothing in the product touches it.** No file in `lib/*`, `artifacts/api-server`, or
   any proof may import, call, or read it. A decision that consulted a memory would no
   longer be deterministic (golden rule 2).

Fail-closed at every step: no `uv`, no `claude`, an in-tree store path, a failed pinned
install, a missing `nmem-mcp`, or a failed registration each exit 1 — there is no PyPI
fallback. Session ritual: `nmem_recap` at session start, in addition to (never instead
of) reading `docs/agent/LOOP.md` and running `pnpm run loop:state`.

**Evidence.** The clone at `2015cb9b0973a6fe14a3bc547c932d64d6ced203`, read 2026-09-01
at the file lines named above. The install receipt from the cloud lane (2026-09-01):
`uv` built the pin and installed `neural-memory==4.62.0` with nine dependencies;
`claude mcp get neural-memory` reports user scope, stdio, connected, with
`NEURALMEMORY_DIR` set; user settings carry no `nmem-hook` entry. The refusal
transcripts: a PATH without `uv` exits 1 with "Nothing was done"; a store path inside
the worktree exits 1 the same way and creates no directory.

**Reversal.** The owner reverses by saying so: `claude mcp remove neural-memory --scope
user`, `uv tool uninstall neural-memory`, delete the store directory, remove the script
and the rows. Nothing in the product depends on it, by construction.

## DR-027 — The `public-apis` directory is an evidence/research catalogue beside Firecrawl: fixture-first, keyless rows only, nothing in a decision path (owner-directed 2026-09-02)

**Question.** The owner's directive, verbatim: *"Here are additional resources and layers
that's can be added or provide more information and detailed answers about my product as
well. https://github.com/public-apis/public-apis"* What is it, where in the DR-024 stack does
it sit, and what has to be true for a directory of third-party public endpoints to strengthen
a repository whose decision core is deterministic, offline and fixture-backed? The resource had
a prior recorded disposition — `docs/INTAKE_LEDGER.md` row 97 rated `public-apis` **OUT OF
SCOPE** ("wrong category of API entirely"), without cloning it. Does that stand?

**What it is, established by use.** `public-apis/public-apis` at commit
`38527bc133d839cee090fa5c44f814ed1dca3d66` (MIT; cloned `--depth 1` on 2026-09-02): one
README.md of 2215 lines holding 1721 link rows under 51 categories (a 52nd heading is a
sponsor block), each row a name, a description and three contributor-supplied columns —
`Auth` (`No` 809 / `apiKey` 755 / `OAuth` 150 / other 7), `HTTPS` (`Yes` 1629 / `No` 92) and
`CORS`. It is a **directory of links**: no endpoint definitions, no rate limits, no terms, no
freshness guarantee. Ten read-only GET probes with synthetic inputs (a well-known CVE id, a
public DNS address, a public landmark coordinate, a year and country, a generic UA string)
established: NVD's CVE 2.0 API, MSRC's CVRF feed, Nager.Date's holiday API, Nominatim's reverse
geocoder and four IP-to-ASN/geo services answer 200 without a key; **URLhaus, marked `No` auth
in the directory, returned 401** (the auth column drifts); ApicAgent's row links a landing
page, not an API; the four IP-geo sources disagreed on the city for one anycast address. OSV,
CIRCL CVE, CISA KEV, FIRST EPSS, macvendors.com and any UTC-offset service are **not in the
directory at this sha**. HaveIBeenPwned and every threat-intel row are `apiKey` and were not
probed.

**Call: absorbed as an EVIDENCE/RESEARCH CATALOGUE beside Firecrawl (DR-022) — not a review
layer, not a memory layer, not a connector, not a dependency. Row 97 is superseded for the
narrow question and stands for the wide one.**

1. **Row 97 answered "is this where SignalGrid's signals come from?" — no, and that holds.**
   The systems of record (Entra, Intune, Jamf, Fleet, ISE, CrowdStrike, ServiceNow) are not
   public APIs, and no directory row substitutes for their credentials or families. The owner's
   direction asks a narrower question — *which keyless public rows can enrich a fixture or
   answer a buyer's "without a vendor contract?" question* — and that one is answered in
   `docs/research/PUBLIC_API_SOURCES.md`: a ranked registry of sixteen rows against the families
   in `docs/INTEGRATION_CATALOG.md`, top fits being NVD → `vuln-scan` (CVE enrichment),
   Nager.Date / gov.uk → `change-window` and `shift-context` (holiday tables), Nominatim →
   `location-services` (a facility geofence centre at design time, under ODbL). (a deferred family, not shipping)
2. **Fixture-first, by rule.** A public API's output enters this tree only as a committed
   fixture minted by a human-run script, stamped with source URL, retrieval date and this sha.
   The decision core never calls one (golden rule 2). A live read, if ever built, is a connector
   family behind tier **and** `SIGNALGRID_LIVE_INTEGRATIONS=true` **and** a configured opt-in,
   through an injected transport, scanned by `scripts/check-ungated-fetch.mjs` — "no key
   needed" is not "no opt-in needed".
3. **Closed input list.** Nothing identifying leaves the tree toward a public endpoint: no PHI,
   PII, tenant id, device or gateway IP, worker coordinate, password material, or real
   peripheral MAC. Permitted inputs are a CVE id, a country code and year, an administrator's
   facility address at design time, and well-known public addresses in tests. Widening the list
   needs a decision record.
4. **Outage is unknown, and unknown raises.** Every non-200, malformed body, or stale fixture
   resolves to `unknown` and raises assurance — the rule `lib/integrations/src/utils/freshness.ts`
   already states for timestamps. Probe 8 is the standing reason: a row's auth can change
   without notice.
5. **Not a source of truth for claims.** A directory row is a pointer; a claim about a vendor's
   API cites the vendor. The directory establishes nothing about the six sources the intake
   named that it does not list.
6. **No code, no dependency, no family, no proof.** This record changes documentation only:
   the brief, this record, the intake row, the index line, and an annotation on row 97.

**Why the reversal is coherent.** Row 97 was right that popularity is not relevance and that
the decision core's differentiator is untouched by any public API. DR-022 set the shape for
this situation: the owner's direction supersedes a "not needed" for the *narrow* use while the
blocking facts are honoured by a boundary. Here the boundary is fixture-first plus the closed
input list; inside it, three rows genuinely answer buyer questions the tree could not answer
before, and the drift finding (probe 8) is itself worth the intake.

**Evidence.** The clone at `38527bc133d839cee090fa5c44f814ed1dca3d66` (its README.md,
CONTRIBUTING.md, LICENSE), read 2026-09-02; the ten-probe transcript quoted in
`docs/research/PUBLIC_API_SOURCES.md`; `docs/INTAKE_LEDGER.md` row 97 (annotated);
`pnpm run check:absence public-apis` on 2026-09-02 — INCONCLUSIVE with one mention, row 97,
read and named here; the family type files cited row by row in the brief.

**Reversal.** The owner reverses by saying so: delete the brief, this record, the intake row
and the index line, and strike the row-97 annotation. Nothing in the product depends on it,
by construction.

## DR-028 — The MCP ecosystem is absorbed as a fixture-first signal-source map, and SignalGrid's own MCP server is prepared for a public marketplace listing (owner-directed 2026-09-02)

**Question.** The owner's directive, in substance: *search MCP Market
(app.mcpmarket.com) for anything that adds value to SignalGrid so I can offer it as a
solution.* Two questions fall out of it. First, what does the Model Context Protocol
ecosystem add to a product whose decision core is deterministic, offline and
fixture-backed — where does it fit, and what has to be true for it to strengthen the
tree rather than dilute it? Second, SignalGrid already ships its own read-only MCP
server (`artifacts/mcp-server/`, DR-008): can it be offered on the owner's creator page
without overstating what it is?

**What was established, by use.** The public MCP directories and vendor documentation
were read on 2026-09-02. The creator/deploy side of MCP Market
(`app.mcpmarket.com/dan-fashauer/mcp/new`) is authentication-walled and was not
enumerated; only the public directory and vendor docs were. The finding: the ecosystem
is not a new signal SOURCE for SignalGrid — the systems of record already named in
`docs/SIGNAL_SOURCE_CATALOG.md` are, and no MCP server substitutes for their
credentials. What the ecosystem adds is a way to make source-independence CONCRETE:
for each externally-sourced connector family, there is (or is provably not) a
third-party MCP server that exposes that system's signals. That mapping is exactly the
DR-027 `public-apis` pattern one layer up — a candidate read-only transport, not a
system of record.

**Call: absorbed on two tracks, both documentation-only.**

1. **A fixture-first source-independence map** at
   `docs/research/MCP_ECOSYSTEM_SIGNAL_SOURCES.md`: for each ecosystem-mapped family,
   the MCP servers in the wider ecosystem that expose that system's signals, grouped by
   external product category (identity/SSO/IAM, EDR/endpoint, SIEM, ITSM, network,
   physical access, UEM, vulnerability scanning, observability), with the three
   categories that have no widely-adopted MCP server named as explicit gaps rather than
   omitted. Every row makes one claim only: SignalGrid ingests the vendor-neutral signal
   these produce and decides on top of it; it does not replace the producing system.
2. **A public-safe marketplace listing** at `docs/SIGNALGRID_MCP_MARKET_LISTING.md`:
   the copy the owner can paste into his creator page to offer SignalGrid's existing
   read-only MCP server. It describes the real tool surface — the set drift-gated by
   `scripts/check-mcp-surface.mjs`, never a hand-counted number — over stdio, configured
   by environment only, and it states the honest boundary: a fixture-backed
   deterministic decision core, a public-safe prototype, not a production or certified
   service.

**Rationale.** Source-independence is the thesis PURPOSE.md and DR-020 already state;
until now it was prose. The map turns it into something a buyer can check, and the
machine gate keeps it from rotting. The listing is a distribution channel for a surface
that already exists — no new product, no new claim — and offering it is the owner's own
directive answered with an artifact rather than a memo (DR-021, the absorption rule).

**Boundary.** No live external MCP server is wired into this repository. Wiring one
would send data to an external service and needs the owner's explicit go-ahead, behind
tier + `SIGNALGRID_LIVE_INTEGRATIONS` + a configured opt-in and the ungated-fetch gate,
as every connector already is (golden rule 2; the DR-027 fixture-first rule). This
record adds documentation, one machine gate
(`scripts/check-mcp-ecosystem-map.mjs`, in preflight and CI, self-tested both
directions) and its index and intake lines — no code in a decision path, no dependency,
no connector family, no partnership or certification claim.

**Evidence.** The two documents named above; the gate and its `--self-test`; the tool
surface parsed from `artifacts/mcp-server/src/index.ts` and held by
`scripts/check-mcp-surface.mjs`; the live-lab families cited in the map
(`docs/KEYCLOAK_LIVE_INTEGRATION.md`, `docs/FLEET_LIVE_INTEGRATION.md`); the family set
derived from `lib/integrations/src/integrations/` on 2026-09-02.

**Reversal.** The owner reverses by saying so: delete the two documents, this record,
the gate and its preflight/CI registration, the intake row and the index lines. Nothing
in the product depends on any of it, by construction.

## DR-029 — OmniRoute is adopted as the org's agent/build AI-gateway (the model-access layer for the coding lanes), by reference and keys-out-of-tree; it may NEVER enter the decision path (owner-directed 2026-09-04)

**Question.** The owner's directive, in substance: *"add [OmniRoute] as part of the
stack for tools to building and completing the project … used across all lanes and all
layers within the repo and org."* Two questions fall out of it. What is OmniRoute, by
use? And where does an AI gateway fit a product whose decision core is deterministic,
offline and fixture-backed — such that it strengthens how the project is BUILT without
touching what the product DECIDES?

**What was established, by use.** `github.com/diegosouzapw/OmniRoute` was read on
2026-09-04 (README + feature surface; MIT). It is a self-hosted **AI gateway**: one
OpenAI-compatible endpoint in front of ~352 upstream providers / 1200+ models, with
routing strategies (priority, round-robin, cost-optimised, fusion, pipeline…), free-tier
token aggregation, token-compression engines, three-layer resilience (circuit breakers,
cooldowns, model lockout), and its own MCP server (110 tools) plus an A2A agent protocol.
Node 18+/Docker/Bun; optional Redis. It **requires upstream provider API keys or OAuth**
and forwards requests to the selected provider. Its stated purpose is "never stop
coding" — keep an agent working across provider rate limits and outages. So by use it is
**agent/build infrastructure**: the model-ACCESS layer the coding lanes and org agents
run on. It is not a signal source (it connects to no system of record SignalGrid
decides on), not a connector family, and not a decision component.

**Call: adopted as the org's agent/build AI-gateway, by reference.** OmniRoute is the
sanctioned model-access layer for the SignalGrid coding lanes (cloud + Mac) and the
org's agents: a lane routes its model traffic through the gateway (one endpoint, provider
fallback, free-tier aggregation) so work does not stall on a single provider's limit or
outage. Adopted **by reference** — self-hosted from upstream, MIT — not vendored into
this repository and not added as a package dependency. `docs/AGENT_GATEWAY.md` is the
adoption record: what it is, how a lane points at it, and the boundary below.

**Boundary — this is the load-bearing half.** OmniRoute lives ENTIRELY on the build/agent
side and may never reach the product:

- **Never in the decision path.** Golden rule 2: the decision core is deterministic,
  offline and fixture-backed — no `Date.now()`/`Math.random()`, and an unknown signal
  tightens, never loosens. An AI gateway is nondeterministic model routing by design, so
  nothing under `lib/*`, `artifacts/api-server`'s `/v1` decision path, a connector, or a
  proof may call it, import it, or depend on it. It decides nothing; it only carries the
  BUILDERS' model traffic.
- **Keys out of the tree.** Provider keys/OAuth are owner secrets — environment-only,
  never committed, exactly as every connector credential already is.
- **Runtime adoption is owner infra.** Actually routing all lanes through it needs the
  owner to self-host the gateway and provision provider keys; a lane's model endpoint is
  set by its environment, not by this repository, so the repo can ratify and document the
  adoption but cannot itself provision it.
- **No claim moves.** Adopting a build tool asserts nothing about the product; no
  production/certification/partnership claim, no new capability, no launch-profile change.

**Rationale.** "Tools to building and completing the project" is exactly the build/agent
layer, and provider fallback + free-tier aggregation is what keeps two always-on coding
lanes from stalling. MIT and self-hosted means no lock-in and no data leaving the owner's
own infrastructure by default. Adopting by reference keeps the gateway's own dependencies
and its 352-provider surface OUT of this repo's supply chain — the repo gains the tool
without carrying its blast radius. And the boundary is what lets "use it everywhere the
org builds" be true without contradicting the one thing that makes SignalGrid itself
trustworthy: its decisions are deterministic and do not depend on any model.

**Evidence.** The OmniRoute README/feature surface read on 2026-09-04; `docs/AGENT_GATEWAY.md`;
the intake row in `docs/agent/RESOURCE_INTAKE.md`. No code, no dependency, no connector
family, no proof, no gate — a build tool adopted by reference changes none of those.

**Reversal.** The owner reverses by saying so: delete `docs/AGENT_GATEWAY.md`, this
record, the intake row and the index line. Nothing in the product depends on any of it,
by construction — the boundary above guarantees it.

## DR-030 — The repository's operating plane (its first-party skills, agents and slash-command skills) is packaged as a Claude Code plugin named `signalgrid`, with a single source of truth and no hooks (owner-directed 2026-09-07)

**Context.** The owner shared the Claude Code plugins reference and directed: package
this repository as a plugin (chosen over "standing operating rule" and "file the
reference"). The repository already carries its whole operating plane under `.claude/` —
28 skills, 13 agents, 9 slash-command skills, and three hooks wired inline in
`.claude/settings.json`. A plugin is the unit Claude Code installs, versions and
distributes; packaging the plane as one lets it be carried to other checkouts and
sessions as a single named, versioned artifact.

**Call: a manifest at the repository root, pointing into the existing `.claude/`, is the
plugin.** `.claude-plugin/plugin.json` names the plugin `signalgrid` and declares its
components by path: `skills: "./.claude/skills/"`, `agents: [the 13 tracked agent files]`,
`commands: "./.claude/commands/"`. `claude plugin validate .` passes (exit 0; one benign
warning that a plugin root's CLAUDE.md is not loaded as plugin context — true and
intended, our CLAUDE.md is project context).

Why the root, and not a subdirectory: a plugin component path may not escape the plugin
root (`path escapes plugin directory`), so a plugin living under a subfolder could not
reference the real `.claude/` above it. The choice was **one source of truth** — the
plugin points at the live `.claude/` the repo already runs — over a second copy that
would drift. A bare `.claude-plugin/plugin.json` does not auto-activate: plugins load
only via a marketplace install, `--plugin-dir`/`--plugin-url`, an `@skills-dir` manifest,
or claude.ai sync. So adding the manifest changes nothing in this repo's own sessions; it
makes the repo INSTALLABLE as a plugin without altering current behavior.

**Boundary — the load-bearing halves.**

- **Hooks are excluded, deliberately.** The three hooks (`session-start`,
  `block-dangerous`, `verify-done`) stay in `.claude/settings.json` (project scope) and
  are NOT re-declared in the plugin. Declaring them twice would double-fire them in this
  repo — session-start twice, the Bash deny-list twice, verify-done twice. They are also
  repo-specific (pnpm, this repo's git discipline and gates), not portable. The plugin
  packages the reusable plane (skills + agents + commands); the hooks remain project
  infrastructure.
- **The agent list is gated against drift, not trusted.** The loader requires `agents` to
  be a list of file paths, not a directory, so the manifest carries a hand-list beside the
  directory that is the real source — exactly the "hand-list claimed derived" shape this
  repo has been bitten by. `scripts/check-plugin-manifest.mjs` (preflight + CI, self-tested
  both directions, mutation-proven) fails if the manifest's `agents` set is not exactly
  `git ls-files .claude/agents/*.md`, if any referenced path is missing, if `skills`/
  `commands` are empty, or — when the `claude` CLI is on PATH — if `claude plugin validate`
  does not exit 0. An empty derivation fails closed.
- **No claim moves, no code changes.** Packaging the operating plane asserts nothing about
  the product: no `lib/*`, `/v1`, connector, proof or decision-path change; no
  production/certification/partnership claim; no launch-profile change. Golden rule 2 is
  untouched — the decision core is exactly as deterministic and offline as before.

**Evidence.** The plugins reference read 2026-09-07 (filed at
`docs/reference/CLAUDE_CODE_PLUGINS.md`); `claude plugin validate .` exit 0 (CLI 2.1.263);
`.claude-plugin/plugin.json`; `scripts/check-plugin-manifest.mjs` (+ self-test) wired into
`scripts/preflight.mjs` and `.github/workflows/review-hub-ci.yml`, parity green; the intake
row in `docs/agent/RESOURCE_INTAKE.md`.

**Reversal.** Delete `.claude-plugin/`, `scripts/check-plugin-manifest.mjs`, its two
preflight and two CI lines, this record, the reference doc, the intake row and the index
lines. Nothing in the product depends on any of it — the boundary above guarantees it.

## DR-031 — `last30days` is the research-ops lane's last-30-days recency transport: report-only, non-deterministic, never in a decision path, live invocation owner-gated (owner-directed 2026-09-08)

**Context.** The owner shared [`mvanhorn/last30days-skill`](https://github.com/mvanhorn/last30days-skill)
and directed: *"Need to incorporate this repo into the layers and tech stack for this
project. This will help a lot I believe based on information I've provided in the past and
future."* `last30days` (v3.23.0, MIT) is an agent-led research skill: given a topic it
fans queries across 15+ recent-discussion sources (Reddit, X, YouTube, TikTok, Hacker
News, Polymarket, GitHub, arXiv, Techmeme, LinkedIn, Bluesky, StockTwits, Perplexity,
open-web search, …), clusters and ranks by live engagement, and synthesizes one dated
markdown brief of what has moved in the last ~30 days. It was read via its published repo
(`SKILL.md`/`CONFIGURATION.md`/`CONCEPTS.md`) on 2026-09-08 and deliberately **not** run:
a real invocation transmits the query to those third parties and can read local browser
cookies.

**Call: adopt it as the research/source-discovery lane's recency transport — the DR-022
(Firecrawl) / DR-027 (public-apis) slot — at the doctrine and routing level only.** It
answers "what changed about X lately," feeding the competitive briefs
(`docs/research/COMPETITIVE_*.md`, `MARKET_LANDSCAPE.md`) and discovery-conversation prep,
findings written under research-ops discipline (cite what resolves, prove absence first,
narrowest truthful verb). The disposition is recorded in
`docs/research/LAST30DAYS_RESEARCH_TOOL.md`, routed in the evidence-toolchain skill, and
logged in `docs/agent/RESOURCE_INTAKE.md`. **No code, no dependency, no MCP install, no new
skill, no gate** — the same documentation-first shape public-apis (DR-027) took, and unlike
Firecrawl (DR-022) nothing is even installed key-gated yet.

**Boundary — the load-bearing halves.**

- **It is the inverse of the decision core, and the two never mix.** `last30days` is
  non-deterministic, clock-dependent (a rolling window) and network-dependent; the core is
  deterministic, offline, fixture-backed. Golden rule 2 holds in full: nothing in `lib/*`,
  `/v1`, a connector, or a `proof:*` may call it or read its output, its brief can never
  become a fixture or evidence-of-record, and "do not use a tool result as a verdict unless
  the deterministic core computed it" applies. Fail-closed also governs the *reading*: the
  tool degrades silently when a source is unreachable, so a thin brief is read as *unknown*,
  never as "nothing is happening."
- **Live use is owner-gated; nothing identifying leaves the tree.** A run egresses to 15+
  services and can read browser cookies, so it is deferred behind the owner's explicit yes
  **and** `SIGNALGRID_LIVE_INTEGRATIONS=true` **and** a configured opt-in scanned by
  `scripts/check-ungated-fetch.mjs` — "keyless for Reddit/HN" is not "no opt-in needed." No
  PHI/PII/tenant id/customer-name-as-fact/device address/worker coordinate is ever sent; a
  target company is named only as a research candidate, never as a customer or partner
  (publication boundary).
- **Building is not claiming.** Adopting internal research tooling asserts nothing about the
  product: never a SignalGrid feature, launch surface, or on-device capability; the
  launch-claims gate (`scripts/check-launch-claims.mjs`) still governs what may be said to
  ship.

**Evidence.** The skill read 2026-09-08 (repo above; not cloned or executed);
`docs/research/LAST30DAYS_RESEARCH_TOOL.md`; the routing subsection in
`.claude/skills/signalgrid-evidence-toolchain/SKILL.md`; the intake row in
`docs/agent/RESOURCE_INTAKE.md`; the index link in `docs/INDEX.md`.

**Reversal.** Delete `docs/research/LAST30DAYS_RESEARCH_TOOL.md`, this record, the intake
row, the evidence-toolchain subsection and the index link. Nothing in the product depends
on any of it — no code, dependency, gate or install was added, so there is nothing else to
undo.

## DR-032 — The Standing Brain Cycle: a daily cloud-fired orchestrator-over-blackboard that audits the real tree with the resource/agent lens panel and AUTO-OPENS (never auto-merges) the winner behind a validation gauntlet (owner-directed 2026-09-09)

**Decision.** Adopt a daily, cloud-fired **Standing Brain Cycle** (`brain-cycle`): a
Centralized-Orchestrator-over-Blackboard hybrid (the owner's "9 Architectures" graphic mapped
to Blackboard + Collaborative-Swarm fan-out + Centralized Orchestrator + a Pipeline gauntlet,
with Role-Based routing). It guarantees brain parity as its first fail-closed act
(`scripts/check-brain-freshness.mjs` — this lane's `.claude/` + `.mcp.json` +
`.claude-plugin/plugin.json` must match `origin/SignalGrid_Alpha` or it refuses), fans a
bounded touched-surface lens panel (the 13 agents + executable RESOURCE_INTAKE lenses) over
the real HEAD diff, lands their verdicts in a committed per-cycle blackboard
(`artifacts/brain-cycle/<sha>/`), deterministically picks the smallest route that clears its
panel (`scripts/brain-cycle-decide.mjs` — never a model verdict, golden rule 2), drives the
winner through the composed mechanical + adversarial gauntlet, and **auto-OPENs (never
auto-merges)** the winner as a draft PR. Full design: [`docs/agent/BRAIN_CYCLE_DESIGN.md`](agent/BRAIN_CYCLE_DESIGN.md).
Owner choices (2026-09-09, in-session): standing recurring cycle, **full autonomous tier**,
**daily** target, "auto but does x amount of security and code check validation for bugs and
other problems for the winner." It reuses `classifyDiff`, `lane-deliver`,
`check-scheduled-routines`, the agent panel, `preflight`/`verify:breadth` and mailbox PR #439
verbatim; the only new code is one freshness gate, one decision core, one orchestrator spine,
one config and one dormant registry row.

**Alternatives considered.** Pure Collaborative Swarm / Decentralized — rejected as the
dominant shape: no single fail-closed authority for the owner-gated merge boundary, and a
robot cannot merge changes to its own safety net (`check-owner-gated-surfaces.mjs`
SAFETY_MACHINERY). Its one-file-per-lens board + consensus floor are grafted in.
Orchestrator-first with candidate generation — its provenance-before-run, quoted-evidence
board, `review-coverage.json` router and the absent=HARD-NO planted-defect self-test are
grafted; candidate *generation* is deferred (Slice 1 audits HEAD only). A fingerprint-cached
two-lane cycle — its cost cache and Mac-only-as-draft reconciliation are grafted (Slice 2).

**Consequences.** A standing, evidence-first mechanism that can fix small autonomous-tier
defects and escalate everything else — without ever merging a change to its own safety net,
ever assuming the Mac is awake, or ever letting a model decide a verdict. The cycle's own
machinery is SAFETY_MACHINERY, so it can never self-merge its own improvements; every change
to it is an owner-reviewed PR, which deliberately paces the effort. Slice 1 ships the
machinery DORMANT (`status: awaiting-activation`); ACTIVATION (creating the account trigger
and flipping the row active) needs a further explicit owner go — no consent is inferred from
the build directive.

**Doctrine guardrails.** Fail-closed (golden rule 2): a stale/unverifiable brain refuses;
any absent / `ran:false` / UNVERIFIED expected lens is a HARD NO in the orchestrator's own
logic (there is no gate that asserts a reviewer ran, so a planted-defect self-test proves the
arm both directions); an unrecognised owner-gated shape escalates; no eligible candidate
opens nothing. Publication boundary (DR-021): the gauntlet includes
`check-publication-boundary.mjs` + `check-launch-claims.mjs`; buyer-facing surfaces are
OWNER_RESERVED. **Dan decides:** auto-OPEN (draft) is the shipped ceiling; auto-MERGE sits
behind an explicit owner GREEN switch (`docs/agent/brain-cycle-config.json`, default false)
and is not used in Slice 1. No behaviour edits to `DecisionEngine.swift` / `AppWorkflows.swift`
(golden rule 1): audited read-only; any finding there routes around them or escalates.

**Evidence.** `scripts/check-brain-freshness.mjs` (+ `--self-test`, 5 cases),
`scripts/brain-cycle-decide.mjs` (+ `--self-test`, 17 scenarios / 19 assertions),
`scripts/brain-cycle.mjs` (+ `--self-test`, 7 assertions incl. missing/empty/unparsable-manifest
fail-closed), all wired into `scripts/preflight.mjs` and
`.github/workflows/review-hub-ci.yml` (parity gates green); the `brain-cycle` row in
`docs/agent/scheduled-routines.json` (awaiting-activation, `check-scheduled-routines.mjs`
green); `docs/agent/brain-cycle-config.json`; the design doc above; the intake row in
`docs/agent/RESOURCE_INTAKE.md`. Design produced by a 13-agent design workflow (4 approaches,
4 judges, 1 synthesis) on 2026-09-09.

**Hardening (2026-09-10).** Before opening the Slice 1 PR the decision path was run through an
adversarial review (a `fail-closed-auditor` pass and an independent correctness read). Seven
real defects were fixed and each got a planted-defect self-test arm: (1, CRITICAL) a
missing/unparsable/empty `_manifest.json` made `expected` silently `[]`, so the "a reviewer that
did not run = NO" loop iterated nothing and a winner shipped on a vacuous trust anchor —
`readBoard` now fails closed (throws) on a bad manifest and `decide()` independently HARD-NOs an
empty expected set and asserts every veto lens is named in it; (2) a fileless route classified as
`autonomous` and became auto-pickable — no files ⇒ escalate; (3) a lens record omitting `ran`
read as run — now requires `ran === true`; (4) `byName` last-write-wins could hide a `ran:false`
lane behind a `ran:true` one of the same name — every record per name is now checked; (5) the
`warnings` ranking key was dead (`counts()` admits only CONFIRMED, so a WARNING was never tallied)
— WARNING findings are counted in a separate pass; (6) a winner and a separate escalation could
coexist but the exit code dropped the escalation — added exit 40 and made `decision.json`
authoritative; (7) a swallowed `decision.json` write failure could report exit 0 without persisting
— now fatal. The two exploit variants (no manifest + no veto lens on the board; valid manifest but
veto lens absent) were reproduced against the real CLI and both now refuse (exit 1 / HARD NO,
no winner). Both reviewers independently confirmed `check-brain-freshness.mjs` and the
`check-owner-gated-surfaces.mjs` import guard SOLID.

A SECOND adversarial pass (2026-09-10, three lenses — fail-closed, correctness, security — on the
HARDENED code before the PR opened) found one more real fail-open the first pass missed, and all
three lenses reproduced it independently: the veto set was read from `config.vetoLenses` but never
anchored to the real safety lenses, so a config of `{vetoLenses:[]}` or `{vetoLenses:["code-reviewer"]}`
silently disabled `vetoedRoute()` and let a route win past a live security/fail-closed BLOCK, while
`{vetoLenses:undefined}` (a config that omits the key) crashed instead of failing closed — and
`docs/agent/brain-cycle-config.json` classified as `autonomous`, so the cycle could edit its own veto
net with no owner gate. Fixed three ways: (a) `MANDATORY_VETO_LENSES` (security-reviewer,
fail-closed-auditor) is now a frozen floor — `decide()` unions it over any config, so config may only
WIDEN the veto set, never shrink/blank/retarget it, and a non-finite `minConfidence` falls back to the
default; (b) `brain-cycle.mjs` `loadConfig()` passes through only validly-typed keys so a partial config
cannot override the defaults with `undefined`; (c) `docs/agent/brain-cycle-config.json` is added to
SAFETY_MACHINERY in `check-owner-gated-surfaces.mjs` (a robot cannot merge its own safety net). Three
new self-test arms (config `{vetoLenses:[]}` + a security BLOCK → no winner; config
`{vetoLenses:["code-reviewer"]}` + a fail-closed BLOCK → no winner; partial/undefined config → floor
applied, no crash) plus a new owner-gated self-test arm; all three exploit shapes reproduced against the
real `decide()` and confirmed closed. The freshness gate and the import guard were re-confirmed SOLID.

**Reversal.** Delete the five new files (freshness gate, decision core, spine, config, design
doc), remove the `brain-cycle` registry row, unwire the three self-tests from preflight + CI,
revert the one-line `check-owner-gated-surfaces.mjs` import guard and this record. No account
trigger was created and the row is dormant, so nothing runs to stop; nothing in the product
depends on any of it.
## DR-033 — The company is past Customer Discovery; the current phase is Build / execution, and a phase change is a decision record before either lane acts on it (owner-directed 2026-09-10)

**Question.** The operating phase changed but the change was never written down. The
owner directed that the company is no longer in "Customer Discovery," yet every
recorded surface still asserted it: `docs/agent/DISCOVERY_LOG.md` ("State: Customer
Discovery", "Experiment started: 2026-08-27"), `scripts/loop-state.mjs` (a red,
non-passing row — "N days since the freeze and 0 conversations. Nothing else on this
list matters."), `docs/agent/LOOP.md` ("PHASE: Build + Customer Discovery in
parallel"), and `CLAUDE.md` ("The only number that moves the company is discovery
conversations… Code work never substitutes for it"). Both lanes therefore kept
running the stale written phase for days, which cost real time and eroded trust in
what the repo asserts. The change was searched for on every recorded channel (git
history past DR-021, DECISION_RECORDS through DR-032, `check:absence`, the mailbox,
neural memory) and was recorded NOWHERE.

**The directive.** On 2026-09-10 the owner directed that the company is past Customer
Discovery — relayed through the Mac lane and then confirmed by the owner directly in the
cloud session. In that same exchange the owner also named the current sub-phase: build
an actually-working, solid CORE PRODUCT that does what it claims, and have something
real in hand to bring to partners/collaborators BEFORE go-to-market/execution. Both the
correction and this sub-phase are authoritative because the owner confirmed the wording
directly; a peer relay alone would not have been enough to record it.

**The call.**

1. **Customer Discovery is no longer the operating phase.** The current phase is
   **Build / execution** — engineering-led, toward launch. This is not a new
   direction: DR-021 (2026-08-31) already lifted the engineering freeze in full and
   put the repo in absorption/build mode; the discovery surfaces contradicted the
   *most recent* recorded decision, and this record resolves that contradiction in
   favor of DR-021.
2. **Discovery is an input, not the gate.** Discovery evidence still matters and the
   log stays. But it is no longer THE gating metric, and the loop-state "nothing else
   matters" red alarm is retired to a neutral, non-fatal report. A day with zero
   discovery conversations is no longer a failing loop.
3. **The named sub-phase: a real core product first, partners before GTM.** Within
   Build / execution the owner set the near-term objective (2026-09-10): make the CORE
   PRODUCT actually work and do what it claims — something solid and real — and take
   that to partners/collaborators BEFORE go-to-market/execution. Building the working
   product is the current job; pilots, revenue and launch timing come after there is
   something real in hand. This states the *object* of the phase; it is not a claim
   that anything ships (claim discipline in item 4 is unchanged).
4. **Claim discipline is unchanged** (DR-021 §2): the launch-claims gate, the
   launch-profile classification, the publication boundary, and the no-overclaim rules
   still govern what may be *said* to ship. Building and claiming remain two acts.
5. **Process rule (the actual failure this record fixes).** A phase or doctrine change
   is a decision record on `SignalGrid_Alpha` *before* either lane acts on it. A change
   said aloud but unrecorded is not a change the repo or the gates can honor — that is
   how this drift happened, and the fix is not a one-time cleanup but this standing rule.

**Consequences / surface reconciliation.** The stale assertions in
`docs/agent/DISCOVERY_LOG.md`, `scripts/loop-state.mjs` (the red discovery alarm →
neutral report), `docs/agent/LOOP.md` (PHASE), and `CLAUDE.md` (the "only number"
line) are brought into line with this record **in this same PR** — the cloud lane
carries the record and its surface reconciliation together, so the Mac lane pulls one
consistent mainline and aligns to it rather than reconciling a divergent copy. These
are corrections of a stale internal phase label only, not go-to-market claims.

**Reversal / amendment.** If the owner names a different phase, amend items 1–3 in
place (keep the record and its history — do not delete it). Nothing in the product
decision core depends on this record; it governs the operating loop and the doctrine
docs only.


## DR-034 — The research basis is the founder's own domain practice, not customer engagement; the owner's Google Drive "Project › SignalGrid" folder is the canonical corpus of the problems dealt with and the ideas for the solution (owner-directed 2026-09-10)

**Question.** DR-033 corrected the operating phase. It did not record *why* the
"Customer Discovery" framing was wrong to begin with, and nothing in the tree said where
the founding research lives. The owner's inputs — runbooks, catalogs, a disclosure,
reviews, infographics — had been read by the lanes as customer-engagement material to be
validated by external conversations, when they are the research itself: the record of a
problem the founder operates against every working day.

**The directive.** The owner, 2026-09-10, Mac lane session, in his own words:
*"maybe you confused with customer engagement and everything else with the info I been
feeding you is not customer engagement its research information from what I do for my
everyday job and this is reason why I've decided to build this company and product. I want
to make sure that the Google Drive is the data source of what i've had to deal with and
ideas for building this solution."* The same day's directive on the object of the phase —
a working core product, real in hand for partners before go-to-market — is already
recorded as DR-033 item 3 and is not repeated here.

**Grounding — what was actually read (measured 2026-09-10).** The Mac lane read the Drive
folder directly. It holds: the five operational runbooks of a large hospital system's
shared clinical-device program (L1 and L2 support, iOS device prep, iOS update, macOS
setup — the owner's own working documents, exported 2026-09-04), which are the runbooks
[`docs/research/SHARED_DEVICE_CUSTODY_GROUND_TRUTH.md`](research/SHARED_DEVICE_CUSTODY_GROUND_TRUTH.md)
absorbed on 2026-09-04; the confidential invention disclosure record (2026-07-25),
already pointed to — content deliberately not reproduced — in
[`docs/research/IP_AND_LICENSING.md`](research/IP_AND_LICENSING.md); the Technology
Ecosystem Master Catalog workbook, absorbed as ledger row 28 and
[`docs/inspiration/TECHNOLOGY_ECOSYSTEM_MASTER_CATALOG.md`](inspiration/TECHNOLOGY_ECOSYSTEM_MASTER_CATALOG.md);
three API-catalog bundles, absorbed as
[`docs/inspiration/CONTROLUP_DEX_EUC_API_CATALOG.md`](inspiration/CONTROLUP_DEX_EUC_API_CATALOG.md)
and its sibling catalogs; a pre-launch second-opinion review (v0.1, cover dated May) whose
Priority-3 recommendation was to hold five customer-discovery conversations; two Gartner
Peer Insights review exports (endpoint management; identity governance, 2026); the
positioning carousel and two product videos; and roughly sixty saved screenshots and
infographics, of which two were sampled (a third-party software-asset-management process
diagram; a job-interview tips card) — reference material of mixed relevance, absorbed
case-by-case as the ledger already does. Measured with `grep` across `docs/`: no document
named the Drive as the source store, and the second-opinion review, the Gartner exports,
the carousel and the videos had no ledger row. Everything else was already in the tree.

**The call.**

1. **The research basis of SignalGrid is the founder's own domain practice** — running a
   shared clinical-device program in enterprise mobility, day to day — and the documents
   that practice produces. This is founder-domain evidence. It is not customer
   engagement, and it does not wait on external validation before it counts.
2. **The owner's Google Drive folder "Project › SignalGrid" is the canonical corpus** of
   (a) the problems dealt with and (b) the ideas for the solution. The repository
   absorbs from it by use (DR-021) and points back to it; it does not replace it.
   Confidential items — the invention disclosure, employer-identifying runbooks — are
   referenced by name and date only and are never committed. The publication boundary is
   unchanged; the generalization the ground-truth map already applies (no employer,
   site, personnel, group or address specifics) is the rule for every Drive-derived line.
3. **The misclassification, named so it is not repeated.** "Customer Discovery" as a
   gate treated this research as engagement to be validated by fifteen external
   conversations. The framing was recommended by the second-opinion review and later
   institutionalized in DR-021 §6; DR-033 retired the gate. The standing rule from here:
   **an owner-supplied document is research to absorb — a ledger or intake row — never a
   conversation to schedule.**
4. **Partner and collaborator conversations follow a working core product** (DR-033
   item 3). They are how the product is taken to market, not how the research is
   validated.
5. **Surface reconciliation, in this same change:**
   [`.claude/skills/research-ops/SKILL.md`](../.claude/skills/research-ops/SKILL.md)
   (its "only moving number" doctrine → the DR-033/034 framing);
   [`docs/INTAKE_LEDGER.md`](INTAKE_LEDGER.md) row 98 for the corpus items that had no
   row; [`docs/agent/RESOURCE_INTAKE.md`](agent/RESOURCE_INTAKE.md) row for this intake;
   and [`docs/research/SHARED_DEVICE_CUSTODY_GROUND_TRUTH.md`](research/SHARED_DEVICE_CUSTODY_GROUND_TRUTH.md)
   naming the Drive folder as its source store.

**What does not change.** Claim discipline (DR-021 §2, DR-033 item 4). The discovery log
stays as an input. Nothing in the decision core depends on this record.

**Reversal / amendment.** The owner reverses by saying so; amend items 1–4 in place and
keep the record and its history. If a Drive item is later shown not to be the owner's own
material, its ledger row is corrected — not this record.


## DR-035 — Source-agnostic is the point: SignalGrid is the company's orchestration layer over every system it already runs, and vendor lock is the condition it exists to remove (owner-directed 2026-09-10)

**Question.** `docs/PURPOSE.md` §2 is canonical (DR-020) and says the grid "connects the
systems a building already runs … into one grid that decides and acts." It does not say
the word *agnostic*, does not name vendor lock, and does not say what happens when a
customer replaces a system underneath. Two lanes have drifted on exactly those silences —
toward "a gate," and toward a single-vendor frame — and the owner corrected both in one
evening. The silence is the defect.

**The directive.** The owner, 2026-09-10, in his own words: *"this product is all about
source agnostic — that's the beauty of the product and solution. It embodies all these
complex systems that are already complicated enough to manage … an overall system layer
that sits on top of everything and makes a decision based on the workflow you told the
system to do — if you do X this happens, and if Y is not here or there then route to X
or Y and then solve or deny and pass — very simple, but essentially a smart-home-like
solution for all layers of the company that can be automated and controlled if it has an
API or SDK … if they choose to migrate to a different platform the system will allow the
new system to take over the automations and workflows — just validate the API changes for
that system and done."* And, later the same night: *"The vendor lock is completely the
opposite of what this system is made to become — it's the reason I'm building it — as
master smart automated orchestration system for the entire company."*

**Grounding — measured.** `grep -iE "agnostic|vendor lock|migrat"` over `docs/PURPOSE.md`
returns nothing. The §2 product sentence is mirrored verbatim in four other documents
(`docs/POSITIONING.md`, `docs/SIGNAL_SOURCE_CATALOG.md`,
`docs/OPERATIONAL_HEALTH_DEX_LAYER_STRATEGY.md`, `docs/HASH_CHAIN_TAIL_ARTICLE.md`), so
this record ADDS to §2 and to the forbids list rather than rewriting the sentence; widening
"a building" to "the company" in the sentence itself is a follow-up that touches
`POSITIONING.md` (owner-reserved) on purpose. The mechanism the owner describes for
migration already exists: the shared posture-report contract and the `proof:live-*` lanes
re-validate a source against the same contract, and the connector families are the
source-agnostic seam. `docs/PURPOSE.md` already forbids probabilistic scoring as the
authoritative decision; this record cites that rule rather than restating it.

**The call.**

1. **Scope.** The building is the first scope, not the boundary. The same grid spans every
   system the company runs that exposes an API or SDK — for the devices staff use, the
   admins who run those systems, and the workflows between them. **[Amended 2026-09-10 by DR-036:
   a company is many sites and buildings; the grid spans all of them, and a site is
   configuration, not a separate product.]**
2. **Source-agnostic is the point.** Any system with an API or SDK is a candidate signal
   source; none is a dependency. Vendor lock — in either direction — is the condition
   SignalGrid exists to remove, and a design that requires one vendor underneath is a
   defect against this record.
3. **Declared workflows decide.** The owner's "if X this happens; if Y is not here, route
   to X or Y; solve, or deny" is the product's decision shape: declared, versioned,
   deterministic, auditable. That is why an admin can trust it and an auditor can prove it.
4. **Migration is contract re-validation.** Replacing a system underneath means validating
   the new system's API against the same contract and letting it take over the same
   workflows — the posture contract and the live lanes are that check; extend them, never
   fork the workflow per vendor.
5. **Learning proposes; it never decides.** "Learn from itself so it can make these
   choices easier" lives in the build loop and the recommendation surfaces: propose new
   routes, connectors and rules from real signals and real failures, for a human to
   approve. The authoritative decision stays deterministic (PURPOSE.md, "What this doctrine
   forbids"; DR-029; golden rule 2).
6. **Surfaces reconciled in this change:** `docs/PURPOSE.md` §2 gains the subsection "The
   system underneath is replaceable"; "What this doctrine forbids" gains the vendor-lock
   line. The §2 sentence and its four mirrors are unchanged.

**What does not change.** Claim discipline (DR-021 §2, DR-033 item 4): this is doctrine
about what the product IS, not a claim about what ships or integrates today. The verdict
enum, the determinism invariant, and the Decision Envelope are untouched.

**Reversal / amendment.** The owner reverses by saying so; amend items 1–5 in place and
keep the record. If the §2 sentence is later widened to "the company," that is a
follow-up record that names the mirrors it changes.


## DR-036 — The agentic operating model, the readiness figure that gates outreach (floor 80 / target 92–95 / goal 100), and multi-site scope (owner-directed 2026-09-10)

**Question.** DR-033 set the object of the phase — a working core product before go-to-market —
without saying what "working" means or who decides it, and the operating model the owner has
been building (lanes that research, plan, execute and monitor) was described in chat, never in
a record. A bar nobody can measure is a feeling; this repository's discipline is that numbers
come from output.

**The directive.** The owner, 2026-09-10, in his own words, with the "Agentic AI (goal-driven,
multi-agent system)" picture attached: *"This is the end goal for what I need you to be and
become successful to build the product from all sides period and everything else we've
discussed already. Then once everything is completed and confirmed that this solution works
80% or higher then I'll start the outreach — I don't want to burn contacts or sources when I
don't have a valid and effective solution that's working. I mean the goal is 100% working but
stretch is 80 then target is 92–95%."* Asked which definition of "working" should gate
outreach: *"Why not all?"* And: *"a company can have multiple location/buildings within the
company itself."*

**Grounding — measured 2026-09-10 by `node scripts/check-readiness-figure.mjs`.**
(a) runbook ground truth 78% — 11 modeled / 3 partial / 0 gap of 14 real-world
elements in `docs/research/SHARED_DEVICE_CUSTODY_GROUND_TRUTH.md`; (b) launch surface,
evidence-bound 100% — green on both halves, 1 day(s) old; launch 23 · deferred 134;
(c) end-to-end 62% — scenarios 11/11, live operations proven 5/8
(unproven: live-keycloak, live-location, live-edr). Headline **62%** — OUTREACH CLOSED — readiness 62% is below the 80% floor. Launch items map to proof
names 3 of 23 (they are routes, packages and families), which is why (b) is evidence-bound
rather than an invented per-item ratio.

**The call.**

1. **The operating model, named.** The lanes are the orchestrator in the owner's picture, built
   from parts the repo already has: *research* = the research-ops skill, the owner's Drive
   corpus (DR-034) and the live lanes; *planning* = the planning skills, the backlog and the
   brain cycle's candidate selection; *execution* = the two lanes, the self-hosted Mac runner
   and the sim-request loop; *monitoring* = the gates, `loop:state`, the heartbeats, the
   nightly runner and this readiness figure; *memory* = neural memory (DR-026) and the file
   memory; *self-correction* = `FALSE_CLAIMS.json`, decision records and mutation-proven
   gates; *orchestrator* = the Standing Brain Cycle (DR-032) under the owner's decisions —
   auto-merge stays behind the owner's GREEN switch. The gap this record closes: the
   monitoring role had no single number for the goal.
2. **The readiness figure is derived, never typed.** `scripts/check-readiness-figure.mjs`
   computes three dimensions — (a) runbook ground truth, (b) launch surface evidence-bound,
   (c) end-to-end scenarios and live operations — and the headline is the LOWEST of the
   three, so no single easy dimension can carry the product. `loop:state` prints it every
   session; preflight and CI run it as a REPORT (a low number is information; only a broken
   derivation is fatal). Dimension (b) is binary until launch items carry explicit proof
   bindings — a named follow-up; stale evidence (older than 7 days) reads as 0%, which
   closes outreach until a real Mac run refreshes it.
3. **The bar.** Outreach opens at a headline of 80% (floor), the target is 92–95%, the goal
   100%. Below the floor no contact or source is spent on the product; the second-opinion
   review's activation recommendations stay retired until the bar is met. Discovery evidence
   remains an input (DR-033).
4. **Multi-site scope.** A company is many sites and buildings; the grid spans all of them,
   and a site is configuration, not a separate product — amends DR-035 item 1 in place and
   the PURPOSE.md §2 subsection.
5. **Surfaces reconciled in this change:** `scripts/check-readiness-figure.mjs` (new, with
   `scripts/src/readiness-scenarios.ts`), `scripts/loop-state.mjs` (the row),
   `scripts/preflight.mjs` and `.github/workflows/review-hub-ci.yml` (self-test + REPORT),
   `docs/PURPOSE.md` §2 (multi-site line), `CLAUDE.md` (scope line), and DR-035 item 1.

**What does not change.** Claim discipline (DR-021 §2, DR-033 item 4) — the figure is an
internal readiness measure, never a buyer-facing claim. The decision core stays
deterministic; learning proposes (DR-035 item 5).

**Reversal / amendment.** The owner reverses by saying so; amend the thresholds in
`scripts/check-readiness-figure.mjs` and this record together. A dimension may be added or
its derivation tightened by a later record that names what changed and why.

## DR-037 — The cloud lane merges its own green product PRs; the owner is no longer the merge button (owner-directed 2026-09-12)

**Decision.** From 2026-09-12 the cloud lane **merges product pull requests itself** once
they are green, instead of parking them for the owner. The owner set this in chat on
2026-09-12, after six green PRs had queued on him overnight and the lane explained that
DR-032's "lanes open, owner merges" rule was the only thing holding them: asked whether
the lane should merge them itself, he answered *"Yes I didn't want that and that was my
mistake I didn't want that on me."* This record carries that answer; the lane wrote it,
the owner decided it.

**What "green" means here — every condition, none inferred.** A product PR is
mergeable by the lane only when all of the following hold on its CURRENT head:

1. The gating check "Typecheck, build, and proof scaffold" has **passed** on that head
   (a `check_suite.completed` event alone is not it; the lane reads the check run).
2. `node scripts/preflight.mjs` and `pnpm run verify:breadth` passed **locally on the
   branch** before the push that produced the head, with output quoted in the PR body
   or `docs/agent/EVIDENCE.md` — CI green is necessary, not sufficient (CLAUDE.md,
   "Before you push").
3. Every review thread is resolved and every bot finding was verified against the
   source and either fixed or answered with the reason; the lane never resolves a
   human reviewer's thread it did not address.
4. The PR is not conflicted with `SignalGrid_Alpha`; a conflict is merged in and
   regenerated files are regenerated with the repo's tooling, never by hand.
5. The lane **never approves** a PR (approval is a human act and the harness keeps
   refusing self-approval), and it never merges a PR it did not open or was not asked to
   drive for its author, except the Mac lane's landing PRs when the Mac has asked for
   that in mail (as #653 did).

**What stays owner-gated.** `check-owner-gated-surfaces.mjs` still classifies
`scripts/**`, `.github/workflows/**`, `lib/**/fixtures/**`, the brain-cycle veto config
and the owner-reserved rules as SAFETY_MACHINERY / OWNER_RESERVED. This record changes
who presses merge, not what the classifier says: the lane may merge a SAFETY_MACHINERY
PR only when the five conditions above hold, and it must say so in the PR body under
"Owner decision needed" as *"merged under DR-037"* with the check-run id. It still does
not: edit `AGENTS.md` or a decision record on its own authority (a DR records an owner
decision, as this one does); activate the Standing Brain Cycle (DR-032's activation clause
is untouched — the cycle still auto-OPENS and never auto-merges); merge anything that
changes the launch profile, the launch-claims gate or the publication boundary (DR-021 §2
— those remain the owner's); or delete branches.

**Consequences.** The owner's queue becomes review-when-he-wants, not merge-or-nothing:
six green PRs (#656, #657, #653, #649, #654 and the lane-mail #655) sat for hours on
2026-09-11/12 while the lane could only re-sync them each time a delivery moved the
coverage page. The lane now lands them in order, regenerating the sync manifest on top of
the previous landing (DR-036's readiness figure reads (b)=0 until the Mac re-mints against
the final manifest — by design, unchanged). Every merge is still recorded: the PR body,
the EVIDENCE entry, the LOOP STATE line and the steward heartbeat name the merged sha.

**Alternatives considered.** Keep DR-032's rule and ask the owner to merge in batches —
rejected by the owner ("I didn't want that on me"). Auto-merge on green via
`enable_pr_auto_merge` — unavailable on this repository (the API refuses it), and it
would merge on CI alone without condition 2. A per-PR allowlist the owner ticks —
another button on the owner.

**Reversal / amendment.** The owner reverses by saying so; the lane then reverts to
opening-only for product PRs from the next cycle, and this record stays with the
reversal date added. Narrowing (for example, "not `.github/workflows/**`") is an
amendment to the "What stays owner-gated" list, in place.

## DR-038 — Five owner-shared agent tools installed on the Mac lane and absorbed by use, each inside its boundary (owner-directed 2026-09-12)

**Decision.** The owner shared a five-item list — last30days, CLI-Anything, Claude-video,
Crucible, LightRAG — and said *"Please install all of these and add them where needed and
start using them now."* The Mac lane installs all five (plus Graphify, from the same night's
listicle, DR-038 covers it too) at **user scope on the Mac**, pinned where a pin exists,
hooks OFF, nothing written into this repository's `.claude/` or `CLAUDE.md`, every output
directory they can produce gitignored before first use, and no data leaving the machine
unless a later record says so. Each tool is used once on a real SignalGrid question the same
night and the measured result is the intake row (`docs/agent/RESOURCE_INTAKE.md`, rows dated
2026-09-12). The lane wrote this record; the owner decided it.

**Per tool — what was decided, from the five independent reads and the first uses.**

| Tool | Disposition | Boundary |
| --- | --- | --- |
| `last30days` 3.24.0 | Installed and run (was doctrine-only since DR-031). Keyless coverage today is Hacker News + GitHub; the first brief was thin and off-topic for a niche hospital query. | DR-031 stands: live runs owner-gated, cookies off, never `--publish-html`, never a save dir inside the tree. Source keys are the owner's to add. |
| CLI-Anything | Installed, no target: it wraps open-source GUI apps whose source it can read; SignalGrid's targets are closed and its own surfaces already have agent handles (`/v1`, MCP, Bruno). | Generation output gitignored (`agent-harness/`, `skills/cli-anything-*/`, state files). Never pointed at this tree. |
| Claude-video (`/watch`) | ffmpeg 9.0.1 + yt-dlp installed, marketplace added; the plugin install line is the owner's (classifier refused it for the agent). Fit: the missing video modality of the research transports. | Working dir is the system temp dir; audio transcribed locally unless a key is set; never `--out-dir` inside the tree. |
| Crucible (raddue) | Selective: only the adversarial half (quality-gate, red-team, inquisitor, adversarial-tester, temper, audit, shared/, four agents), via the pinned `pnpm run crucible:install` the owner runs. Its lifecycle half duplicates the vendored obra/superpowers set (two name collisions); excluded. | Hooks off (one is a blocking PreToolUse guard), consensus MCP excluded (third-party egress), build/checkpoint/compass/adr excluded (untracked writes into `docs/`, gitignored regardless). Lenses run report-only in a git worktree; a lens joins `brain-cycle-config.json` only after a measured run. |
| LightRAG 1.5.6 | Installed; runnable only once the owner installs Ollama (classifier refused). Shape: local chat + embedding models, store under `~/signalgrid-lightrag/`, bound to 127.0.0.1 with an API key. | DR-026: the store is a cache of the committed docs, never their source, never inside the tree. Golden rule 2 / DR-029: never a product component. Answers cite; grep confirms. |
| Graphify 0.9.58 | Installed and measured: structural graph of this tree (16,229 nodes / 29,512 edges / 677 communities, 3 s), skill at user scope only. Strong for symbol-level "who calls X"; blind to string-literal paths and cross-language twins. | `graphify-out/` gitignored; never `graphify install --project` (it would write into the repo's `.claude/` and `CLAUDE.md`). Optional local index, not a gate; semantic docs pass deferred. |

**Why this way.** The repository absorbs owner-shared material by use, never with a memo
(handoff rule; DR-021). Pins, user scope and hooks-off are the house pattern every prior
tool followed (DR-024 Ponytail, DR-026 neural-memory, DR-029 OmniRoute, DR-030). Output
directories are gitignored first because `provenance.workingTreeClean` on every sim result
reads untracked files as dirt (CLAUDE.md, "Simulation results — provenance is the product").

**What stays owner-run.** The Mac's auto-mode permission classifier refuses, for an agent,
plugin installs that write hooks or third-party binaries and any clone into the home
directory; three commands are therefore the owner's, listed in the intake rows and in
`package.json` (`claude-video:install`, `crucible:install`) plus `brew install ollama`. The
lane does not retry a refused install; it hands the line over.

**Consequences.** Six more tools on the Mac lane, each with an installer row in
`package.json` so a new machine reproduces the set; the readiness figure (DR-036) is
untouched by any of them — none enters `lib/*`, `/v1`, connectors or proofs.

**Reversal / amendment.** The owner reverses by saying so; `claude plugin uninstall`,
`uv tool uninstall`, and removing the symlinks undo each install without touching the
tree. Adding a tool's hook, giving it a key, or letting any of them into the decision path
is an amendment here, not a quiet change.

## DR-039 — The absorption bar is the founder's: anything with a part that can aid building the company is taken; only licence, auto-execution, egress without consent and directory collision exclude (owner-directed 2026-09-12)

**Context.** Seven evaluations of owner-shared skills collections (Matt Pocock's,
Addy Osmani's, Google's, NVIDIA's, K-Dense's, the VoltAgent index, a GitHub Trending
page) came back on 2026-09-12 with most candidates marked "evaluated, not adopted" on
grounds of overlap with an existing skill, thinness, or no current activity that would
use them — after the owner had already overruled two such verdicts the same hour
(DR-038). He then shared his résumé and corrected the posture directly:

> *"You need to probably stop and think of something real quick you need to understand
> I'm not asking you to check if they really worth anything if it has any part of the
> main core of this in any fashion that can aid in building all aspects of this
> company: brand: solution: apps: websites all of it and I mean everything. Please
> check yourself and readjust what you're looking at should be my assistant that thinks
> like me and should know my responses and knowledge."*

**Call.**

1. **The bar.** A resource the owner shares is ADOPTED if any part of it can aid
   building any aspect of the company — product, apps, websites, brand, docs,
   operations, the skills plane itself. The evaluator's question is no longer "is it
   worth it" but "which part, and in what form".
2. **The only exclusions**, each an existing hard line: (a) a licence that cannot be
   republished from this public MIT tree — none, NonCommercial, ShareAlike, proprietary
   — excludes the FILES, and the ideas still land in our own words with the source
   named; (b) auto-execution — hooks, run-time code fetches, HEAD-tracking installs —
   excludes the MECHANISM, and the skill is taken without it (DR-026, DR-030);
   (c) egress of owner data or repository source without the owner's own key decision —
   taken, with the egress stated in the wrapper and keys out of the tree (DR-029);
   (d) a directory collision under `.claude/skills/`.
3. **Overlap is recorded, never refused.** "Restates CLAUDE.md", "duplicates a vendored
   skill", "nothing uses it yet" and "thin" go in the intake row as facts.
4. **Contradictions get override rows.** An instruction that contradicts CLAUDE.md is
   recorded in `.claude/skills/VENDORED.md` `## Overrides`, not edited and not a ground
   for exclusion.
5. **Domain-irrelevant collections still yield their transferable part** — an authoring
   standard, a doctrine, a pattern — as a first-party document naming the source.
6. **"Thinks like me" is standing context, not a mood.** `docs/company/FOUNDER_PROFILE.md`
   records who the founder is and how he works; the owner-comms skill no longer calls
   him non-technical; the base `signalgrid` skill points every role at the profile
   before it touches anything.

**Boundary.** The hard lines do not move: hooks off, pins only, keys out of the tree,
the publication boundary, the launch-claims gate and the launch profile untouched;
nothing vendored enters `lib/*`, `/v1`, a connector, a proof or the decision path, and
nothing vendored is executed by a gate. What moves is the default answer to a shared
resource: from "evaluated, not adopted" to "adopted, in this form".

**Evidence.** The seven evaluation reports (measurements preserved in their intake
rows); the two overruled verdicts of DR-038; the owner's message quoted above; the
founder's résumé (owner-held).

**Reversal.** Delete this record, rule 5 of `docs/agent/RESOURCE_INTAKE.md`,
`docs/company/FOUNDER_PROFILE.md`, ICP Finding 9, the pointer in the base skill and the
three owner-comms edits; the exclusion list reverts to the evaluators' judgement.

---

## DR-042 — The founder's thesis in his words: the system of systems above the individually owned platforms (owner-directed 2026-09-12)

**Question.** The owner sent a third-party infographic — *"10 cloud architecture
concepts"* by **Rajender Ponnala** — and, alongside it, the first complete
statement of his own thesis he has ever put into words for this repository. Does
the canonical purpose doc already say what he said; where it does not, what is the
smallest truthful addition; and how much of what he describes does the tree
actually model?

**The statement, verbatim.** Dictated, and reproduced without correction —
punctuation, spelling and grammar as he said them. Tidying it is how a founder's
thesis quietly becomes somebody else's paraphrase.

> "This is also another great example of all of this stuff is individual
> controlled by people and sometimes teams and they all have to decide how to do
> what and config this to make whatever communicate with it for end users and
> customers or whoever the person in other end needs X on the device no matter the
> platform will need to go through all this process and chain of commands and
> whatever else is going on but my point is with SignalGrid my solution sits on top
> of all of this that ingest to crest super simple automated workflows to simply
> allow or deny based on how you want auth to be handled which in this case using
> some sort of RFID and or security token that allows access and usage of any
> device within there department or assigned area or equipment then if X process
> breaks then the solution can self resolve and notify the proper protocol and
> teams that are assign to that resource and monitor the fix or jump in and resolve
> problem and it will kick off tickets and change management while notification for
> users affected and all that it's the smart system of systems that orchestras
> every to ask it to do for you for the entire company no matter the product or
> solution you use we will ingest in the signal and power the grid plan and
> simple."

**Call: the statement is recorded as product doctrine, tested clause by clause
against `docs/PURPOSE.md`, and the three clauses PURPOSE did not carry are added to
PURPOSE under this record's authority (DR-020's rule that a PURPOSE change rides a
decision record). The quote itself lands in `docs/WHY_THIS_EXISTS.md`, in the
section that has been deliberately blank since that page was written.**

**Why `WHY_THIS_EXISTS.md` and not PURPOSE.** That page carries a section headed
*"What only the founder can write"* whose entire body was: *"This section is
deliberately blank, and should stay blank until he fills it."* The page's own
argument was that everything else on it had been inferred from his artifacts by
someone else, and that the part which cannot be inferred is his to write. He wrote
it. It goes where the page reserved for it, and the page's opening sentence — which
said the clearest statement of the thesis was *not* in this repository — is
corrected in the same change, because it is no longer true.

### What the statement asserts, and where the tree already said it

| # | Assertion | Status | Where it is stated |
| --- | --- | --- | --- |
| **a** | SignalGrid sits ABOVE individually owned platforms and ingests their signals. | **partial → now stated in full** | The SYSTEM half was canonical: `docs/PURPOSE.md:20` (*"connects the systems a building already runs … into one grid"*), `CLAUDE.md:10`, `docs/ECOSYSTEM_POSITIONING.md:15`. The OWNERSHIP half — that each system has a different owner who has already decided how it behaves, and that this is *why* nothing joins them — was implied only: `docs/WHY_THIS_EXISTS.md:37` (*"Nothing joins the layers up"*) and `:133` (*"no layer is accountable for the join"*). **Added: `docs/PURPOSE.md:30`.** |
| **b** | The output is simple automated allow/deny workflows. | **stated** | The verdict enum at `docs/PURPOSE.md:163`–`170` (`allow` / `step-up` / `restrict` / `deny`); the cascade sentence at `:49`; the app-workflow surface (`lib/app-workflows`, `docs/APP_WORKFLOW_TEMPLATES.md`). His *"allow or deny"* is the two ends of a four-rung ladder, not a different model — `step_up` and `restrict` are the rungs that let the answer be *"yes, with one more thing"* instead of a refusal. |
| **c** | The auth factor is the customer's choice; the grid is factor-agnostic. | **partial → now stated** | `docs/PURPOSE.md:24` already listed *"badge, phone, token, biometric"*, and `docs/CREDENTIAL_READER_SIGNAL_MODEL.md:66` already models prox, RFID, NFC, smart card, BLE/mobile credential, barcode and passkey as one `credentialTechnology` axis. What no page said is that the CHOICE is the customer's and the grid is agnostic to it — which is the same argument as DR-035's vendor-lock line, applied to the reader. **Added: `docs/PURPOSE.md:38`.** |
| **d** | A grant is scoped to a department, an assigned area, or a piece of equipment. | **not stated → now stated** | The vocabulary existed in pieces — rooms, zones, units and bays in `lib/orchestration` and `lib/facility-trust-graph`, entitlement scope in the `entitlement-binding` and `access-governance` dimensions — but no page said a grant is bounded by the organization's own assignment. `pnpm run check:absence "assigned area"` and `"assigned equipment"` were both run on 2026-09-12 BEFORE this record was written and returned four empty probes each; re-run now they are INCONCLUSIVE and the only matches are this record and the intake row, which is the tool's documented behaviour when a document records an absence. The absence was of the SENTENCE, not of the machinery — rooms, units, bays and entitlement scope were all modelled. **Added: `docs/PURPOSE.md:45`.** |
| **e** | When a process breaks the system self-resolves where it can, notifies the assigned team by the assigned protocol, monitors the fix or steps in. | **partial** | The doctrine sentence was there — `docs/PURPOSE.md:49`, *"A decision is the trigger for a cascade — environment, workflow, verification, and escalation"* — and `CLAUDE.md` says the same. What was never written down is the cascade's STAGES, which is what makes the sentence checkable. `docs/OPERATIONAL_TRUST_ORCHESTRATION.md:71`–`72` and `:122`–`124` reach the same list (*"Who owns it?"*, *"How do we verify completion?"*, *"routes approved actions"*, *"verifies expected outcomes"*) but that page is **retired history** and is bannered as such, so it cannot be cited as current doctrine. **Added as a named, per-stage status table: `docs/PURPOSE.md:53`.** |
| **f** | It opens tickets and change-management records and notifies affected users. | **partial, and one clause needed a doctrinal ruling** | Tickets: the priority/SLA/assignment-group model is built and deterministic (`lib/incident-playbook`), and eight gated vendor emitters exist (`lib/integrations/src/integrations/itsm`) — but nothing joins them, so no ticket opens. Change records: the fabric READS an approved change record (`change-window`) and never opens one. Affected users: `pnpm run check:absence "affected user notification"` returned CORROBORATED across all four probes on 2026-09-12. **The ruling:** notifying affected people is doctrine, but it may never become a SignalGrid surface the worker has to go and read — `docs/PURPOSE.md:98`, *"The worker never sees SignalGrid"*, outranks it. The notification goes through the channel the person already uses, or it does not go. **Added with that constraint attached: `docs/PURPOSE.md:53` (stage table).** |
| **g** | It is product-agnostic — *"no matter the product or solution you use we will ingest in the signal and power the grid"*. | **stated** | `docs/PURPOSE.md:81` (*"Source-agnostic is the point, not a feature"*), ratified as DR-035, with the vendor-lock prohibition in the forbidden list. This is the one clause where the canonical page was already ahead of the statement rather than behind it. |

### What this record does NOT license

Every addition above is **doctrine about what the product is and does by design**.
None of it is a claim that a capability ships today. The cascade table added to
PURPOSE marks each stage BUILT, PARTIAL or DESIGN INTENT and points every unbuilt
stage at a `docs/BUILD_BACKLOG.md` item rather than at a promise. The
launch-claims gate, the launch-profile classification and the publication boundary
are unchanged by this record and still govern what may be SAID to ship. Building
and claiming remain different acts (DR-021 §2).

Two of his clauses carry a specific hazard and are constrained rather than adopted
whole:

- ***"the solution can self resolve"*** — the resolution planner is real
  (`lib/signalgrid-core/src/resolution.ts`), and everything it produces is
  approval-gated and simulated. PURPOSE's forbidden list already bans claiming
  *autonomous remediation* (`docs/PURPOSE.md:265`) and the read-before-write
  prerequisite (`:186`) is unchanged. Self-resolve means *the system knows the fix
  and prepares it*; a human still approves the write.
- ***"notification for users affected"*** — see (f). Adopted with the embedded UX
  law attached, because a notification SignalGrid invents is a step added to the
  worker's day, which §3 forbids outright.

### The cascade audit, and what it produced

The measurement behind (e) and (f) is recorded with its commands and output in
`docs/agent/EVIDENCE.md` (2026-09-12). The short form: **both ends of the cascade
are built and the joins between them are not.** Modelled and fixture-backed —
remediation proposal, resolution planning and simulation, the incident playbook,
orchestration planning, deterministic webhook delivery with dead-lettering.
Connector stubs behind a live-call gate — eight ITSM vendors, the generic webhook
emitter, the change-window reader. Prose only — the cascade as a sequence. Absent —
any path from an incident to a ticket, any change-record draft, any notification of
an affected person, and any observation that a requested fix landed. Six
`docs/BUILD_BACKLOG.md` items were opened for exactly those joins, each fail-closed
and deterministic by construction, each naming the clause of his sentence it serves.

### The infographic

Mapped rather than filed, in
`docs/SIGNALGRID_CLOUD_PLATFORM_AND_CYBER_RESILIENCE_ARCHITECTURE.md` — one row per
concept: what it means for a deterministic, fixture-backed decision fabric, what
the tree has, what it deliberately does NOT do, and what is backlog. Several of the
answers are refusals, and that is the value of the exercise: a generic cloud
pattern applied to a fail-closed decision path can invert it. No cache in the
decision path, because a stale `allow` is the failure the five-minute idempotency
window was cut from twenty-four hours to prevent. No retry inside a decision,
because an honest `unknown` beats a slow answer while someone waits at a door. No
queue on ingestion, because a queued verdict arrives after the person has left.
The image is third-party and is not committed; it is described, and its author is
named. **No deployment-target claim is added in either direction** — the tree
speaks Microsoft Graph, Intune, Entra and ServiceNow because that is the estate it
reads, which says nothing about where it runs.

**Evidence.** The founder's statement as dictated (quoted above in full);
`docs/PURPOSE.md` read in full before editing; `CLAUDE.md` *"What this is"*;
`docs/WHY_THIS_EXISTS.md`; `docs/OPERATIONAL_TRUST_ORCHESTRATION.md` (retired, and
treated as retired); `docs/ECOSYSTEM_POSITIONING.md`; the grep audit and
`check:absence` runs recorded in `docs/agent/EVIDENCE.md`; DR-020 (PURPOSE
canonical), DR-034 (his inputs ARE the research), DR-035 (source-agnostic), DR-033
(Build / execution phase).

**Reversal.** The owner reverses any line of this by saying so — it is his
statement and his doctrine. Mechanically: if a cascade stage is built and shipped,
its row in `docs/PURPOSE.md`'s stage table moves from DESIGN INTENT to BUILT and
the matching backlog item closes; if a stage is refused on evidence, the row says
refused and names the reason, as backlog row 27b already does for a refusal. The
one line that does not move on appetite is (f)'s constraint: a worker-facing
SignalGrid notification surface reopens only if the embedded UX law itself is
reopened, which takes its own decision record.

**Confidence: high** on the record and the assertion table — every status is
anchored to a path and a line that was read, and the absences were probed rather
than assumed. **Medium** on the backlog shaping: six joins is the right count for
what the audit found, but the ORDER between them is a sequencing call nobody has
made yet, and the first one built should be the one a design partner asks for.
